import * as THREE from 'three';
import './arena.css';
import { Plant } from '../sim/plant';
import { Stage } from '../view/scene';
import { World } from '../view/world';
import { Walker, collisionWorld } from '../view/walk';
import { FEEL } from '../view/feel';
import { gridHash } from '../view/grid';
import type { FX } from '../view/particles';
import { applyScenario, scenarioById } from '../scenario';
import { buildProps, Pickups } from './props';
import { Avatars } from './avatars';
import { Lumps } from './lumps';
import { ViewModel } from './viewmodel';
import { ArenaHud, type Row } from './hud';
import { Sfx } from './sound';
import { socket, local, saveToken, type Conn } from './net';
import { Mine } from './mine/build';
import { Barrows } from './barrows';
import { Minimap, type MapView } from './minimap';
import { MAPS, type MapId } from './shared/maps';
import { LABELS } from './shared/mine';
import {
  WEAPONS, SEND_HZ, RESPAWN_DELAY, PASTE_SLOW, MAX_PLAYERS, INTERP_MS, HP, TEAMS, BARROW,
  hex, throwGravity, type WeaponId, type Team,
} from './shared/rules';
import { F, type ServerMsg, type RoundInfo, type V3, type BarrowInfo } from './shared/protocol';
import { segBody } from './shared/physics';

/**
 * Paste Wars: two places to play after the shift, fifteen at a time in each.
 *
 * The plant is the same plant as the rest of PasteWorks - thickener, press,
 * silos, mixing tower and pumps, all still running - with the yards dressed
 * for cover and a fence round the pad: every one for themselves.
 *
 * The mine is the 760 Level, underground: Day shift against Night shift,
 * one barrow of paste a crew, and the other crew's stope to fill with it.
 *
 * Either way you walk it with the same walker, and a lump flies against the
 * same collision world the server was baked from.
 *
 *   ?arena             the plant
 *   ?arena=mine        the 760 Level
 *   ?arena=bake        build the plant's collision world and hand it to tools/bake.mjs
 *   ?arena=bake-mine   the same, for the mine
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Where the fight is: what the collision world is taken from, and what runs every frame. */
interface Venue {
  root: THREE.Object3D;
  fx: FX;
  update(dt: number): void;
  mine?: Mine;
  debug: Record<string, unknown>;
}

/** The plant runs through the fight, as a plant would: an hour on the clock before anyone arrives, then real time. */
function plantVenue(stage: Stage): Venue {
  const sc = scenarioById('today')!;
  const plant = new Plant();
  plant.hardMode = true;
  plant.sp.running = true;
  for (let i = 0; i < 600; i++) plant.step(6);
  const world = new World(stage, sc, { arena: true });
  stage.scene.add(world.root);
  world.setTagsVisible(false);
  world.root.add(buildProps());
  return {
    root: world.root, fx: world.fx,
    update: (dt) => { plant.step(dt); world.update(plant.telemetry, dt); },
    debug: { plant, world },
  };
}

function mineVenue(stage: Stage, light: boolean): Venue {
  Mine.stage(stage);
  const mine = new Mine({ light });
  stage.scene.add(mine.root);
  return { root: mine.root, fx: mine.fx, update: (dt) => mine.update(dt), mine, debug: { mine } };
}

