/**
 * The room: everyone on shift, everything in the air, and the score.
 *
 * This is the whole game, and it knows nothing about sockets. The arena
 * server wraps it in WebSockets; a page that cannot reach the server runs
 * one of its own with a single player in it, so practice plays by exactly
 * the same rules as the real thing.
 *
 * Movement belongs to the players - each page runs its own walker and
 * reports where it got to, and the room only checks that nobody is moving
 * faster than their legs allow. Everything that decides a fight belongs to
 * the room: ammo, every lump in flight, every hit, health, respawns, pickups
 * and the round clock.
 */

import {
  PROTOCOL, MAX_PLAYERS, SNAP_HZ, HP, REGEN_DELAY, REGEN_RATE, RESPAWN_DELAY, SHIELD, HOLD,
  IDLE_KICK, ROUND_S, INTERMISSION_S, MIN_PLAYERS, BODY, WEAPONS, PICKUP, PICK_REACH,
  CONDITIONS, RUN_MAX, ROLES, COLOURS, throwGravity, type WeaponId,
} from './rules';
import { BOUNDS, PICKUPS, SPAWNS, spawnYaw } from './map';
import { F, type RoundInfo, type Roster, type ServerMsg, type V3 } from './protocol';
import { advance, segBody, STEP } from './physics';
import { FEEL } from '../../view/feel';

export interface Link {
  send(m: ServerMsg): void;
  close(code: number, why: string): void;
}

/** what the room needs from the collision world: a TriangleGrid does it */
export interface Tracer {
  segment(ax: number, ay: number, az: number, bx: number, by: number, bz: number):
    { t: number; nx: number; ny: number; nz: number } | null;
}

export interface RoomOptions {
  /** fingerprint of the collision world, passed on to every page */
  hash: string;
  /** milliseconds, never going backwards */
  now: () => number;
  /** a fresh reconnect token */
  token: () => string;
  random?: () => number;
  max?: number;
  log?: (line: string) => void;
}

export interface Player {
  id: number;
  name: string;
  col: number;
  token: string;
  link: Link | null;
  goneAt: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  flags: number;
  w: WeaponId;
  /** bumped at every respawn; reports from an earlier life are ignored */
  life: number;
  reportAt: number;
  /** distance the room will still believe, across and up - refills with time */
  budget: number;
  climb: number;
  activeAt: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  shieldUntil: number;
  hurtAt: number;
  ammo: [number, number];
  nextFire: [number, number];
  lastThrow: number;
  tags: number;
  deaths: number;
  junk: number;
}

interface Lump {
  id: number;
  owner: number;
  w: WeaponId;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** how far this lump has been flown, room seconds */
  t: number;
  dies: number;
}

interface Pick {
  x: number; y: number; z: number;
  kind: 'cake' | 'rock';
  up: boolean;
  back: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, lim = 1e4): V3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => fin(n) && Math.abs(n) < lim) ? (v as V3) : null;

/** the edge a player may report from: the fence, plus a little */
const SLACK = 1;

export class Room {
  readonly players = new Map<number, Player>();
  private lumps: Lump[] = [];
  private picks: Pick[];
  private lumpSeq = 0;
  private round: RoundInfo = { st: 'warmup', n: 0, ends: 0, c: 0 };
  private last: number;
  private snapAt = 0;
  private rnd: () => number;
  readonly max: number;

  constructor(private grid: Tracer, private o: RoomOptions) {
    this.rnd = o.random ?? Math.random;
    this.max = o.max ?? MAX_PLAYERS;
    this.last = o.now() / 1000;
    this.picks = PICKUPS.map((p) => ({ ...p, up: true, back: 0 }));
  }

  private get t() { return this.o.now() / 1000; }
  private ms(t: number) { return Math.round(t * 1000); }

  /** connected right now */
  get online() {
    let n = 0;
    for (const p of this.players.values()) if (p.link) n++;
    return n;
  }

  /** gravity on a thrown lump this round */
  private get g() {
    return throwGravity(FEEL[CONDITIONS[this.round.c].feel].gravity);
  }

  // ------------------------------------------------------------ comings and goings

