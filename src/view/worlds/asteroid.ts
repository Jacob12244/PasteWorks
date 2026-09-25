/**
 * 16 Psyche, from the ground: a metal world 222 km across, in vacuum, 2.9 AU
 * from the sun, in 2091.
 *
 * What makes it read as an asteroid rather than a grey plane is mostly
 * physics, so this tries to get the physics right:
 *
 * - The body is small. With a mean radius of 111 km the ground falls away
 *   from the site as d^2/2R - 4.5 m at a kilometre, 40 m at three - so from
 *   eye height the horizon is only about 600 m off, things further away stand
 *   hull-down behind it, and the wall of an old basin to the north stands up
 *   over it. The ground is built curved, out to seven kilometres, which is at
 *   or past the horizon from anywhere the camera goes.
 * - There is no air. No haze, no fog, no blue: far ground is as sharp and as
 *   contrasty as near ground, the sky is black at noon, and the sun is a small
 *   hard disc a third the size it is from Earth. Shadows are black, lit only
 *   by what the ground throws back up. Past the reach of the plant's own
 *   shadow map, everything that stands still casts into a second map, baked
 *   once from the sun (bakeSunShadow), so a crater two kilometres off still
 *   has a black floor.
 * - The surface is regolith: cratered at every scale, from the old basin down
 *   to the pits underfoot, with blocks thrown out round the fresh craters and
 *   bare metal where the dust has slid off. Regolith is not Lambertian - it
 *   throws light back towards the sun - so the ground is brighter looking
 *   down-sun and darker looking into it.
 * - What moves, moves ballistically in 0.015 g: dust off a wheel goes up in a
 *   clean arc, with no air to hold it up or blow it about, and a grain kicked
 *   up at a metre a second takes fourteen seconds to come down.
 *
 * Round it, a working outpost: the crew's habitat under a regolith berm, a
 * solar farm with its rows turned to the low sun, the mass driver's power
 * hall, a landing pad with a freighter on it, and out past the horizon the
 * reactor's radiators and a relay mast, their feet hidden by the curve.
 *
 * The dome, the pit and the rail are space.ts, which this lays the world under.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Telemetry } from '../../sim/plant';
import type { Look } from '../../scenario';
import type { Stage } from '../scene';
import type { GroundSpec } from '../terrain';
import { Dressing, rng, canvasTexture, clamp01 } from './common';
import { lin, perlin, fbm, srgbByte, smooth, rrect, gridAxis, landform, selfShade, Kit } from './land';
import { buildSpace, PIT_HOLE } from './space';

// ------------------------------------------------------------------ the sun

/** Towards the sun: low in the south-west, behind the usual view of the plant. */
export const SUN = new THREE.Vector3(-0.66, 0.37, 0.66).normalize();
/** Along the ground, towards the sun, and across it (the way the solar rows run). */
const SUN_H = new THREE.Vector3(SUN.x, 0, SUN.z).normalize();
const ACROSS = new THREE.Vector3(SUN_H.z, 0, -SUN_H.x);

/**
 * The light that goes with a black sky. One hard sun and nothing from above;
 * what fill there is comes up off the lit ground (the hemisphere light's
 * ground colour). No fog at all - see buildAsteroid.
 */
export const PSYCHE_LOOK: Partial<Look> = {
  sky: [0x000000, 0x000000, 0x000000],
  fog: { color: 0x000000, near: 1e5, far: 2e5 },
  hemi: { sky: 0x050608, ground: 0x6a6864, intensity: 0.55 },
  key: { color: 0xfff8ee, intensity: 4.2 },
  fill: 0.03,
  rim: 0,
  pools: 1.15,
  exposure: 1.0,
  bloom: [0.5, 0.35, 0.98],
  env: 0.6,
};

/** The pad keeps its lit kerb; the world lays ground of its own round it. */
export const PSYCHE_GROUND: GroundSpec = {
  plain: 0x2a292b, pad: 0x3a3c42, grid: [0x7a6a4a, 0x2c2f36], kerb: 0xffab3d, cut: false,
  plainless: true, gridOpacity: 0.25,
};

// ------------------------------------------------------------------ the body

/** Psyche's mean radius. */
const R_BODY = 111_000;
/** The pad's datum, as the old flat ground had it. */
const G0 = -0.4;
/** The square grid round the site, either side. */
const EDGE = 420;
/** Where the ground stops: past the horizon from anywhere the camera goes. */
const RING = 7000;
/** What a walker walks on at full resolution. */
const WALK = { x0: -270, x1: 228, z0: -125, z1: 125 };
/** A second render layer: what the sun's baked shadow map is drawn from. */
const STATIC = 7;

const n1 = perlin(211), n2 = perlin(223), n3 = perlin(227), n4 = perlin(229), n5 = perlin(233);

/** How far below the site's tangent plane the sphere is here. */
const drop = (x: number, z: number) => (x * x + z * z) / (2 * R_BODY);

// ---- where things are

const HAB = { x: -50, z: -180 };
const LOCK_E = { x: 38, z: 45.5 };
const HALL = { x: 118, z: -44 };
const LANDING = { x: 470, z: -150, r: 30 };
/** The solar farm, its rows running across the sun. */
const FARM = { x: 170, z: -272, a: Math.atan2(ACROSS.z, ACROSS.x), rows: 14, tables: 12 };
const REACTOR = { x: -1500, z: -980 };
const RELAY = { x: 380, z: 2560 };
const WORKINGS = { x: -540, z: 150 };

// ---- level ground: where people have graded it

/** A patch of ground kept clear; graded dead level unless it is `soft`, which only keeps it clear. */
interface Zone { cx: number; cz: number; hx: number; hz: number; r: number; a?: number; level?: number; soft?: boolean }

const ZONES: Zone[] = [
  // the site itself, dead level at the pad datum: dome and pad, pit, rail, power hall
  { cx: -45, cz: 6, hx: 122, hz: 74, r: 55, level: G0 },
  { cx: -205, cz: -2, hx: 68, hz: 46, r: 22, level: G0 },
  { cx: 145, cz: 4, hx: 86, hz: 24, r: 14, level: G0 },
  { cx: HALL.x, cz: HALL.z, hx: 42, hz: 18, r: 8, level: G0 },
  // the habitat, and the walkway to it
  { cx: HAB.x, cz: HAB.z + 2, hx: 34, hz: 30, r: 10, level: G0 },
  { cx: -54, cz: -110, hx: 6, hz: 50, r: 3, level: G0 },
  // graded to the ground where they stand
  { cx: LANDING.x, cz: LANDING.z, hx: 58, hz: 58, r: 55 },
  // the solar tables stand on posts on the ground as it lies
  { cx: FARM.x, cz: FARM.z, hx: 136, hz: 86, r: 10, a: FARM.a, soft: true },
  { cx: REACTOR.x, cz: REACTOR.z, hx: 95, hz: 75, r: 25 },
  { cx: RELAY.x, cz: RELAY.z, hx: 16, hz: 16, r: 10 },
];

/** Distance (m, signed) from a point to a zone's edge. */
function zoneDist(x: number, z: number, s: Zone) {
  if (!s.a) return rrect(x, z, s.cx, s.cz, s.hx, s.hz, s.r);
  const c = Math.cos(s.a), sn = Math.sin(s.a);
  const dx = x - s.cx, dz = z - s.cz;
  return rrect(dx * c + dz * sn, -dx * sn + dz * c, 0, 0, s.hx, s.hz, s.r);
}

const BLEND = 60;
/** The nearest graded zone and how far out of it this is: 0 on it, 1 past the blend. */
const Zn = { w: 1, level: G0 };
function graded(x: number, z: number) {
  let d = Infinity, level = G0;
  for (let i = 0; i < ZONES.length; i++) {
    const s = ZONES[i];
    if (s.soft) continue;
    const reach = s.hx + s.hz + BLEND;
    if (Math.abs(x - s.cx) > reach || Math.abs(z - s.cz) > reach) continue;
    const k = zoneDist(x, z, s);
    if (k < d) { d = k; level = s.level ?? G0; }
  }
  Zn.w = d >= BLEND ? 1 : smooth(0, BLEND, d);
  Zn.level = level;
  return Zn;
}

// ---- craters

interface Crater { x: number; z: number; R: number; depth: number; rim: number; fill: number; fresh: number }

const CRATERS: Crater[] = [];
const CELL = 160;
const buckets = new Map<number, Crater[]>();
const bucketKey = (i: number, j: number) => (i + 200) * 1000 + (j + 200);

/** The old basin whose wall stands up over the northern horizon. */
const BASIN = { x: 1500, z: -4000, R: 2050, H: 185, depth: 260 };

let seeded = false;
function seedWorld() {
  if (seeded) return;
  seeded = true;
  const r = rng(1601);
  // Craters at every scale, as a surface saturated with them has: the number
  // bigger than D goes as 1/D^2. Each band starts at the smallest crater its
  // stretch of ground can show, so none are wasted.
  const bands: [number, number, number, number, number][] = [
    // from, to (m from the site), smallest and largest diameter, how many
    [60, 330, 9, 60, 240],
    [260, 760, 20, 140, 230],
    [650, 2200, 45, 320, 380],
    [1900, 6000, 110, 700, 560],
  ];
  const clear = (x: number, z: number, R: number) => {
    for (const s of ZONES) if (zoneDist(x, z, s) < R * 1.35 + 12) return false;
    for (const rd of ROADS) {
      for (let i = 1; i < rd.pts.length; i++) {
        const [ax, az] = rd.pts[i - 1], [bx, bz] = rd.pts[i];
        const vx = bx - ax, vz = bz - az;
        const t = clamp01(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz));
        if (Math.hypot(x - ax - vx * t, z - az - vz * t) < R * 1.3 + rd.w) return false;
      }
    }
    return true;
  };
  // near the site more of them are young: the part people see most of should show what a fresh one looks like
  const young = [0.34, 0.28, 0.22, 0.18];
  bands.forEach(([a0, a1, d0, d1, count], bi) => {
    for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(a0 * a0 + r() * (a1 * a1 - a0 * a0));
      const x = -20 + Math.cos(a) * d, z = Math.sin(a) * d;
      // a truncated power law in diameter
      const D = d0 / Math.sqrt(1 - r() * (1 - (d0 / d1) ** 2));
      const R = D / 2;
      if (!clear(x, z, R)) continue;
      n++;
      // Most are old, softened by everything that landed since: shallow, the
      // rim worn down, the floor filled in. A few are fresh.
      const age = Math.pow(r(), 0.6);
      CRATERS.push({
        x, z, R,
        depth: (0.42 - 0.3 * age) * R,
        rim: (0.085 - 0.06 * age) * R,
        fill: (0.4 - 0.26 * age) * R,
        fresh: age < young[bi] ? 1 - age / young[bi] : 0,
      });
    }
  });
  for (const c of CRATERS) {
    const reach = c.R * 2.2;
    for (let i = Math.floor((c.x - reach) / CELL); i <= Math.floor((c.x + reach) / CELL); i++) {
      for (let j = Math.floor((c.z - reach) / CELL); j <= Math.floor((c.z + reach) / CELL); j++) {
        const k = bucketKey(i, j);
        let list = buckets.get(k);
        if (!list) buckets.set(k, list = []);
        list.push(c);
      }
    }
  }
  // the zones out on the plain are graded to the ground where they stand
  for (const s of ZONES) if (s.level === undefined && !s.soft) s.level = G0 + natural(s.cx, s.cz) - drop(s.cx, s.cz);
}

