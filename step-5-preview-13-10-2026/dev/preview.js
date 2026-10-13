/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — dev/preview.js
   Renders the house headlessly and prints it as ASCII so the geometry can
   be checked without a browser.
     node dev/preview.js [view] [cols]
   ═════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = ['js/core/noise.js', 'js/core/mathx.js', 'js/core/textures.js',
  'js/core/render.js', 'js/world/geom.js', 'js/world/house.js'];

function load() {
  const src = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  return new Function(src + '\n;return (typeof window!=="undefined"?window:globalThis).IH;')();
}
const IH = load();
const M = IH.Math, V = M.V;
const world = IH.house.build();
const tex = IH.textures.build({ size: 128, seed: 20261013 });

/* bind the generated textures into the polygons */
IH.house.bindTextures(world, tex);

const RAMP = ' .:-=+*#%@';
const COLS = parseInt(process.argv[3] || '110', 10);
const W = COLS, H = Math.round(COLS * 0.58);
const R = IH.render.create(W, H);
R.far = 400;

const views = {
  atrium: { pos: [0, 1.65, 2.4], f: [0, 0, -1], sector: 0 },
  atriumb: { pos: [0, 1.65, 2.4], f: [0, 0, 1], sector: 0 },
  atriumup: { pos: [0, 1.65, 2.4], f: [0, 1, 0], sector: 0 },
  turning: { pos: [-26, 1.65, 0], f: [-1, 0, 0], sector: 2 },
  turning2: { pos: [-26, 1.65, 0], f: [0, 0, -1], sector: 2 },
  turning3: { pos: [-26, 1.65, 0], f: [1, 0, 0], sector: 2 },
  stairs: { pos: [13.6, 1.65, -8], f: [0, 0, 1], sector: 6 },
  stairs2: { pos: [13.6, 1.65, -6.2], f: [0.0, 0.3, 1], sector: 6 },
  stairsmid: { pos: [13.6, 1.65, -6.2], f: [1, 0, 0], sector: 6 },
  gallery: { pos: [0, 1.65, -15], f: [0, 0, 1], sector: 42 },
  gallery2: { pos: [0, 1.65, -15], f: [1, 0, 0], sector: 43 },
  chapel: { pos: [0, 1.65, 9], f: [1, 0, 0], sector: 49 },
  vault: { pos: [11, 1.65, 12.2], f: [1, 0, 0], sector: 50 },
  vaultup: { pos: [11, 1.65, 12.2], f: [0, -1, 0], sector: 50 },
  core: { pos: [0, 1.65, 22.5], f: [0, 0, -1], sector: 51 },
  coreup: { pos: [0, 1.65, 22.5], f: [0, 1, 0], sector: 51 },
  annex: { pos: [0, 1.65, 7], f: [0, 0, 1], sector: 1 },
  stairsB: { pos: [16, 1.65, -8], f: [1, 0, 0], sector: 6 },
  stairsC: { pos: [13.6, 1.65, -8], f: [0, 0, 1], sector: 9 },
  farstairs: { pos: [30, 1.65, 10], f: [-1, 0, 0], sector: 20 },
  turndoor: { pos: [-27, 1.65, 0], f: [1, 0, 0], sector: 2 },
  turnring: { pos: [-27, 1.65, 0], f: [0, 0, 1], sector: 2 },
  galleryin: { pos: [0, 1.65, -13], f: [0, 0, 1], sector: 42 },
  chapeldoor: { pos: [0, 1.65, 9], f: [0, 0, -1], sector: 49 },
  vaultin: { pos: [11, 1.65, 12.2], f: [1, 0, 0], sector: 50 },
  stairscore: { pos: [13.6, 1.65, -8], f: [0, 0, 1], sector: 6 },
  stairsdeep: { pos: [13.6, 1.65, -8], f: [0, 0, 1], sector: 21 },
};

function render(name, opts) {
  const v = views[name];
  if (!v) { console.error('no view ' + name); process.exit(1); }
  const b = V.basis(v.f, opts && opts.up ? opts.up : [0, 1, 0]);
  const cam = M.pose(v.pos, b.r, b.u, b.f);
  IH.render.render(R, world, cam, v.sector, { clear: 0xff07070a });
  let out = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = R.buf[y * W + x];
      const lum = ((c & 255) * 0.3 + ((c >> 8) & 255) * 0.6 + ((c >> 16) & 255) * 0.1) / 255;
      out += RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
    }
    out += '\n';
  }
  return out;
}

const name = process.argv[2] || 'atrium';
const up = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const art = render(name, { up: up });
console.log('┌─ ' + name + ' ─ ' + W + 'x' + H + ' ─ polys:' + R.stats.polys +
  ' portals:' + R.stats.portals + ' depth:' + R.stats.recursion + ' px:' + R.stats.px);
console.log(art);
console.log('stats: ' + JSON.stringify(R.stats));
