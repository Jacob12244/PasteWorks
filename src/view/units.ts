import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { C, metal, matte, glass, glow, glowUnique, liquor } from './palette';
import {
  box, cyl, tube, flange, strip, platform, railing, ladder, ribs, bands,
  pipeSupport, LevelBar, Beacon, Tag,
} from './parts';
import { flowMaterial, beltMaterial, setFlow, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Overflow } from './spill';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Anything the player can click on and inspect. */
export abstract class Unit {
  group = new THREE.Group();
  tag: Tag;
  abstract readonly id: string;
  abstract readonly name: string;
  /** where the camera flies to when this unit is selected */
  focus = new THREE.Vector3();
  /** optional fixed camera offset, for units whose bounding box is misleading */
  viewOffset?: THREE.Vector3;

  constructor(title: string, tagHeight = 3.0, accent = '#35e0d0') {
    this.tag = new Tag(title, tagHeight, accent);
  }

  abstract update(t: Telemetry, dt: number, fx: FX): void;

  protected mountTag(y: number) {
    this.tag.group.position.y = y;
    this.group.add(this.tag.group);
  }
}

// ============================================================ 01 THICKENER

/**
 * High-rate thickener: 18 m diameter, full-bridge rake drive.
 * The bridge turns at about one revolution every ten minutes, the bed depth
 * you can see through the launder tracks the solids inventory, and the
 * overflow goes from clear blue to muddy when you out-run the settling flux.
 */
export class Thickener extends Unit {
  readonly id = 'thickener';
  readonly name = 'Thickener 01';

  private bridge = new THREE.Group();
  private liquorMesh: THREE.Mesh;
  private liquorMat: THREE.MeshStandardMaterial;
  private bedMesh: THREE.Mesh;
  private torqueBar: LevelBar;
  private beacon = new Beacon();
  private ofFlow: FlowMaterial;
  private launderSpout?: Spout;
  private launderY = 0;
  private _w = new THREE.Vector3();
  private ufFlow: FlowMaterial;

  constructor() {
    super('THICKENER 01', 3.2);
    const R = DESIGN.thickenerDia / 2;
    const WALL = 4.0;
    const g = this.group;

    // plinth + conical floor
    const plinth = cyl(R + 0.9, R + 1.2, 1.2, matte(0x2a2f38, 0.95), 48);
    plinth.position.y = 0.6;
    g.add(plinth);

    const floor = cyl(R, 0.6, 1.5, matte(0x1e242c, 0.95), 48);
    floor.position.y = 1.2 + 0.75;
    g.add(floor);

    // shell, open ended so you can see the bed
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, WALL, 56, 1, true),
      new THREE.MeshStandardMaterial({
        color: C.steel, roughness: 0.6, metalness: 0.85, side: THREE.DoubleSide,
      }),
    );
    shell.position.y = 1.2 + WALL / 2 + 1.0;
    shell.castShadow = shell.receiveShadow = true;
    g.add(shell);

    const rim = 1.2 + WALL + 1.0;
    g.add(bands(R, [1.6, 3.4, 5.0]));

    // launder ring
    const launder = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.42, 10, 64), metal(C.steelDark));
    launder.rotation.x = Math.PI / 2;
    launder.position.y = rim - 0.2;
    g.add(launder);

    // liquor surface + settled bed
    this.liquorMat = liquor(C.water, 0.92);
    this.liquorMesh = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 56), this.liquorMat);
    this.liquorMesh.rotation.x = -Math.PI / 2;
    this.liquorMesh.position.y = rim - 0.55;
    g.add(this.liquorMesh);

    this.bedMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.15, 0.6, 1, 48),
      liquor(C.tails, 1),
    );
    this.bedMesh.position.y = 2.0;
    g.add(this.bedMesh);

    // full-diameter rake bridge
    const beam = box(DESIGN.thickenerDia + 2.2, 0.55, 1.0, metal(C.steelLight, 0.5, 0.9));
    beam.position.y = rim + 0.6;
    this.bridge.add(beam);
    for (const sx of [-1, 1]) {
      const truss = box(DESIGN.thickenerDia / 2, 0.16, 0.16, metal(C.steelLight));
      truss.position.set(sx * R * 0.5, rim + 1.35, 0);
      this.bridge.add(truss);
      const post = box(0.16, 1.5, 0.16, metal(C.steelLight));
      post.position.set(sx * R * 0.92, rim + 1.35, 0);
      this.bridge.add(post);
    }
    const kingPost = box(0.22, 1.6, 0.22, metal(C.steelLight));
    kingPost.position.y = rim + 1.4;
    this.bridge.add(kingPost);
    const walk = railing(DESIGN.thickenerDia + 1.8, C.cyan);
    walk.position.set(0, rim + 0.9, 0.55);
    this.bridge.add(walk);

    // centre drive house
    const drive = box(2.6, 1.8, 2.2, metal(C.steelDark, 0.5, 0.9));
    drive.position.y = rim + 1.7;
    this.bridge.add(drive);
    const driveLamp = strip(2.4, C.cyan, 0.1, 2.0);
    driveLamp.position.set(0, rim + 2.5, 1.15);
    this.bridge.add(driveLamp);

    // feedwell
    const fw = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 2.6, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: C.steelDark, roughness: 0.7, metalness: 0.8, side: THREE.DoubleSide }),
    );
    fw.position.y = rim - 1.0;
    this.bridge.add(fw);

    // rake arms + blades, hung below the bridge
    for (const sx of [-1, 1]) {
      const arm = box(R - 0.6, 0.3, 0.3, metal(C.steelDark));
      arm.position.set((sx * (R - 0.6)) / 2, 2.4, 0);
      this.bridge.add(arm);
      const nb = 7;
      for (let i = 1; i <= nb; i++) {
        const f = i / nb;
        const blade = box(0.12, 0.7, 0.55, metal(C.steelDark));
        blade.position.set(sx * (R - 0.6) * f, 2.05, 0);
        blade.rotation.y = sx * 0.55;
        this.bridge.add(blade);
      }
    }
    g.add(this.bridge);

    // access: stair tower + rim rail
    const tower = ladder(rim + 0.6);
    tower.position.set(R + 0.2, 0, 1.6);
    tower.rotation.y = -Math.PI / 2;
    g.add(tower);

    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const r = railing((2 * Math.PI * (R + 1.0)) / seg + 0.15, C.cyan);
      r.position.set(Math.cos(a) * (R + 1.0), rim, Math.sin(a) * (R + 1.0));
      r.rotation.y = -a + Math.PI / 2;
      g.add(r);
    }

    // overflow launder downcomer + underflow cone outlet
    this.ofFlow = flowMaterial(C.water, { density: bandsFor(5.5), intensity: 1.0 });
    const ofPipe = tube(0.45, 5.5, this.ofFlow, 16);
    ofPipe.rotation.z = Math.PI / 2;
    ofPipe.position.set(R + 3.4, rim - 0.4, 0);
    g.add(ofPipe);

    this.ufFlow = flowMaterial(C.thickUf, { density: bandsFor(4.0), intensity: 1.6 });
    const ufPipe = tube(0.32, 4.0, this.ufFlow, 16);
    ufPipe.position.set(0, 0.6, 0);
    ufPipe.rotation.z = Math.PI / 2;
    g.add(ufPipe);

    // rake torque indicator, mounted where the operator would read it
    this.torqueBar = new LevelBar(3.0, C.lime, 0.4);
    this.torqueBar.group.position.set(R + 0.4, rim - 3.2, -2.0);
    this.torqueBar.group.rotation.y = -Math.PI / 2;
    g.add(this.torqueBar.group);

    this.beacon.group.position.set(R + 0.4, rim, -3.4);
    g.add(this.beacon.group);

    this.focus.set(0, 4, 0);
    this.launderY = rim - 0.15;
    this.mountTag(rim + 6.5);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const th = t.thickener;
    this.bridge.rotation.y = th.rakeAngle;

    // bed depth tracks solids inventory
    const bedFrac = clamp01(th.bedPct / 100);
    const h = lerp(0.3, 3.4, bedFrac);
    this.bedMesh.scale.y = h;
    this.bedMesh.position.y = 1.9 + h / 2;

    // overflow clarity: clean blue -> muddy brown
    const muddy = clamp01((th.overflowClarity - 50) / 2500);
    this.liquorMat.color.lerpColors(
      new THREE.Color(C.water), new THREE.Color(C.tails), muddy,
    );
    this.liquorMat.emissive.copy(this.liquorMat.color);
    this.liquorMat.emissiveIntensity = lerp(0.17, 0.06, muddy);

    this.torqueBar.setLevel(th.torque / 100,
      th.torque > 90 ? C.red : th.torque > 78 ? C.amber : C.lime);

    this.beacon.set(
      th.torque > 90 ? C.red : muddy > 0.15 ? C.amber : C.lime,
      th.torque > 90 ? 5 : 2.2,
    );

    setFlow(this.ofFlow, th.overflow.water > 1 ? 2.2 : 0);
    setFlow(this.ufFlow, th.underflow.solids > 1 ? 1.4 : 0);

    // Solids going over the launder are the visible symptom of out-running the
    // settling flux: the overflow stops being water and starts being tailings.
    const R = DESIGN.thickenerDia / 2;
    this.launderSpout ??= new Spout(fx.liquid, 40, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, -0.5, 0),
      spread: new THREE.Vector3(0.45, 0.25, 0.45),
      jitter: new THREE.Vector3(R + 0.6, 0.12, R + 0.6),
      colour: C.tails, size: 0.19, sizeVary: 0.5,
      life: 2.4, gravity: -9.81, drag: 0.86,
      floor: 0.1, bounce: 0.15,
    }));
    this._w.set(this.group.position.x, this.launderY, this.group.position.z);
    this.launderSpout.run(dt, clamp01(th.overflow.solids / 30), this._w);

    this.tag.set(
      (th.ufCw * 100).toFixed(1) + '%',
      'U/F  ' + th.torque.toFixed(0) + '% torque',
      th.torque > 90 ? 'trip' : th.torque > 78 || muddy > 0.15 ? 'warn' : 'ok',
    );
  }
}

