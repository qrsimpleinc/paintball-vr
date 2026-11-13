// Weapons lying on the map: hovering, slowly turning, with a ring underneath.
// The ring lights up yellow on the item you can grab right now.
import * as THREE from 'three';
import { makeWeapon } from './models.js';
import { isFlag, flagTeam, TEAM_COLORS } from '/shared/constants.js';

const ITEM_ACCENT = 0xffc83a; // ground weapons use a neutral yellow accent until picked up
const STATE_GROUND = 0;

export class ItemsView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();      // id -> { w, pos, rest, group, model, ring }
    this.hidden = new Map();     // id -> until (ms), optimistic hide after grabbing
    this.highlightId = 0;
    this.myTeam = -1;   // your own flag is never grabbed (you touch it to send it home)
    this.time = 0;
    this.ringGeo = new THREE.RingGeometry(0.2, 0.26, 28);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  clear() {
    for (const it of this.items.values()) { this.scene.remove(it.group, it.ring); it.ring.material.dispose(); }
    this.items.clear(); this.hidden.clear();
  }

  hideTemp(id, ms = 700) { this.hidden.set(id, performance.now() + ms); }
  highlight(id) { this.highlightId = id; }

  // list rows: [id, w, x, y, z, state, holder, hand, rest]
  sync(list) {
    const now = performance.now();
    const seen = new Set();
    for (const [id, w, x, y, z, state, , , rest] of list) {
      if (state !== STATE_GROUND) continue;
      const hideUntil = this.hidden.get(id);
      if (hideUntil && hideUntil > now) continue;
      seen.add(id);
      let it = this.items.get(id);
      if (!it) {
        const group = new THREE.Group();
        const model = makeWeapon(w, ITEM_ACCENT);
        model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const flag = isFlag(w);
        if (flag) model.position.y = 0.36; else model.scale.setScalar(1.25);
        const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
        group.add(model);
        this.scene.add(group, ring);
        it = { w, pos: new THREE.Vector3(x, y, z), group, model, ring, spin: Math.random() * 6, appear: 0, flag };
        this.items.set(id, it);
      }
      it.pos.set(x, y, z);
      it.rest = rest === 1;
    }
    for (const [id, it] of this.items) {
      if (seen.has(id)) continue;
      this.scene.remove(it.group, it.ring);
      it.ring.material.dispose();
      this.items.delete(id);
    }
    for (const [id, t] of this.hidden) if (t < now) this.hidden.delete(id);
  }

  update(dt) {
    this.time += dt;
    for (const [id, it] of this.items) {
      it.appear = Math.min(1, it.appear + dt * 4);
      const hot = id === this.highlightId;
      if (it.flag) {
        // flags stand upright and wave; the ring shows the team colour
        it.group.position.copy(it.pos);
        it.group.rotation.set(0, it.spin, it.rest ? 0 : Math.sin(this.time * 8) * 0.3);
        it.group.scale.setScalar(it.appear * (hot ? 1.06 : 1));
        it.model.userData.cloth.rotation.y = Math.sin(this.time * 3 + it.spin) * 0.35;
        it.ring.position.set(it.pos.x, it.pos.y + 0.012, it.pos.z);
        it.ring.visible = true;
        it.ring.scale.setScalar(2.4);
        it.ring.material.color.setHex(hot ? 0xffe14a : TEAM_COLORS[flagTeam(it.w)]);
        it.ring.material.opacity = 0.8;
        continue;
      }
      const hover = it.rest ? 0.25 + Math.sin(this.time * 2 + it.spin) * 0.04 : 0.05;
      it.group.position.set(it.pos.x, it.pos.y + hover, it.pos.z);
      it.group.rotation.set(0, this.time * (hot ? 2.5 : 0.8) + it.spin, it.rest ? 0.25 : this.time * 6);
      it.group.scale.setScalar(it.appear * (hot ? 1.15 + Math.sin(this.time * 10) * 0.05 : 1));
      it.ring.position.set(it.pos.x, it.pos.y + 0.012, it.pos.z);
      it.ring.visible = it.rest;
      it.ring.material.color.setHex(hot ? 0xffe14a : 0xffffff);
      it.ring.material.opacity = hot ? 0.95 : 0.45;
      it.ring.scale.setScalar(hot ? 1.2 : 1);
    }
  }

  // nearest ground item to a point, within maxD (3D distance to the hovering model)
  nearest(p, maxD) {
    let best = null, bestD = maxD;
    for (const [id, it] of this.items) {
      if (it.flag && flagTeam(it.w) === this.myTeam) continue;
      // a flag can be grabbed anywhere along its pole
      const d = it.flag
        ? Math.hypot(p.x - it.pos.x, p.z - it.pos.z, Math.max(0, it.pos.y + 0.1 - p.y, p.y - (it.pos.y + 1.7))) * (0.35 / 0.5)
        : it.group.position.distanceTo(p);
      if (d < bestD) { bestD = d; best = { id, w: it.w, pos: it.group.position }; }
    }
    return best;
  }

  // desktop: best item in front of the player within range (feet distance)
  pickTarget(feet, viewDir, range) {
    let best = null, bestScore = -Infinity;
    for (const [id, it] of this.items) {
      if (it.flag && flagTeam(it.w) === this.myTeam) continue;
      const dx = it.pos.x - feet.x, dz = it.pos.z - feet.z, dy = it.pos.y - feet.y;
      const d = Math.hypot(dx, dz);
      if (d > range || dy < -1.2 || dy > 2.4) continue;
      const facing = d > 0.01 ? (dx * viewDir.x + dz * viewDir.z) / (d * Math.hypot(viewDir.x, viewDir.z) || 1) : 1;
      if (facing < 0.2 && d > 1) continue;
      const score = facing * 2 - d;
      if (score > bestScore) { bestScore = score; best = { id, w: it.w }; }
    }
    return best;
  }
}
