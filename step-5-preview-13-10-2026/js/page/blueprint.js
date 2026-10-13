/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — page/blueprint.js
   Draws the illustrations on the blueprint page with the real engine: three
   frames of the real house, and a contact sheet of the procedural textures.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = g.IH, M = IH.Math, V = M.V;

  const world = IH.house.build();
  const tex = IH.textures.build({ size: 128, seed: 20261013 });
  IH.house.bindTextures(world, tex);

  function shot(id, pos, f, sector, up) {
    const c = document.getElementById(id);
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const R = IH.render.create(W, H);
    R.far = 400;
    const b = V.basis(f, up || [0, 1, 0]);
    const s = world.sectors[sector];
    const fog = s.fog;
    const clear = 0xff000000 | ((fog[2] * 0.6) << 16) | ((fog[1] * 0.6) << 8) | (fog[0] * 0.6);
    IH.render.render(R, world, M.pose(pos, b.r, b.u, b.f), sector, { clear: clear, fovY: 74 * M.DEG });
    const img = ctx.createImageData(W, H);
    new Uint32Array(img.data.buffer).set(R.buf);
    ctx.putImageData(img, 0, 0);
    /* a touch of grading, as the game does */
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const gr = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.95);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(120,110,100,1)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* the atrium, from the visitor's starting place */
  shot('shot-atrium', [0, 1.65, 3.0], [0, 0, -1], 0);
  /* the inverted chapel, standing on the vault */
  shot('shot-invert', [11.4, 4.1, 12.4], [1, 0, 0], world.wings.chapel.start + 1, [0, -1, 0]);
  /* a flight of the ascent */
  const st = world.sectors[world.wings.stairs.start + 3];
  shot('shot-stairs', [(st.min[0] + st.max[0]) / 2, st.min[1] + 1.65, st.min[2] + 1.4], [0, 0, 1],
    world.wings.stairs.start + 3);

  /* a contact sheet of every generated texture */
  (function sheet() {
    const c = document.getElementById('tex-sheet');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, W, H);
    const names = Object.keys(tex).filter((k) => tex[k].img);
    const cols = 8, cell = Math.floor(W / cols), rows = Math.ceil(names.length / cols);
    const size = Math.min(cell - 8, Math.floor((H - 20) / rows) - 8);
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    names.forEach((k, i) => {
      const t = tex[k];
      const x = (i % cols) * cell + (cell - size) / 2;
      const y = Math.floor(i / cols) * ((H - 10) / rows) + 16 + (size / 3);
      const img = ctx.createImageData(t.w, t.w);
      new Uint32Array(img.data.buffer).set(t.img);
      const tmp = document.createElement('canvas');
      tmp.width = t.w; tmp.height = t.w;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, x, y, size, size);
      ctx.fillStyle = '#8e8860';
      ctx.fillText(k, x + size / 2, y + size + 10);
    });
  })();
})(typeof window !== 'undefined' ? window : globalThis);
