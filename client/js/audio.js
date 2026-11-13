// Procedural 3D sound: every effect is synthesized with Web Audio (no audio files).
// Positional sounds use HRTF panners; the listener follows the camera each frame.
import * as THREE from 'three';

const v = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Quaternion();
const rand = (a, b) => a + Math.random() * (b - a);

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.voices = 0;
  }

  // Must be called from a user gesture (click / Enter VR).
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.comp.connect(this.master).connect(ctx.destination);
    // shared white-noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  setVolume(vol) { this.volume = vol; this.apply(); }
  toggleMute() { this.muted = !this.muted; this.apply(); return this.muted; }
  apply() { if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05); }

  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    camera.getWorldPosition(v);
    camera.getWorldQuaternion(q);
    fwd.set(0, 0, -1).applyQuaternion(q);
    up.set(0, 1, 0).applyQuaternion(q);
    if (L.positionX) {
      L.positionX.setTargetAtTime(v.x, t, 0.01); L.positionY.setTargetAtTime(v.y, t, 0.01); L.positionZ.setTargetAtTime(v.z, t, 0.01);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.01); L.forwardY.setTargetAtTime(fwd.y, t, 0.01); L.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      L.upX.setTargetAtTime(up.x, t, 0.01); L.upY.setTargetAtTime(up.y, t, 0.01); L.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      L.setPosition(v.x, v.y, v.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    this.listenerPos = v.clone();
  }

  // ---- building blocks ---------------------------------------------------------------
  // Output node for a sound: positional (panner) or direct. Returns null if too busy/far.
  out(pos, gain = 1, dur = 0.5) {
    if (!this.ctx || this.muted) return null;
    if (this.voices > 40) return null;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      if (this.listenerPos && this.listenerPos.distanceToSquared(v.set(pos[0], pos[1], pos[2])) > 60 * 60) return null;
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = 1.5; p.rolloffFactor = 1.1; p.maxDistance = 60;
      if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
      else p.setPosition(pos[0], pos[1], pos[2]);
      g.connect(p).connect(this.comp);
    } else g.connect(this.comp);
    this.voices++;
    setTimeout(() => { this.voices--; }, (dur + 0.2) * 1000);
    return g;
  }

  tone(dest, { type = 'sine', f0 = 440, f1 = f0, t = 0, dur = 0.1, vol = 0.5, attack = 0.004, curve = 'exp' }) {
    const ctx = this.ctx, start = ctx.currentTime + t;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, start);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
      else o.frequency.linearRampToValueAtTime(f1, start + dur);
    }
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(dest);
    o.start(start); o.stop(start + dur + 0.02);
    return o;
  }

  noise(dest, { t = 0, dur = 0.1, vol = 0.5, type = 'bandpass', f0 = 1000, f1 = f0, Q = 1, attack = 0.002 }) {
    const ctx = this.ctx, start = ctx.currentTime + t;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = Q;
    f.frequency.setValueAtTime(f0, start);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(start, Math.random() * 1.5); s.stop(start + dur + 0.02);
  }

  // ---- game sounds ------------------------------------------------------------------------
  shoot(pos, shotgun, own, pitch = 1, gain = 1) {
    const o = this.out(own ? null : pos, (own ? 0.55 : 1) * gain, 0.3);
    if (!o) return;
    const p = rand(0.92, 1.08) * pitch;
    if (shotgun) {
      this.noise(o, { dur: 0.22, vol: 0.9, type: 'lowpass', f0: 2400 * p, f1: 300, Q: 0.7 });
      this.tone(o, { f0: 140 * p, f1: 45, dur: 0.2, vol: 0.9 });
      this.noise(o, { t: 0.01, dur: 0.06, vol: 0.4, type: 'highpass', f0: 3000 });
    } else {
      this.noise(o, { dur: 0.07, vol: 0.7, type: 'bandpass', f0: 2200 * p, f1: 700, Q: 1.2 });
      this.tone(o, { f0: 210 * p, f1: 70, dur: 0.09, vol: 0.7 });
      this.noise(o, { dur: 0.035, vol: 0.35, type: 'highpass', f0: 4000 });
    }
  }

  // per-weapon firing sounds
  weapon(w, pos, own) {
    switch (w) {
      case 2: return this.shoot(pos, true, own);                // shotgun
      case 5: return this.shoot(pos, false, own, 1.25, 0.8);    // burst rifle: tighter, higher
      case 6: return this.sniper(pos, own);
      case 7: return this.launch(pos, own);
      case 8: return this.spray(pos, own);
      default: return this.shoot(pos, false, own);
    }
  }

  sniper(pos, own) {
    const o = this.out(own ? null : pos, own ? 0.6 : 1.1, 0.6);
    if (!o) return;
    this.noise(o, { dur: 0.05, vol: 0.9, type: 'highpass', f0: 2500 });
    this.tone(o, { f0: 260, f1: 60, dur: 0.16, vol: 0.8 });
    this.noise(o, { t: 0.03, dur: 0.45, vol: 0.25, type: 'bandpass', f0: 900, f1: 300, Q: 0.8 }); // tail
  }

  launch(pos, own) {
    const o = this.out(own ? null : pos, own ? 0.6 : 1, 0.4);
    if (!o) return;
    this.tone(o, { f0: 150, f1: 70, dur: 0.18, vol: 0.9 });
    this.noise(o, { dur: 0.12, vol: 0.6, type: 'lowpass', f0: 900, f1: 200 });
    this.tone(o, { t: 0.02, type: 'triangle', f0: 420, f1: 650, dur: 0.12, vol: 0.2 }); // "bloop"
  }

  spray(pos, own) {
    const o = this.out(own ? null : pos, own ? 0.3 : 0.5, 0.15);
    if (!o) return;
    this.noise(o, { dur: 0.09, vol: 0.6, type: 'bandpass', f0: rand(2500, 3400), Q: 0.9, attack: 0.01 });
    this.tone(o, { f0: 180, f1: 120, dur: 0.05, vol: 0.2 });
  }

  minePlace(pos) {
    const o = this.out(pos, 0.6, 0.5);
    if (!o) return;
    this.noise(o, { dur: 0.03, vol: 0.6, type: 'highpass', f0: 3000 });
    this.tone(o, { t: 0.25, f0: 1400, dur: 0.07, vol: 0.3 });
    this.tone(o, { t: 0.4, f0: 1900, dur: 0.07, vol: 0.3 });
  }

  // foam mallet hit: soft thump + squeaky toy
  bonk(pos) {
    const o = this.out(pos, 1, 0.5);
    if (!o) return;
    this.tone(o, { f0: 180, f1: 90, dur: 0.12, vol: 0.9 });
    this.noise(o, { dur: 0.06, vol: 0.5, type: 'lowpass', f0: 800 });
    this.tone(o, { t: 0.03, type: 'square', f0: 900, f1: 1500, dur: 0.18, vol: 0.12, curve: 'lin' });
  }

  splat(pos, big = false) {
    const o = this.out(pos, big ? 0.9 : 0.55, 0.25);
    if (!o) return;
    const p = rand(0.8, 1.25);
    this.noise(o, { dur: big ? 0.25 : 0.12, vol: 0.8, type: 'bandpass', f0: 1100 * p, f1: 260, Q: 1.5 });
    this.tone(o, { f0: 340 * p, f1: 90, dur: 0.07, vol: 0.5, type: 'triangle' });
  }

  shieldBlock(pos) {
    const o = this.out(pos, 0.8, 0.3);
    if (!o) return;
    this.tone(o, { type: 'triangle', f0: 540, f1: 500, dur: 0.18, vol: 0.5 });
    this.tone(o, { type: 'sine', f0: 820, dur: 0.12, vol: 0.3 });
    this.noise(o, { dur: 0.05, vol: 0.5, type: 'bandpass', f0: 1800, Q: 2 });
  }

  // victim pops: bubbly pop + slide whistle down
  pop(pos) {
    const o = this.out(pos, 1, 0.6);
    if (!o) return;
    this.tone(o, { f0: 500, f1: 1500, dur: 0.07, vol: 0.6 });
    this.noise(o, { t: 0.05, dur: 0.3, vol: 0.7, type: 'bandpass', f0: 900, f1: 200, Q: 1 });
    this.tone(o, { t: 0.08, type: 'triangle', f0: 1100, f1: 250, dur: 0.45, vol: 0.18, curve: 'lin' });
  }

  // Hit confirm: a bright, ringing bell. Strongest tone around 2.2 kHz, a soft 15 ms
  // strike with a sparkle on top, and a long ring that fades over ~1.7 s.
  killConfirm() {
    const o = this.out(null, 0.6, 2);
    if (!o) return;
    const f = 1160;
    //        ratio  vol   ring (s)
    const partials = [
      [1.0, 0.22, 1.7],
      [1.93, 0.42, 1.5],   // the main, brightest tone (~2.2 kHz)
      [2.88, 0.3, 1.1],
      [3.95, 0.12, 0.7],
      [5.6, 0.06, 0.4],
    ];
    for (const [ratio, vol, dur] of partials) this.tone(o, { f0: f * ratio, dur, vol, attack: 0.015 });
    // a little detuned twin on the main tone makes it shimmer as it rings
    this.tone(o, { f0: f * 1.93 * 1.004, dur: 1.4, vol: 0.12, attack: 0.015 });
    // sparkle: a short burst of very high partials and air right on the strike
    this.tone(o, { f0: 10400, dur: 0.18, vol: 0.05, attack: 0.004 });
    this.tone(o, { f0: 12600, dur: 0.12, vol: 0.035, attack: 0.004 });
    this.noise(o, { dur: 0.05, vol: 0.18, type: 'highpass', f0: 9000, attack: 0.003 });
  }

  youOut() {
    const o = this.out(null, 0.5, 1);
    if (!o) return;
    [523, 415, 330, 262].forEach((f, i) => this.tone(o, { t: i * 0.13, type: 'square', f0: f, dur: 0.16, vol: 0.12 }));
    this.noise(o, { dur: 0.35, vol: 0.8, type: 'bandpass', f0: 800, f1: 180, Q: 1 });
  }

  explosion(pos) {
    const o = this.out(pos, 1.3, 1.2);
    if (!o) return;
    this.noise(o, { dur: 0.9, vol: 1, type: 'lowpass', f0: 1800, f1: 90, Q: 0.6 });
    this.tone(o, { f0: 90, f1: 28, dur: 0.7, vol: 1 });
    for (let i = 0; i < 5; i++) this.noise(o, { t: 0.05 + i * 0.06, dur: 0.12, vol: 0.4, type: 'bandpass', f0: rand(500, 1400), f1: 200, Q: 1.5 });
  }

  whoosh(pos, own) {
    const o = this.out(own ? null : pos, 0.5, 0.4);
    if (!o) return;
    this.noise(o, { dur: 0.32, vol: 0.6, type: 'bandpass', f0: 400, f1: 2200, Q: 1.5, attack: 0.08 });
  }

  bounce(pos) {
    const o = this.out(pos, 0.6, 0.2);
    if (!o) return;
    this.tone(o, { type: 'triangle', f0: rand(380, 460), f1: 220, dur: 0.08, vol: 0.5 });
    this.noise(o, { dur: 0.04, vol: 0.3, type: 'bandpass', f0: 1500, Q: 2 });
  }

  click(own = true) {
    const o = this.out(null, 0.4, 0.1);
    if (!o) return;
    this.noise(o, { dur: 0.025, vol: 0.7, type: 'highpass', f0: 3500 });
    this.tone(o, { type: 'square', f0: 1800, dur: 0.02, vol: 0.15 });
  }

  reload(duration) {
    const o = this.out(null, 0.45, duration + 0.2);
    if (!o) return;
    const clack = (t, f) => { this.noise(o, { t, dur: 0.04, vol: 0.7, type: 'bandpass', f0: f, Q: 3 }); this.tone(o, { t, type: 'square', f0: f / 6, dur: 0.03, vol: 0.12 }); };
    clack(0, 2400);
    this.noise(o, { t: 0.15, dur: duration * 0.5, vol: 0.25, type: 'bandpass', f0: 3000, f1: 1500, Q: 1, attack: 0.05 }); // hopper rattle
    clack(duration - 0.08, 1800);
    clack(duration - 0.02, 2800);
  }

  drop() {
    const o = this.out(null, 0.35, 0.2);
    if (!o) return;
    this.noise(o, { t: 0.05, dur: 0.08, vol: 0.7, type: 'lowpass', f0: 700, f1: 200 });
    this.tone(o, { t: 0.05, f0: 160, f1: 90, dur: 0.07, vol: 0.35 });
  }

  shieldBreak(pos) {
    const o = this.out(pos, 1, 0.6);
    if (!o) return;
    this.noise(o, { dur: 0.35, vol: 0.9, type: 'highpass', f0: 2500, f1: 900 });
    for (let i = 0; i < 4; i++) this.tone(o, { t: i * 0.04, type: 'triangle', f0: rand(900, 1700), f1: 400, dur: 0.12, vol: 0.25 });
  }

  grab() {
    const o = this.out(null, 0.35, 0.15);
    if (!o) return;
    this.noise(o, { dur: 0.06, vol: 0.6, type: 'bandpass', f0: 1200, Q: 1 });
    this.tone(o, { f0: 320, f1: 260, dur: 0.05, vol: 0.3 });
  }

  footstep(pos, own) {
    const o = this.out(own ? null : pos, own ? 0.18 : 0.35, 0.12);
    if (!o) return;
    this.noise(o, { dur: 0.07, vol: 0.7, type: 'lowpass', f0: rand(380, 620), Q: 0.8 });
    this.noise(o, { dur: 0.03, vol: 0.15, type: 'highpass', f0: 2500 }); // grass rustle
  }

  rustle(pos, own) {
    const o = this.out(own ? null : pos, own ? 0.3 : 0.6, 0.35);
    if (!o) return;
    for (let i = 0; i < 3; i++) this.noise(o, { t: i * 0.05, dur: 0.12, vol: 0.5, type: 'bandpass', f0: rand(2500, 4500), Q: 0.7, attack: 0.02 });
  }

  land() {
    const o = this.out(null, 0.35, 0.2);
    if (!o) return;
    this.noise(o, { dur: 0.12, vol: 0.8, type: 'lowpass', f0: 500, f1: 150 });
    this.tone(o, { f0: 90, f1: 50, dur: 0.1, vol: 0.5 });
  }

  spawn(pos) {
    const o = this.out(pos, pos ? 0.5 : 0.4, 0.3);
    if (!o) return;
    this.tone(o, { f0: 260, f1: 880, dur: 0.18, vol: 0.5, curve: 'exp' });
    this.tone(o, { t: 0.1, f0: 1320, dur: 0.12, vol: 0.15 });
  }

  beep(high = false) {
    const o = this.out(null, 0.35, 0.2);
    if (!o) return;
    this.tone(o, { f0: high ? 1320 : 880, dur: high ? 0.35 : 0.1, vol: 0.4 });
  }

  whistle() {
    const o = this.out(null, 0.45, 1);
    if (!o) return;
    for (const t of [0, 0.32]) {
      const osc = this.tone(o, { t, f0: 2300, dur: 0.26, vol: 0.35, attack: 0.02 });
      const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      lfo.frequency.value = 28; lg.gain.value = 90;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(this.ctx.currentTime + t); lfo.stop(this.ctx.currentTime + t + 0.3);
    }
  }

  fanfare(win) {
    const o = this.out(null, 0.45, 2);
    if (!o) return;
    const notes = win ? [523, 659, 784, 1047, 784, 1047] : [392, 370, 349, 330];
    const step = win ? 0.13 : 0.22;
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      this.tone(o, { t: i * step, type: 'triangle', f0: f, dur: last ? 0.6 : step * 1.1, vol: 0.35 });
      this.tone(o, { t: i * step, type: 'square', f0: f / 2, dur: last ? 0.5 : step, vol: 0.05 });
    });
  }

  // One brassy trumpet note: two slightly detuned saws through a filter that opens at the
  // attack (the "blat"), a small pitch scoop, and vibrato on long notes.
  brass(dest, f, t, dur, vol = 0.3) {
    const ctx = this.ctx, start = ctx.currentTime + t, end = start + dur;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 2.5;
    filt.frequency.setValueAtTime(f * 1.5, start);
    filt.frequency.exponentialRampToValueAtTime(f * 7, start + 0.05);
    filt.frequency.exponentialRampToValueAtTime(f * 4, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.03);
    g.gain.setValueAtTime(vol * 0.85, Math.max(start + 0.04, end - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    filt.connect(g).connect(dest);
    const vib = dur > 0.4 ? ctx.createOscillator() : null, vibG = ctx.createGain();
    if (vib) { vib.frequency.value = 5.5; vibG.gain.setValueAtTime(0, start); vibG.gain.linearRampToValueAtTime(f * 0.012, start + 0.35); vib.connect(vibG); vib.start(start); vib.stop(end + 0.05); }
    for (const det of [1, 1.006]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * det * 0.96, start);
      o.frequency.exponentialRampToValueAtTime(f * det, start + 0.04);
      if (vib) vibG.connect(o.frequency);
      o.connect(filt);
      o.start(start); o.stop(end + 0.05);
    }
  }

  // Flag taken. danger = it's your flag: a two-tone klaxon (three whoops). Otherwise your team
  // grabbed theirs: a quick rising "go go" alert.
  alarm(danger = true) {
    const o = this.out(null, 0.5, 2);
    if (!o) return;
    const ctx = this.ctx;
    if (danger) {
      for (let i = 0; i < 3; i++) {
        const t = i * 0.42, start = ctx.currentTime + t;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass'; filt.frequency.value = 2600; filt.Q.value = 1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
        g.gain.setValueAtTime(0.22, start + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
        filt.connect(g).connect(o);
        for (const [type, mul] of [['square', 1], ['sawtooth', 1.5]]) {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.setValueAtTime(520 * mul, start);
          osc.frequency.linearRampToValueAtTime(880 * mul, start + 0.18);
          osc.frequency.setValueAtTime(700 * mul, start + 0.19);
          osc.frequency.linearRampToValueAtTime(820 * mul, start + 0.34);
          osc.connect(filt);
          osc.start(start); osc.stop(start + 0.38);
        }
      }
    } else {
      [[880, 0], [1175, 0.12], [880, 0.3], [1175, 0.42], [1568, 0.54]].forEach(([f, t], i) => {
        this.tone(o, { t, type: 'triangle', f0: f, dur: i === 4 ? 0.35 : 0.11, vol: 0.3 });
        this.tone(o, { t, type: 'square', f0: f * 2, dur: 0.06, vol: 0.04 });
      });
    }
  }

  // Flag captured: a bright trumpet call for your team, a sagging "wah-wah" when the others score.
  trumpet(win = true) {
    const o = this.out(null, 0.5, 3);
    if (!o) return;
    const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, G4 = 392, Fs4 = 369.99, F4 = 349.23, E4 = 329.63;
    const notes = win
      ? [[C5, 0, 0.11], [C5, 0.13, 0.11], [C5, 0.26, 0.11], [G5, 0.39, 0.42], [E5, 0.84, 0.15], [G5, 1.0, 0.15], [C6, 1.16, 1.1]]
      : [[G4, 0, 0.3], [Fs4, 0.34, 0.3], [F4, 0.68, 0.3], [E4, 1.02, 0.9]];
    for (const [f, t, d] of notes) {
      this.brass(o, f, t, d, win ? 0.28 : 0.2);
      if (win) this.brass(o, f * 0.75, t, d, 0.12); // a second trumpet a fourth below
    }
  }

  // ---- ambience: soft breeze and occasional birds in the trees ------------------------------
  startAmbience() {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.035;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.12; lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(this.comp);
    s.start(); lfo.start();
    const chirp = () => {
      if (!this.muted && document.visibilityState === 'visible') {
        const a = Math.random() * Math.PI * 2;
        const pos = [Math.cos(a) * 26, 6 + Math.random() * 3, Math.sin(a) * 18];
        const o = this.out(pos, 0.25, 1.2);
        if (o) {
          const base = rand(2600, 4200), n = 2 + ((Math.random() * 4) | 0);
          for (let i = 0; i < n; i++) {
            const t = i * rand(0.09, 0.16);
            this.tone(o, { t, f0: base * rand(0.9, 1.1), f1: base * rand(1.2, 1.5), dur: 0.07, vol: 0.3 });
          }
        }
      }
      setTimeout(chirp, rand(2500, 7000));
    };
    setTimeout(chirp, 2000);
  }
}

export const sound = new Sound();
