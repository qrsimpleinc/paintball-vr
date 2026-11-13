// Server-side robot players: grid navigation (A*), line-of-sight targeting,
// ballistic aim with difficulty-based error, strafing and objective roaming.
import { W, WEAPONS, BOT_DIFFICULTY, PAINT_GRAVITY, EYE_HEIGHT, STEP_HEIGHT, PLAYER_RADIUS, isFlag } from '../shared/constants.js';
import { lineOfSight, resolveCollisions, groundHeight, concealed, sub, len } from '../shared/physics.js';

export const BOT_NAMES = ['Bolt', 'Sprocket', 'Widget', 'Gizmo', 'Rivet', 'Cog', 'Servo', 'Piston', 'Diode', 'Gear', 'Spark', 'Flux'];

const CELL = 0.5;
const navCache = new WeakMap(); // keyed by map object, so a re-saved custom map gets a fresh grid

// ---- navigation grid ---------------------------------------------------------
function buildNav(map) {
  if (navCache.has(map)) return navCache.get(map);
  const cols = Math.round((map.halfX * 2) / CELL), rows = Math.round((map.halfZ * 2) / CELL);
  const blocked = new Uint8Array(cols * rows);
  const inflate = PLAYER_RADIUS + 0.1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -map.halfX + (c + 0.5) * CELL, z = -map.halfZ + (r + 0.5) * CELL;
      for (const b of map.boxes) {
        if (b.y + b.h <= STEP_HEIGHT && b.y === 0) continue; // low decks are walkable
        if (b.y >= 1.7) continue;                               // raised decks: walk underneath
        if (Math.abs(x - b.x) < b.w / 2 + inflate && Math.abs(z - b.z) < b.d / 2 + inflate) { blocked[r * cols + c] = 1; break; }
      }
      // bots stay on the ground: ramps count as obstacles for them
      for (const rp of map.ramps || []) {
        if (Math.abs(x - rp.x) < rp.w / 2 + inflate && Math.abs(z - rp.z) < rp.d / 2 + inflate) blocked[r * cols + c] = 1;
      }
    }
  }
  const nav = { cols, rows, blocked, map };
  navCache.set(map, nav);
  return nav;
}

const toCell = (nav, x, z) => [
  Math.max(0, Math.min(nav.cols - 1, Math.floor((x + nav.map.halfX) / CELL))),
  Math.max(0, Math.min(nav.rows - 1, Math.floor((z + nav.map.halfZ) / CELL))),
];
const toWorld = (nav, c, r) => [-nav.map.halfX + (c + 0.5) * CELL, -nav.map.halfZ + (r + 0.5) * CELL];
const free = (nav, c, r) => c >= 0 && r >= 0 && c < nav.cols && r < nav.rows && !nav.blocked[r * nav.cols + c];

function nearestFree(nav, c, r) {
  if (free(nav, c, r)) return [c, r];
  for (let rad = 1; rad < 8; rad++)
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++)
        if (free(nav, c + dc, r + dr)) return [c + dc, r + dr];
  return [c, r];
}

