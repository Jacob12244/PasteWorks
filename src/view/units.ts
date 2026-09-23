import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { C, metal, matte, glass, glow, glowUnique, liquor } from './palette';
import {
  box, cyl, tube, flange, strip, platform, railing, ladder, ribs, bands,
  pipeSupport, pipeRun, member, deck, railRun, plinth, stairFlight, LevelBar, Beacon, Tag,
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
 * High-rate thickener: 18 m diameter, bridge-mounted rake drive.
 * The rake turns at about one revolution every ten minutes, the bed depth
 * you can see through the launder tracks the solids inventory, and the
 * overflow goes from clear blue to muddy when you out-run the settling flux.
 */
export class Thickener extends Unit {
  readonly id = 'thickener';
  readonly name = 'Thickener 01';

  /** the bridge is fixed; only the rake underneath it turns */
  private bridge = new THREE.Group();
  private rake = new THREE.Group();
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

    // Rake arms and blades, hung off a centre shaft from the drive. On a
    // bridge thickener the bridge is a fixed walkway and only this turns -
    // the feed pipe and the drive house would otherwise be spinning too.
    const shaft = tube(0.28, rim - 1.6, metal(C.steelLight, 0.4, 0.9), 12);
    shaft.position.y = 1.6 + (rim - 1.6) / 2;
    this.rake.add(shaft);
    for (const sx of [-1, 1]) {
      const arm = box(R - 0.6, 0.3, 0.3, metal(C.steelDark));
      arm.position.set((sx * (R - 0.6)) / 2, 2.4, 0);
      this.rake.add(arm);
      const nb = 7;
      for (let i = 1; i <= nb; i++) {
        const f = i / nb;
        const blade = box(0.12, 0.7, 0.55, metal(C.steelDark));
        blade.position.set(sx * (R - 0.6) * f, 2.05, 0);
        blade.rotation.y = sx * 0.55;
        this.rake.add(blade);
      }
    }
    // pickets on the arms, which is what actually reads as turning from above
    for (const sx of [-1, 1]) {
      for (let i = 1; i <= 4; i++) {
        const pk = box(0.08, 1.6, 0.08, metal(C.steelLight));
        pk.position.set(sx * (R - 0.6) * (i / 4.4), 3.3, 0);
        this.rake.add(pk);
      }
    }
    g.add(this.bridge, this.rake);

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
    this.rake.rotation.y = th.rakeAngle;

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

  /**
   * @param head where the belt has to deliver to, in this unit's local
   *   coordinates - the top of the mixer's feed hood. The belt is built to
   *   land exactly there rather than at a fixed length and angle, which is how
   *   it used to end up driving into the underside of the mixer deck.
   */
  constructor(head = new THREE.Vector3(12.2, 11.6, 0)) {
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

    // legs on the diagonals, clear of the belt running out underneath
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const l = box(0.26, 2.2, 0.26, metal(C.steel));
      l.position.set(Math.cos(a) * 2.2, 1.1, Math.sin(a) * 2.2);
      g.add(l);
    }

    this.level = new LevelBar(3.6, C.cake, 0.36);
    this.level.group.position.set(0, 2.6, 3.0);
    g.add(this.level.group);

    // Steep-angle belt: bin outlet -> the top of the mixer's feed hood. At
    // this lift it is a sidewall pocket belt, not a plain troughed one - a
    // plain belt would roll the cake straight back down past about 18 deg.
    const tail = new THREE.Vector3(0.6, 1.3, 0);
    const L = head.x - tail.x, RISE = head.y - tail.y;
    const ang = Math.atan2(RISE, L);
    const conv = new THREE.Group();
    const span = Math.hypot(L, RISE);

    this.belt = beltMaterial(C.cake);
    const beltMesh = box(span, 0.12, 1.5, this.belt);
    beltMesh.position.y = 0.42;
    conv.add(beltMesh);

    const frame = box(span, 0.22, 1.9, metal(C.steelDark, 0.6, 0.9));
    conv.add(frame);
    // corrugated sidewalls, which are what make it a pocket belt
    const wallMat = matte(0x2b323c, 0.9);
    for (const sz of [-0.82, 0.82]) {
      const side = box(span, 0.75, 0.08, wallMat);
      side.position.set(0, 0.85, sz);
      conv.add(side);
      const n = Math.floor(span / 0.55);
      for (let i = 0; i <= n; i++) {
        const rib = box(0.07, 0.75, 0.12, metal(C.steel));
        rib.position.set(-span / 2 + (span * i) / n, 0.85, sz);
        conv.add(rib);
      }
    }
    // cleats across the belt, every pocket
    const cleatN = Math.floor(span / 0.9);
    for (let i = 0; i < cleatN; i++) {
      const cl = box(0.06, 0.28, 1.5, metal(0x3a4450, 0.6, 0.8));
      cl.position.set(-span / 2 + 0.4 + (span - 0.8) * (i / (cleatN - 1)), 0.62, 0);
      conv.add(cl);
    }
    for (const sz of [-0.95, 0.95]) {
      const side = box(span, 0.3, 0.1, metal(C.steel));
      side.position.set(0, 0.2, sz);
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

    conv.position.set((tail.x + head.x) / 2, (tail.y + head.y) / 2, 0);
    conv.rotation.z = ang;
    g.add(conv);

    // enclosed head chute over the hood, where the cake drops off the belt
    const headBox = box(1.6, 1.3, 2.0, metal(C.steelDark, 0.55, 0.9));
    headBox.position.set(head.x + 0.35, head.y - 0.35, 0);
    g.add(headBox);

    // Gantry: A-frames out on the flat, and a single post nearer the top
    // where the belt is high and the mixer platform does the rest.
    for (const f of [0.3, 0.62]) {
      const x = tail.x + L * f;
      const h = tail.y + RISE * f - 0.15;
      for (const sz of [-1.1, 1.1]) {
        const leg = box(0.24, h, 0.24, metal(C.steel));
        leg.position.set(x, h / 2, sz);
        g.add(leg);
      }
      const tie = box(0.18, 0.18, 2.4, metal(C.steelDark));
      tie.position.set(x, h * 0.55, 0);
      g.add(tie);
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

/**
 * Two binder silos on braced lattice legs, each with its own weigh feeder and
 * a long inclined screw up to the mixer's feed hood. A real plant runs two so
 * a tanker can discharge into one while the other feeds; here they draw
 * together and hold the one inventory between them.
 */
export class BinderSilo extends Unit {
  readonly id = 'silo';
  readonly name = 'Binder Silos';

  private levels: LevelBar[] = [];
  private contents: THREE.Mesh[] = [];
  private screwFlows: FlowMaterial[] = [];
  private screwMotors: THREE.Group[] = [];
  private ventPuff: THREE.Mesh;
  private ventSpout?: Spout;
  private feedSpout?: Spout;
  private ventY = 0;
  private feedY = 0;
  private _w = new THREE.Vector3();
  private baseY = 0;
  private maxH = 0;
  /** local x of the two silo centre lines */
  static readonly SX = 3.5;

  /** @param target where the screws discharge, local coordinates - the mixer's feed hood */
  constructor(target = new THREE.Vector3(8.6, 10.9, 15.7)) {
    super('BINDER SILOS', 2.8, '#e2e7f0');
    const g = this.group;
    const R = 3.0, H = 12, LEG = 7.0, SX = BinderSilo.SX;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const top = LEG + 2.6 + H;
    this.baseY = LEG + 2.4;
    this.maxH = H;

    for (const [i, cx] of [-SX, SX].entries()) {
      // ---- lattice legs: four on the diagonals, landing on the shell where
      // the cone meets it, X-braced in two tiers. The south face is only
      // braced low, because the screw leaves through it.
      const q = 2.1;
      const legMat = metal(C.steel, 0.65, 0.9);
      const brace = metal(C.steelDark, 0.6, 0.9);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const l = box(0.36, LEG + 2.6, 0.36, legMat);
          l.position.set(cx + sx * q, (LEG + 2.6) / 2, sz * q);
          g.add(l);
          const foot = plinth(1.0, 0.4, 1.0);
          foot.position.set(cx + sx * q, 0, sz * q);
          g.add(foot);
        }
      }
      const faces: Array<[THREE.Vector3, THREE.Vector3, boolean]> = [
        [V(cx - q, 0, -q), V(cx + q, 0, -q), true],
        [V(cx - q, 0, -q), V(cx - q, 0, q), true],
        [V(cx + q, 0, -q), V(cx + q, 0, q), true],
        [V(cx - q, 0, q), V(cx + q, 0, q), false],
      ];
      for (const [a, b, full] of faces) {
        for (const [y0, y1] of full ? [[0.5, 3.8], [3.8, LEG]] : [[0.5, 3.8]]) {
          g.add(member(a.clone().setY(y0), b.clone().setY(y1), 0.16, brace));
          g.add(member(b.clone().setY(y0), a.clone().setY(y1), 0.16, brace));
        }
        g.add(member(a.clone().setY(3.8), b.clone().setY(3.8), 0.2, legMat));
        g.add(member(a.clone().setY(LEG + 0.35), b.clone().setY(LEG + 0.35), 0.24, legMat));
      }

      const cone = cyl(R, 0.5, 2.6, metal(0x46505f, 0.5, 0.9), 32);
      cone.position.set(cx, LEG + 1.3, 0);
      g.add(cone);
      const shell = cyl(R, R, H, metal(0x9aa6b6, 0.45, 0.85), 40);
      shell.position.set(cx, LEG + 2.6 + H / 2, 0);
      g.add(shell);
      const hoops = bands(R, [LEG + 4.5, LEG + 9, LEG + 13.5]);
      hoops.position.x = cx;
      g.add(hoops);

      const content = new THREE.Mesh(
        new THREE.CylinderGeometry(R - 0.12, R - 0.12, 1, 32),
        liquor(C.binder, 1),
      );
      content.position.x = cx;
      g.add(content);
      this.contents.push(content);

      const roof = cyl(R + 0.2, R, 1.0, metal(C.steelDark), 40);
      roof.position.set(cx, top + 0.5, 0);
      g.add(roof);
      const dc = cyl(1.0, 1.0, 2.2, metal(C.steelLight, 0.5, 0.9), 20);
      dc.position.set(cx + (i ? 1.4 : -1.4), top + 2.0, 0);
      g.add(dc);

      const ring = strip(5.4, C.binder, 0.09, 1.4);
      ring.position.set(cx, top + 1.1, 0);
      g.add(ring);

      // a level bar on each outboard side
      const level = new LevelBar(H - 1, C.binder, 0.44);
      level.group.position.set(cx + (i ? R + 0.3 : -R - 0.3), LEG + 3.0, 0);
      level.group.rotation.y = i ? Math.PI / 2 : -Math.PI / 2;
      g.add(level.group);
      this.levels.push(level);

      // ---- weigh feeder under the cone, and the screw up to the mixer, built
      // between the two points it actually has to join
      const weigh = box(1.8, 1.2, 1.8, metal(C.steelDark, 0.5, 0.9));
      weigh.position.set(cx, LEG - 0.4, 0);
      g.add(weigh);
      const weighLamp = strip(1.6, C.amber, 0.08, 2.0);
      weighLamp.position.set(cx, LEG + 0.25, 0.92);
      g.add(weighLamp);

      const from = V(cx + 0.9, LEG - 0.9, 0.9);
      const to = target.clone().add(V(i ? 0.5 : -0.5, 0, i ? 0.25 : 0));
      const screwLen = from.distanceTo(to);
      const flow = flowMaterial(C.binder, { density: bandsFor(screwLen), intensity: 0.55, base: 0x5a6779 });
      this.screwFlows.push(flow);
      const screw = tube(0.42, screwLen, flow, 18);
      screw.position.copy(from).lerp(to, 0.5);
      screw.quaternion.setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize());
      g.add(screw);
      const spout = tube(0.3, 1.0, metal(C.steelDark), 12);
      spout.position.set(to.x, to.y - 0.5, to.z);
      g.add(spout);
      const mid = from.clone().lerp(to, 0.4);
      const trestle = box(0.24, mid.y - 0.4, 0.24, metal(C.steel));
      trestle.position.set(mid.x, (mid.y - 0.4) / 2, mid.z);
      g.add(trestle);

      const motorG = new THREE.Group();
      const mot = cyl(0.4, 0.4, 1.1, metal(0x3c4a5c, 0.45, 0.9), 16);
      mot.rotation.z = Math.PI / 2;
      motorG.add(mot);
      motorG.position.set(cx + 0.9, LEG - 1.2, 0.9);
      g.add(motorG);
      this.screwMotors.push(motorG);
    }

    // the ladder up the west silo, and a walkway across both roofs
    const lad = ladder(top + 1.2);
    lad.position.set(-SX, 0, -R - 0.3);
    g.add(lad);
    const walk = deck(2 * SX, 1.4, top + 1.05);
    g.add(walk);
    for (const z of [-0.7, 0.7]) g.add(railRun(V(-SX, top + 1.05, z), V(SX, top + 1.05, z), C.cyan));

    this.ventPuff = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0xdfe6f2, transparent: true, opacity: 0.18, roughness: 1,
      }),
    );
    this.ventPuff.position.set(-SX - 1.4, top + 3.4, 0);
    g.add(this.ventPuff);

    this.ventY = top + 3.4;
    this.feedY = LEG - 0.4;
    this.focus.set(0, 9, 0);
    this.mountTag(LEG + H + 7.0);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const f = clamp01(t.silo.pct / 100);
    const h = Math.max(0.05, f * this.maxH);
    for (const c of this.contents) {
      c.scale.y = h;
      c.position.y = this.baseY + h / 2;
    }
    for (const l of this.levels) l.setLevel(f, f < 0.08 ? C.red : C.binder);

    const feeding = t.silo.feedRate > 0.05;
    for (const s of this.screwFlows) setFlow(s, feeding ? 1.2 : 0);
    for (const m of this.screwMotors) m.rotation.x += dt * (feeding ? 9 : 0);
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
    this._w.set(this.group.position.x - BinderSilo.SX - 1.4, this.ventY, this.group.position.z);
    this.ventSpout.run(dt, feeding ? 1 : 0.18, this._w);

    this.feedSpout ??= new Spout(fx.haze, 9, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, -0.3, 0),
      spread: new THREE.Vector3(0.5, 0.25, 0.5),
      jitter: new THREE.Vector3(0.5, 0.25, 0.5),
      colour: C.binder, size: 0.45, sizeVary: 0.5,
      life: 2.0, gravity: -0.9, drag: 0.45, grow: 2.0, floor: 0.2,
    }));
    this._w.set(this.group.position.x - BinderSilo.SX, this.feedY, this.group.position.z);
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
 * Continuous twin-shaft paddle mixer, on top of the mixing tower.
 * Cake, binder and mix water land in the trough; the two shafts counter-rotate
 * and what comes out the end is paste at whatever slump you asked for.
 *
 * The tower is laid out the way a real backfill plant stacks it, so that
 * everything below the mixer is fed by gravity: the mixer on the top deck,
 * the agitated paste hopper hung under it, and the pumps on the ground under
 * that. A stair runs up the south face - the side the control room looks at -
 * with a landing at each deck, and the motor control centre lives under the
 * mid deck, out of the weather.
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
  private mccLamps: THREE.MeshStandardMaterial[] = [];
  /**
   * Mixer deck height. Set by what has to fit under it: the paste hopper
   * hangs from this deck directly below the discharge gate, and the pumps sit
   * on the ground under the hopper.
   */
  static readonly DECK = 7.0;
  /** the mid deck, level with the hopper's cone */
  static readonly L1 = 3.6;
  /** where the cake belt's head chute lands, local x - the feed end */
  static readonly FEED_X = -2.8;
  /** where the paste leaves through the trough floor, local x */
  static readonly DISCHARGE_X = 3.2;
  /** the tower's footprint, local: west and east column lines, and the half-depth */
  static readonly X0 = -6;
  static readonly X1 = 8.2;
  static readonly Z = 4.5;
  private deck = Mixer.DECK;

  constructor() {
    super('MIXER', 2.8, '#ffab3d');
    const g = this.group;
    const D = this.deck;

    this.buildTower(g);

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
    // the trough stands on two saddles, not on the grating
    for (const sx of [-2.6, 2.6]) {
      const saddle = box(0.5, 0.9, TD + 0.6, metal(C.steelDark, 0.6, 0.9));
      saddle.position.set(sx, D + 0.45, 0);
      g.add(saddle);
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

    // Drive at the discharge end, so the feed end is clear for the belt's
    // head chute to come down on top of the trough.
    const gearbox = box(1.6, 1.8, 2.6, metal(C.steelDark, 0.5, 0.9));
    gearbox.position.set(TW / 2 + 1.0, D + 1.7, 0);
    g.add(gearbox);
    const motor = cyl(0.6, 0.6, 2.0, metal(0x3c4a5c, 0.4, 0.92), 20);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(TW / 2 + 2.6, D + 1.7, 0);
    g.add(motor);
    const motLamp = strip(1.8, C.amber, 0.09, 1.1);
    motLamp.position.set(TW / 2 + 2.6, D + 2.4, 0);
    g.add(motLamp);

    // feed hood over the trough at the belt end, where cake and binder land,
    // with the dust collector that keeps the binder out of the building
    const hood = box(2.2, 1.0, TD + 0.3, metal(C.steelDark, 0.55, 0.9));
    hood.position.set(Mixer.FEED_X, D + 3.2, 0);
    g.add(hood);
    const dcStand = box(1.2, 0.9, 1.2, metal(C.steelDark, 0.55, 0.9));
    dcStand.position.set(Mixer.FEED_X + 1.6, D + 3.1, 1.9);
    g.add(dcStand);
    const dc = cyl(0.7, 0.7, 1.8, metal(C.steelLight, 0.5, 0.9), 20);
    dc.position.set(Mixer.FEED_X + 1.6, D + 4.45, 1.9);
    g.add(dc);
    const dcCone = cyl(0.7, 0.25, 0.6, metal(C.steelLight, 0.5, 0.9), 20);
    dcCone.position.set(Mixer.FEED_X + 1.6, D + 3.25 + 0.0, 1.9);
    g.add(dcCone);

    // mix water ring main
    this.waterFlow = flowMaterial(C.water, { density: bandsFor(9.5), intensity: 1.0 });
    const wl = tube(0.16, 9.5, this.waterFlow, 12);
    wl.rotation.z = Math.PI / 2;
    wl.position.set(0, D + 3.3, 1.6);
    g.add(wl);
    for (let i = 0; i < 5; i++) {
      const spray = tube(0.07, 0.6, metal(C.steelLight), 8);
      spray.position.set(-3.2 + i * 1.6, D + 3.0, 1.3);
      g.add(spray);
    }

    // Discharge gate through the trough floor and down through the deck into
    // the paste hopper hung underneath it.
    const DROP = D + 0.3 - PastePump.HOPPER_TOP;
    this.dischargeFlow = flowMaterial(C.paste, { density: bandsFor(DROP), intensity: 1.8 });
    const chute = tube(0.55, DROP, this.dischargeFlow, 18);
    chute.position.set(Mixer.DISCHARGE_X, PastePump.HOPPER_TOP + DROP / 2, 0);
    g.add(chute);
    const gate = box(1.4, 0.5, 1.4, metal(C.steelDark, 0.5, 0.9));
    gate.position.set(Mixer.DISCHARGE_X, D + 0.05, 0);
    g.add(gate);

    this.beacon.group.position.set(-5.4, D + 0.1, 3.4);
    g.add(this.beacon.group);

    this.focus.set(0, D + 2, 0);
    this.mountTag(D + 7.0);
  }

  /** Frame, decks, bracing, the stair up the south face, and the MCC. */
  private buildTower(g: THREE.Group) {
    const D = this.deck, L1 = Mixer.L1;
    const X0 = Mixer.X0, X1 = Mixer.X1, Z = Mixer.Z;
    const XM = 1.0;
    const cx = (X0 + X1) / 2, w = X1 - X0;
    const col = metal(C.steel, 0.65, 0.9);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // A bunded slab under the lot, carried out under the stair.
    const slab = box(w + 1.2, 0.2, 2 * Z + 2.4, matte(C.concrete, 0.95));
    slab.position.set(cx, 0.1, 0.6);
    g.add(slab);
    const G = 0.2;

    for (const x of [X0, XM, X1]) {
      for (const z of [-Z, Z]) {
        const c = box(0.36, D - G, 0.36, col);
        c.position.set(x, G + (D - G) / 2, z);
        g.add(c);
        const plate = box(0.7, 0.05, 0.7, metal(C.steelDark));
        plate.position.set(x, G + 0.025, z);
        g.add(plate);
      }
    }

    const top = deck(w, 2 * Z, D);
    top.position.x = cx;
    g.add(top);
    // The mid deck is the west bay only: the hopper and the pumps under it
    // take the east bay, full height.
    const mid = deck(XM - X0, 2 * Z, L1);
    mid.position.x = (X0 + XM) / 2;
    g.add(mid);

    // ties round the east bay at mid height, and X-bracing on the three faces
    // the stair is not on - only above the pumps on the east face, where they
    // run out underneath it
    const tie = metal(C.steel, 0.65, 0.9);
    for (const z of [-Z, Z]) g.add(member(V(XM, L1 - 0.3, z), V(X1, L1 - 0.3, z), 0.26, tie));
    g.add(member(V(X1, L1 - 0.3, -Z), V(X1, L1 - 0.3, Z), 0.26, tie));
    const brace = metal(C.steelDark, 0.6, 0.9);
    const xb = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      g.add(member(a, c, 0.16, brace));
      g.add(member(b, d, 0.16, brace));
    };
    for (const [x0, x1] of [[X0, XM], [XM, X1]] as const) {
      for (const [y0, y1] of [[G, L1 - 0.5], [L1, D - 0.5]] as const) {
        xb(V(x0, y0, -Z), V(x1, y0, -Z), V(x1, y1, -Z), V(x0, y1, -Z));
      }
    }
    for (const [y0, y1] of [[G, L1 - 0.5], [L1, D - 0.5]] as const) {
      xb(V(X0, y0, -Z), V(X0, y0, Z), V(X0, y1, Z), V(X0, y1, -Z));
    }
    xb(V(X1, L1, -Z), V(X1, L1, Z), V(X1, D - 0.5, Z), V(X1, D - 0.5, -Z));

    // ---- the stair: two flights along the south face, a landing at each deck
    const SZ = Z + 0.8;        // flight centre line
    const OUT = Z + 1.35;      // outer edge of the landings
    const RUN = 3.8;
    const L1a = -1.8, L1b = -0.4;   // landing at the mid deck
    const L2a = 3.4, L2b = 4.8;     // landing at the top
    const f1 = stairFlight(L1 - G, RUN, 1.0);
    f1.position.set(L1a - RUN, G, SZ);
    g.add(f1);
    const f2 = stairFlight(D - L1, RUN, 1.0);
    f2.position.set(L1b, L1, SZ);
    g.add(f2);
    for (const [a, b, y] of [[L1a, L1b, L1], [L2a, L2b, D]] as const) {
      const land = deck(b - a, OUT - Z, y);
      land.position.set((a + b) / 2, 0, (Z + OUT) / 2);
      g.add(land);
      for (const x of [a, b]) {
        const post = box(0.2, y - G, 0.2, col);
        post.position.set(x, G + (y - G) / 2, OUT - 0.1);
        g.add(post);
      }
      g.add(railRun(V(a, y, OUT), V(b, y, OUT), C.amber));
    }
    g.add(railRun(V(L2b, D, Z), V(L2b, D, OUT), C.amber));

    // Handrails, with the gaps where the landings come in.
    const rail = (a: THREE.Vector3, b: THREE.Vector3) => g.add(railRun(a, b, C.amber));
    rail(V(X0, D, -Z), V(X1, D, -Z));
    rail(V(X0, D, -Z), V(X0, D, Z));
    rail(V(X1, D, -Z), V(X1, D, Z));
    rail(V(X0, D, Z), V(L2a, D, Z));
    rail(V(L2b, D, Z), V(X1, D, Z));
    rail(V(X0, L1, -Z), V(XM, L1, -Z));
    rail(V(X0, L1, -Z), V(X0, L1, Z));
    rail(V(XM, L1, -Z), V(XM, L1, Z));
    rail(V(X0, L1, Z), V(L1a, L1, Z));
    rail(V(L1b, L1, Z), V(XM, L1, Z));

    // ---- motor control centre under the mid deck
    const panel = metal(C.panel, 0.5, 0.45);
    for (let i = 0; i < 5; i++) {
      const x = X0 + 0.9 + i * 0.84;
      const cab = box(0.8, 2.2, 0.6, panel);
      cab.position.set(x, G + 1.1, -Z + 0.6);
      g.add(cab);
      const lampMat = glowUnique(i === 3 ? C.amber : C.lime, 1.8);
      this.mccLamps.push(lampMat);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), lampMat);
      lamp.position.set(x - 0.22, G + 1.85, -Z + 0.92);
      g.add(lamp);
      const handle = box(0.04, 0.3, 0.04, metal(C.steelLight));
      handle.position.set(x + 0.28, G + 1.1, -Z + 0.92);
      g.add(handle);
    }
    const mccSign = strip(4.0, C.cyan, 0.08, 1.2);
    mccSign.position.set(X0 + 2.6, G + 2.36, -Z + 0.92);
    g.add(mccSign);
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
    // the MCC's run lamps: the mixer starter, and the rest as they come on
    this.mccLamps[0].emissive.setHex(running ? C.lime : C.red);

    this.tag.set(
      m.slump.toFixed(0) + ' mm',
      'slump  ' + (m.cw * 100).toFixed(1) + '% Cw',
      tone as 'ok' | 'warn',
    );
  }
}

