import { ATTENDANCE_RECORDS_SQL } from './attendance-source';
import type { CourseAttendanceData, CourseAttendancePoint, CourseIdentity } from '../lib/course-attendance';
import { programParticipantEstimate } from '../lib/participant-estimate';

/** Overview bounds only. Full totals/peaks are never calculated from a chart slice. */
export const DASHBOARD_COURSE_LIMIT = 100;
export const DASHBOARD_COURSE_POINT_LIMIT = 100;

const SELECTED_COURSES = `SELECT c.id,c.organization_id,c.program_id,o.name organization_name,p.name program_name,
  c.facility,c.yard,c.start_date,c.end_date,c.status,c.participants,c.created_at,EXISTS(SELECT 1 FROM sms_reversals x JOIN sms_records h ON h.id=x.target_record_id WHERE h.course_id=c.id) has_reversed_history
  FROM course_summaries c
  JOIN sms_programs p ON p.id=c.program_id AND p.organization_id=c.organization_id
  JOIN sms_organizations o ON o.id=c.organization_id
  WHERE c.organization_id=? ORDER BY p.name,c.created_at,c.id LIMIT ?`;

/** Append to the dashboard's existing D1 batch so every result shares its snapshot. */
export function dashboardCourseStatements(db: D1Database, organizationId: string): D1PreparedStatement[] {
  return [
    // One extra course is a truncation sentinel, not an implicit omission.
    db.prepare(`WITH selected_courses AS (${SELECTED_COURSES}), totals AS (
      SELECT r.course_id,COUNT(*) sessions,SUM(r.attendees) attendees,SUM(r.session_minutes) session_minutes,
        SUM(r.attendees*r.session_minutes) participant_minutes,MAX(r.attendees) maximum_attendance
      FROM ${ATTENDANCE_RECORDS_SQL} r JOIN selected_courses c ON c.id=r.course_id
        AND c.organization_id=r.organization_id AND c.program_id=r.program_id
      WHERE r.status='counted' GROUP BY r.course_id
    ) SELECT c.*,t.sessions,t.attendees,t.session_minutes,t.participant_minutes,t.maximum_attendance
      FROM selected_courses c LEFT JOIN totals t ON t.course_id=c.id
      ORDER BY c.program_name,c.created_at,c.id`).bind(organizationId, DASHBOARD_COURSE_LIMIT + 1),
    db.prepare(`WITH selected_courses AS (${SELECTED_COURSES}), points AS (
      SELECT r.course_id,r.id,r.received_at,r.processed_at,r.attendees,r.session_minutes,
        r.course_snapshot_json,r.repeated_from_record_id,
        ROW_NUMBER() OVER (PARTITION BY r.course_id ORDER BY r.received_at,r.id) sequence,
        COUNT(*) OVER (PARTITION BY r.course_id) session_count
      FROM ${ATTENDANCE_RECORDS_SQL} r JOIN selected_courses c ON c.id=r.course_id
        AND c.organization_id=r.organization_id AND c.program_id=r.program_id
      WHERE r.status='counted'
    ) SELECT course_id,id,received_at,processed_at,attendees,session_minutes,course_snapshot_json,
        repeated_from_record_id,sequence
      FROM points WHERE sequence>session_count-? ORDER BY course_id,sequence`)
      .bind(organizationId, DASHBOARD_COURSE_LIMIT, DASHBOARD_COURSE_POINT_LIMIT),
  ];
}

export function dashboardCourseAttendance(courseRows: Record<string, unknown>[], pointRows: Record<string, unknown>[], generatedAt: string) {
  const pointsByCourse = new Map<string, CourseAttendancePoint[]>();
  for (const row of pointRows) {
    const courseId = String(row.course_id);
    const points = pointsByCourse.get(courseId) ?? [];
    points.push({ id: String(row.id), sequence: Number(row.sequence), receivedAt: String(row.received_at), processedAt: String(row.processed_at),
      repeatedFromRecordId: row.repeated_from_record_id as string | null,
      attendees: Number(row.attendees), sessionMinutes: Number(row.session_minutes), participantMinutes: Number(row.attendees) * Number(row.session_minutes),
      courseSnapshot: JSON.parse(String(row.course_snapshot_json)) as CourseIdentity });
    pointsByCourse.set(courseId, points);
  }
  const courseAttendance: CourseAttendanceData[] = courseRows.slice(0, DASHBOARD_COURSE_LIMIT).map(row => {
    const totals = { sessions: Number(row.sessions ?? 0), attendees: Number(row.attendees ?? 0),
      sessionMinutes: Number(row.session_minutes ?? 0), participantMinutes: Number(row.participant_minutes ?? 0) };
    return {
      course: { id: String(row.id), organizationId: String(row.organization_id), programId: String(row.program_id),
        organizationName: String(row.organization_name), programName: String(row.program_name), facility: row.facility as string | null,
        yard: row.yard as string | null, startDate: row.start_date as string | null, endDate: row.end_date as string | null,
        status: row.status as CourseAttendanceData['course']['status'] },
      participantEstimate: programParticipantEstimate({ sessions: totals.sessions, hasReversedHistory:Boolean(row.has_reversed_history), maximumAttendance: row.maximum_attendance == null ? null : Number(row.maximum_attendance) }, row.participants == null ? null : Number(row.participants)),
      points: pointsByCourse.get(String(row.id)) ?? [], totals, generatedAt,
      truncated: totals.sessions > DASHBOARD_COURSE_POINT_LIMIT, sequenceBasis: 'receipt-order',
    };
  });
  return { courseAttendance, coursesTruncated: courseRows.length > DASHBOARD_COURSE_LIMIT };
}