function findPath(nav, from, to) {
  const [sc, sr] = nearestFree(nav, ...toCell(nav, from[0], from[1]));
  const [gc, gr] = nearestFree(nav, ...toCell(nav, to[0], to[1]));
  const N = nav.cols * nav.rows, start = sr * nav.cols + sc, goal = gr * nav.cols + gc;
  const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [[0, start]];
  g[start] = 0;
  const h = (i) => { const c = i % nav.cols, r = (i / nav.cols) | 0; const dx = Math.abs(c - gc), dz = Math.abs(r - gr); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  while (heap.length) {
    const [, cur] = heapPop(heap);
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % nav.cols, r = (cur / nav.cols) | 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = c + dc, nr = r + dr;
      if (!free(nav, nc, nr)) continue;
      if (dc && dr && (!free(nav, c + dc, r) || !free(nav, c, r + dr))) continue; // no corner cutting
      const ni = nr * nav.cols + nc, cost = g[cur] + (dc && dr ? 1.414 : 1);
      if (cost < g[ni]) { g[ni] = cost; came[ni] = cur; heapPush(heap, [cost + h(ni), ni]); }
    }
  }
  if (came[goal] === -1 && goal !== start) return [];
  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  // string pulling: drop waypoints that are directly walkable
  const pts = cells.map((i) => toWorld(nav, i % nav.cols, (i / nav.cols) | 0));
  const out = [];
  let anchor = [from[0], from[1]];
  for (let i = 1; i < pts.length; i++) {
    if (!walkable(nav, anchor, pts[i])) { out.push(pts[i - 1]); anchor = pts[i - 1]; }
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

function walkable(nav, a, b) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.ceil(d / (CELL * 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const [c, r] = toCell(nav, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (!free(nav, c, r)) return false;
  }
  return true;
}

function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}

function randomGoal(nav, team) {
  // roam the middle and the enemy half; sometimes sneak to a bush
  const map = nav.map;
  if (map.bushes?.length && Math.random() < 0.3) {
    const b = map.bushes[(Math.random() * map.bushes.length) | 0];
    return [b.x, b.z];
  }
  for (let tries = 0; tries < 30; tries++) {
    const side = team === 0 ? 1 : -1;
    const x = side * (Math.random() * map.halfX * 0.9 - map.halfX * 0.35);
    const z = (Math.random() * 2 - 1) * map.halfZ * 0.85;
    const [c, r] = toCell(nav, x, z);
    if (free(nav, c, r)) return [x, z];
  }
  return [0, 0];
}

// ---- senses -----------------------------------------------------------------------
const COS_VIEW = Math.cos((65 * Math.PI) / 180);   // ~130° field of view to spot someone new
const COS_TRACK = Math.cos((100 * Math.PI) / 180); // keep tracking a target that moves to the side

// The bot heard something at pos (a little imprecise: noise tells roughly where, not exactly).
function alertBot(p, pos, now, err) {
  const B = p.brain;
  if (B.targetId || (B.heard && now - B.heard.at < 2500 && B.heard.at > 0)) return;
  B.heard = { pos: [pos[0] + gauss() * err, 0, pos[2] + gauss() * err], at: now };
}

// A gun was fired at pos: enemy bots in earshot turn toward it.
export function hearShot(room, shooter, pos, now) {
  for (const b of room.players.values()) {
    if (!b.bot || !b.alive || b.team === shooter.team) continue;
    const d = Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[2]);
    if (d < 28) alertBot(b, pos, now, d * 0.12);
  }
}

// ---- Capture the Flag ------------------------------------------------------------
// One bot per team (when it has two or more) guards the flag; the others go for the
// enemy flag, escort a team mate who has it, or chase whoever stole theirs. Flag
// carriers are shown to everyone, so bots know where they are too.
function ctfRole(room, p) {
  const mates = room.bots().filter((b) => b.team === p.team).sort((a, b) => a.id - b.id);
  return mates.length >= 2 && mates[0] === p ? 'defend' : 'attack';
}

function flagSpot(room, f) {
  if (room.items.flagStatus(f) === 1) { const h = room.players.get(f.holder); if (h) return [h.pos[0], h.pos[2]]; }
  return [f.pos[0], f.pos[2]];
}

function ctfObjective(room, p, now, carrying) {
  const B = p.brain, flags = room.items.flags, own = flags[p.team], enemy = flags[1 - p.team];
  if (carrying) return [own.home[0], own.home[2]];
  const ownSt = room.items.flagStatus(own), enSt = room.items.flagStatus(enemy);
  const role = ctfRole(room, p);
  const ownAt = flagSpot(room, own), dOwn = Math.hypot(ownAt[0] - p.pos[0], ownAt[1] - p.pos[2]);
  if (ownSt !== 0 && (role === 'defend' || dOwn < 22)) return ownAt;   // chase the thief / return our flag
  if (role === 'defend') {
    if (!B.patrol || now > B.patrolAt) {
      B.patrolAt = now + 4000 + Math.random() * 4000;
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
        const x = own.home[0] + Math.cos(a) * r, z = own.home[2] + Math.sin(a) * r;
        if (Math.abs(x) < room.map.halfX - 1 && Math.abs(z) < room.map.halfZ - 1 && free(B.nav, ...toCell(B.nav, x, z))) { B.patrol = [x, z]; break; }
      }
      B.patrol ??= [own.home[0], own.home[2]];
    }
    return B.patrol;
  }
  const at = flagSpot(room, enemy);
  if (enSt === 1) { // a team mate has it: run alongside
    const a = (p.id * 2.39) % (Math.PI * 2);
    return [at[0] + Math.cos(a) * 3, at[1] + Math.sin(a) * 3];
  }
  return at;
}

