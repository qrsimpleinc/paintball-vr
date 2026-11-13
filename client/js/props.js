// Themes (sky, light, ground) and the props used by the newer maps: quarry rocks, trucks,
// parked cars, tanks and pipes, carnival booths, tents, a carousel, lamps and string lights,
// plus big background decor (movie screens, a Ferris wheel, a circus tent).
// Everything is original, cartoon-styled and built from simple shapes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rnd, paint, tbox, place, prep, box, rockGeo, stripe, oriented } from './geo.js';

export const THEMES = {
  day: {
    sky: [0xa3d2ef, 0xe9f1d6], fog: [0xdfeccf, 60, 190], hemi: [0xeaf4ff, 0x7c9a4a, 1.5], sun: [0xfff0d6, 2.0, [28, 48, 20]],
    ground: 'grass', meadow: 0x8dbd52, hills: 0x8fbf5a, clouds: true, trees: 'leafy', bush: 0x6fae3a,
  },
  quarry: {
    sky: [0x8fc3e6, 0xf2e2c2], fog: [0xeadbbd, 60, 190], hemi: [0xfff4e0, 0x9c8462, 1.45], sun: [0xffe8c4, 2.1, [30, 46, -16]],
    ground: 'gravel', meadow: 0xb9a27c, hills: 0xc7a57a, clouds: true, trees: 'rocky', bush: 0x8c9a3c,
  },
  dusk: {
    sky: [0x2b2a66, 0xf29a62], fog: [0x7e5f78, 45, 170], hemi: [0xd0c2ff, 0x4a3a40, 1.45], sun: [0xffa36e, 1.7, [-40, 16, 12]],
    ground: 'asphalt', meadow: 0x4c6a3a, hills: 0x3a4a3c, stars: 0.4, trees: 'pine', bush: 0x4f8a3a, lamp: 0xffd58a,
  },
  night: {
    sky: [0x081230, 0x22355e], fog: [0x18264a, 40, 160], hemi: [0x9ab2ee, 0x2a2c34, 1.05], sun: [0xc8d8ff, 1.0, [-22, 40, 26]],
    ground: 'concrete', meadow: 0x2b3a2a, hills: 0x1c2822, stars: 1, moon: true, trees: 'pine', bush: 0x3f6a34, lamp: 0xe8f0ff,
  },
  fair: {
    sky: [0x140c3a, 0x41306e], fog: [0x261c4c, 40, 160], hemi: [0xb4a6f6, 0x302a3c, 1.1], sun: [0xcfd6ff, 0.95, [24, 40, -20]],
    ground: 'grass-night', meadow: 0x34502e, hills: 0x22302a, stars: 1, moon: true, trees: 'pine', bush: 0x3f7a3a, lamp: 0xffd58a,
  },
};

const CAR_COLORS = [0xe0473c, 0x3c8de0, 0xf2c23a, 0x52b788, 0xf08a3c, 0xb06ad9, 0xe8e2d6, 0x45c4c9];
const FAIR = [0xe84a5f, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xb388eb, 0xff8fab];
const glowWhite = 0xfff4d6;

// ground light pools painted into the ground's emissive map: [x, z, radius, color]
export function propGlowPools(map) {
  const out = [];
  const lamp = THEMES[map.theme || 'day'].lamp || 0xffd58a;
  for (const b of map.boxes) {
    if (b.kind === 'lamppost') out.push([b.x, b.z, 5.5, lamp]);
    if (b.kind === 'flood') out.push([b.x * 0.85, b.z * 0.85, 9, lamp]);
    if (b.kind === 'booth') out.push([b.x, b.z, 3.2, 0xffc070]);
    if (b.kind === 'carousel') out.push([b.x, b.z, 6, 0xffd08a]);
    if (b.kind === 'kiosk') out.push([b.x, b.z, 3, 0xffd08a]);
  }
  return out;
}

// Merge every mesh under `root` (except inside `skip` groups) into one mesh per material: fewer draw calls on Quest.
function mergeByMaterial(root, skip = []) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), buckets = new Map(), remove = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (skip.includes(p)) return;
    let g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const [mat, geos] of buckets) {
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.attributes[n]));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = true;
    root.add(m);
  }
}

