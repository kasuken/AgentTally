import { estimate, tokenTotal, PRICE_VERSION, FACTOR_VERSION } from './usage-estimates.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const quantity = value => value === null ? 'Unavailable' : value > 0 && value < .01 ? '<0.01' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
let days = 1, revision = 0, timer;
const names = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot CLI', vscode: 'Copilot Chat', gemini: 'Gemini CLI' };
const fmt = value => number.format(value ?? 0);

function pairs(target, rows) {
  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    div.append(dt, dd);
    fragment.append(div);
  }
  $(target).replaceChildren(fragment);
}

function render(data) {
  const t = data.totals, p = data.progress, tokens = tokenTotal(t), impact = estimate(data.models);
  $('source-badge').textContent = demo ? 'Demo data' : 'Local history';
  $('source-badge').dataset.mode = demo ? 'sample' : 'local';
  $('total').textContent = t.records ? fmt(tokens) : 'No reported usage';
  $('dates').textContent = data.start === data.end ? data.start : `${data.start} to ${data.end}`;
  $('first-date').textContent = data.start;
  $('last-date').textContent = data.start === data.end ? '' : data.end;
  $('token-coverage').textContent = `${fmt(t.records)} usage records. ${fmt(t.missing_input)} missing input; ${fmt(t.missing_output)} missing output; ${fmt(t.partial)} explicitly partial.`;
  const field = (value, missing) => !t.records || missing === t.records ? 'Unavailable' : `${fmt(value)}${missing ? ` (${fmt(missing)} records missing)` : ''}`;
  pairs('classes', [
    ['Fresh input (including separate tool input)', field(t.input, t.missing_input)],
    ['Output (including reported reasoning)', field(t.output, t.missing_output)],
    ['Cache reads', field(t.cache_read, t.missing_cache_read)], ['Cache writes', field(t.cache_write, t.missing_cache_write)],
    ['Unclassified reported tokens', fmt(t.unclassified)],
  ]);
  const max = Math.max(1, ...data.daily.map(tokenTotal));
  const fragment = document.createDocumentFragment();
  for (const day of data.daily) {
    const bar = document.createElement('span'), total = tokenTotal(day);
    bar.style.height = `${Math.max(1, total / max * 100)}%`;
    bar.classList.toggle('empty', !total);
    bar.title = `${day.name}: ${fmt(total)} reported tokens`;
    fragment.append(bar);
  }
  $('trend').replaceChildren(fragment);
  $('trend').setAttribute('aria-label', data.daily.map(row => `${row.name}: ${fmt(tokenTotal(row))} tokens`).join('; '));
  $('trend-caption').textContent = `Daily reported totals by local date, ${data.start} to ${data.end}. Blank dates mean no indexed usage, not necessarily no activity.`;
  const table = document.createDocumentFragment();
  for (const model of data.models) {
    const row = document.createElement('tr');
    for (const text of [model.name, fmt(tokenTotal(model)), tokens ? `${(tokenTotal(model) / tokens * 100).toFixed(1)}%` : 'Unavailable']) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    table.append(row);
  }
  if (!data.models.length) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 3; cell.textContent = 'No model usage reported in this period.'; row.append(cell); table.append(row);
  }
  $('models').replaceChildren(table);
  pairs('providers', data.providers.length ? data.providers.map(row => [names[row.name] || row.name, `${fmt(tokenTotal(row))} tokens`]) : [['Provider usage', 'Not reported']]);
  pairs('tools', Object.keys(data.tools).length ? Object.entries(data.tools).map(([name, count]) => [name, fmt(count)]) : [['Tool calls', 'None indexed']]);
  pairs('estimates', [
    ['API-equivalent cost', impact.cost === null ? 'Unavailable' : `$${quantity(impact.cost)} USD`],
    ['Energy', impact.energy === null ? 'Unavailable' : `${quantity(impact.energy)} Wh`],
    ['Emissions', impact.carbon === null ? 'Unavailable' : `${quantity(impact.carbon)} g CO2e`],
    ['Cooling water', impact.water === null ? 'Unavailable' : `${quantity(impact.water)} mL`],
  ]);
  const classified = Math.max(0, tokens - (t.unclassified ?? 0));
  const costCoverage = tokens && impact.pricedTokens === tokens
    ? `Prices cover all ${fmt(tokens)} reported tokens.`
    : tokens ? `Partial price coverage: ${fmt(impact.pricedTokens)} of ${fmt(tokens)} reported tokens; only the known subtotal is shown.`
      : 'No classified usage is available for estimation.';
  $('estimate-coverage').textContent = `${costCoverage} Footprint covers ${fmt(classified)} classified tokens${impact.genericTokens ? ` (${fmt(impact.genericTokens)} with a generic factor)` : ''}. Unreported classes are excluded.`;
  $('versions').textContent = `Offline pricing: ${PRICE_VERSION}. Environmental factors: ${FACTOR_VERSION}.`;
  const coverage = [
    `${p.indexed} of ${p.discovered} discovered files indexed; ${p.pending} pending; ${p.unsupported} activity-only files; ${p.without_usage ?? 0} eligible files without retained usage; ${p.malformed} malformed records skipped.`,
    data.earliest ? `Earliest reported usage in this period: ${data.earliest}. Earlier dates may be missing.` : 'No timestamped usage is available for this period.',
    `${fmt(t.aggregate)} usage records come from cumulative reports and are attributed to report time, not individual request time.`,
  ];
  $('import-details').textContent = coverage.join(' ');
  $('coverage').textContent = `${p.indexed} of ${p.discovered} discovered files indexed${p.pending ? `; ${p.pending} pending` : ''}. ${data.earliest ? `Reported usage from ${data.earliest} in this period.` : 'No timestamped usage in this period.'}${p.malformed ? ` ${p.malformed} malformed or oversized records skipped.` : ''}`;
  $('status').textContent = demo ? 'Demo: invented data only. No local logs connected.' : p.importing ? 'Importing retained local logs in background. Totals are partial and update automatically.' : `Local history${p.updated_at ? ` updated ${new Date(p.updated_at).toLocaleTimeString()}` : ' is starting'}. Historical selection does not change Live activity.`;
  $('error').hidden = !p.errors.length;
  $('error').textContent = p.errors.length ? `Import incomplete. ${p.errors.join('; ')}. Readable sources remain included; retry is automatic.` : '';
}

