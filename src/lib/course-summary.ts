/** Manual TPW course summaries are a separate source from SMS session activity. */
export const COURSE_SUMMARY_SOURCE = 'Manual course summary' as const;
export const COURSE_SUMMARY_LIMIT = 100;
export const COURSE_SUMMARY_STATUSES = ['planned', 'in-progress', 'completed'] as const;
export type CourseSummaryStatus = typeof COURSE_SUMMARY_STATUSES[number];
export const COURSE_SUMMARY_STATUS_LABELS: Record<CourseSummaryStatus, string> = {
  planned: 'Planned', 'in-progress': 'In progress', completed: 'Completed',
};
export type CourseSummaryValues = {
  organizationId: string; programId: string; facility: string | null; yard: string | null;
  status: CourseSummaryStatus; startDate: string | null; endDate: string | null;
  courseHoursPerParticipant: number | null; participants: number | null; completers: number | null; notes: string | null;
};
export type CourseSummaryWrite = CourseSummaryValues & { id: string; revision: number };
export type CourseSummary = CourseSummaryWrite & {
  organizationName: string; programName: string; source: typeof COURSE_SUMMARY_SOURCE;
  createdAt: string; updatedAt: string;
};
export type CourseSummaryData = {
  summaries: CourseSummary[];
  organizations: { id: string; name: string; active: boolean }[];
  programs: { id: string; organizationId: string; name: string; active: boolean }[];
  source: typeof COURSE_SUMMARY_SOURCE; limit: number; truncated: boolean; generatedAt: string;
};
export class CourseSummaryError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function courseSummaryId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CourseSummaryError(400, 'INVALID_ID', 'Choose a valid course summary, organization, and program.');
  return value.toLowerCase();
}
function optionalText(value: unknown, name: string, max: number, multiline = false): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) {
    throw new CourseSummaryError(400, 'INVALID_TEXT', `${name} must be text of at most ${max} characters without unsupported control characters.`);
  }
  return value.trim() || null;
}
function optionalDate(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') throw new CourseSummaryError(400, 'INVALID_DATE', `${name} must be a valid YYYY-MM-DD date.`);
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new CourseSummaryError(400, 'INVALID_DATE', `${name} must be a valid calendar date.`);
  return value;
}
function optionalNumber(value: unknown, name: string, integer: boolean): number | null {
  // Empty is unknown, not zero. Numeric strings are parsed by the form, not guessed by the API.
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 || (integer && !Number.isInteger(value))) throw new CourseSummaryError(400, 'INVALID_NUMBER', `${name} must be ${integer ? 'a whole number' : 'a number'} from 0 to 1,000,000, or left blank.`);
  return value;
}
export function validateCourseSummary(value: unknown): CourseSummaryWrite {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CourseSummaryError(400, 'INVALID_JSON', 'A JSON object is required.');
  const body = value as Record<string, unknown>;
  const fields = ['id', 'revision', 'organizationId', 'programId', 'facility', 'yard', 'status', 'startDate', 'endDate', 'courseHoursPerParticipant', 'participants', 'completers', 'notes'];
  if (Object.keys(body).some(key => !fields.includes(key))) throw new CourseSummaryError(400, 'UNKNOWN_FIELD', 'An unsupported course-summary field was submitted.');
  if (typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= Number.MAX_SAFE_INTEGER) throw new CourseSummaryError(400, 'INVALID_REVISION', 'Refresh the saved course summary before editing.');
  if (!COURSE_SUMMARY_STATUSES.includes(body.status as CourseSummaryStatus)) throw new CourseSummaryError(400, 'INVALID_STATUS', 'Choose Planned, In progress, or Completed.');
  const startDate = optionalDate(body.startDate, 'Start date'); const endDate = optionalDate(body.endDate, 'End date');
  if (startDate && endDate && endDate < startDate) throw new CourseSummaryError(400, 'INVALID_DATE_RANGE', 'End date cannot be earlier than start date.');
  const participants = optionalNumber(body.participants, 'Participants', true); const completers = optionalNumber(body.completers, 'Completers', true);
  if (participants !== null && completers !== null && completers > participants) throw new CourseSummaryError(400, 'INVALID_COMPLETERS', 'Completers cannot exceed participants in the same course.');
  return {
    id: courseSummaryId(body.id), revision: body.revision, organizationId: courseSummaryId(body.organizationId), programId: courseSummaryId(body.programId),
    facility: optionalText(body.facility, 'Facility', 150), yard: optionalText(body.yard, 'Yard', 100), status: body.status as CourseSummaryStatus,
    startDate, endDate, courseHoursPerParticipant: optionalNumber(body.courseHoursPerParticipant, 'Course hours per participant', false),
    participants, completers, notes: optionalText(body.notes, 'Notes', 4000, true),
  };
}

/** Exact source fields, not derived SMS totals or unique-person estimates. */
export function sameCourseSummaryValues(a: CourseSummaryValues, b: CourseSummaryValues): boolean {
  return (['organizationId', 'programId', 'facility', 'yard', 'status', 'startDate', 'endDate', 'courseHoursPerParticipant', 'participants', 'completers', 'notes'] as const).every(key => a[key] === b[key]);
}


/** Form-only strings preserve empty inputs; metadata must not leak into a save. */
export type CourseSummaryDraft = {
  id: string; revision: number; organizationId: string; programId: string; facility: string; yard: string;
  status: CourseSummaryStatus | ''; startDate: string; endDate: string;
  courseHoursPerParticipant: string; participants: string; completers: string; notes: string;
};
export function courseSummaryToDraft(summary: CourseSummary): CourseSummaryDraft {
  return {
    id: summary.id, revision: summary.revision, organizationId: summary.organizationId, programId: summary.programId, status: summary.status,
    facility: summary.facility ?? '', yard: summary.yard ?? '', startDate: summary.startDate ?? '', endDate: summary.endDate ?? '',
    courseHoursPerParticipant: summary.courseHoursPerParticipant?.toString() ?? '', participants: summary.participants?.toString() ?? '',
    completers: summary.completers?.toString() ?? '', notes: summary.notes ?? '',
  };
}
export function courseSummaryDraftToWrite(draft: CourseSummaryDraft, id = draft.id): CourseSummaryWrite {
  const numeric = (value: string) => value.trim() === '' ? null : Number(value);
  return validateCourseSummary({ ...draft, id, courseHoursPerParticipant: numeric(draft.courseHoursPerParticipant), participants: numeric(draft.participants), completers: numeric(draft.completers) });
}
