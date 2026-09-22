/**
 * The control room.
 *
 * Click the hut and you sit down at the desk: four screens in a video wall,
 * the plant visible through the glass above them, and the same setpoints you
 * had on the side console - because they ARE the same setpoints, built from
 * the shared spec list and written straight back into the plant.
 *
 *   1  MIMIC         the flowsheet, live, every unit a tile
 *   2  SETPOINTS     every loop, with its instrument tag
 *   3  ANNUNCIATOR   a lamp box; standing conditions flash
 *   4  TRENDS        the last few hours of the numbers that matter
 */

import type { Plant, Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import {
  SLIDERS, UPSTREAM_SLIDERS, SliderSpec, bagValue, setBagValue, shown,
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
  /** false when the tile is only in play in hard mode */
  hard?: boolean;
  /** drawn in series with the tile above it */
  series?: boolean;
}

const MIMIC: NodeSpec[] = [
  { id: 'mill', col: 0, row: 0, name: 'BALL MILL', hard: true,
    alarms: ['media-low', 'media-out', 'liberation'] },
  { id: 'flot', col: 0, row: 1, name: 'FLOTATION', hard: true, series: true,
    alarms: ['sulphide-high'] },
  { id: 'cyc', col: 0, row: 2, name: 'DESLIME CYCLONES', hard: true, series: true,
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
];

// ------------------------------------------------------------------ trends

interface TrendSpec {
  key: string; label: string; unit: string; colour: string;
  min: number; max: number;
  /** a reference line drawn across the trace */
  ref?: number;
  pick: (t: Telemetry) => number;
}

const TRENDS: TrendSpec[] = [
  { key: 'ucs', label: '28 d UCS', unit: 'kPa', colour: '#9fe870',
    min: 0, max: 2200, ref: DESIGN.targetUcs, pick: (t) => t.mixer.ucs },
  { key: 'prs', label: 'Discharge', unit: 'bar', colour: '#ffab3d',
    min: 0, max: 140, ref: DESIGN.pumpMaxPressure / 100,
    pick: (t) => t.pump.pressure / 100 },
  { key: 'flow', label: 'Placement', unit: 'm³/h', colour: '#35e0d0',
    min: 0, max: 200, pick: (t) => t.pump.flow },
  { key: 'pw', label: 'Process water', unit: '%', colour: '#3fa9f5',
    min: 0, max: 100, ref: 100, pick: (t) => t.water.pct },
];

const SAMPLES = 420;

export class Scada {
  root = el('div');
  open = false;

  private sliders = new Map<string, HTMLInputElement>();
  private slVals = new Map<string, HTMLElement>();
  private slRows = new Map<string, HTMLElement>();
  private upEls: HTMLElement[] = [];
  private tiles = new Map<string, {
    box: SVGElement; big: SVGElement; sub: SVGElement; name: SVGElement;
  }>();
  private mimicUp!: SVGElement;
  private lamps = new Map<string, HTMLElement>();
  private evList!: HTMLElement;
  private evCount = -1;
  private trendCanvas!: HTMLCanvasElement;
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

  constructor(private plant: Plant) {
    for (const tr of TRENDS) this.hist[tr.key] = [];
    this.build();
    document.body.append(this.root);
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
      el('span', 'sc-where', 'CONTROL ROOM &middot; <b>CPB PLANT 01</b>'),
    );
    this.clock = el('span', 'sc-clock', '0.0 h');
    lintel.append(this.clock);

    const hint = el('span', 'sc-hint', 'drag to look around');
    lintel.append(hint);
    const centre = el('button', 'sc-centre', '&#8635;  CENTRE');
    centre.onclick = () => this.onCentre();
    lintel.append(centre);
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
      this.screen('03', 'ANNUNCIATOR', this.annunciator()),
      this.screen('04', 'TRENDS &middot; LAST 6 h', this.trends()),
    );
    w.append(this.grid, this.tray);
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
    // the trend canvas is sized from its box, which has just changed
    requestAnimationFrame(() => this.resizeTrend());
  }

  // ---- 01 mimic ------------------------------------------------------------

  private mimic() {
    const wrap = el('div', 'sc-body sc-mimic');
    const root = svg('svg', { viewBox: '0 0 620 306', preserveAspectRatio: 'xMidYMid meet' });

    const W = 272, H = 40, GAP = 8;
    const X = (c: number) => 18 + c * (W + 40);
    const Y = (r: number) => 10 + r * (H + GAP);

    // series connectors first, so the tiles sit on top of them
    for (const n of MIMIC) {
      if (!n.series) continue;
      const x = X(n.col) + 22;
      const line = svg('path', {
        d: `M ${x} ${Y(n.row - 1) + H} L ${x} ${Y(n.row)}`,
        stroke: '#35e0d0', 'stroke-width': 2, fill: 'none', opacity: 0.5,
      });
      root.append(line);
    }
    // the carry from the surge tank across to the press
    root.append(svg('path', {
      d: `M ${X(0) + W} ${Y(4) + H / 2} L ${X(0) + W + 20} ${Y(4) + H / 2}`
        + ` L ${X(1) - 20} ${Y(0) + H / 2} L ${X(1)} ${Y(0) + H / 2}`,
      stroke: '#35e0d0', 'stroke-width': 2, fill: 'none', opacity: 0.5,
      'stroke-dasharray': '5 4',
    }));

    for (const n of MIMIC) {
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

    this.mimicUp = svg('g', {});
    this.mimicUp.append(svg('rect', {
      x: X(0) + 12, y: Y(1) + 2, width: W - 24, height: H - 4, rx: 4,
      fill: 'rgba(10,16,23,0.95)', stroke: '#2b3644',
    }));
    const msg = svg('text', {
      x: X(0) + W / 2, y: Y(1) + 18, fill: '#6d7c90', 'font-size': 11,
      'text-anchor': 'middle', 'letter-spacing': 0.8,
    });
    msg.textContent = 'UPSTREAM CIRCUIT NOT IN PLAY';
    const msg2 = svg('text', {
      x: X(0) + W / 2, y: Y(1) + 31, fill: '#4a5768', 'font-size': 9.5,
      'text-anchor': 'middle', 'letter-spacing': 1.4,
    });
    msg2.textContent = 'STANDARD MODE — THE TAILINGS ARE A GIVEN';
    this.mimicUp.append(msg, msg2);
    root.append(this.mimicUp);

    wrap.append(root);
    return wrap;
  }

  // ---- 02 setpoints --------------------------------------------------------

  private setpoints() {
    const wrap = el('div', 'sc-body sc-sp');

    const upHead = el('div', 'sc-sect', 'Upstream circuit');
    wrap.append(upHead);
    this.upEls.push(upHead);
    for (const s of UPSTREAM_SLIDERS) {
      const row = this.slider(s);
      wrap.append(row);
      this.upEls.push(row);
    }

    const toggles = el('div', 'sc-toggles');
    const des = el('button');
    des.onclick = () => { this.plant.up.deslime = !this.plant.up.deslime; };
    const bnd = el('button');
    bnd.onclick = () => {
      this.plant.up.binderType = this.plant.up.binderType === 'opc' ? 'slag' : 'opc';
    };
    this.lampStrip.set('deslime', des);
    this.lampStrip.set('binder', bnd);
    toggles.append(des, bnd);
    wrap.append(toggles);
    this.upEls.push(toggles);

    wrap.append(el('div', 'sc-sect', 'Backfill plant'));
    for (const s of SLIDERS) wrap.append(this.slider(s));
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
    for (const s of [...UPSTREAM_SLIDERS, ...SLIDERS]) {
      const input = this.sliders.get(s.key)!;
      input.value = String(bagValue(this.plant, s));
      this.paint(s, input, this.slVals.get(s.key)!);
    }
  }

  // ---- 03 annunciator ------------------------------------------------------

  private annunciator() {
    const wrap = el('div', 'sc-body sc-ann');
    const grid = el('div', 'sc-lamps');
    for (const l of LAMPS) {
      const t = el('div', 'sc-lamp', l.text);
      grid.append(t);
      this.lamps.set(l.id, t);
    }
    wrap.append(grid);
    wrap.append(el('div', 'sc-sect', 'Event log'));
    this.evList = el('div', 'sc-events');
    wrap.append(this.evList);
    return wrap;
  }

  // ---- 04 trends -----------------------------------------------------------

  private trends() {
    const wrap = el('div', 'sc-body sc-trend');
    this.trendCanvas = el('canvas');
    wrap.append(this.trendCanvas);
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

    this.siloBtn = el('button');
    this.siloBtn.textContent = 'Order binder';
    this.siloBtn.onclick = () => this.plant.refillSilo();
    d.append(this.siloBtn);

    this.mediaBtn = el('button');
    this.mediaBtn.textContent = 'Order media';
    this.mediaBtn.onclick = () => this.plant.orderMedia();
    d.append(this.mediaBtn);

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

  // ------------------------------------------------------------------ opening

  show() {
    this.open = true;
    this.root.classList.add('on');
    this.syncSliders();
    this.resizeTrend();
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
    for (const e of this.moving) e.style.transform = t;
  }

  hide() {
    this.open = false;
    this.root.classList.remove('on');
  }

  private resizeTrend() {
    const c = this.trendCanvas;
    const r = c.parentElement!.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;   // minimised, or not laid out yet
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    c.style.width = r.width + 'px';
    c.style.height = r.height + 'px';
  }

  // ------------------------------------------------------------------- update

  update(t: Telemetry, speed: number) {
    if (!this.open) return;

    this.clock.innerHTML = f(t.time / 3600, 1) + ' h <em>'
      + (speed === 0 ? 'HELD' : 'RUNNING ' + speed + '×') + '</em>';

    this.mimicTiles(t);
    this.annunciatorTick(t);
    this.trendTick(t);
    this.deskTick(t, speed);

    const hard = t.upstream.hard;
    for (const e of this.upEls) e.style.opacity = hard ? '1' : '0.32';
    for (const s of UPSTREAM_SLIDERS) {
      (this.slRows.get(s.key)!.querySelector('input') as HTMLInputElement).disabled = !hard;
    }
    this.slRows.get('cyclonePressure')!.style.opacity = this.plant.up.deslime ? '1' : '0.4';
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
      const lamp = LAMPS.find((l) => l.id === a);
      if (lamp?.level === 'trip') return 'trip';
      if (lamp?.level === 'warn') worst = 'warn';
    }
    return worst;
  }

  private mimicTiles(t: Telemetry) {
    const u = t.upstream;
    const hard = u.hard;
    this.mimicUp.setAttribute('opacity', hard ? '0' : '1');

    const byId = new Map(MIMIC.map((n) => [n.id, n]));
    const st = (id: string, fb: 'ok' | 'warn' = 'ok') =>
      this.tileState(byId.get(id)!, fb);

    if (hard) {
      this.setTile('mill', f(u.p80) + ' µm',
        f(this.plant.up.millFeed) + ' t/h ore · ' + f(u.specificEnergy, 1)
        + ' kWh/t · charge ' + f(t.media.health * 100) + '%', st('mill'));
      this.setTile('flot', f(u.sulphideRecovery * 100, 1) + ' %',
        f(u.sulphide, 2) + ' %S to tails · ' + f(u.concentrate) + ' t/h conc', st('flot'));
      this.setTile('cyc', this.plant.up.deslime ? f(u.d50c, 1) + ' µm' : 'BYPASS',
        this.plant.up.deslime
          ? 'd50c · ' + f(u.deslimeSplit * 100) + '% to backfill · '
            + f(u.toTsf) + ' t/h to TSF'
          : 'cyclones out of circuit · all fines to the plant', st('cyc'));
    } else {
      for (const id of ['mill', 'flot', 'cyc']) this.setTile(id, '—', '', 'off');
    }

    const th = t.thickener;
    this.setTile('thk', f(th.ufCw * 100, 1) + ' %',
      'bed ' + f(th.bedPct) + '% · torque ' + f(th.torque) + '% · rise '
      + f(th.riseRate, 2) + '/' + f(th.riseLimit, 2) + ' m/h', st('thk'));
    this.setTile('srg', f(t.ufTank.pct) + ' %',
      f(t.ufTank.volume) + ' of ' + DESIGN.ufTankVol + ' m³ at '
      + f(t.ufTank.cw * 100, 1) + '% solids', st('srg'));
    this.setTile('pw', f(t.water.pct) + ' %',
      f(t.water.recovered) + ' m³/h in · ' + f(t.water.toMill) + ' of '
      + f(t.water.returnCap) + ' back to mill', st('pw'));

    const fl = t.filter;
    this.setTile('prs', f(fl.throughput) + ' t/h',
      f(fl.cycleTime, 1) + ' min cycle · cake ' + f(fl.cakeMoisture, 1)
      + '% moisture · ' + f(fl.utilisation) + '% util', st('prs'));
    this.setTile('bin', f(t.cakeBin.pct) + ' %',
      f(t.cakeBin.mass) + ' t wet at ' + f(t.cakeBin.cw * 100, 1) + '% Cw', st('bin'));
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
      f(t.stope.volume) + ' of ' + DESIGN.stopeVolume + ' m³ · placed at '
      + f(t.stope.avgUcs) + ' kPa (target ' + DESIGN.targetUcs + ')',
      t.stope.pct > 1 && t.stope.avgUcs < DESIGN.targetUcs ? 'warn' : 'ok');
  }

  private annunciatorTick(t: Telemetry) {
    const st = this.plant.standing;
    for (const l of LAMPS) {
      const on = l.id === '@plug' ? t.pipe.plugged
        : l.id === '@starve' ? t.pump.starved
        : st.has(l.id);
      const tile = this.lamps.get(l.id)!;
      tile.className = 'sc-lamp' + (on ? ' on ' + l.level : '');
    }

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
    if (this.lastSample < 0 || t.time - this.lastSample > 40 || t.time < this.lastSample) {
      if (t.time < this.lastSample) {           // the shift was reset
        this.histT.length = 0;
        for (const tr of TRENDS) this.hist[tr.key].length = 0;
      }
      this.lastSample = t.time;
      this.histT.push(t.time);
      for (const tr of TRENDS) this.hist[tr.key].push(tr.pick(t));
      if (this.histT.length > SAMPLES) {
        this.histT.shift();
        for (const tr of TRENDS) this.hist[tr.key].shift();
      }
    }
    this.drawTrends();
  }

  private drawTrends() {
    const c = this.trendCanvas;
    const r = c.parentElement!.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (Math.abs(r.width - parseFloat(c.style.width || '0')) > 2
      || Math.abs(r.height - parseFloat(c.style.height || '0')) > 2) this.resizeTrend();
    const g = c.getContext('2d')!;
    const dpr = Math.min(devicePixelRatio, 2);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = c.width / dpr, H = c.height / dpr;
    g.clearRect(0, 0, W, H);

    const n = TRENDS.length;
    const padL = 42, padR = 8, gap = 7;
    const h = (H - gap * (n - 1)) / n;

    TRENDS.forEach((tr, i) => {
      const y0 = i * (h + gap);
      g.fillStyle = 'rgba(255,255,255,0.025)';
      g.fillRect(padL, y0, W - padL - padR, h);

      const data = this.hist[tr.key];
      const span = Math.max(tr.max - tr.min, 1e-6);
      const yAt = (v: number) => y0 + h - ((v - tr.min) / span) * h;

      if (tr.ref !== undefined && tr.ref <= tr.max) {
        g.strokeStyle = 'rgba(255,255,255,0.22)';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(padL, yAt(tr.ref));
        g.lineTo(W - padR, yAt(tr.ref));
        g.stroke();
        g.setLineDash([]);
      }

      if (data.length > 1) {
        g.strokeStyle = tr.colour;
        g.lineWidth = 1.6;
        g.beginPath();
        for (let k = 0; k < data.length; k++) {
          const x = padL + ((W - padL - padR) * k) / (SAMPLES - 1);
          const y = yAt(Math.max(tr.min, Math.min(tr.max, data[k])));
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();

        g.fillStyle = tr.colour;
        const last = data[data.length - 1];
        const lx = padL + ((W - padL - padR) * (data.length - 1)) / (SAMPLES - 1);
        g.beginPath();
        g.arc(lx, yAt(Math.max(tr.min, Math.min(tr.max, last))), 2.4, 0, 7);
        g.fill();
        g.font = '600 12px ui-monospace, monospace';
        g.textAlign = 'right';
        g.fillText(f(last, last < 20 ? 2 : 0), W - padR - 5, y0 + 14);
      }

      // name inside the plot, scale in the gutter, so nothing collides
      g.fillStyle = '#8b9bb0';
      g.font = '10px ui-monospace, monospace';
      g.textAlign = 'left';
      g.fillText(tr.label + '   ' + tr.unit, padL + 6, y0 + 13);
      g.fillStyle = '#54627a';
      g.font = '9px ui-monospace, monospace';
      g.textAlign = 'right';
      g.fillText(String(tr.max), padL - 5, y0 + 9);
      g.fillText(String(tr.min), padL - 5, y0 + h - 2);
    });
  }

  private deskTick(t: Telemetry, speed: number) {
    const plugged = t.pipe.plugged;
    this.runBtn.className = plugged ? 'stop' : t.status === 'idle' ? 'run' : 'stop';
    this.runBtn.textContent = plugged ? '⚠  FLUSH THE LINE'
      : this.plant.sp.running ? '■  STOP PLANT' : '▶  START PLANT';
    this.flushBtn.disabled = !plugged;
    this.siloBtn.disabled = t.silo.pct > 97;
    this.siloBtn.classList.toggle('warn', t.silo.pct < 12);
    this.mediaBtn.disabled = !t.upstream.hard || t.media.pct > 97;
    this.mediaBtn.classList.toggle('warn', t.upstream.hard && t.media.pct < 20);
    this.mediaBtn.textContent = t.upstream.hard
      ? 'Order media · ' + f(t.media.pct) + '%' : 'Order media';

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

