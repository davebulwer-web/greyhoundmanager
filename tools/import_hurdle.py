"""Turn Dave's Copilot hurdle (one brush hurdle on magenta) into the race-screen hurdle.

    python3 tools/import_hurdle.py

Reads   assets/source/hurdle_designer.png
Writes  assets/sprites/hurdle_designer.png

A flight of hurdles crosses the whole track, so on the race screen (seen from
the stand) it's a column of hurdle panels: one per lane, from the far side of
the track (top) down to the rail (bottom), nearer panels drawn over further ones.
The lane positions come from "raceView" in assets/manifest.json.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PANEL_HEIGHT = 14   # one panel's height on screen, in pixels (a greyhound's shoulder is about 24)
STEP = 9            # pixels between panels, top to bottom


def main():
    rgb = np.array(Image.open(ROOT / 'assets/source/hurdle_designer.png').convert('RGB')).astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    magenta = (r - g > 80) & (b - g > 80)
    ys, xs = np.where(~magenta)
    crop = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
    mask = ~magenta[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    crop[~mask] = (30, 30, 30)
    h = PANEL_HEIGHT
    w = round(crop.shape[1] * h / crop.shape[0])
    panel = Image.fromarray(crop.astype(np.uint8)).resize((w, h), Image.LANCZOS).convert('RGBA')
    alpha = Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS).point(lambda v: 255 if v >= 128 else 0)
    panel.putalpha(alpha)

    view = json.load(open(ROOT / 'assets/manifest.json'))['raceView']
    span = view['railLaneY'] - view['wideLaneY']
    height = span + h + 4
    strip = Image.new('RGBA', (w, height), (0, 0, 0, 0))
    for top in range(0, height - h + 1, STEP):
        strip.alpha_composite(panel, (0, top))
    strip.save(ROOT / 'assets/sprites/hurdle_designer.png')
    print('hurdle_designer.png', strip.size, f'manifest: "anchorX": {w // 2}, "bottom": {view["railLaneY"] + 4}')


if __name__ == '__main__':
    main()
