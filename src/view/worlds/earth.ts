/**
 * Today, on the surface: a working underground gold mine in the goldfields,
 * late in the afternoon. Red earth and grey scrub out to a line of flat-topped
 * breakaways in the haze; the headframe over the shaft, with its winder house
 * and the ore pile at its foot; the benched waste dump the development rock
 * went to, and the tailings dam the paste plant exists to keep from growing.
 *
 * One sky does all of it. The same function colours the dome, the haze the
 * distant ground fades into and the reflections in the steel, so the far hills
 * go into the sky without an edge and everything on site agrees about where
 * the light is coming from.
 *
 * Everything here is built once and never moves, and none of it adds a light:
 * it costs a few draw calls and some triangles, not a laptop's frame rate.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Telemetry } from '../../sim/plant';
import type { Look } from '../../scenario';
import type { Stage } from '../scene';
import type { GroundSpec } from '../terrain';
import { ROCK } from '../terrain';
import { Dressing, rng, canvasTexture, clamp01 } from './common';
import {
  lin, perlin, fbm, torusNoise, srgbByte, smooth, rrect, gridAxis, heightfield, landform,
  twoScale, mergeVerts, selfShade, Kit,
} from './land';

// ------------------------------------------------------------------ the sun

/** Towards the sun: low in the west-south-west, behind the usual view of the plant. */
const SUN = new THREE.Vector3(-0.66, 0.41, 0.63).normalize();

/**
 * The lighting that goes with that sky. Applied over Today's own look, which
 * Paste Wars still uses as it is: the arena keeps its night.
 */
export const GOLDFIELDS_LOOK: Partial<Look> = {
  fog: { color: 0xbccbd8, density: 0.00048 },
  hemi: { sky: 0x9ab8dc, ground: 0x8a5a3c, intensity: 0.32 },
  key: { color: 0xffd9ae, intensity: 3.1 },
  fill: 0.22,
  rim: 0.15,
  pools: 0.3,
  exposure: 1.0,
  bloom: [0.3, 0.45, 0.96],
  env: 0.95,
};

/** The pad as a concrete hardstand, with its saw-cut joints; the kerb is painted, not lit. */
export const GOLDFIELDS_GROUND: GroundSpec = {
  plain: 0x8a5a3c, pad: 0x847a70, grid: [0x57504a, 0x57504a], kerb: 0xe8b82a, cut: true,
  plainless: true, gridOpacity: 0.28, kerbGlow: 0.35,
};

// --------------------------------------------------------------- the sky

/**
 * The sky, as GLSL: `skyBase(dir)` is the clear sky with the glow round the
 * sun and none of the sun's disc or the cloud - what the haze is made of.
 * Shared by the dome, the reflections and every piece of distant ground.
 */
const SKY_COLOURS = {
  zenith: lin(0x3a6cb8, 0.52),
  horizon: lin(0xbfd0e0, 0.8),
  horizonSun: lin(0xf2d6ae, 1.05),
  glow: lin(0xffc88a, 1.0),
};

const SKY_GLSL = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHorizonSun;
uniform vec3 uGlow;

vec3 skyBase(vec3 d) {
  float mu = dot(d, uSun);
  float y = max(d.y, 0.0);
  // the horizon is warmer and brighter under the sun than away from it
  vec3 horizon = mix(uHorizon, uHorizonSun, pow(0.5 + 0.5 * mu, 3.0));
  // a thin bright band at the horizon, deep blue by forty degrees up
  vec3 c = mix(horizon, uZenith, 1.0 - exp(-y * 4.2));
  // forward scattering: a wide haze round the sun and a tight halo
  float m = max(mu, 0.0);
  c += uGlow * (0.28 * pow(m, 5.0) + 0.9 * pow(m, 60.0)) * (1.0 - 0.55 * y);
  return c;
}

