/**
 * Meridian, 2137: a megacity standing on an old gold mine. The plant works in
 * the canyon between the towers, in the rain, under the adverts - and Tower 9
 * stands right over the section, its piles reaching down toward the void you
 * are filling.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Telemetry } from '../../sim/plant';
import { C, metal, matte, glow } from '../palette';
import { box } from '../parts';
import { STOPE } from '../terrain';
import { Dressing, Field, rng, canvasTexture } from './common';

/** A face of lit windows, drawn once and shared (cloned) between towers. */
function windowTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return canvasTexture(128, 256, (g, W, H) => {
    g.fillStyle = '#07060c';
    g.fillRect(0, 0, W, H);
    const cols = 8, rows = 32;
    const cw = W / cols, ch = H / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = r();
        if (k < 0.68) continue;
        g.fillStyle = k < 0.66 ? '#ff4fd8' : k < 0.8 ? '#35e0d0' : k < 0.95 ? '#ffd9a8' : '#ffffff';
        g.globalAlpha = 0.35 + r() * 0.65;
        g.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 3);
      }
    }
    g.globalAlpha = 1;
  });
}

const ADS: Array<[string, string, string, string]> = [
  // headline, strapline, colour, background
  ['MERIDIAN HOLDINGS', 'still standing *   (*mostly)', '#ff4fd8', '#1a0620'],
  ['BACKFILL', 'it\'s what\'s underneath that counts', '#35e0d0', '#041a1a'],
  ['TOWER 9', 'luxury living · now 11 cm closer to the ground', '#ffd166', '#1a1204'],
  ['FLOOR COVER', 'subsidence insurance from 99¢ a day', '#9fe870', '#0c1a06'],
  ['NOODLES', 'probably', '#ff5a3c', '#1a0604'],
  ['DO NOT DIG', 'there are 200,000 people on the lid', '#ffab3d', '#1a0e04'],
];

function adTexture([head, strap, col, bg]: [string, string, string, string]) {
  return canvasTexture(512, 256, (g, W, H) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = col;
    g.lineWidth = 6;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.fillStyle = col;
    g.textAlign = 'center';
    let s = 96;
    do { g.font = '800 ' + s + 'px "Arial Black", Impact, sans-serif'; s -= 2; }
    while (g.measureText(head).width > W * 0.86 && s > 20);
    g.fillText(head, W / 2, H * 0.55);
    g.font = '500 26px ui-monospace, monospace';
    g.globalAlpha = 0.85;
    g.fillText(strap, W / 2, H * 0.82);
    g.globalAlpha = 1;
  });
}

interface Ad { mat: THREE.MeshBasicMaterial; ph: number }
interface Car { mesh: THREE.Group; lane: number; s: number; v: number }

/** Lanes the traffic flies: an ellipse at a height, each. */
const LANES: Array<[number, number, number, number, number]> = [
  // cx, cz, rx, rz, y
  [-10, -30, 180, 110, 46],
  [-10, -30, 150, 90, 62],
  [30, -60, 210, 60, 84],
  [-60, 20, 120, 150, 100],
];

/**
 * A box with texture coordinates in metres - so a wall of windows keeps its
 * floor height whatever the tower - for merging.
 */
function towerBox(w: number, h: number, d: number, x: number, y0: number, z: number, u0: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const across = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
    // four-metre bays, three and a half metre floors
    uv.setXY(i, (across + u0) / 32, (p.getY(i) + h / 2) / 112);
  }
  geo.translate(x, y0 + h / 2, z);
  return geo;
}

/**
 * The canyon: the city packed shoulder to shoulder behind and either side of
 * the plant, taller the further out it stands - three, four, six hundred
 * metres - so from the pad it closes in overhead, with skybridges strung
 * across the gap. One mesh per window pattern, one per neon colour.
 */
