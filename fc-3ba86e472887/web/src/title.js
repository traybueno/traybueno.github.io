/**
 * The title screen's look, made only from what the game already has: the card back's chain pattern as a faint drifting backdrop, the board's stepped
 * double frame round the screen with its linked-square ornament, and a fan of real card faces. Plain DOM; all idle motion is CSS (index.html).
 */

const NS = 'http://www.w3.org/2000/svg';
const BACK = new URL('../assets/cards/cardback.png', import.meta.url).href;
/** The cards in the fan, left to right; the Heart is the middle one. */
export const FAN = ['knight', 'angel', 'heart', 'guardian', 'fireball'];

/** A rectangle with two-step corners (the card and board frame shape), as an SVG path. */
function stepped(x, y, w, h, s) {
  const r = x + w, b = y + h;
  return `M${x + 2 * s} ${y}H${r - 2 * s}V${y + s}H${r - s}V${y + 2 * s}H${r}V${b - 2 * s}H${r - s}V${b - s}H${r - 2 * s}V${b}H${x + 2 * s}V${b - s}H${x + s}V${b - 2 * s}H${x}V${y + 2 * s}H${x + s}V${y + s}H${x + 2 * s}Z`;
}

/** The linked-square ornament from the board's middle line: two stepped squares linked through each other. */
export function ornament(cls = 'orn') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 30 20'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
  for (const d of [stepped(2, 2, 15, 11, 1.5), stepped(13, 7, 15, 11, 1.5)]) {
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p);
  }
  return svg;
}

/** The frame round the whole screen: an outer and an inner stepped line, redrawn to the screen's size, with the ornament at the top's middle. */
export function screenFrame() {
  const wrap = document.createElement('div'); wrap.className = 'tframe';
  const svg = document.createElementNS(NS, 'svg'); wrap.append(svg, ornament('orn top'));
  const draw = () => {
    const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const m = w < 600 ? 10 : 18, s = w < 600 ? 5 : 7;
    svg.replaceChildren(...[[m, 1], [m + 7, 0.45]].map(([o, a]) => {
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', stepped(o + 0.5, o + 0.5, w - 2 * o - 1, h - 2 * o - 1, s)); p.setAttribute('opacity', a); return p;
    }));
  };
  new ResizeObserver(draw).observe(wrap);
  return wrap;
}

/** The chain pattern from inside the card back's frame, as a faint backdrop that drifts slowly along the chains. */
export function chainBackdrop() {
  const bg = document.createElement('div'); bg.className = 'tchains';
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'), x = 100, y = 110, w = img.width - 2 * x, h = img.height - 2 * y;      // the pattern only, not the back's frame
    c.width = w; c.height = h; c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    bg.style.backgroundImage = `url(${c.toDataURL()})`; bg.classList.add('on');
  };
  img.src = BACK;
  return bg;
}

/** A fan of card faces like the hand on the board. `urlOf(key)` is a face's image URL. */
export function cardFan(urlOf) {
  const fan = document.createElement('div'); fan.className = 'tfan';
  const mid = (FAN.length - 1) / 2;
  FAN.forEach((key, i) => {
    const d = i - mid, card = document.createElement('div'), img = new Image();
    card.className = `tcard${d === 0 ? ' mid' : ''}`; card.style.setProperty('--d', d);
    img.src = urlOf(key); img.alt = ''; img.draggable = false; card.append(img); fan.append(card);
  });
  return fan;
}
