// Load test: connects N headless "players" that wander and shoot like real clients.
// Usage: node tools/fake-clients.js [count=4] [room=public] [url=ws://localhost:8080/ws]
import WebSocket from 'ws';

const count = Number(process.argv[2] || 4);
const room = process.argv[3] || 'public';
const url = process.argv[4] || 'ws://localhost:8080/ws';

let stats = { msgs: 0, bytes: 0, elims: 0 };

for (let i = 0; i < count; i++) {
  const ws = new WebSocket(url);
  const me = { id: 0, pos: [0, 0, 0], yaw: Math.random() * 6.28, alive: false, rtt: 0 };
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join', name: `Fake${i + 1}`, room }));
    setInterval(() => ws.send(JSON.stringify({ type: 'ping', t: Date.now() })), 1000);
    setInterval(() => {
      if (!me.alive) return;
      me.yaw += (Math.random() - 0.5) * 0.4;
      me.pos[0] = Math.max(-19, Math.min(19, me.pos[0] - Math.sin(me.yaw) * 0.15));
      me.pos[2] = Math.max(-12, Math.min(12, me.pos[2] - Math.cos(me.yaw) * 0.15));
      const h = [me.pos[0], 1.6, me.pos[2]];
      const q = [0, Math.sin(me.yaw / 2), 0, Math.cos(me.yaw / 2)];
      ws.send(JSON.stringify({ type: 'st', p: me.pos, h: [...h, ...q], l: [...h, ...q], r: [...h, ...q], lw: 0, rw: 1, rtt: me.rtt }));
      if (Math.random() < 0.08) {
        const d = [-Math.sin(me.yaw), 0.02, -Math.cos(me.yaw)];
        ws.send(JSON.stringify({ type: 'fire', w: 1, pellets: [[h[0], h[1] - 0.3, h[2], ...d]] }));
      }
    }, 50);
  });
  ws.on('message', (raw) => {
    stats.msgs++; stats.bytes += raw.length;
    const m = JSON.parse(raw);
    if (m.type === 'welcome') me.id = m.id;
    if (m.type === 'spawn') { me.pos = m.p; me.yaw = m.yaw; me.alive = true; }
    if (m.type === 'pong') me.rtt = Date.now() - m.t;
    if (m.type === 'elim') { stats.elims++; if (m.victim === me.id) me.alive = false; }
  });
  ws.on('close', (code, reason) => console.log(`Fake${i + 1} closed ${code} ${reason}`));
}

setInterval(() => {
  console.log(`clients=${count} msgs/s=${stats.msgs} KB/s per client=${(stats.bytes / 1024 / count).toFixed(1)} elims=${stats.elims}`);
  stats.msgs = 0; stats.bytes = 0;
}, 1000);
