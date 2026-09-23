import * as THREE from 'three';
import { C, metal, matte } from '../view/palette';
import { COLOURS, hex, INTERP_MS, type WeaponId } from './shared/rules';
import { F } from './shared/protocol';

/**
 * Everyone else on the pad: a worker in hi-vis and a hard hat in their own
 * colour, carrying whatever they last had in hand. Drawn a little in the
 * past (INTERP_MS) from the server's snapshots, so there is always a pair of
 * them to blend between and nobody stutters.
 */

interface Snap {
  T: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hp: number; flags: number; w: WeaponId;
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** a paste gun as other people see it: nozzle, body, hopper */
export function pasteGunModel(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const yellow = metal(0xe0b830, 0.45, 0.35);
  const black = matte(0x1a1d22, 0.6);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.42), yellow);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.14, 10), black);
  hopper.position.set(0, 0.12, 0.04);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 10), metal(C.steelLight, 0.4, 0.9));
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.01, -0.3);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), black);
  grip.position.set(0, -0.11, 0.1);
  grip.rotation.x = 0.3;
  g.add(body, hopper, nozzle, grip);
  g.scale.setScalar(scale);
  return g;
}

export class Avatar {
  group = new THREE.Group();
  private body = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private head = new THREE.Group();
  private gun: THREE.Group;
  private rock: THREE.Mesh;
  private shield: THREE.Mesh;
  private label: THREE.Sprite;
  private mats: THREE.MeshStandardMaterial[] = [];
  private tint: number[] = [];
  private splats = new THREE.Group();
  private snaps: Snap[] = [];
  private stride = 0;
  private fall = 0;
  private flash = 0;
  private lastX = 0;
  private lastZ = 0;
  alive = true;
  name: string;

  constructor(readonly id: number, name: string, col: number) {
    this.name = name;
    const g = this.group;
    g.userData.noCollide = true;
    g.add(this.body);

    const hat = COLOURS[col % COLOURS.length];
    const mat = (c: number, r = 0.8, m = 0) => {
      const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
      this.mats.push(x);
      this.tint.push(c);
      return x;
    };
    const vest = mat(0xff7a1a, 0.7);
    vest.emissive.setHex(0xff7a1a);
    vest.emissiveIntensity = 0.08;
    const navy = mat(0x243248, 0.85);
    const skin = mat(0xd8b596, 0.8);
    const boot = mat(0x16181c, 0.7);
    const hatMat = mat(hat, 0.4, 0.1);
    const tape = mat(0xdfe6ee, 0.25, 0.6);

    const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.11, 0.93, 0);
      part(new THREE.BoxGeometry(0.17, 0.82, 0.2), navy, 0, -0.41, 0, hip);
      part(new THREE.BoxGeometry(0.19, 0.12, 0.3), boot, 0, -0.87, -0.04, hip);
      this.body.add(hip);
      this.legs.push(hip);
    }
    part(new THREE.BoxGeometry(0.46, 0.62, 0.26), vest, 0, 1.25, 0, this.body);
    for (const y of [1.08, 1.2]) part(new THREE.BoxGeometry(0.47, 0.035, 0.27), tape, 0, y, 0, this.body);
    for (const s of [-1, 1]) {
      const band = part(new THREE.BoxGeometry(0.05, 0.6, 0.27), tape, s * 0.12, 1.28, 0, this.body);
      band.rotation.z = s * 0.08;
    }
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.3, 1.5, 0);
      part(new THREE.BoxGeometry(0.13, 0.58, 0.14), navy, 0, -0.27, 0, sh);
      part(new THREE.BoxGeometry(0.11, 0.1, 0.12), skin, 0, -0.6, 0, sh);
      this.body.add(sh);
      this.arms.push(sh);
    }
    this.head.position.set(0, 1.58, 0);
    part(new THREE.BoxGeometry(0.2, 0.24, 0.22), skin, 0, 0.12, 0, this.head);
    part(new THREE.BoxGeometry(0.21, 0.05, 0.05), matte(0x15181d, 0.3), 0, 0.16, -0.105, this.head);
    const dome = part(new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat, 0, 0.23, 0, this.head);
    dome.scale.set(1, 0.85, 1.1);
    part(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), hatMat, 0, 0.235, -0.03, this.head);
    this.body.add(this.head);

    // held in both hands out front, and swung up and down with where they look
    this.gun = pasteGunModel();
    this.gun.position.set(0.12, 1.22, -0.36);
    this.body.add(this.gun);
    this.rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12), matte(0x7d8793, 0.9));
    this.rock.position.set(0.3, 1.02, -0.28);
    this.body.add(this.rock);

    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0x8fd3ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.shield.position.y = 0.95;
    this.shield.scale.set(0.6, 1, 0.6);
    g.add(this.shield);

    this.label = nameTag(name, hat);
    this.label.position.y = 2.25;
    g.add(this.label);
    this.body.add(this.splats);
  }

  push(s: Snap) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.T <= last.T) return;
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();
  }

  /** Back on shift somewhere else: forget the path that led there. */
  teleport(x: number, y: number, z: number, yaw: number) {
    this.snaps.length = 0;
    this.group.position.set(x, y, z);
    this.body.rotation.y = yaw;
    this.lastX = x; this.lastZ = z;
    this.alive = true;
    this.fall = 0;
    this.clearSplats();
  }

  /** where they are being drawn right now, in the world */
  get position() { return this.group.position; }

  hit(at: THREE.Vector3, paste: boolean) {
    this.flash = 0.14;
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(paste ? 0.09 : 0.05, 6, 5),
      matte(paste ? C.paste : 0x7d8793, 0.9),
    );
    this.body.updateWorldMatrix(true, false);
    blob.position.copy(this.body.worldToLocal(at.clone()));
    blob.scale.set(1.4, 0.7, 1.4);
    blob.userData.until = performance.now() + 5000;
    this.splats.add(blob);
  }

  private clearSplats() {
    for (const c of [...this.splats.children]) {
      (c as THREE.Mesh).geometry.dispose();
      this.splats.remove(c);
    }
  }

  /** Blend to where they were INTERP_MS ago, and pose to match. */
  update(renderT: number, dt: number) {
    const s = this.sample(renderT);
    if (s) {
      this.group.position.set(s.x, s.y, s.z);
      this.body.rotation.y = s.yaw;
      this.alive = !!(s.flags & F.alive);
      const moved = Math.hypot(s.x - this.lastX, s.z - this.lastZ);
      this.lastX = s.x; this.lastZ = s.z;
      const speed = dt > 0 ? moved / dt : 0;
      const floor = !!(s.flags & F.floor);
      this.stride += moved * 3.2;
      const swing = floor ? Math.min(0.75, speed * 0.11) * Math.sin(this.stride) : 0.35;
      this.legs[0].rotation.x = swing;
      this.legs[1].rotation.x = floor ? -swing : -0.2;
      // arms up to hold what they are carrying, pointed where they look
      const aim = 1.25 + s.pitch * 0.9;
      this.arms[0].rotation.x = aim * 0.8;
      this.arms[1].rotation.x = s.w === 0 ? aim : aim * 0.55 + Math.sin(this.stride) * 0.1;
      this.gun.visible = s.w === 0;
      this.rock.visible = s.w === 1;
      this.gun.rotation.x = s.pitch;
      this.head.rotation.x = s.pitch * 0.6;
      this.shield.visible = !!(s.flags & F.shield) && this.alive;
      if (this.shield.visible) (this.shield.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.06 * Math.sin(performance.now() / 90);
      this.label.visible = this.alive;
    }

    // plastered: over backwards, and the colour drains out
    this.fall = Math.max(0, Math.min(1, this.fall + (this.alive ? -dt * 4 : dt * 3)));
    const k = this.fall * this.fall * (3 - 2 * this.fall);
    this.body.rotation.x = k * 1.45;
    this.body.position.y = k * 0.12;
    this.flash = Math.max(0, this.flash - dt);
    this.mats.forEach((m, i) => {
      m.color.setHex(this.tint[i]).lerp(GREY, k * 0.75);
      if (i > 0) m.emissive.setScalar(this.flash > 0 ? 0.28 : 0);
    });

    const now = performance.now();
    for (const c of [...this.splats.children]) {
      if (c.userData.until < now) {
        (c as THREE.Mesh).geometry.dispose();
        this.splats.remove(c);
      }
    }
  }

  private sample(T: number): Snap | null {
    const a = this.snaps;
    if (!a.length) return null;
    if (T <= a[0].T) return a[0];
    for (let i = a.length - 1; i > 0; i--) {
      if (a[i - 1].T <= T) {
        const p = a[i - 1], q = a[i];
        if (T >= q.T) return q;
        const t = (T - p.T) / (q.T - p.T);
        return {
          ...q,
          x: p.x + (q.x - p.x) * t,
          y: p.y + (q.y - p.y) * t,
          z: p.z + (q.z - p.z) * t,
          yaw: lerpAngle(p.yaw, q.yaw, t),
          pitch: p.pitch + (q.pitch - p.pitch) * t,
        };
      }
    }
    return a[a.length - 1];
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.mats.forEach((m) => m.dispose());
    const lm = this.label.material as THREE.SpriteMaterial;
    lm.map?.dispose();
    lm.dispose();
  }
}

