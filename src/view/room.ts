/**
 * What is actually in the control room, apart from the screens.
 *
 * Turning your head is only worth doing if there is something to turn it
 * towards, so both end walls carry the things that accumulate on the walls of
 * every real control room: a safety sign nobody has reset, printouts that
 * were funny once, a whiteboard, a clock, and a plant that died some time in
 * the last quarter.
 *
 * One of them is live. The days-since sign is wired to the blockage counter,
 * which turns out to be the most honest instrument in the building.
 */

import * as THREE from 'three';
import type { Telemetry } from '../sim/plant';
import { C, metal, matte, glow } from './palette';
import { box, cyl, tube } from './parts';
import type { WorldKind } from '../scenario/types';

type Draw = (g: CanvasRenderingContext2D, W: number, H: number) => void;

/**
 * A printed sheet on a wall. Lit like paper but with a little emissive of its
 * own, because the room is dark enough that an honestly-lit poster would be
 * unreadable from the chair.
 */
function sheet(w: number, h: number, draw: Draw, px = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = Math.round((px * h) / w);
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const redraw = () => { draw(g, canvas.width, canvas.height); tex.needsUpdate = true; };
  redraw();

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.07,
      roughness: 0.96, metalness: 0,
    }),
  );
  return { mesh, redraw };
}

/** Centre a line of text, shrinking it until it fits the width given. */
function line(
  g: CanvasRenderingContext2D, text: string, x: number, y: number,
  size: number, maxW: number, font = '"Arial Black", Impact, sans-serif',
) {
  let s = size;
  do {
    g.font = '700 ' + s + 'px ' + font;
    s -= 1;
  } while (g.measureText(text).width > maxW && s > 8);
  g.fillText(text, x, y);
}

// --------------------------------------------------------------- the posters

/** The sign every site has, and nobody dares photograph on a bad week. */
function plugSign() {
  let hours = 0;
  const { mesh, redraw } = sheet(2.3, 1.55, (g, W, H) => {
    g.fillStyle = '#b4afa2';
    g.fillRect(0, 0, W, H);
    g.fillStyle = hours < 1 ? '#8e2c20' : '#1a5c39';
    g.fillRect(0, 0, W, H * 0.21);
    g.fillStyle = '#ddd8cc';
    g.textAlign = 'center';
    line(g, 'HOURS SINCE LAST PLUG', W / 2, H * 0.155, 34, W * 0.9);

    g.fillStyle = hours < 1 ? '#8e2c20' : '#161f28';
    line(g, String(hours), W / 2, H * 0.68, 150, W * 0.62);

    g.fillStyle = '#4e545e';
    g.textAlign = 'center';
    line(g, hours < 1 ? 'WELL. THAT WAS THE RECORD.' : 'SITE BEST: 41 h',
      W / 2, H * 0.83, 22, W * 0.8, 'Georgia, serif');
    g.fillStyle = '#6f7580';
    line(g, 'MANAGEMENT THANKS YOU FOR YOUR RHEOLOGY',
      W / 2, H * 0.94, 16, W * 0.9, 'Georgia, serif');
  }, 640);

  return {
    mesh,
    set(h: number) {
      const v = Math.max(0, Math.floor(h));
      if (v === hours) return;
      hours = v;
      redraw();
    },
  };
}

type Icon = 'pipe' | 'pressure' | 'arc' | 'tower' | 'cloud';
type Pic = 'cone' | 'plume' | 'slug' | 'crowd' | 'dry';

interface PosterSet {
  word: string; l1: string; l2: string; icon: Icon;
  top: string; bottom: string; pic: Pic;
  board: string; items: Array<[boolean, string]>; footer: string;
}

/**
 * What is on the walls, world by world. The live plug sign is everywhere -
 * every site plugs a line eventually - and the rest is whatever that site
 * has had pinned up long enough to stop noticing.
 */
