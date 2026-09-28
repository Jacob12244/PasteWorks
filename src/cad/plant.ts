import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { TriangleGrid } from '../view/grid';
import type { Look } from '../scenario';
import { MODEL } from '../arena/shared/cad';

/**
 * A real plant, converted from CAD by cad/convert.py and cad/optimize.mjs:
 * loaded, dressed in the page's materials, and turned into something to walk
 * on. The ?cad test bench and the Paste Wars map both start here.
 *
 * The model is local only (public/local/, excluded from git).
 */

export const PLANT_URL = MODEL;

/**
 * The glTF carries a part class in each material name and the CAD colour in
 * its base colour. The CAD whites say nothing, so equipment is painted by
 * what the unit is - the way a real plant is painted.
 */
const EQUIP_PAINT: Array<[RegExp, number]> = [
  [/crane/, 0xd9a21b],
  [/pump/, 0xb5602b],
  [/silo|hopper|tanker/, 0xd6dade],
  [/thickener/, 0x8f989f],
  [/filter_vacuum|filtrate|vacuum/, 0x46627e],
  [/tank/, 0xc3c9ce],
  [/mixer|scale|diverter/, 0x6c7580],
  [/conveyor/, 0x3e4852],
  [/building|control_room|welfare|bridge/, 0xa9afb5],
  [/electrical|generator|compressed|blower|receiver|dryer|power_pack/, 0x6f7d66],
  [/person/, 0xff8a1f],
];

function paintFor(unit: string): number {
  for (const [re, c] of EQUIP_PAINT) if (re.test(unit)) return c;
  return 0xb3bac1;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();
function mat(key: string, make: () => THREE.MeshStandardMaterial) {
  let m = cache.get(key);
  if (!m) { m = make(); cache.set(key, m); }
  return m;
}

/**
 * CAD layer colours are codes, not paint: pure cyan, green and red. Keep the
 * hue, which usually means something, and pull it back to something a paint
 * shop would sell.
 */
function tame(hex: number): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.5), THREE.MathUtils.clamp(hsl.l, 0.16, 0.5));
  return c.getHex();
}

const std = (color: number, roughness: number, metalness: number) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });

/** The page's material for one glTF material on one unit. */
function realMaterial(src: THREE.MeshStandardMaterial, unit: string): THREE.MeshStandardMaterial {
  const cls = src.name.split('_')[0];
  const cad = src.color.getHex();
  switch (cls) {
    case 'handrail': return mat('handrail', () => std(0xe0b21e, 0.5, 0.1));
    case 'grating': return mat('grating', () => std(0x7d858c, 0.6, 0.5));
    case 'steel': return mat('steel', () => std(0x56616e, 0.6, 0.2));
    case 'concrete': return mat('concrete', () => std(0x8c8b86, 0.95, 0));
    case 'person': return mat('person', () => std(0xff8a1f, 0.7, 0));
    case 'cladding': return mat('cladding', () => std(0x9ea7ae, 0.55, 0.3));
    case 'pipe': {
      // pipework keeps its CAD colour when someone chose one - it is usually
      // the service colour - and is plain light grey when they did not
      const c = src.color;
      const white = Math.min(c.r, c.g, c.b) > 0.7;
      const hex = white ? 0xb9bfc5 : tame(cad);
      return mat('pipe' + hex, () => std(hex, 0.45, 0.1));
    }
    case 'paint': {
      const hex = tame(cad);
      return mat('paint' + hex, () => std(hex, 0.55, 0.05));
    }
    default: {
      // bare galvanised plate on the vessels: it is what catches the sky
      if (/silo|hopper|thickener|tank(?!er)/.test(unit)) {
        return mat('galv', () => std(0xc4c9ce, 0.38, 0.75));
      }
      const hex = paintFor(unit);
      return mat('equip' + hex, () => std(hex, 0.5, 0.1));
    }
  }
}

/**
 * The PasteWorks looks are tuned for its own dark, emissive plant. Real paint
 * is far lighter, so both looks here drop the pool lights - they were placed
 * over the code-built units - and only let genuinely bright things bloom.
 */
export function looks(base: Look): Record<'dusk' | 'day', Look> {
  return {
    dusk: { ...base, pools: 0, exposure: 0.8, bloom: [0.35, 0.5, 1.0], env: 0.5 },
    day: {
      ...base,
      sky: [0x3f6fae, 0x9fbcd9, 0x8a8478],
      fog: { color: 0xaebfd0, near: 220, far: 1100 },
      hemi: { sky: 0xc4dafa, ground: 0x5b5044, intensity: 1.1 },
      key: { color: 0xfff1dc, intensity: 3.2 },
      fill: 0.35, rim: 0.15, pools: 0,
      exposure: 0.7, bloom: [0.12, 0.4, 1.4], env: 0.9,
    },
  };
}

