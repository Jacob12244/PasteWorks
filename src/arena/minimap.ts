import { TEAMS, hex } from './shared/rules';
import type { Plan } from './mine/level';
import type { Base } from './shared/mine';

/**
 * The level plan in the corner, the way a mine plan is drawn: every drive
 * in outline, north up, a scale bar and a north arrow, the names of places
 * in small italics. Drawn once from the same slice through the field the
 * rock was carved from, then each frame the people and the barrows go on top.
 *
 * Your own crew is always on it. The other crew is not - a plan is not a
 * wallhack - except for a moment whenever one of them throws something,
 * which is loud underground. Both barrows are always on it: everyone
 * knows where the paste is.
 */

export interface Dot { x: number; z: number }
export interface MapView {
  me: { x: number; z: number; yaw: number; team: number; alive: boolean } | null;
  mates: Dot[];
  /** the other crew, heard recently: 0..1 for how recently */
  heard: Array<Dot & { k: number }>;
  /** both barrows: where, and how they are */
  barrows: Array<Dot & { st: string; mine: boolean }>;
  /** carrying: the stope to make for */
  target: Dot | null;
}

const X0 = -82, X1 = 82, Z0 = -48, Z1 = 48;

export class Minimap {
  canvas = document.createElement('canvas');
  private base = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private W: number;
  private H: number;
  private dpr: number;
  private t = 0;

  constructor(plan: Plan, private bases: [Base, Base], labels: Array<{ text: string; x: number; z: number }>, width = 300) {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = width;
    this.H = Math.round(width * (Z1 - Z0) / (X1 - X0));
    this.canvas.className = 'minimap';
    this.canvas.width = this.base.width = Math.round(this.W * this.dpr);
    this.canvas.height = this.base.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.g = this.canvas.getContext('2d')!;
    this.drawBase(plan, labels);
  }

  private sx(x: number) { return ((x - X0) / (X1 - X0)) * this.W; }
  private sz(z: number) { return ((z - Z0) / (Z1 - Z0)) * this.H; }

  private drawBase(plan: Plan, labels: Array<{ text: string; x: number; z: number }>) {
    const g = this.base.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    // the plan itself, cell by cell, then scaled onto the map
    const cells = document.createElement('canvas');
    cells.width = plan.w; cells.height = plan.h;
    const cg = cells.getContext('2d')!;
    const img = cg.createImageData(plan.w, plan.h);
    const at = (i: number, k: number) => (i < 0 || k < 0 || i >= plan.w || k >= plan.h ? 0 : plan.cells[k * plan.w + i]);
    for (let k = 0; k < plan.h; k++) {
      for (let i = 0; i < plan.w; i++) {
        const c = at(i, k);
        if (!c) continue;
        const edge = !at(i + 1, k) || !at(i - 1, k) || !at(i, k + 1) || !at(i, k - 1);
        const o = (k * plan.w + i) * 4;
        if (edge) { img.data.set([226, 219, 202, 235], o); }
        else if (c === 2) { img.data.set([30, 26, 22, 235], o); }
        else { img.data.set([120, 112, 98, 70], o); }
      }
    }
    cg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    const px = this.sx(plan.x0), pz = this.sz(plan.z0);
    const pw = (plan.w * plan.step / (X1 - X0)) * this.W, ph = (plan.h * plan.step / (Z1 - Z0)) * this.H;
    g.drawImage(cells, px, pz, pw, ph);

    // each crew's stope, hatched in its colour, and its fill point
    this.bases.forEach((b, t) => {
      const col = hex(TEAMS[t].col);
      g.save();
      g.translate(this.sx(b.stope.x), this.sz(b.stope.z));
      g.rotate(b.stope.rot);
      const w = (b.stope.hx * 2 / (X1 - X0)) * this.W, h = (b.stope.hz * 2 / (Z1 - Z0)) * this.H;
      g.strokeStyle = col;
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath();
      g.rect(-w / 2, -h / 2, w, h);
      g.clip();
      for (let d = -w - h; d < w + h; d += 4) {
        g.moveTo(-w / 2 + d, -h / 2);
        g.lineTo(-w / 2 + d + h, h / 2);
      }
      g.stroke();
      g.restore();
      g.fillStyle = col;
      g.fillRect(this.sx(b.home[0]) - 3, this.sz(b.home[2]) - 3, 6, 6);
    });

    // names, small and italic, as surveyors letter them
    g.font = 'italic 9px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(214,206,188,0.72)';
    for (const l of labels) g.fillText(l.text, this.sx(l.x), this.sz(l.z));
    this.bases.forEach((b, t) => {
      g.fillStyle = hex(TEAMS[t].col);
      g.font = '600 9px "Segoe UI", system-ui, sans-serif';
      const off = t ? 9 : -6;
      g.fillText(`${TEAMS[t].short} STOPE`, this.sx(b.stope.x), this.sz(b.stope.z) + off + (t ? 8 : -8));
    });

    // north arrow and a scale bar, bottom left
    const nx = 14, ny = this.H - 30;
    g.fillStyle = 'rgba(226,219,202,0.85)';
    g.beginPath();
    g.moveTo(nx, ny - 9); g.lineTo(nx + 4, ny + 4); g.lineTo(nx, ny + 1); g.lineTo(nx - 4, ny + 4); g.closePath();
    g.fill();
    g.font = '600 8px "Segoe UI", system-ui, sans-serif';
    g.fillText('N', nx, ny + 13);
    const m20 = (20 / (X1 - X0)) * this.W;
    g.fillRect(nx + 14, this.H - 10, m20, 2);
    g.fillRect(nx + 14, this.H - 13, 1, 5);
    g.fillRect(nx + 14 + m20, this.H - 13, 1, 5);
    g.textAlign = 'left';
    g.fillText('20 m', nx + 18 + m20, this.H - 7);
    g.textAlign = 'right';
    g.font = 'italic 600 9px "Segoe UI", system-ui, sans-serif';
    g.fillText('760 LEVEL  -  PLAN', this.W - 8, this.H - 7);
  }

