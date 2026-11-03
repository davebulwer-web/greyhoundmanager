// The racing world: every track has its own pool of greyhounds and trainers,
// races on its own nights of the week, and keeps each dog's form.
// When you visit a track, any meetings it held since your last visit are run
// in the background first, so form is always up to date.
// No DOM code here: it runs in Node too (see tools/worldtest.mjs).

import { makeRng } from './rng.js';
import { makeDog, pickFirstWord, makeTrainerName, overallRating } from './dogs.js';
import { TRACKS, trackById, racesOn, raceDistance, WEEKDAYS } from './track.js';
import { simulateRace, TUNING, SECONDS_PER_LENGTH, formatMargin } from './sim.js';
import { priceRace } from './market.js';
import { settleBet, betCost, describeBet } from './betting.js';
import { ensureCups, cupRacesFor, cupRaceRun, cupById, CUPS } from './cups.js';

// The kinds of race, with their grades as in British racing: A (standard
// distance), B (a longer standard trip), D (sprints), S (stayers), M (marathons)
// and H (hurdles). Grade 1 is the best. perGrade = dogs per grade at a track.
// level/step say how good grade 1 is and how fast the grades drop away,
// counted in A grades (used for prize money and dog values).
export const CLASSES = {
  standard: { prefix: 'A', grades: 11, perGrade: 10, level: 0, step: 1, name: 'standard', plural: 'standard-distance dogs' },
  middle: { prefix: 'B', grades: 6, perGrade: 4, level: 1, step: 1.5, name: 'middle distance', plural: 'middle-distance dogs' },
  sprint: { prefix: 'D', grades: 4, perGrade: 5, level: 2, step: 2, name: 'sprint', plural: 'sprinters' },
  stay: { prefix: 'S', grades: 6, perGrade: 4, level: 1, step: 1.5, name: 'stayers', plural: 'stayers' },
  marathon: { prefix: 'M', grades: 2, perGrade: 6, level: 1, step: 3, name: 'marathon', plural: 'marathon dogs' },
  hurdle: { prefix: 'H', grades: 4, perGrade: 6, level: 2, step: 2, name: 'hurdles', plural: 'hurdlers' },
};
export const CLASS_KEYS = Object.keys(CLASSES);
// A night's card, in order. Kinds a track doesn't stage become standard races.
const MEETING_PLAN = ['standard', 'standard', 'sprint', 'standard', 'middle', 'standard', 'hurdle', 'standard', 'stay', 'standard', 'marathon'];
export const REST_DAYS = 5;     // a dog needs this many days between races
export const HISTORY_DAYS = 36; // the game starts on this day of the calendar
export const CATCHUP_DAYS = 56; // a track's form is built from this many days of racing before you first visit
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

/** The tracks racing on a day (each track has its own race nights). */
export function tracksRacingOn(day) {
  return TRACKS.filter((t) => racesOn(t, day));
}

/** A track's own last race night of the week, when it puts on an open race. */
function isOpenNight(track, day) {
  const order = WEEKDAYS.filter((d) => track.nights.includes(d));
  return WEEKDAYS[((day % 7) + 7) % 7] === order[order.length - 1];
}

export const START_MONEY = 1500;

/**
 * A new world. `player` is { name, homeTrack }: your kennel's name and the
 * track your dogs are attached to.
 */
export function createWorld(seed, player = { name: 'My Kennel', homeTrack: TRACKS[0].id }) {
  const world = {
    version: 1, seed, day: HISTORY_DAYS, balance: START_MONEY, tracks: {},
    player: { ...player }, ledger: [], sales: null, nextId: 1, cups: [], trophies: [], news: [],
  };
  ensureCups(world);
  return world;
}

/** Find any dog in the world by its id. */
export function findDog(world, id) {
  for (const ts of Object.values(world.tracks)) {
    const d = ts.dogs.find((x) => x.id === id);
    if (d) return d;
  }
  return null;
}

/** Ids of your dogs due to run in a competition round on `day` (they skip ordinary races that day). */
function cupDogsOn(world, day) {
  const ids = new Set();
  for (const inst of world.cups || []) {
    const round = Object.keys(inst.days).find((r) => inst.days[r] === day);
    if (!round) continue;
    if (round === 'heats') inst.playerEntries.forEach((id) => ids.add(id));
    const f = inst.field[round];
    if (f) (round === 'final' ? [f] : f).flat().forEach((id) => ids.add(id));
  }
  return ids;
}

/** Add a line to your accounts and change your money. */
export function addLedger(world, text, amount) {
  world.balance = +(world.balance + amount).toFixed(2);
  world.ledger.unshift({ day: world.day, text, amount: +amount.toFixed(2) });
  if (world.ledger.length > 300) world.ledger.length = 300;
}

export const isMine = (dog) => dog.owner === 'player';

