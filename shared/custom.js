// Custom maps made in the map editor. A custom map is stored as a small "source" document
// (settings + a list of elements) and compiled into the same map format the built-in maps use.
// Used by the server (save / load / validate), the game client and the editor.
import { W } from './constants.js';
import { buildMap, base, lookout, lookoutRamp, booth, MAPS } from './maps.js';
import { resolveCollisions, groundHeight } from './physics.js';

// Box elements: default size (w along x, d along z, h height, y bottom), label and palette group.
export const BOX_KINDS = {
  crate: { w: 1, d: 1, h: 1, label: 'Crate', group: 'Cover' },
  hay: { w: 1.2, d: 0.65, h: 0.65, label: 'Hay bale', group: 'Cover' },
  plank: { w: 3, d: 0.15, h: 1.6, label: 'Plank wall', group: 'Cover' },
  block: { w: 2.6, d: 0.6, h: 1.2, label: 'Concrete barrier', group: 'Cover' },
  container: { w: 4.6, d: 2.3, h: 2.4, label: 'Container', group: 'Cover' },
  lumber: { w: 2.4, d: 1.4, h: 1.2, label: 'Lumber stack', group: 'Cover' },
  spool: { w: 1.2, d: 1.2, h: 0.95, label: 'Cable spool', group: 'Cover' },
  tires: { w: 0.95, d: 0.95, h: 0.75, label: 'Tire stack', group: 'Cover' },
  barrel: { w: 0.7, d: 0.7, h: 1, label: 'Barrel', group: 'Cover' },
  rock: { w: 2.4, d: 2, h: 1.6, label: 'Boulder', group: 'Cover' },
  pile: { w: 2.6, d: 2.6, h: 1.5, label: 'Gravel pile', group: 'Cover' },
  car: { w: 4.1, d: 1.9, h: 1.45, label: 'Car', group: 'Cover' },
  truck: { w: 4.4, d: 2.1, h: 2.6, label: 'Dump truck', group: 'Cover' },
  tractor: { w: 3.2, d: 1.8, h: 1.9, label: 'Tractor', group: 'Cover' },
  bumpercar: { w: 1.4, d: 1, h: 0.7, label: 'Bumper car', group: 'Cover' },
  pad: { w: 3, d: 0.3, h: 0.9, label: 'Padded wall', group: 'Cover' },
  trough: { w: 2.2, d: 0.7, h: 0.8, label: 'Water trough', group: 'Cover' },
  rail: { w: 4, d: 0.15, h: 1, label: 'Ranch fence', group: 'Cover' },
  shed: { w: 3, d: 2.2, h: 2.2, label: 'Shed', group: 'Buildings' },
  silo: { w: 3.2, d: 3.2, h: 8, label: 'Silo', group: 'Buildings' },
  tank: { w: 5, d: 5, h: 4.5, label: 'Water tank', group: 'Buildings' },
  pipe: { w: 9, d: 1, h: 1, label: 'Big pipe', group: 'Buildings' },
  kiosk: { w: 1.6, d: 1.6, h: 2.4, label: 'Ticket booth', group: 'Buildings' },
  tent: { w: 4, d: 4, h: 2.6, label: 'Tent', group: 'Buildings' },
  machine: { w: 3, d: 1.6, h: 1.6, label: 'Generator', group: 'Buildings' },
  counter: { w: 3, d: 0.8, h: 1, label: 'Counter', group: 'Buildings' },
  stucco: { w: 4, d: 0.25, h: 2.6, label: 'Stucco wall', group: 'Walls & floors' },
  brick: { w: 4, d: 0.25, h: 2.6, label: 'Brick wall', group: 'Walls & floors' },
  barn: { w: 4, d: 0.25, h: 2.6, label: 'Barn wall', group: 'Walls & floors' },
  deck: { w: 3.6, d: 3, h: 0.15, y: 1.8, label: 'Wood floor (raised)', group: 'Walls & floors' },
  steel: { w: 3.6, d: 3, h: 0.15, y: 1.8, label: 'Steel floor (raised)', group: 'Walls & floors' },
  roofdeck: { w: 6, d: 4, h: 0.2, y: 2.6, label: 'Flat roof', group: 'Walls & floors' },
  post: { w: 0.2, d: 0.2, h: 2.9, label: 'Wood post', group: 'Walls & floors' },
  beam: { w: 0.2, d: 0.2, h: 2.9, label: 'Steel post', group: 'Walls & floors' },
  railing: { w: 3, d: 0.12, h: 0.95, y: 1.95, label: 'Steel railing', group: 'Walls & floors' },
  mesa: { w: 6, d: 4, h: 1.9, label: 'Rock plateau', group: 'Walls & floors' },
  loft: { w: 4, d: 4, h: 0.15, y: 2.6, label: 'Loft floor', group: 'Walls & floors' },
  slab: { w: 5, d: 4, h: 0.2, y: 2.6, label: 'Concrete roof', group: 'Walls & floors' },
  parapet: { w: 4, d: 0.15, h: 0.6, y: 2.8, label: 'Neon roof edge', group: 'Walls & floors' },
  speaker: { w: 0.2, d: 0.2, h: 1.3, label: 'Speaker post', group: 'Cover' },
  lamppost: { w: 0.3, d: 0.3, h: 4.2, label: 'Lamp post', group: 'Lights' },
  flood: { w: 0.4, d: 0.4, h: 6, label: 'Floodlight', group: 'Lights' },
};

