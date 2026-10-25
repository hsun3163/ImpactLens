'use client';

import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardList, Pencil, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  COURSE_SUMMARY_SOURCE, COURSE_SUMMARY_STATUSES, COURSE_SUMMARY_STATUS_LABELS,
  courseSummaryToDraft, courseSummaryDraftToWrite, type CourseSummary, type CourseSummaryData, type CourseSummaryDraft as Draft, type CourseSummaryWrite,
} from '../lib/course-summary';
import { SmsAccess, SmsApiError, smsNumber, smsRequest, smsTime, useSmsLive } from './SmsDashboard';

function blank(organizationId = ''): Draft {
  return { id: '', revision: 0, organizationId, programId: '', facility: '', yard: '', status: '', startDate: '', endDate: '', courseHoursPerParticipant: '', participants: '', completers: '', notes: '' };
}
const showNumber = (value: number | null) => value === null ? 'Not reported' : smsNumber(value);
const showText = (value: string | null) => value || 'Not reported';
function SummaryDetails({ summary }: { summary: CourseSummaryWrite }) {
  const planned = summary.status === 'planned';
  return <dl className="sms-summary-details">
    <div><dt>Facility / yard</dt><dd>{showText(summary.facility)} / {showText(summary.yard)}</dd></div>
    <div><dt>Start / end dates</dt><dd>{showText(summary.startDate)} → {showText(summary.endDate)}</dd></div>
    <div><dt>{planned ? 'Planned participants' : 'Reported participants'}</dt><dd>{showNumber(summary.participants)}</dd></div>
    <div><dt>{planned ? 'Planned completers' : 'Reported completers'}</dt><dd>{showNumber(summary.completers)}</dd></div>
    <div><dt>{planned ? 'Planned course hours / participant' : 'Course hours / participant'}</dt><dd>{showNumber(summary.courseHoursPerParticipant)}</dd></div>
    <div className="sms-summary-notes"><dt>Notes</dt><dd>{showText(summary.notes)}</dd></div>
  </dl>;
}

