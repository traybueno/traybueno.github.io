/**
 * A card face is the supplied blank (frame and picture, no words) with the engine's own name, type and rules text drawn on it, so a card's words are
 * edited in `src/cards.js` and nothing else. The lettering matches the original printed cards: a slab serif drawn in the card's frame colour, centred in the
 * title bar, the type bar and the text box, with the same stepped pixel edge as the art.
 */
import { CARDS } from '../../src/index.js';

export const FONT = { family: 'Roboto Slab', weights: [500, 700] };
const WEIGHT = { title: 700, type: 500, body: 500 }, SPACING = { title: 1, type: 3, body: 2 };
const W = 1024, H = 1536;
/** The printed lettering is about 1.22 times wider than the font's own letters at the same height. */
const STRETCH = 1.22;
/** Text is drawn at 1/PIXEL of the card's size and enlarged without smoothing, so its edges step like the art's. */
const PIXEL = 3;
const TITLE = { cy: 128, size: 87, maxW: 750 };
const TYPE = { size: 62, lift: 5 };
const BODY = { maxW: 740, maxH: 290, top: 63, floor: 40, pitch: 1.18, lift: 12 };

const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** The type line of a card, or null for a card that prints none (the Heart). */
export const typeLine = (card) => (card.kind === 'heart' ? null : (card.instant ? 'Instant ' : '') + cap(card.kind));      // the Lantern Keeper prints "Instant Creature"

/** The frame colour of a blank: the average of its brightest pixels along the top border. */
function frameColour(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = 24; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 24, img.width, 24, 0, 0, img.width, 24);
  const d = g.getImageData(img.width * 0.25, 0, img.width * 0.5, 24).data; let top = 0;
  for (let i = 0; i < d.length; i += 4) top = Math.max(top, d[i] + d[i + 1] + d[i + 2]);
  let r = 0, gr = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > top * 0.85) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
  return `rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})`;
}

/**
 * Where the type bar and the text box of a blank are, as [top, bottom] rows, read from a column just inside the frame. The bars sit at slightly different
 * heights from card to card (the Knight's are lower, the Heart has no type bar), so each blank is measured rather than assumed.
 */
function bars(img) {
  const c = document.createElement('canvas'); c.width = 20; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 90, 0, 20, img.height, 0, 0, 20, img.height);
  const d = g.getImageData(0, 0, 20, img.height).data, runs = []; let from = -1;
  for (let y = 0; y <= img.height; y++) {
    let dark = y < img.height; if (dark) { let sum = 0; for (let x = 0; x < 20; x++) { const i = (y * 20 + x) * 4; sum += d[i] + d[i + 1] + d[i + 2]; } dark = sum / 60 < 60; }
    if (dark && from < 0) from = y; else if (!dark && from >= 0) { if (y - from > 25) runs.push([from, y - 1]); from = -1; }
  }
  const body = runs.filter((r) => r[1] < img.height - 40).at(-1), before = runs.filter((r) => r[1] < body[0]).at(-1);
  const type = before && before[1] - before[0] < 130 && before[0] > img.height * 0.55 ? before : null;
  return { body, type };
}

/** Compose the face of card `key` from its blank image. */
export function drawFace(blank, key) {
  const card = CARDS[key], out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d'); g.drawImage(blank, 0, 0, W, H);
  // The words go on a smaller layer first, stepped, then onto the card.
  const q = PIXEL, layer = document.createElement('canvas'); layer.width = W / q; layer.height = H / q;
  const t = layer.getContext('2d', { willReadFrequently: true }); const colour = frameColour(blank);
  t.scale(1 / q, 1 / q); t.fillStyle = colour; t.textAlign = 'center'; t.textBaseline = 'alphabetic';
  const font = (s, part) => { t.font = `${WEIGHT[part]} ${s}px "${FONT.family}"`; t.letterSpacing = `${SPACING[part]}px`; };
  const width = (s, text, part) => { font(s, part); return t.measureText(text).width * STRETCH; };
  const line = (text, size, part, cx, baseline) => { font(size, part); t.save(); t.translate(cx, baseline); t.scale(STRETCH, 1); t.fillText(text, 0, 0); t.restore(); };
  /** Baseline that centres the letters (ascender to baseline) on `cy`. */
  const centred = (size, part, cy) => { font(size, part); return cy + t.measureText('Hd').actualBoundingBoxAscent / 2; };

  let s = TITLE.size; while (s > 30 && width(s, card.name, 'title') > TITLE.maxW) s--;
  line(card.name, s, 'title', W / 2, centred(s, 'title', TITLE.cy));
  const type = typeLine(card), box = bars(blank);
  let ts = TYPE.size; while (type && ts > 30 && width(ts, type, 'type') > TITLE.maxW) ts--;                // "Instant Creature" is the longest type line
  if (type && box.type) line(type, ts, 'type', W / 2, centred(ts, 'type', (box.type[0] + box.type[1]) / 2 - TYPE.lift));

  /** Greedy wrap to `max`. */
  const greedy = (size, max) => {
    const lines = []; let cur = '';
    for (const word of card.text.split(' ')) { const next = cur ? `${cur} ${word}` : word; if (cur && width(size, next, 'body') > max) { lines.push(cur); cur = word; } else cur = next; }
    return [...lines, cur];
  };
  /** Wrap so the lines are about the same length: the fewest lines that fit, then the narrowest column that still gives that many. */
  const wrap = (size) => {
    const best = greedy(size, BODY.maxW); let lo = BODY.maxW * 0.75, hi = BODY.maxW;
    for (let i = 0; i < 12 && best.length > 1; i++) { const mid = (lo + hi) / 2; if (greedy(size, mid).length > best.length) lo = mid; else hi = mid; }
    return best.length > 1 ? greedy(size, hi) : best;
  };
  let size = BODY.top, lines = wrap(size);
  while (size > BODY.floor && lines.length * size * BODY.pitch > BODY.maxH) lines = wrap(--size);
  const pitch = size * BODY.pitch, cy = (box.body[0] + box.body[1]) / 2 - BODY.lift;
  lines.forEach((l, i) => line(l, size, 'body', W / 2, cy + (i - (lines.length - 1) / 2) * pitch + 0.33 * size));

  // Stepped edge: keep a pixel only where the text covers more than half of it, then enlarge without smoothing.
  const px = t.getImageData(0, 0, layer.width, layer.height), a = px.data;
  for (let i = 3; i < a.length; i += 4) a[i] = a[i] > 127 ? 255 : 0;
  t.putImageData(px, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(layer, 0, 0, W, H);
  return out;
}
