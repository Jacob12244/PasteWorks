/**
 * The machines that stand where the plate press would, in worlds that found
 * something better to do with the last of the water.
 *
 *   DeepPress       on the seabed - a pressure hull at one atmosphere with the
 *                   cloth in its wall. Open the sea valve and 440 bar of ocean
 *                   does the squeezing; pumps push the filtrate back out.
 *   MicrowaveDrier  on Psyche - a belt through a microwave tunnel open to the
 *                   vacuum. The water boils off and freezes onto a finned
 *                   cold trap, which frosts over if you ask too much of it.
 *   EOPress         under Meridian - a belt press with electrodes in it,
 *                   dragging the water through the cake to the cathode.
 *
 * Each is the unit with id 'press', so the consoles treat it as the second
 * dewatering stage. Each says where its feed lands and which way its filtrate
 * runs to the process water tank, so the site pipework finds them.
 */
import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { C, metal, matte, glowUnique } from './palette';
import { box, cyl, tube, platform, pipeRun, LevelBar, Beacon } from './parts';
import { flowMaterial, beltMaterial, setFlow, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Unit } from './units';

export interface Filterer extends Unit {
  /** where the feed from the surge tank lands, local */
  feedIn: THREE.Vector3;
  /** the filtrate's way to the process water tank, local; it ends where the tank takes it */
  filtrateRoute: THREE.Vector3[];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A small feed hopper on the deck, for a filter fed from above. */
function hopper(x: number, top: number, mat = metal(C.steel, 0.6, 0.85)) {
  const h = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.45, 1.5, 4), mat);
  h.rotation.y = Math.PI / 4;
  h.position.set(x, top - 0.75, 0);
  h.castShadow = true;
  return h;
}

/**
 * Lumps of cake riding a belt from one end to the other. Wet before the
 * machine, dry after it, and hidden wherever the machine has them.
 */
class BeltLoad {
  lumps: THREE.Mesh[] = [];
  constructor(
    parent: THREE.Object3D, private x0: number, private x1: number, private y: number,
    private wet: THREE.Material, private dry: THREE.Material,
    /** the stretch inside the machine, where you cannot see them */
    private hideFrom: number, private hideTo: number, n = 16,
  ) {
    for (let i = 0; i < n; i++) {
      const l = box(0.46, 0.2, 0.55, wet);
      l.position.set(x0 + ((x1 - x0) * i) / n, y, (Math.random() - 0.5) * 0.9);
      l.userData.noCollide = true;
      this.lumps.push(l);
      parent.add(l);
    }
  }

  update(dt: number, speed: number, on: boolean) {
    for (const l of this.lumps) {
      if (on) l.position.x += dt * speed;
      if (l.position.x > this.x1) l.position.x = this.x0;
      const x = l.position.x;
      l.visible = on && (x < this.hideFrom || x > this.hideTo);
      l.material = x > this.hideTo ? this.dry : this.wet;
    }
  }
}

// ========================================================= DEEP-SEA FILTER

/**
 * A plate pack sealed in a pressure hull at one atmosphere, 4,400 m down. The
 * sea valve on top lets the ocean in against the cloth, and the cloth is all
 * that stands between 440 bar and the inside of the hull - so the filtrate
 * has to be pumped back out against the same sea. At the end of each cycle
 * the end dome swings open and the cake drops out.
 *
 * Painted the yellow deep-sea kit is always painted, so the ROV pilots can
 * find it.
 */
export class DeepPress extends Unit implements Filterer {
  readonly id = 'press';
  readonly name = 'Deep-Sea Filter';
  feedIn = V(-4.4, 7.0, 0);
  filtrateRoute = [V(4.4, 2.4, 1.9), V(7.0, 4.6, 5.6), V(8.8, 8.4, 11), V(8.4, 7.6, 14.2)];

  private door = new THREE.Group();
  private wheel = new THREE.Group();
  private ports: THREE.MeshStandardMaterial;
  private grille: THREE.MeshStandardMaterial;
  private couplings: THREE.Group[] = [];
  private filtrate: FlowMaterial;
  private feed: FlowMaterial;
  private slabs: THREE.Mesh[] = [];
  private slabVel: number[] = [];
  private lastPhase = 0;
  private plume?: Spout;
  private bar: LevelBar;
  private beacon = new Beacon();
  private _w = new THREE.Vector3();

