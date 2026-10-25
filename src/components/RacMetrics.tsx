import { estimateAggregateRacEquivalent, RAC_ANNUAL_COST } from '@/lib/rac-estimate';

export default function RacMetrics({ participantMinutes }: { participantMinutes: number }) {
  const estimate = estimateAggregateRacEquivalent(participantMinutes);
  const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  return <section className="rac-panel" aria-label="RAC credit estimates">
    <div className="rac-heading"><h2>Rehabilitative Achievement Credits</h2><span>Aggregate estimate</span></div>
    <div className="rac-actual rac-live-estimates">
      <div><h3>Estimated RAC equivalent</h3><strong>{number(estimate.equivalentDays)} <span>days</span></strong><p>{estimate.yearsEquivalent.toFixed(3)} years equivalent</p></div>
      <div><h3>Estimated cost equivalent</h3><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(estimate.costEquivalent)}</strong><p>At ${RAC_ANNUAL_COST.toLocaleString('en-US')} per year</p></div>
    </div>
    <details className="rac-assumptions"><summary>How this is estimated</summary><p>Recorded participant-hours × 10 ÷ 52 gives a continuous attendance-based credit equivalent, not an actual credit award. Individual 52-hour thresholds, anniversary-year caps and eligibility are unverified. Cost equivalent = equivalent days × $21,534 ÷ 365, using a supplied annual planning rate; not verified savings or actual days avoided.</p></details>
    <p className="rac-basis">Based on {number(estimate.participantHours)} recorded participant-hours · all time</p>
  </section>;
}
