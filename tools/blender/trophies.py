"""The trophies themselves: twelve racing forms on black plinths, rendered in
Blender (Cycles) in each tier's metal, for the trophy cabinet.

Run headless:  python trophies.py OUT_DIR [size] [forms...]
(with the `bpy` module from PyPI, or `blender -b -P trophies.py -- OUT_DIR`).

Writes OUT_DIR/{form}-{tier}.webp for every form and tier, transparent, square.
A locked trophy is the same picture darkened in CSS, so the cabinet shows the
shape of what is still to win. Which trophy uses which form is set in
src/achievements.js.

Forms: cup flag wheel star medal flame rocket tyre bolt helmet crown gem.
"""
import math
import os
import sys

import bpy
import bmesh  # after bpy: the module registers it
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = argv[0]
SIZE = int(argv[1]) if len(argv) > 1 else 320
ONLY = argv[2:]
os.makedirs(OUT, exist_ok=True)

TIERS = {
    # base colour (linear), roughness
    'bronze': ((0.62, 0.30, 0.13), 0.26),
    'silver': ((0.86, 0.88, 0.92), 0.18),
    'gold': ((1.0, 0.68, 0.22), 0.18),
    'platinum': ((0.72, 0.92, 1.0), 0.12),
}


# ------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.quality = 88
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [v.identifier for v in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    scene.view_settings.look = 'None'
    # A dim studio for the metal to reflect: dark below, lighter above.
    world = bpy.data.worlds.new('studio')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[0].color = (0.015, 0.017, 0.025, 1)
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = (0.42, 0.45, 0.52, 1)
    mapr = nt.nodes.new('ShaderNodeMapRange')
    mapr.inputs['From Min'].default_value = -1
    mapr.inputs['From Max'].default_value = 1
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mapr.inputs['Value'])
    nt.links.new(mapr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    scene.world = world
    # Key, fill and two rims: what makes metal read as metal is the bright
    # streaks it picks up, so the lights are big and placed for reflections.
    light('key', (3.2, -3.0, 4.2), 900, 3.0, (1.0, 0.95, 0.86))
    light('fill', (-4.0, -2.4, 1.6), 260, 4.0, (0.80, 0.88, 1.0))
    light('rim_l', (-2.6, 3.2, 3.0), 520, 1.6, (0.75, 0.85, 1.0))
    light('rim_r', (3.0, 3.0, 1.2), 380, 1.6, (1.0, 0.85, 0.7))
    light('top', (0.0, -0.6, 5.5), 300, 5.0, (1, 1, 1))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 70
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene


def light(name, loc, power, size, colour):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.size = size
    data.color = colour
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    obj.rotation_euler = (Vector((0, 0, 0.9)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(obj)


def material(name, colour, metallic=1.0, rough=0.2, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*colour, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    if not metallic and 'Specular IOR Level' in p.inputs:
        p.inputs['Specular IOR Level'].default_value = 0.25    # lacquer, not a mirror
    if coat and 'Coat Weight' in p.inputs:
        p.inputs['Coat Weight'].default_value = coat
    return m


def glass(name, colour):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*colour, 1)
    p.inputs['Roughness'].default_value = 0.02
    p.inputs['IOR'].default_value = 2.1
    p.inputs['Transmission Weight'].default_value = 1.0
    return m


# --------------------------------------------------------------- building
parts = []


def obj_from_bm(bm, name, mat, smooth=True, subsurf=0, bevel=0.0, mats=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in (mats or [mat]):
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    if bevel:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = 'ANGLE'
        mod.harden_normals = False
    if subsurf:
        mod = ob.modifiers.new('sub', 'SUBSURF')
        mod.levels = mod.render_levels = subsurf
    if smooth and not subsurf:
        try:
            me.set_sharp_from_angle(angle=math.radians(40))
        except Exception:
            pass
    parts.append(ob)
    return ob


def lathe(profile, name, mat, segs=64, subsurf=0):
    """Spin a profile [(r, z), ...] round Z."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((a, b)) for a, b in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=segs, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, mat, subsurf=subsurf)


def extrude2d(points, depth, name, mat, bevel=0.03):
    """A flat outline (x, z), extruded along Y and centred on it."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in points]
    face = bm.faces.new(front)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in res['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, depth, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, mat, smooth=False, bevel=bevel)


def prim(kind, name, mat, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), smooth=True, bevel=0.0, subsurf=0, **kw):
    bm = bmesh.new()
    if kind == 'cube':
        bmesh.ops.create_cube(bm, size=1.0)
    elif kind == 'cyl':
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=kw.get('segs', 48),
                              radius1=kw.get('r1', 0.5), radius2=kw.get('r2', 0.5), depth=kw.get('depth', 1.0))
    elif kind == 'sphere':
        bmesh.ops.create_uvsphere(bm, u_segments=kw.get('u', 48), v_segments=kw.get('v', 24), radius=kw.get('r', 0.5))
    elif kind == 'ico':
        bmesh.ops.create_icosphere(bm, subdivisions=kw.get('sub', 3), radius=kw.get('r', 0.5))
    elif kind == 'torus':
        R, r, su, sv = kw.get('R', 0.5), kw.get('r', 0.08), kw.get('su', 64), kw.get('sv', 16)
        grid = [[bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                 for b in [j * math.tau / sv for j in range(sv)]] for a in [i * kw.get('arc', math.tau) / su for i in range(su + (0 if kw.get('arc', math.tau) == math.tau else 1))]]
        rows = len(grid)
        closed = kw.get('arc', math.tau) == math.tau
        for i in range(rows if closed else rows - 1):
            for j in range(sv):
                a, b = grid[i][j], grid[(i + 1) % rows][j]
                c, d = grid[(i + 1) % rows][(j + 1) % sv], grid[i][(j + 1) % sv]
                bm.faces.new((a, b, c, d))
    m = Matrix.Translation(loc) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Diagonal((*scale, 1))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, mat, smooth=smooth, bevel=bevel, subsurf=subsurf)


def star_points(outer, inner, n=5, cx=0.0, cz=0.0):
    pts = []
    for i in range(n * 2):
        a = math.pi / 2 + i * math.pi / n
        r = outer if i % 2 == 0 else inner
        pts.append((cx + math.cos(a) * r, cz + math.sin(a) * r))
    return pts[::-1]


# The plinth every trophy stands on: black lacquer, a metal band and a plate.
def plinth(M, width=1.15):
    prim('cube', 'plinth', M['black'], loc=(0, 0, 0.16), scale=(width, width * 0.86, 0.32), bevel=0.04)
    prim('cube', 'plinth2', M['black'], loc=(0, 0, 0.42), scale=(width * 0.78, width * 0.66, 0.2), bevel=0.035)
    prim('cube', 'band', M['metal'], loc=(0, 0, 0.335), scale=(width * 0.8, width * 0.68, 0.035), bevel=0.01)
    prim('cube', 'plate', M['metal'], loc=(0, -width * 0.43 - 0.004, 0.17), scale=(width * 0.5, 0.012, 0.13), bevel=0.012)
    return 0.52      # top of the plinth


def stem(M, z0, height, r=0.07):
    prim('cyl', 'stem', M['metal'], loc=(0, 0, z0 + height / 2), r1=r * 1.5, r2=r, depth=height, segs=32)
    prim('sphere', 'knop', M['metal'], loc=(0, 0, z0 + height * 0.45), r=r * 1.9)
    return z0 + height


# ------------------------------------------------------------------- forms
def f_cup(M):
    z = plinth(M)
    prof = [(0.0, z), (0.36, z), (0.38, z + 0.03), (0.30, z + 0.08), (0.14, z + 0.14), (0.08, z + 0.24),
            (0.07, z + 0.42), (0.12, z + 0.48), (0.07, z + 0.54), (0.10, z + 0.60), (0.30, z + 0.68),
            (0.50, z + 0.86), (0.60, z + 1.10), (0.64, z + 1.36), (0.66, z + 1.40), (0.60, z + 1.40),
            (0.56, z + 1.14), (0.46, z + 0.92), (0.20, z + 0.74), (0.0, z + 0.72)]
    lathe(prof, 'cup', M['metal'], subsurf=1)
    for s in (-1, 1):
        cu = bpy.data.curves.new('handle', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.045
        cu.bevel_resolution = 6
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(2)
        pts = [(s * 0.52, 0, z + 1.20), (s * 0.95, 0, z + 1.12), (s * 0.48, 0, z + 0.80)]
        handles = [((s * 0.6, 0, z + 1.32), (s * 0.45, 0, z + 1.1)), ((s * 1.02, 0, z + 1.32), (s * 0.95, 0, z + 0.90)),
                   ((s * 0.62, 0, z + 0.82), (s * 0.4, 0, z + 0.78))]
        for p, co, (hl, hr) in zip(sp.bezier_points, pts, handles):
            p.co = co
            p.handle_left = hl
            p.handle_right = hr
        ob = bpy.data.objects.new('handle', cu)
        ob.data.materials.append(M['metal'])
        bpy.context.scene.collection.objects.link(ob)
        parts.append(ob)


def f_flag(M):
    z = plinth(M)
    for s in (-1, 1):
        tilt = s * 0.32
        pole_top = Vector((math.sin(tilt) * 1.55, 0, z + math.cos(tilt) * 1.55))
        prim('cyl', 'pole', M['metal'], loc=(pole_top.x / 2, 0, z + (pole_top.z - z) / 2), rot=(0, tilt, 0), r1=0.035, r2=0.035, depth=1.6, segs=24)
        prim('sphere', 'finial', M['metal'], loc=(pole_top.x, 0, pole_top.z + 0.04), r=0.06)
        # A chequered flag, rippling, hanging off the pole away from the centre.
        bm = bmesh.new()
        cols, rows, W, H = 8, 6, 0.95, 0.66
        grid = []
        for j in range(rows + 1):
            row = []
            for i in range(cols + 1):
                u, v = i / cols, j / rows
                x = s * u * W
                y = 0.07 * math.sin(u * 5.5 + v * 1.2) * u
                zz = -v * H - 0.12 * u * u
                p = Matrix.Rotation(tilt, 3, 'Y') @ Vector((x, y, zz))
                row.append(bm.verts.new(pole_top + p + Vector((0, 0, -0.05))))
            grid.append(row)
        for j in range(rows):
            for i in range(cols):
                f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
                f.material_index = (i + j) % 2
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = obj_from_bm(bm, 'flag', None, mats=[M['metal'], M['black']])
        mod = ob.modifiers.new('thick', 'SOLIDIFY')
        mod.thickness = 0.025


def f_wheel(M):
    z = plinth(M)
    z = stem(M, z, 0.3)
    c = (0, 0, z + 0.62)
    prim('torus', 'rim', M['metal'], loc=c, rot=(math.pi / 2, 0, 0), R=0.58, r=0.075)
    prim('cyl', 'hub', M['metal'], loc=c, rot=(math.pi / 2, 0, 0), r1=0.17, r2=0.15, depth=0.12, bevel=0.02)
    prim('cyl', 'badge', M['black'], loc=(c[0], -0.065, c[2]), rot=(math.pi / 2, 0, 0), r1=0.1, r2=0.1, depth=0.02)
    for a in (math.pi / 2 + math.pi, math.radians(-30), math.radians(210)):
        end = Vector(c) + Vector((math.cos(a), 0, math.sin(a))) * 0.56
        mid = (Vector(c) + end) / 2
        d = end - Vector(c)
        prim('cube', 'spoke', M['metal'], loc=mid, rot=(0, -math.atan2(d.z, d.x), 0), scale=(d.length, 0.06, 0.09), bevel=0.02)


def f_star(M):
    z = plinth(M)
    z = stem(M, z, 0.35)
    extrude2d(star_points(0.66, 0.28, cz=z + 0.62), 0.2, 'star', M['metal'], bevel=0.05)


def f_medal(M):
    z = plinth(M)
    z = stem(M, z, 0.22)
    c = (0, 0, z + 0.55)
    prim('cyl', 'disc', M['metal'], loc=c, rot=(math.pi / 2, 0, 0), r1=0.48, r2=0.48, depth=0.08, bevel=0.015)
    prim('torus', 'rim', M['metal'], loc=c, rot=(math.pi / 2, 0, 0), R=0.48, r=0.04)
    extrude2d(star_points(0.3, 0.13, cz=c[2]), 0.12, 'relief', M['metal'], bevel=0.02)
    # A ribbon in two colours up from the medal, as if it hung from a neck.
    for s, col in ((-1, M['red']), (1, M['blue'])):
        prim('cube', 'ribbon', col, loc=(s * 0.16, 0.03, c[2] + 0.72), rot=(0, s * 0.35, 0), scale=(0.2, 0.025, 0.62), bevel=0.01)
    prim('torus', 'loop', M['metal'], loc=(0, 0, c[2] + 0.5), rot=(math.pi / 2, 0, 0), R=0.07, r=0.025)


def f_flame(M):
    z = plinth(M)
    z = stem(M, z, 0.16)
    # A flame with three tongues, the middle one tallest, leaning a little.
    outline = [(0.0, 0.0), (0.25, 0.03), (0.41, 0.15), (0.47, 0.34), (0.44, 0.55), (0.34, 0.72),
               (0.42, 1.02), (0.20, 0.84), (0.10, 1.02), (0.04, 1.44), (-0.10, 1.06), (-0.24, 0.92),
               (-0.36, 1.16), (-0.40, 0.80), (-0.47, 0.56), (-0.46, 0.34), (-0.40, 0.15), (-0.25, 0.03)]
    extrude2d([(x, z + 0.02 + zz) for x, zz in outline], 0.22, 'flame', M['metal'], bevel=0.05)
    # Its hot core, in orange enamel, standing proud of the face.
    core = [(x * 0.52, z + 0.08 + zz * 0.56) for x, zz in outline]
    ob = extrude2d(core, 0.26, 'core', M['orange'], bevel=0.03)
    ob.location.y = -0.02


def f_rocket(M):
    z = plinth(M)
    tilt = -0.5
    base = Vector((0, 0, z + 0.12))
    rot = Matrix.Rotation(tilt, 3, 'Y')
    up = rot @ Vector((0, 0, 1))
    prof = [(0.0, 0.0), (0.16, 0.0), (0.2, 0.08), (0.2, 0.9), (0.17, 1.1), (0.1, 1.28), (0.0, 1.38)]
    ob = lathe(prof, 'rocket', M['metal'], segs=48)
    ob.rotation_euler = (0, tilt, 0)
    ob.location = base + up * 0.12
    prim('cyl', 'band', M['red'], loc=base + up * 0.92, rot=(0, tilt, 0), r1=0.205, r2=0.205, depth=0.1)
    prim('cyl', 'nozzle', M['black'], loc=base + up * 0.07, rot=(0, tilt, 0), r1=0.12, r2=0.16, depth=0.14)
    for k in range(3):
        a = k * math.tau / 3
        fin = [(0.18, 0.0), (0.42, -0.08), (0.42, 0.06), (0.18, 0.42)]
        o = extrude2d(fin, 0.04, 'fin', M['metal'], bevel=0.01)
        o.rotation_euler = (0, tilt, 0)
        o.rotation_mode = 'XYZ'
        o.matrix_world = Matrix.Translation(base + up * 0.12) @ rot.to_4x4() @ Matrix.Rotation(a, 4, 'Z')
    prim('cyl', 'post', M['metal'], loc=(0, 0, z + 0.1), r1=0.05, r2=0.05, depth=0.2)


def f_tyre(M):
    z = plinth(M)
    c = Vector((0, 0, z + 0.62))
    prim('torus', 'tyre', M['metal'], loc=c, rot=(math.pi / 2, 0, 0), R=0.44, r=0.17, su=72, sv=24)
    # Tread blocks round the outside, and five spokes inside the rim.
    for k in range(28):
        a = k / 28 * math.tau
        p = c + Vector((math.cos(a), 0, math.sin(a))) * 0.6
        prim('cube', 'tread', M['metal'], loc=p, rot=(0, -a, 0), scale=(0.05, 0.3, 0.07), bevel=0.012)
    prim('cyl', 'hub', M['black'], loc=c, rot=(math.pi / 2, 0, 0), r1=0.27, r2=0.27, depth=0.16)
    for k in range(5):
        a = k / 5 * math.tau + math.pi / 2
        end = c + Vector((math.cos(a), 0, math.sin(a))) * 0.28
        mid = (c + end) / 2
        prim('cube', 'spoke', M['metal'], loc=mid + Vector((0, -0.05, 0)), rot=(0, -a, 0), scale=(0.28, 0.06, 0.06), bevel=0.015)
    prim('cyl', 'cap', M['metal'], loc=c + Vector((0, -0.07, 0)), rot=(math.pi / 2, 0, 0), r1=0.08, r2=0.08, depth=0.06, bevel=0.01)


def f_bolt(M):
    z = plinth(M)
    z = stem(M, z, 0.26)
    pts = [(0.12, 1.42), (-0.4, 0.62), (-0.06, 0.6), (-0.28, -0.0), (0.42, 0.86), (0.06, 0.88), (0.3, 1.42)]
    extrude2d([(x, z + 0.04 + zz * 0.85) for x, zz in pts][::-1], 0.2, 'bolt', M['metal'], bevel=0.04)


def f_helmet(M):
    z = plinth(M)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=0.58)
    # Cut it off below the chin, a little open at the back of the neck.
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -0.26), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, z + 0.32)) @ Matrix.Diagonal((0.95, 1.08, 1.0, 1)), verts=bm.verts)
    ob = obj_from_bm(bm, 'shell', M['metal'])
    sol = ob.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.04
    # The visor: a band of the sphere, a touch bigger, in black glass.
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=0.6)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -0.02), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0.24), plane_no=(0, 0, 1), clear_outer=True)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, -0.12, 0), plane_no=(0, 1, 0), clear_outer=True)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, z + 0.32)) @ Matrix.Diagonal((0.95, 1.08, 1.0, 1)), verts=bm.verts)
    ob = obj_from_bm(bm, 'visor', M['visor'])
    sol = ob.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.03
    # A stripe over the crown.
    prim('torus', 'stripe', M['red'], loc=(0, 0, z + 0.32), rot=(0, math.pi / 2, 0), scale=(1.0, 1.08, 0.95), R=0.585, r=0.035, arc=math.pi, su=48)


