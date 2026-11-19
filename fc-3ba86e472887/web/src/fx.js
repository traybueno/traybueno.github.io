/**
 * The motion of a move, played from the engine's events. The game state is already final when this runs: the scene has every card in its new place, and
 * the springs would carry each card there by themselves. The events only add the choreography on top: which cards wait where for a moment, the
 * arc a card takes, a card turning over, the impact of an attack, the mark where something landed. Nothing here decides anything about the rules, and
 * nothing waits for it: the next move (yours, or the bot's) first finishes whatever is still playing (`flush`), then plays its own.
 *
 * A move is planned in "normal seconds" and run at the speed chosen (`k`: 1 normal, 0.55 fast). Poses are placements as layout.js makes them
 * ({ x, y, z, yaw, spin, scale, face, dim }); a card that is `held` at a pose goes there, and is handed back to its place when the hold is released.
 */
import * as THREE from 'three';
import { CARDS } from '../../src/index.js?v=b3f8a59';
import { SPRING } from './card.js?v=b3f8a59';
import { handSpot, deckSpot } from './layout.js?v=b3f8a59';

const mix = (a, b, u) => { const o = { ...b }; for (const k of ['x', 'y', 'z', 'spin', 'scale', 'face']) o[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * u; return o; };
const moved = (a, b) => ['x', 'y', 'z', 'spin', 'face'].some((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 0.05) || !!a.dim !== !!b.dim;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const THEIRS = 1.6;          // how much slower the opponent's moves play than your own
const READ = 0.35;           // a spell that is not yours, or that moves another card, waits this long once it is held up, so its name can be read first
const HOLD = 0.85;           // how long the card a Kiss or a Shift takes is held up beside the spell before it goes
const LAND = 0.38;           // how long after a card sets off from the hand it has come down in its place
/** A rough stand-in for a device's colour where the art is not loaded (the tests); on the table the colour is read from the card's own frame. */
const TINT = { portal: '#c99be8', lantern: '#c8f08c', resolve: '#ffe066', fireball: '#ff8a3c', behind: '#9b86e0', shift: '#7fd3e6', kiss: '#f08fc0', shadow: '#9a7fd0', heart: '#e86a7a', angel: '#f2efe6' };   // used only where the card art has no frame colour (tests)
const GOLD = '#ffd27a', KISS = '#ff7eb6';
/** A CSS hex colour taken `k` of the way to black. */
const darken = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('');
const SHOW = (side) => ({ x: 0, y: side > 0 ? 1.8 : 2.6, z: side > 0 ? 5.2 : -2.2, yaw: 0, spin: 0, scale: 1.2, face: 1, dim: false });     // where a spell is held up while it takes effect (yours a little nearer you, clear of the banner on the middle line)

export class Fx {
  constructor(scene) { this.sc = scene; this.now = 0; this.jobs = []; this.held = new Set(); this.touched = new Set(); this.k = 1; this.end = 0; this.ids = new Set(); }
  /** 1 normal, 0.55 fast, 0 off. */
  set speed(k) { this.k = k; }
  get busy() { return this.end > this.now; }
  get remaining() { return Math.max(0, this.end - this.now); }

  // ---- the clock -----------------------------------------------------------------------------------------------------------------------------
  /** Run `fn` at `t` seconds from now. */
  at(t, fn) { const when = this.now + t * this.k; this.jobs.push({ when, fn }); this.end = Math.max(this.end, when); }
  /** Call `fn(u)` with u from 0 to 1 over `dur` seconds starting at `t`. */
  tween(t, dur, fn) { const when = this.now + t * this.k, d = Math.max(1e-3, dur * this.k); this.jobs.push({ when, dur: d, fn }); this.end = Math.max(this.end, when + d); }
  update(dt) {
    this.now += dt;
    if (!this.jobs.length) return;
    this.jobs.sort((a, b) => a.when - b.when);
    for (const j of [...this.jobs]) {
      if (this.now < j.when) break;
      if (j.dur) { const u = Math.min(1, (this.now - j.when) / j.dur); j.fn(u); if (u >= 1) this.jobs.splice(this.jobs.indexOf(j), 1); }
      else { this.jobs.splice(this.jobs.indexOf(j), 1); j.fn(); }
    }
  }
  /** Finish everything at once: no card is held, none is half turned over, and the camera is back. */
  flush() {
    for (const c of this.held) this.free(c);
    for (const c of this.touched) c.calm(); this.touched.clear();
    this.held.clear(); this.jobs = []; this.end = this.now; this.ids = new Set(); this.sc.haloHold.clear(); this.sc.lean(0, 0, 0);
  }
  free(c) { c.held = null; c.flat.scale.x = 1; if (c.faceOverride !== undefined) { c.faceOverride = undefined; c.show(c.base?.key ?? null); } }

  // ---- building blocks -----------------------------------------------------------------------------------------------------------------------
  /** Keep `id` at each pose in turn: [[time, pose | 'live' | null, spring?], ...]. 'live' is wherever it is then; null hands it back to its place. */
  path(id, keys) {
    for (const [t, pose, spring] of keys) this.at(t, () => {
      const c = this.sc.cards.get(id); if (!c) return;
      if (pose) { c.held = { pose: pose === 'live' ? c.livePose() : pose, spring: spring ?? SPRING.settle }; this.held.add(c); } else { this.free(c); this.held.delete(c); }
    });
  }
  /** A card travels from `from` to its place `to`, rising on the way: it waits at `from` until `t`, passes over the top, and settles. */
  fly(id, from, to, t, { lift = 1.4, half = 0.17, via = null, linger = 0 } = {}) {
    const apex = { ...mix(from, to, 0.5), y: Math.max(from.y, to.y) + lift, face: Math.max(from.face ?? 0, to.face ?? 0) > 0.5 ? 1 : 0.5 * ((from.face ?? 0) + (to.face ?? 0)), scale: Math.max(from.scale, to.scale) * 1.06 };
    this.path(id, [[0, 'live'], ...(via ? [[t, via]] : []), [t + linger, apex], [t + linger + half, null]]);     // `via`: held up at that pose for `linger` seconds first
  }
  /** A card turns over about its vertical axis, showing `from` (a key, or null for the back) and then `to`. */
  flip(id, t, dur, from, to) {
    this.at(0, () => { const c = this.sc.cards.get(id); if (c) { c.faceOverride = from; c.show(from); } });       // until it turns, it shows what it turns from
    this.tween(t, dur, (u) => {
      const c = this.sc.cards.get(id); if (!c) return;
      c.faceOverride = u < 0.5 ? from : u < 1 ? to : undefined;
      c.show(c.faceOverride === undefined ? c.base?.key ?? null : c.faceOverride);
      c.flat.scale.x = u >= 1 ? 1 : Math.max(0.04, Math.abs(Math.cos(Math.PI * u)));
    });
  }
  /**
   * A Chain is let go: a soft flare and a ring of gold pixels across it, then a jagged charge of pixels runs down it from the first spell to the last, each
   * leg in the colour of the spell it reaches (gold for a card still face down to you). Each spell leaps up, fills in from its edges and throws out a pixel
   * ring as the charge reaches it; the last one bursts and lands with a thud the whole table feels. Returns when it is over.
   */
  unleash(ids, live, t, keyOf = () => null) {
    const sc = this.sc, ov = sc.overlay, spots = ids.map((id) => live(id)), mid = { x: spots.reduce((s, p) => s + p.x, 0) / spots.length, z: spots.reduce((s, p) => s + p.z, 0) / spots.length };
    const toward = Math.sign(mid.x) || 1, col = (id) => { const k = keyOf(id); return k ? this.tint(k) : GOLD; };
    this.at(t, () => { ov.glare(mid.x, mid.z, { alpha: 0.14, dur: 0.5 }); ov.pixel?.('pring', mid.x, mid.z, { r: 8, dur: 0.55, color: GOLD }); sc.nudge(-toward * 0.1, 0.12); });
    ids.forEach((id, i) => {
      const ti = t + 0.1 + i * 0.12, p = spots[i], last = i === ids.length - 1, color = col(id);
      this.path(id, [[0, 'live'], [ti - 0.05, { ...p, y: p.y + 1.5, scale: p.scale * 1.16, face: 0 }, SPRING.follow], [ti + 0.24, null]]);      // it leaps up as the charge reaches it, then settles back
      if (i) { const q = spots[i - 1]; this.at(ti - 0.1, () => ov.pixel?.('bolt', q.x, q.z, { x2: p.x, z2: p.z, y: 1.4, dur: 0.22, color })); }
      this.glow(id, ti); this.sound(last ? 'clash' : 'tick', ti, p, { step: i * 3 });
      this.touch(id, ti, 0.45, (c, u) => c.setVeil({ color, shape: 2, amount: 0.7 * Math.sin(Math.PI * u), alpha: 0.85 }));
      this.at(ti, () => {
        ov.pixel?.('pring', p.x, p.z, { r: last ? 6.5 : 3.8, dur: last ? 0.6 : 0.45, color });
        if (last) ov.pixel?.('burst', p.x, p.z, { y: 1.4, n: 26, speed: 110, grav: 60, color, color2: GOLD, dur: 0.8 });
        sc.nudge(-toward * (last ? 0.18 : 0.06), last ? 0.4 : 0.14);
      });
    });
    return t + 0.1 + (ids.length - 1) * 0.12 + 0.3;
  }
  ring(spec, t, o) { this.at(t, () => this.sc.overlay.ring(spec, o)); }
  /** From `t`, card `id` plays the 'place' sound at the moment it comes to rest on the table (card.js watches for it), not at a set time. */
  landing(id, t, { gain = 1 } = {}) {
    this.at(t, () => {
      const c = this.sc.cards.get(id); if (!c) return;
      c.landing = { until: performance.now() + 1200, fn: () => this.sc.sound?.play('place', { pan: c.s.x.x / 20, gain: gain * (c.s.z.x < -1 ? 0.8 : 1) }) };
    });
  }
  /** A card sound (sound.js) at `t`, placed left or right by where `pose` is on the table; the far side is a little quieter. */
  sound(name, t, pose, { gain = 1, step = 0 } = {}) {
    this.at(t, () => this.sc.sound?.play(name, { pan: (pose?.x ?? 0) / 20, gain: gain * ((pose?.z ?? 0) < -1 ? 0.8 : 1), step }));
  }
  glow(id, t) { this.at(t, () => this.sc.flash(id)); }

  // ---- the devices' moments: a Warp Portal, a Lantern Keeper and a Heaven's Resolve each touch several cards, in the colour of their own frames -----
  /** The colour of a card's frame, from its art. */
  tint(key) { const e = this.sc.cards.values().next().value?.art?.edge?.[key]; return e ? `#${e.getHexString()}` : TINT[key] ?? '#ffffff'; }
  /** Over `dur` seconds from `t`, `fn(card, u)` shapes card `id` (its veil, how solid it is, its tilt, how lit it is); at the end it is plain again. */
  touch(id, t, dur, fn) {
    this.tween(t, dur, (u) => { const c = this.sc.cards.get(id); if (!c?.setVeil) return; this.touched.add(c); if (u >= 1) { c.calm(); this.touched.delete(c); } else fn(c, u); });
  }
  /** Card `id` rises a little at `t` and settles again. */
  bob(id, t, p, y = 0.5) { if (p) this.path(id, [[t, { ...p, y: p.y + y, scale: p.scale * 1.04 }, SPRING.follow], [t + 0.22, null]]); }
  /** A card the Warp Portal overcomes for a moment: purple pixels swirl over it, it goes see-through, and they drain away. `tip` makes it ripple up as they come. */
  ghost(id, t, color, { dur = 0.95, depth = 0.65, tip = 0.35 } = {}) {
    this.touch(id, t, dur, (c, u) => {
      const flood = Math.min(1, u / 0.3), drain = u < 0.6 ? 0 : (u - 0.6) / 0.4, see = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.15) / 0.7)));
      c.tilt = tip * Math.sin(Math.PI * Math.min(1, u / 0.5)); c.fade = 1 - depth * see;
      c.setVeil({ color, shape: 1, amount: flood * (1 - drain), alpha: 0.95 - 0.4 * see, spin: u * 1.5 + drain * 2 });
    });
  }
  /** A Warp Portal comes in: a swirl turns round it, and a wave runs through the enemy Guardians (`ids`), nearest first, each overcome as it crests. */
  portal(pid, ids, t, live) {
    const color = this.tint('portal'), o = live(pid);
    this.at(t, () => this.sc.overlay.pixel?.('swirl', o.x, o.z, { color, r: 2.4, dur: 1.0 }));
    this.touch(pid, t, 0.7, (c, u) => c.setVeil({ color, shape: 1, amount: 0.5 * Math.sin(Math.PI * u), alpha: 0.85, spin: -2 * u }));
    [...ids].filter((id) => live(id)).sort((a, b) => dist(live(a), o) - dist(live(b), o)).forEach((id, i) => {
      const ti = t + 0.25 + i * 0.12;
      this.bob(id, ti, live(id), 0.6); this.ghost(id, ti, color); this.sound('tick', ti, live(id), { step: i * 2, gain: 0.6 });
    });
  }
  /** A Lantern Keeper's dotted glow spreads across the table from it, `r` far; the Keeper itself lights up from its edges. */
  lamp(lid, t, live, r) {
    const color = this.tint('lantern'), o = live(lid); if (!o) return;
    this.at(t, () => this.sc.overlay.pixel?.('dots', o.x, o.z, { color, r, dur: 0.8 }));
    this.touch(lid, t, 0.6, (c, u) => c.setVeil({ color, shape: 2, amount: 0.5 * Math.sin(Math.PI * u), alpha: 0.85 }));
  }
  /** The light comes on (from Keeper `lid`, glowing from `t`) over spent creatures `ids`: as the glow reaches each, it fills in green from the edges, brightens, and stands a little taller. */
  lightOn(lid, ids, t, live) {
    const color = this.tint('lantern'), o = live(lid) ?? live(ids[0]), far = Math.max(0, ...ids.map((id) => (live(id) ? dist(live(id), o) : 0))), r = Math.min(16, Math.max(4, far + 1.5));
    this.lamp(lid, t, live, r);
    ids.forEach((id, i) => {
      const p = live(id); if (!p) return;
      const ti = t + 0.8 * (1 - Math.cbrt(Math.max(0, 1 - dist(p, o) / r)));        // when the spreading glow (eased like the overlay's) reaches it
      this.bob(id, ti, p, 0.35); this.sound('tick', ti, p, { step: 4 + i * 2, gain: 0.5 });
      this.touch(id, ti, 0.7, (c, u) => { c.bright = Math.sin(Math.PI * u); c.setVeil({ color, shape: 2, amount: u < 0.35 ? 0.55 * u / 0.35 : 0.55 * (1 - (u - 0.35) / 0.65), alpha: 0.9 }); });
    });
  }
  /** The light goes out over `ids`: the green flickers and gutters, and embers fall. */
  lightOff(ids, t, live) {
    const color = this.tint('lantern');
    ids.forEach((id, i) => {
      const p = live(id); if (!p) return;
      this.at(t + i * 0.06, () => this.sc.overlay.pixel?.('embers', p.x, p.z, { color, dur: 0.8 }));
      this.touch(id, t + i * 0.06, 0.7, (c, u) => { const f = Math.sin(u * 42) > -0.2 ? 1 : 0.25; c.bright = 0.5 * (1 - u) * f; c.setVeil({ color, shape: 2, amount: 0.5 * (1 - u) * f, alpha: 0.85 }); });
    });
  }
  /** Heaven's Resolve's light falls on card `id`: a beam comes down on it, gold pixels rise through it, and it straightens. */
  bless(id, t, p, { wide = 0.6, i = 0 } = {}) {
    const color = this.tint('resolve'); if (!p) return;
    this.at(t, () => this.sc.overlay.pixel?.('shaft', p.x, p.z, { color, wide, r: 2, dur: 0.75 }));
    this.touch(id, t + 0.12, 0.6, (c, u) => { c.bright = 0.6 * Math.sin(Math.PI * u); c.tilt = -0.18 * Math.sin(Math.PI * u); c.setVeil({ color, shape: 3, amount: u, alpha: 0.9 }); });
    this.bob(id, t + 0.12, p, 0.4); this.sound('tick', t + 0.12, p, { step: 6 + i * 2, gain: 0.55 });
  }
  /** A Heaven's Resolve comes in: a broad beam falls on it, then on each of your attackers (`ids`) in turn, nearest first. */
  /** A card is broken: its pixels scatter (card `key`'s colour) as it goes to its pile, and a burst of them is thrown out where it was. */
  shatter(id, t, p, key) {
    const color = key ? this.tint(key) : '#efe7c6'; if (!p) return;
    this.at(t, () => this.sc.overlay.pixel?.('burst', p.x, p.z, { y: 0.5, n: 28, speed: 100, grav: 70, color, color2: '#efe7c6', dur: 0.8, big: 12 }));
    this.touch(id, t, 0.5, (c, u) => { const k = Math.sin(Math.PI * u); c.setVeil({ color, shape: 0, amount: 0.65 * k, alpha: 0.9 }); c.fade = 1 - 0.65 * k; });
  }
  /** A Fireball burns a card it defeats: fire eats in from the edges and it thins as it goes to its pile. */
  burn(id, t) {
    const color = this.tint('fireball');
    this.touch(id, t, 0.55, (c, u) => { c.setVeil({ color, shape: 2, amount: Math.min(1, u * 1.8) * (u < 0.8 ? 1 : (1 - u) / 0.2), alpha: 0.95 }); c.fade = 1 - 0.7 * Math.sin(Math.PI * u); c.bright = 0.5 * Math.sin(Math.PI * u); });
  }
  /**
   * A Shift sends card `id` home: held up beside the spell, it breaks into scattered pixels (from `t`, while it is still held) and thins, crosses to the hand
   * like that, and forms again as it comes down (the flight is the `present` one: it leaves at t + 0.3 and is down by about t + 0.7).
   */
  unmake(id, t, color) {
    const T = 0.9;
    this.touch(id, t, T, (c, u) => {
      const s = u * T, k = s < 0.3 ? s / 0.3 : s < 0.68 ? 1 : Math.max(0, 1 - (s - 0.68) / 0.22);
      c.setVeil({ color, shape: 0, amount: 0.62 * k, alpha: 0.85 }); c.fade = 1 - 0.75 * k;
    });
    const at = (dt) => this.at(t + dt, () => { const c = this.sc.cards.get(id); if (c) this.sc.overlay.pixel?.('burst', c.s.x.x, c.s.z.x, { y: c.s.y.x, n: 12, speed: 45, grav: 30, color, dur: 0.55 }); });
    at(0.2); at(0.7);
  }
  /** A Witch's Kiss takes card `id`: a pink pixel heart grows out from its middle and little pixel hearts float up off it while it is held up (from `t`, for `dur`), and clears as it lands. */
  charm(id, t, dur, color) {
    this.touch(id, t, dur, (c, u) => {
      const s = u * dur, k = Math.min(1, s / 0.35) * Math.min(1, (dur - s) / 0.35);
      c.setVeil({ color, shape: 4, amount: 0.85 * k, alpha: 0.95 }); c.bright = 0.3 * k;
    });
    this.at(t + 0.4, () => { const c = this.sc.cards.get(id); if (c) this.sc.overlay.pixel?.('hearts', c.s.x.x, c.s.z.x, { y: c.s.y.x, color, dur: 1.1 }); });
  }
  resolve(rid, ids, t, live) {
    const o = live(rid); if (!o) return;
    this.bless(rid, t, o, { wide: 1.2 });
    const near = [...ids].filter((id) => live(id)).sort((a, b) => dist(live(a), o) - dist(live(b), o)), gap = Math.min(0.14, 0.7 / Math.max(1, near.length - 1));     // since 19 Nov 2026 it touches every creature, so the stagger is squeezed to fit
    near.forEach((id, i) => this.bless(id, t + 0.35 + i * gap, live(id), { i }));
  }

  // ---- the plan --------------------------------------------------------------------------------------------------------------------------------
  /**
   * Plan the motion for `events` (the events a move gave, as `viewer` sees them). `prev` and `next` are the layouts before and after, as Maps of card id to
   * placement. Returns the poses that cards new to the table start from (a drawn card starts at its pile, an opponent's played card at their hand).
   */
  plan(events, prev, next, view, viewer) {
    this.ids = new Set(events.flatMap((e) => Object.values(e).flat()).filter((v) => typeof v === 'string'));     // every card the move names: their idle effects step aside while it plays
    // The opponent's moves play slower than your own: you know what you did, not what they did. (Who moved: the first event that says, or the owner of its card.)
    const first = events.find((e) => e.t !== 'draw' && e.t !== 'turn'), mover = first && (first.p ?? (prev.get(first.id) ?? next.get(first.id))?.owner);
    const k = this.k; if (mover !== undefined && mover !== viewer) this.k = k * THEIRS;
    try { return this.planned(events, prev, next, view, viewer); } finally { this.k = k; }
  }
  planned(events, prev, next, view, viewer) {
    const spawn = new Map(), sc = this.sc, side = (o) => (o === viewer ? 1 : -1);
    if (!this.k || !events.length) return spawn;
    const live = (id) => { const c = sc.cards.get(id); return c ? c.livePose() : spawn.get(id) ?? prev.get(id) ?? next.get(id); };
    const spot = (id) => prev.get(id) ?? next.get(id);
    const top = (zone, o) => [prev, next].map((m) => [...m.values()].find((c) => c.zone === zone && c.owner === o && c.top)).find(Boolean);
    const deckTop = (o) => { const c = top('deck', o); return c ? { ...c, y: c.y + 0.1 } : deckSpot(side(o)); };
    const handOf = (o) => { const hand = [...prev.values()].filter((c) => c.zone === 'hand' && c.owner === o); return hand.length ? hand[Math.floor(hand.length / 2)] : handSpot(side(o)); };
    const defeated = new Set(events.filter((e) => e.t === 'defeat' || e.t === 'rescue').map((e) => e.id));
    const unit = (a, b) => { const l = dist(a, b) || 1; return [(b.x - a.x) / l, (b.z - a.z) / l]; };

    /** Everything that is about to change place waits where it is until `until` (except `skip`): so a defeated card does not leave before the blow lands. */
    const holdChanged = (until, skip = new Set()) => {
      for (const [id, p] of next) { const q = prev.get(id); if (q && p.zone !== 'hand' && sc.cards.has(id) && !skip.has(id) && moved(q, p)) this.path(id, [[0, 'live'], [until, null]]); }
    };
    /** A card that leaves play flies to its pile rather than sliding. */
    const leave = (id, t) => { const from = live(id), to = next.get(id); if (to) this.fly(id, from, to, t, { lift: 1.0, half: 0.1 }); };
    /** A blow lands on `id` at `t`: it flashes and rings, and the table gives a little. */
    const strike = (id, t, dir) => {
      this.sound('clash', t, live(id)); this.glow(id, t); this.ring({ card: id }, t);
      this.at(t, () => { const c = sc.cards.get(id); if (c && dir && !defeated.has(id)) c.kick(dir[0], dir[1], 0.3); sc.nudge(dir ? dir[0] * 0.28 : 0, dir ? dir[1] * 0.28 : 0); });
    };

    /**
     * The card a spell takes (a Kiss) or sends back (a Shift) is lifted out of where it lies, held up beside the spell so it can be read, and then goes to its
     * new place. A card going into a hand we cannot see (`handOwner`'s) is stood in for by the newest card of that hand, which turns face down on the way.
     * Nothing else that changed place moves until it has gone: the pile or Chain it left closes up, and a row makes room, only then. Returns its key.
     */
    const present = (eid, handOwner, inPlace = false) => {
      const r = caster.ready, from = live(eid), to = next.get(eid), key = spot(eid)?.key ?? null;
      // A Kiss brings the card over to the one who takes it, beside the spell. A Shift sends a card home: it is lifted where it lies, on its owner's side, and goes
      // from there to its owner's hand, so it never crosses the table to the other player and back.
      const reveal = inPlace ? { ...from, y: Math.max(from.y, 0.3) + 1.9, scale: Math.max(from.scale ?? 1, 1) * 1.2, face: 1, spin: 0, dim: false } : { ...caster.show, x: 2.2 };
      let into = to, id = eid;
      if (!to) {
        const hand = [...next.values()].filter((c) => c.zone === 'hand' && c.owner === handOwner).sort((a, b) => b.order - a.order);
        id = hand[0]?.id; into = id && next.get(id);
        if (into) { if (sc.cards.has(id)) this.at(0, () => sc.cards.get(id)?.snapTo(from, sc.camera.quaternion)); else spawn.set(id, from); this.flip(id, r + HOLD + 0.02, 0.3, key, null); }
      }
      if (into) {
        this.sound('grab', r, from); this.landing(id, r, { gain: 0.8 });
        this.ring({ card: eid }, r - 0.1, { grow: 0.18, dur: 0.4 }); this.glow(id, r);
        this.fly(id, reveal, into, r, { lift: 1.2, half: 0.2, via: reveal, linger: HOLD });
      }
      caster.took = into ? id : null;                          // the card that actually flies (a stand-in from the hand when the real one is hidden)
      holdChanged(r + HOLD + 0.2, new Set([...defeated, caster.id, eid, id ?? eid]));
      caster.end = r + HOLD + 0.45;
      return key;
    };

    let t = 0, draws = 0, caster = null, blow = null, lamp = null;      // ...and a Lantern Keeper deployed in this move ({ id, at }: when its glow starts)          // time so far; draws so far; the spell being cast; when and where the last blow lands
    for (const e of events) {
      switch (e.t) {
        case 'end': t = Math.max(t, 0.12); break;
        case 'turn': t = Math.max(t, 0.2); break;
        case 'draw': {
          const n = next.get(e.id); if (!n || sc.cards.has(e.id)) break;
          const from = deckTop(e.p), at = t + draws++ * 0.09;
          spawn.set(e.id, from); this.fly(e.id, from, n, at);
          this.sound('deal', at, from, { step: draws - 1, gain: e.p === viewer ? 1 : 0.75 });        // a run of draws climbs, card by card
          if (e.p === viewer && n.key) this.flip(e.id, at, 0.3, null, n.key);
          break;
        }
        case 'deploy': case 'wind': {
          const n = next.get(e.id); if (!n) break;
          let from;
          if (sc.cards.has(e.id)) from = live(e.id);
          else { const h = handOf(n.owner); from = { ...h, y: h.y + 0.1, face: 1 }; spawn.set(e.id, from); this.flip(e.id, t, 0.3, null, n.key); }
          if (!sc.cards.has(e.id)) this.sound('deal', t, from, { gain: 0.8 });
          this.fly(e.id, from, n, t, { lift: dist(from, n) > 4 ? 1.3 : 0.3 });
          this.landing(e.id, t);
          if (n.owner !== viewer) this.ring({ card: e.id }, t + 0.32);
          if (e.t === 'deploy') {
            const at = t + LAND, here = (id) => (id === e.id ? n : live(id));
            if (n.key === 'portal') this.portal(e.id, e.touches ?? [], at, here);
            else if (n.key === 'resolve') this.resolve(e.id, e.touches ?? [], at, here);
            else if (n.key === 'lantern') { lamp = { id: e.id, at }; if (!events.some((x) => x.t === 'light' && x.on && x.by === e.id)) this.lamp(e.id, at, here, 4); }    // with creatures to light, the glow goes as far as they are (below)
          }
          break;
        }
        case 'release': t = this.unleash(view.players[e.p].chain.map((c) => c.id), live, t, (id) => spot(id)?.key); break;      // a card's key is null while it is hidden from this seat
        case 'cast': {
          const takes = events.some((x) => x.t === 'kiss' || x.t === 'recall' || x.t === 'shift'), theirs = e.p !== viewer;
          const n = next.get(e.id), show = { ...SHOW(side(e.p)), x: takes ? -2.2 : 0 };     // a Kiss or a Shift leaves room beside it for the card it takes
          let from;
          if (sc.cards.has(e.id)) from = live(e.id);
          else { const h = handOf(e.p); from = { ...h, y: h.y + 0.1 }; spawn.set(e.id, from); this.flip(e.id, t, 0.28, null, n.key); }
          this.sound(sc.cards.has(e.id) ? 'grab' : 'flip', t + (sc.cards.has(e.id) ? 0 : 0.14), show);
          this.path(e.id, [[0, 'live'], [t, show]]);
          caster = { id: e.id, ready: t + 0.3 + (takes || theirs ? READ : 0), end: t + 0.42, show, p: e.p };
          if (theirs) this.at(t, () => sc.say?.(`Opponent casts ${CARDS[e.spell]?.name ?? 'a spell'}.`));
          break;
        }
        case 'fireball': case 'shift': case 'rally': case 'kiss': case 'recall': case 'shadow': {
          if (!caster) break;
          const r = caster.ready, a = { x: caster.show.x, y: 0.6, z: caster.show.z };
          if (e.t === 'fireball') {
            const tg = live(e.hit), dir = unit(a, tg), land = r + 0.16;
            const fire = this.tint('fireball');                  // a ball of fire pixels flies to the target, shedding embers, and bursts on it
            this.at(r, () => { const T = sc.cards.get(e.hit), b = T ? T.root.position : tg; sc.overlay.pixel?.('comet', a.x, a.z, { y: 1.6, x2: b.x, z2: b.z, y2: 1, dur: 0.2, color: fire, color2: GOLD }); });
            this.at(land, () => { sc.overlay.pixel?.('burst', tg.x, tg.z, { y: 0.8, n: 22, speed: 80, grav: 50, color: fire, color2: GOLD, dur: 0.7 }); sc.overlay.pixel?.('pring', tg.x, tg.z, { r: 2.6, dur: 0.4, color: fire }); });
            holdChanged(land, new Set([...defeated, caster.id])); strike(e.hit, land, dir); blow = land; caster.end = land + 0.06;
          } else if (e.t === 'kiss') {
            const key = present(e.id, caster.p), pink = KISS;               // the pink of the kiss she blows in the art (her frame is lavender, too near the Warp Portal's purple)
            if (caster.took) this.charm(caster.took, r - 0.15, HOLD + 0.8, pink);
            for (const gid of sc.lastGather ?? []) if (gid !== e.id && sc.cards.has(gid)) {      // the cards laid out and not chosen fade as they go back to their piles
              this.touch(gid, 0, 0.6, (c, u) => { const k = Math.sin(Math.PI * u); c.fade = 1 - 0.8 * k; c.setVeil({ color: pink, shape: 0, amount: 0.5 * k, alpha: 0.8 }); });
            }
            sc.lastGather = null;
            if (key) {                                                // the line that confirms what was taken (for your own Kiss too: the pick is over once it shows)
              const whose = e.from === viewer ? 'your' : 'their', where = e.zone === 'chain' ? 'Chain' : 'discard pile';
              this.at(r, () => sc.say?.(`Witch’s Kiss takes ${CARDS[key].name} from ${whose} ${where}.`));
            }
          } else if (e.t === 'shadow') {
            // The attacker is called out as the spell is held up; its attack follows (the `attack` events after this one), timed from the moment the spell is ready.
            this.glow(e.id, r); this.ring({ card: e.id }, r, { grow: 0.16 });
            caster.lead = r + 0.1; caster.end = r + 0.5;
          } else if (e.t === 'recall') {
            const key = present(e.id, e.from, true);
            if (caster.took) this.unmake(caster.took, r + HOLD - 0.3, this.tint('shift'));
            if (key) this.at(r, () => sc.say?.(`${caster.p === viewer ? 'Your' : 'Their'} Shift returns ${CARDS[key].name} to ${e.from === viewer ? 'your' : 'their'} hand.`));
          } else if (e.t === 'shift') {
            // A Guardian is lifted off the card it guarded (which rings: it is no longer guarded), held up beside the Shift, and goes to its owner's hand.
            const owner = spot(e.id)?.owner;
            present(e.id, owner, true);
            if (caster.took) this.unmake(caster.took, r + HOLD - 0.3, this.tint('shift'));
            if (e.from) this.ring({ card: e.from }, r + 0.1, { grow: 0.2, dur: 0.5 });
            const whose = owner === viewer ? 'your' : 'their';
            this.at(r, () => sc.say?.(`${caster.p === viewer ? 'Your' : 'Their'} Shift sends ${whose} Guardian back to ${whose} hand.`));
          } else {
            holdChanged(r, new Set([...defeated, caster.id]));
            const to = e.t === 'rally' ? e.id : e.to; if (to) { this.glow(to, r + 0.04); this.ring({ card: to }, r + 0.04, { grow: 0.16 }); }
            caster.end = r + 0.32;
          }
          break;
        }
        case 'behind': {                                         // a dark wave of pixels sweeps the table; each unguarded creature, both players', is hit as it reaches it, flickering in the spell's colour
          if (!caster) break;
          const r = caster.ready, color = this.tint('behind'), pts = e.hits.map((id) => [id, live(id)]).filter(([, p]) => p);
          const xs = pts.map(([, p]) => p.x), zs = pts.map(([, p]) => p.z), x0 = Math.min(...xs, 0) - 5, x1 = Math.max(...xs, 0) + 5, dur = 0.6;
          this.at(r, () => sc.overlay.pixel?.('wave', 0, 0, { x0, x1, z0: Math.min(...zs, 0) - 2.5, z1: Math.max(...zs, 0) + 2.5, dur, color, w: 2.8 }));
          let land = r + 0.16;
          for (const [id, p] of pts) {
            const ti = r + dur * (p.x - x0) / (x1 - x0); land = Math.max(land, ti);
            strike(id, ti, [1, 0]);
            this.touch(id, ti - 0.04, 0.4, (c, u) => c.setVeil({ color, shape: 0, amount: 0.55 * Math.sin(Math.PI * u) * (Math.floor(u * 9) % 2 ? 0.5 : 1), alpha: 0.85 }));
          }
          holdChanged(land, new Set([...defeated, caster.id]));
          this.at(land, () => sc.nudge(0, 0.3));
          blow = land; caster.end = land + 0.06;
          break;
        }
        case 'attack': {
          const a = live(e.id), tg = live(e.hit), dir = unit(a, tg), far = dist(a, tg) > 5, o = caster?.lead ?? 0;      // a Shadow Step's attack waits for its spell
          const atk = (prev.get(e.id) ?? next.get(e.id))?.owner === viewer, They = atk ? 'Your' : 'Their';
          if (e.portal) this.at(o + 0.02, () => sc.say?.(`${They} Warp Portal sends the attack straight past the Guardians.`));
          else if (e.lit) this.at(o + 0.02, () => sc.say?.(`${They} Lantern Keeper lets a spent creature attack.`));
          if (e.lit) { const color = this.tint('lantern'); this.touch(e.id, o, 0.4, (c, u) => { c.bright = Math.sin(Math.PI * u); c.setVeil({ color, shape: 2, amount: 0.6 * Math.sin(Math.PI * u), alpha: 0.9 }); }); }   // a spent attacker the Lantern lets attack flares green
          if (e.portal) {
            const pid = view.players[next.get(e.id)?.owner ?? prev.get(e.id)?.owner]?.field.find((c) => c.key === 'portal')?.id;
            this.at(o + 0.02, () => { const A = sc.cards.get(e.id), T = sc.cards.get(e.hit); if (A && T) { const a2 = A.root.position, t2 = T.root.position, purple = this.tint('portal'); sc.overlay.pixel?.('bolt', a2.x, a2.z, { x2: t2.x, z2: t2.z, y: 1, dur: 0.24, color: purple }); this.at(0.14, () => sc.overlay.pixel?.('pring', t2.x, t2.z, { r: 2.2, dur: 0.4, color: purple })); } });      // a jagged charge of Portal-purple pixels runs from the attacker straight through to its target
            if (pid) { this.glow(pid, o); this.ring({ card: pid }, o); }
            const owner = spot(e.hit)?.owner, color = this.tint('portal');           // the Guardians on the card hit are passed straight through: they go see-through for a beat
            for (const gd of view.players[owner]?.field.filter((c) => c.guards === e.hit) ?? []) this.ghost(gd.id, o, color, { dur: 0.5, depth: 0.6, tip: 0 });
            blow = o + 0.24;
          } else if (far) {
            const back = { ...a, x: a.x - dir[0] * 0.8, z: a.z - dir[1] * 0.8, y: 1.0, face: 0 }, hit = { ...a, x: tg.x - dir[0] * 3.1, z: tg.z - dir[1] * 3.1, y: 1.4, face: 0 };
            this.path(e.id, [[o, back, SPRING.follow], [o + 0.12, hit, SPRING.follow]]);
            blow = o + 0.26;
          } else blow = o + 0.06;
          holdChanged(blow, new Set([...defeated, e.id, e.hit]));
          if (caster?.lead !== undefined) {                    // a Shadow Step: the attacker goes dark and see-through, sheds shadow pixels, and comes back at its target
            const shade = this.tint('shadow'), dusk = darken(shade, 0.7), T0 = Math.max(0, o - 0.12), T = blow + 0.3 - T0;
            this.touch(e.id, T0, T, (c, u) => { const s = u * T, k = Math.min(1, s / 0.12) * Math.min(1, (T - s) / 0.22); c.fade = 1 - 0.65 * k; c.setVeil({ color: dusk, shape: 0, amount: 0.55 * k, alpha: 0.95 }); });
            this.at(T0, () => sc.overlay.pixel?.('burst', a.x, a.z, { y: 0.6, n: 14, speed: 40, grav: -25, color: shade, color2: '#1b1428', dur: 0.6, big: 0 }));
            this.at(blow - 0.02, () => sc.overlay.pixel?.('burst', tg.x - dir[0] * 1.5, tg.z - dir[1] * 1.5, { y: 0.8, n: 12, speed: 50, grav: 20, color: shade, color2: '#1b1428', dur: 0.5, big: 0 }));
          }
          if (defeated.has(e.hit)) { this.sound('death', blow + 0.04, tg); if (spot(e.hit)?.key !== 'heart') this.shatter(e.hit, blow, tg, spot(e.hit)?.key); }
          if (defeated.has(e.hit)) this.fly(e.hit, tg, next.get(e.hit) ?? tg, blow, { lift: 1.0, half: 0.1 }); else this.path(e.hit, [[0, 'live'], [blow, null]]);
          this.path(e.id, [[blow + 0.03, null]]);
          strike(e.hit, blow, dir);
          if (caster?.lead !== undefined) caster.end = Math.max(caster.end, blow + 0.2);
          break;
        }
        case 'rescue': {
          const heart = e.saved, angel = e.id;
          sc.haloHold.add(heart); this.at(blow ?? 0.2, () => sc.haloHold.delete(heart));
          this.fly(angel, live(angel), next.get(angel) ?? live(angel), blow ?? 0.2, { lift: 1.0, half: 0.1 });
          this.sound('death', (blow ?? 0.2) + 0.04, live(angel), { gain: 0.8 });
          this.glow(heart, blow ?? 0.2);
          {                                                    // white feathers drift down from the Angel as it goes, and a light closes in round the Heart from its edges
            const wing = this.tint('angel'), ap = live(angel), at = blow ?? 0.2;
            if (ap) this.at(at, () => sc.overlay.pixel?.('burst', ap.x, ap.z, { y: 1, n: 24, speed: 70, grav: 35, sway: 10, rise: 22, color: '#ffffff', color2: wing, dur: 1.4, big: 24 }));
            this.touch(heart, at, 0.85, (c, u) => { const k = Math.min(1, u * 2.2) * (u < 0.6 ? 1 : (1 - u) / 0.4); c.setVeil({ color: wing, shape: 2, amount: 0.45 * k, alpha: 0.85 }); c.bright = 0.4 * Math.sin(Math.PI * u); });
          }
          const mine = (prev.get(heart) ?? next.get(heart))?.owner === viewer;      // whose Heart it was, so the line reads right from either seat
          this.at(blow ?? 0.2, () => sc.say?.(`${mine ? 'Your' : 'Their'} Angel takes the blow. ${mine ? 'Your' : 'Their'} Heart is safe.`));
          break;
        }
        case 'hit': {                                            // the first blow on a Heart: it turns spent (sideways), with a wider ring after the blow and a line saying so
          const n = next.get(e.id); if (n?.key !== 'heart') break;
          const at = blow ?? 0.2;
          { const h = live(e.id), color = this.tint('heart');     // it cracks: jagged lines of pixels split out from it, and its pixels flicker
            if (h) this.at(at, () => { sc.overlay.pixel?.('crack', h.x, h.z, { color, dur: 0.9, n: 6 }); sc.overlay.pixel?.('burst', h.x, h.z, { y: 0.4, n: 12, speed: 60, grav: 60, color, color2: '#efe7c6', dur: 0.6 }); });
            this.touch(e.id, at, 0.45, (c, u) => c.setVeil({ color, shape: 0, amount: 0.7 * Math.sin(Math.PI * u) * (Math.floor(u * 10) % 2 ? 0.5 : 1), alpha: 0.9 })); }
          this.at(at, () => sc.say?.(`${n.owner === viewer ? 'Your' : 'Their'} Heart is spent. Another blow defeats it.`));
          break;
        }
        case 'defeat': {                                         // by a Fireball: the card flies to its pile when the blow lands
          if (blow !== null && caster && !events.some((x) => x.t === 'attack' && x.hit === e.id)) {
            this.sound('death', blow + 0.04, live(e.id)); this.fly(e.id, live(e.id), next.get(e.id) ?? live(e.id), blow, { lift: 1.0, half: 0.1 });
            if (events.some((x) => x.t === 'fireball' && x.hit === e.id)) this.burn(e.id, blow); else this.shatter(e.id, blow, live(e.id), spot(e.id)?.key);
          }
          break;
        }
        case 'light': {                                          // a Lantern Keeper's light comes on or goes out over spent creatures
          if (e.on) {
            const here = (id) => (id === e.by ? next.get(id) ?? live(id) : live(id));      // the Keeper may still be on its way to its place
            if (lamp?.id === e.by) this.lightOn(e.by, e.ids, lamp.at, here);
            else this.lightOn(e.by, e.ids, caster ? caster.ready + 0.1 : 0.1, here);
          } else this.lightOff(e.ids, (blow ?? caster?.ready ?? 0) + 0.1, live);
          break;
        }
        case 'return': {                                         // a Guardian goes back to its owner's hand because the card it guarded left play (a Shift says so itself)
          if (events.some((x) => x.t === 'shift')) break;
          const whose = (prev.get(e.id) ?? next.get(e.id))?.owner === viewer ? 'Your' : 'Their';
          this.at(blow ?? 0.2, () => sc.say?.(`${whose} Guardian goes back to ${whose === 'Your' ? 'your' : 'their'} hand.`));
          break;
        }
        case 'bonus': this.ring({ card: e.id }, (blow ?? 0.1) + 0.14, { grow: 0.2, dur: 0.4 }); break;
        case 'reguard': if (e.to) { this.glow(e.to, 0.32); this.ring({ card: e.to }, 0.32, { grow: 0.14 }); } break;
        case 'recover': {
          if (e.free) this.at(0.05, () => sc.say?.(`Heaven’s Resolve stands ${e.p === viewer ? 'your' : 'their'} creatures back up.`));
          const stood = [...prev.values()].filter((c) => c.owner === e.p && c.dim && next.get(c.id) && !next.get(c.id).dim);
          if (e.free) { const gap = Math.min(0.1, 0.6 / Math.max(1, stood.length - 1)); stood.forEach((c, i) => this.bless(c.id, 0.05 + i * gap, next.get(c.id), { i })); }      // free, by a Heaven's Resolve: its light falls on each one that stands (lifted at its new, upright place: lifting it where it lay turned it back sideways and then up again)
          else stood.forEach((c, i) => { this.glow(c.id, 0.05 + i * 0.05); this.ring({ card: c.id }, 0.05 + i * 0.05, { grow: 0.1 }); });
          break;
        }
        case 'win': {
          const loser = view.players[1 - e.p].hearts[0]; if (!loser) break;
          const at = blow ?? 0.2, h = live(loser.id);
          this.glow(loser.id, at);
          { const color = this.tint('heart');                  // the losing Heart breaks apart: cracks, a great burst of its pixels, and it stays scattered and faint (the game is over)
            this.at(at, () => { sc.overlay.pixel?.('crack', h.x, h.z, { color, dur: 1.1, n: 9 }); sc.overlay.pixel?.('burst', h.x, h.z, { y: 0.6, n: 40, speed: 130, grav: 80, color, color2: '#efe7c6', dur: 1.2, big: 10 }); sc.overlay.pixel?.('pring', h.x, h.z, { r: 7, dur: 0.8, color }); });
            this.tween(at + 0.05, 1.0, (u) => { const c = sc.cards.get(loser.id); if (!c?.setVeil) return; c.setVeil({ color, shape: 0, amount: Math.min(1, u * 1.5), alpha: 0.9 - 0.45 * u }); c.fade = 1 - 0.7 * u; }); }
          this.at(at, () => sc.lean(h.x * 0.05, -2.2, h.z * 0.05));        // a slow push in toward the fallen Heart
          break;
        }
        default: break;
      }
    }
    // The spell that was cast goes to its pile once its effect has landed.
    if (caster) { const c = caster; this.path(c.id, [[c.end, null]]); this.sound('return', c.end, c.show, { gain: 0.6 }); this.landing(c.id, c.end, { gain: 0.5 }); }
    return spawn;
  }
}
