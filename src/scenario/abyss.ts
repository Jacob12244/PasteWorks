import type { Scenario } from './types';

/**
 * The Clarion-Clipperton Zone: a plain of polymetallic nodules at 4-5 km in
 * the central Pacific. Water at the bottom sits around 2 degC, and cement
 * hydration at 2 degC runs well behind the 20 degC lab figure - the maturity
 * method puts 28 days in the cold at roughly two thirds of the lab strength.
 *
 * The line runs 2.8 km across a flat bottom, so there is no static head to
 * help. A 200 mm bore keeps the friction gradient low enough to get there.
 * Seawater is free and unlimited; what costs money is plume, because every
 * cubic metre that leaves the plant carrying fines is a cubic metre the
 * regulator counts.
 */
export const ABYSS: Scenario = {
  id: 'abyss',
  era: '2068',
  title: 'Station Nereid',
  place: 'Clarion–Clipperton Zone · 4,400 m',
  blurb: 'Vacuum the nodules off the seabed, process on the bottom, and pump the rest 3 km back into the furrows.',
  chips: ['Seabed collector', 'No thickener', '2 °C cure', 'Plume $250/t'],
  objective: 'Fill Furrow 7 at 600 kPa. Nothing leaves the plant but paste.',
  budget: 23,
  story: [
    {
      from: [-40, 44, 120, -30, 0, 0], to: [-34, 26, 92, -30, 2, 0], ms: 8000,
      kicker: '2068', title: '4,400 metres down',
      text: 'The nodules had been lying on the abyssal plain for ten million years - '
        + 'fist-sized lumps of manganese, nickel and cobalt, growing a few '
        + 'millimetres every million.',
    },
    {
      from: [60, 14, 60, 110, 2, 0], to: [90, 10, 44, 150, 0, 0], ms: 8000,
      text: 'The first collectors scraped them up and left a sediment plume that '
        + 'drifted four hundred kilometres. The regulator shut the lot down inside '
        + 'a year.',
    },
    {
      from: [-66, 20, 40, -52, 4, 0], to: [-6, 16, 38, 12, 6, 0], ms: 8000,
      text: 'The second generation had to promise something the first never did: '
        + 'to put the seabed back.',
    },
    {
      from: [-96, 10, 44, -130, 4, 0], to: [-84, 32, 62, -106, 26, -12], ms: 9000,
      text: 'So the plant came down to the floor with the collectors. They vacuum up '
        + 'nodules and sediment together; the nodules go up the riser to the ship, and '
        + 'the sediment never leaves the bottom. Cyclones take the water out, a press '
        + 'takes the rest, and the paste goes three kilometres across the plain to fill '
        + 'the furrows the collectors cut.',
    },
    {
      from: [-26, 8, 74, -14, 4, 50], to: [-20, 6, 66, -14, 4, 50], ms: 8000,
      text: 'At two degrees the cement sets at a crawl. The line is long and dead '
        + 'level, so gravity gives you nothing. And every gram of fines the cyclones '
        + 'let go is plume.',
    },
  ],
  names: {
    dest: 'Furrow 7',
    destShort: 'FURROW 7',
    destButton: 'Furrow',
    line: 'Seafloor Line SL-3',
    lineShort: 'SEAFLOOR LINE',
    placed: 'placed',
    complete: 'FURROW RESTORED',
    failNote: 'the bottom currents will scour it back out',
    spillTo: 'the sea',
    delivery: 'by pod from the ship',
    done: 'Furrow 7 full - seabed restored',
    why: 'The fill has to resist the bottom currents and carry the fauna that come '
      + 'back to it - 600 kPa is modest, but it has to be reached at 2 degC, where '
      + 'the cement only gets about two thirds of the way to its lab strength.',
    lineWhy: 'Nearly three kilometres, dead level, 200 mm bore. With no drop there is no '
      + 'static head to give back, so every kilopascal of friction is the pump\'s '
      + 'problem. Stiffer paste is stronger; stiffer paste also stops.',
  },
  // A plant that plugs the moment you press start teaches nothing, so it
  // opens on a wet, rich paste that runs - and costs too much.
  start: { targetSlump: 155, binderDose: 6.0, strokeRate: 60, ufCw: 0.56 },
  upStart: { millFeed: 560 },
  /**
   * Collector, nodule screen, dewatering cyclones - no thickener. Sediment is
   * naturally fine (P80 ~70 um), arrives at ten percent solids, and has no
   * sulphides worth the name. The collector and the lift are the power bill.
   * All the water goes back to the sea it came out of.
   */
  ore: {
    source: 'collector', separation: 'nodules', deslimeCircuit: 1,
    nativeP80: 70, nativeSulphide: 0, nativeCw: 0.10, noduleFrac: 0.45,
    sgGangue: 2.62, millPowerKw: 2600, costGrinding: 0.14,
  },
  design: {
    dewater: 'cyclones',
    costPlume: 250,
    millReturnCap: 1e6,
    pipeLength: 2800,
    pipeDrop: 0,
    pipeId: 200,
    cureFactor: 0.66,
    targetUcs: 600,
    costWater: 0,
    costSpill: 2000,
    costPowerKwh: 0.14,
  },
  look: {
    world: 'ocean',
    destination: 'trench',
    bubble: true,
    sky: [0x01060c, 0x062a38, 0x06303f],
    fog: { color: 0x06303f, density: 0.0088 },
    hemi: { sky: 0x2a6a8a, ground: 0x02060a, intensity: 0.5 },
    key: { color: 0x7ab8d0, intensity: 0.45 },
    fill: 0.25,
    rim: 0,
    pools: 1.5,
    exposure: 1.3,
    bloom: [0.95, 0.6, 0.6],
    env: 0.35,
    ground: { plain: 0x1d2420, pad: 0x28302d, grid: [0x2f6f74, 0x1a2626], kerb: 0x35e0d0, cut: false },
    accent: '#3fc8f5',
  },
};
