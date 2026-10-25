import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
