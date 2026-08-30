// Track construction: a grid path of cardinal moves becomes road tiles,
// a smoothed centre line, scenery and start-grid slots.
import * as THREE from 'three';
import { instance, materialsFor } from './assets.js';
import { mergeGeometries } from 'three/utils/BufferGeometryUtils.js';

// Road tiles are scaled to this pitch while cars keep their absolute size,
// so the tile size directly sets how wide the road feels: at 11, the tarmac
// band (0.8 of a tile) is 8.8 units against a 1.44-unit car — six abreast.
export const TILE = 11;

// tan(camera elevation): how tall a prop may be per tile of clearance from the
// track before it starts hiding cars. Matches ISO_DIR in engine.js.
const CAMERA_SLOPE = 1.35;

// Base orientation of the Kenney road pieces at rotation 0, measured from the
// models themselves: a straight runs along X, and road-bend joins the -X and
// +Z edges. The *-barrier pieces are rail-only overlays, not whole tiles.
const STRAIGHT_BASE = Math.PI / 2;
const CURVE_BASE = [Math.PI * 1.5, 0];

export const DIRS = {
  R: { x: 1, z: 0 }, L: { x: -1, z: 0 },
  D: { x: 0, z: 1 }, U: { x: 0, z: -1 },
};

const dirAngle = (d) => Math.atan2(d.x, d.z);
const norm = (a) => { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; };
const angleEq = (a, b) => Math.abs(norm(a) - norm(b)) < 1e-3 || Math.abs(norm(a) - norm(b) - Math.PI * 2) < 1e-3;

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

function tileMatrix(cell, angle, y = 0) {
  const m = new THREE.Matrix4();
  m.makeRotationY(angle);
  m.scale(new THREE.Vector3(TILE, TILE, TILE));
  m.setPosition(cell.x * TILE, y, cell.z * TILE);
  return m;
}

/** Choose road mesh + rotation for each cell of the loop. */
function roadPieces(path) {
  const pieces = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const prev = path[(i - 1 + n) % n], cell = path[i], next = path[(i + 1) % n];
    const dIn = { x: cell.x - prev.x, z: cell.z - prev.z };
    const dOut = { x: next.x - cell.x, z: next.z - cell.z };
    if (dIn.x === dOut.x && dIn.z === dOut.z) {
      pieces.push({ cell, model: 'road-straight', overlay: 'road-straight-barrier', angle: dirAngle(dOut) - STRAIGHT_BASE, kind: 'straight' });
    } else {
      const entry = dirAngle({ x: -dIn.x, z: -dIn.z });
      const exit = dirAngle(dOut);
      let angle = 0;
      for (let k = 0; k < 4; k++) {
        const rot = k * Math.PI / 2;
        const a = CURVE_BASE[0] + rot, b = CURVE_BASE[1] + rot;
        if ((angleEq(a, entry) && angleEq(b, exit)) || (angleEq(a, exit) && angleEq(b, entry))) {
          angle = rot; break;
        }
      }
      pieces.push({ cell, model: 'road-bend', overlay: 'road-bend-barrier', angle, kind: 'curve' });
    }
  }
  return pieces;
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

    const radius = (def.cornerRadius ?? 1.15) * TILE;
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

    const pieces = roadPieces(this.path);
    const roadEntries = pieces.map((p) => ({ model: p.model, matrix: tileMatrix(p.cell, p.angle) }));
    if (this.walls) {
      for (const p of pieces) roadEntries.push({ model: p.overlay, matrix: tileMatrix(p.cell, p.angle) });
    }

    // Start/finish stripe: swap the piece under the line for a crossing.
    const startCell = this.cellAtLineIndex(this.startIndex);
    if (startCell) {
      const idx = pieces.findIndex((p) => p.cell.x === startCell.x && p.cell.z === startCell.z);
      if (idx >= 0 && pieces[idx].kind === 'straight') {
        roadEntries[idx] = { model: 'road-crossing', matrix: tileMatrix(pieces[idx].cell, pieces[idx].angle) };
      }
    }

    const road = mergeInstances(roadEntries, 'roads');
    if (road) this.group.add(road);
    this.pieces = pieces;

    this.buildStartLine();
    this.buildStartGate();

    this.buildScenery(theme);
    scene.add(this.group);
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

    gantry.position.set(p.x, 0, p.z);
    gantry.rotation.y = heading;
    this.group.add(gantry);
  }

  cellAtLineIndex(i) {
    const p = this.line.point(i);
    return { x: Math.round(p.x / TILE), z: Math.round(p.z / TILE) };
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
          if (this.line.locate(wx, wz, null).dist < clearance) continue;

          const angle = Math.floor(rng() * 4) * Math.PI / 2;
          const m = new THREE.Matrix4()
            .makeRotationY(angle)
            .scale(new THREE.Vector3(TILE * scale, TILE * scale, TILE * scale));
          m.setPosition(wx, 0, wz);
          push(spec.kit, spec.model, m);
        }
      }
    }

    // Trackside dressing on the shoulder of every few tiles.
    const dress = theme.trackside || [];
    if (dress.length) {
      const step = Math.max(4, Math.round(7 / this.line.spacing));
      for (let i = 0; i < this.line.n; i += step) {
        if (this.line.curveAt(i) > 0.02) continue;
        const spec = dress[Math.floor(rng() * dress.length)];
        const side = rng() < 0.5 ? -1 : 1;
        const p = this.line.point(i), t = this.line.tangent(i);
        const sc = TILE * (spec.scale ?? 1);
        const off = this.wallHalf + (spec.r ?? 0.2) * sc + (spec.offset ?? 0.4);
        const heading = Math.atan2(t.x, t.z);
        // Lamp arms (local -Z, spec.across) turn to reach over the road;
        // signs and barriers keep facing along it.
        const yaw = spec.across ? heading + side * Math.PI / 2 : heading + (side < 0 ? Math.PI : 0);
        const m = new THREE.Matrix4()
          .makeRotationY(yaw)
          .scale(new THREE.Vector3(sc, sc, sc));
        m.setPosition(p.x + t.z * off * side, 0, p.z - t.x * off * side);
        push(spec.kit, spec.model, m);
      }
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
    list.add('roads/road-straight');
    list.add('roads/road-bend');
    list.add('roads/road-crossing');
    if (this.walls) {
      list.add('roads/road-straight-barrier');
      list.add('roads/road-bend-barrier');
    }
    for (const spec of (this.def.theme?.props || [])) list.add(`${spec.kit}/${spec.model}`);
    for (const spec of (this.def.theme?.trackside || [])) list.add(`${spec.kit}/${spec.model}`);
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
