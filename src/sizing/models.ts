import * as THREE from 'three';
import { C, metal, matte, glow } from '../view/palette';
import { box, cyl, strip, bands } from '../view/parts';

/**
 * The machines the sizing game builds, drawn from their sizes.
 *
 * Every one is rebuilt from its dimensions rather than scaled, so a jaw twice
 * as wide keeps its plate thicknesses and its handrails stay handrails. The
 * dimensions ease towards whatever the sliders say, and the machine is rebuilt
 * on each frame of the ease: drag a slider and the machine grows.
 */

type Dims = Record<string, number>;

/** A machine not built yet: a blueprint of where it will stand. */
const BLUEPRINT = new THREE.MeshStandardMaterial({
  color: 0x0b2a2e, emissive: 0x35e0d0, emissiveIntensity: 0.35,
  transparent: true, opacity: 0.22, depthWrite: false, roughness: 1, metalness: 0,
});

const PAINT = 0xb86a2c;      // crusher and mill paint: the maker's orange
const LINER = 0x3a3d42;      // manganese and rubber
const ORE = 0x6d6457;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export abstract class Machine {
  /** placed by the site; never rebuilt */
  group = new THREE.Group();
  /** everything drawn from the dimensions; rebuilt as they change */
  protected body = new THREE.Group();
  protected shown: Dims = {};
  private target: Dims = {};
  private dirty = true;
  /** materials and textures made for one build, released with it */
  private owned: Array<{ dispose(): void }> = [];

  protected own<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  constructor() {
    this.group.add(this.body);
  }

  /** New sizes. The first call lands at once; later ones ease in. */
  set(d: Dims) {
    const first = Object.keys(this.shown).length === 0;
    this.target = { ...d };
    if (first) this.shown = { ...d };
    this.dirty = true;
  }

  get dims(): Dims {
    return this.shown;
  }

  private _ghost = false;
  /** drawn as a blueprint until its station is reached */
  set ghost(on: boolean) {
    if (on === this._ghost) return;
    this._ghost = on;
    this.dirty = true;
  }

  tick(dt: number, t: number) {
    const k = 1 - Math.exp(-dt * 9);
    let moving = false;
    for (const key of Object.keys(this.target)) {
      const to = this.target[key];
      const from = this.shown[key] ?? to;
      const next = Math.abs(to - from) < Math.abs(to) * 1e-3 + 1e-4 ? to : from + (to - from) * k;
      if (next !== from) moving = true;
      this.shown[key] = next;
    }
    if (moving || this.dirty) {
      this.dirty = false;
      this.rebuild();
    }
    this.animate(dt, t);
  }

  private rebuild() {
    for (const child of [...this.body.children]) {
      this.body.remove(child);
      child.traverse((o) => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      });
    }
    for (const x of this.owned) x.dispose();
    this.owned = [];
    this.build(this.shown);
    if (this._ghost) {
      this.body.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.material = BLUEPRINT; m.castShadow = false; }
      });
    }
  }

  protected abstract build(d: Dims): void;
  protected animate(_dt: number, _t: number) {}

  /** Top of the machine, for the tag. */
  abstract height(): number;
}

function along(mesh: THREE.Object3D, axis: 'x' | 'z'): THREE.Object3D {
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  else mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// ================================================================ grizzly

/** A vibrating grizzly over the dump pocket: bars at the aperture, so you can count them close. */
export class Grizzly extends Machine {
  private deck = new THREE.Group();
  static readonly W = 2.6;
  static readonly L = 6.5;

  protected build(d: Dims) {
    const a = d.aperture;
    const W = Grizzly.W, L = Grizzly.L;
    this.deck = new THREE.Group();
    this.deck.rotation.z = -0.17;
    for (const s of [-1, 1]) {
      const side = box(L, 0.7, 0.12, metal(PAINT, 0.5, 0.6));
      side.position.set(0, 0.2, s * (W / 2 + 0.06));
      this.deck.add(side);
    }
    const bar = 0.07;
    const n = Math.max(2, Math.floor((W + a) / (a + bar)));
    const span = n * bar + (n - 1) * a;
    for (let i = 0; i < n; i++) {
      const b = box(L - 0.3, 0.22, bar, metal(C.steelLight, 0.4, 0.9));
      b.position.set(0, 0.25, -span / 2 + bar / 2 + i * (a + bar));
      this.deck.add(b);
    }
    // springs
    for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) {
      for (const s of [-1, 1]) {
        const sp = cyl(0.12, 0.12, 0.5, metal(C.amber, 0.5, 0.4), 10);
        sp.position.set(x, -0.35, s * (W / 2 + 0.06));
        this.deck.add(sp);
      }
    }
    this.body.add(this.deck);
    this.body.userData.bars = n;
  }

  protected animate(_dt: number, t: number) {
    this.deck.position.y = Math.sin(t * 60) * 0.015;
  }

  height() {
    return 1.2;
  }
}