const POSTERS: Record<WorldKind, PosterSet> = {
  earth: {
    word: 'PERSEVERANCE', l1: 'The line has been static for forty minutes.', l2: 'You have not.', icon: 'pipe',
    top: 'ADD MORE WATER', bottom: 'FAIL THE UCS', pic: 'cone',
    board: 'NIGHT SHIFT',
    items: [[true, 'fill 14-2 N'], [false, 'DO NOT plug the line'], [true, 'order balls BEFORE 20%'], [true, 'slump 110-130 (Boger!)']],
    footer: 'whoever left the cone in the doorway - it was not funny',
  },
  ocean: {
    word: 'PRESSURE', l1: 'Four hundred and forty bar outside.', l2: 'Relatively speaking, your day is fine.', icon: 'pressure',
    top: 'PLUME?', bottom: 'NOT ON MY SHIFT', pic: 'plume',
    board: 'SEABED SHIFT',
    items: [[true, 'fill Furrow 7'], [false, 'DO NOT tap the glass'], [true, 'cyclone U/F under 58%'], [true, 'log the fish (47 so far)']],
    footer: 'the big one is a grenadier, not "Kevin"',
  },
  space: {
    word: 'ESCAPE VELOCITY', l1: '166 metres a second.', l2: 'Some of us are still working on it.', icon: 'arc',
    top: 'THROW IT AWAY', bottom: 'NO. FURTHER.', pic: 'slug',
    board: 'KILN STATION RUN',
    items: [[true, 'launch 6,000 m3'], [false, 'DO NOT spill - it boils'], [true, 'order balls early (Earth is 3 AU)'], [true, 'stiff paste = cheap paste']],
    footer: 'the slug left on the rail over the weekend is now in orbit, and on your record',
  },
  city: {
    word: 'ALTITUDE', l1: 'Tower 9 is one hundred and ninety metres tall.', l2: 'Its foundations are your problem.', icon: 'tower',
    top: 'DIG DOWN?', bottom: '200,000 PEOPLE SAY NO', pic: 'crowd',
    board: 'MERIDIAN HOLDINGS',
    items: [[true, 'fill V-9 at 1,500 kPa'], [false, 'NO ordinary portland (pyrite)'], [true, 'watch the choke - it runs'], [true, 'smile, you are on camera']],
    footer: 'compliance is mandatory. enthusiasm is monitored.',
  },
  waste: {
    word: 'PATIENCE', l1: 'Two hundred years without rain.', l2: 'The plant will wait. So can you.', icon: 'cloud',
    top: 'ADD MORE WATER', bottom: 'WHAT WATER', pic: 'dry',
    board: 'LAST SHIFT · DAY 255,500',
    items: [[true, 'fill Crater 4'], [true, 'check on the plant (the green one)'], [false, 'DO NOT teleport water (again)'], [true, 'hammers before 20%']],
    footer: 'if anyone comes back: the kettle still works',
  },
};

