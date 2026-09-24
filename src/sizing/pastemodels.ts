import * as THREE from 'three';
import { C, metal, matte, glow, liquor } from '../view/palette';
import { box, cyl, strip, bands } from '../view/parts';
import { Machine } from './models';

/**
 * The paste plant's machines, drawn from their sizes the same way as the
 * circuit's: a thickener, a row of filter presses, the binder silo and paste
 * mixer, and the paste pumps with the start of their line.
 */

type Dims = Record<string, number>;

function along(mesh: THREE.Object3D, axis: 'x' | 'z'): THREE.Object3D {
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  else mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** A pipe from a to b, straight, of radius r. */
function pipe(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = b.clone().sub(a);
  const m = cyl(r, r, d.length(), mat, 12);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// =============================================================== thickener

/**
 * A paste thickener: a tank on a plinth with a conical floor, the bridge and
 * the rake drive on it, the rakes turning at the bottom, and a window cut in
 * the shell towards the camera so the bed shows at the height it is.
 */
export class ThickenerTank extends Machine {
  private rake = new THREE.Group();
  private angle = 0;
  private h = 0;
  /** where the flotation tailings arrive from, relative to the tank's centre */
  feedFrom = V(-38, 4.5, 0);
  /** where the underflow goes, relative to the tank's centre */
  underflowTo = V(36, 1, 0);

  protected build(d: Dims) {
    const D = d.diameter, H = d.depth, R = D / 2;
    const drive = Math.round(d.drive ?? 1);
    const base = 1.2;
    const cone = R / 6;
    const floor = base + cone;
    const top = floor + H;
    const bed = Math.max(0, Math.min(H - 0.2, d.bed ?? 0));
    const dark = metal(C.steelDark, 0.6, 0.8);

    const plinth = cyl(R + 0.9, R + 1.2, base, matte(0x2a2f38, 0.95), 64);
    plinth.position.y = base / 2;
    this.body.add(plinth);
    const floorMesh = cyl(R, 0.8, cone, matte(0x1e242c, 0.95), 64);
    floorMesh.position.y = base + cone / 2;
    this.body.add(floorMesh);

    // the shell, with a window towards the camera
    const gap = 1.1;
    const shellGeo = new THREE.CylinderGeometry(R, R, H, 72, 1, true, gap / 2, 2 * Math.PI - gap);
    const shell = new THREE.Mesh(shellGeo, this.own(new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.6, metalness: 0.85, side: THREE.DoubleSide })));
    shell.position.y = floor + H / 2;
    shell.castShadow = shell.receiveShadow = true;
    this.body.add(shell);
    for (const a of [gap / 2, -gap / 2]) {
      const edge = box(0.08, H, 0.08, glow(C.cyan, 1.2));
      edge.position.set(Math.sin(a) * R, floor + H / 2, Math.cos(a) * R);
      this.body.add(edge);
    }
    const ys: number[] = [];
    for (let y = floor + 1.5; y < top - 0.5; y += 2.2) ys.push(y);
    this.body.add(bands(R, ys, dark));
    const launder = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.42, 10, 72), dark);
    launder.rotation.x = Math.PI / 2;
    launder.position.y = top - 0.2;
    this.body.add(launder);

    // the bed, at the height the underflow needs, and clear water over it
    const bedMesh = cyl(R - 0.12, 0.8, cone, this.own(liquor(C.thickUf, 1)), 64);
    bedMesh.position.y = base + cone / 2 + 0.02;
    this.body.add(bedMesh);
    if (bed > 0.05) {
      const b = cyl(R - 0.12, R - 0.12, bed, this.own(liquor(C.thickUf, 1)), 64);
      b.position.y = floor + bed / 2;
      this.body.add(b);
    }
    const water = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 72), this.own(liquor(C.water, 0.55)));
    water.rotation.x = -Math.PI / 2;
    water.position.y = top - 0.5;
    this.body.add(water);

    // bridge, drive and feedwell
    const beam = box(D + 2.2, 0.55, 1.1, metal(C.steelLight, 0.5, 0.9));
    beam.position.y = top + 0.7;
    this.body.add(beam);
    for (const s of [-1, 1]) {
      const rail = strip(D + 2.2, C.handrail, 0.06, 0.4);
      rail.position.set(0, top + 1.8, s * 0.6);
      this.body.add(rail);
    }
    const k = 1.1 + 0.35 * drive;
    const head = box(2.2 * k, 1.6 * k, 2.2 * k, metal(C.panel, 0.5, 0.6));
    head.position.y = top + 1.0 + 0.8 * k;
    this.body.add(head);
    const fw = Math.max(1.4, D / 12);
    const feedwell = cyl(fw, fw, 3.2, metal(C.steelLight, 0.5, 0.8), 32, true);
    feedwell.position.y = top - 1.2;
    this.body.add(feedwell);

    // the rakes, turning on the floor
    this.rake = new THREE.Group();
    const shaft = cyl(0.3, 0.3, H + cone, dark, 12);
    shaft.position.y = (base + top) / 2;
    this.rake.add(shaft);
    for (const s of [-1, 1]) {
      const arm = box(R - 0.8, 0.35, 0.35, dark);
      arm.position.set(s * (R / 2), base + cone * 0.55, 0);
      arm.rotation.z = s * Math.atan2(cone, R);
      this.rake.add(arm);
      for (let i = 1; i < 6; i++) {
        const blade = box(0.12, 0.5, 1.1, metal(C.steelLight));
        const x = (s * (R - 0.8) * i) / 6;
        blade.position.set(x, base + cone * (1 - Math.abs(x) / R) * 0.2 + cone * (Math.abs(x) / R) + 0.1, 0);
        blade.rotation.y = s * 0.6;
        this.rake.add(blade);
      }
    }
    this.rake.rotation.y = this.angle;
    this.body.add(this.rake);

    // flotation tailings in, over the bridge to the feedwell
    const inlet = V(-R + 0.5, top + 0.2, 0);
    const pm = metal(C.steel, 0.6, 0.8);
    this.body.add(pipe(this.feedFrom, V(-R - 1, this.feedFrom.y, 0), 0.35, pm));
    this.body.add(pipe(V(-R - 1, this.feedFrom.y, 0), V(-R - 1, top + 0.2, 0), 0.35, pm));
    this.body.add(pipe(V(-R - 1, top + 0.2, 0), inlet, 0.35, pm));

    // underflow pump at the foot, and its line on towards the presses
    const pump = box(2.4, 1.4, 1.6, metal(C.pumpPaint, 0.5, 0.6));
    pump.position.set(R + 2.4, 0.7, 2.4);
    this.body.add(pump);
    this.body.add(pipe(V(0.8, base * 0.5, 0), V(R + 1.2, base * 0.5, 2.4), 0.25, pm));
    this.body.add(pipe(V(R + 3.6, 0.8, 2.4), V(this.underflowTo.x, this.underflowTo.y, 2.4), 0.25, pm));

    this.h = top + 1.6 + 1.6 * k;
  }

  protected animate(dt: number) {
    this.angle += dt * 0.12;
    this.rake.rotation.y = this.angle;
  }

  height() {
    return this.h;
  }
}

