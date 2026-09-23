import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { DESIGN } from '../sim/plant';
import { C, metal, matte, glow, glowUnique, liquor } from './palette';
import { box, cyl, tube, strip, pipeSupport, flange, Tag } from './parts';
import { flowMaterial, setFlow, bandsFor, FlowMaterial } from './flow';
import { Unit } from './units';
import type { Names } from '../scenario/types';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where the ground opens into a long-section through the orebody. */
export const CUT_X = 34;

// Stope geometry, sized to hold exactly the design volume.
export const STOPE = {
  x0: 50, x1: 70,     // 20 m
  y0: -52, y1: -32,   // 20 m
  z0: -7.5, z1: 7.5,  // 15 m  ->  6000 m3
};

/** A person, for scale. Nothing sells the size of a thickener like a human. */
export function scaleFigure(hiVis: number = C.amber): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.62, 4, 8), matte(hiVis, 0.85));
  body.position.y = 1.16;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), matte(0xd8c2a8, 0.9));
  head.position.y = 1.72;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), matte(0xffd24a, 0.7));
  hat.position.y = 1.78;
  g.add(hat);
  for (const sx of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 6), matte(0x2b3340, 0.9));
    leg.position.set(sx, 0.4, 0);
    g.add(leg);
  }
  g.castShadow = true;
  return g;
}

/** Footprint of the rock mass, so the ground can be cut away over it. */
export const ROCK = { x0: CUT_X, x1: CUT_X + 60, z0: -29, z1: 29 };

export interface GroundSpec {
  plain: number;
  pad: number;
  grid: [number, number];
  kerb: number;
  /** punch the long-section cutaway over the rock block */
  cut: boolean;
  /** a shinier pad, for a wet street */
  wet?: boolean;
}

/** A rectangle to leave out of the plain, x0 x1 z0 z1. */
export type Hole = [number, number, number, number];

/** The pad the plant stands on, plus the distant ground. */
export function buildGround(
  spec: GroundSpec = {
    plain: 0x0f141c, pad: 0x252b34, grid: [0x2f6f74, 0x1d2732], kerb: C.cyan, cut: true,
  },
  holes: Hole[] = [],
  size = 300,
): THREE.Group {
  const g = new THREE.Group();

  // Wide dark plain, with holes punched wherever something has to be seen
  // below the surface - otherwise the ground simply roofs it over.
  // Built in (x, -z) and laid down with a -90 deg turn, so the face points UP.
  // It used to be turned +90, which pointed it at the centre of the earth: the
  // plain was back-face culled from every camera and nobody could tell,
  // because it was nearly the colour of the sky behind it.
  const outline = new THREE.Shape();
  outline.moveTo(-size, size);
  outline.lineTo(size, size);
  outline.lineTo(size, -size);
  outline.lineTo(-size, -size);
  outline.closePath();

  const cuts: Hole[] = [...holes];
  if (spec.cut) cuts.push([ROCK.x0, ROCK.x1, ROCK.z0, ROCK.z1]);
  for (const [x0, x1, z0, z1] of cuts) {
    const hole = new THREE.Path();
    hole.moveTo(x0, -z0);
    hole.lineTo(x0, -z1);
    hole.lineTo(x1, -z1);
    hole.lineTo(x1, -z0);
    hole.closePath();
    outline.holes.push(hole);
  }

  const plain = new THREE.Mesh(new THREE.ShapeGeometry(outline), matte(spec.plain, 1));
  plain.rotation.x = -Math.PI / 2;  // shape (x, y) -> world (x, -y): hence the -z above
  plain.position.y = -0.4;
  plain.receiveShadow = true;
  // the ground is far bigger than anything else a walker collides with,
  // so it is let in by name rather than by size
  plain.userData.collider = true;
  g.add(plain);

  // lit collar around the cut so the section edge reads as deliberate
  if (spec.cut) {
    for (const [len, px, pz, rot] of [
      [ROCK.x1 - ROCK.x0, (ROCK.x0 + ROCK.x1) / 2, ROCK.z0, 0],
      [ROCK.x1 - ROCK.x0, (ROCK.x0 + ROCK.x1) / 2, ROCK.z1, 0],
      [ROCK.z1 - ROCK.z0, ROCK.x1, 0, Math.PI / 2],
    ] as const) {
      const lit = strip(len, spec.kerb, 0.12, 1.3);
      lit.position.set(px, 0.05, pz);
      lit.rotation.y = rot;
      g.add(lit);
    }
  }

  // engineered pad under the plant
  const padMat = spec.wet
    // wet, but not a mirror: the studio environment map is a white room, and a
    // chrome pad reflects it as a white blaze in the middle of the night
    ? new THREE.MeshStandardMaterial({ color: spec.pad, roughness: 0.38, metalness: 0.3, envMapIntensity: 0.25 })
    : matte(spec.pad, 0.98);
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(CUT_X + 84, 0.5, 74),
    padMat,
  );
  pad.position.set(-22, -0.25, 0);
  pad.receiveShadow = true;
  g.add(pad);

  // survey grid on the pad
  const grid = new THREE.GridHelper(150, 30, spec.grid[0], spec.grid[1]);
  (grid.material as THREE.Material).opacity = 0.45;
  (grid.material as THREE.Material).transparent = true;
  grid.position.set(-22, 0.02, 0);
  g.add(grid);

  // Pad kerb with a lit edge - and a gate in the south side where the path
  // from the control room comes in, because people walk to work.
  const X0 = -22 - (CUT_X + 84) / 2, X1 = -22 + (CUT_X + 84) / 2;
  const GATE = -14, GW = 3.2;
  for (const sz of [-37, 37]) {
    const runs = sz > 0 ? [[X0, GATE - GW], [GATE + GW, X1]] : [[X0, X1]];
    for (const [a, b] of runs) {
      const kerb = box(b - a, 0.45, 0.6, matte(0x30373f, 0.95));
      kerb.position.set((a + b) / 2, 0.2, sz);
      g.add(kerb);
      const lit = strip(b - a - 0.4, spec.kerb, 0.07, 1.1);
      lit.position.set((a + b) / 2, 0.44, sz);
      g.add(lit);
    }
  }
  const path = box(2 * GW - 0.4, 0.4, 9.4, matte(0x3a4048, 0.95));
  path.position.set(GATE, -0.2, 37 + 4.7);
  g.add(path);
  for (const sx of [-1, 1]) {
    const edge = strip(9.2, spec.kerb, 0.05, 0.7);
    edge.rotation.y = Math.PI / 2;
    edge.position.set(GATE + sx * (GW - 0.25), 0.02, 37 + 4.7);
    g.add(edge);
  }

  return g;
}

