import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { handleSmsApi, type SmsRuntime } from '../src/server/sms-api';

const ORIGIN = 'https://impactlens.example.test';
const PATH = '/api/sms/course-metadata';
const organizationId = '10000000-0000-4000-8000-000000000001';
const otherOrganizationId = '10000000-0000-4000-8000-000000000002';
const programId = '20000000-0000-4000-8000-000000000001';
const otherProgramId = '20000000-0000-4000-8000-000000000002';
const teacherId = '30000000-0000-4000-8000-000000000001';
const summaryId = '40000000-0000-4000-8000-000000000001';
const authHeaders = { 'oai-authenticated-user-id': 'tpw-admin', 'oai-authenticated-user-email': 'tpw-admin@example.test' };

function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  const queries: string[] = [];
  const prepare = (sql: string) => {
    queries.push(sql); let values: any[] = [];
    const statement = {
      bind(...args: any[]) { values = args; return statement; },
      async first(column?: string) { const row = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined; return row ? column ? row[column] : row : null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }; },
      async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
    }; return statement;
  };
  const env: SmsRuntime = { DB: { prepare } as unknown as D1Database, TPW_ADMIN_USER_IDS: 'tpw-admin' };
  for (const [id, name, slug, active] of [[organizationId, 'Synthetic organization', 'stable-url-slug', 0], [otherOrganizationId, 'Other organization', 'other-org', 1]]) {
    sqlite.prepare('INSERT INTO sms_organizations(id,name,slug,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, name, slug, active, '2026-01-01', '2026-01-01');
  }
  for (const [id, org, name, active] of [[programId, organizationId, 'Synthetic program', 0], [otherProgramId, otherOrganizationId, 'Other program', 1]]) {
    sqlite.prepare('INSERT INTO sms_programs(id,organization_id,name,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, org, name, active, '2026-01-01', '2026-01-01');
  }
  sqlite.prepare('INSERT INTO sms_teachers(id,phone,name,program_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(teacherId, '+14155550101', 'Private teacher', programId, '2026-01-01', '2026-01-01');
  sqlite.prepare(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,teacher_id,organization_id,program_id,organization_name,program_name,attendees,session_minutes,received_at,processed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), 'SM' + 'd'.repeat(32), '+14155550101', '20 2', 'counted', teacherId, organizationId, programId, 'Synthetic organization', 'Synthetic program', 20, 120, '2026-01-01', '2026-01-01');
  sqlite.prepare('INSERT INTO sms_records(id,message_sid,sender_phone,body,status,reason,received_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'SM' + 'e'.repeat(32), '+14155550102', 'Private quarantined body', 'quarantined', 'UNKNOWN_SENDER', '2026-01-01');
  sqlite.prepare('INSERT INTO course_summaries(id,revision,organization_id,program_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(summaryId, 1, organizationId, programId, 'planned', '2026-01-01', '2026-01-01');
  async function api(body?: unknown, query = '', user: string | null = 'tpw-admin', extra: Record<string, string> = {}) {
    return handleSmsApi(new Request(ORIGIN + PATH + query, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json', origin: ORIGIN }), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  }
  const protectedSnapshot = () => Object.fromEntries(['sms_teachers', 'sms_records', 'sms_aggregates', 'course_summaries'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
  return { sqlite, env, queries, api, protectedSnapshot };
}
async function payload(response: Response, status = 200): Promise<any> { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test('course metadata requires the existing admin gate for both reads and writes', async () => {
  const f = fixture(); try {
    for (const body of [undefined, { action: 'organization', name: 'Not permitted' }]) {
      assert.equal((await payload(await f.api(body, '', null), 401)).code, 'SIGN_IN_REQUIRED');
      assert.equal((await payload(await f.api(body, '', 'other-user'), 403)).code, 'ADMIN_REQUIRED');
      assert.equal((await payload(await f.api(body, '', 'tpw-admin', { 'oai-authenticated-user-email': '' }), 401)).code, 'SIGN_IN_REQUIRED');
      f.env.TPW_ADMIN_USER_IDS = '';
      assert.equal((await payload(await f.api(body), 503)).code, 'ADMIN_NOT_CONFIGURED');
      f.env.TPW_ADMIN_USER_IDS = 'tpw-admin';
    }
    assert.deepEqual(f.queries, []);
    f.env.DB = undefined;
    assert.equal((await payload(await f.api(), 503)).code, 'STORAGE_UNAVAILABLE');
  } finally { f.sqlite.close(); }
});

test('course metadata writes reject absent, cross-origin and cross-site origins before storage access', async () => {
  const f = fixture(); try {
    const body = { action: 'organization', name: 'Not permitted' };
    assert.equal((await payload(await f.api(body, '', 'tpw-admin', { origin: 'https://other.example.test' }), 403)).code, 'INVALID_ORIGIN');
    assert.equal((await payload(await f.api(body, '', 'tpw-admin', { 'sec-fetch-site': 'cross-site' }), 403)).code, 'INVALID_ORIGIN');
    const noOrigin = new Request(ORIGIN + PATH, { method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await payload(await handleSmsApi(noOrigin, f.env), 403)).code, 'INVALID_ORIGIN');
    assert.deepEqual(f.queries, []);
  } finally { f.sqlite.close(); }
});

test('metadata GET reads and exposes only names, stable IDs and active flags, privately cached', async () => {
  const f = fixture(); try {
    const response = await f.api(); const data = await payload(response);
    assert.deepEqual(Object.keys(data).sort(), ['organizations', 'programs']);
    assert.equal(data.organizations.length, 2); assert.equal(data.programs.length, 2);
    for (const org of data.organizations) assert.deepEqual(Object.keys(org).sort(), ['active', 'id', 'name']);
    for (const program of data.programs) assert.deepEqual(Object.keys(program).sort(), ['active', 'id', 'name', 'organizationId']);
    assert.equal(data.organizations.find((org: any) => org.id === organizationId).active, false);
    assert.equal(data.programs.find((program: any) => program.id === programId).active, false);
    assert.doesNotMatch(JSON.stringify(data), /Private|1415555010|teacher|phone|message|totals|sessions|attendees|Minutes|slug|createdAt|updatedAt/);
    assert.ok(f.queries.every(sql => !/\*|sms_teachers|sms_records|sms_aggregates|course_summaries|slug/.test(sql)));
    assert.match(response.headers.get('cache-control')!, /private, no-store/);
    assert.match(response.headers.get('vary')!, /Cookie/); assert.match(response.headers.get('vary')!, /oai-authenticated-user-id/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  } finally { f.sqlite.close(); }
});

test('metadata organization filtering scopes programs and validates unknown or ambiguous filters', async () => {
  const f = fixture(); try {
    const scoped = await payload(await f.api(undefined, '?organizationId=' + organizationId));
    assert.equal(scoped.organizations.length, 2);
    assert.deepEqual(scoped.programs.map((program: any) => program.id), [programId]);
    for (const query of ['?organizationId=', '?organizationId=bad', `?organizationId=${organizationId}&organizationId=${otherOrganizationId}`, '?teacherId=' + teacherId]) await payload(await f.api(undefined, query), 400);
    assert.equal((await payload(await f.api(undefined, '?organizationId=' + randomUUID()), 404)).code, 'ORGANIZATION_NOT_FOUND');
    f.sqlite.prepare('DELETE FROM sms_programs WHERE id=?').run(otherProgramId);
    assert.deepEqual((await payload(await f.api(undefined, '?organizationId=' + otherOrganizationId))).programs, []);
  } finally { f.sqlite.close(); }
});

test('metadata create and rename preserve all non-name fields, SMS bindings, history, counters and course rows', async () => {
  const f = fixture(); try {
    const protectedBefore = f.protectedSnapshot();
    const oldOrg = f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(organizationId) as any;
    const oldProgram = f.sqlite.prepare('SELECT * FROM sms_programs WHERE id=?').get(programId) as any;
    const org = await payload(await f.api({ action: 'organization', name: ' New organization ' }), 201);
    const program = await payload(await f.api({ action: 'program', organizationId: org.id, name: ' New program ' }), 201);
    assert.deepEqual(Object.keys(org).sort(), ['id', 'ok']); assert.equal(org.ok, true); assert.equal(program.ok, true);
    const createdOrg = f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(org.id) as any;
    const createdProgram = f.sqlite.prepare('SELECT * FROM sms_programs WHERE id=?').get(program.id) as any;
    assert.equal(createdOrg.name, 'New organization'); assert.equal(createdOrg.active, 1); assert.ok(createdOrg.slug);
    assert.equal(createdProgram.name, 'New program'); assert.equal(createdProgram.active, 1); assert.equal(createdProgram.organization_id, org.id);
    await payload(await f.api({ action: 'organization', id: organizationId, name: 'Renamed organization' }));
    await payload(await f.api({ action: 'program', id: programId, organizationId, name: 'Renamed program' }));
    const renamedOrg = f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(organizationId) as any;
    const renamedProgram = f.sqlite.prepare('SELECT * FROM sms_programs WHERE id=?').get(programId) as any;
    assert.deepEqual({ ...renamedOrg, name: oldOrg.name, updated_at: oldOrg.updated_at }, { ...oldOrg });
    assert.deepEqual({ ...renamedProgram, name: oldProgram.name, updated_at: oldProgram.updated_at }, { ...oldProgram });
    assert.equal(renamedOrg.name, 'Renamed organization'); assert.equal(renamedProgram.name, 'Renamed program');
    assert.equal(renamedOrg.active, 0); assert.equal(renamedProgram.active, 0); assert.equal(renamedOrg.slug, 'stable-url-slug');
    assert.deepEqual(f.protectedSnapshot(), protectedBefore);
    assert.ok(f.queries.every(sql => !/sms_teachers|sms_records|sms_aggregates|course_summaries/.test(sql)));
  } finally { f.sqlite.close(); }
});

test('metadata cannot change ownership, activation, URLs, teacher bindings or retry SMS', async () => {
  const f = fixture(); try {
    const before = f.protectedSnapshot();
    const orgsBefore = f.sqlite.prepare('SELECT * FROM sms_organizations ORDER BY id').all();
    const programsBefore = f.sqlite.prepare('SELECT * FROM sms_programs ORDER BY id').all();
    for (const field of ['active', 'slug', 'phone', 'teacherId', 'programId', 'organizationId', 'sessions', 'participants']) {
      assert.equal((await payload(await f.api({ action: 'organization', id: organizationId, name: 'Rejected', [field]: 'unexpected' }), 400)).code, 'UNKNOWN_FIELD');
    }
    for (const field of ['active', 'slug', 'phone', 'teacherId', 'programId', 'sessions']) {
      assert.equal((await payload(await f.api({ action: 'program', id: programId, organizationId, name: 'Rejected', [field]: 'unexpected' }), 400)).code, 'UNKNOWN_FIELD');
    }
    for (const action of ['teacher', 'retry', 'delete', '']) assert.equal((await payload(await f.api({ action, id: teacherId }), 400)).code, 'INVALID_ACTION');
    assert.equal((await payload(await f.api({ action: 'program', id: programId, organizationId: otherOrganizationId, name: 'Moved' }), 409)).code, 'PROGRAM_ORGANIZATION_FIXED');
    assert.deepEqual(f.protectedSnapshot(), before);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_organizations ORDER BY id').all(), orgsBefore);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_programs ORDER BY id').all(), programsBefore);
  } finally { f.sqlite.close(); }
});

test('metadata rejects invalid names and references rather than silently creating on rename', async () => {
  const f = fixture(); try {
    for (const name of ['', '   ', '\nName', 'x'.repeat(101), 123, null]) assert.equal((await payload(await f.api({ action: 'organization', name }), 400)).code, 'INVALID_NAME');
    for (const id of ['invalid', '', null]) assert.equal((await payload(await f.api({ action: 'organization', id, name: 'Name' }), 400)).code, 'INVALID_ID');
    await payload(await f.api({ action: 'organization', id: randomUUID(), name: 'Missing' }), 404);
    await payload(await f.api({ action: 'program', id: randomUUID(), organizationId, name: 'Missing' }), 404);
    assert.equal((await payload(await f.api({ action: 'program', organizationId: randomUUID(), name: 'Missing organization' }), 400)).code, 'ORGANIZATION_REQUIRED');
    assert.equal((await payload(await f.api({ action: 'program', name: 'No organization' }), 400)).code, 'INVALID_ID');
    assert.equal((f.sqlite.prepare('SELECT count(*) n FROM sms_organizations').get() as any).n, 2);
    assert.equal((f.sqlite.prepare('SELECT count(*) n FROM sms_programs').get() as any).n, 2);
  } finally { f.sqlite.close(); }
});

test('stable metadata create IDs make concurrent organization and program retries idempotent', async () => {
  const f = fixture(); try {
    const before = f.protectedSnapshot();
    const createId = randomUUID(); const orgInput = { action: 'organization', createId, name: 'Retry-safe organization' };
    const orgResponses = await Promise.all(Array.from({ length: 8 }, () => f.api(orgInput)));
    assert.equal(orgResponses.filter(response => response.status === 201).length, 1);
    assert.equal(orgResponses.filter(response => response.status === 200).length, 7);
    for (const response of orgResponses) assert.deepEqual(await response.json(), { ok: true, id: createId });
    const orgRow = f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(createId);
    await payload(await f.api({ ...orgInput, name: '  Retry-safe organization  ' }));
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(createId), orgRow);
    const newProgramId = randomUUID(); const programInput = { action: 'program', createId: newProgramId, organizationId: createId, name: 'Retry-safe program' };
    const programResponses = await Promise.all(Array.from({ length: 8 }, () => f.api(programInput)));
    assert.equal(programResponses.filter(response => response.status === 201).length, 1);
    assert.equal(programResponses.filter(response => response.status === 200).length, 7);
    for (const response of programResponses) assert.deepEqual(await response.json(), { ok: true, id: newProgramId });
    const programRow = f.sqlite.prepare('SELECT * FROM sms_programs WHERE id=?').get(newProgramId);
    await payload(await f.api(programInput));
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_programs WHERE id=?').get(newProgramId), programRow);
    assert.equal((f.sqlite.prepare('SELECT count(*) n FROM sms_organizations').get() as any).n, 3);
    assert.equal((f.sqlite.prepare('SELECT count(*) n FROM sms_programs').get() as any).n, 3);
    assert.deepEqual(f.protectedSnapshot(), before);
  } finally { f.sqlite.close(); }
});

test('metadata create replay conflicts never overwrite names, ownership, flags or later edits', async () => {
  const f = fixture(); try {
    const before = f.protectedSnapshot();
    const oldOrg = f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(organizationId);
    const oldProgram = f.sqlite.prepare('SELECT * FROM sms_programs WHERE id=?').get(programId);
    await payload(await f.api({ action: 'organization', createId: organizationId, name: 'Synthetic organization' }));
    await payload(await f.api({ action: 'program', createId: programId, organizationId, name: 'Synthetic program' }));
    for (const input of [
      { action: 'organization', createId: organizationId, name: 'Overwritten organization' },
      { action: 'program', createId: programId, organizationId, name: 'Overwritten program' },
      { action: 'program', createId: programId, organizationId: otherOrganizationId, name: 'Synthetic program' },
    ]) assert.equal((await payload(await f.api(input), 409)).code, 'CREATE_CONFLICT');
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(organizationId), oldOrg);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_programs WHERE id=?').get(programId), oldProgram);
    const createId = randomUUID(); const input = { action: 'organization', createId, name: 'Initial name' };
    await payload(await f.api(input), 201);
    await payload(await f.api({ action: 'organization', id: createId, name: 'Later saved name' }));
    const edited = f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(createId);
    assert.equal((await payload(await f.api(input), 409)).code, 'CREATE_CONFLICT');
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_organizations WHERE id=?').get(createId), edited);
    assert.deepEqual(f.protectedSnapshot(), before);
  } finally { f.sqlite.close(); }
});

test('competing metadata creates keep one payload and same-prefix UUIDs do not collide on organization URLs', async () => {
  const f = fixture(); try {
    for (const action of ['organization', 'program']) {
      const createId = randomUUID();
      const inputs = ['First name', 'Second name'].map(name => ({ action, createId, name, ...(action === 'program' ? { organizationId } : {}) }));
      const responses = await Promise.all(inputs.map(input => f.api(input)));
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      const winningInput = inputs[responses.findIndex(response => response.status === 201)];
      const table = action === 'organization' ? 'sms_organizations' : 'sms_programs';
      assert.equal((f.sqlite.prepare(`SELECT name FROM ${table} WHERE id=?`).get(createId) as any).name, winningInput.name);
    }
    for (const createId of ['50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002']) {
      await payload(await f.api({ action: 'organization', createId, name: 'Same organization name' }), 201);
    }
    const rows = f.sqlite.prepare("SELECT slug FROM sms_organizations WHERE name='Same organization name'").all() as any[];
    assert.equal(rows.length, 2); assert.notEqual(rows[0].slug, rows[1].slug); assert.ok(rows.every(row => row.slug.length <= 80));
  } finally { f.sqlite.close(); }
});

test('metadata create IDs must be valid and mutually exclusive with rename IDs', async () => {
  const f = fixture(); try {
    for (const action of ['organization', 'program']) {
      const base = { action, name: 'Rejected', ...(action === 'program' ? { organizationId } : {}) };
      for (const createId of ['', null, 'invalid', 123]) assert.equal((await payload(await f.api({ ...base, createId }), 400)).code, 'INVALID_ID');
      assert.equal((await payload(await f.api({ ...base, id: action === 'organization' ? organizationId : programId, createId: randomUUID() }), 400)).code, 'INVALID_ID');
    }
    assert.deepEqual(f.queries, []);
  } finally { f.sqlite.close(); }
});

test('metadata rejects unsupported methods, invalid JSON, media types and oversized bodies without SQL disclosure', async () => {
  const f = fixture(); try {
    const request = (body: BodyInit, type = 'application/json') => handleSmsApi(new Request(ORIGIN + PATH, { method: 'POST', headers: { ...authHeaders, origin: ORIGIN, 'content-type': type }, body }), f.env);
    await payload(await request('{}', 'text/plain'), 415);
    for (const body of ['{bad', '[]', 'null']) await payload(await request(body), 400);
    await payload(await request(new Uint8Array([0xff])), 400);
    await payload(await request('x'.repeat(8193)), 413);
    await payload(await handleSmsApi(new Request(ORIGIN + PATH, { method: 'DELETE', headers: authHeaders }), f.env), 405);
    assert.deepEqual(f.queries, []);
    f.env.DB = { prepare() { throw new Error('SQLITE SELECT private phone and raw message data'); } } as unknown as D1Database;
    const response = await f.api(); const failed = await payload(response, 500);
    assert.doesNotMatch(JSON.stringify(failed), /SQLITE|SELECT|private phone|raw message/); assert.match(response.headers.get('cache-control')!, /no-store/);
  } finally { f.sqlite.close(); }
});

test('summary GET scopes program choices with organization while retaining existing summary behavior', async () => {
  const f = fixture(); try {
    const get = (query = '') => handleSmsApi(new Request(ORIGIN + '/api/sms/summaries' + query, { headers: authHeaders }), f.env);
    const all = await payload(await get()); assert.equal(all.programs.length, 2); assert.equal(all.summaries.length, 1);
    const scoped = await payload(await get('?organizationId=' + organizationId));
    assert.deepEqual(scoped.programs.map((program: any) => program.id), [programId]);
    assert.equal(scoped.programs[0].active, false); assert.equal(scoped.organizations.length, 2);
    assert.equal(scoped.summaries.length, 1); assert.equal(scoped.summaries[0].id, summaryId);
    const other = await payload(await get('?organizationId=' + otherOrganizationId));
    assert.deepEqual(other.programs.map((program: any) => program.id), [otherProgramId]); assert.deepEqual(other.summaries, []);
  } finally { f.sqlite.close(); }
});
