import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { computeWilson95, compareCohorts, summarizeRow } from '../src/lib/analysis';
import type { AggregateRow } from '../src/lib/types';

type Official = Omit<AggregateRow, 'sourcePage'> & { sourcePage: number; sourcePdfPage: number; sourceTable: string; ratePct: number };
const readJson = (name: string) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const rows: Official[] = readJson('official_cdcr.json');
const sources: { id: string; rawFile: string; sha256: string; bytes: number; url: string }[] = readJson('sources.json');
const evidence: { rowId: string; sourceId: string; pdfPage: number; rawLine: string }[] = readJson('extraction_evidence.json');
const analytic = (row: Official): AggregateRow => ({ ...row, sourcePage: String(row.sourcePage) });
const pick = (group: string, year = '2020-21') => {
  const found = rows.filter(r => r.group === group && r.releaseYear === year);
  assert.equal(found.length, 1);
  return found[0];
};
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('actual official extract has unique rows, one-to-one evidence and intact archived source files', () => {
  assert.equal(rows.length, 38);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  assert.equal(evidence.length, rows.length);
  assert.equal(new Set(evidence.map(e => e.rowId)).size, rows.length);
  for (const source of sources) {
    const pdf = readFileSync(new URL(`../${source.rawFile}`, import.meta.url));
    assert.equal(createHash('sha256').update(pdf).digest('hex'), source.sha256);
    assert.equal(pdf.byteLength, source.bytes);
    assert.equal(new URL(source.url).hostname, 'www.cdcr.ca.gov');
  }
  for (const row of rows) {
    assert.equal(row.dataKind, 'official');
    assert.equal(row.outcome, 'conviction');
    assert.equal(row.followupMonths, 36);
    assert.ok(Number.isSafeInteger(row.events) && row.events >= 0 && row.events <= row.denominator);
    assert.ok(Number.isSafeInteger(row.denominator) && row.denominator >= 30);
    assert.ok(Math.abs(100 * row.events / row.denominator - row.ratePct) <= .050000001);
    assert.ok(sources.some(s => s.id === row.sourceId));
    const ev = evidence.find(e => e.rowId === row.id)!;
    assert.equal(ev.sourceId, row.sourceId);
    assert.equal(ev.pdfPage, row.sourcePdfPage);
    assert.ok(ev.rawLine.includes(row.events.toLocaleString('en-US')));
    assert.equal(row.sourceId, row.groupType === 'program' ? 'cdcr-eacp-2020-21' : 'cdcr-statewide-2020-21');
  }
});

test('latest official reference and complete historical cohort windows are exact', () => {
  const latest = pick('All releases');
  assert.deepEqual([latest.events, latest.denominator, latest.ratePct], [11886, 30116, 39.5]);
  assert.equal(rows.filter(r => r.groupType === 'overall').length, 19);
  assert.ok(rows.every(r => Number(r.releaseYear.slice(0, 4)) <= 2020));
  for (const dimension of ['enhanced_credit', 'supervision', 'gender', 'age']) {
    const subset = rows.filter(r => r.groupType === dimension);
    assert.equal(subset.reduce((n, r) => n + r.denominator, 0), 30116);
    assert.equal(subset.reduce((n, r) => n + r.events, 0), 11886);
  }
  assert.deepEqual([pick('MCRP').events, pick('MCRP').denominator], [247, 804]);
  assert.deepEqual([pick('FCRP').events, pick('FCRP').denominator], [50, 307]);
});

test('Wilson results on real data match independent Python NormalDist reference calculations', () => {
  // Computed independently with statistics.NormalDist().inv_cdf(.975), not JS producer.
  const references: [string, number, number][] = [
    ['All releases', .38916738778429566, .4002073335709477],
    ['Earned enhanced credits', .3259283361844302, .34100089913574383],
    ['No enhanced credits', .4477555872771858, .4636476301213698],
    ['MCRP', .27630443254609216, .33995690609262386],
    ['FCRP', .12577394806492115, .20829171748258885],
  ];
  for (const [group, lower, upper] of references) {
    const row = pick(group);
    const ci = computeWilson95(row.events, row.denominator);
    near(ci.lower, lower); near(ci.upper, upper);
    const summary = summarizeRow(analytic(row));
    near(summary.ratePct, 100 * row.events / row.denominator);
    near(summary.ciLowerPct, 100 * lower); near(summary.ciUpperPct, 100 * upper);
    assert.equal(summary.outcomeCoveragePct, null);
    assert.ok(summary.warnings.some(w => /administrative population/.test(w)));
  }
});

test('real credit difference uses unrounded counts and is explicitly noncausal', () => {
  const a = analytic(pick('Earned enhanced credits'));
  const b = analytic(pick('No enhanced credits'));
  assert.deepEqual([a.events, a.denominator, b.events, b.denominator], [5011, 15029, 6875, 15087]);
  const compared = compareCohorts(a, b);
  assert.equal(compared.comparable, true);
  near(compared.riskDifferencePctPoints!, -12.226827872070562);
  assert.match(compared.interpretation, /not a causal/);
  // Published rounded percentages differ by 12.3, but exact-count analysis differs by 12.2268.
  assert.ok(Math.abs(compared.riskDifferencePctPoints! + 12.3) > .05);
});

test('actual statewide overlaps and incompatible outcome/windows cannot be compared', () => {
  const a = analytic(pick('Earned enhanced credits'));
  for (const b of [analytic(pick('All releases')), analytic(pick('Male')), { ...a, id: 'other', group: 'Other', outcome: 'arrest' }, { ...a, id: 'other', group: 'Other', followupMonths: 12 }]) {
    const result = compareCohorts(a, b);
    assert.equal(result.comparable, false);
    assert.equal(result.riskDifferencePctPoints, null);
  }
});

test('browser-facing JSON/CSV preserve all reviewed counts and pass production validation', async () => {
  const { validateAggregateRows, parseAggregateCsv } = await import('../src/lib/csv');
  const publicRows: AggregateRow[] = JSON.parse(readFileSync(new URL('../public/data/official.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateAggregateRows(publicRows).errors, []);
  const csv = parseAggregateCsv(readFileSync(new URL('../public/data/official.csv', import.meta.url), 'utf8'));
  assert.deepEqual(csv.errors, []);
  assert.equal(publicRows.length, rows.length);
  assert.deepEqual(csv.rows, publicRows.map(r => ({ ...r, dataKind: 'uploaded' })));
  for (const raw of rows) {
    const visible = publicRows.find(r => r.id === raw.id)!;
    assert.ok(visible);
    for (const key of ['id', 'releaseYear', 'groupType', 'group', 'denominator', 'events', 'outcome', 'followupMonths', 'sourceId', 'dataKind'] as const) assert.equal(visible[key], raw[key]);
    assert.ok(visible.sourcePage.includes(String(raw.sourcePage)));
    assert.equal(visible.sourcePage, `Printed p. ${raw.sourcePage}; PDF p. ${raw.sourcePdfPage}; Table ${raw.sourceTable}`);
    if (raw.releaseYear === '2020-21' && raw.groupType === 'overall') {
      assert.equal(visible.missingOutcomes, 30655 - 30116);
      near(summarizeRow(visible).outcomeCoveragePct!, 100 * 30116 / 30655);
    } else assert.equal(visible.missingOutcomes, undefined);
  }
});
