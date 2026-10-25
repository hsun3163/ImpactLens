import test from 'node:test';
import assert from 'node:assert/strict';
import { activityBuckets, fundingStory, parseReportSelection, periodMetrics, recordedComparison, validReportDate, weekStart, type ReportDay, type SmsReport } from '../src/lib/sms-report';
const rows: ReportDay[] = [
  { date: '2026-10-01', sessions: 1, attendees: 20, sessionMinutes: 120, participantMinutes: 2400 },
  { date: '2026-10-04', sessions: 1, attendees: 10, sessionMinutes: 60, participantMinutes: 600 },
  { date: '2026-10-12', sessions: 1, attendees: 0, sessionMinutes: 60, participantMinutes: 0 },
];
function report(): SmsReport {
  return { generatedAt: '2026-10-25T00:00:00.000Z', source: 'live-sms', subject: 'Synthetic test program', selection: { start: '2026-10-01', end: '2026-10-14', group: 'week', organizationId: null, programId: null }, organizations: [], programs: [], current: periodMetrics(rows, '2026-10-01', '2026-10-14'), previous: periodMetrics([], '2026-09-17', '2026-09-30'), buckets: activityBuckets(rows, '2026-10-01', '2026-10-14', 'week'), programActivity: [{ id: 'program', name: 'Synthetic test program', organizationName: 'Synthetic test organization', sessions: 3, attendees: 30, sessionMinutes: 240, participantMinutes: 3000 }], coverage: { firstRecordedDate: '2026-10-01', lastRecordedDate: '2026-10-12', completeness: 'unknown' } };
}
test('report filters are strict, bounded, calendar-valid and reject future or duplicate dates', () => {
  const now = new Date('2026-10-25T23:00:00Z');
  assert.deepEqual(parseReportSelection(new URLSearchParams(), now), { ok: true, selection: { start: '2026-10-01', end: '2026-10-25', group: 'week', organizationId: null, programId: null } });
  for (const query of ['start=2026-02-30', 'start=2026-99-01', 'end=2026-10-26', 'start=2026-10-20&end=2026-10-19', 'start=2020-01-01&end=2026-01-01', 'start=2026-10-01&start=2026-10-02', 'group=day', 'organizationId=not-uuid', 'participantId=extra']) assert.equal(parseReportSelection(new URLSearchParams(query), now).ok, false, query);
  assert.equal(validReportDate('2024-02-29'), true); assert.equal(validReportDate('2025-02-29'), false);
});
test('metrics retain zero-attendance reports and never infer unique participants or completion', () => {
  assert.deepEqual(periodMetrics(rows, '2026-10-01', '2026-10-14'), { sessions: 3, attendees: 30, sessionMinutes: 240, participantMinutes: 3000, start: '2026-10-01', end: '2026-10-14', days: 14, activeDays: 3, activeWeeks: 2, averageAttendance: 10 });
  const empty = periodMetrics(rows, '2026-09-01', '2026-09-30'); assert.equal(empty.averageAttendance, null); assert.equal(empty.activeWeeks, 0);
  assert.equal(periodMetrics([rows[0], rows[0]], '2026-10-01', '2026-10-14').activeDays, 1);
  assert.equal(weekStart('2026-10-04'), '2026-09-28'); assert.equal(weekStart('2026-10-05'), '2026-10-05');
});
test('week/month buckets include unreported gaps and label partial boundaries', () => {
  const buckets = activityBuckets(rows, '2026-10-01', '2026-10-14', 'week');
  assert.equal(buckets.length, 3); assert.deepEqual(buckets.map(row => row.sessions), [2, 0, 1]); assert.deepEqual(buckets.map(row => row.partial), [true, false, true]);
  const months = activityBuckets(rows, '2026-09-20', '2026-10-14', 'month'); assert.equal(months.length, 2); assert.equal(months[0].sessions, 0); assert.equal(months[1].participantMinutes, 3000); assert.ok(months.every(row => row.partial));
});
test('prior-period comparisons are honest about absent and zero denominators', () => {
  const r = report(); assert.match(recordedComparison(r), /No accepted check-ins in the prior/);
  r.previous = { ...r.previous, sessions: 2, participantMinutes: 0 }; assert.doesNotMatch(recordedComparison(r), /Infinity|NaN/); assert.match(recordedComparison(r), /percentage comparison is not available/);
  r.previous.participantMinutes = 1500; assert.match(recordedComparison(r), /100% higher/);
  r.current.participantMinutes = 0; assert.match(recordedComparison(r), /100% lower/);
  r.previous.participantMinutes = 0; assert.match(recordedComparison(r), /unchanged/);
  r.current.sessions = 0; assert.match(recordedComparison(r), /not enough recorded activity/);
});
test('funding exports are deterministic, source-labelled and carry definitions with every artifact', () => {
  const r = report(); const story = fundingStory(r);
  assert.equal(story.text, fundingStory(r).text); assert.match(story.text, /3 session check-ins and 30 participant visits/); assert.match(story.text, /approximately 50 participant-hours/); assert.match(story.text, /not unique people/); assert.match(story.text, /receipt date in UTC/); assert.match(story.text, /Course summaries are separate and excluded/); assert.match(story.text, /full session/); assert.match(story.text, /completeness is unknown/);
  r.source = 'synthetic-demo'; assert.match(fundingStory(r).text, /^SYNTHETIC DEMO/);
  r.current = periodMetrics([], '2026-10-01', '2026-10-14'); const empty = fundingStory(r).text; assert.match(empty, /No accepted SMS check-ins/); assert.doesNotMatch(empty, /represent .*participant-hours/);
});