export const BUSH_KINDS = {
  bush: { r: 1.3, h: 1.7, label: 'Bush' },
  corn: { r: 2, h: 2.1, label: 'Corn patch' },
  hedge: { r: 1.2, h: 1.6, label: 'Hedge' },
  scrub: { r: 1.3, h: 1.7, label: 'Dry scrub' },
};

export const WEAPON_ITEMS = [
  [W.SHOTGUN, 'Shotgun'], [W.BURST, 'Burst rifle'], [W.SNIPER, 'Scope rifle'], [W.LAUNCHER, 'Launcher'],
  [W.SPRAYER, 'Sprayer'], [W.GRENADE, 'Grenade'], [W.MINE, 'Mine'], [W.SHIELD, 'Shield'], [W.MALLET, 'Mallet'], [W.PISTOL, 'Pistol'],
];

export const THEME_NAMES = { day: 'Sunny day', quarry: 'Dusty quarry', dusk: 'Dusk', night: 'Night', fair: 'Carnival night' };
export const EDGE_NAMES = { fence: 'Wooden fence', cliff: 'Rock cliffs', chainlink: 'Chain-link fence' };
export const BASE_KINDS = { plank: 'Plank walls', block: 'Concrete barriers', pad: 'Padded walls', none: 'No base walls' };

// ---- sanitizing (anything coming from the network or a file) ------------------------------------
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const str = (v, max, def = '') => (typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, max) : def);
const pick = (v, obj, def) => (Object.prototype.hasOwnProperty.call(obj, v) ? v : def);
const r2 = (n) => Math.round(n * 100) / 100;

