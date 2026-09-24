import { SHAPES, type Shape } from '../shared/mine';

/**
 * The rock of the 760 Level, carved out of a distance field.
 *
 * Every drive, chamber and stope is a shape with a signed distance: negative
 * inside, where the air is. The level is the union of them all, roughened
 * with a little seeded noise so the walls look blasted and not machined.
 * The field is sampled on a grid and meshed with surface nets: one vertex
 * in every cell the surface passes through, and a quad across every grid
 * edge that crosses it. Junctions come out of the union on their own, which
 * is the whole reason for doing it this way - no drive has to know what
 * meets it.
 *
 * The noise goes on the walls and the back, never the floor, so the floor
 * of the level is flat at y = 0 and a lump of paste or a walker finds it
 * where it looks to be. Everything here is plain arithmetic, seeded, with
 * no DOM, so the page gets the same rock every time - which matters,
 * because the arena server is baked from it.
 */

/** grid spacing, metres */
export const CELL = 0.6;
const X0 = -86.4, X1 = 86.4, Z0 = -52.2, Z1 = 52.2;
/** offset half a cell so no sample sits on the floor itself */
const Y0 = -27.3, Y1 = 10.5;

// ------------------------------------------------------------------ noise

function hash(x: number, y: number, z: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + 0x2545f491;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** smooth value noise, -1..1 */
function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (i: number, j: number, k: number) => hash(xi + i, yi + j, zi + k);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  ) * 2 - 1;
}

/** the roughness of blasted rock: a lumpy big scale and a smaller one on top */
export function rockNoise(x: number, y: number, z: number) {
  return 0.62 * vnoise(x / 3.1, y / 2.6, z / 3.1) + 0.38 * vnoise(x / 1.35 + 17, y / 1.2, z / 1.35 - 9);
}

// ------------------------------------------------------------------ shapes

interface Prim {
  /** plan box it can be open over, for bucketing */
  x0: number; x1: number; z0: number; z1: number;
  /** lowest floor and highest back it can reach */
  lo: number; hi: number;
  /** signed distance, given the noise at the point */
  d(x: number, y: number, z: number, n: number): number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function prims(shape: Shape): Prim[] {
  switch (shape.k) {
    case 'drive': {
      const { w, h, a } = shape;
      const out: Prim[] = [];
      for (let i = 0; i + 1 < shape.pts.length; i++) {
        const [ax, az] = shape.pts[i], [bx, bz] = shape.pts[i + 1];
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
        const m = w + 1;
        out.push({
          x0: Math.min(ax, bx) - m, x1: Math.max(ax, bx) + m, z0: Math.min(az, bz) - m, z1: Math.max(az, bz) + m,
          lo: 0, hi: h + a + 1,
          d(x, y, z, n) {
            const px = x - ax, pz = z - az;
            const t = clamp01((px * dx + pz * dz) / len2);
            const u = Math.hypot(px - dx * t, pz - dz * t);
            const q = Math.min(1, u / w);
            const side = u - w - n * 0.34;
            const back = y - (h + a * Math.sqrt(1 - q * q)) - n * 0.42;
            return Math.max(side, back, -y);
          },
        });
      }
      return out;
    }
    case 'room': {
      const { x: cx, z: cz, hx, hz, rot, h, a } = shape;
      const c = Math.cos(rot), s = Math.sin(rot), r = 1.6;
      const ext = Math.hypot(hx, hz) + 1;
      return [{
        x0: cx - ext, x1: cx + ext, z0: cz - ext, z1: cz + ext, lo: 0, hi: h + a + 1,
        d(x, y, z, n) {
          const lx = (x - cx) * c + (z - cz) * s, lz = -(x - cx) * s + (z - cz) * c;
          const qx = Math.abs(lx) - (hx - r), qz = Math.abs(lz) - (hz - r);
          const plan = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
          const e = clamp01(-plan / 3);
          const side = plan - n * 0.36;
          const back = y - (h + a * e * (2 - e)) - n * 0.45;
          return Math.max(side, back, -y);
        },
      }];
    }
    case 'stope': {
      const { x: cx, z: cz, hx, hz, rot, bottom, top } = shape;
      const c = Math.cos(rot), s = Math.sin(rot), r = 1.2;
      const ext = Math.hypot(hx, hz) + 1.5;
      return [{
        x0: cx - ext, x1: cx + ext, z0: cz - ext, z1: cz + ext, lo: bottom, hi: top + 1,
        d(x, y, z, n) {
          const lx = (x - cx) * c + (z - cz) * s, lz = -(x - cx) * s + (z - cz) * c;
          const qx = Math.abs(lx) - (hx - r), qz = Math.abs(lz) - (hz - r);
          const plan = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
          return Math.max(plan - n * 0.5, y - top - n * 0.6, bottom - y);
        },
      }];
    }
    case 'rise': {
      const { x: cx, z: cz, r, top } = shape;
      return [{
        x0: cx - r - 1, x1: cx + r + 1, z0: cz - r - 1, z1: cz + r + 1, lo: 0, hi: top,
        d(x, y, z, n) {
          return Math.max(Math.hypot(x - cx, z - cz) - r - n * 0.2, y - top, -y);
        },
      }];
    }
  }
}

/**
 * The level as a function. Built once: every primitive goes into a coarse
 * plan grid of buckets, so a point only asks the handful that could reach it.
 */
export class Field {
  private all: Prim[];
  private buckets: Prim[][] = [];
  private static readonly B = 4;
  private bx0 = X0; private bz0 = Z0;
  private bnx: number; private bnz: number;

