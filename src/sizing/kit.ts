import type { Contract, Design } from './circuit';
import type { Summary } from './summary';
import type { StationId } from './site';

/**
 * What a station is made of - its sliders, checks, numbers and chart - and
 * the formatting they share. The stations themselves are in stations.ts (the
 * crushing and grinding circuit) and backfill.ts (the paste plant).
 */

export interface Slider {
  key: keyof Design;
  label: string;
  min: number;
  max: number;
  step: number;
  /** what the value reads as */
  show(v: number, c: Contract): string;
  /** stepping through a catalogue rather than a range */
  ladder?: boolean;
  hint?: string;
  /** a range that depends on the contract, in place of min, max and step */
  limits?(c: Contract): { min: number; max: number; step: number };
}

export interface Check {
  label: string;
  /** the value it came to, and what it had to be */
  value: string;
  limit: string;
  /** null while ProcessPro has not reported it */
  ok: boolean | null;
}

export interface Row {
  label: string;
  value: string;
}

export interface ChartLine {
  stream: string;
  label: string;
  colour: string;
}

/** A line chart on linear axes, for the stations whose story is not a size curve. */
export interface Plot {
  title: string;
  x: { label: string; fmt(v: number): string };
  y: { label: string; fmt(v: number): string };
  lines: Array<{ label: string; colour: string; points: Array<[number, number]>; dashed?: boolean }>;
  /** reference lines across the chart: a limit, a target */
  marks?: Array<{ y: number; colour: string; label: string }>;
  /** where the plant sits now */
  dot?: { x: number; y: number; colour: string; label: string };
}

export interface Station {
  id: StationId;
  title: string;
  short: string;
  blurb: string;
  sliders: Slider[];
  /** node ids whose ProcessPro warnings belong to this station */
  nodes: string[];
  checks(c: Contract, d: Design, s: Summary): Check[];
  rows(c: Contract, d: Design, s: Summary): Row[];
  /** size curves of these streams */
  chart: ChartLine[];
  /** a size target to mark on the chart */
  target?(c: Contract): number;
  /** or a chart of its own */
  plot?(c: Contract, d: Design, s: Summary): Plot | null;
}

export const fmt = {
  size(m: number): string {
    if (!Number.isFinite(m)) return '—';
    if (m >= 0.01) return `${(m * 1000).toFixed(0)} mm`;
    if (m >= 0.001) return `${(m * 1000).toFixed(1)} mm`;
    return `${(m * 1e6).toFixed(0)} µm`;
  },
  tph: (v: number) => (Number.isFinite(v) ? `${v.toFixed(0)} t/h` : '—'),
  pct: (v: number, dp = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—'),
  kW: (w: number) => (Number.isFinite(w) ? `${(w / 1000).toLocaleString('en', { maximumFractionDigits: 0 })} kW` : '—'),
  m: (v: number, dp = 1) => (Number.isFinite(v) ? `${v.toFixed(dp)} m` : '—'),
  kPa: (pa: number) => (Number.isFinite(pa) ? `${Math.round(pa / 1000).toLocaleString('en')} kPa` : '—'),
  m3h: (m3s: number) => (Number.isFinite(m3s) ? `${Math.round(m3s * 3600).toLocaleString('en')} m³/h` : '—'),
  mh: (ms: number) => (Number.isFinite(ms) ? `${(ms * 3600).toFixed(2)} m/h` : '—'),
  flux: (kgm2s: number) => (Number.isFinite(kgm2s) ? `${(kgm2s * 3.6).toFixed(2)} t/m²/h` : '—'),
  min: (s: number) => (Number.isFinite(s) ? `${(s / 60).toFixed(1)} min` : '—'),
  kNm: (nm: number) => (Number.isFinite(nm) ? `${Math.round(nm / 1000).toLocaleString('en')} kN·m` : '—'),
};

export const res = (s: Summary, node: string, key: string): number => s.results[node]?.[key] ?? Number.NaN;
export const known = (v: number) => Number.isFinite(v);
export const pick = <T,>(list: T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, Math.round(i)))];

export const GREY = '#8b9bb0';
export const CYAN = '#35e0d0';
export const AMBER = '#ffab3d';
export const LIME = '#9fe870';
export const PINK = '#ff5fa2';