  private readonly Y = 4.4;
  private readonly RH = 2.2;
  private readonly L = 11;

  constructor() {
    super('DEEP-SEA FILTER', 3.0, '#3fc8f5');
    const g = this.group;
    const { Y, RH, L } = this;
    const hull = metal(0xcf9f2a, 0.5, 0.55);

    // saddles, and the hull on them
    for (const x of [-3.4, 3.4]) {
      const s = box(1.6, Y - 0.6, 3.8, matte(C.concrete, 0.95));
      s.position.set(x, (Y - 0.6) / 2, 0);
      g.add(s);
    }
    const body = cyl(RH, RH, L, hull, 36);
    body.rotation.z = Math.PI / 2;
    body.position.y = Y;
    g.add(body);
    const west = new THREE.Mesh(new THREE.SphereGeometry(RH, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), hull);
    west.rotation.z = Math.PI / 2;
    west.position.set(-L / 2, Y, 0);
    west.castShadow = true;
    g.add(west);

    // The east dome is the door. It hangs off a hinge on the north side and
    // swings open to let the cake out.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(RH, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), hull);
    dome.rotation.z = -Math.PI / 2;
    dome.position.set(0, 0, RH);
    dome.castShadow = true;
    this.door.add(dome);
    const doorRing = new THREE.Mesh(new THREE.TorusGeometry(RH + 0.05, 0.16, 8, 36), metal(C.steelDark));
    doorRing.rotation.y = Math.PI / 2;
    doorRing.position.set(0, 0, RH);
    this.door.add(doorRing);
    this.door.position.set(L / 2, Y, -RH);
    this.door.userData.noCollide = true;
    g.add(this.door);

    for (const x of [-3.9, -1.3, 1.3, 3.9, L / 2 - 0.1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(RH + 0.07, 0.15, 8, 40), metal(C.steelDark, 0.5, 0.9));
      ring.rotation.y = Math.PI / 2;
      ring.position.set(x, Y, 0);
      g.add(ring);
    }

    // viewports down the south side, lit while the sea is pressing
    this.ports = glowUnique(0x7fe8ff, 1.4);
    for (const x of [-2.6, 0, 2.6]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.1, 8, 20), metal(C.steelLight, 0.4, 0.9));
      rim.position.set(x, Y, RH - 0.02);
      g.add(rim);
      const pane = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), this.ports);
      pane.position.set(x, Y, RH + 0.01);
      g.add(pane);
    }

    // The sea valve, its handwheel, and the bell-mouth it takes the sea in by.
    const valve = cyl(0.55, 0.55, 1.3, metal(C.steelDark, 0.5, 0.9), 16);
    valve.position.set(-1.8, Y + RH + 0.55, 0);
    g.add(valve);
    const rimW = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 8, 28), metal(C.steelLight, 0.4, 0.9));
    rimW.rotation.x = Math.PI / 2;
    this.wheel.add(rimW);
    for (let k = 0; k < 4; k++) {
      const spoke = box(1.9, 0.08, 0.08, metal(C.steelLight));
      spoke.rotation.y = (k * Math.PI) / 4;
      this.wheel.add(spoke);
    }
    this.wheel.position.set(-1.8, Y + RH + 1.45, 0);
    this.wheel.userData.noCollide = true;
    g.add(this.wheel);
    const snorkel = tube(0.34, 2.6, metal(C.steelDark), 12);
    snorkel.position.set(-3.1, Y + RH + 1.3, 0);
    g.add(snorkel);
    const bell = cyl(0.95, 0.36, 0.9, metal(0xcf9f2a, 0.5, 0.55), 20, true);
    bell.position.set(-3.1, Y + RH + 3.0, 0);
    g.add(bell);
    this.grille = glowUnique(0x3fc8f5, 1.2);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 6, 24), this.grille);
    mouth.rotation.x = Math.PI / 2;
    mouth.position.set(-3.1, Y + RH + 3.45, 0);
    g.add(mouth);
    const elbow = tube(0.3, 1.3, metal(C.steelDark), 10);
    elbow.rotation.z = Math.PI / 2;
    elbow.position.set(-2.45, Y + RH + 0.5, 0);
    g.add(elbow);

    // feed in over the west end
    this.feed = flowMaterial(C.thickUf, { density: bandsFor(3), intensity: 1.0 });
    const feedDrop = tube(0.26, this.feedIn.y - (Y + RH - 0.2), this.feed, 12);
    feedDrop.position.set(this.feedIn.x, (this.feedIn.y + Y + RH - 0.2) / 2, 0);
    g.add(feedDrop);

    // Two pumps on the north side, pushing the filtrate back out against the
    // sea, up a stack to where it leaves.
    for (const x of [-1.4, 1.4]) {
      const skid = box(2.6, 0.3, 1.4, metal(C.steelDark));
      skid.position.set(x, 0.15, -3.9);
      g.add(skid);
      const casing = cyl(0.55, 0.55, 1.4, metal(0x2f5f86, 0.45, 0.8), 18);
      casing.rotation.z = Math.PI / 2;
      casing.position.set(x - 0.5, 0.9, -3.9);
      g.add(casing);
      const motor = cyl(0.45, 0.45, 1.1, metal(0x3c4a5c, 0.45, 0.9), 16);
      motor.rotation.z = Math.PI / 2;
      motor.position.set(x + 0.8, 0.85, -3.9);
      g.add(motor);
      const coupling = new THREE.Group();
      const hubC = cyl(0.25, 0.25, 0.3, metal(C.steelLight), 12);
      hubC.rotation.z = Math.PI / 2;
      coupling.add(hubC);
      const key = box(0.32, 0.48, 0.08, glowUnique(C.amber, 1.4));
      coupling.add(key);
      coupling.position.set(x + 0.1, 0.9, -3.9);
      coupling.userData.noCollide = true;
      this.couplings.push(coupling);
      g.add(coupling);
    }
    const header = pipeRun([V(-1.9, 1.5, -3.9), V(-1.9, 1.9, -4.8), V(1.0, 1.9, -4.8), V(3.2, 1.9, -4.8),
      V(3.6, 4.0, -4.8), V(3.6, 9.6, -4.8)], 0.26, metal(C.steelDark));
    g.add(header.group);
    const stackCap = cyl(0.5, 0.3, 0.6, metal(0xcf9f2a, 0.5, 0.55), 14, true);
    stackCap.position.set(3.6, 9.9, -4.8);
    g.add(stackCap);

    // filtrate line out of the belly, to the seawater return
    this.filtrate = flowMaterial(C.water, { density: bandsFor(4), intensity: 1.0 });
    // the hull's skin is at y = 3.3 this far round from the bottom
    const belly = tube(0.22, 1.0, this.filtrate, 10);
    belly.position.set(4.4, 2.8, 1.9);
    g.add(belly);

    // the chute the cake drops down when the door opens
    const chute = box(4.6, 0.16, 3.2, metal(C.steelDark));
    chute.position.set(L / 2 + 2.8, 2.2, 0);
    chute.rotation.z = -0.35;
    g.add(chute);
    const cakeMat = matte(C.cake, 0.95);
    for (let i = 0; i < 10; i++) {
      const s = box(0.6, 0.18, 1.3, cakeMat);
      s.visible = false;
      s.userData.noCollide = true;
      this.slabs.push(s);
      this.slabVel.push(0);
      g.add(s);
    }

    // the pressure across the cloth, as a bar: green, amber past where fines come through
    this.bar = new LevelBar(3.0, C.lime, 0.4);
    this.bar.group.position.set(-L / 2 - 1.8, 0, 2.4);
    g.add(this.bar.group);
    this.beacon.group.position.set(-L / 2 - 1.8, 0, -2.4);
    g.add(this.beacon.group);

    this.focus.set(0, Y, 0);
    this.viewOffset = new THREE.Vector3(-8, 10, 22);
    this.mountTag(Y + RH + 5.4);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const f = t.filter;
    const on = f.throughput > 0.5;
    const phase = f.cyclePhase;
    const pressing = phase < 0.78;
    const sea = clamp01(f.dp / 440);

    // open the door through the discharge, and drop the cake as it opens
    const open = pressing ? 0 : Math.sin(((phase - 0.78) / 0.22) * Math.PI);
    this.door.rotation.y = open * 1.45;
    if (!pressing && this.lastPhase < 0.78 && on) this.dropSlabs();
    this.lastPhase = phase;
    for (let i = 0; i < this.slabs.length; i++) {
      const s = this.slabs[i];
      if (!s.visible) continue;
      this.slabVel[i] -= 4 * dt;            // it is falling through water
      s.position.y += this.slabVel[i] * dt;
      s.position.x += dt * 1.2;
      s.rotation.z += dt * 0.8;
      if (s.position.y < 0.3) s.visible = false;
    }

    this.ports.emissiveIntensity = on && pressing ? 0.8 + 2.4 * sea : 0.25;
    this.grille.emissiveIntensity = on && pressing ? 0.6 + 2 * sea : 0.2;
    this.wheel.rotation.y += dt * (on && pressing ? 0.5 : 0);
    for (const c of this.couplings) c.rotation.x += dt * (on ? 3 + f.power / 200 : 0);
    setFlow(this.feed, on ? 1.4 : 0);
    setFlow(this.filtrate, on && pressing ? 1.8 : 0);

    // What leaves the stack: seawater, and, pushed hard enough, sediment.
    const bleed = clamp01(f.bleed / 2);
    this.plume ??= new Spout(fx.haze, 8, (at) => ({
      at, count: 0,
      velocity: V(0, 1.1, 0), spread: V(0.4, 0.3, 0.4), jitter: V(0.3, 0.2, 0.3),
      colour: 0x9a8a6a, size: 0.9, sizeVary: 0.5, life: 3.5, gravity: 0.05, drag: 0.6, grow: 3,
    }));
    this._w.set(3.6, 10.2, -4.8).applyMatrix4(this.group.matrixWorld);
    this.plume.run(dt, on ? bleed : 0, this._w);

    const hard = f.bleed > 0.8, over = f.dp > 300;
    this.bar.setLevel(sea, over ? C.red : hard ? C.amber : C.lime);
    this.beacon.set(!on ? C.cyan : hard ? C.amber : C.lime, 2.2);
    this.tag.set(
      f.dp.toFixed(0) + ' bar',
      'cake ' + f.cakeMoisture.toFixed(1) + '% H2O  ·  fines ' + f.bleed.toFixed(2) + ' t/h',
      hard ? 'warn' : 'ok',
    );
  }

  private dropSlabs() {
    let n = 0;
    for (let i = 0; i < this.slabs.length && n < 7; i++) {
      const s = this.slabs[i];
      if (s.visible) continue;
      s.position.set(this.L / 2 + 0.4 + Math.random() * 1.2, this.Y - 0.6, (Math.random() - 0.5) * 2);
      s.rotation.set(0, Math.random() * 3, 0);
      s.visible = true;
      this.slabVel[i] = -0.2;
      n++;
    }
  }
}

