// Map editor: draw a map from the top, set sizes and heights, place weapons, check it,
// look at it in 3D and save it to the server so it shows up in the lobby and the map vote.
import { MAPS } from '/shared/maps.js';
import {
  BOX_KINDS, BUSH_KINDS, WEAPON_ITEMS, THEME_NAMES, EDGE_NAMES, BASE_KINDS,
  sanitizeSource, compileMap, validateMap, footprint, sourceFromMap, registerCustom,
} from '/shared/custom.js';
import { W, TEAM_COLORS } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DRAFT_KEY = 'pb-editor-draft';

// ---- colors used on the top-down drawing -------------------------------------------------------
const KIND_COLOR = {
  crate: 0xdcaa6b, hay: 0xe9c55a, plank: 0xb77d48, block: 0xcfcbc1, container: 0xe8a23a, lumber: 0xd9a86a, spool: 0xc58d52,
  tires: 0x3a3c42, barrel: 0xd2453a, rock: 0xa8a198, pile: 0xc9b591, car: 0x3c8de0, truck: 0xf2b51f, tractor: 0x3f8a3c,
  bumpercar: 0xe84a5f, pad: 0x3a6fd8, trough: 0x9aa3ad, rail: 0xc48a52, shed: 0xd9b07a, silo: 0xc9ced4, tank: 0xbfd0dc,
  pipe: 0x3f9a8a, kiosk: 0xf5f1e8, tent: 0xe84a5f, machine: 0x4f8a5a, counter: 0xd84a4a, stucco: 0xf3dcb8, brick: 0xa4523a,
  barn: 0xb8432f, deck: 0xb77d48, steel: 0x6f7a86, roofdeck: 0x9aa0a6, post: 0x8a5a33, beam: 0xe0a92e, railing: 0x8a939c,
  mesa: 0xb79a74, lamppost: 0xffe08a, flood: 0xe8f0ff, loft: 0xc58d52, slab: 0x6d6f73, parapet: 0x2f9e9a, speaker: 0x9aa0a8,
  booth: 0xd9a86a, boothback: 0xb77d48, carousel: 0xf5e6c8, carouselpole: 0xe8c25a,
};
const WEAPON_COLOR = {
  [W.SHOTGUN]: '#ff9f43', [W.BURST]: '#4cc9f0', [W.SNIPER]: '#b388eb', [W.LAUNCHER]: '#ff5d73', [W.SPRAYER]: '#06d6a0',
  [W.GRENADE]: '#7bd148', [W.MINE]: '#f7d038', [W.SHIELD]: '#a0aec0', [W.MALLET]: '#ff8fab', [W.PISTOL]: '#ffffff',
};
const WEAPON_SHORT = { [W.SHOTGUN]: 'SG', [W.BURST]: 'BR', [W.SNIPER]: 'SR', [W.LAUNCHER]: 'LN', [W.SPRAYER]: 'SP', [W.GRENADE]: 'G', [W.MINE]: 'M', [W.SHIELD]: 'SH', [W.MALLET]: 'ML', [W.PISTOL]: 'P' };
const BUSH_COLOR = { bush: '#5f9e35', corn: '#c9b44a', hedge: '#3f7a3a', scrub: '#8c9a3c' };
const GROUND_COLOR = { day: '#7fae4a', quarry: '#bba783', dusk: '#454a52', night: '#7d828a', fair: '#4f6e3c' };

// ---- palette: what you can place ----------------------------------------------------------------
const PALETTE = [];
PALETTE.push({ group: 'Structures', label: 'Lookout tower', color: 0xb77d48, make: () => ({ t: 'lookout', style: 'wood', rot: 0 }) });
PALETTE.push({ group: 'Structures', label: 'Steel lookout', color: 0x6f7a86, make: () => ({ t: 'lookout', style: 'steel', rot: 0 }) });
PALETTE.push({ group: 'Structures', label: 'Windmill tower', color: 0xb8432f, make: () => ({ t: 'lookout', style: 'windmill', rot: 0 }) });
PALETTE.push({ group: 'Structures', label: 'Wood ramp', color: 0xc48a52, make: () => ({ t: 'ramp', kind: 'wood', rot: 0, len: 4.5, width: 1.2, h: 1.95 }) });
PALETTE.push({ group: 'Structures', label: 'Steel ramp', color: 0x7d8892, make: () => ({ t: 'ramp', kind: 'steel', rot: 0, len: 4.5, width: 1.4, h: 1.95 }) });
PALETTE.push({ group: 'Structures', label: 'Rock slope', color: 0xb8a27e, make: () => ({ t: 'ramp', kind: 'rock', rot: 0, len: 4.5, width: 1.4, h: 1.9 }) });
PALETTE.push({ group: 'Structures', label: 'Game booth', color: 0xe84a5f, make: () => ({ t: 'booth', rot: 0 }) });
PALETTE.push({ group: 'Structures', label: 'Carousel', color: 0xf5e6c8, make: () => ({ t: 'carousel' }) });
for (const [kind, K] of Object.entries(BOX_KINDS)) {
  PALETTE.push({ group: K.group, label: K.label, color: KIND_COLOR[kind] ?? 0x999999, make: () => ({ t: 'box', kind, w: K.w, d: K.d, h: K.h, y: K.y || 0 }) });
}
for (const [kind, K] of Object.entries(BUSH_KINDS)) {
  PALETTE.push({ group: 'Hiding spots', label: K.label, color: parseInt(BUSH_COLOR[kind].slice(1), 16), make: () => ({ t: 'bush', kind, r: K.r, h: K.h }) });
}
for (const [w, label] of WEAPON_ITEMS) {
  PALETTE.push({ group: 'Weapons', label, color: parseInt(WEAPON_COLOR[w].slice(1), 16), make: () => ({ t: 'item', w, ground: false }) });
}
PALETTE.push({ group: 'Ground', label: 'Dirt patch', color: 0xb0a07a, make: () => ({ t: 'dirt', r: 3 }) });
const GROUP_ORDER = ['Weapons', 'Structures', 'Cover', 'Hiding spots', 'Buildings', 'Walls & floors', 'Lights', 'Ground'];

