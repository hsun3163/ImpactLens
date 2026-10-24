import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleApi, BACKEND_LIMITS } from '../src/server/api';
import { summarizeRow } from '../src/lib/analysis';
import { aggregateRowsToCsv, parseAggregateCsv } from '../src/lib/csv';

// Independent test harness: execute the actual migration and SQL, rather than
// mocking authorization decisions or matching SQL strings.
function securityFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrationDirectory = resolve(process.cwd(), 'drizzle');
  for (const name of readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve(migrationDirectory, name), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  const prepare = (sql: string) => {
    let values: any[] = [];
    const statement = {
      bind(...args: any[]) { values = args; return statement; },
      async first(column?: string) {
        const result = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined;
        return result ? (column ? result[column] : result) : null;
      },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }; },
      async run() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async raw() { return sqlite.prepare(sql).all(...values).map(row => Object.values(row)); },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const objects = new Map<string, string>();
  let reads = 0;
  const bucket = {
    async put(key: string, value: string | ArrayBuffer | Uint8Array) {
      objects.set(key, typeof value === 'string' ? value : new TextDecoder().decode(value));
      return { key, etag: 'test-etag' };
    },
    async get(key: string) {
      reads++;
      const body = objects.get(key);
      return body === undefined ? null : { key, body: new Response(body).body, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer, httpMetadata: {}, writeHttpMetadata() {} };
    },
    async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
  };
  const env = { DB: db as unknown as D1Database, BUCKET: bucket as unknown as R2Bucket };
  const request = async (path: string, options: { user?: string | null; method?: string; body?: unknown; headers?: Record<string, string>; omitOrigin?: boolean } = {}) => {
    const headers = new Headers();
    const user = options.user === undefined ? 'alice' : options.user;
    if (user) {
      headers.set('oai-authenticated-user-id', `user-${user}`);
      headers.set('oai-authenticated-user-email', `${user}@example.test`);
    }
    if (options.method && options.method !== 'GET') {
      if (!options.omitOrigin) headers.set('origin', 'https://impactlens.example.test');
      headers.set('content-type', 'application/json');
    }
    for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
    return handleApi(new Request(`https://impactlens.example.test${path}`, {
      method: options.method ?? 'GET', headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    }), env);
  };
  return { request, sqlite, objects, bucket, env, get objectReads() { return reads; } };
}

const csvHeader = 'id,releaseYear,groupType,group,denominator,events,outcome,followupMonths,sourceId,sourcePage,dataKind';
const validCsv = `${csvHeader}\na,2020,age,A,100,25,Reconviction,36,unverified-upload,10,official\nb,2020,age,B,100,30,Reconviction,36,unverified-upload,11,official`;
async function createProject(f: ReturnType<typeof securityFixture>, user = 'alice', csv = validCsv, name = 'Security fixture') {
  const response = await f.request('/api/projects', { user, method: 'POST', body: { name, csv } });
  const body = await response.json() as any;
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.project as { id: string; name: string; rowCount: number };
}

test('security: anonymous and partial identities cannot list or create private projects', async () => {
  const f = securityFixture();
  try {
    const incompleteHeaders: Record<string, string>[] = [{}, { 'oai-authenticated-user-id': 'user-alice' }, { 'oai-authenticated-user-email': 'alice@example.test' }];
    for (const headers of incompleteHeaders) {
      const response = await f.request('/api/projects', { user: null, headers });
      assert.equal(response.status, 401);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      const write = await f.request('/api/projects', { user: null, headers, method: 'POST', body: { name: 'Unauthorized', csv: validCsv } });
      assert.equal(write.status, 401);
    }
    assert.equal(f.objects.size, 0);
  } finally { f.sqlite.close(); }
});

test('security: cross-site and originless writes fail before persistence', async () => {
  const f = securityFixture();
  try {
    const variants: { omitOrigin?: boolean; headers?: Record<string, string> }[] = [
      { omitOrigin: true },
      { headers: { origin: 'https://evil.example.test' } },
      { headers: { origin: 'https://impactlens.example.test.evil.test' } },
      { headers: { origin: 'null' } },
      { headers: { 'sec-fetch-site': 'cross-site' } },
    ];
    for (const options of variants) {
      const response = await f.request('/api/projects', { method: 'POST', body: { name: 'CSRF', csv: validCsv }, ...options });
      assert.equal(response.status, 403);
    }
    assert.equal(f.objects.size, 0);
  } finally { f.sqlite.close(); }
});