function drawIcon(g: CanvasRenderingContext2D, W: number, H: number, icon: Icon) {
  const cx = W / 2, cy = H * 0.37;
  g.lineWidth = 3;
  switch (icon) {
    case 'pipe': {
      // a pipe, and the reason it is not flowing
      const r = H * 0.115;
      g.fillStyle = '#20262f';
      g.fillRect(W * 0.16, cy - r, W * 0.68, r * 2);
      g.fillStyle = '#8e7a5f';
      g.fillRect(W * 0.16, cy - r, W * 0.3, r * 2);
      g.fillStyle = '#c0392b';
      g.fillRect(W * 0.44, cy - r, W * 0.12, r * 2);
      g.strokeStyle = '#4a5462';
      g.strokeRect(W * 0.16, cy - r, W * 0.68, r * 2);
      break;
    }
    case 'pressure': {
      // a small sphere with a great many arrows pointing at it
      g.fillStyle = '#2a6a8a';
      g.beginPath(); g.arc(cx, cy, H * 0.08, 0, 7); g.fill();
      g.strokeStyle = '#7fb8d4';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r0 = H * 0.26, r1 = H * 0.12;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }
      break;
    }
    case 'arc': {
      // a trajectory leaving a very small world
      g.fillStyle = '#5a5654';
      g.beginPath(); g.arc(W * 0.26, H * 0.62, H * 0.2, Math.PI, 0); g.fill();
      g.strokeStyle = '#ffab3d';
      g.setLineDash([8, 6]);
      g.beginPath(); g.moveTo(W * 0.3, H * 0.44);
      g.quadraticCurveTo(W * 0.5, H * 0.12, W * 0.86, H * 0.16); g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#ffab3d';
      g.beginPath(); g.arc(W * 0.86, H * 0.16, 5, 0, 7); g.fill();
      break;
    }
    case 'tower': {
      // a tower, and its piles, and the hole under them
      g.fillStyle = '#3a2a4a';
      g.fillRect(cx - W * 0.07, H * 0.1, W * 0.14, H * 0.3);
      g.strokeStyle = '#ff4fd8';
      for (let i = 0; i < 4; i++) {
        const x = cx - W * 0.06 + i * W * 0.04;
        g.beginPath(); g.moveTo(x, H * 0.4); g.lineTo(x, H * 0.52); g.stroke();
      }
      g.fillStyle = '#0a0a0a';
      g.fillRect(cx - W * 0.16, H * 0.56, W * 0.32, H * 0.08);
      break;
    }
    case 'cloud': {
      // a cloud, with no rain coming out of it
      g.fillStyle = '#8a7a6a';
      for (const [dx, dy, r] of [[-0.08, 0, 0.09], [0, -0.04, 0.11], [0.09, 0, 0.08]] as const) {
        g.beginPath(); g.arc(cx + W * dx, cy + H * dy, H * r, 0, 7); g.fill();
      }
      g.fillStyle = '#a49e92';
      g.font = '600 18px Georgia, serif';
      g.textAlign = 'center';
      g.fillText('(no rain)', cx, cy + H * 0.2);
      break;
    }
  }
}

