/**
 * Where the tailings come from, on the sites that do not have a mill.
 *
 *   CollectorFront  the abyss: a tracked collector vacuums nodules and sediment
 *                   off the plain; the nodules go up a riser to the ship, and
 *                   the sediment is the plant's feed.
 *   ReclaimFront    Meridian: the old mine's own tailings dam at the edge of the
 *                   city, a dredge working the pond, and a floating line ashore.
 *   ScoopFront      the last shift: waste piles, loader robots working them, a
 *                   hammer crusher and a scrap magnet, and a belt to the bin.
 *
 * Each is the unit with id 'upstream'. The first two hand their slurry to the
 * pipe bridge at the same riser the grinding circuit uses, so the rest of the
 * site pipework does not change; the scoop has no slurry, and belts its dry
 * feed straight to the bin.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Telemetry } from '../sim/plant';
import { C, metal, matte, glow, glowUnique, liquor } from './palette';
import { box, cyl, tube, strip, platform, ladder, pipeRun, pipeSupport, Beacon } from './parts';
import { flowMaterial, beltMaterial, setFlow, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Unit } from './units';
import { rng, canvasTexture } from './worlds/common';
import { perlin, fbm, Kit } from './worlds/land';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where every slurry front end hands over to the overland pipe bridge. */
export const HANDOVER = V(-84, 15, 0);

/** A riser up to the pipe bridge, with a small pump at its foot. */
function riser(g: THREE.Group, mat: FlowMaterial) {
  const pump = box(2.4, 1.4, 1.8, metal(0x5c6675, 0.45, 0.9));
  pump.position.set(HANDOVER.x - 2.2, 0.7, 0);
  g.add(pump);
  const r = tube(0.4, HANDOVER.y, mat, 14);
  r.position.set(HANDOVER.x, HANDOVER.y / 2, 0);
  g.add(r);
  const s = pipeSupport(HANDOVER.y - 0.4, 2.0);
  s.position.set(HANDOVER.x - 1.4, 0, 0);
  g.add(s);
}

/** A small cluster of deslime cyclones on a stand, for the fronts that have them. */
function deslimeCluster(g: THREE.Group, x: number, z: number): THREE.MeshStandardMaterial[] {
  const mats: THREE.MeshStandardMaterial[] = [];
  const D = 6;
  const plat = platform(8, 8, { y: D, accent: C.lime });
  plat.position.set(x, 0, z);
  g.add(plat);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.MeshStandardMaterial({ color: 0x6b7787, roughness: 0.4, metalness: 0.9, emissive: 0 });
    const c = cyl(0.42, 0.1, 2.4, m, 14);
    c.position.set(x + Math.cos(a) * 1.8, D + 1.6, z + Math.sin(a) * 1.8);
    g.add(c);
    mats.push(m);
  }
  const hub = cyl(0.7, 0.7, 1.2, metal(C.steelLight), 16);
  hub.position.set(x, D + 3.2, z);
  g.add(hub);
  return mats;
}

// =========================================================== THE COLLECTOR

/**
 * A seabed nodule collector: tracks, a wide suction head, a plume skirt. It
 * works a strip of the plain back and forth, dragging its jumper hose, and
 * what it lifts goes to a screen that keeps the nodules and sends the rest -
 * the sediment - to the plant.
 */
export class CollectorFront extends Unit {
  readonly id = 'upstream';
  readonly name = 'Collector & Nodule Screen';

  private collector = new THREE.Group();
  private hose: THREE.Mesh[] = [];
  private headGlow: THREE.MeshStandardMaterial;
  private screenDeck = new THREE.Group();
  private nodules: THREE.InstancedMesh;
  private riserFlow: FlowMaterial;
  private feedFlow: FlowMaterial;
  private liftFlow: FlowMaterial;
  private lights: THREE.MeshStandardMaterial[] = [];
  private cycMats: THREE.MeshStandardMaterial[];
  private plume?: Spout;
  private beacon = new Beacon();
  private s = 0;
  private dir = 1;
  private _w = new THREE.Vector3();

  private readonly LANE_X = -132;
  private readonly SCREEN = V(-106, 0, -10);

