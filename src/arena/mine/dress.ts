import * as THREE from 'three';
import { C, metal, matte, glow } from '../../view/palette';
import { box, cyl, hazard, COLLIDER } from '../../view/parts';
import { rng } from '../../view/worlds/common';
import { bags, barrier, mound } from '../props';
import { SHAPES, PROPS, RAILS, BASES, type Drive, type MineProp, type P2, type Base } from '../shared/mine';
import { TEAMS, hex } from '../shared/rules';
import type { Field } from './level';
import type { Lamp } from './light';
import type { Kit } from './kit';

/**
 * Everything in the 760 Level that is not rock: the lights, the vent bag
 * and the cables hung along the drives, the rails and the paste line, the
 * machines parked about, and each crew's fill point and stope brow.
 *
 * Most of it is placed against the rock, so it asks the level's field where
 * the back and the walls actually are rather than trusting the drive's
 * nominal size - blasted rock is never where the plan says it is. Only the
 * machines, the stacks and the barricades collide; everything hung up is
 * out of reach and marked noCollide.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);

const detail = <T extends THREE.Object3D>(o: T): T => {
  o.userData.noCollide = true;
  return o;
};

/** the back above (x, z): the first rock going up from head height */
export function backAt(f: Field, x: number, z: number, from = 1.8) {
  for (let y = from; y < 14; y += 0.05) if (f.at(x, y, z) >= 0) return y;
  return 14;
}

/** how far it is to the rock from (x, y, z), going along (dx, dz) */
export function wallAt(f: Field, x: number, y: number, z: number, dx: number, dz: number, max = 9) {
  for (let d = 0; d < max; d += 0.04) if (f.at(x + dx * d, y, z + dz * d) >= 0) return d;
  return max;
}

interface Station { x: number; z: number; tx: number; tz: number; lx: number; lz: number }

/** Points every `step` metres down a centreline, with the way along it and the way to its left. */
function stations(pts: P2[], step: number, from = step / 2): Station[] {
  const out: Station[] = [];
  let acc = 0, next = from;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    while (next <= acc + len) {
      const u = next - acc;
      out.push({ x: ax + tx * u, z: az + tz * u, tx, tz, lx: tz, lz: -tx });
      next += step;
    }
    acc += len;
  }
  return out;
}

/** a cylinder from a to b */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, segs = 8): THREE.Mesh {
  const d = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), segs, 1, true), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y, d.normalize());
  return m;
}

/** which way a thing lies when its length should run along (tx, tz) */
const along = (tx: number, tz: number) => Math.atan2(-tz, tx);

const drives = () => SHAPES.filter((s): s is Drive => s.k === 'drive');

// ------------------------------------------------------------------ paint and lettering

/** Letters on a panel, or painted straight on the rock (no panel). */
export function lettering(lines: string[], w: number, opts: { ink?: string; panel?: string; bold?: boolean } = {}): THREE.Mesh {
  const c = document.createElement('canvas');
  const H = 128 * lines.length;
  c.width = 512; c.height = H;
  const g = c.getContext('2d')!;
  if (opts.panel) {
    g.fillStyle = opts.panel;
    g.fillRect(0, 0, 512, H);
  }
  g.fillStyle = opts.ink ?? '#1d222b';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    let size = 78;
    g.font = `${opts.bold === false ? 600 : 800} ${size}px "Segoe UI", system-ui, sans-serif`;
    while (g.measureText(l).width > 480 && size > 30) {
      size -= 4;
      g.font = `${opts.bold === false ? 600 : 800} ${size}px "Segoe UI", system-ui, sans-serif`;
    }
    g.fillText(l, 256, 128 * i + 68);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.85, transparent: !opts.panel, depthWrite: !!opts.panel,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return detail(new THREE.Mesh(new THREE.PlaneGeometry(w, (w * H) / 512), mat));
}

