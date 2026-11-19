var HG = (function (global) {
'use strict';

/* ================================================================
   HILBERT'S GARDEN — quantum engine
   A statevector simulator written from scratch. No libraries.
   A register of n qubits is a complex vector of length 2^n,
   stored as two Float64Arrays (re, im). Qubit q is bit q of the
   basis index. Gates are exact 2x2 complex unitaries applied by
   bit masking; measurement samples the Born rule and collapses.
   ================================================================ */

var TWO_PI = 2 * Math.PI;

function mulberry32(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function C(re, im) { return { re: re, im: im }; }
function cmul(a, b) { return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
function cadd(a, b) { return C(a.re + b.re, a.im + b.im); }
function cabs(a) { return Math.sqrt(a.re * a.re + a.im * a.im); }
function cexp(theta) { return C(Math.cos(theta), Math.sin(theta)); }
function cstr(a, digits) {
  var d = digits === undefined ? 3 : digits;
  function num(x) {
    var r = x.toFixed(d);
    if (r === '-0.' + new Array(d + 1).join('0')) r = (0).toFixed(d);
    return r;
  }
  var re = num(a.re), im = num(a.im);
  if (Math.abs(a.im) < Math.pow(10, -d) / 2) return re;
  if (Math.abs(a.re) < Math.pow(10, -d) / 2) return im + 'i';
  return re + (a.im >= 0 ? '+' : '') + im + 'i';
}

/* 2x2 complex matrices {a,b,c,d} acting as
   [ a b ]
   [ c d ]  on (amp0, amp1) */
function M(a, b, c, d) { return { a: a, b: b, c: c, d: d }; }
var SQ = Math.SQRT1_2;

var G = {
  I:  M(C(1, 0), C(0, 0), C(0, 0), C(1, 0)),
  X:  M(C(0, 0), C(1, 0), C(1, 0), C(0, 0)),
  Y:  M(C(0, 0), C(0, -1), C(0, 1), C(0, 0)),
  Z:  M(C(1, 0), C(0, 0), C(0, 0), C(-1, 0)),
  H:  M(C(SQ, 0), C(SQ, 0), C(SQ, 0), C(-SQ, 0)),
  S:  M(C(1, 0), C(0, 0), C(0, 0), C(0, 1)),
  Sdg: M(C(1, 0), C(0, 0), C(0, 0), C(0, -1)),
  T:  M(C(1, 0), C(0, 0), C(0, 0), cexp(Math.PI / 4)),
  Tdg: M(C(1, 0), C(0, 0), C(0, 0), cexp(-Math.PI / 4)),
  SQX: M(C(0.5, 0.5), C(0.5, -0.5), C(0.5, -0.5), C(0.5, 0.5))
};

function RX(t) {
  var c = Math.cos(t / 2), s = Math.sin(t / 2);
  return M(C(c, 0), C(0, -s), C(0, -s), C(c, 0));
}
function RY(t) {
  var c = Math.cos(t / 2), s = Math.sin(t / 2);
  return M(C(c, 0), C(-s, 0), C(s, 0), C(c, 0));
}
function RZ(t) {
  return M(cexp(-t / 2), C(0, 0), C(0, 0), cexp(t / 2));
}
function U1(t) {  /* phase gate e^{it} on |1> */
  return M(C(1, 0), C(0, 0), C(0, 0), cexp(t));
}

function QReg(n) {
  this.n = n;
  this.d = 1 << n;
  this.re = new Float64Array(this.d);
  this.im = new Float64Array(this.d);
  this.re[0] = 1;
}

QReg.prototype.clone = function () {
  var q = new QReg(this.n);
  q.re.set(this.re);
  q.im.set(this.im);
  return q;
};

QReg.prototype.setBasis = function (index) {
  this.re.fill(0); this.im.fill(0);
  this.re[index] = 1;
  return this;
};

QReg.prototype.amp = function (i) { return C(this.re[i], this.im[i]); };

QReg.prototype.probs = function () {
  var out = new Float64Array(this.d);
  for (var i = 0; i < this.d; i++) out[i] = this.re[i] * this.re[i] + this.im[i] * this.im[i];
  return out;
};

QReg.prototype.norm = function () {
  var s = 0;
  for (var i = 0; i < this.d; i++) s += this.re[i] * this.re[i] + this.im[i] * this.im[i];
  return Math.sqrt(s);
};

QReg.prototype.apply1 = function (q, m) {
  var re = this.re, im = this.im, mask = 1 << q;
  for (var i = 0; i < this.d; i++) {
    if (i & mask) continue;
    var j = i | mask;
    var a0re = re[i], a0im = im[i], a1re = re[j], a1im = im[j];
    var m_a = m.a, m_b = m.b, m_c = m.c, m_d = m.d;
    re[i]  = m_a.re * a0re - m_a.im * a0im + m_b.re * a1re - m_b.im * a1im;
    im[i]  = m_a.re * a0im + m_a.im * a0re + m_b.re * a1im + m_b.im * a1re;
    re[j]  = m_c.re * a0re - m_c.im * a0im + m_d.re * a1re - m_d.im * a1im;
    im[j]  = m_c.re * a0im + m_c.im * a0re + m_d.re * a1im + m_d.im * a1re;
  }
  return this;
};

QReg.prototype.applyCU1 = function (control, target, m) {
  var re = this.re, im = this.im, mc = 1 << control, mt = 1 << target;
  for (var i = 0; i < this.d; i++) {
    if (!(i & mc)) continue;
    if (i & mt) continue;
    var j = i | mt;
    var a0re = re[i], a0im = im[i], a1re = re[j], a1im = im[j];
    re[i]  = m.a.re * a0re - m.a.im * a0im + m.b.re * a1re - m.b.im * a1im;
    im[i]  = m.a.re * a0im + m.a.im * a0re + m.b.re * a1im + m.b.im * a1re;
    re[j]  = m.c.re * a0re - m.c.im * a0im + m.d.re * a1re - m.d.im * a1im;
    im[j]  = m.c.re * a0im + m.c.im * a0re + m.d.re * a1im + m.d.im * a1re;
  }
  return this;
};

QReg.prototype.cnot = function (control, target) {
  var re = this.re, im = this.im, mc = 1 << control, mt = 1 << target;
  for (var i = 0; i < this.d; i++) {
    if (!(i & mc)) continue;
    if (i & mt) continue;
    var j = i | mt;
    var tr = re[i], ti = im[i];
    re[i] = re[j]; im[i] = im[j];
    re[j] = tr; im[j] = ti;
  }
  return this;
};

QReg.prototype.cz = function (control, target) {
  var mt = 1 << target;
  for (var i = 0; i < this.d; i++) {
    if (!(i & (1 << control))) continue;
    if (i & mt) { this.re[i] = -this.re[i]; this.im[i] = -this.im[i]; }
  }
  return this;
};

QReg.prototype.cp = function (control, target, lambda) {
  var ph = cexp(lambda), mt = 1 << target;
  for (var i = 0; i < this.d; i++) {
    if (!(i & (1 << control))) continue;
    if (i & mt) {
      var re = this.re[i], im = this.im[i];
      this.re[i] = re * ph.re - im * ph.im;
      this.im[i] = re * ph.im + im * ph.re;
    }
  }
  return this;
};

QReg.prototype.swap = function (a, b) {
  if (a === b) return this;
  var ma = 1 << a, mb = 1 << b;
  for (var i = 0; i < this.d; i++) {
    if ((i & ma) && !(i & mb)) {
      var j = (i & ~ma) | mb;
      var tr = this.re[i], ti = this.im[i];
      this.re[i] = this.re[j]; this.im[i] = this.im[j];
      this.re[j] = tr; this.im[j] = ti;
    }
  }
  return this;
};

/* Born-rule sampling of one qubit, with collapse.
   rng is optional (defaults to Math.random). */
QReg.prototype.measure = function (q, rng) {
  var r = (rng || Math.random)();
  var mask = 1 << q;
  var p1 = 0;
  for (var i = 0; i < this.d; i++) {
    if (i & mask) p1 += this.re[i] * this.re[i] + this.im[i] * this.im[i];
  }
  var outcome = r < p1 ? 1 : 0;
  var pKeep = outcome ? p1 : 1 - p1;
  var s = 1 / Math.sqrt(pKeep);
  for (var k = 0; k < this.d; k++) {
    if (((k & mask) ? 1 : 0) === outcome) {
      this.re[k] *= s; this.im[k] *= s;
    } else {
      this.re[k] = 0; this.im[k] = 0;
    }
  }
  return outcome;
};

/* Non-destructive sample of the full register. */
QReg.prototype.sampleIndex = function (rng) {
  var p = this.probs(), r = (rng || Math.random)(), acc = 0;
  for (var i = 0; i < this.d; i++) {
    acc += p[i];
    if (r <= acc) return i;
  }
  for (var j = this.d - 1; j >= 0; j--) if (p[j] > 0) return j;
  return 0;
};

/* Reduced Bloch vector of qubit q: (x,y,z), each in [-1,1].
   z = p0 - p1; x = 2 Re(rho01); y = 2 Im(conj(alpha) beta). */
QReg.prototype.reducedBloch = function (q) {
  var mask = 1 << q, p0 = 0, p1 = 0, rr = 0, ri = 0;
  for (var i = 0; i < this.d; i++) {
    var a = this.re[i] * this.re[i] + this.im[i] * this.im[i];
    if (i & mask) p1 += a; else p0 += a;
  }
  for (var k = 0; k < this.d; k++) {
    if (k & mask) continue;
    var j = k | mask;
    rr += this.re[k] * this.re[j] + this.im[k] * this.im[j];
    ri += this.re[k] * this.im[j] - this.im[k] * this.re[j];
  }
  return { x: 2 * rr, y: 2 * ri, z: p0 - p1 };
};

/* Measurement along an axis in the x-z plane, angle t from +z.
   Implemented honestly: rotate, then measure Z. */
QReg.prototype.measurePlane = function (q, t, rng) {
  this.apply1(q, RY(t));
  return this.measure(q, rng);
};

/* Multiply marked basis amplitudes by e^{i phi}. */
QReg.prototype.phaseOn = function (indices, phi) {
  var ph = cexp(phi);
  for (var k = 0; k < indices.length; k++) {
    var i = indices[k];
    var re = this.re[i], im = this.im[i];
    this.re[i] = re * ph.re - im * ph.im;
    this.im[i] = re * ph.im + im * ph.re;
  }
  return this;
};

/* Grover diffuser: 2|s><s| - I (up to global phase). */
QReg.prototype.diffuser = function () {
  for (var i = 0; i < this.n; i++) this.apply1(i, G.H);
  for (var k = 1; k < this.d; k++) { this.re[k] = -this.re[k]; this.im[k] = -this.im[k]; }
  for (var j = 0; j < this.n; j++) this.apply1(j, G.H);
  return this;
};

/* Bit-value of basis index at qubit list qs: first qubit is LSB. */
function xvalOf(i, qs) {
  var v = 0;
  for (var k = 0; k < qs.length; k++) if (i & (1 << qs[k])) v |= (1 << k);
  return v;
}

/* Uf |x,y> = |x, y XOR f(x)> */
QReg.prototype.oracleXor = function (qs, y, f) {
  var my = 1 << y;
  for (var i = 0; i < this.d; i++) {
    if (i & my) continue;
    if (f(xvalOf(i, qs))) {
      var j = i | my;
      var tr = this.re[i], ti = this.im[i];
      this.re[i] = this.re[j]; this.im[i] = this.im[j];
      this.re[j] = tr; this.im[j] = ti;
    }
  }
  return this;
};

/* QFT over the selected qubits (up to ordering conventions that
   do not affect probabilities):
   out[x] = 2^{-m/2} sum_y in[y] exp(2 pi i x y / 2^m) */
QReg.prototype.qft = function (qs) {
  var m = qs.length, N = 1 << m, d = this.d;
  var outRe = new Float64Array(d), outIm = new Float64Array(d);
  var norm = 1 / Math.sqrt(N);
  for (var i = 0; i < d; i++) {
    var x = xvalOf(i, qs);
    var rest = i;
    for (var b = 0; b < m; b++) rest &= ~(1 << qs[b]);
    for (var y = 0; y < N; y++) {
      var j = rest, yv = y;
      for (var b2 = 0; b2 < m; b2++) {
        if (yv & 1) j |= (1 << qs[b2]);
        yv >>>= 1;
      }
      var w = TWO_PI * x * y / N;
      var cw = Math.cos(w) * norm, sw = Math.sin(w) * norm;
      outRe[i] += this.re[j] * cw - this.im[j] * sw;
      outIm[i] += this.re[j] * sw + this.im[j] * cw;
    }
  }
  this.re = outRe; this.im = outIm;
  return this;
};

/* Prepare the Shor demo state for factoring N=15 with base a:
   counting register (qs) uniform over x, work register = a^x mod 15.
   work qubit list must encode 4 bits (values 0..15). */
QReg.prototype.prepareModExp = function (a, qs, ws) {
  this.re.fill(0); this.im.fill(0);
  var X = 1 << qs.length;
  for (var x = 0; x < X; x++) {
    var v = 1;
    for (var e = 0; e < x; e++) v = (v * a) % 15;
    var idx = 0;
    var xv = x;
    for (var b = 0; b < qs.length; b++) { if (xv & 1) idx |= (1 << qs[b]); xv >>>= 1; }
    var wv = v;
    for (var b2 = 0; b2 < ws.length; b2++) { if (wv & 1) idx |= (1 << ws[b2]); wv >>>= 1; }
    this.re[idx] = 1 / Math.sqrt(X);
  }
  return this;
};

function probsEqual(a, b, tol) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) return false;
  return true;
}

function blochClose(b, x, y, z, tol) {
  tol = tol || 1e-9;
  return Math.abs(b.x - x) <= tol && Math.abs(b.y - y) <= tol && Math.abs(b.z - z) <= tol;
}

/* Export */
var api = {
  QReg: QReg,
  G: G,
  RX: RX, RY: RY, RZ: RZ, U1: U1,
  C: C, cmul: cmul, cadd: cadd, cabs: cabs, cexp: cexp, cstr: cstr,
  M: M,
  mulberry32: mulberry32,
  xvalOf: xvalOf,
  probsEqual: probsEqual,
  blochClose: blochClose
};
return api;
})(typeof window !== 'undefined' ? window : global);
if (typeof module !== 'undefined' && module.exports) module.exports = HG;
