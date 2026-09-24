/**
 * The catalogue the sizing game picks from: the sizes crushers, screens and
 * cyclones are actually sold in, named generically by their dimensions. A
 * slider over one of these steps from size to size, the way a real selection
 * does; the mill is the exception, since mills are built to order.
 *
 * The jaws are a published single-toggle range (feed opening, setting range
 * and installed power as the maker lists them), the cones a published
 * hydraulic cone range (head diameter, the settings its capacities are quoted
 * over, installed power). ProcessPro's rating.ts fits its capacity relations
 * to the same tables.
 */

export interface JawSize {
  /** feed opening, metres: across the jaws and between them at the top */
  width: number;
  gape: number;
  /** the settings the machine can be adjusted to, metres */
  cssMin: number;
  cssMax: number;
  /** installed power, kW */
  kW: number;
}

export interface ConeSize {
  /** head (mantle) diameter, metres */
  head: number;
  /** the settings the capacity table covers, metres */
  cssMin: number;
  cssMax: number;
  kW: number;
}

export type Cavity = 'coarse' | 'fine';

/**
 * A cone's cavity: a secondary cone takes a coarse one, for the biggest feed;
 * a tertiary a fine one, for the tightest setting. The feed openings and the
 * coarse cavity's smallest setting are the published ones for a 1120 mm head
 * (coarse 211 mm closed-side feed opening at a 20 mm setting; fine 107 mm),
 * scaled in proportion to the head: an assumption, since the maker lists the
 * cavities of that size only.
 */
export function cavity(cone: ConeSize, kind: Cavity): { feedOpening: number; cssMin: number; cssMax: number } {
  const k = cone.head / 1.12;
  return kind === 'coarse'
    ? { feedOpening: 0.211 * k, cssMin: Math.max(cone.cssMin, 0.02 * k), cssMax: cone.cssMax }
    : { feedOpening: 0.107 * k, cssMin: cone.cssMin, cssMax: cone.cssMax };
}

export interface ScreenSize {
  width: number;
  length: number;
}

const mm = (v: number) => v / 1000;

export const JAWS: JawSize[] = [
  { width: mm(800), gape: mm(510), cssMin: mm(40), cssMax: mm(175), kW: 75 },
  { width: mm(930), gape: mm(580), cssMin: mm(60), cssMax: mm(175), kW: 90 },
  { width: mm(1060), gape: mm(700), cssMin: mm(70), cssMax: mm(200), kW: 110 },
  { width: mm(1150), gape: mm(760), cssMin: mm(70), cssMax: mm(200), kW: 132 },
  { width: mm(1200), gape: mm(870), cssMin: mm(70), cssMax: mm(175), kW: 160 },
  { width: mm(1300), gape: mm(1000), cssMin: mm(100), cssMax: mm(250), kW: 185 },
  { width: mm(1400), gape: mm(1200), cssMin: mm(125), cssMax: mm(250), kW: 200 },
  { width: mm(1600), gape: mm(1200), cssMin: mm(150), cssMax: mm(300), kW: 250 },
  { width: mm(2000), gape: mm(1500), cssMin: mm(175), cssMax: mm(300), kW: 400 },
];

export const CONES: ConeSize[] = [
  { head: 0.735, cssMin: mm(6), cssMax: mm(32), kW: 90 },
  { head: 0.94, cssMin: mm(10), cssMax: mm(38), kW: 132 },
  { head: 1.12, cssMin: mm(10), cssMax: mm(45), kW: 220 },
  { head: 1.32, cssMin: mm(10), cssMax: mm(51), kW: 315 },
  { head: 1.52, cssMin: mm(10), cssMax: mm(51), kW: 355 },
  { head: 1.65, cssMin: mm(10), cssMax: mm(51), kW: 600 },
];

export const SCREENS: ScreenSize[] = [
  { width: 1.8, length: 4.8 },
  { width: 1.8, length: 6.1 },
  { width: 2.4, length: 6.1 },
  { width: 2.4, length: 7.3 },
  { width: 3.0, length: 7.3 },
  { width: 3.6, length: 7.3 },
  { width: 3.6, length: 8.5 },
];

/** Hydrocyclone diameters, metres: the standard 4 to 33 inch series. */
export const CYCLONES: number[] = [0.1, 0.15, 0.25, 0.38, 0.5, 0.66, 0.84];

/** Screen cloth apertures on the preferred series, metres. */
export const APERTURES: number[] = [4, 5, 6, 8, 10, 12, 14, 16, 20, 25].map(mm);

export const jawLabel = (j: JawSize) => `${Math.round(j.width * 1000)} x ${Math.round(j.gape * 1000)} mm, ${j.kW} kW`;
export const coneLabel = (c: ConeSize) => `${Math.round(c.head * 1000)} mm head, ${c.kW} kW`;
export const screenLabel = (s: ScreenSize) => `${s.width.toFixed(1)} x ${s.length.toFixed(1)} m`;
export const cycloneLabel = (d: number) => `${Math.round(d * 1000)} mm`;
