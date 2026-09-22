import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:5180/';
const OUT = process.argv[3] || 'shot.png';
const WAIT = Number(process.argv[4] || 6000);
const SCRIPT = process.argv[5] || '';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1600,900',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[404] ${r.url()}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, WAIT));

if (SCRIPT) {
  await page.evaluate(SCRIPT);
  await new Promise((r) => setTimeout(r, 2500));
}

await page.screenshot({ path: OUT });
console.log('--- console ---');
console.log(logs.slice(0, 40).join('\n') || '(clean)');
console.log('--- saved', OUT, '---');
await browser.close();
