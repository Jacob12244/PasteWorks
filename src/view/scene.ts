import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { C } from './palette';
import type { Look } from '../scenario';

/** Dusk sky so the emissive plant has something to sit against. */
function skyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x060910) },
      mid: { value: new THREE.Color(0x14203a) },
      bot: { value: new THREE.Color(0x3a2f3c) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
      varying vec3 vP;
      void main() {
        float h = normalize(vP).y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, pow(-h, 0.7));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), mat);
  m.frustumCulled = false;
  return m;
}

export class Stage {
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private pools: THREE.PointLight[] = [];
  /** the sun, or whatever passes for it; worlds aim things at it */
  key: THREE.DirectionalLight;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene.fog = new THREE.Fog(C.fog, 150, 520);
    this.sky = skyDome();
    this.scene.add(this.sky);

    // Metal without image-based lighting renders black. A PMREM of the stock
    // room environment gives every steel surface something to reflect, which
    // is most of the difference between "3D shapes" and "a plant".
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 2000);
    this.camera.position.set(-35, 42, 104);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(11, -14, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxDistance = 420;
    this.controls.minDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.98;

    // ---- lighting ----
    this.hemi = new THREE.HemisphereLight(0x5a7da8, 0x0a0f16, 0.55);
    this.scene.add(this.hemi);

    const key = new THREE.DirectionalLight(0xfff0dc, 2.0);
    this.key = key;
    key.position.set(-70, 95, 70);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 320;
    const s = 110;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.05;
    this.scene.add(key);
    this.scene.add(key.target);

    const fill = new THREE.DirectionalLight(0x6ea8ff, 0.45);
    fill.position.set(80, 40, -80);
    this.scene.add(fill);
    this.fill = fill;

    const rim = new THREE.DirectionalLight(0xff9a5c, 0.35);
    rim.position.set(30, 12, 120);
    this.scene.add(rim);
    this.rim = rim;

    // pools of light over the working areas
    for (const [x, y, z, col, i] of [
      [-52, 14, 0, 0x9fd8ff, 220],
      [-10, 14, 0, 0x9fd8ff, 180],
      [16, 18, 0, 0xffc98a, 180],
      // the pumps, lit from the control-room side and under the crane girder
      [27, 6, 9, 0xffc98a, 140],
    ] as const) {
      const p = new THREE.PointLight(col, i, 80, 2);
      p.position.set(x, y, z);
      this.scene.add(p);
      this.pools.push(p);
    }

    // ---- post ----
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), 0.62, 0.55, 0.72,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => this.resize());
  }

  /**
   * Put the whole stage somewhere else: sky, fog, lights, grade and bloom.
   * Everything is set absolutely from the look, so applying one twice - or
   * one after another - lands in the same place.
   */
  applyLook(look: Look) {
    const u = this.sky.material.uniforms;
    u.top.value.setHex(look.sky[0]);
    u.mid.value.setHex(look.sky[1]);
    u.bot.value.setHex(look.sky[2]);

    const f = look.fog;
    this.scene.fog = f.density !== undefined
      ? new THREE.FogExp2(f.color, f.density)
      : new THREE.Fog(f.color, f.near ?? 150, f.far ?? 520);
    this.renderer.setClearColor(f.color);

    this.hemi.color.setHex(look.hemi.sky);
    this.hemi.groundColor.setHex(look.hemi.ground);
    this.hemi.intensity = look.hemi.intensity;
    this.key.color.setHex(look.key.color);
    this.key.intensity = look.key.intensity;
    this.fill.intensity = look.fill;
    this.rim.intensity = look.rim;
    const base = [220, 180, 180, 140];
    this.pools.forEach((p, i) => { p.intensity = base[i] * look.pools; });

    this.renderer.toneMappingExposure = look.exposure;
    this.lookBloom = look.bloom;
    this.bloom.radius = look.bloom[1];
    this.footBloom();
    this.scene.environmentIntensity = look.env;
  }

  /**
   * On foot the camera is a metre from things, not fifty. The orbit view's
   * bloom catches anything bright, and that is fine when a white bag is a
   * speck in the corner - but walk up to one and it fills the screen, and the
   * whole view goes to haze. On foot, only what actually glows blooms: the
   * threshold goes above anything a lit surface reaches, and it is gentler.
   */
  onFoot(on: boolean) {
    this.walking = on;
    this.footBloom();
  }

  private walking = false;
  private lookBloom: [number, number, number] = [0.62, 0.55, 0.72];

  private footBloom() {
    const [strength, , threshold] = this.lookBloom;
    this.bloom.strength = this.walking ? Math.min(strength, 0.45) : strength;
    this.bloom.threshold = this.walking ? Math.max(threshold, 1.1) : threshold;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  /**
   * Free look: the camera is pinned to one point and only turns.
   *
   * OrbitControls always re-derives the camera's orientation from its target,
   * so it has to be stood down entirely rather than just disabled - otherwise
   * update() drags the view back every frame.
   */
  freeLook = false;
  private eye = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private yawTo = 0;
  private pitchTo = 0;
  private lastLook = 0;

  enterFreeLook(eye: THREE.Vector3, pitch: number) {
    this.eye.copy(eye);
    this.lastLook = 0;
    this.yaw = this.yawTo = 0;
    this.pitch = this.pitchTo = pitch;
    this.camera.rotation.order = 'YXZ';
    this.freeLook = true;
  }

  exitFreeLook() {
    this.freeLook = false;
  }

  /**
   * Someone else is driving the camera - the walker. Orbit is stood down the
   * same way as for free look, because OrbitControls re-aims the camera at its
   * target on every update whether it is enabled or not.
   */
  manual = false;

  /** Absolute look angles, radians. Applied with a little damping. */
  setLook(yaw: number, pitch: number) {
    this.yawTo = yaw;
    this.pitchTo = pitch;
  }

  get look() {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  setFov(fov: number) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (this.freeLook) {
      // Time based, not per-frame: a fixed fraction each frame would make the
      // head turn at whatever speed the machine happens to render at.
      const now = performance.now();
      const dt = this.lastLook ? Math.min(0.1, (now - this.lastLook) / 1000) : 0.016;
      this.lastLook = now;
      const k = 1 - Math.exp(-dt * 16);
      this.yaw += (this.yawTo - this.yaw) * k;
      this.pitch += (this.pitchTo - this.pitch) * k;
      this.camera.position.copy(this.eye);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    } else if (!this.manual) {
      this.controls.update();
    }
    this.composer.render();
  }

  /** Glide the camera to a new target and distance. */
  flyTo(target: THREE.Vector3, offset: THREE.Vector3, ms = 900) {
    const c = this.camera;
    const from = c.position.clone();
    const fromT = this.controls.target.clone();
    const to = target.clone().add(offset);
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      c.position.lerpVectors(from, to, e);
      this.controls.target.lerpVectors(fromT, target, e);
      if (k < 1) requestAnimationFrame(tick);
    };
    tick();
  }
}
