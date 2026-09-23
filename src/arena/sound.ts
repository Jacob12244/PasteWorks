/**
 * Every noise in the arena, made on the spot with WebAudio - there are no
 * sound files in PasteWorks and this does not start any. The context can
 * only begin after a click, which is fine: so can the game.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** call from a click or a key press */
  wake() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private get ok() { return !!this.ctx && !this.muted && this.ctx.state === 'running'; }

  /** a burst of filtered noise */
  private hiss(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'lowpass', sweep = 0, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  /** a pitched blip */
  private tone(dur: number, f0: number, f1: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** a wet thwup out of the gun, or the swish of a throw - quieter from someone else, further off */
  fire(w: 0 | 1, vol = 1) {
    if (!this.ok || vol < 0.03) return;
    if (w === 0) {
      this.hiss(0.12, 900, 3, 0.5 * vol, 'lowpass', 0.3);
      this.tone(0.09, 180, 70, 0.35 * vol, 'triangle');
    } else {
      this.hiss(0.22, 600, 1.2, 0.35 * vol, 'bandpass', 3);
    }
  }

  /** landed on the plant, `d` metres from you */
  splat(w: 0 | 1, d: number) {
    if (!this.ok) return;
    const v = Math.max(0, 1 - d / 45);
    if (v < 0.03) return;
    if (w === 0) this.hiss(0.16, 700, 2, 0.45 * v, 'lowpass', 0.4);
    else { this.tone(0.07, 900, 300, 0.25 * v, 'square'); this.hiss(0.1, 2400, 1, 0.2 * v, 'highpass'); }
  }

  /** yours landed on someone */
  hitMark(head: boolean) {
    if (!this.ok) return;
    this.tone(0.06, head ? 1900 : 1400, head ? 2300 : 1500, 0.22, 'square');
  }

  /** something landed on you */
  hurt() {
    if (!this.ok) return;
    this.tone(0.18, 140, 60, 0.5, 'sine');
    this.hiss(0.15, 500, 1, 0.3);
  }

  pickup() {
    if (!this.ok) return;
    this.tone(0.08, 660, 660, 0.18, 'triangle');
    this.tone(0.1, 990, 990, 0.18, 'triangle', 0.07);
  }

  empty() {
    if (!this.ok) return;
    this.tone(0.04, 300, 250, 0.15, 'square');
  }

  down() {
    if (!this.ok) return;
    this.tone(0.7, 380, 90, 0.3, 'sawtooth');
  }

  tagged() {
    if (!this.ok) return;
    this.tone(0.12, 880, 880, 0.2, 'triangle');
    this.tone(0.2, 1320, 1320, 0.2, 'triangle', 0.1);
  }

  /** the site horn: a round starts or ends */
  horn() {
    if (!this.ok) return;
    this.tone(0.9, 233, 233, 0.22, 'sawtooth');
    this.tone(0.9, 311, 311, 0.16, 'sawtooth');
  }
}