// ---- state -------------------------------------------------------------------------------------
const blank = () => ({ id: '', name: 'My Map', desc: '', width: 70, depth: 50, theme: 'day', edge: 'fence', baseKind: 'plank', mirror: true, elements: [] });
let src = blank();
try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d) src = sanitizeSource(d); } catch { /* fresh start */ }
let compiled = null, issues = [];
let sel = -1;              // selected element index
let tool = null;           // palette entry being placed
let dirty = false;
const undoStack = [], redoStack = [];
const view = { cx: 0, cz: 0, scale: 12 };
const canvas = $('c2d'), ctx = canvas.getContext('2d');
let mouse = { x: 0, z: 0, sx: 0, sy: 0, inside: false };
let drag = null;           // { kind: 'move'|'pan'|'resize', ... }
let spaceDown = false;
let userView = false;      // until the user pans or zooms, the view keeps fitting the map

function snapshot() { undoStack.push(JSON.stringify(src)); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; }
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(src)); src = JSON.parse(undoStack.pop()); sel = -1; changed(true); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(src)); src = JSON.parse(redoStack.pop()); sel = -1; changed(true); }

function changed(rebuildPanels = false) {
  dirty = true;
  try { compiled = compileMap(src); issues = validateMap(compiled); } catch (e) { console.error(e); }
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(src)); } catch { /* storage full or blocked */ }
  if (rebuildPanels) { fillSettings(); buildProps(); } else refreshPropValues();
  renderIssues();
  draw();
  preview.scheduleRebuild();
  setStatus(src.id ? `${src.name} · unsaved changes` : `${src.name} · not saved yet`);
}
function setStatus(t) { $('status').textContent = t; }

// ---- coordinates ---------------------------------------------------------------------------------
function resize() {
  const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!userView) fitView();
  draw();
}
const W2 = () => canvas.clientWidth / 2, H2 = () => canvas.clientHeight / 2;
const toScreen = (x, z) => [W2() + (x - view.cx) * view.scale, H2() + (z - view.cz) * view.scale];
const toWorld = (sx, sy) => [view.cx + (sx - W2()) / view.scale, view.cz + (sy - H2()) / view.scale];
function fitView() {
  const s = Math.min((canvas.clientWidth - 60) / src.width, (canvas.clientHeight - 60) / src.depth);
  view.scale = Math.max(3, s); view.cx = 0; view.cz = 0;
}
const snap = (v, alt) => (alt ? Math.round(v * 100) / 100 : Math.round(v * 4) / 4);

// ---- drawing --------------------------------------------------------------------------------------
function rect(x, z, w, d) { const [sx, sy] = toScreen(x - w / 2, z - d / 2); return [sx, sy, w * view.scale, d * view.scale]; }