// ================================================================ jaw

/**
 * A single-toggle jaw crusher, drawn from its feed opening (gape x width) and
 * its closed side setting: the chamber narrows from the gape at the top to the
 * setting at the bottom, and the swing jaw rocks on its eccentric.
 */
export class JawCrusher extends Machine {
  private swing = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private chamberTop = 0;

  protected build(d: Dims) {
    const W = d.width, G = d.gape, css = d.css;
    const Ls = 2.3 * G + 1.3;
    const Hs = 2.0 * G + 0.9;
    const t = 0.14 + 0.1 * G;
    const paint = metal(PAINT, 0.5, 0.55);
    const dark = metal(C.steelDark, 0.6, 0.8);
    this.wheels = [];

    const plinth = box(Ls + 1.6, 0.9, W + 2 * t + 2.2, matte(C.concrete));
    plinth.position.y = 0.45;
    this.body.add(plinth);
    const y0 = 0.9;

    for (const s of [-1, 1]) {
      const side = box(Ls, Hs, t, paint);
      side.position.set(0, y0 + Hs / 2, s * (W / 2 + t / 2));
      this.body.add(side);
      // stiffening ribs on the outside of each cheek plate
      for (const x of [-Ls * 0.3, 0, Ls * 0.3]) {
        const rib = box(0.1, Hs * 0.8, 0.14, paint);
        rib.position.set(x, y0 + Hs * 0.45, s * (W / 2 + t + 0.07));
        this.body.add(rib);
      }
    }
    const front = box(0.55, Hs, W, paint);
    front.position.set(Ls / 2 - 0.28, y0 + Hs / 2, 0);
    this.body.add(front);
    const back = box(0.5, Hs * 0.55, W, paint);
    back.position.set(-Ls / 2 + 0.25, y0 + Hs * 0.35, 0);
    this.body.add(back);

    // fixed jaw liner, then the swing jaw: the gap between them is the chamber
    const faceX = Ls / 2 - 0.6;
    const fixed = box(0.16, Hs * 0.92, W * 0.96, metal(LINER, 0.7, 0.6));
    fixed.position.set(faceX, y0 + Hs * 0.5, 0);
    this.body.add(fixed);

    this.swing = new THREE.Group();
    const pivot = V(faceX - G - 0.25, y0 + Hs, 0);
    this.swing.position.copy(pivot);
    const hBot = V(faceX - css - 0.25, y0 + 0.25, 0);
    const len = pivot.distanceTo(hBot);
    const plate = box(0.5, len, W * 0.95, metal(LINER, 0.7, 0.6));
    const ang = Math.atan2(pivot.x - hBot.x, pivot.y - hBot.y);
    plate.position.set(-Math.sin(ang) * len / 2, -Math.cos(ang) * len / 2, 0);
    plate.rotation.z = ang;
    this.swing.add(plate);
    this.body.add(this.swing);

    // eccentric shaft and the two flywheels
    const rf = 0.62 * G + 0.45;
    const shaft = along(cyl(0.12 + 0.08 * G, 0.12 + 0.08 * G, W + 2 * t + 1.1, dark, 16), 'z');
    shaft.position.copy(pivot);
    this.body.add(shaft);
    for (const s of [-1, 1]) {
      const wheel = new THREE.Group();
      const disc = along(cyl(rf, rf, 0.22 + 0.08 * G, metal(C.steel, 0.5, 0.8), 36), 'z');
      wheel.add(disc);
      const rim = along(cyl(rf * 1.02, rf * 1.02, 0.1, metal(C.amber, 0.4, 0.5), 36, true), 'z');
      wheel.add(rim);
      for (let k = 0; k < 4; k++) {
        const spoke = box(rf * 1.7, 0.12, 0.26 + 0.08 * G, dark);
        spoke.rotation.z = (k * Math.PI) / 4;
        wheel.add(spoke);
      }
      wheel.position.set(pivot.x, pivot.y, s * (W / 2 + t + 0.3 + 0.1 * G));
      this.body.add(wheel);
      this.wheels.push(wheel);
    }

    // motor on its slide base behind, belted to one flywheel
    const motor = along(cyl(0.35 + 0.1 * G, 0.35 + 0.1 * G, 1.0 + 0.4 * G, metal(C.panel, 0.5, 0.6), 20), 'z');
    motor.position.set(-Ls / 2 - 1.2, y0 + 0.5, W / 2 + t + 0.8);
    this.body.add(motor);
    const belt = box(Math.hypot(pivot.x - motor.position.x, pivot.y - motor.position.y), 0.12, 0.3, matte(C.rubber));
    belt.position.set((pivot.x + motor.position.x) / 2, (pivot.y + motor.position.y) / 2, W / 2 + t + 0.3 + 0.1 * G);
    belt.rotation.z = Math.atan2(pivot.y - motor.position.y, pivot.x - motor.position.x);
    this.body.add(belt);

    // feed hopper: flared plates above the chamber
    const hop = new THREE.Group();
    for (const s of [-1, 1]) {
      const p = box(G + 1.2, 1.4, 0.1, dark);
      p.position.set(faceX - G / 2 - 0.25, y0 + Hs + 0.6, s * (W / 2 + 0.35));
      p.rotation.x = s * 0.35;
      hop.add(p);
    }
    this.body.add(hop);

    // the setting, lit, so a tighter crusher reads as a thinner line
    const slot = box(Math.max(0.03, css), 0.05, W * 0.9, glow(C.amber, 1.8));
    slot.position.set(faceX - css / 2 - 0.1, y0 + 0.2, 0);
    this.body.add(slot);

    this.chamberTop = y0 + Hs + 1.4;
  }

