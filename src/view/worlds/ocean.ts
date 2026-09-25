/**
 * The Clarion-Clipperton Zone, 4,400 m down: the seafloor line and the furrow
 * the paste goes three kilometres across the plain to fill. The plain itself,
 * and the water over it, are seafloor.ts.
 */
import * as THREE from 'three';
import type { Telemetry } from '../../sim/plant';
import { DESIGN } from '../../sim/plant';
import type { Names } from '../../scenario';
import { C, metal, matte, glowUnique } from '../palette';
import { box, tube, strip } from '../parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from '../flow';
import { Unit } from '../units';
import { rng, clamp01 } from './common';

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
    this.fill.userData.noCollide = true;
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
    this.crawler.userData.noCollide = true;
    g.add(this.crawler);

    // ---- furrows 1 to 6, already put back: paste under a first drape of
    // sediment, the older the more of it, and the first animals moving in -
    // sponges and xenophyophores, white and pale brown
    const r = rng(41);
    const paste = new THREE.Color(0x8e8a7c), silt = new THREE.Color(0x9a8a6c);
    const life = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 500,
    );
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const tint = new THREE.Color();
    const tints = [0xe8e4dc, 0xb8a88a, 0xd8c8b8, 0xa89a80];
    let n = 0;
    for (const [z, k] of [[-19, 6], [-33, 5], [19, 4], [33, 3], [-47, 2], [47, 1]] as const) {
      const age = (7 - k) / 6;
      const band = new THREE.Mesh(new THREE.PlaneGeometry(L, W), matte(paste.clone().lerp(silt, age * 0.8).getHex(), 1));
      band.rotation.x = -Math.PI / 2;
      band.position.set(cx, -0.38, z);
      band.receiveShadow = true;
      g.add(band);
      // the older the furrow, the more has moved back in
      for (let i = 0; i < 20 + (7 - k) * 18 && n < 500; i++) {
        const k2 = 0.6 + 1.4 * r() * r();
        q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3));
        m4.compose(p.set(FURROW.x0 + r() * L, -0.38 + 0.04 * k2, z + (r() - 0.5) * W * 0.9), q, s.set(k2, k2 * 0.7, k2));
        life.setMatrixAt(n, m4);
        life.setColorAt(n++, tint.setHex(tints[Math.floor(r() * tints.length)]));
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

