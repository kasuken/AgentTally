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
