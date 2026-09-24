import { Room } from './shared/room';
import { PROTOCOL, TICK_HZ } from './shared/rules';
import type { ClientMsg, ServerMsg } from './shared/protocol';
import type { MapDef, MapId } from './shared/maps';
import type { TriangleGrid } from '../view/grid';

/**
 * The line to the room: a WebSocket to the arena server, or - when there is
 * no server to be had - a room of our own, running in this page on the same
 * code, with just us in it.
 */
export interface Conn {
  readonly offline: boolean;
  send(m: ClientMsg): void;
  close(): void;
  onMessage: (m: ServerMsg) => void;
  /** closed: the code, and whether it had ever opened */
  onClose: (code: number, opened: boolean) => void;
}

/** a token for each room: the plant's keeps the name it has always had */
const token = (map: MapId) => (map === 'plant' ? 'pw-arena-token' : 'pw-arena-token-' + map);

export function savedToken(map: MapId): string | undefined {
  try { return sessionStorage.getItem(token(map)) ?? undefined; } catch { return undefined; }
}
export function saveToken(map: MapId, k: string) {
  try { sessionStorage.setItem(token(map), k); } catch { /* private window: a fresh name next time */ }
}

/** The arena server, on this host at /play, asking for the room this map is played in. */
export function socket(map: MapId): Conn {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/play?map=${map}`);
  let opened = false;
  const conn: Conn = {
    offline: false,
    send(m) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close() { ws.close(1000); },
    onMessage: () => {},
    onClose: () => {},
  };
  ws.onopen = () => {
    opened = true;
    conn.send({ t: 'hi', v: PROTOCOL, k: savedToken(map) });
  };
  ws.onmessage = (e) => {
    let m: ServerMsg;
    try { m = JSON.parse(e.data as string); } catch { return; }
    conn.onMessage(m);
  };
  ws.onclose = (e) => conn.onClose(e.code, opened);
  return conn;
}

/**
 * A room in this page. Messages still go through JSON both ways, so
 * practice behaves exactly like the wire - nothing shares an object with the
 * room that it could quietly change.
 */
export function local(grid: TriangleGrid, hash: string, map: MapDef): Conn {
  let n = 0;
  const room = new Room(grid, map, {
    hash,
    now: () => performance.now(),
    token: () => 'local-' + (++n),
  });
  const conn: Conn = {
    offline: true,
    send(m) { if (player) room.message(player, JSON.parse(JSON.stringify(m))); },
    close() { clearInterval(timer); room.close(); },
    onMessage: () => {},
    onClose: () => {},
  };
  const link = {
    send: (m: ServerMsg) => {
      const copy = JSON.parse(JSON.stringify(m)) as ServerMsg;
      queueMicrotask(() => conn.onMessage(copy));
    },
    close: () => {},
  };
  const timer = setInterval(() => room.tick(), 1000 / TICK_HZ);
  let player: ReturnType<Room['join']> = null;
  // after the caller has had a chance to set onMessage
  queueMicrotask(() => { player = room.join(link, { t: 'hi', v: PROTOCOL }); });
  return conn;
}
