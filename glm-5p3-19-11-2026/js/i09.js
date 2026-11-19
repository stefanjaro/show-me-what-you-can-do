/* HILBERT'S GARDEN — INSTRUMENT IX · THE FOURIER HARP */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i9-stage');
var controls = document.getElementById('i9-controls');
var readEl = document.getElementById('i9-readout');
if (!stage) return;
K.tag(stage, 'QUANTUM FOURIER TRANSFORM · SHOR ON N = 15', 'FACTORS OR YOUR MONEY BACK');

var entry = K.makeCanvas(stage, 430, 'Sixteen harp strings as amplitudes; the Fourier transform turns periodic patterns into single peaks');
var ctx = entry.ctx;

var mode = 'pluck';            /* 'pluck' (pure 4q) or 'shor' (8q marginal) */
var reg = new HG.QReg(4);
var transformed = false;
var fTable = null;
var aBase = 2;
var measures = [];
var lastM = null;
var pluckVib = 0;
var anim = null;

var ro = K.readout(readEl);
ro.head('FACTORING LEDGER');
var roMode = ro.line('mode', 'REGISTER LOADED');
var roPeaks = ro.line('peaks', 'PEAKS (MAGNITUDES > 1%)');
var roM = ro.line('m', 'LAST MEASUREMENT m');
var roR = ro.line('r', 'PERIOD r (CONT. FRACTION)');
var roFac = ro.line('fac', 'VERDICT');
var roCount = ro.line('cnt', 'MEASUREMENTS TAKEN');
ro.note('The counting register stays entangled with the work register, so the harp shows the honest marginal — magnitudes only. After the transform, the pitch always lands on a multiple of 16 ∕ r. Continue fractions on m ∕ 16, then gcd(aʳᐟ² ± 1, 15) does the rest. This exact pipeline, at 2048 bits, is why RSA is retiring.');

function gcd(x, y) { while (y) { var t = x % y; x = y; y = t; } return x; }
function fSeq(a) {
  var out = [], v = 1;
  for (var i = 0; i < 16; i++) { out.push(v); v = (v * a) % 15; }
  return out;
}
function marginal() {
  var qs = [0, 1, 2, 3];
  if (mode === 'pluck') return { probs: reg.probs(), phases: phasesOf(reg), pure: true };
  var p = reg.probs();
  var marg = new Array(16).fill(0);
  for (var i = 0; i < 256; i++) marg[i & 15] += p[i];
  return { probs: marg, phases: null, pure: false };
}
function phasesOf(q) {
  var out = [];
  for (var i = 0; i < q.d; i++) out.push([q.re[i], q.im[i]]);
  return out;
}
function peaksList() {
  var m = marginal();
  var out = [];
  for (var i = 0; i < 16; i++) if (m.probs[i] > 0.01) out.push(i + ':' + (m.probs[i] * 100).toFixed(0) + '%');
  return out.join('  ') || '—';
}
function syncReadout() {
  roMode.set(mode === 'pluck' ?
    (transformed ? 'PURE 4-QUBIT · FOURIER-TRANSFORMED' : 'PURE 4-QUBIT · TIME DOMAIN') :
    (transformed ? 'SHOR STATE · AFTER QFT ON COUNTING REGISTER' : 'SHOR STATE · f(x) = ' + aBase + 'ˣ mod 15 · TIME DOMAIN'), 'am');
  roPeaks.set(peaksList(), 'cy');
  roM.set(lastM === null ? '—' : 'm = ' + lastM, 'am');
  if (lastM === null) roR.set('—');
  else if (lastM === 0) roR.set('m = 0 IS AMBIGUOUS — MEASURE AGAIN', 'rd');
  else {
    var r = 16 / gcd(16, lastM);
    roR.set('m ∕ 16 → ' + (lastM / gcd(16, lastM)) + ' ∕ ' + r + '  →  r = ' + r, 'cy');
    if (r % 2 === 0) {
      var h = Math.pow(aBase, r / 2) % 15;
      var f1 = gcd((h - 1) % 15 || 15, 15), f2 = gcd(h + 1, 15);
      roFac.set('gcd(' + aBase + '^' + (r / 2) + ' ± 1, 15) = ' + f1 + ' × ' + f2 + '  →  15 = ' + f1 + ' × ' + f2 + (f1 * f2 === 15 ? ' ✓' : ' ✗'), f1 * f2 === 15 ? 'am' : 'rd');
    } else {
      roFac.set('r IS ODD — THIS BASE CANNOT FACTOR 15, TRY ANOTHER', 'rd');
    }
  }
  roCount.set(String(measures.length));
}

function loadPluck(x) {
  mode = 'pluck';
  reg = new HG.QReg(4);
  reg.setBasis(x);
  transformed = false;
  pluckVib = 1;
  lastM = null;
  syncReadout();
  ensureVib();
  draw();
}
function loadShor() {
  mode = 'shor';
  reg = new HG.QReg(8);
  reg.prepareModExp(aBase, [0, 1, 2, 3], [4, 5, 6, 7]);
  fTable = fSeq(aBase);
  transformed = false;
  lastM = null;
  syncReadout();
  draw();
}
function playQFT() {
  if (mode === 'pluck') reg.qft([0, 1, 2, 3]);
  else reg.qft([0, 1, 2, 3]);
  transformed = true;
  syncReadout();
  draw();
}
function measureOnce() {
  var idx = reg.sampleIndex();
  lastM = idx & 15;
  measures.push(lastM);
  syncReadout();
  draw();
}
function runPipeline() {
  loadShor();
  var chain = [
    [400, function () { playQFT(); }],
    [1100, function () { measureOnce(); }],
    [1600, function () { }]
  ];
  if (K.REDUCED) {
    playQFT(); measureOnce(); return;
  }
  chain.forEach(function (c) { setTimeout(c[1], c[0]); });
}

