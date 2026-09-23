/**
 * 16 Psyche: black sky, hard sun, a pressure dome over the plant - an open
 * thickener would boil dry in a vacuum - and a mass driver on the regolith
 * outside, throwing cured slugs of tailings off the asteroid.
 */
import * as THREE from 'three';
import type { Telemetry } from '../../sim/plant';
import { DESIGN } from '../../sim/plant';
import type { Names } from '../../scenario';
import { C, metal, matte, glow, glowUnique } from '../palette';
import { box, cyl, tube, flange, strip, pipeSupport } from '../parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from '../flow';
import { Unit } from '../units';
import { Dressing, Field, rng, canvasTexture, clamp01 } from './common';

// ---------------------------------------------------------------- geometry

/** The rail: breech, bearing and length. */
export const RAIL = {
  x: 70, y: 3.2,
  angle: (14 * Math.PI) / 180,
  length: 150,
};
const railDir = new THREE.Vector3(Math.cos(RAIL.angle), Math.sin(RAIL.angle), 0);
const railAt = (s: number) =>
  new THREE.Vector3(RAIL.x, RAIL.y, 0).addScaledVector(railDir, s);

/** The open pit in the metal, west of the dome: four benches of five metres. */
export const PIT = { x: -228, z: -4, half: 32, benches: 4, bench: 5, step: 6.5 };
export const PIT_HOLE: [number, number, number, number] = [
  PIT.x - PIT.half, PIT.x + PIT.half, PIT.z - PIT.half, PIT.z + PIT.half,
];

/** Pelletiser house, where the paste line ends. */
const PELLET = { x: 46, w: 10 };

// ---------------------------------------------------------------- the sky

function starfield(): THREE.Points {
  const r = rng(11);
  const n = 4200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  // Mostly uniform, plus a band along a tilted great circle for the galaxy.
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0.3, 0.5));
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3();
    if (i < n * 0.45) {
      const a = r() * Math.PI * 2;
      const spread = (r() + r() + r() - 1.5) * 0.16;
      v.set(Math.cos(a), spread, Math.sin(a)).normalize().applyQuaternion(tilt);
    } else {
      v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
    }
    v.multiplyScalar(820);
    pos.set([v.x, v.y, v.z], i * 3);
    const k = r();
    c.setHSL(k < 0.2 ? 0.58 : k < 0.3 ? 0.08 : 0.12, k < 0.3 ? 0.55 : 0.1, 0.55 + r() * 0.4);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // No twinkle. There is no air here to make them twinkle.
  const m = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.95, depthWrite: false, fog: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -1;
  return p;
}

function glowSprite(colour: string, size: number, core = 0.12): THREE.Sprite {
  const tex = canvasTexture(128, 128, (g, W, H) => {
    const grad = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(core, colour);
    grad.addColorStop(0.45, colour.replace(')', ',0.25)').replace('rgb', 'rgba'));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(size);
  return s;
}

/**
 * The pressure dome. An open thickener in a vacuum boils dry in minutes, so
 * the whole process plant sits under glass; only the mass driver is outside.
 */
function dome(): THREE.Group {
  const g = new THREE.Group();
  const R = new THREE.Vector3(108, 36, 60);
  const skin = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.045, roughness: 0.05,
      metalness: 0.3, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  skin.scale.copy(R);
  g.add(skin);

  // lat-long frame
  const pts: number[] = [];
  const P = (lat: number, lon: number) => [
    Math.cos(lat) * Math.cos(lon) * R.x, Math.sin(lat) * R.y, Math.cos(lat) * Math.sin(lon) * R.z,
  ];
  const LON = 28, LAT = 7;
  for (let i = 0; i < LON; i++) {
    const lon = (i / LON) * Math.PI * 2;
    for (let k = 0; k < 16; k++) {
      pts.push(...P((k / 16) * Math.PI / 2, lon), ...P(((k + 1) / 16) * Math.PI / 2, lon));
    }
  }
  for (let j = 0; j <= LAT; j++) {
    const lat = (j / (LAT + 1)) * Math.PI / 2;
    for (let i = 0; i < 64; i++) {
      pts.push(...P(lat, (i / 64) * Math.PI * 2), ...P(lat, ((i + 1) / 64) * Math.PI * 2));
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const frame = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
    color: 0x6f8aa6, transparent: true, opacity: 0.32,
  }));
  g.add(frame);

  // a lit ring where the dome meets the regolith
  const foot = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.012, 6, 96),
    glow(C.amber, 1.4),
  );
  foot.rotation.x = Math.PI / 2;
  foot.scale.set(R.x, R.z, 1);
  foot.position.y = 0.3;
  g.add(foot);

  g.position.set(-45, 0, 6);
  return g;
}

