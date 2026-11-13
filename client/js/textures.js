// Procedural canvas textures (no image files needed): wood planks, hay, corrugated
// container metal, grass with dirt paths, and paint splats.
import * as THREE from 'three';

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

let seed = 1234;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Vertical boards, light warm wood (tinted per object through vertex colors).
export const woodTex = () => canvasTex(256, 256, (ctx, w, h) => {
  const boards = 4, bw = w / boards;
  for (let i = 0; i < boards; i++) {
    const l = 74 + rnd() * 10;
    ctx.fillStyle = `hsl(30, 45%, ${l}%)`;
    ctx.fillRect(i * bw, 0, bw, h);
    // grain
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = `hsla(28, 40%, ${l - 14 - rnd() * 10}%, 0.35)`;
      ctx.lineWidth = 1 + rnd() * 1.5;
      const x = i * bw + 4 + rnd() * (bw - 8);
      ctx.beginPath(); ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + rnd() * 6 - 3, h * 0.33, x + rnd() * 6 - 3, h * 0.66, x + rnd() * 4 - 2, h);
      ctx.stroke();
    }
    // board seam
    ctx.fillStyle = 'rgba(60,35,15,0.55)';
    ctx.fillRect(i * bw, 0, 3, h);
  }
  // a couple of nail heads
  ctx.fillStyle = 'rgba(50,40,30,0.7)';
  for (let i = 0; i < boards; i++) for (const y of [18, h - 18]) { ctx.beginPath(); ctx.arc(i * bw + bw / 2, y, 2.5, 0, 7); ctx.fill(); }
});

export const hayTex = () => canvasTex(256, 128, (ctx, w, h) => {
  ctx.fillStyle = '#e9c55a'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    ctx.strokeStyle = `hsla(${42 + rnd() * 10}, ${60 + rnd() * 20}%, ${55 + rnd() * 25}%, 0.8)`;
    ctx.lineWidth = 1 + rnd();
    const x = rnd() * w, y = rnd() * h, a = (rnd() - 0.5) * 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); ctx.stroke();
  }
});

export const containerTex = () => canvasTex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, w, h);
  const n = 16, sw = w / n;
  for (let i = 0; i < n; i++) {
    const g = ctx.createLinearGradient(i * sw, 0, (i + 1) * sw, 0);
    g.addColorStop(0, '#f6f6f6'); g.addColorStop(0.5, '#cfcfcf'); g.addColorStop(1, '#f2f2f2');
    ctx.fillStyle = g; ctx.fillRect(i * sw, 0, sw, h);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, w, 8); ctx.fillRect(0, h - 8, w, 8);
});

