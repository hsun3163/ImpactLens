/** One aggregate cohort; never an individual person's record. */
export interface AggregateRow {
  id: string;
  releaseYear: string;
  groupType: string;
  group: string;
  denominator: number;
  events: number;
  outcome: string;
  followupMonths: number;
  sourceId: string;
  sourcePage: string;
  dataKind: 'official' | 'synthetic' | 'uploaded';
  program?: string;
  /** Eligible cohort members with an unknown outcome, outside denominator. */
  missingOutcomes?: number;
}

export interface CohortSummary extends AggregateRow {
  ratePct: number;
  ciLowerPct: number;
  ciUpperPct: number;
  observedOutcomes: number;
  outcomeCoveragePct: number | null;
  warnings: string[];
}

export interface CohortComparison {
  comparable: boolean;
  reasons: string[];
  /** A minus B, in percentage points; not a causal effect. */
  riskDifferencePctPoints: number | null;
  a: CohortSummary;
  b: CohortSummary;
  interpretation: string;
  warnings: string[];
}

export interface ValidationResult {
  rows: AggregateRow[];
  errors: string[];
  warnings: string[];
}