  constructor(fx: FX) {
    super('COLLECTOR', 3.0, '#9fe870');
    const g = this.group;
    void fx;

    // ---- worked strips on the plain, lighter where the crust is gone
    const track = matte(0x333a34, 1);
    for (const x of [-150, -144, -138, -126, -120]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 86), track);
      s.rotation.x = -Math.PI / 2;
      s.position.set(x, -0.37, 0);
      g.add(s);
    }

    // ---- the collector itself
    const body = box(8, 3.4, 13, metal(0xd8a23a, 0.5, 0.45));
    body.position.y = 2.6;
    this.collector.add(body);
    for (const x of [-4.6, 4.6]) {
      const tr = box(1.8, 1.8, 14, matte(0x1a1f24, 0.9));
      tr.position.set(x, 0.9, 0);
      this.collector.add(tr);
      for (let k = -6; k <= 6; k += 1.5) {
        const lug = box(1.9, 0.2, 0.3, matte(0x2c3238, 0.9));
        lug.position.set(x, 1.85, k);
        this.collector.add(lug);
      }
    }
    // the suction head: a wide hood across the front, glowing where it bites
    const head = box(11, 1.4, 2.4, metal(0x3c4652, 0.5, 0.8));
    head.position.set(0, 0.8, 7.8);
    this.collector.add(head);
    this.headGlow = glowUnique(C.cyan, 1.5);
    const slit = box(10.4, 0.16, 0.2, this.headGlow);
    slit.position.set(0, 0.12, 8.9);
    this.collector.add(slit);
    const skirt = box(11.6, 0.9, 0.3, matte(0x1a1f24, 0.8));
    skirt.position.set(0, 0.45, 9.2);
    this.collector.add(skirt);
    // buoyancy, lamps, a mast for the umbilical
    const float = box(6, 1.4, 9, matte(0xe0b830, 0.7));
    float.position.set(0, 5, -1);
    this.collector.add(float);
    for (const x of [-3.2, 3.2]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glow(0xfff0c8, 3.2));
      lamp.position.set(x, 3.4, 6.6);
      this.collector.add(lamp);
    }
    const light = new THREE.PointLight(0xffe6b0, 70, 40, 2);
    light.position.set(0, 4, 10);
    this.collector.add(light);
    this.collector.userData.noCollide = true;
    g.add(this.collector);

    // ---- the jumper hose, re-laid each frame between collector and screen
    const hoseMat = matte(0x2a3036, 0.8);
    for (let i = 0; i < 18; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1, 10), hoseMat);
      seg.userData.noCollide = true;
      g.add(seg);
      this.hose.push(seg);
    }

    // ---- the nodule screen
    const S = this.SCREEN;
    for (const [dx, dz] of [[-4, -2], [4, -2], [-4, 2], [4, 2]] as const) {
      const leg = box(0.4, 5, 0.4, metal(C.steel));
      leg.position.set(S.x + dx, 2.5, S.z + dz);
      g.add(leg);
    }
    const deckFrame = box(10, 0.4, 5, metal(C.steelDark));
    deckFrame.rotation.z = -0.12;
    this.screenDeck.add(deckFrame);
    for (const z of [-2.4, 2.4]) {
      const side = box(10, 1.2, 0.2, metal(0x5a6779));
      side.position.set(0, 0.6, z);
      side.rotation.z = -0.12;
      this.screenDeck.add(side);
    }
    this.screenDeck.position.set(S.x, 5.4, S.z);
    g.add(this.screenDeck);
    this.nodules = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.28, 0), matte(0x2a2218, 0.85), 60,
    );
    this.nodules.frustumCulled = false;
    g.add(this.nodules);

    // ---- the riser to the ship: straight up into the dark, lit as it goes
    this.riserFlow = flowMaterial(0x3a2e22, { density: bandsFor(260), intensity: 1.2 });
    const rs = tube(0.7, 260, this.riserFlow, 16);
    rs.position.set(S.x + 6, 130 + 5, S.z - 4);
    g.add(rs);
    for (let y = 18; y < 260; y += 24) {
      const m = glowUnique(C.red, 2.4);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), m);
      l.position.set(S.x + 6.9, y, S.z - 4);
      g.add(l);
      this.lights.push(m);
      if (y % 72 === 18) {
        const buoy = cyl(1.8, 1.8, 3.4, matte(0xe0b830, 0.7), 16);
        buoy.position.set(S.x + 6, y, S.z - 4);
        g.add(buoy);
      }
    }
    const neck = box(2.4, 5, 2.4, metal(C.steelDark));
    neck.position.set(S.x + 6, 3.6, S.z - 4);
    g.add(neck);

    // ---- deslime cyclones, and the sediment on to the pipe bridge
    this.cycMats = deslimeCluster(g, -90, 12);
    this.feedFlow = flowMaterial(C.tails, { density: bandsFor(30), intensity: 1.4 });
    g.add(pipeRun([V(S.x + 5, 4, S.z + 1), V(-96, 4, 4), V(-92, 8, 10), V(-90, 9.8, 12)], 0.34, this.feedFlow).group);
    this.liftFlow = flowMaterial(C.tails, { density: bandsFor(20), intensity: 1.4 });
    g.add(pipeRun([V(-90, 5.4, 12), V(-88, 1.2, 8), V(-86.4, 1.2, 1), V(HANDOVER.x - 1.2, 1.2, 0)], 0.3, this.liftFlow).group);
    riser(g, this.liftFlow);

    this.beacon.group.position.set(S.x - 6, 0, S.z + 4);
    g.add(this.beacon.group);

    this.focus.set(-118, 4, 0);
    this.viewOffset = new THREE.Vector3(-4, 28, 60);
    this.tag.group.position.set(-118, 16, 0);
    g.add(this.tag.group);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const u = t.upstream;
    const live = t.status !== 'idle' && t.status !== 'blocked';
    const rate = clamp01(t.feed.solids / 200);

    // work the strip back and forth
    if (live) {
      this.s += this.dir * dt * (1.5 + rate * 3);
      if (this.s > 34) this.dir = -1;
      if (this.s < -34) this.dir = 1;
    }
    this.collector.position.set(this.LANE_X, 0, this.s);
    this.collector.rotation.y = this.dir > 0 ? 0 : Math.PI;
    this.headGlow.emissiveIntensity = live ? 1.6 + Math.sin(t.time * 8) * 0.5 : 0.2;

    // the hose: a sagging curve from the back of the collector to the screen
    const a = V(this.LANE_X, 4.5, this.s - this.dir * 6);
    const b = V(this.SCREEN.x - 5, 6, this.SCREEN.z);
    const mid = a.clone().lerp(b, 0.5).add(V(0, 9, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const pts = curve.getPoints(this.hose.length);
    for (let i = 0; i < this.hose.length; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const seg = this.hose[i];
      seg.position.copy(p0).lerp(p1, 0.5);
      seg.scale.y = p0.distanceTo(p1) + 0.1;
      seg.quaternion.setFromUnitVectors(V(0, 1, 0), p1.clone().sub(p0).normalize());
    }

    // nodules rattling down the screen
    const m = new THREE.Matrix4();
    const n = live ? 60 : 0;
    this.nodules.count = n;
    for (let i = 0; i < n; i++) {
      const k = (i / 60 + t.time * 0.05) % 1;
      m.makeTranslation(this.SCREEN.x - 4.5 + k * 9, 6.2 - k * 1.1 + Math.sin(t.time * 30 + i) * 0.05,
        this.SCREEN.z + ((i * 37) % 9) / 2.2 - 2);
      this.nodules.setMatrixAt(i, m);
    }
    this.nodules.instanceMatrix.needsUpdate = true;
    this.screenDeck.position.y = 5.4 + (live ? Math.sin(t.time * 40) * 0.04 : 0);

    // the sediment cloud the head kicks up - the thing the regulator watches
    this.plume ??= new Spout(fx.haze, 8, (at) => ({
      at, count: 0,
      velocity: V(0, 0.6, 0), spread: V(1.4, 0.4, 1.4), jitter: V(4, 0.3, 1),
      colour: 0x7a7060, size: 1.6, sizeVary: 0.5, life: 5, gravity: 0, drag: 0.6, grow: 2.4,
    }));
    this._w.set(this.LANE_X, 0.8, this.s + this.dir * 9);
    this.plume.run(dt, live ? 0.6 : 0, this._w);

    const on = u.deslimeSplit < 0.999 && live;
    for (const c of this.cycMats) {
      c.emissive.setHex(on ? C.lime : 0);
      c.emissiveIntensity = on ? 0.1 : 0;
    }
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].emissiveIntensity = Math.sin(t.time * 2 - i * 0.6) > 0.6 ? 3 : 0.4;
    }
    setFlow(this.riserFlow, live ? -2.4 : 0);
    setFlow(this.feedFlow, live ? 1.8 : 0);
    setFlow(this.liftFlow, live ? 1.7 : 0);
    const short = u.solids < u.plantCapacity * 0.92;
    this.beacon.set(short ? C.amber : live ? C.lime : C.cyan, 2.2);
    this.tag.set(
      u.concentrate.toFixed(0) + ' t/h',
      'nodules up  ·  ' + u.solids.toFixed(0) + ' t/h sediment to the plant',
      short ? 'warn' : 'ok',
    );
  }
}