/** Craters and boulders: metal-rich regolith, battered for four billion years. */
function regolith(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(23);
  const keep = (x: number, z: number) =>
    // stay off the dome footprint and the rail corridor
    ((x + 45) / 112) ** 2 + ((z - 6) / 64) ** 2 > 1 && !(x > 40 && x < 240 && Math.abs(z) < 16)
    && !(x > -275 && x < -150 && z > -45 && z < 45);

  const rimMat = matte(0x39383a, 0.9);
  const floorMat = matte(0x1d1c1e, 1);
  for (let i = 0; i < 70; i++) {
    const x = (r() - 0.5) * 900, z = (r() - 0.5) * 900;
    if (!keep(x, z)) continue;
    const rad = 3 + r() ** 2 * 22;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rad, rad * 0.12, 6, 28), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.scale.z = 0.5;
    rim.position.set(x, -0.35, z);
    g.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.95, 24), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, -0.37, z);
    g.add(floor);
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = metal(0x4a4846, 0.55, 0.6);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 260);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  for (let i = 0; i < 600 && n < 260; i++) {
    const x = (r() - 0.5) * 700, z = (r() - 0.5) * 700;
    if (!keep(x, z)) continue;
    const s = 0.4 + r() ** 3 * 5;
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    m.compose(new THREE.Vector3(x, -0.4 + s * 0.4, z), q, new THREE.Vector3(s, s * 0.7, s));
    rocks.setMatrixAt(n++, m);
  }
  rocks.count = n;
  rocks.castShadow = true;
  g.add(rocks);
  return g;
}

// ---------------------------------------------------------- the destination

/**
 * The paste line from the pump to the pelletiser: short and dead level,
 * through the dome wall. In a vacuum a leak is not a puddle, it is steam.
 */
export class LaunchFeed extends Unit {
  readonly id = 'pipeline';
  readonly name: string;
  private mat: FlowMaterial;
  private tap: THREE.MeshStandardMaterial;

  constructor(startX: number, names: Names) {
    super(names.lineShort, 2.6, '#c08f52');
    this.name = names.line;
    const g = this.group;
    const a = new THREE.Vector3(startX, 2.3, 0);
    const b = new THREE.Vector3(PELLET.x - PELLET.w / 2, 2.3, 0);
    const len = a.distanceTo(b);
    this.mat = flowMaterial(C.paste, { density: bandsFor(len), intensity: 2.0 });
    const pipe = tube(0.34, len, this.mat, 16);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.copy(a).lerp(b, 0.5);
    g.add(pipe);
    for (let x = startX + 2; x < b.x - 1; x += 4) {
      const s = pipeSupport(1.9);
      s.position.set(x, 0, 0);
      g.add(s);
    }
    const f = flange(0.34);
    f.rotation.z = Math.PI / 2;
    f.position.copy(b);
    g.add(f);
    this.tap = glowUnique(C.lime, 2.2);
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.tap);
    t.position.set((a.x + b.x) / 2, 3.1, 0.5);
    g.add(t);

