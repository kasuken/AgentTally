// USD per million tokens: fresh input, output, cache read, five-minute cache write.
// Sources and omissions are documented in docs/usage-methodology.md.
export const PRICE_VERSION = 'standard-usd-2026-11-24';
export const FACTOR_VERSION = 'carbonbit-style-1.1.0';
const prices = {
  'claude-sonnet-4': [3, 15, .3, 3.75],
  'claude-sonnet-4-5': [3, 15, .3, 3.75],
  'claude-sonnet-4-6': [3, 15, .3, 3.75],
  'claude-sonnet-5': [2, 10, .2, 2.5],
  'claude-sonnet-5-5': [2, 10, .1, 2.5],
  'claude-haiku-4-5': [1, 5, .1, 1.25],
  'claude-opus-4': [15, 75, 1.5, 18.75],
  'claude-opus-4-1': [15, 75, 1.5, 18.75],
  'claude-opus-4-5': [5, 25, .5, 6.25],
  'claude-opus-4-6': [5, 25, .5, 6.25],
  'claude-opus-4-7': [5, 25, .5, 6.25],
  'claude-opus-4-8': [5, 25, .5, 6.25],
  'claude-opus-5': [5, 25, .5, 6.25],
  'claude-opus-5-5': [4, 20, .2, 5],
  'claude-fable-5': [10, 50, 1, 12.5],
  'claude-fable-5-1': [10, 50, .25, 12.5],
  'claude-fable-5-2': [8, 40, .2, 10],
  'gpt-5': [1.25, 10, .125, null],
  'gpt-5.1': [1.25, 10, .125, null],
  'gpt-5.2': [1.75, 14, .175, null],
  'gpt-5.4': [2.5, 15, .25, null],
  'gpt-5.4-mini': [.75, 4.5, .075, null],
  'gpt-5-mini': [.25, 2, .025, null],
  'gpt-5-nano': [.05, .4, .005, null],
  'gpt-4.1': [2, 8, .5, null],
  'gpt-4o': [2.5, 10, 1.25, null],
  'gpt-4o-mini': [.15, .6, .075, null],
  'gpt-6.2-astra': [8, 40, .4, 10],
  'gpt-6-astra': [10, 50, 1, 12.5],
  'gpt-6.2-sol': [2, 10, .1, 2.5],
  'gpt-6.1-sol': [2, 10, .1, 2.5],
  'gpt-6.1-terra': [1, 5, .05, 1.25],
  'gpt-6-luna': [.1, .5, .01, .125],
  'gpt-6-sol': [2, 10, .2, 2.5],
  'gpt-5.6-sol': [4, 20, .4, 5],
  'gpt-5.6-luna': [.2, 1.2, .02, .25],
};
export function canonicalModel(model) {
  return String(model || '').toLowerCase().replace(/^(copilot|anthropic|openai)\//, '')
    .replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8}|latest)$/, '')
    .replace(/(claude-.+)/, value => value.replaceAll('.', '-'));
}
export function tokenTotal(row) {
  return ['input', 'output', 'cache_read', 'cache_write', 'unclassified'].reduce((sum, key) => sum + (row[key] ?? 0), 0);
}
export function estimate(models) {
  let cost = 0, energy = 0, pricedTokens = 0, genericTokens = 0, tokens = 0;
  for (const row of models) {
    const model = canonicalModel(row.name), price = Object.hasOwn(prices, model) ? prices[model] : null, count = tokenTotal(row);
    tokens += count;
    const values = [row.input ?? 0, row.output ?? 0, row.cache_read ?? 0, row.cache_write ?? 0];
    if (price) values.forEach((value, i) => {
      if (price[i] !== null) { cost += value * price[i] / 1e6; pricedTokens += value; }
    });
    if (price && model.startsWith('claude-')) {
      cost += Math.min(row.cache_write_1h ?? 0, values[3]) * (price[0] * 2 - price[3]) / 1e6;
    }
    const known = Boolean(price) || /^(gemini-)/.test(model);
    const multiplier = /haiku|mini|nano|flash|luna/.test(model) ? .25 : /opus|fable|mythos|astra/.test(model) ? 3 : 1;
    if (!known) genericTokens += values.reduce((a, b) => a + b, 0);
    energy += ((values[0] + values[2] * .1 + values[3]) * .00015 + values[1] * .0006) * (known ? multiplier : 1);
  }
  return {
    cost: pricedTokens > 0 ? cost : null,
    energy: models.some(row => tokenTotal(row) - (row.unclassified ?? 0) > 0) ? energy : null,
    carbon: models.some(row => tokenTotal(row) - (row.unclassified ?? 0) > 0) ? energy / 1000 * 480 : null,
    water: models.some(row => tokenTotal(row) - (row.unclassified ?? 0) > 0) ? energy * 1.1 : null,
    tokens, pricedTokens, genericTokens,
  };
}
