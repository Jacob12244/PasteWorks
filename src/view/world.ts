import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { C, metal, matte, glass, glow, liquor } from './palette';
import {
  box, cyl, tube, strip, platform, railing, ladder, bands, ribs,
  pipeRun, pipeSupport, plinth, LevelBar, Beacon, Tag,
} from './parts';
import { flowMaterial, setFlow, tickFlows, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Overflow } from './spill';
import { Unit, Thickener, SurgeTank, PlatePress, CakeBin, BinderSilo, Mixer, PastePump } from './units';
import { buildGround, Underground, PasteLine, scaleFigure, CUT_X } from './terrain';
import { UpstreamCircuit } from './upstream';
import { RoomDecor } from './room';
import type { Scenario, WorldKind } from '../scenario/types';
import type { Dressing } from './worlds/common';
import { buildSpace, LaunchFeed, MassDriver, PIT_HOLE } from './worlds/space';
import { buildOcean, SeafloorLine, Furrow, FURROW_HOLE } from './worlds/ocean';
import { buildCity } from './worlds/city';
import { buildWaste, FillLine, Craters, CRATER_HOLE } from './worlds/waste';
import { CycloneBank, Centrifuge } from './dewater';
import { CollectorFront, ReclaimFront, ScoopFront } from './fronts';
import { sheet, type Sheet } from '../scenario/flowsheet';
import { Deliveries } from './deliveries';
import { UP } from './upstream';
import { Stage } from './scene';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Process water tank - thickener overflow and filter filtrate land here and
 * go back out as mixer make-up. Closing this loop is most of what makes a
 * backfill plant defensible on a water balance.
 */
class WaterTank extends Unit {
  readonly id = 'water';
  readonly name = 'Process Water';

  private level: LevelBar;
  private contents: THREE.Mesh;
  private surface: THREE.Mesh;
  private surfaceMat: THREE.MeshStandardMaterial;
  private overflow: Overflow;
  private inletSpout: Spout;
  private inlet = new THREE.Object3D();
  private beacon = new Beacon();
  private _w = new THREE.Vector3();

  private readonly R = 4.2;
  private readonly H = 7;

  constructor(fx: FX) {
    super('PROCESS WATER', 2.4, '#3fa9f5');
    const { R, H } = this;
    const g = this.group;

    // Shell cut away down one side behind a sight glass, so the level in here
    // is something you watch. This is the tank that tells you whether the
    // water balance is winning.
    const GAP = 0.6;
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H, 44, 1, true, GAP / 2, Math.PI * 2 - GAP),
      new THREE.MeshStandardMaterial({
        color: 0x3a4654, roughness: 0.55, metalness: 0.85, side: THREE.DoubleSide,
      }),
    );
    shell.position.y = H / 2;
    shell.castShadow = shell.receiveShadow = true;
    g.add(shell);

    const pane = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.03, R + 0.03, H - 0.4, 10, 1, true, -GAP / 2, GAP),
      glass(0xc8e8ff, 0.14),
    );
    pane.position.y = H / 2;
    g.add(pane);

    for (const s of [-1, 1]) {
      const a = (s * GAP) / 2;
      const post = box(0.16, H, 0.22, metal(C.steelLight, 0.45, 0.9));
      post.position.set(Math.sin(a) * R, H / 2, Math.cos(a) * R);
      post.rotation.y = a;
      g.add(post);
    }

    g.add(bands(R, [1.6, 4.4]));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.05, 0.12, 8, 44), metal(C.steelDark));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = H;
    g.add(rim);

    this.contents = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.12, R - 0.12, 1, 36), liquor(C.water, 1),
    );
    g.add(this.contents);

    this.surfaceMat = new THREE.MeshStandardMaterial({
      color: C.water, emissive: C.water, emissiveIntensity: 0.15,
      roughness: 0.22, metalness: 0.1,
    });
    this.surface = new THREE.Mesh(new THREE.CircleGeometry(R - 0.12, 36), this.surfaceMat);
    this.surface.rotation.x = -Math.PI / 2;
    g.add(this.surface);

    // where the launder and the filtrate land, so it is visibly being fed
    this.inlet.position.set(0, H - 0.6, -R + 1.2);
    g.add(this.inlet);
    this.inletSpout = new Spout(fx.liquid, 18, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, -1.6, 0),
      spread: new THREE.Vector3(0.7, 0.4, 0.7),
      jitter: new THREE.Vector3(0.3, 0.1, 0.3),
      colour: C.water, size: 0.14, sizeVary: 0.5,
      life: 0.6, gravity: -9.81, drag: 0.6,
    }));

    this.overflow = new Overflow(R, H, C.water, fx, { streams: 5, splashy: true });
    g.add(this.overflow.group);

    this.level = new LevelBar(H - 0.8, C.water, 0.38);
    this.level.group.position.set(-R - 0.25, 0.5, 0);
    this.level.group.rotation.y = -Math.PI / 2;
    g.add(this.level.group);

    this.beacon.group.position.set(R + 1.0, 0, 1.4);
    g.add(this.beacon.group);

    const lad = ladder(H + 0.6);
    lad.position.set(0, 0, -R - 0.3);
    g.add(lad);

    this.focus.set(0, 4, 0);
    this.mountTag(H + 4.5);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const w = t.water;
    const f = Math.max(0.02, Math.min(1, w.pct / 100));
    const h = f * (this.H - 0.5);
    const top = 0.25 + h;

    this.contents.scale.y = h;
    this.contents.position.y = 0.25 + h / 2;
    this.surface.position.y = top + 0.02 + Math.sin(t.time * 2.1) * 0.02;
    this.surfaceMat.emissiveIntensity = 0.13 + 0.05 * Math.sin(t.time * 0.9);

    this.level.setLevel(f, f > 0.88 ? C.red : f > 0.75 ? C.amber : C.water);

    this.inlet.getWorldPosition(this._w);
    this._w.y = top + 0.2;
    this.inletSpout.run(dt, w.recovered > 5 ? 1 : 0, this._w);

    const spill = t.spills.water;
    this.overflow.update(dt, Math.min(1, spill / 25), t.spills.totalM3);

    this.beacon.set(
      spill > 0.5 ? C.red : f > 0.88 ? C.amber : C.lime,
      spill > 0.5 ? 6 : 2.2,
    );

    this.tag.set(
      spill > 0.5 ? 'SPILL' : f * 100 > 99 ? 'FULL' : (w.pct).toFixed(0) + '%',
      spill > 0.5
        ? spill.toFixed(0) + ' m3/h to the pad'
        : w.returnCap >= 1e5 ? w.toMill.toFixed(0) + ' m3/h back, closed loop'
        : w.toMill.toFixed(0) + ' / ' + w.returnCap.toFixed(0) + ' m3/h to mill',
      spill > 0.5 ? 'trip' : f > 0.88 ? 'warn' : 'ok',
    );
  }
}

