CREATE INDEX `sms_aggregates_org_idx` ON `sms_aggregates` (`organization_id`);--> statement-breakpoint
CREATE INDEX `sms_records_status_processed_idx` ON `sms_records` (`status`,`processed_at`,`id`);--> statement-breakpoint
CREATE INDEX `sms_records_org_status_processed_idx` ON `sms_records` (`organization_id`,`status`,`processed_at`,`id`);