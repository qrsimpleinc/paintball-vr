// Procedural models in a soft cartoon style: weapons and original avatars
// (floating torso, no arms, round head with a simple face, paintball goggles).
// Weapons point along -Z with the hand at the origin (matches the XR target-ray space).
import * as THREE from 'three';
import { W, TEAM_COLORS } from '/shared/constants.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}

function mesh(geo, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
const box = (w, h, d, color, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z);
const cyl = (r1, r2, h, color, x, y, z, seg = 12) => mesh(new THREE.CylinderGeometry(r1, r2, h, seg), color, x, y, z);
const sph = (r, color, x, y, z, ws = 14, hs = 10) => mesh(new THREE.SphereGeometry(r, ws, hs), color, x, y, z);

const BODY = 0x3b4048, GRIP = 0x2a2d33, METAL = 0x9aa3ad;

// ---- weapons ----------------------------------------------------------------------
export function makePistol(team) {
  const g = new THREE.Group();
  const grip = box(0.036, 0.1, 0.05, GRIP, 0, -0.05, 0.02); grip.rotation.x = 0.28; g.add(grip);
  g.add(box(0.05, 0.065, 0.21, BODY, 0, 0.012, -0.06));
  g.add(box(0.052, 0.03, 0.12, team, 0, 0.03, -0.07));            // accent panel
  g.add(cyl(0.016, 0.016, 0.08, METAL, 0, 0.015, -0.19).rotateX(Math.PI / 2));
  g.add(box(0.03, 0.012, 0.03, GRIP, 0, -0.03, -0.02));           // trigger guard
  const hopper = sph(0.04, team, 0, 0.075, -0.02); hopper.scale.set(1, 0.85, 1.2); g.add(hopper);
  g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.24);
  return g;
}

export function makeShotgun(team) {
  const g = new THREE.Group();
  const grip = box(0.036, 0.1, 0.05, GRIP, 0, -0.05, 0.02); grip.rotation.x = 0.28; g.add(grip);
  g.add(box(0.056, 0.075, 0.36, BODY, 0, 0.015, -0.12));
  g.add(cyl(0.02, 0.02, 0.22, METAL, 0, 0.032, -0.4).rotateX(Math.PI / 2));
  g.add(box(0.05, 0.045, 0.13, team, 0, -0.03, -0.3));            // pump
  g.add(box(0.045, 0.07, 0.17, GRIP, 0, -0.005, 0.13));           // stock
  g.add(box(0.058, 0.02, 0.2, team, 0, 0.055, -0.1));
  g.userData.muzzle = new THREE.Vector3(0, 0.032, -0.52);
  return g;
}

export function makeGrenade(team) {
  const g = new THREE.Group();
  g.add(sph(0.05, team, 0, 0, 0));
  const band = mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 16), GRIP); band.rotation.x = Math.PI / 2; g.add(band);
  g.add(cyl(0.015, 0.015, 0.03, METAL, 0, 0.058, 0, 8));
  const ring = mesh(new THREE.TorusGeometry(0.014, 0.003, 4, 10), METAL); ring.position.set(0.02, 0.07, 0); g.add(ring);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
  spark.position.y = 0.085; spark.visible = false; g.add(spark);
  g.userData.spark = spark;     // shown blinking while the grenade is lit
  return g;
}

export function makeShield(team) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.025, 24),
    new THREE.MeshLambertMaterial({ color: team, transparent: true, opacity: 0.6 }));
  disc.rotation.x = Math.PI / 2; disc.position.z = -0.08;
  g.add(disc);
  const rim = mesh(new THREE.TorusGeometry(0.36, 0.02, 6, 28), 0xf4f4f4); rim.position.z = -0.08; g.add(rim);
  const boss = sph(0.06, 0xf4f4f4, 0, 0, -0.095); boss.scale.z = 0.4; g.add(boss);
  g.add(box(0.03, 0.1, 0.03, GRIP, 0, 0, -0.04));
  return g;
}

