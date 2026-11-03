// Runs a kennel for a few months with no graphics: buys dogs, trains them,
// moves the calendar on, and checks money and saving.
//   node tools/kenneltest.mjs [days]
import { loadGameData } from '../src/data.js';
import { createWorld } from '../src/world.js';
import { advanceDay, giveStarterDog, salesList, buyDog, myDogs, TRAINING } from '../src/kennel.js';
import { serialize, deserialize } from '../src/save.js';

await loadGameData();
const days = +(process.argv[2] || 90);
let t0 = Date.now();
let world = createWorld(777, { name: 'Test Kennel', homeTrack: 'hove' });
const starter = giveStarterDog(world);
console.log(`New world + starter dog (${starter.name}, A${starter.grade + 1}) in ${Date.now() - t0}ms`);
const sale = salesList(world);
console.log('For sale:', sale.items.map((i) => `${i.dog.name} ${i.kind} £${i.price}`).join(', '));
for (const item of [...sale.items].sort((a, b) => a.price - b.price).slice(0, 2)) buyDog(world, item);
const plans = Object.keys(TRAINING);
myDogs(world).forEach((d, i) => { d.training = plans[(i + 2) % plans.length]; });
const start = myDogs(world).map((d) => ({ d, stats: { ...d.stats } }));
console.log(`Bought dogs; balance £${world.balance}`);

t0 = Date.now();
for (let i = 0; i < days; i++) {
  advanceDay(world);
  if (i === Math.floor(days / 2)) {
    // Save and load half way through, and carry on with the loaded world.
    const text = serialize(world);
    console.log(`Save size on day ${world.day}: ${(text.length / 1024).toFixed(0)} KB`);
    world = deserialize(text);
  }
}
console.log(`${days} days in ${Date.now() - t0}ms. Balance £${world.balance.toFixed(2)}`);
for (const { d: before, stats } of start) {
  const d = myDogs(world).find((x) => x.id === before.id);
  const gains = Object.keys(stats).map((k) => `${k} ${(d.stats[k] - stats[k]).toFixed(1)}`).join(', ');
  console.log(`  ${d.name} (${d.training}): ${d.runs.length} runs, now ${d.classKey} grade ${d.grade + 1}, fitness ${d.fitness}, earned £${d.earnings || 0}. Gains: ${gains}`);
}
const income = world.ledger.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);
const spend = world.ledger.filter((l) => l.amount < 0 && !l.text.startsWith('Bought')).reduce((a, l) => a + l.amount, 0);
console.log(`Prize money and fees £${income.toFixed(0)}, bills £${(-spend).toFixed(0)}`);

// ---- Step 4: a season of breeding, competitions and ageing ----
import { retireDog, studBook, mate, breedingState } from '../src/breeding.js';
import { cupsByDate, entryProblem, cupById } from '../src/cups.js';
const bitch = myDogs(world).find((d) => d.sex === 'Bitch') || myDogs(world)[0];
const role = retireDog(world, bitch);
const studs = studBook(world);
console.log(`Retired ${bitch.name} (${role}). Stud book: ${studs.map((s) => `${s.dog.name} £${s.fee}`).join(', ')}`);
if (role === 'brood') console.log(mate(world, bitch, studs[0]).message);
// Enter every eligible dog in every open competition.
for (const inst of cupsByDate(world)) {
  for (const d of myDogs(world)) {
    if (!entryProblem(world, inst, d)) { inst.playerEntries.push(d.id); console.log(`Entered ${d.name} in ${cupById(inst.cupId).name}`); }
  }
}
const ageBefore = myDogs(world).map((d) => d.age);
t0 = Date.now();
for (let i = 0; i < 150; i++) advanceDay(world);
const bs = breedingState(world);
console.log(`150 more days in ${Date.now() - t0}ms (day ${world.day}). Balance £${world.balance.toFixed(2)}`);
console.log(`Kennel: ${myDogs(world).map((d) => `${d.name} age ${d.age} ${d.classKey} grade ${d.grade + 1}`).join('; ')} (ages before ${ageBefore})`);
console.log(`Pups waiting: ${bs.puppies.length}, broods ${bs.broods.length}, studs ${bs.studs.length}`);
for (const inst of cupsByDate(world).filter((c) => c.stage === 'done')) {
  console.log(`  ${cupById(inst.cupId).name} season ${inst.season}: won by ${inst.winner}`, inst.playerEntries.length ? `(you had ${inst.playerEntries.length} entered)` : '');
}
console.log('News:', world.news.slice(0, 6).map((n) => n.text).join(' | '));
const text2 = serialize(world);
const back = deserialize(text2);
console.log(`Final save ${(text2.length / 1024).toFixed(0)} KB, loads back with ${myDogs(back).length} dogs and ${back.cups.length} competitions`);
