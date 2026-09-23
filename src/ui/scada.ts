/**
 * The control room.
 *
 * Click the hut and you sit down at the desk: four screens in a video wall,
 * the plant visible through the glass above them, and the same setpoints you
 * had on the side console - because they ARE the same setpoints, built from
 * the shared spec list and written straight back into the plant.
 *
 *   00 WARNINGS    a banner across the top of the wall, above the screens and
 *                  double their width. It sits high enough that you catch it
 *                  flashing out of the corner of your eye and look up to read
 *                  it, which is exactly what a real alarm banner is for.
 *   01 MIMIC       the flowsheet, live, every unit a tile
 *   02 SETPOINTS   every loop, with its instrument tag
 *   03 INVENTORY   eight trends: every tank, bin, silo and stockpile
 *   04 PROCESS     eight trends: the numbers you actually control on
 */

import type { Plant, Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import type { Scenario } from '../scenario';
import { sheet, type Sheet } from '../scenario/flowsheet';
import {
  SliderSpec, bagValue, setBagValue, shown, upstreamSliders, plantSliders,
} from './setpoints';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, html?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '--');

// ------------------------------------------------------------------ mimic

interface NodeSpec {
  id: string;
  col: 0 | 1;
  row: number;
  name: string;
  /** conditions that light this tile up */
  alarms?: string[];
  /** drawn in series with the tile above it */
  series?: boolean;
}

const MIMIC: NodeSpec[] = [
  { id: 'mill', col: 0, row: 0, name: 'BALL MILL',
    alarms: ['media-low', 'media-out', 'liberation'] },
  { id: 'flot', col: 0, row: 1, name: 'FLOTATION', series: true,
    alarms: ['sulphide-high'] },
  { id: 'cyc', col: 0, row: 2, name: 'DESLIME CYCLONES', series: true,
    alarms: ['supply-short'] },
  { id: 'thk', col: 0, row: 3, name: 'THICKENER 01', series: true,
    alarms: ['thk-rise', 'thk-bed', 'rake-high', 'rake-trip'] },
  { id: 'srg', col: 0, row: 4, name: 'U/F SURGE TANK', series: true,
    alarms: ['uf-low', 'surge-spill'] },
  { id: 'pw', col: 0, row: 5, name: 'PROCESS WATER',
    alarms: ['pw-high', 'pw-spill'] },

  { id: 'prs', col: 1, row: 0, name: 'PLATE PRESS' },
  { id: 'bin', col: 1, row: 1, name: 'CAKE BIN', series: true,
    alarms: ['cake-low', 'cake-full'] },
  { id: 'silo', col: 1, row: 2, name: 'BINDER SILO', alarms: ['silo-low'] },
  { id: 'mix', col: 1, row: 3, name: 'PASTE MIXER', series: true,
    alarms: ['water-limited'] },
  { id: 'pmp', col: 1, row: 4, name: 'PASTE PUMP', series: true,
    alarms: ['overpressure', 'static', 'wear', 'choke'] },
  { id: 'stp', col: 1, row: 5, name: 'STOPE 14-2 N', series: true },
];

// -------------------------------------------------------------- annunciator

interface LampSpec { id: string; text: string; level: 'warn' | 'trip' | 'info' }

const LAMPS: LampSpec[] = [
  { id: 'media-low', text: 'BALL HOPPER LOW', level: 'warn' },
  { id: 'media-out', text: 'BALL CHARGE DOWN', level: 'trip' },
  { id: 'liberation', text: 'GRIND TOO COARSE', level: 'warn' },
  { id: 'sulphide-high', text: 'TAILS SULPHUR', level: 'warn' },
  { id: 'supply-short', text: 'TAILS SUPPLY SHORT', level: 'warn' },
  { id: 'thk-rise', text: 'OVERFLOW CLARITY', level: 'warn' },
  { id: 'thk-bed', text: 'THKNR BED HIGH', level: 'warn' },
  { id: 'rake-high', text: 'RAKE TORQUE HIGH', level: 'warn' },
  { id: 'rake-trip', text: 'RAKE TORQUE TRIP', level: 'trip' },
  { id: 'uf-limited', text: 'U/F DENSITY CAP', level: 'info' },
  { id: 'uf-low', text: 'SURGE TANK LOW', level: 'warn' },
  { id: 'surge-spill', text: 'SURGE TANK SPILL', level: 'trip' },
  { id: 'cake-low', text: 'CAKE BIN EMPTY', level: 'warn' },
  { id: 'cake-full', text: 'CAKE BIN HIGH', level: 'warn' },
  { id: 'water-limited', text: 'SLUMP UNREACHABLE', level: 'warn' },
  { id: 'silo-low', text: 'BINDER SILO LOW', level: 'warn' },
  { id: 'pw-high', text: 'PROC WATER HIGH', level: 'warn' },
  { id: 'pw-spill', text: 'PROC WATER SPILL', level: 'trip' },
  { id: 'overpressure', text: 'OVERPRESSURE', level: 'warn' },
  { id: 'static', text: 'LINE STATIC', level: 'warn' },
  { id: 'choke', text: 'FREE FLOWING', level: 'info' },
  { id: 'wear', text: 'PIPE WALL WEAR', level: 'warn' },
  { id: '@plug', text: 'LINE PLUGGED', level: 'trip' },
  { id: '@starve', text: 'PUMP STARVED', level: 'warn' },
  { id: 'plume', text: 'FINES TO OVERFLOW', level: 'warn' },
];

// ------------------------------------------------------------------ trends

interface TrendSpec {
  key: string; label: string; unit: string; colour: string;
  min: number; max: number;
  /** a reference line drawn across the trace - a target, a limit, or full */
  ref?: number;
  /** decimals on the live readout */
  dp?: number;
  pick: (t: Telemetry) => number;
}

/**
 * Everything that fills up or empties out. A paste plant is a chain of
 * buffers, and almost every bad shift starts as one of these quietly walking
 * off the bottom or the top of its range while you watch something else.
 */
