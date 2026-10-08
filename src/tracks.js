// Track definitions. A track is a closed loop of cardinal moves on a tile grid
// plus a theme that decides sky, ground colour and which kit props dress it.
//
// Prop `h` is the model's height in model units (a tile is 1.0); the scenery
// builder multiplies it by `scale` and the tile size to decide whether a prop
// is short enough to sit near the track without hiding the cars.

// Low dressing that fits beside the road without hiding the cars.
// `h` is the model's height and `r` its footprint radius, both in model units
// (one tile = 1.0); the scenery builder multiplies them by `scale` and the tile
// size to decide whether a prop is short enough, and far enough, to place.
//
// Only things that make sense standing on their own in a field: planters and
// small trees. A lone path, parasol, dumpster or length of fence did not —
// dumpsters now stand beside buildings, fences run along the rally roads.
const LOW_PROPS = [
  { kit: 'suburb', model: 'planter', scale: 1.6, h: 0.18, r: 0.20 },
  { kit: 'suburb', model: 'tree-small', scale: 1.0, h: 0.57, r: 0.12 },
];

const CITY_PROPS = [
  { kit: 'city', model: 'building-a', scale: 1.5, h: 1.29, r: 0.47 },
  { kit: 'city', model: 'building-b', scale: 1.5, h: 1.29, r: 0.49 },
  { kit: 'city', model: 'building-c', scale: 1.4, h: 0.89, r: 0.55 },
  { kit: 'city', model: 'building-d', scale: 1.4, h: 1.29, r: 0.45 },
  { kit: 'city', model: 'building-e', scale: 1.5, h: 0.89, r: 0.82 },
  { kit: 'city', model: 'building-f', scale: 1.3, h: 1.69, r: 0.52 },
  { kit: 'city', model: 'building-g', scale: 1.5, h: 1.69, r: 0.49 },
  { kit: 'city', model: 'building-h', scale: 1.4, h: 1.29, r: 0.50 },
  { kit: 'city', model: 'low-detail-building-wide-a', scale: 1.3, h: 1.10, r: 0.50 },
  { kit: 'city', model: 'low-detail-building-wide-b', scale: 1.3, h: 1.15, r: 0.50 },
  { kit: 'suburb', model: 'tree-large', scale: 1.0, h: 0.77, r: 0.12 },
  ...LOW_PROPS,
];

const TOWER_PROPS = [
  { kit: 'city', model: 'building-skyscraper-a', scale: 1.1, h: 2.88, r: 0.68 },
  { kit: 'city', model: 'building-skyscraper-b', scale: 1.0, h: 4.48, r: 0.68 },
  { kit: 'city', model: 'building-skyscraper-c', scale: 1.0, h: 4.08, r: 0.69 },
  { kit: 'city', model: 'building-skyscraper-d', scale: 0.9, h: 5.47, r: 0.69 },
  { kit: 'city', model: 'building-a', scale: 1.5, h: 1.29, r: 0.47 },
  { kit: 'city', model: 'building-e', scale: 1.5, h: 0.89, r: 0.82 },
  { kit: 'city', model: 'building-c', scale: 1.4, h: 0.89, r: 0.55 },
  { kit: 'city', model: 'low-detail-building-wide-a', scale: 1.5, h: 1.10, r: 0.50 },
  { kit: 'city', model: 'low-detail-building-wide-b', scale: 1.5, h: 1.15, r: 0.50 },
  ...LOW_PROPS,
];

const SUBURB_PROPS = [
  { kit: 'suburb', model: 'building-type-a', scale: 1.1, h: 0.83, r: 0.65 },
  { kit: 'suburb', model: 'building-type-c', scale: 1.1, h: 1.03, r: 0.64 },
  { kit: 'suburb', model: 'building-type-f', scale: 1.1, h: 1.14, r: 0.71 },
  { kit: 'suburb', model: 'building-type-j', scale: 1.1, h: 1.04, r: 0.69 },
  { kit: 'suburb', model: 'building-type-m', scale: 1.1, h: 0.74, r: 0.71 },
  { kit: 'suburb', model: 'building-type-q', scale: 1.1, h: 0.92, r: 0.62 },
  { kit: 'suburb', model: 'tree-large', scale: 1.1, h: 0.77, r: 0.12 },
  { kit: 'items', model: 'tree-pine', scale: 1.0, h: 0.83, r: 0.28 },
  ...LOW_PROPS,
];