  protected animate(dt: number, t: number) {
    for (const w of this.wheels) w.rotation.z -= dt * 2.6;
    this.swing.rotation.z = Math.sin(t * 2.6) * 0.012;
  }

  height() {
    return this.chamberTop;
  }
}

// ================================================================ cone

/** A cone crusher on its support steel, drawn from its head diameter; the setting shows as the lit gap at the bottom of the bowl. */
export class ConeCrusher extends Machine {
  private top = new THREE.Group();
  private sheave = new THREE.Object3D();
  private h = 0;

  protected build(d: Dims) {
    const D = d.head, css = d.css;
    const paint = metal(PAINT, 0.5, 0.55);
    const dark = metal(C.steelDark, 0.6, 0.8);
    const base = 3.2; // support steel so the product belt runs underneath

    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const leg = box(0.35, base, 0.35, metal(C.steel));
      leg.position.set(x * (0.8 * D + 0.4), base / 2, z * (0.8 * D + 0.4));
      this.body.add(leg);
    }
    const deck = box(1.6 * D + 1.4, 0.3, 1.6 * D + 1.4, metal(C.steel));
    deck.position.y = base;
    this.body.add(deck);

    const frameH = 0.55 * D;
    const main = cyl(0.62 * D, 0.66 * D, frameH, paint, 40);
    main.position.y = base + frameH / 2;
    this.body.add(main);
    this.body.add(bands(0.63 * D, [base + frameH * 0.3, base + frameH * 0.75], dark));

    // the setting: a lit ring whose thickness is the closed side setting
    const gap = cyl(0.5 * D, 0.5 * D, Math.max(0.02, css * 2), glow(C.amber, 1.6), 40);
    gap.position.y = base + frameH + css;
    this.body.add(gap);

