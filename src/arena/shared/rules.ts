/**
 * Paste Wars: the numbers both ends agree on.
 *
 * Everything in src/arena/shared runs in the page and on the arena server
 * alike, so nothing here may touch the DOM or three's renderer - only data,
 * maths, and the room itself.
 */

/** Bumped whenever a message changes shape. The server turns away any other. */
export const PROTOCOL = 2;

export const MAX_PLAYERS = 15;

/** the server's clock, and how often it tells everyone where everyone is */
export const TICK_HZ = 30;
export const SNAP_HZ = 20;
/** how often a page reports where its player is */
export const SEND_HZ = 20;
/** remote players are drawn this far in the past, so there is always a pair to blend between */
export const INTERP_MS = 110;

export const HP = 100;
/** no damage for this long, and you start to come right */
export const REGEN_DELAY = 5;
export const REGEN_RATE = 15;
export const RESPAWN_DELAY = 4;
/** fresh off the bus: nothing sticks for this long, or until you throw something */
export const SHIELD = 2;
/** a gap in the reports this long, with the slot held, before it is given away */
export const HOLD = 20;
/** stood still, not throwing, not turning */
export const IDLE_KICK = 180;

/** the plant's round; the mine sets its own in its map */
export const ROUND_S = 300;
export const INTERMISSION_S = 12;
/** a round needs someone to lose to */
export const MIN_PLAYERS = 2;

/** the capsule everyone is, for hits - the same one the walker uses */
export const BODY = { r: 0.35, h: 1.8, eye: 1.62, head: 1.45 };

export type WeaponId = 0 | 1;

export interface Weapon {
  id: WeaponId;
  name: string;
  short: string;
  /** "Fitter 14 pasted Rigger 3" */
  verb: string;
  /** m/s out of the hand */
  speed: number;
  /** how much of the world's pull it feels: paste has a little lift in it */
  drop: number;
  /** size of the lump, for hitting people - the world sees a point */
  radius: number;
  damage: number;
  /** multiplier on the hard hat */
  head: number;
  /** seconds between throws */
  cooldown: number;
  /** most you can carry, and what you start a life with */
  cap: number;
  start: number;
  /** seconds before a lump that has hit nothing is given up on */
  ttl: number;
}

export const WEAPONS: [Weapon, Weapon] = [
  {
    id: 0, name: 'Paste gun', short: 'PASTE', verb: 'pasted',
    speed: 38, drop: 0.7, radius: 0.14, damage: 16, head: 1.5,
    cooldown: 0.16, cap: 60, start: 30, ttl: 3,
  },
  {
    id: 1, name: 'Rocks', short: 'ROCKS', verb: 'rocked',
    speed: 25, drop: 1, radius: 0.17, damage: 45, head: 1.5,
    cooldown: 0.65, cap: 8, start: 3, ttl: 4,
  },
];

/** A hit of paste gums your boots up for a moment. */
export const PASTE_SLOW = { scale: 0.68, secs: 1.1 };

export type PickupKind = 'cake' | 'rock';

/**
 * Filter cake off the floor is what the paste gun mixes into paste; rock is
 * rock. Both come back a while after someone takes them.
 */
export const PICKUP: Record<PickupKind, { weapon: WeaponId; amount: number; respawn: number }> = {
  cake: { weapon: 0, amount: 20, respawn: 15 },
  rock: { weapon: 1, amount: 3, respawn: 12 },
};
/** how close your feet need to get, across and up */
export const PICK_REACH = { across: 1.35, up: 1.3 };

/**
 * What a round is played under. The place stays where it is; the pull
 * changes. `feel` is a key into the walker's FEEL, so gravity, jump and
 * speed all come from the same place the rest of the app walks with. Each
 * map has its own list, and works through it a round at a time.
 */
export type ConditionKey = 'earth' | 'space';
export interface Condition { feel: ConditionKey; label: string; note: string }

/**
 * The world's pull on a thrown lump. The walker's gravity is made up for the
 * feel of a jump (20 on Earth, not 9.81), so this scales from that rather
 * than using it directly.
 */
export function throwGravity(walkerGravity: number) {
  return 9.81 * (walkerGravity / 20);
}

/** fastest anyone should be moving across the pad under each condition, m/s */
export const RUN_MAX: Record<ConditionKey, number> = { earth: 8, space: 5.5 };

/**
 * The mine is a team game: Day shift against Night shift, one barrow of
 * paste each, and the other crew's stope to fill with it.
 */
export const TEAMS = [
  { name: 'Day shift', short: 'DAY', col: 0xffa928, vest: 0xff8c1a },
  { name: 'Night shift', short: 'NIGHT', col: 0x46b8ff, vest: 0x2f8fe0 },
] as const;
export type Team = 0 | 1;

export const BARROW = {
  /** how close your feet have to be to take hold of your own crew's barrow */
  reach: 2.0,
  /** an enemy this close to a barrow lying on the floor tips it out, and it goes home */
  tip: 1.5,
  /** left lying this long, it goes home on its own */
  reset: 25,
  /** after a pour: this long under the fill point before it is full again */
  refill: 6,
  /** pours to take a round */
  win: 3,
  /** how much of your pace you keep while pushing one */
  speed: 0.8,
  /** how close to the brow of their stope you have to get it */
  pour: 3.2,
};

/** Everyone gets a job title. Nobody gets to type one. */
export const ROLES = [
  'Fitter', 'Sparky', 'Boilermaker', 'Rigger', 'Dogman', 'Shift Boss', 'Metallurgist',
  'Geo', 'Surveyor', 'Operator', 'Pump Tech', 'Scaffolder', 'Nipper', 'Bogger Op',
  'Jumbo Op', 'Crib Cook', 'Trainee', 'Chemist', 'Sampler', 'Controller', 'Plumber',
  'Welder', 'Hygienist', 'Planner',
];

/** hard-hat colours, one each */
export const COLOURS = [
  0xff5a3c, 0xffab3d, 0xffe14a, 0x9fe870, 0x35e0d0, 0x3fa9f5, 0x8f7cff, 0xd35cff,
  0xff6fae, 0xf2f5f8, 0xc08f52, 0x4be38a, 0xff8f5c, 0x8fd3ff, 0x6f7f95,
];

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
