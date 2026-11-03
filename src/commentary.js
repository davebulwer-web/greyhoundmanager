// Race commentary: a few lines of text, each tied to a moment in the race,
// written from the simulation's frames and results. No DOM code here.

import { DT, FRAME_STRIDE } from './sim.js';

function leaderAt(sim, k) {
  const f = sim.frames[Math.min(k, sim.frames.length - 1)];
  const n = sim.runners.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => f[b * FRAME_STRIDE] - f[a * FRAME_STRIDE]);
  return order.map((i) => ({ i, d: f[i * FRAME_STRIDE] }));
}

/** Returns [{ t, text }] in time order. */
export function buildCommentary(sim) {
  const lines = [];
  const name = (i) => sim.runners[i].dog.name;
  const say = (t, text) => lines.push({ t, text });

  say(0, 'The traps open!');
  const quick = sim.results.filter((r) => r.comments.includes('QAw')).sort((a, b) => a.reaction - b.reaction);
  const missed = sim.results.filter((r) => r.comments.includes('MsdBrk'));
  if (missed.length) say(0.7, `${missed[0].dog.name} has missed the break!`);
  else if (quick.length) say(0.7, `Trap ${quick[0].trap}, ${quick[0].dog.name}, flies out.`);
  else say(0.7, 'A level break.');

  // Who leads at a few points of the race.
  const frameAtLeaderD = (d) => {
    for (let k = 0; k < sim.frames.length; k++) if (leaderAt(sim, k)[0].d >= d) return k;
    return sim.frames.length - 1;
  };
  const marks = [{ d: sim.sectionalDistance, kind: 'first' }];
  if (sim.distance > 330) marks.push({ d: sim.distance * 0.55, kind: 'middle' });
  marks.push({ d: sim.distance - 105, kind: 'last' });
  let lastLeader = null;
  for (const m of marks) {
    const k = frameAtLeaderD(m.d);
    const [a, b] = leaderAt(sim, k);
    const t = k * DT;
    const close = (a.d - b.d) < 1.2;
    if (m.kind === 'first') {
      say(t, `${name(a.i)} leads into the first bend${close ? `, ${name(b.i)} right there` : ` from ${name(b.i)}`}.`);
    } else if (m.kind === 'middle') {
      say(t, a.i !== lastLeader ? `${name(a.i)} has taken it up down the back straight!` : `${name(a.i)} still in front${close ? `, ${name(b.i)} on the heels` : ', going well'}.`);
    } else {
      say(t, a.i !== lastLeader ? `Round the last bend and ${name(a.i)} hits the front!` : `Into the home straight, ${name(a.i)} leads${close ? ` but ${name(b.i)} is closing` : ''}.`);
    }
    lastLeader = a.i;
  }

  // Trouble in running (at most two moments, a second apart).
  const trouble = sim.results
    .flatMap((r) => (r.events || []).map((e) => ({ ...e, r })))
    .sort((a, b) => a.t - b.t);
  let shown = 0, lastT = -9;
  for (const e of trouble) {
    if (shown >= 2 || e.t < 1.5 || e.t - lastT < 1.5) continue;
    const where = e.where === '1' ? 'at the first bend' : e.where === '3' ? 'at the third bend' : e.where === 'run-up' ? 'on the run to the bend' : '';
    say(e.t, `${e.type === 'crowded' ? 'Trouble' : 'Bumping'} ${where}! ${e.r.dog.name} ${e.type === 'crowded' ? 'is checked' : 'takes a knock'}.`);
    shown++; lastT = e.t;
  }

  const [w, second] = sim.results;
  const marginText = second.margin;
  const tight = ['DH', 'SH', 'Hd', 'Nk'].includes(marginText);
  say(w.time, tight
    ? `A photo finish! ${w.dog.name} just gets it from ${second.dog.name}.`
    : `${w.dog.name} (trap ${w.trap}) wins by ${marginText} ${/^\d+( |$)/.test(marginText) && marginText !== '1' ? 'lengths' : 'length'}!`);
  return lines.sort((a, b) => a.t - b.t);
}
