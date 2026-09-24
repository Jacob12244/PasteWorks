import * as THREE from 'three';
import { Stage } from '../view/scene';
import { tickFlows } from '../view/flow';
import { Site } from './site';
import { SizingUI, type StationState } from './ui';
import { STATIONS, fmt, stationPasses } from './stations';
import { contractFor, randomSeed, starterDesign } from './contract';
import { costsFor } from './costs';
import { record, scoreOf } from './scores';
import { CONES, JAWS, PASTE_PUMPS, PIPES, PRESS_PLATES, RAKE_DRIVES, SCREENS, cavity } from './equipment';
import { cycloneDiameter, screenAperture, underflowCw, S, type Contract, type Design } from './circuit';
import { pumpDuty } from './backfill';
import type { Summary } from './summary';

/**
 * Equipment sizing: a contract, nine stations from the tip to the stope, and the sliders. Every slider
 * move rebuilds the machine it belongs to at once and sends the whole circuit
 * to ProcessPro's engine in a worker; the checks, curves and costs come back
 * from that solve.
 */

const pick = <T,>(list: T[], i: number): T => list[Math.max(0, Math.min(list.length - 1, Math.round(i)))];

/** Settings follow the machine: a new model keeps the setting if it can, or takes the nearest it allows. */
const SETTING_OF: Partial<Record<keyof Design, { css: keyof Design; list: Array<{ cssMin: number; cssMax: number }> }>> = {
  jawModel: { css: 'jawCss', list: JAWS },
  secModel: { css: 'secCss', list: CONES.map((c) => cavity(c, 'coarse')) },
  tertModel: { css: 'tertCss', list: CONES.map((c) => cavity(c, 'fine')) },
};

