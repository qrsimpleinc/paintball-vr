// Map definitions. Every map is plain data: axis-aligned boxes (collision + visual
// style), ramps, decorations and spawns.
// Boxes: { x, z } = center on the ground plane, w = size on X, d = size on Z,
// h = height, y = bottom (default 0), kind = visual style.
// Ramps: { x, z, w, d, h, dir } where dir is the direction the ramp rises toward.
// Team 0 plays from -X, team 1 from +X. Maps are point-symmetric, so we only
// describe team 0's half and mirror it.
import { W } from './constants.js';

const FLIP_DIR = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };

function mirror(items) {
  const out = [];
  for (const b of items) {
    const base = { y: 0, ...b };
    out.push({ ...base, team: 0 });
    if (b.center) continue; // pieces on the center point are not duplicated
    out.push({ ...base, x: -b.x, z: -b.z, dir: b.dir ? FLIP_DIR[b.dir] : undefined, team: 1 });
  }
  return out;
}

function boundary(halfX, halfZ, h = 1.5, kind = 'fence') {
  const t = 0.3;
  return [
    { x: 0, z: -halfZ - t / 2, w: halfX * 2 + t * 2, d: t, h, kind: 'fence' },
    { x: 0, z: halfZ + t / 2, w: halfX * 2 + t * 2, d: t, h, kind: 'fence' },
    { x: -halfX - t / 2, z: 0, w: t, d: halfZ * 2, h, kind: 'fence' },
    { x: halfX + t / 2, z: 0, w: t, d: halfZ * 2, h, kind: 'fence' },
  ].map((b) => ({ y: 0, ...b, kind }));
}

// A raised wooden lookout: deck on posts, railings, and a ramp rising toward +z.
// Players walk underneath (deck bottom is above head height).
const LOOKOUT_STYLE = {
  wood: { deck: 'deck', post: 'post', rail: 'plank' },
  steel: { deck: 'steel', post: 'beam', rail: 'railing' },
};
function lookout(x, z, w = 3.6, d = 3.0, style = 'wood') {
  const top = 1.95, rail = 0.95, t = 0.12, K = LOOKOUT_STYLE[style];
  const out = [
    { x, z, w, d, h: 0.15, y: 1.8, kind: K.deck },
    // corner posts
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({
      x: x + sx * (w / 2 - 0.1), z: z + sz * (d / 2 - 0.1), w: 0.2, d: 0.2, h: top + rail, kind: K.post,
    })),
    // railings: back, both sides, and front split around the ramp
    { x, z: z + d / 2 - t / 2, w, d: t, h: rail, y: top, kind: K.rail },
    { x: x - w / 2 + t / 2, z, w: t, d, h: rail, y: top, kind: K.rail },
    { x: x + w / 2 - t / 2, z, w: t, d, h: rail, y: top, kind: K.rail },
    { x: x - w / 2 + 0.6, z: z - d / 2 + t / 2, w: 1.2, d: t, h: rail, y: top, kind: K.rail },
    { x: x + w / 2 - 0.6, z: z - d / 2 + t / 2, w: 1.2, d: t, h: rail, y: top, kind: K.rail },
  ];
  return out;
}

// --- Lumberyard Lane: 80 x 52 m symmetric map, two lookouts per side ---------------
const S = 2; // the original layout is spread out by this factor, then extra cover fills the gaps
const at = (b) => ({ ...b, x: b.x * S, z: b.z * S });