function drawPic(g: CanvasRenderingContext2D, W: number, H: number, pic: Pic) {
  switch (pic) {
    case 'cone':
    case 'dry': {
      // a slump cone that has entirely given up - or, dry, one that never started
      g.fillStyle = pic === 'dry' ? '#a08a6a' : '#8e7a5f';
      g.beginPath();
      if (pic === 'dry') {
        g.moveTo(W * 0.38, H * 0.68); g.lineTo(W * 0.44, H * 0.34); g.lineTo(W * 0.56, H * 0.34); g.lineTo(W * 0.62, H * 0.68);
      } else {
        g.moveTo(W * 0.2, H * 0.68); g.quadraticCurveTo(W * 0.5, H * 0.34, W * 0.8, H * 0.68); g.lineTo(W * 0.2, H * 0.68);
      }
      g.fill();
      g.fillStyle = '#6f5f48';
      g.fillRect(W * 0.12, H * 0.68, W * 0.76, H * 0.035);
      break;
    }
    case 'plume': {
      g.fillStyle = '#6a6252';
      for (let i = 0; i < 9; i++) {
        g.globalAlpha = 0.25 + (i % 3) * 0.15;
        g.beginPath(); g.arc(W * (0.25 + i * 0.06), H * (0.55 - Math.sin(i) * 0.08), H * (0.08 + i * 0.012), 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'slug': {
      g.strokeStyle = '#35e0d0';
      g.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        g.beginPath(); g.ellipse(W * (0.2 + i * 0.09), H * (0.62 - i * 0.05), 6, 16, -0.4, 0, 7); g.stroke();
      }
      g.fillStyle = '#ffab3d';
      g.beginPath(); g.arc(W * 0.82, H * 0.3, 9, 0, 7); g.fill();
      break;
    }
    case 'crowd': {
      g.fillStyle = '#5a4a6a';
      for (let i = 0; i < 22; i++) {
        const x = W * (0.12 + (i % 11) * 0.075), y = H * (0.56 + Math.floor(i / 11) * 0.1);
        g.beginPath(); g.arc(x, y - 12, 7, 0, 7); g.fill();
        g.fillRect(x - 7, y - 5, 14, 18);
      }
      break;
    }
  }
}

/** Motivational poster, of the kind that is issued rather than chosen. */
function motivational(ps: PosterSet) {
  return sheet(1.9, 1.38, (g, W, H) => {
    g.fillStyle = '#0c0c0e';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#a49e92';
    g.lineWidth = 2;
    g.strokeRect(W * 0.07, H * 0.07, W * 0.86, H * 0.62);
    drawIcon(g, W, H, ps.icon);
    g.fillStyle = '#c3bfb3';
    g.textAlign = 'center';
    line(g, ps.word, W / 2, H * 0.83, 46, W * 0.84, 'Georgia, serif');
    g.fillStyle = '#7f8794';
    line(g, ps.l1, W / 2, H * 0.915, 19, W * 0.88, 'Georgia, serif');
    line(g, ps.l2, W / 2, H * 0.965, 19, W * 0.88, 'Georgia, serif');
  }, 560);
}

/** Printed off somebody's phone, laminated, and never taken down. */
function meme(ps: PosterSet) {
  return sheet(2.0, 1.45, (g, W, H) => {
    g.fillStyle = '#12171f';
    g.fillRect(0, 0, W, H);
    drawPic(g, W, H, ps.pic);
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = '#000';
    g.fillStyle = '#ddd8cc';
    const shout = (text: string, y: number, size: number) => {
      let sz = size;
      do {
        g.font = '700 ' + sz + 'px Impact, "Arial Black", sans-serif';
        sz -= 1;
      } while (g.measureText(text).width > W * 0.92 && sz > 10);
      g.strokeText(text, W / 2, y);
      g.fillText(text, W / 2, y);
    };
    shout(ps.top, H * 0.2, 60);
    shout(ps.bottom, H * 0.93, 60);
  }, 560);
}

/** The shift board. Half instruction, half score sheet, all felt tip. */
function shiftBoard(ps: PosterSet) {
  return sheet(1.55, 1.15, (g, W, H) => {
    g.fillStyle = '#b3b8bd';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#7f8794';
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);

    g.textAlign = 'left';
    g.fillStyle = '#1b3d75';
    line(g, ps.board, W * 0.08, H * 0.16, 30, W * 0.62, 'Comic Sans MS, cursive');
    ps.items.forEach(([ok, it], i) => {
      g.fillStyle = ok ? '#20252c' : '#8e2c20';
      line(g, (ok ? '\u2713 ' : '\u2716 ') + it,
        W * 0.08, H * (0.33 + i * 0.145), 24, W * 0.62, 'Comic Sans MS, cursive');
    });
    g.fillStyle = '#1a5c39';
    line(g, ps.footer, W * 0.08, H * 0.94, 15, W * 0.86, 'Comic Sans MS, cursive');

    // post-its, because a whiteboard alone never survives a quarter
    for (const [x, y, c] of [[0.74, 0.2, '#c2a338'], [0.84, 0.45, '#b87b8f']] as const) {
      g.fillStyle = c;
      g.fillRect(W * x, H * y, W * 0.14, H * 0.19);
    }
  }, 540);
}

// ----------------------------------------------------------------- the props

/** Wall clock. The hands move on shift time, which is its own kind of joke. */
function clock() {
  const g = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.21, 28),
    new THREE.MeshStandardMaterial({
      color: 0xaea99d, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.94,
    }),
  );
  g.add(face);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.21, 0.02, 6, 28), metal(C.steelDark),
  );
  g.add(rim);
  const hand = (len: number, w: number) => {
    const m = box(w, len, 0.012, matte(0x1a1f27, 0.9));
    m.geometry.translate(0, len / 2, 0);
    m.position.z = 0.012;
    g.add(m);
    return m;
  };
  return { group: g, hour: hand(0.1, 0.022), minute: hand(0.16, 0.014) };
}

