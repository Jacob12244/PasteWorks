import { S, type Contract, type Design } from './circuit';
import { APERTURES, CONES, CYCLONES, JAWS, SCREENS, cavity, coneLabel, cycloneLabel, jawLabel, screenLabel } from './equipment';
import type { Summary } from './summary';
import { AMBER, CYAN, GREY, LIME, fmt, known, pick, res, type Check, type Station } from './kit';
import { BACKFILL_STATIONS } from './backfill';

export { fmt } from './kit';
export type { Check, Row, Slider, Station, Plot, ChartLine } from './kit';

/**
 * The stations, in the order the ore meets them: what each one's sliders
 * move, what it has to satisfy, and what it reports. Every check reads a
 * number ProcessPro reported for the solve; none of them is computed here.
 * The crushing and grinding circuit is here; the paste plant after it is in
 * backfill.ts.
 */

/** Load against capacity, as ProcessPro reports it on a sized machine. */
function capacityCheck(s: Summary, node: string, label: string): Check {
  const load = res(s, node, 'load');
  const cap = res(s, node, 'capacity');
  return {
    label,
    value: known(load) ? fmt.pct(load) : '—',
    limit: known(cap) ? `≤ 100% of ${fmt.tph(cap * 3.6)}` : '≤ 100%',
    ok: known(load) ? load <= 1 : null,
  };
}

/** The largest rock in the feed against the largest the machine will take. */
function feedSizeCheck(s: Summary, node: string, stream: string, label: string): Check {
  const top = s.streams[stream]?.top ?? Number.NaN;
  const max = res(s, node, 'maxFeed');
  return {
    label,
    value: fmt.size(top),
    limit: known(max) ? `≤ ${fmt.size(max)}` : 'fits the opening',
    ok: known(max) && known(top) ? top <= max : null,
  };
}

function settingCheck(css: number, lo: number, hi: number): Check {
  return {
    label: 'Setting within this machine’s range',
    value: fmt.size(css),
    limit: `${fmt.size(lo)} – ${fmt.size(hi)}`,
    ok: css >= lo - 1e-9 && css <= hi + 1e-9,
  };
}

/**
 * Bond's power for the circuit, W: fine ore F80 to the contract's grind, on
 * the fresh feed. The classic cross-check on a mill's size; the grind itself
 * comes from Austin's rates, so the two agree only roughly.
 */
function bondCircuit(c: Contract, s: Summary): number {
  const f80 = s.streams[S.fineOre]?.p80 ?? NaN;
  const kWhPerT = 10 * c.wi * (1 / Math.sqrt(c.p80 * 1e6) - 1 / Math.sqrt(f80 * 1e6));
  return kWhPerT * c.tph * 1000;
}

// ---------------------------------------------------------------- stations