/* ---------- drawing ---------- */
function draw() {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);
  var m = marginal();
  var harpH = h * 0.54;
  var x0 = 24, x1 = w - 24;
  var cw = (x1 - x0) / 16;
  var base = harpH + 20;
  var maxP = Math.max.apply(null, m.probs);
  for (var i = 0; i < 16; i++) {
    var x = x0 + i * cw + cw / 2;
    var p = m.probs[i];
    var frac = p / (maxP || 1);
    /* string */
    ctx.strokeStyle = K.faint(0.35);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x, base); ctx.stroke();
    /* amplitude bar */
    var bh = frac * (base - 30);
    var col;
    if (m.pure && m.phases) col = K.hueCss(m.phases[i][0], m.phases[i][1], 0.85);
    else col = transformed ? K.amber(0.8) : K.cyan(0.65);
    ctx.fillStyle = col;
    ctx.fillRect(x - cw * 0.28, base - bh, cw * 0.56, bh);
    if (p > 0.01) {
      ctx.fillStyle = K.txt(0.85);
      ctx.font = '8px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText((p * 100).toFixed(0) + '%', x, base - bh - 4);
    }
    /* pluck vibration */
    if (pluckVib > 0.02 && p > 0.001) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = pluckVib * 0.8;
      ctx.beginPath();
      for (var s = 0; s <= 12; s++) {
        var yy = 24 + (base - 24) * s / 12;
        var wig = Math.sin(s * 2.4 + performance.now() / 60) * frac * 5 * pluckVib;
        if (s === 0) ctx.moveTo(x + wig, yy); else ctx.lineTo(x + wig, yy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = m.probs[i] > 0.01 ? K.amber(0.95) : K.faint(0.8);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(i), x, base + 12);
  }
  /* measurement dots */
  if (measures.length) {
    measures.slice(-14).forEach(function (mm, idx) {
      var x = x0 + mm * cw + cw / 2;
      ctx.fillStyle = K.amber(0.5 - idx * 0.02);
      ctx.beginPath();
      ctx.arc(x, base + 24 + (idx % 2) * 5, 2.2, 0, 6.2832);
      ctx.fill();
    });
    ctx.fillStyle = K.faint(0.9);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('MEASUREMENTS →', x0, base + 42);
  }
  /* f table strip in shor mode */
  if (mode === 'shor' && fTable) {
    var fy = h - 34;
    ctx.fillStyle = K.faint(0.9);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('f(x) = ' + aBase + 'ˣ mod 15 :', x0, fy + 3);
    for (var fx = 0; fx < 16; fx++) {
      var xx = x0 + 110 + fx * 20;
      ctx.strokeStyle = K.faint(0.4);
      ctx.strokeRect(xx, fy - 9, 16, 12);
      ctx.fillStyle = K.cyan(0.85);
      ctx.font = '8px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(fTable[fx]), xx + 8, fy);
    }
    ctx.fillStyle = K.faint(0.9);
    ctx.textAlign = 'left';
    ctx.fillText('THE HIDDEN REPETITION', x0, fy + 16);
  } else if (mode === 'pluck') {
    ctx.fillStyle = K.faint(0.85);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText(transformed ? 'FREQUENCY DOMAIN — PEAKS AT MULTIPLES OF 16 ∕ r' : 'TIME DOMAIN — CLICK A PLUCK BUTTON TO SET |x⟩', x0, h - 22);
  }
}
function ensureVib() {
  if (anim) return;
  anim = K.loop(function () {
    pluckVib *= 0.93;
    draw();
    if (pluckVib < 0.02) { pluckVib = 0; anim = null; return false; }
    return true;
  });
}

var row = K.buttons(controls);
row.add('PLUCK |0⟩', function () { loadPluck(0); });
row.add('PLUCK |5⟩', function () { loadPluck(5); });
row.add('LOAD SHOR STATE', function () { loadShor(); });
row.add('PLAY THE QFT', function () { playQFT(); }, { cls: 'big' });
row.add('MEASURE ONCE', function () {
  if (!transformed && mode === 'shor') { playQFT(); }
  measureOnce();
});
row.add('RUN SHOR\'S PIPELINE', function () { runPipeline(); }, { cls: 'big' });
K.selectRow(controls, {
  label: 'BASE a (COPRIME TO 15)',
  options: [
    { v: '2', t: 'a = 2 (period 4)' },
    { v: '4', t: 'a = 4 (period 2)' },
    { v: '7', t: 'a = 7 (period 4)' },
    { v: '8', t: 'a = 8 (period 4)' },
    { v: '11', t: 'a = 11 (period 2)' },
    { v: '13', t: 'a = 13 (period 4)' },
    { v: '14', t: 'a = 14 (period 2)' }
  ],
  value: '2',
  onChange: function (v) {
    aBase = parseInt(v, 10);
    measures = [];
    loadShor();
  }
});
row.add('RESET', function () {
  measures = [];
  lastM = null;
  loadPluck(0);
}, { cls: 'danger' });

loadPluck(0);
})();
