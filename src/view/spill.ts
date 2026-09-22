import * as THREE from 'three';
import { FX, Spout } from './particles';

/**
 * A vessel overflowing.
 *
 * Tanks do not overflow as a neat curtain - they find the low points and run
 * over in a few heavy streams, which hit the pad, splash, and spread into a
 * puddle that stays there afterwards as evidence. That is what this draws.
 */
export class Overflow {
  group = new THREE.Group();
  private streams: THREE.Mesh[] = [];
  private streamMat: THREE.MeshStandardMaterial;
  private puddle: THREE.Mesh;
  private puddleMat: THREE.MeshStandardMaterial;
  private spouts: Spout[] = [];
  private anchors: THREE.Object3D[] = [];
  private _w = new THREE.Vector3();

  constructor(
    private radius: number,
    private rimY: number,
    private colour: number,
    fx: FX,
    opts: { streams?: number; groundY?: number; splashy?: boolean } = {},
  ) {
    const n = opts.streams ?? 4;
    const groundY = opts.groundY ?? 0;
    const splashy = opts.splashy ?? true;
    const drop = rimY - groundY;

    this.streamMat = new THREE.MeshStandardMaterial({
      color: colour, emissive: colour, emissiveIntensity: 0.08,
      roughness: 0.35, metalness: 0,
      transparent: true, opacity: 0, depthWrite: false,
    });

    for (let i = 0; i < n; i++) {
      // uneven spacing, because a real rim is never level
      const a = (i / n) * Math.PI * 2 + (i % 2 ? 0.35 : -0.2);
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;

      // the falling stream: a narrow tapered column that widens as it falls
      const s = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.15, drop, 8, 1, true),
        this.streamMat,
      );
      s.position.set(x * 1.02, groundY + drop / 2, z * 1.02);
      s.visible = false;
      this.streams.push(s);
      this.group.add(s);

      // an anchor at the rim so the spout knows where it is in the world
      const anchor = new THREE.Object3D();
      anchor.position.set(x, rimY, z);
      this.group.add(anchor);
      this.anchors.push(anchor);

      const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));

      // the stream leaving the rim
      this.spouts.push(new Spout(fx.liquid, 34, (at) => ({
        at, count: 0,
        velocity: outward.clone().multiplyScalar(0.7).setY(-0.6),
        spread: new THREE.Vector3(0.5, 0.4, 0.5),
        jitter: new THREE.Vector3(0.22, 0.08, 0.22),
        colour, size: 0.13, sizeVary: 0.45,
        life: 2.6, gravity: -9.81, drag: 0.85,
        floor: groundY + 0.06, bounce: splashy ? 0.24 : 0,
      })));

      // the splash where it lands
      this.spouts.push(new Spout(fx.spray, 16, (at) => ({
        at: new THREE.Vector3(at.x, groundY + 0.1, at.z),
        count: 0,
        velocity: new THREE.Vector3(0, 2.4, 0),
        spread: new THREE.Vector3(1.8, 1.2, 1.8),
        colour: 0x93bfdd, size: 0.085, sizeVary: 0.6,
        life: 0.75, lifeVary: 0.5, gravity: -9.81, drag: 0.5,
        floor: groundY + 0.05, bounce: 0,
      })));
    }

    // the puddle it leaves behind
    // a darker, matte film - spilled water on a pad is not a swimming pool
    const puddleColour = new THREE.Color(colour).multiplyScalar(0.42);
    this.puddleMat = new THREE.MeshStandardMaterial({
      color: puddleColour, roughness: 0.42, metalness: 0.0,
      transparent: true, opacity: 0, depthWrite: false,
    });
    this.puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 40), this.puddleMat);
    this.puddle.rotation.x = -Math.PI / 2;
    this.puddle.position.y = groundY + 0.07;
    this.puddle.renderOrder = 2;
    this.group.add(this.puddle);
  }

  /**
   * @param rate0to1    how hard it is going over
   * @param cumulative  m3 spilled from this vessel so far, for the puddle
   */
  update(dt: number, rate0to1: number, cumulative: number) {
    const r = Math.max(0, Math.min(1, rate0to1));

    this.streamMat.opacity = 0.34 * r;
    const active = r > 0.02;
    for (let i = 0; i < this.streams.length; i++) {
      const s = this.streams[i];
      s.visible = active;
      if (active) {
        // streams thicken with the rate and shimmer a little
        const k = 0.45 + r * 0.9 + Math.sin(performance.now() * 0.006 + i) * 0.06;
        s.scale.set(k, 1, k);
      }
    }

    for (let i = 0; i < this.anchors.length; i++) {
      this.anchors[i].getWorldPosition(this._w);
      this.spouts[i * 2].run(dt, r, this._w);
      this.spouts[i * 2 + 1].run(dt, r, this._w);
    }

    // puddle spreads as the square root of volume and never fully dries
    const rad = Math.min(this.radius * 1.9, 1.2 + Math.sqrt(Math.max(0, cumulative)) * 0.45);
    this.puddle.scale.setScalar(rad);
    this.puddleMat.opacity = cumulative > 0.5 ? Math.min(0.42, 0.1 + cumulative / 900) : 0;
  }
}
