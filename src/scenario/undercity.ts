import type { Scenario } from './types';
import { MERIDIAN_BINDERS } from '../sim/binders';

/**
 * A city standing on an old mine. The workings are 620 m below the street,
 * which is enough static head to carry the whole line on its own: 2 t/m3 of
 * paste over 620 m gives back about 12 MPa, more than the pump's rating. The
 * column wants to free-fall, and the choke at the collar is what stops it.
 *
 * The fill has to carry a tower's foundation load, so the strength target is
 * half again the mining one - and power is bought off a grid that knows
 * exactly how badly you need it.
 *
 * And there is no floor space. An 18 m thickener does not fit in a canyon a
 * block wide, so the tailings settle in a magnetic stack four storeys tall -
 * magnetite-seeded floc pulled down by coils - and the cake is finished on a
 * belt press with electrodes in it. Both of them run on electricity, at the
 * city's price.
 */
export const UNDERCITY: Scenario = {
  id: 'undercity',
  era: '2137',
  title: 'Meridian Undercity',
  place: 'The canyon under Tower 9',
  blurb: 'A megacity built on an old mine. Dredge the old tailings dam and put it back under Tower 9.',
  chips: ['Tailings dam dredge', 'Magnetic stack', 'Power $0.46/kWh', '1,500 kPa'],
  objective: 'Fill Void V-9 under Tower 9 at 1,500 kPa before it moves again.',
  budget: 31,
  story: [
    {
      from: [-190, 140, 160, 0, 30, 0], to: [-120, 96, 140, 0, 20, 0], ms: 8000,
      kicker: '2137', title: 'Meridian',
      text: 'Meridian was built on top of a gold mine. Everyone knew. The mine closed '
        + 'in 2040 and the city needed the land.',
    },
    {
      from: [44, 40, 82, 62, -24, 0], to: [36, -10, 64, 60, -40, 0], ms: 9000,
      text: 'Ninety years on, the old stopes began to breathe. Water found its way in '
        + 'and the crown pillars softened. One night Tower 9 dropped eleven '
        + 'centimetres, and by morning the company that owns it had lost a quarter '
        + 'of its value.',
    },
    {
      from: [60, 80, 90, 64, 40, 0], to: [70, 130, 70, 64, 60, 0], ms: 7000,
      text: 'Nobody could dig down to fix it. There were two hundred thousand people '
        + 'standing on the lid.',
    },
    {
      from: [-96, 34, 56, -128, 6, -6], to: [-30, 26, 56, -24, 4, 0], ms: 10000,
      text: 'So they put a paste plant in the canyon between the towers, and fed it '
        + 'the one thing the old mine left behind: its own tailings dam, a green lake at '
        + 'the edge of the city that had been leaching into the groundwater for a '
        + 'century. The dredge takes the tailings back out; the plant puts them back '
        + 'where they came from, six hundred and twenty metres straight down.',
    },
    {
      from: [-80, 22, 40, -52, 12, 0], to: [-68, 30, 30, -52, 16, 0], ms: 8000,
      text: 'There was no room in the canyon for a thickener. So the tailings settle in '
        + 'a column of magnets four storeys tall, and electrodes drag the last of the '
        + 'water out of the cake. Both run on the city\'s power, at the city\'s price.',
    },
    {
      from: [-30, 12, 72, -14, 5, 50], to: [-22, 8, 64, -14, 5, 50], ms: 8000,
      text: 'The old tailings are pyritic, and have been oxidising for a hundred years - '
        + 'they will dissolve anything made of calcite. The paste has to carry a '
        + 'skyscraper. And a column that tall falls so hard it will run away from you '
        + 'if you let it.',
    },
  ],
  names: {
    dest: 'Void V-9 · Tower 9',
    destShort: 'VOID V-9',
    destButton: 'Void',
    line: 'Borehole BH-9',
    lineShort: 'BOREHOLE',
    placed: 'placed',
    complete: 'TOWER 9 SECURED',
    failNote: 'Tower 9 is still moving',
    spillTo: 'the street',
    delivery: 'by drone',
    done: 'Void V-9 full - Tower 9 secured',
    why: 'Tower 9\'s piles bear on this fill. It needs half again the strength a '
      + 'mining stope would, and it needs it everywhere - one soft lift under a '
      + 'pile cap is where the next eleven centimetres comes from.',
    lineWhy: '620 m of drop returns roughly 12 MPa of static head - more than the '
      + 'pump\'s whole rating. The column wants to free-fall, and the choke at the '
      + 'collar is the only thing holding it. Stiff paste is not the risk here; '
      + 'runaway is.',
  },
  start: { field: 0.5, voltage: 25, belt: 70, binderDose: 4.5 },
  design: {
    dewater: 'magstack',
    filter: 'eopress',
    thickenerBedMax: 400,
    binders: MERIDIAN_BINDERS,
    // the floc carries the magnetite seed, and not all of it comes back
    costFloc: 5200,
    pipeLength: 1500,
    pipeDrop: 620,
    targetUcs: 1500,
    costPowerKwh: 0.46,
    costSpill: 2500,
  },
  /**
   * A dredge on the old dam, deslime cyclones, magnetic stack, e-press. No
   * mill - these were ground a century ago. They are pyritic and have been
   * oxidising in the rain ever since, which is what the carbon magnesia is for.
   */
  ore: {
    source: 'reclaim', separation: 'none', deslimeCircuit: 1,
    nativeP80: 105, nativeSulphide: 1.3, nativeCw: 0.30, sgGangue: 2.72,
    millPowerKw: 900, costGrinding: 0.46,
  },
  look: {
    world: 'city',
    destination: 'stope',
    sky: [0x040109, 0x1c0828, 0x3a0f34],
    fog: { color: 0x1c0b26, near: 90, far: 460 },
    hemi: { sky: 0x6a3a9a, ground: 0x05030a, intensity: 0.5 },
    key: { color: 0xa898ff, intensity: 0.75 },
    fill: 0.7,
    rim: 0.9,
    pools: 1.2,
    exposure: 1.18,
    bloom: [1.0, 0.62, 0.6],
    env: 0.42,
    ground: { plain: 0x09080f, pad: 0x15141c, grid: [0x8a2a8a, 0x1a1026], kerb: 0xff4fd8, cut: true },
    accent: '#ff4fd8',
  },
};