const LEVEL_TRENDS: TrendSpec[] = [
  { key: 'srg', label: 'U/F surge tank', unit: '%', colour: '#35e0d0',
    min: 0, max: 100, ref: 100, pick: (t) => t.ufTank.pct },
  { key: 'pw', label: 'Process water', unit: '%', colour: '#3fa9f5',
    min: 0, max: 100, ref: 100, pick: (t) => t.water.pct },
  { key: 'bed', label: 'Thickener bed', unit: '%', colour: '#c8a6ff',
    min: 0, max: 130, ref: 100, pick: (t) => t.thickener.bedPct },
  { key: 'cake', label: 'Filter cake bin', unit: '%', colour: '#e0b866',
    min: 0, max: 100, pick: (t) => t.cakeBin.pct },
  { key: 'silo', label: 'Binder silo', unit: '%', colour: '#d9d3c3',
    min: 0, max: 100, pick: (t) => t.silo.pct },
  { key: 'media', label: 'Ball hopper', unit: '%', colour: '#9aa7b8',
    min: 0, max: 100, pick: (t) => t.media.pct },
  { key: 'stope', label: 'Stope 14-2 N', unit: '%', colour: '#9fe870',
    min: 0, max: 100, ref: 100, dp: 1, pick: (t) => t.stope.pct },
  { key: 'spill', label: 'Spilled, total', unit: 'm³', colour: '#ff5a3c',
    min: 0, max: 400, ref: 0, pick: (t) => t.spills.totalM3 },
];

/** The numbers you actually hold a setpoint against. */
const PROCESS_TRENDS: TrendSpec[] = [
  { key: 'ucs', label: '28 d UCS', unit: 'kPa', colour: '#9fe870',
    min: 0, max: 2200, ref: DESIGN.targetUcs, pick: (t) => t.mixer.ucs },
  { key: 'prs', label: 'Discharge', unit: 'bar', colour: '#ffab3d',
    min: 0, max: 140, ref: DESIGN.pumpMaxPressure / 100, dp: 1,
    pick: (t) => t.pump.pressure / 100 },
  { key: 'flow', label: 'Placement', unit: 'm³/h', colour: '#35e0d0',
    min: 0, max: 200, dp: 1, pick: (t) => t.pump.flow },
  { key: 'slump', label: 'Slump, Boger', unit: 'mm', colour: '#7fd4ff',
    min: 0, max: 200, pick: (t) => t.mixer.slump },
  { key: 'cw', label: 'Paste solids', unit: '% Cw', colour: '#f0a8d0',
    min: 55, max: 85, dp: 1, pick: (t) => t.mixer.cw * 100 },
  { key: 'vel', label: 'Line velocity', unit: 'm/s', colour: '#8fe8ff',
    min: 0, max: 3, ref: 1, dp: 2, pick: (t) => t.pipe.velocity },
  { key: 'torq', label: 'Rake torque', unit: '%', colour: '#ff8f6b',
    min: 0, max: 130, ref: 100, pick: (t) => t.thickener.torque },
  { key: 'cost', label: 'Cost of fill', unit: '$/m³', colour: '#ffd166',
    min: 0, max: 40, dp: 2, pick: (t) => t.cost.perM3 },
];

/** Only where a cyclone bank or a centrifuge sends fines out of the top. */
const PLUME_TREND: TrendSpec = {
  key: 'plume', label: 'Fines to overflow', unit: 't/h', colour: '#ff8f6b',
  min: 0, max: 10, dp: 1, pick: (t) => t.thickener.overflow.solids,
};
/** Only where every litre of mix water is hauled in. */
const HAULED_TREND: TrendSpec = {
  key: 'hauled', label: 'Water hauled', unit: 'm³/h', colour: '#3fa9f5',
  min: 0, max: 80, dp: 1, pick: (t) => t.water.makeUp,
};

const ALL_TRENDS = [...LEVEL_TRENDS, ...PROCESS_TRENDS, PLUME_TREND, HAULED_TREND];

/** 540 samples at one every 40 shift-seconds is exactly six hours of history. */
const SAMPLES = 540;
const SAMPLE_EVERY = 40;

/**
 * One trend screen: a grid of small multiples on a single canvas.
 *
 * Small multiples rather than a stack of full-width strips - at eight traces
 * a stacked strip is 30 px tall and tells you nothing, where a card twice as
 * tall and half as wide still has a readable shape and room for the number.
 */
class TrendPane {
  canvas = el('canvas');

  constructor(private specs: TrendSpec[]) {}

  /**
   * The CONTENT box of the panel, not the border box. getBoundingClientRect
   * includes the padding, and a canvas sized from it sits inside the padding
   * and overhangs the panel by exactly that much on the right and bottom -
   * which is the last column of numbers, sliced off.
   */
  private fit() {
    const p = this.canvas.parentElement!;
    const cs = getComputedStyle(p);
    return {
      w: p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      h: p.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
    };
  }

  resize() {
    const c = this.canvas;
    const { w, h } = this.fit();
    if (w < 2 || h < 2) return;                // minimised, or not laid out yet
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  }

  draw(hist: Record<string, number[]>) {
    const c = this.canvas;
    const r = this.fit();
    if (r.w < 2 || r.h < 2) return;
    if (Math.abs(r.w - parseFloat(c.style.width || '0')) > 2
      || Math.abs(r.h - parseFloat(c.style.height || '0')) > 2) this.resize();

    const g = c.getContext('2d')!;
    const dpr = Math.min(devicePixelRatio, 2);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = c.width / dpr, H = c.height / dpr;
    g.clearRect(0, 0, W, H);

    // one column when the panel is tall and narrow, two when it is not
    const n = this.specs.length;
    const cols = W < 330 ? 1 : 2;
    const rows = Math.ceil(n / cols);
    const gx = 9, gy = 7;
    const cw = (W - gx * (cols - 1)) / cols;
    const ch = (H - gy * (rows - 1)) / rows;

    this.specs.forEach((tr, i) => {
      const x0 = (i % cols) * (cw + gx);
      const y0 = Math.floor(i / cols) * (ch + gy);
      this.cell(g, tr, hist[tr.key], x0, y0, cw, ch);
    });
  }

