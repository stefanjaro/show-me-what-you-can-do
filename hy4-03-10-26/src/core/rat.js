/* ALETHEIA — exact rational arithmetic on BigInt.
 *
 * Nothing in the algebra engine is allowed to touch floating point unless it
 * explicitly says so. Every `simplify`, every factorisation and every integral
 * is built on these rationals, which means results like
 *      1/3 + 1/6 = 1/2   and   (10^40 + 1) - 10^40 = 1
 * come out exact, not approximately right.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});

  var ZERO = 0n, ONE = 1n, TWO = 2n;

  function bigAbs(a) { return a < ZERO ? -a : a; }
  function bigMin(a, b) { return a < b ? a : b; }
  function bigGcd(a, b) {
    a = bigAbs(a); b = bigAbs(b);
    while (b !== ZERO) { var t = a % b; a = b; b = t; }
    return a;
  }
  function bigPow(a, k) {
    if (k < ZERO) throw new Error('bigPow: negative exponent');
    var r = ONE, base = a;
    while (k > ZERO) {
      if (k & ONE) r *= base;
      base *= base;
      k >>= ONE;
    }
    return r;
  }
  function bigRoot(a, k) {          // integer k-th root of a >= 0, exact or null
    if (a < ZERO) return null;
    if (a === ZERO) return ZERO;
    if (a === ONE) return ONE;
    // integer Newton's method; start strictly above the root, descend to it
    var kn = BigInt(k);
    var bits = BigInt(a.toString(2).length);
    var exp = (bits + kn - ONE) / kn;                 // ceil(bits/k)
    var x = ONE << exp;
    var guard = 0;
    while (guard++ < 400) {
      var y = ((kn - ONE) * x + a / bigPow(x, kn - ONE)) / kn;
      if (y >= x) break;
      x = y;
    }
    return bigPow(x, kn) === a ? x : null;
  }

  /* ── the rational itself ────────────────────────────────────────────── */
  function Rat(n, d) {
    if (!(this instanceof Rat)) return new Rat(n, d);
    if (typeof n === 'bigint') this.n = n;
    else if (typeof n === 'number') {
      if (!isFinite(n) || Math.floor(n) !== n) throw new Error('Rat: non-integer number ' + n);
      this.n = BigInt(n);
    } else throw new Error('Rat: bad numerator');
    if (d === undefined) { this.d = ONE; return; }
    if (typeof d === 'bigint') this.d = d;
    else if (typeof d === 'number') {
      if (!isFinite(d) || Math.floor(d) !== d) throw new Error('Rat: non-integer denominator ' + d);
      this.d = BigInt(d);
    } else throw new Error('Rat: bad denominator');
    if (this.d === ZERO) throw new Error('Rat: division by zero');
    this.norm();
  }
  Rat.prototype.norm = function () {
    if (this.d < ZERO) { this.n = -this.n; this.d = -this.d; }
    if (this.n === ZERO) { this.d = ONE; return this; }
    var g = bigGcd(this.n, this.d);
    if (g > ONE) { this.n /= g; this.d /= g; }
    return this;
  };

  var P = Rat.prototype;

  P.add = function (o) { var a = rat(o); return new Rat(this.n * a.d + a.n * this.d, this.d * a.d); };
  P.sub = function (o) { var a = rat(o); return new Rat(this.n * a.d - a.n * this.d, this.d * a.d); };
  P.mul = function (o) { var a = rat(o); return new Rat(this.n * a.n, this.d * a.d); };
  P.div = function (o) {
    var a = rat(o);
    if (a.n === ZERO) throw new Error('Rat: division by zero');
    return new Rat(this.n * a.d, this.d * a.n);
  };
  P.neg = function () { return new Rat(-this.n, this.d); };
  P.abs = function () { return this.n < ZERO ? new Rat(-this.n, this.d) : new Rat(this.n, this.d); };
  P.inv = function () {
    if (this.n === ZERO) throw new Error('Rat: reciprocal of zero');
    return new Rat(this.d, this.n);
  };
  P.pow = function (k) {
    k = BigInt(k);
    if (k === ZERO) return Rat.ONE;
    var base = this;
    if (k < ZERO) { base = this.inv(); k = -k; }
    return new Rat(bigPow(base.n, k), bigPow(base.d, k));
  };
  P.sqrt = function () {
    if (this.n < ZERO) return null;
    var a = bigRoot(this.n, 2), b = bigRoot(this.d, 2);
    if (a === null || b === null) return null;
    return new Rat(a, b);
  };
  P.nthRoot = function (k) {
    if (this.n < ZERO) return null;
    var a = bigRoot(this.n, k), b = bigRoot(this.d, k);
    if (a === null || b === null) return null;
    return new Rat(a, b);
  };
  P.cmp = function (o) {
    var a = rat(o), l = this.n * a.d, r = a.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  };
  P.eq = function (o) {
    var a = rat(o);
    return this.n === a.n && this.d === a.d;
  };
  P.lt = function (o) { return this.cmp(o) < 0; };
  P.gt = function (o) { return this.cmp(o) > 0; };
  P.le = function (o) { return this.cmp(o) <= 0; };
  P.ge = function (o) { return this.cmp(o) >= 0; };
  P.sign = function () { return this.n === ZERO ? 0 : this.n < ZERO ? -1 : 1; };
  P.isZero = function () { return this.n === ZERO; };
  P.isOne = function () { return this.n === ONE && this.d === ONE; };
  P.isInt = function () { return this.d === ONE; };
  P.num = function () { return this.n; };
  P.den = function () { return this.d; };
  P.toNumber = function () { return Number(this.n) / Number(this.d); };
  P.toFloat = P.toNumber;
  P.toString = function () { return this.d === ONE ? this.n.toString() : this.n.toString() + '/' + this.d.toString(); };
  P.toLatex = function () {
    if (this.d === ONE || this.n === ZERO) return this.n.toString();
    return (this.n < ZERO ? '-' : '') + '\\frac{' + bigAbs(this.n) + '}{' + this.d + '}';
  };
  P.floor = function () {
    var q = this.n / this.d;
    if (this.n < ZERO && q * this.d !== this.n) q -= ONE;
    return q;
  };
  P.ceil = function () { return new Rat(-(this.neg().floor())); };
  P.round = function () {
    var shifted = this.abs().add(Rat.HALF).floor();
    return this.n < ZERO ? new Rat(-shifted) : new Rat(shifted);
  };
  P.hash = function () { return this.n.toString() + '/' + this.d.toString(); };

  /* ── constructors ───────────────────────────────────────────────────── */
  function rat(x) {
    if (x instanceof Rat) return x;
    if (typeof x === 'number') return Rat.fromFloat(x);
    if (typeof x === 'bigint') return new Rat(x);
    if (typeof x === 'string') return Rat.parse(x);
    if (x && x.n !== undefined && x.d !== undefined) return new Rat(BigInt(x.n), BigInt(x.d));
    throw new Error('rat(): cannot convert ' + x);
  }
  Rat.int = function (v) { return new Rat(typeof v === 'bigint' ? v : BigInt(v)); };
  Rat.parse = function (s) {
    s = String(s).trim();
    var m = /^([+-]?\d+)?(?:\/([+-]?\d+))?$/.exec(s);
    if (m) {
      var n = m[1] === undefined ? (m[2] === undefined ? null : 1n) : BigInt(m[1]);
      if (n === null) throw new Error('Rat.parse: ' + s);
      if (m[2] === undefined) return new Rat(n);
      return new Rat(n, BigInt(m[2]));
    }
    // decimal
    var dm = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (dm && (dm[2] || dm[3])) {
      var sign = dm[1] === '-' ? -1 : 1;
      var ip = dm[2] || '0', fp = dm[3] || '';
      var num = BigInt(ip + fp), den = bigPow(10n, BigInt(fp.length));
      var r = new Rat(num, den);
      return dm[1] === '-' ? r.neg() : r;
    }
    m = /^([+-]?)(\d+)\s*\^\s*(-?\d+)$/.exec(s);  // e.g. "2^-3"
    if (m) { var r = new Rat(BigInt(m[2])).pow(BigInt(parseInt(m[3], 10))); return m[1] === '-' ? r.neg() : r; }
    throw new Error('Rat.parse: cannot parse "' + s + '"');
  };
  /* best rational approximation of a float (continued fractions) */
  Rat.fromFloat = function (x, tol) {
    if (!isFinite(x)) throw new Error('Rat.fromFloat: ' + x);
    if (Number.isInteger(x)) return new Rat(BigInt(x));
    tol = tol || 1e-12;
    var neg = x < 0; x = Math.abs(x);
    var ip = BigInt(Math.floor(x));
    var frac = x - Math.floor(x);
    // continued fraction of the fractional part: h_i = a_i*h_{i-1} + h_{i-2}
    var p2 = 0n, q2 = 1n, p1 = 1n, q1 = 0n, y = frac, best = Rat.ZERO, guard = 0;
    while (guard++ < 80) {
      var ai = BigInt(Math.floor(y));
      var p = ai * p1 + p2, q = ai * q1 + q2;
      if (q !== 0n && Math.abs(Number(p) / Number(q) - frac) < tol) { best = new Rat(p, q); break; }
      p2 = p1; q2 = q1; p1 = p; q1 = q;
      var rem = y - Math.floor(y);
      if (rem < 1e-15 || q1 === 0n) { if (q1 !== 0n) best = new Rat(p1, q1); break; }
      y = 1 / rem;
    }
    var r = best.add(new Rat(ip));
    return neg ? r.neg() : r;
  };
  Rat.from = rat;
  Rat.ZERO = new Rat(ZERO);
  Rat.ONE = new Rat(ONE);
  Rat.MONE = new Rat(-ONE);
  Rat.HALF = new Rat(ONE, TWO);
  Rat.max = function (a, b) { return a.cmp(b) >= 0 ? a : b; };
  Rat.min = function (a, b) { return a.cmp(b) <= 0 ? a : b; };
  Rat.sum = function (arr) { var r = Rat.ZERO; for (var i = 0; i < arr.length; i++) r = r.add(arr[i]); return r; };
  Rat.prod = function (arr) { var r = Rat.ONE; for (var i = 0; i < arr.length; i++) r = r.mul(arr[i]); return r; };

  /* ── integer helpers (small ints: used by root-finding & factoring) ─── */
  function gcdInt(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a; }
  function factorInt(n) {
    n = Math.abs(Math.floor(n));
    var out = [];
    if (n < 2) return out;
    if (n % 2 === 0) { var e = 0; while (n % 2 === 0) { n /= 2; e++; } out.push([2, e]); }
    for (var p = 3; p * p <= n && p < 1000000; p += 2) {
      if (n % p === 0) { var ee = 0; while (n % p === 0) { n /= p; ee++; } out.push([p, ee]); }
    }
    if (n > 1) out.push([n, 1]);
    return out;
  }
  function divisors(n, signed) {   // all divisors; count is capped for safety
    var f = factorInt(n), list = [1];
    for (var i = 0; i < f.length; i++) {
      var p = f[i][0], e = f[i][1], next = [];
      for (var k = 0; k < list.length; k++) {
        var v = list[k];
        for (var j = 0; j <= e; j++) { next.push(v); v *= p; }
      }
      list = next;
      if (list.length > 4096) throw new Error('too many divisors');
    }
    if (!signed) return list.sort(function (a, b) { return a - b; });
    var sgn = [];
    for (var q = 0; q < list.length; q++) { sgn.push(-list[q]); }
    return sgn.concat(list).sort(function (a, b) { return a - b; });
  }

  AE.Rat = Rat;
  AE.rat = rat;
  AE.bigAbs = bigAbs; AE.bigGcd = bigGcd; AE.bigPow = bigPow; AE.bigRoot = bigRoot;
  AE.gcdInt = gcdInt; AE.factorInt = factorInt; AE.divisors = divisors;

  var U = root.AE.util;
  var A = U.assert;

  U.test('rat', 'arithmetic', function (a) {
    a.eq(Rat.parse('1/3').add(Rat.parse('1/6')).toString(), '1/2');
    a.eq(Rat.parse('2/4').toString(), '1/2');
    a.eq(Rat.parse('-3/4').neg().toString(), '3/4');
    a.eq(Rat.parse('3/4').mul(Rat.parse('8/9')).toString(), '2/3');
    a.eq(Rat.parse('3/4').div(Rat.parse('8/9')).toString(), '27/32');
    a.eq(Rat.parse('2/3').pow(3).toString(), '8/27');
    a.eq(Rat.parse('2/3').pow(-2).toString(), '9/4');
    a.eq(Rat.parse('0').pow(0).toString(), '1');
    a.eq(Rat.parse('4/9').sqrt().toString(), '2/3');
    a.eq(Rat.parse('5/9').sqrt(), null);
    a.eq(Rat.parse('7/3').floor().toString(), '2');
    a.eq(Rat.parse('-7/3').floor().toString(), '-3');
    a.eq(Rat.parse('-7/3').ceil().toString(), '-2');
    a.eq(Rat.parse('1.25').toString(), '5/4');
    a.eq(Rat.parse('0.1').toString(), '1/10');
  });

  U.test('rat', 'exactness beyond double precision', function (a) {
    var huge = Rat.int(10n ** 40n);
    a.eq(huge.add(Rat.ONE).sub(huge).toString(), '1');
    a.eq(Rat.parse('1/3').mul(Rat.int(3)).toString(), '1');
    var s = Rat.ZERO;
    for (var i = 1; i <= 100; i++) s = s.add(Rat.parse('1/' + (i * (i + 1))));
    a.eq(s.toString(), '100/101');   // telescopes exactly
  });

  U.test('rat', 'float→exact round trip', function (a) {
    a.eq(Rat.fromFloat(0.5).toString(), '1/2');
    a.eq(Rat.fromFloat(-2.75).toString(), '-11/4');
    a.eq(Math.abs(Rat.fromFloat(Math.PI).toNumber() - Math.PI) < 1e-11, true, 'pi approx');
    a.eq(Rat.fromFloat(1 / 3).toString(), '1/3');
  });

  U.test('rat', 'integer factorisation & divisors', function (a) {
    a.eq(JSON.stringify(factorInt(360)), JSON.stringify([[2, 3], [3, 2], [5, 1]]));
    a.eq(divisors(12).join(','), '1,2,3,4,6,12');
    a.eq(divisors(7).join(','), '1,7');
    a.eq(divisors(4, true).join(','), '-4,-2,-1,1,2,4');
    a.eq(factorInt(97).map(function (v) { return v[0]; }).join(','), '97');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
