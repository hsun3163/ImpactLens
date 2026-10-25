/** Planning estimates only; never CDCR-confirmed awards or realized savings. */
export const RAC_HOURS_PER_INCREMENT = 52;
export const RAC_DAYS_PER_INCREMENT = 10;
export const RAC_YEAR_DAY_CAP = 40;
export const RAC_ANNUAL_COST = 21534;

/** Hours must already belong to ONE person and ONE RAC credit anniversary year.
 * No cross-person pooling or automatic cross-year carryover is permitted here.
 */
export function estimatePersonYearRac(eligibleHours: number) {
  if (!Number.isFinite(eligibleHours) || eligibleHours < 0) throw new RangeError('Eligible hours must be finite and non-negative.');
  const estimatedDays = Math.min(RAC_YEAR_DAY_CAP, Math.floor(eligibleHours / RAC_HOURS_PER_INCREMENT) * RAC_DAYS_PER_INCREMENT);
  return {
    estimatedDays,
    yearsEquivalent: estimatedDays / 365,
    estimatedCostAvoided: estimatedDays * RAC_ANNUAL_COST / 365,
    hoursTowardNextIncrement: estimatedDays === RAC_YEAR_DAY_CAP ? null : eligibleHours % RAC_HOURS_PER_INCREMENT,
    excessHoursAboveAnnualCap: Math.max(0, eligibleHours - RAC_HOURS_PER_INCREMENT * (RAC_YEAR_DAY_CAP / RAC_DAYS_PER_INCREMENT)),
    annualCapReached: estimatedDays === RAC_YEAR_DAY_CAP,
  };
}

export type EligibleAttendance = { personId: string; creditAnniversaryYear: string; eligibleHours: number };
/** Input requires verified eligible attendance and an explicitly assigned RAC year.
 * A session headcount or participant-hours aggregate is NOT eligible input.
 */
export function estimateRacByPersonYear(records: readonly EligibleAttendance[]) {
  const people = new Map<string, Map<string, number>>();
  for (const record of records) {
    if (!record.personId.trim() || !record.creditAnniversaryYear.trim()) throw new Error('Person and RAC credit anniversary year are required.');
    estimatePersonYearRac(record.eligibleHours);
    const years = people.get(record.personId) ?? new Map<string, number>();
    years.set(record.creditAnniversaryYear, (years.get(record.creditAnniversaryYear) ?? 0) + record.eligibleHours);
    people.set(record.personId, years);
  }
  return [...people].flatMap(([personId, years]) => [...years].map(([creditAnniversaryYear, eligibleHours]) => ({ personId, creditAnniversaryYear, eligibleHours, ...estimatePersonYearRac(eligibleHours) })));
}

/** Continuous attendance-based proxy only, NOT a pooled or individual RAC award.
 * Input is counted-session participant-minutes, never projected course hours.
 * Individual eligibility, 52-hour thresholds and anniversary-year caps are unknown.
 */
export function estimateAggregateRacEquivalent(participantMinutes: number) {
  if (!Number.isFinite(participantMinutes) || participantMinutes < 0) throw new RangeError('Participant minutes must be finite and non-negative.');
  const participantHours = participantMinutes / 60;
  const equivalentDays = participantHours * RAC_DAYS_PER_INCREMENT / RAC_HOURS_PER_INCREMENT;
  return { participantHours, equivalentDays, yearsEquivalent: equivalentDays / 365, costEquivalent: equivalentDays * RAC_ANNUAL_COST / 365 };
}