export function sanitizeSource(src) {
  src = src && typeof src === 'object' ? src : {};
  const width = num(src.width, 30, 120, 70), depth = num(src.depth, 24, 90, 50);
  const hx = width / 2, hz = depth / 2;
  const out = {
    id: /^c-[a-z0-9-]{1,40}$/.test(src.id || '') ? src.id : '',
    name: str(src.name, 40, 'My Map').trim() || 'My Map',
    desc: str(src.desc, 120),
    width, depth,
    theme: pick(src.theme, THEME_NAMES, 'day'),
    edge: pick(src.edge, EDGE_NAMES, 'fence'),
    baseKind: pick(src.baseKind, BASE_KINDS, 'plank'),
    mirror: src.mirror !== false,
    elements: [],
  };
  const weapons = new Set(WEAPON_ITEMS.map(([w]) => w));
  for (const e of (Array.isArray(src.elements) ? src.elements : []).slice(0, 800)) {
    if (!e || typeof e !== 'object') continue;
    const x = r2(num(e.x, -hx, hx, 0)), z = r2(num(e.z, -hz, hz, 0)), rot = Math.round(num(e.rot, 0, 3, 0));
    switch (e.t) {
      case 'box': {
        const kind = pick(e.kind, BOX_KINDS, null);
        if (!kind) break;
        const K = BOX_KINDS[kind];
        out.elements.push({ t: 'box', kind, x, z, w: r2(num(e.w, 0.1, 40, K.w)), d: r2(num(e.d, 0.1, 40, K.d)), h: r2(num(e.h, 0.05, 12, K.h)), y: r2(num(e.y, 0, 10, K.y || 0)) });
        break;
      }
      case 'lookout': out.elements.push({ t: 'lookout', style: pick(e.style, { wood: 1, steel: 1, windmill: 1 }, 'wood'), x, z, rot }); break;
      case 'ramp': out.elements.push({ t: 'ramp', kind: pick(e.kind, { wood: 1, steel: 1, rock: 1 }, 'wood'), x, z, rot, len: r2(num(e.len, 1, 12, 4.5)), width: r2(num(e.width, 0.8, 6, 1.2)), h: r2(num(e.h, 0.2, 5, 1.95)) }); break;
      case 'booth': out.elements.push({ t: 'booth', x, z, rot }); break;
      case 'carousel': out.elements.push({ t: 'carousel', x, z }); break;
      case 'bush': {
        const kind = pick(e.kind, BUSH_KINDS, 'bush'), K = BUSH_KINDS[kind];
        out.elements.push({ t: 'bush', kind, x, z, r: r2(num(e.r, 0.6, 4, K.r)), h: r2(num(e.h, 1, 3, K.h)) });
        break;
      }
      case 'item': {
        const w = Number(e.w);
        if (weapons.has(w)) out.elements.push({ t: 'item', w, x, z, ground: !!e.ground });
        break;
      }
      case 'dirt': out.elements.push({ t: 'dirt', x, z, r: r2(num(e.r, 1, 10, 3)) }); break;
      default: break;
    }
  }
  return out;
}

// ---- compiling ------------------------------------------------------------------------------------
const ROT_DIR = ['+z', '-x', '-z', '+x'];   // a quarter turn maps +z -> -x -> -z -> +x
function rotXZ(x, z, k) { for (let i = 0; i < k; i++) [x, z] = [-z, x]; return [x, z]; }
function rotDir(dir, k) { return ROT_DIR[(ROT_DIR.indexOf(dir) + k) % 4]; }
// rotate a group of boxes/ramps built around (cx, cz) by k quarter turns
function turn(list, cx, cz, k) {
  if (!k) return list;
  return list.map((b) => {
    const [x, z] = rotXZ(b.x - cx, b.z - cz, k);
    const out = { ...b, x: cx + x, z: cz + z };
    if (k % 2) { out.w = b.d; out.d = b.w; }
    if (b.dir) out.dir = rotDir(b.dir, k);
    return out;
  });
}

// Footprint of one element (for the editor): { x, z, w, d } rectangle around it
export function footprint(e) {
  switch (e.t) {
    case 'box': return { x: e.x, z: e.z, w: e.w, d: e.d };
    case 'lookout': { const [ox, oz] = rotXZ(0, -2.25, e.rot); const odd = e.rot % 2; return { x: e.x + ox, z: e.z + oz, w: odd ? 7.5 : 3.6, d: odd ? 3.6 : 7.5 }; }
    case 'ramp': return e.rot % 2 ? { x: e.x, z: e.z, w: e.len, d: e.width } : { x: e.x, z: e.z, w: e.width, d: e.len };
    case 'booth': return e.rot % 2 ? { x: e.x, z: e.z, w: 1.6, d: 3 } : { x: e.x, z: e.z, w: 3, d: 1.6 };
    case 'carousel': return { x: e.x, z: e.z, w: 6, d: 6 };
    case 'bush': case 'dirt': return { x: e.x, z: e.z, w: e.r * 2, d: e.r * 2 };
    case 'item': return { x: e.x, z: e.z, w: 0.8, d: 0.8 };
    default: return { x: e.x, z: e.z, w: 1, d: 1 };
  }
}

