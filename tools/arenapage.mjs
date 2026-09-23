// Two pages in the arena at once, in a headless browser.
//
//   node tools/arenapage.mjs [outdir]
//
// Needs the dev server on :5180 and the arena server on :8481 (npm run arena).
// Headless Chrome cannot take the pointer, so the walkers are unpaused by
// hand, walked into place in short steps (the server refuses anything that
// looks like a teleport), and one throws paste at the other through the
// page's own fire(). Checks that each page sees the other, that the hit
// lands on both screens, and leaves a screenshot from each side.
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const out = process.argv[2] ?? '.shots';
// a browser each: a second tab in one browser is a background tab, and a
// background tab stops animating - which the room rightly reads as idling
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
  await page.setViewport({ width: 800, height: 450 });
  const logs = [];
  page.on("console", (m) => { logs.push(m.text()); if (/^arena: line/.test(m.text())) console.log(label, m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:5180/?arena', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.PW?.me?.id > 0 && window.PW.me.alive, { timeout: 30000, polling: 200 });
  await page.evaluate(() => { PW.walker.paused = false; PW.walker.onPause(false); });
  return { page, logs, label };
}

/** walk the page's player to (x, z) in steps the server will believe */
async function walkTo(p, x, z, yaw) {
  await p.page.evaluate(async (x, z, yaw) => {
    const w = PW.walker;
    for (let i = 0; i < 400; i++) {
      const f = w.feet;
      const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz);
      if (d < 0.05) break;
      const s = Math.min(d, 0.3);
      w.moveTo(new PW.THREE.Vector3(f.x + (dx / d) * s, 0.05, f.z + (dz / d) * s));
      await new Promise((r) => setTimeout(r, 50));
    }
    w.teleport(new PW.THREE.Vector3(x, 0.05, z), yaw);
  }, x, z, yaw);
}

const A = await open('A');
const B = await open('B');
await sleep(1500);

const idA = await A.page.evaluate(() => PW.me.id);
const idB = await B.page.evaluate(() => PW.me.id);
const seesB = await A.page.evaluate((id) => !!PW.avatars.get(id), idB);
const seesA = await B.page.evaluate((id) => !!PW.avatars.get(id), idA);
check('each sees the other', seesA && seesB);
const round = await A.page.evaluate(() => PW.round.st);
check('round on', round === 'play', round);

// A in the south yard facing north at B, eight metres off, nothing between
await Promise.all([walkTo(A, 16, 26, 0), walkTo(B, 16, 18, Math.PI)]);
await sleep(2600);   // spawn shields off, avatars caught up
const hpBefore = await B.page.evaluate(() => PW.hud && Number(document.querySelector('#arena .hpn').textContent));
for (let i = 0; i < 3; i++) {
  await A.page.evaluate(() => PW.fire(0));
  await sleep(350);
}
await sleep(1200);
const hpAfter = await B.page.evaluate(() => Number(document.querySelector('#arena .hpn').textContent));
check('paste lands', hpAfter < hpBefore, `B health ${hpBefore} -> ${hpAfter}`);
const ammoA = await A.page.evaluate(() => PW.ammo);
check('ammo spent', ammoA[0] === 27, `A paste ${ammoA[0]}`);

await A.page.evaluate(() => PW.fire(0));
await sleep(120);
await A.page.screenshot({ path: path.join(out, 'arena-a.png') });
await B.page.screenshot({ path: path.join(out, 'arena-b.png') });

for (const p of [A, B]) {
  const errs = p.logs.filter((l) => /error|warn/i.test(l));
  check(`page ${p.label} clean`, !errs.length, errs.slice(0, 3).join(' | '));
}
await Promise.all(browsers.map((b) => b.close()));
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
