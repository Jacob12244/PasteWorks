/**
 * Can every scenario actually be won?
 *
 *   npm run solve:worlds [id]   full sweep: binder x slump x stroke, both binders, per scenario
 *   npm run verify:worlds       quick check, part of npm run verify
 *
 * Each run is a whole shift on the hard circuit, ordering binder and balls
 * the way a sensible operator would and flushing any plug (which then counts
 * against the run). A configuration wins if it fills the destination, holds
 * the average strength over target, never plugs and spills nothing.
 *
 * A scenario with no winning configuration is a bug in the scenario, not a
 * hard level.
 */
import { Plant, DESIGN, type Setpoints } from '../src/sim/plant';
import type { UpstreamSetpoints } from '../src/sim/upstream';
import { SCENARIOS, applyScenario } from '../src/scenario';

interface R {
  binder: number; slump: number; stroke: number; which: string;
  ucs: number; min: number; cost: number; hours: number;
  plugs: number; spill: number; ok: boolean;
}

/**
 * A recipe: the three numbers every world shares, which of the site's two
 * binders is in the silo, and whatever that world's own machines are set to.
 */
interface Recipe {
  binder: number; slump: number; stroke: number;
  /** 0 or 1: the first or second of DESIGN.binders */
  use?: 0 | 1;
  sp?: Partial<Setpoints>;
  up?: Partial<UpstreamSetpoints>;
}

/** Drive a plant to the end of the job (or 150 h), operating it sensibly. */
function shift(p: Plant) {
  p.hardMode = true;
  p.sp.running = true;
  let h = 0;
  while (p.telemetry.stope.pct < 99.99 && h < 150) {
    p.step(10); h += 10 / 3600;
    const t = p.telemetry;
    if (t.silo.pct < 10) p.refillSilo();
    if (t.media.pct < 20) p.orderMedia();
    if (t.pipe.plugged) { p.clearBlockage(); p.sp.running = true; }
  }
  return h;
}

function run(r: Recipe): R {
  const p = new Plant();
  p.up.binderType = DESIGN.binders[r.use ?? 0].id;
  Object.assign(p.sp, r.sp ?? {});
  Object.assign(p.up, r.up ?? {});
  p.sp.binderDose = r.binder; p.sp.targetSlump = r.slump; p.sp.strokeRate = r.stroke;
  const hours = shift(p);
  const t = p.telemetry;
  return {
    binder: r.binder, slump: r.slump, stroke: r.stroke, which: DESIGN.binders[r.use ?? 0].short,
    ucs: t.stope.avgUcs, min: t.stope.minUcs, cost: t.cost.perM3, hours,
    plugs: t.blockages, spill: t.spills.totalM3,
    ok: t.stope.pct > 99.9 && t.stope.avgUcs >= DESIGN.targetUcs
      && t.blockages === 0 && t.spills.totalM3 < 1,
  };
}

const money = (n: number) => '$' + n.toFixed(2);

/**
 * One recipe per scenario that the full sweep found wins under budget. The
 * quick check re-proves these, and that each scenario's own defaults run the
 * whole shift without plugging - which is what keeps a scenario from quietly
 * becoming unwinnable when something else gets tuned.
 */
const REFERENCE: Record<string, Recipe> = {
  // the tuned thickener recipe from solve.ts
  today: { binder: 4.5, slump: 135, stroke: 70, sp: { flocDose: 26, ufCw: 0.66, cycleTime: 5.5 } },
  // enough sea across the cloth to keep the pump fed, and no more
  abyss: { binder: 5, slump: 150, stroke: 70, sp: { seaDp: 110 } },
  // a ring spun to 10 rpm, the magnetrons just short of frosting the trap,
  // and a dense paste for the ferro-carbonate
  psyche: {
    binder: 2.5, slump: 65, stroke: 62, use: 1,
    sp: { spin: 10, flocDose: 26, ufCw: 0.66, mwPower: 6, belt: 80 },
  },
  // just enough field to hold the flocs, and a heavy dose of the cheap binder
  undercity: {
    binder: 7.5, slump: 95, stroke: 70,
    sp: { field: 0.6, flocDose: 26, ufCw: 0.68, voltage: 30, belt: 80 },
  },
  // slow the loaders so the hammers put more into every tonne
  caretaker: { binder: 5.2, slump: 65, stroke: 70, up: { millFeed: 260, rotor: 1000, grate: 8 } },
};

