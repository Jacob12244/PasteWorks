import * as THREE from 'three';

/**
 * Animated flow inside pipework.
 *
 * A tube's UV runs 0..1 along its length, so a travelling band in u reads as
 * material moving down the line. Speed is driven from the real velocity in the
 * simulation, so when the paste slows down, you see it slow down.
 */

export interface FlowUniforms {
  uTime: { value: number };
  uSpeed: { value: number };
  uDensity: { value: number };
  uColor: { value: THREE.Color };
  uIntensity: { value: number };
  uFill: { value: number };
  uPulse: { value: number };
}

export interface FlowMaterial extends THREE.MeshStandardMaterial {
  flow: FlowUniforms;
}

const registry: FlowUniforms[] = [];

/**
 * Bands are spaced in UV, and a tube's UV always runs 0..1 whatever its real
 * length, so the band count has to be derived from the length or a 5 m spool
 * ends up looking like a caterpillar track.
 */
export function bandsFor(lengthM: number, metresPerBand = 3.2): number {
  return Math.max(3, Math.round(lengthM / metresPerBand));
}

/**
 * A standard-lit pipe that carries a travelling emissive band.
 * @param color    material colour of the contents
 * @param density  bands per unit of UV length
 */
export function flowMaterial(color: number, opts: {
  density?: number;
  intensity?: number;
  base?: number;
  roughness?: number;
  metalness?: number;
} = {}): FlowMaterial {
  const { density = 26, intensity = 1.5, base = 0x3a4250, roughness = 0.45, metalness = 0.9 } = opts;

  const mat = new THREE.MeshStandardMaterial({
    color: base, roughness, metalness,
  }) as FlowMaterial;

  const flow: FlowUniforms = {
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uDensity: { value: density },
    uColor: { value: new THREE.Color(color) },
    uIntensity: { value: intensity },
    uFill: { value: 1 },
    uPulse: { value: 0 },
  };
  mat.flow = flow;
  registry.push(flow);

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flow);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFlowUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFlowUv = uv;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vFlowUv;
uniform float uTime;
uniform float uSpeed;
uniform float uDensity;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uFill;
uniform float uPulse;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float u = vFlowUv.x;
  // hard cut at the leading edge so a line can be seen priming
  float filled = step(u, uFill);
  float phase = u * uDensity - uTime * uSpeed;
  float band = pow(0.5 + 0.5 * sin(phase * 6.2831853), 2.0);
  // stroke pulse from the positive-displacement pump
  float pulse = 1.0 + uPulse * 0.4 * sin(phase * 6.2831853 * 0.25);
  float carrying = filled * clamp(abs(uSpeed) * 4.0, 0.0, 1.0);
  totalEmissiveRadiance += uColor * (0.06 + band * uIntensity * pulse) * carrying;
  diffuseColor.rgb = mix(diffuseColor.rgb, uColor * 0.5, filled * 0.45);
}`);
  };

  return mat;
}

/** Belt material: bands run across v instead of along u. */
export function beltMaterial(color: number): FlowMaterial {
  const mat = flowMaterial(color, { density: 18, intensity: 0.7, base: 0x14181f, roughness: 0.9, metalness: 0.1 });
  return mat;
}

/** Advance every flow in the scene. */
export function tickFlows(dt: number) {
  for (const f of registry) f.uTime.value += dt;
}

/** Convenience: set a flow from a real velocity in m/s. */
export function setFlow(mat: FlowMaterial, velocity: number, fill = 1, pulse = 0) {
  mat.flow.uSpeed.value = velocity * 0.35;
  mat.flow.uFill.value = fill;
  mat.flow.uPulse.value = pulse;
}
