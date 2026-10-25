ALTER TABLE `sms_records` ADD `course_id` text;--> statement-breakpoint
ALTER TABLE `sms_records` ADD `course_snapshot_json` text;--> statement-breakpoint
CREATE INDEX `sms_records_course_received_idx` ON `sms_records` (`course_id`,`status`,`received_at`,`id`);--> statement-breakpoint
ALTER TABLE `sms_teachers` ADD `course_id` text REFERENCES course_summaries(id);
--> statement-breakpoint
-- Additive only: every pre-migration teacher and SMS stays course-unassigned.
-- Database guards supplement API validation and keep same-statement attribution safe.
CREATE TRIGGER sms_teacher_course_insert BEFORE INSERT ON sms_teachers
WHEN NEW.course_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM course_summaries c JOIN sms_programs p ON p.id=NEW.program_id
  WHERE c.id=NEW.course_id AND c.program_id=p.id AND c.organization_id=p.organization_id)
BEGIN SELECT RAISE(ABORT, 'Course binding must match the teacher program and organization'); END;
--> statement-breakpoint
CREATE TRIGGER sms_teacher_course_update BEFORE UPDATE OF course_id,program_id ON sms_teachers
WHEN NEW.course_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM course_summaries c JOIN sms_programs p ON p.id=NEW.program_id
  WHERE c.id=NEW.course_id AND c.program_id=p.id AND c.organization_id=p.organization_id)
BEGIN SELECT RAISE(ABORT, 'Course binding must match the teacher program and organization'); END;
--> statement-breakpoint
CREATE TRIGGER course_sms_parent_immutable BEFORE UPDATE OF organization_id,program_id ON course_summaries
WHEN (NEW.organization_id IS NOT OLD.organization_id OR NEW.program_id IS NOT OLD.program_id)
  AND (EXISTS (SELECT 1 FROM sms_teachers WHERE course_id=OLD.id)
    OR EXISTS (SELECT 1 FROM sms_records WHERE course_id=OLD.id))
BEGIN SELECT RAISE(ABORT, 'A referenced course stays with its original organization and program'); END;
--> statement-breakpoint
CREATE TRIGGER sms_course_snapshot_immutable BEFORE UPDATE ON sms_records
WHEN (OLD.course_id IS NOT NULL AND NEW.course_id IS NOT OLD.course_id)
  OR (OLD.course_snapshot_json IS NOT NULL AND NEW.course_snapshot_json IS NOT OLD.course_snapshot_json)
  OR (OLD.course_id IS NULL AND NEW.course_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'SMS course attribution is immutable; unassigned history is not backfilled'); END;
--> statement-breakpoint
CREATE TRIGGER sms_course_validate_insert BEFORE INSERT ON sms_records
WHEN NEW.status='counted' AND (
  (NEW.course_id IS NULL AND NEW.course_snapshot_json IS NOT NULL)
  OR (NEW.course_id IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM course_summaries c WHERE c.id=NEW.course_id AND c.organization_id=NEW.organization_id AND c.program_id=NEW.program_id)
    OR CASE WHEN NEW.course_snapshot_json IS NULL OR json_valid(NEW.course_snapshot_json)=0 THEN 1 ELSE
      json_extract(NEW.course_snapshot_json,'$.id') IS NOT NEW.course_id
      OR json_extract(NEW.course_snapshot_json,'$.organizationId') IS NOT NEW.organization_id
      OR json_extract(NEW.course_snapshot_json,'$.programId') IS NOT NEW.program_id
      OR json_extract(NEW.course_snapshot_json,'$.organizationName') IS NOT NEW.organization_name
      OR json_extract(NEW.course_snapshot_json,'$.programName') IS NOT NEW.program_name END)))
BEGIN SELECT RAISE(ABORT, 'Invalid SMS course snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER sms_course_validate_update BEFORE UPDATE ON sms_records
WHEN NEW.status='counted' AND (
  (NEW.course_id IS NULL AND NEW.course_snapshot_json IS NOT NULL)
  OR (NEW.course_id IS NOT NULL AND (
    NOT EXISTS (SELECT 1 FROM course_summaries c WHERE c.id=NEW.course_id AND c.organization_id=NEW.organization_id AND c.program_id=NEW.program_id)
    OR CASE WHEN NEW.course_snapshot_json IS NULL OR json_valid(NEW.course_snapshot_json)=0 THEN 1 ELSE
      json_extract(NEW.course_snapshot_json,'$.id') IS NOT NEW.course_id
      OR json_extract(NEW.course_snapshot_json,'$.organizationId') IS NOT NEW.organization_id
      OR json_extract(NEW.course_snapshot_json,'$.programId') IS NOT NEW.program_id
      OR json_extract(NEW.course_snapshot_json,'$.organizationName') IS NOT NEW.organization_name
      OR json_extract(NEW.course_snapshot_json,'$.programName') IS NOT NEW.program_name END)))
BEGIN SELECT RAISE(ABORT, 'Invalid SMS course snapshot'); END;
