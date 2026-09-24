// Check both arena maps against their baked collision worlds.
//
//   npm run verify:arena     (runs this first)
//
// Props are placed by eye and the plant is placed by code, so this makes
// sure the two agree where it matters:
//   - every spawn is open standing room with floor under it,
//   - every pickup lies on something, with room to stand over it and reach it,
// and in the mine, where it is a team game on a level carved from rock:
//   - each barrow's fill point is open floor you can stand at,
//   - every spawn can walk to its own barrow and to the other crew's stope,
//   - and nobody can walk past the barricade into a stope.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import * as THREE from 'three';
import { TriangleGrid, gridHash } from '../src/view/grid';
import { MAPS, type MapDef } from '../src/arena/shared/maps';
import { BODY, PICK_REACH, BARROW } from '../src/arena/shared/rules';

let failed = 0;
const R = BODY.r, H = BODY.h;
const report = (ok: boolean, line: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
};

function load(world: string) {
  const raw = zlib.gunzipSync(fs.readFileSync(`server/worlds/${world}.bin.gz`));
  const tris = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const grid = new TriangleGrid();
  grid.addArray(tris);
  grid.finish();
  return grid;
}

function check(map: MapDef) {
  const grid = load(map.world);
  console.log(`\n${map.name}: world ${gridHash(grid.triangles())}`);
  const B = map.bounds;

  /** the floor under (x, z), searching down from `from` */
  const floor = (x: number, z: number, from: number, to: number) => {
    const hit = grid.segment(x, from, z, x, to, z);
    return hit && hit.ny > 0.5 ? from + (to - from) * hit.t : null;
  };
  /** is a person-sized capsule with its feet at y clear of everything? */
  const clear = (x: number, y: number, z: number) => {
    const cap = new Capsule(new THREE.Vector3(x, y + R, z), new THREE.Vector3(x, y + H - R, z), R);
    return !grid.capsuleIntersect(cap);
  };
  const standable = (x: number, z: number) => {
    const f = floor(x, z, 2, -2);
    return f !== null && Math.abs(f) < 0.1 && clear(x, f + 0.05, z);
  };

  for (const [x, z] of map.spawns) {
    const f = floor(x, z, 2, -2);
    const inside = x > B.x0 + R && x < B.x1 - R && z > B.z0 + R && z < B.z1 - R;
    const ok = f !== null && Math.abs(f) < 0.1 && clear(x, (f ?? 0) + 0.05, z) && inside;
    report(ok, `spawn ${x}, ${z}${f === null ? '  no floor' : `  floor ${f.toFixed(2)}`}${inside ? '' : '  outside the fence'}`);
  }

  for (const p of map.pickups) {
    const f = floor(p.x, p.z, p.y + 1.5, p.y - 1.5);
    // somewhere to stand within reach: straight over it, or a step to the side
    let stand: [number, number, number] | null = null;
    for (const [dx, dz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
      const sf = floor(p.x + dx, p.z + dz, p.y + 1.5, p.y - 1.5);
      if (sf !== null && clear(p.x + dx, sf + 0.05, p.z + dz)) { stand = [p.x + dx, sf, p.z + dz]; break; }
    }
    const lies = f !== null && Math.abs(f - p.y) < 0.35;
    const reach = !!stand && Math.hypot(stand[0] - p.x, stand[2] - p.z) <= PICK_REACH.across && Math.abs(stand[1] - p.y) <= PICK_REACH.up;
    report(lies && reach, `${p.kind.padEnd(4)} ${p.x}, ${p.y}, ${p.z}  floor ${f === null ? 'none' : f.toFixed(2)}${reach ? '' : '  nowhere to stand'}`);
  }

  if (!map.bases) return;

  // ---- the level as walkable cells, flooded out from each crew's spawns
  const S = 0.5;
  const w = Math.ceil((B.x1 - B.x0) / S), h = Math.ceil((B.z1 - B.z0) / S);
  const walk = new Uint8Array(w * h);
  const t0 = Date.now();
  for (let k = 0; k < h; k++) {
    for (let i = 0; i < w; i++) {
      if (standable(B.x0 + (i + 0.5) * S, B.z0 + (k + 0.5) * S)) walk[k * w + i] = 1;
    }
  }
  const cell = (x: number, z: number) => Math.floor((x - B.x0) / S) + Math.floor((z - B.z0) / S) * w;
  const flood = (x: number, z: number) => {
    const seen = new Uint8Array(w * h);
    const q = [cell(x, z)];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop()!;
      const i = c % w, k = (c - i) / w;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= w || kk >= h) continue;
        const n = kk * w + ii;
        if (walk[n] && !seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return seen;
  };
  /** can you get within `r` of (x, z) from the flood? */
  const near = (seen: Uint8Array, x: number, z: number, r: number) => {
    for (let dz = -r; dz <= r; dz += S) {
      for (let dx = -r; dx <= r; dx += S) {
        if (Math.hypot(dx, dz) <= r && seen[cell(x + dx, z + dz)]) return true;
      }
    }
    return false;
  };
  const open = walk.reduce((s, v) => s + v, 0);
  console.log(`     ${open} walkable cells of ${w * h} (${(open * S * S).toFixed(0)} m2), ${Date.now() - t0} ms`);

  map.bases.forEach((b, t) => {
    const crew = t ? 'night' : 'day';
    const [hx, , hz] = b.home;
    report(standable(hx, hz), `${crew} fill point ${hx}, ${hz}  open floor`);
    const other = map.bases![1 - t];
    for (const [x, z] of b.spawns) {
      const seen = flood(x, z);
      const home = near(seen, hx, hz, BARROW.reach - 0.2);
      const pour = near(seen, other.pour[0], other.pour[1], BARROW.pour - 0.3);
      report(home && pour, `${crew} from ${x}, ${z}: ${home ? 'reaches' : 'CANNOT REACH'} its barrow, ${pour ? 'reaches' : 'CANNOT REACH'} the ${t ? 'day' : 'night'} stope`);
    }
    // two metres past the brow, into the stope: nobody should ever get there on foot
    const seen = flood(b.spawns[0][0], b.spawns[0][1]);
    const inX = b.brow[0] + b.into[0] * 2, inZ = b.brow[1] + b.into[1] * 2;
    const fenced = !near(seen, inX, inZ, 1.2) && !near(flood(other.spawns[0][0], other.spawns[0][1]), inX, inZ, 1.2);
    report(fenced, `${crew} stope barricaded - nobody walks in`);
  });
}

for (const m of Object.values(MAPS)) check(m);
console.log(failed ? `\n${failed} failed` : '\nmaps ok');
process.exit(failed ? 1 : 0);