    this.focus.set((a.x + b.x) / 2, 3, 0);
    this.viewOffset = new THREE.Vector3(-10, 10, 24);
    this.mountTag(7.5);
    this.tag.group.position.x = (a.x + b.x) / 2;
  }

  update(t: Telemetry) {
    const p = t.pipe;
    const v = p.plugged ? 0 : p.velocity;
    setFlow(this.mat, v, 1, t.pump.flow > 0.5 ? 1 : 0);
    const tone = p.plugged ? C.red : p.plugRisk > 0.4 ? C.amber : v > 0.1 ? C.lime : C.cyan;
    this.tap.emissive.setHex(tone);
    this.tag.set(
      p.plugged ? 'PLUGGED' : v.toFixed(2) + ' m/s',
      p.gradient.toFixed(1) + ' kPa/m  ' + p.regime,
      p.plugged ? 'trip' : p.plugRisk > 0.4 ? 'warn' : 'ok',
    );
  }
}

interface Slug { mesh: THREE.Mesh; s: number; v: number; live: boolean; free: boolean; age: number }

/**
 * Mass Driver MD-1: pelletiser, curing autoclave, and a 150 m coil rail.
 * The rings light in sequence as each slug passes through them, which is
 * the whole show - a coil gun fires its coils one after another, just ahead
 * of the projectile.
 */
export class MassDriver extends Unit {
  readonly id = 'stope';
  readonly name: string;
  private rings: THREE.MeshStandardMaterial[] = [];
  private ringS: number[] = [];
  private slugs: Slug[] = [];
  private carry = 0;
  private muzzle: THREE.MeshStandardMaterial;
  private flash = 0;
  private quota: THREE.Mesh;
  private quotaMat: THREE.MeshStandardMaterial;
  private names: Names;

