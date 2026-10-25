import type { Metadata } from 'next';
import './sms.css';
import SmsNavigation, { SmsBrand } from '@/components/SmsNavigation';

export const metadata: Metadata = {
  title: 'TPW Check-ins · ImpactLens',
  description: 'SMS session reporting for TPW and its partner organizations.',
};

export default function SmsLayout({ children }: { children: React.ReactNode }) {
  return <div className="sms-shell">
    <a className="il-skip-link" href="#sms-main">Skip to main content</a>
    <header className="sms-topbar">
      <SmsBrand/>
      <SmsNavigation/>
    </header>
    <main id="sms-main" tabIndex={-1}>{children}</main>
  </div>;
}