/** Put a flat thing on the rock, looking out of it: from (x, z) at height y, find the wall along (dx, dz). */
function onWall(f: Field, o: THREE.Object3D, x: number, y: number, z: number, dx: number, dz: number, off = 0.14) {
  const d = wallAt(f, x, y, z, dx, dz);
  o.position.set(x + dx * (d - off), y, z + dz * (d - off));
  o.rotation.y = Math.atan2(-dx, -dz);
  return o;
}

// ------------------------------------------------------------------ lamps

const FLUORO = glow(0xfff0d8, 3.2);
const FLOOD = glow(0xfff2dc, 4);

function fixture(tx: number, tz: number, drop: number): THREE.Group {
  const g = detail(new THREE.Group());
  const housing = box(1.35, 0.06, 0.17, metal(C.steelLight, 0.5, 0.7));
  housing.position.y = 0.05;
  const tube = box(1.24, 0.06, 0.07, FLUORO);
  for (const s of [-0.5, 0.5]) {
    const chain = box(0.02, drop, 0.02, metal(C.steelDark));
    chain.position.set(s, 0.08 + drop / 2, 0);
    g.add(chain);
  }
  g.add(housing, tube);
  g.rotation.y = along(tx, tz);
  return g;
}

/**
 * A strip light every eleven metres down every drive, a couple in each
 * chamber, and a flood into each stope. Returns the lamps, for the bake.
 */
function lamps(f: Field, out: THREE.Group): Lamp[] {
  const list: Lamp[] = [];
  const warm = new THREE.Color(0xfff0d8), cool = new THREE.Color(0xe6eeff);
  const put = (x: number, z: number, tx: number, tz: number, i = 1.25, col = warm) => {
    if (list.some((l) => Math.hypot(l.p.x - x, l.p.z - z) < 6)) return;
    const back = backAt(f, x, z);
    const y = Math.min(back - 0.32, 5.2);
    list.push({ p: V(x, y - 0.1, z), col, i, r: 17 });
    const fx = fixture(tx, tz, back - y);
    fx.position.set(x, y, z);
    out.add(fx);
  };
  for (const d of drives()) {
    const len = d.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - d.pts[i][0], p[1] - d.pts[i][1]), 0);
    const step = d.tag === 'cuddy' ? Math.max(5, len - 3) : 11;
    for (const s of stations(d.pts, step, d.tag === 'cuddy' ? len - 3 : 4.5)) {
      put(s.x + s.lx * 0.5, s.z + s.lz * 0.5, s.tx, s.tz, d.tag === 'main' ? 1.3 : 1.15, d.tag === 'lane' ? cool : warm);
    }
  }
  for (const s of SHAPES) {
    if (s.k !== 'room') continue;
    const c = Math.cos(s.rot), n = Math.sin(s.rot);
    const k = s.hx > 6 ? [-0.5, 0.5] : [0];
    for (const u of k) put(s.x + c * s.hx * u, s.z + n * s.hx * u, c, n, 1.35);
  }
  // each stope gets a flood from just inside the brow, down onto the hanging wall
  for (const b of BASES) {
    const x = b.brow[0] + b.into[0] * 2.5, z = b.brow[1] + b.into[1] * 2.5;
    list.push({ p: V(x, 5.5, z), col: new THREE.Color(0xfff2dc), i: 2.4, r: 30 });
    const flood = new THREE.Group();
    const head = box(0.5, 0.35, 0.3, metal(0x2b3038, 0.5, 0.6));
    const lens = box(0.44, 0.28, 0.02, FLOOD);
    lens.position.z = 0.16;
    flood.add(head, lens);
    flood.position.set(b.brow[0] - b.into[0] * 0.6, backAt(f, b.brow[0] - b.into[0] * 0.6, b.brow[1] - b.into[1] * 0.6) - 0.3, b.brow[1] - b.into[1] * 0.6);
    flood.rotation.set(0.5, Math.atan2(b.into[0], b.into[1]), 0, 'YXZ');
    out.add(detail(flood));
  }
  // each fill point: a lamp over the barrow, and the crew's colour on the wall
  BASES.forEach((b, t) => {
    list.push({ p: V(b.home[0], 3.4, b.home[2]), col: new THREE.Color(0xffe8c8), i: 1.3, r: 14 });
    list.push({ p: V(b.home[0] + (t ? -1.5 : 1.5), 2.6, b.home[2]), col: new THREE.Color(TEAMS[t].col), i: 0.9, r: 12 });
  });
  return list;
}

