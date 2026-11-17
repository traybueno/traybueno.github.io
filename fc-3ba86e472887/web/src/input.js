/**
 * Pointer input: drag a card to a target, or tap a card and then a target (the same thing, for touch). Only what the engine offers is ever lit or
 * accepted. A drop on a legal target makes that move (asking a second question in place if the move is not yet complete); a drop anywhere else lets
 * the card go back where it came from.
 */
import { CARDS, isGuarded, locate } from '../../src/index.js';
import { analyze, dropsOf, nextStep, dropKey } from './actions.js';
import { fieldZone, pileZone, slotRect } from './layout.js';

const MOVE_PX = 7;
const inRect = (p, r, m = 0.5) => Math.abs(p.x - r.x) <= r.w / 2 + m && Math.abs(p.z - r.z) <= r.d / 2 + m;
const nameOf = (view, id) => { const c = locate(view, id)?.card; return c ? CARDS[c.key].name : 'it'; };

export class Input {
  /** `cb`: { onMove(move), onFan(ownerIndex | null), onChange(), onPreview(cardKey | null) }. */
  constructor(scene, cb) {
    this.scene = scene; this.cb = cb; this.enabled = true;
    this.ctx = null; this.sources = new Map(); this.buttons = {};
    this.sel = null; this.drops = null; this.drag = null; this.down = null; this.choice = null; this.focus = null; this.hintText = '';
    this.carryY = 1; this.grab = { dx: 0, dz: 0 };
    const el = scene.canvas;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', () => this.reset());
    el.addEventListener('pointerleave', () => { this.scene.hover = null; this.cb.onPreview(null); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.cancel(); });
  }

  /** The game changed: what can be done now. Anything half done is dropped. */
  setContext({ view, moves, seat }) {
    this.ctx = { view, moves, seat };
    const { sources, buttons } = analyze(view, moves, seat);
    this.sources = sources; this.buttons = buttons;
    this.reset();
  }
  reset() {
    this.scene.drag = null; this.scene.hover = null; this.scene.press = null;
    this.sel = null; this.drops = null; this.drag = null; this.down = null; this.choice = null; this.focus = null;
    this.scene.setGap(this.seat, null);
    this.cb.onFan(null); this.refresh();
  }
  cancel() { if (this.sel || this.choice || this.drag) this.reset(); }
  get seat() { return this.ctx?.seat; }

  // ---- what the pointer is over -----------------------------------------------------------------------------------------------------------
  sourceAt(ndc) { for (const h of this.scene.cardsAt(ndc)) if (this.sources.has(h.card.id)) return h.card.id; return null; }
  slotOf(drop) { return this.scene.layout.slots.find((s) => s.owner === drop.owner && s.index === drop.index); }
  /** The table rectangle of a drop that is not a card. */
  rectOf(drop) { return drop.type === 'slot' ? slotRect(this.slotOf(drop)) : drop.type === 'pile' ? pileZone(drop.owner === this.seat ? 1 : -1) : fieldZone(1); }
  /** A drop was accepted: a quick flash on what it landed on. */
  landed(key) {
    const { drop } = this.drops.get(key);
    if (drop.type === 'card') this.scene.flash(drop.id); else this.scene.overlay.pulse({ rect: this.rectOf(drop) });
  }
  /** The drop key under the pointer, among the places the selected card can go (cards first, then Chain slots, discard piles, the field). */
  targetAt(ndc, skip = null) {
    if (!this.drops) return null;
    for (const h of this.scene.cardsAt(ndc, skip)) { const k = dropKey.card(h.card.id); if (this.drops.has(k)) return k; }
    const pt = this.scene.pointAt(ndc, 0.05); if (!pt) return null;
    for (const order of ['slot', 'pile', 'field']) for (const [key, { drop }] of this.drops) {
      if (drop.type !== order) continue;
      if (inRect(pt, this.rectOf(drop))) return key;
    }
    return null;
  }
  /** While a second choice is open: the option under the pointer, as the moves it leaves. */
  optionAt(ndc) {
    const st = this.choice.step;
    for (const h of this.scene.cardsAt(ndc)) {
      if (st.kind === 'arrange') { if (h.card.id === this.choice.src) return [st.keep]; if (st.others.includes(h.card.id)) return [st.swap]; }
      else { const o = st.options.find((x) => x.id === h.card.id); if (o) return o.moves; }
    }
    return null;
  }

