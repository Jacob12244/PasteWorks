/**
 * Earth, long after: the fill line and the craters of the last war, which
 * the plant fills one at a time with the waste they left behind. The world
 * round them - the dust, the towers of compacted rubbish, the dead city - is
 * wasteland.ts.
 */
import * as THREE from 'three';
import type { Telemetry } from '../../sim/plant';
import { DESIGN } from '../../sim/plant';
import type { Names } from '../../scenario';
import { C, matte, glowUnique, glow } from '../palette';
import { cyl, tube, pipeSupport, flange } from '../parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from '../flow';
import { Unit } from '../units';
import { rng, clamp01 } from './common';

/** Crater 4: a bowl 22 m across the radius and 12 m deep, which holds 6,082 m3. */
export const CRATER = { x: 88, z: 0, R: 22, H: 12 };
/** The rest of the field, [x, z, radius]: the ones already filled and greening... */
export const FILLED_CRATERS = [[54, -48, 12], [128, 34, 14], [146, -30, 10], [70, 52, 9]] as const;
/** ...and the ones still to do, which the ground itself is dug out for. */
export const OPEN_CRATERS = [[170, 60, 16], [110, 78, 11], [190, -14, 13], [160, -70, 18]] as const;
export const CRATER_HOLE: [number, number, number, number] = [
  CRATER.x - CRATER.R, CRATER.x + CRATER.R, CRATER.z - CRATER.R, CRATER.z + CRATER.R,
];
export const GROUND = -0.4;

// ---------------------------------------------------------------- the line

export class FillLine extends Unit {
  readonly id = 'pipeline';
  readonly name: string;
  private mats: FlowMaterial[] = [];
  private tap: THREE.MeshStandardMaterial;

  constructor(startX: number, names: Names) {
    super(names.lineShort, 2.6, '#c08f52');
    this.name = names.line;
    const g = this.group;
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      const mat = flowMaterial(C.paste, { density: bandsFor(len), intensity: 2.0 });
      this.mats.push(mat);
      const m = tube(0.34, len, mat, 16);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
      const f = flange(0.34);
      f.position.copy(b);
      f.quaternion.copy(m.quaternion);
      g.add(f);
    };
    const rimX = CRATER.x - CRATER.R;
    const a = new THREE.Vector3(startX, 2.3, 0);
    const b = new THREE.Vector3(rimX - 4, 2.3, 0);
    const c = new THREE.Vector3(rimX + 0.5, 0.4, 0);
    // down the wall of the bowl, nearly to the bottom
    const k = 0.9;
    const d = new THREE.Vector3(CRATER.x - CRATER.R * (1 - k), GROUND - CRATER.H * k + 0.5, 0);
    seg(a, b); seg(b, c); seg(c, d);
    for (let x = startX + 2; x < b.x; x += 5) {
      const s = pipeSupport(1.9);
      s.position.set(x, 0, 0);
      g.add(s);
    }
    this.tap = glowUnique(C.lime, 2.2);
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.tap);
    t.position.set((a.x + b.x) / 2, 3.1, 0.5);
    g.add(t);

    this.focus.set((startX + rimX) / 2, 2, 0);
    this.viewOffset = new THREE.Vector3(-12, 12, 28);
    this.tag.group.position.set((startX + rimX) / 2, 7.5, 0);
    g.add(this.tag.group);
  }

  update(t: Telemetry) {
    const p = t.pipe;
    const v = p.plugged ? 0 : p.velocity;
    for (const m of this.mats) setFlow(m, v, 1, t.pump.flow > 0.5 ? 1 : 0);
    this.tap.emissive.setHex(p.plugged ? C.red : p.plugRisk > 0.4 ? C.amber : v > 0.1 ? C.lime : C.cyan);
    this.tag.set(
      p.plugged ? 'PLUGGED' : v.toFixed(2) + ' m/s',
      p.gradient.toFixed(1) + ' kPa/m  ' + p.regime,
      p.plugged ? 'trip' : p.plugRisk > 0.4 ? 'warn' : 'ok',
    );
  }
}

// ------------------------------------------------------------- the craters

/**
 * A crater bowl, apex down, open at the top. Built as a cylinder narrowing to
 * a point rather than a cone flipped over: the flipped cone lost one triangle
 * of every quad and rendered as a checkerboard with the sky showing through.
 */
function bowl(R: number, H: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(R, 0.01, H, 48, 6, true);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = GROUND - H / 2;
  return m;
}

export class Craters extends Unit {
  readonly id = 'stope';
  readonly name: string;
  private fill: THREE.Mesh;
  private skin: THREE.Mesh;
  private fillMat: THREE.MeshStandardMaterial;
  private names: Names;

