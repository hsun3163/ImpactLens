import { aggregateRowsToCsv, MAX_CSV_BYTES, MAX_CSV_ROWS, parseAggregateCsv, validateAggregateRows } from '../lib/csv';
import { summarizeRow } from '../lib/analysis';
import type { AggregateRow } from '../lib/types';

export const BACKEND_LIMITS = { maxCsvBytes: MAX_CSV_BYTES, maxRows: MAX_CSV_ROWS, maxProjects: 25, maxReportsPerProject: 20, maxStoredJsonBytes: 1_572_864 } as const;
const ENGINE = 'impactlens-deterministic-v1';
// JSON escaping can make an otherwise valid 1 MiB CSV larger on the wire.
const MAX_REQUEST_BYTES = MAX_CSV_BYTES * 6 + 4096;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANALYSIS_WARNINGS = [
  'Descriptive aggregate results only. Observed differences do not identify a causal program effect.',
  'Never sum denominators across years, grouping dimensions, outcomes, or follow-up windows; populations may overlap.',
  'User-supplied source labels and uploaded data have not been independently verified.',
  'Wilson 95% intervals are binomial model intervals, not official estimates or evidence of program impact.',
  'Schema validation cannot detect personal information embedded in labels or guarantee de-identification. Use only authorized, non-identifying aggregate data.',
];
interface Runtime { DB?: D1Database; BUCKET?: R2Bucket }
interface ProjectRecord { id: string; owner_id: string; name: string; rows_json: string; row_count: number; csv_key: string; created_at: string; updated_at: string }
interface ReportRecord { id: string; project_id: string; owner_id: string; created_at: string; row_count: number; json_key: string; csv_key: string; markdown_key: string }
interface User { id: string; displayName: string }
class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: string[]) { super(message); }
}

