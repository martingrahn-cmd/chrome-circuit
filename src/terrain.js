// Ground with height in it, for circuits that climb. A regular grid of
// heights, built once per race: flat across the road at the road's own
// height, banking off into the valley floor beyond the shoulder, mountains
// rising further out. Everything that stands on the ground — props, the
// grandstand, the rendered mesh — samples this one grid, so nothing floats.
//
// The camera looks down (-1, -1.35·√2, -1): ground between a car and the
// camera may rise at most 1.35 per unit of distance before it hides the car.
// A last pass cuts the grid down to that wherever the road is behind it.
import * as THREE from 'three';
import { mulberry32 } from './track.js';

const CELL = 2.5;
const MARGIN = 95;            // world units of ground beyond the circuit
const VIEW_SLOPE = 1.35;      // matches ISO_DIR in engine.js
const CAR_CLEAR = 1.7;        // a car's height, plus a little air over the roof

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Value noise, two octaves deep enough for snowdrifts and ridgelines. */
function makeNoise(seed) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rng(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const at = (x, z) => vals[perm[(perm[x & 255] + z) & 511]];
  const noise = (x, z) => {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = at(x0, z0), b = at(x0 + 1, z0), c = at(x0, z0 + 1), d = at(x0 + 1, z0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
  };
  return (x, z, octaves = 4) => {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * f, z * f) * amp;
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm;
  };
}

export class Terrain {
  /**
   * `opts.peaks`: how tall the mountains get far from the road.
   * `opts.drifts`: height of the small rolls in the valley floor.
   */
  constructor(track, opts = {}) {
    this.track = track;
    this.opts = opts;
    const line = track.line;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of line.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    this.x0 = Math.floor((minX - MARGIN) / CELL) * CELL;
    this.z0 = Math.floor((minZ - MARGIN) / CELL) * CELL;
    this.nx = Math.ceil((maxX + MARGIN - this.x0) / CELL) + 1;
    this.nz = Math.ceil((maxZ + MARGIN - this.z0) / CELL) + 1;
    // Flat across the road out to here, so a car at the track limit is still
    // level with the tarmac and its height can come straight off the line.
    this.flat = track.wallHalf + 1.2;

    const N = this.nx * this.nz;
    this.h = new Float32Array(N);
    this.dist = new Float32Array(N);     // to the centre line
    this.roadH = new Float32Array(N);    // height of the nearest road
    this.base();
  }

  idx(i, j) { return j * this.nx + i; }

