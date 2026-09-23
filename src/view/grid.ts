import * as THREE from 'three';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import type { Capsule } from 'three/examples/jsm/math/Capsule.js';

/**
 * The triangles a walker can touch, bucketed into a uniform grid.
 *
 * three's Octree does the same job, but building one takes seconds on a plant
 * this size, and this has to be built the moment someone steps outside. A
 * grid is one pass: every triangle goes into the cells its bounding box
 * covers. The few that would cover dozens of cells - the ground, the pad, a
 * tank wall - go on a short list of their own and are checked by bounding
 * box instead. The capsule test itself is three's, borrowed from an empty
 * Octree.
 *
 * Nothing in here touches the DOM, so the arena server runs the same grid
 * over the same triangles, baked out of the page by tools/bake.mjs.
 */
export class TriangleGrid {
  private static readonly S = 1.5;
  private cells = new Map<number, number[]>();
  /** nine floats a triangle */
  private pos = new Float32Array(9 * 4096);
  private n = 0;
  private big: number[] = [];
  /** six floats a big triangle: min xyz, max xyz */
  private bigBox: number[] = [];
  private seen = new Uint32Array(0);
  private mark = 0;
  private test = new Octree();
  private tri = new THREE.Triangle();
  private _c: Capsule | null = null;
  private _box = new THREE.Box3();
  private _list: number[] = [];

  private key(x: number, y: number, z: number) {
    return ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
  }

  get size() { return this.n; }

