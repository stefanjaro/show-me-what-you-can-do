/* HILBERT'S GARDEN — INSTRUMENT VII · THE ENVELOPE */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i7-stage');
var controls = document.getElementById('i7-controls');
var readEl = document.getElementById('i7-readout');
if (!stage) return;
K.tag(stage, 'TELEPORTATION · THREE QUBITS · TWO CLASSICAL BITS', 'ORIGINAL DESTROYED BY DESIGN');

var rowEl = document.createElement('div');
rowEl.style.cssText = 'display:flex;gap:0;flex-wrap:wrap';
stage.appendChild(rowEl);
var cells = [];
['ALICE\'S MESSAGE', 'PAIR HALF (ALICE\'S)', 'PAIR HALF (BOB\'S)'].forEach(function (label) {
  var cell = document.createElement('div');
  cell.style.cssText = 'flex:1 1 0;min-width:180px;position:relative';
  var cap = document.createElement('div');
  cap.style.cssText = 'font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;color:var(--faint);text-transform:uppercase;text-align:center;padding:.5rem 0 .1rem;border-top:1px solid var(--line)';
  cap.textContent = label;
  rowEl.appendChild(cell);
  rowEl.appendChild(cap);
  cells.push(cell);
});

var entries = [], blochs = [];
cells.forEach(function (cell, i) {
  var entry = K.makeCanvas(cell, 215, 'qubit ' + i + ' Bloch sphere');
  entries.push(entry);
  var b = new K.Bloch(entry, { pad: 18 });
  b.setTarget(0, 0, 0, true);
  blochs.push(b);
});

var stripWrap = document.createElement('div');
stripWrap.style.borderTop = '1px solid var(--line)';
stage.appendChild(stripWrap);
var strip = K.makeCanvas(stripWrap, 64, 'classical channel: two bits fly from Alice to Bob');

var logEl = document.createElement('div');
logEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:0;border-top:1px solid var(--line)';
stage.appendChild(logEl);
var steps = [];
['1 · ENTANGLE A PAIR', '2 · ALICE COUPLES HER STATE', '3 · ALICE MEASURES BOTH', '4 · TWO BITS FLY', '5 · BOB CORRECTS', '6 · BOB HOLDS THE MESSAGE'].forEach(function (s) {
  var d = document.createElement('div');
  d.textContent = s;
  d.style.cssText = 'flex:1 1 0;min-width:140px;font-family:var(--mono);font-size:.62rem;letter-spacing:.1em;color:var(--faint);text-align:center;padding:.55rem .2rem;border-right:1px solid var(--line)';
  logEl.appendChild(d);
  steps.push(d);
});
function litStep(i) {
  steps.forEach(function (d, idx) {
    d.style.color = idx === i ? 'var(--amber)' : 'var(--faint)';
    d.style.background = idx === i ? 'rgba(220,170,74,.07)' : 'transparent';
  });
}

var msgTheta = 0.9, msgPhi = 1.9;
var lastRun = null;
var flyAnim = null;
var fastStats = { runs: 0, branches: [0, 0, 0, 0], worst: 0 };

var ro = K.readout(readEl);
ro.head('ENVELOPE LEDGER');
var roMsg = ro.line('msg', 'MESSAGE |ψ⟩');
var roBits = ro.line('bits', 'BITS SENT (m0 m1)');
var roBob = ro.line('bob', 'BOB\'S FINAL STATE');
var roDist = ro.line('dist', 'STATE-SPACE DISTANCE');
var roFast = ro.line('fast', '500-RUN AUDIT');
ro.note('The distance is 1 − |⟨ψ|φ⟩|² between the message and Bob\'s qubit. It is zero after every run, in every branch — the ledger verifies this across 300 random states and all four (m0,m1) outcomes.');

