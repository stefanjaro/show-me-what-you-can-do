/* HILBERT'S GARDEN — INSTRUMENT VI · THE NEEDLE ENGINE */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i6-stage');
var controls = document.getElementById('i6-controls');
var readEl = document.getElementById('i6-readout');
if (!stage) return;
K.tag(stage, 'GROVER SEARCH · CLICK ANY BAR TO HIDE THE NEEDLE', 'OPTIMUM ≈ π√N∕4');

var entry = K.makeCanvas(stage, 380, 'Amplitude bars: Grover iterations push probability onto the marked entry');
var ctx = entry.ctx;

var n = 4, needle = 5, k = 0;
var autoHandle = null;
var barRects = [];

var ro = K.readout(readEl);
ro.head('NEEDLE LEDGER');
var roN = ro.line('n', 'HAYSTACK SIZE');
var roNeedle = ro.line('needle', 'NEEDLE INDEX');
var roK = ro.line('k', 'ITERATIONS DONE');
var roP = ro.line('p', 'P(FIND NEEDLE)');
var roOpt = ro.line('opt', 'THEORY OPTIMUM k*');
var roState = ro.line('st', 'STATE');
ro.note('Each iteration: the oracle flips the needle\'s amplitude sign (watch it turn indigo), then the diffuser reflects every amplitude about the mean — and the flipped one rises. Past the optimum the tide recedes: Grover is a resonance, not a ratchet.');

function kOpt(N) { return Math.max(1, Math.round(Math.PI / 4 * Math.sqrt(N))); }

function computeState() {
  var q = new HG.QReg(n);
  for (var i = 0; i < n; i++) q.apply1(i, HG.G.H);
  for (var s = 0; s < k; s++) {
    q.phaseOn([needle], Math.PI);
    q.diffuser();
  }
  return q;
}
function fmtNeedle(i, N) {
  return '|' + K.bits(i, Math.log2(N)) + '⟩ (#' + i + ')';
}
function syncReadout() {
  var N = 1 << n;
  var q = computeState();
  var p = q.probs()[needle];
  roN.set('N = 2^' + n + ' = ' + N, 'am');
  roNeedle.set(fmtNeedle(needle, N), 'am');
  roK.set(String(k), 'cy');
  roP.set(p.toFixed(4), p > 0.85 ? 'am' : 'cy');
  var ko = kOpt(N);
  roOpt.set(ko + '  →  P ≈ ' + (Math.sin((2 * ko + 1) * Math.asin(1 / Math.sqrt(N))) ** 2).toFixed(3), 'cy');
  if (k === 0) roState.set('UNIFORM — NOTHING MARKED YET');
  else if (k < ko) roState.set('RISING · ' + (ko - k) + ' FROM THE OPTIMUM', 'cy');
  else if (k === ko) roState.set('AT THE OPTIMUM — STOP HERE', 'am');
  else roState.set('OVERSHOOTING — THE TIDE RECEDES', 'rd');
}

