// Plan the Paste Wars map on a converted plant: flood every floor a walker
// can reach from the ground, then choose spawns round the edge and pickups
// spread over the ground and the upper floors. Prints them as the data for
// src/arena/shared/cad.ts.
//
//   node cad/arenaplan.mjs [url]        (the dev server, ?cad, with the model in public/local)

import puppeteer from 'puppeteer-core';

const URL = process.argv[2] || 'http://localhost:5181/?cad';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', protocolTimeout: 600000,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction('window.CAD', { timeout: 180000 });
if (process.env.DEBUG) await page.evaluate((d) => { window.__debug = d; }, process.env.DEBUG.split(',').map(Number));
await page.keyboard.press('f');
await page.waitForFunction('window.CAD.foot.survey', { timeout: 60000 });

const plan = await page.evaluate(() => {
  const { foot, model, THREE } = window.CAD;
  const s = foot.survey, g = s.grid;
  const box = new THREE.Box3().setFromObject(model);
  const C = 0.5;                                   // cell, m
  const x0 = Math.floor(box.min.x) - 6, x1 = Math.ceil(box.max.x) + 6;
  const z0 = Math.floor(box.min.z) - 6, z1 = Math.ceil(box.max.z) + 6;
  const nx = Math.round((x1 - x0) / C), nz = Math.round((z1 - z0) / C);

  // every surface you could stand on in each column, top down
  const hit = (ax, ay, az, bx, by, bz) => {
    const h = g.segment(ax, ay, az, bx, by, bz);
    return h ? { y: ay + (by - ay) * h.t, ny: h.ny, ...s.owner(g.hit) } : null;
  };
  const down = (x, y, z, depth) => {
    for (let a = y; a > y - depth; a -= 1.5) {
      const h = hit(x, a, z, x, a - 1.5, z);
      if (h) return h;
    }
    return null;
  };
  const cols = [];                                  // per column: [{ y, cls, unit }]
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * C, z = z0 + (k + 0.5) * C;
      const list = [];
      let top = box.max.y + 2;
      for (let n = 0; n < 48; n++) {
        const h = down(x, top, z, top + 3);
        if (!h) break;
        if (h.ny > 0.6) list.push({ y: h.y, cls: h.cls, unit: h.unit });
        top = h.y - 0.05;
        if (top < -1) break;
      }
      cols.push(list);
    }
  }

  // stand here: 1.2 m clear above - the walker ducks the rest
  const room = (x, y, z) => !hit(x, y + 0.05, z, x, y + 1.2, z);
  const nodes = [];                                 // { i, k, y, cls, unit }
  const at = new Map();
  cols.forEach((list, c) => {
    const i = c % nx, k = Math.floor(c / nx);
    const x = x0 + (i + 0.5) * C, z = z0 + (k + 0.5) * C;
    for (const f of list) {
      if (!room(x, f.y, z)) continue;
      const id = nodes.length;
      nodes.push({ i, k, x, z, ...f });
      (at.get(c) || at.set(c, []).get(c)).push(id);
    }
  });

  // flood from the ground at the fence line
  const reach = new Uint8Array(nodes.length);
  const q = [];
  for (const [id, n] of nodes.entries()) {
    if ((n.i === 0 || n.k === 0 || n.i === nx - 1 || n.k === nz - 1) && n.cls === 'ground') { reach[id] = 1; q.push(id); }
  }
  const clear = (a, b) => {
    for (const up of [0.5, 1.0]) {
      const y = Math.max(a.y, b.y) + up;
      if (hit(a.x, y, a.z, b.x, y, b.z)) return false;
    }
    return true;
  };
  while (q.length) {
    const a = nodes[q.pop()];
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = a.i + di, k = a.k + dk;
      if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
      for (const id of at.get(k * nx + i) ?? []) {
        const b = nodes[id];
        // a kerb you step up; a ramp is a slope, up to 50 degrees
        const climb = a.cls === 'ramp' || b.cls === 'ramp' ? C * 1.2 : 0.45;
        if (reach[id] || Math.abs(b.y - a.y) > climb || !clear(a, b)) continue;
        reach[id] = 1;
        q.push(id);
      }
    }
  }
  const reached = nodes.filter((_, id) => reach[id]);
  // DEBUG=x0,x1,z0,z1: each cell's highest reached floor (dm, a-z past 9) over its highest unreached one
  let debug = '';
  if (window.__debug) {
    const [dx0, dx1, dz0, dz1] = window.__debug;
    const ch = (y) => (y === undefined ? '.' : y < 1 ? '0' : y < 10 ? String(Math.floor(y)) : String.fromCharCode(87 + Math.min(35, Math.floor(y))));
    for (let k = 0; k < nz; k++) {
      const z = z0 + (k + 0.5) * C;
      if (z < dz0 || z > dz1) continue;
      let r1 = '', r2 = '';
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * C;
        if (x < dx0 || x > dx1) continue;
        const ids = at.get(k * nx + i) ?? [];
        const rs = ids.filter((id) => reach[id]).map((id) => nodes[id].y);
        const us = ids.filter((id) => !reach[id]).map((id) => nodes[id].y);
        r1 += ch(rs.length ? Math.max(...rs) : undefined);
        r2 += ch(us.length ? Math.max(...us) : undefined);
      }
      debug += z.toFixed(1).padStart(6) + ' ' + r1 + '   ' + r2 + '\n';
    }
  }
  const levels = {};
  for (const n of reached) { const l = Math.round(n.y); levels[l] = (levels[l] || 0) + 1; }
  return { x0, x1, z0, z1, nx, nz, box: [box.min.toArray(), box.max.toArray()], reached, levels, debug };
});
await browser.close();