// ========================================================= MICROWAVE DRIER

/**
 * A belt through a microwave tunnel, open to the vacuum. The magnetrons ride
 * on the roof, the slots down the sides glow with the power going in, and the
 * vapour goes up a duct to a finned cold trap standing in the shadow of the
 * plant. The fins frost white as the trap loads up; past its rating the
 * vapour gets by, and you can see it leave.
 */
export class MicrowaveDrier extends Unit implements Filterer {
  readonly id = 'press';
  readonly name = 'Microwave Drier';
  feedIn = V(-5.2, 8.3, 0);
  filtrateRoute = [V(4.9, 1.2, 6.4), V(6.8, 4.4, 8.8), V(8.8, 8.4, 11), V(8.4, 7.6, 14.2)];

  private slots: THREE.MeshStandardMaterial;
  private curtains: THREE.MeshStandardMaterial;
  private lampsMat: THREE.MeshStandardMaterial;
  private frost: THREE.MeshStandardMaterial;
  private belt: FlowMaterial;
  private vapour: FlowMaterial;
  private melt: FlowMaterial;
  private pulleys: THREE.Mesh[] = [];
  private load: BeltLoad;
  private escape?: Spout;
  private bar: LevelBar;
  private beacon = new Beacon();
  private _w = new THREE.Vector3();
  private readonly D = 5.0;

