'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, Building2, CheckCircle2, Clock3, LockKeyhole, MessageSquare, RefreshCw, ShieldCheck, Users, Zap } from 'lucide-react';

export type SmsSession = {
  authenticated: boolean; authorized: boolean; configured: boolean;
  webhookConfigured: boolean; inboundNumber: string | null; signInUrl: string;
};
export type SmsTotals = { sessions: number; attendees: number; sessionMinutes: number; participantMinutes: number };
export type SmsOrganization = SmsTotals & { id: string; name: string; slug: string; active: boolean };
export type SmsProgram = SmsTotals & { id: string; organizationId: string; name: string; active: boolean };
export type SmsRecent = { id: string; organizationName: string; programName: string; attendees: number; sessionMinutes: number; receivedAt: string; processedAt?: string | null };
export type SmsDashboardData = {
  generatedAt: string; lastReceivedAt: string | null; totals: SmsTotals;
  organizations: SmsOrganization[]; programs: SmsProgram[]; recent: SmsRecent[];
  organization: { id: string; name: string; slug: string; active: boolean } | null;
};
export const smsNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
export function smsTime(value: string | null | undefined) {
  if (!value) return 'No check-ins yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
export class SmsApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function smsRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new SmsApiError('The SMS service did not respond. Try refreshing in a moment.', response.status);
  const payload: unknown = await response.json();
  const details = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (!response.ok) throw new SmsApiError(typeof details.error === 'string' ? details.error : `Unable to complete the request (${response.status}).`, response.status, typeof details.code === 'string' ? details.code : undefined);
  return payload as T;
}

/** Only one read is in flight. The server also authorizes every private read. */
export function useSmsLive<T>(url: string, pollMs = 1000) {
  const [session, setSession] = useState<SmsSession | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const refreshRef = useRef<() => void>(() => {});
  const pollRef = useRef(pollMs);
  pollRef.current = pollMs;
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    let controller: AbortController | null = null;
    let cachedSession: SmsSession | null = null;
    let sessionCheckedAt = 0;
    let lastStartedAt = 0;
    setData(null); setSession(null); setLoading(true); setError(''); setLastChecked(null);
    async function load() {
      if (!alive || inFlight) return;
      inFlight = true; lastStartedAt = Date.now(); setRefreshing(true);
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 12000);
      try {
        const access: SmsSession = cachedSession && cachedSession.authorized && Date.now() - sessionCheckedAt < 30000 ? cachedSession : await smsRequest<SmsSession>('/api/sms/session', { signal: controller.signal });
        if (access !== cachedSession) sessionCheckedAt = Date.now();
        cachedSession = access;
        if (!alive) return;
        setSession(access);
        if (access.configured !== true || access.authenticated !== true || access.authorized !== true) {
          setData(null); setError(''); return;
        }
        const result = await smsRequest<T>(url, { signal: controller.signal });
        if (!alive) return;
        setData(result); setError(''); setLastChecked(Date.now());
      } catch (err) {
        if (!alive) return;
        if (err instanceof SmsApiError && ([401, 403].includes(err.status) || err.code === 'ADMIN_NOT_CONFIGURED')) {
          setData(null); cachedSession = null;
          if (err.status === 401) setSession(previous => previous ? { ...previous, authenticated: false, authorized: false } : null);
          if (err.status === 403) setSession(previous => previous ? { ...previous, authorized: false } : null);
          if (err.code === 'ADMIN_NOT_CONFIGURED') setSession(previous => previous ? { ...previous, configured: false } : null);
        }
        setError(err instanceof Error && err.name !== 'AbortError' ? err.message : 'The request timed out. Reconnecting automatically.');
      } finally {
        window.clearTimeout(timeout); inFlight = false;
        if (alive) { setLoading(false); setRefreshing(false); setNow(Date.now()); }
      }
    }
    refreshRef.current = () => { cachedSession = null; void load(); };
    void load();
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      setNow(Date.now());
      if (Date.now() - lastStartedAt >= pollRef.current) void load();
    }, 250);
    const onVisibility = () => { if (!document.hidden) { setNow(Date.now()); void load(); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { alive = false; controller?.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); refreshRef.current = () => {}; };
  }, [url]);
  return { session, data, error, loading, refreshing, lastChecked, stale: Boolean(data && (error || !lastChecked || now - lastChecked > 10000)), refresh };
}

