/* ==========================================================================
   THE BLIND PHYSICIST · render.js
   Canvas drawing: the physical worlds, heat maps, the Pareto front and
   one-dimensional curves. Everything is drawn from data; nothing is pictured.
   ========================================================================== */
(function () {
  'use strict';
  var BP = globalThis.BP || (globalThis.BP = {});

  var PAL = {
    bg: '#0b0c12', panel: '#12141d', line: '#262b3d', text: '#e7e9f2', muted: '#8d93a8',
    gold: '#f4c25b', cyan: '#5fd3ff', violet: '#a88bff', rose: '#ff6f91', green: '#6ee7a8'
  };

  // perceptually ordered "magma-like" ramp for magnitudes
  var HEAT_STOPS = [[0, [6, 4, 18]], [0.25, [75, 12, 107]], [0.5, [181, 54, 122]],
                    [0.75, [249, 142, 59]], [1, [252, 253, 191]]];
  // cool ramp for disagreement / uncertainty
  var COOL_STOPS = [[0, [8, 10, 18]], [0.5, [24, 92, 140]], [1, [150, 245, 255]]];

  function buildLUT(stops) {
    var lut = new Uint8ClampedArray(256 * 3), i, k;
    for (i = 0; i < 256; i++) {
      var t = i / 255, c = stops[stops.length - 1][1];
      for (k = 1; k < stops.length; k++) {
        if (t <= stops[k][0]) {
          var a = stops[k - 1], b = stops[k], u = (t - a[0]) / (b[0] - a[0]);
          c = [0, 1, 2].map(function (j) { return a[1][j] + (b[1][j] - a[1][j]) * u; });
          break;
        }
      }
      lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
    }
    return lut;
  }
  var LUT_HEAT = buildLUT(HEAT_STOPS), LUT_COOL = buildLUT(COOL_STOPS);

  // Size a canvas to its CSS box, respecting device pixel ratio. Returns ctx and size.
  function prepare(canvas) {
    var dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    var w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function text(ctx, s, x, y, color, size, align, font) {
    ctx.fillStyle = color || PAL.muted;
    ctx.font = (size || 12) + 'px ' + (font || 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }

  // ---- heat maps ----------------------------------------------------------
  // vals: M×M values, index iy*M + ix, iy = 0 is the bottom edge of the domain.
  var scratchCanvas = null;
  function heatmap(ctx, x, y, w, h, vals, M, vmin, vmax, cool) {
    if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
    scratchCanvas.width = M; scratchCanvas.height = M;
    var sctx = scratchCanvas.getContext('2d');
    var img = sctx.createImageData(M, M), d = img.data, lut = cool ? LUT_COOL : LUT_HEAT;
    var span = vmax - vmin || 1, r, c;
    for (r = 0; r < M; r++) {
      var iy = M - 1 - r;             // canvas rows run top to bottom
      for (c = 0; c < M; c++) {
        var v = vals[iy * M + c], t = (v - vmin) / span;
        if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
        var li = Math.round(t * 255) * 3, o = (r * M + c) * 4;
        d[o] = lut[li]; d[o + 1] = lut[li + 1]; d[o + 2] = lut[li + 2]; d[o + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(scratchCanvas, x, y, w, h);
  }

  // Map a domain point to a pixel inside a plot box.
  function toPix(box, dom, p) {
    return [box.x + (p[0] - dom[0][0]) / (dom[0][1] - dom[0][0]) * box.w,
            box.y + box.h - (p[1] - dom[1][0]) / (dom[1][1] - dom[1][0]) * box.h];
  }

  // ---- Pareto front -------------------------------------------------------
  function pareto(ctx, w, h, par, selSize, noise, maxSize) {
    var L = 38, R = 12, T = 12, B = 26;
    var x0 = L, x1 = w - R, y0 = T, y1 = h - B;
    ctx.strokeStyle = PAL.line; ctx.lineWidth = 1;
    // grid: decades of error
    for (var e = 0; e <= 4; e++) {
      var yy = y0 + (e / 4) * (y1 - y0);
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
      text(ctx, ['100%', '10%', '1%', '0.1%', '0.01%'][e], x0 - 6, yy + 4, PAL.muted, 10, 'right');
    }
    var maxC = maxSize || 25;
    for (var c = 5; c <= maxC; c += 5) {
      var xx = x0 + ((c - 1) / (maxC - 1)) * (x1 - x0);
      ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); ctx.stroke();
      text(ctx, String(c), xx, h - 8, PAL.muted, 10, 'center');
    }
    text(ctx, 'complexity →', x1, y0 + 11, PAL.muted, 10, 'right');
    function pos(p) {
      var lg = Math.max(-4, Math.min(0, Math.log10(Math.max(p.nrmse, 1e-6))));
      return [x0 + ((p.size - 1) / (maxC - 1)) * (x1 - x0), y0 + (-lg / 4) * (y1 - y0)];
    }
    if (noise > 0) {
      var lgn = Math.max(-4, Math.min(0, Math.log10(noise)));
      var ny = y0 + (-lgn / 4) * (y1 - y0);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(110,231,168,0.55)';
      ctx.beginPath(); ctx.moveTo(x0, ny); ctx.lineTo(x1, ny); ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, 'instrument noise', x1, ny - 5, PAL.green, 10, 'right');
    }
    if (par.length) {
      ctx.strokeStyle = 'rgba(95,211,255,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      par.forEach(function (p, i) { var q = pos(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.stroke();
      par.forEach(function (p) {
        var q = pos(p), sel = p.size === selSize;
        ctx.beginPath(); ctx.arc(q[0], q[1], sel ? 6 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = sel ? PAL.gold : PAL.cyan; ctx.fill();
        if (sel) {
          ctx.strokeStyle = 'rgba(244,194,91,0.35)'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(q[0], q[1], 11, 0, Math.PI * 2); ctx.stroke();
        }
      });
    }
  }

  // ---- one-dimensional curves --------------------------------------------
  // series: [{ys:[...]}, ...] sampled at xs; points: [[x,y]]; marker: x
  function curve1D(ctx, w, h, dom, xs, series, points, marker, yr) {
    var L = 44, R = 14, T = 14, B = 28;
    var box = { x: L, y: T, w: w - L - R, h: h - T - B };
    var lo = yr[0], hi = yr[1], span = (hi - lo) || 1;
    function X(x) { return box.x + (x - dom[0]) / (dom[1] - dom[0]) * box.w; }
    function Y(y) { return box.y + box.h - (y - lo) / span * box.h; }
    ctx.strokeStyle = PAL.line; ctx.lineWidth = 1;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    for (var k = 0; k <= 4; k++) {
      var yy = box.y + (k / 4) * box.h;
      ctx.beginPath(); ctx.moveTo(box.x, yy); ctx.lineTo(box.x + box.w, yy); ctx.stroke();
      text(ctx, (hi - (k / 4) * span).toPrecision(3), box.x - 6, yy + 4, PAL.muted, 10, 'right');
    }
    if (marker !== null && marker !== undefined) {
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(244,194,91,0.7)';
      ctx.beginPath(); ctx.moveTo(X(marker), box.y); ctx.lineTo(X(marker), box.y + box.h); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    series.forEach(function (s) {
      ctx.strokeStyle = s.color; ctx.globalAlpha = s.alpha == null ? 1 : s.alpha;
      ctx.lineWidth = s.width || 1.5; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.ys.forEach(function (y, i) {
        if (!isFinite(y)) return;
        var px = X(xs[i]), py = Y(Math.max(lo - span, Math.min(hi + span, y)));
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    ctx.restore();
    points.forEach(function (p) {
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(231,233,242,0.55)'; ctx.fill();
    });
    return { X: X, Y: Y, box: box };
  }

  // ---- the worlds ---------------------------------------------------------
  // Each draws its own physical picture from the world's current state.
  function drawNature(ctx, w, h, world, extra) {
    extra = extra || {};
    var id = world.id, s = world.s, cx = w / 2, cy = h / 2;
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0e1019'); g.addColorStop(1, '#090a0f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (id === 'pendulum') {
      var pivot = [cx, h * 0.14], Lp = h * 0.66, th = s[0];
      var bob = [pivot[0] + Lp * Math.sin(th), pivot[1] + Lp * Math.cos(th)];
      world.trail.forEach(function (st, i) {
        var a = i / world.trail.length;
        var q = [pivot[0] + Lp * Math.sin(st[0]), pivot[1] + Lp * Math.cos(st[0])];
        ctx.beginPath(); ctx.arc(q[0], q[1], 2 + 3 * a, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(244,194,91,' + (0.05 + 0.35 * a) + ')'; ctx.fill();
      });
      ctx.strokeStyle = 'rgba(141,147,168,0.35)'; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(pivot[0], pivot[1]); ctx.lineTo(pivot[0], pivot[1] + Lp + 6); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#c9ccd8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pivot[0], pivot[1]); ctx.lineTo(bob[0], bob[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(pivot[0], pivot[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#c9ccd8'; ctx.fill();
      var rg = ctx.createRadialGradient(bob[0] - 4, bob[1] - 4, 2, bob[0], bob[1], 18);
      rg.addColorStop(0, '#fff2c4'); rg.addColorStop(1, '#c8871e');
      ctx.beginPath(); ctx.arc(bob[0], bob[1], 14, 0, Math.PI * 2); ctx.fillStyle = rg; ctx.fill();
    } else if (id === 'duffing' || id === 'custom') {
      var wallX = w * 0.08, restX = w * 0.5, scl = (w * 0.36) / 3.5;
      var mx = restX + s[0] * scl, my = h * 0.52;
      world.trail.forEach(function (st, i) {
        var a = i / world.trail.length;
        ctx.beginPath(); ctx.arc(restX + st[0] * scl, my, 1.5 + 2 * a, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(95,211,255,' + (0.05 + 0.4 * a) + ')'; ctx.fill();
      });
      ctx.fillStyle = '#2a2f42'; ctx.fillRect(wallX - 14, my - 60, 14, 120);
      ctx.strokeStyle = '#7b839c'; ctx.lineWidth = 2; ctx.beginPath();
      var segs = 22, x0 = wallX, span = mx - 22 - wallX;
      ctx.moveTo(x0, my);
      for (var k = 1; k <= segs; k++) {
        var xk = x0 + span * k / segs, yk = my + (k % 2 ? -16 : 16) * (k === segs ? 0 : 1);
        ctx.lineTo(xk, yk);
      }
      ctx.lineTo(mx - 22, my); ctx.stroke();
      ctx.fillStyle = '#c9ccd8'; ctx.fillRect(mx - 22, my - 22, 44, 44);
      ctx.strokeStyle = '#5fd3ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + s[1] * 9, my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(restX, my + 46); ctx.lineTo(restX, my + 52); ctx.stroke();
      text(ctx, 'rest', restX, my + 66, PAL.muted, 10, 'center');
    } else if (id === 'orbit' || id === 'kepler') {
      var sc = Math.min(w, h) * 0.42 / (id === 'orbit' ? 4 : 6.4);
      if (id === 'kepler' && extra.probeRadii) {
        extra.probeRadii.forEach(function (r) {
          ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(136,147,190,0.12)'; ctx.lineWidth = 1; ctx.stroke();
        });
      }
      if (id === 'orbit') {
        [1, 2, 3, 4].forEach(function (r) {
          ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(136,147,190,0.10)'; ctx.lineWidth = 1; ctx.stroke();
        });
      }
      var pts = world.trail.map(function (st) { return [cx + st[0] * sc, cy + st[1] * sc]; });
      if (pts.length > 1) {
        ctx.beginPath();
        pts.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.strokeStyle = 'rgba(168,139,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      var sg = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
      sg.addColorStop(0, 'rgba(255,230,160,1)'); sg.addColorStop(0.35, 'rgba(244,194,91,0.5)'); sg.addColorStop(1, 'rgba(244,194,91,0)');
      ctx.fillStyle = sg; ctx.fillRect(cx - 34, cy - 34, 68, 68);
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff1c2'; ctx.fill();
      if (s) {
        var px = cx + s[0] * sc, py = cy + s[1] * sc;
        var pg = ctx.createRadialGradient(px - 2, py - 2, 1, px, py, 9);
        pg.addColorStop(0, '#eaf8ff'); pg.addColorStop(1, '#3d8fd1');
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = pg; ctx.fill();
      }
    } else if (id === 'drag') {
      var top = h * 0.08, ground = h * 0.9, cxd = w * 0.5, hs = (ground - top) / 150;
      ctx.strokeStyle = '#262b3d'; ctx.lineWidth = 1;
      ctx.strokeRect(cxd - 46, top, 92, ground - top);
      for (var t = 0; t <= 150; t += 25) {
        var yt = ground - t * hs;
        ctx.beginPath(); ctx.moveTo(cxd - 46, yt); ctx.lineTo(cxd - 38, yt); ctx.stroke();
        text(ctx, t + ' m', cxd - 52, yt + 4, PAL.muted, 10, 'right');
      }
      ctx.fillStyle = '#1d2233'; ctx.fillRect(cxd - 46, ground, 92, h - ground);
      ctx.strokeStyle = '#7b839c'; ctx.beginPath(); ctx.moveTo(cxd - 60, ground); ctx.lineTo(cxd + 60, ground); ctx.stroke();
      world.trail.forEach(function (st, i) {
        var a = i / world.trail.length;
        ctx.beginPath(); ctx.arc(cxd, ground - st[0] * hs, 1.5 + 2 * a, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(110,231,168,' + (0.05 + 0.4 * a) + ')'; ctx.fill();
      });
      var by = ground - Math.max(-10, s[0]) * hs, bgrad = ctx.createRadialGradient(cxd - 3, by - 3, 1, cxd, by, 12);
      bgrad.addColorStop(0, '#e9fff4'); bgrad.addColorStop(1, '#2fae78');
      ctx.beginPath(); ctx.arc(cxd, by, 9, 0, Math.PI * 2); ctx.fillStyle = bgrad; ctx.fill();
      ctx.strokeStyle = '#6ee7a8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cxd + 22, by); ctx.lineTo(cxd + 22, by - s[1] * 3); ctx.stroke();
      text(ctx, 'speed ' + s[1].toFixed(2) + ' m/s', cxd + 30, by - s[1] * 1.5 + 4, PAL.green, 10);
    }
    // caption
    text(ctx, world.title || '', 12, h - 10, 'rgba(231,233,242,0.55)', 10);
  }

  BP.Render = {
    PAL: PAL, prepare: prepare, text: text, heatmap: heatmap, toPix: toPix,
    pareto: pareto, curve1D: curve1D, drawNature: drawNature
  };
})();
