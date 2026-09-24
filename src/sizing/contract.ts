import type { Contract, Design } from './circuit';

/**
 * Contracts: a seeded draw of the ore and what the client wants from it. The
 * same number always gives the same contract, so a score on contract 4821 is
 * a score on the same job for everyone who plays it.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rounded to a step, and to the digits the step has, so 12.6 is not 12.600000000000001. */
const round = (v: number, step: number) => {
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number((Math.round(v / step) * step).toFixed(digits));
};

export function contractFor(seed: number): Contract {
  const r = mulberry32(seed * 2654435761);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const wi = round(between(10.5, 18.5), 0.1);
  const lo = round(between(0.28, 0.34), 0.01);
  return {
    seed,
    tph: round(between(180, 420), 10),
    rom: { x50: round(between(0.13, 0.22), 0.005), xmax: round(between(0.6, 0.9), 0.01), b: round(between(2.0, 2.6), 0.05) },
    density: round(between(2650, 3050), 10),
    wi,
    ai: round(between(0.08, 0.5), 0.01),
    // Austin's rates were measured on a copper ore of about Wi 14; a harder ore breaks proportionally slower
    breakage: 0.94 * (14.2 / wi),
    p80: round(between(75, 150), 5) * 1e-6,
    overflowCw: [lo, lo + 0.08],
  };
}

/** A contract number nobody chose: today's first, then any. */
export function randomSeed(): number {
  return 1000 + Math.floor(Math.random() * 99000);
}

/** Where the sliders start: a plant off the shelf, sized for nothing in particular. */
export function starterDesign(): Design {
  return {
    grizzly: 0.1,
    jawModel: 3,
    jawCss: 0.15,
    secModel: 2,
    secCss: 0.035,
    tertModel: 2,
    tertCss: 0.012,
    screenMesh: 4,
    screenModel: 3,
    screens: 2,
    millD: 4.5,
    millL: 6.5,
    millJ: 0.3,
    millCw: 0.72,
    cycModel: 4,
    cyclones: 6,
    cycFeedCw: 0.55,
    cycUfCw: 0.72,
  };
}
