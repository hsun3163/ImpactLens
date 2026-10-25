import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COURSE_SUMMARY_STATUS_LABELS, courseSummaryToDraft } from '../src/lib/course-summary';
import { CDCR_FACILITIES, anotherCourseDraft, applyDemoCourseSave, applyDemoMetadata, courseDerivedValues, createCourseDemo, maintenanceDraftToWrite, newCourseDraft, parseCourseDemo, serializeCourseDemo } from '../src/lib/course-maintenance';

test('facility vocabulary and status labels match the audited existing source', () => {
  assert.equal(CDCR_FACILITIES.length, 31); assert.equal(new Set(CDCR_FACILITIES).size, 31);
  assert.equal(CDCR_FACILITIES[0], 'Avenal State Prison (ASP)');
  assert.equal(CDCR_FACILITIES[13], 'California State Prison, Centinela (CEN)');
  assert.equal(CDCR_FACILITIES[30], 'Wasco State Prison (WSP)');
  assert.deepEqual(Object.values(COURSE_SUMMARY_STATUS_LABELS), ['Planned', 'In Progress', 'Completed']);
});
test('new course reuses only organization, program and site, not historical values', () => {
  const source = createCourseDemo().summaries.find(item => item.status === 'completed')!;
  const next = anotherCourseDraft(source);
  assert.equal(next.organizationId, source.organizationId); assert.equal(next.programId, source.programId);
  assert.equal(next.facility, source.facility); assert.equal(next.yard, source.yard ?? '');
  assert.equal(next.status, 'planned'); assert.equal(next.revision, 0); assert.equal(next.id, '');
  for (const key of ['startDate', 'endDate', 'courseHoursPerParticipant', 'participants', 'completers', 'notes'] as const) assert.equal(next[key], '');
  const write = maintenanceDraftToWrite(next, randomUUID());
  for (const key of ['startDate', 'endDate', 'courseHoursPerParticipant', 'participants', 'completers', 'notes'] as const) assert.equal(write[key], null);
});
test('source facility choices are enforced without silently migrating legacy values', () => {
  const source = createCourseDemo().summaries[0]; const draft = courseSummaryToDraft(source);
  assert.throws(() => maintenanceDraftToWrite({ ...draft, facility: 'Invented facility' }, draft.id), /Choose a CDCR facility/);
  assert.equal(maintenanceDraftToWrite({ ...draft, facility: '' }, draft.id).facility, null);
  const legacy = { ...source, facility: 'Existing legacy label' };
  assert.equal(maintenanceDraftToWrite(courseSummaryToDraft(legacy), legacy.id, legacy).facility, legacy.facility);
  assert.throws(() => maintenanceDraftToWrite({ ...courseSummaryToDraft(legacy), facility: 'Another guessed label' }, legacy.id, legacy), /Choose a CDCR facility/);
});
test('demo saves, edits, identical separate courses and reloads preserve zero versus null', () => {
  let workspace = createCourseDemo(); const source = workspace.summaries[0];
  const draft = newCourseDraft(source.organizationId, source.programId);
  const write = maintenanceDraftToWrite({ ...draft, participants: '0', completers: '', courseHoursPerParticipant: '' }, randomUUID());
  workspace = applyDemoCourseSave(workspace, write);
  workspace = applyDemoCourseSave(workspace, { ...write, id: randomUUID() });
  const records = workspace.summaries.filter(item => item.participants === 0); assert.equal(records.length, 2);
  assert.notEqual(records[0].id, records[1].id);
  workspace = applyDemoCourseSave(workspace, { ...write, revision: 1, participants: 4 });
  const reloaded = parseCourseDemo(serializeCourseDemo(workspace));
  const saved = reloaded.summaries.find(item => item.id === write.id)!;
  assert.equal(saved.participants, 4); assert.equal(saved.completers, null); assert.equal(saved.courseHoursPerParticipant, null); assert.equal(saved.revision, 2);
  assert.throws(() => applyDemoCourseSave(workspace, { ...write, revision: 1, participants: 6 }), /changed/);
});
test('creating and renaming reusable context preserves course identities and results', () => {
  let workspace = createCourseDemo(); const source = workspace.summaries[0];
  const before = workspace.summaries.map(item => ({ id: item.id, participants: item.participants }));
  workspace = applyDemoMetadata(workspace, { action: 'organization', id: source.organizationId, name: 'Renamed demo' }, randomUUID());
  workspace = applyDemoMetadata(workspace, { action: 'program', id: source.programId, organizationId: source.organizationId, name: 'Renamed program' }, randomUUID());
  assert.deepEqual(workspace.summaries.map(item => ({ id: item.id, participants: item.participants })), before);
  const programId = randomUUID(); workspace = applyDemoMetadata(workspace, { action: 'program', organizationId: source.organizationId, name: 'Another saved program' }, programId);
  assert.equal(workspace.programs.find(item => item.id === programId)?.name, 'Another saved program');
});
test('derived values use start year and completers, never participant counts or blank-as-zero', () => {
  assert.deepEqual(courseDerivedValues({ startDate: '2025-12-01', courseHoursPerParticipant: 39, completers: 25 }), { programYear: '2025', completedParticipantHours: 975 });
  assert.deepEqual(courseDerivedValues({ startDate: null, courseHoursPerParticipant: 0, completers: null }), { programYear: null, completedParticipantHours: null });
  assert.equal(courseDerivedValues({ startDate: null, courseHoursPerParticipant: 0, completers: 25 }).completedParticipantHours, 0);
});
test('demo is browser-local and course UI never reads raw admin messages or requires SMS setup', () => {
  const source = readFileSync('src/components/CourseMaintenance.tsx', 'utf8');
  assert.doesNotMatch(source, /\/api\/sms\/(?:admin|dashboard|inbound|report)/);
  assert.doesNotMatch(source, /senderPhone|teacherId|TWILIO|sms_records|sms_aggregates|webhookConfigured/);
  assert.match(source, /if \(demo\) \{[\s\S]*?localStorage[\s\S]*?return;[\s\S]*?\/api\/sms\/session/);
  assert.match(source, /My courses/); assert.match(source, /Add another like this/); assert.match(source, /cm-inline-program/);
  assert.match(source, /No phone number or SMS setup needed/);
  assert.match(readFileSync('src/app/demo/courses/page.tsx', 'utf8'), /CourseMaintenance demo/);
});

test('demo metadata create IDs safely replay an uncertain name save without merging unrelated names', () => {
  const workspace = createCourseDemo(); const createId = randomUUID();
  const input = { action: 'program' as const, organizationId: workspace.organizations[0].id, createId, name: 'One program' };
  const created = applyDemoMetadata(workspace, input, randomUUID());
  const replay = applyDemoMetadata(created, input, randomUUID());
  assert.equal(replay.programs.length, workspace.programs.length + 1);
  assert.equal(replay.programs.find(item => item.id === createId)?.name, 'One program');
  assert.throws(() => applyDemoMetadata(created, { ...input, name: 'Another program' }, randomUUID()), /already used/);
});
