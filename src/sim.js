// The race engine. It knows nothing about graphics: given a track, a
// distance and six runners it works out the whole race up front, tick by
// tick, and returns every dog's position for every tick plus the result.
// The race screen then just plays those frames back, which makes "skip to
// result", replays and running lots of test races in the background easy.

import { makeRng } from './rng.js';
import {
  circumference, startS, segmentAt, bendMarkers, RACING_WIDTH,
} from './track.js';
import { STYLES } from './dogs.js';

export const DT = 1 / 60;               // simulation step in seconds
export const SECONDS_PER_LENGTH = 0.08; // racing convention for distances beaten
export const DOG_LENGTH_M = 1.3;        // used to show "lengths behind" during a race
export const FRAME_STRIDE = 3;          // values stored per dog per tick: progress, lane, speed

const LANE_W = 0.14;   // lateral room one dog needs, as a fraction of the racing width
const BODY = 1.25;     // nose-to-tail spacing in metres before dogs interfere
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mod = (a, n) => ((a % n) + n) % n;

/** Engine tuning in one place so it can be balanced without hunting through code. */
export const TUNING = {
  baseTopSpeed: 16.5,   // m/s for a dog with topSpeed 0
  topSpeedRange: 1.45,   // extra m/s for topSpeed 100
  baseAccel: 8.0,        // m/s^2 for earlyPace 0
  accelRange: 4.5,
  staminaBase: 230,      // metres a stamina-0 dog holds top speed
  staminaRange: 380,
  fadePer100m: 0.034,    // fraction of speed lost per 100m beyond stamina
  bendCapBase: 0.935,    // fraction of top speed kept on a bend at cornering 0
  bendCapRange: 0.055,
  wideBendBonus: 0.09,   // wide runners can carry a bit more speed round a bend
  driftOut: 0.08,        // how fast poor cornerers drift wide on bends (lanes/s)
  laneRateStraight: 0.22,
  laneRateBend: 0.10,
  goingEffect: 0.0003,   // speed change per point of going (+ is slow)
  fitnessEffect: 0.00025, // speed lost per point of fitness below 100 (fitness 60 = 1% slower, about 3 lengths)
};

/** A tired dog (low fitness, 0-100) is slightly slower. Dogs without a fitness value are fully fit. */
export function fitnessFactor(dog) {
  return dog.fitness === undefined ? 1 : 1 - (100 - dog.fitness) * TUNING.fitnessEffect;
}

function fieldLaneForTrap(trap) {
  return 0.03 + (trap - 1) * 0.14;
}

function prepareRunner(rng, runner, track, going) {
  const { dog, trap } = runner;
  const s = dog.stats;
  const inconsistency = 1 - s.consistency / 100;

  let reaction = 0.1 + (1 - s.breakSpeed / 100) * 0.22 + Math.abs(rng.normal()) * 0.03 * (0.5 + inconsistency);
  let missedBreak = false;
  if (rng.chance(0.015 + inconsistency * 0.05 + (1 - s.breakSpeed / 100) * 0.03)) {
    missedBreak = true;
    reaction += rng.range(0.25, 0.5);
  }

  const dayForm = rng.normal() * (0.004 + inconsistency * 0.012);
  const vmax =
    (TUNING.baseTopSpeed + (s.topSpeed / 100) * TUNING.topSpeedRange) *
    (1 + dayForm) *
    (1 - going * TUNING.goingEffect) *
    fitnessFactor(dog);

  const tightness = (36 - track.radius) * 0.003; // tighter bends are harder for everyone
  const preferredLane = STYLES[dog.style]?.lane ?? 0.35;

  return {
    trap,
    dog,
    d: 0,
    lane: fieldLaneForTrap(trap),
    v: 0,
    reaction,
    missedBreak,
    dayForm,
    vmax,
    accel: TUNING.baseAccel + (s.earlyPace / 100) * TUNING.accelRange,
    staminaDist: TUNING.staminaBase + (s.stamina / 100) * TUNING.staminaRange,
    bendCap: TUNING.bendCapBase + (s.cornering / 100) * TUNING.bendCapRange - tightness,
    drift: (1 - s.cornering / 100) * TUNING.driftOut,
    preferredLane,
    sidestepLane: null,
    sidestepUntil: 0,
    finished: false,
    finishTime: null,
    crossed: [],      // positions when passing each bend marker
    events: [],
    lastEventAt: {},
    laneSum: 0,
    laneN: 0,
    maxBendLane: 0,
    wasLedAt: [],
  };
}

