import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  programId: text('program_id').notNull().references(() => smsPrograms.id), active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const smsRecords = sqliteTable('sms_records', {
  id: text('id').primaryKey(), messageSid: text('message_sid').notNull().unique(), senderPhone: text('sender_phone').notNull(), body: text('body').notNull(),
  status: text('status', { enum: ['counted', 'quarantined'] }).notNull(), reason: text('reason'),
  teacherId: text('teacher_id'), organizationId: text('organization_id'), programId: text('program_id'),
  organizationName: text('organization_name'), programName: text('program_name'),
  attendees: integer('attendees'), sessionMinutes: integer('session_minutes'),
  receivedAt: text('received_at').notNull(), processedAt: text('processed_at'), reprocessedBy: text('reprocessed_by'),
}, table => [index('sms_records_received_idx').on(table.receivedAt), index('sms_records_org_received_idx').on(table.organizationId, table.receivedAt), index('sms_records_status_processed_idx').on(table.status, table.processedAt, table.id), index('sms_records_org_status_processed_idx').on(table.organizationId, table.status, table.processedAt, table.id)]);
export const smsAggregates = sqliteTable('sms_aggregates', {
  programId: text('program_id').primaryKey(), organizationId: text('organization_id').notNull(),
  sessions: integer('sessions').notNull().default(0), attendees: integer('attendees').notNull().default(0),
  sessionMinutes: integer('session_minutes').notNull().default(0), participantMinutes: integer('participant_minutes').notNull().default(0),
  lastReceivedAt: text('last_received_at').notNull(),
}, table => [index('sms_aggregates_org_idx').on(table.organizationId)]);
