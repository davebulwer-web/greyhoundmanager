# Notes for Claude

- Owner (Dave) does not program; explain changes in plain English and keep the game runnable with no build step (plain ES modules, served by any static server).
- This is an original game. Do not copy names, screens, text or data from Greyhound Manager 2; it is inspiration only. Tracks are the real licensed British tracks, named only by place (no logos, sponsors or stadium branding); competitions use the real race names without sponsors.
- Art must stay swappable: every image is listed in `assets/manifest.json` and documented in `ART_GUIDE.md`. Update both when adding art. Never hard-code sprite sizes in code.
- `src/sim.js` must stay free of DOM code so it runs in Node. After changing it, run `node tools/simtest.mjs 600` and check trap win rates (roughly 13-24% each), winning times (~27-28.5s for 450-460m; hurdle races, marked H, about 0.3-0.5s slower than flat over the same trip) and comment counts look sensible.
- Check visual changes with Playwright screenshots (`python3 -m http.server` then load the page).
- `src/world.js`, `src/market.js` and `src/betting.js` must also stay DOM-free. After changing them (or `data/*.json`), run `node tools/worldtest.mjs 80` and check favourites win roughly 33-40%, £1 on every runner returns about -15 to -25%, and grades stay roughly even.
- Editable data (dog names, trainer names, tracks) lives in `data/*.json`, each with a `_readme` key; don't move it back into code.
- `src/kennel.js` and `src/save.js` (serialize/deserialize) must stay DOM-free too. After changing them, run `node tools/kenneltest.mjs 90`: a kennel of cheap dogs should roughly break even, training should add a few points to the trained abilities, and the save must load back (save size well under 2 MB).
- Within a day dogs' abilities and fitness must not change (they change overnight in `advanceDay`), because races are worked out before they're shown and replays re-run them.
- `src/breeding.js`, `src/cups.js` and `src/commentary.js` are DOM-free too; `tools/kenneltest.mjs` also runs a season of breeding, competitions and ageing.
