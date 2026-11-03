"""Turn Dave's Copilot grandstand and hoarding pictures into race-screen layers.

    python3 tools/import_background.py

Reads   assets/source/grandstand_designer.png  (one stand on a white background)
        assets/source/hoardings_designer.png   (a grid of advert boards on white)
Writes  assets/sprites/stand_designer.png      (STAND_HEIGHT pixels tall, transparent sky)
        assets/sprites/hoardings_designer.png  (one long strip of boards, BOARD_HEIGHT tall)

        assets/source/stands_sheet_designer.png (Dave's sheet of eight stands on black)
        assets/sprites/stand_<name>.png  (one per stand in STANDS, bottom edge = trackside)

Boards listed in SKIP are left out (they use real company names).
The corner stand (number 7 on the sheet) is left out: it's drawn at an angle.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'source'
OUT = ROOT / 'assets' / 'sprites'

STAND_HEIGHT = 64
END_TRIM = 0.035  # share of the stand's width cut off each end
BOARD_HEIGHT = 22
# Board grid in the source picture: column edges and row edges in source pixels.
COLS = [(2, 385), (388, 767), (770, 1155), (1158, 1533)]
ROWS = [(85, 170), (200, 288), (319, 407), (439, 532), (565, 656), (688, 781), (811, 903)]
# (row, column) of boards to leave out, counting from 0. These name real companies.
SKIP = {(1, 1), (1, 2), (2, 3), (4, 3)}  # Kennel Club, Freedom Leisure, Ladbrokes, Racing Post


# Stands on the sheet: name -> (left, top, right, bottom) box in source pixels,
# drawn tight above each stand's label so the label is left out.
STANDS = {
    'standard_a': (15, 10, 780, 207),
    'standard_b': (825, 10, 1515, 207),
    'heritage': (15, 262, 740, 505),
    'premium': (772, 243, 1530, 513),
    'terrace': (10, 560, 770, 740),
    'pavilion': (798, 560, 1530, 748),
    'tournament': (800, 780, 1490, 972),
}
STAND_SCALE = 0.33     # every stand is shrunk by the same amount, so big stands look big
STAND_MAX_HEIGHT = 84  # ...unless it would be taller than this
DARK = 45              # sheet pixels darker than this (R+G+B) that touch the edge are background
PURE_BLACK = 12        # and pixels this dark are background wherever they are (gaps in railings)


def background_mask(rgb, tol=40):
    bg = rgb[3:8, 3:8].reshape(-1, 3).mean(0)
    return np.abs(rgb.astype(int) - bg).sum(2) <= tol


def make_stand():
    im = Image.open(SRC / 'grandstand_designer.png').convert('RGB')
    rgb = np.array(im)
    bg = background_mask(rgb)
    ys, xs = np.where(~bg)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    # Trim the sloping end walls so copies of the stand join up into one long stand.
    trim = round((x1 - x0) * END_TRIM)
    x0, x1 = x0 + trim, x1 - trim
    crop = rgb[y0:y1, x0:x1].copy()
    mask = ~bg[y0:y1, x0:x1]
    # Fill the background with a dark colour so shrinking doesn't leave white halos.
    crop[~mask] = (30, 30, 40)
    w = round((x1 - x0) * STAND_HEIGHT / (y1 - y0))
    small = Image.fromarray(crop).resize((w, STAND_HEIGHT), Image.LANCZOS)
    alpha = Image.fromarray((mask * 255).astype(np.uint8)).resize((w, STAND_HEIGHT), Image.LANCZOS)
    alpha = alpha.point(lambda v: 255 if v >= 128 else 0)  # crisp pixel edges
    out = small.convert('RGBA')
    out.putalpha(alpha)
    out.save(OUT / 'stand_designer.png')
    print('stand_designer.png', out.size)


def edge_flood(dark):
    """Dark pixels joined to the edge of the box (the night sky around a stand)."""
    reached = np.zeros_like(dark)
    reached[0, :], reached[-1, :], reached[:, 0], reached[:, -1] = dark[0, :], dark[-1, :], dark[:, 0], dark[:, -1]
    while True:
        grown = reached.copy()
        grown[1:] |= reached[:-1]
        grown[:-1] |= reached[1:]
        grown[:, 1:] |= reached[:, :-1]
        grown[:, :-1] |= reached[:, 1:]
        grown &= dark
        if (grown == reached).all():
            return reached
        reached = grown


def make_stands():
    sheet = np.array(Image.open(SRC / 'stands_sheet_designer.png').convert('RGB'))
    for name, (x0, y0, x1, y1) in STANDS.items():
        rgb = sheet[y0:y1, x0:x1]
        level = rgb.astype(int).sum(2)
        bg = edge_flood(level <= DARK) | (level <= PURE_BLACK)
        ys, xs = np.where(~bg)
        rgb = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
        mask = ~bg[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        h = min(STAND_MAX_HEIGHT, round(rgb.shape[0] * STAND_SCALE))
        w = round(rgb.shape[1] * h / rgb.shape[0])
        rgb[~mask] = (20, 22, 32)
        small = Image.fromarray(rgb).resize((w, h), Image.LANCZOS)
        alpha = Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
        alpha = alpha.point(lambda v: 255 if v >= 128 else 0)
        out = small.convert('RGBA')
        out.putalpha(alpha)
        out.save(OUT / f'stand_{name}.png')
        print(f'stand_{name}.png', out.size)


def make_hoardings():
    im = Image.open(SRC / 'hoardings_designer.png').convert('RGB')
    # Interleave colours: blue, yellow, green, red, blue, ...
    by_col = [[im.crop((x0, y0, x1, y1)) for r, (y0, y1) in enumerate(ROWS) if (r, c) not in SKIP] for c, (x0, x1) in enumerate(COLS)]
    order = []
    for i in range(max(len(col) for col in by_col)):
        for col in by_col:
            if i < len(col):
                order.append(col[i])
    widths = []
    smalls = []
    for b in order:
        w = round(b.width * BOARD_HEIGHT / b.height)
        s = b.resize((w, BOARD_HEIGHT), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
        smalls.append(s)
        widths.append(w)
    gap = 1
    strip = Image.new('RGBA', (sum(widths) + gap * len(smalls), BOARD_HEIGHT), (20, 20, 26, 255))
    x = 0
    for s in smalls:
        strip.paste(s, (x, 0))
        x += s.width + gap
    strip.save(OUT / 'hoardings_designer.png')
    print('hoardings_designer.png', strip.size, f'{len(smalls)} boards')


if __name__ == '__main__':
    make_stand()
    make_hoardings()
    make_stands()
    sys.exit(0)
