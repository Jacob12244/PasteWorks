/**
 * Stream mass balance primitives.
 *
 * Every stream in the plant is tracked as three dry/wet mass rates in t/h:
 * tailings solids, free water, and dry binder. Everything else (Cw, Cv,
 * slurry density, volumetric flow) is derived, so the balance can never drift.
 */

export const RHO_WATER = 1.0; // t/m3
/**
 * Tailings solids SG. Mutable because hard mode grinds and floats its own
 * ore, and residual sulphides make the tailings measurably denser.
 */
export let RHO_SOLIDS = 2.80;

export function setSolidsSG(sg: number) {
  RHO_SOLIDS = sg < 2.4 ? 2.4 : sg > 3.6 ? 3.6 : sg;
}
export const RHO_BINDER = 3.10; // OPC / slag blend SG
export const G = 9.81;

export interface Stream {
  /** dry tailings solids, t/h */
  solids: number;
  /** free water, t/h */
  water: number;
  /** dry binder (cement + supplementary), t/h */
  binder: number;
}

export const EMPTY: Readonly<Stream> = Object.freeze({ solids: 0, water: 0, binder: 0 });

export function stream(solids = 0, water = 0, binder = 0): Stream {
  return { solids, water, binder };
}

export function clone(s: Stream): Stream {
  return { solids: s.solids, water: s.water, binder: s.binder };
}

export function add(a: Stream, b: Stream): Stream {
  return {
    solids: a.solids + b.solids,
    water: a.water + b.water,
    binder: a.binder + b.binder,
  };
}

export function scale(s: Stream, k: number): Stream {
  return { solids: s.solids * k, water: s.water * k, binder: s.binder * k };
}

/** total mass rate, t/h */
export function totalMass(s: Stream): number {
  return s.solids + s.water + s.binder;
}

/** total dry mass (tails + binder), t/h */
export function dryMass(s: Stream): number {
  return s.solids + s.binder;
}

/** solids concentration by mass, fraction 0..1 */
export function Cw(s: Stream): number {
  const m = totalMass(s);
  return m > 1e-9 ? dryMass(s) / m : 0;
}

/**
 * Mean dry SG of the combined solid phase (tails + binder), mass weighted
 * on volume: 1/SG = w_t/SG_t + w_b/SG_b
 */
export function drySG(s: Stream): number {
  const d = dryMass(s);
  if (d < 1e-9) return RHO_SOLIDS;
  const wt = s.solids / d;
  const wb = s.binder / d;
  return 1 / (wt / RHO_SOLIDS + wb / RHO_BINDER);
}

/** slurry density, t/m3 */
export function slurryDensity(s: Stream): number {
  const c = Cw(s);
  if (c <= 1e-9) return RHO_WATER;
  const sg = drySG(s);
  return 1 / (c / sg + (1 - c) / RHO_WATER);
}

/** solids concentration by volume, fraction 0..1 */
export function Cv(s: Stream): number {
  const c = Cw(s);
  if (c <= 1e-9) return 0;
  return (c * slurryDensity(s)) / drySG(s);
}

/** volumetric flow, m3/h */
export function volFlow(s: Stream): number {
  const rho = slurryDensity(s);
  return rho > 1e-9 ? totalMass(s) / rho : 0;
}

/** binder dose as % of dry tailings mass — the number the mine actually buys on */
export function binderDose(s: Stream): number {
  return s.solids > 1e-9 ? (s.binder / s.solids) * 100 : 0;
}

/** Re-mix a stream to a target Cw by adding (or notionally removing) water. */
export function toCw(s: Stream, targetCw: number): Stream {
  const d = dryMass(s);
  const t = clamp(targetCw, 0.01, 0.95);
  return { solids: s.solids, binder: s.binder, water: (d * (1 - t)) / t };
}

/** Water that must be ADDED to move a stream from its present Cw down to target. */
export function waterToDilute(s: Stream, targetCw: number): number {
  const needed = toCw(s, targetCw).water;
  return Math.max(0, needed - s.water);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** first-order lag — used so every gauge on the plant moves like real plant does */
export function approach(current: number, target: number, tauSeconds: number, dt: number): number {
  if (tauSeconds <= 1e-6) return target;
  const k = 1 - Math.exp(-dt / tauSeconds);
  return current + (target - current) * k;
}
