import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAggregateCsv, aggregateRowsToCsv, escapeCsvCell, MAX_CSV_BYTES, validateAggregateRows } from '../src/lib/csv';
import type { AggregateRow } from '../src/lib/types';
const header = 'id,releaseYear,groupType,group,denominator,events,outcome,followupMonths,sourceId,sourcePage';
const line = 'one,2019,age,18–24,100,25,Reconviction,36,report,10';
const row: AggregateRow = { id: 'one', releaseYear: '2019', groupType: 'age', group: '18–24', denominator: 100, events: 25, outcome: 'Reconviction', followupMonths: 36, sourceId: 'report', sourcePage: '10', dataKind: 'official' };
test('minimal schema succeeds and uploaded provenance cannot be spoofed', () => {
  const result = parseAggregateCsv(`${header},dataKind\n${line},official`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].dataKind, 'uploaded');
  assert.equal(result.rows[0].missingOutcomes, undefined);
});
test('browser CSV imports preserve explicit synthetic warnings without trusting official claims', () => {
  const synthetic = { ...row, dataKind: 'synthetic' as const };
  const parsed = parseAggregateCsv(aggregateRowsToCsv([synthetic]));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows, [synthetic]);
  assert.match(parsed.warnings.join(' '), /synthetic labels.*demonstration warnings/i);
  for (const kind of ['official', 'uploaded', 'unverified', '']) {
    const result = parseAggregateCsv(`${header},dataKind\n${line},${kind}`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].dataKind, 'uploaded');
  }
  const omitted = parseAggregateCsv(`${header}\n${line}`);
  assert.equal(omitted.rows[0].dataKind, 'uploaded');
});
test('quoted commas, escaped quotes, newlines, BOM and CRLF are supported', () => {
  const text = `\uFEFF${header}\r\none,2019,age,"Group, ""A""\nlabel",100,25,Reconviction,36,report,10\r\n`;
  const result = parseAggregateCsv(text);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].group, 'Group, "A"\nlabel');
});
test('schema round-trip preserves aggregate fields except forced provenance', () => {
  assert.deepEqual(parseAggregateCsv(aggregateRowsToCsv([row])).rows, [{ ...row, dataKind: 'uploaded' }]);
});
test('PII, unrecognized and duplicate columns are rejected', () => {
  for (const column of ['email', 'date_of_birth', 'participant_id', 'rate', 'events']) {
    const result = parseAggregateCsv(`${header},${column}\n${line},1`);
    assert.ok(result.errors.length);
    assert.equal(result.rows.length, 0);
  }
});
test('missing headers, malformed quotes and wrong field lengths are rejected', () => {
  for (const text of ['', header, `${header}\n"broken`, `${header}\n${line},extra`, `${header}\n${line}"`, 'id,events\none,2']) assert.ok(parseAggregateCsv(text).errors.length);
});
test('count, denominator, window and duplicate-id validation is fail-closed', () => {
  for (const change of [{ denominator: 0 }, { events: 101 }, { events: -1 }, { events: 1.2 }, { followupMonths: 0 }, { denominator: Infinity }, { releaseYear: '' }, { missingOutcomes: -1 }, { missingOutcomes: 1.5 }]) {
    const result = validateAggregateRows([{ ...row, ...change }]);
    assert.ok(result.errors.length);
    assert.deepEqual(result.rows, []);
  }
  assert.ok(parseAggregateCsv(`${header}\n${line}\n${line}`).errors.some(error => /duplicate id/.test(error)));
  assert.ok(parseAggregateCsv(`${header}\n${line.replace(',100,', ',0x64,')}`).errors.length);
});
test('upload byte limit and row limit are enforced', () => {
  assert.match(parseAggregateCsv('x'.repeat(MAX_CSV_BYTES + 1)).errors[0], /1 MiB/);
  const oversized = `${header}\n${Array.from({ length: 5001 }, (_, i) => line.replace('one,', `id${i},`)).join('\n')}`;
  assert.match(parseAggregateCsv(oversized).errors[0], /5000/);
});
test('formula injection is neutralized in spreadsheet exports', () => {
  for (const text of ['=SUM(A1)', '+CMD', '-1+2', '@SUM(A1)', ' \t=1', '\tformula']) assert.ok(escapeCsvCell(text).startsWith('"\''));
  assert.equal(escapeCsvCell('a"b'), '"a""b"');
});


test('fractional follow-up windows are rejected', () => {
 const csv = 'id,releaseYear,groupType,group,denominator,events,outcome,followupMonths,sourceId,sourcePage\na,2020-21,program,A,100,20,conviction,1.5,source,p1';
 assert.ok(parseAggregateCsv(csv).errors.some(e => e.includes('followupMonths')));
});
