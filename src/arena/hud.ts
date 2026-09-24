import { COLOURS, TEAMS, BARROW, hex, WEAPONS, MAX_PLAYERS, type WeaponId } from './shared/rules';
import type { RoundInfo } from './shared/protocol';
import type { MapDef } from './shared/maps';

/**
 * Everything on the glass: health, ammo, the round clock, who got who, the
 * scoreboard, and the card that comes up when the browser takes the mouse.
 * In the mine, also the two crews' pours and where each barrow is, the
 * level plan, and a banner across the top when someone pours.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** a name with a dot: their hat colour on the plant, their crew's colour in the mine */
const who = (name: string, col: number, team = -1) =>
  `<span class="who"><i style="background:${hex(team >= 0 ? TEAMS[team].col : COLOURS[col % COLOURS.length])}"></i>${esc(name)}</span>`;

export interface Row { id: number; name: string; col: number; tags: number; deaths: number; me: boolean; team: number; pours: number }

export class ArenaHud {
  root = document.createElement('div');
  private el: Record<string, HTMLElement> = {};
  private feedEl: HTMLElement;
  private toastTimer = 0;
  private statusKind = '';
  private roundInfo: RoundInfo | null = null;
  private online = 1;
  private bannerTimer = 0;
  private teams: boolean;

  onResume: () => void = () => {};
  onLeave: () => void = () => {};

  constructor(private map: MapDef) {
    const r = this.root;
    r.id = 'arena';
    this.teams = map.mode === 'barrow';
    r.classList.toggle('crews', this.teams);
    const card = this.teams
      ? `<b>760 LEVEL</b>
        <p class="lead">Day shift against Night shift, underground. Each crew has one barrow of paste at its fill point.
          Get yours over the brow of <em>their</em> stope - ${BARROW.win} pours takes the round. No throwing with your hands full.</p>
        <ul>
          <li><kbd>WASD</kbd> move &middot; <kbd>Shift</kbd> run &middot; <kbd>Space</kbd> jump</li>
          <li><kbd>E</kbd> take hold of your barrow, or let go &middot; touch theirs to send it home</li>
          <li><kbd>Click</kbd> paste gun &middot; <kbd>Right click</kbd> throw a rock &middot; <kbd>Tab</kbd> scores</li>
          <li>Walk over <em class="cake">filter cake</em> for paste, and <em class="rock">rock</em> for rocks</li>
          <li>Now and then the power goes: cap lamps only, until it comes back. <kbd>L</kbd> switches yours off - they cannot see you coming, and you cannot see much</li>
        </ul>`
      : `<b>PASTE WARS</b>
        <p class="lead">After-shift splat tag on the backfill plant. Paste gun or rocks - no score counts until two are on shift.</p>
        <ul>
          <li><kbd>WASD</kbd> move &middot; <kbd>Shift</kbd> run &middot; <kbd>Space</kbd> jump</li>
          <li><kbd>Click</kbd> paste gun &middot; <kbd>Right click</kbd> throw a rock</li>
          <li><kbd>1</kbd> <kbd>2</kbd> or <kbd>Q</kbd> swap &middot; <kbd>Tab</kbd> scores &middot; <kbd>M</kbd> sound</li>
          <li>Walk over <em class="cake">filter cake</em> for paste, and <em class="rock">rock</em> for rocks</li>
        </ul>`;
    r.innerHTML = `
      <div class="me"><i class="hat"></i><b class="name">Clocking on...</b><span class="tags"></span></div>
      <div class="round"><b class="rn">WARM-UP</b><span class="rc"></span><time class="rt"></time></div>
      <div class="crew c0"><b class="n0"></b><strong class="p0">0</strong><span class="b0"></span></div>
      <div class="crew c1"><strong class="p1">0</strong><b class="n1"></b><span class="b1"></span></div>
      <div class="banner"></div>
      <div class="carry"></div>
      <div class="feed"></div>
      <div class="status"></div>
      <div class="cross"><i></i><i></i><i></i><i></i></div>
      <div class="hitmark"></div>
      <div class="toast"></div>
      <div class="vignette"></div>
      <div class="hint"></div>
      <div class="perf"></div>
      <div class="hp"><label>HEALTH</label><b class="hpn">100</b><div class="bar"><i class="hpb"></i></div></div>
      <div class="ammo">
        <div class="slot s0"><kbd>1</kbd><label>${WEAPONS[0].short}</label><b class="a0">0</b><small>/${WEAPONS[0].cap}</small></div>
        <div class="slot s1"><kbd>2</kbd><label>${WEAPONS[1].short}</label><b class="a1">0</b><small>/${WEAPONS[1].cap}</small></div>
      </div>
      <div class="down"><b>PLASTERED</b><p class="dby"></p><p class="dt"></p></div>
      <div class="board"><h3 class="bh"></h3><div class="bb"></div><p class="bf"></p></div>
      <div class="card">
        ${card}
        <p class="who-line"></p>
        <div class="row"><button class="go">Clock on</button><button class="leave">Leave the arena</button></div>
      </div>`;
    document.body.appendChild(r);
    r.querySelectorAll<HTMLElement>('[class]').forEach((e) => {
      for (const c of e.classList) if (!this.el[c]) this.el[c] = e;
    });
    this.feedEl = this.el.feed;
    if (this.teams) {
      [0, 1].forEach((t) => {
        this.el['n' + t].textContent = TEAMS[t].short;
        this.el['c' + t].style.setProperty('--crew', hex(TEAMS[t].col));
      });
    }
    this.el.go.onclick = (e) => { e.stopPropagation(); this.onResume(); };
    this.el.leave.onclick = (e) => { e.stopPropagation(); this.onLeave(); };
  }

