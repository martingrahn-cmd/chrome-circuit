"""Stone arch bridge for Mesa Eight, built in Blender and exported as GLB.

Run headless:  python stone_bridge.py out.glb [preview.png]
(with the `bpy` module from PyPI, or `blender -b -P stone_bridge.py -- out.glb`).

Model frame, in game units (three.js axes, which the glTF exporter maps to):
  x  along the bridge, 0 where it crosses the road below
  y  up, 0 at the deck's road surface
  z  across, + on the right of travel
The game bends the model along the road's line, so x is distance along the
lap and y follows the deck as it climbs (track.js, buildBridges).
"""
import math
import random
import sys

import bpy
import bmesh  # after bpy: the module registers it

random.seed(7301)

HALF = 24.0          # half length: bridge start to the crossing
FACE = 6.3           # spandrel face, off the centreline
CORE = 6.15          # mortar bed behind the face stones
A, B = 7.6, 4.6      # arch intrados: half span and rise
YS = -6.9            # springing line, just above the road below
RING = 1.0           # depth of the voussoir ring
BAND = -1.3          # top of the arch ring: a frieze band runs above it
CORNICE = (-0.9, -0.6)
COURSE = 0.8
BOTTOM = -14.0
GAP = 0.05           # mortar joint showing between stones

# Deck height and the lowest ground across the bridge's width (both faces
# and under the middle), measured on the built track, so stones that would
# sit buried are not made at all.
PROFILE = [  # x, deck, ground
    (-24, 7.08, 4.87), (-22.8, 7.15, 4.14), (-21.6, 7.22, 3.48), (-20.4, 7.29, 2.93),
    (-19.2, 7.36, 2.63), (-18, 7.43, 2.9), (-16.8, 7.5, 3.13), (-15.6, 7.57, 3.17),
    (-14.4, 7.64, 3.19), (-13.2, 7.71, 3.02), (-12, 7.77, 2.85), (-10.8, 7.83, 2.48),
    (-9.6, 7.89, 2.12), (-8.4, 7.95, 1.15), (-7.2, 8, 0.16), (-6, 8.04, 0.02), (-4.8, 8.07, 0),
    (-3.6, 8.1, 0), (-2.4, 8.11, 0), (-1.2, 8.12, 0), (0, 8.12, 0), (1.2, 8.1, 0),
    (2.4, 8.08, 0), (3.6, 8.05, 0), (4.8, 8.01, 0), (6, 7.96, -0.19), (7.2, 7.9, -0.6),
    (8.4, 7.84, -1.38), (9.6, 7.77, -2.76), (10.8, 7.69, -3.66), (12, 7.61, -3.42),
    (13.2, 7.53, -3.09), (14.4, 7.45, -2.4), (15.6, 7.36, -1.65), (16.8, 7.28, -0.53),
    (18, 7.19, 0.6), (19.2, 7.11, 2.12), (20.4, 7.02, 3.64), (21.6, 6.93, 4.54),
    (22.8, 6.85, 5.41), (24, 6.76, 5.7),
]

def ground_rel(x):
    """Lowest ground under the deck near x, relative to the deck."""
    lo = min(g - d for px, d, g in PROFILE if abs(px - x) <= 2.5)
    return lo


def hexrgb(h, jitter=0.0, warm=0.0):
    r, g, b = ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255
    k = 1 + random.uniform(-jitter, jitter)
    w = random.uniform(-warm, warm)
    return (min(1, r * k * (1 + w)), min(1, g * k), min(1, b * k * (1 - w)), 1.0)


SAND = 0xcdb393      # face stones: pale buff, to stand off the red rock
SAND_DARK = 0xb89c7c
VOUSSOIR = 0xe0cba9
KEY = 0xeedcbc
MORTAR = 0x7d6650
TRIM = 0xe3d0b0      # cornice, coping, frieze
SOFFIT = 0x9c8468    # under the arch, in shade anyway
QUOIN = 0xd8c3a2

# ---------------------------------------------------------------- geometry
# Every face is a polygon in game coordinates with one flat colour; the
# whole bridge is one mesh, one draw call.
verts, faces, cols = [], [], []


