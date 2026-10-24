CREATE TABLE `sms_aggregates` (
	`program_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`attendees` integer DEFAULT 0 NOT NULL,
	`session_minutes` integer DEFAULT 0 NOT NULL,
	`participant_minutes` integer DEFAULT 0 NOT NULL,
	`last_received_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sms_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sms_organizations_slug_unique` ON `sms_organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `sms_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `sms_organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sms_programs_org_idx` ON `sms_programs` (`organization_id`);--> statement-breakpoint
CREATE TABLE `sms_records` (
	`id` text PRIMARY KEY NOT NULL,
	`message_sid` text NOT NULL,
	`sender_phone` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`teacher_id` text,
	`organization_id` text,
	`program_id` text,
	`organization_name` text,
	`program_name` text,
	`attendees` integer,
	`session_minutes` integer,
	`received_at` text NOT NULL,
	`processed_at` text,
	`reprocessed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sms_records_message_sid_unique` ON `sms_records` (`message_sid`);--> statement-breakpoint
CREATE INDEX `sms_records_received_idx` ON `sms_records` (`received_at`);--> statement-breakpoint
CREATE INDEX `sms_records_org_received_idx` ON `sms_records` (`organization_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `sms_teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`program_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `sms_programs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sms_teachers_phone_unique` ON `sms_teachers` (`phone`);
--> statement-breakpoint
-- Derived counters are part of the same SQLite/D1 transaction as the ledger.
-- Never seed real or synthetic records in a schema migration.
CREATE TRIGGER sms_records_count_insert AFTER INSERT ON sms_records
WHEN NEW.status = 'counted'
BEGIN
  INSERT INTO sms_aggregates(program_id,organization_id,sessions,attendees,session_minutes,participant_minutes,last_received_at)
  VALUES(NEW.program_id,NEW.organization_id,1,NEW.attendees,NEW.session_minutes,NEW.attendees * NEW.session_minutes,NEW.received_at)
  ON CONFLICT(program_id) DO UPDATE SET
    sessions=sessions+1, attendees=attendees+NEW.attendees,
    session_minutes=session_minutes+NEW.session_minutes,
    participant_minutes=participant_minutes+NEW.attendees * NEW.session_minutes,
    last_received_at=MAX(last_received_at,NEW.received_at);
END;
--> statement-breakpoint
CREATE TRIGGER sms_records_count_retry AFTER UPDATE OF status ON sms_records
WHEN OLD.status = 'quarantined' AND NEW.status = 'counted'
BEGIN
  INSERT INTO sms_aggregates(program_id,organization_id,sessions,attendees,session_minutes,participant_minutes,last_received_at)
  VALUES(NEW.program_id,NEW.organization_id,1,NEW.attendees,NEW.session_minutes,NEW.attendees * NEW.session_minutes,NEW.received_at)
  ON CONFLICT(program_id) DO UPDATE SET
    sessions=sessions+1, attendees=attendees+NEW.attendees,
    session_minutes=session_minutes+NEW.session_minutes,
    participant_minutes=participant_minutes+NEW.attendees * NEW.session_minutes,
    last_received_at=MAX(last_received_at,NEW.received_at);
END;
--> statement-breakpoint
CREATE TRIGGER sms_records_immutable BEFORE UPDATE ON sms_records
WHEN OLD.status = 'counted' OR NEW.message_sid IS NOT OLD.message_sid
  OR NEW.sender_phone IS NOT OLD.sender_phone OR NEW.body IS NOT OLD.body
  OR NEW.received_at IS NOT OLD.received_at
BEGIN
  SELECT RAISE(ABORT, 'SMS ledger history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER sms_records_validate_insert BEFORE INSERT ON sms_records
WHEN NEW.status NOT IN ('counted','quarantined') OR
  (NEW.status='counted' AND (NEW.organization_id IS NULL OR NEW.program_id IS NULL
    OR NEW.teacher_id IS NULL OR NEW.organization_name IS NULL OR NEW.program_name IS NULL
    OR NEW.attendees IS NULL OR NEW.attendees<0 OR NEW.attendees>10000
    OR NEW.session_minutes IS NULL OR NEW.session_minutes<15 OR NEW.session_minutes>1440
    OR NEW.session_minutes%15<>0 OR NEW.processed_at IS NULL OR NEW.reason IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'Invalid counted SMS record');
END;
--> statement-breakpoint
CREATE TRIGGER sms_records_validate_update BEFORE UPDATE ON sms_records
WHEN NEW.status NOT IN ('counted','quarantined') OR
  (NEW.status='counted' AND (NEW.organization_id IS NULL OR NEW.program_id IS NULL
    OR NEW.teacher_id IS NULL OR NEW.organization_name IS NULL OR NEW.program_name IS NULL
    OR NEW.attendees IS NULL OR NEW.attendees<0 OR NEW.attendees>10000
    OR NEW.session_minutes IS NULL OR NEW.session_minutes<15 OR NEW.session_minutes>1440
    OR NEW.session_minutes%15<>0 OR NEW.processed_at IS NULL OR NEW.reason IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'Invalid counted SMS record');
END;
