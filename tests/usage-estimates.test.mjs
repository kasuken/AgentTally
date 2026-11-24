import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, tokenTotal, canonicalModel } from '../ui/js/usage-estimates.js';

test('prices normalized fresh/cache token classes once, with one-hour cache premium', () => {
  const result = estimate([{ name: 'anthropic/claude-sonnet-4-5-20250929', input: 1e6, output: 1e6, cache_read: 1e6, cache_write: 1e6, cache_write_1h: 1e6 }]);
  assert.equal(result.cost, 3 + 15 + .3 + 6);
  assert.equal(result.pricedTokens, 4e6);
  assert.equal(result.energy, (1e6 + 1e5 + 1e6) * .00015 + 1e6 * .0006);
  assert.equal(result.carbon, result.energy / 1000 * 480);
  assert.equal(result.water, result.energy * 1.1);
});

test('unknown models are unpriced, with explicitly generic footprint coverage', () => {
  const result = estimate([{ name: 'future-model', input: 200, output: 100 }]);
  assert.equal(result.cost, null);
  assert.equal(result.pricedTokens, 0);
  assert.equal(result.genericTokens, 300);
  assert.ok(result.energy > 0);
  assert.equal(estimate([]).energy, null);
});

test('known subtotals exclude unclassified tokens and unsupported cache prices', () => {
  const row = { name: 'gpt-5', input: 1000, output: 100, cache_write: 20, unclassified: 50 };
  const result = estimate([row]);
  assert.equal(tokenTotal(row), 1170);
  assert.equal(result.pricedTokens, 1100);
  assert.equal(result.cost, .00125 + .001);
  const totalOnly = estimate([{ name: 'gpt-5', unclassified: 200 }]);
  assert.equal(totalOnly.cost, null);
  assert.equal(totalOnly.energy, null);
});

test('model matching strips only known prefixes and snapshots, not unknown family variants', () => {
  assert.equal(canonicalModel('copilot/Claude-Sonnet-4.5-2025-09-29'), 'claude-sonnet-4-5');
  assert.equal(estimate([{ name: 'gpt-5-unknown', output: 10 }]).cost, null);
  assert.equal(estimate([{ name: 'constructor', output: 10 }]).cost, null);
  assert.equal(estimate([{ name: '__proto__', output: 10 }]).cost, null);
  assert.equal(estimate([{ name: 'gpt-5-mini', output: 1000 }]).cost, .002);
});

test('energy reconciles by class and by model after weighting each model separately', () => {
  const r = estimate([
    { name: 'gpt-5-mini', output: 1000, cache_write: 1000 },
    { name: 'unrecognized-mini', input: 1000, unclassified: 100 },
    { name: 'claude-opus-4', input: 1000, cache_read: 1000 },
    { name: 'unknown-no-split', unclassified: 500 },
  ]);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} vs ${expected}`);
  assert.deepEqual([r.tokens, r.classifiedTokens, r.unclassifiedTokens, r.genericTokens, r.pricedTokens], [5600, 5000, 600, 1000, 3000]);
  assert.deepEqual(r.classes.map(c => c.tokens), [2000, 1000, 1000, 1000]);
  r.classes.forEach((c, i) => near(c.energy, [.6, .15, .045, .0375][i]));
  assert.deepEqual(r.models.map(m => [m.name, m.multiplier, m.generic]), [
    ['claude-opus-4', 3, false], ['gpt-5-mini', .25, false], ['unrecognized-mini', 1, true], ['unknown-no-split', 1, true],
  ]);
  assert.equal(r.models.at(-1).energy, null);
  near(r.energy, .8325);
  near(r.models.reduce((sum, m) => sum + (m.energy ?? 0), 0), r.energy);
  near(r.water, .91575);
  near(r.carbon, .3996);
});

test('recognized unpriced family uses its footprint class without inventing a price', () => {
  const r = estimate([{ name: 'gemini-2.5-flash', output: 1000 }]);
  assert.equal(r.cost, null);
  assert.equal(r.genericTokens, 0);
  assert.equal(r.models[0].multiplier, .25);
});
