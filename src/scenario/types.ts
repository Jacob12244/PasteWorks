/**
 * A scenario: somewhere a paste plant might have to run, and why.
 *
 * Everything here is data. The sim reads the physics, the view reads the
 * look, the UI reads the words - and none of it imports three.js, so the
 * harnesses in tools/ can load a scenario and prove it can be won.
 */

import type { DESIGN, Setpoints } from '../sim/plant';
import type { ORE, UpstreamSetpoints } from '../sim/upstream';

export type ScenarioId = 'today' | 'psyche' | 'abyss' | 'undercity' | 'caretaker';

/** Camera framing: eye position then look-at point. */
export type Frame = [number, number, number, number, number, number];

/** One beat of the opening: a camera move and what is on screen during it. */
export interface Beat {
  from: Frame;
  to: Frame;
  ms: number;
  /** small line above the title - usually the year */
  kicker?: string;
  title?: string;
  text?: string;
}

/** The words the interface uses for this site. */
export interface Names {
  /** "Stope 14-2 North" */
  dest: string;
  /** "STOPE 14-2 N" - mimic tiles, tags, trends */
  destShort: string;
  /** view button */
  destButton: string;
  /** "Paste line PL-01" */
  line: string;
  lineShort: string;
  /** "placed" / "launched" / "stacked" */
  placed: string;
  /** completion banner */
  complete: string;
  /** what failing the strength target means here */
  failNote: string;
  /** where spills end up */
  spillTo: string;
  /** how a delivery arrives: "by tanker", "through the pad" */
  delivery: string;
  /** the alarm when the job is done */
  done: string;
  /** the inspector note on the destination */
  why: string;
  /** the inspector note on the line */
  lineWhy: string;
}

export type WorldKind = 'earth' | 'space' | 'ocean' | 'city' | 'waste';
export type DestinationKind = 'stope' | 'launcher' | 'trench' | 'craters';

/** Everything the renderer needs to put the plant somewhere else. */
export interface Look {
  world: WorldKind;
  destination: DestinationKind;
  /** a glass pressure sphere round the control room */
  bubble?: boolean;
  /** sky dome: top, horizon, below */
  sky: [number, number, number];
  /** linear fog near/far, or exponential density */
  fog: { color: number; near?: number; far?: number; density?: number };
  hemi: { sky: number; ground: number; intensity: number };
  key: { color: number; intensity: number };
  fill: number;
  rim: number;
  /** multiplier on the working-area pool lights */
  pools: number;
  exposure: number;
  /** strength, radius, threshold */
  bloom: [number, number, number];
  env: number;
  ground: {
    plain: number;
    pad: number;
    grid: [number, number];
    kerb: number;
    /** punch the long-section cutaway through the ground */
    cut: boolean;
  };
  /** the accent the interface picks up */
  accent: string;
}

export interface Scenario {
  id: ScenarioId;
  /** "Today" / "2091" */
  era: string;
  title: string;
  place: string;
  /** one line for the card */
  blurb: string;
  /** the rules that make this site different, as card tags */
  chips: string[];
  objective: string;
  /** $/m3 at which the cost readout turns amber */
  budget: number;
  story: Beat[];
  names: Names;
  design: Partial<typeof DESIGN>;
  ore?: Partial<typeof ORE>;
  /** where the setpoints start - a plant that runs, not one that is tuned */
  start?: Partial<Setpoints>;
  /** and the front end's */
  upStart?: Partial<UpstreamSetpoints>;
  /** what the consumable is called here: [store, thing] */
  media?: [string, string];
  look: Look;
}