  constructor(names: Names) {
    super(names.destShort, 3.4, '#ffab3d');
    this.name = names.dest;
    this.names = names;
    const g = this.group;

    // ---- pelletiser house, where the paste arrives
    const house = box(PELLET.w, 8, 12, metal(0x3b4250, 0.6, 0.7));
    house.position.set(PELLET.x, 4, 0);
    g.add(house);
    const band = strip(PELLET.w, C.amber, 0.12, 1.8);
    band.position.set(PELLET.x, 8.1, 6.05);
    g.add(band);
    const vent = cyl(1.0, 1.0, 3.0, metal(C.steelLight, 0.5, 0.8), 16);
    vent.position.set(PELLET.x + 2, 9.5, -3);
    g.add(vent);

    // ---- the curing autoclave: slugs go in soft and come out at strength
    const acLen = RAIL.x - (PELLET.x + PELLET.w / 2) - 1;
    const ac = tube(2.1, acLen, metal(0x566273, 0.4, 0.85), 24);
    ac.rotation.z = Math.PI / 2;
    ac.position.set(PELLET.x + PELLET.w / 2 + acLen / 2, 3.2, 0);
    g.add(ac);
    for (let i = 0; i <= 4; i++) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(2.18, 0.12, 8, 28), metal(C.steelDark));
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(PELLET.x + PELLET.w / 2 + (acLen * i) / 4, 3.2, 0);
      g.add(hoop);
    }
    for (const x of [PELLET.x + PELLET.w / 2 + 2, RAIL.x - 3]) {
      const saddle = box(1.2, 1.4, 3.4, metal(C.steelDark));
      saddle.position.set(x, 0.7, 0);
      g.add(saddle);
    }

    // ---- the rail
    const railGroup = new THREE.Group();
    railGroup.position.set(RAIL.x, RAIL.y, 0);
    railGroup.rotation.z = RAIL.angle;
    g.add(railGroup);
    const L = RAIL.length;
    for (const z of [-0.95, 0.95]) {
      const r = box(L, 0.28, 0.24, metal(0x8c97a6, 0.3, 0.95));
      r.position.set(L / 2, 0, z);
      railGroup.add(r);
    }
    const spine = box(L, 0.9, 0.7, metal(C.steelDark, 0.6, 0.8));
    spine.position.set(L / 2, -1.5, 0);
    railGroup.add(spine);

    for (let s = 3; s < L; s += 4) {
      const mat = glowUnique(C.cyan, 0.35);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.2, 8, 24), mat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(s, 0, 0);
      railGroup.add(ring);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.1, 6, 24), metal(C.steelDark));
      collar.rotation.y = Math.PI / 2;
      collar.position.set(s, 0, 0);
      railGroup.add(collar);
      this.rings.push(mat);
      this.ringS.push(s);
    }

    // pylons down to the regolith, getting taller along the rail
    for (let s = 10; s < L; s += 14) {
      const top = railAt(s);
      const h = top.y - 2.2;
      for (const z of [-2.2, 2.2]) {
        const leg = box(0.5, h, 0.5, metal(C.steel, 0.6, 0.85));
        leg.position.set(top.x, h / 2, z);
        leg.rotation.x = z > 0 ? -0.1 : 0.1;
        g.add(leg);
      }
      const cap = box(1.2, 0.5, 5.2, metal(C.steelDark));
      cap.position.set(top.x, h, 0);
      g.add(cap);
    }

    // muzzle
    const end = railAt(L);
    this.muzzle = glowUnique(C.amber, 0.6);
    const mz = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.32, 10, 32), this.muzzle);
    mz.position.copy(end);
    mz.rotation.set(0, Math.PI / 2, RAIL.angle);
    mz.rotation.order = 'ZYX';
    g.add(mz);

    // the slugs
    const slugGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.55, 12);
    slugGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: C.paste, emissive: 0xff8a3d, emissiveIntensity: 0.9, roughness: 0.7,
      });
      const mesh = new THREE.Mesh(slugGeo, mat);
      mesh.visible = false;
      mesh.rotation.z = RAIL.angle;
      g.add(mesh);
      this.slugs.push({ mesh, s: 0, v: 0, live: false, free: false, age: 0 });
    }

    // quota readout on the pelletiser wall
    const frame = box(0.2, 7.0, 1.0, matte(0x0d1118, 0.9));
    frame.position.set(PELLET.x + PELLET.w / 2 + 0.15, 4, 5.2);
    g.add(frame);
    this.quotaMat = glowUnique(C.amber, 2.2);
    this.quota = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1, 0.7), this.quotaMat);
    g.add(this.quota);

    this.focus.set(RAIL.x + 40, 12, 0);
    this.viewOffset = new THREE.Vector3(-30, 26, 90);
    this.tag.group.position.set(RAIL.x + 50, 30, 0);
    g.add(this.tag.group);
  }

  update(t: Telemetry, dt: number) {
    const s = t.stope;
    const flow = t.pump.flow;
    const L = RAIL.length;

    // Launch at a rate that tracks placement. The rail is drawn at film speed,
    // not at 300 m/s - at the real speed a slug would cross it in half a second
    // and you would never see one.
    this.carry += dt * Math.min(3, (flow / 120) * 1.6);
    while (this.carry >= 1) {
      this.carry -= 1;
      const free = this.slugs.find((x) => !x.live);
      if (!free) break;
      free.live = true; free.free = false; free.s = 0; free.v = 6; free.age = 0;
      free.mesh.visible = true;
    }

    let front = -100;
    for (const sl of this.slugs) {
      if (!sl.live) continue;
      sl.age += dt;
      if (!sl.free) {
        sl.v += 60 * dt;
        sl.s += sl.v * dt;
        if (sl.s >= L) { sl.free = true; this.flash = 1; }
        front = Math.max(front, sl.s);
      } else {
        sl.s += sl.v * dt;
      }
      sl.mesh.position.copy(railAt(sl.s));
      const far = clamp01((sl.s - L) / 380);
      sl.mesh.scale.setScalar(1 + far * 0.4);
      (sl.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + far * 2;
      if (sl.s > L + 420) { sl.live = false; sl.mesh.visible = false; }
    }

    // each coil fires just ahead of a slug and falls away behind it
    for (let i = 0; i < this.rings.length; i++) {
      let heat = 0;
      for (const sl of this.slugs) {
        if (!sl.live || sl.free) continue;
        const d = this.ringS[i] - sl.s;
        if (d > -3 && d < 6) heat = Math.max(heat, 1 - Math.abs(d - 1.5) / 4.5);
      }
      this.rings[i].emissiveIntensity = 0.3 + heat * 5;
      this.rings[i].emissive.setHex(heat > 0.4 ? 0xbff6ff : C.cyan);
    }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.muzzle.emissiveIntensity = 0.6 + this.flash * 7;

    const q = clamp01(s.pct / 100);
    this.quota.scale.y = Math.max(0.05, q * 6.4);
    this.quota.position.set(PELLET.x + PELLET.w / 2 + 0.3, 0.8 + (q * 6.4) / 2, 5.2);
    const ok = s.avgUcs >= DESIGN.targetUcs;
    this.quotaMat.emissive.setHex(s.pct < 1 ? C.cyan : ok ? C.amber : C.red);

    this.tag.set(
      s.pct.toFixed(1) + '%',
      s.volume.toFixed(0) + ' / ' + DESIGN.stopeVolume + ' m3 ' + this.names.placed,
      s.pct > 1 && !ok ? 'warn' : 'ok',
    );
    void front;
  }
}