/** The sky just above the horizon in this direction - the colour of the haze. */
vec3 hazeColour(vec3 d) {
  return skyBase(normalize(vec3(d.x, 0.035, d.z)));
}
`;

function skyUniforms() {
  return {
    uSun: { value: SUN.clone() },
    uZenith: { value: SKY_COLOURS.zenith },
    uHorizon: { value: SKY_COLOURS.horizon },
    uHorizonSun: { value: SKY_COLOURS.horizonSun },
    uGlow: { value: SKY_COLOURS.glow },
  };
}

/**
 * The dome. It is drawn at infinity round wherever the camera is, so the
 * horizon never shifts as you orbit. Below the horizon it is the haze, the
 * same colour the ground has faded to by the time the ground runs out.
 * For the reflections (`env`) it has no sun disc and no cloud, and the ground
 * below it is lit red earth.
 */
function skyMaterial(env: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { ...skyUniforms(), uTime: { value: 0 } },
    defines: env ? { SKY_ENV: 1 } : {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform float uTime;
      varying vec3 vDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return s;
      }

      void main() {
        vec3 d = normalize(vDir);
      #ifdef SKY_ENV
        vec3 c = d.y >= 0.0 ? skyBase(d)
          : mix(hazeColour(d), vec3(0.24, 0.13, 0.08), smoothstep(0.0, -0.2, d.y));
      #else
        vec3 c = d.y >= 0.0 ? skyBase(d) : hazeColour(d);
        // Underground (the opening dives into the long-section) any sky you
        // could see is through rock: dark, as the old night dome was.
        float under = smoothstep(-1.0, -4.0, cameraPosition.y);
        if (under >= 1.0) { gl_FragColor = vec4(0.009, 0.010, 0.013, 1.0); return; }
        if (d.y > 0.0) {
          float mu = dot(d, uSun);
          // high cloud: streaks of cirrus combed along the wind, on a plane
          // well above the ground so they bunch together towards the horizon
          vec2 p = d.xz / (d.y + 0.12);
          vec2 q = vec2(p.x * 0.9 + p.y * 0.45, p.y * 0.35 - p.x * 0.2) * 1.3 + vec2(uTime * 0.004, 0.0);
          float streak = fbm(q * vec2(0.35, 2.2));
          float thin = smoothstep(0.44, 0.68, streak) * smoothstep(0.3, 0.6, fbm(p * 0.25 + 3.7));
          // a few flat patches of altocumulus lower down
          float puff = smoothstep(0.5, 0.66, fbm(p * 1.7 + vec2(uTime * 0.006, 5.0)))
                     * smoothstep(0.42, 0.62, fbm(p * 0.3 - 2.1));
          float cover = clamp(thin * 0.7 + puff * 0.85, 0.0, 1.0) * smoothstep(0.015, 0.16, d.y);
          // lit from the side by a low sun: bright and warm towards it, grey away
          vec3 lit = mix(vec3(0.62, 0.64, 0.68), vec3(1.25, 0.98, 0.72), pow(0.5 + 0.5 * mu, 2.0));
          lit += uGlow * 1.4 * pow(max(mu, 0.0), 12.0);
          c = mix(c, lit, cover * 0.85);
          // the sun itself, well over the tone curve so the bloom finds it
          c += vec3(60.0, 52.0, 40.0) * smoothstep(0.99994, 0.99998, mu) * (1.0 - cover * 0.8);
        }
        c = mix(c, vec3(0.009, 0.010, 0.013), under);
      #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/**
 * Distant things fade into the sky behind them, not into one flat colour:
 * warmer under the sun, bluer away from it. The fade itself is the scene's
 * own fog curve, so the plant (which has ordinary fog) and the ground it
 * stands on agree to the metre. Past the edge of the world it is all haze.
 */
function hazed<M extends THREE.Material>(mat: M): M {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, skyUniforms());
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${SKY_GLSL}`)
      .replace('#include <fog_fragment>', /* glsl */ `
        #ifdef USE_FOG
          vec3 hazeDir = normalize(transpose(mat3(viewMatrix)) * (-vViewPosition));
          float hazeK = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          hazeK = max(hazeK, smoothstep(1500.0, 1900.0, vFogDepth));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColour(hazeDir), hazeK);
        #endif`);
  };
  // one program for every hazed material of the same kind
  mat.customProgramCacheKey = () => 'goldfields-haze';
  return mat;
}

const n1 = perlin(11), n2 = perlin(23), n3 = perlin(37), n4 = perlin(41);

// ------------------------------------------------------------ the land

/** The plain the plant is set on, as the old flat ground had it. */
const G0 = -0.4;
/** How far the ground goes. Past this it is haze, and the camera's far plane. */
const EDGE = 1950;
/** Inside this the ground is something you can walk on. */
const NEAR = 300;

/**
 * Level ground: what the plant stands on, the pad at the shaft, and the
 * approach the trucks come in by (they drive at pad level).
 */
const SITE = [
  { cx: -30, cz: 5, hx: 160, hz: 82, r: 30 },
  { cx: 125, cz: -128, hx: 80, hz: 58, r: 20 },
  { cx: -225, cz: -40, hx: 45, hz: 20, r: 10 },
];

const HEADFRAME = { x: 124, z: -128 };
const DUMP = { cx: -390, cz: -390, hx: 200, hz: 130, r: 70, lift: 13, batter: 20, bench: 14 };
const TSF = { cx: 470, cz: -400, hx: 240, hz: 190, r: 90, crest: 13, pond: { x: 520, z: -450, r: 75 } };

/** 0 on the site, 1 out in the bush. */
function wild(x: number, z: number) {
  let d = Infinity;
  for (const s of SITE) d = Math.min(d, rrect(x, z, s.cx, s.cz, s.hx, s.hz, s.r));
  return smooth(0, 70, d);
}

/** The natural ground, before anyone levelled any of it. */
function natural(x: number, z: number) {
  let h = 2.6 * fbm(n1, x / 230, z / 230, 4) + 0.45 * fbm(n2, x / 38, z / 38, 2);
  // a dry creek wandering through, where the trees are
  h -= 1.6 * Math.exp(-(creek(x, z) ** 2) / 300);
  // Breakaways: the old land surface, standing as flat-topped mesas with a
  // scarp on the edge, and the country rising to meet them out in the haze.
  const r = Math.hypot(x, z);
  const far = smooth(650, 1100, r);
  if (far > 0) {
    const m = fbm(n3, x / 620, z / 620, 3);
    const mesa = smooth(0.02, 0.09, m) * (0.8 + 0.25 * fbm(n4, x / 90, z / 90, 2));
    h += far * (mesa * 55 + smooth(1150, 1850, r) * 34);
  }
  return h;
}

