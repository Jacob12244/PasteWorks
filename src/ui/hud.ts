import type { Plant, Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { ORE } from '../sim/upstream';
import {
  SLIDERS, UPSTREAM_SLIDERS, ALL_SLIDERS, SliderSpec,
  bagValue, setBagValue, shown,
} from './setpoints';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, html?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '--');
const money = (n: number) =>
  n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : '$' + Math.round(n).toLocaleString();

export class HUD {
  private ui = document.getElementById('ui')!;
  private banner = document.getElementById('banner')!;
  private sliders = new Map<string, HTMLInputElement>();
  private vals = new Map<string, HTMLElement>();
  private ctls = new Map<string, HTMLElement>();
  private alarmBody!: HTMLElement;
  private alarmCount = -1;
  private inspect!: HTMLElement;
  private inspectTitle!: HTMLElement;
  private inspectBody!: HTMLElement;
  private goalBar!: HTMLElement;
  private goalTxt!: HTMLElement;
  private goalUcs!: HTMLElement;
  private clock!: HTMLElement;
  private runBtn!: HTMLButtonElement;
  private flushBtn!: HTMLButtonElement;
  private siloBtn!: HTMLButtonElement;
  private speedBtns: HTMLButtonElement[] = [];
  private modeBtns: HTMLButtonElement[] = [];
  private upSection!: HTMLElement;
  private deslimeBtn!: HTMLButtonElement;
  private binderBtn!: HTMLButtonElement;
  private mediaBtn!: HTMLButtonElement;
  private kpi = new Map<string, { box: HTMLElement; val: HTMLElement }>();

  /** which unit the inspector is pinned to */
  selectedId: string | null = null;
  onSelect: (id: string | null) => void = () => {};
  onView: (v: 'overview' | 'plant' | 'stope' | 'control') => void = () => {};
  onModeChange: (hard: boolean) => void = () => {};
  /** fired whenever a slider here moves, so the SCADA mirror can follow */
  onSetpoint: () => void = () => {};

  speed = 60;
  private speeds = [0, 1, 10, 60, 240];

  constructor(private plant: Plant, private onReset: () => void) {
    this.build();
    this.setHard(false);
  }

  // --------------------------------------------------------------- building

  private build() {
    this.ui.append(
      this.masthead(),
      this.hint(),
      this.timebar(),
      this.alarms(),
      this.console(),
      this.inspector(),
      this.kpis(),
    );
  }

  private masthead() {
    const p = el('div', 'panel');
    p.id = 'mast';
    const title = el('div', 'title');
    title.append(el('b', undefined, 'PASTEWORKS'), el('span', undefined, 'CPB Plant 01'));
    p.append(title);
    p.append(el('div', 'sub',
      'Cemented paste backfill, surface to stope. Thicken it, filter it, mix it '
      + 'with binder, and push it 1,200&nbsp;m down the hole &mdash; without plugging the line.'));

    const goal = el('div', 'goal');
    const row = el('div', 'row');
    row.innerHTML = '<span>Stope 14-2 North</span>';
    this.goalTxt = el('b', undefined, '0%');
    row.append(this.goalTxt);
    goal.append(row);

    const bar = el('div', 'bar');
    this.goalBar = el('i');
    this.goalBar.style.width = '0%';
    this.goalBar.style.background = 'linear-gradient(90deg, #8a6a3f, var(--paste))';
    bar.append(this.goalBar);
    goal.append(bar);

    this.goalUcs = el('div', 'row');
    this.goalUcs.style.marginTop = '7px';
    goal.append(this.goalUcs);
    p.append(goal);
    return p;
  }

  private hint() {
    const d = el('div');
    d.id = 'hint';
    d.innerHTML = 'Drag to orbit &middot; scroll to zoom &middot; '
      + '<b style="color:var(--cyan)">click any unit</b> to inspect &middot; '
      + '<kbd>Space</kbd> run/stop &middot; <kbd>1</kbd>&ndash;<kbd>5</kbd> speed &middot; <kbd>O</kbd>/<kbd>P</kbd>/<kbd>U</kbd>/<kbd>G</kbd> views &middot; '
      + '<kbd>C</kbd> control room &middot; <kbd>H</kbd> hard mode';
    return d;
  }

