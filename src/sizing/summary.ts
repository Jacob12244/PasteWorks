/**
 * One solve of the circuit, boiled down to what the game shows: every
 * stream's tonnage, density and size, every node's reported results, and
 * ProcessPro's own warnings. Plain data, so it crosses from the worker.
 */

import { ComponentTable, props, solve, standardRegistry, sizeGrid, cumulativePassing } from '@jacob12244/proc-engine';
import { buildProject, cycloneDiameter, TPH, type Contract, type Design } from './circuit';

export interface StreamSummary {
  /** dry solids, t/h */
  tph: number;
  /** solids by mass, fraction */
  cw: number;
  /** m3/h of slurry */
  m3h: number;
  /** sizes passing 50, 80 and 95%, metres */
  p50: number;
  p80: number;
  p95: number;
  /** the top size, as the size 99% passes, metres */
  top: number;
  /** cumulative fraction passing each sieve, largest first */
  passing: number[];
}

export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  nodeId?: string;
  message: string;
}

export interface Summary {
  ms: number;
  converged: boolean;
  /** sieve sizes, metres, largest first */
  sieves: number[];
  streams: Record<string, StreamSummary>;
  /** node id -> result key -> value (SI) */
  results: Record<string, Record<string, number>>;
  diagnostics: Diagnostic[];
}

const registry = standardRegistry();

export function summarise(contract: Contract, design: Design): Summary {
  const project = buildProject(contract, design);
  const t0 = performance.now();
  const out = solve(project, { registry });
  const ms = performance.now() - t0;

  const table = new ComponentTable(project.components, project.sizeClasses);
  const grid = sizeGrid(project.sizeClasses!)!;
  const streams: Record<string, StreamSummary> = {};
  for (const [id, state] of out.states) {
    const p = props(state, table);
    const psd = state.psd?.Ore;
    streams[id] = {
      tph: p.Ms / TPH,
      cw: p.Mt > 0 ? p.Cw : 0,
      m3h: p.Vt * 3600,
      p50: p.sizeAt(0.5),
      p80: p.sizeAt(0.8),
      p95: p.sizeAt(0.95),
      top: p.sizeAt(0.99),
      passing: psd ? cumulativePassing(grid, psd) : [],
    };
  }
  const results: Summary['results'] = {};
  for (const b of out.balances) {
    const r: Record<string, number> = {};
    for (const x of b.results) r[x.key] = x.value;
    results[b.nodeId] = r;
  }
  return {
    ms,
    converged: out.report.converged,
    sieves: grid.edges.slice(),
    streams,
    results,
    diagnostics: out.diagnostics.map((d) => ({ level: d.level as Diagnostic['level'], nodeId: d.nodeId, message: d.message })),
  };
}

export { cycloneDiameter };
