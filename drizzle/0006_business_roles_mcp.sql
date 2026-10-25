CREATE TABLE `business_agent_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `sms_organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_agent_subject_org_unique` ON `business_agent_grants` (`subject_id`,`organization_id`);--> statement-breakpoint
CREATE TABLE `business_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`request_id` text,
	`proposal_id` text,
	`grant_id` text,
	`command_digest` text,
	`details_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `business_audit_org_created_idx` ON `business_audit` (`organization_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `business_manager_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`organization_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `sms_organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_manager_grants_phone_unique` ON `business_manager_grants` (`phone`);--> statement-breakpoint
CREATE TABLE `business_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`agent_grant_id` text NOT NULL,
	`agent_grant_revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`command_json` text NOT NULL,
	`command_digest` text NOT NULL,
	`authority_json` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`created_at` text NOT NULL,
	`executed_at` text,
	`executed_by` text,
	`result_json` text,
	FOREIGN KEY (`request_id`) REFERENCES `business_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_grant_id`) REFERENCES `business_agent_grants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_proposal_idempotency_unique` ON `business_proposals` (`organization_id`,`actor_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `business_proposal_request_idx` ON `business_proposals` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `business_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`manager_grant_id` text NOT NULL,
	`manager_grant_revision` integer NOT NULL,
	`text` text NOT NULL,
	`received_at` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`imported_by` text,
	`import_reason` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`receipt_id`) REFERENCES `sms_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `sms_organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manager_grant_id`) REFERENCES `business_manager_grants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_requests_receipt_id_unique` ON `business_requests` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `business_requests_org_status_idx` ON `business_requests` (`organization_id`,`status`,`created_at`,`id`);
--> statement-breakpoint
-- Schema only. No phone, subject, role or historical request is seeded.
CREATE TRIGGER business_audit_no_update BEFORE UPDATE ON business_audit BEGIN SELECT RAISE(ABORT,'Business audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER business_audit_no_delete BEFORE DELETE ON business_audit BEGIN SELECT RAISE(ABORT,'Business audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER business_manager_insert_guard BEFORE INSERT ON business_manager_grants
WHEN NEW.active NOT IN (0,1) OR NEW.revision<>1 OR typeof(NEW.revision)<>'integer'
BEGIN SELECT RAISE(ABORT,'Invalid manager grant'); END;
--> statement-breakpoint
CREATE TRIGGER business_manager_update_guard BEFORE UPDATE ON business_manager_grants
WHEN NEW.id IS NOT OLD.id OR NEW.phone IS NOT OLD.phone OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.active NOT IN (0,1) OR NEW.active=OLD.active OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'Manager grant identity is immutable; changes require a new revision'); END;
--> statement-breakpoint
CREATE TRIGGER business_manager_no_delete BEFORE DELETE ON business_manager_grants BEGIN SELECT RAISE(ABORT,'Revoke business grants instead of deleting history'); END;
--> statement-breakpoint
CREATE TRIGGER business_agent_insert_guard BEFORE INSERT ON business_agent_grants
WHEN NEW.active NOT IN (0,1) OR NEW.revision<>1 OR typeof(NEW.revision)<>'integer'
BEGIN SELECT RAISE(ABORT,'Invalid agent grant'); END;
--> statement-breakpoint
CREATE TRIGGER business_agent_update_guard BEFORE UPDATE ON business_agent_grants
WHEN NEW.id IS NOT OLD.id OR NEW.subject_id IS NOT OLD.subject_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.active NOT IN (0,1) OR NEW.active=OLD.active OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'Agent grant identity is immutable; changes require a new revision'); END;
--> statement-breakpoint
CREATE TRIGGER business_agent_no_delete BEFORE DELETE ON business_agent_grants BEGIN SELECT RAISE(ABORT,'Revoke business grants instead of deleting history'); END;
--> statement-breakpoint
CREATE TRIGGER business_manager_created AFTER INSERT ON business_manager_grants BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,grant_id,details_json,created_at)
  VALUES('manager:'||NEW.id||':1','manager.grant',NEW.created_by,NEW.organization_id,NEW.id,json_object('role','organization-leader','active',NEW.active,'revision',NEW.revision),NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER business_manager_changed AFTER UPDATE ON business_manager_grants BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,grant_id,details_json,created_at)
  VALUES('manager:'||NEW.id||':'||NEW.revision,'manager.grant',NEW.updated_by,NEW.organization_id,NEW.id,json_object('role','organization-leader','active',NEW.active,'revision',NEW.revision),NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER business_agent_created AFTER INSERT ON business_agent_grants BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,grant_id,details_json,created_at)
  VALUES('agent:'||NEW.id||':1','agent.grant',NEW.created_by,NEW.organization_id,NEW.id,json_object('role','business-agent','active',NEW.active,'revision',NEW.revision),NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER business_agent_changed AFTER UPDATE ON business_agent_grants BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,grant_id,details_json,created_at)
  VALUES('agent:'||NEW.id||':'||NEW.revision,'agent.grant',NEW.updated_by,NEW.organization_id,NEW.id,json_object('role','business-agent','active',NEW.active,'revision',NEW.revision),NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER business_request_insert_guard BEFORE INSERT ON business_requests
WHEN NEW.source NOT IN ('sms','admin-import') OR NEW.status<>'pending' OR NEW.completed_at IS NOT NULL
  OR (NEW.source='sms' AND (NEW.imported_by IS NOT NULL OR NEW.import_reason IS NOT NULL))
  OR (NEW.source='admin-import' AND (NEW.imported_by IS NULL OR NEW.import_reason IS NULL OR length(trim(NEW.import_reason)) NOT BETWEEN 1 AND 500))
  OR NOT EXISTS (SELECT 1 FROM sms_records r JOIN business_manager_grants m ON m.id=NEW.manager_grant_id
    JOIN sms_organizations o ON o.id=m.organization_id
    WHERE r.id=NEW.receipt_id AND r.status='quarantined' AND r.reason='INVALID_BODY' AND r.body=NEW.text AND length(r.body)<=1600
      AND r.received_at=NEW.received_at AND r.sender_phone=m.phone AND m.active=1 AND m.revision=NEW.manager_grant_revision
      AND m.organization_id=NEW.organization_id AND o.active=1
      AND (NEW.source='sms' OR r.organization_id IS NULL OR r.organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT,'Invalid scoped business request'); END;
--> statement-breakpoint
CREATE TRIGGER business_request_immutable BEFORE UPDATE ON business_requests
WHEN OLD.status<>'pending' OR NEW.status<>'completed' OR NEW.completed_at IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.receipt_id IS NOT OLD.receipt_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.manager_grant_id IS NOT OLD.manager_grant_id OR NEW.manager_grant_revision IS NOT OLD.manager_grant_revision
  OR NEW.text IS NOT OLD.text OR NEW.received_at IS NOT OLD.received_at OR NEW.source IS NOT OLD.source
  OR NEW.imported_by IS NOT OLD.imported_by OR NEW.import_reason IS NOT OLD.import_reason OR NEW.created_at IS NOT OLD.created_at
  OR NOT EXISTS (SELECT 1 FROM business_proposals p WHERE p.request_id=OLD.id AND p.status='executed')
BEGIN SELECT RAISE(ABORT,'Business request history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER business_request_no_delete BEFORE DELETE ON business_requests BEGIN SELECT RAISE(ABORT,'Business request history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER business_request_created AFTER INSERT ON business_requests BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,request_id,grant_id,details_json,created_at)
  VALUES('request:'||NEW.id,CASE NEW.source WHEN 'sms' THEN 'request.received' ELSE 'request.imported' END,
    COALESCE(NEW.imported_by,'manager:'||NEW.manager_grant_id),NEW.organization_id,NEW.id,NEW.manager_grant_id,
    json_object('source',NEW.source,'receiptId',NEW.receipt_id,'managerGrantRevision',NEW.manager_grant_revision,'importReason',NEW.import_reason),NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER business_proposal_insert_guard BEFORE INSERT ON business_proposals
WHEN NEW.status<>'approved' OR NEW.executed_at IS NOT NULL OR NEW.executed_by IS NOT NULL OR NEW.result_json IS NOT NULL
  OR length(NEW.command_digest)<>64 OR json_valid(NEW.command_json)=0 OR json_valid(NEW.authority_json)=0
  OR json_type(NEW.command_json,'$.type') IS NOT 'text'
  OR json_type(NEW.command_json,'$.course.id') IS NOT 'text'
  OR json_type(NEW.command_json,'$.course.programId') IS NOT 'text'
  OR json_type(NEW.command_json,'$.course.revision') IS NOT 'integer'
  OR json_extract(NEW.command_json,'$.type') NOT IN ('course.create','course.update')
  OR json_extract(NEW.command_json,'$.course.organizationId') IS NOT NEW.organization_id
  OR json_extract(NEW.authority_json,'$.commandDigest') IS NOT NEW.command_digest
  OR json_extract(NEW.authority_json,'$.agentGrantId') IS NOT NEW.agent_grant_id
  OR json_extract(NEW.authority_json,'$.agentGrantRevision') IS NOT NEW.agent_grant_revision
  OR NOT EXISTS (SELECT 1 FROM business_requests r JOIN business_manager_grants m ON m.id=r.manager_grant_id
    JOIN business_agent_grants a ON a.id=NEW.agent_grant_id JOIN sms_organizations o ON o.id=r.organization_id
    WHERE r.id=NEW.request_id AND r.organization_id=NEW.organization_id AND r.status='pending'
      AND m.active=1 AND m.organization_id=r.organization_id AND m.revision=r.manager_grant_revision
      AND a.active=1 AND a.organization_id=r.organization_id AND a.subject_id=NEW.actor_id AND a.revision=NEW.agent_grant_revision AND o.active=1
      AND json_extract(NEW.authority_json,'$.managerGrantId')=m.id AND json_extract(NEW.authority_json,'$.managerGrantRevision')=m.revision)
BEGIN SELECT RAISE(ABORT,'Business proposal lacks current standing authority'); END;
--> statement-breakpoint
CREATE TRIGGER business_proposal_immutable BEFORE UPDATE ON business_proposals
WHEN OLD.status<>'approved' OR NEW.status<>'executed'
  OR NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.actor_id IS NOT OLD.actor_id OR NEW.agent_grant_id IS NOT OLD.agent_grant_id OR NEW.agent_grant_revision IS NOT OLD.agent_grant_revision
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.command_json IS NOT OLD.command_json OR NEW.command_digest IS NOT OLD.command_digest
  OR NEW.authority_json IS NOT OLD.authority_json OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'Business proposal history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER business_proposal_no_delete BEFORE DELETE ON business_proposals BEGIN SELECT RAISE(ABORT,'Business proposal history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER business_proposal_created AFTER INSERT ON business_proposals BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,request_id,proposal_id,grant_id,command_digest,details_json,created_at)
  VALUES('proposal:'||NEW.id||':created','proposal.created',NEW.actor_id,NEW.organization_id,NEW.request_id,NEW.id,NEW.agent_grant_id,NEW.command_digest,NEW.authority_json,NEW.created_at);
END;
--> statement-breakpoint
-- This guard and the following apply trigger are one SQLite transaction. Neither
-- a stale revision nor revocation between API preflight and commit can slip past.
CREATE TRIGGER business_execute_guard BEFORE UPDATE OF status ON business_proposals
WHEN NEW.status='executed' AND (
  NEW.executed_at IS NULL OR NEW.executed_by IS NOT OLD.actor_id OR NEW.result_json IS NULL OR json_valid(NEW.result_json)=0
  OR json_extract(NEW.result_json,'$.proposalId') IS NOT OLD.id
  OR json_extract(NEW.result_json,'$.organizationId') IS NOT OLD.organization_id
  OR json_extract(NEW.result_json,'$.resourceId') IS NOT json_extract(OLD.command_json,'$.course.id')
  OR json_extract(NEW.result_json,'$.revision') IS NOT json_extract(OLD.command_json,'$.course.revision')+1
  OR NOT EXISTS (SELECT 1 FROM business_requests r JOIN business_manager_grants m ON m.id=r.manager_grant_id
    JOIN business_agent_grants a ON a.id=OLD.agent_grant_id JOIN sms_organizations o ON o.id=r.organization_id
    JOIN sms_records receipt ON receipt.id=r.receipt_id
    WHERE r.id=OLD.request_id AND r.status='pending' AND r.organization_id=OLD.organization_id
      AND m.active=1 AND m.revision=r.manager_grant_revision AND m.organization_id=r.organization_id AND m.phone=receipt.sender_phone
      AND a.active=1 AND a.revision=OLD.agent_grant_revision AND a.subject_id=NEW.executed_by AND a.organization_id=r.organization_id AND o.active=1)
  OR NOT EXISTS (SELECT 1 FROM sms_programs p WHERE p.id=json_extract(OLD.command_json,'$.course.programId') AND p.organization_id=OLD.organization_id AND p.active=1)
  OR (json_extract(OLD.command_json,'$.type')='course.create' AND (
    json_extract(OLD.command_json,'$.course.revision')<>0 OR EXISTS(SELECT 1 FROM course_summaries c WHERE c.id=json_extract(OLD.command_json,'$.course.id'))))
  OR (json_extract(OLD.command_json,'$.type')='course.update' AND NOT EXISTS (
    SELECT 1 FROM course_summaries c WHERE c.id=json_extract(OLD.command_json,'$.course.id') AND c.organization_id=OLD.organization_id
      AND c.program_id=json_extract(OLD.command_json,'$.course.programId') AND c.revision=json_extract(OLD.command_json,'$.course.revision'))))
BEGIN SELECT RAISE(ABORT,'Business execution authority or revision changed'); END;
--> statement-breakpoint
CREATE TRIGGER business_execute_apply AFTER UPDATE OF status ON business_proposals
WHEN OLD.status='approved' AND NEW.status='executed'
BEGIN
  INSERT INTO course_summaries(id,revision,organization_id,program_id,facility,yard,status,start_date,end_date,course_hours_per_participant,participants,completers,notes,created_at,updated_at)
  SELECT json_extract(NEW.command_json,'$.course.id'),1,NEW.organization_id,json_extract(NEW.command_json,'$.course.programId'),
    json_extract(NEW.command_json,'$.course.facility'),json_extract(NEW.command_json,'$.course.yard'),json_extract(NEW.command_json,'$.course.status'),
    json_extract(NEW.command_json,'$.course.startDate'),json_extract(NEW.command_json,'$.course.endDate'),json_extract(NEW.command_json,'$.course.courseHoursPerParticipant'),
    json_extract(NEW.command_json,'$.course.participants'),json_extract(NEW.command_json,'$.course.completers'),json_extract(NEW.command_json,'$.course.notes'),NEW.executed_at,NEW.executed_at
  WHERE json_extract(NEW.command_json,'$.type')='course.create';
  UPDATE course_summaries SET revision=revision+1,facility=json_extract(NEW.command_json,'$.course.facility'),yard=json_extract(NEW.command_json,'$.course.yard'),
    status=json_extract(NEW.command_json,'$.course.status'),start_date=json_extract(NEW.command_json,'$.course.startDate'),end_date=json_extract(NEW.command_json,'$.course.endDate'),
    course_hours_per_participant=json_extract(NEW.command_json,'$.course.courseHoursPerParticipant'),participants=json_extract(NEW.command_json,'$.course.participants'),
    completers=json_extract(NEW.command_json,'$.course.completers'),updated_at=NEW.executed_at
  WHERE json_extract(NEW.command_json,'$.type')='course.update' AND id=json_extract(NEW.command_json,'$.course.id') AND revision=json_extract(NEW.command_json,'$.course.revision');
  UPDATE business_requests SET status='completed',completed_at=NEW.executed_at WHERE id=NEW.request_id;
  INSERT INTO business_audit(id,action,actor_id,organization_id,request_id,proposal_id,grant_id,command_digest,details_json,created_at)
  VALUES('proposal:'||NEW.id||':executed','proposal.executed',NEW.executed_by,NEW.organization_id,NEW.request_id,NEW.id,NEW.agent_grant_id,NEW.command_digest,
    json_object('authority',json(NEW.authority_json),'result',json(NEW.result_json)),NEW.executed_at);
END;
--> statement-breakpoint
CREATE TRIGGER sms_business_receipt_immutable BEFORE UPDATE ON sms_records
WHEN EXISTS (SELECT 1 FROM business_requests WHERE receipt_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'A queued business receipt retains its original classification'); END;
