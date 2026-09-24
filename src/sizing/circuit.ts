/**
 * The crushing and grinding circuit as a ProcessPro flowsheet, built from a
 * contract (what the ore is and what the plant must make) and a design (where
 * every slider sits). It is ProcessPro's "Crushing and grinding circuit"
 * example with the numbers pulled out into the design, so the sizing game and
 * ProcessPro solve exactly the same models: Whiten on the crushers, efficiency
 * curves on the screens, Austin's population balance in the mill and the Krebs
 * method on the cyclones.
 *
 * Everything here is SI, as the engine is: metres, kg/s, fractions.
 */

import {
  SCHEMA_VERSION,
  UNIT_SYSTEMS,
  sqrt2Series,
  type FlowsheetNode,
  type Project,
  type Stream,
} from '@jacob12244/proc-engine';
import { APERTURES, CONES, CYCLONES, JAWS, SCREENS, cavity } from './equipment';

/** t/h to kg/s. */
export const TPH = 1000 / 3600;

/** What the client wants, and the ore they want it from. */
export interface Contract {
  seed: number;
  /** dry run-of-mine ore, t/h */
  tph: number;
  /** the blast: Swebrec x50 and top size, metres, and its b */
  rom: { x50: number; xmax: number; b: number };
  /** solids density, kg/m3 */
  density: number;
  /** Bond ball mill work index, kWh/t */
  wi: number;
  /** Bond abrasion index: what the ore does to steel */
  ai: number;
  /**
   * How readily the ore breaks in the mill, against the copper ore Austin's
   * laboratory rates were measured on (1). Harder ores break slower.
   */
  breakage: number;
  /** grind target: the P80 of the cyclone overflow must be at or below this, metres */
  p80: number;
  /** flotation wants its feed in this band of solids by mass */
  overflowCw: [number, number];
}

/** Where every slider sits. Sizes in metres. */
export interface Design {
  grizzly: number;
  jawModel: number;
  jawCss: number;
  secModel: number;
  secCss: number;
  tertModel: number;
  tertCss: number;
  /** index into the aperture series */
  screenMesh: number;
  screenModel: number;
  screens: number;
  millD: number;
  millL: number;
  millJ: number;
  millCw: number;
  cycModel: number;
  cyclones: number;
  cycFeedCw: number;
  cycUfCw: number;
}

/** The circuit runs from rock the size of an armchair to a 100 µm grind, so it needs the whole √2 series. */
const SIZE_EDGES = sqrt2Series(1200, 0.019);

/**
 * Slurry held in a ball mill, as a share of the mill's inside volume per unit
 * of ball filling. ProcessPro's example mill (5.2 x 8.0 m at J = 0.33) holds
 * 29 m3, which is 0.17 of its volume: the voids in the ball bed (0.4 of it)
 * filled, and some slurry over the top of the charge.
 */
export const SLURRY_PER_BALL_FILLING = 29 / ((Math.PI / 4) * 5.2 ** 2 * 8.0 * 0.33);

export function millVolume(d: number, l: number): number {
  return (Math.PI / 4) * d * d * l;
}

export function millSlurryVolume(d: number, l: number, j: number): number {
  return millVolume(d, l) * j * SLURRY_PER_BALL_FILLING;
}

type Params = Record<string, unknown>;

function node(id: string, type: string, name: string, params: Params = {}): FlowsheetNode {
  const out: FlowsheetNode['params'] = {};
  for (const [k, v] of Object.entries(params)) out[k] = { value: v as never };
  return { id, type, name, params: out };
}

function stream(id: string, from: string, to: string, name = id): Stream {
  const [fromNode, fromPort] = from.split('.');
  const [toNode, toPort] = to.split('.');
  return { id, name, from: { nodeId: fromNode, port: fromPort }, to: { nodeId: toNode, port: toPort } };
}

/** The ball size a mill of this diameter would be charged with: bigger mills, bigger balls. */
export function ballSize(millD: number): number {
  return Math.min(0.09, Math.max(0.04, 0.0125 * millD));
}

/** The stream ids the game reads, named once. */
export const S = {
  rom: 'S01',
  grizzlyOver: 'S02',
  grizzlyUnder: 'S03',
  jawProduct: 'S04',
  coarseOre: 'S05',
  reclaim: 'S06',
  secProduct: 'S07',
  screenFeed: 'S08',
  screenOver: 'S09',
  tertProduct: 'S10',
  fineOre: 'S11',
  millFeedOre: 'S12',
  millFeed: 'S13',
  millDischarge: 'S14',
  cycFeed: 'S15',
  cycUnder: 'S16',
  cycOver: 'S17',
} as const;

export function screenAperture(d: Design): number {
  return APERTURES[Math.max(0, Math.min(APERTURES.length - 1, Math.round(d.screenMesh)))];
}

export function cycloneDiameter(d: Design): number {
  return CYCLONES[Math.max(0, Math.min(CYCLONES.length - 1, Math.round(d.cycModel)))];
}

const pick = <T,>(list: T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, Math.round(i)))];