  draw(v: MapView, dt: number) {
    this.t += dt;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    g.scale(this.dpr, this.dpr);

    // making for their stope: a pulse on it
    if (v.target) {
      const r = 6 + 5 * ((this.t * 1.4) % 1);
      g.strokeStyle = `rgba(255,255,255,${0.9 - ((this.t * 1.4) % 1) * 0.8})`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(this.sx(v.target.x), this.sz(v.target.z), r, 0, Math.PI * 2);
      g.stroke();
    }

    const team = v.me?.team ?? 0;
    // the other crew, where they were last heard
    for (const h of v.heard) {
      g.fillStyle = `rgba(255,90,60,${0.25 + 0.75 * h.k})`;
      g.beginPath();
      g.arc(this.sx(h.x), this.sz(h.z), 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = hex(TEAMS[team].col);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    for (const m of v.mates) {
      g.beginPath();
      g.arc(this.sx(m.x), this.sz(m.z), 2.8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // the barrows: a little tray in the crew's colour, blinking when it is lying about
    v.barrows.forEach((b, t) => {
      if (b.st === 'down' && Math.sin(this.t * 10) < -0.2) return;
      const x = this.sx(b.x), z = this.sz(b.z);
      g.fillStyle = hex(TEAMS[t].col);
      g.strokeStyle = '#0b0f14';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x - 5, z - 3); g.lineTo(x + 5, z - 3); g.lineTo(x + 3, z + 2); g.lineTo(x - 3, z + 2); g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(x + 3.5, z + 3.5, 1.6, 0, Math.PI * 2);
      g.fill();
      if (b.st === 'held') {
        g.strokeStyle = hex(TEAMS[t].col);
        g.globalAlpha = 0.6;
        g.beginPath();
        g.arc(x, z, 8 + 2 * Math.sin(this.t * 6), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    });

    // you: an arrow the way you face
    if (v.me) {
      const x = this.sx(v.me.x), z = this.sz(v.me.z);
      g.save();
      g.translate(x, z);
      g.rotate(-v.me.yaw);
      g.globalAlpha = v.me.alive ? 1 : 0.4;
      g.fillStyle = '#f4f7fb';
      g.strokeStyle = hex(TEAMS[team].col);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }
}
