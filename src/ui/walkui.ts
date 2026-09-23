/**
 * What is on screen while you walk: a crosshair, what it is pointing at, the
 * keys, and a card for when the browser takes the mouse back.
 */
export class WalkUI {
  private root = document.getElementById('walk')!;
  private cross: HTMLElement;
  private prompt: HTMLElement;
  private note: HTMLElement;
  private noteTimer = 0;

  onResume: () => void = () => {};
  onStop: () => void = () => {};

  constructor() {
    const r = this.root;
    r.innerHTML = '';
    const keys = document.createElement('div');
    keys.className = 'keys';
    keys.innerHTML = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &middot; '
      + '<kbd>Shift</kbd> run &middot; <kbd>Space</kbd> jump &middot; <kbd>E</kbd> inspect &middot; '
      + '<kbd>R</kbd> back to the door &middot; <kbd>F</kbd> stop walking';
    this.cross = document.createElement('div');
    this.cross.className = 'cross';
    this.prompt = document.createElement('div');
    this.prompt.className = 'prompt';
    this.note = document.createElement('div');
    this.note.className = 'note';

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<b>ON FOOT</b><p>The plant is still running.<br>'
      + 'Click to carry on walking, or <kbd>Esc</kbd> to stop.</p>';
    const row = document.createElement('div');
    row.className = 'row';
    const go = document.createElement('button');
    go.textContent = 'Keep walking';
    go.onclick = (e) => { e.stopPropagation(); this.onResume(); };
    const stop = document.createElement('button');
    stop.textContent = 'Stop walking';
    stop.onclick = (e) => { e.stopPropagation(); this.onStop(); };
    row.append(go, stop);
    card.append(row);

    r.append(keys, this.note, this.cross, this.prompt, card);
  }

  show(on: boolean) {
    this.root.classList.toggle('on', on);
    if (!on) this.root.classList.remove('paused');
  }

  setPaused(p: boolean) {
    this.root.classList.toggle('paused', p);
  }

  /** what the crosshair is on, and what E will do about it; null for nothing */
  setPrompt(html: string | null) {
    this.prompt.classList.toggle('show', !!html);
    this.cross.classList.toggle('aim', !!html);
    if (html) this.prompt.innerHTML = html;
  }

  /** a line across the top for a few seconds */
  say(text: string, ms = 4500) {
    this.note.textContent = text;
    this.note.classList.add('show');
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => this.note.classList.remove('show'), ms);
  }
}
