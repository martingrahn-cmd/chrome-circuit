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
const LOW_PROPS = [
  { kit: 'suburb', model: 'planter', scale: 1.6, h: 0.18, r: 0.20 },
  { kit: 'suburb', model: 'fence-low', scale: 1.0, h: 0.17, r: 0.64 },
  { kit: 'suburb', model: 'path-stones-long', scale: 1.0, h: 0.01, r: 0.20 },
  { kit: 'roads', model: 'dumpster', scale: 1.0, h: 0.21, r: 0.23 },
  { kit: 'city', model: 'detail-parasol-a', scale: 1.5, h: 0.45, r: 0.20 },
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
  { kit: 'suburb', model: 'fence-1x3', scale: 0.6, h: 0.27, r: 0.64 },
  ...LOW_PROPS,
];

const WILD_PROPS = [
  { kit: 'items', model: 'tree-pine', scale: 1.2, h: 0.83, r: 0.28 },
  { kit: 'items', model: 'tree-pine', scale: 0.8, h: 0.83, r: 0.28 },
  { kit: 'items', model: 'tree', scale: 1.0, h: 0.83, r: 0.25 },
  { kit: 'suburb', model: 'tree-large', scale: 1.1, h: 0.77, r: 0.12 },
  { kit: 'suburb', model: 'tree-small', scale: 1.0, h: 0.57, r: 0.12 },
  { kit: 'suburb', model: 'fence-1x3', scale: 0.55, h: 0.27, r: 0.64 },
  ...LOW_PROPS,
];

// Trackside furniture. `offset` is the gap left outside the track limit, so
// nothing here is ever reachable by a car that is still on the circuit.
const CITY_SIDE = [
  // `across`: the lamp arm (local -Z) must reach over the road, not run along it.
  { kit: 'roads', model: 'light-square', scale: 1, r: 0.21, offset: 0.5, across: true },
  { kit: 'roads', model: 'light-curved', scale: 1, r: 0.20, offset: 0.5, across: true },
  { kit: 'roads', model: 'traffic-light', scale: 1, r: 0.07, offset: 0.7 },
  { kit: 'roads', model: 'road-sign-warning', scale: 1, r: 0.07, offset: 0.7 },
];

const RALLY_SIDE = [
  { kit: 'roads', model: 'construction-barrier', scale: 1.3, r: 0.11, offset: 0.25 },
  { kit: 'roads', model: 'construction-cone', scale: 1.5, r: 0.04, offset: 0.2 },
  { kit: 'roads', model: 'road-sign-warning', scale: 1, r: 0.07, offset: 0.7 },
  { kit: 'suburb', model: 'fence', scale: 0.85, r: 0.24, offset: 0.35 },
];

export const TRACKS = [
  {
    id: 'downtown',
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
      props: CITY_PROPS, trackside: CITY_SIDE,
    },
  },
  {
    id: 'harbour',
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
      props: CITY_PROPS, trackside: CITY_SIDE,
    },
  },
  {
    id: 'sakura',
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
      props: SUBURB_PROPS, trackside: RALLY_SIDE,
    },
  },
  {
    id: 'neon',
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
      props: TOWER_PROPS, trackside: CITY_SIDE,
    },
  },
  {
    id: 'pinecrest',
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
      props: WILD_PROPS, trackside: RALLY_SIDE,
    },
  },
];

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
