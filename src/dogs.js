// Greyhound generation. Every dog has hidden racing attributes (0-100) that
// drive the race simulation. The player never sees these numbers directly in
// the finished game; they have to read them from form, trials and trainers.

export const COATS = ['black', 'blue', 'fawn', 'red-fawn', 'brindle', 'white-black'];

export const STYLES = {
  rail: { label: 'Railer', lane: 0.04 },
  middle: { label: 'Middle', lane: 0.38 },
  wide: { label: 'Wide', lane: 0.6 },
};

// Name words come from data/names.json (loaded by src/data.js).
let NAMES = { firstWords: ['Unnamed'], secondWords: ['Dog'], trainerFirstNames: ['A.'], trainerSurnames: ['Trainer'], maxNameLength: 16 };
let usable = null; // first words worked out from NAMES (cleared when the names change)
export function setNames(names) {
  NAMES = { ...NAMES, ...names };
  usable = null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Second words that keep the whole name within maxNameLength (16, as in real
 * British racing). If none fit, the shortest few are used anyway. */
function secondWordsFor(first) {
  const max = NAMES.maxNameLength || 99;
  const fit = NAMES.secondWords.filter((w) => first.length + 1 + w.length <= max);
  return fit.length ? fit : [...NAMES.secondWords].sort((a, b) => a.length - b.length).slice(0, 5);
}

/** First words with enough second words to go with them. */
function usableFirstWords() {
  if (usable) return usable;
  const ok = NAMES.firstWords.filter((w) => secondWordsFor(w).length >= 3
    && w.length + 1 + Math.min(...NAMES.secondWords.map((x) => x.length)) <= (NAMES.maxNameLength || 99));
  usable = ok.length ? ok : NAMES.firstWords;
  return usable;
}

/** A kennel's first word, shared by every dog it breeds. */
export function pickFirstWord(rng) {
  return rng.pick(usableFirstWords());
}

/** A dog name. Pass `first` to keep a kennel's first word (litter mates). */
export function makeDogName(rng, taken = new Set(), first = null) {
  for (let i = 0; i < 60; i++) {
    const f = first || rng.pick(usableFirstWords());
    const name = `${f} ${rng.pick(secondWordsFor(f))}`;
    if (!taken.has(name)) { taken.add(name); return name; }
  }
  const f = first || rng.pick(usableFirstWords());
  const name = `${f} ${rng.pick(secondWordsFor(f))} ${rng.int(2, 99)}`;
  taken.add(name);
  return name;
}

export function makeTrainerName(rng, taken = new Set()) {
  for (let i = 0; i < 60; i++) {
    const name = `${rng.pick(NAMES.trainerFirstNames)} ${rng.pick(NAMES.trainerSurnames)}`;
    if (!taken.has(name)) { taken.add(name); return name; }
  }
  return `${rng.pick(NAMES.trainerFirstNames)} ${rng.pick(NAMES.trainerSurnames)}`;
}

/**
 * Create a random dog. `quality` (0-100) shifts all attributes so you can
 * build graded fields of similar ability.
 */
export function makeDog(rng, { quality = 50, taken, firstWord = null } = {}) {
  const stat = (spread = 18) => Math.round(clamp(quality + rng.normal() * spread, 5, 98));
  const sex = rng.chance(0.5) ? 'Dog' : 'Bitch';
  return {
    id: `d${Math.floor(rng.next() * 1e9).toString(36)}`,
    name: makeDogName(rng, taken, firstWord),
    sex,
    age: rng.int(2, 5),
    coat: rng.pick(COATS),
    weight: +(sex === 'Dog' ? rng.range(31, 37) : rng.range(26.5, 31.5)).toFixed(1),
    style: rng.pick(['rail', 'rail', 'middle', 'middle', 'wide']),
    stats: {
      breakSpeed: stat(),   // reaction when the traps open
      earlyPace: stat(),    // acceleration to top speed
      topSpeed: stat(14),   // maximum speed
      stamina: stat(),      // how far top speed can be held
      cornering: stat(),    // how well speed is kept through the bends
      consistency: stat(),  // how much day-to-day performance varies
      jumping: stat(),      // how cleanly and quickly it clears hurdles
    },
  };
}

/** A field of six dogs of broadly similar quality, already drawn into traps 1-6. */
export function makeField(rng, quality = 50) {
  const taken = new Set();
  const dogs = Array.from({ length: 6 }, () => makeDog(rng, { quality: quality + rng.normal() * 6, taken }));
  return dogs.map((dog, i) => ({ dog, trap: i + 1 }));
}

/** A rough single "ability" number, handy for odds and for testing the sim. */
export function overallRating(dog, distance = 480, hurdles = false) {
  const s = dog.stats;
  const staminaWeight = clamp((distance - 300) / 400, 0, 1);
  return (hurdles ? ((s.jumping ?? 50) - 50) * 0.3 : 0) + (
    s.topSpeed * 0.34 +
    s.earlyPace * 0.14 +
    s.breakSpeed * 0.12 +
    s.cornering * 0.16 +
    s.stamina * (0.08 + 0.2 * staminaWeight) +
    s.consistency * 0.04
  );
}
