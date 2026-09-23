import * as THREE from 'three';
import { C } from '../view/palette';
import type { FX } from '../view/particles';
import type { TriangleGrid } from '../view/grid';
import { advance, STEP, type Flying } from './shared/physics';
import { WEAPONS, INTERP_MS, type WeaponId } from './shared/rules';
import type { V3 } from './shared/protocol';

/**
 * Everything in the air, and the mess it leaves.
 *
 * Your own throws fly the moment you let go, on your own clock. Everyone
 * else's are flown on the same delayed clock their avatars are drawn on, so
 * a lump leaves someone's hands when you see them throw it. Both kinds use
 * the room's physics against the same collision world, so a lump splats on
 * the same girder here as it does on the server. The one thing only the
 * server can say is whether it hit a person, and it says when.
 */

interface Lump extends Flying {
  /** server id once known */
  id: number;
  /** our own count, for our own throws */
  seq: number;
  w: WeaponId;
  mine: boolean;
  /** seconds on whichever clock this lump is flown on */
  t: number;
  born: number;
  /** drawn from the gun at first, easing onto the real path */
  ox: number; oy: number; oz: number;
  /** the server's word on where it ended, and when */
  end: { T: number; p: V3; n?: V3; person: boolean } | null;
}

const MAX = 256;
const SPLATS = 420;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

function blobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const dot = (x: number, y: number, r: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.95)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  dot(64, 64, 34);
  // the flicks round the edge that make it a splat and not a dot
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 11; i++) {
    const a = r() * Math.PI * 2, d = 30 + r() * 26;
    dot(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + r() * 9);
    dot(64 + Math.cos(a) * d * 0.6, 64 + Math.sin(a) * d * 0.6, 9 + r() * 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Lumps {
  group = new THREE.Group();
  private flying: Lump[] = [];
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh];
  private splats: THREE.InstancedMesh;
  private splatNext = 0;
  private splatCount = 0;
  private rand = 1;
  /** gravity on a lump this round */
  g = 9.81;
  /** a lump just hit the plant, where */
  onWall: (at: THREE.Vector3, w: WeaponId) => void = () => {};
  /**
   * Whether a stretch of one of our own throws passes through someone as
   * drawn here, and how far along. Only the server can say it counted, but
   * a lump that visibly goes through a person and splats on the wall behind
   * them looks like a miss even when it was a hit.
   */
  people: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number) => number | null = () => null;

  constructor(private grid: TriangleGrid, private fx: FX) {
    this.group.userData.noCollide = true;
    const paste = new THREE.Mesh(
      new THREE.IcosahedronGeometry(WEAPONS[0].radius, 1),
      new THREE.MeshStandardMaterial({ color: C.paste, emissive: C.paste, emissiveIntensity: 0.25, roughness: 0.6 }),
    );
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(WEAPONS[1].radius),
      new THREE.MeshStandardMaterial({ color: 0x7d8793, roughness: 0.9 }),
    );
    this.meshes = ([paste, rock] as THREE.Mesh[]).map((m) => {
      const im = new THREE.InstancedMesh(m.geometry, m.material, MAX);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = true;
      this.group.add(im);
      return im;
    }) as unknown as [THREE.InstancedMesh, THREE.InstancedMesh];

    const mat = new THREE.MeshStandardMaterial({
      map: blobTexture(), transparent: true, depthWrite: false, roughness: 0.7,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, SPLATS);
    this.splats.count = 0;
    this.splats.frustumCulled = false;
    this.splats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPLATS * 3), 3);
    this.group.add(this.splats);
  }

  private random() {
    this.rand = (this.rand * 16807) % 2147483647;
    return this.rand / 2147483647;
  }

  /** One of ours, thrown just now from the eye, drawn from the muzzle. */
  mine(seq: number, w: WeaponId, o: THREE.Vector3, v: THREE.Vector3, muzzle: THREE.Vector3, now: number) {
    this.flying.push({
      id: 0, seq, w, mine: true, t: now, born: now,
      x: o.x, y: o.y, z: o.z, vx: v.x, vy: v.y, vz: v.z,
      ox: muzzle.x - o.x, oy: muzzle.y - o.y, oz: muzzle.z - o.z, end: null,
    });
  }

  /** The server's account of a throw: ours gets its id, anyone else's starts flying. */
  thrown(id: number, owner: number, me: number, seq: number, w: WeaponId, p: V3, v: V3, T: number) {
    if (owner === me) {
      const l = this.flying.find((q) => q.mine && q.seq === seq);
      if (l) l.id = id;
      return;
    }
    const t = T / 1000;
    this.flying.push({
      id, seq: 0, w, mine: false, t, born: t,
      x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2],
      // from their hands, near enough: the avatar holds it just below the eye
      ox: 0, oy: -0.35, oz: 0, end: null,
    });
  }

  /** The server says where it ended: in someone, or in the plant. */
  ended(id: number, p: V3, n: V3 | undefined, T: number, person: boolean) {
    const l = this.flying.find((q) => q.id === id);
    if (!l) return;
    if (l.mine) {
      // ours is on our own clock, which is ahead of the server's: end it now
      this.land(l, p, n, person);
      this.flying.splice(this.flying.indexOf(l), 1);
      return;
    }
    l.end = { T: T / 1000, p, n, person };
  }

  /** Something hit a person: a splat on them and a spray off them. */
  private land(l: Lump, p: V3, n: V3 | undefined, person: boolean) {
    _p.set(p[0], p[1], p[2]);
    if (n) _n.set(n[0], n[1], n[2]);
    else _n.set(-l.vx, -l.vy, -l.vz).normalize();
    if (l.w === 0) {
      this.fx.liquid.emit({
        at: _p, count: person ? 14 : 9, velocity: _n.clone().multiplyScalar(2.2),
        spread: new THREE.Vector3(1.6, 1.4, 1.6), colour: C.paste, size: 0.09, sizeVary: 0.5,
        life: 0.55, gravity: -9.81, drag: 0.7,
      });
      if (!person && n) this.splat(_p, _n, 0.45 + this.random() * 0.35, C.paste);
    } else {
      this.fx.haze.emit({
        at: _p, count: 7, velocity: _n.clone().multiplyScalar(0.8), spread: new THREE.Vector3(0.7, 0.5, 0.7),
        colour: 0x9aa3ad, size: 0.35, sizeVary: 0.4, life: 0.9, gravity: 0.3, drag: 0.5, grow: 2,
      });
      this.fx.liquid.emit({
        at: _p, count: 5, velocity: _n.clone().multiplyScalar(2.5), spread: new THREE.Vector3(1.5, 1.2, 1.5),
        colour: 0x7d8793, size: 0.06, life: 0.6, gravity: -9.81,
      });
      if (!person && n) this.splat(_p, _n, 0.22 + this.random() * 0.1, 0x3a3f46);
    }
  }

  private splat(at: THREE.Vector3, n: THREE.Vector3, size: number, colour: number) {
    _q.setFromUnitVectors(Z, n);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, this.random() * Math.PI * 2));
    _s.set(size, size, size);
    _m.compose(_p.copy(at).addScaledVector(n, 0.012), _q, _s);
    const i = this.splatNext;
    this.splats.setMatrixAt(i, _m);
    this.splats.setColorAt(i, new THREE.Color(colour));
    this.splatNext = (i + 1) % SPLATS;
    this.splatCount = Math.min(SPLATS, this.splatCount + 1);
    this.splats.count = this.splatCount;
    this.splats.instanceMatrix.needsUpdate = true;
    this.splats.instanceColor!.needsUpdate = true;
  }

  /** A new round: the pad gets hosed down. */
  clean() {
    this.flying = [];
    this.splatCount = 0;
    this.splatNext = 0;
    this.splats.count = 0;
  }

  /**
   * Fly ours to `now` (our clock, seconds) and everyone else's to
   * `serverNow` less the interpolation delay (server clock, seconds).
   */
  update(now: number, serverNow: number) {
    const behind = serverNow - INTERP_MS / 1000;
    const keep: Lump[] = [];
    for (const l of this.flying) {
      const until = l.mine ? now : behind;
      if (this.fly(l, until)) keep.push(l);
    }
    this.flying = keep;

    const counts = [0, 0];
    for (const l of this.flying) {
      const clock = l.mine ? now : behind;
      if (clock < l.born) continue;   // not thrown yet, as far as this screen is concerned
      const im = this.meshes[l.w];
      const k = Math.max(0, 1 - (clock - l.born) / 0.12);
      _p.set(l.x + l.ox * k, l.y + l.oy * k, l.z + l.oz * k);
      _s.set(l.vz, 0, -l.vx);
      if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0);
      _q.setFromAxisAngle(_s.normalize(), (clock - l.born) * 14);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      im.setMatrixAt(counts[l.w]++, _m);
    }
    this.meshes.forEach((im, i) => {
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true;
    });
  }

  /** On to `until`. False once it has landed. */
  private fly(l: Lump, until: number): boolean {
    let guard = 0;
    while (l.t < until && guard++ < 600) {
      if (l.end && l.t >= l.end.T) {
        this.land(l, l.end.p, l.end.n, l.end.person);
        return false;
      }
      const h = Math.min(STEP, until - l.t);
      const x0 = l.x, y0 = l.y, z0 = l.z;
      advance(l, h, this.g);
      l.t += h;
      const hit = this.grid.segment(x0, y0, z0, l.x, l.y, l.z);
      const who = l.mine ? this.people(x0, y0, z0, l.x, l.y, l.z, WEAPONS[l.w].radius) : null;
      if (who !== null && (!hit || who < hit.t)) {
        this.land(l, [x0 + (l.x - x0) * who, y0 + (l.y - y0) * who, z0 + (l.z - z0) * who], undefined, true);
        return false;
      }
      if (hit) {
        const at: V3 = [x0 + (l.x - x0) * hit.t, y0 + (l.y - y0) * hit.t, z0 + (l.z - z0) * hit.t];
        this.land(l, at, [hit.nx, hit.ny, hit.nz], false);
        this.onWall(_p.set(at[0], at[1], at[2]), l.w);
        return false;
      }
      if (l.t - l.born > WEAPONS[l.w].ttl || l.y < -8) return false;
    }
    if (l.end && until >= l.end.T) {
      this.land(l, l.end.p, l.end.n, l.end.person);
      return false;
    }
    return true;
  }
}