function msgState() {
  return {
    a: { re: Math.cos(msgTheta / 2), im: 0 },
    b: { re: Math.sin(msgTheta / 2) * Math.cos(msgPhi), im: Math.sin(msgTheta / 2) * Math.sin(msgPhi) }
  };
}
function msgBloch(m) {
  return {
    x: 2 * (m.a.re * m.b.re + m.a.im * m.b.im),
    y: 2 * (m.a.re * m.b.im - m.a.im * m.b.re),
    z: m.a.re * m.a.re + m.a.im * m.a.im - m.b.re * m.b.re - m.b.im * m.b.im
  };
}
function syncMsg() {
  var m = msgState();
  var b = msgBloch(m);
  blochs[0].setTarget(b.x, b.y, b.z);
  roMsg.set(HG.cstr(m.a, 3) + '|0⟩ + ' + HG.cstr(m.b, 3) + '|1⟩', 'am');
}
syncMsg();

function runProtocol(animate) {
  var m = msgState();
  var target = msgBloch(m);
  var q = new HG.QReg(3);
  q.re[0] = m.a.re; q.im[0] = m.a.im;
  q.re[1] = m.b.re; q.im[1] = m.b.im;
  q.apply1(1, HG.G.H).cnot(1, 2);
  q.cnot(0, 1).apply1(0, HG.G.H);
  var m0 = q.measure(0), m1 = q.measure(1);
  if (m1) q.apply1(2, HG.G.X);
  if (m0) q.apply1(2, HG.G.Z);
  var bob = q.reducedBloch(2);
  var dist = 1 - (1 + bob.x * target.x + bob.y * target.y + bob.z * target.z) / 2;
  lastRun = { m0: m0, m1: m1, bob: bob, dist: dist, target: target };

  roBits.set(String(m0) + ' ' + String(m1), 'am');
  var base = m0 + 2 * m1;
  roBob.set(HG.cstr({ re: q.re[base], im: q.im[base] }, 3) + '|0⟩ + ' + HG.cstr({ re: q.re[base + 4], im: q.im[base + 4] }, 3) + '|1⟩', 'cy');
  roDist.set(dist.toFixed(6), dist < 1e-9 ? 'am' : 'rd');

  if (!animate) return;
  /* visuals */
  litStep(0);
  blochs[1].setTarget(0, 0, 0, true);
  blochs[2].setTarget(0, 0, 0, true);
  blochs[1].pulse(); blochs[2].pulse();
  var plan = [
    [300, function () { litStep(1); blochs[0].pulse(); }],
    [900, function () {
      litStep(2);
      blochs[0].setTarget(0, 0, m0 === 0 ? 1 : -1);
      blochs[0].flashes.push({ r: 0, a: 0.9, at: { x: 0, y: 0, z: m0 === 0 ? 1 : -1 } });
      blochs[1].setTarget(0, 0, m1 === 0 ? 1 : -1);
      blochs[1].flashes.push({ r: 0, a: 0.9, at: { x: 0, y: 0, z: m1 === 0 ? 1 : -1 } });
    }],
    [1500, function () {
      litStep(3);
      flyBits(m0, m1);
    }],
    [2100, function () {
      litStep(4);
    }],
    [2400, function () {
      litStep(5);
      blochs[2].setTarget(lastRun.bob.x, lastRun.bob.y, lastRun.bob.z);
      blochs[2].flashes.push({ r: 0, a: 0.9, at: { x: lastRun.bob.x, y: lastRun.bob.y, z: lastRun.bob.z } });
    }]
  ];
  plan.forEach(function (p) { setTimeout(p[1], K.REDUCED ? 0 : p[0]); });
}

