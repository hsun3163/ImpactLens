'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { userScrollBehavior } from '@/lib/accessibility';
import { productMessage } from '@/lib/product-copy';
import { SmsApiError, smsRequest, smsTime, useSmsLive } from './SmsDashboard';

type OrganizationChoice = { id: string; name: string; active: boolean };
type TeacherChoice = { name: string; phone: string };
export type ManagerGrant = { id: string; phone: string; organizationId: string; active: boolean; revision: number };
type AgentGrant = { id: string; subjectId: string; organizationId: string; active: boolean; revision: number };
export type BusinessAdminData = {
  currentUserId: string; currentUserLabel: string; canManagePermissions: boolean; permissions: 'business-only';
  managerGrants: ManagerGrant[]; agentGrants: AgentGrant[];
  requests: { id: string; receiptId: string; organizationId: string; text: string; receivedAt: string; source: string; status: string; authorizationActive: boolean }[];
};
export function canManageBusiness(data: BusinessAdminData | null | undefined) {
  return data?.canManagePermissions === true && data.permissions === 'business-only' && Boolean(data.currentUserId);
}
export function businessStatusLabel(status?: string | null, authorizationActive = true) {
  if (authorizationActive === false && !['completed', 'executed', 'resolved'].includes(status ?? '')) return 'Permission update required';
  const labels: Record<string, string> = { pending: 'Waiting for assistant', proposed: 'Waiting for assistant', approved: 'Ready for assistant', executed: 'Completed', resolved: 'Completed', completed: 'Completed', failed: 'Needs attention', rejected: 'Closed', blocked: 'Needs attention' };
  return status ? labels[status] ?? 'Status unavailable' : 'Status unavailable';
}
export function managerGrantInput(phone: string, organizationId: string, active: boolean) {
  return { action: 'manager-grant', phone, organizationId, active };
}
export function agentGrantInput(organizationId: string, active: boolean) {
  // The server chooses the current authenticated account. Never accept a subject ID here.
  return { action: 'agent-grant', organizationId, active };
}

export default function SmsBusinessSettings({ organizations, teachers, onAccessChange, onPermissionChange, refreshToken }: {
  organizations: OrganizationChoice[]; teachers: TeacherChoice[]; onAccessChange: (allowed: boolean, grants: ManagerGrant[]) => void; onPermissionChange: () => void; refreshToken: number;
}) {
  const [opened, setOpened] = useState(false);
  const [readGeneration, setReadGeneration] = useState(0);
  return <details className="sms-business-settings sms-panel" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>Organization permissions & program requests</summary>
    {opened && <BusinessSettingsBody key={readGeneration} onReload={() => setReadGeneration(value => value + 1)} organizations={organizations} teachers={teachers} onAccessChange={onAccessChange} onPermissionChange={onPermissionChange} refreshToken={refreshToken}/>}
  </details>;
}

