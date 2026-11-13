// Shared game constants (used by server and client).

export const TICK_RATE = 30;            // server simulation ticks per second
export const SEND_RATE = 20;            // client pose updates per second
export const INTERP_DELAY = 100;        // ms of interpolation delay for remote players

export const TEAM_SIZE = 4;
export const MAX_PLAYERS = TEAM_SIZE * 2;
export const TEAM_COLORS = [0xff7a1a, 0x1ab8ff];   // orange, cyan
export const TEAM_NAMES = ['Orange', 'Cyan'];

export const MATCH_TIME = 300;          // seconds
export const SCORE_LIMIT = 15;
export const RESPAWN_TIME = 4;          // seconds
export const SPAWN_PROTECT = 1.5;       // seconds
export const END_SCREEN_TIME = 12;      // seconds between matches (map vote happens here)

export const PAINT_GRAVITY = 4.0;       // m/s^2, paintballs are floaty
export const GRENADE_GRAVITY = 9.8;

export const PLAYER_RADIUS = 0.3;
export const EYE_HEIGHT = 1.6;
export const STEP_HEIGHT = 0.45;
export const WALK_SPEED = 3.2;
export const SPRINT_SPEED = 5.6;
export const CROUCH_SPEED = 1.6;
export const CROUCH_DROP = 0.65;   // how much lower your eyes go when crouching
export const JUMP_SPEED = 4.2;

// Weapon ids
export const W = {
  NONE: 0, PISTOL: 1, SHOTGUN: 2, GRENADE: 3, SHIELD: 4,
  BURST: 5, SNIPER: 6, LAUNCHER: 7, SPRAYER: 8, MINE: 9, MALLET: 10,
  FLAG0: 11, FLAG1: 12,   // Capture the Flag: Orange's flag, Cyan's flag
};
export const isFlag = (w) => w === W.FLAG0 || w === W.FLAG1;
export const flagTeam = (w) => w - W.FLAG0;

export const WEAPONS = {
  [W.PISTOL]:  { name: 'Paint Pistol',  speed: 36, cooldown: 0.18, ammo: 10, reload: 1.0, pellets: 1, spread: 0.6, life: 2.0 },
  [W.SHOTGUN]: { name: 'Paint Shotgun', speed: 30, cooldown: 0.8,  ammo: 4,  reload: 1.4, pellets: 6, spread: 4.5, life: 0.55 },
  [W.GRENADE]: { name: 'Paint Grenade', fuse: 3, botFuse: 1.6, armWindow: 1.2, catchRange: 3, radius: 3.5, respawn: 10 },
  [W.SHIELD]:  { name: 'Paint Shield',  radius: 0.36, hits: 5, respawn: 15 },
  // three-round burst per trigger pull
  [W.BURST]:   { name: 'Burst Rifle',   speed: 44, cooldown: 0.55, ammo: 15, reload: 1.5, pellets: 1, spread: 0.7, life: 2.2, burst: 3, burstGap: 0.085 },
  // fast, flat, precise; has a magnifying scope
  [W.SNIPER]:  { name: 'Scope Rifle',   speed: 85, cooldown: 1.1,  ammo: 3,  reload: 1.8, pellets: 1, spread: 0.05, life: 1.6, scope: true },
  // lobs a paint bomb that bursts on impact
  [W.LAUNCHER]: { name: 'Paint Launcher', speed: 17, cooldown: 1.2, ammo: 3, reload: 2.0, pellets: 1, spread: 0, life: 4, lob: true, radius: 1.8 },
  // full-auto, short range stream
  [W.SPRAYER]: { name: 'Paint Sprayer', speed: 22, cooldown: 0.075, ammo: 40, reload: 2.0, pellets: 1, spread: 3.2, life: 0.6, auto: true },
  // stick it on a floor or wall; bursts when an enemy gets close
  [W.MINE]:    { name: 'Paint Mine',    trigger: 1.7, radius: 2.6, armTime: 1.0, respawn: 15, life: 90 },
  // foam mallet: swing it into an enemy
  [W.MALLET]:  { name: 'Foam Mallet',   reach: 2.4, cooldown: 0.55 },
  [W.FLAG0]:   { name: 'Orange Flag', flag: true },
  [W.FLAG1]:   { name: 'Cyan Flag', flag: true },
};

// ---- game modes ----------------------------------------------------------------
export const MODES = {
  tdm: { name: 'Team Battle', short: 'Team Battle', time: MATCH_TIME, limit: SCORE_LIMIT },
  ctf: { name: 'Capture the Flag', short: 'CTF', time: 480, limit: 3 },
};
export const CTF = {
  captureRadius: 2.2,   // carry the enemy flag this close to your own flag spot to score
  touchRadius: 1.3,     // walk this close to your own dropped flag to send it home
  returnTime: 25,       // s a dropped flag lies around before it goes home by itself
};

// Where each team's flag stands: inside its base, between the spawns and the front wall
// (or map.flagHomes when a map sets it).
export function flagHomes(map) {
  if (map.flagHomes) return map.flagHomes.map((f) => [f[0], f[1] ?? 0, f[2]]);
  return [0, 1].map((t) => {
    const sp = map.spawns[t];
    const x = sp.reduce((a, s) => a + s[0], 0) / sp.length;
    return [x - Math.sign(x) * 2.5, 0, 0];
  });
}

// minimum time between 'fire' messages the server accepts for each gun
export const fireInterval = (w) => (WEAPONS[w].burst ? WEAPONS[w].burstGap : WEAPONS[w].cooldown);

export const ITEM_RULES = {
  grabRange: 2.3,          // max distance (m) from the player to pick something up
  vrGrabRadius: 0.35,      // VR: hand must be this close to the item
  droppedPistolLife: 25,   // s before an abandoned spawn pistol disappears
};

export const BOT_DIFFICULTY = {
  easy:   { spreadDeg: 7,   reaction: 0.9,  fireInterval: 1.0,  lead: 0.3, speed: 2.4 },
  normal: { spreadDeg: 3.5, reaction: 0.5,  fireInterval: 0.6,  lead: 0.7, speed: 3.0 },
  hard:   { spreadDeg: 1.4, reaction: 0.25, fireInterval: 0.35, lead: 1.0, speed: 3.4 },
};