export function compileMap(rawSrc) {
  const src = sanitizeSource(rawSrc);
  const hx = src.width / 2, hz = src.depth / 2;
  const half = [], ramps = [], items = [], bushes = [], dirt = [], windmills = [];
  const spawnX = -(hx - 4);
  if (src.baseKind !== 'none') half.push(...base(spawnX + 5, src.baseKind, src.baseKind === 'plank' ? 1.6 : 1.2, src.baseKind === 'plank' ? 0.2 : src.baseKind === 'pad' ? 0.4 : 0.6));
  for (const e of src.elements) {
    const center = !src.mirror || (Math.abs(e.x) < 0.05 && Math.abs(e.z) < 0.05);
    const c = (o) => ({ ...o, center });
    switch (e.t) {
      case 'box': half.push(c({ x: e.x, z: e.z, w: e.w, d: e.d, h: e.h, y: e.y, kind: e.kind })); break;
      case 'lookout': {
        const style = e.style === 'steel' ? 'steel' : 'wood';
        half.push(...turn(lookout(e.x, e.z, 3.6, 3.0, style), e.x, e.z, e.rot).map(c));
        ramps.push(...turn([lookoutRamp(e.x, e.z, style === 'steel' ? 'steel' : undefined)], e.x, e.z, e.rot).map(c));
        if (e.style === 'windmill') windmills.push(c({ x: e.x, z: e.z }));
        break;
      }
      case 'ramp': ramps.push(c({ x: e.x, z: e.z, w: e.rot % 2 ? e.len : e.width, d: e.rot % 2 ? e.width : e.len, h: e.h, dir: rotDir('+z', e.rot), kind: e.kind === 'wood' ? undefined : e.kind })); break;
      case 'booth': half.push(...booth(e.x, e.z, rotDir('+z', e.rot)).map(c)); break;
      case 'carousel':
        half.push(c({ x: e.x, z: e.z, w: 5.6, d: 5.6, h: 0.35, kind: 'carousel' }), c({ x: e.x, z: e.z, w: 1, d: 1, h: 3.4, y: 0.35, kind: 'carouselpole' }));
        break;
      case 'bush': bushes.push(c({ x: e.x, z: e.z, r: e.r, h: e.h, ...(e.kind === 'bush' ? {} : { kind: e.kind }) })); break;
      case 'item': items.push(c({ w: e.w, x: e.x, z: e.z, ground: e.ground })); break;
      case 'dirt': dirt.push([e.x, e.z, e.r]); break;
      default: break;
    }
  }
  const map = buildMap({
    id: src.id || 'c-draft', name: src.name, desc: src.desc || 'A custom map made in the editor.',
    hx, hz, spawnX, edge: src.edge, edgeH: src.edge === 'cliff' ? 4 : src.edge === 'chainlink' ? 2.4 : 1.5,
    theme: src.theme, half, ramps, items, bushes, dirt: [], windmills,
  });
  // buildMap mirrors dirt only point-symmetrically; honour the mirror switch ourselves
  map.dirt = src.mirror ? dirt.flatMap(([x, z, r]) => (Math.abs(x) < 0.05 && Math.abs(z) < 0.05 ? [[x, z, r]] : [[x, z, r], [-x, -z, r]])) : dirt;
  // weapons sit on the highest surface under them unless marked "on the ground"
  map.items = map.items.map(({ ground, y, ...it }) => ({ ...it, y: ground ? 0 : Math.round((groundHeight(map, it.x, it.z, 10, 0.2) + 0.02) * 100) / 100 }));
  map.custom = true;
  return map;
}

export function registerCustom(src) {
  const map = compileMap(src);
  MAPS[map.id] = map;
  return map;
}

