/* HILBERT'S GARDEN — INSTRUMENT X · THE PATIENT MEMORY */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i10-stage');
var controls = document.getElementById('i10-controls');
var readEl = document.getElementById('i10-readout');
if (!stage) return;
K.tag(stage, '3-QUBIT REPETITION CODE · SYNDROME REPAIR', 'DATA NEVER LOOKED AT DIRECTLY');

var entry = K.makeCanvas(stage, 400, 'Fidelity curves: a bare qubit versus the 3-qubit code under random bit flips');
var ctx = entry.ctx;

var pNow = 0.1;
var mc = {};          /* p -> {bare, coded} */
var demoAnim = null;
var rngSeed = 1234;

var ro = K.readout(readEl);
ro.head('MEMORY LEDGER');
var roP = ro.line('p', 'STORM RATE p');
var roBare = ro.line('bare', 'BARE QUBIT FIDELITY');
var roCoded = ro.line('coded', 'CODED QUBIT FIDELITY');
var roGain = ro.line('gain', 'ERROR REDUCTION');
var roTheory = ro.line('th', 'THEORY');
ro.note('Bare memory fails at rate ~2p ∕ 3 (a random X flips a random arrow into a mirror image). The code fails only when the storm strikes twice — rate ~3p², and double strikes need p² to conspire. The curve is Monte Carlo over genuine circuits: encode, random X noise, syndrome measurement, conditional repair, decode.');

function freshRng() { return HG.mulberry32(rngSeed++); }

function trialFidelity(p, encoded, shots, rng) {
  var fid = 0;
  for (var s = 0; s < shots; s++) {
    var th = rng() * Math.PI, ph = rng() * 2 * Math.PI;
    var target = { x: Math.sin(th) * Math.cos(ph), y: Math.sin(th) * Math.sin(ph), z: Math.cos(th) };
    var q = new HG.QReg(5);
    q.apply1(0, HG.RY(th));
    q.apply1(0, HG.RZ(ph));
    var bloch;
    if (!encoded) {
      if (rng() < p) q.apply1(0, HG.G.X);
      bloch = q.reducedBloch(0);
    } else {
      q.cnot(0, 1).cnot(0, 2);
      if (rng() < p) q.apply1(0, HG.G.X);
      if (rng() < p) q.apply1(1, HG.G.X);
      if (rng() < p) q.apply1(2, HG.G.X);
      q.cnot(0, 3).cnot(1, 3).cnot(0, 4).cnot(2, 4);
      var s1 = q.measure(3, rng), s2 = q.measure(4, rng);
      if (s1 && s2) q.apply1(0, HG.G.X);
      else if (s1 && !s2) q.apply1(1, HG.G.X);
      else if (!s1 && s2) q.apply1(2, HG.G.X);
      q.cnot(0, 1).cnot(0, 2);
      bloch = q.reducedBloch(0);
    }
    fid += (1 + bloch.x * target.x + bloch.y * target.y + bloch.z * target.z) / 2;
  }
  return fid / shots;
}

var computing = false;
function computeCurve(shots) {
  if (computing) return;
  computing = true;
  var ps = [];
  for (var i = 0; i <= 20; i++) ps.push(i * 0.025);
  var batch = 0;
  function step() {
    var t0 = performance.now();
    while (batch < ps.length && performance.now() - t0 < 28) {
      var p = ps[batch];
      var rng = freshRng();
      mc[p.toFixed(3)] = {
        bare: trialFidelity(p, false, shots, rng),
        coded: trialFidelity(p, true, shots, rng)
      };
      batch++;
    }
    draw();
    if (batch < ps.length) {
      requestAnimationFrame(step);
    } else {
      computing = false;
      syncReadout();
    }
  }
  requestAnimationFrame(step);
}

