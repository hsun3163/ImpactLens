'use client';

import HelpTip from './HelpTip';

import { useId, useState } from 'react';
import { Activity, ArrowUpRight, LockKeyhole, RefreshCw } from 'lucide-react';
import type { CourseAttendanceData, CourseAttendancePoint } from '@/lib/course-attendance';
import { smsNumber, smsTime, useSmsLive } from './SmsDashboard';
import './CourseAttendance.css';

/** Pure aggregate view shared by the synthetic rehearsal and authorized live reader. */
export function CourseAttendanceChart({ data, synthetic = false, compact = false }: { data: CourseAttendanceData; synthetic?: boolean; compact?: boolean }) {
  const titleId = useId();
  const [selectedId, setSelectedId] = useState('');
  const selected = data.points.find(point => point.id === selectedId) ?? data.points.at(-1);
  const points = data.points;
  const max = Math.max(1, ...points.map(point => point.attendees));
  const ceiling = Math.max(5, Math.ceil(max / 5) * 5);
  const plotRight = compact ? 420 : 840;
  const plotCenter = compact ? 240 : 450;
  const position = (point: CourseAttendancePoint, index: number) => ({ x: points.length < 2 ? plotCenter : 60 + index / (points.length - 1) * (plotRight - 60), y: 206 - point.attendees / ceiling * 170 });
  const path = points.map((point, index) => { const { x, y } = position(point, index); return `${index ? 'L' : 'M'}${x},${y}`; }).join(' ');
  const metrics = [
    ['Program participants', data.participantEstimate?.value ?? null, data.participantEstimate?.source === 'configured-maximum' ? 'Saved participant count for this program while its attendance history grows.' : 'Highest attendance recorded for this program.'],
    ['Sessions reported', data.totals.sessions, 'One accepted check-in each'],
    ['Session hours', data.totals.sessionMinutes / 60, 'Reported teaching time'],
    ['Participant hours', data.totals.participantMinutes / 60, 'Attendance × session duration'],
  ] as const;
  return <section className={`ca-view${compact ? ' ca-compact' : ''}`} aria-labelledby={titleId}>
    <div className="ca-heading"><div>{!compact && <span className="ca-kicker">{synthetic ? 'SYNTHETIC PROGRAM ACTIVITY' : 'PROGRAM ACTIVITY · COUNTED SMS ONLY'}</span>}<h3 id={titleId}>{compact ? data.course.facility || 'Program' : data.course.programName}{compact && data.course.yard ? ` · ${data.course.yard}` : ''}</h3><p>{compact ? `${data.course.startDate || 'Dates awaiting details'}${data.course.endDate ? ` → ${data.course.endDate}` : ''}` : `${data.course.facility || 'Choose a facility'}${data.course.yard ? ` · ${data.course.yard}` : ''}`}</p></div>{!compact && <Activity size={24}/>}</div>
    {!compact && <div className="ca-metrics">{metrics.map(([label, value, note]) => <div key={label}><span>{label}<HelpTip label={label} text={note}/></span><strong>{value === null ? 'Awaiting details' : smsNumber(value)}</strong>{label === 'Program participants' && <small>Program-level estimate</small>}</div>)}</div>}
    <div className="ca-chart-heading"><h4>{compact ? 'Attendance' : 'Attendance at each reported session'}{!compact && <HelpTip label="Reading the program line" text="Each point shows the attendance reported in one accepted SMS, including zero. Points follow message receipt order."/>}</h4>{!compact && <span>Session attendance</span>}</div>
    {points.length ? <>
      <div className={compact ? 'ca-plot-wrap' : undefined}>{compact && <div className="ca-html-y" aria-hidden="true"><span>{smsNumber(ceiling)}</span><span>{smsNumber(ceiling / 2)}</span><span>0</span></div>}<svg className="ca-chart" viewBox={compact ? '0 0 440 260' : '0 0 880 260'} role="img" aria-label={`Attendance line, ${points.length} reported sessions in receipt order. ${points.map(point => `Session ${point.sequence}: ${point.attendees} attendees`).slice(0, 12).join('; ')}${points.length > 12 ? '. Full values in the session list below.' : '.'}`}>
        {[0, 0.5, 1].map(ratio => <g key={ratio}><line x1="60" x2={plotRight} y1={206 - ratio * 170} y2={206 - ratio * 170} className="ca-grid"/>{!compact && <text x="47" y={211 - ratio * 170} textAnchor="end" className="ca-axis">{smsNumber(ceiling * ratio)}</text>}</g>)}
        <path d={path} fill="none" className="ca-line"/>
        {points.map((point, index) => { const { x, y } = position(point, index); return <circle key={point.id} cx={x} cy={y} r={point.id === selected?.id ? 6 : 4} className="ca-point" onClick={() => setSelectedId(point.id)}><title>Session {point.sequence}: {point.attendees} attendees · received {smsTime(point.receivedAt)}</title></circle>; })}
        {!compact && <><text x="60" y="234" className="ca-axis">Session {points[0].sequence}</text><text x="840" y="234" textAnchor="end" className="ca-axis">Session {points.at(-1)!.sequence}</text>
        <text x="450" y="255" textAnchor="middle" className="ca-axis">Message receipt order</text></>}
      </svg></div>{compact && <><div className="ca-html-x" aria-hidden="true"><span>Session {points[0].sequence}</span><span>Session {points.at(-1)!.sequence}</span></div><p className="ca-html-basis">Session order</p></>}
      {selected && <div className="ca-selected"><b>Session {selected.sequence}: {smsNumber(selected.attendees)} attendees</b><span>{smsNumber(selected.sessionMinutes / 60)} session h · recorded {smsTime(selected.receivedAt)}</span></div>}
      <details className="ca-sessions"><summary>View {points.length} reported {points.length === 1 ? 'session' : 'sessions'} and receipt-time details</summary><div className="ca-table-scroll" tabIndex={0} role="region" aria-label="Program session details, scroll horizontally"><table aria-label="Program sessions in receipt order"><thead><tr><th scope="col">Sequence</th><th scope="col">Received</th><th scope="col">Attendance</th><th scope="col">Session hours</th><th scope="col">Saved location at receipt</th></tr></thead><tbody>{points.map(point => <tr key={point.id}><td><button type="button" aria-pressed={point.id === selected?.id} onClick={() => setSelectedId(point.id)}>Session {point.sequence}</button></td><td><time dateTime={point.receivedAt}>{smsTime(point.receivedAt)}</time></td><td>{smsNumber(point.attendees)}{point.repeatedFromRecordId && !compact && <HelpTip label="Repeated session values" text={`This new session reused attendance and hours from counted record ${point.repeatedFromRecordId}. It creates a separate accepted check-in. The previous session stays unchanged.`}/>}</td><td>{smsNumber(point.sessionMinutes / 60)}</td><td>{point.courseSnapshot.facility || 'Awaiting details'}{point.courseSnapshot.yard ? ` / ${point.courseSnapshot.yard}` : ''}</td></tr>)}</tbody></table></div></details>
    </> : <div className="ca-empty"><Activity size={28}/><h4>{compact ? 'Awaiting first check-in.' : 'Ready for the first program check-in.'}</h4>{!compact && <p>{synthetic ? 'Connect a demo phone to this program, then try a check-in.' : 'An administrator must explicitly bind a facilitator’s phone to this program. New accepted numeric texts will appear here.'}</p>}{!compact && <small>New program-bound check-ins only.<HelpTip label="Earlier check-ins" text="Earlier program-level check-ins remain in their program, organization and TPW totals. Program graphs begin with explicitly linked check-ins."/></small>}</div>}
    {data.truncated && <p className="ca-warning">The line shows the latest {points.length} accepted check-ins. Totals include the full program history; sequence numbers retain the full receipt order.</p>}
    {!compact && <p className="ca-note">Ordered by message receipt. Whole-program details stay separate.</p>}
  </section>;
}