    this.top = new THREE.Group();
    const ring = cyl(0.72 * D, 0.72 * D, 0.14 * D, paint, 40);
    ring.position.y = 0.07 * D;
    this.top.add(ring);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const cylr = cyl(0.04 * D, 0.04 * D, 0.2 * D, metal(C.amber, 0.5, 0.4), 8);
      cylr.position.set(Math.cos(a) * 0.68 * D, 0.1 * D, Math.sin(a) * 0.68 * D);
      this.top.add(cylr);
    }
    const bowl = cyl(0.42 * D, 0.62 * D, 0.32 * D, paint, 40);
    bowl.position.y = 0.3 * D;
    this.top.add(bowl);
    const hopper = cyl(0.46 * D, 0.34 * D, 0.36 * D, dark, 32, true);
    hopper.position.y = 0.64 * D;
    this.top.add(hopper);
    const feed = cyl(0.33 * D, 0.33 * D, 0.03, matte(ORE), 24);
    feed.position.y = 0.52 * D;
    this.top.add(feed);
    this.top.position.y = base + frameH + css * 2;
    this.body.add(this.top);

    // countershaft, sheave, motor
    const cs = along(cyl(0.12 * D, 0.12 * D, 0.9 * D, dark, 16), 'x');
    cs.position.set(0.9 * D, base + 0.3 * D, 0);
    this.body.add(cs);
    this.sheave = along(cyl(0.3 * D, 0.3 * D, 0.12 * D, metal(C.steel), 24), 'x');
    this.sheave.position.set(1.4 * D, base + 0.3 * D, 0);
    this.body.add(this.sheave);
    const motor = box(0.6 * D, 0.55 * D, 0.55 * D, metal(C.panel, 0.5, 0.6));
    motor.position.set(1.4 * D, base + 0.3 * D, 1.1 * D);
    this.body.add(motor);

    this.h = base + frameH + 0.9 * D;
  }

  protected animate(dt: number, t: number) {
    this.sheave.rotation.x += dt * 8;
    this.top.rotation.x = Math.sin(t * 5) * 0.004;
    this.top.rotation.z = Math.cos(t * 5) * 0.004;
  }

  height() {
    return this.h;
  }
}

// ================================================================ screens

const meshCache = new Map<number, THREE.CanvasTexture>();

/** Woven wire at an aperture: one tile of it, repeated over the deck. */
function wireTexture(): THREE.CanvasTexture {
  const key = 1;
  const hit = meshCache.get(key);
  if (hit) return hit;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0f14';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#7d8896';
  g.fillRect(0, 0, s, 10);
  g.fillRect(0, 0, 10, s);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  meshCache.set(key, tex);
  return tex;
}

/**
 * Inclined vibrating screens side by side on a deck: width, length and how
 * many come off the sliders, and the wire on each deck is woven at the
 * aperture, so a coarser screen reads as coarser mesh.
 */
export class ScreenBank extends Machine {
  private decks: THREE.Group[] = [];

  protected build(d: Dims) {
    const W = d.width, L = d.length, n = Math.max(1, Math.round(d.count)), a = d.aperture;
    const paint = metal(C.panel, 0.5, 0.6);
    const gap = 1.4;
    const span = n * W + (n - 1) * gap;
    const deckY = 7.5;
    this.decks = [];

    // support structure and the deck the screens stand on
    const floorW = span + 3, floorL = L + 4;
    const floor = box(floorL, 0.3, floorW, metal(C.steel));
    floor.position.y = deckY;
    this.body.add(floor);
    for (const x of [-floorL / 2 + 0.3, floorL / 2 - 0.3]) {
      for (const z of [-floorW / 2 + 0.3, floorW / 2 - 0.3]) {
        const leg = box(0.4, deckY, 0.4, metal(C.steel));
        leg.position.set(x, deckY / 2, z);
        this.body.add(leg);
      }
    }
    const rail = strip(floorL, C.handrail, 0.06, 0.4);
    rail.position.set(0, deckY + 1.1, floorW / 2);
    this.body.add(rail);

    // the wire, woven at the aperture: one tile is one opening and its wire
    const tex = this.own(wireTexture().clone());
    tex.needsUpdate = true;
    const pitch = a + 0.35 * a + 0.002;
    tex.repeat.set(L / pitch, W / pitch);
    const deckMat = this.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.7 }));

    for (let i = 0; i < n; i++) {
      const z = -span / 2 + W / 2 + i * (W + gap);
      const scr = new THREE.Group();
      scr.position.set(0, deckY + 1.4, z);
      scr.rotation.z = -0.3;
      for (const s of [-1, 1]) {
        const side = box(L, 1.0, 0.1, paint);
        side.position.set(0, 0.3, s * (W / 2 + 0.05));
        scr.add(side);
      }
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(L, W), deckMat);
      deck.rotation.x = -Math.PI / 2;
      deck.receiveShadow = true;
      scr.add(deck);
      const beam = along(cyl(0.18, 0.18, W + 0.6, metal(C.steelDark), 12), 'z');
      beam.position.set(0, 1.0, 0);
      scr.add(beam);
      for (const s of [-1, 1]) {
        const ex = along(cyl(0.34, 0.34, 0.5, metal(PAINT, 0.5, 0.5), 18), 'z');
        ex.position.set(0, 1.0, s * (W / 2 + 0.4));
        scr.add(ex);
      }
      for (const x of [-L / 2 + 0.4, L / 2 - 0.4]) {
        for (const s of [-1, 1]) {
          const spring = cyl(0.14, 0.14, 0.5, metal(C.amber, 0.5, 0.4), 10);
          spring.position.set(x, -0.4, s * (W / 2 + 0.05));
          scr.add(spring);
        }
      }
      this.body.add(scr);
      this.decks.push(scr);
    }
  }

  protected animate(_dt: number, t: number) {
    for (let i = 0; i < this.decks.length; i++) {
      this.decks[i].position.y = 7.5 + 1.4 + Math.sin(t * 55 + i) * 0.02;
    }
  }

  height() {
    return 11;
  }
}