function at(p) {
  var best = null;
  Object.keys(mc).forEach(function (k) {
    var pk = parseFloat(k);
    if (best === null || Math.abs(pk - p) < Math.abs(best - p)) best = pk;
  });
  return best === null ? null : mc[best.toFixed(3)];
}
function syncReadout() {
  roP.set((pNow * 100).toFixed(1) + '%', 'am');
  var cur = at(pNow);
  if (cur) {
    roBare.set(cur.bare.toFixed(4), 'cy');
    roCoded.set(cur.coded.toFixed(4), 'am');
    roGain.set(((1 - cur.bare) / Math.max(1e-6, 1 - cur.coded)).toFixed(1) + '× FEWER FAILURES', 'am');
  }
  roTheory.set('bare ≈ 1 − 2p∕3 · code ≈ 1 − 2p² (STORMS MUST CONSPIRE)', 'cy');
}

function draw() {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);

  /* schematic */
  var sy = 54;
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('THE CODE: ONE LOGICAL QUBIT WRITTEN ACROSS THREE PHYSICAL ONES, TWO SYNDROME ANCILLAS WATCHING PARITIES', 22, 20);
  var q0 = { x: w * 0.28, y: sy }, q1 = { x: w * 0.43, y: sy }, q2 = { x: w * 0.58, y: sy };
  var s1 = { x: w * 0.43, y: sy + 52 }, s2 = { x: w * 0.58, y: sy + 52 };
  ctx.fillStyle = K.amber(0.9);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  [[q0, '|ψ⟩'], [q1, 'ψ'], [q2, 'ψ']].forEach(function (it) {
    ctx.strokeStyle = K.amber(0.8);
    ctx.beginPath(); ctx.arc(it[0].x, it[0].y, 11, 0, 6.2832); ctx.stroke();
    ctx.fillText(it[1], it[0].x, it[0].y + 3);
  });
  [[s1, 's₁'], [s2, 's₂']].forEach(function (it) {
    ctx.strokeStyle = K.cyan(0.7);
    ctx.beginPath(); ctx.arc(it[0].x, it[0].y, 9, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = K.cyan(0.9);
    ctx.fillText(it[1], it[0].x, it[0].y + 3);
    ctx.fillStyle = K.faint(0.8);
    ctx.fillText('MEASURE ONLY THESE', it[0].x, it[0].y + 22);
  });
  ctx.strokeStyle = K.faint(0.5);
  [[q0, s1], [q1, s1], [q0, s2], [q2, s2]].forEach(function (pair) {
    ctx.beginPath(); ctx.moveTo(pair[0].x, pair[0].y + 11); ctx.lineTo(pair[1].x, pair[1].y - 9); ctx.stroke();
  });

  /* plot */
  var gx0 = 48, gx1 = w - 20, gy0 = 150, gy1 = h - 46;
  ctx.strokeStyle = K.faint(0.4);
  ctx.strokeRect(gx0 + 0.5, gy0 + 0.5, gx1 - gx0, gy1 - gy0);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.fillStyle = K.faint(0.9);
  ctx.textAlign = 'left';
  ctx.fillText('SURVIVAL FIDELITY', 22, gy0 - 8);
  ctx.textAlign = 'center';
  ctx.fillText('BIT-FLIP STORM RATE p', (gx0 + gx1) / 2, gy1 + 16);
  [1, 0.75, 0.5, 0.25].forEach(function (tick, i) {
    ctx.fillStyle = K.faint(0.85);
    ctx.textAlign = 'right';
    ctx.fillText(tick.toFixed(2), gx0 - 6, gy0 + (gy1 - gy0) * i / 3 + 3);
    ctx.strokeStyle = K.faint(0.12);
    ctx.beginPath(); ctx.moveTo(gx0, gy0 + (gy1 - gy0) * i / 3); ctx.lineTo(gx1, gy0 + (gy1 - gy0) * i / 3); ctx.stroke();
  });
  [0, 0.25, 0.5].forEach(function (tick) {
    ctx.fillStyle = K.faint(0.85);
    ctx.textAlign = 'center';
    ctx.fillText((tick * 100).toFixed(0) + '%', gx0 + (gx1 - gx0) * tick / 0.5, gy1 + 16);
  });
  function sx(p) { return gx0 + (gx1 - gx0) * (p / 0.5); }
  function sy2(f) { return gy0 + (gy1 - gy0) * (1 - f); }

  /* theory */
  ctx.strokeStyle = K.faint(0.35);
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (var t = 0; t <= 50; t++) {
    var p = t / 100;
    var f = 1 - 2 * p / 3;
    if (t === 0) ctx.moveTo(sx(p), sy2(f)); else ctx.lineTo(sx(p), sy2(f));
  }
  ctx.stroke();
  ctx.strokeStyle = K.amber(0.28);
  ctx.beginPath();
  for (var t2 = 0; t2 <= 50; t2++) {
    var p2 = t2 / 100;
    var f2 = 1 - 2 * p2 * p2;
    if (t2 === 0) ctx.moveTo(sx(p2), sy2(f2)); else ctx.lineTo(sx(p2), sy2(f2));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  /* MC points */
  Object.keys(mc).forEach(function (k) {
    var p = parseFloat(k);
    var d = mc[k];
    ctx.fillStyle = K.cyan(0.85);
    ctx.beginPath(); ctx.arc(sx(p), sy2(d.bare), 2.6, 0, 6.2832); ctx.fill();
    ctx.fillStyle = K.amber(0.95);
    ctx.beginPath(); ctx.arc(sx(p), sy2(d.coded), 2.6, 0, 6.2832); ctx.fill();
  });

  /* current p hairline */
  ctx.strokeStyle = K.amber(0.35);
  ctx.beginPath(); ctx.moveTo(sx(pNow), gy0); ctx.lineTo(sx(pNow), gy1); ctx.stroke();

  ctx.fillStyle = K.cyan(0.9);
  ctx.textAlign = 'left';
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.fillText('BARE QUBIT (LIVE MC)', gx0 + 8, gy0 + 14);
  ctx.fillStyle = K.amber(0.95);
  ctx.fillText('3-QUBIT CODE (LIVE MC)', gx0 + 8, gy0 + 28);

  /* demo animation overlay */
  if (demoAnim) {
    var u = (performance.now() - demoAnim.t0) / demoAnim.dur;
    if (u >= 1) demoAnim = null;
    else {
      var victim = [q0, q1, q2][demoAnim.victim];
      var pulse = Math.abs(Math.sin(u * Math.PI * 3));
      ctx.strokeStyle = K.red(0.6 + 0.4 * pulse);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(victim.x, victim.y, 13 + pulse * 4, 0, 6.2832); ctx.stroke();
      ctx.lineWidth = 1;
      var anc = demoAnim.victim === 0 ? [s1, s2] : demoAnim.victim === 1 ? [s1] : [s2];
      anc.forEach(function (an) {
        ctx.strokeStyle = K.red(0.5 * pulse);
        ctx.beginPath(); ctx.moveTo(victim.x, victim.y); ctx.lineTo(an.x, an.y); ctx.stroke();
        ctx.fillStyle = K.red(0.9);
        ctx.fillText('!' + (u > 0.4 ? ' → REPAIR X' : ''), an.x + 16, an.y - 4);
      });
    }
  }
}

var row = K.buttons(controls);
row.add('STRIKE ONE RANDOM BIT', function () {
  demoAnim = { t0: performance.now(), dur: 1500, victim: Math.floor(Math.random() * 3) };
  K.loop(function () {
    draw();
    if (!demoAnim) return false;
    return true;
  });
});
row.add('COMPUTE BOTH CURVES · 21 STORM LEVELS × 800 TRIALS', function () {
  computeCurve(800);
  syncReadout();
}, { cls: 'big' });
row.add('RE-ROLL THE STORM', function () {
  rngSeed = Math.floor(Math.random() * 1e9);
  computeCurve(800);
  syncReadout();
});

K.slider(controls, {
  label: 'STORM RATE p (PROBABILITY EACH PHYSICAL QUBIT FLIPS)',
  min: 0, max: 50, step: 1, value: 10,
  fmt: function (v) { return v.toFixed(0) + '%'; },
  onInput: function (v) {
    pNow = v / 100;
    syncReadout();
    draw();
  }
});

computeCurve(400);
syncReadout();
})();
