import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (name: string) => readFileSync(`src/components/${name}.tsx`, 'utf8');

test('live course management removes permission banners while keeping access checks and a short dashboard route', () => {
  const source = read('CourseMaintenance');
  const header = source.match(/<header className="cm-topbar">[\s\S]*?<\/header>/)?.[0] ?? '';
  assert.equal((header.match(/href=\{dashboardHref\}/g) ?? []).length, 2);
  assert.match(source, /const dashboardPath = demo \? '\/sms\/demo' : '\/'/);
  assert.match(source, /organizationId \? `\$\{dashboardPath\}\?organizationId=\$\{encodeURIComponent\(organizationId\)\}` : dashboardPath/);
  assert.match(header, /Dashboard<\/a>/);
  assert.match(header, /!demo && <a href="\/sms\/admin">Facilitator phones/);
  assert.doesNotMatch(header, /Live workspace|Try the demo|SMS check-ins/);
  assert.doesNotMatch(source, /PRIVATE TPW WORKSPACE|Authorized TPW administrators|Course details can be saved on their own/);
  assert.match(source, /!session.authenticated \|\| !session.authorized \|\| !session.configured/);
  assert.match(source, /!canEdit && !demo/);
  assert.match(source, /Administrator access required/);
  assert.match(source, /signin-with-chatgpt\?return_to=%2Fcourses/);
  assert.match(source, /You have unsaved changes. Save before leaving or reloading to keep them./);
  assert.match(source, /Whole-program totals, separate from SMS/);
});

test('course demo alone has the synthetic notice and keeps its browser-local reset action', () => {
  const source = read('CourseMaintenance');
  assert.match(source, /\{demo && <div className="cm-mode-note cm-demo-note">[\s\S]*?SYNTHETIC DEMO/);
  assert.match(source, /Fictional data. Changes stay in this browser. Live records stay unchanged./);
  assert.match(source, /<button onClick=\{resetDemo\} disabled=\{busy\}>Reset demo/);
  assert.doesNotMatch(source, /Continue the shared demo/);
});

test('SMS management keeps practical guidance, explicit roles, course review, and audit details without permission slogans', () => {
  const source = read('SmsAdmin');
  assert.doesNotMatch(source, /Approved admins only|Private admin data|PRIVATE ·|SMS webhook|sms-format-note/);
  assert.match(source, /<strong>20 2<\/strong> = 20 attendees, 2 session hours/);
  assert.match(source, /<strong>1<\/strong> repeats this phone’s last counted values for its current program as a new session/);
  assert.match(source, /Facilitator access only. Leader permissions are separate./);
  assert.match(source, /Previous choice: \{previousCourseLabel\}. Choose a saved program or Program name only, then save./);
  assert.match(source, /<SmsAccess session=\{live.session\}/);
  assert.match(source, /if \(courseSelectionError\) \{ setErrorAttempt/);
  assert.match(source, /smsCorrectionInput\(correctionAttendance, correctionHours, correctionReason\)/);
  assert.match(source, /Manually corrected<HelpTip label="Correction details"/);
  assert.match(source, /record.manualCorrection.correctedBy/);
  assert.match(source, /Original SMS preserved/);
  assert.match(source, /History stays unchanged/);
});


test('management vocabulary keeps program and facilitator copy separate from internal identifiers and stored text', () => {
  for (const name of ['CourseMaintenance', 'SmsAdmin', 'SmsBusinessSettings']) {
    const source = read(name);
    const file = ts.createSourceFile(name + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) assert.doesNotMatch(node.getText(file), /\b(?:courses?|teachers?)\b/i, name);
      if (ts.isJsxAttribute(node) && ['aria-label', 'title', 'placeholder', 'label', 'text'].includes(node.name.getText(file)) && node.initializer && ts.isStringLiteral(node.initializer)) {
        assert.doesNotMatch(node.initializer.text, /\b(?:courses?|teachers?)\b/i, `${name}: ${node.name.getText(file)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.match(source, /productMessage\(err.message\)/);
  }
  const maintenance = read('CourseMaintenance');
  assert.match(maintenance, /Manage programs/);
  assert.match(maintenance, /Add program/);
  assert.match(maintenance, /productMessage\(result.error\)/);
  assert.match(maintenance, /\/api\/sms\/course-metadata/);
  assert.match(maintenance, /data-course-edit=\{course.id\}/);
  const admin = read('SmsAdmin');
  assert.match(admin, /action: 'teacher'/);
  assert.match(admin, /const SMS_PROGRAM_ONLY = 'program-only'/);
  assert.match(admin, /'sms-course-binding-help sms-course-binding-warning'/);
  assert.match(admin, /<span className="sms-raw-body">\{record.body\}<\/span>/);
  const permissions = read('SmsBusinessSettings');
  assert.match(permissions, /Allow assistant program actions/);
  assert.match(permissions, /Only program changes requested by an authorized leader in this organization. Program records only./);
  assert.match(permissions, /className="sms-business-message">\{request.text\}/);
});