// ---- per-box props ---------------------------------------------------------------------------
// B: geometry buckets by material; ctx: { groups, anim, halos }
export function buildProp(b, B, ctx) {
  const y0 = b.y || 0, cy = y0 + b.h / 2;
  switch (b.kind) {
    case 'rock': case 'mesa': {
      const g = rockGeo(b.w, b.h, b.d, b.kind === 'mesa');
      g.translate(b.x, cy, b.z);
      B.leaves.push(paint(g, new THREE.Color(b.kind === 'mesa' ? 0xb79a74 : 0xa8a198).offsetHSL(0, 0, (rnd() - 0.5) * 0.08).getHex()));
      if (b.kind === 'mesa') {                  // a few loose stones on top
        for (let i = 0; i < 5; i++) {
          const s = rockGeo(0.4 + rnd() * 0.4, 0.25, 0.35 + rnd() * 0.3);
          s.translate(b.x + (rnd() - 0.5) * (b.w - 1), y0 + b.h + 0.1, b.z + (rnd() > 0.5 ? 1 : -1) * (b.d / 2 - 0.4));
          B.leaves.push(paint(s, 0x9a8f80));
        }
      }
      return true;
    }
    case 'pile': {                              // gravel heap (visual a bit wider than its box)
      const g = prep(new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.58, b.h * 1.08, 10, 2));
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.9 + Math.abs(Math.sin(i * 7.31)) * 0.15; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
      g.computeVertexNormals();
      g.translate(b.x, y0 + b.h * 0.54, b.z);
      B.leaves.push(paint(g, 0xc9b591));
      return true;
    }
    case 'block': {                             // concrete barrier with a hazard band
      B.solid.push(paint(place(tbox(b.w, b.h, b.d), b.x, cy, b.z), 0xcfcbc1));
      const alongX = b.w > b.d;
      B.solid.push(paint(place(box(b.w + 0.02, 0.16, b.d + 0.02), b.x, y0 + b.h - 0.25, b.z), 0xf2a33a));
      for (let i = -1; i <= 1; i += 2) B.solid.push(paint(place(box(alongX ? 0.18 : b.w + 0.03, 0.17, alongX ? b.d + 0.03 : 0.18), b.x + (alongX ? i * b.w * 0.25 : 0), y0 + b.h - 0.25, b.z + (alongX ? 0 : i * b.d * 0.25)), 0x2b2b2b));
      return true;
    }
    case 'barrel': {
      const r = Math.min(b.w, b.d) / 2, col = rnd() < 0.5 ? 0xd2453a : 0x3a7bd2;
      B.solid.push(paint(place(prep(new THREE.CylinderGeometry(r, r, b.h, 14)), b.x, cy, b.z), col));
      for (const yy of [0.3, 0.7]) B.solid.push(paint(place(prep(new THREE.TorusGeometry(r + 0.01, 0.025, 4, 16)), b.x, y0 + b.h * yy, b.z, 0, Math.PI / 2), 0x333333));
      return true;
    }
    case 'truck': {                             // yellow dump truck
      const { L, Wd, piece } = oriented(b, B.solid);
      piece(box(L * 0.28, 1.5, Wd * 0.9), -L * 0.34, 1.35, 0, 0xf2b51f);                        // cab
      piece(box(L * 0.27, 0.6, Wd * 0.8), -L * 0.345, 1.75, 0, 0x5b8fb8);                       // windows
      piece(box(L * 0.66, 0.25, Wd), L * 0.15, 0.85, 0, 0x3a3a3a);                              // chassis
      piece(box(L * 0.64, 1.4, Wd * 0.98), L * 0.16, 1.85, 0, 0xe6a417);                       // dump bed
      piece(box(L * 0.6, 0.05, Wd * 0.85), L * 0.16, 2.56, 0, 0x9a8a6a);                        // gravel inside
      piece(box(0.3, 0.3, Wd * 1.02), -L * 0.49, 0.75, 0, 0x555555);                            // bumper
      for (const lx of [-L * 0.33, L * 0.05, L * 0.33]) for (const s of [-1, 1]) {
        piece(new THREE.CylinderGeometry(0.55, 0.55, 0.42, 16), lx, 0.55, s * (Wd / 2 - 0.2), 0x23252a, Math.PI / 2);
        piece(new THREE.CylinderGeometry(0.25, 0.25, 0.44, 10), lx, 0.55, s * (Wd / 2 - 0.19), 0xbfbfbf, Math.PI / 2);
      }
      return true;
    }
    case 'steel':
      B.metal.push(paint(place(tbox(b.w, b.h, b.d, 1), b.x, cy, b.z), 0x6f7a86));
      return true;
    case 'beam':
      B.solid.push(paint(place(box(b.w, b.h, b.d), b.x, cy, b.z), 0xe0a92e));
      return true;
    case 'railing': {                           // steel panel with a yellow top rail
      B.metal.push(paint(place(tbox(b.w, b.h - 0.1, b.d * 0.5, 1), b.x, y0 + (b.h - 0.1) / 2, b.z), 0x8a939c));
      B.solid.push(paint(place(box(b.w + 0.02, 0.1, b.d + 0.02), b.x, y0 + b.h - 0.05, b.z), 0xf2c23a));
      return true;
    }
    case 'car': {
      const { L, Wd, piece } = oriented(b, B.solid);
      const col = CAR_COLORS[(rnd() * CAR_COLORS.length) | 0], dark = new THREE.Color(col).multiplyScalar(0.7).getHex();
      piece(box(L, 0.62, Wd), 0, 0.62, 0, col);                                                 // body
      const cab = new THREE.BoxGeometry(L * 0.48, 0.55, Wd * 0.88).toNonIndexed();
      const cp = cab.attributes.position;
      for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) cp.setX(i, cp.getX(i) * 0.75);       // sloped windows
      cab.computeVertexNormals();
      piece(cab, -L * 0.04, 1.2, 0, 0x8fc6e8);
      piece(box(L * 0.38, 0.06, Wd * 0.84), -L * 0.04, 1.49, 0, col);                          // roof
      piece(box(0.06, 0.18, Wd * 0.8), L / 2, 0.62, 0, dark);                                   // grilles
      for (const s of [-1, 1]) {
        piece(box(0.05, 0.14, 0.3), L / 2 + 0.01, 0.7, s * Wd * 0.33, glowWhite, 0, 0, B.glow);      // headlights
        piece(box(0.05, 0.12, 0.28), -L / 2 - 0.01, 0.72, s * Wd * 0.33, 0xff3a3a, 0, 0, B.glow);    // tail lights
        for (const lx of [-L * 0.3, L * 0.3]) piece(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 14), lx, 0.33, s * (Wd / 2 - 0.08), 0x202226, Math.PI / 2);
      }
      return true;
    }
    case 'speaker': {                           // drive-in speaker post
      B.solid.push(paint(place(box(0.1, b.h, 0.1), b.x, cy, b.z), 0x6c7178));
      B.solid.push(paint(place(box(0.42, 0.3, 0.2), b.x, y0 + b.h + 0.1, b.z), 0x9aa0a8));
      B.solid.push(paint(place(box(0.3, 0.2, 0.02), b.x, y0 + b.h + 0.1, b.z + 0.11), 0x2b2b2b));
      B.solid.push(paint(place(box(0.3, 0.2, 0.02), b.x, y0 + b.h + 0.1, b.z - 0.11), 0x2b2b2b));
      return true;
    }
    case 'stucco':
      B.solid.push(paint(place(box(b.w, b.h, b.d), b.x, cy, b.z), 0xf3dcb8));
      if (y0 === 0) B.solid.push(paint(place(box(b.w + 0.02, 0.3, b.d + 0.02), b.x, 0.15, b.z), 0x2f9e9a));
      return true;
    case 'roofdeck': case 'slab':
      B.solid.push(paint(place(box(b.w, b.h, b.d), b.x, cy, b.z), b.kind === 'slab' ? 0x6d6f73 : 0x9aa0a6));
      if (b.kind === 'roofdeck') B.solid.push(paint(place(box(b.w + 0.04, 0.12, b.d + 0.04), b.x, y0 + 0.06, b.z), 0xe84a5f));
      return true;
    case 'parapet':                             // low wall with a neon strip on top
      B.solid.push(paint(place(box(b.w, b.h, b.d), b.x, cy, b.z), 0x2f9e9a));
      B.glow.push(paint(place(box(b.w + 0.02, 0.06, b.d + 0.02), b.x, y0 + b.h + 0.03, b.z), 0xff6fb5, false));
      return true;
    case 'counter':
      B.solid.push(paint(place(box(b.w, b.h, b.d), b.x, cy, b.z), 0xd84a4a));
      B.solid.push(paint(place(box(b.w + 0.1, 0.06, b.d + 0.1), b.x, y0 + b.h + 0.03, b.z), 0xf5f1e8));
      for (let i = 0; i < 3; i++) B.solid.push(paint(place(prep(new THREE.CylinderGeometry(0.12, 0.09, 0.3, 8)), b.x - 0.8 + i * 0.8, y0 + b.h + 0.2, b.z), [0xffd166, 0xffffff, 0xe84a5f][i]));
      return true;
    case 'kiosk': {                             // ticket booth: striped walls, overhanging roof, lit window
      B.solid.push(paint(place(box(b.w, b.h - 0.3, b.d), b.x, y0 + (b.h - 0.3) / 2, b.z), 0xf5f1e8));
      for (const s of [-1, 1]) B.solid.push(paint(place(box(b.w + 0.02, 0.25, b.d + 0.02), b.x, y0 + 0.4 + (s + 1) * 0.5, b.z), 0xe84a5f));
      B.solid.push(paint(place(box(b.w + 0.6, 0.18, b.d + 0.6), b.x, y0 + b.h - 0.2, b.z), 0xe84a5f));
      const cone = prep(new THREE.ConeGeometry((b.w + 0.6) * 0.72, 0.6, 4));
      cone.rotateY(Math.PI / 4);
      B.solid.push(paint(place(cone, b.x, y0 + b.h + 0.18, b.z), 0xffd166));
      B.glow.push(paint(place(box(b.w * 0.7, 0.55, b.d + 0.04), b.x, y0 + 1.35, b.z), 0xffe7a8, false));
      ctx.halos.push([b.x, y0 + 1.4, b.z, 0xffd58a, 2.2]);
      return true;
    }
    case 'tank': {                              // big water tank with a dome, bands and a ladder
      const r = Math.min(b.w, b.d) / 2;
      B.metal.push(paint(place(prep(new THREE.CylinderGeometry(r, r, b.h, 28, 1, true)), b.x, cy, b.z), 0xbfd0dc));
      const dome = prep(new THREE.SphereGeometry(r, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2));
      dome.scale(1, 0.3, 1);
      B.solid.push(paint(place(dome, b.x, y0 + b.h, b.z), 0x9fb2c0));
      for (let yy = 0.8; yy < b.h; yy += 1.4) B.solid.push(paint(place(prep(new THREE.TorusGeometry(r + 0.02, 0.05, 5, 32)), b.x, y0 + yy, b.z, 0, Math.PI / 2), 0x5f7180));
      const n = Math.floor(b.h / 0.4);
      for (let i = 0; i < n; i++) B.solid.push(paint(place(box(0.05, 0.05, 0.5), b.x - r - 0.08, y0 + 0.3 + i * 0.4, b.z), 0x4a4f55));
      for (const dz of [-0.25, 0.25]) B.solid.push(paint(place(box(0.05, b.h, 0.05), b.x - r - 0.08, cy, b.z + dz), 0x4a4f55));
      return true;
    }
    case 'pipe': {                              // big pipe lying on the ground, with flanges and saddles
      const { L, Wd, piece } = oriented(b, B.solid);
      const r = Math.min(Wd, b.h) / 2;
      piece(new THREE.CylinderGeometry(r * 0.92, r * 0.92, L, 18), 0, r, 0, 0x3f9a8a, 0, Math.PI / 2, B.metal);
      for (let o = -L / 2 + 0.2; o <= L / 2 - 0.1; o += Math.max(1, (L - 0.4) / Math.max(1, Math.round(L / 3)))) {
        piece(new THREE.CylinderGeometry(r, r, 0.16, 18), o, r, 0, 0x2f7a6c, 0, Math.PI / 2);
      }
      piece(new THREE.TorusGeometry(0.28, 0.04, 6, 16), 0, b.h + 0.2, 0, 0xd2453a, Math.PI / 2);   // a valve wheel
      piece(box(0.06, 0.25, 0.06), 0, b.h + 0.05, 0, 0x555555);
      return true;
    }
    case 'brick':
      B.brick.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), 0xffffff));
      return true;
    case 'machine': {                           // generator: green housing with vents and an exhaust
      B.solid.push(paint(place(box(b.w, b.h, b.d), b.x, cy, b.z), 0x4f8a5a));
      for (let i = 0; i < 5; i++) B.solid.push(paint(place(box(0.05, b.h * 0.5, b.d + 0.02), b.x - b.w / 2 + 0.4 + i * 0.15, cy, b.z), 0x2f5a3a));
      B.solid.push(paint(place(prep(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8)), b.x + b.w * 0.3, y0 + b.h + 0.4, b.z), 0x444444));
      B.glow.push(paint(place(box(0.12, 0.12, 0.02), b.x + b.w * 0.3, y0 + b.h * 0.7, b.z + b.d / 2 + 0.01), 0x4dff7a, false));
      return true;
    }
    case 'lamppost': {
      B.solid.push(paint(place(prep(new THREE.CylinderGeometry(0.07, 0.1, b.h, 8)), b.x, cy, b.z), 0x2f3a36));
      B.solid.push(paint(place(prep(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 8)), b.x, 0.15, b.z), 0x2f3a36));
      B.solid.push(paint(place(prep(new THREE.ConeGeometry(0.32, 0.25, 8)), b.x, y0 + b.h + 0.5, b.z), 0x2f3a36));
      B.glow.push(paint(place(prep(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 8)), b.x, y0 + b.h + 0.2, b.z), 0xfff1c2, false));
      ctx.halos.push([b.x, y0 + b.h + 0.2, b.z, ctx.theme.lamp || 0xffd58a, 2.4]);
      return true;
    }
    case 'flood': {                             // floodlight tower: two lamp heads aimed at the middle
      B.solid.push(paint(place(box(0.2, b.h, 0.2), b.x, cy, b.z), 0x7d858f));
      const ry = Math.atan2(-b.x, -b.z);
      const bar = place(box(1.6, 0.12, 0.12), 0, 0, 0, ry); bar.translate(b.x, y0 + b.h, b.z);
      B.solid.push(paint(bar, 0x7d858f));
      for (const s of [-0.55, 0.55]) {
        const ox = Math.cos(ry) * s, oz = -Math.sin(ry) * s;
        const head = place(box(0.5, 0.42, 0.25), 0, 0, 0, ry, -0.5); head.translate(b.x + ox, y0 + b.h + 0.25, b.z + oz);
        B.solid.push(paint(head, 0x4a4f55));
        const lens = place(box(0.42, 0.34, 0.04), 0, 0, 0, ry, -0.5); lens.translate(b.x + ox + Math.sin(ry) * 0.14, y0 + b.h + 0.25, b.z + oz + Math.cos(ry) * 0.14);
        B.glow.push(paint(lens, 0xf4f8ff, false));
        ctx.halos.push([b.x + ox + Math.sin(ry) * 0.2, y0 + b.h + 0.22, b.z + oz + Math.cos(ry) * 0.2, 0xe8f0ff, 3]);
      }
      return true;
    }
    case 'carousel': {
      const r = Math.min(b.w, b.d) / 2 / Math.cos(Math.PI / 8);   // octagon whose flat sides match the box
      const deck = prep(new THREE.CylinderGeometry(r, r, b.h, 8));
      deck.rotateY(Math.PI / 8);
      B.solid.push(paint(place(deck, b.x, cy, b.z), 0xf5e6c8));
      const rim = prep(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.12, 8)); rim.rotateY(Math.PI / 8);
      B.solid.push(stripe(place(rim, b.x, y0 + b.h - 0.08, b.z), [0xe84a5f, 0xffd166], 2));
      // the turning part: canopy, horses on poles, lights
      const spin = new THREE.Group();
      spin.position.set(b.x, y0 + b.h, b.z);
      const canopy = new THREE.Mesh(stripe(prep(new THREE.ConeGeometry(r + 0.4, 1.3, 16, 1, true)), [0xe84a5f, 0xf5f1e8]),
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      canopy.position.y = 3.75; spin.add(canopy);
      const valance = new THREE.Mesh(stripe(prep(new THREE.CylinderGeometry(r + 0.4, r + 0.4, 0.35, 16, 1, true)), [0xffd166, 0xe84a5f]),
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      valance.position.y = 2.95; spin.add(valance);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), bulbMat);
        bulb.position.set(Math.cos(a) * (r + 0.42), 2.8, Math.sin(a) * (r + 0.42)); spin.add(bulb);
      }
      const horses = [];
      const gold = new THREE.MeshLambertMaterial({ color: 0xe8c25a });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, hr = r * 0.66;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.3, 6), gold);
        pole.position.set(Math.cos(a) * hr, 1.65, Math.sin(a) * hr); spin.add(pole);
        const horse = makeHorse(FAIR[i % FAIR.length]);
        horse.position.set(Math.cos(a) * hr, 1.0, Math.sin(a) * hr);
        horse.rotation.y = -a;
        spin.add(horse);
        horses.push({ horse, phase: i * 1.1 });
      }
      for (const h of horses) mergeByMaterial(h.horse);
      mergeByMaterial(spin, horses.map((h) => h.horse));
      ctx.groups.push(spin);
      let t = 0;
      ctx.anim.push((dt) => {
        t += dt; spin.rotation.y += dt * 0.35;
        for (const h of horses) h.horse.position.y = 1.0 + Math.sin(t * 2 + h.phase) * 0.18;
      });
      ctx.halos.push([b.x, y0 + b.h + 3.2, b.z, 0xffd08a, 7]);
      return true;
    }
    case 'carouselpole': {                      // mirrored center column
      B.solid.push(paint(place(prep(new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.h, 12)), b.x, cy, b.z), 0xe8c25a));
      for (let i = 0; i < 8; i++) {
        const m = place(box(0.02, 0.4, 0.5), b.x + Math.cos(i * 0.785) * (b.w / 2 + 0.01), y0 + 1.2, b.z + Math.sin(i * 0.785) * (b.w / 2 + 0.01), -i * 0.785);
        B.glow.push(paint(m, i % 2 ? 0xffe9a8 : 0xff9ec1, false));
      }
      return true;
    }
    case 'booth': {                             // game stall counter + posts + striped awning + bulbs
      const alongX = b.w >= b.d, s = b.dir[0] === '+' ? 1 : -1;
      const L = alongX ? b.w : b.d, col = FAIR[Math.abs(Math.round(b.x * 3 + b.z)) % FAIR.length];
      B.wood.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), 0xd9a86a));
      B.solid.push(paint(place(box(b.w + 0.08, 0.08, b.d + 0.08), b.x, y0 + b.h + 0.04, b.z), col));
      // footprint covers counter + back panel: center is 0.4 behind the counter
      const fx = b.x - (alongX ? 0 : s * 0.4), fz = b.z - (alongX ? s * 0.4 : 0);
      const fw = alongX ? L : 1.6, fd = alongX ? 1.6 : L;
      for (const k of [-1, 1]) {
        const px = alongX ? b.x + k * (L / 2 - 0.06) : b.x + s * 0.34, pz = alongX ? b.z + s * 0.34 : b.z + k * (L / 2 - 0.06);
        B.solid.push(paint(place(box(0.1, 2.5, 0.1), px, 1.25, pz), 0xf5f1e8));
      }
      const n = 8;
      for (let i = 0; i < n; i++) {
        const o = -L / 2 + (i + 0.5) * (L / n);
        const strip = box(alongX ? L / n : fw + 0.5, 0.06, alongX ? fd + 0.5 : L / n);
        place(strip, alongX ? fx + o : fx + s * 0.25, 2.6, alongX ? fz + s * 0.25 : fz + o, 0, alongX ? s * 0.22 : 0, alongX ? 0 : -s * 0.22);
        B.solid.push(paint(strip, i % 2 ? 0xf5f1e8 : col, false));
      }
      for (let i = 0; i <= 6; i++) {
        const o = -L / 2 + (i / 6) * L;
        B.glow.push(paint(place(prep(new THREE.SphereGeometry(0.06, 6, 4)), alongX ? b.x + o : b.x + s * 0.7, 2.38, alongX ? b.z + s * 0.7 : b.z + o), 0xfff1b0, false));
      }
      return true;
    }
    case 'boothback': {                         // back wall with shelves of prizes
      const alongX = b.w >= b.d, s = b.dir[0] === '+' ? 1 : -1, L = alongX ? b.w : b.d;
      B.wood.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), 0xb77d48));
      for (const yy of [1.3, 1.85]) {
        for (let i = 0; i < 5; i++) {
          const o = -L / 2 + 0.35 + i * ((L - 0.7) / 4);
          const g = prep(new THREE.IcosahedronGeometry(0.15 + rnd() * 0.06, 1));
          B.solid.push(paint(place(g, alongX ? b.x + o : b.x + s * (b.w / 2 + 0.12), yy, alongX ? b.z + s * (b.d / 2 + 0.12) : b.z + o), FAIR[(i + (yy > 1.5 ? 2 : 0)) % FAIR.length], false));
        }
      }
      return true;
    }
    case 'tent': {                              // striped square tent with a pointed roof and a flag
      const wallH = b.h * 0.65;
      const walls = prep(new THREE.CylinderGeometry(b.w * 0.7071, b.w * 0.7071, wallH, 4, 1, true));
      walls.rotateY(Math.PI / 4);
      B.solid.push(paint(place(walls, b.x, y0 + wallH / 2, b.z), 0xf5f1e8));
      for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) {   // red stripes on each side
        const side = i, o = -b.w / 2 + (k + 0.5) * (b.w / 4);
        const nx = [1, -1, 0, 0][side], nz = [0, 0, 1, -1][side];
        const g = box(nx ? 0.02 : b.w / 8, wallH, nz ? 0.02 : b.w / 8);
        B.solid.push(paint(place(g, b.x + nx * (b.w / 2 + 0.01) + (nz ? o : 0), y0 + wallH / 2, b.z + nz * (b.d / 2 + 0.01) + (nx ? o : 0)), 0xe84a5f));
      }
      const roof = prep(new THREE.ConeGeometry(b.w * 0.78, b.h * 0.8, 4));
      roof.rotateY(Math.PI / 4);
      B.solid.push(stripe(place(roof, b.x, y0 + wallH + b.h * 0.4, b.z), [0xe84a5f, 0xffd166], 1));
      B.solid.push(paint(place(box(0.04, 0.6, 0.04), b.x, y0 + wallH + b.h * 0.8 + 0.3, b.z), 0x555555));
      const flag = new THREE.BufferGeometry();
      flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.25, 0, 0.45, -0.12, 0], 3));
      flag.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0.5], 2));
      flag.computeVertexNormals();
      B.solid.push(paint(place(flag, b.x, y0 + wallH + b.h * 0.8 + 0.6, b.z), 0x06d6a0, false));
      // dark doorway on the side facing the middle
      const fx = b.x < 0 ? 1 : -1;
      B.solid.push(paint(place(box(0.03, wallH * 0.75, 1.0), b.x + fx * (b.w / 2 + 0.03), y0 + wallH * 0.375, b.z), 0x3a2a3a));
      return true;
    }
    case 'pad':                                 // padded barrier
      B.solid.push(paint(place(box(b.w, b.h, b.d), b.x, cy, b.z), 0x3a6fd8));
      B.solid.push(paint(place(box(b.w + 0.04, 0.12, b.d + 0.04), b.x, y0 + b.h - 0.06, b.z), 0xffd166));
      return true;
    case 'bumpercar': {
      const { L, Wd, piece } = oriented(b, B.solid);
      const col = FAIR[Math.abs(Math.round(b.x * 7 + b.z * 3)) % FAIR.length];
      piece(box(L + 0.1, 0.2, Wd + 0.1), 0, 0.15, 0, 0x2b2b2b);
      piece(box(L, 0.45, Wd), 0, 0.45, 0, col);
      piece(box(L * 0.3, 0.35, Wd * 0.8), -L * 0.25, 0.85, 0, new THREE.Color(col).multiplyScalar(0.75).getHex());
      piece(box(0.04, 1.6, 0.04), -L * 0.42, 1.4, 0, 0x777777);
      piece(box(0.12, 0.12, 0.12), -L * 0.42, 2.2, 0, 0xfff1b0, 0, 0, B.glow);
      return true;
    }
    default:
      return false;
  }
}