def f_crown(M):
    z = plinth(M)
    z += 0.05
    n = 5
    bm = bmesh.new()
    segs = 80
    ring_lo, ring_hi = [], []
    for i in range(segs):
        a = i / segs * math.tau
        r = 0.48
        tip = 0.5 + 0.5 * math.cos(a * n)
        h = 0.32 + 0.42 * tip ** 3
        ring_lo.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        ring_hi.append(bm.verts.new((math.cos(a) * r * 1.06, math.sin(a) * r * 1.06, z + h)))
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((ring_lo[i], ring_lo[j], ring_hi[j], ring_hi[i]))
    ob = obj_from_bm(bm, 'crown', M['metal'])
    sol = ob.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.05
    for k in range(n):
        a = k / n * math.tau
        prim('sphere', 'pearl', M['metal'], loc=(math.cos(a) * 0.51, math.sin(a) * 0.51, z + 0.79), r=0.06)
    prim('torus', 'band', M['metal'], loc=(0, 0, z + 0.06), R=0.5, r=0.045)
    for k in range(n):
        a = (k + 0.5) / n * math.tau
        prim('ico', 'jewel', M['red'] if k % 2 else M['blue'], loc=(math.cos(a) * 0.53, math.sin(a) * 0.53, z + 0.2), r=0.06, sub=1, smooth=False)


