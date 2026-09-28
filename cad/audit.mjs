// Last step before a converted plant goes anywhere: read every string in the
// glTF and fail if anything from the source survived. Models are cleared for
// use on condition that the client and project names are gone.
//
//   node cad/audit.mjs public/local/plant.glb [extra words...]
//
// The client and site names to look for are as confidential as the rest, so
// they are not in the repo: one to a line in cad/out/names.txt, which git
// never sees. Without that list the audit fails rather than pass on patterns.

import fs from 'node:fs';

const [file, ...extra] = process.argv.slice(2);
const list = new URL('./out/names.txt', import.meta.url);
if (!fs.existsSync(list)) {
  console.log('FAIL - no cad/out/names.txt: list the client and site names to look for, one to a line');
  process.exit(1);
}
const clients = fs.readFileSync(list, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const buf = fs.readFileSync(file);
const len = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));

const strings = [];
(function walk(v, path) {
  if (typeof v === 'string') strings.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
})(json, '');

const BANNED = [
  /\b\d{2}-[A-Z]{2,4}-\d{3,4}\b/,        // equipment tags, 01-SI-010
  /\b\d{2}-\d{4}\b/,                     // project numbers, 12-3456
  /\d{2,}-\d{2,}-[A-Z]{2}\d{2}/,         // pipe line numbers
  /\.(fbx|nwd|nwc|dwg|udatasmith)\b/i,   // source file names
  ...(clients.length ? [new RegExp(`\\b(${clients.join('|')})\\b`, 'i')] : []),
  ...extra.map((w) => new RegExp(w, 'i')),
];

const hits = strings.filter(([, s]) => BANNED.some((re) => re.test(s)));
const names = strings.filter(([p]) => p.endsWith('.name')).map(([, s]) => s);
console.log(`${strings.length} strings, ${names.length} names, e.g. ${names.slice(0, 12).join(', ')}`);
console.log(`generator: ${json.asset?.generator}`);
if (hits.length) {
  console.log('FAIL - source identifiers found:');
  for (const [p, s] of hits.slice(0, 30)) console.log(`  ${p} = ${s}`);
  process.exit(1);
}
console.log('PASS - no source identifiers');
