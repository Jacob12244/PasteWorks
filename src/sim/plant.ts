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
 *
 * That is today's plant. The later worlds swap the two dewatering stages for
 * whatever their site can use - a spin ring and a microwave drier on an
 * asteroid, a magnetic stack and an electro-osmotic press under a city, the
 * ocean's own pressure on the seabed - but every one of them is the same pull
 * through the same buffers.
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
import { portland, type BinderSpec } from './binders';

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

  // ---- the machines only some worlds have -------------------------------
  /** spin-ring thickener speed, rpm - the ring makes its own gravity */
  spin: number;
  /** magnetic settling stack coil field, tesla */
  field: number;
  /** deep-sea filter: bar of the ocean's pressure let across the cake */
  seaDp: number;
  /** microwave drier magnetron power, MW */
  mwPower: number;
  /** belt speed on a microwave drier or an electro-osmotic press, % of rated */
  belt: number;
  /** electro-osmotic press electrode voltage, V */
  voltage: number;
}

export const DEFAULT_SETPOINTS: Setpoints = {
  ufCw: 0.63,
  flocDose: 22,
  cycleTime: 6,
  binderDose: 5.0,
  targetSlump: 125,
  strokeRate: 62,
  running: false,
  spin: 10,
  field: 0.8,
  seaDp: 60,
  mwPower: 5,
  belt: 70,
  voltage: 30,
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
  /** the two binders the silo can hold, and what each costs here */
  binders: portland(148) as [BinderSpec, BinderSpec],
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
  /**
   * $/m3 for the water that leaves locked inside the placed fill and never
   * comes back. On a mine with dewatering to spare it is free, which is why
   * the baseline carries zero. Where water had to be shipped in or dug out,
   * it is the biggest line on the bill - and it is what makes a stiffer,
   * drier paste worth the trouble.
   */
  costWaterLost: 0,
  /** what takes the bulk of the water out: see Dewater */
  dewater: 'thickener' as Dewater,
  /** and what takes the rest out before the cake bin: see Filter */
  filter: 'press' as Filter,
  /** $/t of solids that leave the plant with a cyclone overflow or a filtrate */
  costPlume: 0,
  /** % moisture of a dry feed as it goes into the bin */
  dryMoisture: 8,

  // ---- spin-ring thickener --------------------------------------------
  /** m, rim radius: gravity at the rim is w^2.r */
  ringRadius: 8,
  /** m, width of the settling channel round the rim */
  ringWidth: 3.0,
  // ---- magnetic settling stack ----------------------------------------
  /** m, column diameter - a tenth of a thickener's floor */
  stackDia: 5.6,
  /** kW the coils draw at one tesla; it goes as the square of the field */
  coilKw: 1200,
  // ---- continuous belt filters ----------------------------------------
  /** t/h dry at full belt speed */
  beltCap: 240,
  /** microwave drier: kWh to boil off a tonne of water, latent heat recovered off the trap */
  evapKwh: 95,
  /** t/h of vapour the cold trap can freeze out before the rest gets past it */
  trapCap: 75,
  /** electro-osmotic press: kWh per dry tonne per volt squared, at 60% belt */
  eoKwh: 0.0016,
};

/**
 * How the tailings lose the bulk of their water.
 *
 *   thickener  settles under gravity into a raked bed
 *   cyclones   inline, no bed: spun out as they arrive, fines out of the top
 *   spinring   a thickener built inside a spinning ring, which makes its own
 *              gravity where there is none worth having
 *   magstack   a tall, narrow column that pulls magnetite-seeded flocs down
 *              with a field instead of gravity - a tenth of the floor space
 *   dry        nothing to take out: the feed is crushed rubbish
 */
export type Dewater = 'thickener' | 'cyclones' | 'spinring' | 'magstack' | 'dry';

/**
 * And what takes the rest out, to a cake.
 *
 *   press      a plate press on a cycle
 *   deeppress  a plate press whose squeeze is the ocean: the cake sits between
 *              440 bar of seabed and a one-atmosphere hull
 *   microwave  a belt through a microwave tunnel open to vacuum; the water
 *              boils off and freezes onto a cold trap
 *   eopress    a belt press with electrodes in it, pulling the water through
 *              the cake by electro-osmosis
 *   none       a dry feed has nothing to filter
 */