function logEvent(r, type, where, t, cooldown = 1.2) {
  const key = `${type}`;
  if (r.lastEventAt[key] !== undefined && t - r.lastEventAt[key] < cooldown) return;
  r.lastEventAt[key] = t;
  r.events.push({ type, where, t });
}

/** Is there room for runner `r` to be at `lane` without touching anyone? */
function laneIsFree(runners, r, lane) {
  if (lane < 0 || lane > 1) return false;
  for (const o of runners) {
    if (o === r || o.finished) continue;
    if (Math.abs(o.d - r.d) < BODY * 1.15 && Math.abs(o.lane - lane) < LANE_W) return false;
  }
  return true;
}

function whereLabel(seg, d, firstBendD) {
  if (d < firstBendD - 2) return 'run-up';
  if (seg.type === 'bend') return seg.index <= 2 ? '1' : '3';
  return seg.name === 'back straight' ? 'BkStr' : 'RnIn';
}

/**
 * Run a race.
 * @param {object} opts
 * @param {object} opts.track     a track from TRACKS
 * @param {number} opts.distance  race distance in metres
 * @param {Array}  opts.runners   [{ dog, trap }]
 * @param {number} opts.seed      random seed (same seed + same runners = same race)
 * @param {number} [opts.going]   track going, negative is fast, positive slow
 */
