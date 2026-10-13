/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — dev/game-smoke.js
   Boots the game layer in Node against a stub DOM and runs a few thousand
   frames of walking, looking, opening panels and taking seals, to shake out
   runtime errors before a browser ever sees it.
     node dev/game-smoke.js
   ═════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ── a very small DOM ─────────────────────────────────────────────────── */
function el() {
  const e = {
    style: {}, children: [], textContent: '', innerHTML: '', width: 960, height: 540,
    clientWidth: 960, clientHeight: 540, value: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return el(); },
    querySelectorAll() { return []; },
    getContext() { return ctx2d(); },
    requestPointerLock() {},
    remove() {},
    focus() {},
  };
  return e;
}
function ctx2d() {
  return {
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {}, fillRect() {}, save() {}, restore() {}, fillStyle: '#000', globalAlpha: 1,
  };
}
const doc = {
  hidden: false,
  createElement: () => el(),
  getElementById: () => el(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  pointerLockElement: null,
  exitPointerLock() {},
};
const listeners = {};
const win = {
  document: doc,
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener(k, f) { (listeners[k] = listeners[k] || []).push(f); },
  removeEventListener() {},
  requestAnimationFrame(f) { win._raf = f; },
  location: { href: '' },
};
win.window = win;

const files = ['js/core/noise.js', 'js/core/mathx.js', 'js/core/textures.js', 'js/core/render.js',
  'js/core/audio.js', 'js/world/geom.js', 'js/world/house.js', 'js/game/game.js'];
const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const IH = new Function('window', 'document', 'globalThis', src +
  '\n;return (typeof window!=="undefined"?window:globalThis).IH;')(win, doc, globalThis);

let errors = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { errors++; console.log('  FAIL ' + name + ' :: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n')); }
}

const canvas = el();
const ui = { room: el(), seals: el(), elev: el(), compass: el(), inverted: el(), msg: el(), prompt: el(), fps: el(), note: el(), atlas: el(), crosshair: el() };
const G = IH.game.create({ canvas: canvas, ui: ui });
check('the game boots', () => {
  if (!G.world || !G.R) throw new Error('no world/renderer');
  if (G.R.w < 100 || G.R.h < 60) throw new Error('renderer sized wrong: ' + G.R.w + 'x' + G.R.h);
});
check('the renderer shares the ImageData buffer', () => {
  if (!(G.buf32 instanceof Uint32Array)) throw new Error('no buffer');
  if (G.R.buf !== G.buf32) throw new Error('buffers not shared');
});

/* drive it by hand */
G.paused = false;
G.readNotes = {};
G.sealIds = [];
let now = 0;
function frames(n, each) {
  for (let i = 0; i < n; i++) {
    now += 16.7;
    if (each) each(i);
    IH.game.update(G, 1 / 60);
    IH.game.render(G);
  }
}
check('one thousand frames of standing still', () => frames(1000));
check('walking forward for a while', () => {
  G.keys['w'] = true;
  const d0 = G.player.dist;
  frames(600);
  G.keys['w'] = false;
  if (G.player.dist - d0 < 3) throw new Error('never moved: ' + (G.player.dist - d0).toFixed(2) + 'm');
});
check('looking around', () => {
  G.mouse.dx = 300; G.mouse.dy = 40;
  frames(20);
  G.mouse.dx = -600; G.mouse.dy = -30;
  frames(20);
});
check('panels open and close', () => {
  IH.game.toggleAtlas(G);
  if (!G.atlasOpen) throw new Error('atlas did not open');
  IH.game.toggleAtlas(G);
  if (G.atlasOpen) throw new Error('atlas did not close');
});
check('the atlas travels to a visited wing', () => {
  G.visited['gallery'] = true;
  IH.game.travel(G, 'gallery');
  if (G.player.sector < G.world.wings.gallery.start) throw new Error('did not travel');
});
check('travel refuses an unvisited wing', () => {
  G.visited['core'] = false;
  const before = G.player.sector;
  IH.game.travel(G, 'core');
  if (G.player.sector !== before) throw new Error('travelled to the core while sealed');
});
check('every wing renders', () => {
  for (const k of ['atrium', 'annex', 'turning', 'stairs', 'gallery', 'chapel']) {
    const w = G.world.wings[k];
    G.visited[k] = true;
    IH.game.travel(G, k);
    frames(6);
    const stats = G.R.stats;
    if (stats.polys < 4) throw new Error(k + ' drew ' + stats.polys + ' polys');
  }
});
check('seals can be taken', () => {
  /* put the visitor next to a seal and take it */
  const it = G.world.items[0];
  G.player.sector = it.sector;
  G.player.pos = it.pos.slice();
  frames(2);
  IH.game.interact(G);
  if (!G.sealIds || G.sealIds.indexOf(it.id) < 0) throw new Error('seal not taken');
  if (G.seals !== 1) throw new Error('count is ' + G.seals);
});
check('the core opens with four seals', () => {
  for (const it of G.world.items) { G.player.sector = it.sector; G.player.pos = it.pos.slice(); frames(2); IH.game.interact(G); }
  if (G.seals !== 4) throw new Error('seals ' + G.seals);
  const coreGates = G.world.sectors.flatMap((s) => s.gates).filter((x) => x.id === 'd-core');
  if (!coreGates.every((x) => x.active)) throw new Error('core still sealed');
});
check('notes open', () => {
  const noteSector = G.world.notes[0];
  G.player.sector = noteSector.sector;
  frames(2);
  IH.game.interact(G);
});
check('touch controls do not explode', () => {
  G.touch.mx = 1; G.touch.my = -1;
  frames(60);
  G.touch.mx = 0; G.touch.my = 0;
});
check('the whole house walked by the atlas', () => {
  const keys = Object.keys(G.world.wings);
  for (const k of keys) {
    G.visited[k] = true;
    IH.game.travel(G, k);
    frames(120);
  }
});

console.log('\n  ' + (errors ? '\x1b[31m' + errors + ' failures\x1b[0m' : '\x1b[32mgame smoke test clean\x1b[0m'));
console.log('  renderer ' + G.R.w + 'x' + G.R.h + ' · fps ' + Math.round(G.fps) + ' · quality ' + G.quality.toFixed(2));
process.exit(errors ? 1 : 0);
