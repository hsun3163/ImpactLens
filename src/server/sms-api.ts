import { isE164, parseSms, verifyTwilioSignature } from '../lib/sms';

export interface SmsRuntime {
  DB?: D1Database;
  TPW_ADMIN_USER_IDS?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
  TWILIO_WEBHOOK_URL?: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INBOUND = '/api/sms/inbound';
class SmsError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store, max-age=0', 'vary': 'Cookie, oai-authenticated-user-id', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } });
}
function adminIds(env: SmsRuntime): string[] { return (env.TPW_ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean); }
function identity(request: Request): string | null {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  return id && email && id.length <= 256 && email.length <= 320 ? id : null;
}
function requireAdmin(request: Request, env: SmsRuntime): string {
  const user = identity(request);
  if (!user) throw new SmsError(401, 'SIGN_IN_REQUIRED', 'Sign in with ChatGPT to view live SMS dashboards or maintain programs.');
  if (!adminIds(env).length) throw new SmsError(503, 'ADMIN_NOT_CONFIGURED', 'TPW administrator access has not been configured yet. Live records remain private.');
  if (!adminIds(env).includes(user)) throw new SmsError(403, 'ADMIN_REQUIRED', 'This account is not an authorized TPW administrator.');
  return user;
}
function requireOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new SmsError(403, 'INVALID_ORIGIN', 'Make changes from the ImpactLens site.');
}
export function webhookConfigured(env: SmsRuntime): boolean {
  if (!env.TWILIO_AUTH_TOKEN || env.TWILIO_AUTH_TOKEN.length < 16 || !/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID ?? '') || !isE164(env.TWILIO_PHONE_NUMBER ?? '')) return false;
  try {
    const url = new URL(env.TWILIO_WEBHOOK_URL ?? '');
    return url.protocol === 'https:' && url.pathname === INBOUND && !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
}
async function readText(request: Request, maxBytes: number): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new SmsError(413, 'BODY_TOO_LARGE', 'Request exceeds the allowed size.');
  if (!request.body) return '';
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > maxBytes) { await reader.cancel(); throw new SmsError(413, 'BODY_TOO_LARGE', 'Request exceeds the allowed size.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new SmsError(400, 'INVALID_UTF8', 'Request must be UTF-8.'); }
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new SmsError(415, 'JSON_REQUIRED', 'Send JSON.');
  let value: unknown;
  try { value = JSON.parse(await readText(request, 8192)); } catch (error) { if (error instanceof SmsError) throw error; throw new SmsError(400, 'INVALID_JSON', 'A JSON object is required.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SmsError(400, 'INVALID_JSON', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
function only(body: Record<string, unknown>, fields: string[]) { if (Object.keys(body).some(key => !fields.includes(key))) throw new SmsError(400, 'UNKNOWN_FIELD', 'An unsupported field was submitted.'); }
function idField(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new SmsError(400, 'INVALID_ID', 'Choose a valid record.'); return value; }
function nameField(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw new SmsError(400, 'INVALID_NAME', 'Use a name of 1–100 characters without control characters.'); return value.trim(); }
function activeField(value: unknown): number { if (value !== undefined && typeof value !== 'boolean') throw new SmsError(400, 'INVALID_ACTIVE', 'Active must be true or false.'); return value === false ? 0 : 1; }
function numbers(row: Record<string, unknown> | null | undefined) {
  return { sessions: Number(row?.sessions ?? 0), attendees: Number(row?.attendees ?? 0), sessionMinutes: Number(row?.session_minutes ?? 0), participantMinutes: Number(row?.participant_minutes ?? 0) };
}
function organizationView(row: Record<string, unknown>) { return { id: row.id, name: row.name, slug: row.slug, active: Boolean(row.active), ...numbers(row) }; }
function programView(row: Record<string, unknown>) { return { id: row.id, organizationId: row.organization_id, name: row.name, active: Boolean(row.active), ...numbers(row) }; }
const ORG_SELECT = `SELECT o.*, COALESCE(SUM(a.sessions),0) sessions, COALESCE(SUM(a.attendees),0) attendees, COALESCE(SUM(a.session_minutes),0) session_minutes, COALESCE(SUM(a.participant_minutes),0) participant_minutes FROM sms_organizations o LEFT JOIN sms_aggregates a ON a.organization_id=o.id`;
const PROGRAM_SELECT = `SELECT p.*, COALESCE(a.sessions,0) sessions, COALESCE(a.attendees,0) attendees, COALESCE(a.session_minutes,0) session_minutes, COALESCE(a.participant_minutes,0) participant_minutes FROM sms_programs p LEFT JOIN sms_aggregates a ON a.program_id=p.id`;

async function receiveSms(request: Request, env: SmsRuntime): Promise<Response> {
  const receivedAt = new Date().toISOString();
  if (request.method !== 'POST') throw new SmsError(405, 'METHOD_NOT_ALLOWED', 'Twilio must POST incoming SMS.');
  if (!webhookConfigured(env)) throw new SmsError(503, 'SMS_NOT_CONFIGURED', 'SMS receiving is not configured.');
  if (!env.DB) throw new SmsError(503, 'STORAGE_UNAVAILABLE', 'SMS storage is unavailable.');
  const requestUrl = new URL(request.url);
  if (requestUrl.search || requestUrl.pathname !== INBOUND || requestUrl.origin !== new URL(env.TWILIO_WEBHOOK_URL!).origin) throw new SmsError(403, 'INVALID_SIGNATURE', 'Webhook verification failed.');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new SmsError(415, 'FORM_REQUIRED', 'Twilio form encoding is required.');
  const params = new URLSearchParams(await readText(request, 24576));
  if (!await verifyTwilioSignature(env.TWILIO_WEBHOOK_URL!, params, request.headers.get('x-twilio-signature') ?? '', env.TWILIO_AUTH_TOKEN!)) throw new SmsError(403, 'INVALID_SIGNATURE', 'Webhook verification failed.');
  if (params.get('AccountSid') !== env.TWILIO_ACCOUNT_SID || params.get('To') !== env.TWILIO_PHONE_NUMBER) throw new SmsError(403, 'INVALID_DESTINATION', 'Webhook account or recipient is not configured for this service.');
  const messageSid = params.get('MessageSid') ?? ''; const sender = params.get('From') ?? ''; const body = params.get('Body') ?? '';
  if (!/^SM[0-9a-f]{32}$/i.test(messageSid) || !isE164(sender) || body.length > 10000) throw new SmsError(400, 'INVALID_ENVELOPE', 'Invalid SMS envelope.');
  const parsed = parseSms(body); const valid = parsed.ok && (params.get('NumMedia') ?? '0') === '0';
  const now = new Date().toISOString();
  // One statement snapshots the current mapping and inserts the immutable ledger.
  // Migration-owned triggers atomically derive counters. ON CONFLICT never
  // reprocesses quarantine; an explicit authenticated admin action is required.
  await env.DB.prepare(`INSERT INTO sms_records
    (id,message_sid,sender_phone,body,status,reason,teacher_id,organization_id,program_id,organization_name,program_name,attendees,session_minutes,received_at,processed_at)
    SELECT ?,?,?,?,
      CASE WHEN ?=0 OR t.id IS NULL OR t.active=0 OR p.active=0 OR o.active=0 THEN 'quarantined' ELSE 'counted' END,
      CASE WHEN ?=0 THEN 'INVALID_BODY' WHEN t.id IS NULL THEN 'UNKNOWN_SENDER' WHEN t.active=0 OR p.active=0 OR o.active=0 THEN 'INACTIVE_SENDER' ELSE NULL END,
      t.id,o.id,p.id,o.name,p.name,?,?,?,
      CASE WHEN ?=1 AND t.active=1 AND p.active=1 AND o.active=1 THEN ? ELSE NULL END
    FROM (SELECT 1) seed LEFT JOIN sms_teachers t ON t.phone=?
    LEFT JOIN sms_programs p ON p.id=t.program_id LEFT JOIN sms_organizations o ON o.id=p.organization_id
    WHERE true ON CONFLICT(message_sid) DO NOTHING`)
    .bind(crypto.randomUUID(), messageSid, sender, body, Number(valid), Number(valid), parsed.ok ? parsed.metrics.attendees : null, parsed.ok ? parsed.metrics.sessionMinutes : null, receivedAt, Number(valid), now, sender).run();
  // An empty TwiML response acknowledges HTTP receipt without sending an SMS.
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

async function dashboard(db: D1Database, url: URL): Promise<Response> {
  const organizationId = url.searchParams.get('organizationId');
  if (organizationId) idField(organizationId);
  // D1 batch gives one transaction/snapshot and one round trip. Direct D1
  // binding queries use the primary, so fresh polls never select a stale replica.
  const bindings = organizationId ? [organizationId] : [];
  const [orgs, programs, totals, recent] = await db.batch<Record<string, unknown>>([
    db.prepare(ORG_SELECT + (organizationId ? ' WHERE o.id=?' : '') + ' GROUP BY o.id ORDER BY o.name').bind(...bindings),
    db.prepare(PROGRAM_SELECT + (organizationId ? ' WHERE p.organization_id=?' : '') + ' ORDER BY p.name').bind(...bindings),
    db.prepare('SELECT SUM(sessions) sessions,SUM(attendees) attendees,SUM(session_minutes) session_minutes,SUM(participant_minutes) participant_minutes,MAX(last_received_at) last_received_at FROM sms_aggregates' + (organizationId ? ' WHERE organization_id=?' : '')).bind(...bindings),
    db.prepare("SELECT id,organization_name,program_name,attendees,session_minutes,received_at,processed_at FROM sms_records WHERE status='counted'" + (organizationId ? ' AND organization_id=?' : '') + ' ORDER BY processed_at DESC,id DESC LIMIT 8').bind(...bindings),
  ]);
  if (organizationId && !orgs.results.length) throw new SmsError(404, 'NOT_FOUND', 'Organization not found.');
  const total = totals.results[0];
  return json({ generatedAt: new Date().toISOString(), lastReceivedAt: total?.last_received_at ?? null, totals: numbers(total), organizations: orgs.results.map(organizationView), programs: programs.results.map(programView), organization: organizationId ? organizationView(orgs.results[0]) : null,
    recent: recent.results.map(r => ({ id: r.id, organizationName: r.organization_name, programName: r.program_name, attendees: r.attendees, sessionMinutes: r.session_minutes, receivedAt: r.received_at, processedAt: r.processed_at })) });
}
async function adminData(db: D1Database, env: SmsRuntime): Promise<Response> {
  const organizations = await db.prepare(ORG_SELECT + ' GROUP BY o.id ORDER BY o.name').all<Record<string, unknown>>();
  const programs = await db.prepare(PROGRAM_SELECT + ' ORDER BY p.name').all<Record<string, unknown>>();
  const teachers = await db.prepare('SELECT t.*,p.organization_id FROM sms_teachers t JOIN sms_programs p ON p.id=t.program_id ORDER BY t.name').all<Record<string, unknown>>();
  const records = await db.prepare('SELECT * FROM sms_records ORDER BY received_at DESC,id DESC LIMIT 50').all<Record<string, unknown>>();
  const stats = await db.prepare(`SELECT COALESCE(SUM(status='counted'),0) counted,COALESCE(SUM(status='quarantined'),0) quarantined FROM sms_records`).first();
  return json({ organizations: organizations.results.map(organizationView), programs: programs.results.map(programView), teachers: teachers.results.map(r => ({ id: r.id, name: r.name, phone: r.phone, programId: r.program_id, organizationId: r.organization_id, active: Boolean(r.active), createdAt: r.created_at })),
    records: records.results.map(r => ({ id: r.id, messageSid: r.message_sid, senderPhone: r.sender_phone, body: r.body, status: r.status, reason: r.reason, organizationName: r.organization_name, programName: r.program_name, attendees: r.attendees, sessionMinutes: r.session_minutes, receivedAt: r.received_at, reprocessedBy: r.reprocessed_by, processedAt: r.processed_at })), stats, inboundNumber: env.TWILIO_PHONE_NUMBER ?? null, webhookConfigured: webhookConfigured(env) });
}
async function mutate(db: D1Database, body: Record<string, unknown>, userId: string): Promise<Response> {
  const now = new Date().toISOString();
  if (body.action === 'retry') {
    only(body, ['action', 'id']); const id = idField(body.id);
    const record = await db.prepare('SELECT * FROM sms_records WHERE id=?').bind(id).first<Record<string, unknown>>();
    if (!record) throw new SmsError(404, 'NOT_FOUND', 'SMS record not found.');
    if (record.status === 'counted') return json({ ok: true, alreadyCounted: true });
    if (!['UNKNOWN_SENDER', 'INACTIVE_SENDER'].includes(String(record.reason))) throw new SmsError(409, 'INVALID_BODY', 'Ask the teacher to send a new SMS in the correct format. The original message cannot be edited.');
    const parsed = parseSms(String(record.body));
    if (!parsed.ok) throw new SmsError(409, 'INVALID_BODY', 'The original message cannot be counted. Ask the teacher to resend it correctly.');
    // The WHERE guard makes repeated or concurrent admin retries count exactly once.
    // Snapshot mapping inside the same SQL statement, not in a separate earlier read.
    const result = await db.prepare(`UPDATE sms_records SET
      teacher_id=COALESCE(sms_records.teacher_id,t.id),organization_id=o.id,program_id=p.id,organization_name=COALESCE(sms_records.organization_name,o.name),program_name=COALESCE(sms_records.program_name,p.name),
      attendees=?,session_minutes=?,status='counted',reason=NULL,processed_at=?,reprocessed_by=?
      FROM sms_teachers t, sms_programs p, sms_organizations o
      WHERE p.id=COALESCE(sms_records.program_id,t.program_id) AND o.id=p.organization_id AND sms_records.id=? AND sms_records.status='quarantined'
      AND ((sms_records.teacher_id IS NOT NULL AND t.id=sms_records.teacher_id) OR (sms_records.teacher_id IS NULL AND t.phone=sms_records.sender_phone))
      AND t.active=1 AND p.active=1 AND o.active=1`).bind(parsed.metrics.attendees, parsed.metrics.sessionMinutes, now, userId, id).run();
    if (!result.meta.changes) throw new SmsError(409, 'SENDER_NOT_ACTIVE', 'Add or activate the sender’s organization, program, and phone binding before retrying.');
    return json({ ok: true });
  }
  if (body.action === 'organization') {
    only(body, ['action', 'id', 'name', 'slug', 'active']);
    const id = body.id === undefined ? crypto.randomUUID() : idField(body.id); const name = nameField(body.name); const active = activeField(body.active);
    let slug: string;
    if (body.slug !== undefined) { if (typeof body.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(body.slug)) throw new SmsError(400, 'INVALID_SLUG', 'Use a short lowercase URL label with letters, numbers, and hyphens.'); slug = body.slug; }
    else { const existing = body.id ? await db.prepare('SELECT slug FROM sms_organizations WHERE id=?').bind(id).first<{ slug: string }>() : null; slug = existing?.slug ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,60) || 'organization'}-${id.slice(0,8)}`; }
    const conflict = await db.prepare('SELECT id FROM sms_organizations WHERE slug=? AND id<>?').bind(slug, id).first();
    if (conflict) throw new SmsError(409, 'DUPLICATE_SLUG', 'That organization URL label is already in use.');
    if (body.id) { const result = await db.prepare('UPDATE sms_organizations SET name=?,slug=?,active=?,updated_at=? WHERE id=?').bind(name, slug, active, now, id).run(); if (!result.meta.changes) throw new SmsError(404, 'NOT_FOUND', 'Organization not found.'); }
    else await db.prepare('INSERT INTO sms_organizations(id,name,slug,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, name, slug, active, now, now).run();
    return json({ ok: true, id }, body.id ? 200 : 201);
  }
  if (body.action === 'program') {
    only(body, ['action', 'id', 'organizationId', 'name', 'active']);
    const id = body.id === undefined ? crypto.randomUUID() : idField(body.id); const organizationId = idField(body.organizationId); const name = nameField(body.name); const active = activeField(body.active);
    const org = await db.prepare('SELECT id FROM sms_organizations WHERE id=?').bind(organizationId).first();
    if (!org) throw new SmsError(400, 'ORGANIZATION_REQUIRED', 'Choose an existing organization.');
    if (body.id) {
      const existing = await db.prepare('SELECT organization_id FROM sms_programs WHERE id=?').bind(id).first<{ organization_id: string }>();
      if (!existing) throw new SmsError(404, 'NOT_FOUND', 'Program not found.');
      // Keep organizational attribution stable. Create a new program to move work.
      if (existing.organization_id !== organizationId) throw new SmsError(409, 'PROGRAM_ORGANIZATION_FIXED', 'A program stays with its organization. Create a new program in the other organization, then update teacher bindings.');
      await db.prepare('UPDATE sms_programs SET name=?,active=?,updated_at=? WHERE id=?').bind(name, active, now, id).run();
    } else await db.prepare('INSERT INTO sms_programs(id,organization_id,name,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, organizationId, name, active, now, now).run();
    return json({ ok: true, id }, body.id ? 200 : 201);
  }
  if (body.action === 'teacher') {
    only(body, ['action', 'id', 'name', 'phone', 'programId', 'active']);
    const id = body.id === undefined ? crypto.randomUUID() : idField(body.id); const programId = idField(body.programId); const name = nameField(body.name); const active = activeField(body.active);
    if (typeof body.phone !== 'string' || !isE164(body.phone.trim())) throw new SmsError(400, 'INVALID_PHONE', 'Use an international phone number, for example +14155550123.');
    const phone = body.phone.trim();
    if (!await db.prepare('SELECT id FROM sms_programs WHERE id=?').bind(programId).first()) throw new SmsError(400, 'PROGRAM_REQUIRED', 'Choose an existing program.');
    if (await db.prepare('SELECT id FROM sms_teachers WHERE phone=? AND id<>?').bind(phone, id).first()) throw new SmsError(409, 'PHONE_ALREADY_BOUND', 'This phone already has one organization/program binding. Edit that binding instead.');
    if (body.id) { const result = await db.prepare('UPDATE sms_teachers SET name=?,phone=?,program_id=?,active=?,updated_at=? WHERE id=?').bind(name, phone, programId, active, now, id).run(); if (!result.meta.changes) throw new SmsError(404, 'NOT_FOUND', 'Teacher binding not found.'); }
    else await db.prepare('INSERT INTO sms_teachers(id,name,phone,program_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id, name, phone, programId, active, now, now).run();
    return json({ ok: true, id }, body.id ? 200 : 201);
  }
  throw new SmsError(400, 'INVALID_ACTION', 'Choose an organization, program, teacher binding, or retry action.');
}

export async function handleSmsApi(request: Request, env: SmsRuntime): Promise<Response> {
  try {
    const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '');
    if (path === INBOUND) return await receiveSms(request, env);
    if (path === '/api/sms/session' && request.method === 'GET') {
      const user = identity(request); const authorized = Boolean(user && adminIds(env).includes(user));
      return json({ authenticated: Boolean(user), authorized, configured: adminIds(env).length > 0, webhookConfigured: authorized && webhookConfigured(env), inboundNumber: authorized ? env.TWILIO_PHONE_NUMBER ?? null : null, signInUrl: '/signin-with-chatgpt?return_to=%2Fsms' });
    }
    const userId = requireAdmin(request, env);
    if (!env.DB) throw new SmsError(503, 'STORAGE_UNAVAILABLE', 'SMS storage is unavailable.');
    if (path === '/api/sms/dashboard' && request.method === 'GET') return await dashboard(env.DB, url);
    if (path === '/api/sms/admin' && request.method === 'GET') return await adminData(env.DB, env);
    if (path === '/api/sms/admin' && request.method === 'POST') { requireOrigin(request); return await mutate(env.DB, await readJson(request), userId); }
    throw new SmsError(404, 'NOT_FOUND', 'SMS endpoint not found.');
  } catch (error) {
    if (error instanceof SmsError) return json({ code: error.code, error: error.message }, error.status);
    // Do not log raw messages, phone numbers, signatures, credentials, or SQL errors.
    return json({ code: 'INTERNAL_ERROR', error: 'The SMS request could not be completed. Retry later; a stored message will not be counted twice.' }, 500);
  }
}
