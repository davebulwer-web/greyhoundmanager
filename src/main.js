// The game page: your kennel, the sales, the calendar, accounts, saving,
// and race meetings (racecards, bets and the race screen).

import { loadAssets } from './assets.js';
import { loadGameData } from './data.js';
import { randomSeed } from './rng.js';
import { STYLES } from './dogs.js';
import { TRACKS, trackById } from './track.js';
import { simulateRace, DOG_LENGTH_M } from './sim.js';
import { RaceView, PRE_START } from './raceView.js';
import { MiniMap } from './minimap.js';
import {
  createWorld, todaysMeeting, tracksRacingOn, runRace, nextRace, formatDay, formatShortDate,
  formFigures, bestTime, penPicture, SEED_LETTER, CLASSES, gradeLabel, settleRace, meetingStatus,
  isMine, addLedger, ordinal, REST_DAYS, prizes,
} from './world.js';
import { dividends } from './market.js';
import { BET_TYPES, betCost, describeBet } from './betting.js';
import {
  advanceDay, giveStarterDog, salesList, buyDog, sellDog, sellPrice, myDogs, TRAINING, STAT_LABELS,
  trainerStars, ECONOMY, RACE_FITNESS_COST,
} from './kennel.js';
import { saveGame, loadGame, exportSave, importSave, deleteSave } from './save.js';
import { buildCommentary } from './commentary.js';
import {
  breedingState, retireDog, rehome, studBook, mate, canMate, sellPuppy, BREEDING, defaultPrefix,
} from './breeding.js';
import { cupsByDate, cupById, entryProblem, cupTrack, SEASON_DAYS, seasonOf } from './cups.js';