function makeHorse(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0xf5f1e8 }), c = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 3, 8), m); body.rotation.z = Math.PI / 2; g.add(body);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), m); neck.position.set(0.32, 0.22, 0); neck.rotation.z = -0.5; g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.14), m); head.position.set(0.45, 0.4, 0); head.rotation.z = -0.3; g.add(head);
  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.16), c); mane.position.set(0.26, 0.28, 0); mane.rotation.z = -0.5; g.add(mane);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.36), c); saddle.position.set(-0.02, 0.17, 0); g.add(saddle);
  for (const [x, z, r] of [[0.22, 0.08, 0.7], [0.22, -0.08, 0.3], [-0.22, 0.08, -0.6], [-0.22, -0.08, -0.2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), m); leg.position.set(x, -0.2, z); leg.rotation.z = r; g.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), c); tail.position.set(-0.36, 0.0, 0); tail.rotation.z = 0.6; g.add(tail);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---- map edge for cliff (quarry) and chain-link (pump station) boundaries -------------------------
export function buildEdge(b, B) {
  if (b.kind === 'cliff') {                      // rock wall made of chunks, pushed outward so its face is at the edge
    const alongX = b.w > b.d, L = alongX ? b.w : b.d;
    const out = alongX ? Math.sign(b.z) : Math.sign(b.x);
    for (let o = -L / 2 - 2; o < L / 2 + 2;) {
      const cw = 3 + rnd() * 3, th = 3 + rnd() * 2, hh = b.h + rnd() * 3;
      const g = rockGeo(alongX ? cw : th, hh, alongX ? th : cw);
      const c = o + cw / 2, off = th / 2 - 0.1;
      g.translate(alongX ? b.x + c : b.x + out * off, hh / 2, alongX ? b.z + out * off : b.z + c);
      B.leaves.push(paint(g, new THREE.Color(0xb59a76).offsetHSL(0, 0, (rnd() - 0.5) * 0.1).getHex()));
      o += cw * 0.8;
    }
    return true;
  }
  if (b.kind === 'chainlink') {
    const alongX = b.w > b.d, L = alongX ? b.w : b.d;
    const mesh = new THREE.PlaneGeometry(L, b.h);
    const uv = mesh.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 0.6, uv.getY(i) * b.h / 0.6);
    if (!alongX) mesh.rotateY(Math.PI / 2);
    mesh.translate(b.x, b.h / 2, b.z);
    B.chain.push(paint(mesh.toNonIndexed(), 0xc7ced6, false));
    const n = Math.round(L / 3);
    for (let i = 0; i <= n; i++) {
      const o = -L / 2 + (i / n) * L;
      B.solid.push(paint(place(prep(new THREE.CylinderGeometry(0.05, 0.05, b.h + 0.2, 6)), alongX ? b.x + o : b.x, (b.h + 0.2) / 2, alongX ? b.z : b.z + o), 0x8a929b));
    }
    const rail = prep(new THREE.CylinderGeometry(0.035, 0.035, L, 6));
    rail.rotateZ(Math.PI / 2); if (!alongX) rail.rotateY(Math.PI / 2);
    B.solid.push(paint(place(rail, b.x, b.h, b.z), 0x8a929b));
    return true;
  }
  return false;
}

