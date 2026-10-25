import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSms, parseSmsCommand, parseSmsReversal, verifyTwilioSignature } from '../src/lib/sms';
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
  let transactions: Promise<unknown> = Promise.resolve();
  const env: SmsRuntime = { DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { const operation=transactions.then(async()=>{sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; } catch(error) { sqlite.exec('ROLLBACK'); throw error; }}); transactions=operation.catch(()=>{}); return operation; } } as unknown as D1Database, TPW_ADMIN_USER_IDS: 'tpw-admin', TWILIO_ACCOUNT_SID: ACCOUNT, TWILIO_AUTH_TOKEN: TOKEN, TWILIO_PHONE_NUMBER: '+14155550999', TWILIO_WEBHOOK_URL: URL };
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

test('activity reports enforce existing auth and expose only counted aggregate data', async () => {
  const f = fixture(); try {
    const m = await f.mapping(); await f.sms('20 2'); await f.sms('invalid');
    assert.equal((await f.api('/api/sms/report', undefined, null)).status, 401); assert.equal((await f.api('/api/sms/report', undefined, 'not-admin')).status, 403);
    const response = await f.api('/api/sms/report'); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
    const report = await response.json() as any; assert.equal(report.current.sessions, 1); assert.equal(report.current.attendees, 20); assert.equal(report.current.participantMinutes, 2400); assert.equal(report.current.averageAttendance, 20); assert.equal(report.coverage.completeness, 'unknown');
    assert.doesNotMatch(JSON.stringify(report), /senderPhone|sender_phone|"body"|14155550101|messageSid|teacherId|reprocessedBy/);
    const other = await f.mapping('+14155550102', 'Other');
    assert.equal((await f.api(`/api/sms/report?organizationId=${m.organizationId}&programId=${other.programId}`)).status, 400);
    assert.equal((await f.api('/api/sms/report?organizationId=11111111-1111-4111-8111-111111111111')).status, 400);
    assert.equal((await f.api('/api/sms/report?start=2026-99-01')).status, 400);
  } finally { f.sqlite.close(); }
});
test('report windows use original UTC receipt dates with inclusive end dates and equal prior periods', async () => {
  const f = fixture(); try {
    const a = await f.mapping(); const b = await f.mapping('+14155550102', 'Other'); let sequence = 0;
    const insert = (date: string, attendees: number, m = a, status = 'counted') => f.sqlite.prepare(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,teacher_id,organization_id,program_id,organization_name,program_name,attendees,session_minutes,received_at,processed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), 'SM' + (++sequence).toString(16).padStart(32, '0'), PHONE, `${attendees} 2`, status, m.teacherId, m.organizationId, m.programId, 'Synthetic Org', 'Synthetic Program', attendees, 120, date, status === 'counted' ? '2021-01-01T00:00:00.000Z' : null);
    insert('2020-09-30T23:59:59.999Z', 5); insert('2020-10-01T00:00:00.000Z', 20); insert('2020-10-14T23:59:59.999Z', 0); insert('2020-10-15T00:00:00.000Z', 99); insert('2020-10-05T12:00:00.000Z', 999, a, 'quarantined'); insert('2020-10-06T12:00:00.000Z', 10, b);
    await f.api('/api/sms/admin', { action: 'program', id: a.programId, organizationId: a.organizationId, name: 'Renamed historical program', active: false });
    const response = await f.api(`/api/sms/report?start=2020-10-01&end=2020-10-14&organizationId=${a.organizationId}&programId=${a.programId}`); assert.equal(response.status, 200);
    const r = await response.json() as any;
    assert.equal(r.current.sessions, 2); assert.equal(r.current.attendees, 20); assert.equal(r.current.sessionMinutes, 240); assert.equal(r.current.averageAttendance, 10); assert.equal(r.current.activeWeeks, 2);
    assert.equal(r.previous.start, '2020-09-17'); assert.equal(r.previous.end, '2020-09-30'); assert.equal(r.previous.sessions, 1); assert.equal(r.previous.attendees, 5);
    assert.equal(r.programActivity.length, 1); assert.equal(r.programActivity[0].name, 'Renamed historical program'); assert.equal(r.buckets.length, 3); assert.equal(r.buckets[1].sessions, 0);
  } finally { f.sqlite.close(); }
});