// Burst rifle: long body, side magazine, carry handle.
export function makeBurst(team) {
  const g = new THREE.Group();
  const grip = box(0.036, 0.1, 0.05, GRIP, 0, -0.05, 0.02); grip.rotation.x = 0.28; g.add(grip);
  g.add(box(0.055, 0.07, 0.44, BODY, 0, 0.015, -0.13));
  g.add(cyl(0.017, 0.017, 0.16, METAL, 0, 0.022, -0.42).rotateX(Math.PI / 2));
  g.add(box(0.05, 0.12, 0.05, team, 0, -0.06, -0.12));          // magazine
  g.add(box(0.03, 0.03, 0.16, GRIP, 0, 0.07, -0.1));             // carry handle
  g.add(box(0.06, 0.02, 0.3, team, 0, 0.052, -0.18));
  g.add(box(0.045, 0.075, 0.13, GRIP, 0, 0, 0.14));              // stock
  g.userData.muzzle = new THREE.Vector3(0, 0.022, -0.52);
  return g;
}

// Scope rifle: very long barrel, big scope with a lens that shows a zoomed view.
export function makeSniper(team) {
  const g = new THREE.Group();
  const grip = box(0.036, 0.1, 0.05, GRIP, 0, -0.05, 0.02); grip.rotation.x = 0.28; g.add(grip);
  g.add(box(0.05, 0.065, 0.5, BODY, 0, 0.012, -0.17));
  g.add(cyl(0.014, 0.014, 0.34, METAL, 0, 0.02, -0.58).rotateX(Math.PI / 2));
  g.add(box(0.052, 0.028, 0.34, team, 0, -0.025, -0.2));
  g.add(box(0.045, 0.085, 0.2, GRIP, 0, -0.005, 0.16));          // stock
  // scope tube + mounts
  g.add(cyl(0.026, 0.026, 0.24, 0x23262b, 0, 0.085, -0.1, 14).rotateX(Math.PI / 2));
  g.add(cyl(0.032, 0.026, 0.04, 0x23262b, 0, 0.085, 0.03, 14).rotateX(Math.PI / 2));
  for (const z of [-0.16, -0.04]) g.add(box(0.015, 0.04, 0.015, METAL, 0, 0.055, z));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 20), new THREE.MeshBasicMaterial({ color: 0x5a8fb0 }));
  lens.position.set(0, 0.085, 0.052);              // eyepiece faces the player
  g.add(lens);
  g.userData.lens = lens;
  g.userData.scopeEye = new THREE.Vector3(0, 0.085, -0.22);
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.76);
  return g;
}

// Paint launcher: fat drum barrel and a revolving cylinder.
export function makeLauncher(team) {
  const g = new THREE.Group();
  const grip = box(0.04, 0.11, 0.055, GRIP, 0, -0.055, 0.03); grip.rotation.x = 0.28; g.add(grip);
  g.add(cyl(0.055, 0.055, 0.34, BODY, 0, 0.03, -0.14, 16).rotateX(Math.PI / 2));
  g.add(cyl(0.065, 0.065, 0.12, team, 0, 0.03, -0.02, 6).rotateX(Math.PI / 2));   // drum
  g.add(cyl(0.06, 0.06, 0.03, 0x23262b, 0, 0.03, -0.32, 16).rotateX(Math.PI / 2));
  g.add(box(0.03, 0.05, 0.12, GRIP, 0, -0.04, -0.2));            // fore grip
  g.add(box(0.045, 0.06, 0.12, GRIP, 0, 0.0, 0.12));
  g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.36);
  return g;
}

// Paint sprayer: tank on top, hose, wide nozzle.
export function makeSprayer(team) {
  const g = new THREE.Group();
  const grip = box(0.036, 0.1, 0.05, GRIP, 0, -0.05, 0.02); grip.rotation.x = 0.28; g.add(grip);
  g.add(box(0.05, 0.06, 0.3, BODY, 0, 0.01, -0.09));
  const tank = mesh(new THREE.CapsuleGeometry(0.045, 0.14, 4, 12), team, 0, 0.09, -0.06); tank.rotation.x = Math.PI / 2; g.add(tank);
  g.add(cyl(0.012, 0.012, 0.14, 0x23262b, 0, 0.02, -0.28).rotateX(Math.PI / 2));
  g.add(cyl(0.035, 0.016, 0.06, METAL, 0, 0.02, -0.37, 12).rotateX(Math.PI / 2));   // nozzle
  g.add(box(0.03, 0.05, 0.1, GRIP, 0, -0.035, -0.18));
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.41);
  return g;
}

