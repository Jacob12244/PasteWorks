import { Plant, DESIGN } from '../src/sim/plant';
import {
  yieldStress, plasticViscosity, slump, coneSlump, pipeline, ucs28,
} from '../src/sim/rheology';
import { stream, Cw, Cv, slurryDensity } from '../src/sim/streams';

const f = (n: number, d = 1) => n.toFixed(d).padStart(9);

console.log('== Rheology sweep (5% binder) ==');
console.log('  Cw     Cv    tau_y Pa   eta Pas   Boger mm   cone mm   UCS kPa');
for (const cw of [0.70, 0.72, 0.74, 0.76, 0.78, 0.80, 0.82]) {
  const s = stream(1, (1.05 * (1 - cw)) / cw, 0.05);
  const cv = Cv(s), rho = slurryDensity(s);
  const ty = yieldStress(cv, 5);
  console.log(
    f(Cw(s), 3), f(cv, 3), f(ty, 0), f(plasticViscosity(cv), 3),
    f(slump(ty, rho), 0), f(coneSlump(ty, rho), 0), f(ucs28(5, Cw(s)), 0),
  );
}

console.log('\n== Pipeline: 150 mm, 1200 m developed, 250 m drop, 120 m3/h ==');
console.log('  Boger  tau_y   grad kPa/m   fric kPa   static kPa   pump kPa  regime');
for (const cw of [0.74, 0.76, 0.78, 0.80]) {
  const s = stream(1, (1.05 * (1 - cw)) / cw, 0.05);
  const cv = Cv(s), rho = slurryDensity(s);
  const ty = yieldStress(cv, 5), eta = plasticViscosity(cv);
  const p = pipeline(120, 150, 1200, 250, ty, eta, rho);
  console.log(
    f(slump(ty, rho), 0), f(ty, 0), f(p.gradient, 2), f(p.friction, 0),
    f(p.staticRecovery, 0), f(p.pumpPressure, 0), '  ' + p.regime,
  );
}

console.log('\n== 24 h run at defaults (stroke 70%) ==');
const p = new Plant();
p.sp.running = true;
const dt = 5;
for (let i = 0; i < (24 * 3600) / dt; i++) {
  p.step(dt);
  if (p.telemetry.silo.mass < 40) p.refillSilo();
  if (p.telemetry.pipe.plugged) p.clearBlockage(), (p.sp.running = true);
}
const t = p.telemetry;
console.log('  thickener bed      ', f(t.thickener.bedPct, 0), '%   torque', f(t.thickener.torque, 0), '%   UF Cw', f(t.thickener.ufCw, 3));
console.log('  U/F surge tank     ', f(t.ufTank.pct, 0), '%');
console.log('  press throughput   ', f(t.filter.throughput, 0), 't/h dry of', f(t.filter.capacity, 0), 'cap   cake moist', f(t.filter.cakeMoisture, 1), '%');
console.log('  cake bin           ', f(t.cakeBin.pct, 0), '%');
console.log('  paste              ', f(t.mixer.cw, 3), 'Cw   slump', f(t.mixer.slump, 0), 'mm   tau_y', f(t.mixer.yieldStress, 0), 'Pa   UCS', f(t.mixer.ucs, 0), 'kPa');
console.log('  pump               ', f(t.pump.flow, 1), 'm3/h   press', f(t.pump.pressure / 100, 1), 'bar (', f(t.pump.pressurePct, 0), '% rated )');
console.log('  pipe               ', f(t.pipe.velocity, 2), 'm/s  ', t.pipe.regime, '  choke:', t.pipe.chokeRequired, '  wall loss', f(t.pipe.wallLossMm, 2), 'mm');
console.log('  stope              ', f(t.stope.volume, 0), 'm3 =', f(t.stope.pct, 1), '%   avg UCS', f(t.stope.avgUcs, 0), 'kPa');
console.log('  cost               $', f(t.cost.total, 0), ' = $', f(t.cost.perM3, 2), '/m3     blockages:', t.blockages);
console.log('  status             ', t.status);
console.log('  hours to fill      ', f((DESIGN.stopeVolume / Math.max(t.pump.flow, 1)), 1), 'h at this rate');
console.log('\n  last alarms:');
for (const a of t.alarms.slice(0, 6)) console.log('   ', (a.at / 3600).toFixed(1) + 'h', a.level.padEnd(5), a.text);