test('course-summary integration shares admin and origin boundaries without SMS counter changes', async () => {
  const f = fixture(); try {
    const m = await f.mapping(); await f.sms();
    const body = { id: crypto.randomUUID(), revision: 0, organizationId: m.organizationId, programId: m.programId, status: 'completed', participants: 20, completers: 15, courseHoursPerParticipant: 12 };
    for (const path of ['/api/sms/summaries']) { assert.equal((await f.api(path, undefined, null)).status, 401); assert.equal((await f.api(path, undefined, 'other')).status, 403); assert.equal((await f.api(path, body, null)).status, 401); }
    assert.equal((await f.api('/api/sms/summaries', body, 'tpw-admin', { origin: 'https://other.example' })).status, 403);
    assert.equal((await f.api('/api/sms/summaries', body, 'tpw-admin', { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await f.api('/api/sms/summaries', body)).status, 201); assert.equal((await f.api('/api/sms/summaries', body)).status, 200);
    assert.deepEqual((await f.dash()).totals, { sessions: 1, attendees: 20, sessionMinutes: 120, participantMinutes: 2400 });
    const report = await (await f.api('/api/sms/report')).json() as any; assert.equal(report.current.sessions, 1); assert.equal(report.current.attendees, 20);
    const saved = await (await f.api('/api/sms/summaries')).json() as any; assert.equal(saved.summaries.length, 1); assert.equal(saved.summaries[0].completers, 15); assert.equal(saved.summaries[0].source, 'Manual course summary'); assert.doesNotMatch(JSON.stringify(saved), /senderPhone|sender_phone|14155550101|teacherId|reprocessedBy/);
  } finally { f.sqlite.close(); }
});

async function course(f: ReturnType<typeof fixture>, mapping: { organizationId: string; programId: string }, extra: Record<string, unknown> = {}) {
  const input = { id: crypto.randomUUID(), revision: 0, organizationId: mapping.organizationId, programId: mapping.programId, status: 'in-progress', facility: 'Synthetic facility', yard: 'North', startDate: '2026-09-01', endDate: null, ...extra };
  const response = await f.api('/api/sms/summaries', input); assert.equal(response.status, 201, await response.clone().text());
  return (await response.json() as any).summary;
}
async function bindCourse(f: ReturnType<typeof fixture>, m: { teacherId: string; programId: string }, courseId: string | null, active = true) {
  return f.api('/api/sms/admin', { action: 'teacher', id: m.teacherId, name: 'Synthetic Teacher', phone: PHONE, programId: m.programId, courseId, active });
}
async function attendance(f: ReturnType<typeof fixture>, courseId: string) {
  const response = await f.api('/api/sms/course-attendance?courseId=' + courseId); assert.equal(response.status, 200, await response.clone().text()); return await response.json() as any;
}

test('additive course migration leaves all legacy teacher mappings, snapshots and totals unassigned and intact', () => {
  const db = new DatabaseSync(':memory:'); try {
    const migrations = readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort();
    for (const file of migrations.filter(name => name < '0004')) db.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
    db.exec(`INSERT INTO sms_organizations VALUES('org','Before','before',1,'now','now');
      INSERT INTO sms_programs VALUES('program','org','Before',1,'now','now');
      INSERT INTO sms_teachers VALUES('teacher','+12025550101','Before','program',1,'now','now');
      INSERT INTO sms_records(id,message_sid,sender_phone,body,status,teacher_id,organization_id,program_id,organization_name,program_name,attendees,session_minutes,received_at,processed_at)
      VALUES('record','SMold','+12025550101','20 2','counted','teacher','org','program','Before','Before',20,120,'2026-10-24','2026-10-24');`);
    const before = db.prepare('SELECT * FROM sms_aggregates').get();
    db.exec(readFileSync(resolve('drizzle', migrations.find(name => name.startsWith('0004'))!), 'utf8').replaceAll('--> statement-breakpoint', ''));
    assert.equal((db.prepare('SELECT course_id FROM sms_teachers').get() as any).course_id, null);
    assert.equal((db.prepare('SELECT course_id,course_snapshot_json FROM sms_records').get() as any).course_id, null);
    assert.deepEqual(db.prepare('SELECT * FROM sms_aggregates').get(), before);
    assert.throws(() => db.prepare("UPDATE sms_records SET course_id='invented' WHERE id='record'").run(), /immutable|backfilled|Invalid SMS course snapshot/);
  } finally { db.close(); }
});

test('explicit course binding adds counted points including zero without backfilling legacy activity', async () => {
  const f = fixture(); try {
    const m = await f.mapping(); const c = await course(f, { organizationId: m.organizationId, programId: m.programId });
    await f.sms('20 2'); assert.equal((await attendance(f, c.id)).points.length, 0);
    assert.equal((await bindCourse(f, m, c.id)).status, 200);
    const MessageSid = 'SM' + 'b'.repeat(32);
    await Promise.all([f.sms('31 3', { MessageSid }), f.sms('31 3', { MessageSid })]); await f.sms('0 0.25');
    const data = await attendance(f, c.id);
    assert.equal(data.points.length, 2); assert.deepEqual(data.points.map((p: any) => p.attendees).sort((a: number,b: number) => a-b), [0,31]);
    assert.deepEqual(data.points.map((p: any) => p.sequence), [1,2]); assert.equal(data.sequenceBasis, 'receipt-order');
    assert.deepEqual(data.totals, { sessions: 2, attendees: 31, sessionMinutes: 195, participantMinutes: 5580 });
    assert.deepEqual((await f.dash()).totals, { sessions: 3, attendees: 51, sessionMinutes: 315, participantMinutes: 7980 });
    assert.deepEqual((await f.dash(m.organizationId)).totals, (await f.dash()).totals);
    assert.equal(data.points[0].courseSnapshot.id, c.id); assert.equal(data.points[0].courseSnapshot.yard, 'North');
    assert.doesNotMatch(JSON.stringify(data), /senderPhone|sender_phone|"body"|messageSid|teacherId|14155550101|Synthetic Teacher/);
    const admin = await (await f.api('/api/sms/admin')).json() as any;
    assert.equal(admin.teachers[0].courseId, c.id); assert.equal(admin.courses[0].id, c.id);
  } finally { f.sqlite.close(); }
});

test('course binding validates existence and program/org, preserves omitted mapping, and permits explicit unbind', async () => {
  const f = fixture(); try {
    const a = await f.mapping(); const b = await f.mapping('+12025550102', ' B');
    const ca = await course(f, { organizationId: a.organizationId, programId: a.programId });
    const cb = await course(f, { organizationId: b.organizationId, programId: b.programId });
    assert.equal((await bindCourse(f, a, cb.id)).status, 409); assert.equal((await bindCourse(f, a, crypto.randomUUID())).status, 409);
    assert.equal((await bindCourse(f, a, ca.id)).status, 200);
    assert.equal((await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Rename only', phone: PHONE, programId: a.programId })).status, 200);
    assert.equal((f.sqlite.prepare('SELECT course_id FROM sms_teachers WHERE id=?').get(a.teacherId) as any).course_id, ca.id);
    assert.equal((await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Move', phone: PHONE, programId: b.programId })).status, 409);
    assert.equal((await f.api('/api/sms/admin', { action: 'teacher', id: a.teacherId, name: 'Move explicitly', phone: PHONE, programId: b.programId, courseId: null })).status, 200);
    await f.sms('3 1'); assert.equal((await attendance(f, ca.id)).totals.sessions, 0); assert.equal((await f.dash(b.organizationId)).totals.sessions, 1);
    assert.throws(() => f.sqlite.prepare('UPDATE sms_teachers SET course_id=? WHERE id=?').run(ca.id, a.teacherId), /must match/);
  } finally { f.sqlite.close(); }
});

test('counted course snapshots survive names, site edits and phone rebinds; referenced parents cannot move', async () => {
  const f = fixture(); try {
    const m = await f.mapping(); const c = await course(f, { organizationId: m.organizationId, programId: m.programId });
    const c2 = await course(f, { organizationId: m.organizationId, programId: m.programId }, { yard: 'South' });
    await bindCourse(f,m,c.id); const MessageSid = 'SM'+'c'.repeat(32); await f.sms('7 1.5',{MessageSid});
    const original = (await attendance(f,c.id)).points[0].courseSnapshot;
    const write = { id: c.id, revision: c.revision, organizationId: c.organizationId, programId: c.programId, status: c.status, yard: 'Renamed', facility: 'Updated', startDate: '2026-09-02' };
    assert.equal((await f.api('/api/sms/summaries',write)).status,200);
    await f.api('/api/sms/admin',{action:'organization',id:m.organizationId,name:'New org name'});
    await bindCourse(f,m,c2.id); await f.sms('7 1.5',{MessageSid}); await f.sms('4 1');
    assert.deepEqual((await attendance(f,c.id)).points[0].courseSnapshot,original);
    assert.equal((await attendance(f,c.id)).course.yard,'Renamed'); assert.equal((await attendance(f,c2.id)).totals.attendees,4);
    const p2 = await f.create('program',{organizationId:m.organizationId,name:'Other program'});
    const move = await f.api('/api/sms/summaries',{...write,revision:2,programId:p2}); assert.equal(move.status,409); assert.equal((await move.json() as any).code,'COURSE_PARENT_FIXED');
    assert.throws(()=>f.sqlite.prepare('UPDATE course_summaries SET program_id=? WHERE id=?').run(p2,c.id),/original organization/);
    assert.throws(()=>f.sqlite.prepare("UPDATE sms_records SET course_snapshot_json='{}' WHERE course_id=?").run(c.id),/immutable|Invalid SMS course snapshot/);
    const total = (await f.dash()).totals; assert.equal(total.sessions,2); assert.equal(total.attendees,11);
  } finally { f.sqlite.close(); }
});

test('disabled mappings quarantine and explicit retry retains original course; unknown legacy retries remain unassigned', async () => {
  const f = fixture(); try {
    await f.sms('1 1'); const unknown = f.sqlite.prepare('SELECT * FROM sms_records').get() as any;
    const m=await f.mapping(); const c=await course(f,{organizationId:m.organizationId,programId:m.programId}); const c2=await course(f,{organizationId:m.organizationId,programId:m.programId},{yard:'South'});
    await bindCourse(f,m,c.id,false); await f.sms('0 0.25');
    const inactive=f.sqlite.prepare("SELECT * FROM sms_records WHERE reason='INACTIVE_SENDER'").get() as any;
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:inactive.id})).status,409);
    await bindCourse(f,m,c2.id,true);
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:inactive.id})).status,200);
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:inactive.id})).status,200);
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:unknown.id})).status,200);
    const data=await attendance(f,c.id); assert.equal(data.points.length,1); assert.equal(data.points[0].attendees,0); assert.equal(data.points[0].courseSnapshot.yard,'North');
    assert.equal((await attendance(f,c2.id)).totals.sessions,0);
    assert.equal((f.sqlite.prepare('SELECT course_id FROM sms_records WHERE id=?').get(unknown.id) as any).course_id,null);
    assert.equal((await f.dash()).totals.sessions,2);
    await f.api('/api/sms/admin',{action:'program',id:m.programId,organizationId:m.organizationId,name:'Off',active:false});
    await f.sms('8 1'); assert.equal((await f.dash()).totals.sessions,2); assert.equal((await attendance(f,c2.id)).points.length,0);
    assert.equal((await bindCourse(f,m,c2.id,true)).status,409);
  } finally { f.sqlite.close(); }
});