// ------------------------------------------------------------------ hung along the drives

/** Yellow vent bag down the main drive and the lanes, hung off the back on the right. */
function ducts(f: Field, out: THREE.Group) {
  const bag = matte(0xcfa92a, 0.8);
  const hoop = matte(0x8c7424, 0.8);
  for (const d of drives()) {
    if (d.tag !== 'main' && d.tag !== 'lane') continue;
    const st = stations(d.pts, 2.4, 1.5);
    const pts = st.map((s) => {
      const x = s.x - s.lx * (d.w - 1.05), z = s.z - s.lz * (d.w - 1.05);
      return V(x, Math.min(backAt(f, x, z) - 0.62, 4.4), z);
    });
    for (let i = 0; i + 1 < pts.length; i++) {
      out.add(detail(rod(pts[i], pts[i + 1], 0.42, bag, 10)));
      out.add(detail(rod(pts[i].clone().lerp(pts[i + 1], 0.48), pts[i].clone().lerp(pts[i + 1], 0.52), 0.44, hoop, 10)));
    }
  }
}

/** A bundle of power cable on hooks down the left wall, sagging between them. */
function cables(f: Field, out: THREE.Group) {
  const rubber = matte(0x121417, 0.6);
  const hookMat = metal(C.steelLight, 0.5, 0.8);
  for (const d of drives()) {
    if (d.tag !== 'main' && d.tag !== 'lane') continue;
    const hooks = stations(d.pts, 4, 1).map((s) => {
      const w = wallAt(f, s.x, 2.7, s.z, s.lx, s.lz);
      return V(s.x + s.lx * (w - 0.14), 2.7, s.z + s.lz * (w - 0.14));
    });
    for (let i = 0; i + 1 < hooks.length; i++) {
      const a = hooks[i], b = hooks[i + 1];
      if (a.distanceTo(b) > 6) continue;
      let prev = a;
      for (let k = 1; k <= 5; k++) {
        const t = k / 5;
        const p = a.clone().lerp(b, t);
        p.y -= 0.22 * 4 * t * (1 - t);
        out.add(detail(rod(prev, p, 0.04, rubber, 5)));
        prev = p;
      }
      const hook = box(0.04, 0.16, 0.04, hookMat);
      hook.position.copy(a).add(V(0, 0.07, 0));
      out.add(detail(hook));
    }
  }
}

