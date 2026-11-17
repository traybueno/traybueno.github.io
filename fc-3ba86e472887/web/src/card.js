/**
 * One card on the table. A card in the hand, or one being carried, faces the camera, so it is a clean rectangle that is easy to read. A card that has been played
 * lies on the table at the table's own angle, so it sits properly in its slot or pile. It has the art on its face, a soft shadow that grows
 * with how high the card is lifted, so a lifted card reads as lifted and overlapping cards read as layers. Moved by critically damped springs.
 * `aim` sets where it should be (a placement from layout.js plus any hover or drag change); each frame `update` carries it there.
 */
import * as THREE from 'three';
import { CARD_W, CARD_H } from './layout.js';

const R = 0.14;
function rounded(w, h, r) {
  const s = new THREE.Shape(); w /= 2; h /= 2;
  s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r); s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}
let shared;
function resources() {
  if (shared) return shared;
  const face = new THREE.ShapeGeometry(rounded(CARD_W, CARD_H, R), 6), pos = face.attributes.position, uv = face.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);   // the art spans the whole card
  // The shadow is a soft-edged rounded rectangle made once on a canvas (a shadow blur needs no filter support).
  const c = document.createElement('canvas'); c.width = 128; c.height = 192; const g = c.getContext('2d');
  g.shadowColor = '#000'; g.shadowBlur = 18; g.shadowOffsetX = 4000; g.fillStyle = '#000'; g.beginPath(); g.roundRect(26 - 4000, 38, 76, 116, 8); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return (shared = { face, shadowGeo: new THREE.PlaneGeometry(CARD_W * 1.6, CARD_H * 1.45), shadowTex: tex });
}

class Spring {
  constructor(v = 0) { this.x = v; this.v = 0; this.t = v; }
  step(dt, k, c) { this.v += (k * (this.t - this.x) - c * this.v) * dt; this.x += this.v * dt; }
}
const AXES = ['x', 'y', 'z', 'yaw', 'spin', 'scale', 'face'];
/** Spring settings: how stiff, and how damped. Critically damped (damping = 2 sqrt(stiffness)), so a card arrives quickly and stops without wobbling. */
const crit = (k) => [k, 2 * Math.sqrt(k)];
export const SPRING = { settle: crit(520), follow: crit(1400), hover: crit(1000) };

const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const qFace = new THREE.Quaternion(), qFlat = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
/** Light comes from the top left of the screen: how far the edge and shadow fall, in card units, for a card `h` above the table. */
const EDGE = [0.075, -0.075], SHADOW = (h) => [0.1 + 0.15 * h, -(0.16 + 0.2 * h)];