export function SmsAccess({ session, loading, error, retry }: { session: SmsSession | null; loading: boolean; error: string; retry: () => void }) {
  const signIn = session?.signInUrl;
  const safeSignIn = signIn && (signIn === '/signin-with-chatgpt' || signIn.startsWith('/signin-with-chatgpt?')) ? signIn : '/signin-with-chatgpt?return_to=%2Fsms';
  const setup = session?.configured === false;
  return <section className="sms-access" aria-live="polite">
    <span className="sms-access-icon">{loading ? <RefreshCw size={27} className="sms-spin" /> : <LockKeyhole size={27} />}</span>
    <span className="sms-kicker">PRIVATE TPW WORKSPACE</span>
    <h1>{loading ? 'Checking access…' : setup ? 'Live check-ins need setup.' : session && !session.authenticated ? 'Sign in to view live check-ins.' : session && !session.authorized ? 'TPW admin access is required.' : 'We couldn’t connect just yet.'}</h1>
    <p>{loading ? 'Verifying your access before loading any live data.' : setup ? 'The private SMS workspace is not configured. Live data stays locked until an administrator completes the server setup.' : session && !session.authenticated ? 'The live dashboards and phone-number mappings are visible only to approved TPW administrators.' : session && !session.authorized ? 'You’re signed in, but this account is not on the TPW admin allowlist. Ask the workspace owner to grant access.' : error || 'The SMS service is temporarily unavailable. No private records have been loaded.'}</p>
    {!loading && <div className="sms-actions">{session && !session.authenticated && !setup ? <a className="sms-button sms-primary" target="_top" href={safeSignIn}>Sign in with ChatGPT <ArrowUpRight size={16}/></a> : <button className="sms-button sms-primary" onClick={retry}>Check again <RefreshCw size={15}/></button>}<a className="sms-button sms-secondary" href="/sms/demo">Explore the synthetic demo</a></div>}
  </section>;
}

export function SmsMetrics({ totals, compact = false }: { totals: SmsTotals; compact?: boolean }) {
  const metrics = [
    { label: 'Participant visits', value: totals.attendees, unit: '', note: 'Repeat attendance is counted', icon: Users },
    { label: 'Sessions reported', value: totals.sessions, unit: '', note: 'One accepted text = one session', icon: MessageSquare },
    { label: 'Session hours', value: totals.sessionMinutes / 60, unit: 'h', note: 'Total reported teaching time', icon: Clock3 },
    { label: 'Participant hours', value: totals.participantMinutes / 60, unit: 'h', note: 'Attendance × session duration', icon: Activity },
  ];
  return <div className={`sms-metrics${compact ? ' sms-metrics-compact' : ''}`}>{metrics.map((metric, i) => <div className={`sms-metric${i === 0 ? ' sms-metric-featured' : ''}`} key={metric.label}><div className="sms-metric-label">{metric.label}<metric.icon size={18}/></div><div className="sms-metric-value" key={`${metric.label}-${metric.value}`}>{smsNumber(metric.value)}<span>{metric.unit}</span></div><p>{metric.note}</p></div>)}</div>;
}

