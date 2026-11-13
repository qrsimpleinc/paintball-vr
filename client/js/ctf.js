// Capture the Flag visuals: a coloured pad at each team's flag spot (where you bring the
// enemy flag to score) and a tall light beam above each flag so you can always find it.
import * as THREE from 'three';
import { TEAM_COLORS, CTF, isFlag, flagTeam } from '/shared/constants.js';

export class CtfView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.beams = [];
    this.pads = [];
    this.time = 0;
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
    }
    this.beams = []; this.pads = [];
  }

  // homes: [[x,y,z], [x,y,z]] or null when the match is not Capture the Flag
  setup(homes) {
    const key = JSON.stringify(homes);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!homes) return;
    homes.forEach(([x, y, z], t) => {
      const color = TEAM_COLORS[t];
      const pad = new THREE.Group();
      pad.position.set(x, y + 0.015, z);
      const area = new THREE.Mesh(new THREE.CircleGeometry(CTF.captureRadius, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }));
      const rim = new THREE.Mesh(new THREE.RingGeometry(CTF.captureRadius - 0.12, CTF.captureRadius, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.1, 20), new THREE.MeshLambertMaterial({ color: 0x555b66 }));
      base.position.y = 0.04;
      pad.add(area, rim, base);
      this.group.add(pad);
      this.pads.push({ pad, rim });

      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 40, 8, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      beam.geometry.translate(0, 21.6, 0);
      this.group.add(beam);
      this.beams.push(beam);
    });
  }

  // rows: item snapshot rows [id, w, x, y, z, state, holder, hand, rest]; where(holderId) gives a carrier's position
  update(dt, rows, where) {
    this.time += dt;
    if (!this.beams.length) return;
    for (const r of rows || []) {
      if (!isFlag(r[1])) continue;
      const beam = this.beams[flagTeam(r[1])];
      if (!beam) continue;
      let p = r[5] === 1 ? where(r[6]) : { x: r[2], y: r[3], z: r[4] };
      if (!p) continue;
      beam.visible = true;
      beam.position.set(p.x, r[5] === 1 ? p.y - 1.6 : p.y, p.z);
      beam.material.opacity = r[5] === 1 ? 0.35 + Math.sin(this.time * 8) * 0.15 : 0.3;
    }
    for (const { rim } of this.pads) rim.material.opacity = 0.6 + Math.sin(this.time * 3) * 0.25;
  }
}