function demoSummary() {
  const today = new Date();
  const date = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const blank = { input: 0, output: 0, cache_read: 0, cache_write: 0, cache_write_1h: 0, unclassified: 0, records: 0, missing_input: 0, missing_output: 0, missing_cache_read: 0, missing_cache_write: 0, partial: 0, aggregate: 0 };
  const daily = Array.from({ length: days }, (_, i) => {
    const day = new Date(today); day.setDate(day.getDate() - days + i + 1);
    return { ...blank, name: date(day), input: 18000 + (i % 5) * 4000, output: 3200 + (i % 3) * 900, cache_read: 4800, records: 12 };
  });
  const totals = daily.reduce((total, row) => {
    for (const key of Object.keys(blank)) total[key] += row[key];
    return total;
  }, { ...blank });
  return { days, start: daily[0].name, end: date(today), earliest: daily[0].name, totals, daily,
    models: [{ ...totals, name: 'claude-sonnet-4-5' }],
    providers: [{ ...totals, name: 'claude' }], tools: { 'read/search': 142 * days, edit: 38 * days, terminal: 21 * days },
    progress: { discovered: 4, indexed: 4, pending: 0, unsupported: 0, malformed: 0, importing: false, errors: [], updated_at: Date.now() } };
}

async function load() {
  const request = ++revision;
  clearTimeout(timer);
  try {
    let data;
    if (demo) data = demoSummary();
    else {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) throw new Error('Local history is available only in the AgentTally desktop app. Browser preview does not read local logs.');
      data = await invoke('usage_summary', { days });
    }
    if (request === revision) render(data);
  } catch (error) {
    if (request !== revision) return;
    $('status').textContent = 'History unavailable. No usage values are being displayed.';
    $('source-badge').textContent = 'Unavailable';
    $('source-badge').dataset.mode = 'error';
    $('error').textContent = String(error?.message || error);
    $('error').hidden = false;
    $('total').textContent = 'Unavailable';
    for (const id of ['models', 'classes', 'estimates', 'providers', 'tools', 'trend']) $(id).replaceChildren();
    for (const id of ['token-coverage', 'estimate-coverage', 'dates', 'first-date', 'last-date', 'import-details', 'versions']) $(id).textContent = '';
    $('coverage').textContent = 'The history index could not be queried. The desktop app retries automatically; Live activity remains independent.';
  } finally {
    if (request === revision && !demo) timer = setTimeout(load, 5000);
  }
}
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => {
  days = Number(button.dataset.days);
  for (const peer of document.querySelectorAll('[data-days]')) peer.setAttribute('aria-pressed', String(peer === button));
  $('status').textContent = 'Loading selected local dates...';
  load();
});
if (demo) {
  $('source-badge').textContent = 'Demo data';
  $('source-badge').dataset.mode = 'sample';
} else if (!window.__TAURI__) {
  $('source-badge').textContent = 'History unavailable';
  $('source-badge').dataset.mode = 'error';
}
const mode = demo ? '?demo' : params.has('live') ? '?live' : '';
if (mode) {
  for (const link of document.querySelectorAll('nav a')) link.href = link.getAttribute('href') + mode;
}
window.addEventListener('pagehide', () => { ++revision; clearTimeout(timer); });
window.addEventListener('pageshow', event => { if (event.persisted) load(); });
load();
