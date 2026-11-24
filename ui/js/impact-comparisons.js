// Divisors use the unrounded report units: Wh, g CO₂e, and mL respectively.
// Sources and boundaries: docs/usage-methodology.md#everyday-comparisons.
export const comparisons = {
  energy: [
    { label: 'LED bulb', per: 10, kind: 'hours', action: 'of light', basis: 'One 10 W bulb uses 10 Wh per hour.' },
    { label: 'Phone battery', per: 19, units: ['full charge', 'full charges'], basis: '19 Wh per full smartphone charge.' },
    { label: 'Electric kettle', per: 120, units: ['kettle boil', 'kettle boils'], basis: '120 Wh to boil one litre of water.' },
  ],
  carbon: [
    { label: 'Petrol car', per: 162.72, kind: 'km', action: 'driven', basis: 'UK average petrol car: 162.72 g CO₂e/km, tailpipe only.' },
    { label: 'Passenger train', per: 35.46, kind: 'km', action: 'by rail', basis: 'UK national rail: 35.46 g CO₂e per passenger-km.' },
    { label: 'Short-haul flight', per: 125.76, kind: 'km', action: 'flown', basis: 'Economy short-haul: 125.76 g CO₂e per passenger-km, including radiative forcing.' },
  ],
  water: [
    { label: 'Mug of water', per: 250, units: ['mug', 'mugs'], basis: 'One mug holds 250 mL.' },
    { label: 'Shower', per: 8400, kind: 'minutes', action: 'in the shower', basis: 'Average shower flow: 8.4 litres per minute.' },
    { label: 'Washing machine', per: 50000, units: ['washer load', 'washer loads'], basis: '50 litres per washing machine load.' },
  ],
};

const numbers = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 2 });
const amount = n => n > 0 && n < .01 ? `<${numbers.format(.01)}` : numbers.format(n);

export function describeComparison(value, ref) {
  if (value == null) return 'Unavailable';
  const n = value / ref.per;
  if (ref.kind === 'km') return `${n < 1 ? `${amount(n * 1000)} m` : `${amount(n)} km`} ${ref.action}`;
  if (ref.kind === 'hours' || ref.kind === 'minutes') {
    const min = ref.kind === 'hours' ? n * 60 : n;
    const time = min < 1 ? `${amount(min * 60)} sec` : min < 60 ? `${amount(min)} min` : `${amount(min / 60)} hr`;
    return `${time} ${ref.action}`;
  }
  if (n > 0 && n < 1) return `${amount(n * 100)}% of one ${ref.units[0]}`;
  return `${amount(n)} ${ref.units[Number(n.toPrecision(2)) === 1 ? 0 : 1]}`;
}
