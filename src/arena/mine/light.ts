import * as THREE from 'three';
import type { Samples } from './level';

/**
 * Light underground, baked.
 *
 * A level has sixty-odd strip lights in it. Sixty real lights would bring
 * any forward renderer to its knees, and none of them ever moves, so they
 * are worked out once at load instead: for every vertex of the rock and of
 * everything standing in it, how much of each lamp reaches it - falling off
 * with distance, turned away with the angle, and stopped dead by rock in the
 * way, which is marched through the level's own distance field. That goes
 * on each vertex as a `baked` attribute, and a small patch to the standard
 * material adds it in as indirect light. The one real light is the one on
 * your own hard hat.
 *
 * Things that move - people, barrows, what is in your hands - are not
 * baked. They ask a coarse grid of the same light at waist height what the
 * light is like where they are standing, and glow that much.
 */

export interface Lamp {
  p: THREE.Vector3;
  col: THREE.Color;
  /** brightness, and how far it reaches */
  i: number;
  r: number;
}

/** turned up and down together - a whole level going dark would be one number */
export const BAKED = { value: Math.PI };

const patched = new WeakMap<THREE.Material, THREE.Material>();

/**
 * A copy of the material that adds the `baked` attribute in as light. The
 * copy is made once per material, so a hundred meshes of one paint still
 * share one program.
 */
export function bakedMaterial<T extends THREE.Material>(m: T, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void): T {
  const hit = patched.get(m);
  if (hit) return hit as T;
  const c = m.clone() as T;
  // Metal shows what it reflects, and underground there is nothing to
  // reflect: bare steel would come out black. Dust dulls it anyway.
  const std = c as unknown as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial && std.metalness > 0.25) {
    std.metalness = 0.25;
    std.roughness = Math.max(std.roughness, 0.6);
  }
  c.onBeforeCompile = (sh) => {
    sh.uniforms.uBaked = BAKED;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 baked;\nvarying vec3 vBaked;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBaked = baked;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBaked;\nuniform float uBaked;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nirradiance += vBaked * uBaked;');
    extra?.(sh);
  };
  c.customProgramCacheKey = () => 'baked' + (extra ? '+' + m.uuid : '');
  patched.set(m, c);
  return c;
}

/** Lamps bucketed in plan, so a vertex only asks the ones that could reach it. */
class LampGrid {
  private cells = new Map<number, Lamp[]>();
  private static readonly S = 8;
  constructor(lamps: Lamp[]) {
    const S = LampGrid.S;
    for (const l of lamps) {
      for (let i = Math.floor((l.p.x - l.r) / S); i <= Math.floor((l.p.x + l.r) / S); i++) {
        for (let k = Math.floor((l.p.z - l.r) / S); k <= Math.floor((l.p.z + l.r) / S); k++) {
          const key = (i + 512) * 1024 + k + 512;
          const c = this.cells.get(key);
          if (c) c.push(l); else this.cells.set(key, [l]);
        }
      }
    }
  }
  near(x: number, z: number): Lamp[] {
    const S = LampGrid.S;
    return this.cells.get((Math.floor(x / S) + 512) * 1024 + Math.floor(z / S) + 512) ?? [];
  }
}

/**
 * The light arriving at a point facing n. `ambient` is the little that
 * gets everywhere, scaled by how boxed-in the point is.
 */
export class Baker {
  private grid: LampGrid;
  constructor(private s: Samples, lamps: Lamp[], private ambient = new THREE.Color(0x2a2622)) {
    this.grid = new LampGrid(lamps);
  }