/** Signed distance (m) across the creek line, which passes north of the shaft. */
function creek(x: number, z: number) {
  return z - (-300 + 0.18 * x + 60 * Math.sin(x / 190) + 25 * Math.sin(x / 67 + 1));
}

function height(x: number, z: number) {
  return G0 + wild(x, z) * natural(x, z);
}

/** How thick the scrub is here, 0..1: patchy, and none on the site or the roads. */
function scrub(x: number, z: number) {
  return clamp01(0.55 + 0.9 * fbm(n2, x / 140, z / 140, 3)) * wild(x, z);
}

// ---- colour of the ground

const EARTH = {
  red: lin(0x9c5634), deep: lin(0x7e412a), pale: lin(0xc49a7c), gravel: lin(0xa88c72),
  scrubTint: lin(0x6f705a), creek: lin(0x8a5a40),
};

const _c = new THREE.Color();
function earthColour(x: number, z: number, out: THREE.Color) {
  const w = wild(x, z);
  out.copy(EARTH.red).lerp(EARTH.deep, clamp01(0.5 + fbm(n4, x / 55, z / 55, 3)));
  // claypans: pale, flat, bare
  out.lerp(EARTH.pale, smooth(0.18, 0.4, fbm(n1, x / 320 + 9, z / 320, 3)) * 0.7);
  // the bush from far enough away that the bushes are smaller than a pixel
  out.lerp(EARTH.scrubTint, scrub(x, z) * (0.25 + 0.35 * smooth(150, 700, Math.hypot(x, z))));
  out.lerp(EARTH.creek, 0.5 * Math.exp(-(creek(x, z) ** 2) / 500));
  // trafficked ground round the site: compacted gravel
  _c.copy(EARTH.gravel).lerp(EARTH.red, clamp01(0.35 + 0.5 * fbm(n3, x / 25, z / 25, 2)));
  out.lerp(_c, 1 - w);
  return out;
}

/**
 * The ground grid along one axis: four metres over the site, opening out to
 * forty in the haze, with the lines the cutaway and the walkable edge need.
 */
const axis = (breaks: number[]) => gridAxis(EDGE, breaks, (a) => Math.min(42, 4 + Math.max(0, a - 190) * 0.032));

let detailTex: { map: THREE.Texture; normal: THREE.Texture } | null = null;

/**
 * The close-up grain of the ground: ironstone gravel, a scatter of quartz and
 * a crust that catches a low sun. A multiplier over the ground's colour,
 * white on average, and a normal map from the same heights.
 */
