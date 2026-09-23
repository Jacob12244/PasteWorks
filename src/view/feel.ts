import type { WorldKind } from '../scenario/types';

// How it feels to be on foot in each world. Kept apart from the walker so the
// arena server can read the same numbers without pulling in anything that
// listens to a keyboard.

/** How walking feels in each world. */
export interface Feel {
  /** m/s², once your feet leave the floor */
  gravity: number;
  walk: number;
  run: number;
  /** take-off speed, m/s */
  jump: number;
  /** how quickly you reach the speed you are asking for, on the floor and off it */
  grip: number;
  airGrip: number;
  /** said once, when you step out */
  note: string;
}

export const FEEL: Record<WorldKind, Feel> = {
  earth: {
    gravity: 20, walk: 4.2, run: 8, jump: 6.2, grip: 12, airGrip: 1.5,
    note: 'Hi-vis on. Stay behind the handrails.',
  },
  city: {
    gravity: 20, walk: 4.2, run: 8, jump: 6.2, grip: 10, airGrip: 1.5,
    note: 'Mind the puddles. And the drones.',
  },
  waste: {
    gravity: 20, walk: 4.0, run: 7.5, jump: 6.2, grip: 11, airGrip: 1.5,
    note: 'Nobody has walked here in a very long time.',
  },
  // a hardsuit at 440 bar: slow, heavy, and every jump a long float down
  ocean: {
    gravity: 4.5, walk: 2.4, run: 3.6, jump: 3.4, grip: 4, airGrip: 0.8,
    note: 'Hardsuit on. 440 bar outside it - take it slowly.',
  },
  // Mag boots hold you to the iron while you walk. Jump and they let go, and
  // Psyche barely pulls you back - 0.144 m/s² is not much of an argument.
  space: {
    gravity: 1.2, walk: 3.4, run: 5.5, jump: 3.4, grip: 9, airGrip: 0.3,
    note: 'Mag boots on. Jump, and find out how little Psyche pulls.',
  },
};