  at(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color, rock = true) {
    out.setRGB(0, 0, 0);
    // start a hair off the surface, so the march does not begin inside it
    const ox = x + nx * 0.25, oy = y + ny * 0.25, oz = z + nz * 0.25;
    for (const l of this.grid.near(x, z)) {
      const dx = l.p.x - x, dy = l.p.y - y, dz = l.p.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > l.r || d < 1e-4) continue;
      const cos = (dx * nx + dy * ny + dz * nz) / d;
      // wrapped a little: rock scatters, it is not a mirror
      const lam = Math.max(0, (cos + 0.3) / 1.3);
      if (lam <= 0) continue;
      const k = d / l.r;
      const fall = l.i / (1 + d * d * 0.045) * (1 - k * k) * (1 - k * k);
      if (fall < 0.004) continue;
      const vis = this.s.clear(ox, oy, oz, l.p.x, l.p.y, l.p.z);
      if (vis <= 0) continue;
      const v = fall * lam * vis;
      out.r += l.col.r * v; out.g += l.col.g * v; out.b += l.col.b * v;
    }
    // how open it is out along the normal: corners and cracks get less of everything
    let ao = 1;
    if (rock) {
      const a1 = -this.s.sample(x + nx * 0.6, y + ny * 0.6, z + nz * 0.6) / 0.6;
      const a2 = -this.s.sample(x + nx * 1.4, y + ny * 1.4, z + nz * 1.4) / 1.4;
      ao = 0.35 + 0.65 * Math.min(1, Math.max(0, (a1 + a2) * 0.5 + 0.15));
    }
    out.r = (out.r + this.ambient.r) * ao;
    out.g = (out.g + this.ambient.g) * ao;
    out.b = (out.b + this.ambient.b) * ao;
    return out;
  }

  /** Bake a mesh whose geometry is already in world space. */
  bake(geo: THREE.BufferGeometry, rock = false) {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const out = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      this.at(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), c, rock);
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
    }
    geo.setAttribute('baked', new THREE.BufferAttribute(out, 3));
  }
}

/**
 * The same light, on a coarse grid at chest height, for everything that
 * moves: a person under a lamp is lit, a person in a dark cuddy is not.
 */
export class Probe {
  private static readonly S = 1.5;
  /** r, g, b, and 1 where the point is in the open - rock is left out of the blend */
  private data: Float32Array;
  private w: number;
  private h: number;
  constructor(private baker: Baker, private x0: number, private z0: number, x1: number, z1: number, open: (x: number, z: number) => boolean) {
    const S = Probe.S;
    this.w = Math.ceil((x1 - x0) / S) + 1;
    this.h = Math.ceil((z1 - z0) / S) + 1;
    this.data = new Float32Array(this.w * this.h * 4);
    const c = new THREE.Color(), d = new THREE.Color();
    for (let k = 0; k < this.h; k++) {
      for (let i = 0; i < this.w; i++) {
        const x = x0 + i * S, z = z0 + k * S;
        if (!open(x, z)) continue;
        // a person is lit from every side at once: the average of four faces and the top
        c.setRGB(0, 0, 0);
        for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
          baker.at(x, 1.3, z, nx, ny, nz, d, false);
          c.r += d.r / 5; c.g += d.g / 5; c.b += d.b / 5;
        }
        this.data.set([c.r, c.g, c.b, 1], (k * this.w + i) * 4);
      }
    }
  }

  /** the light where someone is standing, blended between the grid points */
  at(x: number, z: number, out: THREE.Color) {
    const S = Probe.S;
    const fx = Math.max(0, Math.min(this.w - 1.001, (x - this.x0) / S));
    const fz = Math.max(0, Math.min(this.h - 1.001, (z - this.z0) / S));
    const i = Math.floor(fx), k = Math.floor(fz), u = fx - i, v = fz - k;
    const d = this.data, w = this.w;
    let r = 0, g = 0, b = 0, sum = 0;
    for (const [ii, kk, wt] of [[i, k, (1 - u) * (1 - v)], [i + 1, k, u * (1 - v)], [i, k + 1, (1 - u) * v], [i + 1, k + 1, u * v]]) {
      const o = (kk * w + ii) * 4;
      const q = wt * d[o + 3];
      r += d[o] * q; g += d[o + 1] * q; b += d[o + 2] * q; sum += q;
    }
    return sum > 1e-4 ? out.setRGB(r / sum, g / sum, b / sum) : out.setRGB(0.05, 0.045, 0.04);
  }
}