function draw() {
  if (!compiled) return;
  const m = compiled, cw = canvas.clientWidth, ch = canvas.clientHeight;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#0d1015'; ctx.fillRect(0, 0, cw, ch);
  // field
  ctx.fillStyle = GROUND_COLOR[src.theme] || '#7fae4a';
  ctx.fillRect(...rect(0, 0, src.width, src.depth));
  // team halves
  ctx.fillStyle = 'rgba(255,122,26,0.08)'; ctx.fillRect(...rect(-src.width / 4, 0, src.width / 2, src.depth));
  ctx.fillStyle = 'rgba(26,184,255,0.08)'; ctx.fillRect(...rect(src.width / 4, 0, src.width / 2, src.depth));
  // dirt
  for (const [x, z, r] of m.dirt) {
    const [sx, sy] = toScreen(x, z);
    ctx.fillStyle = 'rgba(176,160,122,0.55)'; ctx.beginPath(); ctx.arc(sx, sy, r * view.scale, 0, 7); ctx.fill();
  }
  // grid
  const step = view.scale > 8 ? 1 : 5;
  ctx.lineWidth = 1;
  for (let x = -Math.floor(src.width / 2); x <= src.width / 2; x += step) {
    const [sx] = toScreen(x, 0);
    ctx.strokeStyle = x % 5 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.09)';
    ctx.beginPath(); ctx.moveTo(sx, toScreen(0, -src.depth / 2)[1]); ctx.lineTo(sx, toScreen(0, src.depth / 2)[1]); ctx.stroke();
  }
  for (let z = -Math.floor(src.depth / 2); z <= src.depth / 2; z += step) {
    const [, sy] = toScreen(0, z);
    ctx.strokeStyle = z % 5 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.09)';
    ctx.beginPath(); ctx.moveTo(toScreen(-src.width / 2, 0)[0], sy); ctx.lineTo(toScreen(src.width / 2, 0)[0], sy); ctx.stroke();
  }
  // middle line
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(...toScreen(0, -src.depth / 2)); ctx.lineTo(...toScreen(0, src.depth / 2)); ctx.stroke();
  ctx.setLineDash([]);
  // edge
  ctx.strokeStyle = src.edge === 'cliff' ? '#a08060' : src.edge === 'chainlink' ? '#c7ced6' : '#8a5a33';
  ctx.lineWidth = Math.max(3, 0.4 * view.scale);
  ctx.strokeRect(...rect(0, 0, src.width, src.depth));

  // boxes, low ones first; mirrored copies are drawn faded
  const boxes = m.boxes.filter((b) => !['fence', 'cliff', 'chainlink'].includes(b.kind)).sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const b of boxes) {
    const ghost = src.mirror && b.team === 1;
    const raised = b.y >= 1.5;
    ctx.globalAlpha = (ghost ? 0.45 : 1) * (raised ? 0.75 : 1);
    ctx.fillStyle = hex(KIND_COLOR[b.kind] ?? 0x999999);
    const round = ['silo', 'tank', 'barrel', 'spool', 'tires', 'carousel', 'pile'].includes(b.kind);
    const [sx, sy, sw, sh] = rect(b.x, b.z, b.w, b.d);
    if (round) { ctx.beginPath(); ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, 7); ctx.fill(); }
    else ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
    if (raised) ctx.setLineDash([4, 3]);
    if (round) ctx.stroke(); else ctx.strokeRect(sx, sy, sw, sh);
    ctx.setLineDash([]);
    if (b.kind === 'lamppost' || b.kind === 'flood') {
      ctx.fillStyle = 'rgba(255,230,140,0.18)'; ctx.beginPath(); ctx.arc(sx + sw / 2, sy + sh / 2, (b.kind === 'flood' ? 7 : 4.5) * view.scale, 0, 7); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // ramps with an arrow pointing uphill
  for (const r of m.ramps) {
    const ghost = src.mirror && isGhostRamp(r);
    ctx.globalAlpha = ghost ? 0.45 : 1;
    const [sx, sy, sw, sh] = rect(r.x, r.z, r.w, r.d);
    ctx.fillStyle = r.kind === 'steel' ? '#7d8892' : r.kind === 'rock' ? '#b8a27e' : '#c48a52';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeRect(sx, sy, sw, sh);
    const dx = { '+x': 1, '-x': -1 }[r.dir] || 0, dz = { '+z': 1, '-z': -1 }[r.dir] || 0;
    const [cx, cy] = toScreen(r.x, r.z), L = Math.min(Math.abs(dx ? sw : sh) * 0.35, 30);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - dx * L, cy - dz * L); ctx.lineTo(cx + dx * L, cy + dz * L);
    ctx.lineTo(cx + dx * L * 0.5 - dz * L * 0.35, cy + dz * L * 0.5 + dx * L * 0.35);
    ctx.moveTo(cx + dx * L, cy + dz * L); ctx.lineTo(cx + dx * L * 0.5 + dz * L * 0.35, cy + dz * L * 0.5 - dx * L * 0.35);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // bushes
  for (const b of m.bushes) {
    const [sx, sy] = toScreen(b.x, b.z);
    ctx.globalAlpha = src.mirror && isGhostPoint(b.x, b.z, 'bush') ? 0.4 : 0.75;
    ctx.fillStyle = BUSH_COLOR[b.kind || 'bush']; ctx.beginPath(); ctx.arc(sx, sy, b.r * view.scale, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // weapons
  for (const it of m.items) {
    const [sx, sy] = toScreen(it.x, it.z), r = Math.max(7, 0.45 * view.scale);
    ctx.globalAlpha = src.mirror && isGhostPoint(it.x, it.z, 'item') ? 0.45 : 1;
    ctx.fillStyle = WEAPON_COLOR[it.w] || '#fff';
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = `bold ${Math.round(r * 0.9)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(WEAPON_SHORT[it.w] || '?', sx, sy + 0.5);
    if (it.y > 0.1) { ctx.fillStyle = '#fff'; ctx.font = '10px system-ui'; ctx.fillText(`↑${it.y.toFixed(1)}`, sx, sy - r - 6); }
  }
  ctx.globalAlpha = 1;
  // spawns
  m.spawns.forEach((team, t) => team.forEach(([x, , z]) => {
    const [sx, sy] = toScreen(x, z);
    ctx.fillStyle = hex(TEAM_COLORS[t]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); const d = t === 0 ? 1 : -1;
    ctx.moveTo(sx + d * 9, sy); ctx.lineTo(sx - d * 6, sy - 7); ctx.lineTo(sx - d * 6, sy + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  }));
  // problems
  for (const i of issues) {
    const [sx, sy] = toScreen(i.x, i.z);
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 14, 0, 7); ctx.stroke();
  }
  // selection
  if (sel >= 0 && src.elements[sel]) {
    const f = footprint(src.elements[sel]);
    const [sx, sy, sw, sh] = rect(f.x, f.z, f.w, f.d);
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.strokeRect(sx - 3, sy - 3, sw + 6, sh + 6); ctx.setLineDash([]);
    for (const [hx, hy] of handles()) { ctx.fillStyle = '#ffd34d'; ctx.fillRect(hx - 5, hy - 5, 10, 10); }
  }
  // tool ghost under the mouse
  if (tool && mouse.inside) {
    const e = { ...tool.make(), x: snap(mouse.x), z: snap(mouse.z) };
    const f = footprint(e);
    ctx.globalAlpha = 0.5; ctx.fillStyle = hex(tool.color);
    ctx.fillRect(...rect(f.x, f.z, f.w, f.d)); ctx.globalAlpha = 1;
  }
  // scale bar
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(cw - 20 - 5 * view.scale, ch - 18, 5 * view.scale, 3);
  ctx.font = '11px system-ui'; ctx.textAlign = 'right'; ctx.fillText('5 m', cw - 20, ch - 24);
  $('hint').textContent = mouse.inside ? `x ${mouse.x.toFixed(1)}  z ${mouse.z.toFixed(1)}` : '';
}

// is a compiled thing the mirrored copy of a source element?
function isGhostPoint(x, z, t) {
  return !src.elements.some((e) => e.t === t && Math.abs(e.x - x) < 0.01 && Math.abs(e.z - z) < 0.01);
}
function isGhostRamp(r) {
  return !src.elements.some((e) => {
    if (e.t === 'ramp') return Math.abs(e.x - r.x) < 0.01 && Math.abs(e.z - r.z) < 0.01;
    if (e.t === 'lookout') { const f = footprint(e); return Math.abs(f.x - r.x) < f.w / 2 + 0.01 && Math.abs(f.z - r.z) < f.d / 2 + 0.01; }
    return false;
  });
}

// resize handles (boxes: corners change width/depth; bushes and dirt: radius)
function handles() {
  const e = src.elements[sel];
  if (!e || !['box', 'bush', 'dirt'].includes(e.t)) return [];
  const f = footprint(e);
  // tiny on screen: no handles, so grabbing the middle always moves it
  if (Math.min(f.w, f.d) * view.scale < 26) return [];
  if (e.t !== 'box') return [toScreen(e.x + e.r, e.z)];
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => toScreen(f.x + sx * f.w / 2, f.z + sz * f.d / 2));
}

// ---- picking -------------------------------------------------------------------------------------
function pick(x, z) {
  const order = src.elements.map((e, i) => i).sort((a, b) => prio(src.elements[a]) - prio(src.elements[b]));
  const test = (px, pz) => {
    for (const i of order) {
      const f = footprint(src.elements[i]);
      const hw = Math.max(f.w / 2, 0.35), hd = Math.max(f.d / 2, 0.35);
      if (Math.abs(px - f.x) <= hw && Math.abs(pz - f.z) <= hd) return i;
    }
    return -1;
  };
  const i = test(x, z);
  if (i >= 0 || !src.mirror) return i;
  return test(-x, -z);   // clicking a mirrored copy selects the original
}
// smaller / higher things first so they can be picked on top of big ones
function prio(e) {
  if (e.t === 'item') return 0;
  if (e.t === 'box') return 1 + (e.y >= 1.5 ? -0.5 : 0) + e.w * e.d / 100;
  if (e.t === 'bush') return 2;
  if (e.t === 'dirt') return 9;
  return 3;
}

// ---- mouse ----------------------------------------------------------------------------------------
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousemove', (ev) => {
  const r = canvas.getBoundingClientRect();
  mouse.sx = ev.clientX - r.left; mouse.sy = ev.clientY - r.top; mouse.inside = true;
  [mouse.x, mouse.z] = toWorld(mouse.sx, mouse.sy);
  if (drag?.kind === 'pan') {
    view.cx = drag.cx - (mouse.sx - drag.sx) / view.scale; view.cz = drag.cz - (mouse.sy - drag.sy) / view.scale;
  } else if (drag?.kind === 'move') {
    const e = src.elements[sel];
    e.x = clampX(snap(mouse.x - drag.ox, ev.altKey)); e.z = clampZ(snap(mouse.z - drag.oz, ev.altKey));
    changed();
    return;
  } else if (drag?.kind === 'resize') {
    const e = src.elements[sel];
    if (e.t === 'box') {
      // the opposite corner stays put
      const nx = snap(mouse.x, ev.altKey), nz = snap(mouse.z, ev.altKey);
      const w = Math.max(0.1, Math.abs(nx - drag.ax)), d = Math.max(0.1, Math.abs(nz - drag.az));
      e.w = Math.round(w * 100) / 100; e.d = Math.round(d * 100) / 100;
      e.x = (nx + drag.ax) / 2; e.z = (nz + drag.az) / 2;
    } else e.r = Math.max(0.6, Math.round(Math.hypot(mouse.x - e.x, mouse.z - e.z) * 4) / 4);
    changed();
    return;
  }
  canvas.style.cursor = tool ? 'crosshair' : (handleAt(mouse.sx, mouse.sy) >= 0 ? 'nwse-resize' : pick(mouse.x, mouse.z) >= 0 ? 'move' : 'default');
  draw();
});
canvas.addEventListener('mouseleave', () => { mouse.inside = false; draw(); });
function handleAt(sx, sy) { return handles().findIndex(([hx, hy]) => Math.abs(hx - sx) < 8 && Math.abs(hy - sy) < 8); }
const clampX = (x) => Math.max(-src.width / 2, Math.min(src.width / 2, x));
const clampZ = (z) => Math.max(-src.depth / 2, Math.min(src.depth / 2, z));

canvas.addEventListener('mousedown', (ev) => {
  if (ev.button === 1 || ev.button === 2 || spaceDown) {
    if (ev.button === 2 && tool) { setTool(null); return; }
    drag = { kind: 'pan', sx: mouse.sx, sy: mouse.sy, cx: view.cx, cz: view.cz };
    userView = true;
    return;
  }
  if (tool) {
    snapshot();
    const e = { ...tool.make(), x: clampX(snap(mouse.x, ev.altKey)), z: clampZ(snap(mouse.z, ev.altKey)) };
    src.elements.push(e);
    sel = src.elements.length - 1;
    changed(true);
    return;
  }
  const h = handleAt(mouse.sx, mouse.sy);
  if (h >= 0) {
    snapshot();
    const e = src.elements[sel], f = footprint(e);
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    drag = e.t === 'box' ? { kind: 'resize', ax: f.x - corners[h][0] * f.w / 2, az: f.z - corners[h][1] * f.d / 2 } : { kind: 'resize' };
    return;
  }
  const i = pick(mouse.x, mouse.z);
  if (i !== sel) { sel = i; buildProps(); }
  if (i >= 0) {
    snapshot();
    const e = src.elements[i];
    // picked through its mirrored copy: drag relative to the copy
    const mirrored = Math.abs(footprint(e).x - mouse.x) > footprint(e).w / 2 + 0.4 || Math.abs(footprint(e).z - mouse.z) > footprint(e).d / 2 + 0.4;
    drag = mirrored ? { kind: 'pan', sx: mouse.sx, sy: mouse.sy, cx: view.cx, cz: view.cz } : { kind: 'move', ox: mouse.x - e.x, oz: mouse.z - e.z };
    if (mirrored) undoStack.pop();
  } else drag = { kind: 'pan', sx: mouse.sx, sy: mouse.sy, cx: view.cx, cz: view.cz };
  draw();
});
addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  userView = true;
  const [wx, wz] = toWorld(mouse.sx, mouse.sy);
  view.scale = Math.min(80, Math.max(3, view.scale * Math.exp(-ev.deltaY * 0.0015)));
  const [nx, nz] = toWorld(mouse.sx, mouse.sy);
  view.cx += wx - nx; view.cz += wz - nz;
  draw();
}, { passive: false });

// ---- keyboard --------------------------------------------------------------------------------------
addEventListener('keydown', (ev) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName);
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.code === 'KeyZ') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && ev.code === 'KeyY') { ev.preventDefault(); redo(); return; }
  if (mod && ev.code === 'KeyS') { ev.preventDefault(); save(); return; }
  if (typing) return;
  if (ev.code === 'Space') { spaceDown = true; ev.preventDefault(); }
  if (ev.code === 'Escape') { setTool(null); sel = -1; buildProps(); draw(); }
  if (sel < 0) return;
  const e = src.elements[sel];
  if (ev.code === 'Delete' || ev.code === 'Backspace') { ev.preventDefault(); removeSel(); }
  if (ev.code === 'KeyR') rotateSel();
  if (mod && ev.code === 'KeyD') { ev.preventDefault(); duplicateSel(); }
  const step = ev.shiftKey ? 1 : 0.25;
  const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.code];
  if (nudge) { ev.preventDefault(); snapshot(); e.x = clampX(e.x + nudge[0]); e.z = clampZ(e.z + nudge[1]); changed(); }
});
addEventListener('keyup', (ev) => { if (ev.code === 'Space') spaceDown = false; });

function removeSel() { snapshot(); src.elements.splice(sel, 1); sel = -1; changed(true); }
function duplicateSel() {
  snapshot();
  const e = { ...src.elements[sel] };
  e.x = clampX(e.x + 1); e.z = clampZ(e.z + 1);
  src.elements.push(e); sel = src.elements.length - 1; changed(true);
}
function rotateSel() {
  const e = src.elements[sel];
  snapshot();
  if (e.t === 'box') [e.w, e.d] = [e.d, e.w];
  else if ('rot' in e) e.rot = (e.rot + 1) % 4;
  changed(true);
}

// ---- left panel: settings and palette --------------------------------------------------------------
const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
function fillSettings() {
  $('m-name').value = src.name; $('m-desc').value = src.desc;
  $('m-width').value = src.width; $('m-depth').value = src.depth;
  $('m-theme').innerHTML = opts(THEME_NAMES, src.theme);
  $('m-edge').innerHTML = opts(EDGE_NAMES, src.edge);
  $('m-base').innerHTML = opts(BASE_KINDS, src.baseKind);
  $('m-mirror').checked = src.mirror;
}
const settingInputs = { 'm-name': 'name', 'm-desc': 'desc', 'm-width': 'width', 'm-depth': 'depth', 'm-theme': 'theme', 'm-edge': 'edge', 'm-base': 'baseKind' };
for (const [id, key] of Object.entries(settingInputs)) {
  $(id).addEventListener('focus', () => snapshot());
  $(id).addEventListener('change', () => {
    const v = $(id).value;
    src[key] = key === 'width' || key === 'depth' ? Math.max(key === 'width' ? 30 : 24, Math.min(key === 'width' ? 120 : 90, Number(v) || 50)) : v;
    if (key === 'width' || key === 'depth') { $(id).value = src[key]; fitView(); }
    changed();
  });
}
$('m-mirror').addEventListener('change', () => { snapshot(); src.mirror = $('m-mirror').checked; changed(); });

function buildPalette() {
  const groups = {};
  for (const p of PALETTE) (groups[p.group] ||= []).push(p);
  $('palette').innerHTML = GROUP_ORDER.filter((g) => groups[g]).map((g, gi) => `
    <details${gi < 3 ? ' open' : ''}><summary>${g}</summary><div class="pal">${groups[g].map((p) =>
      `<button data-i="${PALETTE.indexOf(p)}" title="${esc(p.label)}"><i style="background:${hex(p.color)}"></i>${esc(p.label)}</button>`).join('')}</div></details>`).join('');
  $('palette').querySelectorAll('button').forEach((b) => { b.onclick = () => setTool(tool === PALETTE[b.dataset.i] ? null : PALETTE[b.dataset.i]); });
}
function setTool(t) {
  tool = t;
  $('palette').querySelectorAll('button').forEach((b) => b.classList.toggle('on', PALETTE[b.dataset.i] === t));
  $('tool-chip').style.display = t ? 'block' : 'none';
  $('tool-chip').textContent = t ? `Placing: ${t.label} — click the map · Esc to stop` : '';
  draw();
}

// ---- right panel: properties of the selected element ------------------------------------------------
const TYPE_NAMES = { box: 'Object', lookout: 'Lookout', ramp: 'Ramp', booth: 'Game booth', carousel: 'Carousel', bush: 'Hiding spot', item: 'Weapon', dirt: 'Dirt patch' };
function field(key, label, step = 0.1) { return `<div><label>${label}</label><input type="number" data-k="${key}" step="${step}"></div>`; }
function buildProps() {
  const e = src.elements[sel];
  if (!e) { $('props').innerHTML = '<div class="muted">Click an element on the map to change its size, height or position.</div>'; return; }
  let h = '';
  if (e.t === 'box') {
    const groups = {};
    for (const [k, K] of Object.entries(BOX_KINDS)) (groups[K.group] ||= []).push([k, K.label]);
    h += `<label>Type</label><select data-k="kind">${Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map(([k, l]) => `<option value="${k}"${k === e.kind ? ' selected' : ''}>${l}</option>`).join('')}</optgroup>`).join('')}</select>`;
    h += `<div class="grid2">${field('x', 'X (m)')}${field('z', 'Z (m)')}${field('w', 'Width (m)')}${field('d', 'Depth (m)')}${field('h', 'Height (m)')}${field('y', 'Lifted (m)')}</div>`;
    h += '<div class="muted" style="font-size:11px;margin-top:4px">Lifted = how high its bottom is (stack things, or make raised floors).</div>';
  } else if (e.t === 'lookout') {
    h += `<label>Style</label><select data-k="style">${opts({ wood: 'Wooden lookout', steel: 'Steel lookout', windmill: 'Windmill tower' }, e.style)}</select>`;
    h += `<div class="grid2">${field('x', 'X (m)')}${field('z', 'Z (m)')}</div>`;
    h += '<div class="muted" style="font-size:11px;margin-top:4px">Deck at 1.95 m with railings; its ramp comes with it. Press R to turn it.</div>';
  } else if (e.t === 'ramp') {
    h += `<label>Style</label><select data-k="kind">${opts({ wood: 'Wood', steel: 'Steel', rock: 'Rock slope' }, e.kind)}</select>`;
    h += `<div class="grid2">${field('x', 'X (m)')}${field('z', 'Z (m)')}${field('len', 'Length (m)')}${field('width', 'Width (m)')}${field('h', 'Top height (m)')}</div>`;
    h += '<div class="muted" style="font-size:11px;margin-top:4px">The arrow points uphill. Press R to turn it.</div>';
  } else if (e.t === 'bush') {
    h += `<label>Type</label><select data-k="kind">${opts(Object.fromEntries(Object.entries(BUSH_KINDS).map(([k, K]) => [k, K.label])), e.kind)}</select>`;
    h += `<div class="grid2">${field('x', 'X (m)')}${field('z', 'Z (m)')}${field('r', 'Radius (m)')}${field('h', 'Height (m)')}</div>`;
  } else if (e.t === 'item') {
    h += `<label>Weapon</label><select data-k="w">${WEAPON_ITEMS.map(([w, l]) => `<option value="${w}"${w === e.w ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    h += `<div class="grid2">${field('x', 'X (m)')}${field('z', 'Z (m)')}</div>`;
    h += `<label class="check"><input type="checkbox" data-k="ground"${e.ground ? ' checked' : ''}> On the ground (e.g. under a deck)</label>`;
    h += '<div class="muted" style="font-size:11px;margin-top:4px">Otherwise it sits on top of whatever is under it (a deck, a roof, a crate).</div>';
  } else if (e.t === 'dirt') {
    h += `<div class="grid3">${field('x', 'X')}${field('z', 'Z')}${field('r', 'Radius')}</div>`;
  } else {
    h += `<div class="grid2">${field('x', 'X (m)')}${field('z', 'Z (m)')}</div>`;
  }
  h += `<div class="actions">${'rot' in e || e.t === 'box' ? '<button data-a="rot">Rotate (R)</button>' : ''}<button data-a="dup">Duplicate</button><button data-a="del" class="danger">Delete</button></div>`;
  $('props').innerHTML = `<div style="font-weight:600;margin-bottom:4px">${TYPE_NAMES[e.t]}</div>${h}`;
  $('props').querySelectorAll('[data-k]').forEach((inp) => {
    inp.addEventListener('focus', () => snapshot());
    inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input', () => {
      const k = inp.dataset.k, el = src.elements[sel];
      if (!el) return;
      if (inp.type === 'checkbox') el[k] = inp.checked;
      else if (inp.tagName === 'SELECT') {
        el[k] = k === 'w' ? Number(inp.value) : inp.value;
        if (el.t === 'box' && k === 'kind') { const K = BOX_KINDS[el.kind]; Object.assign(el, { w: K.w, d: K.d, h: K.h, y: K.y || 0 }); }
        if (el.t === 'bush' && k === 'kind') { const K = BUSH_KINDS[el.kind]; Object.assign(el, { r: K.r, h: K.h }); }
      } else {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        el[k] = v;
      }
      changed(inp.tagName === 'SELECT');
    });
  });
  $('props').querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => ({ rot: rotateSel, dup: duplicateSel, del: removeSel })[b.dataset.a]();
  });
  refreshPropValues();
}
function refreshPropValues() {
  const e = src.elements[sel];
  if (!e) return;
  $('props').querySelectorAll('input[type=number]').forEach((inp) => {
    if (document.activeElement === inp) return;
    const v = e[inp.dataset.k];
    inp.value = v === undefined ? '' : Math.round(v * 100) / 100;
  });
}