  constructor() {
    super('MICROWAVE DRIER', 3.0, '#ffab3d');
    const g = this.group;
    const D = this.D;
    g.add(platform(17, 8.4, { y: D, accent: C.amber }));

    // the belt, end to end, and the load on it
    const BY = D + 0.7;
    this.belt = beltMaterial(C.cake);
    const belt = box(14.6, 0.1, 1.9, this.belt);
    belt.position.set(0, BY, 0);
    g.add(belt);
    for (const x of [-7.3, 7.3]) {
      const p = tube(0.42, 2.1, metal(0x5a6779, 0.4, 0.95), 16);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, BY - 0.35, 0);
      g.add(p);
      this.pulleys.push(p);
    }
    const frame = box(15, 0.3, 2.3, metal(C.steelDark));
    frame.position.set(0, BY - 0.35, 0);
    g.add(frame);
    this.load = new BeltLoad(g, -7.2, 7.3, BY + 0.15,
      matte(C.thickUf, 0.9), matte(0xb09a78, 0.95), -4.4, 5.0, 18);

    // The tunnel. Dark steel with lit slots down both sides, and a choke at
    // each end where the belt goes through.
    const tunnel = box(9.2, 2.1, 2.8, metal(0x3a3f4a, 0.5, 0.8));
    tunnel.position.set(0.3, D + 1.15, 0);
    g.add(tunnel);
    this.slots = glowUnique(0xff6fb0, 1.4);
    for (const z of [-1.42, 1.42]) {
      for (let i = 0; i < 4; i++) {
        const s = box(1.5, 0.5, 0.06, this.slots);
        s.position.set(-3.1 + i * 2.1, D + 1.2, z);
        g.add(s);
      }
    }
    this.curtains = glowUnique(0xff5fa2, 1.2);
    for (const x of [-4.35, 4.95]) {
      const c = box(0.22, 2.2, 2.9, this.curtains);
      c.position.set(x, D + 1.15, 0);
      g.add(c);
    }

