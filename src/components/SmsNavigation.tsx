'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function smsNavigationLinks(pathname: string | null): { href: string; label: string; className?: string }[] {
  return pathname === '/sms/demo' ? [{ href: '/demo/courses', label: 'Manage programs', className: 'sms-button sms-primary' }] : pathname?.startsWith('/sms/demo/') ? [
    { href: '/sms/demo', label: 'Dashboard' },
    { href: '/demo/courses', label: 'Manage programs' },
  ] : [
    { href: '/', label: 'Dashboard' },
    { href: '/courses', label: 'Manage programs' },
  ];
}

export default function SmsNavigation() {
  const pathname = usePathname();
  const [organizationId, setOrganizationId] = useState('');
  useEffect(() => { const read = () => setOrganizationId(new URLSearchParams(window.location.search).get('organizationId') ?? ''); read(); window.addEventListener('impactlens:demo-organization', read); window.addEventListener('popstate', read); return () => { window.removeEventListener('impactlens:demo-organization', read); window.removeEventListener('popstate', read); }; }, [pathname]);
  return <nav aria-label="SMS navigation">{smsNavigationLinks(pathname).map(link => <a key={link.href} href={link.href === '/demo/courses' && organizationId ? `${link.href}?organizationId=${encodeURIComponent(organizationId)}` : link.href} className={link.className}>{link.label}</a>)}</nav>;
}

export function SmsBrand() {
  const pathname = usePathname();
  return <a href={pathname === '/sms/demo' || pathname?.startsWith('/sms/demo/') ? '/sms/demo' : '/'} className="sms-brand" aria-label="ImpactLens home"><span className="sms-brand-mark"/>ImpactLens<span>.</span></a>;
}
