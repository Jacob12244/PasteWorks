/**
 * The Clarion-Clipperton Zone, 4,400 m down. No sunlight has ever reached
 * here, so every photon is one the plant brought: floodlight cones through
 * marine snow, fish that come to look at the light, a few jellyfish that make
 * their own. The paste goes three kilometres across the plain to fill the
 * furrows the nodule collectors cut, and the older ones are already growing
 * back.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Telemetry } from '../../sim/plant';
import { DESIGN } from '../../sim/plant';
import type { Names } from '../../scenario';
import { C, metal, matte, glowUnique, glow } from '../palette';
import { box, cyl, tube, strip } from '../parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from '../flow';
import { Unit } from '../units';
import { Dressing, Field, rng, clamp01 } from './common';

/** Furrow 7: 200 x 10 x 3 m, which is exactly the 6,000 m3 the job calls for. */
export const FURROW = { x0: 62, x1: 262, z0: -5, z1: 5, depth: 3 };
export const FURROW_HOLE: [number, number, number, number] = [FURROW.x0, FURROW.x1, FURROW.z0, FURROW.z1];

/** Where the line runs along the seabed, just north of the furrow. */
const LINE_Z = 8.2;
const LINE_Y = 0.55;

// ------------------------------------------------------------- the line

export class SeafloorLine extends Unit {
  readonly id = 'pipeline';
  readonly name: string;
  private mats: FlowMaterial[] = [];
  private taps: THREE.MeshStandardMaterial[] = [];

  constructor(startX: number, names: Names) {
    super(names.lineShort, 2.6, '#c08f52');
    this.name = names.line;
    const g = this.group;

    const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      const mat = flowMaterial(C.paste, { density: bandsFor(len), intensity: 2.0 });
      this.mats.push(mat);
      const m = tube(0.4, len, mat, 16);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
    };
    // Off the pump, down to the bottom, and away along it. 200 mm, and the
    // taps glow down its length so a plug shows up as a colour change.
    const a = new THREE.Vector3(startX, 2.3, 0);
    const b = new THREE.Vector3(startX + 3, 2.3, 0);
    const c = new THREE.Vector3(startX + 5, LINE_Y, LINE_Z);
    const d = new THREE.Vector3(FURROW.x1 + 30, LINE_Y, LINE_Z);
    seg(a, b); seg(b, c); seg(c, d);

    // concrete sleepers, the way a seabed line is actually laid
    for (let x = c.x + 3; x < d.x; x += 6) {
      const s = box(0.8, 0.3, 2.2, matte(0x5a5f5a, 0.95));
      s.position.set(x, 0.05, LINE_Z);
      g.add(s);
    }
    for (let x = c.x + 20; x < d.x; x += 45) {
      const m = glowUnique(C.lime, 2.2);
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), m);
      t.position.set(x, LINE_Y + 0.55, LINE_Z);
      this.taps.push(m);
      g.add(t);
    }

    this.focus.set((startX + FURROW.x0) / 2, 2, LINE_Z);
    this.viewOffset = new THREE.Vector3(-20, 16, 36);
    this.tag.group.position.set(FURROW.x0 - 8, 7, LINE_Z);
    g.add(this.tag.group);
  }

  update(t: Telemetry) {
    const p = t.pipe;
    const v = p.plugged ? 0 : p.velocity;
    for (const m of this.mats) setFlow(m, v, 1, t.pump.flow > 0.5 ? 1 : 0);
    const tone = p.plugged ? C.red : p.plugRisk > 0.4 ? C.amber : v > 0.1 ? C.lime : C.cyan;
    for (const m of this.taps) {
      m.emissive.setHex(tone);
      m.emissiveIntensity = p.plugged ? 3 + Math.sin(t.time * 8) * 2 : 2.2;
    }
    this.tag.set(
      p.plugged ? 'PLUGGED' : v.toFixed(2) + ' m/s',
      (DESIGN.pipeLength / 1000).toFixed(1) + ' km  ' + p.gradient.toFixed(1) + ' kPa/m',
      p.plugged ? 'trip' : p.plugRisk > 0.4 ? 'warn' : 'ok',
    );
  }
}

// ----------------------------------------------------------- the furrow

/**
 * Furrow 7, filling from the plant end outwards. A tracked placement crawler
 * rides the lip, running a hose down into the trench at the fill front, and
 * the furrows either side - 1 to 6 - are already restored and starting to
 * grow things.
 */
