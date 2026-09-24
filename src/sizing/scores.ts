import type { Costs } from './costs';

/**
 * Best plants per contract, kept in this browser. A score is the capital and
 * the running cost it was built for, ranked on ten years of owning it: the
 * capital plus ten years of operating cost, undiscounted.
 */

export interface Score {
  at: number;
  capex: number;
  opexPerT: number;
  opexPerYear: number;
  total: number;
}

/** v2: the whole plant down to the stope. Scores from before it priced the crushing and grinding circuit alone. */
const KEY = 'pasteworks.sizing.scores.v2';
export const YEARS = 10;

function load(): Record<string, Score[]> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Score[]>) : {};
  } catch {
    return {};
  }
}

export function scoreOf(costs: Costs): Score {
  return {
    at: Date.now(),
    capex: costs.capex,
    opexPerT: costs.opexPerT,
    opexPerYear: costs.opexPerYear,
    total: costs.capex + YEARS * costs.opexPerYear,
  };
}

/** Record a plant; returns the contract's table, best first, and whether this one tops it. */
export function record(seed: number, s: Score): { best: Score[]; isBest: boolean } {
  const all = load();
  const list = [...(all[seed] ?? []), s].sort((a, b) => a.total - b.total).slice(0, 10);
  all[seed] = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // private window or storage off: the score still shows, it just is not kept
  }
  return { best: list, isBest: list[0] === s };
}