/** A pot plant that has not been watered since the plant was commissioned. */
function sadPlant() {
  const g = new THREE.Group();
  const pot = cyl(0.19, 0.24, 0.34, matte(0x7a4a34, 0.95), 12);
  pot.position.y = 0.17;
  g.add(pot);
  const soil = cyl(0.185, 0.185, 0.03, matte(0x2a2118, 1), 12);
  soil.position.y = 0.34;
  g.add(soil);
  const leafMat = matte(0x4a5a34, 0.95);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.42, 5), leafMat);
    leaf.position.set(Math.cos(a) * 0.1, 0.5, Math.sin(a) * 0.1);
    // every one of them drooping, at slightly different angles
    leaf.rotation.set(Math.cos(a) * 0.95, 0, -Math.sin(a) * 0.95);
    g.add(leaf);
  }
  return g;
}

/** The desk phone: the only way to get a delivery from the chair. */
function deskPhone() {
  const g = new THREE.Group();
  // A little larger than scale and a shade lighter than the desk, because at
  // two metres in a dark room an accurate phone is a dark smudge.
  const base = box(0.38, 0.07, 0.3, matte(0x232b36, 0.9));
  base.position.y = 0.035;
  g.add(base);
  const keys = box(0.18, 0.014, 0.14, matte(0x4e5866, 0.85));
  keys.position.set(0.07, 0.077, 0.03);
  g.add(keys);
  const handset = box(0.38, 0.055, 0.1, matte(0x59636f, 0.85));
  handset.position.set(0, 0.1, -0.09);
  g.add(handset);
  for (const x of [-0.15, 0.15]) {
    const ear = box(0.09, 0.09, 0.115, matte(0x59636f, 0.85));
    ear.position.set(x, 0.112, -0.09);
    g.add(ear);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), glow(C.amber, 0.4));
  led.position.set(-0.13, 0.082, 0.09);
  g.add(led);
  return { group: g, led };
}

// ------------------------------------------------------------------ assembly

export class RoomDecor {
  group = new THREE.Group();

  private sign = plugSign();
  private clockFace = clock();
  private phone = deskPhone();
  private lastPlugs = 0;
  private lastPlugAt = 0;
  private lastTime = 0;

