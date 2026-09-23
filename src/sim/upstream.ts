/**
 * The circuit that makes the tailings in the first place.
 *
 * In standard mode the backfill plant is handed a fixed tailings stream and
 * the only question is what you do with it. Hard mode hands you the mill,
 * the flotation bank and the deslime cyclones as well - and then the particle
 * size distribution, the sulphide content and the tonnage all become things
 * you set, and every one of them reaches through into the paste.
 *
 *   ore -> SAG/ball MILL -> FLOTATION -> tailings -> DESLIME CYCLONES -> backfill
 *                               |                          |
 *                          concentrate                 fines to TSF
 *
 *   grind     Bond's law:  W = 10.Wi.(1/sqrt(P80) - 1/sqrt(F80))
 *   PSD       Gates-Gaudin-Schuhmann:  F(x) = (x/k)^m
 *   cyclone   d50c falls with the square root of feed pressure
 *   flotation mass pull from head grade, recovery and concentrate grade
 *   media     Bond power draw falls with charge filling J.(1 - 0.937J)
 */

import { clamp } from './streams';

export type BinderType = 'opc' | 'slag';

/**
 * Where the plant's feed comes from. Each world gets its tailings a different
 * way, and that is most of what makes the worlds different.
 *
 *   mill       ore, ground in a ball mill            (today, Psyche)
 *   collector  seabed sediment, sucked up with the nodules   (the abyss)
 *   reclaim    an old tailings dam, dredged back out  (Meridian)
 *   scoop      waste piles, crushed                   (the last shift)
 */
export type Source = 'mill' | 'collector' | 'reclaim' | 'scoop';

/**
 * What the upstream circuit takes OUT before the rest comes to the plant.
 *
 *   flotation  sulphides float off, and what is left can attack the binder
 *   magnetic   metal pulled off on a drum - there is nothing to float on Psyche
 *   nodules    screened off the sediment and sent up the riser to the ship
 *   scrap      a magnet over the crusher discharge
 *   none       old tailings are already tailings
 */
export type Separation = 'flotation' | 'magnetic' | 'nodules' | 'scrap' | 'none';

export interface UpstreamSetpoints {
  /** fresh ore to the mill, t/h */
  millFeed: number;
  /** frother dose, g/t - buys sulphide recovery, and so cleaner tailings */
  frother: number;
  /** deslime cyclones in or out of circuit */
  deslime: boolean;
  /** cyclone feed pressure, kPa - sets the cut size */
  cyclonePressure: number;
  /** ordinary portland, or a slag blend that resists sulphate attack */
  binderType: BinderType;
}

export const DEFAULT_UPSTREAM: UpstreamSetpoints = {
  millFeed: 420,
  frother: 28,
  deslime: true,
  cyclonePressure: 110,
  binderType: 'opc',
};

export const ORE = {
  source: 'mill' as Source,
  separation: 'flotation' as Separation,
  /** 1 if this flowsheet has deslime cyclones at all */
  deslimeCircuit: 1,

  // ---- feeds that arrive already sized (collector, reclaim) ------------
  /** P80 of the material as it comes out of the ground, um */
  nativeP80: 118,
  /** sulphur in it, % */
  nativeSulphide: 0.42,
  /** solids concentration it arrives at */
  nativeCw: 0.30,
  /** fraction of the collected mass that is nodules and goes up the riser */
  noduleFrac: 0.45,
  /** fraction of the ore that is metal, for a magnetic separation */
  metalFrac: 0.38,
  sgMetal: 7.8,

  bondWi: 14.2,        // kWh/t, a competent sulphide ore
  f80: 12000,          // um, SAG product to the ball mill
  millPowerKw: 4600,   // installed, at the design ball charge
  headGradeS: 3.5,     // % sulphur in the ore
  concGradeS: 32,      // % sulphur in the flotation concentrate
  /** Gates-Gaudin-Schuhmann distribution modulus for this tailings */
  ggsM: 0.75,
  sgGangue: 2.72,
  sgSulphide: 4.9,
  costGrinding: 0.11,  // $/kWh, same power price as the backfill plant
  costFrother: 5800,   // $/t

  // ---- grinding media -------------------------------------------------
  /** forged high-chrome balls, delivered */
  costMedia: 1250,     // $/t
  /** what the ball charging hopper on the mill feed end holds */
  hopperCap: 16,       // t - a ball mill day bin is sized in days, not weeks
  /** steel consumption per tonne of ore - a normal ball mill number */
  mediaKgPerT: 0.78,
};