/**
 * The long-section: rock mass, borehole, access drive and the stope filling up.
 * Sides are back-faced so you are always looking into the cut, whichever way
 * you orbit, and the top is ghosted so the surface still reads as ground.
 */
export class Underground extends Unit {
  readonly id = 'stope';
  readonly name: string;
  private names?: Names;

  private fill: THREE.Mesh;
  private fillMat: THREE.MeshStandardMaterial;
  private surfaceGlow: THREE.Mesh;
  private ucsBar: THREE.Mesh;
  private ucsMat: THREE.MeshStandardMaterial;
  private hull!: THREE.MeshStandardMaterial;
  private massEdges!: THREE.LineSegments;

  constructor(names?: Names) {
    super(names?.destShort ?? 'STOPE 14-2 N', 3.4, '#c08f52');
    this.name = names?.dest ?? 'Stope 14-2 North';
    this.names = names;
    const g = this.group;

    const W = 60, H = 72, D = 58;
    const cx = CUT_X + W / 2;  // rock spans 34 -> 94

    // ---- rock mass as a translucent block model -------------------------
    // An inner back-faced shell gives the workings a solid dark backdrop; a
    // translucent outer hull puts rock back in FRONT of them. Together they
    // read as a section through ground rather than as an open pit.
    const inner = new THREE.MeshStandardMaterial({
      color: 0x161b23, roughness: 1, metalness: 0, side: THREE.BackSide,
    });
    const innerShell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), inner);
    innerShell.position.set(cx, -H / 2, 0);
    g.add(innerShell);

    const hull = new THREE.MeshStandardMaterial({
      color: C.rock, roughness: 0.95, metalness: 0,
      transparent: true, opacity: 0.30, side: THREE.FrontSide, depthWrite: false,
    });
    const outerHull = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), hull);
    outerHull.position.set(cx, -H / 2, 0);
    outerHull.renderOrder = 3;
    g.add(outerHull);

    // wireframe on the block so the volume has edges to read
    const massEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
      new THREE.LineBasicMaterial({ color: 0x5a6779, transparent: true, opacity: 0.35 }),
    );
    massEdges.position.copy(outerHull.position);
    g.add(massEdges);
    this.massEdges = massEdges;

    // strata banding so the rock does not read as an empty box
    for (let i = 1; i < 8; i++) {
      const y = -(H / 8) * i;
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(W, 0.35),
        matte(i % 2 ? 0x323b48 : 0x272e39, 1),
      );
      band.position.set(cx, y, -D / 2 + 0.05);
      g.add(band);
    }

    // ---- access drive from the west ------------------------------------
    const driveMat = matte(0x2a313c, 1);
    driveMat.side = THREE.BackSide;
    const drive = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 22, 12, 1, true, 0, Math.PI * 2),
      driveMat,
    );
    drive.rotation.z = Math.PI / 2;
    drive.position.set(STOPE.x0 - 11, STOPE.y0 + 2.6, 0);
    g.add(drive);

    // drive lighting - a string of lamps down the back
    for (let i = 0; i < 6; i++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glow(0xffe0a0, 2.4));
      lamp.position.set(STOPE.x0 - 20 + i * 3.6, STOPE.y0 + 4.6, -1.6);
      g.add(lamp);
    }

    // ---- stope void -----------------------------------------------------
    const sw = STOPE.x1 - STOPE.x0;
    const sh = STOPE.y1 - STOPE.y0;
    const sd = STOPE.z1 - STOPE.z0;
    const voidMat = matte(0x141a22, 1);
    voidMat.side = THREE.BackSide;
    const voidBox = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), voidMat);
    voidBox.position.set((STOPE.x0 + STOPE.x1) / 2, (STOPE.y0 + STOPE.y1) / 2, 0);
    g.add(voidBox);

    // outline the design shape in light so the target is obvious
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(sw, sh, sd)),
      new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.5 }),
    );
    edges.position.copy(voidBox.position);
    g.add(edges);

    // ---- the paste going in ---------------------------------------------
    this.fillMat = liquor(C.paste, 1);
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(sw - 0.2, 1, sd - 0.2), this.fillMat);
    this.fill.position.set((STOPE.x0 + STOPE.x1) / 2, STOPE.y0, 0);
    g.add(this.fill);

    // a brighter skin on the rising surface
    this.surfaceGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(sw - 0.2, sd - 0.2),
      glowUnique(C.amber, 0.14),
    );
    this.surfaceGlow.rotation.x = -Math.PI / 2;
    g.add(this.surfaceGlow);

    // ---- barricade at the drive ----------------------------------------
    const barricade = box(0.5, 5.2, 5.4, matte(0x6e6a60, 0.95));
    barricade.position.set(STOPE.x0 + 0.2, STOPE.y0 + 2.6, 0);
    g.add(barricade);
    const bFrame = box(0.2, 5.4, 5.6, metal(C.steelDark));
    bFrame.position.set(STOPE.x0 - 0.1, STOPE.y0 + 2.6, 0);
    g.add(bFrame);
    for (let i = 0; i < 3; i++) {
      const lit = strip(5.2, C.amber, 0.09, 1.6);
      lit.rotation.y = Math.PI / 2;
      lit.position.set(STOPE.x0 - 0.25, STOPE.y0 + 1.0 + i * 1.6, 0);
      g.add(lit);
    }

    // ---- strength readout on the stope wall ------------------------------
    const frame = box(0.2, 6.0, 0.9, matte(0x0d1118, 0.9));
    frame.position.set(STOPE.x1 + 0.3, STOPE.y0 + 4.0, -sd / 2 - 1.2);
    g.add(frame);
    this.ucsMat = glowUnique(C.lime, 2.4);
    this.ucsBar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1, 0.6), this.ucsMat);
    g.add(this.ucsBar);

    // ---- underground lighting ---------------------------------------------
    // Nothing down here sees the sun, so the cut has to carry its own light or
    // it renders as a black hole in the middle of the scene.
    const cxm = (STOPE.x0 + STOPE.x1) / 2;
    for (const [lx, ly, lz, col, inten, dist] of [
      [cxm, STOPE.y1 - 4, 0, 0xbcd4f0, 45, 34],         // stope crown
      [cxm, STOPE.y0 + 4, 0, 0xffd9a8, 38, 30],         // fill face
      [STOPE.x0 - 9, STOPE.y0 + 4, 0, 0xffe0a0, 26, 20],   // access drive
      [CUT_X + 10, -17, 0, 0x9fd8ff, 30, 22],           // borehole
      [CUT_X + 10, -40, 0, 0x9fd8ff, 26, 20],
      [CUT_X + 24, STOPE.y1 + 1, 0, 0xffe0a0, 24, 20],  // level drive
    ] as const) {
      const l = new THREE.PointLight(col, inten, dist, 2);
      l.position.set(lx, ly, lz);
      g.add(l);
    }

    this.hull = hull;
    this.focus.set((STOPE.x0 + STOPE.x1) / 2, (STOPE.y0 + STOPE.y1) / 2, 0);
    // The rock block is 60 x 72 x 58, so a bounds-derived camera distance
    // would park you outside it looking at a wall. Dive into the cut instead.
    this.viewOffset = new THREE.Vector3(-38, 20, 56);
    this.tag.group.position.set((STOPE.x0 + STOPE.x1) / 2, STOPE.y1 + 6, 0);
    this.group.add(this.tag.group);
  }

  /**
   * Rock in front of the workings has to get out of the way once you are
   * looking underground, or the section is just a grey box. Driven from how
   * far below surface the camera is actually looking.
   */
  setXray(k: number) {
    this.hull.opacity = lerpN(0.30, 0.03, clamp01(k));
    this.massEdges.visible = k < 0.75;
  }

  update(t: Telemetry, dt: number) {
    const s = t.stope;
    const sh = STOPE.y1 - STOPE.y0;
    const h = Math.max(0.06, (s.pct / 100) * sh);

    this.fill.scale.y = h;
    this.fill.position.y = STOPE.y0 + h / 2;
    this.surfaceGlow.position.set(
      (STOPE.x0 + STOPE.x1) / 2, STOPE.y0 + h + 0.02, 0,
    );
    this.surfaceGlow.visible = s.pct > 0.2;

    // the placed paste warms with the average strength achieved
    const q = clamp01(s.avgUcs / (DESIGN.targetUcs * 1.4));
    this.fillMat.color.lerpColors(new THREE.Color(0x6f6350), new THREE.Color(C.paste), q);
    this.fillMat.emissive.copy(this.fillMat.color);
    this.fillMat.emissiveIntensity = 0.22;

    const ucsFrac = clamp01(s.avgUcs / (DESIGN.targetUcs * 1.6));
    this.ucsBar.scale.y = Math.max(0.05, ucsFrac * 5.6);
    this.ucsBar.position.set(
      STOPE.x1 + 0.3,
      STOPE.y0 + 1.2 + (ucsFrac * 5.6) / 2,
      -(STOPE.z1 - STOPE.z0) / 2 - 1.2,
    );
    const ok = s.avgUcs >= DESIGN.targetUcs;
    this.ucsMat.emissive.setHex(s.pct < 1 ? C.cyan : ok ? C.lime : C.red);

    this.tag.set(
      s.pct.toFixed(1) + '%',
      s.volume.toFixed(0) + ' / ' + DESIGN.stopeVolume + ' m3',
      s.pct > 1 && !ok ? 'warn' : 'ok',
    );
  }
}

