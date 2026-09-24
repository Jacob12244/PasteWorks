import * as THREE from 'three';
import { C, metal, matte, glowUnique } from '../view/palette';
import { box, cyl, Tag } from '../view/parts';
import { beltMaterial, setFlow, type FlowMaterial } from '../view/flow';
import { BallMill, ConeCrusher, CycloneCluster, Grizzly, JawCrusher, ScreenBank, type Machine } from './models';

/**
 * The site: one long line from the tip to the cyclones, west to east, with the
 * conveyors that join the stations. The machines on it are the sizing game's;
 * everything else (stockpile, bin, belts) is fixed.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export type StationId = 'primary' | 'secondary' | 'tertiary' | 'mill' | 'cyclones';
export type Status = 'idle' | 'fail' | 'pass';

export interface StationView {
  /** where the camera looks, and from how far */
  target: THREE.Vector3;
  offset: THREE.Vector3;
  ring: THREE.Mesh;
  ringMat: THREE.MeshStandardMaterial;
  tag: Tag;
  machines: Machine[];
}

const STATUS_COLOUR: Record<Status, number> = { idle: 0x55606e, fail: C.red, pass: C.lime };

/** A belt conveyor from a to b on trestles, carrying ore when running. */
class Conveyor {
  group = new THREE.Group();
  mat: FlowMaterial;
  constructor(a: THREE.Vector3, b: THREE.Vector3, width = 1.2) {
    const d = b.clone().sub(a);
    const len = d.length();
    this.mat = beltMaterial(0x9a8266);
    const run = new THREE.Group();
    const belt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, width), this.mat);
    belt.castShadow = belt.receiveShadow = true;
    run.add(belt);
    for (const s of [-1, 1]) {
      const stringer = box(len, 0.3, 0.12, metal(C.steel));
      stringer.position.set(0, -0.12, s * (width / 2 + 0.12));
      run.add(stringer);
      const hood = box(len, 0.05, 0.05, metal(C.handrail, 0.6, 0.3));
      hood.position.set(0, 0.9, s * (width / 2 + 0.7));
      run.add(hood);
    }
    const walk = box(len, 0.08, 0.8, metal(C.steelDark));
    walk.position.set(0, -0.2, width / 2 + 0.7);
    run.add(walk);
    run.position.copy(a.clone().add(b).multiplyScalar(0.5));
    const flat = Math.hypot(d.x, d.z);
    run.rotation.order = 'YZX';
    run.rotation.y = -Math.atan2(d.z, d.x);
    run.rotation.z = Math.atan2(d.y, flat);
    this.group.add(run);
    // trestles every ten metres or so
    const n = Math.max(1, Math.floor(len / 10));
    for (let i = 1; i <= n; i++) {
      const p = a.clone().lerp(b, i / (n + 1));
      if (p.y < 1.2) continue;
      const leg = box(0.3, p.y - 0.2, 0.3, metal(C.steel));
      leg.position.set(p.x, (p.y - 0.2) / 2, p.z);
      this.group.add(leg);
    }
  }
  run(on: boolean) {
    setFlow(this.mat, on ? 2.2 : 0);
  }
}

export class Site {
  root = new THREE.Group();
  grizzly = new Grizzly();
  jaw = new JawCrusher();
  secondary = new ConeCrusher();
  tertiary = new ConeCrusher();
  screens = new ScreenBank();
  mill = new BallMill();
  cyclones = new CycloneCluster();
  stations: Record<StationId, StationView>;
  private belts: Conveyor[] = [];
  /** the next station's machines, shown before they are built as ghosts */
  private machines: Machine[];