test('stale or cross-organization course mappings quarantine safely without counters or course points', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,{organizationId:m.organizationId,programId:m.programId}); await bindCourse(f,m,c.id);
    // Model an externally corrupted/stale legacy binding, not a permitted API write.
    f.sqlite.exec('DROP TRIGGER sms_teacher_course_update; PRAGMA foreign_keys=OFF');
    f.sqlite.prepare('UPDATE sms_teachers SET course_id=? WHERE id=?').run(crypto.randomUUID(),m.teacherId);
    assert.equal((await f.sms('9 1')).status,200); assert.equal((await f.dash()).totals.sessions,0);
    const r=f.sqlite.prepare('SELECT * FROM sms_records').get() as any; assert.equal(r.reason,'INVALID_COURSE');
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:r.id})).status,409);
    assert.equal((await attendance(f,c.id)).points.length,0);
  } finally { f.sqlite.close(); }
});

test('course attendance is read-only, private, strictly scoped and uses receipt order instead of processing or class dates', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,{organizationId:m.organizationId,programId:m.programId}); await bindCourse(f,m,c.id);
    const path='/api/sms/course-attendance?courseId='+c.id;
    assert.equal((await f.api(path,undefined,null)).status,401); assert.equal((await f.api(path,undefined,'other')).status,403);
    assert.equal((await f.api(path,{})).status,405);
    for(const query of ['', '?courseId=bad', '?courseId='+c.id+'&courseId='+c.id, '?courseId='+c.id+'&unexpected=yes']) assert.equal((await f.api('/api/sms/course-attendance'+query)).status,400);
    assert.equal((await f.api(path+'&organizationId='+crypto.randomUUID())).status,404); assert.equal((await f.api(path+'&programId='+crypto.randomUUID())).status,404);
    assert.equal((await f.api('/api/sms/course-attendance?courseId='+crypto.randomUUID())).status,404);
    const snapshot={id:c.id,organizationId:m.organizationId,programId:m.programId,organizationName:'Synthetic Org',programName:'Synthetic Program',facility:c.facility,yard:c.yard,startDate:c.startDate,endDate:c.endDate};
    const insert=f.sqlite.prepare(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,teacher_id,organization_id,program_id,organization_name,program_name,course_id,course_snapshot_json,attendees,session_minutes,received_at,processed_at)
      VALUES(?,?,?,'1 1','counted',?,?,?,'Synthetic Org','Synthetic Program',?,?,?,60,?,?)`);
    for (let i=0;i<1002;i++) insert.run('row-'+String(i).padStart(4,'0'),'SM'+i.toString(16).padStart(32,'0'),PHONE,m.teacherId,m.organizationId,m.programId,c.id,JSON.stringify(snapshot),i===0?99:1,new Date(Date.UTC(2026,9,1,0,0,i)).toISOString(),new Date(Date.UTC(2026,9,2,0,0,1002-i)).toISOString());
    const response=await f.api(path); assert.match(response.headers.get('cache-control')! ,/private, no-store/);
    const data=await response.json() as any; assert.equal(data.truncated,true); assert.equal(data.points.length,1000); assert.equal(data.totals.sessions,1002); assert.deepEqual(data.participantEstimate,{value:99,source:'sms-maximum'}); assert.equal(Math.max(...data.points.map((p:any)=>p.attendees)),1);
    assert.equal(data.points[0].sequence,3); assert.equal(data.points.at(-1).sequence,1002);
    assert.ok(data.points[0].receivedAt<data.points.at(-1).receivedAt); assert.ok(data.points[0].processedAt>data.points.at(-1).processedAt);
    assert.equal(data.points[0].courseSnapshot.startDate,'2026-09-01');
  } finally { f.sqlite.close(); }
});

test('unknown-sender recovery rejects a newly stale current course mapping without backfilling course identity', async () => {
  const f=fixture(); try {
    await f.sms('2 1'); const row=f.sqlite.prepare('SELECT id FROM sms_records').get() as any;
    const m=await f.mapping(); const c=await course(f,{organizationId:m.organizationId,programId:m.programId});
    f.sqlite.exec('DROP TRIGGER sms_teacher_course_update; PRAGMA foreign_keys=OFF');
    f.sqlite.prepare('UPDATE sms_teachers SET course_id=? WHERE id=?').run(crypto.randomUUID(),m.teacherId);
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:row.id})).status,409); assert.equal((await f.dash()).totals.sessions,0);
    f.sqlite.prepare('UPDATE sms_teachers SET course_id=? WHERE id=?').run(c.id,m.teacherId);
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:row.id})).status,200);
    assert.equal((await attendance(f,c.id)).points.length,0); assert.equal((await f.dash()).totals.attendees,2);
  } finally { f.sqlite.close(); }
});

test('SMS repeat command is exactly trimmed 1, never guessed numbers or changed numeric limits', () => {
  for (const body of ['1', ' 1\n', '\t1\t', '\u00a01\u00a0']) assert.deepEqual(parseSmsCommand(body), { ok: true, kind: 'repeat' });
  for (const body of ['01', '+1', '1.0', '1 1 1', '１', 'repeat', '1\n1', ' '.repeat(1600) + '1']) assert.equal(parseSmsCommand(body).ok, false, body);
  assert.deepEqual(parseSmsCommand('0 0.25'), { ok: true, kind: 'numeric', metrics: { attendees: 0, sessionMinutes: 15 } });
  assert.equal(parseSms('1').ok, false, 'numeric parser never invents metrics for a repeat');
});

test('each new 1 creates a new session from latest accepted same-sender course values with auditable immutable provenance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 25, 4, 0) });
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m,{participants:999,courseHoursPerParticipant:99}); await bindCourse(f,m,c.id);
    await f.sms('20 2'); await f.sms(' \t1\n'); await f.sms('7 0.75'); await f.sms('1'); await f.sms('1');
    const records=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY accepted_order').all() as any[];
    assert.deepEqual(records.map(r=>[r.attendees,r.session_minutes,r.accepted_order]),[[20,120,1],[20,120,2],[7,45,3],[7,45,4],[7,45,5]]);
    assert.equal(records[1].body,' \t1\n'); assert.equal(records[1].repeated_from_record_id,records[0].id);
    assert.equal(records[3].repeated_from_record_id,records[2].id); assert.equal(records[4].repeated_from_record_id,records[3].id);
    assert.equal(records[0].repeated_from_record_id,null); assert.ok(records.every(r=>r.course_id===c.id));
    const expected={sessions:5,attendees:61,sessionMinutes:375,participantMinutes:5745};
    assert.deepEqual((await f.dash()).totals,expected); assert.deepEqual((await attendance(f,c.id)).totals,expected);
    const report=await(await f.api('/api/sms/report')).json() as any; assert.equal(report.current.sessions,5); assert.equal(report.current.participantMinutes,5745);
    const admin=await(await f.api('/api/sms/admin')).json() as any; assert.equal(admin.records.find((r:any)=>r.id===records[4].id).repeatedFromRecordId,records[3].id);
    const points=(await attendance(f,c.id)).points; assert.equal(points.find((r:any)=>r.id===records[4].id).repeatedFromRecordId,records[3].id);
    for(const sql of ['UPDATE sms_records SET repeated_from_record_id=NULL WHERE id=?','UPDATE sms_records SET attendees=9 WHERE id=?','UPDATE sms_records SET accepted_order=999 WHERE id=?']) assert.throws(()=>f.sqlite.prepare(sql).run(records[4].id),/immutable|Invalid SMS repeat/);
  } finally { f.sqlite.close(); }
});

test('repeat baseline is scoped to sender and current concrete course, never metadata, another teacher or previous course', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c1=await course(f,m,{participants:25,courseHoursPerParticipant:12}); const c2=await course(f,m,{yard:'South'});
    await f.sms('99 9'); await f.sms('1');
    assert.equal((f.sqlite.prepare('SELECT reason FROM sms_records ORDER BY rowid DESC LIMIT 1').get() as any).reason,'REPEAT_BASELINE_REQUIRED');
    await bindCourse(f,m,c1.id); await f.sms('1'); assert.equal((await attendance(f,c1.id)).totals.sessions,0);
    const teacher2=await f.create('teacher',{name:'Other teacher',phone:'+12025550102',programId:m.programId,courseId:c1.id}); assert.ok(teacher2);
    await f.sms('88 8',{From:'+12025550102'}); await f.sms('1'); assert.equal((await attendance(f,c1.id)).totals.sessions,1);
    await f.sms('6 0.5'); await f.sms('1'); assert.equal((await attendance(f,c1.id)).totals.attendees,100);
    await bindCourse(f,m,c2.id); await f.sms('1'); assert.equal((await attendance(f,c2.id)).totals.sessions,0);
    await f.sms('3 1'); await f.sms('1'); assert.equal((await attendance(f,c2.id)).totals.attendees,6);
    const quarantines=f.sqlite.prepare("SELECT * FROM sms_records WHERE status='quarantined'").all() as any[];
    assert.equal(quarantines.length,4); assert.ok(quarantines.every(r=>r.reason==='REPEAT_BASELINE_REQUIRED' && r.attendees===null && r.repeated_from_record_id===null));
    assert.equal((await f.dash()).totals.sessions,6);
  } finally { f.sqlite.close(); }
});

test('zero attendance is a valid repeat baseline and all three totals stay correct', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m); await bindCourse(f,m,c.id);
    await f.sms('0 0.25'); await f.sms('1'); await f.sms('1');
    const expected={sessions:3,attendees:0,sessionMinutes:45,participantMinutes:0};
    assert.deepEqual((await f.dash()).totals,expected); assert.deepEqual((await f.dash(m.organizationId)).totals,expected); assert.deepEqual((await attendance(f,c.id)).totals,expected);
  } finally { f.sqlite.close(); }
});

test('concurrent new repeat SIDs serialize baseline selection and acceptance order; duplicate providers count once', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,25,4,0)});
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m); await bindCourse(f,m,c.id); await f.sms('2 1.5');
    const responses=await Promise.all(Array.from({length:20},()=>f.sms('1'))); assert.ok(responses.every(r=>r.status===200));
    const MessageSid='SM'+'d'.repeat(32);
    await Promise.all(Array.from({length:20},()=>f.sms('1',{MessageSid})));
    const rows=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY accepted_order').all() as any[];
    assert.equal(rows.length,22); assert.equal(new Set(rows.map(r=>r.accepted_order)).size,22);
    for(let i=1;i<rows.length;i++) assert.equal(rows[i].repeated_from_record_id,rows[i-1].id,'serialized accepted source');
    assert.deepEqual((await f.dash()).totals,{sessions:22,attendees:44,sessionMinutes:1980,participantMinutes:3960});
    const last=rows.at(-1); const c2=await course(f,m,{yard:'Moved'}); await bindCourse(f,m,c2.id);
    await f.sms('99 9',{MessageSid}); assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records WHERE message_sid=?').get(MessageSid),last);
    assert.equal((await attendance(f,c.id)).totals.sessions,22); assert.equal((await attendance(f,c2.id)).totals.sessions,0);
  } finally { f.sqlite.close(); }
});

test('no-baseline repeats and legacy invalid 1 stay quarantined even after new numeric reports, bindings or provider/admin retry', async () => {
  const f=fixture(); try {
    const unknownSid='SM'+'a'.repeat(32); await f.sms('1',{MessageSid:unknownSid});
    const m=await f.mapping(); const c=await course(f,m); await bindCourse(f,m,c.id);
    const missingSid='SM'+'b'.repeat(32); await f.sms('1',{MessageSid:missingSid});
    const unknown=f.sqlite.prepare('SELECT * FROM sms_records WHERE message_sid=?').get(unknownSid) as any;
    const missing=f.sqlite.prepare('SELECT * FROM sms_records WHERE message_sid=?').get(missingSid) as any;
    const legacy=crypto.randomUUID(); f.sqlite.prepare("INSERT INTO sms_records(id,message_sid,sender_phone,body,status,reason,received_at) VALUES(?,?,?,'1','quarantined','INVALID_BODY',?)").run(legacy,'SM'+'c'.repeat(32),PHONE,'2026-10-24T00:00:00.000Z');
    await f.sms('8 2'); await f.sms('1',{MessageSid:unknownSid}); await f.sms('1',{MessageSid:missingSid});
    for(const id of [unknown.id,missing.id,legacy]) {const response=await f.api('/api/sms/admin',{action:'retry',id}); assert.equal(response.status,409); assert.equal((await response.json() as any).code,'REPEAT_BASELINE_REQUIRED');}
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(unknown.id),unknown);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(missing.id),missing);
    assert.equal((await f.dash()).totals.sessions,1); await f.sms('1'); assert.equal((await f.dash()).totals.sessions,2);
  } finally { f.sqlite.close(); }
});

test('inactive repeats pin original resolved values/source/course and explicit retry never uses newer baseline or new course', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m); const c2=await course(f,m,{yard:'Moved'}); await bindCourse(f,m,c.id);
    await f.sms('4 1'); const baseline=f.sqlite.prepare('SELECT * FROM sms_records').get() as any;
    await bindCourse(f,m,c.id,false); await f.sms('1'); const pending=f.sqlite.prepare("SELECT * FROM sms_records WHERE status='quarantined'").get() as any;
    assert.equal(pending.reason,'INACTIVE_SENDER'); assert.equal(pending.repeated_from_record_id,baseline.id); assert.equal(pending.attendees,4);
    assert.equal((await f.api('/api/sms/admin',{action:'retry',id:pending.id})).status,409);
    for(const sql of ['UPDATE sms_records SET repeated_from_record_id=NULL WHERE id=?','UPDATE sms_records SET attendees=99 WHERE id=?','UPDATE sms_records SET session_minutes=120 WHERE id=?']) assert.throws(()=>f.sqlite.prepare(sql).run(pending.id),/immutable|Invalid SMS repeat/);
    await bindCourse(f,m,c.id,true); await f.sms('9 2'); await bindCourse(f,m,c2.id); await f.sms('6 3');
    const responses=await Promise.all([f.api('/api/sms/admin',{action:'retry',id:pending.id}),f.api('/api/sms/admin',{action:'retry',id:pending.id})]); assert.ok(responses.every(r=>r.status===200));
    const saved=f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(pending.id) as any;
    assert.equal(saved.status,'counted'); assert.equal(saved.attendees,4); assert.equal(saved.session_minutes,60); assert.equal(saved.repeated_from_record_id,baseline.id);
    assert.equal(saved.course_id,c.id); assert.equal(saved.course_snapshot_json,pending.course_snapshot_json); assert.equal(saved.accepted_order,4); assert.equal(saved.body,'1');
    assert.deepEqual((await attendance(f,c.id)).totals,{sessions:3,attendees:17,sessionMinutes:240,participantMinutes:1560});
    assert.deepEqual((await attendance(f,c2.id)).totals,{sessions:1,attendees:6,sessionMinutes:180,participantMinutes:1080});
    await f.sms('1'); assert.equal((await attendance(f,c2.id)).totals.attendees,12);
  } finally { f.sqlite.close(); }
});

test('repeat uses current receipt course snapshot but never mutates its source history after metadata edits', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m); await bindCourse(f,m,c.id); await f.sms('5 1');
    const before=f.sqlite.prepare('SELECT * FROM sms_records').get() as any;
    assert.equal((await f.api('/api/sms/summaries',{id:c.id,revision:c.revision,organizationId:m.organizationId,programId:m.programId,status:c.status,facility:'Updated facility',yard:'New yard'})).status,200);
    await f.sms('1'); const after=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY accepted_order DESC LIMIT 1').get() as any;
    assert.equal(JSON.parse(before.course_snapshot_json).yard,'North'); assert.equal(JSON.parse(after.course_snapshot_json).yard,'New yard'); assert.equal(after.repeated_from_record_id,before.id);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(before.id),before);
  } finally { f.sqlite.close(); }
});

test('repeat keeps signature/account/destination/media boundaries and atomic rollback behavior', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m); await bindCourse(f,m,c.id); await f.sms('3 1');
    assert.equal((await f.sms('1',{}, {signature:'invalid'})).status,403);
    assert.equal((await f.sms('1',{AccountSid:'AC'+'b'.repeat(32)})).status,403);
    assert.equal((await f.sms('1',{To:'+14155550888'})).status,403);
    await f.sms('1',{NumMedia:'1'}); assert.equal((f.sqlite.prepare("SELECT reason FROM sms_records WHERE status='quarantined'").get() as any).reason,'INVALID_BODY');
    const MessageSid='SM'+'e'.repeat(32);
    f.sqlite.exec("CREATE TRIGGER reject_repeat AFTER INSERT ON sms_records WHEN NEW.status='counted' AND NEW.repeated_from_record_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    assert.equal((await f.sms('1',{MessageSid})).status,500); assert.equal(f.sqlite.prepare('SELECT id FROM sms_records WHERE message_sid=?').get(MessageSid),undefined); assert.equal((await f.dash()).totals.sessions,1);
    f.sqlite.exec('DROP TRIGGER reject_repeat'); assert.equal((await f.sms('1',{MessageSid})).status,200); assert.equal((await f.dash()).totals.sessions,2);
  } finally { f.sqlite.close(); }
});

test('additive repeat migration leaves legacy numeric/quarantined records and aggregate counters byte-for-byte intact', () => {
  const db=new DatabaseSync(':memory:'); try {
    for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql') && name<'0005').sort()) db.exec(readFileSync(resolve('drizzle',file),'utf8').replaceAll('--> statement-breakpoint',''));
    db.exec(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,reason,received_at) VALUES('legacy-one','SMold','+12025550101','1','quarantined','INVALID_BODY','2026-10-24');`);
    const before=db.prepare('SELECT * FROM sms_records').get() as any; const totals=db.prepare('SELECT * FROM sms_aggregates').all();
    db.exec(readFileSync('drizzle/0005_sms_repeat_shortcut.sql','utf8').replaceAll('--> statement-breakpoint',''));
    const after=db.prepare('SELECT * FROM sms_records').get() as any; assert.equal(after.repeated_from_record_id,null); assert.equal(after.accepted_order,null);
    assert.equal(after.manual_correction_json,null); delete after.manual_correction_json; delete after.repeated_from_record_id; delete after.accepted_order; assert.deepEqual(after,before); assert.deepEqual(db.prepare('SELECT * FROM sms_aggregates').all(),totals);
  } finally { db.close(); }
});