const WILD_PROPS = [
  { kit: 'items', model: 'tree-pine', scale: 1.2, h: 0.83, r: 0.28 },
  { kit: 'items', model: 'tree-pine', scale: 0.8, h: 0.83, r: 0.28 },
  { kit: 'items', model: 'tree', scale: 1.0, h: 0.83, r: 0.25 },
  { kit: 'suburb', model: 'tree-large', scale: 1.1, h: 0.77, r: 0.12 },
  { kit: 'suburb', model: 'tree-small', scale: 1.0, h: 0.57, r: 0.12 },
  // No planters: city street furniture has no business in a forest.
];

// Trackside furniture, by role rather than by lottery. Street circuits get a
// row of lamps at even spacing and a warning sign before each real corner;
// rally roads get a fence along the straights, barriers round the outside of
// the corners and cones on the apexes. Traffic lights belong on the start
// gantry, which builds its own.
const STREET = {
  lamp: { kit: 'roads', model: 'light-curved', scale: 1 },
  cornerSign: { kit: 'roads', model: 'road-sign-warning', scale: 1 },
};
const STREET_SQUARE = { ...STREET, lamp: { kit: 'roads', model: 'light-square', scale: 1 } };
const RALLY = {
  fence: { kit: 'suburb', model: 'fence', scale: 1, length: 0.48 },
  cornerBarrier: { kit: 'roads', model: 'construction-barrier', scale: 1.3 },
  apexCone: { kit: 'roads', model: 'construction-cone', scale: 1.5 },
  cornerSign: { kit: 'roads', model: 'road-sign-warning', scale: 1 },
};

// --- Alpine Winter -------------------------------------------------------

// A log cabin, assembled from the holiday kit's pieces on a 2×2 floor:
// [piece, x, y, z, quarter turns]. Walls sit on a cell's +z edge and turn
// round its centre; roof halves meet at the ridge; the gables close the ends.
function cabin({ chimney = true, windows = ['cabin-window-a', 'cabin-window-b'] } = {}) {
  return [
    [windows[0], 0.5, 0, 0.5, 0], ['cabin-wall', 0.5, 0, 0.5, 1],
    ['cabin-wall', -0.5, 0, 0.5, 0], [windows[1], -0.5, 0, 0.5, 3],
    ['cabin-wall', 0.5, 0, -0.5, 2], ['cabin-doorway', 0.5, 0, -0.5, 1],
    ['cabin-wall', -0.5, 0, -0.5, 2], ['cabin-wall', -0.5, 0, -0.5, 3],
    ['cabin-corner', -0.5, 0, 0.5, 0], ['cabin-corner', 0.5, 0, 0.5, 1],
    ['cabin-corner', 0.5, 0, -0.5, 2], ['cabin-corner', -0.5, 0, -0.5, 3],
    ['cabin-roof-snow', 0.5, 1, 0.5, 0], [chimney ? 'cabin-roof-snow-chimney' : 'cabin-roof-snow', 0.5, 1, -0.5, 0],
    ['cabin-roof-snow', -0.5, 1, 0.5, 2], ['cabin-roof-snow', -0.5, 1, -0.5, 2],
    ['cabin-wall-roof', 0.5, 1, 0.5, 0], ['cabin-wall-roof-center', -0.5, 1, 0.5, 0],
    ['cabin-wall-roof-center', 0.5, 1, -0.5, 2], ['cabin-wall-roof', -0.5, 1, -0.5, 2],
  ];
}
const CABINS = [
  { kit: 'holiday', parts: cabin(), scale: 0.36, h: 2.34, r: 1.45, pad: true, below: 8 },
  { kit: 'holiday', parts: cabin({ chimney: false, windows: ['cabin-window-c', 'cabin-window-large'] }), scale: 0.36, h: 2.34, r: 1.45, pad: true, below: 8 },
];
// `below`: the tree line — above it, only rock.
const SNOW_TREES = [
  { kit: 'holiday', model: 'tree-snow-a', scale: 0.44, h: 1.92, r: 0.6, below: 10 },
  { kit: 'holiday', model: 'tree-snow-b', scale: 0.40, h: 1.97, r: 0.62, below: 10 },
  { kit: 'holiday', model: 'tree-snow-c', scale: 0.36, h: 1.92, r: 0.6, below: 12 },
  { kit: 'holiday', model: 'tree-snow-a', scale: 0.30, h: 1.92, r: 0.6, below: 13 },
];
const ROCKS = [
  { kit: 'holiday', model: 'rocks-large', scale: 0.3, h: 1.71, r: 1.6 },
  { kit: 'holiday', model: 'rocks-medium', scale: 0.32, h: 0.88, r: 1.0 },
  { kit: 'holiday', model: 'rocks-small', scale: 0.3, h: 0.65, r: 0.77 },
];
const VILLAGE_PROPS = [
  ...CABINS, ...SNOW_TREES,
  { kit: 'holiday', model: 'snowman-hat', scale: 0.2, h: 1.36, r: 0.55 },
];
const PASS_PROPS = [...SNOW_TREES, ...SNOW_TREES, ...ROCKS, CABINS[0]];
const SUMMIT_PROPS = [...ROCKS, ...ROCKS, ...SNOW_TREES];

