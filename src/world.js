// The racing world: every track has its own pool of greyhounds and trainers,
// races twice a week-ish (every other day), and keeps each dog's form.
// When you visit a track, any meetings it held since your last visit are run
// in the background first, so form is always up to date.
// No DOM code here: it runs in Node too (see tools/worldtest.mjs).

import { makeRng } from './rng.js';
import { makeDog, pickFirstWord, makeTrainerName, overallRating } from './dogs.js';
import { TRACKS, trackById } from './track.js';
import { simulateRace, TUNING, SECONDS_PER_LENGTH, formatMargin } from './sim.js';
import { priceRace } from './market.js';

/** Race classes: sprint (D grades), standard (A grades), stayers (S grades). */
export const CLASSES = {
  sprint: { prefix: 'D', grades: 3, perGrade: 9, distIndex: 0 },
  standard: { prefix: 'A', grades: 8, perGrade: 20, distIndex: 1 },
  stay: { prefix: 'S', grades: 3, perGrade: 9, distIndex: 2 },
};
const MEETING_PLAN = ['standard', 'standard', 'standard', 'sprint', 'standard', 'standard', 'standard', 'stay', 'standard', 'standard'];
export const REST_DAYS = 5;     // a dog needs this many days between races
export const HISTORY_DAYS = 36; // days of racing run before the game starts
const FIRST_RACE_MINS = 19 * 60 + 12;
const RACE_GAP_MINS = 16;
const START_DATE = Date.UTC(2027, 0, 4); // day 0 of the calendar

const STYLE_RANK = { rail: 0, middle: 1, wide: 2 };
export const SEED_LETTER = { rail: 'R', middle: 'M', wide: 'W' };

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function dayDate(day) {
  return new Date(START_DATE + day * 86400000);
}

export function formatDay(day, withWeekday = true) {
  const d = dayDate(day);
  const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (withWeekday) opts.weekday = 'short';
  return d.toLocaleDateString('en-GB', opts);
}

