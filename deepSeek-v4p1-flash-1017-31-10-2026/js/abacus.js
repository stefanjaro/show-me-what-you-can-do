/* Exhibit I — The Counting Frame. A 13-rod suanpan. */
(function () {
  'use strict';
  var CM = window.CM;
  var canvas = document.getElementById('abacus-canvas');
  if (!canvas) return;

  var RODS = 13;
  var view = CM.setupCanvas(canvas);
  var ctx = view.ctx;
  var section = canvas.closest('.exhibit');
  var input = document.getElementById('abacus-input');
  var setBtn = document.getElementById('abacus-set');
  var clearBtn = document.getElementById('abacus-clear');
  var challengeBtn = document.getElementById('abacus-challenge');
  var valueEl = document.getElementById('abacus-value');
  var challengeEl = document.getElementById('abacus-challenge-text');

  var rods = [];
  var upper = [];
  var lower = [];
  var layout = null;
  var hover = null;
  var selected = 0;
  var focused = false;
  var challenge = 3908;
  var solved = false;
  var shownValue = 0;
  var valueAnim = null;
  var animator = CM.makeAnimator(frame);
  var t0 = performance.now();

  canvas.tabIndex = 0;

  for (var r = 0; r < RODS; r++) {
    rods.push({ u: 0, l: 0 });
    upper.push([bead(), bead()]);
    lower.push([bead(), bead(), bead(), bead(), bead()]);
  }

  function bead() { return { y: 0, vy: 0, target: 0, delay: 0, jiggle: 0 }; }

  function buildLayout() {
    var w = view.w, h = view.h;
    var mobile = w < 620;
    var pad = Math.max(10, Math.min(w, h) * 0.045);
    var frameX = pad;
    var frameY = pad * 0.8;
    var frameW = w - pad * 2;
    var frameH = h - pad * 1.05 - (mobile ? 34 : 48);
    var innerPad = Math.max(8, frameW * 0.018);
    var beamY = frameY + frameH * 0.35;
    var rodGap = (frameW - innerPad * 2) / RODS;
    var beadW = rodGap * 0.72;
    var upperH = Math.min((beamY - frameY - innerPad * 2) / 2.65, frameH * 0.105);
    var lowerH = Math.min((frameY + frameH - beamY - innerPad * 2) / 5.65, frameH * 0.085);
    var gap = Math.min(upperH, lowerH) * 0.14;

    layout = {
      w: w, h: h, mobile: mobile,
      frameX: frameX, frameY: frameY, frameW: frameW, frameH: frameH,
      innerPad: innerPad, beamY: beamY, rodGap: rodGap,
      beadW: beadW, upperH: upperH, lowerH: lowerH, gap: gap,
      rodX: function (i) { return frameX + innerPad + rodGap * (i + 0.5); },
      upperTarget: function (i, index, count) {
        var x = this.rodX(i);
        var set = index >= 2 - count;
        var y = set
          ? this.beamY - this.innerPad - this.upperH / 2 - (1 - index) * (this.upperH + this.gap)
          : this.frameY + this.innerPad + this.upperH / 2 + index * (this.upperH + this.gap);
        return { x: x, y: y };
      },
      lowerTarget: function (i, index, count) {
        var x = this.rodX(i);
        var set = index < count;
        var y = set
          ? this.beamY + this.innerPad + this.lowerH / 2 + index * (this.lowerH + this.gap)
          : this.frameY + this.frameH - this.innerPad - this.lowerH / 2 - (4 - index) * (this.lowerH + this.gap);
        return { x: x, y: y };
      }
    };

    for (var i = 0; i < RODS; i++) {
      for (var a = 0; a < 2; a++) {
        var tu = layout.upperTarget(i, a, rods[i].u);
        upper[i][a].y = tu.y; upper[i][a].vy = 0; upper[i][a].target = tu.y;
      }
      for (var b = 0; b < 5; b++) {
        var tl = layout.lowerTarget(i, b, rods[i].l);
        lower[i][b].y = tl.y; lower[i][b].vy = 0; lower[i][b].target = tl.y;
      }
    }
  }

  function applyDigit(i, d) {
    if (d <= 5) { rods[i].u = 0; rods[i].l = d; }
    else { rods[i].u = 1; rods[i].l = d - 5; }
  }

  function setNumber(n, animate) {
    if (!isFinite(n) || n < 0) n = 0;
    var s = String(Math.floor(n)).slice(-RODS);
    s = s.padStart(RODS, '0');
    var changed = 0;
    var now = performance.now();
    for (var i = 0; i < RODS; i++) {
      var d = parseInt(s[i], 10) || 0;
      var oldU = rods[i].u, oldL = rods[i].l;
      applyDigit(i, d);
      var rodChanged = (oldU !== rods[i].u || oldL !== rods[i].l);
      if (rodChanged) changed++;
      var delay = animate ? (i * 12 + (RODS - 1 - i) * 1.5) : 0;
      for (var a = 0; a < 2; a++) {
        var tu = layout.upperTarget(i, a, rods[i].u);
        upper[i][a].target = tu.y;
        upper[i][a].delay = animate ? now + delay : 0;
      }
      for (var b = 0; b < 5; b++) {
        var tl = layout.lowerTarget(i, b, rods[i].l);
        lower[i][b].target = tl.y;
        lower[i][b].delay = animate ? now + delay : 0;
      }
    }
    if (animate && changed) {
      var plays = Math.min(9, Math.max(2, changed));
      for (var p = 0; p < plays; p++) {
        CMSound.play('bead', { delay: p * 0.055, pitch: 0.82 + (p % 5) * 0.07, vol: 0.8 });
      }
    }
    valueAnim = { from: shownValue, to: getValue(), start: performance.now(), dur: CM.reduced ? 1 : 520 };
    checkChallenge();
  }

  function getValue() {
    var total = 0;
    for (var i = 0; i < RODS; i++) {
      total += (rods[i].u * 5 + rods[i].l) * Math.pow(10, RODS - 1 - i);
    }
    return total;
  }

  function syncTargetsFor(i) {
    for (var a = 0; a < 2; a++) {
      var tu = layout.upperTarget(i, a, rods[i].u);
      upper[i][a].target = tu.y; upper[i][a].delay = 0;
    }
    for (var b = 0; b < 5; b++) {
      var tl = layout.lowerTarget(i, b, rods[i].l);
      lower[i][b].target = tl.y; lower[i][b].delay = 0;
    }
  }

  function clickUpper(i, index) {
    var set = index >= 2 - rods[i].u;
    var old = rods[i].u;
    rods[i].u = set ? (1 - index) : (2 - index);
    if (rods[i].u === old) return;
    syncTargetsFor(i);
    var b = upper[i][index];
    b.jiggle = 1;
    CMSound.play('bead', { pitch: 0.9 + i * 0.018, vol: 1 });
    valueAnim = { from: shownValue, to: getValue(), start: performance.now(), dur: CM.reduced ? 1 : 320 };
    checkChallenge();
  }

  function clickLower(i, index) {
    var set = index < rods[i].l;
    var old = rods[i].l;
    rods[i].l = set ? index : index + 1;
    if (rods[i].l === old) return;
    syncTargetsFor(i);
    var b = lower[i][index];
    b.jiggle = 1;
    CMSound.play('bead', { pitch: 0.75 + i * 0.016, vol: 1 });
    valueAnim = { from: shownValue, to: getValue(), start: performance.now(), dur: CM.reduced ? 1 : 320 };
    checkChallenge();
  }

  function clearRod(i) {
    if (!rods[i].u && !rods[i].l) return;
    rods[i].u = 0; rods[i].l = 0;
    syncTargetsFor(i);
    CMSound.play('bead', { pitch: 0.8 + i * 0.02 });
    valueAnim = { from: shownValue, to: getValue(), start: performance.now(), dur: CM.reduced ? 1 : 320 };
    checkChallenge();
  }

  function checkChallenge() {
    var v = getValue();
    solved = v === challenge;
    if (solved) {
      challengeEl.textContent = 'Solved — the frame reads ' + CM.fmtInt(challenge) + '.';
      if (!section.dataset.solvedOnce) {
        section.dataset.solvedOnce = '1';
        CMSound.play('chime', { notes: [523.25, 659.25, 783.99, 1046.5] });
      }
    } else {
      challengeEl.textContent = 'Set the number ' + CM.fmtInt(challenge) + '.';
      delete section.dataset.solvedOnce;
    }
  }

  function newChallenge() {
    var digits = 2 + Math.floor(Math.random() * 4);
    var min = Math.pow(10, digits - 1);
    var max = Math.pow(10, digits) - 1;
    challenge = min + Math.floor(Math.random() * (max - min + 1));
    delete section.dataset.solvedOnce;
    checkChallenge();
    CMSound.play('tick');
  }

  function parseInput() {
    var raw = (input.value || '').replace(/[^0-9]/g, '');
    if (!raw) return 0;
    raw = raw.slice(-RODS);
    return parseInt(raw, 10) || 0;
  }

  setBtn.addEventListener('click', function () {
    setNumber(parseInput(), true);
    challengeEl.scrollIntoView;
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); setNumber(parseInput(), true); }
  });
  clearBtn.addEventListener('click', function () {
    input.value = '0';
    setNumber(0, true);
  });
  challengeBtn.addEventListener('click', newChallenge);

  canvas.addEventListener('pointermove', function (e) {
    var p = CM.pointerPos(canvas, e);
    hover = hitTest(p.x, p.y);
    canvas.style.cursor = hover ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', function () { hover = null; });

  canvas.addEventListener('pointerdown', function (e) {
    var p = CM.pointerPos(canvas, e);
    var hit = hitTest(p.x, p.y);
    canvas.focus({ preventScroll: true });
    if (!hit) return;
    if (hit.type === 'upper') clickUpper(hit.rod, hit.index);
    else if (hit.type === 'lower') clickLower(hit.rod, hit.index);
    else if (hit.type === 'beam') clearRod(hit.rod);
  });

  canvas.addEventListener('focus', function () { focused = true; });
  canvas.addEventListener('blur', function () { focused = false; });

  canvas.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { selected = (selected + RODS - 1) % RODS; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { selected = (selected + 1) % RODS; e.preventDefault(); }
    else if (e.key === 'ArrowUp') {
      var v = rods[selected].u * 5 + rods[selected].l;
      if (v < 15) { applyDigit(selected, v + 1); syncTargetsFor(selected); CMSound.play('bead', { pitch: .85 + selected * .02 }); valueAnim = { from: shownValue, to: getValue(), start: performance.now(), dur: 260 }; checkChallenge(); }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      var v2 = rods[selected].u * 5 + rods[selected].l;
      if (v2 > 0) { applyDigit(selected, v2 - 1); syncTargetsFor(selected); CMSound.play('bead', { pitch: .8 + selected * .02 }); valueAnim = { from: shownValue, to: getValue(), start: performance.now(), dur: 260 }; checkChallenge(); }
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      clearRod(selected); e.preventDefault();
    }
  });

  function hitTest(px, py) {
    if (!layout) return null;
    var i, b, target;
    for (i = 0; i < RODS; i++) {
      for (var a = 0; a < 2; a++) {
        b = upper[i][a];
        target = layout.upperTarget(i, a, rods[i].u);
        if (Math.abs(px - target.x) < layout.beadW * 0.58 && Math.abs(py - b.y) < layout.upperH * 0.62) {
          return { type: 'upper', rod: i, index: a };
        }
      }
      for (var c = 0; c < 5; c++) {
        b = lower[i][c];
        target = layout.lowerTarget(i, c, rods[i].l);
        if (Math.abs(px - target.x) < layout.beadW * 0.58 && Math.abs(py - b.y) < layout.lowerH * 0.62) {
          return { type: 'lower', rod: i, index: c };
        }
      }
      var x = layout.rodX(i);
      if (Math.abs(px - x) < layout.rodGap * 0.45 && Math.abs(py - layout.beamY) < layout.innerPad + 5) {
        return { type: 'beam', rod: i };
      }
    }
    return null;
  }

  function frame(now, dtMs) {
    if (!layout) return;
    var dt = Math.min(0.032, dtMs / 1000);
    var t = (now - t0) / 1000;
    ctx.clearRect(0, 0, view.w, view.h);
    drawBackdrop(t);

    var L = layout;
    /* frame */
    ctx.save();
    var fg = ctx.createLinearGradient(L.frameX, L.frameY, L.frameX + L.frameW, L.frameY + L.frameH);
    fg.addColorStop(0, '#3a2412');
    fg.addColorStop(0.28, '#24170c');
    fg.addColorStop(0.62, '#1b1108');
    fg.addColorStop(1, '#2f1d0e');
    CM.roundRect(ctx, L.frameX, L.frameY, L.frameW, L.frameH, Math.min(18, L.frameW * 0.014));
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(201,163,90,.28)';
    ctx.stroke();

    /* inner recess */
    var ix = L.frameX + L.innerPad, iy = L.frameY + L.innerPad;
    var iw = L.frameW - L.innerPad * 2, ih = L.frameH - L.innerPad * 2;
    CM.roundRect(ctx, ix, iy, iw, ih, 6);
    var recess = ctx.createLinearGradient(ix, iy, ix, iy + ih);
    recess.addColorStop(0, '#0b0704');
    recess.addColorStop(0.5, '#100b06');
    recess.addColorStop(1, '#080503');
    ctx.fillStyle = recess;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* subtle wood grain */
    ctx.save();
    CM.roundRect(ctx, L.frameX, L.frameY, L.frameW, L.frameH, 14);
    ctx.clip();
    for (var g = 0; g < 16; g++) {
      var gy = L.frameY + (g / 16) * L.frameH;
      ctx.beginPath();
      for (var gx = L.frameX; gx <= L.frameX + L.frameW; gx += 16) {
        var yy = gy + Math.sin(gx * 0.013 + g * 1.7) * 2.2;
        if (gx === L.frameX) ctx.moveTo(gx, yy); else ctx.lineTo(gx, yy);
      }
      ctx.strokeStyle = 'rgba(201,163,90,' + (0.012 + (g % 3) * 0.006) + ')';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();

    /* rods */
    for (var i = 0; i < RODS; i++) {
      var x = L.rodX(i);
      var rodGrad = ctx.createLinearGradient(x - 2, 0, x + 2, 0);
      rodGrad.addColorStop(0, 'rgba(70,48,22,.9)');
      rodGrad.addColorStop(0.45, 'rgba(238,214,160,.85)');
      rodGrad.addColorStop(0.6, 'rgba(201,163,90,.9)');
      rodGrad.addColorStop(1, 'rgba(60,40,18,.9)');
      ctx.beginPath();
      ctx.moveTo(x, iy + 3);
      ctx.lineTo(x, iy + ih - 3);
      ctx.strokeStyle = rodGrad;
      ctx.lineWidth = Math.max(1.4, L.rodGap * 0.045);
      ctx.stroke();
    }

    /* beam */
    var beamH = Math.max(10, L.frameH * 0.028);
    var by = L.beamY - beamH / 2;
    var bg = ctx.createLinearGradient(0, by, 0, by + beamH);
    bg.addColorStop(0, '#6b4a22');
    bg.addColorStop(0.22, '#c8a35c');
    bg.addColorStop(0.5, '#8d642d');
    bg.addColorStop(0.78, '#3f2911');
    bg.addColorStop(1, '#241608');
    ctx.fillStyle = bg;
    ctx.fillRect(ix, by, iw, beamH);
    ctx.strokeStyle = 'rgba(20,12,5,.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ix, by, iw, beamH);
    ctx.beginPath();
    ctx.moveTo(ix, by + 1.5);
    ctx.lineTo(ix + iw, by + 1.5);
    ctx.strokeStyle = 'rgba(240,220,170,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* bead shadows and beads */
    for (var s = 0; s < RODS; s++) {
      for (var u = 0; u < 2; u++) updateUpper(s, u, now, dt);
      for (var v = 0; v < 5; v++) updateLower(s, v, now, dt);
    }

    for (var rr = 0; rr < RODS; rr++) {
      for (var aa = 0; aa < 2; aa++) {
        var ub = upper[rr][aa];
        drawBead(L.rodX(rr), ub.y, L.beadW, L.upperH, hover && hover.type === 'upper' && hover.rod === rr && hover.index === aa, ub.jiggle);
      }
      for (var cc = 0; cc < 5; cc++) {
        var lb = lower[rr][cc];
        drawBead(L.rodX(rr), lb.y, L.beadW, L.lowerH, hover && hover.type === 'lower' && hover.rod === rr && hover.index === cc, lb.jiggle);
      }
    }

    /* unit mark and engraved digits */
    var unitRod = RODS - 3;
    var ux = L.rodX(unitRod);
    ctx.beginPath();
    ctx.arc(ux, L.frameY + L.innerPad * 0.55, Math.max(2, L.rodGap * 0.06), 0, CM.TAU);
    ctx.fillStyle = 'rgba(240,215,154,.55)';
    ctx.fill();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(7, L.rodGap * 0.26) + 'px "IBM Plex Mono", monospace';
    for (var d = 0; d < RODS; d++) {
      var val = rods[d].u * 5 + rods[d].l;
      ctx.fillStyle = d === selected && focused ? 'rgba(240,215,154,.9)' : 'rgba(201,163,90,.32)';
      ctx.fillText(String(val), L.rodX(d), L.frameY + L.frameH + (L.mobile ? 14 : 20));
    }
    ctx.restore();

    /* frame corners */
    for (var k = 0; k < 4; k++) {
      var sx = k % 2 === 0 ? L.frameX + 9 : L.frameX + L.frameW - 9;
      var sy = k < 2 ? L.frameY + 9 : L.frameY + L.frameH - 9;
      CM.drawScrew(ctx, sx, sy, Math.max(2.6, L.frameW * 0.005), 0.4 + k);
    }

    /* focus ring for keyboard users */
    if (focused) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240,215,154,.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(L.rodX(selected) - L.rodGap * 0.44, L.frameY + L.innerPad, L.rodGap * 0.88, L.frameH - L.innerPad * 2);
      ctx.restore();
    }

    ctx.restore();

    /* value display */
    if (valueAnim) {
      var p = CM.clamp((now - valueAnim.start) / valueAnim.dur, 0, 1);
      var e = CM.ease.outCubic(p);
      shownValue = Math.round(CM.lerp(valueAnim.from, valueAnim.to, e));
      if (p >= 1) { shownValue = valueAnim.to; valueAnim = null; }
    } else {
      shownValue = getValue();
    }
    var txt = CM.fmtInt(shownValue);
    if (valueEl.textContent !== txt) valueEl.textContent = txt;
  }

  function updateUpper(i, index, now, dt) {
    var b = upper[i][index];
    if (b.jiggle > 0) b.jiggle = Math.max(0, b.jiggle - dt * 5);
    if (now < b.delay) return;
    var k = 190, damp = 17;
    var a = (b.target - b.y) * k - b.vy * damp;
    b.vy += a * dt;
    b.y += b.vy * dt;
    if (Math.abs(b.target - b.y) < 0.06 && Math.abs(b.vy) < 0.6) { b.y = b.target; b.vy = 0; }
  }

  function updateLower(i, index, now, dt) {
    var b = lower[i][index];
    if (b.jiggle > 0) b.jiggle = Math.max(0, b.jiggle - dt * 5);
    if (now < b.delay) return;
    var k = 190, damp = 17;
    var a = (b.target - b.y) * k - b.vy * damp;
    b.vy += a * dt;
    b.y += b.vy * dt;
    if (Math.abs(b.target - b.y) < 0.06 && Math.abs(b.vy) < 0.6) { b.y = b.target; b.vy = 0; }
  }

  function drawBead(cx, cy, w, h, isHover, jiggle) {
    var wob = jiggle ? Math.sin(jiggle * 24) * jiggle * 1.2 : 0;
    ctx.save();
    ctx.translate(cx, cy + wob);
    /* shadow */
    ctx.beginPath();
    ctx.ellipse(0, h * 0.38, w * 0.46, h * 0.22, 0, 0, CM.TAU);
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.fill();

    /* bead body */
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.bezierCurveTo(w * 0.58, -h * 0.36, w * 0.58, h * 0.36, 0, h / 2);
    ctx.bezierCurveTo(-w * 0.58, h * 0.36, -w * 0.58, -h * 0.36, 0, -h / 2);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, isHover ? '#fff0ce' : '#eddcb9');
    g.addColorStop(0.32, '#d8c095');
    g.addColorStop(0.68, '#a9834f');
    g.addColorStop(1, '#5b3f1e');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, w * 0.035);
    ctx.strokeStyle = 'rgba(48,30,12,.9)';
    ctx.stroke();

    /* highlight */
    ctx.beginPath();
    ctx.ellipse(-w * 0.12, -h * 0.2, w * 0.22, h * 0.18, -0.4, 0, CM.TAU);
    ctx.fillStyle = 'rgba(255,246,220,.32)';
    ctx.fill();

    /* rod hole */
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.09, h * 0.10, 0, 0, CM.TAU);
    ctx.fillStyle = 'rgba(30,18,7,.55)';
    ctx.fill();

    if (isHover) {
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.bezierCurveTo(w * 0.58, -h * 0.36, w * 0.58, h * 0.36, 0, h / 2);
      ctx.bezierCurveTo(-w * 0.58, h * 0.36, -w * 0.58, -h * 0.36, 0, -h / 2);
      ctx.strokeStyle = 'rgba(255,238,190,.8)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBackdrop(t) {
    var w = view.w, h = view.h;
    var g = ctx.createRadialGradient(w * 0.5, h * 0.44, 0, w * 0.5, h * 0.44, Math.max(w, h) * 0.72);
    g.addColorStop(0, '#151009');
    g.addColorStop(0.55, '#0b0805');
    g.addColorStop(1, '#070604');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = 'rgba(201,163,90,.2)';
    ctx.lineWidth = 0.6;
    for (var i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.46, Math.max(w, h) * (0.22 + i * 0.1) + Math.sin(t * 0.2 + i) * 2, 0, CM.TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  window.addEventListener('resize', function () {
    buildLayout();
    shownValue = getValue();
  });

  CM.onVisible(section, function () { animator.start(); }, function () { animator.stop(); }, '250px');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) animator.stop();
    else if (section.getBoundingClientRect().bottom > 0) animator.start();
  });

  buildLayout();
  setNumber(8641, false);
  shownValue = getValue();
  valueEl.textContent = CM.fmtInt(shownValue);
  challenge = 3908;
  checkChallenge();
})();