  private timebar() {
    const p = el('div', 'panel');
    p.id = 'timebar';
    p.append(el('h2', undefined, '<span>Shift clock</span>'));
    const b = el('div', 'body');

    this.clock = el('div', 'clock', '0.0 h<small>ELAPSED</small>');
    b.append(this.clock);

    const sp = el('div', 'speeds');
    const labels = ['❚❚', '1×', '10×', '60×', '240×'];
    this.speeds.forEach((s, i) => {
      const btn = el('button');
      btn.textContent = labels[i];
      btn.onclick = () => this.setSpeed(s);
      this.speedBtns.push(btn);
      sp.append(btn);
    });
    b.append(sp);

    this.runBtn = el('button', 'run');
    this.runBtn.textContent = '▶  START PLANT';
    this.runBtn.onclick = () => this.toggleRun();
    b.append(this.runBtn);

    const views = el('div', 'speeds');
    views.style.gridTemplateColumns = 'repeat(2, 1fr)';
    for (const [key, label] of [
      ['overview', 'Overview'], ['plant', 'Plant'],
      ['stope', 'Stope'], ['control', 'Control room'],
    ] as const) {
      const btn = el('button');
      btn.textContent = label;
      btn.onclick = () => this.onView(key);
      views.append(btn);
    }
    b.append(views);

    p.append(b);
    return p;
  }

  private alarms() {
    const p = el('div', 'panel');
    p.id = 'alarms';
    p.append(el('h2', undefined, '<span>Alarm &amp; event log</span>'));
    this.alarmBody = el('div', 'body');
    p.append(this.alarmBody);
    return p;
  }

  private console() {
    const p = el('div', 'panel');
    p.id = 'console';
    p.append(el('h2', undefined, '<span>Operator console</span><span style="color:var(--muted)">SETPOINTS</span>'));
    const b = el('div', 'body');

    // ---- difficulty -------------------------------------------------------
    const modes = el('div', 'speeds');
    modes.style.gridTemplateColumns = '1fr 1fr';
    modes.style.marginBottom = '12px';
    for (const [hard, label] of [[false, 'Standard'], [true, 'Hard mode']] as const) {
      const btn = el('button');
      btn.textContent = label;
      btn.onclick = () => this.setHard(hard);
      this.modeBtns.push(btn);
      modes.append(btn);
    }
    b.append(modes);

    // ---- upstream circuit, hard mode only ---------------------------------
    this.upSection = el('div');
    const upHead = el('div', 'sect',
      'Upstream circuit<em>mill &middot; flotation &middot; cyclones</em>');
    this.upSection.append(upHead);
    for (const s of UPSTREAM_SLIDERS) this.upSection.append(this.slider(s));

    const upToggles = el('div', 'actions');
    this.deslimeBtn = el('button');
    this.deslimeBtn.onclick = () => {
      this.plant.up.deslime = !this.plant.up.deslime;
    };
    upToggles.append(this.deslimeBtn);

    this.binderBtn = el('button');
    this.binderBtn.onclick = () => {
      this.plant.up.binderType = this.plant.up.binderType === 'opc' ? 'slag' : 'opc';
    };
    upToggles.append(this.binderBtn);

    this.upSection.append(upToggles);
    b.append(this.upSection);

    // ---- backfill plant ---------------------------------------------------
    b.append(el('div', 'sect', 'Backfill plant<em>thickener to stope</em>'));
    for (const s of SLIDERS) b.append(this.slider(s));

    // Both deliveries together. They are the same job - ring the supplier -
    // and splitting them across two sections of the console was why running
    // out of balls kept coming as a surprise.
    const act = el('div', 'actions');
    this.siloBtn = el('button');
    this.siloBtn.onclick = () => this.plant.refillSilo();
    act.append(this.siloBtn);

    this.mediaBtn = el('button');
    this.mediaBtn.onclick = () => this.plant.orderMedia();
    act.append(this.mediaBtn);

    this.flushBtn = el('button', 'warn');
    this.flushBtn.textContent = 'Flush line';
    this.flushBtn.style.gridColumn = '1 / -1';
    this.flushBtn.onclick = () => this.plant.clearBlockage();
    act.append(this.flushBtn);

    const reset = el('button');
    reset.textContent = 'Reset shift';
    reset.style.gridColumn = '1 / -1';
    reset.onclick = () => { this.onReset(); this.syncSliders(); };
    act.append(reset);

    b.append(act);
    p.append(b);
    return p;
  }