// ========================================================= 02 SURGE TANK

/**
 * Agitated underflow surge tank - the buffer between thickener and press.
 * The shell is cut away down one side behind a sight glass so the level is
 * something you watch rather than something you read off a gauge, and if the
 * U/F pump out-runs the press it goes over the rim onto the pad.
 */
export class SurgeTank extends Unit {
  readonly id = 'surge';
  readonly name = 'U/F Surge Tank';

  private agitator = new THREE.Group();
  private level: LevelBar;
  private contents: THREE.Mesh;
  private surface: THREE.Mesh;
  private surfaceMat: THREE.MeshStandardMaterial;
  private vortex: THREE.Mesh;
  private overflow: Overflow;
  private inletSpout: Spout;
  private inlet = new THREE.Object3D();
  private beacon = new Beacon();
  private _w = new THREE.Vector3();

  private readonly R = 3.4;
  private readonly H = 9;
  private readonly BASE = 2.2;
  private baseY: number;
  private maxH: number;
  private rimY: number;

  constructor(fx: FX) {
    super('U/F SURGE', 2.6);
    const { R, H, BASE } = this;
    const g = this.group;
    this.baseY = BASE + 0.4;
    this.maxH = H + 1.2;
    this.rimY = BASE + 1.6 + H;

    // legs
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const l = box(0.32, BASE, 0.32, metal(C.steel, 0.65, 0.9));
      l.position.set(Math.cos(a) * (R - 0.4), BASE / 2, Math.sin(a) * (R - 0.4));
      g.add(l);
    }

    const cone = cyl(R, 0.45, 1.6, metal(C.steel), 32);
    cone.position.y = BASE + 0.8;
    g.add(cone);