/** Only existing TPW course-summary fields; no SMS-derived person/completion counts. */
export default function CourseSummaries({ organizationId }: { organizationId?: string }) {
  const endpoint = `/api/sms/summaries${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`;
  const live = useSmsLive<CourseSummaryData>(endpoint, 5000);
  const [draft, setDraft] = useState<Draft>(() => blank(organizationId));
  const [reviewed, setReviewed] = useState<CourseSummaryWrite | null>(null);
  const [busy, setBusy] = useState(false); const saving = useRef(false);
  const [feedback, setFeedback] = useState(''); const [error, setError] = useState(''); const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false); const formRef = useRef<HTMLElement>(null);
  function change<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft(current => ({ ...current, [key]: value })); setReviewed(null); setError(''); setFeedback(''); setConflict(false); setDirty(true);
  }
  function discardAllowed() { return !dirty || window.confirm('Discard the unsaved changes to this course summary?'); }
  function newSummary() {
    if (saving.current || !discardAllowed()) return;
    setDraft(blank(organizationId)); setReviewed(null); setError(''); setFeedback(''); setConflict(false); setDirty(false); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function edit(summary: CourseSummary) {
    if (saving.current || !discardAllowed()) return;
    setDraft(courseSummaryToDraft(summary)); setReviewed(null); setError(''); setFeedback(''); setConflict(false); setDirty(false); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current) return;
    try {
      const id = draft.id || crypto.randomUUID();
      const value = courseSummaryDraftToWrite(draft, id);
      setDraft(current => ({ ...current, id })); setReviewed(value); setError(''); setFeedback(''); setConflict(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Review the course-summary fields.'); }
  }
  async function save() {
    if (!reviewed || saving.current) return;
    saving.current = true; setBusy(true); setError(''); setFeedback(''); setConflict(false);
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const result = await smsRequest<{ summary: CourseSummary; replayed: boolean }>('/api/sms/summaries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reviewed), signal: controller.signal });
      setDraft(courseSummaryToDraft(result.summary)); setReviewed(null); setDirty(false);
      setFeedback(result.replayed ? 'This exact summary was already saved. No duplicate was created.' : 'Course summary saved. SMS session totals are unchanged.'); live.refresh();
    } catch (err) {
      const isConflict = err instanceof SmsApiError && err.code === 'REVISION_CONFLICT';
      setConflict(isConflict);
      setError(isConflict ? err.message : err instanceof SmsApiError ? err.message : 'The save result could not be confirmed. Retry this same reviewed summary safely; it will not create a duplicate.');
      if (isConflict || err instanceof SmsApiError && [401, 403].includes(err.status)) live.refresh();
    } finally { window.clearTimeout(timeout); saving.current = false; setBusy(false); }
  }
  async function reloadSaved() {
    if (saving.current || !discardAllowed()) return;
    saving.current = true; setBusy(true);
    try {
      const latest = await smsRequest<CourseSummaryData>(endpoint); const summary = latest.summaries.find(item => item.id === draft.id);
      if (!summary) throw new Error('This summary is not in the latest saved list. Refresh and choose a saved summary again.');
      setDraft(courseSummaryToDraft(summary)); setReviewed(null); setDirty(false); setConflict(false); setError(''); setFeedback('Latest saved version loaded.'); live.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'The saved version could not be loaded.'); }
    finally { saving.current = false; setBusy(false); }
  }
  if (!live.data) return <SmsAccess session={live.session} loading={live.loading} error={live.error} retry={live.refresh}/>;
  const data = live.data; const programs = data.programs.filter(program => program.organizationId === draft.organizationId);
  const selectedProgram = data.programs.find(program => program.id === draft.programId);
  const selectedOrganization = data.organizations.find(organization => organization.id === draft.organizationId);
  return <div className="sms-summary-workspace">
    <div className="sms-summary-intro"><div><span className="sms-kicker">LESS ADMIN, CLEARER CONTEXT</span><h2>Course summaries</h2><p>Use the same TPW course fields. Choose a program and status, review, then save.</p></div><button className="sms-button sms-secondary" onClick={newSummary} disabled={busy}><Plus size={15}/> New summary</button></div>
    <div className="sms-summary-source"><ShieldCheck size={17}/><p><b>{COURSE_SUMMARY_SOURCE}</b> · Separate from SMS-reported sessions. Blank means not reported, never zero. Planned values are not delivered results. Participants and completers are reported for each course, not unique people across courses.</p></div>
    {live.error && <p className="sms-inline-error" role="alert">{live.error} Saved records may be out of date.</p>}
    <div className="sms-summary-layout">
      <section className="sms-panel sms-summary-editor" ref={formRef} aria-label="Course summary form">
        <div className="sms-panel-heading"><div><span className="sms-kicker">{draft.revision ? `EDIT · REVISION ${draft.revision}` : 'NEW COURSE SUMMARY'}</span><h2>{reviewed ? 'Review before saving' : 'A few familiar fields'}</h2></div><ClipboardList size={20}/></div>
        <div className="sms-summary-form-body">
          {feedback && <p className="sms-feedback" role="status"><CheckCircle2 size={16}/>{feedback}</p>}
          {error && <p className="sms-inline-error" role="alert">{error}</p>}
          {conflict && <button className="sms-button sms-secondary" onClick={() => void reloadSaved()} disabled={busy}>Reload latest saved version</button>}
          {reviewed ? <div className="sms-summary-review">
            <span className={`sms-summary-status sms-summary-status-${reviewed.status}`}>{COURSE_SUMMARY_STATUS_LABELS[reviewed.status]}</span>
            <h3>{selectedProgram?.name}</h3><p>{selectedOrganization?.name} · {COURSE_SUMMARY_SOURCE}</p>
            {reviewed.status === 'planned' && <p className="sms-summary-plan-note">These are plans, not completed delivery or measured outcomes.</p>}
            <SummaryDetails summary={reviewed}/>
            <div className="sms-summary-actions"><button className="sms-button sms-secondary" onClick={() => setReviewed(null)} disabled={busy}>Back to edit</button><button className="sms-button sms-primary" onClick={() => void save()} disabled={busy || conflict}>{busy ? 'Saving…' : draft.revision ? 'Save changes' : 'Save summary'}</button></div>
          </div> : <form onSubmit={review}>
            <fieldset disabled={busy} className="sms-summary-fields"><legend className="sms-sr-only">Existing course-summary fields</legend>
              <fieldset className="sms-summary-choice"><legend>1. Organization</legend><div>{data.organizations.filter(organization => !organizationId || organization.id === organizationId).map(organization => <button type="button" className={`sms-button ${draft.organizationId === organization.id ? 'sms-primary' : 'sms-secondary'}`} aria-pressed={draft.organizationId === organization.id} key={organization.id} onClick={() => { change('organizationId', organization.id); change('programId', ''); }}>{organization.name}{!organization.active && ' (inactive)'}</button>)}</div>{!data.organizations.length && <p>No organizations yet. <a href="/sms/admin">Add an organization and program</a> first.</p>}</fieldset>
              <fieldset className="sms-summary-choice"><legend>2. Existing program</legend><div>{programs.map(program => <button type="button" className={`sms-button ${draft.programId === program.id ? 'sms-primary' : 'sms-secondary'}`} aria-pressed={draft.programId === program.id} key={program.id} onClick={() => change('programId', program.id)}>{program.name}{!program.active && ' (inactive)'}</button>)}</div>{!programs.length && <p>{draft.organizationId ? 'No programs in this organization yet.' : 'Choose an organization first.'}</p>}</fieldset>
              <fieldset className="sms-summary-choice"><legend>3. Course status</legend><div>{COURSE_SUMMARY_STATUSES.map(status => <button type="button" className={`sms-button ${draft.status === status ? 'sms-primary' : 'sms-secondary'}`} aria-pressed={draft.status === status} key={status} onClick={() => change('status', status)}>{COURSE_SUMMARY_STATUS_LABELS[status]}</button>)}</div></fieldset>
              <p className="sms-summary-helper">Everything below may stay blank if it is not reported. Enter 0 only when it is known to be zero. Do not derive these values from SMS visits.</p>
              {draft.status === 'planned' && <p className="sms-summary-plan-note">This course is planned. Its counts and hours will be shown as plans, never as delivered results.</p>}
              <div className="sms-summary-field-grid">
                <label className="sms-field">Facility<input value={draft.facility} maxLength={150} onChange={event => change('facility', event.target.value)}/></label>
                <label className="sms-field">Yard<input value={draft.yard} maxLength={100} onChange={event => change('yard', event.target.value)}/></label>
                <label className="sms-field">Start date<input type="date" min="1900-01-01" max="9999-12-31" value={draft.startDate} onChange={event => change('startDate', event.target.value)}/></label>
                <label className="sms-field">End date<input type="date" min={draft.startDate || '1900-01-01'} max="9999-12-31" value={draft.endDate} onChange={event => change('endDate', event.target.value)}/></label>
                <label className="sms-field">{draft.status === 'planned' ? 'Planned participants' : 'Participants'}<input type="number" min="0" max="1000000" step="1" value={draft.participants} placeholder="Not reported" onChange={event => change('participants', event.target.value)}/></label>
                <label className="sms-field">{draft.status === 'planned' ? 'Planned completers' : 'Completers'}<input type="number" min="0" max="1000000" step="1" value={draft.completers} placeholder="Not reported" onChange={event => change('completers', event.target.value)}/></label>
                <label className="sms-field sms-summary-wide">{draft.status === 'planned' ? 'Planned course hours per participant' : 'Course hours per participant'}<input type="number" min="0" max="1000000" step="any" value={draft.courseHoursPerParticipant} placeholder="Not reported" onChange={event => change('courseHoursPerParticipant', event.target.value)}/></label>
                <label className="sms-field sms-summary-wide">Notes<textarea rows={3} maxLength={4000} value={draft.notes} onChange={event => change('notes', event.target.value)} placeholder="Course context only. Do not include names, phone numbers, or other personal information."/></label>
              </div>
              <button className="sms-button sms-primary" type="submit" disabled={!draft.programId || !draft.status}>Review summary</button>
            </fieldset>
          </form>}
        </div>
      </section>
      <section className="sms-panel sms-summary-saved"><div className="sms-panel-heading"><div><span className="sms-kicker">{COURSE_SUMMARY_SOURCE.toUpperCase()}</span><h2>Saved summaries</h2></div><button className="sms-icon-button" onClick={live.refresh} disabled={live.refreshing} aria-label="Refresh course summaries"><RefreshCw size={17} className={live.refreshing ? 'sms-spin' : ''}/></button></div>
        {data.truncated && <p className="sms-summary-helper">Showing the latest {data.limit} updated summaries, not a complete history.</p>}
        {data.summaries.length ? <div className="sms-summary-list">{data.summaries.map(summary => <article className="sms-summary-card" key={summary.id}><div className="sms-summary-card-top"><span className={`sms-summary-status sms-summary-status-${summary.status}`}>{COURSE_SUMMARY_STATUS_LABELS[summary.status]}</span><button className="sms-button sms-secondary" onClick={() => edit(summary)} disabled={busy} aria-label={`Edit ${summary.programName} course summary`}><Pencil size={13}/> Edit</button></div><h3>{summary.programName}</h3><p>{summary.organizationName} · {COURSE_SUMMARY_SOURCE}</p><SummaryDetails summary={summary}/><small>Updated {smsTime(summary.updatedAt)} · Revision {summary.revision}</small></article>)}</div> : <div className="sms-empty"><ClipboardList size={26}/><h3>No course summaries yet.</h3><p>Add a summary using existing course information. No additional indicators required.</p></div>}
        <div className="sms-panel-foot"><ShieldCheck size={14}/> No participant totals across courses. SMS figures stay separate.</div>
      </section>
    </div>
  </div>;
}