  /** Build one labelled slider bound to whichever setpoint bag it belongs to. */
  private slider(s: SliderSpec): HTMLElement {
    const c = el('div', 'ctl');
    const lab = el('div', 'lab');
    lab.append(el('span', undefined, s.label));
    const v = el('b');
    lab.append(v);
    c.append(lab);

    const input = el('input');
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(bagValue(this.plant, s));
    input.oninput = () => {
      setBagValue(this.plant, s, parseFloat(input.value));
      this.paintSlider(s, input, v);
      this.onSetpoint();
    };
    c.append(input);
    c.append(el('div', 'hint', s.hint));

    this.sliders.set(s.key, input);
    this.vals.set(s.key, v);
    this.ctls.set(s.key, c);
    this.paintSlider(s, input, v);
    return c;
  }

  setHard(hard: boolean) {
    this.plant.hardMode = hard;
    this.upSection.style.display = hard ? '' : 'none';
    this.modeBtns[0].classList.toggle('on', !hard);
    this.modeBtns[1].classList.toggle('on', hard);
    this.onModeChange(hard);
  }

  private paintSlider(s: SliderSpec, input: HTMLInputElement, v: HTMLElement) {
    const raw = parseFloat(input.value);
    const pct = ((raw - s.min) / (s.max - s.min)) * 100;
    input.style.setProperty('--pct', pct + '%');
    v.textContent = shown(s, raw);
  }

  /** Pull every slider back from the plant - after a reset, or a SCADA edit. */
  syncSliders() {
    for (const s of ALL_SLIDERS) {
      const input = this.sliders.get(s.key)!;
      input.value = String(bagValue(this.plant, s));
      this.paintSlider(s, input, this.vals.get(s.key)!);
    }
  }

  private inspector() {
    const p = el('div', 'panel hidden');
    p.id = 'inspect';
    const h = el('h2');
    this.inspectTitle = el('span', undefined, '');
    const x = el('span', 'x', '✕');
    x.onclick = () => this.onSelect(null);
    h.append(this.inspectTitle, x);
    p.append(h);
    this.inspectBody = el('div', 'body');
    p.append(this.inspectBody);
    this.inspect = p;
    return p;
  }

  private kpis() {
    const d = el('div');
    d.id = 'kpis';
    for (const [key, label] of [
      ['status', 'Plant'],
      ['rate', 'Placement'],
      ['ucs', '28 d UCS'],
      ['press', 'Discharge'],
      ['vel', 'Line vel'],
      ['cost', 'Unit cost'],
      ['blk', 'Blockages'],
    ] as const) {
      const k = el('div', 'k');
      k.append(el('em', undefined, label));
      const v = el('b', undefined, '--');
      k.append(v);
      d.append(k);
      this.kpi.set(key, { box: k, val: v });
    }
    return d;
  }

  // ---------------------------------------------------------------- actions

  setSpeed(s: number) {
    this.speed = s;
    this.speeds.forEach((v, i) => this.speedBtns[i].classList.toggle('on', v === s));
  }