/** Rails down the main drive, on sleepers. */
function rails(out: THREE.Group) {
  const steel = metal(0x6a6660, 0.45, 0.85);
  const wood = matte(0x3b2e22, 0.9);
  for (let i = 0; i + 1 < RAILS.length; i++) {
    const [ax, az] = RAILS[i], [bx, bz] = RAILS[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    for (const s of [-0.3, 0.3]) {
      const r = box(len + 0.3, 0.09, 0.06, steel);
      r.position.set((ax + bx) / 2 + tz * s, 0.13, (az + bz) / 2 - tx * s);
      r.rotation.y = along(tx, tz);
      out.add(detail(r));
    }
    for (let u = 0.3; u < len; u += 0.8) {
      const sl = box(0.2, 0.08, 1.1, wood);
      sl.position.set(ax + tx * u, 0.04, az + tz * u);
      sl.rotation.y = along(tx, tz);
      out.add(detail(sl));
    }
  }
}

/** The paste line: steel pipe on brackets down the main drive, fill point to fill point. */
function pasteLine(f: Field, out: THREE.Group) {
  const pipe = metal(0x77818d, 0.45, 0.8);
  const band = matte(C.paste, 0.6);
  const main = drives().find((d) => d.tag === 'main')!;
  const pts = stations(main.pts, 5, 1).map((s) => {
    const w = wallAt(f, s.x, 2.1, s.z, -s.lx, -s.lz);
    return V(s.x - s.lx * (w - 0.3), 2.1, s.z - s.lz * (w - 0.3));
  });
  for (let i = 0; i + 1 < pts.length; i++) {
    out.add(detail(rod(pts[i], pts[i + 1], 0.09, pipe, 10)));
    out.add(detail(rod(pts[i].clone().lerp(pts[i + 1], 0.5), pts[i].clone().lerp(pts[i + 1], 0.56), 0.095, band, 10)));
    const fl = rod(pts[i].clone().lerp(pts[i + 1], -0.01), pts[i].clone().lerp(pts[i + 1], 0.01), 0.14, pipe, 10);
    out.add(detail(fl));
  }
}

/** Rock bolt plates in the back, in rows, every so often. */
function bolts(f: Field, out: THREE.Group) {
  const plate = metal(0x8a8f96, 0.6, 0.6);
  const geo = new THREE.PlaneGeometry(0.17, 0.17).rotateX(Math.PI / 2);
  for (const d of drives()) {
    for (const s of stations(d.pts, 2.2, 1.1)) {
      for (const u of [-0.55, 0, 0.55]) {
        const x = s.x + s.lx * u * d.w, z = s.z + s.lz * u * d.w;
        const y = backAt(f, x, z);
        if (y > 6) continue;
        const m = new THREE.Mesh(geo, plate);
        m.position.set(x, y - 0.03, z);
        m.rotation.y = along(s.tx, s.tz);
        out.add(detail(m));
      }
    }
  }
}

// ------------------------------------------------------------------ machines and stacks

const YELLOW = () => metal(0xd9a21b, 0.55, 0.35);

/** a side-tipper mine car, length along local x */
function car(seed: number): THREE.Group {
  const g = new THREE.Group();
  const paint = matte([0x8e5327, 0x6d4a2c, 0x7a3f22][seed % 3], 0.8);
  const chassis = box(2.1, 0.25, 0.95, metal(C.steelDark, 0.6, 0.6));
  chassis.position.y = 0.36;
  const bucket = box(2.3, 0.85, 1.25, paint);
  bucket.position.y = 0.92;
  const lip = box(2.36, 0.07, 1.31, matte(0x3a2a1e, 0.8));
  lip.position.y = 1.36;
  const muck = box(2.15, 0.1, 1.1, matte(0x4b4540, 0.95));
  muck.position.y = 1.3;
  g.add(chassis, bucket, detail(lip), detail(muck));
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.3, 0.3]) {
      const w = cyl(0.21, 0.21, 0.08, metal(0x2a2c30, 0.5, 0.8), 12);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.21, z);
      g.add(detail(w));
    }
  }
  return g;
}

