CREATE TABLE `center_seed_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`manifest_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generated_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`seed_batch_id` text NOT NULL,
	`source` text NOT NULL,
	`organization_id` text NOT NULL,
	`program_id` text NOT NULL,
	`course_id` text NOT NULL,
	`attendees` integer NOT NULL,
	`session_minutes` integer NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text NOT NULL,
	`course_snapshot_json` text NOT NULL,
	FOREIGN KEY (`seed_batch_id`) REFERENCES `center_seed_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `sms_organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `sms_programs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `course_summaries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generated_activity_attendees" CHECK("generated_activity"."attendees" >= 0 AND "generated_activity"."attendees" <= 10000),
	CONSTRAINT "generated_activity_minutes" CHECK("generated_activity"."session_minutes" >= 15 AND "generated_activity"."session_minutes" <= 1440)
);
--> statement-breakpoint
CREATE INDEX `generated_activity_org_course_idx` ON `generated_activity` (`organization_id`,`course_id`,`received_at`);