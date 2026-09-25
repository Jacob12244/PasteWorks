/**
 * Paste rheology and pipeline hydraulics.
 *
 * The models here are the standard ones used for cemented paste backfill
 * design. They are simplified in their constants (a real job calibrates every
 * one of these against loop-test data on the actual tailings) but the FORM of
 * each equation is the real one, so the trade-offs the player feels are the
 * trade-offs a paste plant actually has.
 *
 *   yield stress    tau_y = A.exp(B.Cv)              exponential fit to vane data
 *   slump           Pashias et al. (1996) cylinder slump model
 *   pipeline        Buckingham equation, Bingham plastic laminar flow
 *   turbulent       Darcy-Weisbach with Bingham-plastic Reynolds number
 *   strength        UCS = k.Bd^n.exp(c.(Cw - Cw0))   after Belem & Benzaazoua
 */

import { G, clamp } from './streams';

/**
 * Slump moulds.
 *
 * The model is Boger's: Pashias, Boger, Summers & Glenister (1996) derived it
 * for a CYLINDRICAL mould, and the cylinder is what a paste plant actually
 * measures - it is repeatable on a stiff paste where an Abrams cone is not,
 * and it inverts straight back to a yield stress. 200 mm is the usual height.
 *
 * The 300 mm Abrams cone is carried alongside it because concrete practice
 * quotes inches of cone slump and every site conversation ends up there. It is
 * a reported number only; the plant is controlled on the cylinder.
 */
export const SLUMP_CYLINDER_H = 0.2;
export const SLUMP_CONE_H = 0.3;

/**
 * Static yield stress, Pa. Fitted so that a typical full-plant paste sits in
 * the right band: Cv 0.50 -> ~100 Pa, Cv 0.58 -> ~400 Pa.
 * Binder stiffens the mix, roughly 4% extra yield stress per 1% binder dose.
 */
export function yieldStress(Cv: number, binderDosePct: number): number {
  const base = 0.01726 * Math.exp(17.33 * clamp(Cv, 0, 0.75));
  return base * (1 + 0.04 * Math.max(0, binderDosePct));
}

/** Bingham plastic viscosity, Pa.s */
export function plasticViscosity(Cv: number): number {
  return 0.003 * Math.exp(9.0 * clamp(Cv, 0, 0.75));
}

/**
 * Boger (Pashias et al. 1996) slump model.
 *   s' = 1 - 2.tau' (1 - ln(2.tau'))      with tau' = tau_y / (rho.g.H)
 * Returns slump in mm. Above tau' = 0.5 the sample does not deform at all.
 */
function slumpAt(tauY: number, densityTonnesPerM3: number, H: number): number {
  const rho = densityTonnesPerM3 * 1000;
  const tauN = tauY / (rho * G * H);
  if (tauN >= 0.5) return 0;
  const t2 = 2 * tauN;
  const sNorm = 1 - t2 * (1 - Math.log(t2));
  return clamp(sNorm, 0, 1) * H * 1000;
}

/** Boger cylinder slump, mm - the number the plant is controlled on. */
export function slump(tauY: number, densityTonnesPerM3: number): number {
  return slumpAt(tauY, densityTonnesPerM3, SLUMP_CYLINDER_H);
}

/** Equivalent 300 mm Abrams cone slump, mm - reported, never controlled on. */
export function coneSlump(tauY: number, densityTonnesPerM3: number): number {
  return slumpAt(tauY, densityTonnesPerM3, SLUMP_CONE_H);
}

/**
 * Invert the Boger model: the yield stress a measured cylinder slump implies.
 * This is the whole point of the test - a $2 mould reads out a rheology.
 */
export function yieldFromSlump(slumpMm: number, densityTonnesPerM3: number): number {
  const rho = densityTonnesPerM3 * 1000;
  const target = clamp(slumpMm / 1000 / SLUMP_CYLINDER_H, 0, 1);
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const t2 = 2 * mid;
    const s = t2 <= 0 ? 1 : 1 - t2 * (1 - Math.log(t2));
    if (s > target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi) * rho * G * SLUMP_CYLINDER_H;
}

