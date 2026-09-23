import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { C, metal, matte, glass, glow, glowUnique, liquor } from './palette';
import {
  box, cyl, tube, flange, strip, platform, railing, ladder, bands, ribs,
  pipeRun, pipeSupport, LevelBar, Beacon,
} from './parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Unit } from './units';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Where each part of the upstream circuit sits, west of the backfill plant. */
export const UP = {
  millX: -128,
  floatX: -106,
  cycloneX: -88,
  cycloneZ: 12,
  floatZ: -13,
  deck: 9.0,
};

/**
 * The comminution, flotation and classification circuit.
 *
 * Only in play in hard mode, where the tailings are something you make rather
 * than something you are handed: the mill sets the grind, the flotation bank
 * sets how much sulphide is left in the tails, and the deslime cyclones decide
 * how much of the fines - and how much of the tonnage - ever reach the stope.
 */
export class UpstreamCircuit extends Unit {
  readonly id = 'upstream';
  readonly name = 'Grinding & Classification';

  private drum = new THREE.Group();
  private pinion = new THREE.Group();
  private impellers: THREE.Group[] = [];
  private frothMats: THREE.MeshStandardMaterial[] = [];
  private cyclones: THREE.Group[] = [];
  /** magnetic drums, on a site where the ore is the metal */
  private drums: THREE.Object3D[] = [];
  private drumMats: THREE.MeshStandardMaterial[] = [];
  private cycloneMats: THREE.MeshStandardMaterial[] = [];
  private frothSpouts: Spout[] = [];
  private frothAnchors: THREE.Object3D[] = [];
  private ufSpout?: Spout;
  private ofFlow!: FlowMaterial;
  private ufFlow!: FlowMaterial;
  private feedFlow!: FlowMaterial;
  private tailFlow!: FlowMaterial;
  private liftFlow!: FlowMaterial;
  private bypassFlow!: FlowMaterial;
  private beacon = new Beacon();
  private _w = new THREE.Vector3();

  /** @param opts.magnetic a magnetic drum separator where the flotation bank would be */
  constructor(fx: FX, opts: { magnetic?: boolean } = {}) {
    super(opts.magnetic ? 'MILL & DRUMS' : 'MILL & CYCLONES', 3.0, '#9fe870');
    const g = this.group;

    this.buildMill(g);
    if (opts.magnetic) this.buildMagnetic(g);
    else this.buildFlotation(g, fx);
    this.buildCyclones(g, fx);

    this.buildPipework(g);

    this.beacon.group.position.set(UP.cycloneX - 8, 0, UP.cycloneZ - 8);
    g.add(this.beacon.group);

    this.focus.set(UP.floatX + 2, 6, -2);
    this.viewOffset = new THREE.Vector3(-14, 34, 62);
    this.tag.group.position.set(UP.floatX + 2, 18, -2);
    g.add(this.tag.group);
  }

  // ------------------------------------------------------- interconnecting

  /** One routed run, returned so the tick can drive its flow bands. */
  private route(
    g: THREE.Group, colour: number, radius: number, pts: THREE.Vector3[], intensity = 1.4,
  ): FlowMaterial {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    const mat = flowMaterial(colour, { density: bandsFor(len), intensity });
    g.add(pipeRun(pts, radius, mat).group);
    return mat;
  }

  /** A slurry pump: volute, motor and baseplate. */
  private slurryPump(x: number, z: number, turn = 0): THREE.Group {
    const p = new THREE.Group();
    const base = box(2.6, 0.5, 1.8, matte(0x2c333d, 0.95));
    base.position.y = 0.25;
    p.add(base);
    const volute = cyl(0.78, 0.78, 0.7, metal(0x5c6675, 0.45, 0.9), 22);
    volute.rotation.x = Math.PI / 2;
    volute.position.set(-0.6, 1.05, 0);
    p.add(volute);
    const motor = cyl(0.42, 0.42, 1.5, metal(0x3c4a5c, 0.45, 0.9), 16);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(0.8, 1.05, 0);
    p.add(motor);
    const lamp = strip(1.1, C.lime, 0.07, 1.4);
    lamp.position.set(0.8, 1.55, 0);
    p.add(lamp);
    p.position.set(x, 0, z);
    p.rotation.y = turn;
    return p;
  }

