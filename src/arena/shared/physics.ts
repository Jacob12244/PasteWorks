/**
 * How a lump flies, and what it hits. The server decides every hit with
 * these, and the page draws every lump in flight with the same ones, so
 * the arc you see is the arc that counts.
 */

import { BODY } from './rules';

/** one sub-step of flight, 60 a second on both ends */
export const STEP = 1 / 60;

export interface Flying {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

/** Move a lump on by h seconds under gravity g. Semi-implicit, so both ends agree to the bit. */
export function advance(l: Flying, h: number, g: number) {
  l.vy -= g * h;
  l.x += l.vx * h;
  l.y += l.vy * h;
  l.z += l.vz * h;
}

/**
 * Closest approach of the segment p0 -> p1 to a standing person with their
 * feet at f. Returns how far along the segment it happens (0..1), and how
 * high up them, or null if it passes wider than reach.
 * After Ericson, Real-Time Collision Detection, 5.1.9.
 */
export function segBody(
  p0x: number, p0y: number, p0z: number, p1x: number, p1y: number, p1z: number,
  fx: number, fy: number, fz: number, reach: number,
): { s: number; up: number } | null {
  const R = BODY.r;
  // the body's axis, from the centre of the bottom sphere to the top one
  const q0x = fx, q0y = fy + R, q0z = fz;
  const d2y = BODY.h - 2 * R;
  const d1x = p1x - p0x, d1y = p1y - p0y, d1z = p1z - p0z;
  const rx = p0x - q0x, ry = p0y - q0y, rz = p0z - q0z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2y * d2y;
  const f = d2y * ry;
  let s: number, t: number;
  if (a < 1e-12) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    const b = d1y * d2y;
    const den = a * e - b * b;
    s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
  }
  const cx = p0x + d1x * s - q0x;
  const cy = p0y + d1y * s - (q0y + d2y * t);
  const cz = p0z + d1z * s - q0z;
  const r = R + reach;
  if (cx * cx + cy * cy + cz * cz > r * r) return null;
  return { s, up: p0y + d1y * s - fy };
}