export class Furrow extends Unit {
  readonly id = 'stope';
  readonly name: string;
  private fill: THREE.Mesh;
  private fillMat: THREE.MeshStandardMaterial;
  private crawler = new THREE.Group();
  private lamp: THREE.MeshStandardMaterial;
  private names: Names;

  constructor(names: Names) {
    super(names.destShort, 3.2, '#c08f52');
    this.name = names.dest;
    this.names = names;
    const g = this.group;
    const L = FURROW.x1 - FURROW.x0, W = FURROW.z1 - FURROW.z0, D = FURROW.depth;
    const cx = (FURROW.x0 + FURROW.x1) / 2;

    // the cut itself, seen from inside
    const sides = matte(0x151b18, 1).clone();
    sides.side = THREE.BackSide;
    const cut = new THREE.Mesh(new THREE.BoxGeometry(L, D, W), sides);
    cut.position.set(cx, -0.4 - D / 2, 0);
    g.add(cut);
    for (const z of [FURROW.z0, FURROW.z1]) {
      const lip = strip(L, 0x35e0d0, 0.08, 0.9);
      lip.position.set(cx, -0.35, z);
      g.add(lip);
    }

    this.fillMat = new THREE.MeshStandardMaterial({
      color: C.paste, emissive: C.paste, emissiveIntensity: 0.25, roughness: 0.8,
    });
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(1, D, W - 0.1), this.fillMat);
    this.fill.position.set(FURROW.x0, -0.4 - D / 2, 0);
    g.add(this.fill);

    // ---- the crawler, on the north lip
    const body = box(4.2, 1.6, 2.6, metal(0xd8b23a, 0.5, 0.5));
    body.position.y = 1.4;
    this.crawler.add(body);
    for (const z of [-1.35, 1.35]) {
      const track = box(4.6, 0.8, 0.6, matte(0x1a1f24, 0.9));
      track.position.set(0, 0.45, z);
      this.crawler.add(track);
    }
    this.lamp = glowUnique(C.amber, 2.4);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.lamp);
    beacon.position.set(0.8, 2.4, 0);
    this.crawler.add(beacon);
    const boom = tube(0.12, 4.2, metal(C.steelLight), 8);
    boom.rotation.x = Math.PI / 2 - 0.5;
    boom.position.set(-1.2, 1.4, -2.4);
    this.crawler.add(boom);
    const hose = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.8, 1.2, 1.4), new THREE.Vector3(-0.8, 2.6, -2.4),
        new THREE.Vector3(-1.4, 0.4, -5.6), new THREE.Vector3(-1.4, -1.6, -8.6),
      ]), 20, 0.22, 8), matte(0x2a2f36, 0.8));
    this.crawler.add(hose);
    const light = new THREE.PointLight(0xffe0a8, 30, 26, 2);
    light.position.set(-1.5, 3, -6);
    this.crawler.add(light);
    this.crawler.position.set(FURROW.x0, 0, FURROW.z1 + 3.2);
    g.add(this.crawler);

    // ---- furrows 1 to 6, already put back
    const r = rng(41);
    const restored = matte(0x3a3a30, 1);
    const life = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.14, 0.9, 5), glow(0x7affd8, 1.6), 260,
    );
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (const [z, k] of [[-19, 6], [-33, 5], [19, 4], [33, 3], [-47, 2], [47, 1]] as const) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(L, W), restored);
      band.rotation.x = -Math.PI / 2;
      band.position.set(cx, -0.38, z);
      g.add(band);
      // the older the furrow, the more has moved back in
      for (let i = 0; i < 18 + (7 - k) * 12 && n < 260; i++) {
        m4.makeTranslation(FURROW.x0 + r() * L, 0.05, z + (r() - 0.5) * W * 0.8);
        life.setMatrixAt(n++, m4);
      }
    }
    life.count = n;
    g.add(life);

    this.focus.set(FURROW.x0 + 60, 0, 0);
    this.viewOffset = new THREE.Vector3(-40, 26, 50);
    this.tag.group.position.set(FURROW.x0 + 30, 8, 0);
    g.add(this.tag.group);
  }

  update(t: Telemetry, _dt: number) {
    const s = t.stope;
    const L = FURROW.x1 - FURROW.x0;
    const len = Math.max(0.2, clamp01(s.pct / 100) * L);
    this.fill.scale.x = len;
    this.fill.position.x = FURROW.x0 + len / 2;
    this.crawler.position.x = FURROW.x0 + len + 1.5;

    const q = clamp01(s.avgUcs / (DESIGN.targetUcs * 1.4));
    this.fillMat.color.lerpColors(new THREE.Color(0x6f6350), new THREE.Color(C.paste), q);
    this.fillMat.emissive.copy(this.fillMat.color);
    const working = t.pump.flow > 0.5;
    this.lamp.emissiveIntensity = working ? 1.5 + Math.sin(t.time * 4) * 1.2 : 0.4;

    const ok = s.avgUcs >= DESIGN.targetUcs;
    this.tag.set(
      s.pct.toFixed(1) + '%',
      s.volume.toFixed(0) + ' / ' + DESIGN.stopeVolume + ' m3 ' + this.names.placed,
      s.pct > 1 && !ok ? 'warn' : 'ok',
    );
  }
}

