// Map vote between matches. Desktop: click a card or press 1/2/3.
// VR: a panel floats in front of you; point a controller at a card and pull the trigger.
import * as THREE from 'three';
import { MAPS } from '/shared/maps.js';

const $ = (id) => document.getElementById(id);
const ray = new THREE.Raycaster(), v = new THREE.Vector3(), q = new THREE.Quaternion();

export class VoteUI {
  constructor(net) {
    this.net = net;
    this.options = [];
    this.counts = {};
    this.mine = null;
    this.endsAt = 0;
    this.hover = -1;
    // VR panel (attached to the camera when a vote starts)
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 420;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.45),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.panel.renderOrder = 1000;
    this.panel.position.set(0, 0.05, -1.25);
    this.panel.visible = false;
    this.key = '';
    addEventListener('keydown', (e) => {
      if (!this.options.length) return;
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (i >= 0 && this.options[i]) this.cast(this.options[i]);
    });
  }

  attach(camera) { if (this.panel.parent !== camera) camera.add(this.panel); }

  onVote(m) {
    this.options = m.options;
    this.counts = m.counts;
    if (!m.options.length) { this.mine = null; this.hide(); return; }
    if (m.endsIn) this.endsAt = performance.now() + m.endsIn * 1000;
    this.renderDom();
  }

  cast(id) {
    this.mine = id;
    this.net.send({ type: 'vote', map: id });
    this.renderDom();
  }

  hide() { $('vote').style.display = 'none'; this.panel.visible = false; }

  renderDom() {
    const el = $('vote');
    el.style.display = 'flex';
    el.querySelector('.vote-cards').innerHTML = this.options.map((id, i) => {
      const m = MAPS[id];
      return `<button class="vote-card${this.mine === id ? ' mine' : ''}" data-id="${id}">
        <span class="vote-key">${i + 1}</span><b>${m.name}</b><small>${m.desc || ''}</small>
        <span class="vote-count">${this.counts[id] || 0} vote${(this.counts[id] || 0) === 1 ? '' : 's'}</span></button>`;
    }).join('');
    el.querySelectorAll('.vote-card').forEach((b) => { b.onclick = () => this.cast(b.dataset.id); });
  }

  // per frame: countdown text, VR panel drawing and controller pointing
  update(inVR, hands) {
    if (!this.options.length) return;
    const left = Math.max(0, Math.ceil((this.endsAt - performance.now()) / 1000));
    $('vote-timer').textContent = `Next match in ${left}s`;
    this.panel.visible = inVR;
    if (!inVR) return;
    // point & pull the trigger
    this.hover = -1;
    for (const h of hands) {
      if (!h.source || !h.state) continue;
      h.holder.getWorldPosition(v);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(h.holder.getWorldQuaternion(q));
      ray.set(v, dir);
      const hit = ray.intersectObject(this.panel)[0];
      if (!hit) continue;
      const i = Math.min(this.options.length - 1, Math.floor(hit.uv.x * this.options.length));
      if (hit.uv.y < 0.82) this.hover = i;
      if (this.hover >= 0 && h.state.trigger && !h.voteTrig) this.cast(this.options[this.hover]);
      h.voteTrig = h.state.trigger;
    }
    const key = `${this.options}|${JSON.stringify(this.counts)}|${this.mine}|${this.hover}|${left}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.canvas.getContext('2d'), W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(15,18,24,0.88)'; ctx.beginPath(); ctx.roundRect(0, 0, W, H, 36); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Vote for the next map · ${left}s`, W / 2, 56);
    const n = this.options.length, cw = (W - 40) / n;
    this.options.forEach((id, i) => {
      const x = 20 + i * cw, y = 84, w = cw - 20, h = H - 110;
      const mine = this.mine === id, hot = this.hover === i;
      ctx.fillStyle = mine ? '#ff7a1a' : hot ? '#3a4a66' : '#262d3a';
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 24); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 38px system-ui, sans-serif';
      ctx.fillText(MAPS[id].name, x + w / 2, y + 80);
      ctx.font = '24px system-ui, sans-serif'; ctx.fillStyle = '#cdd3dd';
      wrap(ctx, MAPS[id].desc || '', x + w / 2, y + 130, w - 30, 30);
      ctx.font = 'bold 30px system-ui, sans-serif'; ctx.fillStyle = mine ? '#fff' : '#ffd36a';
      ctx.fillText(`${this.counts[id] || 0} votes`, x + w / 2, y + h - 30);
    });
    this.tex.needsUpdate = true;
  }
}

function wrap(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; }
    else line = t;
  }
  if (line) ctx.fillText(line, x, y);
}
