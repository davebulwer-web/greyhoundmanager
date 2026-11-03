// Your kennel: buying and selling dogs, training, fitness, daily costs and
// moving the calendar on. No DOM code here (runs in Node for tools/worldtest.mjs).

import { makeRng } from './rng.js';
import { makeDog, overallRating } from './dogs.js';
import { trackById, raceDistance } from './track.js';
import { simulateRace } from './sim.js';
import { breedingDay, newSeason, isNewSeason } from './breeding.js';
import { cupById } from './cups.js';

const cupHost = (inst) => cupById(inst.cupId).trackId;
import {
  CLASSES, trackState, standardTime, addLedger, isMine, finishToday, calcTime, tracksRacingOn, todaysMeeting,
  gradeLevel, classTweak,
} from './world.js';

/** Everything money-related in one place, so it can be balanced easily. */
export const ECONOMY = {
  upkeepPerDay: 4,      // kennel, food and vet bills per dog per day
  trainingPerDay: 2,    // extra per day for a dog on special training
  sellShare: 0.6,       // a dog sells for this share of its value
  salesEvery: 7,        // days between new dogs coming up for sale
  gradeValue: [2400, 1700, 1250, 950, 700, 520, 400, 300, 240, 200, 170], // value of a 2-3 year old by grade (A1 first; other grades count as the A grade they're worth)
};

/**
 * Training plans. `stats` are the abilities that improve. `recovery` is how much
 * of the gap back to full fitness a dog makes up each day (0.2 = a fifth of it).
 * A dog loses RACE_FITNESS_COST fitness when it races.
 */
export const TRAINING = {
  normal: { label: 'Normal work', stats: [], recovery: 0.2, cost: 0, help: 'Keeps a dog ticking over and slowly improves everything a little.' },
  rest: { label: 'Rest', stats: [], recovery: 0.35, cost: 0, help: 'Gets fitness back quickly. No improvement.' },
  trapwork: { label: 'Trap work', stats: ['breakSpeed', 'earlyPace'], recovery: 0.1, cost: ECONOMY.trainingPerDay, help: 'Practice out of the traps: quicker breaks and early pace.' },
  gallops: { label: 'Gallops', stats: ['topSpeed'], recovery: 0.08, cost: ECONOMY.trainingPerDay, help: 'Flat-out work for top speed.' },
  distance: { label: 'Distance work', stats: ['stamina'], recovery: 0.08, cost: ECONOMY.trainingPerDay, help: 'Longer runs to build stamina.' },
  bends: { label: 'Bend work', stats: ['cornering'], recovery: 0.1, cost: ECONOMY.trainingPerDay, help: 'Schooling round the bends to keep speed and stay tidy.' },
  hurdling: { label: 'Hurdle schooling', stats: ['jumping'], recovery: 0.1, cost: ECONOMY.trainingPerDay, help: 'Schooling over hurdles: cleaner, quicker jumps.' },
  schooling: { label: 'Schooling', stats: ['consistency'], recovery: 0.12, cost: ECONOMY.trainingPerDay, help: 'Steady trials to make a dog more reliable.' },
};
export const RACE_FITNESS_COST = 18;
const GAIN_PER_DAY = 0.16;     // ability points a day on special training, when well short of potential
const NORMAL_GAIN = 0.03;
/**
 * Late developers. Young dogs (3 and under) with a lot of hidden room grow into
 * it by themselves, whatever their training: each day they gain `matureRate`
 * of the room above `matureFrom` points.
 */
export const DEVELOPERS = {
  improverChance: 0.10, improverRoom: [8, 16],  // 1 young dog in 10 has this much extra room
  starChance: 0.03, starRoom: [26, 40],         // about 1 in 33 is a hidden star
  matureFrom: 6,
  matureRate: 0.02,
};

export const STAT_LABELS = {
  breakSpeed: 'Break', earlyPace: 'Early pace', topSpeed: 'Top speed', stamina: 'Stamina', cornering: 'Bends', consistency: 'Consistency', jumping: 'Jumping',
};

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function myDogs(world) {
  const ts = world.tracks[world.player.homeTrack];
  return ts ? ts.dogs.filter(isMine) : [];
}

/** Turn a dog into one of yours (sets up training, fitness and its hidden potential). */
export function takeOn(world, dog) {
  const rng = makeRng(hashStr(`${world.seed}:${dog.id}:potential`));
  dog.owner = 'player';
  dog.trainer = world.player.name;
  dog.training = 'normal';
  dog.entered = true;
  dog.fitness ??= 100;
  dog.boughtDay = world.day;
  // Hidden ceiling for each ability: how far training can take this dog.
  // Most dogs have a little room to improve. A few young ones are late developers, and a
  // rare one is a hidden star: nothing in its trials or stars gives it away at the start.
  const bloom = dog.age > 3 ? 0 : rng.chance(DEVELOPERS.starChance) ? rng.int(...DEVELOPERS.starRoom)
    : rng.chance(DEVELOPERS.improverChance) ? rng.int(...DEVELOPERS.improverRoom) : 0;
  dog.potential = {};
  for (const k of Object.keys(dog.stats)) {
    const extra = bloom ? Math.max(0, bloom + rng.int(-4, 4)) : 0;
    dog.potential[k] = Math.min(99, dog.stats[k] + rng.int(2, 16) + extra);
  }
}