export function buildProject(c: Contract, d: Design): Project {
  const ore = 'Ore';
  const jaw = pick(JAWS, d.jawModel);
  const sec = pick(CONES, d.secModel);
  const tert = pick(CONES, d.tertModel);
  const scr = pick(SCREENS, d.screenModel);
  const nodes: FlowsheetNode[] = [
    node('FEED', 'feed', 'ROM ore', { solidsMassFlow: c.tph * TPH, Cw: 0.97, materials: { [ore]: 1 } }),
    node('GRIZ', 'grizzly', 'Grizzly', { aperture: d.grizzly }),
    node('JAW', 'jawCrusher', 'Jaw crusher', { gap: d.jawCss, workIndex: c.wi * 3600, openingWidth: jaw.width, gape: jaw.gape }),
    node('M1', 'mixer', 'Primary crusher product'),
    node('SP', 'bin', 'Coarse ore stockpile'),
    node('SEC', 'coneCrusher', 'Secondary cone', {
      gap: d.secCss,
      workIndex: c.wi * 3600,
      headDiameter: sec.head,
      feedOpening: cavity(sec, 'coarse').feedOpening,
    }),
    node('M2', 'mixer', 'Tertiary screen feed'),
    node('SCR', 'screen', 'Tertiary screens', {
      aperture: screenAperture(d),
      deckWidth: scr.width,
      deckLength: scr.length,
      units: Math.round(d.screens),
    }),
    node('TERT', 'coneCrusher', 'Tertiary cone', {
      gap: d.tertCss,
      workIndex: c.wi * 3600,
      headDiameter: tert.head,
      feedOpening: cavity(tert, 'fine').feedOpening,
    }),
    node('FOB', 'bin', 'Fine ore bin'),
    node('MW', 'waterAddition', 'Mill feed water', { mode: 'targetCw', value: d.millCw }),
    node('BM', 'ballMill', 'Ball mill', {
      millDiameter: d.millD,
      millBallSize: ballSize(d.millD),
      millBallFilling: d.millJ,
      millLength: d.millL,
      residenceFrom: 'volume',
      slurryVolume: millSlurryVolume(d.millD, d.millL, d.millJ),
      rateScale: c.breakage,
      workIndex: c.wi * 3600,
    }),
    node('SUMP', 'waterAddition', 'Cyclone feed sump', { mode: 'targetCw', value: d.cycFeedCw }),
    node('CYC', 'cyclone', 'Cyclone cluster', {
      model: 'krebs',
      diameter: cycloneDiameter(d),
      operation: 'cyclones',
      cyclones: d.cyclones,
      underflowSolids: d.cycUfCw,
    }),
    node('PROD', 'product', 'Flotation feed'),
  ];

  const streams: Stream[] = [
    stream(S.rom, 'FEED.product', 'GRIZ.feed', 'ROM'),
    stream(S.grizzlyOver, 'GRIZ.oversize', 'JAW.feed', 'Grizzly oversize'),
    stream(S.grizzlyUnder, 'GRIZ.undersize', 'M1.feed[0]', 'Grizzly undersize'),
    stream(S.jawProduct, 'JAW.product', 'M1.feed[1]', 'Jaw product'),
    stream(S.coarseOre, 'M1.product', 'SP.feed', 'Coarse ore'),
    stream(S.reclaim, 'SP.product', 'SEC.feed', 'Stockpile reclaim'),
    stream(S.secProduct, 'SEC.product', 'M2.feed[0]', 'Secondary product'),
    stream(S.screenFeed, 'M2.product', 'SCR.feed', 'Screen feed'),
    stream(S.screenOver, 'SCR.oversize', 'TERT.feed', 'Screen oversize'),
    stream(S.tertProduct, 'TERT.product', 'M2.feed[1]', 'Tertiary product'),
    stream(S.fineOre, 'SCR.undersize', 'FOB.feed', 'Fine ore'),
    stream(S.millFeedOre, 'FOB.product', 'MW.feed[0]', 'Mill feed'),
    stream(S.millFeed, 'MW.product', 'BM.feed'),
    stream(S.millDischarge, 'BM.product', 'SUMP.feed', 'Mill discharge'),
    stream(S.cycFeed, 'SUMP.product', 'CYC.feed', 'Cyclone feed'),
    stream(S.cycUnder, 'CYC.underflow', 'MW.feed[1]', 'Cyclone underflow'),
    stream(S.cycOver, 'CYC.overflow', 'PROD.feed', 'Cyclone overflow'),
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'sizing',
    name: 'Crushing and grinding',
    units: UNIT_SYSTEMS['metric-tph'],
    components: [
      { id: ore, name: 'Ore', phase: 'solid', density: c.density, hasPsd: true, psd: { model: 'swebrec', ...c.rom } },
      { id: 'Water', name: 'Water', phase: 'liquid', density: 1000 },
    ],
    sizeClasses: { edges: SIZE_EDGES, label: '√2 series' },
    flowsheet: { nodes, streams },
  };
}
