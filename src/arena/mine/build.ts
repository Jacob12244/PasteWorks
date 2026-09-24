import * as THREE from 'three';
import { FX } from '../../view/particles';
import { C } from '../../view/palette';
import type { Stage } from '../../view/scene';
import type { Look } from '../../scenario/types';
import { Field, Samples, mesh, plan, rockNoise, type Plan } from './level';
import { Kit } from './kit';
import { dress } from './dress';
import { Baker, Probe, bakedMaterial } from './light';
import { BASES } from '../shared/mine';
import { TEAMS } from '../shared/rules';

/**
 * The 760 Level, built: the rock carved and meshed, everything in it
 * dressed and merged, and - for anyone actually playing - every lamp baked
 * into every vertex. The collision world is taken from `root` like the
 * plant's is, so the rock and the machines collide and the dressing does not.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** a tiling rock texture: grey blotches, grit and a few cracks, drawn once */
function rockTexture(seed: number, cracks: number): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, s, s);
  let a = seed;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  // blotches, wrapped at the edges so it tiles
  for (let i = 0; i < 260; i++) {
    const x = r() * s, y = r() * s, rad = 6 + r() * 30, v = 90 + r() * 80;
    for (const ox of [-s, 0, s]) {
      for (const oy of [-s, 0, s]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
        gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = gr;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 38;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(40,40,40,0.3)';
  for (let i = 0; i < cracks; i++) {
    let x = r() * s, y = r() * s;
    g.lineWidth = 0.5 + r() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 34; y += (r() - 0.3) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A material patch: the texture laid on from all three sides, by world position. */
function triplanar(tex: THREE.Texture, scale: number, depth: number) {
  return (sh: THREE.WebGLProgramParametersWithUniforms) => {
    sh.uniforms.uTri = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNor = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;\nuniform sampler2D uTri;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 bw = pow(abs(vWNor), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        vec3 p = vWPos * ${scale.toFixed(3)};
        float d = texture2D(uTri, p.zy).r * bw.x + texture2D(uTri, p.xz).r * bw.y + texture2D(uTri, p.xy).r * bw.z;
        vec3 q = vWPos * ${(scale * 3.7).toFixed(3)};
        float e = texture2D(uTri, q.zy + 0.37).r * bw.x + texture2D(uTri, q.xz + 0.37).r * bw.y + texture2D(uTri, q.xy + 0.37).r * bw.z;
        diffuseColor.rgb *= mix(1.0 - ${depth.toFixed(2)}, 1.0 + ${depth.toFixed(2)}, d * 0.65 + e * 0.35);
      }`);
  };
}

export class Mine {
  root = new THREE.Group();
  /** what moves: paste in the stopes, beacons - never in the collision world */
  live = new THREE.Group();
  fx = new FX();
  field: Field;
  samples: Samples;
  plan: Plan;
  probe: Probe | null = null;
  private stopes: THREE.Mesh[] = [];
  private level = [-24, -24];
  private levelTo = [-24, -24];
  private beacons: THREE.Mesh[] = [];
  private time = 0;

  constructor(opts: { light: boolean }) {
    const t0 = performance.now();
    const lap = (what: string, since: number) => console.info(`arena: mine ${what} ${(performance.now() - since).toFixed(0)} ms`);
    this.field = new Field();
    this.samples = new Samples(this.field);
    lap('field', t0);
    let t = performance.now();
    const rm = mesh(this.samples);
    this.plan = plan(this.field);
    lap(`rock ${(rm.floor.length + rm.walls.length) / 3} triangles`, t);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(rm.position, 3));
    const idx = new Uint32Array(rm.floor.length + rm.walls.length);
    idx.set(rm.floor);
    idx.set(rm.walls, rm.floor.length);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.addGroup(0, rm.floor.length, 0);
    geo.addGroup(rm.floor.length, rm.walls.length, 1);
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(this.albedo(rm.position), 3));

    const wall = bakedMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true }),
      triplanar(rockTexture(11, 9), 0.31, 0.38));
    const floor = bakedMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 }),
      triplanar(rockTexture(29, 4), 0.42, 0.3));
    const rock = new THREE.Mesh(geo, [floor, wall]);
    rock.name = 'rock';
    rock.userData.collider = true;
    this.root.add(rock);

    t = performance.now();
    const kit = new Kit();
    const { lamps } = dress(this.field, kit);
    const fixed = kit.build();
    this.root.add(fixed);
    lap(`dressing ${fixed.children.length} meshes, ${lamps.length} lamps`, t);

    this.buildLive();
    this.live.userData.noCollide = true;
    this.root.add(this.live, this.fx.group);

    if (opts.light) {
      t = performance.now();
      const baker = new Baker(this.samples, lamps);
      baker.bake(geo, true);
      for (const m of fixed.children as THREE.Mesh[]) {
        if (!m.material || !(m.material as THREE.Material).visible) continue;
        baker.bake(m.geometry);
        m.material = bakedMaterial(m.material as THREE.Material);
      }
      lap('light', t);
      t = performance.now();
      this.probe = new Probe(baker, -84, -50, 84, 50, (x, z) => this.field.at(x, 1.3, z) < -0.25);
      lap('probe', t);
    }
  }

  /** the rock's own colour, vertex by vertex: tan sandstone, grey bands, darker wet near the floor */
  private albedo(pos: Float32Array) {
    const out = new Float32Array(pos.length);
    const tan = new THREE.Color(0x8f8270), grey = new THREE.Color(0x76746f), mud = new THREE.Color(0x544b41);
    const wetMud = new THREE.Color(0x3a322b), c = new THREE.Color();
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (Math.abs(y) < 0.02) {
        const n = rockNoise(x * 0.4, 0, z * 0.4);
        c.copy(mud).lerp(wetMud, Math.max(0, Math.min(1, 0.45 + n * 0.8)));
      } else {
        const band = rockNoise(x * 0.12, y * 0.9, z * 0.12);
        c.copy(tan).lerp(grey, Math.max(0, Math.min(1, 0.4 + band)));
        // splashed and wet for the first metre, and dark in the stopes
        if (y < 1.1) c.multiplyScalar(0.62 + 0.38 * Math.max(0, y) / 1.1);
        if (y < -0.5) c.multiplyScalar(0.8);
        c.multiplyScalar(0.9 + rockNoise(x * 1.7, y * 1.7, z * 1.7) * 0.18);
      }
      out[i] = c.r; out[i + 1] = c.g; out[i + 2] = c.b;
    }
    return out;
  }

  /** the paste in each stope, and each crew's beacon over its fill point */
  private buildLive() {
    BASES.forEach((b, t) => {
      const s = b.stope;
      const paste = new THREE.Mesh(
        new THREE.PlaneGeometry(s.hx * 2 + 3, s.hz * 2 + 3, 1, 1),
        new THREE.MeshStandardMaterial({ color: C.paste, roughness: 0.36, emissive: C.paste, emissiveIntensity: 0.07 }),
      );
      // flat, then turned to lie square in the hole
      paste.rotation.order = 'YXZ';
      paste.rotation.set(-Math.PI / 2, -s.rot, 0);
      paste.position.set(s.x, this.level[t], s.z);
      this.stopes.push(paste);
      this.live.add(paste);

      const dirx = -Math.sin(b.homeYaw), dirz = -Math.cos(b.homeYaw);
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.2, 12),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: TEAMS[t].col, emissiveIntensity: 2.5 }),
      );
      beacon.position.set(b.home[0] - dirx * 1.7, 3.0, b.home[2] - dirz * 1.7);
      this.beacons.push(beacon);
      this.live.add(beacon);
    });
  }

  /** Pours so far into each crew's stope: the paste rises in it. */
  setPoured(stope: 0 | 1, pours: number, now = false) {
    this.levelTo[stope] = -24 + Math.min(4, pours) * 5.2;
    if (now) this.level[stope] = this.levelTo[stope];
  }

  /** The brow of a stope, just over the barricade - where a pour goes in. */
  brow(stope: 0 | 1) {
    const b = BASES[stope];
    return V(b.brow[0] + b.into[0] * 0.6, 2.2, b.brow[1] + b.into[1] * 0.6);
  }

  /** A barrowload going over the brow, into the dark. */
  pour(stope: 0 | 1) {
    const at = this.brow(stope);
    const b = BASES[stope];
    this.fx.liquid.emit({
      at, count: 90, velocity: V(b.into[0] * 2.5, 0.5, b.into[1] * 2.5), spread: V(1.4, 0.6, 1.4),
      colour: C.paste, size: 0.16, sizeVary: 0.5, life: 1.6, gravity: -9.81, drag: 0.2,
    });
  }

  update(dt: number) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 0.9);
    this.stopes.forEach((m, i) => {
      this.level[i] += (this.levelTo[i] - this.level[i]) * k;
      m.position.y = this.level[i];
    });
    this.beacons.forEach((b, i) => {
      const m = b.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 1.2 + 2.2 * Math.max(0, Math.sin(this.time * 4 + i * Math.PI));
    });
    this.fx.update(dt);
  }

  /** Light the stage for underground: no sky, no sun, a dusty dark, and the lamps baked in. */
  static stage(stage: Stage) {
    stage.applyLook({
      sky: [0x040302, 0x040302, 0x040302],
      fog: { color: 0x0a0806, density: 0.02 },
      hemi: { sky: 0x6e6a62, ground: 0x26231f, intensity: 0.3 },
      key: { color: 0xffffff, intensity: 0 },
      fill: 0, rim: 0, pools: 0,
      exposure: 1.05,
      bloom: [0.5, 0.45, 0.8],
      env: 0.1,
    } as unknown as Look);
    stage.key.castShadow = false;
  }
}