/** an underground loader: bucket, front frame, the pin, the engine end, and the cab on the side */
function loader(): THREE.Group {
  const g = new THREE.Group();
  const y = YELLOW();
  const dark = metal(0x23262b, 0.6, 0.5);
  const bucket = box(1.7, 1.15, 2.9, metal(0x5d5a55, 0.7, 0.6));
  bucket.position.set(4.1, 0.7, 0);
  bucket.rotation.z = -0.12;
  const front = box(2.8, 1.25, 2.3, y);
  front.position.set(2.0, 1.25, 0);
  const pin = cyl(0.35, 0.35, 1.2, dark, 12);
  pin.position.set(0.35, 1.2, 0);
  const rear = box(4.0, 1.6, 2.5, y);
  rear.position.set(-1.9, 1.4, 0);
  const hood = box(2.4, 0.5, 2.1, y);
  hood.position.set(-2.4, 2.45, 0);
  const cab = box(1.6, 1.25, 1.0, y);
  cab.position.set(0.1, 2.5, -0.85);
  const glass = box(1.62, 0.6, 1.02, matte(0x0b0e12, 0.2));
  glass.position.set(0.1, 2.72, -0.85);
  g.add(bucket, front, pin, rear, hood, cab, detail(glass));
  for (const x of [2.2, -2.3]) {
    for (const z of [-1.3, 1.3]) {
      const w = cyl(0.82, 0.82, 0.62, matte(0x16181b, 0.7), 18);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.82, z);
      g.add(w);
    }
  }
  for (const z of [-0.8, 0.8]) {
    const lamp = box(0.08, 0.16, 0.25, glow(0xfff4d8, 2.5));
    lamp.position.set(3.35, 2.0, z);
    g.add(detail(lamp));
  }
  const beacon = cyl(0.09, 0.09, 0.14, glow(0xffa928, 3), 10);
  beacon.position.set(-2.4, 2.8, 0.7);
  g.add(detail(beacon));
  return g;
}

/** a two-boom development jumbo */
function jumbo(): THREE.Group {
  const g = new THREE.Group();
  const y = YELLOW();
  const body = box(4.6, 1.3, 2.1, y);
  body.position.set(-0.6, 1.15, 0);
  const cab = box(1.4, 1.3, 1.5, y);
  cab.position.set(-2.1, 2.35, 0.2);
  const glass = box(1.42, 0.55, 1.52, matte(0x0b0e12, 0.2));
  glass.position.set(-2.1, 2.55, 0.2);
  g.add(body, cab, detail(glass));
  for (const z of [-0.55, 0.55]) {
    const boom = box(3.4, 0.22, 0.22, y);
    boom.position.set(3.0, 1.7, z);
    boom.rotation.z = 0.12;
    const feed = box(3.2, 0.14, 0.18, metal(0x9aa2ac, 0.4, 0.8));
    feed.position.set(4.6, 2.05, z * 1.3);
    g.add(detail(boom), detail(feed));
  }
  for (const x of [1.0, -2.0]) {
    for (const z of [-1.05, 1.05]) {
      const w = cyl(0.55, 0.55, 0.45, matte(0x16181b, 0.7), 16);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.55, z);
      g.add(w);
    }
  }
  return g;
}

function refuge(): THREE.Group {
  const g = new THREE.Group();
  const shell = box(6, 2.5, 2.4, metal(0xdfe3dc, 0.55, 0.3));
  shell.position.y = 1.35;
  const skid = box(6.2, 0.2, 2.5, metal(C.steelDark));
  skid.position.y = 0.1;
  const stripe = box(6.02, 0.25, 2.42, matte(0x2f9a4a, 0.6));
  stripe.position.y = 2.2;
  const door = box(0.05, 1.8, 0.9, metal(0xb8beb6, 0.5, 0.4));
  door.position.set(3.02, 1.2, 0);
  const strobe = cyl(0.1, 0.1, 0.16, glow(0x4be38a, 3.5), 10);
  strobe.position.set(2.4, 2.7, 0);
  const label = lettering(['REFUGE', 'CHAMBER'], 1.9, { panel: '#2f9a4a', ink: '#f4f7f2' });
  label.position.set(0, 1.4, 1.215);
  const back = label.clone();
  back.position.z = -1.215;
  back.rotation.y = Math.PI;
  g.add(shell, skid, detail(stripe), detail(door), detail(strobe), label, back);
  return g;
}

