import type { Scenario } from './types';

/** The baseline: a real plant, a real stope, the physics as it stands today. */
export const TODAY: Scenario = {
  id: 'today',
  era: 'Today',
  title: 'Stope 14-2 North',
  place: 'Underground gold mine',
  blurb: 'The plant as it runs now. Thicken, filter, mix, and push it 1,200 m down the hole.',
  chips: ['250 m drop', '1,000 kPa', 'Balls run out'],
  objective: 'Fill the stope at 1,000 kPa. Do not plug the line.',
  budget: 21,
  story: [
    {
      from: [-150, 80, 150, -30, 0, 0], to: [-95, 58, 118, -20, 0, 0], ms: 7500,
      kicker: 'Today', title: 'Stope 14-2 North',
      text: 'Every tonne of ore that comes out of the ground leaves a hole behind it.',
    },
    {
      from: [44, 34, 78, 62, -30, 0], to: [24, -22, 58, 60, -44, 0], ms: 7500,
      text: 'This one is twenty metres wide, twenty high and fifteen deep. Six '
        + 'thousand cubic metres of nothing, with a pillar of ore standing beside '
        + 'it that the mine wants next.',
    },
    {
      from: [-72, 22, 44, -52, 4, 0], to: [4, 18, 40, 16, 6, 0], ms: 8500,
      text: 'Before anyone can blast that pillar, the hole has to be full - of the '
        + 'mine\'s own tailings, thickened, filtered, and bound with cement into '
        + 'something that will stand up on its own.',
    },
    {
      from: [-128, 26, 58, -110, 4, -4], to: [-82, 30, 72, -60, 4, 0], ms: 8000,
      text: 'The plant is yours for the shift. Twelve hundred metres of pipe, one '
        + 'pump, and a ball mill that will eat its grinding media whether or not '
        + 'you remember to order more.',
    },
  ],
  names: {
    dest: 'Stope 14-2 North',
    destShort: 'STOPE 14-2 N',
    destButton: 'Stope',
    line: 'Paste Line PL-01',
    lineShort: 'PASTE LINE',
    placed: 'placed',
    complete: 'STOPE FILLED',
    failNote: 'the pillar beside it will not stand',
    spillTo: 'the pad',
    delivery: 'by tanker',
    done: 'Stope full - placement complete',
    why: 'The stope has to stand up when the pillar beside it is mined. Average '
      + 'strength is what gets signed off, but the weakest lift is what actually fails.',
    lineWhy: 'Solved with the Buckingham equation for a Bingham plastic. The vertical '
      + 'drop gives back static head, which is the only reason a 1,200 m paste line '
      + 'is possible at all.',
  },
  design: {},
  look: {
    world: 'earth',
    destination: 'stope',
    sky: [0x060910, 0x14203a, 0x3a2f3c],
    fog: { color: 0x0b111b, near: 150, far: 520 },
    hemi: { sky: 0x5a7da8, ground: 0x0a0f16, intensity: 0.55 },
    key: { color: 0xfff0dc, intensity: 2.0 },
    fill: 0.45,
    rim: 0.35,
    pools: 1,
    exposure: 1.15,
    bloom: [0.62, 0.55, 0.72],
    env: 0.55,
    ground: { plain: 0x0f141c, pad: 0x252b34, grid: [0x2f6f74, 0x1d2732], kerb: 0x35e0d0, cut: true },
    accent: '#35e0d0',
  },
};
