// Runs lots of races without graphics and prints balance statistics.
//   node tools/simtest.mjs [races]
import { makeRng } from '../src/rng.js';
import { makeField, overallRating } from '../src/dogs.js';
import { TRACKS } from '../src/track.js';
import { simulateRace } from '../src/sim.js';
import { loadGameData } from '../src/data.js';

await loadGameData();

const N = +(process.argv[2] || 600);
const rng = makeRng(12345);
const trapWins = [0, 0, 0, 0, 0, 0];
const favWins = { count: 0 };
const styleWins = { rail: 0, middle: 0, wide: 0 };
const styleRuns = { rail: 0, middle: 0, wide: 0 };
const times = {};
const comments = {};
let crowdedRaces = 0, totalMargin = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const track = TRACKS[i % TRACKS.length];
  const distance = track.distances[Math.floor(i / TRACKS.length) % 4];
  const runners = makeField(rng, 50);
  const res = simulateRace({ track, distance, runners, seed: rng.int(1, 1e9), going: rng.int(-20, 20) });
  const w = res.results[0];
  trapWins[w.trap - 1]++;
  const best = [...runners].sort((a, b) => overallRating(b.dog, distance) - overallRating(a.dog, distance))[0];
  if (best.trap === w.trap) favWins.count++;
  for (const r of runners) styleRuns[r.dog.style]++;
  styleWins[w.dog.style]++;
  const key = `${track.name} ${distance}`;
  (times[key] ||= []).push(res.winnerTime);
  totalMargin += res.results[5].behindLengths;
  if (res.results.some((r) => r.comments.includes('Crd'))) crowdedRaces++;
  for (const r of res.results) for (const c of r.comments.split(',')) comments[c.replace(/\d|RnUp|BkStr|RnIn/g, '')] = (comments[c.replace(/\d|RnUp|BkStr|RnIn/g, '')] || 0) + 1;
}
const pct = (x) => (100 * x / N).toFixed(1) + '%';
console.log(`${N} races in ${Date.now() - t0}ms`);
console.log('Trap win %:', trapWins.map((w, i) => `T${i + 1} ${pct(w)}`).join('  '));
console.log('Highest rated dog won:', pct(favWins.count));
console.log('Win rate per run by style:', Object.keys(styleWins).map((k) => `${k} ${(100 * styleWins[k] / styleRuns[k]).toFixed(1)}%`).join('  '));
console.log('Races with crowding:', pct(crowdedRaces), ' avg last-place distance behind:', (totalMargin / N).toFixed(1), 'lengths');
console.log('Comment counts:', Object.entries(comments).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('Winning times:');
for (const [k, v] of Object.entries(times).sort()) {
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  console.log(`  ${k.padEnd(20)} avg ${avg.toFixed(2)}s  (${Math.min(...v).toFixed(2)} - ${Math.max(...v).toFixed(2)})  n=${v.length}`);
}
