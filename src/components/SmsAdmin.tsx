'use client';

import CenterCollectionSetup from './CenterCollectionSetup';

import HelpTip from './HelpTip';
import { parseSmsReversal } from '@/lib/sms';
import SmsBusinessSettings, { BusinessRequestImport, type ManagerGrant } from './SmsBusinessSettings';
import { userScrollBehavior } from '@/lib/accessibility';
import { productMessage } from '@/lib/product-copy';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Edit3, MessageSquare, Phone, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { SmsAccess, SmsApiError, smsNumber, smsRequest, smsTime, useSmsLive } from './SmsDashboard';
import type { CourseIdentity } from '../lib/course-attendance';
import { COURSE_SUMMARY_STATUS_LABELS, type CourseSummaryStatus } from '../lib/course-summary';

type Organization = { id: string; name: string; slug: string; active: boolean };
type Program = { id: string; organizationId: string; name: string; active: boolean };
type Teacher = { id: string; name: string; phone: string; organizationId: string; programId: string; courseId: string | null; active: boolean; createdAt: string };
export type SmsAdminCourse = CourseIdentity & { status: CourseSummaryStatus };
type ManualCorrection = { source: 'manual'; correctedBy: string; correctedAt: string; reason: string; originalReason: string; attendees: number; sessionMinutes: number };
type SmsRecord = { id: string; reversedByRecordId?: string | null; reversedAt?: string | null; reversalTargetId?: string | null; canImportBusinessRequest?: boolean; businessRequestId?: string | null; businessRequestStatus?: string | null; canCorrect?: boolean; manualCorrection?: ManualCorrection | null; repeatedFromRecordId?: string | null; messageSid: string; senderPhone: string; body: string; status: string; reason: string | null; organizationName: string | null; programName: string | null; attendees: number | null; sessionMinutes: number | null; receivedAt: string };
type AdminData = { organizations: Organization[]; programs: Program[]; teachers: Teacher[]; courses: SmsAdminCourse[]; records: SmsRecord[]; stats: { counted: number; quarantined: number }; inboundNumber: string | null; webhookConfigured: boolean };
type Mutation = Record<string, string | number | boolean | null> & { action: string };

export const SMS_PROGRAM_ONLY = 'program-only';
export type SmsCourseSelection = { value: string; programId: string; needsReview: boolean };
const emptyCourseSelection = (): SmsCourseSelection => ({ value: '', programId: '', needsReview: false });

export function smsCourseLabel(course: SmsAdminCourse) {
  const location = [course.facility || 'Choose a location', course.yard].filter(Boolean).join(' / ');
  const dates = `${course.startDate || 'Choose a start date'} to ${course.endDate || 'Choose an end date'}`;
  return `${course.programName} · ${location} · ${dates} · ${COURSE_SUMMARY_STATUS_LABELS[course.status]} · #${course.id.slice(0, 8)}…${course.id.slice(-4)}`;
}

/** Keep the prior choice visible, but never silently apply it to a new program. */
export function reviewSmsCourseSelection(selection: SmsCourseSelection, programId: string): SmsCourseSelection {
  return selection.value && selection.programId !== programId ? { ...selection, needsReview: true } : selection;
}

export function smsCourseSelectionError(selection: SmsCourseSelection, organizationId: string, programId: string, courses: SmsAdminCourse[]) {
  if (!programId) return 'Choose an organization and program name first.';
  if (!selection.value || selection.needsReview || selection.programId !== programId) return 'Choose a program or explicitly select Program name only.';
  if (selection.value === SMS_PROGRAM_ONLY) return '';
  const course = courses.find(item => item.id === selection.value);
  if (!course) return 'The selected program is unavailable. Choose a program or explicitly select Program name only.';
  if (course.organizationId !== organizationId || course.programId !== programId) return 'Choose a program within the selected organization and program name.';
  return '';
}

/** Manual form validation is numeric, not the stricter literal SMS spelling. */
export function smsCorrectionInput(attendance: string, duration: string, explanation: string) {
  const attendees = Number(attendance); const hours = Number(duration); const reason = explanation.trim();
  if (!attendance.trim() || !Number.isInteger(attendees) || attendees < 0 || attendees > 10000) throw new Error('Enter whole attendance from 0 to 10,000.');
  if (!duration.trim() || !Number.isFinite(hours) || hours < 0.25 || hours > 24 || !Number.isInteger(hours * 4)) throw new Error('Enter session hours from 0.25 to 24 in quarter-hour steps.');
  if (!reason || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason)) throw new Error('Enter a correction reason of 1–500 characters without line breaks.');
  return { attendees, hours, reason };
}

