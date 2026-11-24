import test from 'node:test';
import assert from 'node:assert/strict';
import { demoSummary, impactQuantity, reportDays, usd, workspaceHref } from '../ui/js/usage-report.js';
import { estimate, tokenTotal } from '../ui/js/usage-estimates.js';
import { comparisons, describeComparison } from '../ui/js/impact-comparisons.js';

test('report navigation keeps the valid period, preview mode and pricing destination', () => {
  assert.equal(reportDays('7'), 7);
  assert.equal(reportDays('-30'), null);
  assert.equal(reportDays(''), null);
  assert.equal(workspaceHref('impact.html?demo&days=7', 'demo', 30), 'impact.html?demo&days=30');
  assert.equal(workspaceHref('usage.html#pricing', 'live', 7), 'usage.html?live&days=7#pricing');
  assert.equal(workspaceHref('usage.html', '', 1), 'usage.html?days=1');
  assert.equal(workspaceHref('index.html', 'demo', 30), 'index.html?demo');
});

test('report quantities distinguish absent, small and large estimates without spurious precision', () => {
  assert.equal(impactQuantity(null, 'mL', 'L'), 'Unavailable');
  assert.equal(impactQuantity(.001, 'Wh', 'kWh'), '<0.01 Wh');
  assert.equal(impactQuantity(14.231, 'g CO₂e', 'kg CO₂e'), '14 g CO₂e');
  assert.equal(impactQuantity(1000, 'Wh', 'kWh'), '1 kWh');
  assert.equal(usd(.001), '<$0.01 USD');
});

test('everyday equivalents compare like quantities and expose useful small units', () => {
  const [led, phone, kettle] = comparisons.energy, [car, rail, flight] = comparisons.carbon;
  const [mug, shower, washer] = comparisons.water;
  assert.equal(describeComparison(5, led), '30 min of light');
  assert.equal(describeComparison(38, phone), '2 full charges');
  assert.equal(describeComparison(120, kettle), '1 kettle boil');
  assert.equal(describeComparison(16.272, car), '100 m driven');
  assert.equal(describeComparison(70.92, rail), '2 km by rail');
  assert.equal(describeComparison(125.76, flight), '1 km flown');
  assert.equal(describeComparison(25, mug), '10% of one mug');
  assert.equal(describeComparison(140, shower), '1 sec in the shower');
  assert.equal(describeComparison(50000, washer), '1 washer load');
});

test('comparisons use an unrounded estimate and never turn missing usage into a comparison', () => {
  const item = comparisons.energy[0];
  const tiny = estimate([{ name: 'gpt-5', output: 1 }]);
  assert.equal(describeComparison(tiny.energy, item), '0.22 sec of light');
  assert.equal(describeComparison(estimate([{ unclassified: 10000 }]).energy, item), 'Unavailable');
});

test('demo reports share overlapping dates and reconcile reported, modeled and unpriced usage', () => {
  const today = new Date(2026, 0, 3);
  const last30 = demoSummary(30, today), week = demoSummary(7, today), single = demoSummary(1, today);
  assert.deepEqual(last30.daily.slice(-7), week.daily);
  assert.deepEqual(week.daily.at(-1), single.daily[0]);
  for (const report of [single, week, last30]) {
    const r = estimate(report.models), total = tokenTotal(report.totals);
    assert.equal(r.tokens, total);
    assert.equal(report.providers.reduce((sum, p) => sum + tokenTotal(p), 0), total);
    assert.ok(r.genericTokens > 0 && r.unclassifiedTokens > 0 && r.pricedTokens < r.classifiedTokens);
  }
});