  /**
   * The lines between the three sections.
   *
   * Every run starts and finishes on something real - the trommel discharge,
   * the head of the flotation bank, the cyclone feed riser, the underflow
   * launder - so the circuit reads as a circuit rather than as pipes lying
   * about near equipment.
   */
  private buildPipework(g: THREE.Group) {
    const CX = UP.cycloneX, CZ = UP.cycloneZ, D = UP.deck;

    // ---- mill discharge sump -> head of the flotation bank ---------------
    const sump = box(3.4, 2.0, 3.4, metal(0x39434f, 0.62, 0.85));
    sump.position.set(UP.millX + 7.7, 1.0, -6);
    g.add(sump);
    g.add(this.slurryPump(UP.millX + 10.4, -6.6, 0.25));

    this.feedFlow = this.route(g, 0x6d6152, 0.38, [
      V(UP.millX + 7.7, 3.1, -6),
      V(UP.millX + 8.6, 1.9, -6.2),
      V(UP.millX + 10.4, 1.7, -6.6),
      V(UP.millX + 10.6, 2.2, -8.8),
      V(UP.millX + 10.6, 5.0, -11.2),
      V(UP.millX + 11.0, 7.1, -12.7),
      V(UP.millX + 12.4, 7.2, -13.0),
      V(UP.millX + 13.6, 6.8, -13.0),
      V(UP.millX + 14.0, 5.9, -13.0),
    ], 1.2);
    const riserBrace = pipeSupport(6.9, 1.3);
    riserBrace.position.set(UP.millX + 10.6, 0, -11.2);
    g.add(riserBrace);

    // ---- flotation tails box -> cyclone feed pump -> the riser -----------
    const tailsBox = box(3.0, 2.4, 3.2, metal(0x39434f, 0.62, 0.85));
    tailsBox.position.set(UP.floatX + 12.4, 1.2, UP.floatZ);
    g.add(tailsBox);
    g.add(this.slurryPump(UP.floatX + 15.4, UP.floatZ + 1.6, -0.5));

    this.tailFlow = this.route(g, C.tails, 0.34, [
      V(UP.floatX + 12.4, 2.6, UP.floatZ),
      V(UP.floatX + 13.8, 1.8, UP.floatZ + 0.6),
      V(UP.floatX + 15.4, 1.6, UP.floatZ + 1.6),
      V(UP.floatX + 16.2, 1.5, UP.floatZ + 5.0),
      V(CX - 1.1, 1.5, -2.0),
      V(CX - 0.6, 1.4, 4.0),
      V(CX - 0.1, 1.2, 9.2),
      V(CX, 1.1, CZ - 0.6),
    ], 1.3);
    for (const z of [-6, 0, 6]) {
      const sup = pipeSupport(1.1, 1.0);
      sup.position.set(CX - 0.8 - (z < 0 ? 0.3 : 0), 0, z);
      g.add(sup);
    }

    // ---- cyclone overflow ring -> the tailings facility ------------------
    // Down the outside of the platform into the TSF transfer sump; the
    // facility itself is off site, which is the whole point of it.
    this.ofFlow = this.route(g, 0x5c6f84, 0.3, [
      V(CX, D + 5.0, CZ - 3.0),
      V(CX - 2.8, D + 4.3, CZ - 4.4),
      V(CX - 5.6, D + 1.2, CZ - 5.4),
      V(CX - 7.0, 5.0, CZ - 6.0),
      V(CX - 7.6, 2.6, CZ - 6.3),
      V(CX - 10.0, 1.8, CZ - 6.8),
      V(CX - 13.4, 1.6, CZ - 7.2),
    ], 1.5);
    const tsfSump = box(3.4, 2.6, 3.4, metal(0x39434f, 0.62, 0.85));
    tsfSump.position.set(CX - 15.4, 1.3, CZ - 7.4);
    g.add(tsfSump);
    const tsfTag = strip(3.0, C.cyan, 0.08, 1.2);
    tsfTag.position.set(CX - 15.4, 2.75, CZ - 9.1);
    g.add(tsfTag);
    g.add(this.slurryPump(CX - 18.6, CZ - 7.8, 0.1));
    this.route(g, 0x5c6f84, 0.28, [
      V(CX - 17.1, 1.5, CZ - 7.6),
      V(CX - 18.6, 1.5, CZ - 7.8),
      V(CX - 20.0, 1.7, CZ - 8.6),
      V(CX - 27.0, 1.6, CZ - 9.4),
    ], 1.5);
    for (const dx of [-23, -27]) {
      const sup = pipeSupport(1.3, 1.0);
      sup.position.set(CX + dx, 0, CZ - 9.0);
      g.add(sup);
    }

    // ---- cyclone underflow launder -> transfer pump ----------------------
    g.add(this.slurryPump(CX + 3.4, CZ - 5.4, -1.1));

    this.ufFlow = this.route(g, C.tails, 0.3, [
      V(CX, D - 1.3, CZ),
      V(CX + 0.8, D - 2.6, CZ - 0.8),
      V(CX + 1.6, 4.2, CZ - 2.0),
      V(CX + 2.4, 2.2, CZ - 3.6),
      V(CX + 3.4, 1.5, CZ - 5.4),
    ], 1.6);

    // ---- the deslime bypass spool ----------------------------------------
    // Both lines are always there; which one is carrying is what changes.
    this.bypassFlow = this.route(g, C.tails, 0.34, [
      V(CX - 0.2, 1.3, CZ - 4.6),
      V(CX + 0.9, 1.6, CZ - 5.0),
      V(CX + 2.0, 1.7, CZ - 5.2),
      V(CX + 3.0, 1.6, CZ - 5.4),
    ], 1.3);
    const valve = box(0.8, 0.8, 0.8, metal(0x6d7787, 0.35, 0.95));
    valve.position.set(CX + 1.45, 1.66, CZ - 5.1);
    g.add(valve);
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.06, 6, 20), metal(C.steelLight, 0.4, 0.9));
    wheel.position.set(CX + 1.45, 2.36, CZ - 5.1);
    wheel.rotation.x = Math.PI / 2;
    g.add(wheel);

    // ---- transfer pump -> the overland line to the backfill plant --------
    // This is the riser that hands over to the pipe bridge at x = -84.
    const tower = pipeSupport(15.0, 1.7);
    tower.position.set(-83.1, 0, 0);
    g.add(tower);

    this.liftFlow = this.route(g, C.tails, 0.4, [
      V(CX + 3.9, 1.5, CZ - 6.4),
      V(-84.2, 1.7, 4.6),
      V(-84.0, 3.2, 2.8),
      V(-84.0, 7.5, 1.2),
      V(-84.0, 12.6, 0.3),
      V(-84.0, 15.0, 0),
    ], 1.5);
  }

  // ------------------------------------------------------------- ball mill

  private buildMill(g: THREE.Group) {
    const x = UP.millX;
    const R = 3.1, L = 9;

    const plinth = box(16, 1.4, 11, matte(0x2c333d, 0.95));
    plinth.position.set(x, 0.7, -6);
    g.add(plinth);

    // the rotating shell, with lifter ribs and a girth gear
    const shell = cyl(R, R, L, metal(0x55606f, 0.5, 0.9), 40);
    shell.rotation.z = Math.PI / 2;
    this.drum.add(shell);
    for (const s of [-1, 1]) {
      // the frustum has to taper outward on both ends, not mirror through
      const head = s > 0
        ? cyl(R * 0.72, R, 1.1, metal(0x46505f, 0.5, 0.9), 32)
        : cyl(R, R * 0.72, 1.1, metal(0x46505f, 0.5, 0.9), 32);
      head.rotation.z = Math.PI / 2;
      head.position.x = (s * (L + 1.1)) / 2;
      this.drum.add(head);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rib = box(L - 0.4, 0.16, 0.34, metal(C.steelDark));
      rib.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
      rib.rotation.x = -a;
      this.drum.add(rib);
    }
    const girth = new THREE.Mesh(new THREE.TorusGeometry(R + 0.25, 0.3, 10, 52), metal(0x6d7787, 0.35, 0.95));
    girth.rotation.y = Math.PI / 2;
    girth.position.x = L / 2 - 1.2;
    this.drum.add(girth);
    const hot = new THREE.Mesh(new THREE.TorusGeometry(R + 0.02, 0.06, 6, 48), glow(C.lime, 1.2));
    hot.rotation.y = Math.PI / 2;
    this.drum.add(hot);

    this.drum.position.set(x, 5.2, -6);
    g.add(this.drum);

    // trunnion bearings, feed chute and discharge trommel
    for (const s of [-1, 1]) {
      const brg = box(2.4, 2.6, 3.0, metal(C.steelDark, 0.55, 0.9));
      brg.position.set(x + s * (L / 2 + 1.6), 3.9, -6);
      g.add(brg);
    }
    const chute = cyl(1.0, 1.3, 3.4, metal(C.steel), 20);
    chute.position.set(x - L / 2 - 3.4, 7.2, -6);
    chute.rotation.z = -0.45;
    g.add(chute);
    const trommel = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 3.2, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x4a5666, roughness: 0.6, metalness: 0.8, side: THREE.DoubleSide,
        wireframe: true,
      }),
    );
    trommel.rotation.z = Math.PI / 2;
    trommel.position.set(x + L / 2 + 3.2, 5.2, -6);
    this.drum.userData.trommel = trommel;
    g.add(trommel);

    // pinion drive and motor
    const pin = cyl(0.9, 0.9, 1.0, metal(0x7c8797, 0.3, 0.95), 24);
    pin.rotation.z = Math.PI / 2;
    this.pinion.add(pin);
    const key = box(1.1, 0.12, 1.86, glow(C.amber, 1.6));
    this.pinion.add(key);
    this.pinion.position.set(x + L / 2 - 1.2, 1.9, -6);
    g.add(this.pinion);

    const motor = cyl(1.3, 1.3, 3.6, metal(0x3c4a5c, 0.45, 0.9), 24);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(x + L / 2 - 1.2, 1.9, -10.5);
    g.add(motor);
    const motLamp = strip(3.2, C.lime, 0.1, 1.6);
    motLamp.position.set(x + L / 2 - 1.2, 3.3, -10.5);
    g.add(motLamp);

    const walk = platform(18, 4, { y: 8.6, accent: C.lime, openSides: ['n'] });
    walk.position.set(x, 0, -12.4);
    g.add(walk);
  }

  // -------------------------------------------------------- flotation bank

  /**
   * Psyche's separation: two wet drum separators, each a rotating shell over a
   * stationary magnet, in a tank. The metal rides the drum over the top and is
   * scraped off onto the concentrate belt; everything else - the silicate -
   * carries on down the tank as tailings.
   */
  private buildMagnetic(g: THREE.Group) {
    const z = UP.floatZ;
    const base = box(22, 1.0, 7, matte(0x2c333d, 0.95));
    base.position.set(UP.floatX + 1, 0.5, z);
    g.add(base);
    for (const dx of [-5, 5]) {
      const x = UP.floatX + dx;
      const tankGeo = new THREE.CylinderGeometry(2.6, 2.6, 7, 24, 1, true, 0, Math.PI);
      const tank = new THREE.Mesh(tankGeo, new THREE.MeshStandardMaterial({
        color: 0x46505f, roughness: 0.55, metalness: 0.85, side: THREE.DoubleSide,
      }));
      tank.rotation.z = Math.PI / 2;
      tank.rotation.y = Math.PI;
      tank.position.set(x, 2.8, z);
      g.add(tank);
      const drum = new THREE.Group();
      const shell = tube(1.9, 6.6, metal(0x9aa6b6, 0.25, 0.95), 28);
      shell.rotation.z = Math.PI / 2;
      drum.add(shell);
      for (let k = 0; k < 6; k++) {
        const mat = glowUnique(0x5aa8ff, 1.2);
        const band = box(6.6, 0.1, 0.3, mat);
        const a = (k / 6) * Math.PI * 2;
        band.position.set(0, Math.cos(a) * 1.92, Math.sin(a) * 1.92);
        band.rotation.x = a;
        drum.add(band);
        this.drumMats.push(mat);
      }
      drum.position.set(x, 3.6, z);
      g.add(drum);
      this.drums.push(drum);
      const scraper = box(6.6, 0.12, 1.4, metal(C.steelDark));
      scraper.position.set(x, 5.4, z + 1.9);
      scraper.rotation.x = -0.5;
      g.add(scraper);
    }
    // concentrate belt away to the smelter, with a lump of metal on it now and then
    const belt = box(22, 0.3, 1.6, metal(0x3a4450, 0.6, 0.8));
    belt.position.set(UP.floatX + 1, 4.8, z + 3.6);
    g.add(belt);
    const lamp = strip(21, 0x5aa8ff, 0.08, 1.6);
    lamp.position.set(UP.floatX + 1, 5.0, z + 4.45);
    g.add(lamp);
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.0, 3, 4), metal(0x6a7686, 0.5, 0.85));
    hopper.rotation.y = Math.PI / 4;
    hopper.position.set(UP.floatX + 13, 4.2, z + 3.6);
    g.add(hopper);
  }

  private buildFlotation(g: THREE.Group, fx: FX) {
    const x0 = UP.floatX - 8;
    const z = UP.floatZ;
    const R = 2.3, H = 4.6;

    const base = box(22, 1.0, 7, matte(0x2c333d, 0.95));
    base.position.set(UP.floatX + 1, 0.5, z);
    g.add(base);

    for (let i = 0; i < 5; i++) {
      const x = x0 + i * 4.4;
      // each cell steps down, so the pulp cascades along the bank
      const drop = i * 0.34;

      // open topped, so the froth layer on the pulp is something you can see
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, H, 28, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x46505f, roughness: 0.55, metalness: 0.88, side: THREE.DoubleSide,
        }),
      );
      tank.castShadow = tank.receiveShadow = true;
      tank.position.set(x, 1.0 + H / 2 - drop, z);
      g.add(tank);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(R + 0.04, 0.09, 8, 30), metal(C.steelDark));
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(x, 1.0 + H - drop, z);
      g.add(hoop);

      // pulp, and the froth sitting on top of it
      const pulp = cyl(R - 0.12, R - 0.12, H - 1.2, liquor(0x5d5a52, 1), 24);
      pulp.position.set(x, 1.0 + (H - 1.2) / 2 - drop, z);
      g.add(pulp);

      const frothMat = new THREE.MeshStandardMaterial({
        color: 0x9fa8b4, emissive: 0x7d8794, emissiveIntensity: 0.05,
        roughness: 0.95, metalness: 0,
      });
      this.frothMats.push(frothMat);
      const froth = cyl(R - 0.1, R - 0.1, 0.55, frothMat, 24);
      froth.position.set(x, 1.0 + H - 0.55 - drop, z);
      g.add(froth);

      // concentrate launder on the near side
      const launder = box(4.2, 0.5, 1.0, metal(C.steelDark, 0.6, 0.85));
      launder.position.set(x, 1.0 + H - 0.7 - drop, z + R + 0.7);
      g.add(launder);

      // drive
      const bridge = box(0.5, 0.4, R * 2.4, metal(C.steelLight));
      bridge.position.set(x, 1.0 + H + 0.3 - drop, z);
      g.add(bridge);
      const mot = cyl(0.42, 0.42, 1.2, metal(0x3c4a5c, 0.45, 0.9), 16);
      mot.position.set(x, 1.0 + H + 1.1 - drop, z);
      g.add(mot);

      const imp = new THREE.Group();
      const shaft = tube(0.11, H - 1.0, metal(C.steelLight), 10);
      imp.add(shaft);
      for (let b = 0; b < 6; b++) {
        const a = (b / 6) * Math.PI * 2;
        const blade = box(0.1, 0.42, 0.62, metal(0x6b7787, 0.5, 0.9));
        blade.position.set(Math.cos(a) * 0.55, -(H - 1.0) / 2 + 0.4, Math.sin(a) * 0.55);
        blade.rotation.y = -a;
        imp.add(blade);
      }
      imp.position.set(x, 1.0 + (H - 1.0) / 2 - drop, z);
      this.impellers.push(imp);
      g.add(imp);

      // froth spilling over the lip into the launder
      const anchor = new THREE.Object3D();
      anchor.position.set(x, 1.0 + H - 0.2 - drop, z + R - 0.1);
      g.add(anchor);
      this.frothAnchors.push(anchor);
      this.frothSpouts.push(new Spout(fx.haze, 16, (at) => ({
        at, count: 0,
        velocity: new THREE.Vector3(0, 0.25, 0.75),
        spread: new THREE.Vector3(0.6, 0.18, 0.25),
        jitter: new THREE.Vector3(R * 0.8, 0.08, 0.2),
        colour: 0xb9c2cd, size: 0.3, sizeVary: 0.5,
        life: 1.7, lifeVary: 0.4, gravity: -1.4, drag: 0.45, grow: 1.6,
        floor: 1.0 + H - 1.0 - drop,
      })));
    }

    const rail = railing(22, C.lime);
    rail.position.set(UP.floatX + 1, 1.0, z - 3.4);
    g.add(rail);
  }

  // ------------------------------------------------------ deslime cyclones

  private buildCyclones(g: THREE.Group, fx: FX) {
    const x = UP.cycloneX;
    const z = UP.cycloneZ;
    const D = UP.deck;

    const plat = platform(13, 13, { y: D, accent: C.lime, openSides: ['s'] });
    plat.position.set(x, 0, z);
    g.add(plat);

    // the distributor the cluster hangs off
    const dist = cyl(1.5, 1.5, 3.0, metal(0x55606f, 0.45, 0.9), 24);
    dist.position.set(x, D + 3.0, z);
    g.add(dist);
    const riser = tube(0.55, D + 1.5, metal(C.steel), 16);
    riser.position.set(x, (D + 1.5) / 2, z);
    g.add(riser);

    const N = 8;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rx = Math.cos(a) * 3.0;
      const rz = Math.sin(a) * 3.0;

      const cy = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x7a8494, roughness: 0.4, metalness: 0.85,
      });
      this.cycloneMats.push(mat);

      // barrel, long cone, vortex finder, spigot
      const barrel = cyl(0.42, 0.42, 0.9, mat, 20);
      barrel.position.y = 0.45;
      cy.add(barrel);
      const cone = cyl(0.42, 0.1, 2.8, mat, 20);
      cone.position.y = -1.4;
      cy.add(cone);
      const vf = tube(0.2, 1.0, metal(C.steelLight, 0.35, 0.95), 14);
      vf.position.y = 1.2;
      cy.add(vf);
      const inlet = box(0.5, 0.26, 0.26, metal(C.steelLight));
      inlet.position.set(-0.5, 0.7, 0);
      inlet.rotation.y = 0.5;
      cy.add(inlet);
      const spig = tube(0.12, 0.4, glow(C.tails, 1.0), 10);
      spig.position.y = -3.0;
      cy.add(spig);

      cy.position.set(x + rx, D + 3.2, z + rz);
      cy.rotation.z = -Math.cos(a) * 0.14;
      cy.rotation.x = Math.sin(a) * 0.14;
      this.cyclones.push(cy);
      g.add(cy);
    }

    // overflow ring header above, underflow launder below
    const header = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.3, 10, 40), metal(C.steelDark));
    header.rotation.x = Math.PI / 2;
    header.position.set(x, D + 5.0, z);
    g.add(header);

    const launder = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 2.0, 1.6, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: C.steelDark, roughness: 0.7, metalness: 0.8, side: THREE.DoubleSide,
      }),
    );
    launder.position.set(x, D - 0.4, z);
    g.add(launder);

    // underflow raining out of the spigots into the launder
    this.ufSpout = new Spout(fx.liquid, 30, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, -1.8, 0),
      spread: new THREE.Vector3(0.35, 0.3, 0.35),
      jitter: new THREE.Vector3(3.0, 0.1, 3.0),
      colour: C.tails, size: 0.14, sizeVary: 0.5,
      life: 1.1, gravity: -9.81, drag: 0.7,
      floor: D - 0.9,
    }));
    this.ufY = D + 0.1;

    const lad = ladder(D);
    lad.position.set(x + 6.2, 0, z - 4);
    g.add(lad);
  }

  private ufY = 0;

  // ------------------------------------------------------------------ tick

  update(t: Telemetry, dt: number, fx: FX) {
    const u = t.upstream;
    const live = u.hard && t.status !== 'idle';

    for (const d of this.drums) d.rotation.x += dt * (live ? 1.2 : 0);
    for (const m of this.drumMats) m.emissiveIntensity = live ? 1.6 : 0.4;

    // mill: the drum turns at a steady fraction of critical speed, and the
    // shell runs hotter (brighter) the harder you are grinding
    const spin = live ? 0.42 : 0;
    this.drum.rotation.x += dt * spin;
    this.pinion.rotation.x -= dt * spin * 3.4;

    // flotation: impellers turn, froth thickens with recovery
    const rec = clamp01(u.sulphideRecovery);
    for (let i = 0; i < this.impellers.length; i++) {
      this.impellers[i].rotation.y += dt * (live ? 5.5 : 0);
      const m = this.frothMats[i];
      m.emissiveIntensity = live ? 0.03 + rec * 0.07 : 0.02;
    }
    for (let i = 0; i < this.frothAnchors.length; i++) {
      this.frothAnchors[i].getWorldPosition(this._w);
      this.frothSpouts[i].run(dt, live ? 0.25 + rec * 0.75 : 0, this._w);
    }

    // cyclones: lit and running only when they are in circuit
    const on = u.hard && u.deslimeSplit < 0.999 && live;
    for (const m of this.cycloneMats) {
      m.emissive.setHex(on ? C.lime : 0x000000);
      m.emissiveIntensity = on ? 0.09 : 0;
    }
    this._w.set(UP.cycloneX, this.ufY, UP.cycloneZ);
    this.ufSpout?.run(dt, on ? 1 : 0, this._w);

    setFlow(this.feedFlow, live ? 2.0 : 0);
    setFlow(this.tailFlow, live ? 1.8 : 0);
    setFlow(this.ufFlow, on ? 1.6 : 0);
    setFlow(this.ofFlow, on ? 2.4 : 0);
    setFlow(this.bypassFlow, live && !on ? 1.8 : 0);
    setFlow(this.liftFlow, live ? 1.7 : 0);

    const short = u.solids < u.plantCapacity * 0.92;
    this.beacon.set(short ? C.amber : live ? C.lime : C.cyan, short ? 4 : 2.2);

    this.tag.set(
      u.p80.toFixed(0) + ' um',
      'P80  ' + (u.fines20 * 100).toFixed(0) + '% <20um  ' + u.solids.toFixed(0) + ' t/h',
      short ? 'warn' : 'ok',
    );
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }
}
