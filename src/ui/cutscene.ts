/**
 * The opening: a handful of camera moves over the world, each carrying a line
 * or two of how things came to this. Letterboxed, typed in, cut through black
 * between shots - and then an objective card, and then the chair.
 *
 * Click moves to the next beat; Skip (or Esc, Space, Enter) goes straight to
 * the desk. The plant is running underneath the whole time, so the rakes are
 * turning and the rail is firing while you read.
 */
import * as THREE from 'three';
import type { Stage } from '../view/scene';
import type { Scenario, Beat, Frame } from '../scenario';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export class Cutscene {
  playing = false;
  private root = el('div');
  private kicker = el('div', 'cs-kicker');
  private title = el('div', 'cs-title');
  private text = el('div', 'cs-text');
  private dots = el('div', 'cs-dots');
  private black = el('div', 'cs-black');
  private i = -1;
  private t0 = 0;
  private raf = 0;
  private typed = 0;
  private done = false;
  private from = { p: new THREE.Vector3(), a: new THREE.Vector3() };
  private to = { p: new THREE.Vector3(), a: new THREE.Vector3() };
  private fov0 = 46;

  constructor(private stage: Stage, private sc: Scenario, private onDone: () => void) {
    this.root.id = 'cutscene';
    const top = el('div', 'cs-bar top');
    const bot = el('div', 'cs-bar bot');
    const cap = el('div', 'cs-cap');
    cap.append(this.kicker, this.title, this.text);
    const skip = el('button', 'cs-skip', 'Skip&nbsp;&nbsp;&#9656;&#9656;');
    skip.onclick = (e) => { e.stopPropagation(); this.skip(); };
    const place = el('div', 'cs-place', sc.place);
    this.root.append(this.black, top, bot, cap, this.dots, skip, place);
    for (let k = 0; k < sc.story.length; k++) this.dots.append(el('i'));
    this.root.addEventListener('click', () => this.next());
    document.body.append(this.root);
  }

  play() {
    this.playing = true;
    this.fov0 = this.stage.camera.fov;
    this.stage.setFov(40);
    this.stage.controls.enabled = false;
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.next();
    const tick = () => {
      if (!this.playing) return;
      this.raf = requestAnimationFrame(tick);
      this.frame();
    };
    tick();
  }

  /** Straight to the desk. */
  skip() {
    if (!this.playing) return;
    this.finish();
  }

  private next() {
    if (!this.playing) return;
    this.i++;
    if (this.i >= this.sc.story.length) { this.objective(); return; }
    const b = this.sc.story[this.i];
    this.cut(b);
  }

  /** Hard cut through black, the way a film cuts between locations. */
  private cut(b: Beat) {
    this.black.classList.add('on');
    setTimeout(() => {
      if (!this.playing) return;
      this.set(this.from, b.from);
      this.set(this.to, b.to);
      this.t0 = performance.now();
      this.frame();
      this.kicker.textContent = b.kicker ?? '';
      this.title.textContent = b.title ?? '';
      this.text.textContent = '';
      this.typed = 0;
      this.root.classList.toggle('has-title', !!b.title);
      [...this.dots.children].forEach((d, k) => d.classList.toggle('on', k <= this.i));
      this.black.classList.remove('on');
    }, this.i === 0 ? 60 : 260);
  }

  private set(o: { p: THREE.Vector3; a: THREE.Vector3 }, f: Frame) {
    o.p.set(f[0], f[1], f[2]);
    o.a.set(f[3], f[4], f[5]);
  }

  private frame() {
    if (this.i < 0 || this.i >= this.sc.story.length) return;
    const b = this.sc.story[this.i];
    const age = performance.now() - this.t0;
    const k = ease(Math.min(1, age / b.ms));
    const cam = this.stage.camera;
    cam.position.lerpVectors(this.from.p, this.to.p, k);
    this.stage.controls.target.lerpVectors(this.from.a, this.to.a, k);
    cam.lookAt(this.stage.controls.target);

    // type the line in over the first part of the shot
    const full = b.text ?? '';
    const want = Math.min(full.length, Math.floor(age / 24));
    if (want > this.typed) {
      this.typed = want;
      this.text.textContent = full.slice(0, want);
    }
    // move on when the shot is done and the reader has had a moment
    if (age > b.ms) this.next();
  }

  private objective() {
    this.black.classList.add('on', 'card');
    this.black.innerHTML = '';
    const card = el('div', 'cs-obj');
    card.append(
      el('em', undefined, 'Your shift'),
      el('b', undefined, this.sc.objective),
      el('span', undefined, 'Everything on the screens is computed, not animated. '
        + 'Drag to look around the control room.'),
    );
    this.black.append(card);
    setTimeout(() => this.finish(), 3600);
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stage.setFov(this.fov0);
    this.root.classList.remove('on');
    this.root.classList.add('off');
    setTimeout(() => this.root.remove(), 900);
    this.onDone();
  }
}
