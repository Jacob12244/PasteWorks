/**
 * The setpoints the operator can turn, described once.
 *
 * Both the side console and the control room SCADA screens build their
 * sliders from this list and write straight back into the plant, so the two
 * are the same controls rather than two copies that can drift apart.
 */

import type { Plant } from '../sim/plant';
import { sheet } from '../scenario/flowsheet';

export type SpKey =
  | 'flocDose' | 'ufCw' | 'cycleTime' | 'binderDose' | 'targetSlump' | 'strokeRate'
  | 'spin' | 'field' | 'seaDp' | 'mwPower' | 'belt' | 'voltage';
export type UpKey = 'millFeed' | 'frother' | 'cyclonePressure' | 'rotor' | 'grate';

export interface SliderSpec {
  key: SpKey | UpKey;
  /** which setpoint bag the slider writes to */
  bag: 'sp' | 'up';
  /** instrument tag, the way it would be labelled on a real mimic */
  tag: string;
  label: string;
  min: number; max: number; step: number;
  /** display scale: value shown = raw * scale */
  scale?: number;
  unit: string;
  dp: number;
  hint: string;
}

/** Hard mode only: the circuit that makes the tailings in the first place. */
export const UPSTREAM_SLIDERS: SliderSpec[] = [
  {
    key: 'millFeed', bag: 'up', tag: 'WIC-101', label: 'Mill feed',
    min: 180, max: 660, step: 10, unit: 't/h ore', dp: 0,
    hint: 'Fixed power over more tonnes is a coarser grind. Coarse tailings '
      + 'filter faster and pump easier - but past about 140 µm the sulphides '
      + 'are not liberated and will not float.',
  },
  {
    key: 'rotor', bag: 'up', tag: 'SIC-115', label: 'Rotor speed',
    min: 600, max: 1500, step: 25, unit: 'rpm', dp: 0,
    hint: 'Tip speed does the breaking, and a hard enough blow cracks the old steel '
      + 'out of the lumps. The hammers wear as about the 2.5 power of it.',
  },
  {
    key: 'grate', bag: 'up', tag: 'ZIC-118', label: 'Discharge grate',
    min: 1, max: 10, step: 0.5, unit: 'mm', dp: 1,
    hint: 'The bars the product falls through - a hammer mill\'s closed-side setting. '
      + 'Tighter is finer, and holds back tonnes the loaders then wait on.',
  },
  {
    key: 'frother', bag: 'up', tag: 'FIC-140', label: 'Frother dose',
    min: 0, max: 60, step: 1, unit: 'g/t', dp: 0,
    hint: 'Buys sulphide recovery. Sulphur left in the tailings attacks '
      + 'ordinary portland and eats the 28 day strength.',
  },
  {
    key: 'cyclonePressure', bag: 'up', tag: 'PIC-210', label: 'Deslime cyclone pressure',
    min: 40, max: 260, step: 5, unit: 'kPa', dp: 0,
    hint: 'Higher pressure is a finer cut, so you keep more tonnes - and more '
      + 'of the fines you were trying to reject.',
  },
];

export const SLIDERS: SliderSpec[] = [
  {
    key: 'spin', bag: 'sp', tag: 'SIC-305', label: 'Ring speed',
    min: 4, max: 14, step: 0.5, unit: 'rpm', dp: 1,
    hint: 'Gravity at the rim is ω²r: ten rpm on an 8 m rim is nine-tenths of a g. '
      + 'Faster settles quicker and packs denser - and a heavy bed wobbles as the '
      + 'square of it.',
  },
  {
    key: 'field', bag: 'sp', tag: 'EIC-306', label: 'Coil field',
    min: 0.2, max: 1.4, step: 0.05, unit: 'T', dp: 2,
    hint: 'Pulls the seeded flocs down the stack. Too little and they go out of the '
      + 'top; the coils draw the square of it, at the city\'s price, and heat up.',
  },
  {
    key: 'flocDose', bag: 'sp', tag: 'FIC-310', label: 'Flocculant dose',
    min: 0, max: 45, step: 1, unit: 'g/t', dp: 0,
    hint: 'Buys settling flux and underflow density. Costs $4,200/t.',
  },
  {
    key: 'ufCw', bag: 'sp', tag: 'DIC-320', label: 'U/F density target',
    min: 0.50, max: 0.72, step: 0.005, scale: 100, unit: '% solids', dp: 1,
    hint: 'Capped by flocculant. Push it and the rake torque climbs.',
  },
  {
    key: 'cycleTime', bag: 'sp', tag: 'KIC-410', label: 'Press cycle time',
    min: 2, max: 12, step: 0.5, unit: 'min', dp: 1,
    hint: 'Long cycles squeeze drier cake but cut throughput as 1/sqrt(t).',
  },
  {
    key: 'seaDp', bag: 'sp', tag: 'PIC-415', label: 'Sea differential',
    min: 20, max: 400, step: 10, unit: 'bar', dp: 0,
    hint: 'How much of the ocean you let across the cloth. More is faster and drier - '
      + 'but every litre of filtrate is pumped back out against it, and past about '
      + '150 bar the fines come through too.',
  },
  {
    key: 'mwPower', bag: 'sp', tag: 'JIC-420', label: 'Magnetron power',
    min: 1, max: 12, step: 0.5, unit: 'MW', dp: 1,
    hint: 'Boils the water off the belt into the vacuum. The cold trap freezes it back '
      + 'out - until it frosts over, and then it goes to space at $400/m³.',
  },
  {
    key: 'voltage', bag: 'sp', tag: 'EIC-425', label: 'Electrode voltage',
    min: 0, max: 80, step: 1, unit: 'V', dp: 0,
    hint: 'Drags the water through the cake to the cathode. Drier cake as it climbs, '
      + 'and power as its square - at $0.46/kWh.',
  },
  {
    key: 'belt', bag: 'sp', tag: 'SIC-430', label: 'Belt speed',
    min: 20, max: 100, step: 5, unit: '%', dp: 0,
    hint: 'Tonnes through the machine. Faster keeps the pump fed; each tonne then '
      + 'gets less of the treatment.',
  },
  {
    key: 'binderDose', bag: 'sp', tag: 'WIC-520', label: 'Binder dose',
    min: 1, max: 8, step: 0.1, unit: '% of tails', dp: 1,
    hint: 'The single biggest cost, and the only real lever on strength.',
  },
  {
    key: 'targetSlump', bag: 'sp', tag: 'QIC-610', label: 'Paste slump target',
    min: 65, max: 175, step: 5, unit: 'mm Boger', dp: 0,
    hint: 'Measured on the 200 mm Boger cylinder. Wetter pumps easier and '
      + 'cheaper; drier is stronger. Pick a side.',
  },
  {
    key: 'strokeRate', bag: 'sp', tag: 'SIC-710', label: 'Pump stroke rate',
    min: 0, max: 100, step: 1, unit: '% rated', dp: 0,
    hint: 'Sets placement rate. Out-run the press and the cake bin empties.',
  },
];

