import { WATER, pumpForCw, type Backfill, type Contract, type Design } from './circuit';
import { PIPES, PRESS_PLATES } from './equipment';

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

/** Rounded to two significant figures. */
const sig2 = (v: number) => {
  const e = Math.floor(Math.log10(Math.abs(v))) - 1;
  return Number((Math.round(v / 10 ** e) * 10 ** e).toPrecision(2));
};

/** Solids volume fraction at a solids mass fraction. */
const cvAt = (cw: number, density: number) => cw / density / (cw / density + (1 - cw) / WATER);

export function contractFor(seed: number): Contract {
  const r = mulberry32(seed * 2654435761);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const wi = round(between(10.5, 18.5), 0.1);
  const lo = round(between(0.28, 0.34), 0.01);
  const density = round(between(2650, 3050), 10);
  return {
    seed,
    tph: round(between(180, 420), 10),
    rom: { x50: round(between(0.13, 0.22), 0.005), xmax: round(between(0.6, 0.9), 0.01), b: round(between(2.0, 2.6), 0.05) },
    density,
    wi,
    ai: round(between(0.08, 0.5), 0.01),
    // Austin's rates were measured on a copper ore of about Wi 14; a harder ore breaks proportionally slower
    breakage: 0.94 * (14.2 / wi),
    p80: round(between(75, 150), 5) * 1e-6,
    overflowCw: [lo, lo + 0.08],
    // drawn from a stream of its own, so the front half of every contract is what it always was
    backfill: backfillFor(seed, density),
  };
}

/**
 * The backfill half of a contract: flotation's pull, the tailings' test work
 * and the mine's specification. Each fit is set by a figure a test would
 * report (the compressive yield stress at 66% solids, the yield stress and
 * viscosity at 76%, the strength at a water to binder ratio of 6), so every
 * contract's tailings behave like tailings. The strength is set against open
 * cemented paste data (Wilson & Leacy, Paste 2023: about 430 kPa at 28 days
 * at a ratio of 6, Abrams' B about 1.54), and the mine asks for what a ratio
 * of 3.5 to 5.5 makes, which is 5 to 9% binder: what mines run.
 */
function backfillFor(seed: number, density: number): Backfill {
  const r = mulberry32(seed * 2654435761 + 97);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const phiGel = round(between(0.12, 0.17), 0.005);
  const k = round(between(5, 7), 0.1);
  const py66 = between(25e3, 60e3);
  const a = Math.round(py66 / ((cvAt(0.66, density) / phiGel) ** k - 1));
  const cv76 = cvAt(0.76, density);
  const yieldB = round(between(15, 19), 0.1);
  const viscosityB = round(between(8, 10), 0.1);
  const strengthB = round(between(1.4, 1.65), 0.01);
  const strengthA = sig2(between(300e3, 700e3) * strengthB ** 6);
  const ucs = Math.min(2000e3, Math.max(400e3, round(strengthA / strengthB ** between(3.5, 5.5) / 1000, 50) * 1000));
  const drop = round(between(300, 900), 10);
  // on the 200 mm cylinder: 90 to 180 mm is a paste stiff enough to pump laminar and still place
  const slumpLo = round(between(0.09, 0.13), 0.005);
  return {
    pull: round(between(0.02, 0.07), 0.005),
    thick: {
      u0: round(between(8, 18), 0.5) / 3600,
      phiMax: round(between(0.54, 0.62), 0.01),
      phiGel,
      a,
      k,
    },
    feedwellCw: round(between(0.1, 0.15), 0.01),
    alpha: sig2(10 ** between(11.5, 12.4)),
    cakeCw: round(between(0.79, 0.85), 0.005),
    // ProcessPro's tailings press example: 3 min squeeze, 4 blowing, 4 discharging, 4 washing
    technicalTime: 15 * 60,
    rheology: {
      yieldA: sig2(between(100, 350) / Math.exp(yieldB * cv76)),
      yieldB,
      viscosityA: sig2(between(0.2, 0.6) / Math.exp(viscosityB * cv76)),
      viscosityB,
    },
    strength: { a: strengthA, b: strengthB },
    ucs,
    slump: [slumpLo, slumpLo + 0.05],
    surface: round(between(60, 300), 10),
    drop,
    // long enough along the level for the line's friction to hold up the column in the hole
    level: round(drop * between(2, 3.5), 10),
  };
}

/** A contract number nobody chose: today's first, then any. */
export function randomSeed(): number {
  return 1000 + Math.floor(Math.random() * 99000);
}

/** Where the sliders start: a plant off the shelf, sized for nothing in particular. */
export function starterDesign(c: Contract): Design {
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
    thDiam: 20,
    thDepth: 6,
    ufPump: pumpForCw(c, 0.6),
    rakeDrive: 1,
    pressPlate: PRESS_PLATES.findIndex((p) => p.size === 2.0),
    pressChambers: 80,
    presses: 2,
    chamberDepth: 0.04,
    pasteCw: 0.76,
    binder: 0.05,
    pipeModel: PIPES.findIndex((p) => p.nb === 150),
    pumpModel: 2,
    pumps: 1,
  };
}