/** How good a grade is, counted in A grades (0 = A1; open races are -2). */
export function gradeLevel(classKey, grade) {
  if (grade < 0) return -2;
  const cls = CLASSES[classKey] || CLASSES.standard;
  return cls.level + grade * cls.step;
}

/** Prize money for 1st, 2nd and 3rd, plus the appearance fee every runner gets. */
export function prizes(classKey, grade) {
  const first = Math.round((220 - gradeLevel(classKey, grade) * 15) / 5) * 5;
  return { places: [first, Math.round(first * 0.35 / 5) * 5, Math.round(first * 0.2 / 5) * 5], runFee: 25 };
}

// ---------------------------------------------------------------------------
// Dog pools

/** Sprinters are sharper and have less stamina; stayers the other way round. */
export function classTweak(dog, classKey) {
  const s = dog.stats;
  if (classKey === 'sprint') {
    s.stamina = Math.max(5, s.stamina - 20);
    s.earlyPace = Math.min(98, s.earlyPace + 12);
    s.breakSpeed = Math.min(98, s.breakSpeed + 8);
  } else if (classKey === 'stay') {
    s.stamina = Math.min(98, s.stamina + 25);
    s.earlyPace = Math.max(5, s.earlyPace - 8);
  } else if (classKey === 'middle') {
    s.stamina = Math.min(98, s.stamina + 10);
  } else if (classKey === 'marathon') {
    s.stamina = Math.min(98, s.stamina + 35);
    s.earlyPace = Math.max(5, s.earlyPace - 10);
  } else if (classKey === 'hurdle') {
    s.jumping = Math.min(98, (s.jumping ?? 50) + 25);
  }
}

function makePool(world, track) {
  const rng = makeRng(hash(`${world.seed}:${track.id}:pool`));
  const taken = new Set();
  const trainerNames = new Set();
  const trainers = Array.from({ length: 8 }, () => makeTrainerName(rng, trainerNames));
  const dogs = [];
  for (const [classKey, cls] of Object.entries(CLASSES)) {
    const distance = raceDistance(track, classKey);
    if (!distance) continue;
    const want = cls.grades * cls.perGrade;
    const group = [];
    while (group.length < want) {
      // Dogs come in litters from the same kennel, so they share a first word.
      const firstWord = pickFirstWord(rng);
      const litterQuality = 54 + rng.normal() * 9;
      const litter = Math.min(want - group.length, rng.int(1, 3));
      for (let k = 0; k < litter; k++) {
        const dog = makeDog(rng, { quality: litterQuality + rng.normal() * 5, taken, firstWord });
        classTweak(dog, classKey);
        Object.assign(dog, {
          classKey, trainer: rng.pick(trainers), homeTrack: track.id, runs: [], lastRunDay: -99,
        });
        group.push(dog);
      }
    }
    // Initial grading: the racing manager has seen them all trial.
    const hurdles = classKey === 'hurdle';
    group.sort((a, b) => overallRating(b, distance, hurdles) + rng.normal() * 2 - overallRating(a, distance, hurdles) - rng.normal() * 2);
    group.forEach((dog, i) => { dog.grade = Math.floor(i / cls.perGrade); });
    dogs.push(...group);
  }
  return { trackId: track.id, dogs, trainers, standards: {}, lastMeetingDay: -1, meetings: {} };
}

/** Hurdle races keep their own standard times (they're slower than flat races over the same trip). */
export const stdKey = (distance, hurdles) => (hurdles ? `${distance}H` : `${distance}`);