function groundDetail() {
  if (detailTex) return detailTex;
  const S = 512;
  const r = rng(5);
  const hgt = new Float32Array(S * S);
  const tile = perlin(77), tile2 = perlin(78);
  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      hgt[v * S + u] = 0.5 * torusNoise(tile, u, v, S, 3) + 0.25 * torusNoise(tile, u, v, S, 7)
        + 0.15 * torusNoise(tile2, u, v, S, 17);
    }
  }
  const tint = new Float32Array(S * S * 3).fill(1);
  // pebbles: ironstone (dark) and quartz (pale), each a little dome
  for (let i = 0; i < 2600; i++) {
    const px = r() * S, py = r() * S;
    const rad = 1.2 + r() * r() * 5;
    const quartz = r() < 0.12;
    const col = quartz ? [1.25, 1.22, 1.18] : [0.55 + r() * 0.2, 0.42 + r() * 0.15, 0.34 + r() * 0.1];
    for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
      for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
        const d = Math.hypot(dx, dy) / rad;
        if (d > 1) continue;
        const u = ((Math.floor(px) + dx) % S + S) % S, v = ((Math.floor(py) + dy) % S + S) % S;
        const k = v * S + u;
        hgt[k] += Math.sqrt(1 - d * d) * rad * 0.18;
        const e = d < 0.8 ? 1 : 1 - (d - 0.8) / 0.2;
        for (let c = 0; c < 3; c++) tint[k * 3 + c] += (col[c] - tint[k * 3 + c]) * e;
      }
    }
  }
  const map = canvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let k = 0; k < S * S; k++) {
      const l = 0.86 + 0.14 * hgt[k];
      for (let c = 0; c < 3; c++) img.data[k * 4 + c] = srgbByte(l * tint[k * 3 + c]);
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  const normal = canvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    const at = (u: number, v: number) => hgt[((v + S) % S) * S + ((u + S) % S)];
    for (let v = 0; v < S; v++) {
      for (let u = 0; u < S; u++) {
        const nx = (at(u - 1, v) - at(u + 1, v)) * 1.6, ny = (at(u, v - 1) - at(u, v + 1)) * 1.6;
        const l = Math.hypot(nx, ny, 1);
        const k = (v * S + u) * 4;
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

function groundMaterial() {
  const { map, normal } = groundDetail();
  return twoScale(hazed(new THREE.MeshStandardMaterial({
    vertexColors: true, map, normalMap: normal, normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.96, metalness: 0,
  })), 'goldfields-ground');
}

/** The ground to the horizon, leaving the long-section cutaway open. */
function buildLand(): THREE.Group {
  return heightfield({
    xs: axis([ROCK.x0, ROCK.x1, -NEAR, NEAR]),
    zs: axis([ROCK.z0, ROCK.z1, -NEAR, NEAR]),
    height,
    colour: earthColour,
    hole: (x, z) => x > ROCK.x0 && x < ROCK.x1 && z > ROCK.z0 && z < ROCK.z1,
    near: NEAR,
    material: groundMaterial(),
    tile: 5,
  });
}

/** A landform on its own finer grid, on this ground, in its material. */
const form = (
  cx: number, cz: number, hx: number, hz: number, step: number,
  shape: (x: number, z: number) => { y: number; colour: THREE.Color } | null,
) => landform(cx, cz, hx, hz, step, shape, height, groundMaterial());

/**
 * Waste dump: two lifts on the angle of repose, a bench between, a flat top.
 * Built up from a level datum a little under the ground, so the top is flat
 * whatever the ground under it does.
 */
function buildDump(): THREE.Mesh {
  const D = DUMP;
  const base = height(D.cx, D.cz) - 1.5;
  // fresh rock from underground is grey; only some of it came up oxidised
  const rock = lin(0x918c86), oxide = lin(0x8a6a55), top = lin(0xa39b91);
  const c = new THREE.Color();
  return form(D.cx, D.cz, D.hx + 20, D.hz + 20, 4, (x, z) => {
    const u = -rrect(x, z, D.cx, D.cz, D.hx, D.hz, D.r);
    if (u < -16) return null;
    const lift = D.lift * clamp01(u / D.batter) + D.lift * clamp01((u - D.batter - D.bench) / D.batter);
    // tip-head streaks down the faces, rust where the oxidised rock went
    const streak = fbm(n4, x / 9 + z / 40, z / 9 - x / 40, 2);
    c.copy(rock).lerp(oxide, clamp01(0.2 + streak));
    if (u > 2 * D.batter + D.bench) c.lerp(top, 0.6);
    if (u < 3) c.lerp(EARTH.red, clamp01((3 - u) / 10));
    return { y: base + lift, colour: c.clone() };
  });
}

/**
 * The tailings dam: a wall all round, dry grey tailings inside sloping down
 * to a decant pond at the far end. Only the pond is water.
 */
function buildTsf(): THREE.Group {
  const T = TSF;
  const g = new THREE.Group();
  const wall = lin(0x94704f), dry = lin(0xb8b0a2), wet = lin(0x7c776e);
  const c = new THREE.Color();
  const outer = 3; // 1 in 3 on the outside
  // The crest and the beach are at fixed levels - a dam is built to a level,
  // not to the lie of the land - from a datum a little under the ground.
  const base = height(T.cx, T.cz) - 1.5;
  const crestY = base + T.crest;
  const beachAt = (dp: number) => crestY - 1.2 - 4.4 * (1 - smooth(0, 260, dp));
  g.add(form(T.cx, T.cz, T.hx + 50, T.hz + 50, 5, (x, z) => {
    const u = -rrect(x, z, T.cx, T.cz, T.hx, T.hz, T.r);
    if (u < -12) return null;
    const toCrest = T.crest * outer;
    if (u < toCrest + 10) {
      // the wall, and its crest road
      c.copy(wall).lerp(lin(0x7f5c42), clamp01(0.5 + fbm(n2, x / 12, z / 12, 2)));
      if (u > toCrest) c.lerp(EARTH.gravel, 0.5);
      if (u < 3) c.lerp(EARTH.red, clamp01((3 - u) / 8));
      return { y: base + T.crest * clamp01(u / toCrest), colour: c.clone() };
    }
    // the beach, falling a few metres from the wall to the pond
    const dp = Math.hypot(x - T.pond.x, z - T.pond.z);
    const damp = 1 - smooth(T.pond.r, T.pond.r + 90, dp);
    c.copy(dry).lerp(wet, damp * 0.85);
    c.lerp(lin(0xcfc7b8), smooth(0.2, 0.5, fbm(n1, x / 30, z / 30, 3)) * 0.35 * (1 - damp));
    return { y: beachAt(dp), colour: c.clone() };
  }));

  // The decant pond: a flat sheet under the beach, which shows wherever the
  // beach dips below it - so the shore is wherever the tailings say it is.
  const pondY = beachAt(0) + 0.9;
  const shape = new THREE.Shape();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const rr = T.pond.r * 1.1 * (1 + 0.18 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7));
    const px = Math.cos(a) * rr * 1.25, pz = Math.sin(a) * rr * 0.8;
    if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
  }
  const pond = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 4),
    // murky, and only a little glassy: wind ruffles a pond this size
    hazed(new THREE.MeshStandardMaterial({ color: 0x46524b, roughness: 0.22, metalness: 0, envMapIntensity: 0.55 })),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(T.pond.x, pondY, T.pond.z);
  pond.userData.noCollide = true;
  g.add(pond);
  return g;
}

// ------------------------------------------------------------ the roads

