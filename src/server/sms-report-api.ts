import { activityBuckets, parseReportSelection, periodMetrics, shiftDate, daysBetween, type ReportDay, type SmsReport } from '../lib/sms-report';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store, max-age=0', 'vary': 'Cookie, oai-authenticated-user-id', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
/** Called only after the shared SMS administrator gate. No ledger or configuration writes. */
export async function handleSmsReport(db: D1Database, url: URL, now = new Date()): Promise<Response> {
  const parsed = parseReportSelection(url.searchParams, now);
  if (!parsed.ok) return new Response(JSON.stringify({ code: 'INVALID_REPORT_FILTER', error: parsed.error }), { status: 400, headers });
  const selection = parsed.selection; const { start, end, organizationId, programId } = selection;
  const previousEnd = shiftDate(start, -1); const previousStart = shiftDate(start, -daysBetween(start, end));
  const scope = (organizationId ? ' AND r.organization_id=?' : '') + (programId ? ' AND r.program_id=?' : '');
  const bindings = [...(organizationId ? [organizationId] : []), ...(programId ? [programId] : [])];
  const [organizations, programs, daily, coverage, activity] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id,name,active FROM sms_organizations ORDER BY name'),
    db.prepare('SELECT id,name,active,organization_id FROM sms_programs ORDER BY name'),
    db.prepare(`SELECT substr(r.received_at,1,10) date, COUNT(*) sessions, SUM(r.attendees) attendees, SUM(r.session_minutes) session_minutes, SUM(r.attendees*r.session_minutes) participant_minutes FROM sms_records r WHERE r.status='counted' AND r.received_at>=? AND r.received_at<?${scope} GROUP BY substr(r.received_at,1,10) ORDER BY date`).bind(previousStart + 'T00:00:00.000Z', shiftDate(end, 1) + 'T00:00:00.000Z', ...bindings),
    db.prepare(`SELECT substr(MIN(r.received_at),1,10) first_date,substr(MAX(r.received_at),1,10) last_date FROM sms_records r WHERE r.status='counted'${scope}`).bind(...bindings),
    db.prepare(`SELECT r.program_id id,p.name,o.name organization_name,COUNT(*) sessions,SUM(r.attendees) attendees,SUM(r.session_minutes) session_minutes,SUM(r.attendees*r.session_minutes) participant_minutes FROM sms_records r JOIN sms_programs p ON p.id=r.program_id JOIN sms_organizations o ON o.id=r.organization_id WHERE r.status='counted' AND r.received_at>=? AND r.received_at<?${scope} GROUP BY r.program_id,p.name,o.name ORDER BY participant_minutes DESC,p.name`).bind(start + 'T00:00:00.000Z', shiftDate(end, 1) + 'T00:00:00.000Z', ...bindings),
  ]);
  const org = organizationId ? organizations.results.find(row => row.id === organizationId) : null;
  const program = programId ? programs.results.find(row => row.id === programId) : null;
  if ((organizationId && !org) || (programId && !program) || (org && program && program.organization_id !== org.id)) return new Response(JSON.stringify({ code: 'INVALID_REPORT_SCOPE', error: 'Choose an existing organization and a program that belongs to it.' }), { status: 400, headers });
  const totals = (r: Record<string, unknown>) => ({ sessions: Number(r.sessions ?? 0), attendees: Number(r.attendees ?? 0), sessionMinutes: Number(r.session_minutes ?? 0), participantMinutes: Number(r.participant_minutes ?? 0) });
  const days: ReportDay[] = daily.results.map(row => ({ date: String(row.date), ...totals(row) }));
  const report: SmsReport = {
    generatedAt: now.toISOString(), source: 'live-sms', selection, subject: program ? String(program.name) + ' · ' + String(organizations.results.find(row => row.id === program.organization_id)?.name ?? '') : org ? String(org.name) : 'TPW partner network',
    organizations: organizations.results.map(row => ({ id: String(row.id), name: String(row.name), active: Boolean(row.active) })),
    programs: programs.results.map(row => ({ id: String(row.id), name: String(row.name), active: Boolean(row.active), organizationId: String(row.organization_id) })),
    current: periodMetrics(days, start, end), previous: periodMetrics(days, previousStart, previousEnd), buckets: activityBuckets(days, start, end, selection.group),
    programActivity: activity.results.map(row => ({ id: String(row.id), name: String(row.name), organizationName: String(row.organization_name), ...totals(row) })),
    coverage: { firstRecordedDate: coverage.results[0]?.first_date as string | null ?? null, lastRecordedDate: coverage.results[0]?.last_date as string | null ?? null, completeness: 'unknown' },
  };
  return new Response(JSON.stringify(report), { headers });
}
