/**
 * The title screen: five places a paste plant might have to run, one card
 * each. Nothing 3D is built until you pick, so this paints immediately.
 */
import type { Scenario } from '../scenario';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** A small hand-drawn scene per card: 320 x 180. */
const ART: Record<string, string> = {
  today: `
    <defs><linearGradient id="gt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070b14"/><stop offset=".62" stop-color="#1c2944"/><stop offset="1" stop-color="#3a2f3c"/>
    </linearGradient></defs>
    <rect width="320" height="180" fill="url(#gt)"/>
    <rect y="104" width="320" height="76" fill="#12171f"/>
    <rect x="178" y="112" width="112" height="60" fill="#161b23" stroke="#35e0d0" stroke-opacity=".35"/>
    <rect x="212" y="138" width="52" height="30" fill="#0d1117" stroke="#35e0d0" stroke-opacity=".6"/>
    <rect x="213" y="156" width="50" height="11" fill="#c08f52"/>
    <path d="M150 100 L150 106 L200 106 L200 150 L238 150 L238 138" stroke="#c08f52" stroke-width="2.4" fill="none"/>
    <ellipse cx="62" cy="100" rx="40" ry="8" fill="#243044" stroke="#35e0d0" stroke-opacity=".5"/>
    <path d="M22 100 v-10 h80 v10" fill="#1d2633"/>
    <ellipse cx="62" cy="90" rx="40" ry="6" fill="#3fa9f5" fill-opacity=".45"/>
    <rect x="112" y="70" width="14" height="34" fill="#2c3645"/><rect x="132" y="80" width="26" height="24" fill="#2c3645"/>
    <path d="M140 28 l14 76 M168 28 l-14 76 M140 28 h28 M144 50 h20" stroke="#5a6779" stroke-width="2"/>
    <circle cx="154" cy="28" r="3" fill="#ffab3d"/>`,
  psyche: `
    <rect width="320" height="180" fill="#010205"/>
    ${stars(70, 3)}
    <circle cx="276" cy="28" r="10" fill="#fff4e4"/><circle cx="276" cy="28" r="22" fill="#fff4e4" fill-opacity=".12"/>
    <path d="M-20 150 Q160 118 340 150 L340 180 L-20 180 Z" fill="#2a292b"/>
    <path d="M-20 150 Q160 118 340 150" stroke="#55535a" stroke-width="1.2" fill="none"/>
    <path d="M24 138 a46 24 0 0 1 92 0" fill="#9fd8ff" fill-opacity=".08" stroke="#6f8aa6" stroke-opacity=".7"/>
    <path d="M120 136 L292 70" stroke="#8c97a6" stroke-width="3"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const x = 132 + i * 20, y = 131.5 - i * 7.67;
      return `<ellipse cx="${x}" cy="${y}" rx="2.4" ry="6" fill="none" stroke="${i === 5 ? '#bff6ff' : '#35e0d0'}" stroke-width="1.6" transform="rotate(-21 ${x} ${y})"/>`;
    }).join('')}
    <path d="M296 68 L318 60" stroke="#ffab3d" stroke-width="2" stroke-linecap="round"/>
    <circle cx="308" cy="63" r="2.6" fill="#ffab3d"/>`,
  abyss: `
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000308"/><stop offset="1" stop-color="#05273a"/>
    </linearGradient>
    <radialGradient id="gl" cx=".5" cy="0" r="1"><stop offset="0" stop-color="#7fd4ff" stop-opacity=".35"/><stop offset="1" stop-color="#7fd4ff" stop-opacity="0"/></radialGradient></defs>
    <rect width="320" height="180" fill="url(#ga)"/>
    <path d="M70 20 L30 150 L110 150 Z" fill="url(#gl)"/><path d="M230 10 L190 150 L270 150 Z" fill="url(#gl)"/>
    <rect y="148" width="320" height="32" fill="#1d2420"/>
    ${[40, 120, 200, 270, 90, 300].map((x, i) => `<ellipse cx="${x}" cy="${156 + (i % 3) * 5}" rx="4" ry="2" fill="#0f1310"/>`).join('')}
    <circle cx="160" cy="118" r="34" fill="#9fd8ff" fill-opacity=".08" stroke="#9fd8ff" stroke-opacity=".6"/>
    <rect x="140" y="118" width="40" height="18" fill="#2c3645"/><rect x="144" y="122" width="32" height="6" fill="#35e0d0" fill-opacity=".7"/>
    ${fish(40, 60, 1)}${fish(62, 70, .8)}${fish(52, 82, .9)}${fish(236, 92, -1)}${fish(262, 104, -.8)}${fish(218, 58, -.7)}
    ${snow(40)}`,
  undercity: `
    <defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#050109"/><stop offset=".7" stop-color="#2a0c30"/><stop offset="1" stop-color="#4a1440"/>
    </linearGradient></defs>
    <rect width="320" height="180" fill="url(#gc)"/>
    ${towers()}
    <rect y="118" width="320" height="62" fill="#0a0910"/>
    <rect x="120" y="140" width="80" height="34" fill="#140e1a" stroke="#ff4fd8" stroke-opacity=".5"/>
    <rect x="121" y="163" width="78" height="10" fill="#c08f52"/>
    <path d="M160 108 V142" stroke="#c08f52" stroke-width="2.4"/>
    ${[132, 146, 174, 188].map((x) => `<path d="M${x} 118 V136" stroke="#6a5a7a" stroke-width="2"/>`).join('')}
    ${rain(60)}`,
  caretaker: `
    <defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3c2a18"/><stop offset=".7" stop-color="#9a6230"/><stop offset="1" stop-color="#b57a3c"/>
    </linearGradient></defs>
    <rect width="320" height="180" fill="url(#gw)"/>
    <circle cx="238" cy="54" r="16" fill="#ffd8a0" fill-opacity=".55"/>
    ${cubes()}
    <rect y="146" width="320" height="34" fill="#4e4030"/>
    <g transform="translate(96 124)">
      <rect x="0" y="12" width="16" height="10" fill="#6a5a44"/><rect x="3" y="0" width="10" height="13" fill="#8a7458"/>
      <circle cx="8" cy="6" r="3" fill="#1a1510"/><circle cx="8" cy="6" r="1.4" fill="#9fe870"/>
      <rect x="-2" y="22" width="20" height="4" rx="2" fill="#2a2218"/>
    </g>
    <path d="M136 146 q2 -8 0 -12 M136 138 q-5 -2 -7 -6 M136 136 q5 -2 7 -5" stroke="#9fe870" stroke-width="1.6" fill="none"/>`,
};

