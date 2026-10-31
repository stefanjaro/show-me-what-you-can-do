/* Exhibit IV — The Difference Engine. Finite differences, made visible. */
(function () {
  'use strict';
  var CM = window.CM;
  var canvas = document.getElementById('difference-canvas');
  if (!canvas) return;

  var view = CM.setupCanvas(canvas);
  var ctx = view.ctx;
  var section = canvas.closest('.exhibit');
  var preset = document.getElementById('de-preset');
  var aInput = document.getElementById('de-a');
  var bInput = document.getElementById('de-b');
  var cInput = document.getElementById('de-c');
  var dInput = document.getElementById('de-d');
  var loadBtn = document.getElementById('de-load');
  var crankBtn = document.getElementById('de-crank');
  var autoBtn = document.getElementById('de-auto');
  var resetBtn = document.getElementById('de-reset');
  var nEl = document.getElementById('de-n');
  var valueEl = document.getElementById('de-value');
  var diffsEl = document.getElementById('de-diffs');

  var DIGITS = 7;
  var MAX = Math.pow(10, DIGITS) - 1;
  var n = 0;
  var values = [0, 1, 2, 0]; /* f, d1, d2, d3 */
  var rows = [{ n: 0, f: 0 }];
  var crank = { angle: 0, anim: null };
  var auto = false;
  var nextAuto = 0;
  var overflow = false;
  var columns = [];
  var layout = null;
  var animator = CM.makeAnimator(frame);
  var lastSound = 0;

  var LABELS = ['N', 'f(N)', 'Δ1', 'Δ2', 'Δ3'];

  function readCoeffs() {
    return {
      a: CM.clamp(parseInt(aInput.value, 10) || 0, 0, 9),
      b: CM.clamp(parseInt(bInput.value, 10) || 0, 0, 9),
      c: CM.clamp(parseInt(cInput.value, 10) || 0, 0, 9),
      d: CM.clamp(parseInt(dInput.value, 10) || 0, 0, 9)
    };
  }

  function initialValues(co) {
    var f0 = co.d;
    var d1 = co.a + co.b + co.c;
    var d2 = 6 * co.a + 2 * co.b;
    var d3 = 6 * co.a;
    return [f0, d1, d2, d3];
  }

  function load(animate) {
    var co = readCoeffs();
    aInput.value = co.a; bInput.value = co.b; cInput.value = co.c; dInput.value = co.d;
    n = 0;
    values = initialValues(co);
    rows = [{ n: 0, f: values[0] }];
    overflow = false;
    stopAuto();
    if (animate) {
      columns.forEach(function (col, i) {
        col.roll.start = performance.now() + (4 - i) * 45;
        col.roll.dur = CM.reduced ? 1 : 420;
        col.roll.old = col.value;
        col.value = displayValue(i);
        col.roll.new = col.value;
      });
    } else {
      columns.forEach(function (col, i) { col.value = displayValue(i); });
    }
    updateReadout();
    CMSound.play('ratchet', { vol: .65 });
  }

  function displayValue(i) {
    if (i === 0) return n;
    return values[i - 1];
  }

  function step() {
    if (overflow) { CMSound.play('relay', { vol: .5, pitch: .6 }); return; }
    var nextF = values[0] + values[1];
    var nextD1 = values[1] + values[2];
    var nextD2 = values[2] + values[3];
    var nextN = n + 1;
    if (nextF > MAX || nextD1 > MAX || nextD2 > MAX || nextN > MAX) {
      overflow = true;
      stopAuto();
      updateReadout();
      CMSound.play('chime', { notes: [196, 174.61, 146.83], vol: .8 });
      return;
    }
    values = [nextF, nextD1, nextD2, values[3]];
    n = nextN;
    rows.unshift({ n: n, f: values[0] });
    if (rows.length > 6) rows.pop();

    var now = performance.now();
    columns.forEach(function (col, i) {
      col.roll.start = now + (4 - i) * 35;
      col.roll.dur = CM.reduced ? 1 : 360;
      col.roll.old = col.value;
      col.value = displayValue(i);
      col.roll.new = col.value;
    });
    updateReadout();
    var nowSound = performance.now();
    if (nowSound - lastSound > 50) {
      lastSound = nowSound;
      CMSound.play('tick', { vol: .55, pitch: 0.9 + (n % 5) * 0.04 });
    }
  }

  function updateReadout() {
    nEl.textContent = CM.fmtInt(n);
    valueEl.textContent = CM.fmtInt(values[0]);
    if (overflow) {
      diffsEl.textContent = 'The machine has run past its seven figures. Reset or load a smaller polynomial.';
      diffsEl.style.color = '#d79b62';
    } else {
      diffsEl.textContent = 'Δ1 ' + CM.fmtInt(values[1]) + ' · Δ2 ' + CM.fmtInt(values[2]) + ' · Δ3 ' + CM.fmtInt(values[3]);
      diffsEl.style.color = '';
    }
  }

  function startCrank() {
    if (crank.anim) return;
    if (overflow) { CMSound.play('relay', { vol: .4, pitch: .6 }); return; }
    crank.anim = { start: performance.now(), dur: CM.reduced ? 1 : 620, stepped: false };
    CMSound.play('ratchet', { vol: .7 });
  }

  function stopAuto() {
    if (!auto) return;
    auto = false;
    autoBtn.setAttribute('aria-pressed', 'false');
    autoBtn.textContent = 'Run continuously';
  }

  crankBtn.addEventListener('click', startCrank);
  autoBtn.addEventListener('click', function () {
    auto = !auto;
    autoBtn.setAttribute('aria-pressed', auto ? 'true' : 'false');
    autoBtn.textContent = auto ? 'Stop' : 'Run continuously';
    nextAuto = performance.now() + 250;
    if (auto) startCrank();
  });
  loadBtn.addEventListener('click', function () { load(true); });
  resetBtn.addEventListener('click', function () { load(true); });
  preset.addEventListener('change', function () {
    var v = preset.value;
    if (v === 'custom') return;
    var parts = v.split(',');
    aInput.value = parts[0]; bInput.value = parts[1]; cInput.value = parts[2]; dInput.value = parts[3];
    load(true);
  });
  [aInput, bInput, cInput, dInput].forEach(function (el) {
    el.addEventListener('change', function () { preset.value = 'custom'; });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); preset.value = 'custom'; load(true); }
    });
  });

  canvas.tabIndex = 0;
  canvas.addEventListener('pointermove', function (e) {
    if (!layout) return;
    var p = CM.pointerPos(canvas, e);
    var over = Math.hypot(p.x - layout.crankX, p.y - layout.crankY) < layout.crankR * 1.15;
    canvas.style.cursor = over ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerdown', function (e) {
    if (!layout) return;
    var p = CM.pointerPos(canvas, e);
    if (Math.hypot(p.x - layout.crankX, p.y - layout.crankY) < layout.crankR * 1.2) {
      canvas.focus({ preventScroll: true });
      startCrank();
    }
  });
  canvas.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startCrank(); }
  });

  function buildLayout() {
    var w = view.w, h = view.h;
    var margin = Math.max(12, w * 0.025);
    var crankW = w < 620 ? Math.max(48, w * 0.075) : Math.max(74, w * 0.105);
    var frameX = margin;
    var frameY = margin * 0.9;
    var frameW = w - margin * 2 - crankW;
    var tapeH = Math.max(58, h * 0.115);
    var frameH = h - frameY - tapeH - Math.max(16, h * 0.035);
    var colGap = frameW * 0.016;
    var colW = (frameW - colGap * 6) / 5;
    var topPad = frameH * 0.16;
    var bottomPad = frameH * 0.05;
    var windowH = Math.min((frameH - topPad - bottomPad) / DIGITS, colW * 0.46);
    var winW = colW * 0.66;
    layout = {
      w: w, h: h, frameX: frameX, frameY: frameY, frameW: frameW, frameH: frameH,
      colW: colW, colGap: colGap, topPad: topPad, windowH: windowH, winW: winW,
      crankX: frameX + frameW + crankW * 0.52,
      crankY: frameY + frameH * 0.41,
      crankR: Math.min(crankW * 0.42, frameH * 0.17),
      tapeX: frameX + frameW * 0.16,
      tapeY: frameY + frameH - 2,
      tapeW: frameW * 0.68,
      tapeH: tapeH
    };
    columns = LABELS.map(function (label, i) {
      return {
        label: label,
        x: frameX + colGap + i * (colW + colGap),
        value: columns[i] ? columns[i].value : 0,
        roll: columns[i] ? columns[i].roll : { start: 0, dur: 1, old: 0, new: 0 }
      };
    });
    if (!columns.valueInit) {
      columns.forEach(function (c, i) { c.value = displayValue(i); });
      columns.valueInit = true;
    }
  }

  function frame(now, dtMs) {
    if (!layout) buildLayout();
    if (auto) {
      if (now >= nextAuto) {
        startCrank();
        nextAuto = now + (CM.reduced ? 1200 : 980);
      }
    }
    if (crank.anim) {
      var p = CM.clamp((now - crank.anim.start) / crank.anim.dur, 0, 1);
      crank.angle = CM.ease.inOutCubic(p) * CM.TAU;
      if (p >= 0.56 && !crank.anim.stepped) {
        crank.anim.stepped = true;
        step();
      }
      if (p >= 1) { crank.angle = 0; crank.anim = null; }
    }
    draw(now);
  }

  function draw(now) {
    var w = view.w, h = view.h, L = layout;
    ctx.clearRect(0, 0, w, h);
    var bg = ctx.createRadialGradient(w * 0.44, h * 0.42, 0, w * 0.44, h * 0.42, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#17120b');
    bg.addColorStop(0.55, '#0b0907');
    bg.addColorStop(1, '#070604');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    /* machine shadow */
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.65)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 14;
    CM.roundRect(ctx, L.frameX, L.frameY, L.frameW, L.frameH, 8);
    ctx.fillStyle = '#14100b';
    ctx.fill();
    ctx.restore();

    /* machine body */
    CM.roundRect(ctx, L.frameX, L.frameY, L.frameW, L.frameH, 8);
    var body = ctx.createLinearGradient(0, L.frameY, 0, L.frameY + L.frameH);
    body.addColorStop(0, '#2d2216');
    body.addColorStop(0.12, '#1b140d');
    body.addColorStop(0.8, '#100c08');
    body.addColorStop(1, '#1c140c');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,163,90,.32)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    /* inner bezel */
    ctx.strokeStyle = 'rgba(201,163,90,.12)';
    ctx.lineWidth = 1;
    CM.roundRect(ctx, L.frameX + 6, L.frameY + 6, L.frameW - 12, L.frameH - 12, 5);
    ctx.stroke();

    /* top plate */
    var topH = L.topPad * 0.72;
    var topGrad = ctx.createLinearGradient(0, L.frameY + 8, 0, L.frameY + 8 + topH);
    topGrad.addColorStop(0, '#5b4525');
    topGrad.addColorStop(0.5, '#332615');
    topGrad.addColorStop(1, '#191108');
    ctx.fillStyle = topGrad;
    ctx.fillRect(L.frameX + 8, L.frameY + 8, L.frameW - 16, topH);
    ctx.strokeStyle = 'rgba(20,12,5,.6)';
    ctx.strokeRect(L.frameX + 8, L.frameY + 8, L.frameW - 16, topH);

    /* gear ornament on the top plate */
    if (w > 620) for (var gi = 0; gi < 5; gi++) {
      var gx = L.frameX + L.colW * 0.5 + L.colGap + gi * (L.colW + L.colGap);
      CM.drawGear(ctx, gx, L.frameY + 8 + topH * 0.52, topH * 0.26, 14, crank.angle * (gi % 2 ? -0.5 : 1) + gi, {
        depth: 2.5, hole: topH * 0.07,
        hi: '#d9bd7b', mid: '#8d6a2e', lo: '#3b290f',
        stroke: 'rgba(20,12,4,.8)'
      });
    }

    /* column bays */
    columns.forEach(function (col, i) {
      drawColumn(col, i, now);
    });

    /* crank assembly */
    drawCrank(now);

    /* tape */
    drawTape(now);

    /* overrun lamp */
    if (w > 620) {
      var lampX = L.frameX + L.frameW - 22;
      var lampY = L.frameY + 20;
      ctx.beginPath();
      ctx.arc(lampX, lampY, 4.5, 0, CM.TAU);
      ctx.fillStyle = overflow ? '#d7653d' : 'rgba(70,48,22,.7)';
      ctx.fill();
      ctx.strokeStyle = overflow ? 'rgba(255,180,120,.8)' : 'rgba(201,163,90,.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '400 ' + Math.max(5, w * 0.006) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = overflow ? 'rgba(230,150,110,.9)' : 'rgba(139,127,108,.55)';
      ctx.fillText(overflow ? 'OVERSET' : 'READY', lampX - 9, lampY);
      ctx.restore();

      /* title */
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 ' + Math.max(7, w * 0.0095) + 'px "Cinzel", serif';
      ctx.fillStyle = 'rgba(240,215,154,.4)';
      ctx.fillText('DIFFERENCE ENGINE · No. 2', L.frameX + L.frameW / 2, L.frameY + L.frameH - 12);
      ctx.restore();
    }

    /* screws */
    CM.drawScrew(ctx, L.frameX + 16, L.frameY + 16, 4, 0.5);
    CM.drawScrew(ctx, L.frameX + L.frameW - 16, L.frameY + 16, 4, 1.4);
    CM.drawScrew(ctx, L.frameX + 16, L.frameY + L.frameH - 16, 4, 2.2);
    CM.drawScrew(ctx, L.frameX + L.frameW - 16, L.frameY + L.frameH - 16, 4, 0.8);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(5.5, w * 0.007) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(139,127,108,.65)';
    ctx.fillText('ADD · ADD · ADD · PRINT', w / 2, h - 12);
    ctx.restore();
  }

  function drawColumn(col, i, now) {
    var L = layout;
    var x = col.x;
    var y = L.frameY + L.topPad;
    var winH = L.windowH;
    var winW = L.winW;
    var colH = winH * DIGITS;

    /* bay background */
    var bay = ctx.createLinearGradient(x, y, x + L.colW, y);
    bay.addColorStop(0, 'rgba(0,0,0,.25)');
    bay.addColorStop(0.5, 'rgba(201,163,90,.04)');
    bay.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = bay;
    ctx.fillRect(x, y - L.topPad * 0.36, L.colW, colH + L.topPad * 0.7);

    /* label plate */
    var plateY = y - L.topPad * 0.42;
    var plateH = L.topPad * 0.27;
    var pg = ctx.createLinearGradient(0, plateY, 0, plateY + plateH);
    pg.addColorStop(0, '#c7a35c');
    pg.addColorStop(0.45, '#8b652c');
    pg.addColorStop(1, '#4b3314');
    CM.roundRect(ctx, x + L.colW * 0.12, plateY, L.colW * 0.76, plateH, 2);
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,18,6,.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(5.5, plateH * 0.62) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#241708';
    ctx.fillText(col.label, x + L.colW / 2, plateY + plateH / 2 + 0.3);
    ctx.restore();

    /* digit windows */
    var roll = col.roll;
    var p = roll.start ? CM.clamp((now - roll.start) / roll.dur, 0, 1) : 1;
    var pe = CM.ease.outCubic(p);
    for (var d = 0; d < DIGITS; d++) {
      var wy = y + d * winH;
      var wx = x + (L.colW - winW) / 2;
      var pad = winH * 0.08;
      var wh = winH - pad * 2;

      ctx.save();
      CM.roundRect(ctx, wx, wy + pad, winW, wh, 2);
      var wg = ctx.createLinearGradient(0, wy, 0, wy + winH);
      wg.addColorStop(0, '#050403');
      wg.addColorStop(0.35, '#120e09');
      wg.addColorStop(0.7, '#1c160f');
      wg.addColorStop(1, '#090705');
      ctx.fillStyle = wg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(201,163,90,.22)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      /* glass highlight */
      ctx.beginPath();
      ctx.moveTo(wx + 2, wy + pad + 2);
      ctx.lineTo(wx + winW - 2, wy + pad + 2);
      ctx.strokeStyle = 'rgba(240,225,190,.09)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.rect(wx + 1, wy + pad + 1, winW - 2, wh - 2);
      ctx.clip();

      var oldDigit = digitAt(roll.old, d);
      var newDigit = digitAt(roll.new, d);
      var fontSize = Math.max(8, wh * 0.78);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 ' + fontSize + 'px "IBM Plex Mono", monospace';
      var cx = wx + winW / 2;
      if (p < 1 && oldDigit !== newDigit) {
        ctx.fillStyle = 'rgba(240,215,154,.9)';
        ctx.fillText(oldDigit, cx, wy + pad + wh / 2 - pe * winH);
        ctx.fillStyle = 'rgba(240,215,154,.55)';
        ctx.fillText(newDigit, cx, wy + pad + wh / 2 + (1 - pe) * winH);
      } else {
        ctx.fillStyle = 'rgba(240,215,154,.92)';
        ctx.fillText(newDigit, cx, wy + pad + wh / 2);
      }
      ctx.restore();
    }

    /* column edges */
    ctx.strokeStyle = 'rgba(201,163,90,.1)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x - L.colGap * 0.5, y - L.topPad * 0.25);
    ctx.lineTo(x - L.colGap * 0.5, y + colH + L.topPad * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + L.colW + L.colGap * 0.5, y - L.topPad * 0.25);
    ctx.lineTo(x + L.colW + L.colGap * 0.5, y + colH + L.topPad * 0.2);
    ctx.stroke();
  }

  function digitAt(v, pos) {
    var s = String(Math.max(0, Math.floor(v))).padStart(DIGITS, '0');
    return s.charAt(pos);
  }

  function drawCrank(now) {
    var L = layout;
    var cx = L.crankX, cy = L.crankY, r = L.crankR;
    ctx.save();
    ctx.translate(cx, cy);

    /* mount */
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.18, 0, CM.TAU);
    ctx.fillStyle = 'rgba(27,19,11,.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,163,90,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.rotate(crank.angle);

    /* crank wheel */
    CM.drawGear(ctx, 0, 0, r, 28, 0, {
      depth: r * 0.13,
      hole: r * 0.58,
      hi: '#e0c381',
      mid: '#9a722f',
      lo: '#3e2a10',
      stroke: 'rgba(22,13,5,.9)',
      holeFill: '#0e0a06',
      holeStroke: 'rgba(240,215,154,.3)',
      spokes: 5
    });

    /* handle arm */
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.58, 0);
    ctx.lineWidth = Math.max(4, r * 0.09);
    ctx.strokeStyle = '#b08a47';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 0.58, 0, r * 0.15, 0, CM.TAU);
    var hg = ctx.createRadialGradient(r * 0.53, -r * 0.05, 1, r * 0.58, 0, r * 0.16);
    hg.addColorStop(0, '#f0d79a');
    hg.addColorStop(0.6, '#a27733');
    hg.addColorStop(1, '#4a3112');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,18,6,.8)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, CM.TAU);
    ctx.fillStyle = '#e2c47f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,18,6,.7)';
    ctx.stroke();

    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(6, L.w * 0.008) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(201,163,90,.5)';
    ctx.fillText('TURN', cx, cy + r * 1.34);
    ctx.restore();
  }

  function drawTape(now) {
    var L = layout;
    var x = L.tapeX, y = L.tapeY, w = L.tapeW, h = L.tapeH;
    if (h < 20) return;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    CM.roundRect(ctx, x, y, w, h, 2);
    var paper = ctx.createLinearGradient(0, y, 0, y + h);
    paper.addColorStop(0, '#eee3ca');
    paper.addColorStop(1, '#d6c5a6');
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(70,48,22,.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    /* perforations */
    for (var px = x + 8; px < x + w - 4; px += 10) {
      ctx.beginPath();
      ctx.arc(px, y + 4, 1.1, 0, CM.TAU);
      ctx.fillStyle = 'rgba(70,48,22,.3)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.rect(x + 4, y + 8, w - 8, h - 10);
    ctx.clip();

    var rowH = Math.max(10, (h - 22) / 3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(7, rowH * 0.58) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(48,33,18,.9)';
    ctx.fillText('N', x + 14, y + 12);
    ctx.fillText('f(N)', x + w * 0.36, y + 12);
    ctx.textAlign = 'right';
    ctx.fillText('PRINTED TABLE', x + w - 14, y + 12);
    ctx.textAlign = 'left';

    var headerH = 16;
    for (var i = 0; i < 3; i++) {
      var row = rows[i];
      if (!row) continue;
      var ry = y + headerH + 4 + i * rowH + rowH * 0.5;
      ctx.font = '500 ' + Math.max(7, rowH * 0.52) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = i === 0 ? 'rgba(48,33,18,.92)' : 'rgba(48,33,18,.55)';
      ctx.fillText(String(row.n).padStart(4, ' '), x + 14, ry);
      ctx.fillText(CM.fmtInt(row.f), x + w * 0.36, ry);
      if (i === 0) {
        ctx.fillStyle = 'rgba(138,59,36,.8)';
        ctx.fillText('←', x + w - 18, ry);
      }
    }
    ctx.restore();
  }

  window.addEventListener('resize', function () {
    buildLayout();
    columns.forEach(function (col, i) { col.value = displayValue(i); });
  });
  CM.onVisible(section, function () { animator.start(); }, function () { animator.stop(); }, '250px');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) animator.stop();
    else if (section.getBoundingClientRect().bottom > 0) animator.start();
  });

  buildLayout();
  columns.forEach(function (col, i) {
    col.value = displayValue(i);
    col.roll.old = col.value;
    col.roll.new = col.value;
  });
  load(false);
})();
