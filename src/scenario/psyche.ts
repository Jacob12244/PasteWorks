import type { Scenario } from './types';

/**
 * 16 Psyche. Surface gravity is about 0.144 m/s2 (1.5% of Earth's) and
 * escape velocity about 166 m/s. A 150 m rail taking a slug to 300 m/s
 * accelerates it at v^2/2L = 300 m/s2, about thirty g - and a 0.5 m slug at
 * 2 t/m3 then sees rho.a.h = 300 kPa across its own length. Two and a half
 * times that is the 750 kPa it has to be cured to.
 *
 * With no drop to speak of and a short line, pressure is not the problem
 * here. Money is: binder has to be fired in a kiln, water came from an ice
 * moon, and anything spilled boils off into vacuum.
 */
export const PSYCHE: Scenario = {
  id: 'psyche',
  era: '2091',
  title: 'Mass Driver One',
  place: '16 Psyche · main asteroid belt',
  blurb: 'No stope, no dam, no air. Bind the waste into slugs and throw it off the asteroid.',
  chips: ['0.015 g', 'Centrifuge, not thickener', 'Water $400/m³', 'Binder $1,650/t'],
  objective: 'Launch 6,000 m³. Slugs at 750 kPa or they shatter on the rail. Do not waste the water.',
  budget: 300,
  story: [
    {
      from: [260, 150, 330, -20, 0, 0], to: [190, 105, 250, -10, 0, 0], ms: 8000,
      kicker: '2091', title: '16 Psyche',
      text: 'By the 2070s nobody on Earth would sign off a new mine. So the '
        + 'industry went where the metal was.',
    },
    {
      from: [-40, 150, 180, -40, 0, 0], to: [-120, 90, 150, -60, 0, 0], ms: 8000,
      text: 'Psyche is the bare iron-nickel core of a world that never finished '
        + 'forming - two hundred kilometres of metal, stripped of its rock by four '
        + 'billion years of collisions.',
    },
    {
      from: [-196, 44, 64, -228, -10, -4], to: [-150, 26, 44, -118, 4, -8], ms: 9500,
      text: 'Mining it was the easy part: open pits in the metal, a mill, and a magnet - '
        + 'there is nothing to float when the ore is iron. The waste was the hard part. '
        + 'A thickener needs gravity, and there is almost none here, so the tailings '
        + 'are spun dry in a centrifuge instead. And there is no tailings dam in a '
        + 'vacuum, no stope to put it back into.',
    },
    {
      from: [38, 8, 34, 90, 14, 0], to: [70, 22, 44, 160, 40, 0], ms: 9000,
      text: 'So the tailings are bound into slugs, cured hard enough to survive thirty '
        + 'g on the rail, and thrown off at three hundred metres a second - nearly '
        + 'twice escape velocity - to a catcher on Kiln Station, which wants the '
        + 'mass for radiation shielding.',
    },
    {
      from: [-30, 14, 70, -2, 5, 17], to: [-24, 10, 64, -2, 5, 17], ms: 8000,
      text: 'Everything here was shipped or mined at ruinous cost. The binder comes '
        + 'out of a kiln that eats power. The water came from an ice moon. Spill a '
        + 'litre and it boils away into the dark.',
    },
  ],
  names: {
    dest: 'Mass Driver MD-1',
    destShort: 'MASS DRIVER',
    destButton: 'Launcher',
    line: 'Launch Feed LF-1',
    lineShort: 'LAUNCH FEED',
    placed: 'launched',
    complete: 'QUOTA LAUNCHED',
    failNote: 'the slugs are shattering on the rail',
    spillTo: 'vacuum',
    delivery: 'by lander',
    done: 'Launch quota complete - 6,000 m3 away',
    why: 'A 150 m rail takes a slug to 300 m/s at about thirty g. Under that, half a '
      + 'metre of slug carries around 300 kPa across its own length - so 750 kPa is '
      + 'a factor of two and a half, not a guess. Anything weaker leaves the rail '
      + 'as gravel, and gravel in your own orbit is how you lose a station.',
    lineWhy: 'Short and dead level, so there is no static head to help and very '
      + 'little friction to fight. Pressure is not the constraint out here - the '
      + 'price of binder and water is.',
  },
  start: { ufCw: 0.60 },
  design: {
    dewater: 'centrifuge',
    dewaterPowerKw: 650,
    // a closed water circuit: everything recovered goes back to the mill
    millReturnCap: 1e6,
    gravity: 0.144,
    pipeLength: 180,
    pipeDrop: 0,
    targetUcs: 750,
    costBinder: 1650,
    costWater: 400,
    costWaterLost: 400,
    costSpill: 9000,
    costPowerKwh: 0.06,
  },
  /**
   * Open pit, ball mill, magnetic drum, decanter centrifuge. The ore is 38%
   * metal, and whatever the drum misses rides along in the tailings and makes
   * them heavier. Balls come from Earth, which is why they cost what they cost.
   */
  ore: {
    source: 'mill', separation: 'magnetic', deslimeCircuit: 0,
    metalFrac: 0.38, sgGangue: 3.1,
    costMedia: 6800,
    costGrinding: 0.06,
  },
  look: {
    world: 'space',
    destination: 'launcher',
    sky: [0x000000, 0x020308, 0x040509],
    fog: { color: 0x000000, near: 260, far: 1150 },
    hemi: { sky: 0x28303c, ground: 0x000000, intensity: 0.18 },
    key: { color: 0xfff4e4, intensity: 3.1 },
    fill: 0.06,
    rim: 0.3,
    pools: 1.15,
    exposure: 1.05,
    bloom: [0.72, 0.5, 0.7],
    env: 0.5,
    ground: { plain: 0x2a292b, pad: 0x3a3c42, grid: [0x7a6a4a, 0x2c2f36], kerb: 0xffab3d, cut: false },
    accent: '#ffab3d',
  },
};
