import { Plant, DESIGN } from '../src/sim/plant';

const f = (n: number, d = 1) => n.toFixed(d);

function run(name: string, setup: (p: Plant) => void, hours = 12, auto = true) {
  const p = new Plant();
  p.sp.running = true;
  setup(p);
  const dt = 5;
  for (let i = 0; i < (hours * 3600) / dt; i++) {
    p.step(dt);
    if (auto && p.telemetry.silo.mass < 40) p.refillSilo();
  }
  const t = p.telemetry;
  console.log(
    name.padEnd(30),
    'slump', f(t.mixer.slump, 0).padStart(4) + 'mm',
    'Cw', f(t.mixer.cw * 100, 1) + '%',
    '| press', f(t.pump.pressure / 100, 0).padStart(4) + ' bar',
    '(' + f(t.pump.pressurePct, 0).padStart(3) + '%)',
    '| v', f(t.pipe.velocity, 2) + ' m/s',
    '| UCS', f(t.mixer.ucs, 0).padStart(4),
    '| fill', f(t.stope.pct, 1).padStart(5) + '%',
    '| $/m3', (t.stope.volume > 1 ? f(t.cost.perM3, 2) : '  -').padStart(5),
    '| PWtank', f(t.water.pct, 0).padStart(3) + '%',
    '| spill', f(t.spills.totalM3, 0).padStart(4) + 'm3',
    '| plugs', t.blockages,
    '|', t.status,
  );
  return t;
}

console.log('== Scenario sweep: 12 h each, default plant ==\n');
run('baseline (125 mm slump)', () => {});
run('stiff paste (95 mm)', (p) => { p.sp.targetSlump = 95; });
run('pressure limited (90 mm)', (p) => { p.sp.targetSlump = 90; });
run('very stiff (86 mm)', (p) => { p.sp.targetSlump = 86; });
run('wet paste (160 mm)', (p) => { p.sp.targetSlump = 160; });
run('lean binder (2.5%)', (p) => { p.sp.binderDose = 2.5; });
run('rich binder (7.5%)', (p) => { p.sp.binderDose = 7.5; });
run('pump flat out (100%)', (p) => { p.sp.strokeRate = 100; });
run('no flocculant', (p) => { p.sp.flocDose = 0; });
run('short press cycle (2.5)', (p) => { p.sp.cycleTime = 2.5; });
run('long press cycle (11)', (p) => { p.sp.cycleTime = 11; });
run('no binder deliveries', () => {}, 12, false);

console.log('\n== Can a careful operator finish the stope on spec? ==');
const p = new Plant();
p.sp.running = true;
p.sp.flocDose = 26; p.sp.ufCw = 0.66; p.sp.cycleTime = 5.5;
p.sp.binderDose = 4.8; p.sp.targetSlump = 118; p.sp.strokeRate = 64;
let h = 0;
while (p.telemetry.stope.pct < 99.99 && h < 200) {
  p.step(5); h += 5 / 3600;
  if (p.telemetry.silo.mass < 40) p.refillSilo();
  if (p.telemetry.pipe.plugged) { p.clearBlockage(); p.sp.running = true; }
}
const t = p.telemetry;
console.log(
  '  filled', f(t.stope.volume, 0), 'm3 in', f(h, 1), 'h',
  '| avg UCS', f(t.stope.avgUcs, 0), 'kPa (target', DESIGN.targetUcs + ')',
  '| $' + f(t.cost.perM3, 2) + '/m3',
  '| plugs', t.blockages,
);
console.log('  binder', f(t.stope.binderPlaced, 0), 't  |  total spend $' + Math.round(t.cost.total).toLocaleString());
