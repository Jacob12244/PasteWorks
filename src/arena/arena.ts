import * as THREE from 'three';
import './arena.css';
import { Plant } from '../sim/plant';
import { Stage } from '../view/scene';
import { World } from '../view/world';
import { Walker, collisionWorld } from '../view/walk';
import { FEEL } from '../view/feel';
import { gridHash } from '../view/grid';
import { applyScenario, scenarioById } from '../scenario';
import { buildProps, Pickups } from './props';
import { Avatars } from './avatars';
import { Lumps } from './lumps';
import { ViewModel } from './viewmodel';
import { ArenaHud, type Row } from './hud';
import { Sfx } from './sound';
import { socket, local, saveToken, type Conn } from './net';
import { BOUNDS, CLIP, SPAWNS, spawnYaw } from './shared/map';
import {
  WEAPONS, CONDITIONS, SEND_HZ, RESPAWN_DELAY, PASTE_SLOW, MAX_PLAYERS, INTERP_MS, HP,
  throwGravity, type WeaponId,
} from './shared/rules';
import { F, type ServerMsg, type RoundInfo, type V3 } from './shared/protocol';
import { segBody } from './shared/physics';

/**
 * Paste Wars: the backfill plant after the shift, fifteen at a time.
 *
 * The same plant as the rest of PasteWorks - thickener, press, silos,
 * mixing tower and pumps, all still running - with the yards dressed for
 * cover and a fence round the pad. You walk it with the same walker, and a
 * lump flies against the same collision world the server was baked from.
 *
 *   ?arena          play
 *   ?arena=bake     build the collision world and hand it to tools/bake.mjs
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function startArena(mode: 'play' | 'bake' = 'play') {
  const sc = scenarioById('today')!;
  applyScenario(sc);
  document.documentElement.style.setProperty('--accent', '#ff7a1a');
  document.title = 'PasteWorks · Paste Wars';
  const canvas = document.getElementById('view') as HTMLCanvasElement;

  // The plant runs through the fight, as a plant would: an hour on the
  // clock before anyone arrives, so the rakes are turning and the lines are
  // full, then real time.
  const plant = new Plant();
  plant.hardMode = true;
  plant.sp.running = true;
  for (let i = 0; i < 600; i++) plant.step(6);

  const stage = new Stage(canvas);
  const world = new World(stage, sc, { arena: true });
  stage.scene.add(world.root);
  world.setTagsVisible(false);
  world.root.add(buildProps());

  // The collision world, before anything has moved: the same triangles the
  // server was baked from, so a lump lands on the same girder at both ends.
  const t0 = performance.now();
  const clip = new THREE.Box3(V(...CLIP.min), V(...CLIP.max));
  const grid = collisionWorld(world.root, clip);
  const hash = gridHash(grid.triangles());
  console.info(`arena: ${grid.size} triangles in ${(performance.now() - t0).toFixed(0)} ms, ${hash}`);

  if (mode === 'bake') {
    const bytes = new Uint8Array(grid.triangles().slice().buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    (window as unknown as { __bake: unknown }).__bake = { hash, count: grid.size, b64: btoa(s) };
    return;
  }

  // everything from here on moves, and none of it is in the collision world
  const pickups = new Pickups();
  world.root.add(pickups.group);
  const avatars = new Avatars();
  stage.scene.add(avatars.group);
  const lumps = new Lumps(grid, world.fx);
  stage.scene.add(lumps.group);
  const vm = new ViewModel(stage.camera, stage.scene.environment);
  stage.composer.insertPass(vm.pass, 1);
  const hud = new ArenaHud();
  const sfx = new Sfx();

  stage.controls.enabled = false;
  stage.controls.autoRotate = false;
  stage.manual = true;
  stage.camera.near = 0.08;
  stage.setFov(75);

  const walker = new Walker(stage.camera, canvas, FEEL.earth);
  walker.useWorld(grid);
  walker.bounds = BOUNDS;
  const [sx, sz] = SPAWNS[0];
  walker.enter(V(sx, 0.05, sz), spawnYaw(sx, sz));

  // ------------------------------------------------------------------ state

  let conn: Conn | null = null;
  const me = { id: 0, name: '', col: 0, alive: false, life: 0 };
  const roster = new Map<number, { name: string; col: number; tags: number; deaths: number }>();
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

  const serverNow = () => performance.now() + (offset ?? 0);
  const shown = (w: WeaponId) => Math.max(0, ammo[w] - pending.filter((p) => p.w === w).length);
  const nameOf = (id: number) => roster.get(id);
  const whoHtml = (id: number) => {
    const r = nameOf(id);
    return r ? ArenaHud.who(r.name, r.col) : 'someone';
  };

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

  function showBoard() {
    if (round.st === 'end') {
      const mvp = round.mvp ? nameOf(round.mvp) : null;
      hud.board(true, rows(), `Round ${round.n} - knock-off`,
        mvp ? `${ArenaHud.who(mvp.name, mvp.col)} takes the shift.` : 'Nobody tagged anybody. Very safe. Very dull.');
    } else if (tabHeld) {
      hud.board(true, rows(), round.st === 'play' ? `Round ${round.n} - ${CONDITIONS[round.c].label}` : 'Warm-up - scores do not count yet');
    } else {
      hud.board(false);
    }
  }

  /** what this round is played under: gravity, jump, how a lump drops */
  function applyRound(r: RoundInfo, announce: boolean) {
    const was = round;
    round = r;
    hud.setRound(r);
    const cond = CONDITIONS[r.st === 'play' || r.st === 'end' ? r.c : 0];
    const feel = FEEL[cond.feel];
    walker.setFeel(feel);
    lumps.g = throwGravity(feel.gravity);
    if (r.st === 'play' && (was.st !== 'play' || was.n !== r.n)) {
      for (const v of roster.values()) { v.tags = 0; v.deaths = 0; }
      lumps.clean();
      if (announce) {
        sfx.horn();
        hud.toast(`Round ${r.n}: ${cond.label}. ${cond.note}`);
      }
    }
    if (r.st === 'end') {
      for (const [id, tags, deaths] of r.sc ?? []) {
        const v = roster.get(id);
        if (v) { v.tags = tags; v.deaths = deaths; }
      }
      if (announce) sfx.horn();
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
  }

  function connect() {
    clearTimeout(retry);
    if (conn) { const c = conn; conn = null; c.close(); }
    reset();
    hud.status('Clocking on...');
    bye = '';
    const c = socket();
    conn = c;
    c.onMessage = (m) => { if (conn === c) onMessage(m); };
    c.onClose = (code, opened) => {
      if (conn !== c) return;
      conn = null;
      console.info(`arena: line closed, ${code}${bye ? ' (' + bye + ')' : ''}`);
      if (code === 4001) {
        practise(`The arena is full - ${MAX_PLAYERS} on shift. Practising here; trying again every 15 s.`);
        watchForRoom(15000);
      } else if (!opened) {
        practise('No arena server to be found - practising on your own.');
        watchForRoom(60000);
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
    const c = local(grid, hash);
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
          const s = await r.json() as { online: number; max: number };
          if (s.online < s.max) { connect(); return; }
        }
      } catch { /* still nothing there */ }
      watchForRoom(every);
    }, every);
  }

  // ------------------------------------------------------------ messages

  function onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'hi': {
        me.id = m.id; me.name = m.name; me.col = m.col;
        backoff = 1500;
        if (!conn?.offline) {
          saveToken(m.k);
          hud.status(null);
        }
        hud.setMe(m.name, m.col);
        offset = m.T - performance.now();
        for (const [id, name, col, tags, deaths] of m.players) {
          roster.set(id, { name, col, tags, deaths });
          if (id !== me.id) avatars.add(id, name, col);
        }
        pickups.setAll(m.picks);
        applyRound(m.round, false);
        hud.setOnline(roster.size);
        if (m.hash !== hash) {
          console.warn(`arena: this page's plant (${hash}) is not the one the server was baked from (${m.hash}) - run npm run bake`);
        }
        break;
      }
      case 'bye': bye = m.why; break;
      case 'J':
        roster.set(m.id, { name: m.name, col: m.col, tags: 0, deaths: 0 });
        avatars.add(m.id, m.name, m.col);
        hud.setOnline(roster.size);
        hud.feed(`${whoHtml(m.id)}<em>clocked on</em>`);
        showBoard();
        break;
      case 'L':
        hud.feed(`${whoHtml(m.id)}<em>knocked off</em>`);
        roster.delete(m.id);
        avatars.remove(m.id);
        hud.setOnline(roster.size);
        showBoard();
        break;
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
    sfx.down();
    hud.down(killer ? whoHtml(killer) : null, killer ? WEAPONS[w].verb : '', performance.now() + RESPAWN_DELAY * 1000);
  }

  // ------------------------------------------------------------ throwing

  const _o = V(), _d = V(), _m = V();

  function fire(w: WeaponId) {
    if (!conn || !me.id || !me.alive || walker.paused || round.st === 'end') return;
    const now = performance.now();
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
      hud.hint('<kbd>Click</kbd> paste gun &middot; <kbd>Right click</kbd> throw a rock &middot; walk over filter cake for more paste');
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

  /** Plastered: rise up out of yourself and look at whoever did it. */
  function deathCam(dt: number) {
    const cam = stage.camera;
    const a = killer ? avatars.get(killer) : undefined;
    const target = a ? a.position.clone().add(V(0, 1.2, 0)) : deathAt.clone().add(V(0, -1.5, 0.01));
    const want = deathAt.clone().add(V(0, 2.8, 0));
    cam.position.lerp(want, 1 - Math.exp(-dt * 2.5));
    _look.lookAt(cam.position, target, UP);
    _q.setFromRotationMatrix(_look);
    cam.quaternion.slerp(_q, 1 - Math.exp(-dt * 3));
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const now = performance.now();

    plant.step(dt);
    world.update(plant.telemetry, dt);

    walker.speedScale = now < slowUntil ? PASTE_SLOW.scale : 1;
    if (me.alive) walker.update(dt);
    else deathCam(dt);

    const sNow = serverNow();
    avatars.update(sNow, dt);
    const drawn = sNow - INTERP_MS;
    for (let i = hits.length - 1; i >= 0; i--) {
      if (hits[i].T > drawn) continue;
      const h = hits[i];
      avatars.get(h.id)?.hit(V(...h.p), h.w === 0);
      hits.splice(i, 1);
    }
    lumps.update(now / 1000, sNow / 1000);
    pickups.update(now / 1000);

    const v = walker.velocity;
    vm.update(stage.camera, dt, Math.hypot(v.x, v.z), walker.grounded, walker.yawAngle, walker.pitchAngle);
    if (lmb) fire(weapon);

    sendAcc += dt;
    if (conn && me.id && me.alive && sendAcc >= 1 / SEND_HZ) {
      sendAcc = 0;
      const f = walker.feet;
      const run = Math.hypot(v.x, v.z) > FEEL.earth.walk + 0.5;
      conn.send({
        t: 's', p: [r2(f.x), r2(f.y), r2(f.z)], a: [r3(walker.yawAngle), r3(walker.pitchAngle)], w: weapon,
        f: (walker.grounded ? F.floor : 0) | (run ? F.run : 0) | (walker.paused ? F.away : 0), l: me.life,
      });
    }

    hud.tick(sNow);
    hud.downTick(now);
    stage.render();
  }

  refreshAmmo();
  hud.setHp(hp);
  // The first frame compiles every shader in the plant, which can hold the
  // page for seconds. Get it over with before opening the line, so the
  // hello is not stuck behind it.
  frame();
  connect();

  (window as unknown as { PW: unknown }).PW = {
    stage, world, walker, avatars, lumps, hud, grid, hash, plant, vm, pickups, THREE,
    get conn() { return conn; },
    get me() { return me; },
    get ammo() { return [shown(0), shown(1)]; },
    get round() { return round; },
    get roster() { return roster; },
    fire, setWeapon, practise,
  };
}