export function SmsRecentActivity({ recent, highlightedId }: { recent: SmsRecent[]; highlightedId?: string }) {
  return <section className="sms-panel sms-activity"><div className="sms-panel-heading"><div><span className="sms-kicker">EVERY SESSION ADDS UP</span><h2>Latest check-ins</h2></div><MessageSquare size={20}/></div>
    {recent.length ? <div className="sms-feed">{recent.slice(0, 6).map(record => <div className={`sms-feed-row${record.id === highlightedId ? ' sms-new-record' : ''}`} key={record.id}><span className="sms-feed-icon"><CheckCircle2 size={18}/></span><div><b>{record.organizationName}</b><p>{record.programName} · {smsNumber(record.attendees)} visits · {smsNumber(record.sessionMinutes / 60)} session h</p><time dateTime={record.receivedAt}>{smsTime(record.receivedAt)}</time></div></div>)}</div> : <div className="sms-empty"><MessageSquare size={26}/><h3>Ready for the first text.</h3><p>An accepted teacher check-in will appear here automatically.</p></div>}
    <div className="sms-panel-foot"><ShieldCheck size={14}/> Aggregate activity only. No phone numbers or message bodies.</div>
  </section>;
}

export default function SmsDashboard({ organizationId }: { organizationId?: string }) {
  const [fast, setFast] = useState(false);
  const [observation, setObservation] = useState<{ id: string; milliseconds: number | null; observedAt: number } | null>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => { setFast(new URLSearchParams(window.location.search).get('fast') === '1'); }, []);
  const live = useSmsLive<SmsDashboardData>(`/api/sms/dashboard${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`, fast ? 250 : 1000);
  useEffect(() => {
    if (!live.data) { seen.current = null; setObservation(null); return; }
    const newest = live.data.recent[0];
    const previous = seen.current;
    seen.current = new Set(live.data.recent.map(record => record.id));
    if (!previous || !newest || previous.has(newest.id)) return;
    const frame = window.requestAnimationFrame(() => {
      const observedAt = Date.now();
      const elapsed = observedAt - new Date(newest.receivedAt).getTime();
      setObservation({ id: newest.id, milliseconds: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null, observedAt });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [live.data]);
  function toggleFast() {
    const enabled = !fast; setFast(enabled);
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set('fast', '1'); else url.searchParams.delete('fast');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  const fastQuery = fast ? '?fast=1' : '';
  if (!live.data) return <div className="sms-content"><SmsAccess session={live.session} loading={live.loading} error={live.error} retry={live.refresh}/></div>;
  const data = live.data;
  const title = organizationId ? data.organization?.name ?? 'Organization dashboard' : 'Every check-in. One shared picture.';
  const maxVisits = Math.max(1, ...data.organizations.map(organization => organization.attendees));
  const programs = organizationId ? data.programs.filter(program => program.organizationId === organizationId) : data.programs;
  return <div className="sms-content">
    {organizationId && <a href={`/sms${fastQuery}`} className="sms-back"><ArrowLeft size={15}/> All TPW organizations</a>}
    <div className="sms-heading"><div><span className="sms-kicker">{organizationId ? 'ORGANIZATION DASHBOARD' : 'TPW · NETWORK OVERVIEW'}</span><h1>{title}</h1><p>Reported participation, together in real time. All accepted check-ins, all time.</p></div><div className="sms-heading-actions"><button className={`sms-button ${fast ? 'sms-primary' : 'sms-secondary'}`} onClick={toggleFast} aria-pressed={fast}><Zap size={15}/>{fast ? 'Fast display on' : 'Fast display'}</button><a className="sms-button sms-secondary" href="/sms/admin">Manage check-ins <ArrowUpRight size={15}/></a><button className="sms-icon-button" onClick={live.refresh} disabled={live.refreshing} aria-label="Refresh dashboard"><RefreshCw size={18} className={live.refreshing ? 'sms-spin' : ''}/></button></div></div>
    <div className={`sms-live-strip${live.stale ? ' sms-warning' : ''}`} role="status"><span className={`sms-live-dot${live.stale ? ' sms-dot-amber' : ''}`}/><b>{live.stale ? 'Connection interrupted · showing last received totals' : fast ? 'Live · fast display · checks every 250 ms' : 'Live · checks every 1 second'}</b><span>Last successful refresh: {live.lastChecked ? smsTime(new Date(live.lastChecked).toISOString()) : 'Waiting'}</span></div>
    {fast && <p className="sms-fast-note">For a two-screen presentation, keep each dashboard visible in its own window. Background tabs pause refreshes. Faster polling is not an end-to-end latency guarantee.</p>}
    {observation && <div className="sms-observation" role="status"><CheckCircle2 size={14}/><span>New check-in observed. {observation.milliseconds === null ? 'Timing unavailable: browser and server clocks differ.' : `Approx. receipt → observed: ${smsNumber(observation.milliseconds)} ms.`} <small>Browser/server clocks may differ. Carrier delivery time is not included.</small></span></div>}
    {live.error && <p className="sms-inline-error" role="alert">{live.error} We’ll keep trying. These numbers may be out of date.</p>}
    {!live.session?.webhookConfigured && <div className="sms-alert">SMS receiving is not configured yet. Saved check-ins can be viewed, but new texts will not arrive until the webhook is connected.</div>}
    <SmsMetrics totals={data.totals}/>
    <div className="sms-dashboard-grid"><section className="sms-panel"><div className="sms-panel-heading"><div><span className="sms-kicker">{organizationId ? 'WITHIN THIS ORGANIZATION' : 'A NETWORK OF SMALL ACTIONS'}</span><h2>{organizationId ? 'Programs' : 'Partner organizations'}</h2></div><span className="sms-count">{organizationId ? programs.length : data.organizations.length} {organizationId ? 'programs' : 'organizations'}</span></div>
      {organizationId ? <div className="sms-org-list">{programs.length ? programs.map(program => <div className="sms-program-row" key={program.id}><span className="sms-org-avatar"><Building2 size={19}/></span><div><h3>{program.name} {!program.active && <small>Inactive</small>}</h3><p>{smsNumber(program.sessions)} sessions · {smsNumber(program.sessionMinutes / 60)} session hours</p></div><strong>{smsNumber(program.attendees)}<small>participant visits</small></strong></div>) : <div className="sms-empty"><Building2 size={26}/><h3>No programs yet.</h3><p>Add a program and its teachers in Manage check-ins.</p></div>}</div> : <div className="sms-org-list">{data.organizations.length ? data.organizations.map((organization, index) => <a href={`/sms/org/${encodeURIComponent(organization.id)}${fastQuery}`} className="sms-org-row" key={organization.id}><span className={`sms-org-avatar sms-avatar-${index % 3}`}>{organization.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('')}</span><div className="sms-org-copy"><div><h3>{organization.name} {!organization.active && <small>Inactive</small>}</h3><ArrowUpRight size={17}/></div><p>{smsNumber(organization.sessions)} sessions · {smsNumber(organization.sessionMinutes / 60)} session hours</p><div className="sms-progress-track"><span style={{ width: `${Math.max(organization.attendees ? 2 : 0, organization.attendees / maxVisits * 100)}%` }}/></div></div><strong>{smsNumber(organization.attendees)}<small>participant visits</small></strong></a>) : <div className="sms-empty"><Building2 size={26}/><h3>Your network starts here.</h3><p>Add an organization, a program, and a teacher’s number to receive the first check-in.</p><a className="sms-button sms-secondary" href="/sms/admin">Set up your first organization</a></div>}</div>}
      <div className="sms-panel-foot"><Users size={14}/> Participant visits are not unique people. A returning participant is counted again.</div>
    </section><SmsRecentActivity recent={data.recent} highlightedId={observation && Date.now() - observation.observedAt < 10000 ? observation.id : undefined}/></div>
    <section className="sms-howto"><div className="sms-howto-icon"><MessageSquare size={26}/></div><div><span className="sms-kicker">ONE NUMBER. TWO NUMBERS IN A TEXT.</span><h2>Finish a session. Send a check-in.</h2><p>Teachers text <b>20 2</b> for 20 attendees and a 2-hour session. Their registered phone number links the record to the right program and organization.</p></div><div className="sms-number-card"><span>SHARED SMS NUMBER</span><b>{live.session?.inboundNumber || 'Not configured yet'}</b><small>Last accepted check-in: {smsTime(data.lastReceivedAt)}</small></div></section>
  </div>;
}
