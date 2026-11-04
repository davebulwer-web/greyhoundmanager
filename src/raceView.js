// Draws a race. Plays back the frames the simulation produced, with a
// side-on camera that follows the leaders. All art comes from the manifest.

import { DT, FRAME_STRIDE, TAKE_OFF } from './sim.js';
import { circumference, finishS, startS } from './track.js';

export const PRE_START = 2.5; // seconds of hare running before the traps open
export const CLOSE_UP = 1.5;  // how far the close-up camera zooms in for the run to the line
export const CLOSE_UP_FROM = 150; // metres from the finish where the close-up starts
const OUT_SCALE = 3;          // the on-screen canvas is this many times the size of the scene

const mod = (a, n) => ((a % n) + n) % n;

export class RaceView {
  constructor(canvas, assets) {
    this.assets = assets;
    this.view = assets.view;
    // The scene is drawn at its own size (640 x 240) on a hidden canvas, then
    // copied (zoomed in when close-up is on) onto the bigger canvas on screen.
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.view.width;
    this.canvas.height = this.view.height;
    this.ctx = this.canvas.getContext('2d');
    this.out = canvas.getContext('2d');
    canvas.width = this.view.width * OUT_SCALE;
    canvas.height = this.view.height * OUT_SCALE;
    this.out.imageSmoothingEnabled = false;
    this.viewMetres = this.view.width / this.view.pixelsPerMetre;
    this.zoom = 1;
  }

  /** meetingRace (optional) is the race on the card, used to spot competition nights. */
  setRace(race, track, meetingRace) {
    this.race = race;
    this.track = track;
    this.standImages = this.pickStands(track, meetingRace);
    this.cam = this.startCam();
    this.anim = race.runners.map((_, i) => (i * 3) % 8);
    this.zoom = 1;
    this.lastT = -PRE_START;
    this.dispY = null;
    this.sides = null;
  }

  /**
   * Little arrows over the dogs you care about: gold for your own dogs, green
   * for dogs you've backed (`this.marks` is { mine: Set, bet: Set } of traps).
   */
  drawPointers(pointers) {
    const { ctx } = this;
    const marks = this.marks;
    if (!marks) return;
    for (const p of pointers) {
      const colours = [];
      if (marks.mine?.has(p.trap)) colours.push('#ffd23f');
      if (marks.bet?.has(p.trap)) colours.push('#6fe36f');
      colours.forEach((c, k) => {
        const cx = Math.round(p.x + (k - (colours.length - 1) / 2) * 12);
        const top = p.y - 6;
        // A dark outline, then the coloured arrow (rows 9, 7, 5, 3 and 1 pixels wide, on a 2-row stem).
        ctx.fillStyle = '#111';
        ctx.fillRect(cx - 3, top - 4, 7, 5);
        for (let r = 0; r < 6; r++) ctx.fillRect(cx - 5 + r, top + r, 11 - 2 * r, 1);
        ctx.fillStyle = c;
        ctx.fillRect(cx - 2, top - 3, 5, 3);
        for (let r = 0; r < 5; r++) ctx.fillRect(cx - 4 + r, top + r, 9 - 2 * r, 1);
      });
    }
  }

  /** The grandstands for this track, in order. Competition races add the
   * tournament stand (second, so the track's first stand keeps its place by the line). */
  pickStands(track, meetingRace) {
    const { stands = {}, cupStand } = this.assets;
    const names = [...(track?.stands || [])];
    if (meetingRace?.cup && cupStand) names.splice(1, 0, cupStand);
    const images = names.map((n) => stands[n]).filter(Boolean);
    return images.length ? images : null;
  }

  startCam() {
    return -this.viewMetres * 0.4;
  }

  get endTime() {
    return (this.race.frames.length - 1) * DT;
  }

  /** Every dog's {d, lane, v} at race time t (interpolated between ticks). */
  stateAt(t) {
    const { frames, runners } = this.race;
    if (t <= 0) return runners.map((_, i) => ({ d: 0, lane: frames[0][i * FRAME_STRIDE + 1], v: 0 }));
    const f = Math.min(t / DT, frames.length - 1);
    const k = Math.floor(f);
    const a = frames[k];
    const b = frames[Math.min(k + 1, frames.length - 1)];
    const u = f - k;
    return runners.map((_, i) => {
      const o = i * FRAME_STRIDE;
      return {
        d: a[o] + (b[o] - a[o]) * u,
        lane: a[o + 1] + (b[o + 1] - a[o + 1]) * u,
        v: a[o + 2] + (b[o + 2] - a[o + 2]) * u,
      };
    });
  }