// ============================================================= THE OLD DAM

/**
 * The old mine's tailings dam, at the edge of the city: an embankment, a pond
 * that is the wrong colour, a tailings beach, and a cutter-suction dredge
 * working the deposit back out on a floating line.
 */
export class ReclaimFront extends Unit {
  readonly id = 'upstream';
  readonly name = 'Old Tailings Dam';

  private dredge = new THREE.Group();
  private cutter = new THREE.Group();
  private pondMat: THREE.MeshStandardMaterial;
  private lineFlow: FlowMaterial;
  private liftFlow: FlowMaterial;
  private cycMats: THREE.MeshStandardMaterial[];
  private floats: THREE.Mesh[] = [];
  private beacon = new Beacon();

  private readonly C = V(-128, 0, -6);
  private readonly CREST = 7;

  constructor(_fx: FX) {
    super('OLD DAM', 3.0, '#9fe870');
    const g = this.group;
    const c = this.C, H = this.CREST;

    // Embankment: a square frustum, turned so its faces line up with the axes,
    // then stretched to the footprint. The pond sits in its top.
    const W = 58, D = 50, SLOPE = 12;
    // Turned BEFORE it is stretched: stretch a diamond and then turn it, and
    // what you get is a rhombus.
    const embGeo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * ((W + SLOPE) / W), 1, 4, 1);
    embGeo.rotateY(Math.PI / 4);
    embGeo.scale(W, H, D);
    const emb = new THREE.Mesh(embGeo, matte(0x5a5446, 0.95));
    emb.position.set(c.x, H / 2 - 0.4, c.z);
    g.add(emb);

