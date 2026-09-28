// Track construction: a grid path of cardinal moves becomes a smoothed
// centre line, a road ribbon that follows it, scenery and start-grid slots.
import * as THREE from 'three';
import { instance, materialsFor } from './assets.js';
import { mergeGeometries } from 'three/utils/BufferGeometryUtils.js';

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
  }

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



/** Merge many instances of kit models into as few draw calls as possible. */
function mergeInstances(entries, kit, shiny = false) {
  const geoms = [];
  for (const { model, matrix } of entries) {
    const obj = instance(kit, model);
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g.applyMatrix4(matrix);
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      }
      geoms.push(g);
    });
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
    // Ground plane under everything.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshLambertMaterial({ color: theme.ground ?? 0x7aa25a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.group.add(ground);

    this.buildRoad(theme);

    this.buildStartLine();
    this.buildStartGate();

    this.buildScenery(theme);
    scene.add(this.group);
  }

  /** A ribbon strip that follows the racing line between two lateral offsets. */
  lineStrip(innerOff, outerOff, y, colour, y2 = null, material = null) {
    const line = this.line, n = line.n;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const nrm = new Float32Array((n + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const p = line.point(i), t = line.tangent(i);
      const lx = t.z, lz = -t.x;
      const o = i * 6;
      pos[o] = p.x + lx * outerOff; pos[o + 1] = y; pos[o + 2] = p.z + lz * outerOff;
      pos[o + 3] = p.x + lx * innerOff; pos[o + 4] = y2 ?? y; pos[o + 5] = p.z + lz * innerOff;
      nrm[o + 1] = 1; nrm[o + 4] = 1;
      if (i < n) {
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

  /**
   * The road is a ribbon that follows the racing line, so the tarmac shows
   * exactly what the handling model drives: sweeping corner arcs instead of
   * square tile bends. Everything else still comes from the Kenney kits.
   */
  buildRoad(theme) {
    const w = this.roadHalf;
    this.group.add(this.lineStrip(-w - 0.8, w + 0.8, 0.09, theme.kerbColour ?? 0x99a1b0));
    this.group.add(this.lineStrip(-w, w, 0.11, theme.roadColour ?? 0x4a505c));

    // Dashed centre line.
    const line = this.line, n = line.n;
    const geoms = [];
    const step = Math.max(4, Math.round(6 / line.spacing));
    for (let i = 0; i < n; i += step) {
      const p = line.point(i), t = line.tangent(i);
      const g = new THREE.PlaneGeometry(0.26, 2.3);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(t.x, t.z));
      g.translate(p.x, 0.125, p.z);
      geoms.push(g);
    }
    if (geoms.length) {
      const dashes = new THREE.Mesh(
        mergeGeometries(geoms, false),
        new THREE.MeshLambertMaterial({ color: 0xe9edf5 }),
      );
      geoms.forEach((g) => g.dispose());
      this.group.add(dashes);
    }

    this.buildKerbs();
    this.buildGridBoxes();

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
          const q = (p, t, off) => [p.x + t.z * off * side, 0.118, p.z - t.x * off * side];
          const a = q(p0, t0, w - 0.15), b = q(p0, t0, w + 0.85);
          const d = q(p1, t1, w - 0.15), e = q(p1, t1, w + 0.85);
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
    const add = (x, z, heading, across, along, w, d) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(across, 0, -along);   // local +X is the car's left, +Z its forward
      g.rotateY(heading);
      g.translate(x, 0.122, z);
      geoms.push(g);
    };
    for (const slot of this.startSlots(6)) {
      const h = slot.heading;
      add(slot.x, slot.z, h, 0, -1.7, 2.5, 0.24);          // bar across, just ahead of the nose
      for (const s of [-1, 1]) add(slot.x, slot.z, h, s * 1.25, -1.05, 0.2, 1.5);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geoms, false), new THREE.MeshLambertMaterial({ color: 0xeef1f6 }));
    geoms.forEach((g) => g.dispose());
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildArmco() {
    const line = this.line, n = line.n;
    const off = this.wallHalf + 0.4;
    const railMat = new THREE.MeshLambertMaterial({ color: 0xc6cdd9, side: THREE.DoubleSide });
    const postGeoms = [];
    for (const side of [-1, 1]) {
      const rail = this.lineStrip(off * side, off * side, 0.95, 0xc6cdd9, 0.45, railMat);
      rail.castShadow = true;
      this.group.add(rail);

      const step = Math.max(3, Math.round(5 / line.spacing));
      for (let i = 0; i < n; i += step) {
        const p = line.point(i), t = line.tangent(i);
        const g = new THREE.BoxGeometry(0.24, 1.0, 0.24);
        g.translate(p.x + t.z * off * side, 0.5, p.z - t.x * off * side);
        postGeoms.push(g);
      }
    }
    if (postGeoms.length) {
      const posts = new THREE.Mesh(
        mergeGeometries(postGeoms, false),
        new THREE.MeshLambertMaterial({ color: 0x6a7280 }),
      );
      postGeoms.forEach((g) => g.dispose());
      posts.castShadow = true;
      this.group.add(posts);
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
    mesh.position.set(p.x, 0.175, p.z);
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

    gantry.position.set(p.x, 0, p.z);
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
    group.position.set(p.x, 0, p.z);
    group.rotation.y = heading;
    this.group.add(group);

    // The ground it stands on, as circles along its length.
    const mid = inner + (tiers * step) / 2;
    const cover = [];
    for (let z = -length / 2; z <= length / 2; z += 4) {
      const lx = side * mid;                              // local +X is the left axis
      cover.push({ x: p.x + t.z * lx + t.x * z, z: p.z - t.x * lx + t.z * z, r: tiers * step / 2 + 3 });
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
    const place = (spec, i, side, off, yaw) => {
      const p = line.point(i), t = line.tangent(i);
      const sc = TILE * (spec.scale ?? 1);
      const px = p.x + t.z * off * side, pz = p.z - t.x * off * side;
      if (line.locate(px, pz, null).dist < this.wallHalf + 0.5) return;
      if (reserved.some((r) => Math.hypot(px - r.x, pz - r.z) < r.r)) return;
      const m = new THREE.Matrix4().makeRotationY(yaw(t, side)).scale(new THREE.Vector3(sc, sc, sc));
      m.setPosition(px, 0, pz);
      push(spec.kit, spec.model, m);
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
        const every = Math.max(1, Math.round(2.8 / sp));
        for (let k = 0; k <= run.len; k += every) place(dress.cornerBarrier, run.start + k, run.outside, this.wallHalf + 1.0, alongZ);
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
    const plots = [];
    const bounds = this.bounds();
    // Cells touching the road take low dressing only; the road itself takes none.
    const verge = new Set();
    for (const c of this.path) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) verge.add(`${c.x + dx},${c.z + dz}`);
    }
    const byKit = new Map();
    const push = (kit, model, matrix) => {
      if (!byKit.has(kit)) byKit.set(kit, []);
      byKit.get(kit).push({ model, matrix });
    };

    const props = theme.props || [];
    if (props.length) {
      for (let x = bounds.minX - 4; x <= bounds.maxX + 4; x++) {
        for (let z = bounds.minZ - 4; z <= bounds.maxZ + 4; z++) {
          const key = `${x},${z}`;
          if (this.cellSet.has(key)) continue;
          const onVerge = verge.has(key);
          if (rng() > (theme.density ?? 0.42) * (onVerge ? 0.5 : 1)) continue;

          let budget = onVerge ? TILE * 0.95 : Infinity;
          for (let k = 1; k <= 4; k++) {
            if (this.cellSet.has(`${x - k},${z - k}`)) {
              budget = Math.min(budget, CAMERA_SLOPE * (k - 0.5) * TILE);
              break;
            }
          }
          const fits = props.filter((s) => s.h * (s.scale ?? 1) * TILE <= budget);
          if (!fits.length) continue;

          const spec = fits[Math.floor(rng() * fits.length)];
          const scale = (spec.scale ?? 1) * (0.92 + rng() * 0.2);
          const wx = (x + (rng() - 0.5) * 0.3) * TILE;
          const wz = (z + (rng() - 0.5) * 0.3) * TILE;
          // Never place anything a car on track could drive into.
          const clearance = this.wallHalf + (spec.r ?? 0.5) * scale * TILE + 0.6;
          const dist = this.line.locate(wx, wz, null).dist;
          if (dist < clearance) continue;
          if (reserved.some((r) => Math.hypot(wx - r.x, wz - r.z) < r.r + (spec.r ?? 0.5) * scale * TILE)) continue;

          const angle = Math.floor(rng() * 4) * Math.PI / 2;
          const m = new THREE.Matrix4()
            .makeRotationY(angle)
            .scale(new THREE.Vector3(TILE * scale, TILE * scale, TILE * scale));
          m.setPosition(wx, 0, wz);
          push(spec.kit, spec.model, m);

          // A building stands on its own paved plot, not on the lawn, and
          // now and then keeps its dumpster round the side.
          if (theme.plot != null && /building/.test(spec.model)) {
            const half = Math.min((spec.r ?? 0.5) * scale * TILE + 0.9, dist - this.wallHalf - 0.4);
            if (half > 1) {
              const slab = new THREE.BoxGeometry(half * 2, 0.16, half * 2);
              slab.translate(wx, 0.02, wz);
              plots.push(slab);
              if (rng() < 0.35) {
                const along = (rng() < 0.5 ? -1 : 1) * (half - 0.9);
                const dx = rng() < 0.5 ? along : 0, dz = dx ? 0 : along;
                if (this.line.locate(wx + dx, wz + dz, null).dist > this.wallHalf + 2) {
                  const d = new THREE.Matrix4().makeRotationY(angle).scale(new THREE.Vector3(TILE, TILE, TILE));
                  d.setPosition(wx + dx, 0, wz + dz);
                  push('roads', 'dumpster', d);
                }
              }
            }
          }
        }
      }
    }

    this.buildDressing(theme.dress, push, reserved);

    if (plots.length) {
      const mesh = new THREE.Mesh(mergeGeometries(plots, false), new THREE.MeshLambertMaterial({ color: theme.plot }));
      plots.forEach((g) => g.dispose());
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    for (const [kit, entries] of byKit) {
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
    for (const spec of (this.def.theme?.props || [])) list.add(`${spec.kit}/${spec.model}`);
    for (const spec of Object.values(this.def.theme?.dress || {})) list.add(`${spec.kit}/${spec.model}`);
    list.add('roads/dumpster');     // beside buildings
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
