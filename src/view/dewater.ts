/**
 * The machines that stand where the thickener would, on sites where a
 * thickener cannot work.
 *
 *   CycloneBank   on the seabed - no settling tank makes sense when the whole
 *                 site is underwater, so the water comes out inline.
 *   SpinRing      on Psyche - a thickener settles under gravity, and at
 *                 0.015 g there is none worth having, so this one is built
 *                 inside a ring and spun until it makes its own.
 *   MagStack      under Meridian - there is no floor for an 18 m tank in a
 *                 canyon a block wide, so seeded flocs are pulled down a
 *                 column of coils instead.
 *
 * All three are the unit with id 'thickener', so the consoles treat them as
 * the dewatering stage without having to know which one it is. Each exposes
 * where its underflow and overflow leave, so the site pipework lands on them.
 */
import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { C, metal, matte, glow, glowUnique, glass, liquor } from './palette';
import { box, cyl, tube, platform, ladder, LevelBar, Beacon } from './parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from './flow';
import { FX, Spout } from './particles';
import { Unit } from './units';

export interface Dewaterer extends Unit {
  /** where the underflow (or cake) leaves, local */
  ufOut: THREE.Vector3;
  /** where the overflow (or centrate) leaves, local */
  ofOut: THREE.Vector3;
  /** where the feed arrives, local - the cyclone bank's route predates this */
  feedIn?: THREE.Vector3;
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

// =============================================================== SPIN RING

/**
 * A thickener built inside a spinning ring, for a site with no gravity worth
 * settling in. The ring turns at its real speed - ten rpm is a revolution
 * every six seconds - and the solids pack against the outer wall, where the
 * gravity is. Its top is glass, because an open channel in a vacuum would
 * boil dry; through it you can see the bed build against the rim.
 *
 * Feed goes in at the crown and both products come out through a rotary
 * union in the mast. Load it with a heavy, uneven bed and spin it hard, and
 * it wobbles.
 */
export class SpinRing extends Unit implements Dewaterer {
  readonly id = 'thickener';
  readonly name = 'Spin-Ring Thickener';
  feedIn = new THREE.Vector3(0, 13.4, 0);
  ufOut = new THREE.Vector3(0, 0.7, 0);
  /** out of the crown, above the spokes - anything lower is in their way */
  ofOut = new THREE.Vector3(2.2, 9.8, 0);

  /** turns at the ring's rpm */
  private rotor = new THREE.Group();
  /** tilts the rotor when it is out of balance */
  private wobble = new THREE.Group();
  private liquorMat: THREE.MeshStandardMaterial;
  private bed: THREE.Mesh;
  private bedW = -1;
  private lamps: THREE.MeshStandardMaterial;
  private union: THREE.MeshStandardMaterial;
  private ufFlow: FlowMaterial;
  private ofFlow: FlowMaterial;
  private bar: LevelBar;
  private beacon = new Beacon();
  private angle = 0;

  private readonly R = DESIGN.ringRadius;
  private readonly Y = 7.4;
  /** inner and outer walls of the settling channel */
  private readonly RI = DESIGN.ringRadius - 1.3;
  private readonly RO = DESIGN.ringRadius + 1.3;

