// One match room: up to 8 players (humans + bots), 4v4 Team Battle.
// The server is authoritative for paintballs, grenades, hits, score and respawns.
import {
  TICK_RATE, INTERP_DELAY, TEAM_SIZE, MAX_PLAYERS, MATCH_TIME, SCORE_LIMIT,
  RESPAWN_TIME, SPAWN_PROTECT, END_SCREEN_TIME, PAINT_GRAVITY, GRENADE_GRAVITY,
  W, WEAPONS, BOT_DIFFICULTY, EYE_HEIGHT, fireInterval, MODES, CTF, flagHomes,
} from '../shared/constants.js';
import { MAPS, DEFAULT_MAP } from '../shared/maps.js';
import {
  raycastWorld, segmentSphere, segmentCapsule, lineOfSight, ballistic,
  sub, add, scale, len, lerp3, dot,
} from '../shared/physics.js';
import { createBot, updateBot, resetBotForMap, hearShot, BOT_NAMES, ctfAnnounce } from './bots.js';
import { Items, STATE } from './items.js';

// Rooms made by the "find players" matchmaking start in a warm-up and wait for people.
const WAIT_TIME = Number(process.env.WAIT_TIME || 45);   // seconds, from the moment the room opens
const FULL_START = 5;                                    // seconds left once all 8 places are taken

let nextId = 1;
const r3 = (v) => Math.round(v * 1000) / 1000;
const HISTORY = 45; // ~1.5s of pose history for lag compensation