test('explicit admin corrections count old 1 quarantines once with immutable original history and separate manual audit', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m); await bindCourse(f,m,c.id);
    await f.sms('1'); const first=f.sqlite.prepare('SELECT * FROM sms_records').get() as any;
    await f.sms('15 4');
    // Model a pre-upgrade invalid 1, without resolving or backfilling history.
    const second={...first,id:crypto.randomUUID(),message_sid:'SM'+'f'.repeat(32),reason:'INVALID_BODY',received_at:'2026-10-25T04:05:36.174Z'};
    f.sqlite.prepare(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,reason,teacher_id,organization_id,program_id,organization_name,program_name,course_id,course_snapshot_json,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...['id','message_sid','sender_phone','body','status','reason','teacher_id','organization_id','program_id','organization_name','program_name','course_id','course_snapshot_json','received_at'].map(key=>second[key]));
    const adminBefore=await(await f.api('/api/sms/admin')).json() as any; assert.equal(adminBefore.records.find((r:any)=>r.id===first.id).canCorrect,true);
    for(const [record,attendees] of [[first,16],[second,15]] as const) {
      const body={action:'correct',id:record.id,attendees,hours:4,reason:'User explicitly confirmed the attendance and duration.'};
      const responses=await Promise.all([f.api('/api/sms/admin',body),f.api('/api/sms/admin',body)]); assert.ok(responses.every(r=>r.status===200));
      const saved=f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(record.id) as any;
      for(const key of ['id','message_sid','sender_phone','body','received_at','teacher_id','organization_id','program_id','organization_name','program_name','course_id','course_snapshot_json']) assert.equal(saved[key],record[key],key);
      assert.equal(saved.status,'counted'); assert.equal(saved.attendees,attendees); assert.equal(saved.session_minutes,240); assert.equal(saved.repeated_from_record_id,null);
      const audit=JSON.parse(saved.manual_correction_json); assert.deepEqual(audit,{source:'manual',correctedBy:'tpw-admin',correctedAt:saved.processed_at,reason:body.reason,originalReason:record.reason,attendees,sessionMinutes:240});
      assert.equal((await f.api('/api/sms/admin',{...body,attendees:99})).status,409);
      assert.equal((await f.api('/api/sms/admin',{action:'retry',id:record.id})).status,200);
      await f.sms('1',{MessageSid:record.message_sid}); assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(record.id),saved);
      assert.throws(()=>f.sqlite.prepare("UPDATE sms_records SET manual_correction_json='{}' WHERE id=?").run(record.id),/immutable|Invalid/);
    }
    const expected={sessions:3,attendees:46,sessionMinutes:720,participantMinutes:11040};
    assert.deepEqual((await f.dash()).totals,expected); assert.deepEqual((await f.dash(m.organizationId)).totals,expected); assert.deepEqual((await attendance(f,c.id)).totals,expected);
    const adminAfter=await(await f.api('/api/sms/admin')).json() as any; assert.equal(adminAfter.records.find((r:any)=>r.id===second.id).manualCorrection.attendees,15); assert.equal(adminAfter.records.find((r:any)=>r.id===second.id).canCorrect,false);
    await f.sms('1'); const latest=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY accepted_order DESC LIMIT 1').get() as any;
    assert.equal(latest.repeated_from_record_id,second.id); assert.equal(latest.attendees,15); assert.equal(latest.session_minutes,240); assert.equal((await f.dash()).totals.sessions,4);
  } finally { f.sqlite.close(); }
});

