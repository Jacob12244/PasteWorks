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
// and in the mine, the barrow game:
//   crews     two joiners go on opposite crews, and the round starts
//   grab      E at your own fill point puts the barrow in your hands
//   no throw  nothing leaves your hands while they are on the barrow
//   pour      the barrow over the brow of their stope scores, and goes home to refill
//   regrab    let go of it, pick it up again, and it still pours
//   drop      put the pusher down and the barrow goes down where they fell
//   tip       the other crew walking onto it sends it home
//   friendly  paste goes straight through your own crew
//   status    /play/status counts each room
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
  constructor(port, map) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/play${map ? '?map=' + map : ''}`);
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
    this.send({ t: 'hi', v: 2 });
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

  // ---- the mine: Day against Night, and the barrows
  const m1 = new Bot(PORT, 'mine'), m2 = new Bot(PORT, 'mine');
  const h1 = await m1.hello(), h2 = await m2.hello();
  check('mine: crews', h1?.map === 'mine' && h2?.map === 'mine' && h1.tm + h2.tm === 1 && !!h1.bar,
    h1 && h2 ? `${h1.name} on ${h1.tm ? 'night' : 'day'}, ${h2.name} on ${h2.tm ? 'night' : 'day'}` : 'no hello');
  const [day, night] = h1.tm === 0 ? [m1, m2] : [m2, m1];
  const mrd = await day.wait((m) => m.t === 'Rd' && m.r.st === 'play', 3000);
  check('mine: round starts', !!mrd);
  await sleep(150);

  // Day takes its barrow at its fill point...
  await day.walkTo(-73.5, 5.1);
  const g0 = day.msgs.length;
  day.send({ t: 'b' });
  const grab = await day.wait((m) => m.t === 'B' && m.ev === 'grab' && m.b === 0, 1500, g0);
  check('mine: grab', !!grab && grab.by === day.id && grab.st === 'held');
  // ...and cannot throw while it is in their hands
  const f0 = day.msgs.length;
  day.fireAt([-60, 1.5, 5], 5001);
  const thrown = await day.wait((m) => m.t === 'F' && m.o === day.id, 500, f0);
  check('mine: no throwing with the barrow', !thrown);

  // over the brow of Night's stope: the far end of the level, the long way in a straight line
  await day.walkTo(58, 26);
  const p0 = day.msgs.length;
  await day.walkTo(60.2, 29.3);
  const pour = await day.wait((m) => m.t === 'B' && m.ev === 'pour', 2000, p0);
  check('mine: pour', !!pour && pour.b === 0 && pour.by === day.id && pour.ts[0] === 1 && pour.st === 'away',
    pour ? `${pour.ts[0]} - ${pour.ts[1]}, barrow away until ${pour.until}` : 'no pour');

  // once it is full again: let go of it on the way, pick it up again, and it still pours
  const full = await day.wait((m) => m.t === 'B' && m.ev === 'full' && m.b === 0, 9000, p0);
  await day.walkTo(-73.5, 5.1);
  day.send({ t: 'b' });
  await day.walkTo(-62, 4.2);
  const l0 = day.msgs.length;
  day.send({ t: 'b' });
  const let0 = await day.wait((m) => m.t === 'B' && m.ev === 'drop' && m.b === 0, 1500, l0);
  await day.walkTo(-58, 5);
  await day.walkTo(-62.3, 4.2);
  const r0 = day.msgs.length;
  day.send({ t: 'b' });
  const regrab = await day.wait((m) => m.t === 'B' && m.ev === 'grab' && m.b === 0, 1500, r0);
  await day.walkTo(58, 26);
  const q0 = day.msgs.length;
  await day.walkTo(60.2, 29.3);
  const pour2 = await day.wait((m) => m.t === 'B' && m.ev === 'pour', 2000, q0);
  check('mine: let go, pick up, pour', !!full && !!let0 && !!regrab && !!pour2 && pour2.ts[0] === 2,
    `full ${!!full}, let go ${!!let0}, picked up ${!!regrab}, poured ${pour2 ? pour2.ts.join('-') : 'no'}`);

  // Night takes theirs, and Day, standing in the fill cuddy with them, puts them down
  await Promise.all([night.walkTo(73.8, -5.1), day.walkTo(58, 12), sleep(10)]);
  await day.walkTo(67.5, -4.4);
  const n0 = night.msgs.length;
  night.send({ t: 'b' });
  const ngrab = await night.wait((m) => m.t === 'B' && m.ev === 'grab' && m.b === 1, 1500, n0);
  check('mine: night grabs', !!ngrab);
  let down = null;
  for (let s = 6000; s < 6030 && !down; s++) {
    day.fireAt([night.pos[0], night.pos[1] + 1.1, night.pos[2]], s);
    await sleep(190);
    down = day.msgs.find((m) => m.t === 'B' && m.ev === 'drop' && m.b === 1);
  }
  check('mine: pusher down, barrow down', !!down && down.st === 'down' && Math.hypot(down.p[0] - night.pos[0], down.p[2] - night.pos[2]) < 0.5,
    down ? `lying at ${down.p.join(', ')}` : 'never dropped');

  // Day walks onto it: tipped out, back to Night's fill point
  const t0 = day.msgs.length;
  if (down) await day.walkTo(down.p[0] - 0.5, down.p[2]);
  const tip = await day.wait((m) => m.t === 'B' && m.ev === 'tip' && m.b === 1, 1500, t0);
  check('mine: tip', !!tip && tip.by === day.id && tip.st === 'home');

  // a third on shift goes to the crew that is behind, and Night's own paste goes straight through them
  const m3 = new Bot(PORT, 'mine');
  const h3 = await m3.hello();
  check('mine: joins the crew behind', h3?.tm === 1, `on ${h3?.tm ? 'night' : 'day'}`);
  await sleep(4300);   // Night comes back from being put down
  await Promise.all([night.walkTo(68, -4.6), m3.walkTo(74, -5.2), day.walkTo(58, 12)]);
  await sleep(2100);
  const f3 = m3.msgs.length;
  m3.fireAt([night.pos[0], night.pos[1] + 1.1, night.pos[2]], 7001);
  const land = await m3.wait((m) => m.t === "X" || m.t === "H", 2000, f3);
  check('mine: no friendly fire', !!land && land.t === 'X', land ? (land.t === 'H' ? `hit ${land.v}` : 'went past, hit the rock') : 'nothing came back');

  const st = await (await fetch(`http://127.0.0.1:${PORT}/play/status`)).json();
  check('status per room', st.rooms?.mine?.online === 3 && st.rooms?.plant?.online === st.online, JSON.stringify(st.rooms));
  [m1, m2, m3].forEach((b) => b.close());
  await sleep(200);

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
