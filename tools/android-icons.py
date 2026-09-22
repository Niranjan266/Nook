"""
Every raster copy of the Nook mark — "two pebbles leaning together" — from one
set of numbers, so the web icons, the Android launcher icons, the splash
screens and the email logo can never drift apart.

    python tools/android-icons.py          (from the repo root)

The geometry is the one in client/public/logo.svg and the Android vector
drawables, on a 48-unit box:

    iris pebble   ellipse (19, 26) rx 13 ry 15      — the larger, in front
    volt pebble   ellipse (31, 22) rx 11 ry 13      — leaning in behind, 92%
    eyes          circles (16, 25) and (22, 25) r 2 — in the tile's colour

Drawn with PIL on a canvas 16x too big and shrunk with LANCZOS, which is the
antialiasing: PIL's own ellipses have hard, stair-stepped edges.

It also prints the single-colour "gap" path (the volt pebble with a sliver cut
away where it meets the iris one) used by logo-mono.svg and the themed /
notification icons, so those can be regenerated too if the shapes change.
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PUBLIC = os.path.join(ROOT, 'client', 'public')
RES = os.path.join(ROOT, 'client', 'android', 'app', 'src', 'main', 'res')

NIGHT = (0x0E, 0x0D, 0x14)
IRIS = (0x8B, 0x7C, 0xFF)
VOLT = (0xC8, 0xF5, 0x45)

IRIS_E = (19, 26, 13, 15)
VOLT_E = (31, 22, 11, 13)
EYES = [(16, 25, 2), (22, 25, 2)]
CENTRE = (24, 25)  # middle of the pair's bounding box (x 6..42, y 9..41)
GAP = 1.8  # the sliver between pebbles in the one-colour versions

SS = 16  # supersampling factor


def mark_layer(size, scale, cx, cy):
    """
    The mark alone on a transparent canvas of `size` px (already supersampled),
    with the 48-unit box scaled by `scale` and CENTRE placed at (cx, cy).
    """
    def box(ex, ey, rx, ry):
        x0 = cx + (ex - rx - CENTRE[0]) * scale
        y0 = cy + (ey - ry - CENTRE[1]) * scale
        return [x0, y0, x0 + 2 * rx * scale, y0 + 2 * ry * scale]

    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    volt = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    dv = ImageDraw.Draw(volt)
    dv.ellipse(box(*VOLT_E), fill=VOLT + (round(255 * 0.92),))
    out = Image.alpha_composite(out, volt)

    iris = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    di = ImageDraw.Draw(iris)
    di.ellipse(box(*IRIS_E), fill=IRIS + (255,))
    for ex, ey, r in EYES:
        # Painted in the tile's own night — what a hole would show anyway.
        di.ellipse(box(ex, ey, r, r), fill=NIGHT + (255,))
    out = Image.alpha_composite(out, iris)
    return out


def shrink(img, px):
    return img.resize((px, px), Image.LANCZOS)


def tile(px, shape='square', mark_scale=0.82, bg=NIGHT):
    """The mark on a night tile: rounded square, circle, or full bleed."""
    S = px * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if shape == 'square':
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 13 / 48, fill=bg + (255,))
    elif shape == 'round':
        d.ellipse([0, 0, S - 1, S - 1], fill=bg + (255,))
    else:
        d.rectangle([0, 0, S, S], fill=bg + (255,))
    scale = S / 48 * mark_scale
    img = Image.alpha_composite(img, mark_layer(S, scale, S / 2, S / 2))
    return shrink(img, px)


def save(img, path, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if mode:
        img = img.convert(mode)
    img.save(path, optimize=True)
    print(f'{os.path.relpath(path, ROOT)}  {img.size[0]}x{img.size[1]}')


# ── the web ────────────────────────────────────────────────────────────────
# Gmail and Outlook show no SVG, so the email header gets a PNG. 144px is
# 3x its 48px display size, sharp on any phone.
save(tile(144, 'square'), os.path.join(PUBLIC, 'email-logo.png'))

# ── Android launcher icons ─────────────────────────────────────────────────
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

# Adaptive foreground: 108 units of canvas, of which a launcher may show only
# a 66-diameter circle. The pair reaches ~18 units from its centre, so at
# x1.45 in 48-unit terms it sits ~26 from the middle — clear of any mask.
FG_SCALE = 1.45

for dpi, mult in DENSITIES.items():
    d = os.path.join(RES, f'mipmap-{dpi}')
    px = int(48 * mult)
    # Pre-adaptive launchers (Android 7.1 and older) apply no mask, so the
    # legacy icons carry their own tile.
    save(tile(px, 'square'), os.path.join(d, 'ic_launcher.png'))
    save(tile(px, 'round'), os.path.join(d, 'ic_launcher_round.png'))

    fpx = int(108 * mult)
    S = fpx * SS
    fg = mark_layer(S, S / 108 * FG_SCALE, S / 2, S / 2)
    save(shrink(fg, fpx), os.path.join(d, 'ic_launcher_foreground.png'))

# ── splash screens ─────────────────────────────────────────────────────────
# Night, with the mark centred at ~22% of the short side: big enough to be a
# greeting, small enough not to look like a loading error.
SPLASH = {
    'drawable': (480, 320),
    'drawable-land-mdpi': (480, 320),
    'drawable-land-hdpi': (800, 480),
    'drawable-land-xhdpi': (1280, 720),
    'drawable-land-xxhdpi': (1600, 960),
    'drawable-land-xxxhdpi': (1920, 1280),
    'drawable-port-mdpi': (320, 480),
    'drawable-port-hdpi': (480, 800),
    'drawable-port-xhdpi': (720, 1280),
    'drawable-port-xxhdpi': (960, 1600),
    'drawable-port-xxxhdpi': (1280, 1920),
}
for folder, (w, h) in SPLASH.items():
    img = Image.new('RGB', (w, h), NIGHT)
    mark_px = round(min(w, h) * 0.22)
    # The pair is 36 units wide in its 48 box; size the box so the pair
    # itself, not its empty margin, is the 22%.
    box_px = round(mark_px * 48 / 36)
    ss = 8
    S = box_px * ss
    m = shrink(mark_layer(S, S / 48, S / 2, S / 2), box_px)
    img.paste(m, ((w - box_px) // 2, (h - box_px) // 2), m)
    save(img, os.path.join(RES, folder, 'splash.png'))


# ── the one-colour gap path, for the SVG and the vector drawables ──────────
def ellipse_pt(e, t):
    ex, ey, rx, ry = e
    return ex + rx * math.cos(t), ey + ry * math.sin(t)


def inside(e, x, y):
    ex, ey, rx, ry = e
    return ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 - 1


def crossings(e, other):
    ts, n = [], 7200
    prev = inside(other, *ellipse_pt(e, 0))
    for i in range(1, n + 1):
        t = 2 * math.pi * i / n
        cur = inside(other, *ellipse_pt(e, t))
        if (prev < 0) != (cur < 0):
            lo, hi = 2 * math.pi * (i - 1) / n, t
            for _ in range(50):
                mid = (lo + hi) / 2
                if (inside(other, *ellipse_pt(e, lo)) < 0) == (inside(other, *ellipse_pt(e, mid)) < 0):
                    lo = mid
                else:
                    hi = mid
            ts.append((lo + hi) / 2)
        prev = cur
    return ts


def gap_path():
    """Volt pebble minus the iris pebble grown by GAP: two elliptical arcs."""
    d_e = (IRIS_E[0], IRIS_E[1], IRIS_E[2] + GAP, IRIS_E[3] + GAP)
    t1, t2 = crossings(VOLT_E, d_e)
    # Walk the volt edge the way that stays outside the grown iris.
    mid = (t1 + t2) / 2
    if inside(d_e, *ellipse_pt(VOLT_E, mid)) < 0:
        t1, t2 = t2, t1 + 2 * math.pi
    span = t2 - t1
    p1, p2 = ellipse_pt(VOLT_E, t1), ellipse_pt(VOLT_E, t2)
    large = 1 if span > math.pi else 0
    # Increasing t is clockwise on screen (y down), which is SVG sweep 1; the
    # way back along the grown iris runs the other way round the lens.
    f = lambda v: f'{v:.2f}'.rstrip('0').rstrip('.')
    return (
        f'M{f(p1[0])},{f(p1[1])} '
        f'A{VOLT_E[2]},{VOLT_E[3]} 0 {large} 1 {f(p2[0])},{f(p2[1])} '
        f'A{f(d_e[2])},{f(d_e[3])} 0 0 0 {f(p1[0])},{f(p1[1])} Z'
    )


def ellipse_path(ex, ey, rx, ry):
    return f'M{ex - rx},{ey} a{rx},{ry} 0 1 0 {2 * rx},0 a{rx},{ry} 0 1 0 {-2 * rx},0 Z'


print()
print('volt, gap cut :', gap_path())
print('iris          :', ellipse_path(*IRIS_E))
for ex, ey, r in EYES:
    print('eye           :', ellipse_path(ex, ey, r, r))