test('manual correction validates metrics/reason/auth and cannot invent attribution or rewrite resolved repeats', async () => {
  const f=fixture(); try {
    await f.sms('invalid'); const unknown=f.sqlite.prepare('SELECT * FROM sms_records').get() as any;
    const m=await f.mapping(); const c=await course(f,m); await bindCourse(f,m,c.id); await f.sms('invalid');
    const row=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY rowid DESC LIMIT 1').get() as any;
    const valid={action:'correct',id:row.id,attendees:0,hours:0.25,reason:'Teacher confirmed.'};
    assert.equal((await f.api('/api/sms/admin',valid,null)).status,401); assert.equal((await f.api('/api/sms/admin',valid,'other')).status,403);
    assert.equal((await f.api('/api/sms/admin',valid,'tpw-admin',{origin:'https://other.example'})).status,403);
    for(const bad of [{attendees:-1},{attendees:10001},{attendees:1.5},{attendees:'16'},{hours:0},{hours:24.25},{hours:1.1},{reason:''},{reason:' '.repeat(5)},{reason:'a'.repeat(501)},{reason:'two\nlines'},{courseId:crypto.randomUUID()}]) assert.equal((await f.api('/api/sms/admin',{...valid,...bad})).status,400,JSON.stringify(bad));
    assert.equal((await f.api('/api/sms/admin',{...valid,id:unknown.id})).status,409);
    await bindCourse(f,m,c.id,false); assert.equal((await f.api('/api/sms/admin',valid)).status,409); await bindCourse(f,m,c.id,true);
    assert.equal((await f.api('/api/sms/admin',valid)).status,200); assert.deepEqual((await f.dash()).totals,{sessions:1,attendees:0,sessionMinutes:15,participantMinutes:0});
    await bindCourse(f,m,c.id,false); await f.sms('1'); const resolved=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY rowid DESC LIMIT 1').get() as any;
    assert.ok(resolved.repeated_from_record_id); await bindCourse(f,m,c.id,true); assert.equal((await f.api('/api/sms/admin',{...valid,id:resolved.id})).status,409);
    assert.equal((await f.dash()).totals.sessions,1);
  } finally { f.sqlite.close(); }
});

