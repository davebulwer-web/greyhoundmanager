// Step 1 test bench: pick a track, distance and grade, generate a field,
// and watch the race. Later steps build the full game around this.

import { loadAssets } from './assets.js';
import { makeRng, randomSeed } from './rng.js';
import { makeField, STYLES } from './dogs.js';
import { TRACKS, trackById } from './track.js';
import { simulateRace, DOG_LENGTH_M } from './sim.js';
import { RaceView, PRE_START } from './raceView.js';
import { MiniMap } from './minimap.js';

const $ = (id) => document.getElementById(id);
const GRADES = [
  { label: 'A1', quality: 72 }, { label: 'A2', quality: 66 }, { label: 'A3', quality: 60 },
  { label: 'A4', quality: 54 }, { label: 'A5', quality: 48 }, { label: 'A6', quality: 42 },
  { label: 'A7', quality: 36 }, { label: 'A8', quality: 30 },
];

const state = {
  race: null, track: null, grade: null, raceNo: 0,
  t: -PRE_START, speed: 1, mode: 'pre', // pre | running | done
  lastFrame: 0,
};

const trapBadge = (trap) => `<span class="trap trap-${trap}">${trap}</span>`;

function fillSelects() {
  $('sel-track').innerHTML = TRACKS.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  $('sel-grade').innerHTML = GRADES.map((g, i) => `<option value="${i}" ${i === 3 ? 'selected' : ''}>${g.label}</option>`).join('');
  const fillDistances = () => {
    const track = trackById($('sel-track').value);
    $('sel-distance').innerHTML = track.distances.map((d, i) => `<option ${i === 1 ? 'selected' : ''}>${d}</option>`).join('');
  };
  $('sel-track').addEventListener('change', fillDistances);
  fillDistances();
}

function newRace(view, map) {
  const seed = randomSeed();
  const rng = makeRng(seed);
  const track = trackById($('sel-track').value);
  const distance = +$('sel-distance').value;
  const grade = GRADES[+$('sel-grade').value];
  const going = rng.int(-4, 4) * 5;
  const runners = makeField(rng, grade.quality);
  const race = simulateRace({ track, distance, runners, seed, going });

  Object.assign(state, { race, track, grade, t: -PRE_START, mode: 'pre' });
  state.raceNo++;
  view.setRace(race, track);
  map.setRace(race, track);

  $('meeting').textContent = `${track.name} · Race ${state.raceNo}`;
  $('race-info').textContent = `${distance}m · Grade ${grade.label} · Going ${going > 0 ? '+' : ''}${going}`;
  $('map-track').textContent = track.name;
  $('map-going').textContent = `Going ${going > 0 ? '+' : ''}${going}`;
  $('map-foot').textContent = `${distance}m`;
  $('banner').classList.add('hidden');
  $('btn-start').disabled = false;
  $('btn-replay').disabled = true;
  $('result').innerHTML = '';
  $('result-note').textContent = 'Race not run yet.';

  $('card').innerHTML = race.runners.map(({ trap, dog }) => `
    <tr>
      <td>${trapBadge(trap)}</td>
      <td>${dog.name}</td>
      <td>${dog.age} (${dog.sex})</td>
      <td>${dog.weight}</td>
      <td>${({ 'white-black': 'white & black', 'red-fawn': 'red fawn' })[dog.coat] || dog.coat}</td>
      <td>${STYLES[dog.style].label}</td>
      ${['breakSpeed', 'earlyPace', 'topSpeed', 'stamina', 'cornering', 'consistency'].map((k) => `<td class="stat">${dog.stats[k]}</td>`).join('')}
    </tr>`).join('');
  render(view, map, true);
}

function render(view, map, snap = false) {
  const states = view.draw(state.t, { snap });
  map.draw(states);
  const { race } = state;
  const t = Math.max(0, state.t);
  $('clock').textContent = t.toFixed(2);

  // Leaderboard: order by distance run; finished dogs keep finishing order.
  const finishedBy = new Map(race.results.map((r) => [r.trap, r]));
  const rows = states.map((s, i) => ({ ...s, runner: race.runners[i] }));
  rows.sort((a, b) => {
    const fa = a.d >= race.distance ? finishedBy.get(a.runner.trap).time : Infinity;
    const fb = b.d >= race.distance ? finishedBy.get(b.runner.trap).time : Infinity;
    if (fa !== fb) return fa - fb;
    return b.d - a.d;
  });
  const leadD = rows[0].d;
  $('leaderboard').innerHTML = rows.map((r, i) => {
    const res = finishedBy.get(r.runner.trap);
    let gap = '';
    if (r.d >= race.distance) gap = i === 0 ? res.time.toFixed(2) : res.margin;
    else if (i > 0 && state.t > 0) gap = `${((leadD - r.d) / DOG_LENGTH_M).toFixed(1)}L`;
    return `<li><span class="pos">${i + 1}.</span>${trapBadge(r.runner.trap)}<span>${r.runner.dog.name}</span><span class="gap">${gap}</span></li>`;
  }).join('');

  const left = Math.max(0, Math.ceil(race.distance - leadD));
  $('dist-left').textContent = left > 0 ? `${left}m` : 'FINISH';
}

function showResult() {
  const { race } = state;
  const w = race.results[0];
  $('banner').innerHTML = `WINNER<br>${trapBadge(w.trap)} ${w.dog.name}<br>${w.time.toFixed(2)}s`;
  $('banner').classList.remove('hidden');
  $('result-note').textContent = `${state.track.name} ${race.distance}m · winning time ${race.winnerTime.toFixed(2)}`;
  $('result').innerHTML = race.results.map((r) => `
    <tr>
      <td>${r.position}</td><td>${trapBadge(r.trap)}</td><td>${r.dog.name}</td>
      <td>${r.margin}</td><td>${r.time.toFixed(2)}</td><td>${r.sectional.toFixed(2)}</td>
      <td>${r.bendFigures}</td><td>${r.comments}</td>
    </tr>`).join('');
  $('btn-replay').disabled = false;
}

function loop(view, map) {
  const tick = (now) => {
    const realDt = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    if (state.mode === 'running') {
      state.t += realDt * state.speed;
      if (state.t >= view.endTime) {
        state.t = view.endTime;
        state.mode = 'done';
        showResult();
      }
      render(view, map);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame((now) => { state.lastFrame = now; tick(now); });
}

async function boot() {
  const assets = await loadAssets();
  const view = new RaceView($('race'), assets);
  const map = new MiniMap($('map'));
  fillSelects();

  $('btn-start').addEventListener('click', () => {
    if (state.mode !== 'pre') return;
    state.mode = 'running';
    $('btn-start').disabled = true;
  });
  $('btn-skip').addEventListener('click', () => {
    if (state.mode === 'done') return;
    state.t = view.endTime - 0.01;
    state.mode = 'running';
    $('btn-start').disabled = true;
  });
  $('btn-replay').addEventListener('click', () => {
    view.setRace(state.race, state.track);
    state.t = -PRE_START;
    state.mode = 'running';
    $('banner').classList.add('hidden');
  });
  $('btn-new').addEventListener('click', () => newRace(view, map));
  document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => {
    state.speed = +b.dataset.speed;
    document.querySelectorAll('.speed button').forEach((o) => o.classList.toggle('on', o === b));
  }));
  $('chk-stats').addEventListener('change', (e) => document.body.classList.toggle('show-stats', e.target.checked));

  newRace(view, map);
  loop(view, map);
}

boot().catch((err) => {
  console.error(err);
  $('meeting').textContent = `Could not start: ${err.message}. Run the game from a local web server (see README).`;
});