    // Shell with a vertical slot cut out of it. CylinderGeometry measures
    // theta from +Z, so leaving the gap centred on theta = 0 puts the window
    // on the side the camera starts on.
    const GAP = 0.62;
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H, 44, 1, true, GAP / 2, Math.PI * 2 - GAP),
      new THREE.MeshStandardMaterial({
        color: C.steel, roughness: 0.55, metalness: 0.88, side: THREE.DoubleSide,
      }),
    );
    shell.position.y = BASE + 1.6 + H / 2;
    shell.castShadow = shell.receiveShadow = true;
    g.add(shell);

    // sight glass over the slot
    const pane = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.03, R + 0.03, H - 0.5, 10, 1, true, -GAP / 2, GAP),
      glass(0xc8e8ff, 0.16),
    );
    pane.position.y = BASE + 1.6 + H / 2;
    g.add(pane);

    // slot frame
    for (const s of [-1, 1]) {
      const a = (s * GAP) / 2;
      const post = box(0.16, H, 0.22, metal(C.steelLight, 0.45, 0.9));
      post.position.set(Math.sin(a) * R, BASE + 1.6 + H / 2, Math.cos(a) * R);
      post.rotation.y = a;
      g.add(post);
      const lit = strip(H - 0.4, C.cyan, 0.05, 0.9);
      lit.rotation.z = Math.PI / 2;
      lit.position.set(Math.sin(a) * (R + 0.1), BASE + 1.6 + H / 2, Math.cos(a) * (R + 0.1));
      g.add(lit);
    }

    const top = cyl(R, R, 0.3, metal(C.steelDark), 40);
    top.position.y = this.rimY;
    g.add(top);
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.1, 8, 44), metal(C.steelDark));
    rimRing.rotation.x = Math.PI / 2;
    rimRing.position.y = this.rimY;
    g.add(rimRing);

    const r = ribs(R, H, 8);
    r.position.y = BASE + 1.6;
    g.add(r);
    g.add(bands(R, [BASE + 3.0, BASE + 6.5]));

    // ---- contents -------------------------------------------------------
    this.contents = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.1, R - 0.1, 1, 36),
      liquor(C.thickUf, 1),
    );
    g.add(this.contents);

    this.surfaceMat = new THREE.MeshStandardMaterial({
      color: C.thickUf, emissive: C.thickUf, emissiveIntensity: 0.3,
      roughness: 0.35, metalness: 0,
    });
    this.surface = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 36), this.surfaceMat);
    this.surface.rotation.x = -Math.PI / 2;
    g.add(this.surface);

    // the agitator pulls a vortex in the surface - the clearest possible
    // signal that the tank is actually being stirred
    this.vortex = new THREE.Mesh(
      new THREE.ConeGeometry(1.15, 1.0, 20, 1, true),
      this.surfaceMat,
    );
    this.vortex.rotation.x = Math.PI;
    g.add(this.vortex);

    // ---- agitator drive --------------------------------------------------
    const ped = box(1.5, 0.9, 1.5, metal(C.steelDark));
    ped.position.y = this.rimY + 0.6;
    g.add(ped);
    const motor = cyl(0.52, 0.52, 1.5, metal(0x3c4a5c, 0.45, 0.9), 20);
    motor.position.set(0, this.rimY + 1.9, 0);
    g.add(motor);
    const fan = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 6, 18), metal(C.steelLight));
    fan.rotation.x = Math.PI / 2;
    fan.position.y = this.rimY + 2.7;
    this.agitator.add(fan);
    const coupling = cyl(0.16, 0.16, 0.9, glow(C.cyan, 1.4), 12);
    coupling.position.y = this.rimY + 1.0;
    this.agitator.add(coupling);
    g.add(this.agitator);

    // ---- inlet splash ----------------------------------------------------
    this.inlet.position.set(0, this.rimY - 0.4, -R + 1.0);
    g.add(this.inlet);
    this.inletSpout = new Spout(fx.liquid, 14, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, -1.2, 0),
      spread: new THREE.Vector3(0.6, 0.3, 0.6),
      jitter: new THREE.Vector3(0.25, 0.1, 0.25),
      colour: C.thickUf, size: 0.16, sizeVary: 0.5,
      life: 0.7, gravity: -9.81, drag: 0.6,
    }));

    this.overflow = new Overflow(R, this.rimY, C.thickUf, fx, { streams: 4, splashy: false });
    g.add(this.overflow.group);

    this.level = new LevelBar(H - 0.8, C.thickUf, 0.42);
    this.level.group.position.set(-R - 0.25, BASE + 2.0, 0);
    this.level.group.rotation.y = -Math.PI / 2;
    g.add(this.level.group);

    this.beacon.group.position.set(R + 0.9, 0, 1.6);
    g.add(this.beacon.group);

    const lad = ladder(this.rimY + 0.5);
    lad.position.set(0, 0, -R - 0.3);
    g.add(lad);

    this.focus.set(0, 7, 0);
    this.mountTag(BASE + H + 6.0);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const f = clamp01(t.ufTank.pct / 100);
    const h = Math.max(0.05, f * this.maxH);
    const top = this.baseY + h;

    this.contents.scale.y = h;
    this.contents.position.y = this.baseY + h / 2;

    const stirring = t.status !== 'idle';
    // surface bobs and the vortex only pulls down while the agitator is on
    const bob = stirring ? Math.sin(t.time * 1.7) * 0.035 : 0;
    this.surface.position.y = top + 0.02 + bob;
    this.vortex.position.y = top - 0.36 + bob;
    this.vortex.visible = stirring && f > 0.08;
    this.vortex.rotation.y += dt * 2.2;
    this.surfaceMat.emissiveIntensity = stirring ? 0.34 : 0.16;

    this.agitator.rotation.y += dt * (stirring ? 4.5 : 0.4);

    this.level.setLevel(f, f < 0.08 ? C.red : f > 0.95 ? C.amber : C.thickUf);

    // splash where the underflow lands
    this.inlet.getWorldPosition(this._w);
    this._w.y = top + 0.15;
    this.inletSpout.run(dt, t.thickener.underflow.solids > 1 ? 1 : 0, this._w);

    // overflow: the failure the player has to avoid
    const spill = t.spills.slurry;
    this.overflow.update(dt, Math.min(1, spill / 40), t.spills.totalM3 * 0.35);

    this.beacon.set(
      spill > 0.5 ? C.red : f > 0.95 ? C.amber : f < 0.08 ? C.amber : C.lime,
      spill > 0.5 ? 6 : 2.2,
    );

    this.tag.set(
      t.ufTank.volume.toFixed(0) + ' m3',
      spill > 0.5 ? 'OVERFLOWING' : t.ufTank.pct.toFixed(0) + '% of ' + DESIGN.ufTankVol,
      spill > 0.5 ? 'trip' : f < 0.08 || f > 0.95 ? 'warn' : 'ok',
    );
  }
}

// ======================================================== 03 PLATE PRESS

/**
 * Membrane plate-and-frame press.
 * The plate pack closes under the hydraulic ram, filters, then the shifter
 * walks the plates open one at a time and the cake slabs drop to the belt.
 * That discharge is the cycle time the player is trading against moisture.
 */
export class PlatePress extends Unit {
  readonly id = 'press';
  readonly name = 'Plate Press 01';

  private plates: THREE.Mesh[] = [];
  private ram: THREE.Mesh;
  private follower: THREE.Group;
  private slabs: THREE.Mesh[] = [];
  private slabVel: number[] = [];
  private filtrateFlow: FlowMaterial;
  private feedFlow: FlowMaterial;
  private deck = 6.0;
  private plateN = 20;
  private pitchClosed = 0.26;
  private pitchOpen = 0.62;
  private headX = -4.6;
  private beacon = new Beacon();
  private lastPhase = 0;