  private cell(
    g: CanvasRenderingContext2D, tr: TrendSpec, data: number[],
    x0: number, y0: number, w: number, h: number,
  ) {
    g.fillStyle = 'rgba(255,255,255,0.028)';
    g.fillRect(x0, y0, w, h);

    const padT = 15, padB = 11, padX = 5;
    const ph = Math.max(6, h - padT - padB);
    const span = Math.max(tr.max - tr.min, 1e-6);
    const yAt = (v: number) =>
      y0 + padT + ph - ((Math.max(tr.min, Math.min(tr.max, v)) - tr.min) / span) * ph;

    if (tr.ref !== undefined && tr.ref <= tr.max && tr.ref >= tr.min) {
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(x0 + padX, yAt(tr.ref));
      g.lineTo(x0 + w - padX, yAt(tr.ref));
      g.stroke();
      g.setLineDash([]);
    }

    if (data && data.length > 1) {
      const xAt = (k: number) => x0 + padX + ((w - padX * 2) * k) / (SAMPLES - 1);
      g.strokeStyle = tr.colour;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 0; k < data.length; k++) {
        const x = xAt(k), y = yAt(data[k]);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();

      const last = data[data.length - 1];
      const lx = xAt(data.length - 1);
      g.fillStyle = tr.colour;
      g.beginPath();
      g.arc(lx, yAt(last), 2.2, 0, 7);
      g.fill();

      g.font = '600 12px ui-monospace, monospace';
      g.textAlign = 'right';
      g.fillText(f(last, tr.dp ?? 0), x0 + w - padX, y0 + 11);
    }

    g.fillStyle = '#8b9bb0';
    g.font = '9.5px ui-monospace, monospace';
    g.textAlign = 'left';
    g.fillText(tr.label, x0 + padX + 1, y0 + 11);

    g.fillStyle = '#54627a';
    g.font = '8.5px ui-monospace, monospace';
    g.fillText(tr.min + ' – ' + tr.max + '  ' + tr.unit, x0 + padX + 1, y0 + h - 3);

  }
}

export class Scada {
  root = el('div');
  open = false;

  private sliders = new Map<string, HTMLInputElement>();
  private slVals = new Map<string, HTMLElement>();
  private slRows = new Map<string, HTMLElement>();
  private specs: SliderSpec[] = [];
  private sh: Sheet = sheet();
  /** this site's mimic, lamps and trends - the tables filtered to its flowsheet */
  private nodes: NodeSpec[] = [];
  private lampList: LampSpec[] = [];
  private levelTrends: TrendSpec[] = [];
  private processTrends: TrendSpec[] = [];
  private tiles = new Map<string, {
    box: SVGElement; big: SVGElement; sub: SVGElement; name: SVGElement;
  }>();
  private lamps = new Map<string, HTMLElement>();
  private evList!: HTMLElement;
  private evCount = -1;
  private warnBar!: HTMLElement;
  private warnCount!: HTMLElement;
  private panes: TrendPane[] = [];
  private hist: Record<string, number[]> = {};
  private histT: number[] = [];
  private lastSample = -1;

  private clock!: HTMLElement;
  private runBtn!: HTMLButtonElement;
  private speedBtns: HTMLButtonElement[] = [];
  private lampStrip = new Map<string, HTMLElement>();
  private mediaBtn!: HTMLButtonElement;
  private siloBtn!: HTMLButtonElement;
  private flushBtn!: HTMLButtonElement;
  /** bolted to the room: slides with the view when you turn your head */
  private moving: HTMLElement[] = [];
  private screens: HTMLElement[] = [];
  private pills: HTMLElement[] = [];
  private grid!: HTMLElement;
  private tray!: HTMLElement;

  onExit: () => void = () => {};
  onCentre: () => void = () => {};
  onSetpoint: () => void = () => {};
  onSpeed: (s: number) => void = () => {};
  onRun: () => void = () => {};
  /** back to the title screen */
  onLeave: () => void = () => {};
  /** out of the chair and out of the door, on foot */
  onWalk: () => void = () => {};

  constructor(private plant: Plant, private sc: Scenario) {
    // This site's own name for where the paste goes, on the mimic and trends.
    MIMIC.find((n) => n.id === 'stp')!.name = sc.names.destShort;
    LEVEL_TRENDS.find((tr) => tr.key === 'stope')!.label = sc.names.destShort;
    // These were read at module load, before any scenario was applied: the
    // strength line has to be this site's target, and the cost trace has to
    // have room for Psyche, where fill costs fifteen times what it does here.
    const ucsTr = PROCESS_TRENDS.find((tr) => tr.key === 'ucs')!;
    ucsTr.ref = DESIGN.targetUcs;
    ucsTr.max = Math.max(2200, DESIGN.targetUcs * 1.8);
    const costTr = PROCESS_TRENDS.find((tr) => tr.key === 'cost')!;
    costTr.ref = sc.budget;
    costTr.max = Math.ceil((sc.budget * 1.6) / 10) * 10;
    costTr.dp = sc.budget >= 100 ? 0 : 2;
    this.fitToFlowsheet();
    for (const tr of ALL_TRENDS) this.hist[tr.key] = [];
    this.build();
    document.body.append(this.root);
  }

