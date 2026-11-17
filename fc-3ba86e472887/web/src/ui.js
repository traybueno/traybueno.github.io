/**
 * The few things that are not on the table: the End Turn button and the Release, Recover and Skip buttons that appear only when they apply, a one-line
 * hint, a big preview of the card under the pointer, the opponent chooser shown before a game, the "pass the device" cover (two-player mode only), and
 * the line shown when the game is over. Plain DOM over the canvas; no menus, no panels.
 */

const LABEL = { normal: 'Motion · Normal', fast: 'Motion · Fast', off: 'Motion · Off' };

/** `faceOf(key)` is the finished face of a card (the canvas the table's card is textured from), so the preview shows the same words. */
export function createUI({ faceOf, onButton, onCoverDone, onRestart, onSpeed }) {
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
  const bar = el('div', 'bar'), hist = el('div', 'hist'), tab = el('button', 'tabbtn', 'History'), hint = el('div', 'hint'), cover = el('div', 'cover'), over = el('div', 'over'), start = el('div', 'start'), preview = el('div', 'preview');
  const urls = {}, previewImg = el('img'); previewImg.alt = ''; previewImg.draggable = false; preview.append(el('div', 'pimg')); preview.firstChild.append(previewImg);
  const buttons = {};
  for (const [name, label] of [['skip', 'Skip'], ['recover', 'Recover'], ['release', 'Release'], ['end', 'End Turn']]) {
    const b = button(name, label); b.hidden = true; b.addEventListener('click', () => onButton(name)); bar.append(b); buttons[name] = b;
  }
  const speed = el('button', 'speed'); speed.type = 'button'; speed.title = 'How fast the moves play. Space skips what is playing.'; speed.addEventListener('click', () => { speed.textContent = LABEL[onSpeed()]; });
  cover.hidden = true; over.hidden = true; start.hidden = true; hist.hidden = true; tab.hidden = true; tab.type = 'button'; hint.style.opacity = 0;
  cover.addEventListener('pointerdown', () => { if (performance.now() - cover.shownAt > 350) { cover.hidden = true; onCoverDone(); } });
  over.addEventListener('pointerdown', () => { if (!over.dataset.watch) onRestart(); });
  document.body.append(preview, bar, hint, speed, tab, cover, over, start, hist);
  let shown = null;
  return {
    /** Show the buttons for the moves that exist (an object of name -> move or null). */
    buttons(avail) {
      for (const [n, b] of Object.entries(buttons)) { b.hidden = !avail[n]; b.style.animationDelay = `${-(performance.now() % 1500)}ms`; }    // every button blinks in step
    },
    /** Show the current speed setting ('normal', 'fast', 'off'). */
    speed(mode) { speed.textContent = LABEL[mode]; },
    hint(text) { hint.textContent = text || ''; hint.style.opacity = text ? 1 : 0; },
    /** A big copy of the card the pointer is on (null to hide it). */
    preview(key) {
      if (key === shown) return; shown = key;
      if (key) previewImg.src = (urls[key] ??= faceOf(key).toDataURL());
      preview.classList.toggle('on', !!key);
    },
    /** The opponent chooser: `profiles` is { id: { name, blurb } }; `onPick(id)` starts the game. */
    choose(profiles, last, onPick, onWatch, onAnim) {
      const title = el('div', 'title'); title.append(el('span', 'rule'), el('span', 'name', 'Field + Chain'), el('span', 'rule'));
      const list = el('div', 'list');
      for (const [id, p] of Object.entries(profiles)) { const b = button(`opp${id === last ? ' last' : ''}`, p.name, p.blurb, true); b.addEventListener('click', () => { start.hidden = true; onPick(id); }); list.append(b); }
      if (onWatch) { const w = button('opp watch', 'Watch two bots', 'Pick a level for each', true); w.addEventListener('click', onWatch); list.append(w); }
      if (onAnim) { const a = button('opp watch', 'Animation board', 'Replay every effect on a set board', true); a.addEventListener('click', onAnim); list.append(a); }
      start.replaceChildren(title, el('div', 'k', 'Choose your opponent'), list); start.hidden = false;
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
      start.replaceChildren(title, rows); start.hidden = false;
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
      cover.replaceChildren(el('div', 'k', 'Pass the device'), el('div', 'who', `Player ${seat + 1}`), el('div', 'tap', 'Tap to begin'));
      cover.hidden = false; cover.shownAt = performance.now();
    },
    get covered() { return !cover.hidden; },
    /** Bot vs Bot, game over: the result with the log one click away (`log` is the text, `file` its file name). Stays until a button is pressed. */
    watchOver(text, log, file, { onHistory, onNew }) {
      const row = el('div', 'row'), hb = button('sm', 'History'), nb = button('sm', 'New match'), db = button('sm', 'Download log');
      db.addEventListener('click', () => download(file, log)); hb.addEventListener('click', onHistory); nb.addEventListener('click', onNew);
      row.append(copyButton('Copy log', () => log), db, hb, nb);
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
    won(text) { over.replaceChildren(el('div', 'who', text), el('div', 'tap', 'Tap to play again')); over.hidden = false; },
    clearWin() { over.hidden = true; delete over.dataset.watch; },
  };
}