  toggleRun() {
    if (this.plant.telemetry.pipe.plugged) { this.plant.clearBlockage(); return; }
    this.plant.sp.running = !this.plant.sp.running;
    if (this.plant.sp.running && this.speed === 0) this.setSpeed(60);
  }

  /** The control room takes the screen over; the side panels get out of the way. */
  setPanelsVisible(on: boolean) {
    this.ui.style.display = on ? '' : 'none';
  }

  showBanner(title: string, sub: string, colour: string) {
    this.banner.innerHTML = '';
    const b = el('b', undefined, title);
    b.style.color = colour;
    b.style.textShadow = '0 0 28px ' + colour + '66';
    this.banner.append(b, el('span', undefined, sub));
    this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), 4200);
  }

  // ----------------------------------------------------------------- update

  update(t: Telemetry, selectedName: string | null) {
    // ---- goal
    this.goalBar.style.width = Math.min(100, t.stope.pct) + '%';
    this.goalTxt.textContent = f(t.stope.pct, 1) + '%   ('
      + f(t.stope.volume, 0) + ' / ' + DESIGN.stopeVolume + ' m³)';
    const ucsOk = t.stope.avgUcs >= DESIGN.targetUcs;
    this.goalUcs.innerHTML =
      '<span>Placed strength &middot; target ' + DESIGN.targetUcs + ' kPa</span>'
      + '<b style="color:' + (t.stope.pct < 0.5 ? 'var(--muted)' : ucsOk ? 'var(--lime)' : 'var(--amber)')
      + '">' + f(t.stope.avgUcs, 0) + ' kPa</b>';

    // ---- clock
    const h = t.time / 3600;
    this.clock.innerHTML = f(h, 1) + ' h<small>'
      + (this.speed === 0 ? 'PAUSED' : 'RUNNING AT ' + this.speed + '×') + '</small>';

    // ---- run button
    const plugged = t.pipe.plugged;
    this.runBtn.className = plugged ? 'stop' : t.status === 'idle' ? 'run' : 'stop';
    this.runBtn.textContent = plugged ? '⚠  FLUSH THE LINE'
      : this.plant.sp.running ? '■  STOP PLANT' : '▶  START PLANT';
    this.flushBtn.disabled = !plugged;

    // ---- deliveries, both in one place
    this.siloBtn.textContent = 'Order binder  ·  silo ' + f(t.silo.pct, 0) + '%';
    this.siloBtn.disabled = t.silo.pct > 97;
    this.siloBtn.classList.toggle('warn', t.silo.pct < 12);
    const hard = this.plant.hardMode;
    this.mediaBtn.textContent = hard
      ? 'Order balls  ·  hopper ' + f(t.media.pct, 0) + '%'
      : 'Order balls  ·  standard mode';
    this.mediaBtn.disabled = !hard || t.media.pct > 97;
    this.mediaBtn.classList.toggle('warn', hard && t.media.pct < 20);

    // ---- upstream toggles
    const up = this.plant.up;
    this.deslimeBtn.textContent = up.deslime ? 'Deslime: IN circuit' : 'Deslime: bypassed';
    this.deslimeBtn.classList.toggle('on', up.deslime);
    this.binderBtn.textContent = up.binderType === 'slag' ? 'Binder: slag blend' : 'Binder: OPC';
    this.binderBtn.classList.toggle('on', up.binderType === 'slag');
    this.ctls.get('cyclonePressure')!.style.opacity = up.deslime ? '1' : '0.35';
    this.ctls.get('frother')!.classList.toggle('flag',
      t.upstream.sulphide > 0.9 && up.binderType === 'opc');
    this.ctls.get('millFeed')!.classList.toggle('flag',
      t.upstream.solids < t.upstream.plantCapacity * 0.92);

    // flag setpoints that are being over-ridden by physics
    this.ctls.get('ufCw')!.classList.toggle('flag', this.plant.sp.ufCw > t.thickener.maxUfCw + 0.002);
    this.ctls.get('targetSlump')!.classList.toggle('flag', t.mixer.waterLimited);
    this.ctls.get('strokeRate')!.classList.toggle('flag', t.pump.starved || t.pump.pressureLimited);

    // ---- kpis
    this.setKpi('status',
      t.status === 'blocked' ? 'PLUGGED' : t.status.toUpperCase(),
      t.status === 'blocked' ? 'bad' : t.status === 'starved' ? 'warn'
        : t.status === 'idle' ? '' : 'ok');
    this.setKpi('rate', f(t.pump.flow, 0) + ' m³/h', t.pump.starved ? 'warn' : '');
    this.setKpi('ucs', f(t.mixer.ucs, 0) + ' kPa',
      t.mixer.ucs >= DESIGN.targetUcs ? 'ok' : 'warn');
    this.setKpi('press', f(t.pump.pressure / 100, 0) + ' bar',
      t.pump.pressureLimited ? 'bad' : t.pump.pressurePct > 85 ? 'warn' : 'ok');
    this.setKpi('vel', f(t.pipe.velocity, 2) + ' m/s', '');
    this.setKpi('cost', t.stope.volume > 1 ? '$' + f(t.cost.perM3, 2) + '/m³' : money(t.cost.total),
      t.cost.perM3 > 18 ? 'warn' : t.stope.volume > 1 ? 'ok' : '');
    this.setKpi('blk', String(t.blockages), t.blockages > 0 ? 'bad' : 'ok');

    // ---- alarms
    if (t.alarms.length !== this.alarmCount) {
      this.alarmCount = t.alarms.length;
      this.alarmBody.innerHTML = '';
      for (const a of t.alarms.slice(0, 24)) {
        const row = el('div', 'al ' + a.level);
        row.append(el('time', undefined, f(a.at / 3600, 1) + 'h'));
        row.append(el('span', undefined, a.text));
        this.alarmBody.append(row);
      }
    }

    // ---- inspector
    if (this.selectedId) {
      this.inspect.classList.remove('hidden');
      this.inspectTitle.textContent = selectedName ?? '';
      this.renderInspect(t, this.selectedId);
    } else {
      this.inspect.classList.add('hidden');
    }
  }

  private setKpi(key: string, value: string, cls: string) {
    const k = this.kpi.get(key)!;
    k.val.textContent = value;
    k.box.className = 'k ' + cls;
  }

  private renderInspect(t: Telemetry, id: string) {
    const rows: Array<[string, string]> = [];
    let note = '';

    switch (id) {
      case 'upstream': {
        const u = t.upstream;
        if (!u.hard) {
          rows.push(['Mode', 'Standard - the tailings are given to you']);
          note = 'Switch to hard mode and the mill, the flotation bank and the '
            + 'deslime cyclones become yours to set. The particle size and the '
            + 'sulphide content they produce reach all the way to the stope.';
          break;
        }
        rows.push(
          ['Mill feed', f(this.plant.up.millFeed, 0) + ' t/h ore'],
          ['Mill power', f(u.millPower, 0) + ' kW of ' + ORE.millPowerKw + ' installed'],
          ['Specific energy', f(u.specificEnergy, 1) + ' kWh/t  (Wi '
            + f(u.workIndex, 1) + ')'],
          ['Ball charge', f(t.media.health * 100, 0) + '% condition'
            + (t.media.starved ? '  — RUNNING DOWN' : '')],
          ['Ball hopper', f(t.media.stock, 1) + ' t of ' + ORE.hopperCap
            + '  (' + (Number.isFinite(t.media.hoursLeft)
              ? f(t.media.hoursLeft, 0) + ' h left)' : 'idle)')],
          ['Media draw', f(t.media.draw, 2) + ' t/h  ·  ' + money(t.cost.media) + ' spent'],
          ['Grind P80', f(u.p80, 0) + ' µm'],
          ['Liberation', f(u.liberation * 100, 0) + '% of the sulphide is floatable'],
          ['Flotation recovery', f(u.sulphideRecovery * 100, 1) + '%'],
          ['Mass pull', f(u.massPull, 2) + '%  (' + f(u.concentrate, 0) + ' t/h conc)'],
          ['Tailings sulphur', f(u.sulphide, 2) + '% S'],
          ['Solids SG', f(u.sg, 3)],
          ['Deslime', this.plant.up.deslime
            ? 'in circuit, d50c ' + f(u.d50c, 1) + ' µm' : 'bypassed'],
          ['To backfill', f(u.solids, 0) + ' t/h  (plant takes ' + u.plantCapacity + ')'],
          ['Rejected to TSF', f(u.toTsf + u.bypassToTsf, 0) + ' t/h'],
          ['Tailings < 20 µm', f(u.fines20 * 100, 1) + '%'],
          ['— press capacity', '×' + f(u.effects.filterCapacity, 2)],
          ['— cake moisture', '×' + f(u.effects.cakeMoisture, 2)],
          ['— yield stress', '×' + f(u.effects.yieldStress, 2)],
          ['— 28 d strength', '×' + f(u.effects.ucs, 2)],
          ['Circuit power', money(t.cost.upstream) + ' spent'],
        );
        note = t.media.starved || t.media.health < 0.9
          ? 'The ball hopper is empty, so the charge is running down. The mill '
            + 'draws less power and loses its top size, the product creeps '
            + 'coarser, and coarse ore does not liberate - the sulphide walks '
            + 'out with the tailings and attacks the binder. Order media.'
          : u.sulphide > 0.9 && u.binderType === 'opc'
          ? 'Sulphide is attacking the binder. Either lift the frother to float '
            + 'more of it out, or move to a slag blend that resists it — the slag '
            + 'costs $175/t against $148/t for OPC.'
          : 'Fines are the whole story. Every extra percent below 20 µm holds '
            + 'water in the cake, raises yield stress at the same solids, and '
            + 'costs binder to make up the strength. Desliming buys all of that '
            + 'back and throws away the tonnes you were going to fill with.';
        break;
      }
      case 'thickener': {
        const th = t.thickener;
        rows.push(
          ['Feed', f(t.feed.solids, 0) + ' t/h dry @ ' + f(t.upstream.cw * 100, 0) + '%'],
          ['Tailings P80', f(t.upstream.p80, 0) + ' µm, '
            + f(t.upstream.fines20 * 100, 0) + '% < 20 µm'],
          ['Underflow', f(th.underflow.solids, 0) + ' t/h @ ' + f(th.ufCw * 100, 1) + '% Cw'],
          ['Max U/F at this floc', f(th.maxUfCw * 100, 1) + '%'],
          ['Bed inventory', f(th.bed, 0) + ' t  (' + f(th.bedPct, 0) + '%)'],
          ['Rise rate', f(th.riseRate, 2) + ' / ' + f(th.riseLimit, 2) + ' m/h'],
          ['Rake torque', f(th.torque, 0) + '%'],
          ['Overflow clarity', f(th.overflowClarity, 0) + ' mg/L'],
          ['Solids to overflow', f(th.overflow.solids, 1) + ' t/h'],
        );
        note = 'Rise rate above the settling flux floats the bed and you lose solids '
          + 'over the launder. More flocculant raises both the flux and the density '
          + 'you can pull — up to a point, and it is not cheap.';
        break;
      }
      case 'surge':
        rows.push(
          ['Contents', f(t.ufTank.volume, 0) + ' m³ of ' + DESIGN.ufTankVol],
          ['Level', f(t.ufTank.pct, 0) + '%'],
          ['Density', f(t.ufTank.cw * 100, 1) + '% solids'],
        );
        note = 'The buffer that lets the thickener and the press run at different '
          + 'rates. Empty it and the press starves; fill it and the bed builds.';
        break;
      case 'press': {
        const fl = t.filter;
        rows.push(
          ['Cycle time', f(fl.cycleTime, 1) + ' min'],
          ['Capacity', f(fl.capacity, 0) + ' t/h dry'],
          ['Throughput', f(fl.throughput, 0) + ' t/h dry'],
          ['Utilisation', f(fl.utilisation, 0) + '%'],
          ['Cake moisture', f(fl.cakeMoisture, 1) + '%'],
          ['Cake solids', f((1 - fl.cakeMoisture / 100) * 100, 1) + '% Cw'],
          ['Filtrate', f(fl.filtrate.water, 0) + ' t/h to process water'],
        );
        note = 'Capacity falls as 1/√(cycle time) while cake moisture falls with it. '
          + 'Drier cake is the only way to reach a high-strength paste — but a long '
          + 'cycle will not keep the pump fed.';
        break;
      }
      case 'cakebin':
        rows.push(
          ['Inventory', f(t.cakeBin.mass, 0) + ' t wet of ' + DESIGN.cakeBinCap],
          ['Level', f(t.cakeBin.pct, 0) + '%'],
          ['Cake solids', f(t.cakeBin.cw * 100, 1) + '% Cw'],
          ['Belt', t.filter.throughput > 0.5 ? 'running' : 'stopped'],
        );
        note = 'Cake solids here set the ceiling on paste density — you can add '
          + 'water at the mixer, never take it out.';
        break;
      case 'silo':
        rows.push(
          ['Inventory', f(t.silo.mass, 0) + ' t of ' + DESIGN.siloCap],
          ['Draw rate', f(t.silo.feedRate, 2) + ' t/h'],
          ['Dose', f(t.mixer.binderDose, 2) + '% of dry tails'],
          ['Binder spend', money(t.cost.binder)],
          ['Hours to empty', t.silo.feedRate > 0.01 ? f(t.silo.mass / t.silo.feedRate, 1) + ' h' : '—'],
        );
        note = 'Binder is the dominant operating cost and the only real lever on '
          + 'strength. Over-dosing a whole stope is an expensive way to be safe.';
        break;
      case 'mixer': {
        const m = t.mixer;
        rows.push(
          ['Paste solids', f(m.cw * 100, 1) + '% Cw  /  ' + f(m.cv * 100, 1) + '% Cv'],
          ['Density', f(m.density, 3) + ' t/m³'],
          ['Yield stress', f(m.yieldStress, 0) + ' Pa'],
          ['Plastic viscosity', f(m.viscosity, 3) + ' Pa·s'],
          ['Slump (Boger cylinder)', f(m.slump, 0) + ' mm'
            + (m.waterLimited ? '  (water limited)' : '')],
          ['— Abrams cone equivalent', f(m.cone, 0) + ' mm'],
          ['Binder dose', f(m.binderDose, 2) + '%'],
          ['Mix water', f(m.mixWater, 1) + ' m³/h'],
          ['Predicted UCS', f(m.ucs, 0) + ' kPa at 28 d'],
        );
        note = m.waterLimited
          ? 'The cake is already drier than this slump target needs. Shorten the '
            + 'press cycle for wetter cake, or ask for a stiffer paste.'
          : 'Slump is the yield stress read off a 200 mm cylinder, via Boger '
            + '(Pashias et al. 1996). The cylinder is what a paste plant '
            + 'actually measures - it is repeatable on a stiff paste where a '
            + 'cone is not, and it inverts straight back to a rheology.';
        break;
      }
      case 'pump': {
        const p = t.pump;
        rows.push(
          ['Flow', f(p.flow, 1) + ' m³/h  (demand ' + f(p.demand, 0) + ')'],
          ['Stroke rate', f(p.strokesPerMin, 1) + ' /min'],
          ['Discharge', f(p.pressure / 100, 1) + ' bar of ' + f(DESIGN.pumpMaxPressure / 100, 0)],
          ['Loading', f(p.pressurePct, 0) + '% of rating'],
          ['Line will take', f(p.flowCeiling, 0) + ' m³/h at the rating'],
          ['Shaft power', f(p.power, 0) + ' kW'],
          ['Feed', p.starved ? 'STARVED' : 'adequate'],
        );
        note = p.pressureLimited
          ? 'Pressure limited. The paste is too stiff for this line, so the pump '
            + 'is holding at its rating and delivering only ' + f(p.flowCeiling, 0)
            + ' m³/h. Raise the slump target before the column sets up.'
          : 'A twin-cylinder positive-displacement pump delivers whatever the '
            + 'line asks for until it hits the pressure rating — then it simply '
            + 'stops moving paste, and the line sets up.';
        break;
      }
      case 'pipeline': {
        const p = t.pipe;
        rows.push(
          ['Bore', f(DESIGN.pipeId - p.wallLossMm * 2, 1) + ' mm  (' + f(DESIGN.pipeId, 0) + ' new)'],
          ['Developed length', f(DESIGN.pipeLength, 0) + ' m'],
          ['Vertical drop', f(DESIGN.pipeDrop, 0) + ' m'],
          ['Velocity', f(p.velocity, 2) + ' m/s  (' + p.regime + ')'],
          ['Wall shear', f(p.wallShear, 0) + ' Pa'],
          ['Friction gradient', f(p.gradient, 2) + ' kPa/m'],
          ['Friction loss', f(p.friction, 0) + ' kPa'],
          ['Static recovery', '−' + f(p.staticRecovery, 0) + ' kPa'],
          ['Net pump duty', f(p.pumpPressure, 0) + ' kPa'],
          ['Reynolds / Hedström', f(p.reynolds, 0) + ' / ' + f(p.hedstrom, 0)],
          ['Wall loss', f(p.wallLossMm, 2) + ' mm'],
          ['Plug risk', f(p.plugRisk * 100, 0) + '%'],
        );
        note = p.chokeRequired
          ? 'The 250 m drop is giving back more head than friction is taking. The '
            + 'column would run away on its own — the choke at the collar is holding it.'
          : 'Solved with the Buckingham equation for a Bingham plastic. The vertical '
            + 'drop returns ' + f(p.staticRecovery, 0) + ' kPa of static head, which is '
            + 'the only reason a 1,200 m paste line is possible at all.';
        break;
      }
      case 'stope': {
        const s = t.stope;
        rows.push(
          ['Placed', f(s.volume, 0) + ' m³  (' + f(s.pct, 1) + '%)'],
          ['Tonnes', f(s.tonnesPlaced, 0) + ' t'],
          ['Binder placed', f(s.binderPlaced, 1) + ' t'],
          ['Average UCS', f(s.avgUcs, 0) + ' kPa'],
          ['Weakest lift', f(s.minUcs, 0) + ' kPa'],
          ['Unit cost', s.volume > 1 ? '$' + f(t.cost.perM3, 2) + '/m³' : '—'],
          ['Binder / floc / power', money(t.cost.binder) + ' / ' + money(t.cost.floc) + ' / ' + money(t.cost.power)],
        );
        note = 'The stope has to stand up when the pillar beside it is mined. '
          + 'Average strength is what gets signed off, but the weakest lift is what '
          + 'actually fails.';
        break;
      }
      case 'water':
        rows.push(
          ['Thickener overflow', f(t.thickener.overflow.water, 0) + ' t/h'],
          ['Filtrate', f(t.filter.filtrate.water, 0) + ' t/h'],
          ['Mixer make-up', f(t.mixer.mixWater, 1) + ' m³/h'],
          ['Raw water spend', money(t.cost.water)],
        );
        note = 'Almost all the water taken out at the thickener and the press goes '
          + 'back to the mill. What the mixer adds is the only real consumption.';
        break;
    }

    this.inspectBody.innerHTML = '';
    const table = el('table');
    for (const [k, v] of rows) {
      const tr = el('tr');
      tr.append(el('td', undefined, k), el('td', undefined, v));
      table.append(tr);
    }
    this.inspectBody.append(table);
    if (note) this.inspectBody.append(el('div', 'note', note));
  }
}