/**
 * Grinding media consumption, t/h. Steel wears out faster the harder you are
 * grinding, so a fine grind eats its own charge.
 */
export function mediaDraw(millFeed: number, specificEnergy: number): number {
  const wear = clamp(0.62 + 0.035 * specificEnergy, 0.6, 1.6);   // kg/t of ore
  return (clamp(millFeed, 0, 900) * ORE.mediaKgPerT * wear) / 1000;
}

/**
 * What the ball charge does to the mill as it runs down.
 *
 * A mill draws power in proportion to J.(1 - 0.937J) for a charge filling J,
 * so an under-charged mill simply cannot put the energy in. On top of that, a
 * charge that is never topped up loses its top size - the coarse-breaking end
 * of the distribution wears away and the mill behaves like harder ore. Both
 * push the product coarser, which is the whole mechanic.
 */
export function mediaEffect(health: number): { power: number; workIndex: number } {
  const h = clamp(health, 0, 1);
  const J0 = 0.32;
  const J = J0 * (0.62 + 0.38 * h);
  const bond = (j: number) => j * (1 - 0.937 * j);
  return {
    power: clamp(bond(J) / bond(J0), 0.55, 1),
    workIndex: 1 + 0.55 * (1 - h),
  };
}

export interface FeedSpec {
  /** dry tailings actually delivered to the backfill plant, t/h */
  solids: number;
  /** as-received solids concentration, fraction */
  cw: number;
  /** 80% passing size of the tailings, um */
  p80: number;
  /** fraction finer than 20 um - the number that drives everything downstream */
  fines20: number;
  /** sulphur in the tailings, % */
  sulphide: number;
  /** dry solids SG, which rises with residual sulphides */
  sg: number;
  /** false in standard mode, where the tailings are a fixed given */
  hard: boolean;

  // --- diagnostics for the panels ---
  specificEnergy: number;  // kWh/t
  millPower: number;       // kW drawn
  millLimited: boolean;    // asking for more grind than the motor can give
  massPull: number;        // % of mill feed reporting to concentrate
  concentrate: number;     // t/h
  sulphideRecovery: number; // fraction
  liberation: number;      // fraction of recovery the grind actually allows
  workIndex: number;       // kWh/t the charge is behaving like
  d50c: number;            // um, deslime cut size
  toTsf: number;           // t/h of fines rejected to the tailings facility
  deslimeSplit: number;    // fraction of flotation tails reporting to backfill
}

/** Multipliers the tailings PSD and chemistry apply to the backfill plant. */
export interface FeedEffects {
  /** press capacity - coarse cake filters far faster than fine */
  filterCapacity: number;
  /** cake moisture - fines hold water that pressure will not remove */
  cakeMoisture: number;
  /** yield stress at a given solids volume fraction */
  yieldStress: number;
  /** 28 d strength - coarse, low-sulphide tails bind better per tonne of binder */
  ucs: number;
}

/** The PSD a standard-mode plant is handed; every effect is 1.0 here. */
export const BASE_FINES = 0.22;

/**
 * Gates-Gaudin-Schuhmann size modulus from a P80.
 *   F(x) = (x/k)^m, and F(P80) = 0.8
 */
function ggsK(p80: number, m: number): number {
  return p80 / Math.pow(0.8, 1 / m);
}

/** Fraction of the distribution finer than x microns. */
function passing(x: number, p80: number, m: number): number {
  return clamp(Math.pow(x / ggsK(p80, m), m), 0, 1);
}

/**
 * Grind, float and classify the ore.
 * @param hard   when false, returns the fixed standard-mode tailings stream
 * @param health ball charge condition, 0..1 - see mediaEffect()
 */