  /**
   * Someone at the door. A token from the last few seconds gets its old
   * slot back - same name, same hat, same score - so a dropped connection
   * or a refresh costs nothing. Anyone else gets a slot if there is one.
   */
  join(link: Link, hello: unknown): Player | null {
    const h = hello as { t?: unknown; v?: unknown; k?: unknown };
    if (h?.t !== 'hi' || h.v !== PROTOCOL) {
      link.send({ t: 'bye', why: 'protocol' });
      link.close(4000, 'protocol');
      return null;
    }
    const t = this.t;
    let p = typeof h.k === 'string'
      ? [...this.players.values()].find((q) => q.token === h.k && !q.link) ?? null
      : null;

    if (!p) {
      if (this.players.size >= this.max) {
        link.send({ t: 'full', max: this.max });
        link.close(4001, 'full');
        return null;
      }
      p = this.create(t);
    }
    p.link = link;
    p.goneAt = 0;
    p.activeAt = t;
    p.junk = 0;

    link.send({
      t: 'hi', v: PROTOCOL, id: p.id, name: p.name, col: p.col, k: p.token,
      hash: this.o.hash, max: this.max, T: this.ms(t), round: this.round,
      players: this.roster(),
      picks: this.picks.flatMap((q, i) => (q.up ? [i] : [])),
    });
    this.broadcast({ t: 'J', id: p.id, name: p.name, col: p.col }, p);
    this.respawn(p, t);
    this.o.log?.(`join ${p.name} (${this.online}/${this.max})`);
    return p;
  }

  private create(t: number): Player {
    let id = 1;
    while (this.players.has(id)) id++;
    const names = new Set([...this.players.values()].map((q) => q.name));
    let name = '';
    for (let i = 0; i < 50 && (!name || names.has(name)); i++) {
      name = ROLES[Math.floor(this.rnd() * ROLES.length)] + ' ' + (2 + Math.floor(this.rnd() * 97));
    }
    const used = new Set([...this.players.values()].map((q) => q.col));
    let col = 0;
    while (used.has(col) && col < COLOURS.length - 1) col++;
    const p: Player = {
      id, name, col, token: this.o.token(), link: null, goneAt: 0,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, w: 0, life: 0,
      reportAt: t, budget: 0, climb: 0, activeAt: t,
      hp: HP, alive: false, respawnAt: 0, shieldUntil: 0, hurtAt: 0,
      ammo: [WEAPONS[0].start, WEAPONS[1].start], nextFire: [0, 0], lastThrow: 0,
      tags: 0, deaths: 0, junk: 0,
    };
    this.players.set(id, p);
    return p;
  }

  /** The socket went. The slot is held for a while in case they come back. */
  drop(p: Player) {
    if (!p.link) return;
    p.link = null;
    p.goneAt = this.t;
    this.broadcast({ t: 'L', id: p.id });
    this.o.log?.(`leave ${p.name} (${this.online}/${this.max})`);
  }

  private kick(p: Player, why: 'idle' | 'protocol' | 'flood' | 'shutdown') {
    const link = p.link;
    if (!link) return;
    link.send({ t: 'bye', why });
    link.close(why === 'idle' ? 4002 : 4003, why);
    this.drop(p);
    // idling or misbehaving gives the slot up at once
    this.players.delete(p.id);
  }

  /** Everyone out - the server is stopping. */
  close() {
    for (const p of this.players.values()) this.kick(p, 'shutdown');
  }

  // ------------------------------------------------------------ messages

  message(p: Player, raw: unknown) {
    if (!p.link) return;
    const m = raw as Record<string, unknown>;
    switch (m?.t) {
      case 's': return this.report(p, m);
      case 'f': return this.fire(p, m);
      default: return this.junk(p);
    }
  }

  private junk(p: Player) {
    if (++p.junk > 40) this.kick(p, 'protocol');
  }