    this.pondMat = new THREE.MeshStandardMaterial({
      color: 0x2f9a7a, emissive: 0x1a6a54, emissiveIntensity: 0.5,
      roughness: 0.15, metalness: 0.2,
    });
    const pond = new THREE.Mesh(new THREE.PlaneGeometry(W - 12, D - 16), this.pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(c.x + 2, H - 0.3, c.z + 2);
    g.add(pond);
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(W - 6, 8), matte(0xb3a58a, 1));
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(c.x, H - 0.2, c.z - D / 2 + 8);
    g.add(beach);
    const crest = strip(W, 0x9fe870, 0.08, 1.2);
    crest.position.set(c.x, H + 0.05, c.z + D / 2);
    g.add(crest);

    // a decant tower, abandoned
    const tower = cyl(1.2, 1.4, 6, matte(0x4a4a44, 0.9), 12);
    tower.position.set(c.x - 16, H + 1.4, c.z + 8);
    g.add(tower);

    // ---- the dredge
    const pontoon = box(9, 1.4, 5.4, metal(0xd8a23a, 0.5, 0.5));
    pontoon.position.y = 0.2;
    this.dredge.add(pontoon);
    const cabin = box(3, 2.6, 3.4, metal(0x3c4652, 0.5, 0.7));
    cabin.position.set(-2, 2.1, 0);
    this.dredge.add(cabin);
    const win = box(0.1, 0.8, 2.8, glow(0x9fe8ff, 1.8));
    win.position.set(-0.45, 2.6, 0);
    this.dredge.add(win);
    const aFrame = box(0.3, 5, 0.3, metal(C.steelLight));
    aFrame.position.set(3.4, 2.8, 0);
    this.dredge.add(aFrame);
    const ladderBar = box(9, 0.5, 0.8, metal(C.steelDark));
    ladderBar.position.set(6.6, -0.8, 0);
    ladderBar.rotation.z = -0.4;
    this.cutter.add(ladderBar);
    const head = cyl(0.9, 0.6, 1.6, metal(0x8c97a6, 0.4, 0.9), 10);
    head.rotation.z = Math.PI / 2;
    head.position.set(10.6, -2.6, 0);
    this.cutter.add(head);
    this.dredge.add(this.cutter);
    const lamp = new THREE.PointLight(0xffe6b0, 40, 30, 2);
    lamp.position.set(2, 5, 0);
    this.dredge.add(lamp);
    for (const sp of [-3.8, -2.6]) {
      const spud = cyl(0.25, 0.25, 8, metal(C.steelLight), 8);
      spud.position.set(sp, 2, sp < -3 ? 1.8 : -1.8);
      this.dredge.add(spud);
    }
    this.dredge.position.set(c.x - 6, H - 0.1, c.z + 6);
    g.add(this.dredge);

    // floating line to the east crest, then down the face and ashore
    for (let i = 0; i < 10; i++) {
      const f = cyl(0.55, 0.55, 1.4, matte(0xe0b830, 0.7), 10);
      f.rotation.z = Math.PI / 2;
      f.userData.noCollide = true;
      g.add(f);
      this.floats.push(f);
    }
    this.lineFlow = flowMaterial(C.tails, { density: bandsFor(60), intensity: 1.4 });
    g.add(pipeRun([
      V(c.x + W / 2 - 4, H + 0.6, c.z + 6), V(c.x + W / 2 + 2, H + 0.4, c.z + 6),
      V(c.x + W / 2 + 8, 1.2, c.z + 6), V(-96, 1.2, 8), V(-92, 8, 12), V(-90, 9.8, 12),
    ], 0.36, this.lineFlow).group);

    this.cycMats = deslimeCluster(g, -90, 12);
    this.liftFlow = flowMaterial(C.tails, { density: bandsFor(20), intensity: 1.4 });
    g.add(pipeRun([V(-90, 5.4, 12), V(-88, 1.2, 8), V(-86.4, 1.2, 1), V(HANDOVER.x - 1.2, 1.2, 0)], 0.3, this.liftFlow).group);
    riser(g, this.liftFlow);

