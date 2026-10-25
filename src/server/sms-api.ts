import { seedDefyActivity } from './defy-seed';
import { recordSmsReversal } from './sms-reversal';
import { ATTENDANCE_RECORDS_SQL, ATTENDANCE_AGGREGATES_SQL } from './attendance-source';
import { seedCenterCollection } from './center-seed';
import { isBusinessRequestText } from '../lib/business-request-text';
import { deliverBusinessEventsForSid } from './business-events';
import { participantEstimateStatement, participantEstimateGroups } from './participant-estimate-api';
import { programParticipantEstimate, sumParticipantEstimates } from '../lib/participant-estimate';
import { newManagerRequestStatement } from './business-agent-d1';
import { businessAdminData, mutateBusinessAdmin } from './business-admin-api';
import { BusinessAgentError } from './business-agent-service';
import { emptyCourseEstimateTotals } from '../lib/course-estimate';
import { courseEstimateStatement, courseEstimateGroups } from './course-estimate-api';
import { isE164, parseSms, parseSmsCommand, parseSmsReversal, verifyTwilioSignature } from '../lib/sms';
import { handleSmsReport } from './sms-report-api';
import { handleCourseSummaries } from './course-summary-api';
import { COURSE_ATTENDANCE_LIMIT, type CourseIdentity, type CourseAttendanceData } from '../lib/course-attendance';
import { dashboardCourseStatements, dashboardCourseAttendance } from './course-attendance-batch';

