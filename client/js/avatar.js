// Remote player avatar with procedural animation:
// walk bob + lean, lagging torso turn, breathing, blinking, finger curl on held
// weapons, recoil, hit reaction (X eyes), elimination pop and spawn pop-in.
import * as THREE from 'three';
import { TEAM_COLORS, W } from '/shared/constants.js';
import { makeHead, makeTorso, makeHand, poseHand, makeWeapon, makeNameSprite, lookFor } from './models.js';

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const GUNS = new Set([W.PISTOL, W.SHOTGUN]);
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

export class Avatar {
  constructor(scene, info) {
    this.scene = scene;
    this.id = info.id;
    this.team = info.team;
    this.bot = !!info.bot;
    this.color = TEAM_COLORS[info.team];
    this.root = new THREE.Group();
    const look = lookFor(info.name, info.bot);
    this.head = makeHead(this.color, look);
    this.headPivot = new THREE.Group();     // network pose; head mesh gets animation offsets inside
    this.headPivot.add(this.head);
    this.torso = makeTorso(this.color, look);
    this.torsoPivot = new THREE.Group();
    this.torsoPivot.add(this.torso);
    const skin = look.bot ? 0xcfd5dc : look.skin;
    this.hands = [0, 1].map((i) => {
      const pivot = new THREE.Group();
      const hand = makeHand(this.color, skin);
      if (i === 0) hand.scale.x = -1;       // model is a right hand
      const slot = new THREE.Group();       // weapon + recoil live here
      pivot.add(hand, slot);
      return { pivot, hand, slot, weapon: W.NONE, obj: null, curl: 0.3, recoil: 0 };
    });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.label = makeNameSprite(info.name + (info.bot ? ' 🤖' : ''), this.color);
    this.root.add(this.headPivot, this.torsoPivot, ...this.hands.map((h) => h.pivot), this.label, this.blob);
    scene.add(this.root);

    this.alive = true;
    this.protected = false;
    this.headPos = new THREE.Vector3();
    this.prevHead = null;
    this.vel = new THREE.Vector3();
    this.feetY = 0;
    this.yaw = 0;
    this.torsoYaw = null;
    this.phase = Math.random() * 10;
    this.time = Math.random() * 10;
    this.nextBlink = 1 + Math.random() * 3;
    this.blinkT = -1;
    this.exprT = 0;           // seconds of "surprised" face left
    this.deathT = -1;         // >= 0 while playing the elimination pop
    this.spawnT = -1;         // >= 0 while popping in
    this.lean = { x: 0, z: 0 };
  }

  // arr layout from the snapshot after id: alive, prot, feet(3), head(3), hq(4), lh(7), rh(7), lw, rw
  apply(a) {
    const alive = a[1] === 1;
    if (alive !== this.alive) {
      this.alive = alive;
      if (alive) { this.deathT = -1; this.spawnT = 0; this.root.visible = true; this.prevHead = null; this.setFace('normal'); this.onSpawn?.(this.headPos); }
      else if (this.deathT < 0) this.root.visible = false; // died without an elim event
    }
    const prot = a[2] === 1;
    if (prot !== this.protected) { this.protected = prot; this.setGhost(prot); }
    if (!alive) return;
    this.feetY = a[4];
    this.headPos.set(a[6], a[7], a[8]);
    this.headPivot.position.copy(this.headPos);
    this.headPivot.quaternion.set(a[9], a[10], a[11], a[12]);
    tmpE.setFromQuaternion(this.headPivot.quaternion);
    this.yaw = tmpE.y;
    this.setHand(0, a.slice(13, 20), a[27]);
    this.setHand(1, a.slice(20, 27), a[28]);
  }

  setHand(i, pose, weapon) {
    const h = this.hands[i];
    h.pivot.position.set(pose[0], pose[1], pose[2]);
    h.pivot.quaternion.set(pose[3], pose[4], pose[5], pose[6]);
    if (weapon !== h.weapon) {
      if (h.obj) h.slot.remove(h.obj);
      h.obj = makeWeapon(weapon, this.color);
      if (h.obj) { h.obj.traverse((o) => { o.castShadow = true; }); h.slot.add(h.obj); }
      h.weapon = weapon;
      if (this.protected) this.setGhost(true);
    }
  }

