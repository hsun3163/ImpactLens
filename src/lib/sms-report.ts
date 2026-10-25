/** Recorded activity only. SMS receipt dates are not verified session dates. */
export type ReportGroup = 'week' | 'month';
export type ReportTotals = { sessions: number; attendees: number; sessionMinutes: number; participantMinutes: number };
export type ReportSelection = { start: string; end: string; group: ReportGroup; organizationId: string | null; programId: string | null };
export type ReportDay = ReportTotals & { date: string };
export type ReportPeriod = ReportTotals & { start: string; end: string; days: number; activeDays: number; activeWeeks: number; averageAttendance: number | null };
export type ReportBucket = ReportTotals & { start: string; end: string; label: string; partial: boolean };
export type ReportOrganization = { id: string; name: string; active: boolean };
export type ReportProgram = ReportOrganization & { organizationId: string };
export type SmsReport = {
  generatedAt: string; source: 'live-sms' | 'synthetic-demo'; selection: ReportSelection;
  subject: string; organizations: ReportOrganization[]; programs: ReportProgram[];
  current: ReportPeriod; previous: ReportPeriod; buckets: ReportBucket[];
  programActivity: (ReportTotals & { id: string; name: string; organizationName: string })[];
  coverage: { firstRecordedDate: string | null; lastRecordedDate: string | null; completeness: 'unknown' };
};
export const REPORT_METHOD = 'Source: accepted SMS check-ins, grouped by receipt date in UTC, not verified class dates. Participant visits include repeat attendance and are not unique people. Participant-hours = attendance × reported session duration, assuming everyone attended the full session. Weeks without check-ins mean no records, not no service. Reporting completeness is unknown; period differences may reflect reporting changes. Course summaries are separate and excluded. This describes recorded activity, not retention, adherence, outcomes, or causal impact.';
const DAY = 86400000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function shiftDate(date: string, days: number): string { return new Date(Date.parse(date + 'T00:00:00.000Z') + days * DAY).toISOString().slice(0, 10); }
export function daysBetween(start: string, end: string): number { return Math.round((Date.parse(end + 'T00:00:00.000Z') - Date.parse(start + 'T00:00:00.000Z')) / DAY) + 1; }
export function weekStart(date: string): string { const day = new Date(date + 'T00:00:00.000Z').getUTCDay(); return shiftDate(date, -((day + 6) % 7)); }
export function formatReportDate(date: string): string { return new Date(date + 'T00:00:00.000Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
export function parseReportSelection(params: URLSearchParams, now = new Date()): { ok: true; selection: ReportSelection } | { ok: false; error: string } {
  const allowed = ['start', 'end', 'group', 'organizationId', 'programId'];
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) return { ok: false, error: 'Use one value for each supported report filter.' };
  const today = now.toISOString().slice(0, 10);
  const start = params.get('start') ?? today.slice(0, 7) + '-01'; const end = params.get('end') ?? today;
  if (!validReportDate(start) || !validReportDate(end) || end < start || end > today || daysBetween(start, end) > 366) return { ok: false, error: 'Choose a valid date range of up to 366 days, ending no later than today (UTC).' };
  const group = params.get('group') ?? 'week';
  if (group !== 'week' && group !== 'month') return { ok: false, error: 'Choose weekly or monthly activity.' };
  const organizationId = params.get('organizationId') || null; const programId = params.get('programId') || null;
  if ((organizationId && !ID.test(organizationId)) || (programId && !ID.test(programId))) return { ok: false, error: 'Choose a valid organization and program.' };
  return { ok: true, selection: { start, end, group, organizationId, programId } };
}
export const emptyTotals = (): ReportTotals => ({ sessions: 0, attendees: 0, sessionMinutes: 0, participantMinutes: 0 });
export function sumTotals(rows: ReportTotals[]): ReportTotals { return rows.reduce((sum, row) => ({ sessions: sum.sessions + row.sessions, attendees: sum.attendees + row.attendees, sessionMinutes: sum.sessionMinutes + row.sessionMinutes, participantMinutes: sum.participantMinutes + row.participantMinutes }), emptyTotals()); }
export function periodMetrics(rows: ReportDay[], start: string, end: string): ReportPeriod {
  const selected = rows.filter(row => row.date >= start && row.date <= end); const totals = sumTotals(selected);
  return { ...totals, start, end, days: daysBetween(start, end), activeDays: new Set(selected.filter(row => row.sessions > 0).map(row => row.date)).size, activeWeeks: new Set(selected.filter(row => row.sessions > 0).map(row => weekStart(row.date))).size, averageAttendance: totals.sessions ? totals.attendees / totals.sessions : null };
}
export function activityBuckets(rows: ReportDay[], start: string, end: string, group: ReportGroup): ReportBucket[] {
  const buckets: ReportBucket[] = [];
  let cursor = group === 'week' ? weekStart(start) : start.slice(0, 7) + '-01';
  while (cursor <= end) {
    const next = group === 'week' ? shiftDate(cursor, 7) : new Date(Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const fullEnd = shiftDate(next, -1); const clippedStart = cursor < start ? start : cursor; const clippedEnd = fullEnd > end ? end : fullEnd;
    buckets.push({ ...sumTotals(rows.filter(row => row.date >= clippedStart && row.date <= clippedEnd)), start: clippedStart, end: clippedEnd, label: group === 'week' ? 'Week of ' + formatReportDate(cursor) : new Date(cursor + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), partial: clippedStart !== cursor || clippedEnd !== fullEnd });
    cursor = next;
  }
  return buckets;
}
const number = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
export function recordedComparison(report: SmsReport): string {
  const { current: c, previous: p } = report;
  if (!c.sessions) return 'No accepted check-ins in this period. There is not enough recorded activity for a comparison.';
  if (!p.sessions) return 'No accepted check-ins in the prior period. A percentage comparison is not available.';
  if (p.participantMinutes === 0 && c.participantMinutes > 0) return `The prior ${p.days}-day period recorded 0 participant-hours. A percentage comparison is not available; this period recorded ${number(c.participantMinutes / 60)} participant-hours.`;
  const change = c.participantMinutes - p.participantMinutes;
  return `Recorded participant-hours were ${change === 0 ? 'unchanged' : `${number(Math.abs(change / p.participantMinutes * 100))}% ${change > 0 ? 'higher' : 'lower'}`} than the preceding ${p.days}-day period (${formatReportDate(p.start)}–${formatReportDate(p.end)}).`;
}
export function fundingStory(report: SmsReport): { title: string; paragraphs: string[]; text: string } {
  const { current: c } = report;
  const title = `${report.subject} · Recorded activity brief`;
  const label = report.source === 'synthetic-demo' ? 'SYNTHETIC DEMO · Not real organizational activity' : 'ACCEPTED SMS CHECK-INS · Aggregate activity';
  const range = `${formatReportDate(c.start)}–${formatReportDate(c.end)} · UTC receipt dates`;
  const paragraphs = c.sessions ? [
    `${report.subject} recorded ${number(c.sessions)} session check-ins and ${number(c.attendees)} participant visits in this period. Together, these reports represent ${number(c.sessionMinutes / 60)} session hours and approximately ${number(c.participantMinutes / 60)} participant-hours.`,
    `Activity was recorded in ${number(c.activeWeeks)} calendar ${c.activeWeeks === 1 ? 'week' : 'weeks'}, with an average of ${number(c.averageAttendance!)} attendees per reported session. ${report.programActivity.length} ${report.programActivity.length === 1 ? 'program contributed' : 'programs contributed'} check-ins.`,
    recordedComparison(report),
    'For a funding conversation, this is a concrete account of the learning time reported by these programs. It makes delivered activity visible while leaving outcomes and funding needs to be supported separately.',
  ] : ['No accepted SMS check-ins are recorded for this selection yet. Start with the first session report, or choose another period to build a brief from recorded activity.'];
  return { title, paragraphs, text: [label, title, range, '', ...paragraphs.flatMap(p => [p, '']), `Reporting coverage: ${c.activeDays} of ${c.days} dates have check-ins; completeness is unknown.`, REPORT_METHOD, `Prepared from records available at ${report.generatedAt}.`].join('\n') };
}