const $ = (id) => document.getElementById(id);
const money = (x) => `${x < 0 ? '-' : ''}£${Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const trapBadge = (trap) => `<span class="trap trap-${trap}">${trap}</span>`;
const COAT_LABEL = { 'white-black': 'white & black', 'red-fawn': 'red fawn' };
const CLASS_LABEL = { sprint: 'Sprinter', standard: 'Standard', stay: 'Stayer' };
const STAT_KEYS = [['breakSpeed', 'Brk'], ['earlyPace', 'Early'], ['topSpeed', 'Speed'], ['stamina', 'Stam'], ['cornering', 'Bends'], ['consistency', 'Consist']];
const SCREENS = ['screen-new', 'screen-lobby', 'screen-kennel', 'screen-sales', 'screen-breeding', 'screen-cups', 'screen-calendar',
  'screen-accounts', 'screen-game', 'screen-help', 'screen-meeting', 'loading'];
const trackShort = (id) => (trackById(id)?.name || id).slice(0, 3);

const state = {
  world: null, meeting: null, track: null,
  live: null,       // the race on the big screen
  liveSim: null,    // its run, worked out in advance for drawing
  view: null,       // the race whose card / result is shown below
  t: -PRE_START, speed: 1, mode: 'pre', // pre | running | done
  lastFrame: 0,
  slip: { type: 'win', traps: [], stake: 5 },
  newTrack: TRACKS[0]?.id,
  confirm: null,    // a button waiting for a second click (sell, new game)
};

const save = () => saveGame(state.world);

// ---------------------------------------------------------------------------
// Screens and navigation

function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  document.querySelectorAll('#nav [data-screen]').forEach((b) => b.classList.toggle('on', b.dataset.screen === id
    || (id === 'screen-meeting' && b.dataset.screen === 'screen-lobby')));
  $('nav').classList.toggle('hidden', id === 'screen-new' || !state.world);
  state.confirm = null;
}

const RENDER = {
  'screen-lobby': () => showLobby(),
  'screen-kennel': renderKennel,
  'screen-sales': renderSales,
  'screen-calendar': renderCalendar,
  'screen-breeding': renderBreeding,
  'screen-cups': renderCups,
  'screen-accounts': renderAccounts,
  'screen-game': renderGame,
};

function go(id) {
  if (id === 'screen-lobby' && state.meeting) { show('screen-meeting'); renderAll(); return; }
  if (RENDER[id]) RENDER[id]();
  if (id !== 'screen-lobby') show(id);
}

function updatePurse() {
  if (!state.world) return;
  $('balance').textContent = money(state.world.balance);
  $('balance').classList.toggle('lost', state.world.balance < 0);
  $('today').textContent = `${formatDay(state.world.day)} · ${state.world.player.name}`;
}

// ---------------------------------------------------------------------------
// New game

function showNewGame() {
  state.world = null;
  $('today').textContent = 'New game';
  $('balance').textContent = '£1,500.00';
  $('new-tracks').innerHTML = TRACKS.map((t) => `
    <button class="meeting-card pick-track ${t.id === state.newTrack ? 'on' : ''}" data-track="${t.id}">
      <span class="meeting-card-name">${t.name}</span>
      <span class="muted">${t.description}</span>
      <span>Sprint ${t.distances[0]}m · Standard ${t.distances[1]}m · Stayers ${t.distances[2]}m</span>
    </button>`).join('');
  $('new-tracks').querySelectorAll('[data-track]').forEach((b) => b.addEventListener('click', () => {
    state.newTrack = b.dataset.track;
    showNewGame();
  }));
  show('screen-new');
}

function startNewGame() {
  const name = $('new-name').value.trim() || 'My Kennel';
  show('loading');
  setTimeout(() => {
    deleteSave();
    const prefix = $('new-prefix').value.trim() || defaultPrefix(name);
    state.world = createWorld(randomSeed(), { name, homeTrack: state.newTrack, prefix });
    const dog = giveStarterDog(state.world);
    save();
    showLobby(`<b>Welcome to ${trackById(state.newTrack).name}.</b> Your first greyhound is <b>${dog.name}</b>, graded ${gradeLabel(dog.classKey, dog.grade)}. Have a look at the <b>Kennel</b>, then buy another dog or go racing.`);
  }, 30);
}

async function loadFromFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    state.world = await importSave(file);
    state.meeting = null;
    save();
    showLobby(`<b>Loaded.</b> Welcome back to ${state.world.player.name}.`);
  } catch (err) {
    const msg = `Could not load that file: ${err.message}`;
    if ($('screen-game').classList.contains('hidden')) alertNote(msg); else $('game-msg').textContent = msg;
  }
}

function alertNote(msg) {
  $('lobby-note').textContent = msg;
  $('lobby-note').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Racing lobby

function showLobby(note = '') {
  const { world } = state;
  updatePurse();
  $('lobby-note').innerHTML = note;
  $('lobby-note').classList.toggle('hidden', !note);
  const home = world.player.homeTrack;
  const tonight = tracksRacingOn(world.day);
  // Your runners tonight, if your home track is racing.
  let runners = '';
  if (tonight.some((t) => t.id === home) && myDogs(world).length) {
    const m = todaysMeeting(world, home);
    const mine = m.races.flatMap((r) => r.runners.filter((x) => isMine(x.dog)).map((x) => ({ r, x })));
    runners = mine.length
      ? `<div class="lobby-runners"><b>Your runners tonight at ${trackById(home).name}:</b> ${mine.map(({ r, x }) => `${x.dog.name} ${trapBadge(x.trap)} race ${r.no} (${r.time}, ${r.gradeLabel})`).join(' · ')}</div>`
      : `<div class="lobby-runners muted">None of your dogs is running at ${trackById(home).name} tonight.</div>`;
  } else if (myDogs(world).length) {
    runners = `<div class="lobby-runners muted">${trackById(home).name} isn't racing tonight. Your dogs can run tomorrow.</div>`;
  }
  $('lobby-runners').innerHTML = runners;
  $('lobby-meetings').innerHTML = tonight.map((t) => {
    const status = meetingStatus(world, t.id);
    const button = status === 'over'
      ? '<div class="muted">Racing is over here tonight.</div>'
      : `<button class="primary" data-track="${t.id}">${status === 'started' ? 'Back to the meeting' : 'Go racing'}</button>`;
    const cupTonight = (world.cups || []).filter((c) => cupById(c.cupId)?.trackId === t.id && Object.values(c.days).includes(world.day))
      .map((c) => { const r = Object.keys(c.days).find((k) => c.days[k] === world.day); return `${cupById(c.cupId).name} ${r === 'heats' ? 'heats' : r === 'semis' ? 'semi-finals' : 'final'}`; });
    return `
    <div class="meeting-card ${t.id === home ? 'home' : ''}">
      <div class="meeting-card-name">${t.name}${t.id === home ? ' <span class="home-tag">your track</span>' : ''}</div>
      ${cupTonight.length ? `<div class="cup-tonight">🏆 ${cupTonight.join(', ')} tonight</div>` : ''}
      <div class="muted">${t.description}</div>
      <div>Sprint ${t.distances[0]}m · Standard ${t.distances[1]}m · Stayers ${t.distances[2]}m</div>
      ${button}
    </div>`;
  }).join('');
  $('lobby-meetings').querySelectorAll('button[data-track]').forEach((b) =>
    b.addEventListener('click', () => enterMeeting(b.dataset.track)));
  const news = (world.news || []).slice(0, 8);
  $('lobby-news').innerHTML = news.length
    ? `<h2 class="sub">News</h2><ul class="news">${news.map((n) => `<li><span class="muted">${formatDay(n.day, false)}</span> ${n.text}</li>`).join('')}</ul>` : '';
  show('screen-lobby');
}

function enterMeeting(trackId) {
  show('loading');
  // Let the "catching up" message paint before any background races run.
  setTimeout(() => {
    state.meeting = todaysMeeting(state.world, trackId);
    state.track = trackById(trackId);
    const m = state.meeting;
    $('meeting-name').textContent = state.track.name;
    $('meeting-info').textContent = `${formatDay(m.day)} · Going ${m.going > 0 ? '+' : ''}${m.going} · ${m.races.length} races`;
    show('screen-meeting');
    goLive(nextRace(m));
    save();
  }, 30);
}

/** Leave the meeting. The races carry on without you and run when the day ends. */
function leaveMeeting() {
  if (state.mode === 'running') finishRace();
  state.mode = 'pre';
  state.meeting = null;
  document.body.classList.remove('racing-live');
  save();
  showLobby();
}

