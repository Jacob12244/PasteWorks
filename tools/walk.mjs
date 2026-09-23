// Smoke test for walking: every world, in a headless browser.
//
//   node tools/walk.mjs [world ...]        (default: all five)
//
// Needs the dev server on :5180. Headless Chrome cannot take the pointer, and
// renders too slowly to walk in real time, so this unpauses the walker by
// hand and steps it at 60 fps inside the page. For each world it checks:
//   gate   - out of the control room door and through the kerb gate onto the pad
//   jump   - a jump lands again
//   stair  - both flights of the mixing tower stair, up to the top landing
import puppeteer from 'puppeteer-core';

const WORLDS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['today', 'abyss', 'psyche', 'undercity', 'caretaker'];
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

for (const S of WORLDS) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:5180/?s=${S}&intro=0`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  await page.evaluate(() => PW.walk(true));
  // the collision world is built on the next tick after the note goes up
  for (let i = 0; i < 40 && !(await page.evaluate(() => PW.walker.ready && PW.walker.active)); i++) await sleep(250);

  const r = await page.evaluate(() => {
    const w = PW.walker;
    w.paused = false;
    w.onPause(false);
    const hold = (keys, secs) => {
      w.keys.clear();
      keys.forEach((k) => w.keys.add(k));
      for (let i = 0; i < secs * 60; i++) w.update(1 / 60);
      w.keys.clear();
    };
    const out = {};
    const z0 = w.eye.z;
    hold(['KeyW'], 4);
    out.gate = { ok: w.eye.z < 30, z: +w.eye.z.toFixed(1), from: +z0.toFixed(1) };

    const floor = w.eye.y;
    let peak = 0;
    w.keys.add('Space'); w.update(1 / 60); w.keys.clear();
    for (let i = 0; i < 600; i++) { w.update(1 / 60); peak = Math.max(peak, w.eye.y); }
    out.jump = { ok: peak > floor + 0.5 && Math.abs(w.eye.y - floor) < 0.05, rise: +(peak - floor).toFixed(2) };

    // foot of the tower stair, facing up it
    w.spawnAt.set(9.0, 0.05, 5.3);
    w.spawnYaw = -Math.PI / 2;
    w.respawn();
    hold(['KeyW'], 7);
    out.stair = { ok: w.eye.y > 8.5, eye: +w.eye.y.toFixed(2), x: +w.eye.x.toFixed(1) };
    return out;
  });
  const built = logs.find((l) => l.startsWith('walk:')) ?? '';
  const errs = logs.filter((l) => /error/i.test(l));
  const line = Object.entries(r).map(([k, v]) => `${v.ok ? 'ok ' : 'FAIL'} ${k} ${JSON.stringify(v).replace(/"ok":(true|false),?/, '')}`);
  if (Object.values(r).some((v) => !v.ok) || errs.length) failed++;
  console.log(`${S.padEnd(10)} ${built}\n  ${line.join('\n  ')}${errs.length ? '\n  ' + errs.join('\n  ') : ''}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
