// Weapon items: every weapon is a physical item that is on the ground, held in a
// hand, or gone (thrown grenade / broken shield, waiting to respawn at its home).
// Players spawn with a personal pistol; map weapons start at their home spots.
import { W, WEAPONS, ITEM_RULES, flagHomes } from '../shared/constants.js';
import { raycastWorld, groundHeight, ballistic, lerp3, add, scale, len, sub } from '../shared/physics.js';

let nextItemId = 1;
const r3 = (v) => Math.round(v * 1000) / 1000;
export const STATE = { GROUND: 0, HELD: 1, GONE: 2 };

export class Items {
  constructor(room) {
    this.room = room;
    this.map = room.map;
    this.list = new Map();
    for (const it of this.map.items || []) {
      const y = it.y ?? groundHeight(this.map, it.x, it.z, 10, 0.2);
      this.create(it.w, [it.x, y, it.z]);
    }
    // Capture the Flag: one flag per team at its base
    this.flags = [];
    if (room.settings.mode === 'ctf') {
      flagHomes(this.map).forEach(([x, , z], t) => {
        const f = this.create(t === 0 ? W.FLAG0 : W.FLAG1, [x, groundHeight(this.map, x, z, 10, 0.2), z]);
        f.flag = t; f.atHome = true;
        this.flags[t] = f;
      });
    }
  }

  // 0 = at its base, 1 = carried, 2 = lying somewhere
  flagStatus(f) { return f.state === STATE.HELD ? 1 : f.atHome ? 0 : 2; }

  create(w, home, personal = false) {
    const it = {
      id: nextItemId++, w, home: home ? home.slice() : null, personal,
      pos: (home || [0, 0, 0]).slice(), vel: [0, 0, 0], rest: true,
      state: STATE.GROUND, holder: 0, hand: -1, hp: WEAPONS[W.SHIELD].hits, since: Date.now(), respawnAt: 0,
    };
    this.list.set(it.id, it);
    return it;
  }

  get(id) { return this.list.get(id); }
  inHand(p, hand) { return p.hands[hand] ? this.list.get(p.hands[hand]) : null; }

  syncHands(p) {
    p.lw = this.inHand(p, 0)?.w ?? W.NONE;
    p.rw = this.inHand(p, 1)?.w ?? W.NONE;
  }

  give(p, hand, it) {
    it.atHome = false;
    it.droppedBy = 0;
    it.state = STATE.HELD; it.holder = p.id; it.hand = hand; it.rest = true;
    p.hands[hand] = it.id;
    this.syncHands(p);
  }

  release(p, hand) {
    const it = this.inHand(p, hand);
    p.hands[hand] = 0;
    this.syncHands(p);
    if (it) { it.holder = 0; it.hand = -1; }
    return it;
  }

  // Put an item down (or toss it) at a world position; it falls and stays where it lands.
  drop(p, hand, pos, vel = [0, 0, 0]) {
    if (this.inHand(p, hand)?.fuseEnd) { this.room.throwFrom(p, hand, pos, vel); return null; }   // a lit grenade stays live
    const it = this.release(p, hand);
    if (!it) return null;
    it.droppedBy = p.id; it.droppedAt = Date.now();
    const hx = this.map.halfX - 0.4, hz = this.map.halfZ - 0.4;
    it.pos = [Math.max(-hx, Math.min(hx, pos[0])), Math.max(0.05, pos[1]), Math.max(-hz, Math.min(hz, pos[2]))];
    const sp = len(vel);
    it.vel = sp > 8 ? scale(vel, 8 / sp) : vel.slice();
    it.state = STATE.GROUND; it.rest = false; it.since = Date.now();
    return it;
  }

  // Item used up (thrown grenade, broken shield): it respawns at home after `delay` s.
  consume(it, delay) {
    const holder = it.holder && this.room.players.get(it.holder);
    if (holder) this.release(holder, it.hand);
    if (it.personal || !it.home) { this.list.delete(it.id); return; }
    it.state = STATE.GONE;
    it.respawnAt = Date.now() + delay * 1000;
  }

