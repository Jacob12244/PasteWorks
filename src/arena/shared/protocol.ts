/**
 * Every message on the wire, both ways. JSON, one object per frame, with
 * short keys - a full room of fifteen is about 60 kB/s down per player.
 *
 * Positions are feet, not eyes, in metres, rounded to the centimetre.
 * Server times (T) are milliseconds on the server's own clock.
 */

import type { WeaponId } from './rules';

export type V3 = [number, number, number];

// ------------------------------------------------------------ page -> server

export type ClientMsg =
  /** first thing said; k is the token from an earlier visit, to get the same slot back */
  | { t: 'hi'; v: number; k?: string }
  /** where I am: feet, [yaw, pitch], weapon in hand, flag bits, which life this is */
  | { t: 's'; p: V3; a: [number, number]; w: WeaponId; f: number; l: number }
  /** threw one: from, direction, my own count of throws */
  | { t: 'f'; w: WeaponId; o: V3; d: V3; s: number };

/** flag bits in a state report and a snapshot */
export const F = {
  floor: 1,
  run: 2,
  /** alt-tabbed, or the mouse is loose */
  away: 4,
  // snapshot only
  alive: 8,
  shield: 16,
} as const;

// ------------------------------------------------------------ server -> page

export interface RoundInfo {
  /** warmup: fewer than two on shift. play: scores count. end: the scoreboard */
  st: 'warmup' | 'play' | 'end';
  n: number;
  /** when this state ends, server ms; 0 for never */
  ends: number;
  /** index into CONDITIONS */
  c: number;
  /** [id, tags, plastered] for everyone, at a round's end */
  sc?: Array<[number, number, number]>;
  /** who won it */
  mvp?: number;
}

/** [id, name, colour index, tags, plastered] */
export type Roster = [number, string, number, number, number];

export type ServerMsg =
  | {
      t: 'hi'; v: number; id: number; name: string; col: number; k: string;
      /** the collision world this server was baked with */
      hash: string; max: number; T: number;
      round: RoundInfo;
      players: Roster[];
      /** which pickups are lying there right now, by index */
      picks: number[];
    }
  | { t: 'full'; max: number }
  /** said just before the socket is closed on you */
  | { t: 'bye'; why: 'idle' | 'protocol' | 'flood' | 'replaced' | 'shutdown' }
  | { t: 'J'; id: number; name: string; col: number }
  | { t: 'L'; id: number }
  /** snapshot: [id, x, y, z, yaw, pitch, hp, flags, weapon] each */
  | { t: 'S'; T: number; P: Array<[number, number, number, number, number, number, number, number, WeaponId]> }
  /** a throw: lump id, thrower, weapon, from, velocity, when; s is the thrower's own count */
  | { t: 'F'; id: number; o: number; w: WeaponId; p: V3; v: V3; T: number; s: number }
  /** a lump hit the plant (n given) or ran out of air (no n) */
  | { t: 'X'; id: number; p: V3; n?: V3; T: number }
  /** a lump hit someone: victim, attacker, damage, what they have left, hard hat */
  | { t: 'H'; id: number; v: number; a: number; w: WeaponId; d: number; hp: number; hh: 0 | 1; p: V3; T: number }
  /** someone went down */
  | { t: 'K'; v: number; a: number; w: WeaponId; hh: 0 | 1; T: number }
  /** back on shift: where, facing, which life */
  | { t: 'R'; id: number; p: V3; y: number; l: number }
  /** your ammo, and the last throw of yours this accounts for */
  | { t: 'A'; a: [number, number]; s: number }
  /** a pickup went (on 0, by whom) or came back (on 1) */
  | { t: 'P'; i: number; on: 0 | 1; by?: number }
  /** you picked something up */
  | { t: 'G'; i: number; w: WeaponId; n: number }
  | { t: 'Rd'; r: RoundInfo }
  /** that is not where you are - go back here */
  | { t: 'fix'; p: V3 };
