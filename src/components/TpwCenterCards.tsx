import { ArrowUpRight } from 'lucide-react';
import { participantEstimateTotalValue } from '@/lib/participant-estimate';
import { centerDisplayName, centerHref } from '@/lib/center-navigation';
import type { SmsOrganization } from './SmsDashboard';

const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
/** Server-produced center metrics; cards do not calculate network totals. */
export default function TpwCenterCards({ organizations }: { organizations: SmsOrganization[] }) {
  return <section aria-labelledby="tpw-centers-heading"><div className="org-program-heading"><h2 id="tpw-centers-heading">All centers</h2><span>{organizations.length} centers</span></div><div className="tpw-center-grid">{organizations.map(center => {
    const participants = participantEstimateTotalValue(center.participantEstimate);
    return <a className="tpw-center-card" key={center.id} href={centerHref(center.id)}><div className="tpw-center-title"><h3>{centerDisplayName(center.name)}</h3><ArrowUpRight size={20} aria-hidden="true"/></div><dl><div><dt>Program participants</dt><dd>{participants === null ? 'Awaiting details' : number(participants)}</dd></div><div><dt>Sessions reported</dt><dd>{number(center.sessions)}</dd></div><div><dt>Participant hours</dt><dd>{number(center.participantMinutes / 60)}</dd></div></dl><span className="tpw-center-open">View programs</span></a>;
  })}</div></section>;
}