// ================================================================ ball mill

let ballTex: THREE.CanvasTexture | null = null;

/** Packed balls, drawn once: the charge reads as steel balls, not a steel block. */
function ballTexture(): THREE.CanvasTexture {
  if (ballTex) return ballTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1e22';
  g.fillRect(0, 0, s, s);
  const r = 15;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const x = col * 32 + (row % 2 ? 16 : 0), y = row * 28 + 8;
      for (const dx of [0, -s, s]) {
        const grad = g.createRadialGradient(x + dx - 5, y - 5, 2, x + dx, y, r);
        grad.addColorStop(0, '#e4e8ee');
        grad.addColorStop(0.5, '#8d949e');
        grad.addColorStop(1, '#30353c');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x + dx, y, r, 0, Math.PI * 2); g.fill();
      }
    }
  }
  ballTex = new THREE.CanvasTexture(c);
  ballTex.wrapS = ballTex.wrapT = THREE.RepeatWrapping;
  ballTex.colorSpace = THREE.SRGBColorSpace;
  return ballTex;
}

/** The share of a circle's area below a chord, as a function of the angle it subtends. */
function segmentAngle(fill: number): number {
  let lo = 0, hi = 2 * Math.PI;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if ((m - Math.sin(m)) / (2 * Math.PI) < fill) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * An overflow ball mill on its trunnions: diameter and length off the sliders,
 * the motor sized to the power it draws. With the cutaway on, a window in the
 * shell shows the ball charge filled to J and thrown up the rising side.
 */
export class BallMill extends Machine {
  private gear = new THREE.Group();
  private charge?: THREE.Mesh;
  cutaway = false;
  private axisY = 0;

  protected build(d: Dims) {
    const D = d.diameter, L = d.length, J = d.filling, kW = d.power;
    const R = D / 2;
    const paint = metal(PAINT, 0.5, 0.55);
    const dark = metal(C.steelDark, 0.6, 0.8);
    this.axisY = R + 1.5;
    const y = this.axisY;

    // shell, open towards the camera (+z, a little above the axis) when the
    // cutaway is on: painted outside, rubber-lined inside
    const window = this.cutaway ? 1.7 : 0;
    const centre = 0.45;
    const arc = (r: number, side: THREE.Side, colour: number) => {
      const geo = new THREE.CylinderGeometry(r, r, L, 56, 1, true, centre + window / 2, 2 * Math.PI - window);
      const m = new THREE.Mesh(geo, this.own(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6, metalness: 0.4, side })));
      m.castShadow = m.receiveShadow = true;
      along(m, 'x');
      m.position.y = y;
      return m;
    };
    this.body.add(arc(R, THREE.FrontSide, PAINT), arc(R * 0.985, THREE.BackSide, 0x4a525c));
    // shell flanges
    for (const x of [-L / 2, 0, L / 2]) {
      const fl = along(cyl(R + 0.08, R + 0.08, 0.16, dark, 56, true), 'x');
      fl.position.set(x, y, 0);
      this.body.add(fl);
    }

    // heads, trunnions, bearings
    const tr = Math.max(0.35, 0.17 * D);
    for (const s of [-1, 1]) {
      const head = along(cyl(s < 0 ? tr : R, s < 0 ? R : tr, 0.22 * D, paint, 48), 'x');
      head.position.set(s * (L / 2 + 0.11 * D), y, 0);
      this.body.add(head);
      const trun = along(cyl(tr, tr, 1.1, dark, 24), 'x');
      trun.position.set(s * (L / 2 + 0.22 * D + 0.55), y, 0);
      this.body.add(trun);
      const ped = box(1.3, y - tr + 0.1, 1.6 + 0.2 * D, matte(C.concrete));
      ped.position.set(s * (L / 2 + 0.22 * D + 0.55), (y - tr + 0.1) / 2, 0);
      this.body.add(ped);
      const cap = box(1.5, 0.7, 1.4 + 0.25 * D, metal(C.steel));
      cap.position.set(s * (L / 2 + 0.22 * D + 0.55), y - tr + 0.2, 0);
      this.body.add(cap);
    }
    // feed chute and discharge trommel
    const chute = box(1.2, 2.4, 1.2, dark);
    chute.position.set(-(L / 2 + 0.22 * D + 1.6), y + 0.8, 0);
    chute.rotation.z = -0.5;
    this.body.add(chute);
    const trommel = along(cyl(tr * 1.1, tr * 1.1, 2.0, metal(C.steel), 24, true), 'x');
    trommel.position.set(L / 2 + 0.22 * D + 2.0, y, 0);
    this.body.add(trommel);

    // girth gear, pinion and a motor sized to the power drawn
    this.gear = new THREE.Group();
    const gear = along(cyl(R + 0.4, R + 0.4, 0.4, metal(C.steelLight, 0.4, 0.9), 64, true), 'x');
    this.gear.add(gear);
    for (let i = 0; i < 24; i++) {
      const tooth = box(0.42, 0.18, 0.18, dark);
      const a = (i / 24) * Math.PI * 2;
      tooth.position.set(0, Math.cos(a) * (R + 0.45), Math.sin(a) * (R + 0.45));
      this.gear.add(tooth);
    }
    this.gear.position.set(L / 2 - 0.9, y, 0);
    this.body.add(this.gear);
    const guard = box(1.0, R + 0.8, 2 * R + 1.4, metal(C.handrail, 0.6, 0.3));
    guard.position.set(L / 2 - 0.9, (R + 0.8) / 2, 0);
    this.body.add(guard);
    const s = Math.cbrt(Math.max(200, kW) / 3000);
    const motor = along(cyl(1.2 * s, 1.2 * s, 3.0 * s, metal(C.panel, 0.5, 0.6), 24), 'x');
    motor.position.set(L / 2 + 1.5 + 1.5 * s, 1.2 * s + 0.6, R + 1.8 + 1.2 * s);
    this.body.add(motor);
    const mbase = box(3.4 * s + 2, 0.6, 2.6 * s + 0.4, matte(C.concrete));
    mbase.position.set(motor.position.x - 0.5, 0.3, motor.position.z);
    this.body.add(mbase);
    const shaft = along(cyl(0.18, 0.18, R + 1.8, dark, 12), 'z');
    shaft.position.set(L / 2 - 0.9, 1.2 * s + 0.6, (R + 1.8) / 2 + 0.4);
    this.body.add(shaft);

    // the charge, visible through the window
    this.charge = undefined;
    if (this.cutaway) {
      const theta = segmentAngle(Math.min(0.5, Math.max(0.05, J)));
      const shape = new THREE.Shape();
      const r = R * 0.94;
      const a0 = -Math.PI / 2 - theta / 2;
      shape.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
      shape.absarc(0, 0, r, a0, a0 + theta, false);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: L * 0.96, bevelEnabled: false, curveSegments: 32 });
      geo.translate(0, 0, -L * 0.48);
      const tex = this.own(ballTexture().clone());
      tex.needsUpdate = true;
      tex.repeat.set(1.6, 1.6);
      const m = new THREE.Mesh(geo, this.own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.6 })));
      m.rotation.y = Math.PI / 2;
      // the charge rides up the rising side of a turning mill
      m.rotateZ(-0.55);
      m.position.set(0, y, 0);
      m.castShadow = true;
      this.body.add(m);
      this.charge = m;
      // the window's edges, lit
      for (const a of [centre + window / 2, centre - window / 2]) {
        const edge = box(L, 0.06, 0.06, glow(C.cyan, 1.4));
        edge.position.set(0, y + Math.sin(a) * R, Math.cos(a) * R);
        this.body.add(edge);
      }
    }
  }

  protected animate(dt: number) {
    // 75% of critical speed: 42.3/sqrt(D) rpm at critical
    const D = this.shown.diameter ?? 5;
    const w = (0.75 * 42.3 / Math.sqrt(D)) * (Math.PI * 2 / 60);
    this.gear.rotation.x -= dt * w;
  }

  setCutaway(on: boolean) {
    if (on === this.cutaway) return;
    this.cutaway = on;
    this.set({ ...this.dims });
  }

  height() {
    return this.axisY + (this.shown.diameter ?? 5) / 2 + 0.5;
  }
}

