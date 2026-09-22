import { Plant, DESIGN } from '../src/sim/plant';

interface R { binder: number; slump: number; stroke: number; ucs: number; cost: number; hours: number; plugs: number; ok: boolean }
const results: R[] = [];

for (const binder of [4.6, 4.8, 5.0, 5.2, 5.5, 6.0]) {
  for (const slump of [105, 112, 118, 125, 132]) {
    for (const stroke of [58, 62, 66, 72]) {
      const p = new Plant();
      p.sp.running = true;
      p.sp.flocDose = 26; p.sp.ufCw = 0.66; p.sp.cycleTime = 5.5;
      p.sp.binderDose = binder; p.sp.targetSlump = slump; p.sp.strokeRate = stroke;
      let h = 0;
      while (p.telemetry.stope.pct < 99.99 && h < 140) {
        p.step(10); h += 10 / 3600;
        if (p.telemetry.silo.mass < 40) p.refillSilo();
        if (p.telemetry.pipe.plugged) { p.clearBlockage(); p.sp.running = true; }
      }
      const t = p.telemetry;
      results.push({
        binder, slump, stroke,
        ucs: t.stope.avgUcs, cost: t.cost.perM3, hours: h, plugs: t.blockages,
        ok: t.stope.avgUcs >= DESIGN.targetUcs && t.stope.pct > 99.9 && t.blockages === 0,
      });
    }
  }
}

const wins = results.filter((r) => r.ok).sort((a, b) => a.cost - b.cost);
console.log('configurations tested :', results.length);
console.log('on-spec, no blockages :', wins.length);
console.log('\ncheapest ten that make the grade:');
console.log('  binder  slump  stroke |   UCS    $/m3   hours');
for (const r of wins.slice(0, 10)) {
  console.log(
    '  ' + r.binder.toFixed(1).padStart(5) + '%',
    r.slump.toString().padStart(5) + 'mm',
    r.stroke.toString().padStart(5) + '%  |',
    r.ucs.toFixed(0).padStart(5),
    ('$' + r.cost.toFixed(2)).padStart(7),
    r.hours.toFixed(1).padStart(6) + ' h',
  );
}
const fails = results.filter((r) => !r.ok);
const under = fails.filter((r) => r.ucs < DESIGN.targetUcs).length;
const plugged = fails.filter((r) => r.plugs > 0).length;
const slow = fails.filter((r) => r.hours >= 139).length;
console.log('\nfailures:', under, 'under strength,', plugged, 'plugged,', slow, 'never finished');
