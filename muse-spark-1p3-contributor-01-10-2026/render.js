/* PRIMORDIA renderer: pixel planet, creatures, weather, catastrophes. */
'use strict';

const Renderer = {
  canvas: null, ctx: null, W: 0, H: 0,
  terr: null, tctx: null, img: null,
  cam: { x: 100, y: 62, z: 1 },
  hover: null, time: 0,
  dragging: false, dragBtn: 0,

  init(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.terr = document.createElement('canvas');
    this.terr.width = World.W; this.terr.height = World.H;
    this.tctx = this.terr.getContext('2d');
    this.img = this.tctx.createImageData(World.W, World.H);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.cam.x = World.W / 2; this.cam.y = World.H / 2; this.cam.z = 1;
  },
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = this.canvas.clientWidth || window.innerWidth;
    this.H = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },
  baseScale() { return Math.max(this.W / World.W, this.H / World.H); },
  scale() { return this.baseScale() * this.cam.z; },
  toScreen(wx, wy) {
    const s = this.scale();
    return { x: (wx - this.cam.x) * s + this.W / 2, y: (wy - this.cam.y) * s + this.H / 2 };
  },
  toWorld(sx, sy) {
    const s = this.scale();
    return { x: (sx - this.W / 2) / s + this.cam.x, y: (sy - this.H / 2) / s + this.cam.y };
  },

  bindInput() {
    const cv = this.canvas;
    let last = null, moved = 0, panBtn = false;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      // left button paints with god tools; inspect / right / middle button pans
      panBtn = (e.button !== 0) || UI.tool === 'inspect';
      this.dragging = true; last = { x: e.clientX, y: e.clientY }; moved = 0;
    });
    cv.addEventListener('pointermove', (e) => {
      const w = this.toWorld(e.clientX, e.clientY);
      this.hover = w;
      if (this.dragging && last) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (panBtn && (moved > 4)) {
          const s = this.scale();
          this.cam.x -= dx / s; this.cam.y -= dy / s;
          this.clampCam();
        }
        last = { x: e.clientX, y: e.clientY };
      }
      if (this.dragging && !panBtn && UI.painting) UI.paintAt(w.x, w.y);
    });
    cv.addEventListener('pointerup', (e) => {
      this.dragging = false;
      const w = this.toWorld(e.clientX, e.clientY);
      if (moved <= 6) UI.clickAt(w.x, w.y);
      UI.painting = false;
      last = null;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0012);
      this.zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });
  },
  zoomAt(sx, sy, f) {
    const before = this.toWorld(sx, sy);
    this.cam.z = clamp(this.cam.z * f, 0.7, 14);
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    this.clampCam();
  },
  clampCam() {
    this.cam.x = clamp(this.cam.x, -20, World.W + 20);
    this.cam.y = clamp(this.cam.y, -20, World.H + 20);
  },

  /* ---------- terrain bake ---------- */
  bakeTerrain() {
    const d = this.img.data;
    const { W, H } = World;
    const t = this.time;
    const sea = World.seaLevel;
    const night = this.nightAlpha();
    const dayL = 1 - night * 0.72;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        const e = World.elev[i];
        let r, g, b;
        if (e < sea) {
          const depth = clamp((sea - e) / 0.22, 0, 1);
          r = lerp(32, 5, depth); g = lerp(122, 22, depth); b = lerp(158, 52, depth);
          const wv = Math.sin(x * 0.55 + t * 1.7) * Math.sin(y * 0.5 - t * 1.2);
          const sp = Math.max(0, wv - 0.72) * 90;
          r += sp; g += sp; b += sp * 1.1;
        } else {
          const h = e - sea;
          const tmp = World.tmp[i];
          const m = clamp(World.moist0[i] * 0.6 + World.rain[i] * 0.7, 0, 1);
          const p = World.plant[i];
          if (tmp < -7) { r = 226; g = 238; b = 248; }
          else if (h > 0.34) { const k = clamp((h - 0.34) / 0.2, 0, 1); r = lerp(122, 235, k); g = lerp(118, 232, k); b = lerp(122, 240, k); }
          else if (tmp < 3) { r = 138; g = 148; b = 132; }
          else if (m < 0.16 && tmp > 23) { r = 214; g = 182; b = 118; }
          else if (m < 0.3) { r = 170; g = 160; b = 96; }
          else if (p > 0.5 && m > 0.48 && tmp > 21) { r = 26; g = 122; b = 66; }
          else if (p > 0.4) { r = 42; g = 112; b = 58; }
          else { r = 96; g = 142; b = 72; }
          // beach rim
          if (h < 0.012) { r = 210; g = 192; b = 138; }
          // plant blend
          const pb = clamp(p * 0.65, 0, 0.65);
          r = lerp(r, 46, pb); g = lerp(g, 158, pb); b = lerp(b, 78, pb);
          // hillshade
          const xl = x > 0 ? World.elev[i - 1] : e, yt = y > 0 ? World.elev[i - W] : e;
          const sh = clamp((e - xl + e - yt) * 9, -0.28, 0.3);
          r *= (1 + sh); g *= (1 + sh); b *= (1 + sh);
          // fire glow baked lightly (main glow drawn live)
          const f = World.fire[i];
          if (f > 0) { r = lerp(r, 255, f * 0.8); g = lerp(g, 110, f * 0.7); b = lerp(b, 20, f * 0.7); }
          // frost
          if (tmp < 0 && tmp > -7) { const k = clamp(-tmp / 7, 0, 1) * 0.5; r = lerp(r, 230, k); g = lerp(g, 238, k); b = lerp(b, 248, k); }
        }
        d[o] = clamp(r * dayL + 4, 0, 255); d[o + 1] = clamp(g * dayL + 8, 0, 255); d[o + 2] = clamp(b * dayL + 16, 0, 255); d[o + 3] = 255;
      }
    }
    this.tctx.putImageData(this.img, 0, 0);
  },
  nightAlpha() {
    const ph = World.day % 1;
    // day 0..0.55 bright, dusk, night 0.7..0.95
    const x = ph;
    if (x < 0.55) return 0;
    if (x < 0.65) return (x - 0.55) / 0.1;
    if (x < 0.9) return 1;
    return 1 - (x - 0.9) / 0.1;
  },

  draw() {
    this.time += 1 / 60;
    const ctx = this.ctx;
    // follow
    if (Life.followed && Life.followed.energy > 0) {
      this.cam.x = lerp(this.cam.x, Life.followed.x, 0.12);
      this.cam.y = lerp(this.cam.y, Life.followed.y, 0.12);
      if (this.cam.z < 2.4) this.cam.z = lerp(this.cam.z, 2.4, 0.05);
    }
    this.bakeTerrain();
    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, this.W, this.H);
    const s = this.scale();
    const ox = this.W / 2 - this.cam.x * s, oy = this.H / 2 - this.cam.y * s;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terr, ox, oy, World.W * s, World.H * s);

    // rain bands
    for (const b of World.rainBands) {
      const p = this.toScreen(b.x, b.y);
      const rr = b.r * s;
      if (p.x + rr < 0 || p.y + rr < 0 || p.x - rr > this.W || p.y - rr > this.H) continue;
      const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      gr.addColorStop(0, 'rgba(140,170,220,0.16)'); gr.addColorStop(1, 'rgba(140,170,220,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU()); ctx.fill();
    }

    // fire light
    const night = this.nightAlpha();
    this.drawCreatures(s, night);

    // effects
    for (let k = World.effects.length - 1; k >= 0; k--) {
      const ef = World.effects[k];
      ef.t += 1 / 60;
      const p = this.toScreen(ef.x, ef.y);
      const pr = ef.r * s * (0.3 + ef.t / ef.dur);
      const a = clamp(1 - ef.t / ef.dur, 0, 1);
      if (ef.kind === 'meteor') {
        ctx.fillStyle = `rgba(255,180,90,${0.5 * a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, TAU()); ctx.fill();
        ctx.strokeStyle = `rgba(255,220,160,${0.9 * a})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr * 1.02, 0, TAU()); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 + 20 * a, 0, TAU()); ctx.fill();
      } else if (ef.kind === 'volcano') {
        ctx.fillStyle = `rgba(255,110,40,${0.35 * a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, TAU()); ctx.fill();
      } else if (ef.kind === 'genesis') {
        ctx.strokeStyle = `rgba(120,255,210,${0.8 * a})`; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, TAU()); ctx.stroke();
      }
      if (ef.t > ef.dur) World.effects.splice(k, 1);
    }

    // night tint + stars? subtle blue overlay already baked; add extra depth:
    if (night > 0.02) {
      ctx.fillStyle = `rgba(6,10,34,${night * 0.28})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    // brush preview
    if (this.hover && UI.tool !== 'inspect') {
      const p = this.toScreen(this.hover.x, this.hover.y);
      const br = (UI.brushSize || 4) * s * 0.5;
      ctx.strokeStyle = UI.tool === 'meteor' || UI.tool === 'fire' || UI.tool === 'plague' ? 'rgba(255,107,157,.9)' : 'rgba(70,242,193,.85)';
      ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(p.x, p.y, br, 0, TAU()); ctx.stroke();
      ctx.setLineDash([]);
    }
  },

  creatureColor(c) {
    const h = (c.gen.hue * 360) | 0;
    return `hsl(${h},62%,${c.gen.diet === 2 ? 60 : 66}%)`;
  },

  drawCreatures(s, night) {
    const ctx = this.ctx;
    const list = Life.creatures;
    const pxPerTile = s;
    const showDetail = pxPerTile > 3;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      const p = this.toScreen(c.x, c.y);
      if (p.x < -30 || p.y < -30 || p.x > this.W + 30 || p.y > this.H + 30) continue;
      const g = c.gen;
      const rad = (1.6 + g.size * 3.4) * Math.min(2.2, 0.6 + pxPerTile * 0.14);
      const col = this.creatureColor(c);
      // glow at night
      if (night > 0.25 || c.flash > 0 || c === Life.selected) {
        ctx.save();
        ctx.shadowColor = g.diet === 2 ? '#ff6b9d' : g.diet === 1 ? '#ffb454' : '#46f2c1';
        ctx.shadowBlur = 12 * (night * 0.7 + 0.3);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU()); ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU()); ctx.fill();
      }
      if (showDetail) {
        // heading wedge
        ctx.fillStyle = 'rgba(0,0,0,.45)';
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(c.ang) * rad * 1.7, p.y + Math.sin(c.ang) * rad * 1.7);
        ctx.lineTo(p.x + Math.cos(c.ang + 2.5) * rad * 0.8, p.y + Math.sin(c.ang + 2.5) * rad * 0.8);
        ctx.lineTo(p.x + Math.cos(c.ang - 2.5) * rad * 0.8, p.y + Math.sin(c.ang - 2.5) * rad * 0.8);
        ctx.closePath(); ctx.fill();
        if (c.sick > 0) { ctx.fillStyle = '#8aff5a'; ctx.beginPath(); ctx.arc(p.x - rad, p.y - rad, 1.8, 0, TAU()); ctx.fill(); }
        if (c.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(c.flash, 0, 0.9)})`; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU()); ctx.fill(); }
      }
    }
    // selection ring
    const sel = Life.selected;
    if (sel && sel.energy > 0) {
      const p = this.toScreen(sel.x, sel.y);
      const t = this.time * 3;
      ctx.strokeStyle = '#46f2c1'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + Math.sin(t) * 2, 0, TAU()); ctx.stroke();
      ctx.fillStyle = '#46f2c1';
      ctx.font = '11px ui-monospace,monospace';
      const sp = Life.speciesById(sel.sp);
      ctx.fillText(sp ? sp.name : '', p.x + 14, p.y - 10);
    }
  },

  drawPortrait(canvas, c) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const grd = ctx.createRadialGradient(W/2, H/2, 4, W/2, H/2, W/2);
    grd.addColorStop(0, '#16233a'); grd.addColorStop(1, '#070b14');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    if (!c) return;
    const h = (c.gen.hue * 360) | 0;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(c.ang);
    ctx.shadowColor = c.gen.diet === 2 ? '#ff6b9d' : c.gen.diet === 1 ? '#ffb454' : '#46f2c1';
    ctx.shadowBlur = 22;
    ctx.fillStyle = `hsl(${h},65%,62%)`;
    const r = 12 + c.gen.size * 14;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU()); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.moveTo(r * 1.8, 0); ctx.lineTo(-r * 0.4, r * 0.7); ctx.lineTo(-r * 0.4, -r * 0.7);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.25, r * 0.18, 0, TAU()); ctx.arc(r * 0.35, r * 0.25, r * 0.18, 0, TAU()); ctx.fill();
    ctx.fillStyle = '#0a0f1a';
    ctx.beginPath(); ctx.arc(r * 0.42, -r * 0.25, r * 0.09, 0, TAU()); ctx.arc(r * 0.42, r * 0.25, r * 0.09, 0, TAU()); ctx.fill();
    ctx.restore();
  },
};