    // a sign, since this is still somebody's asset
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 4),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(512, 146, (gx, Wd, Ht) => {
          gx.fillStyle = '#12060e';
          gx.fillRect(0, 0, Wd, Ht);
          gx.strokeStyle = '#9fe870';
          gx.lineWidth = 5;
          gx.strokeRect(6, 6, Wd - 12, Ht - 12);
          gx.fillStyle = '#9fe870';
          gx.textAlign = 'center';
          gx.font = '800 44px "Arial Black", Impact, sans-serif';
          gx.fillText('RECLAMATION IN PROGRESS', Wd / 2, Ht * 0.5);
          gx.font = '500 22px ui-monospace, monospace';
          gx.fillText('do not swim · do not drink · do not ask', Wd / 2, Ht * 0.82);
        }),
      }),
    );
    sign.position.set(c.x, H + 3.2, c.z + D / 2 + 6.5);
    g.add(sign);
    for (const dx of [-6, 6]) {
      const post = box(0.3, H + 1.6, 0.3, metal(C.steel));
      post.position.set(c.x + dx, (H + 1.6) / 2, c.z + D / 2 + 6.4);
      g.add(post);
    }

    this.beacon.group.position.set(c.x + W / 2 + 4, 0, c.z - 6);
    g.add(this.beacon.group);

    this.focus.set(c.x, H, c.z);
    this.viewOffset = new THREE.Vector3(-6, 34, 64);
    this.tag.group.position.set(c.x, H + 12, c.z);
    g.add(this.tag.group);
  }

  update(t: Telemetry, dt: number) {
    const u = t.upstream;
    const live = t.status !== 'idle' && t.status !== 'blocked';
    const H = this.CREST, c = this.C;
    // the dredge swings across the face on its spuds
    const swing = Math.sin(t.time * 0.05) * 0.5;
    this.dredge.rotation.y = swing;
    this.dredge.position.y = H - 0.1 + Math.sin(t.time * 1.3) * 0.06;
    this.cutter.children[1].rotation.x += dt * (live ? 3 : 0);
    // floats between the dredge stern and the crest
    const a = this.dredge.position.clone().add(V(-4.5 * Math.cos(swing), 0.4, 4.5 * Math.sin(swing)));
    const b = V(c.x + 58 / 2 - 4, H + 0.4, c.z + 6);
    this.floats.forEach((f, i) => {
      const k = (i + 0.5) / this.floats.length;
      f.position.lerpVectors(a, b, k);
      f.position.y = H - 0.05 + Math.sin(t.time * 1.5 + i) * 0.05;
    });
    this.pondMat.emissiveIntensity = 0.4 + Math.sin(t.time * 0.3) * 0.08;
    const on = u.deslimeSplit < 0.999 && live;
    for (const m of this.cycMats) {
      m.emissive.setHex(on ? C.lime : 0);
      m.emissiveIntensity = on ? 0.1 : 0;
    }
    setFlow(this.lineFlow, live ? 1.9 : 0);
    setFlow(this.liftFlow, live ? 1.7 : 0);
    const short = u.solids < u.plantCapacity * 0.92;
    this.beacon.set(short ? C.amber : live ? C.lime : C.cyan, 2.2);
    this.tag.set(
      u.solids.toFixed(0) + ' t/h',
      'reclaimed  ·  ' + u.sulphide.toFixed(2) + '% S',
      u.sulphide > 0.9 && u.binder.sulphate > 0.15 ? 'warn' : 'ok',
    );
  }
}

// ============================================================== THE PILES

interface Loader { g: THREE.Group; bucket: THREE.Group; pile: number; phase: number; speed: number }

/**
 * Waste piles, the loaders that work them, and a hammer crusher with a scrap
 * magnet over its belt. There is no slurry anywhere on this site: the crushed
 * waste goes to the bin on a belt, dry.
 *
 * The crusher is as old-fashioned as it looks: a flywheel on a flat belt off
 * the motor, turning at whatever the rotor is set to, and a grate under the
 * hammers whose bars open and close with its setting. Choke it and the
 * hopper heaps up while the loaders wait.
 */
export class ScoopFront extends Unit {
  readonly id = 'upstream';
  readonly name = 'Loaders & Crusher';

  private loaders: Loader[] = [];
  private rotor = new THREE.Group();
  private pulley = new THREE.Group();
  private driveBelt: FlowMaterial;
  private bars: THREE.Mesh[] = [];
  private heap: THREE.Mesh;
  private magnet: THREE.MeshStandardMaterial;
  private belt: FlowMaterial;
  private lumps: THREE.Mesh[] = [];
  private dust?: Spout;
  private beacon = new Beacon();
  private piles: THREE.Vector3[] = [];

  /** the crusher's hopper, and where the belt ends over the bin */
  private readonly HOP = V(-44, 0, 0);
  private beltFrom = V(-38, 3.4, 0);
  private beltTo = V(0.4, 7.2, 0);

