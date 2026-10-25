import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement, isValidElement, Children, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CourseStatusDetails from '../src/components/CourseStatusDetails';
import { COURSE_SUMMARY_STATUSES, COURSE_SUMMARY_STATUS_LABELS, courseSummaryToDraft } from '../src/lib/course-summary';
import { createCourseDemo, newCourseDraft, anotherCourseDraft, maintenanceDraftToWrite, applyDemoCourseSave } from '../src/lib/course-maintenance';
import { bindDemoPhone, simulateCourseSms } from '../src/lib/course-sms-demo';

test('status details start closed for every existing status, with the current value and accessible controls intact', () => {
  for (const status of COURSE_SUMMARY_STATUSES) {
    let changes = 0;
    const html = renderToStaticMarkup(createElement(CourseStatusDetails, { status, onChange: () => { changes++; } }));
    assert.match(html, /<details class="cm-additional-details cm-field-wide">/);
    assert.doesNotMatch(html, /\sopen(?:=|>)/);
    assert.ok(html.includes(`Status: ${COURSE_SUMMARY_STATUS_LABELS[status]}`));
    assert.match(html, /role="group" aria-label="Schedule Status"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((html.match(/type="button"/g) ?? []).length, 3);
    assert.equal(changes, 0);
  }
});

test('status is changed only by an explicit choice; busy forms disable all three choices', () => {
  const changes: string[] = [];
  const tree = CourseStatusDetails({ status: 'completed', onChange: value => changes.push(value) });
  const buttons: { onClick: () => void; 'aria-pressed': boolean }[] = [];
  function visit(node: ReactNode) {
    if (!isValidElement<{ children?: ReactNode; onClick: () => void; 'aria-pressed': boolean }>(node)) return;
    if (node.type === 'button') buttons.push(node.props);
    Children.forEach(node.props.children, visit);
  }
  visit(tree); assert.equal(changes.length, 0);
  assert.equal(buttons[2]['aria-pressed'], true);
  buttons[1].onClick(); assert.deepEqual(changes, ['in-progress']);
  const html = renderToStaticMarkup(createElement(CourseStatusDetails, { status: 'planned', disabled: true, onChange: () => {} }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  const source = readFileSync('src/components/CourseStatusDetails.tsx', 'utf8');
  assert.doesNotMatch(source, /onToggle|useEffect|setStatus|autoFocus|open=/);
});

test('new and copied courses stay Planned, while unrelated edits preserve every saved status', () => {
  const workspace = createCourseDemo(); const sample = workspace.summaries[0];
  for (const draft of [newCourseDraft(sample.organizationId, sample.programId), anotherCourseDraft({ ...sample, status: 'completed' })]) {
    assert.equal(draft.status, 'planned'); assert.equal(maintenanceDraftToWrite(draft, randomUUID()).status, 'planned');
  }
  for (const status of COURSE_SUMMARY_STATUSES) {
    const original = { ...sample, status };
    const draft = { ...courseSummaryToDraft(original), notes: 'Updated course note' };
    const write = maintenanceDraftToWrite(draft, original.id, original);
    assert.equal(write.status, status);
    const next = applyDemoCourseSave({ ...workspace, summaries: workspace.summaries.map(item => item.id === original.id ? original : item) }, write);
    assert.equal(next.summaries.find(item => item.id === original.id)!.status, status);
  }
});

test('SMS check-ins preserve all manual course statuses and the editor/card integration remains unchanged', () => {
  for (const status of COURSE_SUMMARY_STATUSES) {
    let workspace = createCourseDemo(); const sample = workspace.summaries[0];
    workspace = { ...workspace, summaries: workspace.summaries.map(item => item.id === sample.id ? { ...item, status } : item) };
    workspace = bindDemoPhone(workspace, 'fictional-01', sample.id);
    const next = simulateCourseSms(workspace, 'fictional-01', '20 2', randomUUID());
    assert.ok(next.record); assert.deepEqual(next.workspace.summaries, workspace.summaries);
  }
  const source = readFileSync('src/components/CourseMaintenance.tsx', 'utf8');
  assert.match(source, /<CourseStatusDetails key=\{draft.id \|\| 'new-course'\} status=\{draft.status\} disabled=\{busy\} onChange=\{status => change\('status', status\)\}/);
  assert.match(source, /<Status value=\{course.status\}/);
  const css = readFileSync('src/app/courses/courses.css', 'utf8');
  assert.match(css, /\.cm-additional-details>summary\{min-height:44px/);
  assert.match(css, /\.cm-shell \.cm-additional-details \.cm-status-options button\{min-height:44px/);
});
