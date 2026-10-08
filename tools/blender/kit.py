"""Shared helpers for the Blender model scripts.

Models are built standing on Blender's x-y plane with z up. The glTF
exporter turns that into the game's y-up frame, Blender -Y becoming +Z, so a
model that should face the game's +Z is built facing Blender's -Y. Sizes
are game units. Every face carries a flat vertex colour; there is one
material and no texture, so the game merges all copies of a kit into one
mesh (assets.js keeps the colours of the `canyon` and `alpine` kits).
"""
import math
import os

import bpy
import bmesh  # after bpy: the module registers it
from mathutils import Matrix, Vector, noise


def rgb(h, jitter=0.0, rng=None):
    """A hex colour as linear RGBA: float colour layers hold linear values."""
    k = 1 + (rng.uniform(-jitter, jitter) if rng and jitter else 0)
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(min(1.0, ((h >> s) & 255) / 255 * k)) for s in (16, 8, 0)) + (1.0,)


class Model:
    """One model under construction: a bmesh and its colour layer."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')

    def _paint(self, faces, colour):
        for f in faces:
            for loop in f.loops:
                loop[self.col] = colour

    def _shape(self, make, matrix, colour):
        before = set(self.bm.faces)
        res = make()
        bmesh.ops.transform(self.bm, matrix=matrix, verts=res['verts'])
        self._paint(set(self.bm.faces) - before, colour)

    def box(self, centre, size, colour, rot=(0, 0, 0)):
        m = Matrix.Translation(centre) @ _euler(rot) @ Matrix.Diagonal((*size, 1))
        self._shape(lambda: bmesh.ops.create_cube(self.bm, size=1.0), m, colour)

    def beam(self, a, b, w, colour, h=None, roll=0.0):
        """A square timber or girder from a to b, w across (h deep)."""
        a, b = Vector(a), Vector(b)
        d = b - a
        q = d.normalized().to_track_quat('Z', 'Y')
        m = (Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4() @ Matrix.Rotation(roll, 4, 'Z')
             @ Matrix.Diagonal((w, h or w, d.length, 1)))
        self._shape(lambda: bmesh.ops.create_cube(self.bm, size=1.0), m, colour)

    def cyl(self, a, b, r0, colour, r1=None, segs=8, caps=True):
        a, b = Vector(a), Vector(b)
        d = b - a
        q = d.normalized().to_track_quat('Z', 'Y')
        m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        self._shape(lambda: bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs,
                                                  radius1=r0, radius2=r0 if r1 is None else r1, depth=d.length), m, colour)

    def ring(self, centre, radius, tube, colour, axis='X', segs=16, tube_segs=4):
        """A wheel rim: a torus round `axis` through `centre`."""
        before_v = set(self.bm.verts)
        before = set(self.bm.faces)
        verts = []
        for i in range(segs):
            a = i * math.tau / segs
            row = []
            for j in range(tube_segs):
                b = j * math.tau / tube_segs + math.pi / tube_segs
                r = radius + tube * math.cos(b)
                row.append(self.bm.verts.new((r * math.cos(a), r * math.sin(a), tube * math.sin(b))))
            verts.append(row)
        for i in range(segs):
            for j in range(tube_segs):
                a, b = verts[i][j], verts[(i + 1) % segs][j]
                c, d = verts[(i + 1) % segs][(j + 1) % tube_segs], verts[i][(j + 1) % tube_segs]
                self.bm.faces.new((a, b, c, d))
        rot = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'Z': Matrix.Identity(4)}[axis]
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(centre) @ rot, verts=list(set(self.bm.verts) - before_v))
        self._paint(set(self.bm.faces) - before, colour)

    def lump(self, centre, size, colour, seed=0, subdiv=1, squash=1.0, rough=0.16):
        """A rock or a lump of ore: an icosphere nudged by noise."""
        before_v = set(self.bm.verts)
        before = set(self.bm.faces)
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0)
        for v in res['verts']:
            n = noise.noise(v.co * 1.7 + Vector((seed, seed * 0.37, 0)))
            co = v.co * (1 + rough * n)
            v.co = Vector((co.x * size[0], co.y * size[1], co.z * size[2] * squash)) + Vector(centre)
        self._paint(set(self.bm.faces) - before, colour)

    def cone(self, base, height, radius, colour, segs=12, top_radius=0.0):
        self.cyl(base, (base[0], base[1], base[2] + height), radius, colour, r1=top_radius, segs=segs)

    def poly(self, pts, colour):
        """One flat face through the given points, in order."""
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        self._paint([f], colour)

    def export(self, out_dir):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for p in mesh.polygons:
            p.use_smooth = False
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        mesh.materials.append(_material())
        mesh.color_attributes.active_color = mesh.color_attributes['Col']
        for o in bpy.context.scene.objects:
            o.select_set(o is obj)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, f'{self.name}.glb'), export_format='GLB',
                                  use_selection=True, export_vertex_color='ACTIVE',
                                  export_texcoords=False, export_materials='EXPORT')
        print(f'{self.name}: {len(mesh.polygons)} faces')
        return obj


def _euler(rot):
    return (Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X'))


_mat = None


def _material():
    global _mat
    if _mat is None:
        _mat = bpy.data.materials.new('kit')
        _mat.use_nodes = True
        bsdf = _mat.node_tree.nodes.get('Principled BSDF')
        vc = _mat.node_tree.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        _mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.95
    return _mat


def reset():
    global _mat
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mat = None


def preview(objs, path, ground=(0.75, 0.6, 0.42), sky=(0.85, 0.66, 0.45), spacing=9, scale=None):
    """Lay the models out in a row and render them from the game's angle."""
    for k, obj in enumerate(objs):
        obj.location = ((k - (len(objs) - 1) / 2) * spacing, 0, 0)
    scene = bpy.context.scene
    world = bpy.data.worlds.new('w')
    world.color = sky
    scene.world = world
    plane = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=200)
    bm.to_mesh(plane)
    bm.free()
    g = bpy.data.objects.new('ground', plane)
    gm = bpy.data.materials.new('g')
    gm.use_nodes = True
    gm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*ground, 1)
    plane.materials.append(gm)
    scene.collection.objects.link(g)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    # The row runs along x, which the game's camera sees at 45 degrees.
    cam.data.ortho_scale = scale or (len(objs) * spacing * 0.8 + 6)
    scene.collection.objects.link(cam)
    d = Vector((1, -1, 1.35 * math.sqrt(2))).normalized()
    cam.location = d * 150 + Vector((0, 0, 3))
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = Vector((-0.55, 0.42, -0.75)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = 1600, 700
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