/** Plan (x, z) points; a road is laid over the ground through them. */
const ROADS: { pts: [number, number][]; w: number; bund: boolean }[] = [
  // the access road in from the west, onto the north side of the pad
  { pts: [[-1950, -330], [-1400, -250], [-900, -150], [-520, -80], [-260, -52], [-150, -48]], w: 9, bund: false },
  // along the north side of the site, and out to the shaft
  { pts: [[-150, -48], [0, -47], [70, -60], [100, -85]], w: 10, bund: false },
  // the haul road from the ore pad to the waste dump
  { pts: [[80, -160], [20, -205], [-80, -250], [-190, -290], [-250, -310]], w: 14, bund: true },
  // and round to the tailings dam
  { pts: [[160, -150], [210, -190], [245, -225], [262, -262]], w: 9, bund: false },
];

let roadTex: THREE.Texture | null = null;
/** Two worn wheel tracks down a dusty road, across u. */
function roadTexture() {
  if (roadTex) return roadTex;
  const r = rng(9);
  roadTex = canvasTexture(128, 256, (g, W, H) => {
    g.fillStyle = '#e6ddd2';
    g.fillRect(0, 0, W, H);
    for (const cx of [0.28, 0.72]) {
      const grad = g.createLinearGradient((cx - 0.12) * W, 0, (cx + 0.12) * W, 0);
      grad.addColorStop(0, 'rgba(120,95,80,0)');
      grad.addColorStop(0.5, 'rgba(120,95,80,0.32)');
      grad.addColorStop(1, 'rgba(120,95,80,0)');
      g.fillStyle = grad;
      g.fillRect((cx - 0.12) * W, 0, 0.24 * W, H);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(90,60,45,0.25)' : 'rgba(255,250,240,0.25)';
      g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 3);
    }
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  return roadTex;
}

function buildRoads(): THREE.Group {
  const g = new THREE.Group();
  const roadMat = hazed(new THREE.MeshStandardMaterial({
    color: 0xb6987c, map: roadTexture(), roughness: 0.97, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  roadMat.customProgramCacheKey = () => 'goldfields-road';
  const bundMat = hazed(new THREE.MeshStandardMaterial({ color: 0x8d5238, roughness: 0.97, metalness: 0 }));
  const roads: THREE.BufferGeometry[] = [], bunds: THREE.BufferGeometry[] = [];
  for (const road of ROADS) {
    const curve = new THREE.CatmullRomCurve3(road.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const len = curve.getLength();
    const n = Math.max(2, Math.ceil(len / 5));
    const P: number[] = [], U: number[] = [], I: number[] = [];
    const B: number[] = [], BI: number[] = [];
    const side = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      side.set(-tan.z, 0, tan.x).normalize();
      // lifted a little further off the ground out where the ground is coarse
      const lift = 0.1 + Math.max(0, Math.hypot(p.x, p.z) - 250) * 0.0015;
      for (const s of [-1, 1]) {
        const x = p.x + side.x * s * road.w / 2, z = p.z + side.z * s * road.w / 2;
        P.push(x, height(x, z) + lift, z);
        U.push(s < 0 ? 0 : 1, (t * len) / 12);
      }
      if (i > 0) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      if (road.bund) {
        // a windrow down each side, half a haul truck's wheel high
        for (const s of [-1, 1]) {
          for (const [off, up] of [[road.w / 2 + 0.3, 0], [road.w / 2 + 1.6, 1.3], [road.w / 2 + 2.9, 0]]) {
            const x = p.x + side.x * s * off, z = p.z + side.z * s * off;
            B.push(x, height(x, z) + up - 0.2, z);
          }
        }
        if (i > 0) {
          const a = (i - 1) * 6, b = i * 6;
          for (const o of [0, 3]) {
            for (let q = 0; q < 2; q++) {
              const p0 = a + o + q, p1 = a + o + q + 1, p2 = b + o + q, p3 = b + o + q + 1;
              if (o === 0) BI.push(p0, p2, p1, p1, p2, p3); else BI.push(p0, p1, p2, p1, p3, p2);
            }
          }
        }
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    rg.setIndex(I);
    rg.computeVertexNormals();
    roads.push(rg);
    if (road.bund) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(B, 3));
      bg.setIndex(BI);
      bg.computeVertexNormals();
      bunds.push(bg);
    }
  }
  const road = new THREE.Mesh(mergeGeometries(roads), roadMat);
  road.receiveShadow = true;
  g.add(road);
  if (bunds.length) {
    const bund = new THREE.Mesh(mergeGeometries(bunds), bundMat);
    bund.receiveShadow = bund.castShadow = true;
    g.add(bund);
  }
  // the roads are in the walker's way only as the ground they lie on
  g.userData.noCollide = true;
  return g;
}

/** Distance (plan) from a point to the nearest road centreline. */
function roadDistance(x: number, z: number) {
  let d = Infinity;
  for (const r of ROADS) {
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const vx = bx - ax, vz = bz - az;
      const t = clamp01(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz));
      d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t) - r.w / 2);
    }
  }
  return d;
}

// ------------------------------------------------------------ the bush

/**
 * A lumpy bush: three squashed, dented blobs, smooth-shaded and darker
 * underneath. Twenty faces a blob - it is never more than a few pixels high
 * where there are thousands of them.
 */