function BusinessSettingsBody({ organizations, teachers, onAccessChange, onPermissionChange, refreshToken, onReload }: {
  organizations: OrganizationChoice[]; teachers: TeacherChoice[]; onAccessChange: (allowed: boolean, grants: ManagerGrant[]) => void; onPermissionChange: () => void; refreshToken: number; onReload: () => void;
}) {
  const live = useSmsLive<BusinessAdminData>('/api/sms/business-admin', 3000);
  const [phone, setPhone] = useState('');
  const [leaderOrganizationId, setLeaderOrganizationId] = useState('');
  const [agentOrganizationId, setAgentOrganizationId] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const data = live.data;
  const allowed = canManageBusiness(data);
  useEffect(() => { onAccessChange(allowed && !live.stale && !needsRefresh, allowed && !live.stale && !needsRefresh ? data?.managerGrants ?? [] : []); }, [allowed, live.stale, needsRefresh, data?.managerGrants, onAccessChange]);
  useEffect(() => { if (refreshToken) live.refresh(); }, [refreshToken, live.refresh]);
  useEffect(() => {
    if (!error) return;
    const frame = window.requestAnimationFrame(() => { errorRef.current?.focus({ preventScroll: true }); errorRef.current?.scrollIntoView({ block: 'nearest', behavior: userScrollBehavior() }); });
    return () => window.cancelAnimationFrame(frame);
  }, [error, attempt]);
  const organizationName = (id: string) => organizations.find(item => item.id === id)?.name ?? 'Unavailable organization';
  async function save(input: ReturnType<typeof managerGrantInput> | ReturnType<typeof agentGrantInput>, message: string) {
    if (saving.current || !allowed || live.stale || needsRefresh) return;
    saving.current = true; setBusy(true); setError(''); setNotice(''); setAttempt(value => value + 1);
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      await smsRequest('/api/sms/business-admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal });
      setNotice(message); live.refresh(); onPermissionChange();
    } catch (err) {
      if (!(err instanceof SmsApiError) || err.status < 400 || err.status >= 500) setNeedsRefresh(true);
      setError(err instanceof Error && err.name !== 'AbortError' ? productMessage(err.message) : 'Refresh permissions to check whether the change was saved.');
    }
    finally { window.clearTimeout(timeout); saving.current = false; setBusy(false); }
  }
  if (!data || !allowed) return <div className="sms-business-body"><p>{live.loading ? 'Checking administrator access…' : 'These permissions are available only to an authorized TPW administrator.'}</p>{live.error && <p role="alert">{live.error}</p>}<button type="button" className="sms-button sms-secondary" onClick={live.refresh} disabled={live.refreshing}>Check access again</button></div>;
  const controlsBusy = busy || live.stale || needsRefresh;
  const activeOrganizations = organizations.filter(item => item.active);
  const uniquePhones = teachers.filter((item, index, all) => all.findIndex(other => other.phone === item.phone) === index);
  const leaderExists = data.managerGrants.some(item => item.phone === phone && item.organizationId === leaderOrganizationId && item.active);
  const agentExists = data.agentGrants.some(item => item.subjectId === data.currentUserId && item.organizationId === agentOrganizationId && item.active);
  return <div className="sms-business-body">
    <p>Facilitator phones report attendance by default. Program-change permissions are separate and limited to one organization.</p>
    {(live.stale || needsRefresh) && <p className="sms-alert" role="status">Refresh permissions to continue with the latest saved values. <button type="button" className="sms-text-button" onClick={onReload}>Refresh permissions</button></p>}
    {notice && <p className="sms-feedback sms-success" role="status">{notice}</p>}
    {error && <div className="sms-feedback sms-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
    <div className="sms-business-forms">
      <form onSubmit={event => { event.preventDefault(); void save(managerGrantInput(phone, leaderOrganizationId, true), `Leader requests allowed for ${organizationName(leaderOrganizationId)}.`); }}>
        <h3>1. Who may text program changes?</h3>
        <p>Allow this phone to send program-change requests for the selected organization.</p>
        <label className="sms-field">Registered phone<select required value={phone} onChange={event => setPhone(event.target.value)} disabled={controlsBusy}><option value="">Choose a facilitator’s phone</option>{uniquePhones.map(item => <option key={item.phone} value={item.phone}>{item.name} · {item.phone}</option>)}</select></label>
        <label className="sms-field">Organization<select required value={leaderOrganizationId} onChange={event => setLeaderOrganizationId(event.target.value)} disabled={controlsBusy}><option value="">Choose an organization</option>{activeOrganizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {leaderExists && <p>This phone already has leader permission for this organization.</p>}
        <button className="sms-button sms-primary" disabled={controlsBusy || !phone || !leaderOrganizationId || leaderExists} type="submit">Allow leader requests</button>
      </form>
      <form onSubmit={event => { event.preventDefault(); void save(agentGrantInput(agentOrganizationId, true), `Assistant program actions allowed for this account in ${organizationName(agentOrganizationId)}.`); }}>
        <h3>2. Who may carry out those requests?</h3>
        <p>Allow assistant program actions for this signed-in account: <b>{data.currentUserLabel || data.currentUserId}</b>.</p>
        <label className="sms-field">Organization<select required value={agentOrganizationId} onChange={event => setAgentOrganizationId(event.target.value)} disabled={controlsBusy}><option value="">Choose an organization</option>{activeOrganizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <p>Only program changes requested by an authorized leader in this organization. Program records only.</p>
        {agentExists && <p>This account already has assistant permission for this organization.</p>}
        <button className="sms-button sms-primary" disabled={controlsBusy || !agentOrganizationId || agentExists} type="submit">Allow assistant program actions</button>
        <p className="sms-form-help">After saving permission, connect the authorized account to the business interface.</p>
      </form>
    </div>
    <div className="sms-business-grants"><h3>Current permissions</h3>
      {!data.managerGrants.length && !data.agentGrants.length && <p>Choose a phone and organization above to grant the first program-change permission.</p>}
      {data.managerGrants.map(grant => <div key={`leader-${grant.id}`}><span><b>Leader · {grant.phone}</b><small>{organizationName(grant.organizationId)} · {grant.active ? 'Allowed' : 'Disabled'}</small></span><button type="button" className="sms-text-button" disabled={controlsBusy} aria-label={`${grant.active ? 'Disable' : 'Allow'} leader requests from ${grant.phone} for ${organizationName(grant.organizationId)}`} onClick={() => void save(managerGrantInput(grant.phone, grant.organizationId, !grant.active), `Leader permission ${grant.active ? 'disabled' : 'allowed'} for ${organizationName(grant.organizationId)}.`)}>{grant.active ? 'Disable' : 'Allow again'}</button></div>)}
      {data.agentGrants.map(grant => <div key={`agent-${grant.id}`}><span><b>Assistant account · {grant.subjectId === data.currentUserId ? data.currentUserLabel || 'This account' : 'Another authorized account'}</b><small>{organizationName(grant.organizationId)} · {grant.active ? 'Allowed' : 'Disabled'}</small></span>{grant.subjectId === data.currentUserId && <button type="button" className="sms-text-button" disabled={controlsBusy} aria-label={`${grant.active ? 'Disable' : 'Allow'} assistant program actions for ${organizationName(grant.organizationId)}`} onClick={() => void save(agentGrantInput(grant.organizationId, !grant.active), `Assistant permission ${grant.active ? 'disabled' : 'allowed'} for ${organizationName(grant.organizationId)}.`)}>{grant.active ? 'Disable' : 'Allow again'}</button>}</div>)}
    </div>
    <section className="sms-business-requests" aria-label="Program-change requests"><h3>Program-change requests</h3><p>Request status appears here. The authorized assistant carries out program changes through the business interface.</p>
      {data.requests.length ? <ul>{data.requests.map(request => <li key={request.id}><div><b>{organizationName(request.organizationId)}</b><span>{businessStatusLabel(request.status, request.authorizationActive)}</span></div><small>Received {smsTime(request.receivedAt)}</small><details><summary>View request text</summary><p className="sms-business-message">{request.text}</p></details></li>)}</ul> : <p>Program-change requests will appear here.</p>}
    </section>
  </div>;
}

export function BusinessRequestImport({ recordId, organizations, busy, onSubmit }: {
  recordId: string; organizations: OrganizationChoice[]; busy: boolean;
  onSubmit: (input: { recordId: string; organizationId: string; reason: string }, onSuccess: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState('');
  const [reason, setReason] = useState('');
  const trigger = useRef<HTMLButtonElement>(null); const first = useRef<HTMLSelectElement>(null);
  function close() { setOpen(false); window.requestAnimationFrame(() => (trigger.current ?? document.getElementById('sms-records-heading'))?.focus()); }
  function submit(event: FormEvent) { event.preventDefault(); if (!organizationId || !reason.trim() || busy) return; onSubmit({ recordId, organizationId, reason: reason.trim() }, () => { setReason(''); close(); }); }
  if (!open) return <button type="button" className="sms-text-button" disabled={busy} ref={trigger} onClick={() => { setOpen(true); window.requestAnimationFrame(() => first.current?.focus()); }}>Use as program request</button>;
  return <form className="sms-correction-form sms-business-import" onSubmit={submit}>
    <p>Use only this original text as a program-change request. Attendance totals stay unchanged.</p>
    <label>Organization<select required ref={first} value={organizationId} onChange={event => setOrganizationId(event.target.value)} disabled={busy}><option value="">Choose its organization</option>{organizations.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Why use this earlier message?<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy}/></label>
    <div className="sms-actions"><button type="submit" className="sms-button sms-primary" disabled={busy || !organizationId || !reason.trim()}>Add this request</button><button type="button" className="sms-text-button" disabled={busy} onClick={close}>Cancel</button></div>
  </form>;
}
