/** Configured whole-course estimates, never SMS activity or completer totals. */
export type CourseServiceEstimate = { hasPhoneBinding: boolean; participantHours: number | null };
export type CourseEstimateTotals = { participantHours: number; courseCount: number; missingValuesCount: number };
export function courseServiceEstimate(course: { participants: number | null; courseHoursPerParticipant: number | null }, hasPhoneBinding: boolean): CourseServiceEstimate {
  const { participants, courseHoursPerParticipant: hours } = course;
  const known = participants !== null && hours !== null && Number.isFinite(participants) && Number.isFinite(hours) && participants >= 0 && hours >= 0;
  return { hasPhoneBinding, participantHours: !hasPhoneBinding && known ? participants * hours : null };
}
export function emptyCourseEstimateTotals(): CourseEstimateTotals { return { participantHours: 0, courseCount: 0, missingValuesCount: 0 }; }
/** One offering per stable course ID; duplicate phone bindings never multiply it. */
export function sumCourseServiceEstimates(courses: readonly { id: string; serviceEstimate: CourseServiceEstimate }[]): CourseEstimateTotals {
  const seen = new Set<string>(); const total = emptyCourseEstimateTotals();
  for (const { id, serviceEstimate } of courses) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (serviceEstimate.hasPhoneBinding) continue;
    total.courseCount++;
    if (serviceEstimate.participantHours === null) total.missingValuesCount++;
    else total.participantHours += serviceEstimate.participantHours;
  }
  return total;
}