export function upstream(sp: UpstreamSetpoints, hard: boolean, health = 1): FeedSpec {
  if (hard && ORE.source !== 'mill') return otherSources(sp, health);
  if (hard && ORE.separation === 'magnetic') return magnetic(sp, health);
  if (!hard) {
    return {
      solids: 180, cw: 0.32,
      p80: 118, fines20: BASE_FINES, sulphide: 0.42, sg: 2.80, hard: false,
      specificEnergy: 0, millPower: 0, millLimited: false,
      massPull: 0, concentrate: 0, sulphideRecovery: 0,
      liberation: 1, workIndex: ORE.bondWi,
      d50c: 0, toTsf: 0, deslimeSplit: 1,
    };
  }

  const feed = clamp(sp.millFeed, 150, 700);
  const media = mediaEffect(health);

  // ---- grind: Bond's law -----------------------------------------------
  // Specific energy is whatever power the charge will draw, divided by
  // tonnage - so pushing tonnes through the mill buys a coarser product, and
  // so does letting the ball charge run down.
  const millPower = ORE.millPowerKw * media.power;
  const workIndex = ORE.bondWi * media.workIndex;
  const specificEnergy = millPower / feed;
  const invSqrtP = specificEnergy / (10 * workIndex) + 1 / Math.sqrt(ORE.f80);
  const p80 = clamp(1 / (invSqrtP * invSqrtP), 18, 600);
  const fines20 = clamp(passing(20, p80, ORE.ggsM), 0.04, 0.72);

  // ---- flotation --------------------------------------------------------
  // Recovery climbs with frother and then flattens off, the way it does on
  // any real bank. Cleaner tailings cost reagent.
  //
  // But reagent cannot recover what the mill has not liberated: past about
  // 140 um the sulphides are still locked in composite particles and they
  // walk out with the tailings. Grind too fine instead and slimes cost you
  // recovery at the other end. This is what stops "coarser is always better"
  // from being the whole game.
  const frother = clamp(sp.frother, 0, 60);
  const locked = clamp(1 - 0.85 * Math.max(0, (p80 - 140) / 300), 0.3, 1);
  const slimed = clamp(1 - 0.5 * Math.max(0, (60 - p80) / 60), 0.7, 1);
  const liberation = locked * slimed;
  const recovery = clamp(
    (0.58 + 0.42 * (1 - Math.exp(-frother / 22))) * liberation, 0, 0.965);
  const massPull = (ORE.headGradeS * recovery) / ORE.concGradeS;   // fraction
  const concentrate = feed * massPull;
  const floatTails = feed - concentrate;
  const sInTails = (ORE.headGradeS / 100) * feed * (1 - recovery);
  const sulphide = floatTails > 1e-6 ? (sInTails / floatTails) * 100 : 0;

  // dense sulphides left behind raise the SG of the tailings solids
  const sulphideMassFrac = clamp(sulphide / 100 / 0.535, 0, 0.3); // S -> pyrite
  const sg = 1 / ((1 - sulphideMassFrac) / ORE.sgGangue + sulphideMassFrac / ORE.sgSulphide);

  // ---- deslime cyclones -------------------------------------------------
  // Taking the fines out makes far better backfill and throws away the mass
  // you needed to fill the stope with. That is the whole trade.
  let solids = floatTails;
  let backfillFines = fines20;
  let d50c = 0;
  let toTsf = 0;
  let deslimeSplit = 1;

  if (sp.deslime) {
    const P = clamp(sp.cyclonePressure, 40, 260);
    d50c = clamp(42 * Math.sqrt(100 / P), 12, 90);

    const belowCut = passing(d50c, p80, ORE.ggsM);
    // no cyclone is a sharp cut - some fines always bypass to the underflow
    const BYPASS = 0.28;
    const toOverflow = belowCut * (1 - BYPASS);
    deslimeSplit = 1 - toOverflow;

    solids = floatTails * deslimeSplit;
    toTsf = floatTails - solids;

    const finesToUf = fines20 * BYPASS;
    backfillFines = clamp(finesToUf / Math.max(deslimeSplit, 1e-6), 0.02, 0.72);
  }

  // Tailings arrive at whatever the mill circuit leaves them at; a coarser,
  // desliming circuit hands over a denser stream.
  const cw = clamp(0.30 + (sp.deslime ? 0.10 : 0) + (p80 - 118) * 0.00018, 0.24, 0.40);

  return {
    solids, cw,
    p80, fines20: backfillFines, sulphide, sg, hard: true,
    specificEnergy,
    millPower,
    millLimited: specificEnergy > 24,
    liberation, workIndex,
    massPull: massPull * 100,
    concentrate,
    sulphideRecovery: recovery,
    d50c, toTsf, deslimeSplit,
  };
}

