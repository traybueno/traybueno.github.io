/**
 * The reference card: the engine's `REFERENCE` text on a card in the table's card style (a black card with a stepped double frame, here in white, and the
 * slab lettering). It sits small at the left edge like a card in the hand; hovering (or tapping) brings it up full size, and the arrow in its bottom bar
 * turns it over. One side is the turn drawn as a timeline (Draw, the Field and Chain actions side by side, End, with Instants as a band beside it all); the
 * other is the life of a card (Ready, Spent, Defeated) and one rule per row, each with a small pixel icon in the colour of the card it is about.
 * The words come from src/cards.js; nothing here is a rule.
 */
import { REFERENCE } from '../../src/index.js?v=ad16557';

/** Pixel icons, drawn square by square so they step like the art. */
const ICONS = {
  turn: ['........#....', '........##...', '.##########..', '.#......##...', '.#......#....', '.#...........', '.#...........', '.#########...'],
  sword: ['.......##', '......###', '.....###.', '#...###..', '.#.###...', '..###....', '..##.....', '.#..#....', '#........'],
  shield: ['#########', '#.......#', '#.##.##.#', '#.##.##.#', '.#.....#.', '.#.###.#.', '..#...#..', '...#.#...', '....#....'],
  heart: ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  bolt: ['....###', '...###.', '..###..', '.######', '...###.', '..###..', '.###...', '##.....'],
  slots: ['###.###.###', '#.#.#.#.#.#', '###.###.###'],
  card: ['#####', '#...#', '#...#', '#...#', '#...#', '#####'],
  sideways: ['########', '#......#', '#......#', '#......#', '########'],
  pile: ['.######..', '.#....#..', '.#.##.##.', '.#.#.#.#.', '.#..#..#.', '.#.#.#.#.', '.#####.#.', '..#####..'],
};
/** The colour of each icon: the frame colour of the card it is about. */
const TOPIC = {
  draw: ['card', '#ffffff'], field: ['sword', 'var(--rc-field)'], chain: ['slots', 'var(--rc-chain)'], instant: ['bolt', 'var(--rc-inst)'],
  attack: ['sword', 'var(--rc-field)'], spent: ['sideways', '#ffffff'], device: ['sideways', 'var(--rc-dev)'], guard: ['shield', 'var(--rc-guard)'],
  pile: ['pile', 'var(--rc-guard)'], heart: ['heart', 'var(--rc-heart)'],
};
/** Card names in a rule are lettered in their card's colour. */
const WORDS = [[/\b(Knights?|Maniacs?|Recover)\b/, 'var(--rc-field)'], [/\b(Guardians?)\b/, 'var(--rc-guard)'], [/\b(Heart)\b/, 'var(--rc-heart)'], [/\b(Devices?)\b/, 'var(--rc-dev)'], [/\b(Rally)\b/, 'var(--rc-inst)']];
const WORD = new RegExp(WORDS.map(([r]) => r.source).join('|'), 'g');

const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text ? { textContent: text } : {});

function icon(name, colour) {
  const rows = ICONS[name], ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('rc-ico'); svg.style.setProperty('--w', rows[0].length); svg.style.setProperty('--h', rows.length); if (colour) svg.style.fill = colour;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '#') return;
    const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1.02); r.setAttribute('height', 1.02); svg.append(r);
  }));
  return svg;
}
const topicIcon = (topic) => (TOPIC[topic] ? icon(...TOPIC[topic]) : el('span'));

/** A rule's text with the card names coloured. */
function words(text) {
  const p = el('p'); let at = 0;
  for (const m of text.matchAll(WORD)) {
    p.append(text.slice(at, m.index));
    const s = el('b', 'rc-kw', m[0]); s.style.color = WORDS.find(([r]) => r.test(m[0]))[1]; p.append(s); at = m.index + m[0].length;
  }
  p.append(text.slice(at));
  return p;
}

/** A box in the card's frame style: a stepped double line around `inner`. */
function box(cls, ...inner) {
  const a = el('div', `rf-box ${cls}`), b = el('div', 'rf-b'), c = el('div', 'rf-c'), d = el('div', 'rf-d');
  d.append(...inner); c.append(d); b.append(c); a.append(b);
  return a;
}

