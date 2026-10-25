'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CheckCircle2, Cloud, Database, FileText, FolderOpen, Loader2, LockKeyhole, RefreshCw, Save, Server, ShieldCheck, X } from 'lucide-react';
import type { AggregateRow, CohortSummary } from '@/lib/types';
import { aggregateRowsToCsv, validateAggregateRows } from '@/lib/csv';

export type CloudSession = {
  authenticated: boolean;
  user: { id: string; displayName: string } | null;
  signInUrl: string;
  signOutUrl: string;
  storageAvailable: boolean;
};
export type SavedProject = { id: string; name: string; rowCount: number; createdAt: string; updatedAt: string };
type SavedReport = { id: string; projectId: string; createdAt: string; rowCount: number; jsonUrl: string; csvUrl: string; mdUrl?: string };
type ServerAnalysis = { rowCount: number; summaries: CohortSummary[]; warnings: string[]; computedAt: string; engine: string };
type Props = {
  expanded: boolean;
  rows: AggregateRow[];
  datasetLabel: string;
  savedProjectId?: string;
  onShowProjects: () => void;
  onOpenProject: (project: SavedProject, rows: AggregateRow[]) => void;
  onSession: (session: CloudSession | null) => void;
};

class ApiError extends Error { constructor(message: string, public status?: number) { super(message); } }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (!isJson) throw new ApiError('The cloud service is unavailable here. Browser-local analysis still works.');
  const payload = await response.json();
  if (!response.ok) {
    const details = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    throw new ApiError([typeof details.error === 'string' ? details.error : `Request failed (${response.status}).`, ...(Array.isArray(details.details) ? details.details.filter(value => typeof value === 'string') : [])].join(' '), response.status);
  }
  return payload as T;
}
function errorText(error: unknown, fallback: string) { return error instanceof ApiError ? error.message : fallback; }
function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function safeAuthUrl(value: string | undefined, action: 'signin' | 'signout') {
  const expected = `/${action}-with-chatgpt`;
  const safe = value && (value === expected || value.startsWith(`${expected}?`)) ? new URL(value, 'https://app.local') : new URL(expected, 'https://app.local');
  safe.searchParams.set('return_to', '/research');
  return `${safe.pathname}${safe.search}`;
}
export function AccountLink({ session }: { session: CloudSession | null }) {
  return session ? <a className="account-link" target="_top" href={safeAuthUrl(session.authenticated ? session.signOutUrl : session.signInUrl, session.authenticated ? 'signout' : 'signin')}><LockKeyhole size={13}/>{session.authenticated ? 'Sign out' : 'Sign in with ChatGPT'}</a> : null;
}
function DownloadLinks({ report }: { report: SavedReport }) {
  const links: [string, string | undefined][] = [['Brief', report.mdUrl], ['JSON', report.jsonUrl], ['CSV', report.csvUrl]];
  return <div className="report-downloads">{links.filter(([, url]) => typeof url === 'string' && url.startsWith('/api/reports/') && !url.includes('\\')).map(([label, url]) => <a key={label} className="text-button" href={url} download><ArrowDownToLine size={13}/>{label}</a>)}</div>;
}