// Lanterns along the far side and snow walls round the outside of the
// corners; warning signs before the ones that bite.
const ALPINE = {
  lamp: { kit: 'holiday', model: 'lantern', scale: 0.26 },
  cornerSign: { kit: 'roads', model: 'road-sign-warning', scale: 1 },
  cornerBarrier: { kit: 'holiday', model: 'snow-bunker', scale: 0.26, alongX: true, every: 5.5 },
};
const ALPINE_THEME = {
  sky: 0xc9dbea, ground: 0xe4ebf2, valley: 0xbcc7c4, peak: 0xf1f7ff, rock: 0x7b8493, verge: 0xd2dae3,
  kerbColour: 0xb4bcc8, offroad: 'snow', snowfall: true, spread: 7, card: [0x7fa3c6, 0x4f6b86],
  light: { hemiSky: 0xdce8f8, hemiGround: 0x6f7c8f, hemi: 0.95, sun: 0xfff1e0, sunPower: 1.85 },
  dress: ALPINE,
  // A chairlift up the slope behind, where there is room (track.js, planLift).
  lift: true,
};

// --- Red Rock Canyon -------------------------------------------------------

// Hoodoos, mesas, cacti and the odd camp, from the Nature Kit recoloured for
// the desert (see assets.js), with Racing Kit tents and posts.
const HOODOOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((k, i) => (
  { kit: 'nature', model: `rock_tall${k}`, scale: 0.42 + (i % 3) * 0.12, h: 1.0, r: 0.5 }
));
const DESERT_LOW = [
  { kit: 'nature', model: 'cactus_tall', scale: 0.3, h: 0.75, r: 0.2 },
  { kit: 'nature', model: 'cactus_short', scale: 0.32, h: 0.53, r: 0.17 },
  { kit: 'nature', model: 'rock_largeA', scale: 0.6, h: 0.26, r: 0.5 },
  { kit: 'nature', model: 'rock_largeC', scale: 0.6, h: 0.3, r: 0.5 },
  { kit: 'nature', model: 'plant_bushSmall', scale: 0.5, h: 0.21, r: 0.19 },
];
// Buttes: the same spires, three times the size, standing off the road.
const MESAS = ['B', 'D', 'H'].map((k) => ({ kit: 'nature', model: `rock_tall${k}`, scale: 1.0, h: 1.0, r: 0.5 }));
const CAMP = [
  { kit: 'nature', model: 'tent_detailedOpen', scale: 0.5, h: 0.56, r: 0.45, pad: true },
  { kit: 'nature', model: 'tree_palmTall', scale: 0.45, h: 1.36, r: 0.5 },
  { kit: 'nature', model: 'campfire_stones', scale: 0.6, h: 0.1, r: 0.2 },
];
const CANYON_PROPS = [...HOODOOS, ...DESERT_LOW, ...DESERT_LOW, ...MESAS];
const RALLY_PROPS = [...DESERT_LOW, ...DESERT_LOW, ...HOODOOS, ...CAMP];
const DESCENT_PROPS = [...HOODOOS, ...HOODOOS, ...MESAS, ...DESERT_LOW];

