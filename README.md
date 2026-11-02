# Greyhound Manager (working title)

An original greyhound racing management game for the browser, with detailed pixel art.
Train a kennel, study the form, bet, and watch the races unfold.

## Plan

1. **Race simulation** (done): animated races with placeholder pixel art, live leaderboard and track map, results with form figures.
2. **Racecards, form and betting** (done): a pool of dogs and tracks, race history, form cards and odds.
3. **Your kennel** (this step): buying dogs, training, entering races, money and a calendar, saved in the browser.
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
| `src/track.js` | Track shapes (the tracks themselves are in `data/tracks.json`). |
| `src/world.js` | The racing world: each track's dogs and trainers, meetings every other night, grading, and every dog's form. |
| `src/market.js` | The bookmaker: prices each race from the form only (never the hidden abilities), plus forecast and tricast dividends. `MARKET` at the top holds its numbers. |
| `src/kennel.js` | Your kennel: buying and selling, training, fitness, kennel bills and moving the calendar on. `ECONOMY` and `TRAINING` at the top hold the numbers. |
| `src/save.js` | Saving in the browser, and save files to download or load. |
| `src/betting.js` | Bet types (win, each way, forecast, reverse forecast, tricast) and how they pay. |
| `data/names.json` | Words for dog names (first word, second word) and trainer names. Edit freely. |
| `data/tracks.json` | Every track: size, distances, how slow the sand rides. Edit or add tracks here. |
| `src/raceView.js` | Draws the race from the engine's frames. |
| `src/minimap.js` | The top-down track map. |
| `src/main.js` | The page: new game, racing, kennel, sales, calendar, accounts, saving, and the meeting screens. |
| `assets/manifest.json` | Lists every image and how it is laid out. |
| `ART_GUIDE.md` | How to replace the placeholder art with your own. |
| `tools/simtest.mjs` | Runs hundreds of races with no graphics and prints balance numbers: `node tools/simtest.mjs 600` |
| `tools/worldtest.mjs` | Runs months of racing with no graphics and checks the form and betting market: `node tools/worldtest.mjs 80` |
| `tools/kenneltest.mjs` | Runs a kennel for three months with no graphics and checks money, training and saving: `node tools/kenneltest.mjs 90` |
| `tools/make_placeholder_art.py` | Regenerates the placeholder art (needs Python and Pillow). |

## Hidden abilities

Each dog has six abilities from 0 to 100 that the player never sees directly:
break (speed out of the traps), early pace, top speed, stamina, cornering and
consistency, plus a preferred running line (railer, middle or wide). Races come
out of how these interact with the track, the trap draw and each other: crowding,
bumping, running wide on the bends and fading at the end of longer races.

## Editing names and tracks

Open `data/names.json` or `data/tracks.json` in any text editor (GitHub's own
editor is fine). Each file starts with a `_readme` line saying what every value means.

- **Names**: a dog's name is one word from `firstWords` then one from `secondWords`.
  Dogs from the same kennel share their first word, like a family name, so
  litter mates come out as "Tinker's Comet" and "Tinker's Echo".
- **Tracks**: copy a whole `{ ... }` block to add a track. Distances are
  `[sprint, standard, stayers, marathon]`.

Keep the quotes, commas and brackets as they are. If the game says a file has a
typing mistake, it is usually a missing comma or an extra one after the last item.

## How a meeting works

Each track has its own pool of about 200 greyhounds in sprint (D), standard (A)
and stayers (S) grades. Tracks race every other night, ten races a meeting,
weakest race first. Before the game starts, five weeks of racing are run in the
background so every dog has form. Winners go up a grade; dogs beaten into 4th or
worse twice running (once 5th or 6th) go down. The bookmaker prices each race
from recent times against the track standard and the trap draw, so a dog with
hidden ability the form has not shown yet can be a big price.


## Your kennel

You pick a kennel name and a home track, and start with £1,500 and one modest dog.

- **Buy a dog**: new dogs come up every week. Youngsters come from breeders with two
  trial runs at your track; raced dogs come with their full form. Prices are set
  from what can be seen (trial times or grade), never the hidden abilities.
- **Racing**: entered dogs are put into a race at your track's next meeting once
  they've had five days' rest. Every runner earns a £25 appearance fee, and the
  first three win prize money that is bigger in better grades.
- **Training and fitness**: racing costs fitness; dogs get it back each day, fastest
  on Rest. Special training (trap work, gallops, distance, bends, schooling) slowly
  raises those abilities up to each dog's hidden natural limit, but dogs recover
  more slowly while on it. A dog below 60 fitness runs a little slower.
- **Bills**: £4 a day per dog, plus £2 a day for special training.
- **Saving**: the game saves itself in the browser after every race and every day.
  *Save & load* lets you download a save file as a backup and load it back.