// ============================================================ filter press

/**
 * Recessed-plate filter presses on a steel floor over their cake bunkers: a
 * plate pack as long as the chambers need, between a fixed head and the
 * hydraulic head, one press beside the next.
 */
export class FilterPresses extends Machine {
  private h = 0;

  protected build(d: Dims) {
    const P = d.plate, n = Math.max(1, Math.round(d.chambers)), units = Math.max(1, Math.round(d.presses)), e = d.depth;
    // a plate is about its chamber deep plus its web: drawn, not rated
    const pitch = e + 0.045;
    const pack = n * pitch;
    const L = pack + 3.2;
    const floorY = 5.5;
    const gap = P + 2.6;
    const width = units * gap + 1;
    const frame = metal(C.steel, 0.6, 0.85);

    const floor = box(L + 4, 0.3, width, metal(C.steelDark, 0.7, 0.6));
    floor.position.set(0, floorY - 0.15, 0);
    this.body.add(floor);
    for (let x = -(L + 4) / 2 + 0.3; x <= (L + 4) / 2; x += Math.max(4, (L + 4) / 4)) {
      for (const s of [-1, 1]) {
        const leg = box(0.4, floorY - 0.3, 0.4, frame);
        leg.position.set(x, (floorY - 0.3) / 2, s * (width / 2 - 0.3));
        this.body.add(leg);
      }
    }
    for (const s of [-1, 1]) {
      const rail = strip(L + 4, C.handrail, 0.06, 0.4);
      rail.position.set(0, floorY + 1.1, s * width / 2);
      this.body.add(rail);
    }

    const plateGeo = new THREE.BoxGeometry(pitch * 0.92, P, P);
    const plateMat = metal(0x44576c, 0.45, 0.4);
    for (let u = 0; u < units; u++) {
      const z = -width / 2 + 0.5 + gap / 2 + u * gap;
      const y = floorY + 0.4 + P / 2;
      const x0 = -L / 2 + 1.0;
      // fixed head, plate pack, moving head, cylinder
      const fixed = box(0.6, P + 0.7, P + 0.7, metal(C.pumpPaint, 0.5, 0.6));
      fixed.position.set(x0 - 0.3, y, z);
      this.body.add(fixed);
      const plates = new THREE.InstancedMesh(plateGeo, plateMat, n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        m.makeTranslation(x0 + (i + 0.5) * pitch, y, z);
        plates.setMatrixAt(i, m);
      }
      plates.castShadow = plates.receiveShadow = true;
      this.own(plates);
      this.body.add(plates);
      const moving = box(0.5, P + 0.5, P + 0.5, metal(C.pumpPaint, 0.5, 0.6));
      moving.position.set(x0 + pack + 0.25, y, z);
      this.body.add(moving);
      const ram = along(cyl(0.22 + 0.08 * P, 0.22 + 0.08 * P, 1.6, metal(C.steelLight, 0.3, 0.9), 16), 'x');
      ram.position.set(x0 + pack + 1.3, y, z);
      this.body.add(ram);
      for (const s of [-1, 1]) {
        const side = box(pack + 2.6, 0.35, 0.3, frame);
        side.position.set(x0 + pack / 2 + 0.6, y + P / 2 + 0.2, z + s * (P / 2 + 0.2));
        this.body.add(side);
      }
      // cake bunker under the press
      const bunker = cyl(Math.min(P, 2) * 0.9, 0.5, floorY - 1.2, matte(C.cake, 0.9), 4);
      bunker.rotation.y = Math.PI / 4;
      bunker.scale.set(pack / (Math.min(P, 2) * 1.8) + 0.3, 1, 1);
      bunker.position.set(x0 + pack / 2, (floorY - 1.2) / 2 + 0.8, z);
      this.body.add(bunker);
    }
    this.h = floorY + 1.2 + (Math.max(...[P]) + 0.7);
  }

