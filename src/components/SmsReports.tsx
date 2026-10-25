'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, CalendarDays, Check, Copy, Download, FileText, Info, MessageSquare, Printer, RefreshCw } from 'lucide-react';
import { SmsAccess, SmsMetrics, smsNumber, useSmsLive } from '@/components/SmsDashboard';
import { fundingStory, formatReportDate, parseReportSelection, recordedComparison, reportMethod, type ReportSelection, type SmsReport } from '@/lib/sms-report';
import { DEMO_REPORT_TODAY, demoSmsReport } from '@/lib/sms-report-demo';

function queryFor(selection: ReportSelection): string {
  const query = new URLSearchParams({ start: selection.start, end: selection.end, group: selection.group });
  if (selection.organizationId) query.set('organizationId', selection.organizationId);
  if (selection.programId) query.set('programId', selection.programId);
  return query.toString();
}
function sameSelection(a: ReportSelection, b: ReportSelection): boolean { return queryFor(a) === queryFor(b); }
function initialSelection(demo: boolean, organizationId?: string): ReportSelection {
  const end = demo ? DEMO_REPORT_TODAY : new Date().toISOString().slice(0, 10);
  return { start: `${end.slice(0, 7)}-01`, end, group: 'week', organizationId: organizationId || null, programId: null };
}
function preparedAt(value: string): string {
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

type ReportViewProps = {
  report: SmsReport | null; options: SmsReport | null; selection: ReportSelection;
  onSelectionChange: (selection: ReportSelection) => void; onApply: () => void;
  demo: boolean; loading: boolean; refreshing: boolean; stale: boolean; error: string;
  retry: () => void;
};

function ReportView({ report, options, selection, onSelectionChange, onApply, demo, loading, refreshing, stale, error, retry }: ReportViewProps) {
  const [validation, setValidation] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const changed = Boolean(report && !sameSelection(selection, report.selection));
  const canExport = Boolean(report && !loading && !refreshing && !stale && !error && !changed);
  const unavailable = error ? 'Export is paused until the report reconnects successfully.' : changed ? 'Apply your filters before copying, downloading, or printing this brief.' : loading || refreshing ? 'Export is paused while the selected report loads.' : stale ? 'Export is paused because these records may be out of date. Refresh to continue.' : '';
  const programs = (options?.programs ?? []).filter(program => !selection.organizationId || program.organizationId === selection.organizationId);
  const story = report ? fundingStory(report) : null;
  const copyReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyReset.current) clearTimeout(copyReset.current); }, []);

  function change(next: ReportSelection) { setValidation(''); setExportMessage(''); setCopied(false); onSelectionChange(next); }
  function apply(event: FormEvent) {
    event.preventDefault();
    let result: ReturnType<typeof parseReportSelection>;
    try { result = parseReportSelection(new URLSearchParams(queryFor(selection)), demo ? new Date(`${DEMO_REPORT_TODAY}T23:59:59Z`) : new Date()); }
    catch { setValidation('Choose valid start and end dates.'); return; }
    if (!result.ok) { setValidation(result.error); return; }
    setValidation(''); setExportMessage(''); setCopied(false); onApply();
  }
  async function copyBrief() {
    if (!canExport || !story) return;
    try {
      await navigator.clipboard.writeText(story.text); setCopied(true); setExportMessage('Brief copied, including source and definitions.');
      if (copyReset.current) clearTimeout(copyReset.current);
      copyReset.current = setTimeout(() => setCopied(false), 3000);
    } catch { setExportMessage('Copy is unavailable in this browser. Download the text brief instead.'); }
  }
  function downloadBrief() {
    if (!canExport || !story || !report) return;
    const url = URL.createObjectURL(new Blob([story.text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `${demo ? 'SYNTHETIC-DEMO-' : ''}recorded-activity-${report.current.start}-to-${report.current.end}.txt`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMessage('Text brief prepared with its source, reporting window, and definitions.');
  }
  const maxHours = Math.max(1, ...(report?.buckets.map(bucket => bucket.participantMinutes / 60) ?? []));

  return <div className={`sms-report-body${canExport ? ' sms-report-ready' : ''}`}>
    <form className="sms-report-filters sms-no-print" onSubmit={apply}>
      <label className="sms-field">Organization<select value={selection.organizationId ?? ''} onChange={event => {
        const organizationId = event.target.value || null;
        const selectedProgram = options?.programs.find(program => program.id === selection.programId);
        change({ ...selection, organizationId, programId: selectedProgram && (!organizationId || selectedProgram.organizationId === organizationId) ? selectedProgram.id : null });
      }}><option value="">All organizations</option>{selection.organizationId && !options?.organizations.some(org => org.id === selection.organizationId) && <option value={selection.organizationId}>Selected organization</option>}{options?.organizations.map(organization => <option value={organization.id} key={organization.id}>{organization.name}{organization.active ? '' : ' (inactive)'}</option>)}</select></label>
      <label className="sms-field">Program<select value={selection.programId ?? ''} onChange={event => change({ ...selection, programId: event.target.value || null })}><option value="">All programs</option>{programs.map(program => <option value={program.id} key={program.id}>{program.name}{program.active ? '' : ' (inactive)'}</option>)}</select></label>
      <label className="sms-field">From (UTC)<input type="date" value={selection.start} min="2000-01-01" max={demo ? DEMO_REPORT_TODAY : new Date().toISOString().slice(0, 10)} onChange={event => change({ ...selection, start: event.target.value })} required /></label>
      <label className="sms-field">Through (UTC)<input type="date" value={selection.end} min={selection.start || '2000-01-01'} max={demo ? DEMO_REPORT_TODAY : new Date().toISOString().slice(0, 10)} onChange={event => change({ ...selection, end: event.target.value })} required /></label>
      <label className="sms-field">Group by<select value={selection.group} onChange={event => change({ ...selection, group: event.target.value as ReportSelection['group'] })}><option value="week">Week</option><option value="month">Month</option></select></label>
      <button type="submit" className="sms-button sms-primary" disabled={loading || refreshing}>Apply filters</button>
      {(validation || changed) && <p className={`sms-report-filter-note${validation ? ' sms-report-filter-error' : ''}`} role={validation ? 'alert' : 'status'}>{validation || 'Filters changed. The figures below still describe the last applied selection.'}</p>}
    </form>
    <p className="sms-report-print-unavailable">This brief is not ready to print. Return to the report, apply your filters, and wait for a successful refresh.</p>
    {error && <div className="sms-alert sms-no-print" role="alert">{error} {report ? 'The last loaded report is shown for reference only; export is paused.' : 'No report is available yet.'} <button className="sms-text-button" type="button" onClick={retry}>Try again <RefreshCw size={13}/></button></div>}
    {!report ? <div className="sms-empty sms-report-loading sms-no-print" role="status"><RefreshCw size={25} className={loading || refreshing ? 'sms-spin' : ''}/><h3>{loading || refreshing ? 'Gathering the selected check-ins…' : 'Let’s try that report again.'}</h3><p>{loading || refreshing ? 'The brief will be ready after this exact selection has loaded.' : 'Your filters are still here. Refresh to load the selected records.'}</p></div> : <>
      <div className={`sms-report-selection sms-no-print${stale ? ' sms-report-selection-stale' : ''}`} aria-live="polite"><div><span className="sms-kicker">{demo ? 'SYNTHETIC SAMPLE · FIXED RECORDS' : report.source === 'mixed-activity' ? 'RECORDED CENTER ACTIVITY' : 'ACCEPTED SMS CHECK-INS'}</span><h2>{report.subject}</h2><p>{formatReportDate(report.current.start)} – {formatReportDate(report.current.end)} · UTC recorded dates</p></div><div className="sms-report-refresh"><span>{demo ? 'No live records or saved changes' : stale ? 'Last loaded report · refresh needed' : refreshing ? 'Checking for new records…' : 'Checks every 5 seconds while visible'}</span>{!demo && <button className="sms-icon-button" type="button" onClick={retry} disabled={refreshing} aria-label="Refresh selected report"><RefreshCw size={17} className={refreshing ? 'sms-spin' : ''}/></button>}</div></div>
      {!report.current.sessions && <section className="sms-report-first sms-no-print"><MessageSquare size={24}/><div><h3>A story can start with one check-in.</h3><p>No accepted check-ins were recorded in this selection. That does not mean no service was delivered. Try another period{demo ? ', or explore a different demo program.' : ', or invite a registered teacher to text the first session report.'}</p></div>{!demo && <a className="sms-button sms-secondary" href="/sms/admin">Set up check-ins <ArrowUpRight size={14}/></a>}</section>}
      <div className="sms-no-print"><SmsMetrics totals={report.current}/></div>
      <div className="sms-report-context sms-no-print"><div><CalendarDays size={18}/><span><b>{smsNumber(report.current.activeWeeks)} active reporting {report.current.activeWeeks === 1 ? 'week' : 'weeks'}</b><small>Calendar weeks with at least one check-in</small></span></div><div><Activity size={18}/><span><b>{report.current.averageAttendance === null ? 'Not available' : smsNumber(report.current.averageAttendance)}{report.current.averageAttendance === null ? '' : ' attendees / session'}</b><small>Average across reported sessions</small></span></div><div><Info size={18}/><span><b>Completeness unknown</b><small>{report.current.activeDays} of {report.current.days} receipt dates have check-ins</small></span></div></div>
      <div className="sms-report-grid">
        <div className="sms-report-detail sms-no-print">
          <section className="sms-panel sms-report-periods"><div className="sms-panel-heading"><div><span className="sms-kicker">THE RECORDED RHYTHM</span><h2>{report.selection.group === 'week' ? 'Weekly' : 'Monthly'} activity</h2><p>Participant-hours, from attendance × session duration.</p></div><CalendarDays size={20}/></div>
            <ol className="sms-report-bars">{report.buckets.map(bucket => <li key={bucket.start}><div className="sms-report-bar-label"><span><b>{bucket.label}</b>{bucket.partial && <small>Partial period</small>}</span><span>{bucket.sessions ? <><b>{smsNumber(bucket.participantMinutes / 60)}</b> h</> : <em>No check-ins</em>}</span></div><div className="sms-report-bar-track" aria-hidden="true"><span style={{ width: `${bucket.participantMinutes ? Math.max(1, bucket.participantMinutes / 60 / maxHours * 100) : 0}%` }}/></div><p>{formatReportDate(bucket.start)} – {formatReportDate(bucket.end)}{bucket.sessions > 0 && <> · {smsNumber(bucket.sessions)} {bucket.sessions === 1 ? 'session' : 'sessions'} · {smsNumber(bucket.attendees)} visits</>}</p></li>)}</ol>
            <div className="sms-panel-foot"><Info size={14}/> No check-ins means no records, not no service. Partial periods include only the selected dates.</div>
          </section>
          <section className="sms-report-comparison"><span className="sms-kicker">A FAIRER LOOK BACK</span><h3>Compared with the previous {report.previous.days} days</h3><p>{recordedComparison(report)}</p><small>Prior window: {formatReportDate(report.previous.start)} – {formatReportDate(report.previous.end)}. Differences may reflect reporting changes, not changes in service.</small></section>
          {report.programActivity.length > 0 && <section className="sms-panel sms-report-programs"><div className="sms-panel-heading"><div><span className="sms-kicker">WHERE THE CHECK-INS CAME FROM</span><h2>Programs in this brief</h2></div></div><ul>{report.programActivity.map(program => <li key={program.id}><div><b>{program.name}</b><small>{program.organizationName} · {smsNumber(program.sessions)} {program.sessions === 1 ? 'session' : 'sessions'}</small></div><strong>{smsNumber(program.participantMinutes / 60)}<small>participant-hours</small></strong></li>)}</ul></section>}
        </div>
        <section className="sms-report-story-shell">
          <div className="sms-report-story-intro sms-no-print"><span className="sms-kicker">READY FOR THE CONVERSATION</span><h2>Your one-page activity brief</h2><p>Useful evidence of reported learning time. Easy to share, with the context intact.</p></div>
          <article className="sms-report-print" aria-label="Recorded activity brief">
            <div className={`sms-report-provenance${demo ? ' sms-report-provenance-demo' : ''}`}><FileText size={15}/>{demo ? 'SYNTHETIC DEMO · NOT REAL ORGANIZATIONAL ACTIVITY' : report.source === 'mixed-activity' ? 'RECORDED CENTER ACTIVITY · AGGREGATE ACTIVITY' : 'ACCEPTED SMS CHECK-INS · AGGREGATE ACTIVITY'}</div>
            <span className="sms-report-wordmark">ImpactLens<span>.</span></span>
            <h2>{story!.title}</h2><p className="sms-report-story-dates">{formatReportDate(report.current.start)} – {formatReportDate(report.current.end)} · UTC recorded dates</p>
            <div className="sms-report-story-copy">{story!.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
            <div className="sms-report-story-method"><b>Source, coverage & definitions</b><p>Reporting coverage: {report.current.activeDays} of {report.current.days} dates have check-ins; completeness is unknown.</p><p>{reportMethod(report.source)}</p><p>Prepared from records available at {preparedAt(report.generatedAt)}.</p></div>
          </article>
          <div className="sms-report-export sms-no-print"><div className="sms-actions"><button type="button" className="sms-button sms-primary" onClick={() => void copyBrief()} disabled={!canExport}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copied' : 'Copy brief'}</button><button type="button" className="sms-button sms-secondary" onClick={downloadBrief} disabled={!canExport}><Download size={15}/> Download .txt</button><button type="button" className="sms-icon-button" onClick={() => { if (canExport) window.print(); }} disabled={!canExport} aria-label="Print activity brief"><Printer size={17}/></button></div><p role="status">{unavailable || exportMessage || 'Only this exact loaded selection is included. Source and definitions travel with every export.'}</p></div>
        </section>
      </div>
      <details className="sms-report-methodology sms-no-print"><summary><Info size={16}/> What these figures mean</summary><div><p>{reportMethod(report.source)}</p><p>The previous window has the same number of days and ends immediately before the selected window. Weeks run Monday–Sunday; months follow the calendar, all in UTC. The first and last bins may be partial.</p><p>For this organization and program selection, the first recorded receipt is {report.coverage.firstRecordedDate ? formatReportDate(report.coverage.firstRecordedDate) : 'not available'} and the latest is {report.coverage.lastRecordedDate ? formatReportDate(report.coverage.lastRecordedDate) : 'not available'}. This span does not establish when service began or whether all sessions were reported.</p><p>Prepared {preparedAt(report.generatedAt)}. {demo ? 'All records here are deterministic synthetic examples.' : report.source === 'mixed-activity' ? 'Includes generated center activity and accepted SMS check-ins. Course summaries remain separate.' : 'Only accepted SMS check-ins are included. Course summaries remain separate.'}</p></div></details>
    </>}
  </div>;
}

function LiveRecordedActivity({ organizationId }: { organizationId?: string }) {
  const [selection, setSelection] = useState(() => initialSelection(false, organizationId));
  const [applied, setApplied] = useState(selection);
  const [lastReport, setLastReport] = useState<SmsReport | null>(null);
  const live = useSmsLive<SmsReport>(`/api/sms/report?${queryFor(applied)}`, 5000);
  useEffect(() => { if (live.data) setLastReport(live.data); }, [live.data]);
  const current = live.data && sameSelection(live.data.selection, applied) ? live.data : null;
  const hasAccess = live.session?.authenticated && live.session?.authorized && live.session?.configured;
  if (!hasAccess && (!lastReport || !live.loading)) return <SmsAccess session={live.session} loading={live.loading} error={live.error} retry={live.refresh}/>;
  return <ReportView report={current} options={current ?? lastReport} selection={selection} onSelectionChange={setSelection} onApply={() => { if (sameSelection(applied, selection)) live.refresh(); else setApplied({ ...selection }); }} demo={false} loading={live.loading || Boolean(live.data && !current)} refreshing={live.refreshing} stale={live.stale} error={live.error} retry={live.refresh}/>;
}
function DemoRecordedActivity() {
  const [selection, setSelection] = useState(() => initialSelection(true));
  const [applied, setApplied] = useState(selection);
  const report = demoSmsReport(applied);
  return <ReportView report={report} options={report} selection={selection} onSelectionChange={setSelection} onApply={() => setApplied({ ...selection })} demo loading={false} refreshing={false} stale={false} error="" retry={() => {}}/>;
}

export default function SmsReports({ demo = false, organizationId }: { demo?: boolean; organizationId?: string }) {
  const [tab, setTab] = useState<'activity' | 'summaries'>('activity');
  const [summariesVisited, setSummariesVisited] = useState(false);
  function selectTab(next: 'activity' | 'summaries') { if (next === 'summaries') setSummariesVisited(true); setTab(next); }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    if (demo || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'activity' : event.key === 'End' ? 'summaries' : tab === 'activity' ? 'summaries' : 'activity'; selectTab(next);
    document.getElementById(`sms-${next}-tab`)?.focus();
  }
  return <div className="sms-content sms-reports">
    <div className="sms-no-print"><a href={demo ? '/sms/demo' : organizationId ? `/sms/org/${encodeURIComponent(organizationId)}` : '/sms'} className="sms-back"><ArrowLeft size={15}/>{demo ? 'Back to the SMS demo' : 'Back to live check-ins'}</a>
      {demo && <div className="sms-demo-banner"><Info size={16}/><span><b>SYNTHETIC DEMO.</b> Fixed sample records through October 24, 2026. No live records are loaded, no SMS is sent, and nothing is saved.</span></div>}
      <div className="sms-heading sms-report-heading"><div><span className="sms-kicker">{demo ? 'DEMO · REPORTS & STORIES' : 'TPW · REPORTS & STORIES'}</span><h1>Good work, made visible.</h1><p>Turn the check-ins you already collect into a clear account of reported activity. No extra form for teachers.</p></div><span className="sms-report-heading-icon"><FileText size={31}/></span></div>
      <div className="sms-report-tabs" role="tablist" aria-label="Report type"><button id="sms-activity-tab" role="tab" type="button" aria-selected={tab === 'activity'} aria-controls="sms-activity-panel" tabIndex={tab === 'activity' ? 0 : -1} onKeyDown={navigateTabs} onClick={() => selectTab('activity')}><Activity size={16}/> Recorded activity</button><button id="sms-summaries-tab" role="tab" type="button" aria-selected={tab === 'summaries'} aria-controls="sms-summaries-panel" tabIndex={tab === 'summaries' ? 0 : -1} onKeyDown={navigateTabs} disabled={demo} onClick={() => selectTab('summaries')}><FileText size={16}/> Course summaries{demo && <small>Live workspace</small>}</button></div>
    </div>
    <div id="sms-activity-panel" role="tabpanel" aria-labelledby="sms-activity-tab" hidden={tab !== 'activity'}>{demo ? <DemoRecordedActivity/> : <LiveRecordedActivity organizationId={organizationId}/>}</div>
    {!demo && summariesVisited && <div id="sms-summaries-panel" className="sms-no-print" role="tabpanel" aria-labelledby="sms-summaries-tab" hidden={tab !== 'summaries'}><section className="sms-panel" style={{ padding: 28 }}><h2>Course information has its own workspace.</h2><p style={{ margin: '14px 0 20px', lineHeight: 1.8 }}>Edit existing courses or use one for another run, without going through reports or SMS setup.</p><a className="sms-button sms-primary" href={`/courses${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`}>Open My courses</a></section></div>}
    {tab === 'summaries' && <p className="sms-report-print-unavailable">Open Recorded activity to prepare and print a sourced activity brief. Course summaries are kept separate.</p>}
  </div>;
}
