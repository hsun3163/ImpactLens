import type { Metadata } from 'next';
import './sms.css';

export const metadata: Metadata = {
  title: 'TPW Check-ins · ImpactLens',
  description: 'SMS session reporting for TPW and its partner organizations.',
};

export default function SmsLayout({ children }: { children: React.ReactNode }) {
  return <div className="sms-shell">
    <header className="sms-topbar">
      <a href="/" className="sms-brand" aria-label="ImpactLens home"><span className="sms-brand-mark" />ImpactLens<span>.</span></a>
      <span className="sms-product-label">TPW CHECK-INS</span>
      <nav aria-label="SMS navigation">
        <a href="/sms">Live dashboards</a>
        <a href="/courses">My courses</a>
        <a href="/sms/reports">Reports & summaries</a>
        <a href="/sms/admin">Manage check-ins</a>
        <a href="/sms/demo" className="sms-demo-link">Try the demo ↗</a>
      </nav>
    </header>
    {children}
    <footer className="sms-footer"><span>ImpactLens · A clearer picture of participation.</span><span>Activity reporting, not an estimate of program impact.</span></footer>
  </div>;
}