test('security: CSV validation rejects identifying columns and invalid counts on the server', async () => {
  const f = securityFixture();
  try {
    const variants = [
      `${csvHeader},email\na,2020,age,A,100,25,Reconviction,36,s,10,official,private@example.test`,
      validCsv.replace(',100,25,', ',100,101,'),
      validCsv.replace(',100,25,', ',0,0,'),
      validCsv.replace(',100,25,', ',100,1.5,'),
      validCsv.replace(',36,', ',0,'),
      `${csvHeader}\na,2020,age,A,100,25,Reconviction,36,s,10,official\na,2020,age,B,100,30,Reconviction,36,s,11,official`,
    ];
    for (const csv of variants) {
      const response = await f.request('/api/projects', { method: 'POST', body: { name: 'Rejected CSV', csv } });
      assert.equal(response.status, 422);
    }
    assert.equal(f.objects.size, 0);
  } finally { f.sqlite.close(); }
});

test('security: two users cannot enumerate, read, analyze, generate or download each other\'s data', async () => {
  const f = securityFixture();
  try {
    const alice = await createProject(f, 'alice');
    const bob = await createProject(f, 'bob');
    const listed = await (await f.request('/api/projects', { user: 'bob' })).json() as any;
    assert.deepEqual(listed.projects.map((project: any) => project.id), [bob.id]);
    assert.doesNotMatch(JSON.stringify(listed), /owner_id|user-alice|rows_json|csv_key/);
    const created = await f.request(`/api/projects/${alice.id}/reports`, { method: 'POST', body: {} });
    assert.equal(created.status, 201);
    const report = (await created.json() as any).report;
    const readsBefore = f.objectReads;
    for (const user of [null, 'bob']) {
      for (const path of [`/api/projects/${alice.id}`, `/api/projects/${alice.id}/analysis`, `/api/projects/${alice.id}/reports`, report.jsonUrl, report.csvUrl, report.markdownUrl]) {
        const response = await f.request(path, { user });
        assert.equal(response.status, user ? 404 : 401, path);
        assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
        assert.doesNotMatch(await response.text(), /Security fixture|unverified-upload|owner_id|rows_json|csv_key/);
      }
      const write = await f.request(`/api/projects/${alice.id}/reports`, { user, method: 'POST', body: {} });
      assert.equal(write.status, user ? 404 : 401);
    }
    assert.equal(f.objectReads, readsBefore, 'No unauthorized request should touch R2');
    const reports = await (await f.request(`/api/projects/${alice.id}/reports`)).json() as any;
    assert.equal(reports.reports.length, 1);
    assert.equal(reports.reports[0].id, report.id);
  } finally { f.sqlite.close(); }
});

test('security: saved analysis and persisted exports recompute counts and retain unverified provenance', async () => {
  const f = securityFixture();
  try {
    const project = await createProject(f);
    const saved = await (await f.request(`/api/projects/${project.id}`)).json() as any;
    assert.ok(saved.rows.every((row: any) => row.dataKind === 'uploaded'));
    const computed = await (await f.request(`/api/projects/${project.id}/analysis`)).json() as any;
    assert.deepEqual(computed.summaries, saved.rows.map(summarizeRow));
    assert.match(computed.warnings.join(' '), /not.*causal/i);
    assert.match(computed.warnings.join(' '), /not been independently verified/i);
    const reportResponse = await f.request(`/api/projects/${project.id}/reports`, { method: 'POST', body: {} });
    assert.equal(reportResponse.status, 201);
    const report = (await reportResponse.json() as any).report;
    for (const [format, url] of [['json', report.jsonUrl], ['csv', report.csvUrl], ['md', report.markdownUrl]]) {
      assert.match(url, /^\/api\/reports\/[0-9a-f-]+\/download\?format=(json|csv|md)$/);
      const download = await f.request(url);
      assert.equal(download.status, 200);
      assert.match(download.headers.get('cache-control') ?? '', /no-store/);
      assert.match(download.headers.get('content-disposition') ?? '', /^attachment; filename="impactlens-report-[0-9a-f-]+\.(json|csv|md)"$/);
      assert.match(download.headers.get('content-security-policy') ?? '', /sandbox/);
      assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
      const text = await download.text();
      assert.doesNotMatch(text, /owner_id|rows_json|json_key|csv_key|markdown_key|user-alice|alice@example.test/);
      if (format === 'json') {
        const value = JSON.parse(text);
        assert.deepEqual(value.summaries, computed.summaries);
        assert.equal(value.computedAt, report.createdAt);
        assert.equal(value.engine, computed.engine);
        assert.equal(value.summaries[0].ratePct, 25);
        assert.equal(value.summaries[0].sourceId, 'unverified-upload');
      } else if (format === 'csv') {
        const parsed = parseAggregateCsv(text);
        assert.deepEqual(parsed.errors, []);
        assert.deepEqual(parsed.rows, saved.rows);
      } else {
        assert.match(text, /unverified/);
        assert.match(text, /not.*causal/i);
      }
    }
  } finally { f.sqlite.close(); }
});

