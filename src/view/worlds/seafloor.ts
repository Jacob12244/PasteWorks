/**
 * 4,400 m down on the Clarion-Clipperton plain: the world round Station Nereid.
 *
 * No sunlight has ever reached this seabed, so every photon here is one the
 * station brought. The water is the scene's fog, rewritten for this world
 * (see deepWater()): it takes the red out first and the blue last, it goes to
 * black a few hundred metres out, and every floodlight lights the water it
 * shines through - so each lamp stands in its own glow of lit water and
 * falling snow. The light rig over the plant reaches as far as the plant and
 * no further. Past it the plain is dark, and what you can see of it is what
 * brought its own light: a second collector at work with its plume, the power
 * hub where the umbilical comes down, a monitoring lander by the tracks the
 * first collectors left half a century ago, moorings, transponder strobes.
 *
 * The camera carries a lamp, the way an ROV or a hardsuit does. On foot, the
 * plain is there at your feet: pale sediment carpeted with nodules, the
 * animals that live on it, and the lanes where the collectors took the
 * nodules away and left nothing living behind.
 *
 * Built once. The only lights it adds are the ones the water shader works out
 * for itself.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Telemetry } from '../../sim/plant';
import type { Look } from '../../scenario';
import type { Stage } from '../scene';
import type { GroundSpec } from '../terrain';
import { metal, matte, glow, glowUnique } from '../palette';
import { Dressing, rng, clamp01 } from './common';
import { lin, perlin, fbm, torusNoise, smooth, rrect, gridAxis, heightfield, Kit, mergeVerts } from './land';
import { FURROW_HOLE } from './ocean';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------- the look

/**
 * What lights the plant: a rig of floodlights overhead (the key, with its
 * shadows, and the hemisphere for what the water scatters back), which only
 * reaches the site - see seaRig(). The fog colour is the water itself, seen
 * through a long way of it.
 */
export const NEREID_LOOK: Partial<Look> = {
  // the density is the water's extinction for green light, per metre; see deepWater()
  fog: { color: 0x010308, density: 0.0072 },
  hemi: { sky: 0x5a86a0, ground: 0x1c150e, intensity: 0.6 },
  key: { color: 0xdcecff, intensity: 1.5 },
  fill: 0.12,
  rim: 0,
  pools: 1.4,
  exposure: 1.2,
  bloom: [0.8, 0.55, 0.62],
  env: 0.4,
};

/** The pad, under the same drape of sediment as everything else down here. */
export const NEREID_GROUND: GroundSpec = {
  plain: 0x6a5e4a, pad: 0x4e4a42, grid: [0x2f6f74, 0x2a3030], kerb: 0x35e0d0, cut: false,
  plainless: true, gridOpacity: 0.25, kerbGlow: 0.85,
};

const f4 = (v: number) => v.toFixed(4);
const v3 = (c: THREE.Color) => `vec3(${f4(c.r)}, ${f4(c.g)}, ${f4(c.b)})`;

/** Extinction per metre, red, green, blue: seawater takes the red first. */
const K = NEREID_LOOK.fog!.density!;
const EXT = new THREE.Color(K * 2.6, K, K * 0.62);

// ------------------------------------------------------------ the plain

const G0 = -0.4;
const EDGE = 1100;
const NEAR = 300;
/** metres per repeat of the seabed's detail texture */
const TILE = 3;
const n1 = perlin(301), n2 = perlin(303), n3 = perlin(307), n4 = perlin(311);

/** Level ground: the plant, the collector's block, and the furrows. */
const SITE = [
  { cx: -25, cz: 9.5, hx: 72, hz: 55, r: 12 },
  { cx: -126, cz: 0, hx: 32, hz: 52, r: 10 },
  { cx: 162, cz: 0, hx: 114, hz: 60, r: 16 },
];

function siteDistance(x: number, z: number) {
  let d = Infinity;
  for (const s of SITE) d = Math.min(d, rrect(x, z, s.cx, s.cz, s.hx, s.hz, s.r));
  return d;
}

const wild = (x: number, z: number) => smooth(0, 55, siteDistance(x, z));

/**
 * A soft plain: long low swells, sediment waves a few decimetres high - and,
 * out in the dark, the abyssal hills, ridges running north-south a few
 * hundred metres apart.
 */
function natural(x: number, z: number) {
  const r = Math.hypot(x, z);
  let h = 1.6 * fbm(n1, x / 150, z / 150, 3) + 0.35 * fbm(n2, x / 28, z / 28, 2);
  const ridge = 0.5 + 0.5 * Math.sin(((x + 90 * fbm(n3, x / 600, z / 600, 2)) / 520) * Math.PI * 2);
  h += smooth(320, 800, r) * 30 * ridge * ridge;
  return h;
}

function height(x: number, z: number) {
  return G0 + wild(x, z) * natural(x, z);
}

// ---- the places out on the plain

/** Floodlight masts, as world.ts puts them up round the pad. */
const MASTS: [number, number][] = [[-34, -16], [12, 14], [-60, 14], [-100, -22], [-124, 4]];
/** Light towers down the furrow, on the south side of Furrow 7. */
const TOWERS: [number, number][] = [[95, -10], [160, -10], [225, -10]];
const HUB = { x: -238, z: -72 };
const LANDER = { x: 188, z: 106 };
/** the first-generation collector, where it stopped fifty years ago, heading (cos a, sin a) */
const WRECK = { x: 205, z: 128, a: 0.42 };
/** the second collector, working the next block */
const C2 = { x: -268, z: -178 };
const WHALE = { x: -50, z: -82, a: -0.35 };
const MOORINGS: [number, number][] = [[-150, -130], [262, -95]];
const TRANSPONDERS: [number, number][] = [[-185, 64], [84, -142], [305, 92], [-58, 172], [328, -118], [-338, 36]];

/** Distance from the whale's spine, head to tail. */
function whaleDistance(x: number, z: number) {
  const dx = Math.cos(WHALE.a), dz = Math.sin(WHALE.a);
  const px = x - WHALE.x, pz = z - WHALE.z;
  const s = Math.max(-8, Math.min(10, px * dx + pz * dz));
  return Math.hypot(px - dx * s, pz - dz * s);
}

// ---- where the collectors have been

interface Block {
  cx: number; cz: number;
  /** direction of travel, radians from +x towards +z */
  a: number;
  across: number; along: number;
  lane: number; track: number; trackW: number; pitch: number;
  /** 0 fresh, 1 fifty years old */
  age: number;
}

const BLOCKS: Block[] = [
  // the collector's own block, worked up and down z
  { cx: -126, cz: 0, a: Math.PI / 2, across: 24, along: 46, lane: 12, track: 4.6, trackW: 0.9, pitch: 0.42, age: 0 },
  // the block the furrows are cut in, worked along x
  { cx: 162, cz: 0, a: 0, across: 56, along: 106, lane: 12, track: 4.6, trackW: 0.9, pitch: 0.42, age: 0 },
  // three passes of a first-generation collector: fifty years, and still sharp
  {
    cx: WRECK.x - Math.cos(WRECK.a) * 81, cz: WRECK.z - Math.sin(WRECK.a) * 81, a: WRECK.a,
    across: 7.5, along: 75, lane: 5, track: 1.9, trackW: 0.5, pitch: 0.3, age: 1,
  },
  // collector 2's block, out in the dark, behind it as it works north
  { cx: C2.x, cz: C2.z - 54, a: Math.PI / 2, across: 30, along: 47, lane: 12, track: 4.6, trackW: 0.9, pitch: 0.42, age: 0 },
];

function minedAt(x: number, z: number, margin = 1) {
  for (const b of BLOCKS) {
    const dx = x - b.cx, dz = z - b.cz;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const along = dx * c + dz * s, across = -dx * s + dz * c;
    if (Math.abs(across) < b.across + margin && Math.abs(along) < b.along + margin) return true;
  }
  return false;
}

/** How thickly the nodules lie: patchy, and cleared round the pad by the builders. */
function cover(x: number, z: number) {
  const base = Math.min(0.46, Math.max(0.1, 0.3 + 0.16 * fbm(n4, x / 160, z / 160, 3)));
  const d = rrect(x, z, -22, 12, 64, 52, 8);
  return base * (0.2 + 0.8 * smooth(4, 34, d));
}

const SED = {
  base: lin(0x9a8a6c), dark: lin(0x7f725a), pale: lin(0xb2a486), grey: lin(0x9a968a),
  stain: lin(0x4a4034), mat: lin(0xd8d4c4),
};

function sediment(x: number, z: number, out: THREE.Color) {
  out.copy(SED.base).lerp(SED.dark, clamp01(0.5 + 1.2 * fbm(n2, x / 55, z / 55, 3)));
  out.lerp(SED.pale, clamp01(0.3 + fbm(n3, x / 210, z / 210, 2)) * 0.5);
  // round the plant, cement dust and a thousand ROV landings
  const d = rrect(x, z, -22, 12, 64, 52, 8);
  out.lerp(SED.grey, (1 - smooth(0, 40, d)) * 0.45);
  // the whale fall: a dark ring of sulphide round it, and white mats of bacteria
  const w = whaleDistance(x, z);
  out.lerp(SED.stain, (1 - smooth(2, 14, w)) * 0.6);
  out.lerp(SED.mat, (1 - smooth(0, 5, w)) * clamp01(0.4 + fbm(n1, x / 3, z / 3, 2)) * 0.6);
  return out;
}

// ------------------------------------------------------------- the lamps

interface Lamp { at: THREE.Vector3; colour: number; power: number; down: boolean }

/** Every lamp that lights the water it shines through. */
const LAMPS: Lamp[] = [
  ...MASTS.map(([x, z]): Lamp => ({ at: V(x, 17.6, z), colour: 0xfff0e0, power: 0.12, down: true })),
  ...TOWERS.map(([x, z]): Lamp => ({ at: V(x, height(x, z) + 13.1, z), colour: 0xe8f2ff, power: 0.12, down: true })),
  { at: V(HUB.x + 2, height(HUB.x, HUB.z) + 11.3, HUB.z), colour: 0xffe4c0, power: 0.16, down: true },
  { at: V(LANDER.x, height(LANDER.x, LANDER.z) + 3.6, LANDER.z), colour: 0xdaf0ff, power: 0.1, down: true },
  { at: V(C2.x, height(C2.x, C2.z) + 6.5, C2.z + 6), colour: 0xffe8c0, power: 0.2, down: true },
  // the control room, through the glass of its sphere
  { at: V(-14, 4.5, 50), colour: 0x80d8ff, power: 0.03, down: false },
];

/** Where the light rigs reach: the plant, the collector's block, the furrows. */
const RIG_BOXES: [number, number, number, number][] = [
  [-25, 9.5, 70, 52.5], [-126, 0, 30, 50], [162, 0, 112, 58],
];
/** and pools of it round the outposts: x, z, radius, strength */
const RIG_SPOTS: [number, number, number, number][] = [
  [HUB.x, HUB.z, 30, 0.9], [LANDER.x + 10, LANDER.z + 12, 32, 0.9], [C2.x, C2.z, 34, 0.85],
];

