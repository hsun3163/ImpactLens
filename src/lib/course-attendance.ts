import type { ParticipantEstimate } from './participant-estimate';
/** Activity attribution captured when a counted check-in is accepted. Never a class date. */
export type CourseIdentity = {
  id: string; organizationId: string; programId: string; organizationName: string; programName: string;
  facility: string | null; yard: string | null; startDate: string | null; endDate: string | null;
};
export type CourseAttendancePoint = {
  repeatedFromRecordId?: string | null;
  id: string; sequence: number; receivedAt: string; processedAt: string;
  attendees: number; sessionMinutes: number; participantMinutes: number; courseSnapshot: CourseIdentity;
};
export type CourseAttendanceData = {
  course: CourseIdentity & { status: 'planned' | 'in-progress' | 'completed' };
  participantEstimate: ParticipantEstimate;
  points: CourseAttendancePoint[];
  totals: { sessions: number; attendees: number; sessionMinutes: number; participantMinutes: number };
  generatedAt: string; truncated: boolean; sequenceBasis: 'receipt-order';
};
export const COURSE_ATTENDANCE_LIMIT = 1000;