  constructor(names: Names) {
    super(names.destShort, 3.2, '#c08f52');
    this.name = names.dest;
    this.names = names;
    const g = this.group;
    const { x, z, R, H } = CRATER;

    // Crater 4, with a hole in the plain under it
    const scorched = new THREE.MeshStandardMaterial({ color: 0x3e3226, roughness: 1, side: THREE.DoubleSide });
    const b = bowl(R, H, scorched);
    b.position.x = x; b.position.z = z;
    g.add(b);
    // cover the corners of the square hole the plain has round it
    const apron = new THREE.Mesh(new THREE.RingGeometry(R, R * 1.5, 64), matte(0x4e4030, 1));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(x, GROUND + 0.01, z);
    g.add(apron);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.6, 1.3, 8, 64), matte(0x57473a, 1));
    rim.rotation.x = Math.PI / 2;
    rim.scale.z = 0.45;
    rim.position.set(x, GROUND + 0.1, z);
    g.add(rim);

    // the fill: a cone from the bottom up, and a brighter skin on top
    this.fillMat = new THREE.MeshStandardMaterial({
      color: C.paste, emissive: C.paste, emissiveIntensity: 0.18, roughness: 0.85,
    });
    const fg = new THREE.CylinderGeometry(1, 0.01, 1, 48);
    this.fill = new THREE.Mesh(fg, this.fillMat);
    this.fill.userData.noCollide = true;
    g.add(this.fill);
    this.skin = new THREE.Mesh(new THREE.CircleGeometry(1, 48), glowUnique(C.amber, 0.25));
    this.skin.rotation.x = -Math.PI / 2;
    this.skin.userData.noCollide = true;
    g.add(this.skin);

    // the rest of the field: some done and greening; the ones still to do are
    // dug into the ground itself (wasteland.ts)
    const r = rng(83);
    const filled = matte(0x5a5236, 1);
    const sprout = glow(0x9fe870, 1.2);
    for (const [cx, cz, cr] of FILLED_CRATERS) {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(cr, 40), filled);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(cx, GROUND + 0.02, cz);
      g.add(patch);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(cr, 0.6, 6, 40), matte(0x57473a, 1));
      ring.rotation.x = Math.PI / 2;
      ring.scale.z = 0.4;
      ring.position.set(cx, GROUND + 0.05, cz);
      g.add(ring);
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = r() * cr * 0.85;
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 5), sprout);
        s.position.set(cx + Math.cos(a) * d, GROUND + 0.3, cz + Math.sin(a) * d);
        g.add(s);
      }
    }
    // the thing on the rim
    const sprig = new THREE.Group();
    const stem = cyl(0.03, 0.045, 0.6, glow(0x7ad860, 0.8), 6);
    stem.position.y = 0.3;
    sprig.add(stem);
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow(0x8ae870, 1.1));
      leaf.scale.set(1.7, 0.3, 0.8);
      leaf.position.set(s * 0.2, 0.58, 0);
      leaf.rotation.z = s * 0.5;
      sprig.add(leaf);
    }
    const soil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), matte(0x3a2c20, 1));
    sprig.add(soil);
    sprig.position.set(x + 2, GROUND + 0.05, z + R + 1.2);
    g.add(sprig);

    this.focus.set(x, -4, z);
    this.viewOffset = new THREE.Vector3(-34, 30, 46);
    this.tag.group.position.set(x, 10, z);
    g.add(this.tag.group);
  }

  update(t: Telemetry) {
    const s = t.stope;
    const { x, z, R, H } = CRATER;
    // a cone filled from its apex holds (y/H)^3 of itself at depth y
    const k = Math.max(0.02, Math.cbrt(clamp01(s.pct / 100)));
    const h = H * k, r = R * k;
    this.fill.scale.set(r, h, r);
    this.fill.position.set(x, GROUND - H + h / 2, z);
    this.skin.scale.setScalar(r);
    this.skin.position.set(x, GROUND - H + h + 0.02, z);
    this.skin.visible = s.pct > 0.2;
    const q = clamp01(s.avgUcs / (DESIGN.targetUcs * 1.4));
    this.fillMat.color.lerpColors(new THREE.Color(0x6f6350), new THREE.Color(C.paste), q);
    this.fillMat.emissive.copy(this.fillMat.color);
    const ok = s.avgUcs >= DESIGN.targetUcs;
    this.tag.set(
      s.pct.toFixed(1) + '%',
      s.volume.toFixed(0) + ' / ' + DESIGN.stopeVolume + ' m3 ' + this.names.placed,
      s.pct > 1 && !ok ? 'warn' : 'ok',
    );
  }
}