test('manual correction preserves original course after rebind and rolls back atomically on aggregate failure', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m); const next=await course(f,m,{yard:'New binding'}); await bindCourse(f,m,c.id); await f.sms('1');
    const row=f.sqlite.prepare('SELECT * FROM sms_records').get() as any; await bindCourse(f,m,next.id);
    const body={action:'correct',id:row.id,attendees:16,hours:4,reason:'Explicit correction for this original course.'};
    f.sqlite.exec("CREATE TRIGGER reject_correction BEFORE UPDATE ON sms_records WHEN NEW.manual_correction_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    assert.equal((await f.api('/api/sms/admin',body)).status,500); assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(row.id),row); assert.equal((await f.dash()).totals.sessions,0);
    f.sqlite.exec('DROP TRIGGER reject_correction'); assert.equal((await f.api('/api/sms/admin',body)).status,200);
    assert.equal((await attendance(f,c.id)).totals.attendees,16); assert.equal((await attendance(f,next.id)).totals.sessions,0);
    await f.sms('1'); assert.equal((await attendance(f,next.id)).totals.sessions,0);
  } finally { f.sqlite.close(); }
});

test('unbound course estimates sum across all statuses and correct organization/program scope without changing actual counters', async () => {
  const f=fixture(); try {
    const a=await f.mapping(); const b=await f.mapping('+12025550102',' Other');
    await course(f,a,{status:'planned',participants:20,completers:15,courseHoursPerParticipant:4});
    await course(f,a,{status:'in-progress',participants:10,courseHoursPerParticipant:1.5});
    await course(f,b,{status:'completed',participants:7,courseHoursPerParticipant:3});
    const aDash=await f.dash(a.organizationId); const bDash=await f.dash(b.organizationId); const all=await f.dash();
    assert.deepEqual(aDash.serviceEstimate,{participantHours:95,courseCount:2,missingValuesCount:0});
    assert.deepEqual(bDash.serviceEstimate,{participantHours:21,courseCount:1,missingValuesCount:0});
    assert.deepEqual(all.serviceEstimate,{participantHours:116,courseCount:3,missingValuesCount:0});
    assert.deepEqual(all.organizations.find((o:any)=>o.id===a.organizationId).serviceEstimate,aDash.serviceEstimate);
    assert.deepEqual(all.programs.find((p:any)=>p.id===b.programId).serviceEstimate,bDash.serviceEstimate);
    assert.deepEqual(all.totals,{sessions:0,attendees:0,sessionMinutes:0,participantMinutes:0});
    const scoped=await(await f.api('/api/sms/summaries?organizationId='+a.organizationId)).json() as any;
    assert.equal(scoped.summaries.length,2); assert.deepEqual(scoped.serviceEstimate,aDash.serviceEstimate);
    assert.ok(scoped.summaries.every((c:any)=>c.serviceEstimate.hasPhoneBinding===false));
    const report=await(await f.api('/api/sms/report')).json() as any; assert.equal(report.current.participantMinutes,0); assert.equal(report.serviceEstimate,undefined);
  } finally { f.sqlite.close(); }
});

test('any existing course phone binding, including disabled or duplicate bindings, excludes estimates until truly unbound', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m,{participants:20,courseHoursPerParticipant:4});
    await bindCourse(f,m,c.id); const second=await f.create('teacher',{name:'Second',phone:'+12025550102',programId:m.programId,courseId:c.id});
    assert.deepEqual((await f.dash()).serviceEstimate,{participantHours:0,courseCount:0,missingValuesCount:0});
    await bindCourse(f,m,c.id,false);
    await f.api('/api/sms/admin',{action:'teacher',id:second,name:'Second',phone:'+12025550102',programId:m.programId,courseId:c.id,active:false});
    assert.deepEqual((await f.dash()).serviceEstimate,{participantHours:0,courseCount:0,missingValuesCount:0});
    const scoped=await(await f.api('/api/sms/summaries')).json() as any; assert.deepEqual(scoped.summaries[0].serviceEstimate,{hasPhoneBinding:true,participantHours:null});
    const updated=await f.api('/api/sms/summaries',{id:c.id,revision:1,organizationId:m.organizationId,programId:m.programId,status:c.status,participants:25,courseHoursPerParticipant:4});
    assert.equal(updated.status,200); assert.deepEqual((await updated.json() as any).summary.serviceEstimate,{hasPhoneBinding:true,participantHours:null});
    await bindCourse(f,m,null); assert.equal((await f.dash()).serviceEstimate.courseCount,0);
    await f.api('/api/sms/admin',{action:'teacher',id:second,name:'Second',phone:'+12025550102',programId:m.programId,courseId:null,active:false});
    assert.deepEqual((await f.dash()).serviceEstimate,{participantHours:100,courseCount:1,missingValuesCount:0});
    await f.api('/api/sms/admin',{action:'organization',id:m.organizationId,name:'Archived',active:false});
    await f.api('/api/sms/admin',{action:'program',id:m.programId,organizationId:m.organizationId,name:'Archived',active:false});
    assert.deepEqual((await f.dash()).serviceEstimate,{participantHours:100,courseCount:1,missingValuesCount:0},'archiving does not silently remove configured estimates');
  } finally { f.sqlite.close(); }
});