export function startArena(mode: 'play' | 'bake' = 'play', mapId: MapId = 'plant') {
  const map = MAPS[mapId];
  const teams = map.mode === 'barrow';
  if (!teams) applyScenario(scenarioById('today')!);
  document.documentElement.style.setProperty('--accent', '#ff7a1a');
  document.title = teams ? 'PasteWorks · Paste Wars · 760 Level' : 'PasteWorks · Paste Wars';
  const canvas = document.getElementById('view') as HTMLCanvasElement;

  const stage = new Stage(canvas);
  const venue = teams ? mineVenue(stage, mode === 'play') : plantVenue(stage);
  const mine = venue.mine;

  // The collision world, before anything has moved: the same triangles the
  // server was baked from, so a lump lands on the same girder at both ends.
  const t0 = performance.now();
  const clip = new THREE.Box3(V(...map.clip.min), V(...map.clip.max));
  const grid = collisionWorld(venue.root, clip);
  const hash = gridHash(grid.triangles());
  console.info(`arena: ${map.id}, ${grid.size} triangles in ${(performance.now() - t0).toFixed(0)} ms, ${hash}`);

  if (mode === 'bake') {
    const bytes = new Uint8Array(grid.triangles().slice().buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    (window as unknown as { __bake: unknown }).__bake = { map: map.id, world: map.world, hash, count: grid.size, b64: btoa(s) };
    return;
  }

  // everything from here on moves, and none of it is in the collision world
  const pickups = new Pickups(map.pickups);
  venue.root.add(pickups.group);
  const avatars = new Avatars();
  avatars.lamps = teams;
  stage.scene.add(avatars.group);
  const lumps = new Lumps(grid, venue.fx);
  stage.scene.add(lumps.group);
  const vm = new ViewModel(stage.camera, stage.scene.environment);
  stage.composer.insertPass(vm.pass, 1);
  const hud = new ArenaHud(map);
  const sfx = new Sfx();
  const barrows = teams ? new Barrows(map.bases!) : null;
  if (barrows) stage.scene.add(barrows.group);
  const minimap = teams && mine ? new Minimap(mine.plan, map.bases!, LABELS) : null;
  if (minimap) hud.root.appendChild(minimap.canvas);

  stage.controls.enabled = false;
  stage.controls.autoRotate = false;
  stage.manual = true;
  stage.onFoot(true);
  stage.camera.near = 0.08;
  stage.setFov(75);

  if (teams) {
    // the lamp on your own hat: the one real light underground
    const cap = new THREE.SpotLight(0xfff1dc, 9, 30, 0.62, 0.95, 1.6);
    cap.position.set(0.12, 0.08, 0);
    cap.target.position.set(0, -0.12, -1);
    stage.camera.add(cap, cap.target);
    stage.scene.add(stage.camera);
  }

  const walker = new Walker(stage.camera, canvas, FEEL.earth);
  walker.useWorld(grid);
  walker.bounds = map.bounds;
  const [sx, sz] = map.spawns[0];
  walker.enter(V(sx, 0.05, sz), map.spawnYaw(sx, sz));

  // ------------------------------------------------------------------ state

  let conn: Conn | null = null;
  const me = { id: 0, name: '', col: 0, alive: false, life: 0, team: -1 };
  const roster = new Map<number, { name: string; col: number; tags: number; deaths: number; team: number; pours: number }>();
  let hp = HP;
  let ammo: [number, number] = [0, 0];
  /** throws of ours the server has not accounted for yet */
  let pending: Array<{ s: number; w: WeaponId }> = [];
  let weapon: WeaponId = 0;
  let seq = 0;
  const nextFire = [0, 0];
  let round: RoundInfo = { st: 'warmup', n: 0, ends: 0, c: 0 };
  /** server clock minus ours, ms */
  let offset: number | null = null;
  let slowUntil = 0;
  let killer = 0;
  const deathAt = V();
  let lmb = false;
  let sendAcc = 0;
  let dryNag = 0;
  let bye = '';
  let tabHeld = false;
  let everLocked = false;
  const hits: Array<{ T: number; id: number; p: V3; w: WeaponId }> = [];
  /** the mine: pours this round, whether our barrow is in our hands, and who of theirs was heard when */
  let ts: [number, number] = [0, 0];
  let carrying = false;
  const heard = new Map<number, number>();

  const serverNow = () => performance.now() + (offset ?? 0);
  const shown = (w: WeaponId) => Math.max(0, ammo[w] - pending.filter((p) => p.w === w).length);
  const nameOf = (id: number) => roster.get(id);
  const whoHtml = (id: number) => {
    const r = nameOf(id);
    return r ? ArenaHud.who(r.name, r.col, r.team) : 'someone';
  };
  const crewHtml = (t: number) => `<span style="color:${hex(TEAMS[t].col)};font-weight:700">${TEAMS[t].name}</span>`;

  function refreshAmmo() {
    const a: [number, number] = [shown(0), shown(1)];
    hud.setAmmo(a, weapon);
    vm.set(weapon, a[0]);
  }

  function setWeapon(w: WeaponId) {
    if (w === weapon) return;
    weapon = w;
    refreshAmmo();
  }

  function rows(): Row[] {
    return [...roster.entries()].map(([id, r]) => ({ id, ...r, me: id === me.id }));
  }

  const cond = (r: RoundInfo) => map.conditions[(r.st === 'play' || r.st === 'end' ? r.c : 0) % map.conditions.length];

  function showBoard() {
    if (round.st === 'end') {
      const mvp = round.mvp ? nameOf(round.mvp) : null;
      let foot: string;
      if (teams) {
        const w: number = round.win ?? -1;
        foot = (w >= 0 ? `${crewHtml(w)} takes it, ${round.ts?.[w] ?? 0} - ${round.ts?.[1 - w] ?? 0}.` : 'A draw. Both stopes as empty as each other.')
          + (mvp ? ` Best on shift: ${ArenaHud.who(mvp.name, mvp.col, mvp.team)}.` : '');
      } else {
        foot = mvp ? `${ArenaHud.who(mvp.name, mvp.col)} takes the shift.` : 'Nobody tagged anybody. Very safe. Very dull.';
      }
      hud.board(true, rows(), `Round ${round.n} - knock-off`, foot, round.ts ?? ts);
    } else if (tabHeld) {
      hud.board(true, rows(), round.st === 'play' ? `Round ${round.n} - ${cond(round).label}` : 'Warm-up - scores do not count yet', undefined, ts);
    } else {
      hud.board(false);
    }
  }

  /** what this round is played under: gravity, jump, how a lump drops */
  function applyRound(r: RoundInfo, announce: boolean) {
    const was = round;
    round = r;
    hud.setRound(r);
    const c = cond(r);
    const feel = FEEL[c.feel];
    walker.setFeel(feel);
    lumps.g = throwGravity(feel.gravity);
    if (r.st === 'play' && (was.st !== 'play' || was.n !== r.n)) {
      for (const v of roster.values()) { v.tags = 0; v.deaths = 0; v.pours = 0; }
      lumps.clean();
      ts = [0, 0];
      mine?.setPoured(0, 0);
      mine?.setPoured(1, 0);
      if (announce) {
        sfx.horn();
        hud.toast(`Round ${r.n}: ${c.label}. ${c.note}`);
      }
    }
    if (r.st === 'end') {
      for (const [id, tags, deaths, pours] of r.sc ?? []) {
        const v = roster.get(id);
        if (v) { v.tags = tags; v.deaths = deaths; v.pours = pours ?? 0; }
      }
      if (announce) {
        sfx.horn();
        if (teams && r.ts) {
          const w: number = r.win ?? -1;
          hud.banner(w >= 0 ? `${TEAMS[w].name.toUpperCase()} TAKES IT<small>${r.ts[w]} - ${r.ts[1 - w]}</small>` : `A DRAW<small>${r.ts[0]} - ${r.ts[1]}</small>`,
            w >= 0 ? hex(TEAMS[w].col) : '#e2e9f4', 5000);
        }
      }
    }
    hud.setTags(roster.get(me.id)?.tags ?? 0);
    showBoard();
  }

  // ------------------------------------------------------------ the line

  let retry = 0;
  let backoff = 1500;

  function reset() {
    avatars.clear();
    roster.clear();
    lumps.clean();
    pending = [];
    hits.length = 0;
    me.id = 0;
    offset = null;
    setCarrying(false);
  }

  function connect() {
    clearTimeout(retry);
    if (conn) { const c = conn; conn = null; c.close(); }
    reset();
    hud.status('Clocking on...');
    bye = '';
    const c = socket(map.id);
    conn = c;
    c.onMessage = (m) => { if (conn === c) onMessage(m); };
    c.onClose = (code, opened) => {
      if (conn !== c) return;
      conn = null;
      console.info(`arena: line closed, ${code}${bye ? ' (' + bye + ')' : ''}`);
      if (code === 4001) {
        practise(`${map.name} is full - ${MAX_PLAYERS} on shift. Practising here; trying again every 15 s.`);
        watchForRoom(15000);
      } else if (!opened) {
        practise('No arena server to be found - practising on your own.');
        watchForRoom(60000);
      } else if (bye === 'protocol') {
        // a page from before the server was last updated: nothing to retry until it is reloaded
        reset();
        hud.status('The arena has been updated since this page loaded - reload to clock on.', 'bad');
      } else if (bye === 'idle' || code === 4002) {
        reset();
        hud.status('Stood down for standing still. Click "Clock on" to come back.', 'warn');
        walker.exit();
        walker.active = true;
        walker.paused = true;
        hud.paused(true);
        hud.onResume = () => { hud.onResume = resume; connect(); resume(); };
      } else {
        hud.status('Lost the line - reconnecting...', 'warn');
        retry = window.setTimeout(connect, backoff);
        backoff = Math.min(15000, backoff * 1.6);
      }
    };
  }

  /** A room of our own, in this page, until a real one turns up. */
  function practise(why: string) {
    reset();
    const c = local(grid, hash, map);
    conn = c;
    c.onMessage = (m) => { if (conn === c) onMessage(m); };
    hud.status(why, 'warn');
  }

  /** Ask the server, now and then, whether there is room; go the moment there is. */
  function watchForRoom(every: number) {
    retry = window.setTimeout(async () => {
      try {
        const r = await fetch('/play/status', { cache: 'no-store' });
        if (r.ok) {
          const s = await r.json() as { online: number; max: number; rooms?: Record<string, { online: number; max: number }> };
          const room = s.rooms?.[map.id] ?? s;
          if (room.online < room.max) { connect(); return; }
        }
      } catch { /* still nothing there */ }
      watchForRoom(every);
    }, every);
  }

  // ------------------------------------------------------------ the barrows

  /** where we are, now - the frame loop sends this twenty times a second */
  function sendState() {
    if (!conn || !me.id || !me.alive) return;
    const f = walker.feet;
    const v = walker.velocity;
    const run = Math.hypot(v.x, v.z) > FEEL.earth.walk + 0.5;
    conn.send({
      t: 's', p: [r2(f.x), r2(f.y), r2(f.z)], a: [r3(walker.yawAngle), r3(walker.pitchAngle)], w: weapon,
      f: (walker.grounded ? F.floor : 0) | (run ? F.run : 0) | (walker.paused ? F.away : 0), l: me.life,
    });
  }

  /**
   * E. Where we are goes first: the room judges reach, and drops the barrow,
   * at the last place we told it, which could be a frame or two behind.
   */
  function grab() {
    if (!teams || !conn || !me.alive) return;
    sendState();
    conn.send({ t: 'b' });
  }

  function setCarrying(on: boolean) {
    carrying = on;
    vm.carry(on ? me.team : -1);
    if (on) lmb = false;
  }

  /** The server moved a barrow. Say so, in proportion. */
  function onBarrow(m: Extract<ServerMsg, { t: 'B' }>) {
    const info: BarrowInfo = { st: m.st, by: m.by, p: m.p, until: m.until };
    barrows?.set(m.b, info);
    ts = m.ts;
    // Day's pours go into Night's stope, and the other way round
    mine?.setPoured(1, ts[0]);
    mine?.setPoured(0, ts[1]);
    const ours = m.b === me.team;
    const bar = `${crewHtml(m.b)} barrow`;
    if (m.b === me.team) setCarrying(m.st === 'held' && m.by === me.id);
    switch (m.ev) {
      case 'grab':
        if (m.by === me.id) {
          sfx.grab();
          hud.toast(`Got it - get it into the ${TEAMS[1 - me.team].short} stope`);
        } else hud.feed(`${whoHtml(m.by!)}<em>took the</em>${bar}`, ours);
        if (!ours && me.team >= 0) sfx.alarm();
        break;
      case 'drop':
        hud.feed(`${whoHtml(m.by!)}<em>dropped the</em>${bar}`, ours);
        break;
      case 'tip':
        hud.feed(`${whoHtml(m.by!)}<em>tipped out the</em>${bar}`, !ours);
        if (m.by === me.id) sfx.tagged();
        break;
      case 'reset':
        hud.feed(`<em>The</em>${bar}<em>went back to the fill point</em>`);
        break;
      case 'pour': {
        const stope = (1 - m.b) as Team;
        mine?.pour(stope);
        sfx.pour();
        hud.banner(`${TEAMS[m.b].name.toUpperCase()} POURED<small>${nameOf(m.by!)?.name ?? 'Someone'} filled ${TEAMS[stope].short}'s stope &middot; ${ts[0]} - ${ts[1]}</small>`,
          hex(TEAMS[m.b].col));
        const r = m.by ? roster.get(m.by) : undefined;
        if (r) r.pours++;
        showBoard();
        break;
      }
    }
  }

  /** the word under each crew's score: where its barrow is */
  function whereText(t: Team): string {
    const b = barrows?.get(t);
    if (!b) return '';
    const left = (ms?: number) => Math.max(0, Math.ceil(((ms ?? 0) - serverNow()) / 1000));
    switch (b.st) {
      case 'home': return 'barrow at the fill point';
      case 'held': return b.by === me.id ? 'you have the barrow' : `${nameOf(b.by ?? 0)?.name ?? 'someone'} has it`;
      case 'down': return `barrow dropped - home in ${left(b.until)}`;
      case 'away': return `refilling - ${left(b.until)}`;
    }
  }

  /** the line over the ammo: what the barrow wants of you, if anything */
  function carryHint(): string | null {
    if (!teams || !me.alive || me.team < 0 || round.st === 'end') return null;
    if (carrying) return `<em>Pushing the barrow</em> - over the brow of the ${TEAMS[1 - me.team].short} stope &middot; <kbd>E</kbd> let go`;
    const b = barrows!.get(me.team as Team);
    if (b.st === 'home' || b.st === 'down') {
      const at = barrows!.where(me.team as Team);
      const f = walker.feet;
      if (Math.hypot(f.x - at.x, f.z - at.z) <= BARROW.reach) return '<kbd>E</kbd> take the barrow';
    }
    return null;
  }

  // ------------------------------------------------------------ messages

  function onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'hi': {
        me.id = m.id; me.name = m.name; me.col = m.col; me.team = m.tm;
        backoff = 1500;
        if (!conn?.offline) {
          saveToken(map.id, m.k);
          hud.status(null);
        }
        hud.setMe(m.name, m.col, m.tm);
        offset = m.T - performance.now();
        for (const [id, name, col, tags, deaths, team, pours] of m.players) {
          roster.set(id, { name, col, tags, deaths, team, pours });
          if (id !== me.id) avatars.add(id, name, col, team);
        }
        pickups.setAll(m.picks);
        if (m.bar && barrows) {
          barrows.set(0, m.bar[0]);
          barrows.set(1, m.bar[1]);
        }
        ts = m.ts ?? [0, 0];
        mine?.setPoured(1, ts[0], true);
        mine?.setPoured(0, ts[1], true);
        applyRound(m.round, false);
        hud.setOnline(roster.size);
        if (m.hash !== hash) {
          console.warn(`arena: this page's ${map.id} (${hash}) is not the one the server was baked from (${m.hash}) - run npm run bake`);
        }
        break;
      }
      case 'bye': bye = m.why; break;
      case 'J':
        roster.set(m.id, { name: m.name, col: m.col, tags: 0, deaths: 0, team: m.tm, pours: 0 });
        avatars.add(m.id, m.name, m.col, m.tm);
        hud.setOnline(roster.size);
        hud.feed(`${whoHtml(m.id)}<em>clocked on</em>`);
        showBoard();
        break;
      case 'L':
        hud.feed(`${whoHtml(m.id)}<em>knocked off</em>`);
        roster.delete(m.id);
        avatars.remove(m.id);
        heard.delete(m.id);
        hud.setOnline(roster.size);
        showBoard();
        break;
      case 'T': {
        const r = roster.get(m.id);
        if (r) r.team = m.tm;
        if (m.id === me.id) {
          me.team = m.tm;
          hud.setMe(me.name, me.col, me.team);
          hud.toast(`Moved to ${TEAMS[m.tm].name} to even the crews up`);
        } else if (r) {
          avatars.add(m.id, r.name, r.col, m.tm);
        }
        showBoard();
        break;
      }
      case 'S': {
        const sample = m.T - performance.now();
        offset = offset === null ? sample : Math.max(sample, offset - 0.25);
        avatars.snapshot(m.T, m.P, me.id);
        const mine = m.P.find((p) => p[0] === me.id);
        if (mine && me.alive) {
          hp = mine[6];
          hud.setHp(hp);
        }
        break;
      }
      case 'F':
        lumps.thrown(m.id, m.o, me.id, m.s, m.w, m.p, m.v, m.T);
        if (m.o !== me.id) {
          const d = stage.camera.position.distanceTo(V(...m.p));
          sfx.fire(m.w, Math.max(0, 1 - d / 40) * 0.6);
          if (teams && roster.get(m.o)?.team !== me.team) heard.set(m.o, performance.now());
        }
        break;
      case 'X':
        lumps.ended(m.id, m.p, m.n, m.T, false);
        break;
      case 'H':
        lumps.ended(m.id, m.p, undefined, m.T, true);
        if (m.v === me.id) {
          hp = m.hp;
          hud.setHp(hp);
          if (m.d > 0) {
            hud.hurt(m.d >= 30);
            sfx.hurt();
            if (m.w === 0) slowUntil = performance.now() + PASTE_SLOW.secs * 1000;
          }
        } else {
          hits.push({ T: m.T, id: m.v, p: m.p, w: m.w });
          if (m.a === me.id && m.d > 0) {
            hud.hitmark(!!m.hh, m.hp <= 0);
            sfx.hitMark(!!m.hh);
          }
        }
        break;
      case 'K': {
        const v = roster.get(m.v), a = roster.get(m.a);
        if (v) v.deaths++;
        if (a && m.a !== m.v) a.tags++;
        const verb = WEAPONS[m.w].verb;
        const hh = m.hh ? '<span class="hh">hard hat</span>' : '';
        const mine = m.a === me.id || m.v === me.id;
        hud.feed(m.a === m.v
          ? `${whoHtml(m.v)}<em>fell in</em>`
          : `${whoHtml(m.a)}<em>${verb}</em>${whoHtml(m.v)}${hh}`, mine);
        if (m.v === me.id) goDown(m.a, m.w);
        else if (m.a === me.id) {
          sfx.tagged();
          hud.toast(`You ${verb} ${v?.name ?? 'them'}`);
        }
        hud.setTags(roster.get(me.id)?.tags ?? 0);
        showBoard();
        break;
      }
      case 'R':
        if (m.id === me.id) {
          me.alive = true;
          me.life = m.l;
          hp = HP;
          slowUntil = 0;
          hud.setHp(hp);
          hud.up();
          walker.teleport(V(...m.p), m.y);
          vm.visible = true;
        } else {
          avatars.get(m.id)?.teleport(m.p[0], m.p[1], m.p[2], m.y);
        }
        break;
      case 'A':
        ammo = m.a;
        pending = pending.filter((p) => p.s > m.s);
        refreshAmmo();
        break;
      case 'P':
        pickups.set(m.i, !!m.on);
        break;
      case 'G':
        sfx.pickup();
        hud.toast(m.w === 0 ? `+${m.n} paste - filter cake in the hopper` : `+${m.n} ${m.n === 1 ? 'rock' : 'rocks'}`);
        break;
      case 'Rd':
        applyRound(m.r, true);
        break;
      case 'B':
        onBarrow(m);
        break;
      case 'fix':
        walker.moveTo(V(...m.p));
        break;
    }
  }

  function goDown(by: number, w: WeaponId) {
    me.alive = false;
    killer = by === me.id ? 0 : by;
    deathAt.copy(walker.eye);
    lmb = false;
    vm.visible = false;
    setCarrying(false);
    sfx.down();
    hud.down(killer ? whoHtml(killer) : null, killer ? WEAPONS[w].verb : '', performance.now() + RESPAWN_DELAY * 1000);
  }

  // ------------------------------------------------------------ throwing

  const _o = V(), _d = V(), _m = V();

  function fire(w: WeaponId) {
    if (!conn || !me.id || !me.alive || walker.paused || round.st === 'end') return;
    const now = performance.now();
    if (carrying) {
      if (now > dryNag) {
        hud.toast('Hands full - E to let go of the barrow');
        dryNag = now + 1500;
      }
      return;
    }
    if (now < nextFire[w]) return;
    if (shown(w) <= 0) {
      if (now > dryNag) {
        sfx.empty();
        hud.toast(w === 0 ? 'Hopper empty - walk over filter cake' : 'No rocks - find a rock pile');
        dryNag = now + 900;
      }
      nextFire[w] = now + 250;
      return;
    }
    nextFire[w] = now + WEAPONS[w].cooldown * 1000;
    const cam = stage.camera;
    cam.getWorldDirection(_d);
    _o.copy(cam.position).addScaledVector(_d, 0.3);
    const o: V3 = [r3(_o.x), r3(_o.y), r3(_o.z)];
    const d: V3 = [r3(_d.x), r3(_d.y), r3(_d.z)];
    seq++;
    pending.push({ s: seq, w });
    conn.send({ t: 'f', w, o, d, s: seq });
    const len = Math.hypot(d[0], d[1], d[2]);
    const k = WEAPONS[w].speed / len;
    lumps.mine(seq, w, V(...o), V(d[0] * k, d[1] * k, d[2] * k), vm.muzzle(_m), now / 1000);
    vm.fire(w);
    sfx.fire(w);
    refreshAmmo();
  }

  lumps.onWall = (at, w) => sfx.splat(w, at.distanceTo(stage.camera.position));
  lumps.people = (x0, y0, z0, x1, y1, z1, r) => {
    let best: number | null = null;
    for (const a of avatars.all()) {
      if (!a.alive) continue;
      // your own crew is not a target: the room lets paste go straight past them
      if (teams && a.team === me.team) continue;
      const p = a.position;
      if (Math.abs(p.x - x0) > 6 || Math.abs(p.z - z0) > 6) continue;
      const h = segBody(x0, y0, z0, x1, y1, z1, p.x, p.y, p.z, r);
      if (h && (best === null || h.s < best)) best = h.s;
    }
    return best;
  };

  // ------------------------------------------------------------ input

  function resume() {
    sfx.wake();
    walker.lock();
  }
  hud.onResume = resume;
  hud.onLeave = () => { location.href = location.pathname; };

  walker.onPause = (p) => {
    hud.paused(p);
    if (p) lmb = false;
    if (!p && !everLocked) {
      everLocked = true;
      hud.hint(teams
        ? '<kbd>E</kbd> take your barrow &middot; get it into their stope &middot; <kbd>Click</kbd> paste &middot; <kbd>Right click</kbd> rock'
        : '<kbd>Click</kbd> paste gun &middot; <kbd>Right click</kbd> throw a rock &middot; walk over filter cake for more paste');
      setTimeout(() => hud.hint(null), 9000);
    }
  };

  canvas.addEventListener('mousedown', (e) => {
    sfx.wake();
    if (walker.paused) { resume(); return; }
    if (e.button === 0) { lmb = true; fire(weapon); }
    else if (e.button === 2) { setWeapon(1); fire(1); }
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => {
    if (walker.paused || !e.deltaY) return;
    setWeapon(weapon === 0 ? 1 : 0);
  }, { passive: true });

  addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'Tab': e.preventDefault(); tabHeld = true; showBoard(); break;
      case 'Space': e.preventDefault(); break;
      case 'Digit1': setWeapon(0); break;
      case 'Digit2': setWeapon(1); break;
      case 'KeyQ': setWeapon(weapon === 0 ? 1 : 0); break;
      case 'KeyE':
        if (!walker.paused && !e.repeat) grab();
        break;
      case 'KeyM':
        sfx.muted = !sfx.muted;
        hud.toast(sfx.muted ? 'Sound off' : 'Sound on');
        break;
    }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Tab') { tabHeld = false; showBoard(); }
  });
  addEventListener('blur', () => { lmb = false; tabHeld = false; showBoard(); });

  if (matchMedia('(pointer: coarse)').matches) {
    hud.status('Paste Wars needs a keyboard and a mouse.', 'bad');
  }

  // ------------------------------------------------------------ frame

  const clock = new THREE.Clock();
  const UP = V(0, 1, 0);
  const _look = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _light = new THREE.Color();
  const probe = mine?.probe ?? null;
  const lightAt = probe ? (x: number, z: number, out: THREE.Color) => probe.at(x, z, out) : undefined;

  /** Plastered: rise up out of yourself and look at whoever did it. */
  function deathCam(dt: number) {
    const cam = stage.camera;
    const a = killer ? avatars.get(killer) : undefined;
    const target = a ? a.position.clone().add(V(0, 1.2, 0)) : deathAt.clone().add(V(0, -1.5, 0.01));
    const want = deathAt.clone().add(V(0, teams ? 1.6 : 2.8, 0));
    cam.position.lerp(want, 1 - Math.exp(-dt * 2.5));
    _look.lookAt(cam.position, target, UP);
    _q.setFromRotationMatrix(_look);
    cam.quaternion.slerp(_q, 1 - Math.exp(-dt * 3));
  }

  /** the level plan: who is where, as far as you are allowed to know */
  function mapView(): MapView {
    const now = performance.now();
    const f = walker.feet;
    const mates: MapView['mates'] = [];
    const heardList: MapView['heard'] = [];
    for (const a of avatars.all()) {
      if (!a.alive) continue;
      if (a.team === me.team) mates.push({ x: a.position.x, z: a.position.z });
      else {
        const at = heard.get(a.id);
        if (at !== undefined && now - at < 2500) heardList.push({ x: a.position.x, z: a.position.z, k: 1 - (now - at) / 2500 });
      }
    }
    const bars = ([0, 1] as Team[]).map((t) => {
      const info = barrows!.get(t);
      const held = info.st === 'held' && info.by === me.id;
      const at = held ? f : barrows!.where(t);
      return { x: at.x, z: at.z, st: info.st, mine: t === me.team };
    });
    const target = carrying && me.team >= 0 ? map.bases![1 - me.team].pour : null;
    return {
      me: me.id ? { x: f.x, z: f.z, yaw: walker.yawAngle, team: Math.max(0, me.team), alive: me.alive } : null,
      mates, heard: heardList, barrows: bars,
      target: target ? { x: target[0], z: target[1] } : null,
    };
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const now = performance.now();

    venue.update(dt);

    walker.speedScale = (now < slowUntil ? PASTE_SLOW.scale : 1) * (carrying ? BARROW.speed : 1);
    if (me.alive) walker.update(dt);
    else deathCam(dt);

    const sNow = serverNow();
    avatars.update(sNow, dt);
    if (lightAt) for (const a of avatars.all()) a.light = lightAt(a.position.x, a.position.z, a.light ?? new THREE.Color());
    const drawn = sNow - INTERP_MS;
    for (let i = hits.length - 1; i >= 0; i--) {
      if (hits[i].T > drawn) continue;
      const h = hits[i];
      avatars.get(h.id)?.hit(V(...h.p), h.w === 0);
      hits.splice(i, 1);
    }
    lumps.update(now / 1000, sNow / 1000);
    pickups.update(now / 1000);
    if (barrows) {
      barrows.update(sNow - INTERP_MS, avatars, me.id, lightAt);
      hud.setCrews(ts, [whereText(0), whereText(1)]);
      hud.carry(carryHint());
      minimap?.draw(mapView(), dt);
    }

    const v = walker.velocity;
    if (lightAt) {
      const c = lightAt(stage.camera.position.x, stage.camera.position.z, _light);
      vm.shade(Math.min(1, 0.3 + (c.r + c.g + c.b) / 3 * 0.9));
    }
    vm.update(stage.camera, dt, Math.hypot(v.x, v.z), walker.grounded, walker.yawAngle, walker.pitchAngle);
    if (lmb) fire(weapon);

    sendAcc += dt;
    if (sendAcc >= 1 / SEND_HZ) {
      sendAcc = 0;
      sendState();
    }

    hud.tick(sNow);
    hud.downTick(now);
    stage.render();
  }

  refreshAmmo();
  hud.setHp(hp);
  // The first frame compiles every shader in the place, which can hold the
  // page for seconds. Get it over with before opening the line, so the
  // hello is not stuck behind it.
  frame();
  connect();

  (window as unknown as { PW: unknown }).PW = {
    stage, walker, avatars, lumps, hud, grid, hash, vm, pickups, barrows, minimap, map, THREE, ...venue.debug,
    get conn() { return conn; },
    get me() { return me; },
    get ammo() { return [shown(0), shown(1)]; },
    get round() { return round; },
    get roster() { return roster; },
    get carrying() { return carrying; },
    get ts() { return ts; },
    fire, setWeapon, practise, grab,
  };
}