function canyon(texes: THREE.CanvasTexture[], r: () => number): THREE.Group {
  const g = new THREE.Group();
  g.userData.noCollide = true;
  const walls: THREE.BufferGeometry[][] = texes.map(() => []);
  const neon = [0xff4fd8, 0x35e0d0, 0x8a6aff];
  const lit: THREE.BufferGeometry[][] = neon.map(() => []);
  const edge = (w: number, h: number, d: number, x: number, y: number, z: number, k: number) =>
    lit[k].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  for (let x = -460; x <= 440; x += 30) {
    for (let z = -520; z <= 140; z += 30) {
      const px = x + (r() - 0.5) * 12, pz = z + (r() - 0.5) * 12;
      // the plant's side of the canyon, and every camera's, stay open
      if (pz > -80 && Math.abs(px + 20) < 250) continue;
      const d = Math.hypot(px + 20, (pz + 40) * 1.2);
      if (d < 170 || d > 560) continue;
      const w = 20 + r() * 16, dd = 20 + r() * 16;
      const h = 110 + (d - 170) * 0.9 + r() * r() * 260;
      const k = Math.floor(r() * texes.length);
      walls[k].push(towerBox(w, h, dd, px, -0.4, pz, r() * 64));
      // a setback, and a spire on some
      if (r() < 0.5) walls[k].push(towerBox(w * 0.7, h * 0.25, dd * 0.7, px, h - 0.4, pz, r() * 64));
      if (r() < 0.4) {
        const c = Math.floor(r() * neon.length);
        edge(0.6, h, 0.6, px - w / 2, h / 2, pz + dd / 2, c);
        edge(0.6, h, 0.6, px + w / 2, h / 2, pz + dd / 2, c);
        edge(w + 1, 0.8, dd + 1, px, h * (0.3 + 0.5 * r()), pz, c);
      }
    }
  }
  // skybridges, across the canyon from wall to wall
  const bridges: Array<[number, number, number, number]> = [
    // z, y, x0, x1
    [-95, 72, -230, 190], [-120, 118, -260, 210], [-150, 164, -280, 230],
    [-20, 150, -270, 220], [10, 196, -280, 240], [-60, 236, -300, 260],
  ];
  for (const [z, y, x0, x1] of bridges) {
    const L = x1 - x0;
    const k = Math.floor(r() * texes.length);
    const deck = towerBox(L, 7, 9, 0, y, 0, 0);
    deck.rotateY(0).translate((x0 + x1) / 2, 0, z);
    walls[k].push(deck);
    const c = Math.floor(r() * neon.length);
    for (const s of [-1, 1]) edge(L, 0.4, 0.4, (x0 + x1) / 2, y - 0.2, z + s * 4.6, c);
  }
  // and two running the other way, over the flanks
  for (const [x, y] of [[-205, 96], [175, 132]] as const) {
    const deck = towerBox(9, 7, 300, x, y, -120, 0);
    walls[0].push(deck);
    edge(0.4, 0.4, 300, x - 4.6, y - 0.2, -120, 1);
    edge(0.4, 0.4, 300, x + 4.6, y - 0.2, -120, 1);
  }
  const shell = { color: 0x0c0a12, roughness: 0.35, metalness: 0.75 };
  walls.forEach((list, i) => {
    const tex = texes[i].clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const m = new THREE.MeshStandardMaterial({ ...shell, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45 });
    g.add(new THREE.Mesh(mergeGeometries(list), m));
  });
  lit.forEach((list, i) => { if (list.length) g.add(new THREE.Mesh(mergeGeometries(list), glow(neon[i], 2.2))); });
  return g;
}

