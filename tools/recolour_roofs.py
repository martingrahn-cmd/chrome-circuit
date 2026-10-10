"""Red roofs for the Suburban Kit's houses.

The kit's atlas (assets/suburb/Textures/colormap.png) is a grid of colour
strips. The houses' green roofs sample the strip at u≈0.09, v 0.25–0.5, which
nothing else in the kit uses: the trees and planters take their greens from
other strips, and the walls sit lower in the same column. This turns that
one patch from green to brick red, keeping its light-to-dark gradient, so a
roof still shades the way the model was made to.

Run once, with Pillow:  python tools/recolour_roofs.py
Running it again changes nothing: the patch is no longer green.
"""
import colorsys
from PIL import Image

PATH = 'assets/suburb/Textures/colormap.png'
X0, X1, Y0, Y1 = 32, 64, 128, 256          # the roof patch, in pixels
RED_HUE = 0.012                            # brick, a touch towards orange

im = Image.open(PATH).convert('RGBA')
px = im.load()
changed = 0
for y in range(Y0, Y1):
    for x in range(X0, X1):
        r, g, b, a = px[x, y]
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if not (0.25 < h < 0.5 and s > 0.2):
            continue                       # only the greens
        r2, g2, b2 = colorsys.hsv_to_rgb(RED_HUE, min(1, s * 1.15), v * 0.92)
        px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
        changed += 1
im.save(PATH, optimize=True)
print(f'recoloured {changed} pixels')
