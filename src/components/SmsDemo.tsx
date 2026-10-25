'use client';

import RacMetrics from './RacMetrics';

import HelpTip from './HelpTip';
import { productMessage } from '@/lib/product-copy';
import { userScrollBehavior } from '@/lib/accessibility';
import OrganizationOverview from './OrganizationOverview';
import OrganizationMetrics from './OrganizationMetrics';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Link2, RotateCcw, Send } from 'lucide-react';
import { parseSmsCommand } from '@/lib/sms';
import { COURSE_DEMO_STORAGE_KEY, type CourseWorkspace } from '@/lib/course-maintenance';
import { COURSE_DEMO_CHANGED_EVENT, COURSE_DEMO_PHONES, bindDemoPhone, courseDemoLabel, demoCourseAttendance, demoParticipantEstimate, demoSmsTotals, initialCourseDemoSelection, latestDemoRepeatBaseline, readCourseDemo, resetCourseDemo, simulateCourseSms, updateCourseDemo } from '@/lib/course-sms-demo';
import { smsNumber } from './SmsDashboard';

/** Shared browser-local rehearsal only. No live requests, real contacts, or SMS delivery. */
export default function SmsDemo() {
  const [workspace, setWorkspace] = useState<CourseWorkspace | null>(null);
  const [courseId, setCourseId] = useState('');
  const [phoneId, setPhoneId] = useState<string>(COURSE_DEMO_PHONES[0].id);
  const [bindingCourseId, setBindingCourseId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [body, setBody] = useState('20 2');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [feedbackPlace, setFeedbackPlace] = useState<'page' | 'binding' | 'sms'>('page');
  const feedbackRef = useRef<HTMLDivElement>(null);
  const feedbackRequested = useRef(false);
  const [feedbackAttempt, setFeedbackAttempt] = useState(0);
  useEffect(() => {
    if ((!error && !feedback) || !feedbackRequested.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (!feedbackRequested.current) return;
      feedbackRequested.current = false;
      if (error) feedbackRef.current?.focus({ preventScroll: true });
      feedbackRef.current?.scrollIntoView({ block: 'nearest', behavior: userScrollBehavior() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, feedback, feedbackAttempt]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const busyRef = useRef(false);
  const requestedCourse = useRef('');
  const install = useCallback((next: CourseWorkspace) => {
    const fallback = next.summaries.find(item => item.id === requestedCourse.current) ?? next.summaries.find(item => item.status === 'in-progress') ?? next.summaries[0];
    setWorkspace(next);
    setCourseId(current => next.summaries.some(item => item.id === current) ? current : fallback?.id ?? '');
    setBindingCourseId(current => next.summaries.some(item => item.id === current) ? current : '');
    setOrganizationId(current => next.organizations.some(item => item.id === current) ? current : fallback?.organizationId ?? next.organizations[0]?.id ?? '');
  }, []);
  useEffect(() => {
    let alive = true;
    requestedCourse.current = new URLSearchParams(window.location.search).get('courseId') ?? '';
    const reload = () => { try { install(readCourseDemo(window.localStorage)); } catch (err) { setError(err instanceof Error ? productMessage(err.message) : 'Browser storage is unavailable.'); } };
    async function initialize() {
      try {
        const next = window.localStorage.getItem(COURSE_DEMO_STORAGE_KEY) ? readCourseDemo(window.localStorage) : await updateCourseDemo(latest => latest);
        if (alive) {
          install(next);
          const initial = initialCourseDemoSelection(next, COURSE_DEMO_PHONES[0].id, requestedCourse.current);
          setCourseId(initial.courseId); setBindingCourseId(initial.bindingCourseId); const requestedOrg = new URLSearchParams(window.location.search).get('organizationId'); setOrganizationId(next.organizations.some(item => item.id === requestedOrg) ? requestedOrg! : initial.organizationId);
        }
      } catch (err) { if (alive) setError(err instanceof Error ? productMessage(err.message) : 'Browser storage is unavailable.'); }
      finally { if (alive) setLoading(false); }
    }
    const changed = (event: StorageEvent) => {
      if (event.key !== COURSE_DEMO_STORAGE_KEY && event.key !== null) return;
      reload(); setFeedbackPlace('page'); setFeedback('The shared synthetic workspace was updated in another tab.');
    };
    void initialize();
    window.addEventListener('storage', changed); window.addEventListener(COURSE_DEMO_CHANGED_EVENT, reload);
    return () => { alive = false; window.removeEventListener('storage', changed); window.removeEventListener(COURSE_DEMO_CHANGED_EVENT, reload); };
  }, [install]);
  async function mutate(work: (latest: CourseWorkspace) => CourseWorkspace, after: (next: CourseWorkspace) => void, reset = false) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setFeedback(''); setError('');
    try { const next = reset ? await resetCourseDemo() : await updateCourseDemo(work); install(next); after(next); }
    catch (err) { setError(err instanceof Error ? productMessage(err.message) : 'Check browser storage and save again. Existing work stays unchanged.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function saveBinding(event: FormEvent) {
    event.preventDefault(); setFeedbackPlace('binding'); feedbackRequested.current = true; setFeedbackAttempt(value => value + 1);
    void mutate(latest => bindDemoPhone(latest, phoneId, bindingCourseId || null), next => {
      const course = next.summaries.find(item => item.id === bindingCourseId);
      if (course) { setCourseId(course.id); setOrganizationId(course.organizationId); }
      setFeedback(course ? 'Demo phone saved to this program.' : 'Choose a program before the next demo check-in.');
    });
  }
  function simulate(event: FormEvent) {
    event.preventDefault(); if (busyRef.current) return;
    setFeedbackPlace('sms'); feedbackRequested.current = true; setFeedbackAttempt(value => value + 1);
    const id = crypto.randomUUID();
    const result = { reason: null as string | null };
    void mutate(latest => { const outcome = simulateCourseSms(latest, phoneId, body, id); result.reason = outcome.reason; return outcome.workspace; }, next => {
      const record = next.sms?.records.find(item => item.id === id);
      if (!record) { setError(`Review this demo message: ${productMessage(result.reason || 'Save a program for this phone first.')} Program, organization and TPW totals stay unchanged.`); return; }
      setCourseId(record.courseId); setOrganizationId(record.courseSnapshot.organizationId);
      setFeedback(`Demo check-in saved: ${smsNumber(record.attendees)} attendees, ${smsNumber(record.sessionMinutes / 60)} session hours. The program line and totals are updated.`);
    });
  }
  function reset() {
    if (busyRef.current || !window.confirm('Reset the shared synthetic workspace? This removes demo program edits, fictional phone bindings and simulated check-ins in every open demo tab. Live records are untouched.')) return;
    setFeedbackPlace('page'); feedbackRequested.current = true; setFeedbackAttempt(value => value + 1);
    void mutate(latest => latest, next => {
      const first = next.summaries.find(item => item.status === 'in-progress') ?? next.summaries[0];
      setCourseId(first?.id ?? ''); setBindingCourseId(first?.id ?? ''); setOrganizationId(first?.organizationId ?? ''); setPhoneId(COURSE_DEMO_PHONES[0].id); setBody('20 2');
      setFeedback('Shared synthetic programs, phone bindings and check-ins reset. Live records stay unchanged.');
    }, true);
  }
  useEffect(() => { if (!organizationId) return; const url = new URL(window.location.href); url.searchParams.set('organizationId', organizationId); window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`); window.dispatchEvent(new Event('impactlens:demo-organization')); }, [organizationId]);
  const records = workspace?.sms?.records ?? [];
  const binding = workspace?.sms?.bindings.find(item => item.phoneId === phoneId);
  const boundCourse = workspace?.summaries.find(item => item.id === binding?.courseId);
  const phone = COURSE_DEMO_PHONES.find(item => item.id === phoneId);
  const selectedOrganization = workspace?.organizations.find(item => item.id === organizationId);
  const parsed = parseSmsCommand(body);
  const repeatBaseline = workspace ? latestDemoRepeatBaseline(workspace, phoneId) : null;
  const organizationTotals = demoSmsTotals(records.filter(item => item.courseSnapshot.organizationId === organizationId));
  const attendance = workspace ? workspace.summaries.filter(course => course.organizationId === organizationId).map(course => demoCourseAttendance(workspace, course.id)!) : [];
  const feedbackMessage = (error || feedback) && <div className={`sms-feedback ${error ? 'sms-error' : 'sms-success'}`} role={error ? 'alert' : 'status'} tabIndex={-1} ref={feedbackRef}>{error ? <CircleAlert size={18}/> : <CheckCircle2 size={18}/>}<span>{error || feedback}</span></div>;
  return <div className="sms-content sms-demo-content org-content">
    <div className="org-demo-badge">Synthetic demo<HelpTip label="Synthetic demo" text="Fictional data and phone choices, saved only in this browser. Live records stay unchanged."/></div>
    {(feedbackPlace === 'page' || !workspace) && feedbackMessage}
    {loading ? <section className="sms-panel sms-demo-loading">Loading demo…</section> : !workspace ? <section className="sms-panel sms-demo-loading"><h1>Reopen your saved demo.</h1><p>Check browser storage or reset the demo.</p><button type="button" className="sms-button sms-secondary" onClick={reset} disabled={busy}>Reset demo</button></section> : <>
      <div className="org-heading"><h1>{selectedOrganization?.name || 'Organization dashboard'}</h1><label className="sms-field">Organization<select value={organizationId} onChange={event => setOrganizationId(event.target.value)}>{workspace.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      <OrganizationMetrics totals={organizationTotals} participantEstimate={demoParticipantEstimate(workspace, organizationId)}/>
      <RacMetrics participantMinutes={organizationTotals.participantMinutes}/>
      <OrganizationOverview organizationId={organizationId} attendance={attendance} synthetic/>
      <details className="org-demo-tools"><summary>Try a check-in</summary>
      <section className="sms-demo-console">
        <div className="sms-demo-phone"><div><h2>Try a check-in</h2><p><b>20 2</b> = 20 attendees, 2 session hours. <b>1</b> = repeat this phone’s last counted values for this program as a new session.<HelpTip label="Repeating a check-in" text="Send two numbers first. Each new text containing only 1 adds another session with this phone’s latest counted attendance and hours for its current program. If attendance or hours changed, send two numbers instead. Start with two numbers to establish the first check-in."/></p></div></div>
        <div className="sms-rehearsal-binding"><div><Link2 size={17}/><h3>Choose a program for this phone.</h3></div><p>Save the phone’s program before trying a text.<HelpTip label="Phone-to-program binding" text="This setup connects future check-ins from the fictional phone to one saved program. Earlier check-ins keep their original program."/></p>
          <form onSubmit={saveBinding} className="sms-binding-form"><label className="sms-field">Fictional sender<select value={phoneId} onChange={event => { const id = event.target.value; setPhoneId(id); setBindingCourseId(workspace.sms?.bindings.find(item => item.phoneId === id)?.courseId ?? courseId); }} disabled={busy}>{COURSE_DEMO_PHONES.map(item => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}<option value="unknown">Unregistered fictional phone</option></select></label><label className="sms-field">Program for this phone<select value={bindingCourseId} onChange={event => setBindingCourseId(event.target.value)} disabled={busy || !phone}><option value="">Choose a program</option>{workspace.summaries.map(course => <option key={course.id} value={course.id}>{course.organizationName} / {courseDemoLabel(course)}</option>)}</select></label><button className="sms-button sms-secondary" type="submit" disabled={busy || !phone}>{busy ? 'Saving…' : 'Save phone’s program'}<CheckCircle2 size={15}/></button></form>
          <p className="sms-binding-status"><b>Saved program:</b> {boundCourse ? courseDemoLabel(boundCourse) : 'Choose and save a program for this phone to begin.'}{phone && (binding?.courseId ?? '') !== bindingCourseId && <strong> Save the selection above to use it.</strong>}</p>
          {feedbackPlace === 'binding' && feedbackMessage}
        </div>
        <form onSubmit={simulate} className="sms-simulator-form sms-course-simulator"><label className="sms-field">SMS message<input value={body} onChange={event => setBody(event.target.value)} maxLength={1600} placeholder="20 2" required disabled={busy} aria-describedby="sms-demo-format"/></label><div className="sms-demo-examples"><span>Try another session</span>{['18 1.5', '24 2', '0 0.25', '1'].map(example => <button type="button" key={example} onClick={() => setBody(example)} disabled={busy}>{example}</button>)}</div><button type="submit" className="sms-button sms-primary" disabled={busy}><Send size={16}/>{busy ? 'Saving…' : 'Simulate check-in'}</button></form>
        <div className="sms-demo-preview" id="sms-demo-format"><span>{phone?.phone || 'Unregistered fictional phone'} <ArrowRight size={12}/>{boundCourse ? boundCourse.programName : 'Choose a program'}</span><span>{parsed.ok ? parsed.kind === 'numeric' ? `${smsNumber(parsed.metrics.attendees)} attendees × ${smsNumber(parsed.metrics.sessionMinutes / 60)} session hours` : repeatBaseline ? `New session: repeat ${smsNumber(repeatBaseline.attendees)} attendees × ${smsNumber(repeatBaseline.sessionMinutes / 60)} session hours` : 'Send two numbers first for this phone and program.' : 'Format: attendees hours, e.g. 20 2; or 1 to repeat.'}</span></div>
        {feedbackPlace === 'sms' && feedbackMessage}
      </section>
        <div className="org-demo-actions"><button type="button" className="sms-button sms-secondary" onClick={reset} disabled={busy}><RotateCcw size={15}/>Reset demo</button></div>
      </details>
    </>}
  </div>;
}