  add(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    this.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  /** a whole baked set at once: nine floats a triangle */
  addArray(tris: Float32Array) {
    for (let i = 0; i + 8 < tris.length; i += 9) {
      this.push(tris[i], tris[i + 1], tris[i + 2], tris[i + 3], tris[i + 4], tris[i + 5], tris[i + 6], tris[i + 7], tris[i + 8]);
    }
  }

  private push(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
  ) {
    const i = this.n++;
    if (this.pos.length < this.n * 9) {
      const grown = new Float32Array(this.pos.length * 2);
      grown.set(this.pos);
      this.pos = grown;
    }
    const p = this.pos, o = i * 9;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;

    const S = TriangleGrid.S;
    const x0 = Math.floor(Math.min(ax, bx, cx) / S), x1 = Math.floor(Math.max(ax, bx, cx) / S);
    const y0 = Math.floor(Math.min(ay, by, cy) / S), y1 = Math.floor(Math.max(ay, by, cy) / S);
    const z0 = Math.floor(Math.min(az, bz, cz) / S), z1 = Math.floor(Math.max(az, bz, cz) / S);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 48) {
      this.big.push(i);
      this.bigBox.push(
        Math.min(ax, bx, cx), Math.min(ay, by, cy), Math.min(az, bz, cz),
        Math.max(ax, bx, cx), Math.max(ay, by, cy), Math.max(az, bz, cz),
      );
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const k = this.key(x, y, z);
          const cell = this.cells.get(k);
          if (cell) cell.push(i); else this.cells.set(k, [i]);
        }
      }
    }
  }

  finish() {
    this.seen = new Uint32Array(this.n);
  }

  /** every triangle, nine floats each - what the bake writes out */
  triangles(): Float32Array {
    return this.pos.subarray(0, this.n * 9);
  }

  /** The triangles whose boxes touch this one, each once. */
  private gather(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    const S = TriangleGrid.S;
    const list = this._list;
    list.length = 0;
    if (++this.mark === 0xffffffff) { this.seen.fill(0); this.mark = 1; }
    for (let x = Math.floor(minX / S); x <= Math.floor(maxX / S); x++) {
      for (let y = Math.floor(minY / S); y <= Math.floor(maxY / S); y++) {
        for (let z = Math.floor(minZ / S); z <= Math.floor(maxZ / S); z++) {
          const cell = this.cells.get(this.key(x, y, z));
          if (!cell) continue;
          for (const i of cell) {
            if (this.seen[i] === this.mark) continue;
            this.seen[i] = this.mark;
            list.push(i);
          }
        }
      }
    }
    const bb = this.bigBox;
    for (let j = 0; j < this.big.length; j++) {
      const o = j * 6;
      if (bb[o] > maxX || bb[o + 3] < minX || bb[o + 1] > maxY || bb[o + 4] < minY || bb[o + 2] > maxZ || bb[o + 5] < minZ) continue;
      list.push(this.big[j]);
    }
    return list;
  }

  private load(i: number) {
    const p = this.pos, o = i * 9, t = this.tri;
    t.a.set(p[o], p[o + 1], p[o + 2]);
    t.b.set(p[o + 3], p[o + 4], p[o + 5]);
    t.c.set(p[o + 6], p[o + 7], p[o + 8]);
    return t;
  }

  /** Same contract as Octree.capsuleIntersect: the push out, or false. */
  capsuleIntersect(capsule: Capsule): { normal: THREE.Vector3; depth: number } | false {
    // Capsule.copy returns nothing, whatever its typings say
    const cap = this._c ??= capsule.clone();
    cap.copy(capsule);
    const r = cap.radius;
    const box = this._box.makeEmpty().expandByPoint(cap.start).expandByPoint(cap.end).expandByScalar(r + 0.05);
    const list = this.gather(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);

    let hit = false;
    for (const i of list) {
      const res = this.test.triangleCapsuleIntersect(cap, this.load(i));
      if (res) {
        hit = true;
        cap.translate(res.normal.multiplyScalar(res.depth));
      }
    }
    if (!hit) return false;
    const push = cap.getCenter(new THREE.Vector3()).sub(capsule.getCenter(new THREE.Vector3()));
    const depth = push.length();
    if (depth < 1e-9) return false;
    return { normal: push.normalize(), depth };
  }

  /**
   * The first triangle on the segment a -> b, as a fraction of the way along
   * it and the face normal turned to meet the segment; null for a clear run.
   * This is what a lump of paste in flight asks every sub-step.
   */
  segment(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  ): { t: number; nx: number; ny: number; nz: number } | null {
    const E = 0.01;
    const list = this.gather(
      Math.min(ax, bx) - E, Math.min(ay, by) - E, Math.min(az, bz) - E,
      Math.max(ax, bx) + E, Math.max(ay, by) + E, Math.max(az, bz) + E,
    );
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const p = this.pos;
    let best = 2, bi = -1;
    for (const i of list) {
      // Moller-Trumbore, both faces
      const o = i * 9;
      const x0 = p[o], y0 = p[o + 1], z0 = p[o + 2];
      const e1x = p[o + 3] - x0, e1y = p[o + 4] - y0, e1z = p[o + 5] - z0;
      const e2x = p[o + 6] - x0, e2y = p[o + 7] - y0, e2z = p[o + 8] - z0;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det;
      const sx = ax - x0, sy = ay - y0, sz = az - z0;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t < 0 || t > 1 || t >= best) continue;
      best = t;
      bi = i;
    }
    if (bi < 0) return null;
    const o = bi * 9;
    const e1x = p[o + 3] - p[o], e1y = p[o + 4] - p[o + 1], e1z = p[o + 5] - p[o + 2];
    const e2x = p[o + 6] - p[o], e2y = p[o + 7] - p[o + 1], e2z = p[o + 8] - p[o + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    return { t: best, nx, ny, nz };
  }
}

/**
 * A fingerprint of a set of triangles, to the centimetre. The arena server
 * sends the one it baked, and a page whose own plant comes out different
 * says so in the console - the usual cause is a change to the plant without
 * a fresh `npm run bake`.
 */
export function gridHash(tris: Float32Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < tris.length; i++) {
    let v = Math.round(tris[i] * 100) | 0;
    for (let k = 0; k < 4; k++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + (tris.length / 9);
}
