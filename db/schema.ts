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
