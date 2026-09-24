/**
 * The sizing game, checked without a browser.
 *
 * 1. ProcessPro's crushing example, rebuilt through the game's circuit, must
 *    land where the example says it does.
 * 2. Every contract must be winnable: a plain designer starts from the
 *    starter plant and fixes whatever fails - a bigger machine, a tighter
 *    setting, more cyclones, a wider thickener, more binder - until every
 *    station passes, the way a player would. A contract it cannot close is a
 *    bug in the contract generator or in the catalogue, not a hard level.
 *
 *   npm run verify:sizing            50 contracts
 *   npm run verify:sizing -- 500     more
 */
import { S, underflowCw, type Contract, type Design } from '../src/sizing/circuit';
import { summarise, type Summary } from '../src/sizing/summary';
import { contractFor, starterDesign } from '../src/sizing/contract';
import { STATIONS, stationPasses } from '../src/sizing/stations';
import { costsFor } from '../src/sizing/costs';
import { APERTURES, CONES, CYCLONES, JAWS, PASTE_PUMPS, PIPES, PRESS_PLATES, RAKE_DRIVES, SCREENS } from '../src/sizing/equipment';
import { pumpDuty } from '../src/sizing/backfill';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

// ------------------------------------------------ 1. the example, rebuilt

const EXAMPLE: Contract = {
  seed: 0,
  tph: 300,
  rom: { x50: 0.18, xmax: 0.75, b: 2.3 },
  density: 2750,
  wi: 14.2,
  ai: 0.15,
  breakage: 0.94,
  p80: 106e-6,
  overflowCw: [0.3, 0.38],
  // the crushing example stops at the cyclones; any backfill will do
  backfill: contractFor(1).backfill,
};

const EXAMPLE_DESIGN: Design = {
  ...starterDesign(EXAMPLE),
  grizzly: 0.15,
  jawCss: 0.125,
  secCss: 0.038,
  tertCss: 0.01,
  screenMesh: APERTURES.indexOf(0.008),
  millD: 5.2,
  millL: 8.0,
  millJ: 0.33,
  millCw: 0.72,
  cycModel: CYCLONES.indexOf(0.5),
  cyclones: 7,
  cycFeedCw: 0.55,
  cycUfCw: 0.72,
};

{
  const s = summarise(EXAMPLE, EXAMPLE_DESIGN);
  const near = (v: number, want: number, tol: number) => Math.abs(v - want) <= tol * want;
  check('example converges', s.converged, `${s.ms.toFixed(0)} ms`);
  check('grizzly oversize 184 t/h', near(s.streams[S.grizzlyOver].tph, 184, 0.01), s.streams[S.grizzlyOver].tph.toFixed(1));
  check('jaw product P80 99 mm', near(s.streams[S.jawProduct].p80, 0.099, 0.01), (s.streams[S.jawProduct].p80 * 1000).toFixed(1));
  check('secondary product P80 28 mm', near(s.streams[S.secProduct].p80, 0.0285, 0.01), (s.streams[S.secProduct].p80 * 1000).toFixed(1));
  check('tertiary circulating 349 t/h', near(s.streams[S.screenOver].tph, 349, 0.01), s.streams[S.screenOver].tph.toFixed(1));
  check('fine ore P80 6.3 mm', near(s.streams[S.fineOre].p80, 0.0063, 0.01), (s.streams[S.fineOre].p80 * 1000).toFixed(2));
}

// ------------------------------------------- 2. every contract, closed

type Fix = (d: Design) => Design | null;

const up = (d: Design, key: keyof Design, max: number, by = 1): Design | null =>
  d[key] + by <= max + 1e-9 ? { ...d, [key]: +(d[key] + by).toFixed(4) } : null;
const down = (d: Design, key: keyof Design, min: number, by = 1): Design | null =>
  d[key] - by >= min - 1e-9 ? { ...d, [key]: +(d[key] - by).toFixed(4) } : null;
const res = (s: Summary, node: string, key: string) => s.results[node]?.[key] ?? NaN;
const pick = <T,>(list: T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, Math.round(i)))];