// ----------------------------------------------------------------- the pit

/** A rectangle with a rectangular hole, as a flat floor at y. */
function frame(outer: number, inner: number, y: number, mat: THREE.Material): THREE.Mesh {
  const sh = new THREE.Shape();
  sh.moveTo(-outer, -outer); sh.lineTo(outer, -outer); sh.lineTo(outer, outer); sh.lineTo(-outer, outer);
  sh.closePath();
  if (inner > 0) {
    const h = new THREE.Path();
    h.moveTo(-inner, -inner); h.lineTo(-inner, inner); h.lineTo(inner, inner); h.lineTo(inner, -inner);
    h.closePath();
    sh.holes.push(h);
  }
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

interface Truck { g: THREE.Group; k: number; v: number }

/**
 * The pit, benched down into the metal, with an excavator on the floor and
 * autonomous trucks running ore to an airlock in the dome wall.
 */
function pit(root: THREE.Group): { trucks: Truck[]; a: THREE.Vector3; b: THREE.Vector3 } {
  const g = new THREE.Group();
  const floor = metal(0x3a3836, 0.6, 0.55);
  const wall = new THREE.MeshStandardMaterial({ color: 0x2c2b2d, roughness: 0.8, metalness: 0.5, side: THREE.BackSide });
  for (let i = 0; i < PIT.benches; i++) {
    const hs = PIT.half - i * PIT.step;
    const y0 = -0.4 - i * PIT.bench;
    const w = new THREE.Mesh(new THREE.BoxGeometry(hs * 2, PIT.bench, hs * 2, 1, 1, 1), wall);
    w.position.y = y0 - PIT.bench / 2;
    g.add(w);
    const next = i < PIT.benches - 1 ? hs - PIT.step : 0;
    g.add(frame(hs, next, y0 - PIT.bench + 0.01, floor));
    const edge = strip(hs * 2, C.amber, 0.06, 1.0);
    edge.position.set(0, y0 + 0.05, hs);
    g.add(edge);
  }
  // an excavator on the floor, working the face
  const ex = new THREE.Group();
  const body = box(5, 2.6, 3.6, metal(0xd8a23a, 0.5, 0.45));
  body.position.y = 2;
  ex.add(body);
  const boom = box(7, 0.8, 0.8, metal(0xd8a23a, 0.5, 0.45));
  boom.position.set(4, 4, 0);
  boom.rotation.z = 0.5;
  ex.add(boom);
  const lamp = new THREE.PointLight(0xffe6b0, 60, 40, 2);
  lamp.position.set(2, 5, 0);
  ex.add(lamp);
  ex.position.set(-6, -0.4 - PIT.benches * PIT.bench, 4);
  g.add(ex);
  g.position.set(PIT.x, 0, PIT.z);
  root.add(g);

  // the airlock in the dome wall, where the ore goes in
  const lock = box(10, 7, 9, metal(0x3b4250, 0.6, 0.7));
  lock.position.set(-153, 3.5, 10);
  root.add(lock);
  const door = box(0.2, 5, 6, glow(C.amber, 1.4));
  door.position.set(-158.1, 2.8, 10);
  root.add(door);

  // a haul road, and the trucks on it
  const a = new THREE.Vector3(PIT.x + PIT.half + 2, 0, PIT.z + 6);
  const b = new THREE.Vector3(-159, 0, 10);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(a.distanceTo(b), 8), matte(0x2f2e30, 1));
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x);
  road.position.copy(a).lerp(b, 0.5).setY(-0.36);
  root.add(road);
  const trucks: Truck[] = [];
  for (let i = 0; i < 3; i++) {
    const tg = new THREE.Group();
    const bed = box(6, 2.2, 3.4, metal(0x5a6068, 0.5, 0.7));
    bed.position.y = 2;
    tg.add(bed);
    const nose = box(1.8, 1.8, 3.2, metal(0xd8a23a, 0.5, 0.45));
    nose.position.set(3.8, 1.8, 0);
    tg.add(nose);
    const eye = box(0.1, 0.3, 2.6, glow(0xffffff, 3));
    eye.position.set(4.72, 1.9, 0);
    tg.add(eye);
    for (const x of [-2, 2.6]) {
      for (const z of [-1.6, 1.6]) {
        const wh = cyl(0.8, 0.8, 0.6, matte(0x1a1a1a, 0.9), 12);
        wh.rotation.x = Math.PI / 2;
        wh.position.set(x, 0.8, z);
        tg.add(wh);
      }
    }
    root.add(tg);
    trucks.push({ g: tg, k: i / 3, v: 0.05 });
  }
  return { trucks, a, b };
}

