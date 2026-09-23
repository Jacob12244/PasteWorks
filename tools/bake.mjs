// Bake the arena's collision world out of the page, for the arena server.
//
//   npm run bake            (needs the dev server on :5180)
//   node tools/bake.mjs http://localhost:4173/
//
// The server has no renderer and cannot build the plant, so it is handed the
// plant's triangles instead: the page builds the arena exactly as a player's
// browser does (?arena=bake), clips the collision world to the fenced pad,
// and this writes it out as server/worlds/arena.bin.gz - nine float32s a
// triangle - with its fingerprint beside it in arena.json.
//
// Re-bake after changing anything on the pad. A page whose plant does not
// match the server's bake says so in the console on joining.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:5180/';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'worlds');
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (m.text().startsWith('arena:')) console.log(m.text()); });
  await page.goto(new URL('?arena=bake', base).href, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(() => window.__bake, { timeout: 120000, polling: 250 });
  const bake = await page.evaluate(() => window.__bake);
  const raw = Buffer.from(bake.b64, 'base64');
  if (raw.length !== bake.count * 36) throw new Error(`expected ${bake.count * 36} bytes, got ${raw.length}`);
  fs.mkdirSync(out, { recursive: true });
  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(path.join(out, 'arena.bin.gz'), gz);
  fs.writeFileSync(path.join(out, 'arena.json'), JSON.stringify({
    hash: bake.hash, triangles: bake.count, bytes: raw.length, gzipped: gz.length,
  }, null, 2) + '\n');
  console.log(`baked ${bake.count} triangles, ${(raw.length / 1e6).toFixed(1)} MB -> ${(gz.length / 1e6).toFixed(1)} MB gz, ${bake.hash}`);
} finally {
  await browser.close();
}
