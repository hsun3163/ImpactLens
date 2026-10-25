/** Read-only union: raw SMS receipts and generated center activity remain separate.
 * No phone, body, SID or identity metadata can enter this reporting projection.
 */
export const ATTENDANCE_RECORDS_SQL = `(
  SELECT id,organization_id,program_id,course_id,attendees,session_minutes,received_at,processed_at,
    course_snapshot_json,repeated_from_record_id,organization_name,program_name,status,'sms' source
  FROM sms_records WHERE status='counted' AND NOT EXISTS(SELECT 1 FROM sms_reversals x WHERE x.target_record_id=sms_records.id)
  UNION ALL
  SELECT g.id,g.organization_id,g.program_id,g.course_id,g.attendees,g.session_minutes,g.received_at,g.processed_at,
    g.course_snapshot_json,NULL repeated_from_record_id,o.name organization_name,p.name program_name,'counted' status,g.source
  FROM generated_activity g JOIN sms_organizations o ON o.id=g.organization_id
  JOIN sms_programs p ON p.id=g.program_id AND p.organization_id=g.organization_id
  JOIN course_summaries c ON c.id=g.course_id AND c.organization_id=g.organization_id AND c.program_id=g.program_id
)`;

/** Sum disjoint stores once, grouping before metadata joins prevents fanout. */
export const ATTENDANCE_AGGREGATES_SQL = `(
  SELECT program_id,organization_id,SUM(sessions) sessions,SUM(attendees) attendees,
    SUM(session_minutes) session_minutes,SUM(participant_minutes) participant_minutes,MAX(last_received_at) last_received_at
  FROM (
    SELECT program_id,organization_id,sessions,attendees,session_minutes,participant_minutes,last_received_at FROM sms_aggregates
    UNION ALL
    SELECT g.program_id,g.organization_id,COUNT(*) sessions,SUM(g.attendees) attendees,
      SUM(g.session_minutes) session_minutes,SUM(g.attendees*g.session_minutes) participant_minutes,MAX(g.received_at) last_received_at
    FROM generated_activity g JOIN sms_organizations o ON o.id=g.organization_id
    JOIN sms_programs p ON p.id=g.program_id AND p.organization_id=g.organization_id
    JOIN course_summaries c ON c.id=g.course_id AND c.organization_id=g.organization_id AND c.program_id=g.program_id
    GROUP BY g.program_id,g.organization_id
  ) GROUP BY program_id,organization_id
)`;
