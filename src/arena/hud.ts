import { COLOURS, hex, WEAPONS, CONDITIONS, MAX_PLAYERS, type WeaponId } from './shared/rules';
import type { RoundInfo } from './shared/protocol';

/**
 * Everything on the glass: health, ammo, the round clock, who got who, the
 * scoreboard, and the card that comes up when the browser takes the mouse.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const who = (name: string, col: number) =>
  `<span class="who"><i style="background:${hex(COLOURS[col % COLOURS.length])}"></i>${esc(name)}</span>`;

export interface Row { id: number; name: string; col: number; tags: number; deaths: number; me: boolean }

export class ArenaHud {
  root = document.createElement('div');
  private el: Record<string, HTMLElement> = {};
  private feedEl: HTMLElement;
  private toastTimer = 0;
  private statusKind = '';
  private roundInfo: RoundInfo | null = null;
  private online = 1;

  onResume: () => void = () => {};
  onLeave: () => void = () => {};

  constructor() {
    const r = this.root;
    r.id = 'arena';
    r.innerHTML = `
      <div class="me"><i class="hat"></i><b class="name">Clocking on...</b><span class="tags"></span></div>
      <div class="round"><b class="rn">WARM-UP</b><span class="rc"></span><time class="rt"></time></div>
      <div class="feed"></div>
      <div class="status"></div>
      <div class="cross"><i></i><i></i><i></i><i></i></div>
      <div class="hitmark"></div>
      <div class="toast"></div>
      <div class="vignette"></div>
      <div class="hint"></div>
      <div class="hp"><label>HEALTH</label><b class="hpn">100</b><div class="bar"><i class="hpb"></i></div></div>
      <div class="ammo">
        <div class="slot s0"><kbd>1</kbd><label>${WEAPONS[0].short}</label><b class="a0">0</b><small>/${WEAPONS[0].cap}</small></div>
        <div class="slot s1"><kbd>2</kbd><label>${WEAPONS[1].short}</label><b class="a1">0</b><small>/${WEAPONS[1].cap}</small></div>
      </div>
      <div class="down"><b>PLASTERED</b><p class="dby"></p><p class="dt"></p></div>
      <div class="board"><h3 class="bh"></h3><table><thead><tr><th></th><th>Tags</th><th>Plastered</th></tr></thead><tbody class="bb"></tbody></table><p class="bf"></p></div>
      <div class="card">
        <b>PASTE WARS</b>
        <p class="lead">After-shift splat tag on the backfill plant. Paste gun or rocks - no score counts until two are on shift.</p>
        <ul>
          <li><kbd>WASD</kbd> move &middot; <kbd>Shift</kbd> run &middot; <kbd>Space</kbd> jump</li>
          <li><kbd>Click</kbd> paste gun &middot; <kbd>Right click</kbd> throw a rock</li>
          <li><kbd>1</kbd> <kbd>2</kbd> or <kbd>Q</kbd> swap &middot; <kbd>Tab</kbd> scores &middot; <kbd>M</kbd> sound</li>
          <li>Walk over <em class="cake">filter cake</em> for paste, and <em class="rock">rock</em> for rocks</li>
        </ul>
        <p class="who-line"></p>
        <div class="row"><button class="go">Clock on</button><button class="leave">Leave the arena</button></div>
      </div>`;
    document.body.appendChild(r);
    r.querySelectorAll<HTMLElement>('[class]').forEach((e) => {
      for (const c of e.classList) if (!this.el[c]) this.el[c] = e;
    });
    this.feedEl = this.el.feed;
    this.el.go.onclick = (e) => { e.stopPropagation(); this.onResume(); };
    this.el.leave.onclick = (e) => { e.stopPropagation(); this.onLeave(); };
  }

  setMe(name: string, col: number) {
    this.el.name.textContent = name;
    this.el.hat.style.background = hex(COLOURS[col % COLOURS.length]);
    this.el['who-line'].innerHTML = `You are ${who(name, col)} today.`;
  }

  setTags(n: number) {
    this.el.tags.textContent = n === 1 ? '1 tag' : `${n} tags`;
  }

  setOnline(n: number) {
    this.online = n;
  }

  setRound(r: RoundInfo) {
    this.roundInfo = r;
  }

  /** the round line, every frame, off the server's clock */
  tick(serverNowMs: number) {
    const r = this.roundInfo;
    if (!r) return;
    const left = r.ends ? Math.max(0, Math.ceil((r.ends - serverNowMs) / 1000)) : 0;
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (r.st === 'warmup') {
      this.el.rn.textContent = 'WARM-UP';
      this.el.rc.textContent = `${this.online} / ${MAX_PLAYERS} on shift - the round starts with two`;
      this.el.rt.textContent = '';
    } else if (r.st === 'play') {
      this.el.rn.textContent = `ROUND ${r.n}`;
      this.el.rc.textContent = CONDITIONS[r.c].label;
      this.el.rt.textContent = clock;
    } else {
      this.el.rn.textContent = 'KNOCK-OFF';
      this.el.rc.textContent = 'next round in';
      this.el.rt.textContent = clock;
    }
    this.root.classList.toggle('late', r.st === 'play' && left <= 30);
  }

  setHp(hp: number) {
    this.el.hpn.textContent = String(Math.ceil(hp));
    this.el.hpb.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    this.el.hp.classList.toggle('low', hp <= 35);
  }

  setAmmo(a: [number, number], w: WeaponId) {
    this.el.a0.textContent = String(a[0]);
    this.el.a1.textContent = String(a[1]);
    this.el.s0.classList.toggle('on', w === 0);
    this.el.s1.classList.toggle('on', w === 1);
    this.el.s0.classList.toggle('dry', a[0] <= 0);
    this.el.s1.classList.toggle('dry', a[1] <= 0);
  }

  /** "Fitter 14 pasted Rigger 3" across the top right */
  feed(html: string, mine = false) {
    const line = document.createElement('div');
    line.className = 'line' + (mine ? ' mine' : '');
    line.innerHTML = html;
    this.feedEl.prepend(line);
    while (this.feedEl.children.length > 5) this.feedEl.lastElementChild!.remove();
    setTimeout(() => line.classList.add('gone'), 6000);
    setTimeout(() => line.remove(), 6600);
  }

  static who = who;

  hitmark(head: boolean, down = false) {
    const h = this.el.hitmark;
    h.className = 'hitmark on' + (head ? ' head' : '') + (down ? ' kill' : '');
    void h.offsetWidth;
    h.classList.add('fade');
  }

  hurt(strong: boolean) {
    const v = this.el.vignette;
    v.className = 'vignette on' + (strong ? ' strong' : '');
    void v.offsetWidth;
    v.classList.add('fade');
  }

  toast(text: string) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('on'), 1600);
  }

  down(byHtml: string | null, verb: string, until: number) {
    this.root.classList.add('isdown');
    this.el.dby.innerHTML = byHtml ? `${verb} by ${byHtml}` : 'You fell in. It happens.';
    this.downUntil = until;
  }
  private downUntil = 0;

  up() {
    this.root.classList.remove('isdown');
  }

  /** the respawn countdown, every frame */
  downTick(nowMs: number) {
    if (!this.root.classList.contains('isdown')) return;
    const s = Math.max(0, Math.ceil((this.downUntil - nowMs) / 1000));
    this.el.dt.textContent = s > 0 ? `Back on shift in ${s}` : 'Back on shift';
  }

  board(show: boolean, rows?: Row[], title?: string, footer?: string) {
    this.root.classList.toggle('scores', show);
    if (!show || !rows) return;
    const sorted = [...rows].sort((a, b) => b.tags - a.tags || a.deaths - b.deaths || a.id - b.id);
    this.el.bh.textContent = title ?? 'On shift';
    this.el.bb.innerHTML = sorted.map((r) =>
      `<tr class="${r.me ? 'self' : ''}"><td>${who(r.name, r.col)}</td><td>${r.tags}</td><td>${r.deaths}</td></tr>`).join('');
    this.el.bf.innerHTML = footer ?? '';
  }

  status(text: string | null, kind = '') {
    const s = this.el.status;
    s.textContent = text ?? '';
    s.classList.toggle('on', !!text);
    if (this.statusKind) s.classList.remove(this.statusKind);
    this.statusKind = kind;
    if (kind) s.classList.add(kind);
  }

  hint(html: string | null) {
    this.el.hint.innerHTML = html ?? '';
    this.el.hint.classList.toggle('on', !!html);
  }

  paused(p: boolean) {
    this.root.classList.toggle('paused', p);
  }
}
