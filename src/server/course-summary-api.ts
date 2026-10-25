import {
  COURSE_SUMMARY_LIMIT, COURSE_SUMMARY_SOURCE, CourseSummaryError,
  courseSummaryId, sameCourseSummaryValues, validateCourseSummary,
  type CourseSummary, type CourseSummaryWrite,
} from '../lib/course-summary';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store, max-age=0',
    vary: 'Cookie, oai-authenticated-user-id', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
  } });
}
async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CourseSummaryError(415, 'JSON_REQUIRED', 'Send a JSON course summary.');
  const maximum = 32768; const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new CourseSummaryError(413, 'BODY_TOO_LARGE', 'The course summary exceeds the allowed size.');
  if (!request.body) throw new CourseSummaryError(400, 'INVALID_JSON', 'A JSON object is required.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new CourseSummaryError(413, 'BODY_TOO_LARGE', 'The course summary exceeds the allowed size.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new CourseSummaryError(400, 'INVALID_UTF8', 'The course summary must use UTF-8.'); }
  try { return JSON.parse(text); } catch { throw new CourseSummaryError(400, 'INVALID_JSON', 'A JSON object is required.'); }
}
type Row = Record<string, unknown>;
function view(row: Row): CourseSummary {
  return {
    id: String(row.id), revision: Number(row.revision), organizationId: String(row.organization_id), programId: String(row.program_id),
    organizationName: String(row.organization_name), programName: String(row.program_name), source: COURSE_SUMMARY_SOURCE,
    facility: row.facility as string | null, yard: row.yard as string | null, status: row.status as CourseSummary['status'],
    startDate: row.start_date as string | null, endDate: row.end_date as string | null,
    courseHoursPerParticipant: row.course_hours_per_participant === null ? null : Number(row.course_hours_per_participant),
    participants: row.participants === null ? null : Number(row.participants), completers: row.completers === null ? null : Number(row.completers),
    notes: row.notes as string | null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
const SELECT = `SELECT s.*, o.name organization_name, p.name program_name FROM course_summaries s
  JOIN sms_organizations o ON o.id=s.organization_id JOIN sms_programs p ON p.id=s.program_id`;
async function getSummary(db: D1Database, id: string): Promise<CourseSummary | null> {
  const row = await db.prepare(SELECT + ' WHERE s.id=?').bind(id).first<Row>();
  return row ? view(row) : null;
}
function values(summary: CourseSummaryWrite): (string | number | null)[] {
  return [summary.organizationId, summary.programId, summary.facility, summary.yard, summary.status, summary.startDate, summary.endDate,
    summary.courseHoursPerParticipant, summary.participants, summary.completers, summary.notes];
}
async function writeSummary(request: Request, db: D1Database): Promise<Response> {
  const summary = validateCourseSummary(await readJson(request));
  const mapping = await db.prepare('SELECT p.id, p.name program_name, o.name organization_name FROM sms_programs p JOIN sms_organizations o ON o.id=p.organization_id WHERE p.id=? AND p.organization_id=?').bind(summary.programId, summary.organizationId).first<Row>();
  if (!mapping) throw new CourseSummaryError(400, 'INVALID_PROGRAM', 'Choose an existing program within the selected organization.');
  const now = new Date().toISOString();
  // Each write is a single atomic SQLite statement. Retrying the same revision and
  // canonical values succeeds without another increment; a competing edit conflicts.
  const changed = summary.revision === 0
    ? await db.prepare(`INSERT INTO course_summaries(id,revision,organization_id,program_id,facility,yard,status,start_date,end_date,course_hours_per_participant,participants,completers,notes,created_at,updated_at)
        VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING *`).bind(summary.id, ...values(summary), now, now).first<Row>()
    : await db.prepare(`UPDATE course_summaries SET revision=revision+1,organization_id=?,program_id=?,facility=?,yard=?,status=?,start_date=?,end_date=?,course_hours_per_participant=?,participants=?,completers=?,notes=?,updated_at=?
        WHERE id=? AND revision=? RETURNING *`).bind(...values(summary), now, summary.id, summary.revision).first<Row>();
  if (changed) return json({ summary: view({ ...changed, organization_name: mapping.organization_name, program_name: mapping.program_name }), replayed: false }, summary.revision === 0 ? 201 : 200);
  const current = await getSummary(db, summary.id);
  if (current && current.revision === summary.revision + 1 && sameCourseSummaryValues(current, summary)) return json({ summary: current, replayed: true });
  if (!current && summary.revision > 0) throw new CourseSummaryError(404, 'SUMMARY_NOT_FOUND', 'This course summary was not found. Refresh the saved summaries.');
  throw new CourseSummaryError(409, 'REVISION_CONFLICT', 'This course summary changed after you opened it. Your edits were not saved. Reload its latest saved version before editing again.');
}

/** Internal handler: caller MUST requireAdmin for all requests and requireOrigin before writes. */
export async function handleCourseSummaries(request: Request, db: D1Database): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname.replace(/\/+$/, '') !== '/api/sms/summaries') throw new CourseSummaryError(404, 'NOT_FOUND', 'Course-summary endpoint not found.');
    if (request.method === 'POST') return await writeSummary(request, db);
    if (request.method !== 'GET') throw new CourseSummaryError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for course summaries.');
    if ([...url.searchParams.keys()].some(key => key !== 'organizationId') || url.searchParams.getAll('organizationId').length > 1) throw new CourseSummaryError(400, 'INVALID_QUERY', 'Choose one organization filter.');
    const organizationId = url.searchParams.has('organizationId') ? courseSummaryId(url.searchParams.get('organizationId')) : null;
    if (organizationId && !await db.prepare('SELECT id FROM sms_organizations WHERE id=?').bind(organizationId).first()) throw new CourseSummaryError(404, 'ORGANIZATION_NOT_FOUND', 'This organization was not found.');
    const summaries = await db.prepare(SELECT + (organizationId ? ' WHERE s.organization_id=?' : '') + ' ORDER BY s.updated_at DESC,s.id DESC LIMIT ?').bind(...(organizationId ? [organizationId] : []), COURSE_SUMMARY_LIMIT + 1).all<Row>();
    const organizations = await db.prepare('SELECT id,name,active FROM sms_organizations ORDER BY name,id').all<Row>();
    const programs = await db.prepare('SELECT id,organization_id,name,active FROM sms_programs ORDER BY name,id').all<Row>();
    return json({ source: COURSE_SUMMARY_SOURCE, generatedAt: new Date().toISOString(), limit: COURSE_SUMMARY_LIMIT, truncated: summaries.results.length > COURSE_SUMMARY_LIMIT,
      summaries: summaries.results.slice(0, COURSE_SUMMARY_LIMIT).map(view),
      organizations: organizations.results.map(row => ({ id: row.id, name: row.name, active: Boolean(row.active) })),
      programs: programs.results.map(row => ({ id: row.id, organizationId: row.organization_id, name: row.name, active: Boolean(row.active) })),
    });
  } catch (error) {
    if (error instanceof CourseSummaryError) return json({ code: error.code, error: error.message }, error.status);
    // Never expose SQL, identifiers, notes, contact data, or credentials in errors.
    return json({ code: 'SUMMARY_UNAVAILABLE', error: 'The course-summary request could not be completed. Retry the same save safely, or refresh in a moment.' }, 500);
  }
}
