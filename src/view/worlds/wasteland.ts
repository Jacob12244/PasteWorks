/**
 * 2805, Earth, long after everyone left: the world round the last plant.
 *
 * Dust hangs over everything, thickest at the ground, so the towers rise out
 * of it: towers of compacted rubbish, stacked in bales by the last robot that
 * had this job, as tall as the dead city behind them. A motorway that fell in,
 * containers and cars where they were left, pylons with nothing to carry, a
 * crane that stopped mid-lift, a crater field from the last war, and a sun
 * you can look straight at.
 *
 * The dust is the scene's fog, rewritten for this world: it thins with
 * height and takes the colour of the sky behind whatever it hides. Every
 * material on the page gets it the same way - the plant, the ground, the
 * ruins - so nothing looks pasted onto the rest. That is safe because a page
 * only ever builds one world; see dustFog().
 *
 * Built once, never moves, adds no lights.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Telemetry } from '../../sim/plant';
import type { Look } from '../../scenario';
import type { Stage } from '../scene';
import type { GroundSpec } from '../terrain';
import { C, metal, matte } from '../palette';
import { box, cyl, strip } from '../parts';
import { Dressing, Field, rng, canvasTexture, clamp01 } from './common';
import {
  lin, perlin, fbm, torusNoise, srgbByte, smooth, rrect, gridAxis, heightfield, landform, twoScale, Kit,
} from './land';
import { CRATER, CRATER_HOLE, OPEN_CRATERS, FILLED_CRATERS, GROUND } from './waste';

// ------------------------------------------------------------------ the sun

/** Towards the sun: low in the west, a little south, through the dust. */
const SUN = new THREE.Vector3(-0.8, 0.34, 0.42).normalize();

/** The light that goes with it: a low, dimmed, orange sun and a bright dusty sky. */
export const LAST_SHIFT_LOOK: Partial<Look> = {
  // the density is the dust at ground level, per metre; see dustFog()
  fog: { color: 0xb08a5c, density: 0.002 },
  hemi: { sky: 0xd8ae78, ground: 0x4a3622, intensity: 0.42 },
  key: { color: 0xffc58e, intensity: 2.5 },
  fill: 0.18,
  rim: 0.22,
  pools: 0.6,
  exposure: 1.0,
  bloom: [0.32, 0.5, 0.92],
  env: 0.8,
};

/** A dusty slab; the kerb lamps are still on, because nobody told them. */
export const LAST_SHIFT_GROUND: GroundSpec = {
  plain: 0x7a5a3a, pad: 0x6e5f4c, grid: [0x4e4234, 0x4e4234], kerb: 0xffab3d, cut: false,
  plainless: true, gridOpacity: 0.3, kerbGlow: 0.55,
};

// --------------------------------------------------------------- the sky

const v3 = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/**
 * The sky as GLSL, with its colours baked in (nothing about it changes):
 * `dustSky(dir)` is the sky without the sun's disc, `dustHaze(dir)` the
 * colour of the dust in front of something in that direction - the sky
 * behind it, no lower than the horizon.
 */
const SKY_GLSL = /* glsl */ `
const vec3 DUST_SUN = vec3(${SUN.x.toFixed(4)}, ${SUN.y.toFixed(4)}, ${SUN.z.toFixed(4)});
vec3 dustSky(vec3 d) {
  float mu = dot(d, DUST_SUN);
  float y = max(d.y, 0.0);
  vec3 horizon = mix(${v3(lin(0xc49464, 0.8))}, ${v3(lin(0xf0c690, 1.1))}, pow(0.5 + 0.5 * mu, 2.5));
  // a deep band of dust at the horizon, clearing slowly to a grey zenith
  vec3 c = mix(horizon, ${v3(lin(0x8a8278, 0.46))}, 1.0 - exp(-y * 2.4));
  float m = max(mu, 0.0);
  c += ${v3(lin(0xffb46a, 1.0))} * (0.5 * pow(m, 4.0) + 1.2 * pow(m, 30.0)) * (1.0 - 0.4 * y);
  return c;
}
vec3 dustHaze(vec3 d) {
  return dustSky(normalize(vec3(d.x, max(d.y, 0.04), d.z)));
}
`;

/**
 * Rewrite the fog for every material on the page: optical depth through dust
 * that thins exponentially with height (scale height DUST_H), integrated along
 * the view ray, fading to the sky behind. The scene's FogExp2 density is the
 * dust at the ground. Every material is compiled after this runs, because a
 * page builds its world before it renders anything.
 */
const DUST_H = 55;
function dustFog() {
  const S = THREE.ShaderChunk;
  S.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogWorld;
    #endif`;
  S.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
    #endif`;
  S.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying vec3 vFogWorld;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      ${SKY_GLSL}
    #endif`;
  S.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        vec3 fogRay = vFogWorld - cameraPosition;
        float fogLen = length(fogRay);
        float fogY0 = max(cameraPosition.y, -12.0), fogY1 = max(vFogWorld.y, -12.0);
        float fogE0 = exp(-fogY0 / ${DUST_H.toFixed(1)}), fogE1 = exp(-fogY1 / ${DUST_H.toFixed(1)});
        float fogDy = fogY1 - fogY0;
        float fogMean = abs(fogDy) > 0.5 ? ${DUST_H.toFixed(1)} * (fogE0 - fogE1) / fogDy : 0.5 * (fogE0 + fogE1);
        float fogK = 1.0 - exp(-fogDensity * fogLen * fogMean);
        // and the world ends in dust, well before the camera's far plane does
        fogK = max(fogK, smoothstep(1550.0, 1900.0, fogLen));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, dustHaze(fogRay / max(fogLen, 1e-3)), fogK);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      #endif
    #endif`;
}

/**
 * Seven centuries on the planet, for every lit surface on the page: steel
 * rusts (as much as its material is metal), in blotches and in runs down from
 * wherever water once stood, worst at the foot; what paint is left is
 * bleached and has lost its sheen; there are plates bolted over the worst of
 * it in whatever colour came to hand; and dust lies on everything that faces
 * up. All from where the surface is in the world, so it needs no texture and
 * no unit has to know about it. A material opts out with the NO_WEATHER
 * define - the ground, which is dust already, and anything whose colour
 * means something (the paste going into the crater).
 */
let weathered = false;
function weathering() {
  if (weathered) return;
  weathered = true;
  const S = THREE.ShaderChunk;
  S.fog_pars_fragment += /* glsl */ `
    #ifdef USE_FOG
      // a hash without a sine in it (Hoskins): the weather runs on every lit pixel
      float wHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      float wNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), u.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), u.x), u.y),
          mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), u.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), u.x), u.y),
          u.z);
      }
    #endif`;
  S.normal_fragment_maps += /* glsl */ `
    #if defined( STANDARD ) && defined( USE_FOG ) && !defined( NO_WEATHER )
    vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float steel = smoothstep(0.2, 0.7, metalnessFactor);
    // nothing to rust and nothing for dust to settle on: nothing to work out
    if (steel > 0.0 || wn.y > 0.7) {
      vec3 wp = vFogWorld;
      // warped, so the patches have ragged edges rather than the noise's grid;
      // the fine grain only near enough to see it
      float warp = wNoise(wp * 0.3) - 0.5;
      vec3 wq = wp + vec3(warp * 2.4, warp * 1.2, -warp * 2.4);
      float fine = length(wp - cameraPosition) < 150.0 ? wNoise(wq * 1.9 + 4.2) : 0.5;
      float blotch = wNoise(wq * 0.55) * 0.6 + fine * 0.4;
      float runs = wNoise(vec3(wq.x * 2.6, wp.y * 0.3, wq.z * 2.6));
      float feet = 1.0 - smoothstep(0.0, 7.0, wp.y);
      float rust = smoothstep(0.46, 0.76, blotch * 0.65 + runs * 0.3 + feet * 0.3) * steel;
      // the paint that is left: bleached, and gone chalky
      float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.1, 1.0, 0.86) + 0.015, 0.5 * steel);
      // repair plates, a couple of metres square, lined up on the faces they cover
      vec3 pc = wp * vec3(0.45, 0.6, 0.45);
      float pick = wHash(floor(pc) + 0.37);
      vec3 pf = fract(pc);
      vec2 face = abs(wn.x) > abs(wn.z) ? pf.zy : pf.xy;
      float inset = step(0.1, face.x) * step(face.x, 0.9) * step(0.14, face.y) * step(face.y, 0.86);
      float plate = step(0.93, pick) * inset * steel * (1.0 - step(0.8, abs(wn.y)));
      vec3 plateCol = pick > 0.978 ? vec3(0.2, 0.045, 0.02) : pick > 0.956 ? vec3(0.38, 0.26, 0.04) : vec3(0.27, 0.28, 0.28);
      diffuseColor.rgb = mix(diffuseColor.rgb, plateCol, plate);
      rust *= 1.0 - 0.8 * plate;
      vec3 rustCol = mix(vec3(0.042, 0.018, 0.009), vec3(0.25, 0.07, 0.018), fract(fine * 3.7 + runs));
      rustCol = mix(rustCol, vec3(0.35, 0.1, 0.023), smoothstep(0.6, 0.9, runs) * 0.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, rustCol, rust);
      metalnessFactor = mix(metalnessFactor, 0.12, max(rust, 0.6 * steel));
      roughnessFactor = mix(roughnessFactor, 0.92, max(rust, 0.5 * steel));
      // dust on everything that faces up - decks, roofs, the tops of things
      float dust = smoothstep(0.7, 0.97, wn.y) * (0.55 + 0.45 * blotch);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.39, 0.25, 0.13), dust * 0.85);
      roughnessFactor = mix(roughnessFactor, 0.97, dust);
      metalnessFactor = mix(metalnessFactor, 0.0, dust);
    }
    #endif`;
}