  constructor() {
    super('PLATE PRESS', 2.8);
    const g = this.group;
    const D = this.deck;

    const plat = platform(16, 9, { y: D, accent: C.cyan, openSides: ['s'] });
    g.add(plat);

    // side rails the plates hang from
    for (const sz of [-1.35, 1.35]) {
      const rail = box(13.5, 0.34, 0.34, metal(C.steelLight, 0.45, 0.92));
      rail.position.set(0.5, D + 2.6, sz);
      g.add(rail);
    }

    // fixed head
    const head = box(0.7, 3.0, 3.6, metal(C.steelDark, 0.5, 0.9));
    head.position.set(this.headX - 0.6, D + 1.9, 0);
    g.add(head);

    // tail stand + hydraulic cylinder
    const tail = box(0.8, 3.2, 3.8, metal(C.steelDark, 0.5, 0.9));
    tail.position.set(7.6, D + 1.9, 0);
    g.add(tail);
    const cylBody = tube(0.45, 2.2, metal(0x46505f, 0.35, 0.95), 20);
    cylBody.rotation.z = Math.PI / 2;
    cylBody.position.set(6.4, D + 1.9, 0);
    g.add(cylBody);
    this.ram = tube(0.22, 2.4, metal(0xb9c4d2, 0.15, 1.0), 16);
    this.ram.rotation.z = Math.PI / 2;
    g.add(this.ram);

    // moving follower
    this.follower = new THREE.Group();
    const fol = box(0.55, 2.9, 3.5, metal(C.steelLight, 0.45, 0.92));
    this.follower.add(fol);
    const folLamp = strip(2.6, C.amber, 0.09, 2.0);
    folLamp.rotation.y = Math.PI / 2;
    folLamp.position.set(0.3, 1.3, 0);
    this.follower.add(folLamp);
    this.follower.position.set(0, D + 1.9, 0);
    g.add(this.follower);

    // the plate pack
    const plateMat = metal(0x4a5666, 0.5, 0.8);
    const cakeMat = matte(C.cake, 0.95);
    for (let i = 0; i < this.plateN; i++) {
      const p = new THREE.Group() as unknown as THREE.Mesh;
      const frame = box(0.16, 2.6, 3.2, plateMat);
      p.add(frame);
      // the cake sitting in the chamber - hidden while discharging
      const ck = box(0.1, 2.0, 2.6, cakeMat);
      ck.position.x = 0.1;
      ck.name = 'cake';
      p.add(ck);
      const lamp = strip(2.4, C.cyan, 0.05, 1.2);
      lamp.rotation.y = Math.PI / 2;
      lamp.position.set(0.09, 1.25, 0);
      p.add(lamp);
      p.position.set(this.headX + i * this.pitchClosed, D + 1.9, 0);
      this.plates.push(p);
      g.add(p);
    }

    // falling cake slab pool
    for (let i = 0; i < 14; i++) {
      const s = box(0.5, 0.16, 1.4, matte(C.cake, 0.95));
      s.visible = false;
      this.slabs.push(s);
      this.slabVel.push(0);
      g.add(s);
    }

    // feed + filtrate manifolds
    this.feedFlow = flowMaterial(C.thickUf, { density: bandsFor(13), intensity: 1.0 });
    const feed = tube(0.24, 13, this.feedFlow, 14);
    feed.rotation.z = Math.PI / 2;
    feed.position.set(0.5, D + 0.55, -1.8);
    g.add(feed);

    this.filtrateFlow = flowMaterial(C.water, { density: bandsFor(13), intensity: 1.0 });
    const filt = tube(0.2, 13, this.filtrateFlow, 14);
    filt.rotation.z = Math.PI / 2;
    filt.position.set(0.5, D + 0.4, 1.8);
    g.add(filt);

    // cake chute down to the belt
    const chute = box(6.0, 0.16, 3.4, metal(C.steelDark));
    chute.position.set(1.5, D - 0.35, 0);
    chute.rotation.z = -0.22;
    g.add(chute);

    this.beacon.group.position.set(-6.5, D + 0.1, 3.6);
    g.add(this.beacon.group);

    this.focus.set(0, D + 2, 0);
    this.mountTag(D + 7.5);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const f = t.filter;
    const D = this.deck;
    const phase = f.cyclePhase;

    // 0.00 - 0.78 filtering (pack closed), 0.78 - 1.00 shifter walks it open
    const open = phase < 0.78 ? 0 : (phase - 0.78) / 0.22;
    const packLen = (this.plateN - 1) * lerp(this.pitchClosed, this.pitchOpen, open);

    for (let i = 0; i < this.plateN; i++) {
      const p = this.plates[i];
      // the shifter opens plates one at a time, from the tail back to the head
      const mine = clamp01((open * (this.plateN + 2) - (this.plateN - i)) / 1.5);
      const pitch = lerp(this.pitchClosed, this.pitchOpen, mine);
      p.position.x = this.headX + i * pitch;
      const ck = (p as unknown as THREE.Group).getObjectByName('cake');
      if (ck) {
        ck.visible = mine < 0.55 && f.throughput > 0.5;
        ck.scale.y = lerp(0.35, 1, clamp01(phase / 0.6));
      }
    }

    this.follower.position.x = this.headX + packLen + 0.5;
    this.ram.position.set((this.follower.position.x + 7.2) / 2 + 0.6, D + 1.9, 0);
    this.ram.scale.y = Math.max(0.2, 7.2 - this.follower.position.x);

    // drop slabs as the pack walks open
    if (open > 0 && this.lastPhase <= 0.78 && f.throughput > 0.5) this.dropSlabs();
    this.lastPhase = phase;

    for (let i = 0; i < this.slabs.length; i++) {
      const s = this.slabs[i];
      if (!s.visible) continue;
      this.slabVel[i] -= 9.81 * dt;
      s.position.y += this.slabVel[i] * dt;
      s.rotation.z += dt * 1.6;
      if (s.position.y < D - 2.4) s.visible = false;
    }

    const util = f.utilisation;
    setFlow(this.feedFlow, f.throughput > 0.5 ? 1.8 : 0);
    setFlow(this.filtrateFlow, f.throughput > 0.5 ? 2.6 : 0);
    this.beacon.set(f.throughput < 0.5 ? C.red : util > 95 ? C.amber : C.lime, 2.4);

    this.tag.set(
      f.cakeMoisture.toFixed(1) + '%',
      'cake H2O  ' + f.throughput.toFixed(0) + ' t/h',
      f.throughput < 0.5 ? 'warn' : 'ok',
    );
  }

  private dropSlabs() {
    let n = 0;
    for (let i = 0; i < this.slabs.length && n < 8; i++) {
      const s = this.slabs[i];
      if (s.visible) continue;
      s.position.set(
        this.headX + Math.random() * 5.5,
        this.deck + 1.2,
        (Math.random() - 0.5) * 2.2,
      );
      s.rotation.set(0, Math.random() * 3, 0);
      s.visible = true;
      this.slabVel[i] = -0.5;
      n++;
    }
  }
}

// =================================================== 04 CAKE BIN + BELT