// Paint mine: flat puck with a team-colored light on top.
export function makeMine(team) {
  const g = new THREE.Group();
  g.add(cyl(0.075, 0.085, 0.035, 0x3a3f47, 0, 0, 0, 18));
  g.add(cyl(0.06, 0.06, 0.012, team, 0, 0.022, 0, 18));
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  light.position.y = 0.032;
  g.add(light);
  g.userData.light = light;
  return g;
}

// Foam mallet: long handle and a big soft head (held at the bottom of the handle).
export function makeMallet(team) {
  const g = new THREE.Group();
  const handle = cyl(0.018, 0.02, 0.55, 0xd9a86a, 0, 0, -0.26, 10); handle.rotation.x = Math.PI / 2; g.add(handle);
  g.add(cyl(0.024, 0.024, 0.1, GRIP, 0, 0, 0.0, 10).rotateX(Math.PI / 2));
  const head = cyl(0.09, 0.09, 0.24, team, 0, 0, -0.58, 18); head.rotation.z = Math.PI / 2; g.add(head);
  for (const x of [-0.125, 0.125]) { const cap = cyl(0.095, 0.095, 0.02, 0xf4f4f4, x, 0, -0.58, 18); cap.rotation.z = Math.PI / 2; g.add(cap); }
  g.userData.hammerHead = new THREE.Vector3(0, 0, -0.58);
  return g;
}

// Capture the Flag: a pole held near the bottom, cloth in the team colour near the top.
// The pole goes up (+Y) from the hand; userData.cloth waves.
export function makeFlag(t) {
  const g = new THREE.Group();
  const color = TEAM_COLORS[t];
  g.add(cyl(0.022, 0.022, 1.65, 0xf1f1f1, 0, 0.45, 0, 10));
  g.add(sph(0.045, 0xffd34d, 0, 1.3, 0, 12, 8));
  g.add(cyl(0.03, 0.03, 0.12, GRIP, 0, 0, 0, 10));
  const cloth = new THREE.Group();
  cloth.position.set(0, 1.08, 0);
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.015), mat(color, { emissive: color, emissiveIntensity: 0.25 }));
  sheet.position.x = 0.32; sheet.castShadow = true;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.02), mat(0xffffff));
  stripe.position.x = 0.32;
  const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.024, 16), mat(0xffffff));
  dot.rotation.x = Math.PI / 2; dot.position.set(0.32, 0, 0);
  cloth.add(sheet, stripe, dot);
  g.add(cloth);
  g.userData.cloth = cloth;
  g.userData.flag = true;
  return g;
}

export function makeWeapon(id, team) {
  switch (id) {
    case W.FLAG0: return makeFlag(0);
    case W.FLAG1: return makeFlag(1);
    case W.PISTOL: return makePistol(team);
    case W.SHOTGUN: return makeShotgun(team);
    case W.GRENADE: return makeGrenade(team);
    case W.SHIELD: return makeShield(team);
    case W.BURST: return makeBurst(team);
    case W.SNIPER: return makeSniper(team);
    case W.LAUNCHER: return makeLauncher(team);
    case W.SPRAYER: return makeSprayer(team);
    case W.MINE: return makeMine(team);
    case W.MALLET: return makeMallet(team);
    default: return null;
  }
}

// ---- avatar look ----------------------------------------------------------------
const SKINS = [0xf6d3b3, 0xebbd96, 0xd39b6f, 0xa86e47, 0x7b4a2d, 0xf1c7a0];
const HAIRS = [0x2b1d14, 0x5b3a21, 0xa3662f, 0xe3bc62, 0x1c1c1c, 0xc44c2b, 0x8a8f99];

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