// ========================================================= 07 PASTE PUMP

/**
 * Paste pumps 01A and 01B, duty and standby, under the paste hopper.
 *
 * Each is a twin-cylinder positive-displacement pump: two material cylinders,
 * their hydraulic drive cylinders behind a water box, and an S-tube in the
 * hopper swinging between the two. The rams work 180 degrees out of phase,
 * which is why the discharge pressure pulses rather than sitting flat. Only
 * the duty pump runs; the standby waits with its discharge valve shut, and
 * both discharge lines join before the paste line.
 *
 * The agitated hopper they draw from hangs under the mixer deck, and a
 * maintenance crane runs over the pumps, because the one job you do more
 * than any other on a paste pump is pull its material cylinders.
 */
export class PastePump extends Unit {
  readonly id = 'pump';
  readonly name = 'Paste Pumps 01A / 01B';

  /** the duty pump's two rods */
  private rams: THREE.Mesh[] = [];
  private lever = new THREE.Group();
  private hopperPaste: THREE.Mesh;
  private agitator = new THREE.Group();
  private fan = new THREE.Group();
  private gauge: LevelBar;
  private beacon = new Beacon();
  private outFlow: FlowMaterial;
  private feedFlow: FlowMaterial;
  private accum: THREE.Mesh;
  private leakSpout?: Spout;
  private _w = new THREE.Vector3();
  /**
   * The skid shakes around this, so remember where it belongs. Captured from
   * wherever the site put it on the first frame: it used to default to 0 and
   * be written back every frame, which quietly moved the whole pump off its
   * foundation and into the middle of the cake bin.
   */
  private home: THREE.Vector3 | null = null;
  /** local x of the paste hopper, so the mixer can be placed over it */
  static readonly HOPPER_X = -2.6;
  /** the hopper's rim, where the mixer's discharge chute ends */
  static readonly HOPPER_TOP = 6.4;
  /** local x where the discharge spool ends and the paste line picks up */
  static readonly OUTLET_X = 8.5;