/**
 * The stage's sun sits behind its default camera, which hides every shadow
 * behind the thing casting it; for the plant it comes round to the side.
 */
export const SUN = new THREE.Vector3(85, 90, 20);

export interface CadPlant {
  model: THREE.Group;
  /** a gravel apron out to the fog */
  ground: THREE.Mesh;
  units: Record<string, THREE.Object3D>;
  /** walls and roofs: X shows and hides them, and they are never solid */
  cladding: THREE.Mesh[];
  bytes: number;
  fetchMs: number;
  parseMs: number;
}

/**
 * The plant, dressed, with its ground; null if it is not on this machine.
 * The stair ramps and landing decks the converter lays are for walking on,
 * not for seeing - ramps: true shows them, to check where they went.
 */
export async function loadPlant(opts: { ramps?: boolean } = {}): Promise<CadPlant | null> {
  const t0 = performance.now();
  const res = await fetch(PLANT_URL).catch(() => null);
  if (!res?.ok) return null;
  const buf = await res.arrayBuffer();
  // a host that answers every path with the index page is not a model
  if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') return null;
  const fetchMs = performance.now() - t0;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, './local/');
  const parseMs = performance.now() - t0 - fetchMs;

  const model = gltf.scene;
  const units: Record<string, THREE.Object3D> = {};
  const cladding: THREE.Mesh[] = [];
  model.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    // a unit with several materials comes through as a group of meshes
    const unit = (mesh.parent && mesh.parent !== model ? mesh.parent.name : mesh.name) || 'misc';
    const src = mesh.material as THREE.MeshStandardMaterial;
    mesh.userData.unit = unit;
    mesh.userData.cls = src.name.split('_')[0];
    if (mesh.userData.cls === 'ramp') {
      mesh.visible = !!opts.ramps;
      mesh.material = new THREE.MeshBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
      return;
    }
    units[unit] = mesh.parent && mesh.parent !== model ? mesh.parent : mesh;
    if (mesh.userData.cls === 'cladding') cladding.push(mesh);
    mesh.material = realMaterial(src, unit);
    mesh.castShadow = mesh.receiveShadow = true;
  });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color: 0x3b3a37, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  return { model, ground, units, cladding, bytes: buf.byteLength, fetchMs, parseMs };
}

export interface Survey {
  grid: TriangleGrid;
  /** the unit and part class a triangle came from, by its index in the grid */
  owner(i: number): { unit: string; cls: string };
}

/**
 * The collision world, and which mesh each run of triangles in it came from.
 * The cladding is left out: X shows and hides it, and a wall that stops you
 * whether or not you can see it is worse than a shed you can walk into. The
 * stair ramps are in, though nobody sees them. With a clip box, only
 * triangles reaching into it are kept - the arena's page and server both
 * clip to the same one, so they hold the same world.
 */
export function survey(model: THREE.Object3D, ground: THREE.Mesh, clip?: THREE.Box3): Survey {
  const grid = new TriangleGrid();
  const starts: number[] = [];
  const whose: Array<{ unit: string; cls: string }> = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const take = (mesh: THREE.Mesh, unit: string, cls: string) => {
    starts.push(grid.size);
    whose.push({ unit, cls });
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const m = mesh.matrixWorld;
    for (let i = 0; i + 2 < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m);
      if (clip && (
        Math.max(a.x, b.x, c.x) < clip.min.x || Math.min(a.x, b.x, c.x) > clip.max.x
        || Math.max(a.y, b.y, c.y) < clip.min.y || Math.min(a.y, b.y, c.y) > clip.max.y
        || Math.max(a.z, b.z, c.z) < clip.min.z || Math.min(a.z, b.z, c.z) > clip.max.z
      )) continue;
      grid.add(a, b, c);
    }
  };
  model.updateWorldMatrix(true, true);
  ground.updateWorldMatrix(true, false);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.cls !== 'cladding') take(mesh, mesh.userData.unit, mesh.userData.cls);
  });
  take(ground, '', 'ground');
  grid.finish();
  return {
    grid,
    owner(i) {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= i) lo = mid; else hi = mid - 1;
      }
      return whose[lo];
    },
  };
}