const GREY = new THREE.Color(0x5a5f66);

/** A name over their head, in their hat's colour. Hidden behind walls like anything else. */
function nameTag(name: string, colour: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 30px "Segoe UI", system-ui, sans-serif';
  const w = Math.min(248, g.measureText(name).width + 34);
  g.fillStyle = 'rgba(9,14,22,0.72)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 10, w, 44, 22);
  g.fill();
  g.fillStyle = hex(colour);
  g.beginPath();
  g.arc((256 - w) / 2 + 18, 32, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e2e9f4';
  g.textBaseline = 'middle';
  g.fillText(name, (256 - w) / 2 + 31, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(1.5, 0.375, 1);
  return s;
}

/** Everyone else, by id. */
export class Avatars {
  group = new THREE.Group();
  private byId = new Map<number, Avatar>();

  constructor() {
    this.group.userData.noCollide = true;
  }

  get(id: number) { return this.byId.get(id); }
  all() { return this.byId.values(); }

  add(id: number, name: string, col: number) {
    if (this.byId.has(id)) this.remove(id);
    const a = new Avatar(id, name, col);
    this.byId.set(id, a);
    this.group.add(a.group);
    return a;
  }

  remove(id: number) {
    const a = this.byId.get(id);
    if (!a) return;
    this.group.remove(a.group);
    a.dispose();
    this.byId.delete(id);
  }

  clear() {
    for (const id of [...this.byId.keys()]) this.remove(id);
  }

  snapshot(T: number, P: Array<[number, number, number, number, number, number, number, number, WeaponId]>, me: number) {
    for (const [id, x, y, z, yaw, pitch, hp, flags, w] of P) {
      if (id === me) continue;
      this.byId.get(id)?.push({ T, x, y, z, yaw, pitch, hp, flags, w });
    }
  }

  update(serverNow: number, dt: number) {
    const T = serverNow - INTERP_MS;
    for (const a of this.byId.values()) a.update(T, dt);
  }
}
