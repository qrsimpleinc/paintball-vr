// The local player: movement, two-hand weapon inventory (grab / drop / throw items
// from the map), Quest Touch controls, desktop mouse+keyboard controls, firing, pose sync.
// What each hand holds is decided by the server; grabs and drops are shown optimistically.
import * as THREE from 'three';
import {
  W, WEAPONS, TEAM_COLORS, EYE_HEIGHT, PLAYER_RADIUS, WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED, CROUCH_DROP, JUMP_SPEED, SEND_RATE, ITEM_RULES,
} from '/shared/constants.js';
import { resolveCollisions, groundHeight, raycastWorld, inBush } from '/shared/physics.js';
import { makeWeapon, makeHand, poseHand, lookFor } from './models.js';
import { sound } from './audio.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), e1 = new THREE.Euler(0, 0, 0, 'YXZ');
const LEFT = 0, RIGHT = 1;
const SNAP_ANGLE = Math.PI / 6;
const GUNS = new Set([W.PISTOL, W.SHOTGUN, W.BURST, W.SNIPER, W.LAUNCHER, W.SPRAYER]);
const PENDING_MS = 700;
export const SHORT = {
  [W.PISTOL]: 'Pistol', [W.SHOTGUN]: 'Shotgun', [W.GRENADE]: 'Grenade', [W.SHIELD]: 'Shield', [W.BURST]: 'Burst Rifle',
  [W.SNIPER]: 'Scope Rifle', [W.LAUNCHER]: 'Launcher', [W.SPRAYER]: 'Sprayer', [W.MINE]: 'Mine', [W.MALLET]: 'Mallet',
  [W.FLAG0]: 'Orange Flag', [W.FLAG1]: 'Cyan Flag',
};