  /**
   * Cut the mimic, the lamp box and the trends down to what this site
   * actually has, and name things the way this site names them.
   */
  private fitToFlowsheet() {
    const sh = this.sh;
    const has = (id: string) => {
      switch (id) {
        case 'flot': return sh.separation !== 'none';
        case 'cyc': return sh.hasDeslime;
        case 'thk': case 'srg': case 'prs': return sh.dewater !== 'dry';
        default: return true;
      }
    };
    const rename: Record<string, string> = {
      mill: sh.tiles.source, flot: sh.tiles.separation, cyc: sh.tiles.deslime,
      thk: sh.tiles.dewater, bin: sh.tiles.bin, pw: sh.tiles.water,
    };
    const rows = [0, 0];
    this.nodes = MIMIC.filter((n) => has(n.id)).map((n) => {
      const out = { ...n, name: rename[n.id] ?? n.name, row: rows[n.col]++ };
      if (out.row === 0) out.series = false;
      return out;
    });
    // the water tile is a side loop, not a step in series
    const pw = this.nodes.find((n) => n.id === 'pw');
    if (pw) pw.series = false;

    this.lampList = LAMPS.filter((l) => {
      switch (l.id) {
        case 'media-low': case 'media-out': return sh.hasMedia;
        case 'liberation': return sh.source === 'mill';
        case 'sulphide-high': return sh.hasSulphide;
        case 'thk-rise': case 'thk-bed': case 'rake-high': case 'rake-trip': return sh.hasThickener;
        case 'uf-limited': return sh.hasUf;
        case 'uf-low': case 'surge-spill': return sh.hasSurge;
        case 'pw-high': case 'pw-spill': return sh.canSpillWater;
        case 'plume': return sh.hasPlume;
        default: return true;
      }
    }).map((l) => {
      if (l.id === 'media-low') return { ...l, text: sh.media.short.toUpperCase() + ' LOW' };
      if (l.id === 'media-out') return { ...l, text: sh.source === 'scoop' ? 'HAMMERS WORN' : l.text };
      if (l.id === 'uf-limited' && sh.dewater === 'cyclones') return { ...l, text: 'U/F AT CYCLONE LIMIT' };
      return l;
    });

    this.levelTrends = LEVEL_TRENDS.filter((tr) => {
      switch (tr.key) {
        case 'srg': return sh.hasSurge;
        case 'pw': return sh.dewater !== 'dry';
        case 'bed': return sh.hasThickener;
        case 'media': return sh.hasMedia;
        default: return true;
      }
    }).map((tr) => (tr.key === 'media' ? { ...tr, label: sh.media.short }
      : tr.key === 'cake' && sh.dewater === 'dry' ? { ...tr, label: 'Crushed waste bin' } : tr));
    if (sh.hasPlume) this.levelTrends.splice(2, 0, PLUME_TREND);
    if (sh.dewater === 'dry') this.levelTrends.splice(1, 0, HAULED_TREND);

    this.processTrends = PROCESS_TRENDS.filter((tr) => tr.key !== 'torq' || sh.hasTorque)
      .map((tr) => (tr.key === 'torq' && sh.dewater === 'centrifuge'
        ? { ...tr, label: 'Scroll torque' } : tr));
  }

  // ---------------------------------------------------------------- building

  private build() {
    this.root.id = 'scada';
    this.root.append(this.window(), this.wall(), this.desk());
  }

  /**
   * The band at the top: the real window, the real mullions, and the plant
   * through them. Nothing is painted on here any more - the camera is inside
   * the room, so the glass in front of it is actual geometry.
   */
  private window() {
    const w = el('div', 'sc-win');
    const lintel = el('div', 'sc-lintel');
    lintel.append(
      el('span', 'sc-where', 'CONTROL ROOM &middot; <b>' + this.sc.title.toUpperCase() + '</b>'),
    );
    this.clock = el('span', 'sc-clock', '0.0 h');
    lintel.append(this.clock);

    const hint = el('span', 'sc-hint', 'drag to look around');
    lintel.append(hint);
    const centre = el('button', 'sc-centre', '&#8635;  CENTRE');
    centre.onclick = () => this.onCentre();
    lintel.append(centre);
    const worlds = el('button', 'sc-centre', '&#8634;  WORLDS');
    worlds.title = 'Back to the choice of worlds';
    worlds.onclick = () => this.onLeave();
    lintel.append(worlds);
    const walk = el('button', 'sc-centre', 'WALK OUT  [F]');
    walk.title = 'Out of the door and round the plant on foot';
    walk.onclick = () => this.onWalk();
    if (!matchMedia('(pointer: coarse)').matches) lintel.append(walk);
    const exit = el('button', 'sc-exit', 'LEAVE THE DESK  [Esc]');
    exit.onclick = () => this.onExit();
    lintel.append(exit);
    w.append(lintel);
    return w;
  }

  private wall() {
    const w = el('div', 'sc-wall');
    this.moving.push(w);
    this.grid = el('div', 'sc-grid');
    this.tray = el('div', 'sc-tray');
    this.grid.append(
      this.screen('01', 'PROCESS MIMIC', this.mimic()),
      this.screen('02', 'SETPOINTS', this.setpoints()),
      this.screen('03', 'TRENDS &middot; INVENTORY &middot; 6 h', this.trends(this.levelTrends)),
      this.screen('04', 'TRENDS &middot; PROCESS &middot; 6 h', this.trends(this.processTrends)),
    );
    // The banner goes above the grid, not in it: it is one screen the width of
    // two, mounted high on the wall where it sits at the top of your vision.
    w.append(this.warnings(), this.grid, this.tray);
    this.relayout();
    return w;
  }

  /**
   * One monitor on the wall, with the two controls a real operator station
   * has: blow it up to fill the wall, or drop it out of the way. Minimised
   * screens go to a tray along the bottom; clear all four and you are just
   * sitting at a window looking at the plant.
   */
  private screen(no: string, title: string, body: HTMLElement) {
    const s = el('div', 'sc-screen');
    const h = el('div', 'sc-head');
    h.append(el('b', undefined, no), el('span', undefined, title));

    const btns = el('div', 'sc-winbtns');
    const mini = el('button', 'sc-wb min');
    mini.title = 'Minimise';
    mini.onclick = () => { s.classList.remove('zoom'); s.classList.add('mini'); this.relayout(); };
    const maxi = el('button', 'sc-wb max');
    maxi.title = 'Maximise';
    maxi.onclick = () => {
      const was = s.classList.contains('zoom');
      for (const o of this.screens) o.classList.remove('zoom');
      if (!was) s.classList.add('zoom');
      this.relayout();
    };
    btns.append(mini, maxi);
    h.append(btns);

    s.append(h, body);
    this.screens.push(s);

    const pill = el('button', 'sc-pill');
    pill.innerHTML = '<b>' + no + '</b>' + title;
    pill.title = 'Restore';
    pill.onclick = () => { s.classList.remove('mini'); this.relayout(); };
    this.pills.push(pill);
    return s;
  }