/** Keep the weather off a material. */
const noWeather = (m: THREE.Material) => { m.defines = { ...(m.defines ?? {}), NO_WEATHER: '' }; };

/**
 * The dome, drawn at infinity round the camera, with the sun's disc - big,
 * soft and dim enough to look at - and long streaks of dust aloft. For the
 * reflections (`env`) it is the plain sky over dusty ground.
 */
function skyMaterial(env: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
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
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
      #ifdef SKY_ENV
        vec3 c = d.y >= 0.0 ? dustSky(d) : mix(dustHaze(d), vec3(0.16, 0.11, 0.07), smoothstep(0.0, -0.25, d.y));
      #else
        vec3 c = dustHaze(d);
        if (d.y > 0.0) {
          c = dustSky(d);
          float mu = dot(d, DUST_SUN);
          // long streaks of dust aloft, combed out by the wind
          vec2 p = d.xz / (d.y + 0.15);
          float band = fbm(vec2(p.x * 0.5 + p.y * 0.2, p.y * 2.4 - p.x * 0.4) + vec2(uTime * 0.003, 0.0));
          float streak = smoothstep(0.42, 0.72, band) * smoothstep(0.02, 0.25, d.y);
          vec3 lit = mix(${v3(lin(0x9a8c7c, 0.62))}, ${v3(lin(0xffd8a0, 1.25))}, pow(0.5 + 0.5 * mu, 3.0));
          c = mix(c, lit, streak * 0.45);
          // the sun: a soft, big disc the dust has taken the glare out of
          float disc = smoothstep(0.99965, 0.99985, mu);
          c += ${v3(lin(0xfff0d8, 1.0))} * (9.0 * disc + 1.6 * smoothstep(0.9975, 0.9998, mu)) * (1.0 - streak * 0.5);
        }
      #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// ------------------------------------------------------------ the land

const G0 = GROUND;
const EDGE = 1950;
const NEAR = 300;
const n1 = perlin(101), n2 = perlin(103), n3 = perlin(107), n4 = perlin(109);

/** Level ground: the plant and its piles, and the crater field it is filling. */
const SITE = [
  { cx: -60, cz: 5, hx: 125, hz: 85, r: 25 },
  { cx: 130, cz: 5, hx: 95, hz: 95, r: 50 },
];

function wild(x: number, z: number) {
  let d = Infinity;
  for (const s of SITE) d = Math.min(d, rrect(x, z, s.cx, s.cz, s.hx, s.hz, s.r));
  return smooth(0, 70, d);
}

// ---- craters: the field's own, and the rest of the war all the way out

interface Hole { x: number; z: number; R: number; depth: number; rim: number; fill: number; fresh: number }

const HOLES: Hole[] = [];
for (const [x, z, R] of OPEN_CRATERS) HOLES.push({ x, z, R, depth: 0.42 * R, rim: 0.11 * R, fill: 99, fresh: 1 });
{
  const r = rng(71);
  for (let tries = 0; HOLES.length < 150 && tries < 3000; tries++) {
    const a = r() * Math.PI * 2, d = 160 + Math.sqrt(r()) * 1450;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const R = 4 + 34 * r() * r();
    if (wild(x, z) < 0.9) continue;
    // older ones have slumped and half filled with sand
    const age = r();
    HOLES.push({
      x, z, R, depth: (0.4 - 0.25 * age) * R, rim: (0.12 - 0.07 * age) * R,
      fill: (0.35 - 0.2 * age) * R, fresh: 1 - age,
    });
  }
}
// bucketed, so each point of the ground only asks about the holes near it
const CELL = 120;
const bucket = (i: number, j: number) => (i + 100) * 1000 + (j + 100);
const buckets = new Map<number, Hole[]>();
for (const h of HOLES) {
  const reach = h.R * 1.9;
  for (let i = Math.floor((h.x - reach) / CELL); i <= Math.floor((h.x + reach) / CELL); i++) {
    for (let j = Math.floor((h.z - reach) / CELL); j <= Math.floor((h.z + reach) / CELL); j++) {
      const k = bucket(i, j);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(h);
    }
  }
}

/** What the craters do to the ground here: the height, and how scorched it is. */
function cratering(x: number, z: number) {
  let h = 0, burn = 0;
  const list = buckets.get(bucket(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list) {
    for (const c of list) {
      const u = Math.hypot(x - c.x, z - c.z) / c.R;
      if (u > 1.9) continue;
      let dh = c.rim * Math.exp(-(((u - 1) / 0.32) ** 2));
      if (u < 1) dh -= c.depth * (1 - u * u);
      h += Math.max(dh, -c.fill);
      if (u < 1.15) burn = Math.max(burn, c.fresh * (1 - smooth(0.6, 1.15, u)));
    }
  }
  return { h, burn };
}

/** Transverse dunes across the wind, which blows towards +x and a little +z. */
function dune(x: number, z: number) {
  const along = 0.96 * x + 0.28 * z + 45 * fbm(n2, x / 420, z / 420, 2);
  const crest = Math.pow(0.5 + 0.5 * Math.sin((along / 58) * Math.PI * 2), 3);
  return crest * clamp01(0.35 + 1.4 * fbm(n3, x / 380, z / 380, 2));
}

function natural(x: number, z: number) {
  const r = Math.hypot(x, z);
  let h = 3.4 * fbm(n1, x / 300, z / 300, 3) + 3.6 * dune(x, z);
  // rubble mounds, out towards the city
  h += smooth(450, 1200, r) * 7 * (0.5 + fbm(n4, x / 130, z / 130, 3));
  return h;
}

function height(x: number, z: number) {
  return G0 + wild(x, z) * natural(x, z) + cratering(x, z).h;
}

const SOIL = {
  sand: lin(0xa27b52), dark: lin(0x7a5b3e), pale: lin(0xc3a47c), crust: lin(0x9a8b76),
  burnt: lin(0x4e3e30), trodden: lin(0x6e5a42),
};
const _c = new THREE.Color();
function soilColour(x: number, z: number, out: THREE.Color) {
  const w = wild(x, z);
  out.copy(SOIL.sand).lerp(SOIL.dark, clamp01(0.5 + 1.1 * fbm(n4, x / 70, z / 70, 3)));
  // fresh sand on the crests, a dry crust in the flats between
  const crest = dune(x, z) * w;
  out.lerp(SOIL.pale, crest * 0.6);
  out.lerp(SOIL.crust, (1 - crest) * smooth(0.1, 0.4, fbm(n1, x / 260 + 7, z / 260, 3)) * 0.55 * w);
  const { burn } = cratering(x, z);
  out.lerp(SOIL.burnt, burn * 0.7);
  // round the plant, ground worn dark by two centuries of loaders
  _c.copy(SOIL.trodden).lerp(SOIL.dark, clamp01(0.4 + fbm(n3, x / 30, z / 30, 2)));
  out.lerp(_c, (1 - w) * 0.8);
  return out;
}

let detailTex: { map: THREE.Texture; normal: THREE.Texture } | null = null;

/**
 * Close up, the ground is dried mud gone to plates: a network of cracks at
 * two scales (the texture is also laid over itself eight times larger), sand
 * in the cracks, and a scatter of grit. White on average, and a normal map
 * from the same heights so a low sun picks the plates out.
 */
function groundDetail() {
  if (detailTex) return detailTex;
  const S = 512;
  const r = rng(13);
  const t1 = perlin(201), t2 = perlin(202);
  const hgt = new Float32Array(S * S);
  const tint = new Float32Array(S * S).fill(1);
  // cells of a jittered grid, wrapped so the cracks tile
  const N = 7, cell = S / N;
  const pts: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push((i + 0.15 + 0.7 * r()) * cell, (j + 0.15 + 0.7 * r()) * cell);
  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      const ci = Math.floor(u / cell), cj = Math.floor(v / cell);
      let f1 = 1e9, f2 = 1e9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + N) % N, jj = (cj + dj + N) % N;
          // the neighbour's point, moved a whole tile over where it wrapped
          const px = pts[(jj * N + ii) * 2] + (ci + di - ii) * cell;
          const py = pts[(jj * N + ii) * 2 + 1] + (cj + dj - jj) * cell;
          const d = Math.hypot(u - px, v - py);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
      }
      const edge = f2 - f1;
      const wobble = 0.8 * torusNoise(t2, u, v, S, 11);
      const crack = 1 - smooth(0, 1.7 + wobble, edge);
      const k = v * S + u;
      hgt[k] = 0.3 * torusNoise(t1, u, v, S, 5) + 0.15 * torusNoise(t1, u, v, S, 19)
        + 0.3 * smooth(0, cell * 0.35, edge) - 0.6 * crack;
      tint[k] = 1 - 0.32 * crack;
    }
  }
  // grit
  for (let i = 0; i < 1800; i++) {
    const px = Math.floor(r() * S), py = Math.floor(r() * S), rad = 1 + r() * 2.2;
    const shade = r() < 0.5 ? 0.6 : 1.2;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx, dy) > rad) continue;
        const k = ((py + dy + S) % S) * S + ((px + dx + S) % S);
        hgt[k] += 0.25;
        tint[k] = shade;
      }
    }
  }
  const map = canvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let k = 0; k < S * S; k++) {
      const l = (0.86 + 0.14 * hgt[k]) * tint[k];
      img.data[k * 4] = srgbByte(l);
      img.data[k * 4 + 1] = srgbByte(l * 0.98);
      img.data[k * 4 + 2] = srgbByte(l * 0.95);
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  const normal = canvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    const at = (u: number, v: number) => hgt[((v + S) % S) * S + ((u + S) % S)];
    for (let v = 0; v < S; v++) {
      for (let u = 0; u < S; u++) {
        const nx = (at(u - 1, v) - at(u + 1, v)) * 1.4, ny = (at(u, v - 1) - at(u, v + 1)) * 1.4;
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

let groundMat: THREE.MeshStandardMaterial | null = null;
function groundMaterial() {
  const { map, normal } = groundDetail();
  if (!groundMat) {
    groundMat = twoScale(new THREE.MeshStandardMaterial({
      vertexColors: true, map, normalMap: normal, normalScale: new THREE.Vector2(1, 1),
      roughness: 0.97, metalness: 0,
    }), 'wasteland-ground', 0.25);
    noWeather(groundMat);
  }
  return groundMat;
}

/**
 * Sand banked up against the pad's kerbs by two centuries of wind - leaving
 * the gate clear, and the west side, where the loaders come and go.
 */
function buildDrifts(): THREE.Group {
  const g = new THREE.Group();
  const drifts: [number, number, number, number, number, number][] = [
    // x0, z0, x1, z1, height, width
    [-81, -38.8, 37, -38.8, 0.9, 2.2],
    [-81, 38.8, -19.5, 38.8, 0.8, 2.0],
    [-8.5, 38.8, 37, 38.8, 0.7, 2.0],
    [38.8, -37, 38.8, -6, 0.6, 1.8],
    [38.8, 6, 38.8, 37, 0.6, 1.8],
  ];
  const c = new THREE.Color();
  for (const [x0, z0, x1, z1, h, w] of drifts) {
    const vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz;
    const pad = w * 3;
    g.add(landform(
      (x0 + x1) / 2, (z0 + z1) / 2, Math.abs(vx) / 2 + pad, Math.abs(vz) / 2 + pad, 0.8,
      (x, z) => {
        const t = clamp01(((x - x0) * vx + (z - z0) * vz) / L2);
        const d = Math.hypot(x - x0 - vx * t, z - z0 - vz * t);
        const ripple = 0.75 + 0.35 * fbm(n2, x / 7, z / 7, 2);
        c.copy(SOIL.pale).lerp(SOIL.sand, clamp01(0.4 + fbm(n3, x / 5, z / 5, 2)));
        return { y: G0 - 0.05 + h * ripple * Math.exp(-((d / w) ** 2)), colour: c.clone() };
      },
      height, groundMaterial(), 6,
    ));
  }
  g.userData.noCollide = true;
  return g;
}

/**
 * What was used up along the way: loaders that stopped, one on its side and
 * one half under the sand, and an old tank lying where it was cut up for
 * the plates on the plant.
 */
function buildDerelicts(): THREE.Group {
  const g = new THREE.Group();
  const yellow = metal(0xc89a3a, 0.55, 0.45), dark = metal(0x3c4652, 0.5, 0.7), track = matte(0x1a1f24, 0.9);
  const loader = (x: number, z: number, ry: number, roll: number, sink: number) => {
    const l = new THREE.Group();
    const body = box(3.2, 1.8, 2.4, yellow); body.position.y = 1.3; l.add(body);
    const cab = box(1.4, 1.2, 1.8, dark); cab.position.set(-0.6, 2.8, 0); l.add(cab);
    for (const tz of [-1.1, 1.1]) { const t = box(3.4, 0.8, 0.6, track); t.position.set(0, 0.4, tz); l.add(t); }
    const bucket = box(1.2, 1.0, 2.6, metal(0x6a6e74, 0.6, 0.7)); bucket.position.set(2.4, 0.5, 0); bucket.rotation.z = -0.6; l.add(bucket);
    l.position.set(x, height(x, z) - sink, z);
    l.rotation.set(0, ry, roll);
    g.add(l);
  };
  loader(-168, 58, 0.8, 1.45, 0.4);
  loader(-72, -66, -0.4, 0.12, 1.3);
  // the tank, on its side, a quarter of its shell gone for patches
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 7, 12, 28, 1, true, 0, Math.PI * 1.5),
    metal(0x5a6068, 0.6, 0.8),
  );
  shell.material = (shell.material as THREE.MeshStandardMaterial).clone();
  (shell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  shell.rotation.set(0, 0.5, Math.PI / 2);
  shell.position.set(-130, height(-130, -75) + 4.2, -75);
  shell.castShadow = shell.receiveShadow = true;
  g.add(shell);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.25, 6, 28), metal(0x4a4e54, 0.6, 0.8));
  ring.rotation.set(0, 0.5 + Math.PI / 2, 0);
  ring.position.copy(shell.position).add(new THREE.Vector3(Math.cos(0.5) * 6, 0, -Math.sin(0.5) * 6));
  g.add(ring);
  return g;
}

