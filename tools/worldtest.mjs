// Builds a racing world with no graphics and checks the form and betting market.
//   node tools/worldtest.mjs [days]
import { loadGameData } from '../src/data.js';
import { TRACKS } from '../src/track.js';
import { createWorld, trackState, getMeeting, tracksRacingOn, CLASSES } from '../src/world.js';

await loadGameData();
const days = +(process.argv[2] || 120);
const t0 = Date.now();
const world = createWorld(4242);
world.day = days;
for (const t of TRACKS) trackState(world, t.id);
console.log(`${TRACKS.length} tracks, ${days} days of racing in ${Date.now() - t0}ms`);

// Look back through every dog's form.
let runs = 0, favRuns = 0, favWins = 0, flat = 0;
const buckets = {};
const trapWins = [0, 0, 0, 0, 0, 0];
let races = 0;
const gradeCounts = {};
for (const t of TRACKS) {
  const ts = world.tracks[t.id];
  for (const dog of ts.dogs) {
    const key = `${dog.classKey} ${CLASSES[dog.classKey].prefix}${dog.grade + 1}`;
    gradeCounts[key] = (gradeCounts[key] || 0) + 1;
    for (const r of dog.runs) {
      if (r.day < 40) continue; // skip the settling-in period
      runs++;
      const [num, den] = r.sp.replace('F', '').replace('Evs', '1/1').split('/').map(Number);
      const dec = 1 + num / den;
      const implied = 1 / dec;
      const b = implied < 0.15 ? '<15%' : implied < 0.25 ? '15-25%' : implied < 0.4 ? '25-40%' : '40%+';
      (buckets[b] ||= { n: 0, w: 0, imp: 0 });
      buckets[b].n++; buckets[b].imp += implied; if (r.pos === 1) buckets[b].w++;
      flat += (r.pos === 1 ? dec : 0) - 1;
      if (r.sp.endsWith('F')) { favRuns++; if (r.pos === 1) favWins++; }
      if (r.pos === 1) { trapWins[r.trap - 1]++; races++; }
    }
  }
}
console.log('Favourites won:', (100 * favWins / favRuns).toFixed(1) + '%', `(${favRuns} favs; real greyhound favourites win about 35%)`);
console.log('£1 on every runner returns:', (100 * flat / runs).toFixed(1) + '% (bookmaker margin, expect about -15 to -25%)');
for (const [b, v] of Object.entries(buckets)) {
  console.log(`  priced ${b.padEnd(6)} runs ${String(v.n).padStart(5)}  priced to win ${(100 * v.imp / v.n).toFixed(1)}%  actually won ${(100 * v.w / v.n).toFixed(1)}%`);
}
console.log('Trap wins:', trapWins.map((w, i) => `T${i + 1} ${(100 * w / races).toFixed(1)}%`).join('  '));
const avgRuns = TRACKS.reduce((a, t) => a + world.tracks[t.id].dogs.reduce((x, d) => x + d.runs.length, 0) / world.tracks[t.id].dogs.length, 0) / TRACKS.length;
console.log('Average runs per dog:', avgRuns.toFixed(1));
console.log('Dogs per grade:', Object.entries(gradeCounts).map(([k, v]) => `${k.split(' ')[1]} ${v / TRACKS.length}`).join('  '));
const m = getMeeting(world, tracksRacingOn(world.day)[0].id);
console.log(`Today's card at ${m.trackId}: ${m.races.length} races`, m.races.map((r) => `${r.time} ${r.gradeLabel} ${r.distance}`).join(', '));

// Winning times and margins by grade (from the winners' form lines).
const byGrade = {};
for (const t of TRACKS) {
  for (const dog of world.tracks[t.id].dogs) {
    for (const r of dog.runs) {
      if (r.day < 40 || r.pos !== 1 || t.id !== 'kestrel') continue;
      const g = (byGrade[r.grade] ||= { n: 0, time: 0, by: 0 });
      g.n++; g.time += r.calcTime;
      g.by += r.by === 'DH' ? 0 : r.by === 'SH' ? 0.1 : r.by === 'Hd' ? 0.2 : r.by === 'Nk' ? 0.35 : eval(r.by.replace(' ', '+'));
    }
  }
}
console.log('Kestrel Park, by grade: average winning time (going corrected) and winning margin');
for (const [g, v] of Object.entries(byGrade).sort()) console.log(`  ${g}: ${(v.time / v.n).toFixed(2)}s, won by ${(v.by / v.n).toFixed(1)} lengths (${v.n} races)`);
