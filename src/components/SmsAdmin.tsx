'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Edit3, LockKeyhole, MessageSquare, Phone, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { SmsAccess, SmsApiError, smsNumber, smsRequest, smsTime, useSmsLive } from './SmsDashboard';

type Organization = { id: string; name: string; slug: string; active: boolean };
type Program = { id: string; organizationId: string; name: string; active: boolean };
type Teacher = { id: string; name: string; phone: string; organizationId: string; programId: string; active: boolean; createdAt: string };
type SmsRecord = { id: string; messageSid: string; senderPhone: string; body: string; status: string; reason: string | null; organizationName: string | null; programName: string | null; attendees: number | null; sessionMinutes: number | null; receivedAt: string };
type AdminData = { organizations: Organization[]; programs: Program[]; teachers: Teacher[]; records: SmsRecord[]; stats: { counted: number; quarantined: number }; inboundNumber: string | null; webhookConfigured: boolean };
type Mutation = Record<string, string | boolean> & { action: string };

function retryable(record: SmsRecord) {
  return record.status === 'quarantined' && ['UNKNOWN_SENDER', 'INACTIVE_SENDER'].includes(record.reason || '');
}
function reasonLabel(reason: string | null) {
  const labels: Record<string, string> = {
    UNKNOWN_SENDER: 'Phone number is not registered. Add its mapping, then retry.',
    INACTIVE_SENDER: 'This sender or its organization/program is inactive. Enable the mapping, then retry.',
    INVALID_BODY: 'The message format is invalid. Ask the teacher to send a corrected text.',
  };
  return reason ? labels[reason] || reason.replace(/_/g, ' ') : 'Accepted and included in totals.';
}

