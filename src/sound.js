// Race sounds, made in code with the browser's Web Audio (no sound files):
// a bell as the hare starts running, the clang of the traps opening, the
// whirr of the hare, and a crowd that gets louder as the dogs near the line
// and roars when they cross it. Change the numbers below to change the sounds.

const VOLUME = 0.6;        // overall loudness (0 to 1)
const CROWD_QUIET = 0.05;  // crowd murmur at the start
const CROWD_LOUD = 0.32;   // crowd at its loudest, as the winner crosses the line
const BUILD_UP = 150;      // metres from home where the crowd starts to get louder
const HARE_VOLUME = 0.035;

let ctx = null;
let master = null;
let muted = false;
let crowd = null;
let hare = null;
let lastT = null;
let roarAt = null;

function ensure() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  master.connect(ctx.destination);
  return ctx;
}

/** Call from a click (browsers only allow sound to start after one). */
export function unlockSound() {
  ensure()?.resume?.();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : VOLUME, ctx.currentTime, 0.05);
}

function noise(seconds) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.04 * white) / 1.04; // softer, rumbling noise mixed in
    data[i] = white * 0.35 + brown * 3;
  }
  return buf;
}

function envelope(gain, peak, attack, decay, when = ctx.currentTime) {
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
}

function bell() {
  const now = ctx.currentTime;
  for (const [ratio, vol] of [[1, 0.25], [2.4, 0.12], [3.9, 0.06], [5.4, 0.04]]) {
    for (const strike of [0, 0.35]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 740 * ratio;
      envelope(g, vol, 0.005, 1.2, now + strike);
      o.connect(g).connect(master);
      o.start(now + strike);
      o.stop(now + strike + 1.4);
    }
  }
}

function clang() {
  const now = ctx.currentTime;
  const n = ctx.createBufferSource();
  n.buffer = noise(0.4);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 2;
  const g = ctx.createGain();
  envelope(g, 0.7, 0.003, 0.25);
  n.connect(bp).connect(g).connect(master);
  n.start(now);
  for (const [f, v] of [[95, 0.5], [1320, 0.08], [1870, 0.05]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = f < 200 ? 'square' : 'sine';
    o.frequency.value = f;
    envelope(og, v, 0.003, f < 200 ? 0.12 : 0.5);
    o.connect(og).connect(master);
    o.start(now);
    o.stop(now + 0.6);
  }
}

function startLoops() {
  const now = ctx.currentTime;
  // Crowd: looped noise through a soft filter.
  const src = ctx.createBufferSource();
  src.buffer = noise(3);
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.0001, now);
  cg.gain.exponentialRampToValueAtTime(CROWD_QUIET, now + 0.8);
  src.connect(bp).connect(cg).connect(master);
  src.start(now);
  crowd = { src, gain: cg, filter: bp };
  // Hare: two buzzing notes, slightly apart, through a low filter.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 700;
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.0001, now);
  hg.gain.exponentialRampToValueAtTime(HARE_VOLUME, now + 0.5);
  const oscs = [0, 1.5].map((detune) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 45 + detune;
    o.connect(lp);
    o.start(now);
    return o;
  });
  lp.connect(hg).connect(master);
  hare = { oscs, gain: hg };
}

function stopLoops(fade = 1.5) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const loop of [crowd, hare]) {
    if (!loop) continue;
    loop.gain.gain.cancelScheduledValues(now);
    loop.gain.gain.setTargetAtTime(0.0001, now, fade / 4);
    for (const s of loop.oscs || [loop.src]) s.stop(now + fade + 0.2);
  }
  crowd = hare = null;
}

/**
 * Call every frame while a race is on screen. t is race time (negative while
 * the hare runs up to the traps), leaderD the leader's distance run (metres).
 */
export function raceSound(t, leaderD, distance) {
  if (!ensure() || ctx.state !== 'running') return;
  if (lastT === null || t < lastT - 0.5) {
    stopLoops(0.3);
    startLoops();
    if (t < -1) bell();
    roarAt = null;
  }
  if (lastT !== null && lastT < 0 && t >= 0) clang();
  const now = ctx.currentTime;
  // The hare's buzz rises with its speed (it runs ahead of the leader).
  const hareSpeed = Math.min(18, Math.max(4, 17 * Math.min(1, (t + 2.5) / 3)));
  for (const o of hare.oscs) o.frequency.setTargetAtTime(30 + hareSpeed * 3 + (o === hare.oscs[1] ? 1.5 : 0), now, 0.2);
  // Crowd: builds over the last BUILD_UP metres, roars at the line, then settles.
  let level;
  if (leaderD >= distance) {
    roarAt ??= now;
    const since = now - roarAt;
    level = since < 1.2 ? 1 : Math.max(0.35, 1 - (since - 1.2) * 0.4);
  } else {
    const k = Math.max(0, Math.min(1, (leaderD - (distance - BUILD_UP)) / BUILD_UP));
    level = 0.1 + 0.75 * k * k + (t > 0 && t < 2 ? 0.15 : 0);
  }
  const vol = CROWD_QUIET + (CROWD_LOUD - CROWD_QUIET) * level;
  crowd.gain.gain.setTargetAtTime(vol, now, 0.25);
  crowd.filter.frequency.setTargetAtTime(700 + 900 * level, now, 0.3);
  lastT = t;
}

/** The race is over (or was skipped, or left): let the sounds die away. */
export function raceSoundEnd() {
  stopLoops(roarAt ? 3 : 0.5);
  lastT = null;
  roarAt = null;
}
