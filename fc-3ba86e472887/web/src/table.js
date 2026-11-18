/** The table itself: the black board with its double frame and centre divider, the three Chain slots, and their numerals. Drawn once on canvases. */
import * as THREE from 'three';
import { TABLE, CARD_W, CARD_H, CHAIN_SCALE } from './layout.js?v=4690f3a';

const CREAM = '#ece2bd', PPU = 80;                       // line colour, canvas pixels per world unit

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** A rectangle whose corners step in two stair steps, the frame's corner. */
function steppedRect(g, x0, y0, x1, y1, s) {
  g.beginPath();
  g.moveTo(x0 + 2 * s, y0); g.lineTo(x1 - 2 * s, y0); g.lineTo(x1 - 2 * s, y0 + s); g.lineTo(x1 - s, y0 + s); g.lineTo(x1 - s, y0 + 2 * s); g.lineTo(x1, y0 + 2 * s);
  g.lineTo(x1, y1 - 2 * s); g.lineTo(x1 - s, y1 - 2 * s); g.lineTo(x1 - s, y1 - s); g.lineTo(x1 - 2 * s, y1 - s); g.lineTo(x1 - 2 * s, y1);
  g.lineTo(x0 + 2 * s, y1); g.lineTo(x0 + 2 * s, y1 - s); g.lineTo(x0 + s, y1 - s); g.lineTo(x0 + s, y1 - 2 * s); g.lineTo(x0, y1 - 2 * s);
  g.lineTo(x0, y0 + 2 * s); g.lineTo(x0 + s, y0 + 2 * s); g.lineTo(x0 + s, y0 + s); g.lineTo(x0 + 2 * s, y0 + s); g.closePath();
}

function boardTexture() {
  return canvasTexture(TABLE.w * PPU, TABLE.d * PPU, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = CREAM; g.lineJoin = 'miter';
    const fx = 19.1 * PPU, fz = 13.4 * PPU, step = 0.3 * PPU, cx = w / 2, cy = h / 2;
    g.lineWidth = 0.1 * PPU; steppedRect(g, cx - fx, cy - fz, cx + fx, cy + fz, step); g.stroke();
    g.lineWidth = 0.05 * PPU; steppedRect(g, cx - fx + 0.45 * PPU, cy - fz + 0.45 * PPU, cx + fx - 0.45 * PPU, cy + fz - 0.45 * PPU, step * 0.8); g.stroke();
    // The divider: a thin line with a hollow square at each end and an interlocked pair of squares in the middle.
    const dx = 17.9 * PPU, sq = 0.28 * PPU;
    g.lineWidth = 0.04 * PPU; g.beginPath(); g.moveTo(cx - dx + sq, cy); g.lineTo(cx - 1.2 * PPU, cy); g.moveTo(cx + 1.2 * PPU, cy); g.lineTo(cx + dx - sq, cy); g.stroke();
    g.lineWidth = 0.05 * PPU; for (const sx of [cx - dx, cx + dx]) g.strokeRect(sx - sq / 2, cy - sq / 2, sq, sq);
    const o = 0.34 * PPU, b = 0.44 * PPU; g.strokeRect(cx - b / 2 - o / 2, cy - b / 2 - o / 3, b, b); g.strokeRect(cx - b / 2 + o / 2, cy - b / 2 + o / 3, b, b);
  });
}

const slotTexture = () => canvasTexture(256, 384, (g, w, h) => {
  g.strokeStyle = CREAM; g.lineWidth = 7; g.lineJoin = 'round';
  const r = 26, x = 8, y = 8, X = w - 8, Y = h - 8;
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(X - r, y); g.quadraticCurveTo(X, y, X, y + r); g.lineTo(X, Y - r); g.quadraticCurveTo(X, Y, X - r, Y); g.lineTo(x + r, Y); g.quadraticCurveTo(x, Y, x, Y - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath(); g.stroke();
});
const numeralTexture = (text) => canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = CREAM; g.font = 'bold 150px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 8);
});

const flat = (geo, map, x, z, y, extra = {}) => {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false, ...extra }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); return m;
};

/** The static table, as a group. `slots` and `numerals` come from layout.js and are placed when the view changes. */
export class Table {
  constructor() {
    this.group = new THREE.Group();
    const board = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w, TABLE.d), new THREE.MeshBasicMaterial({ map: boardTexture(), toneMapped: false }));
    board.rotation.x = -Math.PI / 2; this.group.add(board);
    this.slotMap = slotTexture(); this.numMaps = ['I', 'II', 'III'].map(numeralTexture);
    this.dynamic = new THREE.Group(); this.group.add(this.dynamic);
    // Whose turn it is: the other half of the board is dimmed a little, and one of the two interlocked squares at the centre is filled, on the side that is playing.
    const veil = () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.veil = [veil(), veil()];                                           // [near half, far half]
    [1, -1].forEach((side, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w, TABLE.d / 2), this.veil[i]);
      m.rotation.x = -Math.PI / 2; m.position.set(0, 0.006, side * TABLE.d / 4); m.renderOrder = -2; this.group.add(m);
    });
    const fill = () => new THREE.MeshBasicMaterial({ color: 0xece2bd, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.fill = [fill(), fill()];                                           // [near square, far square]
    [[0.17, 0.113], [-0.17, -0.113]].forEach(([x, z], i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), this.fill[i]);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); m.renderOrder = -1; this.group.add(m);
    });
    this.turn = 1; this.turnTo = 1; this.shade();                           // +1: the near player's turn, -1: the far player's
  }
  /** Say whose turn it is (`side` +1 near, -1 far); `now` skips the fade. */
  setTurn(side, now = false) { this.turnTo = side; if (now) { this.turn = side; this.shade(); } }
  update(dt) { if (Math.abs(this.turn - this.turnTo) > 0.002) { this.turn += (this.turnTo - this.turn) * (1 - Math.exp(-dt * 7)); this.shade(); } }
  shade() {
    const near = (1 + this.turn) / 2;
    this.veil[0].opacity = 0.5 * (1 - near); this.veil[1].opacity = 0.5 * near;
    this.fill[0].opacity = near; this.fill[1].opacity = 1 - near;
  }
  /** Rebuild the slot outlines and numerals (cheap: six outlines and six numerals). */
  place({ slots, numerals }) {
    this.dynamic.clear();
    const slotGeo = new THREE.PlaneGeometry(CARD_W * CHAIN_SCALE + 0.36, CARD_H * CHAIN_SCALE + 0.36), numGeo = new THREE.PlaneGeometry(1.5, 1.5);
    for (const s of slots) { const m = flat(slotGeo, this.slotMap, s.x, s.z, 0.01); m.rotation.z = 0; m.renderOrder = -3; this.dynamic.add(m); }     // drawn before the veil, so the veil dims them too
    numerals.forEach((n, i) => { const m = flat(numGeo, this.numMaps[i % 3], n.x, n.z, 0.01); m.renderOrder = -3; this.dynamic.add(m); });
  }
}