export interface SmsRuntime {
  DB?: D1Database;
  MCP_EVENTS_CALLBACK_ORIGIN?: string;
  TPW_ADMIN_USER_IDS?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  TWILIO_WEBHOOK_URL?: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INBOUND = '/api/sms/inbound';
class SmsError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store, max-age=0', 'vary': 'Cookie, oai-authenticated-user-id', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } });
}
function adminIds(env: SmsRuntime): string[] { return (env.TPW_ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean); }
function identity(request: Request): string | null {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  return id && email && id.length <= 256 && email.length <= 320 ? id : null;
}
function requireAdmin(request: Request, env: SmsRuntime): string {
  const user = identity(request);
  if (!user) throw new SmsError(401, 'SIGN_IN_REQUIRED', 'Sign in with ChatGPT to view live SMS dashboards or maintain programs.');
  if (!adminIds(env).length) throw new SmsError(503, 'ADMIN_NOT_CONFIGURED', 'TPW administrator access has not been configured yet. Live records remain private.');
  if (!adminIds(env).includes(user)) throw new SmsError(403, 'ADMIN_REQUIRED', 'This account is not an authorized TPW administrator.');
  return user;
}
function requireOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new SmsError(403, 'INVALID_ORIGIN', 'Make changes from the ImpactLens site.');
}
export function webhookConfigured(env: SmsRuntime): boolean {
  if (!env.TWILIO_AUTH_TOKEN || env.TWILIO_AUTH_TOKEN.length < 16 || !/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID ?? '') || !isE164(env.TWILIO_PHONE_NUMBER ?? '')) return false;
  try {
    const url = new URL(env.TWILIO_WEBHOOK_URL ?? '');
    return url.protocol === 'https:' && url.pathname === INBOUND && !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
}
async function readText(request: Request, maxBytes: number): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new SmsError(413, 'BODY_TOO_LARGE', 'Request exceeds the allowed size.');
  if (!request.body) return '';
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > maxBytes) { await reader.cancel(); throw new SmsError(413, 'BODY_TOO_LARGE', 'Request exceeds the allowed size.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new SmsError(400, 'INVALID_UTF8', 'Request must be UTF-8.'); }
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new SmsError(415, 'JSON_REQUIRED', 'Send JSON.');
  let value: unknown;
  try { value = JSON.parse(await readText(request, 8192)); } catch (error) { if (error instanceof SmsError) throw error; throw new SmsError(400, 'INVALID_JSON', 'A JSON object is required.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SmsError(400, 'INVALID_JSON', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
function only(body: Record<string, unknown>, fields: string[]) { if (Object.keys(body).some(key => !fields.includes(key))) throw new SmsError(400, 'UNKNOWN_FIELD', 'An unsupported field was submitted.'); }
function idField(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new SmsError(400, 'INVALID_ID', 'Choose a valid record.'); return value; }
function nameField(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw new SmsError(400, 'INVALID_NAME', 'Use a name of 1–100 characters without control characters.'); return value.trim(); }
function activeField(value: unknown): number { if (value !== undefined && typeof value !== 'boolean') throw new SmsError(400, 'INVALID_ACTIVE', 'Active must be true or false.'); return value === false ? 0 : 1; }
function numbers(row: Record<string, unknown> | null | undefined) {
  return { sessions: Number(row?.sessions ?? 0), attendees: Number(row?.attendees ?? 0), sessionMinutes: Number(row?.session_minutes ?? 0), participantMinutes: Number(row?.participant_minutes ?? 0) };
}
function organizationView(row: Record<string, unknown>) { return { id: row.id, name: row.name, slug: row.slug, active: Boolean(row.active), ...numbers(row) }; }
function programView(row: Record<string, unknown>) { return { id: row.id, organizationId: row.organization_id, name: row.name, active: Boolean(row.active), ...numbers(row) }; }
const ORG_SELECT = `SELECT o.*, COALESCE(SUM(a.sessions),0) sessions, COALESCE(SUM(a.attendees),0) attendees, COALESCE(SUM(a.session_minutes),0) session_minutes, COALESCE(SUM(a.participant_minutes),0) participant_minutes FROM sms_organizations o LEFT JOIN ${ATTENDANCE_AGGREGATES_SQL} a ON a.organization_id=o.id`;
const PROGRAM_SELECT = `SELECT p.*, COALESCE(a.sessions,0) sessions, COALESCE(a.attendees,0) attendees, COALESCE(a.session_minutes,0) session_minutes, COALESCE(a.participant_minutes,0) participant_minutes FROM sms_programs p LEFT JOIN ${ATTENDANCE_AGGREGATES_SQL} a ON a.program_id=p.id`;

// Constructed only from trusted SQL columns, never a caller-provided JSON blob.
const COURSE_SNAPSHOT = `json_object('id',c.id,'organizationId',o.id,'programId',p.id,
  'organizationName',o.name,'programName',p.name,'facility',c.facility,'yard',c.yard,'startDate',c.start_date,'endDate',c.end_date)`;
const INVALID_COURSE = `(t.course_id IS NOT NULL AND (c.id IS NULL OR c.program_id IS NOT p.id OR c.organization_id IS NOT o.id))`;

async function receiveSms(request: Request, env: SmsRuntime, background?: (promise: Promise<unknown>) => void): Promise<Response> {
  const receivedAt = new Date().toISOString();
  if (request.method !== 'POST') throw new SmsError(405, 'METHOD_NOT_ALLOWED', 'Twilio must POST incoming SMS.');
  if (!webhookConfigured(env)) throw new SmsError(503, 'SMS_NOT_CONFIGURED', 'SMS receiving is not configured.');
  if (!env.DB) throw new SmsError(503, 'STORAGE_UNAVAILABLE', 'SMS storage is unavailable.');
  const requestUrl = new URL(request.url);
  if (requestUrl.search || requestUrl.pathname !== INBOUND || requestUrl.origin !== new URL(env.TWILIO_WEBHOOK_URL!).origin) throw new SmsError(403, 'INVALID_SIGNATURE', 'Webhook verification failed.');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new SmsError(415, 'FORM_REQUIRED', 'Twilio form encoding is required.');
  const params = new URLSearchParams(await readText(request, 24576));
  if (!await verifyTwilioSignature(env.TWILIO_WEBHOOK_URL!, params, request.headers.get('x-twilio-signature') ?? '', env.TWILIO_AUTH_TOKEN!)) throw new SmsError(403, 'INVALID_SIGNATURE', 'Webhook verification failed.');
  if (params.get('AccountSid') !== env.TWILIO_ACCOUNT_SID || params.get('To') !== env.TWILIO_PHONE_NUMBER) throw new SmsError(403, 'INVALID_DESTINATION', 'Webhook account or recipient is not configured for this service.');
  const messageSid = params.get('MessageSid') ?? ''; const sender = params.get('From') ?? ''; const body = params.get('Body') ?? '';
  if (!/^SM[0-9a-f]{32}$/i.test(messageSid) || !isE164(sender) || body.length > 10000) throw new SmsError(400, 'INVALID_ENVELOPE', 'Invalid SMS envelope.');
  const reversal = parseSmsReversal(body);
  if (reversal.ok && (params.get('NumMedia') ?? '0') === '0') {
    await recordSmsReversal(env.DB, {recordId:crypto.randomUUID(),messageSid,sender,body,metrics:reversal.metrics,receivedAt,now:new Date().toISOString()});
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {headers:{'content-type':'text/xml; charset=utf-8','cache-control':'no-store'}});
  }
  const parsed = parseSmsCommand(body); const valid = parsed.ok && (params.get('NumMedia') ?? '0') === '0';
  const repeat = parsed.ok && parsed.kind === 'repeat';
  const metrics = parsed.ok && parsed.kind === 'numeric' ? parsed.metrics : null;
  const now = new Date().toISOString();
  // Resolve the current binding, last accepted baseline, immutable source/values,
  // and acceptance order in ONE write statement. SQLite serializes writers; no
  // read-before-write race, receipt-clock tie, or provider replay can change this.
  // Legacy accepted rows have no order: use their processing/receipt/rowid order.
  const recordId = crypto.randomUUID();
  const receiptStatement = env.DB.prepare(`WITH input(record_id,message_sid,sender_phone,body,valid,is_repeat,attendees,session_minutes,received_at,now) AS (
      VALUES(?,?,?,?,?,?,?,?,?,?)
    ), resolved AS (
      SELECT i.*,t.id teacher_id,o.id organization_id,p.id program_id,o.name organization_name,p.name program_name,t.course_id,
        CASE WHEN c.id IS NOT NULL AND c.program_id=p.id AND c.organization_id=o.id THEN ${COURSE_SNAPSHOT} ELSE NULL END course_snapshot_json,
        b.id repeated_from_record_id,b.attendees repeated_attendees,b.session_minutes repeated_minutes,
        CASE WHEN i.valid=0 THEN 'INVALID_BODY' WHEN t.id IS NULL THEN 'UNKNOWN_SENDER'
          WHEN t.active=0 OR p.active=0 OR o.active=0 THEN 'INACTIVE_SENDER'
          WHEN ${INVALID_COURSE} THEN 'INVALID_COURSE'
          WHEN i.is_repeat=1 AND b.id IS NULL THEN 'REPEAT_BASELINE_REQUIRED' ELSE NULL END reason
      FROM input i LEFT JOIN sms_teachers t ON t.phone=i.sender_phone
      LEFT JOIN sms_programs p ON p.id=t.program_id LEFT JOIN sms_organizations o ON o.id=p.organization_id
      LEFT JOIN course_summaries c ON c.id=t.course_id
      LEFT JOIN sms_records b ON b.id=(
        SELECT r.id FROM sms_records r WHERE i.is_repeat=1 AND r.status='counted' AND NOT EXISTS(SELECT 1 FROM sms_reversals x WHERE x.target_record_id=r.id)
          AND r.sender_phone=i.sender_phone AND r.teacher_id=t.id AND r.course_id=c.id
          AND r.organization_id=o.id AND r.program_id=p.id AND c.organization_id=o.id AND c.program_id=p.id
          AND typeof(r.attendees)='integer' AND r.attendees BETWEEN 0 AND 10000
          AND typeof(r.session_minutes)='integer' AND r.session_minutes BETWEEN 15 AND 1440 AND r.session_minutes%15=0
        ORDER BY r.accepted_order DESC,r.processed_at DESC,r.received_at DESC,r.rowid DESC LIMIT 1)
    ) INSERT INTO sms_records
      (id,message_sid,sender_phone,body,status,reason,teacher_id,organization_id,program_id,organization_name,program_name,
       course_id,course_snapshot_json,attendees,session_minutes,received_at,processed_at,repeated_from_record_id,accepted_order)
    SELECT record_id,message_sid,sender_phone,body,CASE WHEN reason IS NULL THEN 'counted' ELSE 'quarantined' END,
      reason,teacher_id,organization_id,program_id,organization_name,program_name,course_id,course_snapshot_json,
      CASE WHEN is_repeat=1 THEN repeated_attendees ELSE attendees END,
      CASE WHEN is_repeat=1 THEN repeated_minutes ELSE session_minutes END,received_at,
      CASE WHEN reason IS NULL THEN now ELSE NULL END,repeated_from_record_id,
      CASE WHEN reason IS NULL THEN (SELECT COALESCE(MAX(accepted_order),0)+1 FROM sms_records) ELSE NULL END
    FROM resolved WHERE true ON CONFLICT(message_sid) DO NOTHING`)
    .bind(recordId, messageSid, sender, body, Number(valid), Number(repeat), metrics?.attendees ?? null, metrics?.sessionMinutes ?? null, receivedAt, now);
  if (isBusinessRequestText(body) && (params.get('NumMedia') ?? '0') === '0') {
    // Only new free-text receipts can queue under an explicit leader grant.
    // Both statements commit together; provider retries cannot import old rows.
    await env.DB.batch([receiptStatement, newManagerRequestStatement(env.DB, recordId, now)]);
    // Schedule only after canonical receipt/request/outbox commit. The event
    // transport never delays attendance and has no schedule or agent polling.
    if (background && env.MCP_EVENTS_CALLBACK_ORIGIN) background(deliverBusinessEventsForSid(env.DB, env, messageSid).catch(() => undefined));
  } else await receiptStatement.run();
  // An empty TwiML response acknowledges HTTP receipt without sending an SMS.
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

async function dashboard(db: D1Database, url: URL): Promise<Response> {
  const organizationId = url.searchParams.get('organizationId');
  const includeCourses = url.searchParams.has('includeCourses');
  if (includeCourses && (url.searchParams.get('includeCourses') !== '1' || !organizationId
    || [...url.searchParams.keys()].some(key => !['organizationId', 'includeCourses'].includes(key))
    || ['organizationId', 'includeCourses'].some(key => url.searchParams.getAll(key).length !== 1))) {
    throw new SmsError(400, 'INVALID_QUERY', 'Course charts require one organization and includeCourses=1.');
  }
  if (organizationId) idField(organizationId);
  // D1 batch gives one transaction/snapshot and one round trip. Direct D1
  // binding queries use the primary, so fresh polls never select a stale replica.
  const bindings = organizationId ? [organizationId] : [];
  const [orgs, programs, totals, recent, estimateRows, participantRows, courseRows, coursePointRows] = await db.batch<Record<string, unknown>>([
    db.prepare(ORG_SELECT + (organizationId ? ' WHERE o.id=?' : '') + ' GROUP BY o.id ORDER BY o.name').bind(...bindings),
    db.prepare(PROGRAM_SELECT + (organizationId ? ' WHERE p.organization_id=?' : '') + ' ORDER BY p.name').bind(...bindings),
    db.prepare(`SELECT SUM(sessions) sessions,SUM(attendees) attendees,SUM(session_minutes) session_minutes,SUM(participant_minutes) participant_minutes,MAX(last_received_at) last_received_at FROM ${ATTENDANCE_AGGREGATES_SQL}` + (organizationId ? ' WHERE organization_id=?' : '')).bind(...bindings),
    db.prepare(`SELECT id,organization_name,program_name,attendees,session_minutes,received_at,processed_at,source FROM ${ATTENDANCE_RECORDS_SQL} WHERE status='counted'` + (organizationId ? ' AND organization_id=?' : '') + ' ORDER BY processed_at DESC,id DESC LIMIT 8').bind(...bindings),
    courseEstimateStatement(db, organizationId),
    participantEstimateStatement(db, organizationId),
    ...(includeCourses ? dashboardCourseStatements(db, organizationId!) : []),
  ]);
  if (organizationId && !orgs.results.length) throw new SmsError(404, 'NOT_FOUND', 'Organization not found.');
  const total = totals.results[0]; const estimates = courseEstimateGroups(estimateRows.results); const participants = participantEstimateGroups(participantRows.results);
  const generatedAt = new Date().toISOString();
  return json({ generatedAt, ...(includeCourses ? dashboardCourseAttendance(courseRows.results, coursePointRows.results, generatedAt) : {}), lastReceivedAt: total?.last_received_at ?? null, totals: numbers(total), participantEstimate: participants.total, serviceEstimate: estimates.total, organizations: orgs.results.map(r => ({ ...organizationView(r), participantEstimate: participants.organizations.get(String(r.id)) ?? sumParticipantEstimates([]), serviceEstimate: estimates.organizations.get(String(r.id)) ?? emptyCourseEstimateTotals() })), programs: programs.results.map(r => ({ ...programView(r), participantEstimate: participants.programs.get(String(r.id)) ?? { value: null, source: 'unknown' }, serviceEstimate: estimates.programs.get(String(r.id)) ?? emptyCourseEstimateTotals() })), organization: organizationId ? { ...organizationView(orgs.results[0]), participantEstimate: participants.organizations.get(organizationId) ?? sumParticipantEstimates([]) } : null,
    recent: recent.results.map(r => ({ id: r.id, organizationName: r.organization_name, programName: r.program_name, attendees: r.attendees, sessionMinutes: r.session_minutes, receivedAt: r.received_at, processedAt: r.processed_at, source: r.source })) });
}
function courseIdentity(row: Record<string, unknown>): CourseIdentity {
  return { id: String(row.id), organizationId: String(row.organization_id), programId: String(row.program_id),
    organizationName: String(row.organization_name), programName: String(row.program_name), facility: row.facility as string | null,
    yard: row.yard as string | null, startDate: row.start_date as string | null, endDate: row.end_date as string | null };
}
async function courseAttendance(db: D1Database, url: URL): Promise<Response> {
  const keys = ['courseId', 'organizationId', 'programId'];
  if ([...url.searchParams.keys()].some(key => !keys.includes(key)) || keys.some(key => url.searchParams.getAll(key).length > 1)) throw new SmsError(400, 'INVALID_QUERY', 'Choose one course and optional organization/program filters.');
  const courseId = idField(url.searchParams.get('courseId'));
  const organizationId = url.searchParams.has('organizationId') ? idField(url.searchParams.get('organizationId')) : null;
  const programId = url.searchParams.has('programId') ? idField(url.searchParams.get('programId')) : null;
  const [courses, rows, totals] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT c.*,o.name organization_name,p.name program_name FROM course_summaries c
      JOIN sms_programs p ON p.id=c.program_id AND p.organization_id=c.organization_id
      JOIN sms_organizations o ON o.id=c.organization_id WHERE c.id=?`).bind(courseId),
    // Receipt order is explicit, with a deterministic ID tie-break. The number is
    // a display sequence, NOT a class date or a claim that a session happened then.
    db.prepare(`SELECT id,sequence,received_at,processed_at,attendees,session_minutes,course_snapshot_json,repeated_from_record_id FROM (
      SELECT r.id,ROW_NUMBER() OVER (ORDER BY r.received_at,r.id) sequence,r.received_at,r.processed_at,r.attendees,r.session_minutes,r.course_snapshot_json,r.repeated_from_record_id
      FROM ${ATTENDANCE_RECORDS_SQL} r JOIN course_summaries c ON c.id=r.course_id AND c.organization_id=r.organization_id AND c.program_id=r.program_id
      WHERE r.course_id=? AND r.status='counted') ORDER BY sequence DESC LIMIT ?`).bind(courseId, COURSE_ATTENDANCE_LIMIT),
    db.prepare(`SELECT COUNT(*) sessions,COALESCE(SUM(r.attendees),0) attendees,COALESCE(SUM(r.session_minutes),0) session_minutes,
      COALESCE(SUM(r.attendees*r.session_minutes),0) participant_minutes,MAX(r.attendees) maximum_attendance,EXISTS(SELECT 1 FROM sms_reversals x JOIN sms_records h ON h.id=x.target_record_id WHERE h.course_id=?) has_reversed_history FROM ${ATTENDANCE_RECORDS_SQL} r
      JOIN course_summaries c ON c.id=r.course_id AND c.organization_id=r.organization_id AND c.program_id=r.program_id
      WHERE r.course_id=? AND r.status='counted'`).bind(courseId,courseId),
  ]);
  const course = courses.results[0];
  if (!course || (organizationId && course.organization_id !== organizationId) || (programId && course.program_id !== programId)) throw new SmsError(404, 'COURSE_NOT_FOUND', 'This course was not found in the selected organization and program.');
  const total = numbers(totals.results[0]);
  const result: CourseAttendanceData = {
    course: { ...courseIdentity(course), status: course.status as CourseAttendanceData['course']['status'] },
    points: rows.results.reverse().map(row => ({ id: String(row.id), sequence: Number(row.sequence), receivedAt: String(row.received_at), processedAt: String(row.processed_at),
      repeatedFromRecordId: row.repeated_from_record_id as string | null, attendees: Number(row.attendees), sessionMinutes: Number(row.session_minutes), participantMinutes: Number(row.attendees) * Number(row.session_minutes), courseSnapshot: JSON.parse(String(row.course_snapshot_json)) as CourseIdentity })),
    participantEstimate: programParticipantEstimate({ sessions: total.sessions, hasReversedHistory:Boolean(totals.results[0]?.has_reversed_history), maximumAttendance: totals.results[0]?.maximum_attendance == null ? null : Number(totals.results[0].maximum_attendance) }, course.participants == null ? null : Number(course.participants)),
    totals: total, generatedAt: new Date().toISOString(), truncated: total.sessions > COURSE_ATTENDANCE_LIMIT, sequenceBasis: 'receipt-order',
  };
  return json(result);
}

async function adminData(db: D1Database, env: SmsRuntime): Promise<Response> {
  const organizations = await db.prepare(ORG_SELECT + ' GROUP BY o.id ORDER BY o.name').all<Record<string, unknown>>();
  const programs = await db.prepare(PROGRAM_SELECT + ' ORDER BY p.name').all<Record<string, unknown>>();
  const teachers = await db.prepare('SELECT t.*,p.organization_id FROM sms_teachers t JOIN sms_programs p ON p.id=t.program_id ORDER BY t.name').all<Record<string, unknown>>();
  const courses = await db.prepare('SELECT c.id,c.organization_id,c.program_id,o.name organization_name,p.name program_name,c.facility,c.yard,c.start_date,c.end_date,c.status FROM course_summaries c JOIN sms_organizations o ON o.id=c.organization_id JOIN sms_programs p ON p.id=c.program_id AND p.organization_id=c.organization_id ORDER BY c.updated_at DESC,c.id').all<Record<string, unknown>>();
  const records = await db.prepare(`SELECT r.*,x.command_record_id reversed_by_record_id,x.created_at reversed_at,z.target_record_id reversal_target_id,q.id business_request_id,q.status business_request_status,
    EXISTS(SELECT 1 FROM business_manager_grants m JOIN sms_organizations o ON o.id=m.organization_id WHERE m.phone=r.sender_phone AND m.active=1 AND o.active=1 AND (r.organization_id IS NULL OR r.organization_id=m.organization_id)) can_import_scope
    FROM sms_records r LEFT JOIN sms_reversals x ON x.target_record_id=r.id LEFT JOIN sms_reversals z ON z.command_record_id=r.id LEFT JOIN business_requests q ON q.receipt_id=r.id ORDER BY r.received_at DESC,r.id DESC LIMIT 50`).all<Record<string, unknown>>();
  const stats = await db.prepare(`SELECT COALESCE(SUM(status='counted' AND NOT EXISTS(SELECT 1 FROM sms_reversals x WHERE x.target_record_id=sms_records.id)),0) counted,COALESCE(SUM(status='quarantined' AND reason<>'REVERSAL_APPLIED'),0) quarantined,(SELECT COUNT(*) FROM sms_reversals) reversed FROM sms_records`).first();
  return json({ organizations: organizations.results.map(organizationView), programs: programs.results.map(programView), teachers: teachers.results.map(r => ({ id: r.id, name: r.name, phone: r.phone, programId: r.program_id, courseId: r.course_id ?? null, organizationId: r.organization_id, active: Boolean(r.active), createdAt: r.created_at })),
    courses: courses.results.map(r => ({ ...courseIdentity(r), status: r.status })),
    records: records.results.map(r => ({ id: r.id, messageSid: r.message_sid, senderPhone: r.sender_phone, body: r.body, status: r.reversed_by_record_id ? 'reversed' : r.reversal_target_id ? 'reversal' : r.status, reversedByRecordId:r.reversed_by_record_id ?? null, reversedAt:r.reversed_at ?? null, reversalTargetId:r.reversal_target_id ?? null, reason: r.reason, courseId: r.course_id ?? null, organizationName: r.organization_name, programName: r.program_name, attendees: r.attendees, sessionMinutes: r.session_minutes, receivedAt: r.received_at, reprocessedBy: r.reprocessed_by, processedAt: r.processed_at, repeatedFromRecordId: r.repeated_from_record_id ?? null, acceptedOrder: r.accepted_order ?? null, manualCorrection: r.manual_correction_json ? JSON.parse(String(r.manual_correction_json)) : null, businessRequestId: r.business_request_id ?? null, businessRequestStatus: r.business_request_status ?? null, canImportBusinessRequest: !r.business_request_id && Boolean(r.can_import_scope) && r.status === 'quarantined' && r.reason === 'INVALID_BODY' && isBusinessRequestText(String(r.body)), canCorrect: !r.business_request_id && r.status === 'quarantined' && ['INVALID_BODY', 'REPEAT_BASELINE_REQUIRED'].includes(String(r.reason)) && Boolean(r.teacher_id && r.organization_id && r.program_id) && !r.repeated_from_record_id })), stats, inboundNumber: env.TWILIO_PHONE_NUMBER ?? null, webhookConfigured: webhookConfigured(env) });
}

// Course maintenance needs names and stable relationships, not the SMS admin
// payload. Keep both the SELECT list and response allowlist deliberately narrow.
async function courseMetadata(db: D1Database, url: URL): Promise<Response> {
  if ([...url.searchParams.keys()].some(key => key !== 'organizationId') || url.searchParams.getAll('organizationId').length > 1) throw new SmsError(400, 'INVALID_QUERY', 'Choose one organization filter.');
  const organizationId = url.searchParams.has('organizationId') ? idField(url.searchParams.get('organizationId')) : null;
  if (organizationId && !await db.prepare('SELECT id FROM sms_organizations WHERE id=?').bind(organizationId).first()) throw new SmsError(404, 'ORGANIZATION_NOT_FOUND', 'This organization was not found.');
  const organizations = await db.prepare('SELECT id,name,active FROM sms_organizations ORDER BY name,id').all<Record<string, unknown>>();
  const programs = await db.prepare('SELECT id,organization_id,name,active FROM sms_programs' + (organizationId ? ' WHERE organization_id=?' : '') + ' ORDER BY name,id').bind(...(organizationId ? [organizationId] : [])).all<Record<string, unknown>>();
  return json({
    organizations: organizations.results.map(row => ({ id: row.id, name: row.name, active: Boolean(row.active) })),
    programs: programs.results.map(row => ({ id: row.id, organizationId: row.organization_id, name: row.name, active: Boolean(row.active) })),
  });
}
async function mutateCourseMetadata(db: D1Database, body: Record<string, unknown>): Promise<Response> {
  const now = new Date().toISOString();
  if (body.action === 'organization') {
    only(body, ['action', 'id', 'createId', 'name']);
    if (body.id !== undefined && body.createId !== undefined) throw new SmsError(400, 'INVALID_ID', 'Use either an existing record ID or a new create ID, not both.');
    const id = body.id !== undefined ? idField(body.id) : body.createId !== undefined ? idField(body.createId) : crypto.randomUUID(); const name = nameField(body.name);
    if (body.id !== undefined) {
      // Do not pass this through general admin mutation: omitted active there
      // defaults to true. A rename must preserve active, slug and SMS attribution.
      const result = await db.prepare('UPDATE sms_organizations SET name=?,updated_at=? WHERE id=?').bind(name, now, id).run();
      if (!result.meta.changes) throw new SmsError(404, 'NOT_FOUND', 'Organization not found.');
    } else {
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,47) || 'organization'}-${id.replaceAll('-', '')}`;
      // The draft's create ID survives an uncertain network response. Replays
      // insert nothing and must match; they never overwrite a later rename.
      const result = await db.prepare('INSERT INTO sms_organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, name, slug, now, now).run();
      if (!result.meta.changes) {
        const existing = await db.prepare('SELECT name FROM sms_organizations WHERE id=?').bind(id).first<{ name: string }>();
        if (!existing || existing.name !== name) throw new SmsError(409, 'CREATE_CONFLICT', 'This create ID is already used for different organization details. Refresh before trying again.');
        return json({ ok: true, id });
      }
    }
    return json({ ok: true, id }, body.id === undefined ? 201 : 200);
  }
  if (body.action === 'program') {
    only(body, ['action', 'id', 'createId', 'organizationId', 'name']);
    if (body.id !== undefined && body.createId !== undefined) throw new SmsError(400, 'INVALID_ID', 'Use either an existing record ID or a new create ID, not both.');
    const id = body.id !== undefined ? idField(body.id) : body.createId !== undefined ? idField(body.createId) : crypto.randomUUID(); const organizationId = idField(body.organizationId); const name = nameField(body.name);
    if (!await db.prepare('SELECT id FROM sms_organizations WHERE id=?').bind(organizationId).first()) throw new SmsError(400, 'ORGANIZATION_REQUIRED', 'Choose an existing organization.');
    if (body.id !== undefined) {
      const existing = await db.prepare('SELECT organization_id FROM sms_programs WHERE id=?').bind(id).first<{ organization_id: string }>();
      if (!existing) throw new SmsError(404, 'NOT_FOUND', 'Program not found.');
      if (existing.organization_id !== organizationId) throw new SmsError(409, 'PROGRAM_ORGANIZATION_FIXED', 'A program stays with its organization. Create a new program in the other organization.');
      const result = await db.prepare('UPDATE sms_programs SET name=?,updated_at=? WHERE id=? AND organization_id=?').bind(name, now, id, organizationId).run();
      if (!result.meta.changes) throw new SmsError(404, 'NOT_FOUND', 'Program not found.');
    } else {
      const result = await db.prepare('INSERT INTO sms_programs(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, organizationId, name, now, now).run();
      if (!result.meta.changes) {
        const existing = await db.prepare('SELECT name,organization_id FROM sms_programs WHERE id=?').bind(id).first<{ name: string; organization_id: string }>();
        if (!existing || existing.name !== name || existing.organization_id !== organizationId) throw new SmsError(409, 'CREATE_CONFLICT', 'This create ID is already used for different program details. Refresh before trying again.');
        return json({ ok: true, id });
      }
    }
    return json({ ok: true, id }, body.id === undefined ? 201 : 200);
  }
  throw new SmsError(400, 'INVALID_ACTION', 'Choose an organization or program name to maintain.');
}
async function mutate(db: D1Database, body: Record<string, unknown>, userId: string): Promise<Response> {
  const now = new Date().toISOString();
  if (body.action === 'correct') {
    only(body, ['action', 'id', 'attendees', 'hours', 'reason']);
    const id = idField(body.id);
    if (typeof body.attendees !== 'number' || typeof body.hours !== 'number') throw new SmsError(400, 'INVALID_METRICS', 'Enter numeric attendees and session hours.');
    const parsed = parseSms(`${body.attendees} ${body.hours}`);
    if (!parsed.ok) throw new SmsError(400, 'INVALID_METRICS', parsed.reason);
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500 || /[\x00-\x1f\x7f]/.test(body.reason)) throw new SmsError(400, 'CORRECTION_REASON_REQUIRED', 'Provide a correction reason of 1–500 characters without control characters.');
    const reason = body.reason.trim();
    const record = await db.prepare('SELECT * FROM sms_records WHERE id=?').bind(id).first<Record<string, unknown>>();
    if (!record) throw new SmsError(404, 'NOT_FOUND', 'SMS record not found.');
    const sameCorrection = (row: Record<string, unknown>) => {
      if (!row.manual_correction_json) return false;
      const saved = JSON.parse(String(row.manual_correction_json));
      return saved.attendees === parsed.metrics.attendees && saved.sessionMinutes === parsed.metrics.sessionMinutes && saved.reason === reason;
    };
    if (record.status === 'counted') {
      if (sameCorrection(record)) return json({ ok: true, alreadyCounted: true });
      throw new SmsError(409, 'ALREADY_COUNTED', 'This SMS has already been counted and cannot be rewritten.');
    }
    if (await db.prepare('SELECT id FROM business_requests WHERE receipt_id=?').bind(id).first()) throw new SmsError(409, 'BUSINESS_REQUEST_EXISTS', 'This SMS is a business request, not an attendance correction.');
    if (!['INVALID_BODY', 'REPEAT_BASELINE_REQUIRED'].includes(String(record.reason)) || !record.teacher_id || !record.organization_id || !record.program_id || record.repeated_from_record_id)
      throw new SmsError(409, 'CORRECTION_NOT_ELIGIBLE', 'Correct only an unresolved quarantine with an original known sender and program. Resolved repeats keep their pinned values; use Retry instead.');
    const correction = JSON.stringify({ source: 'manual', correctedBy: userId, correctedAt: now, reason, originalReason: record.reason,
      attendees: parsed.metrics.attendees, sessionMinutes: parsed.metrics.sessionMinutes });
    // Preserve ALL original attribution, raw body, provider SID and receipt time.
    // A guarded transition plus existing triggers counts a correction exactly once.
    const result = await db.prepare(`UPDATE sms_records SET attendees=?,session_minutes=?,status='counted',reason=NULL,
      processed_at=?,reprocessed_by=?,manual_correction_json=?,accepted_order=(SELECT COALESCE(MAX(accepted_order),0)+1 FROM sms_records)
      WHERE id=? AND NOT EXISTS(SELECT 1 FROM business_requests WHERE receipt_id=sms_records.id) AND status='quarantined' AND reason IN ('INVALID_BODY','REPEAT_BASELINE_REQUIRED') AND repeated_from_record_id IS NULL AND manual_correction_json IS NULL
        AND EXISTS (SELECT 1 FROM sms_teachers t JOIN sms_programs p ON p.id=sms_records.program_id
          JOIN sms_organizations o ON o.id=sms_records.organization_id AND p.organization_id=o.id
          WHERE t.id=sms_records.teacher_id AND t.active=1 AND p.active=1 AND o.active=1)
        AND (course_id IS NULL OR EXISTS (SELECT 1 FROM course_summaries c WHERE c.id=sms_records.course_id
          AND c.organization_id=sms_records.organization_id AND c.program_id=sms_records.program_id))`)
      .bind(parsed.metrics.attendees, parsed.metrics.sessionMinutes, now, userId, correction, id).run();
    if (!result.meta.changes) {
      const current = await db.prepare('SELECT * FROM sms_records WHERE id=?').bind(id).first<Record<string, unknown>>();
      if (current?.status === 'counted' && sameCorrection(current)) return json({ ok: true, alreadyCounted: true });
      throw new SmsError(409, 'CORRECTION_NOT_ELIGIBLE', 'The record changed or its original sender, program, organization or course is not eligible. Refresh before correcting it.');
    }
    return json({ ok: true });
  }
  if (body.action === 'retry') {
    only(body, ['action', 'id']); const id = idField(body.id);
    const record = await db.prepare('SELECT * FROM sms_records WHERE id=?').bind(id).first<Record<string, unknown>>();
    if (!record) throw new SmsError(404, 'NOT_FOUND', 'SMS record not found.');
    if (record.status === 'counted') return json({ ok: true, alreadyCounted: true });
    if (parseSmsReversal(String(record.body)).ok) throw new SmsError(409, 'NEW_REVERSAL_REQUIRED', 'Send a new reversal command; historical reversal requests are never replayed.');
    if (parseSmsCommand(String(record.body)).ok && String(record.body).trim() === '1' && !record.repeated_from_record_id)
      throw new SmsError(409, 'REPEAT_BASELINE_REQUIRED', 'This repeat had no valid baseline when received. Send attendees and hours for the current course, then send a new 1. Historical repeats are never backfilled.');
    if (!['UNKNOWN_SENDER', 'INACTIVE_SENDER', 'INVALID_COURSE'].includes(String(record.reason))) throw new SmsError(409, 'INVALID_BODY', 'Ask the teacher to send a new SMS in the correct format. The original message cannot be edited.');
    const parsed = parseSmsCommand(String(record.body));
    if (!parsed.ok) throw new SmsError(409, 'INVALID_BODY', 'The original message cannot be counted. Ask the teacher to resend it correctly.');
    // A quarantined repeat may only use the source and values frozen at receipt.
    // Never look up today's latest baseline while recovering an older message.
    const metrics = parsed.kind === 'numeric' ? parsed.metrics : { attendees: Number(record.attendees), sessionMinutes: Number(record.session_minutes) };
    // The WHERE guard makes repeated or concurrent admin retries count exactly once.
    // Snapshot mapping inside the same SQL statement, not in a separate earlier read.
    const result = await db.prepare(`WITH eligible AS (
      SELECT r.id,COALESCE(r.teacher_id,t.id) teacher_id,o.id organization_id,p.id program_id,
        COALESCE(r.organization_name,o.name) organization_name,COALESCE(r.program_name,p.name) program_name,
        CASE WHEN r.course_id IS NULL THEN NULL ELSE COALESCE(r.course_snapshot_json,
          json_object('id',c.id,'organizationId',o.id,'programId',p.id,'organizationName',COALESCE(r.organization_name,o.name),
          'programName',COALESCE(r.program_name,p.name),'facility',c.facility,'yard',c.yard,'startDate',c.start_date,'endDate',c.end_date)) END course_snapshot_json
      FROM sms_records r JOIN sms_teachers t ON
        ((r.teacher_id IS NOT NULL AND t.id=r.teacher_id) OR (r.teacher_id IS NULL AND t.phone=r.sender_phone))
      JOIN sms_programs p ON p.id=COALESCE(r.program_id,t.program_id) JOIN sms_organizations o ON o.id=p.organization_id
      LEFT JOIN course_summaries c ON c.id=r.course_id
      WHERE r.id=? AND r.status='quarantined' AND t.active=1 AND p.active=1 AND o.active=1
        AND (r.course_id IS NULL OR (c.id IS NOT NULL AND c.program_id=p.id AND c.organization_id=o.id))
        AND (r.teacher_id IS NOT NULL OR t.course_id IS NULL OR EXISTS (SELECT 1 FROM course_summaries current_course
          WHERE current_course.id=t.course_id AND current_course.program_id=p.id AND current_course.organization_id=o.id))
    ) UPDATE sms_records SET teacher_id=e.teacher_id,organization_id=e.organization_id,program_id=e.program_id,
      organization_name=e.organization_name,program_name=e.program_name,course_snapshot_json=e.course_snapshot_json,
      attendees=?,session_minutes=?,status='counted',reason=NULL,processed_at=?,reprocessed_by=?,
      accepted_order=(SELECT COALESCE(MAX(accepted_order),0)+1 FROM sms_records)
      FROM eligible e WHERE sms_records.id=e.id AND sms_records.status='quarantined'`)
      .bind(id, metrics.attendees, metrics.sessionMinutes, now, userId).run();
    if (!result.meta.changes && await db.prepare("SELECT id FROM sms_records WHERE id=? AND status='counted'").bind(id).first()) return json({ ok: true, alreadyCounted: true });
    if (!result.meta.changes) throw new SmsError(409, 'SENDER_NOT_ACTIVE', 'Activate the original sender mapping and its organization/program, and repair the original course if assigned, before retrying. Unassigned history stays unassigned.');
    return json({ ok: true });
  }
  if (body.action === 'organization') {
    only(body, ['action', 'id', 'name', 'slug', 'active']);
    const id = body.id === undefined ? crypto.randomUUID() : idField(body.id); const name = nameField(body.name); const active = activeField(body.active);
    let slug: string;
    if (body.slug !== undefined) { if (typeof body.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(body.slug)) throw new SmsError(400, 'INVALID_SLUG', 'Use a short lowercase URL label with letters, numbers, and hyphens.'); slug = body.slug; }
    else { const existing = body.id ? await db.prepare('SELECT slug FROM sms_organizations WHERE id=?').bind(id).first<{ slug: string }>() : null; slug = existing?.slug ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,60) || 'organization'}-${id.slice(0,8)}`; }
    const conflict = await db.prepare('SELECT id FROM sms_organizations WHERE slug=? AND id<>?').bind(slug, id).first();
    if (conflict) throw new SmsError(409, 'DUPLICATE_SLUG', 'That organization URL label is already in use.');
    if (body.id) { const result = await db.prepare('UPDATE sms_organizations SET name=?,slug=?,active=?,updated_at=? WHERE id=?').bind(name, slug, active, now, id).run(); if (!result.meta.changes) throw new SmsError(404, 'NOT_FOUND', 'Organization not found.'); }
    else await db.prepare('INSERT INTO sms_organizations(id,name,slug,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, name, slug, active, now, now).run();
    return json({ ok: true, id }, body.id ? 200 : 201);
  }
  if (body.action === 'program') {
    only(body, ['action', 'id', 'organizationId', 'name', 'active']);
    const id = body.id === undefined ? crypto.randomUUID() : idField(body.id); const organizationId = idField(body.organizationId); const name = nameField(body.name); const active = activeField(body.active);
    const org = await db.prepare('SELECT id FROM sms_organizations WHERE id=?').bind(organizationId).first();
    if (!org) throw new SmsError(400, 'ORGANIZATION_REQUIRED', 'Choose an existing organization.');
    if (body.id) {
      const existing = await db.prepare('SELECT organization_id FROM sms_programs WHERE id=?').bind(id).first<{ organization_id: string }>();
      if (!existing) throw new SmsError(404, 'NOT_FOUND', 'Program not found.');
      // Keep organizational attribution stable. Create a new program to move work.
      if (existing.organization_id !== organizationId) throw new SmsError(409, 'PROGRAM_ORGANIZATION_FIXED', 'A program stays with its organization. Create a new program in the other organization, then update teacher bindings.');
      await db.prepare('UPDATE sms_programs SET name=?,active=?,updated_at=? WHERE id=?').bind(name, active, now, id).run();
    } else await db.prepare('INSERT INTO sms_programs(id,organization_id,name,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, organizationId, name, active, now, now).run();
    return json({ ok: true, id }, body.id ? 200 : 201);
  }
  if (body.action === 'teacher') {
    only(body, ['action', 'id', 'name', 'phone', 'programId', 'courseId', 'active']);
    const id = body.id === undefined ? crypto.randomUUID() : idField(body.id); const programId = idField(body.programId); const name = nameField(body.name); const active = activeField(body.active);
    if (typeof body.phone !== 'string' || !isE164(body.phone.trim())) throw new SmsError(400, 'INVALID_PHONE', 'Use an international phone number, for example +14155550123.');
    const phone = body.phone.trim();
    const program = await db.prepare('SELECT p.id,p.organization_id,p.active,o.active organization_active FROM sms_programs p JOIN sms_organizations o ON o.id=p.organization_id WHERE p.id=?').bind(programId).first<Record<string, unknown>>();
    if (!program) throw new SmsError(400, 'PROGRAM_REQUIRED', 'Choose an existing program.');
    const existing = body.id ? await db.prepare('SELECT course_id,program_id FROM sms_teachers WHERE id=?').bind(id).first<Record<string, unknown>>() : null;
    if (body.id && !existing) throw new SmsError(404, 'NOT_FOUND', 'Teacher binding not found.');
    // Omission preserves existing bindings; null is an explicit unbind. Old clients
    // cannot silently strip a course or move it to a different program.
    const courseId = body.courseId === undefined ? existing?.course_id ?? null : body.courseId === null ? null : idField(body.courseId);
    if (courseId !== null) {
      if (!await db.prepare('SELECT id FROM course_summaries WHERE id=? AND organization_id=? AND program_id=?').bind(courseId, program.organization_id, programId).first()) throw new SmsError(409, 'INVALID_COURSE', 'Choose a saved course in this program and organization, or explicitly select program-only.');
      if (active && (!program.active || !program.organization_active)) throw new SmsError(409, 'INACTIVE_COURSE_MAPPING', 'Activate the organization and program before enabling this course phone binding.');
    }
    if (await db.prepare('SELECT id FROM sms_teachers WHERE phone=? AND id<>?').bind(phone, id).first()) throw new SmsError(409, 'PHONE_ALREADY_BOUND', 'This phone already has one organization/program/course binding. Edit that binding instead.');
    if (body.id) { const result = await db.prepare('UPDATE sms_teachers SET name=?,phone=?,program_id=?,course_id=?,active=?,updated_at=? WHERE id=?').bind(name, phone, programId, courseId, active, now, id).run(); if (!result.meta.changes) throw new SmsError(404, 'NOT_FOUND', 'Teacher binding not found.'); }
    else await db.prepare('INSERT INTO sms_teachers(id,name,phone,program_id,course_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, name, phone, programId, courseId, active, now, now).run();
    return json({ ok: true, id }, body.id ? 200 : 201);
  }
  throw new SmsError(400, 'INVALID_ACTION', 'Choose an organization, program, teacher binding, retry, or correction action.');
}

export async function handleSmsApi(request: Request, env: SmsRuntime, background?: (promise: Promise<unknown>) => void): Promise<Response> {
  try {
    const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '');
    if (path === INBOUND) return await receiveSms(request, env, background);
    if (path === '/api/sms/session' && request.method === 'GET') {
      const user = identity(request); const authorized = Boolean(user && adminIds(env).includes(user));
      return json({ authenticated: Boolean(user), authorized, configured: adminIds(env).length > 0, webhookConfigured: authorized && webhookConfigured(env), inboundNumber: authorized ? env.TWILIO_PHONE_NUMBER ?? null : null, signInUrl: '/signin-with-chatgpt?return_to=%2Fsms' });
    }
    const userId = requireAdmin(request, env);
    if (!env.DB) throw new SmsError(503, 'STORAGE_UNAVAILABLE', 'SMS storage is unavailable.');
    if (path === '/api/sms/defy-activity') {
      if (request.method !== 'POST') throw new SmsError(405, 'METHOD_NOT_ALLOWED', 'Use POST to populate Defy activity.');
      requireOrigin(request); const body=await readJson(request); only(body,['action']);
      if(body.action!=='populate-defy') throw new SmsError(400,'INVALID_ACTION','Choose populate-defy.');
      return json(await seedDefyActivity(env.DB,userId));
    }
    if (path === '/api/sms/center-collection') {
      if (request.method !== 'POST') throw new SmsError(405, 'METHOD_NOT_ALLOWED', 'Use POST to populate the center collection.');
      requireOrigin(request);
      const body = await readJson(request); only(body, ['action']);
      if (body.action !== 'populate-centers') throw new SmsError(400, 'INVALID_ACTION', 'Choose populate-centers.');
      return json(await seedCenterCollection(env.DB, userId));
    }
    if (path === '/api/sms/business-admin') {
      if (request.method === 'GET') return json(await businessAdminData(env.DB,userId,request.headers.get('oai-authenticated-user-email') || userId));
      if (request.method === 'POST') { requireOrigin(request); return json(await mutateBusinessAdmin(env.DB,await readJson(request),userId)); }
      throw new SmsError(405,'METHOD_NOT_ALLOWED','Use GET or POST for business permissions.');
    }
    if (path === '/api/sms/course-metadata') {
      if (request.method === 'GET') return await courseMetadata(env.DB, url);
      if (request.method === 'POST') { requireOrigin(request); return await mutateCourseMetadata(env.DB, await readJson(request)); }
      throw new SmsError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for course metadata.');
    }
    if (path === '/api/sms/summaries') { if (request.method === 'POST') requireOrigin(request); return await handleCourseSummaries(request, env.DB); }
    if (path === '/api/sms/course-attendance') { if (request.method !== 'GET') throw new SmsError(405, 'METHOD_NOT_ALLOWED', 'Use GET for course attendance.'); return await courseAttendance(env.DB, url); }
    if (path === '/api/sms/report' && request.method === 'GET') return await handleSmsReport(env.DB, url);
    if (path === '/api/sms/dashboard' && request.method === 'GET') return await dashboard(env.DB, url);
    if (path === '/api/sms/admin' && request.method === 'GET') return await adminData(env.DB, env);
    if (path === '/api/sms/admin' && request.method === 'POST') { requireOrigin(request); return await mutate(env.DB, await readJson(request), userId); }
    throw new SmsError(404, 'NOT_FOUND', 'SMS endpoint not found.');
  } catch (error) {
    if (error instanceof SmsError || error instanceof BusinessAgentError) return json({ code: error.code, error: error.message }, error.status);
    // Do not log raw messages, phone numbers, signatures, credentials, or SQL errors.
    return json({ code: 'INTERNAL_ERROR', error: 'The SMS request could not be completed. Retry later; a stored message will not be counted twice.' }, 500);
  }
}
