/**
 * The arena server: one room, fifteen slots, no accounts.
 *
 *   npm run arena            build and run it on :8481 (the dev server proxies /play here)
 *
 * Everything that decides the game is in src/arena/shared/room.ts; this file
 * is the door. It serves the WebSocket at /play, a health check for the
 * container, and a one-line status. It keeps nothing: restart it and the
 * room is empty, which is all there ever is to lose.
 *
 * Because anyone with the link can connect, the door is where the limits
 * are: an origin check, a cap on connections from one address, a cap on how
 * often one address can join, a small maximum message size, a token bucket
 * on messages, and a ping to find sockets that have quietly died.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Room, type Link, type Player } from '../src/arena/shared/room';
import { TriangleGrid, gridHash } from '../src/view/grid';
import { TICK_HZ } from '../src/arena/shared/rules';
import type { ServerMsg } from '../src/arena/shared/protocol';

const env = process.env;
const PORT = Number(env.PORT ?? 8481);
/** pages allowed to open a socket; a client that sends no Origin (a script) is let in */
const ORIGINS = (env.ALLOWED_ORIGINS
  ?? 'https://pasteworks.minesmart.cloud,http://localhost:5180,http://127.0.0.1:5180,http://localhost:4173')
  .split(',').map((s) => s.trim()).filter(Boolean);
/** open sockets from one address - a household or an office shares one */
const PER_IP = Number(env.PER_IP ?? 6);
/** joins from one address a minute */
const JOINS_PER_MIN = Number(env.JOINS_PER_MIN ?? 20);
/** messages a second per socket, and the burst on top */
const RATE = 60, BURST = 120;

const log = (s: string) => console.log(new Date().toISOString().slice(0, 19) + 'Z ' + s);

// ------------------------------------------------------------------ the world

/**
 * The collision world, baked out of the page by tools/bake.mjs: nine
 * float32s a triangle, gzipped. Found next to the bundle in the image, and
 * in server/worlds when run from the repo.
 */
function loadWorld() {
  const here = __dirname;
  const file = [env.WORLD_FILE, path.join(here, 'worlds', 'arena.bin.gz'), path.join(here, '..', 'worlds', 'arena.bin.gz')]
    .find((f) => f && fs.existsSync(f));
  if (!file) throw new Error('no baked world - run npm run bake');
  const raw = zlib.gunzipSync(fs.readFileSync(file));
  const tris = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const grid = new TriangleGrid();
  grid.addArray(tris);
  grid.finish();
  return { grid, hash: gridHash(grid.triangles()), file };
}

const world = loadWorld();
log(`world ${path.basename(world.file)}: ${world.grid.size} triangles, ${world.hash}`);

const room = new Room(world.grid, {
  hash: world.hash,
  now: () => performance.now(),
  token: () => crypto.randomBytes(12).toString('hex'),
  log,
});
setInterval(() => room.tick(), 1000 / TICK_HZ);

// ------------------------------------------------------------------ http

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n');
  } else if (url === '/play/status') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ online: room.online, max: room.max }));
  } else {
    res.writeHead(404).end();
  }
});

// ------------------------------------------------------------------ sockets

const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
const perIp = new Map<string, number>();
const joins = new Map<string, number[]>();

/** Behind the host nginx every socket comes from loopback; the real address is in X-Real-IP. */
function addressOf(req: http.IncomingMessage) {
  const remote = req.socket.remoteAddress ?? '?';
  const real = req.headers['x-real-ip'];
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1' || remote.startsWith('172.');
  return local && typeof real === 'string' && real ? real : remote;
}

function refuse(socket: import('node:stream').Duplex, code: number, text: string) {
  socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

server.on('upgrade', (req, socket, head) => {
  const url = (req.url ?? '').split('?')[0];
  if (url !== '/play') return refuse(socket, 404, 'Not Found');
  const origin = req.headers.origin;
  if (origin && !ORIGINS.includes(origin)) return refuse(socket, 403, 'Forbidden');

  const ip = addressOf(req);
  if ((perIp.get(ip) ?? 0) >= PER_IP) return refuse(socket, 429, 'Too Many Requests');
  const now = Date.now();
  const recent = (joins.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= JOINS_PER_MIN) return refuse(socket, 429, 'Too Many Requests');
  recent.push(now);
  joins.set(ip, recent);

  wss.handleUpgrade(req, socket, head, (ws) => connected(ws, ip));
});

/** One serialisation per message, however many sockets it goes to. */
const wire = new WeakMap<object, string>();
function encode(m: ServerMsg) {
  let s = wire.get(m);
  if (!s) { s = JSON.stringify(m); wire.set(m, s); }
  return s;
}

function connected(ws: WebSocket, ip: string) {
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  let player: Player | null = null;
  let tokens = BURST, filled = performance.now(), flood = 0;
  let alive = true;

  const link: Link = {
    send(m) { if (ws.readyState === WebSocket.OPEN) ws.send(encode(m)); },
    close(code, why) { ws.close(code, why); },
  };
  // Say hello or go away. Not promptly: a page opens its socket and then
  // compiles every shader in the plant for its first frame, and the hello
  // cannot go until that is done - seconds, on a slow machine.
  const hello = setTimeout(() => ws.close(4000, 'no hello'), 20_000);
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);
  ws.on('pong', () => { alive = true; });

  ws.on('message', (data, binary) => {
    const now = performance.now();
    tokens = Math.min(BURST, tokens + ((now - filled) / 1000) * RATE);
    filled = now;
    if (tokens < 1) {
      if (++flood > 200) {
        link.send({ t: 'bye', why: 'flood' });
        ws.close(4003, 'flood');
      }
      return;
    }
    tokens--;
    if (binary) return;
    let m: unknown;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!player) {
      clearTimeout(hello);
      player = room.join(link, m);
      return;
    }
    room.message(player, m);
  });

  ws.on('close', () => {
    clearTimeout(hello);
    clearInterval(ping);
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    if (player) room.drop(player);
  });
  ws.on('error', () => { /* the close that follows does the tidying */ });
}

// the join log would otherwise remember every address forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of joins) if (ts.every((t) => now - t > 60_000)) joins.delete(ip);
}, 60_000);

server.listen(PORT, () => log(`arena on :${PORT}, ${room.max} slots, origins ${ORIGINS.join(' ')}`));

function stop() {
  log('stopping');
  room.close();
  server.close();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