/** What a player would try for each failing check, most direct first. */
function nextMove(c: Contract, d: Design, s: Summary): Design | null {
  const fixes: Fix[] = [];
  const st = s.streams;
  const jaw = pick(JAWS, d.jawModel);
  if (st[S.grizzlyOver].top > res(s, 'JAW', 'maxFeed')) fixes.push((d) => up(d, 'jawModel', JAWS.length - 1));
  if (res(s, 'JAW', 'load') > 1) fixes.push((d) => (d.jawCss < jaw.cssMax ? { ...d, jawCss: Math.min(jaw.cssMax, d.jawCss + 0.01) } : up(d, 'jawModel', JAWS.length - 1)));
  if (st[S.reclaim].top > res(s, 'SEC', 'maxFeed')) fixes.push((d) => up(d, 'secModel', CONES.length - 1) ?? { ...d, jawCss: Math.max(jaw.cssMin, d.jawCss - 0.01) });
  if (res(s, 'SEC', 'load') > 1) fixes.push((d) => up(d, 'secModel', CONES.length - 1));
  if (res(s, 'SCR', 'load') > 1) fixes.push((d) => up(d, 'screens', 8) ?? up(d, 'screenModel', SCREENS.length - 1));
  if (st[S.screenOver].top > res(s, 'TERT', 'maxFeed')) fixes.push((d) => up(d, 'tertModel', CONES.length - 1) ?? down(d, 'secCss', pick(CONES, d.secModel).cssMin, 0.002));
  if (res(s, 'TERT', 'load') > 1) fixes.push((d) => up(d, 'tertModel', CONES.length - 1) ?? up(d, 'screenMesh', APERTURES.length - 1));
  if (res(s, 'BM', 'tooCoarse') > 0.05) fixes.push((d) => down(d, 'screenMesh', 0));
  const of = st[S.cycOver];
  // a grinding circuit that ran away: ease the cyclone densities back to where circuits run
  // a grinding circuit with no steady state: the mill cannot break what comes back to it
  const growMill = (d: Design): Design | null =>
    d.millL / d.millD < 1.6
      ? { ...d, millL: +(d.millL + 0.2).toFixed(1) }
      : d.millD < 8
        ? { ...d, millD: +(d.millD + 0.1).toFixed(1), millL: +(d.millL + 0.1).toFixed(1) }
        : null;
  if (!s.converged) fixes.push((d) => growMill(d) ?? (d.cycUfCw > 0.7 ? down(d, 'cycUfCw', 0.7, 0.02) : up(d, 'cyclones', 24)));
  if (res(s, 'CYC', 'underflowCv') > 0.53) fixes.push((d) => down(d, 'cycUfCw', 0.6, 0.01));
  // a coarse grind: a bigger mill, then fewer cyclones while the pressure has room (they cut finer)
  if (of.p80 > c.p80) {
    fixes.push((d) => growMill(d) ?? (res(s, 'CYC', 'pressure') < 150e3 ? down(d, 'cyclones', 1) : null));
  }
  // flotation feed density, on the sump water within the range circuits run at
  if (of.cw > c.overflowCw[1]) fixes.push((d) => down(d, 'cycFeedCw', 0.45, 0.01));
  if (of.cw < c.overflowCw[0]) fixes.push((d) => up(d, 'cycFeedCw', 0.62, 0.01) ?? up(d, 'cycUfCw', 0.76, 0.01));
  // too much pressure: more cyclones
  if (res(s, 'CYC', 'pressure') > 200e3) fixes.push((d) => up(d, 'cyclones', 24));

  // the paste plant, once the circuit before it has settled
  if (s.converged) {
    const thinner = (d: Design): Design | null => {
      const next = d.ufPump + 5 / 3600;
      return underflowCw(c, next) >= 0.45 ? { ...d, ufPump: next } : null;
    };
    const wider = (d: Design) => up(d, 'thDiam', 45, 1);
    if (res(s, 'TH', 'fluxLoad') > 1) fixes.push((d) => wider(d) ?? thinner(d));
    if (res(s, 'TH', 'riseRate') > res(s, 'TH', 'feedwellSettling')) fixes.push(wider);
    if (res(s, 'TH', 'bedHeight') > res(s, 'TH', 'bedAvailable')) fixes.push((d) => up(d, 'thDepth', 12, 0.5) ?? wider(d) ?? thinner(d));
    if (res(s, 'TH', 'rakeLoad') > 1) fixes.push((d) => up(d, 'rakeDrive', RAKE_DRIVES.length - 1) ?? wider(d));
    const plate = pick(PRESS_PLATES, d.pressPlate);
    if (Math.round(d.pressChambers) > plate.maxChambers) fixes.push((d) => up(d, 'pressPlate', PRESS_PLATES.length - 1) ?? { ...d, pressChambers: plate.maxChambers });
    if (res(s, 'FL', 'load') > 1) {
      fixes.push((d) => (d.pressChambers + 5 <= plate.maxChambers ? up(d, 'pressChambers', 200, 5) : null) ?? up(d, 'presses', 8) ?? up(d, 'pressPlate', PRESS_PLATES.length - 1));
    }
    const b = c.backfill;
    const slump = res(s, 'L1', 'slump');
    const paste = s.streams[S.paste];
    if (paste && Math.abs(paste.cw - d.pasteCw) >= 0.003) fixes.push((d) => down(d, 'pasteCw', 0.68, 0.005));
    if (slump < b.slump[0]) fixes.push((d) => down(d, 'pasteCw', 0.68, 0.0025));
    if (slump > b.slump[1]) fixes.push((d) => up(d, 'pasteCw', 0.84, 0.0025));
    if (res(s, 'BN', 'strength') < b.ucs) fixes.push((d) => up(d, 'binder', 0.12, 0.0025));
    const duty = pumpDuty(c, d, s);
    const pump = pick(PASTE_PUMPS, d.pumpModel);
    // the pumps first: they do not change the line
    if (duty.perPump > pump.flow) fixes.push((d) => up(d, 'pumps', 4) ?? up(d, 'pumpModel', PASTE_PUMPS.length - 1));
    if (duty.pressure > pump.pressure) fixes.push((d) => up(d, 'pumpModel', PASTE_PUMPS.length - 1) ?? (res(s, 'L2', 'pressure') > 0 ? up(d, 'pipeModel', PIPES.length - 1) : null));
    // a slack line wants more friction: a narrower line, or a stiffer paste while the slump allows
    if (res(s, 'L2', 'pressure') < 0) fixes.push((d) => down(d, 'pipeModel', 0) ?? (slump - 0.005 > b.slump[0] ? up(d, 'pasteCw', 0.84, 0.0025) : null));
    if (!(res(s, 'L1', 'reynolds') < res(s, 'L1', 'criticalReynolds'))) fixes.push((d) => (res(s, 'L2', 'pressure') > 0 ? up(d, 'pipeModel', PIPES.length - 1) : null) ?? (slump - 0.005 > b.slump[0] ? up(d, 'pasteCw', 0.84, 0.0025) : null));
  }
  for (const f of fixes) {
    const next = f(d);
    if (next) return next;
  }
  return null;
}