export const ALL_SLIDERS = [...UPSTREAM_SLIDERS, ...SLIDERS];

export function bagValue(plant: Plant, s: SliderSpec): number {
  return s.bag === 'sp'
    ? (plant.sp[s.key as SpKey] as number)
    : (plant.up[s.key as UpKey] as number);
}

export function setBagValue(plant: Plant, s: SliderSpec, value: number) {
  if (s.bag === 'sp') (plant.sp[s.key as SpKey] as number) = value;
  else (plant.up[s.key as UpKey] as number) = value;
}

/** Formatted display value for a slider, e.g. "63.0 % solids". */
export function shown(s: SliderSpec, raw: number): string {
  const v = raw * (s.scale ?? 1);
  return (Number.isFinite(v) ? v.toFixed(s.dp) : '--') + ' ' + s.unit;
}

/**
 * The upstream sliders this site actually has, in its own words: there is no
 * frother without a flotation bank, and a dredge rate is not a mill feed.
 */
export function upstreamSliders(): SliderSpec[] {
  const sh = sheet();
  return UPSTREAM_SLIDERS
    .filter((s) => s.key === 'millFeed'
      || ((s.key === 'rotor' || s.key === 'grate') && sh.source === 'scoop')
      || (s.key === 'frother' && sh.hasFrother)
      || (s.key === 'cyclonePressure' && sh.hasDeslime))
    .map((s) => (s.key === 'millFeed'
      ? { ...s, label: sh.feed.label, unit: sh.feed.unit, hint: sh.feed.hint }
      : s));
}

/**
 * And the plant sliders: no press cycle without a press, no ring speed
 * without a ring, and so on - each machine brings its own.
 */
export function plantSliders(): SliderSpec[] {
  const sh = sheet();
  const has = (k: SpKey | UpKey) => {
    switch (k) {
      case 'spin': return sh.dewater === 'spinring';
      case 'field': return sh.dewater === 'magstack';
      case 'flocDose': return sh.hasFloc;
      case 'ufCw': return sh.hasUf;
      case 'cycleTime': return sh.filter === 'press';
      case 'seaDp': return sh.filter === 'deeppress';
      case 'mwPower': return sh.filter === 'microwave';
      case 'voltage': return sh.filter === 'eopress';
      case 'belt': return sh.filter === 'microwave' || sh.filter === 'eopress';
      default: return true;
    }
  };
  return SLIDERS
    .filter((s) => has(s.key))
    .map((s) => (s.key === 'flocDose' ? { ...s, label: sh.floc.label, hint: sh.floc.hint }
      : s.key === 'ufCw' ? { ...s, label: sh.uf.label, hint: sh.uf.hint }
      : s.key === 'belt' ? { ...s, label: sh.filter === 'microwave' ? 'Drier belt speed' : 'Press belt speed' }
      : s));
}

/** Flip the silo to this site's other binder. */
export function swapBinder(plant: Plant) {
  const [a, b] = sheet().binders;
  plant.up.binderType = plant.up.binderType === b.id ? a.id : b.id;
}

/** The binder in the silo right now, by this site's name for it. */
export function binderIn(plant: Plant) {
  const [a, b] = sheet().binders;
  return plant.up.binderType === b.id ? b : a;
}
