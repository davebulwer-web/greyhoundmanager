// Breeding, ageing and retirement. No DOM code here.
//
// Time for dogs runs in seasons of 120 days: every new season each dog is a
// year older. Young dogs still improve, five-year-olds slow down, and dogs
// retire at six. Your retired bitches can be bred from and your retired dogs
// stand at stud. Pups carry your kennel's first word, like a family name.

import { makeRng } from './rng.js';
import { makeDog, makeDogName, overallRating, COATS } from './dogs.js';
import { TRACKS, trackById, raceDistance } from './track.js';
import { SEASON_DAYS, seasonOf, ensureCups } from './cups.js';
import { CLASSES, addLedger, addNews, isMine, classTweak, trackState } from './world.js';
import { takeOn, gradeNewDog, dogValue } from './kennel.js';

export const BREEDING = {
  gestationDays: 21,     // mating to pups being born
  rearingDays: 60,       // birth to pups being ready to race
  litterGap: 100,        // days a brood bitch needs between litters
  puppyUpkeep: 2,        // per pup per day
  retiredUpkeep: 2,      // per brood bitch or stud dog per day
  puppySale: 150,        // what an unraced pup sells for
  retireAge: 6,
  minBroodAge: 2,
  maxPups: 6,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};

function player(world) {
  const p = world.player;
  p.broods ||= [];
  p.studs ||= [];
  p.litters ||= [];
  p.puppies ||= [];
  p.prefix ||= defaultPrefix(p.name);
  return p;
}

export function defaultPrefix(kennelName) {
  const w = (kennelName || 'Home').trim().split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '') || 'Home';
  return w.endsWith("'s") ? w : `${w}'s`;
}

export function breedingState(world) {
  return player(world);
}

// ---------------------------------------------------------------------------
// Retiring

/** Take one of your dogs out of racing: bitches go to breed, dogs to stud. */
export function retireDog(world, dog) {
  const p = player(world);
  const ts = world.tracks[world.player.homeTrack];
  ts.dogs = ts.dogs.filter((d) => d !== dog);
  for (const inst of world.cups || []) inst.playerEntries = inst.playerEntries.filter((id) => id !== dog.id);
  dog.retiredDay = world.day;
  delete dog.entered; delete dog.training;
  if (dog.sex === 'Bitch') { p.broods.push(dog); return 'brood'; }
  p.studs.push(dog);
  return 'stud';
}

/** Let a retired dog go to a good home (it leaves your kennel). */
export function rehome(world, dog) {
  const p = player(world);
  p.broods = p.broods.filter((d) => d !== dog);
  p.studs = p.studs.filter((d) => d !== dog);
  addNews(world, `${dog.name} has gone to a loving home.`);
}

// ---------------------------------------------------------------------------
// Studs and matings

/** Dogs you can use as the sire: your own stud dogs (free) and top dogs at your track. */
export function studBook(world) {
  const p = player(world);
  const ts = world.tracks[world.player.homeTrack];
  const own = p.studs.map((dog) => ({ dog, fee: 0, own: true }));
  const top = ts.dogs
    .filter((d) => d.sex === 'Dog' && !isMine(d) && d.grade <= (d.classKey === 'standard' ? 1 : 0) && d.classKey !== 'marathon' && d.runs.length >= 3)
    .sort((a, b) => a.grade - b.grade || b.runs.filter((r) => r.pos === 1).length - a.runs.filter((r) => r.pos === 1).length)
    .slice(0, 8)
    .map((dog) => ({ dog, fee: Math.round((150 + dogValue(dog) * 0.25) / 25) * 25, own: false }));
  return [...own, ...top];
}

export function canMate(world, dam) {
  const p = player(world);
  if (p.litters.some((l) => l.damId === dam.id)) return 'Already in whelp.';
  if (dam.lastLitterDay !== undefined && world.day - dam.lastLitterDay < BREEDING.litterGap) {
    return `Needs a rest until day ${dam.lastLitterDay + BREEDING.litterGap}.`;
  }
  return null;
}