  /** Where they say they are. Believed, within reason. */
  private report(p: Player, m: Record<string, unknown>) {
    const pos = vec(m.p);
    const a = m.a as unknown[];
    if (!pos || !Array.isArray(a) || !fin(a[0]) || !fin(a[1]) || !fin(m.f) || !fin(m.l)) return this.junk(p);
    const t = this.t;

    const turned = Math.abs(a[0] - p.yaw) + Math.abs(a[1] - p.pitch) > 1e-3;
    p.yaw = a[0] % (Math.PI * 2);
    p.pitch = Math.max(-1.6, Math.min(1.6, a[1]));
    p.w = m.w === 1 ? 1 : 0;
    p.flags = (m.f as number) & (F.floor | F.run | F.away);
    // positions from a previous life, or from the floor after going down, are history
    if (!p.alive || m.l !== p.life) return;

    const [x, y, z] = pos;
    // Down a hole. The walker brings you back, but the room calls it.
    if (y < -20) {
      this.down(p, p, 0, 0, t);
      return;
    }
    const cond = CONDITIONS[this.round.c].feel;
    const dt = Math.max(0, t - p.reportAt);
    p.reportAt = t;
    const run = RUN_MAX[cond] * 1.35;
    // a second's worth of running and a couple of metres in hand, so a burst
    // of reports held up in a queue does not read as a teleport
    p.budget = Math.min(run + 2.5, p.budget + run * dt);
    p.climb = Math.min(9, p.climb + 9 * dt);
    const across = Math.hypot(x - p.x, z - p.z);
    const up = Math.max(0, y - p.y);
    const inside = x > BOUNDS.x0 - SLACK && x < BOUNDS.x1 + SLACK && z > BOUNDS.z0 - SLACK && z < BOUNDS.z1 + SLACK;
    if (across > p.budget || up > p.climb || !inside) {
      p.link!.send({ t: 'fix', p: [r2(p.x), r2(p.y), r2(p.z)] });
      return;
    }
    p.budget -= across;
    p.climb -= up;
    if (across > 0.01 || turned) p.activeAt = t;
    p.x = x; p.y = y; p.z = z;
  }

  /** Threw something. */
  private fire(p: Player, m: Record<string, unknown>) {
    const o = vec(m.o), d = vec(m.d, 2);
    if (!o || !d || !fin(m.s) || (m.w !== 0 && m.w !== 1)) return this.junk(p);
    const w = m.w as WeaponId;
    const W = WEAPONS[w];
    const t = this.t;
    p.lastThrow = Math.max(p.lastThrow, m.s as number);
    p.activeAt = t;

    const len = Math.hypot(d[0], d[1], d[2]);
    const ok = p.alive && this.round.st !== 'end' && p.ammo[w] > 0 && len > 0.5
      // a little early is jitter; the debt carries, so the rate still holds
      && t >= p.nextFire[w] - 0.1;
    if (ok) {
      p.nextFire[w] = Math.max(t, p.nextFire[w]) + W.cooldown;
      p.ammo[w]--;
      p.shieldUntil = 0;
      // from the hand, give or take - never from across the pad
      const ex = p.x, ey = p.y + BODY.eye, ez = p.z;
      const far = Math.hypot(o[0] - ex, o[1] - ey, o[2] - ez) > 2.5;
      const x = far ? ex : o[0], y = far ? ey : o[1], z = far ? ez : o[2];
      const k = W.speed / len;
      const l: Lump = {
        id: ++this.lumpSeq, owner: p.id, w, x, y, z,
        vx: d[0] * k, vy: d[1] * k, vz: d[2] * k, t, dies: t + W.ttl,
      };
      this.lumps.push(l);
      this.broadcast({
        t: 'F', id: l.id, o: p.id, w, p: [r3(x), r3(y), r3(z)],
        v: [r3(l.vx), r3(l.vy), r3(l.vz)], T: this.ms(t), s: m.s as number,
      });
      // what the page will fly is what was sent, rounding and all
      l.x = r3(x); l.y = r3(y); l.z = r3(z);
      l.vx = r3(l.vx); l.vy = r3(l.vy); l.vz = r3(l.vz);
    }
    p.link!.send({ t: 'A', a: [p.ammo[0], p.ammo[1]], s: p.lastThrow });
  }

  // ------------------------------------------------------------ the clock

  tick() {
    const t = this.t;
    const dt = Math.min(0.25, Math.max(0, t - this.last));
    this.last = t;
    this.rounds(t);

    for (const p of [...this.players.values()]) {
      if (!p.link) {
        if (t - p.goneAt > HOLD) this.players.delete(p.id);
        continue;
      }
      if (t - p.activeAt > IDLE_KICK) { this.kick(p, 'idle'); continue; }
      if (!p.alive) {
        if (t >= p.respawnAt) this.respawn(p, t);
      } else if (t - p.hurtAt > REGEN_DELAY && p.hp < HP) {
        p.hp = Math.min(HP, p.hp + REGEN_RATE * dt);
      }
    }

    this.fly(t);
    this.pickups(t);

    if (t >= this.snapAt) {
      this.snapAt = Math.max(this.snapAt + 1 / SNAP_HZ, t - 0.02);
      this.snapshot(t);
    }
  }