export function formatShortDate(day) {
  const d = dayDate(day);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function gradeLabel(classKey, grade) {
  return `${CLASSES[classKey].prefix}${grade + 1}`;
}

/** Tracks race on alternate days: half of them on even days, half on odd. */
export function tracksRacingOn(day) {
  return TRACKS.filter((_, i) => i % 2 === day % 2);
}

export function createWorld(seed) {
  return { seed, day: HISTORY_DAYS, balance: 1000, tracks: {}, betLog: [] };
}

// ---------------------------------------------------------------------------
// Dog pools

function makePool(world, track) {
  const rng = makeRng(hash(`${world.seed}:${track.id}:pool`));
  const taken = new Set();
  const trainerNames = new Set();
  const trainers = Array.from({ length: 8 }, () => makeTrainerName(rng, trainerNames));
  const dogs = [];
  for (const [classKey, cls] of Object.entries(CLASSES)) {
    const distance = track.distances[cls.distIndex];
    const want = cls.grades * cls.perGrade;
    const group = [];
    while (group.length < want) {
      // Dogs come in litters from the same kennel, so they share a first word.
      const firstWord = pickFirstWord(rng);
      const litterQuality = 54 + rng.normal() * 9;
      const litter = Math.min(want - group.length, rng.int(1, 3));
      for (let k = 0; k < litter; k++) {
        const dog = makeDog(rng, { quality: litterQuality + rng.normal() * 5, taken, firstWord });
        const s = dog.stats;
        if (classKey === 'sprint') {
          s.stamina = Math.max(5, s.stamina - 20);
          s.earlyPace = Math.min(98, s.earlyPace + 12);
          s.breakSpeed = Math.min(98, s.breakSpeed + 8);
        } else if (classKey === 'stay') {
          s.stamina = Math.min(98, s.stamina + 25);
          s.earlyPace = Math.max(5, s.earlyPace - 8);
        }
        Object.assign(dog, {
          classKey, trainer: rng.pick(trainers), homeTrack: track.id, runs: [], lastRunDay: -99,
        });
        group.push(dog);
      }
    }
    // Initial grading: the racing manager has seen them all trial.
    group.sort((a, b) => overallRating(b, distance) + rng.normal() * 2 - overallRating(a, distance) - rng.normal() * 2);
    group.forEach((dog, i) => { dog.grade = Math.floor(i / cls.perGrade); });
    dogs.push(...group);
  }
  return { trackId: track.id, dogs, trainers, standards: {}, lastMeetingDay: -1, meetings: {} };
}

/** Typical winning time at a distance, learnt from this track's results. */
export function standardTime(ts, distance) {
  const list = ts.standards[distance];
  if (!list || !list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function seedStandards(world, ts, track) {
  // A few trial races with ordinary dogs give each distance a starting standard.
  const rng = makeRng(hash(`${world.seed}:${track.id}:std`));
  for (const cls of Object.values(CLASSES)) {
    const distance = track.distances[cls.distIndex];
    for (let i = 0; i < 4; i++) {
      const runners = Array.from({ length: 6 }, (_, k) => ({ trap: k + 1, dog: makeDog(rng, { quality: 50 }) }));
      const race = simulateRace({ track, distance, runners, seed: rng.int(1, 1e9), going: 0 });
      (ts.standards[distance] ||= []).push(race.winnerTime);
    }
  }
}

/** Get a track's world, creating it and catching up on missed meetings. */
export function trackState(world, trackId) {
  const track = trackById(trackId);
  let ts = world.tracks[trackId];
  if (!ts) {
    ts = world.tracks[trackId] = makePool(world, track);
    seedStandards(world, ts, track);
  }
  for (let day = ts.lastMeetingDay + 1; day < world.day; day++) {
    if (!tracksRacingOn(day).some((t) => t.id === trackId)) continue;
    const meeting = getMeeting(world, trackId, day);
    for (const race of meeting.races) if (!race.result) runRace(world, meeting, race, { keepFrames: false });
  }
  return ts;
}

// ---------------------------------------------------------------------------
// Meetings

/** The card for a track's meeting on `day` (built once, then cached). */
export function getMeeting(world, trackId, day = world.day) {
  const ts = world.tracks[trackId] || trackState(world, trackId);
  if (ts.meetings[day]) return ts.meetings[day];
  const track = trackById(trackId);
  const rng = makeRng(hash(`${world.seed}:${trackId}:${day}`));
  const going = (track.goingBase || 0) + rng.int(-3, 3) * 5;
  const used = new Set();
  const races = [];

  for (const classKey of MEETING_PLAN) {
    const cls = CLASSES[classKey];
    const pool = ts.dogs.filter((d) => d.classKey === classKey && !used.has(d));
    const rested = (d, rest) => day - d.lastRunDay >= rest;
    let field = null;
    for (const rest of [REST_DAYS, REST_DAYS - 1, 3]) {
      const ready = pool.filter((d) => rested(d, rest));
      if (ready.length < 6) continue;
      // Pick the grade with the most dogs ready (a little randomness to vary the card).
      const counts = Array.from({ length: cls.grades }, (_, g) => ready.filter((d) => d.grade === g).length + rng.next());
      const grade = counts.indexOf(Math.max(...counts));
      // Fill from that grade first, then the grades either side.
      const byCloseness = [...ready].sort((a, b) =>
        Math.abs(a.grade - grade) - Math.abs(b.grade - grade) || (a.lastRunDay - b.lastRunDay) || rng.next() - 0.5);
      field = { grade, dogs: byCloseness.slice(0, 6) };
      break;
    }
    if (!field) continue;
    field.dogs.forEach((d) => used.add(d));
    // Trap draw: railers go low, wide runners go high, with some luck.
    const seeded = field.dogs
      .map((dog) => ({ dog, key: STYLE_RANK[dog.style] + rng.normal() * 0.7 }))
      .sort((a, b) => a.key - b.key);
    const runners = seeded.map(({ dog }, i) => ({ trap: i + 1, dog }));
    races.push({
      classKey, grade: field.grade, gradeLabel: gradeLabel(classKey, field.grade),
      distance: track.distances[cls.distIndex], runners, seed: rng.int(1, 1e9), result: null,
    });
  }
  // Weakest races first, the best race of the night last.
  const strength = (r) => (r.classKey === 'standard' ? r.grade : r.grade + 1.5);
  races.sort((a, b) => strength(b) - strength(a));
  races.forEach((r, i) => {
    r.no = i + 1;
    const m = FIRST_RACE_MINS + i * RACE_GAP_MINS;
    r.time = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    r.market = priceRace(ts, r, rng);
  });
  const meeting = { trackId, day, going, races };
  ts.meetings[day] = meeting;
  return meeting;
}

/** Today's meeting at a track (catching the track up first). */
export function todaysMeeting(world, trackId) {
  trackState(world, trackId);
  return getMeeting(world, trackId, world.day);
}

/** The next race of a meeting that has not been run yet. */
export function nextRace(meeting) {
  return meeting.races.find((r) => !r.result) || null;
}

/** Run one race of a meeting and write everybody's form. */
export function runRace(world, meeting, race, { keepFrames = true } = {}) {
  const track = trackById(meeting.trackId);
  const ts = world.tracks[meeting.trackId];
  const sim = simulateRace({ track, distance: race.distance, runners: race.runners, seed: race.seed, going: meeting.going });
  if (!keepFrames) delete sim.frames;
  race.result = sim;
  recordForm(ts, meeting, race, sim);
  ts.lastMeetingDay = Math.max(ts.lastMeetingDay, meeting.day);
  // Drop old cards (keeps memory small); form lives on the dogs.
  for (const d of Object.keys(ts.meetings)) if (+d < meeting.day - 1) delete ts.meetings[d];
  return sim;
}

export function calcTime(time, going) {
  return +(time * (1 - going * TUNING.goingEffect)).toFixed(2);
}

function recordForm(ts, meeting, race, sim) {
  const std = standardTime(ts, race.distance);
  const res = sim.results;
  const winner = res[0];
  const second = res[1];
  const spByTrap = new Map(race.market.runners.map((m) => [m.trap, m]));
  const fav = race.market.runners.reduce((a, b) => (b.prob > a.prob ? b : a));
  for (const r of res) {
    const dog = r.dog;
    const ct = calcTime(r.time, meeting.going);
    const sp = spByTrap.get(r.trap);
    const by = r.position === 1
      ? formatMargin((second.time - winner.time) / SECONDS_PER_LENGTH)
      : formatMargin(r.behindLengths);
    dog.runs.unshift({
      day: meeting.day,
      trackId: meeting.trackId,
      distance: race.distance,
      trap: r.trap,
      grade: race.gradeLabel,
      sectional: r.sectional,
      bends: r.bendFigures,
      pos: r.position,
      by,
      behind: r.behindLengths,
      other: r.position === 1 ? second.dog.name : winner.dog.name,
      comments: r.comments,
      time: r.time,
      winTime: winner.time,
      going: meeting.going,
      calcTime: ct,
      sp: sp.odds + (sp === fav ? 'F' : ''),
      // Speed figure in lengths against the track standard (bigger is better).
      fig: std ? (std - ct) / SECONDS_PER_LENGTH : 0,
    });
    if (dog.runs.length > 20) dog.runs.length = 20;
    dog.lastRunDay = meeting.day;
  }
  const list = (ts.standards[race.distance] ||= []);
  list.push(calcTime(winner.time, meeting.going));
  if (list.length > 40) list.shift();
  regrade(res, race.classKey);
}

/** Winners go up a grade; dogs beaten into 4th or worse twice running (once 5th or 6th) go down. */
function regrade(results, classKey) {
  const maxGrade = CLASSES[classKey].grades - 1;
  for (const r of results) {
    const dog = r.dog;
    if (r.position === 1 && dog.grade > 0) { dog.grade--; continue; }
    const last = dog.runs.slice(0, 2).map((x) => x.pos);
    if (dog.grade < maxGrade && last.length === 2 && last.every((p) => p >= 4) && Math.max(...last) >= 5) dog.grade++;
  }
}

// ---------------------------------------------------------------------------
// Racecard helpers

export function bestTime(dog, distance) {
  const times = dog.runs.filter((r) => r.distance === distance).map((r) => r.time);
  return times.length ? Math.min(...times) : null;
}

/** Recent finishing positions, oldest first, as on a racecard ("31246"). */
export function formFigures(dog, n = 6) {
  return dog.runs.slice(0, n).map((r) => r.pos).reverse().join('');
}

/** A one-line pen picture written from the dog's recent form. */
export function penPicture(dog) {
  const runs = dog.runs.slice(0, 5);
  if (!runs.length) return 'Unraced here.';
  const has = (tag) => runs.filter((r) => r.comments.split(',').some((c) => c.startsWith(tag))).length;
  const bits = [];
  const last = runs[0];
  if (last.pos === 1) bits.push('Won last time');
  else if (last.pos <= 2 && last.behind < 1.5) bits.push('Just touched off last time');
  const wins = runs.filter((r) => r.pos === 1).length;
  if (wins >= 2) bits.push(`${wins} wins from the last ${runs.length}`);
  if (has('QAw') + has('EP') + has('ALed') >= 3) bits.push('very quick out of the traps');
  else if (has('SAw') + has('MsdBrk') >= 2) bits.push('tends to start slowly');
  if (has('RnOn') >= 2) bits.push('finishes strongly');
  if (has('Fdd') >= 2) bits.push('has been fading late');
  if (has('Crd') + has('Bmp') >= 4) bits.push('often finds trouble');
  if (has('RnWd') >= 2) bits.push('runs wide on the bends');
  if (!bits.length) {
    const avg = runs.reduce((a, r) => a + r.pos, 0) / runs.length;
    bits.push(avg <= 3 ? 'Consistent sort' : avg >= 4.5 ? 'Needs to find a lot more' : 'Mixed recent form');
  }
  const text = bits.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
