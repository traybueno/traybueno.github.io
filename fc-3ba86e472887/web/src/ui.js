/**
 * The few things that are not on the table: the End Turn button and the Release, Recover and Skip buttons that appear only when they apply, a one-line
 * hint, a big preview of the card under the pointer, the reference card at the left edge (refcard.js), the title screen (title.js) with the opponent picker,
 * the one Menu button and its panels (pause menu, settings, developer tools, a yes/no question), the "pass the device" cover (two-player mode only), and
 * the result shown when the game is over. Plain DOM over the canvas.
 */

import { createRefCard } from './refcard.js?v=4690f3a';
import { screenFrame, chainBackdrop, cardFan, ornament } from './title.js?v=4690f3a';

/** `faceOf(key)` is the finished face of a card (the canvas the table's card is textured from), so the preview shows the same words. */
export function createUI({ faceOf, onButton, onCoverDone, onMenu }) {
  const el = (tag, cls, text) => Object.assign(Object.assign(document.createElement(tag), { className: cls }), text ? { textContent: text } : {});
  /** A gothic button: a stepped double frame (and, on the start screen, a diamond on each side of the label). */
  const button = (cls, label, sub, ornaments = false) => {
    const b = el('button', `btn ${cls}`); b.type = 'button';
    const text = el('span', 't'); text.append(label); if (sub) text.append(el('span', 'sub', sub));
    if (ornaments) b.append(el('span', 'g', '◆'), text, el('span', 'g', '◆')); else b.append(text);
    return b;
  };
  /** Copy text to the clipboard (with a fallback where the clipboard API is blocked); resolves true on success. */
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    const t = Object.assign(document.createElement('textarea'), { value: text }); t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* no clipboard */ } t.remove(); return ok;
  };
  const download = (name, text) => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  /** A small button that says "Copied ✓" for a moment after it copies `text()`. */
  const copyButton = (label, text) => { const b = button('sm', label); b.addEventListener('click', async () => { const ok = await copy(text()); b.querySelector('.t').textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { b.querySelector('.t').textContent = label; }, 1400); }); return b; };
  const lessonBox = el('div', 'lesson'), bar = el('div', 'bar'), hist = el('div', 'hist'), tab = el('button', 'tabbtn', 'History'), hint = el('div', 'hint'), cover = el('div', 'cover'), over = el('div', 'over'), start = el('div', 'start'), preview = el('div', 'preview');
  const urls = {}, previewImg = el('img'); previewImg.alt = ''; previewImg.draggable = false; preview.append(el('div', 'pimg')); preview.firstChild.append(previewImg);
  const buttons = {};
  for (const [name, label] of [['skip', 'Skip'], ['recover', 'Recover'], ['release', 'Release'], ['end', 'End Turn']]) {
    const b = button(name, label); b.hidden = true; b.addEventListener('click', () => onButton(name)); bar.append(b); buttons[name] = b;
  }
  // The one control in the corner during play: it opens the pause menu (Esc does too).
  const menuBtn = button('sm menubtn', 'Menu', null, true); menuBtn.title = 'Menu (Esc)'; menuBtn.hidden = true;
  menuBtn.addEventListener('click', () => onMenu());
  // The dark between the title and the table (Start game): fades in, holds, fades out over the deal. Times in ms, matching the CSS.
  const veil = el('div', 'veil'), VEIL_IN = 550, VEIL_HOLD = 750;
  // Learn to play: Continue, with the other buttons at the top right (Enter works too).
  const cont = button('cont', 'Continue'); cont.hidden = true; bar.prepend(cont); let onCont = null;
  cont.addEventListener('click', () => onCont?.());
  addEventListener('keydown', (e) => { if (e.key === 'Enter' && !cont.hidden && layer.hidden && over.hidden) { e.preventDefault(); onCont?.(); } });
  lessonBox.hidden = true; cover.hidden = true; over.hidden = true; start.hidden = true; hist.hidden = true; tab.hidden = true; tab.type = 'button'; hint.style.opacity = 0;
  cover.addEventListener('pointerdown', () => { if (performance.now() - cover.shownAt > 350) { cover.hidden = true; onCoverDone(); } });
  const layer = el('div', 'layer'); layer.hidden = true;                             // the panels: one at a time, stacked so Back returns to the one before
  layer.addEventListener('pointerdown', (e) => { if (e.target === layer) panels.back(); });
  document.body.append(preview, lessonBox, bar, hint, menuBtn, tab, cover, over, start, hist, layer, veil);
  const refcard = createRefCard();                                                   // the reference card, small at the left edge
  const faceUrl = (key) => (urls[key] ??= faceOf(key).toDataURL());
  let shown = null, onClose = null;
  /** A ◂ value ▸ selector: `options` is [[value, label, sub?]]; `get()`/`set(v)` read and change it. Returns { el, step(dir) }. */
  const selector = (cls, options, get, set) => {
    const box = el('div', `sel ${cls}`), prev = el('button', 'arr', '◂'), next = el('button', 'arr', '▸'), val = el('div', 'val');
    prev.type = next.type = 'button'; prev.setAttribute('aria-label', 'Previous'); next.setAttribute('aria-label', 'Next');
    const show = () => { const o = options.find(([v]) => v === get()) ?? options[0]; val.replaceChildren(el('span', 'nm', o[1])); if (o[2]) val.append(el('span', 'sub', o[2])); };
    const step = (dir) => { const i = options.findIndex(([v]) => v === get()); set(options[(i + dir + options.length) % options.length][0]); show(); };
    prev.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
    box.append(prev, val, next); show();
    return { el: box, step };
  };
  /** The panels shown over everything: `open` pushes one (a heading and its contents), `back` returns to the one before, `close` shuts them all. */
  const stack = [];
  const panels = {
    open(heading, ...children) {
      const p = el('div', 'panel'), inner = el('div', 'pin'), head = el('div', 'phead');
      head.append(ornament('orn'), el('span', '', heading), ornament('orn'));
      inner.append(head, ...children); p.append(inner); stack.push(p);
      layer.replaceChildren(p); layer.hidden = false;
    },
    back() { stack.pop(); if (stack.length) layer.replaceChildren(stack.at(-1)); else panels.close(); },
    close() { stack.length = 0; layer.hidden = true; layer.replaceChildren(); const f = onClose; onClose = null; f?.(); },
  };
  /** A column of big buttons: `items` is [[label, onClick, sub?]]. */
  const column = (items) => { const c = el('div', 'pcol'); for (const [label, fn, sub] of items) { const b = button('pbtn', label, sub); b.addEventListener('click', fn); c.append(b); } return c; };
  const backBtn = (label = 'Back') => { const b = el('button', 'plink', `← ${label}`); b.type = 'button'; b.addEventListener('click', () => panels.back()); return b; };
  /** The settings: `items` is [{ label, options: [[value, label]], get, set }]. */
  const settingsPanel = (items) => {
    const rows = el('div', 'prows');
    for (const it of items) { const r = el('div', 'prow'); r.append(el('span', 'plabel', it.label), selector('small', it.options, it.get, it.set).el); rows.append(r); }
    panels.open('Settings', rows, el('div', 'pnote', 'Space skips a move while it plays.'), backBtn());
  };
  let titleKeys = null;
  return {
    /** Is any panel open? */
    get panelOpen() { return !layer.hidden; },
    /** Esc: back one panel. */
    panelBack() { panels.back(); },
    /** The corner Menu button: shown during play, hidden on the title. */
    menuButton(show) { menuBtn.hidden = !show; },
    /** The pause menu. `items` is [[label, onClick, sub?]]; `settings` as for the settings panel; `onResume` runs when it closes, however it closes. */
    menu(items, settings, onResume) {
      onClose = onResume; stack.length = 0;
      panels.open('Paused', column([['Resume', () => panels.close()], ['Settings', () => settingsPanel(settings)], ...items]));
    },
    /** Ask a yes/no question inside the panels; `yes` runs on the first answer, the second goes back. */
    confirm(text, yesLabel, noLabel, yes) {
      const row = el('div', 'prow2'), y = button('pbtn', yesLabel), n = button('pbtn', noLabel);
      y.addEventListener('click', () => { onClose = null; panels.close(); yes(); }); n.addEventListener('click', () => panels.back()); row.append(n, y);
      panels.open(text, row);
    },
    /** Close the panels as Resume does (the resume callback runs). */
    closeMenu() { panels.close(); },
    /** Close every panel (without running the resume callback). */
    closePanels() { onClose = null; panels.close(); },
    /**
     * The title screen: chain backdrop, frame, the name, a fan of cards, the opponent picker, Start game, and two small links.
     * `profiles` is { id: { name, blurb } }; `pick` the opponent shown first; `onPick(id)` remembers a change; `onStart(id)` deals;
     * `settings` as for the settings panel; `dev` is [[label, onClick, sub]].
     */
    title({ profiles, pick, onPick, onStart, onLeave, settings, dev, onLearn }) {
      let chosen = pick;
      const name = el('h1', 'tname'), word = el('span', 'tword');
      word.append(el('span', '', 'Field'), ornament('orn plus'), el('span', '', 'Chain')); name.append(word);
      const opts = Object.entries(profiles).map(([id, p]) => [id, p.name, p.blurb]);
      const sel = selector('opp', opts, () => chosen, (v) => { chosen = v; onPick?.(v); });
      // Start game: the press is heard on its own, the screen goes dark and quiet for a breath, then the table comes up out of the dark as the deal begins.
      // Learn to play leaves the title the same way.
      const leave = (then) => {
        if (veil.classList.contains('in')) return;
        document.removeEventListener('keydown', titleKeys); onLeave?.();
        veil.classList.add('in');
        setTimeout(() => {
          start.hidden = true; then();
          setTimeout(() => veil.classList.remove('in'), 60);
        }, VEIL_IN + VEIL_HOLD);
      };
      const go = button('go', 'Start game', null, true);
      go.addEventListener('click', () => leave(() => onStart(chosen)));
      const learn = button('go', 'Learn to play', null, true); learn.addEventListener('click', () => { onClose = null; stack.length = 0; leave(() => onLearn?.()); });
      const links = el('div', 'tlinks'), sl = el('button', 'plink', 'Settings'), dl = el('button', 'plink', 'Developer tools'); sl.type = dl.type = 'button';
      sl.addEventListener('click', () => { onClose = null; stack.length = 0; settingsPanel(settings); });
      dl.addEventListener('click', () => { onClose = null; stack.length = 0; panels.open('Developer tools', column(dev), backBtn()); });
      links.append(sl, el('span', 'dot', '◆'), dl);
      const body = el('div', 'tbody'), pickRow = el('div', 'tpick');
      pickRow.append(el('div', 'k', 'Opponent'), sel.el);
      const mains = el('div', 'tmain'); mains.append(go, learn);
      body.append(name, cardFan(faceUrl), pickRow, mains, links);
      start.className = 'start title-screen';
      start.replaceChildren(chainBackdrop(), screenFrame(), body); start.hidden = false; menuBtn.hidden = true;
      document.removeEventListener('keydown', titleKeys);
      titleKeys = (e) => {
        if (start.hidden || !layer.hidden) return;
        if (e.key === 'ArrowLeft') sel.step(-1); else if (e.key === 'ArrowRight') sel.step(1);
        else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') go.click();
      };
      document.addEventListener('keydown', titleKeys);
    },
    /** Hide the title screen (Learn to play was picked from it). */
    hideTitle() { start.hidden = true; document.removeEventListener('keydown', titleKeys); },
    /** Learn to play: the chapter (`label`) and where it is in the story (`at`), at the top left of the table (null hides it). */
    lesson(info) {
      lessonBox.hidden = !info; if (!info) return;
      if (lessonBox.dataset.k === info.label + info.at) return; lessonBox.dataset.k = info.label + info.at;
      lessonBox.replaceChildren(el('div', 'lk', info.at), el('div', 'lg', info.label));
    },
    /** Learn to play: show Continue (`fn` runs when it is pressed), or hide it (null). */
    cont(fn) { onCont = fn; cont.hidden = !fn; },
    /** Learn to play is complete: what it taught, and the way on (`next` the main button, `back` the other). */
    lessonDone({ title, text, next, onNext, back, onBack }) {
      const row = el('div', 'row'), other = button('', back, null, true), go = button('go', next, null, true);
      other.addEventListener('click', () => onBack()); go.addEventListener('click', () => onNext()); row.append(other, go);
      over.replaceChildren(el('div', 'who', title), el('div', 'ltext', text), row); over.hidden = false;
    },
    /** Is the title (or the bot chooser) up? */
    get onTitle() { return !start.hidden; },
    /** Show the buttons for the moves that exist (an object of name -> move or null). */
    buttons(avail) {
      for (const [n, b] of Object.entries(buttons)) { b.hidden = !avail[n]; b.style.animationDelay = `${-(performance.now() % 1500)}ms`; }    // every button blinks in step
    },
    hint(text, { prompt = false } = {}) { hint.textContent = text || ''; hint.style.opacity = text ? 1 : 0; if (text) hint.classList.toggle('prompt', prompt); },      // `prompt`: what to tap next, shown as a banner on the table's middle line
    /** A big copy of the card the pointer is on (null to hide it). */
    preview(key) {
      if (key === shown) return; shown = key;
      if (key) { previewImg.src = faceUrl(key); refcard.classList.remove('open'); }      // the preview shows where the open reference card would be
      preview.classList.toggle('on', !!key);
    },
    /** Bot against bot: pick a level for each seat (`pick` is [id0, id1]), then `onStart([id0, id1])`. */
    chooseBots(profiles, pick, onStart) {
      const title = el('div', 'title'); title.append(el('span', 'rule'), el('span', 'name', 'Bot vs Bot'), el('span', 'rule'));
      const rows = el('div', 'list'), sel = [...pick], summary = el('div', 'pick'), names = () => sel.map((id) => profiles[id].name);
      const show = () => { summary.textContent = `${names()[0]}  vs  ${names()[1]}`; };
      [0, 1].forEach((seat) => {
        const row = el('div', 'k', seat ? 'Bot 2' : 'Bot 1 (plays first)'), group = el('div', 'list');
        const bs = Object.entries(profiles).map(([id, p]) => { const b = button('opp', p.name, null, true); const mark = () => b.classList.toggle('sel', id === sel[seat]); mark(); b.addEventListener('click', () => { sel[seat] = id; bs.forEach(([, x, m]) => m()); show(); }); return [id, b, mark]; });
        group.append(...bs.map(([, b]) => b)); rows.append(row, group);
      });
      show(); rows.prepend(summary);
      const go = button('opp', 'Start', null, true); go.addEventListener('click', () => { start.hidden = true; onStart(sel); }); rows.append(go);
      start.className = 'start'; start.replaceChildren(title, rows); start.hidden = false; menuBtn.hidden = true;
    },
    /** The animation board's menu down the left side: `groups` is [{ name, items: [{ id, name }] }]. Returns { active(id) } to mark the one playing. */
    animBoard(groups, { onPick, onBack }) {
      const panel = el('div', 'anim'), marks = new Map();
      panel.append(el('div', 'ttl', 'Animation board'));
      for (const g of groups) {
        panel.append(el('div', 'grp', g.name));
        for (const it of g.items) { const b = el('button', '', it.name); b.type = 'button'; b.addEventListener('click', () => onPick(it.id)); marks.set(it.id, b); panel.append(b); }
      }
      const back = el('button', 'back', '← Main menu'); back.type = 'button'; back.addEventListener('click', onBack); panel.append(back);
      document.body.append(panel);
      return { active(id) { for (const [k, b] of marks) b.classList.toggle('on', k === id); } };
    },
    /** Hide the table behind a cover that names the player about to play. */
    cover(seat) {
      cover.replaceChildren(el('div', 'k', 'Pass the device'), el('div', 'who', `Player ${seat + 1}`), el('div', 'tap', 'Click to begin'));
      cover.hidden = false; cover.shownAt = performance.now();
    },
    get covered() { return !cover.hidden; },
    /** Bot vs Bot, game over: the result with the log one click away (`log` is the text, `file` its file name). Stays until a button is pressed. */
    watchOver(text, log, file, { onHistory, onNew, onTitle }) {
      const row = el('div', 'row'), hb = button('sm', 'History'), nb = button('sm', 'New match'), db = button('sm', 'Download log'), tb = button('sm', 'Title');
      db.addEventListener('click', () => download(file, log)); hb.addEventListener('click', onHistory); nb.addEventListener('click', onNew); tb.addEventListener('click', onTitle);
      row.append(copyButton('Copy log', () => log), db, hb, nb, tb);
      over.dataset.watch = '1'; over.replaceChildren(el('div', 'who', text), row); over.hidden = false;
    },
    /** The History tab button, shown in Bot vs Bot only. */
    historyButton(onClick) { tab.hidden = false; tab.onclick = onClick; },
    /** The list of past bot games: `entries` are `{ title, sub, log, file }`, newest first. */
    history(entries, { onClear }) {
      const close = button('sm', 'Close'), clear = button('sm', 'Clear all'), items = el('div', 'items'), row = el('div', 'row');
      close.addEventListener('click', () => { hist.hidden = true; }); clear.addEventListener('click', () => { onClear(); hist.hidden = true; });
      row.append(copyButton('Copy all', () => entries.map((e) => e.log).join('\n')), clear, close);
      for (const e of entries) {
        const item = el('div', 'item'), what = el('div'), acts = el('div', 'row'), d = button('sm', 'Download'); d.addEventListener('click', () => download(e.file, e.log));
        what.append(e.title, el('div', 'sub', e.sub)); acts.append(copyButton('Copy', () => e.log), d); item.append(what, acts); items.append(item);
      }
      if (!entries.length) items.append(el('div', 'k', 'No bot games yet'));
      hist.replaceChildren(el('div', 'k', 'Bot games'), row, items); hist.hidden = false;
    },
    /** The game is over: the result, and Title / Play again. */
    won(text, { onAgain, onTitle }) {
      const row = el('div', 'row'), again = button('go', 'Play again', null, true), title = button('', 'Title', null, true);
      again.addEventListener('click', () => onAgain()); title.addEventListener('click', () => onTitle()); row.append(title, again);
      over.replaceChildren(el('div', 'who', text), row); over.hidden = false;
    },
    clearWin() { over.hidden = true; delete over.dataset.watch; },
  };
}