function quick() {
  let bad = 0;
  console.log('scenario     defaults                        reference recipe');
  for (const s of SCENARIOS) {
    applyScenario(s);
    const d = new Plant();
    const h = shift(d);
    const t = d.telemetry;
    const runs = t.stope.pct > 99.9 && t.blockages === 0;
    const r = run(REFERENCE[s.id]);
    const wins = r.ok && r.cost <= s.budget;
    console.log(
      s.id.padEnd(12),
      (runs ? 'runs ' : 'FAILS') + h.toFixed(0).padStart(4) + ' h'
        + t.stope.avgUcs.toFixed(0).padStart(6) + ' kPa' + money(t.cost.perM3).padStart(9) + '   ',
      (wins ? 'wins ' : 'LOSES') + r.ucs.toFixed(0).padStart(6) + ' / ' + DESIGN.targetUcs
        + ' kPa  ' + money(r.cost) + ' of $' + s.budget + '  on ' + r.which,
    );
    if (!runs || !wins) bad++;
  }
  if (bad) { console.error('\n' + bad + ' scenario(s) broken'); process.exit(1); }
}

function sweep(only?: string) {
  for (const s of SCENARIOS) {
    if (only && s.id !== only) continue;
    applyScenario(s);
    // the reference's own machine settings; the sweep is over the recipe
    const ref = REFERENCE[s.id];
    const results: R[] = [];
    for (const binder of [3.5, 4.5, 5.5, 6.5, 8.0]) {
      for (const slump of [75, 95, 115, 135, 160]) {
        for (const stroke of [55, 70]) {
          for (const use of [0, 1] as const) {
            results.push(run({ binder, slump, stroke, use, sp: ref.sp, up: ref.up }));
          }
        }
      }
    }
    const wins = results.filter((r) => r.ok).sort((a, b) => a.cost - b.cost);
    const under = results.filter((r) => !r.ok && r.ucs < DESIGN.targetUcs).length;
    const plugged = results.filter((r) => r.plugs > 0).length;
    const spilled = results.filter((r) => r.spill >= 1).length;
    const slow = results.filter((r) => r.hours >= 149).length;

    console.log('\n== ' + s.era + ' · ' + s.title + ' ==');
    console.log('   line ' + DESIGN.pipeLength + ' m, drop ' + DESIGN.pipeDrop + ' m, '
      + DESIGN.pipeId + ' mm, g ' + DESIGN.gravity + ', cure x' + DESIGN.cureFactor
      + ', target ' + DESIGN.targetUcs + ' kPa, budget $' + s.budget + '/m3');
    console.log('   ' + wins.length + ' of ' + results.length + ' win  ·  '
      + under + ' under strength, ' + plugged + ' plugged, ' + spilled + ' spilled, '
      + slow + ' never finished');
    console.log('   binder  slump  stroke  on               |   UCS    min    $/m3   hours');
    for (const b of DESIGN.binders) {
      for (const r of wins.filter((w) => w.which === b.short).slice(0, 3)) {
        console.log('   ' + r.binder.toFixed(1).padStart(5) + '%',
          r.slump.toString().padStart(5) + 'mm', r.stroke.toString().padStart(5) + '%',
          ' ' + r.which.padEnd(16) + '|',
          r.ucs.toFixed(0).padStart(5), r.min.toFixed(0).padStart(6),
          money(r.cost).padStart(8), r.hours.toFixed(1).padStart(6) + ' h');
      }
    }
    const d = new Plant();
    const h = shift(d);
    const t = d.telemetry;
    console.log('   defaults: ' + t.stope.pct.toFixed(0) + '% in ' + h.toFixed(1) + ' h, UCS '
      + t.stope.avgUcs.toFixed(0) + ', ' + money(t.cost.perM3) + '/m3, '
      + t.blockages + ' plugs, ' + t.spills.totalM3.toFixed(0) + ' m3 spilled, '
      + (t.pump.pressure / 100).toFixed(0) + ' bar');
  }
}

if (process.argv[2] === '--quick') quick();
else sweep(process.argv[2]);