  setMe(name: string, col: number, team = -1) {
    this.el.name.textContent = name;
    this.el.hat.style.background = hex(COLOURS[col % COLOURS.length]);
    this.el['who-line'].innerHTML = team >= 0
      ? `You are ${who(name, col, team)}, on <em style="color:${hex(TEAMS[team].col)}">${TEAMS[team].name}</em>.`
      : `You are ${who(name, col)} today.`;
    this.root.dataset.team = String(team);
    [0, 1].forEach((t) => this.el['c' + t].classList.toggle('ours', t === team));
  }

  /** the pours so far, and a word on where each barrow is */
  setCrews(ts: [number, number], where: [string, string]) {
    [0, 1].forEach((t) => {
      this.el['p' + t].textContent = String(ts[t]);
      this.el['b' + t].textContent = where[t];
    });
  }

  /** across the top, for a few seconds: someone poured, or a round was won */
  banner(html: string, colour: string, ms = 3200) {
    const b = this.el.banner;
    b.innerHTML = html;
    b.style.setProperty('--crew', colour);
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('on'), ms);
  }

  /** the frame rate and what it is drawn at, in the corner; null to hide it */
  perf(text: string | null) {
    this.el.perf.textContent = text ?? '';
    this.el.perf.classList.toggle('on', !!text);
  }

  /** what to do about the barrow in your hands, or near your feet */
  carry(html: string | null) {
    this.el.carry.innerHTML = html ?? '';
    this.el.carry.classList.toggle('on', !!html);
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
      this.el.rc.textContent = this.map.conditions[r.c % this.map.conditions.length].label;
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

  board(show: boolean, rows?: Row[], title?: string, footer?: string, ts?: [number, number]) {
    this.root.classList.toggle('scores', show);
    if (!show || !rows) return;
    this.el.bh.textContent = title ?? 'On shift';
    if (!this.teams) {
      const sorted = [...rows].sort((a, b) => b.tags - a.tags || a.deaths - b.deaths || a.id - b.id);
      this.el.bb.innerHTML = `<table><thead><tr><th></th><th>Tags</th><th>Plastered</th></tr></thead><tbody>${
        sorted.map((r) => `<tr class="${r.me ? 'self' : ''}"><td>${who(r.name, r.col)}</td><td>${r.tags}</td><td>${r.deaths}</td></tr>`).join('')
      }</tbody></table>`;
    } else {
      this.el.bb.innerHTML = [0, 1].map((t) => {
        const mine = rows.filter((r) => r.team === t)
          .sort((a, b) => b.pours - a.pours || b.tags - a.tags || a.deaths - b.deaths || a.id - b.id);
        const body = mine.map((r) => `<tr class="${r.me ? 'self' : ''}"><td>${who(r.name, r.col, r.team)}</td><td>${r.pours}</td><td>${r.tags}</td><td>${r.deaths}</td></tr>`).join('')
          || '<tr><td class="none" colspan="4">nobody on this crew yet</td></tr>';
        return `<table class="crew-table" style="--crew:${hex(TEAMS[t].col)}"><thead><tr><th>${TEAMS[t].name}<b>${ts?.[t] ?? 0}</b></th><th>Pours</th><th>Tags</th><th>Plastered</th></tr></thead><tbody>${body}</tbody></table>`;
      }).join('');
    }
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