function bushGeometry(seed: number) {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.42 + r() * 0.2, 0);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVerts(geo);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const s = 0.7 + r() * 0.6;
      // flattened underneath, where it sits on the ground
      p.setXYZ(i, p.getX(i) * s, Math.max(-0.18, p.getY(i) * s * 0.75), p.getZ(i) * s);
    }
    const a = (k / 3) * Math.PI * 2 + r();
    geo.translate(Math.cos(a) * 0.32, 0.18 + r() * 0.1, Math.sin(a) * 0.32);
    parts.push(geo);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  selfShade(g, 0, 0.7, 0.4);
  return g;
}

/** A goldfields eucalypt: a pale, leaning trunk, two forks and a few clumps of crown. */
function treeGeometry(seed: number) {
  const r = rng(seed);
  const trunk: THREE.BufferGeometry[] = [], crown: THREE.BufferGeometry[] = [];
  const H = 1; // the tree is built a unit tall and scaled by the instance
  const lean = (r() - 0.5) * 0.18;
  const stem = new THREE.CylinderGeometry(0.018, 0.03, H * 0.55, 6, 1, true);
  stem.translate(0, H * 0.275, 0);
  stem.rotateZ(lean);
  trunk.push(stem);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + r();
    const fork = new THREE.CylinderGeometry(0.01, 0.018, H * 0.35, 5, 1, true);
    fork.translate(0, H * 0.175, 0);
    fork.rotateZ(0.45 + r() * 0.25);
    fork.rotateY(a);
    fork.translate(-Math.sin(lean) * 0.5, H * 0.5, 0);
    trunk.push(fork);
    for (let q = 0; q < 2; q++) {
      let blob: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.14 + r() * 0.08, 0);
      blob.deleteAttribute('normal');
      blob.deleteAttribute('uv');
      blob = mergeVerts(blob);
      const bp = blob.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < bp.count; i++) {
        const s = 0.75 + r() * 0.5;
        bp.setXYZ(i, bp.getX(i) * s * 1.3, bp.getY(i) * s * 0.62, bp.getZ(i) * s * 1.3);
      }
      const out = 0.16 + r() * 0.14;
      blob.translate(Math.cos(a) * out - Math.sin(lean) * 0.5, H * (0.72 + r() * 0.2), Math.sin(a) * out);
      crown.push(blob);
    }
  }
  const tg = mergeGeometries(trunk.map((t) => { t.deleteAttribute('uv'); return t; }));
  const cg = mergeGeometries(crown);
  cg.computeVertexNormals();
  selfShade(cg, 0.62, 0.92, 0.45);
  return { trunk: tg, crown: cg };
}

/** Where nothing grows: the site, the roads, the dump and the dam. */
function bare(x: number, z: number, margin: number) {
  if (wild(x, z) < 0.6) return true;
  if (roadDistance(x, z) < margin) return true;
  if (rrect(x, z, DUMP.cx, DUMP.cz, DUMP.hx, DUMP.hz, DUMP.r) < margin + 16) return true;
  if (rrect(x, z, TSF.cx, TSF.cz, TSF.hx, TSF.hz, TSF.r) < margin + 12) return true;
  return false;
}

function buildBush(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(314);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  // Saltbush and bluebush: grey-green, knee to chest high. Two lots, so only
  // the ones near enough to throw a shadow the shadow map can see draw into it.
  const bushMat = hazed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
  const bushGeo = bushGeometry(3);
  const BUSH_TINTS = [0x5f6a4a, 0x55603f, 0x707458, 0x4a5638, 0x68694a];
  for (const [rMin, rMax, count, shadow] of [[40, 170, 1400, true], [170, 720, 4800, false]] as const) {
    const inst = new THREE.InstancedMesh(bushGeo, bushMat, count);
    let n = 0;
    for (let tries = 0; n < count && tries < count * 12; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(rMin * rMin + r() * (rMax * rMax - rMin * rMin));
      const x = Math.cos(a) * d - 20, z = Math.sin(a) * d;
      if (r() > scrub(x, z) || bare(x, z, 2)) continue;
      const k = 0.7 + r() * 1.3;
      p.set(x, height(x, z) - 0.1, z);
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      s.set(k * (0.9 + r() * 0.4), k * (0.7 + r() * 0.5), k * (0.9 + r() * 0.4));
      inst.setMatrixAt(n, m.compose(p, q, s));
      inst.setColorAt(n, tint.setHex(BUSH_TINTS[Math.floor(r() * BUSH_TINTS.length)]).multiplyScalar(0.85 + r() * 0.3));
      n++;
    }
    inst.count = n;
    inst.castShadow = shadow;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    g.add(inst);
  }

  // Eucalypts, mostly down the creek line and scattered elsewhere
  const { trunk, crown } = treeGeometry(8);
  const trunkMat = hazed(new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8, metalness: 0 }));
  const crownMat = hazed(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
  const TREES = 520;
  const trunks = new THREE.InstancedMesh(trunk, trunkMat, TREES);
  const crowns = new THREE.InstancedMesh(crown, crownMat, TREES);
  let n = 0;
  for (let tries = 0; n < TREES && tries < TREES * 40; tries++) {
    const a = r() * Math.PI * 2, d = 70 + Math.sqrt(r()) * 1300;
    const x = Math.cos(a) * d - 20, z = Math.sin(a) * d;
    const near = Math.exp(-(creek(x, z) ** 2) / 2500);
    if (r() > 0.06 + near * 0.9 || bare(x, z, 6)) continue;
    const h = 7 + r() * 9;
    p.set(x, height(x, z) - 0.2, z);
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    s.set(h * (0.9 + r() * 0.3), h, h * (0.9 + r() * 0.3));
    m.compose(p, q, s);
    trunks.setMatrixAt(n, m);
    crowns.setMatrixAt(n, m);
    crowns.setColorAt(n, tint.setHex([0x5f6b3e, 0x6b7447, 0x56633c, 0x747a4e][Math.floor(r() * 4)]).multiplyScalar(0.8 + r() * 0.35));
    n++;
  }
  for (const t of [trunks, crowns]) {
    t.count = n;
    t.castShadow = true;
    t.receiveShadow = true;
    t.computeBoundingSphere();
    g.add(t);
  }
  return g;
}

