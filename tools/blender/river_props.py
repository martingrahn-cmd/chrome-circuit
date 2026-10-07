"""Dry-river props for Canyon Run, built in Blender and exported as GLBs.

Run headless:  python river_props.py OUT_DIR [preview.png]
(with the `bpy` module from PyPI, or `blender -b -P river_props.py -- OUT_DIR`).

Each model stands on its origin with +y up (glTF axes), sized in game
units, and carries its colours as vertex colours: one material, no
textures, so the game merges every copy into a single mesh.

  river-stones-a/b   a scatter of rounded river cobbles
  river-boulder      one big water-worn boulder, half sunk
  driftwood          a bleached, forked log left by the last flood
  dry-reeds          a clump of dead reeds for the banks
  mud-plates         sun-cracked mud, curling at the edges
  flood-gauge        the depth post that stands at every desert ford
"""
import math
import os
import random
import sys

import bpy
import bmesh  # after bpy: the module registers it
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)


def rgb(h, jitter=0.0):
    """A hex colour as linear RGBA: float colour layers hold linear values."""
    k = 1 + random.uniform(-jitter, jitter)
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(min(1.0, ((h >> s) & 255) / 255 * k)) for s in (16, 8, 0)) + (1.0,)


# Blender is z-up; the exporter turns that into glTF's y-up, so models are
# built standing on the x-y plane here.

def new_bm():
    return bmesh.new()


def paint(bm, layer, faces, colour):
    for f in faces:
        for loop in f.loops:
            loop[layer] = colour


def pebble(bm, layer, centre, size, colour, squash=0.55, seed=0, subdiv=1):
    """A water-worn stone: an icosphere, flattened and nudged by noise."""
    before = set(bm.faces)
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    rot = Matrix.Rotation(random.uniform(0, math.tau), 4, 'Z')
    for v in res['verts']:
        n = noise.noise(v.co * 1.7 + Vector((seed, seed * 0.37, 0)))
        co = v.co * (1 + 0.16 * n)
        co.x *= size[0]
        co.y *= size[1]
        co.z *= size[2] * squash
        v.co = rot @ co + Vector(centre)
    paint(bm, layer, set(bm.faces) - before, colour)


def cylinder(bm, layer, a, b, r0, r1, colour, segs=6):
    """A tapered cylinder from a to b, its ends capped."""
    before = set(bm.faces)
    a, b = Vector(a), Vector(b)
    d = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                                radius1=r0, radius2=r1, depth=d.length)
    q = d.normalized().to_track_quat('Z', 'Y')
    m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=res['verts'])
    paint(bm, layer, set(bm.faces) - before, colour)


def box(bm, layer, centre, size, colour, rot=0.0):
    before = set(bm.faces)
    res = bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Translation(centre) @ Matrix.Rotation(rot, 4, 'Z') @ Matrix.Diagonal((*size, 1))
    bmesh.ops.transform(bm, matrix=m, verts=res['verts'])
    paint(bm, layer, set(bm.faces) - before, colour)


