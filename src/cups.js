// Competitions: once a season each cup in data/competitions.json is run at its
// track as heats, semi-finals and a final. No DOM code here.
//
// Round sizes: 24 dogs -> 4 heats of 6 -> first 3 go through -> 2 semis of 6
// -> first 3 go through -> final of 6.

import { makeRng } from './rng.js';
import { TRACKS, trackById } from './track.js';

export const SEASON_DAYS = 120;
export const CUPS = [];
export const ROUND_GAP = 6; // days between heats, semis and final
const HEATS = 4;
export const CUP_SIZE = HEATS * 6;

export function setCups(list) {
  CUPS.length = 0;
  CUPS.push(...list);
}

export const cupById = (id) => CUPS.find((c) => c.id === id);
export const seasonOf = (day) => Math.floor(day / SEASON_DAYS);

function racesOn(trackId, day) {
  const i = TRACKS.findIndex((t) => t.id === trackId);
  return i % 2 === day % 2;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Make sure this season's (and next season's) competitions exist. */
export function ensureCups(world) {
  world.cups ||= [];
  const season = seasonOf(world.day);
  for (const s of [season, season + 1]) {
    for (const cup of CUPS) {
      const key = `${cup.id}:${s}`;
      if (world.cups.some((c) => c.key === key)) continue;
      let heats = s * SEASON_DAYS + cup.dayInSeason;
      while (!racesOn(cup.trackId, heats)) heats++;
      world.cups.push({
        key, cupId: cup.id, season: s, stage: 'entries',
        days: { heats, semis: heats + ROUND_GAP, final: heats + ROUND_GAP * 2 },
        playerEntries: [], field: {}, results: {}, winner: null,
      });
    }
  }
  // Keep the last few finished competitions for the record, drop older ones.
  world.cups = world.cups.filter((c) => c.season >= season - 2);
}

export function cupsByDate(world) {
  return [...(world.cups || [])].sort((a, b) => a.days.heats - b.days.heats);
}

/** Can a dog be entered into this competition now? Returns a reason if not. */
export function entryProblem(world, inst, dog) {
  const cup = cupById(inst.cupId);
  if (inst.stage !== 'entries' || world.day >= inst.days.heats) return 'Entries have closed.';
  if (dog.classKey !== cup.classKey) return `Only for ${cup.classKey === 'stay' ? 'stayers' : cup.classKey === 'sprint' ? 'sprinters' : 'standard-distance dogs'}.`;
  if (inst.playerEntries.includes(dog.id)) return 'Already entered.';
  if (inst.playerEntries.length >= 6) return 'You can enter up to 6 dogs.';
  return null;
}

const roundName = { heats: 'heat', semis: 'semi-final', final: 'final' };
const roundShort = { heats: 'Ht', semis: 'SF', final: 'Final' };

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).join('').toUpperCase();
}

/** A dog's recent speed figure, used to pick the best dogs to fill a competition. */
function formRating(dog) {
  const runs = dog.runs.slice(0, 4);
  if (!runs.length) return -dog.grade * 1.5 - 3;
  return runs.reduce((a, r) => a + r.fig, 0) / runs.length;
}

/**
 * Competition races at a track's meeting on `day`. Returns race outlines
 * ({ cup, round, index, title, gradeLabel, classKey, dogs }) for getMeeting to finish off.
 */
export function cupRacesFor(world, ts, day, findDog) {
  const out = [];
  for (const inst of world.cups || []) {
    const cup = cupById(inst.cupId);
    if (!cup || cup.trackId !== ts.trackId) continue;
    const round = Object.keys(inst.days).find((r) => inst.days[r] === day);
    if (!round) continue;
    const rng = makeRng(hash(`${world.seed}:${inst.key}:${round}`));
    if (round === 'heats' && inst.stage === 'entries') {
      // Close entries: your dogs, then the best of the host track's dogs.
      const mine = inst.playerEntries.map(findDog).filter(Boolean);
      const others = ts.dogs
        .filter((d) => d.classKey === cup.classKey && d.owner !== 'player')
        .sort((a, b) => formRating(b) - formRating(a))
        .slice(0, CUP_SIZE - mine.length);
      const field = rng.shuffle([...mine, ...others]);
      inst.field.heats = Array.from({ length: HEATS }, (_, h) => field.slice(h * 6, h * 6 + 6).map((d) => d.id));
      inst.stage = 'heats';
    }
    const groups = round === 'final' ? (inst.field.final ? [inst.field.final] : []) : (inst.field[round] || []);
    if (inst.stage !== round) continue;
    groups.forEach((ids, index) => {
      const dogs = ids.map(findDog).filter(Boolean);
      if (dogs.length < 2) return;
      const label = round === 'final' ? 'final' : `${roundName[round]} ${index + 1}`;
      out.push({
        cup: { key: inst.key, round, index }, title: `${cup.name} ${label}`,
        gradeLabel: `${initials(cup.name)} ${roundShort[round]}${round === 'final' ? '' : index + 1}`,
        classKey: cup.classKey, dogs,
      });
    });
  }
  return out;
}

/** Called after each competition race: store the result and draw the next round. */
export function cupRaceRun(world, race, sim) {
  const inst = world.cups.find((c) => c.key === race.cup.key);
  if (!inst) return null;
  const { round, index } = race.cup;
  (inst.results[round] ||= [])[index] = sim.results.map((r) => r.dog.id);
  const expected = round === 'final' ? 1 : (inst.field[round] || []).length;
  const done = inst.results[round].filter(Boolean).length;
  if (done < expected) return null;
  const rng = makeRng(hash(`${world.seed}:${inst.key}:${round}:draw`));
  const qualifiers = inst.results[round].flatMap((ids) => ids.slice(0, 3));
  if (round === 'heats') {
    const q = rng.shuffle(qualifiers);
    inst.field.semis = [q.slice(0, 6), q.slice(6, 12)].filter((g) => g.length);
    inst.stage = 'semis';
  } else if (round === 'semis') {
    inst.field.final = rng.shuffle(qualifiers);
    inst.stage = 'final';
  } else {
    inst.winner = inst.results.final[0][0];
    inst.stage = 'done';
    return { finished: true, winnerId: inst.winner };
  }
  return { finished: false };
}

export function cupTrack(inst) {
  return trackById(cupById(inst.cupId).trackId);
}
