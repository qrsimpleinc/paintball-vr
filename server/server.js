// HTTP(S) static server + WebSocket game server.
//
// ROLE=standalone (default)  everything in one process, for a local network or one online machine
// ROLE=matchmaker            website, map storage and player assignment; runs no matches
// ROLE=node                  game server; reports to the matchmaker and only admits players it sent
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { sanitizeSource, registerCustom, BUILTIN } from '../shared/custom.js';
import { MAPS } from '../shared/maps.js';
import { Matchmaker, readTicket, cleanRoom } from './matchmaker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const CERT_DIR = path.join(ROOT, 'certs');

const ROLE = process.env.ROLE || 'standalone';
const STANDALONE = ROLE === 'standalone', IS_MATCHMAKER = ROLE === 'matchmaker', IS_NODE = ROLE === 'node';
if (!STANDALONE && !IS_MATCHMAKER && !IS_NODE) { console.error(`Unknown ROLE "${ROLE}"`); process.exit(1); }
const need = (name) => { if (!process.env[name]) { console.error(`ROLE=${ROLE} needs ${name} to be set`); process.exit(1); } return process.env[name]; };

// signs match tickets and authenticates nodes; shared by every server of a network
const SECRET = STANDALONE ? crypto.randomBytes(32).toString('hex') : need('NODE_SECRET');
if (SECRET.length < 16) { console.error('NODE_SECRET must be at least 16 characters'); process.exit(1); }
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 20);
const MATCHMAKER_URL = IS_NODE ? need('MATCHMAKER_URL').replace(/\/$/, '') : '';
const PUBLIC_URL = IS_NODE ? need('PUBLIC_URL').replace(/\/$/, '') : '';   // wss://eu1.example.com
const REGION = process.env.REGION || 'default';
const NODE_ID = process.env.NODE_ID || os.hostname();
// Online, Caddy is the only way in: the Node port stays on this machine.
const BIND = process.env.BIND || (STANDALONE ? '0.0.0.0' : '127.0.0.1');
const BEHIND_PROXY = BIND === '127.0.0.1';

const matchmaker = IS_NODE ? null : new Matchmaker(SECRET);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// URL prefix -> folder on disk
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/three/', path.join(ROOT, 'node_modules/three')],
  ['/', path.join(ROOT, 'client')],
];

function serveStatic(req, res) {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    let rel = url.slice(prefix.length) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) break; // path traversal guard
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
}

// ---- custom maps (made in the editor), stored as JSON sources in maps/ --------------
// A network keeps them on the matchmaker; game servers copy them from there.
const MAP_DIR = path.join(ROOT, 'maps');
if (!IS_NODE) fs.mkdirSync(MAP_DIR, { recursive: true });
const sources = new Map();   // id -> sanitized source
let mapsVersion = Date.now();
for (const f of IS_NODE ? [] : fs.readdirSync(MAP_DIR).filter((n) => n.endsWith('.json'))) {
  try {
    const src = sanitizeSource(JSON.parse(fs.readFileSync(path.join(MAP_DIR, f), 'utf8')));
    if (!src.id) continue;
    registerCustom(src); sources.set(src.id, src);
  } catch (e) { console.warn(`skipping map ${f}: ${e.message}`); }
}
if (sources.size) console.log(`custom maps: ${[...sources.values()].map((s) => s.name).join(', ')}`);

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'map';
function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}
function readBody(req, limit, done) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > limit) req.destroy(); });
  req.on('end', () => done(body));
}

