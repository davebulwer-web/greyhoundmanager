// Small top-down map of the track with a dot for each runner.

import { planPoint, circumference, finishS, startS, RACING_WIDTH } from './track.js';

export const TRAP_COLOURS = ['#d62828', '#2854d2', '#f2f2f2', '#181818', '#f68c18', '#181818'];

export class MiniMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  }

  setRace(race, track) {
    this.race = race;
    this.track = track;
    const { width: W, height: H } = this.canvas;
    const halfW = track.straight / 2 + track.radius + RACING_WIDTH + 2;
    const halfH = track.radius + RACING_WIDTH + 2;
    this.scale = Math.min((W - 8) / (2 * halfW), (H - 8) / (2 * halfH));
    this.s0 = startS(track, race.distance);
    this.background = this.renderBackground();
  }

  toScreen(p) {
    const { width: W, height: H } = this.canvas;
    return { x: Math.round(W / 2 + p.x * this.scale), y: Math.round(H / 2 + p.y * this.scale) };
  }

  renderBackground() {
    const { width: W, height: H } = this.canvas;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#2f7a35';
    ctx.fillRect(0, 0, W, H);
    const C = circumference(this.track);
    const path = (offset) => {
      ctx.beginPath();
      for (let s = 0; s <= C; s += 2) {
        const p = this.toScreen(planPoint(this.track, s, offset));
        if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    };
    path(RACING_WIDTH / 2);
    ctx.strokeStyle = '#b98a55';
    ctx.lineWidth = RACING_WIDTH * this.scale + 5;
    ctx.stroke();
    path(-0.8);
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    ctx.stroke();
    // finish and start marks
    const mark = (s, colour) => {
      const a = this.toScreen(planPoint(this.track, s, -1));
      const b = this.toScreen(planPoint(this.track, s, RACING_WIDTH + 1.5));
      ctx.strokeStyle = colour; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    mark(finishS(this.track), '#ffffff');
    mark(this.s0, '#ffd23f');
    return off;
  }

  draw(states) {
    const { ctx } = this;
    ctx.drawImage(this.background, 0, 0);
    const order = states.map((s, i) => ({ ...s, i })).sort((a, b) => a.d - b.d);
    for (const s of order) {
      const trap = this.race.runners[s.i].trap;
      const p = this.toScreen(planPoint(this.track, this.s0 + Math.min(s.d, this.race.distance + 15), s.lane * RACING_WIDTH));
      ctx.fillStyle = '#0d0b10';
      ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
      ctx.fillStyle = TRAP_COLOURS[trap - 1];
      ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
      if (trap === 6) { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(p.x, p.y - 1, 1, 3); }
    }
  }
}