test('unbound estimate coverage treats known zero, partial values and wholly missing inputs distinctly', async () => {
  const f=fixture(); try {
    const m=await f.mapping();
    for(const extra of [{participants:0,courseHoursPerParticipant:4},{participants:8,courseHoursPerParticipant:0},{participants:0,courseHoursPerParticipant:null},{participants:null,courseHoursPerParticipant:0},{participants:null,courseHoursPerParticipant:null}]) await course(f,m,extra);
    assert.deepEqual((await f.dash()).serviceEstimate,{participantHours:0,courseCount:5,missingValuesCount:3});
    const data=await(await f.api('/api/sms/summaries')).json() as any; assert.equal(data.summaries.filter((c:any)=>c.serviceEstimate.participantHours===0).length,2); assert.equal(data.summaries.filter((c:any)=>c.serviceEstimate.participantHours===null).length,3);
  } finally { f.sqlite.close(); }
});

test('unbound estimate aggregation is uncapped even when the course list truncates at 100', async () => {
  const f=fixture(); try {
    const m=await f.mapping();
    const insert=f.sqlite.prepare(`INSERT INTO course_summaries(id,revision,organization_id,program_id,status,course_hours_per_participant,participants,created_at,updated_at) VALUES(?,1,?,?,'planned',2,3,'2026-01-01','2026-01-01')`);
    for(let i=0;i<105;i++) insert.run(crypto.randomUUID(),m.organizationId,m.programId);
    const data=await(await f.api('/api/sms/summaries?organizationId='+m.organizationId)).json() as any;
    assert.equal(data.summaries.length,100); assert.equal(data.truncated,true); assert.deepEqual(data.serviceEstimate,{participantHours:630,courseCount:105,missingValuesCount:0});
    assert.deepEqual((await f.dash()).serviceEstimate,data.serviceEstimate);
  } finally { f.sqlite.close(); }
});

test('unbinding after SMS history reveals only a separate configured estimate, preserving every actual record and total', async () => {
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m,{participants:20,completers:15,courseHoursPerParticipant:4}); await bindCourse(f,m,c.id); await f.sms('5 1'); await f.sms('1');
    const ledger=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY id').all(); const aggregates=f.sqlite.prepare('SELECT * FROM sms_aggregates').all();
    assert.equal((await f.dash()).serviceEstimate.participantHours,0); await bindCourse(f,m,null);
    const dash=await f.dash(); assert.deepEqual(dash.serviceEstimate,{participantHours:80,courseCount:1,missingValuesCount:0});
    assert.deepEqual(dash.totals,{sessions:2,attendees:10,sessionMinutes:120,participantMinutes:600}); assert.deepEqual((await attendance(f,c.id)).totals,dash.totals);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records ORDER BY id').all(),ledger); assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_aggregates').all(),aggregates);
    const report=await(await f.api('/api/sms/report')).json() as any; assert.equal(report.current.participantMinutes,600);
    const current=await(await f.api('/api/sms/summaries')).json() as any; assert.equal(current.summaries[0].completers,15); assert.equal(current.summaries[0].courseHoursPerParticipant,4);
    assert.doesNotMatch(JSON.stringify(current),/senderPhone|sender_phone|messageSid|teacherId|14155550101/);
  } finally { f.sqlite.close(); }
});


test('program participant estimates use full scoped maxima, preserve raw visits, and prefer observed zero to metadata', async () => {
  const f=fixture(); try {
    const a=await f.mapping(); const b=await f.mapping('+14155550102',' Other');
    const one=await course(f,a,{participants:45}); await course(f,a,{participants:60}); await bindCourse(f,a,one.id);
    await course(f,b,{participants:12}); await course(f,b,{participants:20});
    const missing=await f.create('program',{name:'Unknown inputs',organizationId:a.organizationId});
    await f.sms('16 1'); await f.sms('15 1'); await f.sms('29 1'); await f.sms('not attendance');
    const before=f.sqlite.prepare('SELECT * FROM sms_records ORDER BY id').all();
    const all=await f.dash(), scoped=await f.dash(a.organizationId);
    assert.deepEqual(all.participantEstimate,{participants:49,programCount:3,missingValuesCount:1});
    assert.deepEqual(scoped.participantEstimate,{participants:29,programCount:2,missingValuesCount:1});
    assert.deepEqual(all.programs.find((p:any)=>p.id===a.programId).participantEstimate,{value:29,source:'sms-maximum'});
    assert.deepEqual(all.programs.find((p:any)=>p.id===b.programId).participantEstimate,{value:20,source:'configured-maximum'});
    assert.deepEqual(all.programs.find((p:any)=>p.id===missing).participantEstimate,{value:null,source:'unknown'});
    assert.deepEqual(all.organizations.find((o:any)=>o.id===a.organizationId).participantEstimate,scoped.participantEstimate);
    assert.equal(all.totals.attendees,60); assert.equal(all.totals.sessions,3);
    await bindCourse(f,a,null); assert.deepEqual((await f.dash(a.organizationId)).participantEstimate,scoped.participantEstimate);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records ORDER BY id').all(),before);
    await f.sms('0 1',{From:'+14155550102'});
    assert.deepEqual((await f.dash(b.organizationId)).participantEstimate,{participants:0,programCount:1,missingValuesCount:0});
    const unobserved=await course(f,b,{participants:0}); assert.deepEqual((await attendance(f,unobserved.id)).participantEstimate,{value:0,source:'configured-maximum'});
  } finally { f.sqlite.close(); }
});

test('configured participant fallback is an uncapped per-program maximum across all course statuses, independent of phone bindings', async()=>{
  const f=fixture(); try {
    const m=await f.mapping(); const c=await course(f,m,{participants:5}); await bindCourse(f,m,c.id,false);
    const insert=f.sqlite.prepare(`INSERT INTO course_summaries(id,revision,organization_id,program_id,status,participants,created_at,updated_at) VALUES(?,1,?,?,'completed',?,'2026-01-01','2026-01-01')`);
    for(let i=0;i<105;i++)insert.run(crypto.randomUUID(),m.organizationId,m.programId,i===104?123:2);
    await f.api('/api/sms/admin',{action:'program',id:m.programId,organizationId:m.organizationId,name:'Archived',active:false});
    assert.deepEqual((await f.dash()).participantEstimate,{participants:123,programCount:1,missingValuesCount:0});
    assert.deepEqual((await attendance(f,c.id)).participantEstimate,{value:5,source:'configured-maximum'});
  } finally { f.sqlite.close(); }
});

