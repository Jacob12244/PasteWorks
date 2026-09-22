import * as THREE from 'three';
import { C, metal, matte, glow, glowUnique } from './palette';

/**
 * Procedural industrial building blocks. Everything in the plant is made from
 * these, so there is no asset pipeline - the whole thing is code.
 */

// ----------------------------------------------------------------- textures

let gratingTex: THREE.Texture | null = null;

/** Open steel grating, drawn once to a canvas and tiled. */
export function grating(): THREE.Texture {
  if (gratingTex) return gratingTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#20262f';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#48525f';
  g.lineWidth = 3;
  for (let i = 0; i <= s; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke();
  }
  g.strokeStyle = '#39424e';
  g.lineWidth = 2;
  for (let i = 0; i <= s; i += 32) {
    g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke();
  }
  gratingTex = new THREE.CanvasTexture(c);
  gratingTex.wrapS = gratingTex.wrapT = THREE.RepeatWrapping;
  gratingTex.colorSpace = THREE.SRGBColorSpace;
  return gratingTex;
}

let hazardTex: THREE.Texture | null = null;

/** Diagonal hazard stripes for kerbs and guards. */
export function hazard(): THREE.Texture {
  if (hazardTex) return hazardTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d222b';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#ffab3d';
  g.lineWidth = 10;
  for (let i = -s; i < s * 2; i += 26) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke();
  }
  hazardTex = new THREE.CanvasTexture(c);
  hazardTex.wrapS = hazardTex.wrapT = THREE.RepeatWrapping;
  hazardTex.colorSpace = THREE.SRGBColorSpace;
  return hazardTex;
}

// -------------------------------------------------------------- primitives

export function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function cyl(
  rTop: number, rBot: number, h: number, mat: THREE.Material,
  segs = 32, open = false,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, open), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function tube(r: number, len: number, mat: THREE.Material, segs = 16): THREE.Mesh {
  return cyl(r, r, len, mat, segs);
}

/** A raised flange ring, the detail that makes pipework read as pipework. */
export function flange(r: number, mat = metal(C.steelLight)): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.32, r * 1.32, r * 0.26, 24), mat);
  m.castShadow = true;
  return m;
}

/** Emissive strip - the thing that makes it look like 2075 rather than 1975. */
export function strip(len: number, color: number = C.cyan, w = 0.12, intensity = 2.4): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(len, w, w), glow(color, intensity));
}

// ----------------------------------------------------------------- assembly

export interface PlatformOpts {
  /** deck height above local origin */
  y?: number;
  rails?: boolean;
  legs?: boolean;
  /** leave one side open for a walkway or a chute */
  openSides?: Array<'n' | 's' | 'e' | 'w'>;
  accent?: number;
}

/** A grated access platform with edge beams, handrails and legs. */
export function platform(w: number, d: number, opts: PlatformOpts = {}): THREE.Group {
  const { y = 0, rails = true, legs = true, openSides = [], accent = C.cyan } = opts;
  const g = new THREE.Group();

  const tex = grating().clone();
  tex.needsUpdate = true;
  tex.repeat.set(w / 2, d / 2);
  const deckMat = new THREE.MeshStandardMaterial({
    map: tex, color: 0xffffff, roughness: 0.8, metalness: 0.7,
  });

  const deck = box(w, 0.18, d, deckMat);
  deck.position.y = y;
  g.add(deck);

  // edge beams
  const beam = metal(C.steelDark, 0.6, 0.9);
  for (const [bw, bd, bx, bz] of [
    [w + 0.3, 0.55, 0, d / 2],
    [w + 0.3, 0.55, 0, -d / 2],
  ] as const) {
    const b = box(bw, bd, 0.3, beam);
    b.position.set(bx, y - 0.3, bz);
    g.add(b);
  }
  for (const sz of [1, -1]) {
    const b = box(0.3, 0.55, d, beam);
    b.position.set((sz * w) / 2, y - 0.3, 0);
    g.add(b);
  }

  if (rails) {
    const sides: Array<['n' | 's' | 'e' | 'w', number, number, number, number]> = [
      ['n', w, 0, d / 2, 0],
      ['s', w, 0, -d / 2, 0],
      ['e', d, w / 2, 0, Math.PI / 2],
      ['w', d, -w / 2, 0, Math.PI / 2],
    ];
    for (const [id, len, px, pz, rot] of sides) {
      if (openSides.includes(id)) continue;
      const r = railing(len, accent);
      r.position.set(px, y + 0.09, pz);
      r.rotation.y = rot;
      g.add(r);
    }
  }

  if (legs) {
    const legMat = metal(C.steel, 0.65, 0.9);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const l = box(0.34, y, 0.34, legMat);
        l.position.set((sx * (w / 2 - 0.5)), y / 2, (sz * (d / 2 - 0.5)));
        g.add(l);
        // knee brace
        const br = box(0.18, Math.hypot(y, 1.6), 0.18, legMat);
        br.position.set(sx * (w / 2 - 1.1), y / 2, sz * (d / 2 - 1.1));
        br.rotation.z = (sx * -Math.atan2(1.6, y));
        g.add(br);
      }
    }
  }

  return g;
}

