(function (global) {
  'use strict';
  var SL = global.SL || (global.SL = {});

  var palette = {
    bg: '#0b0a09',
    ink: '#f2e9d8',
    muted: '#8d8271',
    faint: '#3a352c',
    amber: '#e8a33d',
    amberDim: '#a9762b',
    teal: '#63c7bd',
    tealDim: '#2f6f6a',
    rose: '#d97a6c',
    grid: '#221e18'
  };

  function setupCanvas(canvas) {
    var dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1));
    var w = canvas.clientWidth || 300;
    var h = canvas.clientHeight || 150;
    var W = Math.round(w * dpr);
    var H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  function label(ctx, text, x, y, color, size, align) {
    ctx.fillStyle = color || palette.muted;
    ctx.font = (size || 10) + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function LossCurve(canvas) {
    this.canvas = canvas;
    this.history = [];
    this.valHistory = [];
    this.marks = [];
    this.maxPoints = 900;
  }

  LossCurve.prototype.push = function (step, loss, val) {
    this.history.push([step, loss]);
    if (val !== undefined && isFinite(val)) this.valHistory.push([step, val]);
    if (this.history.length > this.maxPoints) this.history.shift();
    if (this.valHistory.length > this.maxPoints) this.valHistory.shift();
  };

  LossCurve.prototype.mark = function (step) {
    this.marks.push(step);
    if (this.marks.length > 200) this.marks.shift();
  };

  LossCurve.prototype.reset = function () {
    this.history = [];
    this.valHistory = [];
    this.marks = [];
  };

  LossCurve.prototype.draw = function () {
    var s = setupCanvas(this.canvas);
    var ctx = s.ctx, w = s.w, h = s.h;
    ctx.clearRect(0, 0, w, h);
    var pad = { l: 38, r: 12, t: 14, b: 22 };
    var iw = w - pad.l - pad.r;
    var ih = h - pad.t - pad.b;
    var hist = this.history;
    var vals = this.valHistory;
    if (hist.length < 2) {
      label(ctx, 'awaiting the first step', w / 2, h / 2, palette.faint, 11, 'center');
      return;
    }
    var minStep = hist[0][0];
    var maxStep = hist[hist.length - 1][0];
    if (maxStep === minStep) maxStep = minStep + 1;
    var maxLoss = 0;
    var i;
    for (i = 0; i < hist.length; i++) if (hist[i][1] > maxLoss) maxLoss = hist[i][1];
    for (i = 0; i < vals.length; i++) if (vals[i][1] > maxLoss) maxLoss = vals[i][1];
    maxLoss = Math.max(0.6, maxLoss * 1.1);
    var xOf = function (step) { return pad.l + (step - minStep) / (maxStep - minStep) * iw; };
    var yOf = function (loss) {
      var v = Math.log(Math.max(loss, 1e-3) + 0.02);
      var lo = Math.log(0.02 + 1e-3);
      var hi = Math.log(maxLoss + 0.02);
      return pad.t + ih - (v - lo) / (hi - lo) * ih;
    };

    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    var gridVals = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 4];
    for (i = 0; i < gridVals.length; i++) {
      var gy = yOf(gridVals[i]);
      if (gy < pad.t || gy > pad.t + ih) continue;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + iw, gy);
      ctx.stroke();
      label(ctx, String(gridVals[i]), pad.l - 8, gy, palette.faint, 9, 'right');
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, iw, ih);
    ctx.clip();

    for (i = 0; i < this.marks.length; i++) {
      var mx = xOf(this.marks[i]);
      ctx.strokeStyle = 'rgba(232,163,61,0.12)';
      ctx.beginPath();
      ctx.moveTo(mx, pad.t);
      ctx.lineTo(mx, pad.t + ih);
      ctx.stroke();
    }

    function line(data, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (var k = 0; k < data.length; k++) {
        var x = xOf(data[k][0]);
        var y = yOf(data[k][1]);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (vals.length > 1) line(vals, palette.teal, 1.4);
    if (hist.length > 1) line(hist, palette.amber, 1.6);

    var last = hist[hist.length - 1];
    ctx.fillStyle = palette.amber;
    ctx.beginPath();
    ctx.arc(xOf(last[0]), yOf(last[1]), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    label(ctx, 'loss (log scale)', pad.l, h - 9, palette.faint, 9);
    label(ctx, String(maxStep), pad.l + iw, h - 8, palette.faint, 9, 'right');
    label(ctx, last[1].toFixed(3), w - 6, 10, palette.amber, 11, 'right');
    if (vals.length > 1) {
      label(ctx, vals[vals.length - 1][1].toFixed(3), w - 6, 24, palette.teal, 11, 'right');
    }
    ctx.fillStyle = palette.amber;
    label(ctx, 'train', pad.l + 4, 12, palette.amber, 9);
    if (vals.length > 1) label(ctx, 'held-out', pad.l + 44, 12, palette.teal, 9);
  };

  function LogitBars(canvas) {
    this.canvas = canvas;
    this.items = [];
    this.total = 1;
  }

  LogitBars.prototype.set = function (items, total) {
    this.items = items || [];
    this.total = total || 1;
  };

  LogitBars.prototype.draw = function () {
    var s = setupCanvas(this.canvas);
    var ctx = s.ctx, w = s.w, h = s.h;
    ctx.clearRect(0, 0, w, h);
    var items = this.items;
    if (!items.length) {
      label(ctx, 'no distribution', w / 2, h / 2, palette.faint, 11, 'center');
      return;
    }
    var rowH = Math.min(22, h / items.length);
    var labelW = 46;
    for (var i = 0; i < items.length; i++) {
      var y = i * rowH + rowH / 2;
      var p = items[i].p;
      var bw = (w - labelW - 44) * Math.min(1, p / Math.max(items[0].p, 1e-6));
      ctx.fillStyle = i === 0 ? palette.amber : palette.amberDim;
      ctx.globalAlpha = i === 0 ? 0.95 : 0.55;
      ctx.fillRect(labelW, y - rowH * 0.32, bw, rowH * 0.64);
      ctx.globalAlpha = 1;
      label(ctx, items[i].label, labelW - 8, y, palette.ink, 11, 'right');
      label(ctx, (p * 100).toFixed(1) + '%', labelW + bw + 6, y, palette.muted, 10);
    }
  };

  function AttentionGrid(canvas) {
    this.canvas = canvas;
    this.tokens = [];
    this.matrix = null;
    this.title = '';
  }

  AttentionGrid.prototype.set = function (tokens, matrix, title) {
    this.tokens = tokens;
    this.matrix = matrix;
    this.title = title || '';
  };

  AttentionGrid.prototype.draw = function () {
    var s = setupCanvas(this.canvas);
    var ctx = s.ctx, w = s.w, h = s.h;
    ctx.clearRect(0, 0, w, h);
    if (!this.matrix || this.tokens.length < 2) {
      label(ctx, 'run a sentence through the model', w / 2, h / 2, palette.faint, 11, 'center');
      return;
    }
    var T = this.tokens.length;
    var marginX = 34;
    var marginY = 38;
    var size = Math.min(w - marginX * 2, h - marginY * 2);
    var cell = size / T;
    var ox = (w - size) / 2;
    var oy = marginY + Math.max(0, (h - marginY * 2 - size) / 2);
    for (var t = 0; t < T; t++) {
      for (var sIdx = 0; sIdx <= t; sIdx++) {
        var v = this.matrix[t * T + sIdx];
        var a = Math.min(1, Math.pow(v, 0.55) * 1.7);
        ctx.fillStyle = 'rgba(232,163,61,' + (0.05 + a * 0.92).toFixed(3) + ')';
        ctx.fillRect(ox + sIdx * cell, oy + t * cell, Math.ceil(cell) + 0.4, Math.ceil(cell) + 0.4);
      }
    }
    for (var i = 0; i < T; i++) {
      if (cell < 11 && i % 2) continue;
      var fs = Math.min(12, cell * 0.95);
      label(ctx, this.tokens[i], ox + i * cell + cell / 2, oy - 9, palette.faint, fs, 'center');
      label(ctx, this.tokens[i], ox - 8, oy + i * cell + cell / 2, palette.faint, fs, 'right');
    }
    label(ctx, this.title, w - 6, 14, palette.muted, 10, 'right');
    label(ctx, 'queries \\ keys', 6, 14, palette.faint, 9);
  };

  function EmbeddingScatter(canvas) {
    this.canvas = canvas;
    this.points = [];
    this.hover = -1;
    this.onHover = null;
    var self = this;
    canvas.addEventListener('mousemove', function (ev) {
      var rect = canvas.getBoundingClientRect();
      self._mx = ev.clientX - rect.left;
      self._my = ev.clientY - rect.top;
      self._hitTest();
    });
    canvas.addEventListener('mouseleave', function () {
      self.hover = -1;
      if (self.onHover) self.onHover(null);
    });
  }

  EmbeddingScatter.prototype._hitTest = function () {
    var best = -1, bestD = 14 * 14;
    for (var i = 0; i < this.points.length; i++) {
      var dx = this.points[i].x - this._mx;
      var dy = this.points[i].y - this._my;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best !== this.hover) {
      this.hover = best;
      if (this.onHover) this.onHover(best >= 0 ? this.points[best] : null);
    }
  };

  EmbeddingScatter.prototype.set = function (points) {
    this.points = points || [];
  };

  EmbeddingScatter.prototype.draw = function () {
    var s = setupCanvas(this.canvas);
    var ctx = s.ctx, w = s.w, h = s.h;
    ctx.clearRect(0, 0, w, h);
    if (!this.points.length) {
      label(ctx, 'embedding space', w / 2, h / 2, palette.faint, 11, 'center');
      return;
    }
    for (var i = 0; i < this.points.length; i++) {
      var p = this.points[i];
      var isHover = i === this.hover;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isHover ? 6 : (p.hot ? 3.6 : 2.2), 0, Math.PI * 2);
      ctx.fillStyle = isHover ? palette.teal : (p.hot ? palette.amber : palette.amberDim);
      ctx.globalAlpha = isHover ? 1 : (p.hot ? 0.92 : 0.5);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (isHover || p.hot) {
        ctx.font = (isHover ? 12 : 10) + 'px ui-monospace, Menlo, monospace';
        ctx.fillStyle = isHover ? palette.teal : palette.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.ch, p.x + 7, p.y);
      }
    }
    if (this.hover >= 0) {
      label(ctx, this.points[this.hover].name, 8, 12, palette.teal, 11);
    }
    label(ctx, 'first two principal components', w - 6, 14, palette.faint, 9, 'right');
  };

  function pcaProject(matrix, rows, cols, w, h) {
    var mean = new Float64Array(cols);
    var i, j, k;
    for (i = 0; i < rows; i++) for (j = 0; j < cols; j++) mean[j] += matrix[i * cols + j];
    for (j = 0; j < cols; j++) mean[j] /= rows;
    var cov = new Float64Array(cols * cols);
    for (i = 0; i < rows; i++) {
      for (j = 0; j < cols; j++) {
        var a = matrix[i * cols + j] - mean[j];
        for (k = 0; k < cols; k++) {
          cov[j * cols + k] += a * (matrix[i * cols + k] - mean[k]);
        }
      }
    }
    function powerIter(mat, n, seedVec) {
      var v = new Float64Array(n);
      for (var i2 = 0; i2 < n; i2++) v[i2] = seedVec ? seedVec[i2] : Math.sin(i2 * 12.9898) * 0.5 + 0.5;
      var out = new Float64Array(n);
      for (var it = 0; it < 60; it++) {
        out.fill(0);
        for (var r = 0; r < n; r++) {
          var s2 = 0;
          for (var c = 0; c < n; c++) s2 += mat[r * n + c] * v[c];
          out[r] = s2;
        }
        var norm = 0;
        for (var q = 0; q < n; q++) norm += out[q] * out[q];
        norm = Math.sqrt(norm) || 1;
        for (var q2 = 0; q2 < n; q2++) v[q2] = out[q2] / norm;
      }
      return v;
    }
    var pc1 = powerIter(cov, cols, null);
    var pc2 = powerIter(cov, cols, pc1);
    for (i = 0; i < cols; i++) {
      var dot = 0;
      for (j = 0; j < cols; j++) dot += pc2[j] * pc1[j];
      for (j = 0; j < cols; j++) pc2[j] -= dot * pc1[j];
    }
    var n2 = 0;
    for (i = 0; i < cols; i++) n2 += pc2[i] * pc2[i];
    n2 = Math.sqrt(n2) || 1;
    for (i = 0; i < cols; i++) pc2[i] /= n2;

    var xs = new Float64Array(rows), ys = new Float64Array(rows);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (i = 0; i < rows; i++) {
      var x = 0, y = 0;
      for (j = 0; j < cols; j++) {
        var val = matrix[i * cols + j] - mean[j];
        x += val * pc1[j];
        y += val * pc2[j];
      }
      xs[i] = x; ys[i] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    var pad = 16;
    var sx = (w - pad * 2) / Math.max(1e-6, maxX - minX);
    var sy = (h - pad * 2) / Math.max(1e-6, maxY - minY);
    var sc = Math.min(sx, sy);
    var pts = [];
    for (i = 0; i < rows; i++) {
      pts.push({
        x: pad + (xs[i] - minX) * sc + (w - pad * 2 - (maxX - minX) * sc) / 2,
        y: h - pad - (ys[i] - minY) * sc - (h - pad * 2 - (maxY - minY) * sc) / 2
      });
    }
    return pts;
  }


  function SurpriseStrip(canvas) {
    this.canvas = canvas;
    this.cells = [];
    this.chars = [];
  }

  SurpriseStrip.prototype.set = function (chars, cells) {
    this.chars = chars;
    this.cells = cells;
  };

  SurpriseStrip.prototype.draw = function () {
    var s = setupCanvas(this.canvas);
    var ctx = s.ctx, w = s.w, h = s.h;
    ctx.clearRect(0, 0, w, h);
    if (!this.cells.length) {
      label(ctx, 'no reading yet', w / 2, h / 2, palette.faint, 11, 'center');
      return;
    }
    var n = this.cells.length;
    var cols = Math.ceil(Math.sqrt(n * (w / h)));
    var rows = Math.ceil(n / cols);
    var cw = w / cols;
    var ch = h / rows;
    for (var i = 0; i < n; i++) {
      var v = Math.min(1, this.cells[i] / 3.2);
      var cx = (i % cols) * cw;
      var cy = Math.floor(i / cols) * ch;
      var t = Math.pow(v, 0.85);
      var r = Math.round(28 + 204 * t);
      var g = Math.round(22 + 120 * t);
      var b = Math.round(18 + 30 * t);
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(cx, cy, Math.ceil(cw) + 0.4, Math.ceil(ch) + 0.4);
    }
    label(ctx, 'cool = the book is what it expected · hot = the book surprised it', 4, h - 8, palette.faint, 9);
    label(ctx, this.cells.length + ' letters read', w - 4, h - 8, palette.faint, 9, 'right');
  };

  function HeroField(canvas) {
    this.canvas = canvas;
    this.nodes = [];
    this.pointer = { x: -999, y: -999 };
    this.t = 0;
    this.reduced = false;
    if (typeof matchMedia !== 'undefined') {
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    var self = this;
    canvas.addEventListener('pointermove', function (ev) {
      var r = canvas.getBoundingClientRect();
      self.pointer.x = ev.clientX - r.left;
      self.pointer.y = ev.clientY - r.top;
    });
    canvas.addEventListener('pointerleave', function () {
      self.pointer.x = -999;
      self.pointer.y = -999;
    });
    this._build();
  }

  HeroField.prototype._build = function () {
    var s = setupCanvas(this.canvas);
    var w = s.w, h = s.h;
    var n = Math.round(Math.min(90, (w * h) / 14000));
    this.nodes = [];
    for (var i = 0; i < n; i++) {
      this.nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        phase: Math.random() * Math.PI * 2
      });
    }
  };

  HeroField.prototype.draw = function (dt) {
    var s = setupCanvas(this.canvas);
    var ctx = s.ctx, w = s.w, h = s.h;
    if (!this.nodes.length || Math.abs(this._w - w) > 40) {
      this._w = w;
      this._build();
    }
    ctx.clearRect(0, 0, w, h);
    this.t += dt || 16;
    var i, j;
    for (i = 0; i < this.nodes.length; i++) {
      var nd = this.nodes[i];
      if (!this.reduced) {
        nd.x += nd.vx;
        nd.y += nd.vy;
        if (nd.x < 0 || nd.x > w) nd.vx *= -1;
        if (nd.y < 0 || nd.y > h) nd.vy *= -1;
      }
      var dxp = nd.x - this.pointer.x;
      var dyp = nd.y - this.pointer.y;
      var dp = Math.sqrt(dxp * dxp + dyp * dyp);
      if (dp < 130 && !this.reduced) {
        nd.x += dxp / (dp + 1) * 0.5;
        nd.y += dyp / (dp + 1) * 0.5;
      }
    }
    for (i = 0; i < this.nodes.length; i++) {
      var a = this.nodes[i];
      for (j = i + 1; j < this.nodes.length; j++) {
        var b = this.nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var d2 = dx * dx + dy * dy;
        if (d2 > 16000) continue;
        var d = Math.sqrt(d2);
        var alpha = (1 - d / 126) * 0.22;
        ctx.strokeStyle = 'rgba(232,163,61,' + alpha.toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (i = 0; i < this.nodes.length; i++) {
      var nd2 = this.nodes[i];
      var pulse = 0.5 + 0.5 * Math.sin(this.t * 0.0012 + nd2.phase);
      ctx.beginPath();
      ctx.arc(nd2.x, nd2.y, 1.4 + pulse * 1.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(232,163,61,' + (0.18 + pulse * 0.3).toFixed(3) + ')';
      ctx.fill();
    }
  };

  SL.viz = {
    palette: palette,
    setupCanvas: setupCanvas,
    label: label,
    LossCurve: LossCurve,
    LogitBars: LogitBars,
    AttentionGrid: AttentionGrid,
    EmbeddingScatter: EmbeddingScatter,
    HeroField: HeroField,
    SurpriseStrip: SurpriseStrip,
    pcaProject: pcaProject
  };
})(typeof window !== 'undefined' ? window : globalThis);
