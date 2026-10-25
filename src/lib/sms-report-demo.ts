/** Public, deterministic synthetic fixtures. Never reads or writes live SMS records. */
import { activityBuckets, daysBetween, periodMetrics, shiftDate, sumTotals, type ReportDay, type ReportSelection, type SmsReport } from './sms-report';

export const DEMO_REPORT_TODAY = '2026-10-24';
export const DEMO_REPORT_ORGANIZATIONS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Demo · Cedar Learning', active: true },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Demo · Open Door Arts', active: true },
];
export const DEMO_REPORT_PROGRAMS = [
  { id: '33333333-3333-4333-8333-333333333333', organizationId: DEMO_REPORT_ORGANIZATIONS[0].id, name: 'Demo · Writing together', active: true },
  { id: '44444444-4444-4444-8444-444444444444', organizationId: DEMO_REPORT_ORGANIZATIONS[0].id, name: 'Demo · Everyday numbers', active: true },
  { id: '55555555-5555-4555-8555-555555555555', organizationId: DEMO_REPORT_ORGANIZATIONS[1].id, name: 'Demo · Studio practice', active: true },
];
const FIXTURES: (ReportDay & { programId: string })[] = [
  ['2026-09-08', 0, 12, 90], ['2026-09-10', 1, 10, 60], ['2026-09-12', 2, 14, 120],
  ['2026-09-15', 0, 13, 90], ['2026-09-17', 1, 11, 60], ['2026-09-19', 2, 13, 120],
  ['2026-09-22', 0, 14, 90], ['2026-09-24', 1, 9, 60], ['2026-09-26', 2, 15, 120],
  ['2026-09-29', 0, 12, 90], ['2026-10-01', 1, 11, 60], ['2026-10-03', 2, 15, 120],
  ['2026-10-06', 0, 14, 90], ['2026-10-08', 1, 12, 60], ['2026-10-10', 2, 16, 120],
  ['2026-10-20', 0, 16, 90], ['2026-10-22', 1, 13, 60], ['2026-10-24', 2, 17, 120],
].map(([date, program, attendees, minutes]) => ({
  date: String(date), programId: DEMO_REPORT_PROGRAMS[Number(program)].id, sessions: 1,
  attendees: Number(attendees), sessionMinutes: Number(minutes), participantMinutes: Number(attendees) * Number(minutes),
}));

export function demoSmsReport(selection: ReportSelection): SmsReport {
  const selectedPrograms = DEMO_REPORT_PROGRAMS.filter(program => (!selection.organizationId || program.organizationId === selection.organizationId) && (!selection.programId || program.id === selection.programId));
  const selected = new Set(selectedPrograms.map(program => program.id));
  const rows = FIXTURES.filter(row => selected.has(row.programId));
  const previousEnd = shiftDate(selection.start, -1);
  const previousStart = shiftDate(selection.start, -daysBetween(selection.start, selection.end));
  const program = DEMO_REPORT_PROGRAMS.find(item => item.id === selection.programId);
  const organization = DEMO_REPORT_ORGANIZATIONS.find(item => item.id === selection.organizationId);
  return {
    generatedAt: '2026-10-24T18:00:00.000Z', source: 'synthetic-demo', selection,
    subject: program?.name ?? organization?.name ?? 'Demo partner network',
    organizations: DEMO_REPORT_ORGANIZATIONS, programs: DEMO_REPORT_PROGRAMS,
    current: periodMetrics(rows, selection.start, selection.end),
    previous: periodMetrics(rows, previousStart, previousEnd),
    buckets: activityBuckets(rows, selection.start, selection.end, selection.group),
    programActivity: selectedPrograms.map(item => ({
      ...sumTotals(rows.filter(row => row.programId === item.id && row.date >= selection.start && row.date <= selection.end)),
      id: item.id, name: item.name, organizationName: DEMO_REPORT_ORGANIZATIONS.find(org => org.id === item.organizationId)!.name,
    })).filter(item => item.sessions > 0),
    coverage: { firstRecordedDate: rows[0]?.date ?? null, lastRecordedDate: rows.at(-1)?.date ?? null, completeness: 'unknown' },
  };
}
