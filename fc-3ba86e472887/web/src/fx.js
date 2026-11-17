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
import { CARDS } from '../../src/index.js';
import { SPRING } from './card.js';
import { handSpot, deckSpot } from './layout.js';

const mix = (a, b, u) => { const o = { ...b }; for (const k of ['x', 'y', 'z', 'spin', 'scale', 'face']) o[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * u; return o; };
const moved = (a, b) => ['x', 'y', 'z', 'spin', 'face'].some((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 0.05) || !!a.dim !== !!b.dim;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SHOW = (side) => ({ x: 0, y: 2.6, z: side * 2.2, yaw: 0, spin: 0, scale: 1.2, face: 1, dim: false });     // where a spell is held up while it takes effect

export class Fx {
  constructor(scene) { this.sc = scene; this.now = 0; this.jobs = []; this.held = new Set(); this.k = 1; this.end = 0; }
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
    this.held.clear(); this.jobs = []; this.end = this.now; this.sc.haloHold.clear(); this.sc.lean(0, 0, 0);
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
   * A Chain is let go: a flare of light and a shockwave across it, then a charge runs down it from the first spell to the last. Each spell leaps up, flashes,
   * and rings as the charge reaches it, and the last one lands with a thud the whole table feels. Returns when it is over.
   */
  unleash(ids, live, t) {
    const sc = this.sc, ov = sc.overlay, spots = ids.map((id) => live(id)), mid = { x: spots.reduce((s, p) => s + p.x, 0) / spots.length, z: spots.reduce((s, p) => s + p.z, 0) / spots.length };
    const at = (p, y = 0.9) => new THREE.Vector3(p.x, y, p.z), toward = Math.sign(mid.x) || 1;
    this.at(t, () => { ov.glare(mid.x, mid.z, { alpha: 0.2, dur: 0.55 }); ov.shock(mid.x, mid.z, { r: 8, dur: 0.5, width: 2 }); sc.nudge(-toward * 0.1, 0.12); });
    ids.forEach((id, i) => {
      const ti = t + 0.1 + i * 0.12, p = spots[i], last = i === ids.length - 1;
      this.path(id, [[0, 'live'], [ti - 0.05, { ...p, y: p.y + 1.5, scale: p.scale * 1.16, face: 0 }, SPRING.follow], [ti + 0.24, null]]);      // it leaps up as the charge reaches it, then settles back
      if (i) this.at(ti - 0.07, () => ov.beam(at(spots[i - 1], 1.4), at(p, 1.4), { dur: 0.14, color: '#ffd27a' }));
      this.glow(id, ti); this.ring({ card: id }, ti, { grow: 0.2, dur: 0.4 }); this.ring({ card: id }, ti + 0.08, { grow: 0.42, dur: 0.5, alpha: 0.5 });
      this.at(ti, () => { ov.shock(p.x, p.z, { r: last ? 7 : 4.5, dur: last ? 0.55 : 0.4, width: last ? 3.4 : 2.4 }); sc.nudge(-toward * (last ? 0.18 : 0.06), last ? 0.4 : 0.14); });
    });
    return t + 0.1 + (ids.length - 1) * 0.12 + 0.3;
  }
  ring(spec, t, o) { this.at(t, () => this.sc.overlay.ring(spec, o)); }
  glow(id, t) { this.at(t, () => this.sc.flash(id)); }

  // ---- the plan --------------------------------------------------------------------------------------------------------------------------------
  /**
   * Plan the motion for `events` (the events a move gave, as `viewer` sees them). `prev` and `next` are the layouts before and after, as Maps of card id to
   * placement. Returns the poses that cards new to the table start from (a drawn card starts at its pile, an opponent's played card at their hand).
   */
  plan(events, prev, next, view, viewer) {
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
      this.glow(id, t); this.ring({ card: id }, t);
      this.at(t, () => { const c = sc.cards.get(id); if (c && dir && !defeated.has(id)) c.kick(dir[0], dir[1], 0.3); sc.nudge(dir ? dir[0] * 0.28 : 0, dir ? dir[1] * 0.28 : 0); });
    };

    let t = 0, draws = 0, caster = null, blow = null;          // time so far; draws so far; the spell being cast; when and where the last blow lands
    for (const e of events) {
      switch (e.t) {
        case 'end': t = Math.max(t, 0.12); break;
        case 'turn': t = Math.max(t, 0.2); break;
        case 'draw': {
          const n = next.get(e.id); if (!n || sc.cards.has(e.id)) break;
          const from = deckTop(e.p), at = t + draws++ * 0.09;
          spawn.set(e.id, from); this.fly(e.id, from, n, at);
          if (e.p === viewer && n.key) this.flip(e.id, at, 0.3, null, n.key);
          break;
        }
        case 'deploy': case 'wind': {
          const n = next.get(e.id); if (!n) break;
          let from;
          if (sc.cards.has(e.id)) from = live(e.id);
          else { const h = handOf(n.owner); from = { ...h, y: h.y + 0.1, face: 1 }; spawn.set(e.id, from); this.flip(e.id, t, 0.3, null, n.key); }
          this.fly(e.id, from, n, t, { lift: dist(from, n) > 4 ? 1.3 : 0.3 });
          if (n.owner !== viewer) this.ring({ card: e.id }, t + 0.32);
          break;
        }
        case 'release': t = this.unleash(view.players[e.p].chain.map((c) => c.id), live, t); break;
        case 'cast': {
          const n = next.get(e.id), show = { ...SHOW(side(e.p)), x: events.some((x) => x.t === 'kiss' || x.t === 'recall') ? -2.2 : 0 };     // a Kiss (or a Shift that recalls a spell) leaves room beside it for the card it takes
          let from;
          if (sc.cards.has(e.id)) from = live(e.id);
          else { const h = handOf(e.p); from = { ...h, y: h.y + 0.1 }; spawn.set(e.id, from); this.flip(e.id, t, 0.28, null, n.key); }
          this.path(e.id, [[0, 'live'], [t, show]]);
          caster = { id: e.id, ready: t + 0.3, end: t + 0.42, show, p: e.p };
          break;
        }
        case 'fireball': case 'shift': case 'rally': case 'kiss': case 'recall': case 'shadow': {
          if (!caster) break;
          const r = caster.ready, a = { x: caster.show.x, y: 0.6, z: caster.show.z };
          if (e.t === 'fireball') {
            const tg = live(e.hit), dir = unit(a, tg), land = r + 0.16;
            this.at(r, () => { const T = sc.cards.get(e.hit); sc.overlay.beam(new THREE.Vector3(a.x, 1.6, a.z), T ? T.root.position.clone().setY(1) : new THREE.Vector3(tg.x, 1, tg.z), { dur: 0.18 }); });
            holdChanged(land, new Set([...defeated, caster.id])); strike(e.hit, land, dir); blow = land; caster.end = land + 0.06;
          } else if (e.t === 'kiss') {
            // The card the Kiss takes is lifted out of its pile (or Chain) and held up beside the spell, so it can be read, and then goes to its new owner.
            const from = live(e.id), to = next.get(e.id), key = spot(e.id)?.key ?? null, reveal = { ...caster.show, x: 2.2 };
            let into = to, id = e.id;
            if (!to) {                                                // it went into a hand we cannot see: the newest card of that hand stands in for it
              const hand = [...next.values()].filter((c) => c.zone === 'hand' && c.owner === caster.p).sort((a, b) => b.order - a.order);
              id = hand[0]?.id; into = id && next.get(id);
              if (into) { if (sc.cards.has(id)) this.at(0, () => sc.cards.get(id)?.snapTo(from, sc.camera.quaternion)); else spawn.set(id, from); this.flip(id, r + 0.62, 0.3, key, null); }
            }
            if (into) {
              this.ring({ card: e.id }, r - 0.1, { grow: 0.18, dur: 0.4 }); this.glow(id, r);
              this.at(r, () => sc.overlay.beam(new THREE.Vector3(from.x, 1, from.z), new THREE.Vector3(reveal.x, 1.8, reveal.z), { dur: 0.22, color: '#e6c8ff' }));
              this.fly(id, reveal, into, r, { lift: 1.2, half: 0.2, via: reveal, linger: 0.6 });
              if (caster.p !== viewer && key) {
                const whose = e.from === viewer ? 'your' : 'their', where = e.zone === 'chain' ? 'Chain' : 'discard pile';
                this.at(r, () => sc.say?.(`Witch’s Kiss takes ${CARDS[key].name} from ${whose} ${where}.`));
              }
            }
            caster.end = r + 0.6 + 0.45;
          } else if (e.t === 'shadow') {
            // The attacker is called out as the spell is held up; its attack follows (the `attack` events after this one), timed from the moment the spell is ready.
            this.glow(e.id, r); this.ring({ card: e.id }, r, { grow: 0.16 });
            caster.lead = r + 0.1; caster.end = r + 0.5;
          } else if (e.t === 'recall') {
            // A spell wound in the enemy's Chain is lifted out, held up beside the Shift, and goes to its owner's hand (a hand we cannot see is stood in for by its newest card).
            const from = live(e.id), to = next.get(e.id), key = spot(e.id)?.key ?? null, reveal = { ...caster.show, x: 2.2 };
            let into = to, id = e.id;
            if (!to) {
              const hand = [...next.values()].filter((c) => c.zone === 'hand' && c.owner === e.from).sort((a, b) => b.order - a.order);
              id = hand[0]?.id; into = id && next.get(id);
              if (into) { if (sc.cards.has(id)) this.at(0, () => sc.cards.get(id)?.snapTo(from, sc.camera.quaternion)); else spawn.set(id, from); this.flip(id, r + 0.62, 0.3, key, null); }
            }
            if (into) {
              this.ring({ card: e.id }, r - 0.1, { grow: 0.18, dur: 0.4 }); this.glow(id, r);
              this.fly(id, reveal, into, r, { lift: 1.2, half: 0.2, via: reveal, linger: 0.6 });
              if (key) this.at(r, () => sc.say?.(`Shift returns ${CARDS[key].name} to ${e.from === viewer ? 'your' : 'their'} hand.`));
            }
            caster.end = r + 0.6 + 0.45;
          } else {
            holdChanged(r, new Set([...defeated, caster.id]));
            const to = e.t === 'rally' || e.t === 'shift' ? e.id : e.to; if (to) { this.glow(to, r + 0.04); this.ring({ card: to }, r + 0.04, { grow: 0.16 }); }
            if (e.t === 'shift' && e.from) this.ring({ card: e.from }, r + 0.04, { grow: 0.16 });       // the card that is no longer guarded
            caster.end = r + 0.32;
          }
          break;
        }
        case 'behind': {                                         // every unguarded creature is hit at once: all flash and ring together, with one push for the lot
          if (!caster) break;
          const land = caster.ready + 0.16;
          holdChanged(land, new Set([...defeated, caster.id]));
          for (const id of e.hits) strike(id, land, null);
          this.at(land, () => sc.nudge(0, 0.45));
          blow = land; caster.end = land + 0.06;
          break;
        }
        case 'attack': {
          const a = live(e.id), tg = live(e.hit), dir = unit(a, tg), far = dist(a, tg) > 5, o = caster?.lead ?? 0;      // a Shadow Step's attack waits for its spell
          if (e.portal) {
            const pid = view.players[next.get(e.id)?.owner ?? prev.get(e.id)?.owner]?.field.find((c) => c.key === 'portal')?.id;
            this.at(o + 0.02, () => { const A = sc.cards.get(e.id), T = sc.cards.get(e.hit); if (A && T) sc.overlay.beam(A.root.position.clone().setY(1), T.root.position.clone().setY(1), { dur: 0.2, color: '#bfe6ff' }); });
            if (pid) { this.glow(pid, o); this.ring({ card: pid }, o); }
            blow = o + 0.24;
          } else if (far) {
            const back = { ...a, x: a.x - dir[0] * 0.8, z: a.z - dir[1] * 0.8, y: 1.0, face: 0 }, hit = { ...a, x: tg.x - dir[0] * 3.1, z: tg.z - dir[1] * 3.1, y: 1.4, face: 0 };
            this.path(e.id, [[o, back, SPRING.follow], [o + 0.12, hit, SPRING.follow]]);
            blow = o + 0.26;
          } else blow = o + 0.06;
          holdChanged(blow, new Set([...defeated, e.id, e.hit]));
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
          this.glow(heart, blow ?? 0.2); this.ring({ card: heart }, blow ?? 0.2, { grow: 0.4, dur: 0.5, alpha: 1 });
          break;
        }
        case 'hit': {                                            // the first blow on a Heart: it turns spent (sideways), with a wider ring after the blow and a line saying so
          const n = next.get(e.id); if (n?.key !== 'heart') break;
          const at = blow ?? 0.2;
          this.ring({ card: e.id }, at + 0.08, { grow: 0.5, dur: 0.65, alpha: 0.9 });
          this.at(at, () => sc.say?.(`${n.owner === viewer ? 'Your' : 'Their'} Heart is spent. Another blow defeats it.`));
          break;
        }
        case 'defeat': {                                         // by a Fireball: the card flies to its pile when the blow lands
          if (blow !== null && caster && !events.some((x) => x.t === 'attack' && x.hit === e.id)) this.fly(e.id, live(e.id), next.get(e.id) ?? live(e.id), blow, { lift: 1.0, half: 0.1 });
          break;
        }
        case 'bonus': this.ring({ card: e.id }, (blow ?? 0.1) + 0.14, { grow: 0.2, dur: 0.4 }); break;
        case 'reguard': if (e.to) { this.glow(e.to, 0.32); this.ring({ card: e.to }, 0.32, { grow: 0.14 }); } break;
        case 'recover': {
          [...prev.values()].filter((c) => c.owner === e.p && c.dim && next.get(c.id) && !next.get(c.id).dim).forEach((c, i) => { this.glow(c.id, 0.05 + i * 0.05); this.ring({ card: c.id }, 0.05 + i * 0.05, { grow: 0.1 }); });
          break;
        }
        case 'win': {
          const loser = view.players[1 - e.p].hearts[0]; if (!loser) break;
          const at = blow ?? 0.2, h = live(loser.id);
          this.glow(loser.id, at); this.ring({ card: loser.id }, at, { grow: 0.5, dur: 0.7, alpha: 1 });
          this.at(at, () => sc.lean(h.x * 0.05, -2.2, h.z * 0.05));        // a slow push in toward the fallen Heart
          break;
        }
        default: break;
      }
    }
    // The spell that was cast goes to its pile once its effect has landed.
    if (caster) { const c = caster; this.path(c.id, [[c.end, null]]); }
    return spawn;
  }
}