function responseHeaders(): Headers {
  return new Headers({ 'cache-control': 'private, no-store, max-age=0', 'vary': 'Cookie, oai-authenticated-user-id', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' });
}
function json(value: unknown, status = 200): Response {
  const headers = responseHeaders(); headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status, headers });
}
function identity(request: Request): User | null {
  // These headers are supplied by Sites Dispatch, not by application forms.
  // Production must remain behind Sites Dispatch; do not expose this Worker directly.
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (!id || !email || id.length > 256 || email.length > 320) return null;
  let displayName = email;
  const encoded = request.headers.get('oai-authenticated-user-full-name');
  if (encoded && request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try { displayName = decodeURIComponent(encoded).slice(0, 200) || email; } catch { /* Retain safe email fallback. */ }
  }
  return { id, displayName };
}
function requireIdentity(request: Request): User {
  const user = identity(request);
  if (!user) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Sign in with ChatGPT to use your private saved workspace.');
  return user;
}
function requireOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'INVALID_ORIGIN', 'Private workspace changes must be made from this site.');
  }
}
async function readJson(request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED', 'Send an application/json request.');
  const size = request.headers.get('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > maxBytes)) throw new ApiError(413, 'BODY_TOO_LARGE', 'The request exceeds the server upload limit.');
  if (!request.body) throw new ApiError(400, 'INVALID_JSON', 'A JSON object is required.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', 'The request exceeds the server upload limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ApiError(400, 'INVALID_JSON', 'A valid UTF-8 JSON object is required.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_JSON', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
function onlyFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, 'UNKNOWN_FIELD', 'The request contains unsupported fields.');
}
function projectView(project: ProjectRecord) {
  return { id: project.id, name: project.name, rowCount: project.row_count, createdAt: project.created_at, updatedAt: project.updated_at };
}
function reportView(report: ReportRecord) {
  const base = `/api/reports/${report.id}/download`;
  return { id: report.id, projectId: report.project_id, createdAt: report.created_at, rowCount: report.row_count, jsonUrl: `${base}?format=json`, csvUrl: `${base}?format=csv`, markdownUrl: `${base}?format=md`, mdUrl: `${base}?format=md` };
}
async function ownedProject(db: D1Database, id: string, userId: string): Promise<ProjectRecord> {
  if (!ID.test(id)) throw new ApiError(404, 'NOT_FOUND', 'Saved project not found.');
  const project = await db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').bind(id, userId).first<ProjectRecord>();
  if (!project) throw new ApiError(404, 'NOT_FOUND', 'Saved project not found.');
  return project;
}
function savedRows(project: ProjectRecord): AggregateRow[] {
  const validation = validateAggregateRows(JSON.parse(project.rows_json));
  if (validation.errors.length || validation.rows.some(row => !['uploaded', 'synthetic'].includes(row.dataKind))) throw new ApiError(500, 'INVALID_SAVED_DATA', 'The saved aggregate dataset could not be validated.');
  return validation.rows;
}
function analysis(rows: AggregateRow[], computedAt = new Date().toISOString()) {
  return { rowCount: rows.length, summaries: rows.map(summarizeRow), warnings: ANALYSIS_WARNINGS, computedAt, engine: ENGINE };
}
function markdownText(value: string): string {
  // Treat every user-provided label as inert text, not Markdown or HTML.
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}
function markdownReport(project: ProjectRecord, result: ReturnType<typeof analysis>) {
  const lines = ['# ImpactLens aggregate evidence report', '', `Project: ${markdownText(project.name)}`, `Generated: ${result.computedAt}`, `Engine: ${ENGINE}`, '', '## Interpretation boundaries', '', ...ANALYSIS_WARNINGS.map(w => `- ${w}`), ...(result.summaries.some(row => row.dataKind === 'synthetic') ? ['- SYNTHETIC DATA: one or more rows contain invented demonstration values, not real outcomes or evidence.'] : []), '', '## Aggregate rows', '', '| Cohort | Data kind | Release year | Outcome | Follow-up | Events / denominator | Observed rate | Wilson 95% interval | Source label (unverified) |', '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |'];
  for (const row of result.summaries) lines.push(`| ${markdownText(row.group)} | ${row.dataKind} | ${markdownText(row.releaseYear)} | ${markdownText(row.outcome)} | ${row.followupMonths} months | ${row.events} / ${row.denominator} | ${row.ratePct.toFixed(2)}% | ${row.ciLowerPct.toFixed(2)}–${row.ciUpperPct.toFixed(2)}% | ${markdownText(row.sourceId)}; ${markdownText(row.sourcePage)} |`);
  lines.push('', 'Missing-outcome counts are retained in the JSON/CSV reports. Missing is not assumed to mean zero. Every row is a user-supplied snapshot, not independently verified official evidence.', '');
  return lines.join('\n');
}
async function cleanup(bucket: R2Bucket, keys: string[]) {
  // Best-effort compensation for a failed D1 commit. Objects are never public.
  await bucket.delete(keys).catch(() => undefined);
}

export async function handleApi(request: Request, env: Runtime): Promise<Response> {
  try {
    const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, ''); const method = request.method;
    if (path === '/api/session' && method === 'GET') {
      const user = identity(request);
      return json({ authenticated: Boolean(user), user, signInUrl: '/signin-with-chatgpt?return_to=%2F', signOutUrl: '/signout-with-chatgpt?return_to=%2F', storageAvailable: Boolean(env.DB && env.BUCKET), limits: BACKEND_LIMITS });
    }
    const user = requireIdentity(request);
    if (!['GET', 'POST'].includes(method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This API supports GET and POST only.');
    if (method === 'POST') requireOrigin(request);
    if (!env.DB || !env.BUCKET) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Private storage is not available yet. The public demo still works.');
    const db = env.DB; const bucket = env.BUCKET;
    if (path === '/api/projects' && method === 'GET') {
      const projects = await db.prepare('SELECT id, name, row_count, created_at, updated_at FROM projects WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 25').bind(user.id).all<ProjectRecord>();
      return json({ projects: projects.results.map(projectView) });
    }
    if (path === '/api/projects' && method === 'POST') {
      const body = await readJson(request); onlyFields(body, ['name', 'csv']);
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100 || /[\x00-\x1f\x7f]/.test(body.name)) throw new ApiError(400, 'INVALID_NAME', 'Use a project name of 1–100 characters without control characters.');
      if (typeof body.csv !== 'string') throw new ApiError(400, 'CSV_REQUIRED', 'Supply an aggregate CSV string.');
      const validated = parseAggregateCsv(body.csv);
      if (validated.errors.length) throw new ApiError(422, 'INVALID_CSV', 'The aggregate CSV did not pass validation.', validated.errors.slice(0, 30));
      const rowsJson = JSON.stringify(validated.rows);
      if (new TextEncoder().encode(rowsJson).length > BACKEND_LIMITS.maxStoredJsonBytes) throw new ApiError(413, 'DATASET_TOO_LARGE', 'The normalized dataset is too large to save. Split it into smaller aggregate datasets.');
      const id = crypto.randomUUID(); const now = new Date().toISOString(); const csvKey = `projects/${id}/aggregate.csv`;
      const project: ProjectRecord = { id, owner_id: user.id, name: body.name.trim(), rows_json: rowsJson, row_count: validated.rows.length, csv_key: csvKey, created_at: now, updated_at: now };
      await bucket.put(csvKey, aggregateRowsToCsv(validated.rows), { httpMetadata: { contentType: 'text/csv; charset=utf-8' } });
      try {
        const result = await db.prepare('INSERT INTO projects (id, owner_id, name, rows_json, row_count, csv_key, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM projects WHERE owner_id = ?) < ?').bind(id, user.id, project.name, rowsJson, project.row_count, csvKey, now, now, user.id, BACKEND_LIMITS.maxProjects).run();
        if (!result.meta.changes) throw new ApiError(409, 'PROJECT_LIMIT', `This prototype supports up to ${BACKEND_LIMITS.maxProjects} saved projects per account.`);
      } catch (error) { await cleanup(bucket, [csvKey]); throw error; }
      return json({ project: projectView(project), warnings: validated.warnings }, 201);
    }
    const match = path.match(/^\/api\/projects\/([^/]+)(?:\/(analysis|reports))?$/);
    if (match) {
      const project = await ownedProject(db, match[1], user.id);
      if (!match[2] && method === 'GET') return json({ project: projectView(project), rows: savedRows(project) });
      if (match[2] === 'analysis' && method === 'GET') return json(analysis(savedRows(project)));
      if (match[2] === 'reports' && method === 'GET') {
        const reports = await db.prepare('SELECT * FROM reports WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 20').bind(project.id, user.id).all<ReportRecord>();
        return json({ reports: reports.results.map(reportView) });
      }
      if (match[2] === 'reports' && method === 'POST') {
        const body = await readJson(request, 1024); onlyFields(body, []);
        const rows = savedRows(project); const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
        const base = `reports/${id}`;
        const report: ReportRecord = { id, project_id: project.id, owner_id: user.id, created_at: createdAt, row_count: rows.length, json_key: `${base}/report.json`, csv_key: `${base}/aggregate.csv`, markdown_key: `${base}/report.md` };
        const computed = analysis(rows, createdAt);
        const reportJson = { schemaVersion: 1, project: projectView(project), report: reportView(report), ...computed };
        const keys = [report.json_key, report.csv_key, report.markdown_key];
        try {
          // Sequential writes make partial failures compensatable without races.
          await bucket.put(report.json_key, JSON.stringify(reportJson, null, 2), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
          await bucket.put(report.csv_key, aggregateRowsToCsv(rows), { httpMetadata: { contentType: 'text/csv; charset=utf-8' } });
          await bucket.put(report.markdown_key, markdownReport(project, computed), { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
          const result = await db.prepare('INSERT INTO reports (id, project_id, owner_id, created_at, row_count, json_key, csv_key, markdown_key) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM reports WHERE project_id = ? AND owner_id = ?) < ?').bind(id, project.id, user.id, createdAt, rows.length, report.json_key, report.csv_key, report.markdown_key, project.id, user.id, BACKEND_LIMITS.maxReportsPerProject).run();
          if (!result.meta.changes) throw new ApiError(409, 'REPORT_LIMIT', `Each project supports up to ${BACKEND_LIMITS.maxReportsPerProject} persisted reports.`);
        } catch (error) { await cleanup(bucket, keys); throw error; }
        return json({ report: reportView(report) }, 201);
      }
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'The requested operation is not supported.');
    }
    const download = path.match(/^\/api\/reports\/([^/]+)\/download$/);
    if (download && method === 'GET') {
      if (!ID.test(download[1])) throw new ApiError(404, 'NOT_FOUND', 'Report not found.');
      const report = await db.prepare('SELECT r.* FROM reports r INNER JOIN projects p ON p.id = r.project_id WHERE r.id = ? AND r.owner_id = ? AND p.owner_id = ?').bind(download[1], user.id, user.id).first<ReportRecord>();
      if (!report) throw new ApiError(404, 'NOT_FOUND', 'Report not found.');
      const format = url.searchParams.get('format') || 'json';
      if (!['json', 'csv', 'md'].includes(format)) throw new ApiError(400, 'INVALID_FORMAT', 'Choose json, csv, or md.');
      const key = format === 'csv' ? report.csv_key : format === 'md' ? report.markdown_key : report.json_key;
      const object = await bucket.get(key);
      if (!object) throw new ApiError(404, 'FILE_NOT_FOUND', 'The saved report file is unavailable.');
      const headers = responseHeaders();
      headers.set('content-type', format === 'csv' ? 'text/csv; charset=utf-8' : format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8');
      headers.set('content-disposition', `attachment; filename="impactlens-report-${report.id}.${format}"`);
      headers.set('content-security-policy', "default-src 'none'; sandbox");
      return new Response(object.body, { headers });
    }
    throw new ApiError(404, 'NOT_FOUND', 'API endpoint not found.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, error.status);
    // Avoid leaking database/R2 internals, identity headers, or uploaded records.
    return json({ error: 'The private workspace request could not be completed. Please try again.', code: 'INTERNAL_ERROR' }, 500);
  }
}
