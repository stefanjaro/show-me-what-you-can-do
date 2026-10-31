/* Hero: a slowly turning astrolabe, set to the sky of today. */
(function () {
  'use strict';
  var CM = window.CM;
  var canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  var view = CM.setupCanvas(canvas);
  var ctx = view.ctx;
  var hero = canvas.closest('.hero');
  var animator = CM.makeAnimator(draw);
  var t0 = performance.now();
  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  var stars = [];
  var builtFor = 0;

  var ZODIAC = ['ARI', 'TAU', 'GEM', 'CAN', 'LEO', 'VIR', 'LIB', 'SCA', 'SAG', 'CAP', 'AQU', 'PIS'];
  var MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  function sunLongitude(date) {
    var n = (date.getTime() / 86400000) - 10957.5;
    var L = 280.460 + 0.9856474 * n;
    var g = (357.528 + 0.9856003 * n) * CM.D2R;
    var lon = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
    return CM.mod(lon, 360);
  }

  function moonLongitude(date) {
    var n = (date.getTime() / 86400000) - 10957.5;
    var L = 218.316 + 13.176396 * n;
    var M = (134.963 + 13.064993 * n) * CM.D2R;
    var D = (297.850 + 12.190749 * n) * CM.D2R;
    var lon = L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D);
    return CM.mod(lon, 360);
  }

  function moonPhase(date) {
    var n = (date.getTime() / 86400000) - 10957.5;
    var elong = CM.mod(218.316 + 13.176396 * n - (280.460 + 0.9856474 * n), 360);
    return elong;
  }

  function rebuildStars() {
    var area = view.w * view.h / 12000;
    stars = CM.stars(20261031, Math.min(220, Math.max(50, Math.round(area))), view.w, view.h);
    builtFor = view.w;
  }

  function draw(now) {
    var w = view.w, h = view.h;
    if (!w || !h) return;
    if (Math.abs(builtFor - w) > 40) rebuildStars();
    if (!stars.length) rebuildStars();
    var t = CM.reduced ? 0 : (now - t0) / 1000;
    var mobile = w < 760;

    pointer.x += (pointer.tx - pointer.x) * 0.035;
    pointer.y += (pointer.ty - pointer.y) * 0.035;

    ctx.clearRect(0, 0, w, h);

    var cx = mobile ? w * 0.5 : w * 0.685;
    var cy = mobile ? h * 0.67 : h * 0.485;
    var R = mobile ? Math.min(w * 0.66, h * 0.3) : Math.min(w * 0.30, h * 0.42);
    R = Math.max(120, R);
    var alpha = mobile ? 0.38 : 1;

    /* stars */
    ctx.save();
    ctx.globalAlpha = alpha;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.65 + 0.35 * Math.sin(t * 0.6 + s.p);
      ctx.globalAlpha = alpha * s.a * tw;
      ctx.fillStyle = '#e8d9b4';
      ctx.beginPath();
      ctx.arc(s.x + pointer.x * 2, s.y + pointer.y * 2, s.r, 0, CM.TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(pointer.x * 7, pointer.y * 7);
    ctx.globalAlpha = alpha;

    /* soft glow */
    var glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.45);
    glow.addColorStop(0, 'rgba(201,163,90,.16)');
    glow.addColorStop(0.45, 'rgba(201,163,90,.045)');
    glow.addColorStop(1, 'rgba(201,163,90,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.45, 0, CM.TAU);
    ctx.fill();

    /* slowly turning outer gear */
    CM.drawGear(ctx, cx, cy, R * 1.075, 96, t * 0.012, {
      depth: R * 0.016,
      hole: R * 0.94,
      holeFill: 'rgba(12,10,7,.0)',
      fill: 'rgba(201,163,90,.10)',
      stroke: 'rgba(201,163,90,.22)',
      lineWidth: 0.7,
      holeStroke: 'rgba(201,163,90,.16)'
    });

    /* outer rings */
    ring(cx, cy, R, 1, 1.4, 'rgba(201,163,90,.5)');
    ring(cx, cy, R * 0.875, 0.7, 1, 'rgba(201,163,90,.3)');
    ring(cx, cy, R * 0.70, 0.7, 1, 'rgba(201,163,90,.22)');
    ring(cx, cy, R * 0.43, 0.7, 1, 'rgba(201,163,90,.18)');

    /* 360 ticks */
    for (var k = 0; k < 360; k++) {
      var a = (k - 90) * CM.D2R;
      var major = k % 30 === 0;
      var mid = k % 5 === 0;
      var len = major ? R * 0.075 : mid ? R * 0.038 : R * 0.018;
      var r0 = R * 0.985;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 - len), cy + Math.sin(a) * (r0 - len));
      ctx.strokeStyle = major ? 'rgba(240,215,154,.7)' : mid ? 'rgba(201,163,90,.42)' : 'rgba(201,163,90,.2)';
      ctx.lineWidth = major ? 1.2 : 0.65;
      ctx.stroke();
    }

    /* zodiac names around the ring */
    if (!mobile) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 ' + Math.max(8, R * 0.036) + 'px "Cinzel", serif';
      for (var z = 0; z < 12; z++) {
        var za = (z * 30 + 15 - 90) * CM.D2R;
        var zr = R * 0.925;
        ctx.save();
        ctx.translate(cx + Math.cos(za) * zr, cy + Math.sin(za) * zr);
        ctx.rotate(za + Math.PI / 2);
        ctx.fillStyle = 'rgba(240,215,154,.68)';
        ctx.fillText(ZODIAC[z], 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    /* inner roman numerals */
    if (!mobile) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '400 ' + Math.max(7, R * 0.028) + 'px "IBM Plex Mono", monospace';
      for (var m = 0; m < 12; m++) {
        var ma = (m * 30 + 15 - 90) * CM.D2R;
        var mr = R * 0.785;
        ctx.save();
        ctx.translate(cx + Math.cos(ma) * mr, cy + Math.sin(ma) * mr);
        ctx.rotate(ma + Math.PI / 2);
        ctx.fillStyle = 'rgba(201,163,90,.35)';
        ctx.fillText(MONTHS[m], 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    /* decorative orbit rings */
    ctx.save();
    ctx.strokeStyle = 'rgba(201,163,90,.12)';
    ctx.lineWidth = 0.7;
    for (var o = 0; o < 3; o++) {
      var or = R * (0.31 + o * 0.10);
      ctx.beginPath();
      ctx.ellipse(cx, cy, or, or * (0.92 - o * 0.04), t * 0.012 + o * 0.3, 0, CM.TAU);
      ctx.stroke();
    }
    ctx.restore();

    /* fixed sky: today's sun and moon */
    var nowDate = new Date();
    var slon = sunLongitude(nowDate);
    var mlon = moonLongitude(nowDate);
    var phase = moonPhase(nowDate);
    var sunA = (slon - 90) * CM.D2R;
    var moonA = (mlon - 90) * CM.D2R;

    /* sun hand */
    hand(cx, cy, sunA, R * 0.66, R * 0.08, 'rgba(240,215,154,.9)', 1.1);
    drawSun(ctx, cx + Math.cos(sunA) * R * 0.66, cy + Math.sin(sunA) * R * 0.66, R * 0.045, t);

    /* moon hand */
    hand(cx, cy, moonA, R * 0.57, R * 0.055, 'rgba(205,220,215,.65)', 0.9);
    drawMoon(ctx, cx + Math.cos(moonA) * R * 0.57, cy + Math.sin(moonA) * R * 0.57, R * 0.036, phase);

    /* central rose */
    drawRose(cx, cy, R * 0.20, t);

    /* tiny inscription */
    if (!mobile) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(201,163,90,.34)';
      ctx.font = '400 ' + Math.max(6, R * 0.019) + 'px "IBM Plex Mono", monospace';
      ctx.letterSpacing = '0.2em';
      ctx.fillText('THE ORDER OF THE HEAVENS', cx, cy + R * 1.15);
      ctx.restore();
    }

    ctx.restore();
  }

  function ring(cx, cy, r, lw, alpha, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, CM.TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.restore();
  }

  function hand(cx, cy, a, len, tail, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * tail, cy - Math.sin(a) * tail);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
    ctx.restore();
  }

  function drawSun(ctx, x, y, r, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.15);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    g.addColorStop(0, 'rgba(255,235,180,.5)');
    g.addColorStop(1, 'rgba(255,215,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, CM.TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, CM.TAU);
    ctx.fillStyle = '#f6dc9a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,247,220,.8)';
    ctx.lineWidth = 0.8;
    for (var i = 0; i < 8; i++) {
      var a = i * CM.TAU / 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
      ctx.lineTo(Math.cos(a) * r * 1.75, Math.sin(a) * r * 1.75);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMoon(ctx, x, y, r, phase) {
    ctx.save();
    ctx.translate(x, y);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.1);
    g.addColorStop(0, 'rgba(200,224,218,.22)');
    g.addColorStop(1, 'rgba(200,224,218,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.1, 0, CM.TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, CM.TAU);
    ctx.fillStyle = '#d9ddd1';
    ctx.fill();
    var k = Math.cos(phase * CM.D2R);
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, k < 0);
    ctx.fillStyle = 'rgba(16,17,16,.88)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, CM.TAU);
    ctx.strokeStyle = 'rgba(233,223,202,.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  function drawRose(cx, cy, r, t) {
    ctx.save();
    ctx.translate(cx, cy);
    CM.drawGear(ctx, 0, 0, r, 24, t * 0.03, {
      depth: r * 0.14,
      hole: r * 0.42,
      hi: '#d9b873',
      mid: '#8d662b',
      lo: '#3f2b11',
      stroke: 'rgba(20,12,5,.9)',
      holeFill: '#0d0a07',
      holeStroke: 'rgba(240,215,154,.35)'
    });
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, 0, CM.TAU);
    ctx.fillStyle = 'rgba(244,224,170,.85)';
    ctx.fill();
    ctx.restore();
  }

  window.addEventListener('pointermove', function (e) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  CM.onVisible(hero, function () { animator.start(); }, function () { animator.stop(); }, '100px');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) animator.stop();
    else if (hero.getBoundingClientRect().bottom > 0) animator.start();
  });
})();
