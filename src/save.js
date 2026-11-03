// Saving and loading. The world is turned into plain JSON (dogs are referred
// to by id, form lines are packed into short arrays to keep the save small).
// serialize/deserialize have no DOM code; the storage helpers use localStorage.

import { ensureCups } from './cups.js';

const SAVE_KEY = 'greyhound-manager-save';
const SAVE_VERSION = 1;

const RUN_KEYS = ['day', 'trackId', 'distance', 'trap', 'grade', 'sectional', 'bends', 'pos', 'by', 'behind',
  'other', 'comments', 'time', 'winTime', 'going', 'calcTime', 'sp', 'fig'];

const packRun = (r) => RUN_KEYS.map((k) => (k === 'fig' ? +r.fig.toFixed(2) : r[k]));
const unpackRun = (a) => Object.fromEntries(RUN_KEYS.map((k, i) => [k, a[i]]));

function packDog(dog) {
  return { ...dog, runs: dog.runs.slice(0, 12).map(packRun) };
}

function packRace(race) {
  const out = { ...race, runners: race.runners.map(({ trap, dog }) => [trap, dog.id]) };
  if (race.result) {
    out.result = {
      winnerTime: race.result.winnerTime,
      results: race.result.results.map(({ events, ...r }) => ({ ...r, dog: r.dog.id })),
    };
  }
  return out;
}

export function serialize(world) {
  const tracks = {};
  for (const [id, ts] of Object.entries(world.tracks)) {
    const meetings = {};
    const today = ts.meetings[world.day];
    if (today) meetings[world.day] = { ...today, races: today.races.map(packRace) };
    tracks[id] = { ...ts, dogs: ts.dogs.map(packDog), meetings };
  }
  const sales = world.sales && { ...world.sales, items: world.sales.items.map((it) => ({ ...it, dog: it.kind === 'youngster' ? packDog(it.dog) : it.dog.id })) };
  const p = world.player;
  const player = {
    ...p,
    broods: (p.broods || []).map(packDog),
    studs: (p.studs || []).map(packDog),
    puppies: (p.puppies || []).map((x) => ({ ...x, dog: packDog(x.dog) })),
  };
  return JSON.stringify({ ...world, saveVersion: SAVE_VERSION, savedAt: Date.now(), tracks, sales, player });
}

export function deserialize(text) {
  const data = JSON.parse(text);
  if (data.saveVersion !== SAVE_VERSION) throw new Error('This save is from a different version of the game.');
  const byId = new Map();
  for (const ts of Object.values(data.tracks)) {
    ts.dogs = ts.dogs.map((d) => ({ ...d, runs: d.runs.map(unpackRun) }));
    for (const d of ts.dogs) byId.set(d.id, d);
  }
  for (const ts of Object.values(data.tracks)) {
    for (const m of Object.values(ts.meetings)) {
      for (const race of m.races) {
        race.runners = race.runners.map(([trap, id]) => ({ trap, dog: byId.get(id) }));
        if (race.result) race.result.results = race.result.results.map((r) => ({ ...r, dog: byId.get(r.dog) }));
      }
    }
  }
  if (data.sales) {
    data.sales.items = data.sales.items
      .map((it) => ({ ...it, dog: it.kind === 'youngster' ? { ...it.dog, runs: it.dog.runs.map(unpackRun) } : byId.get(it.dog) }))
      .filter((it) => it.dog);
  }
  const unpackDog = (d) => ({ ...d, runs: d.runs.map(unpackRun) });
  const p = data.player;
  p.broods = (p.broods || []).map(unpackDog);
  p.studs = (p.studs || []).map(unpackDog);
  p.puppies = (p.puppies || []).map((x) => ({ ...x, dog: unpackDog(x.dog) }));
  p.litters ||= [];
  // Saves from before competitions and news existed.
  data.trophies ||= [];
  data.news ||= [];
  data.cups ||= [];
  ensureCups(data);
  delete data.saveVersion;
  delete data.savedAt;
  return data;
}

// ---------------------------------------------------------------------------
// Browser storage

export function saveGame(world) {
  try {
    localStorage.setItem(SAVE_KEY, serialize(world));
    return true;
  } catch (err) {
    console.error('Could not save', err);
    return false;
  }
}

export function loadGame() {
  let text = null;
  try { text = localStorage.getItem(SAVE_KEY); } catch { return null; }
  if (!text) return null;
  try { return deserialize(text); } catch (err) { console.error('Could not load save', err); return null; }
}

export function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to do */ }
}

/** Download the save as a file, as a backup or to move to another computer. */
export function exportSave(world) {
  const blob = new Blob([serialize(world)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `greyhound-manager-${world.player.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-day${world.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importSave(file) {
  return deserialize(await file.text());
}