export default function CourseAttendance({ courseId, organizationId, programId }: { courseId: string; organizationId: string; programId: string }) {
  const query = new URLSearchParams({ courseId, organizationId, programId });
  const live = useSmsLive<CourseAttendanceData>(`/api/sms/course-attendance?${query}`, 1000);
  if (!live.data) return <section className="ca-view ca-locked" aria-live="polite"><LockKeyhole size={23}/><h3>{live.loading ? 'Checking program access…' : live.session?.authorized ? 'Refresh to load program activity.' : 'TPW administrator access is required.'}</h3><p>{live.error || 'Only approved TPW administrators can read live program activity.'}</p><button type="button" onClick={live.refresh}>Check again <RefreshCw size={14}/></button></section>;
  return <div className="ca-live"><div className={`ca-live-status${live.stale ? ' ca-warning' : ''}`}><span role="status" aria-atomic="true">{live.stale ? 'Refresh interrupted. Showing the last received data.' : 'Live · checks every 1 second while visible'}</span><button type="button" onClick={live.refresh} disabled={live.refreshing} aria-label="Refresh program activity"><RefreshCw size={14}/></button></div>{live.error && <p className="ca-warning" role="alert">{live.error}</p>}<CourseAttendanceChart data={live.data}/><div className="ca-links"><a href={`/sms/org/${encodeURIComponent(organizationId)}`}>Organization totals <ArrowUpRight size={14}/></a><a href="/sms">TPW totals <ArrowUpRight size={14}/></a><a href="/sms/admin">Manage phone bindings <ArrowUpRight size={14}/></a></div></div>;
}
