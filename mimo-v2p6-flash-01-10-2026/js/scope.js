/*!
 * CONTINUUM CA-7 - scope.js
 * Phosphor displays: an XY phase plot and a three-beam time base.
 * Traces are redrawn every frame in chunks with rising alpha, which
 * gives the decay of a persistence tube without blitting history.
 */
(function (root) {
  'use strict';
  var CA7 = root.CA7;
  var SAMPLE_HZ = 1 / (CA7.DT * CA7.SAMPLE_EVERY);   /* 400 Hz */
  var MAXN = 6000;

  function fit(cssW, cssH) {
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    return { w: Math.round(cssW * dpr), h: Math.round(cssH * dpr), s: dpr };
  }

  function graticule(ctx, w, h, cols, rows) {
    var i, x, y;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110,215,170,0.15)';
    ctx.beginPath();
    for (i = 1; i < cols; i++) { x = Math.round(i * w / cols) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (i = 1; i < rows; i++) { y = Math.round(i * h / rows) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    /* centre cross, brighter, with fifth-division ticks */
    ctx.strokeStyle = 'rgba(120,225,180,0.3)';
    ctx.beginPath();
    ctx.moveTo(Math.round(w / 2) + 0.5, 0); ctx.lineTo(Math.round(w / 2) + 0.5, h);
    ctx.moveTo(0, Math.round(h / 2) + 0.5); ctx.lineTo(w, Math.round(h / 2) + 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,225,180,0.34)';
    ctx.beginPath();
    for (i = 0; i <= cols * 5; i++) {
      x = Math.round(i * w / (cols * 5)) + 0.5;
      ctx.moveTo(x, Math.round(h / 2) - 3); ctx.lineTo(x, Math.round(h / 2) + 3);
    }
    for (i = 0; i <= rows * 5; i++) {
      y = Math.round(i * h / (rows * 5)) + 0.5;
      ctx.moveTo(Math.round(w / 2) - 3, y); ctx.lineTo(Math.round(w / 2) + 3, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* draw points[from..to) as a fading polyline, oldest dimmest */
  function fadingLine(ctx, pts, n, color, chunks) {
    if (n < 2) return;
    var per = Math.ceil(n / chunks);
    var c, i, a, start, end;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 7;
    for (c = 0; c < chunks; c++) {
      start = c * per;
      end = Math.min(n, start + per + 1);
      if (end - start < 2) continue;
      a = (c + 1) / chunks;
      ctx.globalAlpha = 0.05 + 0.95 * Math.pow(a, 1.7);
      ctx.lineWidth = 1 + 1.3 * a;
      ctx.beginPath();
      ctx.moveTo(pts[start * 2], pts[start * 2 + 1]);
      for (i = start + 1; i < end; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function head(ctx, x, y, color) {
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 1.9, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  function Scope(canvas, kind) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.kind = kind;
    this.tmp = null;
  }

  Scope.prototype.resize = function () {
    var cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    var f = fit(cw, ch);
    if (this.canvas.width !== f.w || this.canvas.height !== f.h) {
      this.canvas.width = f.w;
      this.canvas.height = f.h;
    }
    this.s = f.s;
  };

  Scope.prototype.read = function (rec, key, n) {
    if (!this.tmp || this.tmp.length < n) this.tmp = new Float32Array(n + 64);
    if (!key) return 0;
    return rec.copy(key, this.tmp, n);
  };

  /* ---- XY phase plot ------------------------------------------------ */
  Scope.prototype.drawXY = function (rec, keys, cfg, shadow) {
    var ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    graticule(ctx, w, h, 10, 6);
    if (!keys.x || !keys.y) return;

    var divs = cfg.window * SAMPLE_HZ;
    var step = Math.max(1, Math.ceil(divs / MAXN));
    var want = Math.floor(divs / step);
    var got = Math.min(want, Math.floor((rec.count - 1) / step), CA7.TRACE_LEN / step);
    if (got < 2) return;

    var need = got * 2;
    if (!this.xy || this.xy.length < need) this.xy = new Float32Array(need);
    var xy = this.xy;
    var i, idx, vx, vy;

    for (i = 0; i < got; i++) {
      idx = (rec.count - got + i * step) % CA7.TRACE_LEN;
      vx = rec.bufs[keys.x] ? rec.bufs[keys.x][idx] : 0;
      vy = rec.bufs[keys.y] ? rec.bufs[keys.y][idx] : 0;
      xy[i * 2] = w / 2 + (vx / cfg.gx + cfg.ox) * (w / 10);
      xy[i * 2 + 1] = h / 2 - (vy / cfg.gy + cfg.oy) * (h / 8);
    }
    fadingLine(ctx, xy, got, cfg.color || '#7dffa8', 44);
    head(ctx, xy[(got - 1) * 2], xy[(got - 1) * 2 + 1], cfg.color || '#7dffa8');

    if (shadow && keys.sx && keys.sy) {
      if (!this.xys || this.xys.length < need) this.xys = new Float32Array(need);
      var sy = this.xys;
      for (i = 0; i < got; i++) {
        idx = (shadow.count - got + i * step) % CA7.TRACE_LEN;
        vx = shadow.bufs[keys.sx] ? shadow.bufs[keys.sx][idx] : 0;
        vy = shadow.bufs[keys.sy] ? shadow.bufs[keys.sy][idx] : 0;
        sy[i * 2] = w / 2 + (vx / cfg.gx + cfg.ox) * (w / 10);
        sy[i * 2 + 1] = h / 2 - (vy / cfg.gy + cfg.oy) * (h / 8);
      }
      fadingLine(ctx, sy, got, 'rgba(120,200,255,0.85)', 34);
    }
  };

  /* ---- time base ---------------------------------------------------- */
  function snapScale(v) {
    var a = Math.abs(v);
    if (a < 1e-6) return 1;
    var e = Math.pow(10, Math.floor(Math.log(a / 2.6) / Math.LN10));
    var m = a / 2.6 / e;
    var s = m <= 1 ? 1 : (m <= 2 ? 2 : (m <= 5 ? 5 : 10));
    return s * e;
  }

  Scope.prototype.drawTime = function (rec, keys, cfg) {
    var ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    graticule(ctx, w, h, 10, 6);

    var divs = cfg.window * SAMPLE_HZ;
    var step = Math.max(1, Math.ceil(divs / MAXN));
    var n = Math.floor(divs / step);
    var colors = ['#ffb454', '#63d3ff', '#c79bff'];
    var labels = [];
    var unit = (this.s || 1);
    var i, c, key, got, j, idx, vals, maxv, scale;

    for (c = 0; c < 3; c++) {
      key = keys[c];
      if (!key || !rec.bufs[key]) continue;
      got = Math.min(n, Math.floor((rec.count - 1) / step), CA7.TRACE_LEN / step);
      if (got < 2) continue;
      if (!this['t' + c] || this['t' + c].length < got * 2) this['t' + c] = new Float32Array(got * 2 + 64);
      vals = this['t' + c];
      maxv = 1e-6;
      for (j = 0; j < got; j++) {
        idx = (rec.count - got + j * step) % CA7.TRACE_LEN;
        var v = rec.bufs[key][idx];
        if (Math.abs(v) > maxv) maxv = Math.abs(v);
      }
      scale = snapScale(maxv);
      for (j = 0; j < got; j++) {
        idx = (rec.count - got + j * step) % CA7.TRACE_LEN;
        vals[j * 2] = (j / Math.max(1, got - 1)) * w;
        vals[j * 2 + 1] = h / 2 - (rec.bufs[key][idx] / scale) * (h / 6);
      }
      fadingLine(ctx, vals, got, colors[c], 40);
      head(ctx, vals[(got - 1) * 2], vals[(got - 1) * 2 + 1], colors[c]);
      labels.push({ text: 'CH' + (c + 1) + '  ' + fmtDiv(scale) + ' V/div', color: colors[c] });
    }

    ctx.save();
    ctx.font = (10.5 * unit) + 'px ui-monospace,Menlo,Consolas,monospace';
    ctx.textBaseline = 'top';
    for (i = 0; i < labels.length; i++) {
      var tw = ctx.measureText(labels[i].text).width;
      var ly = (6 + i * 13) * unit;
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = '#04060a';
      ctx.fillRect(4 * unit, ly - 2 * unit, tw + 8 * unit, 14 * unit);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = labels[i].color;
      ctx.fillText(labels[i].text, 7 * unit, ly);
    }
    ctx.restore();
  };

  function fmtDiv(v) {
    return String(Math.round(v * 1000) / 1000);
  }

  CA7.Scope = Scope;
  CA7.SAMPLE_HZ = SAMPLE_HZ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
