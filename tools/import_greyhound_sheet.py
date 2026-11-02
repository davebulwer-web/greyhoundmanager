"""
Turns a big painted greyhound sprite sheet (dogs on a black background, one
row per trap, 12 frames across) into the small, clean game sprite sheet
assets/sprites/greyhound_trap_run.png.

    python3 tools/import_greyhound_sheet.py assets/source/greyhound_sheet_designer.png

What it does, for each dog in the sheet:
  1. cuts it out from the black background and drops the painted floor shadow
     (the game draws its own shadow);
  2. lines every frame up on the racing jacket, so the body stays steady while
     the legs move;
  3. shrinks it to game size, snaps it to a small colour palette and adds a
     1 pixel dark outline so it reads as pixel art.

The layout settings below match the sheet supplied on 2 Nov 2026. A new sheet
with a different layout needs BANDS (and maybe FRAMES) updated.
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "sprites", "greyhound_trap_run.png")

# Vertical band of each trap row. Frames are found by locating each jacket.
BANDS = [(120, 214), (240, 340), (362, 470), (496, 598), (618, 732), (755, 856)]
FRAMES = 12
SCALE = 0.42          # how much to shrink the painted dogs
PALETTE_COLOURS = 28  # colours per trap row after shrinking
OUTLINE = (14, 12, 16, 255)


def jacket_mask(row, px):
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    if row == 0:  # red
        return (r > 110) & (g < 70) & (b < 80)
    if row == 1:  # blue
        return (b > 120) & (r < 90) & (b - r > 60)
    if row == 2:  # white on a fawn dog
        return (r > 190) & (g > 190) & (b > 185)
    if row == 3:  # black jacket on a brindle dog: dark and neutral
        return (px.max(axis=2) < 38) & (np.abs(r - b) < 8) & (px.sum(axis=2) > 20)
    if row == 4:  # orange
        return (r > 190) & (g > 80) & (g < 160) & (b < 60)
    return (r > 170) & (g > 170) & (b > 170)  # white stripes on trap 6


def components(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not seen[y, x]:
                q = deque([(y, x)]); seen[y, x] = True; pts = []
                while q:
                    cy, cx = q.popleft(); pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                                seen[ny, nx] = True; q.append((ny, nx))
                comps.append(pts)
    return comps


def find_jackets(img, row):
    """x position of each racing jacket along a row, left to right."""
    y0, y1 = BANDS[row]
    band = img[y0:y1].astype(int)
    xs = np.nonzero(jacket_mask(row, band) & (band.sum(axis=2) >= 40))[1]
    cols = np.bincount(xs, minlength=band.shape[1])
    groups, cur = [], []
    for x in np.nonzero(cols > 1)[0]:
        if cur and x - cur[-1] > 12:
            groups.append(cur); cur = []
        cur.append(x)
    if cur: groups.append(cur)
    groups = [g for g in groups if cols[g].sum() > 40]
    return [int(np.average(g, weights=cols[g])) for g in groups]


def cut_out(img, row, centre, prev_c, next_c):
    y0, y1 = BANDS[row]
    # the dog's tail reaches about 70px behind its jacket and its nose about 60px ahead
    x0 = max(0, centre - 75, (prev_c + 60) if prev_c else 0)
    x1 = min(img.shape[1], centre + 68, (next_c - 70) if next_c else img.shape[1])
    cell = img[y0:y1, x0:x1].astype(int)
    fg = cell.sum(axis=2) >= 40
    r, g, b = cell[..., 0], cell[..., 1], cell[..., 2]
    shadow = (cell.max(axis=2) < 44) & (r >= g) & (g >= b) & (r - b >= 6)
    fg &= ~shadow
    comps = sorted(components(fg), key=len, reverse=True)
    main = comps[0]
    ys = [p[0] for p in main]; xs = [p[1] for p in main]
    by0, by1, bx0, bx1 = min(ys), max(ys), min(xs), max(xs)
    keep = np.zeros_like(fg)
    for comp in comps:
        if len(comp) < 6:
            continue
        cy = sum(p[0] for p in comp) / len(comp); cx = sum(p[1] for p in comp) / len(comp)
        cys = [p[0] for p in comp]; cxs = [p[1] for p in comp]
        inside = by0 <= min(cys) and max(cys) <= by1 and bx0 + 3 <= min(cxs) and max(cxs) <= bx1 - 3
        if comp is main or inside:
            for p in comp:
                keep[p] = True
    jm = jacket_mask(row, cell) & keep
    jy, jx = np.nonzero(jm)
    if len(jx) < 10:
        jy, jx = np.nonzero(keep)
    anchor = (jx.mean(), jy.mean())
    rgba = np.zeros((cell.shape[0], cell.shape[1], 4), dtype=np.uint8)
    rgba[..., :3] = cell
    rgba[..., 3] = keep * 255
    return rgba, anchor


def add_outline(img):
    a = np.array(img)
    alpha = a[..., 3] > 0
    grown = np.zeros_like(alpha)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        grown |= np.roll(np.roll(alpha, dy, 0), dx, 1)
    edge = grown & ~alpha
    a[edge] = OUTLINE
    return Image.fromarray(a)


def main():
    src = sys.argv[1]
    img = np.array(Image.open(src).convert("RGB"))
    cuts = []
    for r in range(len(BANDS)):
        cs = find_jackets(img, r)
        print("row", r + 1, "jackets at", cs)
        assert len(cs) == FRAMES, f"expected {FRAMES} dogs in row {r + 1}, found {len(cs)}"
        cuts.append([cut_out(img, r, c, cs[i - 1] if i else None, cs[i + 1] if i + 1 < len(cs) else None)
                     for i, c in enumerate(cs)])

    # Common box around the jacket anchor that fits every frame.
    left = top = right = bottom = 0
    for row in cuts:
        for rgba, (ax, ay) in row:
            ys, xs = np.nonzero(rgba[..., 3])
            left = min(left, xs.min() - ax); right = max(right, xs.max() - ax)
            top = min(top, ys.min() - ay); bottom = max(bottom, ys.max() - ay)

    fw = int(np.ceil((right - left) * SCALE)) + 4
    fh = int(np.ceil((bottom - top) * SCALE)) + 3
    anchor_x = int(round(-left * SCALE)) + 2
    anchor_y_jacket = int(round(-top * SCALE)) + 1
    print("frame", fw, fh, "jacket anchor", anchor_x, anchor_y_jacket)

    big_w = int(round(fw / SCALE)); big_h = int(round(fh / SCALE))
    sheet = Image.new("RGBA", (fw * FRAMES, fh * len(BANDS)), (0, 0, 0, 0))
    for r, row in enumerate(cuts):
        frames = []
        for rgba, (ax, ay) in row:
            canvas = Image.new("RGBA", (big_w, big_h), (0, 0, 0, 0))
            ox = int(round(anchor_x / SCALE - ax)); oy = int(round(anchor_y_jacket / SCALE - ay))
            canvas.alpha_composite(Image.fromarray(rgba), (ox, oy))
            # premultiplied box shrink, then hard alpha for crisp pixel edges
            arr = np.array(canvas).astype(float)
            arr[..., :3] *= arr[..., 3:4] / 255
            small = Image.fromarray(arr.clip(0, 255).astype(np.uint8)).resize((fw, fh), Image.BOX)
            s = np.array(small).astype(float)
            alpha = s[..., 3]
            with np.errstate(invalid="ignore", divide="ignore"):
                s[..., :3] = np.where(alpha[..., None] > 0, s[..., :3] * 255 / alpha[..., None], 0)
            s[..., 3] = np.where(alpha > 110, 255, 0)
            frames.append(Image.fromarray(s.clip(0, 255).astype(np.uint8)))
        # one shared palette per row keeps colours steady from frame to frame
        strip = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f, (i * fw, 0))
        rgb = strip.convert("RGB").quantize(colors=PALETTE_COLOURS, method=Image.Quantize.MEDIANCUT).convert("RGBA")
        q = np.array(rgb); q[..., 3] = np.array(strip)[..., 3]
        q[q[..., 3] == 0] = 0
        for i in range(len(frames)):
            f = add_outline(Image.fromarray(q[:, i * fw:(i + 1) * fw].copy()))
            sheet.paste(f, (i * fw, r * fh))

    sheet.save(OUT)
    # paw line: lowest opaque pixel across all frames
    alpha = np.array(sheet)[..., 3]
    rows_used = [max(np.nonzero(alpha[r * fh:(r + 1) * fh].any(axis=1))[0]) for r in range(len(BANDS))]
    info = {"frameWidth": fw, "frameHeight": fh, "frames": FRAMES, "anchorX": anchor_x, "anchorY": int(max(rows_used))}
    print("wrote", os.path.relpath(OUT, ROOT), sheet.size, json.dumps(info))


if __name__ == "__main__":
    main()
