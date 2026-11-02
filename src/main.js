// Step 2: race meetings. Pick a meeting, read the racecards, place bets and
// watch the races. Form, grades and prices carry on from meeting to meeting.

import { loadAssets } from './assets.js';
import { loadGameData } from './data.js';
import { randomSeed } from './rng.js';
import { STYLES } from './dogs.js';
import { trackById } from './track.js';
import { simulateRace, DOG_LENGTH_M } from './sim.js';
import { RaceView, PRE_START } from './raceView.js';
import { MiniMap } from './minimap.js';
import {
  createWorld, todaysMeeting, tracksRacingOn, runRace, nextRace, formatDay, formatShortDate,
  formFigures, bestTime, penPicture, SEED_LETTER,
} from './world.js';
import { dividends } from './market.js';
import { BET_TYPES, betCost, describeBet, settleBet } from './betting.js';

const $ = (id) => document.getElementById(id);
const money = (x) => `£${x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const trapBadge = (trap) => `<span class="trap trap-${trap}">${trap}</span>`;
const COAT_LABEL = { 'white-black': 'white & black', 'red-fawn': 'red fawn' };
const STAT_KEYS = [['breakSpeed', 'Brk'], ['earlyPace', 'Early'], ['topSpeed', 'Speed'], ['stamina', 'Stam'], ['cornering', 'Bends'], ['consistency', 'Consist']];

const state = {
  world: null, meeting: null, track: null,
  live: null,       // the race on the big screen
  liveSim: null,    // its pre-computed run, for drawing
  view: null,       // the race whose card / result is shown below
  t: -PRE_START, speed: 1, mode: 'pre', // pre | running | done
  lastFrame: 0,
  slip: { type: 'win', traps: [], stake: 5 },
  visited: new Set(), // tracks already raced at today
};

// ---------------------------------------------------------------------------
// Screens

function show(id) {
  for (const s of ['screen-lobby', 'screen-meeting', 'loading']) $(s).classList.toggle('hidden', s !== id);
}

function updatePurse() {
  $('balance').textContent = money(state.world.balance);
  $('today').textContent = formatDay(state.world.day);
}

function showLobby(note = '') {
  const { world } = state;
  updatePurse();
  $('lobby-note').innerHTML = note;
  $('lobby-note').classList.toggle('hidden', !note);
  $('lobby-meetings').innerHTML = tracksRacingOn(world.day).map((t) => `
    <div class="meeting-card">
      <div class="meeting-card-name">${t.name}</div>
      <div class="muted">${t.description}</div>
      <div>Sprint ${t.distances[0]}m · Standard ${t.distances[1]}m · Stayers ${t.distances[2]}m</div>
      ${state.visited.has(t.id)
        ? '<div class="muted">You raced here tonight.</div>'
        : `<button class="primary" data-track="${t.id}">Go racing</button>`}
    </div>`).join('');
  $('lobby-meetings').querySelectorAll('button[data-track]').forEach((b) =>
    b.addEventListener('click', () => enterMeeting(b.dataset.track)));
  show('screen-lobby');
}

function enterMeeting(trackId) {
  show('loading');
  // Let the "catching up" message paint before the background races run.
  setTimeout(() => {
    state.meeting = todaysMeeting(state.world, trackId);
    state.track = trackById(trackId);
    state.visited.add(trackId);
    const m = state.meeting;
    $('meeting-name').textContent = state.track.name;
    $('meeting-info').textContent = `${formatDay(m.day)} · Going ${m.going > 0 ? '+' : ''}${m.going} · ${m.races.length} races`;
    show('screen-meeting');
    goLive(nextRace(m));
  }, 30);
}

/** Leave the meeting: any races left are run without you and bets settled. */
function leaveMeeting() {
  const m = state.meeting;
  const lines = [];
  for (const race of m.races) {
    if (race.result) continue;
    runRace(state.world, m, race);
    lines.push(...settleRace(race));
  }
  state.mode = 'pre';
  state.meeting = null;
  const note = lines.length ? `<b>Bets settled after you left ${state.track.name}:</b><br>${lines.join('<br>')}` : '';
  showLobby(note);
}

function nextDay() {
  state.world.day++;
  state.visited.clear();
  showLobby();
}

// ---------------------------------------------------------------------------
// Live race

function goLive(race) {
  const { meeting, track } = state;
  state.live = race;
  state.view = race;
  state.slip.traps = [];
  if (!race) { meetingOver(); return; }
  // Work the race out now so the dogs can stand in the traps; the result is
  // only revealed (and written into the form book) when they cross the line.
  state.liveSim = simulateRace({ track, distance: race.distance, runners: race.runners, seed: race.seed, going: meeting.going });
  state.t = -PRE_START;
  state.mode = 'pre';
  state.raceView.setRace(state.liveSim, track);
  state.map.setRace(state.liveSim, track);
  $('meeting').textContent = `Race ${race.no} · ${race.time}`;
  $('race-info').textContent = `${race.distance}m · Grade ${race.gradeLabel}`;
  $('map-track').textContent = track.name;
  $('map-going').textContent = `Going ${meeting.going > 0 ? '+' : ''}${meeting.going}`;
  $('map-foot').textContent = `${race.distance}m`;
  $('banner').classList.add('hidden');
  setControls();
  render(true);
  renderAll();
}

function setControls() {
  const { mode, live } = state;
  $('btn-start').disabled = mode !== 'pre' || !live;
  $('btn-skip').disabled = mode === 'done' || !live;
  $('btn-replay').disabled = mode !== 'done';
  const more = state.meeting && nextRace(state.meeting);
  $('btn-next-race').classList.toggle('hidden', mode !== 'done');
  $('btn-next-race').textContent = more ? 'Next race' : 'Finish the meeting';
}

function startRace() {
  if (state.mode !== 'pre' || !state.live) return;
  state.live.off = true; // bets close when the traps open
  state.mode = 'running';
  setControls();
  renderAll();
}

function finishRace() {
  const race = state.live;
  state.mode = 'done';
  if (!race.result) {
    runRace(state.world, state.meeting, race);
    settleRace(race);
  }
  const w = race.result.results[0];
  $('banner').innerHTML = `WINNER<br>${trapBadge(w.trap)} ${w.dog.name}<br>${w.time.toFixed(2)}s`;
  $('banner').classList.remove('hidden');
  state.view = race;
  setControls();
  renderAll();
}

function settleRace(race) {
  const lines = [];
  for (const bet of race.bets || []) {
    const { returned, note } = settleBet(bet, race);
    bet.returned = +returned.toFixed(2);
    bet.note = note;
    state.world.balance += bet.returned;
    state.world.betLog.push(bet);
    lines.push(`Race ${race.no}: ${describeBet(bet)}, ${money(betCost(bet))} staked, ${bet.returned > 0 ? `returned ${money(bet.returned)}` : 'lost'}`);
  }
  updatePurse();
  return lines;
}

function meetingOver() {
  const m = state.meeting;
  const bets = m.races.flatMap((r) => r.bets || []);
  const staked = bets.reduce((a, b) => a + betCost(b), 0);
  const back = bets.reduce((a, b) => a + (b.returned || 0), 0);
  const note = bets.length
    ? `<b>${state.track.name} is over.</b> You staked ${money(staked)} and got back ${money(back)}: ${back >= staked ? 'up' : 'down'} ${money(Math.abs(back - staked))} on the night.`
    : `<b>${state.track.name} is over.</b> No bets tonight.`;
  state.meeting = null;
  showLobby(note);
}

function render(snap = false) {
  const race = state.liveSim;
  const states = state.raceView.draw(state.t, { snap });
  state.map.draw(states);
  $('clock').textContent = Math.max(0, state.t).toFixed(2);

  const finishedBy = new Map(race.results.map((r) => [r.trap, r]));
  const rows = states.map((s, i) => ({ ...s, runner: race.runners[i] }));
  rows.sort((a, b) => {
    const fa = a.d >= race.distance ? finishedBy.get(a.runner.trap).time : Infinity;
    const fb = b.d >= race.distance ? finishedBy.get(b.runner.trap).time : Infinity;
    if (fa !== fb) return fa - fb;
    return b.d - a.d;
  });
  const leadD = rows[0].d;
  const preOrder = state.t <= 0 ? [...rows].sort((a, b) => a.runner.trap - b.runner.trap) : rows;
  $('leaderboard').innerHTML = preOrder.map((r, i) => {
    const res = finishedBy.get(r.runner.trap);
    let gap = '';
    if (state.t <= 0) gap = state.live.market.runners.find((m) => m.trap === r.runner.trap).odds;
    else if (r.d >= race.distance) gap = i === 0 ? res.time.toFixed(2) : res.margin;
    else if (i > 0) gap = `${((leadD - r.d) / DOG_LENGTH_M).toFixed(1)}L`;
    return `<li><span class="pos">${state.t <= 0 ? '' : `${i + 1}.`}</span>${trapBadge(r.runner.trap)}<span>${r.runner.dog.name}</span><span class="gap">${gap}</span></li>`;
  }).join('');
  const left = Math.max(0, Math.ceil(race.distance - leadD));
  $('dist-left').textContent = left > 0 ? `${left}m` : 'FINISH';
}

function loop() {
  const tick = (now) => {
    const realDt = Math.min(0.05, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    if (state.mode === 'running') {
      state.t += realDt * state.speed;
      if (state.t >= state.raceView.endTime) {
        state.t = state.raceView.endTime;
        render();
        finishRace();
      } else {
        render();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame((now) => { state.lastFrame = now; tick(now); });
}

// ---------------------------------------------------------------------------
// Race tabs, racecard, result and bet slip

function renderAll() {
  renderTabs();
  renderCard();
  renderSlip();
}

function renderTabs() {
  const m = state.meeting;
  if (!m) return;
  $('race-tabs').innerHTML = m.races.map((r) => {
    const won = isRun(r) ? r.result.results[0].trap : null;
    const hasBets = (r.bets || []).length ? '<span class="tab-bet" title="You have a bet">£</span>' : '';
    return `<button class="race-tab ${r === state.view ? 'on' : ''} ${r === state.live ? 'live' : ''}" data-no="${r.no}">
      <span class="tab-no">R${r.no}</span><span class="tab-time">${r.time}</span>
      <span class="tab-grade">${r.gradeLabel} ${r.distance}m</span>
      <span class="tab-win">${won ? trapBadge(won) : ''}${hasBets}</span></button>`;
  }).join('');
  $('race-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.view = m.races[+b.dataset.no - 1];
    state.slip.traps = [];
    renderAll();
  }));
}

/** Has this race been run and its result shown? */
function isRun(race) {
  return race.result && !(race === state.live && state.mode !== 'done');
}

function formLines(dog) {
  if (!dog.runs.length) return '<p class="muted">No form yet.</p>';
  const rows = dog.runs.slice(0, 5).map((r) => `
    <tr>
      <td>${formatShortDate(r.day)}</td><td>${r.distance}</td><td>[${r.trap}]</td><td>${r.sectional.toFixed(2)}</td>
      <td>${r.bends}</td><td class="fin">${ordinal(r.pos)}</td><td>${r.by}</td><td>${r.other}</td>
      <td class="remarks">${r.comments}</td><td>${r.winTime.toFixed(2)}</td><td>${r.going > 0 ? '+' : ''}${r.going}</td>
      <td>${r.sp}</td><td>${r.grade}</td><td>${r.calcTime.toFixed(2)}</td>
    </tr>`).join('');
  return `<table class="form"><thead><tr><th>Date</th><th>Dis</th><th>Trp</th><th>Sec</th><th>Bends</th><th>Fin</th><th>By</th><th>Win/2nd</th><th>Remarks</th><th>WnTm</th><th>Gng</th><th>SP</th><th>Grd</th><th>CalTm</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function ordinal(n) {
  return `${n}${['th', 'st', 'nd', 'rd'][n] || 'th'}`;
}