function buildGroundMesh(): THREE.Group {
  const [hx0, hx1, hz0, hz1] = CRATER_HOLE;
  const axis = (b: number[]) => gridAxis(EDGE, b, (a) => Math.min(42, 4 + Math.max(0, a - 220) * 0.032));
  return heightfield({
    xs: axis([hx0, hx1, -NEAR, NEAR]),
    zs: axis([hz0, hz1, -NEAR, NEAR]),
    height,
    colour: soilColour,
    // Crater 4 is the unit's own bowl, with an apron over the square's corners
    hole: (x, z) => x > hx0 && x < hx1 && z > hz0 && z < hz1,
    near: NEAR,
    material: groundMaterial(),
    tile: 6,
  });
}

/**
 * The ground round Crater 4, over the unit's own apron: the heightfield stops
 * at a square round the bowl, so this ring fills out to it in the ground's
 * own material and colour.
 */
function buildApron(ground: THREE.Material): THREE.Mesh {
  const { x, z, R } = CRATER;
  const geo = new THREE.RingGeometry(R + 0.2, R * 1.52, 72, 4);
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const wx = x + p.getX(i), wz = z + p.getZ(i);
    soilColour(wx, wz, c);
    col.set([c.r, c.g, c.b], i * 3);
    uv.setXY(i, wx / 6, wz / 6);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, ground);
  m.position.set(x, G0 + 0.02, z);
  m.receiveShadow = true;
  return m;
}

