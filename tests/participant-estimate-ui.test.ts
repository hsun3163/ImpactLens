import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SmsMetrics, SmsRecentActivity } from '../src/components/SmsDashboard';
import { createCourseDemo } from '../src/lib/course-maintenance';
import { bindDemoPhone, demoCourseAttendance, demoParticipantEstimate, demoProgramParticipantEstimate, demoSmsTotals, simulateCourseSms } from '../src/lib/course-sms-demo';
const read = (name: string) => readFileSync(name, 'utf8');
const totals = { attendees: 60, sessions: 3, sessionMinutes: 180, participantMinutes: 3600 };

test('main participant tile renders the program maximum separately from summed activity', () => {
  const html = renderToStaticMarkup(createElement(SmsMetrics, { totals, participantEstimate: { participants: 29, programCount: 1, missingValuesCount: 0 } }));
  assert.match(html, /Program participants/); assert.match(html, /Program-level estimate/);
  assert.match(html, /sms-metric-value">29<span><\/span>/);
  assert.doesNotMatch(html, /Participant visits|Estimated participants|Attendance across sessions/);
  assert.match(html, /Participant hours/); assert.match(html, /sms-metric-value">60<span>h/);
});

test('unknown participant totals remain explicit and a known zero remains a number', () => {
  for (const participantEstimate of [null, { participants: 0, programCount: 2, missingValuesCount: 2 }]) {
    const html = renderToStaticMarkup(createElement(SmsMetrics, { totals, participantEstimate }));
    assert.match(html, /Program participants/); assert.match(html, /Awaiting details/);
    assert.doesNotMatch(html, /sms-metric-value">60<span><\/span>/);
  }
  const zero = renderToStaticMarkup(createElement(SmsMetrics, { totals, participantEstimate: { participants: 0, programCount: 1, missingValuesCount: 0 } }));
  assert.match(zero, /sms-metric-value">0<span><\/span>/);
});

test('report-period metrics and session feed retain explicit raw attendance rather than relabeling a sum as a peak', () => {
  const report = renderToStaticMarkup(createElement(SmsMetrics, { totals }));
  assert.match(report, /Attendance across sessions/); assert.match(report, /Session attendance total/);
  assert.doesNotMatch(report, /Program participants/);
  const feed = renderToStaticMarkup(createElement(SmsRecentActivity, { recent: [{ id: 'example', organizationName: 'Example organization', programName: 'Example program', attendees: 15, sessionMinutes: 240, receivedAt: '2026-10-25T01:00:00Z' }] }));
  assert.match(feed, /15 attendees/); assert.doesNotMatch(feed, /visits/);
});

test('synthetic program and course estimates use maxima while raw session points and totals stay intact', () => {
  let workspace = createCourseDemo(); const course = workspace.summaries.find(item => item.status === 'in-progress')!;
  workspace = { ...workspace, summaries: workspace.summaries.map(item => item.programId === course.programId ? { ...item, participants: item.id === course.id ? 45 : 50 } : item) };
  assert.deepEqual(demoProgramParticipantEstimate(workspace, course.programId), { value: 50, source: 'configured-maximum' });
  assert.deepEqual(demoCourseAttendance(workspace, course.id)!.participantEstimate, { value: 45, source: 'configured-maximum' });
  workspace = bindDemoPhone(workspace, 'fictional-01', course.id);
  workspace = simulateCourseSms(workspace, 'fictional-01', '0 1', 'zero').workspace;
  assert.deepEqual(demoProgramParticipantEstimate(workspace, course.programId), { value: 0, source: 'sms-maximum' });
  for (const [index, value] of [16, 15, 29].entries()) workspace = simulateCourseSms(workspace, 'fictional-01', `${value} 1`, `record-${index}`).workspace;
  assert.deepEqual(demoProgramParticipantEstimate(workspace, course.programId), { value: 29, source: 'sms-maximum' });
  const data = demoCourseAttendance(workspace, course.id)!;
  assert.deepEqual(data.participantEstimate, { value: 29, source: 'sms-maximum' });
  assert.deepEqual(data.points.map(item => item.attendees).sort((a, b) => a - b), [0, 15, 16, 29]);
  assert.equal(data.totals.attendees, 60); assert.equal(data.totals.sessions, 4);
  const raw = demoSmsTotals(workspace.sms!.records); const before = demoParticipantEstimate(workspace);
  workspace = bindDemoPhone(workspace, 'fictional-01', null);
  assert.deepEqual(demoParticipantEstimate(workspace), before); assert.deepEqual(demoSmsTotals(workspace.sms!.records), raw);
});

test('live and synthetic displays share the max metric, with course and program scope stated in help', () => {
  const dashboard = read('src/components/SmsDashboard.tsx');
  assert.match(dashboard, /participantEstimate=\{data.participantEstimate \?\? null\}/);
  assert.match(dashboard, /highest recorded attendance/); assert.match(dashboard, /highest saved participant count/);
  assert.match(dashboard, /Totals add the program estimates together/);
  const chart = read('src/components/CourseAttendance.tsx');
  assert.match(chart, /\['Program participants', data.participantEstimate\?\.value \?\? null/);
  assert.match(chart, /Highest attendance recorded for this program/); assert.match(chart, /Saved participant count for this program/);
  assert.match(chart, /Program-level estimate/);
  const demo = read('src/components/SmsDemo.tsx');
  assert.match(demo, /participantEstimate=\{demoParticipantEstimate\(workspace, organizationId\)\}/);
});