function renderCard() {
  const race = state.view;
  if (!race) return;
  if (isRun(race)) { renderResult(race); return; }
  $('card-title').textContent = `Racecard · Race ${race.no} · ${race.time} · ${race.gradeLabel} ${race.distance}m`;
  $('card').innerHTML = race.runners.map(({ trap, dog }) => {
    const m = race.market.runners.find((x) => x.trap === trap);
    const best = bestTime(dog, race.distance);
    const stats = STAT_KEYS.map(([k, l]) => `${l} ${dog.stats[k]}`).join(' · ');
    return `
    <article class="runner">
      <div class="runner-head">
        ${trapBadge(trap)}
        <span class="runner-name">${dog.name} <span class="seed">(${SEED_LETTER[dog.style]})</span></span>
        <span class="runner-form" title="Last six finishes, oldest first">${formFigures(dog) || '-'}</span>
        <span class="runner-best">Best ${best ? best.toFixed(2) : '-'}</span>
        <button class="odds" data-trap="${trap}" ${race.off ? 'disabled' : ''} title="Back this dog to win">${m.odds}</button>
      </div>
      <div class="runner-sub muted">${COAT_LABEL[dog.coat] || dog.coat} ${dog.sex.toLowerCase()}, ${dog.age} yrs, ${dog.weight}kg · ${STYLES[dog.style].label} · Trainer ${dog.trainer}</div>
      <div class="pen">${penPicture(dog)}</div>
      <div class="hidden-stats">${stats}</div>
      <div class="form-wrap">${formLines(dog)}</div>
    </article>`;
  }).join('');
  $('card').querySelectorAll('button.odds').forEach((b) => b.addEventListener('click', () => {
    state.slip.type = 'win';
    state.slip.traps = [+b.dataset.trap];
    renderSlip();
    $('slip-body').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }));
}

