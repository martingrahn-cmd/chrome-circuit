// Track construction: a grid path of cardinal moves becomes a smoothed
// centre line, a road ribbon that follows it, scenery and start-grid slots.
import * as THREE from 'three';
import { instance, materialsFor, isVertexKit } from './assets.js';
import { mergeGeometries } from 'three/utils/BufferGeometryUtils.js';
import { Terrain } from './terrain.js';

// Grid pitch the circuits are authored on. The road ribbon and everything
// derived from it scale with this while cars keep their absolute size, so it
// directly sets how wide the road feels: at 11, the tarmac band (0.8 of a
// tile) is 8.8 units against a 1.44-unit car — six abreast.
export const TILE = 11;

// tan(camera elevation): how tall a prop may be per tile of clearance from the
// track before it starts hiding cars. Matches ISO_DIR in engine.js.
const CAMERA_SLOPE = 1.35;

export const DIRS = {
  R: { x: 1, z: 0 }, L: { x: -1, z: 0 },
  D: { x: 0, z: 1 }, U: { x: 0, z: -1 },
};

/** "R10 D4 L10 U4" -> array of {x,z} grid cells forming a closed loop. */
export function pathFromMoves(start, moves) {
  const cells = [];
  let cx = start[0], cz = start[1];
  cells.push({ x: cx, z: cz });
  for (const tok of moves.trim().split(/\s+/)) {
    const d = DIRS[tok[0].toUpperCase()];
    const n = parseInt(tok.slice(1), 10);
    if (!d || !Number.isFinite(n)) throw new Error(`bad move "${tok}"`);
    for (let i = 0; i < n; i++) {
      cx += d.x; cz += d.z;
      cells.push({ x: cx, z: cz });
    }
  }
  // The final step must land back on the start cell; drop the duplicate.
  const last = cells[cells.length - 1];
  if (last.x !== start[0] || last.z !== start[1]) {
    throw new Error(`track path does not close: ended at ${last.x},${last.z}`);
  }
  cells.pop();
  return cells;
}

/**
 * Build the racing line: straights joined by circular arcs tangent to both
 * legs. The radius is capped by half the shortest neighbouring straight so
 * chicanes stay tight and long sweepers stay fast.
 */
function racingLine(path, tileSize, maxRadius, step) {
  const n = path.length;
  const corners = [];
  for (let i = 0; i < n; i++) {
    const prev = path[(i - 1 + n) % n], cell = path[i], next = path[(i + 1) % n];
    const dIn = { x: cell.x - prev.x, z: cell.z - prev.z };
    const dOut = { x: next.x - cell.x, z: next.z - cell.z };
    if (dIn.x === dOut.x && dIn.z === dOut.z) continue;
    corners.push({
      c: { x: cell.x * tileSize, z: cell.z * tileSize },
      dIn, dOut,
    });
  }
  if (corners.length < 3) {
    return path.map((c) => ({ x: c.x * tileSize, z: c.z * tileSize }));
  }

  const m = corners.length;
  for (let i = 0; i < m; i++) {
    const a = corners[i], b = corners[(i + 1) % m];
    a.next = Math.hypot(b.c.x - a.c.x, b.c.z - a.c.z);
  }
  for (let i = 0; i < m; i++) {
    const prev = corners[(i - 1 + m) % m];
    corners[i].r = Math.min(maxRadius, corners[i].next / 2, prev.next / 2);
  }

  const pts = [];
  for (let i = 0; i < m; i++) {
    const k = corners[i];
    const { c, dIn, dOut, r } = k;
    const p1 = { x: c.x - dIn.x * r, z: c.z - dIn.z * r };
    const p2 = { x: c.x + dOut.x * r, z: c.z + dOut.z * r };
    const o = { x: c.x + (dOut.x - dIn.x) * r, z: c.z + (dOut.z - dIn.z) * r };

    const a0 = Math.atan2(p1.z - o.z, p1.x - o.x);
    let a1 = Math.atan2(p2.z - o.z, p2.x - o.x);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;

    const arcLen = Math.abs(sweep) * r;
    const steps = Math.max(2, Math.ceil(arcLen / step));
    for (let t = 0; t < steps; t++) {
      const a = a0 + sweep * (t / steps);
      pts.push({ x: o.x + Math.cos(a) * r, z: o.z + Math.sin(a) * r });
    }

    // Straight run to the next corner's entry point.
    const nk = corners[(i + 1) % m];
    const q1 = { x: nk.c.x - nk.dIn.x * nk.r, z: nk.c.z - nk.dIn.z * nk.r };
    const dx = q1.x - p2.x, dz = q1.z - p2.z;
    const len = Math.hypot(dx, dz);
    const steps2 = Math.max(1, Math.round(len / step));
    for (let t = 0; t < steps2; t++) {
      pts.push({ x: p2.x + (dx * t) / steps2, z: p2.z + (dz * t) / steps2 });
    }
  }
  return pts;
}

function resampleClosed(pts, spacing) {
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    let d = carry;
    while (d < len) {
      out.push({ x: a.x + (dx / len) * d, z: a.z + (dz / len) * d });
      d += spacing;
    }
    carry = d - len;
  }
  return out;
}

/** Uniformly sampled closed centre line with cheap nearest-point queries. */
export class CentreLine {
  constructor(points) {
    this.pts = points;
    this.n = points.length;
    this.spacing = 0;
    this.tangents = [];
    let total = 0;
    for (let i = 0; i < this.n; i++) {
      const a = points[i], b = points[(i + 1) % this.n];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1e-6;
      total += len;
      this.tangents.push({ x: dx / len, z: dz / len, len });
    }
    this.length = total;
    this.spacing = total / this.n;
    this.curvature = this.computeCurvature();
    this.h = new Float32Array(this.n);        // road height at each sample
    this.slope = new Float32Array(this.n);    // rise per unit run, forwards
    this.ice = new Uint8Array(this.n);
    this.gravel = new Uint8Array(this.n);
    this.bridge = new Uint8Array(this.n);    // the road here is a deck over another
  }

  setHeights(h) {
    this.h = Float32Array.from(h);
    // Central differences: the resampled loop can close on one short step,
    // and a one-sided slope across it would spike.
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      this.slope[i] = (this.h[b] - this.h[a]) / (this.tangents[a].len + this.tangents[i].len);
    }
  }

  /** Road height at a fractional sample position (a car's `progress`). */
  heightAt(progress) {
    const n = this.n;
    const f = Math.floor(progress);
    const i = ((f % n) + n) % n;
    return this.h[i] + (this.h[(i + 1) % n] - this.h[i]) * (progress - f);
  }

  slopeAt(i) { return this.slope[((i % this.n) + this.n) % this.n]; }
  /** How fast the slope changes along the road at sample i: negative over a
   *  crest, positive in a dip. */
  bendAt(i) {
    const n = this.n, k = ((i % n) + n) % n;
    return (this.slope[(k + 1) % n] - this.slope[(k - 1 + n) % n]) / (2 * this.spacing);
  }
  heightOf(i) { return this.h[((i % this.n) + this.n) % this.n]; }
  iceAt(i) { return this.ice[((i % this.n) + this.n) % this.n] === 1; }
  gravelAt(i) { return this.gravel[((i % this.n) + this.n) % this.n] === 1; }
  bridgeAt(i) { return this.bridge[((i % this.n) + this.n) % this.n] === 1; }

  computeCurvature() {
    const c = new Array(this.n);
    const look = Math.max(2, Math.round(3 / this.spacing));
    for (let i = 0; i < this.n; i++) {
      const t0 = this.tangents[i];
      const t1 = this.tangents[(i + look) % this.n];
      let d = Math.atan2(t1.x, t1.z) - Math.atan2(t0.x, t0.z);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      c[i] = Math.abs(d) / (look * this.spacing);
    }
    // Smooth so cars react to a corner rather than a single spike.
    const s = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += c[(i + k + this.n) % this.n];
      s[i] = sum / 5;
    }
    return s;
  }

  point(i) { return this.pts[((i % this.n) + this.n) % this.n]; }
  tangent(i) { return this.tangents[((i % this.n) + this.n) % this.n]; }
  curveAt(i) { return this.curvature[((i % this.n) + this.n) % this.n]; }

  /**
   * Nearest point on the line. `hint` restricts the search to a local window,
   * which keeps this O(1) once a car is on track.
   */
  locate(x, z, hint = null, window = 24) {
    let bestI = 0, bestD = Infinity;
    if (hint === null) {
      for (let i = 0; i < this.n; i++) {
        const p = this.pts[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) { bestD = d; bestI = i; }
      }
    } else {
      for (let k = -window; k <= window; k++) {
        const i = ((hint + k) % this.n + this.n) % this.n;
        const p = this.pts[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) { bestD = d; bestI = i; }
      }
    }
    const t = this.tangent(bestI);
    const p = this.pts[bestI];
    const along = (x - p.x) * t.x + (z - p.z) * t.z;
    // right-hand normal of (t.x, t.z) in XZ is (t.z, -t.x)
    const lat = (x - p.x) * t.z + (z - p.z) * -t.x;
    return {
      index: bestI,
      progress: bestI + Math.max(-1, Math.min(1, along / this.spacing)),
      lateral: lat,
      dist: Math.abs(lat),
      point: p,
      tangent: t,
    };
  }
}