def finish(bm, name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = False
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.get('river') or bpy.data.materials.new('river')
    mesh.materials.append(mat)
    return obj


def make(name, build):
    bm = new_bm()
    layer = bm.loops.layers.float_color.new('Col')
    build(bm, layer)
    obj = finish(bm, name)
    obj.data.color_attributes.active_color = obj.data.color_attributes['Col']
    return obj


STONES = [0xb9ad9c, 0xa89a88, 0xc8bba6, 0x968a7c, 0xd2c4ac, 0x8f8478, 0xb7a58c]
SANDSTONE = [0xc0815a, 0xb06f4a]


def stones(seed, count, spread):
    def build(bm, layer):
        random.seed(seed)
        placed = []
        for k in range(count):
            for _ in range(30):
                r = random.uniform(0.18, 0.55) * (1.4 if k == 0 else 1)
                a = random.uniform(0, math.tau)
                d = random.uniform(0, spread) if k else 0
                c = (math.cos(a) * d, math.sin(a) * d)
                if all(math.hypot(c[0] - p[0], c[1] - p[1]) > (r + p[2]) * 0.8 for p in placed):
                    break
            placed.append((c[0], c[1], r))
            colour = rgb(random.choice(SANDSTONE) if random.random() < 0.2 else random.choice(STONES), 0.06)
            sx, sy = r * random.uniform(0.9, 1.35), r * random.uniform(0.75, 1.0)
            pebble(bm, layer, (c[0], c[1], r * 0.18), (sx, sy, r), colour, 0.5, seed * 10 + k)
    return build


def boulder(bm, layer):
    random.seed(5)
    pebble(bm, layer, (0, 0, 0.35), (1.6, 1.25, 1.5), rgb(0xa99c8a), 0.62, 3, subdiv=2)
    pebble(bm, layer, (1.45, 0.6, 0.08), (0.45, 0.4, 0.4), rgb(0xbcb09e), 0.5, 4)
    pebble(bm, layer, (-1.2, -0.85, 0.05), (0.32, 0.28, 0.3), rgb(0x968a7c), 0.5, 5)
    # The tide line the floods leave: a pale band round its waist.
    pebble(bm, layer, (0, 0, 0.3), (1.64, 1.29, 0.2), rgb(0xd8ccb6), 1.0, 3, subdiv=2)


def driftwood(bm, layer):
    random.seed(9)
    bark, bleached, end = rgb(0xcfc1a6), rgb(0xe2d8c2), rgb(0x9c8a70)
    # A trunk lying on the sand, a little bowed, with two broken limbs.
    pts = [(-2.2, 0.0, 0.16), (-0.7, 0.18, 0.2), (0.8, 0.05, 0.18), (2.0, -0.25, 0.13)]
    radii = [0.22, 0.2, 0.17, 0.12]
    for (a, b, ra, rb, c) in zip(pts, pts[1:], radii, radii[1:], [bark, bleached, bark]):
        cylinder(bm, layer, a, b, ra, rb, c, 7)
    cylinder(bm, layer, (-2.25, 0.0, 0.16), (-2.2, 0.0, 0.16), 0.2, 0.22, end, 7)
    cylinder(bm, layer, (-0.4, 0.15, 0.22), (0.5, 1.15, 0.55), 0.1, 0.05, bleached, 5)
    cylinder(bm, layer, (0.9, 0.0, 0.2), (1.6, -0.9, 0.12), 0.09, 0.05, bark, 5)
    # Root stubs at the thick end.
    for k in range(4):
        a = k * math.tau / 4 + 0.4
        cylinder(bm, layer, (-2.15, 0, 0.18), (-2.5, math.cos(a) * 0.45, 0.18 + math.sin(a) * 0.35), 0.07, 0.03, bark, 4)


def reeds(bm, layer):
    random.seed(13)
    straw, pale, dark = 0xcdb27a, 0xdcc794, 0xa88c5a
    for k in range(16):
        a = random.uniform(0, math.tau)
        d = random.uniform(0, 0.45)
        base = (math.cos(a) * d, math.sin(a) * d, 0)
        h = random.uniform(0.9, 1.7)
        lean = random.uniform(0.05, 0.4)
        la = random.uniform(0, math.tau)
        tip = (base[0] + math.cos(la) * lean, base[1] + math.sin(la) * lean, h)
        cylinder(bm, layer, base, tip, 0.035, 0.008, rgb(random.choice([straw, pale, dark]), 0.05), 3)
        if random.random() < 0.4:
            # A seed head on the tallest.
            pebble(bm, layer, tip, (0.05, 0.05, 0.16), rgb(0x8a6e48), 1.0, k)
    pebble(bm, layer, (0, 0, 0.0), (0.55, 0.5, 0.25), rgb(0xbfa678), 0.6, 2)


def mud(bm, layer):
    """Polygons of dried mud, each a thin slab whose rim curls up."""
    random.seed(21)
    cells = []
    for k in range(9):
        cells.append((random.uniform(-1.6, 1.6), random.uniform(-1.3, 1.3)))
    # Voronoi-ish: each plate is a polygon round its seed, clipped by neighbours.
    for k, (cx, cy) in enumerate(cells):
        ring = []
        for j in range(7):
            a = j * math.tau / 7 + random.uniform(-0.2, 0.2)
            r = 1.2
            for (ox, oy) in cells:
                if (ox, oy) == (cx, cy):
                    continue
                # Halfway to a neighbour in this direction, minus a crack.
                dx, dy = ox - cx, oy - cy
                proj = dx * math.cos(a) + dy * math.sin(a)
                if proj > 0:
                    r = min(r, (dx * dx + dy * dy) / (2 * proj) - 0.06)
            r = max(0.15, min(r, 0.9))
            ring.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
        top = [bm.verts.new((x, y, 0.07 + 0.03 * random.random())) for x, y in ring]
        rim = [bm.verts.new((cx + (x - cx) * 1.02, cy + (y - cy) * 1.02, 0.12)) for x, y in ring]
        bottom = [bm.verts.new((x, y, -0.02)) for x, y in ring]
        centre = bm.verts.new((cx, cy, 0.06))
        colour = rgb(0xb79c7e, 0.05)
        new = []
        for j in range(len(ring)):
            a, b = j, (j + 1) % len(ring)
            new.append(bm.faces.new((centre, top[a], top[b])))
            new.append(bm.faces.new((top[a], rim[a], rim[b], top[b])))
            new.append(bm.faces.new((rim[a], bottom[a], bottom[b], rim[b])))
        paint(bm, layer, new, colour)


def gauge(bm, layer):
    """A flood depth post: white board, a black tick every quarter metre, red top."""
    white, black, red, post = rgb(0xf1efe8), rgb(0x23262b), rgb(0xd23b2e), rgb(0x8d939b)
    H = 2.6
    box(bm, layer, (0, 0, H / 2), (0.09, 0.09, H), post)
    box(bm, layer, (0, -0.07, 1.25), (0.32, 0.04, 2.2), white)
    for k in range(9):
        z = 0.2 + k * 0.25
        w = 0.32 if k % 2 == 0 else 0.18
        box(bm, layer, (-(0.32 - w) / 2, -0.095, z), (w, 0.02, 0.05), black)
    box(bm, layer, (0, -0.07, 2.45), (0.34, 0.05, 0.3), red)
    box(bm, layer, (0, 0, 0.06), (0.4, 0.4, 0.12), rgb(0xa79e90))   # concrete foot


MODELS = {
    'river-stones-a': stones(1, 9, 1.4),
    'river-stones-b': stones(2, 5, 0.9),
    'river-boulder': boulder,
    'driftwood': driftwood,
    'dry-reeds': reeds,
    'mud-plates': mud,
    'flood-gauge': gauge,
}

bpy.ops.wm.read_factory_settings(use_empty=True)
mat = bpy.data.materials.new('river')
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get('Principled BSDF')
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.95

objs = []
for name, build in MODELS.items():
    obj = make(name, build)
    objs.append(obj)
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f'{name}.glb'), export_format='GLB',
                              use_selection=True, export_vertex_color='ACTIVE',
                              export_texcoords=False, export_materials='EXPORT')
    print(name, len(obj.data.polygons), 'faces')

if PREVIEW:
    # Lay them out in a row and render the lot from the game's angle.
    for k, obj in enumerate(objs):
        obj.location = ((k - len(objs) / 2) * 5, 0, 0)
    scene = bpy.context.scene
    world = bpy.data.worlds.new('w')
    world.color = (0.85, 0.66, 0.45)
    scene.world = world
    plane = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
    bm.to_mesh(plane)
    bm.free()
    g = bpy.data.objects.new('ground', plane)
    gm = bpy.data.materials.new('g')
    gm.use_nodes = True
    gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.75, 0.6, 0.42, 1)
    plane.materials.append(gm)
    scene.collection.objects.link(g)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 38
    scene.collection.objects.link(cam)
    d = Vector((1, -1, 1.35 * math.sqrt(2))).normalized()
    cam.location = d * 80
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = Vector((-0.5, 0.4, -1)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = 1400, 600
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