    // magnetrons on the roof: a box, a waveguide into the tunnel, and fins
    this.lampsMat = glowUnique(0xff5fa2, 2);
    for (let i = 0; i < 5; i++) {
      const x = -3.3 + i * 1.8;
      const mag = box(1.1, 0.8, 1.5, metal(0x5b6170, 0.45, 0.85));
      mag.position.set(x, D + 2.65, -0.3);
      g.add(mag);
      const guide = box(0.4, 0.5, 0.5, metal(C.steelLight));
      guide.position.set(x, D + 2.35, 0.65);
      g.add(guide);
      for (const dz of [-0.9, -0.6]) {
        const fin = box(1.0, 0.7, 0.05, metal(C.steelLight));
        fin.position.set(x, D + 2.65, dz - 0.3);
        g.add(fin);
      }
      const lamp = box(0.5, 0.08, 0.08, this.lampsMat);
      lamp.position.set(x, D + 3.08, 0.46);
      g.add(lamp);
    }
    g.add(hopper(this.feedIn.x, this.feedIn.y));

    // Vapour up a duct and round to the cold trap on the south side.
    this.vapour = flowMaterial(0xdfefff, { density: bandsFor(9), intensity: 0.9 });
    g.add(pipeRun([V(1.4, D + 2.2, 1.0), V(1.4, D + 3.8, 1.0), V(2.6, D + 4.2, 3.6),
      V(3.2, D + 4.1, 6.4), V(3.2, 9.6, 6.4)], 0.42, this.vapour).group);

