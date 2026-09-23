import type { PickupKind } from './rules';

/**
 * The arena is the plant pad as it stands, fenced in and dressed for it.
 *
 * The plant itself runs down the middle along z = 0, thickener in the west
 * to the paste pumps in the east. Both yards either side of it were open
 * concrete, which is a firing range, not an arena - so the yards get what a
 * real site leaves lying about: containers, bulk bags, jersey barriers,
 * cable drums, pipe spools, and stockpiles of filter cake off the press.
 *
 * Plan coordinates: x runs east, z runs south, the control room is off the
 * south edge. All of this is data - the page builds meshes from it, and the
 * server only needs the spawns and pickups, because the props reach it
 * inside the baked collision world.
 */

/** the fence, in plan */
export const BOUNDS = { x0: -70, x1: 33, z0: -34, z1: 34 };
/** roughly the middle of the fight, for aiming spawns inward */
export const CENTRE = { x: -16, z: 0 };
/**
 * The collision world the arena keeps: the fenced pad and a margin round it,
 * from the bottom of the thickener cone to well above the mixing tower.
 * Page and server both clip to this, so they hold the same triangles.
 */
export const CLIP = {
  min: [BOUNDS.x0 - 6, -45, BOUNDS.z0 - 6] as const,
  max: [BOUNDS.x1 + 6, 40, BOUNDS.z1 + 6] as const,
};

export type PropKind =
  | 'container'   // a 20 ft box, 6.06 x 2.59 x 2.44
  | 'crib'        // a 40 ft box, doors open both ends, a room to run through
  | 'crates'      // a staircase of crates, the way up onto a container
  | 'bags'        // bulk bags of binder on pallets, n by m
  | 'barrier'     // a concrete jersey barrier, 3 m
  | 'mound'       // a stockpile of filter cake, walkable
  | 'drum'        // a cable drum on end
  | 'spools';     // pipe spools stacked on sleepers

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** turn about the vertical, radians */
  rot?: number;
  /** bags: columns, rows. mound: radius, height. crates: steps */
  a?: number;
  b?: number;
}

const Q = Math.PI / 2;

export const PROPS: Prop[] = [
  // ---- south yard -------------------------------------------------------
  { kind: 'crib', x: -40, z: 25 },
  // a pair side by side makes a roof worth climbing to, and the crates are the way up
  { kind: 'container', x: -18, z: 27 },
  { kind: 'container', x: -18, z: 29.5 },
  { kind: 'crates', x: -14.97, z: 27, a: 3 },
  { kind: 'mound', x: -12, z: 11, a: 3.2, b: 1.3 },
  { kind: 'bags', x: 12, z: 26, a: 3, b: 2 },
  { kind: 'drum', x: -6, z: 26 },
  { kind: 'drum', x: -3.6, z: 24.6 },
  { kind: 'barrier', x: 0, z: 30.5 },
  { kind: 'barrier', x: 3.3, z: 30.5 },
  { kind: 'barrier', x: -30, z: 18, rot: Q },
  { kind: 'barrier', x: -58, z: 26, rot: 0.4 },
  { kind: 'barrier', x: -61.5, z: 22.5, rot: 1.2 },
  { kind: 'container', x: 22, z: 29 },
  { kind: 'barrier', x: 26, z: 18 },
  { kind: 'barrier', x: 29.2, z: 19.6, rot: Q },
  { kind: 'barrier', x: -52, z: 16, rot: -0.3 },
  { kind: 'container', x: -60, z: 30.5, rot: 0.15 },
  { kind: 'bags', x: -50, z: 23, a: 2, b: 2 },
  { kind: 'bags', x: -27, z: 26, a: 2, b: 2 },
  { kind: 'spools', x: 8, z: 20 },

  // ---- north yard -------------------------------------------------------
  { kind: 'container', x: -36, z: -24, rot: Q },
  { kind: 'container', x: -56, z: -24, rot: 0.3 },
  { kind: 'container', x: 10, z: -29 },
  { kind: 'mound', x: -6, z: -13, a: 3.0, b: 1.2 },
  { kind: 'mound', x: -26, z: -8, a: 2.6, b: 1.0 },
  { kind: 'bags', x: 22, z: -22, a: 2, b: 3 },
  { kind: 'spools', x: -22, z: -28 },
  { kind: 'drum', x: -44, z: -29 },
  { kind: 'barrier', x: -18, z: -19 },
  { kind: 'barrier', x: -14.7, z: -20.2, rot: 0.5 },
  { kind: 'barrier', x: 28, z: -26, rot: Q },
  { kind: 'barrier', x: -2, z: -29 },
  { kind: 'barrier', x: -60, z: -12, rot: 1.2 },
  { kind: 'barrier', x: -44, z: -16, rot: 0.2 },
  { kind: 'drum', x: -62, z: -20 },
  { kind: 'container', x: 26, z: -14, rot: Q },
  { kind: 'container', x: -8, z: -26, rot: 0.2 },
];

export interface Pickup {
  kind: PickupKind;
  x: number;
  /** the surface it lies on */
  y: number;
  z: number;
}

/** Cake lies where cake would: on the stockpiles, and dropped along the way. */
export const PICKUPS: Pickup[] = [
  { kind: 'cake', x: -12, y: 1.25, z: 11 },
  { kind: 'cake', x: -6, y: 1.15, z: -13 },
  { kind: 'cake', x: -26, y: 0.95, z: -8 },
  { kind: 'cake', x: -44, y: 0.15, z: 25 },
  { kind: 'cake', x: 12, y: 0, z: 23.4 },
  { kind: 'cake', x: 22, y: 0, z: -18.4 },
  { kind: 'cake', x: 30, y: 0, z: 12 },
  { kind: 'cake', x: -66, y: 0, z: -6 },
  { kind: 'rock', x: -18, y: 2.59, z: 27.9 },
  { kind: 'rock', x: -52, y: 0, z: -27.5 },
  { kind: 'rock', x: -58, y: 0, z: 20 },
  { kind: 'rock', x: 4, y: 0, z: 28.4 },
  { kind: 'rock', x: 30.5, y: 0, z: -28 },
  { kind: 'rock', x: -30, y: 0, z: -2 },
  { kind: 'rock', x: 16, y: 0, z: 12 },
];

/** Round the edge of the pad, and a couple in the yards, all facing in. */
export const SPAWNS: Array<[number, number]> = [
  [-67, -30], [-67, 12], [-66, 30], [-48, 31.5], [-28, 31.5], [-7, 32], [10, 32],
  [30, 31], [31.5, 14], [31.5, -13], [30, -31], [4, -32], [-16, -32], [-44, -32],
  [-24, 18], [-2, -22],
];

/** facing the middle from a spawn - the walker's yaw, zero looking north */
export function spawnYaw(x: number, z: number) {
  return Math.atan2(-(CENTRE.x - x), -(CENTRE.z - z));
}