  // ---- pointer events ---------------------------------------------------------------------------------------------------------------------
  onDown(e) {
    if (!this.enabled || !this.ctx) return;
    this.scene.canvas.setPointerCapture?.(e.pointerId);
    const ndc = this.scene.ndc(e);
    this.down = { x: e.clientX, y: e.clientY, src: this.sourceAt(ndc) };
    this.scene.press = this.down.src;                                    // the card dips a little under the press
  }
  onMove(e) {
    if (!this.enabled || !this.ctx) return;
    const ndc = this.scene.ndc(e);
    if (this.down?.src && !this.drag && !this.choice && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > MOVE_PX) this.startDrag(this.down.src, ndc);
    if (this.drag) {
      this.carry(ndc);
      const f = this.targetAt(ndc, this.drag); if (f !== this.focus) { this.focus = f; this.refresh(); }
      this.makeRoom(f, this.scene.drag?.x);
      return;
    }
    this.hover(ndc);
  }
  onUp(e) {
    if (!this.enabled || !this.ctx || !this.down) return;
    const down = this.down, ndc = this.scene.ndc(e); this.down = null;
    this.scene.press = null;
    if (this.drag) return this.drop(ndc);
    this.click(ndc, down.src);
  }

  hover(ndc) {
    const top = this.scene.cardsAt(ndc)[0];
    this.cb.onPreview(top?.card.key ?? null);                           // a big copy of whatever face-up card the pointer is on
    this.scene.hover = top && top.card.key ? { id: top.card.id } : null;      // any face-up card: a small lift, and its preview
    let useful = !!this.sourceAt(ndc);
    if (this.choice) useful = !!this.optionAt(ndc); else if (this.sel) useful = useful || !!this.targetAt(ndc, this.sel);
    this.scene.canvas.style.cursor = useful ? 'pointer' : 'default';
    const f = this.choice ? (this.optionAt(ndc) ? 'opt' : null) : this.sel ? this.targetAt(ndc, this.sel) : null;
    if (f !== this.focus && (this.choice || this.sel)) { this.focus = f; this.refresh(); }
    if (this.sel && !this.choice) this.makeRoom(f, this.scene.pointAt(ndc)?.x);       // a card picked up by a tap: the row opens under the pointer
  }
  /** Where a creature would stand if dropped on the field at `x`: the row opens a gap there (and closes again anywhere else). */
  makeRoom(key, x) {
    const d = key && this.drops?.get(key), deploys = d && d.drop.type === 'field' && d.moves.some((m) => m.type === 'deploy');
    this.scene.setGap(this.seat, deploys ? x : null);
  }
  /** The card is about to be played at `x` on the field: remember where, so it stands there. */
  placed(move, id, x) { if (move.type === 'deploy' && move.dest === 'open' && x !== undefined) this.scene.placing = { owner: this.seat, id, x }; }

