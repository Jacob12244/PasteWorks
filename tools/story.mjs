// Contact sheet of a scenario's opening: every beat's first and last frame.
//
//   node tools/story.mjs <scenario> <out.png> [url]
//
// Frames the camera exactly as the cutscene would, with the consoles hidden,
// so a beat that lands on nothing is obvious at a glance.
import puppeteer from 'puppeteer-core';

const id = process.argv[2] || 'today';
const OUT = process.argv[3] || `story-${id}.png`;
const URL = (process.argv[4] || 'http://localhost:5180/') + `?s=${id}&intro=0`;
const W = 640, H = 360;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((r) => setTimeout(r, 8000));
const beats = await page.evaluate(() => {
  PW.sitDown(false, false);
  PW.hud.setPanelsVisible(false);
  PW.world.setTagsVisible(false);
  PW.stage.setFov(40);
  PW.plant.sp.running = true;
  PW.hud.setSpeed(60);
  return PW.scenario.story.map((b) => [b.from, b.to, b.title || b.kicker || '', (b.text || '').slice(0, 60)]);
});
const shots = [];
for (let i = 0; i < beats.length; i++) {
  for (const which of [0, 1]) {
    const f = beats[i][which];
    await page.evaluate((f) => {
      PW.stage.camera.position.set(f[0], f[1], f[2]);
      PW.stage.controls.target.set(f[3], f[4], f[5]);
      PW.stage.camera.lookAt(f[3], f[4], f[5]);
    }, f);
    await new Promise((r) => setTimeout(r, 2200));
    shots.push({ img: await page.screenshot({ encoding: 'base64' }), label: `${i + 1}${which ? 'b' : 'a'}  ${beats[i][2] || beats[i][3]}` });
  }
}
const sheet = await browser.newPage();
await sheet.setViewport({ width: W, height: Math.ceil(shots.length / 2) * (H / 2 + 18) + 4 });
await sheet.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:1fr 1fr;gap:2px;font:11px monospace;color:#ddd">
${shots.map((s) => `<div><img src="data:image/png;base64,${s.img}" style="width:100%;display:block"><div style="padding:2px 4px">${s.label.replace(/</g, '&lt;')}</div></div>`).join('')}
</body>`);
await sheet.screenshot({ path: OUT, fullPage: true });
console.log('saved', OUT, shots.length, 'frames');
await browser.close();
