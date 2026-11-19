/**
 * The marks that say "this can be chosen": a short corner at each corner of a legal target, drawn flat on a 2D layer over the scene. The corners follow the
 * card as it sits on the table (they are projected from its real corners) but are drawn as plain pixel-snapped lines, so they stay the same thin weight and
 * never look like geometry. They fade in over a moment while settling a few pixels inward; the one under the pointer turns white and lengthens slightly.
 */
import * as THREE from 'three';
import { CARD_W, CARD_H } from './layout.js?v=54cfdab';

const ARM = 11, ARM_FOCUS = 15, GAP = 3, GAP_FROM = 9, FADE_IN = 0.11, FADE_OUT = 0.09;
const COLOR = { idle: '#efe7c6', idleRgb: [239, 231, 198], focus: '#ffffff' };
const ease = (p) => 1 - Math.pow(1 - p, 3);
const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
/** The Warp Portal's idle beat: the swirl turns once every 4 seconds, and each enemy Guardian (the `i`th) thins for a moment just after an arm passes the top, one after another. */
export const portalPulse = (t, i = 0) => { const u = (((t - 0.5 - i * 0.25) % 4) + 4) % 4; return u < 0.9 ? Math.sin(Math.PI * u / 0.9) : 0; };
/** A Lantern Keeper's flame: an uneven flicker (never a smooth pulse), 0 to 1, that the Keeper and every creature it lights share. */
export const flame = (t) => Math.min(1, Math.max(0, 0.62 + 0.2 * Math.sin(t * 6.1) + 0.12 * Math.sin(t * 13.7 + 1.3) + 0.08 * Math.sin(t * 23.3 + 4.1) - (Math.sin(t * 1.7) > 0.93 ? 0.35 : 0)));
const frac = (x) => ((x % 1) + 1) % 1;
const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h >>> 0) / 4294967296; };
/** A point inside the frame `q`: `a` of the way along it, `b` of the way down it (in the card's own terms). */
const inside = (q, a, b) => { const top = [q[0][0] + (q[1][0] - q[0][0]) * a, q[0][1] + (q[1][1] - q[0][1]) * a], low = [q[3][0] + (q[2][0] - q[3][0]) * a, q[3][1] + (q[2][1] - q[3][1]) * a]; return [top[0] + (low[0] - top[0]) * b, top[1] + (low[1] - top[1]) * b]; };
/** Where a level line at screen height `y` crosses the frame `q`: [left, right], or null if it misses. */
function across(q, y) {
  const xs = [];
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])); }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}
/** A point `out` pixels outside the frame `q` (four screen corners), `s` of the way round it clockwise from the top left. */
function around(q, s, out = 0) {
  const L = q.map((p, i) => Math.hypot(q[(i + 1) % 4][0] - p[0], q[(i + 1) % 4][1] - p[1])), tot = L[0] + L[1] + L[2] + L[3];
  let d = frac(s) * tot, i = 0; while (i < 3 && d > L[i]) { d -= L[i]; i++; }
  const a = q[i], b = q[(i + 1) % 4], f = L[i] ? d / L[i] : 0, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
  const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2; let [nx, ny] = unit(b[1] - a[1], a[0] - b[0]);
  if (nx * (x - cx) + ny * (y - cy) < 0) { nx = -nx; ny = -ny; }
  return [x + nx * out, y + ny * out, tot];
}

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
   *   pring  a shockwave as a ring of square pixels spreading out from (x, z) to `r`, dithered as it thins (a Chain let go, a blow)
   *   bolt   a jagged charge of pixels running from (x, z) to (x2, z2) at height `y` (one Chain slot to the next)
   *   comet  a ball of pixels flying from (x, y, z) to (x2, y2, z2) with a trail of embers falling behind it (a Fireball)
   *   burst  `n` pixels thrown out from (x, y, z) that slow, fall and go out (`speed`, `grav`, `sway`: px); `color2` alternates (impact, shattering, feathers)
   *   wave   a band of dithered pixels sweeping across the table from x0 to x1 over z0..z1 (Behind You)
   *   crack  jagged lines of pixels splitting out from (x, z) (a Heart that takes its first blow)
   *   hearts a few little pixel hearts floating up from (x, y, z) and going out (a Witch's Kiss)
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
    for (const it of this.idleMarks()) { const q = this.corners(it); if (q) entries.unshift({ it, q, a: 1, order: this.scene.cards.get(it.card)?.order ?? 0 }); }   // before the marks, so a mark draws over an idle effect on the same card
    if (entries.length) {
      const L = this.layer ??= document.createElement('canvas');
      if (L.width !== cv.width || L.height !== cv.height) { L.width = cv.width; L.height = cv.height; }
      const m = L.getContext('2d'); m.setTransform(dpr, 0, 0, dpr, 0, 0); m.clearRect(0, 0, W, H); m.lineCap = 'butt'; m.lineJoin = 'miter';
      const covers = [], marked = new Map(entries.map((e) => [e.it.card, e]));
      for (const c of this.scene.cards.values()) { if (marked.has(c.id)) continue; const q = this.corners({ card: c.id }); if (q) covers.push({ order: c.order, q }); }
      const all = [...covers, ...entries].sort((x, y) => x.order - y.order);
      const cleared = new Set();
      for (const e of all) {
        if (!e.it || (e.it.card && !cleared.has(e.it.card))) { if (e.it) cleared.add(e.it.card); m.globalCompositeOperation = 'destination-out'; m.globalAlpha = 1; m.fillStyle = '#000'; m.beginPath(); e.q.forEach((p, i) => (i ? m.lineTo(p[0], p[1]) : m.moveTo(p[0], p[1]))); m.closePath(); m.fill(); m.globalCompositeOperation = 'source-over'; }
        if (e.it) e.it.idle ? this.idle(m, e.it, e.q) : this.marks(m, e.it, e.q, e.a, e.tone);
      }
      if (L.width && L.height) g.drawImage(L, 0, 0, W, H);                 // (the layer is empty until the first frame has a size)
    }
    g.globalAlpha = 1;
    this.ghost(g, dt);
    this.halos(g, dt);
    this.effects(g, dt);
  }
  /** The idle effects to draw this frame, one per card: { idle: kind, card, w, color, i, dev }. */
  idleMarks() {
    const sc = this.scene, out = [];
    for (const [dev, d] of sc.idle ?? []) {
      const up = sc.lifted?.has(dev) ? 1.6 : 1, on = (kind, card, i = 0) => { const w = Math.min(1, d.w * sc.idleOf(dev, card) * (card === dev || card === sc.hover?.id ? up : 1)); if (w > 0.01) out.push({ idle: kind, card, w, color: d.color, i, dev }); };
      if (d.key === 'angel') { on('heart', d.ids[0]); continue; }
      on(d.key, dev);
      d.ids.forEach((id, i) => on({ portal: 'thin', lantern: 'lit', resolve: 'mote' }[d.key], id, i));
    }
    return out;
  }
  /**
   * One card's idle effect, in square pixels of its device's colour (it.w scales it in and out). Clock: the scene's `idleT`, so effects tied together keep time.
   *   portal  three short arms of dithered pixels circling the frame, once every 4 seconds
   *   thin    a Guardian the Portal passes sheds a few purple pixels as it thins (the thinning itself is the card's own, scene.js)
   *   lantern a ring of halftone dots round the Keeper, flickering like a flame
   *   lit     a thin pixel edge round a creature the Keeper lights, flickering with the Keeper's flame
   *   resolve gold pixels drifting up off the card, and every few seconds a band of light sweeping up the frame
   *   mote    now and then a single gold pixel rising off one of the Resolve's attackers (each on its own time)
   *   heart   the Heart an Angel would save: a breathing dotted outline in the Angel's colour
   */
  idle(g, it, q) {
    const P = 4, t = this.scene.idleT, w = it.w, sq = (x, y, s = P) => g.fillRect(Math.round(x / P) * P - s / 2, Math.round(y / P) * P - s / 2, s, s);
    const [, , tot] = around(q, 0), n = Math.max(8, Math.round(tot / P));
    g.fillStyle = it.color;
    if (it.idle === 'portal') {
      for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 14; i++) {
        if (i > 6 && (i & 1)) continue;
        const [x, y] = around(q, t / 4 + arm / 3 - i * 0.007, 5 + i * 0.25);
        g.globalAlpha = w * 0.85 * (1 - i / 14); sq(x, y, i < 3 ? P * 1.5 : P);
      }
    } else if (it.idle === 'thin') {
      const u = (((t - 0.5 - it.i * 0.25) % 4) + 4) % 4; if (u > 1.4) { g.globalAlpha = 1; return; }
      const cyc = Math.floor((t - 0.5 - it.i * 0.25) / 4), h = u / 1.4;
      for (let i = 0; i < 7; i++) {
        const [x, y] = around(q, hash(it.card + i) + cyc * 0.37 + i * 0.13, 2 + h * 16);
        if ((i + Math.floor(u * 12)) % 3 === 0) continue;
        g.globalAlpha = w * 0.8 * (1 - h); sq(x, y - h * 6);
      }
    } else if (it.idle === 'lantern') {
      const f = flame(t);
      for (let i = 0; i < n; i += 2) {                          // big dots next to the frame, a fainter row of small ones outside them: halftone, as round the lantern in the art
        const big = ((i / 2) & 1) === 0, [x, y] = around(q, i / n, 6), [x2, y2] = around(q, (i + 1) / n, 12);
        g.globalAlpha = w * (0.4 + 0.6 * f) * (big ? 1 : 0.7); sq(x, y, big && f > 0.45 ? P : 2);
        if (big && f > 0.35) { g.globalAlpha = w * 0.45 * f; sq(x2, y2, 2); }
      }
    } else if (it.idle === 'lit') {
      const f = flame(t);
      const m = n * 2;                                          // a crisp line of small squares hugging the frame; at a low flicker every other one drops out
      for (let i = 0; i < m; i++) {
        if ((i & 1) && f < 0.5) continue;
        const [x, y] = around(q, i / m, 3);
        g.globalAlpha = w * (0.4 + 0.55 * f); g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        if (i % 12 === 0 && f > 0.6) { const [x2, y2] = around(q, i / m, 6); g.globalAlpha = w * 0.6 * f; sq(x2, y2, 2); }
      }
    } else if (it.idle === 'resolve') {                         // up is up on screen, whichever way the card lies (a device lies sideways)
      const ys = q.map((p) => p[1]), top = Math.min(...ys), bot = Math.max(...ys), tall = bot - top;
      for (let i = 0; i < 6; i++) {
        const h = frac(t / 3.2 + i / 6), k = Math.floor(t / 3.2 + i / 6), [x0, y0] = inside(q, 0.15 + 0.7 * frac(i * 0.618 + k * 0.29), 0.2 + 0.6 * frac(i * 0.41 + k * 0.53));
        g.globalAlpha = w * 0.8 * (1 - h) * Math.min(1, h * 6); sq(x0, y0 - h * tall * 0.6);
      }
      const u = frac(t / 5) * 5; if (u < 1.1) {                 // the band: from the bottom of the card to the top, over a second
        const y = bot - (u / 1.1) * tall, fade = Math.sin(Math.PI * u / 1.1);
        for (let r = 0; r < 2; r++) {
          const span = across(q, y + r * P); if (!span) continue;
          for (let x = span[0] + P / 2; x <= span[1] - P / 2; x += P) { if (r && (Math.round(x / P) & 1)) continue; g.globalAlpha = w * fade * (r ? 0.25 : 0.5); sq(x, y + r * P); }
        }
      }
    } else if (it.idle === 'mote') {
      const per = 3.4, ph = t / per + hash(it.card), u = frac(ph) * per; if (u < 1.3) {
        const h = u / 1.3, k = Math.floor(ph), ys = q.map((p) => p[1]), tall = Math.max(...ys) - Math.min(...ys), [x, y] = inside(q, 0.2 + 0.6 * hash(it.card + k), 0.25 + 0.3 * hash(k + it.card + 'y'));
        g.globalAlpha = w * 0.85 * (1 - h) * Math.min(1, h * 5); sq(x, y - h * tall * 0.55);
      }
    } else if (it.idle === 'heart') {
      const b = 0.5 + 0.5 * Math.sin(t * 1.6);
      for (let i = 0; i < n; i++) { if (i & 1) continue; const [x, y] = around(q, i / n, 5 + b); g.globalAlpha = w * (0.35 + 0.3 * b); sq(x, y, 2); }
    }
    g.globalAlpha = 1;
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
      } else if (b.kind === 'pring') {
        const R = b.r * ease(u), N = Math.max(24, Math.round(b.r * 14));
        for (const [k, a0, sz] of [[1, 1, P], [0.68, 0.45, 2]]) {
          if (R * k < 0.1) continue;
          for (let i = 0; i < N; i++) {
            if (u > 0.45 && (i + Math.floor(u * 10)) % 3 === 0) continue;
            const th = i / N * Math.PI * 2, [px, py] = at(b.x + Math.cos(th) * R * k, b.z + Math.sin(th) * R * k, 0.12);
            g.globalAlpha = a0 * (1 - u) * (b.alpha ?? 1); sq(px, py, sz);
          }
        }
      } else if (b.kind === 'bolt') {
        const head = Math.min(1, u / 0.6), tail = Math.max(0, (u - 0.3) / 0.7), [ax, ay] = at(b.x, b.z, b.y ?? 1), [bx, by] = at(b.x2, b.z2, b.y ?? 1);
        const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / P)), [nx, ny] = unit(ay - by, bx - ax);
        for (let i = Math.floor(tail * n); i <= head * n; i++) {
          const s = i / n, j = Math.round(Math.sin(s * 23 + b.seed) * 1.6 + Math.sin(s * 57 + b.seed * 2) * 0.9) * P * Math.sin(Math.PI * s);
          g.globalAlpha = (0.45 + 0.55 * (s - tail) / Math.max(0.01, head - tail)) * (1 - tail); sq(ax + (bx - ax) * s + nx * j, ay + (by - ay) * s + ny * j, i === Math.floor(head * n) ? P * 2 : P);
        }
      } else if (b.kind === 'comet') {
        const lerp = (s) => at(b.x + (b.x2 - b.x) * s, b.z + (b.z2 - b.z) * s, b.y + (b.y2 - b.y) * s), h = Math.min(1, u / 0.8), fade = u < 0.8 ? 1 : 1 - (u - 0.8) / 0.2;
        for (let i = 0; i < 22; i++) {                          // embers shed along the way, drifting down and going out
          const s = (i + 0.5) / 22; if (s > h) break;
          const age = (h - s) * 2, [px, py] = lerp(s), r1 = Math.sin(b.seed + i * 7.1);
          if (age > 1) continue; g.globalAlpha = (1 - age) * 0.8; g.fillStyle = i & 1 ? b.color : (b.color2 ?? b.color); sq(px + r1 * 6, py + age * 18 + Math.cos(i * 3.3) * 4, age < 0.4 ? P : 2);
        }
        if (h < 1) {
          const [hx, hy] = lerp(h), [tx, ty] = lerp(Math.max(0, h - 0.08)), [dx, dy] = unit(hx - tx, hy - ty);
          for (let k = 1; k < 9; k++) { g.globalAlpha = 0.9 * (1 - k / 9); g.fillStyle = k & 1 ? b.color : (b.color2 ?? b.color); sq(hx - dx * k * P * 1.6 + Math.sin(k * 2.7 + b.seed) * 3, hy - dy * k * P * 1.6, k < 3 ? P * 3 : k < 6 ? P * 2 : P); }
          g.globalAlpha = fade; g.fillStyle = b.color; sq(hx, hy, P * 5); g.fillStyle = b.color2 ?? b.color; sq(hx, hy, P * 3); g.fillStyle = b.core ?? '#fff6d0'; sq(hx, hy, P * 1.5);
        }
        g.fillStyle = b.color;
      } else if (b.kind === 'burst') {
        const [cx, cy] = at(b.x, b.z, b.y ?? 0.5), n = b.n ?? 18;
        for (let i = 0; i < n; i++) {
          const r1 = frac(Math.sin(b.seed + i * 12.9898) * 43758.5453), r2 = frac(Math.sin(b.seed * 1.7 + i * 78.233) * 12345.678), th = r1 * Math.PI * 2, sp = (b.speed ?? 70) * (0.4 + 0.6 * r2);
          const life = Math.min(1, u * (1 + r2 * 0.6)); if (life >= 1) continue;
          const go = 1 - Math.pow(1 - life, 2), x = cx + Math.cos(th) * sp * go + Math.sin(life * 6 + i) * (b.sway ?? 0), y = cy + Math.sin(th) * sp * go * 0.7 + (b.grav ?? 40) * life * life - (b.rise ?? 0) * go;
          if (life > 0.5 && (i + Math.floor(u * 16)) % 4 === 0) continue;   // they flicker as they go out
          g.globalAlpha = 1 - life; g.fillStyle = b.color2 && i & 1 ? b.color2 : b.color; sq(x, y, i < (b.big ?? 4) && life < 0.5 ? P * 2 : P);
        }
        g.fillStyle = b.color;
      } else if (b.kind === 'wave') {
        const bx = b.x0 + (b.x1 - b.x0) * u, w = b.w ?? 1.8, step = 0.42;
        for (let wx = Math.ceil((bx - w) / step) * step; wx <= bx + w * 0.4; wx += step) for (let wz = b.z0; wz <= b.z1; wz += step) {
          const d = wx - bx, k = d > 0 ? 1 - d / (w * 0.4) : 1 + d / w, row = Math.round(wz / step), col = Math.round(wx / step);
          if (k <= 0 || (k < 0.55 && (row + col) & 1) || (k < 0.25 && row & 1)) continue;
          const [px, py] = at(wx, wz, 0.2); g.globalAlpha = Math.min(1, k * 1.2) * (u > 0.85 ? (1 - u) / 0.15 : 1) * 0.75; sq(px, py, k > 0.7 ? P * 2 : P);
        }
      } else if (b.kind === 'crack') {
        const grow = ease(Math.min(1, u / 0.25)), fade = u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5, [cx, cy] = at(b.x, b.z, 0.2);
        for (let ray = 0; ray < (b.n ?? 6); ray++) {
          let x = cx, y = cy, th = (ray / (b.n ?? 6)) * Math.PI * 2 + Math.sin(b.seed + ray) * 0.5; const steps = 9;
          for (let i = 0; i < steps * grow; i++) {
            th += Math.sin(b.seed * 3 + ray * 7 + i * 2.1) * 0.6; x += Math.cos(th) * P * 1.6; y += Math.sin(th) * P * 1.6;
            g.globalAlpha = fade * (1 - i / steps * 0.6); sq(x, y, i < 3 ? P * 1.5 : P);
          }
        }
        g.globalAlpha = fade * (1 - u); sq(cx, cy, P * 4);
      } else if (b.kind === 'hearts') {
        const [cx, cy] = at(b.x, b.z, b.y ?? 1), shape = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];
        for (let i = 0; i < 5; i++) {
          const life = (u - i * 0.1) / 0.75; if (life <= 0 || life >= 1) continue;
          const s = 4, ox = cx + Math.sin(b.seed + i * 2.4) * 50 + Math.sin(life * 5 + i) * 6, oy = cy - (b.lift ?? 90) - life * 80;
          g.globalAlpha = (1 - life) * Math.min(1, life * 6);
          shape.forEach((row, r) => [...row].forEach((ch, k) => { if (ch === 'X') g.fillRect(Math.round(ox + (k - 2) * s), Math.round(oy + (r - 2) * s), s, s); }));
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