function ctfSteer(room, p, now, carrying) {
  const B = p.brain;
  const obj = ctfObjective(room, p, now, carrying);
  const moved = !B.goal || Math.hypot(obj[0] - B.goal[0], obj[1] - B.goal[1]) > 1.5;
  if ((moved && now > (B.ctfPathAt || 0)) || now > B.repathAt || (B.pathIdx >= B.path.length && Math.hypot(obj[0] - p.pos[0], obj[1] - p.pos[2]) > 1)) {
    B.goal = obj;
    B.path = findPath(B.nav, [p.pos[0], p.pos[2]], obj);
    B.pathIdx = 0; B.repathAt = now + 3000; B.ctfPathAt = now + 400;
  }
  // pick up the enemy flag when standing on it (frees the left hand if needed)
  const enemy = room.items.flags[1 - p.team];
  if (!carrying && enemy.state === 0 && Math.hypot(enemy.pos[0] - p.pos[0], enemy.pos[2] - p.pos[2]) < 1.4 && room.items.canGrab(p, enemy)) {
    const hand = !p.hands[0] ? 0 : !p.hands[1] ? 1 : 0;
    if (p.hands[hand]) room.items.drop(p, hand, [p.pos[0], p.pos[1] + 0.9, p.pos[2]], [0, 0, 0]);
    if (room.grabFlag(p, hand, enemy)) { B.path = []; B.repathAt = 0; B.goal = null; }
  }
}

// Something happened to a flag: everyone re-plans right away.
export function ctfAnnounce(room) {
  for (const b of room.bots()) { b.brain.repathAt = 0; b.brain.ctfPathAt = 0; }
}

// ---- bot lifecycle --------------------------------------------------------------
// After a map change: rebuild the bot's navigation for the new map.
export function resetBotForMap(room, p) {
  if (!p.brain) return;
  Object.assign(p.brain, { nav: buildNav(room.map), path: [], pathIdx: 0, goal: null, targetId: 0, itemGoal: 0 });
}

export function createBot(room, p) {
  p.brain = {
    nav: buildNav(room.map), path: [], pathIdx: 0, repathAt: 0, goal: null,
    targetId: 0, seenAt: 0, nextFireAt: 0, strafe: 1, strafeAt: 0,
    yaw: 0, pitch: 0, lastPos: [0, 0], stuckCheckAt: 0, grenadeAt: 0,
  };
  B_init(p);
}

function B_init(p) { p.brain.itemGoal = 0; p.brain.itemCheckAt = 0; }

// Which ground item does this bot want? Shotgun for the right hand (replacing the
// pistol), grenade or shield for an empty left hand. Bots stay on the ground.
// how much a bot likes each gun for its right hand (higher = better)
const GUN_RANK = { [W.PISTOL]: 1, [W.SHOTGUN]: 3, [W.SPRAYER]: 3, [W.BURST]: 4, [W.SNIPER]: 2 };
export const BOT_GUNS = new Set(Object.keys(GUN_RANK).map(Number));