function drums(seed: number): THREE.Group {
  const g = new THREE.Group();
  const cols = [0x2d5f9a, 0xa33a2a, 0x3f6b3a, 0xd0a020];
  const r = rng(seed);
  const spots: Array<[number, number]> = [[0, 0], [0.62, 0.1], [0.28, 0.58]];
  spots.forEach(([x, z], i) => {
    const d = cyl(0.29, 0.29, 0.88, metal(cols[(seed + i) % 4], 0.6, 0.4), 16);
    d.position.set(x, 0.44, z);
    d.rotation.y = r() * 3;
    g.add(d);
  });
  const lying = cyl(0.29, 0.29, 0.88, metal(cols[(seed + 3) % 4], 0.6, 0.4), 16);
  lying.rotation.z = Math.PI / 2;
  lying.position.set(-0.2, 0.29, -0.75);
  g.add(lying);
  return g;
}

function timber(): THREE.Group {
  const g = new THREE.Group();
  const wood = matte(0x8f6c44, 0.9);
  const end = matte(0xb08a5a, 0.85);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const b = box(3.6, 0.2, 0.2, wood);
      b.position.set(0, 0.1 + row * 0.21, (i - 2) * 0.21);
      g.add(b);
    }
  }
  for (const s of [-1, 1]) {
    const face = box(0.02, 0.62, 1.04, end);
    face.position.set(s * 1.81, 0.32, 0);
    g.add(detail(face));
    const strap = box(0.05, 0.66, 1.08, metal(0x3a3d42));
    strap.position.set(s * 1.1, 0.32, 0);
    g.add(detail(strap));
  }
  return g;
}

function fan(): THREE.Group {
  const g = new THREE.Group();
  const body = cyl(0.62, 0.62, 2.6, metal(0x9aa0a8, 0.5, 0.7), 20);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.95;
  const motor = cyl(0.4, 0.4, 0.9, metal(0x2d5f9a, 0.5, 0.5), 16);
  motor.rotation.z = Math.PI / 2;
  motor.position.set(-1.5, 0.95, 0);
  const grille = cyl(0.6, 0.6, 0.04, metal(0x3a3d42, 0.6, 0.7), 20);
  grille.rotation.z = Math.PI / 2;
  grille.position.set(1.32, 0.95, 0);
  for (const x of [-0.9, 0.9]) {
    const skid = box(0.25, 0.32, 1.3, metal(C.steelDark));
    skid.position.set(x, 0.16, 0);
    g.add(skid);
  }
  g.add(body, motor, detail(grille));
  return g;
}

function bench(): THREE.Group {
  const g = new THREE.Group();
  const top = box(2.0, 0.08, 0.8, matte(0x5a4a38, 0.8));
  top.position.y = 0.9;
  const frame = box(1.9, 0.75, 0.7, metal(0x3b4a5c, 0.6, 0.5));
  frame.position.y = 0.46;
  const vice = box(0.25, 0.2, 0.3, metal(0x2d5f9a, 0.5, 0.6));
  vice.position.set(0.7, 1.04, 0.1);
  g.add(top, frame, detail(vice));
  return g;
}

function prop(p: MineProp, i: number): THREE.Object3D {
  switch (p.kind) {
    case 'car': return car(i);
    case 'loader': return loader();
    case 'jumbo': return jumbo();
    case 'refuge': return refuge();
    case 'muck': return mound(p.a ?? 2, p.b ?? 1, 300 + i, matte(0x5e5850, 0.97));
    case 'barrier': return barrier();
    case 'drums': return drums(i);
    case 'timber': return timber();
    case 'bags': return bags(p.a ?? 2, p.b ?? 1);
    case 'fan': return fan();
    case 'bench': return bench();
  }
}

// ------------------------------------------------------------------ the crews' ends

