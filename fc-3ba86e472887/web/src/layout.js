/**
 * Where everything sits on the table. Pure: takes what `viewFor(game, viewer)` returns and says where each card goes, in world units on the
 * table plane (x to the right, z toward the viewer, y up). It reads state and never decides anything about the rules.
 *
 * The table is always drawn from the viewer's side: the viewer's own cards are the near half (z > 0), upright; the other player's are the far half,
 * turned 180 degrees. `side` is +1 for the near seat and -1 for the far one, and every owner-relative number below is multiplied by it, so the far
 * half is the near half turned about the table's centre.
 */
export const CARD_W = 3.1, CARD_H = 4.65;                 // a full-size card (art is 2:3)
export const BOARD_SCALE = 0.92;                          // cards on the table are a little smaller than a card in the hand
export const CHAIN_SCALE = 0.78;                          // and Chain cards a little smaller still
export const TABLE = { w: 41, d: 30 };                    // the table plane
export const VIEW = { w: 40.6, zMin: -14.2, zMax: 14.9 }; // what the camera frames: the table and the viewer's hand, which sits a little past the near edge

const FIELD_Z = 4.4, HEART_Z = 4.9;                       // the row of cards, the Heart a little nearer the owner
// The viewer's hand rests a little below the near edge, every card readable. The other player's hand sits past the far edge.
const HAND = { z: 12.5, lift: 1.1, scale: 1.12 };
const FAR_HAND = { z: 13.7, lift: 1.0, scale: 1 };
const DECK = { x: 15.6, z: 8.4 }, DISCARD = { x: 15.6, z: 3.2 };
const CHAIN = { x: 15.2, z0: 2.3, dz: 4.1 };                // the three Chain slots: clear of the centre line above and of the frame below
const ROW_GAP = 0.75, ROW_REACH = 11.2;                   // space between neighbours in the row, and how far the row may reach to either side
export const NUMERALS = ['I', 'II', 'III'];

/** Drop zones, in table coordinates for the given side (+1 near, -1 far): the field a creature is deployed onto, and a discard pile. */
export const fieldZone = (side) => ({ x: 0, z: side * 4.5, w: 25, d: 7.4 });
export const pileZone = (side) => ({ x: -side * DISCARD.x, z: side * DISCARD.z, w: CARD_W * BOARD_SCALE + 0.9, d: CARD_H * BOARD_SCALE + 0.9 });
export const slotRect = (s) => ({ x: s.x, z: s.z, w: CARD_W * CHAIN_SCALE, d: CARD_H * CHAIN_SCALE });

/** Where a hand or a draw pile is, as a placement for the given side (+1 near, -1 far): where cards come from when they are drawn or played. */
export const handSpot = (side) => { const H = side > 0 ? HAND : FAR_HAND; return { x: 0, y: H.lift, z: side * H.z, yaw: side > 0 ? 0 : Math.PI, spin: 0, scale: H.scale, face: 1, dim: false }; };
export const deckSpot = (side) => ({ x: -side * DECK.x, y: 0.3, z: side * DECK.z, yaw: side > 0 ? 0 : Math.PI, spin: 0, scale: BOARD_SCALE, face: 0, dim: false });

const jitter = (id, n) => { let h = 2166136261; for (const ch of id + n) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) / 4294967296) * 2 - 1; };

/**
 * Placement of one card: `x y z` is its centre, `yaw` turns it about the vertical (pi for the far side), 
 * `face` is 1 for a card that faces the camera (a card in the hand, or one lifted out of the table to be read) and 0 for one lying on the table; `depth` is how many cards lie above it in a pile.
 * `spin` turns it on the table about its own centre (a spent creature is turned a quarter, clockwise from its owner's seat), `scale`, `dim` for a
 * spent card. `key` is null for a hidden card, drawn as a card back.
 */
const place = (c, side, p) => ({ id: c.id, key: c.key ?? null, owner: c.owner, zone: 'field', face: 0, depth: 0, yaw: side > 0 ? 0 : Math.PI, spin: 0, scale: BOARD_SCALE, dim: false, ...p });