  // ---- events -------------------------------------------------------------------------
  onShoot(w) {
    const h = this.hands.find((x) => x.weapon === w) || this.hands.find((x) => GUNS.has(x.weapon));
    if (h) h.recoil = w === W.SHOTGUN ? 1.6 : 1;
  }

  onHit() {
    this.setFace('out');
    this.deathT = 0;
  }

  setFace(kind) {
    const u = this.head.userData;
    if (!u.eyes) return;
    const out = kind === 'out', wow = kind === 'wow';
    u.eyes.forEach((e) => { e.visible = !out; });
    u.xEyes.visible = out;
    u.smile.visible = !out && !wow;
    u.mouthO.visible = out || wow;
  }

  // ---- per-frame animation ------------------------------------------------------------------
  animate(dt) {
    if (!this.root.visible) return;
    this.time += dt;
    const t = this.time;

    // velocity from network motion (horizontal), smoothed
    if (this.prevHead && dt > 0) {
      const vx = (this.headPos.x - this.prevHead.x) / dt, vz = (this.headPos.z - this.prevHead.z) / dt;
      this.vel.x = damp(this.vel.x, Math.abs(vx) < 12 ? vx : 0, 8, dt);
      this.vel.z = damp(this.vel.z, Math.abs(vz) < 12 ? vz : 0, 8, dt);
    }
    this.prevHead = (this.prevHead || new THREE.Vector3()).copy(this.headPos);
    const speed = Math.hypot(this.vel.x, this.vel.z), moving = Math.min(1, speed / 3);
    const prevStep = Math.floor(this.phase / Math.PI);
    this.phase += dt * (4 + speed * 2.2) * (moving > 0.05 ? 1 : 0);
    if (moving > 0.3 && Math.floor(this.phase / Math.PI) !== prevStep && this.headPos.y - this.feetY > 1.2) this.onStep?.(this.headPos);

    // torso follows head yaw with a lag, never more than ~35 degrees behind
    if (this.torsoYaw === null) this.torsoYaw = this.yaw;
    this.torsoYaw += angleDiff(this.torsoYaw, this.yaw) * (1 - Math.exp(-5 * dt));
    const lag = angleDiff(this.yaw, this.torsoYaw);
    if (Math.abs(lag) > 0.6) this.torsoYaw = this.yaw + Math.sign(lag) * 0.6;

    // lean into the movement direction (in torso space)
    const s = Math.sin(this.torsoYaw), c = Math.cos(this.torsoYaw);
    const fwd = -(this.vel.x * s + this.vel.z * c), side = this.vel.x * c - this.vel.z * s;
    this.lean.x = damp(this.lean.x, -fwd * 0.045, 6, dt);
    this.lean.z = damp(this.lean.z, -side * 0.045, 6, dt);

    const bob = -Math.abs(Math.sin(this.phase)) * 0.03 * moving;
    const breath = Math.sin(t * 2.1) * 0.006;
    this.torsoPivot.position.set(this.headPos.x, this.headPos.y - 0.18 + bob + breath * 0.5, this.headPos.z);
    this.torsoPivot.rotation.set(this.lean.x, this.torsoYaw, this.lean.z + Math.sin(this.phase) * 0.06 * moving, 'YXZ');
    this.torso.scale.set(1 + breath * 0.6, 1 + breath, 1 + breath * 0.6);

    // head: small bob and tilt; bots wobble their antenna
    this.head.position.y = bob * 0.6 + breath * 0.3;
    this.head.rotation.z = Math.sin(this.phase * 0.5) * 0.04 * moving;
    if (this.head.userData.antenna) this.head.userData.antenna.rotation.set(-this.lean.x * 3 + Math.sin(t * 7) * 0.05 * moving, 0, Math.sin(t * 3) * 0.12);

    // blinking
    const eyes = this.head.userData.eyes || [];
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blinkT = 0; this.nextBlink = 2 + Math.random() * 3.5; }
    let eyeY = 1;
    if (this.blinkT >= 0) { this.blinkT += dt; eyeY = this.blinkT < 0.13 ? 0.12 : 1; if (this.blinkT > 0.13) this.blinkT = -1; }
    for (const e of eyes) e.scale.y = eyeY;
    if (this.exprT > 0) { this.exprT -= dt; if (this.exprT <= 0 && this.deathT < 0) this.setFace('normal'); }