/**
 * The paste line: surface run on stanchions, the borehole column, the level
 * drive and the discharge into the stope. One continuous flow animation from
 * the pump to the fill face.
 */
export class PasteLine extends Unit {
  readonly id = 'pipeline';
  readonly name: string;

  private mats: FlowMaterial[] = [];
  private collarLamp: THREE.Mesh;
  private collarMat: THREE.MeshStandardMaterial;
  private discharge: THREE.Mesh;
  private plugMarks: THREE.Mesh[] = [];

  /** @param startX where the pump's discharge spool ends, world x */
  constructor(startX = 34.6, names?: Names) {
    super(names?.lineShort ?? 'PASTE LINE', 2.8, '#c08f52');
    this.name = names?.line ?? 'Paste Line PL-01';
    const g = this.group;
    const R = 0.34;

    const seg = (a: THREE.Vector3, b: THREE.Vector3, density: number) => {
      const len = a.distanceTo(b);
      const mat = flowMaterial(C.paste, { density: bandsFor(len), intensity: 2.0 });
      this.mats.push(mat);
      const m = tube(R, len, mat, 16);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3().subVectors(b, a).normalize(),
      );
      g.add(m);
      const f = flange(R);
      f.position.copy(b);
      f.quaternion.copy(m.quaternion);
      g.add(f);
      return m;
    };