/** A Guardian sits upright on the card it guards, shifted to the right of it so the guarded card's art stays in view. A spent one is turned sideways, so it sits further out. */
const guardOffset = (g, j) => (g.spent ? 1.6 : 1.1 + j * 0.7);
const guardHalf = (g) => (g.spent ? CARD_H : CARD_W) * BOARD_SCALE / 2;

const GAP = { id: '·gap', gap: true };                    // a place held open in a row for a card that is being carried over it

/**
 * A player's row from left to right, the Heart among it: the order they were kept in (`kept`, ids) with whatever is new added at the end that has fewer
 * cards, and whatever has left taken out. With nothing kept the first card goes left of the Heart, the next right of it, and so on outward.
 */
function sequence(row, heart, kept) {
  const all = new Map([...row, heart].filter(Boolean).map((c) => [c.id, c]));
  const seq = (kept ?? []).filter((id) => all.has(id)).map((id) => all.get(id));
  if (heart && !seq.includes(heart)) seq.splice(seq.length >> 1, 0, heart);
  for (const c of row) {
    if (seq.includes(c)) continue;
    const at = heart ? seq.indexOf(heart) : seq.length >> 1;
    if (at <= seq.length - at - (heart ? 1 : 0)) seq.unshift(c); else seq.push(c);
  }
  return seq;
}

/**
 * `order`: for each player, the ids of their row from left to right, as they last stood (where the player put each card). `gap`: { owner, index } holds a
 * place open at that position of the owner's row. The result's `rows` gives each player's row as it now stands: [{ id, x }] left to right, `x` as the owner sees it.
 */