/**
 * The water, as GLSL, with everything about it baked in (none of it moves):
 * its extinction, the lamps, where the rig reaches, and the light the lamps
 * scatter towards the eye along a ray - worked out in closed form per lamp,
 * so it costs a couple of arctangents rather than a march.
 */
const SEA_GLSL = /* glsl */ `
const vec3 SEA_EXT = ${v3(EXT)};
const vec3 SEA_DARK = vec3(0.0003, 0.0012, 0.0028);
const int SEA_N = ${LAMPS.length};
const vec4 SEA_LP[SEA_N] = vec4[SEA_N](${LAMPS.map((l) => `vec4(${f4(l.at.x)}, ${f4(l.at.y)}, ${f4(l.at.z)}, ${l.down ? '1.0' : '0.0'})`).join(', ')});
const vec3 SEA_LC[SEA_N] = vec3[SEA_N](${LAMPS.map((l) => v3(lin(l.colour, l.power))).join(', ')});

float seaBox(vec2 p, vec4 b) {
  vec2 q = abs(p - b.xy) - b.zw;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

/** How much of the overhead rig reaches here: all of it on site, next to nothing out on the plain. */
float seaRig(vec3 p) {
  float d = 1e9;
  ${RIG_BOXES.map((b) => `d = min(d, seaBox(p.xz, vec4(${b.map(f4).join(', ')})));`).join('\n  ')}
  float k = exp(-max(d, 0.0) * ${f4(1 / 26)});
  vec2 s;
  ${RIG_SPOTS.map(([x, z, R, w]) => `s = p.xz - vec2(${f4(x)}, ${f4(z)}); k = max(k, ${f4(w)} * exp(-dot(s, s) * ${f4(1 / (R * R))}));`).join('\n  ')}
  // and it is a rig of floodlights, not a sky: nothing reaches far up the water
  k *= exp(-max(p.y - 40.0, 0.0) * 0.02);
  return 0.03 + 0.97 * k;
}

/**
 * Light scattered towards the eye along a ray from ro, direction rd, length T.
 * For a lamp at distance h from the ray the integral of 1/r^2 along it is
 * (atan((T - tc)/h) + atan(tc/h)) / h; the water in the way and the lamp's
 * cone are taken at the ray's nearest point to the lamp, and a little extra
 * is added looking into the lamp, for the forward scatter.
 */
// atan to within about 0.005 rad - plenty for a glow, at a fraction of the cost
float seaAtan(float x) {
  float a = abs(x);
  float b = min(a, 1.0 / a);
  float r = b / (1.0 + 0.28 * b * b);
  r = a > 1.0 ? 1.5707963 - r : r;
  return x < 0.0 ? -r : r;
}

vec3 seaScatter(vec3 ro, vec3 rd, float T) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < SEA_N; i++) {
    vec3 q = SEA_LP[i].xyz - ro;
    float tc = dot(q, rd);
    float qq = dot(q, q);
    float h2 = max(qq - tc * tc, 0.36);
    if (h2 > 14400.0) continue;
    float h = sqrt(h2);
    float a = seaAtan((T - tc) / h) + seaAtan(tc / h);
    float tn = clamp(tc, 0.0, T);
    vec3 toP = ro + rd * tn - SEA_LP[i].xyz;
    float dl = length(toP) + 1e-3;
    float cone = mix(1.0, smoothstep(-0.2, 0.6, -toP.y / dl), SEA_LP[i].w);
    float fwd = max(tc * inversesqrt(qq), 0.0);
    fwd *= fwd; fwd *= fwd; fwd *= fwd;
    acc += SEA_LC[i] * (cone * (1.0 + 3.0 * fwd) * a / h) * exp(-SEA_EXT * (tn + dl));
  }
  return acc;
}
`;

/** The lamp every camera carries - an ROV's, or a hardsuit's - and what it does to the snow. */
const HEAD = lin(0xfff2e0, 30);
const SILT = lin(0x8a7c64);

/**
 * Rewrite the water for every material on the page, the way wasteland.ts
 * rewrites the dust:
 *
 *   fog       extinction per colour, the water's own dark, and the light each
 *             lamp scatters back along the view ray;
 *   lights    the key and hemisphere are the rig over the plant, so they are
 *             scaled by how far it reaches (seaRig); and a lamp at the eye,
 *             off inside the control room, whose own lights are plenty;
 *   silt      marine snow settles on anything that faces up, a little - the
 *             plant has been down here a few years. NO_SILT opts out.
 *
 * Every material is compiled after this runs, because a page builds its
 * world before it renders anything.
 */
let patched = false;
function deepWater() {
  if (patched) return;
  patched = true;
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
      ${SEA_GLSL}
      const vec3 SEA_HEAD = ${v3(HEAD)};
      const vec3 SEA_SILT = ${v3(SILT)};
      float seaHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float seaNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), u.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
    #endif`;
  S.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        vec3 seaRay = vFogWorld - cameraPosition;
        float seaLen = length(seaRay);
        vec3 seaT = exp(-SEA_EXT * seaLen);
        gl_FragColor.rgb = gl_FragColor.rgb * seaT + SEA_DARK * (1.0 - seaT)
          + seaScatter(cameraPosition, seaRay / max(seaLen, 1e-3), seaLen);
      #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
      #endif
    #endif`;

  const rig = /* glsl */ `
    #ifdef USE_FOG
      float seaRigK = seaRig(vFogWorld);
    #else
      float seaRigK = 1.0;
    #endif
  `;
  const headlamp = /* glsl */ `
    #if defined( USE_FOG ) && defined( RE_Direct )
    if (length(cameraPosition.xz - vec2(-14.0, 51.4)) > 9.5 || cameraPosition.y > 9.0) {
      // in view space: the eye at the origin looking down -z, the lamp on the right shoulder
      vec3 hlv = vec3(0.6, 0.5, 0.0) - geometryPosition;
      float hld = length(hlv);
      IncidentLight hl;
      hl.direction = hlv / hld;
      float hlSpot = smoothstep(0.8, 0.95, -hl.direction.z);
      hl.color = SEA_HEAD * hlSpot * exp(-SEA_EXT * 2.0 * hld) / (1.0 + hld * hld * 0.35);
      hl.visible = true;
      RE_Direct( hl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
    #endif
  `;
  S.lights_fragment_begin = rig + S.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= seaRigK;',
  ) + headlamp;
  S.lights_fragment_end = /* glsl */ `
    #if defined( RE_IndirectDiffuse )
      irradiance *= seaRigK;
      iblIrradiance *= seaRigK;
    #endif
    #if defined( RE_IndirectSpecular )
      radiance *= seaRigK;
    #endif
  ` + S.lights_fragment_end;
  S.normal_fragment_maps += /* glsl */ `
    #if defined( STANDARD ) && defined( USE_FOG ) && !defined( NO_SILT )
    vec3 siltN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    if (siltN.y > 0.55) {
      float siltK = smoothstep(0.55, 0.95, siltN.y) * (0.55 + 0.45 * seaNoise(vFogWorld.xz * 0.9 + vFogWorld.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, SEA_SILT, siltK * 0.4);
      roughnessFactor = mix(roughnessFactor, 0.95, siltK * 0.6);
      metalnessFactor = mix(metalnessFactor, 0.0, siltK * 0.6);
    }
    #endif`;
}

const noSilt = (m: THREE.Material) => { m.defines = { ...(m.defines ?? {}), NO_SILT: '' }; };

// ---------------------------------------------------------- the water

/**
 * The water behind everything, drawn at infinity round the camera and after
 * the solid things, so it only shades what shows: black, the glow of every
 * lamp in it, and now and then the blue flash of something alive. For the
 * reflections (`env`) it is the rig overhead and the lamps round the plant.
 */
