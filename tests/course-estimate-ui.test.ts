import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CourseEstimate from '../src/components/CourseEstimate';
import { smsNavigationLinks } from '../src/components/SmsNavigation';
import { createCourseDemo, courseDerivedValues, anotherCourseDraft, maintenanceDraftToWrite, applyDemoCourseSave } from '../src/lib/course-maintenance';
import { bindDemoPhone, demoCourseServiceEstimate, demoSmsTotals, simulateCourseSms } from '../src/lib/course-sms-demo';

const read = (path: string) => readFileSync(path, 'utf8');

test('estimate summary labels estimates separately from actual attendance with accessible help', () => {
  const html = renderToStaticMarkup(createElement(CourseEstimate, { totals: { participantHours: 720, courseCount: 3, missingValuesCount: 2 }, scope: 'All programs in Example' }));
  assert.match(html, /Estimated participant-hours/);
  assert.match(html, /All programs in Example/);
  assert.match(html, /Based on saved program details/);
  assert.match(html, />720</);
  assert.match(html, /aria-label="Help: Estimated participant-hours"/);
  const source = read('src/components/CourseEstimate.tsx');
  assert.match(source, /multiply its saved number of participants by its whole-program hours/);
  assert.match(source, /totals.missingValuesCount/);
  assert.match(source, /All program statuses are included/);
  assert.match(source, /existing hours × participants completed calculation/);
});

test('all-unknown inputs are not displayed as zero, while known zero and no unbound courses are zero', () => {
  const render = (participantHours: number, courseCount: number, missingValuesCount: number) => renderToStaticMarkup(createElement(CourseEstimate, { totals: { participantHours, courseCount, missingValuesCount }, scope: 'All courses' }));
  assert.match(render(0, 2, 2), /Awaiting details/);
  assert.doesNotMatch(render(0, 2, 2), />0</);
  assert.match(render(0, 2, 1), />0</);
  assert.doesNotMatch(render(0, 2, 1), /Awaiting details/);
  assert.match(render(0, 0, 0), />0</);
});

test('synthetic estimate uses every offering in the scope, excludes linked phones once, and keeps actuals unchanged', () => {
  let workspace = createCourseDemo();
  const first = workspace.summaries.find(course => course.courseHoursPerParticipant === 30)!;
  const other = workspace.summaries.find(course => course.courseHoursPerParticipant === 26)!;
  assert.deepEqual(demoCourseServiceEstimate(workspace), { participantHours: 1136, courseCount: 4, missingValuesCount: 2 });
  assert.deepEqual(demoCourseServiceEstimate(workspace, first.organizationId), { participantHours: 720, courseCount: 3, missingValuesCount: 2 });
  assert.deepEqual(demoCourseServiceEstimate(workspace, other.organizationId), { participantHours: 416, courseCount: 1, missingValuesCount: 0 });
  workspace = bindDemoPhone(workspace, 'fictional-01', first.id);
  workspace = bindDemoPhone(workspace, 'fictional-02', first.id);
  assert.deepEqual(demoCourseServiceEstimate(workspace), { participantHours: 416, courseCount: 3, missingValuesCount: 2 });
  workspace = simulateCourseSms(workspace, 'fictional-01', '20 2', 'estimate-separation').workspace;
  const actual = demoSmsTotals(workspace.sms!.records);
  assert.equal(actual.participantMinutes, 2400);
  assert.equal(demoCourseServiceEstimate(workspace).participantHours, 416);
  workspace = bindDemoPhone(workspace, 'fictional-01', null);
  workspace = bindDemoPhone(workspace, 'fictional-02', null);
  assert.equal(demoCourseServiceEstimate(workspace).participantHours, 1136);
  assert.deepEqual(demoSmsTotals(workspace.sms!.records), actual);
  assert.equal(courseDerivedValues(first).completedParticipantHours, 600);
  assert.deepEqual(demoCourseServiceEstimate(workspace, 'absent'), { participantHours: 0, courseCount: 0, missingValuesCount: 0 });
});

test('estimate recomputes on saved metadata changes without adding fields or altering stored data', () => {
  const original = createCourseDemo();
  const copy = JSON.stringify(original);
  const workspace = { ...original, summaries: original.summaries.map((course, index) => index === 1 ? { ...course, participants: 0, courseHoursPerParticipant: 4 } : course) };
  assert.deepEqual(demoCourseServiceEstimate(workspace), { participantHours: 1136, courseCount: 4, missingValuesCount: 1 });
  assert.equal(JSON.stringify(original), copy);
  assert.equal(workspace.sms, original.sms);
});