  goHome(it) {
    it.state = STATE.GROUND; it.pos = it.home.slice(); it.vel = [0, 0, 0]; it.rest = true;
    it.holder = 0; it.hand = -1; it.hp = WEAPONS[W.SHIELD].hits; it.since = Date.now(); it.fuseEnd = 0; it.droppedBy = 0;
    if (it.flag !== undefined) it.atHome = true;
  }

  // On elimination: whatever the player held falls where they were.
  dropAll(p) {
    for (const hand of [0, 1]) {
      const it = this.inHand(p, hand);
      if (!it) continue;
      if (it.personal && !it.fuseEnd) { this.release(p, hand); this.list.delete(it.id); continue; } // spawn pistols vanish
      const hp = hand === 0 ? p.lh : p.rh;
      this.drop(p, hand, hp.slice(0, 3), [0, 0, 0]);
    }
  }

  // New spawn: clear the hands and hand out a fresh pistol (right hand).
  equipSpawn(p) {
    for (const hand of [0, 1]) if (p.hands[hand]) {
      const it = this.inHand(p, hand);
      if (it?.personal) { this.release(p, hand); this.list.delete(it.id); } else if (it) this.drop(p, hand, p.pos, [0, 0, 0]);
    }
    const pistol = this.create(W.PISTOL, null, true);
    this.give(p, 1, pistol);
  }

  resetAll() {
    for (const it of [...this.list.values()]) {
      if (it.personal) { this.list.delete(it.id); continue; }
      this.goHome(it);
    }
    for (const p of this.room.players.values()) { p.hands = [0, 0]; this.syncHands(p); }
  }

  canGrab(p, it) {
    if (!it || it.state !== STATE.GROUND) return false;
    const dx = it.pos[0] - p.pos[0], dz = it.pos[2] - p.pos[2], dy = it.pos[1] - p.pos[1];
    return dx * dx + dz * dz <= ITEM_RULES.grabRange * ITEM_RULES.grabRange && dy > -1.2 && dy < 2.4;
  }

  update(dt) {
    const now = Date.now();
    for (const it of [...this.list.values()]) {
      if (it.state === STATE.GONE) { if (now >= it.respawnAt) this.goHome(it); continue; }
      if (it.state === STATE.HELD && it.fuseEnd && now >= it.fuseEnd) {     // held too long
        const holder = this.room.players.get(it.holder);
        const hand = it.hand === 0 ? holder?.lh : holder?.rh;
        this.consume(it, WEAPONS[W.GRENADE].respawn);
        if (holder) this.room.explode(hand.slice(0, 3), holder.team, holder.id, WEAPONS[W.GRENADE].radius, W.GRENADE);
        continue;
      }
      if (it.state !== STATE.GROUND) continue;
      if (it.personal && now - it.since > ITEM_RULES.droppedPistolLife * 1000) { this.list.delete(it.id); continue; }
      if (it.rest) continue;
      const np = ballistic(it.pos, it.vel, 9.8, dt);
      const hit = raycastWorld(this.map, it.pos, np);
      if (hit) {
        const hp = lerp3(it.pos, np, Math.max(0, hit.t - 0.01));
        if (hit.n[1] > 0.5) { it.pos = add(hp, [0, 0.02, 0]); it.vel = [0, 0, 0]; it.rest = true; }
        else {
          const vn = it.vel[0] * hit.n[0] + it.vel[1] * hit.n[1] + it.vel[2] * hit.n[2];
          it.vel = sub(it.vel, scale(hit.n, 2 * vn)).map((c) => c * 0.3);
          it.pos = add(hp, scale(hit.n, 0.03));
        }
      } else it.pos = np;
      if (it.pos[1] < 0.02) { it.pos[1] = 0.02; it.vel = [0, 0, 0]; it.rest = true; }
    }
  }

  snapshot() {
    const out = [];
    for (const it of this.list.values()) {
      if (it.state === STATE.GONE) continue;
      out.push([it.id, it.w, r3(it.pos[0]), r3(it.pos[1]), r3(it.pos[2]), it.state, it.holder, it.hand, it.rest ? 1 : 0, it.fuseEnd ? 1 : 0]);
    }
    return out;
  }
}