// ================================================================ cyclones

/**
 * A cyclone cluster on its tower: a ring of cyclones of the chosen diameter
 * around the feed distributor, the ring growing to fit as many as are in use.
 */
export class CycloneCluster extends Machine {
  private h = 0;

  protected build(d: Dims) {
    const Dc = d.diameter, n = Math.max(1, Math.round(d.count));
    const R = Math.max(1.2, (n * Dc * 2.1) / (2 * Math.PI) + 0.4);
    const deckY = 9;
    const dark = metal(C.steelDark, 0.6, 0.8);
    const rubber = matte(0x2a2f36, 0.8);

    // tower
    const size = 2 * R + 3;
    const deck = box(size, 0.3, size, metal(C.steel));
    deck.position.y = deckY;
    this.body.add(deck);
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const leg = box(0.45, deckY, 0.45, metal(C.steel));
      leg.position.set(x * (size / 2 - 0.3), deckY / 2, z * (size / 2 - 0.3));
      this.body.add(leg);
    }
    for (const s of [-1, 1]) {
      const r1 = strip(size, C.handrail, 0.06, 0.4);
      r1.position.set(0, deckY + 1.1, s * size / 2);
      this.body.add(r1);
    }

    // distributor and the rings: overflow above, underflow launder below
    const top = deckY + 0.4 + 4.2 * Dc;
    const dist = cyl(Math.max(0.45, R - 1.1 * Dc), Math.max(0.45, R - 1.1 * Dc), 1.2 * Dc + 0.6, metal(C.steelLight, 0.5, 0.8), 32);
    dist.position.y = top - 0.4 * Dc;
    this.body.add(dist);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.08 + 0.12 * Dc, 10, 64), metal(C.steelLight, 0.5, 0.8));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = top + 0.9 * Dc + 0.3;
    this.body.add(ring);
    const launder = new THREE.Mesh(new THREE.TorusGeometry(R, 0.22, 8, 64), metal(C.steel, 0.6, 0.7));
    launder.rotation.x = Math.PI / 2;
    launder.position.y = deckY + 0.6;
    this.body.add(launder);

    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
      const cy = new THREE.Group();
      cy.position.set(cx, 0, cz);
      const barrel = cyl(Dc / 2, Dc / 2, Dc, metal(C.steelLight, 0.4, 0.8), 20);
      barrel.position.y = top;
      cy.add(barrel);
      const cone = cyl(Dc / 2, 0.08 * Dc + 0.02, 3.0 * Dc, rubber, 20);
      cone.position.y = top - Dc / 2 - 1.5 * Dc;
      cy.add(cone);
      const vf = cyl(0.18 * Dc, 0.18 * Dc, 0.9 * Dc + 0.3, metal(C.steel), 12);
      vf.position.y = top + 0.45 * Dc + 0.15;
      cy.add(vf);
      const inlet = box(0.8 * Dc + 0.3, 0.3 * Dc, 0.25 * Dc, dark);
      inlet.position.set(-Math.cos(a) * 0.4 * Dc, top + 0.2 * Dc, -Math.sin(a) * 0.4 * Dc);
      inlet.rotation.y = -a;
      cy.add(inlet);
      this.body.add(cy);
    }

    // sump and pump at the foot of the tower
    const sump = box(3.2, 2.4, 3.2, metal(C.steelDark));
    sump.position.set(-size / 2 - 2.5, 1.2, 0);
    this.body.add(sump);
    const riser = cyl(0.18 + 0.1 * Dc, 0.18 + 0.1 * Dc, top - 1.2, metal(C.steel), 12);
    riser.position.set(-size / 2 - 0.9, (top - 1.2) / 2 + 0.6, 0);
    this.body.add(riser);

    this.h = top + 1.5 * Dc + 1.4;
  }

  height() {
    return this.h;
  }
}

export { V };