function nextDay(days = 1) {
  if (state.mode === 'running') finishRace();
  state.meeting = null;
  state.mode = 'pre';
  document.body.classList.remove('racing-live');
  show('loading');
  setTimeout(() => {
    const before = state.world.balance;
    const lines = [];
    for (let i = 0; i < days; i++) lines.push(...advanceDay(state.world));
    save();
    const change = state.world.balance - before;
    const notes = [];
    if (lines.length) notes.push(`<b>Bets settled:</b><br>${lines.join('<br>')}`);
    notes.push(`${days > 1 ? `Over the last ${days} days` : 'Overnight'} your money went ${change >= 0 ? 'up' : 'down'} ${money(Math.abs(change))} (prizes, fees and bills: see Accounts).`);
    const tired = myDogs(state.world).filter((d) => d.fitness < 60);
    if (tired.length) notes.push(`Looking tired: ${tired.map((d) => `${d.name} (fitness ${d.fitness})`).join(', ')}. Rest helps.`);
    if (state.world.balance < 0) notes.push('<span class="lost">You are overdrawn. Sell a dog or win some bets.</span>');
    showLobby(notes.join('<br>'));
  }, 30);
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
  state.commentary = buildCommentary(state.liveSim);
  state.t = -PRE_START;
  state.mode = 'pre';
  state.raceView.setRace(state.liveSim, track);
  state.map.setRace(state.liveSim, track);
  $('meeting').textContent = `Race ${race.no} · ${race.time}`;
  $('race-info').textContent = `${race.distance}m · ${race.title || `Grade ${race.gradeLabel}`}`;
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
  // While a race is running the race screen takes the whole width.
  document.body.classList.toggle('racing-live', mode === 'running');
}

function startRace() {
  if (state.mode !== 'pre' || !state.live) return;
  state.live.off = true; // bets close when the traps open
  state.mode = 'running';
  setControls();
  renderAll();
  $('screen-meeting').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function finishRace() {
  const race = state.live;
  state.mode = 'done';
  if (!race.result) {
    runRace(state.world, state.meeting, race, { sim: state.liveSim });
    settleRace(state.world, race);
    updatePurse();
    save();
  }
  const w = race.result.results[0];
  $('banner').innerHTML = `WINNER<br>${trapBadge(w.trap)} ${w.dog.name}<br>${w.time.toFixed(2)}s`;
  $('banner').classList.remove('hidden');
  state.view = race;
  setControls();
  renderAll();
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
  save();
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
    const mine = isMine(r.runner.dog) ? ' class="mine"' : '';
    return `<li${mine}><span class="pos">${state.t <= 0 ? '' : `${i + 1}.`}</span>${trapBadge(r.runner.trap)}<span>${r.runner.dog.name}</span><span class="gap">${gap}</span></li>`;
  }).join('');
  const left = Math.max(0, Math.ceil(race.distance - leadD));
  $('dist-left').textContent = left > 0 ? `${left}m` : 'FINISH';
  // Commentary: the latest line that has happened.
  const said = (state.commentary || []).filter((l) => l.t <= state.t);
  const line = said[said.length - 1];
  $('commentary').textContent = state.t < 0 ? 'The hare is running…' : line ? line.text : '';
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
  if (!state.meeting) return;
  renderTabs();
  renderCard();
  renderSlip();
}

