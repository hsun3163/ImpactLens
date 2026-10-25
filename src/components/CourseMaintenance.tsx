'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Building2, Check, CheckCircle2, Copy, Leaf, LockKeyhole, MapPin, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import { COURSE_SUMMARY_STATUS_LABELS, COURSE_SUMMARY_STATUSES, courseSummaryToDraft, type CourseSummary, type CourseSummaryData, type CourseSummaryDraft } from '@/lib/course-summary';
import { CDCR_FACILITIES, COURSE_DEMO_STORAGE_KEY, anotherCourseDraft, applyDemoCourseSave, applyDemoMetadata, courseDerivedValues, createCourseDemo, maintenanceDraftToWrite, newCourseDraft, parseCourseDemo, serializeCourseDemo, type CourseMetadataWrite, type CourseWorkspace } from '@/lib/course-maintenance';

type Access = { authenticated: boolean; authorized: boolean; configured: boolean };
type NameEditor = CourseMetadataWrite;
const emptyWorkspace: CourseWorkspace = { organizations: [], programs: [], summaries: [] };
const formatNumber = (value: number | null) => value === null ? 'Not reported' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
function formatDate(value: string | null) { return value ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Not set'; }
class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new RequestError('The course workspace did not respond. Please try again.', response.status);
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new RequestError(typeof result.error === 'string' ? result.error : 'The request could not be completed.', response.status);
  return result as T;
}
function Status({ value }: { value: CourseSummary['status'] }) { return <span className={`cm-status cm-status-${value}`}><span />{COURSE_SUMMARY_STATUS_LABELS[value]}</span>; }

