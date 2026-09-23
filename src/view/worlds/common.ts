import * as THREE from 'three';
import type { Telemetry } from '../../sim/plant';

/** Anything a world adds that moves on its own. */
export interface Dressing {
  update(t: Telemetry, dt: number, time: number): void;
}

/**
 * Seeded random, so a world is laid out the same on every load - the towers
 * do not rearrange themselves between a screenshot and a refresh.
 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let dot: THREE.Texture | null = null;
/** A soft round sprite for points. */
export function dotTexture(): THREE.Texture {
  if (dot) return dot;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

/** Draw once into a canvas and hand it back as a texture. */
export function canvasTexture(
  w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface FieldOptions {
  count: number;
  /** the box the field fills and wraps within */
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** metres per second, the same for every particle */
  drift: THREE.Vector3;
  /** random extra velocity per particle */
  wobble?: number;
  size: number;
  colour: number;
  opacity?: number;
  /** additive, for anything that should read as light */
  additive?: boolean;
  /** size in pixels rather than metres - stars */
  screen?: boolean;
  /** draw streaks rather than dots - rain */
  streak?: number;
  seed?: number;
  fog?: boolean;
}

/**
 * An ambient field: marine snow, blowing dust, rain, stars. Every particle
 * drifts at the same speed and wraps inside a box, so it costs one buffer
 * update a frame and never runs out.
 */
export class Field implements Dressing {
  object: THREE.Points | THREE.LineSegments;
  private pos: Float32Array;
  private vel: Float32Array;
  private n: number;
  private span = new THREE.Vector3();

  constructor(private o: FieldOptions) {
    const r = rng(o.seed ?? 7);
    this.n = o.count;
    this.span.subVectors(o.max, o.min);
    const per = o.streak ? 2 : 1;
    this.pos = new Float32Array(this.n * 3 * per);
    this.vel = new Float32Array(this.n * 3);
    const w = o.wobble ?? 0;
    for (let i = 0; i < this.n; i++) {
      const x = o.min.x + r() * this.span.x;
      const y = o.min.y + r() * this.span.y;
      const z = o.min.z + r() * this.span.z;
      for (let k = 0; k < per; k++) {
        this.pos[(i * per + k) * 3] = x;
        this.pos[(i * per + k) * 3 + 1] = y;
        this.pos[(i * per + k) * 3 + 2] = z;
      }
      this.vel[i * 3] = o.drift.x + (r() - 0.5) * w;
      this.vel[i * 3 + 1] = o.drift.y + (r() - 0.5) * w;
      this.vel[i * 3 + 2] = o.drift.z + (r() - 0.5) * w;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));

    if (o.streak) {
      const mat = new THREE.LineBasicMaterial({
        color: o.colour, transparent: true, opacity: o.opacity ?? 0.5,
        depthWrite: false, fog: o.fog ?? true,
        blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.object = new THREE.LineSegments(geo, mat);
    } else {
      const mat = new THREE.PointsMaterial({
        color: o.colour, size: o.size, map: dotTexture(),
        transparent: true, opacity: o.opacity ?? 0.8, depthWrite: false,
        sizeAttenuation: !o.screen, fog: o.fog ?? true,
        blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.object = new THREE.Points(geo, mat);
    }
    this.object.frustumCulled = false;
  }

  update(_t: Telemetry, dt: number) {
    const { min, max } = this.o;
    const per = this.o.streak ? 2 : 1;
    const len = this.o.streak ?? 0;
    const step = Math.min(dt, 0.1);
    for (let i = 0; i < this.n; i++) {
      const b = i * per * 3;
      for (let a = 0; a < 3; a++) {
        let v = this.pos[b + a] + this.vel[i * 3 + a] * step;
        const lo = a === 0 ? min.x : a === 1 ? min.y : min.z;
        const hi = a === 0 ? max.x : a === 1 ? max.y : max.z;
        if (v < lo) v += hi - lo;
        else if (v > hi) v -= hi - lo;
        this.pos[b + a] = v;
      }
      if (per === 2) {
        // the tail of a streak trails along its own velocity
        const vx = this.vel[i * 3], vy = this.vel[i * 3 + 1], vz = this.vel[i * 3 + 2];
        const s = len / Math.max(Math.hypot(vx, vy, vz), 1e-6);
        this.pos[b + 3] = this.pos[b] - vx * s;
        this.pos[b + 4] = this.pos[b + 1] - vy * s;
        this.pos[b + 5] = this.pos[b + 2] - vz * s;
      }
    }
    (this.object.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Ease a 0..1 fraction so things accelerate and settle rather than lurch. */
export const smooth = (k: number) => k * k * (3 - 2 * k);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
