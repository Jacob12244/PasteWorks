// Per-unit breakdown of a converted (uncompressed) plant: material, tris, extent.
import fs from 'node:fs';
const [file, filter = ''] = process.argv.slice(2);
const b = fs.readFileSync(file);
const g = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
for (const n of g.nodes) {
  if (n.mesh === undefined || !n.name.match(filter)) continue;
  for (const p of g.meshes[n.mesh].primitives) {
    const a = g.accessors[p.attributes.POSITION];
    const t = (p.indices !== undefined ? g.accessors[p.indices].count : a.count) / 3;
    const s = a.max.map((v, i) => (v - a.min[i]).toFixed(1)).join('x');
    const at = (n.translation || [0, 0, 0]).map((v) => v.toFixed(1)).join(',');
    console.log(`${n.name.padEnd(34)} ${g.materials[p.material].name.padEnd(16)} ${String(t).padStart(7)} tris  ${s.padEnd(18)} @ ${at}`);
  }
}
