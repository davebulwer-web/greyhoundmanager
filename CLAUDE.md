# Notes for Claude

- Owner (Dave) does not program; explain changes in plain English and keep the game runnable with no build step (plain ES modules, served by any static server).
- This is an original game. Do not copy names, screens, text or data from Greyhound Manager 2 or real tracks; it is inspiration only.
- Art must stay swappable: every image is listed in `assets/manifest.json` and documented in `ART_GUIDE.md`. Update both when adding art. Never hard-code sprite sizes in code.
- `src/sim.js` must stay free of DOM code so it runs in Node. After changing it, run `node tools/simtest.mjs 600` and check trap win rates (roughly 13-24% each), winning times (~27-28.5s for 450-460m) and comment counts look sensible.
- Check visual changes with Playwright screenshots (`python3 -m http.server` then load the page).