// Play-area ground. kind: grass | grass-night | gravel | asphalt | concrete. Covers [-sx..sx] x [-sz..sz].
const GROUNDS = {
  grass: { base: '#8dbd52', speck: (r) => `hsla(${88 + r() * 18}, ${45 + r() * 20}%, ${42 + r() * 18}%, 0.25)`, dirt: [176, 160, 122], pebble: '120,110,90' },
  'grass-night': { base: '#5c7f43', speck: (r) => `hsla(${92 + r() * 18}, ${35 + r() * 20}%, ${30 + r() * 14}%, 0.3)`, dirt: [150, 132, 100], pebble: '90,80,70' },
  gravel: { base: '#c4b28e', speck: (r) => `hsla(${30 + r() * 15}, ${10 + r() * 20}%, ${50 + r() * 30}%, 0.35)`, dirt: [150, 128, 96], pebble: '90,80,70', dense: true },
  asphalt: { base: '#4a4e57', speck: (r) => `hsla(220, ${4 + r() * 6}%, ${24 + r() * 20}%, 0.35)`, dirt: [40, 42, 46], pebble: '150,150,155' },
  concrete: { base: '#8f949b', speck: (r) => `hsla(210, ${4 + r() * 6}%, ${45 + r() * 20}%, 0.25)`, dirt: [96, 92, 84], pebble: '70,70,70', slabs: 4 },
};
export function groundTex(map, sx, sz, kind = 'grass') {
  const G = GROUNDS[kind] || GROUNDS.grass;
  const W = 1024, H = Math.round((1024 * sz) / sx);
  return canvasTex(W, H, (ctx, w, h) => {
    ctx.fillStyle = G.base; ctx.fillRect(0, 0, w, h);
    const toPx = (x, z) => [((x + sx) / (2 * sx)) * w, ((z + sz) / (2 * sz)) * h];
    const ppm = w / (2 * sx);
    for (let i = 0; i < (G.dense ? 5000 : 2600); i++) {
      ctx.fillStyle = G.speck(rnd);
      ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, (G.dense ? 1 : 2) + rnd() * (G.dense ? 3 : 9), 0, 7); ctx.fill();
    }
    if (G.slabs) {                                     // concrete slab joints
      ctx.strokeStyle = 'rgba(40,40,45,0.35)'; ctx.lineWidth = 2;
      for (let x = -sx; x <= sx; x += G.slabs) { const [px] = toPx(x, 0); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
      for (let z = -sz; z <= sz; z += G.slabs) { const [, py] = toPx(0, z); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); }
    }
    const [dr, dg, db] = G.dirt;
    for (const [x, z, r] of map.dirt || []) {
      for (let k = 0; k < 7; k++) {
        const [px, py] = toPx(x + (rnd() - 0.5) * r, z + (rnd() - 0.5) * r);
        const rr = r * ppm * (0.45 + rnd() * 0.4);
        const g = ctx.createRadialGradient(px, py, rr * 0.2, px, py, rr);
        g.addColorStop(0, `rgba(${dr},${dg},${db},0.9)`);
        g.addColorStop(0.7, `rgba(${dr},${dg},${db},0.6)`);
        g.addColorStop(1, `rgba(${dr},${dg},${db},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.fill();
      }
    }
    if (kind === 'gravel') {                           // tire tracks
      ctx.strokeStyle = 'rgba(120,100,76,0.35)'; ctx.lineWidth = 0.35 * ppm;
      for (let i = 0; i < 6; i++) {
        const z0 = (rnd() - 0.5) * sz * 1.6, z1 = (rnd() - 0.5) * sz * 1.6;
        for (const off of [-1.1, 1.1]) {
          ctx.beginPath(); const [ax, ay] = toPx(-sx, z0 + off); const [bx, by] = toPx(sx, z1 + off);
          ctx.moveTo(ax, ay); ctx.bezierCurveTo(w * 0.35, ay + (rnd() - 0.5) * 200, w * 0.65, by + (rnd() - 0.5) * 200, bx, by); ctx.stroke();
        }
      }
    }
    for (const [x, z, sw, sd] of map.stripes || []) {   // painted parking lines
      const [px, py] = toPx(x - sw / 2, z - sd / 2);
      ctx.fillStyle = 'rgba(245,240,225,0.85)'; ctx.fillRect(px, py, sw * ppm, sd * ppm);
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(${G.pebble},${0.15 + rnd() * 0.2})`;
      ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
  }, false);
}

// Emissive map for the ground: soft colored pools of light under lamps. pools: [x, z, r, color]
export function glowTex(pools, sx, sz) {
  const W = 512, H = Math.round((512 * sz) / sx);
  return canvasTex(W, H, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const ppm = w / (2 * sx);
    for (const [x, z, r, color] of pools) {
      const px = ((x + sx) / (2 * sx)) * w, py = ((z + sz) / (2 * sz)) * h, rr = r * ppm;
      const c = new THREE.Color(color), rgb = `${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0}`;
      const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, `rgba(${rgb},0.42)`); g.addColorStop(0.5, `rgba(${rgb},0.18)`); g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.fill();
    }
  }, false);
}

export const brickTex = () => canvasTex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#d8d0c4'; ctx.fillRect(0, 0, w, h);
  const rows = 8, bh = h / rows, bw = w / 4;
  for (let r = 0; r < rows; r++) for (let i = -1; i < 5; i++) {
    const x = i * bw + (r % 2 ? bw / 2 : 0);
    ctx.fillStyle = `hsl(${10 + rnd() * 8}, ${45 + rnd() * 15}%, ${38 + rnd() * 10}%)`;
    ctx.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
  }
});

export const chainTex = () => canvasTex(64, 64, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-w / 2, h / 2); ctx.lineTo(w / 2, -h / 2); ctx.moveTo(w / 2, h * 1.5); ctx.lineTo(w * 1.5, h / 2); ctx.stroke();
});

// White splat with alpha; tinted per instance.
export const splatTex = () => canvasTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#fff';
  const cx = w / 2, cy = h / 2;
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, 7); ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = 22 + rnd() * 14, r = 8 + rnd() * 10;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, d = 40 + rnd() * 20, r = 2 + rnd() * 4;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, 7); ctx.fill();
  }
}, false);
