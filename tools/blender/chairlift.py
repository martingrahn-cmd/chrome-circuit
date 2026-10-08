"""A chairlift for Alpine Winter, built in Blender and exported as GLBs.

Run headless:  python chairlift.py OUT_DIR [preview.png]
(with the `bpy` module from PyPI, or `blender -b -P chairlift.py -- OUT_DIR`).

  lift-tower     a steel tower; the haul rope runs through sheaves at the
                 ends of its crossarm, 1.3 either side, 6.9 up
  lift-station   a terminal: the drive under a canopy, the bull wheel out
                 in front, 3.0 along +Z and 4.8 up, the rope at the same 1.3
                 either side; the liftie's hut behind. Faces the line (+Z)
  lift-chair     a double chair hanging from its grip at the origin, seat
                 facing +Z; the game moves these along the rope

The game strings the rope between them and runs the chairs (track.js).
Front is the game's +Z (Blender -Y), see kit.py.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import Model, preview, reset, rgb  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)
R = random.Random(1936)

STEEL, STEEL_DARK = 0x8d96a3, 0x5f6773
YELLOW = 0xf2b632
SNOW = 0xf3f6fa
CONCRETE = 0xa9adb3
RED = 0xc23b2e
WOOD = 0x8a5a3a
SPAN = 1.3          # rope either side of the centre
TOWER_ROPE = 6.9
STATION_ROPE = 4.8


def tower():
    m = Model('lift-tower')
    m.box((0, 0, 0.25), (1.2, 1.2, 0.5), rgb(CONCRETE))
    m.cyl((0, 0, 0.5), (0, 0, TOWER_ROPE + 0.5), 0.3, rgb(STEEL), r1=0.2, segs=10)
    # Crossarm, with a sheave train hung under each end for the rope.
    m.box((0, 0, TOWER_ROPE + 0.55), (2 * SPAN + 0.7, 0.32, 0.28), rgb(STEEL_DARK))
    for s in (-1, 1):
        x = s * SPAN
        m.box((x, 0, TOWER_ROPE + 0.28), (0.12, 1.3, 0.26), rgb(YELLOW))
        for y in (-0.42, 0, 0.42):
            m.cyl((x - 0.08, y, TOWER_ROPE + 0.12), (x + 0.08, y, TOWER_ROPE + 0.12), 0.13, rgb(0x2c3036), segs=8)
    # A maintenance ladder up the back and a little catwalk on the arm.
    for s in (-0.18, 0.18):
        m.beam((s, 0.34, 0.5), (s, 0.27, TOWER_ROPE + 0.4), 0.04, rgb(STEEL_DARK))
    for k in range(13):
        z = 0.9 + k * 0.48
        m.beam((-0.18, 0.33 - 0.005 * k, z), (0.18, 0.33 - 0.005 * k, z), 0.03, rgb(STEEL_DARK))
    m.box((0, 0.4, TOWER_ROPE + 0.75), (2 * SPAN, 0.5, 0.05), rgb(0x9aa2ad))
    m.box((0, 0.66, TOWER_ROPE + 1.05), (2 * SPAN, 0.04, 0.04), rgb(YELLOW))
    # Snow lying on the arm.
    m.box((0, 0, TOWER_ROPE + 0.72), (2 * SPAN + 0.6, 0.3, 0.07), rgb(SNOW))
    return m


def station():
    m = Model('lift-station')
    # Concrete deck, and four columns carrying the canopy over the drive.
    m.box((0, -1.3, 0.25), (4.6, 5.6, 0.5), rgb(CONCRETE))
    for x in (-1.9, 1.9):
        for y in (-1.7, 0.8):
            m.box((x, y, 2.9), (0.35, 0.35, 4.8), rgb(STEEL_DARK))
    m.box((0, -0.45, STATION_ROPE + 0.85), (4.6, 3.0, 0.35), rgb(RED))
    m.box((0, -0.45, STATION_ROPE + 1.08), (4.8, 3.2, 0.12), rgb(SNOW))
    m.box((0, -0.45, STATION_ROPE + 0.3), (1.6, 1.8, 0.8), rgb(0x4c535d))     # drive
    # The bull wheel the rope turns round, out in front where it shows.
    wheel_y = -3.0
    m.ring((0, wheel_y, STATION_ROPE), SPAN, 0.1, rgb(YELLOW), axis='Z', segs=24)
    for k in range(4):
        a = k * math.pi / 4
        m.beam((math.cos(a) * SPAN, wheel_y + math.sin(a) * SPAN, STATION_ROPE),
               (-math.cos(a) * SPAN, wheel_y - math.sin(a) * SPAN, STATION_ROPE), 0.08, rgb(STEEL_DARK))
    m.beam((0, wheel_y, STATION_ROPE), (0, -1.0, STATION_ROPE + 0.3), 0.3, rgb(0x4c535d))
    m.cyl((0, wheel_y, STATION_ROPE - 0.25), (0, wheel_y, STATION_ROPE + 0.25), 0.25, rgb(0x2c3036), segs=10)
    # The liftie's hut, at the back corner, with a snowy roof.
    hx, hy = 1.4, 2.6
    m.box((hx, hy, 1.4), (1.8, 1.8, 1.8), rgb(WOOD))
    m.box((hx, hy - 0.91, 1.6), (1.2, 0.04, 0.7), rgb(0x9ec7e0))
    m.box((hx - 0.4, hy - 0.91, 1.0), (0.5, 0.04, 1.2), rgb(0x4a2f1f))
    roof = [(hx - 1.15, hy - 1.15, 2.4), (hx + 1.15, hy - 1.15, 2.4), (hx + 1.15, hy + 1.15, 2.9), (hx - 1.15, hy + 1.15, 2.9)]
    m.poly(roof, rgb(SNOW))
    m.poly(roof[::-1], rgb(0x6d4a32))
    # The maze rails where skiers queue, low, in front.
    for x in (-1.6, 1.6):
        m.box((x, 1.6, 0.95), (0.06, 2.2, 0.06), rgb(YELLOW))
        for y in (0.6, 1.6, 2.6):
            m.box((x, y, 0.72), (0.06, 0.06, 0.45), rgb(STEEL_DARK))
    return m


def chair():
    m = Model('lift-chair')
    seat_colour = rgb(0x2f6fb5)
    # Grip on the rope, then the hanger down to the seat.
    m.box((0, 0, -0.08), (0.18, 0.4, 0.22), rgb(0x3a3f46))
    m.beam((0, 0, -0.15), (0, 0.15, -1.55), 0.07, rgb(STEEL))
    m.beam((-0.65, 0.15, -1.55), (0.65, 0.15, -1.55), 0.07, rgb(STEEL))
    for x in (-0.65, 0.65):
        m.beam((x, 0.15, -1.55), (x, 0.1, -2.1), 0.06, rgb(STEEL))
    # Seat, back and the bar, facing the game's +Z (Blender -Y).
    m.box((0, -0.15, -2.12), (1.45, 0.62, 0.1), seat_colour)
    m.box((0, 0.17, -1.8), (1.45, 0.08, 0.6), seat_colour, rot=(math.radians(-12), 0, 0))
    m.beam((-0.7, -0.45, -1.62), (0.7, -0.45, -1.62), 0.05, rgb(STEEL_DARK))
    m.beam((-0.7, 0.12, -1.6), (-0.7, -0.45, -1.62), 0.05, rgb(STEEL_DARK))
    m.box((0, -0.62, -2.5), (1.1, 0.25, 0.05), rgb(STEEL_DARK))
    return m


reset()
objs = [b().export(OUT) for b in (tower, station, chair)]
if PREVIEW:
    preview(objs, PREVIEW, ground=(0.92, 0.94, 0.96), sky=(0.79, 0.86, 0.92), spacing=7, scale=26)