  constructor(readonly kind: WorldKind = 'earth') {
    const g = this.group;

    // ---- west wall: the sign, the poster, the clock ------------------------
    const west = new THREE.Group();
    west.position.x = -5.26;
    west.rotation.y = Math.PI / 2;
    g.add(west);

    this.sign.mesh.position.set(-1.4, 3.62, 0);
    west.add(this.sign.mesh);
    const ps = POSTERS[this.kind];
    const pers = motivational(ps);
    pers.mesh.position.set(1.3, 3.66, 0);
    west.add(pers.mesh);
    this.clockFace.group.position.set(-0.05, 4.82, 0);
    west.add(this.clockFace.group);

    // ---- east wall: the meme, the shift board, the vest --------------------
    const east = new THREE.Group();
    east.position.x = 5.26;
    east.rotation.y = -Math.PI / 2;
    g.add(east);

    // Local +x on this wall runs toward the back of the room, and the door is
    // at z = 1.6, so everything printed lives on the window side of it.
    const memeSheet = meme(ps);
    memeSheet.mesh.position.set(-2.1, 3.56, 0);
    east.add(memeSheet.mesh);
    const board = shiftBoard(ps);
    board.mesh.position.set(-0.2, 3.5, 0);
    east.add(board.mesh);

    // a hi-vis on a hook by the door, which is where it lives and not on you
    const hook = tube(0.02, 0.12, metal(C.steelLight), 6);
    hook.rotation.z = Math.PI / 2;
    hook.position.set(1.5, 4.15, 0.06);
    east.add(hook);
    const vest = box(0.42, 0.62, 0.1, matte(0x94a02a, 0.95));
    vest.position.set(1.5, 3.78, 0.07);
    east.add(vest);
    for (const y of [3.9, 3.66]) {
      const band = box(0.44, 0.07, 0.11, matte(0x9aa2a8, 0.9));
      band.position.set(1.5, y, 0.075);
      east.add(band);
    }

    // ---- things on the floor ----------------------------------------------
    const plant = sadPlant();
    plant.position.set(-4.5, 1.18, 2.25);
    g.add(plant);

    const cab = box(0.58, 1.22, 0.7, metal(0x424b58, 0.7, 0.4));
    cab.position.set(4.6, 1.79, -2.5);
    g.add(cab);
    for (const y of [1.45, 1.8, 2.15]) {
      const handle = box(0.03, 0.04, 0.26, metal(C.steelLight));
      handle.position.set(4.3, y, -2.5);
      g.add(handle);
    }
    // the kettle lives on the filing cabinet, as it does everywhere
    const kettle = cyl(0.1, 0.12, 0.22, matte(0x8f969f, 0.8), 12);
    kettle.position.set(4.6, 2.51, -2.35);
    g.add(kettle);

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 12), matte(0xa04a20, 0.95));
    cone.position.set(3.8, 1.43, 2.45);
    g.add(cone);
    const coneBase = box(0.36, 0.04, 0.36, matte(0x1a1f27, 0.95));
    coneBase.position.set(3.8, 1.2, 2.45);
    g.add(coneBase);

    const bin = cyl(0.17, 0.14, 0.42, metal(0x39434f, 0.7, 0.5), 12);
    bin.position.set(-4.3, 1.39, 0.7);
    g.add(bin);

    // ---- things on the desk ------------------------------------------------
    this.phone.group.position.set(1.8, 2.57, 0.42);
    this.phone.group.rotation.y = -0.3;
    g.add(this.phone.group);

    const mug = cyl(0.045, 0.04, 0.1, matte(0x949ca5, 0.9), 12);
    mug.position.set(-1.15, 2.62, 0.52);
    g.add(mug);

    // a keyboard and a notepad, so the desk under your hands is not bare
    const keys = box(0.46, 0.022, 0.16, matte(0x252b34, 0.9));
    keys.position.set(0, 2.585, 0.58);
    g.add(keys);
    const keyTop = box(0.42, 0.006, 0.12, matte(0x39424e, 0.9));
    keyTop.position.set(0, 2.599, 0.58);
    g.add(keyTop);
    const mouse = box(0.06, 0.025, 0.09, matte(0x252b34, 0.9));
    mouse.position.set(0.34, 2.587, 0.58);
    g.add(mouse);
    const pad = box(0.21, 0.012, 0.28, matte(0x9a9585, 0.95));
    pad.position.set(-2.1, 2.58, 0.44);
    pad.rotation.y = 0.22;
    g.add(pad);
    const pen = cyl(0.008, 0.008, 0.14, matte(0x1f6fa8, 0.7), 8);
    pen.rotation.set(Math.PI / 2, 0, 0.5);
    pen.position.set(-1.92, 2.592, 0.44);
    g.add(pen);
    const hat = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      matte(0xb2872c, 0.9),
    );
    hat.position.set(2.75, 2.57, 0.62);
    g.add(hat);
    const brim = cyl(0.19, 0.19, 0.02, matte(0xb2872c, 0.9), 14);
    brim.position.set(2.75, 2.58, 0.62);
    g.add(brim);
  }

  update(t: Telemetry) {
    // a reset winds the sign back rather than leaving yesterday's record up
    if (t.time < this.lastTime) { this.lastPlugs = 0; this.lastPlugAt = 0; }
    this.lastTime = t.time;
    if (t.blockages > this.lastPlugs) {
      this.lastPlugs = t.blockages;
      this.lastPlugAt = t.time;
    }
    this.sign.set((t.time - this.lastPlugAt) / 3600);

    const h = t.time / 3600;
    this.clockFace.minute.rotation.z = -(h % 1) * Math.PI * 2;
    this.clockFace.hour.rotation.z = -((h / 12) % 1) * Math.PI * 2;

    const wanted = t.silo.pct < 12 || (t.upstream.hard && t.media.pct < 20);
    const m = this.phone.led.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = wanted ? 2.2 + 2 * (0.5 + 0.5 * Math.sin(t.time * 6)) : 0.25;
  }
}
