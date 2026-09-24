import * as THREE from 'three';
import { C, metal, matte, glow } from '../view/palette';
import { box, cyl, hazard } from '../view/parts';
import { rng } from '../view/worlds/common';
import { BOUNDS, PROPS, PICKUPS, type Prop, type Pickup } from './shared/map';

/**
 * What the arena leaves lying about the pad, built from the map data.
 *
 * Only the load-bearing shape of each thing collides - the box of a
 * container, not its corrugations - so nobody snags on a rib. Details carry
 * userData.noCollide. Everything is seeded, because the server was baked
 * from exactly this and a lump has to hit the same crate on both ends.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const detail = <T extends THREE.Object3D>(o: T): T => {
  o.userData.noCollide = true;
  return o;
};

const CONTAINER_PAINT = [0x8a3324, 0x2f5f86, 0x3f6b3a, 0xa7adb5, 0xa9612a, 0x6b4a7a];

/** A 20 ft box - or a 40 ft one with its doors open at both ends to run through. */
function container(colour: number, long = false): THREE.Group {
  const g = new THREE.Group();
  const L = long ? 12.19 : 6.06, H = 2.59, W = 2.44;
  const paint = metal(colour, 0.7, 0.45);
  if (!long) {
    const body = box(L, H, W, paint);
    body.position.y = H / 2;
    g.add(body);
  } else {
    // a room: floor, roof and two walls, nothing at the ends
    const T = 0.1;
    const floor = box(L, 0.15, W, matte(0x3a332c, 0.9));
    floor.position.y = 0.075;
    const roof = box(L, T, W, paint);
    roof.position.y = H - T / 2;
    g.add(floor, roof);
    for (const s of [-1, 1]) {
      const wall = box(L, H - 0.15 - T, T, paint);
      wall.position.set(0, 0.15 + (H - 0.15 - T) / 2, s * (W / 2 - T / 2));
      g.add(wall);
      // the doors, swung right back against the sides
      for (const e of [-1, 1]) {
        const door = box(1.2, H - 0.2, 0.06, paint);
        door.position.set(e * (L / 2 + 0.6), H / 2, s * (W / 2 + 0.05));
        g.add(door);
      }
    }
    // crib furniture: something to duck behind in here
    const table = box(2.4, 0.08, 0.8, matte(0xd8d2c4, 0.8));
    table.position.set(0, 0.9, 0);
    g.add(table);
    for (const x of [-1, 1]) {
      const leg = box(0.08, 0.75, 0.7, metal(C.steelDark));
      leg.position.set(x * 1.05, 0.52, 0);
      g.add(leg);
    }
    for (const z of [-0.75, 0.75]) {
      const bench = box(2.4, 0.5, 0.35, matte(0x4a5260, 0.8));
      bench.position.set(0, 0.4, z);
      g.add(bench);
    }
    const urn = cyl(0.18, 0.18, 0.45, metal(0xc9ced6, 0.3, 0.9), 12);
    urn.position.set(0.8, 1.17, 0);
    g.add(detail(urn));
    // a strip light, which is all the light a crib room ever has
    const lamp = box(3.6, 0.05, 0.16, glow(0xfff2d6, 2.4));
    lamp.position.set(0, H - 0.16, 0);
    g.add(detail(lamp));
    g.add(detail(sign('CRIB ROOM', L * 0.3, 1.75, W / 2 + 0.09, 2.2)));
  }
  // corrugation, corner posts and door bars - all for looks
  const ribMat = metal(new THREE.Color(colour).multiplyScalar(0.72).getHex(), 0.7, 0.45);
  for (let x = -L / 2 + 0.35; x < L / 2 - 0.2; x += 0.3) {
    for (const s of [-1, 1]) {
      const rib = box(0.1, H - 0.3, 0.05, ribMat);
      rib.position.set(x, H / 2, s * (W / 2 + 0.02));
      rib.castShadow = false;
      g.add(detail(rib));
    }
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const post = box(0.16, H, 0.16, metal(C.steelDark, 0.6, 0.6));
    post.position.set(x * (L / 2 - 0.06), H / 2, z * (W / 2 - 0.06));
    g.add(detail(post));
  }
  if (!long) {
    for (const z of [-0.8, -0.3, 0.3, 0.8]) {
      const bar = cyl(0.03, 0.03, H - 0.3, metal(C.steelLight), 6);
      bar.position.set(L / 2 + 0.04, H / 2, z);
      g.add(detail(bar));
    }
  }
  return g;
}

