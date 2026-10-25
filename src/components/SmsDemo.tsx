'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, CheckCircle2, CircleAlert, FlaskConical, MessageSquare, Radio, RotateCcw, Send, ShieldCheck, Smartphone } from 'lucide-react';
import { parseSms } from '@/lib/sms';
import { SmsMetrics, smsNumber, type SmsTotals } from './SmsDashboard';

type DemoOrganization = { id: string; name: string; initials: string };
type DemoProgram = { id: string; organizationId: string; name: string };
type DemoTeacher = { id: string; name: string; phone: string; programId: string };
type DemoRecord = { id: string; teacherId: string; programId: string; organizationId: string; attendees: number; sessionMinutes: number; body: string };
const organizations: DemoOrganization[] = [
  { id: 'demo-arts', name: 'Second Chapter Arts', initials: 'SC' },
  { id: 'demo-pathways', name: 'Open Pathways', initials: 'OP' },
  { id: 'demo-community', name: 'Common Ground', initials: 'CG' },
];
const programs: DemoProgram[] = [
  { id: 'demo-writing', organizationId: 'demo-arts', name: 'Creative Writing' },
  { id: 'demo-visual', organizationId: 'demo-arts', name: 'Visual Arts' },
  { id: 'demo-work', organizationId: 'demo-pathways', name: 'Career Readiness' },
  { id: 'demo-literacy', organizationId: 'demo-pathways', name: 'Digital Literacy' },
  { id: 'demo-wellbeing', organizationId: 'demo-community', name: 'Wellbeing & Connection' },
];
const teachers: DemoTeacher[] = [
  { id: 'demo-maya', name: 'Maya · Creative Writing', phone: '+12025550101', programId: 'demo-writing' },
  { id: 'demo-alex', name: 'Alex · Visual Arts', phone: '+12025550102', programId: 'demo-visual' },
  { id: 'demo-jordan', name: 'Jordan · Career Readiness', phone: '+12025550103', programId: 'demo-work' },
  { id: 'demo-sam', name: 'Sam · Digital Literacy', phone: '+12025550104', programId: 'demo-literacy' },
  { id: 'demo-robin', name: 'Robin · Wellbeing', phone: '+12025550105', programId: 'demo-wellbeing' },
];
const seedRecords: DemoRecord[] = [
  { id: 'seed-1', teacherId: 'demo-maya', programId: 'demo-writing', organizationId: 'demo-arts', attendees: 18, sessionMinutes: 120, body: '18 2' },
  { id: 'seed-2', teacherId: 'demo-alex', programId: 'demo-visual', organizationId: 'demo-arts', attendees: 24, sessionMinutes: 90, body: '24 1.5' },
  { id: 'seed-3', teacherId: 'demo-jordan', programId: 'demo-work', organizationId: 'demo-pathways', attendees: 16, sessionMinutes: 120, body: '16 2' },
  { id: 'seed-4', teacherId: 'demo-sam', programId: 'demo-literacy', organizationId: 'demo-pathways', attendees: 12, sessionMinutes: 60, body: '12 1' },
  { id: 'seed-5', teacherId: 'demo-robin', programId: 'demo-wellbeing', organizationId: 'demo-community', attendees: 22, sessionMinutes: 90, body: '22 1.5' },
  { id: 'seed-6', teacherId: 'demo-maya', programId: 'demo-writing', organizationId: 'demo-arts', attendees: 20, sessionMinutes: 120, body: '20 2' },
];
function totals(records: DemoRecord[]): SmsTotals {
  return records.reduce((sum, record) => ({ sessions: sum.sessions + 1, attendees: sum.attendees + record.attendees, sessionMinutes: sum.sessionMinutes + record.sessionMinutes, participantMinutes: sum.participantMinutes + record.attendees * record.sessionMinutes }), { sessions: 0, attendees: 0, sessionMinutes: 0, participantMinutes: 0 });
}