export type Filter = 'press' | 'deeppress' | 'microwave' | 'eopress' | 'none';

/** Settlers that hold a bed of solids, with a rise rate and a torque. */
export function bedded(dw: Dewater): boolean {
  return dw === 'thickener' || dw === 'spinring' || dw === 'magstack';
}

/** Filters that run a plate cycle, rather than a continuous belt. */
export function batch(f: Filter): boolean {
  return f === 'press' || f === 'deeppress';
}

/** What this site calls its two dewatering machines in a sentence. */
export function kitNames(): { settler: string; filter: string } {
  return {
    settler: {
      thickener: 'thickener', cyclones: 'cyclones', spinring: 'spin ring',
      magstack: 'mag stack', dry: 'crusher',
    }[DESIGN.dewater],
    filter: {
      press: 'press', deeppress: 'deep filter', microwave: 'drier',
      eopress: 'e-press', none: 'crusher',
    }[DESIGN.filter],
  };
}

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

  /** the first dewatering stage, whatever it is - see Dewater */
  thickener: {
    bed: number; bedPct: number;
    ufCw: number; maxUfCw: number;
    riseRate: number; riseLimit: number;
    /** rake torque, ring imbalance or coil temperature: the limit it runs against, % */
    torque: number;
    overflowClarity: number;
    underflow: Stream; overflow: Stream;
    rakeAngle: number;
    /** gravity at the settling surface, in Earth g - a spin ring makes its own */
    g: number;
    /** tesla on a magnetic stack's coils */
    field: number;
    /** kW the machine draws on top of the plant's auxiliaries */
    power: number;
  };

  ufTank: { volume: number; pct: number; cw: number };

  /** the circuit that made the tailings, and what its PSD does downstream */
  upstream: FeedSpec & {
    hard: boolean;
    binderType: BinderType;
    /** everything about the binder in the silo */
    binder: BinderSpec;
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

  /** the second dewatering stage, whatever it is - see Filter */
  filter: {
    cycleTime: number;
    cakeMoisture: number;
    capacity: number; throughput: number; utilisation: number;
    cake: Stream; filtrate: Stream;
    cyclePhase: number; pressing: boolean;
    /** kW it draws: magnetrons, electrodes, or the pumps pushing filtrate back out to sea */
    power: number;
    /** kWh per dry tonne of cake */
    energy: number;
    /** t/h of water boiled off in a microwave drier */
    evap: number;
    /** t/h of that vapour the cold trap missed, gone for good */
    trapLoss: number;
    /** t/h of fines forced through the cloth with the filtrate */
    bleed: number;
    /** what it is being run at: bar of sea across the cloth, volts, belt % */
    dp: number; volts: number; belt: number;
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
    if (!bedded(DESIGN.dewater)) this.ufCwActual = this.sp.ufCw;
    this.step(0);
  }

  reset() {
    this.bed = 220; this.ufVol = 90;
    this.ufCwActual = !bedded(DESIGN.dewater) ? DEFAULT_SETPOINTS.ufCw : 0.60;
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
    const binder = this.binder();
    const fx = feedEffects(spec, binder);
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
      ? mediaDraw(ORE.source === 'scoop' ? spec.crushed : this.up.millFeed,
        spec.specificEnergy, spec.duty) : 0;
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
      const other = DESIGN.binders.find((b) => b !== binder)!;
      this.cond('sulphide-high', spec.sulphide > 0.9 && binder.sulphate > 0.15, 'warn',
        'Tailings at ' + spec.sulphide.toFixed(2) + '% S on ' + binder.name.toLowerCase()
        + ' - sulphate attack will eat the 28 day strength. '
        + (ORE.separation === 'flotation' ? 'Lift the frother or move to ' : 'Move to ')
        + other.name.toLowerCase() + '.',
        'Sulphide risk cleared');
      if (ORE.source === 'scoop') {
        this.cond('crusher-choked', run && spec.crushed < clamp(this.up.millFeed, 150, 700) - 1, 'warn',
          'Crusher choking - the grate passes ' + spec.crusherCap.toFixed(0) + ' t/h and the '
          + 'loaders are bringing ' + this.up.millFeed.toFixed(0) + '. Open the grate or slow them.',
          'Crusher keeping up with the loaders');
        this.cond('steel', run && spec.steel > 1.5, 'warn',
          spec.steel.toFixed(1) + '% tramp steel going into the fill - it is still locked in the '
          + 'lumps where the magnet cannot reach it. Speed the rotor up or close the grate.',
          'Tramp steel back under control');
      }
    }

    // ================= 2. Dewatering =====================================
    // How the tailings lose their water depends on where the plant is. A
    // thickener settles them and buffers them in its bed, and so do its two
    // descendants: a spin ring, which makes the gravity it settles in, and a
    // magnetic stack, which pulls seeded flocs down with a field in a tenth of
    // the floor space. A cyclone bank does it inline: no bed, no rakes, and
    // whatever it does not send on goes straight back out with the overflow. A
    // dry feed - crushed waste - has no water to take out at all, and goes
    // straight to the bin.
    const dw = DESIGN.dewater;
    const inline = dw === 'cyclones';
    const k = kitNames();

    // Flocculant buys both settling flux and achievable underflow density.
    // What else buys them depends on the machine: a spin ring's speed is its
    // gravity, w^2.r at the rim, and a stack's field multiplies how fast a
    // magnetite-seeded floc falls. A cyclone takes no reagent and simply tops out.
    const floc = clamp(sp.flocDose, 0, 45);
    const spin = dw === 'spinring' ? clamp(sp.spin, 0, 20) : 0;
    const gRel = dw === 'spinring'
      ? ((2 * Math.PI * spin / 60) ** 2 * DESIGN.ringRadius) / 9.81
      : DESIGN.gravity / 9.81;
    const field = dw === 'magstack' ? clamp(sp.field, 0, 2) : 0;
    const pull = dw === 'spinring' ? Math.pow(Math.max(gRel, 0.01), 0.9)
      : dw === 'magstack' ? 1 + 7 * Math.pow(field, 1.5)
      : 1;
    const area = dw === 'spinring' ? 2 * Math.PI * DESIGN.ringRadius * DESIGN.ringWidth
      : dw === 'magstack' ? (Math.PI * DESIGN.stackDia ** 2) / 4
      : (Math.PI * DESIGN.thickenerDia ** 2) / 4;
    const riseLimit = bedded(dw) ? clamp(0.55 + 0.095 * floc, 0.55, 3.6) * pull : 0;
    const compaction = dw === 'spinring' ? 0.045 * Math.log2(clamp(gRel, 0.1, 4))
      : dw === 'magstack' ? 0.06 * field : 0;
    const maxUfCw = dw === 'cyclones' ? 0.60
      : dw === 'dry' ? 1
      : dw === 'thickener' ? clamp(0.545 + 0.0062 * floc, 0.545, 0.72)
      : clamp(0.545 + 0.0062 * floc + compaction, 0.5, 0.76);
    // bearings and despin on the ring, which goes as a little under the cube
    // of its speed; the coils as the square of their field
    const settlerKw = !run ? 0
      : dw === 'spinring' ? 160 * Math.pow(spin / 10, 2.5)
      : dw === 'magstack' ? DESIGN.coilKw * field * field
      : 0;

    const binSp = 0.55 * DESIGN.cakeBinCap;
    const binMakeUp = Math.max(0, (binSp - this.cakeMass) / 0.5); // t/h wet, 30 min pull-up

    let capacity: number, moisture: number, cakeCw: number, throughput: number;
    let cake: Stream, filtrate: Stream = EMPTY, underflow: Stream = EMPTY, overflow: Stream = EMPTY;
    let ufDry = 0, solidsLost = 0, clarity = 20, overload = 0, riseRate = 0;
    let surgeSpill = 0, bedPct = 0, excess = 0;
    let filterKw = 0, energy = 0, evap = 0, trapLoss = 0, bleed = 0;

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

      // The filter is the real pull on the surge tank, so draw it first.
      capacity = this.filterCapacity();
      moisture = this.cakeMoisture();
      cakeCw = 1 - moisture / 100;
      const ufDryAvailable = dtH > 0 ? (this.ufVol * rhoUf * this.ufCwActual) / dtH : capacity;

      // The filter works to hold the cake bin around mid-range rather than
      // running flat out, so it modulates with the mixer's draw the way a real
      // press does instead of pinning the bin full and backing the circuit up.
      const dryDemand = (this.lastCakeDraw + binMakeUp) * cakeCw;

      throughput = run
        ? Math.max(0, Math.min(capacity, dryDemand, ufDryAvailable, this.cakeBinHeadroomDry(dtH)))
        : 0;

      // Only the deep filter squeezes hard enough to force fines through the
      // cloth: four hundred bar of seabed does not care what it was rated for,
      // and the filtrate goes straight back out to sea.
      if (DESIGN.filter === 'deeppress') {
        const dp = clamp(sp.seaDp, 10, 440);
        bleed = throughput * clamp(0.0018 * (dp / 100) ** 2 * (spec.fines20 / 0.22), 0, 0.2);
      }
      cake = stream(throughput - bleed, ((throughput - bleed) * (1 - cakeCw)) / cakeCw, 0);
      const ufWetDrawn = throughput / Math.max(this.ufCwActual, 1e-6);  // t/h wet slurry
      const drawVol = ufWetDrawn / rhoUf;                               // m3/h
      this.ufVol = clamp(this.ufVol - drawVol * dtH, 0, DESIGN.ufTankVol);
      const removed = Math.max(0, ufWetDrawn - totalMass(cake) - bleed);

      switch (DESIGN.filter) {
        case 'microwave':
          // Everything the drier takes out leaves as vapour, and the cold trap
          // freezes it back out of the vacuum - up to what it can take. Past
          // that the rest boils off into the dark, and that water came from
          // an ice moon.
          evap = removed;
          trapLoss = evap * this.trapSlip(evap);
          energy = this.dryEnergy();
          filterKw = throughput * energy;
          break;
        case 'eopress':
          energy = this.eoEnergy(spec.sulphide);
          filterKw = throughput * energy;
          break;
        case 'deeppress':
          // Every cubic metre of filtrate lands inside a one-atmosphere hull,
          // and has to be pumped back out against the same sea that pressed it.
          filterKw = ((removed / 3600) * clamp(sp.seaDp, 10, 440) * 100) / 0.75;
          energy = throughput > 0.1 ? filterKw / throughput : 0;
          break;
      }
      filtrate = stream(bleed, removed - trapLoss, 0);
      this.cost.water += trapLoss * dtH * DESIGN.costWaterLost;
      this.cost.spill += bleed * dtH * DESIGN.costPlume;

      // The underflow pump then runs on surge-tank level control, not flat out -
      // so when the press backs off, the thickener bed is what starts to build.
      const levelSp = 0.62 * DESIGN.ufTankVol;
      const makeUp = Math.max(0, (levelSp - this.ufVol) / (10 / 60)); // restore over 10 min, m3/h
      const ufVolWanted = run ? drawVol + makeUp : 0;
      const ufDryWanted = ufVolWanted * rhoUf * this.ufCwActual;

      if (inline) {
        // Fines always leave with the overflow, and a cyclone pushed to a
        // denser underflow sends more of them. With no bed to hold the rest,
        // whatever the surge tank cannot take is bypassed back where it came
        // from.
        const lossFrac = clamp(0.006 + 0.2 * Math.max(0, this.ufCwActual - 0.50), 0.006, 0.05);
        solidsLost = feedSolids * lossFrac;
        const avail = Math.max(0, feedSolids - solidsLost);
        ufDry = Math.max(0, Math.min(ufDryWanted, avail, this.ufTankHeadroomDry(dtH)));
        excess = avail - ufDry;
        this.bed = 0;
        this.torque = 0;
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
          + 'the cyclone underflow is set too dense',
          'Overflow fines back under control');
        this.cond('uf-limited', sp.ufCw > maxUfCw + 0.002, 'info',
          'Cyclone underflow tops out at ' + (maxUfCw * 100).toFixed(1) + '%',
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

        // Each settler runs against its own limit, and all three read as a
        // percentage the way a rake torque does. A ring loaded with a dense,
        // uneven bed wobbles as the square of its speed; a stack's coils heat
        // as the square of their field, and take minutes to do it.
        const uf = this.ufCwActual;
        const limitTarget = dw === 'spinring'
          ? (run ? 14 + (spin / 10) ** 2 * (20 + 260 * Math.max(0, uf - 0.56) + 0.3 * bedPct) : 6)
          : dw === 'magstack'
          ? (run ? 22 + 52 * field * field + 0.12 * bedPct : 15)
          : (run ? 28 + 300 * Math.max(0, uf - 0.55) + 0.32 * bedPct : 18);
        this.torque = approach(this.torque, limitTarget, dw === 'magstack' ? 240 : 30, dt);

        const limit = dw === 'spinring' ? ['Ring imbalance', 'slow the ring or back the underflow density off']
          : dw === 'magstack' ? ['Coil temperature', 'back the field off']
          : ['Rake torque', 'back the underflow density off'];
        this.cond('rake-trip', this.torque > 92, 'trip',
          limit[0] + ' ' + this.torque.toFixed(0) + '% - ' + limit[1],
          limit[0] + ' back within limits');
        this.cond('rake-high', this.torque > 78 && this.torque <= 92, 'warn',
          limit[0] + ' high at ' + this.torque.toFixed(0) + '%',
          limit[0] + ' normal');
        this.cond('thk-rise', overload > 0.05, 'warn',
          dw === 'spinring'
            ? 'Solids carrying over the ring weir at ' + clarity.toFixed(0) + ' mg/L - spin it up or add polymer'
            : dw === 'magstack'
            ? 'Flocs escaping the top of the stack at ' + clarity.toFixed(0) + ' mg/L - more field or more seeded floc'
            : 'Bed rising - overflow at ' + clarity.toFixed(0) + ' mg/L, add flocculant',
          'Overflow clarity recovered');
        this.cond('thk-bed', bedPct > 96, 'warn',
          k.settler[0].toUpperCase() + k.settler.slice(1) + ' bed near capacity',
          k.settler[0].toUpperCase() + k.settler.slice(1) + ' bed drawn down');
        this.cond('uf-limited', sp.ufCw > maxUfCw + 0.002, 'info',
          'Underflow density capped at ' + (maxUfCw * 100).toFixed(1) + '% by '
          + (dw === 'spinring' ? 'polymer and ring speed'
            : dw === 'magstack' ? 'seeded floc and field' : 'flocculant dose'),
          'Underflow density setpoint now achievable');
      }
    }
    this.lastExcess = excess;

    this.rakeAngle += dt * 0.0105 * (run ? 1 : 0.15); // ~10 min per revolution

    // ================= 3. Filter + cake bin ==============================
    if (dw !== 'dry') {
      this.cond('uf-low', run && this.ufVol < 8, 'warn',
        'Underflow surge tank low - the ' + k.filter + ' is out-running the ' + k.settler,
        'Underflow surge tank recovered');

      // A press with nothing to filter does not keep shuttling its plates. Stop
      // the plant and the pack holds wherever the cycle had got to, which is
      // also what you come back to when you start it again.
      if (run && sp.cycleTime > 0 && batch(DESIGN.filter)) {
        this.cyclePhase = (this.cyclePhase + dt / (sp.cycleTime * 60)) % 1;
      }
      this.cond('trap', run && evap > 0.5 && this.trapSlip(evap) > 0.08, 'warn',
        'Cold trap saturating - ' + trapLoss.toFixed(1) + ' t/h of water vapour getting past it '
        + 'into space. Ease the magnetrons off, or spin the ring for a denser feed.',
        'Cold trap catching the vapour again');
      this.cond('bleed', bleed > 0.8, 'warn',
        'Fines forced through the cloth at ' + bleed.toFixed(1) + ' t/h - straight out to '
        + 'sea. Ease the sea differential.',
        'Filtrate running clear again');
    }
    const pressing = batch(DESIGN.filter) ? this.cyclePhase < 0.78 : throughput > 0.5;

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

    const pasteCwForSlump = this.cwForSlump(sp.targetSlump, binderPct, binder);
    const maxPasteCw = this.maxAchievableCw(cakeBinCw, binderPct);
    const waterLimited = pasteCwForSlump > maxPasteCw + 1e-4;
    const pasteCw = Math.min(pasteCwForSlump, maxPasteCw);

    const recipe = this.makePaste(1, binderPct, pasteCw);
    const pasteRho = slurryDensity(recipe);
    const pcv = Cv(recipe);
    const tauY = yieldStress(pcv, binderPct) * this.feedFx.yieldStress * binder.stiffness;
    const eta = plasticViscosity(pcv);
    const slumpAchieved = slump(tauY, pasteRho);
    const slumpCone = coneSlump(tauY, pasteRho);
    const ucs = ucs28(binderPct, Cw(recipe), binder.density) * binder.strength
      * this.feedFx.ucs * this.cure(binder);

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

    this.cost.binder += binderRate * dtH * binder.price;
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
      'Cake bin empty - the ' + k.filter + ' cannot keep up with the pump',
      'Cake bin recovered - the ' + k.filter + ' is keeping up again');
    this.cond('cake-full', this.cakeMass > DESIGN.cakeBinCap * 0.96, 'warn',
      'Cake bin full - the ' + k.filter + ' will back up', 'Cake bin drawing down');
    // You can add water at the mixer and never take it out, so a cake wetter
    // than the recipe puts a ceiling on how stiff the paste can be.
    this.cond('water-limited', waterLimited, 'warn',
      'Cake too wet for the slump target - ' + {
        press: 'lengthen the press cycle',
        deeppress: 'more sea differential, or a longer cycle',
        microwave: 'more magnetron power, or a slower belt',
        eopress: 'more voltage, or a slower belt',
        none: 'the feed is as dry as it comes',
      }[DESIGN.filter] + ' - or raise the target',
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
    this.cost.power += (power + (run ? DESIGN.auxPowerKw : 40) + settlerKw + filterKw)
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
        g: gRel,
        field,
        power: settlerKw,
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
        power: filterKw,
        energy: DESIGN.filter === 'microwave' ? this.dryEnergy()
          : DESIGN.filter === 'eopress' ? this.eoEnergy(spec.sulphide) : energy,
        evap, trapLoss, bleed,
        dp: DESIGN.filter === 'deeppress' ? clamp(sp.seaDp, 10, 440) : 0,
        volts: DESIGN.filter === 'eopress' ? clamp(sp.voltage, 0, 90) : 0,
        belt: batch(DESIGN.filter) ? 0 : clamp(sp.belt, 10, 100),
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
        binder,
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

  /** The binder in the silo right now: whichever of this site's two is selected. */
  private binder(): BinderSpec {
    const [a, b] = DESIGN.binders;
    return this.up.binderType === b.id ? b : a;
  }

  /** Fraction of its lab strength a binder reaches in this site's cure. */
  private cure(b: BinderSpec): number {
    return 1 - (1 - DESIGN.cureFactor) * (1 - b.cold);
  }

  /** Dry throughput the filter can hold, t/h. */
  private filterCapacity(): number {
    const fx = this.feedFx.filterCapacity;
    switch (DESIGN.filter) {
      // A belt's tonnes are its speed. A microwave heats water wherever it
      // sits, so fines hardly slow it down; a belt press still has to drain.
      case 'microwave':
        return DESIGN.beltCap * (clamp(this.sp.belt, 10, 100) / 100) * Math.pow(fx, 0.25);
      case 'eopress':
        return DESIGN.beltCap * (clamp(this.sp.belt, 10, 100) / 100) * Math.pow(fx, 0.6);
      default: {
        // A press falls off as the square root of its cycle time, and Ruth's
        // law has filtration rate rising as the square root of the pressure
        // across the cake - which on the seabed is whatever you let the sea put there.
        const tc = clamp(this.sp.cycleTime, 1.5, 14);
        const feedFactor = clamp(this.ufCwActual / 0.60, 0.55, 1.35);
        const sea = DESIGN.filter === 'deeppress' ? Math.sqrt(clamp(this.sp.seaDp, 10, 440) / 60) : 1;
        return ((3.55 * DESIGN.filterArea) / Math.sqrt(tc)) * feedFactor * fx * sea;
      }
    }
  }

  /** Cake moisture, % wet basis. */
  private cakeMoisture(): number {
    const fxm = this.feedFx.cakeMoisture;
    switch (DESIGN.filter) {
      case 'microwave': {
        // whatever water the energy put into each tonne boils off, down to
        // the film the grains will not let go of
        const wIn = (1 - this.ufCwActual) / Math.max(this.ufCwActual, 0.3);
        const wOut = Math.max(0.025 * fxm, wIn - this.dryEnergy() / DESIGN.evapKwh);
        return clamp((100 * wOut) / (1 + wOut), 2, 45);
      }
      case 'eopress': {
        // The belts alone manage a poor squeeze, and poorer still on a thin
        // feed. The field drags the rest of the water through to the cathode,
        // for as long as the cake is in it.
        const belt = clamp(this.sp.belt, 10, 100);
        const thin = Math.pow(0.6 / Math.max(this.ufCwActual, 0.4), 0.8);
        const squeeze = (30 + (8 * belt) / 100) * Math.sqrt(fxm) * thin;
        const dose = (clamp(this.sp.voltage, 0, 90) * (60 / belt)) / 45;
        return clamp(squeeze - 16 * (1 - Math.exp(-dose)), 7, 40);
      }
      default: {
        // Longer cycles squeeze harder, with diminishing return - and so does
        // a harder squeeze.
        const tc = clamp(this.sp.cycleTime, 1.5, 14);
        const deep = DESIGN.filter === 'deeppress';
        const sea = deep ? Math.pow(clamp(this.sp.seaDp, 10, 440) / 60, -0.12) : 1;
        return clamp((11.5 + 14 / Math.pow(tc, 0.55)) * fxm * sea, deep ? 6 : 9, 30);
      }
    }
  }

  /**
   * Fraction of the vapour that gets past the cold trap. A few percent always
   * does; past about half its rating the fins frost over faster than they
   * are scraped, and the fraction climbs as the square of the overload.
   */
  private trapSlip(evap: number): number {
    return clamp(0.02 + 0.5 * Math.max(0, evap / DESIGN.trapCap - 0.6) ** 2, 0, 0.9);
  }

  /** Microwave energy put into each dry tonne on the belt, kWh/t. */
  private dryEnergy(): number {
    return (clamp(this.sp.mwPower, 0, 20) * 1000) / Math.max(this.filterCapacity(), 1);
  }

  /**
   * Electro-osmotic energy per dry tonne, kWh/t: the volts squared across a
   * cake whose pore water conducts - more so when it is full of dissolved
   * pyrite - for as long as the belt keeps it between the electrodes.
   */
  private eoEnergy(sulphide: number): number {
    const belt = clamp(this.sp.belt, 10, 100);
    return DESIGN.eoKwh * clamp(this.sp.voltage, 0, 90) ** 2 * (1 + 0.35 * sulphide) * (60 / belt);
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
  private cwForSlump(targetSlump: number, binderPct: number, binder: BinderSpec): number {
    let lo = 0.58, hi = 0.90;
    const stiff = this.feedFx.yieldStress * binder.stiffness;
    for (let i = 0; i < 44; i++) {
      const mid = 0.5 * (lo + hi);
      const s = this.makePaste(1, binderPct, mid);
      const v = slump(yieldStress(Cv(s), binderPct) * stiff, slurryDensity(s));
      if (v > targetSlump) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }
}

export { EMPTY };
