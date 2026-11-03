"""
Builds the recolourable greyhound art from ONE plain grey greyhound sheet
(Copilot sheet, dog on a magenta background, 8 frames in a row):

    python3 tools/import_grey_greyhound.py assets/source/greyhound_grey_designer.png [frames]

Pass the number of frames if the dogs in the sheet touch each other.

For the jump over a hurdle:

    python3 tools/import_grey_greyhound.py assets/source/greyhound_jump_designer.png 8 --jump --pick 3,4,5

--jump writes greyhound_coats_jump.png / jackets_coats_jump.png instead, and
--pick keeps only those frames (counting from 1), in that order.
--erase x0,y0,x1,y1 blanks out a box of the sheet first (e.g. a hurdle drawn under the dogs).

It writes two sheets that line up frame for frame:

  assets/sprites/greyhound_coats_run.png   one row per coat colour (tinted from the grey dog)
  assets/sprites/jackets_coats_run.png     one row per trap: jacket + number, fitted to each frame

The jackets and the black-and-white patches are worked out from the dog's own
outline in each frame, so they always sit exactly on the body.
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DOGS = os.path.join(ROOT, "assets", "sprites", "greyhound_coats_run.png")
OUT_JACKETS = os.path.join(ROOT, "assets", "sprites", "jackets_coats_run.png")

TARGET_BODY = 34     # length of the torso (shoulder to hip) in game pixels
OUTLINE_L = 70       # grey level below which a pixel counts as outline

# coat: (dark shade, base, highlight, outline)
COATS = {
    "black":       ((22, 20, 26), (44, 42, 50), (88, 86, 98), (8, 6, 10)),
    "blue":        ((62, 70, 88), (104, 112, 130), (156, 164, 180), (22, 24, 34)),
    "fawn":        ((150, 102, 60), (204, 156, 102), (238, 206, 160), (58, 36, 20)),
    "red-fawn":    ((130, 66, 34), (178, 102, 56), (220, 150, 100), (52, 24, 12)),
    "brindle":     ((92, 62, 36), (138, 98, 60), (178, 140, 96), (34, 22, 14)),
    "white-black": ((188, 184, 182), (232, 230, 226), (255, 255, 255), (30, 28, 32)),
}
COAT_ORDER = list(COATS)

# trap: (jacket colour, number colour, stripe colour or None)
JACKETS = [
    ((206, 34, 40), (255, 255, 255), None),
    ((36, 82, 206), (255, 255, 255), None),
    ((240, 240, 240), (20, 20, 20), None),
    ((28, 28, 30), (255, 255, 255), None),
    ((244, 132, 24), (20, 20, 20), None),
    ((28, 28, 30), (214, 36, 40), (236, 236, 236)),
]
DIGITS = {
    "1": ["0110", "1110", "0110", "0110", "0110", "1111"],
    "2": ["1110", "0011", "0110", "1100", "1000", "1111"],
    "3": ["1110", "0011", "0110", "0011", "0011", "1110"],
    "4": ["0011", "0111", "1011", "1111", "0011", "0011"],
    "5": ["1111", "1000", "1110", "0011", "0011", "1110"],
    "6": ["0111", "1100", "1110", "1011", "1011", "0110"],
}


def largest_component(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = []
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
                if len(pts) > len(best):
                    best = pts
    out = np.zeros_like(mask)
    for p in best:
        out[p] = True
    return out


def torso(mask):
    """Columns where the body is thick: returns (x_start, x_end, back_y) of the torso."""
    h = mask.shape[0]
    cols = []
    for x in range(mask.shape[1]):
        ys = np.nonzero(mask[:, x])[0]
        if len(ys) == 0:
            cols.append((x, 0, h)); continue
        top = ys[0]
        run = 0
        while top + run < h and mask[top + run, x]:
            run += 1
        cols.append((x, run, top))
    thick = max(c[1] for c in cols)
    body = [c for c in cols if c[1] >= thick * 0.5]
    x0, x1 = body[0][0], body[-1][0]
    back = int(np.median([c[2] for c in body]))
    return x0, x1, back


def find_frames(mask, expected=None):
    col = mask.sum(axis=0)
    if expected:
        # Dogs may touch (tail to nose), so cut at the thinnest column near
        # each evenly spaced boundary instead of looking for gaps.
        xs = np.nonzero(col > 2)[0]
        start, end = xs.min(), xs.max() + 1
        step = (end - start) / expected
        cuts = [start]
        for k in range(1, expected):
            c = int(start + k * step)
            w = int(step * 0.3)
            lo, hi = c - w, c + w
            cuts.append(lo + int(np.argmin(col[lo:hi])))
        cuts.append(end)
        return list(zip(cuts[:-1], cuts[1:]))
    segs, inside = [], False
    for x, v in enumerate(col):
        if v > 2 and not inside:
            inside, s = True, x
        if v <= 2 and inside:
            inside = False
            if x - s > 60:
                segs.append((s, x))
    return segs


def main():
    global OUT_DOGS, OUT_JACKETS
    args = [a for a in sys.argv[1:]]
    pick = None
    if "--pick" in args:
        i = args.index("--pick")
        pick = [int(v) - 1 for v in args[i + 1].split(",")]
        del args[i:i + 2]
    erase = None
    if "--erase" in args:
        i = args.index("--erase")
        erase = [int(v) for v in args[i + 1].split(",")]
        del args[i:i + 2]
    if "--jump" in args:
        args.remove("--jump")
        OUT_DOGS = OUT_DOGS.replace("_run.png", "_jump.png")
        OUT_JACKETS = OUT_JACKETS.replace("_run.png", "_jump.png")
    sys.argv[1:] = args
    src = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(int)
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    background = (r - g > 60) & (b - g > 60)
    fg = ~background
    if erase:
        ex0, ey0, ex1, ey1 = erase
        fg[ey0:ey1, ex0:ex1] = False
    fg[:, :4] = fg[:, -4:] = False
    fg[:4, :] = fg[-4:, :] = False
    expected = int(sys.argv[2]) if len(sys.argv) > 2 else None
    frames = find_frames(fg, expected)
    print("frames found:", len(frames), frames)
    if pick:
        frames = [frames[i] for i in pick]

    cuts = []
    for x0, x1 in frames:
        ys = np.nonzero(fg[:, x0:x1].any(axis=1))[0]
        y0, y1 = ys.min(), ys.max() + 1
        m = largest_component(fg[y0:y1, x0:x1])
        # trim to the dog itself (the frame strip can hold bits of its neighbours)
        mys, mxs = np.nonzero(m)
        m = m[mys.min():mys.max() + 1, mxs.min():mxs.max() + 1]
        rgb = src[y0 + mys.min():y0 + mys.max() + 1, x0 + mxs.min():x0 + mxs.max() + 1]
        tx0, tx1, back = torso(m)
        cuts.append((rgb, m, (tx0 + tx1) / 2, back, tx1 - tx0))

    body_len = np.median([c[4] for c in cuts])
    scale = TARGET_BODY / body_len
    # common box around (torso middle, back line)
    L = T = R = B = 0
    for _, m, cx, back, _ in cuts:
        ys, xs = np.nonzero(m)
        L = min(L, xs.min() - cx); R = max(R, xs.max() - cx)
        T = min(T, ys.min() - back); B = max(B, ys.max() - back)
    fw = int(np.ceil((R - L) * scale)) + 4
    fh = int(np.ceil((B - T) * scale)) + 3
    ax = int(round(-L * scale)) + 2
    back_y = int(round(-T * scale)) + 1
    print(f"scale {scale:.3f}  frame {fw}x{fh}")

    grey_frames = []
    for rgb, m, cx, back, _ in cuts:
        bw, bh = int(round(fw / scale)), int(round(fh / scale))
        big = np.zeros((bh, bw, 4))
        ox = int(round(ax / scale - cx)); oy = int(round(back_y / scale - back))
        h, w = m.shape
        big[oy:oy + h, ox:ox + w, :3] = rgb * m[..., None]
        big[oy:oy + h, ox:ox + w, 3] = m * 255
        img = Image.fromarray(big.clip(0, 255).astype(np.uint8))
        small = np.array(img.resize((fw, fh), Image.BOX)).astype(float)
        a = small[..., 3]
        with np.errstate(invalid="ignore", divide="ignore"):
            lum = np.where(a > 0, small[..., :3].mean(axis=2) * 255 / a, 0)
        grey_frames.append((lum, a > 100))

    # grey level range of the coat (ignoring outline) for normalising
    allv = np.concatenate([lum[mk & (lum > OUTLINE_L)] for lum, mk in grey_frames])
    lo, hi = np.percentile(allv, 3), np.percentile(allv, 97)

    paw_line = max(int(np.nonzero(mk.any(axis=1))[0].max()) for _, mk in grey_frames)

    n = len(grey_frames)
    dogs = np.zeros((fh * len(COATS), fw * n, 4), dtype=np.uint8)
    jackets = np.zeros((fh * 6, fw * n, 4), dtype=np.uint8)

    for i, (lum, mk) in enumerate(grey_frames):
        # outline: original dark pixels plus a 1px edge round the silhouette
        edge = mk & ~(np.roll(mk, 1, 0) & np.roll(mk, -1, 0) & np.roll(mk, 1, 1) & np.roll(mk, -1, 1))
        outline = mk & ((lum < OUTLINE_L) | edge)
        t = np.clip((lum - lo) / (hi - lo), 0, 1)
        t = np.round(t * 4) / 4  # 5 tones: crisp pixel-art shading

        tx0, tx1, back = torso(mk)
        tw = tx1 - tx0
        ys_all, xs_all = np.nonzero(mk)
        yy, xx = np.mgrid[0:fh, 0:fw]

        for c, name in enumerate(COAT_ORDER):
            shade, base, light, out_col = [np.array(v, float) for v in COATS[name]]
            col = np.where(t[..., None] < 0.5,
                           shade + (base - shade) * (t[..., None] / 0.5),
                           base + (light - base) * ((t[..., None] - 0.5) / 0.5))
            if name == "brindle":
                stripes = ((xx * 2 + yy) // 3) % 3 == 0
                col = np.where((stripes & (t > 0.2))[..., None], shade * 0.8, col)
            if name == "white-black":
                head = xx > tx1 + 2
                saddle = (xx > tx0 + tw * 0.3) & (xx < tx0 + tw * 0.65) & (yy < back + 5)
                patch = (head | saddle) & mk
                dark = np.array(COATS["black"][1], float) + (t[..., None] * 40)
                col = np.where(patch[..., None], dark, col)
            col = np.where(outline[..., None], out_col, col)
            tile = np.zeros((fh, fw, 4), dtype=np.uint8)
            tile[..., :3] = col.clip(0, 255).astype(np.uint8)
            tile[..., 3] = mk * 255
            dogs[c * fh:(c + 1) * fh, i * fw:(i + 1) * fw] = tile

        # jacket: covers the middle of the torso, from the back down to just above the belly
        jx0, jx1 = int(tx0 + tw * 0.24), int(tx0 + tw * 0.86)
        jmask = np.zeros_like(mk)
        runs = []
        for x in range(tx0, tx1 + 1):
            ys = np.nonzero(mk[:, x])[0]
            if len(ys):
                run = 0
                while ys[0] + run < fh and mk[ys[0] + run, x]:
                    run += 1
                runs.append(run)
        depth = np.percentile(runs, 35)  # body depth without the legs
        for x in range(jx0, jx1 + 1):
            ys = np.nonzero(mk[:, x])[0]
            if not len(ys):
                continue
            top = ys[0]; run = 0
            while top + run < fh and mk[top + run, x]:
                run += 1
            jmask[top:top + max(2, int(min(run, depth) * 0.85)), x] = True
        jedge = jmask & ~(np.roll(jmask, 1, 0) & np.roll(jmask, -1, 0) & np.roll(jmask, 1, 1) & np.roll(jmask, -1, 1))
        jy, jxs = np.nonzero(jmask)
        cx, cy = int(round(jxs.mean())), int(round(jy.mean()))
        for trap in range(6):
            jc, nc, stripe = [np.array(v, float) if v else None for v in JACKETS[trap]]
            tone = 0.72 + 0.4 * t
            col = jc * tone[..., None]
            if stripe is not None:
                band = ((xx - jx0) // 3) % 2 == 0
                col = np.where(band[..., None], stripe * tone[..., None], col)
            col = np.where(jedge[..., None], np.minimum(jc, 90) * 0.4, col)
            tile = np.zeros((fh, fw, 4), dtype=np.uint8)
            tile[..., :3] = col.clip(0, 255).astype(np.uint8)
            tile[..., 3] = jmask * 255
            # number panel
            glyph = DIGITS[str(trap + 1)]
            gx, gy = cx - 2, cy - 3
            if trap == 5:  # plain panel behind the number on the striped jacket
                tile[gy - 1:gy + 7, gx - 1:gx + 5, :3] = (236, 236, 236)
            for ry, row in enumerate(glyph):
                for rx, ch in enumerate(row):
                    if ch == "1" and 0 <= gy + ry < fh and 0 <= gx + rx < fw and jmask[gy + ry, gx + rx]:
                        tile[gy + ry, gx + rx, :3] = nc
            jackets[trap * fh:(trap + 1) * fh, i * fw:(i + 1) * fw] = tile

    Image.fromarray(dogs).save(OUT_DOGS)
    Image.fromarray(jackets).save(OUT_JACKETS)
    print("wrote", os.path.relpath(OUT_DOGS, ROOT), "and", os.path.relpath(OUT_JACKETS, ROOT))
    print(f'manifest: "frameWidth": {fw}, "frameHeight": {fh}, "frames": {n}, "anchorX": {ax}, "anchorY": {paw_line}')
    print("rows:", COAT_ORDER)


if __name__ == "__main__":
    main()