// ---- trees and rocks outside the field ----------------------------------------------------------
export function buildTrees(map, B, kind) {
  const spots = [];
  const tryAdd = (x, z, gap) => {
    if (Math.abs(x) < map.halfX + 2 && Math.abs(z) < map.halfZ + 2) return;
    for (const t of spots) if (Math.hypot(t[0] - x, t[1] - z) < gap) return;
    spots.push([x, z]);
  };
  const want = kind === 'rocky' ? 50 : 150, pad = kind === 'rocky' ? 8 : 3;
  for (let i = 0; i < 1200 && spots.length < want; i++) {
    const a = rnd() * Math.PI * 2, d = 1 + rnd() * 0.6;
    tryAdd(Math.cos(a) * (map.halfX + pad) * d * 1.05, Math.sin(a) * (map.halfZ + pad) * d * 1.25, kind === 'rocky' ? 5 : 3);
  }
  for (const [x, z] of spots) {
    if (kind === 'rocky' && rnd() < 0.55) {
      const s = 2 + rnd() * 4, hh = s * (0.5 + rnd() * 0.6), g = rockGeo(s, hh, s * (0.8 + rnd() * 0.4));
      g.translate(x, hh / 2 - 0.2, z);
      B.leaves.push(paint(g, new THREE.Color(0xb59a76).offsetHSL(0, 0, (rnd() - 0.5) * 0.1).getHex()));
      continue;
    }
    // pine: trunk + three stacked cones
    const h = 4 + rnd() * 4;
    B.solid.push(paint(place(prep(new THREE.CylinderGeometry(0.12, 0.2, h * 0.4, 6)), x, h * 0.2, z), 0x5a3d26));
    const base = new THREE.Color(kind === 'rocky' ? 0x5f8a3a : 0x2f5a3a).offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
    for (let k = 0; k < 3; k++) {
      const r = h * (0.32 - k * 0.07), ch = h * (0.42 - k * 0.06);
      B.leaves.push(paint(place(prep(new THREE.ConeGeometry(r, ch, 7)), x, h * (0.35 + k * 0.2) + ch / 2, z, rnd()), base.clone().offsetHSL(0, 0, k * 0.03).getHex(), false));
    }
  }
}