// --------------------------------------------------------- box geometry

/**
 * Boxes with texture coordinates in metres - so a facade's windows or a
 * tower's bales keep their size whatever the box - and a tint per box,
 * merged into one mesh.
 */
class Boxes {
  private list: THREE.BufferGeometry[] = [];
  constructor(private su: number, private sv: number) {}

  /**
   * @param m where the box goes (its centre)
   * @param v0 the height the texture's rows count from, at the box's foot -
   *   so a setback's floors line up with the storeys below it
   */
  add(w: number, h: number, d: number, m: THREE.Matrix4, tint: THREE.Color, v0 = 0, u0 = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + h / 2, z = p.getZ(i);
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
      const u = ny > 0.5 ? x : nx > 0.5 ? z : x;
      const v = ny > 0.5 ? z : y + v0;
      uv.setXY(i, (u + u0) / this.su, v / this.sv);
    }
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) col.set([tint.r, tint.g, tint.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.applyMatrix4(m);
    this.list.push(geo);
  }

  mesh(mat: THREE.Material): THREE.Mesh {
    const m = this.list.length ? new THREE.Mesh(mergeGeometries(this.list), mat) : new THREE.Mesh();
    this.list = [];
    return m;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
/** A matrix placing a box's centre at (x, y, z), turned and tipped. */
const place = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s).clone();

// ------------------------------------------------------------ textures

/**
 * Sixteen bales of compacted rubbish in a four by four sheet: scraps of rusted
 * steel, bleached plastic, cardboard and cloth pressed flat, strapped, with a
 * dark gap round each.
 */
function baleTexture() {
  const r = rng(5);
  const JUNK = ['#6d5a44', '#7a5236', '#5c5c58', '#8a7e6a', '#4a4036', '#6e6a60', '#8c6a48', '#3e3a36'];
  const BRIGHT = ['#8a4a3a', '#4a6a8a', '#6a8a5a', '#a08a4a', '#9a9a92', '#7a4a6a'];
  const t = canvasTexture(512, 512, (g) => {
    for (let cj = 0; cj < 4; cj++) {
      for (let ci = 0; ci < 4; ci++) {
        const x0 = ci * 128, y0 = cj * 128;
        g.fillStyle = JUNK[Math.floor(r() * JUNK.length)];
        g.fillRect(x0, y0, 128, 128);
        for (let k = 0; k < 170; k++) {
          g.save();
          g.translate(x0 + r() * 128, y0 + r() * 128);
          g.rotate((r() - 0.5) * 0.6 + (r() < 0.2 ? Math.PI / 2 : 0));
          g.globalAlpha = 0.55 + r() * 0.45;
          g.fillStyle = r() < 0.16 ? BRIGHT[Math.floor(r() * BRIGHT.length)] : JUNK[Math.floor(r() * JUNK.length)];
          // pressed flat, so mostly wide and thin
          g.fillRect(-10 - r() * 14, -2 - r() * 4, 20 + r() * 26, 3 + r() * 7);
          g.restore();
        }
        g.globalAlpha = 1;
        // the strapping
        g.fillStyle = 'rgba(30,26,22,0.7)';
        for (const f of [0.3, 0.7]) g.fillRect(x0, y0 + 128 * f, 128, 3);
        // the gap round each bale, and the shadow in it
        const grad = (a: number, b: number, c: number, d: number) => {
          const gr = g.createLinearGradient(a, b, c, d);
          gr.addColorStop(0, 'rgba(12,10,8,0.95)');
          gr.addColorStop(1, 'rgba(12,10,8,0)');
          return gr;
        };
        g.fillStyle = grad(x0, 0, x0 + 9, 0); g.fillRect(x0, y0, 9, 128);
        g.fillStyle = grad(x0 + 128, 0, x0 + 119, 0); g.fillRect(x0 + 119, y0, 9, 128);
        g.fillStyle = grad(0, y0, 0, y0 + 9); g.fillRect(x0, y0, 128, 9);
        g.fillStyle = grad(0, y0 + 128, 0, y0 + 117); g.fillRect(x0, y0 + 117, 128, 11);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The city's facades, 16 m (five bays) by 28.8 m (eight storeys) a repeat,
 * in three kinds - so it is not one building copied two hundred times:
 *   0 concrete with punched windows, 1 a glass curtain wall on its mullions,
 *   2 ribbon windows between concrete spandrels.
 * The glass mostly dark, a lot of it gone, and grime down from every sill.
 */
function facadeTexture(kind: number) {
  const r = rng(17 + kind);
  const t = canvasTexture(256, 512, (g, W, H) => {
    const bw = W / 5, fh = H / 8;
    const pane = (x: number, y: number, w: number, h: number) => {
      const k = r();
      if (k < 0.5) {
        const gr = g.createLinearGradient(x, y, x + w, y + h);
        gr.addColorStop(0, kind === 1 ? '#4a5258' : '#3a3e42');
        gr.addColorStop(1, kind === 1 ? '#2a3034' : '#22262a');
        g.fillStyle = gr;
      } else if (k < 0.82) g.fillStyle = '#0c0c0c';
      else g.fillStyle = '#4e463c';
      g.fillRect(x, y, w, h);
      if (k >= 0.5 && k < 0.82 && r() < 0.5) {
        // what glass is left in a broken frame
        g.fillStyle = 'rgba(80,86,90,0.8)';
        g.beginPath();
        g.moveTo(x, y + h); g.lineTo(x + w * r(), y + h); g.lineTo(x, y + h * (0.3 + r() * 0.5));
        g.fill();
      }
    };
    g.fillStyle = kind === 1 ? '#8c9294' : '#c8c1b4';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(90,80,66,0.08)' : 'rgba(255,250,240,0.07)';
      g.fillRect(r() * W, r() * H, 3 + r() * 20, 2 + r() * 12);
    }
    for (let f = 0; f < 8; f++) {
      if (kind === 0) {
        g.fillStyle = 'rgba(70,62,52,0.35)';
        g.fillRect(0, f * fh, W, 2);
        for (let b = 0; b < 5; b++) pane(b * bw + bw * 0.12, f * fh + fh * 0.2, bw * 0.76, fh * 0.6);
      } else if (kind === 1) {
        // panes floor to ceiling, two to a bay, mullions and transoms between
        for (let b = 0; b < 10; b++) pane(b * bw / 2 + 1.5, f * fh + 2, bw / 2 - 3, fh - 4);
      } else {
        g.fillStyle = 'rgba(70,62,52,0.3)';
        g.fillRect(0, f * fh + fh * 0.62, W, 2);
        for (let b = 0; b < 10; b++) pane(b * bw / 2 + 0.6, f * fh + fh * 0.12, bw / 2 - 1.2, fh * 0.46);
      }
      // what ran down from the sills
      for (let b = 0; b < 5; b++) {
        g.fillStyle = 'rgba(60,50,40,0.16)';
        g.fillRect(b * bw + r() * bw, f * fh + fh * 0.8, 2 + r() * 3, fh * (0.3 + r() * 0.6));
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Corrugated steel, whitish so each container's own colour shows through, rusting. */
function corrugatedTexture() {
  const r = rng(23);
  const t = canvasTexture(256, 128, (g, W, H) => {
    for (let x = 0; x < W; x += 8) {
      g.fillStyle = '#e8e4dc'; g.fillRect(x, 0, 4, H);
      g.fillStyle = '#b8b4ac'; g.fillRect(x + 4, 0, 4, H);
    }
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${110 + r() * 40},${60 + r() * 20},${30 + r() * 10},${0.25 + r() * 0.5})`;
      const x = r() * W, y = r() * H;
      g.fillRect(x, y, 4 + r() * 30, 2 + r() * 10);
      g.fillRect(x + r() * 6, y, 2, 10 + r() * 50);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The last billboard, sun-bleached and peeling. */
function billboardTexture() {
  const r = rng(29);
  return canvasTexture(1024, 384, (g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8aa4b0'); sky.addColorStop(1, '#c8c6b8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // a ship going up, in outline
    g.strokeStyle = 'rgba(250,246,236,0.8)';
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(820, 330); g.lineTo(870, 80); g.lineTo(920, 330); g.closePath();
    g.stroke();
    g.fillStyle = '#f4efe2';
    g.font = 'bold 118px Impact, "Arial Black", sans-serif';
    g.fillText('SEE YOU IN', 48, 150);
    g.font = 'bold 150px Impact, "Arial Black", sans-serif';
    g.fillText('2110', 48, 300);
    g.font = '32px Arial, sans-serif';
    g.fillStyle = 'rgba(40,52,60,0.8)';
    g.fillText('Five years. The ships leave daily. Leave the lights on.', 50, 352);
    // bleached, and the paper coming away from the board
    g.fillStyle = 'rgba(230,214,184,0.35)';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = r() < 0.5 ? '#7a6a58' : '#968468';
      const x = r() * W, y = r() * H;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) g.lineTo(x + (r() - 0.3) * 90, y + (r() - 0.3) * 70);
      g.fill();
    }
    const dust = g.createLinearGradient(0, H * 0.55, 0, H);
    dust.addColorStop(0, 'rgba(150,120,84,0)'); dust.addColorStop(1, 'rgba(150,120,84,0.55)');
    g.fillStyle = dust;
    g.fillRect(0, 0, W, H);
  });
}

// ------------------------------------------------------------ the towers

/** Keep scenery off the plant, the crater field, the old road and the motorway. */
function clearOf(x: number, z: number, margin: number) {
  if (wild(x, z) < 0.95) return false;
  if (roadDistance(x, z) < 12 + margin) return false;
  if (Math.abs(z - highwayZ(x)) < 16 + margin) return false;
  return true;
}

/**
 * Towers of bales, stacked by the last robot that had this job: tier on
 * tier, each a little narrower and a little off true, and the last few bales
 * of the top tier still sitting where they were put.
 */
function buildBaleTowers(): THREE.Mesh {
  const r = rng(41);
  const BALE = 1.8;
  const boxes = new Boxes(BALE * 4, BALE * 4);
  const tint = new THREE.Color();
  const TINTS = [0xb8a48a, 0xa89880, 0xc2ac90, 0x9c8e7c, 0xb0987a];
  let made = 0;
  for (let tries = 0; made < 64 && tries < 2000; tries++) {
    const a = r() * Math.PI * 2, d = 150 + Math.sqrt(r()) * 1050;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!clearOf(x, z, 30)) continue;
    made++;
    // taller the further out, the far ones as tall as the city - and broad
    // at the foot, so they step in like the city's own towers
    const H = (d < 320 ? 16 + r() * 34 : d < 700 ? 34 + r() * 90 : 60 + r() * 140);
    let w = BALE * Math.round(8 + r() * 12 + H / 12), dd = BALE * Math.round(8 + r() * 12 + H / 12);
    let y = height(x, z) - 0.5, ox = 0, oz = 0;
    const top = y + H;
    const ry = r() * Math.PI;
    tint.setHex(TINTS[Math.floor(r() * TINTS.length)]).multiplyScalar(0.8 + r() * 0.3);
    while (y < top) {
      const th = BALE * Math.round(3 + r() * 6);
      const c = tint.clone().multiplyScalar(0.88 + r() * 0.24);
      const m = place(x + ox, y + th / 2, z + oz, ry + (r() - 0.5) * 0.05);
      boxes.add(w, th, dd, m, c, y, r() * 7.2);
      y += th;
      // step in a bale or three a side, now and then a big setback
      const step = BALE * (Math.round(1 + r() * 2) + (r() < 0.2 ? 3 : 0));
      w = Math.max(BALE * 3, w - step);
      dd = Math.max(BALE * 3, dd - step * (0.6 + r() * 0.8));
      ox += (r() - 0.5) * 1.6;
      oz += (r() - 0.5) * 1.6;
    }
    // the last load, not yet squared off
    const loose = 3 + Math.floor(r() * 9);
    for (let k = 0; k < loose; k++) {
      const m = place(x + ox + (r() - 0.5) * (w - BALE), y + BALE / 2, z + oz + (r() - 0.5) * (dd - BALE), ry + (r() - 0.5) * 0.3);
      boxes.add(BALE, BALE, BALE, m, tint.clone().multiplyScalar(0.8 + r() * 0.4), r() * 7, r() * 7);
    }
  }
  const mesh = boxes.mesh(new THREE.MeshStandardMaterial({
    map: baleTexture(), vertexColors: true, roughness: 0.92, metalness: 0.12,
  }));
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The city they left, all the way round and thickest to the north: towers
 * with their tops broken off, some down to the bare frame, some leaning, one
 * or two snapped and lying beside their own stumps.
 */
function buildCity(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(53);
  const kinds = [new Boxes(16, 28.8), new Boxes(16, 28.8), new Boxes(16, 28.8)];
  let facade = kinds[0];
  const plain = new Kit();
  const frame = new THREE.MeshStandardMaterial({ color: 0x6a645a, roughness: 0.9, metalness: 0.1 });
  const tint = new THREE.Color();
  const TINTS = [0xd8d0c2, 0xc8c0b0, 0xb8b4ae, 0xd0bca0, 0xa8b0b4];
  const towers: { x: number; z: number; h: number }[] = [];
  // downtown, to the north
  for (let i = 0; i < 95; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 480;
    towers.push({ x: 60 + Math.cos(a) * d, z: -1260 + Math.sin(a) * d * 0.8, h: 90 + (1 - d / 480) * 220 * r() + 40 * r() });
  }
  // and the rest of it, thinning out, all the way round
  for (let i = 0; i < 110; i++) {
    const a = r() * Math.PI * 2, d = 720 + r() * 1050;
    towers.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h: 30 + r() * r() * 150 });
  }
  for (const t of towers) {
    if (Math.hypot(t.x, t.z) > 1850) continue;
    const w = 18 + r() * 28, d = 18 + r() * 28;
    const ry = r() * Math.PI;
    const base = height(t.x, t.z) - 2;
    facade = kinds[Math.floor(r() * kinds.length)];
    tint.setHex(TINTS[Math.floor(r() * TINTS.length)]).multiplyScalar(0.8 + r() * 0.25);
    const kind = r();
    if (kind < 0.1 && t.h > 60) {
      // snapped: the stump, and the rest of it lying on the ground beside it
      const stump = t.h * (0.25 + r() * 0.25);
      facade.add(w, stump, d, place(t.x, base + stump / 2, t.z, ry), tint);
      const len = t.h - stump;
      const fall = ry + (r() - 0.5) * 1.2;
      const fx = t.x + Math.cos(fall) * (len / 2 + w * 0.3), fz = t.z - Math.sin(fall) * (len / 2 + w * 0.3);
      // (on its side, its width is its height off the ground)
      facade.add(w * 0.9, len, d * 0.9, place(fx, base + w * 0.4, fz, fall, 0, Math.PI / 2 - 0.08), tint);
      continue;
    }
    const lean = kind < 0.25 ? (r() - 0.5) * 0.12 : 0;
    const body = t.h * (0.75 + r() * 0.2);
    facade.add(w, body, d, place(t.x, base + body / 2, t.z, ry, lean * 0.3, lean), tint);
    // the top: a setback or two, broken off at different heights
    let y = base + body, sw = w, sd = d;
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
      sw *= 0.55 + r() * 0.35; sd *= 0.55 + r() * 0.35;
      const hh = 6 + r() * (t.h - body + 12);
      const ox = (r() - 0.5) * (w - sw), oz = (r() - 0.5) * (d - sd);
      facade.add(sw, hh, sd, place(t.x + ox, y + hh / 2, t.z + oz, ry, lean * 0.3, lean), tint, y - base);
      if (r() < 0.5) break;
      y += hh * 0.6;
    }
    if (kind > 0.7 && !lean) {
      // stripped to the frame at the top: floor slabs and the columns between
      const floors = 3 + Math.floor(r() * 5);
      const top = base + body;
      plain.at = place(t.x, 0, t.z, ry);
      for (let f = 1; f <= floors; f++) {
        const fw = w * (1 - f * 0.06 * r()), fd = d * (1 - f * 0.06 * r());
        plain.block(frame, fw, 0.5, fd, (r() - 0.5) * 2, top + f * 3.6, 0);
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]]) {
        if (r() < 0.25) continue;
        const hgt = floors * 3.6 * (0.4 + r() * 0.6);
        plain.block(frame, 0.8, hgt, 0.8, sx * (w / 2 - 0.5), top + hgt / 2, sz * (d / 2 - 0.5));
      }
      plain.at = null;
    }
  }
  kinds.forEach((k, i) => g.add(k.mesh(new THREE.MeshStandardMaterial({
    map: facadeTexture(i), vertexColors: true, roughness: i === 1 ? 0.5 : 0.88, metalness: i === 1 ? 0.3 : 0.05,
  }))));
  plain.build(g, false);
  // a crane on the edge of it, stopped in the middle of a lift
  const crane = new Kit();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xa8843a, roughness: 0.7, metalness: 0.4 });
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  crane.at = place(330, height(330, -760) - 0.5, -760, 0.7);
  const MH = 72, B = 1.4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) crane.member(yellow, V(sx * B, 0, sz * B), V(sx * B, MH, sz * B), 0.3);
  for (let y = 0; y < MH; y += 4) {
    crane.member(yellow, V(-B, y, -B), V(B, y + 4, -B), 0.14);
    crane.member(yellow, V(B, y, B), V(-B, y + 4, B), 0.14);
    crane.member(yellow, V(-B, y, B), V(-B, y + 4, -B), 0.14);
    crane.member(yellow, V(B, y, -B), V(B, y + 4, B), 0.14);
  }
  crane.block(yellow, 58, 1.4, 1.6, 18, MH + 0.7, 0);
  crane.block(yellow, 4, 3, 3, -9, MH + 2.2, 0);
  crane.block(new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.9 }), 5, 4, 3, -10, MH - 1.5, 0);
  crane.member(yellow, V(0, MH + 1.4, 0), V(0, MH + 9, 0), 0.6);
  crane.member(new THREE.MeshStandardMaterial({ color: 0x2a2a2a }), V(40, MH, 0), V(40, MH - 30, 0), 0.08);
  crane.block(new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.9 }), 3, 2, 3, 40, MH - 31, 0);
  crane.at = null;
  crane.build(g, false);
  return g;
}

// ------------------------------------------------------ roads and wrecks

/** The old road into the city, under the motorway. */
const ROAD: [number, number][] = [[-175, -45], [-255, -190], [-310, -420], [-290, -700], [-190, -1000], [-60, -1260]];

function roadDistance(x: number, z: number) {
  let d = Infinity;
  for (let i = 1; i < ROAD.length; i++) {
    const [ax, az] = ROAD[i - 1], [bx, bz] = ROAD[i];
    const vx = bx - ax, vz = bz - az;
    const t = clamp01(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz));
    d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return d;
}

/** The motorway runs east-west across the north of the site, a little skew. */
const highwayZ = (x: number) => -430 + x * 0.04;

let roadTex: THREE.Texture | null = null;
function roadTexture() {
  if (roadTex) return roadTex;
  const r = rng(31);
  roadTex = canvasTexture(128, 512, (g, W, H) => {
    g.fillStyle = '#4a4744';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(20,18,16,0.25)' : 'rgba(120,110,96,0.2)';
      g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
    }
    // the centre line, what is left of it
    g.fillStyle = 'rgba(200,180,120,0.55)';
    for (let y = 0; y < H; y += 64) if (r() < 0.75) g.fillRect(W / 2 - 2, y, 4, 32);
    // cracks
    g.strokeStyle = 'rgba(16,14,12,0.7)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) {
      g.beginPath();
      let x = r() * W, y = r() * H;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    // sand blown over it
    for (let i = 0; i < 9; i++) {
      const y = r() * H;
      const gr = g.createRadialGradient(r() * W, y, 4, W / 2, y, 60 + r() * 60);
      gr.addColorStop(0, 'rgba(164,126,86,0.9)');
      gr.addColorStop(1, 'rgba(164,126,86,0)');
      g.fillStyle = gr;
      g.fillRect(0, y - 120, W, 240);
    }
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  return roadTex;
}

function buildRoad(): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(ROAD.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const len = curve.getLength(), n = Math.ceil(len / 6), W = 14;
  const P: number[] = [], U: number[] = [], I: number[] = [];
  const side = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    side.set(-tan.z, 0, tan.x).normalize();
    const lift = 0.12 + Math.max(0, Math.hypot(p.x, p.z) - 250) * 0.0015;
    for (const s of [-1, 1]) {
      const x = p.x + side.x * s * W / 2, z = p.z + side.z * s * W / 2;
      P.push(x, height(x, z) + lift, z);
      U.push(s < 0 ? 0 : 1, (t * len) / 24);
    }
    if (i > 0) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: roadTexture(), roughness: 0.95, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // the sand on it is in its texture; dust on top would bury it
  noWeather(mat);
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/**
 * The motorway on its piers, where it gave out: one span down in a V where
 * the old road passes under it, a stretch with nothing left on the piers,
 * lamp posts bent over, and cars still up there.
 */
function buildMotorway(cars: [number, number, number, number][]): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa89c8a, roughness: 0.92, metalness: 0 });
  const stained = new THREE.MeshStandardMaterial({ color: 0x847868, roughness: 0.95, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.8, metalness: 0.5 });
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const DECK = 13, SPAN = 32, W = 22;
  const skew = Math.atan(0.04);
  const r = rng(61);
  const underRoad = -310; // where the old road goes under
  for (let x = -1100; x <= 1100; x += SPAN) {
    const z = highwayZ(x), y0 = height(x, z) - 1;
    const bare = x > 180 && x < 330;
    // the one span over the old road is the one that came down
    const down = x <= underRoad && underRoad < x + SPAN;
    // pier: a column and its hammerhead
    kit.at = place(x, 0, z, -skew);
    kit.block(stained, 3, DECK - y0 - 1.2, 3, 0, y0 + (DECK - y0 - 1.2) / 2, 0);
    kit.block(concrete, 3.4, 1.4, W * 0.8, 0, DECK - 1.6, 0);
    kit.at = null;
    if (bare || x >= 1100) continue;
    const x1 = x + SPAN, z1 = highwayZ(x1);
    if (down) {
      // the fallen span, in two pieces tipped into the gap
      const mid = V((x + x1) / 2, height((x + x1) / 2, (z + z1) / 2) + 1, (z + z1) / 2);
      for (const [a, b] of [[V(x, DECK - 0.5, z), mid], [mid, V(x1, DECK - 0.5, z1)]] as const) {
        kit.member(concrete, a, b, 1.6, W);
      }
      continue;
    }
    kit.at = place((x + x1) / 2, 0, (z + z1) / 2, -skew);
    kit.block(concrete, SPAN, 1.6, W, 0, DECK - 0.1, 0);
    for (const s of [-1, 1]) kit.block(stained, SPAN, 1.1, 0.4, 0, DECK + 1.2, s * (W / 2 - 0.2));
    // lamp posts, most of them bent over
    const bend = r() < 0.7 ? 0.5 + r() * 1.0 : 0;
    kit.member(steel, V(0, DECK + 0.7, W / 2 - 1), V(0, DECK + 9, W / 2 - 1 - 3 * Math.sin(bend)), 0.25);
    kit.at = null;
    // a few cars left up here
    if (r() < 0.45) cars.push([(x + x1) / 2 + (r() - 0.5) * 20, DECK + 0.7, (z + z1) / 2 + (r() - 0.5) * 14, r() * Math.PI]);
  }
  kit.build(g, false);
  return g;
}

/** Power pylons marching off to the city, with nothing left to carry; one went over. */
function buildPylons(): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const steel = new THREE.MeshStandardMaterial({ color: 0x6a625a, roughness: 0.75, metalness: 0.55 });
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const H = 42;
  const leg = (sx: number, sz: number, y: number) => {
    const b = 4 - 3 * (y / H);
    return V(sx * b, y, sz * b);
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const x = 380 - 150 * t, z = 240 - 1300 * t;
    if (!clearOf(x, z, 0) && Math.hypot(x, z) < 250) continue;
    const toppled = i === 3;
    const m = place(x, height(x, z) - 0.3, z, 0.1);
    if (toppled) m.multiply(new THREE.Matrix4().makeRotationZ(1.35));
    kit.at = m;
    for (const [sx, sz] of corners) kit.member(steel, leg(sx, sz, 0), leg(sx, sz, H), 0.35);
    for (let y = 0; y < H; y += 6) {
      for (let c = 0; c < 4; c++) {
        const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
        kit.member(steel, leg(ax, az, y), leg(bx, bz, Math.min(H, y + 6)), 0.14);
        kit.member(steel, leg(bx, bz, y), leg(ax, az, Math.min(H, y + 6)), 0.14);
      }
    }
    for (const y of [H * 0.78, H * 0.95]) kit.block(steel, 18 - (y / H) * 6, 0.6, 1.2, 0, y, 0);
    kit.at = null;
  }
  kit.build(g, false);
  return g;
}

/** A car, as a rusted shell: body, cabin and four wheels, the wheels darker. */
function carGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, k: number) => {
    geo.deleteAttribute('uv');
    const g2 = geo.index ? geo.toNonIndexed() : geo;
    const n = g2.getAttribute('position').count;
    g2.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(k), 3));
    parts.push(g2);
  };
  const body = new THREE.BoxGeometry(4.4, 0.8, 1.8); body.translate(0, 0.75, 0); add(body, 1);
  const cabin = new THREE.BoxGeometry(2.2, 0.7, 1.6); cabin.translate(-0.3, 1.5, 0); add(cabin, 0.85);
  const glass = new THREE.BoxGeometry(2.25, 0.45, 1.62); glass.translate(-0.3, 1.5, 0); add(glass, 0.25);
  for (const [x, z] of [[-1.4, -0.85], [1.4, -0.85], [-1.4, 0.85], [1.4, 0.85]]) {
    const w = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 8);
    w.rotateX(Math.PI / 2);
    w.translate(x, 0.36, z);
    add(w, 0.18);
  }
  return mergeGeometries(parts);
}

/**
 * Everything else that got left: shipping containers, cars, and the junk
 * that lies about between them. Containers near enough to walk into are solid.
 */
function buildWrecks(cars: [number, number, number, number][]): THREE.Group {
  const g = new THREE.Group();
  const r = rng(67);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();

  // containers: a yard of them to the south-west, and the rest wherever they came down
  const CONT = [0x8a3a2a, 0x2e5a7a, 0x3e6a4a, 0xa0622a, 0x7a7a74, 0x6a4a3a, 0xb09a5a];
  const cGeo = new THREE.BoxGeometry(12.2, 2.6, 2.44);
  cGeo.translate(0, 1.3, 0);
  // the ribs run round the box, a repeat every two metres
  const cuv = cGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 6, cuv.getY(i));
  const cMat = new THREE.MeshStandardMaterial({ map: corrugatedTexture(), roughness: 0.75, metalness: 0.35 });
  const near: THREE.Matrix4[] = [], far: THREE.Matrix4[] = [], nearC: THREE.Color[] = [], farC: THREE.Color[] = [];
  const put = (x: number, y: number, z: number, ry: number, rx = 0, rz = 0) => {
    const m = place(x, y, z, ry, rx, rz);
    const c = col.setHex(CONT[Math.floor(r() * CONT.length)]).multiplyScalar(0.7 + r() * 0.35).clone();
    (Math.hypot(x, z) < NEAR - 20 ? near : far).push(m);
    (Math.hypot(x, z) < NEAR - 20 ? nearC : farC).push(c);
  };
  // the yard: rows, stacked two and three high
  for (let row = 0; row < 6; row++) {
    for (let k = 0; k < 7; k++) {
      const x = -330 + k * 14 + (r() - 0.5), z = 210 + row * 5.2;
      if (r() < 0.12) continue;
      const tiers = 1 + Math.floor(r() * 3);
      for (let t = 0; t < tiers; t++) put(x + (r() - 0.5) * 0.6, height(x, z) - 0.3 + t * 2.6, z, 0.25 + (r() - 0.5) * 0.04);
    }
  }
  // strays, some half buried, some on their side
  for (let n = 0, tries = 0; n < 110 && tries < 2000; tries++) {
    const a = r() * Math.PI * 2, d = 110 + Math.sqrt(r()) * 800;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!clearOf(x, z, 4)) continue;
    n++;
    const tipped = r() < 0.3;
    put(x, height(x, z) - (tipped ? 1.2 : 0.3 + r() * 1.2), z, r() * Math.PI, tipped ? 1.4 : (r() - 0.5) * 0.15, (r() - 0.5) * 0.2);
  }
  for (const [list, cols, solid] of [[near, nearC, true], [far, farC, false]] as const) {
    const inst = new THREE.InstancedMesh(cGeo, cMat, list.length);
    list.forEach((m, i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, cols[i]); });
    inst.castShadow = solid;
    inst.receiveShadow = true;
    inst.userData.solid = solid;
    if (!solid) inst.userData.noCollide = true;
    inst.computeBoundingSphere();
    g.add(inst);
  }

  // cars: along the old road where the traffic stopped, and scattered
  const curve = new THREE.CatmullRomCurve3(ROAD.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  for (let i = 0; i < 70; i++) {
    const t = 0.06 + r() * 0.9, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const off = (r() - 0.5) * 11;
    const x = p.x - tan.z * off, z = p.z + tan.x * off;
    cars.push([x, height(x, z) - r() * 0.5, z, Math.atan2(-tan.z, tan.x) + (r() - 0.5) * 0.6 + (r() < 0.1 ? Math.PI : 0)]);
  }
  for (let n = 0, tries = 0; n < 50 && tries < 1000; tries++) {
    const a = r() * Math.PI * 2, d = 90 + Math.sqrt(r()) * 700;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!clearOf(x, z, 2)) continue;
    n++;
    cars.push([x, height(x, z) - r() * 0.7, z, r() * Math.PI * 2]);
  }
  const CARS = [0x7a4a30, 0x6a5040, 0x5a4a3a, 0x8a5a3a, 0x4a4a48, 0x7a6a5a];
  const carInst = new THREE.InstancedMesh(carGeometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.8, metalness: 0.4,
  }), cars.length);
  cars.forEach(([x, y, z, ry], i) => {
    const flipped = r() < 0.08;
    carInst.setMatrixAt(i, place(x, y + (flipped ? 1.9 : 0), z, ry, flipped ? Math.PI : 0, (r() - 0.5) * 0.1));
    carInst.setColorAt(i, col.setHex(CARS[Math.floor(r() * CARS.length)]).multiplyScalar(0.7 + r() * 0.4));
  });
  carInst.castShadow = true;
  carInst.receiveShadow = true;
  carInst.computeBoundingSphere();
  g.add(carInst);

  // and the small stuff: tyres, drums, crates, pipe, sheet
  const JUNK: [THREE.BufferGeometry, number, number][] = [
    [new THREE.TorusGeometry(0.42, 0.17, 5, 10), 0x222020, 380],
    [new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10).translate(0, 0.45, 0), 0x7a4a2a, 300],
    [new THREE.BoxGeometry(1.1, 0.8, 0.9).translate(0, 0.4, 0), 0x6a5a44, 260],
    [new THREE.CylinderGeometry(0.22, 0.22, 4, 8).rotateZ(Math.PI / 2).translate(0, 0.22, 0), 0x5a5a58, 160],
    [new THREE.BoxGeometry(2.4, 0.06, 1.2).translate(0, 0.03, 0), 0x6e6458, 220],
  ];
  for (const [geo, hex, count] of JUNK) {
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.3 }), count);
    let n = 0;
    for (let tries = 0; n < count && tries < count * 10; tries++) {
      const a = r() * Math.PI * 2, d = 25 + Math.sqrt(r()) * 380;
      const x = Math.cos(a) * d - 30, z = Math.sin(a) * d;
      // round the pad but not on it, not in Crater 4 or on the filled ones
      if (x > -95 && x < 45 && z > -45 && z < 60) continue;
      if (Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.R * 1.6) continue;
      if (FILLED_CRATERS.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + 1.5)) continue;
      if (wild(x, z) < 0.05 && r() < 0.7) continue;
      m4.compose(
        _p.set(x, height(x, z) - 0.05, z),
        _q.setFromEuler(_e.set((r() - 0.5) * 0.8, r() * Math.PI * 2, (r() - 0.5) * 0.8)),
        _s.setScalar(0.7 + r() * 0.6),
      );
      inst.setMatrixAt(n, m4);
      inst.setColorAt(n, col.setHex(hex).multiplyScalar(0.7 + r() * 0.5));
      n++;
    }
    _s.set(1, 1, 1);
    inst.count = n;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    g.add(inst);
  }
  return g;
}

/** Towers of loose bales near the plant, a bale at a time, that you can walk between. */
function buildStacks(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(29);
  const BALE = 1.8;
  // four bale faces from the sheet, so neighbours are not all the same bale
  const tex = baleTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.12 });
  const variants = [0, 5, 10, 15].map((cell) => {
    const geo = new THREE.BoxGeometry(BALE, BALE, BALE);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const cu = (cell % 4) / 4, cv = Math.floor(cell / 4) / 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + uv.getX(i) / 4, cv + uv.getY(i) / 4);
    return geo;
  });
  const lists: THREE.Matrix4[][] = [[], [], [], []];
  const cols: THREE.Color[][] = [[], [], [], []];
  const TINT = [0xc0ac92, 0xb4a48c, 0xa89c8a, 0xc8b69a];
  // off the site, and off the old road and out from under the motorway
  const inTheWay = (x: number, z: number) =>
    (x > -190 && x < 230 && z > -100 && z < 105) || (z > 40 && Math.abs(x + 20) < 180)
    || roadDistance(x, z) < 14 || Math.abs(z - highwayZ(x)) < 18;
  let n = 0;
  for (let t = 0; t < 400 && n < 1700; t++) {
    const x = (r() - 0.5) * 560, z = -300 + r() * 560;
    if (inTheWay(x, z)) continue;
    // squat, the way a robot stacks them: two or three square, and the
    // taller the wider, with the top course often not finished
    const foot = r() < 0.55 ? 2 : 3;
    const high = 3 + Math.floor(r() ** 1.4 * (foot === 2 ? 9 : 14));
    for (let cx = 0; cx < foot; cx++) {
      for (let cz = 0; cz < foot; cz++) {
        const own = high - (r() < 0.35 ? 1 : 0);
        for (let k = 0; k < own && n < 1700; k++) {
          const v = Math.floor(r() * 4);
          const y = height(x, z) + 0.6 + k * BALE;
          lists[v].push(place(x + cx * BALE + (r() - 0.5) * 0.15, y, z + cz * BALE + (r() - 0.5) * 0.15, (r() - 0.5) * 0.12));
          cols[v].push(new THREE.Color(TINT[Math.floor(r() * TINT.length)]).multiplyScalar(0.8 + r() * 0.3));
          n++;
        }
      }
    }
  }
  variants.forEach((geo, v) => {
    const inst = new THREE.InstancedMesh(geo, mat, lists[v].length);
    lists[v].forEach((m, i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, cols[v][i]); });
    inst.userData.solid = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    g.add(inst);
  });
  return g;
}

/** The billboard by the old road, facing the plant. */
function buildBillboard(): THREE.Group {
  const g = new THREE.Group();
  const post = metal(0x4a4640, 0.7, 0.5);
  for (const x of [-7, 7]) {
    const p = box(0.7, 12, 0.7, post);
    p.position.set(x, 6, -0.6);
    g.add(p);
  }
  const back = box(26, 10, 0.4, matte(0x5a5248, 0.9));
  back.position.set(0, 17, -0.4);
  g.add(back);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 9.4),
    new THREE.MeshStandardMaterial({ map: billboardTexture(), roughness: 0.85, metalness: 0 }),
  );
  face.position.set(0, 17, -0.18);
  g.add(face);
  // it has been leaning since about 2300
  const x = -125, z = -185;
  g.position.set(x, height(x, z) - 0.5, z);
  g.rotation.set(0, 0.28, 0.035);
  return g;
}

/** A water tanker by the store, because nothing else brings water. */
function buildTanker(): THREE.Group {
  const tanker = new THREE.Group();
  const cab = box(2.4, 2.6, 2.6, metal(0x8a5a2a, 0.6, 0.4));
  cab.position.set(4.4, 1.9, 0);
  tanker.add(cab);
  const tank = cyl(1.3, 1.3, 7, metal(0x9aa2a8, 0.4, 0.8), 18);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-0.6, 2.1, 0);
  tanker.add(tank);
  const band = strip(7, C.water, 0.1, 1.4);
  band.position.set(-0.6, 3.45, 0);
  tanker.add(band);
  for (const wx of [-3, 0, 4.4]) {
    for (const wz of [-1.2, 1.2]) {
      const wheel = cyl(0.6, 0.6, 0.4, matte(0x1a1a1a, 0.9), 12);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.6, wz);
      tanker.add(wheel);
    }
  }
  tanker.position.set(9, 0, 23);
  tanker.rotation.y = 0.4;
  return tanker;
}

// ------------------------------------------------------------ assembly

/**
 * Lay the wasteland round the plant. The stage has already had Caretaker's
 * look applied over with LAST_SHIFT_LOOK.
 */
export function buildWasteland(root: THREE.Group, stage: Stage): Dressing {
  dustFog();
  weathering();
  // What keeps its own colour: anything liquid, and Crater 4 - the colour of
  // the paste going in is the strength it is reaching.
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (mat.userData.fluid || o.userData.unitId === 'stope') noWeather(mat);
    }
  });
  stage.hideDome();
  stage.aimSun(SUN);
  const land = new THREE.Group();
  land.name = 'wasteland';
  root.add(land);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMaterial(false));
  sky.frustumCulled = false;
  // drawn after the solid things, so it only shades the sky that shows (see earth.ts)
  sky.renderOrder = 1000;
  sky.userData.noCollide = true;
  land.add(sky);

  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(true));
  envSky.frustumCulled = false;
  envScene.add(envSky);
  stage.environmentFrom(envScene);
  envSky.geometry.dispose();
  (envSky.material as THREE.Material).dispose();

  land.add(buildGroundMesh(), buildApron(groundMaterial()), buildDrifts(), buildDerelicts());
  // what you can walk into: the stacks by the plant and the nearer containers
  land.add(buildStacks());
  const cars: [number, number, number, number][] = [];
  const scenery = new THREE.Group();
  scenery.userData.noCollide = true;
  scenery.add(buildBaleTowers(), buildCity(), buildRoad(), buildMotorway(cars), buildPylons(), buildBillboard());
  land.add(scenery);
  const wrecks = buildWrecks(cars);
  land.add(wrecks);
  const tanker = buildTanker();
  land.add(tanker);

  const dust = new Field({
    count: 1800,
    min: new THREE.Vector3(-260, 0, -200), max: new THREE.Vector3(260, 45, 200),
    drift: new THREE.Vector3(3.6, 0.05, 1.0), wobble: 1.3,
    size: 0.5, colour: 0xc8a472, opacity: 0.3, seed: 37,
  });
  land.add(dust.object);

  const time = (sky.material as THREE.ShaderMaterial).uniforms.uTime;
  return {
    update(t: Telemetry, dt: number, now: number) {
      dust.update(t, dt);
      time.value = now;
    },
  };
}
