/**
 * The card sounds, made on the spot with Web Audio (no sound files): small, soft, papery or wooden, each played a touch higher or lower every
 * time so a run of the same sound never repeats exactly. A run of draws lifts very slightly, card by card.
 *
 * Sounds: 'deal' (a card flicked off the pile), 'flip' (a card turned over), 'grab' (picked up by the pointer), 'place' (set down on the table),
 * 'return' (let go and sliding back), 'clash' (a blow lands), 'death' (a card is defeated and torn away), 'tick' (a light tap, for a spell lit in a Chain), 'shuffle' (the deck riffled as a game begins).
 * `play(name, { pan, gain, step })`: `pan` from -1 (left) to 1 (right), `gain` a multiplier, `step` how far up a run this one is.
 *
 * Interface sounds: 'hover' (the pointer comes onto a button) and 'click' (a button is pressed).
 *
 * 'click' comes in candidates (a, b, c), tried out side by side on web/sounds.html; the one picked there is remembered in
 * this browser and is what the game plays.
 *
 * Nothing is made until the page has been touched or a key pressed (browsers keep audio silent until then). Off and on is remembered in this browser.
 */

const KEY = 'fc-sound', PICK = 'fc-sound-pick2';      // (a new key: picks from earlier rounds named candidates that are gone)
/** The candidates for each sound that has them, each with a short name, and the one played until another is picked. */
export const CANDIDATES = {
  click: { a: 'Tick, fuller: the hover tick with more body', b: 'Double tick: the hover tick and a softer one just after', c: 'Low tick: the hover tick, lower and rounder' },
};
const DEFAULT = { click: 'a' };
const rand = (a, b) => a + Math.random() * (b - a);