  constructor() {
    super('SPIN RING', 3.0, '#ffab3d');
    const g = this.group;
    const { Y, RI, RO } = this;

    // ---- the static part: plinth, mast, raking struts, bearings --------
    const pad = cyl(4.2, 4.6, 0.6, matte(C.concrete, 0.95), 8);
    pad.position.y = 0.3;
    g.add(pad);
    const mast = cyl(0.8, 1.05, Y - 1.6, metal(C.steelLight, 0.45, 0.9), 20);
    mast.position.y = (Y - 1.6) / 2 + 0.6;
    g.add(mast);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const foot = new THREE.Vector3(Math.cos(a) * 3.5, 0.6, Math.sin(a) * 3.5);
      const head = new THREE.Vector3(Math.cos(a) * 1.25, Y - 2.1, Math.sin(a) * 1.25);
      const len = foot.distanceTo(head);
      const strut = box(0.32, len, 0.32, metal(C.steel, 0.6, 0.9));
      strut.position.copy(foot).lerp(head, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), head.clone().sub(foot).normalize());
      g.add(strut);
    }
    const lower = cyl(1.8, 1.8, 0.7, metal(C.steelDark, 0.5, 0.9), 28);
    lower.position.y = Y - 1.9;
    g.add(lower);
    this.union = glowUnique(C.cyan, 1.6);
    const unionRing = new THREE.Mesh(new THREE.TorusGeometry(1.82, 0.09, 8, 36), this.union);
    unionRing.rotation.x = Math.PI / 2;
    unionRing.position.y = Y - 1.6;
    g.add(unionRing);
    const crown = cyl(1.2, 1.5, 0.8, metal(C.steelDark, 0.5, 0.9), 24);
    crown.position.y = Y + 2.0;
    g.add(crown);
    const feedDrop = tube(0.34, 13.4 - (Y + 2.4), metal(C.steelDark), 12);
    feedDrop.position.y = (13.4 + Y + 2.4) / 2;
    g.add(feedDrop);