  /**
   * The field before anything stands on it. Every road is a shelf cut into a
   * hillside that climbs away from the camera: behind the road the ground
   * rises, in front of it it falls away. That is what makes height legible
   * from up here — you see the bank above each road and the drop below it,
   * and where two legs pass at different heights, the slope between them.
   */
  base() {
    const line = this.track.line, n = line.n;
    const noise = makeNoise((this.track.def.seed ?? 1) * 31 + 7);
    const peaks = this.opts.peaks ?? 0;
    const drifts = this.opts.drifts ?? 0;
    const grade = this.opts.grade ?? 0.8;       // rise per unit, away from the camera
    const tau = 6;                              // how softly the nearest road takes over
    const reachBack = 30;                       // the hillside levels out this far up
    const V = Math.SQRT1_2;                     // (1, 0, 1)/√2 points at the camera
    // Every fourth sample (under five units apart) is plenty for the soft
    // blend, and for a first guess at the nearest that is then refined.
    const coarse = [];
    for (let i = 0; i < n; i += 4) coarse.push(i);
    const dk = new Float32Array(coarse.length);
    for (let j = 0; j < this.nz; j++) {
      const z = this.z0 + j * CELL;
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i * CELL;
        let best = Infinity, bestK = 0;
        for (let c = 0; c < coarse.length; c++) {
          const p = line.pts[coarse[c]];
          const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
          dk[c] = Math.sqrt(d2);
          if (d2 < best) { best = d2; bestK = coarse[c]; }
        }
        for (let k = -3; k <= 3; k++) {
          const kk = (bestK + k + n) % n, p = line.pts[kk];
          const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d2 < best) { best = d2; bestK = kk; }
        }
        const d = Math.sqrt(best);
        const hn = line.h[bestK];
        // What each nearby road says the ground should be here, softly
        // weighted toward the nearest.
        let wsum = 0, hsum = 0;
        for (let c = 0; c < coarse.length; c++) {
          const ex = dk[c] - d;
          if (ex > tau * 4) continue;
          const p = line.pts[coarse[c]];
          const back = Math.max(-reachBack, Math.min(reachBack, ((p.x - x) + (p.z - z)) * V));
          const w = Math.exp(-ex / tau);
          wsum += w; hsum += w * (line.h[coarse[c]] + grade * back);
        }
        const hill = wsum ? hsum / wsum : hn;
        let h = d <= this.flat ? hn : hn + (hill - hn) * smoothstep(this.flat, this.flat + 4, d);
        if (d > this.flat) {
          h += drifts * (noise(x / 11, z / 11, 2) - 0.5) * 2 * smoothstep(this.flat + 1, this.flat + 9, d);
          const rise = smoothstep(this.flat + 14, this.flat + 80, d);
          if (rise > 0 && peaks) {
            const ridge = 1 - Math.abs(noise(x / 47, z / 47, 4) * 2 - 1);
            h += peaks * rise * (0.25 + 0.75 * ridge * ridge) * (0.6 + 0.8 * noise(x / 90 + 3, z / 90 - 5, 2));
          }
        }
        const id = this.idx(i, j);
        this.h[id] = h;
        this.dist[id] = d;
        this.roadH[id] = hn;
      }
    }
  }

  /** Flatten the ground under things that need level footing. */
  addPads(pads) {
    if (!pads.length) return;
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const id = this.idx(i, j);
        if (this.dist[id] <= this.flat) continue;
        const x = this.x0 + i * CELL, z = this.z0 + j * CELL;
        let h = this.h[id];
        for (const p of pads) {
          const d = Math.hypot(x - p.x, z - p.z);
          if (d > p.r + 7) continue;
          h += (p.h - h) * (1 - smoothstep(p.r, p.r + 7, d));
        }
        this.h[id] = h;
      }
    }
  }

  /**
   * Cut away any ground that would stand between the camera and the road.
   * Camera rays run along +x+z, one grid diagonal at a time, so a single
   * sweep in that order carries the limit set by every road cell behind.
   */
  clampToView() {
    const step = VIEW_SLOPE * CELL * Math.SQRT2;
    const cap = new Float32Array(this.h.length).fill(Infinity);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const id = this.idx(i, j);
        let c = i > 0 && j > 0 ? cap[this.idx(i - 1, j - 1)] + step : Infinity;
        if (this.dist[id] <= this.track.wallHalf + 0.6) c = Math.min(c, this.roadH[id] + CAR_CLEAR);
        cap[id] = c;
        if (this.dist[id] > this.flat && this.h[id] > c) this.h[id] = c;
      }
    }
  }

  /** Height of the ground at a point, as rendered. */
  sample(x, z) {
    const fx = (x - this.x0) / CELL, fz = (z - this.z0) / CELL;
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
    const a = this.h[this.idx(i, j)], b = this.h[this.idx(i + 1, j)];
    const c = this.h[this.idx(i, j + 1)], d = this.h[this.idx(i + 1, j + 1)];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }

  /** The lowest ground under a footprint, so a building on a slope digs
   *  in at the high side instead of floating at the low one. */
  footing(x, z, r = 0) {
    if (r <= 0) return this.sample(x, z);
    let h = this.sample(x, z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      h = Math.min(h, this.sample(x + dx * r, z + dz * r));
    }
    return h;
  }

  /** The rendered ground: snow on the level, rock where it is steep. */
  mesh(theme) {
    const { nx, nz } = this;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const id = this.idx(i, j), o = id * 3;
        pos[o] = this.x0 + i * CELL;
        // Under the road ribbon, a hair lower, so the tarmac never z-fights.
        pos[o + 1] = this.h[id] - (this.dist[id] <= this.flat ? 0.08 : 0);
        pos[o + 2] = this.z0 + j * CELL;
      }
    }
    const index = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = this.idx(i, j), b = this.idx(i + 1, j), c = this.idx(i, j + 1), d = this.idx(i + 1, j + 1);
        index.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();

    const nrm = g.attributes.normal.array;
    const col = new Float32Array(nx * nz * 3);
    const snow = new THREE.Color(theme.ground ?? 0xeef3f8);
    const rock = new THREE.Color(theme.rock ?? 0x7d8593);
    const verge = new THREE.Color(theme.verge ?? theme.ground ?? 0xeef3f8);
    const low = new THREE.Color(theme.valley ?? theme.ground ?? 0xeef3f8);
    const high = new THREE.Color(theme.peak ?? theme.ground ?? 0xeef3f8);
    const noise = makeNoise((this.track.def.seed ?? 1) * 17 + 3);
    const c = new THREE.Color();
    for (let id = 0; id < nx * nz; id++) {
      const up = nrm[id * 3 + 1];
      const steep = smoothstep(0.9, 0.7, up);          // snow will not lie on a cliff
      const x = pos[id * 3], z = pos[id * 3 + 2];
      // Altitude reads as colour: grey-green snow down in the valley,
      // bright and faintly blue up top.
      const alt = smoothstep(-2, 16, pos[id * 3 + 1]);
      c.copy(low).lerp(snow, alt).lerp(high, smoothstep(0.65, 1, alt) * 0.6);
      c.lerp(verge, 1 - smoothstep(this.flat, this.flat + 5, this.dist[id]));
      c.lerp(rock, steep * (0.75 + 0.25 * noise(x / 7, z / 7, 2)));
      const shade = 0.95 + 0.07 * noise(x / 23, z / 23, 2);
      col[id * 3] = c.r * shade; col[id * 3 + 1] = c.g * shade; col[id * 3 + 2] = c.b * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    // Banks and ridges throw shade on the road below: half of what makes
    // a climb read as one.
    m.castShadow = true;
    return m;
  }

  /** Mean height round the edge, for the plane that runs on to the horizon. */
  edgeHeight() {
    let s = 0, k = 0;
    for (let i = 0; i < this.nx; i++) { s += this.h[this.idx(i, 0)] + this.h[this.idx(i, this.nz - 1)]; k += 2; }
    for (let j = 0; j < this.nz; j++) { s += this.h[this.idx(0, j)] + this.h[this.idx(this.nx - 1, j)]; k += 2; }
    return s / k;
  }
}