export function lookFor(name, bot) {
  const h = hash(name || 'player');
  return {
    bot: !!bot,
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 4) % HAIRS.length],
    hairStyle: (h >>> 8) % 4,       // 0 short, 1 tuft, 2 beanie, 3 bun
    goggles: ((h >>> 12) % 3) !== 0, // most wear goggles up on the forehead
  };
}

// Round cartoon head, ~0.27 m tall, centered at the eyes. Face parts are kept in
// userData so the avatar can blink and change expression.
export function makeHead(team, look) {
  const g = new THREE.Group();
  if (look.bot) return makeBotHead(team, g);
  const skull = sph(0.13, look.skin, 0, 0.02, 0, 20, 14); skull.scale.set(1, 1.08, 0.96); g.add(skull);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(sx * 0.045, 0.012, -0.118);
    const ball = sph(0.019, 0x1d1f24, 0, 0, 0, 10, 8); ball.scale.z = 0.5; eye.add(ball);
    eye.add(sph(0.006, 0xffffff, 0.006, 0.008, -0.008, 6, 4));
    g.add(eye); eyes.push(eye);
    const cheek = sph(0.02, 0xf08a7a, sx * 0.075, -0.03, -0.1, 8, 6); cheek.scale.z = 0.3;
    cheek.material = mat(0xf08a7a, { transparent: true, opacity: 0.45 }); g.add(cheek);
    const brow = box(0.035, 0.008, 0.008, new THREE.Color(look.hair).multiplyScalar(0.9).getHex(), sx * 0.047, 0.05, -0.12);
    brow.rotation.z = sx * -0.12; g.add(brow);
  }
  const smile = mesh(new THREE.TorusGeometry(0.032, 0.0075, 6, 14, Math.PI), 0x5a2b24, 0, -0.035, -0.12);
  smile.rotation.z = Math.PI; g.add(smile);
  const mouthO = sph(0.017, 0x5a2b24, 0, -0.045, -0.12, 10, 8); mouthO.scale.set(1, 1.2, 0.4); mouthO.visible = false; g.add(mouthO);
  g.add(sph(0.016, new THREE.Color(look.skin).multiplyScalar(0.92).getHex(), 0, -0.01, -0.13, 8, 6));
  for (const sx of [-1, 1]) { const ear = sph(0.025, look.skin, sx * 0.128, 0.0, 0, 8, 6); ear.scale.x = 0.5; g.add(ear); }
  if (look.hairStyle === 2) {                       // beanie in team color
    g.add(mesh(new THREE.SphereGeometry(0.137, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), team, 0, 0.045, 0.005));
    g.add(mesh(new THREE.TorusGeometry(0.133, 0.018, 6, 20), 0xf4f4f4, 0, 0.05, 0.005).rotateX(Math.PI / 2));
    g.add(sph(0.03, 0xf4f4f4, 0, 0.19, 0.01));
  } else {
    const hair = mesh(new THREE.SphereGeometry(0.136, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.3), look.hair, 0, 0.05, 0.012);
    hair.rotation.x = 0.25; g.add(hair);
    if (look.hairStyle === 1) { const tuft = mesh(new THREE.ConeGeometry(0.05, 0.1, 6), look.hair, 0.02, 0.19, -0.04); tuft.rotation.set(-0.5, 0, -0.3); g.add(tuft); }
    if (look.hairStyle === 3) g.add(sph(0.05, look.hair, 0, 0.12, 0.11));
  }
  if (look.goggles && look.hairStyle !== 2) {       // paintball goggles up on the forehead
    const strap = mesh(new THREE.TorusGeometry(0.134, 0.012, 6, 24), 0x2a2d33, 0, 0.075, 0); strap.rotation.x = Math.PI / 2 - 0.25; g.add(strap);
    const lens = box(0.16, 0.05, 0.03, team, 0, 0.1, -0.115); lens.rotation.x = -0.45;
    lens.material = mat(team, { transparent: true, opacity: 0.85 }); g.add(lens);
    const frame = box(0.17, 0.06, 0.02, 0x2a2d33, 0, 0.1, -0.106); frame.rotation.x = -0.45; g.add(frame);
  }
  g.userData = { eyes, smile, mouthO, xEyes: makeXEyes(g, 0x1d1f24, -0.12) };
  return g;
}