    // ---- the rotor: channel, glass lid, liquor, bed, hub, spokes --------
    // The channel is a lathe of its own cross-section: inner wall, floor,
    // outer wall. The lid is glass.
    const profile = [
      new THREE.Vector2(RI, 1.1), new THREE.Vector2(RI, -0.9),
      new THREE.Vector2(RI + 0.3, -1.1), new THREE.Vector2(RO - 0.3, -1.1),
      new THREE.Vector2(RO, -0.9), new THREE.Vector2(RO, 1.1),
    ];
    const channel = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 96),
      new THREE.MeshStandardMaterial({
        color: 0x6b7280, roughness: 0.4, metalness: 0.9, side: THREE.DoubleSide,
      }),
    );
    channel.castShadow = channel.receiveShadow = true;
    this.rotor.add(channel);
    const lid = new THREE.Mesh(new THREE.RingGeometry(RI, RO, 96, 1), glass(0xffe2b8, 0.12));
    lid.rotation.x = -Math.PI / 2;
    lid.position.y = 1.1;
    this.rotor.add(lid);
    for (const [r, y] of [[RO, 1.1], [RO, -0.9], [RI, 1.1]] as const) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 96), metal(C.steelDark, 0.5, 0.9));
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = y;
      this.rotor.add(hoop);
    }

    this.liquorMat = liquor(C.water, 0.9);
    const surf = new THREE.Mesh(new THREE.RingGeometry(RI + 0.05, RO - 0.05, 96, 1), this.liquorMat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 0.55;
    this.rotor.add(surf);
    this.bed = new THREE.Mesh(new THREE.RingGeometry(RO - 0.3, RO - 0.05, 96, 1), liquor(C.tails, 1));
    this.bed.rotation.x = -Math.PI / 2;
    this.bed.position.y = 0.62;
    this.rotor.add(this.bed);

    // running lights round the rim, spaced so the turning reads from anywhere
    this.lamps = glowUnique(C.amber, 1.8);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const lamp = box(1.2, 0.22, 0.1, this.lamps);
      lamp.position.set(Math.cos(a) * (RO + 0.06), 0.1, Math.sin(a) * (RO + 0.06));
      lamp.rotation.y = -a + Math.PI / 2;
      this.rotor.add(lamp);
    }

    const hub = cyl(1.45, 1.45, 3.2, metal(C.steelLight, 0.4, 0.9), 28);
    this.rotor.add(hub);
    const hubBand = new THREE.Mesh(new THREE.TorusGeometry(1.47, 0.08, 8, 32), this.lamps);
    hubBand.rotation.x = Math.PI / 2;
    this.rotor.add(hubBand);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const span = RI - 1.45;
      const spoke = box(span, 0.42, 0.5, metal(C.steel, 0.5, 0.9));
      spoke.position.set(Math.cos(a) * (1.45 + span / 2), -0.4, Math.sin(a) * (1.45 + span / 2));
      spoke.rotation.y = -a;
      this.rotor.add(spoke);
      // stays from the top of the hub out to the inner wall
      const top = new THREE.Vector3(Math.cos(a) * 1.2, 1.6, Math.sin(a) * 1.2);
      const rim = new THREE.Vector3(Math.cos(a) * RI, 1.0, Math.sin(a) * RI);
      const stay = tube(0.07, top.distanceTo(rim), metal(C.steelLight), 6);
      stay.position.copy(top).lerp(rim, 0.5);
      stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rim.clone().sub(top).normalize());
      this.rotor.add(stay);
    }
    this.wobble.add(this.rotor);
    this.wobble.position.y = Y;
    // it turns, so nothing on it is anything to stand on
    this.wobble.userData.noCollide = true;
    g.add(this.wobble);

    // ---- products out through the mast ---------------------------------
    this.ufFlow = flowMaterial(C.thickUf, { density: bandsFor(Y), intensity: 1.6 });
    const ufLine = tube(0.28, Y - 2.4, this.ufFlow, 12);
    ufLine.position.set(1.2, (Y - 2.4) / 2 + 0.2, 0.9);
    g.add(ufLine);
    this.ofFlow = flowMaterial(C.water, { density: bandsFor(3), intensity: 1.0 });
    const ofLine = tube(0.26, 1.2, this.ofFlow, 12);
    ofLine.rotation.z = Math.PI / 2;
    ofLine.position.set(1.6, 9.8, 0);
    g.add(ofLine);

    // access: a platform round the mast, and a ladder up to it
    const deck = platform(5.2, 5.2, { y: 4.4, accent: C.amber, legs: false });
    g.add(deck);
    const lad = ladder(4.6);
    lad.position.set(-2.6, 0.6, 1.2);
    lad.rotation.y = Math.PI / 2;
    g.add(lad);

    this.bar = new LevelBar(3.0, C.lime, 0.4);
    this.bar.group.position.set(3.4, 0.6, -2.2);
    this.bar.group.rotation.y = -Math.PI / 4;
    g.add(this.bar.group);
    this.beacon.group.position.set(-3.2, 0.6, -2.4);
    g.add(this.beacon.group);

    this.focus.set(0, Y, 0);
    this.viewOffset = new THREE.Vector3(-18, 16, 26);
    this.mountTag(Y + 7.5);
  }

  update(t: Telemetry, dt: number) {
    const th = t.thickener;
    const on = th.underflow.solids > 1;
    // gravity at the rim is w^2.r, so the rim's g gives the speed back
    const omega = Math.sqrt((Math.max(th.g, 0) * 9.81) / this.R);
    this.angle = (this.angle + dt * omega) % (Math.PI * 2);
    this.rotor.rotation.y = this.angle;

    // Out of balance, the spin axis precesses: it tilts toward the heavy side,
    // and the heavy side goes round with the ring.
    const amp = clamp01((th.torque - 55) / 45) * 0.045;
    this.wobble.rotation.x = Math.sin(this.angle) * amp;
    this.wobble.rotation.z = Math.cos(this.angle) * amp;

    // the bed packs out from the rim as it builds
    const w = 0.25 + 1.9 * clamp01(th.bedPct / 110);
    if (Math.abs(w - this.bedW) > 0.04) {
      this.bedW = w;
      this.bed.geometry.dispose();
      this.bed.geometry = new THREE.RingGeometry(this.RO - 0.05 - w, this.RO - 0.05, 96, 1);
    }
    const muddy = clamp01((th.overflowClarity - 50) / 2500);
    this.liquorMat.color.lerpColors(new THREE.Color(C.water), new THREE.Color(C.tails), muddy);
    this.liquorMat.emissive.copy(this.liquorMat.color);

    this.lamps.emissiveIntensity = omega > 0.05 ? 1.9 : 0.3;
    this.union.emissiveIntensity = on ? 1.8 + Math.sin(t.time * 4) * 0.3 : 0.4;
    setFlow(this.ufFlow, on ? 1.4 : 0);
    setFlow(this.ofFlow, th.overflow.water > 1 ? 2.2 : 0);

    const trip = th.torque > 92, warn = th.torque > 78;
    this.bar.setLevel(clamp01(th.torque / 100), trip ? C.red : warn ? C.amber : C.lime);
    this.beacon.set(trip ? C.red : warn || muddy > 0.15 ? C.amber : on ? C.lime : C.cyan, trip ? 5 : 2.2);
    this.tag.set(
      (th.ufCw * 100).toFixed(1) + '%',
      'U/F  ·  ' + th.g.toFixed(2) + ' g  ·  ' + th.torque.toFixed(0) + '% imbalance',
      trip ? 'trip' : warn || muddy > 0.15 ? 'warn' : 'ok',
    );
  }
}

