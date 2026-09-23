/**
 * The machines that stand where the thickener would, on sites where a
 * thickener cannot work.
 *
 *   CycloneBank   on the seabed - no settling tank makes sense when the whole
 *                 site is underwater, so the water comes out inline.
 *   Centrifuge    on Psyche - a thickener settles under gravity, and at
 *                 0.015 g there is none worth having. Decanters spin the
 *                 tailings at a few thousand g instead.
 *
 * Both are the unit with id 'thickener', so the consoles treat them as the
 * dewatering stage without having to know which one it is. Both expose where
 * their underflow and overflow leave, so the site pipework lands on them.
 */
import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { C, metal, matte, glow, glowUnique } from './palette';
import { box, cyl, tube, strip, platform, ladder, LevelBar, Beacon } from './parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Unit } from './units';

export interface Dewaterer extends Unit {
  /** where the underflow (or cake) leaves, local */
  ufOut: THREE.Vector3;
  /** where the overflow (or centrate) leaves, local */
  ofOut: THREE.Vector3;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ============================================================ CYCLONE BANK

export class CycloneBank extends Unit implements Dewaterer {
  readonly id = 'thickener';
  readonly name = 'Dewatering Cyclones';
  ufOut = new THREE.Vector3(0, 0.7, 0);
  ofOut = new THREE.Vector3(6.5, 13.4, 0);

  private mats: THREE.MeshStandardMaterial[] = [];
  private ofFlow: FlowMaterial;
  private ufFlow: FlowMaterial;
  private plumeSpout?: Spout;
  private beacon = new Beacon();
  private bar: LevelBar;

  constructor() {
    super('DEWATERING CYCLONES', 3.0);
    const g = this.group;
    const D = 7.5;

    g.add(platform(14, 14, { y: D, accent: C.cyan }));

    // a ring of big cyclones round a central distributor
    const dist = cyl(1.4, 1.4, 2.2, metal(C.steelLight, 0.45, 0.9), 20);
    dist.position.y = D + 3.1;
    g.add(dist);
    const N = 10;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cy = new THREE.Group();
      const barrel = cyl(0.62, 0.62, 1.6, metal(0x6b7787, 0.4, 0.9), 16);
      barrel.position.y = 0.8;
      cy.add(barrel);
      const cone = cyl(0.62, 0.14, 3.0, metal(0x5a6573, 0.45, 0.9), 16);
      cone.position.y = -1.5;
      cy.add(cone);
      const vf = tube(0.2, 1.2, metal(C.steelDark), 10);
      vf.position.y = 2.2;
      cy.add(vf);
      const mat = glowUnique(C.cyan, 0.8);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.05, 6, 20), mat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.2;
      cy.add(band);
      this.mats.push(mat);
      cy.position.set(Math.cos(a) * 3.6, D + 3.3, Math.sin(a) * 3.6);
      cy.rotation.z = Math.cos(a) * 0.12;
      cy.rotation.x = -Math.sin(a) * 0.12;
      g.add(cy);
      // spigot to the underflow launder
      const sp = tube(0.1, 1.0, metal(C.steelDark), 8);
      sp.position.set(Math.cos(a) * 3.4, D + 0.9, Math.sin(a) * 3.4);
      g.add(sp);
    }
    // overflow header ring and the underflow launder under the deck
    const header = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.3, 10, 40), metal(C.steelDark));
    header.rotation.x = Math.PI / 2;
    header.position.y = D + 5.9;
    g.add(header);
    const launder = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.4, 8, 40), metal(C.steelDark));
    launder.rotation.x = Math.PI / 2;
    launder.position.y = D - 0.4;
    g.add(launder);

    this.ufFlow = flowMaterial(C.thickUf, { density: bandsFor(D), intensity: 1.6 });
    const down = tube(0.34, D - 0.6, this.ufFlow, 14);
    down.position.set(0, (D - 0.6) / 2 + 0.4, 0);
    g.add(down);
    this.ofFlow = flowMaterial(C.water, { density: bandsFor(8), intensity: 1.0 });
    const up = tube(0.32, 6.2, this.ofFlow, 14);
    up.rotation.z = Math.PI / 2;
    up.position.set(3.4, D + 5.9, 0);
    g.add(up);

    this.bar = new LevelBar(3.0, C.lime, 0.4);
    this.bar.group.position.set(7.3, D + 0.4, -3);
    this.bar.group.rotation.y = -Math.PI / 2;
    g.add(this.bar.group);
    this.beacon.group.position.set(7.3, D, 3);
    g.add(this.beacon.group);
    const lad = ladder(D + 0.5);
    lad.position.set(-7.2, 0, 3);
    lad.rotation.y = Math.PI / 2;
    g.add(lad);

    this.focus.set(0, D + 2, 0);
    this.viewOffset = new THREE.Vector3(-16, 16, 26);
    this.mountTag(D + 11);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const th = t.thickener;
    const on = th.underflow.solids > 1;
    const loss = th.overflow.solids;
    for (let i = 0; i < this.mats.length; i++) {
      this.mats[i].emissiveIntensity = on ? 1.2 + Math.sin(t.time * 6 + i) * 0.4 : 0.3;
      this.mats[i].emissive.setHex(loss > 4 ? C.amber : C.cyan);
    }
    setFlow(this.ufFlow, on ? 1.6 : 0);
    setFlow(this.ofFlow, th.overflow.water > 1 ? 2.4 : 0);
    const frac = clamp01(th.ufCw / 0.62);
    this.bar.setLevel(frac, th.ufCw > 0.585 ? C.amber : C.lime);
    this.beacon.set(loss > 4 ? C.amber : on ? C.lime : C.cyan, 2.2);

    // fines out of the top go to sea as a haze
    this.plumeSpout ??= new Spout(fx.haze, 10, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0.6, 0.35, 0),
      spread: new THREE.Vector3(0.6, 0.3, 0.6),
      jitter: new THREE.Vector3(0.4, 0.4, 0.4),
      colour: 0x9a8a6a, size: 1.1, sizeVary: 0.5,
      life: 4, gravity: 0, drag: 0.5, grow: 3,
    }));
    const w = this.group.localToWorld(new THREE.Vector3(9.5, 13.4, 0));
    this.plumeSpout.run(dt, clamp01(loss / 6), w);

    this.tag.set(
      (th.ufCw * 100).toFixed(1) + '%',
      'U/F  ·  ' + loss.toFixed(1) + ' t/h to sea',
      loss > 4 ? 'warn' : 'ok',
    );
  }
}