function makeXEyes(g, color, z) {
  const xs = new THREE.Group();
  for (const sx of [-1, 1]) for (const r of [0.785, -0.785]) {
    const bar = box(0.035, 0.008, 0.008, color, sx * 0.045, 0.012, z); bar.rotation.z = r; xs.add(bar);
  }
  xs.visible = false; g.add(xs);
  return xs;
}

// Robot head for bots: rounded metal shell with a screen face and glowing team-colored eyes.
function makeBotHead(team, g) {
  const shell = sph(0.135, 0xcfd5dc, 0, 0.02, 0, 16, 12); shell.scale.set(1.05, 0.95, 1); g.add(shell);
  const screen = sph(0.11, 0x1b2230, 0, 0.015, -0.035, 16, 12); screen.scale.set(1, 0.72, 0.85); g.add(screen);
  const glow = new THREE.MeshBasicMaterial({ color: team });
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.025, 4, 8), glow);
    eye.position.set(sx * 0.04, 0.02, -0.124); g.add(eye); eyes.push(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 4, 10, Math.PI), glow);
  smile.position.set(0, -0.025, -0.122); smile.rotation.z = Math.PI; g.add(smile);
  const mouthO = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.005, 4, 12), glow);
  mouthO.position.set(0, -0.03, -0.124); mouthO.visible = false; g.add(mouthO);
  for (const sx of [-1, 1]) g.add(cyl(0.03, 0.03, 0.03, team, sx * 0.14, 0.02, 0, 10).rotateZ(Math.PI / 2));
  const antenna = new THREE.Group(); antenna.position.set(0, 0.12, 0);
  antenna.add(cyl(0.006, 0.006, 0.09, METAL, 0, 0.045, 0, 6));
  antenna.add(sph(0.018, team, 0, 0.1, 0));
  g.add(antenna);
  const xs = new THREE.Group();
  for (const sx of [-1, 1]) for (const r of [0.785, -0.785]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.008), glow); bar.position.set(sx * 0.04, 0.02, -0.126); bar.rotation.z = r; xs.add(bar);
  }
  xs.visible = false; g.add(xs);
  g.userData = { eyes, smile, mouthO, xEyes: xs, antenna };
  return g;
}

// Floating upper body (no arms), top at y=0: team shirt with shoulders, an open
// paintball vest with pouches, collar, chest emblem, and a belt with holster pouches.
export function makeTorso(team, look) {
  const g = new THREE.Group();
  const profile = [[0, -0.5], [0.12, -0.49], [0.145, -0.43], [0.152, -0.32], [0.165, -0.18], [0.195, -0.08], [0.205, -0.035], [0.18, -0.002], [0.1, 0.022], [0, 0.028]];
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const shirt = mesh(new THREE.LatheGeometry(pts, 20), team);
  shirt.scale.set(1, 1, 0.68);
  g.add(shirt);
  // vest: same profile slightly larger, open at the front
  const vestPts = profile.filter(([, y]) => y >= -0.42 && y <= -0.05).map(([r, y]) => new THREE.Vector2(r + 0.012, y));
  const vest = mesh(new THREE.LatheGeometry(vestPts, 18, Math.PI + 0.55, Math.PI * 2 - 1.1), look.bot ? 0x59606b : 0x3c4148, 0, 0, 0, { side: THREE.DoubleSide });
  vest.scale.set(1, 1, 0.68);
  g.add(vest);
  for (const sx of [-1, 1]) {
    g.add(box(0.05, 0.06, 0.03, 0x2c3036, sx * 0.1, -0.27, -0.11));     // vest pouches
    g.add(box(0.05, 0.012, 0.032, team, sx * 0.1, -0.243, -0.112));
    const pad = mesh(new THREE.SphereGeometry(0.06, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), team, sx * 0.165, -0.04, 0);
    pad.scale.set(0.9, 0.45, 1.05); g.add(pad);                            // shoulder caps
  }
  const collar = mesh(new THREE.TorusGeometry(0.075, 0.017, 6, 16), look.bot ? 0x9aa3ad : 0xf4f4f4, 0, 0.008, 0);
  collar.rotation.x = Math.PI / 2; collar.scale.y = 0.75; g.add(collar);
  // chest emblem: flat white paint splat
  const splat = sph(0.03, 0xffffff, 0, -0.15, -0.128, 12, 10); splat.scale.set(1.15, 0.95, 0.25); g.add(splat);
  for (const [dx, dy, r] of [[0.038, 0.012, 0.009], [-0.034, -0.02, 0.008], [0.012, -0.045, 0.007], [-0.02, 0.03, 0.006]]) {
    const d = sph(r, 0xffffff, dx, -0.15 + dy, -0.124, 8, 6); d.scale.z = 0.3; g.add(d);
  }
  const belt = mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 20), 0x3a2a1e, 0, -0.44, 0); belt.rotation.x = Math.PI / 2; belt.scale.y = 0.7; g.add(belt);
  g.add(box(0.035, 0.03, 0.025, 0xd8b04a, 0, -0.44, -0.105));
  for (const sx of [-1, 1]) g.add(box(0.05, 0.075, 0.045, 0x2f3238, sx * 0.145, -0.46, -0.02));
  return g;
}