const lumberyardHalf = [
  // center: big lumber stack
  { x: 0, z: 0, w: 3, d: 2, h: 1.9, kind: 'lumber', center: true },
  { x: 0, z: 0, w: 2.2, d: 1.4, h: 0.6, y: 1.9, kind: 'lumber', center: true },

  // team base: plank fort with a doorway, near the spawn
  { x: -31, z: -2.6, w: 0.2, d: 2.6, h: 2.2, kind: 'plank' },
  { x: -31, z: 2.6, w: 0.2, d: 2.6, h: 2.2, kind: 'plank' },
  { x: -31, z: -4, w: 0.25, d: 0.25, h: 2.6, kind: 'post', flag: true },
  { x: -31, z: 4, w: 0.25, d: 0.25, h: 2.6, kind: 'post', flag: true },
  { x: -33.5, z: -5.5, w: 3, d: 0.2, h: 1.6, kind: 'plank' },
  { x: -33.5, z: 5.5, w: 3, d: 0.2, h: 1.6, kind: 'plank' },

  // two lookouts (decks on posts, ramps added below)
  ...lookout(-18, 13),
  ...lookout(-30, -15),

  // original layout, spread out
  ...[
    { x: -12, z: -1, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
    { x: -12, z: -0.2, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
    { x: -5.5, z: -2.2, w: 0.65, d: 1.2, h: 0.65, kind: 'hay' },
    { x: -3, z: 9, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
    { x: -13, z: -9.5, w: 5, d: 2.3, h: 2.4, kind: 'container' },
    { x: -4.5, z: -10.6, w: 2.3, d: 4.6, h: 2.4, kind: 'container' },
    { x: -6, z: 2.2, w: 0.15, d: 2.6, h: 1.7, kind: 'plank' },
    { x: -11.8, z: 3.4, w: 2.6, d: 0.15, h: 1.5, kind: 'plank' },
    { x: -3.5, z: -5.5, w: 2.4, d: 0.15, h: 1.6, kind: 'plank' },
    { x: -8, z: -6, w: 1.2, d: 1.2, h: 0.95, kind: 'spool' },
    { x: -2.6, z: 2.6, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
    { x: -14.2, z: 8.5, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
    { x: -9.5, z: -2.8, w: 0.9, d: 0.9, h: 0.9, kind: 'crate' },
  ].map(at),
  { x: -4.6, z: 18.6, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -8.2, z: -9.75, w: 0.15, d: 2.2, h: 1.6, kind: 'plank' },

  // new cover filling the bigger field
  { x: -31, z: 21, w: 5, d: 2.3, h: 2.4, kind: 'container' },
  { x: -8, z: 20.5, w: 2.3, d: 4.6, h: 2.4, kind: 'container' },
  { x: -20, z: -1.5, w: 4.6, d: 2.3, h: 2.4, kind: 'container' },
  { x: -34, z: -12, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -34, z: -11.2, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -15, z: 22, w: 0.65, d: 1.2, h: 0.65, kind: 'hay' },
  { x: -3.5, z: -18, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -3.5, z: -18.8, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -3.5, z: -18.4, w: 1.2, d: 0.65, h: 0.6, y: 0.65, kind: 'hay' },
  { x: -26.5, z: 8.5, w: 0.65, d: 1.2, h: 0.65, kind: 'hay' },
  { x: -28, z: -1.5, w: 0.15, d: 3, h: 1.7, kind: 'plank' },
  { x: -12, z: 15, w: 3, d: 0.15, h: 1.6, kind: 'plank' },
  { x: -3, z: 11.5, w: 0.15, d: 3, h: 1.7, kind: 'plank' },
  { x: -15, z: -20.5, w: 3, d: 0.15, h: 1.6, kind: 'plank' },
  { x: -36, z: 9, w: 0.15, d: 2.6, h: 1.5, kind: 'plank' },
  { x: -10, z: -15, w: 0.15, d: 3, h: 1.7, kind: 'plank' },
  { x: -22, z: 21.5, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
  { x: -12, z: -23.5, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
  { x: -36.5, z: -20, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
  { x: -36.5, z: -19, w: 0.8, d: 0.8, h: 0.8, y: 1.0, kind: 'crate' },
  { x: -36.5, z: 20, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
  { x: -14.5, z: 4.5, w: 1.2, d: 1.2, h: 0.95, kind: 'spool' },
  { x: -34, z: -22, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
  { x: -1.5, z: 16, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
  { x: -12.5, z: -13.5, w: 2, d: 2, h: 1.6, kind: 'lumber' },
  { x: -21, z: 15.5, w: 2.4, d: 1.4, h: 1.2, kind: 'lumber' },
  { x: -2, z: -24, w: 3, d: 1.4, h: 1.4, kind: 'lumber' },
];

// weapons lying on the map (y omitted = on the ground / surface below)
const lumberyardItems = [
  { w: W.SNIPER, x: -18, y: 1.97, z: 13.4 },     // up on the north lookout
  { w: W.LAUNCHER, x: -30, y: 1.97, z: -14.6 },  // up on the south lookout
  { w: W.SHOTGUN, x: -21, z: 10.5 },             // under the north lookout
  { w: W.SHOTGUN, x: -10, z: -1.2 },             // mid-field, by the hay
  { w: W.SHOTGUN, x: -28.5, z: 15 },
  { w: W.BURST, x: -15, z: 7.8 },
  { w: W.BURST, x: -17, z: -8.5 },
  { w: W.SPRAYER, x: -2.4, z: 12 },
  { w: W.SPRAYER, x: -6, z: -15 },
  { w: W.LAUNCHER, x: -26, z: -7.2 },            // by the container
  { w: W.GRENADE, x: -24, z: 2.0 },
  { w: W.GRENADE, x: -29, z: -12 },
  { w: W.GRENADE, x: -5, z: -3.2 },              // contested, near the center
  { w: W.GRENADE, x: -9.5, z: 17 },
  { w: W.SHIELD, x: -20.8, z: -15.4 },
  { w: W.SHIELD, x: -33, z: 8 },
  { w: W.MINE, x: -14.4, z: -17.2 },
  { w: W.MINE, x: -33, z: 19 },
  { w: W.MINE, x: -1.5, z: -21.5 },
  { w: W.MALLET, x: -13.6, z: -7.2 },
  { w: W.MALLET, x: -11, z: 21 },
];

// leafy bushes you can walk into and hide in: { x, z, r (radius), h (height) }
const lumberyardBushes = [
  { x: -23, z: 4.5, r: 1.4, h: 1.75 },
  { x: -16, z: 18, r: 1.3, h: 1.7 },
  { x: -7, z: 7.5, r: 1.2, h: 1.7 },
  { x: -11, z: -9, r: 1.4, h: 1.8 },
  { x: -24, z: -10.5, r: 1.3, h: 1.7 },
  { x: -35, z: 15.5, r: 1.4, h: 1.75 },
  { x: -18, z: -23, r: 1.5, h: 1.8 },
  { x: -2.5, z: 23, r: 1.3, h: 1.7 },
  { x: -25, z: 23.5, r: 1.2, h: 1.7 },
  { x: -4.5, z: -12.5, r: 1.2, h: 1.7 },
  { x: -18.5, z: -13, r: 1.3, h: 1.75 },
  { x: -30, z: -6.5, r: 1.2, h: 1.7 },
];

const lumberyardRamps = [
  { x: -18, z: 9.25, w: 1.2, d: 4.5, h: 1.95, dir: '+z' },   // into the north lookout's front edge
  { x: -30, z: -18.75, w: 1.2, d: 4.5, h: 1.95, dir: '+z' }, // into the south lookout's front edge
];

const all = mirror(lumberyardHalf);
const HX = 40, HZ = 26;

export const MAPS = {
  lumberyard: {
    id: 'lumberyard',
    name: 'Lumberyard Lane',
    desc: 'Sunny timber yard: lookouts, containers and bushes to hide in.',
    halfX: HX,
    halfZ: HZ,
    boxes: [...all.map(({ flag, center, ...b }) => b), ...boundary(HX, HZ)],
    flags: all.filter((b) => b.flag).map((b) => ({ x: b.x, z: b.z, h: b.h, team: b.team })),
    ramps: mirror(lumberyardRamps).map(({ team, center, ...r }) => r),
    items: mirror(lumberyardItems).map(({ team, center, dir, ...it }) => it),
    bushes: mirror(lumberyardBushes).map(({ team, center, dir, y, ...b }) => b),
    // dirt paths painted on the grass: [x, z, radius]
    dirt: [
      [-34, 0, 5], [-28, 1, 3.4], [-20, 0, 3.6], [-12, 1, 3.4], [0, 0, 5.5], [-6, 0, 3],
      [-18, 7, 2.6], [-12, -12, 4], [-4, -16, 3], [-22, 13, 3.4], [-6, 13, 3], [-30, -11, 3],
      [-30, 14, 3], [-14, 20, 2.6], [-20, -20, 3], [-34, -18, 2.6],
    ],
    spawns: [
      [[-36, 0, -2], [-36, 0, 2], [-36.5, 0, -7], [-36.5, 0, 7]],
      [[36, 0, 2], [36, 0, -2], [36.5, 0, 7], [36.5, 0, -7]],
    ],
    spawnYaw: [-Math.PI / 2, Math.PI / 2], // facing toward the other team
  },
};
// mirror the dirt patches too
MAPS.lumberyard.dirt = MAPS.lumberyard.dirt.flatMap(([x, z, r]) => (x === 0 && z === 0 ? [[x, z, r]] : [[x, z, r], [-x, -z, r]]));


// --- Windmill Farm: 68 x 48 m, a big two-floor barn in the middle, windmill lookouts,
// silos, tractors and tall corn patches to hide in. ----------------------------------
const BARN = { x: 0, z: 0, w: 14, d: 9, floorY: 2.6, wallH: 5.2 };
const wallT = 0.25, loftT = 0.15, up = BARN.floorY + loftT; // upper floor surface = 2.75

const farmHalf = [
  // ---- barn (point-symmetric: each piece here gets a mirrored twin) ----
  // end wall at x = -7: lower part with a big door, upper part with a hay window
  { x: -7, z: -3, w: wallT, d: 3, h: BARN.floorY, kind: 'barn' },
  { x: -7, z: 3, w: wallT, d: 3, h: BARN.floorY, kind: 'barn' },
  { x: -7, z: -2.75, w: wallT, d: 3.5, h: BARN.wallH - up, y: up, kind: 'barn' },
  { x: -7, z: 2.75, w: wallT, d: 3.5, h: BARN.wallH - up, y: up, kind: 'barn' },
  { x: -7, z: 0, w: wallT, d: 2, h: 0.9, y: up, kind: 'barn' },                 // window sill
  // long wall at z = +4.5: a side door, and loft windows above
  { x: -2.5, z: 4.5, w: 9, d: wallT, h: BARN.floorY, kind: 'barn' },
  { x: 5.5, z: 4.5, w: 3, d: wallT, h: BARN.floorY, kind: 'barn' },
  { x: -6, z: 4.5, w: 2, d: wallT, h: BARN.wallH - up, y: up, kind: 'barn' },
  { x: -1, z: 4.5, w: 4, d: wallT, h: BARN.wallH - up, y: up, kind: 'barn' },
  { x: 5, z: 4.5, w: 4, d: wallT, h: BARN.wallH - up, y: up, kind: 'barn' },
  { x: -4, z: 4.5, w: 2, d: wallT, h: 0.9, y: up, kind: 'barn' },               // window sills
  { x: 2, z: 4.5, w: 2, d: wallT, h: 0.9, y: up, kind: 'barn' },
  // loft floor (holes left open above the two inside ramps)
  { x: 0, z: 0, w: 14, d: 4.2, h: loftT, y: BARN.floorY, kind: 'loft', center: true },
  { x: 0, z: 4, w: 14, d: 1.0, h: loftT, y: BARN.floorY, kind: 'loft' },
  { x: -6.25, z: 2.8, w: 1.5, d: 1.4, h: loftT, y: BARN.floorY, kind: 'loft' },
  { x: 3.75, z: 2.8, w: 6.5, d: 1.4, h: loftT, y: BARN.floorY, kind: 'loft' },
  // hay up in the loft and down below
  { x: 4.5, z: 0.8, w: 1.2, d: 0.65, h: 0.65, y: up, kind: 'hay' },
  { x: 4.5, z: 1.5, w: 1.2, d: 0.65, h: 0.65, y: up, kind: 'hay' },
  { x: -5.5, z: -1, w: 0.65, d: 1.2, h: 0.65, kind: 'hay' },
  { x: 1.5, z: 1.2, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },

  // ---- team base near the spawn ----
  { x: -27, z: -2.6, w: 0.2, d: 2.6, h: 2.2, kind: 'plank' },
  { x: -27, z: 2.6, w: 0.2, d: 2.6, h: 2.2, kind: 'plank' },
  { x: -27, z: -4, w: 0.25, d: 0.25, h: 2.6, kind: 'post', flag: true },
  { x: -27, z: 4, w: 0.25, d: 0.25, h: 2.6, kind: 'post', flag: true },
  { x: -29.5, z: -5.5, w: 3, d: 0.2, h: 1.6, kind: 'plank' },
  { x: -29.5, z: 5.5, w: 3, d: 0.2, h: 1.6, kind: 'plank' },

  // ---- windmill on a lookout deck ----
  ...lookout(-19, 13),

  // ---- farmyard ----
  { x: -21, z: -14, w: 3.2, d: 3.2, h: 8, kind: 'silo' },
  { x: -11, z: 12, w: 3.2, d: 1.8, h: 1.9, kind: 'tractor' },
  { x: -8, z: -15, w: 3, d: 2.2, h: 2.2, kind: 'shed' },
  { x: -15, z: -3, w: 2.2, d: 0.7, h: 0.8, kind: 'trough' },
  { x: -14, z: 4, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -14, z: 4.7, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -14, z: 4.35, w: 1.2, d: 0.65, h: 0.6, y: 0.65, kind: 'hay' },
  { x: -24, z: -6, w: 0.65, d: 1.2, h: 0.65, kind: 'hay' },
  { x: -23.3, z: -6, w: 0.65, d: 1.2, h: 0.65, kind: 'hay' },
  { x: -4, z: 9.5, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -10.5, z: -8, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -10.5, z: -7.3, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
  { x: -25, z: 9, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
  { x: -16, z: -19, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
  { x: -3, z: -9, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
  { x: -12, z: -11, w: 4, d: 0.15, h: 1.0, kind: 'rail' },
  { x: -24, z: 18, w: 0.15, d: 4, h: 1.0, kind: 'rail' },
  { x: -6, z: 19, w: 4, d: 0.15, h: 1.0, kind: 'rail' },
  { x: -29, z: -16, w: 0.15, d: 4, h: 1.0, kind: 'rail' },
  { x: -17, z: 6, w: 0.15, d: 2.6, h: 1.6, kind: 'plank' },
  { x: -10, z: -3, w: 0.15, d: 2.4, h: 1.6, kind: 'plank' },
  { x: -20, z: -2, w: 2.6, d: 0.15, h: 1.6, kind: 'plank' },
  { x: -13, z: 19.5, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
  { x: -27, z: -11.5, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
  { x: -2, z: 15, w: 1.0, d: 1.0, h: 1.0, kind: 'crate' },
];

const farmRamps = [
  { x: -2.5, z: 2.8, w: 6, d: 1.4, h: up, dir: '+x' },          // inside the barn up to the loft
  { x: -19, z: 9.25, w: 1.2, d: 4.5, h: 1.95, dir: '+z' },       // up to the windmill deck
];

const farmItems = [
  { w: W.SNIPER, x: -19, y: 1.97, z: 13.4 },     // on the windmill deck
  { w: W.BURST, x: -5.5, y: up + 0.02, z: 0 },   // up in the barn loft
  { w: W.MALLET, x: -1, y: up + 0.02, z: 4 },    // loft corner
  { w: W.SHOTGUN, x: -4, z: -2.4 },              // barn ground floor
  { w: W.SHOTGUN, x: -14, z: 7 },
  { w: W.LAUNCHER, x: -21, z: -10.8 },           // by the silo
  { w: W.SPRAYER, x: -11, z: 14.2 },             // behind the tractor
  { w: W.GRENADE, x: -17, z: -6 },
  { w: W.GRENADE, x: -25, z: 13.5 },
  { w: W.GRENADE, x: -2, z: -12 },
  { w: W.MINE, x: -9, z: -18 },
  { w: W.MINE, x: -28, z: 7.5 },
  { w: W.SHIELD, x: -24, z: -3.5 },
];

const farmBushes = [
  { x: -23.5, z: 1.8, r: 2.0, h: 2.1, kind: 'corn' },
  { x: -13, z: -21, r: 2.2, h: 2.1, kind: 'corn' },
  { x: -17, z: 18.5, r: 2.0, h: 2.1, kind: 'corn' },
  { x: -5, z: -20.5, r: 1.8, h: 2.1, kind: 'corn' },
  { x: -9, z: 6.5, r: 1.2, h: 1.7 },
  { x: -22, z: -21, r: 1.3, h: 1.7 },
  { x: -30, z: 13, r: 1.3, h: 1.7 },
];

const farmAll = mirror(farmHalf);
const FX = 34, FZ = 24;

MAPS.farm = {
  id: 'farm',
  name: 'Windmill Farm',
  desc: 'Two-floor red barn in the middle, windmill lookouts and corn to hide in.',
  halfX: FX,
  halfZ: FZ,
  boxes: [...farmAll.map(({ flag, center, ...b }) => b), ...boundary(FX, FZ)],
  flags: farmAll.filter((b) => b.flag).map((b) => ({ x: b.x, z: b.z, h: b.h, team: b.team })),
  ramps: mirror(farmRamps).map(({ team, center, ...r }) => r),
  items: mirror(farmItems).map(({ team, center, dir, ...it }) => it),
  bushes: mirror(farmBushes).map(({ team, center, dir, y, ...b }) => b),
  windmills: mirror([{ x: -19, z: 13 }]).map(({ x, z }) => ({ x, z })),
  roofs: [{ x: BARN.x, z: BARN.z, w: BARN.w, d: BARN.d, y: BARN.wallH, h: 2.6 }],
  dirt: [
    [-30, 0, 4], [-22, 1, 3], [-14, 0, 3], [-8, 0, 3], [0, 0, 6], [-10, 8, 2.6], [-19, 9, 2.4],
    [-21, -10, 3], [-8, -12, 3], [-4, 13, 2.6], [-28, -14, 2.4], [-14, -16, 2.6],
  ].flatMap(([x, z, r]) => (x === 0 && z === 0 ? [[x, z, r]] : [[x, z, r], [-x, -z, r]])),
  spawns: [
    [[-31, 0, -2], [-31, 0, 2], [-31.5, 0, -7.5], [-31.5, 0, 7.5]],
    [[31, 0, 2], [31, 0, -2], [31.5, 0, 7.5], [31.5, 0, -7.5]],
  ],
  spawnYaw: [-Math.PI / 2, Math.PI / 2],
};

// ---- shared builder for the newer maps -----------------------------------------------------
const mirrorDirt = (list) => list.flatMap(([x, z, r]) => (x === 0 && z === 0 ? [[x, z, r]] : [[x, z, r], [-x, -z, r]]));
const mirrorStrings = (list) => list.flatMap(([x1, z1, y1, x2, z2, y2]) => [[x1, z1, y1, x2, z2, y2], [-x1, -z1, y1, -x2, -z2, y2]]);

function buildMap({ id, name, desc, hx, hz, half, ramps = [], items = [], bushes = [], dirt = [], spawnX, edge = 'fence', edgeH = 1.5, theme, strings = [], decor = [], stripes = [], windmills = [] }) {
  const all = mirror(half);
  return {
    id, name, desc, halfX: hx, halfZ: hz, theme,
    boxes: [...all.map(({ flag, center, team, ...b }) => ({ ...b, team })), ...boundary(hx, hz, edgeH, edge)],
    flags: all.filter((b) => b.flag).map((b) => ({ x: b.x, z: b.z, h: b.h, team: b.team })),
    ramps: mirror(ramps).map(({ team, center, ...r }) => r),
    items: mirror(items).map(({ team, center, dir, ...it }) => it),
    bushes: mirror(bushes).map(({ team, center, dir, y, ...b }) => b),
    dirt: mirrorDirt(dirt),
    strings: mirrorStrings(strings),
    stripes: stripes.flatMap(([x, z, w, d]) => [[x, z, w, d], [-x, -z, w, d]]),
    decor,
    windmills: mirror(windmills).map(({ x, z }) => ({ x, z })),
    spawns: [
      [[spawnX, 0, -2], [spawnX, 0, 2], [spawnX - 0.5, 0, -7], [spawnX - 0.5, 0, 7]],
      [[-spawnX, 0, 2], [-spawnX, 0, -2], [-spawnX + 0.5, 0, 7], [-spawnX + 0.5, 0, -7]],
    ],
    spawnYaw: [-Math.PI / 2, Math.PI / 2],
  };
}

// team base: two low walls with a gap, flag posts, and side walls (kind sets the look)
function base(x, kind, h = 1.2, t = 0.6) {
  return [
    { x, z: -2.8, w: t, d: 2.6, h, kind },
    { x, z: 2.8, w: t, d: 2.6, h, kind },
    { x, z: -4.4, w: 0.25, d: 0.25, h: 2.6, kind: 'post', flag: true },
    { x, z: 4.4, w: 0.25, d: 0.25, h: 2.6, kind: 'post', flag: true },
    { x: x - 2.5, z: -5.8, w: 3, d: t, h: h - 0.2, kind },
    { x: x - 2.5, z: 5.8, w: 3, d: t, h: h - 0.2, kind },
  ];
}
const lookoutRamp = (x, z, kind) => ({ x, z: z - 3.75, w: 1.2, d: 4.5, h: 1.95, dir: '+z', kind });

// --- Gravel Pit: sunny quarry with a rock mesa in the middle, steel lookouts and dump trucks
MAPS.quarry = buildMap({
  id: 'quarry',
  name: 'Gravel Pit',
  desc: 'Dusty quarry: climb the rock mesa, steel lookouts, trucks and gravel piles.',
  hx: 36, hz: 25, spawnX: -32, edge: 'cliff', edgeH: 4,
  theme: 'quarry',
  half: [
    { x: 0, z: 0, w: 6, d: 4, h: 1.9, kind: 'mesa', center: true },
    ...base(-27, 'block'),
    ...lookout(-20, 13, 3.6, 3.0, 'steel'),
    ...lookout(-12, -16, 3.6, 3.0, 'steel'),
    { x: -14, z: -8, w: 4.4, d: 2.1, h: 2.6, kind: 'truck' },
    { x: -25, z: 19, w: 2.1, d: 4.4, h: 2.6, kind: 'truck' },
    { x: -20, z: 2, w: 4.6, d: 2.3, h: 2.4, kind: 'container' },
    { x: -10, z: 5, w: 2.4, d: 2, h: 1.6, kind: 'rock' },
    { x: -22, z: -6, w: 3, d: 2.2, h: 1.4, kind: 'rock' },
    { x: -5, z: -7, w: 1.6, d: 1.4, h: 1.1, kind: 'rock' },
    { x: -30, z: 13, w: 2.6, d: 2.2, h: 1.8, kind: 'rock' },
    { x: -4, z: 15, w: 2, d: 1.6, h: 1.3, kind: 'rock' },
    { x: -24, z: -20, w: 3, d: 2, h: 1.7, kind: 'rock' },
    { x: -6, z: 21, w: 1.8, d: 1.6, h: 1.2, kind: 'rock' },
    { x: -15, z: 15, w: 1.4, d: 1.2, h: 1.0, kind: 'rock' },
    { x: -25, z: -10, w: 2.6, d: 2.6, h: 1.5, kind: 'pile' },
    { x: -6, z: -22, w: 2.4, d: 2.4, h: 1.4, kind: 'pile' },
    { x: -16, z: 22, w: 2.6, d: 2.6, h: 1.5, kind: 'pile' },
    { x: -8, z: 10, w: 0.6, d: 2.6, h: 1.2, kind: 'block' },
    { x: -16, z: -2, w: 2.6, d: 0.6, h: 1.2, kind: 'block' },
    { x: -2, z: -12, w: 2.6, d: 0.6, h: 1.2, kind: 'block' },
    { x: -32, z: -12, w: 0.6, d: 2.6, h: 1.2, kind: 'block' },
    { x: -12, z: 1, w: 0.6, d: 2.4, h: 1.2, kind: 'block' },
    { x: -17, z: 8, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -17.8, z: 8.4, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -4, z: -4, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -31, z: 20, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -9, z: -11, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -34, z: -19, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -28, z: 9, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
    { x: -2, z: 7, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
  ],
  ramps: [
    { x: -5.25, z: -1, w: 4.5, d: 1.4, h: 1.9, dir: '+x', kind: 'rock' },   // up the mesa
    lookoutRamp(-20, 13, 'steel'),
    lookoutRamp(-12, -16, 'steel'),
  ],
  items: [
    { w: W.SNIPER, x: 0, y: 1.92, z: 0, center: true },  // on top of the mesa
    { w: W.LAUNCHER, x: -20, y: 1.97, z: 13.4 },
    { w: W.BURST, x: -12, y: 1.97, z: -15.6 },
    { w: W.SHOTGUN, x: -14, z: -5.5 },
    { w: W.SHOTGUN, x: -24, z: 9 },
    { w: W.BURST, x: -9, z: 7.5 },
    { w: W.SPRAYER, x: -4, z: 12 },
    { w: W.LAUNCHER, x: -20, z: -0.5 },
    { w: W.GRENADE, x: -23, z: -2 },
    { w: W.GRENADE, x: -7, z: -3 },
    { w: W.GRENADE, x: -27, z: -16 },
    { w: W.GRENADE, x: -11, z: 19 },
    { w: W.SHIELD, x: -28, z: -10 },
    { w: W.MINE, x: -18, z: -21 },
    { w: W.MINE, x: -33, z: 15 },
    { w: W.MALLET, x: -6, z: -15 },
  ],
  bushes: [
    { x: -24, z: 4.5, r: 1.3, h: 1.7, kind: 'scrub' },
    { x: -8, z: -18, r: 1.3, h: 1.7, kind: 'scrub' },
    { x: -16, z: 4, r: 1.2, h: 1.7, kind: 'scrub' },
    { x: -30, z: -21, r: 1.3, h: 1.7, kind: 'scrub' },
    { x: -2, z: -20, r: 1.2, h: 1.7, kind: 'scrub' },
    { x: -13, z: 10, r: 1.2, h: 1.7, kind: 'scrub' },
    { x: -26, z: 23.2, r: 1.2, h: 1.7, kind: 'scrub' },
  ],
  dirt: [[-30, 0, 4], [-20, -2, 3.4], [-10, 0, 3.4], [0, 0, 6], [-14, -12, 4], [-20, 9, 3], [-8, 16, 3.4], [-26, -14, 3.4], [-4, -18, 3]],
});

// --- Starlight Drive-In: dusk at an open-air movie lot. Snack bar with a roof deck in the middle,
// rows of parked cars, speaker posts and a glowing screen at each end.
MAPS.drivein = buildMap({
  id: 'drivein',
  name: 'Starlight Drive-In',
  desc: 'Dusk at the movies: parked cars, a snack bar with a roof deck, twin glowing screens.',
  hx: 38, hz: 24, spawnX: -34,
  theme: 'dusk',
  half: [
    // snack bar (8 x 5), serving window on the short walls, door on each long wall
    { x: -4, z: -1.75, w: 0.25, d: 1.5, h: 2.6, kind: 'stucco' },
    { x: -4, z: 1.75, w: 0.25, d: 1.5, h: 2.6, kind: 'stucco' },
    { x: -4, z: 0, w: 0.25, d: 2, h: 1.0, kind: 'stucco' },
    { x: -4, z: 0, w: 0.25, d: 2, h: 0.6, y: 2.0, kind: 'stucco' },
    { x: -2.5, z: 2.5, w: 3, d: 0.25, h: 2.6, kind: 'stucco' },
    { x: 3, z: 2.5, w: 2, d: 0.25, h: 2.6, kind: 'stucco' },
    { x: 0.5, z: 2.5, w: 3, d: 0.25, h: 0.6, y: 2.0, kind: 'stucco' },
    { x: 0, z: 0, w: 8.4, d: 5.4, h: 0.2, y: 2.6, kind: 'roofdeck', center: true },
    { x: 0, z: 0, w: 3, d: 0.8, h: 1.0, kind: 'counter', center: true },
    { x: -0.8, z: 2.62, w: 6.6, d: 0.15, h: 0.6, y: 2.8, kind: 'parapet' },
    { x: -4.12, z: 0, w: 0.15, d: 5.4, h: 0.6, y: 2.8, kind: 'parapet' },
    ...base(-30, 'block'),
    // parked cars (long side along z, facing the screens) and speaker posts between them
    { x: -9, z: 9, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -9, z: 15, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -9, z: 12, w: 0.2, d: 0.2, h: 1.3, kind: 'speaker' },
    { x: -15, z: -6, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -15, z: -12, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -15, z: -9, w: 0.2, d: 0.2, h: 1.3, kind: 'speaker' },
    { x: -21, z: 7, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -21, z: 17, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -21, z: 12, w: 0.2, d: 0.2, h: 1.3, kind: 'speaker' },
    { x: -27, z: -10, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -27, z: -13.5, w: 0.2, d: 0.2, h: 1.3, kind: 'speaker' },
    { x: -3, z: -12, w: 1.9, d: 4.1, h: 1.45, kind: 'car' },
    { x: -30, z: 20, w: 4.1, d: 1.9, h: 1.45, kind: 'car' },
    { x: -27, z: 4, w: 1.6, d: 1.6, h: 2.4, kind: 'kiosk' },
    { x: -18, z: 3, w: 0.6, d: 2.6, h: 1.2, kind: 'block' },
    { x: -7, z: 3, w: 0.6, d: 2.6, h: 1.2, kind: 'block' },
    { x: -24, z: -17, w: 2.6, d: 0.6, h: 1.2, kind: 'block' },
    { x: -9, z: -20, w: 2.6, d: 0.6, h: 1.2, kind: 'block' },
    { x: -26, z: 6.2, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -35, z: -18, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -18, z: -1, w: 0.95, d: 0.95, h: 0.75, kind: 'tires' },
    { x: -12, z: 0, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
    { x: -24, z: -4, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
    { x: -6, z: -17, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
    { x: -16, z: 21, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
  ],
  ramps: [{ x: -3.25, z: -5.375, w: 1.4, d: 5.5, h: 2.8, dir: '+z', kind: 'steel' }],   // up to the snack bar roof
  items: [
    { w: W.SNIPER, x: 0, y: 2.82, z: 0, center: true },  // on the snack bar roof
    { w: W.SHOTGUN, x: -2.6, z: -1.5 },                  // inside the snack bar
    { w: W.LAUNCHER, x: -22.2, z: 12 },
    { w: W.SHOTGUN, x: -12, z: 9 },
    { w: W.SHOTGUN, x: -18, z: -9 },
    { w: W.BURST, x: -6, z: -6 },
    { w: W.SPRAYER, x: -3, z: 10 },
    { w: W.GRENADE, x: -27, z: -1 },
    { w: W.GRENADE, x: -10, z: -2 },
    { w: W.GRENADE, x: -30, z: -20 },
    { w: W.GRENADE, x: -14, z: 20 },
    { w: W.SHIELD, x: -26, z: 9 },
    { w: W.MINE, x: -20, z: -17 },
    { w: W.MINE, x: -33, z: 15 },
    { w: W.MALLET, x: -7, z: -1 },
  ],
  bushes: [
    { x: -24, z: 0.5, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -12, z: -17, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -3, z: 20, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -18, z: -21.5, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -12, z: 4, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -27, z: 22, r: 1.2, h: 1.6, kind: 'hedge' },
  ],
  strings: [
    [-4.1, 2.6, 3.2, -12, 0, 3.9], [-4.1, -2.6, 3.2, -6, -17, 3.9], [-12, 0, 3.9, -24, -4, 3.9], [-12, 0, 3.9, -16, 21, 3.9],
  ],
  // parking stripes painted on the asphalt: [x, z, w, d]
  stripes: [
    ...[-12, -18, -24, -30, -6].flatMap((x) => [[x, 12, 0.12, 5], [x, -9, 0.12, 5]]),
  ],
  decor: [{ type: 'screen', x: 0, z: -31, face: 1 }, { type: 'screen', x: 0, z: 31, face: -1 }],
});

// --- Pump Station: night at a waterworks. Steel catwalk over the middle, big tanks, pipes,
// a brick pump house and floodlights.
MAPS.pump = buildMap({
  id: 'pump',
  name: 'Pump Station',
  desc: 'Night shift at the waterworks: catwalk, big tanks, pipes and floodlights.',
  hx: 35, hz: 25, spawnX: -31, edge: 'chainlink', edgeH: 2.4,
  theme: 'night',
  half: [
    // catwalk across the middle (walk underneath it too)
    { x: 0, z: 0, w: 12, d: 2, h: 0.15, y: 1.8, kind: 'steel', center: true },
    { x: -5.9, z: -0.9, w: 0.2, d: 0.2, h: 2.9, kind: 'beam' },
    { x: -5.9, z: 0.9, w: 0.2, d: 0.2, h: 2.9, kind: 'beam' },
    { x: -2, z: -0.9, w: 0.2, d: 0.2, h: 2.9, kind: 'beam' },
    { x: -2, z: 0.9, w: 0.2, d: 0.2, h: 2.9, kind: 'beam' },
    { x: 0, z: 0.94, w: 12, d: 0.12, h: 0.95, y: 1.95, kind: 'railing' },
    ...base(-28, 'block'),
    { x: -8, z: 10, w: 5, d: 5, h: 4.5, kind: 'tank' },
    { x: -22, z: -12, w: 4, d: 4, h: 3.5, kind: 'tank' },
    { x: -14, z: -5, w: 9, d: 1.0, h: 1.0, kind: 'pipe' },
    { x: -15, z: 13, w: 1.0, d: 7, h: 1.0, kind: 'pipe' },
    // brick pump house with a door and a window band
    { x: -26.5, z: 6, w: 0.25, d: 4, h: 2.6, kind: 'brick' },
    { x: -21.5, z: 4.6, w: 0.25, d: 1.2, h: 2.6, kind: 'brick' },
    { x: -21.5, z: 7.4, w: 0.25, d: 1.2, h: 2.6, kind: 'brick' },
    { x: -21.5, z: 6, w: 0.25, d: 1.6, h: 0.6, y: 2.0, kind: 'brick' },
    { x: -24, z: 8, w: 4.75, d: 0.25, h: 2.6, kind: 'brick' },
    { x: -24, z: 4, w: 4.75, d: 0.25, h: 1.0, kind: 'brick' },
    { x: -24, z: 4, w: 4.75, d: 0.25, h: 0.7, y: 1.9, kind: 'brick' },
    { x: -24, z: 6, w: 5.4, d: 4.4, h: 0.2, y: 2.6, kind: 'slab' },
    ...lookout(-18, 16, 3.6, 3.0, 'steel'),
    { x: -18, z: 0, w: 4.6, d: 2.3, h: 2.4, kind: 'container' },
    { x: -10, z: -16, w: 3, d: 1.6, h: 1.6, kind: 'machine' },
    { x: -12, z: 4, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -12.8, z: 4.4, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -4, z: -8, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -30, z: -18, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -17, z: 21, w: 0.7, d: 0.7, h: 1.0, kind: 'barrel' },
    { x: -4, z: 6, w: 2.6, d: 0.6, h: 1.2, kind: 'block' },
    { x: -10, z: -10, w: 0.6, d: 2.6, h: 1.2, kind: 'block' },
    { x: -26, z: -4, w: 2.6, d: 0.6, h: 1.2, kind: 'block' },
    { x: -31, z: -14, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -6, z: 21, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -14, z: -11, w: 0.4, d: 0.4, h: 6, kind: 'flood' },
    { x: -30, z: 11.5, w: 0.4, d: 0.4, h: 6, kind: 'flood' },
    { x: -3, z: 17, w: 0.4, d: 0.4, h: 6, kind: 'flood' },
    { x: -27, z: -22, w: 0.4, d: 0.4, h: 6, kind: 'flood' },
  ],
  ramps: [
    { x: -8.25, z: 0, w: 4.5, d: 1.4, h: 1.95, dir: '+x', kind: 'steel' },  // onto the catwalk
    lookoutRamp(-18, 16, 'steel'),
  ],
  items: [
    { w: W.LAUNCHER, x: 0, y: 1.97, z: 0, center: true }, // middle of the catwalk
    { w: W.SNIPER, x: -18, y: 1.97, z: 16.4 },
    { w: W.BURST, x: -24, z: 6 },                         // inside the pump house
    { w: W.SHOTGUN, x: -12, z: -8 },
    { w: W.SHOTGUN, x: -16, z: 8 },
    { w: W.SPRAYER, x: -4, z: -3 },
    { w: W.GRENADE, x: -26, z: -8 },
    { w: W.GRENADE, x: -9, z: 4 },
    { w: W.GRENADE, x: -3, z: 14 },
    { w: W.GRENADE, x: -20, z: -20 },
    { w: W.SHIELD, x: -30, z: -10 },
    { w: W.MINE, x: -14, z: -20 },
    { w: W.MINE, x: -33, z: 16 },
    { w: W.MALLET, x: -19, z: -7 },
  ],
  bushes: [
    { x: -12, z: -21, r: 1.3, h: 1.7 },
    { x: -28, z: 16, r: 1.3, h: 1.7 },
    { x: -2, z: -14, r: 1.2, h: 1.7 },
    { x: -20, z: -3.6, r: 1.2, h: 1.7 },
    { x: -8, z: 22, r: 1.2, h: 1.7 },
  ],
  dirt: [[-24, -14, 3], [-6, 18, 3], [-30, 20, 3]],
});

// --- Moonlight Fair: a night carnival. Carousel in the middle, game booths, tents,
// a bumper-car pen and a stage; strings of colored lights everywhere.
function booth(x, z, dir) {
  const alongX = dir[1] === 'z', s = dir[0] === '+' ? 1 : -1;
  const w = alongX ? 3 : 1.6, d = alongX ? 1.6 : 3;
  const off = (v) => ({ x: x + (alongX ? 0 : s * v), z: z + (alongX ? s * v : 0) });
  return [
    { ...off(0.4), w: alongX ? w : 0.8, d: alongX ? 0.8 : d, h: 1.1, kind: 'booth', dir },
    { ...off(-0.4), w: alongX ? w : 0.8, d: alongX ? 0.8 : d, h: 2.3, kind: 'boothback', dir },
  ];
}
MAPS.fair = buildMap({
  id: 'fair',
  name: 'Moonlight Fair',
  desc: 'Night carnival: carousel, game booths, tents, bumper cars and a stage.',
  hx: 36, hz: 25, spawnX: -32,
  theme: 'fair',
  half: [
    { x: 0, z: 0, w: 5.6, d: 5.6, h: 0.35, kind: 'carousel', center: true },
    { x: 0, z: 0, w: 1.0, d: 1.0, h: 3.4, y: 0.35, kind: 'carouselpole', center: true },
    ...base(-28, 'pad', 1.2, 0.4),
    ...booth(-12, -7, '+z'),
    ...booth(-18, -7, '+z'),
    ...booth(-10, 9, '-z'),
    ...booth(-25, 12, '+x'),
    { x: -20, z: 0, w: 4, d: 4, h: 2.6, kind: 'tent' },
    { x: -5, z: 16, w: 3.6, d: 3.6, h: 2.4, kind: 'tent' },
    // bumper car pen
    { x: -16, z: 20, w: 8, d: 0.3, h: 0.9, kind: 'pad' },
    { x: -18.5, z: 14, w: 3, d: 0.3, h: 0.9, kind: 'pad' },
    { x: -13.5, z: 14, w: 3, d: 0.3, h: 0.9, kind: 'pad' },
    { x: -20, z: 17, w: 0.3, d: 5.7, h: 0.9, kind: 'pad' },
    { x: -12, z: 14.9, w: 0.3, d: 1.5, h: 0.9, kind: 'pad' },
    { x: -12, z: 19.1, w: 0.3, d: 1.5, h: 0.9, kind: 'pad' },
    { x: -17, z: 16.5, w: 1.4, d: 1.0, h: 0.7, kind: 'bumpercar' },
    { x: -14.5, z: 18.2, w: 1.0, d: 1.4, h: 0.7, kind: 'bumpercar' },
    { x: -18.5, z: 18.6, w: 1.4, d: 1.0, h: 0.7, kind: 'bumpercar' },
    ...lookout(-24, -14),                                  // the stage
    { x: -28, z: 7.5, w: 1.6, d: 1.6, h: 2.4, kind: 'kiosk' },
    { x: -8, z: -1, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -8, z: -1, w: 0.8, d: 0.8, h: 0.8, y: 1, kind: 'crate' },
    { x: -30, z: -20, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -32, z: 20, w: 1, d: 1, h: 1, kind: 'crate' },
    { x: -4, z: -18, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
    { x: -4, z: -18.7, w: 1.2, d: 0.65, h: 0.65, kind: 'hay' },
    { x: -15, z: 4.5, w: 0.65, d: 1.2, h: 0.65, kind: 'hay' },
    { x: -6, z: -4, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
    { x: -16, z: 7, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
    { x: -26, z: -4, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
    { x: -9, z: 22, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
    { x: -14, z: -20, w: 0.3, d: 0.3, h: 4.2, kind: 'lamppost' },
  ],
  ramps: [lookoutRamp(-24, -14)],
  items: [
    { w: W.SNIPER, x: -24, y: 1.97, z: -13.6 },          // on the stage
    { w: W.LAUNCHER, x: -2.2, y: 0.37, z: -1.4 },        // riding the carousel
    { w: W.BURST, x: -12, z: -4 },
    { w: W.SHOTGUN, x: -16, z: 17 },                     // in the bumper-car pen
    { w: W.SHOTGUN, x: -8, z: 6 },
    { w: W.SPRAYER, x: -4, z: 10 },
    { w: W.GRENADE, x: -25, z: 0 },
    { w: W.GRENADE, x: -10, z: -14 },
    { w: W.GRENADE, x: -2, z: 21 },
    { w: W.GRENADE, x: -30, z: -12 },
    { w: W.SHIELD, x: -20, z: -10 },
    { w: W.MINE, x: -18, z: -20 },
    { w: W.MINE, x: -33, z: 15 },
    { w: W.MALLET, x: -6, z: -8 },
  ],
  bushes: [
    { x: -24, z: 5, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -4, z: -21.5, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -30, z: 14, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -14, z: -15, r: 1.2, h: 1.6, kind: 'hedge' },
    { x: -22, z: 23, r: 1.2, h: 1.6, kind: 'hedge' },
  ],
  dirt: [[-30, 0, 4], [-20, -4, 3], [-12, 0, 3.4], [0, 0, 5.5], [-12, 12, 3], [-24, -10, 3], [-6, -12, 3], [-16, -20, 3]],
  strings: [
    [-6, -4, 3.9, -16, 7, 3.9], [-16, 7, 3.9, -26, -4, 3.9], [-6, -4, 3.9, -14, -20, 3.9], [-16, 7, 3.9, -9, 22, 3.9],
    [-6, -4, 3.9, 6, -4, 3.9], [0, 0, 3.75, -6, -4, 3.9],
  ],
  decor: [{ type: 'ferris', x: 0, z: -35, face: 1 }, { type: 'bigtop', x: 0, z: 37 }],
});

export const DEFAULT_MAP = 'lumberyard';

export { mirror, boundary, lookout, buildMap, base, booth, lookoutRamp };
