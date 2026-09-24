import * as THREE from 'three';
import { C, metal, matte } from '../view/palette';
import { TEAMS, BARROW, type Team } from './shared/rules';
import type { Base } from './shared/mine';
import type { BarrowInfo } from './shared/protocol';
import type { Avatars } from './avatars';

/**
 * The two barrows, as this page draws them: under the fill point, in
 * someone's hands, or lying where they were dropped. Where one is and who
 * has it is the server's word, from its B messages; this only puts the
 * model there. A barrow someone is pushing follows their avatar, so it is
 * drawn on the same delayed clock they are.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** A wheelbarrow in the crew's colour, full of paste. Length along +x, wheel at the front. */
export function barrowModel(team: number): { model: THREE.Group; paste: THREE.Mesh; mats: THREE.MeshStandardMaterial[] } {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: TEAMS[team].col, roughness: 0.5, metalness: 0.35 });
  const steel = metal(0x3a3f47, 0.5, 0.7);
  const pasteMat = new THREE.MeshStandardMaterial({ color: C.paste, roughness: 0.42, emissive: C.paste, emissiveIntensity: 0.12 });
  // the tray: a deep pan, sloping at the front
  const s = new THREE.Shape();
  s.moveTo(-0.46, 0.5);
  s.lineTo(0.6, 0.5);
  s.lineTo(0.3, 0.12);
  s.lineTo(-0.38, 0.16);
  s.closePath();
  const tray = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.66, bevelEnabled: false }).translate(0, 0, -0.33), paint);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.7), paint);
  rim.position.set(0.07, 0.5, 0);
  const paste = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), pasteMat);
  paste.scale.set(1.02, 0.28, 0.62);
  paste.position.set(0.07, 0.47, 0);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 16), matte(0x15181c, 0.7));
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(0.72, 0.2, 0);
  g.add(tray, rim, paste, wheel);
  // handles running back from under the tray, and the legs it stands on
  for (const z of [-0.26, 0.26]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.75, 8), steel);
    h.rotation.z = Math.PI / 2 - 0.12;
    h.position.set(-0.15, 0.3, z);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), matte(0x15181c, 0.6));
    grip.rotation.z = Math.PI / 2 - 0.12;
    grip.position.set(-0.98, 0.4, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), steel);
    leg.position.set(-0.3, 0.12, z);
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), steel);
    fork.position.set(0.5, 0.22, z * 0.35);
    fork.rotation.z = 0.15;
    g.add(h, grip, leg, fork);
  }
  g.traverse((o) => { o.castShadow = true; o.userData.noCollide = true; });
  return { model: g, paste, mats: [paint, pasteMat] };
}

interface Item {
  info: BarrowInfo;
  model: THREE.Group;
  paste: THREE.Mesh;
  mats: THREE.MeshStandardMaterial[];
  tints: THREE.Color[];
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  yaw: number;
  /** where it is being drawn, and whether it is anywhere at all */
  at: THREE.Vector3;
  shown: boolean;
}

export class Barrows {
  group = new THREE.Group();
  private items: Item[] = [];

  constructor(private bases: [Base, Base]) {
    this.group.userData.noCollide = true;
    bases.forEach((b, t) => {
      const { model, paste, mats } = barrowModel(t);
      const col = TEAMS[t].col;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1.1, 36),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.7, 5, 18, 1, true),
        new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      this.group.add(model, ring, beam);
      this.items.push({
        info: { st: 'home' }, model, paste, mats, tints: mats.map((m) => m.color.clone()),
        ring, beam, yaw: b.homeYaw, at: V(b.home[0], b.home[1], b.home[2]), shown: true,
      });
    });
  }

  get(t: Team) { return this.items[t].info; }

  set(t: Team, info: BarrowInfo) {
    const it = this.items[t];
    it.info = info;
    if (info.st === 'down' && info.p) it.at.set(info.p[0], info.p[1], info.p[2]);
  }

  /** where barrow t is being drawn, for the minimap and for markers */
  where(t: Team) { return this.items[t].at; }

  /**
   * Put them where they are now: `me` is our own id, whose barrow is in
   * our own hands and drawn by the view model instead. Times are server ms.
   */
  update(serverNow: number, avatars: Avatars, me: number, light?: (x: number, z: number, out: THREE.Color) => THREE.Color) {
    const pulse = 0.5 + 0.5 * Math.sin(serverNow / 180);
    const c = new THREE.Color();
    this.items.forEach((it, t) => {
      const b = this.bases[t];
      const info = it.info;
      let visible = true, marker = false, lift = 0, pitch = 0;
      it.paste.visible = true;
      switch (info.st) {
        case 'home':
          it.at.set(b.home[0], b.home[1], b.home[2]);
          it.yaw = b.homeYaw;
          marker = true;
          break;
        case 'away': {
          // under the hose, filling up again
          it.at.set(b.home[0], b.home[1], b.home[2]);
          it.yaw = b.homeYaw;
          const left = Math.max(0, ((info.until ?? 0) - serverNow) / 1000);
          const k = 1 - Math.min(1, left / BARROW.refill);
          it.paste.visible = k > 0.05;
          it.paste.scale.set(1.02 * (0.6 + 0.4 * k), 0.28 * k, 0.62 * (0.6 + 0.4 * k));
          break;
        }
        case 'down':
          marker = true;
          break;
        case 'held': {
          if (info.by === me) { visible = false; break; }
          const a = info.by !== undefined ? avatars.get(info.by) : undefined;
          if (!a) { visible = false; break; }
          // out in front of them, handles up in their hands
          it.yaw = a.yaw;
          const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
          it.at.set(a.position.x + fx * 1.25, a.position.y, a.position.z + fz * 1.25);
          // handles up, wheel still on the floor
          lift = 0.22;
          pitch = -0.3;
          break;
        }
      }
      if (info.st !== 'away') it.paste.scale.set(1.02, 0.28, 0.62);
      it.shown = visible;
      it.model.visible = visible;
      // the model's +x is its front; the walker's yaw of 0 looks north (-z)
      it.model.position.set(it.at.x, it.at.y + lift, it.at.z);
      it.model.rotation.set(0, it.yaw + Math.PI / 2, pitch, 'YZX');
      it.ring.visible = it.beam.visible = visible && marker;
      it.ring.position.set(it.at.x, it.at.y + 0.04, it.at.z);
      it.ring.scale.setScalar(0.9 + pulse * 0.15);
      it.beam.position.set(it.at.x, it.at.y + 2.5, it.at.z);
      (it.beam.material as THREE.MeshBasicMaterial).opacity = info.st === 'down' ? 0.05 + pulse * 0.08 : 0.06;
      if (light) {
        light(it.at.x, it.at.z, c);
        it.mats.forEach((m, i) => m.emissive.copy(it.tints[i]).multiply(c).multiplyScalar(0.7).addScalar(i === 1 ? 0.04 : 0));
      }
    });
  }
}