export function startSizing(seedParam: string | null) {
  document.title = 'PasteWorks · Size the plant';
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const stage = new Stage(canvas);
  const site = new Site();
  stage.scene.add(site.root);
  site.running(true);

  let seed = Number(seedParam) > 0 ? Math.floor(Number(seedParam)) : randomSeed();
  let contract: Contract = contractFor(seed);
  let design: Design = starterDesign(contract);
  let summary: Summary | null = null;
  let current = 0;
  const visited = new Set<number>([0]);

  const setUrl = () => history.replaceState(null, '', `?size=${seed}`);
  setUrl();

  // ------------------------------------------------------------- solving

  const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  let asked = 0;
  let busy = false;
  let queued = false;

  const solve = () => {
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    queued = false;
    worker.postMessage({ id: ++asked, contract, design });
  };

  worker.onmessage = (e: MessageEvent<{ id: number; summary?: Summary; error?: string }>) => {
    busy = false;
    if (e.data.error) console.error('sizing solve:', e.data.error);
    if (e.data.summary && e.data.id === asked) {
      summary = e.data.summary;
      refresh();
    }
    if (queued) solve();
  };

  // ------------------------------------------------------------- the plant

  const syncMachines = () => {
    const jaw = pick(JAWS, design.jawModel);
    site.grizzly.set({ aperture: design.grizzly });
    site.jaw.set({ width: jaw.width, gape: jaw.gape, css: design.jawCss });
    site.secondary.set({ head: pick(CONES, design.secModel).head, css: design.secCss });
    site.tertiary.set({ head: pick(CONES, design.tertModel).head, css: design.tertCss });
    const scr = pick(SCREENS, design.screenModel);
    site.screens.set({ width: scr.width, length: scr.length, count: design.screens, aperture: screenAperture(design) });
    const draw = summary?.results.BM?.powerDraw ?? summary?.results.BM?.power ?? 3e6;
    site.mill.set({ diameter: design.millD, length: design.millL, filling: design.millJ, power: draw / 1000 });
    site.cyclones.set({ diameter: cycloneDiameter(design), count: design.cyclones });
    // the bed as the underflow needs it, filling the tank when it would need more
    const bed = summary?.results.TH?.bedHeight ?? 0;
    site.thickener.set({ diameter: design.thDiam, depth: design.thDepth, bed: Math.min(design.thDepth, Number.isFinite(bed) ? bed : design.thDepth), drive: design.rakeDrive });
    site.presses.set({ plate: pick(PRESS_PLATES, design.pressPlate).size, chambers: design.pressChambers, presses: design.presses, depth: design.chamberDepth });
    const paste = summary?.streams[S.paste];
    site.pastePlant.set({ binder: (paste?.tph ?? contract.tph) * design.binder, flow: paste?.m3h ?? 150 });
    site.pumps.set({ pumps: design.pumps, kW: pick(PASTE_PUMPS, design.pumpModel).kW, bore: pick(PIPES, design.pipeModel).id });
  };

  // --------------------------------------------------------------- the UI

  const ui = new SizingUI({
    slide(key, value) {
      design = { ...design, [key]: value };
      const setting = SETTING_OF[key];
      if (setting) {
        const m = pick(setting.list, value);
        const css = Math.min(m.cssMax, Math.max(m.cssMin, design[setting.css]));
        if (css !== design[setting.css]) {
          design = { ...design, [setting.css]: css };
          ui.setSlider(setting.css, css);
        }
      }
      syncMachines();
      solve();
    },
    station(i) {
      goTo(i);
    },
    commission() {
      if (!summary || !allPass(summary)) return;
      const costs = costsFor(contract, design, summary);
      const score = scoreOf(costs);
      const { best, isBest } = record(seed, score);
      ui.showResults(contract, costs, score, best, isBest);
    },
    newContract() {
      seed = randomSeed();
      contract = contractFor(seed);
      design = starterDesign(contract);
      summary = null;
      visited.clear();
      setUrl();
      ui.setContract(contract);
      syncMachines();
      goTo(0);
      solve();
    },
    replay() {
      goTo(0);
    },
    leave() {
      location.href = location.pathname;
    },
  });

  const allPass = (s: Summary) => STATIONS.every((st) => stationPasses(st, contract, design, s) === true);

  function goTo(i: number) {
    current = Math.max(0, Math.min(STATIONS.length - 1, i));
    visited.add(current);
    const st = STATIONS[current];
    STATIONS.forEach((x, k) => site.built(x.id, visited.has(k)));
    ui.showStation(current, design);
    const view = site.stations[st.id];
    stage.flyTo(view.target, view.offset, 1100);
    site.mill.setCutaway(st.id === 'mill');
    site.focus(st.id);
    // shadows follow the camera: the key light's shadow box only covers so much of a 250 m line
    stage.key.target.position.copy(view.target);
    stage.key.position.copy(view.target).add(new THREE.Vector3(-70, 95, 70));
    refresh();
  }

  /** Everything that follows a solve: station states, rings, tags, the panel. */
  function refresh() {
    const states: StationState[] = STATIONS.map((st, i) => {
      if (!summary) return 'pending';
      const ok = stationPasses(st, contract, design, summary);
      if (!visited.has(i)) return 'idle';
      return ok === null ? 'pending' : ok ? 'pass' : 'fail';
    });
    ui.setSteps(states, current);
    if (!summary) return;
    syncMachines();
    const s = summary;
    const st = s.streams;
    const tagOf: Record<string, [string, string]> = {
      primary: [fmt.size(st[S.coarseOre]?.p80), 'coarse ore P80'],
      secondary: [fmt.size(st[S.secProduct]?.p80), 'product P80'],
      tertiary: [fmt.size(st[S.fineOre]?.p80), 'fine ore P80'],
      mill: [fmt.kW(s.results.BM?.powerDraw ?? s.results.BM?.power ?? NaN), 'mill power'],
      cyclones: [fmt.size(st[S.cycOver]?.p80), `grind P80, target ${fmt.size(contract.p80)}`],
      thickener: [fmt.pct(underflowCw(contract, design.ufPump), 1), `underflow, ${pick(RAKE_DRIVES, design.rakeDrive).name.toLowerCase()} rakes`],
      filter: [fmt.pct(s.results.FL?.load ?? NaN), 'of press capacity'],
      paste: [fmt.kPa(s.results.BN?.strength ?? NaN), `fill strength, target ${fmt.kPa(contract.backfill.ucs)}`],
      pumping: [fmt.kPa(pumpDuty(contract, design, s).pressure), 'pump pressure'],
    };
    STATIONS.forEach((station, i) => {
      const state = states[i];
      const [value, sub] = tagOf[station.id];
      site.setStatus(station.id, state === 'pass' ? 'pass' : state === 'fail' ? 'fail' : 'idle', value, sub);
    });
    ui.update(contract, design, s, costsFor(contract, design, s), allPass(s));
  }

  // -------------------------------------------------------------- the loop

  ui.setContract(contract);
  syncMachines();
  stage.camera.position.set(-60, 90, 170);
  stage.controls.target.set(110, 0, 0);
  goTo(0);
  solve();

  let last = performance.now();
  let t = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    site.tick(dt, t);
    tickFlows(dt);
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // for tools/sizingpage.mjs: load a whole design, as the verify designer closed it
  (window as unknown as { SZ: unknown }).SZ = {
    design: () => design,
    apply(next: Partial<Design>) {
      design = { ...design, ...next };
      syncMachines();
      goTo(current);
      solve();
    },
  };

  // a glance at the whole line with O
  addEventListener('keydown', (e) => {
    if (e.key === 'o' || e.key === 'O') stage.flyTo(new THREE.Vector3(265, 0, 25), new THREE.Vector3(-40, 250, 330), 1200);
  });
}