/** Cake surge bin and the inclined belt that feeds the mixer. */
export class CakeBin extends Unit {
  readonly id = 'cakebin';
  readonly name = 'Cake Bin + Belt';

  private contents: THREE.Mesh;
  private level: LevelBar;
  private belt: FlowMaterial;
  private lumps: THREE.Mesh[] = [];
  private pulleyA = new THREE.Group();
  private pulleyB = new THREE.Group();

  constructor() {
    super('CAKE BIN', 2.4, '#ffab3d');
    const g = this.group;

    // hopper
    const hop = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 1.0, 4.2, 6),
      metal(C.steel, 0.6, 0.85),
    );
    hop.position.y = 4.2;
    g.add(hop);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.12, 6, 6), metal(C.steelDark));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 6.3;
    g.add(collar);

    this.contents = new THREE.Mesh(
      new THREE.CylinderGeometry(2.75, 0.95, 1, 6),
      liquor(C.cake, 1),
    );
    g.add(this.contents);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const l = box(0.26, 2.2, 0.26, metal(C.steel));
      l.position.set(Math.cos(a) * 2.2, 1.1, Math.sin(a) * 2.2);
      g.add(l);
    }

    this.level = new LevelBar(3.6, C.cake, 0.36);
    this.level.group.position.set(0, 2.6, 3.0);
    g.add(this.level.group);

    // inclined belt conveyor: bin -> mixer deck
    const L = 13.5, RISE = 8.2;
    const ang = Math.atan2(RISE, L);
    const conv = new THREE.Group();
    const span = Math.hypot(L, RISE);

    this.belt = beltMaterial(C.cake);
    const beltMesh = box(span, 0.12, 1.5, this.belt);
    beltMesh.position.y = 0.42;
    conv.add(beltMesh);

    const frame = box(span, 0.22, 1.9, metal(C.steelDark, 0.6, 0.9));
    conv.add(frame);
    for (const sz of [-0.95, 0.95]) {
      const side = box(span, 0.6, 0.1, metal(C.steel));
      side.position.set(0, 0.35, sz);
      conv.add(side);
    }
    // idlers
    for (let i = 0; i <= 14; i++) {
      const id = tube(0.13, 1.5, metal(C.steelLight), 8);
      id.rotation.x = Math.PI / 2;
      id.position.set(-span / 2 + (span * i) / 14, 0.3, 0);
      conv.add(id);
    }
    // head and tail pulleys
    const pa = tube(0.38, 1.7, metal(0x5a6779, 0.4, 0.95), 14);
    pa.rotation.x = Math.PI / 2;
    this.pulleyA.add(pa);
    const key = box(0.1, 0.8, 1.72, glow(C.amber, 1.4));
    this.pulleyA.add(key);
    this.pulleyA.position.set(-span / 2, 0.36, 0);
    conv.add(this.pulleyA);

    const pb = tube(0.38, 1.7, metal(0x5a6779, 0.4, 0.95), 14);
    pb.rotation.x = Math.PI / 2;
    this.pulleyB.add(pb);
    const key2 = box(0.1, 0.8, 1.72, glow(C.amber, 1.4));
    this.pulleyB.add(key2);
    this.pulleyB.position.set(span / 2, 0.36, 0);
    conv.add(this.pulleyB);

    // cake lumps riding the belt
    for (let i = 0; i < 18; i++) {
      const lump = box(0.42, 0.22, 0.5, matte(C.cake, 0.95));
      lump.position.set(-span / 2 + (span * i) / 18, 0.58, (Math.random() - 0.5) * 0.7);
      this.lumps.push(lump);
      conv.add(lump);
    }
    this.span = span;

    conv.position.set(L / 2 + 2.4, RISE / 2 + 1.6, 0);
    conv.rotation.z = ang;
    g.add(conv);

    // conveyor gantry legs
    for (const f of [0.35, 0.75]) {
      const h = 1.6 + RISE * f;
      const leg = box(0.24, h, 0.24, metal(C.steel));
      leg.position.set(2.4 + L * f, h / 2, 0);
      g.add(leg);
    }

    this.focus.set(6, 5, 0);
    this.mountTag(9.0);
  }

  private span: number;

  update(t: Telemetry, dt: number, fx: FX) {
    const f = clamp01(t.cakeBin.pct / 100);
    const h = Math.max(0.05, f * 4.0);
    this.contents.scale.set(1, h / 4.2 * 4.2 / 4.2, 1);
    this.contents.scale.y = h / 4.2;
    this.contents.position.y = 2.1 + (h - 4.2) / 2 + 2.1 - h / 2 + h / 2;
    this.contents.position.y = 2.1 + h / 2;
    this.level.setLevel(f, f < 0.05 ? C.red : f > 0.95 ? C.amber : C.cake);

    const moving = t.filter.throughput > 0.5 || t.mixer.paste.solids > 0.5;
    const v = moving ? 1.9 : 0;
    setFlow(this.belt, v);
    this.pulleyA.rotation.z -= dt * v * 2.6;
    this.pulleyB.rotation.z -= dt * v * 2.6;

    for (const l of this.lumps) {
      l.position.x += dt * v * 1.6;
      l.visible = moving;
      if (l.position.x > this.span / 2) l.position.x = -this.span / 2;
    }

    this.tag.set(
      t.cakeBin.mass.toFixed(0) + ' t',
      (t.cakeBin.cw * 100).toFixed(1) + '% solids',
      f < 0.05 ? 'warn' : 'ok',
    );
  }
}

// ======================================================== 05 BINDER SILO

/** Binder silo with a weigh-feeder screw down to the mixer. */
export class BinderSilo extends Unit {
  readonly id = 'silo';
  readonly name = 'Binder Silo';

  private level: LevelBar;
  private contents: THREE.Mesh;
  private screwFlow: FlowMaterial;
  private screwMotor = new THREE.Group();
  private ventPuff: THREE.Mesh;
  private ventSpout?: Spout;
  private feedSpout?: Spout;
  private ventY = 0;
  private feedY = 0;
  private _w = new THREE.Vector3();

  constructor() {
    super('BINDER SILO', 2.8, '#e2e7f0');
    const g = this.group;
    const R = 3.0, H = 12, LEG = 7.0;

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const l = box(0.34, LEG, 0.34, metal(C.steel, 0.65, 0.9));
      l.position.set(Math.cos(a) * (R - 0.5), LEG / 2, Math.sin(a) * (R - 0.5));
      g.add(l);
      const brace = box(0.14, LEG * 0.8, 0.14, metal(C.steelDark));
      brace.position.set(Math.cos(a) * (R - 0.2), LEG * 0.45, Math.sin(a) * (R - 0.2));
      brace.rotation.z = 0.24;
      brace.rotation.y = -a;
      g.add(brace);
    }