// ---- layout check (warnings shown in the editor, never blocks saving) ------------------------------
const EDGES = ['fence', 'cliff', 'chainlink'];
export function validateMap(m) {
  const issues = [];
  const solid = m.boxes.filter((b) => !EDGES.includes(b.kind) && b.y < 1.7 && !['post', 'beam'].includes(b.kind));
  const ov = (a, b, pad = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad - 0.01 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad - 0.01;
  const add = (x, z, text) => { if (!issues.some((i) => i.text === text && Math.abs(i.x + x) < 0.01 && Math.abs(i.z + z) < 0.01)) issues.push({ x, z, text }); };
  for (const r of m.ramps) for (const b of solid) if (ov(r, b) && b.y < r.h - 0.3) add(r.x, r.z, `A ramp runs into a ${b.kind} (${b.x}, ${b.z})`);
  for (const it of m.items) {
    const y = it.y ?? 0;
    for (const b of m.boxes) if (y < b.y + b.h - 0.05 && y + 0.3 > b.y && ov({ x: it.x, z: it.z, w: 0.5, d: 0.5 }, b)) add(it.x, it.z, `A weapon is stuck inside a ${b.kind}`);
    if (Math.abs(it.x) > m.halfX - 0.5 || Math.abs(it.z) > m.halfZ - 0.5) add(it.x, it.z, 'A weapon is outside the field');
  }
  for (const t of m.spawns) for (const sp of t) {
    const p = sp.slice(); resolveCollisions(m, p, 0.3);
    if (Math.hypot(p[0] - sp[0], p[2] - sp[2]) > 0.01) add(sp[0], sp[2], 'A team spawn point is blocked');
  }
  for (const b of m.boxes) if (!EDGES.includes(b.kind) && (Math.abs(b.x) + b.w / 2 > m.halfX + 0.01 || Math.abs(b.z) + b.d / 2 > m.halfZ + 0.01)) add(b.x, b.z, `A ${b.kind} sticks out of the field`);
  for (const b of m.bushes) for (const t of m.spawns) for (const sp of t) if (Math.hypot(sp[0] - b.x, sp[2] - b.z) < b.r + 1.5) add(b.x, b.z, 'A bush covers a spawn point');
  const its = m.items.length;
  if (its === 0) issues.push({ x: 0, z: 0, text: 'No weapons placed yet: players will only have their pistols' });
  return issues;
}

export const BUILTIN = new Set(Object.keys(MAPS));

// Turn a built-in map into an editable source (approximate: roofs, lights strings and decor are dropped).
const DIR_ROT = { '+z': 0, '-x': 1, '-z': 2, '+x': 3 };
export function sourceFromMap(m) {
  const els = [];
  const kept = [];
  const isMirrorOfKept = (x, z) => kept.some(([kx, kz]) => Math.abs(kx + x) < 0.01 && Math.abs(kz + z) < 0.01);
  const once = (x, z) => { if (isMirrorOfKept(x, z)) return false; kept.push([x, z]); return true; };
  for (const b of m.boxes) {
    if (b.team === 1 || EDGES.includes(b.kind) || b.kind === 'boothback' || b.kind === 'carouselpole') continue;
    if (b.kind === 'booth') {
      const s = b.dir[0] === '+' ? 0.4 : -0.4, alongZ = b.dir[1] === 'z';
      els.push({ t: 'booth', x: b.x - (alongZ ? 0 : s), z: b.z - (alongZ ? s : 0), rot: DIR_ROT[b.dir] });
      continue;
    }
    if (b.kind === 'carousel') { els.push({ t: 'carousel', x: b.x, z: b.z }); continue; }
    els.push({ t: 'box', kind: BOX_KINDS[b.kind] ? b.kind : 'crate', x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, y: b.y || 0 });
  }
  kept.length = 0;
  for (const r of m.ramps) if (once(r.x, r.z)) {
    const rot = DIR_ROT[r.dir] ?? 0;
    els.push({ t: 'ramp', kind: r.kind || 'wood', x: r.x, z: r.z, rot, len: rot % 2 ? r.w : r.d, width: rot % 2 ? r.d : r.w, h: r.h });
  }
  kept.length = 0;
  for (const it of m.items) if (once(it.x, it.z)) els.push({ t: 'item', w: it.w, x: it.x, z: it.z, ground: it.y === 0 });
  kept.length = 0;
  for (const b of m.bushes) if (once(b.x, b.z)) els.push({ t: 'bush', kind: b.kind || 'bush', x: b.x, z: b.z, r: b.r, h: b.h });
  kept.length = 0;
  for (const [x, z, r] of m.dirt || []) if (once(x, z)) els.push({ t: 'dirt', x, z, r });
  return {
    id: '', name: `${m.name} (copy)`, desc: m.desc || '', width: m.halfX * 2, depth: m.halfZ * 2,
    theme: m.theme || 'day', edge: m.boxes.find((b) => EDGES.includes(b.kind))?.kind || 'fence', baseKind: 'none', mirror: true, elements: els,
  };
}
