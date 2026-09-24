// Draw the 760 Level's plan straight from its distance field, as a PNG.
//
//   npx esbuild tools/mineplan.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/mineplan.mjs
//   node node_modules/.cache/mineplan.mjs [out.png]
//
// For laying the level out: no browser, no renderer, just the slice through
// the field at waist height that the minimap draws, with the bases, stopes,
// spawns and pickups marked on it.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Field, plan } from '../src/arena/mine/level';
import { BASES, PICKUPS, PROPS } from '../src/arena/shared/mine';

const out = process.argv[2] ?? '.shots/mineplan.png';
const t0 = Date.now();
const field = new Field();
const P = plan(field, 0.25);
console.log(`plan ${P.w} x ${P.h} in ${Date.now() - t0} ms`);

const W = P.w, H = P.h;
const img = new Uint8Array(W * H * 3);
const put = (i: number, k: number, c: [number, number, number]) => {
  if (i < 0 || k < 0 || i >= W || k >= H) return;
  img.set(c, (k * W + i) * 3);
};
for (let k = 0; k < H; k++) {
  for (let i = 0; i < W; i++) {
    const c = P.cells[k * W + i];
    const edge = c && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !P.cells[(k + b) * W + i + a]);
    put(i, k, edge ? [20, 20, 20] : c === 2 ? [150, 170, 200] : c ? [235, 232, 222] : [255, 255, 255]);
  }
}
const dot = (x: number, z: number, r: number, c: [number, number, number]) => {
  const ci = (x - P.x0) / P.step, ck = (z - P.z0) / P.step, rr = r / P.step;
  for (let k = Math.floor(ck - rr); k <= ck + rr; k++) {
    for (let i = Math.floor(ci - rr); i <= ci + rr; i++) {
      if ((i - ci) ** 2 + (k - ck) ** 2 <= rr * rr) put(i, k, c);
    }
  }
};
BASES.forEach((b, t) => {
  const c: [number, number, number] = t ? [40, 140, 255] : [255, 150, 30];
  dot(b.home[0], b.home[2], 1.2, c);
  dot(b.pour[0], b.pour[1], 0.7, [200, 30, 30]);
  for (const [x, z] of b.spawns) dot(x, z, 0.5, c);
});
for (const p of PICKUPS) dot(p.x, p.z, 0.6, p.kind === 'cake' ? [190, 140, 60] : [90, 100, 110]);
for (const p of PROPS) dot(p.x, p.z, 0.4, [120, 60, 160]);

// PNG: one IDAT, no filtering
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let k = 0; k < H; k++) {
  raw[k * (W * 3 + 1)] = 0;
  Buffer.from(img.buffer, k * W * 3, W * 3).copy(raw, k * (W * 3 + 1) + 1);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
fs.mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`wrote ${out}`);