function draw() {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);
  var q = computeState();
  var N = 1 << n;
  var probs = q.probs();
  var phases = [];
  for (var i = 0; i < N; i++) phases.push([q.re[i], q.im[i]]);
  var plotH = h * 0.66;
  var rects = K.drawBars(ctx, { x: 20, y: 26, w: w - 40, h: plotH }, probs, phases, {
    highlight: needle,
    labels: n <= 4
  });
  barRects = rects;

  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('LIVE STATEVECTOR · HEIGHT = PROBABILITY · COLOR = PHASE (INDIGO = NEGATIVE)', 20, 16);

  /* theory curve subplot */
  var cy0 = h - 58, cx0 = 24, cx1 = w * 0.62, cy1 = cy0 + 38;
  var kmax = Math.max(8, kOpt(N) * 2 + 3);
  ctx.strokeStyle = K.faint(0.3);
  ctx.strokeRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.strokeStyle = K.cyan(0.5);
  ctx.beginPath();
  var th = Math.asin(1 / Math.sqrt(N));
  for (var kk = 0; kk <= kmax; kk++) {
    var pth = Math.sin((2 * kk + 1) * th) ** 2;
    var x = cx0 + (cx1 - cx0) * kk / kmax;
    var y = cy1 - (cy1 - cy0) * pth;
    if (kk === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  var koX = cx0 + (cx1 - cx0) * kOpt(N) / kmax;
  ctx.strokeStyle = K.amber(0.5);
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(koX, cy0); ctx.lineTo(koX, cy1); ctx.stroke();
  ctx.setLineDash([]);
  var px2 = cx0 + (cx1 - cx0) * Math.min(k, kmax) / kmax;
  var pv = Math.sin((2 * Math.min(k, kmax) + 1) * th) ** 2;
  ctx.fillStyle = K.amber(0.95);
  ctx.beginPath(); ctx.arc(px2, cy1 - (cy1 - cy0) * pv, 3.4, 0, 6.2832); ctx.fill();
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('P(k) THEORY · AMBER = YOU · DASHED = k*', cx0 + 4, cy0 - 5);

  /* scaling table */
  var tx = w * 0.66;
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  var rows = [[4, 4], [8, 12], [16, 26]];
  ctx.fillText('N → GROVER STEPS', tx + 12, cy0 - 5);
  ctx.fillStyle = K.amber(0.95);
  ctx.fillText(N + ' → ' + kOpt(N), tx + 12, cy0 + 14);
  ctx.fillStyle = K.faint(0.85);
  ctx.fillText('1,048,576 → 806', tx + 12, cy0 + 30);
  ctx.fillText('4,294,967,296 → 52,130', tx + 12, cy0 + 46);
}

entry.canvas.addEventListener('pointerdown', function (e) {
  var rect = entry.canvas.getBoundingClientRect();
  var mx = e.clientX - rect.left, my = e.clientY - rect.top;
  var N = 1 << n;
  if (my < entry.h * 0.66 + 30 && mx > 16 && mx < entry.w - 20) {
    var idx = Math.floor((mx - 20) / ((entry.w - 40) / N));
    if (idx >= 0 && idx < N) {
      needle = idx;
      k = Math.min(k, 2 * kOpt(N) + 3);
      slK.set(k);
      syncReadout();
      draw();
    }
  }
});

var row = K.buttons(controls);
row.add('ITERATE ONCE', function () {
  k++;
  slK.set(k);
  syncReadout();
  draw();
}, { cls: 'big' });
var autoBtn = row.add('AUTO-SWEEP', function (b) {
  if (autoHandle) {
    autoHandle.stop(); autoHandle = null;
    b.classList.remove('on');
    b.textContent = 'AUTO-SWEEP';
    return;
  }
  b.classList.add('on');
  b.textContent = 'STOP SWEEP';
  autoHandle = K.loop(function () {
    k++;
    var N = 1 << n;
    if (k > 2 * kOpt(N) + 3) {
      if (autoHandle) { autoHandle.stop(); autoHandle = null; }
      b.classList.remove('on');
      b.textContent = 'AUTO-SWEEP';
      k = 2 * kOpt(N) + 3;
    }
    slK.set(k);
    syncReadout();
    draw();
    if (K.REDUCED) {
      if (autoHandle) { autoHandle.stop(); autoHandle = null; }
      b.classList.remove('on');
      return false;
    }
    return true;
  });
});
row.add('RANDOM NEEDLE', function () {
  needle = Math.floor(Math.random() * (1 << n));
  syncReadout();
  draw();
});
row.add('RESET', function () {
  k = 0; slK.set(0);
  syncReadout();
  draw();
}, { cls: 'danger' });

K.selectRow(controls, {
  label: 'HAYSTACK SIZE',
  options: [
    { v: '2', t: 'N = 4 · 2 qubits' },
    { v: '3', t: 'N = 8 · 3 qubits' },
    { v: '4', t: 'N = 16 · 4 qubits' },
    { v: '5', t: 'N = 32 · 5 qubits' },
    { v: '6', t: 'N = 64 · 6 qubits' }
  ],
  value: '4',
  onChange: function (v) {
    n = parseInt(v, 10);
    needle = Math.min(needle, (1 << n) - 1);
    k = 0;
    slK.set(0);
    syncReadout();
    draw();
  }
});

var slK = K.slider(controls, {
  label: 'ITERATIONS k (DRAG OR USE THE BUTTONS)',
  min: 0, max: 16, step: 1, value: 0,
  fmt: function (v) { return v.toFixed(0); },
  onInput: function (v) {
    k = v;
    syncReadout();
    draw();
  }
});

syncReadout();
draw();
})();
