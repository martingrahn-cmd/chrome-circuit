"""Canyon landmarks for Red Rock Canyon, built in Blender and exported as GLBs.

Run headless:  python canyon_landmarks.py OUT_DIR [preview.png]
(with the `bpy` module from PyPI, or `blender -b -P canyon_landmarks.py -- OUT_DIR`).

  mine-headframe     the timber tower over a mine shaft, its hoist house behind
  rail-straight      four units of narrow-gauge track
  mine-cart          an ore cart, loaded
  mine-cart-tipped   one that came off the rails, its load spilled
  ore-pile           a heap of ore with the odd glint in it
  water-tower        a wooden tank on a trestle, as at any desert halt
  windpump           a lattice windmill over a well; its rotor is separate...
  windpump-rotor     ...so the game can turn it in the wind
  water-trough       the stock trough it fills

Front is the game's +Z (Blender -Y), see kit.py.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import Model, preview, reset, rgb  # noqa: E402
from mathutils import Matrix  # noqa: E402
import bmesh  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)
R = random.Random(1849)

TIMBER, TIMBER_DARK, TIMBER_PALE = 0x8b6a48, 0x6a4e34, 0xa88560
IRON, RUST, TIN = 0x4b5059, 0x9a4f2c, 0x9aa3ab
ORE = [0x7d776f, 0x8f857a, 0xb86b3a, 0x6b625a, 0xa35a33]
GOLD = 0xe2b347


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def trestle(m, base, top, height, girts, colour, w, brace=True):
    """Four legs leaning in from a square of half-width `base` to `top`,
    girts at the given heights and X-bracing on every face between them."""
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    leg = lambda c, z: (c[0] * (base + (top - base) * z / height), c[1] * (base + (top - base) * z / height), z)
    for c in corners:
        m.beam(leg(c, 0), leg(c, height), w, rgb(colour, 0.05, R))
    levels = [0.25] + list(girts) + [height]
    for z in girts:
        for a, b in zip(corners, corners[1:] + corners[:1]):
            m.beam(leg(a, z), leg(b, z), w * 0.7, rgb(TIMBER_DARK if colour == TIMBER else colour, 0.05, R))
    if brace:
        for z0, z1 in zip(levels, levels[1:]):
            for a, b in zip(corners, corners[1:] + corners[:1]):
                m.beam(leg(a, z0), leg(b, z1), w * 0.55, rgb(colour, 0.06, R))
                m.beam(leg(b, z0), leg(a, z1), w * 0.55, rgb(colour, 0.06, R))


def headframe():
    m = Model('mine-headframe')
    H = 8.0
    # The shaft collar and the black of the shaft.
    m.box((0, 0, 0.2), (3.4, 3.4, 0.4), rgb(TIMBER_DARK))
    m.box((0, 0, 0.41), (1.6, 1.6, 0.02), rgb(0x1b1714))
    trestle(m, 1.5, 0.8, H, (2.6, 5.3), TIMBER, 0.32)
    m.box((0, 0, H + 0.1), (2.2, 2.2, 0.22), rgb(TIMBER_PALE))
    # The sheave wheel, on two bearing posts, axis across the frame.
    wc = (0, 0, H + 1.15)
    for x in (-0.45, 0.45):
        m.beam((x, -0.3, H + 0.2), (x, 0, wc[2]), 0.18, rgb(TIMBER_DARK))
        m.beam((x, 0.3, H + 0.2), (x, 0, wc[2]), 0.18, rgb(TIMBER_DARK))
    m.ring(wc, 0.95, 0.09, rgb(RUST), axis='X', segs=20)
    for k in range(4):
        a = k * math.pi / 4
        p = (0, math.cos(a) * 0.92, math.sin(a) * 0.92)
        m.beam((0, wc[1] + p[1], wc[2] + p[2]), (0, wc[1] - p[1], wc[2] - p[2]), 0.07, rgb(RUST))
    m.cyl((-0.5, 0, wc[2]), (0.5, 0, wc[2]), 0.12, rgb(IRON), segs=8)
    # Backstays down to the hoist house behind, and the rope between.
    for x in (-0.8, 0.8):
        m.beam((x, 0.8, H), (x * 1.4, 5.6, 0), 0.3, rgb(TIMBER, 0.05, R))
    m.beam((-1.1, 3.2, 4.2), (1.1, 3.2, 4.2), 0.2, rgb(TIMBER_DARK))
    m.cyl((0, 0.6, wc[2] + 0.7), (0, 6.8, 1.9), 0.04, rgb(0x2b2b2b), segs=4)
    m.cyl((0, -0.95, wc[2]), (0, -0.95, 0.42), 0.04, rgb(0x2b2b2b), segs=4)
    # Hoist house: plank walls, a tin roof on a slope, a stovepipe.
    m.box((0, 7.4, 1.0), (2.8, 2.4, 2.0), rgb(0xa8794e))
    m.box((0, 6.18, 0.8), (0.9, 0.04, 1.4), rgb(0x3d2c1e))                     # door, facing the frame
    roof = [(-1.6, 6.0, 2.35), (1.6, 6.0, 2.35), (1.6, 8.8, 1.8), (-1.6, 8.8, 1.8)]
    m.poly(roof, rgb(TIN))
    m.poly([(x, y, z - 0.08) for x, y, z in roof[::-1]], rgb(0x6f777f))
    m.cyl((0.8, 8.0, 1.9), (0.8, 8.0, 3.1), 0.12, rgb(IRON), segs=6)
    return m


def rail():
    m = Model('rail-straight')
    for k in range(7):
        y = -1.71 + k * 0.57
        m.box((0, y, 0.05), (1.5, 0.26, 0.1), rgb(0x5e4630, 0.08, R))
    for x in (-0.5, 0.5):
        m.box((x, 0, 0.16), (0.08, 4.0, 0.12), rgb(0x6c7078))
    return m


def cart_body(m):
    """An ore cart on the rails' gauge, length along Y, loaded."""
    rust = rgb(0x8a4a2e)
    bot = [(-0.42, -0.62, 0.42), (0.42, -0.62, 0.42), (0.42, 0.62, 0.42), (-0.42, 0.62, 0.42)]
    top = [(-0.58, -0.82, 1.08), (0.58, -0.82, 1.08), (0.58, 0.82, 1.08), (-0.58, 0.82, 1.08)]
    m.poly(bot[::-1], rust)
    for k in range(4):
        a, b = k, (k + 1) % 4
        m.poly([bot[a], bot[b], top[b], top[a]], rust)
        m.poly([top[a], top[b], bot[b], bot[a]], rgb(0x5a2f1d))                 # inside
        m.beam(top[a], top[b], 0.07, rgb(IRON))
    for x in (-0.5, 0.5):
        for y in (-0.45, 0.45):
            m.cyl((x - 0.06, y, 0.26), (x + 0.06, y, 0.26), 0.24, rgb(0x2f3236), segs=10)
        m.beam((x * 0.8, -0.6, 0.35), (x * 0.8, 0.6, 0.35), 0.1, rgb(IRON))
    m.beam((0, -0.62, 0.5), (0, -1.0, 0.5), 0.08, rgb(IRON))
    m.beam((0, 0.62, 0.5), (0, 1.0, 0.5), 0.08, rgb(IRON))