/** A work-class ROV: yellow box, thrusters, two lamps. What passes for staff down here. */
function rov(): THREE.Group {
  const g = new THREE.Group();
  const body = box(1.8, 1.0, 1.2, metal(0xe0b830, 0.5, 0.4));
  g.add(body);
  const frame = box(1.9, 0.2, 1.3, metal(C.steelDark));
  frame.position.y = -0.55;
  g.add(frame);
  for (const z of [-0.75, 0.75]) {
    const th = cyl(0.22, 0.22, 0.5, metal(C.steelDark), 10);
    th.rotation.z = Math.PI / 2;
    th.position.set(-0.8, 0.2, z);
    g.add(th);
  }
  for (const z of [-0.35, 0.35]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow(0xfff0c8, 3));
    l.position.set(0.92, 0.1, z);
    g.add(l);
  }
  return g;
}

/**
 * The pressure sphere the control room sits in at 4,400 m. From the chair
 * you see its frame through the window, and whatever is swimming past it.
 */
function pressureSphere(): THREE.Group {
  const g = new THREE.Group();
  const R = 9.6;
  const skin = new THREE.Mesh(
    new THREE.SphereGeometry(R, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.6),
    new THREE.MeshStandardMaterial({
      color: 0xbfe6ff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.2,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  g.add(skin);
  // only the part of the frame above the seabed
  const edges = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R, 2));
  const pos = edges.attributes.position as THREE.BufferAttribute;
  const keep: number[] = [];
  for (let i = 0; i < pos.count; i += 2) {
    if (pos.getY(i) > -2.9 && pos.getY(i + 1) > -2.9) {
      keep.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  g.add(new THREE.LineSegments(fg, new THREE.LineBasicMaterial({
    color: 0x7fb8d4, transparent: true, opacity: 0.35,
  })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.96, 0.45, 10, 64), metal(C.steelDark, 0.5, 0.8));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -2.9;
  g.add(ring);
  const lit = new THREE.Mesh(new THREE.TorusGeometry(R * 0.96, 0.08, 6, 64), glow(C.cyan, 1.4));
  lit.rotation.x = Math.PI / 2;
  lit.position.y = -2.4;
  g.add(lit);
  g.position.y = 3.2;
  return g;
}

/** Plot plan: where the units that other things have to reach are standing. */
const SITE = {
  surge: { x: -30, z: 7 },
  cakeBin: { x: 2 },
  mixer: { x: 17 },
  silo: { x: 6, z: -17 },
  water: { x: -2, z: 17 },
};

/** Where the control room stands, and where the operator sits inside it. */
export const CONTROL = {
  // Set back across the pad, so the window actually overlooks the plant
  // rather than pressing up against the side of the press house.
  x: -14, z: 50,
  /** the operator's eye, in room-local coordinates */
  eyeY: 3.35,
  eyeZ: 1.4,
  /** the chair faces the plant, tipped down at the desk */
  pitch: -0.22,
};

/**
 * Control room.
 *
 * It is the one piece of human-sized architecture on site, so it does the
 * scale-setting work, and it is the way into the operator view: click it and
 * you are sitting at the desk behind the glass with the mimic up.
 */
class ControlRoom extends Unit {
  readonly id = 'control';
  readonly name = 'Control Room';

  private winMat: THREE.MeshStandardMaterial;
  private deskGlow: THREE.MeshStandardMaterial;
  private aerial: THREE.Mesh;
  private monitors = new THREE.Group();
  private decor: RoomDecor;

  constructor(scenario: Scenario) {
    super('CONTROL ROOM', 2.4, '#35e0d0');
    this.decor = new RoomDecor(scenario.look.world);
    const g = this.group;

    const plinth = box(12.5, 1.1, 8.0, matte(0x252b34, 0.95));
    plinth.position.y = 0.55;
    g.add(plinth);

    // Double sided throughout, because the operator view puts the camera
    // INSIDE this box: single-sided walls simply vanish from in here.
    const wall = metal(0x313945, 0.8, 0.2).clone();
    wall.side = THREE.DoubleSide;

    const floor = box(10.8, 0.08, 6.4, matte(0x1d232c, 0.9));
    floor.position.y = 1.14;
    g.add(floor);
    for (const [w, h, d, x, y, z] of [
      [0.25, 4.4, 6.4, -5.4, 3.3, 0],   // west
      [0.25, 4.4, 6.4, 5.4, 3.3, 0],    // east
    ] as const) {
      const m = box(w, h, d, wall);
      m.position.set(x, y, z);
      g.add(m);
    }

    // Glazed on both long walls: the plant side is what the operator watches,
    // and the approach side is what makes the hut read as a control room from
    // the rest of the site rather than as a shed.
    this.winMat = new THREE.MeshStandardMaterial({
      color: 0x0c1a24, emissive: 0x2ba5b8, emissiveIntensity: 0.30,
      roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide,
    });
    // head and sill stop where the glass starts, so nothing shares a plane
    for (const z of [-3.2, 3.2]) {
      for (const [h, y] of [[1.0, 5.2], [1.7, 1.95]] as const) {
        const m = box(11, h, 0.25, wall);
        m.position.set(0, y, z);
        g.add(m);
      }
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 1.9), this.winMat);
      pane.position.set(0, 3.75, z);
      g.add(pane);
      // Enough mullions that the glazing reads as a window from two metres
      // away, where a single pane just looks like a hole in the wall.
      for (const x of [-5.3, -3.5, -1.75, 0, 1.75, 3.5, 5.3]) {
        const mull = box(0.22, 2.0, 0.22, metal(C.steelDark));
        mull.position.set(x, 3.75, z);
        g.add(mull);
      }
      const transom = box(11, 0.16, 0.22, metal(C.steelDark));
      transom.position.set(0, 2.82, z);
      g.add(transom);
      const eaveStrip = strip(11.0, C.cyan, 0.08, 1.4);
      eaveStrip.position.set(0, 5.45, z * 1.09);
      g.add(eaveStrip);
    }

    // the desk the player sits at, with its own bank of screens
    const desk = box(7.4, 0.14, 1.5, metal(0x39434f, 0.6, 0.6));
    desk.position.set(0, 2.5, 0.2);
    g.add(desk);
    for (const x of [-3.3, 3.3]) {
      const leg = box(0.16, 1.4, 1.3, metal(C.steelDark));
      leg.position.set(x, 1.8, 0.2);
      g.add(leg);
    }
    // double sided, so the desk reads as lit from outside either window
    this.deskGlow = new THREE.MeshStandardMaterial({
      color: 0x0a141c, emissive: 0x35e0d0, emissiveIntensity: 1.1,
      roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), this.deskGlow);
      scr.position.set(-2.55 + i * 1.7, 3.1, -0.25);
      scr.rotation.x = -0.14;
      this.monitors.add(scr);
      const stand = box(0.1, 0.42, 0.1, metal(C.steelDark));
      stand.position.set(-2.55 + i * 1.7, 2.72, -0.1);
      this.monitors.add(stand);
    }
    g.add(this.monitors);
    for (const x of [-2.8, 2.8]) {
      const seat = cyl(0.44, 0.44, 0.12, matte(0x1e2630, 0.9), 14);
      seat.position.set(x, 2.0, 1.4);
      g.add(seat);
      const back = box(0.5, 0.7, 0.1, matte(0x1e2630, 0.9));
      back.position.set(x, 2.45, 1.85);
      g.add(back);
      const stem = tube(0.07, 0.85, metal(C.steelDark), 8);
      stem.position.set(x, 1.55, 1.4);
      g.add(stem);
    }

    const roofMat = metal(0x2a313b, 0.8, 0.3).clone();
    roofMat.side = THREE.DoubleSide;
    const roof = box(12, 0.4, 7.6, roofMat);
    roof.position.y = 5.7;
    g.add(roof);
    const door = box(0.14, 2.2, 1.2, metal(C.steelDark, 0.6, 0.5));
    door.position.set(5.48, 2.2, 1.6);
    g.add(door);
    for (let i = 0; i < 3; i++) {
      const st = box(0.36, 0.16, 1.6, metal(C.steelLight));
      st.position.set(5.86 + i * 0.36, 0.3 + i * 0.36, 1.6);
      g.add(st);
    }

    const hvac = box(2.2, 0.9, 1.6, metal(C.steelLight, 0.6, 0.7));
    hvac.position.set(-3, 6.3, 1.4);
    g.add(hvac);
    const mastPole = tube(0.07, 4.5, metal(C.steelLight), 6);
    mastPole.position.set(4.4, 8.1, 2.4);
    g.add(mastPole);
    this.aerial = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glow(C.red, 2.4));
    this.aerial.position.set(4.4, 10.4, 2.4);
    g.add(this.aerial);

    g.add(this.decor.group);
    if (scenario.look.bubble) g.add(pressureSphere());

    const lamp = new THREE.PointLight(0x8fe8ff, 26, 18, 2);
    lamp.position.set(0, 4.9, 0.4);
    g.add(lamp);

    this.focus.set(0, 3.5, -0.6);
    this.viewOffset = new THREE.Vector3(6, 9, -22);
    this.mountTag(9.2);
  }

  /**
   * Sitting down puts the camera in the chair, so the desk monitors would be
   * inside your face. The real SCADA screens take over from them.
   */
  setSeated(on: boolean) {
    this.monitors.visible = !on;
  }

  update(t: Telemetry) {
    this.decor.update(t);
    const trip = t.pipe.plugged || t.spills.water > 0.5 || t.spills.slurry > 0.5;
    this.deskGlow.emissive.setHex(trip ? C.red : t.status === 'idle' ? 0x2b7fa0 : C.cyan);
    this.deskGlow.emissiveIntensity = 0.7 + (trip ? 0.9 : 0.4) * (0.5 + 0.5 * Math.sin(t.time * 3));
    this.winMat.emissiveIntensity = t.status === 'idle' ? 0.16 : 0.30;
    (this.aerial.material as THREE.MeshStandardMaterial).emissiveIntensity =
      1.6 + 1.6 * (0.5 + 0.5 * Math.sin(t.time * 1.6));
    this.tag.set(
      t.status === 'blocked' ? 'TRIP' : t.status.toUpperCase(),
      'operator console  ·  click to sit down',
      t.status === 'blocked' ? 'trip' : t.status === 'starved' ? 'warn' : 'ok',
    );
  }
}

