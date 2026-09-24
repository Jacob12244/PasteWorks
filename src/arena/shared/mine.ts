import type { Pickup } from './map';

/**
 * The 760 Level: an underground level, for the barrow game.
 *
 * Drawn the way a mine level plan is drawn: a main drive through the middle
 * with a loading bay at its centre, a lane either side of it, crosscuts
 * running across at a skew, and dead-end cuddies off all of them - a crib
 * room, a magazine, a sump, a workshop. Day shift comes on at the west end
 * and Night shift at the east. Each crew has a fill point, where its barrow
 * is filled from a paste line coming down a borehole, and a stope on its own
 * side of the level that the other crew is trying to fill.
 *
 * The level is point-symmetric about the loading bay - turn the plan half a
 * turn and it lands on itself - so neither crew has the better end. Only
 * one half is written out; the other is the same half turned round.
 *
 * Plan coordinates, as on the plant: x east, z south, so north is up on the
 * minimap. The floor of the level is y = 0. All of this is data. The page
 * carves the rock from the shapes, and the server gets the result baked,
 * like the plant.
 */

export type P2 = [number, number];

/**
 * A drive, down a centreline: half-width, wall height, and the rise of the
 * arched back. The tag says what sort, for what gets hung in it.
 */
export interface Drive { k: 'drive'; pts: P2[]; w: number; h: number; a: number; tag?: 'main' | 'lane' | 'xcut' | 'cuddy' }
/** a chamber: a rounded box in plan, turned by rot, with a domed back */
export interface Chamber { k: 'room'; x: number; z: number; hx: number; hz: number; rot: number; h: number; a: number }
/** an open stope: a box of nothing, from far below the level to well above it */
export interface Stope { k: 'stope'; x: number; z: number; hx: number; hz: number; rot: number; bottom: number; top: number }
/** a raise going up through the back */
export interface Rise { k: 'rise'; x: number; z: number; r: number; top: number }
export type Shape = Drive | Chamber | Stope | Rise;

const M = (p: P2): P2 => [-p[0], -p[1]];
function mirror(s: Shape): Shape {
  switch (s.k) {
    case 'drive': return { ...s, pts: s.pts.map(M) };
    default: return { ...s, x: -s.x, z: -s.z };
  }
}

/** the way into a stope from its brow, as the rotation its box needs */
const facing = (d: P2) => Math.atan2(-d[0], d[1]);
const unit = (x: number, z: number): P2 => {
  const l = Math.hypot(x, z);
  return [x / l, z / l];
};

// ------------------------------------------------------------------ one half

const MAIN = { w: 2.8, h: 3.3, a: 1.5, tag: 'main' as const };
const LANE = { w: 2.5, h: 3.1, a: 1.3, tag: 'lane' as const };
const XCUT = { w: 2.3, h: 3.0, a: 1.2, tag: 'xcut' as const };
const CUDDY = { w: 2.2, h: 2.9, a: 1.0, tag: 'cuddy' as const };

/** Day's stope: the brow, and the way in */
const BROW: P2 = [-61, -31];
const INTO = unit(-5, -11);
const STOPE = { hx: 7, hz: 5.5 };

