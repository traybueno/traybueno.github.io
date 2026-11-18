/**
 * The marks that say "this can be chosen": a short corner at each corner of a legal target, drawn flat on a 2D layer over the scene. The corners follow the
 * card as it sits on the table (they are projected from its real corners) but are drawn as plain pixel-snapped lines, so they stay the same thin weight and
 * never look like geometry. They fade in over a moment while settling a few pixels inward; the one under the pointer turns white and lengthens slightly.
 */
import * as THREE from 'three';
import { CARD_W, CARD_H } from './layout.js?v=4690f3a';

const ARM = 11, ARM_FOCUS = 15, GAP = 3, GAP_FROM = 9, FADE_IN = 0.11, FADE_OUT = 0.09;
const COLOR = { idle: '#efe7c6', idleRgb: [239, 231, 198], focus: '#ffffff' };
const ease = (p) => 1 - Math.pow(1 - p, 3);
const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

export class Overlay {
  constructor(scene) {
    this.scene = scene; this.items = new Map(); this.time = 0; this.pulses = []; this.rings = []; this.beams = []; this.halo = new Map(); this.shocks = []; this.glares = []; this.px = [];
    this.canvas = Object.assign(document.createElement('canvas'), { className: 'marks' });
    scene.canvas.after(this.canvas); this.ctx = this.canvas.getContext('2d');
  }
  /** `wanted`: Map key -> { level, card: id } or { level, rect: { x, z, w, d } }. Levels: 'ready' (something you can move: pulses gently), 'idle' (a legal target), 'focus' (the target under the pointer). */
  set(wanted) {
    for (const [key, w] of wanted) {
      const it = this.items.get(key) ?? this.items.set(key, { age: 0, gone: 0, focus: 0 }).get(key);
      Object.assign(it, w, { live: true });
    }
    for (const [key, it] of this.items) if (!wanted.has(key)) it.live = false;
  }
  /** A brief white wash over a target that just accepted a drop: { card: id } or { rect }. */
  pulse(spec) { this.pulses.push({ spec, t: 0 }); }
  /** An outline of a card (or rectangle) that opens outward a little and fades: something happened here. */
  ring(spec, { dur = 0.32, grow = 0.12, alpha = 0.85 } = {}) { this.rings.push({ spec, t: 0, dur, grow, alpha }); }
  /** A thin streak travelling between two points of the table (a Fireball, or an attack through a Warp Portal). */
  beam(a, b, { dur = 0.2, color = '#ffe2b0' } = {}) { this.beams.push({ a: a.clone(), b: b.clone(), t: 0, dur, color }); }
  /** A shockwave: a circle on the table that spreads out from (x, z) to `r` and fades. */
  shock(x, z, { r = 6, dur = 0.55, color = '#ffe2b0', width = 3 } = {}) { this.shocks.push({ x, z, r, dur, color, width, t: 0 }); }
  /** A soft wash of light that blooms from (x, z) and fades: the whole view catches it. */
  glare(x, z, { alpha = 0.22, dur = 0.5, color = '255,226,160' } = {}) { this.glares.push({ x, z, alpha, dur, color, t: 0 }); }
  /**
   * The devices' pixel effects, drawn in squares the size of the art's pixels, in the device's colour (a CSS colour):
   *   swirl  a spiral of three arms turning once around (x, z), as in the Warp Portal's picture
   *   dots   the dotted glow round the Lantern Keeper's lantern, spreading across the table from (x, z) to `r`
   *   shaft  a slanting beam of light coming down onto (x, z) from the upper left, as in Heaven's Resolve's picture
   *   embers a few pixels drifting down from (x, z) and going out (a Lantern Keeper's light going out)
   */
  pixel(kind, x, z, o = {}) { this.px.push({ kind, x, z, t: 0, dur: 0.9, color: '#ffffff', r: 2, ...o, seed: Math.random() * 1000 }); }
  /** The target's four corners on screen, clockwise from the top left, or null if it is not there. */
  corners(it) {
    const sc = this.scene, cam = sc.camera, out = [];
    let pts;
    if (it.card) {
      const c = sc.cards.get(it.card); if (!c) return null;
      c.flat.updateWorldMatrix(true, false);
      const w = CARD_W / 2, h = CARD_H / 2;
      pts = [[-w, h], [w, h], [w, -h], [-w, -h]].map(([x, y]) => c.flat.localToWorld(new THREE.Vector3(x, y, 0)));
    } else {
      const { x, z, w, d } = it.rect;
      pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(x + sx * w / 2, 0.1, z + sz * d / 2));
    }
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    for (const p of pts) { p.project(cam); out.push([(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]); }
    return out;
  }
  draw(dt) {
    const cv = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.lineCap = 'butt'; g.lineJoin = 'miter'; this.time += dt;
    // The marks are drawn on a layer of their own, from the lowest card to the highest: before a card's marks go on, the card's own area is cleared from the layer,
    // so a mark that belongs to a card lying underneath is hidden by the card on top of it (as the card itself is), instead of showing through.
    const entries = [];
    for (const [key, it] of this.items) {
      it.age += dt; if (!it.live) it.gone += dt;
      it.focus += ((it.level === 'focus' ? 1 : 0) - it.focus) * (1 - Math.exp(-dt * 30));
      const tone = it.level === 'ready' ? 0.72 + 0.28 * Math.sin(this.time * 5.4) : 1;                 // about one soft beat a second (in brightness, never in transparency)
      const a = ease(Math.min(1, it.age / FADE_IN)) * (it.live ? 1 : Math.max(0, 1 - it.gone / FADE_OUT));
      if (!it.live && it.gone >= FADE_OUT) { this.items.delete(key); continue; }
      const q = this.corners(it); if (!q) continue;
      entries.push({ it, q, a, tone, order: it.card ? this.scene.cards.get(it.card)?.order ?? 0 : -1 });
    }
    if (entries.length) {
      const L = this.layer ??= document.createElement('canvas');
      if (L.width !== cv.width || L.height !== cv.height) { L.width = cv.width; L.height = cv.height; }
      const m = L.getContext('2d'); m.setTransform(dpr, 0, 0, dpr, 0, 0); m.clearRect(0, 0, W, H); m.lineCap = 'butt'; m.lineJoin = 'miter';
      const covers = [], marked = new Map(entries.map((e) => [e.it.card, e]));
      for (const c of this.scene.cards.values()) { if (marked.has(c.id)) continue; const q = this.corners({ card: c.id }); if (q) covers.push({ order: c.order, q }); }
      const all = [...covers, ...entries].sort((x, y) => x.order - y.order);
      for (const e of all) {
        if (!e.it || e.it.card) { m.globalCompositeOperation = 'destination-out'; m.globalAlpha = 1; m.fillStyle = '#000'; m.beginPath(); e.q.forEach((p, i) => (i ? m.lineTo(p[0], p[1]) : m.moveTo(p[0], p[1]))); m.closePath(); m.fill(); m.globalCompositeOperation = 'source-over'; }
        if (e.it) this.marks(m, e.it, e.q, e.a, e.tone);
      }
      if (L.width && L.height) g.drawImage(L, 0, 0, W, H);                 // (the layer is empty until the first frame has a size)
    }
    g.globalAlpha = 1;
    this.ghost(g, dt);
    this.halos(g, dt);
    this.effects(g, dt);
  }
  /**
   * The mark of one target, on layer `g`: a short corner at each corner of the card.
   */
  marks(g, it, q, a, tone = 1) {
    const gap = GAP + (GAP_FROM - GAP) * (1 - ease(Math.min(1, it.age / FADE_IN))) - it.focus, arm0 = ARM + (ARM_FOCUS - ARM) * it.focus;
    g.globalAlpha = a;
    const strokes = q.map((p, i) => {
      const nx = q[(i + 1) % 4], pv = q[(i + 3) % 4];
      const u = unit(nx[0] - p[0], nx[1] - p[1]), v = unit(pv[0] - p[0], pv[1] - p[1]), o = unit(-(u[0] + v[0]), -(u[1] + v[1]));
      const arm = Math.min(arm0, 0.3 * Math.hypot(nx[0] - p[0], nx[1] - p[1]), 0.3 * Math.hypot(pv[0] - p[0], pv[1] - p[1]));
      const sx = Math.round(p[0] + o[0] * gap) + 0.5, sy = Math.round(p[1] + o[1] * gap) + 0.5;
      return [[sx + u[0] * arm, sy + u[1] * arm], [sx, sy], [sx + v[0] * arm, sy + v[1] * arm]];
    });
    const trace = () => { for (const s of strokes) { g.beginPath(); g.moveTo(...s[0]); g.lineTo(...s[1]); g.lineTo(...s[2]); g.stroke(); } };
    // The corners are always solid, never see-through: a gentle pulse changes how bright they are, not how transparent, so corners of cards that overlap never show through each other.
    const colour = it.focus > 0.5 ? COLOR.focus : `rgb(${COLOR.idleRgb.map((c) => Math.round(c * tone)).join(',')})`;
    g.strokeStyle = '#0a0907'; g.lineWidth = 4; trace();                                // a dark edge keeps the corner readable over bright art
    g.strokeStyle = colour; g.lineWidth = 2; trace();
    g.globalAlpha = 1;
  }
  /** A thin ring around a Heart whose ready Angel would take the next attack. */
  halos(g, dt) {
    const want = this.scene.haloIds();
    for (const id of want) if (!this.halo.has(id)) this.halo.set(id, 0);
    for (const [id, a] of this.halo) {
      const next = a + ((want.has(id) ? 1 : 0) - a) * (1 - Math.exp(-dt * 9));
      if (!want.has(id) && next < 0.02) { this.halo.delete(id); continue; }
      this.halo.set(id, next);
      const q = this.corners({ card: id }); if (!q) continue;
      const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2, k = 1.1 + 0.012 * Math.sin(this.time * 2.2);
      g.globalAlpha = next * 0.5; g.strokeStyle = '#efe7c6'; g.lineWidth = 1.5; g.lineJoin = 'round';
      g.beginPath(); q.forEach((p, i) => { const x = cx + (p[0] - cx) * k, y = cy + (p[1] - cy) * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
    }
    g.globalAlpha = 1;
  }
  /** Rings and streaks: the marks of things happening, drawn over the table. */
  effects(g, dt) {
    const cam = this.scene.camera, W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const screen = (v) => { const p = v.clone().project(cam); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; };
    this.rings = this.rings.filter((r) => (r.t += dt) < r.dur);
    for (const r of this.rings) {
      const q = this.corners(r.spec); if (!q) continue;
      const u = ease(r.t / r.dur), cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2, k = 1 + r.grow * u;
      g.globalAlpha = r.alpha * (1 - u); g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineJoin = 'miter';
      g.beginPath(); q.forEach((p, i) => { const x = cx + (p[0] - cx) * k, y = cy + (p[1] - cy) * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
    }
    this.beams = this.beams.filter((b) => (b.t += dt) < b.dur * 1.5);
    g.lineCap = 'round';
    for (const b of this.beams) {
      const head = ease(Math.min(1, b.t / b.dur)), tail = ease(Math.max(0, (b.t - b.dur * 0.25) / b.dur)), fade = 1 - Math.max(0, (b.t - b.dur) / (b.dur * 0.5));
      const at = (s) => b.a.clone().lerp(b.b, s), p0 = screen(at(Math.min(tail, head))), p1 = screen(at(head));
      const grad = g.createLinearGradient(p0[0], p0[1], p1[0], p1[1]); grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, b.color);
      g.globalAlpha = 0.5 * fade; g.strokeStyle = '#000'; g.lineWidth = 5; g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke();
      g.globalAlpha = fade; g.strokeStyle = grad; g.lineWidth = 2.5; g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
    this.flare(g, dt, screen);
    this.pixels(g, dt, screen);
  }
  pixels(g, dt, screen) {
    const P = 4, sq = (x, y, s = P) => g.fillRect(Math.round(x / P) * P - s / 2, Math.round(y / P) * P - s / 2, s, s), at = (x, z, y = 0.15) => screen(new THREE.Vector3(x, y, z));
    this.px = this.px.filter((b) => (b.t += dt) < b.dur);
    for (const b of this.px) {
      const u = b.t / b.dur; g.fillStyle = b.color;
      if (b.kind === 'swirl') {                                 // three arms grow out and turn, then thin out from the tips in
        const grow = ease(Math.min(1, u / 0.45)), fade = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
        for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 26; i++) {
          const s = i / 25; if (s > grow) break;
          if (s > fade + 0.05 && (i % 2)) continue;
          const a = arm * 2.094 + s * 5.2 + u * 3.6, r = b.r * s * (0.35 + 0.65 * grow), [px, py] = at(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r);
          g.globalAlpha = Math.max(0, fade) * (0.55 + 0.45 * (1 - s)); sq(px, py, s < 0.5 ? P * 2 : P);
        }
      } else if (b.kind === 'dots') {                           // a halftone front spreads out: big dots at the front, smaller behind, the checkerboard thinning them at the edge
        const front = b.r * ease(u), step = 0.42, n = Math.ceil(b.r / step);
        for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
          const wx = i * step, wz = j * step, d = Math.hypot(wx, wz); if (d > front + 0.2 || d > b.r) continue;
          const k = Math.max(0, 1 - Math.abs(d - front) / 1.8) * (1 - 0.6 * d / b.r) * (1 - u * u);
          if (k < 0.08 || (k < 0.45 && (i + j) & 1)) continue;
          const [px, py] = at(b.x + wx, b.z + wz); g.globalAlpha = Math.min(1, 0.4 + k); sq(px, py, Math.max(2, Math.round(k * 3) * 2));
        }
      } else if (b.kind === 'shaft') {                          // a slanting beam: it reaches down, holds, and fades, solid in the middle and dithered at the sides
        const [bx, by] = at(b.x, b.z, 0.2), [tx, ty] = at(b.x - b.r * 1.2, b.z - b.r * 2.2, b.r * 3.2), reach = ease(Math.min(1, u / 0.3)), fade = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
        const len = Math.hypot(bx - tx, by - ty), rows = Math.floor(len / P), half = (s) => (4 + 18 * s) * (b.wide ?? 1);
        for (let i = 0; i <= rows * reach; i++) {
          const s = i / rows, cx = tx + (bx - tx) * s, cy = ty + (by - ty) * s, w = half(s);
          for (let x = -w; x <= w; x += P) {
            const edge = Math.abs(x) / w, row = Math.round(cy / P), col = Math.round((cx + x) / P);
            if (edge > 0.6 && (row + col) & 1) continue;
            if (edge > 0.85 && (row & 1)) continue;
            g.globalAlpha = fade * (edge > 0.6 ? 0.35 : 0.5) * (0.5 + 0.5 * s); sq(cx + x, cy);
          }
        }
        for (let i = 0; i < 7; i++) {                           // motes rising at the foot of the beam
          const h = ((u * 1.6 + i / 7 + (b.seed % 1)) % 1), [px, py] = at(b.x + Math.sin(i * 2.3 + b.seed) * 0.7, b.z + Math.cos(i * 1.7) * 0.4, 0.2 + h * 1.6);
          g.globalAlpha = fade * (1 - h); sq(px, py);
        }
      } else if (b.kind === 'embers') {
        for (let i = 0; i < 9; i++) {
          const ph = Math.min(1, u * 1.3 - i * 0.03); if (ph <= 0) continue;
          const [px, py] = at(b.x + Math.sin(b.seed + i * 1.9) * 0.9, b.z + Math.cos(b.seed + i * 2.7) * 1.3, 0.6 - ph * 0.5);
          if ((i + Math.floor(u * 14)) % 3 === 0) continue;     // they flicker as they go
          g.globalAlpha = 1 - ph; sq(px, py + ph * 26);
        }
      }
    }
    g.globalAlpha = 1;
  }
  /** Shockwaves and glare: the louder marks of a big moment (a Chain let go). */
  flare(g, dt, screen) {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.glares = this.glares.filter((b) => (b.t += dt) < b.dur);
    for (const b of this.glares) {
      const u = b.t / b.dur, [px, py] = screen(new THREE.Vector3(b.x, 0.5, b.z)), R = Math.max(W, H) * (0.3 + 0.35 * ease(u));
      const grad = g.createRadialGradient(px, py, 0, px, py, R); grad.addColorStop(0, `rgba(${b.color},${b.alpha * (1 - u) * (1 - u)})`); grad.addColorStop(1, `rgba(${b.color},0)`);
      g.globalAlpha = 1; g.fillStyle = grad; g.fillRect(0, 0, W, H);
    }
    this.shocks = this.shocks.filter((b) => (b.t += dt) < b.dur);
    g.lineJoin = 'round';
    for (const b of this.shocks) {
      const u = ease(b.t / b.dur);
      for (const [k, a, w] of [[1, 0.85, b.width], [0.62, 0.5, b.width * 0.6]]) {       // an outer ring and a fainter one just behind it
        const r = b.r * u * k; if (r < 0.05) continue;
        g.globalAlpha = a * (1 - u) * (1 - u * 0.5); g.strokeStyle = b.color; g.lineWidth = Math.max(0.6, w * (1 - u * 0.7));
        g.beginPath(); for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2, [x, y] = screen(new THREE.Vector3(b.x + Math.cos(t) * r, 0.1, b.z + Math.sin(t) * r)); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
      }
    }
    g.globalAlpha = 1; g.lineCap = 'butt'; g.lineJoin = 'miter';
  }
  /** While a card is carried, a faint dashed outline where it came from; and the wash on a target that just took a drop. */
  ghost(g, dt) {
    const sc = this.scene, cam = sc.camera, W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const screen = (v) => { v.project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
    if (sc.drag) {
      const c = sc.cards.get(sc.drag.id), q = c && this.corners({ card: c.id });
      if (q) {
        const b = c.base, from = screen(new THREE.Vector3(b.x, b.y, b.z)), at = screen(c.root.position.clone()), dx = from[0] - at[0], dy = from[1] - at[1];
        g.save(); g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(239,231,198,.4)'; g.beginPath();
        q.forEach((p, i) => { const x = Math.round(p[0] + dx) + 0.5, y = Math.round(p[1] + dy) + 0.5; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke(); g.restore();
      }
    }
    this.pulses = this.pulses.filter((p) => (p.t += dt) < 0.3);
    for (const p of this.pulses) {
      const q = this.corners(p.spec); if (!q) continue;
      g.fillStyle = `rgba(255,255,255,${0.26 * (1 - p.t / 0.3)})`; g.beginPath(); q.forEach((pt, i) => (i ? g.lineTo(pt[0], pt[1]) : g.moveTo(pt[0], pt[1]))); g.closePath(); g.fill();
    }
  }
}
