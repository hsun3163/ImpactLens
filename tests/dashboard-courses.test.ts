import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleSmsApi, type SmsRuntime } from '../src/server/sms-api';
import { DASHBOARD_COURSE_LIMIT, DASHBOARD_COURSE_POINT_LIMIT } from '../src/server/course-attendance-batch';
import type { CourseAttendanceData, CourseIdentity } from '../src/lib/course-attendance';

const ORIGIN = 'https://impactlens.example.test';
const PATH = '/api/sms/dashboard';
const NOW = '2026-01-01T00:00:00.000Z';
const uuid = (group: number, sequence: number) => `${group}0000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
const organizationId = uuid(1, 1);
const otherOrganizationId = uuid(1, 2);
const emptyOrganizationId = uuid(1, 3);
const programId = uuid(2, 1);
const secondProgramId = uuid(2, 2);
const otherProgramId = uuid(2, 3);
const teacherId = uuid(3, 1);
const PHONE = '+14155550101';
const QUERY = `?organizationId=${organizationId}&includeCourses=1`;
const ZERO_TOTALS = { sessions: 0, attendees: 0, sessionMinutes: 0, participantMinutes: 0 };
const IDENTITY_KEYS = ['id', 'organizationId', 'programId', 'organizationName', 'programName', 'facility', 'yard', 'startDate', 'endDate'].sort();

type CourseSeed = CourseIdentity & {
  status: CourseAttendanceData['course']['status']; participants: number | null; createdAt: string;
};
type RecordOptions = {
  id?: string; organizationId?: string; programId?: string; attendees?: number; sessionMinutes?: number;
  receivedAt?: string; processedAt?: string; status?: 'counted' | 'quarantined';
  acceptedOrder?: number; repeatedFromRecordId?: string; snapshot?: CourseIdentity;
};

/** Real migrations, triggers, SQL and transactions; the adapter only supplies D1's interface. */
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  const prepared: string[] = [];
  const executed: { sql: string; method: string; inBatch: boolean }[] = [];
  const batches: number[] = [];
  let inBatch = false;
  const prepare = (sql: string) => {
    prepared.push(sql);
    let values: (string | number | null)[] = [];
    const recordExecution = (method: string) => executed.push({ sql, method, inBatch });
    const statement = {
      bind(...args: (string | number | null)[]) { values = args; return statement; },
      async first(column?: string) {
        recordExecution('first');
        const row = sqlite.prepare(sql).get(...values) as Record<string, unknown> | undefined;
        return row ? column ? row[column] : row : null;
      },
      async all() {
        recordExecution('all');
        return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} };
      },
      async run() {
        recordExecution('run');
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  const env: SmsRuntime = {
    DB: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        batches.push(statements.length);
        sqlite.exec('BEGIN');
        inBatch = true;
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.all());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        } finally { inBatch = false; }
      },
    } as unknown as D1Database,
    TPW_ADMIN_USER_IDS: 'tpw-admin',
  };
  for (const [id, name, slug] of [
    [organizationId, 'Synthetic organization', 'synthetic'],
    [otherOrganizationId, 'Other organization', 'other'],
    [emptyOrganizationId, 'Empty organization', 'empty'],
  ]) sqlite.prepare('INSERT INTO sms_organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, name, slug, NOW, NOW);
  for (const [id, org, name] of [
    [programId, organizationId, 'Alpha program'],
    [secondProgramId, organizationId, 'Beta program'],
    [otherProgramId, otherOrganizationId, 'Other program'],
  ]) sqlite.prepare('INSERT INTO sms_programs(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, org, name, NOW, NOW);
  sqlite.prepare('INSERT INTO sms_teachers(id,phone,name,program_id,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(teacherId, PHONE, 'Private teacher name', programId, NOW, NOW);

  let courseSequence = 0;
  function course(options: Partial<CourseSeed> = {}): CourseSeed {
    const selectedProgramId = options.programId ?? programId;
    const selectedOrganizationId = options.organizationId ?? organizationId;
    const organization = sqlite.prepare('SELECT name FROM sms_organizations WHERE id=?').get(selectedOrganizationId) as { name: string };
    const program = sqlite.prepare('SELECT name FROM sms_programs WHERE id=?').get(selectedProgramId) as { name: string };
    const result: CourseSeed = {
      id: uuid(4, ++courseSequence), organizationId: selectedOrganizationId, programId: selectedProgramId,
      organizationName: organization.name, programName: program.name,
      facility: 'Original facility', yard: 'Original yard', startDate: '2025-12-01', endDate: null,
      status: 'planned', participants: null, createdAt: NOW, ...options,
    };
    sqlite.prepare(`INSERT INTO course_summaries(id,revision,organization_id,program_id,facility,yard,status,start_date,end_date,
      participants,notes,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(result.id, result.organizationId, result.programId, result.facility, result.yard, result.status, result.startDate,
        result.endDate, result.participants, 'Private course notes must not appear', result.createdAt, NOW);
    return result;
  }
  let recordSequence = 0;
  function record(course: CourseSeed | null, options: RecordOptions = {}) {
    const index = ++recordSequence;
    const id = options.id ?? uuid(5, index);
    const org = options.organizationId ?? course?.organizationId ?? organizationId;
    const program = options.programId ?? course?.programId ?? programId;
    const organizationName = (sqlite.prepare('SELECT name FROM sms_organizations WHERE id=?').get(org) as { name: string }).name;
    const programName = (sqlite.prepare('SELECT name FROM sms_programs WHERE id=?').get(program) as { name: string }).name;
    const snapshot: CourseIdentity | null = options.snapshot ?? (course ? {
      id: course.id, organizationId: org, programId: program, organizationName, programName,
      facility: course.facility, yard: course.yard, startDate: course.startDate, endDate: course.endDate,
    } : null);
    const status = options.status ?? 'counted';
    const receivedAt = options.receivedAt ?? NOW;
    sqlite.prepare(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,reason,teacher_id,organization_id,program_id,
      organization_name,program_name,course_id,course_snapshot_json,attendees,session_minutes,received_at,processed_at,
      accepted_order,repeated_from_record_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, 'SM' + index.toString(16).padStart(32, '0'), PHONE, 'Private raw SMS body', status,
        status === 'counted' ? null : 'INVALID_BODY', teacherId, org, program, organizationName, programName,
        course?.id ?? null, snapshot ? JSON.stringify(snapshot) : null, options.attendees ?? 1, options.sessionMinutes ?? 60,
        receivedAt, status === 'counted' ? options.processedAt ?? receivedAt : null,
        options.acceptedOrder ?? null, options.repeatedFromRecordId ?? null);
    return { id, snapshot };
  }
  async function api(query = QUERY, user: string | null = 'tpw-admin', extra: Record<string, string> = {}, method = 'GET') {
    return handleSmsApi(new Request(ORIGIN + PATH + query, {
      method,
      headers: {
        ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@example.test` } : {}),
        ...extra,
      },
    }), env);
  }
  function snapshot() {
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    return Object.fromEntries(tables.map(({ name }) => [name, sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  }
  const resetQueries = () => { prepared.length = 0; executed.length = 0; batches.length = 0; };
  return { sqlite, env, api, course, record, snapshot, prepared, executed, batches, resetQueries };
}

async function payload(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
function attendance(data: any, id: string): CourseAttendanceData {
  const result = data.courseAttendance.find((item: CourseAttendanceData) => item.course.id === id);
  assert.ok(result, `Missing attendance for ${id}`);
  return result;
}
function assertBatch(f: ReturnType<typeof fixture>, count = 8) {
  assert.deepEqual(f.batches, [count], 'Every read belongs to one D1 batch/snapshot');
  assert.equal(f.prepared.length, count, 'No per-course preparation or lookup');
  assert.equal(f.executed.length, count, 'Every prepared read executes exactly once');
  assert.ok(f.executed.every(query => query.inBatch && query.method === 'all'));
  assert.ok(f.prepared.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql)), 'Only read statements are permitted');
}

test('dashboard course bounds are exported as 100 courses and 100 points each', () => {
  assert.equal(DASHBOARD_COURSE_LIMIT, 100);
  assert.equal(DASHBOARD_COURSE_POINT_LIMIT, 100);
});

test('dashboard course reads retain the TPW admin gate and private response headers', async () => {
  const f = fixture();
  try {
    assert.equal((await payload(await f.api(QUERY, null), 401)).code, 'SIGN_IN_REQUIRED');
    assert.equal((await payload(await f.api(QUERY, 'other-user'), 403)).code, 'ADMIN_REQUIRED');
    assert.equal((await payload(await f.api(QUERY, 'tpw-admin', { 'oai-authenticated-user-email': '' }), 401)).code, 'SIGN_IN_REQUIRED');
    f.env.TPW_ADMIN_USER_IDS = '';
    assert.equal((await payload(await f.api(), 503)).code, 'ADMIN_NOT_CONFIGURED');
    assert.deepEqual(f.prepared, []);
    f.env.TPW_ADMIN_USER_IDS = 'tpw-admin';
    const response = await f.api();
    await payload(response);
    assert.match(response.headers.get('cache-control')!, /private, no-store/);
    assert.match(response.headers.get('vary')!, /Cookie/);
    assert.match(response.headers.get('vary')!, /oai-authenticated-user-id/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    f.env.DB = undefined;
    assert.equal((await payload(await f.api(), 503)).code, 'STORAGE_UNAVAILABLE');
  } finally { f.sqlite.close(); }
});

test('course opt-in requires one explicit valid organization and rejects ambiguous or unsupported filters before SQL', async () => {
  const f = fixture();
  try {
    const invalid = [
      '?includeCourses=1', '?organizationId=&includeCourses=1', '?organizationId=invalid&includeCourses=1',
      `?organizationId=${organizationId}&includeCourses=`, `?organizationId=${organizationId}&includeCourses=0`,
      `?organizationId=${organizationId}&includeCourses=true`, `?organizationId=${organizationId}&includeCourses=01`,
      `?organizationId=${organizationId}&includeCourses=2`, `?organizationId=${organizationId}&includeCourses=1%20`,
      `${QUERY}&includeCourses=1`, `${QUERY}&includeCourses=0`,
      `${QUERY}&organizationId=${organizationId}`, `${QUERY}&organizationId=${otherOrganizationId}`,
      `${QUERY}&organizationId=`, `${QUERY}&programId=${programId}`, `${QUERY}&courseId=${uuid(4, 1)}`,
      `${QUERY}&status=completed`, `${QUERY}&limit=1`, `${QUERY}&offset=100`, `${QUERY}&unexpected=yes`,
    ];
    for (const query of invalid) await payload(await f.api(query), 400);
    assert.deepEqual(f.prepared, []);
    assert.deepEqual(f.batches, []);
    const missing = await payload(await f.api(`?organizationId=${uuid(1, 999)}&includeCourses=1`), 404);
    assert.equal(missing.code, 'NOT_FOUND');
  } finally { f.sqlite.close(); }
});

test('default dashboard remains a six-read response with identical existing data and no course extension', async () => {
  const f = fixture();
  try {
    const course = f.course({ participants: 25 });
    f.record(course, { attendees: 7, sessionMinutes: 90 });
    f.record(null, { attendees: 3, sessionMinutes: 60 });
    const other = f.course({ organizationId: otherOrganizationId, programId: otherProgramId });
    f.record(other, { attendees: 12 });
    const regular = await payload(await f.api(`?organizationId=${organizationId}`));
    assertBatch(f, 6);
    assert.deepEqual(Object.keys(regular).sort(), ['generatedAt', 'lastReceivedAt', 'organization', 'organizations', 'participantEstimate', 'programs', 'recent', 'serviceEstimate', 'totals']);
    assert.deepEqual(regular.totals, { sessions: 2, attendees: 10, sessionMinutes: 150, participantMinutes: 810 });
    f.resetQueries();
    const extended = await payload(await f.api());
    assertBatch(f);
    const { generatedAt: _regularTime, ...base } = regular;
    const { generatedAt: _extendedTime, courseAttendance: courses, coursesTruncated, ...unchanged } = extended;
    assert.deepEqual(unchanged, base);
    assert.equal(courses.length, 1);
    assert.equal(coursesTruncated, false);
    f.resetQueries();
    const network = await payload(await f.api(''));
    assertBatch(f, 6);
    assert.equal(network.organization, null);
    assert.equal(network.totals.sessions, 3);
    assert.equal('courseAttendance' in network, false);
    assert.equal('coursesTruncated' in network, false);
  } finally { f.sqlite.close(); }
});

test('empty organizations and organizations with no courses return explicit empty course collections', async () => {
  const f = fixture();
  try {
    for (const org of [organizationId, emptyOrganizationId]) {
      f.resetQueries();
      const data = await payload(await f.api(`?organizationId=${org}&includeCourses=1`));
      assert.deepEqual(data.courseAttendance, []);
      assert.equal(data.coursesTruncated, false);
      assert.deepEqual(data.totals, ZERO_TOTALS);
      assert.equal(data.organization.id, org);
      assert.equal(data.lastReceivedAt, null);
      assertBatch(f);
    }
  } finally { f.sqlite.close(); }
});

test('planned, in-progress and completed courses preserve unknown, configured and observed zero participant values', async () => {
  const f = fixture();
  try {
    const unknown = f.course({ status: 'planned', facility: null, yard: null, startDate: null, participants: null });
    const configuredZero = f.course({ status: 'in-progress', participants: 0 });
    const configured = f.course({ status: 'completed', participants: 22 });
    const observedZero = f.course({ status: 'completed', participants: 99 });
    f.record(observedZero, { attendees: 0, sessionMinutes: 15 });
    // Deactivation is not permission to erase historical or planned course cards.
    f.sqlite.prepare('UPDATE sms_organizations SET active=0 WHERE id=?').run(organizationId);
    f.sqlite.prepare('UPDATE sms_programs SET active=0 WHERE organization_id=?').run(organizationId);
    const data = await payload(await f.api());
    assert.equal(data.courseAttendance.length, 4);
    assert.deepEqual(attendance(data, unknown.id).participantEstimate, { value: null, source: 'unknown' });
    assert.deepEqual(attendance(data, configuredZero.id).participantEstimate, { value: 0, source: 'configured-maximum' });
    assert.deepEqual(attendance(data, configured.id).participantEstimate, { value: 22, source: 'configured-maximum' });
    assert.deepEqual(attendance(data, observedZero.id).participantEstimate, { value: 0, source: 'sms-maximum' });
    for (const course of [unknown, configuredZero, configured]) {
      const entry = attendance(data, course.id);
      assert.deepEqual(entry.points, []);
      assert.deepEqual(entry.totals, ZERO_TOTALS);
      assert.equal(entry.course.status, course.status);
      assert.equal(entry.truncated, false);
      assert.equal(entry.sequenceBasis, 'receipt-order');
      assert.equal(entry.generatedAt, data.generatedAt);
    }
    assert.equal(attendance(data, unknown.id).course.facility, null);
    assert.equal(attendance(data, unknown.id).course.yard, null);
    assert.equal(attendance(data, unknown.id).course.startDate, null);
    assert.deepEqual(attendance(data, observedZero.id).totals, { sessions: 1, attendees: 0, sessionMinutes: 15, participantMinutes: 0 });
    assert.equal(attendance(data, observedZero.id).points[0].attendees, 0);
    assertBatch(f);
  } finally { f.sqlite.close(); }
});

test('course collections omit other organizations, quarantines, program-only and mismatched legacy records', async () => {
  const f = fixture();
  try {
    const own = f.course();
    const sibling = f.course({ programId: secondProgramId });
    const other = f.course({ organizationId: otherOrganizationId, programId: otherProgramId });
    const malformedCourse = f.course({ organizationId, programId: otherProgramId });
    const accepted = f.record(own, { attendees: 4 });
    f.record(sibling, { attendees: 6 });
    f.record(other, { attendees: 777 });
    f.record(own, { attendees: 888, status: 'quarantined' });
    f.record(null, { attendees: 999 });
    // Explicitly model externally corrupted legacy history, not a permitted API write.
    f.sqlite.exec('DROP TRIGGER sms_course_validate_insert');
    f.record(own, { organizationId: otherOrganizationId, programId: otherProgramId, attendees: 9000 });
    f.record(own, { programId: secondProgramId, attendees: 8000 });
    const data = await payload(await f.api());
    assert.deepEqual(data.courseAttendance.map((entry: CourseAttendanceData) => entry.course.id), [own.id, sibling.id]);
    assert.ok(!data.courseAttendance.some((entry: CourseAttendanceData) => [other.id, malformedCourse.id].includes(entry.course.id)));
    const ownData = attendance(data, own.id);
    assert.deepEqual(ownData.points.map(point => point.id), [accepted.id]);
    assert.deepEqual(ownData.totals, { sessions: 1, attendees: 4, sessionMinutes: 60, participantMinutes: 240 });
    assert.deepEqual(ownData.participantEstimate, { value: 4, source: 'sms-maximum' });
    assert.equal(attendance(data, sibling.id).totals.attendees, 6);
    assertBatch(f);
    f.resetQueries();
    const otherData = await payload(await f.api(`?organizationId=${otherOrganizationId}&includeCourses=1`));
    assert.deepEqual(otherData.courseAttendance.map((entry: CourseAttendanceData) => entry.course.id), [other.id]);
    assert.equal(attendance(otherData, other.id).totals.attendees, 777);
    assertBatch(f);
  } finally { f.sqlite.close(); }
});

test('course points use receipt order with deterministic ID ties rather than processing, acceptance or class dates', async () => {
  const f = fixture();
  try {
    const course = f.course({ startDate: '2030-01-01', endDate: '2030-02-01' });
    const second = f.record(course, { id: uuid(5, 20), attendees: 2, receivedAt: NOW, processedAt: '2026-03-03', acceptedOrder: 1 });
    const third = f.record(course, { id: uuid(5, 30), attendees: 3, receivedAt: '2026-01-02', processedAt: '2026-03-01', acceptedOrder: 2 });
    const first = f.record(course, { id: uuid(5, 10), attendees: 1, receivedAt: NOW, processedAt: '2026-03-02', acceptedOrder: 3 });
    const data = attendance(await payload(await f.api()), course.id);
    assert.deepEqual(data.points.map(point => point.id), [first.id, second.id, third.id]);
    assert.deepEqual(data.points.map(point => point.sequence), [1, 2, 3]);
    assert.deepEqual(data.points.map(point => point.attendees), [1, 2, 3]);
    assert.equal(data.sequenceBasis, 'receipt-order');
    assert.equal(data.points[0].receivedAt, data.points[1].receivedAt);
    assert.ok(data.points[1].processedAt > data.points[2].processedAt);
    assert.equal(data.points[0].courseSnapshot.startDate, '2030-01-01');
  } finally { f.sqlite.close(); }
});

test('current course metadata does not rewrite original accepted snapshots or repeat attribution', async () => {
  const f = fixture();
  try {
    const course = f.course();
    const baseline = f.record(course, { attendees: 7 });
    const repeat = f.record(course, { attendees: 7, receivedAt: '2026-01-02', repeatedFromRecordId: baseline.id });
    const originalRecords = f.sqlite.prepare('SELECT * FROM sms_records ORDER BY id').all();
    f.sqlite.prepare('UPDATE course_summaries SET facility=?,yard=?,start_date=?,end_date=?,status=?,revision=revision+1 WHERE id=?')
      .run('Current facility', 'Current yard', '2026-02-01', '2026-02-28', 'completed', course.id);
    f.sqlite.prepare('UPDATE sms_organizations SET name=? WHERE id=?').run('Current organization', organizationId);
    f.sqlite.prepare('UPDATE sms_programs SET name=? WHERE id=?').run('Current program', programId);
    const replacement = f.course();
    f.sqlite.prepare('UPDATE sms_teachers SET course_id=? WHERE id=?').run(replacement.id, teacherId);
    const data = await payload(await f.api());
    const entry = attendance(data, course.id);
    assert.equal(entry.course.organizationName, 'Current organization');
    assert.equal(entry.course.programName, 'Current program');
    assert.equal(entry.course.facility, 'Current facility');
    assert.equal(entry.course.yard, 'Current yard');
    assert.equal(entry.course.startDate, '2026-02-01');
    assert.equal(entry.course.status, 'completed');
    assert.deepEqual(entry.points.map(point => point.courseSnapshot), [baseline.snapshot, repeat.snapshot]);
    assert.equal(entry.points[1].repeatedFromRecordId, baseline.id);
    assert.deepEqual(attendance(data, replacement.id).points, []);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM sms_records ORDER BY id').all(), originalRecords);
    assert.throws(() => f.sqlite.prepare("UPDATE sms_records SET course_snapshot_json='{}' WHERE id=?").run(baseline.id), /immutable|Invalid SMS course snapshot/);
  } finally { f.sqlite.close(); }
});

test('each course keeps its latest 100 receipt-ordered points while totals, original sequence and peak use full history', async () => {
  const f = fixture();
  try {
    const first = f.course({ participants: 9999 });
    const second = f.course({ programId: secondProgramId });
    for (let index = 0; index < 105; index++) f.record(first, {
      attendees: index === 0 ? 999 : index === 1 ? 0 : 1,
      receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      processedAt: new Date(Date.UTC(2026, 0, 2, 0, 0, 105 - index)).toISOString(),
    });
    for (let index = 0; index < 102; index++) f.record(second, {
      attendees: 2, receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    });
    const data = await payload(await f.api());
    const a = attendance(data, first.id);
    const b = attendance(data, second.id);
    assert.equal(a.points.length, 100);
    assert.equal(b.points.length, 100, 'The cap is per course, not across the response');
    assert.equal(a.truncated, true);
    assert.equal(b.truncated, true);
    assert.equal(data.coursesTruncated, false);
    assert.deepEqual(a.points.map(point => point.sequence), Array.from({ length: 100 }, (_, i) => i + 6));
    assert.deepEqual(b.points.map(point => point.sequence), Array.from({ length: 100 }, (_, i) => i + 3));
    assert.equal(Math.max(...a.points.map(point => point.attendees)), 1);
    assert.deepEqual(a.participantEstimate, { value: 999, source: 'sms-maximum' });
    assert.deepEqual(a.totals, { sessions: 105, attendees: 1102, sessionMinutes: 6300, participantMinutes: 66120 });
    assert.deepEqual(b.totals, { sessions: 102, attendees: 204, sessionMinutes: 6120, participantMinutes: 12240 });
    assert.ok(a.points[0].receivedAt < a.points.at(-1)!.receivedAt);
    assert.ok(a.points[0].processedAt > a.points.at(-1)!.processedAt);
    assertBatch(f);
  } finally { f.sqlite.close(); }
});

test('100 points are not marked truncated and receipt-ID ties determine which older points are omitted', async () => {
  const f = fixture();
  try {
    const course = f.course();
    for (let index = 100; index >= 1; index--) f.record(course, { id: uuid(6, index), receivedAt: NOW });
    let data = attendance(await payload(await f.api()), course.id);
    assert.equal(data.points.length, 100);
    assert.equal(data.truncated, false);
    assert.equal(data.points[0].id, uuid(6, 1));
    assert.equal(data.points.at(-1)!.id, uuid(6, 100));
    f.record(course, { id: uuid(6, 101), receivedAt: NOW });
    f.resetQueries();
    data = attendance(await payload(await f.api()), course.id);
    assert.equal(data.points.length, 100);
    assert.equal(data.truncated, true);
    assert.equal(data.points[0].id, uuid(6, 2));
    assert.equal(data.points[0].sequence, 2);
    assert.equal(data.points.at(-1)!.id, uuid(6, 101));
    assert.equal(data.points.at(-1)!.sequence, 101);
    assertBatch(f);
  } finally { f.sqlite.close(); }
});

test('course cap follows program name, creation time and ID, signals omission, and never caps organization totals', async () => {
  const f = fixture();
  try {
    const courses: CourseSeed[] = [];
    for (let index = 100; index >= 1; index--) {
      const course = f.course({
        id: uuid(4, index), programId: index % 2 ? programId : secondProgramId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, Math.floor(index / 4))).toISOString(),
        status: (['planned', 'in-progress', 'completed'] as const)[index % 3],
      });
      courses.push(course);
      f.record(course);
    }
    const compare = (a: CourseSeed, b: CourseSeed) => {
      for (const key of ['programName', 'createdAt', 'id'] as const) {
        if (a[key] < b[key]) return -1;
        if (a[key] > b[key]) return 1;
      }
      return 0;
    };
    let data = await payload(await f.api());
    assert.equal(data.courseAttendance.length, 100);
    assert.equal(data.coursesTruncated, false);
    assert.deepEqual(data.courseAttendance.map((entry: CourseAttendanceData) => entry.course.id), courses.slice().sort(compare).map(course => course.id));
    assertBatch(f);
    const newFirst = f.course({ id: uuid(4, 101), programId, createdAt: '2025-01-01T00:00:00.000Z' });
    courses.push(newFirst);
    f.record(newFirst, { attendees: 10 });
    f.resetQueries();
    data = await payload(await f.api());
    const selected = courses.slice().sort(compare).slice(0, 100);
    assert.equal(data.courseAttendance.length, 100);
    assert.equal(data.coursesTruncated, true);
    assert.deepEqual(data.courseAttendance.map((entry: CourseAttendanceData) => entry.course.id), selected.map(course => course.id));
    assert.equal(data.courseAttendance[0].course.id, newFirst.id);
    assert.ok(data.courseAttendance.every((entry: CourseAttendanceData) => entry.points.length === 1 && !entry.truncated));
    assert.deepEqual(data.totals, { sessions: 101, attendees: 110, sessionMinutes: 6060, participantMinutes: 6600 });
    assert.equal(data.courseAttendance.reduce((sum: number, entry: CourseAttendanceData) => sum + entry.totals.sessions, 0), 100);
    assertBatch(f);
  } finally { f.sqlite.close(); }
});

test('dashboard course DTOs expose only chart-safe fields and polling changes no stored state', async () => {
  const f = fixture();
  try {
    const course = f.course();
    f.record(course, { attendees: 8, sessionMinutes: 90 });
    const before = f.snapshot();
    // An accidental write fails at the SQLite boundary even if its rows were later restored.
    f.sqlite.exec('PRAGMA query_only=ON');
    const data = await payload(await f.api());
    assertBatch(f);
    assert.deepEqual(f.snapshot(), before);
    const entry = attendance(data, course.id);
    assert.deepEqual(Object.keys(entry).sort(), ['course', 'generatedAt', 'participantEstimate', 'points', 'sequenceBasis', 'totals', 'truncated']);
    assert.deepEqual(Object.keys(entry.course).sort(), [...IDENTITY_KEYS, 'status'].sort());
    assert.deepEqual(Object.keys(entry.points[0].courseSnapshot).sort(), IDENTITY_KEYS);
    assert.deepEqual(Object.keys(entry.points[0]).sort(), ['attendees', 'courseSnapshot', 'id', 'participantMinutes', 'processedAt', 'receivedAt', 'repeatedFromRecordId', 'sequence', 'sessionMinutes']);
    assert.doesNotMatch(JSON.stringify(data), /Private raw SMS body|Private teacher name|Private course notes|14155550101|SM[0-9a-f]{32}|"(?:body|notes|phone|senderPhone|sender_phone|messageSid|message_sid|teacherId|teacher_id|acceptedOrder|manualCorrection)"/);
    f.resetQueries();
    const again = await payload(await f.api());
    assertBatch(f);
    const { generatedAt: _first, ...firstData } = entry;
    const { generatedAt: _next, ...nextData } = attendance(again, course.id);
    assert.deepEqual(nextData, firstData);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.sqlite.close(); }
});
