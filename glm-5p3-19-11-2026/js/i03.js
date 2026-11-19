/* HILBERT'S GARDEN — INSTRUMENT III · THE MARRIAGE */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i3-stage');
var controls = document.getElementById('i3-controls');
var readEl = document.getElementById('i3-readout');
if (!stage) return;
K.tag(stage, 'SINGLET SOURCE · TWO STATIONS · COMPARED NOTEBOOKS', 'NO-SIGNALING ENFORCED');

var entry = K.makeCanvas(stage, 430, 'Two measurement dials, a live correlation curve, and Bob histogram; drag the dials');
var ctx = entry.ctx;

var thA = 0, thB = Math.PI / 3;
var pairs = 0, agree = 0, bobOnes = 0;
var bins = [];   /* 36 bins of 10 degrees: {n, e} */
for (var b = 0; b < 36; b++) bins.push({ n: 0, e: 0 });
var rng = Math.random;
var sweeping = null;
var loopHandle = null;

var ro = K.readout(readEl);
ro.head('MARRIAGE LEDGER');
var roA = ro.line('a', 'ALICE ANGLE');
var roB = ro.line('b', 'BOB ANGLE');
var roE = ro.line('e', 'E(Δ) OBSERVED');
var roT = ro.line('t', 'E(Δ) THEORY');
var roPairs = ro.line('pairs', 'PAIRS MEASURED');
var roBob = ro.line('bob', "BOB-ALONE P(|1⟩)");
ro.note('E = P(same) − P(different). The singlet promises E(Δ) = −cos Δθ — watch the points obey. Bob\'s own coin stays exactly fair no matter what Alice does with her dial: the correlation rides on the comparison, never on the wire.');

function binIdx(delta) {
  var d = (delta * 180 / Math.PI) % 360;
  if (d < 0) d += 360;
  if (d > 180) d = 360 - d;
  var idx = Math.round(d / 10) % 36;
  return idx;
}
function syncReadout() {
  roA.set((thA * 180 / Math.PI).toFixed(0) + '°', 'am');
  roB.set((thB * 180 / Math.PI).toFixed(0) + '°', 'cy');
  var idx = binIdx(thB - thA);
  var bn = bins[idx];
  roE.set(bn.n ? (bn.e / bn.n).toFixed(3) + '  (' + bn.n + ' pairs)' : '—', 'am');
  roT.set((-Math.cos(thB - thA)).toFixed(3), 'cy');
  roPairs.set(String(pairs));
  roBob.set(pairs ? (bobOnes / pairs).toFixed(4) : '—', pairs && Math.abs(bobOnes / pairs - 0.5) < 0.02 ? 'cy' : 'am');
}

function singlet() {
  var q = new HG.QReg(2);
  q.apply1(0, HG.G.X);
  q.apply1(1, HG.G.X);
  q.apply1(0, HG.G.H);
  q.cnot(0, 1);
  return q;
}
function firePair() {
  var q = singlet();
  var ra = q.measurePlane(0, thA, rng);
  var rb = q.measurePlane(1, thB, rng);
  var same = ra === rb ? 1 : -1;
  var idx = binIdx(thB - thA);
  bins[idx].n++;
  bins[idx].e += same;
  pairs++;
  if (same === 1) agree++;
  bobOnes += rb;
}
function fireBurst(n) {
  for (var i = 0; i < n; i++) firePair();
  syncReadout();
}

function dialGeo(w) {
  return [
    { x: w * 0.26, y: 66, r: 40 },
    { x: w * 0.74, y: 66, r: 40 }
  ];
}
function drawDial(d, angle, color, label) {
  ctx.strokeStyle = K.faint(0.4);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.2832); ctx.stroke();
  ctx.strokeStyle = K.faint(0.18);
  ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 0.62, 0, 6.2832); ctx.stroke();
  var rad = -angle;
  var nx = d.x + Math.sin(rad) * d.r, ny = d.y - Math.cos(rad) * d.r;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(nx, ny); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(nx, ny, 3.4, 0, 6.2832); ctx.fill();
  ctx.fillStyle = K.faint(1);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label + ' ' + (angle * 180 / Math.PI).toFixed(0) + '°', d.x, d.y + d.r + 16);
}

