/**
 * The plant: unit operations, inventories and the tick loop.
 *
 * Flow is PULL driven from the paste pump backwards, because that is how a
 * backfill plant actually behaves - the stope calls for paste, and every
 * buffer upstream either keeps up or runs you dry.
 *
 *   mill tails -> thickener -> U/F surge tank -> plate press -> cake bin
 *                                                                  |
 *                                          binder silo ---> mixer <+
 *                                          mix water  --->   |
 *                                                       paste pump -> borehole -> stope
 */

import {
  Stream, stream, EMPTY,
  Cw, Cv, volFlow, totalMass, slurryDensity, binderDose,
  clamp, approach, setSolidsSG, RHO_SOLIDS, RHO_WATER,
} from './streams';
import {
  yieldStress, plasticViscosity, slump, coneSlump, pipeline, ucs28, wearRate,
  PipeResult,
} from './rheology';
import {
  upstream, feedEffects, upstreamCost, mediaDraw, ORE,
  UpstreamSetpoints, DEFAULT_UPSTREAM, FeedSpec, FeedEffects,
  BinderType,
} from './upstream';

export type AlarmLevel = 'info' | 'warn' | 'trip';

export interface Alarm {
  id: string;
  level: AlarmLevel;
  text: string;
  at: number;
}

/** Everything the player can turn. */
export interface Setpoints {
  /** thickener underflow solids target, mass fraction */
  ufCw: number;
  /** flocculant dose, g per tonne of dry solids */
  flocDose: number;
  /** plate press cycle time, minutes */
  cycleTime: number;
  /** binder dose, % of dry tailings mass */
  binderDose: number;
  /** paste slump target at the mixer discharge, mm on the Boger cylinder */
  targetSlump: number;
  /** paste pump stroke rate, % of rated */
  strokeRate: number;
  /** master run/stop */
  running: boolean;
}

export const DEFAULT_SETPOINTS: Setpoints = {
  ufCw: 0.63,
  flocDose: 22,
  cycleTime: 6,
  binderDose: 5.0,
  targetSlump: 125,
  strokeRate: 62,
  running: false,
};

/** Fixed design data for this plant. */
export const DESIGN = {
  millSolids: 180,          // t/h dry tailings delivered to the backfill plant
  millCw: 0.32,             // as-received solids concentration
  thickenerDia: 18,         // m
  thickenerBedMax: 900,     // t dry solids the bed holds before it is choked
  ufTankVol: 260,           // m3
  filterArea: 120,          // m2 of plate press cloth
  cakeBinCap: 320,          // t of wet cake
  siloCap: 420,             // t of binder
  pumpMaxFlow: 190,         // m3/h at 100% stroke
  pumpMaxPressure: 12000,   // kPa (120 bar) rated discharge
  pipeId: 150,              // mm internal diameter
  pipeLength: 1200,         // m developed length: surface, borehole, level
  pipeDrop: 250,            // m vertical drop to the stope
  pipeWallMm: 12.7,         // mm wall, wear allowance
  stopeVolume: 6000,        // m3 to fill - stope 14-2 North
  targetUcs: 1000,          // kPa at 28 days
  costBinder: 148,          // $/t
  costFloc: 4200,           // $/t
  costPowerKwh: 0.11,       // $/kWh
  costWater: 0.35,          // $/m3 raw make-up
  auxPowerKw: 640,          // rakes, press pumps, mixer, compressors
  plantCapacity: 200,       // t/h dry the backfill plant is designed to take
  pwTankVol: 150,           // m3 process water tank
  millReturnCap: 330,       // m3/h of recovered water the mill will take back
  costSpill: 150,           // $/m3 spilled - clean-up, reporting, lost time
  /** m/s2 - only the pipeline's static head sees it; the slump test is a lab test at 1 g */
  gravity: 9.81,
  /**
   * Strength actually developed, as a fraction of the 20 degC laboratory
   * number. Cement hydration slows in the cold, and at 2 degC it is well
   * behind - the maturity effect.
   */
  cureFactor: 1,
  /** slag blend price relative to ordinary portland */
  slagPremium: 175 / 148,
  /**
   * $/m3 for the water that leaves locked inside the placed fill and never
   * comes back. On a mine with dewatering to spare it is free, which is why
   * the baseline carries zero. Where water had to be shipped in or dug out,
   * it is the biggest line on the bill - and it is what makes a stiffer,
   * drier paste worth the trouble.
   */
  costWaterLost: 0,
  /** thickener, cyclone bank, decanter centrifuge, or nothing at all (dry feed) */
  dewater: 'thickener' as Dewater,
  /** $/t of solids that leave with a cyclone or centrifuge overflow */
  costPlume: 0,
  /** kW the dewatering machines draw on top of the rest of the plant */
  dewaterPowerKw: 0,
  /** % moisture of a dry feed as it goes into the bin */
  dryMoisture: 8,
};

/** How the tailings lose their water before the mixer. */
export type Dewater = 'thickener' | 'cyclones' | 'centrifuge' | 'dry';

/**
 * The words the plant uses about its own site. The sim is the same machine
 * wherever it is standing; what it spills onto, and what it is filling, are
 * not.
 */
export const SITE_TEXT = {
  done: 'Stope full - placement complete',
  spillTo: 'the pad',
  /** what the consumable is: "Ball hopper" / "Hammer store" */
  media: 'Ball hopper',
  mediaThing: 'grinding media',
  delivery: 'by tanker',
};

export interface Telemetry {
  time: number;
  feed: Stream;

  thickener: {
    bed: number; bedPct: number;
    ufCw: number; maxUfCw: number;
    riseRate: number; riseLimit: number;
    torque: number;
    overflowClarity: number;
    underflow: Stream; overflow: Stream;
    rakeAngle: number;
  };

  ufTank: { volume: number; pct: number; cw: number };

  /** the circuit that made the tailings, and what its PSD does downstream */
  upstream: FeedSpec & {
    hard: boolean;
    binderType: BinderType;
    effects: FeedEffects;
    bypassToTsf: number;
    plantCapacity: number;
  };