test('live course list uses full server scope, clears estimates after save, and guards organization changes', () => {
  const source = read('src/components/CourseMaintenance.tsx');
  assert.match(source, /savedEstimate\?\.organizationId === organizationId \? savedEstimate.totals : null/);
  assert.match(source, /setSavedEstimate\(data\?\.serviceEstimate \? \{ organizationId: selectedOrg, totals: data.serviceEstimate \} : null\)/);
  assert.match(source, /setSavedEstimate\(null\);\s*await load\(write.organizationId, write.programId\)/);
  assert.match(source, /!loading && serviceEstimate && <CourseEstimate/);
  assert.match(source, /scope=\{`All programs in \$\{organization.name\}`\}/);
  assert.doesNotMatch(source, /sumCourseServiceEstimates\(courses/);
  const dashboard = read('src/components/SmsDashboard.tsx');
  assert.match(dashboard, /<SmsMetrics totals=\{data.totals\} participantEstimate=\{data.participantEstimate \?\? null\}\/>/);
  assert.match(dashboard, /<CourseEstimate totals=\{data.serviceEstimate\}/);
  assert.match(read('src/components/SmsDemo.tsx'), /demoParticipantEstimate\(workspace, organizationId\)/);
  assert.doesNotMatch(read('src/components/CourseEstimate.tsx'), /<input|<select|<form|fetch\(/);
});

test('demo dashboard has one synthetic management entry and live navigation returns to the new home', () => {
  const demo = smsNavigationLinks('/sms/demo');
  assert.equal(demo.length, 1); assert.equal(demo[0].label, 'Manage programs'); assert.equal(demo[0].href, '/demo/courses');
  assert.equal(smsNavigationLinks('/sms').find(link => link.label === 'Manage programs')?.href, '/courses');
  assert.equal(smsNavigationLinks('/sms/admin').find(link => link.label === 'Dashboard')?.href, '/');
  assert.match(read('src/app/sms/layout.tsx'), /<SmsNavigation\/>/);
  assert.match(read('src/components/CourseMaintenance.tsx'), /className="cm-brand" href=\{dashboardHref\}/);
});

test('narrow screens retain 44px help and primary SMS actions even with a fine pointer', () => {
  assert.match(read('src/app/globals.css'), /@media\(max-width:760px\)\{\.il-help-trigger\.il-help-trigger\{width:44px;height:44px/);
  assert.match(read('src/app/sms/sms.css'), /\.sms-shell \.sms-button\{[^}]*min-height:44px/);
});

test('adding another offering reuses editable estimate defaults without fabricating completions or SMS', () => {
  let workspace = createCourseDemo();
  const source = workspace.summaries.find(course => course.courseHoursPerParticipant === 30)!;
  const before = demoCourseServiceEstimate(workspace);
  const draft = anotherCourseDraft(source);
  const write = maintenanceDraftToWrite(draft, '74000000-0000-4000-8000-000000000001');
  workspace = applyDemoCourseSave(workspace, write);
  assert.equal(demoCourseServiceEstimate(workspace).participantHours, before.participantHours + 720);
  assert.equal(write.status, 'planned'); assert.equal(write.completers, null);
  assert.equal(write.startDate, null); assert.equal(write.endDate, null); assert.equal(write.notes, null);
  assert.equal(courseDerivedValues(write).completedParticipantHours, null);
  assert.equal(demoSmsTotals(workspace.sms?.records ?? []).sessions, 0);
});

test('course validation errors are visible beside Save and focused without discarding the draft', () => {
  const source = read('src/components/CourseMaintenance.tsx');
  assert.match(source, /cm-form-error" role="alert" tabIndex=\{-1\} ref=\{formErrorRef\}/);
  assert.match(source, /ref=\{formErrorRef\}>\{error\}<\/div>}\s*<div className="cm-save-bar">/);
  assert.match(source, /formErrorRef.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /formErrorRef.current\?\.scrollIntoView\(\{ block: 'nearest', behavior: userScrollBehavior\(\) \}\)/);
  assert.match(source, /if \(!error \|\| !courseEditorOpen\) return/);
  assert.match(source, /error && !courseEditorOpen/);
  assert.match(source, /Participant count and program hours copied. You can change them./);
});
