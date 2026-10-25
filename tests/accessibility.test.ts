import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { courseErrorFields, preferredScrollBehavior } from '../src/lib/accessibility';
const read = (path: string) => readFileSync(path, 'utf8');
const component = (name: string) => read(`src/components/${name}.tsx`);
function luminance(hex: string) {
  const rgb = hex.replace('#', '').match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string) { const first = luminance(a), second = luminance(b); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); }

test('chosen text and control colors meet checked contrast thresholds on actual light surfaces', () => {
  for (const background of ['#fffefa', '#fcfdf8', '#eef2e7', '#f1f6ec', '#f6f9f2']) {
    assert.ok(contrast('#52674b', background) >= 4.5, `secondary text on ${background}`);
    assert.ok(contrast('#3e5638', background) >= 4.5, `labels on ${background}`);
  }
  assert.ok(contrast('#755620', '#f7f2e2') >= 4.5);
  assert.ok(contrast('#863b23', '#fff3e9') >= 4.5);
  assert.ok(contrast('#385b2e', '#eef5e8') >= 4.5);
  assert.ok(contrast('#829478', '#fcfdf8') >= 3);
  assert.ok(contrast('#244b2d', '#eef2e7') >= 3);
  for (const file of ['src/app/courses/courses.css', 'src/app/sms/sms.css']) {
    const css = read(file); assert.match(css, /color:#52674b/); assert.match(css, /border-color:#829478/);
    assert.match(css, /focus-visible\{outline:3px solid #244b2d;outline-offset:3px\}/);
  }
});

test('cross-field error associations use structured codes, not guessed text', () => {
  assert.deepEqual(courseErrorFields('INVALID_COMPLETERS'), ['completers']);
  assert.deepEqual(courseErrorFields('INVALID_DATE_RANGE'), ['startDate', 'endDate']);
  assert.deepEqual(courseErrorFields('UNAUTHORIZED'), []); assert.deepEqual(courseErrorFields(), []);
  const source = component('CourseMaintenance');
  assert.match(source, /id="cm-form-error" role="alert" tabIndex=\{-1\}/);
  for (const field of ['completers', 'startDate', 'endDate']) {
    assert.ok(source.includes(`aria-invalid={invalidFields.includes('${field}') || undefined}`));
    assert.ok(source.includes(`aria-describedby={invalidFields.includes('${field}') ? 'cm-form-error' : undefined}`));
  }
  assert.match(source, /err instanceof CourseSummaryError \|\| err instanceof RequestError \? err.code/);
  assert.match(source, /\[error, courseEditorOpen, saveAttempt\]/);
});

test('persistent input hints have programmatic associations, with visible format examples retained', () => {
  const course = component('CourseMaintenance');
  for (const id of ['cm-facility-hint', 'cm-hours-hint']) { assert.ok(course.includes(`aria-describedby="${id}"`)); assert.ok(course.includes(`id="${id}"`)); }
  const admin = component('SmsAdmin');
  assert.match(admin, /aria-describedby="sms-phone-hint"/); assert.match(admin, /id="sms-phone-hint">Use \+country/);
  assert.match(component('SmsDemo'), /<b>20 2<\/b> = 20 attendees, 2 session hours/);
});

test('refresh timestamp is outside all live regions, while connection state is announced', () => {
  const source = component('SmsDashboard');
  const file = ts.createSourceFile('SmsDashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  function visit(node: ts.Node, live: boolean) {
    if (ts.isJsxElement(node)) {
      const attributes = node.openingElement.attributes.properties;
      const isLive = attributes.some(attr => ts.isJsxAttribute(attr) && ((attr.name.getText(file) === 'role' && attr.initializer?.getText(file) === '"status"') || attr.name.getText(file) === 'aria-live'));
      node.children.forEach(child => visit(child, live || isLive)); return;
    }
    if (ts.isJsxText(node) && node.text.includes('Last successful refresh:')) { found = true; assert.equal(live, false); }
    ts.forEachChild(node, child => visit(child, live));
  }
  visit(file, false); assert.equal(found, true);
  assert.match(source, /<b role="status" aria-atomic="true">/);
});

test('editor and attendance view transitions have deliberate keyboard focus and return targets', () => {
  const source = component('CourseMaintenance');
  assert.match(source, /editorHeadingRef.current\?\.focus/); assert.match(source, /data-course-edit=\{course.id\}/);
  assert.match(source, /data-course-copy=\{course.id\}/); assert.match(source, /function restoreEditorFocus/);
  assert.match(source, /previous.element\?\.isConnected/); assert.match(source, /wasEditing && restoreFocus/);
  assert.match(source, /attendanceRef.current\?\.focus/); assert.match(source, /data-course-attendance=\{course.id\}/);
  const admin = component('SmsAdmin'); assert.match(admin, /teacherNameRef.current\?\.focus/); assert.match(admin, /correctionInputRef.current\?\.focus/);
});

test('SMS feedback is beside the relevant action and repeated errors can be refocused', () => {
  const source = component('SmsDemo');
  assert.match(source, /feedbackPlace === 'binding' && feedbackMessage/);
  assert.match(source, /feedbackPlace === 'sms' && feedbackMessage/);
  assert.match(source, /if \(error\) feedbackRef.current\?\.focus/);
  assert.match(source, /!feedbackRequested.current/);
  assert.match(source, /\[error, feedback, feedbackAttempt\]/);
  assert.match(source, /Organization<select value=\{organizationId\}/);
});

test('chart data and horizontally scrolling tables remain keyboard-readable with column headers', () => {
  const chart = component('CourseAttendance');
  assert.match(chart, /role="img" aria-label=/);
  assert.match(chart, /ca-table-scroll" tabIndex=\{0\} role="region" aria-label=/);
  assert.match(chart, /<table aria-label="Program sessions in receipt order">/);
  assert.match(chart, /<th scope="col">/);
  const admin = component('SmsAdmin');
  assert.equal((admin.match(/sms-table-scroll" tabIndex=\{0\} role="region"/g) ?? []).length, 2);
});

test('skip links, reduced-motion scrolling and secondary target sizes are explicit', () => {
  assert.equal(preferredScrollBehavior(true), 'auto'); assert.equal(preferredScrollBehavior(false), 'smooth');
  assert.match(component('CourseMaintenance'), /href="#cm-main">Skip to main content/);
  assert.match(read('src/app/sms/layout.tsx'), /<main id="sms-main" tabIndex=\{-1\}>/);
  for (const name of ['CourseMaintenance', 'SmsAdmin', 'SmsDemo']) assert.doesNotMatch(component(name), /behavior: 'smooth'/);
  assert.match(read('src/app/globals.css'), /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(read('src/app/courses/courses.css'), /\.cm-icon-button,\.cm-alert>button\)\{min-width:44px;min-height:44px/);
  assert.match(read('src/app/sms/sms.css'), /\.sms-icon-button,\.sms-feedback>button\)\{min-width:44px;min-height:44px/);
});

test('new SMS main landmark resets legacy sidebar layout and invalid fields override ordinary borders', () => {
  assert.match(read('src/app/sms/sms.css'), /\.sms-shell>main\{margin:0;width:100%;min-width:0\}/);
  assert.match(read('src/app/courses/courses.css'), /\.cm-shell \.cm-editor \[aria-invalid=true\]\{border:2px solid #863b23\}/);
});

test('legacy child colors cannot override the measured SMS and chart contrast fixes', () => {
  const sms = read('src/app/sms/sms.css');
  const override = sms.slice(sms.indexOf('/* Explicit child overrides'));
  for (const selector of ['.sms-demo-phone b', '.sms-demo-programs small', '.sms-demo-org', '.sms-screen-section-heading>span', '.sms-metric-value>span', '.sms-demo-flow>span>span', '.sms-live-strip>b']) assert.ok(override.includes(selector), selector);
  assert.match(override, /color:#52674b/);
  assert.match(read('src/components/CourseAttendance.css'), /\.ca-live button,\.ca-locked button\{color:#3e5b34;border-color:#829478\}/);
});

test('admin corrections return focus and repeated identical validation errors remain discoverable', () => {
  const source = component('SmsAdmin');
  assert.match(source, /function finishCorrection\(\)/);
  assert.match(source, /data-correct-record=\{record.id\}/);
  assert.match(source, /document.getElementById\('sms-records-heading'\)/);
  assert.match(source, /onClick=\{finishCorrection\}/);
  assert.match(source, /\[error, errorAttempt\]/);
});
