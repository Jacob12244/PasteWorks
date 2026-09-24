// Opens the sizing game in headless Chrome, visits each station and saves a
// screenshot of each: node tools/sizingpage.mjs <url> <outdir>
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5191/?size=4821';
const out = process.argv[3] ?? '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url, { waitUntil: 'networkidle0' });
await sleep(6000);
const shots = process.argv[4] ? process.argv[4].split(',').map(Number) : [0, 1, 2, 3, 4];
for (const i of shots) {
  await page.evaluate((i) => document.querySelectorAll('#sizing .sz-step')[i]?.click(), i);
  await sleep(3500);
  await page.screenshot({ path: `${out}/station${i + 1}.png` });
  const checks = await page.evaluate(() => [...document.querySelectorAll('#sizing .sz-check')].map((c) => c.className.split(' ')[1] + ' ' + c.textContent));
  console.log(`station ${i + 1}:`, checks.join(' | '));
}
await browser.close();