/** Handrail run: two rails, posts, kickplate and a lit top rail. */
export function railing(len: number, accent: number = C.cyan): THREE.Group {
  const g = new THREE.Group();
  const mat = metal(C.steelLight, 0.5, 0.9);

  const top = tube(0.045, len, mat, 8);
  top.rotation.z = Math.PI / 2;
  top.position.y = 1.1;
  g.add(top);

  const mid = tube(0.035, len, mat, 8);
  mid.rotation.z = Math.PI / 2;
  mid.position.y = 0.6;
  g.add(mid);

  const kick = box(len, 0.16, 0.05, metal(C.steelDark));
  kick.position.y = 0.1;
  g.add(kick);

  const n = Math.max(2, Math.round(len / 2.2));
  for (let i = 0; i <= n; i++) {
    const p = tube(0.04, 1.1, mat, 6);
    p.position.set(-len / 2 + (len * i) / n, 0.55, 0);
    g.add(p);
  }

  const lit = strip(len * 0.98, accent, 0.05, 0.85);
  lit.position.set(0, 1.145, 0);
  g.add(lit);

  return g;
}

/** Caged access ladder. */
export function ladder(h: number): THREE.Group {
  const g = new THREE.Group();
  const mat = metal(C.steelLight, 0.5, 0.9);
  for (const sx of [-0.28, 0.28]) {
    const r = tube(0.04, h, mat, 6);
    r.position.set(sx, h / 2, 0);
    g.add(r);
  }
  const rungs = Math.floor(h / 0.35);
  for (let i = 1; i < rungs; i++) {
    const r = tube(0.028, 0.56, mat, 6);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, i * 0.35, 0);
    g.add(r);
  }
  // safety cage hoops
  for (let y = 2.2; y < h; y += 0.9) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.025, 6, 20, Math.PI * 1.15),
      mat,
    );
    hoop.rotation.set(Math.PI / 2, 0, -Math.PI * 0.075);
    hoop.position.set(0, y, 0.1);
    g.add(hoop);
  }
  return g;
}

/** Vertical stiffener ribs around a tank shell. */
export function ribs(r: number, h: number, n = 10, mat = metal(C.steelDark)): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rib = box(0.12, h, 0.3, mat);
    rib.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    rib.rotation.y = -a;
    g.add(rib);
  }
  return g;
}

/** Hoop bands around a tank or silo. */
export function bands(r: number, ys: number[], mat = metal(C.steelDark)): THREE.Group {
  const g = new THREE.Group();
  for (const y of ys) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.09, 8, 40), mat);
    t.rotation.x = Math.PI / 2;
    t.position.y = y;
    g.add(t);
  }
  return g;
}

/**
 * A pipe run through a list of waypoints, with flanges at each vertex.
 * Returns the mesh plus the curve, so flow animation can follow the same path.
 */
export function pipeRun(
  pts: THREE.Vector3[], radius: number, mat: THREE.Material,
  opts: { flanges?: boolean; segs?: number; closed?: boolean } = {},
): { mesh: THREE.Mesh; curve: THREE.CatmullRomCurve3; group: THREE.Group } {
  const { flanges = true, segs = Math.max(24, pts.length * 14), closed = false } = opts;
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.04);
  const geo = new THREE.TubeGeometry(curve, segs, radius, 14, closed);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  if (flanges) {
    for (let i = 1; i < pts.length - 1; i++) {
      const f = flange(radius);
      f.position.copy(pts[i]);
      const dir = new THREE.Vector3().subVectors(pts[i + 1], pts[i - 1]).normalize();
      f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      group.add(f);
    }
  }
  return { mesh, curve, group };
}

/** Pipe support saddle on a stanchion. */
export function pipeSupport(h: number, w = 1.2): THREE.Group {
  const g = new THREE.Group();
  const mat = metal(C.steel, 0.65, 0.9);
  const post = box(0.26, h, 0.26, mat);
  post.position.y = h / 2;
  g.add(post);
  const cap = box(w, 0.16, 0.5, mat);
  cap.position.y = h;
  g.add(cap);
  return g;
}