/** The fill point: the paste line down its borehole, a valve, a hose, and a pad for the barrow. */
function fillPoint(f: Field, b: Base, team: number, out: THREE.Group) {
  const [x, , z] = b.home;
  const steel = metal(0x77818d, 0.45, 0.8);
  const dir = V(Math.cos(b.homeYaw + Math.PI / 2), 0, -Math.sin(b.homeYaw + Math.PI / 2));
  // the borehole collar is just behind where the barrow stands
  const px = x - dir.x * 0.9, pz = z - dir.z * 0.9;
  const back = backAt(f, px, pz);
  out.add(detail(rod(V(px, back + 0.3, pz), V(px, 2.3, pz), 0.12, steel, 12)));
  const collar = cyl(0.26, 0.26, 0.25, metal(0x4a5260, 0.6, 0.6), 14);
  collar.position.set(px, back - 0.05, pz);
  const valve = box(0.34, 0.3, 0.34, metal(0x2d5f9a, 0.5, 0.5));
  valve.position.set(px, 2.25, pz);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16), metal(0xc9302c, 0.5, 0.5));
  wheel.position.set(px, 2.25, pz);
  wheel.position.addScaledVector(V(dir.z, 0, -dir.x), 0.24);
  wheel.lookAt(wheel.position.clone().add(V(dir.z, 0, -dir.x)));
  out.add(detail(collar), detail(valve), detail(wheel));
  // the hose, down and over the tray
  const curve = new THREE.QuadraticBezierCurve3(V(px, 2.1, pz), V(px, 1.2, pz), V(x - dir.x * 0.1, 1.25, z - dir.z * 0.1));
  out.add(detail(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.07, 8), matte(0x15181c, 0.6))));
  const pad = box(2.6, 0.04, 2.6, metal(0x3a3f46, 0.8, 0.5));
  pad.position.set(x, 0.02, z);
  pad.rotation.y = b.homeYaw;
  out.add(detail(pad));
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.3, 40), glow(TEAMS[team].col, 1.4));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.045, z);
  out.add(detail(ring));
  const name = TEAMS[team].short;
  const sign = lettering([`${name} FILL POINT`], 2.2, { panel: hex(TEAMS[team].col), ink: '#12161c' });
  onWall(f, sign, x, 2.0, z, -dir.x, -dir.z);
  out.add(sign);
}

/** The brow of a stope: a barricade across the drive, and the signs that say why. */
function brow(f: Field, b: Base, team: number, out: THREE.Group) {
  const [ix, iz] = b.into;
  // across the drive, and how far it is to each wall from the middle
  const ax = iz, az = -ix;
  const cx = b.brow[0] - ix * 0.9, cz = b.brow[1] - iz * 0.9;
  const wl = wallAt(f, cx, 1.2, cz, ax, az), wr = wallAt(f, cx, 1.2, cz, -ax, -az);
  const width = wl + wr;
  const mx = cx + ax * (wl - wr) / 2, mz = cz + az * (wl - wr) / 2;
  const g = new THREE.Group();
  g.position.set(mx, 0, mz);
  g.rotation.y = along(ax, az);
  const post = metal(0xe0b830, 0.5, 0.5);
  const n = Math.max(2, Math.round(width / 1.3));
  for (let i = 0; i <= n; i++) {
    const p = box(0.08, 2.3, 0.08, post);
    p.position.set(-width / 2 + (i / n) * width, 1.15, 0);
    g.add(detail(p));
  }
  for (const y of [1.1, 2.25]) {
    const rail = box(width, 0.07, 0.07, post);
    rail.position.y = y;
    g.add(detail(rail));
  }
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(210,215,222,0.95)';
  x.lineWidth = 2.5;
  for (let i = -64; i < 128; i += 12) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke();
    x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke();
  }
  const meshTex = new THREE.CanvasTexture(c);
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
  meshTex.repeat.set(width / 0.9, 2.2 / 0.9);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, 2.2), new THREE.MeshStandardMaterial({
    map: meshTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5,
  }));
  panel.position.y = 1.15;
  g.add(detail(panel));
  const band = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.22), new THREE.MeshStandardMaterial({ map: hazard(), roughness: 0.6, side: THREE.DoubleSide }));
  band.position.set(0, 0.35, 0.05);
  g.add(detail(band));
  const danger = lettering(['DANGER', 'OPEN STOPE'], 1.3, { panel: '#f2efe6', ink: '#b3261e' });
  danger.position.set(0, 1.65, -0.06);
  danger.rotation.y = Math.PI;
  g.add(danger);
  // what actually stops you: a wall of nothing, taller than anyone can jump
  const stop = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 3.2, 0.3), COLLIDER);
  stop.position.y = 1.6;
  stop.userData.collider = true;
  g.add(stop);
  out.add(g);
  const tag = lettering([`${TEAMS[team].short} STOPE`], 2.4, { ink: hex(TEAMS[team].col) });
  onWall(f, tag, b.brow[0] - ix * 3.5, 2.6, b.brow[1] - iz * 3.5, ax, az);
  out.add(tag);
}