test('security: caller cannot choose ownership, report contents or server-calculated results', async () => {
  const f = securityFixture();
  try {
    for (const extra of [{ owner_id: 'user-bob' }, { ownerId: 'user-bob' }, { dataKind: 'official' }, { rows: [] }, { id: crypto.randomUUID() }]) {
      const response = await f.request('/api/projects', { method: 'POST', body: { name: 'Fake metadata', csv: validCsv, ...extra } });
      assert.equal(response.status, 400);
    }
    const project = await createProject(f);
    for (const body of [{ ownerId: 'user-bob' }, { summaries: [{ ratePct: 0 }] }, { rows: [] }, { csv: validCsv }]) {
      const response = await f.request(`/api/projects/${project.id}/reports`, { method: 'POST', body });
      assert.equal(response.status, 400);
    }
    assert.equal(f.objects.size, 1, 'Only the one authorized normalized CSV should exist');
  } finally { f.sqlite.close(); }
});

test('security: project quota is per-user and concurrent failures leave no orphan objects', async () => {
  const f = securityFixture();
  try {
    const responses = await Promise.all(Array.from({ length: BACKEND_LIMITS.maxProjects + 3 }, (_, index) => f.request('/api/projects', { method: 'POST', body: { name: `Quota ${index}`, csv: validCsv } })));
    assert.equal(responses.filter(response => response.status === 201).length, BACKEND_LIMITS.maxProjects);
    assert.equal(responses.filter(response => response.status === 409).length, 3);
    assert.equal(f.objects.size, BACKEND_LIMITS.maxProjects);
    await createProject(f, 'bob');
    assert.equal(f.objects.size, BACKEND_LIMITS.maxProjects + 1);
  } finally { f.sqlite.close(); }
});

test('security: concurrent report quota is atomic and rejected reports leave no orphan objects', async () => {
  const f = securityFixture();
  try {
    const project = await createProject(f);
    const responses = await Promise.all(Array.from({ length: BACKEND_LIMITS.maxReportsPerProject + 3 }, () => f.request(`/api/projects/${project.id}/reports`, { method: 'POST', body: {} })));
    assert.equal(responses.filter(response => response.status === 201).length, BACKEND_LIMITS.maxReportsPerProject);
    assert.equal(responses.filter(response => response.status === 409).length, 3);
    assert.equal(f.objects.size, 1 + BACKEND_LIMITS.maxReportsPerProject * 3);
  } finally { f.sqlite.close(); }
});

test('security: report ownership must agree with project ownership before storage access', async () => {
  const f = securityFixture();
  try {
    const project = await createProject(f);
    const created = await f.request(`/api/projects/${project.id}/reports`, { method: 'POST', body: {} });
    const report = (await created.json() as any).report;
    f.sqlite.prepare('UPDATE reports SET owner_id = ? WHERE id = ?').run('user-bob', report.id);
    for (const user of ['alice', 'bob']) assert.equal((await f.request(report.jsonUrl, { user })).status, 404);
    assert.equal(f.objectReads, 0);
  } finally { f.sqlite.close(); }
});

test('security: server byte and row limits reject oversized data without writes', async () => {
  const f = securityFixture();
  try {
    const oversizedCsv = await f.request('/api/projects', { method: 'POST', body: { name: 'Byte limit', csv: '界'.repeat(Math.ceil(BACKEND_LIMITS.maxCsvBytes / 3)) } });
    assert.equal(oversizedCsv.status, 422);
    const rows = `${csvHeader}\n${Array.from({ length: BACKEND_LIMITS.maxRows + 1 }, (_, index) => `r${index},2020,age,A,100,25,Reconviction,36,s,10,uploaded`).join('\n')}`;
    assert.equal((await f.request('/api/projects', { method: 'POST', body: { name: 'Row limit', csv: rows } })).status, 422);
    assert.equal((await f.request('/api/projects', { method: 'POST', body: { name: 'Body limit', csv: 'x'.repeat(BACKEND_LIMITS.maxCsvBytes * 6 + 5000) } })).status, 413);
    assert.equal(f.objects.size, 0);
  } finally { f.sqlite.close(); }
});

test('security: untrusted labels are inert in Markdown and spreadsheet downloads', async () => {
  const f = securityFixture();
  try {
    const csv = `${csvHeader}\na,2020,age,=HYPERLINK(1),100,25,Reconviction,36,<script>alert(1)</script>,10,official`;
    const project = await createProject(f, 'alice', csv, '<img src=x onerror=alert(1)> [x](https://evil.test)');
    const response = await f.request(`/api/projects/${project.id}/reports`, { method: 'POST', body: {} });
    const report = (await response.json() as any).report;
    const markdown = await (await f.request(report.markdownUrl)).text();
    assert.doesNotMatch(markdown, /<script>|<img|\[x\]\(https:\/\/evil\.test\)/);
    assert.match(markdown, /&lt;script&gt;/);
    const spreadsheet = await (await f.request(report.csvUrl)).text();
    assert.match(spreadsheet, /"'=HYPERLINK\(1\)"/);
  } finally { f.sqlite.close(); }
});