/** Intentionally browser-local: no fetch, live session, persistence, or SMS sending. */
export default function SmsDemo() {
  const [records, setRecords] = useState(seedRecords);
  const [teacherId, setTeacherId] = useState(teachers[0].id);
  const [organizationId, setOrganizationId] = useState(organizations[0].id);
  const [body, setBody] = useState('20 2');
  const [feedback, setFeedback] = useState('');
  const [isError, setIsError] = useState(false);
  const [quarantined, setQuarantined] = useState(0);
  const [lastEvent, setLastEvent] = useState<DemoRecord | null>(null);
  const sequence = useRef(0);
  const teacher = teachers.find(item => item.id === teacherId);
  const program = programs.find(item => item.id === teacher?.programId);
  const organization = organizations.find(item => item.id === organizationId)!;
  const networkTotals = useMemo(() => totals(records), [records]);
  const organizationTotals = useMemo(() => totals(records.filter(record => record.organizationId === organizationId)), [records, organizationId]);
  const organizationPrograms = programs.filter(item => item.organizationId === organizationId);
  const orgRows = organizations.map(item => ({ ...item, totals: totals(records.filter(record => record.organizationId === item.id)) }));
  const maxVisits = Math.max(1, ...orgRows.map(item => item.totals.attendees));
  const parsedPreview = parseSms(body);
  function simulate(event: FormEvent) {
    event.preventDefault();
    const parsed = parseSms(body);
    if (!parsed.ok || !teacher || !program) {
      setQuarantined(count => count + 1); setIsError(true);
      setFeedback(!parsed.ok ? `Quarantined locally: ${parsed.reason} Neither dashboard changed.` : 'Quarantined locally: this phone is not registered. Neither dashboard changed.');
      return;
    }
    sequence.current += 1;
    const record: DemoRecord = { id: `local-${sequence.current}`, teacherId: teacher.id, programId: program.id, organizationId: program.organizationId, body: body.trim(), ...parsed.metrics };
    setRecords(current => [...current, record]); setOrganizationId(program.organizationId); setLastEvent(record); setIsError(false);
    setFeedback(`Check-in accepted locally. Both dashboards gained ${smsNumber(parsed.metrics.attendees)} participant visits and ${smsNumber(parsed.metrics.sessionMinutes / 60)} session hours.`);
  }
  function reset() { setRecords(seedRecords); setQuarantined(0); setLastEvent(null); setFeedback('Synthetic data reset to the starting sample.'); setIsError(false); }
  return <div className="sms-content sms-demo-content">
    <div className="sms-demo-banner"><FlaskConical size={18}/><span><b>Synthetic demo.</b> All names, phone numbers, and totals are fictional. Runs only in this browser. No text is sent and no live record is created.</span></div>
    <div className="sms-heading"><div><span className="sms-kicker">THE TWO-SCREEN MOMENT</span><h1>One text. Two dashboards.</h1><p>Try a teacher’s check-in and watch their organization and the whole TPW network update together.</p></div><button className="sms-button sms-secondary" onClick={reset}><RotateCcw size={15}/> Reset demo</button></div>
    <section className="sms-demo-console"><div className="sms-demo-phone"><span className="sms-phone-symbol"><Smartphone size={26}/></span><div><span className="sms-kicker">PRETEND YOU’RE THE TEACHER</span><h2>Session finished? Send two numbers.</h2><p>All demo teachers text one fictional number: <b>+1 202-555-0199</b></p></div></div><form onSubmit={simulate} className="sms-simulator-form"><label className="sms-field">From<select value={teacherId} onChange={event => { const id = event.target.value; setTeacherId(id); const selectedTeacher = teachers.find(item => item.id === id); const selectedProgram = programs.find(item => item.id === selectedTeacher?.programId); if (selectedProgram) setOrganizationId(selectedProgram.organizationId); }}>{teachers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="unknown">Unregistered demo phone</option></select></label><label className="sms-field">SMS message<input value={body} onChange={event => setBody(event.target.value)} maxLength={1600} placeholder="20 2" required aria-describedby="sms-demo-format"/></label><button type="submit" className="sms-button sms-primary"><Send size={16}/> Simulate check-in</button></form><div className="sms-demo-preview" id="sms-demo-format"><span>{teacher?.phone || '+12025550199'} <ArrowRight size={12}/> {program ? `${organizations.find(item => item.id === program.organizationId)?.name} / ${program.name}` : 'No registered mapping'}</span><span>{parsedPreview.ok ? `${smsNumber(parsedPreview.metrics.attendees)} attendees × ${smsNumber(parsedPreview.metrics.sessionMinutes / 60)} hours` : 'Format: attendees hours, e.g. 20 2 or 12 1.5'}</span></div></section>
    {feedback && <div className={`sms-feedback ${isError ? 'sms-error' : 'sms-success'}`} role="status">{isError ? <CircleAlert size={18}/> : <CheckCircle2 size={18}/>}<span>{feedback}</span></div>}
    <div className="sms-demo-screens">
      <section className="sms-demo-screen"><div className="sms-screen-top"><span><span className="sms-screen-dot"/> SCREEN 01</span><span>SYNTHETIC · TPW NETWORK</span></div><div className="sms-screen-inner"><div className="sms-screen-heading"><div><span className="sms-kicker">ALL ORGANIZATIONS, TOGETHER</span><h2>The whole picture.</h2></div><Radio size={22}/></div><SmsMetrics totals={networkTotals} compact/>
        <div className="sms-screen-section-heading"><h3>Partner organizations</h3><span>Participant visits</span></div><div className="sms-demo-orgs">{orgRows.map((item, index) => <button className={`sms-demo-org${item.id === organizationId ? ' sms-selected' : ''}`} key={item.id} onClick={() => setOrganizationId(item.id)}><span className={`sms-org-avatar sms-avatar-${index}`}>{item.initials}</span><div><b>{item.name}</b><div className="sms-progress-track"><span style={{ width: `${item.totals.attendees / maxVisits * 100}%` }}/></div></div><strong>{smsNumber(item.totals.attendees)}</strong></button>)}</div>
      </div><div className="sms-screen-footer"><ShieldCheck size={13}/> Aggregate participation only · No phone numbers</div></section>
      <section className="sms-demo-screen sms-screen-organization"><div className="sms-screen-top"><span><span className="sms-screen-dot"/> SCREEN 02</span><span>SYNTHETIC · ORGANIZATION</span></div><div className="sms-screen-inner"><div className="sms-screen-heading"><div><span className="sms-kicker">YOUR ORGANIZATION’S PICTURE</span><h2>{organization.name}</h2></div><span className="sms-org-avatar">{organization.initials}</span></div><SmsMetrics totals={organizationTotals} compact/>
        <div className="sms-screen-section-heading"><h3>Programs</h3><span>Participant visits</span></div><div className="sms-demo-programs">{organizationPrograms.map(item => { const metrics = totals(records.filter(record => record.programId === item.id)); return <div key={item.id}><span><b>{item.name}</b><small>{smsNumber(metrics.sessions)} sessions · {smsNumber(metrics.sessionMinutes / 60)} session hours</small></span><strong>{smsNumber(metrics.attendees)}</strong></div>; })}</div>
        <div className="sms-demo-last-event"><MessageSquare size={17}/><div><b>{lastEvent?.organizationId === organizationId ? 'A new check-in just landed.' : 'Connected to the shared picture.'}</b><p>{lastEvent?.organizationId === organizationId ? `${programs.find(item => item.id === lastEvent.programId)?.name} · +${smsNumber(lastEvent.attendees)} visits · +${smsNumber(lastEvent.sessionMinutes / 60)} session h` : 'Pick a teacher above and simulate a text to see this organization update.'}</p></div></div>
      </div><div className="sms-screen-footer"><ShieldCheck size={13}/> Repeat attendance counts as a new visit, not a unique person</div></section>
    </div>
    <div className="sms-demo-flow"><span><span>01</span> A teacher texts <b>20 2</b></span><ArrowRight size={17}/><span><span>02</span> Their phone identifies the program</span><ArrowRight size={17}/><span><span>03</span> Both dashboards update</span></div>
    <section className="sms-report-invite"><div><span className="sms-kicker">THE NEXT CHAPTER</span><h2>Turn recorded activity into a story.</h2><p>Explore weekly trends and a one-page brief with a separate, clearly fictional sample.</p></div><a className="sms-button sms-primary" href="/sms/demo/reports">Try the reporting demo <ArrowUpRight size={15}/></a></section>
    <div className="sms-demo-bottom"><p><b>No model needed.</b> A fixed format, registered phone mappings, and arithmetic. {quarantined > 0 && `${quarantined} local test ${quarantined === 1 ? 'message is' : 'messages are'} quarantined and excluded from totals.`} Quarter-hour durations are accepted, from 0.25 to 24 hours. These are participation measures, not outcome or recidivism claims.</p><a className="sms-button sms-secondary" href="/sms">Open the real SMS workspace <ArrowUpRight size={15}/></a></div>
  </div>;
}
