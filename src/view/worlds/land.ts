/**
 * What the worlds with real ground under them are built from: seeded noise, a
 * ground grid that is fine where you stand and coarse out in the haze, the
 * heightfield laid over it, landforms too sharp for that grid, and the few
 * geometry helpers their scenery shares.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, clamp01 } from './common';

/** Linear colour from an sRGB hex, times a brightness. */
export const lin = (hex: number, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ------------------------------------------------------------- noise

/** Perlin's eight gradient directions, looked up rather than worked out. */
const GX = Float64Array.from({ length: 8 }, (_, i) => Math.cos((i * Math.PI) / 4));
const GY = Float64Array.from({ length: 8 }, (_, i) => Math.sin((i * Math.PI) / 4));

export type Noise2 = (x: number, y: number) => number;

/** Seeded 2D gradient noise, about -1 .. 1. */
export function perlin(seed: number): Noise2 {
  const r = rng(seed);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const grad = (h: number, x: number, y: number) => GX[h & 7] * x + GY[h & 7] * y;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = fade(xf), v = fade(yf);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.4;
  };
}

export const fbm = (n: Noise2, x: number, y: number, oct: number) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); f *= 2.02; a *= 0.5; }
  return s;
};

/** Noise that tiles across an S x S texture: sampled round a torus. */
export const torusNoise = (n: Noise2, u: number, v: number, S: number, f: number) => {
  const a = (u / S) * Math.PI * 2, b = (v / S) * Math.PI * 2;
  return n(Math.cos(a) * f + Math.sin(b) * f * 0.7, Math.sin(a) * f + Math.cos(b) * f * 0.7);
};

/** Linear 0 .. 1.5 to an sRGB byte, by table. */
const SRGB = Uint8ClampedArray.from({ length: 1536 }, (_, i) => 255 * Math.pow(i / 1024, 1 / 2.2));
export const srgbByte = (v: number) => SRGB[Math.min(1535, Math.max(0, Math.round(v * 1024)))];

export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a rounded rectangle, centre (cx, cz), half-sizes (hx, hz), corner r. */
export function rrect(x: number, z: number, cx: number, cz: number, hx: number, hz: number, r: number) {
  const qx = Math.abs(x - cx) - hx + r, qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

// ------------------------------------------------------------ the ground

/**
 * The spacing of a ground grid along one axis, out to `edge` either side,
 * `step(distance)` apart, with `breaks` - the edges of a cutaway, the
 * walkable boundary - put exactly where they belong.
 */
export function gridAxis(edge: number, breaks: number[], step: (a: number) => number): number[] {
  const half = [0];
  while (half[half.length - 1] < edge) half.push(Math.min(edge, half[half.length - 1] + step(half[half.length - 1])));
  let xs = [...half.slice(1).map((v) => -v).reverse(), ...half];
  for (const b of breaks) {
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - b) < Math.abs(xs[best] - b)) best = i;
    if (Math.abs(xs[best] - b) < 0.4 * step(Math.abs(b))) xs[best] = b;
    else xs.push(b);
  }
  xs = [...new Set(xs)].sort((a, b) => a - b);
  return xs;
}

export interface HeightfieldSpec {
  xs: number[];
  zs: number[];
  height: (x: number, z: number) => number;
  colour: (x: number, z: number, out: THREE.Color) => THREE.Color;
  /** leave this cell out (by its centre) - a cutaway, a crater with a unit in it */
  hole?: (x: number, z: number) => boolean;
  /** cells inside this square, either side of the origin, are the walkable mesh */
  near: number;
  material: THREE.Material;
  /** metres per repeat of the material's detail texture */
  tile: number;
}

/**
 * The ground to the horizon, as two meshes over one grid: what you can walk
 * on round the site, which the walker collides with, and everything past it,
 * which it does not.
 */
export function heightfield(s: HeightfieldSpec): THREE.Group {
  const g = new THREE.Group();
  const { xs, zs } = s;
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const c = new THREE.Color();
  const hs = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], k = j * nx + i;
      hs[k] = s.height(x, z);
      pos.set([x, hs[k], z], k * 3);
      s.colour(x, z, c);
      col.set([c.r, c.g, c.b], k * 3);
      uv.set([x / s.tile, z / s.tile], k * 2);
    }
  }
  // Normals across the grid's own neighbours, so both meshes agree along the
  // seam between them and the coarse cells far out shade as they are shaped.
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nx - 1);
      const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, nz - 1);
      const gx = (hs[j * nx + i1] - hs[j * nx + i0]) / (xs[i1] - xs[i0]);
      const gz = (hs[j1 * nx + i] - hs[j0 * nx + i]) / (zs[j1] - zs[j0]);
      const l = Math.hypot(gx, 1, gz);
      nor.set([-gx / l, 1 / l, -gz / l], (j * nx + i) * 3);
    }
  }
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3),
    normal: new THREE.BufferAttribute(nor, 3),
    color: new THREE.BufferAttribute(col, 3),
    uv: new THREE.BufferAttribute(uv, 2),
  };
  const near: number[] = [], far: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const mx = (xs[i] + xs[i + 1]) / 2, mz = (zs[j] + zs[j + 1]) / 2;
      if (s.hole?.(mx, mz)) continue;
      const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
      const list = Math.abs(mx) < s.near && Math.abs(mz) < s.near ? near : far;
      list.push(a, d, b, b, d, e);
    }
  }
  for (const [idx, walk] of [[near, true], [far, false]] as const) {
    const geo = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(attrs)) geo.setAttribute(name, a);
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, s.material);
    m.receiveShadow = true;
    if (walk) m.userData.collider = true;
    else m.userData.noCollide = true;
    g.add(m);
  }
  return g;
}