// ------------------------------------------------------------------ build

export function buildSpace(root: THREE.Group, key: THREE.DirectionalLight): Dressing {
  root.add(starfield());
  root.add(dome());
  root.add(regolith());
  const haul = pit(root);

  // the sun, where the key light is coming from
  const sunDir = key.position.clone().normalize();
  const sun = glowSprite('rgb(255,236,200)', 150, 0.08);
  sun.position.copy(sunDir).multiplyScalar(780);
  root.add(sun);

  // Kiln Station, the catcher, a moving point far down the rail's line of fire
  const station = glowSprite('rgb(160,220,255)', 16, 0.2);
  station.position.set(640, 260, -140);
  root.add(station);
  const blink = glowSprite('rgb(255,90,60)', 6, 0.3);
  blink.position.set(646, 262, -140);
  root.add(blink);

  // Out here the pumps vent a little frost that sublimes straight away.
  const frost = new Field({
    count: 260, min: new THREE.Vector3(-70, 0, -30), max: new THREE.Vector3(40, 30, 40),
    drift: new THREE.Vector3(0.1, 0.25, 0), wobble: 0.3, size: 0.18,
    colour: 0xcfe8ff, opacity: 0.35, seed: 5,
  });
  root.add(frost.object);

  return {
    update(t, dt, time) {
      frost.update(t, dt);
      const live = t.status !== 'idle' && t.status !== 'blocked';
      for (const tr of haul.trucks) {
        if (live) tr.k = (tr.k + dt * tr.v) % 1;
        // there and back: out loaded, back empty
        const out = tr.k < 0.5;
        const f = out ? tr.k * 2 : (1 - tr.k) * 2;
        tr.g.position.lerpVectors(haul.a, haul.b, f);
        tr.g.position.z += out ? -2 : 2;
        tr.g.rotation.y = Math.atan2(-(haul.b.z - haul.a.z), haul.b.x - haul.a.x) + (out ? 0 : Math.PI);
      }
      (blink.material as THREE.SpriteMaterial).opacity = Math.sin(time * 3) > 0.6 ? 1 : 0.1;
    },
  };
}
