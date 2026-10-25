import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COURSE_DEMO_STORAGE_KEY, applyDemoCourseSave, applyDemoMetadata, createCourseDemo, parseCourseDemo, savedCourseYards, serializeCourseDemo, type CourseWorkspace } from '../src/lib/course-maintenance';
import { bindDemoPhone, courseDemoLabel, demoCourseAttendance, demoSmsTotals, initialCourseDemoSelection, latestDemoRepeatBaseline, readCourseDemo, simulateCourseSms, updateCourseDemo, type CourseDemoStorage } from '../src/lib/course-sms-demo';
import { courseSummaryDraftToWrite, courseSummaryToDraft, type CourseSummary } from '../src/lib/course-summary';
const write = (course: CourseSummary) => courseSummaryDraftToWrite(courseSummaryToDraft(course));
const phone = 'fictional-01';
function fresh() { const workspace = createCourseDemo(); const course = workspace.summaries.find(item => item.status === 'in-progress')!; return { workspace, course }; }
function store(initial: CourseWorkspace) {
  let value = serializeCourseDemo(initial);
  const storage: CourseDemoStorage = { getItem: key => key === COURSE_DEMO_STORAGE_KEY ? value : null, setItem: (key, next) => { assert.equal(key, COURSE_DEMO_STORAGE_KEY); value = next; } };
  let tail = Promise.resolve();
  const lock = <T,>(work: () => T): Promise<T> => { const result = tail.then(work); tail = result.then(() => undefined, () => undefined); return result; };
  return { storage, lock };
}
test('v1 course workspaces upgrade without losing course edits or inventing check-ins', () => {
  const { workspace } = fresh();
  const legacy = parseCourseDemo(JSON.stringify({ version: 1, workspace }));
  const upgraded = parseCourseDemo(serializeCourseDemo(legacy));
  assert.deepEqual(upgraded, workspace);
  assert.equal(JSON.parse(serializeCourseDemo(legacy)).version, 2);
  assert.deepEqual(demoSmsTotals(upgraded.sms?.records ?? []), { sessions: 0, attendees: 0, sessionMinutes: 0, participantMinutes: 0 });
});
test('phone binding is explicit, uses fictional choices, and identifies an exact course', () => {
  const { workspace, course } = fresh();
  const unbound = simulateCourseSms(workspace, phone, '20 2', randomUUID());
  assert.equal(unbound.record, null); assert.equal(unbound.workspace.sms?.quarantined, 1);
  assert.throws(() => bindDemoPhone(workspace, '+14155550123', course.id), /fictional/);
  assert.throws(() => bindDemoPhone(workspace, phone, randomUUID()), /saved program/);
  const bound = bindDemoPhone(workspace, phone, course.id);
  assert.deepEqual(bound.sms?.bindings, [{ phoneId: phone, courseId: course.id }]);
  assert.equal(bound.sms?.records.length, 0);
  assert.equal(bindDemoPhone(bound, phone, null).sms?.bindings.length, 0);
});
test('ordinary numeric SMS updates one course, one organization, and the TPW sum without changing manual summary fields', () => {
  const { workspace, course } = fresh(); const other = workspace.summaries.find(item => item.organizationId !== course.organizationId)!;
  let next = bindDemoPhone(workspace, phone, course.id);
  next = simulateCourseSms(next, phone, '20 2', 'first', '2026-10-25T01:00:00.000Z').workspace;
  next = bindDemoPhone(next, 'fictional-02', other.id);
  next = simulateCourseSms(next, 'fictional-02', '7 1.5', 'second', '2026-10-25T01:01:00.000Z').workspace;
  assert.deepEqual(next.summaries, workspace.summaries);
  assert.deepEqual(demoCourseAttendance(next, course.id)?.totals, { sessions: 1, attendees: 20, sessionMinutes: 120, participantMinutes: 2400 });
  assert.deepEqual(demoSmsTotals(next.sms!.records), { sessions: 2, attendees: 27, sessionMinutes: 210, participantMinutes: 3030 });
  assert.equal(demoSmsTotals(next.sms!.records.filter(item => item.courseSnapshot.organizationId === course.organizationId)).attendees, 20);
  assert.equal(demoSmsTotals(next.sms!.records.filter(item => item.courseSnapshot.organizationId === other.organizationId)).attendees, 7);
});
test('zero is a real point; rejected messages and unbound senders never change any counted totals', () => {
  const { workspace, course } = fresh();
  let next = bindDemoPhone(workspace, phone, course.id);
  next = simulateCourseSms(next, phone, '0 0.25', 'zero').workspace;
  const before = demoSmsTotals(next.sms!.records);
  for (const body of ['twenty two', '01 2', '20\t2', '20 0', '20 1.3', '20 2 extra', '-1 2']) next = simulateCourseSms(next, phone, body, randomUUID()).workspace;
  next = simulateCourseSms(next, 'unknown', '20 2', randomUUID()).workspace;
  assert.deepEqual(demoSmsTotals(next.sms!.records), before);
  assert.equal(next.sms!.quarantined, 8);
  const data = demoCourseAttendance(next, course.id)!;
  assert.equal(data.points.length, 1); assert.equal(data.points[0].attendees, 0); assert.equal(data.totals.sessions, 1);
});
test('rebinding changes future texts only and receipt-time names/location/dates remain immutable', () => {
  const { workspace, course } = fresh(); const other = workspace.summaries.find(item => item.id !== course.id)!;
  let next = bindDemoPhone(workspace, phone, course.id);
  next = simulateCourseSms(next, phone, '20 2', 'original', '2026-10-25T01:00:00.000Z').workspace;
  const original = structuredClone(next.sms!.records[0]);
  next = applyDemoMetadata(next, { action: 'program', id: course.programId, organizationId: course.organizationId, name: 'Renamed program' }, randomUUID());
  next = applyDemoCourseSave(next, { ...write(course), facility: 'Updated existing label', yard: 'Other yard', startDate: '2026-09-08' });
  next = bindDemoPhone(next, phone, other.id);
  next = simulateCourseSms(next, phone, '3 1', 'new', '2026-10-25T01:01:00.000Z').workspace;
  assert.deepEqual(next.sms!.records[0], original);
  assert.equal(demoCourseAttendance(next, course.id)!.totals.sessions, 1);
  assert.equal(demoCourseAttendance(next, other.id)!.totals.sessions, 1);
  assert.equal(demoCourseAttendance(next, course.id)!.points[0].courseSnapshot.facility, course.facility);
});
test('bound or historically referenced courses cannot move program; unreferenced metadata may change', () => {
  const { workspace, course } = fresh(); const programId = workspace.programs.find(item => item.organizationId === course.organizationId && item.id !== course.programId)!.id;
  assert.equal(applyDemoCourseSave(workspace, { ...write(course), programId }).summaries[0].programId, programId);
  const bound = bindDemoPhone(workspace, phone, course.id);
  assert.throws(() => applyDemoCourseSave(bound, { ...write(course), programId }), /binding or check-in history/);
  const counted = simulateCourseSms(bound, phone, '1 1', 'history').workspace;
  const unbound = bindDemoPhone(counted, phone, null);
  assert.throws(() => applyDemoCourseSave(unbound, { ...write(course), programId }), /binding or check-in history/);
});
test('replayed simulation IDs cannot double count, and receipt order is explicit rather than class dates', () => {
  const { workspace, course } = fresh(); let next = bindDemoPhone(workspace, phone, course.id);
  next = simulateCourseSms(next, phone, '3 1', 'later', '2026-10-25T02:00:00Z').workspace;
  next = simulateCourseSms(next, phone, '2 1', 'earlier', '2026-10-25T01:00:00Z').workspace;
  next = simulateCourseSms(next, phone, '3 1', 'later', '2026-10-25T03:00:00Z').workspace;
  const data = demoCourseAttendance(next, course.id)!;
  assert.equal(data.sequenceBasis, 'receipt-order'); assert.equal(data.totals.sessions, 2);
  assert.deepEqual(data.points.map(item => [item.id, item.sequence]), [['earlier', 1], ['later', 2]]);
});
test('shared serialization preserves binding, snapshots, zero values and quarantines; corrupt extensions fail closed', () => {
  const { workspace, course } = fresh();
  let next = simulateCourseSms(bindDemoPhone(workspace, phone, course.id), phone, '0 0.25', 'zero').workspace;
  next = simulateCourseSms(next, 'unknown', '4 1', 'invalid').workspace;
  assert.deepEqual(parseCourseDemo(serializeCourseDemo(next)), next);
  const corrupt = structuredClone(next); corrupt.sms!.records[0].participantMinutes = 100;
  assert.throws(() => parseCourseDemo(serializeCourseDemo(corrupt)), /could not be read/);
  const corruptPhone = structuredClone(next); corruptPhone.sms!.bindings[0].phoneId = '+14155550123';
  assert.throws(() => parseCourseDemo(serializeCourseDemo(corruptPhone)), /could not be read/);
  assert.throws(() => parseCourseDemo('{'), SyntaxError);
});
test('shared locked mutations preserve simultaneous course saves, bindings and check-ins from stale views', async () => {
  const { workspace, course } = fresh(); const options = store(workspace);
  await Promise.all([
    updateCourseDemo(latest => applyDemoCourseSave(latest, { ...write(course), participants: 99 }), options),
    updateCourseDemo(latest => bindDemoPhone(latest, phone, course.id), options),
    updateCourseDemo(latest => simulateCourseSms(latest, phone, '20 2', 'concurrent').workspace, options),
  ]);
  const saved = readCourseDemo(options.storage);
  assert.equal(saved.summaries.find(item => item.id === course.id)?.participants, 99);
  assert.equal(saved.sms?.bindings.length, 1); assert.equal(saved.sms?.records.length, 1);
  assert.equal(saved.sms?.records[0].attendees, 20);
  await assert.rejects(updateCourseDemo(latest => applyDemoCourseSave(latest, { ...write(course), participants: 100 }), options), /changed/);
  assert.equal(readCourseDemo(options.storage).sms?.records.length, 1);
});
test('reset removes bindings and records together, changes generation, and can explicitly recover unreadable storage', async () => {
  const { workspace, course } = fresh(); const options = store(simulateCourseSms(bindDemoPhone(workspace, phone, course.id), phone, '20 2', 'one').workspace);
  const reset = await updateCourseDemo(latest => latest, options, true);
  assert.equal(reset.sms, undefined); assert.notEqual(reset.demoGeneration, workspace.demoGeneration);
  options.storage.setItem(COURSE_DEMO_STORAGE_KEY, 'corrupt');
  await assert.rejects(updateCourseDemo(latest => latest, options));
  const recovered = await updateCourseDemo(latest => latest, options, true);
  assert.equal(recovered.summaries.length, createCourseDemo().summaries.length);
});
test('yard choices are reused only for the same organization and exact saved facility', () => {
  const { workspace, course } = fresh();
  const copy = { ...write(course), id: randomUUID(), revision: 0, yard: 'C Yard' };
  const next = applyDemoCourseSave(workspace, copy);
  assert.deepEqual(savedCourseYards(next, course.organizationId, course.facility!), ['A Yard', 'C Yard']);
  assert.deepEqual(savedCourseYards(next, 'other-org', course.facility!), []);
  assert.deepEqual(savedCourseYards(next, course.organizationId, 'other-facility'), []);
  assert.match(courseDemoLabel(course), new RegExp(course.id.slice(-8)));
});
test('synthetic UI stays local while live course chart uses authorized non-overlapping poll helper', () => {
  const demo = readFileSync('src/components/SmsDemo.tsx', 'utf8');
  assert.doesNotMatch(demo, /fetch\(|smsRequest\(|useSmsLive|\/api\//);
  assert.match(demo, /updateCourseDemo/); assert.match(demo, /Save phone’s program/);
  const maintenance = readFileSync('src/components/CourseMaintenance.tsx', 'utf8');
  assert.match(maintenance, /resetCourseDemo[\s\S]*setSearch\(''\); setProgramFilter\(''\)/);
  assert.match(maintenance, /requireDraftGeneration\(latest\)/);
  const attendance = readFileSync('src/components/CourseAttendance.tsx', 'utf8');
  assert.match(attendance, /useSmsLive<CourseAttendanceData>[\s\S]*1000/);
  assert.match(attendance, /Message receipt order/);
  assert.doesNotMatch(attendance, /senderPhone|teacherName|messageSid|rawBody/);
});


test('reload initializes the selected fictional sender from its saved binding, not the seeded in-progress course', () => {
  const { workspace, course: seededDefault } = fresh();
  const boundCourse = workspace.summaries.find(item => item.id !== seededDefault.id && item.organizationId !== seededDefault.organizationId)!;
  const saved = parseCourseDemo(serializeCourseDemo(bindDemoPhone(workspace, phone, boundCourse.id)));
  assert.deepEqual(initialCourseDemoSelection(saved, phone), { courseId: boundCourse.id, bindingCourseId: boundCourse.id, organizationId: boundCourse.organizationId });
  // Each selected sender resolves only its own binding; another teacher is not auto-enrolled.
  assert.deepEqual(initialCourseDemoSelection(saved, 'fictional-02'), { courseId: seededDefault.id, bindingCourseId: '', organizationId: seededDefault.organizationId });
});
test('explicit course links select a graph without changing the saved phone binding', () => {
  const { workspace, course: linkedCourse } = fresh();
  const boundCourse = workspace.summaries.find(item => item.id !== linkedCourse.id)!;
  const saved = bindDemoPhone(workspace, phone, boundCourse.id);
  const before = serializeCourseDemo(saved);
  assert.deepEqual(initialCourseDemoSelection(saved, phone, linkedCourse.id), { courseId: linkedCourse.id, bindingCourseId: boundCourse.id, organizationId: linkedCourse.organizationId });
  assert.equal(serializeCourseDemo(saved), before);
  assert.equal(initialCourseDemoSelection(saved, phone, 'missing').courseId, boundCourse.id);
});
test('initial demo selection handles absent or stale bindings and an empty workspace without creating choices', () => {
  const { workspace, course } = fresh();
  assert.deepEqual(initialCourseDemoSelection(workspace, phone), { courseId: course.id, bindingCourseId: '', organizationId: course.organizationId });
  const stale = { ...workspace, sms: { version: 1 as const, bindings: [{ phoneId: phone, courseId: 'missing' }], records: [], quarantined: 0 } };
  assert.deepEqual(initialCourseDemoSelection(stale, phone), initialCourseDemoSelection(workspace, phone));
  assert.deepEqual(initialCourseDemoSelection({ organizations: [], programs: [], summaries: [] }, phone), { courseId: '', bindingCourseId: '', organizationId: '' });
});
test('saved-binding initialization runs only on initial load and later installs retain deliberate selections', () => {
  const source = readFileSync('src/components/SmsDemo.tsx', 'utf8');
  const installStart = source.indexOf('const install =');
  const install = source.slice(installStart, source.indexOf('useEffect(() =>', installStart));
  assert.doesNotMatch(install, /initialCourseDemoSelection/);
  assert.match(install, /setCourseId\(current => next.summaries.some\(item => item.id === current\) \? current : fallback/);
  assert.match(install, /setBindingCourseId\(current => next.summaries.some\(item => item.id === current\) \? current : ''\)/);
  assert.match(source, /async function initialize\(\)[\s\S]*initialCourseDemoSelection\(next, COURSE_DEMO_PHONES\[0\].id, requestedCourse.current\)/);
  assert.equal((source.match(/initialCourseDemoSelection\(/g) ?? []).length, 1);
});
test('dirty course and name drafts show an explicit save notice and best-effort unload compatibility without adding storage', () => {
  const source = readFileSync('src/components/CourseMaintenance.tsx', 'utf8');
  assert.match(source, /event.preventDefault\(\); event.returnValue = '';/);
  assert.match(source, /\{dirty && <div className="cm-alert" role="status">You have unsaved changes. Save before leaving or reloading to keep them./);
  assert.match(source, /Changes stay in this browser. Live records stay unchanged./);
  assert.doesNotMatch(source, /Your edits stay in this browser|sessionStorage/);
});


test('repeat shortcut creates a new session from the same phone and current course, including zero values', () => {
  const { workspace, course } = fresh();
  const bound = bindDemoPhone(workspace, phone, course.id);
  const numeric = simulateCourseSms(bound, phone, '0 0.25', 'numeric', '2026-10-25T00:00:01Z');
  const repeated = simulateCourseSms(numeric.workspace, phone, ' 1 ', 'repeat', '2026-10-25T00:00:02Z');
  assert.equal(repeated.reason, null); assert.equal(repeated.record?.repeatedFromRecordId, 'numeric');
  assert.equal(repeated.record?.phoneId, phone); assert.equal(repeated.record?.attendees, 0); assert.equal(repeated.record?.sessionMinutes, 15);
  assert.deepEqual(demoSmsTotals(repeated.workspace.sms!.records), { sessions: 2, attendees: 0, sessionMinutes: 30, participantMinutes: 0 });
  const replay = simulateCourseSms(repeated.workspace, phone, '1', 'repeat');
  assert.strictEqual(replay.workspace, repeated.workspace);
  assert.deepEqual(parseCourseDemo(serializeCourseDemo(repeated.workspace)), repeated.workspace);
});
test('repeat baseline follows latest accepted append, not receipt date or UUID order', () => {
  const { workspace, course } = fresh();
  let next = bindDemoPhone(workspace, phone, course.id);
  next = simulateCourseSms(next, phone, '20 2', 'zz-first', '2026-10-25T00:00:02Z').workspace;
  next = simulateCourseSms(next, phone, '7 1.5', 'aa-later', '2026-10-25T00:00:01Z').workspace;
  assert.equal(latestDemoRepeatBaseline(next, phone)?.id, 'aa-later');
  const repeated = simulateCourseSms(next, phone, '1', 'new-repeat');
  assert.equal(repeated.record?.attendees, 7); assert.equal(repeated.record?.sessionMinutes, 90);
  assert.equal(repeated.record?.repeatedFromRecordId, 'aa-later');
  // Course graph continues to have its independently labelled receipt-order sequence.
  assert.equal(demoCourseAttendance(repeated.workspace, course.id)?.points[0].id, 'aa-later');
});
test('repeat cannot copy another sender, another course, inactive mappings or unassigned old demo history', () => {
  const { workspace, course } = fresh();
  const other = workspace.summaries.find(item => item.id !== course.id)!;
  let next = bindDemoPhone(bindDemoPhone(workspace, phone, course.id), 'fictional-02', course.id);
  next = simulateCourseSms(next, phone, '20 2', 'first').workspace;
  const otherPhone = simulateCourseSms(next, 'fictional-02', '1', 'second');
  assert.equal(otherPhone.record, null); assert.match(otherPhone.reason!, /two numbers first/);
  const rebound = bindDemoPhone(next, phone, other.id);
  assert.equal(simulateCourseSms(rebound, phone, '1', 'rebound').record, null);
  const unbound = bindDemoPhone(next, phone, null);
  assert.equal(simulateCourseSms(unbound, phone, '1', 'unbound').record, null);
  const inactive = { ...next, organizations: next.organizations.map(item => item.id === course.organizationId ? { ...item, active: false } : item) };
  assert.equal(simulateCourseSms(inactive, phone, '1', 'inactive').record, null);
  const legacy = { ...next, sms: { ...next.sms!, records: next.sms!.records.map(({ phoneId: ignored, ...record }) => record) } };
  assert.equal(simulateCourseSms(legacy, phone, '1', 'legacy').record, null);
  assert.equal(parseCourseDemo(serializeCourseDemo(legacy)).sms?.records.length, 1);
});
test('failed repeat never becomes a baseline and new repeats follow the latest numeric correction', () => {
  const { workspace, course } = fresh(); let next = bindDemoPhone(workspace, phone, course.id);
  next = simulateCourseSms(next, phone, '1', 'no-baseline').workspace;
  assert.equal(next.sms?.records.length, 0); assert.equal(next.sms?.quarantined, 1);
  next = simulateCourseSms(next, phone, '20 2', 'first').workspace;
  next = simulateCourseSms(next, phone, '1', 'repeat-first').workspace;
  next = simulateCourseSms(next, phone, '31 3', 'correction').workspace;
  const final = simulateCourseSms(next, phone, '1', 'repeat-correction');
  assert.equal(final.record?.repeatedFromRecordId, 'correction'); assert.equal(final.record?.attendees, 31); assert.equal(final.record?.sessionMinutes, 180);
  for (const body of ['01', '1 now', '1 2 3', '1\n1']) assert.equal(simulateCourseSms(final.workspace, phone, body, 'invalid-'+body).record, null);
  const modified = structuredClone(final.workspace); modified.sms!.records.at(-1)!.repeatedFromRecordId = 'no-baseline';
  assert.throws(() => parseCourseDemo(serializeCourseDemo(modified)), /repeat source/);
});
