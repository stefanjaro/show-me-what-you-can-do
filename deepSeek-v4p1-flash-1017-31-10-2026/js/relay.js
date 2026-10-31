/* Exhibit VI — The Relay Adder. Four full adders, one bright carry. */
(function () {
  'use strict';
  var CM = window.CM;
  var canvas = document.getElementById('relay-canvas');
  if (!canvas) return;

  var view = CM.setupCanvas(canvas);
  var ctx = view.ctx;
  var section = canvas.closest('.exhibit');
  var aPad = document.getElementById('relay-a-bits');
  var bPad = document.getElementById('relay-b-bits');
  var aNum = document.getElementById('relay-a-num');
  var bNum = document.getElementById('relay-b-num');
  var randomBtn = document.getElementById('relay-random');
  var clearBtn = document.getElementById('relay-clear');
  var modeBtns = Array.prototype.slice.call(document.querySelectorAll('[data-relay-mode]'));
  var decEl = document.getElementById('relay-decimal');
  var binEl = document.getElementById('relay-binary');
  var carryEl = document.getElementById('relay-carry');

  var A = 9, B = 5;
  var mode = 'add';
  var bits = [];
  var settle = null;
  var animator = CM.makeAnimator(frame);
  var layout = null;
  var lastActive = -1;

  function compute() {
    var bEff = mode === 'sub' ? (~B & 15) : B;
    var carry = mode === 'sub' ? 1 : 0;
    var out = [];
    for (var i = 0; i < 4; i++) {
      var a = (A >> i) & 1;
      var b = (bEff >> i) & 1;
      var xor1 = a ^ b;
      var sum = xor1 ^ carry;
      var and1 = a & b;
      var and2 = carry & xor1;
      var cout = and1 | and2;
      out.push({
        a: a, b: b, bEff: b, cin: carry,
        xor1: xor1, sum: sum, and1: and1, and2: and2, cout: cout
      });
      carry = cout;
    }
    return { bits: out, carry: carry, bEff: bEff };
  }

  function resultValue(data) {
    var low = 0;
    for (var i = 0; i < 4; i++) low |= data.bits[i].sum << i;
    var full = (data.carry << 4) | low;
    if (mode === 'sub') {
      var signed = data.carry ? low : low - 16;
      return { low: low, full: full, signed: signed, decimal: signed };
    }
    return { low: low, full: full, signed: full, decimal: full };
  }

  function startSettle(instant) {
    var data = compute();
    settle = {
      data: data,
      start: performance.now(),
      per: CM.reduced ? 1 : 250,
      done: !!instant,
      lastActive: -1
    };
    if (instant) {
      finishSettle();
    } else {
      decEl.textContent = '…';
      binEl.textContent = '…';
      carryEl.textContent = 'The carry is moving.';
      lastActive = -1;
      CMSound.play('relay', { vol: .7, pitch: .9 });
    }
  }

  function finishSettle() {
    if (!settle) return;
    settle.done = true;
    var data = settle.data;
    var res = resultValue(data);
    decEl.textContent = (mode === 'sub' && res.decimal < 0 ? '−' + Math.abs(res.decimal) : String(res.decimal));
    var sumBits = '';
    for (var i = 3; i >= 0; i--) sumBits += data.bits[i].sum;
    /* In subtraction the four sum bits are already the two's-complement
       result; the carry lamp is the borrow flag, not a sign bit. */
    binEl.textContent = mode === 'sub' ? sumBits : (data.carry ? '1' : '0') + ' ' + sumBits;
    if (mode === 'sub') {
      carryEl.textContent = data.carry ? 'No borrow · C/B 1' : 'Borrow · C/B 0';
    } else {
      carryEl.textContent = data.carry ? 'Carry out 1' : 'No carry · C/B 0';
    }
    if (!settle.silentDone) {
      CMSound.play('chime', { vol: .55, notes: [392, 523.25, 659.25] });
      settle.silentDone = true;
    }
  }

  function setMode(next) {
    mode = next;
    modeBtns.forEach(function (btn) {
      var on = btn.getAttribute('data-relay-mode') === next;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    CMSound.play('tick', { vol: .5 });
    startSettle(false);
  }

  function buildBitPads() {
    ['a', 'b'].forEach(function (group) {
      var pad = group === 'a' ? aPad : bPad;
      var val = group === 'a' ? A : B;
      var html = '';
      for (var bit = 3; bit >= 0; bit--) {
        html += '<button class="bit' + ((val >> bit) & 1 ? ' is-on' : '') + '" type="button" data-group="' + group + '" data-bit="' + bit + '" aria-pressed="' + (((val >> bit) & 1) ? 'true' : 'false') + '" aria-label="' + group.toUpperCase() + ' bit ' + bit + '">' +
          '<span>' + ((val >> bit) & 1) + '</span><small>' + group.toUpperCase() + bit + '</small></button>';
      }
      pad.innerHTML = html;
    });
  }

  function syncPads() {
    document.querySelectorAll('.bit').forEach(function (btn) {
      var group = btn.getAttribute('data-group');
      var bit = parseInt(btn.getAttribute('data-bit'), 10);
      var val = group === 'a' ? A : B;
      var on = (val >> bit) & 1;
      btn.classList.toggle('is-on', !!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var s = btn.querySelector('span');
      if (s) s.textContent = String(on);
    });
    aNum.value = A;
    bNum.value = B;
  }

  function setValues(a, b) {
    A = CM.clamp(a | 0, 0, 15);
    B = CM.clamp(b | 0, 0, 15);
    syncPads();
    startSettle(false);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.bit') : null;
    if (!btn) return;
    var group = btn.getAttribute('data-group');
    var bit = parseInt(btn.getAttribute('data-bit'), 10);
    if (group === 'a') A ^= (1 << bit);
    else B ^= (1 << bit);
    syncPads();
    startSettle(false);
  });

  aNum.addEventListener('change', function () { setValues(parseInt(aNum.value, 10) || 0, B); });
  bNum.addEventListener('change', function () { setValues(A, parseInt(bNum.value, 10) || 0); });
  aNum.addEventListener('input', function () {
    var v = parseInt(aNum.value, 10);
    if (isFinite(v) && v >= 0 && v <= 15) { A = v; syncPads(); }
  });
  bNum.addEventListener('input', function () {
    var v = parseInt(bNum.value, 10);
    if (isFinite(v) && v >= 0 && v <= 15) { B = v; syncPads(); }
  });
  randomBtn.addEventListener('click', function () { setValues(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16)); });
  clearBtn.addEventListener('click', function () { setValues(0, 0); });
  modeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.getAttribute('data-relay-mode')); });
  });

  function buildLayout() {
    var w = view.w, h = view.h;
    var margin = Math.max(14, w * 0.028);
    var gap = Math.max(8, w * 0.014);
    var panelW = (w - margin * 2 - gap * 3) / 4;
    var panelY = h * 0.115;
    var panelH = h * 0.585;
    layout = {
      w: w, h: h, margin: margin, gap: gap, panelW: panelW,
      panelY: panelY, panelH: panelH,
      panelX: function (i) { return margin + i * (panelW + gap); },
      channelY: panelY + panelH + h * 0.03,
      lampY: h * 0.845,
      plateY: h * 0.94
    };
  }

  function frame(now, dtMs) {
    if (!layout) buildLayout();
    if (settle && !settle.done) {
      var elapsed = now - settle.start;
      var active = Math.floor(elapsed / settle.per);
      if (active > 3) {
        finishSettle();
        lastActive = -1;
      } else if (active !== lastActive) {
        lastActive = active;
        CMSound.play('relay', { vol: .55, pitch: .85 + active * .12 });
      }
    }
    draw(now);
  }

  function draw(now) {
    var w = view.w, h = view.h, L = layout;
    ctx.clearRect(0, 0, w, h);
    var bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * .72);
    bg.addColorStop(0, '#16110b');
    bg.addColorStop(0.55, '#0b0907');
    bg.addColorStop(1, '#070604');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    var active = settle && !settle.done ? Math.min(3, Math.floor((now - settle.start) / settle.per)) : 4;
    var tInBit = settle && !settle.done ? CM.clamp(((now - settle.start) - active * settle.per) / settle.per, 0, 1) : 1;
    var data = settle ? settle.data : compute();

    /* header */
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(7, w * 0.0095) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(240,215,154,.5)';
    ctx.fillText('RELAY LOGIC · FOUR FULL ADDERS', L.margin, h * 0.040);
    ctx.textAlign = 'right';
    ctx.font = '400 ' + Math.max(5, w * 0.0065) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(139,127,108,.7)';
    ctx.fillText(mode === 'add' ? 'A + B · RIPPLE CARRY' : 'A − B · TWO’S COMPLEMENT', w - L.margin, h * 0.040);
    ctx.restore();

    /* power rail */
    drawRail(L.margin, h * 0.092, w - L.margin * 2, '+5 V', 'GND');

    /* panels */
    for (var p = 0; p < 4; p++) drawPanel(p, data, active, tInBit, now);

    /* carry channel */
    drawCarryChannel(data, active, tInBit);

    /* sum lamps */
    drawOutputLamps(data, active, now);

    /* result plate */
    drawResultPlate(data, active);

  }

  function drawRail(x, y, w, labelL, labelR) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.strokeStyle = 'rgba(201,163,90,.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(240,215,154,.4)';
    ctx.beginPath();
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x + w, y - 2);
    ctx.stroke();
    for (var i = 0; i < 8; i++) {
      var ix = x + (i + .5) * w / 8;
      ctx.beginPath();
      ctx.arc(ix, y, 2, 0, CM.TAU);
      ctx.fillStyle = 'rgba(201,163,90,.25)';
      ctx.fill();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '400 5px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(201,163,90,.55)';
    ctx.fillText(labelL, x, y - 6);
    ctx.textAlign = 'right';
    ctx.fillText(labelR, x + w, y - 6);
    ctx.restore();
  }

  function drawPanel(p, data, active, tInBit, now) {
    var L = layout;
    var bit = 3 - p;
    var bd = data.bits[bit];
    var x = L.panelX(p);
    var y = L.panelY;
    var w = L.panelW;
    var h = L.panelH;
    var settled = bit <= active;
    var curr = bit === active;
    var lit = settled;

    /* panel body */
    ctx.save();
    CM.roundRect(ctx, x, y, w, h, 5);
    var pg = ctx.createLinearGradient(0, y, 0, y + h);
    pg.addColorStop(0, 'rgba(38,31,20,.85)');
    pg.addColorStop(0.5, 'rgba(18,14,9,.9)');
    pg.addColorStop(1, 'rgba(28,22,14,.85)');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = curr ? 'rgba(240,215,154,.5)' : 'rgba(201,163,90,.18)';
    ctx.lineWidth = curr ? 1.5 : 0.8;
    ctx.stroke();

    /* label plate */
    var plateW = w * 0.56, plateH = 16;
    var px = x + (w - plateW) / 2, py = y + 10;
    var pl = ctx.createLinearGradient(0, py, 0, py + plateH);
    pl.addColorStop(0, '#c9a55e');
    pl.addColorStop(0.5, '#8b652c');
    pl.addColorStop(1, '#4a3213');
    CM.roundRect(ctx, px, py, plateW, plateH, 2);
    ctx.fillStyle = pl;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,18,6,.6)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(5.5, w * 0.026) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#241708';
    ctx.fillText('BIT ' + bit, x + w / 2, py + plateH / 2 + 0.5);

    /* input lamps */
    var inputs = [
      { label: 'A', val: bd.a },
      { label: mode === 'sub' ? '~B' : 'B', val: bd.bEff },
      { label: 'CIN', val: bd.cin }
    ];
    inputs.forEach(function (inp, i) {
      var ix = x + w * (0.18 + i * 0.32);
      var iy = y + 40;
      drawSmallLamp(ix, iy, inp.label, inp.val, settled || curr);
    });

    /* relays */
    var labels = ['XOR A^B', 'AND A·B', 'XOR ^CIN', 'AND CIN·X', 'OR CARRY'];
    var states = [bd.xor1, bd.and1, bd.sum, bd.and2, bd.cout];
    var relayTop = y + 62;
    var rowH = (h - 74) / 5;
    for (var r = 0; r < 5; r++) {
      drawRelay(x + 8, relayTop + r * rowH + rowH * 0.12, w - 16, rowH * 0.76, labels[r], states[r], lit, curr && tInBit > 0.35);
    }

    /* output taps */
    var sumX = x + w * 0.50;
    var carryX = x + w * 0.68;
    ctx.beginPath();
    ctx.moveTo(sumX, y + h - 6);
    ctx.lineTo(sumX, y + h + 14);
    ctx.strokeStyle = lit ? 'rgba(240,215,154,.8)' : 'rgba(201,163,90,.2)';
    ctx.lineWidth = lit ? 1.6 : 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(carryX, y + h - 6);
    ctx.lineTo(carryX, y + h + 14);
    ctx.strokeStyle = lit ? 'rgba(240,215,154,.8)' : 'rgba(201,163,90,.2)';
    ctx.stroke();

    /* small sum/carry labels */
    ctx.font = '400 5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(139,127,108,.6)';
    ctx.fillText('Σ ' + bd.sum, x + sumX - x, y + h + 16);
    ctx.fillText('C ' + bd.cout, x + carryX - x, y + h + 16);
    ctx.restore();
  }

  function drawSmallLamp(x, y, label, val, on) {
    var r = 5;
    ctx.save();
    if (on && val) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      g.addColorStop(0, 'rgba(255,225,150,.55)');
      g.addColorStop(1, 'rgba(255,225,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, CM.TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, CM.TAU);
    var bg = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, r);
    if (on && val) { bg.addColorStop(0, '#fff0bc'); bg.addColorStop(0.5, '#e4ac48'); bg.addColorStop(1, '#8b5b16'); }
    else { bg.addColorStop(0, '#2c2418'); bg.addColorStop(1, '#100c08'); }
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = on && val ? 'rgba(255,240,190,.7)' : 'rgba(201,163,90,.22)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = on && val ? 'rgba(30,18,6,.85)' : 'rgba(139,127,108,.6)';
    ctx.font = '500 5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(val), x, y + 0.5);
    ctx.fillStyle = 'rgba(139,127,108,.6)';
    ctx.font = '400 4.5px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x, y - 7);
    ctx.restore();
  }

  function drawRelay(x, y, w, h, label, on, panelOn, energize) {
    var active = panelOn && on;
    ctx.save();
    CM.roundRect(ctx, x, y, w, h, 3);
    var bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, active ? 'rgba(46,34,18,.95)' : 'rgba(21,17,11,.85)');
    bg.addColorStop(1, active ? 'rgba(27,20,11,.95)' : 'rgba(12,10,7,.85)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(240,215,154,.4)' : 'rgba(201,163,90,.12)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    /* label */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(4.5, h * 0.23) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = active ? 'rgba(240,215,154,.85)' : 'rgba(139,127,108,.55)';
    ctx.fillText(label, x + 5, y + h * 0.5);

    /* coil */
    var cx = x + w * 0.47;
    var cy = y + h * 0.5;
    var coilW = w * 0.20;
    var coilH = h * 0.5;
    ctx.save();
    ctx.strokeStyle = active ? 'rgba(255,218,130,.9)' : 'rgba(163,120,55,.45)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(cx - coilW / 2 + (i / 4) * coilW, cy, coilH * 0.42, Math.PI * 0.6, Math.PI * 1.4);
      ctx.stroke();
    }
    if (active) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, coilW * 0.65, coilH * 0.7, 0, 0, CM.TAU);
      ctx.fillStyle = 'rgba(255,200,100,.08)';
      ctx.fill();
    }
    ctx.restore();

    /* armature and contacts */
    var px = x + w * 0.70;
    var py = y + h * 0.68;
    var armLen = w * 0.20;
    var pull = active ? 1 : 0;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + armLen, py - (pull ? -h * 0.16 : h * 0.16));
    ctx.strokeStyle = active ? 'rgba(255,235,175,.9)' : 'rgba(201,163,90,.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    /* contacts */
    ctx.beginPath();
    ctx.moveTo(px + armLen, py - h * 0.18);
    ctx.lineTo(px + armLen + w * 0.05, py - h * 0.18);
    ctx.moveTo(px + armLen, py + h * 0.18);
    ctx.lineTo(px + armLen + w * 0.05, py + h * 0.18);
    ctx.strokeStyle = 'rgba(201,163,90,.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.2, h * 0.06), 0, CM.TAU);
    ctx.fillStyle = 'rgba(201,163,90,.7)';
    ctx.fill();

    /* LED */
    var lx = x + w - 8;
    ctx.beginPath();
    ctx.arc(lx, y + h * 0.5, Math.max(1.6, h * 0.07), 0, CM.TAU);
    ctx.fillStyle = active ? '#f0d79a' : 'rgba(60,43,22,.8)';
    if (active) { ctx.shadowColor = '#ffdd88'; ctx.shadowBlur = 6; }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.restore();
  }

  function drawCarryChannel(data, active, t) {
    var L = layout;
    var y = L.channelY;
    var x0 = L.panelX(3) + L.panelW * 0.68;
    var x1 = L.panelX(0) + L.panelW * 0.68;
    var leftEnd = L.margin + 38;

    ctx.save();
    /* channel bus */
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(leftEnd, y);
    ctx.strokeStyle = 'rgba(201,163,90,.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(201,163,90,.15)';
    ctx.beginPath();
    ctx.moveTo(x0, y - 2);
    ctx.lineTo(leftEnd, y - 2);
    ctx.stroke();

    /* taps from each panel */
    for (var p = 0; p < 4; p++) {
      var bit = 3 - p;
      var tapX = L.panelX(p) + L.panelW * 0.68;
      var lit = bit < active || (bit === active && t > 0.7);
      ctx.beginPath();
      ctx.moveTo(tapX, L.panelY + L.panelH + 14);
      ctx.lineTo(tapX, y);
      ctx.strokeStyle = lit ? 'rgba(240,215,154,.9)' : 'rgba(201,163,90,.18)';
      ctx.lineWidth = lit ? 1.8 : 0.8;
      ctx.stroke();
    }

    /* initial carry source at the right */
    var srcX = L.panelX(3) + L.panelW * 0.86;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(srcX, y);
    ctx.strokeStyle = 'rgba(201,163,90,.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    var cin = mode === 'sub' ? 1 : 0;
    ctx.beginPath();
    ctx.arc(srcX + 8, y, 7, 0, CM.TAU);
    ctx.fillStyle = cin ? 'rgba(240,215,154,.18)' : 'rgba(10,9,7,.9)';
    ctx.fill();
    ctx.strokeStyle = cin ? 'rgba(240,215,154,.6)' : 'rgba(201,163,90,.25)';
    ctx.stroke();
    ctx.fillStyle = cin ? 'rgba(240,215,154,.9)' : 'rgba(139,127,108,.6)';
    ctx.font = '500 6px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(cin), srcX + 8, y + .5);
    ctx.fillStyle = 'rgba(139,127,108,.55)';
    ctx.font = '400 4.5px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'bottom';
    ctx.fillText('CIN', srcX + 8, y - 10);

    /* lit segments + pulse */
    for (var b = 0; b < 4; b++) {
      if (b >= active) break;
      var pa = L.panelX(3 - b) + L.panelW * 0.68;
      var pb = b === 3 ? leftEnd : L.panelX(3 - b - 1) + L.panelW * 0.68;
      ctx.beginPath();
      ctx.moveTo(pa, y);
      ctx.lineTo(pb, y);
      ctx.strokeStyle = b < active - 1 ? 'rgba(240,215,154,.55)' : 'rgba(240,215,154,.9)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    if (active < 4) {
      var curBit = active;
      var ax = L.panelX(3 - curBit) + L.panelW * 0.68;
      var bx = curBit === 3 ? leftEnd : L.panelX(3 - curBit - 1) + L.panelW * 0.68;
      var pulseX = CM.lerp(ax, bx, t);
      ctx.beginPath();
      ctx.arc(pulseX, y, 3.4, 0, CM.TAU);
      ctx.fillStyle = '#fff2c9';
      ctx.shadowColor = '#ffdf8a';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }

    /* final carry lamp */
    var fx = leftEnd - 4;
    var done = active >= 4;
    ctx.beginPath();
    ctx.arc(fx, y, 8, 0, CM.TAU);
    ctx.fillStyle = done && data.carry ? 'rgba(240,215,154,.24)' : 'rgba(9,8,6,.9)';
    ctx.fill();
    ctx.strokeStyle = done && data.carry ? 'rgba(255,238,180,.8)' : 'rgba(201,163,90,.3)';
    ctx.lineWidth = done && data.carry ? 1.4 : 0.8;
    ctx.stroke();
    if (done && data.carry) {
      ctx.beginPath();
      ctx.arc(fx, y, 15, 0, CM.TAU);
      var gl = ctx.createRadialGradient(fx, y, 0, fx, y, 15);
      gl.addColorStop(0, 'rgba(255,225,150,.4)');
      gl.addColorStop(1, 'rgba(255,225,150,0)');
      ctx.fillStyle = gl;
      ctx.fill();
    }
    ctx.fillStyle = done && data.carry ? 'rgba(30,18,6,.9)' : 'rgba(139,127,108,.6)';
    ctx.font = '500 6px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(done && data.carry ? '1' : '0', fx, y + .5);
    ctx.fillStyle = 'rgba(139,127,108,.55)';
    ctx.font = '400 4.5px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'bottom';
    ctx.fillText(mode === 'sub' ? 'BORROW' : 'CARRY', fx, y - 12);
    ctx.restore();
  }

  function drawOutputLamps(data, active, now) {
    var L = layout;
    var y = L.lampY;
    var labels = ['S3', 'S2', 'S1', 'S0'];
    for (var p = 0; p < 4; p++) {
      var bit = 3 - p;
      var x = L.panelX(p) + L.panelW * 0.5;
      var lit = bit <= active;
      /* wire from the bit's sum tap down to the lamp */
      ctx.beginPath();
      ctx.moveTo(x, L.panelY + L.panelH + 14);
      ctx.lineTo(x, y - 34);
      ctx.strokeStyle = lit ? 'rgba(240,215,154,.5)' : 'rgba(201,163,90,.14)';
      ctx.lineWidth = lit ? 1.3 : 0.7;
      ctx.stroke();
      drawBigLamp(x, y, data.bits[bit].sum, lit && data.bits[bit].sum, labels[p]);
    }
  }

  function drawBigLamp(x, y, val, lit, label) {
    var r = 12;
    ctx.save();
    if (lit) {
      var glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      glow.addColorStop(0, 'rgba(255,228,155,.55)');
      glow.addColorStop(1, 'rgba(255,228,155,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, CM.TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45, 0, CM.TAU);
    var bez = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, r * 1.45);
    bez.addColorStop(0, '#d8bb7d');
    bez.addColorStop(0.7, '#6b4c21');
    bez.addColorStop(1, '#2b1c0a');
    ctx.fillStyle = bez;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,18,6,.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, CM.TAU);
    var bulb = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, r);
    if (lit) { bulb.addColorStop(0, '#fff6d4'); bulb.addColorStop(0.45, '#f0c05f'); bulb.addColorStop(1, '#a56a1d'); }
    else { bulb.addColorStop(0, '#3a3022'); bulb.addColorStop(0.6, '#211b12'); bulb.addColorStop(1, '#0b0907'); }
    ctx.fillStyle = bulb;
    ctx.fill();
    ctx.fillStyle = lit ? '#2a1a06' : 'rgba(139,127,108,.6)';
    ctx.font = '500 9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(val), x, y + .5);
    ctx.fillStyle = lit ? 'rgba(240,215,154,.8)' : 'rgba(139,127,108,.55)';
    ctx.font = '400 5px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x, y + r * 1.7);
    ctx.restore();
  }

  function drawResultPlate(data, active) {
    var L = layout;
    var w = Math.min(L.w * 0.46, 360);
    var h = Math.max(28, L.h * 0.060);
    var x = (L.w - w) / 2;
    var y = L.plateY - h / 2;
    var res = resultValue(data);
    var done = active >= 4;
    ctx.save();
    CM.roundRect(ctx, x, y, w, h, 3);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#c9a55e');
    g.addColorStop(0.45, '#8a632a');
    g.addColorStop(1, '#3e2a10');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(25,15,5,.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(8, h * 0.32) + 'px "Cinzel", serif';
    ctx.fillStyle = '#241708';
    var label;
    if (!done) label = 'SETTLING…';
    else if (mode === 'sub') label = 'A − B = ' + (res.decimal < 0 ? '−' + Math.abs(res.decimal) : res.decimal);
    else label = 'A + B = ' + res.decimal;
    ctx.fillText(label, L.w / 2, y + h / 2 + 0.5);
    ctx.restore();
  }

  window.addEventListener('resize', function () { buildLayout(); });
  CM.onVisible(section, function () { animator.start(); }, function () { animator.stop(); }, '250px');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) animator.stop();
    else if (section.getBoundingClientRect().bottom > 0) animator.start();
  });

  buildLayout();
  buildBitPads();
  startSettle(true);
  if (settle) settle.silentDone = true;
})();
