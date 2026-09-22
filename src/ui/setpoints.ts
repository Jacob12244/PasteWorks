/**
 * The setpoints the operator can turn, described once.
 *
 * Both the side console and the control room SCADA screens build their
 * sliders from this list and write straight back into the plant, so the two
 * are the same controls rather than two copies that can drift apart.
 */

import type { Plant } from '../sim/plant';

export type SpKey =
  | 'flocDose' | 'ufCw' | 'cycleTime' | 'binderDose' | 'targetSlump' | 'strokeRate';
export type UpKey = 'millFeed' | 'frother' | 'cyclonePressure';

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
