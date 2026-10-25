'use client';

import HelpTip from './HelpTip';
import { productMessage } from '@/lib/product-copy';
import { courseErrorFields, userScrollBehavior } from '@/lib/accessibility';
import CourseEstimate from './CourseEstimate';
import CourseStatusDetails from './CourseStatusDetails';
import type { CourseEstimateTotals } from '@/lib/course-estimate';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Activity, BookOpen, Building2, Check, CheckCircle2, Copy, Leaf, LockKeyhole, MapPin, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import { COURSE_SUMMARY_STATUS_LABELS, CourseSummaryError, courseSummaryToDraft, type CourseSummary, type CourseSummaryData, type CourseSummaryDraft } from '@/lib/course-summary';
import { CDCR_FACILITIES, COURSE_DEMO_STORAGE_KEY, anotherCourseDraft, applyDemoCourseSave, applyDemoMetadata, courseDerivedValues, maintenanceDraftToWrite, newCourseDraft, parseCourseDemo, savedCourseYards, type CourseMetadataWrite, type CourseWorkspace } from '@/lib/course-maintenance';

type Access = { authenticated: boolean; authorized: boolean; configured: boolean };
import CourseAttendance, { CourseAttendanceChart } from './CourseAttendance';
import { COURSE_DEMO_CHANGED_EVENT, demoCourseAttendance, demoCourseServiceEstimate, readCourseDemo, resetCourseDemo, updateCourseDemo } from '@/lib/course-sms-demo';

