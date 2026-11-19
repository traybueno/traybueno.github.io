/** The supplied card art: one blank face per card key (the engine's `CARDS` keys; frame and picture, no words), with the engine's name, type and text drawn on it (face.js), and one card back. */
import * as THREE from 'three';
import { CARDS } from '../../src/index.js?v=80ff107';
import { drawFace, FONT } from './face.js?v=80ff107';

const BASE = new URL('../assets/cards/', import.meta.url);
/** Engine card key -> blank image file (without .png). The Berserker is the `maniac` card. */
export const FACE_FILE = { heart: 'heart', knight: 'knight', maniac: 'maniac', guardian: 'guardian', angel: 'angel', lantern: 'lanternkeeper', portal: 'warpportal', resolve: 'heavensresolve', fireball: 'fireball', shift: 'shift', behind: 'behindyou', shadow: 'shadowstep', rally: 'rally', kiss: 'witchkiss' };
export const BACK_FILE = 'cardback';

const load = (loader, file) => new Promise((ok, fail) => loader.load(new URL(`${file}.png`, BASE).href, ok, undefined, () => fail(new Error(`missing art: ${file}.png`))));

/** Load every face and the back. Rejects naming any card the art folder does not cover. */
export async function loadArt(renderer) {
  const missing = Object.keys(CARDS).filter((k) => !FACE_FILE[k]);
  if (missing.length) throw new Error(`no art mapped for: ${missing.join(', ')}`);
  const loader = new THREE.TextureLoader();
  const prep = (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  const faces = {};
  await Promise.all(FONT.weights.map((w) => document.fonts.load(`${w} 40px "${FONT.family}"`)));          // the lettering is drawn into the faces, so the font must be ready first
  await Promise.all([...Object.entries(FACE_FILE).map(async ([key, file]) => { const blank = await load(loader, file); faces[key] = prep(new THREE.CanvasTexture(drawFace(blank.image, key))); blank.dispose(); }), load(loader, BACK_FILE).then((t) => { faces.__back = prep(t); })]);
  const { __back: back, ...rest } = faces;
  return { faces: rest, back, edge: Object.fromEntries(Object.entries(rest).map(([k, t]) => [k, borderColor(t)])), backEdge: borderColor(back) };
}

/** The colour of a card's outer border line, sampled from the art, for the card's edge. */
function borderColor(tex) {
  const img = tex.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const [r, gr, b] = g.getImageData(34, Math.floor(img.height / 2), 1, 1).data;
  return new THREE.Color().setRGB(r / 255, gr / 255, b / 255, THREE.SRGBColorSpace);
}
