/**
 * Field + Chain in the browser. The engine plays the game; this page draws what `viewFor` gives the player's seat, offers the moves `legalMoves` lists
 * (by dragging or tapping cards, and a few buttons) and sends the chosen one to `apply`. Nothing here decides anything about the rules.
 *
 * You play seat 0 against a bot at seat 1 (src/bot.js; pick Squire, Knight or Warlock on the start screen). `?vs=hotseat` plays two humans on one screen
 * instead, with a cover between turns. `?vs=bots&bot0=squire|knight|warlock&bot1=...` (or Developer tools › Watch two bots on the title screen) lets two bots play each other
 * while you watch from seat 0 (`?seat=1` flips the view); `?learn=<lesson id>` opens a Learn to play lesson (tutorial.js); `?vs=anim` is the animation board (made-up positions and a menu of effects to replay, see animboard.js); the Bot vs Bot game's compact log is `fcLog()` in the console. Dev aids: ?bot=squire|knight|warlock skips the start screen, ?seed=N picks the deal, ?plies=K plays K random
 * legal moves first (a mid-game position to try things on), ?seat=0|1 fixes who is looking, key N deals a new game.
 */
import { newGame, legalMoves, apply, viewFor, CARDS } from '../../src/index.js';
import { loadArt } from './assets.js';
import { Scene } from './scene.js';
import { Input } from './input.js';
import { createSound } from './sound.js';
import { createMusic } from './music.js';
import { createUI } from './ui.js';
import { makeBot, PROFILES } from './bot.js';
import { MatchLog } from './match.js';
import { SCENARIOS, build, stepMove } from './animboard.js';
import { LESSONS, Tutor, buildLesson } from './tutorial.js';

const params = new URLSearchParams(location.search);
const hotseat = params.get('vs') === 'hotseat', watch = params.get('vs') === 'bots', anim = params.get('vs') === 'anim';
const botIds = [0, 1].map((i) => (PROFILES[params.get(`bot${i}`)] ? params.get(`bot${i}`) : 'knight'));
const HUMAN = 0, BOT = 1;
let seed = params.has('seed') ? Number(params.get('seed')) : (Date.now() >>> 0) % 1000003;
const plies = Number(params.get('plies') ?? 0), fixedSeat = params.has('seat') ? Number(params.get('seat')) : null;
const remembered = (() => { try { return localStorage.getItem('fc-bot'); } catch { return null; } })();
let profileId = PROFILES[params.get('bot')] ? params.get('bot') : PROFILES[remembered] ? remembered : 'knight';

/** A position to try things on: the engine's own legal moves, picked by a small seeded generator, until `n` moves are made and a normal turn is on. */
function dealt(seed, n) {
  let g = newGame(seed), x = (seed * 2654435761) >>> 0, played = 0;
  const rnd = () => { x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return x / 4294967296; };
  while (g.phase !== 'over' && (played < n || g.phase !== 'play') && played < 400) {
    const all = legalMoves(g), ms = all.filter((m) => m.type !== 'end' || rnd() < 0.15), pick = ms.length ? ms : all;
    g = apply(g, pick[Math.floor(rnd() * pick.length)]); played++;
  }
  return g;
}

