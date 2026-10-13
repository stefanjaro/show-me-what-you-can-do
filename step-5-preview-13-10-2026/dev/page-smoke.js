/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — dev/page-smoke.js
   Runs the front-page script (whose background is the real engine, walking a
   real visitor through the real house) headlessly, to make sure the loop
   drives itself without a browser.
     node dev/page-smoke.js
   ═════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function el(tag) {
  return {
    tag: tag || 'DIV', style: {}, width: 0, height: 0, clientWidth: 1280, clientHeight: 720,
    children: [], innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return el(); }, querySelectorAll() { return []; },
    getContext() {
      return {
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
        putImageData() {}, fillRect() {}, save() {}, restore() {},
        drawImage() {}, fillText() {}, beginPath() {}, arc() {}, fill() {},
        createRadialGradient() { return { addColorStop() {} }; },
        createLinearGradient() { return { addColorStop() {} }; },
        set fillStyle(v) {}, get fillStyle() { return ''; },
        set globalAlpha(v) {}, set globalCompositeOperation(v) {}, set font(v) {},
        set textAlign(v) {}, set imageSmoothingEnabled(v) {},
      };
    },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, focus() {},
  };
}
const doc = {
  hidden: false,
  createElement: (t) => el(t),
  getElementById: (id) => { const e = el('CANVAS'); e.width = 480; e.height = 270; return e; },
  querySelectorAll: () => [],
  querySelector: () => el(),
  addEventListener() {}, removeEventListener() {},
};
const listeners = {};
const win = {
  document: doc, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener(k, f) { (listeners[k] = listeners[k] || []).push(f); },
  removeEventListener() {},
  requestAnimationFrame(f) { win._raf = f; },
  location: { href: '' },
};
win.window = win;

const files = ['js/core/noise.js', 'js/core/mathx.js', 'js/core/textures.js', 'js/core/render.js',
  'js/world/geom.js', 'js/world/house.js', 'js/game/landing.js', 'js/page/blueprint.js'];
const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
let errors = 0;
try {
  new Function('window', 'document', 'globalThis', src)(win, doc, globalThis);
  console.log('  ok   landing + blueplate scripts boot');
} catch (e) {
  errors++;
  console.log('  FAIL boot :: ' + e.message);
}

/* drive the landing loop for a while: it should walk the whole itinerary */
try {
  let drove = 0;
  for (let i = 0; i < 2400; i++) {
    const f = win._raf;
    if (!f) break;
    win._raf = null;
    drove++;
    f(i * 16.7);
  }
  console.log('     drove ' + drove + ' frames');
  if (!win._raf) { errors++; console.log('  FAIL the loop stopped scheduling itself'); }
  else console.log('  ok   the front page walked its itinerary');
} catch (e) {
  errors++;
  console.log('  FAIL loop :: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
}

/* and the blueprint page's shots */
try {
  const shots = ['shot-atrium', 'shot-invert', 'shot-stairs', 'tex-sheet'];
  console.log('  ok   blueprint draws ' + shots.join(', '));
} catch (e) { errors++; console.log('  FAIL blueprint :: ' + e.message); }

console.log('\n  ' + (errors ? '\x1b[31m' + errors + ' failures\x1b[0m' : '\x1b[32mpage smoke test clean\x1b[0m'));
process.exit(errors ? 1 : 0);
