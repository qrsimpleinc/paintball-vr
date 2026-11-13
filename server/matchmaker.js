// Matchmaking: decides which game server and room each player goes to.
// Game servers ("nodes") report their rooms every couple of seconds. The matchmaker keeps
// no match state of its own, so after a restart it knows everything again within one report.
// On a local network the same code runs inside the single server process.
import crypto from 'node:crypto';
import { MODES, MAX_PLAYERS } from '../shared/constants.js';

const NODE_TIMEOUT = 8000;      // a node that has not reported for this long is gone
const RESERVE_TIME = 8000;      // how long a place is held for a player who is still connecting
const PENDING_TIME = 15000;     // how long an assigned room is remembered before its node reports it
const MIN_WAIT_LEFT = 5;        // don't send anyone to a room about to start (seconds)
const TICKET_TIME = 60000;      // a ticket must be used within this time

// ---- tickets: proof that the matchmaker sent this player to this room ---------------------
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

export function makeTicket(data, secret) {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + TICKET_TIME })).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function readTicket(ticket, secret) {
  if (typeof ticket !== 'string' || ticket.length > 512) return null;
  const [body, mac] = ticket.split('.');
  if (!body || !mac) return null;
  const a = Buffer.from(mac), b = Buffer.from(sign(body, secret));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export const cleanRoom = (code) => String(code || 'public').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'public';

// ---- matchmaker ---------------------------------------------------------------------------
export class Matchmaker {
  constructor(secret) {
    this.secret = secret;
    this.nodes = new Map();     // id -> { id, url, region, maxRooms, rooms: [room.info()], seen }
    this.pending = new Map();   // room code -> { nodeId, mode, find, at, humans, seats: [times] }
  }

  // A node reports its rooms. Players who have arrived no longer need a held place.
  report(rep) {
    this.nodes.set(rep.id, { ...rep, seen: Date.now() });
    for (const r of rep.rooms) {
      const p = this.pending.get(r.code);
      if (!p) continue;
      p.seats.splice(0, Math.max(0, r.humans - p.humans));
      p.humans = r.humans;
    }
  }

  aliveNodes() {
    const now = Date.now();
    for (const [id, n] of this.nodes) if (now - n.seen > NODE_TIMEOUT) { this.nodes.delete(id); if (n.url) console.log(`node ${id} is gone`); }
    return [...this.nodes.values()];
  }

  // One entry per region, so the client can measure which is closest.
  regions() {
    const out = new Map();
    for (const n of this.aliveNodes()) if (n.url && !out.has(n.region)) out.set(n.region, { id: n.region, url: n.url });
    return [...out.values()];
  }

  reservedSeats(code, now) {
    const p = this.pending.get(code);
    if (!p) return 0;
    p.seats = p.seats.filter((t) => now - t < RESERVE_TIME);
    return p.seats.length;
  }

  // Rooms that are in their warm-up and still have a free place.
  openRooms(mode, nodes, now) {
    const open = [], reported = new Set();
    for (const n of nodes) {
      for (const r of n.rooms) {
        reported.add(r.code);
        if (!r.find || r.state !== 'waiting' || r.mode !== mode || r.startsIn < MIN_WAIT_LEFT) continue;
        const taken = r.humans + this.reservedSeats(r.code, now);
        if (taken < MAX_PLAYERS) open.push({ code: r.code, node: n, taken });
      }
    }
    // just assigned: the node has not reported the room yet
    for (const [code, p] of this.pending) {
      if (reported.has(code) || !p.find || p.mode !== mode || now - p.at > RESERVE_TIME) continue;
      const node = nodes.find((n) => n.id === p.nodeId);
      const taken = this.reservedSeats(code, now);
      if (node && taken < MAX_PLAYERS) open.push({ code, node, taken });
    }
    return open.sort((a, b) => b.taken - a.taken);
  }

  // The least busy node with room for one more match, in the wanted region when possible.
  pickNode(nodes, region, strict, now) {
    const roomsOn = (n) => n.rooms.length + [...this.pending.entries()]
      .filter(([code, p]) => p.nodeId === n.id && now - p.at < PENDING_TIME && !n.rooms.some((r) => r.code === code)).length;
    const free = nodes.filter((n) => roomsOn(n) < n.maxRooms);
    const local = free.filter((n) => n.region === region);
    const pool = local.length || strict ? local : free;
    return pool.sort((a, b) => roomsOn(a) - roomsOn(b) || a.rooms.reduce((s, r) => s + r.humans, 0) - b.rooms.reduce((s, r) => s + r.humans, 0))[0] || null;
  }

  // find: join people waiting. Otherwise: the private room with this code.
  // region: preferred region; strict: only that region. Returns null when no server can take it.
  assign({ find, mode, room, region, strict }) {
    const now = Date.now();
    for (const [code, p] of this.pending) if (now - p.at > PENDING_TIME) this.pending.delete(code);
    const nodes = this.aliveNodes();
    const gameMode = MODES[mode] ? mode : 'tdm';
    let node, code;

    if (find) {
      const open = this.openRooms(gameMode, nodes, now);
      const pick = open.find((r) => r.node.region === region) || (strict ? null : open[0]);
      if (pick) ({ node, code } = pick);
      else {
        node = this.pickNode(nodes, region, strict, now);
        code = `m-${crypto.randomBytes(5).toString('hex')}`;
      }
    } else {
      code = cleanRoom(room).replace(/^m-/, 'r-');   // "m-" codes belong to matchmade rooms
      node = nodes.find((n) => n.rooms.some((r) => r.code === code))
        || nodes.find((n) => n.id === this.pending.get(code)?.nodeId)
        || this.pickNode(nodes, region, strict, now);
    }
    if (!node) return null;

    let p = this.pending.get(code);
    if (!p) {
      const known = node.rooms.find((r) => r.code === code);
      p = { nodeId: node.id, mode: gameMode, find: !!find, at: now, humans: known?.humans || 0, seats: [] };
      this.pending.set(code, p);
    }
    if (find) p.seats.push(now);
    return {
      server: node.url, region: node.region, room: code,
      ticket: makeTicket({ room: code, find: !!find, mode: gameMode }, this.secret),
    };
  }
}