// Cartoon right hand (mirror with scale.x = -1 for the left): palm, thumb and four
// two-joint fingers that curl around a weapon grip at the origin. poseHand() drives it.
export function makeHand(team, skin = SKINS[0], glove = false) {
  const g = new THREE.Group();
  const color = glove ? 0x30343b : skin;
  const palm = sph(0.04, color, 0.026, -0.045, 0.028, 12, 10); palm.scale.set(0.5, 1.05, 0.95); g.add(palm);
  const back = sph(0.04, color, 0.034, -0.045, 0.03, 12, 10); back.scale.set(0.45, 1.0, 0.9); g.add(back);
  const fingers = [];
  const seg = (len, r) => { const m = mesh(new THREE.CapsuleGeometry(r, len, 3, 8), color); m.rotation.x = Math.PI / 2; m.position.z = -len / 2; return m; };
  [-0.012, -0.034, -0.056, -0.076].forEach((y, i) => {
    const r = i === 3 ? 0.0085 : 0.0105, l1 = i === 3 ? 0.018 : 0.024, l2 = i === 3 ? 0.016 : 0.022;
    const knuckle = new THREE.Group(); knuckle.position.set(0.026, y, -0.008);
    knuckle.add(seg(l1, r));
    const joint = new THREE.Group(); joint.position.z = -(l1 + r);
    joint.add(seg(l2, r * 0.95));
    knuckle.add(joint);
    g.add(knuckle);
    fingers.push({ knuckle, joint });
  });
  const thumbBase = new THREE.Group(); thumbBase.position.set(0.02, -0.01, 0.025);
  const thumb = mesh(new THREE.CapsuleGeometry(0.011, 0.03, 3, 8), color); thumb.rotation.x = Math.PI / 2; thumb.position.z = -0.018;
  thumbBase.add(thumb); g.add(thumbBase);
  // cuff in team color
  g.add(cyl(0.034, 0.03, 0.03, team, 0.028, -0.045, 0.075, 12).rotateX(Math.PI / 2));
  g.userData = { fingers, thumbBase, curl: 0.3, trig: 0.3 };
  poseHand(g, 0.3, 0.3);
  return g;
}

// grip / trigger in [0,1]: 0 = open hand, 1 = fist around the grip.
export function poseHand(hand, grip, trigger) {
  const u = hand.userData;
  u.fingers.forEach((f, i) => {
    const c = i === 0 ? trigger : grip;
    f.knuckle.rotation.y = 0.15 + c * 1.35;
    f.joint.rotation.y = 0.1 + c * 1.45;
  });
  u.thumbBase.rotation.set(-0.2 - grip * 0.3, 0.5 + grip * 0.7, 0);
}

export const makeMitt = makeHand;

export function makeNameSprite(text, teamColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.roundRect(8, 10, 240, 44, 22); ctx.fill();
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + teamColor.toString(16).padStart(6, '0');
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(0.5, 0.125, 1);
  return sprite;
}