export class Room {
  // opts.find: matchmade room (warm-up first, settings locked); opts.mode / opts.map: its game and map
  constructor(code, onEmpty, opts = {}) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.find = !!opts.find;
    this.map = MAPS[opts.map] || MAPS[DEFAULT_MAP];
    this.players = new Map();     // id -> player (humans + bots)
    this.spectators = new Set();   // ws clients watching
    this.projectiles = [];
    this.grenades = [];
    this.mines = [];
    this.settings = { bots: 7, difficulty: 'normal', freeze: false, noshoot: false, debug: false, mode: MODES[opts.mode] ? opts.mode : 'tdm' };
    this.items = new Items(this);
    this.score = [0, 0];
    this.state = this.find ? 'waiting' : 'playing';
    this.timeLeft = this.mode().time;
    this.stateTimer = this.find ? WAIT_TIME : 0;
    this.tick = 0;
    this.botNameIdx = 0;
    this.interval = setInterval(() => this.update(), 1000 / TICK_RATE);
    this.lastUpdate = Date.now();
  }

  // ---- membership ---------------------------------------------------------
  humans() { return [...this.players.values()].filter((p) => !p.bot); }
  bots() { return [...this.players.values()].filter((p) => p.bot); }
  teamCount(team, filter = () => true) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team && filter(p)) n++;
    return n;
  }

  addClient(ws, msg) {
    const isFirst = this.humans().length === 0 && this.spectators.size === 0;
    if (isFirst && !this.find) {
      const modeChanged = this.applySettings(msg, false);
      if (MAPS[msg.map] && msg.map !== this.map.id) this.loadMap(msg.map);
      else if (modeChanged) this.rebuildItems();
      this.score = [0, 0]; this.timeLeft = this.mode().time;
    }

    if (msg.spectate) {
      const spec = { id: nextId++, ws, spectator: true, name: 'Spectator' };
      this.spectators.add(spec);
      this.send(spec, { type: 'welcome', id: spec.id, team: -1, spectator: true, map: this.map.id, room: this.code, settings: this.settings });
      this.rebalanceBots();
      this.sendRoster();
      this.sendMatch();
      return spec;
    }
    if (this.humans().length >= MAX_PLAYERS) return null;

    const h0 = this.teamCount(0, (p) => !p.bot), h1 = this.teamCount(1, (p) => !p.bot);
    let team = h0 < h1 ? 0 : h1 < h0 ? 1 : (this.teamCount(0) <= this.teamCount(1) ? 0 : 1);
    const p = this.makePlayer(String(msg.name || 'Player').slice(0, 16), team, false);
    p.ws = ws;
    this.players.set(p.id, p);
    this.send(p, { type: 'welcome', id: p.id, team, map: this.map.id, room: this.code, settings: this.settings });
    this.rebalanceBots();
    this.spawn(p);
    this.sendRoster();
    this.sendMatch();
    if (this.state === 'waiting' && this.humans().length >= MAX_PLAYERS) this.stateTimer = Math.min(this.stateTimer, FULL_START);
    console.log(`[${this.code}] ${p.name} joined team ${team}`);
    return p;
  }

  removeClient(c) {
    if (c.spectator) this.spectators.delete(c);
    else { this.items.dropAll(c); this.players.delete(c.id); console.log(`[${this.code}] ${c.name} left`); }
    this.rebalanceBots();
    this.sendRoster();
    this.maybeClose();
  }

  maybeClose() {
    if (this.humans().length === 0 && this.spectators.size === 0) {
      clearInterval(this.interval);
      this.onEmpty();
    }
  }

  makePlayer(name, team, bot) {
    return {
      id: nextId++, name, team, bot, ws: null,
      alive: false, protectUntil: 0, respawnAt: Date.now(),
      pos: [0, 0, 0], head: [0, EYE_HEIGHT, 0], hq: [0, 0, 0, 1],
      lh: [0, 1, 0, 0, 0, 0, 1], rh: [0, 1, 0, 0, 0, 0, 1], lw: W.NONE, rw: W.NONE,
      hands: [0, 0],          // item ids held in [left, right]
      lastFire: {}, rtt: 0, history: [], kills: 0, outs: 0,
    };
  }

  applySettings(cfg, broadcast = true) {
    const s = this.settings;
    if (cfg.bots !== undefined && cfg.bots !== null && cfg.bots !== '') s.bots = Math.max(0, Math.min(8, Number(cfg.bots) | 0));
    if (cfg.difficulty && BOT_DIFFICULTY[cfg.difficulty]) s.difficulty = cfg.difficulty;
    for (const k of ['freeze', 'noshoot', 'debug']) if (typeof cfg[k] === 'boolean') s[k] = cfg[k];
    const oldMode = s.mode;
    if (MODES[cfg.mode]) s.mode = cfg.mode;
    if (broadcast) { this.rebalanceBots(); this.sendRoster(); }
    return s.mode !== oldMode;
  }

  // What this room tells the matchmaker.
  info() {
    return { code: this.code, find: this.find, mode: this.settings.mode, state: this.state, humans: this.humans().length, startsIn: this.state === 'waiting' ? this.stateTimer : 0 };
  }

  mode() { return MODES[this.settings.mode] || MODES.tdm; }

  // Fresh set of map items (weapons, and flags in Capture the Flag); hands are emptied.
  rebuildItems() {
    for (const p of this.players.values()) { p.hands = [0, 0]; p.lw = p.rw = W.NONE; }
    this.items = new Items(this);
  }

  // Keep teams at most 4 each; fill empty slots with bots up to settings.bots.
  rebalanceBots() {
    const humans = this.humans().length;
    const wantBots = this.state === 'waiting' || (humans === 0 && this.spectators.size === 0) ? 0 : Math.min(this.settings.bots, MAX_PLAYERS - humans);
    const removeBotFrom = (team) => {
      const b = this.bots().filter((x) => x.team === team).pop();
      if (b) { this.items.dropAll(b); this.players.delete(b.id); }
      return !!b;
    };
    for (const t of [0, 1]) while (this.teamCount(t) > TEAM_SIZE && removeBotFrom(t));
    while (this.bots().length > wantBots) {
      const t = this.teamCount(0) >= this.teamCount(1) ? 0 : 1;
      if (!removeBotFrom(t) && !removeBotFrom(1 - t)) break;
    }
    while (this.bots().length < wantBots) {
      const t = this.teamCount(0) <= this.teamCount(1) ? 0 : 1;
      if (this.teamCount(t) >= TEAM_SIZE) break;
      const name = BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length];
      const b = this.makePlayer(name, t, true);
      createBot(this, b);
      this.players.set(b.id, b);
      this.spawn(b);
    }
  }

  // ---- networking -----------------------------------------------------------
  send(c, msg) {
    if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(data);
    for (const s of this.spectators) if (s.ws.readyState === 1) s.ws.send(data);
  }

  sendRoster() {
    this.broadcast({
      type: 'roster',
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, kills: p.kills, outs: p.outs })),
      settings: this.settings,
    });
  }

  sendMatch() {
    this.broadcast({
      type: 'match', state: this.state, score: this.score, timeLeft: this.timeLeft, winner: this.winner ?? -1,
      mode: this.settings.mode, limit: this.mode().limit,
      flagHomes: this.settings.mode === 'ctf' ? this.items.flags.map((f) => f.home.map(r3)) : null,
    });
  }

  onMessage(c, msg) {
    if (msg.type === 'cfg') {
      if (this.find) return;   // nobody can change the rules of a public match
      const modeChanged = this.applySettings(msg);
      // debug: switch map or game mode right now
      if (MAPS[msg.map] && msg.map !== this.map.id) { this.loadMap(msg.map); this.startMatch(); }
      else if (modeChanged) { this.rebuildItems(); this.voteOptions = null; this.startMatch(); }
      return;
    }
    if (msg.type === 'vote') {
      if (this.state === 'ended' && this.voteOptions?.includes(msg.map)) { this.votes.set(c.id, msg.map); this.sendVotes(); }
      return;
    }
    if (c.spectator) return;
    const p = c;
    switch (msg.type) {
      case 'st': {
        if (!Array.isArray(msg.p) || !Array.isArray(msg.h)) return;
        const hx = this.map.halfX + 1, hz = this.map.halfZ + 1;
        p.pos = [clamp(+msg.p[0], -hx, hx), clamp(+msg.p[1], 0, 6), clamp(+msg.p[2], -hz, hz)];
        p.head = [clamp(+msg.h[0], -hx, hx), clamp(+msg.h[1], 0, 8), clamp(+msg.h[2], -hz, hz)];
        p.hq = msg.h.slice(3, 7).map(Number);
        if (Array.isArray(msg.l)) p.lh = msg.l.map(Number);
        if (Array.isArray(msg.r)) p.rh = msg.r.map(Number);
        p.rtt = clamp(+msg.rtt || 0, 0, 400);
        break;
      }
      case 'fire': this.onFire(p, msg); break;
      case 'throw': this.onThrow(p, msg); break;
      case 'grab': this.onGrab(p, msg); break;
      case 'place': this.onPlace(p, msg); break;
      case 'melee': this.onMelee(p, msg); break;
      case 'drop': this.onDrop(p, msg); break;
      case 'arm': this.onArm(p, msg); break;
      case 'catch': this.onCatch(p, msg); break;
      case 'swap': if (p.alive) { p.hands = [p.hands[1], p.hands[0]]; for (const h of [0, 1]) { const it = this.items.inHand(p, h); if (it) it.hand = h; } this.items.syncHands(p); } break;
    }
  }

  // ---- combat ---------------------------------------------------------------
  onFire(p, msg) {
    if (!p.alive || this.state === 'ended') return;
    const w = msg.w | 0;
    const spec = WEAPONS[w];
    if (!spec || !spec.speed || !Array.isArray(msg.pellets)) return;
    if (p.lw !== w && p.rw !== w) return; // must be holding that weapon
    const now = Date.now();
    if (now - (p.lastFire[w] || 0) < fireInterval(w) * 1000 * 0.75) return;
    p.lastFire[w] = now;
    const lagComp = Math.min(p.rtt / 2 + INTERP_DELAY, 300);
    if (spec.lob) { this.launch(p, msg.pellets[0]); return; }
    this.fire(p, w, msg.pellets.slice(0, spec.pellets), lagComp, true);
  }

  // pellets: [[ox,oy,oz, dx,dy,dz], ...]  direction is normalized here
  fire(p, w, pellets, lagComp, excludeShooter) {
    const spec = WEAPONS[w];
    const out = [];
    for (const pl of pellets) {
      let o = pl.slice(0, 3).map(Number), d = pl.slice(3, 6).map(Number);
      if (o.some(isNaN) || d.some(isNaN)) continue;
      if (len(sub(o, p.head)) > 1.5) o = p.head.slice();
      const l = len(d) || 1;
      const v = scale(d, spec.speed / l);
      this.projectiles.push({ owner: p.id, team: p.team, w, p: o, v, life: spec.life, lagComp });
      out.push([r3(o[0]), r3(o[1]), r3(o[2]), r3(v[0]), r3(v[1]), r3(v[2])]);
    }
    if (out.length) this.broadcast({ type: 'shot', by: p.id, team: p.team, w, pellets: out }, excludeShooter ? p : null);
    if (out.length) hearShot(this, p, p.pos, Date.now());
  }

  // Paint Launcher: a bomb that flies in an arc and bursts on the first thing it touches.
  launch(p, pl) {
    if (!Array.isArray(pl)) return;
    let o = pl.slice(0, 3).map(Number), d = pl.slice(3, 6).map(Number);
    if (o.some(isNaN) || d.some(isNaN)) return;
    if (len(sub(o, p.head)) > 1.5) o = p.head.slice();
    const l = len(d) || 1, spec = WEAPONS[W.LAUNCHER];
    this.grenades.push({ id: nextId++, owner: p.id, team: p.team, p: o, v: scale(d, spec.speed / l), fuse: spec.life, impact: true, radius: spec.radius });
    this.broadcast({ type: 'launch', by: p.id, p: o.map(r3) }, p);
  }

  // Paint Mine: stick to a surface (normal given) or drop to the floor below.
  onPlace(p, msg) {
    if (!p.alive || this.state === 'ended') return;
    const hand = msg.hand === 0 ? 0 : 1;
    const it = this.items.inHand(p, hand);
    if (!it || it.w !== W.MINE || !this.validVec(msg.p)) return;
    let pos = msg.p.map(Number), n = this.validVec(msg.n) ? msg.n.map(Number) : null;
    if (len(sub(pos, p.head)) > 3.5) return;
    if (!n) { // no surface given: fall straight down
      const hit = raycastWorld(this.map, pos, [pos[0], -1, pos[2]]);
      if (hit) { pos = [pos[0], pos[1] + (-1 - pos[1]) * hit.t, pos[2]]; n = hit.n; } else { pos[1] = 0; n = [0, 1, 0]; }
    }
    const nl = len(n) || 1;
    n = n.map((c) => c / nl);
    this.items.consume(it, WEAPONS[W.MINE].respawn);
    // at most 2 mines per player: the oldest one fizzles
    const mine = this.mines.filter((m) => m.owner === p.id);
    if (mine.length >= 2) this.mines = this.mines.filter((m) => m !== mine[0]);
    this.mines.push({ id: nextId++, owner: p.id, team: p.team, p: add(pos, scale(n, 0.02)), n, armAt: Date.now() + WEAPONS[W.MINE].armTime * 1000, until: Date.now() + WEAPONS[W.MINE].life * 1000 });
    this.broadcast({ type: 'minePlaced', p: pos.map(r3) });
  }

  stepMines() {
    const now = Date.now(), spec = WEAPONS[W.MINE];
    const keep = [];
    for (const m of this.mines) {
      if (now > m.until) continue;
      let triggered = false;
      if (now >= m.armAt) {
        for (const e of this.players.values()) {
          if (!e.alive || e.team === m.team) continue;
          const chest = [e.head[0], e.head[1] - 0.6, e.head[2]];
          const feet = [e.pos[0], e.pos[1] + 0.2, e.pos[2]];
          if ((len(sub(chest, m.p)) < spec.trigger || len(sub(feet, m.p)) < spec.trigger) && lineOfSight(this.map, add(m.p, scale(m.n, 0.1)), chest)) { triggered = true; break; }
        }
      }
      if (triggered) this.explode(m.p, m.team, m.owner, spec.radius, W.MINE);
      else keep.push(m);
    }
    this.mines = keep;
  }

  // Foam Mallet: the client reports a swing that connected; the server checks reach.
  onMelee(p, msg) {
    if (!p.alive || this.state === 'ended') return;
    if (p.lw !== W.MALLET && p.rw !== W.MALLET) return;
    const now = Date.now(), spec = WEAPONS[W.MALLET];
    if (now - (p.lastFire[W.MALLET] || 0) < spec.cooldown * 1000 * 0.75) return;
    const target = this.players.get(msg.target | 0);
    if (!target || !target.alive || target.team === p.team || target.protectUntil > now) return;
    const pose = this.poseAt(target, now - Math.min(p.rtt / 2 + INTERP_DELAY, 300));
    if (len(sub(pose.head, p.head)) > spec.reach) return;
    p.lastFire[W.MALLET] = now;
    this.broadcast({ type: 'bonk', p: pose.head.map(r3), by: p.id });
    this.eliminate(target, p.id, W.MALLET);
  }

  validVec(a, n = 3) { return Array.isArray(a) && a.length === n && !a.map(Number).some(isNaN); }

  onThrow(p, msg) {
    if (!p.alive || this.state === 'ended' || !this.validVec(msg.p) || !this.validVec(msg.v)) return;
    const hand = msg.hand === 0 ? 0 : 1;
    let o = msg.p.map(Number), v = msg.v.map(Number);
    if (len(sub(o, p.head)) > 1.5) o = p.head.slice();
    if (!this.items.inHand(p, hand)?.fuseEnd) { this.items.drop(p, hand, o, v); return; }   // not lit: it just lands
    this.throwFrom(p, hand, o, v);
  }

  lightGrenade(it) { it.fuseEnd = Date.now() + WEAPONS[W.GRENADE].fuse * 1000; }

  // Desktop has no grip to let go of and re-grab, so it lights the grenade directly.
  onArm(p, msg) {
    const it = this.items.inHand(p, msg.hand === 0 ? 0 : 1);
    if (p.alive && this.state !== 'ended' && it?.w === W.GRENADE && !it.fuseEnd) this.lightGrenade(it);
  }

  // Grabbing an enemy's live grenade: it is defused and is now a grenade of your own.
  onCatch(p, msg) {
    const hand = msg.hand === 0 ? 0 : 1;
    const g = this.grenades.find((x) => x.id === (msg.id | 0));
    if (!p.alive || this.state === 'ended' || p.hands[hand] || !g || g.impact || g.team === p.team) return;
    if (len(sub(g.p, p.head)) > WEAPONS[W.GRENADE].catchRange) return;
    this.grenades = this.grenades.filter((x) => x !== g);
    this.items.give(p, hand, this.items.create(W.GRENADE, null, true));
    this.broadcast({ type: 'caught', by: p.id, from: g.owner, p: g.p.map(r3) });
  }

  // Throw the grenade held in `hand`; the item comes back to its spot after 10 s.
  throwFrom(p, hand, o, v) {
    const it = this.items.inHand(p, hand);
    if (!it || it.w !== W.GRENADE) return false;
    const spec = WEAPONS[W.GRENADE];
    const fuse = it.fuseEnd ? Math.max(0.05, (it.fuseEnd - Date.now()) / 1000) : spec.botFuse;   // only bots throw unlit
    it.fuseEnd = 0;
    const speed = len(v);
    this.items.consume(it, spec.respawn);
    this.grenades.push({ id: nextId++, owner: p.id, team: p.team, p: o, v: speed > 20 ? scale(v, 20 / speed) : v, fuse });
    return true;
  }

  onGrab(p, msg) {
    if (!p.alive) return;
    const hand = msg.hand === 0 ? 0 : 1;
    const it = this.items.get(msg.id | 0);
    if (p.hands[hand] || !this.items.canGrab(p, it)) return;
    if (it.flag !== undefined) { this.grabFlag(p, hand, it); return; }
    // let go and grab it again quickly: the grenade is lit
    const relit = it.w === W.GRENADE && it.droppedBy === p.id && Date.now() - it.droppedAt <= WEAPONS[W.GRENADE].armWindow * 1000;
    this.items.give(p, hand, it);
    if (relit) this.lightGrenade(it);
  }

  // ---- Capture the Flag ----------------------------------------------------------------
  // Grabbing the enemy flag (needs a free hand) picks it up; touching your own dropped flag
  // sends it home.
  grabFlag(p, hand, f) {
    if (this.state !== 'playing' || p.hands[hand]) return false;
    if (f.flag === p.team) { if (!f.atHome) this.flagHome(f, 'return', p.id); return false; }
    this.items.give(p, hand, f);
    return true;
  }

  flagHome(f, ev, by = 0) {
    const holder = f.holder && this.players.get(f.holder);
    if (holder) this.items.release(holder, f.hand);
    this.items.goHome(f);
    f.lastStatus = 0;
    this.broadcast({ type: 'flag', ev, team: f.flag, by, score: this.score });
  }

  stepFlags(now) {
    if (this.settings.mode !== 'ctf' || this.state !== 'playing') return;
    const flags = this.items.flags;
    for (const f of flags) {
      const st = this.items.flagStatus(f);
      if (st === 1) {
        const carrier = this.players.get(f.holder);
        const own = flags[carrier.team];
        // score: the carrier reaches their own flag spot while their flag is at home
        if (own.atHome && Math.hypot(carrier.pos[0] - own.home[0], carrier.pos[2] - own.home[2]) < CTF.captureRadius) {
          this.score[carrier.team]++;
          carrier.caps = (carrier.caps || 0) + 1;
          this.flagHome(f, 'capture', carrier.id);
          if (this.score[carrier.team] >= this.mode().limit) this.endMatch();
          continue;
        }
      } else if (st === 2) {
        // a team mate walking over their own dropped flag sends it home
        for (const p of this.players.values()) {
          if (!p.alive || p.team !== f.flag) continue;
          if (Math.hypot(p.pos[0] - f.pos[0], p.pos[2] - f.pos[2]) < CTF.touchRadius && Math.abs(p.pos[1] - f.pos[1]) < 1.8) {
            this.flagHome(f, 'return', p.id); break;
          }
        }
        if (this.items.flagStatus(f) === 2 && now - f.since > CTF.returnTime * 1000) this.flagHome(f, 'return', 0);
      }
      const st2 = this.items.flagStatus(f);
      if (st2 !== (f.lastStatus ?? 0)) {
        if (st2 === 1) this.broadcast({ type: 'flag', ev: 'take', team: f.flag, by: f.holder });
        if (st2 === 2) this.broadcast({ type: 'flag', ev: 'drop', team: f.flag, by: 0 });
        f.lastStatus = st2;
        ctfAnnounce(this);
      }
    }
  }

  onDrop(p, msg) {
    const hand = msg.hand === 0 ? 0 : 1;
    if (!p.hands[hand]) return;
    let pos = this.validVec(msg.p) ? msg.p.map(Number) : (hand === 0 ? p.lh : p.rh).slice(0, 3);
    if (len(sub(pos, p.head)) > 1.6) pos = p.head.slice();
    const v = this.validVec(msg.v) ? msg.v.map(Number) : [0, 0, 0];
    this.items.drop(p, hand, pos, v);
  }

  poseAt(p, t) {
    const h = p.history;
    if (!h.length || t >= h[h.length - 1].t) return { pos: p.pos, head: p.head, lh: p.lh, rh: p.rh, lw: p.lw, rw: p.rw };
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1], b = h[i], k = (t - a.t) / (b.t - a.t || 1);
        return {
          pos: lerp3(a.pos, b.pos, k), head: lerp3(a.head, b.head, k),
          lh: lerp3(a.lh, b.lh, k), rh: lerp3(a.rh, b.rh, k), lw: b.lw, rw: b.rw,
        };
      }
    }
    return h[0];
  }

  eliminate(victim, by, w) {
    if (!victim.alive) return;
    victim.alive = false;
    this.items.dropAll(victim);
    victim.respawnAt = Date.now() + RESPAWN_TIME * 1000;
    victim.outs++;
    const killer = this.players.get(by);
    if (killer && killer.team !== victim.team) {
      killer.kills++;
      if (this.settings.mode !== 'ctf' && this.state === 'playing') this.score[killer.team]++;
    }
    this.broadcast({ type: 'elim', victim: victim.id, by, w, score: this.score });
    const limit = this.mode().limit;
    if (this.score[0] >= limit || this.score[1] >= limit) this.endMatch();
  }

  stepProjectiles(dt, now) {
    const keep = [];
    for (const pr of this.projectiles) {
      const np = ballistic(pr.p, pr.v, PAINT_GRAVITY, dt);
      pr.life -= dt;
      let best = this.hitTarget(pr, pr.p, np, now - pr.lagComp);
      const world = raycastWorld(this.map, pr.p, np);
      if (world && (!best || world.t < best.t)) best = { t: world.t, world: true, n: world.n };
      const nade = this.grenadeInPath(pr.p, np);
      if (nade && (!best || nade.t < best.t)) { this.shootGrenade(nade, pr); continue; }
      if (best) {
        const hp = lerp3(pr.p, np, best.t);
        if (best.player) {
          if (best.shield) {
            this.broadcast({ type: 'splat', p: hp.map(r3), n: [0, 0, 0], team: pr.team, shield: true });
            this.damageShield(best.player, hp);
          }
          else this.eliminate(best.player, pr.owner, pr.w);
        } else {
          this.broadcast({ type: 'splat', p: hp.map(r3), n: best.n, team: pr.team });
        }
        continue;
      }
      pr.p = np;
      if (pr.life > 0 && np[1] > -1) keep.push(pr);
    }
    this.projectiles = keep;
  }

  // The first thrown grenade, or grenade lying on the map, that this paintball touches.
  grenadeInPath(p0, p1) {
    let best = null;
    for (const g of this.grenades) {
      if (g.impact) continue;
      const t = segmentSphere(p0, p1, g.p, 0.22);
      if (t !== null && (!best || t < best.t)) best = { t, live: g };
    }
    for (const it of this.items.list.values()) {
      if (it.w !== W.GRENADE || it.state !== STATE.GROUND) continue;
      const t = segmentSphere(p0, p1, add(it.pos, [0, it.rest ? 0.25 : 0.05, 0]), 0.22);    // where it is drawn
      if (t !== null && (!best || t < best.t)) best = { t, item: it };
    }
    return best;
  }

  // A live grenade keeps its thrower's color; one lying around goes off for whoever shot it.
  shootGrenade(hit, pr) {
    const radius = WEAPONS[W.GRENADE].radius;
    if (hit.live) {
      this.grenades = this.grenades.filter((g) => g !== hit.live);
      this.explode(add(hit.live.p, [0, 0.15, 0]), hit.live.team, hit.live.owner, radius, W.GRENADE);
    } else {
      const at = add(hit.item.pos, [0, 0.25, 0]);
      this.items.consume(hit.item, WEAPONS[W.GRENADE].respawn);
      this.explode(at, pr.team, pr.owner, radius, W.GRENADE);
    }
  }

  damageShield(target, at) {
    for (const hand of [0, 1]) {
      const it = this.items.inHand(target, hand);
      if (!it || it.w !== W.SHIELD) continue;
      it.hp--;
      if (it.hp <= 0) {
        this.items.consume(it, WEAPONS[W.SHIELD].respawn);
        this.broadcast({ type: 'shieldBreak', id: target.id, p: at.map(r3), team: target.team });
      }
      return;
    }
  }

  hitTarget(pr, p0, p1, t) {
    let best = null;
    for (const target of this.players.values()) {
      if (!target.alive || target.team === pr.team || target.protectUntil > Date.now()) continue;
      const pose = this.poseAt(target, t);
      // shields first: a hit on a shield blocks the ball
      for (const [hand, w] of [[pose.lh, pose.lw], [pose.rh, pose.rw]]) {
        if (w !== W.SHIELD) continue;
        const ts = segmentSphere(p0, p1, hand.slice(0, 3), WEAPONS[W.SHIELD].radius);
        if (ts !== null && (!best || ts < best.t)) best = { t: ts, player: target, shield: true };
      }
      const th = segmentSphere(p0, p1, pose.head, 0.2);
      if (th !== null && (!best || th < best.t)) best = { t: th, player: target };
      const a = [pose.head[0], pose.pos[1] + 0.3, pose.head[2]];
      const b = [pose.head[0], pose.head[1] - 0.35, pose.head[2]];
      const tb = segmentCapsule(p0, p1, a, b, 0.28);
      if (tb !== null && (!best || tb < best.t)) best = { t: tb, player: target };
    }
    return best;
  }

  stepGrenades(dt) {
    const keep = [], list = this.grenades;
    const spec = WEAPONS[W.GRENADE];
    this.grenades = [];     // a blast can make someone drop a lit grenade, which lands here
    for (const g of list) {
      g.fuse -= dt;
      const np = ballistic(g.p, g.v, GRENADE_GRAVITY, dt);
      const hit = raycastWorld(this.map, g.p, np);
      // launcher bombs burst on players too
      const hitsPlayer = g.impact && [...this.players.values()].some((e) => e.alive && e.team !== g.team &&
        segmentCapsule(g.p, np, [e.head[0], e.pos[1] + 0.3, e.head[2]], e.head, 0.35) !== null);
      if (g.impact && (hit || hitsPlayer)) {
        g.p = hit ? lerp3(g.p, np, Math.max(0, hit.t - 0.01)) : np;
        g.fuse = 0;
      } else if (hit) {
        const hp = lerp3(g.p, np, Math.max(0, hit.t - 0.01));
        const vn = dot(g.v, hit.n);
        g.v = sub(g.v, scale(hit.n, 2 * vn)).map((c) => c * 0.4);
        g.p = add(hp, scale(hit.n, 0.03));
      } else g.p = np;
      if (g.fuse > 0) { keep.push(g); continue; }
      this.explode(add(g.p, [0, 0.15, 0]), g.team, g.owner, g.radius || spec.radius, g.impact ? W.LAUNCHER : W.GRENADE);
    }
    this.grenades = [...keep, ...this.grenades];
  }

  explode(center, team, owner, radius, w) {
    this.broadcast({ type: 'boom', p: center.map(r3), team, r: radius });
    for (const target of this.players.values()) {
      if (!target.alive || target.team === team || target.protectUntil > Date.now()) continue;
      const chest = [target.head[0], target.head[1] - 0.5, target.head[2]];
      // a paint grenade goes through walls; launcher bombs and mines don't
      if (len(sub(chest, center)) < radius && (w === W.GRENADE || lineOfSight(this.map, center, chest) || lineOfSight(this.map, center, target.head))) {
        this.eliminate(target, owner, w);
      }
    }
  }

  // ---- match flow -------------------------------------------------------------
  spawn(p) {
    const now = Date.now();
    const points = this.map.spawns[p.team];
    const enemies = [...this.players.values()].filter((e) => e.team !== p.team && e.alive);
    // pick the spawn point farthest from enemies, with a bit of randomness
    let best = points[0], bestScore = -Infinity;
    for (const sp of points) {
      let d = 100;
      for (const e of enemies) d = Math.min(d, len(sub(sp, e.pos)));
      const score = d + Math.random() * 3;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    p.pos = [best[0] + (Math.random() - 0.5), 0, best[2] + (Math.random() - 0.5)];
    p.head = add(p.pos, [0, EYE_HEIGHT, 0]);
    p.alive = true;
    p.protectUntil = now + SPAWN_PROTECT * 1000;
    p.history = [];
    this.items.equipSpawn(p);
    const yaw = this.map.spawnYaw[p.team];
    if (p.bot) p.brain.yaw = yaw;
    this.send(p, { type: 'spawn', p: p.pos.map(r3), yaw });
  }

  // ---- maps & voting ----------------------------------------------------------------
  loadMap(id) {
    if (!MAPS[id]) id = DEFAULT_MAP;   // a custom map may have been deleted meanwhile
    this.map = MAPS[id];
    this.projectiles = []; this.grenades = []; this.mines = [];
    for (const p of this.players.values()) { p.hands = [0, 0]; p.lw = p.rw = W.NONE; p.history = []; resetBotForMap(this, p); }
    this.items = new Items(this);
    this.broadcast({ type: 'map', id });
    console.log(`[${this.code}] map -> ${this.map.name}`);
  }

  startVote() {
    // offer up to 3 maps: the others first (shuffled), then the current one
    const others = Object.keys(MAPS).filter((k) => k !== this.map.id).sort(() => Math.random() - 0.5);
    this.voteOptions = [...others.slice(0, 2), this.map.id];
    this.votes = new Map();
    this.sendVotes();
  }

  sendVotes() {
    const counts = Object.fromEntries(this.voteOptions.map((k) => [k, 0]));
    for (const v of this.votes.values()) counts[v]++;
    this.broadcast({ type: 'vote', options: this.voteOptions, counts, endsIn: Math.max(0, Math.ceil(this.stateTimer)) });
  }

  voteWinner() {
    if (!this.voteOptions) return this.map.id;
    const counts = Object.fromEntries(this.voteOptions.map((k) => [k, 0]));
    for (const v of this.votes.values()) counts[v]++;
    const best = Math.max(...Object.values(counts));
    if (best === 0) return this.voteOptions[0]; // nobody voted: rotate to a new map
    const top = this.voteOptions.filter((k) => counts[k] === best);
    return top[(Math.random() * top.length) | 0];
  }

  endMatch() {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this.winner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.stateTimer = END_SCREEN_TIME;
    this.projectiles = []; this.grenades = []; this.mines = [];
    this.sendMatch();
    this.startVote();
  }

  startMatch() {
    if (this.voteOptions) {
      const next = this.voteWinner();
      this.voteOptions = null;
      if (next !== this.map.id) this.loadMap(next);
      this.broadcast({ type: 'vote', options: [], counts: {}, endsIn: 0 });
    }
    this.state = 'playing';
    this.projectiles = []; this.grenades = []; this.mines = [];   // nothing carries over from the warm-up
    this.rebalanceBots();     // a matchmade room gets its bots now that the warm-up is over
    this.score = [0, 0];
    this.timeLeft = this.mode().time;
    this.winner = -1;
    this.items.resetAll();
    for (const f of this.items.flags) f.lastStatus = 0;
    for (const p of this.players.values()) { p.kills = 0; p.outs = 0; this.spawn(p); }
    this.sendMatch();
    this.sendRoster();
  }

  update() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    this.tick++;

    if (this.state === 'playing') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.endMatch(); }
    } else {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.startMatch();
    }

    for (const p of this.players.values()) {
      if (!p.alive && now >= p.respawnAt && this.state !== 'ended') this.spawn(p);
      if (p.bot) updateBot(this, p, dt, now);
      p.history.push({ t: now, pos: p.pos, head: p.head, lh: p.lh.slice(0, 3), rh: p.rh.slice(0, 3), lw: p.lw, rw: p.rw });
      if (p.history.length > HISTORY) p.history.shift();
    }

    this.stepProjectiles(dt, now);
    this.stepGrenades(dt);
    this.stepMines();
    this.items.update(dt);
    this.stepFlags(now);

    const snap = {
      type: 'snap', t: now, st: this.state, tl: Math.ceil(this.state === 'waiting' ? this.stateTimer : this.timeLeft), sc: this.score,
      pl: [...this.players.values()].map((p) => [
        p.id, p.alive ? 1 : 0, p.protectUntil > now ? 1 : 0,
        ...p.pos.map(r3), ...p.head.map(r3), ...p.hq.map(r3),
        ...p.lh.map(r3), ...p.rh.map(r3), p.lw, p.rw,
      ]),
      gr: this.grenades.map((g) => [g.id, r3(g.p[0]), r3(g.p[1]), r3(g.p[2]), g.team, g.impact ? 1 : 0]),
      it: this.items.snapshot(),
      fl: this.items.flags.map((f) => [this.items.flagStatus(f), f.holder || 0]),
      mn: this.mines.map((m) => [m.id, r3(m.p[0]), r3(m.p[1]), r3(m.p[2]), r3(m.n[0]), r3(m.n[1]), r3(m.n[2]), m.team, now >= m.armAt ? 1 : 0]),
    };
    if (this.settings.debug && this.tick % 10 === 0) {
      snap.dbg = this.bots().map((b) => [b.id, b.brain.path.slice(b.brain.pathIdx).map(([x, z]) => [r3(x), r3(z)]), b.brain.targetId || 0]);
    }
    this.broadcast(snap);
  }
}

function clamp(v, a, b) { return isNaN(v) ? a : Math.max(a, Math.min(b, v)); }