function wantedItem(room, p, maxD = 20) {
  const myRank = GUN_RANK[p.rw] || 0;
  const wantLeft = !p.hands[0];
  let best = null, bestD = maxD;
  for (const it of room.items.list.values()) {
    if (it.state !== 0 || it.pos[1] > 0.6 || it.personal) continue;
    const ok = (GUN_RANK[it.w] > myRank) || ((it.w === W.GRENADE || it.w === W.SHIELD) && wantLeft);
    if (!ok) continue;
    const d = Math.hypot(it.pos[0] - p.pos[0], it.pos[2] - p.pos[2]);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

function tryPickup(room, p) {
  const B = p.brain;
  const it = room.items.get(B.itemGoal);
  if (!it || it.state !== 0) { B.itemGoal = 0; return; }
  if (Math.hypot(it.pos[0] - p.pos[0], it.pos[2] - p.pos[2]) > 1.0) return;
  if (GUN_RANK[it.w]) {
    if (p.hands[1]) room.items.drop(p, 1, [p.pos[0], p.pos[1] + 0.9, p.pos[2]], [0, 0, 0]); // put the old gun down
    room.items.give(p, 1, it);
  } else if (!p.hands[0]) room.items.give(p, 0, it);
  B.itemGoal = 0; B.path = []; B.pathIdx = 0; B.goal = null;
}

function quatYawPitch(yaw, pitch) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cx = Math.cos(pitch / 2), sx = Math.sin(pitch / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}
const forward = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
const rotY = (v, yaw) => [v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), v[1], -v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];

function velocityOf(p) {
  const h = p.history;
  if (h.length < 4) return [0, 0, 0];
  const a = h[h.length - 4], b = h[h.length - 1], dt = (b.t - a.t) / 1000 || 1;
  return [(b.pos[0] - a.pos[0]) / dt, 0, (b.pos[2] - a.pos[2]) / dt];
}

export function updateBot(room, p, dt, now) {
  const B = p.brain, map = room.map, nav = B.nav;
  const diff = BOT_DIFFICULTY[room.settings.difficulty] || BOT_DIFFICULTY.normal;
  if (!p.alive) { B.path = []; B.targetId = 0; return; }

  const eye = [p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]];
  let target = null, targetDist = Infinity;
  const ctf = room.settings.mode === 'ctf' && room.items.flags?.length === 2;
  const carrying = ctf && (isFlag(p.lw) || isFlag(p.rw));

  if (room.state === 'playing') {
    // Bots only know where you are if they see you (in front of them, not behind cover
    // or inside a bush), hear you (running close by, shooting) or you bump into them.
    const fwd = [-Math.sin(B.yaw), -Math.cos(B.yaw)];
    const inView = (e, cosHalf) => {
      const dx = e.head[0] - eye[0], dz = e.head[2] - eye[2], d = Math.hypot(dx, dz);
      return d < 1.2 || (dx * fwd[0] + dz * fwd[1]) / d > cosHalf;
    };
    const seen = (pt) => lineOfSight(map, eye, pt) && !concealed(map, eye, pt);
    const visible = (e, cosHalf) => e && e.alive && e.team !== p.team && len(sub(e.head, eye)) < 45 &&
      inView(e, cosHalf) && (seen(e.head) || seen([e.head[0], e.head[1] - 0.6, e.head[2]]));
    const current = room.players.get(B.targetId);
    if (visible(current, COS_TRACK)) { target = current; targetDist = len(sub(current.head, eye)); }
    else {
      for (const e of room.players.values()) {
        if (e.team === p.team || !e.alive) continue;
        const d = len(sub(e.head, eye));
        if (d < targetDist && visible(e, COS_VIEW)) { target = e; targetDist = d; }
        // footsteps: running is loud, walking is quiet, crouching is silent
        const sp = Math.hypot(...velocityOf(e).filter((_, i) => i !== 1));
        const hearR = sp > 4.2 ? 9 : sp > 2 ? 4 : 0;
        if (hearR && d < hearR) alertBot(p, e.pos, now, 1.5);
      }
    }
  }

  if (target) {
    if (B.targetId !== target.id) { B.targetId = target.id; B.seenAt = now; }
    if (!ctf) B.goal = [target.pos[0], target.pos[2]];
    B.lastSeen = [target.pos[0], target.pos[2]];
  } else if (ctf) {
    // the flags come first: only turn toward noises
    B.targetId = 0;
    if (B.heard && now - B.heard.at < 300) {
      B.alertUntil = now + 1200; B.alertYaw = Math.atan2(-(B.heard.pos[0] - p.pos[0]), -(B.heard.pos[2] - p.pos[2]));
      B.heard.at = -1e9;
    }
  } else {
    if (B.targetId) {
      // lost sight: go check the last place they were seen
      B.targetId = 0;
      if (B.lastSeen) { B.goal = B.lastSeen; B.path = findPath(nav, [p.pos[0], p.pos[2]], B.goal); B.pathIdx = 0; B.repathAt = now + 6000; }
    }
    if (B.heard && now - B.heard.at < 300) {
      // a fresh noise: turn toward it and go have a look
      B.alertUntil = now + 1500; B.alertYaw = Math.atan2(-(B.heard.pos[0] - p.pos[0]), -(B.heard.pos[2] - p.pos[2]));
      if (Math.random() < 0.7) { B.goal = [B.heard.pos[0], B.heard.pos[2]]; B.path = findPath(nav, [p.pos[0], p.pos[2]], B.goal); B.pathIdx = 0; B.repathAt = now + 6000; B.itemGoal = 0; }
      B.heard.at = -1e9;
    }
  }

  // ---- movement ----------------------------------------------------------------
  let move = [0, 0];
  const frozen = room.settings.freeze || room.state !== 'playing';
  if (!frozen) {
    // CTF: attackers and carriers keep running and shoot on the move; guards stop and fight
    const fightRange = !ctf ? 16 : carrying ? 0 : ctfRole(room, p) === 'defend' ? 12 : 5;
    if (target && targetDist < fightRange) {
      // fight: strafe around, keep mid distance
      if (now > B.strafeAt) { B.strafe = Math.random() < 0.5 ? -1 : 1; B.strafeAt = now + 700 + Math.random() * 1000; }
      const to = [target.pos[0] - p.pos[0], target.pos[2] - p.pos[2]];
      const d = Math.hypot(to[0], to[1]) || 1;
      const fwd = [to[0] / d, to[1] / d], side = [-fwd[1] * B.strafe, fwd[0] * B.strafe];
      const approach = targetDist > 10 ? 0.6 : targetDist < 5 ? -0.6 : 0;
      move = [side[0] + fwd[0] * approach, side[1] + fwd[1] * approach];
      B.path = [];
    } else {
      if (room.state === 'playing' && now > B.itemCheckAt && !carrying) {
        B.itemCheckAt = now + 1500;
        const want = wantedItem(room, p, ctf ? 6 : 20);
        if (want && want.id !== B.itemGoal) {
          B.itemGoal = want.id; B.goal = [want.pos[0], want.pos[2]];
          B.path = findPath(nav, [p.pos[0], p.pos[2]], B.goal); B.pathIdx = 0; B.repathAt = now + 4000;
        }
      }
      if (B.itemGoal) tryPickup(room, p);
      else if (ctf && room.state === 'playing') ctfSteer(room, p, now, carrying);
      if (ctf && !B.itemGoal) { /* path set by ctfSteer */ } else if (!B.goal || now > B.repathAt || B.pathIdx >= B.path.length) {
        if (!B.goal || B.pathIdx >= B.path.length) B.goal = randomGoal(nav, p.team);
        B.path = findPath(nav, [p.pos[0], p.pos[2]], B.goal);
        B.pathIdx = 0;
        B.repathAt = now + 3000 + Math.random() * 1500;
      }
      const wp = B.path[B.pathIdx];
      if (wp) {
        const dx = wp[0] - p.pos[0], dz = wp[1] - p.pos[2], d = Math.hypot(dx, dz);
        if (d < 0.4) B.pathIdx++;
        else move = [dx / d, dz / d];
      }
    }
    // stuck detection
    if (now > B.stuckCheckAt) {
      if (Math.hypot(p.pos[0] - B.lastPos[0], p.pos[2] - B.lastPos[1]) < 0.3 && (move[0] || move[1])) {
        B.goal = randomGoal(nav, p.team); B.path = []; B.pathIdx = 0; B.strafe *= -1;
      }
      B.lastPos = [p.pos[0], p.pos[2]];
      B.stuckCheckAt = now + 1200;
    }
  }

  const ml = Math.hypot(move[0], move[1]);
  if (ml > 0.01) {
    const speed = diff.speed * (target && !ctf ? 0.75 : 1);
    const np = [p.pos[0] + (move[0] / ml) * speed * dt, p.pos[1], p.pos[2] + (move[1] / ml) * speed * dt];
    resolveCollisions(map, np, PLAYER_RADIUS);
    np[1] = groundHeight(map, np[0], np[2], p.pos[1], PLAYER_RADIUS);
    p.pos = np;
    if (!target && !(B.alertUntil > now)) B.yaw = turnToward(B.yaw, Math.atan2(-move[0], -move[1]), 6 * dt);
  }
  if (!target && B.alertUntil > now) B.yaw = turnToward(B.yaw, B.alertYaw, 7 * dt);

  // ---- aim & fire ------------------------------------------------------------
  const headPos = [p.pos[0], p.pos[1] + EYE_HEIGHT, p.pos[2]];
  let aimDir = null;
  if (target) {
    const muzzle = [headPos[0], headPos[1] - 0.3, headPos[2]];
    const chest = [target.head[0], target.head[1] - 0.45, target.head[2]];
    const gun = GUN_RANK[p.rw] ? p.rw : W.PISTOL;
    const tFlight = len(sub(chest, muzzle)) / WEAPONS[gun].speed;
    const tv = velocityOf(target);
    const aim = [
      chest[0] + tv[0] * tFlight * diff.lead,
      chest[1] + 0.5 * PAINT_GRAVITY * tFlight * tFlight,
      chest[2] + tv[2] * tFlight * diff.lead,
    ];
    const d = sub(aim, muzzle), dl = len(d);
    aimDir = [d[0] / dl, d[1] / dl, d[2] / dl];
    B.yaw = turnToward(B.yaw, Math.atan2(-aimDir[0], -aimDir[2]), 10 * dt);
    B.pitch = Math.asin(Math.max(-1, Math.min(1, aimDir[1])));

    const ready = now - B.seenAt > diff.reaction * 1000 && now >= B.nextFireAt;
    const inRange = gun === W.SHOTGUN ? targetDist < 11 : gun === W.SPRAYER ? targetDist < 12 : true;
    if (ready && inRange && GUN_RANK[p.rw] && !room.settings.noshoot && room.state === 'playing') {
      const s = Math.tan((diff.spreadDeg * Math.PI) / 180);
      const origin = rotHand(headPos, B.yaw, [0.22, -0.3, -0.45]);
      const spec = WEAPONS[gun], ps = Math.tan((spec.spread * Math.PI) / 180);
      const base = [aimDir[0] + gauss() * s, aimDir[1] + gauss() * s, aimDir[2] + gauss() * s];
      const pellets = [];
      for (let k = 0; k < spec.pellets; k++) {
        const j = spec.pellets > 1 ? ps : 0;
        pellets.push([...origin, base[0] + (Math.random() - 0.5) * 2 * j, base[1] + (Math.random() - 0.5) * 2 * j, base[2] + (Math.random() - 0.5) * 2 * j]);
      }
      room.fire(p, gun, pellets, 0, false);
      if (spec.burst) {
        // the rest of the burst follows quickly
        B.burstLeft = (B.burstLeft ?? spec.burst) - 1;
        if (B.burstLeft > 0) B.nextFireAt = now + spec.burstGap * 1000;
        else { B.burstLeft = spec.burst; B.nextFireAt = now + Math.max(diff.fireInterval, spec.cooldown) * 1000 * (0.9 + Math.random() * 0.4); }
      } else if (spec.auto) {
        B.nextFireAt = now + spec.cooldown * 1000 * (1 + Math.random() * 0.6);
      } else B.nextFireAt = now + Math.max(diff.fireInterval, spec.cooldown) * 1000 * (0.8 + Math.random() * 0.5);
    }
    // grenade from the left hand at mid range (it respawns at its spot 10 s later)
    if (p.lw === W.GRENADE && !room.settings.noshoot && targetDist > 5 && targetDist < 14 && now > B.grenadeAt && room.state === 'playing') {
      B.grenadeAt = now + 2500 + Math.random() * 3000;
      const t = 0.9; // flight time
      const v = [(target.pos[0] - p.pos[0]) / t, (target.pos[1] - headPos[1] + 0.5 * 9.8 * t * t) / t, (target.pos[2] - p.pos[2]) / t];
      room.throwFrom(p, 0, rotHand(headPos, B.yaw, [-0.2, -0.2, -0.3]), v);
    }
  } else {
    B.pitch *= 0.9;
  }

  // ---- pose for rendering ----------------------------------------------------
  p.head = headPos;
  p.hq = quatYawPitch(B.yaw, B.pitch * 0.6);
  const q = quatYawPitch(B.yaw, B.pitch);
  p.rh = [...rotHand(headPos, B.yaw, [0.22, -0.35, -0.4], B.pitch), ...q];
  const shieldUp = p.lw === W.SHIELD && target;
  p.lh = [...rotHand(headPos, B.yaw, shieldUp ? [-0.1, -0.35, -0.45] : [-0.25, -0.6, -0.1]), ...quatYawPitch(B.yaw, 0)];
}

function rotHand(head, yaw, off, pitch = 0) {
  // apply pitch to forward offset only roughly (raise the hand when aiming up)
  const o = [off[0], off[1] + Math.sin(pitch) * -off[2], off[2] * Math.cos(pitch)];
  const r = rotY(o, yaw);
  return [head[0] + r[0], head[1] + r[1], head[2] + r[2]];
}

function turnToward(cur, target, maxStep) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}

function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
