// Track geometry. Every track is a "stadium" oval: two straights joined by
// two semicircular bends. Dogs run anticlockwise.
//
// Positions round the loop are measured in metres along the inside rail ("s"),
// starting at the entry to the first bend (bend 1).
//
//   s = 0 ............ bend 1 entry  (bends 1 & 2)
//   s = PI*R ......... back straight
//   s = PI*R + S ..... bend 3 entry  (bends 3 & 4)
//   s = 2*PI*R + S ... home straight, finish line near its end

export const RACING_WIDTH = 3.6; // metres from the rail to the widest racing line (lane 1)

// The tracks themselves live in data/tracks.json so they can be edited without
// touching code. loadGameData() (src/data.js) fills this list at start-up.
export const TRACKS = [];

const OLD_ORDER = ['sprint', 'standard', 'stay', 'marathon'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // day 0 of the calendar is a Monday

export function setTracks(list) {
  TRACKS.length = 0;
  list.forEach((t, i) => {
    // Older tracks files listed distances as [sprint, standard, stay, marathon].
    const distances = Array.isArray(t.distances)
      ? Object.fromEntries(t.distances.slice(0, 3).map((d, k) => [OLD_ORDER[k], d]))
      : { ...t.distances };
    const nights = t.nights?.length ? t.nights : (i % 2 ? ['Tue', 'Thu', 'Sat'] : ['Mon', 'Wed', 'Fri']);
    TRACKS.push({ goingBase: 0, description: '', ...t, distances, nights });
  });
}

/** Does this track race on calendar day `day`? */
export function racesOn(track, day) {
  return !!track && track.nights.includes(WEEKDAYS[((day % 7) + 7) % 7]);
}

/** The distance a track runs a kind of race over (null if it doesn't stage them). */
export function raceDistance(track, classKey) {
  return track?.distances?.[classKey] ?? null;
}

/** Kinds of race a track stages, in the order of CLASSES. */
export function classesAt(track, classKeys) {
  return classKeys.filter((k) => raceDistance(track, k));
}

/**
 * Where the hurdles are in a hurdle race, as distances from the traps: two
 * flights on each straight, none in the first 20m or the last 15m.
 */
export function hurdlePositions(track, distance) {
  const { straight: S, radius: R } = track;
  const C = circumference(track);
  const bend = Math.PI * R;
  const s0 = startS(track, distance);
  const spots = [bend + S * 0.3, bend + S * 0.7, 2 * bend + S * 1.3, 2 * bend + S * 1.7];
  const out = [];
  for (const s of spots) {
    for (let d = mod(s - s0, C); d < distance; d += C) if (d >= 20 && distance - d >= 15) out.push(+d.toFixed(1));
  }
  return out.sort((a, b) => a - b);
}

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

const mod = (a, n) => ((a % n) + n) % n;

export function circumference(track) {
  return 2 * track.straight + 2 * Math.PI * track.radius;
}

export function finishS(track) {
  return circumference(track) - track.finishBeforeBend;
}

/** Position round the loop (s) of the traps for a race of `distance` metres. */
export function startS(track, distance) {
  return mod(finishS(track) - distance, circumference(track));
}

/** Which part of the track a loop position is on. */
export function segmentAt(track, s) {
  const { straight: S, radius: R } = track;
  const bend = Math.PI * R;
  s = mod(s, circumference(track));
  if (s < bend) return { type: 'bend', name: s < bend / 2 ? 'bend 1' : 'bend 2', index: s < bend / 2 ? 1 : 2 };
  if (s < bend + S) return { type: 'straight', name: 'back straight' };
  if (s < 2 * bend + S) return { type: 'bend', name: s < 1.5 * bend + S ? 'bend 3' : 'bend 4', index: s < 1.5 * bend + S ? 3 : 4 };
  return { type: 'straight', name: 'home straight' };
}

/** Loop positions where each numbered bend starts (used for bend-position form figures). */
export function bendMarkers(track) {
  const { straight: S, radius: R } = track;
  const bend = Math.PI * R;
  return [
    { index: 1, s: 0 },
    { index: 2, s: bend / 2 },
    { index: 3, s: bend + S },
    { index: 4, s: 1.5 * bend + S },
  ];
}

/**
 * Plan (top-down) coordinates for a loop position, for the mini map.
 * Returns metres with the track centre at (0,0), y pointing down the screen.
 * `offset` is metres out from the rail.
 */
export function planPoint(track, s, offset = 0) {
  const { straight: S, radius: R } = track;
  const bend = Math.PI * R;
  const r = R + offset;
  s = mod(s, circumference(track));
  if (s < bend) {
    // Right-hand bend (1 & 2): from bottom-right going up to top-right
    const a = Math.PI / 2 - s / R; // +90deg (bottom) to -90deg (top)
    return { x: S / 2 + r * Math.cos(a), y: r * Math.sin(a) };
  }
  if (s < bend + S) {
    const u = s - bend;
    return { x: S / 2 - u, y: -r };
  }
  if (s < 2 * bend + S) {
    const u = s - bend - S;
    const a = -Math.PI / 2 - u / R; // top to bottom round the left side
    return { x: -S / 2 + r * Math.cos(a), y: r * Math.sin(a) };
  }
  const u = s - 2 * bend - S;
  return { x: -S / 2 + u, y: r };
}
