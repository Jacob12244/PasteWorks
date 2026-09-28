// Screenshots of the ?cad test bench from each preset view, on the real GPU
// (tools/shot.mjs uses SwiftShader, which is fine for pictures and useless for
// frame rates).
//
//   node cad/shot.mjs [url] [outPrefix] [views] [gpu|soft]

import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:5181/?cad';
const OUT = process.argv[3] || '.shots/cad';
const VIEWS = (process.argv[4] || '1234').split('');
const GPU = (process.argv[5] || 'gpu') === 'gpu';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox', '--window-size=1600,900', '--ignore-gpu-blocklist', '--enable-webgl',
    ...(GPU
      ? ['--use-angle=d3d11', '--enable-gpu-rasterization', '--force_high_performance_gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
});
const page = await browser.newPage();
await page.setViewport({
  width: Number(process.env.W || 1600), height: Number(process.env.H || 900),
  deviceScaleFactor: Number(process.env.DPR || 1),
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction('window.CAD', { timeout: 180000 });
const gl = await page.evaluate(() => {
  const r = window.CAD.stage.renderer.getContext();
  const ext = r.getExtension('WEBGL_debug_renderer_info');
  return ext ? r.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', gl);

for (const v of VIEWS) {
  await page.evaluate((k) => window.CAD.go(k, 1), v);
  await new Promise((r) => setTimeout(r, 2500));
  const info = await page.$eval('#cad-info', (d) => d.textContent);
  console.log(`view ${v}: ${info.split('\n').slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: `${OUT}-${v}.png` });
}
console.log(logs.slice(0, 20).join('\n') || '(console clean)');
await browser.close();
