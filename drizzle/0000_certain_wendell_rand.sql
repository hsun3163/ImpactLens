CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`rows_json` text NOT NULL,
	`row_count` integer NOT NULL,
	`csv_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_created_idx` ON `projects` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`row_count` integer NOT NULL,
	`json_key` text NOT NULL,
	`csv_key` text NOT NULL,
	`markdown_key` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_project_owner_created_idx` ON `reports` (`project_id`,`owner_id`,`created_at`);