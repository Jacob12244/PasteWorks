import './sizing.css';
import type { Contract, Design } from './circuit';
import { fmt, STATIONS, type Check, type Row, type Station } from './stations';
import type { Summary } from './summary';
import type { Costs } from './costs';
import type { Score } from './scores';

/**
 * Everything on screen that is not the plant: the contract card, the row of
 * stations along the bottom, the station panel with its sliders, checks and
 * size curves, and the commissioning card at the end.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface Handlers {
  slide(key: keyof Design, value: number): void;
  station(index: number): void;
  commission(): void;
  newContract(): void;
  replay(): void;
  leave(): void;
}

export type StationState = 'idle' | 'pass' | 'fail' | 'pending';

const money = (v: number) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000).toLocaleString('en')}k`;

export class SizingUI {
  root = el('div');
  private contractBody = el('div', 'sz-body');
  private contractTitle = el('span');
  private totals = el('div', 'sz-totals sz-panel');
  private steps = el('div', 'sz-steps');
  private panel = el('div', 'sz-station sz-panel');
  private sliders = new Map<keyof Design, { input: HTMLInputElement; value: HTMLElement; slider: Station['sliders'][number] }>();
  private checksBox = el('div', 'sz-checks');
  private rowsBox = el('table', 'sz-rows');
  private notesBox = el('div', 'sz-notes');
  private costBox = el('table', 'sz-rows');
  private chart = el('canvas', 'sz-chart');
  private legend = el('div', 'sz-legend');
  private nav = el('div', 'sz-nav');
  private modal = el('div', 'sz-modal');
  private current = -1;

  constructor(private h: Handlers) {
    this.root.id = 'sizing';

    const card = el('div', 'sz-contract sz-panel');
    const head = el('h2');
    head.append(this.contractTitle);
    const leave = el('button', 'sz-link', 'Leave');
    leave.onclick = () => h.leave();
    head.append(leave);
    card.append(head, this.contractBody);
    const again = el('button', undefined, 'New contract');
    again.onclick = () => h.newContract();
    const actions = el('div', 'sz-actions');
    actions.append(again);
    card.append(actions);

    this.chart.width = 300 * 2;
    this.chart.height = 150 * 2;

    this.modal.classList.add('hidden');
    this.root.append(card, this.totals, this.panel, this.steps, this.modal);
    document.body.append(this.root);
  }

  setContract(c: Contract) {
    this.contractTitle.textContent = `Contract ${String(c.seed).padStart(5, '0')}`;
    const rows: Array<[string, string]> = [
      ['Throughput', `${c.tph} t/h dry ore`],
      ['Blast', `top size ${fmt.size(c.rom.xmax)}, x50 ${fmt.size(c.rom.x50)}`],
      ['Ore', `Wi ${c.wi.toFixed(1)} kWh/t, Ai ${c.ai.toFixed(2)}, SG ${(c.density / 1000).toFixed(2)}`],
      ['Grind', `P80 ≤ ${fmt.size(c.p80)}`],
      ['Flotation feed', `${fmt.pct(c.overflowCw[0])} – ${fmt.pct(c.overflowCw[1])} solids`],
    ];
    this.contractBody.innerHTML = '';
    const t = el('table', 'sz-rows');
    for (const [k, v] of rows) {
      const tr = el('tr');
      tr.append(el('td', undefined, k), el('td', undefined, v));
      t.append(tr);
    }
    this.contractBody.append(t);
  }

  /** The row of stations along the bottom. */
  setSteps(states: StationState[], current: number) {
    this.steps.innerHTML = '';
    STATIONS.forEach((st, i) => {
      const b = el('button', 'sz-step ' + states[i] + (i === current ? ' on' : ''));
      b.append(el('i'), el('span', undefined, `${i + 1}  ${st.short}`));
      b.onclick = () => this.h.station(i);
      this.steps.append(b);
    });
    const next = el('button', 'sz-step locked');
    next.disabled = true;
    next.title = 'The backfill plant joins the line in the next phase';
    next.append(el('i'), el('span', undefined, `${STATIONS.length + 1}  Backfill`));
    this.steps.append(next);
  }

  /** Open a station: its sliders, from the design as it stands. */
  showStation(index: number, design: Design) {
    this.current = index;
    const st = STATIONS[index];
    const p = this.panel;
    p.innerHTML = '';
    this.sliders.clear();

    const h = el('h2');
    h.append(el('span', undefined, `${index + 1} · ${st.title}`));
    p.append(h);
    const body = el('div', 'sz-body');
    body.append(el('p', 'sz-blurb', st.blurb));

    for (const s of st.sliders) {
      const box = el('div', 'sz-ctl');
      const lab = el('div', 'sz-lab');
      const value = el('b');
      lab.append(el('span', undefined, s.label), value);
      const input = el('input');
      input.type = 'range';
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.value = String(design[s.key]);
      const paint = () => {
        const v = Number(input.value);
        value.textContent = s.show(v);
        input.style.setProperty('--pct', `${((v - s.min) / (s.max - s.min)) * 100}%`);
      };
      input.oninput = () => {
        paint();
        this.h.slide(s.key, Number(input.value));
      };
      paint();
      box.append(lab, input);
      if (s.hint) box.append(el('div', 'sz-hint', s.hint));
      body.append(box);
      this.sliders.set(s.key, { input, value, slider: s });
    }

    body.append(el('div', 'sz-sect', 'Checks'), this.checksBox, this.notesBox);
    body.append(el('div', 'sz-sect', 'Size distribution'), this.chart, this.legend);
    body.append(el('div', 'sz-sect', 'Numbers'), this.rowsBox);
    body.append(el('div', 'sz-sect', 'Cost of this station'), this.costBox);
    p.append(body);

    this.nav.innerHTML = '';
    const back = el('button', undefined, '◀ Back');
    back.disabled = index === 0;
    back.onclick = () => this.h.station(index - 1);
    this.nav.append(back);
    if (index < STATIONS.length - 1) {
      const next = el('button', 'sz-go', 'Next station ▶');
      next.onclick = () => this.h.station(index + 1);
      this.nav.append(next);
    } else {
      const go = el('button', 'sz-go', 'Commission the plant');
      go.onclick = () => this.h.commission();
      go.dataset.commission = '1';
      this.nav.append(go);
    }
    p.append(this.nav);
  }

  /** A solve came back: checks, numbers, curves and costs for the open station. */
  update(c: Contract, d: Design, s: Summary, costs: Costs, allPass: boolean) {
    const st = STATIONS[this.current];
    if (!st) return;

    this.checksBox.innerHTML = '';
    for (const k of st.checks(c, d, s)) this.checksBox.append(checkRow(k));

    this.notesBox.innerHTML = '';
    for (const x of s.diagnostics) {
      if (!x.nodeId || !st.nodes.includes(x.nodeId) || x.level === 'info') continue;
      const n = el('div', 'sz-note ' + x.level, x.message);
      this.notesBox.append(n);
    }
    if (!s.converged) {
      const grinding = st.id === 'mill' || st.id === 'cyclones';
      this.notesBox.append(el('div', 'sz-note error', grinding
        ? 'The grinding circuit has no steady state: the mill cannot break what the cyclones send back, so the circulating load grows without end and every number here is where the solve gave up. A bigger mill, or a coarser cut.'
        : 'The circuit did not settle at these settings, so these numbers are where the solve gave up.'));
    }

    this.rowsBox.innerHTML = '';
    for (const r of st.rows(c, d, s)) this.rowsBox.append(row(r));

    const sc = costs.stations[st.id];
    this.costBox.innerHTML = '';
    this.costBox.append(
      row({ label: 'Equipment, installed', value: money(sc.capex) }),
      row({ label: 'Power', value: `${Math.round(sc.kW).toLocaleString('en')} kW` }),
      row({ label: 'Running cost', value: `$${sc.opexPerT.toFixed(2)}/t` }),
    );

    drawChart(this.chart, s, st, c, this.legend);

    const go = this.nav.querySelector<HTMLButtonElement>('[data-commission]');
    if (go) go.disabled = !allPass;

    this.totals.innerHTML = '';
    const tt = el('div', 'sz-body');
    tt.append(
      stat('Capital', money(costs.capex)),
      stat('Operating', `$${costs.opexPerT.toFixed(2)}/t`),
      stat('Power', `${(costs.kW / 1000).toFixed(1)} MW`),
    );
    this.totals.append(tt);
  }

  /** The value a slider shows after the game moved it (a model change clamping a setting). */
  setSlider(key: keyof Design, v: number) {
    const s = this.sliders.get(key);
    if (!s) return;
    s.input.value = String(v);
    s.value.textContent = s.slider.show(v);
    s.input.style.setProperty('--pct', `${((v - s.slider.min) / (s.slider.max - s.slider.min)) * 100}%`);
  }

  showResults(c: Contract, costs: Costs, score: Score, best: Score[], isBest: boolean) {
    const m = this.modal;
    m.innerHTML = '';
    m.classList.remove('hidden');
    const card = el('div', 'sz-panel sz-result');
    card.append(el('em', undefined, 'Commissioned'));
    card.append(el('b', undefined, `Contract ${String(c.seed).padStart(5, '0')} is in spec`));
    const t = el('table', 'sz-rows');
    t.append(
      row({ label: 'Capital cost', value: money(costs.capex) }),
      row({ label: 'Operating cost', value: `$${costs.opexPerT.toFixed(2)}/t  (${money(costs.opexPerYear)} a year)` }),
      row({ label: 'Ten-year cost of ownership', value: money(score.total) }),
    );
    card.append(t);
    if (isBest) card.append(el('p', 'sz-best', 'Your best on this contract.'));
    if (best.length) {
      card.append(el('div', 'sz-sect', 'Best on this contract'));
      const bt = el('table', 'sz-rows');
      best.slice(0, 5).forEach((b, i) => {
        bt.append(row({ label: `${i + 1}. ${new Date(b.at).toLocaleDateString()}`, value: `${money(b.capex)} + $${b.opexPerT.toFixed(2)}/t  →  ${money(b.total)}` }));
      });
      card.append(bt);
    }
    const acts = el('div', 'sz-actions');
    const again = el('button', undefined, 'Improve this plant');
    again.onclick = () => { m.classList.add('hidden'); this.h.replay(); };
    const next = el('button', 'sz-go', 'New contract');
    next.onclick = () => { m.classList.add('hidden'); this.h.newContract(); };
    acts.append(again, next);
    card.append(acts);
    m.append(card);
  }
}

