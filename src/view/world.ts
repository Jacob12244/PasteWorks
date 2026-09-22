import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { C, metal, matte, glass, glow, liquor } from './palette';
import {
  box, cyl, tube, strip, platform, railing, ladder, bands, ribs,
  pipeRun, pipeSupport, LevelBar, Beacon, Tag,
} from './parts';
import { flowMaterial, setFlow, tickFlows, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Overflow } from './spill';
import { Unit, Thickener, SurgeTank, PlatePress, CakeBin, BinderSilo, Mixer, PastePump } from './units';
import { buildGround, Underground, PasteLine, scaleFigure, CUT_X } from './terrain';
import { UpstreamCircuit } from './upstream';
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
        : w.toMill.toFixed(0) + ' / ' + w.returnCap.toFixed(0) + ' m3/h to mill',
      spill > 0.5 ? 'trip' : f > 0.88 ? 'warn' : 'ok',
    );
  }
}

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

  constructor() {
    super('CONTROL ROOM', 2.4, '#35e0d0');
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
  private underground: Underground;
  private upstreamCircuit: UpstreamCircuit;
  selected: Unit | null = null;

  constructor(private stage: Stage) {
    this.root.add(buildGround());

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

    place(new Thickener(), -52, 0);
    place(new SurgeTank(this.fx), -30, 7);
    place(new PlatePress(), -10, 0);
    place(new CakeBin(), 2, 0);
    place(new BinderSilo(), 6, -17);
    place(new Mixer(), 17, 0);
    place(new PastePump(), 28, 0);
    place(new WaterTank(this.fx), -2, 17);
    place(new ControlRoom(), CONTROL.x, CONTROL.z);
    place(new PasteLine(), 0, 0);
    this.upstreamCircuit = new UpstreamCircuit(this.fx);
    place(this.upstreamCircuit, 0, 0);
    this.upstreamCircuit.setVisible(false);

    this.underground = new Underground();
    place(this.underground, 0, 0);

    this.buildLinks();
    this.buildSiteDressing();
    this.root.add(this.fx.group);
  }

  /** The interconnecting pipework that makes it read as one flowsheet. */
  private buildLinks() {
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

    // mill tailings in from the west, high on a pipe bridge
    link('feed', C.tails, 0.4, [
      V(-84, 15, 0), V(-74, 15, 0), V(-66, 14.6, 0), V(-60, 13.2, 0),
      V(-55, 11.4, 0), V(-52, 9.6, 0), V(-52, 8.2, 0),
    ]);
    // The west end is an anchor, not a loose end: in hard mode the transfer
    // riser comes up beside it, in standard mode it reads as the battery limit.
    for (const x of [-85.4, -80, -72, -64, -56]) {
      const s = pipeSupport(14.6, 2.0);
      s.position.set(x, 0, 0);
      this.root.add(s);
    }

    // thickener underflow -> surge tank
    link('uf', C.thickUf, 0.3, [
      V(-52, 0.7, 0), V(-45, 0.9, 2), V(-42.5, 3, 6), V(-42.5, 13.5, 7),
      V(-36, 14.2, 7), V(-30, 13.2, 7),
    ]);

    // surge tank -> press feed
    link('press', C.thickUf, 0.26, [
      V(-30, 2.4, 7), V(-25, 2.2, 5), V(-20, 3.2, 0), V(-17, 6.4, -1.8), V(-13, 6.55, -1.8),
    ]);

    // Thickener overflow and filtrate both run back to process water on an
    // overhead rack rather than snaking across the pad at knee height.
    const RACK = 9.6;
    link('of', C.water, 0.26, [
      V(-43.5, 5.2, 0), V(-40, RACK, 2), V(-34, RACK, 8), V(-24, RACK, 14),
      V(-12, RACK, 17), V(-4.2, RACK, 17), V(-3.6, 7.2, 17),
    ], 0.75);
    for (const [x, z] of [[-34, 8], [-24, 14], [-12, 17]] as const) {
      const s = pipeSupport(RACK - 0.4, 1.4);
      s.position.set(x, 0, z);
      this.root.add(s);
    }

    // filtrate -> process water
    link('filtrate', C.water, 0.18, [
      V(-3.5, 6.4, 1.8), V(-2.0, 8.2, 6), V(-1.2, 8.4, 11), V(-1.6, 7.6, 14.2),
    ], 0.75);

    // process water -> mixer make-up
    link('makeup', C.water, 0.18, [
      V(1.6, 6.4, 16), V(7, 9.5, 12), V(13, 12.6, 5), V(17, 13.3, -1.4),
    ], 0.9);

    // binder screw -> mixer
    link('binder', C.binder, 0.3, [
      V(6, 6.2, -17), V(9, 7.5, -13), V(13, 10.5, -6), V(16, 13.4, -1.6),
    ]);
  }

  private buildSiteDressing() {
    // people, for scale
    for (const [x, z, y] of [
      [-44, 12, 0], [-14, 9.5, 6.1], [4.5, 6.5, 0], [22, 5.5, 10.1], [-18, 20, 0],
    ] as const) {
      const p = scaleFigure(z > 8 ? C.amber : C.lime);
      p.position.set(x, y, z);
      p.rotation.y = Math.random() * 6;
      this.root.add(p);
    }

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
      mast.position.set(x, 0, z);
      this.root.add(mast);
    }
  }

  update(t: Telemetry, dt: number) {
    for (const u of this.units) u.update(t, dt, this.fx);
    this.fx.update(dt);

    // Fade the rock out of the way once you are actually looking underground.
    // Driven off the orbit target rather than the camera, so simply standing
    // on a high vantage point does not dissolve the ground under the plant.
    const look = this.stage.controls.target.y;
    const cam = this.stage.camera.position.y;
    const depth = Math.max(0, -look / 26) + Math.max(0, -cam / 40);
    this.underground.setXray(Math.min(1, depth));
    this.upstreamCircuit.setVisible(t.upstream.hard);

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
        case 'binder': v = t.silo.feedRate > 0.05 ? 1.1 : 0; break;
      }
      setFlow(this.links[i], v);
    }

    tickFlows(dt);

    if (this.outline && this.selected) {
      (this.outline as unknown as THREE.Box3Helper).box.copy(this.steelBounds(this.selected));
    }
  }

  /** Click-to-inspect. */
  pick(nx: number, ny: number): Unit | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.stage.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
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