def to_blender(p):
    x, y, z = p
    return (x, -z, y)


def poly(pts, colour):
    base = len(verts)
    verts.extend(to_blender(p) for p in pts)
    faces.append(tuple(range(base, base + len(pts))))
    cols.append(colour)


def prism(outline, z0, z1, colour, chamfer=0.06):
    """A stone: a convex outline in the x-y plane, from z0 (back) out to z1
    (its face), the face edge chamfered so neighbours read as separate."""
    n = len(outline)
    cx = sum(p[0] for p in outline) / n
    cy = sum(p[1] for p in outline) / n
    inner = []
    for x, y in outline:
        dx, dy = cx - x, cy - y
        d = math.hypot(dx, dy) or 1
        c = min(chamfer, d * 0.4)
        inner.append((x + dx / d * c * 1.4, y + dy / d * c * 1.4))
    s = 1 if z1 > z0 else -1
    zc = z1 - s * chamfer
    front = [(x, y, z1) for x, y in inner]
    poly(front if s > 0 else front[::-1], colour)
    for k in range(n):
        a, b = outline[k], outline[(k + 1) % n]
        ia, ib = inner[k], inner[(k + 1) % n]
        bevel = [(a[0], a[1], zc), (b[0], b[1], zc), (ib[0], ib[1], z1), (ia[0], ia[1], z1)]
        side = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], zc), (a[0], a[1], zc)]
        poly(bevel if s > 0 else bevel[::-1], colour)
        poly(side if s > 0 else side[::-1], colour)


def box(x0, x1, y0, y1, z0, z1, colour, chamfer=0.05):
    prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, colour, chamfer)
    # The back face too, for stones seen from behind (the parapet's inside).


def clip(pts, p, q):
    """Part of a convex polygon on the far side (+x) of the line p-q."""
    def keep(v):
        return (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]) <= 0
    out = []
    for k, v in enumerate(pts):
        w = pts[(k + 1) % len(pts)]
        kv, kw = keep(v), keep(w)
        if kv:
            out.append(v)
        if kv != kw:
            # Intersection of v-w with the line.
            dx, dy = w[0] - v[0], w[1] - v[1]
            ex, ey = q[0] - p[0], q[1] - p[1]
            den = dx * ey - dy * ex
            t = ((p[0] - v[0]) * ey - (p[1] - v[1]) * ex) / den if den else 0
            out.append((v[0] + dx * t, v[1] + dy * t))
    return out


def area(pts):
    return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1])) if len(pts) >= 3 else 0


def ellipse(a, b, t):
    return (a * math.cos(t), YS + b * math.sin(t))


def opening(y, ring=True):
    """Half width of what the face stones must keep clear of at height y."""
    if y <= YS + 1e-6:
        return A
    a, b = (A + RING, B + RING) if ring else (A, B)
    k = (y - YS) / b
    return a * math.sqrt(max(0.0, 1 - k * k)) if k < 1 else 0.0