const n = Number(process.argv[2]) || 50;
let closed = 0;
const capex: number[] = [];
const moves: number[] = [];
const t0 = performance.now();
// DUMP=<seed> closes that one contract and prints the design
const seeds = process.env.DUMP ? [Number(process.env.DUMP)] : Array.from({ length: n }, (_, i) => i + 1);
for (const seed of seeds) {
  const c = contractFor(seed);
  let d = starterDesign(c);
  let s = summarise(c, d);
  let steps = 0;
  const passes = () => STATIONS.every((st) => stationPasses(st, c, d, s) === true);
  while (!passes() && steps < 600) {
    const next = nextMove(c, d, s);
    if (!next) break;
    d = next;
    s = summarise(c, d);
    steps++;
  }
  if (process.env.DUMP) console.log('DESIGN ' + JSON.stringify(d));
  if (passes()) {
    closed++;
    capex.push(costsFor(c, d, s).capex / 1e6);
    moves.push(steps);
  } else {
    const failing = STATIONS.filter((st) => stationPasses(st, c, d, s) !== true).map((st) => {
      const bad = st.checks(c, d, s).filter((k) => k.ok !== true).map((k) => `${k.label} ${k.value} (${k.limit})`);
      return `${st.short}: ${bad.join('; ')}`;
    });
    console.log(`  contract ${seed}: ${c.tph} t/h, Wi ${c.wi}, P80 ${(c.p80 * 1e6).toFixed(0)} µm, drop ${c.backfill.drop} m, level ${c.backfill.level} m, stuck after ${steps} moves -> ${failing.join(' | ')}`);
    if (process.env.DEBUG) console.log('   ', JSON.stringify(d), 'converged', s.converged, 'kPa', (res(s, 'CYC', 'pressure') / 1000).toFixed(0), 'of t/h', s.streams[S.cycOver].tph.toFixed(0), 'uf t/h', s.streams[S.cycUnder].tph.toFixed(0), 'P80 um', (s.streams[S.cycOver].p80 * 1e6).toFixed(0), 'mill kW', (res(s, 'BM', 'powerDraw') / 1000).toFixed(0), s.diagnostics.filter((x) => x.nodeId === 'CYC' || !x.nodeId).map((x) => x.message).join(' / '));
  }
}
const q = (xs: number[], f: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * f)];
check(
  `${closed} of ${seeds.length} contracts closed by the plain designer`,
  closed === seeds.length,
  `${((performance.now() - t0) / 1000).toFixed(1)} s; capital P10 $${q(capex, 0.1)?.toFixed(1)}M, P90 $${q(capex, 0.9)?.toFixed(1)}M; moves median ${q(moves, 0.5)}`,
);

if (failed) process.exit(1);