def cart():
    m = Model('mine-cart')
    cart_body(m)
    for k in range(9):
        a = k * math.tau / 9
        r = 0.3 if k else 0
        c = (math.cos(a) * r * 1.0, math.sin(a) * r * 1.5, 1.02 + (0.1 if not k else 0))
        colour = GOLD if k == 4 else R.choice(ORE)
        m.lump(c, (0.24, 0.24, 0.2), rgb(colour, 0.05, R), seed=k)
    return m


def cart_tipped():
    m = Model('mine-cart-tipped')
    cart_body(m)
    # Over on its side, open end towards +x, where its load spilled.
    bmesh.ops.transform(m.bm, matrix=Matrix.Translation((0, 0, 0.58)) @ Matrix.Rotation(math.radians(-100), 4, 'Y')
                        @ Matrix.Translation((0, 0, -0.58)), verts=list(m.bm.verts))
    for k in range(12):
        a = R.uniform(-1.1, 1.1)
        d = R.uniform(0.9, 2.1)
        c = (math.cos(a) * d, math.sin(a) * d * 0.9, 0.08)
        colour = GOLD if k == 7 else R.choice(ORE)
        m.lump(c, (R.uniform(0.18, 0.3),) * 2 + (0.18,), rgb(colour, 0.05, R), seed=20 + k, squash=0.7)
    return m


def ore_pile():
    m = Model('ore-pile')
    for k in range(26):
        a = R.uniform(0, math.tau)
        d = R.uniform(0, 1.0) ** 0.7 * 1.7
        h = (1 - d / 1.8) * 1.1
        s = R.uniform(0.28, 0.45) * (1.3 - d / 3)
        colour = GOLD if k in (5, 17) else R.choice(ORE)
        m.lump((math.cos(a) * d, math.sin(a) * d, h), (s, s, s * 0.8), rgb(colour, 0.06, R), seed=40 + k)
    m.lump((0, 0, 0.2), (1.7, 1.7, 0.9), rgb(0x7f7468), seed=3, squash=0.8)
    return m


