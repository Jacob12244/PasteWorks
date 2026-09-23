import * as THREE from 'three';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import type { WorldKind } from '../scenario/types';

/**
 * First person: walk the plant.
 *
 * The walker is a capsule the size of a person, pushed out of a static
 * collision world every sub-step - the approach in three.js's own FPS
 * example. The collision world is built once, from the same meshes you are
 * looking at, so there is no second model of the plant to keep in step with
 * the first. What it leaves out is as important as what it keeps: glass,
 * light cones, domes, process liquor, the sky, and anything that moves.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** How walking feels in each world. */
export interface Feel {
  /** m/s², once your feet leave the floor */
  gravity: number;
  walk: number;
  run: number;
  /** take-off speed, m/s */
  jump: number;
  /** how quickly you reach the speed you are asking for, on the floor and off it */
  grip: number;
  airGrip: number;
  /** said once, when you step out */
  note: string;
}

export const FEEL: Record<WorldKind, Feel> = {
  earth: {
    gravity: 20, walk: 4.2, run: 8, jump: 6.2, grip: 12, airGrip: 1.5,
    note: 'Hi-vis on. Stay behind the handrails.',
  },
  city: {
    gravity: 20, walk: 4.2, run: 8, jump: 6.2, grip: 10, airGrip: 1.5,
    note: 'Mind the puddles. And the drones.',
  },
  waste: {
    gravity: 20, walk: 4.0, run: 7.5, jump: 6.2, grip: 11, airGrip: 1.5,
    note: 'Nobody has walked here in a very long time.',
  },
  // a hardsuit at 440 bar: slow, heavy, and every jump a long float down
  ocean: {
    gravity: 4.5, walk: 2.4, run: 3.6, jump: 3.4, grip: 4, airGrip: 0.8,
    note: 'Hardsuit on. 440 bar outside it - take it slowly.',
  },
  // Mag boots hold you to the iron while you walk. Jump and they let go, and
  // Psyche barely pulls you back - 0.144 m/s² is not much of an argument.
  space: {
    gravity: 1.2, walk: 3.4, run: 5.5, jump: 3.4, grip: 9, airGrip: 0.3,
    note: 'Mag boots on. Jump, and find out how little Psyche pulls.',
  },
};

/** capsule radius, height, and eye height above the feet */
const R = 0.35, H = 1.8, EYE = 1.62;
/** the pull that keeps you on stairs and ramps on the way down */
const STICK = 4;
/** the highest kerb you walk up without jumping */
const STEP_UP = 0.45;
const STEPS = 5;

/**
 * The triangles a walker can touch, bucketed into a uniform grid.
 *
 * three's Octree does the same job, but building one takes seconds on a plant
 * this size, and this has to be built the moment someone steps outside. A
 * grid is one pass: every triangle goes into the cells its bounding box
 * covers. The few that would cover dozens of cells - the ground, the pad, a
 * tank wall - go on a short list of their own and are checked by bounding
 * box instead. The capsule test itself is three's, borrowed from an empty
 * Octree.
 */
export class TriangleGrid {
  private static readonly S = 1.5;
  private cells = new Map<number, number[]>();
  private tris: THREE.Triangle[] = [];
  private big: number[] = [];
  private bigBox: THREE.Box3[] = [];
  private seen = new Uint32Array(0);
  private mark = 0;
  private test = new Octree();
  private _c = new Capsule();
  private _box = new THREE.Box3();
  private _list: number[] = [];

  private key(x: number, y: number, z: number) {
    return ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
  }

  get size() { return this.tris.length; }

  add(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    const i = this.tris.length;
    this.tris.push(new THREE.Triangle(a.clone(), b.clone(), c.clone()));
    const S = TriangleGrid.S;
    const x0 = Math.floor(Math.min(a.x, b.x, c.x) / S), x1 = Math.floor(Math.max(a.x, b.x, c.x) / S);
    const y0 = Math.floor(Math.min(a.y, b.y, c.y) / S), y1 = Math.floor(Math.max(a.y, b.y, c.y) / S);
    const z0 = Math.floor(Math.min(a.z, b.z, c.z) / S), z1 = Math.floor(Math.max(a.z, b.z, c.z) / S);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 48) {
      this.big.push(i);
      this.bigBox.push(new THREE.Box3().setFromPoints([a, b, c]));
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const k = this.key(x, y, z);
          const cell = this.cells.get(k);
          if (cell) cell.push(i); else this.cells.set(k, [i]);
        }
      }
    }
  }

  finish() {
    this.seen = new Uint32Array(this.tris.length);
  }

  /** Same contract as Octree.capsuleIntersect: the push out, or false. */
  capsuleIntersect(capsule: Capsule): { normal: THREE.Vector3; depth: number } | false {
    // Capsule.copy returns nothing, whatever its typings say
    const cap = this._c;
    cap.copy(capsule);
    const r = cap.radius;
    const box = this._box.makeEmpty().expandByPoint(cap.start).expandByPoint(cap.end).expandByScalar(r + 0.05);
    const S = TriangleGrid.S;
    const list = this._list;
    list.length = 0;
    if (++this.mark === 0xffffffff) { this.seen.fill(0); this.mark = 1; }
    for (let x = Math.floor(box.min.x / S); x <= Math.floor(box.max.x / S); x++) {
      for (let y = Math.floor(box.min.y / S); y <= Math.floor(box.max.y / S); y++) {
        for (let z = Math.floor(box.min.z / S); z <= Math.floor(box.max.z / S); z++) {
          const cell = this.cells.get(this.key(x, y, z));
          if (!cell) continue;
          for (const i of cell) {
            if (this.seen[i] === this.mark) continue;
            this.seen[i] = this.mark;
            list.push(i);
          }
        }
      }
    }
    for (let j = 0; j < this.big.length; j++) {
      if (this.bigBox[j].intersectsBox(box)) list.push(this.big[j]);
    }

    let hit = false;
    for (const i of list) {
      const res = this.test.triangleCapsuleIntersect(cap, this.tris[i]);
      if (res) {
        hit = true;
        cap.translate(res.normal.multiplyScalar(res.depth));
      }
    }
    if (!hit) return false;
    const push = cap.getCenter(V()).sub(capsule.getCenter(V()));
    const depth = push.length();
    if (depth < 1e-9) return false;
    return { normal: push.normalize(), depth };
  }
}