    // The cold trap: a column with a skirt of fins that frost over.
    const TX = 3.2, TZ = 6.4;
    const pad = box(3.4, 0.4, 3.4, matte(C.concrete, 0.95));
    pad.position.set(TX, 0.2, TZ);
    g.add(pad);
    const col = cyl(0.8, 0.8, 8.6, metal(C.steelDark, 0.5, 0.85), 18);
    col.position.set(TX, 4.7, TZ);
    g.add(col);
    this.frost = new THREE.MeshStandardMaterial({
      color: 0x2b313a, roughness: 0.55, metalness: 0.6, emissive: 0x9fdcff, emissiveIntensity: 0,
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const fin = box(0.08, 7.6, 1.3, this.frost);
      fin.position.set(TX + Math.cos(a) * 1.35, 4.8, TZ + Math.sin(a) * 1.35);
      fin.rotation.y = -a;
      g.add(fin);
    }
    const cap = cyl(1.5, 1.2, 0.6, metal(C.steelDark), 20);
    cap.position.set(TX, 9.3, TZ);
    g.add(cap);
    const tank = cyl(0.75, 0.75, 1.2, metal(C.steel, 0.55, 0.85), 16);
    tank.position.set(TX + 1.6, 0.6, TZ);
    g.add(tank);
    this.melt = flowMaterial(C.water, { density: bandsFor(2), intensity: 1.0 });
    const meltPipe = tube(0.16, 1.0, this.melt, 8);
    meltPipe.position.set(TX + 0.9, 0.7, TZ);
    meltPipe.rotation.z = Math.PI / 2;
    g.add(meltPipe);

    // cake off the head end, down a chute toward the bin
    const chute = box(3.0, 0.14, 2.2, metal(C.steelDark));
    chute.position.set(8.8, D - 0.2, 0);
    chute.rotation.z = -0.5;
    g.add(chute);

    // how loaded the trap is
    this.bar = new LevelBar(3.0, C.lime, 0.4);
    this.bar.group.position.set(TX - 2.2, 0.4, TZ + 0.6);
    g.add(this.bar.group);
    this.beacon.group.position.set(-7.6, D + 0.1, 3.6);
    g.add(this.beacon.group);

    this.focus.set(0, D + 1.5, 1.5);
    this.viewOffset = new THREE.Vector3(-6, 12, 24);
    this.mountTag(D + 6.4);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const f = t.filter;
    const on = f.throughput > 0.5;
    const drive = clamp01(f.power / 8000);
    const load = f.evap / DESIGN.trapCap;
    const slip = f.evap > 0.5 ? f.trapLoss / f.evap : 0;

    this.slots.emissiveIntensity = on ? 0.3 + 1.3 * drive + Math.sin(t.time * 13) * 0.06 : 0.12;
    this.curtains.emissiveIntensity = on ? 0.3 + 0.8 * drive : 0.15;
    this.lampsMat.emissiveIntensity = on ? 1.6 : 0.3;

    const speed = (f.belt / 100) * 1.6;
    setFlow(this.belt, on ? 0.4 + speed : 0);
    for (const p of this.pulleys) p.rotation.y -= dt * (on ? speed * 2.4 : 0);
    this.load.update(dt, speed, on);
    setFlow(this.vapour, on ? 1 + 2 * clamp01(load) : 0);
    setFlow(this.melt, on ? 1.2 : 0);

    // The fins frost white as the trap loads toward its rating.
    const ice = clamp01((load - 0.35) / 0.9);
    this.frost.color.lerpColors(new THREE.Color(0x2b313a), new THREE.Color(0xdcecff), ice);
    this.frost.emissiveIntensity = ice * ice * 0.3;

    // and what gets past it leaves as a plume off the top, into the dark
    this.escape ??= new Spout(fx.haze, 12, (at) => ({
      at, count: 0,
      velocity: V(0, 1.6, 0), spread: V(0.8, 0.4, 0.8), jitter: V(0.8, 0.2, 0.8),
      colour: 0xdff0ff, size: 1.1, sizeVary: 0.5, life: 3, gravity: 0, drag: 0.8, grow: 3.5,
    }));
    this._w.set(3.2, 9.8, 6.4).applyMatrix4(this.group.matrixWorld);
    this.escape.run(dt, on ? clamp01(f.trapLoss / 5) : 0, this._w);

    const warn = slip > 0.08;
    this.bar.setLevel(clamp01(load / 1.6), slip > 0.2 ? C.red : warn ? C.amber : C.lime);
    this.beacon.set(!on ? C.cyan : warn ? C.amber : C.lime, 2.2);
    this.tag.set(
      f.cakeMoisture.toFixed(1) + '%',
      'cake H2O  ·  ' + (f.power / 1000).toFixed(1) + ' MW  ·  '
        + f.trapLoss.toFixed(1) + ' t/h to space',
      warn ? 'warn' : 'ok',
    );
  }
}

