CREATE TABLE `business_event_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`request_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`subscription_revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`last_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`delivered_at` text,
	FOREIGN KEY (`request_id`) REFERENCES `business_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `business_event_subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_event_delivery_unique` ON `business_event_outbox` (`request_id`,`subscription_id`);--> statement-breakpoint
CREATE INDEX `business_event_delivery_status_idx` ON `business_event_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `business_event_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`agent_grant_id` text NOT NULL,
	`agent_grant_revision` integer NOT NULL,
	`event_name` text NOT NULL,
	`callback_url` text NOT NULL,
	`secret` text,
	`previous_secret` text,
	`previous_secret_until` text,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `sms_organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_grant_id`) REFERENCES `business_agent_grants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `business_event_subscription_scope_idx` ON `business_event_subscriptions` (`organization_id`,`active`,`expires_at`);--> statement-breakpoint
-- No subscription, credential, destination or historical event is seeded.
CREATE TRIGGER business_event_subscription_insert_guard BEFORE INSERT ON business_event_subscriptions
WHEN NEW.active<>1 OR NEW.revision<>1 OR NEW.secret IS NULL OR NEW.event_name<>'business.request.created'
  OR NOT EXISTS (SELECT 1 FROM business_agent_grants g JOIN sms_organizations o ON o.id=g.organization_id
    WHERE g.id=NEW.agent_grant_id AND g.subject_id=NEW.subject_id AND g.organization_id=NEW.organization_id
      AND g.active=1 AND g.revision=NEW.agent_grant_revision AND o.active=1)
BEGIN SELECT RAISE(ABORT,'Event subscription lacks current business authority'); END;
--> statement-breakpoint
CREATE TRIGGER business_event_subscription_update_guard BEFORE UPDATE ON business_event_subscriptions
WHEN NEW.id IS NOT OLD.id OR NEW.subject_id IS NOT OLD.subject_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.callback_url IS NOT OLD.callback_url OR NEW.event_name IS NOT OLD.event_name OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision<>OLD.revision+1 OR NEW.active NOT IN (0,1)
  OR (NEW.active=0 AND (NEW.secret IS NOT NULL OR NEW.previous_secret IS NOT NULL))
  OR (NEW.active=1 AND (NEW.secret IS NULL OR NOT EXISTS (SELECT 1 FROM business_agent_grants g JOIN sms_organizations o ON o.id=g.organization_id
    WHERE g.id=NEW.agent_grant_id AND g.subject_id=NEW.subject_id AND g.organization_id=NEW.organization_id
      AND g.active=1 AND g.revision=NEW.agent_grant_revision AND o.active=1)))
BEGIN SELECT RAISE(ABORT,'Event subscription identity or authority changed'); END;
--> statement-breakpoint
CREATE TRIGGER business_event_subscription_created AFTER INSERT ON business_event_subscriptions BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,grant_id,details_json,created_at)
    VALUES('subscription:'||NEW.id||':1','events.subscribed',NEW.subject_id,NEW.organization_id,NEW.agent_grant_id,
      json_object('subscriptionId',NEW.id,'event',NEW.event_name,'revision',NEW.revision,'expiresAt',NEW.expires_at),NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER business_event_subscription_changed AFTER UPDATE ON business_event_subscriptions BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,grant_id,details_json,created_at)
    VALUES('subscription:'||NEW.id||':'||NEW.revision,CASE NEW.active WHEN 1 THEN 'events.refreshed' ELSE 'events.stopped' END,
      NEW.subject_id,NEW.organization_id,NEW.agent_grant_id,json_object('subscriptionId',NEW.id,'revision',NEW.revision,'expiresAt',NEW.expires_at),NEW.updated_at);
  UPDATE business_event_outbox SET status='stopped',last_reason=CASE WHEN NEW.active=0 THEN 'subscription_inactive' ELSE 'subscription_expired' END,lease_token=NULL,lease_until=NULL,updated_at=NEW.updated_at
    WHERE subscription_id=NEW.id AND (NEW.active=0 OR OLD.expires_at<=NEW.updated_at) AND status IN ('pending','delivering');
END;
--> statement-breakpoint
CREATE TRIGGER business_event_agent_revoked AFTER UPDATE ON business_agent_grants BEGIN
  UPDATE business_event_subscriptions SET active=0,secret=NULL,previous_secret=NULL,previous_secret_until=NULL,revision=revision+1,updated_at=NEW.updated_at
    WHERE agent_grant_id=NEW.id AND active=1;