try {
  const scene = new Scene(document.getElementById('table'));
  const art = await loadArt(scene.renderer);
  scene.setArt(art);
  scene.sound = createSound();                                             // the card, deck and button sounds (sound.js); the motion plan and the pointer play them
  // Every button on the page (start screen, End Turn and the rest, the corner switches) gives a faint sound as the pointer comes onto it, and another when pressed.
  addEventListener('pointerover', (e) => { const b = e.target.closest?.('button'); if (b && !b.disabled && !b.contains(e.relatedTarget)) scene.sound.play('hover', { gain: 0.8 }); });
  addEventListener('click', (e) => { if (e.target.closest?.('button')) scene.sound.play('click'); }, { capture: true });
  const music = createMusic();                                             // the music (music.js): the start screen's track, then a game's; its own On/Off beside the effects

  let tutor = null, lessonAt = -1;                                         // Learn to play (tutorial.js): the lesson being played, if any
  let game, viewer, bots = [], log = null, gather = null, botTimer = null, autoTimer = null, botMoves = 0, overTimer = null, note = '', noteTimer = null, paused = false;
  const SPEEDS = { normal: 1, fast: 0.55, off: 0 };
  let speed = (() => { try { return SPEEDS[localStorage.getItem('fc-speed')] !== undefined ? localStorage.getItem('fc-speed') : 'normal'; } catch { return 'normal'; } })();
  scene.fx.speed = SPEEDS[speed];
  const ui = createUI({
    faceOf: (key) => art.faces[key].image,
    onButton: (name) => { const m = input.buttons[name]; if (m) play(m); },
    onCoverDone: () => { input.enabled = true; },
    onMenu: () => openMenu(),
  });
  /** The settings panel's rows (the same on the title and in the pause menu). */
  const onOff = [[true, 'On'], [false, 'Off']];
  const SETTINGS = [
    { label: 'Motion', options: [['normal', 'Normal'], ['fast', 'Fast'], ['off', 'Off']], get: () => speed,
      set: (v) => { speed = v; scene.fx.speed = SPEEDS[speed]; try { localStorage.setItem('fc-speed', speed); } catch { /* storage may be unavailable */ } } },
    { label: 'Effects', options: onOff, get: () => scene.sound.on, set: (v) => { scene.sound.on = v; } },
    { label: 'Music', options: onOff, get: () => music.on, set: (v) => { music.on = v; } },
  ];
  const input = new Input(scene, {
    onMove: (m) => play(m),
    onGather: (ids) => { if (JSON.stringify(ids) !== JSON.stringify(gather)) { gather = ids; scene.show(viewFor(game, viewer), viewer, { gather }); } },
    onChange: () => hint(),
    onPreview: (key) => ui.preview(key),
  });
  const botsTurn = () => !anim && !hotseat && game.phase !== 'over' && !tutor?.done(game) && (watch || game.turn === BOT);       // a finished lesson stops the opponent too
  const name = () => (watch ? PROFILES[botIds[game.turn]].name : 'Opponent');

  /** One line saying what just happened (the motion alone can leave it unclear), shown for a few seconds. */
  scene.say = (text) => { note = text; hint(); clearTimeout(noteTimer); noteTimer = setTimeout(() => { note = ''; hint(); }, 4200); };
  /** One line of guidance, only when the situation is not obvious. */
  function hint() {
    let text = input.hintText;
    if (anim) text = note;                                                    // the animation board has no guidance, only the lines the motion itself says
    else if (note) text = note;                                               // a line about what just happened wins over guidance for a moment
    else if (tutor && game.phase !== 'over') text = (!botsTurn() && text) || tutor.text(game);      // a lesson says what to do next (a choice in progress says its own line first)
    else if (botsTurn()) text = `${name()}’s turn`;
    else if (!text && game.phase === 'chain' && !input.sel) { const head = game.players[game.turn].chain[0]; text = head ? (head.key === 'shadow' ? 'Shadow Step: drag one of your attackers onto what it attacks, or Skip.' : head.key === 'behind' ? 'Behind You hits every unguarded creature, yours too.' : `${CARDS[head.key].name} is up.`) : ''; }
    else if (!text && game.phase === 'bonus') text = 'Attack again, or Skip.';
    ui.hint(text, { prompt: !!note || (!anim && !botsTurn()) });              // what just happened, and what to tap next, stand out in the middle of the table; "Opponent's turn" stays in the corner
  }
  /** Show the game as it is now. `animate` plays the motion of the move that led here (its events); otherwise cards are simply put in place. */
  function sync({ snap = false, animate = false } = {}) {
    const view = viewFor(game, viewer), all = anim || game.phase === 'over' || botsTurn() ? [] : legalMoves(game), moves = tutor ? tutor.allowed(game, all) : all;      // a lesson offers only the moves it teaches
    scene.show(view, viewer, { snap, gather, events: animate ? view.events : null }); input.setContext({ view, moves, seat: viewer });
    ui.buttons(input.buttons); hint();
    document.title = anim ? 'Field + Chain · Animation board' : `Field + Chain · ${watch ? `Bot ${game.turn + 1}` : botsTurn() ? 'Opponent' : 'Your'} turn`;
    window.fc = { game, viewer, view, scene, input };
    clearTimeout(botTimer); clearTimeout(autoTimer);
    // Behind You has no choice in it (it hits every unguarded creature), so when it reaches the head of a Chain it plays itself, after a beat so it can be seen coming up.
    const behind = !anim && !botsTurn() && game.phase === 'chain' && moves.find((m) => m.type === 'behind');
    if (behind) autoTimer = setTimeout(() => { if (!paused && game.phase === 'chain' && !botsTurn()) { const m = legalMoves(game).find((x) => x.type === 'behind'); if (m) play(m); } }, 850 * Math.max(0.4, scene.fx.k) + scene.fx.remaining * 1000);
    // A beat before the bot acts, after the last move has finished playing, so each move can be followed.
    if (botsTurn()) botTimer = setTimeout(botMove, (botMoves++ ? 380 : 650) * Math.max(0.4, scene.fx.k) + scene.fx.remaining * 1000);
  }
  function botMove() {
    if (paused || !botsTurn() || !bots[game.turn]) return;
    play(bots[game.turn].move(game));
  }
  function play(move) {
    const before = game.turn, was = game;
    game = apply(game, move);
    if (log) { log.move(was, move, game); if (game.phase === 'over') { log.finish(game); remember(); } }
    if (game.turn !== before) botMoves = 0;
    if (tutor) { tutor.played(was, move, game); if (tutor.done(game)) { lessonComplete(); return; } }
    if (game.phase === 'over') {
      sync({ animate: true }); if (watch) { overTimer = setTimeout(() => ui.watchOver(`${PROFILES[botIds[game.winner]].name} (Bot ${game.winner + 1}) wins`, log.text(), logFile(), { onHistory: showHistory, onNew: chooseWatch, onTitle: toTitle }), 900 * scene.fx.k + 200); return; }
      const text = watch ? `${PROFILES[botIds[game.winner]].name} (Bot ${game.winner + 1}) wins` : hotseat ? `Player ${game.winner + 1} wins` : game.winner === HUMAN ? 'You win' : 'You lose';
      overTimer = setTimeout(() => ui.won(text, { onAgain: () => { seed += 1; start(); }, onTitle: toTitle }), 900 * scene.fx.k + 200); return;     // a moment for the last blow to be seen
    }
    if (hotseat && game.turn !== before && fixedSeat === null) { viewer = game.turn; input.enabled = false; ui.cover(viewer); sync({ snap: true }); return; }
    sync({ animate: true });
  }
  function start() {
    tutor = null; lessonAt = -1; ui.lesson(null);
    clearTimeout(botTimer); clearTimeout(autoTimer); clearTimeout(overTimer); clearTimeout(noteTimer); note = ''; botMoves = 0; gather = null; music.game(); scene.sound.play('shuffle');
    game = plies ? dealt(seed, plies) : newGame(seed);
    // `?try=<scenario id>` (an animation-board position, animboard.js) is played by hand instead of replayed; a Chain scenario starts with the Chain released.
    const tried = SCENARIOS.find((x) => x.id === params.get('try'));
    if (tried) { game = build(tried); const first = stepMove(game, tried.steps[0]); if (first?.type === 'release') game = apply(game, first); }
    viewer = fixedSeat ?? (hotseat ? game.turn : HUMAN);
    bots = watch ? botIds.map((id, seat) => makeBot(PROFILES[id], seat, seed * 2 + seat)) : [null, makeBot(PROFILES[profileId], BOT, seed)];
    if (watch) ui.historyButton(showHistory);
    log = watch ? new MatchLog(`seed=${seed} p0=${botIds[0]} p1=${botIds[1]}`) : null;
    ui.clearWin(); ui.closePanels(); ui.menuButton(true); paused = false; input.enabled = true;
    if (plies || tried) sync({ snap: true }); else { scene.clear(); sync({ animate: true }); }       // a new game is dealt: the opening hands are drawn
    if (hotseat && fixedSeat === null) { input.enabled = false; ui.cover(viewer); }
  }
  /** Learn to play: lesson `i` (tutorial.js) on its own board. The opponent plays the lesson's script; only the moves the lesson teaches are offered. */
  function startLesson(i) {
    const lesson = LESSONS[i];
    clearTimeout(botTimer); clearTimeout(autoTimer); clearTimeout(overTimer); clearTimeout(noteTimer); note = ''; botMoves = 0; gather = null; music.game();
    tutor = new Tutor(lesson); lessonAt = i; game = buildLesson(lesson); viewer = HUMAN; bots = [null, tutor.foe()]; log = null;
    ui.hideTitle(); ui.clearWin(); ui.closePanels(); ui.menuButton(true); paused = false; input.enabled = true;
    ui.lesson({ label: `Lesson ${i + 1} of ${LESSONS.length} · ${lesson.name}`, goal: lesson.intro });
    scene.fx.flush(); scene.clear(); sync({ snap: true });
  }
  const LKEY = 'fc-lessons';
  const finished = () => { try { return new Set(JSON.parse(localStorage.getItem(LKEY)) || []); } catch { return new Set(); } };
  function lessonComplete() {
    const lesson = LESSONS[lessonAt], last = lessonAt === LESSONS.length - 1;
    try { localStorage.setItem(LKEY, JSON.stringify([...new Set([...finished(), lesson.id])])); } catch { /* storage may be unavailable */ }
    sync({ animate: true }); input.enabled = false;
    const at = lessonAt;
    overTimer = setTimeout(() => ui.lessonDone({
      title: `${lesson.name}: complete`, text: lesson.outro, next: last ? 'Play the Squire' : `Next: ${LESSONS[at + 1].name}`,
      onNext: () => { if (last) { profileId = 'squire'; start(); } else startLesson(at + 1); },
      onLessons: () => showLessons(),
    }), 1100 * scene.fx.k + 300);       // a moment for the last move to be seen
  }
  /** The list of lessons (from the title, the pause menu, or a finished lesson). */
  function showLessons() {
    const done = finished();
    ui.lessons(LESSONS.map((l, i) => [`${i + 1}. ${l.name}${done.has(l.id) ? '  ✓' : ''}`, () => startLesson(i), l.intro]));
  }
  /** The title screen: pick an opponent (nothing starts), then Start game deals. Settings and the developer tools open from its two small links. */
  function choose() {
    ui.clearWin(); ui.closePanels(); seed += 1; music.menu();
    ui.title({
      profiles: PROFILES, pick: profileId, settings: SETTINGS,
      onPick: (id) => { profileId = id; try { localStorage.setItem('fc-bot', id); } catch { /* storage may be unavailable */ } },
      onLeave: () => music.hush(0.9),                                        // Start game pressed: the menu track falls away into the dark beat
      onStart: (id) => { profileId = id; start(); },
      onLearn: () => showLessons(),
      dev: [
        ['Watch two bots', () => { location.search = '?vs=bots'; }, 'Pick a level for each side'],
        ['Animation board', () => { location.search = '?vs=anim'; }, 'Replay every effect on a set board'],
        ['Sound lab', () => { location.href = './sounds.html'; }, 'Hear and pick the card sounds'],
        ['Two players, one screen', () => { location.search = '?vs=hotseat'; }, 'Pass the device between turns'],
      ],
    });
  }
  /** Back to the title from anywhere. The plain game goes back in place; the other modes live in the address, so they reload without it. */
  function toTitle() {
    if (anim || watch || hotseat || params.has('bot') || params.has('learn') || plies) { location.search = ''; return; }
    clearTimeout(botTimer); clearTimeout(autoTimer); clearTimeout(overTimer); clearTimeout(noteTimer); note = ''; paused = false;
    tutor = null; lessonAt = -1; ui.lesson(null); ui.clearWin(); bots = [];
    scene.fx.flush(); scene.clear(); input.enabled = true; gather = null;
    game = newGame(seed); viewer = HUMAN; sync({ snap: true }); choose();
  }
  /** The pause menu (the corner Menu button or Esc): the bot and any automatic move wait, the table takes no input, until it closes. */
  function openMenu() {
    if (ui.panelOpen || ui.onTitle) return;
    paused = true; clearTimeout(botTimer); clearTimeout(autoTimer); input.cancel();
    const wasEnabled = input.enabled; input.enabled = false; ui.preview(null);
    const items = [];
    if (anim) items.push(['Leave to title', toTitle]);
    else {
      if (tutor) items.push(['Restart lesson', () => { ui.closePanels(); startLesson(lessonAt); }], ['Lessons', () => { ui.closeMenu(); showLessons(); }]);
      else if (watch) items.push(['New match', () => { ui.closePanels(); chooseWatch(); }], ['History', () => { ui.closeMenu(); showHistory(); }]);
      else items.push(['New deal', () => { ui.closePanels(); seed += 1; start(); }, 'Same opponent']);
      items.push(['Leave to title', () => (game.phase === 'over' ? toTitle() : ui.confirm('Leave this game?', 'Leave', 'Stay', toTitle))]);
    }
    ui.menu(items, SETTINGS, () => { paused = false; input.enabled = wasEnabled; if (!anim) sync(); });       // sync puts the bot's (or Behind You's) next move back on its timer
  }
  // Bot vs Bot history: every finished game's log is kept in this browser (newest first, the last 40).
  const HKEY = 'fc-history';
  const entries = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };
  const logFile = () => `fc-${botIds[0]}-vs-${botIds[1]}-seed${seed}.txt`;
  function remember() {
    const e = { seed, bots: botIds, winner: game.winner, turns: game.turnNumber, at: Date.now(), log: log.text() };
    try { localStorage.setItem(HKEY, JSON.stringify([e, ...entries()].slice(0, 40))); } catch { /* storage may be unavailable */ }
  }
  function showHistory() {
    const name = (id) => PROFILES[id].name;
    ui.history(entries().map((e) => ({ title: `${name(e.bots[0])} vs ${name(e.bots[1])}`, sub: `${new Date(e.at).toLocaleString()} · seed ${e.seed} · ${e.winner === null ? 'no winner' : `Bot ${e.winner + 1} wins`} · ${e.turns} turns`, log: e.log, file: `fc-${e.bots[0]}-vs-${e.bots[1]}-seed${e.seed}.txt` })), { onClear: () => { try { localStorage.removeItem(HKEY); } catch { /* storage may be unavailable */ } } });
  }
  /** Bot vs Bot: pick a level for each seat, then watch. */
  function chooseWatch() {
    ui.clearWin(); ui.closePanels(); seed += 1; music.menu(); ui.historyButton(showHistory);
    ui.chooseBots(PROFILES, botIds, (ids) => { location.search = `?vs=bots&bot0=${ids[0]}&bot1=${ids[1]}&seed=${seed}`; });
  }
  /** The animation board: a made-up position (animboard.js), and a script of real moves that plays on it; then the board is set out again. */
  let animTimer = null, animRun = 0, animMenu = null;
  function animLoad(sc) { clearTimeout(animTimer); animRun++; scene.fx.flush(); scene.clear(); note = ''; game = build(sc); viewer = 0; sync({ snap: true }); }
  function animPlay(sc) {
    animLoad(sc); animMenu.active(sc.id);
    const run = animRun; let i = 0;
    const next = () => {
      if (run !== animRun) return;
      if (i >= sc.steps.length) { animTimer = setTimeout(() => { if (run === animRun) animLoad(sc); }, 1500 + scene.fx.remaining * 1000); return; }       // a moment to take the last of it in, then the board is set out again
      const m = stepMove(game, sc.steps[i++]);
      if (m) { game = apply(game, m); sync({ animate: true }); }
      animTimer = setTimeout(next, 400 + scene.fx.remaining * 1000 + 300);
    };
    animTimer = setTimeout(next, 450);
  }
  function startAnim() {
    input.enabled = false;
    const groups = [], by = new Map();
    for (const sc of SCENARIOS) { if (!by.has(sc.group)) { const g = { name: sc.group, items: [] }; by.set(sc.group, g); groups.push(g); } by.get(sc.group).items.push({ id: sc.id, name: sc.name }); }
    animMenu = ui.animBoard(groups, { onPick: (id) => animPlay(SCENARIOS.find((x) => x.id === id)), onBack: () => { location.search = ''; } });
    animLoad(SCENARIOS[0]); ui.menuButton(true);
  }
  window.fcLog = () => (log ? log.text() : '');       // dev: the compact log of a Bot vs Bot game so far
  window.fcPlay = (m) => play(m); window.fcMoves = () => legalMoves(game);       // dev: make a move, list the moves
  window.fcLoad = (g) => { clearTimeout(botTimer); clearTimeout(overTimer); game = g; gather = null; viewer = fixedSeat ?? (hotseat ? g.turn : HUMAN); ui.clearWin(); sync({ snap: true }); };       // dev: show a given game state
  // Esc: back one panel; otherwise, during play, open the menu. A card picked up or a choice in progress is let go first (input.js), so this
  // listens in the capture phase to see that before input.js clears it.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ui.panelOpen) { ui.panelBack(); return; }
    if (!input.sel && !input.choice && !input.drag && !ui.onTitle && !ui.covered) openMenu();
  }, { capture: true });
  addEventListener('keydown', (e) => {
    if (ui.panelOpen || ui.onTitle) return;
    if ((e.key === 'n' || e.key === 'N') && !tutor) { seed += 1; start(); }
    if (e.key === ' ' && scene.fx.busy) { e.preventDefault(); scene.fx.flush(); scene.settle(0.6); }       // Space: skip what is playing
  });

  if (anim) startAnim();
  else if (watch && params.has('bot0') && params.has('bot1')) start(); else if (watch) { game = newGame(seed); viewer = fixedSeat ?? 0; sync({ snap: true }); chooseWatch(); }
  else if (params.has('learn')) { const i = LESSONS.findIndex((l) => l.id === params.get('learn')); game = newGame(seed); startLesson(Math.max(0, i)); }
  else if (hotseat || params.has('bot') || plies) start(); else { game = newGame(seed); viewer = HUMAN; sync({ snap: true }); choose(); }
} catch (e) {
  document.body.append(Object.assign(document.createElement('pre'), { textContent: String(e.message || e), style: 'color:#ece2bd;padding:16px' }));
  throw e;
}
