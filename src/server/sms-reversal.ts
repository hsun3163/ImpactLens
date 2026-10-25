import type { SmsMetrics } from '../lib/sms';

/** A single serialized D1 transaction: receipt, scoped latest-match link, final result.
 * Replayed SIDs insert no receipt, so cannot retract another target. Distinct
 * intentional commands can retract distinct matching active rows, one at a time.
 */
export async function recordSmsReversal(db: D1Database, input: {
  recordId: string; messageSid: string; sender: string; body: string; metrics: SmsMetrics; receivedAt: string; now: string;
}) {
  const {recordId,messageSid,sender,body,metrics,receivedAt,now}=input;
  await db.batch([
    db.prepare(`WITH input(id,message_sid,sender_phone,body,attendees,session_minutes,received_at) AS (VALUES(?,?,?,?,?,?,?)), resolved AS (
      SELECT i.*,t.id teacher_id,o.id organization_id,p.id program_id,t.course_id,o.name organization_name,p.name program_name,
      CASE WHEN c.id IS NOT NULL AND c.program_id=p.id AND c.organization_id=o.id THEN
       json_object('id',c.id,'organizationId',o.id,'programId',p.id,'organizationName',o.name,'programName',p.name,'facility',c.facility,'yard',c.yard,'startDate',c.start_date,'endDate',c.end_date) ELSE NULL END course_snapshot_json,
      CASE WHEN t.id IS NULL THEN 'UNKNOWN_SENDER' WHEN t.active=0 OR p.active=0 OR o.active=0 THEN 'INACTIVE_SENDER'
       WHEN t.course_id IS NOT NULL AND (c.id IS NULL OR c.program_id IS NOT p.id OR c.organization_id IS NOT o.id) THEN 'INVALID_COURSE'
       ELSE 'REVERSAL_PENDING' END reason
      FROM input i LEFT JOIN sms_teachers t ON t.phone=i.sender_phone LEFT JOIN sms_programs p ON p.id=t.program_id
      LEFT JOIN sms_organizations o ON o.id=p.organization_id LEFT JOIN course_summaries c ON c.id=t.course_id
    ) INSERT INTO sms_records(id,message_sid,sender_phone,body,status,reason,teacher_id,organization_id,program_id,course_id,organization_name,program_name,course_snapshot_json,attendees,session_minutes,received_at)
      SELECT id,message_sid,sender_phone,body,'quarantined',reason,teacher_id,organization_id,program_id,course_id,organization_name,program_name,course_snapshot_json,attendees,session_minutes,received_at FROM resolved WHERE true
      ON CONFLICT(message_sid) DO NOTHING`).bind(recordId,messageSid,sender,body,metrics.attendees,metrics.sessionMinutes,receivedAt),
    db.prepare(`INSERT INTO sms_reversals(command_record_id,target_record_id,created_at)
      SELECT command.id,target.id,? FROM sms_records command JOIN sms_records target
      ON target.sender_phone=command.sender_phone AND target.teacher_id=command.teacher_id
      AND target.organization_id=command.organization_id AND target.program_id=command.program_id AND target.course_id IS command.course_id
      WHERE command.id=? AND command.reason='REVERSAL_PENDING' AND command.status='quarantined' AND target.status='counted'
      AND target.attendees=command.attendees AND target.session_minutes=command.session_minutes
      AND NOT EXISTS(SELECT 1 FROM sms_reversals r WHERE r.target_record_id=target.id)
      ORDER BY target.accepted_order DESC,target.processed_at DESC,target.received_at DESC,target.rowid DESC LIMIT 1`).bind(now,recordId),
    db.prepare(`UPDATE sms_records SET reason=CASE WHEN EXISTS(SELECT 1 FROM sms_reversals WHERE command_record_id=?) THEN 'REVERSAL_APPLIED' ELSE 'REVERSAL_NO_MATCH' END,processed_at=?
      WHERE id=? AND status='quarantined' AND reason='REVERSAL_PENDING'`).bind(recordId,now,recordId),
  ]);
}
