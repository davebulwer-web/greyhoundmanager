"""
Generates the PLACEHOLDER pixel art used by the game.

Every image is written to assets/sprites/ at the exact size the game expects
(see assets/manifest.json and ART_GUIDE.md). To use your own art, simply
replace a PNG with one of the same size and layout; you never need to run
this script again unless you want the placeholders back.

    python3 tools/make_placeholder_art.py            # write sprites
    python3 tools/make_placeholder_art.py --preview  # also write enlarged previews to tools/preview/
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "sprites")
PREVIEW = os.path.join(ROOT, "tools", "preview")
os.makedirs(OUT, exist_ok=True)

FW, FH = 48, 24     # greyhound frame size
FRAMES = 8          # frames in one gallop cycle

COATS = {
    #               base            shade          highlight
    "black":       ((38, 34, 40),   (18, 16, 22),  (78, 74, 86)),
    "blue":        ((96, 104, 122), (60, 66, 82),  (142, 150, 168)),
    "fawn":        ((206, 158, 104), (158, 110, 66), (236, 200, 150)),
    "brindle":     ((140, 98, 58),  (70, 46, 28),  (182, 140, 92)),
    "white-black": ((236, 232, 226), (176, 170, 166), (255, 255, 255)),
}
COAT_ORDER = ["black", "blue", "fawn", "brindle", "white-black"]

# Racing jacket colours for traps 1-6: (jacket, number colour, stripe colour or None)
JACKETS = [
    ((214, 40, 40), (255, 255, 255), None),
    ((40, 84, 210), (255, 255, 255), None),
    ((242, 242, 242), (20, 20, 20), None),
    ((24, 24, 24), (255, 255, 255), None),
    ((246, 140, 24), (20, 20, 20), None),
    ((24, 24, 24), (214, 40, 40), (242, 242, 242)),
]

OUTLINE = (14, 12, 16, 255)

# Tiny 3x5 digits for the trap numbers on the jackets
DIGITS = {
    "1": ["010", "110", "010", "010", "111"],
    "2": ["110", "001", "010", "100", "111"],
    "3": ["110", "001", "010", "001", "110"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "110", "001", "110"],
    "6": ["011", "100", "110", "101", "010"],
}


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


def skeleton(i):
    """Body landmarks for gallop frame i (0..FRAMES-1)."""
    p = i / FRAMES * 2 * math.pi
    f = math.sin(p)            # +1 fully stretched, -1 fully gathered
    bob = round(math.cos(p) * 0.8)
    hip = (14 - 1.6 * f, 10 + bob)
    shoulder = (31 + 1.4 * f, 10 + bob)
    return p, f, bob, hip, shoulder


def leg_points(top, upper_angle, lower_angle, upper_len, lower_len):
    a = (top[0] + math.sin(upper_angle) * upper_len, top[1] + math.cos(upper_angle) * upper_len)
    b = (a[0] + math.sin(lower_angle) * lower_len, a[1] + math.cos(lower_angle) * lower_len)
    return a, b


def draw_dog_frame(coat_name, i):
    base, shade, hi = COATS[coat_name]
    img = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    p, f, bob, hip, shoulder = skeleton(i)

    # ---- legs (far side first, darker) ------------------------------------
    def legs(far):
        col = rgba(shade if far else base)
        off = 0.55 if far else 0.0
        # front legs: reach forward when stretched, sweep back when gathered
        th = 0.95 * math.sin(p + off)
        lower = th + (-0.9 if math.cos(p + off) < 0 else 0.25)
        fx, fy = shoulder[0] + (1 if far else 0), shoulder[1] + 3
        k, foot = leg_points((fx, fy), th, lower, 5, 5)
        d.line([(fx, fy), k], fill=col, width=2)
        d.line([k, foot], fill=col, width=1)
        # hind legs: reach back when stretched, come forward under the body when gathered
        th2 = -1.05 * math.sin(p + off + 0.3)
        lower2 = th2 + (0.9 if math.cos(p + off + 0.3) > 0 else -0.2)
        hx, hy = hip[0] + (1 if far else 0), hip[1] + 3
        k2, foot2 = leg_points((hx, hy), th2, lower2, 6, 6)
        d.line([(hx, hy), k2], fill=col, width=3)
        d.line([k2, foot2], fill=col, width=1)
        # paws
        d.point([foot, foot2], fill=rgba(shade))

    legs(True)

    # ---- body --------------------------------------------------------------
    hx, hy = hip
    sx, sy = shoulder
    # hindquarters, tucked-up loin and deep chest
    d.ellipse([hx - 4, hy - 3, hx + 4, hy + 4], fill=rgba(base))
    d.polygon([(hx, hy - 3), (sx, sy - 3), (sx - 1, sy + 5), (hx + 6, hy + 0), (hx + 2, hy + 3)], fill=rgba(base))
    d.ellipse([sx - 5, sy - 3, sx + 3, sy + 6], fill=rgba(base))
    # long slim neck and narrow pointed head
    hdx, hdy = sx + 8, sy - 5 + round(-f * 0.6)
    d.polygon([(sx - 1, sy - 3), (hdx - 1, hdy - 1), (hdx + 1, hdy + 2), (sx + 3, sy + 2)], fill=rgba(base))
    d.polygon([(hdx - 2, hdy), (hdx + 1, hdy - 2), (hdx + 4, hdy - 1), (hdx + 8, hdy + 2),
               (hdx + 7, hdy + 3), (hdx - 1, hdy + 3)], fill=rgba(base))
    # small rose ear folded back
    d.line([(hdx, hdy - 1), (hdx - 2, hdy - 1)], fill=rgba(shade), width=1)
    # tail streaming behind
    tail = [(hx - 4, hy - 1), (hx - 8, hy + 1 - round(f)), (hx - 12, hy + 3 - round(f * 2))]
    d.line(tail, fill=rgba(base), width=1)

    # coat patterns
    if coat_name == "brindle":
        for x in range(int(hx - 4), int(sx + 4), 3):
            d.line([(x, hy - 2), (x + 1, hy + 4)], fill=rgba(shade))
    if coat_name == "white-black":
        d.ellipse([sx - 6, sy - 3, sx - 1, sy + 1], fill=rgba((30, 28, 32)))
        d.polygon([(hdx - 2, hdy), (hdx + 1, hdy - 2), (hdx + 4, hdy - 1), (hdx + 4, hdy + 3), (hdx - 1, hdy + 3)], fill=rgba((30, 28, 32)))

    # shading: belly shade, back highlight
    px = img.load()
    for x in range(FW):
        col_ys = [y for y in range(FH) if px[x, y][3] and px[x, y][:3] == base]
        if not col_ys:
            continue
        top, bottom = min(col_ys), max(col_ys)
        if bottom - top >= 3:
            px[x, top] = rgba(hi)
            px[x, bottom] = rgba(shade)

    # muzzle (racing dogs wear a light basket muzzle) and eye
    d.line([(hdx + 5, hdy + 1), (hdx + 7, hdy + 2)], fill=(214, 196, 150, 255))
    d.point([(hdx + 2, hdy)], fill=(10, 10, 10, 255))

    legs(False)
    return outline(img)


def outline(img):
    """Add a 1px dark outline around everything, the classic pixel art look."""
    w, h = img.size
    src = img.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3]:
                    dst[x, y] = OUTLINE
                    break
    out.alpha_composite(img)
    return out


def draw_jacket_frame(trap, i):
    colour, num_col, stripe = JACKETS[trap]
    img = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    p, f, bob, hip, shoulder = skeleton(i)
    hx, hy = hip
    sx, sy = shoulder
    poly = [(hx + 2, hy - 3), (sx - 1, sy - 3), (sx, sy + 3), (sx - 3, sy + 5), (hx + 5, hy + 3)]
    d.polygon(poly, fill=rgba(colour))
    if stripe:
        for x in range(int(hx + 3), int(sx), 3):
            d.line([(x, hy - 3), (x, hy + 4)], fill=rgba(stripe))
        d.polygon(poly, outline=None)
    # number panel
    cx = int((hx + sx) / 2) - 1
    cy = int(hy - 2)
    for ry, row in enumerate(DIGITS[str(trap + 1)]):
        for rx, ch in enumerate(row):
            if ch == "1":
                img.putpixel((cx + rx, cy + ry), rgba(num_col))
    # jacket edge
    d.line([(hx + 2, hy - 3), (sx - 1, sy - 3)], fill=rgba(tuple(max(0, c - 50) for c in colour)))
    return img


def sheet(frames_by_row):
    rows = len(frames_by_row)
    cols = len(frames_by_row[0])
    w, h = frames_by_row[0][0].size
    out = Image.new("RGBA", (cols * w, rows * h), (0, 0, 0, 0))
    for r, row in enumerate(frames_by_row):
        for c, fr in enumerate(row):
            out.paste(fr, (c * w, r * h), fr)
    return out


def make_hare():
    frames = []
    for i in range(4):
        img = Image.new("RGBA", (24, 12), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        stretch = [0, 2, 3, 1][i]
        body = (196, 176, 150)
        d.ellipse([5 - stretch // 2, 3, 16 + stretch // 2, 9], fill=rgba(body))
        d.ellipse([15 + stretch // 2, 2, 20 + stretch // 2, 6], fill=rgba(body))
        d.line([(17 + stretch // 2, 2), (14 + stretch // 2, 0)], fill=rgba(body), width=1)
        d.point([(19 + stretch // 2, 3)], fill=(20, 20, 20, 255))
        d.ellipse([3 - stretch // 2, 4, 6 - stretch // 2, 7], fill=(250, 250, 250, 255))
        legs = [[(7, 9), (4 - stretch, 11)], [(14, 9), (17 + stretch, 11)]]
        for l in legs:
            d.line(l, fill=rgba((150, 130, 108)), width=1)
        # the arm that carries the lure from the hare rail
        d.line([(10, 9), (10, 11)], fill=(90, 90, 96, 255))
        frames.append(outline(img))
    return sheet([frames])


def make_traps():
    """Starting traps seen from the side: 6 boxes stacked across the track."""
    W, H = 40, 116
    out = []
    for state in ("closed", "open"):
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle([2, 0, W - 3, H - 1], fill=(120, 124, 132, 255))
        d.rectangle([2, 0, W - 3, 5], fill=(150, 154, 162, 255))
        box_h = (H - 8) / 6
        for t in range(6):
            y0 = int(6 + (5 - t) * box_h)
            y1 = int(6 + (6 - t) * box_h) - 2
            d.rectangle([4, y0, W - 5, y1], fill=(70, 74, 82, 255))
            col, num, stripe = JACKETS[t]
            d.rectangle([6, y0 + 2, 13, y1 - 2], fill=rgba(col))
            for ry, row in enumerate(DIGITS[str(t + 1)]):
                for rx, ch in enumerate(row):
                    if ch == "1":
                        img.putpixel((8 + rx, y0 + 4 + ry), rgba(num if not stripe else (214, 40, 40)))
            if state == "closed":
                for x in range(16, W - 6, 3):
                    d.line([(x, y0 + 1), (x, y1 - 1)], fill=(190, 194, 200, 255))
            else:
                d.rectangle([16, y0, W - 6, y0 + 2], fill=(190, 194, 200, 255))
        out.append(outline(img))
    return sheet([out])


def make_finish_post():
    img = Image.new("RGBA", (24, 48), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([11, 16, 12, 47], fill=(230, 230, 230, 255))
    d.ellipse([2, 0, 21, 19], fill=(206, 32, 40, 255))
    d.ellipse([6, 4, 17, 15], fill=(250, 250, 250, 255))
    d.ellipse([9, 7, 14, 12], fill=(206, 32, 40, 255))
    return outline(img)


def make_sky():
    W, H = 640, 64
    img = Image.new("RGBA", (W, H))
    top, bottom = (24, 30, 62), (86, 96, 140)
    for y in range(H):
        t = y / (H - 1)
        band = round(t * 6) / 6  # banded gradient looks more "pixel"
        c = tuple(int(top[k] + (bottom[k] - top[k]) * band) for k in range(3))
        for x in range(W):
            img.putpixel((x, y), rgba(c))
    rnd = random.Random(4)
    for _ in range(40):
        img.putpixel((rnd.randrange(W), rnd.randrange(H // 2)), (220, 220, 240, 255))
    return img


def make_stand():
    """Grandstand with a crowd. Tiles horizontally."""
    W, H = 320, 64
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(7)
    # floodlight pylons
    for x in (40, 200):
        d.rectangle([x, 0, x + 2, 20], fill=(70, 72, 84, 255))
        d.rectangle([x - 6, 0, x + 8, 5], fill=(60, 62, 74, 255))
        for k in range(4):
            d.rectangle([x - 5 + k * 3, 1, x - 4 + k * 3, 3], fill=(255, 246, 200, 255))
    # roof
    d.polygon([(0, 14), (W, 14), (W, 20), (0, 20)], fill=(150, 40, 44, 255))
    d.line([(0, 14), (W, 14)], fill=(196, 70, 70, 255))
    # interior
    d.rectangle([0, 20, W, H - 1], fill=(46, 42, 54, 255))
    for x in range(0, W, 40):
        d.rectangle([x, 20, x + 1, H - 1], fill=(90, 86, 100, 255))
    # crowd: rows of heads and shoulders
    shirts = [(200, 60, 60), (60, 90, 200), (230, 220, 210), (60, 150, 90), (220, 180, 60), (120, 80, 150), (40, 40, 48)]
    skins = [(236, 196, 160), (198, 150, 110), (140, 96, 64), (90, 60, 40)]
    for row in range(6):
        y = 24 + row * 7
        for x in range(2 + (row % 2) * 2, W - 2, 4):
            if rnd.random() < 0.12:
                continue
            d.rectangle([x, y + 3, x + 2, y + 6], fill=rgba(rnd.choice(shirts)))
            d.rectangle([x, y, x + 1 + (rnd.random() < 0.5), y + 2], fill=rgba(rnd.choice(skins)))
    # front wall
    d.rectangle([0, H - 4, W, H - 1], fill=(110, 110, 120, 255))
    return img


def pixel_text(d, xy, text, fill, size=8):
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:
        font = ImageFont.load_default()
    d.fontmode = "1"
    d.text(xy, text, fill=fill, font=font)


def make_hoardings():
    W, H = 384, 18
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    boards = [
        ("TRAP SIX ODDS", (22, 70, 150), (255, 255, 255)),
        ("KENNEL KIBBLE", (240, 200, 40), (30, 30, 30)),
        ("FAST LANE BET", (30, 130, 70), (255, 255, 255)),
        ("PADDOCK PIES", (180, 40, 40), (255, 240, 200)),
    ]
    bw = W // len(boards)
    for k, (text, bg, fg) in enumerate(boards):
        x0 = k * bw
        d.rectangle([x0, 0, x0 + bw - 2, H - 1], fill=rgba(bg))
        d.rectangle([x0, 0, x0 + bw - 2, 1], fill=rgba(tuple(min(255, c + 40) for c in bg)))
        pixel_text(d, (x0 + 8, 4), text, rgba(fg), size=9)
    return img


def make_rail(near=False):
    W = 32
    H = 18 if near else 12
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if near:
        # inside rail plus the hare rail housing
        d.rectangle([0, 0, W, 3], fill=(236, 236, 236, 255))
        d.line([(0, 3), (W, 3)], fill=(170, 170, 178, 255))
        d.rectangle([4, 4, 5, 11], fill=(220, 220, 224, 255))
        d.rectangle([0, 10, W, 14], fill=(60, 62, 70, 255))
        d.line([(0, 10), (W, 10)], fill=(110, 112, 120, 255))
        d.rectangle([0, 15, W, H - 1], fill=(62, 140, 64, 255))
    else:
        d.rectangle([0, 1, W, 3], fill=(240, 240, 240, 255))
        d.line([(0, 4), (W, 4)], fill=(170, 170, 178, 255))
        d.rectangle([12, 4, 13, H - 1], fill=(220, 220, 224, 255))
        d.rectangle([0, H - 2, W, H - 1], fill=(62, 130, 62, 255))
    return img


def make_sand():
    W, H = 64, 32
    img = Image.new("RGBA", (W, H), rgba((198, 150, 96)))
    rnd = random.Random(11)
    px = img.load()
    for _ in range(260):
        x, y = rnd.randrange(W), rnd.randrange(H)
        px[x, y] = rgba(rnd.choice([(182, 134, 82), (214, 168, 112), (170, 124, 76)]))
    # raked lines
    for y in range(2, H, 8):
        for x in range(W):
            if (x + y) % 5:
                px[x, y] = rgba((186, 138, 86))
    return img


def make_grass():
    W, H = 32, 8
    img = Image.new("RGBA", (W, H), rgba((50, 122, 54)))
    rnd = random.Random(3)
    for _ in range(40):
        img.putpixel((rnd.randrange(W), rnd.randrange(H)), rgba(rnd.choice([(70, 150, 70), (40, 100, 44)])))
    return img


def make_hurdle():
    """A flight of hurdles seen from the stand: it crosses the track, so on the
    race screen it's a tall strip from the far lane (top) to the rail (bottom).
    Each brush panel leans towards the dogs coming at it (to the left)."""
    W, H = 14, 100
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(5)
    for top in range(0, H - 6, 9):
        # white frame leaning left, brush on top of it
        d.line([(9, top + 12), (4, top)], fill=rgba((236, 236, 236)), width=2)
        d.line([(11, top + 12), (11, top + 5)], fill=rgba((200, 200, 206)))
        for k in range(18):
            x = rnd.randint(3, 10)
            y = top + rnd.randint(0, 8)
            img.putpixel((x, y), rgba(rnd.choice([(92, 120, 54), (120, 98, 52), (70, 98, 44), (140, 120, 70)])))
    # dark base line where it meets the sand
    d.line([(4, H - 2), (12, H - 2)], fill=rgba((90, 70, 50)))
    return img


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT), img.size)
    return img


def main():
    preview = "--preview" in sys.argv
    dogs = sheet([[draw_dog_frame(c, i) for i in range(FRAMES)] for c in COAT_ORDER])
    jackets = sheet([[draw_jacket_frame(t, i) for i in range(FRAMES)] for t in range(6)])
    outputs = {
        "greyhound_run.png": dogs,
        "jackets_run.png": jackets,
        "hare.png": make_hare(),
        "traps.png": make_traps(),
        "finish_post.png": make_finish_post(),
        "sky.png": make_sky(),
        "stand.png": make_stand(),
        "hoardings.png": make_hoardings(),
        "rail_far.png": make_rail(False),
        "rail_near.png": make_rail(True),
        "sand.png": make_sand(),
        "grass.png": make_grass(),
        "hurdle.png": make_hurdle(),
    }
    for name, img in outputs.items():
        save(img, name)

    if preview:
        os.makedirs(PREVIEW, exist_ok=True)
        combo = dogs.copy()
        combo.alpha_composite(sheet([[jackets.crop((i * FW, (r % 6) * FH, (i + 1) * FW, (r % 6 + 1) * FH)) for i in range(FRAMES)] for r in range(5)]))
        bg = Image.new("RGBA", combo.size, (198, 150, 96, 255))
        bg.alpha_composite(combo)
        bg.resize((bg.width * 6, bg.height * 6), Image.NEAREST).save(os.path.join(PREVIEW, "dogs_with_jackets.png"))
        print("wrote preview")


if __name__ == "__main__":
    main()
