import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWilson95, summarizeRow, compareCohorts } from '../src/lib/analysis';
import type { AggregateRow } from '../src/lib/types';

const row: AggregateRow = { id: 'a', releaseYear: '2019–20', groupType: 'age', group: '18–24', denominator: 100, events: 25, outcome: 'Reconviction', followupMonths: 36, sourceId: 'report', sourcePage: '10', dataKind: 'official' };
test('rate derives from counts and Wilson agrees with a hand-calculated benchmark', () => {
  const s = summarizeRow(row);
  assert.equal(s.ratePct, 25);
  assert.ok(Math.abs(s.ciLowerPct - 17.5452) < 0.001);
  assert.ok(Math.abs(s.ciUpperPct - 34.304464) < 0.001);
  assert.equal(s.outcomeCoveragePct, null);
});
test('Wilson boundaries are finite and inside the unit interval', () => {
  assert.equal(computeWilson95(0, 1).lower, 0);
  assert.equal(computeWilson95(1, 1).upper, 1);
  assert.ok(Math.abs(computeWilson95(0, 10).upper - 0.2775328) < 1e-6);
  for (let n = 1; n <= 100; n++) for (let k = 0; k <= n; k++) {
    const ci = computeWilson95(k, n);
    assert.ok(ci.lower >= 0 && ci.upper <= 1 && ci.lower <= k/n && ci.upper >= k/n);
  }
});
test('invalid counts throw instead of generating misleading rates', () => {
  for (const [k, n] of [[0, 0], [2, 1], [-1, 5], [1.5, 10], [1, Infinity], [1, NaN]]) assert.throws(() => computeWilson95(k, n), RangeError);
});
test('descriptive risk difference is A minus B, not a causal effect', () => {
  const result = compareCohorts(row, { ...row, id: 'b', group: '25–34', events: 30 });
  assert.equal(result.comparable, true);
  assert.equal(result.riskDifferencePctPoints, -5);
  assert.match(result.interpretation, /not a causal/);
});
test('incompatible definitions, years, dimensions and windows cannot be compared', () => {
  for (const change of [{ releaseYear: '2020' }, { outcome: 'Rearrest' }, { followupMonths: 12 }, { groupType: 'sex' }, { dataKind: 'synthetic' as const }, { group: 'Total' }]) {
    const result = compareCohorts(row, { ...row, id: 'b', group: 'Other', ...change });
    assert.equal(result.comparable, false);
    assert.equal(result.riskDifferencePctPoints, null);
  }
  assert.equal(compareCohorts(row, row).comparable, false);
});
test('coverage does not imply missing outcomes are successes or failures', () => {
  const s = summarizeRow({ ...row, missingOutcomes: 25 });
  assert.equal(s.outcomeCoveragePct, 80);
  assert.equal(s.ratePct, 25);
  assert.match(s.warnings.join(' '), /missing/);
  assert.match(s.warnings.join(' '), /not sampling uncertainty/);
});
