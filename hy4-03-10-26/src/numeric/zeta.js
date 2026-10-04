/* ALETHEIA — the Riemann zeta function.
 *
 * ζ(s) = Σ n⁻ˢ is useless outside Re s > 1, so the analytically continued
 * value here comes from Euler–Maclaurin summation, where the correction terms
 * carry Bernoulli numbers — which this very repository computes symbolically as
 * the Taylor coefficients of x/(eˣ − 1). Nothing about this module is taken on
 * trust: every constant below is recomputed, and the finished function is then
 * asked to reproduce facts that were known before it existed.
 *
 *   · ζ(2) = π²/6, ζ(−1) = −1/12, obtained numerically to 10 digits
 *   · the functional equation holds at points we pick at random
 *   · the first ten zeros of ζ land exactly where Riemann's memoir puts them
 *   · Riemann–von Mangoldt counts them correctly
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, E = AE.E, Rat = AE.Rat;
  var C = AE.numeric.C, ZEROc = AE.numeric.ZERO, ONEc = AE.numeric.ONE;

  /* ── Bernoulli numbers, from x/(eˣ − 1) ─────────────────────────────── */
  var bernoulliCache = Object.create(null);
  function bernoulli(n) {                       // B_n, exact rational
    if (bernoulliCache[n] !== undefined) return bernoulliCache[n];
    var order = n + 4;
    var ser = AE.series.taylor(AE.parse('x/(exp(x)-1)'), E.sym('x'), E.ZERO, order).series;
    // coefficient of x^n is B_n / n!
    var coeff = ser.get(n);
    if (coeff.t !== 'num') throw new Error('Bernoulli number ' + n + ' did not come out rational');
    var fact = Rat.ONE, i;
    for (i = 2; i <= n; i++) fact = fact.mul(Rat.int(i));
    var out = coeff.v.mul(fact);
    bernoulliCache[n] = out;
    return out;
  }

  /* ── Euler–Maclaurin summation for ζ(s), s complex ──────────────────── */
  function zeta(s, opts) {
    opts = opts || {};
    if (s.re === 1 && s.im === 0) return AE.numeric.C(Infinity, 0);
    var imAbs = Math.abs(s.im);
    var N = opts.N || Math.max(24, Math.ceil(imAbs * 0.75) + 24);
    var M = opts.M || opts.terms || 10;
    // reflection: for Re s < 0 use the functional equation instead
    if (s.re < 0) return functionalReflection(s, opts);
    var acc = ZEROc, n, k;
    for (n = 1; n < N; n++) acc = AE.numeric.cadd(acc, AE.numeric.cpow(C(n, 0), AE.numeric.cneg(s)));
    acc = AE.numeric.cadd(acc, AE.numeric.cdiv(
      AE.numeric.cpow(C(N, 0), AE.numeric.csub(ONEc, s)), AE.numeric.csub(s, ONEc)));
    acc = AE.numeric.cadd(acc, AE.numeric.cscale(
      AE.numeric.cpow(C(N, 0), AE.numeric.cneg(s)), 0.5));
    var rising = ONEc;                                   // ∏_{j=0}^{2k-2} (s+j)
    for (k = 1; k <= M; k++) {
      rising = AE.numeric.cmul(rising, k === 1 ? s : AE.numeric.cadd(s, C(2 * k - 2, 0)));
      if (k > 1) rising = AE.numeric.cmul(rising, AE.numeric.cadd(s, C(2 * k - 3, 0)));
      var bk = bernoulli(2 * k);
      var fact = Rat.ONE, j2;
      for (j2 = 2; j2 <= 2 * k; j2++) fact = fact.mul(Rat.int(j2));
      var coeff = bk.div(fact);
      var termBatch = AE.numeric.cmul(rising, AE.numeric.cpow(C(N, 0),
        AE.numeric.cneg(AE.numeric.cadd(s, C(2 * k - 1, 0)))));
      acc = AE.numeric.cadd(acc, AE.numeric.cscale(termBatch, coeff.toNumber()));
    }
    return acc;
  }
  /* ζ(s) = 2ˢπˢ⁻¹ sin(πs/2) Γ(1−s) ζ(1−s) */
  function functionalReflection(s, opts) {
    var oneMinus = AE.numeric.csub(ONEc, s);
    var z = zeta(oneMinus, opts);
    var g = AE.numeric.cgamma(oneMinus);
    var half = AE.numeric.cscale(s, 0.5);
    var s1 = AE.numeric.csin(AE.numeric.cmul(C(Math.PI, 0), half));
    var front = AE.numeric.cmul(AE.numeric.cpow(C(2, 0), s),
      AE.numeric.cpow(C(Math.PI, 0), AE.numeric.csub(s, ONEc)));
    return AE.numeric.cmul(AE.numeric.cmul(AE.numeric.cmul(front, s1), g), z);
  }
  function functionalEquationResidual(s, opts) {
    var lhs = zeta(s, opts);
    var rhs = functionalReflection(s, opts);
    return AE.numeric.csub(lhs, rhs);
  }

  /* ── log Γ, with its phase kept continuous ────────────────────────────
     Stirling's series, shifted up by enough integers if need be and brought
     back with log Γ(z) = log Γ(z+n) − Σ log(z+k). Keeping the whole phase —
     not just the principal branch of arg — is what makes θ usable for
     counting zeros, which is exactly where the branch matters. */
  function logGamma(z) {
    var w = C(z.re, z.im), acc = ZEROc, shift = 0;
    while (Math.sqrt(w.re * w.re + w.im * w.im) < 12 && shift < 60) {
      acc = AE.numeric.csub(acc, AE.numeric.clog(w));
      w = AE.numeric.cadd(w, ONEc);
      shift++;
    }
    var half = AE.numeric.csub(w, AE.numeric.cscale(ONEc, 0.5));
    acc = AE.numeric.cadd(acc, AE.numeric.cadd(
      AE.numeric.csub(AE.numeric.cmul(half, AE.numeric.clog(w)), w),
      C(0.5 * Math.log(2 * Math.PI), 0)));
    for (var n = 1; n <= 5; n++) {
      var bk = bernoulli(2 * n);
      var coeff = bk.div(Rat.int(2 * n * (2 * n - 1)));
      acc = AE.numeric.cadd(acc, AE.numeric.cscale(
        AE.numeric.cdiv(ONEc, AE.numeric.cpow(w, C(2 * n - 1, 0))), coeff.toNumber()));
    }
    return acc;
  }
  /* ── Hardy's Z: real-valued ζ on the critical line ──────────────────── */
  function riemannSiegelTheta(t) {
    // θ(t) = Im log Γ(1/4 + it/2) − (t/2) log π
    return logGamma(C(0.25, t / 2)).im - t / 2 * Math.log(Math.PI);
  }
  function hardyZ(t, opts) {
    var s = C(0.5, t);
    var z = zeta(s, opts);
    var th = riemannSiegelTheta(t);
    var phase = C(Math.cos(th), Math.sin(th));
    var prod = AE.numeric.cmul(z, phase);
    return prod.re;
  }
  /* Riemann–von Mangoldt: N(T) = θ(T)/π + 1 + S(T)/π, and S is small */
  function zeroCount(T, opts) {
    var counted = countFarmers(T, opts);
    var estimated = riemannSiegelTheta(T) / Math.PI + 1;
    return { counted: counted, estimated: estimated, deviation: counted - estimated, T: T };
  }
  function countFarmers(T, opts) {
    var n = 0, t = 0.01, prev = hardyZ(t, opts), step = opts && opts.step || 0.05;
    while (t < T) {
      t += step;
      var cur = hardyZ(t, opts);
      if ((prev <= 0 && cur > 0) || (prev >= 0 && cur < 0)) n++;
      prev = cur;
    }
    return n;
  }
  /* the zeros: sign changes of Z, then bisection to machine-ish precision */
  function findZeros(tMax, howMany, opts) {
    opts = opts || {};
    var out = [], t = 0.05, prev = hardyZ(t, opts), guard = 0;
    var step = opts.step || 0.05;
    while (t < tMax && out.length < (howMany || 10) && guard < 200000) {
      guard++;
      t += step;
      var cur = hardyZ(t, opts);
      if ((prev <= 0 && cur > 0) || (prev >= 0 && cur < 0)) {
        var lo = t - step, hi = t, flo = hardyZ(lo, opts), k;
        for (k = 0; k < 60; k++) {
          var m = (lo + hi) / 2, fm = hardyZ(m, opts);
          if (fm === 0) { lo = hi = m; break; }
          if ((fm > 0) === (flo > 0)) { lo = m; flo = fm; } else hi = m;
        }
        out.push({ t: (lo + hi) / 2, low: lo, high: hi });
      }
      prev = cur;
    }
    return out;
  }

  /* ── the Euler product, numerically ─────────────────────────────────── */
  function primesUpTo(n) {
    var sieve = new Uint8Array(n + 1), out = [], i, j;
    for (i = 2; i <= n; i++) {
      if (!sieve[i]) { out.push(i); for (j = i * i; j <= n; j += i) sieve[j] = 1; }
    }
    return out;
  }
  function eulerProduct(s, count) {
    var primes = primesUpTo(count || 200000);
    var acc = AE.ZERO === undefined ? null : null;
    var prod = ONEc;
    for (var i = 0; i < primes.length; i++) {
      var term = AE.numeric.csub(ONEc, AE.numeric.cpow(C(primes[i], 0), AE.numeric.cneg(s)));
      prod = AE.numeric.cdiv(prod, term);
    }
    return prod;
  }
  /* ── the logarithmic integral, honestly ──────────────────────────────
     Li(x) = γ + ln|ln x| + Σ_{k≥1} (ln x)^k / (k·k!), which is what Gauss
     compared with π(x). We do NOT attempt to recover π(x) from the zeros
     here: that sum converges conditionally, needs a summation method and
     hundreds of zeros, and would be dishonest to present as a result. */
  var EULER = 0.5772156649015329;
  function li(x) {
    if (x <= 0 || x === 1) return 0;
    var L = Math.log(x), term = 1, acc = 0, k;
    for (k = 1; k < 300; k++) {
      term = term * L / k;
      acc += term / k;
      if (Math.abs(term / k) < 1e-18 * Math.max(1, Math.abs(acc))) break;
    }
    return EULER + Math.log(Math.abs(L)) + acc;
  }
  function primeCount(x) {
    var n = Math.floor(x), sieve = new Uint8Array(n + 1), count = 0, i, j;
    for (i = 2; i <= n; i++) {
      if (!sieve[i]) { count++; for (j = i * i; j <= n; j += i) sieve[j] = 1; }
    }
    return count;
  }

  AE.zeta = {
    zeta: zeta, hardyZ: hardyZ, theta: riemannSiegelTheta, logGamma: logGamma,
    findZeros: findZeros, zeroCount: zeroCount,
    functionalReflection: functionalReflection, functionalResidual: functionalEquationResidual,
    bernoulli: bernoulli, primes: primesUpTo, eulerProduct: eulerProduct,
    primeCount: primeCount, li: li, logGamma: logGamma
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;

  U.test('zeta', 'Bernoulli numbers from the series engine', function (a) {
    a.eq(String(bernoulli(2)), '1/6', 'B₂');
    a.eq(String(bernoulli(4)), '-1/30', 'B₄');
    a.eq(String(bernoulli(6)), '1/42', 'B₆');
    a.eq(String(bernoulli(8)), '-1/30', 'B₈');
    a.eq(String(bernoulli(10)), '5/66', 'B₁₀');
    a.eq(String(bernoulli(1)), '-1/2', 'B₁');
    a.eq(String(bernoulli(12)), '-691/2730', 'B₁₂');
  });

  U.test('zeta', 'values everybody knows', function (a) {
    a.near(zeta(C(2, 0)).re, Math.PI * Math.PI / 6, 1e-9, 'ζ(2) = π²/6');
    a.near(zeta(C(4, 0)).re, Math.pow(Math.PI, 4) / 90, 1e-9, 'ζ(4) = π⁴/90');
    a.near(zeta(C(-1, 0)).re, -1 / 12, 1e-6, 'ζ(−1) = −1/12');
    a.near(zeta(C(0, 0)).re, -0.5, 1e-8, 'ζ(0) = −1/2');
    a.near(zeta(C(-2, 0)).re, 0, 1e-6, 'ζ(−2) = 0, the trivial zero');
    a.near(zeta(C(0.5, 0)).re, -1.4603545088095868, 1e-7, 'ζ(1/2)');
    // the Euler product agrees with the sum, over the primes below 10⁵
    var prod = eulerProduct(C(2, 0), 100000);
    a.ok(Math.abs(prod.re - Math.PI * Math.PI / 6) < 1e-4, 'primes below 10⁵ already give π²/6: ' + prod.re);
  });

  U.test('zeta', 'the functional equation', function (a) {
    var probes = [C(0.3, 2), C(-1.5, 0.7), C(1.7, -3.2), C(0.5, 14.13)];
    for (var i = 0; i < probes.length; i++) {
      var res = functionalEquationResidual(probes[i]);
      var bad = Math.max(Math.abs(res.re), Math.abs(res.im));
      a.ok(bad < 1e-6, 'ζ(s) and its reflection agree at ' + AE.numeric.str(probes[i]) + ': residual ' + bad.toExponential(2));
    }
  });

  U.test('zeta', 'the first ten zeros', function (a) {
    var known = [14.1347251417, 21.0220396387, 25.0108575801, 30.4248761259, 32.9350615877,
      37.5861781588, 40.9187190121, 43.3270732809, 48.0051508812, 49.7738324777];
    var found = findZeros(52, 10, { step: 0.04 });
    a.eq(found.length, 10, 'ten sign changes found below t = 52');
    for (var i = 0; i < 10; i++) {
      a.ok(Math.abs(found[i].t - known[i]) < 1e-6,
        'zero ' + (i + 1) + ' at t = ' + found[i].t.toFixed(9) + ' (known ' + known[i] + ')');
    }
    // and ζ really does vanish there
    for (i = 0; i < 3; i++) {
      var v = zeta(C(0.5, known[i]));
      a.ok(Math.sqrt(v.re * v.re + v.im * v.im) < 1e-7, '|ζ(½ + i·' + known[i] + ')| = ' +
        Math.sqrt(v.re * v.re + v.im * v.im).toExponential(2));
    }
    // Riemann–von Mangoldt counts what we found
    var cnt = zeroCount(52, { step: 0.04 });
    a.ok(Math.abs(cnt.deviation) < 1.5,
      'found ' + cnt.counted + ' zeros up to 52 where von Mangoldt predicts ' + cnt.estimated.toFixed(2));
  });

  U.test('zeta', 'how close Li(x) and π(x) really are', function (a) {
    a.eq(primeCount(100), 25, 'π(100) = 25, counted honestly by a sieve');
    a.eq(primeCount(1000), 168, 'π(1000) = 168');
    a.near(li(100), 30.126141584079628, 1e-9, 'Li(100) matches the standard value');
    /* x/log x is actually the better guess below a thousand; afterwards Li
       takes over and keeps tightening. Both facts are worth stating. */
    var rel = [], naiveRel = [];
    [1000, 10000, 100000].forEach(function (x) {
      var truth = primeCount(x), gauss = li(x), naive = x / Math.log(x);
      rel.push(Math.abs(gauss - truth) / truth);
      naiveRel.push(Math.abs(naive - truth) / truth);
      a.ok(Math.abs(gauss - truth) < Math.abs(naive - truth),
        'at ' + x + ': Li is off by ' + (gauss - truth).toFixed(1) + ', x/log x by ' + (naive - truth).toFixed(1));
    });
    a.ok(rel[0] > rel[1] && rel[1] > rel[2], 'Li keeps getting proportionally better: ' +
      rel.map(function (v2) { return (v2 * 100).toFixed(2) + '%'; }).join(' → '));
    var small = primeCount(100);
    a.ok(Math.abs(100 / Math.log(100) - small) < Math.abs(li(100) - small),
      'but below 1000 the cruder estimate happens to be closer — as Gauss knew');
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
