import type { Scenario } from './types';
import { portland } from '../sim/binders';

/**
 * Long after everyone left. There is no mine, so the plant fills the craters
 * the last war left, with the waste the last people left.
 *
 * The economics are upside down. Binder is cheap - there is a whole city of
 * concrete to grind back into it. Water is the thing there is none of, and
 * with a dry feed and no press, every litre in the mix was hauled in.
 *
 * And the kit has gone back seven centuries. Everything clever needed a
 * supply chain, and the supply chain left on the ships; what is still
 * running is what a robot can mend with a spanner. So the crusher is run the
 * way one was in 1950 - a rotor speed and a grate - and a magnet over the belt
 * pulls what steel the crusher has broken free.
 */
export const CARETAKER: Scenario = {
  id: 'caretaker',
  era: '2805',
  title: 'Last Shift',
  place: 'Earth · long after',
  blurb: 'Everyone left. One robot, one plant, a planet of waste piles - and the craters the last war left.',
  chips: ['Dry feed', 'Rotor and grate', 'Water hauled $90/m³', 'Tramp steel'],
  objective: 'Fill Crater 4: 6,000 m³ at 1,200 kPa. Every litre of water is hauled in.',
  budget: 32,
  story: [
    {
      from: [-220, 60, 200, -20, 20, 0], to: [-150, 44, 160, -20, 16, 0], ms: 8000,
      kicker: '2805', title: 'Last Shift',
      text: 'They left in 2105, on the ships. It was only ever supposed to be for '
        + 'five years.',
    },
    {
      from: [40, 60, 110, 80, 0, 0], to: [96, 40, 84, 80, 0, 0], ms: 8000,
      text: 'Before they went there was a war - the last one. It was short, and it was '
        + 'mostly fought with holes.',
    },
    {
      from: [-60, 20, 60, -40, 6, 0], to: [-6, 18, 50, 10, 6, 0], ms: 9000,
      text: 'Somebody had to stay behind and tidy up. The backfill plant was still '
        + 'running the day they left, so it was given one job: take the waste they left '
        + 'behind, and put it back in the ground.',
    },
    {
      from: [-150, 30, 40, -110, 6, 0], to: [-120, 22, 30, -100, 4, -6], ms: 9000,
      text: 'There is no mine and no stope. There are the piles - two centuries of '
        + 'rubbish, some of it stacked in cubes by the last robot that had this job - '
        + 'and there are the holes. The loaders scoop the piles, the crusher breaks them '
        + 'down, and the plant mixes them with whatever cement can still be ground out '
        + 'of the old city.',
    },
    {
      from: [-58, 16, 26, -44, 4, 2], to: [-52, 12, 20, -44, 4, 2], ms: 8000,
      text: 'Everything clever broke a long time ago. What still runs is what a robot '
        + 'can mend with a spanner: a hammer crusher with a rotor and a grate, a magnet '
        + 'on a gantry, a belt. Crush it fine enough to shake the old steel loose, or '
        + 'the steel goes into the ground with the rest and rusts it apart.',
    },
    {
      from: [30, 9, 46, 6, 3, 22], to: [22, 7, 40, 4, 3, 20], ms: 7000,
      text: 'There is no thickener and no press. There is nothing to take water out of. '
        + 'It has not rained properly in two hundred years, and every litre in the mix '
        + 'is hauled in by tanker.',
    },
    {
      from: [84, 4.5, 34, 90, 0.3, 23.2], to: [88.3, 1.6, 26.6, 90, 0.4, 23.2], ms: 6000,
      kicker: 'This morning',
      text: 'Something green, growing on the rim of Crater 4.',
    },
  ],
  names: {
    dest: 'Crater 4',
    destShort: 'CRATER 4',
    destButton: 'Crater',
    line: 'Fill Line FL-4',
    lineShort: 'FILL LINE',
    placed: 'placed',
    complete: 'CRATER 4 LEVEL',
    failNote: 'it will not carry whatever gets built on it next',
    spillTo: 'the dust',
    delivery: 'through the pad',
    done: 'Crater 4 full - the ground is level again',
    why: 'Nobody knows what will be built on this ground next, or when, or by whom. '
      + 'The manual\'s figure for "unknown" is 1,200 kPa, and the manual has been right '
      + 'about everything else.',
    lineWhy: 'A short line from the mixer, down over the rim into the crater. The '
      + 'pumping is easy. The water is not: with no thickener and no press there is '
      + 'nothing to hand any back, so every litre in the paste came off a tanker.',
  },
  media: ['Hammer store', 'crusher hammers'],
  upStart: { deslime: false },
  /**
   * Loaders scooping waste piles into a hammer crusher, a scrap magnet, and
   * straight to the mixer. No cyclones, no thickener, no press: the feed is
   * dry, so there is no water to take out - and none to give back.
   */
  ore: {
    source: 'scoop', separation: 'scrap', deslimeCircuit: 0,
    bondWi: 9, f80: 120000, millPowerKw: 2200,
    mediaKgPerT: 0.3, hopperCap: 6, costMedia: 2400,
    nativeSulphide: 0.2, sgGangue: 2.55, nativeCw: 0.92,
    costGrinding: 0.02,
  },
  design: {
    dewater: 'dry',
    filter: 'none',
    dryMoisture: 8,
    pipeLength: 380,
    pipeDrop: 6,
    targetUcs: 1200,
    costWater: 90,
    costWaterLost: 0,
    binders: portland(62),
    costPowerKwh: 0.02,
    costSpill: 400,
  },
  look: {
    world: 'waste',
    destination: 'craters',
    sky: [0x3c2a18, 0x9a6230, 0xb57a3c],
    fog: { color: 0x9a6a3c, density: 0.0062 },
    hemi: { sky: 0xe0a868, ground: 0x3a2410, intensity: 0.95 },
    key: { color: 0xffd4a0, intensity: 1.7 },
    fill: 0.3,
    rim: 0.45,
    pools: 0.55,
    exposure: 1.0,
    bloom: [0.4, 0.5, 0.82],
    env: 0.6,
    ground: { plain: 0x4e4030, pad: 0x4a4036, grid: [0x7a6040, 0x5a4a38], kerb: 0xffab3d, cut: false },
    accent: '#e8b13a',
  },
};
