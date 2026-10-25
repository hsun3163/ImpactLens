'use client';

import { Check } from 'lucide-react';
import { COURSE_SUMMARY_STATUSES, COURSE_SUMMARY_STATUS_LABELS, type CourseSummaryStatus } from '@/lib/course-summary';

/** Native disclosure only: opening or closing it leaves the course draft unchanged. */
export default function CourseStatusDetails({ status, disabled = false, onChange }: {
  status: CourseSummaryStatus | ''; disabled?: boolean; onChange: (status: CourseSummaryStatus) => void;
}) {
  return <details className="cm-additional-details cm-field-wide">
    <summary>Additional details <span>Status: {status ? COURSE_SUMMARY_STATUS_LABELS[status] : 'Choose status'}</span></summary>
    <div className="cm-additional-body"><span className="cm-field-label">Schedule Status</span>
      <div className="cm-status-options" role="group" aria-label="Schedule Status">{COURSE_SUMMARY_STATUSES.map(value => <button key={value} type="button" disabled={disabled} aria-pressed={status === value} onClick={() => onChange(value)} className={status === value ? 'cm-active' : ''}>{status === value && <Check size={14} aria-hidden="true"/>}<span>{COURSE_SUMMARY_STATUS_LABELS[value]}</span></button>)}</div>
    </div>
  </details>;
}
