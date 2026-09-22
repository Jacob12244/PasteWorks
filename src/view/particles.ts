import * as THREE from 'three';

/**
 * A pooled point-sprite particle system.
 *
 * Everything that goes wrong in the plant is something leaving a vessel it was
 * supposed to stay in, so the failures are all particles: water over a tank
 * rim, thickened tails over a launder, binder dust off a silo vent, paste
 * spraying out of an over-pressured spool.
 */

let sprite: THREE.Texture | null = null;

/** Soft round dot, drawn once. */
function dotTexture(): THREE.Texture {
  if (sprite) return sprite;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  sprite = new THREE.CanvasTexture(c);
  return sprite;
}

export interface EmitOptions {
  /** where, in world space */
  at: THREE.Vector3;
  /** how many to spawn this call */
  count: number;
  /** mean initial velocity */
  velocity?: THREE.Vector3;
  /** random spread added to velocity, per axis */
  spread?: THREE.Vector3;
  /** random offset added to position, per axis */
  jitter?: THREE.Vector3;
  colour: THREE.Color | number;
  /** metres */
  size?: number;
  sizeVary?: number;
  /** seconds */
  life?: number;
  lifeVary?: number;
  /** m/s^2, negative is down */
  gravity?: number;
  /** velocity retained per second */
  drag?: number;
  /** world y at which the particle stops or bounces; undefined = no floor */
  floor?: number;
  bounce?: number;
  /** particles grow toward this multiple of their start size (dust plumes) */
  grow?: number;
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class Particles {
  points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private siz: Float32Array;
  private alp: Float32Array;

  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private floor: Float32Array;
  private bounce: Float32Array;
  private grow: Float32Array;
  private size0: Float32Array;

  private cursor = 0;
  live = 0;

  constructor(max = 2200, additive = false, opacity = 0.95) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.siz = new Float32Array(max);
    this.alp = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.bounce = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.floor.fill(-1e9);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.siz, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(this.alp, 1));
    geo.setDrawRange(0, max);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: dotTexture() },
        uOpacity: { value: opacity },
        // point size is in pixels, so scale by viewport height to keep
        // particles the right physical size at any zoom
        uScale: { value: innerHeight * 0.5 },
      },
      vertexShader: `
        attribute vec3 pcolor;
        attribute float psize;
        attribute float palpha;
        varying vec3 vC;
        varying float vA;
        uniform float uScale;
        void main() {
          vC = pcolor;
          vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / max(-mv.z, 0.001);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform float uOpacity;
        varying vec3 vC;
        varying float vA;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vA * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    addEventListener('resize', () => {
      mat.uniforms.uScale.value = innerHeight * 0.5;
    });
  }

  emit(o: EmitOptions) {
    const n = Math.min(o.count, this.max);
    if (n <= 0) return;

    const col = o.colour instanceof THREE.Color ? o.colour : _c.setHex(o.colour);
    const vel = o.velocity ?? _v.set(0, 0, 0);
    const sp = o.spread;
    const jt = o.jitter;
    const size = o.size ?? 0.18;
    const sizeVary = o.sizeVary ?? 0.5;
    const life = o.life ?? 1.6;
    const lifeVary = o.lifeVary ?? 0.4;

    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;

      this.pos[i3] = o.at.x + (jt ? (Math.random() - 0.5) * 2 * jt.x : 0);
      this.pos[i3 + 1] = o.at.y + (jt ? (Math.random() - 0.5) * 2 * jt.y : 0);
      this.pos[i3 + 2] = o.at.z + (jt ? (Math.random() - 0.5) * 2 * jt.z : 0);

      this.vel[i3] = vel.x + (sp ? (Math.random() - 0.5) * 2 * sp.x : 0);
      this.vel[i3 + 1] = vel.y + (sp ? (Math.random() - 0.5) * 2 * sp.y : 0);
      this.vel[i3 + 2] = vel.z + (sp ? (Math.random() - 0.5) * 2 * sp.z : 0);

      // a little per-particle colour variation stops it looking like a decal
      const j = 1 + (Math.random() - 0.5) * 0.22;
      this.col[i3] = col.r * j;
      this.col[i3 + 1] = col.g * j;
      this.col[i3 + 2] = col.b * j;

      const s = size * (1 + (Math.random() - 0.5) * 2 * sizeVary);
      this.size0[i] = s;
      this.siz[i] = s;
      this.alp[i] = 1;

      const l = life * (1 + (Math.random() - 0.5) * 2 * lifeVary);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.grav[i] = o.gravity ?? -9.81;
      this.drag[i] = o.drag ?? 0.6;
      this.floor[i] = o.floor ?? -1e9;
      this.bounce[i] = o.bounce ?? 0;
      this.grow[i] = o.grow ?? 1;
    }
  }

  update(dt: number) {
    const d = Math.min(dt, 0.05);
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alp[i] = 0; continue; }
      const i3 = i * 3;

      this.life[i] -= d;
      if (this.life[i] <= 0) { this.alp[i] = 0; this.siz[i] = 0; continue; }
      live++;

      const k = Math.pow(this.drag[i], d);
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k + this.grav[i] * d;
      this.vel[i3 + 2] *= k;

      this.pos[i3] += this.vel[i3] * d;
      this.pos[i3 + 1] += this.vel[i3 + 1] * d;
      this.pos[i3 + 2] += this.vel[i3 + 2] * d;

      if (this.pos[i3 + 1] < this.floor[i]) {
        this.pos[i3 + 1] = this.floor[i];
        if (this.bounce[i] > 0.01 && Math.abs(this.vel[i3 + 1]) > 0.6) {
          this.vel[i3 + 1] = -this.vel[i3 + 1] * this.bounce[i];
          this.vel[i3] *= 0.7;
          this.vel[i3 + 2] *= 0.7;
        } else {
          // settled: spread out and flatten instead of piling up
          this.vel[i3 + 1] = 0;
          this.vel[i3] *= 0.9;
          this.vel[i3 + 2] *= 0.9;
        }
      }

      const age = 1 - this.life[i] / this.maxLife[i];
      this.alp[i] = Math.min(1, (1 - age) * 2.2);
      this.siz[i] = this.size0[i] * (1 + (this.grow[i] - 1) * age);
    }

    this.live = live;
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('pcolor') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('psize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('palpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alp.fill(0);
    this.siz.fill(0);
    this.update(0);
  }
}

/**
 * Rate-limited emitter. Spill rates come out of the simulation as continuous
 * quantities (m3/h), so this turns one into a believable particle rate without
 * dumping a thousand particles on the first frame of a fast-forward.
 */
export class Spout {
  private carry = 0;

  constructor(
    private field: Particles,
    private perSecond: number,
    private make: (at: THREE.Vector3) => EmitOptions,
  ) {}

  /**
   * @param dt    real seconds since the last frame
   * @param rate  0..1 intensity; 0 stops the spout
   * @param at    where it is coming from
   */
  run(dt: number, rate: number, at: THREE.Vector3) {
    if (rate <= 0.001) { this.carry = 0; return; }
    this.carry += this.perSecond * Math.min(rate, 1) * Math.min(dt, 0.05);
    const n = Math.floor(this.carry);
    if (n <= 0) return;
    this.carry -= n;
    const o = this.make(at);
    o.count = Math.min(n, 40);
    this.field.emit(o);
  }
}

/** The three fields the plant uses, kept together so the frame loop is simple. */
export class FX {
  /** water, slurry, cake - anything wet and opaque */
  liquid = new Particles(2600, false, 0.95);
  /** dust and steam - soft, additive, rises */
  haze = new Particles(900, false, 0.4);
  /** sparks and high-pressure spray - additive so it reads as energy */
  spray = new Particles(700, true, 0.8);

  group = new THREE.Group();

  constructor() {
    this.group.add(this.liquid.points, this.haze.points, this.spray.points);
    this.group.renderOrder = 6;
  }

  update(dt: number) {
    this.liquid.update(dt);
    this.haze.update(dt);
    this.spray.update(dt);
  }

  clear() {
    this.liquid.clear();
    this.haze.clear();
    this.spray.clear();
  }

  get count() {
    return this.liquid.live + this.haze.live + this.spray.live;
  }
}