function renderIssues() {
  const el = $('issues');
  if (!issues.length) { el.innerHTML = '<div class="ok">✓ No problems found</div>'; return; }
  el.innerHTML = issues.map((i, n) => `<div data-n="${n}">${esc(i.text)}</div>`).join('');
  el.querySelectorAll('div[data-n]').forEach((d) => {
    d.onclick = () => { const i = issues[d.dataset.n]; view.cx = i.x; view.cz = i.z; view.scale = Math.max(view.scale, 18); if (preview.on) toggle3D(); draw(); };
  });
}

// ---- files and server -----------------------------------------------------------------------------
// Saving and deleting need the server's admin password, when it has one.
async function adminFetch(url, options) {
  const send = () => fetch(url, { ...options, headers: { ...options.headers, 'X-Admin-Password': sessionStorage.getItem('pb-admin') || '' } });
  let r = await send();
  if (r.status === 401) {
    const pw = prompt('Map editor password');
    if (pw === null) return r;
    sessionStorage.setItem('pb-admin', pw);
    r = await send();
  }
  return r;
}

async function save() {
  setStatus('Saving…');
  try {
    const r = await adminFetch('/api/maps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(src) });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || r.statusText);
    src.id = res.id;
    registerCustom(src);
    dirty = false;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(src)); } catch { /* ignore */ }
    setStatus(`Saved “${src.name}” — it's in the lobby and the map vote now`);
    return true;
  } catch (e) { setStatus(`Could not save: ${e.message}`); return false; }
}
$('b-save').onclick = save;
$('b-new').onclick = () => {
  if (dirty && src.elements.length && !confirm('Start a new map? Unsaved changes to this one will be lost.')) return;
  snapshot(); src = blank(); sel = -1; fitView(); changed(true); dirty = false; setStatus('New map');
};
$('b-undo').onclick = undo; $('b-redo').onclick = redo;
$('b-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(src, null, 1)], { type: 'application/json' }));
  a.download = `${src.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'map'}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('b-import').onclick = () => $('file').click();
$('file').onchange = async () => {
  const f = $('file').files[0]; if (!f) return;
  try { snapshot(); src = sanitizeSource(JSON.parse(await f.text())); src.id = ''; sel = -1; fitView(); changed(true); setStatus(`Imported ${f.name} — press Save to add it to the game`); }
  catch (e) { setStatus(`Not a map file: ${e.message}`); }
  $('file').value = '';
};
$('b-open').onclick = async () => {
  let list = [];
  try { list = await (await fetch('/api/maps')).json(); } catch { /* offline */ }
  $('open-list').innerHTML = list.length ? list.map((m) => `<div class="maprow"><span>${esc(m.name)} <small>${m.width}×${m.depth} m · ${m.elements.length} elements</small></span>
      <button data-open="${m.id}">Open</button><button class="danger" data-del="${m.id}">Delete</button></div>`).join('')
    : '<div class="muted">No saved maps yet.</div>';
  $('builtin-list').innerHTML = Object.values(MAPS).filter((m) => !m.custom).map((m) => `<div class="maprow"><span>${esc(m.name)}</span><button data-copy="${m.id}">Copy &amp; edit</button></div>`).join('');
  $('open-dlg').querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { snapshot(); src = sanitizeSource(list.find((m) => m.id === b.dataset.open)); sel = -1; fitView(); changed(true); dirty = false; setStatus(`Opened ${src.name}`); $('open-dlg').close(); }; });
  $('open-dlg').querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const m = list.find((x) => x.id === b.dataset.del);
      if (!confirm(`Delete “${m.name}” from the server? This can't be undone.`)) return;
      const r = await adminFetch(`/api/maps/${m.id}`, { method: 'DELETE' });
      if (!r.ok) { alert((await r.json()).error || 'Could not delete the map'); return; }
      if (src.id === m.id) src.id = '';
      $('open-dlg').close(); $('b-open').onclick();
    };
  });
  $('open-dlg').querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { snapshot(); src = sanitizeSource(sourceFromMap(MAPS[b.dataset.copy])); sel = -1; fitView(); changed(true); setStatus(`Copy of ${MAPS[b.dataset.copy].name} — press Save to keep it`); $('open-dlg').close(); }; });
  $('open-dlg').showModal();
};
$('open-close').onclick = () => $('open-dlg').close();
$('b-play').onclick = async () => {
  if (!(await save())) return;
  window.open(`/?map=${encodeURIComponent(src.id)}&room=${encodeURIComponent(src.id)}`, '_blank');
};

