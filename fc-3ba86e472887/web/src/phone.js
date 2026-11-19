/**
 * Phones. A phone (a touch screen whose short side is a phone's) plays the game in landscape only, like a handheld card game: the title can be held
 * either way, but once a game is on the table a phone held upright is asked to turn sideways, and on Start game the page goes full screen and asks
 * the browser to hold landscape (Android does; iPhone Safari cannot be told, so the "turn your phone" screen does the job there).
 *
 * Everything here applies only when `phone` is true, so a desktop (a mouse, a big screen) is never touched. `?phone=1` forces phone mode on any
 * screen (for trying it in a desktop browser at a phone's size), `?phone=0` turns it off.
 *
 * The page gets classes on <html>: `phone` always (in phone mode), `portrait` while the phone is held upright, `ingame` while the title is not up.
 * The CSS for phones keys off those.
 */
const forced = new URLSearchParams(location.search).get('phone');
export const phone = forced === '1' ? true : forced === '0' ? false
  : matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 540;

const root = document.documentElement;
/** Is the phone held sideways now? */
export const landscape = () => innerWidth > innerHeight;

if (phone) {
  root.classList.add('phone');
  const turned = () => root.classList.toggle('portrait', !landscape());
  turned(); addEventListener('resize', turned); addEventListener('orientationchange', turned);
  // The screen that asks for the phone to be turned: shown (by CSS) only while a game is up and the phone is upright.
  const ask = document.createElement('div'); ask.className = 'rotate';
  ask.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="20" y="8" width="24" height="42" rx="3"/><path d="M27 44h10"/><path class="arc" d="M8 40a24 24 0 0 0 20 16"/><path class="arc" d="M24 52l4 4-4 4"/></svg>'
    + '<div class="rk">Turn your phone sideways</div><div class="rs">The table plays in landscape</div>';
  const mount = () => document.body.append(ask);
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
  // In game while the title screen is not showing (the title is the `.start` element ui.js builds).
  const watch = () => { const s = document.querySelector('.start'); root.classList.toggle('ingame', !!s && s.hidden); };
  new MutationObserver(watch).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });
}

/** The phone's right-hand column (buttons, Menu, the rules card) is this wide; the table takes the rest of the screen. Matches --side-w in index.html. */
export const PHONE_COL = 112;
let probe = null;
/** The screen's safe-area insets (the notch, the rounded corners), in px. */
function insets() {
  if (!probe) { probe = document.createElement('div'); probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)'; document.body.append(probe); }
  const st = getComputedStyle(probe); return { l: parseFloat(st.paddingLeft) || 0, r: parseFloat(st.paddingRight) || 0 };
}
/** Where the table goes on a phone held sideways, for a screen `w` px wide: from the left edge (clear of the notch) to the column of buttons. */
export function phoneArea(w) {
  const { l, r } = insets(), left = Math.max(4, l), right = PHONE_COL + Math.max(6, r) + 6;
  return { left, width: Math.max(100, w - left - right) };
}

/** Called from the click on Start game or Learn to play (a user gesture, which full screen and the orientation lock both need). */
export function enterGame() {
  if (!phone) return;
  const lock = () => screen.orientation?.lock?.('landscape').catch(() => {});
  try {
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => {});
    else lock();
  } catch { /* full screen refused: the "turn your phone" screen still does the job */ }
}

/** Back on the title: the phone may be held either way again. */
export function leaveGame() {
  if (!phone) return;
  try { screen.orientation?.unlock?.(); } catch { /* not locked */ }
}