  constructor(shapes: Shape[] = SHAPES) {
    this.all = shapes.flatMap(prims);
    const B = Field.B;
    this.bnx = Math.ceil((X1 - X0) / B);
    this.bnz = Math.ceil((Z1 - Z0) / B);
    for (let i = 0; i < this.bnx * this.bnz; i++) this.buckets.push([]);
    for (const p of this.all) {
      for (let i = Math.max(0, Math.floor((p.x0 - X0) / B)); i <= Math.min(this.bnx - 1, Math.floor((p.x1 - X0) / B)); i++) {
        for (let k = Math.max(0, Math.floor((p.z0 - Z0) / B)); k <= Math.min(this.bnz - 1, Math.floor((p.z1 - Z0) / B)); k++) {
          this.buckets[k * this.bnx + i].push(p);
        }
      }
    }
  }

  /** the primitives that could be open at (x, z) */
  near(x: number, z: number): Prim[] {
    const i = Math.floor((x - this.bx0) / Field.B), k = Math.floor((z - this.bz0) / Field.B);
    if (i < 0 || k < 0 || i >= this.bnx || k >= this.bnz) return [];
    return this.buckets[k * this.bnx + i];
  }

  /** Signed distance to the rock, near enough: negative in the air. */
  at(x: number, y: number, z: number, list = this.near(x, z)): number {
    let d = 8;
    for (const p of list) {
      if (y < p.lo - 2 || y > p.hi + 2) continue;
      const v = p.d(x, y, z, 0);
      if (v < d) d = v;
    }
    // only bother with the roughness where there is a surface to roughen
    if (d > 1.3 || d < -1.3) return d;
    const n = rockNoise(x, y, z);
    d = 8;
    for (const p of list) {
      if (y < p.lo - 2 || y > p.hi + 2) continue;
      const v = p.d(x, y, z, n);
      if (v < d) d = v;
    }
    return d;
  }

  /** is there air here? */
  open(x: number, y: number, z: number) {
    return this.at(x, y, z) < 0;
  }
}

// ------------------------------------------------------------------ sampling

/** The field on the grid, and the lookups the light bake needs from it. */
export class Samples {
  readonly nx = Math.round((X1 - X0) / CELL) + 1;
  readonly nz = Math.round((Z1 - Z0) / CELL) + 1;
  readonly ny = Math.round((Y1 - Y0) / CELL) + 1;
  readonly v: Float32Array;

  constructor(field: Field) {
    const { nx, ny, nz } = this;
    this.v = new Float32Array(nx * ny * nz).fill(4);
    for (let k = 0; k < nz; k++) {
      const z = Z0 + k * CELL;
      for (let i = 0; i < nx; i++) {
        const x = X0 + i * CELL;
        const list = field.near(x, z);
        if (!list.length) continue;
        let lo = Infinity, hi = -Infinity;
        for (const p of list) { lo = Math.min(lo, p.lo); hi = Math.max(hi, p.hi); }
        const j0 = Math.max(0, Math.floor((lo - 1.5 - Y0) / CELL));
        const j1 = Math.min(ny - 1, Math.ceil((hi + 1.5 - Y0) / CELL));
        for (let j = j0; j <= j1; j++) {
          this.v[(k * ny + j) * nx + i] = field.at(x, Y0 + j * CELL, z, list);
        }
      }
    }
  }

  private idx(i: number, j: number, k: number) {
    return (k * this.ny + j) * this.nx + i;
  }