// Set pieces modelled in Blender (tools/blender/canyon_landmarks.py), placed
// once per circuit where they show without hiding the road (track.js,
// buildLandmarks). Parts in game units, +Z towards the road.
const MINE_CAMP = {
  kit: 'canyon', r: 10, h: 10.2,
  parts: [
    { m: 'mine-headframe', x: 0, z: -0.6 },
    { m: 'rail-straight', x: 0, z: 3.2 }, { m: 'rail-straight', x: 0, z: 7.2 },
    { m: 'mine-cart', x: 0, z: 4.0 }, { m: 'mine-cart', x: 0, z: 6.4 },
    { m: 'ore-pile', x: 3.8, z: 4.9 },
    { m: 'mine-cart-tipped', x: -3.2, z: 7.6, yaw: 35 },
  ],
};
const WATER_STOP = {
  kit: 'canyon', r: 8, h: 9.3,
  parts: [
    { m: 'water-tower', x: -2.5, z: 0 },
    { m: 'windpump', x: 3.5, z: -1.5, yaw: 20 },
    // The rotor sits on the windpump's shaft and turns in the breeze.
    { m: 'windpump-rotor', x: 3.5 + 0.52 * Math.sin(Math.PI / 9), z: -1.5 + 0.52 * Math.cos(Math.PI / 9), y: 7.2, yaw: 20, spin: 1.7 },
    { m: 'water-trough', x: 3.5, z: 2.0 },
  ],
};

const CANYON_THEME = {
  sky: 0xf0c08a, ground: 0xd8a66c, valley: 0xc0844e, peak: 0xe9bd85, rock: 0xa84a2a, verge: 0xcf9a60,
  kerbColour: 0xc9a27a, offroad: 'sand', spread: 7, strata: true, card: [0xd9844a, 0x8a3f22],
  light: { hemiSky: 0xffe0b5, hemiGround: 0x8a5a3a, hemi: 1.0, sun: 0xffdcae, sunPower: 2.05 },
};
const CANYON_STREET = {
  // This post's foot sits off the model origin and its arm reaches along +Z.
  lamp: { kit: 'racing', model: 'lightPostModern', scale: 0.55, base: [-0.35, -0.65], turn: Math.PI },
  cornerSign: { kit: 'roads', model: 'road-sign-warning', scale: 1 },
};
const CANYON_RALLY = {
  cornerBarrier: { kit: 'racing', model: 'barrierWall', scale: 0.4, alongX: true, every: 4.6, base: [0.15, -0.71] },
  cornerSign: { kit: 'roads', model: 'road-sign-warning', scale: 1 },
};

export const WORLDS = [
  { id: 'grand', name: 'Grand Tour', blurb: 'City streets, harbour fronts and forest roads.' },
  { id: 'alps', name: 'Alpine Winter', blurb: 'Snow, ice and mountain passes that climb.' },
  { id: 'canyon', name: 'Red Rock Canyon', blurb: 'A bridge over yourself, a gravel rally and a canyon to jump.' },
];