/** What the last natural() call found, for the colour to use. */
const S = { fresh: 0, floor: 0, wall: 0, w: 1, massif: 0, mA: 0, mR: 0 };

/**
 * The natural ground, before anyone graded any of it, over the sphere: long
 * low swells, the craters, and the basin wall to the north.
 */
function natural(x: number, z: number) {
  const r2 = x * x + z * z;
  // the long swells die away towards the site, which was put where the
  // ground was level to begin with - so the grading round it is shallow
  const r = Math.sqrt(r2);
  let h = 5.5 * fbm(n1, x / 1150, z / 1150, 3) * smooth(150, 800, r)
    + 1.5 * fbm(n2, x / 230, z / 230, r2 > 3000 * 3000 ? 2 : 3) * (0.35 + 0.65 * smooth(80, 400, r));
  if (r2 < 900 * 900) h += 0.35 * fbm(n3, x / 40, z / 40, 2);
  let fresh = 0, floor = 0, wall = 0;
  const list = buckets.get(bucketKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const dx = x - c.x, dz = z - c.z;
      const q = (dx * dx + dz * dz) / (c.R * c.R);
      if (q > 4.84) continue;
      const u = Math.sqrt(q);
      // a raised rim, steep inside, and a long apron of ejecta outside
      const t = (u - 1) / (u < 1 ? 0.2 : 0.42);
      let dh = c.rim * Math.exp(-t * t);
      if (u < 1) dh -= c.depth * (1 - q);
      h += dh > -c.fill ? dh : -c.fill;
      if (c.fresh > 0) fresh = Math.max(fresh, c.fresh * (u < 1 ? 0.5 + 0.5 * u : Math.exp(-(u - 1) * 2.2)));
      if (u < 1) {
        floor = Math.max(floor, 1 - smooth(0.3, 0.75, u));
        wall = Math.max(wall, smooth(0.45, 0.8, u) * (1 - smooth(0.92, 1.05, u)) * (0.4 + 0.6 * c.fresh));
      }
    }
  }
  // The basin: a wall 185 m high round a floor 260 m down, and a long apron
  // of its own ejecta on the near side. Its crest wanders, as an old one's
  // does, and the wall is cut into spurs and gullies by everything that slid.
  let massif = 0;
  const bx = x - BASIN.x, bz = z - BASIN.z;
  const br2 = bx * bx + bz * bz;
  if (br2 < (BASIN.R * 2.2) ** 2) {
    const br = Math.sqrt(br2), cx = bx / br, cz = bz / br;
    const Rb = BASIN.R * (1 + 0.05 * n4(cx * 3.1, cz * 3.1));
    const u = br / Rb;
    const crest = BASIN.H * (0.8 + 0.35 * n5(cx * 2.3 + 5, cz * 2.3));
    const t = (u - 1) / (u < 1 ? 0.07 : 0.3);
    let bh = crest * Math.exp(-t * t);
    if (u < 1) bh -= BASIN.depth * (1 - u * u);
    massif = 1 - smooth(0, 0.55, Math.abs(u - 1));
    if (massif > 0) {
      const ridge = 1 - Math.abs(fbm(n3, x / 260, z / 260, 4));
      bh += massif * (36 * ridge * ridge - 16 + 10 * fbm(n2, x / 95, z / 95, 2));
      S.mA = Math.atan2(cz, cx);
      S.mR = br;
    }
    h += bh;
  }
  S.fresh = fresh; S.floor = floor; S.wall = wall; S.massif = massif;
  return h;
}

/** Height of the ground. Records what the colour needs in S. */
function surface(x: number, z: number) {
  const g = graded(x, z);
  S.w = g.w;
  if (g.w <= 0) { S.fresh = S.floor = S.wall = S.massif = 0; return g.level; }
  const wild = G0 + natural(x, z) - drop(x, z);
  return g.level + (wild - g.level) * g.w;
}

/** Height of the ground, for things standing on it. */
export function groundAt(x: number, z: number) {
  seedWorld();
  return surface(x, z);
}

// ---- colour

const SOIL = {
  mature: lin(0x6b6a67), dark: lin(0x545351), bright: lin(0x8b8a86), fresh: lin(0xa19f9a),
  metal: lin(0x75787e), floor: lin(0x5d5c59), trod: lin(0x4c4b49), slope: lin(0x62615e), ore: lin(0x57585a),
};

const _c = new THREE.Color();
/** Colour of the ground where surface() was last asked. */
function soilColour(x: number, z: number, out: THREE.Color) {
  const far = x * x + z * z > 1500 * 1500;
  out.copy(SOIL.mature).lerp(SOIL.dark, clamp01(0.5 + 1.2 * fbm(n4, x / 90, z / 90, far ? 1 : 3)));
  // broad patches, brighter and darker, a few hundred metres across
  const patch = fbm(n5, x / 520 + 3, z / 520, 2);
  if (patch > 0) out.lerp(SOIL.bright, smooth(0.05, 0.4, patch) * 0.55);
  else out.lerp(SOIL.dark, smooth(0.05, 0.35, -patch) * 0.5);
  // metal-rich ground, a little bluer and a little brighter
  out.lerp(SOIL.metal, smooth(0.25, 0.5, fbm(n2, x / 300 - 7, z / 300, far ? 1 : 2)) * 0.6);
  // fresh craters throw out bright, unweathered ejecta; steep walls shed their dust
  out.lerp(SOIL.fresh, S.fresh * 0.75);
  out.lerp(SOIL.bright, S.wall * 0.4);
  out.lerp(SOIL.floor, S.floor * 0.3);
  if (S.massif > 0) {
    // the wall is streaked downhill, bright where it slid recently and dark
    // where it has had time to weather: noise stretched along the fall line
    const streak = fbm(n5, S.mA * 260, S.mR / 320, 3);
    out.lerp(SOIL.slope, S.massif * 0.5);
    out.lerp(streak > 0 ? SOIL.fresh : SOIL.dark, S.massif * Math.min(1, Math.abs(streak) * 1.6) * 0.55);
  }
  // and round the site, the ground is churned dark by the traffic
  if (S.w < 1) {
    _c.copy(SOIL.trod).lerp(SOIL.mature, clamp01(0.4 + fbm(n3, x / 22, z / 22, 2)));
    out.lerp(_c, (1 - S.w) * 0.75);
  }
  return out;
}

// ---- the regolith close up

let detailTex: { map: THREE.Texture; normal: THREE.Texture } | null = null;

/**
 * Close up: fine dust, pitted with shallow little craters and strewn with
 * clasts, some of them metal. A multiplier over the ground's colour, white on
 * average, and a normal map from the same heights. The ground lays it over
 * itself at three scales (regolithLit), so it tiles at none of them.
 */