/** Stencilled lettering on a panel. */
function sign(text: string, x: number, y: number, z: number, w: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#1d222b';
  g.font = 'bold 72px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  m.position.set(x, y, z);
  return m;
}

/** A staircase of crates up the end of a container: n steps, tallest against it. */
function crates(n: number): THREE.Group {
  const g = new THREE.Group();
  const S = 1.2, H = 0.65;
  const wood = matte(0x8a6a44, 0.85);
  const slat = matte(0x6d5334, 0.9);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n - k; j++) {
      const c = box(S, H, S, wood);
      c.position.set(0.6 + k * S, H / 2 + j * H, 0);
      g.add(c);
      for (const s of [-1, 1]) {
        const band = box(S + 0.02, 0.1, 0.06, slat);
        band.position.set(0.6 + k * S, j * H + H / 2, s * (S / 2 + 0.01));
        g.add(detail(band));
      }
    }
  }
  return g;
}

/** Bulk bags of binder on pallets, a by b. */
export function bags(a: number, b: number): THREE.Group {
  const g = new THREE.Group();
  const bag = matte(0xe8e6de, 0.9);
  const pallet = matte(0x7a5c3a, 0.9);
  const loop = matte(0x3f6fb0, 0.9);
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < b; j++) {
      const x = (i - (a - 1) / 2) * 1.3, z = (j - (b - 1) / 2) * 1.3;
      const p = box(1.1, 0.14, 1.1, pallet);
      p.position.set(x, 0.07, z);
      const s = box(1.0, 1.05, 1.0, bag);
      s.position.set(x, 0.14 + 0.525, z);
      // a slight bulge, so it reads as a bag and not a box
      s.scale.set(1.04, 1, 1.04);
      g.add(p, s);
      for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
        const l = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 4, 8, Math.PI), loop);
        l.position.set(x + dx, 1.19, z + dz);
        l.rotation.y = Math.atan2(dx, dz);
        g.add(detail(l));
      }
    }
  }
  return g;
}

let barrierGeo: THREE.ExtrudeGeometry | null = null;

/** A concrete jersey barrier, 3 m, with a reflector band. */
export function barrier(): THREE.Group {
  const g = new THREE.Group();
  if (!barrierGeo) {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.3, 0.08);
    s.lineTo(0.2, 0.3);
    s.lineTo(0.1, 0.85);
    s.lineTo(-0.1, 0.85);
    s.lineTo(-0.2, 0.3);
    s.lineTo(-0.3, 0.08);
    s.closePath();
    barrierGeo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false });
    barrierGeo.translate(0, 0, -1.5);
    barrierGeo.rotateY(Math.PI / 2);
  }
  const m = new THREE.Mesh(barrierGeo, matte(0x8f949b, 0.95));
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  const tape = new THREE.MeshStandardMaterial({ map: hazard(), roughness: 0.6 });
  for (const s of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.14), tape);
    band.position.set(0, 0.62, s * 0.142);
    band.rotation.set(-s * 0.18, s < 0 ? Math.PI : 0, 0);
    g.add(detail(band));
  }
  return g;
}