export const TRACKS = [
  {
    id: 'downtown',
    world: 'grand',
    name: 'Downtown Loop',
    blurb: 'Wide city streets and two quick esses. A friendly first outing.',
    start: [0, 0],
    moves: 'R6 D3 R6 U3 R4 D10 L4 U3 L6 D3 L6 U10',
    laps: 3,
    walls: false,
    seed: 12,
    difficulty: 1,
    theme: {
      sky: 0x9ad8ee, ground: 0x74a35c, density: 0.44,
      props: CITY_PROPS, dress: STREET, plot: 0xb3b8c2,
    },
  },
  {
    id: 'harbour',
    world: 'grand',
    name: 'Harbour Sprint',
    blurb: 'Armco all the way round. Kiss the barrier, lose the lap.',
    start: [0, 0],
    moves: 'R14 D4 L4 D4 R4 D4 L14 U12',
    laps: 3,
    walls: true,
    seed: 77,
    difficulty: 2,
    theme: {
      sky: 0x86c8e4, ground: 0x6f9a86, density: 0.38,
      props: CITY_PROPS, dress: STREET_SQUARE, plot: 0xb3b8c2,
    },
  },
  {
    id: 'sakura',
    world: 'grand',
    name: 'Sakura Hills',
    blurb: 'Long, flowing and no barriers. Cut the grass if you dare.',
    start: [0, 0],
    moves: 'R8 D3 R5 D5 L3 D4 R6 D3 L16 U3 L4 U8 R4 U4',
    laps: 3,
    walls: false,
    seed: 501,
    difficulty: 3,
    theme: {
      sky: 0xf3c9d8, ground: 0x86ad63, density: 0.52,
      light: { hemiSky: 0xffe3ef, hemiGround: 0x6a8a4e, hemi: 1.5, sun: 0xfff0e0, sunPower: 1.7 },
      props: SUBURB_PROPS, dress: RALLY, plot: 0xd9cfbd,
    },
  },
  {
    id: 'neon',
    world: 'grand',
    name: 'Neon Speedway',
    blurb: 'The long one. Big straights, big towers, big speed.',
    start: [0, 0],
    moves: 'R20 D5 L6 D5 R6 D6 L20 U16',
    laps: 4,
    walls: true,
    seed: 909,
    difficulty: 4,
    theme: {
      sky: 0x5b4c86, ground: 0x3f4459, density: 0.5,
      light: { hemiSky: 0x8f7fd0, hemiGround: 0x2b2f45, hemi: 1.1, sun: 0xffd9a8, sunPower: 2.3 },
      props: TOWER_PROPS, dress: STREET_SQUARE, plot: 0x5c6178,
    },
  },
  {
    id: 'pinecrest',
    world: 'grand',
    name: 'Pinecrest Rally',
    blurb: 'Forest roads with a hairpin that bites. Dirt is faster than pride.',
    start: [0, 0],
    moves: 'R5 D4 R4 U4 R7 D7 L3 D5 R3 D3 L16 U8 L3 U4 R3 U3',
    laps: 3,
    walls: false,
    seed: 4242,
    difficulty: 5,
    theme: {
      sky: 0xa9d8e0, ground: 0x5f8a4a, density: 0.66,
      props: WILD_PROPS, dress: RALLY,
    },
  },
  {
    id: 'frostvale',
    world: 'alps',
    name: 'Frostvale Village',
    blurb: 'Gentle hills through a ski village. Mind the snow on the verge.',
    start: [0, 0],
    moves: 'R10 D4 R5 D6 L4 D2 L3 U5 L8 U7',
    heights: [0, 2, 3, 5, 5, 5, 4.5, 3, 1.5, 0],
    crests: [{ at: 0.68, height: 0.5, length: 13 }],
    jumps: [{ at: 0.83, lane: 0.5, width: 0.5, length: 7, height: 1.2 }],
    laps: 3,
    walls: false,
    seed: 2601,
    difficulty: 2,
    theme: { ...ALPINE_THEME, density: 0.44, props: VILLAGE_PROPS, terrain: { peaks: 14, drifts: 0.7 } },
  },
  {
    id: 'glacier',
    world: 'alps',
    name: 'Glacier Pass',
    blurb: 'Hairpins up to the glacier, ice at the top, a long run back down.',
    start: [0, 0],
    moves: 'R14 U3 L10 U3 R9 U3 L13 D9',
    heights: [0, 4, 7, 11, 14, 17, 16, 0],
    ice: [[0.6, 0.7]],
    crests: [{ at: 0.72, height: 0.55, length: 13 }],
    // The ski jump: the whole road, halfway down the long descent.
    jumps: [{ at: 0.83, width: 'full', length: 10, height: 2.2 }],
    laps: 3,
    walls: true,
    seed: 3907,
    difficulty: 4,
    theme: { ...ALPINE_THEME, density: 0.55, props: PASS_PROPS, terrain: { peaks: 26, drifts: 0.8 } },
  },
  {
    id: 'summit',
    world: 'alps',
    name: 'Summit Run',
    blurb: 'Up the ridge and over the top. Black ice and nothing to stop you.',
    start: [0, 0],
    moves: 'R16 U4 L5 U4 R5 U4 L9 D3 L4 U3 L3 D12',
    heights: [0, 5, 8, 12, 15, 19, 21, 18, 17, 20, 20, 0],
    ice: [[0.49, 0.57], [0.72, 0.77]],
    crests: [{ at: 0.87, height: 0.6, length: 13 }],
    jumps: [{ at: 0.8, lane: -0.5, width: 0.5, length: 8, height: 1.8 }],
    laps: 3,
    walls: false,
    seed: 5150,
    difficulty: 5,
    theme: { ...ALPINE_THEME, density: 0.5, props: SUMMIT_PROPS, terrain: { peaks: 32, drifts: 0.9 } },
  },
  {
    id: 'mesa',
    world: 'canyon',
    name: 'Mesa Eight',
    blurb: 'A figure of eight. Under the bridge off the line, over it a lap later.',
    start: [14, 7],
    moves: 'L14 U7 R7 D7 D7 R7 U7',
    heights: [0, 0, 4, 8.5, 3, 1, 0],
    laps: 3,
    walls: true,
    seed: 7301,
    // Stone arch from tools/blender/stone_bridge.py, 24 units either side of the crossing.
    bridgeModel: { kit: 'canyon', model: 'mesa-bridge', half: 24 },
    difficulty: 3,
    theme: { ...CANYON_THEME, density: 0.42, props: CANYON_PROPS, dress: CANYON_STREET, landmarks: [WATER_STOP], terrain: { peaks: 22, drifts: 0.5 } },
  },
  {
    id: 'dustbowl',
    world: 'canyon',
    name: 'Dust Bowl Rally',
    blurb: 'Gravel all the way, whoops to fly over and a rock arch. Slide it.',
    start: [0, 0],
    moves: 'R6 D3 R4 U3 R6 D8 L3 D4 L6 U4 L3 D3 L4 U11',
    heights: [0, 1, 2, 1, 0, 2, 3, 3, 2, 1, 1, 0, 0, 0],
    // Whoops down the long right-hand side, a yump on the bottom straight.
    crests: [{ at: 0.46, height: 0.45, length: 9 }, { at: 0.495, height: 0.45, length: 9 }, { at: 0.53, height: 0.45, length: 9 }, { at: 0.9, height: 0.5, length: 11 }],
    jumps: [{ at: 0.685, width: 'full', length: 7, height: 1.1 }],
    arches: [{ at: 0.155 }],
    laps: 3,
    walls: false,
    seed: 8822,
    difficulty: 4,
    theme: {
      ...CANYON_THEME, road: 'gravel', roadColour: 0x9a7652, kerbColour: 0xb58d62, kerbs: false, dashes: false,
      density: 0.46, props: RALLY_PROPS, dress: CANYON_RALLY, landmarks: [MINE_CAMP], terrain: { peaks: 16, drifts: 0.8 },
    },
  },
  {
    id: 'canyonrun',
    world: 'canyon',
    name: 'Canyon Run',
    blurb: 'Switchbacks down off the mesa, a leap over the dry river, and the long climb home.',
    start: [0, 0],
    moves: 'R16 D3 L12 D3 R12 D4 L16 U10',
    heights: [18, 15, 11, 8, 5, 2, 0, 18],
    crests: [{ at: 0.47, height: 0.6, length: 13 },
      // The dry river: the road drops into its bed just past the lip of the
      // jump, so whoever takes it flat out flies the gap.
      { at: 0.672, height: -2.6, length: 22 }],
    jumps: [{ at: 0.66, width: 'full', length: 9, height: 1.8 }],
    river: { at: 0.686, width: 10 },          // the bottom of the dip: the ford
    arches: [{ at: 0.77 }],
    gravel: [[0.668, 0.705]],
    laps: 3,
    walls: true,
    seed: 9417,
    difficulty: 5,
    theme: { ...CANYON_THEME, density: 0.5, props: DESCENT_PROPS, dress: CANYON_STREET, landmarks: [MINE_CAMP, WATER_STOP], terrain: { peaks: 30, drifts: 0.6 } },
  },
];

