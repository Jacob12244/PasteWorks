import { bedHeight, pressRating, abramsStrength, type PulpTestData } from '@jacob12244/proc-engine';
import {
  PRESS_PRESSURE,
  S,
  WATER,
  pumpForCw,
  tailsSolids,
  underflowCw,
  type Contract,
  type Design,
} from './circuit';
import { PASTE_PUMPS, PIPES, PRESS_PLATES, RAKE_DRIVES, pipeLabel, plateLabel, pumpLabel, rakeLabel } from './equipment';
import type { Summary } from './summary';
import { AMBER, CYAN, GREY, LIME, PINK, fmt, known, pick, res, type Check, type Plot, type Station } from './kit';

/**
 * The paste backfill plant: thickener, filter presses, the paste recipe, and
 * the pumps and line down to the stopes. As with the circuit before it, every
 * check reads a number ProcessPro reported for the solve. The charts redraw
 * the same models across a range - the bed a thickener needs at every
 * underflow density, say - from the engine's own functions.
 */

/** Solids volume fraction at a solids mass fraction. */
const cvAt = (cw: number, density: number) => cw / density / (cw / density + (1 - cw) / WATER);

const pulpOf = (c: Contract): PulpTestData => ({ ...c.backfill.thick });

/** The paste pumps' duty: the pressure they make, the flow each passes, and the power they draw. */
export function pumpDuty(c: Contract, d: Design, s: Summary) {
  const l1 = res(s, 'L1', 'pressure');
  const l2 = res(s, 'L2', 'pressure');
  const pressure = l1 + Math.max(0, l2);
  const flow = (s.streams[S.paste]?.m3h ?? Number.NaN) / 3600;
  const pumps = Math.max(1, Math.round(d.pumps));
  return { pressure, flow, perPump: flow / pumps, pumps, power: (pressure * flow) / PUMP_EFFICIENCY };
}

/** A piston pump's hydraulic efficiency, motor included: this game's assumption. */
export const PUMP_EFFICIENCY = 0.8;

const bandCheck = (label: string, v: number, lo: number, hi: number, show: (x: number) => string): Check => ({
  label,
  value: show(v),
  limit: `${show(lo)} – ${show(hi)}`,
  ok: known(v) ? v >= lo - 1e-9 && v <= hi + 1e-9 : null,
});