function waterMaterial(env: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    defines: env ? { SEA_ENV: 1 } : {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      ${SEA_GLSL}
      uniform float uTime;
      varying vec3 vDir;
      float h31(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      void main() {
        vec3 d = normalize(vDir);
      #ifdef SEA_ENV
        vec3 c = vec3(0.004, 0.011, 0.016)
          + vec3(0.05, 0.085, 0.1) * pow(max(d.y, 0.0), 1.5)
          + vec3(0.03, 0.025, 0.018) * smoothstep(0.05, -0.3, d.y);
        for (int i = 0; i < SEA_N; i++) {
          vec3 l = normalize(SEA_LP[i].xyz - vec3(-25.0, 6.0, 0.0));
          c += SEA_LC[i] * 200.0 * pow(max(dot(d, l), 0.0), 900.0);
        }
      #else
        vec3 c = SEA_DARK + seaScatter(cameraPosition, d, 1500.0);
        // bioluminescence: the odd flash, far off in the dark
        vec3 g = d * 80.0;
        vec3 cell = floor(g);
        float h = h31(cell);
        if (h > 0.985) {
          vec3 cp = cell + 0.5 + (vec3(h31(cell + 1.3), h31(cell + 2.7), h31(cell + 5.1)) - 0.5) * 0.5;
          float tw = pow(max(sin(uTime * (0.4 + h * 2.0) + h * 400.0), 0.0), 40.0);
          c += vec3(0.05, 0.3, 0.9) * tw * smoothstep(0.3, 0.0, length(g - cp)) * 0.8;
        }
      #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// --------------------------------------------------------- the seabed

let seabedTex: { map: THREE.DataTexture; normal: THREE.DataTexture } | null = null;

/**
 * Three metres of seabed, close up: pale sediment worked over by everything
 * that lives in it - burrows, feeding trails, casts - and two sets of nodules
 * lying on it, in the red and green channels, so the shader can put down as
 * many as the ground here has (a mask each, which mipmaps to the right
 * darkness far off). Blue is the sediment's tone. A normal map from the same
 * heights.
 */
function seabedTexture() {
  if (seabedTex) return seabedTex;
  const S = 512, PX = S / TILE;
  const r = rng(29);
  const t1 = perlin(401), t2 = perlin(402);
  const A = new Float32Array(S * S), B = new Float32Array(S * S);
  const sed = new Float32Array(S * S), hgt = new Float32Array(S * S);
  const occ = new Uint8Array(S * S);
  // how much light gets to each point of a set of nodules: less round their edges and in the ring of shadow each sits in
  const shadeA = new Float32Array(S * S).fill(1), shadeB = new Float32Array(S * S).fill(1);
  const wrap = (v: number) => ((Math.round(v) % S) + S) % S;
  const at = (u: number, v: number) => wrap(v) * S + wrap(u);

  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      const k = v * S + u;
      sed[k] = 0.5 + 0.2 * torusNoise(t1, u, v, S, 4) + 0.1 * torusNoise(t2, u, v, S, 16);
      hgt[k] = 0.6 * torusNoise(t2, u, v, S, 9) + 0.3 * torusNoise(t1, u, v, S, 31);
    }
  }
  const stamp = (cx: number, cy: number, R: number, f: (d: number, k: number) => void) => {
    const n = Math.ceil(R);
    for (let dy = -n; dy <= n; dy++) {
      for (let dx = -n; dx <= n; dx++) {
        const d = Math.hypot(dx, dy) / R;
        if (d < 1) f(d, at(cx + dx, cy + dy));
      }
    }
  };
  // burrows: a hole, with the spoil thrown up round it
  for (let i = 0; i < 70; i++) {
    const cx = r() * S, cy = r() * S, rad = 2.5 + r() * 3;
    stamp(cx, cy, rad * 2.4, (d, k) => {
      const q = d * 2.4;
      if (q < 1) { sed[k] -= 0.3 * (1 - q); hgt[k] -= 2 * (1 - q * q); } else { sed[k] += 0.08 * (2.4 - q) / 1.4; hgt[k] += 0.5 * (2.4 - q) / 1.4; }
    });
  }
  // feeding trails: sea cucumbers plough grooves as they graze
  for (let i = 0; i < 9; i++) {
    let x = r() * S, y = r() * S, hd = r() * Math.PI * 2;
    const steps = 80 + r() * 90;
    for (let s = 0; s < steps; s++) {
      hd += (r() - 0.5) * 0.35;
      x += Math.cos(hd) * 2; y += Math.sin(hd) * 2;
      stamp(x, y, 3.2, (d, k) => { sed[k] -= 0.035 * (1 - d); hgt[k] -= 0.25 * (1 - d); });
    }
  }
  // casts and mounds
  for (let i = 0; i < 40; i++) {
    stamp(r() * S, r() * S, 4 + r() * 5, (d, k) => { sed[k] += 0.08 * (1 - d); hgt[k] += 1.4 * (1 - d * d); });
  }
  // the nodules: potato-sized lumps, 4 to 14 cm, in two sets that never overlap
  const place = (mask: Float32Array, shade: Float32Array, target: number) => {
    let covered = 0;
    for (let tries = 0; tries < 40000 && covered < target * S * S; tries++) {
      const cx = r() * S, cy = r() * S;
      const rad = (0.018 + 0.045 * r() * r() + (r() < 0.06 ? 0.035 : 0)) * PX;
      let clash = false;
      for (let j = 0; j < 9 && !clash; j++) {
        const a = (j / 8) * Math.PI * 2, rr = j === 8 ? 0 : rad * 1.25;
        if (occ[at(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)]) clash = true;
      }
      if (clash) continue;
      const ph1 = r() * 6.3, ph2 = r() * 6.3, e = 0.8 + 0.4 * r(), rot = r() * Math.PI;
      const ca = Math.cos(rot), sa = Math.sin(rot);
      const n = Math.ceil(rad * 1.5) + 1;
      for (let dy = -n; dy <= n; dy++) {
        for (let dx = -n; dx <= n; dx++) {
          const lx = (dx * ca + dy * sa) / e, ly = (-dx * sa + dy * ca) * e;
          const ang = Math.atan2(ly, lx);
          const edge = rad * (1 + 0.14 * Math.sin(3 * ang + ph1) + 0.08 * Math.sin(5 * ang + ph2));
          const d = Math.hypot(lx, ly);
          const c = clamp01(edge - d + 0.5);
          const k = at(cx + dx, cy + dy);
          if (d > edge && d < edge * 1.45) shade[k] = Math.min(shade[k], 1 - 0.32 * (1 - (d - edge) / (0.45 * edge)));
          if (c <= 0) continue;
          if (c > mask[k]) { covered += c - mask[k]; mask[k] = c; }
          occ[k] = 1;
          const dome = Math.sqrt(Math.max(0, 1 - (d / edge) ** 2));
          shade[k] = Math.min(shade[k], 0.45 + 0.55 * dome);
          hgt[k] = Math.max(hgt[k], dome * rad * 0.5 + 0.4 * torusNoise(t2, cx + dx, cy + dy, S, 70));
        }
      }
    }
  };
  place(A, shadeA, 0.2);
  place(B, shadeB, 0.2);

  const map = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4);
  for (let k = 0; k < S * S; k++) {
    map[k * 4] = A[k] * 255;
    map[k * 4 + 1] = B[k] * 255;
    map[k * 4 + 2] = clamp01(sed[k]) * 255;
    map[k * 4 + 3] = shadeA[k] * 255;
  }
  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      const nx = (hgt[at(u - 1, v)] - hgt[at(u + 1, v)]) * 0.5, ny = (hgt[at(u, v - 1)] - hgt[at(u, v + 1)]) * 0.5;
      const l = Math.hypot(nx, ny, 1);
      const k = (v * S + u) * 4;
      nrm[k] = (nx / l * 0.5 + 0.5) * 255;
      nrm[k + 1] = (ny / l * 0.5 + 0.5) * 255;
      nrm[k + 2] = (1 / l * 0.5 + 0.5) * 255;
      nrm[k + 3] = shadeB[v * S + u] * 255;
    }
  }
  const tex = (data: Uint8Array<ArrayBuffer>) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  seabedTex = { map: tex(map), normal: tex(nrm) };
  return seabedTex;
}

