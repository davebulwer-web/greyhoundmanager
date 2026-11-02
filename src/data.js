// Loads the editable game data in data/*.json (dog names, tracks, competitions).
// Works in the browser (fetch) and in Node (for the test tools), no DOM code.

import { setTracks } from './track.js';
import { setNames } from './dogs.js';
import { setCups } from './cups.js';

async function readJson(name) {
  if (typeof window === 'undefined') {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
  }
  const res = await fetch(`data/${name}`);
  if (!res.ok) throw new Error(`Could not load data/${name}`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`data/${name} has a typing mistake (${err.message})`);
  }
}

export async function loadGameData() {
  const [names, tracks, comps] = await Promise.all([readJson('names.json'), readJson('tracks.json'), readJson('competitions.json')]);
  setNames(names);
  setTracks(tracks.tracks);
  setCups(comps.cups);
  return { names, tracks: tracks.tracks, cups: comps.cups };
}
