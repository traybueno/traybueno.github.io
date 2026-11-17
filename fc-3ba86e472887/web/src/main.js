/**
 * Field + Chain in the browser. The engine plays the game; this page draws what `viewFor` gives the player's seat, offers the moves `legalMoves` lists
 * (by dragging or tapping cards, and a few buttons) and sends the chosen one to `apply`. Nothing here decides anything about the rules.
 *
 * You play seat 0 against a bot at seat 1 (src/bot.js; pick Squire, Knight or Warlock on the start screen). `?vs=hotseat` plays two humans on one screen
 * instead, with a cover between turns. `?vs=bots&bot0=squire|knight|warlock&bot1=...` (or "Watch two bots" on the start screen) lets two bots play each other
 * while you watch from seat 0 (`?seat=1` flips the view); `?vs=anim` is the animation board (made-up positions and a menu of effects to replay, see animboard.js); the Bot vs Bot game's compact log is `fcLog()` in the console. Dev aids: ?bot=squire|knight|warlock skips the start screen, ?seed=N picks the deal, ?plies=K plays K random
 * legal moves first (a mid-game position to try things on), ?seat=0|1 fixes who is looking, key N deals a new game.
 */
import { newGame, legalMoves, apply, viewFor, CARDS } from '../../src/index.js';
import { loadArt } from './assets.js';
import { Scene } from './scene.js';
import { Input } from './input.js';
import { createUI } from './ui.js';
import { makeBot, PROFILES } from './bot.js';
import { MatchLog } from './match.js';
import { SCENARIOS, build, stepMove } from './animboard.js';

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

  let game, viewer, bots = [], log = null, fan = null, botTimer = null, botMoves = 0, overTimer = null, note = '', noteTimer = null;
  const SPEEDS = { normal: 1, fast: 0.55, off: 0 };
  let speed = (() => { try { return SPEEDS[localStorage.getItem('fc-speed')] !== undefined ? localStorage.getItem('fc-speed') : 'normal'; } catch { return 'normal'; } })();
  scene.fx.speed = SPEEDS[speed];
  const ui = createUI({
    faceOf: (key) => art.faces[key].image,
    onButton: (name) => { const m = input.buttons[name]; if (m) play(m); },
    onCoverDone: () => { input.enabled = true; },
    onRestart: () => (hotseat ? (seed += 1, start()) : watch ? chooseWatch() : choose()),
    onSpeed: () => { speed = speed === 'normal' ? 'fast' : speed === 'fast' ? 'off' : 'normal'; scene.fx.speed = SPEEDS[speed]; try { localStorage.setItem('fc-speed', speed); } catch { /* storage may be unavailable */ } return speed; },
  });
  ui.speed(speed);
  const input = new Input(scene, {
    onMove: (m) => play(m),
    onFan: (owner) => { if (owner !== fan) { fan = owner; scene.show(viewFor(game, viewer), viewer, { fan }); } },
    onChange: () => hint(),
    onPreview: (key) => ui.preview(key),
  });
  const botsTurn = () => !anim && !hotseat && game.phase !== 'over' && (watch || game.turn === BOT);
  const name = () => (watch ? PROFILES[botIds[game.turn]].name : 'Opponent');

  /** One line saying what just happened (the motion alone can leave it unclear), shown for a few seconds. */
  scene.say = (text) => { note = text; hint(); clearTimeout(noteTimer); noteTimer = setTimeout(() => { note = ''; hint(); }, 4200); };
  /** One line of guidance, only when the situation is not obvious. */
  function hint() {
    let text = input.hintText;
    if (anim) text = note;                                                    // the animation board has no guidance, only the lines the motion itself says
    else if (note) text = note;                                               // a line about what just happened wins over guidance for a moment
    else if (botsTurn()) text = `${name()}’s turn`;
    else if (!text && game.phase === 'chain' && !input.sel) { const head = game.players[game.turn].chain[0]; text = head ? `${CARDS[head.key].name}: drag it onto ${head.key === 'shadow' ? 'one of your ready attackers' : legalMoves(game).some((m) => m.type === head.key && m.targetId === undefined) ? 'the table' : 'a target'}, or Skip.` : ''; }
    else if (!text && game.phase === 'bonus') text = 'Attack again, or Skip.';
    ui.hint(text);
  }
  /** Show the game as it is now. `animate` plays the motion of the move that led here (its events); otherwise cards are simply put in place. */
  function sync({ snap = false, animate = false } = {}) {
    const view = viewFor(game, viewer), moves = anim || game.phase === 'over' || botsTurn() ? [] : legalMoves(game);
    scene.show(view, viewer, { snap, fan, events: animate ? view.events : null }); input.setContext({ view, moves, seat: viewer });
    ui.buttons(input.buttons); hint();
    document.title = anim ? 'Field + Chain · Animation board' : `Field + Chain · ${watch ? `Bot ${game.turn + 1}` : botsTurn() ? 'Opponent' : 'Your'} turn`;
    window.fc = { game, viewer, view, scene, input };
    clearTimeout(botTimer);
    // A beat before the bot acts, after the last move has finished playing, so each move can be followed.
    if (botsTurn()) botTimer = setTimeout(botMove, (botMoves++ ? 380 : 650) * Math.max(0.4, scene.fx.k) + scene.fx.remaining * 1000);
  }
  function botMove() {
    if (!botsTurn() || !bots[game.turn]) return;
    play(bots[game.turn].move(game));
  }
  function play(move) {
    const before = game.turn, was = game;
    game = apply(game, move);
    if (log) { log.move(was, move, game); if (game.phase === 'over') { log.finish(game); remember(); } }
    if (game.turn !== before) botMoves = 0;
    if (game.phase === 'over') {
      sync({ animate: true }); if (watch) { overTimer = setTimeout(() => ui.watchOver(`${PROFILES[botIds[game.winner]].name} (Bot ${game.winner + 1}) wins`, log.text(), logFile(), { onHistory: showHistory, onNew: chooseWatch }), 900 * scene.fx.k + 200); return; }
      const text = watch ? `${PROFILES[botIds[game.winner]].name} (Bot ${game.winner + 1}) wins` : hotseat ? `Player ${game.winner + 1} wins` : game.winner === HUMAN ? 'You win' : 'You lose';
      overTimer = setTimeout(() => ui.won(text), 900 * scene.fx.k + 200); return;                // a moment for the last blow to be seen
    }
    if (hotseat && game.turn !== before && fixedSeat === null) { viewer = game.turn; input.enabled = false; ui.cover(viewer); sync({ snap: true }); return; }
    sync({ animate: true });
  }
  function start() {
    clearTimeout(botTimer); clearTimeout(overTimer); clearTimeout(noteTimer); note = ''; botMoves = 0; fan = null;
    game = plies ? dealt(seed, plies) : newGame(seed);
    viewer = fixedSeat ?? (hotseat ? game.turn : HUMAN);
    bots = watch ? botIds.map((id, seat) => makeBot(PROFILES[id], seat, seed * 2 + seat)) : [null, makeBot(PROFILES[profileId], BOT, seed)];
    if (watch) ui.historyButton(showHistory);
    log = watch ? new MatchLog(`seed=${seed} p0=${botIds[0]} p1=${botIds[1]}`) : null;
    ui.clearWin(); input.enabled = true;
    if (plies) sync({ snap: true }); else { scene.clear(); sync({ animate: true }); }       // a new game is dealt: the opening hands are drawn
    if (hotseat && fixedSeat === null) { input.enabled = false; ui.cover(viewer); }
  }
  /** The start screen: pick an opponent, then deal. */
  function choose() {
    ui.clearWin(); seed += 1;
    ui.choose(PROFILES, profileId, (id) => { profileId = id; try { localStorage.setItem('fc-bot', id); } catch { /* storage may be unavailable */ } start(); }, () => { location.search = '?vs=bots'; }, () => { location.search = '?vs=anim'; });
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
    ui.clearWin(); seed += 1; ui.historyButton(showHistory);
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
    animLoad(SCENARIOS[0]);
  }
  window.fcLog = () => (log ? log.text() : '');       // dev: the compact log of a Bot vs Bot game so far
  window.fcPlay = (m) => play(m); window.fcMoves = () => legalMoves(game);       // dev: make a move, list the moves
  window.fcLoad = (g) => { clearTimeout(botTimer); clearTimeout(overTimer); game = g; fan = null; viewer = fixedSeat ?? (hotseat ? g.turn : HUMAN); ui.clearWin(); sync({ snap: true }); };       // dev: show a given game state
  addEventListener('keydown', (e) => {
    if (e.key === 'n' || e.key === 'N') { seed += 1; start(); }
    if (e.key === ' ' && scene.fx.busy) { e.preventDefault(); scene.fx.flush(); scene.settle(0.6); }       // Space: skip what is playing
  });

  if (anim) startAnim();
  else if (watch && params.has('bot0') && params.has('bot1')) start(); else if (watch) { game = newGame(seed); viewer = fixedSeat ?? 0; sync({ snap: true }); chooseWatch(); }
  else if (hotseat || params.has('bot') || plies) start(); else { game = newGame(seed); viewer = HUMAN; sync({ snap: true }); choose(); }
} catch (e) {
  document.body.append(Object.assign(document.createElement('pre'), { textContent: String(e.message || e), style: 'color:#ece2bd;padding:16px' }));
  throw e;
}
