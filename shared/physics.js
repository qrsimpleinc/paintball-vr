// Minimal collision helpers shared by server and client. Vectors are [x, y, z].
import { STEP_HEIGHT } from './constants.js';

const EPS = 1e-6;

export function boxMin(b) { return [b.x - b.w / 2, b.y, b.z - b.d / 2]; }
export function boxMax(b) { return [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2]; }

function circleOverlapsBoxXZ(b, x, z, r) {
  const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
  const cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

// Highest walkable surface under a circle, considering only surfaces the
// player can step onto from footY.
export function groundHeight(map, x, z, footY, r) {
  let h = 0;
  for (const b of map.boxes) {
    const top = b.y + b.h;
    if (top > footY + STEP_HEIGHT || top <= h) continue;
    if (circleOverlapsBoxXZ(b, x, z, r * 0.7)) h = top;
  }
  for (const rp of map.ramps || []) {
    const rh = rampHeight(rp, x, z);
    if (rh !== null && rh <= footY + STEP_HEIGHT && rh > h) h = rh;
  }
  return h;
}

// Surface height of a ramp at (x, z), or null when outside its footprint.
export function rampHeight(r, x, z) {
  if (Math.abs(x - r.x) > r.w / 2 || Math.abs(z - r.z) > r.d / 2) return null;
  let t;
  switch (r.dir) {
    case '+x': t = (x - (r.x - r.w / 2)) / r.w; break;
    case '-x': t = (r.x + r.w / 2 - x) / r.w; break;
    case '+z': t = (z - (r.z - r.d / 2)) / r.d; break;
    default: t = (r.z + r.d / 2 - z) / r.d;
  }
  return (r.y || 0) + r.h * t;
}

export function rampNormal(r) {
  const k = r.dir[1] === 'x' ? r.h / r.w : r.h / r.d;
  const n = r.dir === '+x' ? [-k, 1, 0] : r.dir === '-x' ? [k, 1, 0] : r.dir === '+z' ? [0, 1, -k] : [0, 1, k];
  const l = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / l, n[1] / l, n[2] / l];
}

// Segment vs. ramp top surface (sampled + bisection; segments are short).
function segmentRamp(p0, p1, r) {
  const f = (t) => {
    const x = p0[0] + (p1[0] - p0[0]) * t, z = p0[2] + (p1[2] - p0[2]) * t;
    const h = rampHeight(r, x, z);
    return h === null ? null : p0[1] + (p1[1] - p0[1]) * t - h;
  };
  const N = 8;
  let prevT = 0, prev = f(0);
  for (let i = 1; i <= N; i++) {
    const t = i / N, v = f(t);
    if (v !== null && v <= 0 && prev !== null && prev > 0) {
      let a = prevT, b = t;
      for (let k = 0; k < 6; k++) { const m = (a + b) / 2, fm = f(m); if (fm !== null && fm > 0) a = m; else b = m; }
      return b;
    }
    prevT = t; prev = v;
  }
  return null;
}

