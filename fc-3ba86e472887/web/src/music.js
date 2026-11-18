/**
 * The music: five tracks from web/assets/music, played with plain audio elements (the card sounds are in sound.js; the music has its own On/Off).
 * `menu()`: the start screen, Sacred Grove of the Sapphire Cascades first and always, fading in softly and looping until a game starts.
 * `game()`: a game has started: the menu track fades out and Church of Crystal Power fades in over it, then the other four (Sacred Grove included)
 * follow in a shuffled order, and all five again in a fresh shuffle after that. Tracks overlap and cross-fade into each other instead of cutting.
 * Browsers keep audio silent until the page is touched, so a track that is refused starts on the first click or key press.
 */

const DIR = new URL('../assets/music/', import.meta.url);
export const TRACKS = {
  grove: 'sacred-grove.mp3',
  church: 'church-of-crystal-power.mp3',
  runes: 'five-holy-runes.mp3',
  pools: 'reflective-pools.mp3',
  rain: 'eternal-raindrops.mp3',
};
const KEY = 'fc-music';
const FADE_IN = 2.5, FADE_OUT = 1.6, OVERLAP = 5;       // seconds: a track rising, the old one falling away on a change, and how long before a track's end the next begins

/** A fresh shuffle of `ids`; if `avoid` is given the first one is never `avoid` (so a track is not heard twice in a row). */
export function shuffled(ids, avoid = null, rnd = Math.random) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 1 && a[0] === avoid) { const k = 1 + Math.floor(rnd() * (a.length - 1)); [a[0], a[k]] = [a[k], a[0]]; }
  return a;
}

export function createMusic({ volume = 0.22 } = {}) {
  const Audio_ = globalThis.Audio;
  let on = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
  let mode = null, queue = [], current = null, el = null, blocked = false;
  const fading = new Set();                                                    // tracks on their way out

  /** Move `a`'s volume to `to` over `secs`; `done` runs when it gets there. */
  function fade(a, to, secs, done) {
    clearInterval(a._fade);
    const from = a.volume, t0 = performance.now();
    a._fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (secs * 1000));
      a.volume = Math.max(0, Math.min(1, from + (to - from) * (k * k * (3 - 2 * k))));           // eased, so it neither jumps nor lingers
      if (k >= 1) { clearInterval(a._fade); done?.(); }
    }, 40);
  }
  function release(a, secs = FADE_OUT) {
    if (!a) return;
    a.onended = null; a.ontimeupdate = null; fading.add(a);
    fade(a, 0, secs, () => { a.pause(); fading.delete(a); });
  }
  function play(id, secs = FADE_IN) {
    if (!Audio_) return;
    release(el);
    current = id;
    const a = new Audio_(new URL(TRACKS[id], DIR).href);
    el = a; a.volume = 0; a.preload = 'auto';
    if (mode === 'menu') a.loop = true;
    else {
      let handed = false;
      const handOver = () => { if (!handed && el === a) { handed = true; next(); } };
      a.ontimeupdate = () => { if (a.duration && a.duration - a.currentTime < OVERLAP) handOver(); };
      a.onended = handOver;
    }
    if (!on) return;
    a.play().then(() => { blocked = false; fade(a, volume, secs); }, () => { blocked = true; });
  }
  function next() {
    if (mode !== 'game') return;
    if (!queue.length) queue = shuffled(Object.keys(TRACKS), current);
    play(queue.shift());
  }
  function resume() { if (blocked && on && el) { const a = el; a.play().then(() => { blocked = false; fade(a, volume, FADE_IN); }, () => {}); } }
  if (typeof addEventListener === 'function') for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, resume, { capture: true });

  return {
    get on() { return on; },
    set on(v) {
      on = !!v; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage may be unavailable */ }
      if (!el) return;
      const a = el;
      if (on) a.play().then(() => { blocked = false; fade(a, volume, FADE_IN); }, () => { blocked = true; });
      else fade(a, 0, 0.5, () => a.pause());
    },
    get now() { return current; },
    /** The start screen: Sacred Grove, always first. Does nothing if it is already playing. */
    menu() { if (mode === 'menu') return; mode = 'menu'; queue = []; play('grove'); },
    /** Quiet: whatever is playing fades away over `secs` and nothing follows it (the pause between Start game and the deal). */
    hush(secs = 1) { mode = null; queue = []; release(el, secs); el = null; current = null; },
    /** A game has started: Church of Crystal Power fades in over the menu track, then the rest shuffled. Does nothing if a game's music is already going. */
    game() { if (mode === 'game') return; mode = 'game'; queue = shuffled(['grove', 'runes', 'pools', 'rain']); play('church', 3); },
  };
}