export function mate(world, dam, entry) {
  const p = player(world);
  const problem = canMate(world, dam);
  if (problem) return { ok: false, message: problem };
  if (world.balance < entry.fee) return { ok: false, message: 'Not enough money for the stud fee.' };
  if (entry.fee) addLedger(world, `Stud fee: ${entry.dog.name} to ${dam.name}`, -entry.fee);
  // Keep a copy of the sire's details, since he may retire or be sold later.
  const sire = { id: entry.dog.id, name: entry.dog.name, stats: { ...entry.dog.stats }, coat: entry.dog.coat, style: entry.dog.style, weight: entry.dog.weight, potential: entry.dog.potential };
  p.litters.push({ id: `l${world.nextId++}`, damId: dam.id, damName: dam.name, sire, matedDay: world.day, dueDay: world.day + BREEDING.gestationDays });
  dam.lastLitterDay = world.day;
  return { ok: true, message: `${dam.name} has been mated with ${entry.dog.name}. Pups due ${BREEDING.gestationDays} days from now.` };
}

function allNames(world) {
  const names = new Set();
  for (const ts of Object.values(world.tracks)) for (const d of ts.dogs) names.add(d.name);
  const p = player(world);
  for (const d of [...p.broods, ...p.studs, ...p.puppies.map((x) => x.dog)]) names.add(d.name);
  return names;
}

function whelp(world, litter) {
  const p = player(world);
  const dam = p.broods.find((d) => d.id === litter.damId);
  if (!dam) return [];
  const { sire } = litter;
  const rng = makeRng(hash(`${world.seed}:${litter.id}`));
  const taken = allNames(world);
  const count = rng.int(3, BREEDING.maxPups);
  const pups = [];
  for (let i = 0; i < count; i++) {
    const pup = makeDog(rng, { quality: 50, taken });
    pup.name = makeDogName(rng, taken, p.prefix);
    // Each ability comes from the parents, plus luck.
    const potential = {};
    for (const k of Object.keys(pup.stats)) {
      const mid = ((dam.stats[k] ?? 50) + (sire.stats[k] ?? 50)) / 2;
      pup.stats[k] = Math.round(clamp(mid + rng.normal() * 7, 5, 96));
      const room = (p) => (p.potential?.[k] ?? (p.stats[k] ?? 50) + 8) - (p.stats[k] ?? 50);
      const parentRoom = (room(dam) + room(sire)) / 2;
      potential[k] = Math.min(99, pup.stats[k] + Math.max(1, Math.round(parentRoom + rng.normal() * 4)));
    }
    pup.coat = rng.chance(0.4) ? dam.coat : rng.chance(0.65) ? sire.coat : rng.pick(COATS);
    pup.style = rng.chance(0.45) ? dam.style : rng.chance(0.8) ? sire.style : rng.pick(['rail', 'middle', 'wide']);
    pup.weight = +((pup.sex === 'Dog' ? 1.1 : 0.92) * (dam.weight + sire.weight) / 2 + rng.normal() * 1.2).toFixed(1);
    Object.assign(pup, {
      id: `b${world.nextId++}`, age: 1, runs: [], lastRunDay: -99, homeTrack: world.player.homeTrack,
      bornDay: world.day, damName: dam.name, sireName: sire.name, potentialStart: potential,
    });
    pups.push(pup);
    p.puppies.push({ dog: pup, readyDay: world.day + BREEDING.rearingDays });
  }
  dam.litters = (dam.litters || 0) + 1;
  addNews(world, `${dam.name} has had ${count} pups by ${sire.name}: ${pups.map((x) => x.name).join(', ')}. They'll be ready to trial in ${BREEDING.rearingDays} days.`);
  return pups;
}