// ---------------------------------------------------------------------------
// Values, the sales and buying/selling

export function dogValue(dog) {
  const last = ECONOMY.gradeValue.length - 1;
  const g = Math.max(0, Math.min(last, Math.round(gradeLevel(dog.classKey, dog.grade))));
  const ageFactor = dog.age <= 3 ? 1 : dog.age === 4 ? 0.7 : 0.4;
  return Math.round((ECONOMY.gradeValue[g] * ageFactor) / 10) * 10;
}

export function sellPrice(dog) {
  return Math.round((dogValue(dog) * ECONOMY.sellShare) / 10) * 10;
}

/** Two trial runs for an unraced youngster, against ordinary dogs, at your home track. */
function runTrials(world, dog, rng) {
  const track = trackById(world.player.homeTrack);
  const ts = world.tracks[track.id];
  const distance = raceDistance(track, dog.classKey);
  const hurdles = dog.classKey === 'hurdle';
  const trials = [];
  for (let i = 0; i < 2; i++) {
    const field = Array.from({ length: 5 }, () => makeDog(rng, { quality: 50 }));
    const trap = rng.int(1, 6);
    const runners = [];
    let k = 0;
    for (let t = 1; t <= 6; t++) runners.push({ trap: t, dog: t === trap ? dog : field[k++] });
    const going = rng.int(-2, 2) * 5;
    const sim = simulateRace({ track, distance, runners, seed: rng.int(1, 1e9), going, hurdles });
    const r = sim.results.find((x) => x.dog === dog);
    trials.push({ distance, trap, time: r.time, sectional: r.sectional, pos: r.position, going, calcTime: calcTime(r.time, going), comments: r.comments });
  }
  const std = standardTime(ts, distance, hurdles);
  return { trials, std };
}

/** Mostly standard-distance youngsters, sometimes another kind the home track stages. */
function pickSaleClass(rng, track) {
  const others = Object.keys(CLASSES).filter((k) => k !== 'standard' && raceDistance(track, k));
  return others.length && rng.chance(0.35) ? rng.pick(others) : 'standard';
}

/** The dogs for sale this week: unraced youngsters with trial times, plus a few raced dogs. */
export function salesList(world) {
  if (world.sales && world.day - world.sales.day < ECONOMY.salesEvery) return world.sales;
  const ts = trackState(world, world.player.homeTrack);
  const rng = makeRng(hashStr(`${world.seed}:sales:${world.day}`));
  const items = [];
  for (let i = 0; i < 5; i++) {
    const classKey = pickSaleClass(rng, trackById(ts.trackId));
    const dog = makeDog(rng, { quality: 52 + rng.normal() * 10 });
    classTweak(dog, classKey);
    Object.assign(dog, { age: 2, classKey, runs: [], lastRunDay: -99, homeTrack: ts.trackId, trainer: 'Breeder', id: `p${world.nextId++}` });
    const { trials } = runTrials(world, dog, rng);
    dog.trials = trials;
    // The breeder prices from the trial times (they don't know the hidden abilities either).
    const best = Math.min(...trials.map((t) => t.calcTime));
    const std = standardTime(ts, trials[0].distance, dog.classKey === 'hurdle');
    const lengthsFast = (std - best) / 0.08;
    const price = Math.max(150, Math.min(4000, Math.round((450 * Math.exp(lengthsFast / 7)) / 25) * 25));
    items.push({ dog, price, kind: 'youngster' });
  }
  // A few dogs from other kennels at your track, with full form.
  const others = ts.dogs.filter((d) => !isMine(d) && d.runs.length >= 3);
  for (let i = 0; i < 3 && others.length; i++) {
    const dog = others.splice(rng.int(0, others.length - 1), 1)[0];
    items.push({ dog, price: Math.round((dogValue(dog) * (0.9 + rng.next() * 0.3)) / 10) * 10, kind: 'raced' });
  }
  world.sales = { day: world.day, items };
  return world.sales;
}

/** Grade an unraced dog from its ability, the way a racing manager would from trials. */
export function gradeNewDog(ts, dog) {
  const cls = CLASSES[dog.classKey];
  const distance = raceDistance(trackById(ts.trackId), dog.classKey);
  const h = dog.classKey === 'hurdle';
  const same = ts.dogs.filter((d) => d.classKey === dog.classKey);
  const better = same.filter((d) => overallRating(d, distance, h) > overallRating(dog, distance, h)).length;
  return Math.min(cls.grades - 1, Math.floor((better / Math.max(1, same.length)) * cls.grades));
}

export function buyDog(world, item) {
  if (world.balance < item.price) return { ok: false, message: 'Not enough money.' };
  const ts = world.tracks[world.player.homeTrack];
  const { dog } = item;
  if (item.kind === 'youngster') {
    dog.grade = gradeNewDog(ts, dog);
    ts.dogs.push(dog);
  }
  takeOn(world, dog);
  addLedger(world, `Bought ${dog.name}`, -item.price);
  world.sales.items = world.sales.items.filter((x) => x !== item);
  return { ok: true, message: `${dog.name} is yours.` };
}