function renderTabs() {
  const m = state.meeting;
  $('race-tabs').innerHTML = m.races.map((r) => {
    const won = isRun(r) ? r.result.results[0].trap : null;
    const hasBets = (r.bets || []).length ? '<span class="tab-bet" title="You have a bet">£</span>' : '';
    const hasMine = r.runners.some((x) => isMine(x.dog)) ? '<span class="tab-mine" title="Your dog runs">★</span>' : '';
    return `<button class="race-tab ${r === state.view ? 'on' : ''} ${r === state.live ? 'live' : ''}" data-no="${r.no}">
      <span class="tab-no">R${r.no}</span><span class="tab-time">${r.time}</span>
      <span class="tab-grade">${r.gradeLabel} ${r.distance}m</span>
      <span class="tab-win">${won ? trapBadge(won) : ''}${hasMine}${hasBets}</span></button>`;
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

function formLines(dog, n = 5) {
  if (!dog.runs.length) return '<p class="muted">No form yet.</p>';
  const rows = dog.runs.slice(0, n).map((r) => `
    <tr>
      <td>${formatShortDate(r.day)}</td><td>${trackShort(r.trackId)}</td><td>${r.distance}</td><td>[${r.trap}]</td><td>${r.sectional.toFixed(2)}</td>
      <td>${r.bends}</td><td class="fin">${ordinal(r.pos)}</td><td>${r.by}</td><td>${r.other}</td>
      <td class="remarks">${r.comments}</td><td>${r.winTime.toFixed(2)}</td><td>${r.going > 0 ? '+' : ''}${r.going}</td>
      <td>${r.sp}</td><td>${r.grade}</td><td>${r.calcTime.toFixed(2)}</td>
    </tr>`).join('');
  return `<table class="form"><thead><tr><th>Date</th><th>Trk</th><th>Dis</th><th>Trp</th><th>Sec</th><th>Bends</th><th>Fin</th><th>By</th><th>Win/2nd</th><th>Remarks</th><th>WnTm</th><th>Gng</th><th>SP</th><th>Grd</th><th>CalTm</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const hiddenStats = (dog) => `<div class="hidden-stats">${STAT_KEYS.map(([k, l]) => `${l} ${Math.round(dog.stats[k])}`).join(' · ')}</div>`;

function renderCard() {
  const race = state.view;
  if (!race) return;
  if (isRun(race)) { renderResult(race); return; }
  $('card-title').textContent = `Racecard · Race ${race.no} · ${race.time} · ${race.title || race.gradeLabel} ${race.distance}m`;
  const places = race.cup ? (race.cup.round === 'final' ? cupById(race.cup.key.split(':')[0]).prizes : []) : prizes(race.classKey, race.grade).places;
  const prizeLine = places.length ? `Prizes: 1st £${places[0]}, 2nd £${places[1]}, 3rd £${places[2]}.` : 'The first three go through to the next round.';
  $('card').innerHTML = `<p class="muted">${prizeLine} Every runner gets £25.</p>` + race.runners.map(({ trap, dog }) => {
    const m = race.market.runners.find((x) => x.trap === trap);
    const best = bestTime(dog, race.distance);
    return `
    <article class="runner ${isMine(dog) ? 'mine' : ''}">
      <div class="runner-head">
        ${trapBadge(trap)}
        <span class="runner-name">${dog.name} <span class="seed">(${SEED_LETTER[dog.style]})</span></span>
        ${isMine(dog) ? '<span class="mine-tag">Your dog</span>' : ''}
        <span class="runner-form" title="Last six finishes, oldest first">${formFigures(dog) || '-'}</span>
        <span class="runner-best">Best ${best ? best.toFixed(2) : '-'}</span>
        <button class="odds" data-trap="${trap}" ${race.off ? 'disabled' : ''} title="Back this dog to win">${m.odds}</button>
      </div>
      <div class="runner-sub muted">${COAT_LABEL[dog.coat] || dog.coat} ${dog.sex.toLowerCase()}, ${dog.age} yrs, ${dog.weight}kg · ${STYLES[dog.style].label} · Trainer ${dog.trainer}</div>
      <div class="pen">${penPicture(dog)}</div>
      ${hiddenStats(dog)}
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
  $('card-title').textContent = `Result · Race ${race.no} · ${race.title || race.gradeLabel} ${race.distance}m`;
  $('card').innerHTML = `
    <table class="card result">
      <thead><tr><th>Pos</th><th>Trap</th><th>Greyhound</th><th>By</th><th>SP</th><th>Time</th><th>Sec</th><th>Bends</th><th>Remarks</th></tr></thead>
      <tbody>${res.map((r) => `
        <tr class="${isMine(r.dog) ? 'mine' : ''}"><td>${r.position}</td><td>${trapBadge(r.trap)}</td><td>${r.dog.name}</td><td>${r.margin}</td><td>${sp.get(r.trap)}</td>
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
  state.commentary = buildCommentary(state.liveSim);
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

  if (race.off || isRun(race)) {
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
    addLedger(state.world, `Bet cancelled: race ${race.no}, ${describeBet(bet)}`, betCost(bet));
    updatePurse();
    save();
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
    addLedger(state.world, `Bet: race ${race.no} at ${state.track.name}, ${describeBet(bet)}`, -cost);
    slip.traps = [];
    updatePurse();
    save();
    renderAll();
  });
}

// ---------------------------------------------------------------------------
// Kennel

function stars(n) {
  const full = Math.floor(n);
  return `<span class="stars" title="${n} out of 5">${'★'.repeat(full)}${n % 1 ? '½' : ''}<span class="dim">${'★'.repeat(5 - Math.ceil(n))}</span></span>`;
}

function nextRunDay(dog) {
  const { world } = state;
  for (let d = Math.max(world.day, dog.lastRunDay + REST_DAYS); d < world.day + 10; d++) {
    if (tracksRacingOn(d).some((t) => t.id === world.player.homeTrack)) return d;
  }
  return null;
}

function renderKennel() {
  const { world } = state;
  updatePurse();
  const dogs = myDogs(world);
  const bills = dogs.reduce((a, d) => a + ECONOMY.upkeepPerDay + (TRAINING[d.training]?.cost || 0), 0);
  $('kennel-sum').textContent = `${dogs.length} dog${dogs.length === 1 ? '' : 's'} · bills ${money(bills)} a day`;
  if (!dogs.length) {
    $('kennel').innerHTML = '<p>Your kennel is empty. Have a look at <b>Buy a dog</b>.</p>';
    return;
  }
  $('kennel').innerHTML = dogs.map((dog) => {
    const st = trainerStars(world, dog);
    const nd = nextRunDay(dog);
    const best = bestTime(dog, trackById(world.player.homeTrack).distances[CLASSES[dog.classKey].distIndex]);
    const fitClass = dog.fitness >= 80 ? 'won' : dog.fitness >= 60 ? '' : 'lost';
    const confirming = state.confirm === `sell:${dog.id}`;
    return `
    <article class="runner kennel-dog" data-id="${dog.id}">
      <div class="runner-head">
        <span class="runner-name">${dog.name} <span class="seed">(${SEED_LETTER[dog.style]})</span></span>
        <span class="grade-tag">${gradeLabel(dog.classKey, dog.grade)}</span>
        <span class="runner-form" title="Last six finishes, oldest first">${formFigures(dog) || '-'}</span>
        <span class="runner-best">Best ${best ? best.toFixed(2) : '-'}</span>
        <span class="head-buttons">
          <button class="${state.confirm === `retire:${dog.id}` ? 'primary' : ''}" data-retire="${dog.id}">${state.confirm === `retire:${dog.id}` ? 'Sure? Retire' : dog.sex === 'Bitch' ? 'Retire to breed' : 'Retire to stud'}</button>
          <button class="sell ${confirming ? 'primary' : ''}" data-sell="${dog.id}">${confirming ? `Sure? Sell for £${sellPrice(dog)}` : `Sell (£${sellPrice(dog)})`}</button>
        </span>
      </div>
      ${(dog.trophies || []).length ? `<div class="trophies">🏆 ${dog.trophies.map((t) => t.replace(/ \d+$/, '')).join(', ')}</div>` : ''}
      ${cupEntriesFor(dog)}
      <div class="runner-sub muted">${CLASS_LABEL[dog.classKey]} · ${COAT_LABEL[dog.coat] || dog.coat} ${dog.sex.toLowerCase()}, ${dog.age} yrs, ${dog.weight}kg · ${STYLES[dog.style].label} · ${dog.runs.length} runs · earned ${money(dog.earnings || 0)}</div>
      <div class="kennel-grid">
        <div>
          <div class="fit">Fitness <span class="fitbar"><span style="width:${dog.fitness}%"></span></span> <span class="${fitClass}">${dog.fitness}</span></div>
          <label class="check inline"><input type="checkbox" data-enter="${dog.id}" ${dog.entered ? 'checked' : ''}> Enter in races</label>
          <div class="muted small">${dog.entered ? (nd !== null ? `Next eligible: ${formatDay(nd)}` : 'Resting') : 'Not entered: will not race'}</div>
          <label>Training <select data-train="${dog.id}">${Object.entries(TRAINING).map(([k, v]) => `<option value="${k}" ${k === dog.training ? 'selected' : ''}>${v.label}${v.cost ? ` (+£${v.cost}/day)` : ''}</option>`).join('')}</select></label>
          <div class="muted small">${TRAINING[dog.training].help}</div>
        </div>
        <div class="trainer-view">
          <div class="muted">Trainer's view</div>
          ${Object.entries(STAT_LABELS).map(([k, l]) => `<div class="stat-row"><span>${l}</span>${stars(st[k])}</div>`).join('')}
        </div>
      </div>
      ${hiddenStats(dog)}
      <details><summary>Form</summary><div class="form-wrap">${formLines(dog, 10)}</div></details>
    </article>`;
  }).join('') + `<p class="muted small">Racing takes about ${RACE_FITNESS_COST} fitness. Dogs get it back each day: fastest on Rest, slowest on special training. Below 60 fitness a dog runs slower and training does it less good. Special training improves the abilities it works on, up to each dog's natural limit. The trainer's stars are a judgement, not exact.</p>
    <label class="check"><input type="checkbox" id="chk-stats-k" ${document.body.classList.contains('show-stats') ? 'checked' : ''}> Show hidden abilities (testing only)</label>`;

  $('kennel').querySelectorAll('[data-enter]').forEach((el) => el.addEventListener('change', () => {
    dogs.find((d) => d.id === el.dataset.enter).entered = el.checked;
    save();
    renderKennel();
  }));
  $('kennel').querySelectorAll('[data-train]').forEach((el) => el.addEventListener('change', () => {
    dogs.find((d) => d.id === el.dataset.train).training = el.value;
    save();
    renderKennel();
  }));
  $('kennel').querySelectorAll('[data-retire]').forEach((el) => el.addEventListener('click', () => {
    const key = `retire:${el.dataset.retire}`;
    if (state.confirm !== key) { state.confirm = key; renderKennel(); return; }
    state.confirm = null;
    const dog = dogs.find((d) => d.id === el.dataset.retire);
    const role = retireDog(world, dog);
    save();
    renderKennel();
    $('kennel-sum').textContent = `${dog.name} has retired ${role === 'brood' ? 'to breed: see Breeding' : 'to stud: see Breeding'}.`;
  }));
  $('kennel').querySelectorAll('[data-sell]').forEach((el) => el.addEventListener('click', () => {
    const key = `sell:${el.dataset.sell}`;
    if (state.confirm !== key) { state.confirm = key; renderKennel(); return; }
    state.confirm = null;
    sellDog(world, dogs.find((d) => d.id === el.dataset.sell));
    save();
    renderKennel();
  }));
  $('chk-stats-k').addEventListener('change', (e) => { document.body.classList.toggle('show-stats', e.target.checked); $('chk-stats').checked = e.target.checked; });
}

function cupEntriesFor(dog) {
  const list = cupsByDate(state.world).filter((c) => c.stage !== 'done' && (c.playerEntries.includes(dog.id)
    || Object.values(c.field).flat(2).includes(dog.id)));
  if (!list.length) return '';
  return `<div class="cup-entry">🏆 Entered: ${list.map((c) => `${cupById(c.cupId).name} (${c.stage === 'entries' ? `heats ${formatDay(c.days.heats)}` : c.stage === 'semis' ? `semi-final ${formatDay(c.days.semis)}` : c.stage === 'final' ? `final ${formatDay(c.days.final)}` : c.stage})`).join(', ')}</div>`;
}

// ---------------------------------------------------------------------------
// Breeding

function renderBreeding() {
  const { world } = state;
  updatePurse();
  const b = breedingState(world);
  const book = studBook(world);
  $('breeding-sum').textContent = `Kennel prefix: ${b.prefix}`;
  const dam = (d) => {
    const problem = canMate(world, d);
    const due = b.litters.find((l) => l.damId === d.id);
    return `
    <article class="runner">
      <div class="runner-head"><span class="runner-name">${d.name}</span><span class="grade-tag">Brood bitch</span>
        <span class="muted">${d.age} yrs · ${d.litters || 0} litter${d.litters === 1 ? '' : 's'}</span>
        <button class="sell" data-rehome="${d.id}">${state.confirm === `rehome:${d.id}` ? 'Sure? Rehome' : 'Rehome'}</button></div>
      ${hiddenStats(d)}
      ${due ? `<div>In whelp to ${due.sire.name}: pups due ${formatDay(due.dueDay)}.</div>`
        : problem ? `<div class="muted">${problem.replace(/day (\d+)/, (_, n) => formatDay(+n))}</div>`
        : `<div class="slip-line">Mate with <select data-sire-for="${d.id}">${book.map((e, i) => `<option value="${i}">${e.dog.name}${e.own ? ' (yours, free)' : ` · ${gradeLabel(e.dog.classKey, e.dog.grade)} · £${e.fee}`}</option>`).join('')}</select>
            <button class="primary" data-mate="${d.id}">Mate</button></div>`}
    </article>`;
  };
  const studs = b.studs.map((d) => `
    <article class="runner"><div class="runner-head"><span class="runner-name">${d.name}</span><span class="grade-tag">Stud dog</span>
      <span class="muted">${d.age} yrs · free to use with your bitches</span>
      <button class="sell" data-rehome="${d.id}">${state.confirm === `rehome:${d.id}` ? 'Sure? Rehome' : 'Rehome'}</button></div>${hiddenStats(d)}</article>`).join('');
  const pups = b.puppies.map((x) => `
    <tr><td>${x.dog.name}</td><td>${x.dog.sex === 'Dog' ? 'dog' : 'bitch'}, ${COAT_LABEL[x.dog.coat] || x.dog.coat}</td><td>${x.dog.sireName} x ${x.dog.damName}</td>
      <td>${formatDay(x.readyDay)}</td><td><button data-sellpup="${x.dog.id}">Sell £${BREEDING.puppySale}</button></td></tr>`).join('');
  $('breeding').innerHTML = `
    <p class="muted">Retire a bitch from the Kennel to breed from her. Pups are born ${BREEDING.gestationDays} days after mating and are ready to race ${BREEDING.rearingDays} days later. They take after both parents, with some luck either way. Pups and retired dogs cost £${BREEDING.puppyUpkeep} a day each.</p>
    <h2 class="sub">Brood bitches</h2>${b.broods.map(dam).join('') || '<p class="muted">None yet.</p>'}
    <h2 class="sub">Pups</h2>${pups ? `<table class="card"><thead><tr><th>Name</th><th></th><th>Sire x Dam</th><th>Ready</th><th></th></tr></thead><tbody>${pups}</tbody></table>` : '<p class="muted">No pups at the moment.</p>'}
    <h2 class="sub">Your stud dogs</h2>${studs || '<p class="muted">None yet. Retire a dog from the Kennel to stand him at stud.</p>'}
    <h2 class="sub">Stud book at ${trackById(world.player.homeTrack).name}</h2>
    <table class="card"><thead><tr><th>Dog</th><th>Grade</th><th>Form</th><th>Fee</th></tr></thead><tbody>
      ${book.filter((e) => !e.own).map((e) => `<tr><td>${e.dog.name}</td><td>${gradeLabel(e.dog.classKey, e.dog.grade)}</td><td>${formFigures(e.dog)}</td><td>£${e.fee}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">Kennel prefix <input id="prefix" maxlength="16" value="${b.prefix}"> <button id="btn-prefix">Change</button> (used for pups born from now on)</p>`;

  $('breeding').querySelectorAll('[data-mate]').forEach((el) => el.addEventListener('click', () => {
    const d = b.broods.find((x) => x.id === el.dataset.mate);
    const entry = book[+$('breeding').querySelector(`[data-sire-for="${d.id}"]`).value];
    const res = mate(world, d, entry);
    save();
    renderBreeding();
    $('breeding-sum').textContent = res.message;
  }));
  $('breeding').querySelectorAll('[data-rehome]').forEach((el) => el.addEventListener('click', () => {
    const key = `rehome:${el.dataset.rehome}`;
    if (state.confirm !== key) { state.confirm = key; renderBreeding(); return; }
    state.confirm = null;
    rehome(world, [...b.broods, ...b.studs].find((x) => x.id === el.dataset.rehome));
    save();
    renderBreeding();
  }));
  $('breeding').querySelectorAll('[data-sellpup]').forEach((el) => el.addEventListener('click', () => {
    sellPuppy(world, b.puppies.find((x) => x.dog.id === el.dataset.sellpup));
    save();
    renderBreeding();
  }));
  $('btn-prefix').addEventListener('click', () => {
    b.prefix = $('prefix').value.trim() || b.prefix;
    save();
    renderBreeding();
  });
}

// ---------------------------------------------------------------------------
// Competitions

function renderCups() {
  const { world } = state;
  updatePurse();
  const season = seasonOf(world.day);
  const nextSeasonDay = (season + 1) * SEASON_DAYS;
  $('cups-sum').textContent = `Season ${season + 1} · next season starts ${formatDay(nextSeasonDay)}`;
  const nameOf = (id) => {
    const d = findAnyDog(id);
    return d ? `<span class="${isMine(d) ? 'mine-name' : ''}">${d.name}</span>` : '?';
  };
  const list = cupsByDate(world).filter((c) => c.season >= season - 1 && (c.stage !== 'done' || c.season >= season - 1));
  $('cups').innerHTML = list.map((inst) => {
    const cup = cupById(inst.cupId);
    const track = cupTrack(inst);
    const distance = track.distances[CLASSES[cup.classKey].distIndex];
    const eligible = myDogs(world).filter((d) => !entryProblem(world, inst, d));
    const rounds = ['heats', 'semis', 'final'].map((r) => {
      const groups = r === 'final' ? (inst.field.final ? [inst.field.final] : []) : (inst.field[r] || []);
      if (!groups.length) return '';
      const res = inst.results[r] || [];
      return `<div class="cup-round"><b>${r === 'heats' ? 'Heats' : r === 'semis' ? 'Semi-finals' : 'Final'}</b> <span class="muted">${formatDay(inst.days[r])}</span>
        ${groups.map((ids, i) => `<div class="cup-group">${groups.length > 1 ? `${i + 1}: ` : ''}${(res[i] || ids).map((id, k) => `${res[i] ? `${k + 1}. ` : ''}${nameOf(id)}`).join(', ')}</div>`).join('')}</div>`;
    }).join('');
    return `
    <article class="runner cup">
      <div class="runner-head">
        <span class="runner-name">🏆 ${cup.name}</span>
        <span class="grade-tag">${track.name} ${distance}m</span>
        <span class="muted">Season ${inst.season + 1}</span>
      </div>
      <div class="runner-sub muted">Heats ${formatDay(inst.days.heats)} · semi-finals ${formatDay(inst.days.semis)} · final ${formatDay(inst.days.final)} · entry £${cup.entryFee} · winner £${cup.prizes[0].toLocaleString('en-GB')}</div>
      ${inst.stage === 'done' ? `<div>Won by <b>${nameOf(inst.winner)}</b>.</div>` : ''}
      ${inst.playerEntries.length ? `<div>Your entries: ${inst.playerEntries.map(nameOf).join(', ')}</div>` : ''}
      ${inst.stage === 'entries' && world.day < inst.days.heats
        ? (eligible.length ? `<div class="slip-line">Enter <select data-cup="${inst.key}">${eligible.map((d) => `<option value="${d.id}">${d.name} (${gradeLabel(d.classKey, d.grade)})</option>`).join('')}</select> <button class="primary" data-enter-cup="${inst.key}" ${world.balance < cup.entryFee ? 'disabled' : ''}>Enter £${cup.entryFee}</button></div>`
          : `<div class="muted">You have no ${cup.classKey === 'stay' ? 'stayers' : cup.classKey === 'sprint' ? 'sprinters' : 'standard-distance dogs'} to enter.</div>`) : ''}
      ${rounds}
    </article>`;
  }).join('') + (world.trophies.length ? `<h2 class="sub">Your trophy cabinet</h2><ul class="news">${world.trophies.map((t) => `<li>🏆 ${t.cup}: ${t.dog} (${formatDay(t.day)})</li>`).join('')}</ul>` : '');

  $('cups').querySelectorAll('[data-enter-cup]').forEach((el) => el.addEventListener('click', () => {
    const inst = world.cups.find((c) => c.key === el.dataset.enterCup);
    const dog = myDogs(world).find((d) => d.id === $('cups').querySelector(`[data-cup="${inst.key}"]`).value);
    const cup = cupById(inst.cupId);
    if (!dog || entryProblem(world, inst, dog) || world.balance < cup.entryFee) return;
    inst.playerEntries.push(dog.id);
    addLedger(world, `Entry fee: ${dog.name} in the ${cup.name}`, -cup.entryFee);
    save();
    renderCups();
  }));
}

function findAnyDog(id) {
  const { world } = state;
  for (const ts of Object.values(world.tracks)) {
    const d = ts.dogs.find((x) => x.id === id);
    if (d) return d;
  }
  const b = breedingState(world);
  return [...b.broods, ...b.studs].find((x) => x.id === id) || null;
}

// ---------------------------------------------------------------------------
// Sales

function renderSales() {
  const { world } = state;
  updatePurse();
  const sales = salesList(world);
  save();
  const nextSale = sales.day + ECONOMY.salesEvery;
  $('sales-sum').textContent = `New dogs on ${formatDay(nextSale)}`;
  if (!sales.items.length) { $('sales').innerHTML = '<p>Everything has been sold. More dogs come in next week.</p>'; return; }
  $('sales').innerHTML = sales.items.map((item, i) => {
    const { dog } = item;
    const trials = item.kind === 'youngster'
      ? `<table class="form"><thead><tr><th>Trial</th><th>Dis</th><th>Trp</th><th>Sec</th><th>Fin</th><th>Time</th><th>Gng</th><th>CalTm</th><th>Remarks</th></tr></thead><tbody>${dog.trials.map((t, k) => `
          <tr><td>${k + 1}</td><td>${t.distance}</td><td>[${t.trap}]</td><td>${t.sectional.toFixed(2)}</td><td class="fin">${ordinal(t.pos)}</td><td>${t.time.toFixed(2)}</td><td>${t.going > 0 ? '+' : ''}${t.going}</td><td>${t.calcTime.toFixed(2)}</td><td class="remarks">${t.comments}</td></tr>`).join('')}</tbody></table>`
      : formLines(dog);
    return `
    <article class="runner">
      <div class="runner-head">
        <span class="runner-name">${dog.name} <span class="seed">(${SEED_LETTER[dog.style]})</span></span>
        <span class="grade-tag">${item.kind === 'youngster' ? 'Unraced' : gradeLabel(dog.classKey, dog.grade)}</span>
        ${item.kind === 'raced' ? `<span class="runner-form">${formFigures(dog)}</span>` : ''}
        <button class="primary buy" data-buy="${i}" ${world.balance < item.price ? 'disabled' : ''}>Buy £${item.price.toLocaleString('en-GB')}</button>
      </div>
      <div class="runner-sub muted">${CLASS_LABEL[dog.classKey]} · ${COAT_LABEL[dog.coat] || dog.coat} ${dog.sex.toLowerCase()}, ${dog.age} yrs, ${dog.weight}kg · ${STYLES[dog.style].label} · ${item.kind === 'youngster' ? 'from a breeder, two trials at your track against ordinary dogs' : `from ${dog.trainer}'s kennel`}</div>
      ${hiddenStats(dog)}
      <div class="form-wrap">${trials}</div>
    </article>`;
  }).join('');
  $('sales').querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
    const item = sales.items[+b.dataset.buy];
    const res = buyDog(world, item);
    save();
    renderSales();
    if (res.ok) $('sales-sum').textContent = `${res.message} See the Kennel.`;
  }));
}

// ---------------------------------------------------------------------------
// Calendar, accounts, save & load

function renderCalendar() {
  const { world } = state;
  updatePurse();
  const home = world.player.homeTrack;
  const dogs = myDogs(world).filter((d) => d.entered);
  const rows = [];
  for (let d = world.day; d < world.day + 14; d++) {
    const tracks = tracksRacingOn(d);
    const homeRaces = tracks.some((t) => t.id === home);
    const ready = homeRaces ? dogs.filter((dog) => d - dog.lastRunDay >= REST_DAYS) : [];
    rows.push(`<tr class="${d === world.day ? 'today' : ''}">
      <td>${formatDay(d)}${d === world.day ? ' <span class="muted">(today)</span>' : ''}</td>
      <td>${tracks.map((t) => (t.id === home ? `<b>${t.name}</b>` : t.name)).join(', ')}</td>
      <td>${homeRaces ? (ready.length ? ready.map((x) => x.name).join(', ') : '<span class="muted">none ready</span>') : ''}</td></tr>`);
  }
  $('calendar').innerHTML = `<table class="card"><thead><tr><th>Day</th><th>Meetings</th><th>Your dogs able to run at ${trackById(home).name}</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="muted small">A dog needs ${REST_DAYS} days between races. The racing manager puts every entered, rested dog of yours into a race at your track's next meeting.</p>`;
}

function renderAccounts() {
  const { world } = state;
  updatePurse();
  const week = world.ledger.filter((l) => world.day - l.day < 7);
  const sum = (list, f) => list.filter(f).reduce((a, l) => a + l.amount, 0);
  const groups = [
    ['Prize money and fees', (l) => / ran \d/.test(l.text)],
    ['Betting', (l) => l.text.startsWith('Bet')],
    ['Kennel bills', (l) => l.text.startsWith('Kennel bills')],
    ['Buying and selling dogs', (l) => /^(Bought|Sold) /.test(l.text)],
    ['Competition entries', (l) => l.text.startsWith('Entry fee')],
    ['Breeding (stud fees, pups sold)', (l) => /^(Stud fee|Sold pup)/.test(l.text)],
  ];
  $('accounts-sum').textContent = `Purse ${money(world.balance)}`;
  $('accounts').innerHTML = `
    <table class="card"><thead><tr><th>Last 7 days</th><th>Amount</th></tr></thead><tbody>
      ${groups.map(([label, f]) => `<tr><td>${label}</td><td class="${sum(week, f) < 0 ? 'lost' : 'won'}">${money(sum(week, f))}</td></tr>`).join('')}
    </tbody></table>
    <h2 class="sub">Every entry</h2>
    <table class="card"><thead><tr><th>Day</th><th>What</th><th>Amount</th></tr></thead><tbody>
      ${world.ledger.slice(0, 120).map((l) => `<tr><td>${formatDay(l.day)}</td><td>${l.text}</td><td class="${l.amount < 0 ? 'lost' : 'won'}">${money(l.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}
    </tbody></table>`;
}

function renderGame() {
  const { world } = state;
  updatePurse();
  $('game-info').innerHTML = `<p><b>${world.player.name}</b> · home track ${trackById(world.player.homeTrack).name} · ${formatDay(world.day)} · ${myDogs(world).length} dogs · purse ${money(world.balance)}</p>`;
  $('btn-new-game').textContent = state.confirm === 'new' ? 'Sure? This deletes your saved game' : 'Start a new game…';
  $('btn-new-game').classList.toggle('primary', state.confirm === 'new');
}

// ---------------------------------------------------------------------------

async function boot() {
  const [assets] = await Promise.all([loadAssets(), loadGameData()]);
  state.raceView = new RaceView($('race'), assets);
  state.map = new MiniMap($('map'));
  state.newTrack = TRACKS[0].id;

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
  $('btn-next-day').addEventListener('click', () => nextDay(1));
  $('btn-week').addEventListener('click', () => nextDay(7));
  $('btn-full').addEventListener('click', () => {
    const el = document.querySelector('.screen');
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  });
  document.querySelectorAll('#nav [data-screen]').forEach((b) => b.addEventListener('click', () => go(b.dataset.screen)));
  document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => {
    state.speed = +b.dataset.speed;
    document.querySelectorAll('.speed button').forEach((o) => o.classList.toggle('on', o === b));
  }));
  $('chk-stats').addEventListener('change', (e) => document.body.classList.toggle('show-stats', e.target.checked));
  $('btn-new-start').addEventListener('click', startNewGame);
  $('new-load').addEventListener('change', (e) => loadFromFile(e.target));
  $('game-load').addEventListener('change', (e) => loadFromFile(e.target));
  $('btn-export').addEventListener('click', () => exportSave(state.world));
  $('btn-new-game').addEventListener('click', () => {
    if (state.confirm !== 'new') { state.confirm = 'new'; renderGame(); return; }
    state.meeting = null;
    showNewGame();
  });

  const saved = loadGame();
  if (saved) {
    state.world = saved;
    showLobby(`<b>Welcome back to ${saved.player.name}.</b>`);
  } else {
    showNewGame();
  }
  loop();
}

boot().catch((err) => {
  console.error(err);
  show('screen-lobby');
  const hint = /typing mistake/.test(err.message) ? '' : ' Run the game from a local web server (see README).';
  $('lobby-note').classList.remove('hidden');
  $('lobby-note').textContent = `Could not start: ${err.message}.${hint}`;
});