type NameEditor = CourseMetadataWrite;
const emptyWorkspace: CourseWorkspace = { organizations: [], programs: [], summaries: [] };
const formatNumber = (value: number | null) => value === null ? 'Awaiting details' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
function formatDate(value: string | null) { return value ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Awaiting details'; }
class RequestError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new RequestError('Refresh the program workspace and try again.', response.status);
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new RequestError(typeof result.error === 'string' ? productMessage(result.error) : 'Review the request and try again.', response.status, typeof result.code === 'string' ? result.code : undefined);
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
  const [savedEstimate, setSavedEstimate] = useState<{ organizationId: string; totals: CourseEstimateTotals } | null>(null);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [draft, setDraft] = useState<CourseSummaryDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reused, setReused] = useState(false);
  const [nameEditor, setNameEditor] = useState<NameEditor | null>(null);
  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [addingYard, setAddingYard] = useState(false);
  const [attendanceId, setAttendanceId] = useState('');
  const attendanceRef = useRef<HTMLElement>(null);
  const [addingProgram, setAddingProgram] = useState(false);
  const [inlineProgramName, setInlineProgramName] = useState('');
  const [inlineCreateId, setInlineCreateId] = useState('');
  const saving = useRef(false);
  const draftGeneration = useRef('');
  const loadVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<{ element: HTMLElement | null; selector: string }>({ element: null, selector: '#cm-add-course' });
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
    setLoading(true); setError(''); setErrorCode(undefined);
    if (demo) {
      try {
        const stored = window.localStorage.getItem(COURSE_DEMO_STORAGE_KEY);
        const next = stored ? parseCourseDemo(stored) : await updateCourseDemo(latest => latest);
        if (version === loadVersion.current) installWorkspace(next, requestedOrg, requestedProgram);
      } catch (err) {
        setError(err instanceof Error ? productMessage(err.message) + ' Save the demo changes again after checking browser storage.' : 'Browser storage is unavailable.');
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
      setSavedEstimate(data?.serviceEstimate ? { organizationId: selectedOrg, totals: data.serviceEstimate } : null);
    } catch (err) {
      if (version !== loadVersion.current) return;
      if (err instanceof RequestError && [401, 403].includes(err.status)) { setWorkspace(emptyWorkspace); setAccess({ configured: true, authenticated: err.status !== 401, authorized: false }); }
      setError(err instanceof Error && err.name !== 'AbortError' ? productMessage(err.message) : 'The connection timed out. Your unsaved changes are still here.');
    } finally { window.clearTimeout(timeout); if (version === loadVersion.current) setLoading(false); }
  }, [demo, installWorkspace]);

  useEffect(() => { void load(initialOrganizationId); return () => { ++loadVersion.current; controller.current?.abort(); }; }, [load, initialOrganizationId]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => {
    if (!demo) return;
    const reloadShared = () => {
      try { installWorkspace(readCourseDemo(window.localStorage), activeOrganization.current, activeProgram.current); }
      catch { setError('Check browser storage to reopen the demo data. Your open draft remains here.'); }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== COURSE_DEMO_STORAGE_KEY && event.key !== null) return;
      reloadShared(); setFeedback('Shared demo records changed in another tab. Your open draft remains here.');
    };
    window.addEventListener('storage', onStorage); window.addEventListener(COURSE_DEMO_CHANGED_EVENT, reloadShared);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(COURSE_DEMO_CHANGED_EVENT, reloadShared); };
  }, [demo, installWorkspace]);

  const yardChoices = draft ? savedCourseYards(workspace, draft.organizationId, draft.facility) : [];
  const shownYards = draft?.yard && !yardChoices.includes(draft.yard) ? [draft.yard, ...yardChoices] : yardChoices;
  const attendanceCourse = workspace.summaries.find(item => item.id === attendanceId && item.organizationId === organizationId);
  const organization = workspace.organizations.find(item => item.id === organizationId);
  const programs = workspace.programs.filter(item => item.organizationId === organizationId);
  const program = programs.find(item => item.id === programId);
  const courses = workspace.summaries.filter(item => item.organizationId === organizationId && (!programFilter || item.programId === programFilter))
    .filter(item => !search || `${item.facility ?? ''} ${item.yard ?? ''} ${item.startDate ?? ''} ${COURSE_SUMMARY_STATUS_LABELS[item.status]}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const allProgramCourses = workspace.summaries.filter(item => item.organizationId === organizationId);
  const canEdit = demo || access?.authorized === true;
  const dashboardPath = demo ? '/sms/demo' : '/';
  const dashboardHref = organizationId ? `${dashboardPath}?organizationId=${encodeURIComponent(organizationId)}` : dashboardPath;
  const serviceEstimate = demo ? demoCourseServiceEstimate(workspace, organizationId) : savedEstimate?.organizationId === organizationId ? savedEstimate.totals : null;
  const courseEditorOpen = Boolean(draft) && canEdit;
  const invalidFields = error ? courseErrorFields(errorCode) : [];
  useEffect(() => {
    if (!error || !courseEditorOpen) return;
    const frame = window.requestAnimationFrame(() => {
      formErrorRef.current?.focus({ preventScroll: true });
      formErrorRef.current?.scrollIntoView({ block: 'nearest', behavior: userScrollBehavior() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, courseEditorOpen, saveAttempt]);
  function discardAllowed() { return !dirty || window.confirm('Discard the unsaved program changes?'); }
  function restoreEditorFocus() {
    window.requestAnimationFrame(() => {
      const previous = returnFocus.current;
      const target = previous.element?.isConnected ? previous.element : document.querySelector<HTMLElement>(previous.selector) ?? document.querySelector<HTMLElement>('#cm-add-course');
      target?.focus();
    });
  }
  function dismissEditor(restoreFocus: boolean) { if (saving.current || !discardAllowed()) return false; const wasEditing = Boolean(draft || nameEditor); setDraft(null); setNameEditor(null); setDirty(false); setError(''); setErrorCode(undefined); if (wasEditing && restoreFocus) restoreEditorFocus(); return true; }
  function closeEditor() { return dismissEditor(true); }
  function chooseOrganization(id: string) {
    if (!dismissEditor(false)) return;
    setFeedback(''); setSearch(''); setProgramFilter(''); setAttendanceId(''); setOrganizationId(id); setProgramId(workspace.programs.find(item => item.organizationId === id)?.id ?? '');
    if (!demo) void load(id);
  }
  function chooseProgram(id: string) { if (!dismissEditor(false)) return; setProgramId(id); setFeedback(''); setSearch(''); }
  function openCourse(summary?: CourseSummary, copy = false) {
    if (saving.current || !discardAllowed()) return;
    returnFocus.current = { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, selector: summary ? `[data-course-${copy ? 'copy' : 'edit'}="${summary.id}"]` : '#cm-add-course' };
    draftGeneration.current = workspace.demoGeneration ?? 'legacy-v1';
    setDraft(summary ? copy ? anotherCourseDraft(summary) : courseSummaryToDraft(summary) : newCourseDraft(organizationId, programId));
    setAddingYard(false); setAttendanceId('');
    setAddingProgram(!summary && !programId); setInlineProgramName(''); setInlineCreateId(crypto.randomUUID());
    setNameEditor(null); setDirty(false); setReused(copy); setError(''); setErrorCode(undefined); setFeedback('');
    window.requestAnimationFrame(() => { editorHeadingRef.current?.focus({ preventScroll: true }); editorRef.current?.scrollIntoView({ block: 'start', behavior: userScrollBehavior() }); });
  }
  function editName(action: 'organization' | 'program', existing = false) {
    if (!dismissEditor(false)) return;
    draftGeneration.current = workspace.demoGeneration ?? 'legacy-v1';
    returnFocus.current = { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, selector: '#cm-add-course' };
    const item = action === 'organization' ? organization : program;
    setNameEditor({ action, ...(action === 'program' ? { organizationId } : {}), ...(existing && item ? { id: item.id } : { createId: crypto.randomUUID() }), name: existing && item ? item.name : '' });
    setError(''); setErrorCode(undefined); setFeedback('');
  }
  function change<Key extends keyof CourseSummaryDraft>(key: Key, value: CourseSummaryDraft[Key]) { if (key === 'facility') setAddingYard(false); setDraft(current => current ? { ...current, [key]: value, ...(key === 'facility' && value !== current.facility ? { yard: '' } : {}) } : null); setDirty(true); setError(''); setErrorCode(undefined); setFeedback(''); }
  function requireDraftGeneration(latest: CourseWorkspace) { if ((latest.demoGeneration ?? 'legacy-v1') !== draftGeneration.current) throw new Error('The shared demo was reset in another tab. Reopen the program or name before saving. Your draft is still here.'); }
  async function mutateDemo(mutator: (latest: CourseWorkspace) => CourseWorkspace, selectedOrg = organizationId, selectedProgram = programId) {
    const next = await updateCourseDemo(mutator); installWorkspace(next, selectedOrg, selectedProgram);
  }
  async function saveName(event: FormEvent) {
    event.preventDefault(); if (!nameEditor || saving.current) return;
    saving.current = true; setBusy(true); setError(''); setErrorCode(undefined);
    const input = { ...nameEditor }; let id = input.id ?? input.createId ?? crypto.randomUUID();
    try {
      if (demo) await mutateDemo(latest => { requireDraftGeneration(latest); return applyDemoMetadata(latest, input, id); }, input.action === 'organization' ? id : organizationId, input.action === 'program' ? id : programId);
      else {
        const result = await request<{ id: string }>('/api/sms/course-metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); id = result.id;
        await load(input.action === 'organization' ? id : organizationId, input.action === 'program' ? id : programId);
      }
      setNameEditor(null); setDirty(false); restoreEditorFocus(); setFeedback(`${input.action === 'organization' ? 'Organization' : 'Program'} ${input.id ? 'name updated' : 'created'}.${demo ? ' Saved in this browser only.' : ''}`);
    } catch (err) { setError(err instanceof Error ? productMessage(err.message) : 'Review the name and save again.'); }
    finally { saving.current = false; setBusy(false); }
  }
  async function saveCourse(event: FormEvent) {
    event.preventDefault(); if (!draft || saving.current) return;
    setSaveAttempt(value => value + 1);
    saving.current = true; setBusy(true); setError(''); setErrorCode(undefined);
    try {
      const id = draft.id || crypto.randomUUID();
      let nextDraft = { ...draft, id };

      // Validate the course before creating reusable context, so invalid fields do not create orphan names.
      const newProgramId = inlineCreateId || crypto.randomUUID();
      if (!inlineCreateId) setInlineCreateId(newProgramId);
      maintenanceDraftToWrite({ ...nextDraft, programId: addingProgram ? newProgramId : nextDraft.programId }, id, workspace.summaries.find(item => item.id === draft.id));
      if (addingProgram) {
        const name = inlineProgramName.trim();
        if (!name || name.length > 100) throw new Error('Enter a program name of 1–100 characters.');
        const input: CourseMetadataWrite = { action: 'program', organizationId, createId: newProgramId, name };
        if (demo) { nextDraft.programId = newProgramId; }
        else {
          const created = await request<{ id: string }>('/api/sms/course-metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
          nextDraft.programId = created.id;
          setWorkspace(current => ({ ...current, programs: [...current.programs, { id: created.id, organizationId, name, active: true }] }));
          setDraft(nextDraft); setAddingProgram(false); setInlineProgramName('');
        }
      }
      const write = maintenanceDraftToWrite(nextDraft, id, workspace.summaries.find(item => item.id === draft.id));
      setDraft(nextDraft); // A failed or uncertain course save retries the same record identity.
      if (demo) await mutateDemo(latest => {
        requireDraftGeneration(latest);
        const withProgram = addingProgram ? applyDemoMetadata(latest, { action: 'program', organizationId, createId: newProgramId, name: inlineProgramName.trim() }, newProgramId) : latest;
        return applyDemoCourseSave(withProgram, write);
      }, organizationId, write.programId);
      else {
        const result = await request<{ summary: CourseSummary }>('/api/sms/summaries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(write) });
        setWorkspace(current => ({ ...current, summaries: [result.summary, ...current.summaries.filter(item => item.id !== result.summary.id)] }));
        // Reload the uncapped estimate; never sum only the visible course slice.
        setSavedEstimate(null);
        await load(write.organizationId, write.programId);
      }
      setProgramId(write.programId); setProgramFilter(''); setSearch('');
      setDraft(null); setDirty(false); restoreEditorFocus(); setFeedback(`${write.revision ? 'Program changes saved' : 'New program saved'}.${demo ? ' Stored in this browser only; live records stay unchanged.' : ' Existing programs remain separate.'}`);
    } catch (err) { setErrorCode(err instanceof CourseSummaryError || err instanceof RequestError ? err.code : undefined); setError(err instanceof Error ? productMessage(err.message) : 'Review the program and save again. Your draft remains here.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function refreshWorkspace() { if (saving.current || !discardAllowed()) return; setDraft(null); setDirty(false); setNameEditor(null); void load(organizationId, programId); }
  async function resetDemo() {
    if (saving.current || !window.confirm('Reset this browser’s synthetic demo? Live records stay unchanged.')) return;
    saving.current = true; setBusy(true);
    try { installWorkspace(await resetCourseDemo(), '', ''); setDraft(null); setNameEditor(null); setDirty(false); setSearch(''); setProgramFilter(''); setAttendanceId(''); setAddingYard(false); setAddingProgram(false); setInlineProgramName(''); setFeedback('Synthetic programs, phone bindings and check-ins reset together. Live records stay unchanged.'); setError(''); setErrorCode(undefined); }
    catch (err) { setError(err instanceof Error ? productMessage(err.message) : 'Check browser storage before resetting. Your existing demo remains saved.'); }
    finally { saving.current = false; setBusy(false); }
  }

  return <div className="cm-shell">
    <a className="il-skip-link" href="#cm-main">Skip to main content</a>
    <header className="cm-topbar"><a className="cm-brand" href={dashboardHref}><span><Leaf size={19}/></span>ImpactLens<span className="cm-brand-dot">.</span></a><span className="cm-product">PROGRAMS</span><nav aria-label="Program workspace navigation"><a href={dashboardHref}><ArrowLeft size={14}/>Dashboard</a>{!demo && <a href="/sms/admin">Facilitator phones<ArrowRight size={14}/></a>}</nav></header>
    <main className="cm-main" id="cm-main" tabIndex={-1}>
      {demo && <div className="cm-mode-note cm-demo-note"><span><BookOpen size={16}/><b>SYNTHETIC DEMO</b></span><p>Fictional data. Changes stay in this browser. Live records stay unchanged.</p><button onClick={resetDemo} disabled={busy}>Reset demo</button></div>}
      <div className="cm-page-heading"><div><h1>Manage programs<span>.</span></h1></div></div>
      {error && !courseEditorOpen && <div className="cm-alert cm-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
      {dirty && <div className="cm-alert" role="status">You have unsaved changes. Save before leaving or reloading to keep them.</div>}
      {feedback && <div className="cm-alert cm-success" role="status"><CheckCircle2 size={17}/>{feedback}<button onClick={() => setFeedback('')} aria-label="Dismiss confirmation"><X size={16}/></button></div>}
      {!canEdit && !demo ? <section className="cm-access"><div className="cm-access-icon"><LockKeyhole size={29}/></div><h2>{loading ? 'Checking access…' : access?.configured === false ? 'Program setup needed.' : access?.authenticated ? 'Administrator access required.' : 'Sign in to manage programs.'}</h2>{!loading && <p>{access?.configured === false ? 'Ask a TPW administrator to finish setup.' : access?.authenticated ? 'Ask a TPW administrator to grant this account access.' : 'Use your TPW account, or try the demo without signing in.'}</p>}<div className="cm-button-row">{!loading && <><a className="cm-button cm-primary" href="/signin-with-chatgpt?return_to=%2Fcourses" target="_top">Sign in with ChatGPT<ArrowRight size={15}/></a><a className="cm-button" href="/demo/courses">Try the demo</a><button className="cm-text-button" onClick={() => void load(initialOrganizationId)}>Check again</button></>}</div></section> : loading && !workspace.organizations.length ? <div className="cm-empty"><RefreshCw size={24}/><h2>Loading your program workspace…</h2></div> : <div className="cm-workspace">
        <div className="cm-organization-bar">
          <div><Building2 size={19}/><div><span>Organization Name</span><strong>{organization?.name ?? 'Choose an organization to get started'}</strong></div></div>
          <details><summary>Organization & program names</summary><div className="cm-settings">
            <label htmlFor="cm-organization">Organization Name<select id="cm-organization" value={organizationId} disabled={busy || loading} onChange={event => chooseOrganization(event.target.value)}>{!organizationId && <option value="">Choose an organization</option>}{workspace.organizations.map(item => <option key={item.id} value={item.id}>{item.name}{!item.active ? ' (inactive)' : ''}</option>)}</select></label>
            <div className="cm-small-actions"><button onClick={() => editName('organization')} disabled={busy || loading}><Plus size={13}/>Add organization</button>{organization && <button onClick={() => editName('organization', true)} disabled={busy || loading}><Pencil size={12}/>Rename organization</button>}</div>
            {programs.length > 0 && <><label>Program Name<select value={programId} onChange={event => chooseProgram(event.target.value)} disabled={busy || loading}>{programs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="cm-text-button" onClick={() => editName('program', true)} disabled={busy || loading}>Rename selected program name</button></>}
            <p>Reusable names<HelpTip label="Organization and program names" text="Saved organization and program names can be reused across programs."/></p>
          </div></details>
        </div>
        <section className="cm-content" ref={editorRef} aria-label="Programs">
          {nameEditor ? <form className="cm-name-form" onSubmit={saveName}><button className="cm-back" type="button" onClick={closeEditor} disabled={busy}><ArrowLeft size={15}/>Back to programs</button><h2>{nameEditor.id ? 'Rename' : 'Add'} {nameEditor.action === 'program' ? 'program name' : 'organization'}</h2><p>{nameEditor.action === 'program' ? `Saved under ${organization?.name ?? 'this organization'}.` : 'Enter the organization name.'}<HelpTip label="Reusable names" text="Reuse a saved organization or program name for programs at different facilities."/></p><label>{nameEditor.action === 'program' ? 'Program Name' : 'Organization Name'}<input autoFocus required maxLength={100} value={nameEditor.name} onChange={event => { setNameEditor({ ...nameEditor, name: event.target.value }); setDirty(true); }} disabled={busy}/></label>{nameEditor.id && <p className="cm-field-note">Rename only<HelpTip label="What a rename changes" text="This updates the reusable name. Program results and historical SMS records stay unchanged."/></p>}<div className="cm-button-row"><button type="submit" className="cm-button cm-primary" disabled={busy}>{busy ? 'Saving…' : nameEditor.id ? 'Save name' : nameEditor.action === 'program' ? 'Create program name' : 'Create organization'}<Check size={15}/></button><button type="button" className="cm-button" onClick={closeEditor} disabled={busy}>Cancel</button></div></form> : draft ? <form className="cm-editor cm-row-editor" onSubmit={saveCourse}>
            <button className="cm-back" type="button" onClick={closeEditor} disabled={busy}><ArrowLeft size={15}/>Back to program history</button>
            <div className="cm-editor-heading"><div><span className="cm-eyebrow">{organization?.name}</span><h2 ref={editorHeadingRef} tabIndex={-1}>{draft.revision ? 'Edit program' : reused ? 'Add a similar program' : 'Add program'}</h2></div><span className="cm-draft-badge">{dirty ? 'Unsaved changes' : draft.revision ? 'Saved record' : 'New draft'}</span></div>
            <p className="cm-editor-intro">{reused ? 'Participant count and program hours copied. You can change them.' : 'Leave unknown details blank.'}<HelpTip label={reused ? 'What is reused' : 'Saving program details'} text={reused ? 'Organization, program name, facility and yard are reused, along with the saved participant count and whole-program hours. Dates, participants completed and notes are cleared. This separate program starts at Planned; review the defaults before saving.' : 'Choose a saved program name or add one below. You can save the details you know now and update them later.'}/></p>
            <div className="cm-inline-program"><label>Program Name<select value={addingProgram ? '__new__' : draft.programId} disabled={busy} onChange={event => { const adding = event.target.value === '__new__'; setAddingProgram(adding); if (!adding) change('programId', event.target.value); else { setDirty(true); setError(''); setErrorCode(undefined); } }}><option value="" disabled>Choose a saved program name</option>{programs.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="__new__">+ Add a new program name</option></select></label>{addingProgram && <label>New Program Name<input required maxLength={100} disabled={busy} value={inlineProgramName} onChange={event => { setInlineProgramName(event.target.value); setDirty(true); }} placeholder="Type the program’s name"/></label>}</div>
            <fieldset disabled={busy}><legend>Where and when?</legend>
              <div className="cm-field-grid"><div className="cm-field-wide"><label htmlFor="cm-facility">CDCR Facilities</label><div className="cm-input-icon"><Search size={16}/><input id="cm-facility" list="cm-facilities" value={draft.facility} onChange={event => change('facility', event.target.value)} placeholder="Search facilities by name or abbreviation" maxLength={150} autoComplete="off" aria-describedby="cm-facility-hint"/><datalist id="cm-facilities">{CDCR_FACILITIES.map(facility => <option key={facility} value={facility}/>)}</datalist></div><small id="cm-facility-hint">Choose a facility.<HelpTip label="Facility list" text="The 31 facility choices come from the existing TPW spreadsheet. Leave this blank if the facility is not yet known."/></small></div>
                <div className="cm-field-wide"><label htmlFor="cm-yard">Yard</label><div className="cm-yard-select"><select id="cm-yard" value={addingYard ? '__new__' : draft.yard} onChange={event => { const custom = event.target.value === '__new__'; setAddingYard(custom); if (!custom) change('yard', event.target.value); }}><option value="">Awaiting details</option>{shownYards.map(yard => <option key={yard} value={yard}>{yard}</option>)}<option value="__new__">+ Add a yard</option></select><button type="button" className="cm-button" onClick={() => { setAddingYard(true); change('yard', ''); }}><Plus size={14}/>Add</button></div>{addingYard && <label>New yard label<input value={draft.yard} onChange={event => change('yard', event.target.value)} placeholder="e.g. North or A Yard" maxLength={100} autoFocus/></label>}<p className="cm-field-note">Optional<HelpTip label="Saved yard choices" text="Choices come from saved programs in this organization and facility. Add a new yard label here; it is kept when you save the program."/></p></div>
                <CourseStatusDetails key={draft.id || 'new-course'} status={draft.status} disabled={busy} onChange={status => change('status', status)}/>
                <label>Start Date<input aria-invalid={invalidFields.includes('startDate') || undefined} aria-describedby={invalidFields.includes('startDate') ? 'cm-form-error' : undefined} type="date" value={draft.startDate} onChange={event => change('startDate', event.target.value)}/></label><label>End Date<input aria-invalid={invalidFields.includes('endDate') || undefined} aria-describedby={invalidFields.includes('endDate') ? 'cm-form-error' : undefined} type="date" value={draft.endDate} onChange={event => change('endDate', event.target.value)}/></label><span className="cm-field-note cm-field-wide">Dates can be left blank.</span>
              </div>
            </fieldset>
            <fieldset disabled={busy}><legend>Program hours & participation</legend><p className="cm-field-note">Whole-program totals, separate from SMS.<HelpTip label="Program results versus SMS" text="Saved details describe the whole program. SMS check-ins describe individual sessions. Add program details as they become available."/></p><div className="cm-field-grid cm-count-fields"><label className="cm-field-wide">Program Hours (per Participant)<input type="number" inputMode="decimal" min="0" max="1000000" step="any" value={draft.courseHoursPerParticipant} onChange={event => change('courseHoursPerParticipant', event.target.value)} placeholder="Awaiting details" aria-describedby="cm-hours-hint"/><small id="cm-hours-hint">Whole program, per participant.</small></label><label>Number of Participants<input type="number" inputMode="numeric" min="0" max="1000000" step="1" value={draft.participants} onChange={event => change('participants', event.target.value)} placeholder="Awaiting details"/></label><label>Number of Participants Completed<input aria-invalid={invalidFields.includes('completers') || undefined} aria-describedby={invalidFields.includes('completers') ? 'cm-form-error' : undefined} type="number" inputMode="numeric" min="0" max="1000000" step="1" value={draft.completers} onChange={event => change('completers', event.target.value)} placeholder="Awaiting details"/></label></div></fieldset>
            <details className="cm-notes" open={Boolean(draft.notes)}><summary>Notes <span>Optional</span></summary><label><span className="cm-sr-only">Notes</span><textarea value={draft.notes} onChange={event => change('notes', event.target.value)} maxLength={4000} rows={3} disabled={busy} placeholder="An optional note for this program"/></label></details>
            {draft.revision > 0 && (() => { const current = workspace.summaries.find(item => item.id === draft.id); if (!current) return null; const derived = courseDerivedValues(current); return <div className="cm-derived"><span>Calculated from saved record:</span><p>Program year: <b>{derived.programYear ?? 'Awaiting details'}</b><span> · </span>Total participant programming hours: <b>{formatNumber(derived.completedParticipantHours)}</b></p><small>Whole-program completion total.<HelpTip label="How program totals are calculated" text="Program year comes from the start date. Total participant programming hours equals program hours per participant multiplied by participants completed."/></small></div>; })()}
            {error && <div className="cm-alert cm-error cm-form-error" id="cm-form-error" role="alert" tabIndex={-1} ref={formErrorRef}>{error}</div>}
            <div className="cm-save-bar"><p>{demo ? 'Demo only · saved in this browser' : 'Changes apply to this program'}<small>Program records only; SMS unchanged.</small></p><div className="cm-button-row"><button className="cm-button" type="button" disabled={busy} onClick={closeEditor}>Cancel</button><button className="cm-button cm-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save program'}<Check size={16}/></button></div></div>
          </form> : <>
            <div className="cm-content-heading"><div><h2>Saved programs</h2></div>{organization && <button id="cm-add-course" className="cm-button cm-primary" onClick={() => openCourse()} disabled={busy || loading}><Plus size={17}/>Add program</button>}</div>
            {organization ? <>{!loading && serviceEstimate && <CourseEstimate totals={serviceEstimate} scope={`All programs in ${organization.name}`}/>}<div className="cm-history-toolbar"><span>ALL PROGRAMS <b>{allProgramCourses.length}{truncated ? '+' : ''}</b></span><div><label className="cm-sr-only" htmlFor="cm-program-filter">Filter by program name</label><select id="cm-program-filter" className="cm-filter" value={programFilter} onChange={event => setProgramFilter(event.target.value)}><option value="">All program names</option>{programs.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><label className="cm-search"><Search size={15}/><span className="cm-sr-only">Search program history</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a facility or date"/></label><button className="cm-icon-button" onClick={refreshWorkspace} disabled={busy || loading} aria-label="Reload saved programs"><RefreshCw size={16} className={loading ? 'cm-spin' : ''}/></button></div></div>{truncated && <p className="cm-alert">Showing this organization’s 100 most recently updated programs.</p>}
              {courses.length ? <div className="cm-course-grid cm-history-rows">{courses.map(course => <article className="cm-course-card" key={course.id}><div className="cm-course-identity"><div className="cm-card-top"><div className="cm-site-icon"><MapPin size={20}/></div><Status value={course.status}/></div><span className="cm-course-program">{course.programName}</span><h3>{course.facility || 'Choose a facility'}</h3><p className="cm-yard">{course.yard ? `Yard: ${course.yard}` : 'Choose a yard'}</p><div className="cm-card-dates"><span>{formatDate(course.startDate)}</span><ArrowRight size={13}/><span>{formatDate(course.endDate)}</span></div><p className="cm-card-identity">Program {course.id.slice(-8)}</p></div><dl className="cm-card-values"><div><dt>Program hours / participant</dt><dd>{formatNumber(course.courseHoursPerParticipant)}</dd></div><div><dt>Participants</dt><dd>{formatNumber(course.participants)}</dd></div><div><dt>Completed</dt><dd>{formatNumber(course.completers)}</dd></div></dl><div className="cm-course-controls"><button className="cm-view-attendance" data-course-attendance={course.id} onClick={() => { setAttendanceId(course.id); window.requestAnimationFrame(() => { attendanceRef.current?.focus({ preventScroll: true }); attendanceRef.current?.scrollIntoView({ block: 'start', behavior: userScrollBehavior() }); }); }} aria-expanded={attendanceId === course.id} aria-controls="cm-course-attendance"><Activity size={15}/>View attendance line</button><div className="cm-card-actions"><button data-course-edit={course.id} onClick={() => openCourse(course)} disabled={busy || loading}><Pencil size={15}/>Edit program</button><button data-course-copy={course.id} onClick={() => openCourse(course, true)} disabled={busy || loading}><Copy size={15}/>Add another like this</button></div></div></article>)}</div> : <div className="cm-empty"><BookOpen size={32}/><h3>{search || programFilter ? 'Try another program search' : 'Your first program starts here.'}</h3><p>{search || programFilter ? 'Try another program, facility or date.' : 'Add the details you know now. You can come back to fill in dates and results.'}</p>{!search && !programFilter && <button className="cm-button cm-primary" onClick={() => openCourse()}><Plus size={16}/>Add program</button>}</div>}</> : <div className="cm-empty"><Building2 size={32}/><p>Start with your organization’s name and save the program details you know.</p><button className="cm-button cm-primary" onClick={() => editName('organization')}><Plus size={16}/>Add organization</button>{demo && !workspace.organizations.length && <button className="cm-text-button" onClick={resetDemo}>Restore synthetic demo</button>}</div>}
            {attendanceCourse && <section className="cm-attendance-panel" id="cm-course-attendance" tabIndex={-1} aria-label="Program attendance" ref={attendanceRef}><button type="button" onClick={() => { const id = attendanceCourse.id; setAttendanceId(''); window.requestAnimationFrame(() => (document.querySelector<HTMLButtonElement>(`[data-course-attendance="${id}"]`) ?? document.querySelector<HTMLButtonElement>('#cm-add-course'))?.focus()); }} aria-label="Close program attendance"><X size={16}/></button>{demo ? <><CourseAttendanceChart data={demoCourseAttendance(workspace, attendanceCourse.id)!} synthetic/><div className="ca-links"><a href={`/sms/demo?courseId=${encodeURIComponent(attendanceCourse.id)}`}>Simulate a check-in for this program<ArrowRight size={14}/></a></div></> : <CourseAttendance key={attendanceCourse.id} courseId={attendanceCourse.id} organizationId={attendanceCourse.organizationId} programId={attendanceCourse.programId}/>}</section>}
            <div className="cm-history-foot"><CheckCircle2 size={15}/><span>Program records and SMS check-ins stay separate.<HelpTip label="Separate sources" text="Maintain whole-program details here. Session check-ins appear in the attendance line."/></span></div>
          </>}
        </section>
      </div>}
    </main>
  </div>;
}