// Per-address limit on requests that create something or try a password.
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function tooMany(req, res) {
  // behind Caddy the real address is in X-Forwarded-For; on a LAN anyone could fake that header
  const ip = (BEHIND_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  if (n <= 60) return false;
  sendJSON(res, 429, { error: 'too many requests, try again in a minute' });
  return true;
}

const sameSecret = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// Saving and deleting maps. A local server stays open unless ADMIN_PASSWORD is set; an online
// matchmaker refuses until one is set.
function adminAllowed(req, res) {
  if (!ADMIN_PASSWORD && STANDALONE) return true;
  if (!ADMIN_PASSWORD) { sendJSON(res, 403, { error: 'map editing is off: set ADMIN_PASSWORD on the server' }); return false; }
  if (sameSecret(req.headers['x-admin-password'] || '', ADMIN_PASSWORD)) return true;
  sendJSON(res, 401, { error: 'wrong password' });
  return false;
}

function localReport() {
  return { id: NODE_ID, url: PUBLIC_URL, region: REGION, maxRooms: MAX_ROOMS, rooms: [...rooms.values()].map((r) => r.info()) };
}

function handleApi(req, res) {
  const url = (req.url || '').split('?')[0];
  if (url === '/api/ping') return sendJSON(res, 200, { ok: true });
  if (IS_NODE) return sendJSON(res, 404, { error: 'unknown api' });

  if (url === '/api/info' && req.method === 'GET') return sendJSON(res, 200, { network: !STANDALONE || BEHIND_PROXY, regions: matchmaker.regions() });

  if (url === '/api/match' && req.method === 'POST') {
    if (tooMany(req, res)) return;
    readBody(req, 2000, (body) => {
      let q;
      try { q = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'bad request' }); }
      if (STANDALONE) matchmaker.report(localReport());
      const game = matchmaker.assign({ find: !!q.find, mode: q.mode, room: q.room, region: String(q.region || ''), strict: !!q.strict });
      if (game) return sendJSON(res, 200, game);
      sendJSON(res, 503, { error: 'no game server available right now' });
    });
    return;
  }

  if (url === '/api/nodes/report' && req.method === 'POST') {
    if (!IS_MATCHMAKER || !sameSecret(String(req.headers.authorization || ''), `Bearer ${SECRET}`)) return sendJSON(res, 403, { error: 'forbidden' });
    readBody(req, 100_000, (body) => {
      try {
        const rep = JSON.parse(body);
        if (!rep.id || !Array.isArray(rep.rooms)) throw new Error('bad report');
        if (!matchmaker.nodes.has(rep.id)) console.log(`node ${rep.id} joined (${rep.region}, ${rep.url})`);
        matchmaker.report(rep);
        sendJSON(res, 200, { mapsVersion });
      } catch (e) { sendJSON(res, 400, { error: e.message }); }
    });
    return;
  }

  if (url === '/api/maps' && req.method === 'GET') return sendJSON(res, 200, [...sources.values()]);
  const one = url.match(/^\/api\/maps\/(c-[a-z0-9-]{1,40})$/);
  if (one && req.method === 'GET') return sources.has(one[1]) ? sendJSON(res, 200, sources.get(one[1])) : sendJSON(res, 404, { error: 'not found' });
  if (one && req.method === 'DELETE') {
    if (tooMany(req, res) || !adminAllowed(req, res)) return;
    if (!sources.has(one[1])) return sendJSON(res, 404, { error: 'not found' });
    sources.delete(one[1]);
    fs.rmSync(path.join(MAP_DIR, `${one[1]}.json`), { force: true });
    // rooms already playing it keep their copy until the next map change
    delete MAPS[one[1]];
    mapsVersion = Date.now();
    return sendJSON(res, 200, { ok: true });
  }
  if (url === '/api/maps' && req.method === 'POST') {
    if (tooMany(req, res) || !adminAllowed(req, res)) return;
    readBody(req, 400_000, (body) => {
      try {
        const src = sanitizeSource(JSON.parse(body));
        if (!src.id || !sources.has(src.id)) {           // new map: pick a free id from its name
          let id = `c-${slug(src.name)}`, n = 2;
          while (sources.has(id) || BUILTIN.has(id)) id = `c-${slug(src.name)}-${n++}`;
          src.id = id;
        }
        registerCustom(src);
        sources.set(src.id, src);
        fs.writeFileSync(path.join(MAP_DIR, `${src.id}.json`), JSON.stringify(src, null, 1));
        mapsVersion = Date.now();
        console.log(`map saved: ${src.name} (${src.id}), ${src.elements.length} elements`);
        sendJSON(res, 200, { id: src.id });
      } catch (e) { sendJSON(res, 400, { error: e.message }); }
    });
    return;
  }
  sendJSON(res, 404, { error: 'unknown api' });
}
function handle(req, res) {
  if ((req.url || '').startsWith('/api/')) return handleApi(req, res);
  if (IS_NODE) { res.writeHead(404); res.end('Game server'); return; }   // the website is on the matchmaker
  serveStatic(req, res);
}