    const cone = cyl(R, 0.5, 2.6, metal(0x46505f, 0.5, 0.9), 32);
    cone.position.y = LEG + 1.3;
    g.add(cone);

    const shell = cyl(R, R, H, metal(0x9aa6b6, 0.45, 0.85), 40);
    shell.position.y = LEG + 2.6 + H / 2;
    g.add(shell);
    g.add(bands(R, [LEG + 4.5, LEG + 9, LEG + 13.5]));

    this.contents = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.12, R - 0.12, 1, 32),
      liquor(C.binder, 1),
    );
    g.add(this.contents);
    this.baseY = LEG + 2.4;
    this.maxH = H;

    const roof = cyl(R + 0.2, R, 1.0, metal(C.steelDark), 40);
    roof.position.y = LEG + 2.6 + H + 0.5;
    g.add(roof);

    // dust collector + vent
    const dc = cyl(1.0, 1.0, 2.2, metal(C.steelLight, 0.5, 0.9), 20);
    dc.position.set(1.2, LEG + 2.6 + H + 2.0, 0);
    g.add(dc);
    this.ventPuff = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0xdfe6f2, transparent: true, opacity: 0.18, roughness: 1,
      }),
    );
    this.ventPuff.position.set(1.2, LEG + 2.6 + H + 3.4, 0);
    g.add(this.ventPuff);

    const beaconRing = strip(5.4, C.binder, 0.09, 1.4);
    beaconRing.position.y = LEG + 2.6 + H + 1.1;
    g.add(beaconRing);

    this.level = new LevelBar(H - 1, C.binder, 0.44);
    this.level.group.position.set(-R - 0.3, LEG + 3.0, 0);
    this.level.group.rotation.y = -Math.PI / 2;
    g.add(this.level.group);

    const lad = ladder(LEG + 2.6 + H + 1.2);
    lad.position.set(0, 0, -R - 0.3);
    g.add(lad);

    // weigh feeder + inclined screw conveyor toward the mixer
    const weigh = box(1.8, 1.2, 1.8, metal(C.steelDark, 0.5, 0.9));
    weigh.position.y = LEG - 0.4;
    g.add(weigh);
    const weighLamp = strip(1.6, C.amber, 0.08, 2.0);
    weighLamp.position.set(0, LEG + 0.25, 0.92);
    g.add(weighLamp);

    this.screwFlow = flowMaterial(C.binder, { density: bandsFor(15.5), intensity: 1.4, base: 0x5a6779 });
    const screwLen = 15.5;
    const screw = tube(0.42, screwLen, this.screwFlow, 18);
    screw.rotation.z = -Math.PI / 2 + 0.30;
    screw.position.set(7.4, LEG - 1.4 + 2.35, 8.0);
    screw.rotation.y = -Math.atan2(8.0, 7.4) + 0.0;
    g.add(screw);
    this.screwPos = screw;

    const mot = cyl(0.4, 0.4, 1.1, metal(0x3c4a5c, 0.45, 0.9), 16);
    mot.rotation.z = Math.PI / 2;
    this.screwMotor.add(mot);
    this.screwMotor.position.set(0.9, LEG - 1.2, 0.9);
    g.add(this.screwMotor);

    this.ventY = LEG + 2.6 + H + 3.4;
    this.feedY = LEG - 0.4;
    this.focus.set(0, 9, 0);
    this.mountTag(LEG + H + 7.0);
  }

  private baseY: number;
  private maxH: number;
  private screwPos: THREE.Mesh;

  update(t: Telemetry, dt: number, fx: FX) {
    const f = clamp01(t.silo.pct / 100);
    const h = Math.max(0.05, f * this.maxH);
    this.contents.scale.y = h;
    this.contents.position.y = this.baseY + h / 2;
    this.level.setLevel(f, f < 0.08 ? C.red : C.binder);

    const feeding = t.silo.feedRate > 0.05;
    setFlow(this.screwFlow, feeding ? 1.2 : 0);
    this.screwMotor.rotation.x += dt * (feeding ? 9 : 0);
    this.ventPuff.scale.setScalar(1 + Math.sin(t.time * 0.7) * 0.15);
    (this.ventPuff.material as THREE.MeshStandardMaterial).opacity = feeding ? 0.2 : 0.05;

    // binder dust: a lazy plume off the bin vent while the screw is drawing,
    // and a hard puff when a delivery lands
    this.ventSpout ??= new Spout(fx.haze, 6, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, 0.55, 0),
      spread: new THREE.Vector3(0.28, 0.2, 0.28),
      jitter: new THREE.Vector3(0.4, 0.2, 0.4),
      colour: C.binder, size: 0.7, sizeVary: 0.4,
      life: 3.4, lifeVary: 0.4, gravity: 0.12, drag: 0.4, grow: 2.6,
    }));
    this._w.set(this.group.position.x + 1.2, this.ventY, this.group.position.z);
    this.ventSpout.run(dt, feeding ? 1 : 0.18, this._w);

    this.feedSpout ??= new Spout(fx.haze, 9, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, -0.3, 0),
      spread: new THREE.Vector3(0.5, 0.25, 0.5),
      jitter: new THREE.Vector3(0.5, 0.25, 0.5),
      colour: C.binder, size: 0.45, sizeVary: 0.5,
      life: 2.0, gravity: -0.9, drag: 0.45, grow: 2.0, floor: 0.2,
    }));
    this._w.set(this.group.position.x, this.feedY, this.group.position.z);
    this.feedSpout.run(dt, feeding ? 1 : 0, this._w);

    this.tag.set(
      t.silo.mass.toFixed(0) + ' t',
      t.silo.feedRate.toFixed(1) + ' t/h out',
      f < 0.08 ? 'warn' : 'ok',
    );
  }
}

// ============================================================== 06 MIXER

/**
 * Continuous twin-shaft paddle mixer.
 * Cake, binder and mix water land in the trough; the two shafts counter-rotate
 * and what comes out the end is paste at whatever slump you asked for.
 */
export class Mixer extends Unit {
  readonly id = 'mixer';
  readonly name = 'Twin-Shaft Mixer';

  private shaftA = new THREE.Group();
  private shaftB = new THREE.Group();
  private bed: THREE.Mesh;
  private bedMat: THREE.MeshStandardMaterial;
  private waterFlow: FlowMaterial;
  private dischargeFlow: FlowMaterial;
  private beacon = new Beacon();
  private deck = 10.0;

  constructor() {
    super('MIXER', 2.8, '#ffab3d');
    const g = this.group;
    const D = this.deck;

    const plat = platform(12, 8, { y: D, accent: C.amber });
    g.add(plat);

    // trough
    const TW = 8.0, TD = 2.6, TH = 2.4;
    const troughMat = metal(0x3a4450, 0.55, 0.88);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(TD / 2, TD / 2, TW, 24, 1, false, 0, Math.PI),
      troughMat,
    );
    floor.rotation.z = Math.PI / 2;
    floor.rotation.y = Math.PI;
    floor.position.set(0, D + 1.4, 0);
    g.add(floor);