export function simulateRace({ track, distance, runners, seed, going = 0 }) {
  const rng = makeRng(seed);
  const C = circumference(track);
  const s0 = startS(track, distance);
  const R = track.radius;

  // Distances from the traps at which each bend marker is passed.
  const markers = bendMarkers(track)
    .flatMap((m) => {
      const first = mod(m.s - s0, C) || C;
      const out = [];
      for (let dm = first; dm < distance; dm += C) out.push({ index: m.index, d: dm });
      return out;
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  const firstBendD = markers.length ? markers[0].d : distance;

  const field = runners.map((r) => prepareRunner(rng, r, track, going));
  const crossCounts = markers.map(() => 0);
  let finishedCount = 0;
  let lastFinishT = null;

  const frames = [];
  const maxSteps = Math.ceil(90 / DT);
  const touching = new Map(); // last time each pair of dogs was in contact

  for (let step = 0; step < maxSteps; step++) {
    const t = step * DT;
    const order = [...field].sort((a, b) => b.d - a.d);

    for (const r of order) {
      if (r.finished) {
        // Pull up gently after the line.
        r.v = Math.max(2.5, r.v - 5 * DT);
        r.d += r.v * DT;
        continue;
      }
      if (t < r.reaction) continue;

      const seg = segmentAt(track, s0 + r.d);
      const onBend = seg.type === 'bend';

      // ---- Target speed --------------------------------------------------
      let target = r.vmax * (1 - TUNING.fadePer100m * Math.max(0, r.d - r.staminaDist) / 100);
      if (onBend) target *= Math.min(1, r.bendCap + r.lane * TUNING.wideBendBonus);

      if (r.v < target) r.v += r.accel * (1 - (r.v / target) ** 3) * DT;
      else r.v = Math.max(target, r.v - 3.5 * DT);

      // ---- Traffic ---------------------------------------------------------
      let blocker = null;
      let bestGap = Infinity;
      for (const o of field) {
        if (o === r || o.finished) continue;
        const gap = o.d - r.d;
        if (gap > 0 && gap < BODY * 1.4 && Math.abs(o.lane - r.lane) < LANE_W && gap < bestGap) {
          blocker = o; bestGap = gap;
        }
      }
      if (blocker) {
        if (bestGap < BODY) {
          const before = r.v;
          r.v = Math.min(r.v, Math.max(0, blocker.v - 0.6 * (BODY - bestGap)));
          if (before - r.v > 0.25) logEvent(r, 'crowded', whereLabel(seg, r.d, firstBendD), t);
        }
        if (t > r.sidestepUntil) {
          const options = [r.lane - LANE_W * 1.1, r.lane + LANE_W * 1.1]
            .filter((l) => laneIsFree(field, r, l))
            .sort((a, b) => Math.abs(a - r.preferredLane) - Math.abs(b - r.preferredLane));
          if (options.length) {
            r.sidestepLane = options[0];
            r.sidestepUntil = t + 0.9;
          }
        }
      }

      // ---- Lateral movement --------------------------------------------------
      const desired = t < r.sidestepUntil && r.sidestepLane !== null ? r.sidestepLane : r.preferredLane;
      const rate = onBend ? TUNING.laneRateBend : TUNING.laneRateStraight;
      const latStep = clamp(desired - r.lane, -rate * DT * 1.6, rate * DT * 1.6);
      if (latStep >= 0 || laneIsFree(field, r, r.lane + latStep - 0.02)) r.lane += latStep;
      if (onBend) r.lane += r.drift * DT * (r.v / 16);
      r.lane = clamp(r.lane, 0, 1);
      if (onBend) r.maxBendLane = Math.max(r.maxBendLane, r.lane);

      // ---- Move ----------------------------------------------------------
      const progress = r.v * DT * (onBend ? R / (R + r.lane * RACING_WIDTH) : 1);
      const prevD = r.d;
      r.d += progress;
      r.laneSum += r.lane; r.laneN++;

      markers.forEach((m, k) => {
        if (prevD < m.d && r.d >= m.d) r.crossed[k] = ++crossCounts[k];
      });

      if (r.d >= distance) {
        r.finished = true;
        r.finishTime = t + DT * ((distance - prevD) / progress);
        finishedCount++;
        lastFinishT = t;
      }
    }

    // ---- Bumping: dogs side by side and touching both lose ground -----------
    for (let i = 0; i < field.length; i++) {
      for (let j = i + 1; j < field.length; j++) {
        const a = field[i], b = field[j];
        if (a.finished || b.finished || t < Math.max(a.reaction, b.reaction)) continue;
        if (Math.abs(a.d - b.d) < BODY * 0.8 && Math.abs(a.lane - b.lane) < LANE_W * 0.8) {
          const push = (LANE_W * 0.8 - Math.abs(a.lane - b.lane)) / 2;
          const [inner, outer] = a.lane <= b.lane ? [a, b] : [b, a];
          inner.lane = clamp(inner.lane - push, 0, 1);
          outer.lane = clamp(outer.lane + push, 0, 1);
          const key = a.trap * 10 + b.trap;
          const fresh = !(touching.get(key) > t - 0.5);
          touching.set(key, t);
          if (fresh && rng.chance(0.15)) {
            const seg = segmentAt(track, s0 + a.d);
            const where = whereLabel(seg, a.d, firstBendD);
            for (const r of [a, b]) {
              r.v = Math.max(0, r.v - rng.range(0.2, 0.6));
              logEvent(r, 'bumped', where, t, 1.5);
            }
          }
        }
      }
    }

    // ---- Record the frame --------------------------------------------------
    const f = new Float32Array(field.length * FRAME_STRIDE);
    field.forEach((r, i) => {
      f[i * 3] = r.d; f[i * 3 + 1] = r.lane; f[i * 3 + 2] = r.v;
    });
    frames.push(f);

    if (finishedCount === field.length && t - lastFinishT > 2.5) break;
  }

  return buildResult({ track, distance, going, seed, field, frames, markers, firstBendD });
}

// ---------------------------------------------------------------------------
// Results and form figures

export function formatMargin(lengths) {
  if (lengths < 0.04) return 'DH';
  if (lengths < 0.15) return 'SH';
  if (lengths < 0.3) return 'Hd';
  if (lengths < 0.45) return 'Nk';
  const q = Math.round(lengths * 4) / 4;
  const whole = Math.floor(q);
  const frac = { 0: '', 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' }[q - whole];
  if (whole === 0) return frac;
  if (whole >= 12) return `${Math.round(lengths)}`;
  return frac ? `${whole} ${frac}` : `${whole}`;
}

function buildComments(r, position, bendPositions, fieldSize) {
  const c = [];
  if (r.missedBreak) c.push('MsdBrk');
  else if (r.reaction > 0.29) c.push('SAw');
  else if (r.reaction < 0.15) c.push('QAw');

  if (bendPositions[0] === 1) c.push(position === 1 && bendPositions.every((p) => p === 1) ? 'ALed' : 'EP');

  const seen = new Set();
  for (const e of r.events) {
    const tag = (e.type === 'crowded' ? 'Crd' : 'Bmp') + (e.where === 'run-up' ? 'RnUp' : e.where);
    if (!seen.has(tag) && seen.size < 3) { seen.add(tag); c.push(tag); }
  }

  if (r.maxBendLane > 0.62 && r.dog.style !== 'wide') c.push('RnWd');

  const lastBend = bendPositions[bendPositions.length - 1];
  if (lastBend && position !== 1) {
    if (lastBend - position >= 2) c.push('RnOn');
    else if (position - lastBend >= 2) c.push('Fdd');
  }
  if (position === 1 && lastBend && lastBend > 1) c.push('LdRnIn');
  if (position === fieldSize && c.length === 0) c.push('Outpcd');

  const avgLane = r.laneSum / Math.max(1, r.laneN);
  c.push(avgLane < 0.15 ? 'Rls' : avgLane < 0.45 ? 'Mid' : 'Wide');
  return c.join(',');
}

function buildResult({ track, distance, going, seed, field, frames, markers, firstBendD }) {
  const finishers = [...field].sort((a, b) => a.finishTime - b.finishTime);
  const winnerTime = finishers[0].finishTime;
  const sectionalD = firstBendD;

  const sectionalTime = (idx) => {
    for (let k = 0; k < frames.length; k++) {
      if (frames[k][idx * 3] >= sectionalD) return k * DT;
    }
    return null;
  };

  const results = finishers.map((r, i) => {
    const idx = field.indexOf(r);
    const position = i + 1;
    const behind = (r.finishTime - winnerTime) / SECONDS_PER_LENGTH;
    const prev = i === 0 ? null : finishers[i - 1];
    const margin = prev ? (r.finishTime - prev.finishTime) / SECONDS_PER_LENGTH : null;
    const bendPositions = markers.map((_, k) => r.crossed[k] || field.length);
    return {
      position,
      trap: r.trap,
      dog: r.dog,
      time: +r.finishTime.toFixed(2),
      sectional: +(sectionalTime(idx) ?? 0).toFixed(2),
      behindLengths: +behind.toFixed(2),
      margin: margin === null ? '' : formatMargin(margin),
      bendPositions,
      bendFigures: bendPositions.join(''),
      comments: buildComments(r, position, bendPositions, field.length),
      reaction: +r.reaction.toFixed(2),
      events: r.events.map((e) => ({ type: e.type, where: e.where, t: +e.t.toFixed(2) })),
      dayForm: r.dayForm,
    };
  });

  return {
    seed,
    trackId: track.id,
    distance,
    going,
    dt: DT,
    frames,
    runners: field.map((r) => ({ trap: r.trap, dog: r.dog })),
    results,
    winnerTime: +winnerTime.toFixed(2),
    sectionalDistance: +sectionalD.toFixed(0),
  };
}