/** Kinds of race your dog could switch to at your home track (other than its own). */
export function switchOptions(world, dog) {
  const track = trackById(world.player.homeTrack);
  return Object.keys(CLASSES).filter((k) => k !== dog.classKey && raceDistance(track, k));
}

/** Move one of your dogs to another kind of race (e.g. hurdles). It's graded again from scratch. */
export function switchClass(world, dog, classKey) {
  const ts = world.tracks[world.player.homeTrack];
  if (!switchOptions(world, dog).includes(classKey)) return { ok: false, message: 'Your track does not stage those races.' };
  for (const inst of world.cups || []) inst.playerEntries = inst.playerEntries.filter((id) => id !== dog.id);
  dog.classKey = classKey;
  dog.grade = gradeNewDog(ts, dog);
  return { ok: true, message: `${dog.name} will now run in ${CLASSES[classKey].name} races, graded ${CLASSES[classKey].prefix}${dog.grade + 1}.` };
}

export function sellDog(world, dog) {
  const price = sellPrice(dog);
  dog.owner = null;
  dog.trainer = world.tracks[world.player.homeTrack].trainers[0];
  delete dog.training; delete dog.entered; delete dog.fitness; delete dog.potential;
  addLedger(world, `Sold ${dog.name}`, price);
  return price;
}

/** A starter dog so a new kennel has something to run (a modest A6-A8 sort). */
export function giveStarterDog(world) {
  const ts = trackState(world, world.player.homeTrack);
  const candidates = ts.dogs.filter((d) => d.classKey === 'standard' && d.grade >= 5 && d.age <= 3 && d.runs.length >= 3);
  const dog = candidates[Math.floor(makeRng(world.seed).next() * candidates.length)] || ts.dogs[0];
  takeOn(world, dog);
  return dog;
}

// ---------------------------------------------------------------------------
// The trainer's view: abilities as stars, a bit off the truth

/** 1 to 5 stars (in halves) for each ability, as your trainer judges it. */
export function trainerStars(world, dog) {
  const rng = makeRng(hashStr(`${world.seed}:${dog.id}:eye`));
  const out = {};
  for (const k of Object.keys(STAT_LABELS)) {
    const guess = (dog.stats[k] ?? 50) + rng.normal() * 6; // the same error every time, so changes show
    out[k] = Math.max(0.5, Math.min(5, Math.round(guess / 10) / 2));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Moving on a day

/**
 * End the day: run any races left tonight, then for each of your dogs apply
 * training and fitness and pay the bills. Returns notes for the player.
 */
export function advanceDay(world) {
  // Your home track's meeting goes ahead whether or not you go.
  const home = world.player.homeTrack;
  if (tracksRacingOn(world.day).some((t) => t.id === home)) todaysMeeting(world, home);
  // So do competition rounds your dogs are in, wherever they are.
  for (const inst of world.cups || []) {
    const round = Object.keys(inst.days).find((r) => inst.days[r] === world.day);
    if (!round) continue;
    const ids = round === 'heats' ? inst.playerEntries : [inst.field[round]].flat(2).filter(Boolean);
    if (ids.some((id) => myDogs(world).some((d) => d.id === id))) todaysMeeting(world, cupHost(inst));
  }
  const notes = finishToday(world);
  const dogs = myDogs(world);
  let bills = 0;
  for (const dog of dogs) {
    const plan = TRAINING[dog.training] || TRAINING.normal;
    const ranToday = dog.lastRunDay === world.day;
    const fitness = ranToday ? dog.fitness - RACE_FITNESS_COST : dog.fitness + (100 - dog.fitness) * plan.recovery;
    dog.fitness = Math.round(Math.max(30, Math.min(100, fitness)));
    // Training only takes when the dog is fit enough to work properly.
    const keen = ranToday ? 0.3 : dog.fitness >= 60 ? 1 : 0.4;
    for (const k of Object.keys(dog.stats)) {
      const room = (dog.potential?.[k] ?? dog.stats[k]) - dog.stats[k];
      if (room <= 0) continue;
      const rate = plan.stats.includes(k) ? GAIN_PER_DAY : dog.training === 'normal' ? NORMAL_GAIN : 0;
      const maturing = dog.age <= 3 ? DEVELOPERS.matureRate * Math.max(0, room - DEVELOPERS.matureFrom) : 0;
      dog.stats[k] = +(dog.stats[k] + (rate * Math.min(1, room / 5) + maturing) * keen).toFixed(3);
    }
    bills += ECONOMY.upkeepPerDay + plan.cost;
  }
  const breedingBills = breedingDay(world);
  if (bills + breedingBills) addLedger(world, `Kennel bills for ${dogs.length} dog${dogs.length === 1 ? '' : 's'}${breedingBills ? ' plus pups and retired dogs' : ''}`, -(bills + breedingBills));
  world.day++;
  if (isNewSeason(world.day)) newSeason(world);
  return notes;
}