export interface Pick {
  unit: Unit;
}

export class World {
  units: Unit[] = [];
  root = new THREE.Group();
  private byId = new Map<string, Unit>();
  private links: FlowMaterial[] = [];
  private linkKinds: string[] = [];
  private raycaster = new THREE.Raycaster();
  private pickables: THREE.Object3D[] = [];
  private outline: THREE.BoxHelper | null = null;
  fx = new FX();
  private underground: Underground | null = null;
  private dressing: Dressing | null = null;
  private rovs: THREE.Object3D[] = [];
  private deliveries: Deliveries | null = null;
  private clock = 0;
  selected: Unit | null = null;

  /**
   * The arena builds the same plant with nobody else on site: no figures
   * standing about for scale (they look like players), and no deliveries
   * driving through the middle of it.
   */
  constructor(private stage: Stage, readonly scenario: Scenario, private opts: { arena?: boolean } = {}) {
    const look = scenario.look;
    stage.applyLook(look);
    const sh = sheet();
    this.root.add(buildGround(
      { ...look.ground, wet: look.world === 'city' },
      look.destination === 'trench' ? [FURROW_HOLE]
        : look.destination === 'craters' ? [CRATER_HOLE]
        : look.world === 'space' ? [PIT_HOLE] : [],
      look.world === 'space' ? 1200 : 300,
    ));

    const place = (u: Unit, x: number, z: number) => {
      u.group.position.set(x, 0, z);
      this.root.add(u.group);
      this.units.push(u);
      this.byId.set(u.id, u);
      u.group.traverse((o) => {
        o.userData.unitId = u.id;
        if ((o as THREE.Mesh).isMesh) this.pickables.push(o);
      });
      return u;
    };

    // The back end of the plant is placed off the mixer, not by eye: the pump
    // hopper sits under the mixer's discharge gate, the cake belt and the
    // binder screw both land on its feed hood, and the paste line picks up
    // where the pump's discharge spool ends.
    const MIX = SITE.mixer;
    const hood = V(MIX.x + Mixer.FEED_X, Mixer.DECK + 4.6, 0);
    const pumpX = MIX.x + Mixer.DISCHARGE_X - PastePump.HOPPER_X;

    // Dewatering is whatever this site can use: a thickener where there is
    // gravity to settle in, cyclones on the seabed, decanters on an asteroid -
    // and nothing at all where the feed is dry. No dewatering, no surge tank,
    // no press.
    let ofStart = V(-52 + DESIGN.thickenerDia / 2 + 3.4 + 2.75, 5.8, 0);
    if (sh.dewater === 'thickener') place(new Thickener(), -52, 0);
    else if (sh.dewater === 'cyclones') {
      const u = place(new CycloneBank(), -52, 0) as CycloneBank;
      ofStart = u.ofOut.clone().add(V(-52, 0, 0));
    } else if (sh.dewater === 'centrifuge') {
      const u = place(new Centrifuge(), -52, 0) as Centrifuge;
      ofStart = u.ofOut.clone().add(V(-52, 0, 0));
    }
    if (sh.hasSurge) place(new SurgeTank(this.fx), SITE.surge.x, SITE.surge.z);
    if (sh.hasPress) place(new PlatePress(), -10, 0);
    place(new CakeBin(hood.clone().sub(V(SITE.cakeBin.x, 0, 0))), SITE.cakeBin.x, 0);
    place(new BinderSilo(V(hood.x - 0.6 - SITE.silo.x, hood.y - 0.7, -1.3 - SITE.silo.z)),
      SITE.silo.x, SITE.silo.z);
    place(new Mixer(), MIX.x, 0);
    place(new PastePump(), pumpX, 0);
    place(new WaterTank(this.fx), SITE.water.x, SITE.water.z);
    place(new ControlRoom(scenario), CONTROL.x, CONTROL.z);
    // and where the feed comes from
    switch (sh.source) {
      case 'collector': place(new CollectorFront(this.fx), 0, 0); break;
      case 'reclaim': place(new ReclaimFront(this.fx), 0, 0); break;
      case 'scoop': place(new ScoopFront(this.fx, SITE.cakeBin.x), 0, 0); break;
      default: place(new UpstreamCircuit(this.fx, { magnetic: sh.separation === 'magnetic' }), 0, 0);
    }

    // Where the paste goes is the one part of the flowsheet that changes from
    // world to world. Every destination is the unit with id 'stope' and every
    // line to it is 'pipeline', so the consoles never need to know which.
    const outlet = pumpX + PastePump.OUTLET_X;
    const names = scenario.names;
    switch (look.destination) {
      case 'launcher':
        place(new LaunchFeed(outlet, names), 0, 0);
        place(new MassDriver(names), 0, 0);
        break;
      case 'trench':
        place(new SeafloorLine(outlet, names), 0, 0);
        place(new Furrow(names), 0, 0);
        break;
      case 'craters':
        place(new FillLine(outlet, names), 0, 0);
        place(new Craters(names), 0, 0);
        break;
      default:
        place(new PasteLine(outlet, names), 0, 0);
        this.underground = new Underground(names);
        place(this.underground, 0, 0);
    }

    this.buildLinks(sh, ofStart);
    this.buildServices();

    // Where a delivery lands: at the foot of the silo for a truck or a pad,
    // over the top of it for anything that flies or is lowered.
    const w = look.world;
    const silo = V(SITE.silo.x, 0, SITE.silo.z);
    const over = w === 'ocean' || w === 'city';
    const binderAt = over ? silo.clone().setY(23)
      : w === 'space' || w === 'waste' ? silo.clone().add(V(9, 0, -8)) : silo.clone();
    const mediaAt = sh.source === 'scoop' ? V(-44, 0, -13)
      : w === 'space' ? V(UP.millX + 8, 0, -20) : V(UP.millX + 8, 0, -8);
    if (!opts.arena) this.deliveries = new Deliveries(this.root, w, binderAt, mediaAt);
    this.buildSiteDressing(look.world);
    this.root.add(this.fx.group);

    switch (look.world) {
      case 'space': this.dressing = buildSpace(this.root, stage.key); break;
      case 'ocean': this.dressing = buildOcean(this.root); break;
      case 'city': this.dressing = buildCity(this.root); break;
      case 'waste': this.dressing = buildWaste(this.root); break;
    }
  }