/** The mined blocks and the nodules' colour, for the seabed's shader. */
const GROUND_PARS = /* glsl */ `
varying float vCover;
const vec3 SEA_NODULE = ${v3(lin(0x4a3b2a))};
const int SEA_NB = ${BLOCKS.length};
const vec4 SEA_BA[SEA_NB] = vec4[SEA_NB](${BLOCKS.map((b) => `vec4(${f4(b.cx)}, ${f4(b.cz)}, ${f4(Math.cos(b.a))}, ${f4(Math.sin(b.a))})`).join(', ')});
const vec4 SEA_BB[SEA_NB] = vec4[SEA_NB](${BLOCKS.map((b) => `vec4(${f4(b.across)}, ${f4(b.along)}, ${f4(b.lane)}, ${f4(b.track)})`).join(', ')});
const vec4 SEA_BC[SEA_NB] = vec4[SEA_NB](${BLOCKS.map((b) => `vec4(${f4(b.trackW)}, ${f4(b.pitch)}, ${f4(b.age)}, 0.0)`).join(', ')});
// a bump from a height in metres, the way Mikkelsen does it, unnormalised so it keeps its scale
vec3 seaPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = dFdx(surf_pos);
  vec3 vSigmaY = dFdy(surf_pos);
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

/**
 * The seabed's colour, in place of the plain vertex colour: sediment, then
 * the collectors' lanes (no nodules, firmer paler sediment, the grousers of
 * the tracks printed in it and a berm at each lane's edge), then as many
 * nodules as lie here.
 */
const GROUND_COLOUR = /* glsl */ `
vec4 seaA = texture2D(map, vMapUv);
vec2 seaUvB = mat2(0.8, 0.6, -0.6, 0.8) * vMapUv * 0.77 + vec2(0.31, 0.17);
vec4 seaB = texture2D(map, seaUvB);
float seaMott = texture2D(map, vMapUv * 0.089 + vec2(0.5, 0.21)).b;
float seaMined = 0.0, seaTrack = 0.0, seaBars = 0.5, seaBerm = 0.0, seaStreak = 0.5, seaAge = 0.0;
vec2 seaP = vFogWorld.xz;
for (int i = 0; i < SEA_NB; i++) {
  vec4 bA = SEA_BA[i], bB = SEA_BB[i], bC = SEA_BC[i];
  vec2 d = seaP - bA.xy;
  float s = dot(d, bA.zw);
  float a = dot(d, vec2(-bA.w, bA.z));
  float edge = max(abs(a) - bB.x, abs(s) - bB.y);
  if (edge < 0.4) {
    float inside = 1.0 - smoothstep(-0.4, 0.4, edge);
    float la = mod(a + bB.x, bB.z) - 0.5 * bB.z;
    float tr = 1.0 - smoothstep(bC.x - 0.12, bC.x + 0.12, abs(abs(la) - bB.w));
    float sp = s / bC.y;
    float aa = clamp(1.0 - fwidth(sp) * 1.5, 0.0, 1.0);
    float bars = mix(0.5, smoothstep(0.35, 0.65, abs(fract(sp) - 0.5) * 2.0), aa);
    float berm = smoothstep(0.5 * bB.z - 0.9, 0.5 * bB.z - 0.15, abs(la));
    float streak = texture2D(map, vec2(la * 0.45, s * 0.012)).b;
    seaMined = max(seaMined, inside);
    seaTrack = mix(seaTrack, tr, inside);
    seaBars = mix(seaBars, bars, inside);
    seaBerm = mix(seaBerm, berm, inside);
    seaStreak = mix(seaStreak, streak, inside);
    seaAge = mix(seaAge, bC.z, inside);
  }
}
float seaCov = vCover * (1.0 - seaMined);
float seaNodA = seaA.r * smoothstep(0.0, 0.2, seaCov);
float seaNodB = seaB.g * smoothstep(0.18, 0.44, seaCov);
float seaNod = min(seaNodA + seaNodB, 1.0);
vec3 seaSed = vColor * (0.8 + 0.4 * seaA.b) * (0.86 + 0.28 * seaMott);
float seaFresh = 1.0 - 0.5 * seaAge;
vec3 seaLane = vColor * (1.06 + 0.1 * seaFresh) * (0.9 + 0.2 * seaStreak);
seaLane *= 1.0 - seaTrack * (0.08 + 0.14 * seaBars) * seaFresh;
seaLane *= 1.0 + 0.08 * seaBerm;
vec3 seaCol = mix(seaSed, seaLane, seaMined);
seaCol = mix(seaCol, SEA_NODULE * (0.75 + 0.5 * seaA.b), seaNod * 0.88);
// rounded, and sitting in their own shadow - only the nodules that are there
vec4 seaNBt = texture2D(normalMap, seaUvB);
seaCol *= mix(1.0, seaA.a, smoothstep(0.0, 0.2, seaCov)) * mix(1.0, seaNBt.a, smoothstep(0.18, 0.44, seaCov));
diffuseColor.rgb = seaCol;
float seaRough = mix(0.97, 0.62, seaNod);
float seaH = seaMined * (seaTrack * (seaBars - 0.5) * -0.05 * seaFresh + seaBerm * 0.1);
`;

/** The nodules' relief where they lie, the sediment's a little, and the tracks'. */
const GROUND_NORMAL = /* glsl */ `
vec3 seaNA = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
vec3 seaNB = seaNBt.xyz * 2.0 - 1.0;
seaNB.xy = mat2(0.8, -0.6, 0.6, 0.8) * seaNB.xy;
float seaWA = max(0.35 * (1.0 - seaMined), seaNodA);
vec3 mapN = vec3(seaNA.xy * seaWA + seaNB.xy * seaNodB, 1.0);
mapN.xy *= normalScale;
normal = normalize(tbn * mapN);
normal = seaPerturb(-vViewPosition, normal, vec2(dFdx(seaH), dFdy(seaH)), faceDirection);
`;

let groundMat: THREE.MeshStandardMaterial | null = null;
function groundMaterial() {
  if (groundMat) return groundMat;
  const { map, normal } = seabedTexture();
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, map, normalMap: normal, normalScale: new THREE.Vector2(1, 1),
    roughness: 0.96, metalness: 0,
  });
  noSilt(m);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float cover;\nvarying float vCover;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvCover = cover;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n' + GROUND_PARS)
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', GROUND_COLOUR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = seaRough;')
      .replace('#include <normal_fragment_maps>', GROUND_NORMAL);
  };
  m.customProgramCacheKey = () => 'nereid-seabed';
  groundMat = m;
  return m;
}

function buildSeabed(): THREE.Group {
  const [hx0, hx1, hz0, hz1] = FURROW_HOLE;
  const axis = (b: number[]) => gridAxis(EDGE, b, (a) => Math.min(40, 4 + Math.max(0, a - 220) * 0.035));
  const g = heightfield({
    xs: axis([hx0, hx1, -NEAR, NEAR]),
    zs: axis([hz0, hz1, -NEAR, NEAR]),
    height,
    colour: sediment,
    // Furrow 7 is the unit's own cut
    hole: (x, z) => x > hx0 && x < hx1 && z > hz0 && z < hz1,
    near: NEAR,
    material: groundMaterial(),
    tile: TILE,
  });
  // how thickly the nodules lie, per vertex, for the shader
  const geo = (g.children[0] as THREE.Mesh).geometry;
  const p = geo.getAttribute('position');
  const cov = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) cov[i] = cover(p.getX(i), p.getZ(i));
  const attr = new THREE.BufferAttribute(cov, 1);
  for (const m of g.children) (m as THREE.Mesh).geometry.setAttribute('cover', attr);
  return g;
}

// ------------------------------------------------------------ geometry

/** Merge primitives into one geometry of positions and normals. */
function fuse(...geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  }))!;
}

/** A tube along points, as geometry. */
const tubeGeo = (pts: THREE.Vector3[], r: number, seg: number, radial = 6) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial);

/** A cable laid across the seabed from a to b, snaking a little, just proud of it. */
function cablePath(a: [number, number], b: [number, number], wiggle: number, seed: number, lift = 0.12) {
  const r = rng(seed);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(4, Math.ceil(len / 4));
  const px = -(b[1] - a[1]) / len, pz = (b[0] - a[0]) / len;
  const ph = r() * 6, f = 1.5 + r() * 1.5;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = Math.sin(t * Math.PI) * wiggle * (Math.sin(t * Math.PI * f + ph) + 0.5 * Math.sin(t * Math.PI * f * 3.1 + ph * 2));
    const x = a[0] + (b[0] - a[0]) * t + px * w, z = a[1] + (b[1] - a[1]) * t + pz * w;
    pts.push(V(x, height(x, z) + lift, z));
  }
  return pts;
}

// ----------------------------------------------------------- the kit

/** Light towers down the furrow: a tripod, a float collar, and floods pointing down. */
function buildTowers(): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const steel = metal(0x7a8490, 0.5, 0.8), foam = matte(0xd8b030, 0.7), conc = matte(0x6e6a60, 0.95);
  const lamp = glow(0xfff4e0, 4);
  for (const [x, z] of TOWERS) {
    const y0 = height(x, z);
    kit.block(conc, 3.4, 0.8, 3.4, x, y0 + 0.4, z);
    const top = V(x, y0 + 13, z);
    const foot = (i: number, y: number) => {
      const a = (i / 3) * Math.PI * 2 + 0.3, k = 1 - (y - 0.8) / 12.2;
      return V(x + Math.cos(a) * 1.5 * k, y0 + y, z + Math.sin(a) * 1.5 * k);
    };
    for (let i = 0; i < 3; i++) {
      kit.member(steel, foot(i, 0.8), top, 0.2);
      for (const hy of [4.5, 8.6]) kit.member(steel, foot(i, hy), foot(i + 1, hy), 0.1);
    }
    kit.block(foam, 1.9, 1.3, 1.9, x, y0 + 11.8, z);
    kit.block(steel, 3.2, 0.4, 1.0, x, y0 + 13.4, z);
    kit.block(lamp, 2.9, 0.08, 0.8, x, y0 + 13.17, z);
  }
  kit.build(g);
  return g;
}

/**
 * The power hub, where the umbilical from the ship comes down: a subsea
 * distribution unit on its mudmat under a slatted cover, a lamp mast, and the
 * umbilical itself going up in a lazy wave - off the hub, over a hump held up
 * by buoyancy modules, and away up into the dark.
 */
function buildHub(beacons: BeaconSpec[]): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const { x, z } = HUB;
  const y0 = height(x, z);
  const frame = metal(0x3c4652, 0.6, 0.7), shell = matte(0xd09a30, 0.75), tank = metal(0x6e7c88, 0.45, 0.8);
  kit.block(frame, 16, 0.7, 9, x, y0 + 0.35, z);
  kit.block(frame, 15, 0.5, 8, x, y0 + 0.95, z);
  for (const sx of [-7, 0, 7]) for (const sz of [-3.8, 3.8]) kit.member(frame, V(x + sx, y0 + 1.2, z + sz), V(x + sx, y0 + 5.7, z + sz), 0.35);
  for (const [dx, dz, w, h, d] of [[-4.5, -1.6, 3.2, 3.4, 2.4], [-4.5, 1.8, 3.2, 3.4, 2.4], [1, 0, 4, 2.6, 5.2], [5.2, -1.6, 2.2, 2.2, 2.2]]) {
    kit.block(tank, w, h, d, x + dx, y0 + 1.2 + h / 2, z + dz);
  }
  for (let i = 0; i < 8; i++) kit.block(shell, 1.7, 0.18, 8.4, x - 6.6 + i * 1.9, y0 + 5.9, z);
  kit.member(frame, V(x + 2, y0 + 5.9, z), V(x + 2, y0 + 11.4, z), 0.25);
  kit.block(frame, 2.6, 0.3, 0.9, x + 2, y0 + 11.6, z);
  kit.block(glow(0xfff0d8, 4), 2.4, 0.08, 0.7, x + 2, y0 + 11.42, z);
  kit.build(g);
  beacons.push({ at: V(x + 2, y0 + 12.1, z), colour: 0xffc060, power: 6, size: 0.35, period: 2.2, phase: 0.1, duty: 0.12 });

  // the lazy wave
  const um = new THREE.CatmullRomCurve3([
    V(x + 8, y0 + 1.5, z), V(x + 14, y0 + 3, z + 2), V(x + 24, y0 + 14, z + 5), V(x + 34, y0 + 30, z + 7),
    V(x + 42, y0 + 34, z + 8), V(x + 50, y0 + 30, z + 9), V(x + 58, y0 + 37, z + 10), V(x + 64, y0 + 70, z + 11),
    V(x + 68, y0 + 150, z + 12), V(x + 70, y0 + 270, z + 12),
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(um, 180, 0.28, 8), matte(0x1c1e22, 0.7));
  g.add(cable);
  const buoy = new Kit();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 16; i++) {
    const t = 0.2 + i * 0.011;
    const p = um.getPointAt(t), tan = um.getTangentAt(t);
    q.setFromUnitVectors(V(0, 1, 0), tan);
    buoy.at = new THREE.Matrix4().compose(p, q, V(1, 1, 1));
    buoy.add(shell, new THREE.CylinderGeometry(0.95, 0.95, 1.1, 14));
  }
  buoy.at = null;
  buoy.build(g, false);
  for (let y = 60, i = 0; y < 260; y += 40, i++) {
    const p = um.getPointAt(0.3 + (y / 270) * 0.7);
    beacons.push({ at: p.clone().add(V(0.4, 0, 0)), colour: 0xffc040, power: 5, size: 0.3, period: 3, phase: i * 0.13, duty: 0.1 });
  }
  cable.userData.noCollide = true;
  return g;
}

/** Cables from the hub to the plant, and down the furrow to the light towers, with mattresses over them. */
function buildCables(): THREE.Group {
  const g = new THREE.Group();
  g.userData.noCollide = true;
  const runs: [[number, number], [number, number], number, number, number][] = [
    // from, to, wiggle, colour, seed
    [[HUB.x + 8, HUB.z + 4.2], [-82, -31], 6, 0xd8a520, 1],
    [[HUB.x + 8, HUB.z + 3.2], [-82, -33], 7, 0xc8601a, 2],
    [[HUB.x + 2, HUB.z + 4.6], [-104, -47], 5, 0xd8a520, 3],
    [[38, -12.5], [228, -12.5], 1.2, 0x1c1e22, 4],
  ];
  const paths: THREE.Vector3[][] = [];
  const byColour = new Map<number, THREE.BufferGeometry[]>();
  for (const [a, b, wig, col, seed] of runs) {
    const pts = cablePath(a, b, wig, seed);
    paths.push(pts);
    if (!byColour.has(col)) byColour.set(col, []);
    byColour.get(col)!.push(tubeGeo(pts, 0.13, pts.length * 2));
  }
  for (const [col, list] of byColour) {
    const m = new THREE.Mesh(fuse(...list), matte(col, 0.6));
    m.receiveShadow = true;
    g.add(m);
  }
  // concrete mattresses where the cables come in, blocks on a mesh draped over them
  const spots: [number, number][] = [[0, 0.93], [1, 0.9], [2, 0.88], [3, 0.06], [3, 0.22]];
  const block = new THREE.BoxGeometry(0.62, 0.3, 0.62);
  const mats = new THREE.InstancedMesh(block, matte(0x77726a, 0.95), spots.length * 32);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(1, 1, 1), p = V(0, 0, 0);
  const tint = new THREE.Color();
  const r = rng(19);
  let n = 0;
  for (const [i, t] of spots) {
    const pts = paths[i];
    const k = Math.floor(t * (pts.length - 1));
    const c = pts[k], d = pts[Math.min(k + 1, pts.length - 1)].clone().sub(pts[Math.max(k - 1, 0)]).setY(0).normalize();
    const side = V(-d.z, 0, d.x);
    q.setFromUnitVectors(V(1, 0, 0), d);
    for (let u = 0; u < 8; u++) {
      for (let w = 0; w < 4; w++) {
        const along = (u - 3.5) * 0.7, across = (w - 1.5) * 0.7;
        p.set(c.x + d.x * along + side.x * across, 0, c.z + d.z * along + side.z * across);
        const drape = 0.28 * Math.exp(-((across / 0.8) ** 2));
        p.y = height(p.x, p.z) + 0.1 + drape;
        m4.compose(p, q, s);
        mats.setMatrixAt(n, m4);
        mats.setColorAt(n++, tint.setScalar(0.85 + 0.2 * r()));
      }
    }
  }
  mats.count = n;
  mats.receiveShadow = true;
  g.add(mats);
  return g;
}

/**
 * The first generation, where it stopped: a tracked collector from the trial
 * years, sunk to its idlers at the end of its own tracks, half its panels
 * gone, rusting slowly in water that has almost no oxygen to rust it with,
 * and its umbilical cut and trailing back down the track into the sediment.
 */
function buildWreck(): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const { x, z, a } = WRECK;
  const y0 = height(x, z) - 0.35;
  kit.at = new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeRotationX(0.04)).setPosition(x, y0, z);
  const paint = metal(0xa08038, 0.75, 0.35), rust = metal(0x5a3e2a, 0.85, 0.4), track = matte(0x22201c, 0.9), head = metal(0x4a4640, 0.7, 0.6);
  for (const sz of [-2.1, 2.1]) {
    kit.block(track, 11.5, 1.5, 1.3, 0, 0.75, sz);
    for (let i = -5; i <= 5; i += 1.2) kit.block(rust, 0.22, 0.16, 1.4, i, 1.53, sz);
  }
  kit.block(rust, 11, 0.6, 3.2, 0, 1.6, 0);
  for (const sx of [-4.8, -1.6, 1.6, 4.8]) for (const sz of [-1.5, 1.5]) kit.member(rust, V(sx, 1.9, sz), V(sx, 4.2, sz), 0.22);
  kit.block(rust, 10.2, 0.25, 3.3, 0, 4.3, 0);
  kit.member(rust, V(-4.8, 4.2, 1.5), V(1.6, 1.9, 1.5), 0.14);
  kit.block(paint, 6.2, 2.1, 0.12, -1.5, 3.1, 1.62);
  kit.block(paint, 3.0, 1.2, 3.0, -2.6, 5.0, 0);
  kit.block(paint, 2.4, 1.0, 2.8, 1.2, 4.9, 0.1);
  kit.block(head, 1.8, 1.3, 5.6, 6.4, 0.55, 0);
  for (let i = -2.2; i <= 2.21; i += 0.55) kit.block(rust, 0.3, 0.3, 0.3, 7.4, 0.4, i);
  kit.member(rust, V(-4, 4.3, 0), V(-4.3, 8.4, 0), 0.3);
  kit.block(paint, 0.9, 0.9, 0.9, -4.3, 8.6, 0);
  kit.at = null;
  kit.build(g);
  // the umbilical, cut, back down the track and under
  const dx = Math.cos(a), dz = Math.sin(a);
  const pts: THREE.Vector3[] = [];
  const top = V(x - dx * 4.3, y0 + 8.6, z - dz * 4.3);
  pts.push(top, V(x - dx * 7, y0 + 5, z - dz * 7));
  for (let s = 10; s <= 44; s += 3) {
    const w = Math.sin(s * 0.15) * 1.6;
    const px = x - dx * s - dz * w, pz = z - dz * s + dx * w;
    pts.push(V(px, height(px, pz) + 0.1 - Math.max(0, s - 34) * 0.03, pz));
  }
  const cable = new THREE.Mesh(tubeGeo(pts, 0.16, 80), matte(0x3a3028, 0.8));
  cable.userData.noCollide = true;
  g.add(cable);
  return g;
}

/** A monitoring lander by the old tracks: a tripod, turbidity sensors, floats, a lamp, a strobe. */
function buildLander(beacons: BeaconSpec[]): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const { x, z } = LANDER;
  const y0 = height(x, z);
  const steel = metal(0x8a929a, 0.45, 0.8), foam = matte(0xe0b830, 0.65), sensor = metal(0x2a3038, 0.4, 0.7);
  const ring = y0 + 3.2;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const foot = V(x + Math.cos(a) * 2, y0 + 0.1, z + Math.sin(a) * 2);
    kit.member(steel, foot, V(x + Math.cos(a) * 0.8, ring, z + Math.sin(a) * 0.8), 0.12);
    kit.block(steel, 0.7, 0.1, 0.7, foot.x, y0 + 0.05, foot.z);
    kit.member(sensor, V(x + Math.cos(a + 1) * 0.7, ring - 0.2, z + Math.sin(a + 1) * 0.7), V(x + Math.cos(a + 1) * 0.7, ring - 1.4, z + Math.sin(a + 1) * 0.7), 0.16);
  }
  kit.block(steel, 1.8, 0.2, 1.8, x, ring, z);
  kit.block(sensor, 0.8, 1.1, 0.8, x, ring + 0.65, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    kit.add(foam, new THREE.SphereGeometry(0.42, 12, 8).translate(x + Math.cos(a) * 0.5, ring + 1.55, z + Math.sin(a) * 0.5));
  }
  kit.block(glow(0xe8f4ff, 3.5), 0.5, 0.06, 0.5, x, ring - 0.13, z);
  kit.build(g);
  beacons.push({ at: V(x, ring + 2.15, z), colour: 0xffffff, power: 8, size: 0.25, period: 2.0, phase: 0.4, duty: 0.05 });
  return g;
}

/**
 * Collector 2, working the next block over: the same machine as the plant's,
 * too far off to be more than its lamps, its float and the plume the head
 * kicks up - and its own riser to the ship, a line of red lights going up.
 */
function buildCollector2(beacons: BeaconSpec[]): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const { x, z } = C2;
  const y0 = height(x, z);
  const yel = metal(0xd8a23a, 0.5, 0.45), dark = metal(0x3c4652, 0.5, 0.8), rub = matte(0x1a1f24, 0.9), foam = matte(0xe0b830, 0.7);
  kit.block(yel, 8, 3.4, 13, x, y0 + 2.6, z);
  for (const sx of [-4.6, 4.6]) kit.block(rub, 1.8, 1.8, 14, x + sx, y0 + 0.9, z);
  kit.block(dark, 11, 1.4, 2.4, x, y0 + 0.8, z + 7.8);
  kit.block(foam, 6, 1.4, 9, x, y0 + 5, z - 1);
  for (const sx of [-3.2, 3.2]) kit.block(glow(0xfff0c8, 5), 1.0, 0.5, 0.3, x + sx, y0 + 3.6, z + 6.7);
  kit.build(g);
  const rx = x + 12, rz = z - 10;
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 262, 12), matte(0x2a2f36, 0.7));
  riser.position.set(rx, y0 + 131, rz);
  riser.userData.noCollide = true;
  g.add(riser);
  const buoys = new Kit();
  for (let y = 18; y < 260; y += 72) buoys.block(foam, 3.4, 3.4, 3.4, rx, y0 + y, rz);
  buoys.add(dark, new THREE.CylinderGeometry(1.2, 1.2, 5, 12).translate(rx, y0 + 2.5, rz));
  buoys.build(g, false);
  const hose = new THREE.Mesh(tubeGeo([V(x, y0 + 4.5, z - 6), V(x + 6, y0 + 13, z - 9), V(rx - 1, y0 + 6, rz)], 0.45, 24, 8), matte(0x2a3036, 0.8));
  hose.userData.noCollide = true;
  g.add(hose);
  for (let y = 18, i = 0; y < 260; y += 24, i++) {
    beacons.push({ at: V(rx + 0.9, y0 + y, rz), colour: 0x9fe0ff, power: 6, size: 0.4, period: 2.6, phase: -i * 0.07, duty: 0.22 });
  }
  return g;
}

/** Moorings - a line from an anchor to floats a couple of hundred metres up - and transponders on the bottom. */
function buildMoorings(beacons: BeaconSpec[]): THREE.Group {
  const g = new THREE.Group();
  g.userData.noCollide = true;
  const kit = new Kit();
  const conc = matte(0x5e5a52, 0.95), line = matte(0x2a2a2a, 0.8), orange = matte(0xe0701a, 0.6), yellow = matte(0xe0b830, 0.6);
  const steel = metal(0x8a929a, 0.45, 0.8);
  const r = rng(61);
  for (const [x, z] of MOORINGS) {
    const y0 = height(x, z);
    kit.block(conc, 2.4, 1.0, 2.4, x, y0 + 0.5, z);
    kit.member(line, V(x, y0 + 1, z), V(x, y0 + 190, z), 0.06);
    for (let y = 20, i = 0; y <= 190; y += 24, i++) {
      kit.add(i % 2 ? yellow : orange, new THREE.SphereGeometry(0.7, 12, 8).translate(x, y0 + y, z));
    }
    beacons.push({ at: V(x, y0 + 191.2, z), colour: 0xffd070, power: 14, size: 0.5, period: 3.1, phase: r(), duty: 0.08 });
  }
  for (const [x, z] of TRANSPONDERS) {
    const y0 = height(x, z);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.member(steel, V(x + Math.cos(a) * 0.8, y0, z + Math.sin(a) * 0.8), V(x, y0 + 1.4, z), 0.07);
    }
    kit.add(yellow, new THREE.SphereGeometry(0.4, 12, 8).translate(x, y0 + 1.8, z));
    beacons.push({ at: V(x, y0 + 2.3, z), colour: 0x40e0ff, power: 10, size: 0.3, period: 4 + r() * 2, phase: r(), duty: 0.06 });
  }
  kit.build(g, false);
  return g;
}

/** The laydown by the pad's north-west corner: spare pipe spools, an ROV tool basket, a spreader bar. */
function buildLaydown(): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const conc = matte(0x6e6a60, 0.95), pipe = metal(0x5a6470, 0.55, 0.8), cage = metal(0xc8a030, 0.55, 0.5), beam = metal(0x3c4652, 0.6, 0.7);
  const x0 = -93, z0 = 50, y0 = G0;
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 12, 14);
    geo.rotateZ(Math.PI / 2);
    geo.translate(x0, y0 + 0.82 + (i === 2 ? 0.8 : 0), z0 - 1 + i * 0.9 + (i === 2 ? -0.45 : 0));
    kit.add(pipe, geo);
  }
  for (const dx of [-4.5, 4.5]) kit.block(conc, 0.8, 0.4, 3.2, x0 + dx, y0 + 0.2, z0);
  // the basket
  const bx = x0 + 3, bz = z0 + 7;
  for (const [sx, sz] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) kit.member(cage, V(bx + sx, y0, bz + sz), V(bx + sx, y0 + 1.4, bz + sz), 0.1);
  for (const sy of [0.05, 1.4]) {
    kit.member(cage, V(bx - 1.5, y0 + sy, bz - 1), V(bx + 1.5, y0 + sy, bz - 1), 0.08);
    kit.member(cage, V(bx - 1.5, y0 + sy, bz + 1), V(bx + 1.5, y0 + sy, bz + 1), 0.08);
    kit.member(cage, V(bx - 1.5, y0 + sy, bz - 1), V(bx - 1.5, y0 + sy, bz + 1), 0.08);
    kit.member(cage, V(bx + 1.5, y0 + sy, bz - 1), V(bx + 1.5, y0 + sy, bz + 1), 0.08);
  }
  kit.block(beam, 2.9, 0.08, 1.9, bx, y0 + 0.08, bz);
  kit.block(pipe, 0.9, 0.6, 0.7, bx - 0.6, y0 + 0.4, bz + 0.2);
  // the spreader bar, set down where the last lift left it
  kit.block(beam, 8, 0.5, 0.5, x0 - 2, y0 + 0.25, z0 + 11);
  kit.build(g);
  return g;
}

/**
 * A whale fall: a great whale that died at the surface and took a month to
 * sink here, picked down to the bone by everything the plain has. The skull
 * and the long jaws at one end, the spine going off with the ribs fallen out
 * either side of it, and round it the ground stained dark, and white with
 * bacteria. Rattails come to it.
 */
function buildWhale(): THREE.Group {
  const g = new THREE.Group();
  const kit = new Kit();
  const bone = matte(0xcdc4ae, 0.85);
  const { x, z, a } = WHALE;
  const dx = Math.cos(a), dz = Math.sin(a);
  const at = (s: number, o: number, y: number) => {
    const px = x + dx * s - dz * o, pz = z + dz * s + dx * o;
    return V(px, height(px, pz) + y, pz);
  };
  const rot = new THREE.Matrix4().makeRotationY(-a);
  const put = (geo: THREE.BufferGeometry, p: THREE.Vector3, extra?: THREE.Matrix4) => {
    if (extra) geo.applyMatrix4(extra);
    geo.applyMatrix4(rot);
    geo.translate(p.x, p.y, p.z);
    kit.add(bone, geo);
  };
  // the skull: the cranium, and the rostrum long and flat in front of it
  put(new THREE.SphereGeometry(1.3, 14, 8).scale(1.1, 0.42, 1.15), at(7.6, 0, 0.3));
  const rostrum = new THREE.CylinderGeometry(0.35, 1.1, 4.4, 6);
  rostrum.rotateZ(-Math.PI / 2);
  rostrum.scale(1, 0.38, 1);
  put(rostrum, at(10.8, 0, 0.2));
  // the jaws, bowed, fallen apart
  for (const sd of [-1, 1]) {
    kit.add(bone, tubeGeo([at(12.6, sd * 0.5, 0.15), at(10, sd * 2.4, 0.2), at(6.6, sd * 2.6, 0.14)], 0.17, 20));
  }
  // the spine, sagging and bending as it went down
  for (let i = 0; i < 38; i++) {
    const s = 6.1 - i * 0.36, o = 0.7 * Math.sin(i * 0.09), rr = 0.34 * (1 - i / 46);
    const p = at(s, o, rr * 0.7);
    const c = new THREE.CylinderGeometry(rr, rr, 0.26, 8);
    c.rotateZ(Math.PI / 2);
    put(c, p);
    if (i < 26) {
      put(new THREE.BoxGeometry(0.08, rr * 2.6, 0.22), p.clone().add(V(0, rr * 1.3, 0)));
      put(new THREE.BoxGeometry(0.1, 0.07, rr * 3.4), p.clone());
    }
  }
  // ribs, fallen outward; one or two still arched
  const r = rng(5);
  for (let i = 0; i < 13; i++) {
    const s = 5.6 - i * 0.42;
    for (const sd of [-1, 1]) {
      if (r() < 0.12) continue;
      const fall = r() < 0.15 ? 0.1 : 0.6 + 0.4 * r();
      const len = (2.2 + 1.2 * Math.sin((i / 12) * Math.PI)) * (r() < 0.2 ? 0.6 : 1);
      const base = at(s, 0.7 * Math.sin(i * 0.09 * 2.8) + sd * 0.35, 0.4);
      kit.add(bone, tubeGeo([
        base, at(s - 0.25, sd * len * 0.45, 0.9 * (1 - fall) + 0.2), at(s - 0.55, sd * len, 0.06 + 0.5 * (1 - fall)),
      ], 0.07, 12, 5));
    }
  }
  // flipper bones
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 4; k++) kit.add(bone, tubeGeo([at(4.8 - k * 0.2, sd * (2.9 + k * 0.3), 0.08), at(4.2 - k * 0.3, sd * (3.9 + k * 0.4), 0.06)], 0.06, 4, 5));
  }
  kit.build(g);
  return g;
}

// -------------------------------------------------------------- lights

interface BeaconSpec { at: THREE.Vector3; colour: number; power: number; size: number; period: number; phase: number; duty: number }

/** Strobes and small lamps out in the dark, as points: one draw for all of them. */
function beaconPoints(list: BeaconSpec[]): THREE.Points {
  const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3), blink = new Float32Array(list.length * 4);
  list.forEach((b, i) => {
    pos.set([b.at.x, b.at.y, b.at.z], i * 3);
    const c = lin(b.colour, b.power);
    col.set([c.r, c.g, c.b], i * 3);
    blink.set([b.size, b.period, b.phase, b.duty], i * 4);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aBlink', new THREE.BufferAttribute(blink, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1000 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      const vec3 SEA_EXT = ${v3(EXT)};
      uniform float uTime; uniform float uPx;
      attribute vec3 aCol; attribute vec4 aBlink;
      varying vec3 vCol;
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        float on = aBlink.y > 0.0 ? step(fract(uTime / aBlink.y + aBlink.z), aBlink.w) : 1.0;
        vCol = aCol * mix(0.03, 1.0, on) * exp(-SEA_EXT * dist);
        gl_PointSize = clamp(aBlink.x * uPx / max(dist, 1.0), 2.0, 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vCol * (smoothstep(0.4, 0.0, r) + 0.3 * pow(max(1.0 - r, 0.0), 3.0)), 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.noCollide = true;
  return pts;
}

/**
 * Marine snow: what is left of everything that lived and died above, falling
 * for weeks to get here. It is only seen where there is light, so each flake
 * is lit by the lamps and the eye's own lamp and dimmed by the water between;
 * and one in a hundred or so flashes blue, being alive. Drifts on the current
 * and wraps round its box - the site's, or one that follows the camera, for
 * the flakes right in front of the lens.
 */
function snow(count: number, min: THREE.Vector3, size: THREE.Vector3, follow: boolean, flake: number, seed: number): THREE.Points {
  const r = rng(seed);
  const pos = new Float32Array(count * 3), seedA = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([r(), r(), r()], i * 3);
    seedA[i] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uPx: { value: 1000 },
      uMin: { value: min }, uSize: { value: size }, uFollow: { value: follow ? 1 : 0 }, uFlake: { value: flake },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${SEA_GLSL}
      const vec3 SEA_HEAD = ${v3(HEAD)};
      uniform float uTime; uniform float uPx; uniform vec3 uMin; uniform vec3 uSize; uniform float uFollow; uniform float uFlake;
      attribute float aSeed;
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec3 drift = vec3(0.12, -0.26, 0.05) * uTime
          + 0.35 * vec3(sin(uTime * 0.37 + aSeed * 17.0), 0.5 * sin(uTime * 0.23 + aSeed * 29.0), cos(uTime * 0.31 + aSeed * 11.0));
        vec3 origin = mix(uMin, cameraPosition - 0.5 * uSize, uFollow);
        vec3 p = origin + mod(position * uSize + drift - origin, uSize);
        vec3 lit = vec3(0.0);
        for (int i = 0; i < SEA_N; i++) {
          vec3 d = p - SEA_LP[i].xyz;
          float dd = dot(d, d);
          float cone = mix(1.0, smoothstep(-0.2, 0.6, -d.y * inversesqrt(dd + 1e-3)), SEA_LP[i].w);
          lit += SEA_LC[i] * cone * 40.0 / (1.0 + dd * 0.012) * exp(-SEA_EXT * sqrt(dd));
        }
        vec3 hv = p - cameraPosition;
        float hd = length(hv) + 1e-3;
        vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        float inRoom = step(length(cameraPosition.xz - vec2(-14.0, 51.4)), 9.5) * step(cameraPosition.y, 9.0);
        lit += SEA_HEAD * 0.05 * smoothstep(0.8, 0.95, dot(hv / hd, fwd)) / (1.0 + hd * hd * 0.3) * (1.0 - inRoom);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vCol = lit * exp(-SEA_EXT * dist);
        float flash = pow(max(sin(uTime * 0.9 + aSeed * 610.0), 0.0), 80.0) * step(0.988, fract(aSeed * 137.0));
        vCol += vec3(0.1, 0.45, 1.0) * flash * 1.5 * exp(-SEA_EXT * dist * 0.5);
        vA = smoothstep(0.4, 1.5, dist) * step(-0.35, p.y);
        gl_PointSize = clamp(uFlake * uPx / max(dist, 0.5), 1.0, 10.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        gl_FragColor = vec4(vCol * smoothstep(0.25, 0.0, dot(q, q)) * vA, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.noCollide = true;
  return pts;
}

/** The sediment the far collector's head throws up, drifting away on the current, lit by its own lamps. */
function plume(): THREE.Points {
  const n = 180;
  const r = rng(47);
  const y0 = height(C2.x, C2.z);
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos.set([C2.x + (r() - 0.5) * 10, y0 + 0.8, C2.z + 9 + (r() - 0.5) * 2], i * 3);
    seed.set([r() - 0.5, r() - 0.5, r(), 0.7 + 0.6 * r()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const lamp = LAMPS.find((l) => Math.abs(l.at.x - C2.x) < 1)!;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1000 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      const vec3 SEA_EXT = ${v3(EXT)};
      const vec3 LAMP = vec3(${f4(lamp.at.x)}, ${f4(lamp.at.y)}, ${f4(lamp.at.z)});
      uniform float uTime; uniform float uPx;
      attribute vec4 aSeed;
      varying vec3 vCol;
      varying float vA;
      void main() {
        float life = 50.0;
        float age = mod(uTime + aSeed.z * life, life);
        float k = age / life;
        vec3 p = position + vec3(aSeed.x * 6.0 * k + 0.5 * age, 5.0 * k + 1.2 * sin(age * 0.1 + aSeed.z * 6.3), aSeed.y * 8.0 * k + 0.1 * age);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        vec3 dl = p - LAMP;
        vCol = vec3(1.0, 0.9, 0.72) * 0.9 / (1.0 + dot(dl, dl) * 0.003) * exp(-SEA_EXT * dist);
        vA = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.5, 1.0, k));
        gl_PointSize = clamp((3.0 + 12.0 * k) * aSeed.w * uPx / max(dist, 1.0), 1.0, 300.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        gl_FragColor = vec4(vCol * smoothstep(0.25, 0.0, dot(q, q)) * vA * 0.035, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.noCollide = true;
  return pts;
}

// ------------------------------------------------------------ the life

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** A sea cucumber: a soft lumpy body, and - on the ones that have it - a sail at the back. */
function holothurianGeo() {
  const body = new THREE.CapsuleGeometry(0.07, 0.34, 3, 8);
  body.rotateZ(Math.PI / 2);
  body.scale(1, 0.62, 0.9);
  body.translate(0, 0.045, 0);
  const sail = new THREE.ConeGeometry(0.06, 0.16, 6);
  sail.scale(0.35, 1, 1);
  sail.rotateZ(0.5);
  sail.translate(-0.13, 0.13, 0);
  return fuse(body, sail);
}

/** A brittle star: a small disc and five thin arms, each with a bend in it. */
function brittleStarGeo() {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.035, 0.035, 0.018, 10).translate(0, 0.009, 0)];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const inner = new THREE.BoxGeometry(0.12, 0.012, 0.016).translate(0.09, 0.006, 0);
    const outer = new THREE.BoxGeometry(0.12, 0.01, 0.012).translate(0.06, 0.005, 0).rotateY(0.5).translate(0.15, 0, 0);
    parts.push(inner.rotateY(a), outer.rotateY(a));
  }
  return fuse(...parts);
}

/** A xenophyophore: one cell the size of a fist, a fragile lumpy mound of sediment it has glued together. */
function xenoGeo() {
  const g = mergeVerts(new THREE.IcosahedronGeometry(0.1, 1));
  const p = g.getAttribute('position');
  const nz = perlin(77);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.35 * nz(x * 18 + 3, z * 18 + y * 9);
    p.setXYZ(i, x * k, Math.max(y, -0.02) * k * 0.8 + 0.02, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A glass sponge on a long glass stalk (Hyalonema), rooted in the sediment. */
function stalkedSpongeGeo() {
  const stalk = new THREE.CylinderGeometry(0.006, 0.01, 0.45, 5).translate(0, 0.225, 0);
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0.012, 0), new THREE.Vector2(0.05, 0.03), new THREE.Vector2(0.075, 0.1),
    new THREE.Vector2(0.06, 0.16), new THREE.Vector2(0.03, 0.18),
  ], 10).translate(0, 0.42, 0);
  return fuse(stalk, body);
}

/** A vase sponge, open at the top. */
function vaseSpongeGeo() {
  return new THREE.LatheGeometry([
    new THREE.Vector2(0.04, 0), new THREE.Vector2(0.11, 0.08), new THREE.Vector2(0.16, 0.32),
    new THREE.Vector2(0.14, 0.52), new THREE.Vector2(0.165, 0.6), new THREE.Vector2(0.15, 0.6),
    new THREE.Vector2(0.125, 0.52), new THREE.Vector2(0.13, 0.32),
  ], 14);
}

/** A stalked crinoid: a sea lily, its arms held up into the current. */
function crinoidGeo() {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.008, 0.012, 0.5, 5).translate(0, 0.25, 0)];
  for (let k = 0; k < 10; k++) {
    const arm = new THREE.BoxGeometry(0.008, 0.16, 0.012).translate(0, 0.08, 0);
    arm.rotateZ(0.55).rotateY((k / 10) * Math.PI * 2).translate(0, 0.5, 0);
    parts.push(arm);
  }
  return fuse(...parts);
}

/** A bamboo coral on a nodule: a thin stalk with a few side branches. */
function coralGeo() {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.006, 0.012, 0.6, 5).translate(0, 0.3, 0)];
  for (let k = 0; k < 7; k++) {
    const b = new THREE.CylinderGeometry(0.003, 0.005, 0.16, 4).translate(0, 0.08, 0);
    b.rotateZ(0.9).rotateY(k * 2.4).translate(0, 0.14 + k * 0.06, 0);
    parts.push(b);
  }
  return fuse(...parts);
}

/** A grenadier - a rattail: a big head, a body that tapers to nothing. */
function rattailGeo() {
  const head = new THREE.SphereGeometry(0.1, 10, 8);
  head.scale(1.3, 1, 0.85);
  head.translate(0.12, 0, 0);
  const body = new THREE.ConeGeometry(0.085, 0.62, 8);
  body.rotateZ(Math.PI / 2);
  body.translate(-0.22, 0, 0);
  const fin = new THREE.BoxGeometry(0.12, 0.09, 0.01).translate(0.02, 0.1, 0);
  const snout = new THREE.ConeGeometry(0.04, 0.09, 6);
  snout.rotateZ(-Math.PI / 2);
  snout.translate(0.27, -0.01, 0);
  return fuse(head, body, fin, snout);
}

/** A cusk eel: long, pale, soft. */
function cuskGeo() {
  const b = new THREE.CapsuleGeometry(0.05, 0.8, 3, 8);
  b.rotateZ(Math.PI / 2);
  b.scale(1, 1, 0.7);
  const tail = new THREE.ConeGeometry(0.05, 0.3, 6);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-0.58, 0, 0);
  return fuse(b, tail);
}

interface Species {
  geo: THREE.BufferGeometry; n: number; scale: [number, number]; colours: number[];
  rough: number; lean: number; sink: number;
}

/**
 * What lives on the plain, where the collectors have not been: a few of each
 * thing a camera on the CCZ actually finds, thickest in the lit ground round
 * the site (so they are seen), thinner out in the dark (so they are found).
 * The mined lanes have nothing.
 */
function buildBenthos(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(83);
  const pick = (): [number, number] => {
    for (;;) {
      const x = -300 + r() * 640, z = -260 + r() * 520;
      if (rrect(x, z, -22, 12, 62, 52, 6) < 2 || minedAt(x, z, 1.5)) continue;
      const d = siteDistance(x, z);
      const w = d < 70 ? 1 : d < 180 ? 0.4 : 0.15;
      if (r() < w) return [x, z];
    }
  };
  const list: Species[] = [
    { geo: holothurianGeo(), n: 110, scale: [0.8, 1.6], colours: [0xe0b070, 0xd89aa0, 0x8a4a78, 0xe8d8c8], rough: 0.5, lean: 0.05, sink: 0.01 },
    { geo: brittleStarGeo(), n: 220, scale: [0.7, 1.5], colours: [0xd8d2c8, 0xc8b8a8, 0xe8e0d8], rough: 0.7, lean: 0.08, sink: 0 },
    { geo: xenoGeo(), n: 180, scale: [0.6, 2.2], colours: [0xb0a288, 0xa09478, 0xc0b49c], rough: 0.95, lean: 0.1, sink: 0.02 },
    { geo: stalkedSpongeGeo(), n: 60, scale: [0.8, 1.5], colours: [0xe8f0f0, 0xd8e4e4], rough: 0.4, lean: 0.12, sink: 0.03 },
    { geo: vaseSpongeGeo(), n: 30, scale: [0.8, 1.6], colours: [0xe0dcc8, 0xd0ccb8], rough: 0.6, lean: 0.06, sink: 0.04 },
    { geo: crinoidGeo(), n: 25, scale: [0.9, 1.4], colours: [0xd8c0a0, 0xe8d0b0], rough: 0.6, lean: 0.1, sink: 0.02 },
    { geo: coralGeo(), n: 40, scale: [0.8, 1.6], colours: [0xf0e8e0, 0xe8d8d0], rough: 0.5, lean: 0.1, sink: 0 },
  ];
  const c = new THREE.Color();
  for (const sp of list) {
    const mat = new THREE.MeshStandardMaterial({ roughness: sp.rough, metalness: 0 });
    noSilt(mat);
    const mesh = new THREE.InstancedMesh(sp.geo, mat, sp.n);
    for (let i = 0; i < sp.n; i++) {
      const [x, z] = pick();
      const s = sp.scale[0] + (sp.scale[1] - sp.scale[0]) * r();
      _q.setFromEuler(_e.set((r() - 0.5) * sp.lean, r() * Math.PI * 2, (r() - 0.5) * sp.lean));
      _m.compose(_p.set(x, height(x, z) - sp.sink, z), _q, _s.setScalar(s));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, c.setHex(sp.colours[Math.floor(r() * sp.colours.length)]).multiplyScalar(0.85 + 0.3 * r()));
    }
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  // and what has settled on the wreck: sponges and sea lilies up on its frame
  const colonists = new THREE.InstancedMesh(stalkedSpongeGeo(), new THREE.MeshStandardMaterial({ color: 0xe8f0f0, roughness: 0.4 }), 26);
  noSilt(colonists.material as THREE.Material);
  const dx = Math.cos(WRECK.a), dz = Math.sin(WRECK.a);
  const yTop = height(WRECK.x, WRECK.z) - 0.35 + 4.45;
  for (let i = 0; i < 26; i++) {
    const s = (r() - 0.5) * 9.6, o = (r() - 0.5) * 3;
    _q.setFromEuler(_e.set((r() - 0.5) * 0.3, r() * 6.3, (r() - 0.5) * 0.3));
    _m.compose(_p.set(WRECK.x + dx * s - dz * o, yTop, WRECK.z + dz * s + dx * o), _q, _s.setScalar(0.9 + 0.8 * r()));
    colonists.setMatrixAt(i, _m);
  }
  g.add(colonists);
  g.userData.noCollide = true;
  return g;
}

interface Swimmer { mesh: THREE.InstancedMesh; paths: Path[] }
interface Path { cx: number; cz: number; rx: number; rz: number; y: number; speed: number; phase: number; size: number }

const loop = (cx: number, cz: number, rx: number, rz: number, y: number, speed: number, size = 1): Path =>
  ({ cx, cz, rx, rz, y: height(cx, cz) + y, speed, phase: 0, size });

/**
 * What swims: rattails, head down over the bottom the way they hunt, round
 * the lit ground and the whale; a few cusk eels. No schools - nothing down
 * here can afford to live in a crowd.
 */
function buildSwimmers(): Swimmer[] {
  const r = rng(101);
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a7e72, roughness: 0.45, metalness: 0.2 });
  const eel = new THREE.MeshStandardMaterial({ color: 0xe0cfc4, roughness: 0.5 });
  noSilt(tail); noSilt(eel);
  const rat: Path[] = [
    loop(-14, 34, 11, 3, 4.2, 0.11, 1.2),    // past the control room window
    loop(-50, -82, 9, 6, 1.1, 0.09, 1.3),    // at the whale
    loop(-48, -80, 6, 9, 1.6, -0.12, 1.1),
    loop(-40, -55, 14, 8, 1.8, 0.07, 1.2),
    loop(110, 22, 18, 5, 1.5, 0.06, 1.3),
    loop(190, -30, 12, 8, 1.2, -0.08, 1.1),
    loop(-165, 48, 10, 10, 1.5, 0.08, 1.2),
    loop(42, 70, 10, 12, 2.0, -0.07, 1.4),
    loop(200, 124, 9, 7, 1.5, 0.08, 1.2),
    loop(-92, -60, 12, 7, 1.4, 0.06, 1.3),
  ];
  const cusk: Path[] = [loop(-62, 62, 16, 10, 0.8, 0.05, 1.1), loop(60, -62, 12, 14, 0.9, -0.05, 1.2), loop(-190, -92, 14, 9, 0.8, 0.04, 1.2)];
  for (const p of [...rat, ...cusk]) p.phase = r() * 6.3;
  const make = (geo: THREE.BufferGeometry, mat: THREE.Material, paths: Path[]): Swimmer => {
    const mesh = new THREE.InstancedMesh(geo, mat, paths.length);
    mesh.frustumCulled = false;
    mesh.userData.noCollide = true;
    return { mesh, paths };
  };
  return [make(rattailGeo(), tail, rat), make(cuskGeo(), eel, cusk)];
}

function swim(sw: Swimmer, time: number, pitch: number) {
  sw.paths.forEach((p, i) => {
    const a = p.phase + time * p.speed;
    const dir = Math.sign(p.speed);
    _p.set(p.cx + Math.cos(a) * p.rx, p.y + Math.sin(time * 0.3 + i) * 0.25, p.cz + Math.sin(a) * p.rz);
    const hx = -Math.sin(a) * p.rx * dir, hz = Math.cos(a) * p.rz * dir;
    _e.set(0, Math.atan2(-hz, hx) + Math.sin(time * 2.2 + i) * 0.1, pitch, 'YZX');
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s.setScalar(p.size));
    sw.mesh.setMatrixAt(i, _m);
  });
  sw.mesh.instanceMatrix.needsUpdate = true;
}

interface Drifter { g: THREE.Group; home: THREE.Vector3; ph: number; pulse: number; flash?: THREE.MeshStandardMaterial; fins?: THREE.Object3D[] }

/**
 * Dumbo octopuses, flapping their ear fins; deep-red jellies (the ones that
 * do not show at this depth - red is the first colour the water takes);
 * and Atolla, whose ring flashes blue when something touches it.
 */
function buildDrifters(root: THREE.Group): Drifter[] {
  const out: Drifter[] = [];
  const add = (g: THREE.Group, home: THREE.Vector3, extra: Partial<Drifter> = {}) => {
    g.position.copy(home);
    g.userData.noCollide = true;
    g.traverse((o) => {
      o.userData.noCollide = true;
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) noSilt(m);
    });
    root.add(g);
    out.push({ g, home, ph: out.length * 1.7, pulse: 0.6, ...extra });
  };
  // dumbos
  for (const home of [V(-20, 5.5, 62), V(135, 4, 30)]) {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2c4b0, roughness: 0.55, emissive: 0x3a1a14, emissiveIntensity: 0.2 });
    noSilt(skin);
    const mantle = new THREE.SphereGeometry(0.16, 14, 10);
    mantle.scale(1, 1.25, 1);
    mantle.translate(0, 0.12, 0);
    const web = new THREE.ConeGeometry(0.3, 0.22, 16, 1, true).translate(0, -0.06, 0);
    const body = new THREE.Mesh(fuse(mantle, web), skin);
    g.add(body);
    const fins: THREE.Object3D[] = [];
    for (const sd of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sd * 0.14, 0.22, 0);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6).scale(1, 0.25, 0.6).translate(sd * 0.09, 0, 0), skin);
      pivot.add(fin);
      g.add(pivot);
      fins.push(pivot);
    }
    g.scale.setScalar(1.4);
    add(g, home, { fins, pulse: 0.8 });
  }
  // Periphylla
  for (const home of [V(-70, 14, -30), V(60, 18, 40), V(-150, 12, -60)]) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x5a0f1c, roughness: 0.3, transparent: true, opacity: 0.8, emissive: 0x200408, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 16, 1, true), m));
    const pts: number[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      pts.push(Math.cos(a) * 0.19, -0.21, Math.sin(a) * 0.19, Math.cos(a) * 0.25, -0.7, Math.sin(a) * 0.25);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x7a2a3a, transparent: true, opacity: 0.5 })));
    g.scale.setScalar(1.5);
    add(g, home, { pulse: 0.5 });
  }
  // Atolla
  for (const home of [V(-30, 9, 20), V(20, 12, -40), V(-110, 10, 30)]) {
    const g = new THREE.Group();
    const bell = new THREE.SphereGeometry(0.22, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
    bell.scale(1, 0.55, 1);
    g.add(new THREE.Mesh(bell, new THREE.MeshStandardMaterial({ color: 0x8a1414, roughness: 0.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide })));
    const flash = glowUnique(0x3a7aff, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.014, 6, 28), flash);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    g.scale.setScalar(1.8);
    add(g, home, { flash, pulse: 0.9 });
  }
  return out;
}

/** A siphonophore: a colony strung out along a stem ten metres long, bells glowing faintly, drifting. */
interface Chain { mesh: THREE.InstancedMesh; stem: THREE.Line; home: THREE.Vector3; dir: THREE.Vector3; ph: number }

function buildChains(root: THREE.Group): Chain[] {
  const out: Chain[] = [];
  const N = 36;
  for (const [home, dir] of [[V(-140, 16, -40), V(1, 0.1, 0.3)], [V(150, 12, 44), V(-0.6, 0.05, 1)]] as const) {
    const m = new THREE.MeshStandardMaterial({ color: 0x9fc8e0, roughness: 0.2, transparent: true, opacity: 0.7, emissive: 0x3a8ad8, emissiveIntensity: 0.5 });
    noSilt(m);
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), m, N);
    mesh.frustumCulled = false;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const stem = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0x9fc8e0, transparent: true, opacity: 0.25 }));
    stem.frustumCulled = false;
    mesh.userData.noCollide = stem.userData.noCollide = true;
    root.add(mesh, stem);
    out.push({ mesh, stem, home, dir: dir.clone().normalize(), ph: out.length * 2.1 });
  }
  return out;
}

function driftChain(c: Chain, time: number) {
  const pos = c.stem.geometry.getAttribute('position') as THREE.BufferAttribute;
  const side = V(-c.dir.z, 0, c.dir.x);
  const n = pos.count;
  for (let i = 0; i < n; i++) {
    const s = i * 0.4;
    const w = Math.sin(s * 0.5 - time * 0.4 + c.ph) * 0.8;
    _p.copy(c.home).addScaledVector(c.dir, s + Math.sin(time * 0.02 + c.ph) * 6).addScaledVector(side, w);
    _p.y += Math.sin(s * 0.3 + time * 0.25) * 0.4;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
    _m.compose(_p, _q.identity(), _s.setScalar(i === 0 ? 2.2 : 0.8 + 0.4 * Math.sin(i * 1.7)));
    c.mesh.setMatrixAt(i, _m);
  }
  pos.needsUpdate = true;
  c.mesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------ assembly

/**
 * Lay the abyssal plain round the plant. The stage has already had Nereid's
 * look applied over with NEREID_LOOK.
 */
export function buildSeafloor(root: THREE.Group, stage: Stage): Dressing {
  deepWater();
  // What keeps its own colour: anything liquid, anything lit, glass, and the
  // furrow - the colour of the paste in it is the strength it is reaching.
  root.traverse((o) => {
    // the pad's survey grid is wider than the pad, and would lie across the sediment
    if (o.type === 'GridHelper') o.visible = false;
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const s = mat as THREE.MeshStandardMaterial;
      const lit = !!s.emissive && !!s.color && s.color.getHex() === 0 && s.emissiveIntensity > 0;
      if (mat.userData.fluid || o.userData.unitId === 'stope' || mat.transparent || lit) noSilt(mat);
    }
  });
  stage.hideDome();
  // the rig: floodlights on the masts and gantries, from high over the plant
  stage.aimSun(V(0.22, 1, 0.3));
  const sea = new THREE.Group();
  sea.name = 'seafloor';
  root.add(sea);

  const water = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), waterMaterial(false));
  water.frustumCulled = false;
  // drawn after the solid things, so it only shades the water that shows (see earth.ts)
  water.renderOrder = 1000;
  water.userData.noCollide = true;
  sea.add(water);

  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), waterMaterial(true));
  envSky.frustumCulled = false;
  envScene.add(envSky);
  stage.environmentFrom(envScene);
  envSky.geometry.dispose();
  (envSky.material as THREE.Material).dispose();

  const beacons: BeaconSpec[] = [];
  sea.add(buildSeabed(), buildTowers(), buildCables(), buildWreck(), buildLander(beacons), buildLaydown(), buildWhale());
  sea.add(buildHub(beacons), buildCollector2(beacons), buildMoorings(beacons), buildBenthos());
  const lights = beaconPoints(beacons);
  const cloud = plume();
  const flakes = snow(9000, V(-190, -0.4, -140), V(500, 70, 280), false, 0.035, 11);
  const lens = snow(2600, V(0, 0, 0), V(36, 24, 36), true, 0.02, 12);
  sea.add(lights, cloud, flakes, lens);

  const swimmers = buildSwimmers();
  for (const s of swimmers) sea.add(s.mesh);
  const drifters = buildDrifters(sea);
  const chains = buildChains(sea);

  const timed = [water, lights, cloud, flakes, lens].map((o) => (o.material as THREE.ShaderMaterial).uniforms);
  const sized = [lights, cloud, flakes, lens].map((o) => (o.material as THREE.ShaderMaterial).uniforms.uPx);
  return {
    update(_t: Telemetry, _dt: number, now: number) {
      for (const u of timed) u.uTime.value = now;
      // metres to pixels, for anything drawn as points
      const px = stage.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov) / 2));
      for (const u of sized) u.value = px;
      swim(swimmers[0], now, -0.35);
      swim(swimmers[1], now, -0.05);
      for (const d of drifters) {
        const p = (now * d.pulse + d.ph) % (Math.PI * 2);
        const push = Math.max(0, Math.sin(p));
        d.g.position.set(
          d.home.x + Math.sin(now * 0.04 + d.ph) * 5,
          d.home.y + Math.sin(now * 0.2 + d.ph) * 1.2,
          d.home.z + Math.cos(now * 0.03 + d.ph) * 4,
        );
        if (d.fins) {
          d.fins.forEach((f, i) => { f.rotation.z = (i ? -1 : 1) * (0.2 + 0.6 * Math.sin(now * 3 + d.ph)); });
          d.g.rotation.y = now * 0.1 + d.ph;
        } else {
          d.g.scale.y = d.g.scale.x * (1 - push * 0.15);
        }
        if (d.flash) d.flash.emissiveIntensity = 4 * Math.pow(Math.max(0, Math.sin(now * 0.5 + d.ph * 3)), 30) * (0.6 + 0.4 * Math.sin(now * 20));
      }
      for (const c of chains) driftChain(c, now);
    },
  };
}