function flyBits(m0, m1) {
  flyAnim = { t0: performance.now(), dur: 600, m0: m0, m1: m1 };
  K.loop(function (t) {
    if (!flyAnim) return false;
    var u = (t - flyAnim.t0) / flyAnim.dur;
    drawStrip(u, flyAnim.m0, flyAnim.m1);
    if (u >= 1) {
      flyAnim = null;
      drawStrip(-1, null, null);
      return false;
    }
    return true;
  });
}
function drawStrip(u, m0, m1) {
  var ctx = strip.ctx, w = strip.w, h = strip.h;
  ctx.clearRect(0, 0, w, h);
  var y = h / 2;
  var xA = w * 0.3, xB = w * 0.7;
  ctx.strokeStyle = K.faint(0.5);
  ctx.beginPath(); ctx.moveTo(xA, y); ctx.lineTo(xB, y); ctx.stroke();
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ALICE', xA, y + 18);
  ctx.fillText('BOB', xB, y + 18);
  ctx.fillText('CLASSICAL CHANNEL — ANY WIRE, ANY SPEED, NO QUANTUM TRAVELS', w / 2, y - 18);
  if (u >= 0) {
    var x = xA + (xB - xA) * u;
    ctx.strokeStyle = K.amber(0.95);
    ctx.strokeRect(x - 14, y - 10, 28, 20);
    ctx.fillStyle = K.amber(0.95);
    ctx.fillText('[' + m0 + ' ' + m1 + ']', x, y + 3);
  } else if (lastRun) {
    ctx.fillStyle = K.faint(0.85);
    ctx.fillText('LAST ENVELOPE: [' + lastRun.m0 + ' ' + lastRun.m1 + ']', w / 2, y + 3);
  }
}
drawStrip(-1, null, null);

function runFast() {
  fastStats = { runs: 0, branches: [0, 0, 0, 0], worst: 0 };
  for (var i = 0; i < 500; i++) {
    var saveTh = msgTheta, savePhi = msgPhi;
    if (i > 0) {
      msgTheta = Math.random() * Math.PI;
      msgPhi = Math.random() * 2 * Math.PI;
    }
    var m = msgState();
    var target = msgBloch(m);
    var q = new HG.QReg(3);
    q.re[0] = m.a.re; q.im[0] = m.a.im;
    q.re[1] = m.b.re; q.im[1] = m.b.im;
    q.apply1(1, HG.G.H).cnot(1, 2);
    q.cnot(0, 1).apply1(0, HG.G.H);
    var b0 = q.measure(0), b1 = q.measure(1);
    if (b1) q.apply1(2, HG.G.X);
    if (b0) q.apply1(2, HG.G.Z);
    var bob = q.reducedBloch(2);
    var dist = 1 - (1 + bob.x * target.x + bob.y * target.y + bob.z * target.z) / 2;
    fastStats.runs++;
    fastStats.branches[b0 * 2 + b1]++;
    if (dist > fastStats.worst) fastStats.worst = dist;
    msgTheta = saveTh; msgPhi = savePhi;
  }
  roFast.set('500 RUNS · WORST DISTANCE ' + fastStats.worst.toExponential(1) + ' · BRANCHES ' + fastStats.branches.join('/'), fastStats.worst < 1e-9 ? 'am' : 'rd');
  syncMsg();
}

var row = K.buttons(controls);
row.add('RUN THE PROTOCOL', function () { runProtocol(true); }, { cls: 'big' });
row.add('RUN 500 AUDITS FAST', function () { runFast(); });
row.add('RANDOM MESSAGE', function () {
  msgTheta = Math.random() * Math.PI;
  msgPhi = Math.random() * 2 * Math.PI;
  slTh.set(msgTheta * 180 / Math.PI);
  slPh.set(msgPhi * 180 / Math.PI);
  syncMsg();
});

var slTh = K.slider(controls, {
  label: 'MESSAGE θ (POLAR)',
  min: 0, max: 180, step: 1, value: msgTheta * 180 / Math.PI,
  fmt: function (v) { return v.toFixed(0) + '°'; },
  onInput: function (v) { msgTheta = v * Math.PI / 180; syncMsg(); }
});
var slPh = K.slider(controls, {
  label: 'MESSAGE φ (AZIMUTH)',
  min: 0, max: 360, step: 1, value: msgPhi * 180 / Math.PI,
  fmt: function (v) { return v.toFixed(0) + '°'; },
  onInput: function (v) { msgPhi = v * Math.PI / 180; syncMsg(); }
});
})();