/**
 * Everything a walker can bump into, as world-space triangles in a grid.
 *
 * A mesh is in unless it says otherwise (userData.noCollide on it or any
 * parent), or it is see-through, or it is a fluid, or it is so big it can
 * only be scenery. userData.collider forces a mesh in - the ground, which is
 * big, and the invisible ramps laid over stair treads. Instanced meshes are
 * out unless they are marked solid, because most of them are fish. Bolts and
 * lamps are too small to matter, and anything out of reach overhead is left
 * out too.
 */
export function collisionWorld(root: THREE.Object3D): TriangleGrid {
  const grid = new TriangleGrid();
  root.updateWorldMatrix(true, true);
  const a = V(), b = V(), c = V();
  const m = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  const add = (geo: THREE.BufferGeometry, world: THREE.Matrix4) => {
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(world);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(world);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(world);
      grid.add(a, b, c);
    }
  };

  const consider = (mesh: THREE.Mesh) => {
    const forced = !!mesh.userData.collider;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
    if (!forced) {
      if (!mat || mat.transparent || !mat.visible || mat.userData.fluid) return;
      if ((mat as THREE.ShaderMaterial).isShaderMaterial || mat.side === THREE.BackSide) return;
    }
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    sphere.copy(geo.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    if (!forced && (sphere.radius > 250 || sphere.radius < 0.2 || sphere.center.y - sphere.radius > 15)) return;

    const inst = mesh as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      if (!mesh.userData.solid) return;
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, m);
        m.premultiply(inst.matrixWorld);
        add(geo, m);
      }
      return;
    }
    add(geo, mesh.matrixWorld);
  };

  const visit = (o: THREE.Object3D) => {
    if (!o.visible || o.userData.noCollide) return;
    if ((o as THREE.Mesh).isMesh) consider(o as THREE.Mesh);
    for (const ch of o.children) visit(ch);
  };
  visit(root);
  grid.finish();
  return grid;
}

export class Walker {
  active = false;
  /** pointer lock lost: the world keeps running, the walker stands still */
  paused = false;
  private world: TriangleGrid | null = null;
  private cap = new Capsule(V(0, R, 0), V(0, H - R, 0), R);
  private vel = V();
  private onFloor = false;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private spawnAt = V();
  private spawnYaw = 0;
  private bob = 0;
  private _t = V();