  laneY(lane) {
    const { railLaneY, wideLaneY } = this.view;
    return railLaneY - lane * (railLaneY - wideLaneY);
  }

  /**
   * Screen height (paw line) for each dog. The sprites are drawn much longer
   * than a real dog, so two dogs the engine has nose-to-tail in the same lane
   * would overlap on screen. When dogs overlap lengthways we ease them apart
   * vertically, so one is clearly nearer the camera and drawn in front.
   * Only the drawing moves: who is ahead is untouched.
   */
  displayYs(states, g, simStep, snap) {
    const { pixelsPerMetre: ppm, wideLaneY, railLaneY } = this.view;
    const bodyPx = g.frameWidth * 0.85;
    const minDy = Math.round(g.frameHeight * 0.42);
    const ys = states.map((s) => this.laneY(s.lane));
    if (!this.sides || snap || simStep > 1) this.sides = new Map();
    const prev = this.dispY && !snap && simStep <= 1 ? this.dispY : ys;

    // While two dogs overlap on screen, each keeps the side (nearer or further
    // from the camera) it had when they first overlapped. They can only swap
    // once they are clear of each other, so nobody passes through anybody.
    const overlapping = [];
    for (let a = 0; a < ys.length; a++) {
      for (let b = a + 1; b < ys.length; b++) {
        const key = a * 8 + b;
        const dx = Math.abs(states[a].d - states[b].d) * ppm;
        if (dx >= bodyPx) { this.sides.delete(key); continue; }
        if (!this.sides.has(key)) {
          const dy = prev[a] - prev[b];
          this.sides.set(key, dy !== 0 ? Math.sign(dy) : (states[a].lane < states[b].lane ? 1 : -1));
        }
        overlapping.push([a, b, this.sides.get(key), minDy * (1 - dx / bodyPx) + 2]);
      }
    }
    for (let iter = 0; iter < 8; iter++) {
      for (const [a, b, side, need] of overlapping) {
        const gap = side * (ys[a] - ys[b]);
        if (gap >= need) continue;
        const push = (need - gap) / 2;
        ys[a] += side * push;
        ys[b] -= side * push;
      }
      for (let k = 0; k < ys.length; k++) ys[k] = Math.max(wideLaneY - 8, Math.min(railLaneY + 2, ys[k]));
    }
    if (!this.dispY || snap || simStep > 1) this.dispY = ys.slice();
    else this.dispY = this.dispY.map((y, k) => y + (ys[k] - y) * Math.min(1, simStep * 6));
    return this.dispY;
  }

  screenX(d) {
    return Math.round((d - this.cam) * this.view.pixelsPerMetre);
  }

  draw(t, opts = {}) {
    const { ctx, view, race } = this;
    const states = this.stateAt(t);
    const distance = race.distance;
    const leaderD = Math.max(...states.map((s) => s.d));

    // ---- camera --------------------------------------------------------------
    // Follow the leader; once the winner is home, drift back to watch the rest finish.
    const avgD = states.reduce((a, st) => a + st.d, 0) / states.length;
    let target = leaderD < distance
      ? leaderD - this.viewMetres * 0.62
      : Math.min(leaderD - this.viewMetres * 0.62, Math.max(distance - this.viewMetres * 0.6, avgD - this.viewMetres * 0.45));
    target = Math.max(target, this.startCam());
    const simStep = Math.max(0, t - this.lastT);
    if (opts.snap || simStep > 1) this.cam = target;
    else this.cam += (target - this.cam) * Math.min(1, simStep * 4);

    // ---- background ------------------------------------------------------------
    ctx.clearRect(0, 0, view.width, view.height);
    for (const layer of this.assets.layers) if (!layer.front) this.drawLayer(layer);

    // finish line(s): the field may pass the winning line more than once
    const C = circumference(this.track);
    for (let fd = distance; fd > -5; fd -= C) {
      const x = this.screenX(fd);
      if (x < -30 || x > view.width + 30) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x, 116, 2, 104);
      const post = this.assets.sprites.finishPost.image;
      ctx.drawImage(post, x - Math.floor(post.width / 2) + 1, 70);
    }