/** yellow paint on the rock: the level, and which way to go */
function markings(f: Field, out: THREE.Group) {
  const paint = '#e8c23a';
  const main = drives().find((d) => d.tag === 'main')!;
  const st = stations(main.pts, 22, 8);
  st.forEach((s, i) => {
    const west = s.x < 0;
    const label = lettering(i % 2 ? ['760 L'] : [west ? 'DAY  <' : '>  NIGHT'], 1.1, { ink: paint });
    const side = i % 2 ? 1 : -1;
    onWall(f, label, s.x, 1.9, s.z, s.lx * side, s.lz * side, 0.2);
    out.add(label);
  });
}

/** Standing water where the floor dips: a few dark, glossy patches. */
function puddles(f: Field, out: THREE.Group) {
  const r = rng(760);
  // wet mud, a shade darker than the floor and with a shine the cap lamp catches
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 0.22, metalness: 0 });
  let n = 0;
  for (let tries = 0; tries < 600 && n < 22; tries++) {
    const x = -78 + r() * 156, z = -44 + r() * 88, rad = 0.8 + r() * 1.6;
    let ok = true;
    for (let a = 0; a < 8 && ok; a++) {
      const px = x + Math.cos(a * 0.785) * (rad + 0.3), pz = z + Math.sin(a * 0.785) * (rad + 0.3);
      if (f.at(px, 0.4, pz) > -0.25 || f.at(px, -0.3, pz) < 0) ok = false;
    }
    if (!ok) continue;
    const geo = new THREE.CircleGeometry(rad, 18);
    const pos = geo.getAttribute('position');
    for (let i = 1; i < pos.count; i++) {
      const k = 0.7 + r() * 0.45;
      pos.setXY(i, pos.getX(i) * k, pos.getY(i) * (0.6 + r() * 0.3) * k);
    }
    const m = new THREE.Mesh(geo, mat);
    m.rotation.set(-Math.PI / 2, 0, r() * 6.28);
    m.position.set(x, 0.012, z);
    out.add(detail(m));
    n++;
  }
}

// ------------------------------------------------------------------ all of it

export interface Dressed {
  /** static, into the kit */
  fixed: THREE.Group;
  lamps: Lamp[];
  /**
   * The paint of everything that shines off the mains - the strip lights and
   * the stope floods - to go out in a power cut. The beacons, the refuge
   * chamber's strobe and the loader's lights are on batteries.
   */
  mains: Set<THREE.Material>;
}

export function dress(f: Field, kit: Kit): Dressed {
  const fixed = new THREE.Group();
  const lampList = lamps(f, fixed);
  ducts(f, fixed);
  cables(f, fixed);
  rails(fixed);
  pasteLine(f, fixed);
  bolts(f, fixed);
  markings(f, fixed);
  puddles(f, fixed);
  PROPS.forEach((p, i) => {
    const o = prop(p, i);
    o.position.set(p.x, 0, p.z);
    o.rotation.y = p.rot ?? 0;
    fixed.add(o);
  });
  BASES.forEach((b, t) => {
    fillPoint(f, b, t, fixed);
    brow(f, b, t, fixed);
  });
  kit.take(fixed);
  return { fixed, lamps: lampList, mains: new Set([FLUORO, FLOOD]) };
}
