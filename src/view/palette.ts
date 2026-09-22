import * as THREE from 'three';

/**
 * One palette for the whole build so the plant reads as a single machine.
 * Structure is cold and desaturated; everything that carries process material
 * is warm and emissive, so you can read the flowsheet at a glance.
 */
export const C = {
  void: 0x070a10,
  fog: 0x0b111b,

  rock: 0x2b313c,
  rockLit: 0x3d4653,
  deck: 0x2e3642,
  deckDark: 0x222933,
  steel: 0x3c4655,
  steelLight: 0x5a6779,
  steelDark: 0x262d38,
  rubber: 0x14181f,

  cyan: 0x35e0d0,
  amber: 0xffab3d,
  lime: 0x9fe870,
  magenta: 0xff5fa2,
  red: 0xff5a3c,

  // process materials
  tails: 0x6e6455,   // as-milled tailings slurry
  water: 0x3fa9f5,   // overflow / filtrate / make-up
  thickUf: 0x7a6a52, // thickener underflow
  cake: 0x8e7a5f,    // filter cake
  binder: 0xe2e7f0,  // cement / slag
  paste: 0xc08f52,   // cemented paste backfill
} as const;

export const COL = Object.fromEntries(
  Object.entries(C).map(([k, v]) => [k, new THREE.Color(v)]),
) as Record<keyof typeof C, THREE.Color>;

const cache = new Map<string, THREE.Material>();

function memo<T extends THREE.Material>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const m = make();
  cache.set(key, m);
  return m;
}

/** Painted / galvanised structural steel. */
export function metal(color: number, roughness = 0.55, metalness = 0.85): THREE.MeshStandardMaterial {
  return memo(`m${color}${roughness}${metalness}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

/** Matte non-metal: rubber lining, concrete, rock. */
export function matte(color: number, roughness = 0.95): THREE.MeshStandardMaterial {
  return memo(`d${color}${roughness}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.0 }));
}

/** Light strips, indicators, anything that should bloom. */
export function glow(color: number, intensity = 2.2): THREE.MeshStandardMaterial {
  return memo(`g${color}${intensity}`, () =>
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.4,
      metalness: 0,
    }));
}

/** A glow you intend to mutate per-instance (level bars, alarm lamps). */
export function glowUnique(color: number, intensity = 2.2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0,
  });
}

/** Glass / perspex inspection windows and tank sight glasses. */
export function glass(color = 0x9fd8ff, opacity = 0.16): THREE.MeshStandardMaterial {
  return memo(`x${color}${opacity}`, () =>
    new THREE.MeshStandardMaterial({
      color, transparent: true, opacity,
      roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide,
      depthWrite: false,
    }));
}

/** Process liquor surface - slightly emissive so it reads in the dark. */
export function liquor(color: number, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.20,
    roughness: 0.25,
    metalness: 0.0,
    transparent: opacity < 1,
    opacity,
  });
}