/** Bond's law on whatever is doing the grinding - a ball mill or a crusher. */
function grind(feed: number, health: number) {
  const media = mediaEffect(health);
  const millPower = ORE.millPowerKw * media.power;
  const workIndex = ORE.bondWi * media.workIndex;
  const specificEnergy = millPower / feed;
  const invSqrtP = specificEnergy / (10 * workIndex) + 1 / Math.sqrt(ORE.f80);
  const p80 = clamp(1 / (invSqrtP * invSqrtP), 18, 900);
  return { millPower, workIndex, specificEnergy, p80 };
}

/** Deslime cyclones on any stream: the cut, the split, and the fines kept. */
function deslime(sp: UpstreamSetpoints, tails: number, p80: number, fines20: number) {
  if (!ORE.deslimeCircuit || !sp.deslime) {
    return { solids: tails, fines: fines20, d50c: 0, toTsf: 0, split: 1 };
  }
  const P = clamp(sp.cyclonePressure, 40, 260);
  const d50c = clamp(42 * Math.sqrt(100 / P), 12, 90);
  const BYPASS = 0.28;
  const toOverflow = passing(d50c, p80, ORE.ggsM) * (1 - BYPASS);
  const split = 1 - toOverflow;
  const solids = tails * split;
  return {
    solids, d50c, split,
    toTsf: tails - solids,
    fines: clamp((fines20 * BYPASS) / Math.max(split, 1e-6), 0.02, 0.72),
  };
}

/**
 * Psyche: the ore IS metal. It is ground, and the metal is pulled off on a
 * magnetic drum; the silicate left behind is the waste. There are no
 * sulphides to attack the binder - but metal the drum misses rides along in
 * the tailings and makes them heavier, and liberation still rules: a coarse
 * grind leaves metal locked in silicate, and that metal is lost product.
 */
function magnetic(sp: UpstreamSetpoints, health: number): FeedSpec {
  const feed = clamp(sp.millFeed, 150, 700);
  const g = grind(feed, health);
  const fines20 = clamp(passing(20, g.p80, ORE.ggsM), 0.04, 0.72);
  const liberation = clamp(1 - 0.85 * Math.max(0, (g.p80 - 140) / 300), 0.3, 1);
  const recovery = clamp(0.95 * liberation, 0, 0.95);
  const concentrate = feed * ORE.metalFrac * recovery;
  const tails = feed - concentrate;
  const metalLeft = (feed * ORE.metalFrac * (1 - recovery)) / Math.max(tails, 1e-6);
  const sg = 1 / ((1 - metalLeft) / ORE.sgGangue + metalLeft / ORE.sgMetal);
  const d = deslime(sp, tails, g.p80, fines20);
  return {
    solids: d.solids,
    cw: clamp(0.30 + (g.p80 - 118) * 0.00018, 0.24, 0.40),
    p80: g.p80, fines20: d.fines, sulphide: 0, sg, hard: true,
    specificEnergy: g.specificEnergy, millPower: g.millPower,
    millLimited: g.specificEnergy > 24,
    liberation, workIndex: g.workIndex,
    massPull: (concentrate / feed) * 100, concentrate,
    sulphideRecovery: recovery,
    d50c: d.d50c, toTsf: d.toTsf, deslimeSplit: d.split,
  };
}

/**
 * Feeds that do not come out of a mill.
 *
 * The collector and the dredge hand over material that is already the size it
 * is - seabed sediment is naturally fine, old tailings are whatever the old
 * mill made - and their power is pumping, which scales with the rate. The
 * scoop feeds a crusher, which is Bond's law again with a softer, coarser
 * feed and hammers instead of balls. None of them float anything.
 */