export default function PersistentWorkspace({ expanded, rows, datasetLabel, savedProjectId, onShowProjects, onOpenProject, onSession }: Props) {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [activeProject, setActiveProject] = useState<SavedProject | null>(null);
  const [analysis, setAnalysis] = useState<ServerAnalysis | null>(null);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveRows, setSaveRows] = useState<AggregateRow[]>([]);
  const [saveLabel, setSaveLabel] = useState('');
  const [projectName, setProjectName] = useState('');
  const [confirmedAggregate, setConfirmedAggregate] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const requestBusy = useRef(false);
  const saveTrigger = useRef<HTMLElement | null>(null);
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  const showError = useCallback((err: unknown, fallback: string) => {
    setError(errorText(err, fallback));
    if (err instanceof ApiError && err.status === 401) {
      const signedOut: CloudSession = { authenticated: false, user: null, signInUrl: '/signin-with-chatgpt?return_to=%2F', signOutUrl: '/signout-with-chatgpt?return_to=%2F', storageAvailable: true };
      setSession(signedOut); onSessionRef.current(signedOut); setSaveOpen(false);
      setProjects([]); setListLoaded(false); setActiveProject(null); setAnalysis(null); setReports([]);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setListLoading(true);
    try { const result = await request<{ projects: SavedProject[] }>('/api/projects'); if (mounted.current) { setProjects(result.projects); setListLoaded(true); } }
    catch (err) { if (mounted.current) showError(err, 'Saved projects could not be loaded. Please check your connection and refresh.'); }
    finally { if (mounted.current) setListLoading(false); }
  }, [showError]);
  const loadSession = useCallback(async () => {
    setSessionLoading(true); setError('');
    try {
      const result = await request<CloudSession>('/api/session');
      if (!mounted.current) return;
      setSession(result); onSessionRef.current(result);
      if (result.authenticated && result.storageAvailable) await loadProjects();
    } catch (err) { if (mounted.current) { setSession(null); onSessionRef.current(null); setError(errorText(err, 'Could not reach the cloud service. Your local analysis is unaffected.')); } }
    finally { if (mounted.current) setSessionLoading(false); }
  }, [loadProjects]);
  useEffect(() => { mounted.current = true; void loadSession(); return () => { mounted.current = false; }; }, [loadSession]);
  useEffect(() => { if (!saveOpen && saveTrigger.current) { saveTrigger.current.focus(); saveTrigger.current = null; } }, [saveOpen]);

  function prepareSave() {
    saveTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaveRows(rows.map(row => ({ ...row }))); setSaveLabel(datasetLabel);
    setProjectName(`${datasetLabel} · ${new Date().toLocaleDateString()}`.slice(0, 100));
    setConfirmedAggregate(false); setSaveOpen(true); setError(''); setMessage('');
  }
  async function saveProject() {
    if (requestBusy.current || !confirmedAggregate || !projectName.trim() || !saveRows.length) return;
    requestBusy.current = true; setBusy('saving'); setError(''); setMessage('');
    try {
      const result = await request<{ project: SavedProject; warnings: string[] }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: projectName.trim(), csv: aggregateRowsToCsv(saveRows) }) });
      setProjects(previous => [result.project, ...previous.filter(project => project.id !== result.project.id)]); setListLoaded(true);
      setActiveProject(result.project); setAnalysis(null); setReports([]); setReportsLoaded(true); setSaveOpen(false);
      setMessage(`Saved “${result.project.name}” to your account. ${result.warnings?.length ? result.warnings.join(' ') : 'The dashboard is unchanged; open the saved snapshot to explore it.'}`);
      onShowProjects();
    } catch (err) { showError(err, 'The save could not be confirmed. Cancel this dialog and refresh saved projects before trying again to avoid a duplicate.'); }
    finally { setBusy(''); requestBusy.current = false; }
  }
  async function openProject(project: SavedProject) {
    if (requestBusy.current) return;
    requestBusy.current = true; setBusy(`opening:${project.id}`); setError(''); setMessage('');
    try {
      const result = await request<{ project: SavedProject; rows: AggregateRow[] }>(`/api/projects/${encodeURIComponent(project.id)}`);
      const validated = validateAggregateRows(result.rows);
      if (validated.errors.length) throw new ApiError('This saved dataset did not pass validation. No rows were opened.');
      setActiveProject(result.project); setAnalysis(null); setReports([]); setReportsLoaded(false);
      onOpenProject(result.project, validated.rows);
      setMessage(`Opened “${result.project.name}”. This is the saved cloud snapshot.`);
      try { const resultReports = await request<{ reports: SavedReport[] }>(`/api/projects/${encodeURIComponent(project.id)}/reports`); setReports(resultReports.reports); setReportsLoaded(true); }
      catch (err) { showError(err, 'The project opened, but its reports could not be loaded. Reopen it to try again.'); }
    } catch (err) { showError(err, 'The saved project could not be opened. Your current dashboard has not changed.'); }
    finally { setBusy(''); requestBusy.current = false; }
  }
  async function runAnalysis() {
    if (!activeProject || requestBusy.current) return;
    requestBusy.current = true; setBusy('analysis'); setError(''); setMessage('');
    try { const result = await request<ServerAnalysis>(`/api/projects/${encodeURIComponent(activeProject.id)}/analysis`); setAnalysis(result); setMessage(`Server analysis completed for ${result.rowCount} saved aggregate rows. No language model was used.`); }
    catch (err) { showError(err, 'Server analysis could not be completed. Please try again.'); }
    finally { setBusy(''); requestBusy.current = false; }
  }
  async function saveReport() {
    if (!activeProject || requestBusy.current) return;
    requestBusy.current = true; setBusy('report'); setError(''); setMessage('');
    try {
      const result = await request<{ report: SavedReport }>(`/api/projects/${encodeURIComponent(activeProject.id)}/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setReports(previous => [result.report, ...previous.filter(report => report.id !== result.report.id)]); setReportsLoaded(true);
      setMessage('Report generated on the server and saved to your account. Download it below.');
    } catch (err) { showError(err, 'The report save could not be confirmed. Reopen the project to check saved reports before trying again.'); }
    finally { setBusy(''); requestBusy.current = false; }
  }
  const canSave = Boolean(session?.authenticated && session.storageAvailable && rows.length && !listLoading && !sessionLoading);
  const isSavedView = Boolean(savedProjectId);

  return <section className={`cloud-workspace ${expanded ? 'expanded' : ''}`} aria-label="Cloud project workspace">
    <div className="cloud-ribbon">
      <span className={`cloud-icon ${isSavedView ? 'saved' : ''}`}>{isSavedView ? <Cloud size={19}/> : <LockKeyhole size={18}/>}</span>
      <div className="cloud-ribbon-copy"><b>{isSavedView ? 'Saved cloud snapshot' : 'Explore locally. Save when you choose.'}</b><p>{sessionLoading ? 'Checking your account…' : session?.authenticated ? `${session.user?.displayName || 'Signed in'} · ${isSavedView ? 'Account-only project storage' : 'No dataset is sent until you save it.'}` : 'No account needed to explore. Sign in to keep projects and reports.'}</p></div>
      <div className="cloud-ribbon-actions">{!expanded && <button className="text-button" onClick={onShowProjects}><FolderOpen size={15}/> Saved projects</button>}{session?.authenticated ? <button className="button secondary" disabled={!canSave || !!busy} onClick={prepareSave}><Save size={15}/> Save dataset</button> : session ? <AccountLink session={session}/> : null}</div>
    </div>
    {(error || message) && <div className={`cloud-feedback ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error ? <CircleNotice/> : <CheckCircle2 size={16}/>}<span>{error || message}</span><button className="icon-button" aria-label="Dismiss cloud message" onClick={() => {setError(''); setMessage('');}}><X size={15}/></button></div>}
    {expanded && <div className="cloud-body">
      {sessionLoading ? <div className="cloud-empty"><Loader2 className="spin" size={24}/><h3>Connecting to your workspace</h3><p>Public data and local CSV analysis remain available.</p></div> : !session ? <div className="cloud-empty"><Server size={27}/><h3>Cloud workspace is unavailable</h3><p>The server could not be reached. Nothing from your dataset has been uploaded.</p><button className="button secondary" onClick={() => void loadSession()}><RefreshCw size={14}/> Retry connection</button></div> : !session.authenticated ? <div className="cloud-welcome"><div><span className="pill neutral">OPTIONAL CLOUD WORKSPACE</span><h2>Your evidence, ready to revisit.</h2><p>Keep aggregate datasets, run reproducible server analysis, and download saved reports. Your public dashboard still works without an account.</p><a className="button primary" target="_top" href={safeAuthUrl(session.signInUrl, 'signin')}><LockKeyhole size={15}/> Sign in with ChatGPT <ArrowRight size={15}/></a><small>Signing in leaves this page. Unsaved CSV data in this tab will not be retained. Sign in before importing data you want to save.</small></div><ul><li><FolderOpen size={19}/><span><b>Private by account</b>Reopen your saved projects after signing in.</span></li><li><Server size={19}/><span><b>Real server computation</b>Descriptive statistics, not simulated agents.</span></li><li><ShieldCheck size={19}/><span><b>Explicit, aggregate-only saves</b>Local files are never uploaded automatically.</span></li></ul></div> : !session.storageAvailable ? <div className="cloud-empty"><Server size={27}/><h3>Signed in, storage not ready</h3><p>The cloud database is not available in this environment. Your local dataset has not been uploaded.</p><button className="button secondary" onClick={() => void loadSession()}><RefreshCw size={14}/> Check again</button></div> : <>
        <div className="projects-section-heading"><div><h2>Saved projects</h2><p>Aggregate snapshots, visible only to your signed-in account. Up to 25 projects.</p></div><button className="text-button" disabled={listLoading || !!busy} onClick={() => {setError(''); void loadProjects();}}><RefreshCw size={14} className={listLoading ? 'spin' : ''}/> Refresh</button></div>
        {listLoading && !listLoaded ? <p className="cloud-loading" role="status">Loading saved projects…</p> : !projects.length ? <div className="projects-empty"><FolderOpen size={25}/><h3>{listLoaded ? 'A place for your next evidence project.' : 'Your projects have not loaded.'}</h3><p>{listLoaded ? 'Choose a dataset above, then select Save dataset. You will review exactly what is stored before saving.' : 'Refresh to try loading your saved projects again.'}</p></div> : <div className="project-list">{projects.map(project => <article key={project.id} className={`project-item ${activeProject?.id === project.id ? 'selected' : ''}`}><span className="project-icon"><Database size={19}/></span><div><h3>{project.name}</h3><p>{project.rowCount.toLocaleString()} aggregate rows · Saved {dateLabel(project.createdAt)}</p></div><button className="button secondary" disabled={!!busy} onClick={() => void openProject(project)}>{busy === `opening:${project.id}` ? <Loader2 size={14} className="spin"/> : <FolderOpen size={14}/>} Open</button></article>)}</div>}
        {activeProject && <div className="saved-project-detail"><div className="projects-section-heading"><div><span className="cloud-kicker">SERVER WORKSPACE</span><h2>{activeProject.name}</h2><p>Runs use all {activeProject.rowCount.toLocaleString()} stored rows, not the dashboard filters. Original inputs are not overwritten.</p></div><span className="pill neutral"><Cloud size={12}/> SAVED</span></div><div className="server-actions"><button className="button primary" disabled={!!busy} onClick={() => void runAnalysis()}>{busy === 'analysis' ? <Loader2 className="spin" size={15}/> : <Server size={15}/>} {busy === 'analysis' ? 'Analyzing…' : 'Run server analysis'}</button><button className="button secondary" disabled={!!busy} onClick={() => void saveReport()}>{busy === 'report' ? <Loader2 className="spin" size={15}/> : <FileText size={15}/>} {busy === 'report' ? 'Saving report…' : 'Generate & save report'}</button><span>Deterministic calculations · No external AI API</span></div>
        {analysis && <div className="server-results"><div className="server-result-heading"><CheckCircle2 size={16}/><b>Computed on the server</b><span>{dateLabel(analysis.computedAt)}</span></div>{analysis.summaries.some(row => row.dataKind === 'synthetic') && <p className="server-synthetic-note">SYNTHETIC DATA: this result includes demonstration values, not real outcomes.</p>}<div className="table-scroll"><table><thead><tr><th>COHORT / GROUP</th><th>PEOPLE</th><th>EVENTS</th><th>RATE</th><th>WILSON 95%</th></tr></thead><tbody>{analysis.summaries.slice(0, 12).map(row => <tr key={row.id}><td><b>{row.group}</b><small>{row.releaseYear} · {row.outcome} · {row.followupMonths} months{row.dataKind === 'synthetic' ? ' · SYNTHETIC' : ''}</small></td><td>{row.denominator.toLocaleString()}</td><td>{row.events.toLocaleString()}</td><td>{row.ratePct.toFixed(1)}%</td><td>{row.ciLowerPct.toFixed(1)}–{row.ciUpperPct.toFixed(1)}%</td></tr>)}</tbody></table></div><p className="server-result-foot">{analysis.rowCount > 12 ? `Showing 12 of ${analysis.rowCount} analyzed rows. Save a report for the complete result. ` : `${analysis.rowCount} rows analyzed. `}Modeled uncertainty only, not a causal effect or population measurement error.</p>{analysis.warnings?.length > 0 && <details className="server-warnings"><summary>Review analysis limitations ({analysis.warnings.length})</summary><ul>{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</div>}
        <div className="saved-reports"><div className="projects-section-heading"><div><h3>Saved reports</h3><p>Each report is recomputed on the server and stored separately. Up to 20 per project.</p></div><FileText size={19}/></div>{reports.length ? reports.map((report, index) => <article className="report-item" key={report.id}><div><b>Evidence report · {dateLabel(report.createdAt)}</b><p>{report.rowCount.toLocaleString()} aggregate rows{index === 0 ? ' · Most recent' : ''}</p></div><DownloadLinks report={report}/></article>) : <p className="reports-empty">{reportsLoaded ? 'No reports saved yet. Generate a report to keep a reproducible result.' : 'Reports have not loaded. Reopen the project to retry.'}</p>}</div></div>}
        <div className="cloud-privacy"><ShieldCheck size={16}/><p>Only save public or authorized aggregate data. Do not include names, IDs, birth dates, or confidential records, including in project names or group labels. Aggregate schema checks are not a guarantee of de-identification.</p></div>
      </>}
    </div>}
    {saveOpen && <div className="save-overlay" role="presentation" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); setSaveOpen(false); }
      if (event.key === 'Tab') {
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'));
        const first = elements[0]; const last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }}><section className="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-project-title"><div className="save-dialog-heading"><span className="cloud-icon saved"><Cloud size={22}/></span><button className="icon-button" disabled={!!busy} onClick={() => setSaveOpen(false)} aria-label="Cancel saving"><X size={19}/></button></div><h2 id="save-project-title">Keep this evidence.</h2><p>Save a new cloud snapshot of <b>{saveLabel}</b>: all <b>{saveRows.length.toLocaleString()} aggregate rows</b> in the active dataset, including rows outside the current filters.</p><label className="project-name-label" htmlFor="project-name">PROJECT NAME<input id="project-name" autoFocus value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={100} disabled={!!busy} placeholder="A name for this evidence project"/></label><div className="save-disclosure"><LockKeyhole size={18}/><p>Saving sends the project name and normalized aggregate CSV to ImpactLens cloud storage, linked to your ChatGPT account. Your original file is not uploaded. Saved snapshots and generated reports persist beyond this browser tab. Official-data copies are stored as user-supplied snapshots, not independently verified official records. Source labels are retained, and synthetic rows stay labeled synthetic.</p></div><label className="aggregate-confirm"><input type="checkbox" checked={confirmedAggregate} onChange={event => setConfirmedAggregate(event.target.checked)} disabled={!!busy}/><span>This is public or authorized aggregate data, with no personal identifiers or confidential individual records in any field.</span></label>{error && <p className="dialog-error" role="alert">{error}</p>}<div className="save-dialog-actions"><button className="button secondary" onClick={() => setSaveOpen(false)} disabled={!!busy}>Cancel</button><button className="button primary" disabled={!confirmedAggregate || !projectName.trim() || !!busy} onClick={() => void saveProject()}>{busy === 'saving' ? <Loader2 className="spin" size={15}/> : <Save size={15}/>} {busy === 'saving' ? 'Saving…' : 'Save aggregate dataset'}</button></div></section></div>}
  </section>;
}
function CircleNotice() { return <span className="error-mark" aria-hidden="true">!</span>; }