// -------------------------------------------------------------- indicators

/**
 * A vertical level bar on the side of a vessel. Call setLevel(0..1) each frame.
 * This is how the player reads every inventory in the plant without a HUD.
 */
export class LevelBar {
  group = new THREE.Group();
  private fill: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private h: number;

  constructor(height: number, color: number = C.cyan, width = 0.34) {
    this.h = height;
    const back = box(width, height, 0.1, matte(0x0d1118, 0.9));
    back.position.y = height / 2;
    this.group.add(back);

    const frame = box(width + 0.12, height + 0.12, 0.06, metal(C.steelDark));
    frame.position.set(0, height / 2, -0.04);
    this.group.add(frame);

    this.mat = glowUnique(color, 2.6);
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 1, 0.13), this.mat);
    this.group.add(this.fill);
    this.setLevel(0);

    // tick marks at 25 / 50 / 75
    for (const f of [0.25, 0.5, 0.75]) {
      const t = box(width + 0.22, 0.035, 0.12, metal(C.steelLight));
      t.position.set(0, height * f, 0.02);
      this.group.add(t);
    }
  }

  setLevel(frac: number, color?: number) {
    const f = Math.max(0.001, Math.min(1, frac));
    this.fill.scale.y = this.h * f;
    this.fill.position.y = (this.h * f) / 2;
    if (color !== undefined) this.mat.emissive.setHex(color);
  }
}

/** Stack light / alarm beacon. */
export class Beacon {
  group = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private light: THREE.PointLight;

  constructor(color: number = C.lime) {
    const post = tube(0.06, 1.0, metal(C.steelDark), 8);
    post.position.y = 0.5;
    this.group.add(post);
    this.mat = glowUnique(color, 3);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), this.mat);
    dome.position.y = 1.1;
    this.group.add(dome);
    this.light = new THREE.PointLight(color, 3, 9, 2);
    this.light.position.y = 1.1;
    this.group.add(this.light);
  }

  set(color: number, intensity = 3) {
    this.mat.emissive.setHex(color);
    this.mat.emissiveIntensity = intensity;
    this.light.color.setHex(color);
    this.light.intensity = intensity;
  }
}

// ------------------------------------------------------------------- tags

const TAG_W = 512;
const TAG_H = 208;

/**
 * A floating holographic equipment tag. Each unit carries one showing its
 * single most important live number, so the plant is readable without
 * opening a panel.
 */
export class Tag {
  sprite: THREE.Sprite;
  group = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private last = '';

  constructor(
    private title: string,
    height = 3.2,
    private accent = '#35e0d0',
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TAG_W;
    this.canvas.height = TAG_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;

    const mat = new THREE.SpriteMaterial({
      map: this.tex, transparent: true, depthTest: true, depthWrite: false,
    });
    this.sprite = new THREE.Sprite(mat);
    const w = (TAG_W / TAG_H) * height;
    this.sprite.scale.set(w, height, 1);
    this.sprite.center.set(0.5, 0);
    this.group.add(this.sprite);

    // leader line down to the unit
    const line = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1, 6),
      glow(0x35e0d0, 1.2),
    );
    line.position.y = -0.5;
    this.group.add(line);

    this.set('--', '');
  }

  set(value: string, sub = '', tone: 'ok' | 'warn' | 'trip' = 'ok') {
    const key = value + '|' + sub + '|' + tone;
    if (key === this.last) return;
    this.last = key;

    const g = this.ctx;
    const accent = tone === 'trip' ? '#ff5a3c' : tone === 'warn' ? '#ffab3d' : this.accent;
    g.clearRect(0, 0, TAG_W, TAG_H);

    // panel
    g.fillStyle = 'rgba(8,13,20,0.82)';
    roundRect(g, 6, 6, TAG_W - 12, TAG_H - 12, 14);
    g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 3;
    g.stroke();

    // accent bar
    g.fillStyle = accent;
    g.fillRect(6, 6, 9, TAG_H - 12);

    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(190,206,228,0.85)';
    g.font = '600 30px ui-monospace, "Cascadia Mono", Consolas, monospace';
    g.fillText(this.title.toUpperCase(), 34, 54);

    g.fillStyle = '#f2f6ff';
    g.font = '700 84px ui-monospace, "Cascadia Mono", Consolas, monospace';
    g.fillText(value, 34, 140);

    if (sub) {
      g.fillStyle = accent;
      g.font = '600 30px ui-monospace, "Cascadia Mono", Consolas, monospace';
      g.fillText(sub, 34, 182);
    }

    this.tex.needsUpdate = true;
  }
}

function roundRect(
  g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
