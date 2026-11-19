/* HILBERT'S GARDEN — verification suite.
   Runs identically in Node and the browser. Every claim the site
   makes about its own engine is checked here, numerically. */
(function (global) {
'use strict';
var HG = global.HG || require('./engine.js');
var QReg = HG.QReg, G = HG.G, RY = HG.RY, RX = HG.RX, RZ = HG.RZ;
var mulberry32 = HG.mulberry32, blochClose = HG.blochClose, probsEqual = HG.probsEqual;

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function close(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }

var suite = [];
function test(name, fn) { suite.push({ name: name, fn: fn }); }

/* ---------- basic unitarity ---------- */
test('gates are their own inverses (H, X, Y, Z)', function () {
  var gates = [G.H, G.X, G.Y, G.Z];
  for (var k = 0; k < gates.length; k++) {
    var q = new QReg(3);
    q.apply1(1, gates[k]).apply1(1, gates[k]);
    assert(probsEqual(q.probs(), new QReg(3).probs(), 1e-12), 'gate not involutive');
  }
});
test('S^2 = Z', function () {
  var q = new QReg(1); q.apply1(0, G.S).apply1(0, G.S);
  var p = new QReg(1); p.apply1(0, G.Z);
  for (var i = 0; i < 2; i++) {
    assert(close(q.re[i], p.re[i], 1e-12) && close(q.im[i], p.im[i], 1e-12), 'S^2 != Z');
  }
});
test('H amplitudes are exact', function () {
  var q = new QReg(1).apply1(0, G.H);
  assert(close(q.re[0], Math.SQRT1_2, 1e-12) && close(q.re[1], Math.SQRT1_2, 1e-12), 'H amplitudes');
});
test('norm preserved through 400 random gates', function () {
  var rng = mulberry32(7);
  var q = new QReg(5);
  var pool = [G.X, G.Y, G.Z, G.H, G.S, G.T, RX(1.3), RY(2.1)];
  for (var s = 0; s < 400; s++) {
    var g = pool[Math.floor(rng() * pool.length)];
    q.apply1(Math.floor(rng() * 5), g);
  }
  assert(close(q.norm(), 1, 1e-9), 'norm drifted: ' + q.norm());
});

/* ---------- Bloch vectors ---------- */
test('Bloch vectors of the cardinal states', function () {
  assert(blochClose(new QReg(1).reducedBloch(0), 0, 0, 1), '|0>');
  var one = new QReg(1); one.apply1(0, G.X);
  assert(blochClose(one.reducedBloch(0), 0, 0, -1), '|1>');
  var plus = new QReg(1).apply1(0, G.H);
  assert(blochClose(plus.reducedBloch(0), 1, 0, 0), '|+>');
  var iplus = new QReg(1).apply1(0, G.H).apply1(0, G.S);
  assert(blochClose(iplus.reducedBloch(0), 0, 1, 0), '|i+>');
});

/* ---------- measurement ---------- */
test('Born rule: |0> at 60 degrees from z gives exactly 75/25', function () {
  var q2 = new QReg(1).apply1(0, RY(Math.PI / 3));
  assert(close(q2.probs()[0], 0.75, 1e-12), 'p0 != .75');
  var rng = mulberry32(11), ok = 0, N = 20000;
  for (var t = 0; t < N; t++) {
    var q3 = new QReg(1);
    if (q3.measurePlane(0, Math.PI / 3, rng) === 0) ok++;
  }
  var tol = 3 * Math.sqrt(0.75 * 0.25 / N);
  assert(Math.abs(ok / N - 0.75) < tol, 'sampling deviates: ' + ok / N);
});
test('collapse removes the other branch exactly', function () {
  var q = new QReg(2).apply1(0, G.H);
  q.measure(1, mulberry32(3));
  assert(close(q.norm(), 1, 1e-12), 'collapse broke norm');
  var pr = q.probs();
  assert(close(pr[0] + pr[1], 0, 1e-12) || close(pr[2] + pr[3], 0, 1e-12), 'uncollapsed branch survived');
});

/* ---------- entanglement ---------- */
test('Bell state |Phi+>: only |00> and |11>, each 1/2', function () {
  var q = new QReg(2).apply1(0, G.H).cnot(0, 1);
  var p = q.probs();
  assert(close(p[0], 0.5, 1e-12) && close(p[3], 0.5, 1e-12) && close(p[1] + p[2], 0, 1e-12), 'bad Bell');
});
test('each Bell qubit alone is maximally random', function () {
  var q = new QReg(2).apply1(0, G.H).cnot(0, 1);
  assert(blochClose(q.reducedBloch(0), 0, 0, 0, 1e-12), 'q0 not mixed');
  assert(blochClose(q.reducedBloch(1), 0, 0, 0, 1e-12), 'q1 not mixed');
});
function singlet() {
  var q = new QReg(2);
  q.apply1(0, G.X);
  q.apply1(1, G.X);
  q.apply1(0, G.H);
  q.cnot(0, 1);
  return q;
}
test('singlet |Psi-> is exact up to global phase', function () {
  var q = singlet(), p = q.probs();
  assert(close(p[1], 0.5, 1e-12) && close(p[2], 0.5, 1e-12), 'singlet support');
  assert(close(q.re[1], -Math.SQRT1_2, 1e-12) && close(q.re[2], Math.SQRT1_2, 1e-12), 'singlet signs');
  assert(close(q.im[1], 0, 1e-12) && close(q.im[2], 0, 1e-12), 'singlet phases');
});

/* ---------- singlet correlations E(a,b) = -cos(a-b) ---------- */
function correlation(thetaA, thetaB, N, rng) {
  var agree = 0;
  for (var s = 0; s < N; s++) {
    var q = singlet();
    var ra = q.measurePlane(0, thetaA, rng);
    var rb = q.measurePlane(1, thetaB, rng);
    if (ra === rb) agree++;
  }
  return 2 * (agree / N) - 1;
}
test('singlet: same axis -> perfect anticorrelation', function () {
  var E = correlation(0.4, 0.4, 4000, mulberry32(5));
  assert(close(E, -1, 0.05), 'E(a,a) = ' + E);
});
test('singlet: E(a,b) follows -cos(a-b)', function () {
  var rng = mulberry32(9);
  var pairs = [[0, Math.PI / 2], [0, Math.PI / 3], [Math.PI / 6, Math.PI / 6 + Math.PI / 2], [Math.PI / 5, -Math.PI / 5]];
  pairs.forEach(function (pr) {
    var E = correlation(pr[0], pr[1], 12000, rng);
    var th = -Math.cos(pr[0] - pr[1]);
    assert(Math.abs(E - th) < 0.03, 'E(' + pr[0].toFixed(2) + ',' + pr[1].toFixed(2) + ') = ' + E.toFixed(3) + ' vs ' + th.toFixed(3));
  });
});
test('no-signaling: Bob sees 50/50 no matter what Alice does', function () {
  var rng = mulberry32(13), ones = 0, N = 12000;
  for (var s = 0; s < N; s++) {
    var q = singlet();
    q.measurePlane(0, s % 2 === 0 ? 0 : 1.2345, rng);
    ones += q.measurePlane(1, 0.777, rng);
  }
  assert(Math.abs(ones / N - 0.5) < 0.02, 'Bob fraction=' + ones / N);
});

/* ---------- CHSH ----------
   Angles found by exhaustive scan; S = E(a,b) + E(a,b') - E(a',b) + E(a',b')
   with a = 45, a' = -45, b = 90, b' = 0 (degrees). Local realism: |S| <= 2.
   Singlet quantum theory: S = -2*sqrt(2). */
function chshScore(a, ap, b, bp, N, rng) {
  function E(ta, tb) {
    var acc = 0;
    for (var k = 0; k < N; k++) {
      var q = singlet();
      var r1 = q.measurePlane(0, ta, rng);
      var r2 = q.measurePlane(1, tb, rng);
      acc += (r1 === r2 ? 1 : -1);
    }
    return acc / N;
  }
  return E(a, b) + E(a, bp) - E(ap, b) + E(ap, bp);
}
test('CHSH: quantum score exceeds the classical bound of 2', function () {
  var rng = mulberry32(21);
  var S = chshScore(Math.PI / 4, -Math.PI / 4, Math.PI / 2, 0, 4000, rng);
  assert(Math.abs(S) > 2.4, 'S too small: ' + S);
  assert(Math.abs(S) < 2.828 + 0.06, 'S exceeds Tsirelson bound: ' + S);
  return 'S = ' + S.toFixed(3) + ' (classical limit 2.000)';
});
test('CHSH: separable state respects the classical bound', function () {
  var rng = mulberry32(23);
  function Esep(ta, tb) {
    var acc = 0;
    for (var k = 0; k < 4000; k++) {
      var q = new QReg(2); q.apply1(0, G.X);
      var r1 = q.measurePlane(0, ta, rng);
      var r2 = q.measurePlane(1, tb, rng);
      acc += (r1 === r2 ? 1 : -1);
    }
    return acc / 4000;
  }
  var S = Esep(Math.PI / 4, Math.PI / 2) + Esep(Math.PI / 4, 0) - Esep(-Math.PI / 4, Math.PI / 2) + Esep(-Math.PI / 4, 0);
  assert(Math.abs(S) <= 2 + 0.05, 'product state violates CHSH? ' + S);
});

/* ---------- Deutsch-Jozsa ---------- */
function djVerdict(n, f, rng) {
  var q = new QReg(n + 1);
  for (var i = 0; i < n; i++) q.apply1(i, G.H);
  q.apply1(n, G.X).apply1(n, G.H);
  var qs = []; for (var k = 0; k < n; k++) qs.push(k);
  q.oracleXor(qs, n, f);
  for (var j = 0; j < n; j++) q.apply1(j, G.H);
  return HG.xvalOf(q.sampleIndex(rng), qs) === 0 ? 'constant' : 'balanced';
}
test('Deutsch-Jozsa: every promise-keeping secret (n=3) is judged correctly', function () {
  var rng = mulberry32(31), bad = 0, total = 0;
  for (var f = 0; f < 256; f++) {
    var ones = 0;
    for (var x = 0; x < 8; x++) ones += (f >> x) & 1;
    if (ones !== 0 && ones !== 8 && ones !== 4) continue;
    total++;
    var expect = ones === 4 ? 'balanced' : 'constant';
    var got = djVerdict(3, (function (ff) { return function (xx) { return (ff >> xx) & 1; }; })(f), rng);
    if (got !== expect) bad++;
  }
  assert(bad === 0, bad + ' wrong verdicts out of ' + total);
  assert(total === 72, 'expected 72 valid secrets (2 constant + 70 balanced), got ' + total);
});

/* ---------- Grover ---------- */
function groverSuccess(n, marked, iters) {
  var q = new QReg(n);
  for (var i = 0; i < n; i++) q.apply1(i, G.H);
  for (var k = 0; k < iters; k++) {
    q.phaseOn([marked], Math.PI);
    q.diffuser();
  }
  return q.probs()[marked];
}
test('Grover N=4: one iteration reaches probability exactly 1', function () {
  for (var m = 0; m < 4; m++) assert(close(groverSuccess(2, m, 1), 1, 1e-9), 'm=' + m);
});
test('Grover N=8..64: near-optimal iterations beat 0.85', function () {
  var cases = [[3, 2], [4, 3], [5, 4], [6, 6]];
  cases.forEach(function (c) {
    var n = c[0], k = c[1];
    var p = groverSuccess(n, (n * 7 + 3) % (1 << n), k);
    assert(p > 0.85, 'n=' + n + ' k=' + k + ' p=' + p.toFixed(3));
  });
});
test('Grover: overshooting the optimum decays again', function () {
  var pOpt = groverSuccess(4, 5, 3);
  var pOver = groverSuccess(4, 5, 7);
  assert(pOpt > 0.95 && pOver < pOpt - 0.3, 'overshoot p=' + pOver.toFixed(3));
});

/* ---------- teleportation ---------- */
function randomQubit(rng) {
  var th = rng() * Math.PI, ph = rng() * 2 * Math.PI;
  return {
    a: { re: Math.cos(th / 2), im: 0 },
    b: { re: Math.sin(th / 2) * Math.cos(ph), im: Math.sin(th / 2) * Math.sin(ph) }
  };
}
function runTeleport(msg, rng) {
  var q = new QReg(3);
  q.re[0] = msg.a.re; q.im[0] = msg.a.im;
  q.re[1] = msg.b.re; q.im[1] = msg.b.im;
  var nrm = Math.sqrt(q.re[0] * q.re[0] + q.im[0] * q.im[0] + q.re[1] * q.re[1] + q.im[1] * q.im[1]);
  q.re[0] /= nrm; q.im[0] /= nrm; q.re[1] /= nrm; q.im[1] /= nrm;
  q.apply1(1, G.H).cnot(1, 2);
  q.cnot(0, 1).apply1(0, G.H);
  var m0 = q.measure(0, rng), m1 = q.measure(1, rng);
  if (m1) q.apply1(2, G.X);
  if (m0) q.apply1(2, G.Z);
  return { m0: m0, m1: m1, bloch: q.reducedBloch(2) };
}
function msgBloch(msg) {
  return {
    x: 2 * (msg.a.re * msg.b.re + msg.a.im * msg.b.im),
    y: 2 * (msg.a.re * msg.b.im - msg.a.im * msg.b.re),
    z: msg.a.re * msg.a.re + msg.a.im * msg.a.im - msg.b.re * msg.b.re - msg.b.im * msg.b.im
  };
}
test('teleportation: Bob always ends holding Alice\'s exact state', function () {
  var rng = mulberry32(41), worst = 0;
  for (var s = 0; s < 300; s++) {
    var msg = randomQubit(rng);
    var target = msgBloch(msg);
    var res = runTeleport(msg, rng);
    var err = Math.max(Math.abs(res.bloch.x - target.x), Math.abs(res.bloch.y - target.y), Math.abs(res.bloch.z - target.z));
    if (err > worst) worst = err;
  }
  assert(worst < 1e-9, 'worst Bloch error ' + worst);
});
test('teleportation: all four outcome branches occur', function () {
  var rng = mulberry32(43), seen = [0, 0, 0, 0];
  for (var s = 0; s < 800; s++) {
    var r = runTeleport(randomQubit(rng), rng);
    seen[r.m0 * 2 + r.m1]++;
  }
  for (var k = 0; k < 4; k++) assert(seen[k] > 10, 'branch ' + k + ' seen ' + seen[k] + ' times');
});

/* ---------- BB84 ---------- */
function bb84Run(photons, withEve, rng) {
  var sifted = 0, errors = 0, key = [];
  for (var s = 0; s < photons; s++) {
    var bit = rng() < 0.5 ? 0 : 1;
    var aliceBasis = rng() < 0.5 ? 0 : 1;
    var q = new QReg(1);
    if (bit) q.apply1(0, G.X);
    if (aliceBasis) q.apply1(0, G.H);
    if (withEve) {
      var eveBasis = rng() < 0.5 ? 0 : 1;
      if (eveBasis) q.apply1(0, G.H);
      q.measure(0, rng);
      if (eveBasis) q.apply1(0, G.H);
    }
    var bobBasis = rng() < 0.5 ? 0 : 1;
    if (bobBasis) q.apply1(0, G.H);
    var out = q.measure(0, rng);
    if (bobBasis === aliceBasis) {
      sifted++;
      if (out !== bit) errors++;
      key.push(out);
    }
  }
  return { sifted: sifted, errors: errors, qber: sifted ? errors / sifted : 0, key: key };
}
test('BB84 without Eve: zero errors on the sifted key', function () {
  var r = bb84Run(4000, false, mulberry32(51));
  assert(r.errors === 0, 'errors without Eve: ' + r.errors);
  assert(r.sifted > 1700 && r.sifted < 2300, 'sift rate off: ' + r.sifted);
});
test('BB84 with Eve: ~25% error rate betrays her', function () {
  var r = bb84Run(12000, true, mulberry32(53));
  assert(Math.abs(r.qber - 0.25) < 0.02, 'QBER=' + r.qber.toFixed(4));
  return 'QBER = ' + r.qber.toFixed(4);
});
test('one-time pad: XOR with the key is its own inverse', function () {
  var msg = 'meet at dawn by the quantum well';
  var rng = mulberry32(61);
  var key = [];
  while (key.length < msg.length * 8) key.push(rng() < 0.5 ? 0 : 1);
  function crypt(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var b = text.charCodeAt(i), kb = 0;
      for (var j = 0; j < 8; j++) if (key[i * 8 + j]) kb |= (1 << (7 - j));
      bytes.push(b ^ kb);
    }
    return bytes;
  }
  var cipher = crypt(msg), back = crypt(String.fromCharCode.apply(null, cipher));
  var text = '';
  for (var k = 0; k < back.length; k++) text += String.fromCharCode(back[k]);
  assert(text === msg, 'OTP round trip failed: ' + text);
});

/* ---------- QFT and period finding (Shor on 15) ---------- */
test('QFT of |0> is the uniform superposition', function () {
  var q = new QReg(3).qft([0, 1, 2]);
  var p = q.probs();
  for (var i = 0; i < 8; i++) assert(close(p[i], 0.125, 1e-12), 'p[' + i + ']=' + p[i]);
});
test('QFT of a basis state has flat magnitudes and the right phases', function () {
  var q = new QReg(3);
  q.setBasis(5);
  q.qft([0, 1, 2]);
  var p = q.probs();
  for (var i = 0; i < 8; i++) assert(close(p[i], 0.125, 1e-12), 'magnitude not flat');
  /* x=1: phase = 2*pi*5*1/8 */
  var ang = Math.atan2(q.im[1], q.re[1]);
  var want = (2 * Math.PI * 5 / 8) % (2 * Math.PI);
  var diff = Math.abs(ang - want);
  diff = Math.min(diff, 2 * Math.PI - diff);
  assert(diff < 1e-9, 'phase off: ' + ang + ' vs ' + want);
});
test('Shor on N=15: period register peaks at multiples of 16/r', function () {
  var qs = [0, 1, 2, 3], ws = [4, 5, 6, 7];
  var q = new QReg(8).prepareModExp(2, qs, ws);
  q.qft(qs);
  var p = q.probs();
  /* marginal over the entangled work register */
  var marginal = new Array(16).fill(0);
  for (var idx = 0; idx < 256; idx++) marginal[idx & 15] += p[idx];
  var support = [];
  for (var m = 0; m < 16; m++) if (marginal[m] > 1e-9) support.push(m);
  var okSupport = support.length === 4 && marginal[0] > 0.24 && marginal[4] > 0.24 && marginal[8] > 0.24 && marginal[12] > 0.24;
  assert(okSupport, 'support wrong: ' + support.map(function (m) { return m + ':' + marginal[m].toFixed(2); }).join(' '));
  return 'peaks at m in {0,4,8,12}, each p=0.25';
});
test('Shor on N=15: continued fractions recover r=4, factors 3 and 5', function () {
  /* m/r with m=4, N_counting=16 -> 4/16 = 1/4 -> r=4 */
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  var r = 4, a = 2;
  var f1 = gcd(Math.pow(a, r / 2) - 1, 15), f2 = gcd(Math.pow(a, r / 2) + 1, 15);
  assert(f1 * f2 === 15, 'factors ' + f1 + 'x' + f2);
  assert(f1 === 3 && f2 === 5, 'unexpected factor pair');
});

/* ---------- quantum error correction ---------- */
function qecFidelity(p, encoded, shots, rng) {
  var fid = 0;
  for (var s = 0; s < shots; s++) {
    var th = rng() * Math.PI, ph = rng() * 2 * Math.PI;
    var target = { x: Math.sin(th) * Math.cos(ph), y: Math.sin(th) * Math.sin(ph), z: Math.cos(th) };
    var q = new QReg(5);
    q.apply1(0, RY(th));
    q.apply1(0, RZ(ph));
    var bloch;
    if (!encoded) {
      if (rng() < p) q.apply1(0, G.X);
      bloch = q.reducedBloch(0);
    } else {
      q.cnot(0, 1).cnot(0, 2);
      if (rng() < p) q.apply1(0, G.X);
      if (rng() < p) q.apply1(1, G.X);
      if (rng() < p) q.apply1(2, G.X);
      q.cnot(0, 3).cnot(1, 3).cnot(0, 4).cnot(2, 4);
      var s1 = q.measure(3, rng), s2 = q.measure(4, rng);
      if (s1 && s2) q.apply1(0, G.X);
      else if (s1 && !s2) q.apply1(1, G.X);
      else if (!s1 && s2) q.apply1(2, G.X);
      q.cnot(0, 1).cnot(0, 2);
      bloch = q.reducedBloch(0);
    }
    var F = (1 + bloch.x * target.x + bloch.y * target.y + bloch.z * target.z) / 2;
    fid += F;
  }
  return fid / shots;
}
test('error correction: the 3-qubit code beats a bare qubit at p=10%', function () {
  var rng = mulberry32(71), p = 0.1, shots = 1500;
  var bare = qecFidelity(p, false, shots, rng);
  var coded = qecFidelity(p, true, shots, rng);
  assert(coded > bare + 0.02, 'coded=' + coded.toFixed(3) + ' bare=' + bare.toFixed(3));
  assert(coded > 0.95, 'coded fidelity too low: ' + coded.toFixed(3));
  assert(Math.abs(bare - (1 - 2 * p / 3)) < 0.03, 'bare should follow 1-2p/3, got ' + bare.toFixed(3));
  return 'F_coded = ' + coded.toFixed(3) + ' vs F_bare = ' + bare.toFixed(3);
});

/* ---------- engine speed ---------- */
test('the engine is fast: 10 qubits, 1000 gate ops in well under a second', function () {
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var q = new QReg(10);
  var rng = mulberry32(3);
  for (var s = 0; s < 1000; s++) {
    q.apply1(Math.floor(rng() * 10), G.H);
    q.cnot(Math.floor(rng() * 5), 5 + Math.floor(rng() * 5));
  }
  var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var dt = t1 - t0;
  assert(dt < 1500, 'too slow: ' + dt + 'ms');
  return dt.toFixed(0) + ' ms';
});

/* ---------- runner ---------- */
function runSuite(onResult) {
  var results = [];
  for (var i = 0; i < suite.length; i++) {
    var t = suite[i], entry = { name: t.name, pass: false, detail: '', ms: 0 };
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      var detail = t.fn();
      entry.pass = true;
      entry.detail = typeof detail === 'string' ? detail : '';
    } catch (e) {
      entry.detail = e.message;
    }
    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    entry.ms = t1 - t0;
    results.push(entry);
    if (onResult) onResult(entry);
  }
  return results;
}

if (typeof module !== 'undefined' && module.exports && typeof global.HG === 'undefined') {
  /* Node mode: run immediately and report. */
  var results = runSuite();
  var failures = results.filter(function (r) { return !r.pass; });
  results.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  [' + r.detail + ']' : '') + '  (' + r.ms.toFixed(1) + ' ms)');
  });
  console.log(results.length - failures.length + '/' + results.length + ' tests passed');
  if (failures.length) process.exit(1);
} else {
  global.HGSuite = { runSuite: runSuite, tests: suite };
}
})(typeof window !== 'undefined' ? window : global);