test('negative reversal syntax is deterministic and never negative attendance input',()=>{
 assert.deepEqual(parseSmsReversal('-59 3'),{ok:true,metrics:{attendees:59,sessionMinutes:180}});
 assert.deepEqual(parseSmsReversal(' -0 0.25\n'),{ok:true,metrics:{attendees:0,sessionMinutes:15}});
 for(const body of ['- 59 3','--59 3','59 -3','-59 3.1','-59','-01 3','-10001 3','-59 25','−59 3'])assert.equal(parseSmsReversal(body).ok,false,body);
 assert.equal(parseSms('-59 3').ok,false);
});
test('one reversal retains immutable originals and synchronizes sums, maximum, graph, report and audit',async()=>{
 const f=fixture();try{
  const m=await f.mapping();const c=await course(f,m,{participants:99});await bindCourse(f,m,c.id);
  await f.sms('20 2');await f.sms('59 3');
  const target=f.sqlite.prepare("SELECT * FROM sms_records WHERE body='59 3'").get() as any;
  const response=await f.sms('-59 3');assert.equal(response.status,200,await response.clone().text());assert.doesNotMatch(await response.text(),/<Message/);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(target.id),target);
  const d=await f.dash();assert.deepEqual(d.totals,{sessions:1,attendees:20,sessionMinutes:120,participantMinutes:2400});assert.equal(d.participantEstimate.participants,20);
  const chart=await attendance(f,c.id);assert.equal(chart.points.length,1);assert.equal(chart.points[0].attendees,20);assert.equal(chart.participantEstimate.value,20);
  const report=await(await f.api('/api/sms/report')).json() as any;assert.equal(report.current.sessions,1);assert.equal(report.current.participantMinutes,2400);
  const admin=await(await f.api('/api/sms/admin')).json() as any;assert.equal(admin.records.find((r:any)=>r.id===target.id).status,'reversed');assert.equal(admin.stats.counted,1);assert.equal(admin.stats.reversed,1);assert.equal(admin.stats.quarantined,0);
  const command=admin.records.find((r:any)=>r.body==='-59 3');assert.equal(command.status,'reversal');assert.equal(command.reversalTargetId,target.id);
  assert.throws(()=>f.sqlite.prepare('DELETE FROM sms_reversals').run(),/immutable/);assert.throws(()=>f.sqlite.prepare("UPDATE sms_records SET reason='INVALID_BODY' WHERE id=?").run(command.id),/immutable/);
 }finally{f.sqlite.close();}
});
test('no match is quarantined; provider replay is once, a new negative retracts next latest active match',async()=>{
 const f=fixture();try{
  const m=await f.mapping();await f.sms('59 3');await f.sms('59 3');
  const originals=f.sqlite.prepare("SELECT id FROM sms_records WHERE status='counted' ORDER BY accepted_order").all() as any[];
  const sid='SM'+'c'.repeat(32);
  const responses=await Promise.all(Array.from({length:5},()=>f.sms('-59 3',{MessageSid:sid})));assert.ok(responses.every(r=>r.status===200));
  assert.equal((await f.dash()).totals.sessions,1);assert.equal((f.sqlite.prepare('SELECT target_record_id FROM sms_reversals').get() as any).target_record_id,originals[1].id);
  await f.sms('-59 3');assert.equal((await f.dash()).totals.sessions,0);assert.equal((await f.dash()).participantEstimate.participants,0);
  await f.sms('-59 3');assert.equal((f.sqlite.prepare('SELECT reason FROM sms_records ORDER BY rowid DESC LIMIT 1').get() as any).reason,'REVERSAL_NO_MATCH');
  assert.deepEqual((await f.dash(m.organizationId)).totals,{sessions:0,attendees:0,sessionMinutes:0,participantMinutes:0});
  await f.sms('59 3');assert.equal((await f.dash()).totals.sessions,1,'positive SMS safely restores as a new event');
 }finally{f.sqlite.close();}
});
test('simultaneous distinct reversals cannot retract an event twice',async()=>{
 const f=fixture();try{await f.mapping();await f.sms('59 3');await f.sms('59 3');
  const responses=await Promise.all([f.sms('-59 3'),f.sms('-59 3'),f.sms('-59 3')]);assert.ok(responses.every(r=>r.status===200));
  assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM sms_reversals').get() as any).n,2);
  assert.equal((f.sqlite.prepare("SELECT COUNT(*) n FROM sms_records WHERE reason='REVERSAL_NO_MATCH'").get() as any).n,1);
  assert.equal((await f.dash()).totals.participantMinutes,0);
 }finally{f.sqlite.close();}
});
test('reversal is restricted to sender and current course/program/org; old requests never replay',async()=>{
 const f=fixture();try{
  const m=await f.mapping();const c1=await course(f,m);const c2=await course(f,m,{yard:'South'});await bindCourse(f,m,c1.id);await f.sms('59 3');
  const other=await f.create('teacher',{name:'Other',phone:'+14155550102',programId:m.programId,courseId:c1.id});assert.ok(other);
  await f.sms('-59 3',{From:'+14155550102'});assert.equal((await f.dash()).totals.sessions,1);
  await bindCourse(f,m,c2.id);await f.sms('-59 3');assert.equal((await f.dash()).totals.sessions,1);
  const b=await f.mapping('+14155550103','B');await f.api('/api/sms/admin',{action:'teacher',id:m.teacherId,name:'Moved',phone:PHONE,programId:b.programId,courseId:null});await f.sms('-59 3');assert.equal((await f.dash(m.organizationId)).totals.sessions,1);
  await f.api('/api/sms/admin',{action:'teacher',id:m.teacherId,name:'Returned',phone:PHONE,programId:m.programId,courseId:c1.id});
  const noMatch=f.sqlite.prepare("SELECT id FROM sms_records WHERE reason='REVERSAL_NO_MATCH' LIMIT 1").get() as any;
  assert.equal((await f.api('/api/sms/admin',{action:'retry',id:noMatch.id})).status,409);
  await f.sms('-59 3');assert.equal((await f.dash()).totals.sessions,0);
 }finally{f.sqlite.close();}
});
test('repeat shortcut excludes reversed baselines, preserves independent repeat children, and ends at zero',async()=>{
 const f=fixture();try{
  const m=await f.mapping();const c=await course(f,m,{participants:99});await bindCourse(f,m,c.id);
  await f.sms('20 2');await f.sms('59 3');await f.sms('-59 3');await f.sms('1');
  assert.deepEqual((await attendance(f,c.id)).points.map((p:any)=>p.attendees),[20,20]);
  await f.sms('-20 2');await f.sms('-20 2');await f.sms('1');
  assert.equal((f.sqlite.prepare('SELECT reason FROM sms_records ORDER BY rowid DESC LIMIT 1').get() as any).reason,'REPEAT_BASELINE_REQUIRED');
  const d=await f.dash();assert.equal(d.totals.sessions,0);assert.equal(d.participantEstimate.participants,0);
  assert.equal((await attendance(f,c.id)).participantEstimate.value,0);
  const batch=await(await f.api('/api/sms/dashboard?organizationId='+m.organizationId+'&includeCourses=1')).json() as any;assert.equal(batch.courseAttendance[0].participantEstimate.value,0);
 }finally{f.sqlite.close();}
});
test('invalid identity, disabled binding and media reversal do not alter records',async()=>{
 const f=fixture();try{
  const m=await f.mapping();await f.sms('59 3');
  assert.equal((await f.sms('-59 3',{}, {signature:'invalid'})).status,403);
  await f.sms('-59 3',{From:'+14155550104'});await f.sms('-59 3',{NumMedia:'1'});
  await bindCourse(f,m,null,false);await f.sms('-59 3');
  assert.equal((await f.dash()).totals.sessions,1);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM sms_reversals').get() as any).n,0);
 }finally{f.sqlite.close();}
});

test('a reversal cannot target generated data, and failed transactions retain original totals',async()=>{
 const f=fixture();try{
  const {seedCenterCollection,CENTER_COLLECTION}=await import('../src/server/center-seed');await seedCenterCollection(f.env.DB!,'tpw-admin');
  const center=CENTER_COLLECTION[0],p=center.programs[0];await f.create('teacher',{name:'Bound',phone:PHONE,programId:p.id,courseId:p.courseId});
  const before=(await f.dash()).totals;await f.sms('-18 1.5');assert.deepEqual((await f.dash()).totals,before);
  await f.sms('59 3');const after=(await f.dash()).totals;
  f.sqlite.exec("CREATE TRIGGER fail_reversal BEFORE INSERT ON sms_reversals BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  const sid='SM'+'f'.repeat(32);assert.equal((await f.sms('-59 3',{MessageSid:sid})).status,500);
  assert.deepEqual((await f.dash()).totals,after);assert.equal(f.sqlite.prepare('SELECT id FROM sms_records WHERE message_sid=?').get(sid),undefined);
  f.sqlite.exec('DROP TRIGGER fail_reversal');assert.equal((await f.sms('-59 3',{MessageSid:sid})).status,200);assert.deepEqual((await f.dash()).totals,before);
  assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM generated_activity').get() as any).n,72);
 }finally{f.sqlite.close();}
});
