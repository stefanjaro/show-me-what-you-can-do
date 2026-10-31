/* Exhibit III — The Slipstick. A working logarithmic slide rule. */
(function () {
  'use strict';
  var CM = window.CM;
  var canvas = document.getElementById('sliderule-canvas');
  if (!canvas) return;

  var view = CM.setupCanvas(canvas);
  var ctx = view.ctx;
  var section = canvas.closest('.exhibit');
  var aInput = document.getElementById('sr-a');
  var bInput = document.getElementById('sr-b');
  var aWrap = document.getElementById('sr-a-wrap');
  var bWrap = document.getElementById('sr-b-wrap');
  var aLabel = document.getElementById('sr-a-label');
  var bLabel = document.getElementById('sr-b-label');
  var goBtn = document.getElementById('sr-go');
  var resultEl = document.getElementById('sr-result');
  var exactEl = document.getElementById('sr-exact');
  var readEl = document.getElementById('sr-read');
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-sr-mode]'));

  var mode = 'mul';
  var layout = null;
  var slideFrac = 0;
  var cursorFrac = 0.5;
  var anim = null;
  var dragging = null;
  var dragStart = null;
  var lastSound = 0;
  var animator = CM.makeAnimator(frame);
  var t0 = performance.now();
  var hoverRunner = false;

  function buildLayout() {
    var w = view.w, h = view.h;
    var padX = Math.max(14, w * 0.035);
    var bodyX = padX;
    var bodyW = w - padX * 2;
    var bodyY = h * 0.17;
    var bodyH = h * 0.62;
    var innerPad = Math.max(20, w * 0.042);
    layout = {
      w: w, h: h,
      bodyX: bodyX, bodyY: bodyY, bodyW: bodyW, bodyH: bodyH,
      baseX: bodyX + innerPad,
      scaleW: bodyW - innerPad * 2,
      slideTop: bodyY + bodyH * 0.265,
      slideBottom: bodyY + bodyH * 0.625,
      aBase: bodyY + bodyH * 0.205,
      bBase: bodyY + bodyH * 0.415,
      cBase: bodyY + bodyH * 0.585,
      dBase: bodyY + bodyH * 0.775,
      lBase: bodyY + bodyH * 0.915,
      bandH: bodyH * 0.19
    };
    layout.aTop = bodyY + bodyH * 0.035;
    layout.dTop = bodyY + bodyH * 0.65;
    layout.lTop = bodyY + bodyH * 0.835;
  }

  function xD(v) { return Math.log10(v); }
  function xA(v) { return Math.log10(v) / 2; }
  function valFromFrac(f, decades) { return Math.pow(10, f * (decades || 1)); }

  function slideOffset() { return slideFrac * layout.scaleW; }
  function cursorX() { return layout.baseX + cursorFrac * layout.scaleW; }

  function clampFracs() {
    slideFrac = CM.clamp(slideFrac, -0.95, 0.95);
    cursorFrac = CM.clamp(cursorFrac, 0, 1);
  }

  function sig(v, n) {
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';
    var a = Math.abs(v);
    var digits = Math.max(0, n - 1 - Math.floor(Math.log10(a)));
    var s = v.toFixed(Math.min(12, Math.max(0, digits)));
    return s;
  }

  function trimNum(s) {
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  function superscript(n) {
    var map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return String(n).split('').map(function (c) { return map[c] || c; }).join('');
  }

  function normalize(v) {
    var e = Math.floor(Math.log10(v));
    var m = v / Math.pow(10, e);
    if (m >= 10) { m /= 10; e += 1; }
    if (m < 1) { m *= 10; e -= 1; }
    return { m: m, e: e };
  }

  function compute(opts) {
    opts = opts || {};
    var a = parseFloat(aInput.value);
    var b = parseFloat(bInput.value);
    if (!isFinite(a) || a <= 0 || ((mode === 'mul' || mode === 'div') && (!isFinite(b) || b <= 0))) {
      resultEl.textContent = '—';
      exactEl.textContent = 'Enter positive numbers.';
      return;
    }

    var targetSlide = 0;
    var targetCursor = 0;
    var reading = null;
    var exact = null;
    var exp = 0;

    if (mode === 'mul') {
      var na = normalize(a), nb = normalize(b);
      var product = na.m * nb.m;
      var idx = product >= 10 ? 10 : 1;
      targetSlide = xD(na.m) - xD(idx);
      targetCursor = xD(nb.m) + targetSlide;
      reading = idx === 10 ? product / 10 : product;
      exp = na.e + nb.e + (idx === 10 ? 1 : 0);
      exact = a * b;
    } else if (mode === 'div') {
      var da = normalize(a), db = normalize(b);
      var ratio = da.m / db.m;
      var idx2 = ratio < 1 ? 10 : 1;
      targetSlide = xD(da.m) - xD(db.m);
      targetCursor = xD(idx2) + targetSlide;
      reading = idx2 === 10 ? ratio * 10 : ratio;
      exp = da.e - db.e - (idx2 === 10 ? 1 : 0);
      exact = a / b;
    } else if (mode === 'sq') {
      var sa = normalize(a);
      targetSlide = 0;
      targetCursor = xD(sa.m);
      reading = sa.m * sa.m;
      exp = sa.e * 2;
      exact = a * a;
    } else if (mode === 'sqrt') {
      var ra = normalize(a);
      /* The square-root method uses the A scale; if the exponent is odd,
         shift the decimal into the mantissa so the result stays in range. */
      var mant = ra.m;
      var rexp = ra.e;
      if (rexp % 2 !== 0) { mant *= 10; rexp -= 1; }
      targetSlide = 0;
      targetCursor = xA(mant);
      reading = Math.sqrt(mant);
      exp = rexp / 2;
      exact = Math.sqrt(a);
    } else if (mode === 'log') {
      var la = normalize(a);
      targetSlide = 0;
      targetCursor = xD(la.m);
      reading = Math.log10(la.m);
      exp = la.e;
      exact = Math.log10(a);
    }

    targetCursor = CM.clamp(targetCursor, 0, 1);
    targetSlide = CM.clamp(targetSlide, -0.95, 0.95);

    var text;
    if (mode === 'log') {
      text = reading.toFixed(3) + (exp ? ' + ' + exp : '');
    } else {
      text = sig(reading, 3) + (exp ? ' × 10' + superscript(exp) : '');
    }
    var exactText = mode === 'log' ? exact.toFixed(4) : trimNum(sig(exact, 6));

    function finish() {
      resultEl.textContent = text;
      exactEl.textContent = exactText + ' exact';
      updateReadout();
      CMSound.play('tick', { vol: .45, pitch: 1.1 });
    }

    if (opts.animate === false) {
      slideFrac = targetSlide;
      cursorFrac = targetCursor;
      finish();
      return;
    }

    anim = {
      start: performance.now(),
      dur: CM.reduced ? 1 : 720,
      fromSlide: slideFrac,
      toSlide: targetSlide,
      fromCursor: cursorFrac,
      toCursor: targetCursor,
      done: finish
    };
    CMSound.play('slide', { vol: .7 });
  }

  function updateReadout() {
    if (!layout) return;
    var d = valFromFrac(cursorFrac, 1);
    var c = cursorFrac - slideFrac;
    var a = valFromFrac(cursorFrac, 2);
    var l = cursorFrac;
    var parts = [];
    parts.push('D ' + (cursorFrac >= 0 && cursorFrac <= 1 ? sig(d, 3) : '—'));
    parts.push('C ' + (c >= 0 && c <= 1 ? sig(Math.pow(10, c), 3) : '—'));
    parts.push('A ' + (cursorFrac >= 0 && cursorFrac <= 1 ? sig(a, 3) : '—'));
    parts.push('L ' + (l >= 0 && l <= 1 ? l.toFixed(3) : '—'));
    readEl.textContent = parts.join(' · ');
  }

  function setMode(next) {
    mode = next;
    modeButtons.forEach(function (btn) {
      var on = btn.getAttribute('data-sr-mode') === next;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var unary = next === 'sq' || next === 'sqrt' || next === 'log';
    bWrap.style.display = unary ? 'none' : '';
    aLabel.textContent = next === 'mul' ? 'First number' : next === 'div' ? 'Dividend' : next === 'sqrt' ? 'Number (1–100)' : next === 'sq' ? 'Number' : 'Number';
    bLabel.textContent = next === 'mul' ? 'Second number' : 'Divisor';
    CMSound.play('tick');
    compute({ animate: true });
  }

  modeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.getAttribute('data-sr-mode')); });
  });
  goBtn.addEventListener('click', function () { compute({ animate: true }); });
  [aInput, bInput].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); compute({ animate: true }); }
    });
  });

  function startDrag(e) {
    var p = CM.pointerPos(canvas, e);
    if (!layout) return;
    var cx = cursorX();
    var inBody = p.y > layout.bodyY - 12 && p.y < layout.bodyY + layout.bodyH + 12;
    if (!inBody) return;
    canvas.setPointerCapture(e.pointerId);
    if (Math.abs(p.x - cx) < 18) {
      dragging = 'cursor';
      dragStart = { x: p.x, cursorFrac: cursorFrac };
    } else if (p.y > layout.slideTop - 6 && p.y < layout.slideBottom + 6) {
      dragging = 'slide';
      dragStart = { x: p.x, slideFrac: slideFrac };
    } else {
      dragging = 'cursor';
      dragStart = { x: p.x, cursorFrac: cursorFrac };
      cursorFrac = CM.clamp((p.x - layout.baseX) / layout.scaleW, 0, 1);
    }
    anim = null;
    resultEl.textContent = '—';
    exactEl.textContent = 'Free setting — press Compute.';
    updateReadout();
    canvas.style.cursor = 'grabbing';
  }

  function moveDrag(e) {
    if (!dragging || !layout) return;
    var p = CM.pointerPos(canvas, e);
    var dx = (p.x - dragStart.x) / layout.scaleW;
    if (dragging === 'cursor') cursorFrac = CM.clamp(dragStart.cursorFrac + dx, 0, 1);
    else slideFrac = CM.clamp(dragStart.slideFrac + dx, -0.95, 0.95);
    clampFracs();
    updateReadout();
    var now = performance.now();
    if (now - lastSound > 90) {
      lastSound = now;
      CMSound.play('tick', { vol: .2, pitch: .9 });
    }
  }

  function endDrag() {
    dragging = null;
    canvas.style.cursor = 'grab';
    CMSound.play('slide', { vol: .35 });
  }

  canvas.addEventListener('pointerdown', startDrag);
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) {
      var p = CM.pointerPos(canvas, e);
      hoverRunner = layout && Math.abs(p.x - cursorX()) < 18;
      canvas.style.cursor = hoverRunner ? 'ew-resize' : 'grab';
      return;
    }
    moveDrag(e);
  });
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', function () { if (!dragging) canvas.style.cursor = 'grab'; });
  canvas.style.cursor = 'grab';
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      var d = e.key === 'ArrowLeft' ? -0.01 : 0.01;
      if (e.shiftKey) slideFrac = CM.clamp(slideFrac + d, -0.95, 0.95);
      else cursorFrac = CM.clamp(cursorFrac + d, 0, 1);
      updateReadout();
      e.preventDefault();
    }
  });

  /* ---------- drawing ---------- */

  function frame(now, dtMs) {
    if (!layout) { buildLayout(); }
    if (anim) {
      var p = CM.clamp((now - anim.start) / anim.dur, 0, 1);
      var e = CM.ease.inOutCubic(p);
      slideFrac = CM.lerp(anim.fromSlide, anim.toSlide, e);
      cursorFrac = CM.lerp(anim.fromCursor, anim.toCursor, e);
      updateReadout();
      if (p >= 1) {
        slideFrac = anim.toSlide;
        cursorFrac = anim.toCursor;
        var done = anim.done;
        anim = null;
        done && done();
      }
    }
    draw(now);
  }

  function draw(now) {
    var w = view.w, h = view.h, L = layout;
    ctx.clearRect(0, 0, w, h);

    var bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#15110b');
    bg.addColorStop(0.6, '#0b0906');
    bg.addColorStop(1, '#070605');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    /* top labels */
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(7, w * 0.0105) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(201,163,90,.55)';
    ctx.textAlign = 'left';
    ctx.fillText('THE CLOCKWORK MIND', L.bodyX + 4, L.bodyY - 22);
    ctx.textAlign = 'right';
    ctx.fillText('LOGARITHMIC RULE · No. 3', L.bodyX + L.bodyW - 4, L.bodyY - 22);
    ctx.restore();

    /* body shadow */
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.65)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 16;
    CM.roundRect(ctx, L.bodyX, L.bodyY, L.bodyW, L.bodyH, 5);
    ctx.fillStyle = '#2d1a0c';
    ctx.fill();
    ctx.restore();

    /* wooden body */
    var wood = ctx.createLinearGradient(0, L.bodyY, 0, L.bodyY + L.bodyH);
    wood.addColorStop(0, '#5a3217');
    wood.addColorStop(0.18, '#3c210e');
    wood.addColorStop(0.55, '#2b170a');
    wood.addColorStop(0.85, '#3d220f');
    wood.addColorStop(1, '#241307');
    CM.roundRect(ctx, L.bodyX, L.bodyY, L.bodyW, L.bodyH, 5);
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,163,90,.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* wood grain */
    ctx.save();
    CM.roundRect(ctx, L.bodyX, L.bodyY, L.bodyW, L.bodyH, 5);
    ctx.clip();
    for (var g = 0; g < 14; g++) {
      var gy = L.bodyY + (g / 14) * L.bodyH;
      ctx.beginPath();
      for (var gx = L.bodyX; gx <= L.bodyX + L.bodyW; gx += 14) {
        var yy = gy + Math.sin(gx * 0.011 + g * 1.3) * 1.8;
        if (gx === L.bodyX) ctx.moveTo(gx, yy); else ctx.lineTo(gx, yy);
      }
      ctx.strokeStyle = 'rgba(201,163,90,' + (0.012 + (g % 2) * 0.008) + ')';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();

    /* stator ivory strips */
    drawIvory(L.bodyX + 8, L.aTop, L.bodyW - 16, L.aBase - L.aTop + 16);
    drawIvory(L.bodyX + 8, L.dTop, L.bodyW - 16, L.dBase - L.dTop + 12);
    drawIvory(L.bodyX + 8, L.lTop, L.bodyW - 16, L.lBase - L.lTop + 10);

    /* slide strip */
    var sx = L.bodyX + slideOffset();
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.bodyX + 7, L.slideTop - 4, L.bodyW - 14, L.slideBottom - L.slideTop + 8);
    ctx.clip();
    var slideGrad = ctx.createLinearGradient(0, L.slideTop, 0, L.slideBottom);
    slideGrad.addColorStop(0, '#f0e4cb');
    slideGrad.addColorStop(0.5, '#e5d5b7');
    slideGrad.addColorStop(1, '#d6c29f');
    CM.roundRect(ctx, sx, L.slideTop, L.bodyW, L.slideBottom - L.slideTop, 3);
    ctx.fillStyle = slideGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,48,22,.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    /* slide bevel */
    ctx.beginPath();
    ctx.moveTo(sx + 2, L.slideTop + 2);
    ctx.lineTo(sx + L.bodyW - 2, L.slideTop + 2);
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + 2, L.slideBottom - 2);
    ctx.lineTo(sx + L.bodyW - 2, L.slideBottom - 2);
    ctx.strokeStyle = 'rgba(60,35,12,.4)';
    ctx.stroke();
    ctx.restore();

    /* A, B, C, D scales */
    drawScale(L.aBase, L.aTop, L.aBase, 1, 100, 'A', 0, 2, false);
    drawScale(L.bBase, L.slideTop, L.slideBottom, 1, 100, 'B', slideOffset(), 2, true);
    drawScale(L.cBase, L.slideTop, L.slideBottom, 1, 10, 'C', slideOffset(), 1, true);
    drawScale(L.dBase, L.dTop, L.dBase, 1, 10, 'D', 0, 1, false);
    drawLinear(L.lBase, 'L');

    /* slide cut edges */
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.bodyX + 7, L.slideTop - 4, L.bodyW - 14, L.slideBottom - L.slideTop + 8);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(sx, L.slideTop);
    ctx.lineTo(sx, L.slideBottom);
    ctx.strokeStyle = 'rgba(40,22,8,.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + L.bodyW, L.slideTop);
    ctx.lineTo(sx + L.bodyW, L.slideBottom);
    ctx.strokeStyle = 'rgba(40,22,8,.55)';
    ctx.stroke();
    ctx.restore();

    /* runner */
    drawRunner(now);

    /* screws and title on the body */
    CM.drawScrew(ctx, L.bodyX + 13, L.bodyY + 11, 4, 0.5);
    CM.drawScrew(ctx, L.bodyX + L.bodyW - 13, L.bodyY + 11, 4, 1.4);
    CM.drawScrew(ctx, L.bodyX + 13, L.bodyY + L.bodyH - 11, 4, 2.3);
    CM.drawScrew(ctx, L.bodyX + L.bodyW - 13, L.bodyY + L.bodyH - 11, 4, 0.9);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(6, L.bodyW * 0.009) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(240,215,154,.35)';
    ctx.fillText('MULTIPLY BY DISTANCE', L.bodyX + L.bodyW / 2, L.bodyY + L.bodyH - 13);
    ctx.restore();

    /* bottom hint */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(5.5, w * 0.0075) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(139,127,108,.7)';
    ctx.fillText('C AND D: ONE DECADE   ·   A AND B: TWO DECADES   ·   L: LOGARITHM', w / 2, h - 12);
    ctx.restore();
  }

  function drawIvory(x, y, w, h) {
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#eee3cb');
    g.addColorStop(0.45, '#e3d4b8');
    g.addColorStop(1, '#d2bf9d');
    CM.roundRect(ctx, x, y, w, h, 3);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(66,42,18,.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function drawScale(baseY, topY, bottomY, min, max, letter, offset, decades, onSlide) {
    var L = layout;
    var x0 = L.baseX + offset;
    var scaleW = L.scaleW;
    var labelY = baseY - Math.max(12, L.bandH * 0.42);
    var tickTop = baseY;

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.bodyX + 7, topY - 4, L.bodyW - 14, bottomY - topY + 8);
    ctx.clip();

    /* baseline */
    ctx.beginPath();
    ctx.moveTo(x0, baseY);
    ctx.lineTo(x0 + scaleW, baseY);
    ctx.strokeStyle = onSlide ? 'rgba(54,36,18,.85)' : 'rgba(60,40,20,.8)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    var labelInk = onSlide ? 'rgba(48,32,16,.92)' : 'rgba(54,38,20,.9)';
    var tickInk = onSlide ? 'rgba(75,53,29,.75)' : 'rgba(80,58,32,.65)';
    var compact = view.w < 620;

    for (var d = 0; d < decades; d++) {
      var decade = Math.pow(10, d);
      /* integers */
      for (var i = 1; i <= 10; i++) {
        var v = i * decade;
        if (v > max + 1e-9) break;
        var x = x0 + (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) * scaleW;
        var major = i === 10 || i === 1;
        tick(x, major ? 11 : 8, major ? 1 : 0.8);
        var label = null;
        if (i < 10) label = String(i * decade);
        else if (i === 10 && d === decades - 1) label = String(10 * decade);
        if (compact && decades > 1 && [1, 2, 5].indexOf(i) < 0 && !(i === 10 && d === decades - 1)) label = null;
        if (label) drawLabel(label, x, labelY, labelInk);
      }
      /* tenths */
      for (var t = 1; t < 100; t++) {
        var tv = (t / 10) * decade;
        if (tv < min || tv > max) continue;
        if (t % 10 === 0) continue;
        var tx = x0 + (Math.log10(tv) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) * scaleW;
        tick(tx, 5.5, 0.65);
        if (!compact && decades === 1 && tv < 2 * decade + 1e-9) {
          /* On the single-decade C/D scales there is room for tenths labels. */
          drawLabel(tv.toFixed(1), tx, labelY, labelInk, true);
        }
      }
      /* half-tenths between 1 and 2 */
      for (var q = 0; q < 20; q++) {
        var qv = (1 + q * 0.05) * decade;
        if (qv > 2 * decade + 1e-9) break;
        if (q % 2 === 0) continue;
        var qx = x0 + (Math.log10(qv) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) * scaleW;
        tick(qx, 3.5, 0.5);
      }
    }

    /* scale letter */
    ctx.font = '500 ' + Math.max(11, L.bandH * 0.36) + 'px "Cinzel", serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(120,78,32,.9)';
    ctx.fillText(letter, (onSlide ? L.bodyX + offset + 13 : L.bodyX + 13), baseY - 2);

    ctx.restore();

    function tick(x, h, wdt) {
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, baseY - h);
      ctx.strokeStyle = tickInk;
      ctx.lineWidth = wdt;
      ctx.stroke();
    }

    function drawLabel(text, x, y, ink, small) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = (small ? '400 ' : '500 ') + Math.max(small ? 5 : 6, L.bandH * (small ? 0.18 : 0.23)) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = ink;
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  }

  function drawLinear(baseY, letter) {
    var L = layout;
    var x0 = L.baseX;
    var y = baseY;
    var compact = view.w < 620;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.bodyX + 7, L.lTop - 4, L.bodyW - 14, L.lBase - L.lTop + 8);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + L.scaleW, y);
    ctx.strokeStyle = 'rgba(60,40,20,.8)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    for (var i = 0; i <= 100; i++) {
      var x = x0 + (i / 100) * L.scaleW;
      var major = i % 10 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - (major ? 8 : i % 5 === 0 ? 5 : 3));
      ctx.strokeStyle = 'rgba(112,45,29,.75)';
      ctx.lineWidth = major ? 0.9 : 0.5;
      ctx.stroke();
      if (major && (!compact || i % 20 === 0)) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '500 ' + Math.max(5.5, L.bandH * 0.19) + 'px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(112,45,29,.9)';
        ctx.fillText((i / 100).toFixed(1), x, y - L.bandH * 0.42);
        ctx.restore();
      }
    }
    ctx.font = '500 ' + Math.max(10, L.bandH * 0.33) + 'px "Cinzel", serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(112,45,29,.9)';
    ctx.fillText(letter, x0 + 5, y - 2);
    ctx.restore();
  }

  function drawRunner(now) {
    var L = layout;
    var cx = cursorX();
    var x = cx - 15;
    var y = L.bodyY - 11;
    var h = L.bodyH + 22;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    CM.roundRect(ctx, x, y, 30, h, 4);
    var glass = ctx.createLinearGradient(x, 0, x + 30, 0);
    glass.addColorStop(0, 'rgba(232,205,150,.16)');
    glass.addColorStop(0.45, 'rgba(255,238,196,.06)');
    glass.addColorStop(1, 'rgba(120,85,35,.16)');
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(201,163,90,.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* runner handle */
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x + 4, y - 9, 22, 10, 3) : ctx.rect(x + 4, y - 9, 22, 10);
    ctx.fillStyle = 'rgba(201,163,90,.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,55,20,.6)';
    ctx.stroke();

    /* magnifier */
    var ly = L.bodyY + L.bodyH * 0.50;
    ctx.beginPath();
    ctx.arc(cx, ly, 21, 0, CM.TAU);
    var lens = ctx.createRadialGradient(cx - 5, ly - 6, 2, cx, ly, 21);
    lens.addColorStop(0, 'rgba(255,250,225,.25)');
    lens.addColorStop(0.7, 'rgba(220,200,160,.06)');
    lens.addColorStop(1, 'rgba(90,65,30,.24)');
    ctx.fillStyle = lens;
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,215,154,.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 6, ly - 7, 4, 0, CM.TAU);
    ctx.fillStyle = 'rgba(255,255,240,.18)';
    ctx.fill();

    /* hairline */
    var hair = ctx.createLinearGradient(0, y, 0, y + h);
    hair.addColorStop(0, 'rgba(224,80,50,.25)');
    hair.addColorStop(0.15, 'rgba(236,92,58,.95)');
    hair.addColorStop(0.85, 'rgba(236,92,58,.95)');
    hair.addColorStop(1, 'rgba(224,80,50,.25)');
    ctx.beginPath();
    ctx.moveTo(cx, y + 2);
    ctx.lineTo(cx, y + h - 2);
    ctx.strokeStyle = hair;
    ctx.lineWidth = 1.15;
    ctx.stroke();

    /* tiny glow at cursor */
    ctx.beginPath();
    ctx.arc(cx, ly, 2, 0, CM.TAU);
    ctx.fillStyle = 'rgba(255,230,180,.8)';
    ctx.fill();
    ctx.restore();
  }

  window.addEventListener('resize', function () { buildLayout(); updateReadout(); });
  CM.onVisible(section, function () { animator.start(); }, function () { animator.stop(); }, '250px');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) animator.stop();
    else if (section.getBoundingClientRect().bottom > 0) animator.start();
  });

  buildLayout();
  updateReadout();
  compute({ animate: false });
})();