export default function SmsAdmin() {
  const live = useSmsLive<AdminData>('/api/sms/admin', 3000);
  const [organizationId, setOrganizationId] = useState('');
  const [programId, setProgramId] = useState('');
  const [organizationEditId, setOrganizationEditId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationActive, setOrganizationActive] = useState(true);
  const [programEditId, setProgramEditId] = useState('');
  const [programName, setProgramName] = useState('');
  const [programActive, setProgramActive] = useState(true);
  const [teacherEditId, setTeacherEditId] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [teacherPhone, setTeacherPhone] = useState('');
  const [teacherActive, setTeacherActive] = useState(true);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [recordFilter, setRecordFilter] = useState('all');
  const data = live.data;
  const organizations = data?.organizations ?? [];
  const programs = (data?.programs ?? []).filter(program => program.organizationId === organizationId);
  const selectedOrganization = organizations.find(organization => organization.id === organizationId);
  const selectedProgram = programs.find(program => program.id === programId);


  function clearOrganizationForm() { setOrganizationEditId(''); setOrganizationName(''); setOrganizationActive(true); }
  function clearProgramForm() { setProgramEditId(''); setProgramName(''); setProgramActive(true); }
  function clearTeacherForm() { setTeacherEditId(''); setTeacherName(''); setTeacherPhone(''); setTeacherActive(true); }
  function chooseOrganization(id: string) { setOrganizationId(id); setProgramId(''); clearOrganizationForm(); clearProgramForm(); if (!teacherEditId) clearTeacherForm(); }
  function chooseProgram(id: string) { setProgramId(id); clearProgramForm(); if (!teacherEditId) clearTeacherForm(); }
  async function save(payload: Mutation, message: string, onSuccess?: (result: { id?: string }) => void) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(payload.action === 'retry' ? `retry:${payload.id}` : payload.action); setNotice(''); setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = await smsRequest<{ id?: string }>('/api/sms/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      setNotice(message); onSuccess?.(result); live.refresh();
    } catch (err) {
      if (err instanceof SmsApiError && [401, 403, 503].includes(err.status)) live.refresh();
      setError(err instanceof Error && err.name !== 'AbortError' ? err.message : 'The save could not be confirmed. Refresh and check the mapping before submitting again.');
    } finally { window.clearTimeout(timeout); busyRef.current = false; setBusy(''); }
  }
  function submitOrganization(event: FormEvent) {
    event.preventDefault(); const name = organizationName.trim();
    void save({ action: 'organization', ...(organizationEditId ? { id: organizationEditId } : {}), name, active: organizationActive }, organizationEditId ? 'Organization updated.' : 'Organization added. Next, add a program.', result => { if (result.id) { setOrganizationId(result.id); if (result.id !== organizationId) setProgramId(''); } clearOrganizationForm(); });
  }
  function submitProgram(event: FormEvent) {
    event.preventDefault(); const name = programName.trim();
    void save({ action: 'program', ...(programEditId ? { id: programEditId } : {}), organizationId, name, active: programActive }, programEditId ? 'Program updated.' : 'Program added. Next, register a teacher’s phone.', result => { if (result.id) setProgramId(result.id); clearProgramForm(); });
  }
  function submitTeacher(event: FormEvent) {
    event.preventDefault();
    void save({ action: 'teacher', ...(teacherEditId ? { id: teacherEditId } : {}), name: teacherName.trim(), phone: teacherPhone.trim(), programId, active: teacherActive }, teacherEditId ? 'Teacher mapping updated. Earlier accepted records keep their original attribution.' : 'Teacher registered. They can now text the shared number.', clearTeacherForm);
  }
  if (!data) return <div className="sms-content"><SmsAccess session={live.session} loading={live.loading} error={live.error} retry={live.refresh}/></div>;
  const teachers = data.teachers.filter(teacher => (!organizationId || teacher.organizationId === organizationId) && (!programId || teacher.programId === programId));
  function teacherStatus(teacher: Teacher) {
    if (!teacher.active) return 'Inactive';
    if (!organizations.find(item => item.id === teacher.organizationId)?.active) return 'Organization inactive';
    if (!data?.programs.find(item => item.id === teacher.programId)?.active) return 'Program inactive';
    return 'Active';
  }
  const records = data.records.slice(0, 50).filter(record => recordFilter === 'all' || record.status === recordFilter);
  return <div className="sms-content sms-admin-content">
    <a className="sms-back" href="/sms"><ArrowLeft size={15}/> Back to live dashboards</a>
    <div className="sms-heading"><div><span className="sms-kicker">TPW · SIMPLE SETUP</span><h1>A place for every check-in.</h1><p>Add an organization, a program, and a teacher’s number. That’s it.</p></div><span className="sms-private-label"><LockKeyhole size={14}/> Approved admins only</span></div>
    <div className="sms-admin-intro"><div><MessageSquare size={23}/><div><b>Everyone texts the same number.</b><p><strong>{data.inboundNumber || 'Inbound number not configured'}</strong> · Send <strong>20 2</strong> for 20 attendees and 2 session hours.</p></div></div><span className={`sms-status-badge${data.webhookConfigured ? '' : ' sms-badge-amber'}`}>{data.webhookConfigured ? 'SMS webhook configured' : 'SMS setup needed'}</span></div>
    {!data.webhookConfigured && <div className="sms-alert">The inbound SMS webhook still needs server setup. You can prepare mappings, but a real text will not arrive yet.</div>}
    {live.stale && <div className="sms-alert" role="status">Live refresh is interrupted. Last successful refresh: {live.lastChecked ? smsTime(new Date(live.lastChecked).toISOString()) : 'Not yet'}. {live.error}</div>}
    {notice && <div className="sms-feedback sms-success" role="status"><CheckCircle2 size={18}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss success message"><X size={16}/></button></div>}
    {error && <div className="sms-feedback sms-error" role="alert"><CircleAlert size={18}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    <div className="sms-setup-grid">
      <section className="sms-setup-card"><div className="sms-step-header"><span>1</span><div><h2>Organization</h2><p>Who’s delivering the work?</p></div></div>
        <label className="sms-field">Choose an organization<select value={organizationId} onChange={event => chooseOrganization(event.target.value)} disabled={Boolean(busy)}><option value="">Select an organization</option>{organizations.map(organization => <option value={organization.id} key={organization.id}>{organization.name}{organization.active ? '' : ' (inactive)'}</option>)}</select></label>
        {selectedOrganization && <button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { setOrganizationEditId(selectedOrganization.id); setOrganizationName(selectedOrganization.name); setOrganizationActive(selectedOrganization.active); }}><Edit3 size={14}/> Edit selected organization</button>}
        <form onSubmit={submitOrganization} className="sms-mini-form"><h3>{organizationEditId ? 'Edit organization' : 'Or add a new organization'}</h3><label className="sms-field">Organization name<input required maxLength={100} value={organizationName} onChange={event => setOrganizationName(event.target.value)} placeholder="e.g. Community Arts Collective" disabled={Boolean(busy)}/></label>{organizationEditId && <label className="sms-checkbox"><input type="checkbox" checked={organizationActive} onChange={event => setOrganizationActive(event.target.checked)}/> Active organization</label>}<div className="sms-actions"><button className="sms-button sms-primary" type="submit" disabled={Boolean(busy) || !organizationName.trim()}>{busy === 'organization' ? 'Saving…' : organizationEditId ? 'Save changes' : 'Add organization'}<Plus size={15}/></button>{organizationEditId && <button className="sms-text-button" type="button" onClick={clearOrganizationForm} disabled={Boolean(busy)}>Cancel</button>}</div></form>
      </section>
      <section className="sms-setup-card"><div className="sms-step-header"><span>2</span><div><h2>Program</h2><p>What are they teaching?</p></div></div>
        <label className="sms-field">Choose a program<select value={programId} onChange={event => chooseProgram(event.target.value)} disabled={!organizationId || Boolean(busy)}><option value="">{organizationId ? 'Select a program' : 'Choose an organization first'}</option>{programs.map(program => <option value={program.id} key={program.id}>{program.name}{program.active ? '' : ' (inactive)'}</option>)}</select></label>
        {selectedProgram && <button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { setProgramEditId(selectedProgram.id); setProgramName(selectedProgram.name); setProgramActive(selectedProgram.active); }}><Edit3 size={14}/> Edit selected program</button>}
        <form onSubmit={submitProgram} className="sms-mini-form"><h3>{programEditId ? 'Edit program' : 'Or add a new program'}</h3><label className="sms-field">Program name<input required maxLength={100} value={programName} onChange={event => setProgramName(event.target.value)} placeholder="e.g. Creative Writing" disabled={!organizationId || Boolean(busy)}/></label>{programEditId && <label className="sms-checkbox"><input type="checkbox" checked={programActive} onChange={event => setProgramActive(event.target.checked)}/> Active program</label>}<div className="sms-actions"><button className="sms-button sms-primary" type="submit" disabled={Boolean(busy) || !organizationId || !programName.trim()}>{busy === 'program' ? 'Saving…' : programEditId ? 'Save changes' : 'Add program'}<Plus size={15}/></button>{programEditId && <button className="sms-text-button" type="button" onClick={clearProgramForm} disabled={Boolean(busy)}>Cancel</button>}</div></form>
      </section>
      <section className="sms-setup-card"><div className="sms-step-header"><span>3</span><div><h2>Teacher’s phone</h2><p>Who will send the check-in?</p></div></div>
        {teacherEditId && <p className="sms-form-help">Editing an existing teacher. Choose a different organization or program above to move their future check-ins.</p>}
        <form onSubmit={submitTeacher}><label className="sms-field">Teacher name<input required maxLength={100} value={teacherName} onChange={event => setTeacherName(event.target.value)} placeholder="Full name" disabled={!programId || Boolean(busy)}/></label><label className="sms-field">Phone number, with country code<input type="tel" required pattern="\+[1-9][0-9]{7,14}" title="Use international format, for example +14155550123, without spaces." value={teacherPhone} onChange={event => setTeacherPhone(event.target.value)} placeholder="+14155550123" disabled={!programId || Boolean(busy)} autoComplete="off"/></label><p className="sms-form-help">One phone belongs to one program and one organization. Use + followed by the country code and number, without spaces.</p>{teacherEditId && <label className="sms-checkbox"><input type="checkbox" checked={teacherActive} onChange={event => setTeacherActive(event.target.checked)}/> Active teacher</label>}<div className="sms-actions"><button className="sms-button sms-primary" type="submit" disabled={Boolean(busy) || !programId || !teacherName.trim() || !teacherPhone.trim()}>{busy === 'teacher' ? 'Saving…' : teacherEditId ? 'Save teacher' : 'Register teacher'}<ArrowRight size={15}/></button>{teacherEditId && <button type="button" className="sms-text-button" onClick={clearTeacherForm} disabled={Boolean(busy)}>Cancel</button>}</div></form>
      </section>
    </div>
    <section className="sms-panel sms-mappings"><div className="sms-panel-heading"><div><span className="sms-kicker">PHONE → PROGRAM → ORGANIZATION</span><h2>Registered teachers</h2><p>{selectedOrganization?.name || 'All organizations'}{selectedProgram ? ` / ${selectedProgram.name}` : ''}</p></div><span className="sms-count">{teachers.length} mappings</span></div>{teachers.length ? <div className="sms-table-scroll"><table className="sms-table"><thead><tr><th>Teacher</th><th>Phone</th><th>Organization / program</th><th>Status</th><th><span className="sms-sr-only">Actions</span></th></tr></thead><tbody>{teachers.map(teacher => <tr key={teacher.id}><td><b>{teacher.name}</b></td><td className="sms-mono">{teacher.phone}</td><td>{organizations.find(organization => organization.id === teacher.organizationId)?.name || 'Unknown organization'}<small>{data.programs.find(program => program.id === teacher.programId)?.name || 'Unknown program'}</small></td><td><span className={`sms-status-badge${teacherStatus(teacher) === 'Active' ? '' : ' sms-badge-neutral'}`}>{teacherStatus(teacher)}</span></td><td><div className="sms-table-actions"><button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { setOrganizationId(teacher.organizationId); setProgramId(teacher.programId); clearOrganizationForm(); clearProgramForm(); setTeacherEditId(teacher.id); setTeacherName(teacher.name); setTeacherPhone(teacher.phone); setTeacherActive(teacher.active); window.scrollTo({ top: 250, behavior: 'smooth' }); }}><Edit3 size={13}/> Edit</button><button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { void save({ action: 'teacher', id: teacher.id, name: teacher.name, phone: teacher.phone, programId: teacher.programId, active: !teacher.active }, teacher.active ? 'Teacher disabled. New messages from this number will be quarantined.' : 'Teacher enabled. New valid texts can be counted.'); }}>{teacher.active ? 'Disable' : 'Enable'}</button></div></td></tr>)}</tbody></table></div> : <div className="sms-empty"><Phone size={25}/><h3>No teachers registered here yet.</h3><p>Complete the three steps above to connect a phone to its program.</p></div>}<div className="sms-panel-foot"><ShieldCheck size={14}/> Disabling a mapping keeps its history. Editing a mapping does not rewrite accepted records.</div></section>
    <section className="sms-panel sms-records"><div className="sms-panel-heading"><div><span className="sms-kicker">PRIVATE · NEWEST 50 RECORDS</span><h2>Incoming SMS records</h2><p>Every received text is preserved. Only accepted, mapped messages enter the totals.</p></div><div className="sms-record-controls"><span className="sms-status-badge">{smsNumber(data.stats.counted)} counted</span><span className="sms-status-badge sms-badge-amber">{smsNumber(data.stats.quarantined)} quarantined</span><label><span className="sms-sr-only">Filter SMS records</span><select value={recordFilter} onChange={event => setRecordFilter(event.target.value)}><option value="all">All records</option><option value="counted">Counted</option><option value="quarantined">Quarantined</option></select></label><button className="sms-icon-button" onClick={live.refresh} disabled={live.refreshing} aria-label="Refresh records"><RefreshCw size={16}/></button></div></div>
      {records.length ? <div className="sms-table-scroll"><table className="sms-table sms-record-table"><thead><tr><th>Received / sender</th><th>SMS body</th><th>Mapped to</th><th>Result</th><th>Next step</th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td><time dateTime={record.receivedAt}>{smsTime(record.receivedAt)}</time><small className="sms-mono">{record.senderPhone}</small></td><td><span className="sms-raw-body">{record.body}</span></td><td>{record.organizationName || 'Unmapped'}<small>{record.programName || 'No program'}</small></td><td><span className={`sms-status-badge${record.status === 'counted' ? '' : ' sms-badge-amber'}`}>{record.status}</span>{record.status === 'counted' && <small>{smsNumber(record.attendees || 0)} visits · {smsNumber((record.sessionMinutes || 0) / 60)} session h</small>}</td><td><p className="sms-record-reason">{reasonLabel(record.reason)}</p>{retryable(record) && <button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { void save({ action: 'retry', id: record.id }, 'Record reprocessed. Check its updated result below.'); }}><RefreshCw size={13}/>{busy === `retry:${record.id}` ? 'Retrying…' : 'Retry after fixing mapping'}</button>}</td></tr>)}</tbody></table></div> : <div className="sms-empty"><MessageSquare size={25}/><h3>{recordFilter === 'all' ? 'Waiting for a first check-in.' : 'No records match this filter.'}</h3><p>Texts will appear automatically when the SMS webhook is connected.</p></div>}
      <div className="sms-panel-foot"><LockKeyhole size={14}/> Phone numbers and message bodies are private admin data. They never appear on the dashboards.</div>
    </section>
    <div className="sms-format-note"><div><b>The text format is simple.</b><p>Send two numbers separated by a space: attendees, then session hours. <strong>20 2</strong> means 20 attendees and 2 hours. Use whole attendees from 0 to 10,000; hours must be greater than 0 and at most 24, in quarter-hour steps (.25, .5, .75).</p></div><div><b>Something didn’t match?</b><p>Unknown or inactive senders are quarantined, not counted. Fix the mapping and retry. If the text itself is invalid, the teacher needs to send a corrected text.</p></div></div>
  </div>;
}