export interface PipeResult {
  /** bulk velocity, m/s */
  velocity: number;
  /** wall shear stress, Pa */
  wallShear: number;
  /** friction gradient, kPa per m of pipe */
  gradient: number;
  /** total friction loss over the run, kPa */
  friction: number;
  /** static head recovered by the vertical drop, kPa (positive = helps you) */
  staticRecovery: number;
  /** pressure the pump must actually generate, kPa (can go negative = free flow) */
  pumpPressure: number;
  regime: 'laminar' | 'turbulent' | 'stalled';
  reynolds: number;
  hedstrom: number;
}

/**
 * Solve the Buckingham equation for wall shear stress given a flow rate.
 *
 *   Q = (pi.D^3.tau_w / 32.eta) . [ 1 - (4/3)(tau_y/tau_w) + (1/3)(tau_y/tau_w)^4 ]
 *
 * Monotonic in tau_w above tau_y, so a bisection is robust and fast.
 */
function solveWallShear(Q: number, D: number, tauY: number, eta: number): number {
  if (Q <= 1e-9) return tauY;
  const target = Q;
  const f = (tw: number) => {
    const x = tauY / tw;
    const bracket = 1 - (4 / 3) * x + (1 / 3) * Math.pow(x, 4);
    return ((Math.PI * Math.pow(D, 3) * tw) / (32 * eta)) * Math.max(0, bracket) - target;
  };
  let lo = tauY * 1.0000001;
  let hi = Math.max(tauY * 2, 10);
  let guard = 0;
  while (f(hi) < 0 && guard++ < 200) hi *= 2;
  for (let i = 0; i < 90; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Full pipeline solve for a paste run.
 * @param flowM3h volumetric flow
 * @param diaMm   internal pipe diameter
 * @param lengthM developed length of the run
 * @param dropM   vertical drop from collar to stope (positive = downhill)
 */
export function pipeline(
  flowM3h: number,
  diaMm: number,
  lengthM: number,
  dropM: number,
  tauY: number,
  eta: number,
  densityTonnesPerM3: number,
  /** only the static head feels local gravity; friction does not care */
  g = G,
): PipeResult {
  const D = diaMm / 1000;
  const A = (Math.PI * D * D) / 4;
  const Q = flowM3h / 3600;
  const V = A > 1e-9 ? Q / A : 0;
  const rho = densityTonnesPerM3 * 1000;

  const He = (rho * D * D * tauY) / (eta * eta);
  const Re = eta > 1e-9 ? (rho * V * D) / eta : 0;
  // Critical Reynolds number for a Bingham plastic rises with Hedstrom number.
  const ReCrit = 2100 * (1 + 0.000_012 * Math.pow(He, 0.6));

  let tauW: number;
  let regime: PipeResult['regime'];

  if (Q <= 1e-9) {
    // No flow: the pump still has to overcome the static yield stress to
    // break the paste loose again. This is the restart pressure.
    tauW = tauY;
    regime = 'stalled';
  } else if (Re < ReCrit) {
    tauW = solveWallShear(Q, D, tauY, eta);
    regime = 'laminar';
  } else {
    // Turbulent: Blasius on the Bingham Reynolds number, with the yield
    // stress as a floor on wall shear.
    const f = 0.079 * Math.pow(Math.max(Re, 4000), -0.25);
    tauW = Math.max(tauY, 0.5 * f * rho * V * V);
    regime = 'turbulent';
  }

  const gradPa = (4 * tauW) / D; // Pa per m
  const gradient = gradPa / 1000; // kPa/m
  const friction = gradient * lengthM;
  const staticRecovery = (rho * g * dropM) / 1000; // kPa
  return {
    velocity: V,
    wallShear: tauW,
    gradient,
    friction,
    staticRecovery,
    pumpPressure: friction - staticRecovery,
    regime,
    reynolds: Re,
    hedstrom: He,
  };
}

/**
 * 28-day unconfined compressive strength, kPa.
 * Strength climbs steeply with binder dose and with how much water you managed
 * to keep OUT of the mix — which is exactly the tension the plant has to manage.
 * @param density how steeply this binder leans on paste density; 1 is portland
 */
export function ucs28(binderDosePct: number, pasteCw: number, density = 1): number {
  if (binderDosePct <= 0.05) return 0;
  return 105 * Math.pow(binderDosePct, 1.4) * Math.exp(8 * density * (pasteCw - 0.76));
}

/** Rough pipe wear: Wear rate scales hard with velocity and with solids loading. */
export function wearRate(velocity: number, Cv: number): number {
  return Math.pow(Math.max(0, velocity), 2.4) * (0.35 + Cv) * 0.02;
}