// ---- string lights between poles: [x1, z1, y1, x2, z2, y2] -----------------------------------
export function buildStrings(map, scene, multicolor) {
  const pts = [], bulbs = [];
  for (const [x1, z1, y1, x2, z2, y2] of map.strings || []) {
    const L = Math.hypot(x2 - x1, z2 - z1), n = Math.max(6, Math.round(L / 0.8)), sag = Math.min(1.2, L * 0.06);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = new THREE.Vector3(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * sag, z1 + (z2 - z1) * t);
      if (prev) pts.push(prev, p);
      prev = p;
      if (i > 0 && i < n) bulbs.push(p.clone().setY(p.y - 0.07));
    }
  }
  if (!pts.length) return;
  const wire = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222 }));
  scene.add(wire);
  const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  bulbs.forEach((p, i) => {
    m.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m);
    inst.setColorAt(i, c.setHex(multicolor ? FAIR[i % FAIR.length] : 0xffe6a0));
  });
  scene.add(inst);
}

// ---- big background pieces outside the fence ------------------------------------------------------
export function buildDecor(map, scene, anim) {
  for (const d of map.decor || []) {
    if (d.type === 'screen') scene.add(movieScreen(d));
    if (d.type === 'ferris') { const { group, update } = ferrisWheel(d); scene.add(group); anim.push(update); }
    if (d.type === 'bigtop') scene.add(bigTop(d));
  }
}

