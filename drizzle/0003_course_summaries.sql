CREATE TABLE `course_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`organization_id` text NOT NULL,
	`program_id` text NOT NULL,
	`facility` text,
	`yard` text,
	`status` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`course_hours_per_participant` real,
	`participants` integer,
	`completers` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `sms_organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `sms_programs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "course_summary_revision" CHECK("course_summaries"."revision" >= 1 AND "course_summaries"."revision" <= 9007199254740991),
	CONSTRAINT "course_summary_status" CHECK("course_summaries"."status" IN ('planned', 'in-progress', 'completed')),
	CONSTRAINT "course_summary_participants" CHECK("course_summaries"."participants" IS NULL OR (typeof("course_summaries"."participants") = 'integer' AND "course_summaries"."participants" BETWEEN 0 AND 1000000)),
	CONSTRAINT "course_summary_completers" CHECK("course_summaries"."completers" IS NULL OR (typeof("course_summaries"."completers") = 'integer' AND "course_summaries"."completers" BETWEEN 0 AND 1000000)),
	CONSTRAINT "course_summary_completion_bound" CHECK("course_summaries"."participants" IS NULL OR "course_summaries"."completers" IS NULL OR "course_summaries"."completers" <= "course_summaries"."participants"),
	CONSTRAINT "course_summary_hours" CHECK("course_summaries"."course_hours_per_participant" IS NULL OR "course_summaries"."course_hours_per_participant" BETWEEN 0 AND 1000000),
	CONSTRAINT "course_summary_date_order" CHECK("course_summaries"."start_date" IS NULL OR "course_summaries"."end_date" IS NULL OR "course_summaries"."end_date" >= "course_summaries"."start_date")
);
--> statement-breakpoint
CREATE INDEX `course_summaries_updated_idx` ON `course_summaries` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `course_summaries_org_updated_idx` ON `course_summaries` (`organization_id`,`updated_at`,`id`);