  water: {
    volume: number; pct: number;
    recovered: number; toMill: number; makeUp: number;
    returnCap: number;
  };

  /** the grinding media the mill eats, and what it does when you run out */
  media: {
    /** tonnes of balls left in the charging hopper */
    stock: number;
    pct: number;
    /** t/h being worn away */
    draw: number;
    /** ball charge condition, 1 = fully charged, 0 = run right down */
    health: number;
    /** true while the hopper is empty and the charge is degrading */
    starved: boolean;
    hoursLeft: number;
  };

  /** live spill rates the 3D scene turns into particles */
  spills: {
    water: number;    // m3/h over the process water tank rim
    slurry: number;   // m3/h over the U/F surge tank rim
    launder: number;  // t/h of solids over the thickener launder
    leak: number;     // 0..1 severity at the borehole collar
    totalM3: number;  // cumulative
  };

  filter: {
    cycleTime: number;
    cakeMoisture: number;
    capacity: number; throughput: number; utilisation: number;
    cake: Stream; filtrate: Stream;
    cyclePhase: number; pressing: boolean;
  };

  cakeBin: { mass: number; pct: number; cw: number };
  silo: { mass: number; pct: number; feedRate: number };

  mixer: {
    paste: Stream;
    cw: number; cv: number; density: number;
    yieldStress: number; viscosity: number; slump: number; cone: number;
    binderDose: number; mixWater: number;
    waterLimited: boolean; slumpAchieved: number;
    ucs: number;
    paddleAngle: number;
  };

  pump: {
    flow: number; demand: number;
    pressure: number; pressurePct: number;
    /** true when the line will not take the stroke demand at the rated pressure */
    pressureLimited: boolean;
    /** the most the line will take at the pump rating, m3/h */
    flowCeiling: number;
    strokePhase: number; strokesPerMin: number;
    starved: boolean; power: number;
  };

  pipe: PipeResult & {
    chokeRequired: boolean;
    wallLossMm: number;
    plugged: boolean;
    plugRisk: number;
    staticMinutes: number;
  };

  stope: {
    volume: number; pct: number;
    tonnesPlaced: number; binderPlaced: number;
    avgUcs: number; minUcs: number;
  };

  cost: {
    binder: number; floc: number; power: number; water: number; spill: number;
    upstream: number; media: number;
    total: number; perM3: number;
  };

  alarms: Alarm[];
  blockages: number;
  status: 'idle' | 'running' | 'starved' | 'blocked' | 'complete';
}

/** Slurry density from a solids concentration, t/m3. */
function densityFromCw(cw: number, sg = RHO_SOLIDS): number {
  const c = clamp(cw, 0, 0.95);
  if (c <= 1e-9) return RHO_WATER;
  return 1 / (c / sg + (1 - c) / RHO_WATER);
}

export class Plant {
  sp: Setpoints = { ...DEFAULT_SETPOINTS };
  up: UpstreamSetpoints = { ...DEFAULT_UPSTREAM };
  /** hard mode hands you the mill, the flotation bank and the cyclones too */
  hardMode = false;

  // --- inventories -------------------------------------------------------
  private bed = 220;        // t dry in the thickener bed
  private ufVol = 90;       // m3 in the underflow surge tank
  private ufCwActual = 0.60;
  private cakeMass = 40;    // t wet cake in the bin
  private cakeMoist = 17;   // % moisture of the cake currently in the bin
  private siloMass = 380;   // t binder
  private stopeVol = 0;
  private stopeTonnes = 0;
  private stopeBinder = 0;
  private ucsSum = 0;
  private ucsMin = Infinity;
  /** last tick's cake draw, t/h wet - the press runs level control against it */
  private lastCakeDraw = 0;
  private mediaStock = ORE.hopperCap * 0.6875;  // t in the hopper - 11 of 16 on a ball mill
  private mediaHealth = 1;  // ball charge condition, 0..1
  private pwVol = 80;       // m3 in the process water tank
  private spilledM3 = 0;    // cumulative spill to the pad
  private feedSpec!: FeedSpec;
  /** feed the plant could not take this tick, sent back where it came from */
  private lastExcess = 0;
  private feedFx!: FeedEffects;

  // --- smoothed / animated state ----------------------------------------
  private t = 0;
  private rakeAngle = 0;
  private paddleAngle = 0;
  private strokePhase = 0;
  private cyclePhase = 0;
  private smPressure = 0;
  private smFlow = 0;
  private torque = 45;
  private wallLoss = 0;
  private staticSeconds = 0;
  private plugRisk = 0;
  plugged = false;
  blockages = 0;

  private cost = {
    binder: 0, floc: 0, power: 0, water: 0, spill: 0, upstream: 0, media: 0,
  };
  alarms: Alarm[] = [];
  private alarmSeen = new Map<string, number>();
  private active = new Set<string>();

  telemetry!: Telemetry;

  constructor() {
    // a machine with no bed starts where it is set, not where a thickener would be
    if (DESIGN.dewater !== 'thickener') this.ufCwActual = this.sp.ufCw;
    this.step(0);
  }

  reset() {
    this.bed = 220; this.ufVol = 90;
    this.ufCwActual = DESIGN.dewater !== 'thickener' ? DEFAULT_SETPOINTS.ufCw : 0.60;
    this.cakeMass = 40; this.cakeMoist = 17; this.siloMass = 380;
    this.stopeVol = 0; this.stopeTonnes = 0; this.stopeBinder = 0;
    this.ucsSum = 0; this.ucsMin = Infinity; this.lastCakeDraw = 0;
    this.t = 0; this.wallLoss = 0; this.staticSeconds = 0; this.plugRisk = 0;
    this.plugged = false; this.blockages = 0;
    this.smPressure = 0; this.smFlow = 0; this.torque = 45;
    this.cost = {
      binder: 0, floc: 0, power: 0, water: 0, spill: 0, upstream: 0, media: 0,
    };
    this.mediaStock = ORE.hopperCap * 0.6875; this.mediaHealth = 1; this.lastExcess = 0;
    this.pwVol = 80; this.spilledM3 = 0;
    this.alarms = []; this.alarmSeen.clear(); this.active.clear();
    this.sp = { ...DEFAULT_SETPOINTS };
    this.step(0);
  }