  height() {
    return this.h;
  }
}

// ===================================================== binder silo, mixer

/** The binder silo, as big as two days' binder, and a twin-shaft paste mixer as big as the paste it makes. */
export class PastePlant extends Machine {
  private h = 0;

  protected build(d: Dims) {
    // two days' binder at a bulk density of 1.2 t/m3, in a silo three times as tall as it is wide
    const volume = Math.max(60, (d.binder * 48) / 1.2);
    const r = Math.cbrt(volume / (6 * Math.PI));
    const legs = 4.5;
    const coneH = r * 1.1;
    const white = metal(0xd9dee6, 0.5, 0.4);
    const barrel = cyl(r, r, 6 * r, white, 40);
    barrel.position.set(-4 - r, legs + coneH + 3 * r, -6);
    this.body.add(barrel);
    const coneMesh = cyl(r, 0.35, coneH, white, 40);
    coneMesh.position.set(-4 - r, legs + coneH / 2, -6);
    this.body.add(coneMesh);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.03, 0.9, 40), metal(C.steel));
    roof.position.set(-4 - r, legs + coneH + 6 * r + 0.45, -6);
    this.body.add(roof);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = box(0.45, legs + coneH, 0.45, metal(C.steel));
      leg.position.set(-4 - r + Math.cos(a) * r * 0.9, (legs + coneH) / 2, -6 + Math.sin(a) * r * 0.9);
      this.body.add(leg);
    }
    const hoops = bands(r, [legs + coneH + r, legs + coneH + 3 * r, legs + coneH + 5 * r], metal(C.steelLight));
    hoops.position.set(-4 - r, 0, -6);
    this.body.add(hoops);

    // twin-shaft mixer, sized to the flow
    const flow = Math.max(40, d.flow);
    const ml = 2.5 + flow / 45;
    const mw = 1.4 + flow / 260;
    const mixer = box(ml, 1.5, mw, metal(C.pumpPaint, 0.5, 0.6));
    mixer.position.set(2, 3.2, 0);
    this.body.add(mixer);
    for (const s of [-1, 1]) {
      const motor = along(cyl(0.45, 0.45, 1.2, metal(C.panel, 0.5, 0.6), 16), 'x');
      motor.position.set(2 + ml / 2 + 0.7, 3.3, s * mw * 0.25);
      this.body.add(motor);
    }
    const stand = box(ml + 1.4, 2.4, mw + 1.4, metal(C.steel, 0.6, 0.85));
    stand.position.set(2, 1.2, 0);
    this.body.add(stand);
    // binder screw from the silo to the mixer
    this.body.add(pipe(V(-4 - r, legs, -6), V(2 - ml / 4, 4.2, 0), 0.28, metal(C.steelLight)));
    // water in
    const tank = cyl(1.4, 1.4, 3, metal(C.cooler, 0.5, 0.6), 24);
    tank.position.set(2, 1.5, 4.5);
    this.body.add(tank);

    this.h = Math.max(legs + coneH + 6 * r + 1, 5);
  }

  height() {
    return this.h;
  }
}