    // surface run from the pump to the borehole collar
    const a0 = new THREE.Vector3(startX, 2.3, 0);
    const a1 = new THREE.Vector3(CUT_X + 10, 2.3, 0);
    seg(a0, a1, 40);
    for (let x = startX + 1.5; x < CUT_X + 9; x += 5) {
      const s = pipeSupport(1.9);
      s.position.set(x, 0, 0);
      g.add(s);
    }

    // collar headworks
    const collar = box(3.2, 3.6, 3.2, metal(C.steelDark, 0.55, 0.9));
    collar.position.set(CUT_X + 10, 1.8, 0);
    g.add(collar);
    this.collarMat = glowUnique(C.cyan, 2.4);
    this.collarLamp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.14), this.collarMat);
    this.collarLamp.position.set(CUT_X + 10, 3.7, 1.6);
    g.add(this.collarLamp);

    // choke / knife gate station at the collar - this is what holds a
    // free-flowing column back
    const choke = cyl(0.62, 0.62, 1.1, metal(0x55606f, 0.4, 0.92), 18);
    choke.position.set(CUT_X + 10, 0.4, 0);
    g.add(choke);
    const chokeWheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 18), metal(C.amber, 0.5, 0.6));
    chokeWheel.position.set(CUT_X + 10, 0.4, 1.0);
    g.add(chokeWheel);

    // borehole column down through the rock
    const b0 = new THREE.Vector3(CUT_X + 10, 1.6, 0);
    const b1 = new THREE.Vector3(CUT_X + 10, STOPE.y1 + 2, 0);
    seg(b0, b1, 300);

    // cased hole around the column
    const casing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, b0.y - b1.y, 14, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x2a313b, roughness: 0.9, metalness: 0.3, side: THREE.BackSide,
      }),
    );
    casing.position.set(CUT_X + 10, (b0.y + b1.y) / 2, 0);
    g.add(casing);

    // level drive across to the stope, then the discharge spool
    const c0 = b1.clone();
    const c1 = new THREE.Vector3(CUT_X + 14, STOPE.y1 + 1, 0);
    const c2 = new THREE.Vector3((STOPE.x0 + STOPE.x1) / 2, STOPE.y1 + 1, 0);
    const c3 = new THREE.Vector3((STOPE.x0 + STOPE.x1) / 2, STOPE.y1 - 1.6, 0);
    seg(c0, c1, 30);
    seg(c1, c2, 60);
    this.discharge = seg(c2, c3, 20);

    // hangers along the level drive
    for (let x = CUT_X + 16; x < STOPE.x0; x += 6) {
      const hang = box(0.12, 1.6, 0.12, metal(C.steel));
      hang.position.set(x, STOPE.y1 + 1.8, 0);
      g.add(hang);
    }

    // pressure tap indicators along the run - they go red where it plugs
    for (const [x, y] of [[40, 3.2], [CUT_X + 10, -12], [CUT_X + 10, -26], [52, STOPE.y1 + 2.2]] as const) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glowUnique(C.lime, 2.2));
      m.position.set(x, y, 0.5);
      this.plugMarks.push(m);
      g.add(m);
    }

    this.focus.set(CUT_X + 10, -14, 0);
    this.viewOffset = new THREE.Vector3(-34, 14, 48);
    this.tag.group.position.set(CUT_X + 10, 9.5, 0);
    g.add(this.tag.group);
  }

  update(t: Telemetry, dt: number) {
    const p = t.pipe;
    const v = p.plugged ? 0 : p.velocity;
    // the line only carries material once the stope has started taking it
    const fill = t.pump.flow > 0.5 ? 1 : clamp01(t.stope.pct * 8);
    for (const m of this.mats) setFlow(m, v, fill, t.pump.flow > 0.5 ? 1 : 0);

    const tone = p.plugged ? C.red : p.plugRisk > 0.4 ? C.amber : v > 0.1 ? C.lime : C.cyan;
    this.collarMat.emissive.setHex(tone);
    for (const m of this.plugMarks) {
      (m.material as THREE.MeshStandardMaterial).emissive.setHex(tone);
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity =
        p.plugged ? 3 + Math.sin(t.time * 8) * 2 : 2.2;
    }

    this.tag.set(
      p.plugged ? 'PLUGGED' : v.toFixed(2) + ' m/s',
      p.gradient.toFixed(1) + ' kPa/m  ' + p.regime,
      p.plugged ? 'trip' : p.plugRisk > 0.4 ? 'warn' : 'ok',
    );
  }
}
