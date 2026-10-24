import type { AggregateRow, CohortComparison, CohortSummary } from './types';

const Z_95 = 1.959963984540054;

/** Wilson score interval for a binomial proportion, returned on the 0..1 scale. */
export function computeWilson95(events: number, denominator: number): { lower: number; upper: number } {
  if (!Number.isSafeInteger(denominator) || denominator <= 0 || !Number.isSafeInteger(events) || events < 0 || events > denominator) {
    throw new RangeError('Expected a positive integer denominator and integer events between zero and denominator.');
  }
  const p = events / denominator;
  const z2 = Z_95 * Z_95;
  const scale = 1 + z2 / denominator;
  const center = (p + z2 / (2 * denominator)) / scale;
  const half = Z_95 * Math.sqrt(p * (1 - p) / denominator + z2 / (4 * denominator * denominator)) / scale;
  return { lower: events === 0 ? 0 : Math.max(0, center - half), upper: events === denominator ? 1 : Math.min(1, center + half) };
}

export function summarizeRow(row: AggregateRow): CohortSummary {
  const ci = computeWilson95(row.events, row.denominator);
  const warnings: string[] = [];
  if (row.denominator < 30 || row.events < 5 || row.denominator - row.events < 5) warnings.push('Sparse cohort or event counts: estimates can be unstable.');
  if (row.missingOutcomes === undefined) warnings.push('Missing-outcome counts are not reported; follow-up completeness cannot be assessed.');
  else if (row.missingOutcomes > 0) warnings.push('Some outcomes are missing. The observed rate may be biased if missingness is related to outcomes.');
  if (row.dataKind === 'synthetic') warnings.push('Synthetic demonstration data: not an official finding or evidence of program performance.');
  if (row.dataKind === 'uploaded') warnings.push('User-uploaded aggregate data: provenance and cohort definitions have not been independently verified.');
  warnings.push('The 95% Wilson interval is a binomial model interval. For a complete administrative population it is not sampling uncertainty about the observed population rate.');
  return {
    ...row,
    ratePct: 100 * row.events / row.denominator,
    ciLowerPct: 100 * ci.lower,
    ciUpperPct: 100 * ci.upper,
    observedOutcomes: row.denominator,
    outcomeCoveragePct: row.missingOutcomes === undefined ? null : 100 * row.denominator / (row.denominator + row.missingOutcomes),
    warnings,
  };
}

/** Comparisons are descriptive; no significance test or causal effect is inferred. */
export function compareCohorts(a: AggregateRow, b: AggregateRow): CohortComparison {
  const reasons: string[] = [];
  if (a.id === b.id) reasons.push('Choose two distinct cohort records.');
  if (a.releaseYear !== b.releaseYear) reasons.push('Release years must match.');
  if (a.outcome !== b.outcome) reasons.push('Outcome definitions must match.');
  if (a.followupMonths !== b.followupMonths) reasons.push('Follow-up durations must match.');
  if (a.groupType !== b.groupType) reasons.push('Grouping dimensions must match; cohorts across dimensions may overlap.');
  if (a.dataKind !== b.dataKind) reasons.push('Data kinds must match; official, uploaded, and synthetic data cannot be mixed.');
  if (a.group === b.group && a.program === b.program) reasons.push('Cohort labels must be distinct.');
  const total = /^(all|total|overall|all releases|all people|all participants)$/i;
  if (total.test(a.group.trim()) || total.test(b.group.trim())) reasons.push('Do not compare an overall population against an overlapping subgroup.');
  const sa = summarizeRow(a);
  const sb = summarizeRow(b);
  const difference = reasons.length ? null : sa.ratePct - sb.ratePct;
  return {
    comparable: reasons.length === 0,
    reasons,
    riskDifferencePctPoints: difference,
    a: sa,
    b: sb,
    interpretation: difference === null ? 'These cohorts are not compatible for comparison.' : `Observed rate in ${a.group} minus ${b.group}: ${difference.toFixed(2)} percentage points. This is a descriptive association, not a causal program effect.`,
    warnings: [
      'Matching labels do not establish exchangeability, mutually exclusive membership, or comparable measurement. Verify cohort definitions in the source.',
      'Selection, baseline differences, overlapping membership, missing outcomes, and unmeasured confounding may explain observed differences.',
      'No adjusted estimate, hypothesis test, or interval for the risk difference is calculated.',
      'Never sum denominators across grouping dimensions or follow-up windows; the same people may occur in multiple rows.',
    ],
  };
}
