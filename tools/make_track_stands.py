"""Draw the eight trackside sections (one per kind of venue) in pixel art, each
with a name board for the tracks that use it.

    python3 tools/make_track_stands.py

Writes  assets/sprites/track_stands/<section>_<track id>.png  (one per track)
        assets/sprites/track_stands/sponsors.png             (sponsor strip, no name)
        assets/source/track_stands_sheet.png                  (every section on magenta,
                                                               handy as a picture for Copilot)

Every picture has a see-through sky, a bottom edge that is trackside (the white
rail), and plain left/right edges so copies join up. Which track gets which
section is in SECTIONS below; which stands a track shows is "stands" in
data/tracks.json. To use better art (say from Copilot), replace the PNGs with
pictures of a similar size and keep the bottom edge at the rail.
"""
import json
import random
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'sprites' / 'track_stands'

# section -> the tracks (ids from data/tracks.json) whose name board it carries
SECTIONS = {
    'rail': ['centralpark', 'harlow'],
    'picket': ['kinsley', 'starpelaw'],
    'sponsors': ['romford'],
    'clubhouse': ['hove', 'nottingham'],
    'covered': ['doncaster', 'sunderland'],
    'steel': ['newcastle', 'sheffield'],
    'bleachers': ['oxford', 'yarmouth'],
    'garden': ['towcester', 'monmore', 'dunstallpark', 'valley'],
}
SPONSORS = [  # made-up names only
    ('SWIFTBET', (32, 92, 190), (255, 255, 255)),
    ('TRACKTECH', (30, 30, 36), (120, 220, 255)),
    ('DERBY DATA', (24, 120, 70), (255, 236, 120)),
    ('FLEETPAW', (240, 196, 30), (30, 30, 40)),
    ('VICTORY RAIL', (190, 30, 40), (255, 255, 255)),
]

# ---------------------------------------------------------------- palette
SKIN = [(238, 196, 160), (222, 172, 130), (196, 140, 100), (150, 100, 70), (104, 70, 50)]
HAIR = [(40, 30, 24), (70, 48, 30), (120, 84, 44), (200, 170, 100), (30, 30, 34), (150, 150, 150)]
SHIRTS = [(200, 50, 50), (60, 90, 170), (40, 140, 140), (230, 230, 230), (220, 190, 60),
          (70, 140, 70), (120, 70, 140), (210, 120, 50), (40, 50, 80), (150, 40, 60),
          (90, 160, 210), (110, 110, 120), (170, 200, 80), (60, 60, 70)]
WHITE = (236, 238, 242)
RAIL_SHADE = (160, 166, 178)
BASE = (58, 62, 78)
BASE_DARK = (36, 39, 52)
INSIDE = (34, 38, 56)
INSIDE_DARK = (24, 27, 40)
POLE = (72, 78, 92)
LAMP = (255, 246, 200)
LAMP_FRAME = (34, 36, 44)
GLOW = (255, 214, 120)