// --------------------------------------------------------------- the sea

/** A fish, pointing +x: an ellipsoid body and a forked tail. */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 10, 6);
  body.scale(1, 0.34, 0.18);
  const tail = new THREE.ConeGeometry(0.22, 0.4, 4);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 1, 0.25);
  tail.translate(-0.6, 0, 0);
  return mergeGeometries([body.toNonIndexed(), tail.toNonIndexed()])!;
}

interface School {
  mesh: THREE.InstancedMesh;
  centre: THREE.Vector3;
  radius: THREE.Vector2;
  speed: number;
  phase: number;
  bob: number;
  offsets: THREE.Vector3[];
  size: number;
}

/**
 * Schools on looping paths, one of them circling the control room bubble,
 * so from the chair they come past the window every minute or so.
 */
function schools(root: THREE.Group, r: () => number): School[] {
  const geo = fishGeometry();
  const out: School[] = [];
  const specs: Array<[number, number, number, number, number, number, number, number]> = [
    // cx, cy, cz, rx, rz, speed, n, size
    [-14, 5.5, 50, 13, 12, 0.22, 26, 0.9],    // round the bubble
    [-30, 9, 10, 40, 26, 0.09, 34, 1.0],
    [10, 14, -6, 34, 30, -0.07, 28, 1.2],
    [-80, 12, 0, 30, 36, 0.06, 30, 1.1],
    [120, 6, 0, 70, 16, 0.05, 40, 0.8],       // along the furrow
    [-20, 24, 20, 60, 50, -0.04, 18, 2.4],    // big slow ones, higher up
  ];
  specs.forEach(([cx, cy, cz, rx, rz, speed, n, size], k) => {
    const mat = new THREE.MeshStandardMaterial({
      color: k === 5 ? 0x6a7a8a : 0xa9c8dc, metalness: 0.7, roughness: 0.3,
      emissive: k === 5 ? 0x0 : 0x1a4a6a, emissiveIntensity: 0.6,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    const offsets: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      offsets.push(new THREE.Vector3((r() - 0.5) * 6, (r() - 0.5) * 2.4, (r() - 0.5) * 4));
    }
    root.add(mesh);
    out.push({
      mesh, centre: new THREE.Vector3(cx, cy, cz), radius: new THREE.Vector2(rx, rz),
      speed, phase: r() * 6, bob: 0.6 + r(), offsets, size,
    });
  });
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function swim(sc: School, time: number) {
  const a = sc.phase + time * sc.speed;
  const dir = Math.sign(sc.speed);
  for (let i = 0; i < sc.offsets.length; i++) {
    const o = sc.offsets[i];
    const ai = a + o.x * 0.012;
    _p.set(
      sc.centre.x + Math.cos(ai) * sc.radius.x + o.x * 0.4,
      sc.centre.y + o.y + Math.sin(time * sc.bob + i) * 0.35,
      sc.centre.z + Math.sin(ai) * sc.radius.y + o.z,
    );
    // heading: along the ellipse, with a little wag
    const hx = -Math.sin(ai) * sc.radius.x * dir;
    const hz = Math.cos(ai) * sc.radius.y * dir;
    _e.set(0, Math.atan2(-hz, hx) + Math.sin(time * 6 + i) * 0.12, 0);
    _q.setFromEuler(_e);
    _s.setScalar(sc.size * (0.8 + ((i * 37) % 10) / 25));
    _m.compose(_p, _q, _s);
    sc.mesh.setMatrixAt(i, _m);
  }
  sc.mesh.instanceMatrix.needsUpdate = true;
}

interface Jelly { g: THREE.Group; mat: THREE.MeshStandardMaterial; home: THREE.Vector3; ph: number }

function jellyfish(root: THREE.Group, r: () => number): Jelly[] {
  const out: Jelly[] = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: i % 3 ? 0x8a6aff : 0x5affd8, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    });
    const bell = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    bell.scale.set(1, 0.8, 1);
    g.add(bell);
    const pts: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      pts.push(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, Math.cos(a) * 0.5, -3 - r() * 2, Math.sin(a) * 0.5);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.35,
    })));
    const home = new THREE.Vector3((r() - 0.5) * 200, 10 + r() * 22, (r() - 0.5) * 140);
    g.position.copy(home);
    g.scale.setScalar(0.8 + r() * 1.2);
    root.add(g);
    out.push({ g, mat, home, ph: r() * 6 });
  }
  return out;
}