export class LocalPlayer {
  constructor({ renderer, scene, camera, map, net, world, hud, items, avatars }) {
    Object.assign(this, { renderer, scene, camera, map, net, world, hud, items, avatars });
    this.rig = new THREE.Group();
    this.view = new THREE.Group();   // camera + controllers; lowered when crouching
    this.rig.add(this.view);
    this.view.add(camera);
    scene.add(this.rig);
    this.crouching = false; this.crouchToggle = false; this.crouchAmt = 0;
    camera.position.set(0, EYE_HEIGHT, 0);

    this.team = 0;
    this.alive = false;
    this.spectator = false;
    this.yaw = 0; this.pitch = 0;
    this.vy = 0; this.onGround = true;
    this.sendAcc = 0;
    this.snapReady = true;
    this.matchPlaying = true;
    this.gripMode = 'toggle';   // 'hold' = keep Grip pressed to hold, 'toggle' = press to grab, press again to drop
    this.myId = 0;

    // hands: holder groups that live under the camera (desktop) or a controller (VR)
    this.hands = [0, 1].map((i) => ({
      i, holder: new THREE.Group(), mitt: null, weapon: W.NONE, weaponObj: null, itemId: 0,
      ammo: 0, reloadUntil: 0, lastFire: 0, pendingUntil: 0, heldByGrip: false,
      ctrl: null, source: null, prev: { trigger: false, grip: false, a: false, b: false, stick: false },
      hist: [],
    }));
    this.desktopHands();

    // XR controllers
    this.controllers = [0, 1].map((i) => {
      const c = renderer.xr.getController(i);
      c.addEventListener('connected', (e) => this.onControllerConnected(c, e.data));
      c.addEventListener('disconnected', () => this.onControllerDisconnected(c));
      this.view.add(c);
      return c;
    });

    // paint-on-visor overlay when eliminated
    this.visor = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42),
      new THREE.MeshBasicMaterial({ map: world.splatTexture, color: 0xffffff, transparent: true, opacity: 0, depthTest: false }));
    this.visor.position.z = -0.15;
    this.visor.renderOrder = 998;
    camera.add(this.visor);

    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.bindDesktopInput();
  }

  get inVR() { return this.renderer.xr.isPresenting; }

  // ---- setup ------------------------------------------------------------------
  setTeam(team) {
    this.team = team;
    this.items.myTeam = team;
    this.color = TEAM_COLORS[team];
    for (const h of this.hands) {
      if (h.mitt) h.holder.remove(h.mitt);
      h.mitt = makeHand(this.color, lookFor(this.name || 'me').skin);
      if (h.i === LEFT) h.mitt.scale.x = -1;
      h.mitt.visible = this.inVR;
      h.holder.add(h.mitt);
      const w = h.weapon; h.weapon = -1; this.equip(h, w);
    }
  }

  desktopHands() {
    for (const h of this.hands) this.camera.add(h.holder);
    this.hands[LEFT].holder.position.set(-0.24, -0.26, -0.42);
    this.hands[RIGHT].holder.position.set(0.2, -0.2, -0.4);
    for (const h of this.hands) { h.holder.quaternion.identity(); if (h.mitt) h.mitt.visible = false; }
  }

  onControllerConnected(c, source) {
    const i = source.handedness === 'left' ? LEFT : RIGHT;
    const h = this.hands[i];
    h.ctrl = c; h.source = source;
    c.add(h.holder);
    h.holder.position.set(0, 0, 0);
    h.holder.quaternion.identity();
    if (h.mitt) h.mitt.visible = true;
  }

  onControllerDisconnected(c) {
    for (const h of this.hands) if (h.ctrl === c) { h.ctrl = null; h.source = null; }
  }

  onSessionStart() {
    for (const h of this.hands) { if (h.mitt) h.mitt.visible = true; h.heldByGrip = false; }
    this.camera.position.set(0, 0, 0);
    this.rig.rotation.set(0, this.yaw, 0);
    this.hud.attachVR(this.camera, this.hands[LEFT].holder);
  }

  onSessionEnd() {
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.camera.rotation.set(this.pitch, 0, 0);
    this.desktopHands();
  }

  equip(h, w) {
    if (h.weapon === w) return;
    if (h.weaponObj) h.holder.remove(h.weaponObj);
    h.weapon = w;
    h.weaponObj = makeWeapon(w, this.color ?? 0xffffff);
    // on desktop the flag leans forward to the side, so it stays in view without blocking it
    if (h.weaponObj?.userData.flag && !this.inVR) { h.weaponObj.rotation.set(-0.75, 0, h.i === LEFT ? 0.35 : -0.35); h.weaponObj.position.y = -0.2; }
    if (h.weaponObj) h.holder.add(h.weaponObj);
  }

  // Server truth for what each hand holds. rows: [id, w, x, y, z, state, holder, hand, rest]
  syncItems(rows) {
    const mine = [null, null];
    for (const r of rows) if (r[5] === 1 && r[6] === this.myId && (r[7] === 0 || r[7] === 1)) mine[r[7]] = { id: r[0], w: r[1], lit: r[9] === 1 };
    const now = performance.now();
    for (const h of this.hands) {
      const held = mine[h.i], lit = !!held?.lit && held.id === h.itemId;
      if (lit && !h.lit) { sound.beep(true); this.pulse(h, 0.8, 90); }
      h.lit = lit;
      const spark = h.weaponObj?.userData.spark;
      if (spark) spark.visible = lit && now % 240 < 130;
      if (now < h.pendingUntil) continue;
      const s = mine[h.i];
      const id = s ? s.id : 0;
      if (id !== h.itemId) this.setHandItem(h, id, s ? s.w : W.NONE);
    }
  }

  setHandItem(h, id, w) {
    h.itemId = id;
    this.equip(h, w);
    if (GUNS.has(w)) { h.ammo = WEAPONS[w].ammo; h.reloadUntil = 0; }
    if (!id) h.heldByGrip = false;
  }

  // ---- inventory actions -----------------------------------------------------------
  grab(h, item) {
    if (!item || h.itemId) return;
    this.net.send({ type: 'grab', hand: h.i, id: item.id });
    this.items.hideTemp(item.id);
    this.setHandItem(h, item.id, item.w);
    h.pendingUntil = performance.now() + PENDING_MS;
    this.pulse(h, 0.4, 40);
    sound.grab();
    if (item.w === W.GRENADE && !this.grenadeTip && this.inVR) {
      this.grenadeTip = true;
      this.hud.message('Let go and grab it again quickly to light it', 3);
    }
  }

  // Enemy grenade in flight or rolling, within maxD of a point. Launcher bombs can't be caught.
  liveGrenadeNear(p, maxD) {
    let best = null, bestD = maxD;
    for (const [id, x, y, z, team, impact] of this.liveGrenades || []) {
      if (team === this.team || impact) continue;
      const d = Math.hypot(x - p.x, y - p.y, z - p.z);
      if (d < bestD) { bestD = d; best = { id, x, y, z }; }
    }
    return best;
  }

  catchGrenade(h, g) {
    this.net.send({ type: 'catch', hand: h.i, id: g.id });
    this.pulse(h, 0.6, 50);
  }

  // Let go of whatever the hand holds: grenades thrown fast enough explode, anything
  // else is put down (or tossed) and stays where it lands.
  release(h, pos, vel) {
    if (!h.itemId) return;
    if (h.weapon === W.MINE) { this.placeMine(h, pos, this.inVR ? this.vrSurface(h, pos) : null); return; }
    if (h.weapon === W.GRENADE && vel.length() > 1.5) {
      this.net.send({ type: 'throw', hand: h.i, p: pos.toArray(), v: vel.toArray() });
      sound.whoosh(null, true);
      this.pulse(h, 0.6, 60);
    } else {
      this.net.send({ type: 'drop', hand: h.i, p: pos.toArray(), v: vel.toArray() });
      sound.drop();
    }
    // the hand may have moved off the falling grenade: letting go and re-grabbing still lights it
    h.regrab = h.weapon === W.GRENADE && !h.lit ? { id: h.itemId, until: performance.now() + WEAPONS[W.GRENADE].armWindow * 1000 } : null;
    this.setHandItem(h, 0, W.NONE);
    h.pendingUntil = performance.now() + PENDING_MS;
  }

  // Mines stick to the surface the hand is touching / pointing at, else fall to the floor.
  placeMine(h, pos, surface) {
    const p = surface ? surface.p : pos;
    this.net.send({ type: 'place', hand: h.i, p: p.toArray(), n: surface ? surface.n : null });
    sound.minePlace(p.toArray());
    this.setHandItem(h, 0, W.NONE);
    h.pendingUntil = performance.now() + PENDING_MS;
  }

  vrSurface(h, pos) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(h.holder.getWorldQuaternion(q1));
    for (const dir of [fwd, new THREE.Vector3(0, -1, 0)]) {
      const to = pos.clone().addScaledVector(dir, 0.45);
      const hit = raycastWorld(this.map, pos.toArray(), to.toArray());
      if (hit) return { p: pos.clone().lerp(to, hit.t), n: hit.n };
    }
    return null;
  }

  desktopSurface(range = 3.5) {
    const from = this.headWorld(new THREE.Vector3());
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const to = from.clone().addScaledVector(dir, range);
    const hit = raycastWorld(this.map, from.toArray(), to.toArray());
    if (hit) return { p: from.clone().lerp(to, hit.t), n: hit.n };
    return null;
  }

  // Foam mallet: report a hit on an enemy avatar; the server checks the reach.
  tryMelee(h, target) {
    const now = performance.now() / 1000;
    if (!target || now - h.lastFire < WEAPONS[W.MALLET].cooldown) return;
    h.lastFire = now;
    this.net.send({ type: 'melee', hand: h.i, target: target.id });
    this.pulse(h, 1, 90);
  }

  desktopSwing(h) {
    const now = performance.now() / 1000;
    if (now - h.lastFire < WEAPONS[W.MALLET].cooldown) return;
    h.swingT = 0;
    sound.whoosh(null, true);
    const head = this.headWorld(new THREE.Vector3()), dir = this.camera.getWorldDirection(new THREE.Vector3());
    let best = null, bestD = WEAPONS[W.MALLET].reach - 0.2;
    for (const av of this.avatars.values()) {
      if (av.team === this.team || !av.alive || av.protected) continue;
      const to = av.headPos.clone().sub(head), d = to.length();
      if (d < bestD && to.normalize().dot(dir) > 0.55) { bestD = d; best = av; }
    }
    if (best) this.tryMelee(h, best); else h.lastFire = now;
  }

  swapHands() {
    const [L, R] = this.hands;
    this.net.send({ type: 'swap' });
    const li = L.itemId, lw = L.weapon, la = L.ammo, ri = R.itemId, rw = R.weapon, ra = R.ammo;
    L.itemId = ri; this.equip(L, rw); L.ammo = ra;
    R.itemId = li; this.equip(R, lw); R.ammo = la;
    L.pendingUntil = R.pendingUntil = performance.now() + PENDING_MS;
  }

  // ---- desktop input ------------------------------------------------------------
  bindDesktopInput() {
    const canvas = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.keys.add(e.code);
      if (!this.alive || this.inVR || e.repeat) return;
      const [L, R] = this.hands;
      if (e.code === 'KeyE') this.desktopPickup();
      if (e.code === 'KeyQ') this.desktopDrop(R);
      if (e.code === 'KeyV') this.desktopDrop(L);
      if (e.code === 'KeyX') this.swapHands();
      if (e.code === 'KeyR') { this.reload(R); this.reload(L); }
      if (e.code === 'KeyZ') this.zoom = true;
      if (e.code === 'KeyG') {
        const h = R.weapon === W.GRENADE ? R : L.weapon === W.GRENADE ? L : null;
        if (h) this.desktopThrow(h);
      }
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'KeyZ') this.zoom = false; });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.()?.catch?.(() => {}); return; }
      if (this.inVR || !this.alive) return;
      if (e.button === 0) { this.mouse.left = true; this.useDesktop(this.hands[RIGHT], true); }
      if (e.button === 2) { this.mouse.right = true; this.useDesktop(this.hands[LEFT], true); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas || this.inVR) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
  }

  // click = use the item in that hand: fire a gun, throw a grenade (shield is held up instead)
  useDesktop(h, click) {
    if (GUNS.has(h.weapon)) this.fire(h, !click);
    else if (h.weapon === W.GRENADE && click) this.desktopThrow(h);
    else if (h.weapon === W.MINE && click) {
      const s = this.desktopSurface();
      const fallback = this.headWorld(new THREE.Vector3()).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize(), 1);
      this.placeMine(h, s ? s.p : fallback, s);
    } else if (h.weapon === W.MALLET && click) this.desktopSwing(h);
  }

  // First press lights the grenade, the second throws it.
  desktopThrow(h) {
    if (!this.matchPlaying) return;
    if (!h.lit) { this.net.send({ type: 'arm', hand: h.i }); return; }
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const p = this.headWorld(new THREE.Vector3()).addScaledVector(dir, 0.4);
    this.release(h, p, dir.multiplyScalar(11).add(new THREE.Vector3(0, 3, 0)));
  }

  desktopDrop(h) {
    if (!h.itemId) return;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const p = this.headWorld(new THREE.Vector3()).addScaledVector(dir, 0.5);
    p.y -= 0.3;
    const v = dir.setY(0).normalize().multiplyScalar(1.5);
    if (h.weapon === W.GRENADE) { // dropping a grenade gently never throws it
      this.net.send({ type: 'drop', hand: h.i, p: p.toArray(), v: v.toArray() });
      sound.drop();
      this.setHandItem(h, 0, W.NONE);
      h.pendingUntil = performance.now() + PENDING_MS;
    } else this.release(h, p, v);
  }

  desktopTarget() {
    const feet = new THREE.Vector3(this.rig.position.x, this.rig.position.y, this.rig.position.z);
    return this.items.pickTarget(feet, this.camera.getWorldDirection(new THREE.Vector3()), ITEM_RULES.grabRange - 0.2);
  }

  desktopCatchTarget() {
    const head = this.headWorld(new THREE.Vector3());
    const g = this.liveGrenadeNear(head, WEAPONS[W.GRENADE].catchRange - 0.3);
    if (!g) return null;
    const to = new THREE.Vector3(g.x, g.y, g.z).sub(head).normalize();
    return to.dot(this.camera.getWorldDirection(new THREE.Vector3())) > 0.5 ? g : null;
  }

  // E: pick up into the right hand if free, else the left; with both full, swap the right one.
  desktopPickup() {
    const [L, R] = this.hands;
    const live = this.desktopCatchTarget();
    if (live) {
      if (R.itemId && L.itemId) this.desktopDrop(R);
      this.catchGrenade(R.itemId ? L : R, live);
      return;
    }
    const target = this.desktopTarget();
    if (!target) return;
    if (!R.itemId) this.grab(R, target);
    else if (!L.itemId) this.grab(L, target);
    else { this.desktopDrop(R); R.pendingUntil = 0; R.itemId = 0; this.grab(R, target); }
  }

  // ---- spawning / elimination ----------------------------------------------------
  teleport(p, yaw) {
    this.rig.updateMatrixWorld(true);
    if (this.inVR) {
      e1.setFromQuaternion(this.camera.quaternion);
      this.rig.rotation.set(0, yaw - e1.y, 0);
      this.rig.updateMatrixWorld(true);
      const head = this.camera.getWorldPosition(v1);
      this.rig.position.x += p[0] - head.x;
      this.rig.position.z += p[2] - head.z;
      this.rig.position.y = p[1];
    } else {
      this.yaw = yaw; this.pitch = 0;
      this.rig.position.set(p[0], p[1], p[2]);
    }
    this.vy = 0;
  }

  onSpawn(msg) {
    this.crouchToggle = false; this.crouchAmt = 0; this.view.position.y = 0;
    this.alive = true;
    this.teleport(msg.p, msg.yaw);
    this.visor.material.opacity = 0;
    for (const h of this.hands) { h.pendingUntil = 0; h.heldByGrip = false; }
    this.hud.message('GO!', 1);
    sound.spawn(null);
  }

  onEliminated(byName, byColor) {
    this.alive = false;
    this.visor.material.color.setHex(byColor);
    this.visor.material.opacity = 0.9;
    this.visor.position.set((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04, -0.15);
    this.visor.rotation.z = Math.random() * Math.PI * 2;
    for (const h of this.hands) { this.pulse(h, 1, 300); this.setHandItem(h, 0, W.NONE); h.pendingUntil = 0; }
    this.outAt = performance.now();
    this.outBy = byName;
  }

  // ---- per frame -----------------------------------------------------------------
  update(dt) {
    const now = performance.now() / 1000;
    if (this.spectator) { this.updateSpectator(dt); return; }

    this.readInput();
    if (this.alive && this.matchPlaying) this.move(dt);
    else if (!this.inVR) { this.rig.rotation.set(0, this.yaw, 0); this.camera.rotation.set(this.pitch, 0, 0); }

    for (const h of this.hands) {
      if (h.reloadUntil && now >= h.reloadUntil && GUNS.has(h.weapon)) { h.reloadUntil = 0; h.ammo = WEAPONS[h.weapon].ammo; }
    }

    if (this.inVR) this.updateVRHands(now);
    else this.updateDesktopHands();

    if (!this.alive && this.visor.material.opacity > 0.35) this.visor.material.opacity -= dt * 0.12;
    if (!this.alive && this.outAt) {
      const left = Math.max(0, 4 - (performance.now() - this.outAt) / 1000);
      this.hud.message(`Splatted by ${this.outBy} — back in ${Math.ceil(left)}`, 0.2);
    }

    // HUD: what each hand holds
    const desc = (h) => {
      if (!h.weapon) return 'empty';
      if (GUNS.has(h.weapon)) return `${SHORT[h.weapon]} ${h.reloadUntil ? 'reloading…' : `${h.ammo}/${WEAPONS[h.weapon].ammo}`}`;
      if (h.weapon === W.GRENADE && h.lit) return 'Grenade LIT, throw it!';
      return SHORT[h.weapon];
    };
    let hint = '';
    if (!this.inVR && this.alive) {
      const t = this.desktopTarget();
      this.items.highlight(t ? t.id : 0);
      if (t) hint = ` · E: take ${SHORT[t.w]}`;
      if (this.desktopCatchTarget()) hint = ' · E: catch the grenade!';
    }
    this.hud.setAmmo(`L: ${desc(this.hands[LEFT])} · R: ${desc(this.hands[RIGHT])}${hint}`);

    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SEND_RATE) { this.sendAcc = 0; this.sendState(); }
  }

  readInput() {
    this.input = { mx: 0, mz: 0, turn: 0, jump: false, sprint: false, crouch: false };
    const inp = this.input;
    if (this.inVR) {
      for (const h of this.hands) {
        const gp = h.source?.gamepad;
        h.state = gp ? {
          trigger: gp.buttons[0]?.value > 0.6,
          grip: gp.buttons[1]?.value > 0.5,
          trigV: gp.buttons[0]?.value || 0, gripV: gp.buttons[1]?.value || 0,
          stick: !!gp.buttons[3]?.pressed,
          a: !!gp.buttons[4]?.pressed,
          b: !!gp.buttons[5]?.pressed,
          sx: gp.axes[2] || 0, sy: gp.axes[3] || 0,
        } : { trigger: false, grip: false, trigV: 0, gripV: 0, stick: false, a: false, b: false, sx: 0, sy: 0 };
      }
      const L = this.hands[LEFT].state, R = this.hands[RIGHT].state;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      inp.mx = dz(L.sx); inp.mz = dz(L.sy);
      if (L.stick && !this.hands[LEFT].prev.stick) { this.sprintToggle = !this.sprintToggle; this.crouchToggle = false; }
      if (!inp.mx && !inp.mz) this.sprintToggle = false;
      // right stick click: crouch on/off (you can also just crouch for real)
      if (R.stick && !this.hands[RIGHT].prev.stick) { this.crouchToggle = !this.crouchToggle; if (this.crouchToggle) this.sprintToggle = false; }
      inp.sprint = this.sprintToggle;
      inp.jump = (L.a && !this.hands[LEFT].prev.a) || (R.a && !this.hands[RIGHT].prev.a);
      if (inp.jump && this.crouchToggle) { this.crouchToggle = false; inp.jump = false; }   // jump stands you up first
      inp.crouch = this.crouchToggle;
      if (Math.abs(R.sx) > 0.7) { if (this.snapReady) { inp.turn = -Math.sign(R.sx); this.snapReady = false; } }
      else if (Math.abs(R.sx) < 0.3) this.snapReady = true;
    } else {
      const k = this.keys;
      inp.mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      inp.mz = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
      inp.jump = k.has('Space');
      inp.crouch = k.has('KeyC');
      inp.sprint = !inp.crouch && (k.has('ShiftLeft') || k.has('ShiftRight'));
    }
  }

  move(dt) {
    const inp = this.input;
    let fwdYaw;
    if (this.inVR) {
      if (inp.turn) this.snapTurn(inp.turn * SNAP_ANGLE);
      this.camera.getWorldQuaternion(q1);
      e1.setFromQuaternion(q1);
      fwdYaw = e1.y;
    } else {
      this.rig.rotation.set(0, this.yaw, 0);
      this.camera.rotation.set(this.pitch, 0, 0);
      fwdYaw = this.yaw;
    }
    // crouch: eyes go down smoothly, slower and silent steps, smaller target
    this.crouching = inp.crouch && this.alive;
    this.crouchAmt += ((this.crouching ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 12);
    this.view.position.y = -CROUCH_DROP * this.crouchAmt;
    const speed = this.crouching ? CROUCH_SPEED : inp.sprint ? SPRINT_SPEED : WALK_SPEED;
    let mx = inp.mx, mz = inp.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const s = Math.sin(fwdYaw), c = Math.cos(fwdYaw);
    this.rig.position.x += (mx * c + mz * s) * speed * dt;
    this.rig.position.z += (-mx * s + mz * c) * speed * dt;

    // collide using the head position (the player can also walk physically in VR)
    this.rig.updateMatrixWorld(true);
    const head = this.headWorld(v1);
    const p = [head.x, this.rig.position.y, head.z];
    resolveCollisions(this.map, p, PLAYER_RADIUS);
    this.rig.position.x += p[0] - head.x;
    this.rig.position.z += p[2] - head.z;

    const ground = groundHeight(this.map, p[0], p[2], this.rig.position.y, PLAYER_RADIUS);
    if (inp.jump && this.onGround && !this.crouching) { this.vy = JUMP_SPEED; this.onGround = false; sound.whoosh(null, true); }
    this.vy -= 9.8 * dt;
    this.rig.position.y += this.vy * dt;
    const wasOnGround = this.onGround, fallSpeed = this.vy;
    if (this.rig.position.y <= ground) { this.rig.position.y = ground; this.vy = 0; this.onGround = true; }
    else if (wasOnGround && this.vy <= 0 && this.rig.position.y - ground < 0.3) { this.rig.position.y = ground; this.vy = 0; this.onGround = true; }
    else this.onGround = false;
    if (!wasOnGround && this.onGround && fallSpeed < -2.5) sound.land();
    const moved = Math.hypot(p[0] - (this.lastStepPos?.[0] ?? p[0]), p[2] - (this.lastStepPos?.[1] ?? p[2]));
    this.lastStepPos = [p[0], p[2]];
    if (this.onGround && moved < 1) {
      this.stepDist = (this.stepDist || 0) + moved;
      if (this.stepDist > (inp.sprint ? 0.85 : 0.65)) {
        this.stepDist = 0;
        if (this.crouching) { if (inBush(this.map, [p[0], this.rig.position.y + 0.5, p[2]])) sound.rustle(null, true); }
        else if (inBush(this.map, [p[0], this.rig.position.y + 0.5, p[2]])) sound.rustle(null, true); else sound.footstep(null, true);
      }
    }
  }

  snapTurn(angle) {
    const head = this.headWorld(v2).clone();
    this.rig.rotation.y += angle;
    const off = this.rig.position.clone().sub(head);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.rig.position.copy(head.add(off));
  }

  headWorld(out) {
    this.camera.updateMatrixWorld(true);
    return this.camera.getWorldPosition(out);
  }

  // ---- VR hands ------------------------------------------------------------------
  handVelocity(h) {
    if (h.hist.length < 2) return new THREE.Vector3();
    const a = h.hist[0], b = h.hist[h.hist.length - 1], dt = b.t - a.t;
    return dt > 0 ? b.p.clone().sub(a.p).multiplyScalar(1 / dt) : new THREE.Vector3();
  }

  updateVRHands(now) {
    let hot = 0;
    for (const h of this.hands) {
      const st = h.state;
      if (!st) continue;
      // fingers follow the real controller: grip curls the hand, trigger curls the index
      if (h.mitt) {
        const holding = h.weapon !== W.NONE;
        h.curlG = (h.curlG ?? 0.25) + ((holding ? 1 : Math.max(0.2, st.gripV)) - (h.curlG ?? 0.25)) * 0.5;
        h.curlT = (h.curlT ?? 0.25) + (((holding && h.weapon !== W.SHIELD) ? 0.35 + st.trigV * 0.65 : Math.max(0.2, st.trigV)) - (h.curlT ?? 0.25)) * 0.5;
        poseHand(h.mitt, h.curlG, h.curlT);
      }
      const wp = h.holder.getWorldPosition(new THREE.Vector3());
      h.hist.push({ t: now, p: wp });
      while (h.hist.length && now - h.hist[0].t > 0.1) h.hist.shift();

      const near = !h.itemId ? this.items.nearest(wp, ITEM_RULES.vrGrabRadius) : null;
      if (near) hot = near.id;

      if (this.alive && this.matchPlaying) {
        const pressed = st.grip && !h.prev.grip, released = !st.grip && h.prev.grip;
        if (pressed) {
          if (!h.itemId) {
            const again = h.regrab && performance.now() < h.regrab.until ? { id: h.regrab.id, w: W.GRENADE } : null;
            const live = this.liveGrenadeNear(wp, 0.55);
            if (again || near) { this.grab(h, again || near); h.heldByGrip = true; }
            else if (live) { this.catchGrenade(h, live); h.heldByGrip = true; }
            h.regrab = null;
          }
          else if (this.gripMode === 'toggle') this.release(h, wp, this.handVelocity(h).multiplyScalar(1.4));
          else h.heldByGrip = true; // re-grip something you already had (e.g. the spawn pistol)
        }
        if (released && this.gripMode === 'hold' && h.itemId && h.heldByGrip) {
          this.release(h, wp, this.handVelocity(h).multiplyScalar(1.4));
        }
        if (GUNS.has(h.weapon)) {
          if (st.trigger && !h.prev.trigger) this.fire(h);
          else if (st.trigger && WEAPONS[h.weapon].auto) this.fire(h, true);
        }
        if (h.weapon === W.MALLET) this.vrMallet(h, now);
        if (st.b && !h.prev.b) this.reload(h);
      }
      h.prev = { trigger: st.trigger, grip: st.grip, a: st.a, b: st.b, stick: st.stick };
    }
    this.items.highlight(hot);
  }

  vrMallet(h, now) {
    const head = h.weaponObj.localToWorld(h.weaponObj.userData.hammerHead.clone());
    const prev = h.malletPrev;
    h.malletPrev = { p: head, t: now };
    if (!prev || now - prev.t <= 0) return;
    const speed = head.distanceTo(prev.p) / (now - prev.t);
    if (speed < 2.5) return;
    for (const av of this.avatars.values()) {
      if (av.team === this.team || !av.alive || av.protected) continue;
      const body = av.headPos.clone().setY(av.headPos.y - 0.4);
      if (head.distanceTo(av.headPos) < 0.32 || head.distanceTo(body) < 0.36) { this.tryMelee(h, av); sound.whoosh(null, true); break; }
    }
  }

  // Scope rifle: render a zoomed view into the scope lens (and zoom the desktop camera with Z).
  renderScope(renderer, scene) {
    const h = this.hands.find((x) => x.weapon === W.SNIPER && x.weaponObj?.userData.lens);
    const zoomOn = !this.inVR && this.zoom && !!h;
    const fov = zoomOn ? 22 : 75;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    document.getElementById('scope-overlay').style.display = zoomOn ? 'block' : 'none';
    if (!h || (this.scopeSkip = !this.scopeSkip)) return; // every other frame
    if (!this.scopeRT) {
      this.scopeRT = new THREE.WebGLRenderTarget(256, 256);
      this.scopeCam = new THREE.PerspectiveCamera(9, 1, 0.1, 150);
      this.scopeMat = new THREE.MeshBasicMaterial({ map: this.scopeRT.texture });
    }
    const obj = h.weaponObj;
    if (obj.userData.lens.material !== this.scopeMat) obj.userData.lens.material = this.scopeMat;
    obj.updateMatrixWorld(true);
    this.scopeCam.position.copy(obj.localToWorld(obj.userData.scopeEye.clone()));
    this.scopeCam.quaternion.copy(obj.getWorldQuaternion(q1));
    this.scopeCam.updateMatrixWorld(true);
    const xr = renderer.xr.enabled, auto = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    obj.visible = false;
    renderer.setRenderTarget(this.scopeRT);
    renderer.render(scene, this.scopeCam);
    renderer.setRenderTarget(null);
    obj.visible = true;
    renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = auto;
  }

  // ---- desktop hands ---------------------------------------------------------------
  updateDesktopHands() {
    const [L, R] = this.hands;
    const shieldUp = this.mouse.right && this.alive && L.weapon === W.SHIELD;
    if (L.weapon === W.SHIELD) L.holder.position.set(shieldUp ? -0.28 : -0.32, shieldUp ? -0.16 : -0.34, shieldUp ? -0.6 : -0.45);
    else L.holder.position.set(-0.22, -0.22, -0.42);
    // hold a mouse button for repeated fire (pistol, sprayer)
    const repeat = (w) => w === W.PISTOL || WEAPONS[w]?.auto;
    if (this.alive) {
      if (this.mouse.left && repeat(R.weapon)) this.fire(R, true);
      if (this.mouse.right && repeat(L.weapon)) this.fire(L, true);
    }
    // mallet swing animation
    for (const h of this.hands) {
      if (h.weapon !== W.MALLET || !h.weaponObj) continue;
      if (h.swingT !== undefined && h.swingT < 1) h.swingT = Math.min(1, h.swingT + 1 / 18);
      const k = h.swingT === undefined ? 1 : h.swingT;
      h.weaponObj.rotation.x = k < 1 ? Math.sin(k * Math.PI) * -1.4 + 0.5 : 0.5;
    }
  }

  // ---- shooting ----------------------------------------------------------------------
  reload(h) {
    const w = h.weapon;
    if (!GUNS.has(w) || h.reloadUntil || h.ammo === WEAPONS[w].ammo) return;
    h.reloadUntil = performance.now() / 1000 + WEAPONS[w].reload;
    sound.reload(WEAPONS[w].reload);
  }

  fire(h, quiet = false) {
    const w = h.weapon, spec = WEAPONS[w];
    if (!spec?.speed || !this.matchPlaying || !h.weaponObj) return;
    const now = performance.now() / 1000;
    if (now - h.lastFire < spec.cooldown || h.reloadUntil) return;
    if (h.ammo <= 0) { if (!quiet) { sound.click(); this.reload(h); } return; }
    h.lastFire = now;
    if (spec.burst) {
      for (let i = 0; i < spec.burst; i++) {
        setTimeout(() => { if (h.weapon === w && h.ammo > 0 && this.alive) this.shoot(h); }, i * spec.burstGap * 1000);
      }
      return;
    }
    this.shoot(h);
  }

  shoot(h) {
    const w = h.weapon, spec = WEAPONS[w];
    if (!h.weaponObj) return;
    h.ammo--;

    h.weaponObj.updateMatrixWorld(true);
    const origin = h.weaponObj.localToWorld(h.weaponObj.userData.muzzle.clone());
    let dir;
    if (this.inVR) {
      dir = new THREE.Vector3(0, 0, -1).applyQuaternion(h.weaponObj.getWorldQuaternion(q1));
    } else {
      const cam = this.headWorld(new THREE.Vector3());
      const target = cam.addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), 30);
      dir = target.sub(origin).normalize();
    }
    const pellets = [];
    const spread = Math.tan((spec.spread * Math.PI) / 180);
    for (let k = 0; k < spec.pellets; k++) {
      const d = dir.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread,
      )).normalize();
      pellets.push([origin.x, origin.y, origin.z, d.x, d.y, d.z]);
      if (!spec.lob) this.world.addBall(origin.toArray(), d.multiplyScalar(spec.speed).toArray(), this.team, spec.life);
    }
    this.net.send({ type: 'fire', w, pellets });
    const heavy = w === W.SHOTGUN || w === W.SNIPER || w === W.LAUNCHER;
    this.pulse(h, heavy ? 0.9 : w === W.SPRAYER ? 0.25 : 0.5, heavy ? 80 : 30);
    sound.weapon(w, origin.toArray(), true);
    const obj = h.weaponObj;
    obj.position.z = 0.03;
    setTimeout(() => { obj.position.z = 0; }, 60);
    if (h.ammo === 0) setTimeout(() => this.reload(h), 250);
  }

  pulse(h, intensity, ms) {
    try { h.source?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms); } catch { /* not supported */ }
  }

  // ---- networking ----------------------------------------------------------------------
  sendState() {
    if (this.spectator) return;
    this.rig.updateMatrixWorld(true);
    const head = this.headWorld(new THREE.Vector3());
    const hq = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const pose = (h) => {
      const p = h.holder.getWorldPosition(new THREE.Vector3());
      const q = h.holder.getWorldQuaternion(new THREE.Quaternion());
      return [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
    };
    this.net.send({
      type: 'st',
      p: [head.x, this.rig.position.y, head.z],
      h: [head.x, head.y, head.z, hq.x, hq.y, hq.z, hq.w],
      l: pose(this.hands[LEFT]), r: pose(this.hands[RIGHT]),
      rtt: Math.round(this.net.rtt),
    });
  }

  // ---- spectator ----------------------------------------------------------------------
  initSpectator() {
    this.spectator = true;
    for (const h of this.hands) h.holder.visible = false;
    this.rig.position.set(0, 9, this.map.halfZ + 4);
    this.yaw = 0; this.pitch = -0.55;
  }

  updateSpectator(dt) {
    let mx = 0, mz = 0, my = 0;
    if (this.inVR) {
      const gp = this.hands[LEFT].source?.gamepad, gr = this.hands[RIGHT].source?.gamepad;
      if (gp) { mx = gp.axes[2] || 0; mz = gp.axes[3] || 0; }
      if (gr) my = -(gr.axes[3] || 0);
      this.camera.getWorldQuaternion(q1); e1.setFromQuaternion(q1);
      this.yawFly = e1.y;
    } else {
      const k = this.keys;
      mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      mz = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
      my = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0);
      this.rig.rotation.set(0, this.yaw, 0);
      this.camera.rotation.set(this.pitch, 0, 0);
      this.yawFly = this.yaw;
    }
    const sp = 8 * dt, s = Math.sin(this.yawFly), c = Math.cos(this.yawFly);
    this.rig.position.x += (mx * c + mz * s) * sp;
    this.rig.position.z += (-mx * s + mz * c) * sp;
    this.rig.position.y = Math.max(0.5, this.rig.position.y + my * sp);
  }
}