    for (const sz of [-1, 1]) {
      const side = box(TW, TH * 0.6, 0.14, troughMat);
      side.position.set(0, D + 1.4 + TH * 0.3, (sz * TD) / 2);
      g.add(side);
    }
    for (const sx of [-1, 1]) {
      const end = box(0.16, TH, TD, troughMat);
      end.position.set((sx * TW) / 2, D + 1.5, 0);
      g.add(end);
    }

    // inspection lid so the paddles are visible
    const lid = new THREE.Mesh(new THREE.PlaneGeometry(TW, TD), glass(0xbfe6ff, 0.12));
    lid.rotation.x = -Math.PI / 2;
    lid.position.set(0, D + 2.7, 0);
    g.add(lid);

    // the paste in the trough
    this.bedMat = liquor(C.paste, 1);
    this.bed = new THREE.Mesh(new THREE.BoxGeometry(TW - 0.4, 0.9, TD - 0.35), this.bedMat);
    this.bed.position.set(0, D + 1.2, 0);
    g.add(this.bed);

    // twin shafts with paddles
    for (const [shaft, sz, dir] of [
      [this.shaftA, -0.62, 1], [this.shaftB, 0.62, -1],
    ] as const) {
      const s = tube(0.18, TW - 0.6, metal(0x8d98a8, 0.35, 0.95), 12);
      s.rotation.z = Math.PI / 2;
      shaft.add(s);
      const np = 12;
      for (let i = 0; i < np; i++) {
        const arm = box(0.11, 0.78, 0.11, metal(C.steelLight));
        const a = (i / np) * Math.PI * 4 * dir;
        arm.position.set(-((TW - 1.2) / 2) + ((TW - 1.2) * i) / (np - 1), 0.39, 0);
        arm.rotation.x = a;
        arm.position.y = Math.cos(a) * 0.39;
        arm.position.z = Math.sin(a) * 0.39;
        shaft.add(arm);
        const pad = box(0.34, 0.28, 0.1, metal(0x6b7787, 0.45, 0.9));
        pad.position.set(arm.position.x, Math.cos(a) * 0.72, Math.sin(a) * 0.72);
        pad.rotation.x = a + 0.5;
        shaft.add(pad);
      }
      shaft.position.set(0, D + 1.55, sz);
      g.add(shaft);
    }

    // drive end
    const gearbox = box(1.6, 1.8, 2.6, metal(C.steelDark, 0.5, 0.9));
    gearbox.position.set(-TW / 2 - 1.0, D + 1.7, 0);
    g.add(gearbox);
    const motor = cyl(0.6, 0.6, 2.0, metal(0x3c4a5c, 0.4, 0.92), 20);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-TW / 2 - 2.6, D + 1.7, 0);
    g.add(motor);
    const motLamp = strip(1.8, C.amber, 0.09, 2.2);
    motLamp.position.set(-TW / 2 - 2.6, D + 2.4, 0);
    g.add(motLamp);

    // mix water ring main
    this.waterFlow = flowMaterial(C.water, { density: bandsFor(9.5), intensity: 1.0 });
    const wl = tube(0.16, 9.5, this.waterFlow, 12);
    wl.rotation.z = Math.PI / 2;
    wl.position.set(0, D + 3.3, -1.6);
    g.add(wl);
    for (let i = 0; i < 5; i++) {
      const spray = tube(0.07, 0.6, metal(C.steelLight), 8);
      spray.position.set(-3.2 + i * 1.6, D + 3.0, -1.3);
      g.add(spray);
    }

    // discharge chute into the pump hopper
    this.dischargeFlow = flowMaterial(C.paste, { density: bandsFor(5.2), intensity: 1.8 });
    const chute = tube(0.55, 5.2, this.dischargeFlow, 18);
    chute.position.set(TW / 2 + 1.6, D - 0.6, 0);
    chute.rotation.z = -0.62;
    g.add(chute);

    this.beacon.group.position.set(-5.4, D + 0.1, 3.4);
    g.add(this.beacon.group);

    this.focus.set(0, D + 2, 0);
    this.mountTag(D + 7.0);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const m = t.mixer;
    const running = m.paste.solids > 0.5;
    this.shaftA.rotation.x += dt * (running ? 3.6 : 0);
    this.shaftB.rotation.x -= dt * (running ? 3.6 : 0);

    // paste colour warms as it gets richer in binder
    const rich = clamp01((m.binderDose - 2) / 6);
    this.bedMat.color.lerpColors(new THREE.Color(0x8c7150), new THREE.Color(0xd8a463), rich);
    this.bedMat.emissive.copy(this.bedMat.color);
    this.bedMat.emissiveIntensity = running ? 0.3 : 0.08;
    this.bed.scale.y = running ? 1 : 0.35;
    this.bed.position.y = this.deck + 1.2 - (running ? 0 : 0.28);

    setFlow(this.waterFlow, m.mixWater > 0.5 ? 2.4 : 0);
    setFlow(this.dischargeFlow, running ? 1.6 : 0);

    const tone = m.waterLimited ? 'warn'
      : m.ucs < DESIGN.targetUcs * 0.9 ? 'warn' : 'ok';
    this.beacon.set(tone === 'warn' ? C.amber : running ? C.lime : C.cyan, 2.4);

    this.tag.set(
      m.slump.toFixed(0) + ' mm',
      'slump  ' + (m.cw * 100).toFixed(1) + '% Cw',
      tone as 'ok' | 'warn',
    );
  }
}

// ========================================================= 07 PASTE PUMP

/**
 * Twin-cylinder positive-displacement paste pump.
 * The two rams work 180 degrees out of phase and the S-tube swings between
 * them, which is why the discharge pressure pulses rather than sitting flat.
 */
export class PastePump extends Unit {
  readonly id = 'pump';
  readonly name = 'Paste Pump 01';

  private ramA: THREE.Mesh;
  private ramB: THREE.Mesh;
  private sTube = new THREE.Group();
  private hopperPaste: THREE.Mesh;
  private gauge: LevelBar;
  private beacon = new Beacon();
  private outFlow: FlowMaterial;
  private accum: THREE.Mesh;
  private leakSpout?: Spout;
  private _w = new THREE.Vector3();
  /** the skid shakes around this, so remember where it belongs */
  homeX = 0;