  onPause: (paused: boolean) => void = () => {};

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private feel: Feel,
  ) {
    addEventListener('keydown', (e) => {
      if (this.active && !this.paused) this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      if (!this.active) return;
      this.paused = document.pointerLockElement !== this.dom;
      if (this.paused) this.keys.clear();
      this.onPause(this.paused);
    });
    // refused - no gesture, or a browser that says no: wait for a click
    document.addEventListener('pointerlockerror', () => {
      if (!this.active) return;
      this.paused = true;
      this.onPause(true);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || this.paused) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
  }

  get ready() { return !!this.world; }

  /** Build the collision world - once, and only for someone who actually walks. */
  prepare(root: THREE.Object3D) {
    if (this.world) return null;
    const t0 = performance.now();
    this.world = collisionWorld(root);
    return { triangles: this.world.size, ms: performance.now() - t0 };
  }

  enter(at: THREE.Vector3, yaw: number) {
    this.spawnAt.copy(at);
    this.spawnYaw = yaw;
    this.respawn();
    this.active = true;
    this.paused = false;
    this.camera.rotation.order = 'YXZ';
    this.lock();
  }

  exit() {
    this.active = false;
    this.keys.clear();
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  /** Take the mouse. Needs a click or a key press to have just happened. */
  lock() {
    try {
      const p = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => { this.paused = true; this.onPause(true); });
    } catch {
      this.paused = true;
      this.onPause(true);
    }
  }

  respawn() {
    const s = this.spawnAt;
    this.cap.start.set(s.x, s.y + R, s.z);
    this.cap.end.set(s.x, s.y + H - R, s.z);
    this.vel.set(0, 0, 0);
    this.yaw = this.spawnYaw;
    this.pitch = -0.04;
  }

  /** where your eyes are */
  get eye() {
    return V(this.cap.end.x, this.cap.end.y + EYE - (H - R), this.cap.end.z);
  }

  /** where you are facing, flat */
  get forward() {
    return V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt: number) {
    if (!this.active || !this.world) return;
    if (!this.paused) {
      const h = Math.min(dt, 0.05) / STEPS;
      for (let i = 0; i < STEPS; i++) this.step(h);
    }
    // fell through a hole in the world, or into the stope
    if (this.cap.end.y < -40) this.respawn();

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const striding = this.onFloor && speed > 0.6;
    this.bob += dt * (striding ? speed * 1.8 : 0);
    const bobY = striding ? Math.sin(this.bob) * 0.035 : 0;
    const e = this.eye;
    this.camera.position.set(e.x, e.y + bobY, e.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private step(h: number) {
    const f = this.feel;
    const k = this.keys;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = run ? f.run : f.walk;

    let ix = 0, iz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    const len = Math.hypot(ix, iz);
    let tx = 0, tz = 0;
    if (len > 0) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      tx = ((ix * c + iz * s) / len) * speed;
      tz = ((-ix * s + iz * c) / len) * speed;
    }
    const grip = 1 - Math.exp(-(this.onFloor ? f.grip : f.airGrip) * h);
    this.vel.x += (tx - this.vel.x) * grip;
    this.vel.z += (tz - this.vel.z) * grip;

    const grounded = this.onFloor;
    if (this.onFloor) {
      if (k.has('Space')) { this.vel.y = f.jump; this.onFloor = false; }
      else this.vel.y = -STICK;
    } else {
      this.vel.y -= f.gravity * h;
    }

    const from = this._from;
    from.start.copy(this.cap.start);
    from.end.copy(this.cap.end);
    this.cap.translate(this._t.copy(this.vel).multiplyScalar(h));
    this.onFloor = false;
    const hit = this.world!.capsuleIntersect(this.cap);
    if (hit) this.resolve(hit);

    // Kerbs, slabs and the lip of a landing: a person steps up those without
    // thinking, but a capsule held to the floor just pushes against them. If
    // the move came up short, try it again from a step higher, and if that
    // is clear, put the foot down on whatever is there.
    const want = Math.hypot(this.vel.x, this.vel.z) * h;
    const got = Math.hypot(this.cap.start.x - from.start.x, this.cap.start.z - from.start.z);
    if (grounded && this.vel.y <= 0 && want > 1e-4 && got < want * 0.5) this.stepUp(from, h);
  }

  /**
   * Out of whatever the capsule has gone into. Off a wall or a ceiling you
   * keep only the part of your speed along it. Off a floor you go straight up
   * rather than along its normal - along the normal, a stair is a slide, and
   * standing still on one carries you down it.
   */
  private resolve(hit: { normal: THREE.Vector3; depth: number }) {
    this.onFloor = hit.normal.y > 0.4;
    if (this.onFloor) {
      this.cap.translate(this._t.set(0, hit.depth / hit.normal.y, 0));
    } else {
      this.vel.addScaledVector(hit.normal, -hit.normal.dot(this.vel));
      this.cap.translate(hit.normal.multiplyScalar(hit.depth));
    }
  }

  private _from = new Capsule(V(), V(), R);
  private _keep = new Capsule(V(), V(), R);

  private stepUp(from: Capsule, h: number) {
    const w = this.world!;
    const keep = this._keep;
    keep.start.copy(this.cap.start);
    keep.end.copy(this.cap.end);

    this.cap.start.copy(from.start);
    this.cap.end.copy(from.end);
    this.cap.translate(this._t.set(0, STEP_UP, 0));
    if (w.capsuleIntersect(this.cap)) return this.restore(keep);   // no headroom
    this.cap.translate(this._t.set(this.vel.x * h, 0, this.vel.z * h));
    const side = w.capsuleIntersect(this.cap);
    if (side && side.normal.y <= 0.4) return this.restore(keep);   // a wall, not a step
    if (side) this.cap.translate(side.normal.multiplyScalar(side.depth));

    // and down onto the step
    this.cap.translate(this._t.set(0, -STEP_UP, 0));
    const land = w.capsuleIntersect(this.cap);
    if (!land || land.normal.y <= 0.4) return this.restore(keep);  // nothing to stand on
    this.cap.translate(land.normal.multiplyScalar(land.depth));
    this.onFloor = true;
  }

  private restore(c: Capsule) {
    this.cap.start.copy(c.start);
    this.cap.end.copy(c.end);
  }
}
