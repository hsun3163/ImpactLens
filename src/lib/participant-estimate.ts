/** Participant estimates are separate from summed attendance and session audit totals. */
export type ParticipantEstimate = { value: number | null; source: 'sms-maximum' | 'configured-maximum' | 'unknown' };
export type ParticipantEstimateTotals = { participants: number; programCount: number; missingValuesCount: number };
const knownCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
export function participantMaximum(values: readonly (number | null | undefined)[]): number | null {
  let maximum: number | null = null;
  for (const value of values) if (knownCount(value)) maximum = maximum === null ? value : Math.max(maximum, value);
  return maximum;
}
export function programParticipantEstimate(observed: { sessions: number; maximumAttendance: number | null; hasReversedHistory?: boolean }, configuredMaximum: number | null): ParticipantEstimate {
  if (!knownCount(observed.sessions)) return { value: null, source: 'unknown' };
  if (observed.sessions > 0) return knownCount(observed.maximumAttendance) ? { value: observed.maximumAttendance, source: 'sms-maximum' } : { value: null, source: 'unknown' };
  if (observed.hasReversedHistory) return { value: 0, source: 'sms-maximum' };
  return knownCount(configuredMaximum) ? { value: configuredMaximum, source: 'configured-maximum' } : { value: null, source: 'unknown' };
}
export function sumParticipantEstimates(programs: readonly { organizationId: string; programId: string; participantEstimate: ParticipantEstimate }[]): ParticipantEstimateTotals {
  const seen = new Set<string>(); const total = { participants: 0, programCount: 0, missingValuesCount: 0 };
  for (const program of programs) {
    const key = JSON.stringify([program.organizationId, program.programId]);
    if (seen.has(key)) continue; seen.add(key); total.programCount++;
    if (program.participantEstimate.value === null) total.missingValuesCount++;
    else total.participants += program.participantEstimate.value;
  }
  return total;
}
export function participantEstimateTotalValue(total: ParticipantEstimateTotals | null | undefined): number | null {
  return !total || (total.programCount > 0 && total.missingValuesCount === total.programCount) ? null : total.participants;
}