function retryable(record: SmsRecord) {
  return !parseSmsReversal(record.body).ok && record.status === 'quarantined' && ['UNKNOWN_SENDER', 'INACTIVE_SENDER', 'INVALID_COURSE'].includes(record.reason || '');
}
function reasonLabel(reason: string | null) {
  const labels: Record<string, string> = {
    REVERSAL_NO_MATCH: 'No matching active session in this phone’s current program. No totals changed. Send a new command if needed.',
    REVERSAL_APPLIED: 'One matching session was reversed. To restore it, send the positive attendees and hours as a new SMS.',
    UNKNOWN_SENDER: 'Register this phone, then check the message again.',
    INACTIVE_SENDER: 'This sender or its organization/program is inactive. Enable the mapping, then retry.',
    INVALID_COURSE: 'Restore the original program binding, then check this message again. Earlier records keep their original program.',
    INVALID_BODY: 'Ask the facilitator to send attendance and session hours, for example 20 2.',
    REPEAT_BASELINE_REQUIRED: 'Ask the facilitator to send two numbers to establish the first check-in for this program.',
  };
  return reason ? labels[reason] || productMessage(reason.replace(/_/g, ' ')) : 'Accepted and included in totals.';
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
  const [teacherCourse, setTeacherCourse] = useState<SmsCourseSelection>(emptyCourseSelection);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [errorAttempt, setErrorAttempt] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const teacherNameRef = useRef<HTMLInputElement>(null);
  const correctionInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!error) return;
    const frame = window.requestAnimationFrame(() => { errorRef.current?.focus({ preventScroll: true }); errorRef.current?.scrollIntoView({ block: 'center', behavior: userScrollBehavior() }); });
    return () => window.cancelAnimationFrame(frame);
  }, [error, errorAttempt]);
  const [recordFilter, setRecordFilter] = useState('all');
  const [businessPermissionsAllowed, setBusinessPermissionsAllowed] = useState(false);
  const [businessGrants, setBusinessGrants] = useState<ManagerGrant[]>([]);
  const [businessRefreshToken, setBusinessRefreshToken] = useState(0);
  const [businessImportNeedsRefresh, setBusinessImportNeedsRefresh] = useState(false);
  const [importedRequestIds, setImportedRequestIds] = useState<string[]>([]);
  const handleBusinessAccess = useCallback((allowed: boolean, grants: ManagerGrant[]) => { setBusinessPermissionsAllowed(allowed); setBusinessGrants(allowed ? grants : []); }, []);
  const [correctionId, setCorrectionId] = useState('');
  const [correctionAttendance, setCorrectionAttendance] = useState('');
  const [correctionHours, setCorrectionHours] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const data = live.data;
  const organizations = data?.organizations ?? [];
  const programs = (data?.programs ?? []).filter(program => program.organizationId === organizationId);
  const selectedOrganization = organizations.find(organization => organization.id === organizationId);
  const selectedProgram = programs.find(program => program.id === programId);
  const courses = data?.courses ?? [];
  const programCourses = courses.filter(course => course.organizationId === organizationId && course.programId === programId);
  const courseSelectionError = smsCourseSelectionError(teacherCourse, organizationId, programId, courses);
  const selectedCourse = courses.find(course => course.id === teacherCourse.value);
  const courseChoiceMissing = teacherCourse.value && teacherCourse.value !== SMS_PROGRAM_ONLY && !programCourses.some(course => course.id === teacherCourse.value);
  const courseSelectionNeedsReview = teacherCourse.needsReview || Boolean(teacherCourse.value && teacherCourse.programId !== programId) || Boolean(courseChoiceMissing);
  const previousCourseLabel = teacherCourse.value === SMS_PROGRAM_ONLY ? 'Program name only' : selectedCourse ? smsCourseLabel(selectedCourse) : `Unavailable program · #${teacherCourse.value.slice(0, 8)}`;
  const courseMaintenanceHref = organizationId ? `/courses?organizationId=${encodeURIComponent(organizationId)}` : '/courses';


  function clearOrganizationForm() { setOrganizationEditId(''); setOrganizationName(''); setOrganizationActive(true); }
  function clearProgramForm() { setProgramEditId(''); setProgramName(''); setProgramActive(true); }
  function clearTeacherForm() { setTeacherEditId(''); setTeacherName(''); setTeacherPhone(''); setTeacherActive(true); setTeacherCourse(emptyCourseSelection()); }
  function changeTeacherProgram(id: string) { setProgramId(id); setTeacherCourse(selection => reviewSmsCourseSelection(selection, id)); }
  function chooseOrganization(id: string) { setOrganizationId(id); changeTeacherProgram(''); clearOrganizationForm(); clearProgramForm(); }
  function chooseProgram(id: string) { changeTeacherProgram(id); clearProgramForm(); }
  async function save(payload: Mutation, message: string, onSuccess?: (result: { id?: string }) => void, endpoint = '/api/sms/admin') {
    if (busyRef.current) return;
    if (payload.action === 'import-request' && (!businessPermissionsAllowed || live.stale || businessImportNeedsRefresh)) return;
    setErrorAttempt(value => value + 1);
    busyRef.current = true; setBusy(payload.action === 'retry' ? `retry:${payload.id}` : payload.action); setNotice(''); setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = await smsRequest<{ id?: string }>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      if (payload.action === 'import-request') setImportedRequestIds(ids => [...ids, String(payload.recordId)]);
      setNotice(message); onSuccess?.(result); live.refresh();
    } catch (err) {
      if (payload.action === 'import-request' && (!(err instanceof SmsApiError) || err.status < 400 || err.status >= 500)) setBusinessImportNeedsRefresh(true);
      if (err instanceof SmsApiError && [401, 403, 503].includes(err.status)) live.refresh();
      setError(err instanceof Error && err.name !== 'AbortError' ? productMessage(err.message) : 'Refresh and check the saved phone details before submitting again.');
    } finally { window.clearTimeout(timeout); busyRef.current = false; setBusy(''); }
  }
  function submitOrganization(event: FormEvent) {
    event.preventDefault(); const name = organizationName.trim();
    void save({ action: 'organization', ...(organizationEditId ? { id: organizationEditId } : {}), name, active: organizationActive }, organizationEditId ? 'Organization updated.' : 'Organization added. Next, add a program name.', result => { if (result.id) { setOrganizationId(result.id); if (result.id !== organizationId) changeTeacherProgram(''); } clearOrganizationForm(); });
  }
  function submitProgram(event: FormEvent) {
    event.preventDefault(); const name = programName.trim();
    void save({ action: 'program', ...(programEditId ? { id: programEditId } : {}), organizationId, name, active: programActive }, programEditId ? 'Program name updated.' : 'Program name added. Next, register a facilitator’s phone.', result => { if (result.id) changeTeacherProgram(result.id); clearProgramForm(); });
  }
  function submitTeacher(event: FormEvent) {
    event.preventDefault();
    if (courseSelectionError) { setErrorAttempt(value => value + 1); setError(courseSelectionError); return; }
    void save({ action: 'teacher', ...(teacherEditId ? { id: teacherEditId } : {}), name: teacherName.trim(), phone: teacherPhone.trim(), programId, courseId: teacherCourse.value === SMS_PROGRAM_ONLY ? null : teacherCourse.value, active: teacherActive }, teacherEditId ? 'Facilitator mapping updated. Earlier accepted records keep their original attribution.' : 'Facilitator registered. They can now text the shared number.', clearTeacherForm);
  }
  function clearCorrection() { setCorrectionId(''); setCorrectionAttendance(''); setCorrectionHours(''); setCorrectionReason(''); }
  function finishCorrection() {
    const id = correctionId; clearCorrection();
    window.requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-correct-record="${id}"]`) ?? document.getElementById('sms-records-heading'))?.focus());
  }
  function openCorrection(record: SmsRecord) {
    if (busyRef.current || !record.canCorrect) return;
    if (correctionId && correctionId !== record.id && (correctionAttendance || correctionHours || correctionReason) && !window.confirm('Discard the unsaved correction?')) return;
    clearCorrection(); setCorrectionId(record.id); setError(''); setNotice('');
    window.requestAnimationFrame(() => { correctionInputRef.current?.focus({ preventScroll: true }); correctionInputRef.current?.scrollIntoView({ block: 'center', behavior: userScrollBehavior() }); });
  }
  function submitCorrection(event: FormEvent, id: string) {
    event.preventDefault();
    if (busyRef.current) return;
    setErrorAttempt(value => value + 1);
    if (!data?.records.find(record => record.id === id)?.canCorrect) { setError('Refresh the messages to review this record’s current status.'); return; }
    try {
      const values = smsCorrectionInput(correctionAttendance, correctionHours, correctionReason);
      void save({ action: 'correct', id, ...values }, 'Numbers saved and counted once. The original text is unchanged.', finishCorrection);
    } catch (err) { setError(err instanceof Error ? productMessage(err.message) : 'Review the correction values.'); }
  }
  if (!data) return <div className="sms-content"><SmsAccess session={live.session} loading={live.loading} error={live.error} retry={live.refresh}/></div>;
  const teachers = data.teachers.filter(teacher => (!organizationId || teacher.organizationId === organizationId) && (!programId || teacher.programId === programId));
  function teacherStatus(teacher: Teacher) {
    if (!teacher.active) return 'Inactive';
    if (!organizations.find(item => item.id === teacher.organizationId)?.active) return 'Organization inactive';
    if (!data?.programs.find(item => item.id === teacher.programId)?.active) return 'Program name inactive';
    return 'Active';
  }
  const records = data.records.slice(0, 50).filter(record => recordFilter === 'all' || record.status === recordFilter);
  return <div className="sms-content sms-admin-content">
    <a className="sms-back" href="/"><ArrowLeft size={15}/> Dashboard</a>
    <div className="sms-heading"><div><h1>Facilitator phones & text messages</h1><p>Choose where each facilitator’s check-ins are counted.</p></div></div>
    <div className="sms-admin-intro"><div><MessageSquare size={23}/><div><b>Facilitator check-ins</b><p><strong>{data.inboundNumber || 'Receiving number setup pending'}</strong> · <strong>20 2</strong> = 20 attendees, 2 session hours. <strong>1</strong> repeats this phone’s last counted values for its current program as a new session.<HelpTip label="How to send a check-in" text="All facilitators text the same number. Separate attendees and session hours with a space. Use whole attendees from 0 to 10,000 and session hours from 0.25 to 24 in quarter-hour steps (.25, .5, .75). Send two numbers for the first check-in and whenever attendance or hours change. Send 1 to add a new session using this phone’s latest counted values for its current program."/></p></div></div><span className={`sms-status-badge${data.webhookConfigured ? '' : ' sms-badge-amber'}`}>{data.webhookConfigured ? 'Text setup ready' : 'Text setup needed'}</span></div>
    {!data.webhookConfigured && <div className="sms-alert">Save facilitator details now. Complete text messaging setup to receive their check-ins.</div>}
    {live.stale && <div className="sms-alert" role="status">Live refresh is interrupted. Last successful refresh: {live.lastChecked ? smsTime(new Date(live.lastChecked).toISOString()) : 'Awaiting refresh'}. {live.error}</div>}
    {businessImportNeedsRefresh && <p className="sms-alert" role="status">Reload saved messages to check this request before submitting again. Save any open form first. <button type="button" className="sms-text-button" onClick={() => window.location.reload()}>Reload saved messages</button></p>}
    {notice && <div className="sms-feedback sms-success" role="status"><CheckCircle2 size={18}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss success message"><X size={16}/></button></div>}
    {error && <div className="sms-feedback sms-error" role="alert" tabIndex={-1} ref={errorRef}><CircleAlert size={18}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    <div className="sms-setup-grid">
      <section className="sms-setup-card"><div className="sms-step-header"><span>1</span><div><h2>Organization</h2></div></div>
        <label className="sms-field">Choose an organization<select value={organizationId} onChange={event => chooseOrganization(event.target.value)} disabled={Boolean(busy)}><option value="">Select an organization</option>{organizations.map(organization => <option value={organization.id} key={organization.id}>{organization.name}{organization.active ? '' : ' (inactive)'}</option>)}</select></label>
        {selectedOrganization && <button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { setOrganizationEditId(selectedOrganization.id); setOrganizationName(selectedOrganization.name); setOrganizationActive(selectedOrganization.active); }}><Edit3 size={14}/> Edit selected organization</button>}
        <form onSubmit={submitOrganization} className="sms-mini-form"><h3>{organizationEditId ? 'Edit organization' : 'Or add a new organization'}</h3><label className="sms-field">Organization name<input required maxLength={100} value={organizationName} onChange={event => setOrganizationName(event.target.value)} placeholder="e.g. Community Arts Collective" disabled={Boolean(busy)}/></label>{organizationEditId && <label className="sms-checkbox"><input type="checkbox" checked={organizationActive} onChange={event => setOrganizationActive(event.target.checked)}/> Active organization</label>}<div className="sms-actions"><button className="sms-button sms-primary" type="submit" disabled={Boolean(busy) || !organizationName.trim()}>{busy === 'organization' ? 'Saving…' : organizationEditId ? 'Save changes' : 'Add organization'}<Plus size={15}/></button>{organizationEditId && <button className="sms-text-button" type="button" onClick={clearOrganizationForm} disabled={Boolean(busy)}>Cancel</button>}</div></form>
      </section>
      <section className="sms-setup-card"><div className="sms-step-header"><span>2</span><div><h2>Program name</h2></div></div>
        <label className="sms-field">Choose a program name<select value={programId} onChange={event => chooseProgram(event.target.value)} disabled={!organizationId || Boolean(busy)}><option value="">{organizationId ? 'Select a program name' : 'Choose an organization first'}</option>{programs.map(program => <option value={program.id} key={program.id}>{program.name}{program.active ? '' : ' (inactive)'}</option>)}</select></label>
        {selectedProgram && <button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { setProgramEditId(selectedProgram.id); setProgramName(selectedProgram.name); setProgramActive(selectedProgram.active); }}><Edit3 size={14}/> Edit selected program</button>}
        <form onSubmit={submitProgram} className="sms-mini-form"><h3>{programEditId ? 'Edit program name' : 'Or add a new program name'}</h3><label className="sms-field">Program name<input required maxLength={100} value={programName} onChange={event => setProgramName(event.target.value)} placeholder="e.g. Creative Writing" disabled={!organizationId || Boolean(busy)}/></label>{programEditId && <label className="sms-checkbox"><input type="checkbox" checked={programActive} onChange={event => setProgramActive(event.target.checked)}/> Active program name</label>}<div className="sms-actions"><button className="sms-button sms-primary" type="submit" disabled={Boolean(busy) || !organizationId || !programName.trim()}>{busy === 'program' ? 'Saving…' : programEditId ? 'Save changes' : 'Add program name'}<Plus size={15}/></button>{programEditId && <button className="sms-text-button" type="button" onClick={clearProgramForm} disabled={Boolean(busy)}>Cancel</button>}</div></form>
      </section>
      <section className="sms-setup-card"><div className="sms-step-header"><span>3</span><div><h2>Facilitator’s phone</h2></div></div><p className="sms-form-help">Facilitator access only. Leader permissions are separate.</p>
        {teacherEditId && <p className="sms-form-help">Editing an existing facilitator.<HelpTip label="Moving future check-ins" text="Choose a different organization or program name above to move this facilitator’s future check-ins. Review the program binding before saving; accepted history stays unchanged."/></p>}
        <form onSubmit={submitTeacher}><label className="sms-field">Facilitator name<input ref={teacherNameRef} required maxLength={100} value={teacherName} onChange={event => setTeacherName(event.target.value)} placeholder="Full name" disabled={!programId || Boolean(busy)}/></label><label className="sms-field">Phone number, with country code<input type="tel" required pattern="\+[1-9][0-9]{7,14}" title="Use international format, for example +14155550123, without spaces." value={teacherPhone} onChange={event => setTeacherPhone(event.target.value)} placeholder="+14155550123" disabled={!programId || Boolean(busy)} autoComplete="off" aria-describedby="sms-phone-hint"/></label><p className="sms-form-help" id="sms-phone-hint">Use +country code and number, without spaces.<HelpTip label="One phone, one mapping" text="A phone has one organization and program name, with an optional saved program. Edit its existing mapping rather than registering the same phone twice."/></p>
          <label className="sms-field">Program for this phone (optional)<select required value={courseSelectionNeedsReview ? '' : teacherCourse.value} onChange={event => setTeacherCourse({ value: event.target.value, programId, needsReview: false })} disabled={!programId || Boolean(busy)} aria-describedby={courseSelectionNeedsReview ? 'sms-course-binding-help sms-course-binding-warning' : 'sms-course-binding-help'}><option value="" disabled>{programId ? 'Choose a program or program name only' : 'Choose a program name first'}</option><option value={SMS_PROGRAM_ONLY}>Program name only</option>{programCourses.map(course => <option key={course.id} value={course.id}>{smsCourseLabel(course)}</option>)}</select></label>
          <p className="sms-form-help" id="sms-course-binding-help">Future check-ins only. <a href={courseMaintenanceHref}>Manage programs</a><HelpTip label="Saved program or name only" text="A saved program receives future sessions in its chart. Program name only adds sessions to totals for that name. Manage saved programs separately."/></p>
          {selectedCourse && !courseSelectionNeedsReview && <p className="sms-form-help">Selected program: {smsCourseLabel(selectedCourse)}</p>}
          {courseSelectionNeedsReview && <p className="sms-alert" id="sms-course-binding-warning" role="alert">Previous choice: {previousCourseLabel}. Choose a saved program or Program name only, then save.</p>}
          {programId && !programCourses.length && <p className="sms-form-help">Choose Program name only, or add a saved program with this name.</p>}
          {teacherEditId && <label className="sms-checkbox"><input type="checkbox" checked={teacherActive} onChange={event => setTeacherActive(event.target.checked)}/> Active facilitator</label>}<div className="sms-actions"><button className="sms-button sms-primary" type="submit" disabled={Boolean(busy) || !programId || !teacherName.trim() || !teacherPhone.trim() || Boolean(courseSelectionError)}>{busy === 'teacher' ? 'Saving…' : 'Save facilitator'}<ArrowRight size={15}/></button>{teacherEditId && <button type="button" className="sms-text-button" onClick={clearTeacherForm} disabled={Boolean(busy)}>Cancel</button>}</div></form>
      </section>
    </div>
    <section className="sms-panel sms-mappings"><div className="sms-panel-heading"><div><h2>Registered facilitators</h2><p>{selectedOrganization?.name || 'All organizations'}{selectedProgram ? ` / ${selectedProgram.name}` : ''}</p></div><span className="sms-count">{teachers.length} facilitators</span></div>{teachers.length ? <div className="sms-table-scroll" tabIndex={0} role="region" aria-label="Registered facilitators, scroll horizontally"><table className="sms-table" aria-label="Registered facilitators"><thead><tr><th scope="col">Facilitator</th><th scope="col">Phone</th><th scope="col">Organization / program name</th><th scope="col">Program for this phone</th><th scope="col">Status</th><th scope="col"><span className="sms-sr-only">Actions</span></th></tr></thead><tbody>{teachers.map(teacher => <tr key={teacher.id}><td><b>{teacher.name}</b><small>Facilitator{businessGrants.some(grant => grant.active && grant.phone === teacher.phone && grant.organizationId === teacher.organizationId) ? ' · Organization leader' : ''}</small></td><td className="sms-mono">{teacher.phone}</td><td>{organizations.find(organization => organization.id === teacher.organizationId)?.name || 'Unknown organization'}<small>{data.programs.find(program => program.id === teacher.programId)?.name || 'Unknown program name'}</small></td><td>{teacher.courseId ? courses.find(course => course.id === teacher.courseId) ? smsCourseLabel(courses.find(course => course.id === teacher.courseId)!) : `Unavailable program · #${teacher.courseId.slice(0, 8)}` : 'Program name only'}</td><td><span className={`sms-status-badge${teacherStatus(teacher) === 'Active' ? '' : ' sms-badge-neutral'}`}>{teacherStatus(teacher)}</span></td><td><div className="sms-table-actions"><button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { setOrganizationId(teacher.organizationId); setProgramId(teacher.programId); clearOrganizationForm(); clearProgramForm(); setTeacherEditId(teacher.id); setTeacherName(teacher.name); setTeacherPhone(teacher.phone); setTeacherActive(teacher.active); setTeacherCourse({ value: teacher.courseId ?? SMS_PROGRAM_ONLY, programId: teacher.programId, needsReview: false }); window.requestAnimationFrame(() => { teacherNameRef.current?.focus({ preventScroll: true }); teacherNameRef.current?.scrollIntoView({ block: 'center', behavior: userScrollBehavior() }); }); }}><Edit3 size={13}/> Edit</button><button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { void save({ action: 'teacher', id: teacher.id, name: teacher.name, phone: teacher.phone, programId: teacher.programId, courseId: teacher.courseId ?? null, active: !teacher.active }, teacher.active ? 'Facilitator disabled. New messages from this number will be quarantined.' : 'Facilitator enabled. New valid texts can be counted.'); }}>{teacher.active ? 'Disable' : 'Enable'}</button></div></td></tr>)}</tbody></table></div> : <div className="sms-empty"><Phone size={25}/><h3>Register the first facilitator.</h3><p>Complete the three steps above to connect a phone to its program.</p></div>}<div className="sms-panel-foot"><ShieldCheck size={14}/> History stays unchanged.<HelpTip label="Mapping changes and history" text="Active phones contribute new check-ins. Saved history stays unchanged when a phone is edited or disabled."/></div></section>
    <section className="sms-panel" style={{padding:20,marginBottom:24}}><h2>Reverse a check-in</h2><p>Text <b>-59 3</b> to reverse your latest active 59-person, 3-hour session in your current program. Each new negative message reverses one matching session; sending it again intentionally can reverse the next match. Carrier retries do not repeat the reversal. No match means no change.</p><p>Original messages stay in history. Restore a mistaken reversal by sending <b>59 3</b> as a new session. Reversed sessions are not used by the <b>1</b> shortcut.</p></section>
    <CenterCollectionSetup onSaved={live.refresh}/>
    <SmsBusinessSettings organizations={organizations} teachers={data.teachers} onAccessChange={handleBusinessAccess} onPermissionChange={live.refresh} refreshToken={businessRefreshToken}/>
    <section className="sms-panel sms-records"><div className="sms-panel-heading"><div><span className="sms-kicker">NEWEST 50 RECORDS</span><h2 id="sms-records-heading" tabIndex={-1}>Text messages<HelpTip label="Counted and quarantined records" text="Only accepted messages from registered facilitators enter totals. Messages pending review are excluded; their original text is kept."/></h2></div><div className="sms-record-controls"><span className="sms-status-badge">{smsNumber(data.stats.counted)} counted</span><span className="sms-status-badge sms-badge-amber">{smsNumber(data.stats.quarantined)} pending review</span><label><span className="sms-sr-only">Filter SMS records</span><select value={recordFilter} onChange={event => setRecordFilter(event.target.value)}><option value="all">All records</option><option value="counted">Counted</option><option value="quarantined">Pending review</option><option value="reversed">Reversed sessions</option><option value="reversal">Reversal commands</option></select></label><button className="sms-icon-button" onClick={live.refresh} disabled={live.refreshing} aria-label="Refresh records"><RefreshCw size={16}/></button></div></div>
      {records.length ? <div className="sms-table-scroll" tabIndex={0} role="region" aria-label="Text messages, scroll horizontally"><table className="sms-table sms-record-table" aria-label="Text messages"><thead><tr><th scope="col">Received / sender</th><th scope="col">Original message</th><th scope="col">Organization / program name</th><th scope="col">Result</th><th scope="col">Next step<HelpTip label="Reviewing a check-in" text="For an unknown or inactive sender, update the facilitator’s details and select Check again. A missing or inconsistent original program also needs repair. Ask the facilitator for a corrected text if the numbers are invalid. If you have confirmed the numbers and the row offers Fix numbers, count it once with a reason. The original text stays unchanged."/></th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td><time dateTime={record.receivedAt}>{smsTime(record.receivedAt)}</time><small className="sms-mono">{record.senderPhone}</small></td><td><span className="sms-raw-body">{record.body}</span></td><td>{record.organizationName || 'Unmapped'}<small>{record.programName || 'Choose a program'}</small></td><td><span className={`sms-status-badge${record.status === 'counted' ? '' : ' sms-badge-amber'}`}>{record.businessRequestId ? record.businessRequestStatus === 'completed' ? 'Completed' : 'Program request received' : record.status === 'reversed' ? 'Reversed' : record.status === 'reversal' ? 'Reversal applied' : record.status === 'counted' ? 'Counted' : 'Pending review'}</span>{['counted','reversed'].includes(record.status) && <small>{smsNumber(record.attendees || 0)} attendees · {smsNumber((record.sessionMinutes || 0) / 60)} session h</small>}{record.reversedByRecordId && <small>Reversed {smsTime(record.reversedAt)} · command #{record.reversedByRecordId}</small>}{record.reversalTargetId && <small>Reversed session #{record.reversalTargetId}</small>}{record.repeatedFromRecordId && <small>Repeated values<HelpTip label="Repeat source" text={`This new session copied attendance and hours from counted record ${record.repeatedFromRecordId}. Its original SMS body is preserved.`}/></small>}{record.manualCorrection && <small>Manually corrected<HelpTip label="Correction details" text={`${record.manualCorrection.reason} Original result: ${record.manualCorrection.originalReason}. Corrected ${smsTime(record.manualCorrection.correctedAt)} by ${record.manualCorrection.correctedBy}. Original SMS preserved.`}/></small>}</td><td><p className="sms-record-reason">{record.businessRequestId ? 'Program-change request. Attendance totals are unchanged.' : record.status === 'reversed' ? 'Original preserved; excluded from totals and graphs. Send the positive numbers again to restore as a new session.' : reasonLabel(record.reason)}</p>{businessPermissionsAllowed && !live.stale && !businessImportNeedsRefresh && !importedRequestIds.includes(record.id) && record.canImportBusinessRequest && !record.businessRequestId && <BusinessRequestImport recordId={record.id} organizations={organizations.filter(item => businessGrants.some(grant => grant.active && grant.phone === record.senderPhone && grant.organizationId === item.id))} busy={Boolean(busy)} onSubmit={(input, onSuccess) => { void save({ action: 'import-request', ...input }, 'This message was added as a program-change request. Attendance totals are unchanged.', () => { onSuccess(); setBusinessRefreshToken(value => value + 1); }, '/api/sms/business-admin'); }}/>} {retryable(record) && <button className="sms-text-button" disabled={Boolean(busy)} onClick={() => { void save({ action: 'retry', id: record.id }, 'Record reprocessed. Check its updated result below.'); }}><RefreshCw size={13}/>{busy === `retry:${record.id}` ? 'Retrying…' : 'Check again'}</button>}{record.canCorrect && !record.businessRequestId && correctionId !== record.id && <button className="sms-text-button" type="button" disabled={Boolean(busy)} data-correct-record={record.id} onClick={() => openCorrection(record)}><Edit3 size={13}/>Fix numbers</button>}{record.canCorrect && !record.businessRequestId && correctionId === record.id && <form className="sms-correction-form" onSubmit={event => submitCorrection(event, record.id)}>
        <p>Count this message once with confirmed numbers. The original text stays unchanged.</p>
        <div className="sms-correction-values"><label>Attendance<input ref={correctionInputRef} type="number" min="0" max="10000" step="1" required value={correctionAttendance} onChange={event => setCorrectionAttendance(event.target.value)} disabled={Boolean(busy)}/></label><label>Session hours<input type="number" min="0.25" max="24" step="0.25" required value={correctionHours} onChange={event => setCorrectionHours(event.target.value)} disabled={Boolean(busy)}/></label></div>
        <label>Reason for correction<input type="text" maxLength={500} required value={correctionReason} onChange={event => setCorrectionReason(event.target.value)} disabled={Boolean(busy)}/></label>
        <div className="sms-actions"><button className="sms-button sms-primary" type="submit" disabled={Boolean(busy) || !correctionAttendance.trim() || !correctionHours.trim() || !correctionReason.trim()}>{busy === 'correct' ? 'Saving…' : 'Save and count'}</button><button className="sms-text-button" type="button" onClick={finishCorrection} disabled={Boolean(busy)}>Cancel</button></div>
      </form>}</td></tr>)}</tbody></table></div> : <div className="sms-empty"><MessageSquare size={25}/><h3>{recordFilter === 'all' ? 'Waiting for a first check-in.' : 'Choose another message filter.'}</h3><p>Received check-ins appear here once text messaging is set up.</p></div>}
    </section>
  </div>;
}