  constructor() {
    super('PASTE PUMPS', 2.8, '#ffab3d');
    const g = this.group;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const HX = PastePump.HOPPER_X, TOP = PastePump.HOPPER_TOP;

    // ---- the agitated paste hopper, hung from two beams under the mixer deck
    const shell = new THREE.MeshStandardMaterial({
      color: 0x6b7787, roughness: 0.5, metalness: 0.85, side: THREE.DoubleSide,
    });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 1.4, 36, 1, true), shell);
    barrel.position.set(HX, TOP - 0.7, 0);
    g.add(barrel);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 0.45, 1.4, 36, 1, true), shell);
    cone.position.set(HX, TOP - 2.1, 0);
    g.add(cone);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.02, 0.09, 8, 40), metal(C.steelDark));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(HX, TOP, 0);
    g.add(rim);
    // Only the surface of the paste is ever seen, so it is a disc sized to
    // the wall at whatever level it is standing at.
    this.hopperPaste = new THREE.Mesh(new THREE.CircleGeometry(1, 32), liquor(C.paste, 1));
    this.hopperPaste.rotation.x = -Math.PI / 2;
    g.add(this.hopperPaste);
    for (const sx of [-2.25, 2.25]) {
      const beam = box(0.3, 0.4, 2 * Mixer.Z, metal(C.steel, 0.65, 0.9));
      beam.position.set(HX + sx, Mixer.DECK - 0.3, 0);
      g.add(beam);
      for (const sz of [-1.2, 1.2]) {
        const lug = box(0.12, 0.6, 0.12, metal(C.steelDark));
        lug.position.set(HX + sx * 0.86, TOP + 0.05, sz);
        g.add(lug);
      }
    }
    // agitator: a bridge across the rim, the drive on it, a paddle in the paste
    const bridge = box(0.26, 0.2, 4.2, metal(C.steelDark));
    bridge.position.set(HX + 0.9, TOP + 0.12, 0);
    g.add(bridge);
    const drive = cyl(0.22, 0.22, 0.7, metal(0x3c4a5c, 0.45, 0.9), 14);
    drive.rotation.x = Math.PI / 2;
    drive.position.set(HX + 0.9, TOP + 0.3, 1.1);
    g.add(drive);
    const shaft = tube(0.08, 2.2, metal(C.steelLight), 8);
    shaft.position.y = -1.1;
    this.agitator.add(shaft);
    for (const s of [-1, 1]) {
      const blade = box(1.3, 0.08, 0.3, metal(C.steelLight));
      blade.position.set(s * 0.6, -1.9, 0);
      blade.rotation.x = s * 0.4;
      this.agitator.add(blade);
    }
    this.agitator.position.set(HX + 0.9, TOP, 0);
    g.add(this.agitator);

    // Y-piece off the cone to both pumps: the duty leg carries paste, the
    // standby leg is full and still.
    const legPts = (s: number) => [V(HX, TOP - 2.8, 0), V(HX, TOP - 3.1, 0),
      V(HX + 0.7, 3.15, s * 1.2), V(-1.4, 3.0, s * 1.8)];
    this.feedFlow = flowMaterial(C.paste, { density: bandsFor(3), intensity: 1.6 });
    g.add(pipeRun(legPts(-1), 0.28, this.feedFlow, { flanges: false }).group);
    g.add(pipeRun(legPts(1), 0.28, metal(0x55606f, 0.4, 0.9), { flanges: false }).group);

    // ---- the two pumps
    const matCyl = metal(0x55606f, 0.35, 0.95);
    const rodMat = metal(0xc3ccd8, 0.12, 1.0);
    const paint = metal(C.pumpPaint, 0.5, 0.4);
    const standbyLine = metal(0x55606f, 0.4, 0.9);
    this.outFlow = flowMaterial(C.paste, { density: bandsFor(14), intensity: 2.0 });
    for (const [zc, duty] of [[-1.8, true], [1.8, false]] as const) {
      const s = Math.sign(zc);
      const base = plinth(8.6, 0.35, 2.2);
      base.position.x = 1.9;
      base.position.z = zc;
      g.add(base);
      for (const dz of [-0.7, 0.7]) {
        const skid = box(7.8, 0.22, 0.2, metal(C.steelDark, 0.6, 0.9));
        skid.position.set(1.9, 0.46, zc + dz);
        g.add(skid);
      }
      for (const x of [0.2, 5.2]) {
        const saddle = box(0.3, 1.0, 1.7, metal(C.steelDark, 0.6, 0.9));
        saddle.position.set(x, 1.0, zc);
        g.add(saddle);
      }

      // the pump's own hopper housing, where the S-tube swings
      const housing = box(1.2, 2.2, 1.6, metal(C.steelDark, 0.55, 0.9));
      housing.position.set(-1.4, 1.95, zc);
      g.add(housing);

      for (const dz of [-0.42, 0.42]) {
        const mc = tube(0.33, 3.4, matCyl, 20);
        mc.rotation.z = Math.PI / 2;
        mc.position.set(0.9, 1.7, zc + dz);
        g.add(mc);
        for (const x of [-0.8, 2.6]) {
          const f = flange(0.33);
          f.rotation.z = Math.PI / 2;
          f.position.set(x, 1.7, zc + dz);
          g.add(f);
        }
        const hc = tube(0.27, 2.8, paint, 18);
        hc.rotation.z = Math.PI / 2;
        hc.position.set(4.8, 1.7, zc + dz);
        g.add(hc);
        const cap = cyl(0.32, 0.32, 0.2, paint, 18);
        cap.rotation.z = Math.PI / 2;
        cap.position.set(6.25, 1.7, zc + dz);
        g.add(cap);
        // the rods cross the open water box between the two
        const rod = tube(0.12, 1.2, rodMat, 12);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(3.0, 1.7, zc + dz);
        g.add(rod);
        if (duty) this.rams.push(rod);
      }
      const tray = box(0.8, 0.2, 1.5, metal(0x3a4450, 0.6, 0.85));
      tray.position.set(3.0, 1.15, zc);
      g.add(tray);
      for (const dx of [-0.38, 0.38]) {
        const post = box(0.08, 1.0, 1.5, metal(0x3a4450, 0.6, 0.85));
        post.position.set(3.0 + dx, 1.7, zc);
        g.add(post);
      }

      // The S-tube's shift lever on the back of the housing. It rocks with
      // every stroke on the duty pump and sits still on the standby.
      const lever = duty ? this.lever : new THREE.Group();
      const arm = box(0.14, 1.0, 0.1, paint);
      arm.position.y = -0.45;
      lever.add(arm);
      const hub = cyl(0.16, 0.16, 0.14, metal(C.steelLight), 12);
      hub.rotation.x = Math.PI / 2;
      lever.add(hub);
      lever.position.set(-2.06, 2.55, zc);
      lever.rotation.y = Math.PI / 2;
      g.add(lever);

      // Discharge off the back of the housing, round the outboard side at
      // knee height, through a knife-gate, and into the common spool.
      const out = [
        V(-2.0, 1.2, zc), V(-2.7, 1.2, zc), V(-2.7, 0.9, zc + s * 1.1),
        V(6.9, 0.9, zc + s * 1.1), V(7.5, 1.6, s * 1.2), V(7.9, 2.3, 0),
      ];
      g.add(pipeRun(out, 0.2, duty ? this.outFlow : standbyLine).group);
      const valve = box(0.22, 0.8, 0.7, metal(C.steelDark, 0.5, 0.9));
      valve.position.set(6.2, 1.1, zc + s * 1.1);
      g.add(valve);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 20),
        duty ? metal(C.handrail, 0.5, 0.35) : glow(C.red, 1.2));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(6.2, 1.62, zc + s * 1.1);
      g.add(wheel);
      const plate = strip(1.2, duty ? C.lime : C.amber, 0.07, 1.6);
      plate.position.set(1.0, 2.35, zc + s * 0.8);
      g.add(plate);
    }

    // common discharge spool to the paste line
    const spool = tube(0.38, PastePump.OUTLET_X - 7.9, this.outFlow, 18);
    spool.rotation.z = Math.PI / 2;
    spool.position.set((7.9 + PastePump.OUTLET_X) / 2, 2.3, 0);
    g.add(spool);
    const of1 = flange(0.38);
    of1.rotation.z = Math.PI / 2;
    of1.position.set(PastePump.OUTLET_X, 2.3, 0);
    g.add(of1);

    // ---- hydraulic power packs and their oil cooler, south of the pumps
    for (const x of [1.6, 4.4]) {
      const pad = plinth(2.6, 0.3, 1.9);
      pad.position.set(x, 0, 5.8);
      g.add(pad);
      const hpu = box(2.2, 1.5, 1.5, metal(C.steelDark, 0.55, 0.9));
      hpu.position.set(x, 1.05, 5.8);
      g.add(hpu);
      const tank = cyl(0.3, 0.3, 1.2, metal(C.steelLight, 0.45, 0.9), 14);
      tank.rotation.z = Math.PI / 2;
      tank.position.set(x, 2.05, 5.8);
      g.add(tank);
      const lamp = strip(2.0, C.cyan, 0.08, 1.8);
      lamp.position.set(x, 1.7, 5.04);
      g.add(lamp);
    }
    const coolerPad = plinth(1.6, 0.3, 2.8);
    coolerPad.position.set(7.4, 0, 5.8);
    g.add(coolerPad);
    const cooler = box(1.0, 2.4, 2.4, metal(C.cooler, 0.55, 0.5));
    cooler.position.set(7.4, 1.5, 5.8);
    g.add(cooler);
    for (let i = 0; i < 11; i++) {
      const fin = box(0.04, 2.1, 0.06, metal(0x24506f, 0.6, 0.5));
      fin.position.set(6.88, 1.5, 4.8 + i * 0.2);
      g.add(fin);
    }
    const shroud = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.06, 6, 28), metal(C.steelDark));
    shroud.rotation.y = Math.PI / 2;
    shroud.position.set(7.95, 1.5, 5.8);
    g.add(shroud);
    for (let i = 0; i < 5; i++) {
      const blade = box(0.04, 0.7, 0.18, metal(C.steelLight));
      blade.position.y = 0.35;
      const holder = new THREE.Group();
      holder.rotation.x = (i / 5) * Math.PI * 2;
      holder.add(blade);
      this.fan.add(holder);
    }
    this.fan.position.set(7.98, 1.5, 5.8);
    g.add(this.fan);

    // hoses from the power packs to both pumps' drive ends, pump A over the top
    const hose = matte(0x14181f, 0.7);
    for (const pts of [
      [V(1.6, 1.8, 5.0), V(2.6, 1.7, 3.8), V(3.9, 1.7, 2.7), V(4.3, 1.75, 2.35)],
      [V(4.4, 1.8, 5.0), V(4.9, 2.5, 3.0), V(5.0, 2.45, -0.6), V(5.4, 2.05, -1.4)],
    ]) g.add(pipeRun(pts, 0.07, hose, { flanges: false }).group);

    this.accum = cyl(0.26, 0.26, 1.5, metal(0x4a5666, 0.35, 0.95), 16);
    this.accum.position.set(5.6, 3.0, -3.0);
    g.add(this.accum);

    // ---- maintenance crane over the pumps, off the tower's east columns
    const X1 = Mixer.X1 - (Mixer.DISCHARGE_X - HX), X2 = 10.6, Z = Mixer.Z, RY = 9.8;
    const col = metal(C.steel, 0.65, 0.9);
    for (const z of [-Z, Z]) {
      const ext = box(0.36, RY - Mixer.DECK, 0.36, col);
      ext.position.set(X1, (RY + Mixer.DECK) / 2, z);
      g.add(ext);
      const leg = box(0.36, RY, 0.36, col);
      leg.position.set(X2, RY / 2, z);
      g.add(leg);
      const foot = plinth(0.9, 0.3, 0.9);
      foot.position.set(X2, 0, z);
      g.add(foot);
      const runway = box(X2 - X1 + 0.4, 0.5, 0.36, col);
      runway.position.set((X1 + X2) / 2, RY + 0.25, z);
      g.add(runway);
      g.add(member(V(X2, RY - 2.6, z), V(X2 - 2.6, RY, z), 0.18, col));
    }
    const craneMat = metal(0x7c4c1a, 0.9, 0.1);
    const girder = box(0.6, 0.7, 2 * Z + 0.8, craneMat);
    girder.position.set(6.4, RY + 0.85, 0);
    g.add(girder);
    for (const z of [-Z, Z]) {
      const truck = box(1.8, 0.4, 0.5, craneMat);
      truck.position.set(6.4, RY + 0.55, z);
      g.add(truck);
    }
    const trolley = box(1.1, 0.6, 1.0, metal(C.steelDark, 0.5, 0.9));
    trolley.position.set(6.4, RY + 0.2, 1.8);
    g.add(trolley);
    for (const dx of [-0.12, 0.12]) {
      const rope = tube(0.02, 2.4, metal(C.steelLight), 4);
      rope.position.set(6.4 + dx, RY - 1.1, 1.8);
      g.add(rope);
    }
    const block = box(0.4, 0.5, 0.3, craneMat);
    block.position.set(6.4, RY - 2.5, 1.8);
    g.add(block);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 14, Math.PI * 1.4), metal(C.steelLight));
    hook.position.set(6.4, RY - 2.9, 1.8);
    g.add(hook);

    // discharge pressure gauge, read as a bar
    this.gauge = new LevelBar(3.2, C.lime, 0.42);
    this.gauge.group.position.set(9.2, 0.4, 1.4);
    g.add(this.gauge.group);

    this.beacon.group.position.set(9.2, 0.3, -1.4);
    g.add(this.beacon.group);

    this.focus.set(2, 3, 0);
    this.mountTag(12.4);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const p = t.pump;
    const ph = p.strokePhase * Math.PI * 2;
    const active = p.flow > 0.5;
    const amp = active ? 0.35 : 0;

    this.rams.forEach((r, i) => { r.position.x = 3.0 + Math.sin(ph + i * Math.PI) * amp; });
    this.lever.rotation.z = Math.sin(ph) * (active ? 0.45 : 0);

    // The hopper holds a working level while the pump draws, runs low when
    // it is starved, and the agitator keeps turning either way - paste that
    // sits still in a hopper sets.
    const level = p.starved ? 0.12 : active ? 0.72 : 0.35;
    const TOP = PastePump.HOPPER_TOP, y = TOP - 2.7 + level * 2.4;
    const r = y >= TOP - 1.4 ? 1.95 : 0.45 + ((y - (TOP - 2.8)) / 1.4) * 1.55 - 0.05;
    this.hopperPaste.scale.set(r, r, 1);
    this.hopperPaste.position.set(PastePump.HOPPER_X, y, 0);
    this.agitator.rotation.y += dt * (active ? 2.4 : 0.8);
    this.fan.rotation.x += dt * (active ? 14 : 0);

    const pct = clamp01(p.pressurePct / 100);
    this.gauge.setLevel(pct, pct > 1 ? C.red : pct > 0.85 ? C.amber : C.lime);

    // accumulator breathes with the stroke
    this.accum.scale.y = 1 + Math.sin(ph * 2) * (active ? 0.04 : 0);

    setFlow(this.outFlow, active ? t.pipe.velocity : 0, 1, active ? 1 : 0);
    setFlow(this.feedFlow, active ? 0.8 : 0);

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
    this._w.set(this.group.position.x + 7.9, 2.3, this.group.position.z);
    this.leakSpout.run(dt, leak, this._w);

    // the whole skid shudders when the line is plugged
    this.home ??= this.group.position.clone();
    const shake = t.pipe.plugged ? 0.055 : leak > 0.3 ? 0.018 * leak : 0;
    this.group.position.x = this.home.x + (Math.random() - 0.5) * 2 * shake;
    this.group.position.y = this.home.y + (Math.random() - 0.5) * 2 * shake;

    this.beacon.set(
      t.pipe.plugged ? C.red : p.starved ? C.amber : active ? C.lime : C.cyan,
      t.pipe.plugged ? 6 : 2.4,
    );

    this.tag.set(
      (p.pressure / 100).toFixed(0) + ' bar',
      p.flow.toFixed(0) + ' m3/h  ' + p.strokesPerMin.toFixed(0) + ' spm  01A duty',
      t.pipe.plugged ? 'trip' : pct > 0.85 ? 'warn' : 'ok',
    );
  }
}
