import { emptyCourseEstimateTotals, type CourseEstimateTotals } from '../lib/course-estimate';

/** Disabled is still bound. Unbinding changes this estimate, never SMS history. */
export const COURSE_HAS_PHONE_BINDING = `EXISTS (SELECT 1 FROM sms_teachers t WHERE t.course_id=s.id)`;
/** Aggregate ALL scoped offerings, independently of the course-list display cap. */
export function courseEstimateStatement(db: D1Database, organizationId: string | null) {
  return db.prepare(`WITH bound_courses AS (SELECT DISTINCT course_id FROM sms_teachers WHERE course_id IS NOT NULL), offerings AS (
    SELECT s.organization_id,s.program_id,s.participants,s.course_hours_per_participant,(b.course_id IS NOT NULL) has_phone_binding
    FROM course_summaries s LEFT JOIN bound_courses b ON b.course_id=s.id JOIN sms_programs p ON p.id=s.program_id AND p.organization_id=s.organization_id
    JOIN sms_organizations o ON o.id=s.organization_id ${organizationId ? 'WHERE s.organization_id=?' : ''}
  ) SELECT organization_id,program_id,
    COALESCE(SUM(CASE WHEN has_phone_binding=0 AND participants IS NOT NULL AND course_hours_per_participant IS NOT NULL
      THEN participants*course_hours_per_participant ELSE 0 END),0) participant_hours,
    SUM(has_phone_binding=0) course_count,
    SUM(has_phone_binding=0 AND (participants IS NULL OR course_hours_per_participant IS NULL)) missing_values_count
  FROM offerings GROUP BY organization_id,program_id`).bind(...(organizationId ? [organizationId] : []));
}
export function courseEstimateGroups(rows: Record<string, unknown>[]) {
  const total = emptyCourseEstimateTotals();
  const organizations = new Map<string, CourseEstimateTotals>(); const programs = new Map<string, CourseEstimateTotals>();
  const add = (target: CourseEstimateTotals, value: CourseEstimateTotals) => {
    target.participantHours += value.participantHours; target.courseCount += value.courseCount; target.missingValuesCount += value.missingValuesCount;
  };
  for (const row of rows) {
    const value = { participantHours: Number(row.participant_hours), courseCount: Number(row.course_count), missingValuesCount: Number(row.missing_values_count) };
    const organizationId = String(row.organization_id); const organization = organizations.get(organizationId) ?? emptyCourseEstimateTotals();
    add(total, value); add(organization, value); organizations.set(organizationId, organization); programs.set(String(row.program_id), value);
  }
  return { total, organizations, programs };
}