// ============================================================== CENTRIFUGE

export class Centrifuge extends Unit implements Dewaterer {
  readonly id = 'thickener';
  readonly name = 'Decanter Centrifuges';
  ufOut = new THREE.Vector3(0, 0.7, 0);
  ofOut = new THREE.Vector3(9.0, 5.2, 0);

  private bowls: THREE.Group[] = [];
  private stripes: THREE.MeshStandardMaterial;
  private ufFlow: FlowMaterial;
  private ofFlow: FlowMaterial;
  private bar: LevelBar;
  private beacon = new Beacon();

  constructor() {
    super('DECANTERS', 3.0);
    const g = this.group;
    const D = 3.2;
    g.add(platform(18, 16, { y: D, accent: C.amber }));

    this.stripes = glowUnique(C.amber, 1.2);
    // Three decanters in parallel: a conical bowl on a skid, spinning inside a
    // housing with its top cut away so you can see it go round.
    for (const z of [-5, 0, 5]) {
      const skid = box(13, 0.6, 3.0, metal(C.steelDark, 0.55, 0.9));
      skid.position.set(0, D + 0.4, z);
      g.add(skid);
      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(1.3, 1.3, 10, 24, 1, true, 0, Math.PI * 1.35),
        new THREE.MeshStandardMaterial({ color: 0x566273, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide }),
      );
      housing.rotation.z = Math.PI / 2;
      housing.rotation.x = Math.PI * 0.82;
      housing.position.set(0, D + 2.1, z);
      g.add(housing);

      const bowl = new THREE.Group();
      const cylPart = tube(1.0, 6, metal(0x9aa6b6, 0.25, 0.95), 24);
      cylPart.rotation.z = Math.PI / 2;
      cylPart.position.x = -1.5;
      bowl.add(cylPart);
      const conePart = cyl(1.0, 0.45, 3.2, metal(0x8c97a6, 0.3, 0.95), 24);
      conePart.rotation.z = -Math.PI / 2;
      conePart.position.x = 3.1;
      bowl.add(conePart);
      for (let k = 0; k < 4; k++) {
        const st = box(6, 0.08, 0.12, this.stripes);
        st.position.set(-1.5, Math.cos((k * Math.PI) / 2) * 1.01, Math.sin((k * Math.PI) / 2) * 1.01);
        st.rotation.x = (k * Math.PI) / 2;
        bowl.add(st);
      }
      bowl.position.set(0, D + 2.1, z);
      g.add(bowl);
      this.bowls.push(bowl);

      // main drive and back drive
      const motor = cyl(0.7, 0.7, 1.8, metal(0x3c4a5c, 0.4, 0.9), 18);
      motor.rotation.z = Math.PI / 2;
      motor.position.set(-6.6, D + 1.6, z);
      g.add(motor);
      const gear = box(1.2, 1.6, 1.6, metal(C.steelDark));
      gear.position.set(5.6, D + 2.1, z);
      g.add(gear);
      // cake chute out of the narrow end, down through the deck
      const chute = box(1.2, 2.0, 1.2, metal(C.steelDark));
      chute.position.set(4.2, D + 0.2, z);
      g.add(chute);
    }
    const lamp = strip(16, C.amber, 0.1, 1.8);
    lamp.position.set(0, D + 0.1, 8);
    g.add(lamp);