/** A stockpile of filter cake off the press: a lumpy low dome you can walk over. */
export function mound(r: number, h: number, seed: number, mat: THREE.Material = matte(C.cake, 0.97)): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    // closed at the top: a profile that stops short of the axis leaves a pinhole in the peak
    pts.push(new THREE.Vector2(r * (1 - u), h * Math.pow(1 - Math.pow(1 - u, 2), 0.9)));
  }
  const geo = new THREE.LatheGeometry(pts, 28);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const rand = rng(seed);
  const bumps = Array.from({ length: 7 }, () => [rand() * Math.PI * 2, rand() * 0.18 + 0.06, 1 + Math.floor(rand() * 4)]);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr < 1e-3 || y < 1e-3) continue;
    const a = Math.atan2(z, x);
    let k = 1;
    for (const [ph, amp, f] of bumps) k += amp * 0.25 * Math.sin(a * f + ph + y * 2.1);
    pos.setXYZ(i, x * k, y * (1 + (k - 1) * 0.5), z * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A cable drum stood on end. */
function drum(): THREE.Group {
  const g = new THREE.Group();
  const wood = matte(0x8a6a44, 0.85);
  const core = cyl(0.62, 0.62, 1.1, matte(0x1c2027, 0.7), 24);
  core.position.y = 0.6;
  g.add(core);
  for (const y of [0.05, 1.15]) {
    const f = cyl(1.0, 1.0, 0.1, wood, 28);
    f.position.y = y;
    g.add(f);
  }
  return g;
}

/** Three lengths of pipe on sleepers. */
function spools(): THREE.Group {
  const g = new THREE.Group();
  const hdpe = matte(0x15181d, 0.55);
  for (const x of [-2.6, 2.6]) {
    const s = box(0.22, 0.2, 2.4, matte(0x6d5334, 0.9));
    s.position.set(x, 0.1, 0);
    g.add(s);
  }
  for (const [y, z] of [[0.65, -0.47], [0.65, 0.47], [1.43, 0]]) {
    const p = cyl(0.45, 0.45, 7, hdpe, 20);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, y, z);
    g.add(p);
    const band = cyl(0.46, 0.46, 0.12, metal(C.amber, 0.5, 0.2), 20);
    band.rotation.z = Math.PI / 2;
    band.position.set(3.2, y, z);
    g.add(detail(band));
  }
  return g;
}

/** Temporary site fence round the bounds: posts, mesh, and a hi-vis shade band. */
function fence(): THREE.Group {
  const g = new THREE.Group();
  const { x0, x1, z0, z1 } = BOUNDS;
  const sides: Array<[THREE.Vector3, THREE.Vector3]> = [
    [V(x0, 0, z0), V(x1, 0, z0)], [V(x1, 0, z0), V(x1, 0, z1)],
    [V(x1, 0, z1), V(x0, 0, z1)], [V(x0, 0, z1), V(x0, 0, z0)],
  ];

  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(200,210,220,0.9)';
  x.lineWidth = 2;
  for (let i = -64; i < 128; i += 16) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke();
    x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke();
  }
  const meshTex = new THREE.CanvasTexture(c);
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
  const wire = (repeat: number) => new THREE.MeshStandardMaterial({
    map: Object.assign(meshTex.clone(), { repeat: new THREE.Vector2(repeat, 2.1 / 1.2) }), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, metalness: 0.6, roughness: 0.5,
  });
  const shade = new THREE.MeshStandardMaterial({
    color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.12, transparent: true, opacity: 0.8,
    side: THREE.DoubleSide, roughness: 0.9,
  });

  let posts = 0;
  const postAt: THREE.Vector3[] = [];
  for (const [a, b] of sides) {
    const len = a.distanceTo(b);
    const mid = a.clone().lerp(b, 0.5);
    const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.1), wire(len / 1.2));
    panel.position.set(mid.x, 1.15, mid.z);
    panel.rotation.y = ang;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.7), shade);
    band.position.set(mid.x, 0.75, mid.z);
    band.rotation.y = ang;
    g.add(detail(panel), detail(band));
    const n = Math.round(len / 3.4);
    for (let i = 0; i < n; i++) postAt.push(a.clone().lerp(b, i / n));
    posts += n;
  }
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 2.3, 0.07), metal(C.steelLight, 0.4, 0.9), posts);
  const foot = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.14, 0.24), matte(0xc9cdd2, 0.9), posts);
  const m = new THREE.Matrix4();
  postAt.forEach((p, i) => {
    post.setMatrixAt(i, m.makeTranslation(p.x, 1.15, p.z));
    foot.setMatrixAt(i, m.makeTranslation(p.x, 0.07, p.z));
  });
  g.add(detail(post), detail(foot));
  return g;
}