  private snapshot(t: number) {
    const P: Array<[number, number, number, number, number, number, number, number, WeaponId]> = [];
    for (const p of this.players.values()) {
      if (!p.link) continue;
      const f = p.flags | (p.alive ? F.alive : 0) | (t < p.shieldUntil ? F.shield : 0);
      P.push([p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), Math.ceil(p.hp), f, p.w]);
    }
    this.broadcast({ t: 'S', T: this.ms(t), P });
  }

  // ------------------------------------------------------------ in the air

  private fly(t: number) {
    const g = this.g;
    const keep: Lump[] = [];
    for (const l of this.lumps) {
      if (this.flyOne(l, t, g)) keep.push(l);
    }
    this.lumps = keep;
  }

  /** Fly one lump up to now. False once it has landed somewhere. */
  private flyOne(l: Lump, t: number, g: number): boolean {
    const W = WEAPONS[l.w];
    while (l.t < t) {
      const h = Math.min(STEP, t - l.t);
      const x0 = l.x, y0 = l.y, z0 = l.z;
      advance(l, h, g);
      l.t += h;

      // the first thing along this bit of the arc: the plant, or a person
      const wall = this.grid.segment(x0, y0, z0, l.x, l.y, l.z);
      let best = wall ? wall.t : 2;
      let who: Player | null = null;
      let up = 0;
      for (const p of this.players.values()) {
        if (!p.link || !p.alive || p.id === l.owner) continue;
        if (Math.abs(p.x - x0) > 6 || Math.abs(p.z - z0) > 6) continue;
        const hit = segBody(x0, y0, z0, l.x, l.y, l.z, p.x, p.y, p.z, W.radius);
        if (hit && hit.s < best) { best = hit.s; who = p; up = hit.up; }
      }
      const at: V3 = [
        r2(x0 + (l.x - x0) * Math.min(1, best)),
        r2(y0 + (l.y - y0) * Math.min(1, best)),
        r2(z0 + (l.z - z0) * Math.min(1, best)),
      ];
      if (who) {
        this.hit(l, who, up >= BODY.head, at, l.t);
        return false;
      }
      if (wall) {
        this.broadcast({ t: 'X', id: l.id, p: at, n: [r3(wall.nx), r3(wall.ny), r3(wall.nz)], T: this.ms(l.t) });
        return false;
      }
      const lost = l.x < BOUNDS.x0 - 40 || l.x > BOUNDS.x1 + 40 || l.z < BOUNDS.z0 - 40 || l.z > BOUNDS.z1 + 40 || l.y < -8;
      if (lost || l.t >= l.dies) {
        this.broadcast({ t: 'X', id: l.id, p: [r2(l.x), r2(l.y), r2(l.z)], T: this.ms(l.t) });
        return false;
      }
    }
    return true;
  }

  private hit(l: Lump, v: Player, head: boolean, at: V3, t: number) {
    const W = WEAPONS[l.w];
    const counts = this.round.st !== 'end' && t >= v.shieldUntil;
    const d = counts ? Math.round(W.damage * (head ? W.head : 1)) : 0;
    v.hp = Math.max(0, v.hp - d);
    if (d > 0) v.hurtAt = t;
    this.broadcast({
      t: 'H', id: l.id, v: v.id, a: l.owner, w: l.w, d, hp: Math.ceil(v.hp), hh: head ? 1 : 0, p: at, T: this.ms(t),
    });
    if (v.hp <= 0) {
      const by = this.players.get(l.owner);
      this.down(v, by ?? v, l.w, head ? 1 : 0, t);
    }
  }

  /** Plastered. By someone else, or by a hole in the ground. */
  private down(v: Player, by: Player, w: WeaponId, hh: 0 | 1, t: number) {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.respawnAt = t + RESPAWN_DELAY;
    if (by !== v) by.tags++;
    this.broadcast({ t: 'K', v: v.id, a: by.id, w, hh, T: this.ms(t) });
  }

  private respawn(p: Player, t: number) {
    const [x, z] = this.spawnFor(p);
    p.x = x; p.y = 0.05; p.z = z;
    p.alive = true;
    p.hp = HP;
    p.life++;
    p.shieldUntil = t + SHIELD;
    p.hurtAt = 0;
    p.reportAt = t;
    p.budget = 0;
    p.climb = 0;
    p.ammo = [WEAPONS[0].start, WEAPONS[1].start];
    p.nextFire = [0, 0];
    this.broadcast({ t: 'R', id: p.id, p: [x, 0.05, z], y: r3(spawnYaw(x, z)), l: p.life });
    p.link?.send({ t: 'A', a: [p.ammo[0], p.ammo[1]], s: p.lastThrow });
  }

  /** The spawn furthest from anyone who could be waiting at it, give or take. */
  private spawnFor(p: Player): [number, number] {
    let best = SPAWNS[0], score = -Infinity;
    for (const s of SPAWNS) {
      let near = 60;
      for (const q of this.players.values()) {
        if (q === p || !q.link || !q.alive) continue;
        near = Math.min(near, Math.hypot(q.x - s[0], q.z - s[1]));
      }
      const v = near + this.rnd() * 8;
      if (v > score) { score = v; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------ pickups

  private pickups(t: number) {
    this.picks.forEach((k, i) => {
      if (!k.up) {
        if (t >= k.back) {
          k.up = true;
          this.broadcast({ t: 'P', i, on: 1 });
        }
        return;
      }
      const def = PICKUP[k.kind];
      const cap = WEAPONS[def.weapon].cap;
      for (const p of this.players.values()) {
        if (!p.link || !p.alive || p.ammo[def.weapon] >= cap) continue;
        if (Math.hypot(p.x - k.x, p.z - k.z) > PICK_REACH.across) continue;
        if (Math.abs(p.y - k.y) > PICK_REACH.up) continue;
        const n = Math.min(def.amount, cap - p.ammo[def.weapon]);
        p.ammo[def.weapon] += n;
        k.up = false;
        k.back = t + def.respawn;
        this.broadcast({ t: 'P', i, on: 0, by: p.id });
        p.link.send({ t: 'G', i, w: def.weapon, n });
        p.link.send({ t: 'A', a: [p.ammo[0], p.ammo[1]], s: p.lastThrow });
        break;
      }
    });
  }

  // ------------------------------------------------------------ rounds

  private rounds(t: number) {
    const r = this.round;
    const enough = this.online >= MIN_PLAYERS;
    if (r.st === 'warmup' && enough) this.startRound(t);
    else if (r.st === 'play' && !enough) this.setRound({ st: 'warmup', n: r.n, ends: 0, c: 0 });
    else if (r.st === 'play' && t * 1000 >= r.ends) this.endRound(t);
    else if (r.st === 'end' && t * 1000 >= r.ends) {
      if (enough) this.startRound(t);
      else this.setRound({ st: 'warmup', n: r.n, ends: 0, c: 0 });
    }
  }

  private startRound(t: number) {
    const n = this.round.n + 1;
    this.lumps = [];
    this.picks.forEach((k) => { k.up = true; k.back = 0; });
    for (const p of this.players.values()) { p.tags = 0; p.deaths = 0; }
    this.setRound({ st: 'play', n, ends: this.ms(t + ROUND_S), c: (n - 1) % CONDITIONS.length });
    this.picks.forEach((_, i) => this.broadcast({ t: 'P', i, on: 1 }));
    for (const p of this.players.values()) if (p.link) this.respawn(p, t);
  }

  private endRound(t: number) {
    const sc = this.roster().map(([id, , , tags, deaths]) => [id, tags, deaths] as [number, number, number]);
    const ranked = [...sc].sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    this.setRound({
      st: 'end', n: this.round.n, ends: this.ms(t + INTERMISSION_S), c: this.round.c,
      sc, mvp: ranked[0]?.[1] ? ranked[0][0] : undefined,
    });
  }

  private setRound(r: RoundInfo) {
    this.round = r;
    this.broadcast({ t: 'Rd', r });
  }

  private roster(): Roster[] {
    return [...this.players.values()]
      .filter((p) => p.link)
      .map((p) => [p.id, p.name, p.col, p.tags, p.deaths]);
  }

  // ------------------------------------------------------------ out

  private broadcast(m: ServerMsg, except?: Player) {
    for (const p of this.players.values()) {
      if (p.link && p !== except) p.link.send(m);
    }
  }
}