// ============================================================ paste pumps

/**
 * Twin-cylinder piston pumps side by side, a hopper over each, their
 * discharge joined into the paste line, and the line along the surface to
 * the borehole collar. The line is drawn at its bore.
 */
export class PastePumps extends Machine {
  private rods: THREE.Object3D[] = [];
  private h = 0;
  /** the borehole collar, relative to the pumps */
  collar = V(32, 0, 0);

  protected build(d: Dims) {
    const n = Math.max(1, Math.round(d.pumps));
    const s = Math.cbrt(Math.max(150, d.kW) / 600);
    const bore = Math.max(0.08, d.bore);
    const len = 6.5 * s;
    const pitch = 3.2 * s + 1.2;
    this.rods = [];
    const zs: number[] = [];
    for (let i = 0; i < n; i++) zs.push((i - (n - 1) / 2) * pitch);
    for (const z of zs) {
      const skid = box(len + 1, 0.5, 2.4 * s, metal(C.steelDark));
      skid.position.set(0, 0.25, z);
      this.body.add(skid);
      for (const side of [-1, 1]) {
        const barrel = along(cyl(0.32 * s, 0.32 * s, len * 0.55, metal(C.steelLight, 0.35, 0.9), 16), 'x');
        barrel.position.set(-len * 0.12, 1.1 * s + 0.5, z + side * 0.45 * s);
        this.body.add(barrel);
        const rod = along(cyl(0.12 * s, 0.12 * s, len * 0.3, metal(0xc8ced6, 0.2, 1), 12), 'x');
        rod.position.set(len * 0.28, 1.1 * s + 0.5, z + side * 0.45 * s);
        rod.userData.side = side;
        rod.userData.x = len * 0.28;
        this.body.add(rod);
        this.rods.push(rod);
      }
      const hopper = cyl(1.0 * s, 0.5 * s, 1.1 * s, metal(C.pumpPaint, 0.5, 0.6), 4);
      hopper.rotation.y = Math.PI / 4;
      hopper.position.set(-len * 0.45, 1.6 * s + 0.9, z);
      this.body.add(hopper);
      const pack = box(1.6 * s, 1.6 * s, 1.8 * s, metal(C.panel, 0.5, 0.6));
      pack.position.set(len * 0.42, 0.8 * s + 0.5, z);
      this.body.add(pack);
    }

    // the discharge header and the line to the collar, at its bore
    const pm = metal(C.pumpPaint, 0.5, 0.7);
    const r = bore / 2 + 0.04;
    const headerX = -len * 0.5 - 0.8;
    const y = 1.2;
    if (n > 1) this.body.add(pipe(V(headerX, y, zs[0]), V(headerX, y, zs[zs.length - 1]), r, pm));
    for (const z of zs) this.body.add(pipe(V(-len * 0.3, 1.1 * s + 0.5, z), V(headerX, y, z), r, pm));
    const c = this.collar;
    this.body.add(pipe(V(headerX, y, zs[zs.length - 1]), V(headerX, y, 5 + pitch * n / 2), r, pm));
    this.body.add(pipe(V(headerX, y, 5 + pitch * n / 2), V(c.x, y, 5 + pitch * n / 2), r, pm));
    this.body.add(pipe(V(c.x, y, 5 + pitch * n / 2), V(c.x, y, c.z), r, pm));
    for (let x = headerX + 3; x < c.x; x += 5) {
      const sup = box(0.25, y - 0.2, 0.25, metal(C.steel));
      sup.position.set(x, (y - 0.2) / 2, 5 + pitch * n / 2);
      this.body.add(sup);
    }

    // the borehole collar: a concrete pad, the casing going down, and a lit ring
    const pad = box(5, 0.4, 5, matte(C.concrete));
    pad.position.set(c.x, 0.2, c.z);
    this.body.add(pad);
    const casing = cyl(r + 0.12, r + 0.12, 1.6, metal(C.steelLight), 16);
    casing.position.set(c.x, 0.8, c.z);
    this.body.add(casing);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), matte(0x050608, 1));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(c.x, 0.41, c.z);
    this.body.add(hole);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 8, 48), glow(C.amber, 1.6));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(c.x, 0.45, c.z);
    this.body.add(ring);

    this.h = 1.6 * s + 2.5;
  }

  protected animate(_dt: number, t: number) {
    // the two cylinders of each pump stroke against each other
    for (const rod of this.rods) {
      rod.position.x = rod.userData.x + Math.sin(t * 1.6) * rod.userData.side * 0.35;
    }
  }

  height() {
    return this.h;
  }
}