def water_tower():
    m = Model('water-tower')
    H = 5.0
    trestle(m, 1.6, 1.25, H, (1.7, 3.4), TIMBER, 0.28)
    m.box((0, 0, H + 0.1), (3.2, 3.2, 0.2), rgb(TIMBER_PALE))
    # The tank: staves in two tones, iron hoops round it, a shingled cone.
    segs = 18
    for k in range(segs):
        a0, a1 = k * math.tau / segs, (k + 1) * math.tau / segs
        tone = rgb(0x9a7550 if k % 2 else 0x8c6a47, 0.04, R)
        p = lambda a, z: (math.cos(a) * 1.75, math.sin(a) * 1.75, z)
        m.poly([p(a0, H + 0.2), p(a1, H + 0.2), p(a1, H + 2.9), p(a0, H + 2.9)], tone)
    for z in (H + 0.55, H + 1.55, H + 2.55):
        m.ring((0, 0, z), 1.77, 0.045, rgb(0x3f4248), axis='Z', segs=segs)
    m.cone((0, 0, H + 2.9), 0.95, 1.98, rgb(0x6f4e34), segs=segs)
    m.cyl((0, 0, H + 3.8), (0, 0, H + 4.2), 0.06, rgb(IRON), segs=6)
    # The spout, swung out over the track, and a ladder up a leg.
    m.cyl((1.7, 0, H + 0.7), (2.5, 0, H + 0.5), 0.14, rgb(0x3f4248), segs=8)
    m.cyl((2.5, 0, H + 0.5), (2.5, 0, H - 1.0), 0.12, rgb(0x34373b), r1=0.16, segs=8)
    for s in (-0.25, 0.25):
        m.beam((1.55 + s * 0.2, -1.7 + s, 0), (1.25 + s * 0.2, -1.4 + s, H), 0.07, rgb(TIMBER_DARK))
    for k in range(10):
        z = 0.4 + k * 0.48
        t = z / H
        x = 1.55 + (1.25 - 1.55) * t
        m.beam((x, -1.95 + 0.3 * t, z), (x, -1.45 + 0.3 * t, z), 0.05, rgb(TIMBER_DARK))
    return m


def windpump():
    m = Model('windpump')
    H = 7.0
    trestle(m, 1.1, 0.25, H, (1.75, 3.5, 5.25), 0x9ca3ab, 0.1)
    m.box((0, 0, H - 0.4), (1.0, 1.0, 0.08), rgb(0x7d858d))
    m.box((0, 0, H + 0.2), (0.38, 0.7, 0.36), rgb(0x8a929a))                  # gearbox
    m.cyl((0, -0.2, H + 0.2), (0, -0.52, H + 0.2), 0.06, rgb(IRON), segs=6)   # shaft out to the rotor
    # The tail: a boom and the vane that keeps it in the wind.
    m.beam((0, 0.3, H + 0.25), (0, 2.2, H + 0.4), 0.07, rgb(0x8a929a))
    m.box((0, 2.3, H + 0.45), (0.04, 1.1, 0.75), rgb(0xc0392b))
    m.box((0, 2.3, H + 0.45), (0.05, 0.7, 0.18), rgb(0xf1efe8))
    m.cyl((0, 0, H), (0, 0, 0.2), 0.03, rgb(IRON), segs=4)                    # pump rod
    m.box((0, 0, 0.25), (0.6, 0.6, 0.5), rgb(0x8a8378))                       # well head
    m.cyl((0.3, 0, 0.35), (1.6, 0, 0.35), 0.05, rgb(IRON), segs=6)            # pipe to the trough
    return m


def rotor():
    """Eighteen sails round a hub, facing the game's +Z, turning about it."""
    m = Model('windpump-rotor')
    n = 18
    for k in range(n):
        a = k * math.tau / n
        c, s = math.cos(a), math.sin(a)
        mid = 0.82
        m.box((c * mid, 0, s * mid), (1.05, 0.03, 0.2), rgb(0xc9ced4, 0.04, R), rot=(0, -a, 0))
    m.ring((0, 0, 0), 1.3, 0.04, rgb(0x9ca3ab), axis='Y', segs=24)
    m.ring((0, 0, 0), 0.55, 0.035, rgb(0x9ca3ab), axis='Y', segs=16)
    m.cyl((0, 0.08, 0), (0, -0.12, 0), 0.16, rgb(0x5a5f66), segs=8)
    return m


def trough():
    m = Model('water-trough')
    wall = rgb(0x8f8a80)
    m.box((0, 0, 0.05), (3.0, 1.0, 0.1), wall)
    for x in (-1.45, 1.45):
        m.box((x, 0, 0.35), (0.1, 1.0, 0.6), wall)
    for y in (-0.45, 0.45):
        m.box((0, y, 0.35), (3.0, 0.1, 0.6), wall)
    m.box((0, 0, 0.5), (2.8, 0.8, 0.02), rgb(0x4f7f8a))                       # water
    return m


reset()
objs = []
for build in (headframe, rail, cart, cart_tipped, ore_pile, water_tower, windpump, rotor, trough):
    objs.append(build().export(OUT))

if PREVIEW:
    # The rotor goes back on its windmill for the picture.
    row = [o for k, o in enumerate(objs) if k != 7]
    objs[7].location = ((6 - (len(row) - 1) / 2) * 8, -0.52, 7.2)
    preview(row, PREVIEW, spacing=8)
