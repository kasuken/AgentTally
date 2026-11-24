// Shared by the two historical workspaces; neither depends on the live scanner.
export const $ = id => document.getElementById(id);
const countFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const estimateFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 2 });
export const fmt = value => countFormat.format(value);
export const periodDates = data => data.start === data.end ? data.start : `${data.start} to ${data.end}`;
export function impactQuantity(value, unit, largeUnit) {
  if (value == null) return 'Unavailable';
  if (value > 0 && value < .01) return `<0.01 ${unit}`;
  return value >= 1000 ? `${estimateFormat.format(value / 1000)} ${largeUnit}` : `${estimateFormat.format(value)} ${unit}`;
}
export function usd(value) {
  return value == null ? 'Unavailable' : value > 0 && value < .01 ? '<$0.01 USD' : `$${estimateFormat.format(value)} USD`;
}
export const reportDays = value => ['1', '7', '30'].includes(String(value)) ? Number(value) : null;
export function workspaceHref(href, mode, days) {
  const [page, hash] = href.split('#'), base = page.split('?')[0];
  const params = [mode, base !== 'index.html' ? `days=${days}` : ''].filter(Boolean).join('&');
  return base + (params ? `?${params}` : '') + (hash ? `#${hash}` : '');
}

const emptyCounts = { input: 0, output: 0, cache_read: 0, cache_write: 0, cache_write_1h: 0, unclassified: 0, records: 0, missing_input: 0, missing_output: 0, missing_cache_read: 0, missing_cache_write: 0, partial: 0, aggregate: 0 };
function addCounts(target, row) {
  for (const key of Object.keys(emptyCounts)) target[key] += row[key] ?? 0;
}
export function demoSummary(days, today = new Date()) {
  const date = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sourceModels = [['claude-sonnet-4-5', 'claude'], ['gpt-5-mini', 'codex'], ['Unknown model', 'copilot']];
  const models = sourceModels.map(([name]) => ({ ...emptyCounts, name }));
  const totals = { ...emptyCounts };
  const daily = Array.from({ length: days }, (_, i) => {
    const age = days - i - 1, day = new Date(today); day.setDate(day.getDate() - age);
    const record = { ...emptyCounts, name: date(day) };
    const groups = [
      { input: 18000 + (age % 5) * 4000, output: 3200 + (age % 3) * 900, cache_read: 5400, cache_write: 1200, records: 9 },
      { input: 8000, output: 2400 + (age % 2) * 600, cache_read: 1600, records: 4, missing_cache_write: 4 },
      { output: 800, unclassified: 300, records: 1, missing_input: 1, missing_cache_read: 1, missing_cache_write: 1, partial: 1 },
    ];
    groups.forEach((row, index) => { addCounts(models[index], row); addCounts(record, row); });
    addCounts(totals, record);
    return record;
  });
  return { days, start: daily[0].name, end: date(today), earliest: daily[0].name, totals, daily, models,
    providers: models.map((row, i) => ({ ...row, name: sourceModels[i][1] })),
    tools: { 'read/search': 142 * days, edit: 38 * days, terminal: 21 * days },
    progress: { discovered: 4, indexed: 4, pending: 0, unsupported: 0, without_usage: 0, malformed: 0, importing: false, errors: [], updated_at: today.getTime() } };
}

export function startReport(render) {
  const params = new URLSearchParams(location.search);
  const mode = params.has('demo') ? 'demo' : params.has('live') ? 'live' : '';
  const key = `tally.report.days.${mode || 'local'}`;
  let days = reportDays(params.get('days')), revision = 0, timer;
  try { days ??= reportDays(sessionStorage.getItem(key)); } catch { /* URL navigation works without storage. */ }
  days ??= 1;
  const buttons = document.querySelectorAll('[data-days]');
  const badge = (text, mode) => { $('source-badge').textContent = text; $('source-badge').dataset.mode = mode; };
  const updateLinks = () => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days));
    for (const link of document.querySelectorAll('nav a, [data-report-link]')) {
      link.setAttribute('href', workspaceHref(link.getAttribute('href'), mode, days));
    }
    try { sessionStorage.setItem(key, String(days)); } catch { /* Optional. */ }
  };
  async function load() {
    const request = ++revision;
    clearTimeout(timer);
    try {
      const invoke = window.__TAURI__?.core?.invoke;
      if (mode !== 'demo' && !invoke) throw new Error('Open AgentTally on your desktop to read local history. A browser preview cannot read your logs.');
      const data = mode === 'demo' ? demoSummary(days) : await invoke('usage_summary', { days });
      if (request !== revision) return;
      render(data);
      const p = data.progress;
      $('report-content').hidden = false;
      badge(mode === 'demo' ? 'Demo data' : 'Local history', mode === 'demo' ? 'sample' : 'local');
      $('status').textContent = mode === 'demo' ? 'Demo: invented data only. No local logs connected.' : p.importing || p.pending ? 'Indexing retained local logs. This report is partial and updates automatically.' : `Local history${p.updated_at ? ` updated ${new Date(p.updated_at).toLocaleTimeString()}` : ' is starting'}.`;
      $('error').hidden = !p.errors.length;
      $('error').textContent = p.errors.length ? `Import incomplete. ${p.errors.join('; ')}. Readable sources remain included; retry is automatic.` : '';
    } catch (error) {
      if (request !== revision) return;
      $('report-content').hidden = true;
      badge('Unavailable', 'error');
      $('status').textContent = window.__TAURI__?.core?.invoke ? 'History unavailable. No usage values are displayed; the desktop app will retry automatically.' : 'History unavailable. No usage values are being displayed.';
      $('error').textContent = String(error?.message || error);
      $('error').hidden = false;
    } finally {
      if (request === revision && mode !== 'demo' && window.__TAURI__?.core?.invoke) timer = setTimeout(load, 5000);
    }
  }
  for (const button of buttons) button.addEventListener('click', () => {
    days = Number(button.dataset.days);
    updateLinks();
    const self = document.querySelector('nav a[aria-current="page"]');
    history.replaceState(null, '', self.getAttribute('href') + location.hash);
    $('report-content').hidden = true;
    $('error').hidden = true;
    $('status').textContent = 'Loading selected local dates…';
    load();
  });
  updateLinks();
  window.addEventListener('pagehide', () => { ++revision; clearTimeout(timer); });
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  load();
}
