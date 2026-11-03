// The betting market. The bookmaker only knows what a punter could know:
// recent finishing times against the track standard, the trap draw and a bit
// of guesswork. It never sees a dog's hidden abilities, so the odds can be wrong,
// which is where the player can find value.
// No DOM code here.

export const MARKET = {
  recentWeights: [1, 0.8, 0.6, 0.45, 0.35], // how much each recent run counts, newest first
  spread: 4.2,       // lengths of rating that make one dog e^1 times more likely than another
  guesswork: 0.5,    // random error in the bookmaker's rating (lengths)
  overround: 1.2,    // the bookmaker's margin: prices add up to 120%
  longshotBias: 0.9, // < 1 makes outsiders a bit shorter than they should be
  drawPenalty: 1.2,  // lengths knocked off a railer drawn wide or a wide runner drawn on the inside
  forecastTake: 0.2, // share of the forecast pool kept by the track
  tricastTake: 0.25,
};

// Fractional odds a bookmaker would actually offer, shortest first.
const LADDER = [
  [1, 5], [2, 9], [1, 4], [2, 7], [1, 3], [4, 11], [2, 5], [4, 9], [1, 2], [8, 15], [4, 7], [8, 13],
  [4, 6], [8, 11], [4, 5], [5, 6], [10, 11], [1, 1], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8],
  [7, 4], [15, 8], [2, 1], [9, 4], [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1],
  [11, 2], [6, 1], [13, 2], [7, 1], [15, 2], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [14, 1], [16, 1],
  [20, 1], [25, 1], [33, 1], [40, 1], [50, 1],
];

export function oddsText(num, den) {
  return num === den ? 'Evs' : `${num}/${den}`;
}

/** Nearest ladder price at or below the fair price (bookmakers round in their favour). */
export function toFractional(prob) {
  const fair = 1 / prob - 1;
  let best = LADDER[0];
  for (const step of LADDER) if (step[0] / step[1] <= fair + 1e-9) best = step;
  return best;
}

function rating(dog, trap) {
  const w = MARKET.recentWeights;
  const runs = dog.runs.slice(0, w.length);
  let r;
  if (runs.length) {
    let sum = 0, wsum = 0;
    runs.forEach((run, i) => { sum += run.fig * w[i]; wsum += w[i]; });
    r = sum / wsum;
  } else {
    r = -dog.grade * 1.5; // unraced: go by the grade it was given
  }
  if (dog.style === 'rail' && trap >= 5) r -= MARKET.drawPenalty;
  if (dog.style === 'wide' && trap <= 2) r -= MARKET.drawPenalty;
  return r;
}

/**
 * Price a race. Returns { runners: [{ trap, prob, num, den, odds, decimal }] } where
 * prob is the bookmaker's fair chance (adds up to 1) and odds is what's offered.
 */
export function priceRace(ts, race, rng) {
  const ratings = race.runners.map(({ dog, trap }) => rating(dog, trap) + rng.normal() * MARKET.guesswork);
  const top = Math.max(...ratings);
  const raw = ratings.map((r) => Math.exp((r - top) / MARKET.spread));
  const total = raw.reduce((a, b) => a + b, 0);
  const fair = raw.map((x) => x / total);
  const biased = fair.map((p) => p ** MARKET.longshotBias);
  const btotal = biased.reduce((a, b) => a + b, 0);
  return {
    runners: race.runners.map(({ trap }, i) => {
      const [num, den] = toFractional(Math.min(0.95, (biased[i] / btotal) * MARKET.overround));
      return { trap, prob: fair[i], num, den, odds: oddsText(num, den), decimal: 1 + num / den };
    }),
  };
}

/** Forecast (1st and 2nd in order) and tricast (1st, 2nd, 3rd) dividends to a £1 stake. */
export function dividends(market, order) {
  const p = new Map(market.runners.map((m) => [m.trap, m.prob]));
  const [a, b, c] = order.map((t) => p.get(t));
  const pf = a * (b / (1 - a));
  const pt = pf * (c / (1 - a - b));
  return {
    forecast: Math.max(1.5, +((1 - MARKET.forecastTake) / pf).toFixed(2)),
    tricast: Math.max(2, +((1 - MARKET.tricastTake) / pt).toFixed(2)),
  };
}