  /** Where the destination view flies to - different in every world. */
  destinationView(): { at: THREE.Vector3; off: THREE.Vector3 } {
    const u = this.byId.get('stope')!;
    return {
      at: u.group.localToWorld(u.focus.clone()),
      off: u.viewOffset?.clone() ?? V(-40, 24, 60),
    };
  }

  /** The interconnecting pipework that makes it read as one flowsheet. */
  private buildLinks(sh: Sheet, ofStart: THREE.Vector3) {
    const link = (
      kind: string, colour: number, radius: number, pts: THREE.Vector3[], intensity = 1.5,
    ) => {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      const mat = flowMaterial(colour, { density: bandsFor(len), intensity });
      const { group } = pipeRun(pts, radius, mat);
      this.root.add(group);
      this.links.push(mat);
      this.linkKinds.push(kind);
    };

    // A dry feed arrives on the crusher's own belt; there is no slurry to pipe.
    if (sh.dewater === 'dry') {
      this.buildMakeup();
      return;
    }

    // Tailings in from the west on the pipe bridge, then onto the dewatering.
    // For a thickener that means down onto the bridge and along it to the
    // feedwell, beside the drive house and into the feedwell off-centre.
    link('feed', C.tails, 0.4, sh.dewater === 'cyclones' ? [
      V(-84, 15, 0), V(-74, 15, 0), V(-62, 15, 0), V(-55.4, 14.8, 0), V(-52.4, 12.4, 0),
    ] : sh.dewater === 'centrifuge' ? [
      V(-84, 15, 0), V(-74, 15, 0), V(-64, 12.4, 0), V(-59, 8.4, 0), V(-57.6, 7.2, 0),
    ] : [
      V(-84, 15, 0), V(-74, 15, 0), V(-67, 14.6, -0.6), V(-63.4, 10.2, -1.6),
      V(-58, 8.0, -1.6), V(-53.4, 8.0, -1.6), V(-52.9, 6.3, -1.6),
    ]);
    // The west end is an anchor, not a loose end: the transfer riser from the
    // front end comes up beside it. Nothing stands inside the tank - the last
    // support is on the rim walkway, not in the liquor.
    for (const [x, h] of [[-85.4, 14.6], [-80, 14.6], [-72, 14.6], [-66.5, 14.2]] as const) {
      const s = pipeSupport(h, 2.0);
      s.position.set(x, 0, 0);
      this.root.add(s);
    }

    // Thickener underflow -> surge tank, landing on the inlet nozzle at the
    // edge of the roof. The middle of the roof is the agitator drive.
    const sx = SITE.surge.x, sz = SITE.surge.z;
    link('uf', C.thickUf, 0.3, [
      V(-52, 0.7, 0), V(-45, 0.9, 2), V(-42.5, 3, 6), V(-42.5, 14.2, 6.2),
      V(sx - 5.2, 14.4, sz - 2.4), V(sx - 0.2, 14.4, sz - 2.4), V(sx, 13.0, sz - 2.4),
    ]);

    // surge tank -> press feed
    if (sh.hasPress) link('press', C.thickUf, 0.26, [
      V(-30, 2.4, 7), V(-25, 2.2, 5), V(-20, 3.2, 0), V(-17, 6.4, -1.8), V(-13, 6.55, -1.8),
    ]);

    // Thickener overflow runs back to process water on an overhead rack
    // rather than across the pad at knee height. It picks up from the end of
    // the launder downcomer, and goes round the south side of the surge tank -
    // it used to run straight through it.
    const RACK = 9.6;
    const o = ofStart;
    link('of', C.water, 0.26, [
      o.clone(), V(o.x + 0.6, RACK, o.z + 0.6), V(o.x + 0.8, RACK, sz + 5.6),
      V(-24, RACK, sz + 6), V(-12, RACK, 17), V(-4.2, RACK, 17), V(-3.6, 7.2, 17),
    ], 0.75);
    for (const [x, z] of [[o.x + 0.7, sz], [-26, sz + 5.9], [-12, 17]] as const) {
      const s = pipeSupport(RACK - 0.4, 1.4);
      s.position.set(x, 0, z);
      this.root.add(s);
    }

    // filtrate -> process water
    link('filtrate', C.water, 0.18, [
      V(-3.5, 6.4, 1.8), V(-2.0, 8.2, 6), V(-1.2, 8.4, 11), V(-1.6, 7.6, 14.2),
    ], 0.75);

    this.buildMakeup();
  }