// ========================================================== MAGNETIC STACK

/**
 * A magnetic settling stack, four storeys tall where a thickener would want
 * a city block. Flocculant carrying fine magnetite goes in at the top, and a
 * column of coils pulls the flocs down many times faster than they would
 * fall: the clear water leaves over the launder at the top, the thickened
 * underflow from the cone at the bottom, and a drum magnet at the foot takes
 * the magnetite back out of it to be used again.
 *
 * The coils glow with the field and go from magenta to amber as they heat.
 * A slot of glass up one side shows the flocs falling and the blanket
 * building at the bottom.
 */
export class MagStack extends Unit implements Dewaterer {
  readonly id = 'thickener';
  readonly name = 'Magnetic Settling Stack';
  feedIn = new THREE.Vector3(0, 21.2, 0);
  ufOut = new THREE.Vector3(0, 0.7, 0);
  ofOut = new THREE.Vector3(4.4, 17.4, 0);

  private coils: THREE.MeshStandardMaterial;
  private blanket: THREE.Mesh;
  private drum = new THREE.Group();
  private ufFlow: FlowMaterial;
  private ofFlow: FlowMaterial;
  private bus: THREE.MeshStandardMaterial;
  private bar: LevelBar;
  private beacon = new Beacon();
  private flocs?: Spout;
  private heat?: Spout;
  private _w = new THREE.Vector3();

  private readonly R = DESIGN.stackDia / 2;
  /** top of the cone, and the top of the column */
  private readonly H0 = 3.4;
  private readonly H1 = 18.2;

