// Draws a race. Plays back the frames the simulation produced, with a
// side-on camera that follows the leaders. All art comes from the manifest.

import { DT, FRAME_STRIDE } from './sim.js';
import { circumference } from './track.js';

export const PRE_START = 2.5; // seconds of hare running before the traps open

const mod = (a, n) => ((a % n) + n) % n;

export class RaceView {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.assets = assets;
    this.view = assets.view;
    canvas.width = this.view.width;
    canvas.height = this.view.height;
    this.viewMetres = this.view.width / this.view.pixelsPerMetre;
  }

  /** meetingRace (optional) is the race on the card, used to spot competition nights. */
  setRace(race, track, meetingRace) {
    this.race = race;
    this.track = track;
    this.standImages = this.pickStands(track, meetingRace);
    this.cam = this.startCam();
    this.anim = race.runners.map((_, i) => (i * 3) % 8);
    this.lastT = -PRE_START;
    this.dispY = null;
    this.sides = null;
  }

  /** The grandstands for this track, in order. Competition races add the tournament stand. */
  pickStands(track, meetingRace) {
    const { stands = {}, cupStand } = this.assets;
    const names = [...(track?.stands || [])];
    if (meetingRace?.cup && cupStand) names.unshift(cupStand);
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
    for (const s of order) {
      const runner = race.runners[s.i];
      this.anim[s.i] = (this.anim[s.i] + (s.v / (g.metresPerCycle || 4.6)) * g.frames * simStep) % g.frames;
      const frame = s.v < 0.3 ? 0 : Math.floor(this.anim[s.i]);
      const x = this.screenX(s.d) - g.anchorX;
      const y = Math.round(s.y) - g.anchorY;
      if (x < -g.frameWidth || x > view.width) continue;
      ctx.fillStyle = 'rgba(60,36,16,0.35)';
      const shadowW = Math.round(g.frameWidth * 0.5);
      ctx.fillRect(x + g.anchorX - Math.round(shadowW / 2), y + g.anchorY - 1, shadowW, 2);
      // Sheets either have one row per coat (jacket drawn on top from a
      // separate sheet) or one row per trap with the jacket already painted on.
      const row = g.rowsBy === 'trap'
        ? runner.trap - 1
        : Math.max(0, g.rows.indexOf(runner.dog.coat));
      ctx.drawImage(g.image, frame * g.frameWidth, row * g.frameHeight, g.frameWidth, g.frameHeight, x, y, g.frameWidth, g.frameHeight);
      if (j && g.rowsBy !== 'trap') {
        const jf = frame % j.frames;
        ctx.drawImage(j.image, jf * j.frameWidth, (runner.trap - 1) * j.frameHeight, j.frameWidth, j.frameHeight, x, y, j.frameWidth, j.frameHeight);
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

    this.lastT = t;
    return states;
  }

  /** A row of grandstands side by side, bottoms lined up, repeating along the track. */
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
    const offset = this.cam * view.pixelsPerMetre * layer.scroll;
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
    const offset = this.cam * view.pixelsPerMetre * layer.scroll;
    const startX = -Math.round(mod(offset, img.width));
    for (let y = layer.y; y < layer.y + h; y += img.height) {
      const rowH = Math.min(img.height, layer.y + h - y);
      for (let x = startX; x < view.width; x += img.width) {
        ctx.drawImage(img, 0, 0, img.width, rowH, x, y, img.width, rowH);
      }
    }
  }
}