  /**
   * Process water -> mixer make-up, to the far end of the spray ring main.
   * The binder screw belongs to the silo itself, so there is no second binder
   * line here any more - there used to be two running side by side.
   */
  private buildMakeup() {
    const mx = SITE.mixer.x, ring = Mixer.DECK + 3.3;
    const pts = [
      V(1.6, 6.4, 16), V(8, 9.6, 14), V(mx + 2, 12.2, 6), V(mx + 5.2, 11.8, 1.6),
      V(mx + 4.85, ring, 1.6),
    ];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    const mat = flowMaterial(C.water, { density: bandsFor(len), intensity: 0.9 });
    this.root.add(pipeRun(pts, 0.18, mat).group);
    this.links.push(mat);
    this.linkKinds.push('makeup');
  }

  /**
   * The services pipe rack along the north side of the mixing tower: flush
   * water, gland water and compressed air on top, the cable tray underneath,
   * dropping into a services pit at each end. It carries nothing the sim
   * models, which is exactly how a real one looks - most of what is on a
   * pipe rack is not the process.
   */
  private buildServices() {
    const Z = -7.5, X0 = 0, X1 = 30, TOP = 4.8, TRAY = 3.7;
    const steel = metal(C.steel, 0.65, 0.9);
    const g = new THREE.Group();
    for (let x = X0; x <= X1; x += 6) {
      const post = box(0.3, TOP, 0.3, steel);
      post.position.set(x, TOP / 2, Z);
      g.add(post);
      for (const y of [TOP, TRAY]) {
        const arm = box(0.22, 0.22, 2.4, steel);
        arm.position.set(x, y, Z);
        g.add(arm);
      }
      const foot = plinth(0.8, 0.3, 0.8);
      foot.position.set(x, 0, Z);
      g.add(foot);
    }
    for (const dz of [-1.1, 1.1]) {
      const stringer = box(X1 - X0, 0.18, 0.14, steel);
      stringer.position.set((X0 + X1) / 2, TOP + 0.02, Z + dz);
      g.add(stringer);
    }
    const services: Array<[number, number, number]> = [
      [0x2f6f9a, 0.17, -0.7],   // flush water
      [0x3f8a5a, 0.12, -0.2],   // gland water
      [0x7d8b99, 0.14, 0.3],    // compressed air
      [0x2f6f9a, 0.1, 0.75],    // wash-down
    ];
    for (const [colour, r, dz] of services) {
      const y = TOP + 0.11 + r;
      const pts = [
        V(X0 - 1.2, 0.3, Z + dz), V(X0 - 1.2, y, Z + dz), V(X1 + 1.2, y, Z + dz), V(X1 + 1.2, 0.3, Z + dz),
      ];
      g.add(pipeRun(pts, r, metal(colour, 0.5, 0.5)).group);
    }
    const tray = box(X1 - X0 + 2.4, 0.12, 0.7, metal(C.handrail, 0.6, 0.3));
    tray.position.set((X0 + X1) / 2, TRAY + 0.17, Z);
    g.add(tray);
    for (const x of [X0 - 1.2, X1 + 1.2]) {
      const pit = box(1.2, 0.5, 2.6, matte(C.concrete, 0.95));
      pit.position.set(x, 0.25, Z);
      g.add(pit);
      const drop = box(0.7, TRAY + 0.1, 0.12, metal(C.handrail, 0.6, 0.3));
      drop.position.set(x + (x < 10 ? 0.5 : -0.5), (TRAY + 0.3) / 2, Z + 0.9);
      g.add(drop);
    }
    this.root.add(g);
  }