  constructor() {
    const r = this.root;

    // ground and the pads the plant stands on
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 260), matte(0x191d22, 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(110, 0, 0);
    ground.receiveShadow = true;
    r.add(ground);
    for (const [x, w, d] of [[0, 34, 30], [48, 40, 40], [86, 22, 22], [120, 34, 50], [156, 20, 20], [188, 34, 28], [214, 22, 22]] as const) {
      const pad = box(w, 0.1, d, matte(C.concrete, 0.95));
      pad.position.set(x, 0.05, 0);
      r.add(pad);
    }

    // ---- primary: dump pocket, grizzly, jaw
    const wall = box(10, 7, 14, matte(C.concrete));
    wall.position.set(-9, 3.5, 0);
    r.add(wall);
    const ramp = box(24, 0.6, 12, matte(0x2d2a26));
    ramp.position.set(-26, 3.4, 0);
    ramp.rotation.z = 0.28;
    r.add(ramp);
    this.grizzly.group.position.set(-4.2, 7.6, 0);
    r.add(this.grizzly.group);
    this.jaw.group.position.set(0.2, 0, 0);
    r.add(this.jaw.group);

    // ---- stockpile and its stacker
    const pile = new THREE.Mesh(new THREE.ConeGeometry(15, 11, 48, 4), matte(0x5c5347, 1));
    pile.position.set(48, 5.5, 0);
    pile.castShadow = pile.receiveShadow = true;
    r.add(pile);

    // ---- secondary cone
    this.secondary.group.position.set(86, 0, 0);
    r.add(this.secondary.group);

    // ---- screens and tertiary cone
    this.screens.group.position.set(118, 0, -8);
    r.add(this.screens.group);
    this.tertiary.group.position.set(120, 0, 16);
    r.add(this.tertiary.group);

    // ---- fine ore bin
    const bin = new THREE.Group();
    const shell = cyl(6, 6, 12, metal(C.steelLight, 0.5, 0.7), 40);
    shell.position.y = 13;
    bin.add(shell);
    const hopper = cyl(6, 1.2, 5, metal(C.steelLight, 0.5, 0.7), 40);
    hopper.position.y = 4.5;
    bin.add(hopper);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.3, 1.8, 40), metal(C.steel));
    roof.position.y = 19.9;
    bin.add(roof);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leg = box(0.5, 13, 0.5, metal(C.steel));
      leg.position.set(Math.cos(a) * 5.6, 6.5, Math.sin(a) * 5.6);
      bin.add(leg);
    }
    bin.position.set(156, 0, 0);
    r.add(bin);

    // ---- mill and cyclones
    this.mill.group.position.set(188, 0, 0);
    r.add(this.mill.group);
    this.cyclones.group.position.set(214, 0, 0);
    r.add(this.cyclones.group);

    // ---- the belts that join them
    const belts: Array<[THREE.Vector3, THREE.Vector3, number?]> = [
      [V(3, 0.6, 0), V(44, 12, 0)],            // jaw to the stockpile
      [V(52, 0.6, 0), V(83, 5.2, 0)],          // reclaim to the secondary
      [V(90, 1.0, 0), V(112, 10.2, -8)],       // secondary to the screens
      [V(124, 8.0, -8), V(119, 5.3, 14), 1.0],  // screen oversize to the tertiary
      [V(123, 1.0, 16), V(110, 10.2, -8), 1.0], // tertiary back to the screens
      [V(124, 1.0, -8), V(152, 20.5, 0)],      // fine ore to the bin
      [V(156, 1.6, 0), V(178, 4.8, 0), 1.0],   // bin feeder to the mill
    ];
    for (const [a, b, w] of belts) {
      const c = new Conveyor(a, b, w);
      r.add(c.group);
      this.belts.push(c);
    }

    // overflow launder east towards flotation, and the backfill plant beyond
    const launder = box(26, 0.5, 0.8, metal(C.steelDark));
    launder.position.set(236, 3, 0);
    r.add(launder);

    const station = (target: THREE.Vector3, offset: THREE.Vector3, title: string, at: THREE.Vector3, radius: number, machines: Machine[]): StationView => {
      const ringMat = glowUnique(STATUS_COLOUR.idle, 1.4);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.14, 8, 96), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(at.x, 0.14, at.z);
      r.add(ring);
      const tag = new Tag(title, 3.2);
      tag.group.position.set(at.x, 16, at.z);
      r.add(tag.group);
      return { target, offset, ring, ringMat, tag, machines };
    };

    this.stations = {
      primary: station(V(0, 4, 0), V(-6, 11, 26), 'Primary crushing', V(0, 0, 0), 14, [this.grizzly, this.jaw]),
      secondary: station(V(86, 4, 0), V(-4, 7, 15), 'Secondary crushing', V(86, 0, 0), 9, [this.secondary]),
      tertiary: station(V(119, 6, 4), V(-6, 12, 27), 'Tertiary crushing and screening', V(120, 0, 4), 20, [this.screens, this.tertiary]),
      mill: station(V(188, 4.5, 0), V(-2, 7, 21), 'Ball mill', V(188, 0, 0), 13, [this.mill]),
      cyclones: station(V(214, 10, 0), V(-8, 5, 17), 'Cyclones', V(214, 0, 0), 9, [this.cyclones]),
    };
    this.machines = [this.grizzly, this.jaw, this.secondary, this.tertiary, this.screens, this.mill, this.cyclones];

    // work lights over each station; the stage's own are placed for the backfill plant
    for (const [x, z] of [[0, 8], [48, 10], [86, 6], [119, 10], [156, 6], [188, 8], [214, 6]] as const) {
      const p = new THREE.PointLight(0xffd9a8, 260, 70, 2);
      p.position.set(x, 18, z);
      r.add(p);
    }
  }

  setStatus(id: StationId, s: Status, value: string, sub: string) {
    const st = this.stations[id];
    st.ringMat.emissive.setHex(STATUS_COLOUR[s]);
    st.tag.set(value, sub, s === 'fail' ? 'trip' : 'ok');
  }

  /** Stations not reached yet stand as blueprints. */
  built(id: StationId, on: boolean) {
    for (const m of this.stations[id].machines) m.ghost = !on;
  }

  /** The open station's tag would sit in front of the camera, and the panel says it all anyway. */
  focus(id: StationId) {
    for (const [key, st] of Object.entries(this.stations)) st.tag.group.visible = key !== id;
  }

  running(on: boolean) {
    for (const b of this.belts) b.run(on);
  }

  tick(dt: number, t: number) {
    for (const m of this.machines) m.tick(dt, t);
    // each tag rides just over the tallest machine at its station, as they grow
    for (const st of Object.values(this.stations)) {
      const top = Math.max(...st.machines.map((m) => m.height() + m.group.position.y));
      st.tag.group.position.y = top + 2.5;
    }
  }
}