test('security: storage outages expose no internals and do not block anonymous session discovery', async () => {
  const anonymous = await handleApi(new Request('https://impactlens.example.test/api/session'), {});
  assert.equal(anonymous.status, 200);
  const session = await anonymous.json() as any;
  assert.equal(session.authenticated, false);
  assert.equal(session.user, null);
  assert.equal(session.storageAvailable, false);
  const signedIn = await handleApi(new Request('https://impactlens.example.test/api/projects', { headers: { 'oai-authenticated-user-id': 'user-alice', 'oai-authenticated-user-email': 'alice@example.test' } }), {});
  assert.equal(signedIn.status, 503);
  assert.doesNotMatch(await signedIn.text(), /stack|SELECT|R2Bucket|D1Database|user-alice|alice@example.test/);
});

test('security: synthetic warnings survive browser CSV import, save, reopen, analysis and every report format', async () => {
  const f = securityFixture();
  try {
    // Match the browser upload → Save serialization path, rather than bypassing the importer.
    const imported = parseAggregateCsv(validCsv.replaceAll(',official', ',synthetic'));
    assert.deepEqual(imported.errors, []);
    assert.ok(imported.rows.every(row => row.dataKind === 'synthetic'));
    const project = await createProject(f, 'alice', aggregateRowsToCsv(imported.rows));
    const saved = await (await f.request(`/api/projects/${project.id}`)).json() as any;
    assert.ok(saved.rows.every((row: any) => row.dataKind === 'synthetic'));
    const computed = await (await f.request(`/api/projects/${project.id}/analysis`)).json() as any;
    assert.ok(computed.summaries.every((row: any) => row.warnings.some((warning: string) => /synthetic demonstration/i.test(warning))));
    const response = await f.request(`/api/projects/${project.id}/reports`, { method: 'POST', body: {} });
    const report = (await response.json() as any).report;
    const json = await (await f.request(report.jsonUrl)).json() as any;
    assert.ok(json.summaries.every((row: any) => row.dataKind === 'synthetic' && row.warnings.some((warning: string) => /synthetic demonstration/i.test(warning))));
    const csv = await (await f.request(report.csvUrl)).text();
    assert.ok(parseAggregateCsv(csv).rows.every(row => row.dataKind === 'synthetic'));
    const markdown = await (await f.request(report.markdownUrl)).text();
    assert.match(markdown, /SYNTHETIC DATA/);
    assert.match(markdown, /invented demonstration values/);
    assert.match(markdown, /\| synthetic \|/);
  } finally { f.sqlite.close(); }
});

test('security: partial report-object failure is compensated and exposes no internal exception', async () => {
  const f = securityFixture();
  try {
    const project = await createProject(f);
    const put = f.bucket.put;
    f.bucket.put = async (key, value) => {
      if (key.startsWith('reports/') && key.endsWith('/aggregate.csv')) throw new Error('Private R2 internal failure user-alice credential-value');
      return put(key, value);
    };
    const failed = await f.request(`/api/projects/${project.id}/reports`, { method: 'POST', body: {} });
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /R2 internal|user-alice|credential-value/);
    assert.equal(f.objects.size, 1);
    const reports = await (await f.request(`/api/projects/${project.id}/reports`)).json() as any;
    assert.deepEqual(reports.reports, []);
  } finally { f.sqlite.close(); }
});

test('security: malformed UTF-8 and non-JSON bodies are rejected before persistence', async () => {
  const f = securityFixture();
  try {
    const headers = { 'oai-authenticated-user-id': 'user-alice', 'oai-authenticated-user-email': 'alice@example.test', origin: 'https://impactlens.example.test', 'content-type': 'application/json' };
    for (const body of ['{', 'null', '[]', '"string"', new Uint8Array([0xff, 0xfe])]) {
      const response = await handleApi(new Request('https://impactlens.example.test/api/projects', { method: 'POST', headers, body }), f.env);
      assert.equal(response.status, 400);
    }
    const wrongType = await f.request('/api/projects', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: { name: 'Wrong media type', csv: validCsv } });
    assert.equal(wrongType.status, 415);
    assert.equal(f.objects.size, 0);
  } finally { f.sqlite.close(); }
});

test('security: unknown and injection-shaped resource IDs do not reveal database internals', async () => {
  const f = securityFixture();
  try {
    for (const id of ['not-present', "x' OR 1=1--", '../../private']) {
      const response = await f.request(`/api/projects/${encodeURIComponent(id)}`);
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /sqlite|SELECT|owner_id|bucket|stack/i);
    }
    assert.equal(f.objectReads, 0);
  } finally { f.sqlite.close(); }
});
