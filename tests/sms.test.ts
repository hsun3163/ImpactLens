import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSms, verifyTwilioSignature } from '../src/lib/sms';
import { handleSmsApi, type SmsRuntime } from '../src/server/sms-api';

const ORIGIN = 'https://impactlens.example.test';
const URL = ORIGIN + '/api/sms/inbound';
const ACCOUNT = 'AC' + 'a'.repeat(32);
const TOKEN = 'synthetic-test-token-not-a-real-secret';
const PHONE = '+14155550101';
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  const prepare = (sql: string) => {
    let values: any[] = [];
    const statement = {
      bind(...args: any[]) { values = args; return statement; },
      async first(column?: string) { const row = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined; return row ? column ? row[column] : row : null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }; },
      async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
    }; return statement;
  };
  const env: SmsRuntime = { DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; } catch(error) { sqlite.exec('ROLLBACK'); throw error; } } } as unknown as D1Database, TPW_ADMIN_USER_IDS: 'tpw-admin', TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_PHONE_NUMBER: '+14155550999', TWILIO_WEBHOOK_URL: URL };
  async function api(path: string, body?: unknown, user: string | null = 'tpw-admin', extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test` } : {}), ...(body ? { 'content-type': 'application/json', origin: ORIGIN } : {}), ...extra };
    return handleSmsApi(new Request(ORIGIN + path, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  }
  let sequence = 0;
  async function sms(body = '20 2', overrides: Record<string, string> = {}, options: { signature?: string; signingUrl?: string; requestPath?: string } = {}) {
    sequence++;
    const params = new URLSearchParams({ AccountSid: ACCOUNT, To: env.TWILIO_PHONE_NUMBER!, From: PHONE, Body: body, MessageSid: 'SM' + sequence.toString(16).padStart(32, '0'), NumMedia: '0', ...overrides });
    const signature = options.signature ?? sign(options.signingUrl ?? URL, params);
    return handleSmsApi(new Request(ORIGIN + (options.requestPath ?? '/api/sms/inbound'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature }, body: params.toString() }), env);
  }
  async function create(action: string, data: Record<string, unknown>) { const response = await api('/api/sms/admin', { action, ...data }); const result = await response.json() as any; assert.equal(response.status, 201, JSON.stringify(result)); return result.id as string; }
  async function mapping(phone = PHONE, suffix = '') {
    const organizationId = await create('organization', { name: 'Synthetic Org' + suffix });
    const programId = await create('program', { name: 'Synthetic Program' + suffix, organizationId });
    const teacherId = await create('teacher', { name: 'Synthetic Teacher' + suffix, phone, programId });
    return { organizationId, programId, teacherId };
  }
  async function dash(org?: string) { const response = await api('/api/sms/dashboard' + (org ? '?organizationId=' + org : '')); assert.equal(response.status, 200, await response.clone().text()); return await response.json() as any; }
  return { sqlite, env, api, sms, create, mapping, dash };
}
function sign(url: string, params: URLSearchParams) { return createHmac('sha1', TOKEN).update(url + [...params.keys()].sort().map(key => key + params.get(key)!).join('')).digest('base64'); }

test('SMS parser is exact, bounded and integer-minute deterministic', () => {
  for (const [body, attendees, sessionMinutes] of [['20 2', 20, 120], ['0 0.25', 0, 15], ['10000 24', 10000, 1440], [' 3 1.50\n', 3, 90], ['7 0.75', 7, 45]] as const) assert.deepEqual(parseSms(body), { ok: true, metrics: { attendees, sessionMinutes } });
  for (const body of ['', '20', '20,2', 'twenty 2', '-1 2', '1 -2', '1 0', '10001 2', '1 24.25', '1 1.01', '1 1.5 hours', '1\t2', '1\n2', 'NaN 2', '1 Infinity', '01 2', '1 02', '1e2 2', '1 1,5', '1 1.00', 'x'.repeat(1601)]) assert.equal(parseSms(body).ok, false, body);
});
test('signature includes every received field and rejects ambiguity', async () => {
  const fields = new URLSearchParams({ Body: '20 2', NewTwilioField: 'future scalar + value', AccountSid: ACCOUNT });
  assert.equal(await verifyTwilioSignature(URL, fields, sign(URL, fields), TOKEN), true);
  assert.equal(await verifyTwilioSignature(URL + '?wrong=1', fields, sign(URL, fields), TOKEN), false);
  fields.append('Body', '999 9'); assert.equal(await verifyTwilioSignature(URL, fields, sign(URL, fields), TOKEN), false);
});
test('single SMS saves raw+phone, links org/program, atomically updates both dashboards, sends no SMS', async () => {
  const f = fixture(); try {
    const m = await f.mapping(); const response = await f.sms(); assert.equal(response.status, 200); const xml = await response.text(); assert.match(xml, /<Response><\/Response>/); assert.doesNotMatch(xml, /<Message/);
    const record = f.sqlite.prepare('SELECT * FROM sms_records').get() as any;
    assert.equal(record.sender_phone, PHONE); assert.equal(record.body, '20 2'); assert.equal(record.organization_id, m.organizationId); assert.equal(record.program_id, m.programId); assert.equal(record.status, 'counted');
    const global = await f.dash(); const org = await f.dash(m.organizationId);
    assert.deepEqual(global.totals, { sessions: 1, attendees: 20, sessionMinutes: 120, participantMinutes: 2400 }); assert.deepEqual(org.totals, global.totals);
    assert.doesNotMatch(JSON.stringify(global), /senderPhone|sender_phone|"body"|14155550101|messageSid/);
  } finally { f.sqlite.close(); }
});
test('many senders/programs sum correctly without treating visits as unique people', async () => {
  const f = fixture(); try {
    const a = await f.mapping(); const b = await f.mapping('+14155550102', ' Two');
    const program = await f.create('program', { name: 'Second Program', organizationId: a.organizationId });
    await f.create('teacher', { name: 'Second Teacher', phone: '+14155550103', programId: program });
    await f.sms('20 2'); await f.sms('5 0.5', { From: '+14155550103' }); await f.sms('3 1.25', { From: '+14155550102' });
    assert.deepEqual((await f.dash()).totals, { sessions: 3, attendees: 28, sessionMinutes: 225, participantMinutes: 2775 });
    assert.deepEqual((await f.dash(a.organizationId)).totals, { sessions: 2, attendees: 25, sessionMinutes: 150, participantMinutes: 2550 });
    assert.equal((await f.dash(b.organizationId)).totals.sessions, 1);
  } finally { f.sqlite.close(); }
});
test('provider retries and concurrent duplicate SID deliveries never increment twice', async () => {
  const f = fixture(); try {
    await f.mapping(); const MessageSid = 'SM' + 'd'.repeat(32);
    const responses = await Promise.all(Array.from({ length: 10 }, () => f.sms('20 2', { MessageSid })));
    assert.ok(responses.every(r => r.status === 200)); assert.equal((await f.dash()).totals.sessions, 1);
    assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM sms_records').get() as any).n, 1);
  } finally { f.sqlite.close(); }
});
test('unknown and invalid SMS quarantined without changing counters; no automatic reprocess', async () => {
  const f = fixture(); try {
    const MessageSid = 'SM' + 'e'.repeat(32);
    assert.equal((await f.sms('20 2', { MessageSid })).status, 200); assert.equal((await f.sms('twenty people for two hours')).status, 200);
    assert.equal((await f.dash()).totals.sessions, 0); const m = await f.mapping();
    await f.sms('20 2', { MessageSid }); assert.equal((await f.dash()).totals.sessions, 0);
    const row = f.sqlite.prepare('SELECT id FROM sms_records WHERE message_sid=?').get(MessageSid) as any;
    assert.equal((await f.api('/api/sms/admin', { action: 'retry', id: row.id })).status, 200);
    assert.equal((await f.api('/api/sms/admin', { action: 'retry', id: row.id })).status, 200);
    assert.equal((await f.dash(m.organizationId)).totals.sessions, 1);
    const counted = f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(row.id) as any; assert.equal(counted.reprocessed_by, 'tpw-admin'); assert.ok(counted.processed_at);
    const invalid = f.sqlite.prepare("SELECT id FROM sms_records WHERE reason='INVALID_BODY'").get() as any;
    assert.equal((await f.api('/api/sms/admin', { action: 'retry', id: invalid.id })).status, 409);
  } finally { f.sqlite.close(); }
});
test('mapping moves and renames only affect future SMS, never counted snapshots', async () => {
  const f = fixture(); try {
    const a = await f.mapping(); const orgB = await f.create('organization', { name: 'Other Org' }); const programB = await f.create('program', { name: 'Other Program', organizationId: orgB });
    const MessageSid = 'SM' + 'f'.repeat(32); await f.sms('20 2', { MessageSid });
    assert.equal((await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Moved Teacher', phone: PHONE, programId: programB })).status, 200);
    await f.api('/api/sms/admin', { action: 'organization', id: a.organizationId, name: 'Renamed Org' });
    await f.sms('20 2', { MessageSid }); await f.sms('3 1');
    const old = f.sqlite.prepare('SELECT * FROM sms_records WHERE message_sid=?').get(MessageSid) as any; assert.equal(old.organization_id, a.organizationId); assert.equal(old.organization_name, 'Synthetic Org');
    assert.equal((await f.dash(a.organizationId)).totals.attendees, 20); assert.equal((await f.dash(orgB)).totals.attendees, 3);
    assert.throws(() => f.sqlite.prepare('UPDATE sms_records SET attendees=999 WHERE id=?').run(old.id), /immutable/);
  } finally { f.sqlite.close(); }
});
test('inactive entities quarantine; explicit retry preserves originally known attribution', async () => {
  const f = fixture(); try {
    const a = await f.mapping(); await f.api('/api/sms/admin', { action: 'program', id: a.programId, organizationId: a.organizationId, name: 'Synthetic Program', active: false });
    await f.sms(); const row = f.sqlite.prepare('SELECT * FROM sms_records').get() as any; assert.equal(row.reason, 'INACTIVE_SENDER');
    assert.equal((await f.api('/api/sms/admin', { action: 'retry', id: row.id })).status, 409);
    const bOrg = await f.create('organization', { name: 'Other' }); const bProg = await f.create('program', { name: 'Other Program', organizationId: bOrg });
    await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Moved', phone: PHONE, programId: bProg });
    await f.api('/api/sms/admin', { action: 'program', id: a.programId, organizationId: a.organizationId, name: 'Changed name', active: true });
    assert.equal((await f.api('/api/sms/admin', { action: 'retry', id: row.id })).status, 200);
    assert.equal((await f.dash(a.organizationId)).totals.sessions, 1); assert.equal((await f.dash(bOrg)).totals.sessions, 0);
    const processed = f.sqlite.prepare('SELECT * FROM sms_records').get() as any; assert.equal(processed.program_name, 'Synthetic Program');
  } finally { f.sqlite.close(); }
});
test('one phone has one binding, program organization is fixed, invalid maintenance rejected', async () => {
  const f = fixture(); try {
    const m = await f.mapping(); const other = await f.create('organization', { name: 'Other' });
    assert.equal((await f.api('/api/sms/admin', { action: 'teacher', name: 'Duplicate', phone: PHONE, programId: m.programId })).status, 409);
    assert.equal((await f.api('/api/sms/admin', { action: 'teacher', name: 'Bad', phone: '(415) 555-0101', programId: m.programId })).status, 400);
    assert.equal((await f.api('/api/sms/admin', { action: 'program', id: m.programId, name: 'Moved', organizationId: other })).status, 409);
    assert.equal((await f.api('/api/sms/admin', { action: 'organization', name: 'Bad', active: 'false' })).status, 400);
    assert.equal((await f.api('/api/sms/admin', { action: 'organization', name: 'Bad', unexpected: true })).status, 400);
  } finally { f.sqlite.close(); }
});
test('all private live routes enforce allowlist, identity and same-origin writes', async () => {
  const f = fixture(); try {
    await f.mapping(); await f.sms();
    for (const path of ['/api/sms/admin', '/api/sms/dashboard']) {
      assert.equal((await f.api(path, undefined, null)).status, 401); assert.equal((await f.api(path, undefined, 'other-user')).status, 403);
    }
    const session = await (await f.api('/api/sms/session', undefined, null)).json() as any; assert.equal(session.authorized, false); assert.equal(session.inboundNumber, null);
    assert.equal((await f.api('/api/sms/admin', { action: 'organization', name: 'Bad' }, 'tpw-admin', { origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.api('/api/sms/admin', { action: 'organization', name: 'Bad' }, 'tpw-admin', { 'sec-fetch-site': 'cross-site' })).status, 403);
    f.env.TPW_ADMIN_USER_IDS = ''; assert.equal((await f.api('/api/sms/admin')).status, 503);
  } finally { f.sqlite.close(); }
});
test('signature, account, destination, path, media and missing configuration fail safely', async () => {
  const f = fixture(); try {
    await f.mapping();
    assert.equal((await f.sms('20 2', {}, { signature: 'invalid' })).status, 403);
    assert.equal((await f.sms('20 2', { AccountSid: 'AC' + 'b'.repeat(32) })).status, 403);
    assert.equal((await f.sms('20 2', { To: '+14155550888' })).status, 403);
    assert.equal((await f.sms('20 2', {}, { signingUrl: URL + '?mismatch=1' })).status, 403);
    assert.equal((await f.sms('20 2', {}, { requestPath: '/api/sms/inbound?wrong=1' })).status, 403);
    assert.equal((await f.sms('20 2', {}, { requestPath: '/api/sms/inbound/' })).status, 403);
    assert.equal((await f.sms('20 2', { NumMedia: '1' })).status, 200); assert.equal((await f.dash()).totals.sessions, 0);
    delete f.env.TWILIO_AUTH_TOKEN; assert.equal((await f.sms()).status, 503);
    assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM sms_records').get() as any).n, 1);
  } finally { f.sqlite.close(); }
});
test('aggregate failure rolls back ledger so provider can safely retry', async () => {
  const f = fixture(); try {
    await f.mapping(); const MessageSid = 'SM' + '9'.repeat(32);
    f.sqlite.exec("CREATE TRIGGER test_aggregation_failure BEFORE INSERT ON sms_aggregates BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    assert.equal((await f.sms('20 2', { MessageSid })).status, 500); assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM sms_records').get() as any).n, 0);
    f.sqlite.exec('DROP TRIGGER test_aggregation_failure'); assert.equal((await f.sms('20 2', { MessageSid })).status, 200); assert.equal((await f.dash()).totals.sessions, 1);
  } finally { f.sqlite.close(); }
});
test('empty, duplicate form fields and streaming oversized requests do not enter ledger', async () => {
  const f = fixture(); try {
    await f.mapping();
    const params = new URLSearchParams({ AccountSid: ACCOUNT, To: f.env.TWILIO_PHONE_NUMBER!, From: PHONE, Body: '20 2', MessageSid: 'SM' + '1'.repeat(32) }); params.append('Body', '50 3');
    const result = await handleSmsApi(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sign(URL, params) }, body: params.toString() }), f.env); assert.equal(result.status, 403);
    const huge = await handleSmsApi(new Request(URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(25000) }), f.env); assert.equal(huge.status, 413);
    assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM sms_records').get() as any).n, 0);
  } finally { f.sqlite.close(); }
});

test('quarantine retry checks original snapshotted teacher even if phone is reused', async () => {
  const f = fixture(); try {
    const a = await f.mapping();
    await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Original', phone: PHONE, programId: a.programId, active: false });
    await f.sms(); const record = f.sqlite.prepare('SELECT * FROM sms_records').get() as any;
    await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Original', phone: '+14155550104', programId: a.programId, active: false });
    const second = await f.create('program', { name: 'Second', organizationId: a.organizationId });
    await f.create('teacher', { name: 'New holder', phone: PHONE, programId: second });
    assert.equal((await f.api('/api/sms/admin', { action: 'retry', id: record.id })).status, 409);
    assert.equal((await f.dash()).totals.sessions, 0);
    await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Original', phone: '+14155550104', programId: a.programId, active: true });
    assert.equal((await f.api('/api/sms/admin', { action: 'retry', id: record.id })).status, 200);
    const processed = f.sqlite.prepare('SELECT * FROM sms_records').get() as any; assert.equal(processed.teacher_id, a.teacherId); assert.equal(processed.program_id, a.programId);
  } finally { f.sqlite.close(); }
});
