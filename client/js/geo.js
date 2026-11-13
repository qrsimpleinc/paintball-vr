// Small geometry helpers shared by the world and prop builders.
import * as THREE from 'three';

let seed = 7;
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const reseed = (s = 7) => { seed = s; };

// bake a flat color (with a little top/side shading) into vertex colors
export function paint(g, color, shadeSides = true) {
  const n = g.attributes.position.count, cols = new Float32Array(n * 3), normals = g.attributes.normal.array;
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const ny = normals[i * 3 + 1];
    const s = shadeSides ? (ny > 0.5 ? 1.05 : ny < -0.5 ? 0.7 : 0.92) : 1;
    cols[i * 3] = c.r * s; cols[i * 3 + 1] = c.g * s; cols[i * 3 + 2] = c.b * s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

// Box with UVs scaled to world size so textures tile at `tile` meters.
export function tbox(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return g.toNonIndexed();
}

export const place = (g, x, y, z, ry = 0, rx = 0, rz = 0) => {
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
};

export const prep = (g) => (g.index ? g.toNonIndexed() : g);
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).toNonIndexed();

// lumpy rock filling the box b (bottom flat; `flatTop` keeps the top walkable)
export function rockGeo(w, h, d, flatTop = false) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 2, 4);
  const p = g.attributes.position;
  const hash = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = Math.abs(x) / (w / 2), v = Math.abs(z) / (d / 2), t = (y + h / 2) / h;   // t: 0 bottom .. 1 top
    const n = hash(x, y, z);
    const corner = u > 0.99 && v > 0.99 ? 0.82 : 1;                                   // round off the corners
    const taper = 1 - 0.12 * t;
    x *= corner * taper * (0.92 + n * 0.08);
    z *= corner * taper * (0.92 + hash(z, x, y) * 0.08);
    if (t > 0.99 && !flatTop) y -= n * Math.min(0.25, h * 0.15) * (u + v) * 0.6;
    if (t > 0.3 && t < 0.99) y += (n - 0.5) * 0.12;
    p.setXYZ(i, x, y, z);
  }
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  return out;
}

// color each triangle by its index (stripes on cones/cylinders)
export function stripe(g, colors, every = 2) {
  const n = g.attributes.position.count, cols = new Float32Array(n * 3);
  const cs = colors.map((c) => new THREE.Color(c));
  for (let i = 0; i < n; i++) {
    const c = cs[Math.floor(Math.floor(i / 3) / every) % cs.length];
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

// helper for oriented props: local x runs along the long side of the box
export function oriented(b, out) {
  const alongX = b.w >= b.d, L = alongX ? b.w : b.d, Wd = alongX ? b.d : b.w, ry = alongX ? 0 : Math.PI / 2;
  const piece = (geo, lx, ly, lz, color, rx = 0, rz = 0, bucket = out, ryl = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const m = new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeTranslation(lx, ly, lz))
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ryl, rz)));
    g.applyMatrix4(m); g.translate(b.x, b.y || 0, b.z);
    bucket.push(color === null ? g : paint(g, color));
    return g;
  };
  return { L, Wd, piece };
}
