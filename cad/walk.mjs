// On-foot check for the ?cad plant, on the real GPU: how long the collision
// survey takes, where F and H put you, what a frame of walking costs, and
// whether every stair can be climbed - each tower walked from its first step
// to its top, flight by flight, along the ramps the converter laid.
//
//   node cad/walk.mjs [url] [outPrefix]

import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:5181/?cad&look=day';
const OUT = process.argv[3] || '.shots/walk';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // the stair walk is one long call into the page
  protocolTimeout: 1200000,
  args: ['--no-sandbox', '--window-size=1600,900', '--ignore-gpu-blocklist', '--enable-webgl',
    '--use-angle=d3d11', '--enable-gpu-rasterization', '--force_high_performance_gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction('window.CAD', { timeout: 180000 });
await sleep(1500);

// headless has no pointer lock to give, so the walker starts paused; unpause it
const unpause = () => page.evaluate(() => { window.CAD.foot.walker.paused = false; });
const where = () => page.evaluate(() => {
  const w = window.CAD.foot.walker, f = w.feet;
  return `feet (${f.x.toFixed(1)}, ${f.y.toFixed(2)}, ${f.z.toFixed(1)})${w.grounded ? '' : ' in the air'}`;
});
const info = () => page.$eval('#cad-info', (d) => d.textContent.split('\n')[2]);
const aim = () => page.$eval('#walk .prompt', (d) => (d.classList.contains('show') ? d.textContent : '-'));
const report = async (what) => console.log(`${what}: ${await where()} | ${await info()} | crosshair: ${await aim()}`);

await page.keyboard.press('f');
await page.waitForFunction('window.CAD.foot.walking', { timeout: 60000 });
await unpause();
await sleep(1500);
await report('F from view 1');
await page.screenshot({ path: `${OUT}-drop.png` });

await page.keyboard.press('h');
await sleep(1500);
await report('H');
await page.screenshot({ path: `${OUT}-home.png` });

await page.keyboard.down('w');
await sleep(3000);
await page.keyboard.up('w');
await report('3 s of W');
await page.screenshot({ path: `${OUT}-walked.png` });

const cost = await page.evaluate(() => {
  const w = window.CAD.foot.walker;
  w.keys.add('KeyW');
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) w.update(1 / 60);
  w.keys.delete('KeyW');
  return ((performance.now() - t0) / 200).toFixed(2);
});
console.log(`walker.update: ${cost} ms a frame, walking`);

// every stair tower, first step to top
const towers = await page.evaluate(async () => {
  const { model, foot, THREE } = window.CAD;
  const w = foot.walker;
  let aids = null;
  model.traverse((o) => { if (o.isMesh && o.userData.cls === 'ramp') aids = o; });
  if (!aids) return null;
  // the sloped quads are the ramps; their low and high edges are foot and head
  const pos = aids.geometry.getAttribute('position'), idx = aids.geometry.index;
  const v = (i) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(aids.matrixWorld);
  const planes = new Map();
  for (let i = 0; i < idx.count; i += 3) {
    const a = v(i), b = v(i + 1), c = v(i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.y > 0.97 || n.y < 0.3) continue;
    const key = [n.x, n.y, n.z].map((x) => x.toFixed(2)).join() + '|' + n.dot(a).toFixed(1);
    (planes.get(key) || planes.set(key, []).get(key)).push(a, b, c);
  }
  const mean = (ps) => ps.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length);
  const flights = [...planes.values()].map((pts) => {
    const lo = Math.min(...pts.map((p) => p.y)), hi = Math.max(...pts.map((p) => p.y));
    return { b: mean(pts.filter((p) => p.y < lo + 0.02)), t: mean(pts.filter((p) => p.y > hi - 0.02)) };
  }).sort((p, q) => p.b.y - q.b.y);
  // a tower is every flight within a few metres, in plan, of another in it
  const groups = [];
  for (const f of flights) {
    const mid = f.b.clone().lerp(f.t, 0.5).setY(0);
    const g = groups.find((g) => g.some((o) => o.b.clone().lerp(o.t, 0.5).setY(0).distanceTo(mid) < 6));
    if (g) g.push(f); else groups.push([f]);
  }
  /** Walk up these flights in turn from a step before the first; '' for made it. */
  const follow = async (g) => {
    // on to each landing, to turn for the next flight; the last one only has
    // to be climbed - its top may open sideways onto a platform
    const way = g.flatMap((f, i) => {
      const d = new THREE.Vector3(f.t.x - f.b.x, 0, f.t.z - f.b.z).normalize();
      return [f.b.clone().addScaledVector(d, -0.3), f.t.clone().addScaledVector(d, i < g.length - 1 ? 0.5 : 0)];
    });
    const d0 = new THREE.Vector3().subVectors(g[0].t, g[0].b).setY(0).normalize();
    w.paused = false;
    w.teleport(g[0].b.clone().addScaledVector(d0, -0.6).setY(g[0].b.y + 0.05), Math.atan2(-d0.x, -d0.z));
    let k = 0, since = performance.now(), stuck = '';
    await new Promise((done) => {
      const tick = () => {
        const f = w.feet, target = way[k];
        const dx = target.x - f.x, dz = target.z - f.z;
        if (Math.hypot(dx, dz) < 0.3 && Math.abs(target.y - f.y) < 0.4) {
          k++; since = performance.now();
          if (k === way.length) { w.keys.delete('KeyW'); return done(); }
        } else if (performance.now() - since > 7000) {
          stuck = `stuck at (${f.x.toFixed(1)}, ${f.y.toFixed(2)}, ${f.z.toFixed(1)})`;
          w.keys.delete('KeyW');
          return done();
        }
        w.yaw = Math.atan2(-dx, -dz);
        w.keys.add('KeyW');
        requestAnimationFrame(tick);
      };
      tick();
    });
    return stuck;
  };
  const out = [];
  for (const g of groups) {
    let stuck = await follow(g);
    // not every cluster is one tower - two short stairs side by side are not
    // one route - so where the whole run fails, try its flights one by one
    if (stuck && g.length > 1) {
      let ok = 0;
      for (const f of g) ok += (await follow([f])) ? 0 : 1;
      stuck = `not one route; ${ok}/${g.length} flights climbed on their own`;
    }
    out.push(`${g.length} flights from (${g[0].b.x.toFixed(0)}, ${g[0].b.z.toFixed(0)}), `
      + `${g[0].b.y.toFixed(2)} -> ${g.at(-1).t.y.toFixed(2)} m: ${stuck || 'climbed'}`);
  }
  return out;
});
// off your feet again: orbit back, from where you were standing
await page.keyboard.press('f');
await sleep(800);
console.log('F again:', JSON.stringify(await page.evaluate(() => {
  const { stage, foot } = window.CAD;
  return { walking: foot.walking, orbit: stage.controls.enabled && !stage.manual, near: stage.camera.near, fov: stage.camera.fov };
})));
await page.screenshot({ path: `${OUT}-after.png` });

if (!towers) console.log('no stair ramps in this model - reconvert with cad/convert.py');
else for (const t of towers) console.log(`stairs: ${t}`);

console.log(logs.filter((l) => !/vite|DevTools/.test(l)).slice(0, 20).join('\n') || '(console clean)');
await browser.close();
