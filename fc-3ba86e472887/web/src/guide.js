/**
 * Learn to play's demonstration mouse: a pixel cursor in the table's cream that shows the move the story is asking for. When the player has not acted for
 * a moment, it presses on the card to use, carries a dashed outline of it to where it goes, and lets go; for a move made with a button (Release, Recover,
 * End Turn, and Continue under a line to read) it goes to the button and clicks it. It loops until the player acts. It reads only what the pointer input already knows (the cards that can
 * be picked up and where each can go, from actions.js), so it can only ever show a move the engine offers. Plain DOM over the canvas; no input of its own.
 *
 *   const guide = createGuide(scene, input);   guide.set(on)   on: show it for the moves the input now offers (false hides it)
 */
import { dropsOf } from './actions.js?v=8059ec6';
import { slotRect, pileZone, fieldZone } from './layout.js?v=8059ec6';

// A classic arrow pointer drawn on a pixel grid: 1 is the outline, 2 the fill.
const ARROW = [
  '1', '11', '121', '1221', '12221', '122221', '1222221', '12222221', '122222221', '1222222221', '12222211111', '1221221', '121 1221', '11  1221', '1    1221', '     1221', '      11',
];
const PX = 2.5;
function cursorSvg() {
  const w = 11, h = ARROW.length, rects = [];
  ARROW.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '1' || ch === '2') rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${ch === '1' ? '#060508' : '#ece2bd'}"/>`); }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * PX}" height="${h * PX}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const centre = (pts) => pts && { x: pts.reduce((a, p) => a + p[0], 0) / 4, y: pts.reduce((a, p) => a + p[1], 0) / 4, w: Math.abs(pts[1][0] - pts[0][0]), h: Math.abs(pts[3][1] - pts[0][1]) };

export function createGuide(scene, input) {
  const root = Object.assign(document.createElement('div'), { className: 'guide' });
  const ghost = Object.assign(document.createElement('div'), { className: 'gghost' });
  const ring = Object.assign(document.createElement('div'), { className: 'gring' });
  const cur = Object.assign(document.createElement('div'), { className: 'gcur', innerHTML: cursorSvg() });
  root.append(ghost, ring, cur); document.body.append(root);
  let on = false, since = performance.now(), key = '';
  // The player acting (pressing anywhere) puts it away; it comes back after a pause if the move is still not made.
  addEventListener('pointerdown', () => { since = performance.now() + 1500; }, { capture: true });

  const corners = (it) => scene.overlay.corners(it);
  /** Where a drop lands, on screen. */
  function dropAt(drop, seat) {
    if (drop.type === 'card') return centre(corners({ card: drop.id }));
    if (drop.type === 'slot') { const s = scene.layout.slots.find((x) => x.owner === drop.owner && x.index === drop.index); return s && centre(corners({ rect: slotRect(s) })); }
    if (drop.type === 'pile') return centre(corners({ rect: pileZone(drop.owner === seat ? 1 : -1) }));
    return centre(corners({ rect: fieldZone(1) }));
  }
  /** What to show now: a drag from a card to its first drop, or a click on a button. */
  function plan() {
    const ctx = input.ctx; if (!ctx || input.drag || input.choice) return null;
    const id = input.auto ?? [...input.sources.keys()][0];
    if (id) {
      const first = [...dropsOf(ctx.view, input.sources.get(id), ctx.seat).values()][0]?.drop, a = centre(corners({ card: id })), b = first && dropAt(first, ctx.seat);
      return a && b ? { drag: true, a, b, key: `${id}>${JSON.stringify(first)}` } : null;
    }
    for (const name of ['cont', 'release', 'recover', 'end', 'skip']) {
      if (name === 'cont' ? !document.querySelector('.bar .btn.cont:not([hidden])') : !input.buttons[name]) continue;
      const el = document.querySelector(`.bar .btn.${name}`), r = el?.getBoundingClientRect();
      if (r && r.width) { const b = { x: r.left + r.width * 0.62, y: r.top + r.height * 0.6 }; return { drag: false, a: { x: b.x - 70, y: b.y + 60 }, b, key: name }; }
    }
    return null;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const p = on && now > since ? plan() : null;
    if (!p) { root.style.opacity = 0; return; }
    if (p.key !== key) { key = p.key; since = Math.max(since, now + 600); return; }     // a new move to show: a short beat first, so the player can try it themselves
    const t = ((now - since) / 1000) % 3.1;
    let x, y, press = 0, carry = 0, alpha;
    if (p.drag) {
      const u = ease(clamp01((t - 0.55) / 1.1));
      x = p.a.x + (p.b.x - p.a.x) * u; y = p.a.y + (p.b.y - p.a.y) * u;
      press = t > 0.35 && t < 1.8 ? 1 : 0; carry = t > 0.45 && t < 1.85 ? 1 : 0;
      alpha = t < 0.3 ? t / 0.3 : t < 1.9 ? 1 : 1 - clamp01((t - 1.9) / 0.4);
      ghost.style.width = `${p.a.w * 0.9}px`; ghost.style.height = `${p.a.h * 0.9}px`;
    } else {
      const u = ease(clamp01((t - 0.2) / 0.8));
      x = p.a.x + (p.b.x - p.a.x) * u; y = p.a.y + (p.b.y - p.a.y) * u;
      press = t > 1.05 && t < 1.25 ? 1 : 0; carry = 0;
      alpha = t < 0.2 ? t / 0.2 : t < 1.5 ? 1 : 1 - clamp01((t - 1.5) / 0.4);
    }
    root.style.opacity = alpha;
    cur.style.transform = `translate(${x - 2}px, ${y - 2}px) scale(${press ? 0.86 : 1})`;
    ring.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${press ? 1 : 0.4})`; ring.style.opacity = press;
    ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; ghost.style.opacity = carry;
  }
  requestAnimationFrame(frame);
  return {
    /** Show the demonstration for the moves on offer (`true`), or put it away. A fresh `true` waits a moment before it starts. */
    set(show) { if (show && !on) since = performance.now() + 1400; on = show; },
  };
}