# ---------------------------------------------------------------- 5 x 7 pixel font
FONT = {
    'A': [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
    'B': ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
    'C': [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
    'D': ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
    'E': ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
    'F': ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
    'G': [' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ####'],
    'H': ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
    'I': [' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
    'J': ['  ###', '   # ', '   # ', '   # ', '#  # ', '#  # ', ' ##  '],
    'K': ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
    'L': ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
    'M': ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
    'N': ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
    'O': [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
    'P': ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
    'Q': [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
    'R': ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
    'S': [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
    'T': ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
    'U': ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
    'V': ['#   #', '#   #', '#   #', '#   #', ' # # ', ' # # ', '  #  '],
    'W': ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
    'X': ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
    'Y': ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
    'Z': ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
    '&': [' ##  ', '#  # ', '#  # ', ' ##  ', '# # #', '#  # ', ' ## #'],
    ' ': ['   '] * 7,
}
# A little running greyhound for the name boards (9 x 5).
DOG = ['        ###', '# ######## ', ' ######    ', ' #    #    ', '#      #   ']

DOG_W = len(DOG[0]) + 3


def text_width(s):
    return sum(len(FONT[c][0]) + 1 for c in s) - 1


def draw_text(img, x, y, s, colour, shadow=None):
    px = img.load()
    for c in s:
        g = FONT[c]
        for gy, row in enumerate(g):
            for gx, ch in enumerate(row):
                if ch == '#':
                    if shadow:
                        px[x + gx + 1, y + gy + 1] = shadow + (255,)
                    px[x + gx, y + gy] = colour + (255,)
        x += len(g[0]) + 1


def draw_dog(img, x, y, colour):
    px = img.load()
    for gy, row in enumerate(DOG):
        for gx, ch in enumerate(row):
            if ch == '#':
                px[x + gx, y + gy] = colour + (255,)


# ---------------------------------------------------------------- helpers
def box(d, x, y, w, h, c):
    if w > 0 and h > 0:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=c)


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def person(d, x, y, rng, seated=False, shirt=None):
    """A spectator: 2-pixel head at (x, y), 4-pixel-wide body below."""
    skin, hair = rng.choice(SKIN), rng.choice(HAIR)
    sh = shirt or rng.choice(SHIRTS)
    body = 2 if seated else 4
    box(d, x - 1, y + 2, 4, body, sh)
    box(d, x - 1, y + 2 + body - 1, 4, 1, shade(sh, 0.7))
    box(d, x + 2, y + 2, 1, body, shade(sh, 0.8))
    box(d, x, y, 2, 2, skin)
    if rng.random() < 0.7:
        box(d, x, y, 2, 1, hair)
    if not seated and rng.random() < 0.08:  # arm up, cheering
        box(d, x + 3, y - 1, 1, 3, skin)


def crowd(d, x0, y0, w, rows, rng, density=0.9, gap=4, row_h=4, seated=False, bg=None, step=None):
    """Rows of people from the back (top) to the front (bottom)."""
    for r in range(rows):
        y = y0 + r * row_h
        if bg:
            box(d, x0, y, w, row_h, bg if r % 2 else shade(bg, 0.85))
        if step:
            box(d, x0, y + row_h - 1, w, 1, step)
        x = x0 + 1 + (r % 2) * (gap // 2)
        while x < x0 + w - 3:
            if rng.random() < density:
                person(d, x + rng.randint(0, 1), y - 1 + rng.randint(0, 1), rng, seated)
            x += gap + (1 if rng.random() < 0.25 else 0)


def front_rail(d, w, h, base=BASE):
    """The white trackside rail and the low wall under it (bottom 7 pixels)."""
    box(d, 0, h - 4, w, 4, base)
    box(d, 0, h - 2, w, 2, shade(base, 0.7))
    box(d, 0, h - 7, w, 2, WHITE)
    box(d, 0, h - 5, w, 1, RAIL_SHADE)
    for x in range(4, w, 10):
        box(d, x, h - 7, 1, 5, WHITE)


def floodlight(d, x, top, bottom):
    """A pole from bottom up to a bank of six lamps at top (head is 10 x 7)."""
    box(d, x + 4, top + 7, 2, bottom - top - 7, POLE)
    box(d, x + 4, top + 7, 1, bottom - top - 7, shade(POLE, 1.3))
    box(d, x, top, 10, 7, LAMP_FRAME)
    for i in range(3):
        for j in range(2):
            box(d, x + 1 + i * 3, top + 1 + j * 3, 2, 2, LAMP)


def name_board(img, cx, y, name, bg=(240, 234, 214), fg=(150, 28, 36), frame=(40, 42, 54), dog=True):
    """A lit sign with the track's name, centred on cx. Returns its (x, y, w, h)."""
    d = ImageDraw.Draw(img)
    tw = text_width(name) + (DOG_W if dog else 0)
    w, h = tw + 8, 11
    x = cx - w // 2
    box(d, x - 1, y - 1, w + 2, h + 2, frame)
    box(d, x, y, w, h, bg)
    box(d, x, y + h - 1, w, 1, shade(bg, 0.85))
    tx = x + 4
    if dog:
        draw_dog(img, tx, y + 3, fg)
        tx += DOG_W
    draw_text(img, tx, y + 2, name, fg)
    return x - 1, y - 1, w + 2, h + 2


def new(w, h):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


# ---------------------------------------------------------------- the eight sections
def rail_section(name, rng):
    """Standing crowd packed against the rail, a low concourse building behind,
    and the track name on a big board on posts."""
    w, h = 240, 60
    img, d = new(w, h)
    top = h - 36
    # Concourse building: dark brick with lit windows
    box(d, 0, top, w, 16, (70, 50, 48))
    box(d, 0, top, w, 2, (110, 112, 124))
    for x in range(6, w - 8, 14):
        box(d, x, top + 5, 8, 5, (255, 214, 140))
        box(d, x, top + 9, 8, 1, (200, 150, 90))
    floodlight(d, 18, 2, top)
    floodlight(d, w - 30, 2, top)
    # Name board on two posts
    bx, by, bw, bh = name_board(img, w // 2, 6, name)
    box(d, bx + 6, by + bh, 2, top - by - bh, POLE)
    box(d, bx + bw - 8, by + bh, 2, top - by - bh, POLE)
    # Packed crowd standing on the concourse
    box(d, 0, top + 14, w, h - top - 14, (60, 62, 72))
    crowd(d, 0, top + 10, w, 6, rng, density=0.97, gap=3)
    front_rail(d, w, h)
    return img


def picket_section(name, rng):
    """A grassy bank behind a white picket fence, people standing in small groups."""
    w, h = 232, 50
    img, d = new(w, h)
    bank = 18
    for y in range(bank, h):
        k = 0.75 + 0.25 * (y - bank) / (h - bank)
        box(d, 0, y, w, 1, shade((52, 96, 56), k))
    # Trees on the skyline
    for tx in (8, 70, 150, 205):
        for (ox, oy, r) in ((0, 6, 7), (6, 2, 7), (12, 7, 6)):
            d.ellipse([tx + ox - r, bank - 6 + oy - r, tx + ox + r, bank - 6 + oy + r], fill=(30, 62, 40))
        d.ellipse([tx, bank - 12, tx + 8, bank - 6], fill=(42, 80, 50))
    box(d, 0, bank, w, 2, (64, 112, 66))
    floodlight(d, 40, 0, bank + 4)
    floodlight(d, 182, 0, bank + 4)
    # Little wooden hut with the name board
    box(d, 96, bank - 6, 40, 12, (120, 80, 50))
    box(d, 94, bank - 8, 44, 3, (80, 50, 34))
    box(d, 104, bank - 3, 8, 5, (255, 214, 140))
    box(d, 120, bank - 3, 8, 5, (255, 214, 140))
    name_board(img, 116, 2, name, bg=(250, 250, 246), fg=(28, 70, 40))
    # Spectators dotted over the bank
    for r in range(4):
        y = bank + 3 + r * 5
        x = 2 + rng.randint(0, 6)
        while x < w - 4:
            if rng.random() < 0.55:
                for _ in range(rng.randint(1, 3)):
                    if x < w - 4:
                        person(d, x, y + rng.randint(0, 1), rng)
                    x += 4
            x += rng.randint(4, 12)
    # Picket fence
    fy = h - 15
    box(d, 0, fy + 3, w, 1, WHITE)
    box(d, 0, fy + 6, w, 1, WHITE)
    for x in range(1, w, 3):
        box(d, x, fy + 1, 1, 7, WHITE)
        d.point((x, fy), fill=RAIL_SHADE)
    front_rail(d, w, h, base=(46, 76, 48))
    return img


def sponsors_section(name, rng):
    """A covered stand whose fascia is a row of (made-up) sponsor banners."""
    widths = [text_width(t) + 12 for t, _, _ in SPONSORS]
    w = sum(widths)
    h = 66
    img, d = new(w, h)
    roof = 16 if name else 6
    box(d, 0, roof, w, 3, (90, 96, 112))
    box(d, 0, roof + 3, w, 1, (50, 54, 66))
    # Banners
    x = 0
    for (t, bg, fg), bw in zip(SPONSORS, widths):
        box(d, x, roof + 4, bw, 11, bg)
        box(d, x, roof + 4, bw, 1, shade(bg, 1.25))
        box(d, x + bw - 1, roof + 4, 1, 11, shade(bg, 0.6))
        draw_text(img, x + 6, roof + 6, t, fg)
        x += bw
    inside = roof + 15
    box(d, 0, inside, w, h - inside, INSIDE)
    for x in range(0, w, 40):
        box(d, x + 20, inside, 18, 2, (255, 230, 160))  # roof lights
    crowd(d, 0, inside + 4, w, 9, rng, density=0.9, gap=4, seated=True,
          bg=(48, 52, 72), step=(80, 84, 100))
    for x in range(0, w, 60):
        box(d, x + 30, roof + 15, 2, h - roof - 22, (120, 126, 140))  # roof columns
    if name:
        floodlight(d, 14, 0, roof)
        floodlight(d, w - 24, 0, roof)
        bx, by, bw, bh = name_board(img, w // 2, 2, name, bg=(28, 32, 46), fg=(255, 255, 255))
        box(d, bx + 4, by + bh, 2, roof - by - bh, POLE)
        box(d, bx + bw - 6, by + bh, 2, roof - by - bh, POLE)
    front_rail(d, w, h)
    return img


def clubhouse_section(name, rng):
    """A two-storey brick clubhouse with a restaurant, and a terrace of tables
    with parasols in front."""
    w, h = 248, 74
    img, d = new(w, h)
    top, low = 16, 50
    brick, mortar = (128, 62, 50), (100, 48, 40)
    box(d, 0, top, w, low - top, brick)
    for y in range(top + 2, low, 3):
        box(d, 0, y, w, 1, mortar)
    box(d, 0, top - 3, w, 3, (220, 214, 200))  # parapet
    box(d, 0, top, w, 1, (90, 44, 36))
    # Restaurant windows with diners
    for x in range(6, w - 20, 26):
        box(d, x - 1, top + 4, 22, 13, (230, 226, 216))
        box(d, x, top + 5, 20, 11, (255, 220, 150))
        box(d, x, top + 13, 20, 3, (190, 120, 70))
        for px in range(x + 2, x + 18, 5):
            person(d, px, top + 9, rng, seated=True)
        box(d, x + 9, top + 5, 1, 11, (230, 226, 216))
    # Ground floor: glass doors
    box(d, 0, top + 20, w, low - top - 20, (60, 44, 40))
    for x in range(4, w - 6, 12):
        box(d, x, top + 22, 9, low - top - 22, (200, 170, 110))
    floodlight(d, 30, 0, top - 3)
    floodlight(d, w - 40, 0, top - 3)
    name_board(img, w // 2, 1, name, bg=(240, 234, 214), fg=(110, 28, 40))
    # Terrace with tables and parasols
    box(d, 0, low, w, h - low, (150, 140, 124))
    for y in range(low + 3, h, 4):
        box(d, 0, y, w, 1, (130, 120, 106))
    colours = [(200, 40, 50), (40, 90, 160), (40, 120, 70)]
    for i, x in enumerate(range(10, w - 12, 30)):
        c = colours[i % 3]
        y = low + 2 + (i % 2) * 2
        person(d, x - 3, y + 4, rng, seated=True)
        person(d, x + 5, y + 4, rng, seated=True)
        box(d, x - 4, y + 7, 12, 1, WHITE)  # table top
        box(d, x + 1, y - 2, 1, 9, (200, 200, 200))  # parasol pole
        for k in range(6):
            box(d, x + 1 - (6 - k), y - 8 + k, 2 * (6 - k) + 1, 1, c if k % 2 == 0 else WHITE)
    crowd(d, 0, h - 16, w, 2, rng, density=0.55, gap=5)
    front_rail(d, w, h)
    return img


def covered_section(name, rng):
    """A small covered terrace: green tin roof, standing steps, crush barriers."""
    w, h = 224, 58
    img, d = new(w, h)
    roof = 14
    green = (40, 92, 64)
    box(d, 0, roof, w, 6, green)
    for x in range(0, w, 3):
        box(d, x, roof, 1, 6, shade(green, 1.3))
    box(d, 0, roof + 6, w, 9, (30, 60, 44))
    box(d, 0, roof + 6, w, 1, (20, 40, 30))
    tw = text_width(name)
    for cx in (w // 4, 3 * w // 4):
        draw_text(img, cx - tw // 2, roof + 7, name, (250, 246, 230), shadow=(16, 30, 22))
    inside = roof + 15
    box(d, 0, inside, w, h - inside, INSIDE)
    floodlight(d, w // 2 - 5, 0, roof)
    # Stepped terracing with standing fans and crush barriers
    crowd(d, 0, inside + 2, w, 8, rng, density=0.85, gap=4, bg=(70, 72, 82), step=(110, 112, 120))
    for y in (inside + 12, inside + 24):
        box(d, 0, y, w, 1, (170, 176, 186))
        for x in range(8, w, 28):
            box(d, x, y, 1, 3, (170, 176, 186))
    for x in range(0, w, 56):
        box(d, x + 27, roof + 15, 2, h - roof - 22, (36, 74, 52))
    front_rail(d, w, h)
    return img


def steel_section(name, rng):
    """A big modern stand: steel roof truss, LED fascia, glass boxes, blue seats."""
    w, h = 264, 84
    img, d = new(w, h)
    roof = 10
    steel = (170, 176, 190)
    box(d, 0, roof + 3, w, 6, (40, 44, 58))
    box(d, 0, roof, w, 3, steel)
    box(d, 0, roof + 3, w, 1, (110, 116, 130))
    box(d, 0, roof + 8, w, 1, (110, 116, 130))
    for x in range(0, w, 8):  # zigzag truss
        d.line([(x, roof + 4), (x + 4, roof + 8), (x + 8, roof + 4)], fill=(140, 146, 160))
    for x in (30, 130, 230):  # floodlight banks on the roof
        box(d, x, 1, 24, 7, LAMP_FRAME)
        for i in range(7):
            box(d, x + 1 + i * 3 + (1 if i == 6 else 0), 2, 2, 2, LAMP)
            box(d, x + 1 + i * 3 + (1 if i == 6 else 0), 5, 2, 2, LAMP)
        box(d, x + 11, 8, 2, 2, POLE)
    # LED fascia
    led = roof + 9
    box(d, 0, led, w, 11, (14, 14, 20))
    tw = text_width(name) + DOG_W
    for cx in (w // 4 - 4, 3 * w // 4 + 4):
        draw_dog(img, cx - tw // 2, led + 3, (255, 176, 40))
        draw_text(img, cx - tw // 2 + DOG_W, led + 2, name, (255, 196, 60))
    # Glass hospitality boxes
    gb = led + 11
    box(d, 0, gb, w, 11, (52, 58, 74))
    for x in range(2, w - 2, 22):
        box(d, x, gb + 1, 20, 9, (90, 150, 190))
        box(d, x, gb + 1, 20, 2, (150, 200, 230))
        for px in range(x + 3, x + 18, 6):
            person(d, px, gb + 4, rng, seated=True)
        box(d, x, gb + 8, 20, 2, (200, 206, 216))
    # Seating bowl: blue seats, mostly full
    bowl = gb + 12
    crowd(d, 0, bowl, w, 11, rng, density=0.85, gap=4, seated=True,
          bg=(30, 70, 150), step=(20, 46, 100))
    for x in range(0, w, 66):  # aisles
        box(d, x + 33, bowl, 4, h - bowl - 7, (140, 144, 156))
        for y in range(bowl + 3, h - 7, 4):
            box(d, x + 33, y, 4, 1, (100, 104, 116))
    front_rail(d, w, h)
    return img


def bleachers_section(name, rng):
    """Open wooden bleachers with a painted wooden name board."""
    w, h = 232, 54
    img, d = new(w, h)
    top = 22
    # Wooden name board on two legs, floodlights at the sides
    bx, by, bw, bh = name_board(img, w // 2, 2, name, bg=(236, 222, 186), fg=(90, 52, 26), frame=(96, 60, 34))
    box(d, bx + 6, by + bh, 2, top - by - bh, (96, 60, 34))
    box(d, bx + bw - 8, by + bh, 2, top - by - bh, (96, 60, 34))
    floodlight(d, 20, 0, top)
    floodlight(d, w - 30, 0, top)
    # Benches: plank tops and dark risers
    for r in range(7):
        y = top + r * 4
        box(d, 0, y, w, 4, (78, 50, 32))
        box(d, 0, y + 2, w, 1, (176, 124, 72))
        box(d, 0, y + 3, w, 1, (140, 96, 56))
    for x in range(0, w, 24):
        box(d, x + 12, top, 1, h - top - 7, (60, 38, 24))
    crowd(d, 0, top - 2, w, 7, rng, density=0.6, gap=4, seated=True)
    front_rail(d, w, h, base=(80, 56, 38))
    return img


def garden_section(name, rng):
    """Beer garden and hospitality: marquees, a bar with the name board,
    strings of party lights, picnic benches."""
    w, h = 256, 60
    img, d = new(w, h)
    ground = 30
    box(d, 0, ground, w, h - ground, (54, 92, 56))
    for y in range(ground + 2, h, 3):
        box(d, 0, y, w, 1, (48, 84, 50))
    # Two marquees
    for mx in (6, 176):
        mw = 74
        box(d, mx, ground - 12, mw, 14, (236, 236, 230))
        for x in range(mx, mx + mw, 6):
            box(d, x + 5, ground - 12, 1, 14, (200, 200, 196))
        for k in range(8):  # peaked roof
            box(d, mx + k * 4, ground - 13 - k, mw - k * 8, 1, (248, 248, 244))
        box(d, mx + 8, ground - 8, mw - 16, 10, (255, 216, 150))  # lit inside
        for px in range(mx + 11, mx + mw - 10, 5):
            person(d, px, ground - 6, rng)
    # Bar hut in the middle with the name board on top
    hx, hw = 92, 72
    box(d, hx, ground - 14, hw, 16, (112, 74, 46))
    for y in range(ground - 12, ground + 2, 3):
        box(d, hx, y, hw, 1, (92, 60, 38))
    box(d, hx - 3, ground - 17, hw + 6, 3, (70, 44, 30))
    box(d, hx + 6, ground - 10, hw - 12, 7, (255, 210, 140))
    for px in range(hx + 9, hx + hw - 9, 7):
        person(d, px, ground - 8, rng)
    box(d, hx + 4, ground - 3, hw - 8, 2, (60, 40, 26))  # bar counter
    name_board(img, hx + hw // 2, 2, name, bg=(28, 30, 40), fg=(255, 210, 90), frame=(70, 44, 30))
    # Strings of party lights
    bulbs = [(255, 80, 80), (255, 220, 80), (110, 220, 110), (100, 170, 255), (255, 255, 230)]
    for (a, b) in ((0, hx - 2), (hx + hw + 2, w)):
        for i, x in enumerate(range(a, b)):
            t = (x - a) / max(1, b - a)
            y = 16 + int(6 * 4 * t * (1 - t))
            d.point((x, y), fill=(50, 50, 56))
            if (x - a) % 6 == 3:
                box(d, x, y + 1, 2, 2, bulbs[i % len(bulbs)])
    floodlight(d, 82, 0, ground)
    floodlight(d, 166, 0, ground)
    # Picnic benches and groups standing about
    for i, x in enumerate(range(8, w - 16, 32)):
        y = ground + 8 + (i % 2) * 3
        box(d, x, y + 4, 18, 2, (150, 100, 60))
        box(d, x + 2, y + 6, 1, 3, (110, 72, 42))
        box(d, x + 15, y + 6, 1, 3, (110, 72, 42))
        for px in (x + 2, x + 7, x + 12):
            if rng.random() < 0.8:
                person(d, px, y, rng, seated=True)
        for px in range(x + 21, x + 30, 4):
            if rng.random() < 0.5:
                person(d, px, y - 2 + rng.randint(0, 3), rng)
    box(d, 0, h - 10, w, 3, (38, 70, 40))  # low hedge
    for x in range(0, w, 4):
        box(d, x, h - 11, 2, 1, (46, 84, 48))
    front_rail(d, w, h, base=(46, 70, 46))
    return img


DRAW = {
    'rail': rail_section, 'picket': picket_section, 'sponsors': sponsors_section,
    'clubhouse': clubhouse_section, 'covered': covered_section, 'steel': steel_section,
    'bleachers': bleachers_section, 'garden': garden_section,
}


def main():
    tracks = {t['id']: t for t in json.loads((ROOT / 'data' / 'tracks.json').read_text())['tracks']}
    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for section, ids in SECTIONS.items():
        for tid in ids:
            name = tracks[tid]['name'].upper()
            img = DRAW[section](name, random.Random(f'{section}-{tid}'))
            path = OUT / f'{section}_{tid}.png'
            img.save(path)
            made.append((f'{section}_{tid}', img))
            print(f'{path.relative_to(ROOT)}  {img.width} x {img.height}')
    img = sponsors_section(None, random.Random('sponsors'))
    img.save(OUT / 'sponsors.png')
    made.append(('sponsors', img))
    print(f'assets/sprites/track_stands/sponsors.png  {img.width} x {img.height}')

    # One of each section on magenta, for reference (and for Copilot).
    first = [next(im for n, im in made if n.startswith(s)) for s in SECTIONS]
    gap = 12
    sheet = Image.new('RGBA', (2 * max(i.width for i in first) + 3 * gap,
                               4 * (max(i.height for i in first) + gap) + gap), (255, 0, 255, 255))
    rowh = max(i.height for i in first) + gap
    colw = max(i.width for i in first) + gap
    for k, im in enumerate(first):
        x, y = gap + (k % 2) * colw, gap + (k // 2) * rowh + (rowh - gap - im.height)
        sheet.alpha_composite(im, (x, y))
    sheet.convert('RGB').save(ROOT / 'assets' / 'source' / 'track_stands_sheet.png')


if __name__ == '__main__':
    main()