export function createSound() {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let on = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
  let ctx = null, out = null, noise = null;
  const pick = (() => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(PICK) || '{}') }; } catch { return { ...DEFAULT }; } })();
  const last = new Map();                                    // when each sound last started, so a dozen blows landing together make one clean hit

  function wake() {
    if (!Ctx || !on) return;
    if (!ctx) {
      ctx = new Ctx();
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
      // Everything passes a gentle top cut (so nothing is shrill) and a little of it into a short soft room, so the sounds have some air round them and are not so tight.
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 6500; tone.Q.value = 0.5;
      out = ctx.createGain(); out.gain.value = 0.7; out.connect(tone).connect(comp).connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const n = Math.floor(ctx.sampleRate * 0.45), ir = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const b = ir.getChannelData(ch); for (let i = 0; i < n; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
      const room = ctx.createConvolver(); room.buffer = ir;
      const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 3200;
      const wet = ctx.createGain(); wet.gain.value = 0.16; out.connect(room).connect(damp).connect(wet).connect(comp);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  if (typeof addEventListener === 'function') for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, wake, { capture: true });

  // ---- building blocks: a burst of filtered noise, and a short tone, each with its own fast envelope ---------------------------------------------
  /** Filtered noise from `t` for `dur` s: `type` and `f0`→`f1` the filter sweep, `q` its sharpness, `peak` the loudness, `atk` the rise. */
  function hiss(dest, t, dur, { type = 'bandpass', f0, f1 = f0, q = 1, peak = 0.5, atk = 0.003, curve = 'exp' }) {
    const src = ctx.createBufferSource(); src.buffer = noise; src.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur); else g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(dest); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    return g;
  }
  /** A tone from `t`: `f0`→`f1` Hz over `glide` s, dying away over `dur` s. */
  function tone(dest, t, dur, { type = 'sine', f0, f1 = f0, glide = dur, peak = 0.4, atk = 0.002 }) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + glide);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  // ---- the sounds ------------------------------------------------------------------------------------------------------------------------------
  // Each is given where to send its sound (`d`), when to start (`t`) and a pitch multiplier (`p`).
  const SOUNDS = {
    deal(d, t, p) {                                          // a soft "fwip": the card's edge brushing off the pile, rounded at both ends so a fast run of them flows rather than rattles
      hiss(d, t, 0.13, { f0: 900 * p, f1: 2200 * p, q: 1.1, peak: 0.2, atk: 0.035 });
      hiss(d, t + 0.02, 0.1, { type: 'lowpass', f0: 700 * p, f1: 300, q: 0.6, peak: 0.1, atk: 0.02 });
    },
    shuffle(d, t, p) {                                       // a game begins: a short soft riffle of the deck, settling with a light brush as it is squared up
      for (let i = 0; i < 12; i++) { const k = t + i * 0.022 * rand(0.85, 1.15); hiss(d, k, 0.03, { f0: rand(1500, 2400) * p, q: 1.6, peak: 0.07 + 0.05 * Math.sin((i / 11) * Math.PI), atk: 0.004 }); }
      hiss(d, t + 0.28, 0.06, { type: 'lowpass', f0: 900 * p, f1: 300, q: 0.6, peak: 0.1, atk: 0.004 });
    },
    grab(d, t, p) {                                          // pinch: a tiny papery tick under the finger, a breath of air
      hiss(d, t, 0.025, { f0: 2200 * p, q: 2, peak: 0.16, atk: 0.001 });
      hiss(d, t + 0.01, 0.06, { f0: 1500 * p, f1: 2500 * p, q: 1, peak: 0.08, atk: 0.015 });
    },
    hover(d, t, p) { tone(d, t, 0.03, { f0: 1800 * p, peak: 0.05 }); },                       // a faint high tick
    place(d, t, p) {                                         // card on card: two quick paper ticks and a breath
      hiss(d, t, 0.02, { f0: 2000 * p, q: 2, peak: 0.18, atk: 0.001 });
      hiss(d, t + 0.018, 0.03, { f0: 1200 * p, q: 1.5, peak: 0.15, atk: 0.001 });
      hiss(d, t + 0.02, 0.06, { type: 'lowpass', f0: 900 * p, f1: 300, q: 0.5, peak: 0.06, atk: 0.01 });
    },
    flip(d, t, p) { hiss(d, t, 0.06, { f0: 1500 * p, f1: 2500 * p, q: 1, peak: 0.1, atk: 0.015 }); },                     // a soft brush of air
    return(d, t, p) {                                        // a soft sliding hush that ends in a tick
      hiss(d, t, 0.12, { type: 'lowpass', f0: 1800 * p, f1: 600, q: 0.6, peak: 0.12, atk: 0.02 });
      hiss(d, t + 0.1, 0.015, { f0: 1800 * p, q: 2, peak: 0.08, atk: 0.001 });
    },
    clash(d, t, p) {                                    // rip: a sharp tear of card stock, gritty with small snaps
      hiss(d, t, 0.1, { f0: 3000 * p, f1: 1500 * p, q: 1.5, peak: 0.34, atk: 0.002 });
      for (let i = 0; i < 5; i++) hiss(d, t + i * rand(0.012, 0.022), 0.012, { f0: rand(2000, 3600) * p, q: 2, peak: 0.16, atk: 0.001 });
      hiss(d, t, 0.03, { type: 'lowpass', f0: 1200 * p, f1: 500, q: 0.6, peak: 0.14, atk: 0.001 });
    },
    death(d, t, p) {                                    // a short dry tear with a few snaps through it
      hiss(d, t, 0.16, { f0: 2600 * p, f1: 1400 * p, q: 2, peak: 0.16, atk: 0.01 });
      for (let i = 0; i < 4; i++) hiss(d, t + 0.02 + i * rand(0.025, 0.04), 0.012, { f0: rand(1800, 3000) * p, q: 2, peak: 0.12, atk: 0.001 });
    },
    tick(d, t, p) { hiss(d, t, 0.02, { f0: 2200 * p, q: 2, peak: 0.12, atk: 0.001 }); },
    // -- the candidates (see CANDIDATES) --
    'click.a'(d, t, p) {                                     // the hover tick, fuller, with a speck of paper under it
      tone(d, t, 0.05, { f0: 1500 * p, peak: 0.1 });
      hiss(d, t, 0.01, { f0: 2200 * p, q: 2, peak: 0.05, atk: 0.001 });
    },
    'click.b'(d, t, p) {                                     // the hover tick, then a second softer one a step lower
      tone(d, t, 0.03, { f0: 1800 * p, peak: 0.07 });
      tone(d, t + 0.03, 0.04, { f0: 1350 * p, peak: 0.06 });
    },
    'click.c'(d, t, p) {                                     // the hover tick, lower and rounder, with a breath after
      tone(d, t, 0.045, { f0: 1100 * p, peak: 0.1 });
      hiss(d, t + 0.01, 0.04, { f0: 1500 * p, f1: 2400 * p, q: 1, peak: 0.04, atk: 0.01 });
    },
  };
  /** A sound that waits for another to finish: the shuffle that starts a game waits for the click on the button that started it, rather than landing on top of it. */
  const AFTER = { shuffle: ['click', 0.18] };
  const GAP = { shuffle: 0.5, clash: 0.05, death: 0.06, place: 0.03, deal: 0.03, flip: 0.02, tick: 0.02, grab: 0.05, return: 0.05, hover: 0.03, click: 0.03 };

  return {
    get on() { return on; },
    set on(v) { on = !!v; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage may be unavailable */ } if (on) wake(); },
    names: [...new Set(Object.keys(SOUNDS).map((n) => n.split('.')[0]))],
    /** The candidate played for `name` ('a', 'b' or 'c'). */
    choice: (name) => pick[name],
    /** Play candidate `v` for `name` from now on (remembered in this browser). */
    choose(name, v) { if (!CANDIDATES[name]?.[v]) return; pick[name] = v; try { localStorage.setItem(PICK, JSON.stringify(pick)); } catch { /* storage may be unavailable */ } },
    /** `variant`: play that candidate this once, instead of the one picked. */
    play(name, { pan = 0, gain = 1, step = 0, variant = null } = {}) {
      const fn = SOUNDS[CANDIDATES[name] ? `${name}.${variant ?? pick[name]}` : name];
      if (!on || !ctx || ctx.state !== 'running' || !fn) return;
      let t = ctx.currentTime + 0.005;
      if (t - (last.get(name) ?? -1) < GAP[name]) return;
      const after = AFTER[name]; if (after) t = Math.max(t, (last.get(after[0]) ?? -1) + after[1]);
      last.set(name, t);
      const g = ctx.createGain(); g.gain.value = gain;
      const sp = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (sp) { sp.pan.value = Math.max(-1, Math.min(1, pan)) * 0.6; g.connect(sp).connect(out); } else g.connect(out);
      fn(g, t, rand(0.95, 1.05) * Math.pow(2, Math.min(step, 14) / 160));     // a run lifts only very slightly card by card (a clear climb sounded cheesy)
    },
  };
}
