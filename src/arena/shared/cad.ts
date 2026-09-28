import type { Pickup } from './map';

/**
 * The filter plant: a real plant, converted from its CAD model by
 * cad/convert.py - thickener, three vacuum disc filters, silos, the mixer and
 * the pumps, in a process building five floors high - fenced in as it stands.
 * Every flight of stairs climbs, every floor is walkable, and nothing is
 * dressed: the plant is cover enough.
 *
 * The model is local only (public/local/plant.glb, and its baked world in
 * server/worlds/cad.*, all kept out of git), so this map is too: a page
 * without the model does not offer it, and a server without its world skips it.
 *
 * Plan coordinates as the converter left them: the plant's footprint centred
 * on the origin, 98 m along x and 49 m along z. The spawns and pickups come
 * from cad/arenaplan.mjs, which floods every floor a walker can reach from
 * the fence and spreads them out: spawns on open ground round the edge,
 * pickups two to a floor up the building and the rest in the yards.
 */

/** the model the map is built from; where it is not, neither is the map */
export const MODEL = './local/plant.glb';

/** the fence, in plan: six metres of open ground round the plant */
export const BOUNDS = { x0: -54, x1: 54, z0: -30, z1: 30 };
/** the middle of the plant, for aiming spawns inward */
export const CENTRE = { x: 0, z: 0 };
/** the fenced plant and a margin round it, from the bottom of the sump to above the filter floor's roof */
export const CLIP = {
  min: [BOUNDS.x0 - 6, -5, BOUNDS.z0 - 6] as const,
  max: [BOUNDS.x1 + 6, 30, BOUNDS.z1 + 6] as const,
};

export const PICKUPS: Pickup[] = [
  // up the building: tank tops, then each floor of the process building
  { kind: 'cake', x: 8.25, y: 7.77, z: -14.75 },
  { kind: 'rock', x: -17.25, y: 6.69, z: -0.25 },
  { kind: 'cake', x: -32.75, y: 9.75, z: -9.75 },
  { kind: 'rock', x: 1.25, y: 9.75, z: 0.75 },
  { kind: 'cake', x: -14.25, y: 14.33, z: -9.75 },
  { kind: 'rock', x: -32.75, y: 14.33, z: 0.75 },
  { kind: 'cake', x: 1.75, y: 18.57, z: -4.25 },
  { kind: 'rock', x: -26.75, y: 18.57, z: -9.75 },
  // the yards and the slabs
  { kind: 'cake', x: 47.75, y: 0, z: 23.75 },
  { kind: 'rock', x: -47.75, y: 0, z: 23.75 },
  { kind: 'cake', x: 33.25, y: 0, z: -23.75 },
  { kind: 'rock', x: 0.25, y: 0, z: 21.25 },
  { kind: 'cake', x: -44.75, y: 0, z: -23.75 },
  { kind: 'rock', x: -5.75, y: 0, z: -23.25 },
  { kind: 'cake', x: -26.75, y: 0, z: 2.25 },
  { kind: 'rock', x: 24.25, y: 0, z: 4.25 },
];

/** On open ground round the fence line, all facing in. */
export const SPAWNS: Array<[number, number]> = [
  [-52.25, -28.25], [52.25, 28.25], [15.25, -28.25], [-18.75, 28.25], [52.25, -12.25], [-52.25, 10.25],
  [16.75, 27.25], [-18.75, -27.25], [37.25, -28.25], [-40.25, 28.25], [51.25, 7.75], [-51.25, -9.25],
  [-1.25, 27.25], [34.75, 27.25], [-1.75, -27.75], [-35.25, -28.25],
];

/** facing the middle from a spawn - the walker's yaw, zero looking north */
export function spawnYaw(x: number, z: number) {
  return Math.atan2(-(CENTRE.x - x), -(CENTRE.z - z));
}
