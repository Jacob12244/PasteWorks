import { Plant, DESIGN } from '../src/sim/plant';
import {
  upstream, feedEffects, mediaDraw, mediaEffect, DEFAULT_UPSTREAM, ORE,
} from '../src/sim/upstream';

const f = (n: number, d = 1) => n.toFixed(d);
const p = (n: number, w: number, d = 1) => f(n, d).padStart(w);

console.log('== Grind: Bond law, 4600 kW installed ==');
console.log('  mill t/h   kWh/t     P80 um   <20um %   liberation   tails t/h   %S   UCS x');
for (const mf of [250, 320, 420, 520, 620]) {
  const s = upstream({ ...DEFAULT_UPSTREAM, millFeed: mf }, true);
  console.log(
    p(mf, 10, 0), p(s.specificEnergy, 8, 1), p(s.p80, 10, 0),
    p(s.fines20 * 100, 9, 1), p(s.liberation * 100, 12, 0) + '%',
    p(s.solids, 11, 0), p(s.sulphide, 6, 2), p(feedEffects(s, 'opc').ucs, 7, 2),
  );
}

console.log('\n== Flotation: frother buys recovery, and clean tailings ==');
console.log('  frother  recovery  mass pull   tails t/h   tails %S   UCS x (OPC)   UCS x (slag)');
for (const fr of [0, 10, 20, 28, 40, 60]) {
  const s = upstream({ ...DEFAULT_UPSTREAM, frother: fr }, true);
  console.log(
    p(fr, 9, 0), p(s.sulphideRecovery * 100, 9, 1) + '%', p(s.massPull, 10, 2) + '%',
    p(s.solids, 11, 0), p(s.sulphide, 10, 2),
    p(feedEffects(s, 'opc').ucs, 13, 3), p(feedEffects(s, 'slag').ucs, 14, 3),
  );
}

console.log('\n== Deslime cyclones: cut size vs what you keep ==');
console.log('  kPa   d50c um   split %   tails t/h   <20um %   filter x   moist x   tauY x   UCS x');
for (const P of [0, 50, 80, 110, 160, 220]) {
  const s = upstream({ ...DEFAULT_UPSTREAM, deslime: P > 0, cyclonePressure: P || 110 }, true);
  const e = feedEffects(s, 'opc');
  console.log(
    p(P, 5, 0), p(s.d50c, 9, 1), p(s.deslimeSplit * 100, 9, 1), p(s.solids, 11, 0),
    p(s.fines20 * 100, 9, 1), p(e.filterCapacity, 10, 2), p(e.cakeMoisture, 9, 2),
    p(e.yieldStress, 8, 2), p(e.ucs, 7, 2),
  );
}

console.log('\n== Grinding media: let the ball charge run down ==');
console.log('  health   mill kW   Wi eff   P80 um   liberation   tails %S   UCS x (OPC)');
for (const hl of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
  const s = upstream(DEFAULT_UPSTREAM, true, hl);
  console.log(
    p(hl, 8, 2), p(mediaEffect(hl).power * ORE.millPowerKw, 9, 0),
    p(s.workIndex, 8, 1), p(s.p80, 8, 0), p(s.liberation * 100, 12, 0) + '%',
    p(s.sulphide, 10, 2), p(feedEffects(s, 'opc').ucs, 13, 3),
  );
}
const dayBin = mediaDraw(DEFAULT_UPSTREAM.millFeed, 4600 / DEFAULT_UPSTREAM.millFeed);
console.log('  draw at 420 t/h ore:', dayBin.toFixed(2), 't/h  =',
  (ORE.hopperCap / dayBin).toFixed(0), 'h of charging in a full', ORE.hopperCap, 't hopper');

console.log('\n== Full runs to fill the stope ==');
function run(name: string, setup: (pl: Plant) => void, orderMedia = true) {
  const pl = new Plant();
  pl.hardMode = true;
  pl.sp.running = true;
  setup(pl);
  let h = 0;
  while (pl.telemetry.stope.pct < 99.99 && h < 200) {
    pl.step(10); h += 10 / 3600;
    if (pl.telemetry.silo.mass < 40) pl.refillSilo();
    if (orderMedia && pl.telemetry.media.pct < 20) pl.orderMedia();
    if (pl.telemetry.pipe.plugged) { pl.clearBlockage(); pl.sp.running = true; }
  }
  const t = pl.telemetry;
  console.log(
    name.padEnd(34),
    p(t.stope.pct, 6, 1) + '%', p(h, 7, 1) + ' h',
    '| UCS', p(t.stope.avgUcs, 5, 0), '/', p(t.stope.minUcs, 5, 0) + ' min',
    '| $/m3', p(t.cost.perM3, 7, 2),
    '| spill', p(t.spills.totalM3, 5, 0),
    '| plugs', t.blockages,
    t.stope.avgUcs >= DESIGN.targetUcs ? ' ON SPEC' : ' under',
  );
}
run('default hard mode', () => {});
run('coarse grind 560 t/h', (pl) => { pl.up.millFeed = 560; });
run('fine grind 260 t/h', (pl) => { pl.up.millFeed = 260; });
run('deslime @ 110 kPa', (pl) => { pl.up.deslime = true; });
run('deslime + coarse + lean binder', (pl) => {
  pl.up.deslime = true; pl.up.millFeed = 520; pl.sp.binderDose = 3.6;
});
run('starved flotation (no frother)', (pl) => { pl.up.frother = 0; });
run('no frother + slag binder', (pl) => { pl.up.frother = 0; pl.up.binderType = 'slag'; });
run('never order grinding media', () => {}, false);
run('no media + slag binder', (pl) => { pl.up.binderType = 'slag'; }, false);
run('no media + lean binder 3.8%', (pl) => { pl.sp.binderDose = 3.8; }, false);