// --------------------------------------------------------- the headframe

/**
 * The shaft: a steel headframe over the collar with its sheave wheels, the
 * back legs braced towards the winder house, the ropes running down to the
 * drums, and the ore from the skips going up a conveyor onto the pile.
 * Everything that shares a material is merged, so it is a handful of draw
 * calls however many members it has.
 */
function buildHeadframe(): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const add = kit.add.bind(kit), member = kit.member.bind(kit), block = kit.block.bind(kit);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a3d28, roughness: 0.62, metalness: 0.35 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.6, metalness: 0.5 });
  const clad = new THREE.MeshStandardMaterial({ color: 0xd8d0bf, roughness: 0.7, metalness: 0.2 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xa4a7a6, roughness: 0.45, metalness: 0.6 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa29d93, roughness: 0.95, metalness: 0 });
  const rope = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.7 });
  const V =(x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // the collar pad
  block(concrete, 40, 0.6, 34, 0, -0.1, 0);

  // Tower: four legs tapering from 10 m square to 6.5, 40 m to the sheave deck
  const H = 40, B0 = 5, B1 = 3.25;
  const leg = (sx: number, sz: number, y: number) => {
    const b = B0 + (B1 - B0) * (y / H);
    return V(sx * b, y, sz * b);
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) member(steel, leg(sx, sz, 0), leg(sx, sz, H), 0.7);
  const LEVELS = 6;
  for (let l = 0; l <= LEVELS; l++) {
    const y0 = (H / LEVELS) * l, y1 = (H / LEVELS) * (l + 1);
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
      member(steel, leg(ax, az, y0), leg(bx, bz, y0), 0.4);
      if (l < LEVELS) {
        // an X in every panel of every face
        member(steel, leg(ax, az, y0), leg(bx, bz, y1), 0.22);
        member(steel, leg(bx, bz, y0), leg(ax, az, y1), 0.22);
      }
    }
  }
  // sheave deck, handrail, and a gantry for changing the wheels
  block(grey, 10, 0.5, 9, 0, H + 0.25, 0);
  for (const sz of [-4.4, 4.4]) block(steel, 10, 0.08, 0.08, 0, H + 1.3, sz);
  for (const sx of [-4.9, 4.9]) block(steel, 0.08, 0.08, 8.8, sx, H + 1.3, 0);
  for (const sx of [-4.2, 4.2]) member(steel, V(sx, H + 0.5, -3.6), V(sx, H + 6.5, -3.6), 0.4);
  for (const sx of [-4.2, 4.2]) member(steel, V(sx, H + 0.5, 3.6), V(sx, H + 6.5, 3.6), 0.4);
  block(steel, 9, 0.6, 0.6, 0, H + 6.5, -3.6);
  block(steel, 9, 0.6, 0.6, 0, H + 6.5, 3.6);
  for (const sx of [-4.2, 4.2]) block(steel, 0.6, 0.6, 7.8, sx, H + 6.5, 0);

  // two sheave wheels, turned to face the winder (+x)
  const WR = 2.4;
  for (const sz of [-1.6, 1.6]) {
    const rim = new THREE.TorusGeometry(WR, 0.16, 6, 28);
    rim.translate(0, H + 3.0, sz);
    add(grey, rim);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI;
      member(grey, V(Math.cos(a) * WR, H + 3 + Math.sin(a) * WR, sz), V(-Math.cos(a) * WR, H + 3 - Math.sin(a) * WR, sz), 0.12);
    }
    block(grey, 0.5, 3.2, 0.5, 0, H + 1.6, sz);
  }

  // back legs, leaning out towards the winder to take the rope pull
  const W = 62; // the winder house stands this far off along +x
  for (const sz of [-1, 1]) {
    member(steel, V(B1, H, sz * B1), V(24, 0, sz * B1 * 2.2), 0.8);
    // a strut from each back leg into the tower
    const t = 0.28, back = V(B1 + t * (24 - B1), H * (1 - t), sz * B1 * (1 + t * 1.2));
    member(steel, back, leg(1, sz, H * 0.62), 0.3);
  }
  member(steel, V(16, H * 0.33, -B1 * 1.9), V(16, H * 0.33, B1 * 1.9), 0.35);

  // collar house round the foot of the tower: a roller door for the cages'
  // loads, and a strip of windows
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.35, metalness: 0.4 });
  block(clad, 16, 9, 14, -2, 4.5, 0);
  block(roof, 16.6, 0.4, 14.6, -2, 9.2, 0);
  block(dark, 0.2, 5, 5, -10.05, 2.5, 0);
  block(dark, 10, 0.9, 0.2, -2, 7, 7.05);
  block(dark, 10, 0.9, 0.2, -2, 7, -7.05);

  // the winder house, and the ropes from its drums up over the wheels
  block(concrete, 30, 0.6, 22, W, -0.1, 0);
  block(clad, 26, 13, 18, W, 6.5, 0);
  block(roof, 27, 0.5, 19, W, 13.25, 0);
  block(clad, 6, 3, 7, W + 15, 1.5, -5);
  for (const sz of [-9.05, 9.05]) block(dark, 20, 1.4, 0.2, W, 10.4, sz);
  block(dark, 0.2, 2.4, 1.2, W + 13.05, 1.2, 4);
  for (const sz of [-1.6, 1.6]) member(rope, V(WR, H + 3, sz), V(W - 13, 9.2, sz * 0.8), 0.12);
  for (const sz of [-1.6, 1.6]) member(rope, V(-WR, H + 3, sz), V(-WR, 9.5, sz), 0.12);

  // ore pass: a bin on the tower, and a conveyor gallery down onto the pile,
  // clad on the sides with the belt's walkway under the roof, on trestles
  block(grey, 7, 6, 7, -8, 16, 0);
  const pileX = -58;
  const g0 = V(-10, 18, 0), g1 = V(pileX + 4, 17, 0);
  member(clad, g0, g1, 2.2, 2.6);
  member(roof, g0.clone().setY(g0.y + 1.2), g1.clone().setY(g1.y + 1.2), 0.2, 3.0);
  for (const sz of [-1.25, 1.25]) member(steel, g0.clone().setY(g0.y - 1.2).setZ(sz), g1.clone().setY(g1.y - 1.2).setZ(sz), 0.25);
  for (let x = -18; x > pileX + 6; x -= 9) {
    for (const sz of [-1.1, 1.1]) member(steel, V(x, 0, sz), V(x, 15.9, sz), 0.35);
    member(steel, V(x, 15.9, -1.3), V(x, 15.9, 1.3), 0.3);
    member(steel, V(x, 1, -1.1), V(x, 15, 1.1), 0.18);
  }
  const pile = new THREE.ConeGeometry(21, 14, 28, 3);
  const pp = pile.getAttribute('position') as THREE.BufferAttribute;
  const pr = rng(4);
  for (let i = 0; i < pp.count; i++) if (pp.getY(i) < 6.9) pp.setXYZ(i, pp.getX(i) * (0.94 + pr() * 0.12), pp.getY(i), pp.getZ(i) * (0.94 + pr() * 0.12));
  pile.translate(pileX, 7 - 0.3, 0);
  const ore = new THREE.Mesh(pile, new THREE.MeshStandardMaterial({ color: 0x5f5650, roughness: 0.97, metalness: 0 }));
  ore.castShadow = ore.receiveShadow = true;
  g.add(ore);

  // light towers on the pad, for the night shift
  for (const [x, z] of [[-18, 14], [36, -14], [-40, -12]]) {
    member(grey, V(x, 0, z), V(x, 14, z), 0.3);
    block(grey, 2.2, 1.0, 0.4, x, 14.3, z);
  }

  kit.build(g);
  g.position.set(HEADFRAME.x, height(HEADFRAME.x, HEADFRAME.z), HEADFRAME.z);
  g.rotation.y = -0.35;
  return g;
}

