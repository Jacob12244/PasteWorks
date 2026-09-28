import { ROUND_S, POWER_CUTS, type Condition, type PowerCuts } from './rules';
import * as plant from './map';
import * as mine from './mine';
import * as cad from './cad';
import type { Pickup } from './map';
import type { Base } from './mine';

/**
 * The places Paste Wars is played, and what each one is.
 *
 *   plant   everyone for themselves on the backfill plant, as it has always been
 *   mine    Day shift against Night shift on the 760 Level: one barrow of
 *           paste a crew, and the other crew's stope to fill with it
 *   cad     everyone for themselves in a real plant, converted from its CAD
 *           model - only where that model is, which for now is one laptop
 *
 * Each runs as a room of its own on the server, fifteen slots each, and a
 * page asks for one by name when it opens its socket.
 */

export type MapId = 'plant' | 'mine' | 'cad';
export const MAP_IDS: MapId[] = ['plant', 'mine', 'cad'];

export interface MapDef {
  id: MapId;
  /** as the title screen and the HUD say it */
  name: string;
  mode: 'ffa' | 'barrow';
  /** the fence in plan - a walker cannot cross it, a report from past it is refused */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** the collision world the page keeps, and the server was baked from */
  clip: { min: readonly [number, number, number]; max: readonly [number, number, number] };
  pickups: Pickup[];
  /** anyone's, on the plant; the mine spawns each crew at its own end */
  spawns: Array<[number, number]>;
  spawnYaw(x: number, z: number): number;
  /** played through a round at a time */
  conditions: readonly Condition[];
  round: number;
  /** a person below this has fallen in; a lump below it is given up on */
  fall: number;
  /** the barrow game's two ends: Day, then Night */
  bases?: [Base, Base];
  /** somewhere with lights to lose */
  power?: PowerCuts;
  /** server/worlds/<world>.bin.gz */
  world: string;
  /**
   * Built from a model that is not in the repository: a page without the
   * model does not offer it, and a server without its baked world skips it.
   */
  local?: boolean;
  /**
   * The walker, where the game's own does not fit: a plant drawn in CAD has
   * real walkways and real headroom, so you are a person's width and duck.
   */
  walker?: { radius: number; duck: boolean };
}

export const MAPS: Record<MapId, MapDef> = {
  plant: {
    id: 'plant',
    name: 'The plant',
    mode: 'ffa',
    bounds: plant.BOUNDS,
    clip: plant.CLIP,
    pickups: plant.PICKUPS,
    spawns: plant.SPAWNS,
    spawnYaw: plant.spawnYaw,
    conditions: [
      { feel: 'earth', label: 'Surface', note: 'Earth gravity. Keep your head down.' },
      { feel: 'space', label: 'Psyche gravity', note: 'Mag boots on. Everything you throw flies flat.' },
    ],
    round: ROUND_S,
    fall: -20,
    world: 'arena',
  },
  mine: {
    id: 'mine',
    name: '760 Level',
    mode: 'barrow',
    bounds: mine.BOUNDS,
    clip: mine.CLIP,
    pickups: mine.PICKUPS,
    spawns: [...mine.BASES[0].spawns, ...mine.BASES[1].spawns],
    spawnYaw: mine.spawnYaw,
    conditions: [
      { feel: 'earth', label: 'Day v Night', note: 'Get your barrow of paste into their stope. No throwing with your hands full.' },
    ],
    round: 420,
    fall: -20,
    bases: mine.BASES,
    power: POWER_CUTS,
    world: 'mine',
  },
  cad: {
    id: 'cad',
    name: 'Filter plant',
    mode: 'ffa',
    bounds: cad.BOUNDS,
    clip: cad.CLIP,
    pickups: cad.PICKUPS,
    spawns: cad.SPAWNS,
    spawnYaw: cad.spawnYaw,
    conditions: [
      { feel: 'earth', label: 'Surface', note: 'Five floors of it. The high ground is up the stairs.' },
      { feel: 'space', label: 'Psyche gravity', note: 'Mag boots on. A jump will take you a floor up - mind your head.' },
    ],
    round: ROUND_S,
    fall: -20,
    world: 'cad',
    local: true,
    walker: { radius: 0.25, duck: true },
  },
};

export function mapById(id: string | null | undefined): MapDef {
  return MAPS[id as MapId] ?? MAPS.plant;
}