    // hands: finger curl, recoil, idle sway for bots (humans' hands are tracked)
    this.hands.forEach((h, i) => {
      const target = h.weapon === W.NONE ? 0.25 : h.weapon === W.SHIELD ? 0.9 : 1;
      h.curl = damp(h.curl, target, 12, dt);
      poseHand(h.hand, h.curl, GUNS.has(h.weapon) ? 0.45 : h.curl);
      h.recoil = damp(h.recoil, 0, 14, dt);
      h.slot.position.set(0, h.recoil * 0.01, h.recoil * 0.035);
      h.slot.rotation.x = h.recoil * 0.3;
      h.hand.position.copy(h.slot.position);
      h.hand.rotation.x = h.slot.rotation.x;
      if (this.bot) {
        h.pivot.position.y += Math.sin(t * 2 + i * 1.7) * 0.008 + bob * 0.7;
        h.pivot.position.x += Math.sin(this.phase + i * Math.PI) * 0.015 * moving;
      }
    });

    this.label.position.set(this.headPos.x, this.headPos.y + 0.33 + Math.sin(t * 1.5) * 0.008, this.headPos.z);
    this.blob.position.set(this.headPos.x, this.feetY + 0.02, this.headPos.z);
    this.blob.scale.setScalar(1 - Math.min(0.4, (this.headPos.y - this.feetY - 1.5) * 0.3));

    // spawn pop-in: quick overshoot scale
    let scale = 1, spin = 0, rise = 0;
    if (this.spawnT >= 0) {
      this.spawnT += dt;
      const k = Math.min(1, this.spawnT / 0.35);
      scale = k < 1 ? 1 - Math.pow(1 - k, 3) * Math.cos(k * 9) : 1;
      if (k >= 1) this.spawnT = -1;
    }
    // elimination: stagger, then spin, rise and pop away
    if (this.deathT >= 0) {
      this.deathT += dt;
      const d = this.deathT;
      if (d < 0.3) { scale = 1 + Math.sin(d * 40) * 0.04; spin = Math.sin(d * 30) * 0.15; }
      else { const k = Math.min(1, (d - 0.3) / 0.45); scale = 1 - k * k; spin = k * 4; rise = k * 0.4; }
      if (d > 0.75) { this.root.visible = false; this.deathT = -1; }
    }
    this.applyRootFx(scale, spin, rise);
  }

  // scale/spin the whole avatar around its body center
  applyRootFx(scale, spin, rise) {
    const cx = this.headPos.x, cy = this.headPos.y - 0.4, cz = this.headPos.z;
    if (scale === 1 && spin === 0 && rise === 0) {
      this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.setScalar(1);
      return;
    }
    this.root.scale.setScalar(Math.max(0.001, scale));
    this.root.rotation.set(0, spin, 0);
    // keep the body center fixed while scaling/rotating about the world origin
    const p = new THREE.Vector3(cx, cy, cz).applyEuler(this.root.rotation).multiplyScalar(scale);
    this.root.position.set(cx - p.x, cy - p.y + rise, cz - p.z);
  }

  setGhost(on) {
    this.root.traverse((o) => {
      if (!o.isMesh || o === this.blob) return;
      if (on) {
        if (!o.userData.origMat) o.userData.origMat = o.material;
        o.material = o.userData.origMat.clone();
        o.material.transparent = true;
        o.material.opacity = 0.35;
      } else if (o.userData.origMat) {
        o.material.dispose();
        o.material = o.userData.origMat;
        delete o.userData.origMat;
      }
    });
  }

  // rough body test used only to stop visual paintballs at avatars
  contains(p) {
    if (!this.alive || !this.root.visible) return false;
    const dx = p[0] - this.headPos.x, dz = p[2] - this.headPos.z;
    if (dx * dx + dz * dz > 0.09) return false;
    return p[1] > this.feetY + 0.3 && p[1] < this.headPos.y + 0.2;
  }

  dispose() { this.scene.remove(this.root); }
}