// ---- rooms -------------------------------------------------------------------
const rooms = new Map();

function getRoom(code, ticket) {
  let room = rooms.get(code);
  if (!room) {
    const builtin = [...BUILTIN];
    const opts = ticket?.find ? { find: true, mode: ticket.mode, map: builtin[(Math.random() * builtin.length) | 0] } : {};
    room = new Room(code, () => { rooms.delete(code); console.log(`room "${code}" closed`); }, opts);
    rooms.set(code, room);
    console.log(`room "${code}" created`);
  }
  return room;
}

function attachWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws) => {
    let room = null, client = null;
    const joinTimer = setTimeout(() => ws.close(4004, 'no join'), 15000);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', t: msg.t, st: Date.now() })); return; }
      if (!room) {
        if (msg.type !== 'join') return;
        const code = cleanRoom(msg.room);
        const ticket = msg.ticket ? readTicket(msg.ticket, SECRET) : null;
        // on a local server a room code is enough; matchmade rooms and game servers need a ticket
        if (ticket ? ticket.room !== code : (IS_NODE || !!msg.ticket || code.startsWith('m-'))) { ws.close(4003, 'match ticket not valid, please try again'); return; }
        if (!rooms.has(code) && rooms.size >= MAX_ROOMS) { ws.close(4002, 'this server is full'); return; }
        clearTimeout(joinTimer);
        room = getRoom(code, ticket);
        client = room.addClient(ws, msg);
        if (!client) { room.maybeClose(); room = null; ws.close(4000, 'room full'); }
        return;
      }
      room.onMessage(client, msg);
    });
    ws.on('close', () => { clearTimeout(joinTimer); if (room && client) room.removeClient(client); });
    ws.on('error', () => {});
  });
}

const httpServer = http.createServer(handle);
if (!IS_MATCHMAKER) attachWs(httpServer);
httpServer.listen(HTTP_PORT, BIND);

// Local TLS for the Quest. Online, Caddy handles HTTPS instead.
let httpsOn = false;
const keyFile = path.join(CERT_DIR, 'key.pem'), certFile = path.join(CERT_DIR, 'cert.pem');
if (STANDALONE && fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  const httpsServer = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handle);
  attachWs(httpsServer);
  httpsServer.listen(HTTPS_PORT, BIND);
  httpsOn = true;
}

// ---- game server: report to the matchmaker, keep a copy of the custom maps --------------------
if (IS_NODE) {
  let knownMaps = null, linked = false, warned = false;
  const syncMaps = async () => {
    const list = await (await fetch(`${MATCHMAKER_URL}/api/maps`)).json();
    const keep = new Set();
    for (const raw of list) { const src = sanitizeSource(raw); registerCustom(src); sources.set(src.id, src); keep.add(src.id); }
    for (const id of sources.keys()) if (!keep.has(id)) { sources.delete(id); delete MAPS[id]; }
  };
  const beat = async () => {
    try {
      const r = await fetch(`${MATCHMAKER_URL}/api/nodes/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify(localReport()), signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { mapsVersion: v } = await r.json();
      if (!linked) { linked = true; console.log(`  connected to matchmaker ${MATCHMAKER_URL}`); }
      if (v !== knownMaps) { await syncMaps(); knownMaps = v; }
    } catch (e) {
      if (linked || !warned) console.warn(`  matchmaker unreachable: ${e.message}`);
      linked = false; warned = true;
    }
  };
  beat();
  setInterval(beat, 2000);
}

if (IS_MATCHMAKER) console.log(`\n  Paintball matchmaker on ${BIND}:${HTTP_PORT}\n`);
else if (IS_NODE) console.log(`\n  Paintball game server "${NODE_ID}" (${REGION}) on ${BIND}:${HTTP_PORT}, public address ${PUBLIC_URL}\n`);
else {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  Paintball VR server running');
  console.log(`  Desktop:  http://localhost:${HTTP_PORT}`);
  for (const ip of ips) {
    if (httpsOn) console.log(`  Quest:    https://${ip}:${HTTPS_PORT}   (accept the certificate warning once)`);
    else console.log(`  LAN:      http://${ip}:${HTTP_PORT}   (VR needs HTTPS: run "npm run cert" or use adb reverse, see README)`);
  }
  console.log('');
}