/**
 * A landform on its own finer grid, for shapes too sharp for the ground's
 * cells out where it stands. The shape gives the height of its surface; where
 * that is under the ground it is sunk a little further so the ground covers
 * it, and the toe forms wherever the two cross.
 */
export function landform(
  cx: number, cz: number, hx: number, hz: number, step: number,
  shape: (x: number, z: number) => { y: number; colour: THREE.Color } | null,
  ground: (x: number, z: number) => number,
  material: THREE.Material,
  tile = 5,
): THREE.Mesh {
  const nx = Math.ceil((2 * hx) / step) + 1, nz = Math.ceil((2 * hz) / step) + 1;
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const keep = new Int32Array(nx * nz).fill(-1);
  let n = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = cx - hx + i * step, z = cz - hz + j * step;
      const s = shape(x, z);
      if (!s) continue;
      keep[j * nx + i] = n++;
      const gy = ground(x, z);
      pos.push(x, s.y > gy ? s.y : gy - 0.8, z);
      col.push(s.colour.r, s.colour.g, s.colour.b);
      uv.push(x / tile, z / tile);
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = keep[j * nx + i], b = keep[j * nx + i + 1], d = keep[(j + 1) * nx + i], e = keep[(j + 1) * nx + i + 1];
      if (a < 0 || b < 0 || d < 0 || e < 0) continue;
      idx.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  m.userData.noCollide = true;
  return m;
}

/**
 * A detail texture at two scales at once, so its repeat never shows: once
 * per tile, and once every eight at a slight angle. `strength` is how much of
 * the big copy shows - less, where the texture has a pattern (cracks) that
 * would read as paving eight times the size.
 */
export function twoScale<M extends THREE.MeshStandardMaterial>(mat: M, key: string, strength = 1): M {
  const prev = mat.onBeforeCompile;
  const k = strength.toFixed(3);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
      #ifdef USE_MAP
        vec2 uvB = mat2(0.97, 0.24, -0.24, 0.97) * vMapUv * 0.125 + 0.37;
        vec4 bigCopy = mix(vec4(0.893), texture2D(map, uvB), ${k});
        vec4 sampledDiffuseColor = texture2D(map, vMapUv) * bigCopy * 1.12;
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ------------------------------------------------------------ geometry

/** Weld a polyhedron's duplicated corners so it shades as one smooth lump. */
export function mergeVerts(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = geo.getAttribute('position');
  const map = new Map<string, number>();
  const verts: number[] = [], idx: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; map.set(key, k); verts.push(p.getX(i), p.getY(i), p.getZ(i)); }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  return out;
}

/**
 * Shade a clump darker towards its foot - the light that never gets under a
 * bush or into a heap - as a vertex colour the instance tint multiplies.
 */
export function selfShade(geo: THREE.BufferGeometry, y0: number, y1: number, floor: number) {
  const p = geo.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = floor + (1 - floor) * smooth(y0, y1, p.getY(i));
    col.set([k, k, k * 0.96], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Collects boxes and members by material and merges each lot into one mesh. */
export class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  /** applied to everything added while it is set: a whole pylon, knocked over */
  at: THREE.Matrix4 | null = null;

  add(mat: THREE.Material, geo: THREE.BufferGeometry) {
    geo.deleteAttribute('uv');
    if (this.at) geo.applyMatrix4(this.at);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(geo.index ? geo.toNonIndexed() : geo);
  }

  /**
   * A member from a to b, t square - or t by d, where d is across z for a
   * member that runs in the x-y plane (a sloping gallery, its roof).
   */
  member(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, t: number, d = t) {
    const len = a.distanceTo(b);
    const geo = new THREE.BoxGeometry(t, len, d);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.add(mat, geo);
  }

  block(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    this.add(mat, geo);
  }

  /** Every lot as one mesh, casting and taking shadows. */
  build(into: THREE.Object3D, shadows = true) {
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = mesh.receiveShadow = shadows;
      into.add(mesh);
    }
    this.parts.clear();
  }
}
