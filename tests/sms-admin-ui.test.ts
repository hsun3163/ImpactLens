import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewSmsCourseSelection, smsCorrectionInput, smsCourseLabel, smsCourseSelectionError, SMS_PROGRAM_ONLY, type SmsAdminCourse, type SmsCourseSelection } from '../src/components/SmsAdmin';

const course: SmsAdminCourse = {
  id: '40000000-0000-4000-8000-000000000001', organizationId: 'organization-one', programId: 'program-one',
  organizationName: 'Synthetic organization', programName: 'Same program', facility: 'Example facility', yard: 'A',
  status: 'planned', startDate: '2026-01-01', endDate: '2026-03-01',
};
const selection = (value: string, programId = course.programId): SmsCourseSelection => ({ value, programId, needsReview: false });

test('course labels distinguish identical courses by a short ID, with location, dates and status', () => {
  const label = smsCourseLabel(course);
  assert.match(label, /Same program · Example facility \/ A · 2026-01-01 to 2026-03-01 · Planned · #40000000…0001/);
  assert.notEqual(label, smsCourseLabel({ ...course, id: '40000000-0000-4000-8000-000000000002' }));
  assert.notEqual(label, smsCourseLabel({ ...course, yard: 'B' }));
  assert.notEqual(label, smsCourseLabel({ ...course, startDate: '2026-02-01' }));
  const missing = smsCourseLabel({ ...course, facility: null, yard: null, startDate: null, endDate: null });
  assert.match(missing, /Choose a location · Choose a start date to Choose an end date/);
  assert.doesNotMatch(missing, /null|undefined|1970/);
});

test('new mappings require an explicit course or explicit program-only choice; legacy null stays valid', () => {
  const error = (choice: SmsCourseSelection) => smsCourseSelectionError(choice, course.organizationId, course.programId, [course]);
  assert.match(error(selection('')), /explicitly select Program name only/);
  assert.equal(error(selection(SMS_PROGRAM_ONLY)), '');
  assert.equal(error(selection(course.id)), '');
  assert.equal(smsCourseSelectionError(selection(SMS_PROGRAM_ONLY), course.organizationId, course.programId, []), '');
  assert.match(smsCourseSelectionError(selection(''), '', '', []), /Choose an organization and program name first/);
});

test('course binding rejects missing courses and wrong organization or program, never inferring another course', () => {
  assert.match(smsCourseSelectionError(selection(course.id), course.organizationId, course.programId, []), /unavailable/);
  assert.match(smsCourseSelectionError(selection(course.id), 'other-organization', course.programId, [course]), /within the selected organization and program/);
  assert.match(smsCourseSelectionError(selection(course.id, 'other-program'), course.organizationId, 'other-program', [course]), /within the selected organization and program/);
  assert.match(smsCourseSelectionError(selection(course.id), course.organizationId, 'other-program', [course]), /explicitly select/);
});

test('program changes preserve the old choice and require deliberate reconfirmation, even after switching back', () => {
  for (const value of [course.id, SMS_PROGRAM_ONLY]) {
    const original = selection(value);
    assert.strictEqual(reviewSmsCourseSelection(original, course.programId), original);
    const changed = reviewSmsCourseSelection(original, 'other-program');
    assert.equal(changed.value, value); assert.equal(changed.programId, course.programId); assert.equal(changed.needsReview, true);
    assert.equal(original.needsReview, false);
    assert.match(smsCourseSelectionError(changed, course.organizationId, 'other-program', [course]), /explicitly select/);
    const changedBack = reviewSmsCourseSelection(changed, course.programId);
    assert.equal(changedBack.needsReview, true);
    assert.match(smsCourseSelectionError(changedBack, course.organizationId, course.programId, [course]), /explicitly select/);
    assert.equal(smsCourseSelectionError(selection(SMS_PROGRAM_ONLY, 'other-program'), course.organizationId, 'other-program', [course]), '');
  }
});

test('organization changes also retain the prior binding while the program is cleared', () => {
  const changed = reviewSmsCourseSelection(selection(course.id), '');
  assert.equal(changed.value, course.id); assert.equal(changed.needsReview, true);
  assert.match(smsCourseSelectionError(changed, 'other-organization', '', [course]), /Choose an organization and program name first/);
});

test('admin form and enable/disable payloads preserve explicit course binding and display it separately', () => {
  const source = readFileSync('src/components/SmsAdmin.tsx', 'utf8');
  assert.match(source, /<form onSubmit=\{submitTeacher\}>[\s\S]*?Program for this phone \(optional\)[\s\S]*?<\/form>/);
  assert.match(source, /if \(courseSelectionError\) \{ setErrorAttempt\(value => value \+ 1\); setError\(courseSelectionError\); return; \}/);
  assert.match(source, /courseId: teacherCourse.value === SMS_PROGRAM_ONLY \? null : teacherCourse.value/);
  assert.match(source, /setTeacherCourse\(\{ value: teacher.courseId \?\? SMS_PROGRAM_ONLY, programId: teacher.programId, needsReview: false \}\)/);
  assert.match(source, /courseId: teacher.courseId \?\? null, active: !teacher.active/);
  assert.match(source, /<th scope="col">Program for this phone<\/th>/);
  assert.match(source, /\/courses\?organizationId=\$\{encodeURIComponent\(organizationId\)\}/);
  assert.match(source, /Previous choice: \{previousCourseLabel\}/);
  assert.match(source, /Choose a saved program or Program name only, then save/);
  assert.match(source, /\['UNKNOWN_SENDER', 'INACTIVE_SENDER', 'INVALID_COURSE'\]/);
  assert.match(source, /Earlier records keep their original program/);
});


test('manual correction requires bounded confirmed numeric values and an explicit reason, preserving zero', () => {
  assert.deepEqual(smsCorrectionInput('0', '0.25', '  Teacher confirmed zero attendance  '), { attendees: 0, hours: 0.25, reason: 'Teacher confirmed zero attendance' });
  assert.deepEqual(smsCorrectionInput('16', '4', 'Teacher confirmed values'), { attendees: 16, hours: 4, reason: 'Teacher confirmed values' });
  for (const input of ['', '-1', '1.5', '10001', 'NaN']) assert.throws(() => smsCorrectionInput(input, '1', 'Confirmed'), /attendance/);
  for (const input of ['', '0', '0.1', '24.25', 'Infinity']) assert.throws(() => smsCorrectionInput('1', input, 'Confirmed'), /session hours/);
  for (const reason of ['', ' ', 'x'.repeat(501), 'line\nbreak']) assert.throws(() => smsCorrectionInput('1', '1', reason), /correction reason/);
});
test('manual correction stays a collapsed eligible-row action with explicit submit, original text and audit details', () => {
  const source = readFileSync('src/components/SmsAdmin.tsx', 'utf8');
  assert.match(source, /record.canCorrect && !record.businessRequestId && correctionId !== record.id/);
  assert.match(source, /record.canCorrect && !record.businessRequestId && correctionId === record.id && <form/);
  assert.match(source, /<span className="sms-raw-body">\{record.body\}<\/span>/);
  assert.match(source, /Attendance<input ref=\{correctionInputRef\} type="number"/);
  assert.match(source, /Session hours<input type="number"/);
  assert.match(source, /Reason for correction<input type="text" maxLength=\{500\} required/);
  assert.match(source, /Save and count/);
  assert.match(source, /action: 'correct', id, \.[.][.]values/);
  assert.match(source, /Manually corrected<HelpTip label="Correction details"/);
  assert.match(source, /Numbers saved and counted once. The original text is unchanged./);
  assert.match(source, /if \(busyRef.current\) return;/);
  assert.doesNotMatch(source, /setCorrectionAttendance\('16'\)|setCorrectionAttendance\('15'\)/);
});