// Medals, for time trial laps. Gold is the best flying lap a near-flawless
// driver set in the Comet — the balanced car — drifting the tight corners,
// rounded up to a tenth; silver and bronze sit 6% and 14% off it. Measured
// with the AI alone on the road (a skill-0.95 driver), so a faster car makes
// a medal easier and a slower one harder, which is fair.
const GOLD = {
  downtown: 22.9, harbour: 22.7, sakura: 27.3, neon: 33.3, pinecrest: 29.4,
  frostvale: 19.5, glacier: 24.9, summit: 26.8,
  mesa: 21.9, dustbowl: 25.8, canyonrun: 30.2,
};
export const MEDALS = [
  { id: 'gold', name: 'Gold', colour: '#fbbf24', factor: 1 },
  { id: 'silver', name: 'Silver', colour: '#cbd5e1', factor: 1.06 },
  { id: 'bronze', name: 'Bronze', colour: '#d08b5b', factor: 1.14 },
];

/** The lap time each medal asks for on a circuit, gold first. */
export function medalTimes(def) {
  const gold = GOLD[def.id] ?? 60;
  return MEDALS.map((m) => Math.round(gold * m.factor * 10) / 10);
}

/** The best medal a lap earns: 0 gold, 1 silver, 2 bronze, -1 none. */
export function medalFor(def, lap) {
  if (lap == null) return -1;
  return medalTimes(def).findIndex((t) => lap <= t);
}

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