function plotGeo(w, h) {
  return { x0: 56, x1: w - 56, y0: 148, y1: h - 118 };
}
function drawPlot(w, h) {
  var g = plotGeo(w, h);
  ctx.strokeStyle = K.faint(0.35);
  ctx.strokeRect(g.x0 + 0.5, g.y0 + 0.5, g.x1 - g.x0, g.y1 - g.y0);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.fillStyle = K.faint(0.8);
  ctx.textAlign = 'left';
  ['+1', '0', '−1'].forEach(function (lab, i) {
    var y = g.y0 + (g.y1 - g.y0) * i / 2;
    ctx.fillText(lab, g.x0 - 22, y + 3);
    ctx.strokeStyle = K.faint(0.12);
    ctx.beginPath(); ctx.moveTo(g.x0, y); ctx.lineTo(g.x1, y); ctx.stroke();
  });
  ['−180°', '0°', '+180°'].forEach(function (lab, i) {
    var x = g.x0 + (g.x1 - g.x0) * i / 2;
    ctx.fillStyle = K.faint(0.8);
    ctx.textAlign = 'center';
    ctx.fillText(lab, x, g.y1 + 12);
  });
  ctx.fillStyle = K.faint(0.9);
  ctx.textAlign = 'center';
  ctx.fillText('CORRELATION E vs Δθ (LIVE POINTS vs THEORY)', (g.x0 + g.x1) / 2, g.y0 - 8);

  /* theory curve */
  ctx.strokeStyle = K.cyan(0.30);
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (var px = 0; px <= 120; px++) {
    var d = -Math.PI + 2 * Math.PI * px / 120;
    var E = -Math.cos(d);
    var x = g.x0 + (g.x1 - g.x0) * px / 120;
    var y = g.y0 + (g.y1 - g.y0) * (1 - E) / 2;
    if (px === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  /* live points */
  for (var i = 0; i < 36; i++) {
    var bn = bins[i];
    if (!bn.n) continue;
    var dd = i * 10 * Math.PI / 180;
    var Eobs = bn.e / bn.n;
    var x = g.x0 + (g.x1 - g.x0) * (dd / Math.PI / 2);
    var y = g.y0 + (g.y1 - g.y0) * (1 - Eobs) / 2;
    var rad = 3 + Math.min(4, Math.log10(bn.n + 1));
    ctx.fillStyle = K.amber(0.9);
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = K.amber(0.35);
    ctx.beginPath();
    var halfw = 1.96 / Math.sqrt(bn.n);
    ctx.moveTo(x, y - (g.y1 - g.y0) / 2 * halfw);
    ctx.lineTo(x, y + (g.y1 - g.y0) / 2 * halfw);
    ctx.stroke();
  }

  /* current setting hairline */
  var dcur = thB - thA;
  while (dcur > Math.PI) dcur -= 2 * Math.PI;
  while (dcur < -Math.PI) dcur += 2 * Math.PI;
  var xc = g.x0 + (g.x1 - g.x0) * (dcur / Math.PI / 2 + 0.5);
  ctx.strokeStyle = K.amber(0.4);
  ctx.beginPath(); ctx.moveTo(xc, g.y0); ctx.lineTo(xc, g.y1); ctx.stroke();
}

function drawBob(w, h) {
  var y0 = h - 96, x0 = 60, x1 = w * 0.55;
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('BOB-ALONE COIN · ALL SETTINGS COMBINED', x0, y0 - 8);
  var p1 = pairs ? bobOnes / pairs : 0.5;
  [['|0⟩', 1 - p1], ['|1⟩', p1]].forEach(function (bar, i) {
    var x = x0 + i * ((x1 - x0) / 2);
    var bw = (x1 - x0) / 2 - 12;
    ctx.fillStyle = K.faint(0.3);
    ctx.fillRect(x, y0, bw, 26);
    ctx.fillStyle = i === 0 ? K.amber(0.7) : K.cyan(0.7);
    ctx.fillRect(x, y0, bw * bar[1], 26);
    ctx.fillStyle = K.txt(0.75);
    ctx.textAlign = 'left';
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.fillText(bar[0] + ' ' + (bar[1] * 100).toFixed(1) + '%', x, y0 + 40);
  });
  ctx.fillStyle = K.faint(0.75);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  var ax = w * 0.6;
  ctx.fillText('ALICE MAY TURN HER DIAL ALL SHE LIKES.', ax, y0 + 4);
  ctx.fillText('THIS BAR DOES NOT CARE.', ax, y0 + 18);
}

function draw() {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);
  var dg = dialGeo(w);
  drawDial(dg[0], thA, K.amber(0.95), 'ALICE');
  drawDial(dg[1], thB, K.cyan(0.95), 'BOB');
  ctx.fillStyle = K.faint(0.7);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('DRAG THE DIALS', w / 2, 66);
  drawPlot(w, h);
  drawBob(w, h);
}

function ensureLoop() {
  if (loopHandle) return;
  loopHandle = K.loop(function (t) {
    if (sweeping) {
      if (t - sweeping.last > 55) {
        sweeping.last = t;
        thB = sweeping.from + (sweeping.to - sweeping.from) * (sweeping.done / sweeping.steps);
        fireBurst(sweeping.burst);
        sweeping.done++;
        if (sweeping.done >= sweeping.steps) sweeping = null;
      }
      draw();
      return true;
    }
    draw();
    loopHandle = null;
    return false;
  });
}

/* dial dragging */
var dragging = 0;
K.drag(entry.canvas, {
  onMove: function (dx, dy, e) {
    var rect = entry.canvas.getBoundingClientRect();
    var mx = (e.clientX - rect.left), my = (e.clientY - rect.top);
    var dg = dialGeo(entry.w);
    if (dragging) {
      var d = dg[dragging - 1];
      var ang = Math.atan2(mx - d.x, -(my - d.y));
      if (ang < 0) ang += 2 * Math.PI;
      if (dragging === 1) { thA = ang; slA.set(ang * 180 / Math.PI); }
      else { thB = ang; slB.set(ang * 180 / Math.PI); }
      syncReadout();
      draw();
    }
  }
});
entry.canvas.addEventListener('pointerdown', function (e) {
  var rect = entry.canvas.getBoundingClientRect();
  var mx = e.clientX - rect.left, my = e.clientY - rect.top;
  var dg = dialGeo(entry.w);
  dragging = 0;
  if (Math.hypot(mx - dg[0].x, my - dg[0].y) < dg[0].r + 12) dragging = 1;
  else if (Math.hypot(mx - dg[1].x, my - dg[1].y) < dg[1].r + 12) dragging = 2;
});

var row = K.buttons(controls);
row.add('FIRE ONE PAIR', function () { fireBurst(1); draw(); });
row.add('STREAM 200 PAIRS', function () { fireBurst(200); draw(); });
row.add('SWEEP THE FULL CURVE', function () {
  sweeping = { from: -Math.PI, to: Math.PI, steps: 72, burst: 100, done: 0, last: 0 };
  slB.set(-180);
  ensureLoop();
});
row.add('RESET ALL DATA', function () {
  pairs = 0; agree = 0; bobOnes = 0;
  for (var i = 0; i < 36; i++) bins[i] = { n: 0, e: 0 };
  sweeping = null;
  syncReadout();
  draw();
}, { cls: 'danger' });

K.el('div', 'ctl-label', controls).textContent = 'MEASUREMENT ANGLES';
var slA = K.slider(controls, {
  label: 'ALICE θA',
  min: 0, max: 360, step: 1, value: 0,
  fmt: function (v) { return v.toFixed(0) + '°'; },
  onInput: function (v) { thA = v * Math.PI / 180; syncReadout(); draw(); }
});
var slB = K.slider(controls, {
  label: 'BOB θB',
  min: 0, max: 360, step: 1, value: 60,
  fmt: function (v) { return v.toFixed(0) + '°'; },
  onInput: function (v) { thB = v * Math.PI / 180; syncReadout(); draw(); }
});

fireBurst(60);
draw();
})();