  constructor() {
    super('PASTE PUMP', 2.8, '#ffab3d');
    const g = this.group;

    const skid = box(11, 0.5, 6, metal(C.steelDark, 0.6, 0.9));
    skid.position.y = 0.25;
    g.add(skid);
    const skidEdge = strip(10.8, C.amber, 0.08, 1.6);
    skidEdge.position.set(0, 0.55, 3.0);
    g.add(skidEdge);

    // receiving hopper
    const hop = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 1.2, 2.6, 4),
      metal(C.steel, 0.6, 0.88),
    );
    hop.rotation.y = Math.PI / 4;
    hop.position.set(-2.6, 3.4, 0);
    g.add(hop);
    this.hopperPaste = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 1.1, 1.4, 4),
      liquor(C.paste, 1),
    );
    this.hopperPaste.rotation.y = Math.PI / 4;
    this.hopperPaste.position.set(-2.6, 3.1, 0);
    g.add(this.hopperPaste);

    // material cylinders + hydraulic drive cylinders
    const matCylMat = metal(0x55606f, 0.35, 0.95);
    const rodMat = metal(0xc3ccd8, 0.12, 1.0);
    for (const sz of [-0.95, 0.95]) {
      const mc = tube(0.55, 3.4, matCylMat, 20);
      mc.rotation.z = Math.PI / 2;
      mc.position.set(-0.4, 2.3, sz);
      g.add(mc);
      const hc = tube(0.48, 2.6, metal(0x3f4956, 0.4, 0.92), 20);
      hc.rotation.z = Math.PI / 2;
      hc.position.set(2.9, 2.3, sz);
      g.add(hc);
      const f1 = flange(0.55); f1.rotation.z = Math.PI / 2; f1.position.set(1.3, 2.3, sz); g.add(f1);
    }
    this.ramA = tube(0.2, 2.2, rodMat, 14);
    this.ramA.rotation.z = Math.PI / 2;
    this.ramA.position.z = -0.95;
    g.add(this.ramA);
    this.ramB = tube(0.2, 2.2, rodMat, 14);
    this.ramB.rotation.z = Math.PI / 2;
    this.ramB.position.z = 0.95;
    g.add(this.ramB);

    // S-tube transfer valve
    const s1 = tube(0.42, 1.5, metal(0x6b7787, 0.4, 0.92), 16);
    s1.rotation.z = Math.PI / 3;
    s1.position.set(-2.3, 2.3, 0);
    this.sTube.add(s1);
    const s2 = tube(0.42, 1.2, metal(0x6b7787, 0.4, 0.92), 16);
    s2.rotation.z = Math.PI / 2;
    s2.position.set(-1.5, 1.85, 0);
    this.sTube.add(s2);
    this.sTube.position.set(-1.8, 0, 0);
    g.add(this.sTube);

    // hydraulic power pack + accumulator
    const hpu = box(3.2, 2.0, 2.4, metal(C.steelDark, 0.55, 0.9));
    hpu.position.set(3.6, 1.5, -2.0);
    g.add(hpu);
    const hpuLamp = strip(2.8, C.cyan, 0.09, 2.0);
    hpuLamp.position.set(3.6, 2.55, -0.85);
    g.add(hpuLamp);
    this.accum = cyl(0.5, 0.5, 2.6, metal(0x4a5666, 0.35, 0.95), 18);
    this.accum.position.set(4.4, 2.8, 1.6);
    g.add(this.accum);

    // discharge spool to the borehole
    this.outFlow = flowMaterial(C.paste, { density: bandsFor(4.2), intensity: 2.0 });
    const out = tube(0.38, 4.2, this.outFlow, 18);
    out.rotation.z = Math.PI / 2;
    out.position.set(6.4, 2.3, 0);
    g.add(out);
    const of1 = flange(0.38); of1.rotation.z = Math.PI / 2; of1.position.set(4.4, 2.3, 0); g.add(of1);

    // discharge pressure gauge, read as a bar
    this.gauge = new LevelBar(3.2, C.lime, 0.42);
    this.gauge.group.position.set(-5.0, 1.0, 2.6);
    g.add(this.gauge.group);

    this.beacon.group.position.set(-5.0, 0.5, -2.6);
    g.add(this.beacon.group);

    this.focus.set(0, 3, 0);
    this.mountTag(8.0);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const p = t.pump;
    const ph = p.strokePhase * Math.PI * 2;
    const active = p.flow > 0.5;
    const amp = active ? 0.9 : 0;

    this.ramA.position.x = 3.3 + Math.sin(ph) * amp;
    this.ramB.position.x = 3.3 + Math.sin(ph + Math.PI) * amp;
    this.sTube.rotation.x = Math.sin(ph) * (active ? 0.45 : 0);

    this.hopperPaste.scale.y = active ? 1 : 0.35;
    this.hopperPaste.position.y = active ? 3.1 : 2.8;

    const pct = clamp01(p.pressurePct / 100);
    this.gauge.setLevel(pct, pct > 1 ? C.red : pct > 0.85 ? C.amber : C.lime);

    // accumulator breathes with the stroke
    this.accum.scale.y = 1 + Math.sin(ph * 2) * (active ? 0.04 : 0);

    setFlow(this.outFlow, active ? t.pipe.velocity : 0, 1, active ? 1 : 0);

    // At the rating the gland and the spool joints start weeping paste, and a
    // plugged line hammers - both are the plant telling you before it fails.
    const leak = t.spills.leak;
    this.leakSpout ??= new Spout(fx.spray, 30, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0.4, 1.4, 0),
      spread: new THREE.Vector3(1.6, 1.0, 1.6),
      jitter: new THREE.Vector3(0.5, 0.15, 0.2),
      colour: C.paste, size: 0.12, sizeVary: 0.6,
      life: 0.9, lifeVary: 0.5, gravity: -9.81, drag: 0.5,
      floor: 0.12, bounce: 0,
    }));
    this._w.set(this.group.position.x + 4.6, 2.3, this.group.position.z);
    this.leakSpout.run(dt, leak, this._w);

    // the whole skid shudders when the line is plugged
    const shake = t.pipe.plugged ? 0.055 : leak > 0.3 ? 0.018 * leak : 0;
    this.group.position.x = this.homeX + (Math.random() - 0.5) * 2 * shake;
    this.group.position.y = (Math.random() - 0.5) * 2 * shake;

    this.beacon.set(
      t.pipe.plugged ? C.red : p.starved ? C.amber : active ? C.lime : C.cyan,
      t.pipe.plugged ? 6 : 2.4,
    );

    this.tag.set(
      (p.pressure / 100).toFixed(0) + ' bar',
      p.flow.toFixed(0) + ' m3/h  ' + p.strokesPerMin.toFixed(0) + ' spm',
      t.pipe.plugged ? 'trip' : pct > 0.85 ? 'warn' : 'ok',
    );
  }
}