// ------------------------------------------------------------ assembly

/**
 * Lay the goldfields round the plant. `root` is the world's; the stage has
 * already had Today's look applied over with GOLDFIELDS_LOOK.
 */
export function buildEarth(root: THREE.Group, stage: Stage): Dressing {
  stage.hideDome();
  stage.aimSun(SUN);
  // all of it in one group, so it can be counted, or hidden to compare
  const land = new THREE.Group();
  land.name = 'goldfields';
  root.add(land);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMaterial(false));
  sky.frustumCulled = false;
  // Last of the solid things, not first: it sits at the far plane, so the
  // depth test turns it away wherever something is already in front, and
  // its clouds are only worked out for the sky you can actually see.
  sky.renderOrder = 1000;
  sky.userData.noCollide = true;
  land.add(sky);

  // the reflections: the same sky, with lit earth under it
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(true));
  envSky.frustumCulled = false;
  envScene.add(envSky);
  stage.environmentFrom(envScene);
  envSky.geometry.dispose();
  (envSky.material as THREE.Material).dispose();

  land.add(buildLand());
  const forms = new THREE.Group();
  forms.add(buildDump(), buildTsf());
  forms.userData.noCollide = true;
  land.add(forms);
  land.add(buildRoads());
  const bush = buildBush();
  bush.userData.noCollide = true;
  land.add(bush);
  land.add(buildHeadframe());

  const time = (sky.material as THREE.ShaderMaterial).uniforms.uTime;
  return {
    update(_t: Telemetry, _dt: number, now: number) {
      time.value = now;
    },
  };
}
