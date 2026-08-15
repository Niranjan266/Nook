"""
Legacy launcher icons, for Android 7.1 and older where adaptive icons do not
exist. These are flat square/round PNGs, so unlike the adaptive layers they
must include the rounded-square "room" themselves — there is no launcher mask
to supply a shape.

Rendered from the same geometry as the vectors so the two can never drift.
"""
import cairosvg, os

ROOM = '''
  <defs>
    <linearGradient id="clay" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#F6F1E9"/>
      <stop offset="0.55" stop-color="#EDE3D6"/>
      <stop offset="1" stop-color="#DCCDB9"/>
    </linearGradient>
    <!-- The alcove's own gradient, straight from logo.svg. -->
    <linearGradient id="alcove" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="#A9502F"/>
      <stop offset="1" stop-color="#C0603C"/>
    </linearGradient>
  </defs>'''

# The alcove, on the 108 canvas the vector drawables use.
MARK = '''
  <path d="M35,70.625 V37.375 a19,19 0 0 1 38,0 V70.625 Z" fill="url(#alcove)"/>
  <path d="M35,70.625 V37.375 a19,19 0 0 1 7.8375,-15.3188 l4.0375,5.7 A13.0625,13.0625 0 0 0 42.125,37.375 V70.625 Z" fill="#FFFFFF" fill-opacity="0.18"/>
  <path d="M35,65.875 h38 v4.75 h-38 Z" fill="#1E1A17" fill-opacity="0.18"/>'''

def svg(shape):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">{ROOM}
  {shape}
  {MARK}
</svg>'''

# A square icon still gets rounded corners by convention; a round one is a
# circle. Both are drawn at full bleed because the launcher does not mask
# these the way it masks adaptive layers.
SQUARE = '<rect x="4" y="4" width="100" height="100" rx="24" fill="url(#clay)"/>'
ROUND  = '<circle cx="54" cy="54" r="52" fill="url(#clay)"/>'

# Foreground-only, for the mipmap copies the generated project shipped.
FG     = ''

DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

for dpi, mult in DENSITIES.items():
    d = f'mipmap-{dpi}'
    os.makedirs(d, exist_ok=True)
    for name, shape, base in [
        ('ic_launcher', SQUARE, 48),
        ('ic_launcher_round', ROUND, 48),
        # The foreground is 108dp of canvas for 72dp of visible icon.
        ('ic_launcher_foreground', FG, 108),
    ]:
        px = int(base * mult)
        cairosvg.svg2png(bytestring=svg(shape).encode(),
                         write_to=f'{d}/{name}.png',
                         output_width=px, output_height=px)
        print(f'{d}/{name}.png  {px}x{px}')
