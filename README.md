# Greyhound Manager (working title)

An original greyhound racing management game for the browser, with detailed pixel art.
Train a kennel, study the form, bet, and watch the races unfold.

## Plan

1. **Race simulation** (this step): animated races with placeholder pixel art, live leaderboard and track map, results with form figures.
2. **Racecards, form and betting**: a pool of dogs and tracks, race history, form cards and odds.
3. **Your kennel**: buying dogs, training, entering races, money and a calendar, saved in the browser.
4. **Depth and polish**: breeding, grades and competitions, final art.

## Playing it

The game is plain HTML and JavaScript with no build step. Browsers will not load
the game's files straight from disk, so serve the folder with any local web server:

    python3 -m http.server 8000

then open <http://localhost:8000>. It also works on GitHub Pages
(Settings > Pages > deploy from the `main` branch).

## How it fits together

| Path | What it does |
|---|---|
| `src/sim.js` | The race engine. Works out the whole race up front from the dogs' hidden abilities, then hands back every dog's position for every 1/60th of a second plus the result and form comments. `TUNING` at the top holds the balance numbers. |
| `src/dogs.js` | Makes dogs: names, coat, sex, weight, running style and six hidden abilities. |
| `src/track.js` | Track shapes and distances. Add a new track here. |
| `src/raceView.js` | Draws the race from the engine's frames. |
| `src/minimap.js` | The top-down track map. |
| `src/main.js` | The test bench page that ties it together. |
| `assets/manifest.json` | Lists every image and how it is laid out. |
| `ART_GUIDE.md` | How to replace the placeholder art with your own. |
| `tools/simtest.mjs` | Runs hundreds of races with no graphics and prints balance numbers: `node tools/simtest.mjs 600` |
| `tools/make_placeholder_art.py` | Regenerates the placeholder art (needs Python and Pillow). |

## Hidden abilities

Each dog has six abilities from 0 to 100 that the player never sees directly:
break (speed out of the traps), early pace, top speed, stamina, cornering and
consistency, plus a preferred running line (railer, middle or wide). Races come
out of how these interact with the track, the trap draw and each other: crowding,
bumping, running wide on the bends and fading at the end of longer races.
