import { parseSmsCommand } from './sms';
import { participantMaximum, programParticipantEstimate, sumParticipantEstimates } from './participant-estimate';
import { courseServiceEstimate, sumCourseServiceEstimates } from './course-estimate';
import { COURSE_DEMO_STORAGE_KEY, createCourseDemo, parseCourseDemo, serializeCourseDemo, type CourseWorkspace, type DemoCourseSms, type DemoCourseSmsRecord } from './course-maintenance';
import type { CourseAttendanceData } from './course-attendance';
import type { CourseSummary } from './course-summary';

/** Reserved fictional phone choices only. This rehearsal does not collect real contacts. */
export const COURSE_DEMO_PHONES = [
  { id: 'fictional-01', name: 'Demo facilitator 1', phone: '+1 202-555-0101' },
  { id: 'fictional-02', name: 'Demo facilitator 2', phone: '+1 202-555-0102' },
  { id: 'fictional-03', name: 'Demo facilitator 3', phone: '+1 202-555-0103' },
] as const;
export const COURSE_DEMO_CHANGED_EVENT = 'impactlens:course-demo-changed';
export const emptyDemoSms = (): DemoCourseSms => ({ version: 1, bindings: [], records: [], quarantined: 0 });
export function courseDemoLabel(course: Pick<CourseSummary, 'id' | 'programName' | 'facility' | 'yard' | 'startDate' | 'endDate'>) {
  return `${course.programName} · ${course.facility || 'Choose a facility'}${course.yard ? ` / ${course.yard}` : ''} · ${course.startDate || 'Choose a start date'} → ${course.endDate || 'Choose an end date'} · ${course.id.slice(-8)}`;
}
/** Initial UI choices only: a course link changes the graph, never the saved binding. */
export function initialCourseDemoSelection(workspace: CourseWorkspace, phoneId: string, requestedCourseId = '') {
  const binding = workspace.sms?.bindings.find(item => item.phoneId === phoneId);
  const boundCourse = workspace.summaries.find(item => item.id === binding?.courseId);
  const viewedCourse = workspace.summaries.find(item => item.id === requestedCourseId) ?? boundCourse
    ?? workspace.summaries.find(item => item.status === 'in-progress') ?? workspace.summaries[0];
  return { courseId: viewedCourse?.id ?? '', bindingCourseId: boundCourse?.id ?? '',
    organizationId: viewedCourse?.organizationId ?? workspace.organizations[0]?.id ?? '' };
}
export function bindDemoPhone(workspace: CourseWorkspace, phoneId: string, courseId: string | null): CourseWorkspace {
  if (!COURSE_DEMO_PHONES.some(item => item.id === phoneId)) throw new Error('Choose one of the fictional demo phones.');
  const course = workspace.summaries.find(item => item.id === courseId);
  if (courseId && (!course || !workspace.organizations.some(item => item.id === course.organizationId && item.active)
    || !workspace.programs.some(item => item.id === course.programId && item.organizationId === course.organizationId && item.active))) throw new Error('Choose a saved program with an active organization and program.');
  const sms = workspace.sms ?? emptyDemoSms();
  return { ...workspace, sms: { ...sms, bindings: [...sms.bindings.filter(item => item.phoneId !== phoneId), ...(courseId ? [{ phoneId, courseId }] : [])] } };
}
/** Latest accepted value, not receipt time: array appends are serialized by the shared lock. */
export function latestDemoRepeatBaseline(workspace: CourseWorkspace, phoneId: string): DemoCourseSmsRecord | null {
  const courseId = workspace.sms?.bindings.find(item => item.phoneId === phoneId)?.courseId;
  const course = workspace.summaries.find(item => item.id === courseId);
  if (!course) return null;
  return [...(workspace.sms?.records ?? [])].reverse().find(record => record.phoneId === phoneId && record.courseId === course.id
    && record.courseSnapshot.organizationId === course.organizationId && record.courseSnapshot.programId === course.programId
    && Number.isInteger(record.attendees) && record.attendees >= 0 && record.attendees <= 10000
    && Number.isInteger(record.sessionMinutes) && record.sessionMinutes >= 15 && record.sessionMinutes <= 1440 && record.sessionMinutes % 15 === 0) ?? null;
}
/** Receipt-time attribution is a snapshot, never recomputed from a changed binding. */
export function simulateCourseSms(workspace: CourseWorkspace, phoneId: string, body: string, id: string, now = new Date().toISOString()) {
  const sms = workspace.sms ?? emptyDemoSms();
  // A replay of the same simulation operation cannot add another session.
  if (sms.records.some(item => item.id === id)) return { workspace, record: sms.records.find(item => item.id === id)!, reason: null };
  const parsed = parseSmsCommand(body);
  const binding = sms.bindings.find(item => item.phoneId === phoneId);
  const course = workspace.summaries.find(item => item.id === binding?.courseId);
  const organization = workspace.organizations.find(item => item.id === course?.organizationId);
  const program = workspace.programs.find(item => item.id === course?.programId && item.organizationId === course?.organizationId);
  const baseline = parsed.ok && parsed.kind === 'repeat' ? latestDemoRepeatBaseline(workspace, phoneId) : null;
  const metrics = parsed.ok ? parsed.kind === 'numeric' ? parsed.metrics : baseline ? { attendees: baseline.attendees, sessionMinutes: baseline.sessionMinutes } : null : null;
  const reason = !parsed.ok ? parsed.reason : !course || !organization || !program ? 'Save a program for this fictional phone first.'
    : !organization.active || !program.active ? 'This program’s organization or program is inactive.'
    : !metrics ? 'Send two numbers first for this phone and program, for example 20 2.' : null;
  if (reason || !metrics || !course || !organization || !program) {
    return { workspace: { ...workspace, sms: { ...sms, quarantined: sms.quarantined + 1 } }, record: null, reason };
  }
  const { facility, yard, startDate, endDate } = course;
  const record: DemoCourseSmsRecord = { id, phoneId, ...(baseline ? { repeatedFromRecordId: baseline.id } : {}), courseId: course.id, receivedAt: now, processedAt: now,
    ...metrics, participantMinutes: metrics.attendees * metrics.sessionMinutes,
    courseSnapshot: { id: course.id, organizationId: organization.id, programId: program.id, organizationName: organization.name, programName: program.name, facility, yard, startDate, endDate } };
  return { workspace: { ...workspace, sms: { ...sms, records: [...sms.records, record] } }, record, reason: null };
}
export function demoSmsTotals(records: DemoCourseSmsRecord[]) {
  return records.reduce((total, record) => ({ sessions: total.sessions + 1, attendees: total.attendees + record.attendees,
    sessionMinutes: total.sessionMinutes + record.sessionMinutes, participantMinutes: total.participantMinutes + record.participantMinutes }),
  { sessions: 0, attendees: 0, sessionMinutes: 0, participantMinutes: 0 });
}
/** Derive the estimate afresh; phone assignments never alter actual SMS history. */
export function demoCourseServiceEstimate(workspace: CourseWorkspace, organizationId?: string) {
  const bound = new Set((workspace.sms?.bindings ?? []).map(item => item.courseId));
  return sumCourseServiceEstimates(workspace.summaries.filter(course => !organizationId || course.organizationId === organizationId)
    .map(course => ({ id: course.id, serviceEstimate: courseServiceEstimate(course, bound.has(course.id)) })));
}
export function demoProgramParticipantEstimate(workspace: CourseWorkspace, programId: string) {
  const program = workspace.programs.find(item => item.id === programId);
  const records = (workspace.sms?.records ?? []).filter(item => item.courseSnapshot.programId === programId && item.courseSnapshot.organizationId === program?.organizationId);
  const courses = workspace.summaries.filter(item => item.programId === programId && item.organizationId === program?.organizationId);
  return programParticipantEstimate({ sessions: records.length, maximumAttendance: participantMaximum(records.map(item => item.attendees)) }, participantMaximum(courses.map(item => item.participants)));
}
export function demoParticipantEstimate(workspace: CourseWorkspace, organizationId?: string) {
  return sumParticipantEstimates(workspace.programs.filter(item => !organizationId || item.organizationId === organizationId).map(program => ({
    organizationId: program.organizationId, programId: program.id, participantEstimate: demoProgramParticipantEstimate(workspace, program.id),
  })));
}
export function demoCourseAttendance(workspace: CourseWorkspace, courseId: string, now = new Date().toISOString()): CourseAttendanceData | null {
  const course = workspace.summaries.find(item => item.id === courseId);
  if (!course) return null;
  const records = (workspace.sms?.records ?? []).filter(item => item.courseId === courseId)
    .slice().sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  const { id, organizationId, programId, organizationName, programName, facility, yard, status, startDate, endDate } = course;
  return { course: { id, organizationId, programId, organizationName, programName, facility, yard, status, startDate, endDate },
    participantEstimate: programParticipantEstimate({ sessions: records.length, maximumAttendance: participantMaximum(records.map(item => item.attendees)) }, course.participants),
    points: records.map((record, index) => ({ ...record, sequence: index + 1 })), totals: demoSmsTotals(records), generatedAt: now, truncated: false, sequenceBasis: 'receipt-order' };
}
export type CourseDemoStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function readCourseDemo(storage: CourseDemoStorage): CourseWorkspace {
  const stored = storage.getItem(COURSE_DEMO_STORAGE_KEY);
  return stored ? parseCourseDemo(stored) : createCourseDemo();
}
/** All writers read inside the same cross-tab lock. Never write a stale React snapshot. */
export async function updateCourseDemo(mutator: (latest: CourseWorkspace) => CourseWorkspace,
  options?: { storage: CourseDemoStorage; lock: <T>(work: () => T) => Promise<T>; changed?: () => void }, reset = false): Promise<CourseWorkspace> {
  const storage = options?.storage ?? window.localStorage;
  const lock = options?.lock ?? (async <T,>(work: () => T): Promise<T> => {
    if (!navigator.locks) throw new Error('Safe shared demo editing is unavailable in this browser. Your saved work is unchanged. Try a current browser in a secure window.');
    return navigator.locks.request(COURSE_DEMO_STORAGE_KEY, work);
  });
  const next = await lock(() => {
    const latest = reset ? createCourseDemo() : readCourseDemo(storage);
    const next = mutator(latest);
    storage.setItem(COURSE_DEMO_STORAGE_KEY, serializeCourseDemo(next));
    return next;
  });
  if (options) options.changed?.();
  else window.dispatchEvent(new Event(COURSE_DEMO_CHANGED_EVENT));
  return next;
}

/** Explicit reset may replace an unreadable saved demo, but still serializes with all writers. */
export async function resetCourseDemo(): Promise<CourseWorkspace> { return updateCourseDemo(latest => latest, undefined, true); }