def f_gem(M):
    z = plinth(M)
    z = stem(M, z, 0.2)
    # A brilliant: crown, girdle, pavilion, sixteen facets round.
    n = 16
    bm = bmesh.new()
    c = z + 0.5
    table = [bm.verts.new((math.cos(i / n * math.tau) * 0.3, math.sin(i / n * math.tau) * 0.3, c + 0.42)) for i in range(n)]
    girdle_t = [bm.verts.new((math.cos((i + 0.5) / n * math.tau) * 0.6, math.sin((i + 0.5) / n * math.tau) * 0.6, c + 0.12)) for i in range(n)]
    girdle_b = [bm.verts.new((v.co.x, v.co.y, c + 0.06)) for v in girdle_t]
    point = bm.verts.new((0, 0, c - 0.6))
    bm.faces.new(table[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((table[i], girdle_t[i], table[j]))
        bm.faces.new((girdle_t[i], girdle_t[j], table[j]))
        bm.faces.new((girdle_t[i], girdle_b[i], girdle_b[j], girdle_t[j]))
        bm.faces.new((girdle_b[i], point, girdle_b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj_from_bm(bm, 'gem', M['gem'], smooth=False)
    # Four claws holding it.
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        cu = bpy.data.curves.new('claw', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.03
        sp = cu.splines.new('POLY')
        sp.points.add(2)
        for p, (r, zz) in zip(sp.points, [(0.08, z), (0.5, c - 0.2), (0.63, c + 0.16)]):
            p.co = (math.cos(a) * r, math.sin(a) * r, zz, 1)
        ob = bpy.data.objects.new('claw', cu)
        ob.data.materials.append(M['metal'])
        bpy.context.scene.collection.objects.link(ob)
        parts.append(ob)


FORMS = {
    'cup': f_cup, 'flag': f_flag, 'wheel': f_wheel, 'star': f_star, 'medal': f_medal, 'flame': f_flame,
    'rocket': f_rocket, 'tyre': f_tyre, 'bolt': f_bolt, 'helmet': f_helmet, 'crown': f_crown, 'gem': f_gem,
}


def frame(scene):
    """Point the camera at the whole trophy, a little from above and the left."""
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    # From the evaluated meshes' own vertices: a curve's bound box counts its
    # bezier handles, and framed the cup's handles a metre out on each side.
    for ob in parts:
        ev = ob.evaluated_get(deps)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    radius = (hi - lo).length / 2
    cam = scene.camera
    fov = 2 * math.atan(18 / cam.data.lens)          # 36 mm sensor
    d = Vector((0.42, -1.0, 0.36)).normalized()
    cam.location = centre + d * (radius * 1.04 / math.sin(fov / 2))
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()


for form, build in FORMS.items():
    if ONLY and form not in ONLY:
        continue
    scene = reset()
    parts.clear()
    M = {
        'metal': material('metal', TIERS['gold'][0], rough=TIERS['gold'][1]),
        'black': material('black', (0.006, 0.006, 0.008), metallic=0.0, rough=0.5, coat=0.0),
        'orange': material('orange', (0.95, 0.22, 0.02), metallic=0.0, rough=0.3, coat=0.4),
        'red': material('red', (0.55, 0.03, 0.03), metallic=0.0, rough=0.25, coat=0.5),
        'blue': material('blue', (0.03, 0.12, 0.5), metallic=0.0, rough=0.25, coat=0.5),
        'visor': material('visor', (0.01, 0.01, 0.015), metallic=0.2, rough=0.05, coat=1.0),
        'gem': glass('gem', (0.75, 0.95, 1.0)),
    }
    build(M)
    frame(scene)
    p = M['metal'].node_tree.nodes['Principled BSDF']
    for tier, (colour, rough) in TIERS.items():
        p.inputs['Base Color'].default_value = (*colour, 1)
        p.inputs['Roughness'].default_value = rough
        scene.render.filepath = os.path.join(OUT, f'{form}-{tier}.webp')
        bpy.ops.render.render(write_still=True)
        print('rendered', form, tier)