  startDrag(id, ndc) {
    this.select(id);
    this.drag = id; this.scene.hover = null; this.scene.press = null; this.cb.onPreview(null);
    // The card is carried by the point it was grabbed at, a little above where it lay, and does not jump to the pointer.
    const c = this.scene.cards.get(id); this.carryY = Math.max(0.9, c.s.y.x);
    const p = this.scene.pointAt(ndc, this.carryY); this.grab = p ? { dx: c.s.x.x - p.x, dz: c.s.z.x - p.z } : { dx: 0, dz: 0 };
    this.carry(ndc);
  }
  carry(ndc) { const p = this.scene.pointAt(ndc, this.carryY); if (p) this.scene.drag = { id: this.drag, x: p.x + this.grab.dx, y: this.carryY, z: p.z + this.grab.dz }; }
  drop(ndc) {
    const id = this.drag, key = this.targetAt(ndc, id), x = this.scene.drag?.x;      // (the card's centre, where it was let go)
    this.scene.drag = null; this.drag = null; this.focus = null;
    if (key) { this.landed(key); return this.resolve(this.drops.get(key).moves, id, x); }
    this.blocked(ndc, id);
    this.scene.setGap(this.seat, null);                                 // the row closes up again
    this.sel = null; this.drops = null; this.refresh();                 // the card goes back to where it came from (its spring takes it)
  }
  click(ndc, src) {
    if (this.choice) {
      const moves = this.optionAt(ndc);
      if (moves) return this.resolve(moves, this.choice.src);
      return this.cancel();
    }
    if (this.sel) {
      const key = this.targetAt(ndc, this.sel);
      if (key) { this.landed(key); return this.resolve(this.drops.get(key).moves, this.sel, this.scene.pointAt(ndc)?.x); }
      if (src && src !== this.sel) return this.select(src);
      return this.cancel();
    }
    if (src) this.select(src);
  }
  select(id) {
    this.sel = id; this.drops = dropsOf(this.ctx.view, this.sources.get(id), this.seat); this.focus = null; this.refresh();
  }
  /** A drop on a guarded card by something that attacks or hits: it blocks, with a flash. (Front end only: the engine never offers it.) */
  blocked(ndc, id) {
    const moves = this.sources.get(id) ?? [];
    if (!moves.some((m) => m.type === 'attack' || m.type === 'fireball')) return;
    const h = this.scene.cardsAt(ndc, id)[0], c = h && locate(this.ctx.view, h.card.id)?.card;
    if (c && isGuarded(this.ctx.view, c)) this.scene.flash(c.id);
  }

  /** A drop or a pick has left `moves`: make the one move, or ask the next question in place. */
  resolve(moves, src, x) {
    const step = nextStep(moves);
    if (step.kind === 'commit') { const m = step.move; this.reset(); this.placed(m, src, x); this.cb.onMove(m); return; }
    this.choice = { step, src }; this.sel = src; this.drops = null; this.focus = null;
    const first = step.kind === 'card' ? locate(this.ctx.view, step.options[0].id) : null;
    this.cb.onFan(first && first.zone === 'discard' ? first.p.idx : null);
    this.refresh();
  }

  // ---- what is lit ----------------------------------------------------------------------------------------------------------------------
  refresh() {
    const sc = this.scene, w = new Map(), card = (id, level) => { const b = sc.cardBracket(id, level); if (b) w.set(dropKey.card(id), b); };
    const view = this.ctx?.view;
    if (!view) { sc.setBrackets(w); return; }
    if (this.choice) {
      const st = this.choice.step;
      if (st.kind === 'arrange') {
        card(this.choice.src, 'idle');
        for (const id of st.others) card(id, 'idle');
        this.hintText = 'Tap the spell in your hand to wind it as it is, or tap one of the wound spells to swap their places.';
      } else {
        for (const o of st.options) card(o.id, 'idle');
        this.hintText = st.kind === 'card' ? (st.options[0].moves[0].type === 'shadow' ? 'Choose what it attacks.' : 'Choose the card to take.') : st.options.some((o) => o.moves[0].dest === 'none') ? 'Choose where the Guardian goes, or tap it again to move it off its card.' : 'Choose where it goes.';
      }
    } else if (this.sel && this.drops) {
      for (const [key, { drop }] of this.drops) {
        const level = this.focus === key ? 'focus' : 'idle';
        if (drop.type === 'card') card(drop.id, level);
        else if (drop.type === 'slot') { const s = this.slotOf(drop); if (s) w.set(key, sc.rectBracket(slotRect(s), level)); }
        else if (drop.type === 'pile') w.set(key, sc.rectBracket(pileZone(drop.owner === this.seat ? 1 : -1), level));
        else w.set(key, sc.rectBracket(fieldZone(1), level));
      }
      this.hintText = '';
    } else {
      for (const id of this.sources.keys()) card(id, 'ready');            // on your turn, whatever can be moved is marked, and the marks pulse gently
      this.hintText = '';
    }
    if (this.choice && this.focus === 'opt') { /* the pointer is on an option: its bracket is already shown */ }
    sc.setBrackets(w); this.cb.onChange();
  }
}