    this.ufFlow = flowMaterial(C.thickUf, { density: bandsFor(12), intensity: 1.6 });
    const cakeLine = tube(0.36, 12, this.ufFlow, 14);
    cakeLine.rotation.x = Math.PI / 2;
    cakeLine.position.set(4.2, 0.7, 0);
    g.add(cakeLine);
    const drop = tube(0.36, D - 0.7, this.ufFlow, 14);
    drop.position.set(0, (D - 0.7) / 2 + 0.7, 0);
    g.add(drop);
    const collector = box(4.6, 0.5, 0.8, metal(C.steelDark));
    collector.position.set(2.1, 0.7, 0);
    g.add(collector);

    this.ofFlow = flowMaterial(C.water, { density: bandsFor(9), intensity: 1.0 });
    const centrate = tube(0.28, 9, this.ofFlow, 12);
    centrate.rotation.z = Math.PI / 2;
    centrate.position.set(4.5, D + 2.0, -8.2);
    g.add(centrate);

    this.bar = new LevelBar(3.0, C.lime, 0.4);
    this.bar.group.position.set(9.3, D + 0.4, 4);
    this.bar.group.rotation.y = -Math.PI / 2;
    g.add(this.bar.group);
    this.beacon.group.position.set(9.3, D, -4);
    g.add(this.beacon.group);

    this.focus.set(0, D + 2, 0);
    this.viewOffset = new THREE.Vector3(-14, 14, 24);
    this.mountTag(D + 9);
  }

  update(t: Telemetry, dt: number) {
    const th = t.thickener;
    const on = th.underflow.solids > 1;
    // a few thousand g: drawn as a blur, not at the real 3,000 rpm
    for (const b of this.bowls) b.rotation.x += dt * (on ? 22 : 0.4);
    this.stripes.emissiveIntensity = on ? 1.6 : 0.3;
    setFlow(this.ufFlow, on ? 1.4 : 0);
    setFlow(this.ofFlow, th.overflow.water > 1 ? 2.2 : 0);
    this.bar.setLevel(clamp01(th.torque / 100), th.torque > 85 ? C.red : th.torque > 70 ? C.amber : C.lime);
    this.beacon.set(th.torque > 85 ? C.red : on ? C.lime : C.cyan, 2.2);
    this.tag.set(
      (th.ufCw * 100).toFixed(1) + '%',
      'cake  ·  ' + th.torque.toFixed(0) + '% scroll torque',
      th.torque > 85 ? 'warn' : 'ok',
    );
  }
}

export { matte, glow };