function regolithDetail() {
  if (detailTex) return detailTex;
  const N = 384;
  const r = rng(77);
  const t1 = perlin(301), t2 = perlin(302);
  // two height fields: the colour's, with the broad mottling in it, and the
  // normals', which is only the pits and the clasts - noise in a normal map
  // reads as ripples, and there is no wind here to make ripples
  const hgt = new Float32Array(N * N);
  const bump = new Float32Array(N * N);
  const tint = new Float32Array(N * N);
  // noise that tiles: sampled round a torus, the trig done once per row and column
  const ca = new Float32Array(N), sa = new Float32Array(N);
  for (let i = 0; i < N; i++) { ca[i] = Math.cos((i / N) * Math.PI * 2); sa[i] = Math.sin((i / N) * Math.PI * 2); }
  const tor = (n: (x: number, y: number) => number, u: number, v: number, f: number) =>
    n(ca[u] * f + sa[v] * f * 0.7, sa[u] * f + ca[v] * f * 0.7);
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const a = tor(t1, u, v, 4), b = tor(t2, u, v, 17);
      hgt[v * N + u] = 0.35 * a + 0.16 * b;
      bump[v * N + u] = 0.05 * a;
      tint[v * N + u] = 1 + 0.06 * b;
    }
  }
  const wrap = (a: number) => ((a % N) + N) % N;
  // little craters, a power law in size, most of them softened and shallow
  // none of them big: one big one would be the same one in every tile, in rows
  for (let i = 0; i < 90; i++) {
    const cx = r() * N, cy = r() * N;
    const R = 2.4 / Math.sqrt(1 - r() * (1 - (2.4 / 8.5) ** 2));
    const soft = r();
    const depth = R * (0.025 + 0.06 * (1 - soft)), rim = depth * (0.15 + 0.3 * (1 - soft));
    const reach = Math.ceil(R * 1.8);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const q = (dx * dx + dy * dy) / (R * R);
        if (q > 3.24) continue;
        const uu = Math.sqrt(q), t = (uu - 1) / (uu < 1 ? 0.3 : 0.5);
        let dh = rim * Math.exp(-t * t);
        if (uu < 1) dh -= depth * (1 - q);
        const k = wrap(Math.floor(cy) + dy) * N + wrap(Math.floor(cx) + dx);
        hgt[k] += dh;
        bump[k] += dh;
      }
    }
  }
  // clasts: rock and metal, each a little dome
  for (let i = 0; i < 800; i++) {
    const px = Math.floor(r() * N), py = Math.floor(r() * N);
    const rad = 0.7 + r() * r() * 3.4;
    const shade = r() < 0.12 ? 1.3 : 0.7 + r() * 0.3;
    const c = Math.ceil(rad);
    for (let dy = -c; dy <= c; dy++) {
      for (let dx = -c; dx <= c; dx++) {
        const d = Math.hypot(dx, dy) / rad;
        if (d > 1) continue;
        const k = wrap(py + dy) * N + wrap(px + dx);
        hgt[k] += Math.sqrt(1 - d * d) * rad * 0.1;
        bump[k] += Math.sqrt(1 - d * d) * rad * 0.1;
        tint[k] = shade;
      }
    }
  }
  const map = canvasTexture(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let k = 0; k < N * N; k++) {
      const l = (0.9 + 0.08 * hgt[k]) * tint[k];
      img.data[k * 4] = srgbByte(l);
      img.data[k * 4 + 1] = srgbByte(l);
      img.data[k * 4 + 2] = srgbByte(l * 0.99);
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  const normal = canvasTexture(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let v = 0; v < N; v++) {
      const v0 = wrap(v - 1) * N, v1 = wrap(v + 1) * N, vv = v * N;
      for (let u = 0; u < N; u++) {
        const nx = (bump[vv + wrap(u - 1)] - bump[vv + wrap(u + 1)]) * 1.5, ny = (bump[v0 + u] - bump[v1 + u]) * 1.5;
        const l = Math.hypot(nx, ny, 1);
        const k = (vv + u) * 4;
        img.data[k] = (nx / l * 0.5 + 0.5) * 255;
        img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255;
        img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  normal.colorSpace = THREE.NoColorSpace;
  for (const t of [map, normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  detailTex = { map, normal };
  return detailTex;
}

/** Metres per repeat of the regolith's finest copy. */
const TILE = 5;

const v3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

/**
 * The sun's baked shadow map: everything that stands still, drawn once from
 * the sun, for the ground past the reach of the plant's own shadow map.
 */
const SUN_SHADOW = {
  size: 2048,
  map: null as THREE.Texture | null,
  matrix: new THREE.Matrix4(),
};

/**
 * Light a standard material the way regolith lights: Lommel-Seeliger with
 * the phase function of a dusty airless surface, part way from Lambert -
 * bright towards the sun behind you, the surge round your own shadow, dim
 * looking into the sun. With `detail`, the regolith texture laid over itself
 * at 5 m, 40 m and 320 m, the bigger copies coming and going in patches so
 * no repeat lines up; with `baked`, the sun's baked shadow past the reach of
 * the live one.
 */
function regolithLit<M extends THREE.MeshStandardMaterial>(mat: M, key: string, detail: boolean, baked: boolean): M {
  const shadow = { value: null as THREE.Texture | null };
  const matrix = { value: SUN_SHADOW.matrix };
  mat.onBeforeCompile = (sh) => {
    shadow.value = SUN_SHADOW.map;
    sh.uniforms.uSunShadow = shadow;
    sh.uniforms.uSunShadowMatrix = matrix;
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\nvarying vec3 vRgWorld;\nvarying vec3 vRgNormal;\nvarying float vRgWild;'
      + (detail ? '\nattribute float aWild;' : ''))
      .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
        vRgWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRgNormal = normalize(mat3(modelMatrix) * objectNormal);
        vRgWild = ${detail ? 'aWild' : '1.0'};`);
    fs = fs.replace('#include <common>', /* glsl */ `#include <common>
      varying vec3 vRgWorld;
      varying vec3 vRgNormal;
      varying float vRgWild;
      float rgHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float rgNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(rgHash(i), rgHash(i + vec2(1, 0)), u.x), mix(rgHash(i + vec2(0, 1)), rgHash(i + vec2(1, 1)), u.x), u.y);
      }`);
    if (baked) {
      fs = fs.replace('void main() {', /* glsl */ `
        uniform sampler2D uSunShadow;
        uniform mat4 uSunShadowMatrix;
        // lit (1) or not, from the baked map, with a texel of bilinear softening
        float rgBakedSun() {
          vec3 p = vRgWorld + normalize(vRgNormal) * 0.8 + ${v3(SUN)} * 0.8;
          vec3 q = (uSunShadowMatrix * vec4(p, 1.0)).xyz;
          if (q.x <= 0.0 || q.x >= 1.0 || q.y <= 0.0 || q.y >= 1.0 || q.z >= 1.0) return 1.0;
          const float N = ${SUN_SHADOW.size.toFixed(1)};
          vec2 t = q.xy * N - 0.5;
          vec2 f = fract(t), b = (floor(t) + 0.5) / N;
          float s00 = step(q.z, unpackRGBAToDepth(texture2D(uSunShadow, b)));
          float s10 = step(q.z, unpackRGBAToDepth(texture2D(uSunShadow, b + vec2(1.0 / N, 0.0))));
          float s01 = step(q.z, unpackRGBAToDepth(texture2D(uSunShadow, b + vec2(0.0, 1.0 / N))));
          float s11 = step(q.z, unpackRGBAToDepth(texture2D(uSunShadow, b + vec2(1.0 / N))));
          return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
        }
        void main() {`);
      fs = fs.replace('#include <lights_fragment_begin>', /* glsl */ `
        float rgSun = rgBakedSun();
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          // inside the live shadow map, it has this already, and sharper
          vec3 rgDyn = vDirectionalShadowCoord[ 0 ].xyz;
          vec2 rgIn = smoothstep(0.0, 0.03, rgDyn.xy) * smoothstep(1.0, 0.97, rgDyn.xy);
          rgSun = mix(rgSun, 1.0, rgIn.x * rgIn.y * step(rgDyn.z, 1.0));
        #endif
        ${THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? rgSun : 1.0;')}`);
    }
    if (detail) {
      fs = fs.replace('#include <map_fragment>', /* glsl */ `
        #ifdef USE_MAP
          vec2 rgW = vMapUv * ${TILE.toFixed(1)};
          // graded ground has had its little craters rolled out of it
          float rgWildK = mix(0.12, 1.0, vRgWild);
          float rgM2 = smoothstep(0.2, 0.8, rgNoise(rgW / 70.0)) * rgWildK;
          float rgM3 = smoothstep(0.25, 0.85, rgNoise(rgW / 450.0 + 17.0)) * rgWildK;
          vec2 rgUv2 = mat2(0.97, 0.24, -0.24, 0.97) * vMapUv * 0.125 + 0.37;
          vec2 rgUv3 = mat2(0.52, 0.85, -0.85, 0.52) * vMapUv * 0.0156 + 0.61;
          // each copy gives way to the next bigger one with distance, so the
          // finest never lines up in rows across the view from further off
          float rgD = length(vViewPosition);
          vec4 rgA = mix(texture2D(map, vMapUv), vec4(0.9), max(smoothstep(12.0, 45.0, rgD), 0.6 * (1.0 - vRgWild)));
          vec4 rgB = mix(vec4(0.9), texture2D(map, rgUv2), (0.12 + 0.7 * rgM2) * rgWildK);
          vec4 rgC = mix(vec4(0.9), texture2D(map, rgUv3), 0.65 * rgM3);
          diffuseColor *= rgA * rgB * rgC * 1.37;
        #endif`)
        .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', /* glsl */ `
          vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          vec3 rgN2 = texture2D( normalMap, rgUv2 ).xyz * 2.0 - 1.0;
          rgN2.xy = mat2(0.97, -0.24, 0.24, 0.97) * rgN2.xy;
          vec3 rgN3 = texture2D( normalMap, rgUv3 ).xyz * 2.0 - 1.0;
          rgN3.xy = mat2(0.52, -0.85, 0.85, 0.52) * rgN3.xy;
          float rgNear = (1.0 - smoothstep(10.0, 45.0, rgD)) * mix(0.35, 1.0, vRgWild);
          mapN = vec3(mapN.xy * (0.1 + 0.9 * rgNear) + rgN2.xy * (0.15 + 0.75 * rgM2) * rgWildK + rgN3.xy * 0.9 * rgM3,
            mapN.z * rgN2.z * rgN3.z);`);
    }
    fs = fs.replace('#include <lights_physical_pars_fragment>',
      THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        // dust has next to no sheen, even looking into the sun
        'reflectedLight.directSpecular += irradiance * BRDF_GGX(',
        'reflectedLight.directSpecular += 0.2 * irradiance * BRDF_GGX(',
      ).replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', /* glsl */ `
        {
          float rgMu = saturate( dot( geometryNormal, geometryViewDir ) );
          float rgAlpha = acos( clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 ) );
          float rgPhase = exp( -0.7 * rgAlpha ) * ( 1.0 + 0.3 * exp( -rgAlpha * 14.0 ) );
          float rgLS = 2.0 * dotNL / max( dotNL + rgMu, 0.05 );
          reflectedLight.directDiffuse += directLight.color * mix( dotNL, rgLS * rgPhase * 1.2, 0.55 )
            * BRDF_Lambert( material.diffuseColor );
        }`));
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

let groundMat: THREE.MeshStandardMaterial | null = null;
function regolithMaterial() {
  if (groundMat) return groundMat;
  const { map, normal } = regolithDetail();
  groundMat = regolithLit(new THREE.MeshStandardMaterial({
    vertexColors: true, map, normalMap: normal, normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.95, metalness: 0.05,
  }), 'psyche-regolith', true, true);
  return groundMat;
}

// ---- the ground mesh

/**
 * Rings of the ground outside the square, as fractions of the way out (in
 * log radius): close together between about 1.2 and 4 km, where the basin
 * wall is and a coarse ring would smooth it into dunes.
 */
function ringSteps(): number[] {
  const u: number[] = [];
  for (let k = 1; k <= 16; k++) u.push((0.35 * k) / 16);
  for (let k = 1; k <= 48; k++) u.push(0.35 + (0.47 * k) / 48);
  for (let k = 1; k <= 8; k++) u.push(0.82 + (0.18 * k) / 8);
  return u;
}

/**
 * The ground: a square grid round the site, three metres a cell where you
 * can walk and opening out to eleven, and outside it rings out to the edge,
 * along rays through the square's own edge vertices so the two meet without
 * a crack. Three meshes over one set of vertices: the walkable middle, the
 * rest of the square, and the rings. Past the walkable middle a coarse
 * collider, never drawn, keeps a walker on the surface.
 */
function buildBody(): THREE.Group {
  const g = new THREE.Group();
  const step = (a: number) => (a < 120 ? 3 : Math.min(12, 3 + (a - 120) * 0.028));
  const [px0, px1, pz0, pz1] = PIT_HOLE;
  const xs = gridAxis(EDGE, [px0, px1, WALK.x0, WALK.x1], step);
  const zs = gridAxis(EDGE, [pz0, pz1, WALK.z0, WALK.z1], step);
  const nx = xs.length, nz = zs.length;

  // the square's edge, once round, as grid indices
  const perim: number[] = [];
  for (let i = 0; i < nx; i++) perim.push(i);
  for (let j = 1; j < nz; j++) perim.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) perim.push((nz - 1) * nx + i);
  for (let j = nz - 2; j >= 1; j--) perim.push(j * nx);
  const P = perim.length;
  // past the edge, a ray through every other edge vertex: round the square
  // the grid is finer than a silhouette out there needs
  const Q = P / 2;
  const steps = ringSteps();
  const RINGS = steps.length;
  const nSq = nx * nz, nAll = nSq + Q * RINGS;

  const pos = new Float32Array(nAll * 3);
  const nor = new Float32Array(nAll * 3);
  const col = new Float32Array(nAll * 3);
  const uv = new Float32Array(nAll * 2);
  const wild = new Float32Array(nAll);
  const c = new THREE.Color();
  const put = (k: number, x: number, z: number) => {
    const y = surface(x, z);
    wild[k] = S.w;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    soilColour(x, z, c);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    uv[k * 2] = x / TILE; uv[k * 2 + 1] = z / TILE;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) put(j * nx + i, xs[i], zs[j]);
  for (let k = 1; k <= RINGS; k++) {
    for (let q = 0; q < Q; q++) {
      const e = perim[q * 2];
      const x0 = pos[e * 3], z0 = pos[e * 3 + 2];
      const s = Math.pow(RING / Math.hypot(x0, z0), steps[k - 1]);
      put(nSq + (k - 1) * Q + q, x0 * s, z0 * s);
    }
  }

  // normals: across the grid's own neighbours in the square, and round and
  // out along the rings, with the square's edge normals shared by both
  const Y = (k: number) => pos[k * 3 + 1];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nx - 1);
      const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, nz - 1);
      const gx = (Y(j * nx + i1) - Y(j * nx + i0)) / (xs[i1] - xs[i0]);
      const gz = (Y(j1 * nx + i) - Y(j0 * nx + i)) / (zs[j1] - zs[j0]);
      const l = Math.hypot(gx, 1, gz);
      const k = (j * nx + i) * 3;
      nor[k] = -gx / l; nor[k + 1] = 1 / l; nor[k + 2] = -gz / l;
    }
  }
  const edge = (p: number) => perim[(p + P) % P];
  const ringIdx = (k: number, q: number) => (k === 0 ? edge(q * 2) : nSq + (k - 1) * Q + ((q + Q) % Q));
  for (let k = 1; k <= RINGS; k++) {
    for (let p = 0; p < Q; p++) {
      const o = ringIdx(Math.min(k + 1, RINGS), p) * 3, i = ringIdx(k - 1, p) * 3;
      const a = ringIdx(k, p + 1) * 3, b = ringIdx(k, p - 1) * 3;
      const ox = pos[o] - pos[i], oy = pos[o + 1] - pos[i + 1], oz = pos[o + 2] - pos[i + 2];
      const rx = pos[a] - pos[b], ry = pos[a + 1] - pos[b + 1], rz = pos[a + 2] - pos[b + 2];
      let x = ry * oz - rz * oy, y = rz * ox - rx * oz, z = rx * oy - ry * ox;
      const l = Math.hypot(x, y, z) * (y < 0 ? -1 : 1);
      x /= l; y /= l; z /= l;
      const k3 = ringIdx(k, p) * 3;
      nor[k3] = x; nor[k3 + 1] = y; nor[k3 + 2] = z;
    }
  }

  const attrs = {
    position: new THREE.BufferAttribute(pos, 3),
    normal: new THREE.BufferAttribute(nor, 3),
    color: new THREE.BufferAttribute(col, 3),
    uv: new THREE.BufferAttribute(uv, 2),
    aWild: new THREE.BufferAttribute(wild, 1),
  };
  const walk: number[] = [], rest: number[] = [], rings: number[] = [];
  const PAD = [-80, 36, -36, 36];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const mx = (xs[i] + xs[i + 1]) / 2, mz = (zs[j] + zs[j + 1]) / 2;
      // under the pad, and the pit's own benches
      if (mx > PAD[0] && mx < PAD[1] && mz > PAD[2] && mz < PAD[3]) continue;
      if (mx > px0 && mx < px1 && mz > pz0 && mz < pz1) continue;
      const q = j * nx + i, bq = q + 1, d = q + nx, e = d + 1;
      const inWalk = mx > WALK.x0 && mx < WALK.x1 && mz > WALK.z0 && mz < WALK.z1;
      (inWalk ? walk : rest).push(q, d, bq, bq, d, e);
    }
  }
  // the edge at full resolution stitched to the first ring at half
  for (let q = 0; q < Q; q++) {
    const A = edge(q * 2), B = edge(q * 2 + 1), C = edge(q * 2 + 2), a = ringIdx(1, q), b = ringIdx(1, q + 1);
    rings.push(A, B, a, B, C, b, B, b, a);
  }
  for (let k = 2; k <= RINGS; k++) {
    for (let q = 0; q < Q; q++) {
      const ia = ringIdx(k - 1, q), ib = ringIdx(k - 1, q + 1), ic = ringIdx(k, q), id = ringIdx(k, q + 1);
      rings.push(ia, ib, ic, ib, id, ic);
    }
  }
  const mat = regolithMaterial();
  for (const [idx, kind] of [[walk, 'walk'], [rest, 'rest'], [rings, 'ring']] as const) {
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(attrs)) geo.setAttribute(name, attr);
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    // the square casts into the live shadow map; everything casts into the baked one
    m.castShadow = kind !== 'ring';
    m.layers.enable(STATIC);
    if (kind === 'walk') m.userData.collider = true;
    else m.userData.noCollide = true;
    g.add(m);
  }
  g.add(roamCollider());
  return g;
}

/**
 * The ground past the walkable middle, 24 m a cell, as a collider that is
 * never drawn: out there a walker stays on the surface, near enough, rather
 * than falling through it.
 */
function roamCollider(): THREE.Mesh {
  const C = 24, H = 600;
  const n = (2 * H) / C + 1;
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(-H + i * C, surface(-H + i * C, -H + j * C), -H + j * C);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = -H + i * C, z0 = -H + j * C;
      if (x0 >= WALK.x0 && x0 + C <= WALK.x1 && z0 >= WALK.z0 && z0 + C <= WALK.z1) continue;
      const q = j * n + i;
      idx.push(q, q + n, q + 1, q + 1, q + n, q + n + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  m.userData.collider = true;
  return m;
}

// ------------------------------------------------------------------ the sky

/** The galactic pole, as seen from here: the band arches high across the sky away from the sun. */
const GALAXY = new THREE.Vector3(0.55, 0.45, -0.7).normalize();
/** Towards the galactic centre, in that band. */
const GALAXY_CORE = new THREE.Vector3(0.62, 0.35, 0.7).projectOnPlane(GALAXY).normalize();

/**
 * Black, with the sun in it. The sun is 0.18 degrees across from 2.9 AU and
 * far over the tone curve, so the bloom finds it; round it there is only the
 * lens's own glare, because there is no air to make a halo. Away from the
 * sun, the Milky Way, faint, as it would be in an exposure for a sunlit
 * landscape. The stars are points, drawn over this (skyStars).
 */
function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vDir;
      float hash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1, 0, 0)), u.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), u.x), u.y),
          mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), u.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), u.x), u.y),
          u.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float mu = dot(d, uSun);
        // the Milky Way: a band round the galactic equator, brighter and
        // wider towards the core, broken up by dust lanes
        float lat = dot(d, ${v3(GALAXY)});
        vec3 inPlane = d - lat * ${v3(GALAXY)};
        float core = pow(max(dot(inPlane / max(length(inPlane), 1e-4), ${v3(GALAXY_CORE)}), 0.0), 3.0);
        float n = noise(d * 7.0) * 0.55 + noise(d * 19.0) * 0.3 + noise(d * 47.0) * 0.15;
        float lane = smoothstep(0.35, 0.65, noise(d * 11.0 + 3.0)) * exp(-lat * lat / 0.0012);
        float band = exp(-lat * lat / (0.018 + 0.03 * core)) * (0.35 + 0.9 * n) * (1.0 - 0.7 * lane);
        vec3 c = vec3(0.0042, 0.0040, 0.0046) * band * (1.0 + 2.2 * core);
        // lost in the glare anywhere near the sun
        c *= smoothstep(0.55, 0.0, mu);
        // the sun's disc, measured by the sine of the angle off it (precise
        // where the cosine is not), and a little glare from the optics
        float s = length(cross(d, uSun));
        float px = fwidth(s) * 1.5 + 1e-5;
        float front = step(0.0, mu);
        c += front * vec3(1.0, 0.97, 0.92) * 12.0 * (1.0 - smoothstep(0.00157 - px, 0.00157 + px, s));
        c += front * vec3(1.0, 0.95, 0.86) * (1.4 * exp(-s * 700.0) + 0.1 * exp(-s * 90.0) + 0.012 * exp(-s * 14.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/**
 * The stars that would survive an exposure for a sunlit landscape: a few
 * hundred of the brightest, none near the sun, and right down to the horizon,
 * because nothing here dims them on the way. Points at infinity, after the
 * sky and behind everything else.
 */
function skyStars(): THREE.Points {
  const r = rng(91);
  const N = 900;
  const dir = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    // a third of them crowd the galactic band
    if (i % 3 === 0) {
      v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).projectOnPlane(GALAXY).normalize()
        .addScaledVector(GALAXY, (r() + r() + r() - 1.5) * 0.12).normalize();
    } else {
      do v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
      v.normalize();
    }
    dir.set([v.x * 100, v.y * 100, v.z * 100], i * 3);
    // brightness: a steep power law, so only a handful are bright
    const b = 0.05 + 1.6 * Math.pow(r(), 9);
    const t = r();
    const [cr, cg, cb] = t < 0.15 ? [0.75, 0.85, 1.1] : t > 0.85 ? [1, 0.82, 0.62] : [1, 0.95, 0.9];
    col.set([cr * b, cg * b, cb * b], i * 3);
    size[i] = 1.6 + 2.2 * Math.min(1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(dir, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN.clone() }, uScale: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float size;
      uniform vec3 uSun;
      uniform float uScale;
      varying vec3 vCol;
      void main() {
        vec3 d = normalize(position);
        vCol = color * smoothstep(0.75, 0.35, dot(d, uSun));
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position.z = gl_Position.w;
        gl_PointSize = size * uScale;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        gl_FragColor = vec4(vCol * exp(-dot(q, q) * 14.0), 1.0);
      }`,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 1001;
  return p;
}

/**
 * What the steel reflects: black sky, and under the horizon the sunlit
 * ground, brighter looking away from the sun. No sun disc - the key light
 * already puts that in every highlight.
 */
function envMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN_H.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float mu = dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), uSun);
        float below = smoothstep(0.015, -0.06, d.y);
        vec3 ground = vec3(0.07, 0.069, 0.066) * (0.55 + 0.9 * pow(clamp(0.5 - 0.5 * mu, 0.0, 1.0), 1.5));
        gl_FragColor = vec4(ground * below + vec3(0.0015, 0.0015, 0.0018), 1.0);
      }`,
  });
}

// ------------------------------------------------------------- rocks

/**
 * A block of rock: an icosahedron pushed about by noise on its own
 * directions (so the shared corners move together and it stays closed),
 * then broken - sliced flat on a few random planes, the way a block breaks
 * along its fractures - flattened where it sits, faceted, darker at the foot.
 */
function rockGeometry(seed: number, detail: number, jag: number): THREE.BufferGeometry {
  const n = perlin(seed);
  const r = rng(seed * 7 + 1);
  const cuts: [THREE.Vector3, number][] = [];
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Vector3(r() * 2 - 1, r() * 1.4 - 0.3, r() * 2 - 1).normalize();
    cuts.push([c, 0.55 + r() * 0.3]);
  }
  const geo = detail < 0 ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, detail);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    const k = 1 + jag * n(d.x * 1.7 + d.y * 0.6, d.z * 1.7 - d.y * 0.9) + 0.5 * jag * n(d.x * 4.1 + 9, d.y * 4.1 + d.z * 2.3);
    d.multiplyScalar(k);
    for (const [c, o] of cuts) {
      const h = d.dot(c);
      if (h > o) d.addScaledVector(c, o - h);
    }
    p.setXYZ(i, d.x, Math.max(d.y, -0.45) , d.z);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  selfShade(geo, -0.45, 0.4, 0.55);
  return geo;
}

/**
 * Blocks thrown out round the fresh craters, a scatter of loose boulders
 * everywhere, pebbles underfoot round the site, and bare metal where it
 * stands out of the dust. Near the walker the bigger ones are solid.
 */
function buildRocks(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(4242);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();
  const lists: Record<string, { m: THREE.Matrix4[]; c: THREE.Color[] }> = {
    solid: { m: [], c: [] }, near: { m: [], c: [] }, big: { m: [], c: [] }, mid: { m: [], c: [] }, far: { m: [], c: [] },
    pebble: { m: [], c: [] }, metal: { m: [], c: [] },
  };
  const inWalk = (x: number, z: number) => x > WALK.x0 + 4 && x < WALK.x1 - 4 && z > WALK.z0 + 4 && z < WALK.z1 - 4;
  const soft = ZONES.filter((zn) => zn.soft);
  const place = (x: number, z: number, size: number, kind?: string) => {
    graded(x, z);
    if (Zn.w < 0.6 || soft.some((zn) => zoneDist(x, z, zn) < 4)) return;
    const flat = kind === 'metal' ? 0.7 + r() * 0.3 : 0.45 + r() * 0.4;
    const y = surface(x, z) - size * 0.18;
    p.set(x, y, z);
    q.setFromEuler(e.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4));
    s.set(size * (0.8 + r() * 0.5), size * flat, size * (0.8 + r() * 0.5));
    m.compose(p, q, s);
    const d = Math.hypot(x + 20, z);
    // fine and casting a live shadow near the site, coarser and baked-only further out
    const k = kind ?? (size < 0.5 ? 'pebble' : inWalk(x, z) && size > 0.7 ? 'solid'
      : size > 2 && d < 700 ? 'big' : d < 250 ? 'near' : d < 700 ? 'mid' : 'far');
    lists[k].m.push(m.clone());
    lists[k].c.push(tint.setHex(k === 'metal' ? 0x8e8b86 : 0x8c8a85).multiplyScalar(0.72 + r() * 0.4).clone());
  };
  // ejecta blocks round the fresh craters, thickest at the rim
  for (const c of CRATERS) {
    if (c.fresh < 0.25 || c.R < 6 || Math.hypot(c.x, c.z) > 2600) continue;
    const count = Math.min(90, Math.round(c.R * 1.4 * c.fresh));
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, u = 0.85 + Math.pow(r(), 2) * 1.5;
      const size = Math.min(0.16 * c.R, 5, 0.4 + Math.pow(r(), 3) * 0.1 * c.R);
      place(c.x + Math.cos(a) * u * c.R, c.z + Math.sin(a) * u * c.R, Math.max(0.3, size));
    }
    // and bare metal in the walls of the biggest
    if (c.R > 14) {
      for (let i = 0; i < 2 + Math.floor(c.R / 14); i++) {
        const a = r() * Math.PI * 2, u = 0.72 + r() * 0.3;
        place(c.x + Math.cos(a) * u * c.R, c.z + Math.sin(a) * u * c.R, Math.min(4, 1.2 + r() * 0.08 * c.R), 'metal');
      }
    }
  }
  // loose boulders everywhere, a steep power law in size
  for (let i = 0; i < 2400; i++) {
    const a = r() * Math.PI * 2, d = 40 + Math.sqrt(r()) * 1600;
    place(-20 + Math.cos(a) * d, Math.sin(a) * d, 0.35 + Math.pow(r(), 5) * 3.5);
  }
  // metal tors out on the plain, a few of them big
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = 120 + Math.sqrt(r()) * 1500;
    place(-20 + Math.cos(a) * d, Math.sin(a) * d, 1.2 + Math.pow(r(), 2) * 3, 'metal');
  }
  // pebbles round the site
  for (let i = 0; i < 3500; i++) {
    const a = r() * Math.PI * 2, d = 30 + Math.sqrt(r()) * 380;
    place(-30 + Math.cos(a) * d, Math.sin(a) * d, 0.1 + Math.pow(r(), 2) * 0.35);
  }
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2 });
  // iron-nickel, never rusted - there is no air to rust it - dusty, but
  // where a face has been knocked clean it catches the sun
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.55 });
  const geos: Record<string, THREE.BufferGeometry> = {
    solid: rockGeometry(11, 1, 0.3), near: rockGeometry(12, 1, 0.34), big: rockGeometry(16, 2, 0.3),
    mid: rockGeometry(17, 0, 0.32), far: rockGeometry(13, 0, 0.3),
    pebble: rockGeometry(14, -1, 0.35), metal: rockGeometry(15, 1, 0.4),
  };
  for (const [k, { m: ms, c: cs }] of Object.entries(lists)) {
    if (!ms.length) continue;
    const inst = new THREE.InstancedMesh(geos[k], k === 'metal' ? metalMat : rockMat, ms.length);
    ms.forEach((mm, i) => { inst.setMatrixAt(i, mm); inst.setColorAt(i, cs[i]); });
    inst.computeBoundingSphere();
    inst.receiveShadow = true;
    inst.castShadow = k === 'solid' || k === 'near' || k === 'big' || k === 'metal';
    inst.layers.enable(STATIC);
    if (k === 'solid') inst.userData.solid = true;
    else inst.userData.noCollide = true;
    g.add(inst);
  }
  return g;
}

// ------------------------------------------------------------- the outpost

/** Materials the outpost is built from, shared so each is one draw call per kit. */
function outpostMaterials() {
  const std = (color: number, roughness: number, metalness: number) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    white: std(0xc9ccce, 0.55, 0.25),
    hull: std(0x3b4250, 0.6, 0.7),
    steel: std(0x7c828a, 0.5, 0.75),
    dark: std(0x33373d, 0.6, 0.6),
    sinter: std(0x5a5956, 0.92, 0.05),
    foil: std(0xc79a3e, 0.32, 0.95),
    radiator: std(0xe0e2de, 0.45, 0.1),
    glass: std(0x0b1522, 0.2, 0.6),
    lamp: new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffd9a0, emissiveIntensity: 2.4 }),
    red: new THREE.MeshStandardMaterial({ color: 0, emissive: 0xff3b24, emissiveIntensity: 3.2 }),
    amber: new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffab3d, emissiveIntensity: 2.2 }),
  };
}
type Mats = ReturnType<typeof outpostMaterials>;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pe = new THREE.Euler();
/** A placement: stood on the ground at (x, z), turned about y. */
const at = (x: number, z: number, ry = 0, y = groundAt(x, z)) =>
  _pm.compose(V(x, y, z), _pq.setFromEuler(_pe.set(0, ry, 0)), V(1, 1, 1)).clone();

/** A cylinder between two points, into a kit. */
function rod(kit: Kit, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 12) {
  const geo = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  kit.add(mat, geo);
}

function shape(kit: Kit, mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz);
  geo.translate(x, y, z);
  kit.add(mat, geo);
}

/** A lattice mast, square and tapering, with a beacon on top. */
function mast(kit: Kit, M: Mats, H: number, B: number) {
  const leg = (sx: number, sz: number, y: number) => V(sx * B * (1 - 0.6 * (y / H)), y, sz * B * (1 - 0.6 * (y / H)));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) kit.member(M.steel, leg(sx, sz, 0), leg(sx, sz, H), 0.28);
  const bay = Math.max(3, H / 12);
  for (let y = 0; y < H - 0.1; y += bay) {
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
      kit.member(M.steel, leg(ax, az, y), leg(bx, bz, Math.min(H, y + bay)), 0.12);
      kit.member(M.steel, leg(ax, az, y), leg(bx, bz, y), 0.12);
    }
  }
  kit.block(M.red, 0.7, 0.7, 0.7, 0, H + 0.4, 0);
}

/**
 * The crew's habitat: three modules laid side by side and buried under a
 * berm of regolith - two metres of it stops most of what the sun and the
 * galaxy throw - with only the south end showing: a sintered wall, three
 * airlocks, a strip of windows. A pressurised walkway runs to the dome.
 */
function buildHab(kit: Kit, M: Mats, forms: THREE.BufferGeometry[]) {
  const { x, z } = HAB;
  const wallZ = z + 22;
  // the berm
  const berm = landform(x, z - 2, 36, 32, 1.5, (px, pz) => {
    if (pz > wallZ) return null;
    const u = Math.hypot((px - x) / 30, (pz - z + 2) / 27);
    const top = 10.5 * (1 - smooth(0.5, 1.12, u));
    const bump = 0.6 * fbm(n3, px / 6, pz / 6, 2);
    _c.copy(SOIL.mature).lerp(SOIL.bright, clamp01(0.3 + fbm(n4, px / 9, pz / 9, 2)));
    return { y: G0 + top + bump * (top > 0.5 ? 1 : 0), colour: _c.clone() };
  }, groundAt, regolithMaterial(), TILE);
  forms.push(berm.geometry);
  // the south wall, doors and windows
  kit.at = at(x, wallZ, 0, G0);
  kit.block(M.sinter, 40, 10.6, 1.4, 0, 5.3, 0.3);
  for (const dx of [-12, 0, 12]) {
    kit.block(M.dark, 4.2, 4.6, 0.4, dx, 2.3, 1.1);
    kit.block(M.amber, 4.6, 0.18, 0.2, dx, 4.75, 1.25);
    kit.block(M.steel, 5.6, 0.5, 2.4, dx, 5.2, 2.0);
  }
  for (const dx of [-6, 6]) kit.block(M.lamp, 3.2, 0.7, 0.12, dx, 6.6, 1.05);
  kit.block(M.lamp, 30, 0.35, 0.12, 0, 8.6, 1.05);
  // a dish and a mast on the berm
  kit.at = at(x - 10, z - 6, 0.6, G0 + 10.2);
  kit.block(M.steel, 1, 2.5, 1, 0, 1.25, 0);
  shape(kit, M.white, new THREE.SphereGeometry(3.2, 20, 8, 0, Math.PI * 2, 0, 0.9), 0, 3.4, 0, -2.2, 0, 0);
  kit.at = at(x + 12, z - 4, 0, G0 + 10.2);
  mast(kit, M, 16, 0.9);
  kit.at = null;
  // the walkway, on low trestles, into the north side of the dome
  const y = 2.2;
  rod(kit, M.white, V(-54, y, -52), V(-54, y, wallZ + 0.9), 1.5, 16);
  for (let wz = -58; wz > wallZ + 4; wz -= 9) {
    kit.block(M.steel, 3.4, 0.4, 0.6, -54, y - 1.6, wz);
    kit.member(M.steel, V(-55.5, G0, wz), V(-55.5, y - 1.4, wz), 0.3);
    kit.member(M.steel, V(-52.5, G0, wz), V(-52.5, y - 1.4, wz), 0.3);
    kit.block(M.steel, 3.3, 0.14, 0.3, -54, y, wz);
  }
}

/** A vehicle airlock in the dome's south-east wall, where the pad road comes in. */
function buildEastLock(kit: Kit, M: Mats) {
  kit.at = at(LOCK_E.x, LOCK_E.z, -0.35, G0);
  // the same build as the ore airlock on the west side
  kit.block(M.hull, 10, 6.5, 8.5, 0, 3.25, 0);
  kit.block(M.dark, 0.3, 4.8, 5.6, 5.1, 2.5, 0);
  kit.block(M.amber, 0.3, 0.2, 6, 5.2, 5.1, 0);
  kit.block(M.steel, 10.6, 0.4, 9, 0, 6.7, 0);
  kit.at = null;
}

/**
 * The mass driver's power hall: pulsed power for the coils - a long hall of
 * capacitor banks and switchgear, radiators on the roof for the heat the
 * coils dump every shot, and a cable bridge over to the rail.
 */
function buildHall(kit: Kit, M: Mats) {
  const { x, z } = HALL;
  kit.at = at(x, z, 0, G0);
  kit.block(M.white, 56, 7.5, 14, 0, 3.75, 0);
  kit.block(M.steel, 57, 0.4, 15, 0, 7.7, 0);
  kit.block(M.dark, 44, 1.2, 0.2, 0, 5.4, 7.05);
  for (let i = 0; i < 9; i++) kit.block(M.radiator, 0.25, 4.2, 12, -24 + i * 6, 9.9, 0);
  for (let i = 0; i < 8; i++) {
    shape(kit, M.steel, new THREE.CylinderGeometry(1.5, 1.5, 5.2, 16), -21 + i * 6, 2.6, 11);
    kit.block(M.dark, 2.2, 0.5, 2.2, -21 + i * 6, 5.4, 11);
  }
  kit.at = null;
  // the cable bridge to the rail's breech end
  for (const bx of [x - 30, x - 16]) {
    kit.member(M.steel, V(bx, G0, z + 8), V(bx, 5.2, z + 8), 0.35);
    kit.member(M.steel, V(bx, 5.2, z + 8), V(bx, 5.2, -3.6), 0.5, 1.2);
    kit.member(M.steel, V(bx, G0, -4.6), V(bx, 5.2, -4.6), 0.35);
  }
}

/**
 * A cargo lander parked on the pad: four legs, a descent stage in gold
 * foil with its engines under it, round propellant tanks, and the cargo
 * stage on top. Sixteen metres, which is what makes the pad read as a pad.
 */
function lander(kit: Kit, M: Mats) {
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const foot = V(sx * 7, 0.35, sz * 7);
    kit.member(M.steel, V(sx * 3.6, 6.2, sz * 3.6), foot, 0.45);
    kit.member(M.steel, V(sx * 4.2, 4.8, sz * 1.4), V(sx * 6.2, 1.6, sz * 6.2), 0.25);
    kit.member(M.steel, V(sx * 1.4, 4.8, sz * 4.2), V(sx * 6.2, 1.6, sz * 6.2), 0.25);
    shape(kit, M.steel, new THREE.CylinderGeometry(1.2, 1.3, 0.35, 16), foot.x, 0.18, foot.z);
    shape(kit, M.white, new THREE.SphereGeometry(1.7, 16, 10), sx * 3.3, 6.6, sz * 3.3);
  }
  shape(kit, M.foil, new THREE.CylinderGeometry(4.5, 4.5, 3.0, 8), 0, 6.6, 0);
  for (const [ex, ez] of [[1.5, 1.5], [1.5, -1.5], [-1.5, 1.5], [-1.5, -1.5]]) {
    shape(kit, M.dark, new THREE.CylinderGeometry(0.45, 1.05, 1.8, 14, 1, true), ex, 4.3, ez);
  }
  shape(kit, M.white, new THREE.CylinderGeometry(3.1, 3.4, 7.2, 20), 0, 11.7, 0);
  shape(kit, M.dark, new THREE.CylinderGeometry(3.12, 3.12, 1.2, 20, 1, true, 0.3, 1.6), 0, 12.4, 0);
  shape(kit, M.steel, new THREE.CylinderGeometry(1.6, 2.6, 1.4, 20), 0, 16.0, 0);
  kit.block(M.foil, 0.2, 4.2, 2.4, 3.3, 10.8, 0);
  for (const a of [0.4, 2.0, 3.6, 5.2]) kit.block(M.dark, 0.7, 0.7, 0.7, Math.cos(a) * 3.5, 14.8, Math.sin(a) * 3.5);
  kit.block(M.red, 0.4, 0.4, 0.4, 0, 16.9, 0);
}

/**
 * The landing pad: a sintered disc with a painted ring, beacons round the
 * edge and a blast berm round that - a lander's exhaust throws regolith
 * sideways at hundreds of metres a second, flat, with nothing to slow it -
 * open on the side the road comes in. A freighter on it, and its cargo.
 */
function buildLanding(kit: Kit, M: Mats, forms: THREE.BufferGeometry[]) {
  const { x, z, r } = LANDING;
  const y0 = ZONES.find((s) => s.cx === x)!.level!;
  kit.at = at(x, z, 0, y0);
  shape(kit, M.sinter, new THREE.CylinderGeometry(r, r + 0.8, 0.5, 72), 0, 0.12, 0);
  shape(kit, M.white, new THREE.RingGeometry(r - 5, r - 4, 72), 0, 0.38, 0, -Math.PI / 2);
  shape(kit, M.white, new THREE.RingGeometry(3.2, 4.2, 48), 0, 0.38, 0, -Math.PI / 2);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    kit.block(M.steel, 0.3, 1.2, 0.3, Math.cos(a) * (r + 1.5), 0.6, Math.sin(a) * (r + 1.5));
    kit.block(M.amber, 0.45, 0.3, 0.45, Math.cos(a) * (r + 1.5), 1.3, Math.sin(a) * (r + 1.5));
  }
  kit.at = at(x + 3, z - 2, 0.5, y0 + 0.36);
  lander(kit, M);
  // cargo, unloaded and waiting for the crawler
  kit.at = at(x - 12, z + 44, 0.3, y0);
  const cargo = [M.white, M.steel, M.white, M.foil, M.white, M.steel];
  cargo.forEach((mat, i) => kit.block(mat, 6, 2.6, 2.6, (i % 3) * 6.6, 1.3 + Math.floor(i / 3) * 2.6, 0));
  kit.at = null;
  // the berm, open to the west-south-west where the road comes in
  forms.push(landform(x, z, 58, 58, 2.4, (px, pz) => {
    const d = Math.hypot(px - x, pz - z);
    if (d < r + 4 || d > 58) return null;
    const a = Math.atan2(pz - z, px - x);
    const gap = Math.abs(Math.atan2(Math.sin(a - 2.62), Math.cos(a - 2.62)));
    const hgt = 3.6 * Math.exp(-(((d - 46) / 5.5) ** 2)) * smooth(0.18, 0.4, gap);
    _c.copy(SOIL.mature).lerp(SOIL.fresh, 0.3 * clamp01(hgt / 3));
    return { y: y0 + hgt + 0.3 * fbm(n2, px / 5, pz / 5, 2), colour: _c.clone() };
  }, groundAt, regolithMaterial(), TILE).geometry);
}

/**
 * The reactor, out past the horizon for the shielding the distance gives:
 * the vessel buried in the berm, the turbine hall, and two long rows of
 * radiators, edge on to the sun so they can shed heat from both faces.
 */
function buildReactor(kit: Kit, M: Mats, forms: THREE.BufferGeometry[]) {
  const { x, z } = REACTOR;
  const y0 = ZONES.find((s) => s.cx === x)!.level!;
  forms.push(landform(x - 30, z, 30, 30, 1.8, (px, pz) => {
    const d = Math.hypot(px - x + 30, pz - z);
    if (d > 30) return null;
    return { y: y0 + 11 * (1 - smooth(8, 28, d)), colour: SOIL.mature.clone() };
  }, groundAt, regolithMaterial(), TILE).geometry);
  kit.at = at(x - 30, z, 0, y0);
  shape(kit, M.white, new THREE.SphereGeometry(9, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 9.5, 0);
  kit.block(M.red, 0.6, 0.6, 0.6, 0, 19, 0);
  kit.at = at(x + 10, z + 20, 0, y0);
  kit.block(M.white, 40, 12, 18, 0, 6, 0);
  kit.block(M.steel, 41, 0.5, 19, 0, 12.25, 0);
  // radiators, their faces turned most of the way across the sun
  // (turned so the face towards the site is the one the sun is on)
  const ry = Math.atan2(-ACROSS.z, ACROSS.x) + Math.PI / 2 - 0.45;
  for (const row of [-1, 1]) {
    kit.at = at(x + 40 + row * 20 * ACROSS.x, z - 30 + row * 20 * ACROSS.z, ry, y0);
    for (let i = 0; i < 8; i++) {
      const px = -70 + i * 20;
      kit.block(M.radiator, 12, 11, 0.3, px, 8, 0);
      kit.member(M.steel, V(px, 0, 0), V(px, 14, 0), 0.45);
    }
    kit.member(M.steel, V(-82, 1.8, 0), V(82, 1.8, 0), 0.9);
  }
  kit.at = null;
}

/** Waypoints of the roads, in plan. */
const ROADS: { pts: [number, number][]; w: number }[] = [
  // the south-east airlock to the landing pad
  { pts: [[45, 48], [120, 62], [230, 54], [330, 2], [415, -90], [446, -126]], w: 8 },
  // the pit's north side out to the reactor
  { pts: [[-180, -44], [-300, -150], [-460, -300], [-800, -560], [-1200, -820], [-1420, -955]], w: 8 },
  // along the rail, and round to the power hall
  { pts: [[66, 16], [150, 16], [228, 14]], w: 6 },
  { pts: [[150, 16], [160, -10], [150, -30]], w: 6 },
];

/** Rover tracks, going off over the horizon on business of their own. */
const TRACKS: [number, number][][] = [
  [[230, 54], [330, 150], [520, 330], [800, 560], [1200, 830], [1700, 1100]],
  [[-270, -8], [-420, 40], [-640, 90], [-950, 170], [-1400, 210]],
  [[-20, -205], [80, -330], [260, -560], [520, -900], [900, -1350]],
  [[-60, 90], [-120, 230], [-40, 520], [140, 900], [380, 1400], [380, 2540]],
];

const ACROSS_N = 4;
/** A strip laid over the ground along a smoothed line through plan points, draped across as well as along. */
function ribbon(pts: [number, number][], w: number, v: number, lift: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, 0, z)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / 4));
  const P: number[] = [], U: number[] = [], I: number[] = [];
  const side = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    side.set(-tan.z, 0, tan.x).normalize();
    // lifted further off the ground where its cells are coarser
    const up = lift + Math.max(0, Math.hypot(p.x, p.z) - 180) * 0.0011;
    for (let k = 0; k <= ACROSS_N; k++) {
      const f = k / ACROSS_N, o = (f - 0.5) * w;
      const x = p.x + side.x * o, z = p.z + side.z * o;
      P.push(x, groundAt(x, z) + up, z);
      U.push(f, (t * len) / v);
    }
    if (i > 0) {
      for (let k = 0; k < ACROSS_N; k++) {
        const a = (i - 1) * (ACROSS_N + 1) + k, b = a + ACROSS_N + 1;
        I.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Roads - regolith graded and rolled flat, a little darker than the ground
 * round it, with the wheel tracks worn in - and rover tracks, just the two
 * ruts pressed into the dust.
 */
function buildRoads(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(9);
  const road = canvasTexture(128, 256, (c, W, H) => {
    c.fillStyle = '#d8d6d2';
    c.fillRect(0, 0, W, H);
    for (const cx of [0.27, 0.73]) {
      const grad = c.createLinearGradient((cx - 0.13) * W, 0, (cx + 0.13) * W, 0);
      grad.addColorStop(0, 'rgba(70,68,64,0)');
      grad.addColorStop(0.5, 'rgba(70,68,64,0.35)');
      grad.addColorStop(1, 'rgba(70,68,64,0)');
      c.fillStyle = grad;
      c.fillRect((cx - 0.13) * W, 0, 0.26 * W, H);
    }
    for (let i = 0; i < 900; i++) {
      c.fillStyle = r() < 0.5 ? 'rgba(60,58,55,0.25)' : 'rgba(250,250,245,0.2)';
      c.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
  });
  road.wrapS = road.wrapT = THREE.RepeatWrapping;
  const track = canvasTexture(64, 128, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    // two ruts with a chevron tread in them
    for (const cx of [0.2, 0.8]) {
      c.fillStyle = 'rgba(40,39,37,0.55)';
      c.fillRect((cx - 0.12) * W, 0, 0.24 * W, H);
      c.fillStyle = 'rgba(25,24,23,0.5)';
      for (let y = 0; y < H; y += 8) {
        c.beginPath();
        c.moveTo((cx - 0.12) * W, y); c.lineTo(cx * W, y + 4); c.lineTo((cx + 0.12) * W, y);
        c.lineTo((cx + 0.12) * W, y + 2); c.lineTo(cx * W, y + 6); c.lineTo((cx - 0.12) * W, y + 2);
        c.fill();
      }
    }
  });
  track.wrapS = track.wrapT = THREE.RepeatWrapping;
  const roadMat = regolithLit(new THREE.MeshStandardMaterial({
    color: 0x5f5e5b, map: road, roughness: 0.93, metalness: 0.05,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), 'psyche-road', false, true);
  const trackMat = new THREE.MeshStandardMaterial({
    map: track, transparent: true, depthWrite: false, roughness: 0.95, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const roads = new THREE.Mesh(mergeGeometries(ROADS.map((rd) => ribbon(rd.pts, rd.w, 12, 0.08))), roadMat);
  roads.receiveShadow = true;
  const tracks = new THREE.Mesh(mergeGeometries(TRACKS.map((t) => ribbon(t, 2.6, 5, 0.1))), trackMat);
  tracks.receiveShadow = true;
  g.add(roads, tracks);
  g.userData.noCollide = true;
  return g;
}

/**
 * Old workings to the west, from before the pit: a hill cut back in benches
 * four metres high, the faces bright where they are still fresh, dust
 * slumped over the rest.
 */
function buildWorkings(forms: THREE.BufferGeometry[]) {
  const { x, z } = WORKINGS;
  const base = groundAt(x, z) - 1.5;
  // the cut: everything inside an arc of 70 m round a point east of the
  // hill's crown was taken out, leaving a floor and a face of benches
  const cx = x + 58;
  forms.push(landform(x + 10, z, 115, 110, 3, (px, pz) => {
    const dx = px - x, dz = pz - z;
    const a = Math.atan2(dz, dx);
    const R = 105 * (1 + 0.1 * n4(Math.cos(a) * 1.6 + 3, Math.sin(a) * 1.6));
    const d = Math.hypot(dx, dz) / R;
    const hill = d < 1 ? 26 * Math.pow(1 - d * d, 1.5) + 1.2 * fbm(n3, px / 14, pz / 14, 2) : 0;
    const cd = Math.hypot(px - cx, pz - z) * (1 + 0.05 * n2(px / 30, pz / 30));
    let y = hill, riser = 0;
    if (cd < 70) {
      const steps = clamp01((cd - 26) / 44) * 5;
      const i = Math.floor(steps), f = steps - i;
      riser = smooth(0.62, 0.95, f) * (i < 5 ? 1 : 0);
      const cut = 1 + 4 * (i + riser) + 0.5 * fbm(n2, px / 6, pz / 6, 2) * (1 - riser);
      if (cut < y) y = cut; else riser = 0;
    }
    if (y <= 0.05 && d >= 1) return null;
    _c.copy(SOIL.mature).lerp(SOIL.dark, 0.25 * clamp01(0.5 + fbm(n4, px / 20, pz / 20, 2)));
    _c.lerp(SOIL.metal, riser * 0.65).lerp(SOIL.fresh, riser * 0.3);
    return { y: base + y, colour: _c.clone() };
  }, groundAt, regolithMaterial(), TILE).geometry);
}

/** An ore stockpile by the west airlock, and the rail's bed of rolled regolith. */
function buildHeaps(forms: THREE.BufferGeometry[]) {
  forms.push(landform(-176, -30, 16, 16, 1, (px, pz) => {
    const d = Math.hypot(px + 176, pz + 30);
    if (d > 16) return null;
    _c.copy(SOIL.ore).multiplyScalar(0.85 + 0.25 * fbm(n3, px / 2, pz / 2, 2));
    return { y: G0 + 7.5 * (1 - d / 15) + 0.35 * fbm(n2, px / 2.5, pz / 2.5, 2), colour: _c.clone() };
  }, groundAt, regolithMaterial(), TILE).geometry);
  // the pylons' footings stand on a bed a little over the pad datum
  forms.push(landform(146, 0, 80, 6, 1, (px, pz) => {
    if (px < 70) return null;
    const u = Math.abs(pz) / 4.5;
    _c.copy(SOIL.trod).lerp(SOIL.mature, 0.3);
    return { y: G0 + 0.42 * (1 - smooth(0.7, 1.25, u)), colour: _c.clone() };
  }, groundAt, regolithMaterial(), TILE).geometry);
}

/**
 * The solar farm: rows of tables turned to the low sun, spaced so one row's
 * shadow just misses the next. At 2.9 AU sunlight is an eighth of Earth's,
 * which is why there is so much of it - and why the reactor.
 */
function buildFarm(): THREE.Group {
  const g = new THREE.Group();
  const { rows, tables } = FARM;
  const W = 20, D = 4.2;
  // the face to the sun (+z) last in the index, as its own group
  const panelGeo = new THREE.BoxGeometry(W, D, 0.14);
  const ix = Array.from(panelGeo.index!.array);
  panelGeo.setIndex([...ix.slice(0, 24), ...ix.slice(30, 36), ...ix.slice(24, 30)]);
  panelGeo.clearGroups();
  panelGeo.addGroup(0, 30, 0);
  panelGeo.addGroup(30, 6, 1);
  const frameParts: THREE.BufferGeometry[] = [];
  for (const sx of [-W * 0.3, W * 0.3]) {
    const post = new THREE.BoxGeometry(0.25, 3, 0.25);
    post.translate(sx, -1.5, -0.3);
    frameParts.push(post);
  }
  const tube = new THREE.BoxGeometry(W, 0.3, 0.3);
  tube.translate(0, 0, -0.2);
  frameParts.push(tube);
  const frameGeo = mergeGeometries(frameParts.map((p) => { p.deleteAttribute('uv'); return p; }));
  // the cells, in their frame: 24 by 5 to a table
  const cells = canvasTexture(256, 64, (c, w, h) => {
    c.fillStyle = '#8a9098';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b2640';
    c.fillRect(2, 2, w - 4, h - 4);
    c.fillStyle = 'rgba(120,140,170,0.55)';
    for (let i = 1; i < 24; i++) c.fillRect(2 + (i * (w - 4)) / 24, 2, 1, h - 4);
    for (let j = 1; j < 5; j++) c.fillRect(2, 2 + (j * (h - 4)) / 5, w - 4, 1);
  });
  const panelMat = new THREE.MeshStandardMaterial({ map: cells, roughness: 0.22, metalness: 0.5 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.5, metalness: 0.7 });
  const n = rows * tables;
  const backMat = new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.6, metalness: 0.3 });
  const panels = new THREE.InstancedMesh(panelGeo, [backMat, panelMat], n);
  const frames = new THREE.InstancedMesh(frameGeo, frameMat, n);
  // a table's face points at the sun: its local z along SUN, its long side across
  const basis = new THREE.Matrix4().makeBasis(ACROSS, new THREE.Vector3().crossVectors(SUN, ACROSS).normalize(), SUN);
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const m = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < tables; j++) {
      const along = (j - (tables - 1) / 2) * (W + 1.2), back = (i - (rows - 1) / 2) * 11;
      const x = FARM.x + ACROSS.x * along + SUN_H.x * back, z = FARM.z + ACROSS.z * along + SUN_H.z * back;
      m.compose(V(x, groundAt(x, z) + 3.0, z), q, V(1, 1, 1));
      panels.setMatrixAt(k, m);
      frames.setMatrixAt(k, m);
      k++;
    }
  }
  for (const inst of [panels, frames]) {
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.layers.enable(STATIC);
    g.add(inst);
  }
  g.userData.noCollide = true;
  return g;
}

/**
 * Poles carrying the reactor's power in to the site, beside the road - on a
 * body this small they go down behind the horizon one at a time - and, far
 * to the south, the relay mast that talks to Kiln Station, its foot already
 * under the curve.
 */
function buildPower(kit: Kit, M: Mats) {
  const pts = ROADS[1].pts;
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => V(x, 0, z)), false, 'centripetal');
  const len = curve.getLength();
  let last: THREE.Vector3[] | null = null;
  for (let s = 30; s < len - 20; s += 80) {
    const p = curve.getPointAt(s / len), tan = curve.getTangentAt(s / len);
    const x = p.x + tan.z * 12, z = p.z - tan.x * 12;
    const ry = Math.atan2(-tan.z, tan.x);
    kit.at = at(x, z, ry);
    kit.member(M.steel, V(0, 0, 0), V(0, 15, 0), 0.45);
    kit.block(M.steel, 0.4, 0.4, 6.4, 0, 14.4, 0);
    kit.at = null;
    // the conductors, straight between poles: at 0.015 g they hardly sag
    const y = groundAt(x, z);
    const wires = [-2.8, 0, 2.8].map((o) => V(x + Math.sin(ry) * o, y + 14.1, z + Math.cos(ry) * o));
    if (last && Math.hypot(x, z) < 900) wires.forEach((w, i) => kit.member(M.dark, last![i], w, 0.07));
    last = wires;
  }
  kit.at = at(RELAY.x, RELAY.z, 0.4);
  mast(kit, M, 62, 2.4);
  kit.block(M.white, 1.6, 3, 1.6, 0, 40, 1.8);
  shape(kit, M.white, new THREE.SphereGeometry(2.4, 16, 6, 0, Math.PI * 2, 0, 0.9), 0, 46, 2.6, -1.9, 0.3, 0);
  kit.block(M.white, 5, 3, 3, 4, 1.5, 4);
  kit.at = null;
}

// ------------------------------------------------------------- the dust

/**
 * Dust thrown up by the wheels. There is no air, so there is no cloud: each
 * grain goes up in its own clean parabola and comes down where the arc puts
 * it - and in 0.015 g a grain thrown up at a metre a second rises three and a
 * half metres and takes fourteen seconds about it. Worked out on the GPU from
 * where and when each grain left the wheel; the CPU only writes new ones.
 */
class Ballistic {
  points: THREE.Points;
  private p0: Float32Array;
  private v0: Float32Array;
  private t0: Float32Array;
  private head = 0;
  private time: { value: number };

  constructor(private n: number, g: number) {
    this.p0 = new Float32Array(n * 3);
    this.v0 = new Float32Array(n * 3);
    this.t0 = new Float32Array(n * 2).fill(-1e6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p0, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(this.v0, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.t0, 2));
    this.time = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uG: { value: g }, uScale: { value: 600 } },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aVel;
        attribute vec2 aLife;
        uniform float uTime, uG, uScale;
        varying float vA;
        void main() {
          float t = uTime - aLife.x;
          vec3 p = position + aVel * t - vec3(0.0, 0.5 * uG * t * t, 0.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          bool live = t > 0.0 && t < aLife.y;
          vA = live ? 1.0 - smoothstep(aLife.y - 0.6, aLife.y, t) : 0.0;
          gl_PointSize = live ? clamp(uScale * 0.1 / -mv.z, 1.0, 4.0) : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float a = vA * smoothstep(0.25, 0.1, dot(q, q));
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.42, 0.41, 0.39), a * 0.55);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.userData.noCollide = true;
  }

  /** A grain from p at velocity v, now, landing when it gets back to `floor`. */
  emit(p: THREE.Vector3, v: THREE.Vector3, now: number, floor: number, g: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.p0.set([p.x, p.y, p.z], i * 3);
    this.v0.set([v.x, v.y, v.z], i * 3);
    const life = (v.y + Math.sqrt(v.y * v.y + 2 * g * Math.max(0, p.y - floor))) / g;
    this.t0[i * 2] = now;
    this.t0[i * 2 + 1] = life;
  }

  update(now: number, scale: number, fresh: boolean) {
    this.time.value = now;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    if (!fresh) return;
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aVel.needsUpdate = true;
    geo.attributes.aLife.needsUpdate = true;
  }
}

// ------------------------------------------------------------- the baked shadow

/**
 * Draw everything that never moves (the STATIC layer) once from the sun into
 * a depth map covering four kilometres, for the ground to look up past the
 * reach of the live shadow map.
 */
function bakeSunShadow(stage: Stage, land: THREE.Object3D) {
  const HALF = 2000;
  const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 9000);
  cam.position.copy(SUN).multiplyScalar(4500).add(V(-20, 0, 0));
  cam.lookAt(-20, 0, 0);
  cam.updateMatrixWorld();
  cam.layers.set(STATIC);
  const rt = new THREE.WebGLRenderTarget(SUN_SHADOW.size, SUN_SHADOW.size, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
  });
  const scene = new THREE.Scene();
  // back faces, as the live shadow pass draws them: lit ground has none, so it
  // never shadows itself, and the far side of a ridge is what occludes
  scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide });
  const parent = land.parent;
  scene.add(land);
  const r = stage.renderer;
  const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
  const auto = r.shadowMap.autoUpdate;
  r.shadowMap.autoUpdate = false;
  r.setRenderTarget(rt);
  r.setClearColor(0xffffff, 1);
  r.clear();
  r.render(scene, cam);
  r.setRenderTarget(null);
  r.setClearColor(prevClear, prevAlpha);
  r.shadowMap.autoUpdate = auto;
  r.shadowMap.needsUpdate = true;
  parent?.add(land);
  (scene.overrideMaterial as THREE.Material).dispose();
  // world to [0,1] in the map, depth included
  SUN_SHADOW.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    .multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  SUN_SHADOW.map = rt.texture;
}

// ------------------------------------------------------------------ assembly

/**
 * Lay Psyche round the plant: the stage has already had PSYCHE_LOOK applied
 * over the scenario's own look.
 */
export function buildAsteroid(root: THREE.Group, stage: Stage): Dressing {
  seedWorld();
  // No air: nothing fades with distance, so there is no fog at all. Every
  // material on the page is compiled after this, at the first frame.
  stage.scene.fog = null;
  stage.hideDome();
  // the pad's survey grid is wider than the pad, and would lie across the regolith
  root.traverse((o) => { if (o.type === 'GridHelper') o.visible = false; });
  stage.aimSun(SUN);
  // A wider live shadow map, over the rail and the pit as well as the plant,
  // at about the texel size the plant had before; past it, the baked one.
  const key = stage.key;
  key.target.position.set(-25, 0, 0);
  key.position.add(key.target.position);
  key.shadow.mapSize.set(3072, 3072);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -190;
  cam.right = cam.top = 190;
  cam.far = 900;
  cam.updateProjectionMatrix();
  // the ground goes out past the horizon, and from a height that is kilometres off
  stage.camera.far = 9000;
  stage.camera.updateProjectionMatrix();

  const land = new THREE.Group();
  land.name = 'psyche';
  root.add(land);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMaterial());
  sky.frustumCulled = false;
  // drawn after the solid things, so it only shades the sky that shows (see earth.ts)
  sky.renderOrder = 1000;
  sky.userData.noCollide = true;
  land.add(sky);
  const stars = skyStars();
  land.add(stars);

  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMaterial());
  envSky.frustumCulled = false;
  envScene.add(envSky);
  stage.environmentFrom(envScene);
  envSky.geometry.dispose();
  (envSky.material as THREE.Material).dispose();

  regolithDetail();
  land.add(buildBody());

  // the outpost: what is near enough to walk into is solid, the rest is scenery
  const M = outpostMaterials();
  const near = new Kit(), far = new Kit();
  // landforms: the near ones cast into the live shadow map, the far ones only into the baked one
  const forms: THREE.BufferGeometry[] = [], farForms: THREE.BufferGeometry[] = [];
  buildHab(near, M, forms);
  buildEastLock(near, M);
  buildHall(near, M);
  buildLanding(far, M, farForms);
  buildReactor(far, M, farForms);
  buildPower(far, M);
  buildWorkings(farForms);
  buildHeaps(forms);
  const nearG = new THREE.Group(), farG = new THREE.Group();
  near.build(nearG);
  far.build(farG);
  nearG.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.collider = true; o.layers.enable(STATIC); } });
  farG.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.layers.enable(STATIC); } });
  farG.userData.noCollide = true;
  const formMesh = (list: THREE.BufferGeometry[], cast: boolean) => {
    const geo = mergeGeometries(list);
    geo.setAttribute('aWild', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(1), 1));
    const m = new THREE.Mesh(geo, regolithMaterial());
    m.receiveShadow = true;
    m.castShadow = cast;
    m.userData.noCollide = true;
    m.layers.enable(STATIC);
    return m;
  };
  land.add(nearG, farG, formMesh(forms, true), formMesh(farForms, false), buildFarm(), buildRoads());
  land.add(buildRocks());
  bakeSunShadow(stage, land);

  // the dome, the pit, the trucks and Kiln Station, as they were
  const plant = buildSpace(root);
  const dust = new Ballistic(3000, 0.144);
  land.add(dust.points);

  const starScale = (stars.material as THREE.ShaderMaterial).uniforms.uScale;
  const r = rng(5);
  const last = plant.trucks.map((tr) => tr.position.clone());
  const vel = new THREE.Vector3(), from = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3();
  let carry = 0;
  const size = new THREE.Vector2();
  return {
    update(t: Telemetry, dt: number, now: number) {
      plant.update(t, dt, now);
      starScale.value = stage.renderer.getPixelRatio();
      // Every rolling wheel lifts a little regolith. A grain leaves the tyre
      // with the rim's own velocity where it lets go: nothing at the contact
      // patch, (v, v) at the back of the tyre - so over the ground it goes up
      // and a little forward, and the truck simply drives out from under it.
      // The mudguards take most of the fast ones. What is left is low and
      // slow: a grain thrown up at half a metre a second still hangs seven
      // seconds in 0.015 g.
      carry += dt * 18;
      const grains = Math.floor(carry);
      carry -= grains;
      let emitted = false;
      plant.trucks.forEach((tr, i) => {
        const speed = dt > 0 ? tr.position.distanceTo(last[i]) / dt : 0;
        last[i].copy(tr.position);
        if (speed < 0.5 || speed > 30) return;
        fwd.set(Math.cos(tr.rotation.y), 0, -Math.sin(tr.rotation.y));
        side.set(-fwd.z, 0, fwd.x);
        for (let k = 0; k < grains; k++) {
          const wheel = r() < 0.5 ? -2 : 2.6, s = r() < 0.5 ? -1.7 : 1.7;
          // where round the back of the tyre it lets go, from the contact patch up
          const th = 0.9 * r() * r();
          from.copy(tr.position).addScaledVector(fwd, wheel - 0.8 * Math.sin(th)).addScaledVector(side, s)
            .setY(tr.position.y + 0.8 * (1 - Math.cos(th)) + 0.05);
          vel.copy(fwd).multiplyScalar(speed * (1 - Math.cos(th)) * 0.7).addScaledVector(side, (r() - 0.5) * 0.25 * speed * th);
          vel.y = Math.min(1.1, speed * Math.sin(th) * 0.55);
          dust.emit(from, vel, now, G0, 0.144);
          emitted = true;
        }
      });
      dust.update(now, stage.renderer.getSize(size).y * stage.renderer.getPixelRatio()
        / (2 * Math.tan((stage.camera.fov * Math.PI) / 360)), emitted);
    },
  };
}