  /** the field between samples, trilinear; rock outside the grid */
  sample(x: number, y: number, z: number) {
    const fx = (x - X0) / CELL, fy = (y - Y0) / CELL, fz = (z - Z0) / CELL;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx - 1 || j >= this.ny - 1 || k >= this.nz - 1) return 4;
    const u = fx - i, v = fy - j, w = fz - k;
    const a = this.v, nx = this.nx, row = this.ny * nx;
    const o = this.idx(i, j, k);
    const c000 = a[o], c100 = a[o + 1], c010 = a[o + nx], c110 = a[o + nx + 1];
    const c001 = a[o + row], c101 = a[o + row + 1], c011 = a[o + row + nx], c111 = a[o + row + nx + 1];
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  /**
   * How much of the way from a to b is open air: 1 for a clear line, 0 for
   * rock in the way. Marched through the field in steps as long as the
   * distance to the nearest rock allows, so an open drive is a few steps.
   */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return 1;
    let t = 0, worst = 1;
    for (let n = 0; n < 64 && t < len; n++) {
      const k = t / len;
      const d = this.sample(ax + dx * k, ay + dy * k, az + dz * k);
      if (d > 0.02) return 0;
      // grazing a corner lets a little through, not all of it
      worst = Math.min(worst, clamp01(-d / 0.35 + 0.15));
      t += Math.max(0.3, -d * 0.9);
    }
    return worst;
  }
}

// ------------------------------------------------------------------ surface nets

export interface RockMesh {
  /** xyz per vertex */
  position: Float32Array;
  /** triangles on the floor of the level, then everything else */
  floor: Uint32Array;
  walls: Uint32Array;
}

/**
 * Surface nets over the samples. Quads are wound so their faces look into
 * the air - the walker's capsule test and the renderer both go by that.
 */
export function mesh(s: Samples): RockMesh {
  const { nx, ny, nz, v } = s;
  const cx = nx - 1, cy = ny - 1;
  const cellVert = new Int32Array(cx * cy * (nz - 1)).fill(-1);
  const pos: number[] = [];
  const cidx = (i: number, j: number, k: number) => (k * cy + j) * cx + i;
  const at = (i: number, j: number, k: number) => v[(k * ny + j) * nx + i];

  // corners of a cell, and the twelve edges between them
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float64Array(8);

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corner[c];
          val[c] = at(i + a, j + b, k + d);
          if (val[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [p, q] of edges) {
          const vp = val[p], vq = val[q];
          if ((vp < 0) === (vq < 0)) continue;
          const t = vp / (vp - vq);
          const [pa, pb, pd] = corner[p], [qa, qb, qd] = corner[q];
          sx += pa + (qa - pa) * t;
          sy += pb + (qb - pb) * t;
          sz += pd + (qd - pd) * t;
          n++;
        }
        cellVert[cidx(i, j, k)] = pos.length / 3;
        pos.push(X0 + (i + sx / n) * CELL, Y0 + (j + sy / n) * CELL, Z0 + (k + sz / n) * CELL);
      }
    }
  }

  const floor: number[] = [];
  const walls: number[] = [];
  const P = pos;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // split along the shorter diagonal
    const d1 = dist2(P, a, c), d2 = dist2(P, b, d);
    const tris = d1 <= d2 ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
    for (let t = 0; t < 6; t += 3) {
      const [p, q, r] = [tris[t], tris[t + 1], tris[t + 2]];
      const flat = Math.abs(P[p * 3 + 1]) < 0.02 && Math.abs(P[q * 3 + 1]) < 0.02 && Math.abs(P[r * 3 + 1]) < 0.02;
      (flat ? floor : walls).push(p, q, r);
    }
  };

  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = at(i, j, k);
        const in0 = v0 < 0;
        // edge along x, from (i,j,k) to (i+1,j,k): the four cells round it
        if (i < nx - 1 && in0 !== (at(i + 1, j, k) < 0)) {
          quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], in0);
        }
        if (j < ny - 1 && in0 !== (at(i, j + 1, k) < 0)) {
          quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], in0);
        }
        if (k < nz - 1 && in0 !== (at(i, j, k + 1) < 0)) {
          quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], in0);
        }
      }
    }
  }
  return { position: new Float32Array(pos), floor: new Uint32Array(floor), walls: new Uint32Array(walls) };
}

function dist2(P: number[], a: number, b: number) {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

// ------------------------------------------------------------------ the plan

export interface Plan {
  /** 1 where there is air at waist height, 2 where it is a stope's hole */
  cells: Uint8Array;
  w: number; h: number;
  /** metres a cell, and where cell 0,0 is */
  step: number; x0: number; z0: number;
}

/** The level plan: a slice through the field at waist height, for the minimap. */
export function plan(field: Field, step = 0.5): Plan {
  const w = Math.round((X1 - X0) / step), h = Math.round((Z1 - Z0) / step);
  const cells = new Uint8Array(w * h);
  for (let k = 0; k < h; k++) {
    for (let i = 0; i < w; i++) {
      const x = X0 + (i + 0.5) * step, z = Z0 + (k + 0.5) * step;
      if (field.at(x, 1.0, z) >= 0) continue;
      cells[k * w + i] = field.at(x, -1.5, z) < 0 ? 2 : 1;
    }
  }
  return { cells, w, h, step, x0: X0, z0: Z0 };
}