  /** Reflow the wall for whatever is minimised or blown up right now. */
  private relayout() {
    const zoomed = this.screens.find((s) => s.classList.contains('zoom'));
    let shown = 0;
    this.screens.forEach((s, i) => {
      const mini = s.classList.contains('mini');
      const hide = mini || (!!zoomed && s !== zoomed);
      s.style.display = hide ? 'none' : '';
      s.classList.toggle('big', s === zoomed);
      if (!hide) shown++;
      const pill = this.pills[i];
      pill.style.display = mini ? '' : 'none';
      if (mini && pill.parentElement !== this.tray) this.tray.append(pill);
    });
    this.grid.style.gridTemplateColumns = shown <= 1 ? '1fr' : '1fr 1fr';
    this.grid.style.display = shown === 0 ? 'none' : '';
    this.tray.style.display = this.pills.some((p) => p.style.display !== 'none') ? '' : 'none';
    // the trend canvases are sized from their boxes, which have just changed
    requestAnimationFrame(() => this.resizeTrends());
  }

  // ---- 01 mimic ------------------------------------------------------------

  private mimic() {
    const wrap = el('div', 'sc-body sc-mimic');
    const root = svg('svg', { viewBox: '0 0 620 306', preserveAspectRatio: 'xMidYMid meet' });

    const W = 272, H = 40, GAP = 8;
    const X = (c: number) => 18 + c * (W + 40);
    const Y = (r: number) => 10 + r * (H + GAP);

    // series connectors first, so the tiles sit on top of them
    for (const n of this.nodes) {
      if (!n.series) continue;
      const x = X(n.col) + 22;
      const line = svg('path', {
        d: `M ${x} ${Y(n.row - 1) + H} L ${x} ${Y(n.row)}`,
        stroke: '#35e0d0', 'stroke-width': 2, fill: 'none', opacity: 0.5,
      });
      root.append(line);
    }
    // the carry from the last step on the left across to the top of the right
    const lastLeft = Math.max(...this.nodes.filter((n) => n.col === 0 && n.id !== 'pw').map((n) => n.row));
    root.append(svg('path', {
      d: `M ${X(0) + W} ${Y(lastLeft) + H / 2} L ${X(0) + W + 20} ${Y(lastLeft) + H / 2}`
        + ` L ${X(1) - 20} ${Y(0) + H / 2} L ${X(1)} ${Y(0) + H / 2}`,
      stroke: '#35e0d0', 'stroke-width': 2, fill: 'none', opacity: 0.5,
      'stroke-dasharray': '5 4',
    }));

    for (const n of this.nodes) {
      const g = svg('g', {});
      const box = svg('rect', {
        x: X(n.col), y: Y(n.row), width: W, height: H, rx: 5,
        fill: 'rgba(16,26,36,0.9)', stroke: '#35e0d0', 'stroke-width': 1.3,
      });
      const name = svg('text', {
        x: X(n.col) + 10, y: Y(n.row) + 16, fill: '#8b9bb0',
        'font-size': 10.5, 'letter-spacing': 1.1,
      });
      name.textContent = n.name;
      const big = svg('text', {
        x: X(n.col) + W - 10, y: Y(n.row) + 19, fill: '#e2e9f4',
        'font-size': 17, 'text-anchor': 'end', 'font-family': 'ui-monospace, monospace',
      });
      const sub = svg('text', {
        x: X(n.col) + 10, y: Y(n.row) + 32, fill: '#6d7c90', 'font-size': 10,
        'font-family': 'ui-monospace, monospace',
      });
      g.append(box, name, big, sub);
      root.append(g);
      this.tiles.set(n.id, { box, big, sub, name });
    }

    wrap.append(root);
    return wrap;
  }

  // ---- 02 setpoints --------------------------------------------------------

  private setpoints() {
    const wrap = el('div', 'sc-body sc-sp');

    wrap.append(el('div', 'sc-sect', 'Upstream circuit'));
    for (const s of upstreamSliders()) wrap.append(this.slider(s));

    const toggles = el('div', 'sc-toggles');
    const des = el('button');
    des.onclick = () => { this.plant.up.deslime = !this.plant.up.deslime; };
    const bnd = el('button');
    bnd.onclick = () => {
      this.plant.up.binderType = this.plant.up.binderType === 'opc' ? 'slag' : 'opc';
    };
    this.lampStrip.set('deslime', des);
    this.lampStrip.set('binder', bnd);
    if (this.sh.hasDeslime) toggles.append(des, bnd);
    else { toggles.append(bnd); toggles.style.gridTemplateColumns = '1fr'; }
    wrap.append(toggles);

    wrap.append(el('div', 'sc-sect', 'Backfill plant'));
    for (const s of plantSliders()) wrap.append(this.slider(s));
    return wrap;
  }

  private slider(s: SliderSpec) {
    const row = el('div', 'sc-ctl');
    const lab = el('div', 'sc-lab');
    lab.append(
      el('em', undefined, s.tag),
      el('span', undefined, s.label),
    );
    const v = el('b');
    lab.append(v);
    row.append(lab);

    const input = el('input');
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(bagValue(this.plant, s));
    input.oninput = () => {
      setBagValue(this.plant, s, parseFloat(input.value));
      this.paint(s, input, v);
      this.onSetpoint();
    };
    row.append(input);

    this.sliders.set(s.key, input);
    this.specs.push(s);
    this.slVals.set(s.key, v);
    this.slRows.set(s.key, row);
    this.paint(s, input, v);
    return row;
  }

  private paint(s: SliderSpec, input: HTMLInputElement, v: HTMLElement) {
    const raw = parseFloat(input.value);
    input.style.setProperty('--pct', ((raw - s.min) / (s.max - s.min)) * 100 + '%');
    v.textContent = shown(s, raw);
  }

  /** Pull every slider back from the plant - after a reset, or a console edit. */
  syncSliders() {
    for (const s of this.specs) {
      const input = this.sliders.get(s.key)!;
      input.value = String(bagValue(this.plant, s));
      this.paint(s, input, this.slVals.get(s.key)!);
    }
  }

  // ---- 00 warnings ---------------------------------------------------------

