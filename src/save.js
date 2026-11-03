// Saving and loading. The world is turned into plain JSON (dogs are referred
// to by id, form lines are packed into short arrays to keep the save small).
// serialize/deserialize have no DOM code; the storage helpers use localStorage.

import { ensureCups, cupById } from './cups.js';
import { TRACKS, trackById, raceDistance } from './track.js';
import { CLASSES, isMine } from './world.js';

const SAVE_KEY = 'greyhound-manager-save';
const SAVE_VERSION = 1;

const RUN_KEYS = ['day', 'trackId', 'distance', 'trap', 'grade', 'sectional', 'bends', 'pos', 'by', 'behind',
  'other', 'comments', 'time', 'winTime', 'going', 'calcTime', 'sp', 'fig', 'hurdles'];

const packRun = (r) => RUN_KEYS.map((k) => (k === 'fig' ? +r.fig.toFixed(2) : r[k]));
const unpackRun = (a) => Object.fromEntries(RUN_KEYS.map((k, i) => [k, a[i]]));

function packDog(dog, keepRuns = 12) {
  return { ...dog, runs: dog.runs.slice(0, keepRuns).map(packRun) };
}

const KEEP_TRACK_DAYS = 14; // tracks you haven't been to for this long are left out of the save
const KEEP_RECENT = 5;      // and at most this many other recently visited tracks are kept
const OTHER_TRACK_RUNS = 6; // form lines kept for dogs at tracks other than your own

/**
 * Which tracks go in the save. With 16 tracks a save holding all of them
 * would be large, so tracks you haven't visited lately are left out: they're
 * built again (with fresh form) the next time you go there.
 */
function tracksToKeep(world) {
  const keep = new Set([world.player.homeTrack]);
  const visited = (ts) => ts.lastVisitDay ?? ts.lastMeetingDay;
  Object.entries(world.tracks)
    .filter(([, ts]) => ts.meetings[world.day] || visited(ts) >= world.day - KEEP_TRACK_DAYS)
    .sort(([, a], [, b]) => visited(b) - visited(a))
    .slice(0, KEEP_RECENT)
    .forEach(([id]) => keep.add(id));
  for (const [id, ts] of Object.entries(world.tracks)) {
    // Tonight's meetings you've started (they hold your bets).
    if (ts.meetings[world.day]?.races.some((r) => r.result || r.bets?.length)) keep.add(id);
  }
  for (const inst of world.cups || []) {
    const cup = cupById(inst.cupId);
    if (cup && (inst.playerEntries.length || ['heats', 'semis', 'final'].includes(inst.stage))) keep.add(cup.trackId);
  }
  return keep;
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
  const keep = tracksToKeep(world);
  for (const [id, ts] of Object.entries(world.tracks)) {
    if (!keep.has(id)) continue;
    const meetings = {};
    const today = ts.meetings[world.day];
    if (today) meetings[world.day] = { ...today, races: today.races.map(packRace) };
    const runs = id === world.player.homeTrack ? 12 : OTHER_TRACK_RUNS;
    tracks[id] = { ...ts, dogs: ts.dogs.map((d) => packDog(d, runs)), meetings };
  }
  const sales = world.sales && { ...world.sales, items: world.sales.items.map((it) => ({ ...it, dog: it.kind === 'youngster' ? packDog(it.dog) : it.dog.id })) };
  const p = world.player;
  const player = {
    ...p,
    broods: (p.broods || []).map((d) => packDog(d)),
    studs: (p.studs || []).map((d) => packDog(d)),
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
  // Saves from before hurdles: every dog gets an ordinary jumping ability.
  const addJumping = (d) => {
    if (!d?.stats || d.stats.jumping !== undefined) return;
    d.stats.jumping = 50;
    if (d.potential) d.potential.jumping = 58;
  };
  const p = data.player;
  p.broods = (p.broods || []).map(unpackDog);
  p.studs = (p.studs || []).map(unpackDog);
  p.puppies = (p.puppies || []).map((x) => ({ ...x, dog: unpackDog(x.dog) }));
  p.litters ||= [];
  for (const ts of Object.values(data.tracks)) ts.dogs.forEach(addJumping);
  [...p.broods, ...p.studs, ...p.puppies.map((x) => x.dog)].forEach(addJumping);
  for (const l of p.litters) addJumping(l.sire);
  // Saves from before competitions and news existed.
  data.trophies ||= [];
  data.news ||= [];
  data.cups ||= [];
  moveToRealTracks(data);
  ensureCups(data);
  delete data.saveVersion;
  delete data.savedAt;
  return data;
}

// Early versions of the game had made-up tracks. A save from then moves your
// kennel to the real track most like your old one (same kinds of race).
const OLD_TRACKS = {
  kestrel: 'sheffield', marsh: 'romford', ashby: 'nottingham', harbour: 'hove',
  ravensgate: 'doncaster', eastholm: 'hove', brackwater: 'oxford', millbrook: 'sheffield',
  gullhaven: 'yarmouth', stonecross: 'doncaster', highmoor: 'newcastle', westcombe: 'hove',
  foxley: 'harlow', furnace: 'kinsley', pennant: 'doncaster', northgate: 'nottingham',
};

function moveToRealTracks(data) {
  const known = (id) => TRACKS.some((t) => t.id === id);
  const p = data.player;
  if (known(p.homeTrack)) return;
  const oldId = p.homeTrack;
  const newId = known(OLD_TRACKS[oldId]) ? OLD_TRACKS[oldId] : TRACKS[0].id;
  const track = trackById(newId);
  const fixRuns = (d) => {
    for (const r of d?.runs || []) if (!known(r.trackId)) r.trackId = OLD_TRACKS[r.trackId] || newId;
  };
  const home = data.tracks[oldId];
  for (const id of Object.keys(data.tracks)) if (!known(id)) delete data.tracks[id];
  if (home) {
    Object.assign(home, { trackId: newId, standards: {}, meetings: {}, lastMeetingDay: data.day - 1 });
    home.dogs = home.dogs.filter((d) => {
      d.homeTrack = newId;
      fixRuns(d);
      if (raceDistance(track, d.classKey)) return true;
      if (!isMine(d)) return false;
      // Your dog races in a kind of race the new track doesn't stage: it runs in ordinary races, from the bottom grade.
      d.classKey = 'standard';
      d.grade = CLASSES.standard.grades - 1;
      return true;
    });
    data.tracks[newId] = home;
  }
  p.homeTrack = newId;
  [...p.broods, ...p.studs, ...p.puppies.map((x) => x.dog)].forEach(fixRuns);
  for (const l of p.litters) fixRuns(l.sire);
  if (data.sales) {
    data.sales.items = data.sales.items.filter((it) => it.kind === 'youngster' || home?.dogs.includes(it.dog));
    data.sales.items.forEach((it) => { if (it.dog) { it.dog.homeTrack = newId; fixRuns(it.dog); } });
  }
  data.cups = data.cups.filter((c) => cupById(c.cupId));
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