/**
 * Road heights for a circuit that climbs. `def.heights` gives one height per
 * move — where that leg ends — so a track reads like its moves: "R6 to 4,
 * then D5 down to 0". Heights run linearly cell by cell along each leg, are
 * carried onto the racing line, then smoothed so crests and dips round off.
 */
function lineHeights(def, path, line) {
  const toks = def.moves.trim().split(/\s+/);
  const H = def.heights;
  if (H.length !== toks.length) throw new Error(`${def.id}: ${toks.length} moves but ${H.length} heights`);
  const cellH = [];
  let h = H[H.length - 1];
  cellH.push(h);
  toks.forEach((tok, k) => {
    const n = parseInt(tok.slice(1), 10);
    for (let s = 1; s <= n; s++) cellH.push(h + (H[k] - h) * (s / n));
    h = H[k];
  });
  cellH.pop();

  // Walk the line and the cells together, so a sample never matches a cell
  // on some other leg that happens to pass close by.
  const m = path.length, n = line.n;
  const near = (p, c) => (p.x - c.x * TILE) ** 2 + (p.z - c.z * TILE) ** 2;
  let ci = 0, best = Infinity;
  for (let c = 0; c < m; c++) {
    const d = near(line.pts[0], path[c]);
    if (d < best) { best = d; ci = c; }
  }
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = line.pts[i];
    let bc = ci, bd = Infinity;
    for (let k = -2; k <= 4; k++) {
      const c = (ci + k + m) % m;
      const d = near(p, path[c]);
      if (d < bd) { bd = d; bc = c; }
    }
    ci = bc;
    raw[i] = cellH[ci];
  }
  // Three box passes come out close to a Gaussian.
  let cur = raw;
  const r = Math.max(2, Math.round(7 / line.spacing));
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += cur[(i + k + n) % n];
      out[i] = sum / (2 * r + 1);
    }
    cur = out;
  }
  return cur;
}

/** One model's meshes baked into a single geometry in model space, kept so a
 *  hundred trees cost a hundred matrix multiplies, not a hundred clones. */
const baked = new Map();
function bakedGeometry(kit, model) {
  const key = `${kit}/${model}`;
  if (baked.has(key)) return baked.get(key);
  const obj = instance(kit, model);
  obj.updateMatrixWorld(true);
  const parts = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const keep = isVertexKit(kit) ? ['position', 'normal', 'color'] : ['position', 'normal', 'uv'];
    for (const name of Object.keys(g.attributes)) {
      if (!keep.includes(name)) g.deleteAttribute(name);
    }
    // Every piece of a kit has to agree on indexing to merge.
    if (isVertexKit(kit) && g.index) g = g.toNonIndexed();
    parts.push(g);
  });
  const g = parts.length ? mergeGeometries(parts, false) : null;
  parts.forEach((p) => p.dispose());
  baked.set(key, g);
  return g;
}