// ---- 3D preview (loaded on first use) -------------------------------------------------------------
const preview = {
  on: false, timer: 0, world: null, three: null,
  scheduleRebuild() { if (!this.on) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.rebuild(), 350); },
  async init() {
    if (this.three) return;
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { World } = await import('./world.js');
    const { ItemsView } = await import('./items.js');
    const { groundHeight } = await import('/shared/physics.js');
    const c = $('c3d');
    const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    camera.position.set(0, 38, 46);
    const controls = new OrbitControls(camera, c);
    controls.target.set(0, 0, 0); controls.maxPolarAngle = Math.PI / 2 - 0.05; controls.enableDamping = true;
    const items = new ItemsView(scene);
    const markers = new THREE.Group(); scene.add(markers);
    this.three = { THREE, World, renderer, scene, camera, controls, items, markers, groundHeight };
    let last = performance.now();
    renderer.setAnimationLoop(() => {
      if (!this.on) return;
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
      controls.update();
      if (this.world) {
        for (const f of this.world.anim) f(dt);
        for (const m of this.world.windmills || []) m.rotor.rotation.z += dt * m.speed;
      }
      items.update(dt);
      renderer.render(scene, camera);
    });
  },
  rebuild() {
    const T = this.three; if (!T) return;
    this.world?.dispose();
    const map = compileMap(src);
    this.world = new T.World(T.scene, map, T.renderer);
    this.world.setShadows(true);
    T.items.clear();
    T.items.sync(map.items.map((it, i) => [i + 1, it.w, it.x, it.y ?? T.groundHeight(map, it.x, it.z, 10, 0.2), it.z, 0, 0, 0, 1]));
    T.markers.clear();
    map.spawns.forEach((team, t) => team.forEach(([x, y, z]) => {
      const cone = new T.THREE.Mesh(new T.THREE.ConeGeometry(0.35, 0.8, 12), new T.THREE.MeshBasicMaterial({ color: TEAM_COLORS[t] }));
      cone.position.set(x, 1.2, z); cone.rotation.x = Math.PI; T.markers.add(cone);
    }));
  },
};
async function toggle3D() {
  preview.on = !preview.on;
  $('stage').classList.toggle('preview', preview.on);
  $('b-3d').classList.toggle('on', preview.on);
  $('b-3d').textContent = preview.on ? 'Top view' : '3D view';
  if (preview.on) { await preview.init(); preview.rebuild(); }
  else draw();
}
$('b-3d').onclick = toggle3D;

// ---- start -----------------------------------------------------------------------------------------
buildPalette();
addEventListener('resize', resize);
resize();
fitView();
changed(true);
dirty = false;
setStatus(src.id ? `Editing ${src.name}` : 'Draw your map, then press Save');
