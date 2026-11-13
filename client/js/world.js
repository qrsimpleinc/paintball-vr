// Map rendering in a bright, soft-lit cartoon style, plus pooled effects: paint
// splats, paintball streaks, droplets, grenades and explosions.
// Static geometry is merged per material (a handful of draw calls) to stay fast on Quest.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAINT_GRAVITY, TEAM_COLORS, WEAPONS, W } from '/shared/constants.js';
import { raycastWorld, ballistic } from '/shared/physics.js';
import { makeGrenade, makeMine } from './models.js';
import { woodTex, hayTex, containerTex, groundTex, glowTex, brickTex, chainTex, splatTex } from './textures.js';
import { rnd, reseed, paint, tbox, place, prep } from './geo.js';
import { THEMES, buildProp, buildEdge, buildDecor, buildStrings, buildTrees, propGlowPools } from './props.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(),
  tmpS = new THREE.Vector3(), tmpC = new THREE.Color(), Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);

const CONTAINER_TINT = [0xe8a23a, 0x3fa7c9];      // per team side
const FOLIAGE = [0xe0782f, 0xd45a2a, 0xeea23c, 0xa9cc3d, 0x7fb83a, 0x5f9e35];


// "KO!" badge: team-colored paint splat, white outline, bold white letters.
const koCache = new Map();
function koTexture(team) {
  if (koCache.has(team)) return koCache.get(team);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const blob = () => {
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2, r = 92 + (i % 2 ? 14 : -4) + Math.sin(i * 2.3) * 6;
      const x = 128 + Math.cos(a) * r, y = 124 + Math.sin(a) * r * 0.86;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  blob(); ctx.lineWidth = 18; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = '#' + TEAM_COLORS[team].toString(16).padStart(6, '0'); ctx.fill();
  // drips
  for (const [x, h] of [[96, 34], [150, 46], [176, 24]]) {
    ctx.beginPath(); ctx.roundRect(x - 9, 190, 18, h, 9); ctx.fill();
    ctx.beginPath(); ctx.arc(x, 190 + h, 11, 0, 7); ctx.fill();
  }
  ctx.font = '900 92px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText('KO!', 128, 128);
  ctx.fillStyle = '#ffffff'; ctx.fillText('KO!', 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  koCache.set(team, t);
  return t;
}
let hitTag = null;
function hitTagTexture() {
  if (hitTag) return hitTag;
  const c = document.createElement('canvas'); c.width = 256; c.height = 112;
  const ctx = c.getContext('2d');
  ctx.font = '900 78px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(40,30,0,0.7)'; ctx.strokeText('HIT!', 128, 58);
  ctx.fillStyle = '#ffe14a'; ctx.fillText('HIT!', 128, 58);
  hitTag = new THREE.CanvasTexture(c); hitTag.colorSpace = THREE.SRGBColorSpace;
  return hitTag;
}

export class World {
  constructor(scene, map, renderer) {
    // everything the world creates lives under one root group, so a map change can drop it all
    this.realScene = scene;
    this.scene = new THREE.Group();
    scene.add(this.scene);
    this.map = map;
    this.theme = THEMES[map.theme || 'day'];
    this.renderer = renderer;
    this.anim = [];
    reseed(7);
    this.buildSky();
    this.buildStatic();
    this.buildPools();
    this.grenades = new Map();
    this.flashes = [];
    this.kos = [];
    this.mines = new Map();
  }

  // ---- sky, hills, clouds -------------------------------------------------------------
  buildSky() {
    const { scene } = this;
    const T = this.theme;
    const horizon = new THREE.Color(T.sky[1]), top = new THREE.Color(T.sky[0]);
    this.realScene.background = horizon;
    this.realScene.fog = new THREE.Fog(T.fog[0], T.fog[1], T.fog[2]);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: top }, horizon: { value: horizon } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0); }',
    }));
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;

    const hills = [], clouds = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.3, d = 95 + rnd() * 30, r = 28 + rnd() * 26;
      const g = prep(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
      g.scale(1.4, 0.32 + rnd() * 0.18, 1);
      place(g, Math.cos(a) * d, -2, Math.sin(a) * d, -a);
      hills.push(paint(g, new THREE.Color(T.hills).offsetHSL(rnd() * 0.04 - 0.02, 0, rnd() * 0.08 - 0.04).getHex(), false));
    }
    for (let i = 0; i < (T.clouds ? 12 : 0); i++) {
      const a = rnd() * Math.PI * 2, d = 110 + rnd() * 40, y = 38 + rnd() * 20;
      for (let k = 0; k < 4; k++) {
        const g = prep(new THREE.IcosahedronGeometry(6 + rnd() * 5, 1));
        g.scale(1.6, 0.6, 1);
        g.translate(Math.cos(a) * d + (k - 1.5) * 7, y + rnd() * 3, Math.sin(a) * d + rnd() * 4);
        clouds.push(paint(g, 0xffffff, false));
      }
    }
    scene.add(new THREE.Mesh(mergeGeometries(hills), new THREE.MeshLambertMaterial({ vertexColors: true })));
    if (clouds.length) scene.add(new THREE.Mesh(mergeGeometries(clouds), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92 })));
    if (T.stars) {
      const pos = [];
      for (let i = 0; i < 700; i++) {
        const a = rnd() * Math.PI * 2, e = 0.12 + Math.asin(rnd()) * 0.95;
        pos.push(Math.cos(a) * Math.cos(e) * 170, Math.sin(e) * 170, Math.sin(a) * Math.cos(e) * 170);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: T.stars })));
    }
    if (T.moon) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      const gr = x.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(220,230,255,0.5)'); gr.addColorStop(1, 'rgba(220,230,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      x.fillStyle = '#f4f2e6'; x.beginPath(); x.arc(64, 64, 26, 0, 7); x.fill();
      x.fillStyle = 'rgba(180,180,170,0.5)'; for (const [cx, cy, r] of [[56, 58, 6], [72, 70, 4], [66, 52, 3]]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
      const dir = new THREE.Vector3(...T.sun[2]).normalize();
      moon.position.copy(dir.multiplyScalar(160)); moon.scale.setScalar(26);
      scene.add(moon);
    }
  }

  // ---- map ----------------------------------------------------------------------------------
  buildStatic() {
    const { map, scene } = this;

    const T = this.theme;
    scene.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
    const sun = new THREE.DirectionalLight(T.sun[0], T.sun[1]);
    sun.position.set(...T.sun[2]);
    sun.target.position.set(0, 0, 0);
    const big = /OculusBrowser|Quest/.test(navigator.userAgent) ? 2048 : 4096;
    sun.shadow.mapSize.set(big, big);
    Object.assign(sun.shadow.camera, { left: -(map.halfX + 6), right: map.halfX + 6, top: map.halfZ + 10, bottom: -(map.halfZ + 10), near: 1, far: 140 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;

    const wood = [], hay = [], metal = [], solid = [], leaves = [], glow = [], brick = [], chain = [];
    const B = { wood, hay, metal, solid, leaves, glow, brick, chain };
    const ctx = { groups: [], anim: this.anim, halos: [], theme: T };
    const woodTone = (base = 0xc7905a) => new THREE.Color(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.08).getHex();

    for (const b of map.boxes) {
      const cy = b.y + b.h / 2;
      if (buildProp(b, B, ctx) || buildEdge(b, B)) continue;
      switch (b.kind) {
        case 'plank': case 'deck': case 'lumber':
          wood.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), woodTone(b.kind === 'lumber' ? 0xd9a86a : 0xb77d48)));
          break;
        case 'post':
          wood.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), woodTone(0x8a5a33)));
          break;
        case 'crate':
          wood.push(paint(place(tbox(b.w, b.h, b.d, 1), b.x, cy, b.z), woodTone(0xdcaa6b)));
          for (const yy of [b.y + 0.04, b.y + b.h - 0.04])
            wood.push(paint(place(tbox(b.w + 0.03, 0.08, b.d + 0.03, 1), b.x, yy, b.z), 0x9a6a3c));
          break;
        case 'fence': {
          // boundary: plank wall plus posts every ~2.5 m
          wood.push(paint(place(tbox(b.w, b.h, b.d, 1.4), b.x, cy, b.z), woodTone(0xa8723f)));
          const along = b.w > b.d ? 'x' : 'z', L = Math.max(b.w, b.d), n = Math.round(L / 2.5);
          for (let i = 0; i <= n; i++) {
            const o = -L / 2 + (i / n) * L;
            wood.push(paint(place(tbox(0.22, b.h + 0.25, 0.22, 1.2), along === 'x' ? b.x + o : b.x, (b.h + 0.25) / 2, along === 'z' ? b.z + o : b.z), 0x7a4d2b));
          }
          break;
        }
        case 'hay': {
          hay.push(paint(place(tbox(b.w, b.h, b.d, 1), b.x, cy, b.z), new THREE.Color(0xffffff).offsetHSL(0, 0, -rnd() * 0.06).getHex()));
          const long = b.w > b.d;
          for (const s of [-0.28, 0.28]) {
            const L = long ? b.w : b.d;
            const sx = long ? b.x + s * L : b.x, sz = long ? b.z : b.z + s * L;
            solid.push(paint(place(new THREE.BoxGeometry(long ? 0.06 : b.w + 0.02, b.h + 0.02, long ? b.d + 0.02 : 0.06).toNonIndexed(), sx, cy, sz), 0x8b2b22));
          }
          break;
        }
        case 'container': {
          const tint = CONTAINER_TINT[b.team ?? (b.x < 0 ? 0 : 1)];
          metal.push(paint(place(tbox(b.w, b.h, b.d, 2.4), b.x, cy, b.z), tint));
          // darker frame along the edges
          const fr = 0.12, dark = new THREE.Color(tint).multiplyScalar(0.65).getHex();
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
            solid.push(paint(place(new THREE.BoxGeometry(fr, b.h + 0.02, fr).toNonIndexed(), b.x + sx * (b.w / 2), cy, b.z + sz * (b.d / 2)), dark));
          for (const yy of [b.y + 0.05, b.y + b.h - 0.05]) {
            solid.push(paint(place(new THREE.BoxGeometry(b.w + 0.02, fr, fr).toNonIndexed(), b.x, yy, b.z - b.d / 2), dark));
            solid.push(paint(place(new THREE.BoxGeometry(b.w + 0.02, fr, fr).toNonIndexed(), b.x, yy, b.z + b.d / 2), dark));
          }
          break;
        }
        case 'spool': {
          const r = Math.min(b.w, b.d) / 2;
          wood.push(paint(place(prep(new THREE.CylinderGeometry(r, r, 0.08, 18)), b.x, b.y + b.h - 0.04, b.z), woodTone(0xd29b5e)));
          wood.push(paint(place(prep(new THREE.CylinderGeometry(r, r, 0.08, 18)), b.x, b.y + 0.04, b.z), woodTone(0xc58d52)));
          wood.push(paint(place(prep(new THREE.CylinderGeometry(r * 0.4, r * 0.4, b.h - 0.1, 12)), b.x, cy, b.z), woodTone(0xb07a45)));
          break;
        }
        case 'tires': {
          const r = Math.min(b.w, b.d) / 2 - 0.08;
          for (let i = 0; i < 3; i++) {
            const g = prep(new THREE.TorusGeometry(r, 0.1, 8, 16));
            solid.push(paint(place(g, b.x + (rnd() - 0.5) * 0.05, b.y + 0.1 + i * 0.22, b.z, rnd(), Math.PI / 2), 0x2d2f33));
          }
          break;
        }
        // ---- farm pieces ----
        case 'barn': {                                   // red painted boards with white trim on top
          wood.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), new THREE.Color(0xb8432f).offsetHSL(0, 0, (rnd() - 0.5) * 0.04).getHex()));
          solid.push(paint(place(new THREE.BoxGeometry(b.w + 0.04, 0.1, b.d + 0.04).toNonIndexed(), b.x, b.y + b.h - 0.05, b.z), 0xf2efe6));
          break;
        }
        case 'loft':
          wood.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), woodTone(0xc58d52)));
          break;
        case 'silo': {                                   // round metal tower with a dome and bands
          const r = Math.min(b.w, b.d) / 2;
          metal.push(paint(place(prep(new THREE.CylinderGeometry(r, r, b.h, 24, 1, true)), b.x, b.y + b.h / 2, b.z), 0xc9ced4));
          const dome = prep(new THREE.SphereGeometry(r * 1.02, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2));
          dome.scale(1, 0.55, 1);
          solid.push(paint(place(dome, b.x, b.y + b.h, b.z), 0x9aa3ad));
          for (const yy of [1.2, 3.4, 5.6]) solid.push(paint(place(prep(new THREE.TorusGeometry(r + 0.02, 0.05, 6, 28)), b.x, b.y + yy, b.z, 0, Math.PI / 2), 0x7d858f));
          for (let i = 0; i < 9; i++) solid.push(paint(place(new THREE.BoxGeometry(0.4, 0.04, 0.04).toNonIndexed(), b.x - r - 0.05, b.y + 0.4 + i * 0.8, b.z), 0x55595f)); // ladder rungs
          for (const dz of [-0.2, 0.2]) solid.push(paint(place(new THREE.BoxGeometry(0.04, b.h - 0.5, 0.04).toNonIndexed(), b.x - r - 0.05, b.y + b.h / 2, b.z + dz), 0x55595f));
          break;
        }
        case 'tractor': {                                // chunky farm tractor (cover), facing along x
          const alongX = b.w >= b.d, L = alongX ? b.w : b.d, Wd = alongX ? b.d : b.w, ry = alongX ? 0 : Math.PI / 2;
          const piece = (geo, lx, ly, lz, color, rx = 0, rz = 0) => {
            const g = geo.index ? geo.toNonIndexed() : geo;
            const m = new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeTranslation(lx, ly, lz)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
            g.applyMatrix4(m); g.translate(b.x, b.y, b.z);
            solid.push(paint(g, color));
          };
          piece(new THREE.BoxGeometry(L * 0.55, 0.75, Wd * 0.55), -L * 0.15, 0.85, 0, 0x3f8a3c);          // hood
          piece(new THREE.BoxGeometry(L * 0.35, 0.18, Wd * 0.75), L * 0.25, 0.75, 0, 0x2f6e2e);           // floor
          piece(new THREE.BoxGeometry(0.08, 1.0, 0.08), L * 0.12, 1.35, Wd * 0.33, 0x2b2f36);              // cab posts
          piece(new THREE.BoxGeometry(0.08, 1.0, 0.08), L * 0.12, 1.35, -Wd * 0.33, 0x2b2f36);
          piece(new THREE.BoxGeometry(0.08, 1.0, 0.08), L * 0.42, 1.35, Wd * 0.33, 0x2b2f36);
          piece(new THREE.BoxGeometry(0.08, 1.0, 0.08), L * 0.42, 1.35, -Wd * 0.33, 0x2b2f36);
          piece(new THREE.BoxGeometry(L * 0.42, 0.08, Wd * 0.8), L * 0.27, 1.88, 0, 0x3f8a3c);              // roof
          piece(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), -L * 0.32, 1.5, Wd * 0.12, 0x2b2f36);        // exhaust
          for (const sz of [-1, 1]) {
            piece(new THREE.CylinderGeometry(0.72, 0.72, 0.42, 18), L * 0.3, 0.72, sz * Wd * 0.42, 0x25272b, Math.PI / 2);  // big rear wheels
            piece(new THREE.CylinderGeometry(0.4, 0.4, 0.44, 14), L * 0.3, 0.72, sz * Wd * 0.43, 0xf2c23a, Math.PI / 2);
            piece(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16), -L * 0.33, 0.42, sz * Wd * 0.36, 0x25272b, Math.PI / 2); // front wheels
            piece(new THREE.CylinderGeometry(0.22, 0.22, 0.32, 12), -L * 0.33, 0.42, sz * Wd * 0.37, 0xf2c23a, Math.PI / 2);
          }
          break;
        }
        case 'shed': {                                   // small coop with a pitched roof and a door
          wood.push(paint(place(tbox(b.w, b.h, b.d, 1.2), b.x, cy, b.z), woodTone(0xd9b07a)));
          for (const s of [-1, 1]) {
            const slab = new THREE.BoxGeometry(b.w + 0.3, 0.08, b.d / 2 + 0.35).toNonIndexed();
            place(slab, b.x, b.y + b.h + 0.28, b.z + s * (b.d / 4 + 0.05), 0, s * 0.42);
            solid.push(paint(slab, 0x7a3b2c));
          }
          solid.push(paint(place(new THREE.BoxGeometry(0.7, 1.1, 0.04).toNonIndexed(), b.x, b.y + 0.55, b.z + b.d / 2 + 0.02), 0x6b4a2c));
          break;
        }
        case 'trough':
          metal.push(paint(place(tbox(b.w, b.h, b.d, 2.4), b.x, cy, b.z), 0x9aa3ad));
          solid.push(paint(place(new THREE.BoxGeometry(b.w - 0.12, 0.04, b.d - 0.12).toNonIndexed(), b.x, b.y + b.h - 0.08, b.z), 0x4aa8d8));
          break;
        case 'rail': {                                   // low ranch fence: posts and two rails
          const alongX = b.w > b.d, L = Math.max(b.w, b.d), n = Math.max(1, Math.round(L / 1.6));
          for (let i = 0; i <= n; i++) {
            const o = -L / 2 + (i / n) * L;
            wood.push(paint(place(tbox(0.14, b.h + 0.1, 0.14, 1.2), alongX ? b.x + o : b.x, (b.h + 0.1) / 2, alongX ? b.z : b.z + o), 0x8a5a33));
          }
          for (const yy of [0.45, 0.85]) wood.push(paint(place(tbox(alongX ? L : 0.08, 0.14, alongX ? 0.08 : L, 1.2), b.x, yy, b.z), woodTone(0xc48a52)));
          break;
        }
        default:
          solid.push(paint(place(new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed(), b.x, cy, b.z), 0x999999));
      }
    }

    // gable roofs (visual only): two sloped slabs, white trim and red gable ends
    for (const r of map.roofs || []) {
      const half = r.d / 2 + 0.45, ang = Math.atan2(r.h, r.d / 2), slope = Math.hypot(half, r.h * (half / (r.d / 2)));
      for (const s of [-1, 1]) {
        const slab = new THREE.BoxGeometry(r.w + 0.7, 0.14, slope).toNonIndexed();
        place(slab, r.x, r.y + r.h / 2 - 0.05, r.z + s * (r.d / 4 + 0.1), 0, s * ang);
        solid.push(paint(slab, 0x6a3a2e));
      }
      for (const sx of [-1, 1]) {
        const tri = new THREE.BufferGeometry();
        const x = r.x + sx * (r.w / 2), z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
        tri.setAttribute('position', new THREE.Float32BufferAttribute([x, r.y, z0, x, r.y, z1, x, r.y + r.h, r.z], 3));
        tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
        tri.computeVertexNormals();
        solid.push(paint(tri, 0xb8432f, false));
        // a hay door in the gable
        solid.push(paint(place(new THREE.BoxGeometry(0.06, 0.9, 1.2).toNonIndexed(), x + sx * 0.03, r.y + 0.75, r.z), 0xf2efe6));
      }
      solid.push(paint(place(new THREE.BoxGeometry(r.w + 0.75, 0.16, 0.16).toNonIndexed(), r.x, r.y + r.h, r.z), 0xf2efe6)); // ridge
    }

    // ramps: sloped plank board with cross slats
    for (const r of map.ramps || []) {
      const alongZ = r.dir[1] === 'z', L = alongZ ? r.d : r.w, wdt = alongZ ? r.w : r.d;
      const len = Math.hypot(L, r.h), ang = Math.atan2(r.h, L), sgn = r.dir[0] === '+' ? 1 : -1;
      const board = tbox(alongZ ? wdt : len, 0.08, alongZ ? len : wdt, 1.2);
      if (alongZ) place(board, r.x, r.h / 2, r.z, 0, sgn * -ang);
      else place(board, r.x, r.h / 2, r.z, 0, 0, sgn * ang);
      if (r.kind === 'rock') {                         // packed-gravel slope with a rock edge underneath
        leaves.push(paint(board, 0xb8a27e));
        const side = new THREE.BufferGeometry(), x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
        const hi = (x, z) => (alongZ ? (sgn > 0 ? (z - z0) / r.d : (z1 - z) / r.d) : (sgn > 0 ? (x - x0) / r.w : (x1 - x) / r.w)) * r.h;
        const v = [];
        for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
          v.push(ax, 0, az, bx, 0, bz, bx, hi(bx, bz), bz, ax, 0, az, bx, hi(bx, bz), bz, ax, hi(ax, az), az);
        }
        side.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); side.computeVertexNormals();
        solid.push(paint(side, 0xa08c6c));
        continue;
      }
      if (r.kind === 'steel') {
        metal.push(paint(board, 0x7d8892));
        for (const s2 of [-1, 1]) {                    // yellow side stringers
          const str = new THREE.BoxGeometry(alongZ ? 0.08 : len, 0.18, alongZ ? len : 0.08).toNonIndexed();
          if (alongZ) place(str, r.x + s2 * wdt / 2, r.h / 2 + 0.05, r.z, 0, sgn * -ang);
          else place(str, r.x, r.h / 2 + 0.05, r.z + s2 * wdt / 2, 0, 0, sgn * ang);
          solid.push(paint(str, 0xf2c23a));
        }
        continue;
      }
      wood.push(paint(board, woodTone(0xc48a52)));
      for (let i = 1; i < 8; i++) {
        const t = i / 8, hh = r.h * (sgn > 0 ? t : 1 - t) + 0.06;
        const off = -L / 2 + t * L;
        const slat = new THREE.BoxGeometry(alongZ ? wdt : 0.06, 0.04, alongZ ? 0.06 : wdt).toNonIndexed();
        place(slat, alongZ ? r.x : r.x + off, hh, alongZ ? r.z + off : r.z);
        wood.push(paint(slat, 0x8e5c34));
      }
    }

    // team pennants on base posts, and bunting between them
    for (const f of map.flags || []) {
      const tri = new THREE.BufferGeometry();
      const dir = f.x < 0 ? 1 : -1;
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.45, 0, dir * 0.8, -0.22, 0], 3));
      tri.computeVertexNormals();
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0.5], 2));
      const g = place(tri, f.x, f.h + 0.05, f.z, f.z > 0 ? 0.3 : -0.3);
      solid.push(paint(g, TEAM_COLORS[f.team], false));
    }
    for (let t = 0; t < 2; t++) {
      const fl = (map.flags || []).filter((f) => f.team === t);
      if (fl.length < 2) continue;
      const x = fl[0].x, z0 = Math.min(...fl.map((f) => f.z)), z1 = Math.max(...fl.map((f) => f.z));
      const n = Math.max(6, Math.round((z1 - z0) / 0.8));
      for (let i = 0; i < n; i++) {
        const z = z0 + (i + 0.5) * ((z1 - z0) / n), sag = Math.sin(((i + 0.5) / n) * Math.PI) * 0.35;
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.3, 0, 0, 0.3, 0, -0.35, 0], 3));
        tri.computeVertexNormals();
        tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
        solid.push(paint(place(tri, x, 2.5 - sag, z), i % 2 ? 0xffffff : TEAM_COLORS[t], false));
      }
    }

    // trees and bushes outside the fence
    const trees = [];
    const tryTree = (x, z) => {
      if (Math.abs(x) < map.halfX + 1.5 && Math.abs(z) < map.halfZ + 1.5) return;
      for (const t of trees) if (Math.hypot(t[0] - x, t[1] - z) < 3.2) return;
      trees.push([x, z]);
    };
    if (T.trees !== 'leafy') buildTrees(map, B, T.trees);
    for (let i = 0; i < 900 && trees.length < (T.trees === 'leafy' ? 150 : 0); i++) {
      const a = rnd() * Math.PI * 2, d = 1 + rnd() * 0.5;
      tryTree(Math.cos(a) * (map.halfX + 3) * d * 1.05, Math.sin(a) * (map.halfZ + 3) * d * 1.25);
    }
    for (const [x, z] of trees) {
      const h = 3.5 + rnd() * 3.5, birch = rnd() < 0.45;
      const trunk = prep(new THREE.CylinderGeometry(0.12, 0.2, h, 7));
      trunk.translate(x, h / 2, z);
      solid.push(paint(trunk, birch ? 0xeae6dc : 0x6e4a2c));
      const base = FOLIAGE[(rnd() * FOLIAGE.length) | 0];
      const blobs = 5 + ((rnd() * 4) | 0), crownR = 1.3 + rnd() * 0.8;
      for (let k = 0; k < blobs; k++) {
        const r = crownR * (0.55 + rnd() * 0.4);
        const g = prep(new THREE.IcosahedronGeometry(r, 1));
        const a = rnd() * Math.PI * 2, rr = rnd() * crownR * 0.7;
        g.translate(x + Math.cos(a) * rr, h * 0.85 + rnd() * crownR * 0.9, z + Math.sin(a) * rr);
        leaves.push(paint(g, new THREE.Color(base).offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.12).getHex(), false));
      }
    }
    const edgeKind = map.boxes.find((b) => b.x === 0 && b.z > map.halfZ)?.kind;
    for (let i = 0; i < (edgeKind === 'cliff' ? 0 : 130); i++) { // bushes hugging the fence
      const side = i % 4, t = rnd() * 2 - 1;
      const x = side < 2 ? t * map.halfX : (side === 2 ? -1 : 1) * (map.halfX + 0.9);
      const z = side < 2 ? (side === 0 ? -1 : 1) * (map.halfZ + 0.9) : t * map.halfZ;
      const g = prep(new THREE.IcosahedronGeometry(0.6 + rnd() * 0.5, 1));
      g.scale(1.3, 0.8, 1.3);
      g.translate(x, 0.35, z);
      leaves.push(paint(g, new THREE.Color(T.bush).offsetHSL(0, 0, (rnd() - 0.5) * 0.12).getHex(), false));
    }

    const add = (geos, material, cast = true) => {
      if (!geos.length) return;
      const m = new THREE.Mesh(mergeGeometries(geos.map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; })), material);
      m.castShadow = cast; m.receiveShadow = true;
      scene.add(m);
    };
    add(wood, new THREE.MeshLambertMaterial({ map: woodTex(), vertexColors: true }));
    add(hay, new THREE.MeshLambertMaterial({ map: hayTex(), vertexColors: true }));
    add(metal, new THREE.MeshLambertMaterial({ map: containerTex(), vertexColors: true }));
    add(solid, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    add(leaves, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    add(brick, new THREE.MeshLambertMaterial({ map: brickTex(), vertexColors: true }));
    add(chain, new THREE.MeshLambertMaterial({ map: chainTex(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }), false);
    add(glow, new THREE.MeshBasicMaterial({ vertexColors: true }), false);
    for (const g of ctx.groups) scene.add(g);
    this.buildHalos(ctx.halos);
    buildStrings(map, scene, map.theme === 'fair');
    buildDecor(map, scene, this.anim);

    this.buildBushes();
    this.buildWindmills();

    // ground: big meadow + painted play field
    const meadow = new THREE.Mesh(new THREE.CircleGeometry(200, 32), new THREE.MeshLambertMaterial({ color: T.meadow }));
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.y = -0.01;
    meadow.receiveShadow = true;
    scene.add(meadow);
    const sx = map.halfX + 6, sz = map.halfZ + 6;
    const pools = propGlowPools(map);
    const glowMap = pools.length ? glowTex(pools, sx, sz) : null;
    const field = new THREE.Mesh(new THREE.PlaneGeometry(sx * 2, sz * 2), new THREE.MeshLambertMaterial({
      map: groundTex(map, sx, sz, T.ground), ...(glowMap ? { emissive: 0xffffff, emissiveMap: glowMap } : {}),
    }));
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    scene.add(field);
  }

  // soft additive glow sprites around lamps
  buildHalos(list) {
    if (!list.length) return;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    for (const [hx, hy, hz, color, size] of list) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
      sp.position.set(hx, hy, hz); sp.scale.setScalar(size);
      this.scene.add(sp);
    }
  }

  // Windmill: lattice tower standing on a lookout deck, with turning blades and a tail vane.
  buildWindmills() {
    this.windmills = [];
    const dark = new THREE.MeshLambertMaterial({ color: 0x7a5232 }), light = new THREE.MeshLambertMaterial({ color: 0xf1ead8 });
    const red = new THREE.MeshLambertMaterial({ color: 0xb8432f });
    for (const w of this.map.windmills || []) {
      const g = new THREE.Group();
      g.position.set(w.x, 1.95, w.z);
      const base = 1.5, top = 0.35, H = 7.5;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {     // slanted legs
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, H + 0.3, 0.12), dark);
        leg.position.set(sx * (base + top) / 2, H / 2, sz * (base + top) / 2);
        leg.rotation.set(sz * Math.atan((base - top) / H), 0, -sx * Math.atan((base - top) / H));
        leg.castShadow = true; g.add(leg);
      }
      for (let i = 1; i < 5; i++) {                                        // cross bars
        const y = (i / 5) * H, half = base - (base - top) * (i / 5);
        for (const [rx, rz, wd, dp] of [[0, -half, half * 2, 0.08], [0, half, half * 2, 0.08], [-half, 0, 0.08, half * 2], [half, 0, 0.08, half * 2]]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(wd, 0.08, dp), dark);
          bar.position.set(rx, y, rz); g.add(bar);
        }
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.9), red);
      head.position.set(0, H + 0.3, 0); head.castShadow = true; g.add(head);
      const rotor = new THREE.Group(); rotor.position.set(0, H + 0.3, -0.55);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 12), red); hub.rotation.x = Math.PI / 2; rotor.add(hub);
      for (let i = 0; i < 12; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.9, 0.03), light);
        blade.position.set(0, 1.15, 0);
        const arm = new THREE.Group(); arm.rotation.z = (i / 12) * Math.PI * 2; arm.add(blade);
        blade.rotation.y = 0.35; blade.castShadow = true;
        rotor.add(arm);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.04, 6, 32), dark); rotor.add(ring);
      g.add(rotor);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.6), red); tail.position.set(0, H + 0.4, 1.2); g.add(tail);
      // face the blades toward the middle of the map
      g.rotation.y = Math.atan2(w.x, w.z);
      this.scene.add(g);
      this.windmills.push({ rotor, speed: 0.6 + rnd() * 0.3 });
    }
  }

  // Hide-in bushes: one merged leafy mesh each so they can sway when someone pushes through.
  buildBushes() {
    this.bushes = [];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    for (const b of this.map.bushes || []) {
      const geos = [];
      if (b.kind === 'corn') {                          // a patch of tall corn stalks with leaves and cobs
        const n = Math.round(b.r * b.r * 9);
        for (let k = 0; k < n; k++) {
          const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * b.r * 0.9;
          const x = Math.cos(a) * rr, z = Math.sin(a) * rr, hh = b.h * (0.85 + rnd() * 0.25);
          const stalk = prep(new THREE.CylinderGeometry(0.025, 0.035, hh, 5));
          stalk.translate(x, hh / 2, z);
          geos.push(paint(stalk, 0x7f9e3a, false));
          for (let l = 0; l < 3; l++) {
            const leaf = prep(new THREE.ConeGeometry(0.07, 0.75, 3));
            leaf.scale(1, 1, 0.2);
            leaf.rotateZ((rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.4));
            leaf.rotateY(rnd() * Math.PI * 2);
            leaf.translate(x, hh * (0.35 + l * 0.22), z);
            geos.push(paint(leaf, new THREE.Color(0x9fbf45).offsetHSL(0, 0, (rnd() - 0.5) * 0.12).getHex(), false));
          }
          const tassel = prep(new THREE.ConeGeometry(0.06, 0.25, 4));
          tassel.translate(x, hh + 0.1, z);
          geos.push(paint(tassel, 0xe6c75a, false));
          if (rnd() < 0.5) {
            const cob = prep(new THREE.CapsuleGeometry(0.04, 0.14, 2, 5));
            cob.rotateZ(0.4); cob.translate(x + 0.05, hh * 0.6, z);
            geos.push(paint(cob, 0xf2d25a, false));
          }
        }
        const m = new THREE.Mesh(mergeGeometries(geos.map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; })), mat);
        m.position.set(b.x, 0, b.z);
        m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
        this.bushes.push({ b, mesh: m, shake: 0, phase: rnd() * 6 });
        continue;
      }
      if (b.kind === 'hedge') {                         // trimmed round hedge with little flowers
        const base = new THREE.Color(this.theme.bush).offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2, g = prep(new THREE.IcosahedronGeometry(b.r * 0.62, 1));
          g.scale(1, (b.h / b.r) * 0.7, 1); g.translate(Math.cos(a) * b.r * 0.42, b.h * 0.48, Math.sin(a) * b.r * 0.42);
          geos.push(paint(g, base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.08).getHex(), false));
        }
        for (let k = 0; k < 10; k++) {
          const a = rnd() * Math.PI * 2, f = prep(new THREE.IcosahedronGeometry(0.07, 0));
          f.translate(Math.cos(a) * b.r * 0.85, b.h * (0.4 + rnd() * 0.5), Math.sin(a) * b.r * 0.85);
          geos.push(paint(f, [0xff8fab, 0xffd166, 0xffffff][k % 3], false));
        }
        const m = new THREE.Mesh(mergeGeometries(geos), mat);
        m.position.set(b.x, 0, b.z); m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
        this.bushes.push({ b, mesh: m, shake: 0, phase: rnd() * 6 });
        continue;
      }
      const base = new THREE.Color(b.kind === 'scrub' ? 0x8c9a3c : this.theme.bush).offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.08);
      const blobs = 7 + ((rnd() * 4) | 0);
      for (let k = 0; k < blobs; k++) {
        const a = (k / blobs) * Math.PI * 2 + rnd(), rr = b.r * (0.25 + rnd() * 0.5);
        const size = b.r * (0.5 + rnd() * 0.3);
        const g = prep(new THREE.IcosahedronGeometry(size, 1));
        g.scale(1, (b.h / b.r) * 0.55, 1);
        g.translate(Math.cos(a) * rr, b.h * (0.35 + rnd() * 0.3), Math.sin(a) * rr);
        geos.push(paint(g, base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.12).getHex(), false));
      }
      const top = prep(new THREE.IcosahedronGeometry(b.r * 0.6, 1));
      top.scale(1, 0.8, 1); top.translate(0, b.h * 0.75, 0);
      geos.push(paint(top, base.clone().offsetHSL(0, 0, 0.06).getHex(), false));
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.position.set(b.x, 0, b.z);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      this.bushes.push({ b, mesh: m, shake: 0, phase: rnd() * 6 });
    }
  }

  // movers: positions [x, z] of anyone walking; bushes they're inside shake
  updateBushes(dt, movers) {
    for (const bu of this.bushes || []) {
      let target = 0;
      for (const [x, z, speed] of movers) {
        const dx = x - bu.b.x, dz = z - bu.b.z;
        if (dx * dx + dz * dz < bu.b.r * bu.b.r) target = Math.max(target, Math.min(1, speed / 3));
      }
      bu.shake += (target - bu.shake) * Math.min(1, dt * 6);
      bu.phase += dt * 9;
      const amp = 0.012 + bu.shake * 0.09;
      bu.mesh.rotation.set(Math.sin(bu.phase) * amp, 0, Math.cos(bu.phase * 1.3) * amp);
      bu.mesh.scale.y = 1 - bu.shake * 0.04 * (1 + Math.sin(bu.phase * 2));
    }
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = on;
    this.realScene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }

  // ---- effect pools ------------------------------------------------------------------------
  buildPools() {
    this.splatTexture = splatTex();
    this.splatMax = 500;
    const splatMat = new THREE.MeshLambertMaterial({
      map: this.splatTexture, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), splatMat, this.splatMax);
    this.splats.count = 0;
    this.splats.frustumCulled = false;
    this.splats.receiveShadow = true;
    this.splatIdx = 0;
    this.scene.add(this.splats);

    // paintballs: short glowing streaks oriented along velocity
    this.ballMax = 300;
    const streak = new THREE.CylinderGeometry(0.024, 0.016, 1, 6);
    this.balls = new THREE.InstancedMesh(streak, new THREE.MeshBasicMaterial(), this.ballMax);
    this.balls.frustumCulled = false;
    this.balls.count = 0;
    this.ballList = [];
    this.scene.add(this.balls);

    this.dropMax = 300;
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.018, 0), new THREE.MeshBasicMaterial(), this.dropMax);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    this.dropList = [];
    this.scene.add(this.drops);
  }

  addSplat(p, n, team, size = 0.11 + Math.random() * 0.09) {
    const normal = tmpV.set(n[0], n[1], n[2]);
    if (normal.lengthSq() < 0.5) { this.burst(p, team, 10); return; }
    tmpQ.setFromUnitVectors(Z, normal);
    tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(Z, Math.random() * Math.PI * 2));
    const pos = new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(normal, 0.008);
    tmpS.set(size * (0.85 + Math.random() * 0.4), size * (0.85 + Math.random() * 0.4), 1);
    tmpM.compose(pos, tmpQ, tmpS);
    const i = this.splatIdx;
    this.splats.setMatrixAt(i, tmpM);
    tmpC.setHex(TEAM_COLORS[team]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    this.splats.setColorAt(i, tmpC);
    this.splatIdx = (i + 1) % this.splatMax;
    this.splats.count = Math.min(this.splatMax, this.splats.count + 1);
    this.splats.instanceMatrix.needsUpdate = true;
    this.splats.instanceColor.needsUpdate = true;
    this.burst(p, team, 5);
  }

  burst(p, team, n) {
    for (let i = 0; i < n; i++) {
      if (this.dropList.length >= this.dropMax) this.dropList.shift();
      this.dropList.push({
        p: [p[0], p[1], p[2]],
        v: [(Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3],
        life: 0.4 + Math.random() * 0.3, team,
      });
    }
  }

  // Visual paintball. Hits are decided by the server; we just stop at walls/avatars.
  addBall(origin, vel, team, life) {
    if (this.ballList.length >= this.ballMax) this.ballList.shift();
    this.ballList.push({ p: origin.slice(), v: vel.slice(), team, life });
  }

  updateGrenades(list, alpha) {
    const seen = new Set();
    for (const [id, x, y, z, team] of list) {
      seen.add(id);
      let g = this.grenades.get(id);
      if (!g) {
        g = makeGrenade(TEAM_COLORS[team]); g.traverse((o) => { o.castShadow = true; });
        this.scene.add(g); this.grenades.set(id, g); g.position.set(x, y, z);
        Object.assign(g.userData, { lastY: y, vy: 0 });
        this.onThrow?.([x, y, z]);
      }
      // bounce detection: vertical motion flips from falling to rising
      const vy = y - g.userData.lastY;
      if (vy !== 0) {
        if (g.userData.vy < -0.002 && vy > 0.002) this.onBounce?.([x, y, z]);
        g.userData.vy = vy; g.userData.lastY = y;
      }
      g.position.lerp(tmpV.set(x, y, z), alpha);
      g.rotation.x += 0.2; g.rotation.z += 0.13;
      g.userData.spark.visible = performance.now() % 240 < 130;
    }
    for (const [id, g] of this.grenades) if (!seen.has(id)) { this.scene.remove(g); this.grenades.delete(id); }
  }

  // rows: [id, x, y, z, nx, ny, nz, team, armed]
  updateMines(list) {
    const seen = new Set(), t = performance.now() / 1000;
    for (const [id, x, y, z, nx, ny, nz, team, armed] of list) {
      seen.add(id);
      let m = this.mines.get(id);
      if (!m) {
        m = makeMine(TEAM_COLORS[team]);
        m.position.set(x, y, z);
        m.quaternion.setFromUnitVectors(Y, tmpV.set(nx, ny, nz).normalize());
        m.userData.team = team;
        this.scene.add(m); this.mines.set(id, m);
      }
      const light = m.userData.light;
      const on = armed ? Math.sin(t * 8 + id) > 0 : true;
      light.material.color.setHex(armed ? (on ? TEAM_COLORS[team] : 0x222222) : 0xffffff);
    }
    for (const [id, m] of this.mines) if (!seen.has(id)) { this.scene.remove(m); this.mines.delete(id); }
  }

  explode(p, team, radius) {
    const R = radius || WEAPONS[W.GRENADE].radius;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
      const from = [p[0] + Math.cos(a) * r, p[1] + 1.5, p[2] + Math.sin(a) * r];
      const hit = raycastWorld(this.map, from, [from[0], -0.5, from[2]]);
      if (hit) {
        const hp = [from[0], from[1] + (-0.5 - from[1]) * hit.t, from[2]];
        this.addSplat(hp, hit.n, team, 0.15 + Math.random() * 0.25);
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const to = [p[0] + Math.cos(a) * R, p[1] + (Math.random() - 0.3), p[2] + Math.sin(a) * R];
      const hit = raycastWorld(this.map, p, to);
      if (hit) this.addSplat([p[0] + (to[0] - p[0]) * hit.t, p[1] + (to[1] - p[1]) * hit.t, p[2] + (to[2] - p[2]) * hit.t], hit.n, team);
    }
    this.burst(p, team, 40);
    const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.6 }));
    flash.position.set(p[0], p[1], p[2]);
    this.scene.add(flash);
    this.flashes.push({ mesh: flash, t: 0, r: R });
  }

  update(dt, avatarHits) {
    for (const w of this.windmills || []) w.rotor.rotation.z += dt * w.speed;
    for (const f of this.anim) f(dt);
    const keep = [];
    for (const b of this.ballList) {
      const np = ballistic(b.p, b.v, PAINT_GRAVITY, dt);
      b.life -= dt;
      if (b.life <= 0 || raycastWorld(this.map, b.p, np) || (avatarHits && avatarHits(np, b.team))) continue;
      b.p = np;
      keep.push(b);
    }
    this.ballList = keep;
    this.balls.count = keep.length;
    for (let i = 0; i < keep.length; i++) {
      const b = keep[i];
      tmpV.set(b.v[0], b.v[1], b.v[2]);
      const sp = tmpV.length() || 1;
      tmpQ.setFromUnitVectors(Y, tmpV.divideScalar(sp));
      tmpS.set(1, Math.min(0.45, sp * 0.012), 1);
      tmpM.compose(tmpV.set(b.p[0], b.p[1], b.p[2]), tmpQ, tmpS);
      this.balls.setMatrixAt(i, tmpM);
      this.balls.setColorAt(i, tmpC.setHex(TEAM_COLORS[b.team]));
    }
    this.balls.instanceMatrix.needsUpdate = true;
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true;

    const dk = [];
    for (const d of this.dropList) {
      d.life -= dt;
      if (d.life <= 0) continue;
      d.p = ballistic(d.p, d.v, 9.8, dt);
      if (d.p[1] < 0.01) { d.p[1] = 0.01; d.v = [0, 0, 0]; }
      dk.push(d);
    }
    this.dropList = dk;
    this.drops.count = dk.length;
    for (let i = 0; i < dk.length; i++) {
      tmpM.makeTranslation(dk[i].p[0], dk[i].p[1], dk[i].p[2]);
      this.drops.setMatrixAt(i, tmpM);
      this.drops.setColorAt(i, tmpC.setHex(TEAM_COLORS[dk[i].team]));
    }
    this.drops.instanceMatrix.needsUpdate = true;
    if (this.drops.instanceColor) this.drops.instanceColor.needsUpdate = true;

    this.updateKOs(dt);
    this.flashes = this.flashes.filter((f) => {
      f.t += dt;
      const k = f.t / 0.35;
      f.mesh.scale.setScalar(0.3 + k * f.r);
      f.mesh.material.opacity = 0.6 * (1 - k);
      if (k >= 1) { this.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); return false; }
      return true;
    });
  }

  dispose() {
    this.realScene.remove(this.scene);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
    });
  }

  clearSplats() { this.splats.count = 0; this.splatIdx = 0; }

  // Floating "KO!" badge over an eliminated player. `mine` = you made the hit:
  // bigger, visible through walls, with a small "HIT!" tag.
  addKO(pos, team, mine) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: koTexture(team), transparent: true, depthTest: !mine, depthWrite: false,
    }));
    sprite.renderOrder = mine ? 997 : 0;
    sprite.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(sprite);
    this.kos.push({ sprite, t: 0, base: pos.slice(), size: mine ? 0.55 : 0.4 });
    if (mine) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: hitTagTexture(), transparent: true, depthTest: false, depthWrite: false }));
      tag.renderOrder = 997;
      tag.position.set(pos[0] + 0.35, pos[1] - 0.25, pos[2]);
      this.scene.add(tag);
      this.kos.push({ sprite: tag, t: 0, base: [pos[0] + 0.32, pos[1] - 0.3, pos[2]], size: 0.3, tag: true });
    }
  }

  updateKOs(dt) {
    this.kos = this.kos.filter((k) => {
      k.t += dt;
      const t = k.t, life = k.tag ? 1.1 : 1.8;
      // pop in with overshoot, float up, fade out
      const pop = t < 0.25 ? Math.sin((t / 0.25) * Math.PI * 0.75) * 1.25 : 1 + Math.max(0, 0.25 - (t - 0.25)) * 0.4;
      // stay readable at range: grow with distance to the camera
      const dist = this.cameraPos ? this.cameraPos.distanceTo(k.sprite.position) : 5;
      const s = k.size * Math.min(pop, 1.25) * Math.max(1, dist / 5);
      k.sprite.scale.set(s, s * (k.tag ? 0.45 : 1), 1);
      k.sprite.position.set(k.base[0], k.base[1] + t * 0.35, k.base[2]);
      k.sprite.material.rotation = k.tag ? 0 : Math.sin(t * 6) * 0.08 * Math.max(0, 1 - t);
      k.sprite.material.opacity = t > life - 0.5 ? Math.max(0, (life - t) / 0.5) : 1;
      if (t >= life) { this.scene.remove(k.sprite); k.sprite.material.dispose(); return false; }
      return true;
    });
  }
}
