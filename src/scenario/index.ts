/**
 * The scenario catalogue, and the one place a scenario is switched on.
 *
 * The sim keeps its design data in module-level objects (DESIGN, ORE, the
 * default setpoints), which every part of it reads at the moment it needs a
 * number. Applying a scenario restores those to the as-shipped values and
 * then writes the scenario's differences over the top - so applying one after
 * another, the way the harness does, never leaks a value from the last one.
 */

import { DESIGN, DEFAULT_SETPOINTS, SITE_TEXT } from '../sim/plant';
import { ORE, DEFAULT_UPSTREAM } from '../sim/upstream';
import type { Scenario, ScenarioId } from './types';
import { TODAY } from './today';
import { PSYCHE } from './psyche';
import { ABYSS } from './abyss';
import { UNDERCITY } from './undercity';
import { CARETAKER } from './caretaker';

export type { Scenario, ScenarioId, Beat, Frame, Look, Names } from './types';

/** In date order - the welcome screen reads left to right as a timeline. */
export const SCENARIOS: Scenario[] = [TODAY, ABYSS, PSYCHE, UNDERCITY, CARETAKER];

const BASE = {
  design: { ...DESIGN },
  ore: { ...ORE },
  start: { ...DEFAULT_SETPOINTS },
  up: { ...DEFAULT_UPSTREAM },
  text: { ...SITE_TEXT },
};

export function scenarioById(id: string | null | undefined): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

let current: Scenario = TODAY;

/** The scenario the page is running. Read-only outside this module. */
export function scenario(): Scenario {
  return current;
}

export function applyScenario(s: Scenario) {
  Object.assign(DESIGN, BASE.design, s.design);
  Object.assign(ORE, BASE.ore, s.ore ?? {});
  Object.assign(DEFAULT_SETPOINTS, BASE.start, s.start ?? {});
  // the silo starts on the first of this site's two binders
  Object.assign(DEFAULT_UPSTREAM, BASE.up, { binderType: DESIGN.binders[0].id }, s.upStart ?? {});
  Object.assign(SITE_TEXT, BASE.text, {
    done: s.names.done, spillTo: s.names.spillTo, delivery: s.names.delivery,
    ...(s.media ? { media: s.media[0], mediaThing: s.media[1] } : {}),
  });
  current = s;
}

export function isScenarioId(v: string): v is ScenarioId {
  return SCENARIOS.some((s) => s.id === v);
}
