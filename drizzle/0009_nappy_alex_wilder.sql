CREATE TABLE `sms_reversals` (
	`command_record_id` text PRIMARY KEY NOT NULL,
	`target_record_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`command_record_id`) REFERENCES `sms_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_record_id`) REFERENCES `sms_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sms_reversals_target_record_id_unique` ON `sms_reversals` (`target_record_id`);--> statement-breakpoint
-- Validate and retain append-only reversal evidence; never rewrite an original SMS.
CREATE TRIGGER sms_reversals_validate BEFORE INSERT ON sms_reversals
WHEN NOT EXISTS (
 SELECT 1 FROM sms_records command JOIN sms_records target ON target.id=NEW.target_record_id
 WHERE command.id=NEW.command_record_id AND command.status='quarantined' AND command.reason='REVERSAL_PENDING'
 AND target.status='counted' AND command.id<>target.id
 AND command.sender_phone=target.sender_phone AND command.teacher_id=target.teacher_id
 AND command.organization_id=target.organization_id AND command.program_id=target.program_id
 AND command.course_id IS target.course_id
 AND command.attendees=target.attendees AND command.session_minutes=target.session_minutes
 AND NOT EXISTS(SELECT 1 FROM sms_reversals prior WHERE prior.target_record_id=target.id)
)
BEGIN SELECT RAISE(ABORT,'Invalid SMS reversal scope'); END;
--> statement-breakpoint
CREATE TRIGGER sms_reversals_no_update BEFORE UPDATE ON sms_reversals
BEGIN SELECT RAISE(ABORT,'SMS reversal audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sms_reversals_no_delete BEFORE DELETE ON sms_reversals
BEGIN SELECT RAISE(ABORT,'SMS reversal audit is immutable'); END;
--> statement-breakpoint
-- Rebuild the affected SMS-only counters from active originals in the same transaction.
-- Removing an empty aggregate is safe: readers already coalesce missing totals to zero.
CREATE TRIGGER sms_reversals_recount AFTER INSERT ON sms_reversals
BEGIN
 DELETE FROM sms_aggregates WHERE program_id=(SELECT program_id FROM sms_records WHERE id=NEW.target_record_id);
 INSERT INTO sms_aggregates(program_id,organization_id,sessions,attendees,session_minutes,participant_minutes,last_received_at)
 SELECT r.program_id,r.organization_id,COUNT(*),SUM(r.attendees),SUM(r.session_minutes),SUM(r.attendees*r.session_minutes),MAX(r.received_at)
 FROM sms_records r WHERE r.status='counted'
 AND r.program_id=(SELECT program_id FROM sms_records WHERE id=NEW.target_record_id)
 AND NOT EXISTS(SELECT 1 FROM sms_reversals x WHERE x.target_record_id=r.id)
 GROUP BY r.program_id,r.organization_id;
END;
--> statement-breakpoint
CREATE TRIGGER sms_reversal_receipt_immutable BEFORE UPDATE ON sms_records
WHEN OLD.reason IN ('REVERSAL_APPLIED','REVERSAL_NO_MATCH')
BEGIN SELECT RAISE(ABORT,'Completed SMS reversal receipt is immutable'); END;
