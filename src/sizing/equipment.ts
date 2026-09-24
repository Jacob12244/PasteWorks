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

// ------------------------------------------------------------ backfill half

/**
 * Rake drive classes, by the torque factor K the drive is rated at (T = K·D²,
 * ft·lb and ft): the MIP Process Technologies thickener note's duty bands,
 * each taken at the top of its band. Extra heavy has no top; 50 is this
 * game's.
 */
export interface RakeDrive {
  name: string;
  k: number;
}
export const RAKE_DRIVES: RakeDrive[] = [
  { name: 'Light', k: 10 },
  { name: 'Medium', k: 20 },
  { name: 'Heavy', k: 35 },
  { name: 'Extra heavy', k: 50 },
];

/**
 * Recessed-plate filter press plates: plate size, filtration area per
 * chamber (both faces) and the most chambers one press frame takes. The
 * 1.0 to 1.5 m plates are a press maker's published range (its area and plate
 * count at each size); 2.0 m is a maker's sizing chart; 2.5 m is the mining
 * presses reported at Paste 2018 and 2025 (9.2 to 9.6 m² a chamber, 184 to 208
 * plates a press).
 */
export interface PressPlate {
  size: number;
  chamberArea: number;
  maxChambers: number;
}
export const PRESS_PLATES: PressPlate[] = [
  { size: 1.0, chamberArea: 1.8, maxChambers: 69 },
  { size: 1.25, chamberArea: 2.8, maxChambers: 91 },
  { size: 1.5, chamberArea: 4.1, maxChambers: 123 },
  { size: 2.0, chamberArea: 6.8, maxChambers: 130 },
  { size: 2.5, chamberArea: 9.4, maxChambers: 200 },
];

/** Paste line: steel pipe by nominal bore, and its inside diameter, metres. */
export interface PipeSize {
  nb: number;
  id: number;
}
export const PIPES: PipeSize[] = [
  { nb: 100, id: 0.097 },
  { nb: 125, id: 0.122 },
  { nb: 150, id: 0.146 },
  { nb: 175, id: 0.17 },
  { nb: 200, id: 0.194 },
  { nb: 250, id: 0.243 },
];

/**
 * Positive-displacement piston paste pumps: most flow and most pressure as a
 * maker's published range lists them (the two are not reached together).
 * Makers quote power packs, not a power per model, so the installed power
 * here is 1.2 times the hydraulic power at the rating; installations run from
 * 1.0 to 1.9 times. That factor is this game's.
 */
export interface PastePump {
  flow: number;
  pressure: number;
  kW: number;
}
const pump = (m3h: number, bar: number): PastePump => ({ flow: m3h / 3600, pressure: bar * 1e5, kW: Math.round(((m3h * bar) / 36) * 1.2) });
export const PASTE_PUMPS: PastePump[] = [pump(55, 70), pump(95, 150), pump(160, 150), pump(250, 150), pump(400, 100)];

export const rakeLabel = (r: RakeDrive) => `${r.name}, K ${r.k}`;
export const plateLabel = (p: PressPlate) => `${(p.size * 1000).toFixed(0)} mm plates, ${p.chamberArea} m²/chamber`;
export const pipeLabel = (p: PipeSize) => `NB ${p.nb}, ${(p.id * 1000).toFixed(0)} mm bore`;
export const pumpLabel = (p: PastePump) => `${Math.round(p.flow * 3600)} m³/h, ${Math.round(p.pressure / 1e5)} bar, ${p.kW} kW`;