function otherSources(sp: UpstreamSetpoints, health: number): FeedSpec {
  const feed = clamp(sp.millFeed, 150, 700);
  let p80 = ORE.nativeP80;
  let millPower = ORE.millPowerKw * (feed / 420);
  let specificEnergy = millPower / feed;
  let workIndex = ORE.bondWi;
  if (ORE.source === 'scoop') {
    const g = grind(feed, health);
    ({ p80, millPower, specificEnergy, workIndex } = g);
  }
  const fines20 = clamp(passing(20, p80, ORE.ggsM), 0.04, 0.72);

  const pulled = ORE.separation === 'nodules' ? ORE.noduleFrac
    : ORE.separation === 'scrap' ? 0.04 : 0;
  const concentrate = feed * pulled;
  const tails = feed - concentrate;
  const sulphide = ORE.nativeSulphide;
  const sulphideMassFrac = clamp(sulphide / 100 / 0.535, 0, 0.3);
  const sg = 1 / ((1 - sulphideMassFrac) / ORE.sgGangue + sulphideMassFrac / ORE.sgSulphide);
  const d = deslime(sp, tails, p80, fines20);

  return {
    solids: d.solids,
    cw: clamp(ORE.nativeCw + (ORE.deslimeCircuit && sp.deslime ? 0.06 : 0), 0.05, 0.95),
    p80, fines20: d.fines, sulphide, sg, hard: true,
    specificEnergy, millPower,
    millLimited: false,
    liberation: 1, workIndex,
    massPull: pulled * 100, concentrate,
    sulphideRecovery: 0,
    d50c: d.d50c, toTsf: d.toTsf, deslimeSplit: d.split,
  };
}

/**
 * How the tailings PSD and chemistry reach through into the backfill plant.
 * Everything is expressed relative to the standard-mode tailings, so in
 * standard mode every multiplier is exactly 1.
 */
export function feedEffects(f: FeedSpec, binder: BinderType): FeedEffects {
  // Standard mode is the calibration point: whatever those tailings are, the
  // backfill models were fitted against them, so nothing is modified.
  if (!f.hard) {
    return { filterCapacity: 1, cakeMoisture: 1, yieldStress: 1, ucs: 1 };
  }

  const rel = clamp(f.fines20 / BASE_FINES, 0.15, 3.2);

  // Specific cake resistance goes up hard with fineness, so filtration rate
  // goes down hard and the cake holds more water.
  const filterCapacity = clamp(Math.pow(1 / rel, 0.55), 0.45, 2.0);
  const cakeMoisture = clamp(Math.pow(rel, 0.30), 0.74, 1.42);

  // Fines bind water and raise yield stress at the same solids content.
  const yieldStress = clamp(Math.pow(rel, 0.55), 0.55, 2.2);

  // Coarser tails bind better per tonne of binder; sulphides attack ordinary
  // portland over the curing period, which a slag blend largely resists.
  const psdGain = clamp(Math.pow(1 / rel, 0.22), 0.8, 1.35);
  const s = clamp(f.sulphide, 0, 3);
  const sulphatePenalty = binder === 'slag'
    ? 1 - 0.07 * s
    : 1 - 0.30 * s;

  return {
    filterCapacity,
    cakeMoisture,
    yieldStress,
    ucs: clamp(psdGain * clamp(sulphatePenalty, 0.15, 1), 0.1, 1.5),
  };
}

/** Operating cost of the upstream circuit, $/h. */
export function upstreamCost(f: FeedSpec, sp: UpstreamSetpoints): number {
  const grinding = f.millPower * ORE.costGrinding;
  const frother = ORE.separation === 'flotation'
    ? (sp.millFeed * clamp(sp.frother, 0, 60) * 1e-6) * ORE.costFrother : 0;
  // the deslime cyclone pumps are not free either
  const cyclones = ORE.deslimeCircuit && sp.deslime
    ? (sp.cyclonePressure / 100) * 180 * ORE.costGrinding : 0;
  return grinding + frother + cyclones;
}
