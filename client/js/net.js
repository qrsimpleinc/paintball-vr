// WebSocket connection, clock sync and snapshot interpolation.
import * as THREE from 'three';
import { INTERP_DELAY } from '/shared/constants.js';

export class Net {
  constructor() {
    this.handlers = {};
    this.snaps = [];
    this.rtt = 0;
    this.offset = null; // serverTime - localTime
    this.connected = false;
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

  // server: address of the game server, e.g. wss://eu1.example.com; empty means this website's host
  connect(joinMsg, server = '') {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${server || `${proto}://${location.host}`}/ws`);
      this.ws.onopen = () => {
        this.connected = true;
        this.send({ type: 'join', ...joinMsg });
        this.ping();
        this.pingTimer = setInterval(() => this.ping(), 1000);
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = (e) => { this.connected = false; clearInterval(this.pingTimer); this.emit('close', e); };
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'pong') {
          const now = Date.now();
          const rtt = now - msg.t;
          this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
          const off = msg.st - (msg.t + rtt / 2);
          this.offset = this.offset === null ? off : this.offset * 0.9 + off * 0.1;
          return;
        }
        if (msg.type === 'snap') {
          if (this.offset === null) this.offset = msg.t - Date.now();
          this.snaps.push(msg);
          if (this.snaps.length > 30) this.snaps.shift();
        }
        this.emit(msg.type, msg);
      };
    });
  }

  ping() { this.send({ type: 'ping', t: Date.now() }); }

  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  latest() { return this.snaps[this.snaps.length - 1]; }

  // Interpolated player arrays at (server now - INTERP_DELAY). Returns Map id -> array.
  sample() {
    const out = new Map();
    if (!this.snaps.length) return out;
    const t = Date.now() + (this.offset || 0) - INTERP_DELAY;
    let a = this.snaps[0], b = this.snaps[0];
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].t <= t) { a = this.snaps[i]; b = this.snaps[i + 1] || a; break; }
    }
    const k = b === a ? 0 : Math.min(1, (t - a.t) / (b.t - a.t));
    const prev = new Map(a.pl.map((p) => [p[0], p]));
    for (const pb of b.pl) {
      const pa = prev.get(pb[0]);
      if (!pa || pa[1] !== pb[1]) { out.set(pb[0], pb); continue; } // no blending across respawns
      const r = pb.slice();
      for (const i of [3, 4, 5, 6, 7, 8, 13, 14, 15, 20, 21, 22]) r[i] = pa[i] + (pb[i] - pa[i]) * k;
      for (const i of [9, 16, 23]) THREE.Quaternion.slerpFlat(r, i, pa, i, pb, i, k);
      out.set(pb[0], r);
    }
    return out;
  }
}