/** An option of an action: its verb in bold, and what is in brackets or after a colon as a small line under it. */
function option(text) {
  const m = text.match(/^([^(:]+?)\s*(?:\((.*)\)|:\s*(.*))?$/), li = el('li');
  li.append(el('b', '', m[1]));
  if (m[2] || m[3]) li.append(el('small', '', m[2] || m[3]));
  return li;
}

/** Side one: the turn as a timeline. */
function turnSide({ steps, instants, note }) {
  const line = el('div', 'rt-line');
  for (const s of steps) {
    const step = el('div', `rt-step rt-${s.topic}`), body = el('div', 'rt-c');
    step.append(el('span', 'rt-node'), body);
    if (s.actions) {
      const pair = el('div', 'rt-pair');
      s.actions.forEach((a, i) => {
        if (i) pair.append(el('span', 'rt-amp', '+'));
        const act = el('div', `rt-act rt-${a.topic}`), head = el('div', 'rt-head'), list = el('ul');
        head.append(topicIcon(a.topic), el('span', '', a.name)); a.options.forEach((o) => list.append(option(o)));
        act.append(head, list); pair.append(act);
      });
      body.append(pair, el('div', 'rt-sub', s.text));
    } else {
      const head = el('div', 'rt-head'); head.append(topicIcon(s.topic), el('span', '', s.name));
      body.append(head); if (s.text && s.topic !== 'end') body.append(el('div', 'rt-sub', s.text));
    }
    line.append(step);
  }
  const band = el('div', 'rt-band'), bandText = el('div', 'rt-bandtext');
  bandText.append(el('b', '', instants.name), el('span', '', instants.text)); band.append(topicIcon(instants.topic), bandText);
  const wrap = el('div', 'rf-fit rt'), grid = el('div', 'rt-grid');
  grid.append(line, band); wrap.append(grid, el('div', 'rf-note', note));
  return wrap;
}

/** Side two: the life of a card, then one rule a row, then the goal. */
function cardsSide({ states, rows, goal }) {
  const wrap = el('div', 'rf-fit rc'), life = el('div', 'rc-life'), track = el('div', 'rc-track');
  states.steps.forEach((name, i) => {
    if (i) { const hit = el('div', 'rc-hit'); hit.append(el('span', '', states.by), el('i')); track.append(hit); }
    const st = el('div', `rc-state rc-s${i}`); st.append(el('span', 'rc-mini'), el('b', '', name)); track.append(st);
  });
  life.append(track, el('div', 'rf-note', states.caption));
  const list = el('div', 'rc-rows');
  for (const r of rows) { const row = el('div', 'rc-row'); row.append(topicIcon(r.topic), words(r.text)); list.append(row); }
  const g = el('div', 'rc-goal'); g.append(topicIcon(goal.topic), words(goal.text), topicIcon(goal.topic));
  wrap.append(life, list, g);
  return wrap;
}

/** One side of the card: its title bar, its body, and the bar with the arrow. */
function side(title, body, onTurn) {
  const face = el('div', 'rf-face');
  const turn = el('button', 'rf-turn'); turn.type = 'button'; turn.setAttribute('aria-label', 'Turn the card over'); turn.append(icon('turn'));
  turn.addEventListener('click', (e) => { e.stopPropagation(); onTurn(); });
  face.append(box('rf-title', el('span', '', title)), box('rf-body', body), box('rf-foot', turn));
  return el('div', 'rf-frame').appendChild(face).parentNode;
}

/** Build the card and put it on the page. */
export function createRefCard(parent = document.body) {
  const root = el('div', 'refcard'), card = el('div', 'rf-card'), flip = el('div', 'rf-flip');
  root.tabIndex = 0; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Reference card');
  const turn = () => { root.classList.add('open'); flip.classList.toggle('over'); };
  const front = side(REFERENCE.turn.title, turnSide(REFERENCE.turn), turn), back = side(REFERENCE.cards.title, cardsSide(REFERENCE.cards), turn);
  front.classList.add('rf-front'); back.classList.add('rf-back');
  flip.append(front, back); card.append(flip); root.append(card, el('span', 'rf-tag', 'Rules'));
  root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') root.classList.add('open'); });
  root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') root.classList.remove('open'); });
  root.addEventListener('click', () => root.classList.add('open'));              // a tap opens it on a touch screen
  document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) root.classList.remove('open'); });
  root.addEventListener('focus', () => { if (root.matches(':focus-visible')) root.classList.add('open'); });       // the keyboard opens it too
  root.addEventListener('blur', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('open'); });
  // A side whose words run long shrinks all its lettering together until it fits its box. Sizes are shares of the card, so one fit holds at every size.
  let fitted = false;
  const fit = () => {
    if (fitted || !root.classList.contains('open')) return;
    fitted = true;
    for (const f of [front, back]) {
      const body = f.querySelector('.rf-fit'), room = f.querySelector('.rf-body .rf-d'); let k = 1;
      body.style.setProperty('--k', k);
      while (body.offsetHeight > room.clientHeight && k > 0.6) body.style.setProperty('--k', (k -= 0.02).toFixed(2));
    }
  };
  card.addEventListener('transitionend', (e) => { if (e.propertyName === 'height') fit(); });
  addEventListener('resize', () => { fitted = false; fit(); });
  parent.append(root);
  return root;
}