export const BACKFILL_STATIONS: Station[] = [
  {
    id: 'thickener',
    title: 'Paste thickener',
    short: 'Thickener',
    blurb:
      'Flotation takes its concentrate and the tailings come here. Flocs settle, and below the gel point they form a bed that holds its own weight: the deeper the bed, the harder it squeezes the water out. A wider tank passes each square metre less and needs a shorter bed; the underflow pump sets how thick the underflow is drawn.',
    sliders: [
      { key: 'thDiam', label: 'Diameter', min: 8, max: 45, step: 0.5, show: (v) => fmt.m(v) },
      { key: 'thDepth', label: 'Sidewall depth', min: 3, max: 16, step: 0.5, show: (v) => fmt.m(v), hint: '1.5 m of it is feedwell and clear water; the rest can hold bed.' },
      {
        key: 'ufPump',
        label: 'Underflow pump',
        min: 0,
        max: 1,
        step: 1 / 3600,
        limits: (c) => ({ min: Math.ceil(pumpForCw(c, 0.76) * 3600) / 3600, max: Math.floor(pumpForCw(c, 0.45) * 3600) / 3600, step: 1 / 3600 }),
        show: (v, c) => `${fmt.m3h(v)}, ${fmt.pct(underflowCw(c, v), 1)} solids`,
        hint: 'Pumping slower draws a thicker underflow, and it needs a deeper bed.',
      },
      { key: 'rakeDrive', label: 'Rake drive', min: 0, max: RAKE_DRIVES.length - 1, step: 1, ladder: true, show: (v) => rakeLabel(pick(RAKE_DRIVES, v)) },
    ],
    nodes: ['FLOT', 'TH'],
    checks(c, d, s) {
      const load = res(s, 'TH', 'fluxLoad');
      const bed = res(s, 'TH', 'bedHeight');
      const room = res(s, 'TH', 'bedAvailable');
      const rise = res(s, 'TH', 'riseRate');
      const settle = res(s, 'TH', 'feedwellSettling');
      const rake = res(s, 'TH', 'rakeLoad');
      return [
        {
          label: 'Solids loading within the limiting flux',
          value: fmt.flux(res(s, 'TH', 'solidsLoading')),
          limit: `≤ ${fmt.flux(res(s, 'TH', 'limitingFlux'))}`,
          ok: known(load) ? load <= 1 : null,
        },
        { label: 'Bed the underflow needs fits the tank', value: fmt.m(bed), limit: `≤ ${fmt.m(room)}`, ok: known(room) ? bed <= room : null },
        { label: 'Overflow runs clear', value: fmt.mh(rise), limit: `≤ ${fmt.mh(settle)} settling`, ok: known(rise) && known(settle) ? rise <= settle : null },
        { label: 'Rake drive has the torque', value: fmt.kNm(res(s, 'TH', 'torqueCutOut')), limit: `≤ ${fmt.kNm(res(s, 'TH', 'rakeTorque'))}`, ok: known(rake) ? rake <= 1 : null },
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      return [
        { label: 'Concentrate to the concentrate thickener', value: fmt.tph(st[S.concentrate]?.tph) },
        { label: 'Tailings', value: `${fmt.tph(st[S.tails]?.tph)} at ${fmt.pct(st[S.tails]?.cw, 1)} solids` },
        { label: 'Underflow', value: `${fmt.pct(st[S.thUnder]?.cw, 1)} solids, ${fmt.pct(res(s, 'TH', 'underflowCv'), 1)} by volume` },
        { label: 'Settling area', value: `${Math.round(res(s, 'TH', 'area')).toLocaleString('en')} m²` },
        { label: 'Rise rate', value: fmt.mh(res(s, 'TH', 'riseRate')) },
        { label: 'Rake torque, 10-year (Metso)', value: fmt.kNm(res(s, 'TH', 'torque10y')) },
        { label: 'Return water, with the filtrate', value: fmt.m3h((st[S.thOver]?.m3h ?? NaN) / 3600 + (st[S.filtrate]?.m3h ?? NaN) / 3600) },
      ];
    },
    chart: [],
    plot(c, d, s) {
      const pulp = pulpOf(c);
      const area = (Math.PI * d.thDiam * d.thDiam) / 4;
      const q = tailsSolids(c) / c.density / area;
      const room = Math.max(0, d.thDepth - 1.5);
      const top = Math.max(12, room * 1.8);
      const points: Array<[number, number]> = [];
      for (let cw = 0.45; cw <= 0.765; cw += 0.005) {
        const h = bedHeight(pulp, q, cvAt(cw, c.density), c.density, WATER);
        if (!Number.isFinite(h) || h > top) {
          points.push([cw, top]);
          break;
        }
        points.push([cw, h]);
      }
      const cw = underflowCw(c, d.ufPump);
      const bed = res(s, 'TH', 'bedHeight');
      return {
        title: 'Bed needed against underflow density',
        x: { label: 'underflow solids', fmt: (v) => fmt.pct(v) },
        y: { label: 'bed, m', fmt: (v) => v.toFixed(0) },
        lines: [{ label: `Bed needed in a ${fmt.m(d.thDiam)} tank`, colour: AMBER, points }],
        marks: [{ y: room, colour: CYAN, label: `Bed this tank holds, ${fmt.m(room)}` }],
        dot: { x: cw, y: Math.min(top, known(bed) ? bed : top), colour: LIME, label: `Now: ${fmt.pct(cw, 1)}` },
      };
    },
  },
  {
    id: 'filter',
    title: 'Filter presses',
    short: 'Filter',
    blurb:
      'Recessed-plate presses squeeze the underflow into cake. Each cycle fills the chambers from both faces, and a cake twice as thick takes four times as long to form; the squeeze, blow, discharge and wash take a quarter of an hour whatever the cake. A thicker underflow fills them faster.',
    sliders: [
      { key: 'pressPlate', label: 'Plate size', min: 0, max: PRESS_PLATES.length - 1, step: 1, ladder: true, show: (v) => plateLabel(pick(PRESS_PLATES, v)) },
      { key: 'pressChambers', label: 'Chambers per press', min: 10, max: 200, step: 1, show: (v) => `${Math.round(v)}` },
      { key: 'presses', label: 'Presses', min: 1, max: 8, step: 1, show: (v) => `${Math.round(v)}` },
      { key: 'chamberDepth', label: 'Chamber depth', min: 0.025, max: 0.07, step: 0.005, show: (v) => `${(v * 1000).toFixed(0)} mm`, hint: 'The cake’s thickness when the chamber is full.' },
    ],
    nodes: ['UFP', 'FL'],
    checks(c, d, s) {
      const plate = pick(PRESS_PLATES, d.pressPlate);
      const load = res(s, 'FL', 'load');
      return [
        { label: 'Presses keep up with the cake', value: fmt.pct(load), limit: `≤ 100% of ${fmt.tph(res(s, 'FL', 'capacity') * 3.6)}`, ok: known(load) ? load <= 1 : null },
        { label: 'Chambers fit the press frame', value: `${Math.round(d.pressChambers)}`, limit: `≤ ${plate.maxChambers}`, ok: Math.round(d.pressChambers) <= plate.maxChambers },
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      const cycle = res(s, 'FL', 'cycleTime');
      return [
        { label: 'Filter feed', value: `${fmt.tph(st[S.filterFeed]?.tph)} at ${fmt.pct(st[S.filterFeed]?.cw, 1)} solids` },
        { label: 'Filtration time', value: fmt.min(res(s, 'FL', 'filtrationTime')) },
        { label: 'Cycle', value: `${fmt.min(cycle)}, ${(3600 / cycle).toFixed(1)} an hour` },
        { label: 'Filtration area', value: `${Math.round(res(s, 'FL', 'area')).toLocaleString('en')} m²` },
        { label: 'Cake', value: `${fmt.tph(st[S.cake]?.tph)} at ${fmt.pct(st[S.cake]?.cw, 1)} solids` },
      ];
    },
    chart: [],
    plot(c, d, s) {
      const plate = pick(PRESS_PLATES, d.pressPlate);
      const feed = s.streams[S.filterFeed];
      if (!feed) return null;
      const at = (depth: number) =>
        pressRating({
          chamberArea: plate.chamberArea,
          chamberDepth: depth,
          chambers: d.pressChambers,
          units: d.presses,
          pressure: PRESS_PRESSURE,
          cakeResistance: c.backfill.alpha,
          viscosity: 0.001,
          technicalTime: c.backfill.technicalTime,
          feedSolids: feed.cw,
          cakeSolids: c.backfill.cakeCw,
          solidsDensity: c.density,
          liquidDensity: WATER,
        }).capacity * 3.6;
      const points: Array<[number, number]> = [];
      for (let e = 0.02; e <= 0.0801; e += 0.0025) points.push([e * 1000, at(e)]);
      return {
        title: 'Press capacity against chamber depth',
        x: { label: 'chamber depth, mm', fmt: (v) => v.toFixed(0) },
        y: { label: 't/h', fmt: (v) => v.toFixed(0) },
        lines: [{ label: `${Math.round(d.presses)} x ${Math.round(d.pressChambers)} chambers`, colour: AMBER, points }],
        marks: [{ y: feed.tph, colour: PINK, label: `Cake to make, ${fmt.tph(feed.tph)}` }],
        dot: { x: d.chamberDepth * 1000, y: at(d.chamberDepth), colour: LIME, label: `Now: ${(d.chamberDepth * 1000).toFixed(0)} mm` },
      };
    },
  },
  {
    id: 'paste',
    title: 'Paste mixing',
    short: 'Paste',
    blurb:
      'The cake is mixed back with water and binder into a paste. More solids make a stiffer paste - less slump, more friction in the line - and a stronger fill for the same binder, because strength follows the water to binder ratio. Binder is most of what a paste plant costs to run.',
    sliders: [
      { key: 'pasteCw', label: 'Paste solids', min: 0.68, max: 0.84, step: 0.0025, show: (v) => fmt.pct(v, 1), hint: 'Binder included. Water goes in at the mixer.' },
      { key: 'binder', label: 'Binder, of the paste solids', min: 0.02, max: 0.12, step: 0.0025, show: (v) => fmt.pct(v, 2) },
    ],
    nodes: ['PMX', 'BN'],
    checks(c, d, s) {
      const b = c.backfill;
      const paste = s.streams[S.paste];
      const strength = res(s, 'BN', 'strength');
      return [
        bandCheck('Slump in the mine’s band', res(s, 'L1', 'slump'), b.slump[0], b.slump[1], (v) => `${(v * 1000).toFixed(0)} mm`),
        { label: 'Fill strength at 28 days', value: fmt.kPa(strength), limit: `≥ ${fmt.kPa(b.ucs)}`, ok: known(strength) ? strength >= b.ucs : null },
        {
          label: 'Cake wet enough to make it',
          value: fmt.pct(paste?.cw, 1),
          limit: `= ${fmt.pct(d.pasteCw, 1)}`,
          ok: paste ? Math.abs(paste.cw - d.pasteCw) < 0.003 : null,
        },
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      const paste = st[S.paste];
      const water = (st[S.wetPaste]?.m3h ?? NaN) - (st[S.cake]?.m3h ?? NaN);
      return [
        { label: 'Paste', value: `${fmt.tph(paste ? paste.tph / paste.cw : NaN)}, ${fmt.m3h((paste?.m3h ?? NaN) / 3600)}` },
        { label: 'Density', value: paste ? `${((paste.tph / paste.cw) / paste.m3h).toFixed(2)} t/m³` : '—' },
        { label: 'Mixing water', value: fmt.m3h(water / 3600) },
        { label: 'Binder', value: fmt.tph((paste?.tph ?? NaN) * d.binder) },
        { label: 'Water to binder', value: res(s, 'BN', 'waterCement').toFixed(2) },
        { label: 'Yield stress', value: `${Math.round(res(s, 'L1', 'yieldStress'))} Pa` },
        { label: 'Plastic viscosity', value: `${res(s, 'L1', 'plasticViscosity').toFixed(2)} Pa·s` },
      ];
    },
    chart: [],
    plot(c, d, s) {
      const { a, b } = c.backfill.strength;
      const line = (cw: number) => {
        const points: Array<[number, number]> = [];
        for (let bd = 0.02; bd <= 0.1201; bd += 0.0025) points.push([bd * 100, abramsStrength(a, b, (1 - cw) / (cw * bd)) / 1000]);
        return points;
      };
      const now = res(s, 'BN', 'strength') / 1000;
      return {
        title: 'Fill strength against binder',
        x: { label: 'binder, % of solids', fmt: (v) => v.toFixed(0) },
        y: { label: 'kPa at 28 days', fmt: (v) => Math.round(v).toLocaleString('en') },
        lines: [
          { label: `${fmt.pct(d.pasteCw - 0.02, 1)} solids`, colour: GREY, points: line(d.pasteCw - 0.02), dashed: true },
          { label: `${fmt.pct(d.pasteCw, 1)} solids`, colour: AMBER, points: line(d.pasteCw) },
          { label: `${fmt.pct(d.pasteCw + 0.02, 1)} solids`, colour: GREY, points: line(d.pasteCw + 0.02), dashed: true },
        ],
        marks: [{ y: c.backfill.ucs / 1000, colour: PINK, label: `Mine’s strength, ${fmt.kPa(c.backfill.ucs)}` }],
        dot: known(now) ? { x: d.binder * 100, y: now, colour: LIME, label: `Now: ${fmt.pct(d.binder, 2)}` } : undefined,
      };
    },
  },
  {
    id: 'pumping',
    title: 'Paste pumps and line',
    short: 'Pumping',
    blurb:
      'Piston pumps push the paste along the surface to the borehole, down it and along the level to the stope. Down the hole the paste’s weight works for you; if it outweighs the friction the paste falls free and the line runs part-full, which wears it through. A narrower line has more friction and needs more pressure where it is flat.',
    sliders: [
      { key: 'pipeModel', label: 'Line size', min: 0, max: PIPES.length - 1, step: 1, ladder: true, show: (v) => pipeLabel(pick(PIPES, v)) },
      { key: 'pumpModel', label: 'Pump', min: 0, max: PASTE_PUMPS.length - 1, step: 1, ladder: true, show: (v) => pumpLabel(pick(PASTE_PUMPS, v)) },
      { key: 'pumps', label: 'Pumps in parallel', min: 1, max: 4, step: 1, show: (v) => `${Math.round(v)}` },
    ],
    nodes: ['PU', 'L1', 'L2'],
    checks(c, d, s) {
      const pump = pick(PASTE_PUMPS, d.pumpModel);
      const duty = pumpDuty(c, d, s);
      const l2 = res(s, 'L2', 'pressure');
      const re = res(s, 'L1', 'reynolds');
      const reC = res(s, 'L1', 'criticalReynolds');
      return [
        { label: 'Pumps make the pressure', value: fmt.kPa(duty.pressure), limit: `≤ ${fmt.kPa(pump.pressure)}`, ok: known(duty.pressure) ? duty.pressure <= pump.pressure : null },
        { label: 'Pumps make the flow', value: `${fmt.m3h(duty.perPump)} each`, limit: `≤ ${fmt.m3h(pump.flow)}`, ok: known(duty.perPump) ? duty.perPump <= pump.flow : null },
        { label: 'Line runs full down the hole', value: fmt.kPa(l2), limit: '≥ 0 kPa at the collar', ok: known(l2) ? l2 >= 0 : null },
        { label: 'Flow stays laminar', value: known(re) ? re.toFixed(0) : '—', limit: `< ${known(reC) ? reC.toFixed(0) : '—'} (Hanks)`, ok: known(re) && known(reC) ? re < reC : null },
      ];
    },
    rows(c, d, s) {
      const b = c.backfill;
      const duty = pumpDuty(c, d, s);
      return [
        { label: 'Line', value: `${b.surface} m on the surface, ${b.drop} m down, ${b.level} m along the level` },
        { label: 'Velocity', value: `${res(s, 'L1', 'velocity').toFixed(2)} m/s` },
        { label: 'Friction', value: `${(res(s, 'L1', 'gradient') / 1000).toFixed(2)} kPa/m` },
        { label: 'Weight of paste down the hole', value: fmt.kPa(res(s, 'L1', 'gradient') * (b.drop + b.level) - res(s, 'L2', 'pressure')) },
        { label: 'Pressure at the collar', value: fmt.kPa(res(s, 'L2', 'pressure')) },
        { label: 'Pump power', value: fmt.kW(duty.power) },
      ];
    },
    chart: [],
    plot(c, d, s) {
      const b = c.backfill;
      const pump = pick(PASTE_PUMPS, d.pumpModel);
      const grad = res(s, 'L1', 'gradient');
      const paste = s.streams[S.paste];
      if (!known(grad) || !paste) return null;
      const rho = paste.tph / paste.cw / paste.m3h * 1000;
      const head = rho * 9.81;
      const duty = pumpDuty(c, d, s);
      const collar = Math.max(0, res(s, 'L2', 'pressure'));
      const bottom = grad * b.level;
      const kPa = (p: number) => p / 1000;
      const points: Array<[number, number]> = [[0, kPa(duty.pressure)], [b.surface, kPa(collar)]];
      // a slack line is empty down to where the column of paste in the hole balances the friction below it
      if (collar <= 0 && head > grad) points.push([b.surface + Math.max(0, b.drop - bottom / (head - grad)), 0]);
      points.push([b.surface + b.drop, kPa(bottom)], [b.surface + b.drop + b.level, 0]);
      return {
        title: 'Pressure along the line',
        x: { label: 'metres of line', fmt: (v) => Math.round(v).toLocaleString('en') },
        y: { label: 'kPa', fmt: (v) => Math.round(v).toLocaleString('en') },
        lines: [{ label: 'Pressure in the paste', colour: AMBER, points }],
        marks: [{ y: pump.pressure / 1000, colour: PINK, label: `What the pumps can make, ${fmt.kPa(pump.pressure)}` }],
        dot: { x: b.surface, y: kPa(collar), colour: collar > 0 ? LIME : PINK, label: 'Borehole collar' },
      };
    },
  },
];
