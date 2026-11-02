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

export function setTracks(list) {
  TRACKS.length = 0;
  for (const t of list) TRACKS.push({ goingBase: 0, description: '', ...t });
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