const HALF: Shape[] = [
  // the north lane, fill point end to fill point end the long way round
  { k: 'drive', pts: [[-56, -20], [-36, -27], [-8, -29], [18, -27], [40, -22], [58, -10], [64, -4]], ...LANE },
  // Day's end: from the junction up past the crib room to the north lane
  { k: 'drive', pts: [[-64, 4], [-61, -8], [-56, -20]], ...LANE },
  // the fill point, a short dead end off the west junction
  { k: 'drive', pts: [[-64, 4], [-77, 5.5]], w: 2.4, h: 3.0, a: 1.1 },
  // the crib room, where Day shift comes on, through a door off the junction drive
  { k: 'room', x: -70.5, z: -10, hx: 4.5, hz: 3.2, rot: 0.08, h: 3.0, a: 0.8 },
  { k: 'drive', pts: [[-61.2, -9.3], [-67.5, -9.8]], w: 2.0, h: 2.8, a: 0.9 },
  // the stope: access, and the hole itself
  { k: 'drive', pts: [[-56, -20], BROW], w: 2.6, h: 3.1, a: 1.2 },
  {
    k: 'stope', x: BROW[0] + INTO[0] * STOPE.hz, z: BROW[1] + INTO[1] * STOPE.hz,
    ...STOPE, rot: facing(INTO), bottom: -26, top: 9,
  },
  // a refuge chamber in its own cuddy off the lane
  { k: 'drive', pts: [[-27, -27.8], [-25.8, -35.5]], ...CUDDY },
  // the magazine, a long way from anything
  { k: 'drive', pts: [[-36, -27], [-39, -38]], ...CUDDY },
  // the sump, where the water ends up
  { k: 'drive', pts: [[-18, 27], [-20, 37]], ...CUDDY },
  // the workshop, with a door onto the main drive and one onto the lane
  { k: 'room', x: -46, z: -8, hx: 5.5, hz: 3.6, rot: 0.2, h: 3.6, a: 1.2 },
  { k: 'drive', pts: [[-44, 6.8], [-45.5, -5]], ...XCUT },
  { k: 'drive', pts: [[-47.5, -10], [-49.5, -22]], ...XCUT },
  // a crosscut on the skew, lane to lane across the main drive
  { k: 'drive', pts: [[-18, -28], [-36, 23]], ...XCUT },
  // and a raise up out of the back where it meets the north lane
  { k: 'rise', x: -18, z: -28.2, r: 1.7, top: 30 },
];

/** Everything carved out of the rock. */
export const SHAPES: Shape[] = [
  // the main drive runs the length of the level, and turns on itself
  { k: 'drive', pts: [[-64, 4], [-40, 7], [-16, 3], [16, -3], [40, -7], [64, -4]], ...MAIN },
  // the loading bay in the middle, and the crosscut through it
  { k: 'room', x: 0, z: 0, hx: 8, hz: 5.5, rot: -0.185, h: 4.2, a: 1.8 },
  { k: 'drive', pts: [[9, -29], [-9, 29]], ...XCUT },
  ...HALF,
  ...HALF.map(mirror),
];

// ------------------------------------------------------------------ the crews

export interface Base {
  /** where the barrow waits, under the fill point */
  home: [number, number, number];
  /** which way the barrow faces there - the walker's yaw */
  homeYaw: number;
  /** the edge of this crew's stope, and the way into it */
  brow: P2;
  into: P2;
  /** the stope's hole in plan, for drawing */
  stope: { x: number; z: number; hx: number; hz: number; rot: number };
  /** get the other crew's barrow within BARROW.pour of this and it is poured */
  pour: P2;
  spawns: P2[];
}

const DAY: Base = {
  home: [-74.5, 0, 5.2],
  homeYaw: -Math.PI / 2,
  brow: BROW,
  into: INTO,
  stope: {
    x: BROW[0] + INTO[0] * STOPE.hz, z: BROW[1] + INTO[1] * STOPE.hz, ...STOPE, rot: facing(INTO),
  },
  pour: [BROW[0] - INTO[0] * 1.9, BROW[1] - INTO[1] * 1.9],
  spawns: [
    [-73, -11.4], [-73, -8.6], [-70, -11.6], [-70, -8.4], [-67.4, -10],
    [-71, 5], [-68, 4.6], [-62.2, -2],
  ],
};

const turn = (b: Base): Base => ({
  home: [-b.home[0], b.home[1], -b.home[2]],
  homeYaw: b.homeYaw + Math.PI,
  brow: M(b.brow),
  into: M(b.into),
  stope: { ...b.stope, x: -b.stope.x, z: -b.stope.z },
  pour: M(b.pour),
  spawns: b.spawns.map(M),
});

/** Day shift in the west, Night shift in the east */
export const BASES: [Base, Base] = [DAY, turn(DAY)];

// ------------------------------------------------------------------ the rest

export const BOUNDS = { x0: -80, x1: 80, z0: -46, z1: 46 };
export const CENTRE = { x: 0, z: 0 };
export const CLIP = {
  min: [-90, -30, -54] as const,
  max: [90, 34, 54] as const,
};

/** facing into the level from a spawn - the walker's yaw, zero looking north */
export function spawnYaw(x: number, z: number) {
  return Math.atan2(-(CENTRE.x - x), -(CENTRE.z - z));
}

