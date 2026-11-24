import { estimate, FACTOR_VERSION, impactFactors } from './usage-estimates.js';
import { comparisons, describeComparison } from './impact-comparisons.js';
import { $, fmt, impactQuantity, periodDates, startReport } from './usage-report.js';

const energy = wh => impactQuantity(wh, 'Wh', 'kWh');
const decimal = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 });
const factorText = model => model.generic ? 'Generic 1×' : `${decimal.format(model.multiplier)}×`;

function comparisonRow(key, title, unit, largeUnit) {
  const row = document.createElement('section'), metric = document.createElement('div'), examples = document.createElement('ul');
  const heading = document.createElement('h3'), reading = document.createElement('strong');
  row.className = 'comparison-row';
  heading.id = `${key}-title`;
  row.setAttribute('aria-labelledby', heading.id);
  heading.textContent = title;
  reading.id = `${key}-value`;
  metric.append(heading, reading);
  const items = comparisons[key].map(ref => {
    const item = document.createElement('li'), label = document.createElement('span');
    const result = document.createElement('strong'), basis = document.createElement('small');
    label.textContent = ref.label;
    basis.textContent = ref.basis;
    item.append(label, result, basis);
    examples.append(item);
    return { ref, result };
  });
  row.append(metric, examples);
  $('comparisons').append(row);
  return (impact) => {
    const value = impact[key];
    reading.textContent = impactQuantity(value, unit, largeUnit);
    for (const { ref, result } of items) result.textContent = describeComparison(value, ref);
  };
}
const updateComparisons = [
  comparisonRow('energy', 'Inference energy', 'Wh', 'kWh'),
  comparisonRow('carbon', 'Grid emissions', 'g CO₂e', 'kg CO₂e'),
  comparisonRow('water', 'On-site cooling water', 'mL', 'L'),
];
function tableRow(name, values, note = '') {
  const row = document.createElement('tr'), label = document.createElement('th');
  label.scope = 'row'; label.textContent = name;
  if (note) {
    const small = document.createElement('small'); small.textContent = note; label.append(small);
  }
  row.append(label);
  for (const value of values) {
    const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
  }
  return row;
}

function render(data) {
  const impact = estimate(data.models), t = data.totals, p = data.progress;
  $('dates').textContent = periodDates(data);
  const hasEnergy = impact.energy !== null;
  $('impact-flow').hidden = !hasEnergy;
  $('trace-details').hidden = !hasEnergy;
  $('impact-empty').hidden = hasEnergy;
  $('model-section').hidden = !data.models.length;
  if (hasEnergy) {
    $('energy-scope').textContent = `Based on ${fmt(impact.classifiedTokens)} classified tokens, not data-center measurements.`;
    for (const update of updateComparisons) update(impact);
    const rows = document.createDocumentFragment(), band = document.createDocumentFragment();
    for (const c of impact.classes) {
      const missing = t[`missing_${c.key}`], absent = missing === t.records;
      const row = tableRow(c.label, [absent ? 'Not reported' : fmt(c.tokens), absent ? '—' : energy(c.energy)],
        `${decimal.format(c.wh * 1000)} Wh / 1k tokens at 1×`);
      if (missing && !absent) {
        const note = document.createElement('small');
        note.textContent = `${fmt(missing)} ${missing === 1 ? 'record' : 'records'} missing`;
        row.cells[1].append(note);
      }
      row.dataset.token = c.key;
      rows.append(row);
      const part = document.createElement('span');
      part.dataset.token = c.key;
      part.style.flexGrow = String(c.energy / impact.energy);
      band.append(part);
    }
    $('class-rows').replaceChildren(rows);
    $('energy-band').replaceChildren(band);
  } else {
    $('empty-title').textContent = !t.records ? 'No reported usage for these dates' : 'No classified tokens to estimate';
    $('empty-message').textContent = !t.records ? 'Try another reporting period. An empty index does not mean no agents ran.' :
      'These records do not contain a positive classified token count. Energy, emissions and water are unavailable, not measured zero.';
  }
  const models = document.createDocumentFragment();
  for (const m of impact.models) models.append(tableRow(m.name || 'Unknown model',
    [m.classified ? factorText(m) : '—', fmt(m.classified), energy(m.energy)]));
  $('model-rows').replaceChildren(models);
  $('coverage-lead').textContent = t.records ? `${fmt(impact.classifiedTokens)} of ${fmt(impact.tokens)} reported tokens included.` : 'No timestamped usage records in this period.';
  for (const id of ['excluded', 'generic', 'partial']) $(id).hidden = !t.records;
  $('excluded').textContent = `${fmt(impact.unclassifiedTokens)} unclassified tokens excluded. Missing counts are never inferred.`;
  $('generic').textContent = `${fmt(impact.genericTokens)} classified tokens used the generic 1× factor for unrecognized models.`;
  $('partial').textContent = `${fmt(t.records)} usage records; ${fmt(t.partial)} marked partial. ${fmt(t.missing_input)} missing input; ${fmt(t.missing_output)} missing output.`;
  $('index-coverage').textContent = `${fmt(p.indexed)} of ${fmt(p.discovered)} files indexed; ${fmt(p.pending)} pending.${p.malformed ? ` ${fmt(p.malformed)} malformed or oversized records skipped.` : ''} Retained logs can miss earlier activity.`;
}

$('conversion-factors').textContent = `Emissions and on-site cooling water are derived from the unrounded energy estimate at ${fmt(impactFactors.carbonGPerKwh)} g CO₂e and ${decimal.format(impactFactors.waterLPerKwh)} L per kWh.`;
$('factor-version').textContent = FACTOR_VERSION;
$('weighting-note').textContent = `At the medium anchor, fresh input and cache writes use ${impactFactors.inputWh} Wh per token; output uses ${impactFactors.outputWh} Wh. Cache reads use ${impactFactors.cacheReadWeight}× the fresh-input factor. Small models use 0.25× the anchor, medium 1× and frontier 3×; unrecognized models use a generic 1×. These are assumptions, not hardware classifications.`;
startReport(render);