const CIRCUIT: Station[] = [
  {
    id: 'primary',
    title: 'Primary crushing',
    short: 'Primary',
    blurb:
      'Trucks tip run-of-mine rock over a grizzly; what falls through skips the jaw. The jaw has to swallow the biggest rock in the blast and crush the rest fast enough, and its setting decides what the stockpile gets.',
    sliders: [
      { key: 'grizzly', label: 'Grizzly bar spacing', min: 0.05, max: 0.25, step: 0.005, show: fmt.size, hint: 'Wider bars send more past the jaw, uncrushed.' },
      { key: 'jawModel', label: 'Jaw size (width x gape)', min: 0, max: JAWS.length - 1, step: 1, ladder: true, show: (v) => jawLabel(pick(JAWS, v)) },
      { key: 'jawCss', label: 'Closed side setting', min: 0.04, max: 0.3, step: 0.005, show: fmt.size, hint: 'Tighter crushes finer and takes less through.' },
    ],
    nodes: ['GRIZ', 'JAW'],
    checks(c, d, s) {
      const jaw = pick(JAWS, d.jawModel);
      return [
        feedSizeCheck(s, 'JAW', S.grizzlyOver, 'Biggest rock fits the jaw'),
        capacityCheck(s, 'JAW', 'Jaw keeps up with its feed'),
        settingCheck(d.jawCss, jaw.cssMin, jaw.cssMax),
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      return [
        { label: 'ROM top size', value: fmt.size(c.rom.xmax) },
        { label: 'Past the jaw, through the grizzly', value: fmt.tph(st[S.grizzlyUnder]?.tph) },
        { label: 'Into the jaw', value: fmt.tph(st[S.grizzlyOver]?.tph) },
        { label: 'Jaw product P80', value: fmt.size(st[S.jawProduct]?.p80) },
        { label: 'Coarse ore P80', value: fmt.size(st[S.coarseOre]?.p80) },
        { label: 'Jaw power (Bond)', value: fmt.kW(res(s, 'JAW', 'power')) },
      ];
    },
    chart: [
      { stream: S.rom, label: 'ROM', colour: GREY },
      { stream: S.jawProduct, label: 'Jaw product', colour: AMBER },
      { stream: S.coarseOre, label: 'Coarse ore', colour: CYAN },
    ],
  },
  {
    id: 'secondary',
    title: 'Secondary crushing',
    short: 'Secondary',
    blurb:
      'A cone crusher reclaims the stockpile in open circuit. Its feed opening has to take the jaw’s biggest pieces, and its setting sets up the tertiary screens.',
    sliders: [
      { key: 'secModel', label: 'Cone size', min: 0, max: CONES.length - 1, step: 1, ladder: true, show: (v) => coneLabel(pick(CONES, v)) },
      { key: 'secCss', label: 'Closed side setting', min: 0.006, max: 0.075, step: 0.001, show: fmt.size },
    ],
    nodes: ['SEC'],
    checks(c, d, s) {
      const cone = cavity(pick(CONES, d.secModel), 'coarse');
      return [
        feedSizeCheck(s, 'SEC', S.reclaim, 'Coarse ore fits the cone'),
        capacityCheck(s, 'SEC', 'Cone keeps up with its feed'),
        settingCheck(d.secCss, cone.cssMin, cone.cssMax),
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      return [
        { label: 'Feed', value: fmt.tph(st[S.reclaim]?.tph) },
        { label: 'Feed P80', value: fmt.size(st[S.reclaim]?.p80) },
        { label: 'Product P80', value: fmt.size(st[S.secProduct]?.p80) },
        { label: 'Cone power (Bond)', value: fmt.kW(res(s, 'SEC', 'power')) },
      ];
    },
    chart: [
      { stream: S.reclaim, label: 'Coarse ore', colour: GREY },
      { stream: S.secProduct, label: 'Secondary product', colour: CYAN },
    ],
  },
  {
    id: 'tertiary',
    title: 'Tertiary crushing and screening',
    short: 'Tertiary',
    blurb:
      'Screens pass the fine ore to the mill and send everything coarser round a tertiary cone and back. A finer screen makes a better mill feed and a bigger circulating load; both the screens and the cone have to carry it.',
    sliders: [
      { key: 'screenMesh', label: 'Screen aperture', min: 0, max: APERTURES.length - 1, step: 1, ladder: true, show: (v) => fmt.size(pick(APERTURES, v)) },
      { key: 'screenModel', label: 'Screen size', min: 0, max: SCREENS.length - 1, step: 1, ladder: true, show: (v) => screenLabel(pick(SCREENS, v)) },
      { key: 'screens', label: 'Screens', min: 1, max: 8, step: 1, show: (v) => `${Math.round(v)}` },
      { key: 'tertModel', label: 'Tertiary cone size', min: 0, max: CONES.length - 1, step: 1, ladder: true, show: (v) => coneLabel(pick(CONES, v)) },
      { key: 'tertCss', label: 'Tertiary setting', min: 0.006, max: 0.04, step: 0.001, show: fmt.size },
    ],
    nodes: ['SCR', 'TERT'],
    checks(c, d, s) {
      const cone = cavity(pick(CONES, d.tertModel), 'fine');
      return [
        capacityCheck(s, 'SCR', 'Screens carry their feed'),
        feedSizeCheck(s, 'TERT', S.screenOver, 'Oversize fits the tertiary cone'),
        capacityCheck(s, 'TERT', 'Tertiary cone keeps up'),
        settingCheck(d.tertCss, cone.cssMin, cone.cssMax),
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      const cl = (st[S.screenOver]?.tph ?? NaN) / (st[S.fineOre]?.tph ?? NaN);
      return [
        { label: 'Screen feed', value: fmt.tph(st[S.screenFeed]?.tph) },
        { label: 'Circulating load', value: fmt.pct(cl) },
        { label: 'Undersize efficiency', value: fmt.pct(res(s, 'SCR', 'efficiency')) },
        { label: 'Fine ore P80', value: fmt.size(st[S.fineOre]?.p80) },
        { label: 'Tertiary cone power (Bond)', value: fmt.kW(res(s, 'TERT', 'power')) },
      ];
    },
    chart: [
      { stream: S.secProduct, label: 'Secondary product', colour: GREY },
      { stream: S.screenOver, label: 'Screen oversize', colour: AMBER },
      { stream: S.fineOre, label: 'Fine ore', colour: CYAN },
    ],
  },
  {
    id: 'mill',
    title: 'Ball mill',
    short: 'Mill',
    blurb:
      'The mill grinds by rate: every size breaks at its own speed, for as long as the slurry stays in. A bigger mill holds it longer and draws more power. The grind that matters is what the cyclones let out, so this station is judged with them.',
    sliders: [
      { key: 'millD', label: 'Diameter inside liners', min: 2.4, max: 8.0, step: 0.1, show: (v) => fmt.m(v) },
      { key: 'millL', label: 'Length', min: 3.0, max: 14.0, step: 0.1, show: (v) => fmt.m(v) },
      { key: 'millJ', label: 'Ball filling, J', min: 0.25, max: 0.4, step: 0.01, show: (v) => fmt.pct(v) },
      { key: 'millCw', label: 'Mill solids', min: 0.65, max: 0.8, step: 0.01, show: (v) => fmt.pct(v) },
    ],
    nodes: ['MW', 'BM'],
    checks(c, d, s) {
      const coarse = res(s, 'BM', 'tooCoarse');
      const ld = d.millL / d.millD;
      return [
        {
          label: 'Feed the mill can break',
          value: known(coarse) ? fmt.pct(coarse) : '—',
          limit: '≤ 5% too coarse',
          ok: known(coarse) ? coarse <= 0.05 : null,
        },
        { label: 'Proportions, length over diameter', value: ld.toFixed(2), limit: '1.0 – 2.0', ok: ld >= 1 && ld <= 2 },
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      return [
        { label: 'Mill throughput, recycle included', value: fmt.tph(st[S.millFeed]?.tph) },
        { label: 'Power drawn (Bond, Rowland)', value: fmt.kW(res(s, 'BM', 'powerDraw')) },
        { label: 'Bond’s estimate for the grind', value: fmt.kW(bondCircuit(c, s)) },
        { label: 'Residence time', value: `${(res(s, 'BM', 'residenceTime') / 60).toFixed(1)} min` },
        { label: 'Mill discharge P80', value: fmt.size(st[S.millDischarge]?.p80) },
        { label: 'Grind now, with the cyclones as set', value: fmt.size(st[S.cycOver]?.p80) },
      ];
    },
    chart: [
      { stream: S.millFeed, label: 'Mill feed', colour: GREY },
      { stream: S.millDischarge, label: 'Mill discharge', colour: AMBER },
      { stream: S.cycOver, label: 'Cyclone overflow', colour: CYAN },
    ],
    target: (c) => c.p80,
  },
  {
    id: 'cyclones',
    title: 'Cyclones',
    short: 'Cyclones',
    blurb:
      'The cyclones close the mill: fines out of the top to flotation, coarse back to the mill. Fewer cyclones run at a higher pressure and cut finer; more water in the feed cuts finer too, and dilutes the flotation feed.',
    sliders: [
      { key: 'cycModel', label: 'Cyclone diameter', min: 0, max: CYCLONES.length - 1, step: 1, ladder: true, show: (v) => cycloneLabel(pick(CYCLONES, v)) },
      { key: 'cyclones', label: 'Cyclones operating', min: 1, max: 24, step: 1, show: (v) => `${Math.round(v)}` },
      { key: 'cycFeedCw', label: 'Cyclone feed solids', min: 0.4, max: 0.65, step: 0.01, show: (v) => fmt.pct(v), hint: 'Water added in the sump.' },
      { key: 'cycUfCw', label: 'Underflow solids', min: 0.6, max: 0.8, step: 0.01, show: (v) => fmt.pct(v), hint: 'Set by the apex size.' },
    ],
    nodes: ['SUMP', 'CYC'],
    checks(c, d, s) {
      const of = s.streams[S.cycOver];
      const cv = res(s, 'CYC', 'underflowCv');
      return [
        { label: 'Grind P80', value: fmt.size(of?.p80), limit: `≤ ${fmt.size(c.p80)}`, ok: of ? of.p80 <= c.p80 : null },
        {
          label: 'Flotation feed solids',
          value: fmt.pct(of?.cw, 1),
          limit: `${fmt.pct(c.overflowCw[0])} – ${fmt.pct(c.overflowCw[1])}`,
          ok: of ? of.cw >= c.overflowCw[0] && of.cw <= c.overflowCw[1] : null,
        },
        { label: 'Underflow can leave the apex', value: fmt.pct(cv), limit: '≤ 53% by volume', ok: known(cv) ? cv <= 0.53 : null },
      ];
    },
    rows(c, d, s) {
      const st = s.streams;
      const cl = (st[S.cycUnder]?.tph ?? NaN) / (st[S.cycOver]?.tph ?? NaN);
      return [
        { label: 'Pressure drop', value: `${(res(s, 'CYC', 'pressure') / 1000).toFixed(0)} kPa` },
        { label: 'Corrected cut d50c', value: fmt.size(res(s, 'CYC', 'd50c')) },
        { label: 'Feed per cyclone', value: `${(res(s, 'CYC', 'flowEach') * 3600).toFixed(0)} m³/h` },
        { label: 'Circulating load', value: fmt.pct(cl) },
        { label: 'To flotation', value: fmt.tph(st[S.cycOver]?.tph) },
      ];
    },
    chart: [
      { stream: S.cycFeed, label: 'Cyclone feed', colour: GREY },
      { stream: S.cycUnder, label: 'Underflow', colour: AMBER },
      { stream: S.cycOver, label: 'Overflow', colour: LIME },
    ],
    target: (c) => c.p80,
  },
];

export const STATIONS: Station[] = [...CIRCUIT, ...BACKFILL_STATIONS];

/**
 * Whether a station's numbers mean anything: past the grinding circuit they
 * only do once it has settled, since everything after it is fed by it.
 */
export function settled(st: Station, s: Summary): boolean {
  return s.converged || !BACKFILL_STATIONS.includes(st);
}

/** A station passes when every check has come back and passed, and ProcessPro raised no error on it. */
export function stationPasses(st: Station, c: Contract, d: Design, s: Summary): boolean | null {
  if (!settled(st, s)) return null;
  const checks = st.checks(c, d, s);
  if (s.diagnostics.some((x) => x.level === 'error' && x.nodeId && st.nodes.includes(x.nodeId))) return false;
  if (checks.some((k) => k.ok === false)) return false;
  if (checks.some((k) => k.ok === null)) return null;
  return true;
}