  /**
   * The alarm banner. Wide, shallow, and above the working screens, which is
   * where every real control room puts one - you read the screens with your
   * eyes down, catch the banner flashing at the top of your vision, and have
   * to lift your head to find out what it is. Collapsed it keeps flashing,
   * because a banner you can silence by folding it away is worse than none.
   */
  private warnings() {
    const bar = el('div', 'sc-warnbar');
    this.warnBar = bar;

    const h = el('div', 'sc-head');
    h.append(el('b', undefined, '00'), el('span', undefined, 'WARNINGS'));
    this.warnCount = el('em', 'sc-wcount', 'ALL CLEAR');
    h.append(this.warnCount);

    const btns = el('div', 'sc-winbtns');
    const mini = el('button', 'sc-wb min');
    mini.title = 'Fold the banner away';
    mini.onclick = () => {
      bar.classList.toggle('mini');
      requestAnimationFrame(() => this.resizeTrends());
    };
    btns.append(mini);
    h.append(btns);

    const body = el('div', 'sc-wbody');
    const grid = el('div', 'sc-lamps');
    for (const l of this.lampList) {
      const t = el('div', 'sc-lamp', l.text);
      grid.append(t);
      this.lamps.set(l.id, t);
    }
    const log = el('div', 'sc-wlog');
    log.append(el('div', 'sc-sect', 'Event log'));
    this.evList = el('div', 'sc-events');
    log.append(this.evList);
    body.append(grid, log);

    bar.append(h, body);
    return bar;
  }

  // ---- 03 / 04 trends ------------------------------------------------------

  private trends(specs: TrendSpec[]) {
    const wrap = el('div', 'sc-body sc-trend');
    const pane = new TrendPane(specs);
    this.panes.push(pane);
    wrap.append(pane.canvas);
    return wrap;
  }

  // ---- the desk ------------------------------------------------------------

  private desk() {
    // Deliberately NOT in this.moving. Physically it is the console right
    // under your hands, but sliding the stop button off the screen when you
    // glance along the window is a bad trade for a bit of realism.
    const d = el('div', 'sc-desk');

    this.runBtn = el('button', 'run');
    this.runBtn.textContent = '▶  START PLANT';
    this.runBtn.onclick = () => this.onRun();
    d.append(this.runBtn);

    const sp = el('div', 'sc-speeds');
    [0, 1, 10, 60, 240].forEach((v, i) => {
      const b = el('button');
      b.textContent = ['❚❚', '1×', '10×', '60×', '240×'][i];
      b.onclick = () => this.onSpeed(v);
      this.speedBtns.push(b);
      sp.append(b);
    });
    d.append(sp);

    d.append(this.phone());

    this.flushBtn = el('button', 'warn');
    this.flushBtn.textContent = 'Flush line';
    this.flushBtn.onclick = () => this.plant.clearBlockage();
    d.append(this.flushBtn);

    const strip = el('div', 'sc-strip');
    for (const [k, label] of [
      ['run', 'RUN'], ['trip', 'TRIP'], ['spill', 'SPILL'], ['spec', 'ON SPEC'],
    ] as const) {
      const lamp = el('div', 'sc-pilot', '<i></i><span>' + label + '</span>');
      strip.append(lamp);
      this.lampStrip.set(k, lamp);
    }
    d.append(strip);
    return d;
  }

  /**
   * The desk phone. Consumables do not appear because you wished for them:
   * somebody has to ring the supplier, and from the chair that is you. Same
   * two orders as the side console, but you do not have to leave the room to
   * place them - and the handset lights up when a bin is getting low.
   */
  private phone() {
    const p = el('div', 'sc-phone');
    p.append(el('i', 'sc-ph-icon'), el('span', 'sc-ph-lab', 'SITE<br>SUPPLY'));

    this.siloBtn = el('button', 'sc-ph-btn');
    this.siloBtn.onclick = () => this.plant.refillSilo();
    this.mediaBtn = el('button', 'sc-ph-btn');
    this.mediaBtn.onclick = () => this.plant.orderMedia();
    p.append(this.siloBtn, this.mediaBtn);
    return p;
  }

  // ------------------------------------------------------------------ opening

  show() {
    this.open = true;
    this.root.classList.add('on');
    this.syncSliders();
    this.resizeTrends();
    this.setLookOffset(0, 0);
  }