const PICK_HALF: Pickup[] = [
  { kind: 'cake', x: -30, y: 0, z: 5.3 },
  { kind: 'cake', x: -39, y: 0, z: -36.4 },
  { kind: 'cake', x: -46, y: 0, z: -7.2 },
  { kind: 'cake', x: 5.5, y: 0, z: 2.2 },
  { kind: 'rock', x: -20, y: 0.65, z: 34.6 },
  { kind: 'rock', x: -58.4, y: 0, z: -13 },
  { kind: 'rock', x: 7, y: 0, z: -28.6 },
];
export const PICKUPS: Pickup[] = [
  ...PICK_HALF,
  ...PICK_HALF.map((p) => ({ ...p, x: -p.x, z: -p.z })),
];

/** What the level has lying about in it. Placed in plan, like the plant's props. */
export type MineKind =
  | 'car'       // a side-tipper on the rails
  | 'loader'    // an underground loader, a bogger
  | 'jumbo'     // a two-boom development drill
  | 'refuge'    // a refuge chamber
  | 'muck'      // a pile of broken rock you can climb: a radius, b height
  | 'barrier'   // a jersey barrier
  | 'drums'     // a few drums of oil
  | 'timber'    // a pack of timber
  | 'bags'      // bulk bags of binder
  | 'fan'       // a vent fan on its stand
  | 'bench';    // a workbench

export interface MineProp { kind: MineKind; x: number; z: number; rot?: number; a?: number; b?: number }

const PROP_HALF: MineProp[] = [
  { kind: 'car', x: -50, z: 4.4, rot: -0.12 },
  { kind: 'car', x: -47.4, z: 4.8, rot: -0.12 },
  { kind: 'car', x: -22, z: 2.8, rot: 0.17 },
  { kind: 'jumbo', x: -47.5, z: -8.2, rot: 0.2 },
  { kind: 'bench', x: -44, z: -10.6, rot: 0.2 },
  { kind: 'drums', x: -50.5, z: -6, rot: 0.3 },
  { kind: 'refuge', x: -26.1, z: -32.8, rot: 1.41 },
  { kind: 'muck', x: -20.6, z: 36.2, a: 2.4, b: 1.1 },
  { kind: 'muck', x: -39.5, z: -38.2, a: 1.8, b: 0.8 },
  { kind: 'barrier', x: -54.8, z: 24.5, rot: 0.9 },
  { kind: 'timber', x: -60, z: 13, rot: 1.3 },
  { kind: 'bags', x: -73.2, z: 1.6 },
  { kind: 'fan', x: -38.2, z: -31.5, rot: 1.3 },
  { kind: 'barrier', x: -27, z: -24.6, rot: 0.9 },
  { kind: 'timber', x: 3.6, z: 26.6, rot: 1.46 },
  { kind: 'drums', x: -12.5, z: 1.6 },
];

export const PROPS: MineProp[] = [
  { kind: 'loader', x: -1, z: -1.4, rot: -0.185 + Math.PI / 2 + 0.35 },
  ...PROP_HALF,
  ...PROP_HALF.map((p) => ({ ...p, x: -p.x, z: -p.z, rot: (p.rot ?? 0) + Math.PI })),
];

/** The rails down the main drive, a metre off its centreline. */
export const RAILS: P2[] = [[-60, 3.2], [-40, 6], [-16, 1.9], [16, -4.1], [40, -8], [60, -5.2]];

/** Names on the plan, and on the walls. */
export const LABELS: Array<{ text: string; x: number; z: number }> = [
  { text: 'Loading bay', x: 0, z: -8.5 },
  { text: 'Day crib', x: -71, z: -16 },
  { text: 'Night crib', x: 71, z: 16 },
  { text: 'Refuge', x: -26, z: -39 },
  { text: 'Refuge', x: 26, z: 39 },
  { text: 'Magazine', x: -44, z: -40 },
  { text: 'Fuel bay', x: 44, z: 40 },
  { text: 'Workshop', x: -46, z: -14.5 },
  { text: 'Drill bay', x: 46, z: 14.5 },
  { text: 'Sump', x: -25, z: 39 },
  { text: 'Sump', x: 25, z: -39 },
];