// Push a vertical cylinder (feet at pos[1], given height) out of blocking boxes.
export function resolveCollisions(map, pos, r, height = 1.75) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of map.boxes) {
      const top = b.y + b.h;
      if (top <= pos[1] + STEP_HEIGHT || b.y >= pos[1] + height) continue;
      const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
      const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
      const cx = Math.max(minX, Math.min(pos[0], maxX));
      const cz = Math.max(minZ, Math.min(pos[2], maxZ));
      let dx = pos[0] - cx, dz = pos[2] - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > EPS) {
        const d = Math.sqrt(d2);
        pos[0] = cx + (dx / d) * r;
        pos[2] = cz + (dz / d) * r;
      } else {
        // center inside the box: push out along the shallowest axis
        const pen = [pos[0] - minX, maxX - pos[0], pos[2] - minZ, maxZ - pos[2]];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) pos[0] = minX - r; else if (i === 1) pos[0] = maxX + r;
        else if (i === 2) pos[2] = minZ - r; else pos[2] = maxZ + r;
      }
      moved = true;
    }
    // ramps: the sloped board is solid from the sides and below. It only lets you
    // through where its surface is low enough to step onto (or high enough to walk under).
    for (const rp of map.ramps || []) {
      const minX = rp.x - rp.w / 2, maxX = rp.x + rp.w / 2, minZ = rp.z - rp.d / 2, maxZ = rp.z + rp.d / 2;
      const inside = pos[0] > minX && pos[0] < maxX && pos[2] > minZ && pos[2] < maxZ;
      const own = inside ? rampHeight(rp, pos[0], pos[2]) : null;
      if (own !== null && own <= pos[1] + STEP_HEIGHT) continue;         // on it / walking up it
      const cx = Math.max(minX, Math.min(pos[0], maxX));
      const cz = Math.max(minZ, Math.min(pos[2], maxZ));
      const dx = pos[0] - cx, dz = pos[2] - cz;
      const d2 = dx * dx + dz * dz;
      if (!inside && d2 >= r * r) continue;                               // not touching it
      const hs = inside ? own : rampHeight(rp, cx, cz);                  // board height where we touch it
      if (hs <= pos[1] + STEP_HEIGHT || hs - 0.12 >= pos[1] + height) continue; // step onto it / walk under it
      if (!inside && d2 > EPS) {
        const d = Math.sqrt(d2);
        pos[0] = cx + (dx / d) * r;
        pos[2] = cz + (dz / d) * r;
      } else {
        const pen = [pos[0] - minX, maxX - pos[0], pos[2] - minZ, maxZ - pos[2]];
        const i = pen.indexOf(Math.min(...pen));
        if (i === 0) pos[0] = minX - r; else if (i === 1) pos[0] = maxX + r;
        else if (i === 2) pos[2] = minZ - r; else pos[2] = maxZ + r;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return pos;
}

// Segment p0->p1 against an AABB. Returns { t, n } or null.
export function segmentBox(p0, p1, b) {
  const mn = boxMin(b), mx = boxMax(b);
  let tmin = 0, tmax = 1, nAxis = -1, nSign = 0;
  for (let a = 0; a < 3; a++) {
    const d = p1[a] - p0[a];
    if (Math.abs(d) < EPS) {
      if (p0[a] < mn[a] || p0[a] > mx[a]) return null;
      continue;
    }
    let t1 = (mn[a] - p0[a]) / d, t2 = (mx[a] - p0[a]) / d, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis < 0) return null; // started inside
  const n = [0, 0, 0]; n[nAxis] = nSign;
  return { t: tmin, n };
}

// Nearest hit of a segment with world geometry (boxes + ground plane).
export function raycastWorld(map, p0, p1) {
  let best = null;
  if (p1[1] < 0 && p0[1] >= 0) {
    const t = p0[1] / (p0[1] - p1[1]);
    best = { t, n: [0, 1, 0] };
  }
  for (const b of map.boxes) {
    const h = segmentBox(p0, p1, b);
    if (h && (!best || h.t < best.t)) best = h;
  }
  for (const r of map.ramps || []) {
    const t = segmentRamp(p0, p1, r);
    if (t !== null && (!best || t < best.t)) best = { t, n: rampNormal(r) };
  }
  return best;
}

export function lineOfSight(map, a, b) {
  for (const box of map.boxes) if (segmentBox(a, b, box)) return false;
  return true;
}

export function segmentSphere(p0, p1, c, r) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const f = [p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const B = 2 * (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]);
  const C = f[0] * f[0] + f[1] * f[1] + f[2] * f[2] - r * r;
  if (C <= 0) return 0;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A < EPS) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}

// Segment p0->p1 against a capsule a->b with radius r. Returns approx t or null.
export function segmentCapsule(p0, p1, a, b, r) {
  const d1 = sub(p1, p0), d2 = sub(b, a), rr = sub(p0, a);
  const A = dot(d1, d1), E = dot(d2, d2), F = dot(d2, rr);
  let s, t;
  const C = dot(d1, rr), B = dot(d1, d2), den = A * E - B * B;
  s = den > EPS ? clamp01((B * F - C * E) / den) : 0;
  t = E > EPS ? (B * s + F) / E : 0;
  if (t < 0) { t = 0; s = A > EPS ? clamp01(-C / A) : 0; }
  else if (t > 1) { t = 1; s = A > EPS ? clamp01((B - C) / A) : 0; }
  const c1 = add(p0, scale(d1, s)), c2 = add(a, scale(d2, t));
  const dd = sub(c1, c2);
  if (dot(dd, dd) > r * r) return null;
  // walk back to the surface entry along the segment
  const pt = add(a, scale(d2, t));
  const entry = segmentSphere(p0, p1, pt, r);
  return entry ?? s;
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.sqrt(dot(a, a));
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Advance a ballistic projectile; returns new position.
export function ballistic(p, v, g, dt) {
  const np = [p[0] + v[0] * dt, p[1] + v[1] * dt - 0.5 * g * dt * dt, p[2] + v[2] * dt];
  v[1] -= g * dt;
  return np;
}

// ---- bushes: no collision, but they block sight -------------------------------------
export function inBush(map, p) {
  for (const b of map.bushes || []) {
    const dx = p[0] - b.x, dz = p[2] - b.z;
    if (dx * dx + dz * dz < b.r * b.r * 0.8 && p[1] < b.h + 0.15) return b;
  }
  return null;
}

// true if the line of sight from eye `a` to target point `b` goes through foliage
// (including the target standing inside a bush). Close range always sees through.
export function concealed(map, a, b, seeThrough = 3.5) {
  if (!map.bushes || !map.bushes.length) return false;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < seeThrough) return false;
  const steps = Math.ceil(L / 0.5);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    if (L * t < 1.0) continue;                 // the looker's own bush doesn't blind them
    if (inBush(map, p)) return true;
  }
  return false;
}
