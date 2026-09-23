// Several camera angles from one browser session.
//
//   node tools/shots.mjs <url> <outPrefix> '<json>'
//
// json: [{ "name": "surge", "pos": [x,y,z], "at": [x,y,z], "js": "optional setup" }]
// Each shot leaves the desk first, so the orbit camera is free to be placed.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:5180/';
const OUT = process.argv[3] || 'shot';
const LIST = JSON.parse(process.argv[4] || '[]');
const W = Number(process.env.W || 1600), H = Number(process.env.H || 900);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
    `--window-size=${W},${H}`,
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((r) => setTimeout(r, Number(process.env.WAIT || 7000)));
if (process.env.JS) {
  await page.evaluate(process.env.JS);
  await new Promise((r) => setTimeout(r, 1500));
}

for (const s of LIST) {
  await page.evaluate((s) => {
    const PW = window.PW;
    if (s.seated) return;
    if (PW.scada?.open) PW.sitDown(false, false);
    PW.stage.controls.autoRotate = false;
    PW.stage.camera.position.set(...s.pos);
    PW.stage.controls.target.set(...s.at);
    PW.stage.controls.update();
  }, s);
  if (s.js) await page.evaluate(s.js);
  await new Promise((r) => setTimeout(r, s.wait ?? 2500));
  await page.screenshot({ path: `${OUT}-${s.name}.png` });
  console.log('saved', `${OUT}-${s.name}.png`);
}
console.log(logs.length ? logs.slice(0, 20).join('\n') : '(console clean)');
await browser.close();