function stars(n: number, seed: number) {
  let s = seed, out = '';
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    out += `<circle cx="${(r() * 320).toFixed(1)}" cy="${(r() * 120).toFixed(1)}" r="${(0.4 + r() * 0.9).toFixed(2)}" fill="#fff" fill-opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}
function fish(x: number, y: number, dir: number) {
  const d = Math.sign(dir), s = Math.abs(dir);
  return `<path transform="translate(${x} ${y}) scale(${d * s} ${s})" d="M0 0 q8 -5 16 0 q-8 5 -16 0 Z M16 0 l6 -4 v8 Z" fill="#9fd8ff" fill-opacity=".7"/>`;
}
function snow(n: number) {
  let s = 17, out = '';
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) out += `<circle cx="${(r() * 320).toFixed(1)}" cy="${(r() * 150).toFixed(1)}" r=".7" fill="#cfe8ff" fill-opacity=".5"/>`;
  return out;
}
function rain(n: number) {
  let s = 29, out = '';
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const x = r() * 330, y = r() * 170;
    out += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l-2 9" stroke="#9fb8ff" stroke-opacity=".35" stroke-width=".7"/>`;
  }
  return out;
}
function towers() {
  const t = [[8, 30, 40], [44, 12, 30], [70, 48, 26], [210, 20, 34], [248, 40, 28], [282, 6, 36]];
  let out = '';
  let s = 5;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (const [x, y, w] of t) {
    out += `<rect x="${x}" y="${y}" width="${w}" height="${120 - y}" fill="#120a1a"/>`;
    for (let yy = y + 6; yy < 116; yy += 7) {
      for (let xx = x + 4; xx < x + w - 3; xx += 6) {
        if (r() < 0.45) out += `<rect x="${xx}" y="${yy}" width="3" height="3" fill="${r() < 0.5 ? '#ff4fd8' : '#35e0d0'}" fill-opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
      }
    }
  }
  out += `<rect x="112" y="4" width="96" height="104" fill="#1a0f24" stroke="#ff4fd8" stroke-opacity=".7"/>`;
  out += `<text x="160" y="58" text-anchor="middle" font-family="monospace" font-size="16" fill="#ff4fd8" fill-opacity=".85">9</text>`;
  return out;
}
function cubes() {
  const cols = [[20, 70], [44, 40], [180, 88], [204, 60], [268, 30], [292, 76]];
  let out = '';
  for (const [x, top] of cols) {
    for (let y = 146; y > top; y -= 12) {
      const k = ((x + y) % 3);
      out += `<rect x="${x + (k - 1)}" y="${y - 12}" width="22" height="12" fill="${['#5a4632', '#6a5238', '#4a3a2a'][k]}" stroke="#3a2c1e" stroke-width=".6"/>`;
    }
  }
  return out;
}

export class Welcome {
  private root = el('div');

  constructor(scenarios: Scenario[], private onPick: (s: Scenario, intro: boolean) => void) {
    this.root.id = 'welcome';
    const bg = el('canvas', 'wl-bg');
    this.root.append(bg);

    const head = el('header');
    head.append(
      el('div', 'wl-mark', 'PASTE<b>WORKS</b>'),
      el('h1', undefined, 'Imagine how mining and materials transport could look in the future.'),
      el('p', undefined, 'A working paste backfill plant &mdash; thickener, filter press, mixer, '
        + 'pump and pipe, every number computed rather than animated &mdash; set down in '
        + 'five places it might one day have to run. Pick one.'),
    );
    this.root.append(head);

    const row = el('div', 'wl-cards');
    for (const s of scenarios) row.append(this.card(s));
    this.root.append(row);
    this.root.append(this.arena());
    this.root.append(this.sizing());

    const foot = el('footer');
    const intro = el('label', 'wl-intro');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = true;
    intro.append(box, el('span', undefined, 'Play the opening'));
    this.intro = box;
    foot.append(intro, el('span', 'wl-keys',
      'In the control room: drag to look around &middot; <kbd>Esc</kbd> leaves the desk '
      + '&middot; <kbd>C</kbd> sits back down &middot; <kbd>Space</kbd> run / stop'));
    this.root.append(foot);

    document.body.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.drift(bg);
  }

  private intro!: HTMLInputElement;

  private card(s: Scenario) {
    const c = el('button', 'wl-card');
    c.style.setProperty('--acc', s.look.accent);
    const art = el('div', 'wl-art');
    art.innerHTML = `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">${ART[s.id] ?? ''}</svg>`;
    c.append(art);
    const body = el('div', 'wl-body');
    body.append(
      el('em', undefined, s.era),
      el('b', undefined, s.title),
      el('i', undefined, s.place),
      el('p', undefined, s.blurb),
    );
    const chips = el('div', 'wl-chips');
    for (const ch of s.chips) chips.append(el('span', undefined, ch));
    body.append(chips);
    body.append(el('div', 'wl-go', 'Begin&nbsp;&nbsp;&#9656;'));
    c.append(body);
    c.onclick = () => this.pick(s);
    return c;
  }

  /** The sizing game: a strip like Paste Wars', for building the crushing and grinding circuit to a contract. */
  private sizing() {
    const a = el('a', 'wl-arena wl-size') as HTMLAnchorElement;
    a.href = '?size';
    a.innerHTML = `
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <rect x="4" y="22" width="32" height="3" rx="1.5" fill="#35e0d0"/>
        <circle cx="12" cy="23.5" r="5" fill="none" stroke="#35e0d0" stroke-width="2.4"/>
        <rect x="21" y="10" width="11" height="12" rx="2" fill="none" stroke="#35e0d0" stroke-width="2.4"/>
        <rect x="4" y="31" width="32" height="2.4" rx="1.2" fill="#35e0d0" opacity=".5"/>
      </svg>
      <span class="wa-name"><em>Before the plant</em><b>SIZE THE PLANT</b></span>
      <span class="wa-text">A contract, an ore and a grind to hit. Size every crusher, screen, mill and
        cyclone with sliders, on ProcessPro's own models, as cheaply as you can.</span>
      <span class="wa-go">Take the job&nbsp;&nbsp;&#9656;</span>`;
    a.onclick = (e) => {
      e.preventDefault();
      this.root.classList.add('leaving');
      this.running = false;
      setTimeout(() => { location.href = a.href; }, 420);
    };
    return a;
  }

  /**
   * Paste Wars, under the worlds: a strip rather than a sixth card, because it
   * is not a sixth place to run the plant - it is what happens after the
   * shift. Two doors: the plant itself, every one for themselves, and the
   * 760 Level underground, Day shift against Night shift. Each says how many
   * are on shift in it, if the arena answers.
   */
  private arena() {
    const strip = el('div', 'wl-arena');
    strip.innerHTML = `
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M20 6c3 0 4 5 7 5s5-3 7 0-2 5 0 8 4 5 1 7-5-1-6 2 0 7-4 7-4-4-7-4-6 4-8 1 2-5-1-7-6-1-5-4 5-3 5-6-3-6 0-8 5 2 7 0 2-8 4-8z" fill="#c08f52"/>
        <circle cx="33" cy="7" r="2" fill="#c08f52"/><circle cx="6" cy="31" r="1.6" fill="#c08f52"/>
      </svg>
      <span class="wa-name"><em>After the shift</em><b>PASTE WARS</b></span>
      <span class="wa-text">Up to fifteen at once in each. Paste gun, rocks, and filter cake off the floor
        to reload. Keyboard and mouse.</span>`;
    const doors: Array<[string, string, string, string]> = [
      ['plant', '?arena', 'The plant', 'Splat tag on the running plant'],
      ['mine', '?arena=mine', '760 Level', 'Day v Night underground: a barrow of paste into their stope'],
    ];
    const counts: Record<string, HTMLElement> = {};
    for (const [id, href, name, blurb] of doors) {
      const a = el('a', 'wa-door') as HTMLAnchorElement;
      a.href = href;
      a.innerHTML = `<b>${name}</b><span>${blurb}</span><span class="wa-count"></span><span class="wa-go">Clock on&nbsp;&nbsp;&#9656;</span>`;
      counts[id] = a.querySelector('.wa-count') as HTMLElement;
      a.onclick = (e) => {
        e.preventDefault();
        this.root.classList.add('leaving');
        this.running = false;
        setTimeout(() => { location.href = a.href; }, 420);
      };
      strip.append(a);
    }
    fetch('/play/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { online: number; max: number; rooms?: Record<string, { online: number; max: number }> } | null) => {
        if (!s) return;
        for (const id of Object.keys(counts)) {
          const r = s.rooms?.[id] ?? (id === 'plant' ? s : null);
          if (r) counts[id].textContent = `${r.online} / ${r.max} on shift`;
        }
      })
      .catch(() => { /* no arena server: the page will practise on its own */ });
    return strip;
  }

  private pick(s: Scenario) {
    this.root.classList.add('leaving');
    this.running = false;
    const intro = this.intro.checked;
    setTimeout(() => {
      this.root.remove();
      this.onPick(s, intro);
    }, 520);
  }

  private running = true;

  /** Slow drifting motes behind the cards - enough to feel alive, no more. */
  private drift(c: HTMLCanvasElement) {
    const g = c.getContext('2d')!;
    const dpr = Math.min(devicePixelRatio, 2);
    const motes = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.6,
      v: 0.004 + Math.random() * 0.012, a: 0.15 + Math.random() * 0.4,
    }));
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (c.width !== innerWidth * dpr) { c.width = innerWidth * dpr; c.height = innerHeight * dpr; }
      g.clearRect(0, 0, c.width, c.height);
      for (const m of motes) {
        m.y -= m.v * dt;
        if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        g.fillStyle = `rgba(120,200,220,${m.a})`;
        g.beginPath();
        g.arc(m.x * c.width, m.y * c.height, m.r * dpr, 0, 7);
        g.fill();
      }
    };
    requestAnimationFrame(tick);
  }
}
