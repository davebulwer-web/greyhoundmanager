// Bets and how they pay out. No DOM code here.

import { dividends } from './market.js';

export const BET_TYPES = {
  win: { label: 'Win', picks: 1, lines: 1, help: 'Your dog must win. Paid at the price you took.' },
  ew: { label: 'Each way', picks: 1, lines: 2, help: 'Two bets: one to win, one to finish 1st or 2nd at a quarter of the odds.' },
  fc: { label: 'Forecast', picks: 2, lines: 1, help: 'Pick 1st and 2nd in the right order.' },
  rfc: { label: 'Reverse forecast', picks: 2, lines: 2, help: 'Pick the first two in either order (two bets).' },
  tc: { label: 'Tricast', picks: 3, lines: 1, help: 'Pick 1st, 2nd and 3rd in the right order.' },
};

/** What the bet costs: stake per line times the number of lines. */
export function betCost(bet) {
  return bet.stake * BET_TYPES[bet.type].lines;
}

export function describeBet(bet) {
  const t = BET_TYPES[bet.type];
  const picks = bet.traps.join(bet.type === 'rfc' ? ' / ' : '-');
  const price = bet.odds ? ` at ${bet.odds}` : '';
  return `${t.label} ${picks}${price}`;
}

/**
 * Work out a bet's return (stake included) from a finished race.
 * Returns { returned, note }.
 */
export function settleBet(bet, race) {
  const order = race.result.results.map((r) => r.trap);
  const div = dividends(race.market, order);
  const s = bet.stake;
  const [p1, p2, p3] = order;
  const [a, b, c] = bet.traps;
  switch (bet.type) {
    case 'win':
      return a === p1 ? { returned: s * bet.decimal, note: 'Winner' } : { returned: 0, note: 'Lost' };
    case 'ew': {
      const frac = bet.decimal - 1;
      if (a === p1) return { returned: s * bet.decimal + s * (1 + frac / 4), note: 'Won and placed' };
      if (a === p2) return { returned: s * (1 + frac / 4), note: 'Placed 2nd' };
      return { returned: 0, note: 'Lost' };
    }
    case 'fc':
      return a === p1 && b === p2 ? { returned: s * div.forecast, note: `Forecast paid £${div.forecast.toFixed(2)}` } : { returned: 0, note: 'Lost' };
    case 'rfc':
      return (a === p1 && b === p2) || (a === p2 && b === p1)
        ? { returned: s * div.forecast, note: `Forecast paid £${div.forecast.toFixed(2)}` } : { returned: 0, note: 'Lost' };
    case 'tc':
      return a === p1 && b === p2 && c === p3 ? { returned: s * div.tricast, note: `Tricast paid £${div.tricast.toFixed(2)}` } : { returned: 0, note: 'Lost' };
    default:
      return { returned: 0, note: '' };
  }
}