  refillSilo() {
    const added = DESIGN.siloCap - this.siloMass;
    if (added < 1) return;
    this.siloMass = DESIGN.siloCap;
    // Binder is costed as it is consumed at the mixer, not on delivery,
    // so the silo can be topped up without distorting the $/m3 figure.
    this.alarm('silo-fill', 'info', 'Binder delivered ' + SITE_TEXT.delivery + ' - ' + added.toFixed(0) + ' t', true);
  }

  /** Top the ball charging hopper back up. Costed as the steel is worn away. */
  orderMedia() {
    const added = ORE.hopperCap - this.mediaStock;
    if (added < 0.5) return;
    this.mediaStock = ORE.hopperCap;
    this.alarm('media-fill', 'info',
      SITE_TEXT.mediaThing[0].toUpperCase() + SITE_TEXT.mediaThing.slice(1) + ' delivered '
      + SITE_TEXT.delivery + ' - ' + added.toFixed(0) + ' t', true);
  }

  clearBlockage() {
    if (!this.plugged) return;
    this.plugged = false;
    this.plugRisk = 0;
    this.staticSeconds = 0;
    // flushing a plugged line costs water, power and the paste in the column
    this.cost.water += 180 * DESIGN.costWater;
    this.cost.power += 900 * DESIGN.costPowerKwh;
    this.alarm('plug-clear', 'info', 'Line flushed and re-primed', true);
  }

  /** One-off event: something happened at a point in time. */
  private alarm(id: string, level: AlarmLevel, text: string, force = false) {
    const last = this.alarmSeen.get(id) ?? -1e9;
    if (!force && this.t - last < 300) return; // debounce so the log stays readable
    this.alarmSeen.set(id, this.t);
    this.alarms.unshift({ id, level, text, at: this.t });
    if (this.alarms.length > 60) this.alarms.length = 60;
  }

  /**
   * Latched condition alarm, the way a real annunciator works: it logs once
   * when the condition comes in and once when it clears, not on every scan.
   */
  private cond(id: string, on: boolean, level: AlarmLevel, text: string, cleared?: string) {
    const was = this.active.has(id);
    if (on === was) return;
    if (on) {
      this.active.add(id);
      this.alarms.unshift({ id, level, text, at: this.t });
    } else {
      this.active.delete(id);
      this.alarms.unshift({ id: id + ':clear', level: 'info', text: cleared ?? text + ' - cleared', at: this.t });
    }
    if (this.alarms.length > 60) this.alarms.length = 60;
  }

  /** Conditions currently standing, for the HUD's annunciator count. */
  get activeAlarms(): number {
    return this.active.size;
  }

  /** The annunciator reads this directly: which conditions are in right now. */
  get standing(): ReadonlySet<string> {
    return this.active;
  }