/** A pup old enough to race: pick its trip, grade it from trials and put it in your kennel. */
function graduate(world, pup) {
  const ts = trackState(world, world.player.homeTrack);
  const s = pup.stats;
  const wanted = s.stamina - s.earlyPace > 18 ? 'stay' : s.earlyPace - s.stamina > 18 ? 'sprint' : 'standard';
  pup.classKey = raceDistance(trackById(ts.trackId), wanted) ? wanted : 'standard';
  pup.age = 2;
  pup.grade = gradeNewDog(ts, pup);
  ts.dogs.push(pup);
  takeOn(world, pup);
  pup.potential = { ...pup.potentialStart };
  delete pup.potentialStart;
  addNews(world, `${pup.name} has trialled and joins your kennel graded ${CLASSES[pup.classKey].prefix}${pup.grade + 1}.`);
}

export function sellPuppy(world, item) {
  const p = player(world);
  p.puppies = p.puppies.filter((x) => x !== item);
  addLedger(world, `Sold pup ${item.dog.name}`, BREEDING.puppySale);
}

// ---------------------------------------------------------------------------
// Each day and each new season

/** Daily: litters born, pups ready, bills for pups and retired dogs. Returns the bill. */
export function breedingDay(world) {
  const p = player(world);
  for (const litter of p.litters.filter((l) => l.dueDay <= world.day)) {
    whelp(world, litter);
    p.litters = p.litters.filter((l) => l !== litter);
  }
  for (const item of p.puppies.filter((x) => x.readyDay <= world.day)) {
    graduate(world, item.dog);
    p.puppies = p.puppies.filter((x) => x !== item);
  }
  return p.puppies.length * BREEDING.puppyUpkeep + (p.broods.length + p.studs.length) * BREEDING.retiredUpkeep;
}

/** Every 120 days: dogs get a year older, the oldest retire, and new youngsters join each track. */
export function newSeason(world) {
  const rng = makeRng(hash(`${world.seed}:season:${seasonOf(world.day)}`));
  const p = player(world);
  let retiredMine = [];
  for (const ts of Object.values(world.tracks)) {
    const track = TRACKS.find((t) => t.id === ts.trackId);
    const leaving = [];
    for (const dog of ts.dogs) {
      dog.age++;
      const change = dog.age <= 3 ? 1.5 : dog.age === 4 ? 0 : -2.5;
      for (const k of Object.keys(dog.stats)) {
        const cap = dog.potential?.[k] ?? 99;
        dog.stats[k] = +clamp(dog.stats[k] + change * (0.6 + rng.next() * 0.8), 5, change > 0 ? Math.max(cap, dog.stats[k]) : 99).toFixed(3);
        if (dog.potential && change < 0) dog.potential[k] = Math.max(dog.stats[k], dog.potential[k] - 2);
      }
      if (dog.age >= BREEDING.retireAge || (!isMine(dog) && dog.age === 5 && rng.chance(0.15))) leaving.push(dog);
    }
    for (const dog of leaving) {
      if (isMine(dog)) { retireDog(world, dog); retiredMine.push(dog); continue; }
      ts.dogs = ts.dogs.filter((d) => d !== dog);
      // A youngster takes its place.
      const fresh = makeDog(rng, { quality: 54 + rng.normal() * 9, taken: allNames(world) });
      classTweak(fresh, dog.classKey);
      Object.assign(fresh, {
        id: `y${world.nextId++}`, age: 2, classKey: dog.classKey, trainer: dog.trainer, homeTrack: ts.trackId, runs: [], lastRunDay: -99,
      });
      fresh.grade = gradeNewDog(ts, fresh);
      ts.dogs.push(fresh);
    }
    if (leaving.length) addNews(world, `${leaving.length} dogs retired at ${track?.name || ts.trackId} and youngsters have taken their places.`);
  }
  for (const dog of retiredMine) addNews(world, `${dog.name} has retired from racing at ${dog.age} and joins your ${dog.sex === 'Bitch' ? 'brood bitches' : 'stud dogs'}.`);
  ensureCups(world);
  addNews(world, `A new season begins. Every dog is a year older.`);
  return retiredMine;
}

export function isNewSeason(day) {
  return day % SEASON_DAYS === 0;
}

/** Rough worth of a racing dog in your kennel, re-exported for the page. */
export { overallRating };