/** Nodules on the plain, and the glass sponges that grow between them. */
function seabed(root: THREE.Group, r: () => number) {
  const keep = (x: number, z: number) =>
    !(x > -110 && x < 42 && Math.abs(z) < 38) && !(x > 55 && x < 270 && Math.abs(z) < 55);
  const nod = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0), matte(0x1a1612, 0.9), 1600,
  );
  let n = 0;
  for (let i = 0; i < 4000 && n < 1600; i++) {
    const x = (r() - 0.5) * 560, z = (r() - 0.5) * 420;
    if (!keep(x, z)) continue;
    const s = 0.15 + r() * 0.3;
    _q.setFromEuler(_e.set(r() * 3, r() * 3, r() * 3));
    _m.compose(_p.set(x, -0.35, z), _q, _s.set(s, s * 0.6, s));
    nod.setMatrixAt(n++, _m);
  }
  nod.count = n;
  root.add(nod);

  const spongeMat = new THREE.MeshStandardMaterial({
    color: 0xe8f4ff, emissive: 0x6aa8c8, emissiveIntensity: 0.25,
    transparent: true, opacity: 0.55, roughness: 0.5,
  });
  const sponges = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.18, 1, 10, 1, true), spongeMat, 90);
  n = 0;
  for (let i = 0; i < 400 && n < 90; i++) {
    const x = (r() - 0.5) * 420, z = (r() - 0.5) * 320;
    if (!keep(x, z)) continue;
    const h = 1 + r() * 2.4;
    _m.compose(_p.set(x, -0.4 + h / 2, z), _q.identity(), _s.set(0.6 + r() * 0.8, h, 0.6 + r() * 0.8));
    sponges.setMatrixAt(n++, _m);
  }
  sponges.count = n;
  root.add(sponges);
}

export function buildOcean(root: THREE.Group): Dressing {
  const r = rng(97);

  const snow = new Field({
    count: 2600,
    min: new THREE.Vector3(-170, -0.2, -110), max: new THREE.Vector3(290, 60, 110),
    drift: new THREE.Vector3(0.12, -0.3, 0.05), wobble: 0.25,
    size: 0.24, colour: 0xd8ecff, opacity: 0.55, seed: 13,
  });
  root.add(snow.object);

  // a vent near the plant, the only thing down here that goes up
  const bubbles = new Field({
    count: 140,
    min: new THREE.Vector3(-72, 0, -26), max: new THREE.Vector3(-68, 60, -22),
    drift: new THREE.Vector3(0, 2.4, 0), wobble: 0.4,
    size: 0.32, colour: 0xcfeaff, opacity: 0.4, seed: 3,
  });
  root.add(bubbles.object);

  seabed(root, r);
  const fish = schools(root, r);
  const jellies = jellyfish(root, r);

  return {
    update(t, dt, time) {
      snow.update(t, dt);
      bubbles.update(t, dt);
      for (const s of fish) swim(s, time);
      for (const j of jellies) {
        // a pulse, a little lift, a slow sink
        const p = (time * 0.6 + j.ph) % (Math.PI * 2);
        const push = Math.max(0, Math.sin(p));
        j.g.position.y = j.home.y + Math.sin(time * 0.25 + j.ph) * 3;
        j.g.position.x = j.home.x + Math.sin(time * 0.05 + j.ph) * 6;
        j.g.scale.y = j.g.scale.x * (1 - push * 0.18);
        j.mat.emissiveIntensity = 0.8 + push * 1.2;
      }
    },
  };
}