function build(p: Prop, i: number): THREE.Object3D {
  switch (p.kind) {
    case 'container': return container(CONTAINER_PAINT[i % CONTAINER_PAINT.length]);
    case 'crib': return container(0x2f5f86, true);
    case 'crates': return crates(p.a ?? 3);
    case 'bags': return bags(p.a ?? 2, p.b ?? 2);
    case 'barrier': return barrier();
    case 'mound': return mound(p.a ?? 3, p.b ?? 1.2, 100 + i);
    case 'drum': return drum();
    case 'spools': return spools();
  }
}

/** Everything static the arena adds to the pad. Goes into the world before the collision world is built. */
export function buildProps(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'arena-props';
  PROPS.forEach((p, i) => {
    const o = build(p, i);
    o.position.set(p.x, 0, p.z);
    o.rotation.y = p.rot ?? 0;
    g.add(o);
  });
  g.add(fence());
  return g;
}

// ------------------------------------------------------------------ pickups

/**
 * Filter cake and rock lying on the floor, each over a lit ring so it can be
 * found from across the pad. None of it collides - you walk into it to take it.
 */
export class Pickups {
  group = new THREE.Group();
  private items: Array<{ pile: THREE.Group; ring: THREE.Mesh; beam: THREE.Mesh; up: boolean; y: number }> = [];

  constructor(list: Pickup[] = PICKUPS) {
    this.group.userData.noCollide = true;
    const rand = rng(7);
    const cake = matte(C.cake, 0.95);
    const rock = matte(0x7d8793, 0.9);
    const ringCake = new THREE.MeshBasicMaterial({ color: 0xffab3d, transparent: true, opacity: 0.85, depthWrite: false });
    const ringRock = new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.85, depthWrite: false });
    const beamMat = (c: number) => new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beams = { cake: beamMat(0xffab3d), rock: beamMat(0x8fd3ff) };

    for (const p of list) {
      const holder = new THREE.Group();
      holder.position.set(p.x, p.y, p.z);
      const pile = new THREE.Group();
      const n = p.kind === 'cake' ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand();
        const m = p.kind === 'cake'
          ? new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.42), cake)
          : new THREE.Mesh(new THREE.DodecahedronGeometry(0.13 + rand() * 0.05), rock);
        m.position.set(Math.cos(a) * 0.2, 0.08 + (i === n - 1 ? 0.1 : 0), Math.sin(a) * 0.2);
        m.rotation.set(rand() * 0.4, rand() * 3, rand() * 0.4);
        m.castShadow = true;
        pile.add(m);
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 32), p.kind === 'cake' ? ringCake : ringRock);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 3.2, 16, 1, true), beams[p.kind]);
      beam.position.y = 1.6;
      holder.add(pile, ring, beam);
      this.group.add(holder);
      this.items.push({ pile, ring, beam, up: true, y: 0 });
    }
  }

  set(i: number, up: boolean) {
    const it = this.items[i];
    if (!it) return;
    it.up = up;
    it.pile.visible = up;
    it.beam.visible = up;
    it.ring.scale.setScalar(up ? 1 : 0.6);
  }

  setAll(up: number[]) {
    const on = new Set(up);
    this.items.forEach((_, i) => this.set(i, on.has(i)));
  }

  update(t: number) {
    this.items.forEach((it, i) => {
      if (!it.up) return;
      it.pile.rotation.y = t * 0.6 + i;
      it.pile.position.y = 0.05 + Math.sin(t * 2 + i) * 0.04;
    });
  }
}
