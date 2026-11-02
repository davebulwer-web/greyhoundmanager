# Notes for Claude

- Owner (Dave) does not program; explain changes in plain English and keep the game runnable with no build step (plain ES modules, served by any static server).
- This is an original game. Do not copy names, screens, text or data from Greyhound Manager 2 or real tracks; it is inspiration only.
- Art must stay swappable: every image is listed in `assets/manifest.json` and documented in `ART_GUIDE.md`. Update both when adding art. Never hard-code sprite sizes in code.
- `src/sim.js` must stay free of DOM code so it runs in Node. After changing it, run `node tools/simtest.mjs 600` and check trap win rates (roughly 13-24% each), winning times (~27-28.5s for 450-460m) and comment counts look sensible.
- Check visual changes with Playwright screenshots (`python3 -m http.server` then load the page).
- `src/world.js`, `src/market.js` and `src/betting.js` must also stay DOM-free. After changing them (or `data/*.json`), run `node tools/worldtest.mjs 80` and check favourites win roughly 33-40%, £1 on every runner returns about -15 to -25%, and grades stay roughly even.
- Editable data (dog names, trainer names, tracks) lives in `data/*.json`, each with a `_readme` key; don't move it back into code.
