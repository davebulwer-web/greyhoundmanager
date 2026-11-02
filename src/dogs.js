// Greyhound generation. Every dog has hidden racing attributes (0-100) that
// drive the race simulation. The player never sees these numbers directly in
// the finished game; they have to read them from form, trials and trainers.

export const COATS = ['black', 'blue', 'fawn', 'red-fawn', 'brindle', 'white-black'];

export const STYLES = {
  rail: { label: 'Railer', lane: 0.04 },
  middle: { label: 'Middle', lane: 0.38 },
  wide: { label: 'Wide', lane: 0.6 },
};

const FIRST = [
  'Swift', 'Silver', 'Copper', 'Midnight', 'Rapid', 'Lucky', 'Velvet', 'Rusty', 'Storm', 'Brave',
  'Misty', 'Jet', 'Pepper', 'Ballyclare', 'Shady', 'Hollow', 'Golden', 'Blazing', 'Quiet', 'Ruby',
  'Northern', 'Crafty', 'Dancing', 'Willow', 'Smokey', 'Rocky', 'Fearless', 'Gentle', 'Dusty', 'Clever',
];
const SECOND = [
  'Arrow', 'Comet', 'Lad', 'Lass', 'Flyer', 'Rocket', 'Dancer', 'Echo', 'Spirit', 'Rascal',
  'Bandit', 'Breeze', 'Legend', 'Whisper', 'Jester', 'Monarch', 'Biscuit', 'Gambler', 'Pilot', 'Shadow',
  'Duchess', 'Rebel', 'Sparks', 'Voyager', 'Tornado', 'Bramble', 'Nugget', 'Outlaw', 'Ember', 'Ranger',
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function makeDogName(rng, taken = new Set()) {
  for (let i = 0; i < 50; i++) {
    const name = `${rng.pick(FIRST)} ${rng.pick(SECOND)}`;
    if (!taken.has(name)) { taken.add(name); return name; }
  }
  return `${rng.pick(FIRST)} ${rng.pick(SECOND)} ${rng.int(2, 9)}`;
}

/**
 * Create a random dog. `quality` (0-100) shifts all attributes so you can
 * build graded fields of similar ability.
 */
export function makeDog(rng, { quality = 50, taken } = {}) {
  const stat = (spread = 18) => Math.round(clamp(quality + rng.normal() * spread, 5, 98));
  const sex = rng.chance(0.5) ? 'Dog' : 'Bitch';
  return {
    id: `d${Math.floor(rng.next() * 1e9).toString(36)}`,
    name: makeDogName(rng, taken),
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
export function overallRating(dog, distance = 480) {
  const s = dog.stats;
  const staminaWeight = clamp((distance - 300) / 400, 0, 1);
  return (
    s.topSpeed * 0.34 +
    s.earlyPace * 0.14 +
    s.breakSpeed * 0.12 +
    s.cornering * 0.16 +
    s.stamina * (0.08 + 0.2 * staminaWeight) +
    s.consistency * 0.04
  );
}