export function layout(view, viewer, { fan = null, order = null, gap = null } = {}) {
  const cards = [], slots = [], numerals = [], rows = [[], []];
  for (const P of view.players) {
    const side = P.idx === viewer ? 1 : -1;
    const at = (x, z) => ({ x: x * side, z: z * side });             // owner-relative to table: the far side is the near side turned about the centre

    // Guardians that guard a card in play sit on that card; they take no place in the row.
    const inPlayIds = new Set([...P.hearts, ...P.field].map((c) => c.id));
    const guardsAt = (g) => g.key === 'guardian' && g.guards && inPlayIds.has(g.guards);
    const guards = P.field.filter(guardsAt), row = P.field.filter((c) => !guardsAt(c)), heart = P.hearts[0];
    const guardiansOn = (id) => guards.filter((g) => g.guards === id);
    const half = (c) => (c.spent ? CARD_H : CARD_W) * BOARD_SCALE / 2;                     // a spent card is turned, so it is wider
    const over = (c) => Math.max(0, ...guardiansOn(c.id).map((g, j) => guardOffset(g, j) + guardHalf(g) - half(c)));   // how far its Guardians reach past its right edge

    // The row. The Heart stays in the middle, and the rest stand either side of it in the order the player put them (a card dropped on the field goes where it was
    // dropped). Each card is placed clear of its neighbour and of the Guardians resting on it; if the row would reach too far, it is squeezed evenly.
    const seq = sequence(row, heart, order?.[P.idx]), open = gap && gap.owner === P.idx ? Math.max(0, Math.min(seq.length, gap.index)) : -1;
    const standing = [...seq];                                                          // (the Heart's place among them, before a gap is held open)
    if (open >= 0) seq.splice(open, 0, GAP);
    const at0 = heart ? seq.indexOf(heart) : seq.length >> 1;
    const lefts = seq.slice(0, at0).reverse(), rights = seq.slice(heart ? at0 + 1 : at0);      // each from the Heart outward
    const sz = (c) => (c.gap ? CARD_W * BOARD_SCALE / 2 : half(c));
    const x = new Map();
    if (heart) x.set(heart.id, 0);
    let right = heart ? half(heart) + over(heart) : 0, left = heart ? -half(heart) : 0;
    for (const c of rights) { const px = right + ROW_GAP + sz(c); x.set(c.id, px); right = px + sz(c) + (c.gap ? 0 : over(c)); }
    for (const c of lefts) { const px = left - ROW_GAP - sz(c) - (c.gap ? 0 : over(c)); x.set(c.id, px); left = px - sz(c); }
    const squeeze = Math.min(1, ROW_REACH / Math.max(right, -left, 1));
    rows[P.idx] = standing.map((c) => ({ id: c.id, x: x.get(c.id) * squeeze }));
    const spot = new Map();                                                            // card id -> its centre
    for (const c of [heart, ...row].filter(Boolean)) {
      const s = at(x.get(c.id) * squeeze, c.key === 'heart' ? HEART_Z : FIELD_Z); spot.set(c.id, s);
      cards.push(place(c, side, { ...s, y: 0.05, spin: c.spent ? -Math.PI / 2 : 0, dim: !!c.spent }));
    }
    for (const g of guards) {
      const j = guardiansOn(g.guards).indexOf(g), t = spot.get(g.guards);
      cards.push(place(g, side, { x: t.x + side * guardOffset(g, j), z: t.z - side * 0.7, y: 0.16 + j * 0.1, spin: g.spent ? -Math.PI / 2 : 0, dim: !!g.spent }));
    }

    // The hand, fanned along the near (or far) edge. The viewer's own hand is raised, leans back toward them and is a little larger, so it reads as
    // the cards in their hand rather than cards on the table; the other seat's hand is the same, as backs, a little smaller.
    const H = side > 0 ? HAND : FAR_HAND;
    const n = P.hand.length, step = Math.min(3.5 * H.scale, n > 1 ? 16 / (n - 1) : 4);
    P.hand.forEach((c, i) => {
      const t = i - (n - 1) / 2;
      cards.push(place(c, side, { zone: 'hand', face: 1, order: i, ...at(t * step, H.z + 0.08 * t * t), y: H.lift + i * 0.08, spin: -t * 0.06, scale: H.scale }));
    });

    // The draw pile (backs) and the discard pile (faces, the last card on top), each a little untidy so it reads as a stack.
    P.deck.forEach((c, i) => cards.push(place(c, side, { zone: 'deck', top: i === P.deck.length - 1, depth: P.deck.length - 1 - i, ...at(-DECK.x + jitter(c.id, 'x') * 0.025, DECK.z + jitter(c.id, 'z') * 0.025), y: 0.04 + i * 0.04, spin: jitter(c.id, 's') * 0.008 })));
    if (fan === P.idx) {                                              // a pile opened in place (Witch's Kiss): its cards spread across the middle, face up and upright for the viewer
      const m = P.discard.length, st = Math.min(3.3, m > 1 ? 24 / (m - 1) : 3.3);
      P.discard.forEach((c, i) => cards.push(place(c, side, { zone: 'discard', face: 1, x: (i - (m - 1) / 2) * st, z: 3.6, y: 1.6 + i * 0.05, yaw: 0, scale: 1 })));
    } else P.discard.forEach((c, i) => cards.push(place(c, side, { zone: 'discard', top: i === P.discard.length - 1, depth: P.discard.length - 1 - i, ...at(-DISCARD.x + jitter(c.id, 'x') * 0.03, DISCARD.z + jitter(c.id, 'z') * 0.03), y: 0.04 + i * 0.04, spin: jitter(c.id, 's') * 0.012 })));

    // The Chain: three numbered slots, nearest the middle of the table first. Slot I resolves first.
    for (let k = 0; k < 3; k++) {
      const s = at(CHAIN.x, CHAIN.z0 + CHAIN.dz * k);
      slots.push({ owner: P.idx, index: k, ...s, yaw: side > 0 ? 0 : Math.PI, scale: CHAIN_SCALE });
      numerals.push({ text: NUMERALS[k], x: s.x - 2.6, z: s.z });
      const c = P.chain[k];
      if (c) cards.push(place(c, side, { zone: 'chain', ...s, y: 0.05, scale: CHAIN_SCALE }));
    }
  }
  return { cards, slots, numerals, rows };
}

/** Where a card dropped with its centre at `x` (as its owner sees the table) goes in that owner's row: how many of the cards already there stand to its left. */
export const rowIndexAt = (row, x) => row.filter((e) => e.x < x).length;
