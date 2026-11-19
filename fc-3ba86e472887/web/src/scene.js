/**
 * The Three.js scene: renderer, camera, the table and the cards on it. `show(view, viewer)` makes the scene match a view of the game; the frame loop
 * moves the cards by springs and draws the corner marks. The scene also answers where the pointer is: which cards are under it, and what point of the table.
 */
import * as THREE from 'three';
import { Card, SPRING } from './card.js?v=ad16557';
import { Table } from './table.js?v=ad16557';
import { Overlay } from './overlay.js?v=ad16557';
import { layout, rowIndexAt, VIEW as VIEW_DESK, PHONE_VIEW, TABLE, setPhoneHand } from './layout.js?v=ad16557';
import { phone } from './phone.js?v=ad16557';
import { Fx } from './fx.js?v=ad16557';
import { protector, inForce, affects } from '../../src/index.js?v=ad16557';
import { portalPulse } from './overlay.js?v=ad16557';

const CAMERA_TILT = 23;                                     // degrees off straight-down

export class Scene {
  constructor(canvas) {
    this.art = null; this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
    this.table = new Table(); this.scene.add(this.table.group);
    this.overlay = new Overlay(this);
    this.cards = new Map();                                 // card id -> Card
    this.layout = { cards: [], slots: [], numerals: [] };
    this.hover = null;                                      // { id }: the face-up card under the pointer
    this.press = null;                                      // id of the card the pointer is down on
    this.drag = null;                                       // { id, x, y, z }: the card being carried and where it is carried to
    this.picked = null;                                     // id of the card picked up by a tap (held up while its target is chosen)
    this.view = null; this.viewer = 0; this.gather = null;
    this.poses = new Map();                                 // card id -> where the layout puts it (the last layout, so a move can be told from what it changed)
    this.row = [[], []];                                    // each player's row as it stands, left to right: [{ id, x }]. A card the player drops on the field stays where it was put.
    this.placing = null;                                    // { owner, id, x }: the card just dropped on the field, and where (the next `show` puts it in the row there)
    this.gap = null;                                        // { owner, index }: a place held open in a row for the card being carried
    this.idle = new Map();                                  // device id -> { key, ids, color, w }: a standing effect in force and the cards it acts on; w eases 0..1 (it fades in and out)
    this.quiet = new Map();                                 // card id -> 0..1: 0 while the move playing now moves or marks that card (its idle effect steps aside), back to 1 after
    this.idleT = 0;                                         // the idle effects' shared clock (a Keeper and the creatures it lights flicker on the same beat)
    this.lifted = new Set();                                // the cards raised because the hovered card is under their standing effect (see step)
    this.haloHold = new Set();                              // Hearts whose ring stays a moment longer (an Angel is about to be defeated saving them)
    this.camBase = new THREE.Vector3(); this.cam = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0, tz: 0, k: 220 };   // a small push on the camera
    this.fx = new Fx(this);
    this.ray = new THREE.Raycaster();
    this.resize(); window.addEventListener('resize', () => this.resize());
    // A window resize event is not the only way the canvas changes size (browser zoom, a docked panel, full screen, a move to another screen): watch the canvas itself.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(canvas);
    this.last = performance.now(); requestAnimationFrame((t) => this.frame(t));
  }
  /** The art needs the renderer (for texture settings), so it arrives after the scene exists. */
  setArt(art) { this.art = art; }
  /**
   * Frame the table and the viewer's raised hand, with the camera tipped off straight-down so the far side is a little smaller and the near side (the
   * hand) a little larger. The camera backs off until every corner of the framed box is inside the view.
   */
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.size = { w, h, dpr: window.devicePixelRatio || 1 };
    this.renderer.setPixelRatio(Math.min(this.size.dpr, 2));
    this.renderer.setSize(w, h, false);
    const cam = this.camera; cam.aspect = w / h;
    // A phone held sideways frames the table closer and holds a larger hand (layout.js PHONE_VIEW); a desktop never does.
    const close = phone && w > h, VIEW = close ? PHONE_VIEW : VIEW_DESK;
    if (close !== this.close) { this.close = close; setPhoneHand(close); if (this.view) this.show(this.view, this.viewer, { snap: false, gather: this.gather, held: this.held }); }
    const tilt = THREE.MathUtils.degToRad(CAMERA_TILT), target = new THREE.Vector3(0, 0, (VIEW.zMin + VIEW.zMax) / 2 + 0.6);
    const corners = [-1, 1].flatMap((sx) => [VIEW.zMin, VIEW.zMax].flatMap((z) => [0, 2.2].map((y) => new THREE.Vector3(sx * VIEW.w / 2, y, z))));
    const fits = (d) => {
      cam.position.set(0, Math.cos(tilt) * d, Math.sin(tilt) * d).add(target); cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      return corners.every((c) => { const p = c.clone().project(cam); return Math.abs(p.x) <= 0.985 && Math.abs(p.y) <= 0.985; });
    };
    let lo = 10, hi = 400;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi); this.camBase.copy(cam.position);
    // Where the table's left edge and its middle line fall on the screen, for the page around the canvas (the reference card sits in the margin there).
    const edge = new THREE.Vector3(-TABLE.w / 2, 0, 0).project(cam), root = document.documentElement.style;
    root.setProperty('--table-left', `${((edge.x + 1) / 2) * w}px`); root.setProperty('--table-mid', `${((1 - edge.y) / 2) * h}px`);
  }

  /**
   * Make the scene match `view`, as seen by `viewer`. `snap` puts every card straight in place (a change of seat); `gather`: the ids of the cards a Witch's Kiss can take, brought up into one row.
   * `events` are the events of the move that led here (from the same view): they say how the cards got where they are, and the motion plays from them.
   */
  show(view, viewer, { snap = false, gather = null, held = null, events = null } = {}) {
    if (gather?.length) this.lastGather = gather;           // the cards a Witch's Kiss laid out: the move that takes one fades the others back (fx.js)
    this.view = view; this.viewer = viewer; this.gather = gather; this.held = held; this.gap = null;
    const order = this.row.map((r) => r.map((e) => e.id));
    if (this.placing) {                                      // a card dropped on the field takes the place it was dropped at, among the cards already standing
      const { owner, id, x } = this.placing; this.placing = null;
      const joins = view.players[owner].field.some((c) => c.id === id && !(c.key === 'guardian' && c.guards));
      if (joins && !order[owner].includes(id)) order[owner].splice(rowIndexAt(this.row[owner], x), 0, id);
    }
    const L = layout(view, viewer, { gather, order, held }), next = new Map(L.cards.map((p) => [p.id, p]));
    this.row = L.rows;
    this.fx.flush();                                        // whatever the last move was still doing is finished off at once
    const spawn = events && !snap ? this.fx.plan(events, this.poses, next, view, viewer) : new Map();
    this.layout = L; this.poses = next;
    // A ring marks a standing effect that is in force: the Heart an Angel would save, and every Warp Portal, Heaven's Resolve and ready Lantern Keeper.
    // Each standing effect in force idles, in its card's colour, with the cards it acts on (engine `affects`); an Angel's shows on the Heart it would save.
    const want = new Map(view.players.flatMap((P) => P.field.filter((c) => inForce(view, c)).map((c) => [c.id, { key: c.key, ids: affects(view, c) }])).filter(([, d]) => d.key !== 'angel' || d.ids.length));
    for (const [id, d] of this.idle) if (!want.has(id)) d.gone = true;
    for (const [id, d] of want) { const o = this.idle.get(id); if (o) Object.assign(o, d, { gone: false }); else this.idle.set(id, { ...d, color: this.fx.tint(d.key), w: 0, gone: false }); }
    this.halos = new Set(view.players.flatMap((P) => [...(protector(view, P.idx) && P.hearts[0] ? [P.hearts[0].id] : []), ...P.field.filter((c) => c.key !== 'angel' && inForce(view, c)).map((c) => c.id)]));
    this.table.setTurn(view.turn === viewer ? 1 : -1, snap);
    this.applyLayout(snap, spawn); this.table.place(L);
    this.fx.update(0);                                      // what starts at once starts before the first frame
  }
  haloIds() { return new Set(); }                          // the thin standing-effect outline is switched off for now (the effect rings that flash when something happens are separate)
  /** Remove every card (a new game). */
  clear() { for (const c of this.cards.values()) this.scene.remove(c.root); this.cards.clear(); this.poses = new Map(); this.row = [[], []]; this.placing = this.gap = this.lastGather = null; this.fx.flush(); this.hover = this.drag = this.press = this.picked = null; }
  /**
   * While a creature is carried over the field: the cards in `owner`'s row open a gap where it would go if dropped with its centre at `x` (as the owner sees
   * the table), and close up again for `null`. Only the row moves; nothing else is laid out again.
   */
  setGap(owner, x) {
    if (!this.view) return;
    const gap = x === null || x === undefined ? null : { owner, index: rowIndexAt(this.row[owner] ?? [], x) };
    if (gap?.index === this.gap?.index && gap?.owner === this.gap?.owner) return;
    this.gap = gap;
    const L = layout(this.view, this.viewer, { gather: this.gather, held: this.held, order: this.row.map((r) => r.map((e) => e.id)), gap });
    for (const p of L.cards) { const c = this.cards.get(p.id); if (c && p.zone === 'field' && c.base) c.base = p; }
  }
  applyLayout(snap, spawn) {
    const L = this.layout, seen = new Set();
    for (const p of L.cards) {
      seen.add(p.id);
      let c = this.cards.get(p.id), fresh = false;
      if (!c) { c = new Card(this.art, p.id); this.cards.set(p.id, c); this.scene.add(c.root); fresh = true; }
      c.base = p; c.show(p.key);
      c.aim(this.poseOf(c)); if (fresh || snap) c.snap(this.camera.quaternion);
      if (fresh && !snap && spawn.has(p.id)) c.snapTo(spawn.get(p.id), this.camera.quaternion);
    }
    for (const [id, c] of this.cards) if (!seen.has(id)) {
      this.scene.remove(c.root); this.cards.delete(id);
      if (this.hover?.id === id) this.hover = null;
      if (this.drag?.id === id) this.drag = null;
    }
  }
  /** A card's base placement with any hover, press or drag change laid over it. Quiet on purpose: a small lift on hover, a dip when pressed, a slightly larger card when carried. */
  poseOf(c) {
    const b = c.base, p = { ...b };
    c.boost = 0;
    if (this.drag?.id === c.id) { Object.assign(p, { x: this.drag.x, y: this.drag.y, z: this.drag.z, spin: 0, face: 1, scale: b.scale * 1.04 }); c.boost = 4000; }
    else if (c.held) { Object.assign(p, c.held.pose); c.boost = 600; }                // part of a move being played: it goes where the move takes it
    else if (this.picked === c.id) {                                                  // picked up by a tap: it stands up clearly above its place until the exchange ends
      const near = b.yaw === 0 ? 1 : -1;
      if (b.zone === 'hand') Object.assign(p, { y: b.y + 0.9, z: b.z - near * 0.75, scale: b.scale * 1.1, spin: 0 });
      else Object.assign(p, { y: b.y + 0.8, scale: b.scale * 1.12, face: Math.max(b.face ?? 0, 0.35) });
      c.boost = 1200;
    }
    else if (this.press === c.id) Object.assign(p, { scale: b.scale * 0.97 });
    else if (this.hover?.id === c.id) {
      const near = b.yaw === 0 ? 1 : -1;
      if (b.zone === 'hand') Object.assign(p, { y: b.y + 0.5, z: b.z - near * 0.4, scale: b.scale * 1.05, spin: 0 });     // straightens and lifts a little
      else Object.assign(p, { y: b.y + 0.3, scale: b.scale * 1.04 });
      c.boost = 1000;
    }
    else if (this.lifted.has(c.id)) { Object.assign(p, { y: b.y + 0.55, scale: b.scale * 1.06 }); c.boost = 900; }     // a card whose standing effect acts on the hovered card rises with it
    return p;
  }
  /** Advance every card's motion by `dt` seconds. */
  step(dt) {
    this.fx.update(dt); this.table.update(dt); this.moveCamera(dt);
    this.stepIdle(dt);
    // Hovering a card raises the cards whose standing effects act on it now (engine `affects`, via the idle list): the Lantern Keeper lighting a spent
    // creature, the Heaven's Resolve behind an attacker, the enemy Warp Portal a Guardian no longer stops, the Angel guarding a Heart.
    const h = !this.drag && !this.picked ? this.hover?.id : null;
    this.lifted = new Set(h ? [...this.idle].filter(([id, d]) => !d.gone && id !== h && d.ids.includes(h)).map(([id]) => id) : []);
    for (const c of this.cards.values()) {
      if (!c.base) continue;
      c.aim(this.poseOf(c), this.drag?.id === c.id ? SPRING.follow : c.held ? c.held.spring : this.hover?.id === c.id || this.lifted.has(c.id) ? SPRING.hover : SPRING.settle);
      if (this.drag?.id === c.id) { c.s.x.x = c.s.x.t; c.s.z.x = c.s.z.t; c.s.x.v = c.s.z.v = 0; }      // a carried card sits exactly where the pointer puts it: no lag
      c.update(dt, this.camera.quaternion);
    }
  }
  /**
   * The idle effects: each device's weight eases toward 1 while it is in force (0 once it is gone), each card's `quiet` toward 0 while the move playing now
   * involves it, and a Guardian a Warp Portal passes thins a little once each turn of the Portal's swirl (see overlay.js `idle` for the pixels).
   */
  stepIdle(dt) {
    this.idleT += dt;
    const busy = this.fx.busy ? this.fx.ids : null, e = (r) => 1 - Math.exp(-dt * r);
    for (const [id, d] of this.idle) { d.w += ((d.gone ? 0 : 1) - d.w) * e(d.gone ? 8 : 5); if (d.gone && d.w < 0.01) this.idle.delete(id); }
    const seen = new Set([...this.idle.keys(), ...[...this.idle.values()].flatMap((d) => d.ids)]);
    for (const id of seen) { const q = this.quiet.get(id) ?? 0; this.quiet.set(id, q + ((busy?.has(id) ? 0 : 1) - q) * e(busy?.has(id) ? 10 : 5)); }
    for (const id of this.quiet.keys()) if (!seen.has(id)) this.quiet.delete(id);
    const thin = new Map();
    for (const [pid, d] of this.idle) if (d.key === 'portal') d.ids.forEach((gid, i) => thin.set(gid, Math.max(thin.get(gid) ?? 0, d.w * this.idleOf(pid, gid) * 0.17 * portalPulse(this.idleT, i))));
    for (const c of this.cards.values()) c.idleFade = 1 - (thin.get(c.id) ?? 0);
  }
  /** How strongly an idle effect shows on `id`: the device's own weight aside, 0 while the move playing now involves the card or its device. */
  idleOf(device, id) { return (this.quiet.get(device) ?? 0) * (id === device ? 1 : this.quiet.get(id) ?? 0); }
  /** A small push on the camera: it moves `dx, dz` and eases back (an impact); `lean` instead holds it moved (a slow push in). */
  nudge(dx, dz) { const v = Math.sqrt(this.cam.k) * Math.E; this.cam.vx += dx * v; this.cam.vz += dz * v; }
  lean(dx, dy, dz) { Object.assign(this.cam, { tx: dx, ty: dy, tz: dz, k: dx || dy || dz ? 14 : 220 }); }
  moveCamera(dt) {
    const c = this.cam, d = 2 * Math.sqrt(c.k);
    for (const a of ['x', 'y', 'z']) { c['v' + a] += (c.k * (c['t' + a] - c[a]) - d * c['v' + a]) * dt; c[a] += c['v' + a] * dt; }
    this.camera.position.set(this.camBase.x + c.x, this.camBase.y + c.y, this.camBase.z + c.z);
  }
  /** Run the motion forward `seconds` at once (tests and screenshots use this; a slow machine would otherwise show cards mid-move). */
  settle(seconds = 1) { for (let t = 0; t < seconds; t += 1 / 60) this.step(1 / 60); }
  frame(t) {
    const dt = Math.min(0.033, (t - this.last) / 1000); this.last = t;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.overlay.draw(dt);
    requestAnimationFrame((n) => this.frame(n));
  }

  // ---- the pointer ---------------------------------------------------------------------------------------------------------------------------
  ndc(e) {
    // The view must match the canvas as it is right now; if a size change was missed, catch up before reading the pointer.
    if (this.canvas.clientWidth !== this.size.w || this.canvas.clientHeight !== this.size.h || (window.devicePixelRatio || 1) !== this.size.dpr) this.resize();
    const r = this.canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  }
  /** The cards under the pointer, nearest first: [{ card, u, v }]. `skip` is a card id to ignore (the one being carried). */
  cardsAt(ndc, skip = null) {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(ndc, this.camera);
    const fronts = [...this.cards.values()].filter((c) => c.id !== skip).map((c) => c.front);
    // The card drawn on top wins, which is not always the nearest in space (cards face the camera and are layered by height).
    return this.ray.intersectObjects(fronts, false).map((h) => ({ card: h.object.userData.card, u: h.uv?.x ?? 0.5, v: h.uv?.y ?? 0.5 })).sort((a, b) => b.card.order - a.card.order);
  }
  /** Where the pointer's ray meets the horizontal plane at height `y`: { x, z }. */
  pointAt(ndc, y = 0.05) {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  // ---- marks and flashes ---------------------------------------------------------------------------------------------------------------------
  /** A mark entry for a card, or for a rectangle on the table. `level` is 'idle' or 'focus'. */
  cardBracket(id, level) { return this.cards.has(id) ? { level, card: id } : null; }
  rectBracket(rect, level) { return { level, rect }; }
  setBrackets(wanted) { this.overlay.set(wanted); }
  flash(id) { this.cards.get(id)?.flash(); }
}
