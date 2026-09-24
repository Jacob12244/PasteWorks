/**
 * Every message on the wire, both ways. JSON, one object per frame, with
 * short keys - a full room of fifteen is about 60 kB/s down per player.
 *
 * Positions are feet, not eyes, in metres, rounded to the centimetre.
 * Server times (T) are milliseconds on the server's own clock.
 */

import type { WeaponId, Team } from './rules';
import type { MapId } from './maps';

export type V3 = [number, number, number];

// ------------------------------------------------------------ page -> server

export type ClientMsg =
  /** first thing said; k is the token from an earlier visit, to get the same slot back */
  | { t: 'hi'; v: number; k?: string }
  /** where I am: feet, [yaw, pitch], weapon in hand, flag bits, which life this is */
  | { t: 's'; p: V3; a: [number, number]; w: WeaponId; f: number; l: number }
  /** threw one: from, direction, my own count of throws */
  | { t: 'f'; w: WeaponId; o: V3; d: V3; s: number }
  /** take hold of my crew's barrow, or let go of it */
  | { t: 'b' };

/** flag bits in a state report and a snapshot */
export const F = {
  floor: 1,
  run: 2,
  /** alt-tabbed, or the mouse is loose */
  away: 4,
  // snapshot only
  alive: 8,
  shield: 16,
  /** pushing a barrow */
  carry: 32,
} as const;

// ------------------------------------------------------------ server -> page

export interface RoundInfo {
  /** warmup: fewer than two on shift. play: scores count. end: the scoreboard */
  st: 'warmup' | 'play' | 'end';
  n: number;
  /** when this state ends, server ms; 0 for never */
  ends: number;
  /** index into the map's conditions */
  c: number;
  /** [id, tags, plastered, pours] for everyone, at a round's end */
  sc?: Array<[number, number, number, number]>;
  /** who won it */
  mvp?: number;
  /** the barrow game, at a round's end: pours by Day and Night, and which crew took it (-1 a draw) */
  ts?: [number, number];
  win?: -1 | 0 | 1;
}

/** [id, name, colour index, tags, plastered, team (-1 on the plant), pours] */
export type Roster = [number, string, number, number, number, number, number];

/**
 * Where a crew's barrow is. home: full, under its fill point. held: someone
 * on the crew is pushing it. down: dropped, lying where it fell. away:
 * poured, being filled again under the fill point.
 */
export type BarrowState = 'home' | 'held' | 'down' | 'away';
export interface BarrowInfo {
  st: BarrowState;
  /** who is pushing it */
  by?: number;
  /** where it lies, when down */
  p?: V3;
  /** down: when it goes home by itself. away: when it is full again. Server ms */
  until?: number;
}

export type ServerMsg =
  | {
      t: 'hi'; v: number; id: number; name: string; col: number; k: string;
      /** the collision world this server was baked with */
      hash: string; max: number; T: number;
      /** which room this is, and which crew you are on (-1 on the plant) */
      map: MapId; tm: number;
      round: RoundInfo;
      players: Roster[];
      /** which pickups are lying there right now, by index */
      picks: number[];
      /** the barrow game: both barrows, and the pours so far this round */
      bar?: [BarrowInfo, BarrowInfo];
      ts?: [number, number];
    }
  | { t: 'full'; max: number }
  /** said just before the socket is closed on you */
  | { t: 'bye'; why: 'idle' | 'protocol' | 'flood' | 'replaced' | 'shutdown' }
  | { t: 'J'; id: number; name: string; col: number; tm: number }
  /** moved to the other crew, to even them up between rounds */
  | { t: 'T'; id: number; tm: Team }
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
  /**
   * A barrow changed hands or places, and why: grabbed, dropped (let go of,
   * or its pusher went down), tipped out by the other crew, poured into
   * their stope, gone home after lying too long, or full again.
   */
  | {
      t: 'B'; b: Team; ev: 'grab' | 'drop' | 'tip' | 'pour' | 'reset' | 'full' | 'round';
      by?: number; ts: [number, number]; T: number;
    } & BarrowInfo
  /** that is not where you are - go back here */
  | { t: 'fix'; p: V3 };
