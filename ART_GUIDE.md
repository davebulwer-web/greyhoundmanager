# Art guide

All the art in the game is **placeholder pixel art** made by a script. You can
replace any image with your own (for example, made with Copilot) and the game
picks it up straight away. No code changes needed.

## The rules

1. Keep the **same file name** in `assets/sprites/`.
2. Keep the **same size** in pixels, and the same grid of frames.
3. Use a **transparent background** (PNG with alpha) for everything except `sky.png` and `sand.png`.
4. Draw at 1x: one pixel in the file is one pixel in the game. The game scales
   everything up with sharp, blocky pixels, so do not pre-enlarge or blur your art.

If your new art is a different size, open `assets/manifest.json` and change the
numbers for that image (`frameWidth`, `frameHeight`, `frames`, `anchorX`, `anchorY`, or a layer's `y`).

The race screen is **640 x 240 pixels**. One metre of track is 16 pixels.

## The images

| File | Size | What it is |
|---|---|---|
| `greyhound_run.png` | 384 x 120 | Galloping greyhound. 8 frames across (48 x 24 each), one row per coat: black, blue, fawn, brindle, white & black. Dog faces right. |
| `jackets_run.png` | 384 x 144 | Racing jackets only, same 48 x 24 grid, one row per trap 1 to 6. Each jacket must sit exactly over the dog's body in the matching frame. |
| `hare.png` | 96 x 12 | The lure. 4 frames of 24 x 12. |
| `traps.png` | 80 x 116 | Starting traps seen side on. Frame 1 (left, 40 x 116) closed, frame 2 open. Trap 1 at the bottom. |
| `finish_post.png` | 24 x 48 | Winning post that stands on the far rail. |
| `sky.png` | 640 x 64 | Fixed sky behind everything. |
| `stand.png` | 320 x 64 | Grandstand and crowd. Repeats sideways, scrolls slower than the track. |
| `hoardings.png` | 384 x 18 | Advertising boards on the far rail. Repeats sideways. |
| `rail_far.png` | 32 x 12 | Outside running rail. Repeats sideways. |
| `sand.png` | 64 x 32 | Track surface. Repeats in both directions. |
| `rail_near.png` | 32 x 18 | Inside rail with the hare rail. Drawn in front of the dogs. |
| `grass.png` | 32 x 8 | Strip of grass at the bottom. Drawn in front. |

## Greyhounds with the jacket painted on

The game currently uses **`greyhound_trap_run.png`** (768 x 270): 12 frames of
64 x 45 across, one row per trap 1 to 6, with each dog already wearing its jacket.
It was made from Dave's sheet in `assets/source/` by:

    python3 tools/import_greyhound_sheet.py assets/source/greyhound_sheet_designer.png

That script cuts each dog out of the black background, lines every frame up on
the jacket so the body stays steady, shrinks it and adds an outline. Use it again
for a new sheet laid out the same way (6 rows, 12 dogs per row, black background).

In `assets/manifest.json`, `"rowsBy": "trap"` tells the game the jackets are
painted on, and `metresPerCycle` is how far a dog runs during one loop of the
frames (raise it if the legs look too fast). The older placeholder sheet with
separate jackets (`greyhound_run.png` + `jackets_run.png`, one row per coat
colour) still works: point the `greyhound` entry back at it with `"rowsBy": "coat"`.

## Greyhound frames (placeholder sheet)

The 8 frames are one full stride of a gallop, played in a loop, left to right:

- frames 1-2: legs gathering under the body
- frames 3-4: stretching out, front legs reaching forward
- frames 5-6: fully stretched, back legs pushing
- frames 7-8: coming back together

The **anchor** (24, 23) is the point the game places on the dog's position on the
track: the middle of the frame, on the bottom row where the paws touch the sand.
Keep the dog's body roughly centred in each frame and the paws on the bottom row,
so the dog does not jump about when frames change.

## Prompt tips for Copilot

Something like this works well as a starting point:

> Pixel art sprite sheet, side view of a racing greyhound galloping to the right,
> 8 animation frames in a single row, each frame 48 x 24 pixels, transparent background,
> clean 1 pixel dark outline, limited palette, wearing a basket muzzle, no jacket.

Ask for the jackets separately, on their own, so the same dog can run in any trap.
Then line the frames up on the grid in any image editor (Piskel, Aseprite or
LibreSprite are all good) and export as PNG.

## Getting the placeholders back

    python3 tools/make_placeholder_art.py

This overwrites the files in `assets/sprites/`, so keep a copy of your own art first.
