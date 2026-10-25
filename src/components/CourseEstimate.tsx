'use client';

import type { CourseEstimateTotals } from '../lib/course-estimate';
import HelpTip from './HelpTip';

/** A separate metadata estimate. Never added to reported attendance totals. */
export default function CourseEstimate({ totals, scope }: { totals: CourseEstimateTotals; scope: string }) {
  const known = totals.courseCount - totals.missingValuesCount;
  const unknown = totals.courseCount > 0 && known === 0;
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(totals.participantHours);
  const explanation = `For each program without a linked phone, multiply its saved number of participants by its whole-program hours, then add the separate programs together. All program statuses are included. ${known} of ${totals.courseCount} programs have both values. ${totals.missingValuesCount} programs are left out because participants or hours are missing. A saved zero is counted as zero. This estimate stays separate from reported SMS attendance and the existing hours × participants completed calculation.`;
  return <section className="il-estimate" aria-label={`Estimated participant-hours: ${scope}`}>
    <div><div className="il-estimate-label">Estimated participant-hours<HelpTip label="Estimated participant-hours" text={explanation}/></div><p>{scope}</p><small>Based on saved program details</small></div>
    <strong className="il-estimate-value">{unknown ? 'Awaiting details' : value}{!unknown && <small>participant-hours</small>}</strong>
  </section>;
}