export default function CourseMaintenance({ demo = false, initialOrganizationId = '' }: { demo?: boolean; initialOrganizationId?: string }) {
  const [workspace, setWorkspace] = useState<CourseWorkspace>(emptyWorkspace);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [programId, setProgramId] = useState('');
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [draft, setDraft] = useState<CourseSummaryDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reused, setReused] = useState(false);
  const [nameEditor, setNameEditor] = useState<NameEditor | null>(null);
  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [addingProgram, setAddingProgram] = useState(false);
  const [inlineProgramName, setInlineProgramName] = useState('');
  const [inlineCreateId, setInlineCreateId] = useState('');
  const saving = useRef(false);
  const loadVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const activeOrganization = useRef(organizationId);
  const activeProgram = useRef(programId);
  activeOrganization.current = organizationId; activeProgram.current = programId;

  const installWorkspace = useCallback((next: CourseWorkspace, requestedOrg = '', requestedProgram = '') => {
    const nextOrg = next.organizations.some(item => item.id === requestedOrg) ? requestedOrg : next.organizations[0]?.id ?? '';
    const programs = next.programs.filter(item => item.organizationId === nextOrg);
    const nextProgram = programs.some(item => item.id === requestedProgram) ? requestedProgram : programs[0]?.id ?? '';
    setWorkspace(next); setOrganizationId(nextOrg); setProgramId(nextProgram);
  }, []);

  const load = useCallback(async (requestedOrg = '', requestedProgram = '') => {
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    if (demo) {
      try {
        const stored = window.localStorage.getItem(COURSE_DEMO_STORAGE_KEY);
        const next = stored ? parseCourseDemo(stored) : createCourseDemo();
        if (!stored) window.localStorage.setItem(COURSE_DEMO_STORAGE_KEY, serializeCourseDemo(next));
        installWorkspace(next, requestedOrg, requestedProgram);
      } catch (err) {
        setError(err instanceof Error ? err.message + ' Demo changes have not been saved.' : 'Browser storage is unavailable.');
        // Keep existing data on a failed refresh; do not silently reset corrupt saved work.
        setWorkspace(current => current.organizations.length ? current : emptyWorkspace);
      } finally { setLoading(false); }
      return;
    }
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 12000);
    try {
      const session = await request<Access>('/api/sms/session', { signal: abort.signal });
      if (version !== loadVersion.current) return;
      setAccess(session);
      if (!session.authenticated || !session.authorized || !session.configured) { setWorkspace(emptyWorkspace); return; }
      const metadata = await request<Pick<CourseWorkspace, 'organizations' | 'programs'>>('/api/sms/course-metadata', { signal: abort.signal });
      const selectedOrg = metadata.organizations.some(item => item.id === requestedOrg) ? requestedOrg : metadata.organizations[0]?.id ?? '';
      const data = selectedOrg ? await request<CourseSummaryData>('/api/sms/summaries?organizationId=' + encodeURIComponent(selectedOrg), { signal: abort.signal }) : null;
      if (version !== loadVersion.current) return;
      installWorkspace({ ...metadata, summaries: data?.summaries ?? [] }, selectedOrg, requestedProgram); setTruncated(data?.truncated ?? false);
    } catch (err) {
      if (version !== loadVersion.current) return;
      if (err instanceof RequestError && [401, 403].includes(err.status)) { setWorkspace(emptyWorkspace); setAccess({ configured: true, authenticated: err.status !== 401, authorized: false }); }
      setError(err instanceof Error && err.name !== 'AbortError' ? err.message : 'The connection timed out. Your unsaved changes are still here.');
    } finally { window.clearTimeout(timeout); if (version === loadVersion.current) setLoading(false); }
  }, [demo, installWorkspace]);

  useEffect(() => { void load(initialOrganizationId); return () => { ++loadVersion.current; controller.current?.abort(); }; }, [load, initialOrganizationId]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => {
    if (!demo) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== COURSE_DEMO_STORAGE_KEY || !event.newValue) return;
      try { installWorkspace(parseCourseDemo(event.newValue), activeOrganization.current, activeProgram.current); setFeedback('Demo records were updated in another tab. An open draft is not overwritten.'); }
      catch { setError('The demo data in browser storage could not be read. Your open draft is unchanged.'); }
    };
    window.addEventListener('storage', onStorage); return () => window.removeEventListener('storage', onStorage);
  }, [demo, installWorkspace]);

  const organization = workspace.organizations.find(item => item.id === organizationId);
  const programs = workspace.programs.filter(item => item.organizationId === organizationId);
  const program = programs.find(item => item.id === programId);
  const courses = workspace.summaries.filter(item => item.organizationId === organizationId && (!programFilter || item.programId === programFilter))
    .filter(item => !search || `${item.facility ?? ''} ${item.yard ?? ''} ${item.startDate ?? ''} ${COURSE_SUMMARY_STATUS_LABELS[item.status]}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const allProgramCourses = workspace.summaries.filter(item => item.organizationId === organizationId);
  const canEdit = demo || access?.authorized === true;
  function discardAllowed() { return !dirty || window.confirm('Discard the unsaved course changes?'); }
  function closeEditor() { if (saving.current || !discardAllowed()) return false; setDraft(null); setNameEditor(null); setDirty(false); setError(''); return true; }
  function chooseOrganization(id: string) {
    if (!closeEditor()) return;
    setFeedback(''); setSearch(''); setProgramFilter(''); setOrganizationId(id); setProgramId(workspace.programs.find(item => item.organizationId === id)?.id ?? '');
    if (!demo) void load(id);
  }
  function chooseProgram(id: string) { if (!closeEditor()) return; setProgramId(id); setFeedback(''); setSearch(''); }
  function openCourse(summary?: CourseSummary, copy = false) {
    if (saving.current || !discardAllowed()) return;
    setDraft(summary ? copy ? anotherCourseDraft(summary) : courseSummaryToDraft(summary) : newCourseDraft(organizationId, programId));
    setAddingProgram(!summary && !programId); setInlineProgramName(''); setInlineCreateId(crypto.randomUUID());
    setNameEditor(null); setDirty(false); setReused(copy); setError(''); setFeedback('');
    window.setTimeout(() => editorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }
  function editName(action: 'organization' | 'program', existing = false) {
    if (!closeEditor()) return;
    const item = action === 'organization' ? organization : program;
    setNameEditor({ action, ...(action === 'program' ? { organizationId } : {}), ...(existing && item ? { id: item.id } : { createId: crypto.randomUUID() }), name: existing && item ? item.name : '' });
    setError(''); setFeedback('');
  }
  function change<Key extends keyof CourseSummaryDraft>(key: Key, value: CourseSummaryDraft[Key]) { setDraft(current => current ? { ...current, [key]: value } : null); setDirty(true); setError(''); setFeedback(''); }
  function currentDemo() { const stored = window.localStorage.getItem(COURSE_DEMO_STORAGE_KEY); return stored ? parseCourseDemo(stored) : workspace; }
  function persistDemo(next: CourseWorkspace, selectedOrg = organizationId, selectedProgram = programId) {
    window.localStorage.setItem(COURSE_DEMO_STORAGE_KEY, serializeCourseDemo(next)); installWorkspace(next, selectedOrg, selectedProgram);
  }
  async function saveName(event: FormEvent) {
    event.preventDefault(); if (!nameEditor || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    const input = { ...nameEditor }; let id = input.id ?? input.createId ?? crypto.randomUUID();
    try {
      if (demo) persistDemo(applyDemoMetadata(currentDemo(), input, id), input.action === 'organization' ? id : organizationId, input.action === 'program' ? id : programId);
      else {
        const result = await request<{ id: string }>('/api/sms/course-metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); id = result.id;
        await load(input.action === 'organization' ? id : organizationId, input.action === 'program' ? id : programId);
      }
      setNameEditor(null); setDirty(false); setFeedback(`${input.action === 'organization' ? 'Organization' : 'Program'} ${input.id ? 'name updated' : 'created'}.${demo ? ' Saved in this browser only.' : ''}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'The name could not be saved.'); }
    finally { saving.current = false; setBusy(false); }
  }
  async function saveCourse(event: FormEvent) {
    event.preventDefault(); if (!draft || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const id = draft.id || crypto.randomUUID();
      let nextDraft = { ...draft, id };
      let demoData = demo ? currentDemo() : null;
      // Validate the course before creating reusable context, so invalid fields do not create orphan names.
      const newProgramId = inlineCreateId || crypto.randomUUID();
      if (!inlineCreateId) setInlineCreateId(newProgramId);
      maintenanceDraftToWrite({ ...nextDraft, programId: addingProgram ? newProgramId : nextDraft.programId }, id, workspace.summaries.find(item => item.id === draft.id));
      if (addingProgram) {
        const name = inlineProgramName.trim();
        if (!name || name.length > 100) throw new Error('Enter a program name of 1–100 characters.');
        const input: CourseMetadataWrite = { action: 'program', organizationId, createId: newProgramId, name };
        if (demoData) { demoData = applyDemoMetadata(demoData, input, newProgramId); nextDraft.programId = newProgramId; }
        else {
          const created = await request<{ id: string }>('/api/sms/course-metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
          nextDraft.programId = created.id;
          setWorkspace(current => ({ ...current, programs: [...current.programs, { id: created.id, organizationId, name, active: true }] }));
          setDraft(nextDraft); setAddingProgram(false); setInlineProgramName('');
        }
      }
      const write = maintenanceDraftToWrite(nextDraft, id, workspace.summaries.find(item => item.id === draft.id));
      setDraft(nextDraft); // A failed or uncertain course save retries the same record identity.
      if (demoData) persistDemo(applyDemoCourseSave(demoData, write), organizationId, write.programId);
      else {
        const result = await request<{ summary: CourseSummary }>('/api/sms/summaries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(write) });
        setWorkspace(current => ({ ...current, summaries: [result.summary, ...current.summaries.filter(item => item.id !== result.summary.id)] }));
      }
      setProgramId(write.programId); setProgramFilter(''); setSearch('');
      setDraft(null); setDirty(false); setFeedback(`${write.revision ? 'Course changes saved' : 'New course saved'}.${demo ? ' Stored in this browser only; no live records changed.' : ' Existing courses remain separate.'}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'The course could not be saved. Your draft is still here.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function refreshWorkspace() { if (saving.current || !discardAllowed()) return; setDraft(null); setDirty(false); setNameEditor(null); void load(organizationId, programId); }
  function resetDemo() {
    if (saving.current || !window.confirm('Reset this browser’s synthetic demo? This removes only your demo edits, not live records.')) return;
    try { persistDemo(createCourseDemo(), '', ''); setDraft(null); setNameEditor(null); setDirty(false); setFeedback('Synthetic demo reset. No live records changed.'); setError(''); }
    catch { setError('Browser storage is unavailable. The demo was not reset.'); }
  }

  return <div className="cm-shell">
    <header className="cm-topbar"><a className="cm-brand" href="/courses"><span><Leaf size={19}/></span>ImpactLens<span className="cm-brand-dot">.</span></a><span className="cm-product">COURSE WORKSPACE</span><nav aria-label="Course workspace navigation"><a href={demo ? '/courses' : '/demo/courses'}>{demo ? 'Live workspace' : 'Try the demo'}<ArrowRight size={14}/></a><a href="/sms">SMS check-ins<ArrowRight size={14}/></a></nav></header>
    <main className="cm-main">
      <div className={`cm-mode-note ${demo ? 'cm-demo-note' : ''}`}><span>{demo ? <BookOpen size={16}/> : <LockKeyhole size={15}/>}<b>{demo ? 'INTERACTIVE DEMO' : 'PRIVATE TPW WORKSPACE'}</b></span><p>{demo ? 'Fictional organizations and courses. Your edits stay in this browser, never in live data.' : 'Live editing is currently limited to authorized TPW administrators. Organization self-service access is not enabled.'}</p>{demo && <button onClick={resetDemo} disabled={busy}>Reset demo</button>}</div>
      <div className="cm-page-heading"><div><span className="cm-eyebrow">ORGANIZATIONS · PROGRAMS · COURSES</span><h1>My courses<span>.</span></h1><p>Add a course, update its details, or use a past course to start another.</p></div><div className="cm-independence"><CheckCircle2 size={17}/><span>No phone number or SMS setup needed.</span></div></div>
      {error && <div className="cm-alert cm-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
      {feedback && <div className="cm-alert cm-success" role="status"><CheckCircle2 size={17}/>{feedback}<button onClick={() => setFeedback('')} aria-label="Dismiss confirmation"><X size={16}/></button></div>}
      {!canEdit && !demo ? <section className="cm-access"><div className="cm-access-icon"><LockKeyhole size={29}/></div><h2>{loading ? 'Checking your access…' : access?.configured === false ? 'The private workspace needs an administrator.' : access?.authenticated ? 'TPW administrator access is required.' : 'Sign in to maintain saved courses.'}</h2><p>{loading ? 'No private course records are loaded until your access is verified.' : access?.authenticated ? 'Your account has not been granted access to this private workspace. You can still explore the fully interactive synthetic demo.' : 'Use the approved TPW administrator account for live records, or try the demo without signing in.'}</p><div className="cm-button-row">{!loading && <><a className="cm-button cm-primary" href="/signin-with-chatgpt?return_to=%2Fcourses" target="_top">Sign in with ChatGPT<ArrowRight size={15}/></a><a className="cm-button" href="/demo/courses">Try the demo</a><button className="cm-text-button" onClick={() => void load(initialOrganizationId)}>Check again</button></>}</div></section> : loading && !workspace.organizations.length ? <div className="cm-empty"><RefreshCw size={24}/><h2>Loading your course workspace…</h2></div> : <div className="cm-workspace">
        <div className="cm-organization-bar">
          <div><Building2 size={19}/><div><span>Organization Name</span><strong>{organization?.name ?? 'Choose an organization to get started'}</strong></div></div>
          <details><summary>Organization & program names</summary><div className="cm-settings">
            <label htmlFor="cm-organization">Organization Name<select id="cm-organization" value={organizationId} disabled={busy || loading} onChange={event => chooseOrganization(event.target.value)}>{!organizationId && <option value="">Choose an organization</option>}{workspace.organizations.map(item => <option key={item.id} value={item.id}>{item.name}{!item.active ? ' (inactive)' : ''}</option>)}</select></label>
            <div className="cm-small-actions"><button onClick={() => editName('organization')} disabled={busy || loading}><Plus size={13}/>Add organization</button>{organization && <button onClick={() => editName('organization', true)} disabled={busy || loading}><Pencil size={12}/>Rename organization</button>}</div>
            {programs.length > 0 && <><label>Program Name<select value={programId} onChange={event => chooseProgram(event.target.value)} disabled={busy || loading}>{programs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="cm-text-button" onClick={() => editName('program', true)} disabled={busy || loading}>Rename selected program</button></>}
            <p>Names are reused across courses. This section is not needed to edit a course.</p>
          </div></details>
        </div>
        <section className="cm-content" ref={editorRef} aria-label="Courses">
          {nameEditor ? <form className="cm-name-form" onSubmit={saveName}><button className="cm-back" type="button" onClick={closeEditor} disabled={busy}><ArrowLeft size={15}/>Back to courses</button><span className="cm-eyebrow">SAVED CONTEXT</span><h2>{nameEditor.id ? 'Rename' : 'Add'} {nameEditor.action}</h2><p>{nameEditor.action === 'program' ? `Saved under ${organization?.name ?? 'this organization'}. You can use it for courses at different facilities.` : 'Only the existing organization name is needed. No profile questionnaire.'}</p><label>{nameEditor.action === 'program' ? 'Program Name' : 'Organization Name'}<input autoFocus required maxLength={100} value={nameEditor.name} onChange={event => { setNameEditor({ ...nameEditor, name: event.target.value }); setDirty(true); }} disabled={busy}/></label>{nameEditor.id && <p className="cm-field-note">This updates the reusable name. Course results and historical SMS records are not rewritten.</p>}<div className="cm-button-row"><button type="submit" className="cm-button cm-primary" disabled={busy}>{busy ? 'Saving…' : nameEditor.id ? 'Save name' : `Create ${nameEditor.action}`}<Check size={15}/></button><button type="button" className="cm-button" onClick={closeEditor} disabled={busy}>Cancel</button></div></form> : draft ? <form className="cm-editor" onSubmit={saveCourse}>
            <button className="cm-back" type="button" onClick={closeEditor} disabled={busy}><ArrowLeft size={15}/>Back to course history</button>
            <div className="cm-editor-heading"><div><span className="cm-eyebrow">{organization?.name}</span><h2>{draft.revision ? 'Edit course' : reused ? 'Another course, less retyping.' : 'Add a course'}</h2></div><span className="cm-draft-badge">{dirty ? 'Unsaved changes' : draft.revision ? 'Saved record' : 'New draft'}</span></div>
            <p className="cm-editor-intro">{reused ? 'Organization, program, facility and yard are reused. Dates, hours, counts and notes are cleared. Status starts at Planned. Review this new run before saving.' : 'Use a saved program name or add a new one here. Leave anything you do not know blank. You can update it later.'}</p>
            <div className="cm-inline-program"><label>Program Name<select value={addingProgram ? '__new__' : draft.programId} disabled={busy} onChange={event => { const adding = event.target.value === '__new__'; setAddingProgram(adding); if (!adding) change('programId', event.target.value); else { setDirty(true); setError(''); } }}><option value="" disabled>Choose a saved program</option>{programs.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="__new__">+ Add a new program name</option></select></label>{addingProgram && <label>New Program Name<input required maxLength={100} disabled={busy} value={inlineProgramName} onChange={event => { setInlineProgramName(event.target.value); setDirty(true); }} placeholder="Type the program’s name"/></label>}</div>
            <fieldset disabled={busy}><legend>Where and when?</legend>
              <div className="cm-field-grid"><label className="cm-field-wide">CDCR Facilities<div className="cm-input-icon"><Search size={16}/><input list="cm-facilities" value={draft.facility} onChange={event => change('facility', event.target.value)} placeholder="Search facilities by name or abbreviation" maxLength={150} autoComplete="off"/><datalist id="cm-facilities">{CDCR_FACILITIES.map(facility => <option key={facility} value={facility}/>)}</datalist></div><small>31 options from the existing TPW sheet. Leave blank if not known.</small></label>
                <label className="cm-field-wide">Yard<input value={draft.yard} onChange={event => change('yard', event.target.value)} placeholder="e.g. North or A Yard" maxLength={100}/><small>Use your existing wording. Optional.</small></label>
                <div className="cm-field-wide"><span className="cm-field-label">Schedule Status</span><div className="cm-status-options" role="group" aria-label="Schedule Status">{COURSE_SUMMARY_STATUSES.map(status => <button key={status} type="button" aria-pressed={draft.status === status} onClick={() => change('status', status)} className={draft.status === status ? 'cm-active' : ''}>{draft.status === status && <Check size={14}/>}<span>{COURSE_SUMMARY_STATUS_LABELS[status]}</span></button>)}</div></div>
                <label>Start Date<input type="date" value={draft.startDate} onChange={event => change('startDate', event.target.value)}/></label><label>End Date<input type="date" value={draft.endDate} onChange={event => change('endDate', event.target.value)}/></label><span className="cm-field-note cm-field-wide">Dates may be left blank while they are not yet determined.</span>
              </div>
            </fieldset>
            <fieldset disabled={busy}><legend>Course hours & participation</legend><p className="cm-field-note">These values belong to this whole course, not to an individual SMS check-in. Fill them in or update them when known.</p><div className="cm-field-grid cm-count-fields"><label className="cm-field-wide">Course Hours (per Participant)<input type="number" inputMode="decimal" min="0" max="1000000" step="any" value={draft.courseHoursPerParticipant} onChange={event => change('courseHoursPerParticipant', event.target.value)} placeholder="Not reported"/><small>Total course hours for one participant, not session hours.</small></label><label>Number of Participants<input type="number" inputMode="numeric" min="0" max="1000000" step="1" value={draft.participants} onChange={event => change('participants', event.target.value)} placeholder="Not reported"/></label><label>Number of Participants Completed<input type="number" inputMode="numeric" min="0" max="1000000" step="1" value={draft.completers} onChange={event => change('completers', event.target.value)} placeholder="Not reported"/></label></div></fieldset>
            <details className="cm-notes" open={Boolean(draft.notes)}><summary>Notes <span>Optional · existing spreadsheet field</span></summary><label><span className="cm-sr-only">Notes</span><textarea value={draft.notes} onChange={event => change('notes', event.target.value)} maxLength={4000} rows={3} disabled={busy} placeholder="An optional note for this course"/></label><p>Notes appears in the source sheet, not in the original form.</p></details>
            {draft.revision > 0 && (() => { const current = workspace.summaries.find(item => item.id === draft.id); if (!current) return null; const derived = courseDerivedValues(current); return <div className="cm-derived"><span>From the saved record, calculated only:</span><p>Program year: <b>{derived.programYear ?? 'Not set'}</b><span> · </span>Total participant programming hours: <b>{formatNumber(derived.completedParticipantHours)}</b></p><small>Course hours per participant × participants completed. Not SMS attendance hours.</small></div>; })()}
            <div className="cm-save-bar"><p>{demo ? 'Demo only · saved in this browser' : 'Saved to the existing course records'}<small>No SMS data or phone mapping is changed.</small></p><div className="cm-button-row"><button className="cm-button" type="button" disabled={busy} onClick={closeEditor}>Cancel</button><button className="cm-button cm-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save course'}<Check size={16}/></button></div></div>
          </form> : <>
            <div className="cm-content-heading"><div><span className="cm-eyebrow">YOUR SAVED COURSES</span><h2>What would you like to update?</h2><p>Open a course below, or add a new one.</p></div>{organization && <button className="cm-button cm-primary" onClick={() => openCourse()} disabled={busy || loading}><Plus size={17}/>Add course</button>}</div>
            {organization ? <><div className="cm-history-toolbar"><span>ALL COURSES <b>{allProgramCourses.length}{truncated ? '+' : ''}</b></span><div><label className="cm-sr-only" htmlFor="cm-program-filter">Filter by program</label><select id="cm-program-filter" className="cm-filter" value={programFilter} onChange={event => setProgramFilter(event.target.value)}><option value="">All programs</option>{programs.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><label className="cm-search"><Search size={15}/><span className="cm-sr-only">Search course history</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a facility or date"/></label><button className="cm-icon-button" onClick={refreshWorkspace} disabled={busy || loading} aria-label="Reload saved courses"><RefreshCw size={16} className={loading ? 'cm-spin' : ''}/></button></div></div>{truncated && <p className="cm-alert">Showing the 100 most recently updated courses for this organization. Older records are not included in this view.</p>}
              {courses.length ? <div className="cm-course-grid">{courses.map(course => <article className="cm-course-card" key={course.id}><div className="cm-card-top"><div className="cm-site-icon"><MapPin size={20}/></div><Status value={course.status}/></div><span className="cm-course-program">{course.programName}</span><h3>{course.facility || 'Facility not set'}</h3><p className="cm-yard">{course.yard ? `Yard: ${course.yard}` : 'Yard not set'}</p><div className="cm-card-dates"><span>{formatDate(course.startDate)}</span><ArrowRight size={13}/><span>{formatDate(course.endDate)}</span></div><dl className="cm-card-values"><div><dt>Course hours / participant</dt><dd>{formatNumber(course.courseHoursPerParticipant)}</dd></div><div><dt>Participants</dt><dd>{formatNumber(course.participants)}</dd></div><div><dt>Completed</dt><dd>{formatNumber(course.completers)}</dd></div></dl><div className="cm-card-actions"><button onClick={() => openCourse(course)} disabled={busy || loading}><Pencil size={15}/>Edit course</button><button onClick={() => openCourse(course, true)} disabled={busy || loading}><Copy size={15}/>Add another like this</button></div></article>)}</div> : <div className="cm-empty"><BookOpen size={32}/><h3>{search || programFilter ? 'No matching courses' : 'Your first course starts here.'}</h3><p>{search || programFilter ? 'Try another program, facility or date.' : 'Add the details you know now. You can come back to fill in dates and results.'}</p>{!search && !programFilter && <button className="cm-button cm-primary" onClick={() => openCourse()}><Plus size={16}/>Add course</button>}</div>}</> : <div className="cm-empty"><Building2 size={32}/><p>Start with your organization’s name. You will not need a phone number or SMS setup.</p><button className="cm-button cm-primary" onClick={() => editName('organization')}><Plus size={16}/>Add organization</button>{demo && !workspace.organizations.length && <button className="cm-text-button" onClick={resetDemo}>Restore synthetic demo</button>}</div>}
            <div className="cm-history-foot"><CheckCircle2 size={15}/><span>Course information is maintained here independently. SMS check-ins do not fill in or recalculate these fields.</span></div>
          </>}
        </section>
      </div>}
      <footer className="cm-footer"><span>TPW · Existing fields, less repeated entry.</span><span>{demo ? 'Synthetic data · browser-local storage' : 'Live records · TPW administrator access only'}</span></footer>
    </main>
  </div>;
}
