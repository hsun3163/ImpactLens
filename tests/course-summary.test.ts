import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { COURSE_SUMMARY_LIMIT, COURSE_SUMMARY_SOURCE, courseSummaryToDraft, courseSummaryDraftToWrite, validateCourseSummary } from '../src/lib/course-summary';
import { handleCourseSummaries } from '../src/server/course-summary-api';

const ORIGIN = 'https://impactlens.example.test';
const organizationId = '10000000-0000-4000-8000-000000000001';
const otherOrganizationId = '10000000-0000-4000-8000-000000000002';
const programId = '20000000-0000-4000-8000-000000000001';
const otherProgramId = '20000000-0000-4000-8000-000000000002';
function summary(changes: Record<string, unknown> = {}) {
  return { id: randomUUID(), revision: 0, organizationId, programId, status: 'completed', facility: 'Synthetic facility', yard: 'A', startDate: '2026-01-01', endDate: '2026-03-31', courseHoursPerParticipant: 24.5, participants: 20, completers: 15, notes: 'Synthetic test summary.', ...changes };
}
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
  const db = { prepare } as unknown as D1Database;
  sqlite.prepare('INSERT INTO sms_organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(organizationId, 'Synthetic organization', 'synthetic-one', '2026-01-01', '2026-01-01');
  sqlite.prepare('INSERT INTO sms_organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(otherOrganizationId, 'Other organization', 'synthetic-two', '2026-01-01', '2026-01-01');
  sqlite.prepare('INSERT INTO sms_programs(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(programId, organizationId, 'Synthetic program', '2026-01-01', '2026-01-01');
  sqlite.prepare('INSERT INTO sms_programs(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(otherProgramId, otherOrganizationId, 'Other program', '2026-01-01', '2026-01-01');
  async function api(body?: unknown, query = '') {
    return handleCourseSummaries(new Request(ORIGIN + '/api/sms/summaries' + query, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) }) }), db);
  }
  return { sqlite, db, api };
}
async function payload(response: Response, status = 200): Promise<any> { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test('course-summary validation permits only the existing fields and explicit lifecycle status', () => {
  const base = summary(); assert.equal(validateCourseSummary(base).courseHoursPerParticipant, 24.5);
  for (const field of ['attendanceIds', 'budget', 'waitlist', 'survey', 'reasons', 'teacherId', 'senderPhone', 'sessions', 'uniquePeople', 'source', 'createdAt']) assert.throws(() => validateCourseSummary({ ...base, [field]: 'not collected' }), /unsupported/);
  for (const status of ['', 'complete', null, undefined]) assert.throws(() => validateCourseSummary({ ...base, status }), /Choose Planned/);
  for (const status of ['planned', 'in-progress', 'completed']) assert.equal(validateCourseSummary({ ...base, status }).status, status);
});
test('blank and omitted summary values remain null while explicit zero remains zero', () => {
  const result = validateCourseSummary({ id: randomUUID(), revision: 0, organizationId, programId, status: 'planned', facility: '   ', yard: '', startDate: '', endDate: null, participants: '', completers: undefined, courseHoursPerParticipant: null, notes: '\n ' });
  for (const field of ['facility', 'yard', 'startDate', 'endDate', 'participants', 'completers', 'courseHoursPerParticipant', 'notes'] as const) assert.equal(result[field], null, field);
  const zero = validateCourseSummary(summary({ participants: 0, completers: 0, courseHoursPerParticipant: 0 }));
  assert.equal(zero.participants, 0); assert.equal(zero.completers, 0); assert.equal(zero.courseHoursPerParticipant, 0);
});
test('invalid values, malformed dates, unknown status and count inconsistencies are rejected', () => {
  for (const value of [-1, 1000001, 1.5, '20', false, NaN, Infinity]) assert.throws(() => validateCourseSummary(summary({ participants: value })), /Participants/);
  for (const value of [-1, 1000001, '24', false, NaN, Infinity]) assert.throws(() => validateCourseSummary(summary({ courseHoursPerParticipant: value })), /Course hours/);
  for (const startDate of ['2026-02-30', '2025-02-29', '2026-2-03', '1900-02-29', '2026-01-01T00:00:00Z', '1899-12-31']) assert.throws(() => validateCourseSummary(summary({ startDate })), /date/);
  assert.equal(validateCourseSummary(summary({ startDate: '2024-02-29' })).startDate, '2024-02-29');
  assert.throws(() => validateCourseSummary(summary({ endDate: '2025-12-31' })), /earlier/);
  assert.throws(() => validateCourseSummary(summary({ participants: 10, completers: 11 })), /exceed/);
  assert.equal(validateCourseSummary(summary({ participants: null, completers: 10 })).participants, null);
  for (const revision of [-1, 0.5, '1', Number.MAX_SAFE_INTEGER, undefined]) assert.throws(() => validateCourseSummary(summary({ revision })), /Refresh/);
  for (const id of ['bad', '', null]) assert.throws(() => validateCourseSummary(summary({ id })), /valid course/);
  assert.throws(() => validateCourseSummary(summary({ facility: 'x'.repeat(151) })), /Facility/);
  assert.throws(() => validateCourseSummary(summary({ yard: '\n' })), /Yard/);
  assert.throws(() => validateCourseSummary(summary({ notes: 'x'.repeat(4001) })), /Notes/);
  assert.throws(() => validateCourseSummary(summary({ notes: 'bad\x00' })), /Notes/);
  assert.equal(validateCourseSummary(summary({ notes: 'first\nsecond\tthird' })).notes, 'first\nsecond\tthird');
});
test('additive migrations are schema-only, and nullable summary storage leaves the SMS tables empty', async () => {
  const f = fixture(); try {
    assert.equal((f.sqlite.prepare('SELECT count(*) n FROM course_summaries').get() as any).n, 0);
    const created = await payload(await f.api({ id: randomUUID(), revision: 0, organizationId, programId, status: 'planned' }), 201);
    assert.equal(created.summary.source, COURSE_SUMMARY_SOURCE); assert.equal(created.summary.participants, null); assert.equal(created.summary.completers, null); assert.equal(created.summary.courseHoursPerParticipant, null);
    for (const table of ['sms_records', 'sms_aggregates']) assert.equal((f.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n, 0);
    const row = f.sqlite.prepare('SELECT * FROM course_summaries').get() as any; assert.equal(row.revision, 1); assert.equal(row.participants, null);
    assert.throws(() => f.sqlite.prepare("UPDATE course_summaries SET status='invented'").run(), /CHECK/);
    assert.throws(() => f.sqlite.prepare('UPDATE course_summaries SET participants=-1').run(), /CHECK/);
    assert.throws(() => f.sqlite.prepare('UPDATE course_summaries SET participants=1.5').run(), /CHECK/);
    assert.throws(() => f.sqlite.prepare('UPDATE course_summaries SET revision=0').run(), /CHECK/);
  } finally { f.sqlite.close(); }
});
test('summary create retries and concurrent duplicates are idempotent', async () => {
  const f = fixture(); try {
    const input = summary(); const responses = await Promise.all(Array.from({ length: 8 }, () => f.api(input)));
    assert.equal(responses.filter(response => response.status === 201).length, 1);
    assert.equal(responses.filter(response => response.status === 200).length, 7);
    const stored = (await payload(await f.api())).summaries; assert.equal(stored.length, 1); assert.equal(stored[0].revision, 1);
    assert.equal((f.sqlite.prepare('SELECT count(*) n FROM course_summaries').get() as any).n, 1);
    assert.equal((await payload(await f.api(input))).replayed, true);
    await payload(await f.api({ ...input, notes: 'Same ID but different submission' }), 409);
  } finally { f.sqlite.close(); }
});
test('editing uses optimistic concurrency, with exact retries but no lost update', async () => {
  const f = fixture(); try {
    const base = summary(); await payload(await f.api(base), 201);
    const edit = { ...base, revision: 1, participants: 25, completers: 22, status: 'completed' };
    const edits = await Promise.all(Array.from({ length: 5 }, () => f.api(edit)));
    assert.ok(edits.every(response => response.status === 200));
    const results = await Promise.all(edits.map(response => response.json() as Promise<any>)); assert.equal(results.filter(result => !result.replayed).length, 1); assert.ok(results.every(result => result.summary.revision === 2));
    await payload(await f.api({ ...edit, participants: 27 }), 409);
    const newer = { ...edit, revision: 2, notes: 'Newer edit.' }; assert.equal((await payload(await f.api(newer))).summary.revision, 3);
    await payload(await f.api(edit), 409); await payload(await f.api(base), 409);
    const stored = (await payload(await f.api())).summaries[0]; assert.equal(stored.notes, 'Newer edit.'); assert.equal(stored.participants, 25);
    await payload(await f.api({ ...base, id: randomUUID(), revision: 2 }), 404);
  } finally { f.sqlite.close(); }
});
test('competing edits at one revision accept one complete payload and reject the other', async () => {
  const f = fixture(); try {
    const base = summary(); await f.api(base);
    const variants = [{ ...base, revision: 1, notes: 'First writer', participants: 21 }, { ...base, revision: 1, notes: 'Second writer', participants: 22 }];
    const responses = await Promise.all(variants.map(input => f.api(input)));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const winner = variants[responses.findIndex(response => response.status === 200)];
    const stored = (await payload(await f.api())).summaries[0]; assert.equal(stored.notes, winner.notes); assert.equal(stored.participants, winner.participants); assert.equal(stored.revision, 2);
  } finally { f.sqlite.close(); }
});
test('existing organization/program references are validated, including cross-organization mismatch', async () => {
  const f = fixture(); try {
    await payload(await f.api(summary({ programId: randomUUID() })), 400);
    await payload(await f.api(summary({ organizationId: otherOrganizationId })), 400);
    f.sqlite.prepare('UPDATE sms_programs SET active=0 WHERE id=?').run(programId);
    await payload(await f.api(summary()), 201); // Historical summaries can refer to inactive programs.
    const data = await payload(await f.api()); assert.equal(data.programs.find((program: any) => program.id === programId).active, false);
  } finally { f.sqlite.close(); }
});
test('manual summaries and their edits cannot change SMS ledger history or aggregates', async () => {
  const f = fixture(); try {
    f.sqlite.prepare(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,teacher_id,organization_id,program_id,organization_name,program_name,attendees,session_minutes,received_at,processed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), 'SM' + 'd'.repeat(32), '+14155550101', '20 2', 'counted', randomUUID(), organizationId, programId, 'Synthetic organization', 'Synthetic program', 20, 120, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    const ledger = f.sqlite.prepare('SELECT * FROM sms_records').all(); const aggregates = f.sqlite.prepare('SELECT * FROM sms_aggregates').all();
    const base = summary({ status: 'planned', participants: 999, completers: 999, courseHoursPerParticipant: 1000 }); await payload(await f.api(base), 201);
    await payload(await f.api({ ...base, revision: 1, status: 'completed', participants: 0, completers: 0, courseHoursPerParticipant: null }));
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records').all(), ledger); assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_aggregates').all(), aggregates);
    const data = await payload(await f.api()); assert.equal(data.summaries[0].participants, 0); assert.equal(data.summaries[0].completers, 0); assert.equal(data.summaries[0].courseHoursPerParticipant, null);
    assert.equal(data.totals, undefined); assert.doesNotMatch(JSON.stringify(data), /senderPhone|sender_phone|14155550101|message_sid|teacherId|participantMinutes|uniquePeople/);
    assert.deepEqual(Object.keys(data.organizations[0]).sort(), ['active', 'id', 'name']); assert.deepEqual(Object.keys(data.programs[0]).sort(), ['active', 'id', 'name', 'organizationId']);
  } finally { f.sqlite.close(); }
});
test('GET is bounded, deterministic, explicitly truncated, privately cached and filterable', async () => {
  const f = fixture(); try {
    for (let index = 0; index < COURSE_SUMMARY_LIMIT + 2; index++) await payload(await f.api(summary({ id: `30000000-0000-4000-8000-${index.toString().padStart(12, '0')}` })), 201);
    const other = summary({ organizationId: otherOrganizationId, programId: otherProgramId }); await payload(await f.api(other), 201);
    f.sqlite.prepare("UPDATE course_summaries SET updated_at='2026-01-01T00:00:00.000Z'").run();
    const response = await f.api(); assert.match(response.headers.get('cache-control')!, /private, no-store/); assert.match(response.headers.get('vary')!, /Cookie/);
    const data = await payload(response); assert.equal(data.limit, COURSE_SUMMARY_LIMIT); assert.equal(data.summaries.length, COURSE_SUMMARY_LIMIT); assert.equal(data.truncated, true);
    assert.deepEqual(data.summaries.map((item: any) => item.id), [...data.summaries.map((item: any) => item.id)].sort().reverse());
    const filtered = await payload(await f.api(undefined, '?organizationId=' + otherOrganizationId)); assert.equal(filtered.summaries.length, 1); assert.equal(filtered.summaries[0].id, other.id); assert.equal(filtered.truncated, false);
    await payload(await f.api(undefined, '?organizationId=bad'), 400); await payload(await f.api(undefined, '?organizationId=' + randomUUID()), 404);
    await payload(await f.api(undefined, `?organizationId=${organizationId}&organizationId=${otherOrganizationId}`), 400);
    await payload(await f.api(undefined, '?unbounded=1'), 400);
  } finally { f.sqlite.close(); }
});
test('empty storage returns no synthetic counts and summary errors never disclose SQL', async () => {
  const f = fixture(); try {
    const empty = await payload(await f.api()); assert.deepEqual(empty.summaries, []); assert.equal(empty.truncated, false); assert.equal(empty.totals, undefined);
    f.sqlite.exec('DROP TABLE course_summaries');
    const response = await f.api(); const body = await payload(response, 500); assert.equal(body.code, 'SUMMARY_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(body), /SQLITE|no such table|SELECT|course_summaries/); assert.match(response.headers.get('cache-control')!, /no-store/);
  } finally { f.sqlite.close(); }
});
test('summary API rejects unsupported methods, invalid JSON/media types and oversized streamed bodies', async () => {
  const f = fixture(); try {
    const request = (body: BodyInit, contentType = 'application/json') => handleCourseSummaries(new Request(ORIGIN + '/api/sms/summaries', { method: 'POST', headers: { 'content-type': contentType }, body }), f.db);
    await payload(await request('{}', 'text/plain'), 415); await payload(await request('{bad'), 400); await payload(await request('[]'), 400); await payload(await request('null'), 400); await payload(await request('x'.repeat(32769)), 413);
    await payload(await request(new Uint8Array([0xff])), 400);
    await payload(await handleCourseSummaries(new Request(ORIGIN + '/api/sms/summaries', { method: 'DELETE' }), f.db), 405);
    assert.equal((f.sqlite.prepare('SELECT count(*) n FROM course_summaries').get() as any).n, 0);
  } finally { f.sqlite.close(); }
});


test('saved summary metadata is stripped before review and edit, retaining null and zero', async () => {
  const f = fixture(); try {
    const original = summary({ participants: 0, completers: null, courseHoursPerParticipant: null, facility: null });
    const saved = (await payload(await f.api(original), 201)).summary;
    assert.equal(saved.source, COURSE_SUMMARY_SOURCE); assert.ok(saved.createdAt); assert.ok(saved.organizationName);
    const draft = courseSummaryToDraft(saved);
    assert.deepEqual(Object.keys(draft).sort(), Object.keys(original).sort());
    assert.equal(draft.participants, '0'); assert.equal(draft.completers, ''); assert.equal(draft.courseHoursPerParticipant, ''); assert.equal(draft.facility, '');
    const reviewed = courseSummaryDraftToWrite({ ...draft, notes: 'Edited from saved record' });
    assert.equal(reviewed.revision, 1); assert.equal(reviewed.participants, 0); assert.equal(reviewed.completers, null);
    const edited = (await payload(await f.api(reviewed))).summary;
    assert.equal(edited.revision, 2); assert.equal(edited.notes, 'Edited from saved record'); assert.equal(edited.participants, 0); assert.equal(edited.completers, null);
    assert.throws(() => courseSummaryDraftToWrite({ ...draft, participants: 'NaN' }), /Participants/);
  } finally { f.sqlite.close(); }
});