    // distance markers every 100m from the finish
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let md = distance - 100; md > 0; md -= 100) {
      const x = this.screenX(md);
      if (x > -4 && x < view.width + 4) ctx.fillRect(x, 108, 1, 6);
    }

    // ---- hurdles -------------------------------------------------------------------
    const hurdle = this.assets.sprites.hurdle;
    if (hurdle && race.hurdles?.length) {
      for (const hd of race.hurdles) {
        const x = this.screenX(hd) - (hurdle.anchorX ?? 0);
        if (x < -hurdle.image.width || x > view.width) continue;
        ctx.drawImage(hurdle.image, x, (hurdle.bottom ?? view.railLaneY) - hurdle.image.height);
      }
    }

    // ---- traps (behind the dogs once open) --------------------------------------
    const traps = this.assets.sprites.traps;
    const trapsOpen = t >= 0;
    const trapX = this.screenX(0) - 18;
    const drawTraps = () => {
      ctx.drawImage(traps.image, (trapsOpen ? 1 : 0) * traps.frameWidth, 0, traps.frameWidth, traps.frameHeight,
        trapX, 104, traps.frameWidth, traps.frameHeight);
    };
    if (trapsOpen) drawTraps();

    // ---- dogs (far lanes first so nearer dogs overlap them) ---------------------------
    const g = this.assets.sprites.greyhound;
    const j = this.assets.sprites.jacket;
    const dispY = this.displayYs(states, g, simStep, opts.snap);
    const order = states.map((s, i) => ({ ...s, i, y: dispY[i] })).sort((a, b) => a.y - b.y);
    const pointers = [];
    for (const s of order) {
      const runner = race.runners[s.i];
      this.anim[s.i] = (this.anim[s.i] + (s.v / (g.metresPerCycle || 4.6)) * g.frames * simStep) % g.frames;
      // Over a hurdle: u runs 0 to 1 from take-off to landing.
      const u = this.jumpPhase(s.d);
      const jumping = u !== null;
      const gs = jumping && this.assets.sprites.greyhoundJump ? this.assets.sprites.greyhoundJump : g;
      const js = jumping && this.assets.sprites.jacketJump ? this.assets.sprites.jacketJump : j;
      const frame = gs !== g ? Math.min(gs.frames - 1, Math.floor(u * gs.frames)) : s.v < 0.3 ? 0 : Math.floor(this.anim[s.i]);
      const lift = jumping ? Math.round(Math.sin(Math.PI * u) * (this.assets.sprites.hurdle?.jumpHeight ?? 12)) : 0;
      const x = this.screenX(s.d) - gs.anchorX;
      const y = Math.round(s.y) - gs.anchorY;
      if (x < -gs.frameWidth || x > view.width) continue;
      ctx.fillStyle = 'rgba(60,36,16,0.35)';
      const shadowW = Math.round(gs.frameWidth * 0.5);
      ctx.fillRect(x + gs.anchorX - Math.round(shadowW / 2), y + gs.anchorY - 1, shadowW, 2);
      // Sheets either have one row per coat (jacket drawn on top from a
      // separate sheet) or one row per trap with the jacket already painted on.
      const row = gs.rowsBy === 'trap'
        ? runner.trap - 1
        : Math.max(0, gs.rows.indexOf(runner.dog.coat));
      ctx.drawImage(gs.image, frame * gs.frameWidth, row * gs.frameHeight, gs.frameWidth, gs.frameHeight, x, y - lift, gs.frameWidth, gs.frameHeight);
      // The arrow points at the top of the jacket (markerY in the manifest, from the top of the frame).
      pointers.push({ trap: runner.trap, x: x + gs.anchorX, y: y - lift + (j?.markerY ?? 0) });
      if (js && gs.rowsBy !== 'trap') {
        const jf = frame % js.frames;
        ctx.drawImage(js.image, jf * js.frameWidth, (runner.trap - 1) * js.frameHeight, js.frameWidth, js.frameHeight, x, y - lift, js.frameWidth, js.frameHeight);
      }
    }

    if (!trapsOpen) drawTraps();

    // ---- foreground and hare -------------------------------------------------
    for (const layer of this.assets.layers) if (layer.front) this.drawLayer(layer);
    const hare = this.assets.sprites.hare;
    const hareD = Math.max(leaderD + 4, Math.min(17 * t + 2, leaderD + 8));
    const hx = this.screenX(hareD) - hare.anchorX;
    if (hx > -hare.frameWidth && hx < view.width) {
      const hf = Math.floor(mod(t * 12, hare.frames));
      ctx.drawImage(hare.image, hf * hare.frameWidth, 0, hare.frameWidth, hare.frameHeight, hx, view.hareY - hare.anchorY, hare.frameWidth, hare.frameHeight);
    }

    this.drawPointers(pointers);
    this.lastT = t;
    this.present(t, leaderD, simStep, opts);
    return states;
  }

  /**
   * Copy the scene onto the screen. With close-up on, the camera stays wide
   * (stands and all) for most of the race, eases in for the last CLOSE_UP_FROM
   * metres (keeping the track and the advert boards in view, with the leader
   * near the right) and eases back out once the leader is past the line.
   */
  present(t, leaderD, simStep, opts) {
    const { view } = this;
    const running = t > 0 && leaderD >= this.race.distance - CLOSE_UP_FROM && leaderD < this.race.distance + 8;
    const target = opts.closeUp && running ? CLOSE_UP : 1;
    if (opts.snap || simStep > 1) this.zoom = target;
    else this.zoom += (target - this.zoom) * Math.min(1, simStep * 2.5);
    const cw = view.width / this.zoom;
    const ch = view.height / this.zoom;
    const leaderX = (leaderD - this.cam) * view.pixelsPerMetre;
    const cx = Math.max(0, Math.min(view.width - cw, leaderX + 70 - cw));
    const cy = view.height - ch; // keep the bottom of the scene (the track)
    const out = this.out;
    out.imageSmoothingEnabled = false;
    out.drawImage(this.canvas, cx, cy, cw, ch, 0, 0, out.canvas.width, out.canvas.height);
  }

  /** 0 to 1 while a dog at distance d is in the air over a hurdle, otherwise null. */
  jumpPhase(d) {
    const span = this.assets.sprites.hurdle?.jumpLength ?? TAKE_OFF;
    for (const h of this.race.hurdles || []) {
      if (d >= h - span && d <= h + span) return (d - (h - span)) / (2 * span);
    }
    return null;
  }

  /**
   * How far (in pixels) a repeating background layer has scrolled. It is worked
   * out from where the camera is round the track, with a whole number of repeats
   * per lap, so every part of the course shows the same background on every lap
   * (and in every race at that track). `phase` shifts the pattern: 0 means it
   * starts at the left of the screen when the leader reaches the winning line.
   */
  layerOffset(scroll, period, phase = 0) {
    const C = circumference(this.track);
    const lapPx = C * this.view.pixelsPerMetre * scroll;
    // Layers level with the track never run faster than it (that would look
    // wrong against the rail); slower layers just round to the nearest repeat.
    const n = Math.max(1, scroll >= 1 ? Math.floor(lapPx / period) : Math.round(lapPx / period));
    const atLine = finishS(this.track) - 0.62 * this.viewMetres; // camera spot as the leader hits the line
    const p = this.cam + startS(this.track, this.race.distance) - atLine;
    return (mod(p, C) / C) * n * period + phase;
  }

  /** A row of grandstands side by side, bottoms lined up, repeating along the
   * track. The first one (with the track's name board) is opposite the winning line. */
  drawStands(layer, images) {
    const { ctx, view } = this;
    const sky = this.assets.layers.find((l) => !l.repeat && l.y === 0);
    const bottom = layer.bottom ?? layer.y + layer.image.height;
    if (layer.fill) {
      const top = sky ? sky.y + sky.image.height : layer.y;
      ctx.fillStyle = layer.fill;
      ctx.fillRect(0, top, view.width, bottom - top);
    }
    const period = images.reduce((a, img) => a + img.width, 0);
    const offset = this.layerOffset(layer.scroll, period, images[0].width / 2 - 0.62 * view.width);
    let x = -Math.round(mod(offset, period));
    for (let k = 0; x < view.width; k++) {
      const img = images[k % images.length];
      if (x + img.width > 0) ctx.drawImage(img, x, bottom - img.height);
      x += img.width;
    }
  }

  drawLayer(layer) {
    const { ctx, view } = this;
    if (layer.stand && this.standImages) {
      this.drawStands(layer, this.standImages);
      return;
    }
    const img = layer.image;
    const h = layer.height || img.height;
    if (!layer.repeat) {
      ctx.drawImage(img, 0, layer.y);
      return;
    }
    const offset = this.layerOffset(layer.scroll, img.width);
    const startX = -Math.round(mod(offset, img.width));
    for (let y = layer.y; y < layer.y + h; y += img.height) {
      const rowH = Math.min(img.height, layer.y + h - y);
      for (let x = startX; x < view.width; x += img.width) {
        ctx.drawImage(img, 0, 0, img.width, rowH, x, y, img.width, rowH);
      }
    }
  }
}