export class Card {
  /** `art` is what loadArt returned. */
  constructor(art, id) {
    this.art = art; this.id = id; this.key = undefined; this.base = null; this.dim = 1; this.flashT = 0; this.spring = SPRING.settle; this.boost = 0; this.order = 0;
    this.held = null;                  // { pose, spring }: a pose the card is kept at for now (the motion of a move in progress), instead of its place
    this.faceOverride = undefined;     // what to show instead of the card's own face while it turns over (null is the back)
    const { face, shadowGeo, shadowTex } = resources();
    const mat = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthTest: false, depthWrite: false, ...o });   // drawn strictly in render order, so layers stack as intended
    this.root = new THREE.Object3D();             // position, facing the camera, rolled
    this.flat = new THREE.Object3D(); this.root.add(this.flat);     // the card's own plane (x right, y up on the card, z toward the viewer)
    this.shadowMat = mat({ map: shadowTex, color: 0x000000, opacity: 0.5 });
    this.edgeMat = mat({}); this.frontMat = mat({}); this.glowMat = mat({ color: 0xffffff, opacity: 0 });
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.edge = new THREE.Mesh(face, this.edgeMat);
    this.front = new THREE.Mesh(face, this.frontMat); this.front.userData.card = this;
    this.glow = new THREE.Mesh(face, this.glowMat);
    this.flat.add(this.shadow, this.edge, this.front, this.glow);
    this.s = Object.fromEntries(AXES.map((a) => [a, new Spring(0)]));
  }
  /** Show `key` (null for a hidden card, drawn as a card back) face up. */
  show(key) {
    if (this.faceOverride !== undefined) key = this.faceOverride;
    if (key === this.key) return;
    this.key = key;
    this.frontMat.map = key ? this.art.faces[key] : this.art.back; this.frontMat.needsUpdate = true;
    this.edgeMat.color.copy(key ? this.art.edge[key] : this.art.backEdge).multiplyScalar(0.42);
  }
  /** Where the card should be: a placement (x y z yaw spin scale) and how it gets there. */
  aim(p, spring = SPRING.settle) {
    this.spring = spring;
    for (const a of AXES) this.s[a].t = p[a] ?? 0;
    this.dimTarget = p.dim ? 0.5 : 1;
  }
  /** Where the card is right now, as a pose. */
  livePose() { const p = {}; for (const a of AXES) p[a] = this.s[a].x; p.dim = (this.dimTarget ?? 1) < 1; return p; }
  /** Start from `pose` (a card that has just come into being somewhere else), keeping the place it is aimed at. */
  snapTo(pose, camQ) { for (const a of AXES) { this.s[a].x = pose[a] ?? 0; this.s[a].v = 0; } this.dim = pose.dim ? 0.5 : 1; this.apply(camQ); }
  /** A push that eases off by itself: the card moves `peak` card units along (dx, dz) and settles back. */
  kick(dx, dz, peak) { const v = peak * Math.sqrt(this.spring[0]) * Math.E; this.s.x.v += dx * v; this.s.z.v += dz * v; }
  /** Jump straight to the aimed pose. */
  snap(camQ) { for (const a of AXES) { this.s[a].x = this.s[a].t; this.s[a].v = 0; } this.dim = this.dimTarget ?? 1; this.apply(camQ); }
  update(dt, camQ) {
    const [k, c] = this.spring, n = 3;
    for (let i = 0; i < n; i++) for (const a of AXES) this.s[a].step(dt / n, k, c);
    this.dim += ((this.dimTarget ?? 1) - this.dim) * (1 - Math.exp(-dt * 12));
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt * 3.4);
    this.glowMat.opacity = this.flashT * 0.4;
    this.apply(camQ);
  }
  apply(camQ) {
    const s = this.s, h = Math.max(0, s.y.x), r = s.yaw.x + s.spin.x;
    this.root.position.set(s.x.x, s.y.x, s.z.x);
    qFace.copy(camQ).multiply(qTmp.setFromAxisAngle(Z, r));                                  // facing the camera, then turned on screen
    qFlat.setFromAxisAngle(Y, r).multiply(qTmp.setFromAxisAngle(X, -Math.PI / 2));           // lying on the table, turned on the table
    this.root.quaternion.copy(qFlat).slerp(qFace, Math.min(1, Math.max(0, s.face.x)));
    this.root.scale.setScalar(Math.max(0.01, s.scale.x));
    // Edge and shadow fall toward the lower right of the SCREEN, whatever way up the card is.
    const cos = Math.cos(-r), sin = Math.sin(-r), off = ([dx, dy]) => [dx * cos - dy * sin, dx * sin + dy * cos];
    const stack = 1 + Math.min(this.base?.depth ?? 0, 8) * 0.22;          // lower cards in a pile show a thicker edge, so the pile reads as a stack
    const [ex, ey] = off(EDGE.map((v) => v * stack)), [sx, sy] = off(SHADOW(h));
    this.edge.position.set(ex, ey, -0.002); this.shadow.position.set(sx, sy, -0.004); this.shadow.scale.setScalar(1 + 0.05 * h);
    this.shadowMat.opacity = Math.min(0.62, 0.4 + 0.07 * h);
    // A card buried in a pile needs no shadow, edge or flash: only the top one is seen.
    const buried = (this.base?.zone === 'deck' || this.base?.zone === 'discard') && !this.base.top;     // (its edge is still drawn: that is the pile's thickness)
    this.shadow.visible = !buried; this.glow.visible = this.flashT > 0;
    this.edge.visible = this.base?.zone === 'deck';                       // only a deck has a visible thickness; on any other card an offset edge reads as a stray line in the card's colour
    this.frontMat.color.setScalar(this.dim);
    // Draw order: higher cards over lower ones; within a card, shadow, edge, face, flash.
    const base = (Math.round(h * 60) + this.boost) * 10;
    this.order = base;
    this.shadow.renderOrder = base; this.edge.renderOrder = base + 1; this.front.renderOrder = base + 2; this.glow.renderOrder = base + 3;
  }
  /** A brief white flash over the face. */
  flash() { this.flashT = 1; }
}