// ======================================================= ELECTRO-OSMOTIC PRESS

/**
 * A belt press with electrodes in it. The cake is carried in an S-wrap round
 * a train of rollers, between anode plates above and cathode plates below;
 * the field drags the pore water through to the cathode side, where it
 * drains off into the tray. The plates glow with the voltage, and at the top
 * of the range the odd arc jumps the gap.
 */
export class EOPress extends Unit implements Filterer {
  readonly id = 'press';
  readonly name = 'Electro-Osmotic Press';
  feedIn = V(-5.0, 8.4, 0);
  filtrateRoute = [V(5.2, 5.1, 1.7), V(7.2, 7.4, 6), V(8.8, 8.4, 11), V(8.4, 7.6, 14.2)];

  private anode: THREE.MeshStandardMaterial;
  private cathode: THREE.MeshStandardMaterial;
  private rollers: THREE.Mesh[] = [];
  private belt: FlowMaterial;
  private filtrate: FlowMaterial;
  private cabinet: THREE.MeshStandardMaterial;
  private sparks?: Spout;
  private drips?: Spout;
  private volts: LevelBar;
  private beacon = new Beacon();
  private _w = new THREE.Vector3();
  private readonly D = 5.0;
  /** electrode centres, local, where an arc can strike */
  private gaps: THREE.Vector3[] = [];

  constructor() {
    super('E-PRESS', 3.0, '#ff4fd8');
    const g = this.group;
    const D = this.D;
    g.add(platform(16, 8, { y: D, accent: 0xff4fd8 }));

    // an open frame, so the wrap and the plates can be seen from the walkway
    const frameMat = metal(0x3d3a4a, 0.5, 0.85);
    for (const z of [-1.45, 1.45]) {
      for (const y of [D + 0.45, D + 2.85]) {
        const rail = box(12.6, 0.28, 0.22, frameMat);
        rail.position.set(0.3, y, z);
        g.add(rail);
      }
      for (const x of [-5.9, -1.2, 3.5, 6.5]) {
        const post = box(0.26, 2.7, 0.22, frameMat);
        post.position.set(x, D + 1.6, z);
        g.add(post);
      }
    }

    // The roller train: an S-wrap, low then high then low, and the belt
    // sandwich running between them.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) pts.push([-5.4 + i * 1.2, i % 2 ? D + 2.1 : D + 1.1]);
    for (const [x, y] of pts) {
      const r = tube(0.34, 2.6, metal(0x6a7488, 0.35, 0.95), 16);
      r.rotation.x = Math.PI / 2;
      r.position.set(x, y, 0);
      r.userData.noCollide = true;
      this.rollers.push(r);
      g.add(r);
    }
    this.belt = beltMaterial(C.cake);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const seg = box(len, 0.1, 2.2, this.belt);
      seg.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      seg.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      g.add(seg);
    }

