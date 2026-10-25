ALTER TABLE `sms_records` ADD `repeated_from_record_id` text;--> statement-breakpoint
ALTER TABLE `sms_records` ADD `accepted_order` integer;--> statement-breakpoint
ALTER TABLE `sms_records` ADD `manual_correction_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sms_records_accepted_order_unique` ON `sms_records` (`accepted_order`);--> statement-breakpoint
CREATE INDEX `sms_records_repeat_baseline_idx` ON `sms_records` (`sender_phone`,`teacher_id`,`course_id`,`organization_id`,`program_id`,`status`,`accepted_order`);
--> statement-breakpoint
-- Additive: legacy records, quarantines, snapshots and counters are not backfilled.
-- New acceptance order is allocated by the same serialized write as acceptance.
-- A repeat's source and resolved metrics are pinned even while it is quarantined.
CREATE TRIGGER sms_repeat_resolution_immutable BEFORE UPDATE ON sms_records
WHEN NEW.repeated_from_record_id IS NOT OLD.repeated_from_record_id
  OR (OLD.repeated_from_record_id IS NOT NULL AND (
    NEW.attendees IS NOT OLD.attendees OR NEW.session_minutes IS NOT OLD.session_minutes
    OR NEW.teacher_id IS NOT OLD.teacher_id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.program_id IS NOT OLD.program_id))
  OR (OLD.accepted_order IS NOT NULL AND NEW.accepted_order IS NOT OLD.accepted_order)
BEGIN SELECT RAISE(ABORT, 'SMS repeat resolution and acceptance order are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sms_repeat_validate_insert BEFORE INSERT ON sms_records
WHEN (NEW.accepted_order IS NOT NULL AND (typeof(NEW.accepted_order)<>'integer' OR NEW.accepted_order<1 OR NEW.status<>'counted'))
  OR (NEW.repeated_from_record_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sms_records source WHERE source.id=NEW.repeated_from_record_id AND source.status='counted'
      AND source.sender_phone=NEW.sender_phone AND source.teacher_id=NEW.teacher_id
      AND source.course_id=NEW.course_id AND source.organization_id=NEW.organization_id AND source.program_id=NEW.program_id
      AND typeof(source.attendees)='integer' AND source.attendees BETWEEN 0 AND 10000
      AND typeof(source.session_minutes)='integer' AND source.session_minutes BETWEEN 15 AND 1440 AND source.session_minutes%15=0
      AND source.attendees=NEW.attendees AND source.session_minutes=NEW.session_minutes))
BEGIN SELECT RAISE(ABORT, 'Invalid SMS repeat source or acceptance order'); END;
--> statement-breakpoint
CREATE TRIGGER sms_repeat_validate_update BEFORE UPDATE ON sms_records
WHEN (NEW.accepted_order IS NOT NULL AND (typeof(NEW.accepted_order)<>'integer' OR NEW.accepted_order<1 OR NEW.status<>'counted'))
  OR (NEW.repeated_from_record_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sms_records source WHERE source.id=NEW.repeated_from_record_id AND source.status='counted'
      AND source.sender_phone=NEW.sender_phone AND source.teacher_id=NEW.teacher_id
      AND source.course_id=NEW.course_id AND source.organization_id=NEW.organization_id AND source.program_id=NEW.program_id
      AND typeof(source.attendees)='integer' AND source.attendees BETWEEN 0 AND 10000
      AND typeof(source.session_minutes)='integer' AND source.session_minutes BETWEEN 15 AND 1440 AND source.session_minutes%15=0
      AND source.attendees=NEW.attendees AND source.session_minutes=NEW.session_minutes))
BEGIN SELECT RAISE(ABORT, 'Invalid SMS repeat source or acceptance order'); END;

--> statement-breakpoint
-- A deliberate admin correction is a separate transition, never an automatic
-- reinterpretation of raw SMS. Existing resolved repeats cannot be rewritten.
CREATE TRIGGER sms_manual_correction_insert BEFORE INSERT ON sms_records
WHEN NEW.manual_correction_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Manual corrections must reference an existing quarantine'); END;
--> statement-breakpoint
CREATE TRIGGER sms_manual_correction_update BEFORE UPDATE ON sms_records
WHEN (OLD.manual_correction_json IS NOT NULL AND NEW.manual_correction_json IS NOT OLD.manual_correction_json)
  OR (OLD.manual_correction_json IS NULL AND NEW.manual_correction_json IS NOT NULL AND (
    OLD.status<>'quarantined' OR NEW.status<>'counted' OR OLD.repeated_from_record_id IS NOT NULL
    OR OLD.teacher_id IS NULL OR OLD.organization_id IS NULL OR OLD.program_id IS NULL
    OR NEW.teacher_id IS NOT OLD.teacher_id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.program_id IS NOT OLD.program_id
    OR NEW.organization_name IS NOT OLD.organization_name OR NEW.program_name IS NOT OLD.program_name
    OR NEW.course_id IS NOT OLD.course_id OR NEW.course_snapshot_json IS NOT OLD.course_snapshot_json
    OR CASE WHEN json_valid(NEW.manual_correction_json)=0 THEN 1 ELSE
      json_extract(NEW.manual_correction_json,'$.source') IS NOT 'manual'
      OR json_extract(NEW.manual_correction_json,'$.correctedBy') IS NOT NEW.reprocessed_by
      OR json_extract(NEW.manual_correction_json,'$.correctedAt') IS NOT NEW.processed_at
      OR json_extract(NEW.manual_correction_json,'$.originalReason') IS NOT OLD.reason
      OR json_extract(NEW.manual_correction_json,'$.attendees') IS NOT NEW.attendees
      OR json_extract(NEW.manual_correction_json,'$.sessionMinutes') IS NOT NEW.session_minutes
      OR json_type(NEW.manual_correction_json,'$.reason') IS NOT 'text'
      OR length(trim(json_extract(NEW.manual_correction_json,'$.reason'))) NOT BETWEEN 1 AND 500 END))
BEGIN SELECT RAISE(ABORT, 'Invalid or immutable manual SMS correction'); END;