def face_side(sz):
    """Everything on one face of the bridge; sz is +1 or -1."""
    zf, zb = sz * FACE, sz * CORE
    # Courses of stone, laid from the frieze down, staggered.
    courses = []
    y = BAND
    while y > BOTTOM:
        courses.append((y - COURSE, y))
        y -= COURSE
    for row, (y0, y1) in enumerate(courses):
        # Joints along the course, running bond.
        xs = [-HALF]
        x = -HALF + (0.9 if row % 2 else 0)
        while True:
            x += random.uniform(1.5, 2.5)
            if x >= HALF - 0.6:
                break
            xs.append(x)
        xs.append(HALF)
        o0, o1 = opening(y0), opening(y1)
        for xa, xb in zip(xs, xs[1:]):
            mid = (xa + xb) / 2
            if y1 < ground_rel(mid) - 1.6:
                continue                       # buried in the embankment
            # A stone across the middle is two stones, one each side of the arch.
            for side in (-1, 1):
                lo, hi = (max(xa, 0.0), xb) if side > 0 else (max(-xb, 0.0), -xa)
                if hi - lo < 0.05:
                    continue
                rect = [(lo + GAP, y0 + GAP), (hi - GAP, y0 + GAP), (hi - GAP, y1 - GAP), (lo + GAP, y1 - GAP)]
                # Keep what lies outside the arch: right of the chord (o0,y0)-(o1,y1).
                pts = clip(rect, (o0 + GAP, y0), (o1 + GAP, y1))
                if area(pts) < 0.12:
                    continue
                if side < 0:
                    pts = [(-px, py) for px, py in pts][::-1]
                tone = SAND_DARK if random.random() < 0.22 else SAND
                prism(pts, zb, zf + sz * random.uniform(0.0, 0.07), hexrgb(tone, 0.07, 0.04))

    # Voussoirs round the arch, a keystone at the crown.
    n = 17
    for k in range(n):
        t0, t1 = math.pi * k / n, math.pi * (k + 1) / n
        key = k == n // 2
        out = RING + (0.3 if key else 0)
        pts = [ellipse(A, B, t0), ellipse(A + out, B + out, t0), ellipse(A + out, B + out, t1), ellipse(A, B, t1)]
        # Slim the joint between neighbours.
        cx, cy = sum(p[0] for p in pts) / 4, sum(p[1] for p in pts) / 4
        pts = [(px + (cx - px) * 0.04, py + (cy - py) * 0.04) for px, py in pts]
        prism(pts, zb, zf + sz * (0.2 if key else 0.12), hexrgb(KEY if key else VOUSSOIR, 0.05, 0.03))

    # Pilasters either side of the arch, quoins alternating long and short.
    for side in (-1, 1):
        cx = side * (A + RING + 1.5)
        y = CORNICE[0]
        k = 0
        while y > BOTTOM:
            h = 0.8
            if y < ground_rel(cx) - 1.6:
                break
            w = 1.0 if k % 2 else 0.8
            box(cx - w, cx + w, y - h + GAP, y - GAP, zb, zf + sz * 0.45, hexrgb(QUOIN, 0.05, 0.03))
            y -= h
            k += 1

    # Frieze band, cornice, and the mortar bed behind the stones.
    x = -HALF
    while x < HALF - 0.01:
        w = min(random.uniform(2.2, 3.2), HALF - x)
        box(x + GAP, x + w - GAP, BAND + GAP, CORNICE[0], zb, zf + sz * 0.05, hexrgb(TRIM, 0.04))
        box(x, x + w - GAP, CORNICE[0], CORNICE[1], zb, zf + sz * 0.3, hexrgb(TRIM, 0.03))
        x += w
    # Mortar bed: a flat face just behind the stones, with the arch cut out.
    ys = [BAND] + [c[0] for c in courses]
    for y0, y1 in zip(ys[1:], ys):
        for side in (-1, 1):
            a0, a1 = opening(y0, ring=False), opening(y1, ring=False)
            pts = [(a0, y0), (HALF, y0), (HALF, y1), (a1, y1)]
            if side < 0:
                pts = [(-px, py) for px, py in pts][::-1]
            pts3 = [(px, py, zb) for px, py in pts]
            poly(pts3 if sz > 0 else pts3[::-1], hexrgb(MORTAR))
    poly([(p[0], p[1], zb) for p in [(-HALF, BAND), (HALF, BAND), (HALF, 0), (-HALF, 0)]][:: 1 if sz > 0 else -1], hexrgb(MORTAR))

    # Parapet: a course of stones, coping on top, a newel at each end.
    zi, zo = sz * 5.92, sz * 6.42
    x = -HALF
    while x < HALF - 0.01:
        w = min(random.uniform(1.6, 2.3), HALF - x)
        tone = hexrgb(SAND, 0.06, 0.03)
        box(x + GAP, x + w - GAP, CORNICE[1], 0.95, zi, zo, tone)
        box(x + GAP, x + w - GAP, CORNICE[1], 0.95, zo, zi, tone)
        x += w
    x = -HALF
    while x < HALF - 0.01:
        w = min(2.4, HALF - x)
        c = hexrgb(TRIM, 0.03)
        box(x + 0.02, x + w - 0.02, 0.95, 1.15, sz * 5.82, sz * 6.52, c, 0.04)
        box(x + 0.02, x + w - 0.02, 0.95, 1.15, sz * 6.52, sz * 5.82, c, 0.04)
        x += w
    for ex in (-HALF, HALF):
        c = hexrgb(QUOIN, 0.03)
        box(ex - 0.45, ex + 0.45, -1.5, 1.55, sz * 5.8, sz * 6.6, c)
        box(ex - 0.45, ex + 0.45, -1.5, 1.55, sz * 6.6, sz * 5.8, c)
        box(ex - 0.55, ex + 0.55, 1.55, 1.75, sz * 5.7, sz * 6.7, hexrgb(TRIM), 0.04)


