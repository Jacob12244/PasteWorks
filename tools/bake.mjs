// Bake each arena's collision world out of the page, for the arena server.
//
//   npm run bake                                    both maps (needs the dev server on :5180)
//   node tools/bake.mjs http://localhost:5180/ mine  just one
//
// The server has no renderer and cannot build the plant or carve the mine,
// so it is handed their triangles instead: the page builds each place exactly
// as a player's browser does (?arena=bake, ?arena=bake-mine), clips the
// collision world to it, and this writes it out as server/worlds/<world>.bin.gz
// - nine float32s a triangle - with its fingerprint beside it in <world>.json.
//
// Re-bake after changing anything in either place. A page whose world does
// not match the server's bake says so in the console on joining.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:5180/';
const only = process.argv[3];
const maps = [['plant', 'bake'], ['mine', 'bake-mine']].filter(([m]) => !only || m === only);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'worlds');
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  for (const [map, arg] of maps) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    page.on('console', (m) => { if (m.text().startsWith('arena:')) console.log(m.text()); });
    await page.goto(new URL('?arena=' + arg, base).href, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction(() => window.__bake, { timeout: 120000, polling: 250 });
    const bake = await page.evaluate(() => window.__bake);
    await page.close();
    if (bake.map !== map) throw new Error(`asked for ${map}, the page baked ${bake.map}`);
    const raw = Buffer.from(bake.b64, 'base64');
    if (raw.length !== bake.count * 36) throw new Error(`expected ${bake.count * 36} bytes, got ${raw.length}`);
    fs.mkdirSync(out, { recursive: true });
    const gz = zlib.gzipSync(raw, { level: 9 });
    fs.writeFileSync(path.join(out, bake.world + '.bin.gz'), gz);
    fs.writeFileSync(path.join(out, bake.world + '.json'), JSON.stringify({
      hash: bake.hash, triangles: bake.count, bytes: raw.length, gzipped: gz.length,
    }, null, 2) + '\n');
    console.log(`${map}: baked ${bake.count} triangles, ${(raw.length / 1e6).toFixed(1)} MB -> ${(gz.length / 1e6).toFixed(1)} MB gz, ${bake.hash}`);
  }
} finally {
  await browser.close();
}
