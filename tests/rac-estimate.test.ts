import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePersonYearRac, estimateRacByPersonYear, estimateAggregateRacEquivalent } from '../src/lib/rac-estimate';
test('104 eligible hours illustrates 20 days, .055 years and $1,180', () => {
  const result = estimatePersonYearRac(104);
  assert.equal(result.estimatedDays, 20);
  assert.equal(result.yearsEquivalent.toFixed(3), '0.055');
  assert.equal(Math.round(result.estimatedCostAvoided), 1180);
  assert.equal(result.hoursTowardNextIncrement, 0);
});
test('increments, remainder and annual cap', () => {
  for (const [hours, days, remainder] of [[0,0,0],[51.5,0,51.5],[52,10,0],[103,10,51],[208,40,null],[500,40,null]]) {
    const result = estimatePersonYearRac(hours!);
    assert.equal(result.estimatedDays, days); assert.equal(result.hoursTowardNextIncrement, remainder);
  }
});
test('sums attendance only within each person and anniversary year', () => {
  const result = estimateRacByPersonYear([
    { personId:'a',creditAnniversaryYear:'year-1',eligibleHours:26 },
    { personId:'a',creditAnniversaryYear:'year-1',eligibleHours:26 },
    { personId:'b',creditAnniversaryYear:'year-1',eligibleHours:26 },
    { personId:'b',creditAnniversaryYear:'year-2',eligibleHours:26 },
  ]);
  assert.deepEqual(result.map(row => row.estimatedDays), [10,0,0]);
  assert.deepEqual(estimateRacByPersonYear([]), []);
});
test('invalid or missing evidence scope is rejected', () => {
  for (const hours of [-1, NaN, Infinity]) assert.throws(() => estimatePersonYearRac(hours));
  assert.throws(() => estimateRacByPersonYear([{personId:'',creditAnniversaryYear:'year',eligibleHours:52}]));
  assert.throws(() => estimateRacByPersonYear([{personId:'a',creditAnniversaryYear:'',eligibleHours:52}]));
});

test('excess hours are preserved without automatic carryover', () => { assert.equal(estimatePersonYearRac(250).excessHoursAboveAnnualCap, 42); });

test('aggregate proxy is continuous, minute-based and uncapped rather than pooled awards', () => {
  for (const hours of [0, 26, 104, 335, 515]) {
    const result = estimateAggregateRacEquivalent(hours * 60);
    assert.equal(result.participantHours, hours);
    assert.equal(result.equivalentDays, hours * 10 / 52);
    assert.equal(result.yearsEquivalent, result.equivalentDays / 365);
    assert.equal(result.costEquivalent, result.equivalentDays * 21534 / 365);
    assert.equal('hoursTowardNextIncrement' in result, false);
  }
  assert.equal(estimateAggregateRacEquivalent(26 * 60).equivalentDays, 5);
  assert.ok(estimateAggregateRacEquivalent(515 * 60).equivalentDays > 40);
  for (const value of [-1, NaN, Infinity]) assert.throws(() => estimateAggregateRacEquivalent(value));
});
test('dashboard uses changing live minutes and removes static examples and confirmed-award cards', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: RacMetrics } = await import('../src/components/RacMetrics');
  const html = renderToStaticMarkup(createElement(RacMetrics, {participantMinutes:335*60}));
  assert.match(html, /Estimated RAC equivalent/); assert.match(html, /Aggregate estimate/);
  assert.match(html, /64\.42/); assert.match(html, /\$3,801/); assert.match(html, /0\.177 years equivalent/);
  assert.match(html, /Based on 335 recorded participant-hours/);
  assert.doesNotMatch(html, /Unknown|CDCR-Confirmed/);
  assert.doesNotMatch(html, /toward the next|Illustrative example|il-help-trigger/);
  assert.match(html, /How this is estimated/);
  const updated = renderToStaticMarkup(createElement(RacMetrics, {participantMinutes:515*60}));
  assert.match(updated, /99\.04/); assert.match(updated, /\$5,843/);
});
test('all dashboard entry points wire counted participant minutes, not projected or teaching hours', async () => {
  const {readFileSync} = await import('node:fs');
  for (const [file, expression] of [['OrganizationHome.tsx','live.data.totals.participantMinutes'],['SmsDashboard.tsx','data.totals.participantMinutes'],['SmsDemo.tsx','organizationTotals.participantMinutes']]) {
    assert.ok(readFileSync(`src/components/${file}`, 'utf8').includes(`<RacMetrics participantMinutes={${expression}}/>`));
  }
});
