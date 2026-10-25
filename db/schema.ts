import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Each row is one authenticated user's bounded aggregate-only dataset.
// Never store identity-provider email/name or individual-person records.
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  rowsJson: text('rows_json').notNull(),
  rowCount: integer('row_count').notNull(),
  csvKey: text('csv_key').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('projects_owner_created_idx').on(table.ownerId, table.createdAt)]);

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  ownerId: text('owner_id').notNull(),
  createdAt: text('created_at').notNull(),
  rowCount: integer('row_count').notNull(),
  jsonKey: text('json_key').notNull(),
  csvKey: text('csv_key').notNull(),
  markdownKey: text('markdown_key').notNull(),
}, table => [index('reports_project_owner_created_idx').on(table.projectId, table.ownerId, table.createdAt)]);

// SMS operations are separate from aggregate CDCR uploads. Teacher contact data
// and raw SMS records are accessible only to explicitly allowlisted TPW admins.
export const smsOrganizations = sqliteTable('sms_organizations', {
  id: text('id').primaryKey(), name: text('name').notNull(), slug: text('slug').notNull().unique(),
  active: integer('active').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const smsPrograms = sqliteTable('sms_programs', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull().references(() => smsOrganizations.id),
  name: text('name').notNull(), active: integer('active').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [index('sms_programs_org_idx').on(table.organizationId)]);
export const smsTeachers = sqliteTable('sms_teachers', {
  id: text('id').primaryKey(), phone: text('phone').notNull().unique(), name: text('name').notNull(),
  programId: text('program_id').notNull().references(() => smsPrograms.id), courseId: text('course_id').references(() => courseSummaries.id), active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const smsRecords = sqliteTable('sms_records', {
  id: text('id').primaryKey(), messageSid: text('message_sid').notNull().unique(), senderPhone: text('sender_phone').notNull(), body: text('body').notNull(),
  status: text('status', { enum: ['counted', 'quarantined'] }).notNull(), reason: text('reason'),
  teacherId: text('teacher_id'), organizationId: text('organization_id'), programId: text('program_id'),
  organizationName: text('organization_name'), programName: text('program_name'),
  courseId: text('course_id'), courseSnapshotJson: text('course_snapshot_json'),
  attendees: integer('attendees'), sessionMinutes: integer('session_minutes'),
  repeatedFromRecordId: text('repeated_from_record_id'), acceptedOrder: integer('accepted_order'), manualCorrectionJson: text('manual_correction_json'),
  receivedAt: text('received_at').notNull(), processedAt: text('processed_at'), reprocessedBy: text('reprocessed_by'),
}, table => [uniqueIndex('sms_records_accepted_order_unique').on(table.acceptedOrder), index('sms_records_repeat_baseline_idx').on(table.senderPhone, table.teacherId, table.courseId, table.organizationId, table.programId, table.status, table.acceptedOrder), index('sms_records_course_received_idx').on(table.courseId, table.status, table.receivedAt, table.id), index('sms_records_received_idx').on(table.receivedAt), index('sms_records_org_received_idx').on(table.organizationId, table.receivedAt), index('sms_records_status_processed_idx').on(table.status, table.processedAt, table.id), index('sms_records_org_status_processed_idx').on(table.organizationId, table.status, table.processedAt, table.id)]);
export const smsAggregates = sqliteTable('sms_aggregates', {
  programId: text('program_id').primaryKey(), organizationId: text('organization_id').notNull(),
  sessions: integer('sessions').notNull().default(0), attendees: integer('attendees').notNull().default(0),
  sessionMinutes: integer('session_minutes').notNull().default(0), participantMinutes: integer('participant_minutes').notNull().default(0),
  lastReceivedAt: text('last_received_at').notNull(),
}, table => [index('sms_aggregates_org_idx').on(table.organizationId)]);


// Existing TPW course-summary fields only. Manual values never update SMS counters.
export const courseSummaries = sqliteTable('course_summaries', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  organizationId: text('organization_id').notNull().references(() => smsOrganizations.id),
  programId: text('program_id').notNull().references(() => smsPrograms.id),
  facility: text('facility'), yard: text('yard'),
  status: text('status', { enum: ['planned', 'in-progress', 'completed'] }).notNull(),
  startDate: text('start_date'), endDate: text('end_date'),
  courseHoursPerParticipant: real('course_hours_per_participant'),
  participants: integer('participants'), completers: integer('completers'), notes: text('notes'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [
  index('course_summaries_updated_idx').on(table.updatedAt, table.id),
  index('course_summaries_org_updated_idx').on(table.organizationId, table.updatedAt, table.id),
  check('course_summary_revision', sql`${table.revision} >= 1 AND ${table.revision} <= 9007199254740991`),
  check('course_summary_status', sql`${table.status} IN ('planned', 'in-progress', 'completed')`),
  check('course_summary_participants', sql`${table.participants} IS NULL OR (typeof(${table.participants}) = 'integer' AND ${table.participants} BETWEEN 0 AND 1000000)`),
  check('course_summary_completers', sql`${table.completers} IS NULL OR (typeof(${table.completers}) = 'integer' AND ${table.completers} BETWEEN 0 AND 1000000)`),
  check('course_summary_completion_bound', sql`${table.participants} IS NULL OR ${table.completers} IS NULL OR ${table.completers} <= ${table.participants}`),
  check('course_summary_hours', sql`${table.courseHoursPerParticipant} IS NULL OR ${table.courseHoursPerParticipant} BETWEEN 0 AND 1000000`),
  check('course_summary_date_order', sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`),
]);

// Explicit business authority. Creating a teacher never inserts either grant.
export const businessManagerGrants = sqliteTable('business_manager_grants', {
  id: text('id').primaryKey(), phone: text('phone').notNull().unique(), organizationId: text('organization_id').notNull().references(() => smsOrganizations.id),
  active: integer('active').notNull().default(1), revision: integer('revision').notNull().default(1),
  createdBy: text('created_by').notNull(), updatedBy: text('updated_by').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const businessAgentGrants = sqliteTable('business_agent_grants', {
  id: text('id').primaryKey(), subjectId: text('subject_id').notNull(), organizationId: text('organization_id').notNull().references(() => smsOrganizations.id),
  active: integer('active').notNull().default(1), revision: integer('revision').notNull().default(1),
  createdBy: text('created_by').notNull(), updatedBy: text('updated_by').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('business_agent_subject_org_unique').on(t.subjectId,t.organizationId)]);
export const businessRequests = sqliteTable('business_requests', {
  id: text('id').primaryKey(), receiptId: text('receipt_id').notNull().unique().references(() => smsRecords.id),
  organizationId: text('organization_id').notNull().references(() => smsOrganizations.id), managerGrantId: text('manager_grant_id').notNull().references(() => businessManagerGrants.id),
  managerGrantRevision: integer('manager_grant_revision').notNull(), text: text('text').notNull(), receivedAt: text('received_at').notNull(),
  source: text('source',{enum:['sms','admin-import']}).notNull(), status: text('status',{enum:['pending','completed']}).notNull().default('pending'),
  importedBy: text('imported_by'), importReason: text('import_reason'), createdAt: text('created_at').notNull(), completedAt: text('completed_at'),
},t => [index('business_requests_org_status_idx').on(t.organizationId,t.status,t.createdAt,t.id)]);
export const businessProposals = sqliteTable('business_proposals', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull().references(() => businessRequests.id), organizationId: text('organization_id').notNull(),
  actorId: text('actor_id').notNull(), agentGrantId: text('agent_grant_id').notNull().references(() => businessAgentGrants.id), agentGrantRevision: integer('agent_grant_revision').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), commandJson: text('command_json').notNull(), commandDigest: text('command_digest').notNull(),
  authorityJson: text('authority_json').notNull(), status: text('status',{enum:['approved','executed']}).notNull().default('approved'),
  createdAt: text('created_at').notNull(), executedAt: text('executed_at'), executedBy: text('executed_by'), resultJson: text('result_json'),
},t => [uniqueIndex('business_proposal_idempotency_unique').on(t.organizationId,t.actorId,t.idempotencyKey),index('business_proposal_request_idx').on(t.requestId,t.createdAt)]);
export const businessAudit = sqliteTable('business_audit', {
  id: text('id').primaryKey(), action: text('action').notNull(), actorId: text('actor_id').notNull(), organizationId: text('organization_id').notNull(),
  requestId: text('request_id'), proposalId: text('proposal_id'), grantId: text('grant_id'), commandDigest: text('command_digest'),
  detailsJson: text('details_json').notNull(), createdAt: text('created_at').notNull(),
},t => [index('business_audit_org_created_idx').on(t.organizationId,t.createdAt,t.id)]);

// Server-only MCP event credentials. Never included in browser or business DTOs.
export const businessEventSubscriptions = sqliteTable('business_event_subscriptions', {
  id: text('id').primaryKey(), subjectId: text('subject_id').notNull(), organizationId: text('organization_id').notNull().references(() => smsOrganizations.id),
  agentGrantId: text('agent_grant_id').notNull().references(() => businessAgentGrants.id), agentGrantRevision: integer('agent_grant_revision').notNull(),
  eventName: text('event_name').notNull(), callbackUrl: text('callback_url').notNull(), secret: text('secret'), previousSecret: text('previous_secret'), previousSecretUntil: text('previous_secret_until'),
  active: integer('active').notNull().default(1), revision: integer('revision').notNull().default(1),
  expiresAt: text('expires_at').notNull(), verifiedAt: text('verified_at').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('business_event_subscription_scope_idx').on(t.organizationId,t.active,t.expiresAt)]);
export const businessEventOutbox = sqliteTable('business_event_outbox', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), requestId: text('request_id').notNull().references(() => businessRequests.id),
  subscriptionId: text('subscription_id').notNull().references(() => businessEventSubscriptions.id), subscriptionRevision: integer('subscription_revision').notNull(),
  status: text('status',{enum:['pending','delivering','delivered','failed','stopped']}).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0), leaseToken: text('lease_token'), leaseUntil: text('lease_until'), lastReason: text('last_reason'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), deliveredAt: text('delivered_at'),
}, t => [uniqueIndex('business_event_delivery_unique').on(t.requestId,t.subscriptionId),index('business_event_delivery_status_idx').on(t.status,t.createdAt)]);

// Fixed generated center collections are separate from SMS receipts and identities.
export const centerSeedBatches = sqliteTable('center_seed_batches', {
  id: text('id').primaryKey(), source: text('source').notNull(),
  createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
  manifestJson: text('manifest_json').notNull(),
});
export const generatedActivity = sqliteTable('generated_activity', {
  id: text('id').primaryKey(),
  seedBatchId: text('seed_batch_id').notNull().references(() => centerSeedBatches.id),
  source: text('source').notNull(),
  organizationId: text('organization_id').notNull().references(() => smsOrganizations.id),
  programId: text('program_id').notNull().references(() => smsPrograms.id),
  courseId: text('course_id').notNull().references(() => courseSummaries.id),
  attendees: integer('attendees').notNull(), sessionMinutes: integer('session_minutes').notNull(),
  receivedAt: text('received_at').notNull(), processedAt: text('processed_at').notNull(),
  courseSnapshotJson: text('course_snapshot_json').notNull(),
}, t => [index('generated_activity_org_course_idx').on(t.organizationId,t.courseId,t.receivedAt),
  check('generated_activity_attendees',sql`${t.attendees} >= 0 AND ${t.attendees} <= 10000`),
  check('generated_activity_minutes',sql`${t.sessionMinutes} >= 15 AND ${t.sessionMinutes} <= 1440`)]);

// Append-only reversal links. Original receipts and counted history stay immutable.
export const smsReversals = sqliteTable('sms_reversals', {
  commandRecordId: text('command_record_id').primaryKey().references(() => smsRecords.id),
  targetRecordId: text('target_record_id').notNull().unique().references(() => smsRecords.id),
  createdAt: text('created_at').notNull(),
});