let screenTexCache = null;
function screenTexture() {              // an original "space adventure" picture for the screen
  if (screenTexCache) return screenTexCache;
  const c = document.createElement('canvas'); c.width = 512; c.height = 230;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 230); g.addColorStop(0, '#0b1a4a'); g.addColorStop(1, '#3a2a7a');
  x.fillStyle = g; x.fillRect(0, 0, 512, 230);
  for (let i = 0; i < 140; i++) { x.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`; x.fillRect(Math.random() * 512, Math.random() * 230, 2, 2); }
  x.fillStyle = '#ff9f43'; x.beginPath(); x.arc(370, 120, 55, 0, 7); x.fill();
  x.strokeStyle = '#ffd166'; x.lineWidth = 8; x.beginPath(); x.ellipse(370, 120, 92, 20, -0.25, 0, 7); x.stroke();
  x.fillStyle = '#6fd3ff'; x.beginPath(); x.arc(90, 60, 18, 0, 7); x.fill();
  // little cartoon rocket with a flame
  x.save(); x.translate(170, 150); x.rotate(-0.6);
  x.fillStyle = '#ffffff'; x.beginPath(); x.ellipse(0, 0, 40, 14, 0, 0, 7); x.fill();
  x.fillStyle = '#ff5d73'; x.beginPath(); x.moveTo(40, 0); x.lineTo(24, -12); x.lineTo(24, 12); x.fill();
  x.fillRect(-40, -20, 14, 8); x.fillRect(-40, 12, 14, 8);
  x.fillStyle = '#4cc9f0'; x.beginPath(); x.arc(8, 0, 6, 0, 7); x.fill();
  x.fillStyle = '#ffd166'; x.beginPath(); x.moveTo(-40, -8); x.lineTo(-75, 0); x.lineTo(-40, 8); x.fill();
  x.restore();
  screenTexCache = new THREE.CanvasTexture(c); screenTexCache.colorSpace = THREE.SRGBColorSpace;
  return screenTexCache;
}

function movieScreen(d) {
  const g = new THREE.Group();
  const frame = new THREE.MeshLambertMaterial({ color: 0x5a5f6a });
  const W = 22, H = 10, y = 4;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: screenTexture(), fog: false }));
  panel.position.set(0, y + H / 2, 0.2);
  g.add(panel);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 1, H + 1, 0.3), frame); back.position.set(0, y + H / 2, 0); g.add(back);
  for (const sx of [-W / 2 + 2, -3, 3, W / 2 - 2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, y + H, 0.5), frame); leg.position.set(sx, (y + H) / 2, -0.6); g.add(leg);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.25, y + 2, 0.25), frame); brace.position.set(sx, (y + 2) / 2, -2.2); brace.rotation.x = -0.35; g.add(brace);
  }
  const bulbs = new THREE.MeshBasicMaterial({ color: 0xffe6a0 });
  for (let i = 0; i <= 22; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), bulbs); b.position.set(-W / 2 - 0.5 + i * ((W + 1) / 22), y - 0.55, 0.2); g.add(b);
  }
  mergeByMaterial(g);
  g.position.set(d.x, 0, d.z);
  g.rotation.y = d.face > 0 ? 0 : Math.PI;
  return g;
}

function ferrisWheel(d) {
  const group = new THREE.Group();
  const R = 10, hub = R + 2.5;
  const steel = new THREE.MeshLambertMaterial({ color: 0xe8e2f0 });
  for (const sz of [-1.6, 1.6]) for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, hub + 1, 0.4), steel);
    leg.position.set(sx * 3.4, hub / 2, sz); leg.rotation.z = -sx * 0.27; group.add(leg);
  }
  const wheel = new THREE.Group(); wheel.position.set(0, hub, 0); group.add(wheel);
  for (const z of [-0.9, 0.9]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.12, 6, 48), steel); rim.position.z = z; wheel.add(rim);
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.08, R, 0.08), steel);
      sp.position.set(Math.cos((i / 16) * Math.PI * 2) * R / 2, Math.sin((i / 16) * Math.PI * 2) * R / 2, z);
      sp.rotation.z = (i / 16) * Math.PI * 2 - Math.PI / 2; wheel.add(sp);
    }
  }
  const bulbGeo = new THREE.SphereGeometry(0.14, 6, 4);
  const bulbMats = FAIR.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const b = new THREE.Mesh(bulbGeo, bulbMats[i % bulbMats.length]); b.position.set(Math.cos(a) * R, Math.sin(a) * R, 1.05); wheel.add(b);
  }
  const cars = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const car = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), new THREE.MeshLambertMaterial({ color: FAIR[i % FAIR.length] }));
    cab.position.y = -1.0; car.add(cab);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.5, 4), new THREE.MeshLambertMaterial({ color: 0xf5f1e8 }));
    roof.rotation.y = Math.PI / 4; roof.position.y = -0.2; car.add(roof);
    car.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(car); cars.push(car);
  }
  const center = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.4, 12), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  center.rotation.x = Math.PI / 2; wheel.add(center);
  for (const c of cars) mergeByMaterial(c);
  mergeByMaterial(wheel, cars);
  mergeByMaterial(group, [wheel]);
  group.position.set(d.x, 0, d.z);
  return { group, update: (dt) => { wheel.rotation.z += dt * 0.12; for (const c of cars) c.rotation.z = -wheel.rotation.z; } };
}

function bigTop(d) {
  const g = new THREE.Group();
  const R = 11, wallH = 4.5;
  const wall = new THREE.Mesh(stripe(prep(new THREE.CylinderGeometry(R, R, wallH, 24, 1, true)), [0xe84a5f, 0xf5f1e8]),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  wall.position.y = wallH / 2; g.add(wall);
  const roof = new THREE.Mesh(stripe(prep(new THREE.ConeGeometry(R + 0.8, 7, 24, 1, true)), [0xe84a5f, 0xffd166]),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  roof.position.y = wallH + 3.5; g.add(roof);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.5, 6), new THREE.MeshLambertMaterial({ color: 0x777777 }));
  pole.position.y = wallH + 8; g.add(pole);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), bulbMat); b.position.set(Math.cos(a) * (R + 0.1), wallH, Math.sin(a) * (R + 0.1)); g.add(b);
  }
  mergeByMaterial(g);
  g.position.set(d.x, 0, d.z);
  return g;
}
