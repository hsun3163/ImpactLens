'use client';

import RacMetrics from './RacMetrics';

import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { SmsAccess, useSmsLive, type SmsDashboardData } from './SmsDashboard';
import OrganizationOverview from './OrganizationOverview';
import OrganizationMetrics from './OrganizationMetrics';
import TpwCenterCards from './TpwCenterCards';
import { centerDisplayName, dashboardLocation } from '@/lib/center-navigation';
import { selectDashboardOrganization, type DashboardOrganization } from '@/lib/organization-dashboard';
import type { CourseAttendanceData } from '@/lib/course-attendance';

type CourseDashboard = SmsDashboardData & { courseAttendance: CourseAttendanceData[]; coursesTruncated?: boolean };
function LiveOrganization({ organizationId }: { organizationId: string }) {
  const live = useSmsLive<CourseDashboard>(`/api/sms/dashboard?organizationId=${encodeURIComponent(organizationId)}&includeCourses=1`, 1000);
  if (!live.data) return <SmsAccess session={live.session} loading={live.loading} error={live.error} retry={live.refresh} returnTo={`/?organizationId=${encodeURIComponent(organizationId)}`}/>;
  return <><div className="org-live"><span role="status">{live.stale ? 'Reconnecting · saved display' : 'Live'}</span><button type="button" className="sms-icon-button" aria-label="Refresh dashboard" disabled={live.refreshing} onClick={live.refresh}><RefreshCw size={16}/></button></div>{live.error && <p className="sms-alert" role="alert">{live.error}</p>}<OrganizationMetrics totals={live.data.totals} participantEstimate={live.data.participantEstimate ?? null}/><RacMetrics participantMinutes={live.data.totals.participantMinutes}/><OrganizationOverview organizationId={organizationId} attendance={live.data.courseAttendance ?? []} truncated={live.data.coursesTruncated}/></>;
}
function LiveTpwOverview() {
  const live = useSmsLive<SmsDashboardData>('/api/sms/dashboard', 1000);
  if (!live.data) return <SmsAccess session={live.session} loading={live.loading} error={live.error} retry={live.refresh} returnTo="/?view=tpw"/>;
  return <><div className="org-live"><span role="status">{live.stale ? 'Reconnecting · saved display' : 'Live'}</span><button type="button" className="sms-icon-button" aria-label="Refresh TPW overview" disabled={live.refreshing} onClick={live.refresh}><RefreshCw size={16}/></button></div>{live.error && <p className="sms-alert" role="alert">{live.error}</p>}<OrganizationMetrics totals={live.data.totals} participantEstimate={live.data.participantEstimate ?? null}/><RacMetrics participantMinutes={live.data.totals.participantMinutes}/><TpwCenterCards organizations={live.data.organizations}/></>;
}
export default function OrganizationHome() {
  const directory = useSmsLive<{ organizations: DashboardOrganization[] }>('/api/sms/course-metadata', 3000);
  const [requestedId, setRequestedId] = useState('');
  const [overview, setOverview] = useState(false);
  useEffect(() => { const read = () => { const state = dashboardLocation(window.location.search); setRequestedId(state.requestedId); setOverview(state.overview); }; read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read); }, []);
  const selected = selectDashboardOrganization(directory.data?.organizations ?? [], requestedId);
  function choose(id: string) { setRequestedId(id); setOverview(false); const url = new URL(window.location.href); url.searchParams.set('organizationId', id); url.searchParams.delete('view'); window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`); }
  return <div className="sms-shell org-home"><a className="il-skip-link" href="#organization-main">Skip to main content</a><header className="sms-topbar org-topbar"><a href="/" className="sms-brand" aria-label="ImpactLens home"><span className="sms-brand-mark"/>ImpactLens<span>.</span></a><nav className="org-topbar-actions" aria-label="Dashboard navigation"><a className={`sms-button ${overview ? 'sms-primary' : 'sms-secondary'}`} href="/?view=tpw" aria-current={overview ? 'page' : undefined}>TPW Overview</a><a className="sms-button sms-primary" href={!overview && selected ? `/courses?organizationId=${encodeURIComponent(selected.id)}` : '/courses'}>Manage programs <ArrowUpRight size={16}/></a></nav></header><main id="organization-main" tabIndex={-1} className="sms-content org-content">{overview ? <><div className="org-heading"><div><h1>TPW Overview</h1><p className="org-scope-note">All centers · combined activity</p></div>{directory.data && <label className="sms-field">Center<select value="" onChange={event => choose(event.target.value)}><option value="" disabled>Choose a center</option>{directory.data.organizations.map(item => <option key={item.id} value={item.id}>{centerDisplayName(item.name)}</option>)}</select></label>}</div><LiveTpwOverview/></> : directory.data ? selected ? <><div className="org-heading"><h1>{centerDisplayName(selected.name)}</h1><label className="sms-field">Center<select value={selected.id} onChange={event => choose(event.target.value)}>{directory.data.organizations.map(item => <option key={item.id} value={item.id}>{centerDisplayName(item.name)}</option>)}</select></label></div><LiveOrganization key={selected.id} organizationId={selected.id}/></> : <section className="org-empty"><h1>Add your first center.</h1></section> : <SmsAccess session={directory.session} loading={directory.loading} error={directory.error} retry={directory.refresh} returnTo={requestedId ? `/?organizationId=${encodeURIComponent(requestedId)}` : '/'}/>}</main></div>;
}
