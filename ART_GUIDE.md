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
| `hurdle.png` | 14 x 100 | One flight of hurdles in hurdle races. It crosses the track, so on screen it's a tall strip from the far side (top) to the rail (bottom). Any size works: set `anchorX` and `bottom` in the manifest. |
| `sky.png` | 640 x 64 | Fixed sky behind everything. |
| `stand.png` | 320 x 64 | Grandstand and crowd. Repeats sideways, scrolls slower than the track. |
| `hoardings.png` | 384 x 18 | Advertising boards on the far rail. Repeats sideways. |
| `rail_far.png` | 32 x 12 | Outside running rail. Repeats sideways. |
| `sand.png` | 64 x 32 | Track surface. Repeats in both directions. |
| `rail_near.png` | 32 x 18 | Inside rail with the hare rail. Drawn in front of the dogs. |
| `grass.png` | 32 x 8 | Strip of grass at the bottom. Drawn in front. |

## Greyhounds (current art)

The game uses **`greyhound_coats_run.png`** (one row per coat: black, blue, fawn,
red fawn, brindle, white & black) and **`jackets_coats_run.png`** (one row per trap,
jacket and number), both 8 frames of 77 x 37. Both are made from ONE plain grey
Copilot dog on a magenta background, kept in `assets/source/`:

    python3 tools/import_grey_greyhound.py assets/source/greyhound_grey_designer.png

The tool cuts the dog out, lines the frames up on the body, shrinks it, tints it
to each coat colour and works out the jacket shape from the dog's outline in each
frame, so jackets and patches always fit. To add a coat colour, add it to `COATS`
in the tool, to `COATS` in `src/dogs.js` and to the `rows` list in the manifest.
The prompts used are in the project files (`art/copilot-greyhound-prompts.md`).

`metresPerCycle` in the manifest is how far a dog runs during one loop of the
frames: raise it if the legs look too fast.

Older art is kept in the manifest but not used: `greyhoundPainted` (Dave's first
sheet with jackets painted on, `"rowsBy": "trap"`, made by
`tools/import_greyhound_sheet.py`) and the generated placeholders. To switch,
rename the entry you want to `greyhound` (and its jacket entry to `jacket`).

## Hurdle races

`hurdle.png` is drawn at each flight. Dogs rise `jumpHeight` pixels (in the
manifest's `hurdle` entry) as they clear it, using their gallop frames. For
proper jumping art, add `greyhoundJump` and `jacketJump` entries to the
manifest's sprites, laid out like `greyhound` and `jacket` (one row per coat or
trap, frames from take-off to landing), and the game uses them over hurdles.
The Copilot prompts for both are in the project files
(`art/copilot-hurdle-prompts.md`).

## Grandstand and advert boards (current art)

The race background uses **`stand_designer.png`** (288 x 64, repeats sideways) and
**`hoardings_designer.png`** (one long strip of advert boards, 22 pixels tall).
Both are made from Dave's Copilot pictures in `assets/source/` by:

    python3 tools/import_background.py

The tool cuts the stand off its white background, trims the sloping end walls so
copies join into one long stand, and shrinks it to 64 pixels tall. For the boards
it cuts each one out of the grid, shrinks it to 22 pixels tall and lines them up
in a strip, alternating colours. Boards that name real companies (Kennel Club,
Freedom Leisure, Ladbrokes, Racing Post) are left out: see `SKIP` at the top of
the tool. If you make a new boards picture, keep the same 4 x 7 grid, or change
`COLS` and `ROWS` in the tool. The placeholders `stand.png` and `hoardings.png`
are still there; point the manifest back at them to use them.

## A different grandstand at each track

Dave's sheet of stands (`assets/source/stands_sheet_designer.png`) is cut up by
the same tool into one picture per stand:

| File | Stand |
|------|-------|
| `stand_standard_a.png` | Standard stand A (red roof) |
| `stand_standard_b.png` | Standard stand B (grey roof) |
| `stand_heritage.png` | Heritage stand |
| `stand_premium.png` | Premium stand |
| `stand_terrace.png` | Open terrace |
| `stand_pavilion.png` | Executive pavilion |
| `stand_tournament.png` | Tournament stand (added on competition nights) |

The corner stand on the sheet is left out because it's drawn at an angle.
The tool keys out the black background, leaves out the labels (each stand's box
is in `STANDS` at the top of the tool) and shrinks every stand by the same amount,
so big stands still look big (none taller than 84 pixels).

Each track picks its stands with `"stands"` in `data/tracks.json`, for example
`"stands": ["pavilion", "premium"]`. They are drawn side by side in that order,
bottoms lined up, and repeat along the straight. On competition nights the stand
named by `cupStand` in the manifest goes first. Stands can be any width and
height: to add one, put the PNG in `assets/sprites`, add a line under
`"stands"` in the manifest, and use its name in `tracks.json`. A track with no
`"stands"` uses `stand_designer.png`.

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
