// The arena server, played by scripted bots over real sockets.
//
//   npm run verify:arena       (builds the server first; needs server/worlds/arena.bin.gz)
//
// Starts its own server on a spare port, so it never touches one you are
// playing on, and checks what the room promises:
//   join      a hello gets a name, a hat, the baked world's fingerprint
//   round     two on shift starts round 1
//   hit       paste at someone six metres off lands, for the paste damage
//   tag       enough of it puts them down, the thrower gets the tag, they come back
//   wall      a lump thrown into a container stops at the container
//   ammo      an empty hopper throws nothing; filter cake fills it
//   fix       a report from across the pad is refused and corrected
//   full      the sixteenth is turned away
//   junk      nonsense gets you shown the door
//   flood     so does a firehose of messages
//   per-ip    a second server with a low per-address cap refuses the extra socket
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

function server(port, env = {}) {
  const p = spawn(process.execPath, [path.join(root, 'server', 'dist', 'arena.cjs')], {
    env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  return {
    proc: p,
    get log() { return out; },
    ready: (async () => {
      for (let i = 0; i < 100 && !out.includes('arena on'); i++) await sleep(50);
      if (!out.includes('arena on')) throw new Error('server did not start:\n' + out);
    })(),
  };
}

class Bot {
  constructor(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/play`);
    this.msgs = [];
    this.id = 0;
    this.pos = [0, 0, 0];
    this.life = 0;
    this.ammo = [0, 0];
    this.closed = null;
    this.open = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      if (m.t === 'hi') this.id = m.id;
      if (m.t === 'R' && m.id === this.id) { this.pos = m.p.slice(); this.life = m.l; }
      if (m.t === 'A') this.ammo = m.a;
      if (m.t === 'fix') this.pos = m.p.slice();
    });
    this.ws.on('close', (code) => { this.closed = code; });
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  async hello() {
    await this.open;
    this.send({ t: 'hi', v: 1 });
    return this.wait((m) => m.t === 'hi' || m.t === 'full');
  }
  async wait(pred, ms = 3000, from = 0) {
    const t0 = Date.now();
    for (;;) {
      const m = this.msgs.slice(from).find(pred);
      if (m) return m;
      if (Date.now() - t0 > ms) return null;
      await sleep(20);
    }
  }
  report() {
    this.send({ t: 's', p: this.pos, a: [0, 0], w: 0, f: 1, l: this.life });
  }
  /** walk there in a straight line at a jog, reporting as a page would */
  async walkTo(x, z) {
    for (;;) {
      const dx = x - this.pos[0], dz = z - this.pos[2];
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, 0.35);
      if (d > 1e-3) {
        this.pos[0] += (dx / d) * step;
        this.pos[2] += (dz / d) * step;
      }
      this.report();
      await sleep(50);
      if (d <= 0.35) break;
    }
    this.pos = [x, 0.05, z];
    this.report();
    await sleep(60);
  }
  fireAt(target, s, w = 0) {
    const o = [this.pos[0], this.pos[1] + 1.62, this.pos[2]];
    const d = [target[0] - o[0], target[1] - o[1], target[2] - o[2]];
    const n = Math.hypot(...d);
    this.send({ t: 'f', w, o, d: d.map((v) => v / n), s });
  }
  close() { this.ws.close(); }
}

const PORT = 8499;
const srv = server(PORT, { PER_IP: '50', JOINS_PER_MIN: '500' });
try {
  await srv.ready;

  // ---- join
  const a = new Bot(PORT);
  const hiA = await a.hello();
  check('join', hiA?.t === 'hi' && hiA.id > 0 && /\w+ \d+/.test(hiA.name) && /^[0-9a-f]{8}:\d+$/.test(hiA.hash),
    hiA ? `${hiA.name}, world ${hiA.hash}` : 'no hello back');
  check('warm-up alone', hiA?.round.st === 'warmup');

  // ---- round starts with two
  const b = new Bot(PORT);
  await b.hello();
  const rd = await a.wait((m) => m.t === 'Rd' && m.r.st === 'play');
  check('round starts with two', !!rd, rd ? `round ${rd.r.n}, condition ${rd.r.c}` : '');
  await sleep(150);

  // ---- hit: stand them six metres apart in the north yard, clear of everything
  // (check the line is still clear after moving props about)
  await Promise.all([a.walkTo(-28, -14), b.walkTo(-28, -20)]);
  // b throws once, which drops its spawn shield
  b.fireAt([-28, 20, -60], 900);
  await sleep(2100);
  const from = a.msgs.length;
  a.fireAt([b.pos[0], b.pos[1] + 1.1, b.pos[2]], 1);
  const hit = await a.wait((m) => m.t === 'H' && m.v === b.id, 2000, from);
  check('paste hits', !!hit && hit.d === 16 && hit.a === a.id, hit ? `damage ${hit.d}, ${hit.hp} left` : 'no hit');

  // ---- tag: keep throwing until b goes down
  let k = null;
  for (let s = 2; s < 20 && !k; s++) {
    a.fireAt([b.pos[0], b.pos[1] + 1.1, b.pos[2]], s);
    await sleep(200);
    k = a.msgs.find((m) => m.t === 'K' && m.v === b.id);
  }
  check('tag', !!k && k.a === a.id, k ? `${WEAPON(k.w)}, hard hat ${k.hh}` : 'b never went down');
  const downAt = b.msgs.findIndex((m) => m.t === 'K' && m.v === b.id);
  const back = downAt < 0 ? null : await b.wait((m) => m.t === 'R' && m.id === b.id, 6000, downAt);
  check('respawn', !!back, back ? `after the delay, at ${back.p.join(', ')}` : '');

  // ---- wall: the north-yard container at (10, -29) stands between
  await a.walkTo(10, -24);
  await sleep(700);
  const fw = a.msgs.length;
  a.fireAt([10, 1.2, -40], 50);
  const x = await a.wait((m) => m.t === 'X' && m.n, 2000, fw);
  check('wall stops a lump', !!x && Math.abs(x.p[2] - -27.8) < 0.3, x ? `landed at z ${x.p[2]}, normal ${x.n.join(', ')}` : 'no impact');

  // ---- ammo: throw the lot, then fill up on cake
  await sleep(300);
  for (let s = 100; s < 200 && a.ammo[0] > 0; s++) {
    a.fireAt([10, 30, -60], s);
    await sleep(175);
  }
  check('hopper runs dry', a.ammo[0] === 0, `paste ${a.ammo[0]}`);
  const fd = a.msgs.length;
  a.fireAt([10, 30, -60], 300);
  const dry = await a.wait((m) => m.t === 'F' && m.o === a.id, 500, fd);
  check('dry hopper throws nothing', !dry);
  await a.walkTo(22, -18.4);
  const g = await a.wait((m) => m.t === 'G' && m.w === 0, 2000);
  check('filter cake refills', !!g && a.ammo[0] === g.n, g ? `+${g.n} paste` : 'no pickup');

  // ---- fix: claim to be across the pad
  const ff = a.msgs.length;
  a.send({ t: 's', p: [-60, 0.05, 30], a: [0, 0], w: 0, f: 1, l: a.life });
  const fix = await a.wait((m) => m.t === 'fix', 1000, ff);
  check('teleport refused', !!fix, fix ? `sent back to ${fix.p.join(', ')}` : '');

  // ---- junk
  const j = new Bot(PORT);
  await j.hello();
  for (let i = 0; i < 60; i++) j.send({ t: 'nonsense', i });
  await sleep(400);
  check('junk shown the door', j.closed === 4003, `closed ${j.closed}`);

  // ---- flood
  const f = new Bot(PORT);
  await f.hello();
  for (let i = 0; i < 600; i++) f.send({ t: 's', p: [0, 0, 0], a: [0, 0], w: 0, f: 0, l: -1 });
  await sleep(500);
  check('flood shown the door', f.closed === 4003, `closed ${f.closed}`);

  // ---- full, last: a slot is held a while after a socket goes, so
  // thirteen more on top of a and b makes fifteen, then one too many
  const crowd = [];
  for (let i = 0; i < 13; i++) {
    const c = new Bot(PORT);
    crowd.push(c);
    await c.hello();
  }
  const extra = new Bot(PORT);
  const no = await extra.hello();
  await sleep(200);
  check('sixteenth turned away', no?.t === 'full' && extra.closed === 4001, `closed ${extra.closed}`);
  crowd.forEach((c) => c.close());
  await sleep(300);

  a.close();
  b.close();
} finally {
  srv.proc.kill();
}

// ---- per-address cap, on a server of its own
const tight = server(PORT + 1, { PER_IP: '2' });
try {
  await tight.ready;
  const ok1 = new Bot(PORT + 1), ok2 = new Bot(PORT + 1);
  await Promise.all([ok1.open, ok2.open]);
  const third = new Bot(PORT + 1);
  let refused = false;
  try { await third.open; } catch (e) { refused = /429/.test(String(e.message)); }
  check('per-address cap', refused);
  ok1.close(); ok2.close();
} finally {
  tight.proc.kill();
}

function WEAPON(w) { return w === 0 ? 'paste' : 'rock'; }
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