const { reached, levels } = plan;
console.log(`plant ${plan.box.map((v) => v.map((n) => n.toFixed(1)).join(',')).join(' .. ')}`);
console.log('reachable floor, by level (m: cells):', JSON.stringify(levels));
if (plan.debug) console.log(plan.debug);

// far apart: each pick the point furthest from everything picked so far
function spread(pool, n, taken = []) {
  const out = [];
  const all = [...taken];
  for (let j = 0; j < n && pool.length; j++) {
    let best = null, bd = -1;
    for (const p of pool) {
      const d = all.length ? Math.min(...all.map((q) => Math.hypot(p.x - q.x, p.z - q.z) + 3 * Math.abs(p.y - q.y))) : 0;
      if (d > bd) { bd = d; best = p; }
    }
    out.push(best); all.push(best);
  }
  return out;
}
// open ground: nothing standable within a metre is higher than a kerb
const key = (i, k) => `${i},${k}`;
const byCell = new Map();
for (const n of reached) (byCell.get(key(n.i, n.k)) || byCell.set(key(n.i, n.k), []).get(key(n.i, n.k))).push(n);
const open = (n, r) => {
  for (let di = -r; di <= r; di++) for (let dk = -r; dk <= r; dk++) {
    const same = (byCell.get(key(n.i + di, n.k + dk)) ?? []).some((m) => Math.abs(m.y - n.y) <= 0.05);
    if (!same) return false;
  }
  return true;
};

const B = { x0: plan.x0 + 1, x1: plan.x1 - 1, z0: plan.z0 + 1, z1: plan.z1 - 1 };
const edge = reached.filter((n) => n.cls === 'ground' && open(n, 2)
  && Math.min(n.x - B.x0, B.x1 - n.x, n.z - B.z0, B.z1 - n.z) < 3 && Math.min(n.x - B.x0, B.x1 - n.x, n.z - B.z0, B.z1 - n.z) > 1.5);
const spawns = spread(edge, 16);
// the floors worth a climb, two pickups each, and the rest on the ground
const inner = (n) => Math.min(n.x - B.x0, B.x1 - n.x, n.z - B.z0, B.z1 - n.z) > 6;
const ground = reached.filter((n) => n.y < 1.5 && (n.cls === 'ground' || n.cls === 'concrete') && open(n, 2) && inner(n));
const high = reached.filter((n) => n.y >= 1.5 && open(n, 1));
const floors = [[5, 8.5], [9, 10.5], [13.5, 15], [18, 19.5]];
const up = [];
for (const [lo, hi] of floors) up.push(...spread(high.filter((n) => n.y >= lo && n.y < hi), 2, up));
const low = spread(ground, 16 - up.length, up);

const r2 = (v) => Math.round(v * 100) / 100;
console.log(`\nBOUNDS ${JSON.stringify(B)}`);
console.log('SPAWNS ' + JSON.stringify(spawns.map((n) => [r2(n.x), r2(n.z)])));
console.log('PICKUPS');
[...up, ...low].forEach((n, j) => console.log(`  { kind: '${j % 2 ? 'rock' : 'cake'}', x: ${r2(n.x)}, y: ${r2(n.y)}, z: ${r2(n.z)} }, // ${n.unit || 'ground'}/${n.cls}`));