/** Merge many instances of kit models into as few draw calls as possible. */
function mergeInstances(entries, kit, shiny = false) {
  const geoms = [];
  for (const { model, matrix } of entries) {
    const base = bakedGeometry(kit, model);
    if (base) geoms.push(base.clone().applyMatrix4(matrix));
  }
  if (!geoms.length) return null;
  const merged = mergeGeometries(geoms, false);
  geoms.forEach((g) => g.dispose());
  const mat = shiny ? materialsFor(kit).shiny : materialsFor(kit).scenery;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class Track {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.path = pathFromMoves(def.start, def.moves);
    this.cellSet = new Set(this.path.map((c) => `${c.x},${c.z}`));
    this.walls = !!def.walls;

    // Sweeping corner arcs — the cap in racingLine still keeps chicanes
    // tight, so only corners with room to sweep actually do.
    const radius = (def.cornerRadius ?? 1.5) * TILE;
    this.line = new CentreLine(resampleClosed(racingLine(this.path, TILE, radius, 1.2), 1.2));

    // The Kenney road tile is tarmac across ~0.8 of its width; the rest is
    // kerb and pavement. Matching that gives room to race two abreast.
    this.roadHalf = TILE * 0.40;
    // How far a car may stray before it is pushed back. Open circuits give you
    // a grass shoulder to run wide onto; walled ones stop at the armco.
    this.wallHalf = TILE * (this.walls ? 0.5 : 0.7);
    this.laps = def.laps ?? 3;

    this.group = new THREE.Group();
    this.startIndex = this.findStartIndex();

    if (def.heights) this.line.setHeights(lineHeights(def, this.path, this.line));
    // Ice: stretches given as fractions of the lap from the start line.
    for (const [from, to] of def.ice ?? []) {
      const n = this.line.n;
      const a = Math.round(from * n), b = Math.round(to * n);
      for (let k = a; k < b; k++) this.line.ice[(this.startIndex + k) % n] = 1;
    }
    this.offroad = def.theme?.offroad ?? 'dirt';

    // Crests: a sharp hump in the road, full width. Taken flat out the car
    // goes light over the top and the wheels leave the tarmac for a moment.
    // Added after the smoothing, or the smoothing would iron them out.
    const n = this.line.n, sp = this.line.spacing;
    const at = (frac) => (this.startIndex + Math.round(frac * n)) % n;
    if (def.crests?.length) {
      const h = Array.from(this.line.h);
      for (const c of def.crests) {
        const s0 = at(c.at), len = Math.max(4, Math.round((c.length ?? 12) / sp));
        for (let k = 0; k <= len; k++) h[(s0 + k) % n] += (c.height ?? 0.7) * 0.5 * (1 - Math.cos((2 * Math.PI * k) / len));
      }
      this.line.setHeights(h);
    }
    this.crests = (def.crests ?? []).map((c) => ({ start: at(c.at), len: Math.round((c.length ?? 12) / sp) }));

    // Gravel: the whole road on a rally circuit, or stretches of it.
    const gravel = def.theme?.road === 'gravel' ? [[0, 1]] : def.gravel ?? [];
    for (const [from, to] of gravel) {
      for (let k = Math.round(from * n); k < Math.round(to * n); k++) this.line.gravel[(this.startIndex + k) % n] = 1;
    }

    // Bridges: where the road passes over itself, the higher stretch is a
    // deck, from a little before the crossing to a little after. Found, not
    // authored: any sample right above another part of the lap.
    const L = this.line, far = Math.round(60 / sp), reach = (TILE * 0.8) ** 2;
    const over = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const gap = Math.abs(i - j);
        if (Math.min(gap, n - gap) < far || L.h[i] - L.h[j] < 3) continue;
        if ((L.pts[i].x - L.pts[j].x) ** 2 + (L.pts[i].z - L.pts[j].z) ** 2 < reach) { over.push(i); break; }
      }
    }
    const span = Math.round(16 / sp);
    for (const i of over) for (let k = -span; k <= span; k++) L.bridge[(i + k + n) % n] = 1;
    this.hasBridge = over.length > 0;
    // Where the deck runs, for the race to tell when the player is under it.
    this.bridgeMeshes = [];
    this.bridgePts = [];
    for (let i = 0; i < n; i += 2) if (L.bridge[i]) this.bridgePts.push({ x: L.pts[i].x, z: L.pts[i].z, h: L.h[i] });
    this.arches = [];
    // Jump ramps: a wedge on the road, across part of it or all of it, that
    // throws a car into the air off its lip. `lane` is where across the road
    // it sits (-1 one edge, 0 the middle, 1 the other), `width` how much of
    // the road it covers — a part-width ramp is a choice, not an obligation.
    this.ramps = (def.jumps ?? []).map((j) => ({
      start: at(j.at),
      len: Math.max(3, Math.round((j.length ?? 8) / sp)),
      height: j.height ?? 1.5,
      center: (j.lane ?? 0) * this.roadHalf,
      half: j.width === 'full' ? this.wallHalf + 0.6 : (j.width ?? 0.5) * this.roadHalf,
    }));
  }

  /** The ramp under a point given as a line progress and a lateral offset. */
  rampUnder(progress, lateral) {
    if (!this.ramps.length) return null;
    const n = this.line.n;
    for (const r of this.ramps) {
      const d = (((progress - r.start) % n) + n) % n;
      if (d < r.len && Math.abs(lateral - r.center) <= r.half) return { r, d };
    }
    return null;
  }

  /** Extra height from a ramp, and its slope (rise per unit run). */
  rampAt(progress, lateral) {
    const u = this.rampUnder(progress, lateral);
    return u ? u.r.height * (u.d / u.r.len) : 0;
  }

  rampSlopeAt(progress, lateral) {
    const u = this.rampUnder(progress, lateral);
    return u ? u.r.height / (u.r.len * this.line.spacing) : 0;
  }

  /** Whether a crest or ramp lies within `dist` units of sample i. */
  featureNear(i, dist) {
    const n = this.line.n, k = dist / this.line.spacing;
    return [...this.ramps, ...this.crests].some((f) => {
      const d = (((i - f.start) % n) + n) % n;
      return d < f.len + k || d > n - k;
    });
  }

  /** Height of the ground (or road) at a point; zero on a flat circuit. */
  heightAt(x, z) {
    return this.terrain ? this.terrain.sample(x, z) : 0;
  }

  /** Put the start/finish on the longest straight so the grid fits. */
  findStartIndex() {
    const n = this.line.n;
    // The grid reaches this many samples back from the line (three rows of
    // two, 8 units apart — see startSlots), plus a little breathing room.
    const gridDepth = Math.round(24 / this.line.spacing) + 3;
    // Scan far enough that the truly longest straight wins the tie: the grid
    // stands behind the line and the pack still gets a real launch run ahead
    // of it before the first corner.
    const scan = Math.min(n, gridDepth + Math.round(60 / this.line.spacing));
    let best = 0, bestRun = -1;
    for (let i = 0; i < n; i++) {
      let flat = 0;
      for (let k = 0; k < scan; k++) {
        if (this.line.curveAt(i + k) < 0.01) flat++; else break;
      }
      if (flat > bestRun) { bestRun = flat; best = i; }
    }
    // Advance the line far enough into the straight that the whole grid sits
    // behind it on flat road, not back in the preceding corner.
    return (best + Math.max(0, Math.min(bestRun - 1, gridDepth))) % n;
  }

  startSlots(count) {
    const slots = [];
    const lane = this.roadHalf * 0.5;
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 2), col = i % 2;
      const idx = this.startIndex - Math.round((8 + row * 8) / this.line.spacing);
      const p = this.line.point(idx);
      const t = this.line.tangent(idx);
      const off = col === 0 ? -lane : lane;
      slots.push({
        x: p.x + t.z * off,
        z: p.z - t.x * off,
        heading: Math.atan2(t.x, t.z),
        index: ((idx % this.line.n) + this.line.n) % this.line.n,
        // Un-normalized, so every car's totalProgress shares one baseline
        // even when a back row wraps past sample zero.
        raw: idx,
      });
    }
    return slots;
  }

  build(scene) {
    const theme = this.def.theme || {};
    if (theme.terrain) {
      // Ground with height in it; its mesh goes in once the scenery has
      // flattened what it stands on (see buildScenery).
      this.terrain = new Terrain(this, theme.terrain);
    } else {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1400, 1400),
        new THREE.MeshLambertMaterial({ color: theme.ground ?? 0x7aa25a }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.06;
      ground.receiveShadow = true;
      this.group.add(ground);
    }

    this.buildRoad(theme);

    this.buildStartLine();
    this.buildStartGate();

    this.buildScenery(theme);
    scene.add(this.group);
  }

  /** A ribbon strip that follows the racing line between two lateral offsets. */
  lineStrip(innerOff, outerOff, y, colour, y2 = null, material = null, keep = null) {
    const line = this.line, n = line.n;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const nrm = new Float32Array((n + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const p = line.point(i), t = line.tangent(i), h = line.heightOf(i);
      const lx = t.z, lz = -t.x;
      const o = i * 6;
      pos[o] = p.x + lx * outerOff; pos[o + 1] = y + h; pos[o + 2] = p.z + lz * outerOff;
      pos[o + 3] = p.x + lx * innerOff; pos[o + 4] = (y2 ?? y) + h; pos[o + 5] = p.z + lz * innerOff;
      nrm[o + 1] = 1; nrm[o + 4] = 1;
      if (i < n && (!keep || keep(i))) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, material ?? new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Whether the stretch from sample i to the next is bridge deck. */
  onDeck(i) { return this.line.bridgeAt(i) && this.line.bridgeAt(i + 1); }

  /** Something on a bridge: it gets its own material, ready to fade while
   *  the player drives underneath (race.js). */
  fadeable(mesh) {
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    this.bridgeMeshes.push(mesh);
    return mesh;
  }

  /**
   * A strip the length of the lap. On a circuit with a bridge the deck's
   * stretch is a mesh of its own, so the bridge can fade as a whole.
   */
  addStrip(innerOff, outerOff, y, colour, y2 = null, material = null) {
    if (!this.hasBridge) {
      const m = this.lineStrip(innerOff, outerOff, y, colour, y2, material);
      this.group.add(m);
      return [m];
    }
    const ground = this.lineStrip(innerOff, outerOff, y, colour, y2, material, (i) => !this.onDeck(i));
    const deck = this.fadeable(this.lineStrip(innerOff, outerOff, y, colour, y2, material, (i) => this.onDeck(i)));
    this.group.add(ground, deck);
    return [ground, deck];
  }

  /** A short piece of ribbon from sample i0 to i1, riding the road's height. */
  stripPiece(i0, i1, innerOff, outerOff, y) {
    const line = this.line;
    const pos = [], idx = [];
    for (let i = i0; i <= i1; i++) {
      const p = line.point(i), t = line.tangent(i), h = line.heightOf(i) + y;
      pos.push(p.x + t.z * outerOff, h, p.z - t.x * outerOff, p.x + t.z * innerOff, h, p.z - t.x * innerOff);
      if (i < i1) {
        const a = (i - i0) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /**
   * The road is a ribbon that follows the racing line, so the tarmac shows
   * exactly what the handling model drives: sweeping corner arcs instead of
   * square tile bends. Everything else still comes from the Kenney kits.
   */
  buildRoad(theme) {
    const w = this.roadHalf;
    this.addStrip(-w - 0.8, w + 0.8, 0.09, theme.kerbColour ?? 0x99a1b0);
    this.addStrip(-w, w, 0.11, theme.roadColour ?? 0x4a505c);

    // Dashed centre line.
    const line = this.line, n = line.n;
    const geoms = [], deckGeoms = [];
    const step = Math.max(4, Math.round(6 / line.spacing));
    const dashLen = Math.max(1, Math.round(2.3 / line.spacing));
    // A gravel road has no paint.
    for (let i = 0; i < n && theme.dashes !== false; i += step) {
      (this.onDeck(i) ? deckGeoms : geoms).push(this.stripPiece(i, i + dashLen, -0.13, 0.13, 0.125));
    }
    for (const [list, onBridge] of [[geoms, false], [deckGeoms, true]]) {
      if (!list.length) continue;
      const dashes = new THREE.Mesh(mergeGeometries(list, false), new THREE.MeshLambertMaterial({ color: 0xe9edf5 }));
      list.forEach((g) => g.dispose());
      this.group.add(onBridge ? this.fadeable(dashes) : dashes);
    }

    if (theme.kerbs !== false) this.buildKerbs();
    this.buildGridBoxes();
    this.buildIce();
    this.buildGravel(theme);
    this.buildRamps();
    this.buildBridges(theme);
    this.buildArches(theme);

    // On walled circuits the armco follows the same line the cars are
    // clamped to, so the rail you see is the limit you hit.
    if (this.walls) this.buildArmco();
  }

  /**
   * Corners as runs of bent samples that turn one way: where each starts, how
   * long it is, how far it turns and which side is its inside. An S-bend is
   * two corners, not one that nets out to nothing. Left of the direction of
   * travel is +1 (the (t.z, -t.x) axis the road strips use).
   */
  corners() {
    if (this._corners) return this._corners;
    const line = this.line, n = line.n;
    const look = Math.max(2, Math.round(3 / line.spacing));
    const turnAt = (i) => {
      const a = line.tangent(i), b = line.tangent(i + look);
      let d = Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    };
    const bent = (i) => line.curveAt(i) > 0.012;
    // Begin on a straight so no corner straddles the seam.
    let s0 = 0;
    while (s0 < n && bent(s0)) s0++;
    const runs = [];
    for (let k = 0; k < n;) {
      const i = s0 + k;
      if (!bent(i)) { k++; continue; }
      const dir = Math.sign(turnAt(i)) || 1;
      let len = 0, turn = 0;
      while (k + len < n && bent(i + len) && (Math.sign(turnAt(i + len)) || dir) === dir) {
        const a = line.tangent(i + len), b = line.tangent(i + len + 1);
        turn += Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
        len++;
      }
      runs.push({ start: i % n, len, turn, inside: dir, outside: -dir });
      k += Math.max(1, len);
    }
    return (this._corners = runs);
  }

  /** Red-and-white kerbs on both edges through every corner. */
  buildKerbs() {
    const line = this.line, w = this.roadHalf;
    const pos = [], col = [];
    const red = new THREE.Color(0xd63a3a), white = new THREE.Color(0xf1f3f6);
    for (const run of this.corners()) {
      if (run.turn < 0.35) continue;          // a kink, not a corner
      for (let k = -2; k < run.len + 2; k++) {
        const i = run.start + k;
        const p0 = line.point(i), p1 = line.point(i + 1);
        const t0 = line.tangent(i), t1 = line.tangent(i + 1);
        const c = ((i % 2) + 2) % 2 ? red : white;
        for (const side of [-1, 1]) {
          const q = (p, t, off, h) => [p.x + t.z * off * side, 0.118 + h, p.z - t.x * off * side];
          const h0 = line.heightOf(i), h1 = line.heightOf(i + 1);
          const a = q(p0, t0, w - 0.15, h0), b = q(p0, t0, w + 0.85, h0);
          const d = q(p1, t1, w - 0.15, h1), e = q(p1, t1, w + 0.85, h1);
          pos.push(...a, ...b, ...d, ...b, ...e, ...d);
          for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
        }
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Painted grid slots: a bar ahead of each car and a tick either side. */
  buildGridBoxes() {
    const geoms = [];
    const add = (x, y, z, heading, across, along, w, d) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(across, 0, -along);   // local +X is the car's left, +Z its forward
      g.rotateY(heading);
      g.translate(x, 0.122 + y, z);
      geoms.push(g);
    };
    for (const slot of this.startSlots(6)) {
      const h = slot.heading, y = this.line.heightOf(slot.index);
      add(slot.x, y, slot.z, h, 0, -1.7, 2.5, 0.24);          // bar across, just ahead of the nose
      for (const s of [-1, 1]) add(slot.x, y, slot.z, h, s * 1.25, -1.05, 0.2, 1.5);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geoms, false), new THREE.MeshLambertMaterial({ color: 0xeef1f6 }));
    geoms.forEach((g) => g.dispose());
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /**
   * Ice: glossy pale patches across the tarmac with ragged edges, a touch
   * above the road so they read as a surface, not a paint job.
   */
  buildIce() {
    const line = this.line, n = line.n;
    if (!line.ice.some((v) => v)) return;
    const rng = mulberry32((this.def.seed ?? 1) + 404);
    const w = this.roadHalf;
    const pos = [], idx = [];
    let row = 0;
    for (let i = 0; i <= n; i++) {
      const on = line.iceAt(i) || line.iceAt(i - 1);
      if (!on) { row = 0; continue; }
      const p = line.point(i), t = line.tangent(i), h = line.heightOf(i) + 0.13;
      const a = w * (0.7 + rng() * 0.28), b = w * (0.7 + rng() * 0.28);
      const base = pos.length / 3;
      pos.push(p.x + t.z * a, h, p.z - t.x * a, p.x - t.z * b, h, p.z + t.x * b);
      if (row > 0) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
      row++;
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshPhongMaterial({
      color: 0xd6ecff, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.72,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /**
   * Ramps: a striped wedge riding the road, with plain sides and a dark lip
   * face, and an orange pole with a pennant either side of its foot so it
   * reads from a distance.
   */
  buildRamps() {
    if (!this.ramps.length) return;
    const line = this.line;
    const pos = [], col = [];
    const stripeA = new THREE.Color(0xf59e0b), stripeB = new THREE.Color(0x262a33);
    const side = new THREE.Color(0x8f9aa8), lip = new THREE.Color(0x1d2129);
    const quad = (a, b, c, d, colour) => {
      pos.push(...a, ...b, ...c, ...b, ...d, ...c);
      for (let v = 0; v < 6; v++) col.push(colour.r, colour.g, colour.b);
    };
    const poles = [];
    for (const r of this.ramps) {
      const at = (k, off, lift) => {
        const i = r.start + k, p = line.point(i), t = line.tangent(i);
        const y = line.heightOf(i) + 0.11 + lift;
        return [p.x + t.z * off, y, p.z - t.x * off];
      };
      const lo = r.center - r.half, hi = r.center + r.half;
      for (let k = 0; k < r.len; k++) {
        const h0 = (r.height * k) / r.len, h1 = (r.height * (k + 1)) / r.len;
        const c = Math.floor(k / 2) % 2 ? stripeA : stripeB;
        quad(at(k, hi, h0), at(k, lo, h0), at(k + 1, hi, h1), at(k + 1, lo, h1), c);
        for (const off of [lo, hi]) quad(at(k, off, 0), at(k, off, h0), at(k + 1, off, 0), at(k + 1, off, h1), side);
      }
      quad(at(r.len, hi, 0), at(r.len, lo, 0), at(r.len, hi, r.height), at(r.len, lo, r.height), lip);
      for (const off of [lo - 0.5, hi + 0.5]) {
        const [x, y, z] = at(0, off, 0);
        const pole = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6);
        pole.translate(x, y + 1.2, z);
        poles.push(pole);
        const flag = new THREE.BoxGeometry(0.06, 0.45, 0.7);
        flag.translate(x, y + 2.15, z + 0.35);
        poles.push(flag);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const flags = new THREE.Mesh(mergeGeometries(poles, false), new THREE.MeshLambertMaterial({ color: 0xff7a1a }));
    poles.forEach((p) => p.dispose());
    flags.castShadow = true;
    this.group.add(flags);
  }

  /** Gravel stretches on a tarmac circuit: a loose, dusty band over the road. */
  buildGravel(theme) {
    const line = this.line, n = line.n;
    if (theme.road === 'gravel' || !line.gravel.some((v) => v)) return;
    const rng = mulberry32((this.def.seed ?? 1) + 77);
    const w = this.roadHalf;
    const pos = [], idx = [];
    let row = 0;
    for (let i = 0; i <= n; i++) {
      if (!(line.gravelAt(i) || line.gravelAt(i - 1))) { row = 0; continue; }
      const p = line.point(i), t = line.tangent(i), h = line.heightOf(i) + 0.125;
      const a = w * (0.92 + rng() * 0.12), b = w * (0.92 + rng() * 0.12);
      const base = pos.length / 3;
      pos.push(p.x + t.z * a, h, p.z - t.x * a, p.x - t.z * b, h, p.z + t.x * b);
      if (row > 0) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
      row++;
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: theme.gravelColour ?? 0x9c7a55, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Distance from a point to the nearest road that is not a bridge deck. */
  groundRoadDist(x, z) {
    const line = this.line;
    let best = Infinity;
    for (let i = 0; i < line.n; i++) {
      if (line.bridge[i]) continue;
      const p = line.pts[i];
      best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    }
    return Math.sqrt(best);
  }

  /**
   * A bridge where the road crosses over itself: a deck under the road
   * ribbon out to a parapet either side, and pillars down to the ground —
   * none of them standing on the road that runs underneath.
   */
  buildBridges(theme) {
    if (!this.hasBridge) return;
    if (this.def.bridgeModel && this.buildBridgeModel(this.def.bridgeModel)) return;
    const line = this.line, n = line.n;
    const W = this.wallHalf + 0.6, depth = 1.2, wall = 0.9;
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...b, ...d, ...c);
    const at = (i, off, dy) => {
      const p = line.point(i), t = line.tangent(i);
      return [p.x + t.z * off, line.heightOf(i) + dy, p.z - t.x * off];
    };
    const posts = [];
    const every = Math.max(4, Math.round(11 / line.spacing));
    for (let i = 0; i < n; i++) {
      if (!line.bridgeAt(i) || !line.bridgeAt(i + 1)) continue;
      const j = i + 1;
      quad(at(i, -W, -depth), at(i, W, -depth), at(j, -W, -depth), at(j, W, -depth));        // underside
      for (const s of [-1, 1]) {
        const o = s * W, inner = s * (W - 0.35);
        quad(at(i, o, -depth), at(i, o, wall), at(j, o, -depth), at(j, o, wall));           // outer face
        quad(at(i, inner, 0.05), at(i, inner, wall), at(j, inner, 0.05), at(j, inner, wall)); // inner face
        quad(at(i, inner, wall), at(i, o, wall), at(j, inner, wall), at(j, o, wall));        // top
        quad(at(i, s * (this.roadHalf + 0.8), 0.095), at(i, inner, 0.095), at(j, s * (this.roadHalf + 0.8), 0.095), at(j, inner, 0.095)); // deck edge
      }
      if (i % every === 0) {
        for (const s of [-1, 1]) {
          const [x, y, z] = at(i, s * (W - 1.1), -depth);
          if (this.groundRoadDist(x, z) < this.wallHalf + 1.6) continue;
          const foot = Math.min(this.terrain ? this.terrain.sample(x, z) : 0, 0) - 4;
          const g = new THREE.BoxGeometry(1.3, y - foot, 1.3);
          g.translate(x, (y + foot) / 2, z);
          posts.push(g);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: theme.bridgeColour ?? 0xb8a58e, side: THREE.DoubleSide });
    const deck = new THREE.Mesh(g, mat);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.group.add(this.fadeable(deck));
    if (posts.length) {
      const m = new THREE.Mesh(mergeGeometries(posts, false), mat);
      posts.forEach((p) => p.dispose());
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(this.fadeable(m));
    }
  }

  /**
   * A modelled bridge, bent onto the line: the model's x runs along the lap
   * from the crossing (`half` units either way, stretched to the deck's real
   * ends), y rides the deck's height and z goes out across the road.
   */
  buildBridgeModel(spec) {
    const base = bakedGeometry(spec.kit, spec.model);
    if (!base) return false;
    const line = this.line, n = line.n, sp = line.spacing;
    // The deck over the crossing: its ends, and the sample right above the road below.
    let c = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!line.bridgeAt(i)) continue;
      const p = line.pts[i], d = this.groundRoadDist(p.x, p.z);
      if (d < best) { best = d; c = i; }
    }
    let b0 = c, b1 = c;
    while (line.bridgeAt(b0 - 1) && c - b0 < n) b0--;
    while (line.bridgeAt(b1 + 1) && b1 - c < n) b1++;
    const back = (c - b0) / spec.half, ahead = (b1 + 1 - c) / spec.half;

    const g = base.clone();
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const f = c + x * (x < 0 ? back : ahead);
      const i = Math.floor(f), u = f - i;
      const p0 = line.point(i), p1 = line.point(i + 1);
      const t0 = line.tangent(i), t1 = line.tangent(i + 1);
      const tx = t0.x + (t1.x - t0.x) * u, tz = t0.z + (t1.z - t0.z) * u;
      const tl = Math.hypot(tx, tz) || 1;
      const px = p0.x + (p1.x - p0.x) * u, pz = p0.z + (p1.z - p0.z) * u;
      // +z is right of travel, -(t.z, -t.x): keeps the frame right-handed,
      // so the faces still wind outwards.
      pos.setXYZ(k, px - (tz / tl) * z, line.heightAt(f) + y, pz + (tx / tl) * z);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, materialsFor(spec.kit).scenery);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(this.fadeable(mesh));
    this.bridgeModelBuilt = true;
    return true;
  }

  /**
   * Natural rock arches over the road. They would hide the cars beneath, so
   * each keeps its material to itself and the race fades it while the
   * player is underneath.
   */
  buildArches(theme) {
    const n = this.line.n;
    for (const a of this.def.arches ?? []) {
      const i = (this.startIndex + Math.round(a.at * n)) % n;
      const p = this.line.point(i), t = this.line.tangent(i), h = this.line.heightOf(i);
      const R = this.wallHalf + 2.6 + (a.extra ?? 0);
      const geo = new THREE.TorusGeometry(R, 2.1, 5, 11, Math.PI);
      // Rough it up: rock, not a doughnut.
      const rng = mulberry32((this.def.seed ?? 1) + i);
      const v = geo.attributes.position;
      for (let k = 0; k < v.count; k++) {
        v.setXYZ(k, v.getX(k) * (1 + (rng() - 0.5) * 0.08), v.getY(k) * (1 + (rng() - 0.5) * 0.1), v.getZ(k) + (rng() - 0.5) * 0.9);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: theme.archColour ?? 0xb4532d, flatShading: true, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      // The torus lies in its own XY plane: turn its X axis across the road.
      const lx = t.z, lz = -t.x;
      mesh.rotation.y = Math.atan2(-lz, lx);
      mesh.position.set(p.x, h - 0.6, p.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.arches.push({ x: p.x, y: h, z: p.z, mat });
    }
  }

  buildArmco() {
    const line = this.line, n = line.n;
    const off = this.wallHalf + 0.4;
    const railMat = new THREE.MeshLambertMaterial({ color: 0xc6cdd9, side: THREE.DoubleSide });
    const postGeoms = [], deckPosts = [];
    // A stone bridge's parapet is the barrier on the deck: no rail there.
    const stone = this.bridgeModelBuilt;
    for (const side of [-1, 1]) {
      const rails = stone
        ? [this.lineStrip(off * side, off * side, 0.95, 0xc6cdd9, 0.45, railMat, (i) => !this.onDeck(i))]
        : this.addStrip(off * side, off * side, 0.95, 0xc6cdd9, 0.45, railMat);
      if (stone) this.group.add(rails[0]);
      for (const rail of rails) rail.castShadow = true;

      const step = Math.max(3, Math.round(5 / line.spacing));
      for (let i = 0; i < n; i += step) {
        if (stone && this.onDeck(i)) continue;
        const p = line.point(i), t = line.tangent(i);
        const g = new THREE.BoxGeometry(0.24, 1.0, 0.24);
        g.translate(p.x + t.z * off * side, 0.5 + line.heightOf(i), p.z - t.x * off * side);
        (this.onDeck(i) ? deckPosts : postGeoms).push(g);
      }
    }
    for (const [list, onBridge] of [[postGeoms, false], [deckPosts, true]]) {
      if (!list.length) continue;
      const posts = new THREE.Mesh(mergeGeometries(list, false), new THREE.MeshLambertMaterial({ color: 0x6a7280 }));
      list.forEach((g) => g.dispose());
      posts.castShadow = true;
      this.group.add(onBridge ? this.fadeable(posts) : posts);
    }
  }

  /** Black-and-white check, shared by the painted line and the banner. */
  checkerTexture(cols, rows) {
    const cell = 16;
    const c = document.createElement('canvas');
    c.width = cols * cell; c.height = rows * cell;
    const g = c.getContext('2d');
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        g.fillStyle = (x + y) % 2 ? '#f4f6fa' : '#1e222c';
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Checkered paint across the asphalt on the start/finish line. */
  buildStartLine() {
    const width = this.roadHalf * 2;
    const geo = new THREE.PlaneGeometry(width, 1.8);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.checkerTexture(8, 2) }));
    const p = this.line.point(this.startIndex);
    const t = this.line.tangent(this.startIndex);
    mesh.position.set(p.x, 0.175 + this.line.heightOf(this.startIndex), p.z);
    mesh.rotation.y = Math.atan2(t.x, t.z);
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  /**
   * Start/finish gantry: two posts outside the track limit and a banner slung
   * between them. Built rather than instanced, because the kit's finish hoop
   * narrows towards the ground -- its opening is far tighter than its overall
   * width, so scaling it to span the road plants both feet on the tarmac.
   */
  buildStartGate() {
    const p = this.line.point(this.startIndex);
    const t = this.line.tangent(this.startIndex);
    const heading = Math.atan2(t.x, t.z);

    const reach = this.walls ? this.wallHalf + 0.35 : this.roadHalf + 0.6;
    const postH = 4.5;
    const post = new THREE.BoxGeometry(0.5, postH, 0.5);
    const frame = new THREE.MeshLambertMaterial({ color: 0x525a68 });
    const gantry = new THREE.Group();

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(post, frame);
      leg.position.set(side * reach, postH / 2, 0);
      leg.castShadow = true;
      gantry.add(leg);
    }

    const span = reach * 2 + 0.5;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.45, 0.6), frame);
    beam.position.set(0, postH - 0.22, 0);
    beam.castShadow = true;
    gantry.add(beam);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(span - 0.6, 1.15),
      new THREE.MeshLambertMaterial({
        map: this.checkerTexture(Math.max(6, Math.round(span / 1.15)), 2),
        side: THREE.DoubleSide,
      }),
    );
    banner.position.set(0, postH - 1.02, 0);
    gantry.add(banner);

    // Five start lights on top of the beam: they fill red through the
    // countdown and all go green at the start (Race drives them).
    const housing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.7, 0.7), new THREE.MeshLambertMaterial({ color: 0x2b3040 }));
    housing.position.set(0, postH + 0.35, 0);
    housing.castShadow = true;
    gantry.add(housing);
    this.startLamps = [];
    const bulb = new THREE.SphereGeometry(0.34, 14, 10);
    for (let k = 0; k < 5; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x1a1d26 });
      const lamp = new THREE.Mesh(bulb, mat);
      lamp.position.set((k - 2) * 0.88, postH + 0.62, 0);
      gantry.add(lamp);
      this.startLamps.push(mat);
    }

    gantry.position.set(p.x, this.line.heightOf(this.startIndex), p.z);
    gantry.rotation.y = heading;
    this.group.add(gantry);
  }


  /** Light `lit` of the five start lights in `colour`; the rest go dark. */
  setStartLights(lit, colour = 0xff3b30) {
    if (!this.startLamps || (this.shownLit === lit && this.shownColour === colour)) return;
    this.shownLit = lit; this.shownColour = colour;
    this.startLamps.forEach((m, k) => m.color.setHex(k < lit ? colour : 0x1a1d26));
  }

  /**
   * A grandstand on the far side of the start straight — far from the camera,
   * so it frames the grid instead of hiding it. Stepped terraces with a crowd
   * on every step and a banner along the back wall; no roof, because from
   * this camera a roof is all you would see. Returns the ground it covers so
   * nothing else is placed on top of it.
   */
  buildGrandstand() {
    const line = this.line;
    const i = this.startIndex + Math.round(4 / line.spacing);
    const p = line.point(i), t = line.tangent(i);
    const side = -Math.sign(t.z - t.x) || 1;             // camera-far side
    const heading = Math.atan2(t.x, t.z);
    const length = 26, tiers = 5, step = 1.3, rise = 0.7;
    const inner = this.wallHalf + (this.walls ? 2.2 : 2.6);
    const at = (k) => side * (inner + k * step + step / 2);
    const concrete = [], painted = [], paintCol = [];
    const paint = (g, colour) => {
      const c = new THREE.Color(colour);
      for (let v = 0; v < g.attributes.position.count; v++) paintCol.push(c.r, c.g, c.b);
      painted.push(g);
    };
    const rng = mulberry32((this.def.seed ?? 1) + 99);
    const shirts = [0xef4444, 0xfacc15, 0x38bdf8, 0xf8fafc, 0x22c55e, 0xfb923c, 0xa78bfa, 0xf472b6, 0x1f2937];
    const skin = [0xf1c9a5, 0xd9a47a, 0xa8714a, 0x6e4a33];
    for (let k = 0; k < tiers; k++) {
      const h = (k + 1) * rise;
      const g = new THREE.BoxGeometry(step, h, length);
      g.translate(at(k), h / 2, 0);
      concrete.push(g);
      // Seats in team colours along each step, a spectator in most of them.
      const seats = new THREE.BoxGeometry(step * 0.5, 0.08, length - 0.4);
      seats.translate(at(k) + side * step * 0.12, h + 0.04, 0);
      paint(seats, k % 2 ? 0x2d6cdf : 0xd63a3a);
      for (let z = -length / 2 + 0.5; z < length / 2 - 0.3; z += 0.72) {
        if (rng() < 0.12) continue;
        const body = new THREE.BoxGeometry(0.5, 0.62, 0.48);
        body.translate(at(k) + side * step * 0.12, h + 0.39, z + (rng() - 0.5) * 0.12);
        paint(body, shirts[Math.floor(rng() * shirts.length)]);
        const head = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        head.translate(at(k) + side * step * 0.12, h + 0.86, z);
        paint(head, skin[Math.floor(rng() * skin.length)]);
      }
    }
    // Back wall, with a banner along its top in the circuit's colours.
    const back = inner + tiers * step;
    const wallH = tiers * rise + 1.3;
    const wall = new THREE.BoxGeometry(0.4, wallH, length);
    wall.translate(side * (back + 0.2), wallH / 2, 0);
    concrete.push(wall);
    const cells = 13;
    for (let k = 0; k < cells; k++) {
      const b = new THREE.BoxGeometry(0.1, 0.9, length / cells);
      b.translate(side * (back - 0.02), wallH - 0.55, -length / 2 + (k + 0.5) * (length / cells));
      paint(b, k % 2 ? 0xf1f3f6 : 0xd63a3a);
    }
    if (this.terrain) {
      // On a hillside the stand needs a foundation to stand level on.
      const footing = new THREE.BoxGeometry(tiers * step + 0.4, 6, length);
      footing.translate(side * (inner + (tiers * step) / 2 + 0.2), -3, 0);
      concrete.push(footing);
    }
    const group = new THREE.Group();
    const standMesh = new THREE.Mesh(mergeGeometries(concrete, false), new THREE.MeshLambertMaterial({ color: 0xb7bdc8 }));
    standMesh.castShadow = true; standMesh.receiveShadow = true;
    group.add(standMesh);
    const crowd = mergeGeometries(painted, false);
    crowd.setAttribute('color', new THREE.Float32BufferAttribute(paintCol, 3));
    const crowdMesh = new THREE.Mesh(crowd, new THREE.MeshLambertMaterial({ vertexColors: true }));
    crowdMesh.castShadow = true;
    group.add(crowdMesh);
    concrete.forEach((g) => g.dispose()); painted.forEach((g) => g.dispose());
    const standY = line.heightOf(i);
    group.position.set(p.x, standY, p.z);
    group.rotation.y = heading;
    this.group.add(group);

    // The ground it stands on, as circles along its length.
    const mid = inner + (tiers * step) / 2;
    const cover = [];
    for (let z = -length / 2; z <= length / 2; z += 4) {
      const lx = side * mid;                              // local +X is the left axis
      cover.push({ x: p.x + t.z * lx + t.x * z, z: p.z - t.x * lx + t.z * z, r: tiers * step / 2 + 3, h: standY - 0.05 });
    }
    return cover;
  }

  /**
   * Trackside furniture with a job to do, by the theme's `dress` roles:
   * street lamps at an even spacing along the camera-far side; a warning sign
   * on the outside, before each real corner; on rally roads a fence along the
   * straights and barriers round the outside of the corners. Nothing is ever
   * placed where a car at the track limit could reach it.
   */
  buildDressing(dress, push, reserved) {
    if (!dress) return;
    const line = this.line, n = line.n, sp = line.spacing;
    const fromStart = (i) => Math.abs((((i - this.startIndex) % n) + n + n / 2) % n - n / 2) * sp;
    const farSide = (t) => -Math.sign(t.z - t.x) || 1;
    // Clear of every stretch of road, measured square to it: where the lap
    // crosses itself the nearest sample can belong to the wrong road.
    const roadClear = (x, z, i, own, other) => {
      for (let k = 0; k < n; k++) {
        const q = line.pts[k], t = line.tangent(k);
        const along = (x - q.x) * t.x + (z - q.z) * t.z;
        if (Math.abs(along) > sp * 0.6) continue;
        const lat = Math.abs((x - q.x) * t.z - (z - q.z) * t.x);
        const gap = Math.abs((((k - i) % n) + n + n / 2) % n - n / 2) * sp;
        if (lat < (gap < 30 ? own : other)) return false;
      }
      return true;
    };
    const place = (spec, i, side, off, yaw) => {
      if (line.bridgeAt(i)) return;                       // the ground here is a road below
      const p = line.point(i), t = line.tangent(i);
      const sc = TILE * (spec.scale ?? 1);
      const px = p.x + t.z * off * side, pz = p.z - t.x * off * side;
      if (!roadClear(px, pz, i, this.wallHalf + 0.5, this.wallHalf + 3)) return;
      if (reserved.some((r) => Math.hypot(px - r.x, pz - r.z) < r.r)) return;
      // `base` is where the model's foot sits, in model units; `turn` swings
      // a model whose arm or face points the other way from its kin.
      const [bx, bz] = spec.base ?? [0, 0];
      const m = new THREE.Matrix4().makeTranslation(px, 0, pz)
        .multiply(new THREE.Matrix4().makeRotationY(yaw(t, side) + (spec.turn ?? 0)))
        .scale(new THREE.Vector3(sc, sc, sc))
        .multiply(new THREE.Matrix4().makeTranslation(-bx, 0, -bz));
      push(spec.kit, spec.model, m, { x: px, z: pz, foot: 0 });
    };
    const beyond = this.walls ? 1.3 : 0.9;              // outside the armco where there is one
    // Model axes: lamp arms reach along local -Z; a sign's face and a fence's
    // run lie along local X; a barrier's length along local Z.
    const armOver = (t, side) => Math.atan2(t.x, t.z) + side * Math.PI / 2;
    const faceOncoming = (t) => Math.atan2(t.z, -t.x);
    const alongX = (t) => Math.atan2(-t.z, t.x);
    const alongZ = (t) => Math.atan2(t.x, t.z);

    if (dress.lamp) {
      const every = Math.max(1, Math.round(16 / sp));
      for (let i = 0; i < n; i += every) {
        if (fromStart(i) < 10) continue;
        const t = line.tangent(i);
        place(dress.lamp, i, farSide(t), this.wallHalf + beyond, armOver);
      }
    }
    for (const run of this.corners()) {
      if (run.turn < 0.8) continue;                      // only corners that ask you to brake
      if (dress.cornerSign) {
        const i = run.start - Math.round(9 / sp);
        if (fromStart(i) > 10) place(dress.cornerSign, i, run.outside, this.wallHalf + beyond + 0.4, faceOncoming);
      }
      if (dress.cornerBarrier) {
        const b = dress.cornerBarrier;
        const every = Math.max(1, Math.round((b.every ?? 2.8) / sp));
        for (let k = 0; k <= run.len; k += every) place(b, run.start + k, run.outside, this.wallHalf + 1.0, b.alongX ? alongX : alongZ);
      }
    }
    if (dress.fence) {
      const seg = dress.fence.length * TILE * (dress.fence.scale ?? 1);
      let run = 0;
      for (let i = 0; i < n; i++) {
        const straight = line.curveAt(i) < 0.004 && line.curveAt(i + 3) < 0.004 && line.curveAt(i - 3) < 0.004;
        run = straight && fromStart(i) > 14 ? run + sp : 0;
        if (run >= seg) {
          run = 0;
          const j = i - Math.round(seg / 2 / sp);
          place(dress.fence, j, farSide(line.tangent(j)), this.wallHalf + 1.2, alongX);
        }
      }
    }
  }

  /**
   * What the last flood left in the dry river (terrain.js, carveRiver):
   * cobbles, mud cracked by the sun, the odd log and boulder in the bed,
   * dead reeds along the banks, and a depth post either side of the ford.
   */
  buildRiver(push, rng) {
    const path = this.terrain?.riverPath;
    if (!path?.length) return;
    const kit = 'canyon';
    const line = this.line, n = line.n;
    const clearOfRoad = (x, z, r) => line.locate(x, z, null).dist > this.wallHalf + 1.5 + r;
    const put = (model, x, z, scale, foot, yaw = rng() * Math.PI * 2) => {
      if (!clearOfRoad(x, z, foot)) return;
      const m = new THREE.Matrix4().makeRotationY(yaw).scale(new THREE.Vector3(scale, scale, scale));
      m.setPosition(x, 0, z);
      push(kit, model, m, { x, z, foot });
    };
    const bed = [['river-stones-a', 0.36], ['river-stones-b', 0.3], ['mud-plates', 0.16], ['driftwood', 0.1], ['river-boulder', 0.08]];
    const pick = () => {
      let r = rng();
      for (const [m, w] of bed) { if ((r -= w) < 0) return m; }
      return bed[0][0];
    };
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      // Two things in the bed every few metres, reeds on the banks.
      for (let j = 0; j < 2; j++) {
        if (rng() < 0.45) continue;
        const u = rng(), off = (rng() * 2 - 1) * a.half * 0.7;
        const x = a.x + dx * u + nx * off, z = a.z + dz * u + nz * off;
        const model = pick();
        const scale = model === 'river-boulder' ? 0.8 + rng() * 0.5 : model.startsWith('river-stones') ? 1.3 + rng() * 0.6 : 1;
        put(model, x, z, scale, model === 'mud-plates' ? 1.2 : 0.4);
      }
      for (const side of [-1, 1]) {
        if (rng() < 0.55) continue;
        const off = side * (a.half + 0.6 + rng() * 1.6);
        put('dry-reeds', a.x + nx * off, a.z + nz * off, 1 + rng() * 0.5, 0.3);
      }
    }
    // Depth posts where the road drops into the ford, on the camera-far side
    // so they never stand between a car and the camera.
    const ic = (this.startIndex + Math.round(this.def.river.at * n)) % n;
    const reach = Math.round(((this.def.river.width ?? 9) / 2 + 9) / line.spacing);
    for (const i of [ic - reach, ic + reach]) {
      const p = line.point(i), t = line.tangent(i);
      const side = -Math.sign(t.z - t.x) || 1;
      const off = (this.wallHalf + 1.1) * side;
      const x = p.x + t.z * off, z = p.z - t.x * off;
      // The board (model +Z) faces the traffic coming down into the ford.
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(-t.x, -t.z)).scale(new THREE.Vector3(1.2, 1.2, 1.2));
      m.setPosition(x, 0, z);
      push(kit, 'flood-gauge', m, { x, z, foot: 0 });
    }
  }

  /**
   * Scatter kit props on cells outside the racing loop.
   *
   * The camera looks down the (-1, 0, -1) ground direction, so a prop at cell
   * (x, z) can only hide the track cells at (x-k, z-k). Each candidate cell
   * therefore gets a height budget from how far the nearest such track cell
   * is, and we only pick props that fit under it. Tall towers end up behind
   * the circuit and low dressing in front of it, which is also how you would
   * compose the shot by hand.
   */
  buildScenery(theme) {
    const rng = mulberry32(this.def.seed ?? 1337);
    const reserved = this.buildGrandstand();
    const pads = this.terrain ? reserved.map((r) => ({ ...r })) : [];
    const plots = [];
    const bounds = this.bounds();
    // Cells touching the road take low dressing only; the road itself takes none.
    const verge = new Set();
    for (const c of this.path) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) verge.add(`${c.x + dx},${c.z + dz}`);
    }
    // Every model goes in with an anchor: the spot of ground it stands on.
    // On a climbing circuit its height is filled in once the ground is final.
    const byKit = new Map();
    const anchors = [];
    const push = (kit, model, matrix, anchor) => {
      if (!byKit.has(kit)) byKit.set(kit, []);
      byKit.get(kit).push({ model, matrix, anchor });
      if (!anchor.listed) { anchor.listed = true; anchors.push(anchor); }
    };
    const ground = (x, z) => (this.terrain ? this.terrain.sample(x, z) : 0);
    const spread = theme.spread ?? 4;

    const props = theme.props || [];
    if (props.length) {
      for (let x = bounds.minX - spread; x <= bounds.maxX + spread; x++) {
        for (let z = bounds.minZ - spread; z <= bounds.maxZ + spread; z++) {
          const key = `${x},${z}`;
          if (this.cellSet.has(key)) continue;
          const onVerge = verge.has(key);
          if (rng() > (theme.density ?? 0.42) * (onVerge ? 0.5 : 1)) continue;

          // Height budget: how tall a prop here may be before it hides the
          // road behind it — more if that road sits higher up the hill.
          let budget = onVerge ? TILE * 0.95 : Infinity;
          for (let k = 1; k <= 4; k++) {
            if (this.cellSet.has(`${x - k},${z - k}`)) {
              const rise = ground((x - k) * TILE, (z - k) * TILE) - ground(x * TILE, z * TILE);
              budget = Math.min(budget, CAMERA_SLOPE * (k - 0.5) * TILE + rise);
              break;
            }
          }
          const here = ground(x * TILE, z * TILE);
          const fits = props.filter((sp) => sp.h * (sp.scale ?? 1) * TILE <= budget && !(here > (sp.below ?? Infinity)));
          if (!fits.length) continue;

          const spec = fits[Math.floor(rng() * fits.length)];
          const scale = (spec.scale ?? 1) * (0.92 + rng() * 0.2);
          const wx = (x + (rng() - 0.5) * 0.3) * TILE;
          const wz = (z + (rng() - 0.5) * 0.3) * TILE;
          // Never place anything a car on track could drive into.
          const foot = (spec.r ?? 0.5) * scale * TILE;
          const clearance = this.wallHalf + foot + 0.6;
          const dist = this.line.locate(wx, wz, null).dist;
          if (dist < clearance) continue;
          if (reserved.some((r) => Math.hypot(wx - r.x, wz - r.z) < r.r + foot)) continue;
          if (this.terrain?.riverPath.length && this.terrain.riverDist(wx, wz) < foot + 2) continue;   // nothing stands in the river

          const angle = Math.floor(rng() * 4) * Math.PI / 2;
          const m = new THREE.Matrix4()
            .makeRotationY(angle)
            .scale(new THREE.Vector3(TILE * scale, TILE * scale, TILE * scale));
          m.setPosition(wx, 0, wz);
          // Trees root at the trunk; buildings dig in under their whole floor.
          const anchor = { x: wx, z: wz, foot: spec.pad ? foot : foot * 0.35 };
          if (spec.parts) {
            // A model assembled from kit pieces: [model, x, y, z, quarter turns].
            for (const [model, px, py, pz, rot] of spec.parts) {
              const local = new THREE.Matrix4().makeRotationY((rot ?? 0) * Math.PI / 2).setPosition(px, py, pz);
              push(spec.kit, model, m.clone().multiply(local), anchor);
            }
          } else {
            push(spec.kit, spec.model, m, anchor);
          }
          if (spec.pad && this.terrain) pads.push({ x: wx, z: wz, r: foot + 0.6, h: ground(wx, wz) });

          // A building stands on its own paved plot, not on the lawn, and
          // now and then keeps its dumpster round the side.
          if (theme.plot != null && /building/.test(spec.model)) {
            const half = Math.min(foot + 0.9, dist - this.wallHalf - 0.4);
            if (half > 1) {
              const slab = new THREE.BoxGeometry(half * 2, 0.16, half * 2);
              slab.translate(wx, 0.02, wz);
              plots.push({ g: slab, anchor });
              if (rng() < 0.35) {
                const along = (rng() < 0.5 ? -1 : 1) * (half - 0.9);
                const dx = rng() < 0.5 ? along : 0, dz = dx ? 0 : along;
                if (this.line.locate(wx + dx, wz + dz, null).dist > this.wallHalf + 2) {
                  const d = new THREE.Matrix4().makeRotationY(angle).scale(new THREE.Vector3(TILE, TILE, TILE));
                  d.setPosition(wx + dx, 0, wz + dz);
                  push('roads', 'dumpster', d, anchor);
                }
              }
            }
          }
        }
      }
    }

    this.buildDressing(theme.dress, push, reserved);
    this.buildRiver(push, rng);

    if (this.terrain) {
      this.terrain.addPads(pads);
      this.terrain.clampToView();
      for (const a of anchors) a.y = this.terrain.footing(a.x, a.z, a.foot);
      this.group.add(this.terrain.mesh(theme));
    }

    if (plots.length) {
      const geoms = plots.map(({ g, anchor }) => g.translate(0, anchor.y ?? 0, 0));
      const mesh = new THREE.Mesh(mergeGeometries(geoms, false), new THREE.MeshLambertMaterial({ color: theme.plot }));
      geoms.forEach((g) => g.dispose());
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    for (const [kit, entries] of byKit) {
      for (const e of entries) if (e.anchor.y) e.matrix.elements[13] += e.anchor.y;
      const mesh = mergeInstances(entries, kit);
      if (mesh) this.group.add(mesh);
    }
  }

  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of this.path) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    return { minX, maxX, minZ, maxZ };
  }

  modelsUsed() {
    const list = new Set();
    for (const spec of (this.def.theme?.props || [])) {
      if (spec.parts) for (const [model] of spec.parts) list.add(`${spec.kit}/${model}`);
      else list.add(`${spec.kit}/${spec.model}`);
    }
    for (const spec of Object.values(this.def.theme?.dress || {})) list.add(`${spec.kit}/${spec.model}`);
    list.add('roads/dumpster');     // beside buildings
    if (this.def.bridgeModel) list.add(`${this.def.bridgeModel.kit}/${this.def.bridgeModel.model}`);
    if (this.def.river) {
      for (const m of ['river-stones-a', 'river-stones-b', 'river-boulder', 'driftwood', 'dry-reeds', 'mud-plates', 'flood-gauge']) list.add(`canyon/${m}`);
    }
    return [...list].map((s) => s.split('/'));
  }
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
