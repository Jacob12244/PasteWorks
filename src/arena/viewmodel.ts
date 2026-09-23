import * as THREE from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { C, metal, matte } from '../view/palette';
import { WEAPONS, type WeaponId } from './shared/rules';

/**
 * What is in your hands: the paste gun, with a sight glass on its hopper
 * that empties as you fire, or a rock.
 *
 * It lives in a scene of its own, drawn after the plant with the depth
 * buffer cleared, so the nozzle never disappears into a handrail you are
 * standing against.
 */
export class ViewModel {
  scene = new THREE.Scene();
  pass: RenderPass;
  private rig = new THREE.Group();
  private sway = new THREE.Group();
  private gun = new THREE.Group();
  private hand = new THREE.Group();
  private fill: THREE.Mesh;
  private muzzleAt = new THREE.Object3D();
  private handAt = new THREE.Object3D();
  private flash: THREE.Mesh;
  private kick = 0;
  private swap = 1;
  private bob = 0;
  private held: WeaponId = 0;
  private want: WeaponId = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private lagX = 0;
  private lagY = 0;

  constructor(camera: THREE.PerspectiveCamera, env: THREE.Texture | null) {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;
    this.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x20160c, 0.7));
    this.scene.add(this.rig);
    this.rig.add(this.sway);
    // lit from over your shoulder whichever way you face, so it never blooms out
    const key = new THREE.DirectionalLight(0xfff0dc, 1.0);
    key.position.set(-0.6, 1, 0.4);
    this.rig.add(key, key.target);

    // ---- paste gun: yellow body, black hopper with a sight glass, steel nozzle
    const yellow = metal(0xe0b830, 0.45, 0.35);
    const black = matte(0x1a1d22, 0.55);
    const steel = metal(C.steelLight, 0.35, 0.9);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, p: THREE.Object3D = this.gun) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      p.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.11, 0.12, 0.44), yellow, 0, 0, 0);
    add(new THREE.BoxGeometry(0.115, 0.03, 0.3), black, 0, -0.045, 0.02);
    const hopper = add(new THREE.CylinderGeometry(0.07, 0.05, 0.16, 16, 1, true), black, 0, 0.13, 0.06);
    (hopper.material as THREE.Material).side = THREE.DoubleSide;
    add(new THREE.TorusGeometry(0.07, 0.008, 6, 20), steel, 0, 0.21, 0.06).rotation.x = Math.PI / 2;
    // the sight glass, and the paste behind it
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbfe6ff, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.2, depthWrite: false,
    });
    add(new THREE.CylinderGeometry(0.066, 0.048, 0.15, 16), glassMat, 0, 0.13, 0.06);
    this.fill = add(new THREE.CylinderGeometry(0.06, 0.046, 1, 16), new THREE.MeshStandardMaterial({
      color: C.paste, emissive: C.paste, emissiveIntensity: 0.3, roughness: 0.6,
    }), 0, 0.13, 0.06);
    const noz = add(new THREE.CylinderGeometry(0.026, 0.036, 0.2, 12), steel, 0, 0.012, -0.31);
    noz.rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12), black, 0, 0.012, -0.22).rotation.x = Math.PI / 2;
    const grip = add(new THREE.BoxGeometry(0.05, 0.14, 0.07), black, 0, -0.1, 0.12);
    grip.rotation.x = 0.28;
    add(new THREE.BoxGeometry(0.02, 0.04, 0.12), matte(0x3fa9f5, 0.4), 0.062, 0.01, -0.04);
    // a glove on the grip, so there is someone holding it
    add(new THREE.BoxGeometry(0.09, 0.08, 0.11), matte(0x2a3140, 0.8), 0.005, -0.12, 0.13);
    this.muzzleAt.position.set(0, 0.012, -0.42);
    this.gun.add(this.muzzleAt);
    this.flash = add(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false,
    }), 0, 0.012, -0.44);
    this.gun.position.set(0.19, -0.2, -0.52);
    this.gun.rotation.y = 0.05;
    this.gun.scale.setScalar(0.72);

    // ---- a gloved hand with a rock in it
    add(new THREE.BoxGeometry(0.11, 0.09, 0.14), matte(0x2a3140, 0.8), 0, 0, 0, this.hand);
    add(new THREE.BoxGeometry(0.12, 0.1, 0.28), matte(0x243248, 0.85), 0, -0.02, 0.2, this.hand);
    const rock = add(new THREE.DodecahedronGeometry(0.1), matte(0x7d8793, 0.9), 0, 0.07, -0.04, this.hand);
    rock.rotation.set(0.4, 0.8, 0.2);
    this.handAt.position.set(0, 0.07, -0.04);
    this.hand.add(this.handAt);
    this.hand.position.set(0.2, -0.2, -0.46);
    this.hand.scale.setScalar(0.8);

    this.sway.add(this.gun, this.hand);
    this.hand.visible = false;

    this.pass = new RenderPass(this.scene, camera);
    this.pass.clear = false;
    this.pass.clearDepth = true;
  }

  /** what is in hand, and how full the hopper is */
  set(w: WeaponId, paste: number) {
    this.want = w;
    const f = Math.max(0.02, Math.min(1, paste / WEAPONS[0].cap));
    this.fill.scale.y = 0.14 * f;
    this.fill.position.y = 0.13 - 0.07 + 0.07 * f;
    this.fill.visible = paste > 0;
  }

  fire(w: WeaponId) {
    this.kick = 1;
    if (w === 0) (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.9;
  }

  /** where the throw appears to leave from, in the world */
  muzzle(out: THREE.Vector3) {
    // the rig is stood exactly where the camera is, so its world is the plant's
    this.rig.updateMatrixWorld(true);
    return (this.held === 0 ? this.muzzleAt : this.handAt).getWorldPosition(out);
  }

  set visible(v: boolean) { this.rig.visible = v; }

  update(camera: THREE.PerspectiveCamera, dt: number, speed: number, grounded: boolean, yaw: number, pitch: number) {
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);

    // lower, swap, raise
    if (this.want !== this.held) {
      this.swap = Math.max(0, this.swap - dt * 7);
      if (this.swap === 0) {
        this.held = this.want;
        this.gun.visible = this.held === 0;
        this.hand.visible = this.held === 1;
      }
    } else {
      this.swap = Math.min(1, this.swap + dt * 6);
    }
    this.kick = Math.max(0, this.kick - dt * (this.held === 0 ? 14 : 5));
    const fl = this.flash.material as THREE.MeshBasicMaterial;
    fl.opacity = Math.max(0, fl.opacity - dt * 12);

    // a step in the stride, and a little lag behind where you turn
    if (grounded && speed > 0.5) this.bob += dt * speed * 1.8;
    const b = grounded ? Math.min(1, speed / 6) : 0;
    let dy = yaw - this.lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.lastYaw = yaw;
    const dp = pitch - this.lastPitch;
    this.lastPitch = pitch;
    const k = 1 - Math.exp(-dt * 10);
    this.lagX += (Math.max(-0.05, Math.min(0.05, dy * 0.6)) - this.lagX) * k;
    this.lagY += (Math.max(-0.05, Math.min(0.05, -dp * 0.6)) - this.lagY) * k;

    const down = (1 - this.swap) * 0.3;
    this.sway.position.set(
      Math.cos(this.bob) * 0.012 * b + this.lagX,
      -Math.abs(Math.sin(this.bob)) * 0.016 * b - down + this.lagY,
      this.kick * (this.held === 0 ? 0.05 : -0.12),
    );
    this.sway.rotation.x = this.kick * (this.held === 0 ? 0.12 : -0.5);
  }
}