END;
--> statement-breakpoint
CREATE TRIGGER business_event_organization_revoked AFTER UPDATE OF active ON sms_organizations WHEN NEW.active=0 BEGIN
  UPDATE business_event_subscriptions SET active=0,secret=NULL,previous_secret=NULL,previous_secret_until=NULL,revision=revision+1,updated_at=NEW.updated_at
    WHERE organization_id=NEW.id AND active=1;
END;
--> statement-breakpoint
CREATE TRIGGER business_event_manager_changed AFTER UPDATE ON business_manager_grants BEGIN
  UPDATE business_event_outbox SET status='stopped',last_reason='leader_authority_changed',lease_token=NULL,lease_until=NULL,updated_at=NEW.updated_at
    WHERE status IN ('pending','delivering') AND request_id IN (SELECT id FROM business_requests WHERE manager_grant_id=NEW.id);
END;
--> statement-breakpoint
-- Atomically emits ONLY newly committed leader SMS requests. No historical import,
-- attendance record, course write or provider retry can produce an event here.
CREATE TRIGGER business_request_event_created AFTER INSERT ON business_requests WHEN NEW.source='sms' BEGIN
  INSERT INTO business_event_outbox(id,event_id,request_id,subscription_id,subscription_revision,status,attempts,created_at,updated_at)
    SELECT NEW.id||':'||s.id,'evt_'||NEW.id,NEW.id,s.id,s.revision,'pending',0,NEW.created_at,NEW.created_at
    FROM business_event_subscriptions s JOIN business_agent_grants g ON g.id=s.agent_grant_id JOIN sms_organizations o ON o.id=s.organization_id
    WHERE s.organization_id=NEW.organization_id AND s.event_name='business.request.created' AND s.active=1 AND s.expires_at>NEW.created_at
      AND s.secret IS NOT NULL AND g.active=1 AND g.revision=s.agent_grant_revision AND g.subject_id=s.subject_id AND o.active=1;
END;
--> statement-breakpoint
CREATE TRIGGER business_event_outbox_identity BEFORE UPDATE ON business_event_outbox
WHEN NEW.id IS NOT OLD.id OR NEW.event_id IS NOT OLD.event_id OR NEW.request_id IS NOT OLD.request_id OR NEW.subscription_id IS NOT OLD.subscription_id
  OR NEW.subscription_revision IS NOT OLD.subscription_revision OR NEW.created_at IS NOT OLD.created_at
  OR OLD.status IN ('delivered','failed','stopped') OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1
  OR NEW.status NOT IN ('pending','delivering','delivered','failed','stopped')
BEGIN SELECT RAISE(ABORT,'Event delivery identity and terminal outcome are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER business_event_outbox_terminal AFTER UPDATE OF status ON business_event_outbox WHEN NEW.status IN ('delivered','failed','stopped') BEGIN
  INSERT INTO business_audit(id,action,actor_id,organization_id,request_id,details_json,created_at)
    SELECT 'delivery:'||NEW.id,'events.'||NEW.status,s.subject_id,s.organization_id,NEW.request_id,
      json_object('subscriptionId',NEW.subscription_id,'eventId',NEW.event_id,'attempts',NEW.attempts,'reason',NEW.last_reason),NEW.updated_at
    FROM business_event_subscriptions s WHERE s.id=NEW.subscription_id;
END;
--> statement-breakpoint
CREATE TRIGGER business_event_subscription_limit BEFORE INSERT ON business_event_subscriptions
WHEN NOT EXISTS(SELECT 1 FROM business_event_subscriptions WHERE id=NEW.id)
  AND (SELECT COUNT(*) FROM business_event_subscriptions WHERE organization_id=NEW.organization_id AND active=1 AND expires_at>NEW.created_at)>=10
BEGIN SELECT RAISE(ABORT,'Event subscription limit reached'); END;
--> statement-breakpoint
CREATE TRIGGER business_event_subscription_reactivation_limit BEFORE UPDATE ON business_event_subscriptions
WHEN (OLD.active=0 OR OLD.expires_at<=NEW.updated_at) AND NEW.active=1
  AND (SELECT COUNT(*) FROM business_event_subscriptions WHERE organization_id=NEW.organization_id AND active=1 AND expires_at>NEW.updated_at AND id<>NEW.id)>=10
BEGIN SELECT RAISE(ABORT,'Event subscription limit reached'); END;
