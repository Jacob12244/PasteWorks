// Two pages in the mine at once, in a headless browser: the barrow game end to end.
//
//   node tools/minepage.mjs [outdir]
//
// Needs the dev server on :5180 and the arena server on :8481 (npm run arena).
// Like tools/arenapage.mjs, the walkers are unpaused by hand and walked in
// short steps the server will believe. Day's page takes its barrow at its
// fill point and pushes it the length of the level into Night's stope,
// with Night's page watching from the fill cuddy on the way out. Checks that
// the two pages land on opposite crews, that the grab and the pour show on
// both, that a real walker is stopped by the rock and by a stope's
// barricade, that a power cut goes dark and comes back, and leaves
// screenshots from each side along the way.
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const out = process.argv[2] ?? '.shots';
const browsers = [];
const launch = () => puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

async function open(label) {
  const browser = await launch();
  browsers.push(browser);
  const page = (await browser.pages())[0] ?? await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  const logs = [];
  page.on('console', (m) => { logs.push(m.text()); if (/^arena: line/.test(m.text())) console.log(label, m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:5180/?arena=mine', { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => window.PW?.me?.id > 0 && window.PW.me.alive, { timeout: 60000, polling: 200 });
  await page.evaluate(() => { PW.walker.paused = false; PW.walker.onPause(false); PW.hud.hint(null); });
  return { page, logs, label };
}

/** walk the page's player along a route of (x, z) points, in steps the server will believe */
async function walk(p, route, yaw, pitch = -0.05) {
  await p.page.evaluate(async (route, yaw, pitch) => {
    const w = PW.walker;
    for (const [x, z] of route) {
      for (let i = 0; i < 2000; i++) {
        const f = w.feet;
        const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz);
        if (d < 0.05) break;
        const s = Math.min(d, 0.28);
        w.moveTo(new PW.THREE.Vector3(f.x + (dx / d) * s, 0.05, f.z + (dz / d) * s));
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    const [x, z] = route[route.length - 1];
    w.teleport(new PW.THREE.Vector3(x, 0.05, z), yaw);
    w.pitch = pitch;
  }, route, yaw, pitch);
}

const A = await open('A');
const B = await open('B');
await sleep(1500);
const tA = await A.page.evaluate(() => PW.me.team);
const tB = await B.page.evaluate(() => PW.me.team);
check('opposite crews', tA + tB === 1, `A ${tA ? 'night' : 'day'}, B ${tB ? 'night' : 'day'}`);
const [D, N] = tA === 0 ? [A, B] : [B, A];
const round = await D.page.evaluate(() => PW.round.st);
check('round on', round === 'play', round);

// Night goes over to watch Day's fill point; Day goes to its barrow
await Promise.all([
  walk(N, [[64, -4], [40, -7], [16, -3], [-16, 3], [-40, 7], [-62, 4.2]], 1.62),
  walk(D, [[-73.2, 5.1]], -1.52),
]);
await sleep(600);
await D.page.evaluate(() => PW.grab());
// a busy page takes a while to hear back: wait for the word, rather than a fixed time
const heard = (p, fn, ...args) => p.page.waitForFunction(fn, { timeout: 15000, polling: 100 }, ...args).then(() => true, () => false);
check('day grabs its barrow', await heard(D, () => PW.carrying));
check('night sees it taken', await heard(N, () => PW.barrows.get(0).st === 'held'), await N.page.evaluate(() => PW.barrows.get(0).st));
await D.page.screenshot({ path: path.join(out, 'mine-carry.png') });

// Day pushes it out past Night, who is watching
await walk(D, [[-66, 4.6]], -1.52);
await sleep(700);
await N.page.screenshot({ path: path.join(out, 'mine-watch.png') });

// and all the way along the main drive, down Night's end, to the brow of their stope
await walk(D, [[-64, 4], [-40, 7], [-16, 3], [16, -3], [40, -7], [63, -4], [61, 8], [56, 20], [59, 26.5]], 0.43 + Math.PI, -0.35);
await heard(D, () => PW.ts[0] === 1);
await heard(N, () => PW.ts[0] === 1);
const tsD = await D.page.evaluate(() => PW.ts);
const tsN = await N.page.evaluate(() => PW.ts);
check('pour', tsD[0] === 1 && tsN[0] === 1, `day page ${tsD.join('-')}, night page ${tsN.join('-')}`);
await sleep(2500);
await D.page.screenshot({ path: path.join(out, 'mine-pour.png') });

// Night switches its cap lamp off with L, and Day's page sees it go out. (Before the
// flat-out runs below: those hold Day's page long enough to miss pings and be cut.)
const nId = await N.page.evaluate(() => PW.me.id);
await N.page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL' })));
const offHere = await heard(N, () => !PW.lamp);
const offThere = await heard(D, (id) => PW.avatars.get(id)?.lampOn === false, nId);
check('cap lamp off, seen off', offHere && offThere, `on its own page ${offHere}, on the other ${offThere}`);

// a real walker, with its own collision, running flat out: into the wall, then at the barricade
const run = (x, z, yaw) => D.page.evaluate((x, z, yaw) => {
  const w = PW.walker;
  w.teleport(new PW.THREE.Vector3(x, 0.05, z), yaw);
  for (const code of ['KeyW', 'ShiftLeft']) dispatchEvent(new KeyboardEvent('keydown', { code }));
  for (let i = 0; i < 240; i++) w.update(1 / 60);
  for (const code of ['KeyW', 'ShiftLeft']) dispatchEvent(new KeyboardEvent('keyup', { code }));
  const f = w.feet;
  return [f.x, f.y, f.z];
}, x, z, yaw);
const wall = await run(-52, 5.5, 0);
check('rock holds', wall[2] > 1.5 && Math.abs(wall[1]) < 0.3, `ran north from z 5.5, stopped at z ${wall[2].toFixed(2)}`);
// Night's stope: brow (61, 31), in along (0.414, 0.910)
const stop = await run(61 - 0.414 * 6, 31 - 0.91 * 6, Math.atan2(-0.414, -0.91));
const past = (stop[0] - 61) * 0.414 + (stop[2] - 31) * 0.91;
check('barricade holds', past < 0 && stop[1] > -0.5, `stopped ${(-past).toFixed(2)} m short of the brow`);

// a power cut on Night's page: flicker, dark - nothing baked, no tubes - and the lights back after
await N.page.evaluate(() => PW.blackout(3));
const dark = await heard(N, () => PW.lit === 0 && PW.stage.hemi.intensity < 0.05);
await N.page.screenshot({ path: path.join(out, 'mine-dark.png') });
const back = dark && await N.page.waitForFunction(() => PW.lit === 1, { timeout: 15000, polling: 100 }).then(() => true, () => false);
check('power cut goes dark and comes back', dark && back, `dark ${dark}, back ${back}`);

for (const p of [A, B]) {
  const errs = p.logs.filter((l) => /error|warn/i.test(l));
  check(`page ${p.label} clean`, !errs.length, errs.slice(0, 3).join(' | '));
}
await Promise.all(browsers.map((b) => b.close()));
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