  private buildSiteDressing(kind: WorldKind) {
    // People, for scale - except at 4,400 m, where it is ROVs, and on an
    // Earth everyone left, where it is the caretaker.
    const spots = [
      [-44, 12, 0], [-14, 9.5, 6.1], [4.5, 6.5, 0], [22, 3.0, 7.1], [-18, 20, 0],
    ] as const;
    spots.forEach(([x, z, y], i) => {
      if (kind === 'waste' || this.opts.arena) return;
      const p = kind === 'ocean' ? rov() : scaleFigure(z > 8 ? C.amber : C.lime);
      p.position.set(x, kind === 'ocean' ? 4 + i * 1.7 : y, z);
      p.rotation.y = (i * 2.3) % 6;
      this.root.add(p);
      if (kind === 'ocean') { p.userData.noCollide = true; this.rovs.push(p); }
    });

    // a light mast or two
    for (const [x, z] of [
      [-34, -16], [12, 14], [-60, 14], [-100, -22], [-124, 4],
    ] as const) {
      const mast = new THREE.Group();
      const pole = tube(0.22, 18, metal(C.steel), 10);
      pole.position.y = 9;
      mast.add(pole);
      const head = box(2.4, 0.3, 0.8, metal(C.steelDark));
      head.position.y = 18;
      mast.add(head);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 0.6), glow(0xffe9c4, 3));
      lamp.position.set(0, 17.85, 0);
      mast.add(lamp);
      const l = new THREE.PointLight(0xffe9c4, 160, 70, 2);
      l.position.set(0, 17.5, 0);
      mast.add(l);
      // underwater the light has somewhere to be seen: a cone of lit snow
      if (kind === 'ocean') {
        const beam = new THREE.Mesh(
          new THREE.ConeGeometry(11, 17.5, 28, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0x9fd8ff, transparent: true, opacity: 0.05,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          }),
        );
        beam.position.y = 17.8 / 2;
        mast.add(beam);
      }
      mast.position.set(x, 0, z);
      this.root.add(mast);
    }
  }

  update(t: Telemetry, dt: number) {
    this.clock += dt;
    for (const u of this.units) u.update(t, dt, this.fx);
    this.fx.update(dt);
    this.dressing?.update(t, dt, this.clock);
    this.deliveries?.update(t, dt, this.clock);
    this.rovs.forEach((r, i) => {
      r.position.y = 4 + i * 1.7 + Math.sin(this.clock * 0.7 + i) * 0.5;
      r.rotation.y += dt * 0.08 * (i % 2 ? 1 : -1);
    });

    // Fade the rock out of the way once you are actually looking underground.
    // Driven off the orbit target rather than the camera, so simply standing
    // on a high vantage point does not dissolve the ground under the plant.
    if (this.underground) {
      const look = this.stage.controls.target.y;
      const cam = this.stage.camera.position.y;
      const depth = Math.max(0, -look / 26) + Math.max(0, -cam / 40);
      this.underground.setXray(Math.min(1, depth));
    }

    // drive the interconnecting pipework from the real stream rates
    const on = t.status !== 'idle' && t.status !== 'blocked';
    for (let i = 0; i < this.links.length; i++) {
      const k = this.linkKinds[i];
      let v = 0;
      switch (k) {
        case 'feed': v = on ? 2.4 : 0; break;
        case 'uf': v = t.thickener.underflow.solids > 1 ? 1.6 : 0; break;
        case 'press': v = t.filter.throughput > 0.5 ? 1.6 : 0; break;
        case 'of': v = t.thickener.overflow.water > 1 ? 2.6 : 0; break;
        case 'filtrate': v = t.filter.filtrate.water > 1 ? 2.4 : 0; break;
        case 'makeup': v = t.mixer.mixWater > 0.5 ? 2.2 : 0; break;
      }
      setFlow(this.links[i], v);
    }

    tickFlows(dt);

    if (this.outline && this.selected) {
      (this.outline as unknown as THREE.Box3Helper).box.copy(this.steelBounds(this.selected));
    }
  }

  /** Click-to-inspect. */
  pick(nx: number, ny: number, maxDist = Infinity): Unit | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.stage.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      if (h.distance > maxDist) break;
      // hidden units (the upstream circuit in standard mode) are still in
      // the pick list, so walk up and check the branch is actually visible
      let vis = true;
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (!o.visible) { vis = false; break; }
      }
      if (!vis) continue;
      const id = h.object.userData.unitId as string | undefined;
      if (id) return this.byId.get(id) ?? null;
    }
    return null;
  }

  /**
   * Bounds over the unit's actual steelwork only. Box3.setFromObject would
   * swallow the floating tag sprite as well and draw a selection box twice
   * the height of the equipment.
   */
  private steelBounds(u: Unit): THREE.Box3 {
    const b = new THREE.Box3();
    const tmp = new THREE.Box3();
    u.group.updateWorldMatrix(true, true);
    u.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      if (u.tag.group === o.parent || u.tag.group === o) return;
      m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      b.union(tmp);
    });
    return b;
  }

  select(u: Unit | null, fly = true) {
    this.selected = u;
    if (this.outline) {
      this.root.remove(this.outline);
      this.outline.geometry.dispose();
      this.outline = null;
    }
    if (!u) return;

    const bounds = this.steelBounds(u);
    const helper = new THREE.Box3Helper(bounds, new THREE.Color(C.cyan));
    (helper.material as THREE.LineBasicMaterial).transparent = true;
    (helper.material as THREE.LineBasicMaterial).opacity = 0.55;
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    this.outline = helper as unknown as THREE.BoxHelper;
    this.root.add(helper);

    if (fly) {
      const target = u.group.localToWorld(u.focus.clone());
      const size = bounds.getSize(new THREE.Vector3()).length();
      const d = Math.max(18, size * 0.85);
      this.stage.flyTo(target, u.viewOffset ?? V(-d * 0.55, d * 0.45, d * 0.75));
    }
  }

  /**
   * The floating holographic labels are an inspection aid, not part of the
   * plant. From the control room you are looking at the real thing through
   * glass, so they get switched off.
   */
  setTagsVisible(v: boolean) {
    for (const u of this.units) u.tag.group.visible = v;
  }

  /** Put the operator in the chair (or take them out of it). */
  setSeated(on: boolean) {
    (this.byId.get('control') as ControlRoom | undefined)?.setSeated(on);
  }

  get(id: string) { return this.byId.get(id); }
}