    // electrodes: anodes over the low rollers, cathodes under the high ones
    this.anode = glowUnique(0xc070ff, 1.2);
    this.cathode = glowUnique(0x35e0d0, 1.2);
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const low = i % 2 === 0;
      const plate = box(0.9, 0.12, 2.3, low ? this.anode : this.cathode);
      plate.position.set(x, low ? y + 0.72 : y - 0.72, 0);
      g.add(plate);
      this.gaps.push(new THREE.Vector3(x, low ? y + 0.45 : y - 0.45, 0));
    }

    // the rectifier, and the busbars from it
    const cab = box(1.6, 2.4, 1.2, metal(0x2c2440, 0.5, 0.7));
    cab.position.set(-6.9, D + 1.3, -3.0);
    g.add(cab);
    this.cabinet = glowUnique(0xff4fd8, 1.4);
    for (let i = 0; i < 3; i++) {
      const s = box(0.08, 1.6, 0.06, this.cabinet);
      s.position.set(-7.3 + i * 0.4, D + 1.4, -2.37);
      g.add(s);
    }
    g.add(pipeRun([V(-6.4, D + 2.5, -2.6), V(-5.8, D + 3.4, -2.0), V(-4, D + 3.4, -1.6),
      V(4.6, D + 3.4, -1.6)], 0.1, this.cabinet, { flanges: false }).group);
    this.volts = new LevelBar(2.0, 0xc070ff, 0.3);
    this.volts.group.position.set(-6.1, D + 0.2, -2.38);
    g.add(this.volts.group);

    // the tray under it all, and the filtrate out of it
    const tray = box(12.2, 0.24, 2.9, metal(C.steelDark));
    tray.position.set(0.3, D + 0.3, 0);
    g.add(tray);
    this.filtrate = flowMaterial(C.water, { density: bandsFor(3), intensity: 1.0 });
    const drain = tube(0.2, 0.5, this.filtrate, 10);
    drain.position.set(5.2, D + 0.15, 1.7);
    g.add(drain);

    g.add(hopper(this.feedIn.x, this.feedIn.y));
    const chute = box(3.0, 0.14, 2.2, metal(C.steelDark));
    chute.position.set(8.2, D - 0.2, 0);
    chute.rotation.z = -0.5;
    g.add(chute);

    this.beacon.group.position.set(7.4, D + 0.1, -3.4);
    g.add(this.beacon.group);
    this.focus.set(0, D + 1.5, 0);
    this.viewOffset = new THREE.Vector3(-6, 11, 22);
    this.mountTag(D + 5.4);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const f = t.filter;
    const on = f.throughput > 0.5;
    const v = clamp01(f.volts / 80);

    this.anode.emissiveIntensity = on ? 0.25 + 1.3 * v + Math.sin(t.time * 17) * 0.06 * v : 0.12;
    this.cathode.emissiveIntensity = on ? 0.25 + 1.0 * v : 0.12;
    this.cabinet.emissiveIntensity = on ? 0.6 + 1.6 * v : 0.25;
    this.volts.setLevel(v, v > 0.85 ? C.amber : 0xc070ff);

    const speed = (f.belt / 100) * 1.4;
    setFlow(this.belt, on ? 0.3 + speed : 0);
    for (let i = 0; i < this.rollers.length; i++) {
      this.rollers[i].rotation.y += dt * (on ? speed * 3 : 0) * (i % 2 ? -1 : 1);
    }
    setFlow(this.filtrate, on ? 1.6 : 0);

    // an arc across a gap now and then, more of them the harder it is pushed
    this.sparks ??= new Spout(fx.spray, 30, (at) => ({
      at, count: 0,
      velocity: V(0, 0, 0), spread: V(2.2, 2.2, 2.2), jitter: V(0.3, 0.05, 0.9),
      colour: 0xd8b0ff, size: 0.16, sizeVary: 0.5, life: 0.25, gravity: 0, drag: 0.3,
    }));
    const gap = this.gaps[Math.floor(Math.random() * this.gaps.length)];
    this._w.copy(gap).applyMatrix4(this.group.matrixWorld);
    this.sparks.run(dt, on ? clamp01((f.volts - 50) / 30) : 0, this._w);

    // and the water it drags out, dripping into the tray
    this.drips ??= new Spout(fx.liquid, 16, (at) => ({
      at, count: 0,
      velocity: V(0, -0.3, 0), spread: V(0.1, 0.1, 0.1), jitter: V(5.5, 0.05, 0.9),
      colour: C.water, size: 0.1, sizeVary: 0.4, life: 0.8, gravity: -9.81, drag: 0.9,
      floor: this.group.position.y + this.D + 0.45,
    }));
    this._w.set(0.3, this.D + 1.0, 0).applyMatrix4(this.group.matrixWorld);
    this.drips.run(dt, on ? 0.3 + 0.7 * v : 0, this._w);

    const hot = f.volts > 70;
    this.beacon.set(!on ? C.cyan : hot ? C.amber : C.lime, 2.2);
    this.tag.set(
      f.cakeMoisture.toFixed(1) + '%',
      'cake H2O  ·  ' + f.volts.toFixed(0) + ' V  ·  ' + (f.power / 1000).toFixed(2) + ' MW',
      hot ? 'warn' : 'ok',
    );
  }
}