  /**
   * Slide the video wall and the desk to where a rigid fitting in the room
   * would project to.
   *
   * Under pure rotation - and the operator never leaves the chair - every
   * direction shifts by the same angle, so matching the camera is just a
   * translation. No perspective skew, which keeps the text at native
   * resolution instead of resampling it through a 3D transform.
   */
  setLookOffset(px: number, py: number) {
    const t = px === 0 && py === 0
      ? 'none'
      : 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)';
    // Turn far enough and the wall is genuinely behind your shoulder. Hide it
    // rather than leave the compositor pushing a screen-sized layer around
    // somewhere off to the side.
    const gone = Math.abs(px) > innerWidth * 1.15 || Math.abs(py) > innerHeight * 1.3;
    for (const e of this.moving) {
      e.style.transform = t;
      e.style.visibility = gone ? 'hidden' : '';
    }
  }

  hide() {
    this.open = false;
    this.root.classList.remove('on');
  }

  private resizeTrends() {
    for (const p of this.panes) p.resize();
  }

  // ------------------------------------------------------------------- update

  update(t: Telemetry, speed: number) {
    if (!this.open) return;

    this.clock.innerHTML = f(t.time / 3600, 1) + ' h <em>'
      + (speed === 0 ? 'HELD' : 'RUNNING ' + speed + '×') + '</em>';

    this.mimicTiles(t);
    this.warningsTick(t);
    this.trendTick(t);
    this.deskTick(t, speed);

    const cp = this.slRows.get('cyclonePressure');
    if (cp) cp.style.opacity = this.plant.up.deslime ? '1' : '0.4';
  }

  private setTile(
    id: string, big: string, sub: string, state: 'ok' | 'warn' | 'trip' | 'off',
  ) {
    const tl = this.tiles.get(id);
    if (!tl) return;
    tl.big.textContent = big;
    tl.sub.textContent = sub;
    const stroke = state === 'trip' ? '#ff5a3c'
      : state === 'warn' ? '#ffab3d'
      : state === 'off' ? '#2b3644' : '#35e0d0';
    tl.box.setAttribute('stroke', stroke);
    tl.box.setAttribute('stroke-width', state === 'ok' || state === 'off' ? '1.3' : '2.2');
    tl.big.setAttribute('fill', state === 'off' ? '#4a5768' : '#e2e9f4');
    tl.name.setAttribute('fill', state === 'off' ? '#3d4858' : '#8b9bb0');
  }

  /** Worst standing condition on a tile decides its colour. */
  private tileState(n: NodeSpec, fallback: 'ok' | 'warn' = 'ok') {
    const st = this.plant.standing;
    let worst: 'ok' | 'warn' | 'trip' = fallback;
    for (const a of n.alarms ?? []) {
      if (!st.has(a)) continue;
      const lamp = this.lampList.find((l) => l.id === a);
      if (lamp?.level === 'trip') return 'trip';
      if (lamp?.level === 'warn') worst = 'warn';
    }
    return worst;
  }

  private mimicTiles(t: Telemetry) {
    const u = t.upstream;

    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const st = (id: string, fb: 'ok' | 'warn' = 'ok') => {
      const n = byId.get(id);
      return n ? this.tileState(n, fb) : 'ok';
    };
    const sh = this.sh;

    {
      const feedRate = f(this.plant.up.millFeed) + ' t/h';
      if (sh.source === 'collector') {
        this.setTile('mill', feedRate, 'collecting · ' + f(u.millPower) + ' kW on the collector and lift', st('mill'));
        this.setTile('flot', f(u.concentrate) + ' t/h', 'nodules up the riser to the ship', st('flot'));
      } else if (sh.source === 'reclaim') {
        this.setTile('mill', feedRate, 'old tails · P80 ' + f(u.p80) + ' µm · ' + f(u.sulphide, 2) + '% S', st('mill'));
      } else if (sh.source === 'scoop') {
        this.setTile('mill', f(u.p80) + ' µm', feedRate + ' scooped · hammers '
          + f(t.media.health * 100) + '%', st('mill'));
        this.setTile('flot', f(u.concentrate, 1) + ' t/h', 'scrap steel off the crusher belt', st('flot'));
      } else {
        this.setTile('mill', f(u.p80) + ' µm',
          feedRate + ' ore · ' + f(u.specificEnergy, 1)
          + ' kWh/t · charge ' + f(t.media.health * 100) + '%', st('mill'));
        if (sh.separation === 'magnetic') {
          this.setTile('flot', f(u.sulphideRecovery * 100, 1) + ' %',
            f(u.concentrate) + ' t/h metal · ' + f(u.liberation * 100) + '% liberated', st('flot'));
        } else {
          this.setTile('flot', f(u.sulphideRecovery * 100, 1) + ' %',
            f(u.sulphide, 2) + ' %S to tails · ' + f(u.concentrate) + ' t/h conc', st('flot'));
        }
      }
      this.setTile('cyc', this.plant.up.deslime ? f(u.d50c, 1) + ' µm' : 'BYPASS',
        this.plant.up.deslime
          ? 'd50c · ' + f(u.deslimeSplit * 100) + '% to backfill · '
            + f(u.toTsf) + ' t/h to TSF'
          : 'cyclones out of circuit · all fines to the plant', st('cyc'));
    }

    const th = t.thickener;
    if (sh.dewater === 'cyclones') {
      this.setTile('thk', f(th.ufCw * 100, 1) + ' %', 'fines to sea ' + f(th.overflow.solids, 1)
        + ' t/h · bypassed ' + f(u.bypassToTsf) + ' t/h', st('thk'));
    } else if (sh.dewater === 'centrifuge') {
      this.setTile('thk', f(th.ufCw * 100, 1) + ' %', 'scroll torque ' + f(th.torque)
        + '% · centrate ' + f(th.overflowClarity) + ' mg/L', st('thk'));
    } else {
      this.setTile('thk', f(th.ufCw * 100, 1) + ' %',
        'bed ' + f(th.bedPct) + '% · torque ' + f(th.torque) + '% · rise '
        + f(th.riseRate, 2) + '/' + f(th.riseLimit, 2) + ' m/h', st('thk'));
    }
    this.setTile('srg', f(t.ufTank.pct) + ' %',
      f(t.ufTank.volume) + ' of ' + DESIGN.ufTankVol + ' m³ at '
      + f(t.ufTank.cw * 100, 1) + '% solids', st('srg'));
    if (sh.dewater === 'dry') {
      this.setTile('pw', f(t.water.makeUp, 1) + ' m³/h', 'hauled in at $' + DESIGN.costWater
        + '/m³ · $' + f(t.cost.water) + ' so far', st('pw'));
    } else if (DESIGN.millReturnCap >= 1e5) {
      this.setTile('pw', f(t.water.recovered) + ' m³/h', sh.source === 'collector'
        ? 'seawater, back where it came from' : 'recovered · every drop back to the mill', st('pw'));
    } else {
      this.setTile('pw', f(t.water.pct) + ' %',
        f(t.water.recovered) + ' m³/h in · ' + f(t.water.toMill) + ' of '
        + f(t.water.returnCap) + ' back to mill', st('pw'));
    }

    const fl = t.filter;
    this.setTile('prs', f(fl.throughput) + ' t/h',
      f(fl.cycleTime, 1) + ' min cycle · cake ' + f(fl.cakeMoisture, 1)
      + '% moisture · ' + f(fl.utilisation) + '% util', st('prs'));
    this.setTile('bin', f(t.cakeBin.pct) + ' %',
      f(t.cakeBin.mass) + ' t ' + (sh.dewater === 'dry' ? 'crushed' : 'wet') + ' at '
      + f(t.cakeBin.cw * 100, 1) + '% Cw', st('bin'));
    this.setTile('silo', f(t.silo.pct) + ' %',
      f(t.silo.mass) + ' t · drawing ' + f(t.silo.feedRate, 2) + ' t/h · '
      + (u.binderType === 'slag' ? 'slag blend' : 'OPC'), st('silo'));
    const m = t.mixer;
    this.setTile('mix', f(m.slump) + ' mm',
      f(m.cw * 100, 1) + '% Cw · ' + f(m.binderDose, 1) + '% binder · τy '
      + f(m.yieldStress) + ' Pa · ' + f(m.ucs) + ' kPa', st('mix'));
    const pp = t.pump;
    this.setTile('pmp', f(pp.flow, 1) + ' m³/h',
      f(pp.pressure / 100, 1) + ' bar of ' + f(DESIGN.pumpMaxPressure / 100)
      + ' · ' + f(t.pipe.velocity, 2) + ' m/s ' + t.pipe.regime,
      t.pipe.plugged ? 'trip' : st('pmp', pp.starved ? 'warn' : 'ok'));
    this.setTile('stp', f(t.stope.pct, 1) + ' %',
      f(t.stope.volume) + ' of ' + DESIGN.stopeVolume + ' m³ · ' + this.sc.names.placed + ' at '
      + f(t.stope.avgUcs) + ' kPa (target ' + DESIGN.targetUcs + ')',
      t.stope.pct > 1 && t.stope.avgUcs < DESIGN.targetUcs ? 'warn' : 'ok');
  }

  /** Put the result of the job up on the banner, where everyone can see it. */
  announce(ok: boolean, t: Telemetry) {
    this.done = ok ? 'win' : 'lose';
    this.doneText = (ok ? this.sc.names.complete : this.sc.names.complete + ' — UNDERSTRENGTH')
      + ' · ' + t.stope.avgUcs.toFixed(0) + ' kPa · $' + t.cost.perM3.toFixed(2) + '/m³';
  }
  private done: 'win' | 'lose' | null = null;
  private doneText = '';

  private warningsTick(t: Telemetry) {
    const st = this.plant.standing;
    let warn = 0, trip = 0;
    for (const l of this.lampList) {
      const on = l.id === '@plug' ? t.pipe.plugged
        : l.id === '@starve' ? t.pump.starved
        : st.has(l.id);
      if (on && l.level === 'trip') trip++;
      else if (on && l.level === 'warn') warn++;
      const tile = this.lamps.get(l.id)!;
      tile.className = 'sc-lamp' + (on ? ' on ' + l.level : '');
    }

    // The header carries the count, because folded away it is all you see -
    // and it has to be enough to make you unfold it.
    this.warnCount.textContent = trip
      ? trip + ' TRIP' + (trip > 1 ? 'S' : '') + (warn ? ' · ' + warn + ' WARNING' + (warn > 1 ? 'S' : '') : '')
      : warn ? warn + ' WARNING' + (warn > 1 ? 'S' : '')
      : 'ALL CLEAR';
    if (this.done && t.status !== 'complete') this.done = null;   // a reset
    if (this.done) this.warnCount.textContent = this.doneText;
    this.warnBar.classList.toggle('trip', trip > 0);
    this.warnBar.classList.toggle('warn', trip === 0 && warn > 0);
    this.warnBar.classList.toggle('win', this.done === 'win');

    if (t.alarms.length !== this.evCount) {
      this.evCount = t.alarms.length;
      this.evList.innerHTML = '';
      for (const a of t.alarms.slice(0, 24)) {
        const row = el('div', 'sc-ev ' + a.level);
        row.append(
          el('time', undefined, f(a.at / 3600, 1) + 'h'),
          el('span', undefined, a.text),
        );
        this.evList.append(row);
      }
    }
  }

  private trendTick(t: Telemetry) {
    // sample on shift time, so fast-forward fills the trace at the right pace
    if (this.lastSample < 0 || t.time - this.lastSample > SAMPLE_EVERY
      || t.time < this.lastSample) {
      if (t.time < this.lastSample) {           // the shift was reset
        this.histT.length = 0;
        for (const tr of ALL_TRENDS) this.hist[tr.key].length = 0;
      }
      this.lastSample = t.time;
      this.histT.push(t.time);
      for (const tr of ALL_TRENDS) this.hist[tr.key].push(tr.pick(t));
      if (this.histT.length > SAMPLES) {
        this.histT.shift();
        for (const tr of ALL_TRENDS) this.hist[tr.key].shift();
      }
    }
    for (const p of this.panes) p.draw(this.hist);
  }

  private deskTick(t: Telemetry, speed: number) {
    const plugged = t.pipe.plugged;
    this.runBtn.className = plugged ? 'stop' : t.status === 'idle' ? 'run' : 'stop';
    this.runBtn.textContent = plugged ? '⚠  FLUSH THE LINE'
      : this.plant.sp.running ? '■  STOP PLANT' : '▶  START PLANT';
    this.flushBtn.disabled = !plugged;

    const call = (b: HTMLButtonElement, name: string, pct: number, low: number, live: boolean) => {
      b.innerHTML = name + '<b>' + (live ? f(pct) + '%' : '—') + '</b>';
      b.disabled = !live || pct > 97;
      b.classList.toggle('warn', live && pct < low);
    };
    call(this.siloBtn, 'Binder', t.silo.pct, 12, true);
    call(this.mediaBtn, this.sh.media.button, t.media.pct, 20, this.sh.hasMedia);
    // the handset itself lights up, so you notice from across the room
    this.siloBtn.parentElement!.classList.toggle('ring',
      t.silo.pct < 12 || (this.sh.hasMedia && t.media.pct < 20));

    [0, 1, 10, 60, 240].forEach((v, i) =>
      this.speedBtns[i].classList.toggle('on', v === speed));

    const des = this.lampStrip.get('deslime') as HTMLButtonElement;
    des.textContent = this.plant.up.deslime ? 'Deslime: IN' : 'Deslime: BYPASS';
    des.classList.toggle('on', this.plant.up.deslime);
    const bnd = this.lampStrip.get('binder') as HTMLButtonElement;
    bnd.textContent = this.plant.up.binderType === 'slag' ? 'Binder: slag' : 'Binder: OPC';
    bnd.classList.toggle('on', this.plant.up.binderType === 'slag');

    const pilot = (k: string, on: boolean, cls: string) => {
      const p = this.lampStrip.get(k)!;
      p.className = 'sc-pilot' + (on ? ' on ' + cls : '');
    };
    pilot('run', t.status === 'running' || t.status === 'starved', 'lime');
    pilot('trip', plugged || this.plant.standing.has('rake-trip'), 'red');
    pilot('spill', t.spills.water > 0.5 || t.spills.slurry > 0.5, 'red');
    pilot('spec', t.mixer.ucs >= DESIGN.targetUcs, 'lime');
  }
}

