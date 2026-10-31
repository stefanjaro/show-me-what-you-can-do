/* The Clockwork Mind — shared utilities. No libraries. */
(function () {
  'use strict';

  var CM = {};
  CM.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  CM.TAU = Math.PI * 2;
  CM.D2R = Math.PI / 180;

  CM.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  CM.lerp = function (a, b, t) { return a + (b - a) * t; };
  CM.mod = function (n, m) { return ((n % m) + m) % m; };

  CM.ease = {
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outQuint: function (t) { return 1 - Math.pow(1 - t, 5); },
    outBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    inOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  };

  CM.pad2 = function (n) { return String(n).padStart(2, '0'); };

  CM.fmtInt = function (n) {
    try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); }
  };

  CM.escapeHTML = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  /* ---------- canvas ---------- */

  CM.setupCanvas = function (canvas) {
    var ctx = canvas.getContext('2d');
    var state = { ctx: ctx, w: 1, h: 1, dpr: 1, canvas: canvas };
    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = Math.max(1, Math.round(rect.width));
      var h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      state.w = w;
      state.h = h;
      state.dpr = dpr;
    }
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(resize);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();
    state.resize = resize;
    return state;
  };

  CM.makeAnimator = function (tick) {
    var raf = 0, running = false, last = 0;
    function frame(t) {
      if (!running) return;
      var dt = Math.min(64, t - last);
      last = t;
      tick(t, dt);
      raf = requestAnimationFrame(frame);
    }
    return {
      start: function () {
        if (running) return;
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      },
      get running() { return running; }
    };
  };

  CM.onVisible = function (el, onEnter, onExit, margin) {
    if (!('IntersectionObserver' in window)) { onEnter(); return { disconnect: function () {} }; }
    var visible = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !visible) { visible = true; onEnter(); }
        else if (!e.isIntersecting && visible) { visible = false; onExit && onExit(); }
      });
    }, { rootMargin: margin || '260px 0px' });
    io.observe(el);
    return io;
  };

  CM.onScreen = function (el, margin) {
    var visible = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible = e.isIntersecting; });
    }, { rootMargin: margin || '0px' });
    io.observe(el);
    return function () { return visible; };
  };

  /* ---------- drawing ---------- */

  CM.roundRect = function (ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  CM.drawGear = function (ctx, cx, cy, r, teeth, angle, opts) {
    opts = opts || {};
    var depth = opts.depth != null ? opts.depth : Math.max(2, r * 0.10);
    var root = r - depth;
    var hole = opts.hole != null ? opts.hole : r * 0.32;
    var step = CM.TAU / teeth;
    var toothTop = step * 0.30;
    var toothBottom = step * 0.62;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    for (var i = 0; i < teeth; i++) {
      var a = i * step;
      var x1 = Math.cos(a) * root, y1 = Math.sin(a) * root;
      var x2 = Math.cos(a + toothTop) * r, y2 = Math.sin(a + toothTop) * r;
      var x3 = Math.cos(a + toothBottom) * r, y3 = Math.sin(a + toothBottom) * r;
      var x4 = Math.cos(a + step) * root, y4 = Math.sin(a + step) * root;
      if (i === 0) ctx.moveTo(x1, y1); else ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.arc(0, 0, r, a + toothTop, a + toothBottom);
      ctx.lineTo(x4, y4);
      if (i < teeth - 1) ctx.arc(0, 0, root, a + step, a + step + step * 0.0001);
    }
    ctx.closePath();
    var g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.08, 0, 0, r * 1.05);
    g.addColorStop(0, opts.hi || '#efd596');
    g.addColorStop(0.42, opts.mid || '#b98a3e');
    g.addColorStop(1, opts.lo || '#5c3f19');
    ctx.fillStyle = opts.fill || g;
    ctx.fill();
    if (opts.stroke !== false) {
      ctx.lineWidth = opts.lineWidth || Math.max(0.6, r * 0.012);
      ctx.strokeStyle = opts.stroke || 'rgba(35,22,8,.85)';
      ctx.stroke();
    }
    if (hole > 0.5) {
      ctx.beginPath();
      ctx.arc(0, 0, hole, 0, CM.TAU);
      ctx.fillStyle = opts.holeFill || '#17120c';
      ctx.fill();
      ctx.lineWidth = Math.max(0.7, r * 0.018);
      ctx.strokeStyle = opts.holeStroke || 'rgba(233,210,160,.28)';
      ctx.stroke();
    }
    if (opts.spokes) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (var k = 0; k < opts.spokes; k++) {
        var sa = (k / opts.spokes) * CM.TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(sa) * hole, Math.sin(sa) * hole);
        ctx.lineTo(Math.cos(sa) * (root - depth * 0.2), Math.sin(sa) * (root - depth * 0.2));
        ctx.lineWidth = Math.max(1, r * 0.035);
        ctx.strokeStyle = opts.stroke || 'rgba(35,22,8,.7)';
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  };

  CM.drawScrew = function (ctx, x, y, r, angle) {
    var g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#e7cd8d');
    g.addColorStop(0.55, '#a77c3b');
    g.addColorStop(1, '#4d3515');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, CM.TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(20,12,4,.7)';
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0.6);
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, 0);
    ctx.lineTo(r * 0.62, 0);
    ctx.lineWidth = Math.max(0.9, r * 0.14);
    ctx.strokeStyle = 'rgba(32,20,8,.9)';
    ctx.stroke();
    ctx.restore();
  };

  CM.text = function (ctx, str, x, y, font, color, align, baseline) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = baseline || 'alphabetic';
    ctx.fillText(str, x, y);
  };

  CM.pointInRect = function (px, py, x, y, w, h) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  };

  CM.pointerPos = function (canvas, ev) {
    var r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  /* Draw a starfield with a seed so it is stable. */
  CM.stars = function (seed, n, w, h) {
    var out = [];
    var s = seed >>> 0;
    function rnd() {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (var i = 0; i < n; i++) {
      out.push({ x: rnd() * w, y: rnd() * h, r: 0.3 + rnd() * 1.2, a: 0.15 + rnd() * 0.65, p: rnd() * 6.28 });
    }
    return out;
  };

  window.CM = CM;
})();