function renderResult(race) {
  const res = race.result.results;
  const div = dividends(race.market, res.map((r) => r.trap));
  const sp = new Map(race.market.runners.map((m) => [m.trap, m.odds]));
  $('card-title').textContent = `Result · Race ${race.no} · ${race.gradeLabel} ${race.distance}m`;
  $('card').innerHTML = `
    <table class="card result">
      <thead><tr><th>Pos</th><th>Trap</th><th>Greyhound</th><th>By</th><th>SP</th><th>Time</th><th>Sec</th><th>Bends</th><th>Remarks</th></tr></thead>
      <tbody>${res.map((r) => `
        <tr><td>${r.position}</td><td>${trapBadge(r.trap)}</td><td>${r.dog.name}</td><td>${r.margin}</td><td>${sp.get(r.trap)}</td>
        <td>${r.time.toFixed(2)}</td><td>${r.sectional.toFixed(2)}</td><td>${r.bendFigures}</td><td class="remarks">${r.comments}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="dividends">Forecast ${res[0].trap}-${res[1].trap} paid ${money(div.forecast)} · Tricast ${res[0].trap}-${res[1].trap}-${res[2].trap} paid ${money(div.tricast)} <span class="muted">(to a £1 stake)</span></p>
    ${race !== state.live ? '<button id="btn-watch">Watch this race again</button>' : ''}`;
  const watch = $('btn-watch');
  if (watch) watch.addEventListener('click', () => replay(race));
}

/** Put an earlier race back on the big screen. */
function replay(race) {
  const { meeting, track } = state;
  state.live = race;
  state.liveSim = simulateRace({ track, distance: race.distance, runners: race.runners, seed: race.seed, going: meeting.going });
  state.raceView.setRace(state.liveSim, track);
  state.map.setRace(state.liveSim, track);
  $('meeting').textContent = `Replay · Race ${race.no} · ${race.time}`;
  $('race-info').textContent = `${race.distance}m · Grade ${race.gradeLabel}`;
  $('banner').classList.add('hidden');
  state.t = -PRE_START;
  state.mode = 'running';
  setControls();
  renderAll();
}

function renderSlip() {
  const race = state.view;
  if (!race) return;
  const slip = state.slip;
  const bets = race.bets || [];
  $('slip-race').textContent = `Race ${race.no} · ${race.time} · ${race.gradeLabel} ${race.distance}m`;
  const betList = bets.length ? `<ul class="bets">${bets.map((b, i) => `
      <li><span>${describeBet(b)} · ${money(betCost(b))}</span>
      ${b.note ? `<span class="${b.returned > 0 ? 'won' : 'lost'}">${b.returned > 0 ? `+${money(b.returned)}` : 'Lost'}</span>`
        : race.off ? '<span class="muted">Running</span>' : `<button class="link" data-cancel="${i}">Cancel</button>`}</li>`).join('')}</ul>` : '';

  if (race.off || race.result && isRun(race)) {
    $('slip-body').innerHTML = `<p class="muted">Betting has closed on this race.</p>${betList || '<p class="muted">You had no bets.</p>'}`;
    return;
  }
  const t = BET_TYPES[slip.type];
  const picks = slip.traps.length ? slip.traps.map(trapBadge).join(slip.type === 'rfc' ? ' / ' : ' - ') : '<span class="muted">Pick a trap</span>';
  const ready = slip.traps.length === t.picks;
  const cost = slip.stake * t.lines;
  $('slip-body').innerHTML = `
    <div class="bet-types">${Object.entries(BET_TYPES).map(([k, v]) => `<button data-type="${k}" class="${k === slip.type ? 'on' : ''}">${v.label}</button>`).join('')}</div>
    <p class="muted small">${t.help}</p>
    <div class="trap-picks">${race.runners.map(({ trap }) => {
      const m = race.market.runners.find((x) => x.trap === trap);
      const at = slip.traps.indexOf(trap);
      return `<button data-trap="${trap}" class="pick ${at >= 0 ? 'on' : ''}">${trapBadge(trap)}<span>${m.odds}</span>${at >= 0 && t.picks > 1 ? `<i>${ordinal(at + 1)}</i>` : ''}</button>`;
    }).join('')}</div>
    <div class="slip-line">Selection: ${picks}</div>
    <div class="slip-line stake">Stake <input id="stake" type="number" min="1" step="1" value="${slip.stake}"> ${t.lines > 1 ? `x ${t.lines} bets` : ''}
      ${[2, 5, 10, 20, 50].map((s) => `<button data-stake="${s}">£${s}</button>`).join('')}</div>
    <button id="btn-place" class="primary" ${ready && cost <= state.world.balance && cost > 0 ? '' : 'disabled'}>Place bet ${money(cost)}</button>
    ${cost > state.world.balance ? '<p class="lost">Not enough in your purse.</p>' : ''}
    ${betList}`;

  $('slip-body').querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    slip.type = b.dataset.type;
    slip.traps = slip.traps.slice(0, BET_TYPES[slip.type].picks);
    renderSlip();
  }));
  $('slip-body').querySelectorAll('[data-trap]').forEach((b) => b.addEventListener('click', () => {
    const trap = +b.dataset.trap;
    const at = slip.traps.indexOf(trap);
    if (at >= 0) slip.traps.splice(at, 1);
    else if (t.picks === 1) slip.traps = [trap];
    else if (slip.traps.length < t.picks) slip.traps.push(trap);
    renderSlip();
  }));
  $('slip-body').querySelectorAll('[data-stake]').forEach((b) => b.addEventListener('click', () => {
    slip.stake = +b.dataset.stake;
    renderSlip();
  }));
  $('stake').addEventListener('change', (e) => {
    slip.stake = Math.max(1, Math.round(+e.target.value || 1));
    renderSlip();
  });
  $('slip-body').querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => {
    const [bet] = race.bets.splice(+b.dataset.cancel, 1);
    state.world.balance += betCost(bet);
    updatePurse();
    renderAll();
  }));
  $('btn-place').addEventListener('click', () => {
    const cost = slip.stake * t.lines;
    if (!ready || cost > state.world.balance) return;
    const bet = { type: slip.type, traps: [...slip.traps], stake: slip.stake, race: race.no };
    if (slip.type === 'win' || slip.type === 'ew') {
      const m = race.market.runners.find((x) => x.trap === slip.traps[0]);
      Object.assign(bet, { odds: m.odds, decimal: m.decimal });
    }
    (race.bets ||= []).push(bet);
    state.world.balance -= cost;
    slip.traps = [];
    updatePurse();
    renderAll();
  });
}

// ---------------------------------------------------------------------------

async function boot() {
  const [assets] = await Promise.all([loadAssets(), loadGameData()]);
  state.world = createWorld(randomSeed());
  state.raceView = new RaceView($('race'), assets);
  state.map = new MiniMap($('map'));

  $('btn-start').addEventListener('click', startRace);
  $('btn-skip').addEventListener('click', () => {
    if (state.mode === 'done' || !state.live) return;
    if (state.mode === 'pre') startRace();
    state.t = state.raceView.endTime - 0.01;
  });
  $('btn-replay').addEventListener('click', () => {
    state.raceView.setRace(state.liveSim, state.track);
    state.t = -PRE_START;
    state.mode = 'running';
    $('banner').classList.add('hidden');
    setControls();
  });
  $('btn-next-race').addEventListener('click', () => goLive(nextRace(state.meeting)));
  $('btn-leave').addEventListener('click', leaveMeeting);
  $('btn-next-day').addEventListener('click', nextDay);
  document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => {
    state.speed = +b.dataset.speed;
    document.querySelectorAll('.speed button').forEach((o) => o.classList.toggle('on', o === b));
  }));
  $('chk-stats').addEventListener('change', (e) => document.body.classList.toggle('show-stats', e.target.checked));

  showLobby('<b>Welcome.</b> You have £1,000 to bet with. Pick a meeting to see its racecards.');
  loop();
}

boot().catch((err) => {
  console.error(err);
  show('screen-lobby');
  $('lobby-note').classList.remove('hidden');
  const hint = /typing mistake/.test(err.message) ? '' : ' Run the game from a local web server (see README).';
  $('lobby-note').textContent = `Could not start: ${err.message}.${hint}`;
});