/** Typical winning time at a distance, learnt from this track's results. */
export function standardTime(ts, distance, hurdles = false) {
  const list = ts.standards[stdKey(distance, hurdles)];
  if (!list || !list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function seedStandards(world, ts, track) {
  // A few trial races with ordinary dogs give each distance a starting standard.
  for (const classKey of CLASS_KEYS) {
    const distance = raceDistance(track, classKey);
    const key = stdKey(distance, classKey === 'hurdle');
    if (!distance || ts.standards[key]?.length) continue;
    const rng = makeRng(hash(`${world.seed}:${track.id}:std:${distance}`));
    for (let i = 0; i < 4; i++) {
      const runners = Array.from({ length: 6 }, (_, k) => {
        const dog = makeDog(rng, { quality: 50 });
        classTweak(dog, classKey);
        return { trap: k + 1, dog };
      });
      const race = simulateRace({ track, distance, runners, seed: rng.int(1, 1e9), going: 0, hurdles: classKey === 'hurdle' });
      (ts.standards[key] ||= []).push(race.winnerTime);
    }
  }
}

/** Get a track's world, creating it and catching up on missed meetings. */
export function trackState(world, trackId) {
  const track = trackById(trackId);
  let ts = world.tracks[trackId];
  if (!ts) {
    ts = world.tracks[trackId] = makePool(world, track);
    // A new track only needs its recent history, not every meeting since day 0.
    ts.lastMeetingDay = world.day - CATCHUP_DAYS - 1;
  }
  ts.lastVisitDay = world.day;
  seedStandards(world, ts, track); // also fills in any distance added to the tracks file
  // After a long gap, only the last few weeks are raced (the dogs just rest before that).
  const from = Math.max(ts.lastMeetingDay + 1, world.day - CATCHUP_DAYS);
  for (let day = from; day < world.day; day++) {
    if (!racesOn(track, day)) continue;
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
  const busy = cupDogsOn(world, day);

  // Competition rounds first, so their dogs aren't put in ordinary races.
  for (const c of cupRacesFor(world, ts, day, (id) => findDog(world, id))) {
    c.dogs.forEach((d) => used.add(d));
    const seeded = c.dogs
      .map((dog) => ({ dog, key: STYLE_RANK[dog.style] + rng.normal() * 0.7 }))
      .sort((a, b) => a.key - b.key);
    races.push({
      classKey: c.classKey, grade: null, gradeLabel: c.gradeLabel, title: c.title, cup: c.cup,
      hurdles: c.classKey === 'hurdle',
      distance: raceDistance(track, c.classKey), runners: seeded.map(({ dog }, i) => ({ trap: i + 1, dog })),
      seed: rng.int(1, 1e9), result: null, trackId,
    });
  }

  // An open race on the track's big night of the week: the best six fit dogs
  // at the standard distance, whatever their grade (A1 and A2 dogs in practice).
  if (isOpenNight(track, day)) {
    const ready = ts.dogs
      .filter((d) => d.classKey === 'standard' && d.grade <= 2 && !busy.has(d.id) && !(isMine(d) && !d.entered)
        && day - d.lastRunDay >= REST_DAYS && d.runs.length >= 2)
      .sort((a, b) => (isMine(b) && b.grade <= 1) - (isMine(a) && a.grade <= 1) || recentFigure(b) - recentFigure(a));
    if (ready.length >= 6) {
      const dogs = ready.slice(0, 6);
      dogs.forEach((d) => used.add(d));
      const seeded = dogs
        .map((dog) => ({ dog, key: STYLE_RANK[dog.style] + rng.normal() * 0.7 }))
        .sort((a, b) => a.key - b.key);
      races.push({
        classKey: 'standard', grade: -1, gradeLabel: 'OR', title: 'Open race', open: true,
        distance: raceDistance(track, 'standard'), runners: seeded.map(({ dog }, i) => ({ trap: i + 1, dog })),
        seed: rng.int(1, 1e9), result: null, trackId,
      });
    }
  }

  const plan = MEETING_PLAN.map((k) => (raceDistance(track, k) ? k : 'standard'));
  for (const classKey of plan) {
    const cls = CLASSES[classKey];
    // Your dogs only run if you've entered them; they get first call on a race.
    const pool = ts.dogs.filter((d) => d.classKey === classKey && !used.has(d) && !busy.has(d.id)
      && !(isMine(d) && !d.entered));
    const rested = (d, rest) => day - d.lastRunDay >= rest;
    let field = null;
    for (const rest of [REST_DAYS, REST_DAYS - 1, 3]) {
      const ready = pool.filter((d) => rested(d, isMine(d) ? REST_DAYS : rest));
      if (ready.length < 6) continue;
      // Pick the grade with the most dogs ready (a little randomness to vary the card).
      const counts = Array.from({ length: cls.grades }, (_, g) => ready.filter((d) => d.grade === g).length + rng.next());
      const mine = ready.find((d) => isMine(d) && rested(d, REST_DAYS));
      const grade = mine ? mine.grade : counts.indexOf(Math.max(...counts));
      // Fill from that grade first, then the grades either side.
      const byCloseness = [...ready].sort((a, b) =>
        Math.abs(a.grade - grade) - Math.abs(b.grade - grade) || (isMine(b) - isMine(a)) || (a.lastRunDay - b.lastRunDay) || rng.next() - 0.5);
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
      classKey, grade: field.grade, gradeLabel: gradeLabel(classKey, field.grade), hurdles: classKey === 'hurdle',
      distance: raceDistance(track, classKey), runners, seed: rng.int(1, 1e9), result: null, trackId,
    });
  }
  // Weakest races first, the best race of the night last.
  const strength = (r) => (r.cup ? -1 - (r.cup.round === 'final' ? 5 : r.cup.round === 'semis' ? 3 : 0) - r.cup.index * 0.01
    : gradeLevel(r.classKey, r.grade));
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
export function runRace(world, meeting, race, { keepFrames = false, sim = null } = {}) {
  const track = trackById(meeting.trackId);
  const ts = world.tracks[meeting.trackId];
  // `sim` lets the page pass in the run it has just shown, so the result always matches.
  sim ||= simulateRace({ track, distance: race.distance, runners: race.runners, seed: race.seed, going: meeting.going, hurdles: race.hurdles });
  race.result = keepFrames ? sim : { ...sim, frames: undefined };
  recordForm(ts, meeting, race, sim);
  payPrizes(world, race, sim);
  if (race.cup) {
    const out = cupRaceRun(world, race, sim);
    if (out?.finished) {
      const winner = findDog(world, out.winnerId);
      const cup = cupById(race.cup.key.split(':')[0]);
      winner.trophies = [...(winner.trophies || []), `${cup.name} ${meeting.day}`];
      if (isMine(winner)) world.trophies.push({ cup: cup.name, dog: winner.name, day: meeting.day });
      addNews(world, `${winner.name} won the ${cup.name} at ${track.name}${isMine(winner) ? ' for you!' : '.'}`);
    }
  }
  ts.lastMeetingDay = Math.max(ts.lastMeetingDay, meeting.day);
  // Drop old cards (keeps memory small); form lives on the dogs.
  for (const d of Object.keys(ts.meetings)) if (+d < meeting.day - 1) delete ts.meetings[d];
  return sim;
}

export function addNews(world, text) {
  world.news ||= [];
  world.news.unshift({ day: world.day, text });
  if (world.news.length > 60) world.news.length = 60;
}

function payPrizes(world, race, sim) {
  const { places, runFee } = race.cup
    ? { places: race.cup.round === 'final' ? cupById(race.cup.key.split(':')[0]).prizes : [], runFee: 25 }
    : prizes(race.classKey, race.grade);
  for (const r of sim.results) {
    if (!isMine(r.dog)) continue;
    const prize = places[r.position - 1] || 0;
    addLedger(world, `${r.dog.name} ran ${ordinal(r.position)} in race ${race.no} (${race.title || race.gradeLabel}): ${prize ? `£${prize} prize and ` : ''}£${runFee} appearance fee`, runFee + prize);
    r.dog.earnings = (r.dog.earnings || 0) + runFee + prize;
  }
}

export function ordinal(n) {
  return `${n}${['th', 'st', 'nd', 'rd'][n] || 'th'}`;
}

/** Pay out every bet on a finished race. Returns a line of text per bet. */
export function settleRace(world, race) {
  const lines = [];
  for (const bet of race.bets || []) {
    if (bet.note) continue;
    const { returned, note } = settleBet(bet, race);
    bet.returned = +returned.toFixed(2);
    bet.note = note;
    if (bet.returned > 0) addLedger(world, `Bet won: race ${race.no}, ${describeBet(bet)}`, bet.returned);
    lines.push(`Race ${race.no}: ${describeBet(bet)}, ${betCost(bet).toFixed(2)} staked, ${bet.returned > 0 ? `returned £${bet.returned.toFixed(2)}` : 'lost'}`);
  }
  return lines;
}

/** Run (and settle) any races left in today's meetings, e.g. before moving on a day. */
export function finishToday(world) {
  const lines = [];
  for (const ts of Object.values(world.tracks)) {
    const m = ts.meetings[world.day];
    if (!m) continue;
    for (const race of m.races) {
      if (race.result) continue;
      runRace(world, m, race, { keepFrames: false });
      lines.push(...settleRace(world, race));
    }
  }
  return lines;
}

/** 'none' (no card yet), 'open' (card made, no races run), 'started', or 'over'. */
export function meetingStatus(world, trackId) {
  const ts = world.tracks[trackId];
  const m = ts && ts.meetings[world.day];
  if (!m) return ts && ts.lastMeetingDay >= world.day ? 'over' : 'none';
  const run = m.races.filter((r) => r.result).length;
  return run === 0 ? 'open' : run === m.races.length ? 'over' : 'started';
}

export function calcTime(time, going) {
  return +(time * (1 - going * TUNING.goingEffect)).toFixed(2);
}

function recordForm(ts, meeting, race, sim) {
  const std = standardTime(ts, race.distance, race.hurdles);
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
      hurdles: race.hurdles ? 1 : 0,
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
  const list = (ts.standards[stdKey(race.distance, race.hurdles)] ||= []);
  list.push(calcTime(winner.time, meeting.going));
  if (list.length > 40) list.shift();
  if (!race.cup && !race.open) regrade(res, race.classKey);
}

/** Average speed figure from a dog's last few runs (for picking open races). */
function recentFigure(dog) {
  const runs = dog.runs.slice(0, 4);
  return runs.length ? runs.reduce((a, r) => a + r.fig, 0) / runs.length : -9;
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

export function bestTime(dog, distance, hurdles = false) {
  const times = dog.runs.filter((r) => r.distance === distance && !!r.hurdles === !!hurdles).map((r) => r.time);
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