  constructor(_fx: FX, binX = 2) {
    super('CRUSHER', 3.0, '#e8b13a');
    const g = this.group;
    const r = rng(61);
    this.beltTo = V(binX - 1.6, 7.2, 0);

    // ---- the piles: rounded heaps of everything that got thrown away, lumpy
    // all over, speckled with it, and with the bigger pieces sticking out
    const JUNK = [0x6a5238, 0x5a4a3a, 0x6e5a44, 0x4e4a44, 0x6e6a5a, 0x7a6a58, 0x3e3a36];
    const BITS = [0x8a4a3a, 0x4a6a8a, 0x6a8a5a, 0xa08a4a, 0x9a9a92];
    const heapMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.1 });
    const lump = perlin(61);
    const c = new THREE.Color();
    // the junk in them, merged by material: four draw calls, not a hundred
    const junk = new Kit();
    const junkMats = [metal(0x7a5a3a, 0.8, 0.4), metal(0x5a6068, 0.8, 0.4), metal(0x6a4a3a, 0.8, 0.4)];
    const tyre = matte(0x222020, 0.9);
    const jm = new THREE.Matrix4(), jq = new THREE.Quaternion(), je = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    for (const [x, z, R, h] of [
      [-122, -26, 12, 9], [-104, 22, 10, 7], [-140, 12, 14, 10], [-88, -30, 9, 6],
      [-126, 36, 8, 5], [-150, -14, 11, 8], [-96, 40, 7, 5],
    ] as const) {
      let geo: THREE.BufferGeometry = new THREE.CylinderGeometry(0.01, R, h, 40, 10, true);
      geo.deleteAttribute('uv');
      geo.deleteAttribute('normal');
      geo = mergeVertices(geo);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + h / 2) / h;
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        // a heap, not a cone: round-shouldered, a tip-head of lumps all over
        const n = fbm(lump, Math.cos(a) * 2.2 + x * 0.1, Math.sin(a) * 2.2 + t * 3 + z * 0.1, 3);
        const rad = R * Math.sqrt(Math.max(0, 1 - t)) * (1 + 0.22 * n);
        pos.setXYZ(i, Math.cos(a) * rad, (t + 0.06 * n * (1 - t)) * h - h / 2, Math.sin(a) * rad);
        c.setHex(r() < 0.12 ? BITS[Math.floor(r() * BITS.length)] : JUNK[Math.floor(r() * JUNK.length)]);
        c.multiplyScalar(0.55 + 0.45 * Math.min(1, t * 3) + (r() - 0.5) * 0.15);
        col.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const pile = new THREE.Mesh(geo, heapMat);
      pile.position.set(x, h / 2 - 0.4, z);
      pile.castShadow = pile.receiveShadow = true;
      g.add(pile);
      this.piles.push(V(x, 0, z));
      // what sticks out of it: crates, drums, tyres, sheet
      for (let k = 0; k < 18; k++) {
        const a = r() * Math.PI * 2, rr = R * (0.15 + r() * 0.75);
        const kind = r();
        const mat = junkMats[Math.floor(r() * junkMats.length)];
        const geo = kind < 0.45 ? new THREE.BoxGeometry(0.4 + r() * 1.6, 0.3 + r() * 1.2, 0.4 + r() * 1.4)
          : kind < 0.7 ? new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10)
          : kind < 0.85 ? new THREE.TorusGeometry(0.42, 0.17, 5, 10)
          : new THREE.BoxGeometry(2 + r(), 0.06, 1 + r());
        jm.compose(
          new THREE.Vector3(x + Math.cos(a) * rr, h * (1 - (rr / R) ** 2) * 0.95 - 0.4, z + Math.sin(a) * rr),
          jq.setFromEuler(je.set(r() * 3, r() * 3, r() * 3)), one,
        );
        geo.applyMatrix4(jm);
        junk.add(kind >= 0.7 && kind < 0.85 ? tyre : mat, geo);
      }
    }
    junk.build(g);

    // ---- the crusher: hopper, hammer mill, motor and flywheel
    const H = this.HOP;
    const frame = platform(10, 8, { y: 6, accent: C.amber });
    frame.position.set(H.x, 0, H.z);
    g.add(frame);
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 1.4, 4, 4), metal(0x5a6068, 0.6, 0.7));
    hopper.rotation.y = Math.PI / 4;
    hopper.position.set(H.x, 8.2, H.z);
    g.add(hopper);
    const mill = box(5, 3.6, 4.4, metal(0x4a5260, 0.5, 0.85));
    mill.position.set(H.x, 3.6, H.z);
    g.add(mill);
    // what the loaders have tipped and the crusher has not yet taken
    this.heap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1, 10), matte(0x6a5238, 1));
    this.heap.position.set(H.x, 7.2, H.z);
    this.heap.userData.noCollide = true;
    g.add(this.heap);

    // The flywheel: plain steel spokes, a rim, and one painted spoke so you
    // can see it turn.
    const fly = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.18, 8, 28), metal(0x8c97a6, 0.4, 0.9));
    this.rotor.add(fly);
    const boss = cyl(0.35, 0.35, 0.5, metal(C.steelLight), 12);
    boss.rotation.x = Math.PI / 2;
    this.rotor.add(boss);
    for (let k = 0; k < 6; k++) {
      const spoke = box(1.45, 0.14, 0.14, k ? metal(0x8c97a6, 0.4, 0.9) : glow(C.amber, 1.4));
      const a = (k * Math.PI) / 3;
      spoke.position.set(Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0);
      spoke.rotation.z = a;
      this.rotor.add(spoke);
    }
    this.rotor.position.set(H.x, 3.6, H.z + 2.5);
    this.rotor.userData.noCollide = true;
    g.add(this.rotor);

    // The motor, on its own base, driving the flywheel on a flat belt.
    const MX = H.x - 5.2, MY = 1.3, MZ = H.z + 2.5;
    const mbase = box(2.4, 0.4, 2.0, metal(C.steelDark));
    mbase.position.set(MX, 0.2, MZ - 0.9);
    g.add(mbase);
    const motor = cyl(0.8, 0.8, 1.9, metal(0x3c4a5c, 0.45, 0.9), 18);
    motor.rotation.x = Math.PI / 2;
    motor.position.set(MX, MY, MZ - 1.1);
    g.add(motor);
    const pul = cyl(0.55, 0.55, 0.5, metal(0x8c97a6, 0.4, 0.9), 18);
    pul.rotation.x = Math.PI / 2;
    this.pulley.add(pul);
    const mark = box(0.5, 0.1, 0.52, glow(C.amber, 1.4));
    mark.position.x = 0.25;
    this.pulley.add(mark);
    this.pulley.position.set(MX, MY, MZ);
    this.pulley.userData.noCollide = true;
    g.add(this.pulley);
    this.driveBelt = beltMaterial(0x2a2622);
    for (const side of [1, -1]) {
      const a = V(MX, MY + side * 0.55, MZ), b = V(H.x, 3.6 + side * 1.6, MZ);
      const run = box(a.distanceTo(b), 0.06, 0.42, this.driveBelt);
      run.position.copy(a).lerp(b, 0.5);
      run.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      run.userData.noCollide = true;
      g.add(run);
    }

    // the grate under the hammers, its bars as far apart as it is set
    for (let i = 0; i < 9; i++) {
      const bar = box(0.14, 0.16, 4.0, metal(0x5a6068, 0.55, 0.8));
      bar.position.set(H.x, 1.62, H.z);
      this.bars.push(bar);
      g.add(bar);
    }

    // ---- the belt to the bin, with the scrap magnet hung over it
    const from = this.beltFrom, to = this.beltTo;
    const span = from.distanceTo(to);
    const conv = new THREE.Group();
    this.belt = beltMaterial(0x6a5a44);
    const bm = box(span, 0.12, 1.4, this.belt);
    bm.position.y = 0.4;
    conv.add(bm);
    const fr = box(span, 0.24, 1.8, metal(C.steelDark));
    conv.add(fr);
    for (let i = 0; i < 16; i++) {
      const lump = box(0.5, 0.25, 0.6, matte(0x6a5238, 0.95));
      lump.position.set(-span / 2 + (span * i) / 16, 0.6, (r() - 0.5) * 0.6);
      conv.add(lump);
      this.lumps.push(lump);
    }
    conv.position.copy(from).lerp(to, 0.5);
    conv.rotation.z = Math.atan2(to.y - from.y, to.x - from.x);
    g.add(conv);
    for (let k = 1; k < 5; k++) {
      const p = from.clone().lerp(to, k / 5);
      const leg = box(0.26, p.y, 0.26, metal(C.steel));
      leg.position.set(p.x, p.y / 2, 0);
      g.add(leg);
    }
    this.magnet = glowUnique(0x5aa8ff, 1.6);
    const mag = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 24), this.magnet);
    const magAt = from.clone().lerp(to, 0.18);
    mag.position.set(magAt.x, magAt.y + 2.4, 0);
    g.add(mag);
    const gantry = box(0.3, magAt.y + 3, 0.3, metal(C.steelLight));
    gantry.position.set(magAt.x, (magAt.y + 3) / 2, -2);
    g.add(gantry);
    const arm = box(0.3, 0.3, 2.2, metal(C.steelLight));
    arm.position.set(magAt.x, magAt.y + 3, -1);
    g.add(arm);
    const scrap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.2, 8), metal(0x6a6e74, 0.5, 0.8));
    scrap.position.set(magAt.x, 0.2, -3.2);
    g.add(scrap);

    // ---- the loaders, which are also the only staff
    for (let i = 0; i < 3; i++) {
      const lg = new THREE.Group();
      const body = box(3.2, 1.8, 2.4, metal(0xc89a3a, 0.55, 0.45));
      body.position.y = 1.3;
      lg.add(body);
      const cab = box(1.4, 1.2, 1.8, metal(0x3c4652, 0.5, 0.7));
      cab.position.set(-0.6, 2.8, 0);
      lg.add(cab);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glow(0x9fe870, 2.4));
      eye.position.set(0.12, 2.9, 0);
      lg.add(eye);
      for (const z of [-1.1, 1.1]) {
        const tr = box(3.4, 0.8, 0.6, matte(0x1a1f24, 0.9));
        tr.position.set(0, 0.4, z);
        lg.add(tr);
      }
      const bucket = new THREE.Group();
      const bk = box(1.2, 1.0, 2.6, metal(0x6a6e74, 0.6, 0.7));
      bk.position.set(0.6, 0, 0);
      bucket.add(bk);
      bucket.position.set(1.8, 0.8, 0);
      lg.add(bucket);
      lg.userData.noCollide = true;
      g.add(lg);
      this.loaders.push({ g: lg, bucket, pile: i * 2, phase: i * 0.33, speed: 0.045 + i * 0.008 });
    }

    this.beacon.group.position.set(H.x - 6, 0, H.z - 5);
    g.add(this.beacon.group);

    this.focus.set(-90, 4, 0);
    this.viewOffset = new THREE.Vector3(-10, 36, 70);
    this.tag.group.position.set(H.x, 16, H.z);
    g.add(this.tag.group);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const u = t.upstream;
    const live = t.status !== 'idle' && t.status !== 'blocked';
    const feeding = t.filter.throughput > 0.5;
    // a real flywheel at 1,000 rpm is a blur, so this is a tenth of it
    const spin = live ? (u.rotor / 60) * Math.PI * 2 * 0.1 : 0.2;
    this.rotor.rotation.z -= dt * spin;
    this.pulley.rotation.z -= dt * spin * (1.6 / 0.55);
    setFlow(this.driveBelt, live ? spin * 1.2 : 0);
    const gap = 0.26 + 0.05 * (u.grate || 4);
    for (let i = 0; i < this.bars.length; i++) {
      this.bars[i].position.x = this.HOP.x + (i - (this.bars.length - 1) / 2) * gap;
    }
    // when the grate is what limits it, the hopper heaps up and the loaders wait
    const choked = live && u.crushed >= u.crusherCap - 1;
    this.heap.scale.y = choked ? 2.8 : 0.2;
    this.heap.position.y = 6.4 + this.heap.scale.y / 2;
    this.magnet.emissiveIntensity = live ? 0.6 + 1.6 * u.sulphideRecovery + Math.sin(t.time * 3) * 0.3 : 0.3;
    setFlow(this.belt, feeding ? 1.9 : 0);
    const span = this.beltFrom.distanceTo(this.beltTo);
    for (const l of this.lumps) {
      if (feeding) l.position.x += dt * 2.6;
      if (l.position.x > span / 2) l.position.x = -span / 2;
      l.visible = feeding;
    }

    // loaders: out to a pile, scoop, back to the hopper, dump
    for (const L of this.loaders) {
      if (live) L.phase = (L.phase + dt * L.speed * (choked ? 0.35 : 1)) % 1;
      const pile = this.piles[L.pile % this.piles.length];
      const hop = V(this.HOP.x - 7, 0, this.HOP.z + (L.pile % 2 ? 4 : -4));
      const toPile = pile.clone().add(hop.clone().sub(pile).normalize().multiplyScalar(11));
      let p: THREE.Vector3, face: THREE.Vector3, bucketUp = 0;
      const ph = L.phase;
      if (ph < 0.4) { p = hop.clone().lerp(toPile, ph / 0.4); face = toPile.clone().sub(hop); }
      else if (ph < 0.5) { p = toPile; face = pile.clone().sub(toPile); bucketUp = (ph - 0.4) / 0.1; }
      else if (ph < 0.9) { p = toPile.clone().lerp(hop, (ph - 0.5) / 0.4); face = hop.clone().sub(toPile); bucketUp = 1; }
      else { p = hop; face = V(1, 0, 0); bucketUp = 1 + (ph - 0.9) * 20; }
      L.g.position.copy(p);
      L.g.rotation.y = Math.atan2(-face.z, face.x);
      L.bucket.position.y = 0.8 + Math.min(bucketUp, 1) * 1.6;
      L.bucket.rotation.z = ph >= 0.9 ? -1.1 : ph >= 0.4 ? 0.35 : 0;
      if (ph >= 0.9 && !live) L.phase = 0.9;
    }

    this.dust ??= new Spout(fx.haze, 6, (at) => ({
      at, count: 0, velocity: V(0.4, 0.5, 0), spread: V(0.6, 0.3, 0.6), jitter: V(2, 0.5, 2),
      colour: 0x9a8060, size: 1.4, sizeVary: 0.5, life: 3.5, gravity: 0.05, drag: 0.5, grow: 2.2,
    }));
    this.dust.run(dt, live ? 0.7 : 0, V(this.HOP.x, 9, this.HOP.z));

    const worn = t.media.health < 0.9;
    this.beacon.set(worn ? C.amber : live ? C.lime : C.cyan, 2.2);
    this.tag.set(
      u.p80.toFixed(0) + ' µm',
      'crushed  ·  hammers ' + (t.media.health * 100).toFixed(0) + '%',
      worn ? 'warn' : 'ok',
    );
  }
}

export { liquor, ladder };
