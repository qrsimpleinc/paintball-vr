// HUD: DOM overlay for desktop, canvas panels for VR (wrist display + center message).
import * as THREE from 'three';
import { TEAM_COLORS, TEAM_NAMES } from '/shared/constants.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const $ = (id) => document.getElementById(id);

class CanvasPanel {
  constructor(w, h, worldW, worldH) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }),
    );
    this.mesh.renderOrder = 999;
    this.key = '';
  }
  draw(key, fn) {
    if (key === this.key) return;
    this.key = key;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }
}

export class Hud {
  constructor() {
    this.feed = [];
    this.msg = '';
    this.msgUntil = 0;
    this.score = [0, 0];
    this.timeLeft = 0;
    this.ammo = '';
    this.flags = '';      // Capture the Flag status line
    this.debugText = '';
    this.wrist = new CanvasPanel(512, 256, 0.16, 0.08);
    this.center = new CanvasPanel(1024, 256, 0.9, 0.225);
    this.center.mesh.position.set(0, -0.05, -1.2);
    this.hitPanel = new CanvasPanel(1024, 160, 0.9, 0.14);
    this.hitPanel.mesh.position.set(0, -0.42, -1.2);
    this.hitText = ''; this.hitUntil = 0; this.hitAt = 0;
  }

  attachVR(camera, leftHolder) {
    camera.add(this.center.mesh, this.hitPanel.mesh);
    leftHolder.add(this.wrist.mesh);
    // on the back of the left wrist, facing the player when the arm is raised
    this.wrist.mesh.position.set(0.0, 0.05, 0.08);
    this.wrist.mesh.rotation.set(-Math.PI / 2.4, 0, 0);
  }

  setScore(score, timeLeft) { this.score = score; this.timeLeft = timeLeft; }
  setAmmo(text) { this.ammo = text; }
  setFlags(text) { this.flags = text; }
  setDebug(text) { this.debugText = text; }

  killfeed(text) {
    this.feed.push({ text, until: performance.now() + 5000 });
    if (this.feed.length > 5) this.feed.shift();
  }

  // Yellow banner low in the view, e.g. "You Hit Bolt"
  hit(text) {
    this.hitText = text;
    this.hitAt = performance.now();
    this.hitUntil = this.hitAt + 2200;
  }

  message(text, seconds = 0) {
    this.msg = text;
    this.msgUntil = seconds ? performance.now() + seconds * 1000 : Infinity;
  }

  update() {
    const now = performance.now();
    this.feed = this.feed.filter((f) => f.until > now);
    if (now > this.msgUntil) this.msg = '';
    const t = Math.max(0, this.timeLeft | 0);
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

    // DOM
    $('hud-score').innerHTML =
      `<span style="color:${hex(TEAM_COLORS[0])}">${TEAM_NAMES[0]} ${this.score[0]}</span>` +
      `<span class="clock">${clock}</span>` +
      `<span style="color:${hex(TEAM_COLORS[1])}">${this.score[1]} ${TEAM_NAMES[1]}</span>`;
    $('hud-ammo').textContent = this.ammo;
    $('hud-flags').innerHTML = this.flags;
    $('hud-flags').style.display = this.flags ? 'block' : 'none';
    $('hud-feed').innerHTML = this.feed.map((f) => `<div>${f.text}</div>`).join('');
    $('hud-msg').textContent = this.msg;
    $('hud-msg').style.display = this.msg ? 'block' : 'none';
    $('debug-info').textContent = this.debugText;

    // VR wrist
    const plain = (s) => s.replace(/<[^>]+>/g, '');
    const feedKey = this.feed.map((f) => f.text).join('|');
    this.wrist.draw(`${this.score}|${clock}|${this.ammo}|${this.flags}|${feedKey}|${this.debugText.split('\n')[0]}`, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(15,18,24,0.82)';
      ctx.roundRect(0, 0, w, h, 28); ctx.fill();
      ctx.font = 'bold 54px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = hex(TEAM_COLORS[0]); ctx.textAlign = 'left'; ctx.fillText(String(this.score[0]), 28, 18);
      ctx.fillStyle = hex(TEAM_COLORS[1]); ctx.textAlign = 'right'; ctx.fillText(String(this.score[1]), w - 28, 18);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(clock, w / 2, 18);
      ctx.font = '30px system-ui, sans-serif';
      ctx.fillText(this.ammo, w / 2, this.flags ? 82 : 92);
      if (this.flags) { ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillStyle = '#ffe14a'; ctx.fillText(plain(this.flags), w / 2, 118); }
      ctx.font = '22px system-ui, sans-serif'; ctx.fillStyle = '#ccd';
      this.feed.slice(-2).forEach((f, i) => ctx.fillText(plain(f.text), w / 2, (this.flags ? 152 : 140) + i * 28));
      if (this.debugText) { ctx.fillStyle = '#8f8'; ctx.fillText(this.debugText.split('\n')[0], w / 2, 205); }
    });

    // hit banner (DOM + VR), pops in then fades
    const hitOn = now < this.hitUntil;
    const hitAge = (now - this.hitAt) / 1000;
    const hitScale = hitAge < 0.15 ? 0.6 + (hitAge / 0.15) * 0.55 : hitAge < 0.3 ? 1.15 - ((hitAge - 0.15) / 0.15) * 0.15 : 1;
    const hitAlpha = hitOn ? Math.min(1, (this.hitUntil - now) / 500) : 0;
    const el = $('hud-hit');
    el.style.display = hitOn ? 'block' : 'none';
    if (hitOn) { el.textContent = this.hitText; el.style.opacity = hitAlpha; el.style.transform = `translateX(-50%) scale(${hitScale})`; }
    this.hitPanel.mesh.visible = hitOn;
    if (hitOn) {
      this.hitPanel.mesh.scale.setScalar(hitScale);
      this.hitPanel.mesh.material.opacity = hitAlpha;
      this.hitPanel.draw(this.hitText, (ctx, w, h) => {
        ctx.font = '900 84px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(40,30,0,0.75)';
        ctx.strokeText(this.hitText, w / 2, h / 2);
        ctx.fillStyle = '#ffe14a'; ctx.fillText(this.hitText, w / 2, h / 2);
      });
    }

    // VR center message
    this.center.mesh.visible = !!this.msg;
    if (this.msg) this.center.draw(this.msg, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(15,18,24,0.75)';
      ctx.roundRect(0, 40, w, h - 80, 40); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 60px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.msg, w / 2, h / 2);
    });
  }
}
