// Check the arena map against the baked collision world.
//
//   npm run verify:arena     (runs this first)
//
// Props are placed by eye and the plant is placed by code, so this makes
// sure the two agree where it matters:
//   - every spawn is open standing room with floor under it, and
//   - every pickup lies on something, with room to stand over it and reach it.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import * as THREE from 'three';
import { TriangleGrid, gridHash } from '../src/view/grid';
import { SPAWNS, PICKUPS, BOUNDS } from '../src/arena/shared/map';
import { BODY, PICK_REACH } from '../src/arena/shared/rules';

const raw = zlib.gunzipSync(fs.readFileSync('server/worlds/arena.bin.gz'));
const tris = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const grid = new TriangleGrid();
grid.addArray(tris);
grid.finish();
console.log(`world ${gridHash(grid.triangles())}`);

let failed = 0;
const R = BODY.r, H = BODY.h;

/** the floor under (x, z), searching down from `from` */
function floor(x: number, z: number, from: number, to: number) {
  const hit = grid.segment(x, from, z, x, to, z);
  return hit && hit.ny > 0.5 ? from + (to - from) * hit.t : null;
}

/** is a person-sized capsule with its feet at y clear of everything? */
function clear(x: number, y: number, z: number) {
  const cap = new Capsule(new THREE.Vector3(x, y + R, z), new THREE.Vector3(x, y + H - R, z), R);
  return !grid.capsuleIntersect(cap);
}

for (const [x, z] of SPAWNS) {
  const f = floor(x, z, 2, -2);
  const inside = x > BOUNDS.x0 + R && x < BOUNDS.x1 - R && z > BOUNDS.z0 + R && z < BOUNDS.z1 - R;
  const ok = f !== null && Math.abs(f) < 0.1 && clear(x, (f ?? 0) + 0.05, z) && inside;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} spawn ${x}, ${z}${f === null ? '  no floor' : `  floor ${f.toFixed(2)}`}${inside ? '' : '  outside the fence'}`);
}

for (const p of PICKUPS) {
  const f = floor(p.x, p.z, p.y + 1.5, p.y - 1.5);
  // somewhere to stand within reach: straight over it, or a step to the side
  let stand: [number, number, number] | null = null;
  for (const [dx, dz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
    const sf = floor(p.x + dx, p.z + dz, p.y + 1.5, p.y - 1.5);
    if (sf !== null && clear(p.x + dx, sf + 0.05, p.z + dz)) { stand = [p.x + dx, sf, p.z + dz]; break; }
  }
  const lies = f !== null && Math.abs(f - p.y) < 0.35;
  const reach = !!stand && Math.hypot(stand[0] - p.x, stand[2] - p.z) <= PICK_REACH.across && Math.abs(stand[1] - p.y) <= PICK_REACH.up;
  const ok = lies && reach;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${p.kind.padEnd(4)} ${p.x}, ${p.y}, ${p.z}  floor ${f === null ? 'none' : f.toFixed(2)}${reach ? '' : '  nowhere to stand'}`);
}

console.log(failed ? `\n${failed} failed` : '\nmap ok');
process.exit(failed ? 1 : 0);
