'use client';

import { smsNumber, type SmsTotals } from './SmsDashboard';
import { participantEstimateTotalValue, type ParticipantEstimateTotals } from '@/lib/participant-estimate';

export default function OrganizationMetrics({ totals, participantEstimate }: { totals: SmsTotals; participantEstimate: ParticipantEstimateTotals | null }) {
  const metrics = [
    { label: 'Program participants', value: participantEstimateTotalValue(participantEstimate), unit: '', help: `Program-level estimate: each program name’s highest recorded attendance, or its highest saved participant count while awaiting check-ins. Add these program-name estimates together. ${participantEstimate?.missingValuesCount ?? 'Some'} programs await participant details.` },
    { label: 'Session hours', value: totals.sessionMinutes / 60, unit: 'h', help: 'Teaching hours across recorded sessions for this center, all time.' },
    { label: 'Sessions reported', value: totals.sessions, unit: '', help: 'Each recorded session contributes once, including accepted SMS check-ins.' },
  ];
  return <div className="org-metrics">{metrics.map(metric => <section className="org-metric" key={metric.label}><h2 title={metric.help}>{metric.label}</h2><strong>{metric.value === null ? 'Awaiting details' : smsNumber(metric.value)}<span>{metric.unit}</span></strong></section>)}</div>;
}

