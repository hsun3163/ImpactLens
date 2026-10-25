import { ATTENDANCE_RECORDS_SQL } from './attendance-source';
import { programParticipantEstimate, sumParticipantEstimates, type ParticipantEstimate, type ParticipantEstimateTotals } from '../lib/participant-estimate';

/** Aggregate full history before joining metadata: bindings and list caps cannot duplicate or truncate people estimates. */
export function participantEstimateStatement(db: D1Database, organizationId: string | null) {
  return db.prepare(`SELECT p.id program_id,p.organization_id,COALESCE(r.sessions,0) sessions,r.maximum_attendance,c.configured_maximum,EXISTS(SELECT 1 FROM sms_reversals x JOIN sms_records h ON h.id=x.target_record_id WHERE h.program_id=p.id AND h.organization_id=p.organization_id) has_reversed_history
    FROM sms_programs p
    LEFT JOIN (SELECT organization_id,program_id,COUNT(*) sessions,MAX(attendees) maximum_attendance FROM ${ATTENDANCE_RECORDS_SQL} WHERE status='counted' GROUP BY organization_id,program_id) r
      ON r.program_id=p.id AND r.organization_id=p.organization_id
    LEFT JOIN (SELECT organization_id,program_id,MAX(participants) configured_maximum FROM course_summaries GROUP BY organization_id,program_id) c
      ON c.program_id=p.id AND c.organization_id=p.organization_id
    ${organizationId ? 'WHERE p.organization_id=?' : ''}`).bind(...(organizationId ? [organizationId] : []));
}
export function participantEstimateGroups(rows: Record<string, unknown>[]) {
  const programs = new Map<string, ParticipantEstimate>(); const organizations = new Map<string, ParticipantEstimateTotals>();
  const entries = rows.map(row => ({ organizationId: String(row.organization_id), programId: String(row.program_id),
    participantEstimate: programParticipantEstimate({ sessions: Number(row.sessions), hasReversedHistory: Boolean(row.has_reversed_history), maximumAttendance: row.maximum_attendance === null ? null : Number(row.maximum_attendance) }, row.configured_maximum === null ? null : Number(row.configured_maximum)) }));
  for (const entry of entries) programs.set(entry.programId, entry.participantEstimate);
  for (const organizationId of new Set(entries.map(entry => entry.organizationId))) organizations.set(organizationId, sumParticipantEstimates(entries.filter(entry => entry.organizationId === organizationId)));
  return { programs, organizations, total: sumParticipantEstimates(entries) };
}