def soffit():
    """Under the arch: rings of stone across the width, and the pier faces."""
    n = 17
    zs = [-CORE + k * (2 * CORE) / 10 for k in range(11)]
    for k in range(n):
        t0, t1 = math.pi * k / n, math.pi * (k + 1) / n
        (x0, y0), (x1, y1) = ellipse(A, B, t0), ellipse(A, B, t1)
        for j, (za, zb) in enumerate(zip(zs, zs[1:])):
            poly([(x0, y0, za), (x0, y0, zb), (x1, y1, zb), (x1, y1, za)], hexrgb(SOFFIT, 0.08))
    for side in (-1, 1):
        x = side * A
        y = YS
        while y > BOTTOM:
            for za, zb in zip(zs, zs[1:]):
                q = [(x, y - COURSE, za), (x, y - COURSE, zb), (x, y, zb), (x, y, za)]
                poly(q if side > 0 else q[::-1], hexrgb(SOFFIT, 0.08))
            y -= COURSE


def deck_top():
    """Close the top under the road strips, and the walkway out to the parapet."""
    c = hexrgb(TRIM)
    poly([(-HALF, 0.04, -CORE), (-HALF, 0.04, CORE), (HALF, 0.04, CORE), (HALF, 0.04, -CORE)], c)


for sz in (1, -1):
    face_side(sz)
soffit()
deck_top()

# ---------------------------------------------------------------- blender
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new('mesa-bridge')
mesh.from_pydata(verts, [], faces)
mesh.validate()
attr = mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for poly_, colour in zip(mesh.polygons, cols):
    for li in poly_.loop_indices:
        attr.data[li].color_srgb = colour
mesh.color_attributes.active_color = attr
obj = bpy.data.objects.new('mesa-bridge', mesh)
bpy.context.scene.collection.objects.link(obj)

# Weld coincident corners within each stone, keep stones separate.
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.to_mesh(mesh)
bm.free()
for p in mesh.polygons:
    p.use_smooth = False

mat = bpy.data.materials.new('stone')
mat.use_nodes = True
nodes = mat.node_tree.nodes
bsdf = nodes.get('Principled BSDF')
vc = nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.95
obj.data.materials.append(mat)

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else sys.argv[1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_vertex_color='ACTIVE',
                          export_normals=True, export_texcoords=False, export_materials='EXPORT')
print('faces', len(mesh.polygons), 'verts', len(mesh.vertices))

preview = sys.argv[sys.argv.index('--') + 2] if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 2 else (sys.argv[2] if '--' not in sys.argv and len(sys.argv) > 2 else None)
if preview:
    scene = bpy.context.scene
    world = bpy.data.worlds.new('w')
    world.color = (0.94, 0.75, 0.54)
    scene.world = world
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 58
    scene.collection.objects.link(cam)
    # The game's view: from +x, +z (three), i.e. +x, -y (blender), looking down.
    d = (1, -1, 1.35 * math.sqrt(2))
    L = math.sqrt(sum(v * v for v in d))
    cam.location = tuple(v / L * 120 for v in d)
    cam.location = (cam.location[0], cam.location[1], cam.location[2] - 6)
    direction = [-v for v in d]
    from mathutils import Vector
    cam.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = Vector((-58, 44, -96)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800
    scene.render.filepath = preview
    bpy.ops.render.render(write_still=True)