function stat(label: string, value: string): HTMLElement {
  const d = el('div', 'sz-stat');
  d.append(el('span', undefined, label), el('b', undefined, value));
  return d;
}

function row(r: Row): HTMLTableRowElement {
  const tr = el('tr');
  tr.append(el('td', undefined, r.label), el('td', undefined, r.value));
  return tr;
}

function checkRow(k: Check): HTMLElement {
  const d = el('div', 'sz-check ' + (k.ok === null ? 'pending' : k.ok ? 'pass' : 'fail'));
  d.append(el('i'), el('span', undefined, k.label), el('b', undefined, k.value), el('em', undefined, k.limit));
  return d;
}

/** Cumulative passing against size, log scale, for the station's streams. */
function drawChart(cv: HTMLCanvasElement, s: Summary, st: Station, c: Contract, legend: HTMLElement) {
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  const pad = { l: 58, r: 14, t: 14, b: 44 };
  g.clearRect(0, 0, W, H);
  const lines = st.chart.map((l) => ({ ...l, data: s.streams[l.stream] })).filter((l) => l.data?.passing.length);
  // the span of sizes worth showing: from well below the finest P80 to the top of the coarsest
  const p80s = lines.map((l) => l.data!.p80).filter((v) => v > 0);
  const tops = lines.map((l) => l.data!.top).filter((v) => v > 0);
  if (!p80s.length) return;
  const lo = Math.max(1e-5, Math.min(...p80s) / 12);
  const hi = Math.max(...tops) * 1.6;
  const x = (m: number) => pad.l + ((Math.log10(m) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - pad.l - pad.r);
  const y = (f: number) => pad.t + (1 - f) * (H - pad.t - pad.b);

  g.font = '20px ui-monospace, Consolas, monospace';
  g.fillStyle = '#6d7c90';
  g.strokeStyle = 'rgba(139,155,176,0.16)';
  g.lineWidth = 1;
  for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    g.beginPath(); g.moveTo(pad.l, y(f)); g.lineTo(W - pad.r, y(f)); g.stroke();
    g.fillText(`${f * 100}`, 12, y(f) + 7);
  }
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) {
    const m = 10 ** e;
    g.beginPath(); g.moveTo(x(m), pad.t); g.lineTo(x(m), H - pad.b); g.stroke();
    g.fillText(fmt.size(m).replace(' ', ''), x(m) - 24, H - 14);
  }
  // 80% passing
  g.strokeStyle = 'rgba(139,155,176,0.4)';
  g.setLineDash([6, 6]);
  g.beginPath(); g.moveTo(pad.l, y(0.8)); g.lineTo(W - pad.r, y(0.8)); g.stroke();
  const target = st.target?.(c);
  if (target) {
    g.strokeStyle = '#ff5fa2';
    g.beginPath(); g.moveTo(x(target), pad.t); g.lineTo(x(target), H - pad.b); g.stroke();
  }
  g.setLineDash([]);

  legend.innerHTML = '';
  for (const l of lines) {
    const d = l.data!;
    g.strokeStyle = l.colour;
    g.lineWidth = 4;
    g.beginPath();
    let first = true;
    s.sieves.forEach((m, k) => {
      if (m < lo || m > hi) return;
      const px = x(m), py = y(Math.min(1, Math.max(0, d.passing[k])));
      if (first) { g.moveTo(px, py); first = false; } else g.lineTo(px, py);
    });
    g.stroke();
    const item = el('span');
    const sw = el('i');
    sw.style.background = l.colour;
    item.append(sw, document.createTextNode(`${l.label} · P80 ${fmt.size(d.p80)}`));
    legend.append(item);
  }
  if (target) {
    const item = el('span');
    const sw = el('i');
    sw.style.background = '#ff5fa2';
    item.append(sw, document.createTextNode(`Target P80 ${fmt.size(target)}`));
    legend.append(item);
  }
}