  /** @param dt simulated seconds to advance */
  step(dt: number) {
    this.t += dt;
    const dtH = dt / 3600;
    const sp = this.sp;
    const run = sp.running && !this.plugged;

    // ================= 1. Upstream circuit + mill feed ====================
    // In standard mode this is a fixed stream. In hard mode you have ground,
    // floated and classified it yourself, and the PSD and sulphide content
    // that come out of that reach all the way through to the stope.
    const spec = upstream(this.up, this.hardMode, this.mediaHealth);
    const fx = feedEffects(spec, this.up.binderType);
    setSolidsSG(spec.sg);
    this.feedSpec = spec;
    this.feedFx = fx;

    // The backfill plant is a slipstream off the tailings line; whatever it
    // cannot take goes to the tailings facility.
    const available = spec.solids;
    const feedSolids = run ? Math.min(available, DESIGN.plantCapacity) : 0;
    const bypassToTsf = Math.max(0, available - feedSolids);
    const feed = stream(feedSolids, (feedSolids * (1 - spec.cw)) / spec.cw, 0);

    // ---- grinding media --------------------------------------------------
    // The charger feeds the mill from the hopper at the wear rate. Let the
    // hopper run empty and the charge itself starts to go: the mill draws
    // less power and loses its top size, so the product creeps coarser -
    // and a coarse grind leaves the sulphides locked up in the tailings.
    const grinding = ORE.source === 'mill' || ORE.source === 'scoop';
    const mediaRate = this.hardMode && run && grinding
      ? mediaDraw(this.up.millFeed, spec.specificEnergy) : 0;
    const mediaWanted = mediaRate * dtH;
    const mediaFed = Math.min(this.mediaStock, mediaWanted);
    this.mediaStock = Math.max(0, this.mediaStock - mediaFed);
    const mediaStarved = mediaWanted > 1e-9 && mediaFed < mediaWanted * 0.999;
    this.cost.media += mediaFed * ORE.costMedia;

    if (this.hardMode) {
      // Topping up recovers the charge over a few hours; running it down
      // takes most of a day, which is why nobody lets it happen.
      this.mediaHealth = clamp(approach(
        this.mediaHealth, mediaStarved ? 0 : 1,
        (mediaStarved ? 16 : 4) * 3600, dt), 0, 1);

      this.cost.upstream += upstreamCost(spec, this.up) * dtH;
      this.cond('media-low', grinding && this.mediaStock < ORE.hopperCap * 0.18 && run, 'warn',
        SITE_TEXT.media + ' low - order ' + SITE_TEXT.mediaThing + ' before it runs out',
        SITE_TEXT.media + ' replenished');
      this.cond('media-out', mediaStarved, 'trip',
        SITE_TEXT.media.toUpperCase() + ' EMPTY - the ' + SITE_TEXT.mediaThing + ' is wearing out '
        + 'and not being replaced. The grind will coarsen from here.',
        SITE_TEXT.media + ' restored');
      this.cond('liberation', ORE.source === 'mill' && spec.liberation < 0.8 && run, 'warn',
        'Grind at P80 ' + spec.p80.toFixed(0) + ' um - only '
        + (spec.liberation * 100).toFixed(0) + '% of the '
        + (ORE.separation === 'magnetic' ? 'metal' : 'sulphide') + ' is liberated',
        'Grind back in the liberation window');
      this.cond('supply-short', run && available < DESIGN.plantCapacity * 0.92, 'warn',
        'Tailings supply short at ' + available.toFixed(0) + ' t/h - the plant can take '
        + DESIGN.plantCapacity + '. Grind coarser or ease off the deslime cut.',
        'Tailings supply back up to plant capacity');
      this.cond('sulphide-high', spec.sulphide > 0.9 && this.up.binderType === 'opc', 'warn',
        'Tailings at ' + spec.sulphide.toFixed(2) + '% S on ordinary portland - sulphate '
        + 'attack will eat the 28 day strength. '
        + (ORE.separation === 'flotation' ? 'Lift the frother or move to a slag blend.' : 'Move to a slag blend.'),
        'Sulphide risk cleared');
    }

    // ================= 2. Dewatering =====================================
    // How the tailings lose their water depends on where the plant is. A
    // thickener settles them and buffers them in its bed. A cyclone bank or a
    // decanter centrifuge does it inline: no bed, no rakes, and whatever it
    // does not send on goes straight back out with the overflow. A dry feed -
    // crushed waste - has no water to take out at all, and goes straight to
    // the bin.
    const dw = DESIGN.dewater;
    const inline = dw === 'cyclones' || dw === 'centrifuge';
    const area = (Math.PI * DESIGN.thickenerDia ** 2) / 4;

    // Flocculant buys both settling flux and achievable underflow density.
    // On a centrifuge it is polymer, and it buys cake solids and a cleaner
    // centrate. A cyclone takes no reagent and simply tops out.
    const floc = clamp(sp.flocDose, 0, 45);
    const riseLimit = dw === 'thickener' ? clamp(0.55 + 0.095 * floc, 0.55, 3.6) : 0;
    const maxUfCw = dw === 'cyclones' ? 0.60
      : dw === 'centrifuge' ? clamp(0.56 + 0.0028 * floc, 0.56, 0.68)
      : dw === 'dry' ? 1
      : clamp(0.545 + 0.0062 * floc, 0.545, 0.72);

    const binSp = 0.55 * DESIGN.cakeBinCap;
    const binMakeUp = Math.max(0, (binSp - this.cakeMass) / 0.5); // t/h wet, 30 min pull-up

    let capacity: number, moisture: number, cakeCw: number, throughput: number;
    let cake: Stream, filtrate: Stream = EMPTY, underflow: Stream = EMPTY, overflow: Stream = EMPTY;
    let ufDry = 0, solidsLost = 0, clarity = 20, overload = 0, riseRate = 0;
    let surgeSpill = 0, bedPct = 0, excess = 0;

    if (dw === 'dry') {
      // The loaders only scoop what the bin will take; the rest stays in the
      // piles, where it has been for a very long time already.
      moisture = DESIGN.dryMoisture;
      cakeCw = 1 - moisture / 100;
      capacity = feedSolids;
      const dryDemand = (this.lastCakeDraw + binMakeUp) * cakeCw;
      throughput = run
        ? Math.max(0, Math.min(capacity, dryDemand, this.cakeBinHeadroomDry(dtH)))
        : 0;
      cake = stream(throughput, (throughput * (1 - cakeCw)) / cakeCw, 0);
      excess = Math.max(0, feedSolids - throughput);
      this.ufVol = 0;
      this.bed = 0;
      this.torque = 0;
      this.ufCwActual = cakeCw;
    } else {
      const ufCwTarget = Math.min(sp.ufCw, maxUfCw);
      this.ufCwActual = approach(this.ufCwActual, ufCwTarget, 120, dt);
      const rhoUf = densityFromCw(this.ufCwActual);

      // The plate press is the real pull on the surge tank, so draw it first.
      capacity = this.filterCapacity();
      moisture = this.cakeMoisture();
      cakeCw = 1 - moisture / 100;
      const ufDryAvailable = dtH > 0 ? (this.ufVol * rhoUf * this.ufCwActual) / dtH : capacity;

      // The press works to hold the cake bin around mid-range rather than
      // running flat out, so it modulates with the mixer's draw the way a real
      // press does instead of pinning the bin full and backing the circuit up.
      const dryDemand = (this.lastCakeDraw + binMakeUp) * cakeCw;

      throughput = run
        ? Math.max(0, Math.min(capacity, dryDemand, ufDryAvailable, this.cakeBinHeadroomDry(dtH)))
        : 0;
      cake = stream(throughput, (throughput * (1 - cakeCw)) / cakeCw, 0);
      const ufWetDrawn = throughput / Math.max(this.ufCwActual, 1e-6);  // t/h wet slurry
      const drawVol = ufWetDrawn / rhoUf;                               // m3/h
      this.ufVol = clamp(this.ufVol - drawVol * dtH, 0, DESIGN.ufTankVol);
      filtrate = stream(0, Math.max(0, ufWetDrawn - totalMass(cake)), 0);

      // The underflow pump then runs on surge-tank level control, not flat out -
      // so when the press backs off, the thickener bed is what starts to build.
      const levelSp = 0.62 * DESIGN.ufTankVol;
      const makeUp = Math.max(0, (levelSp - this.ufVol) / (10 / 60)); // restore over 10 min, m3/h
      const ufVolWanted = run ? drawVol + makeUp : 0;
      const ufDryWanted = ufVolWanted * rhoUf * this.ufCwActual;

      if (inline) {
        // Fines always leave with the overflow. A cyclone pushed to a denser
        // underflow sends more of them; a centrifuge sends fewer the more
        // polymer it gets. With no bed to hold the rest, whatever the surge
        // tank cannot take is bypassed back where it came from.
        const lossFrac = dw === 'cyclones'
          ? clamp(0.006 + 0.2 * Math.max(0, this.ufCwActual - 0.50), 0.006, 0.05)
          : clamp(0.032 - 0.0006 * floc, 0.006, 0.032);
        solidsLost = feedSolids * lossFrac;
        const avail = Math.max(0, feedSolids - solidsLost);
        ufDry = Math.max(0, Math.min(ufDryWanted, avail, this.ufTankHeadroomDry(dtH)));
        excess = avail - ufDry;
        this.bed = 0;
        // a decanter's scroll torque climbs with the cake it is asked to make
        this.torque = approach(this.torque, dw === 'centrifuge' && run
          ? 30 + 420 * Math.max(0, this.ufCwActual - 0.56) : 0, 30, dt);
      } else {
        const bedAvailable = dtH > 0 ? this.bed / dtH : ufDryWanted;
        ufDry = Math.max(0, Math.min(ufDryWanted, bedAvailable, this.ufTankHeadroomDry(dtH)));
      }
      underflow = stream(ufDry, (ufDry * (1 - this.ufCwActual)) / this.ufCwActual, 0);

      const ufRaw = this.ufVol + volFlow(underflow) * dtH;
      if (ufRaw > DESIGN.ufTankVol) {
        surgeSpill = dtH > 0 ? (ufRaw - DESIGN.ufTankVol) / dtH : 0;
        this.spilledM3 += (ufRaw - DESIGN.ufTankVol);
        this.cost.spill += (ufRaw - DESIGN.ufTankVol) * DESIGN.costSpill;
      }
      this.ufVol = clamp(ufRaw, 0, DESIGN.ufTankVol);
      this.cond('surge-spill', surgeSpill > 0.5, 'trip',
        'U/F SURGE TANK OVERFLOWING - thickened tailings going to ' + SITE_TEXT.spillTo,
        'Surge tank overflow stopped');

      if (inline) {
        const feedWaterPerDry = (1 - spec.cw) / spec.cw;
        const ofWater = Math.max(0, feed.water - underflow.water - excess * feedWaterPerDry);
        overflow = stream(solidsLost, ofWater, 0);
        clarity = 20 + (solidsLost / Math.max(ofWater, 1)) * 1e6;
        // what goes out with the overflow is somebody else's problem, and it
        // is billed: plume on the seabed, lost fines anywhere else
        this.cost.spill += solidsLost * dtH * DESIGN.costPlume;
        this.cond('plume', run && solidsLost > feedSolids * 0.02, 'warn',
          'Fines leaving with the overflow at ' + solidsLost.toFixed(1) + ' t/h - '
          + (dw === 'cyclones' ? 'the cyclone underflow is set too dense'
            : 'more polymer, or ease the cake solids off'),
          'Overflow fines back under control');
        this.cond('uf-limited', sp.ufCw > maxUfCw + 0.002, 'info',
          (dw === 'cyclones' ? 'Cyclone underflow tops out at ' : 'Decanter cake capped at ')
          + (maxUfCw * 100).toFixed(1) + '%',
          'Underflow density setpoint now achievable');
      } else {
        // Overflow is the balance. If the rise rate beats the settling flux the
        // bed floats and solids report over the launder.
        const overflowVol = Math.max(0, volFlow(feed) - volFlow(underflow));
        riseRate = overflowVol / area;
        overload = clamp((riseRate - riseLimit) / Math.max(riseLimit, 0.1), 0, 1.5);
        solidsLost = feedSolids * clamp(overload * 0.55, 0, 0.5);
        clarity = 20 + overload * 5200;
        overflow = stream(
          solidsLost,
          Math.max(0, totalMass(feed) - totalMass(underflow) - solidsLost),
          0,
        );

        this.bed = clamp(this.bed + (feedSolids - solidsLost - ufDry) * dtH, 0, DESIGN.thickenerBedMax * 1.15);

        bedPct = (this.bed / DESIGN.thickenerBedMax) * 100;
        const torqueTarget = run ? 28 + 300 * Math.max(0, this.ufCwActual - 0.55) + 0.32 * bedPct : 18;
        this.torque = approach(this.torque, torqueTarget, 30, dt);

        this.cond('rake-trip', this.torque > 92, 'trip',
          'Rake torque ' + this.torque.toFixed(0) + '% - back the underflow density off',
          'Rake torque back within limits');
        this.cond('rake-high', this.torque > 78 && this.torque <= 92, 'warn',
          'Rake torque high at ' + this.torque.toFixed(0) + '%',
          'Rake torque normal');
        this.cond('thk-rise', overload > 0.05, 'warn',
          'Bed rising - overflow at ' + clarity.toFixed(0) + ' mg/L, add flocculant',
          'Overflow clarity recovered');
        this.cond('thk-bed', bedPct > 96, 'warn',
          'Thickener bed near capacity', 'Thickener bed drawn down');
        this.cond('uf-limited', sp.ufCw > maxUfCw + 0.002, 'info',
          'Underflow density capped at ' + (maxUfCw * 100).toFixed(1) + '% by flocculant dose',
          'Underflow density setpoint now achievable');
      }
    }
    this.lastExcess = excess;

    this.rakeAngle += dt * 0.0105 * (run ? 1 : 0.15); // ~10 min per revolution

    // ================= 3. Plate press cycle + cake bin ===================
    if (dw !== 'dry') {
      this.cond('uf-low', run && this.ufVol < 8, 'warn',
        'Underflow surge tank low - the press is out-running the '
          + (dw === 'thickener' ? 'thickener' : dw === 'cyclones' ? 'cyclones' : 'centrifuge'),
        'Underflow surge tank recovered');

      // A press with nothing to filter does not keep shuttling its plates. Stop
      // the plant and the pack holds wherever the cycle had got to, which is
      // also what you come back to when you start it again.
      if (run && sp.cycleTime > 0) {
        this.cyclePhase = (this.cyclePhase + dt / (sp.cycleTime * 60)) % 1;
      }
    }
    const pressing = this.cyclePhase < 0.78;

    // blend new cake into the bin (moisture is a mass-weighted mix)
    const cakeWet = totalMass(cake) * dtH;
    if (cakeWet > 0) {
      const newTotal = this.cakeMass + cakeWet;
      this.cakeMoist = (this.cakeMoist * this.cakeMass + moisture * cakeWet) / Math.max(newTotal, 1e-9);
      this.cakeMass = newTotal;
    }

    // ================= 4. Mixer recipe ===================================
    // Work out the recipe on a unit basis first, so the panel shows what the
    // mix WOULD be even while the plant is stopped.
    const binderPct = clamp(sp.binderDose, 0, 10);
    const cakeBinCw = clamp(1 - this.cakeMoist / 100, 0.5, 0.95);

    const pasteCwForSlump = this.cwForSlump(sp.targetSlump, binderPct);
    const maxPasteCw = this.maxAchievableCw(cakeBinCw, binderPct);
    const waterLimited = pasteCwForSlump > maxPasteCw + 1e-4;
    const pasteCw = Math.min(pasteCwForSlump, maxPasteCw);

    const recipe = this.makePaste(1, binderPct, pasteCw);
    const pasteRho = slurryDensity(recipe);
    const pcv = Cv(recipe);
    const tauY = yieldStress(pcv, binderPct) * this.feedFx.yieldStress;
    const eta = plasticViscosity(pcv);
    const slumpAchieved = slump(tauY, pasteRho);
    const slumpCone = coneSlump(tauY, pasteRho);
    const ucs = ucs28(binderPct, Cw(recipe)) * this.feedFx.ucs * DESIGN.cureFactor;

    // ================= 5. Pump pull ======================================
    // A positive-displacement pump will deliver whatever the line asks for
    // right up to its pressure rating - and then it simply stops pushing. So
    // the real pull is the stroke demand capped by what the line will take at
    // 120 bar. Ask for a paste that is too stiff and throughput collapses.
    const strokeDemand = run ? (DESIGN.pumpMaxFlow * clamp(sp.strokeRate, 0, 100)) / 100 : 0;
    const flowCeiling = this.flowAtPressureLimit(tauY, eta, pasteRho);
    const pressureLimited = strokeDemand > flowCeiling + 0.05;
    const pumpDemand = Math.min(strokeDemand, flowCeiling);
    const dryNeeded = pumpDemand * pasteRho * (recipe.solids / totalMass(recipe));

    const cakeAvailableDry = dtH > 0 ? (this.cakeMass * cakeBinCw) / dtH : dryNeeded;
    const binderAvailable = dtH > 0 ? this.siloMass / dtH : Infinity;
    const dryByBinder = binderPct > 0.01 ? (binderAvailable * 100) / binderPct : Infinity;
    const dryActual = Math.max(0, Math.min(dryNeeded, cakeAvailableDry, dryByBinder));
    const starved = pumpDemand > 0.1 && dryActual < dryNeeded * 0.95;

    const paste = this.makePaste(dryActual, binderPct, pasteCw);
    const binderRate = paste.binder;
    const cakeUsedWet = dryActual / cakeBinCw;
    this.lastCakeDraw = cakeUsedWet;
    const mixWater = Math.max(0, paste.water - (cakeUsedWet - dryActual));

    this.cakeMass = clamp(this.cakeMass - cakeUsedWet * dtH, 0, DESIGN.cakeBinCap);
    this.siloMass = clamp(this.siloMass - binderRate * dtH, 0, DESIGN.siloCap);

    this.cost.binder += binderRate * dtH * this.binderPrice();
    this.cost.water += paste.water * dtH * DESIGN.costWaterLost;
    this.cost.floc += feedSolids * floc * 1e-6 * dtH * DESIGN.costFloc;

    // ---- process water balance ------------------------------------------
    // Everything the thickener and the press take out has to go somewhere.
    // The mixer drinks a little of it; the rest goes back to the mill, and the
    // mill will only take so much. Chase a drier, stronger paste and you
    // recover MORE water than the return line can carry - and the tank spills.
    const recovered = overflow.water + filtrate.water;             // t/h ~ m3/h
    const pwSp = 0.55 * DESIGN.pwTankVol;
    const wantExport = recovered - mixWater + (this.pwVol - pwSp) / 0.5;
    const toMill = clamp(wantExport, 0, DESIGN.millReturnCap);

    this.pwVol += (recovered - mixWater - toMill) * dtH;
    if (DESIGN.dewater === 'dry') this.pwVol += mixWater * dtH;   // the tanker keeps it topped
    let waterSpill = 0;
    if (this.pwVol > DESIGN.pwTankVol) {
      waterSpill = dtH > 0 ? (this.pwVol - DESIGN.pwTankVol) / dtH : 0;
      this.pwVol = DESIGN.pwTankVol;
    }
    // if the tank runs dry the mixer has to buy raw make-up water
    const rawMakeUp = DESIGN.dewater === 'dry' ? mixWater
      : this.pwVol < 0 ? Math.min(mixWater, -this.pwVol / Math.max(dtH, 1e-9)) : 0;
    this.pwVol = Math.max(0, this.pwVol);

    this.spilledM3 += waterSpill * dtH;
    this.cost.spill += waterSpill * dtH * DESIGN.costSpill;
    this.cost.water += rawMakeUp * dtH * DESIGN.costWater;

    this.cond('pw-high', this.pwVol > DESIGN.pwTankVol * 0.88, 'warn',
      'Process water tank high - the mill will not take any more back',
      'Process water tank back in band');
    this.cond('pw-spill', waterSpill > 0.5, 'trip',
      'PROCESS WATER OVERFLOWING to ' + SITE_TEXT.spillTo + ' - ' + waterSpill.toFixed(0) + ' m3/h',
      'Process water overflow stopped');

    this.cond('silo-low', this.siloMass < 25, 'warn',
      'Binder silo low - order a delivery', 'Binder silo replenished');
    this.cond('cake-low', run && this.cakeMass < 6 && pumpDemand > 1, 'warn',
      'Cake bin empty - the press cannot keep up with the pump',
      'Cake bin recovered - press is keeping up again');
    this.cond('cake-full', this.cakeMass > DESIGN.cakeBinCap * 0.96, 'warn',
      'Cake bin full - the press will back up', 'Cake bin drawing down');
    this.cond('water-limited', waterLimited, 'warn',
      'Cake too dry for the slump target - shorten the press cycle or drop the target',
      'Slump target achievable again');

    this.paddleAngle += dt * (run && dryActual > 0 ? 3.4 : 0);

    // ================= 6. Pump + pipeline ================================
    const actualFlow = volFlow(paste);
    const pipe = pipeline(
      actualFlow,
      Math.max(60, DESIGN.pipeId - this.wallLoss * 2),
      DESIGN.pipeLength, DESIGN.pipeDrop,
      tauY, eta, pasteRho, DESIGN.gravity,
    );

    const pressureNeed = Math.max(0, pipe.pumpPressure);
    this.smPressure = approach(this.smPressure, pressureNeed, 4, dt);
    this.smFlow = approach(this.smFlow, actualFlow, 3, dt);

    const pressurePct = (this.smPressure / DESIGN.pumpMaxPressure) * 100;

    // Plug risk: the pump is against its pressure rating and losing the
    // throughput fight, or the line is sitting static with live paste in it
    // and the binder is starting to take a set.
    if (actualFlow < 1 && sp.running && this.stopeVol > 0 && !this.plugged) this.staticSeconds += dt;
    else if (actualFlow > 1) this.staticSeconds = Math.max(0, this.staticSeconds - dt * 3);

    let risk = 0;
    if (pressureLimited && run) {
      const throttle = clamp(1 - flowCeiling / Math.max(strokeDemand, 1e-9), 0, 1);
      risk += 0.25 + throttle * 1.15;
    }
    if (this.staticSeconds > 900) risk += (this.staticSeconds - 900) / 2400;
    this.plugRisk = clamp(approach(this.plugRisk, clamp(risk, 0, 1.4), 12, dt), 0, 1.4);

    this.cond('overpressure', pressureLimited && run, 'warn',
      'Pump against its ' + (DESIGN.pumpMaxPressure / 100).toFixed(0)
      + ' bar rating - flow held to ' + flowCeiling.toFixed(0) + ' m3/h. Wetter paste or the line sets up.',
      'Discharge pressure back inside the rating');
    this.cond('static', this.staticSeconds > 900, 'warn',
      'Paste has been static in the line - it will start to set',
      'Line moving again');
    if (this.plugRisk >= 1 && !this.plugged) {
      this.plugged = true;
      this.blockages++;
      this.sp.running = false;
      this.alarm('plug', 'trip', 'LINE PLUGGED - stop, flush and re-prime', true);
    }

    const strokesPerMin = (clamp(sp.strokeRate, 0, 100) / 100) * 28;
    this.strokePhase = (this.strokePhase + (dt * strokesPerMin) / 60) % 1;

    // shaft power, kW = Q[m3/s] * dP[kPa] / efficiency
    const power = ((Math.max(actualFlow, 0) / 3600) * this.smPressure) / 0.82;
    this.cost.power += (power + (run ? DESIGN.auxPowerKw + DESIGN.dewaterPowerKw : 40))
      * dtH * DESIGN.costPowerKwh;

    this.wallLoss += wearRate(pipe.velocity, pcv) * dtH * 0.004;
    this.cond('wear', this.wallLoss > DESIGN.pipeWallMm * 0.6, 'warn',
      'Pipe wall down ' + this.wallLoss.toFixed(1) + ' mm - schedule a spool rotation');
    this.cond('choke', run && pipe.pumpPressure < -250 && actualFlow > 1, 'info',
      'Column is free-flowing - the choke at the collar is holding it back',
      'Column no longer free-flowing - the pump is doing the work');

    // ================= 7. Stope ==========================================
    const placed = actualFlow * dtH;
    let complete = this.stopeVol >= DESIGN.stopeVolume - 0.5;
    if (placed > 0 && !complete) {
      const v = Math.min(placed, DESIGN.stopeVolume - this.stopeVol);
      this.stopeVol += v;
      this.stopeTonnes += v * pasteRho;
      this.stopeBinder += binderRate * dtH * (v / Math.max(placed, 1e-9));
      this.ucsSum += ucs * v;
      this.ucsMin = Math.min(this.ucsMin, ucs);
      complete = this.stopeVol >= DESIGN.stopeVolume - 0.5;
      if (complete) this.alarm('done', 'info', SITE_TEXT.done, true);
    }

    // ================= telemetry =========================================
    const totalCost = this.cost.binder + this.cost.floc + this.cost.power
      + this.cost.water + this.cost.spill + this.cost.upstream + this.cost.media;

    this.telemetry = {
      time: this.t,
      feed,
      thickener: {
        bed: this.bed, bedPct,
        ufCw: this.ufCwActual, maxUfCw,
        riseRate, riseLimit,
        torque: this.torque,
        overflowClarity: clarity,
        underflow, overflow,
        rakeAngle: this.rakeAngle,
      },
      ufTank: {
        volume: this.ufVol,
        pct: (this.ufVol / DESIGN.ufTankVol) * 100,
        cw: this.ufCwActual,
      },
      filter: {
        cycleTime: sp.cycleTime,
        cakeMoisture: moisture,
        capacity, throughput,
        utilisation: capacity > 0 ? (throughput / capacity) * 100 : 0,
        cake, filtrate,
        cyclePhase: this.cyclePhase,
        pressing,
      },
      cakeBin: {
        mass: this.cakeMass,
        pct: (this.cakeMass / DESIGN.cakeBinCap) * 100,
        cw: cakeBinCw,
      },
      silo: {
        mass: this.siloMass,
        pct: (this.siloMass / DESIGN.siloCap) * 100,
        feedRate: binderRate,
      },
      mixer: {
        paste,
        cw: pasteCw, cv: pcv, density: pasteRho,
        yieldStress: tauY, viscosity: eta, slump: slumpAchieved, cone: slumpCone,
        binderDose: dryActual > 0 ? binderDose(paste) : binderPct,
        mixWater, waterLimited, slumpAchieved,
        ucs,
        paddleAngle: this.paddleAngle,
      },
      pump: {
        flow: this.smFlow, demand: pumpDemand,
        pressure: this.smPressure, pressurePct, pressureLimited, flowCeiling,
        strokePhase: this.strokePhase, strokesPerMin,
        starved, power,
      },
      pipe: {
        ...pipe,
        chokeRequired: pipe.pumpPressure < 0 && actualFlow > 1,
        wallLossMm: this.wallLoss,
        plugged: this.plugged,
        plugRisk: this.plugRisk,
        staticMinutes: this.staticSeconds / 60,
      },
      stope: {
        volume: this.stopeVol,
        pct: (this.stopeVol / DESIGN.stopeVolume) * 100,
        tonnesPlaced: this.stopeTonnes,
        binderPlaced: this.stopeBinder,
        avgUcs: this.stopeVol > 1 ? this.ucsSum / this.stopeVol : 0,
        minUcs: this.ucsMin === Infinity ? 0 : this.ucsMin,
      },
      upstream: {
        ...spec,
        hard: this.hardMode,
        binderType: this.up.binderType,
        effects: fx,
        bypassToTsf: bypassToTsf + this.lastExcess,
        plantCapacity: DESIGN.plantCapacity,
      },
      media: {
        stock: this.mediaStock,
        pct: (this.mediaStock / ORE.hopperCap) * 100,
        draw: mediaRate,
        health: this.mediaHealth,
        starved: mediaStarved,
        hoursLeft: mediaRate > 1e-6 ? this.mediaStock / mediaRate : Infinity,
      },
      water: {
        volume: this.pwVol,
        pct: (this.pwVol / DESIGN.pwTankVol) * 100,
        recovered, toMill, makeUp: rawMakeUp,
        returnCap: DESIGN.millReturnCap,
      },
      spills: {
        water: waterSpill,
        slurry: surgeSpill,
        launder: solidsLost,
        leak: this.plugged ? 1 : pressureLimited ? clamp(this.plugRisk, 0, 0.8) : 0,
        totalM3: this.spilledM3,
      },
      cost: {
        ...this.cost,
        total: totalCost,
        perM3: this.stopeVol > 1 ? totalCost / this.stopeVol : 0,
      },
      alarms: this.alarms,
      blockages: this.blockages,
      status: this.plugged ? 'blocked'
        : complete ? 'complete'
        : !sp.running ? 'idle'
        : starved ? 'starved' : 'running',
    };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * The largest flow the line will take without asking the pump for more than
   * its rated discharge pressure, m3/h. Returns 0 when even breaking the paste
   * loose from rest would exceed the rating - which is how a line sets up.
   */
  private flowAtPressureLimit(tauY: number, eta: number, rho: number): number {
    const dia = Math.max(60, DESIGN.pipeId - this.wallLoss * 2);
    const at = (q: number) =>
      pipeline(q, dia, DESIGN.pipeLength, DESIGN.pipeDrop, tauY, eta, rho, DESIGN.gravity).pumpPressure;

    if (at(0) > DESIGN.pumpMaxPressure) return 0;
    if (at(DESIGN.pumpMaxFlow) <= DESIGN.pumpMaxPressure) return DESIGN.pumpMaxFlow;

    let lo = 0, hi = DESIGN.pumpMaxFlow;
    for (let i = 0; i < 32; i++) {
      const mid = 0.5 * (lo + hi);
      if (at(mid) > DESIGN.pumpMaxPressure) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  /** Binder price depends on the blend: slag costs more but resists sulphates. */
  private binderPrice(): number {
    return DESIGN.costBinder * (this.up.binderType === 'slag' ? DESIGN.slagPremium : 1);
  }

  /** Dry throughput the press can hold, t/h - falls off as sqrt(cycle time). */
  private filterCapacity(): number {
    const tc = clamp(this.sp.cycleTime, 1.5, 14);
    const feedFactor = clamp(this.ufCwActual / 0.60, 0.55, 1.35);
    return ((3.55 * DESIGN.filterArea) / Math.sqrt(tc)) * feedFactor * this.feedFx.filterCapacity;
  }

  /** Cake moisture, % wet basis - longer cycles squeeze harder, with diminishing return. */
  private cakeMoisture(): number {
    const tc = clamp(this.sp.cycleTime, 1.5, 14);
    return clamp((11.5 + 14 / Math.pow(tc, 0.55)) * this.feedFx.cakeMoisture, 9, 30);
  }

  private ufTankHeadroomDry(dtH: number): number {
    const room = Math.max(0, DESIGN.ufTankVol - this.ufVol);
    const rho = densityFromCw(this.ufCwActual);
    return dtH > 0 ? (room * rho * this.ufCwActual) / dtH : Infinity;
  }

  private cakeBinHeadroomDry(dtH: number): number {
    const room = Math.max(0, DESIGN.cakeBinCap - this.cakeMass);
    return dtH > 0 ? (room * (1 - this.cakeMoisture() / 100)) / dtH : Infinity;
  }

  /** Build a paste stream from a dry tailings rate, a binder dose and a target Cw. */
  private makePaste(dryTails: number, binderPct: number, targetCw: number): Stream {
    const binder = (dryTails * binderPct) / 100;
    const dry = dryTails + binder;
    const cw = clamp(targetCw, 0.4, 0.92);
    return stream(dryTails, (dry * (1 - cw)) / cw, binder);
  }

  /**
   * Highest Cw reachable from the cake you have. You can add water to a mix,
   * never take it out, so a wet cake puts a hard ceiling on paste strength.
   * Binder arrives dry, so it actually dries the mix slightly.
   */
  private maxAchievableCw(cakeCw: number, binderPct: number): number {
    const dryTails = 1;
    const water = (dryTails * (1 - cakeCw)) / cakeCw;
    const binder = (dryTails * binderPct) / 100;
    return (dryTails + binder) / (dryTails + binder + water);
  }

  /** Invert the slump model to find the Cw that lands on a slump target. */
  private cwForSlump(targetSlump: number, binderPct: number): number {
    let lo = 0.58, hi = 0.90;
    for (let i = 0; i < 44; i++) {
      const mid = 0.5 * (lo + hi);
      const s = this.makePaste(1, binderPct, mid);
      const v = slump(yieldStress(Cv(s), binderPct) * this.feedFx.yieldStress, slurryDensity(s));
      if (v > targetSlump) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }
}

export { EMPTY };