export function buildCity(root: THREE.Group): Dressing {
  const r = rng(71);
  const texes = [windowTexture(1), windowTexture(2), windowTexture(3)];
  const shell = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.4, metalness: 0.7 });

  // ---- the skyline, ringing the canyon
  // Towers stand behind the plant and out to the sides - never south of it,
  // which is where every camera that looks at the plant is standing.
  const clear = (x: number, z: number, w: number) =>
    (x + w > -150 && x - w < 110 && z + w > -58) || (z - w > -58 && Math.abs(x + 20) < 230);
  const neonCols = [0xff4fd8, 0x35e0d0, 0x8a6aff];
  let placed = 0;
  for (let i = 0; i < 600 && placed < 64; i++) {
    const x = (r() - 0.5) * 620, z = -300 + r() * 380;
    const w = 14 + r() * 26, d = 14 + r() * 26;
    if (clear(x, z, Math.max(w, d) / 2 + 6)) continue;
    const h = 50 + r() ** 1.6 * 200;
    const tex = texes[i % 3].clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(h / 10)));
    const m = new THREE.MeshStandardMaterial({
      color: 0x0c0a12, roughness: 0.35, metalness: 0.75,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5,
    });
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [m, m, shell, shell, m, m]);
    t.position.set(x, h / 2 - 0.4, z);
    root.add(t);
    // neon on the corners of some of them
    if (r() < 0.45) {
      const col = neonCols[Math.floor(r() * 3)];
      for (const [sx, sz] of [[-1, 1], [1, 1]] as const) {
        const edge = box(0.35, h, 0.35, glow(col, 2.4));
        edge.position.set(x + (sx * w) / 2, h / 2, z + (sz * d) / 2);
        root.add(edge);
      }
      const crown = box(w + 0.6, 0.5, d + 0.6, glow(col, 2.0));
      crown.position.set(x, h - 0.2, z);
      root.add(crown);
    }
    placed++;
  }

  root.add(canyon(texes, r));

  // ---- Tower 9, standing over the workings
  const t9 = new THREE.Group();
  const podium = box(30, 4, 18, matte(0x1a1822, 0.6));
  podium.position.set(62, 2, -20);
  t9.add(podium);
  const h9 = 190;
  const tex9 = texes[0].clone();
  tex9.needsUpdate = true;
  tex9.wrapS = tex9.wrapT = THREE.RepeatWrapping;
  tex9.repeat.set(5, 19);
  const m9 = new THREE.MeshStandardMaterial({
    color: 0x100c18, roughness: 0.3, metalness: 0.8,
    emissive: 0xffffff, emissiveMap: tex9, emissiveIntensity: 0.7,
  });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(24, h9, 14), m9);
  tower.position.set(62, 4 + h9 / 2, -20);
  t9.add(tower);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const edge = box(0.5, h9, 0.5, glow(0xff4fd8, 2.8));
    edge.position.set(62 + sx * 12, 4 + h9 / 2, -20 + sz * 7);
    t9.add(edge);
  }
  // the number, big, the way a building you own is labelled
  const nine = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 30),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 350, (g, W, H) => {
        g.clearRect(0, 0, W, H);
        g.fillStyle = '#ff4fd8';
        g.font = '800 300px "Arial Black", Impact, sans-serif';
        g.textAlign = 'center';
        g.fillText('9', W / 2, H * 0.86);
      }),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  nine.position.set(62, 4 + h9 - 24, -12.9);
  t9.add(nine);
  // Piles, down through the section toward the crown of the void. They stop
  // a few metres short of it - which is the whole problem.
  for (let i = 0; i < 4; i++) {
    for (const z of [-26, -14]) {
      const x = 52 + i * 6.6;
      const depth = STOPE.y1 + 5;
      const pile = box(1.2, -depth, 1.2, metal(0x55606f, 0.5, 0.7));
      pile.position.set(x, depth / 2, z);
      t9.add(pile);
      const tip = box(1.6, 0.6, 1.6, glow(0xff4fd8, 1.6));
      tip.position.set(x, depth, z);
      t9.add(tip);
    }
  }
  root.add(t9);

  // ---- adverts on the nearer faces
  const ads: Ad[] = [];
  const spots: Array<[number, number, number, number, number]> = [
    // x, y, z, w, rotY
    [-60, 38, -70, 40, 0], [40, 52, -64, 46, 0], [-170, 44, -30, 40, Math.PI / 2],
    [150, 36, 10, 38, -Math.PI / 2], [62, 120, -12.8, 22, 0], [-110, 70, -80, 44, 0.2],
  ];
  spots.forEach(([x, y, z, w, ry], k) => {
    const mat = new THREE.MeshBasicMaterial({
      map: adTexture(ADS[k % ADS.length]), transparent: true, opacity: 0.92,
      side: THREE.DoubleSide,
    });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), mat);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    root.add(p);
    ads.push({ mat, ph: r() * 10 });
  });

  // ---- traffic
  const cars: Car[] = [];
  const bodyMat = metal(0x2a2a34, 0.4, 0.8);
  for (let i = 0; i < 34; i++) {
    const g = new THREE.Group();
    const b = box(2.6, 0.8, 1.3, bodyMat);
    g.add(b);
    const head = box(0.1, 0.25, 1.1, glow(0xffffff, 3));
    head.position.x = 1.32;
    g.add(head);
    const tail = box(0.1, 0.25, 1.1, glow(0xff3050, 3));
    tail.position.x = -1.32;
    g.add(tail);
    const under = box(2.2, 0.08, 1.0, glow(i % 2 ? 0xff4fd8 : 0x35e0d0, 2));
    under.position.y = -0.45;
    g.add(under);
    g.userData.noCollide = true;
    root.add(g);
    cars.push({ mesh: g, lane: i % LANES.length, s: r() * Math.PI * 2, v: (0.05 + r() * 0.05) * (i % 3 ? 1 : -1) });
  }

  // ---- rain
  const rain = new Field({
    count: 2600,
    min: new THREE.Vector3(-170, 0, -110), max: new THREE.Vector3(150, 110, 110),
    drift: new THREE.Vector3(1.4, -28, 0.6), wobble: 3,
    size: 1, colour: 0xaabcff, opacity: 0.28, streak: 1.4, additive: true, seed: 19,
  });
  root.add(rain.object);

  // a haze of steam off the canyon floor
  const steam = new Field({
    count: 300, min: new THREE.Vector3(-140, 0, -50), max: new THREE.Vector3(100, 14, 60),
    drift: new THREE.Vector3(0.3, 0.4, 0), wobble: 0.3,
    size: 2.6, colour: 0x6a4a8a, opacity: 0.12, seed: 23,
  });
  root.add(steam.object);

  return {
    update(t: Telemetry, dt: number, time: number) {
      rain.update(t, dt);
      steam.update(t, dt);
      // adverts flicker, occasionally badly
      for (const a of ads) {
        const f = Math.sin(time * 23 + a.ph) > 0.97 ? 0.35 : 0.92;
        a.mat.opacity = f;
      }
      for (const c of cars) {
        const [cx, cz, rx, rz, y] = LANES[c.lane];
        c.s += c.v * dt;
        const x = cx + Math.cos(c.s) * rx, z = cz + Math.sin(c.s) * rz;
        c.mesh.position.set(x, y + Math.sin(c.s * 3) * 1.5, z);
        const hx = -Math.sin(c.s) * rx * Math.sign(c.v), hz = Math.cos(c.s) * rz * Math.sign(c.v);
        c.mesh.rotation.y = Math.atan2(-hz, hx);
      }
    },
  };
}

export { C };
