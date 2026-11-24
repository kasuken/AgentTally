import { estimate, tokenTotal, PRICE_VERSION } from './usage-estimates.js';
import { $, fmt, impactQuantity, periodDates, startReport, usd } from './usage-report.js';

const names = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot CLI', vscode: 'Copilot Chat', gemini: 'Gemini CLI' };

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
  $('total').textContent = t.records ? fmt(tokens) : 'No reported usage';
  $('dates').textContent = periodDates(data);
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
  $('cost-total').textContent = usd(impact.cost);
  $('price-coverage').textContent = !tokens ? 'No reported tokens to price.' : !impact.pricedTokens ? `No applicable rates for the ${fmt(tokens)} reported tokens.` :
    `Known subtotal for ${fmt(impact.pricedTokens)} of ${fmt(tokens)} reported tokens. Not a bill.`;
  $('price-version').textContent = `Bundled rate table: ${PRICE_VERSION}.`;
  $('impact-summary').textContent = impact.energy === null ? 'No classified tokens available to estimate energy for these dates.' :
    `Estimated energy: ${impactQuantity(impact.energy, 'Wh', 'kWh')} for ${fmt(impact.classifiedTokens)} classified tokens. Low confidence.`;
  const coverage = [
    `${p.indexed} of ${p.discovered} discovered files indexed; ${p.pending} pending; ${p.unsupported} activity-only files; ${p.without_usage ?? 0} eligible files without retained usage; ${p.malformed} malformed records skipped.`,
    data.earliest ? `Earliest reported usage in this period: ${data.earliest}. Earlier dates may be missing.` : 'No timestamped usage is available for this period.',
    `${fmt(t.aggregate)} usage records come from cumulative reports and are attributed to report time, not individual request time.`,
  ];
  $('import-details').textContent = coverage.join(' ');
  $('coverage').textContent = `${p.indexed} of ${p.discovered} discovered files indexed${p.pending ? `; ${p.pending} pending` : ''}. ${data.earliest ? `Reported usage from ${data.earliest} in this period.` : 'No timestamped usage in this period.'}${p.malformed ? ` ${p.malformed} malformed or oversized records skipped.` : ''}`;
}

startReport(render);