  constructor() {
    super('MAG STACK', 3.0, '#ff4fd8');
    const g = this.group;
    const { R, H0, H1 } = this;

    // cone on a ring beam, and the frame that carries the column
    const cone = cyl(R, 0.5, H0 - 0.8, metal(C.steelDark, 0.55, 0.9), 32);
    cone.position.y = 0.8 + (H0 - 0.8) / 2;
    g.add(cone);
    const frame = platform(R * 2 + 2.4, R * 2 + 2.4, { y: H1 + 0.2, accent: 0xff4fd8 });
    g.add(frame);
    for (const y of [H0, H0 + 5, H0 + 10]) {
      const tie = platform(R * 2 + 2.4, R * 2 + 2.4, { y, rails: false, legs: false });
      tie.children[0].visible = false;   // just the ring of edge beams, no deck
      g.add(tie);
    }

    // The column: steel, with a slot of glass up the side facing the plant.
    const GAP = 0.7;
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H1 - H0, 40, 1, true, Math.PI / 2 + GAP / 2, Math.PI * 2 - GAP),
      new THREE.MeshStandardMaterial({ color: 0x3d3a4a, roughness: 0.5, metalness: 0.85, side: THREE.DoubleSide }),
    );
    shell.position.y = (H0 + H1) / 2;
    shell.castShadow = shell.receiveShadow = true;
    g.add(shell);
    const pane = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.02, R + 0.02, H1 - H0 - 0.4, 8, 1, true, Math.PI / 2 - GAP / 2, GAP),
      glass(0xffc8f0, 0.14),
    );
    pane.position.y = (H0 + H1) / 2;
    g.add(pane);

    // what is inside: murky liquor, and the blanket of settled floc
    const inside = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.1, R - 0.1, H1 - H0 - 0.6, 24),
      liquor(0x4a4a5a, 0.55),
    );
    inside.position.y = (H0 + H1) / 2 - 0.2;
    g.add(inside);
    this.blanket = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.12, R - 0.12, 1, 24), liquor(C.thickUf, 1));
    g.add(this.blanket);

    // Seven coils up the column. Each is a dark can with a lit band round it -
    // the band is what shows the field, and the heat.
    this.coils = glowUnique(0xff4fd8, 1.6);
    for (let i = 0; i < 7; i++) {
      const y = H0 + 1.4 + (i * (H1 - H0 - 2.8)) / 6;
      const can = new THREE.Mesh(new THREE.TorusGeometry(R + 0.42, 0.4, 10, 40), metal(0x2a2733, 0.45, 0.8));
      can.rotation.x = Math.PI / 2;
      can.position.y = y;
      g.add(can);
      const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.84, 0.07, 6, 48), this.coils);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      g.add(band);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const clamp = box(0.3, 1.0, 0.3, metal(C.steelLight));
        clamp.position.set(Math.cos(a) * (R + 0.42), y, Math.sin(a) * (R + 0.42));
        g.add(clamp);
      }
    }

    // top: overflow launder ring, feedwell drop, and a downcomer to the rack
    const launder = new THREE.Mesh(new THREE.TorusGeometry(R + 0.3, 0.35, 8, 40), metal(C.steelDark));
    launder.rotation.x = Math.PI / 2;
    launder.position.y = H1 - 0.2;
    g.add(launder);
    const well = tube(0.36, 21.2 - (H1 - 1.2), metal(C.steelDark), 12);
    well.position.y = (21.2 + H1 - 1.2) / 2;
    g.add(well);
    this.ofFlow = flowMaterial(C.water, { density: bandsFor(2), intensity: 1.0 });
    const of = tube(0.28, 1.6, this.ofFlow, 12);
    of.rotation.z = Math.PI / 2;
    of.position.set(R + 0.8, 17.4, 0);
    g.add(of);

    // busbar up the side from the rectifier, lit when the coils are on
    const rect = box(2.0, 2.4, 1.4, metal(0x2c2440, 0.5, 0.7));
    rect.position.set(-R - 2.6, 1.2, 2.4);
    g.add(rect);
    this.bus = glowUnique(0xff4fd8, 1.2);
    const busbar = box(0.14, H1 - 1.4, 0.3, this.bus);
    busbar.position.set(-R - 1.0, (H1 - 1.4) / 2 + 1.2, 2.0);
    g.add(busbar);
    const feeder = box(1.6, 0.14, 0.3, this.bus);
    feeder.position.set(-R - 1.8, 2.3, 2.0);
    g.add(feeder);

    // Underflow out of the cone, past the drum magnet that takes the seed
    // back, and away to the surge tank.
    this.ufFlow = flowMaterial(C.thickUf, { density: bandsFor(3), intensity: 1.6 });
    const ufDown = tube(0.3, 0.6, this.ufFlow, 12);
    ufDown.position.set(0, 0.6, 0);
    g.add(ufDown);
    const drumBody = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 24), metal(0x5a5070, 0.35, 0.9));
    drumBody.rotation.x = Math.PI / 2;
    this.drum.add(drumBody);
    for (let k = 0; k < 6; k++) {
      const s = box(0.08, 0.1, 2.24, glowUnique(0xff4fd8, 1.4));
      const a = (k / 6) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.91, Math.sin(a) * 0.91, 0);
      s.rotation.z = a;
      this.drum.add(s);
    }
    this.drum.position.set(R + 1.6, 1.4, -1.8);
    this.drum.userData.noCollide = true;
    g.add(this.drum);
    const trough = box(2.6, 0.5, 2.6, metal(C.steelDark));
    trough.position.set(R + 1.6, 0.4, -1.8);
    g.add(trough);

    const lad = ladder(H1 + 0.4);
    lad.position.set(0, 0, -R - 1.2);
    g.add(lad);

    this.bar = new LevelBar(3.0, C.lime, 0.4);
    this.bar.group.position.set(-R - 2.6, 2.6, 3.2);
    g.add(this.bar.group);
    this.beacon.group.position.set(-R - 3.4, 2.4, 1.6);
    g.add(this.beacon.group);

    this.focus.set(0, 9, 0);
    this.viewOffset = new THREE.Vector3(-18, 12, 28);
    this.mountTag(H1 + 4.2);
  }

  update(t: Telemetry, dt: number, fx: FX) {
    const th = t.thickener;
    const on = th.underflow.solids > 1;
    const running = t.status !== 'idle' && t.status !== 'blocked';
    const heat = clamp01((th.torque - 40) / 55);

    // the field, and how hot it is making the coils
    this.coils.emissiveIntensity = running ? 0.5 + 2.2 * th.field + Math.sin(t.time * 9) * 0.08 : 0.25;
    this.coils.emissive.setRGB(1, 0.37 + 0.3 * heat, 0.85 - 0.7 * heat);
    this.bus.emissiveIntensity = running ? 0.6 + 1.2 * th.field : 0.2;

    // the blanket of settled floc at the bottom of the column
    const h = 0.4 + 5.5 * clamp01(th.bedPct / 110);
    this.blanket.scale.y = h;
    this.blanket.position.y = this.H0 + h / 2;

    this.drum.rotation.z -= dt * (on ? 2.4 : 0);
    setFlow(this.ufFlow, on ? 1.4 : 0);
    setFlow(this.ofFlow, th.overflow.water > 1 ? 2.2 : 0);

    // flocs falling past the glass, faster the harder the field pulls them
    this.flocs ??= new Spout(fx.liquid, 30, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, -2.5, 0),
      spread: new THREE.Vector3(0.1, 0.8, 0.1),
      jitter: new THREE.Vector3(0.6, 1.5, 0.3),
      colour: C.thickUf, size: 0.14, sizeVary: 0.4,
      life: 2.2, gravity: -2, drag: 0.9,
    }));
    this._w.set(0, this.H1 - 3, this.R - 0.4).applyMatrix4(this.group.matrixWorld);
    this.flocs.run(dt, on ? 0.3 + th.field : 0, this._w);

    // and a shimmer off the coils when they are running hot
    this.heat ??= new Spout(fx.haze, 5, (at) => ({
      at, count: 0,
      velocity: new THREE.Vector3(0, 0.6, 0),
      spread: new THREE.Vector3(0.3, 0.2, 0.3),
      jitter: new THREE.Vector3(this.R + 0.5, 3, this.R + 0.5),
      colour: 0xffb080, size: 1.0, sizeVary: 0.4,
      life: 2.5, gravity: 0.2, drag: 0.6, grow: 2,
    }));
    this._w.set(0, 11, 0).applyMatrix4(this.group.matrixWorld);
    this.heat.run(dt, running && heat > 0.55 ? heat : 0, this._w);

    const muddy = clamp01((th.overflowClarity - 50) / 2500);
    const trip = th.torque > 92, warn = th.torque > 78;
    this.bar.setLevel(clamp01(th.torque / 100), trip ? C.red : warn ? C.amber : C.lime);
    this.beacon.set(trip ? C.red : warn || muddy > 0.15 ? C.amber : on ? C.lime : C.cyan, trip ? 5 : 2.2);
    this.tag.set(
      (th.ufCw * 100).toFixed(1) + '%',
      'U/F  ·  ' + th.field.toFixed(2) + ' T  ·  coils ' + th.torque.toFixed(0) + '%',
      trip ? 'trip' : warn || muddy > 0.15 ? 'warn' : 'ok',
    );
  }
}

export { matte, glow };
