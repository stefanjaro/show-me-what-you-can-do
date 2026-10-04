/* ALETHEIA — numeric evaluation.
 *
 * Everything is evaluated as a complex number, because that is what elementary
 * functions actually live on; real-valued results simply have Im = 0. Used for
 * verifying antiderivatives, for plotting, for fractals, and for the zeros of
 * the zeta function.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E;

  /* ══════════════════════════════════════════════════════════════════════
     Complex arithmetic
     ══════════════════════════════════════════════════════════════════════ */
  function C(re, im) { return { re: re, im: im === undefined ? 0 : im }; }
  var ZEROc = C(0, 0), ONEc = C(1, 0), Ic = C(0, 1);
  function cadd(a, b) { return C(a.re + b.re, a.im + b.im); }
  function csub(a, b) { return C(a.re - b.re, a.im - b.im); }
  function cmul(a, b) { return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function cdiv(a, b) {
    var d = b.re * b.re + b.im * b.im;
    if (d === 0) return C(NaN, NaN);
    return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function cscale(a, k) { return C(a.re * k, a.im * k); }
  function cneg(a) { return C(-a.re, -a.im); }
  function cabs(a) { return Math.hypot(a.re, a.im); }
  function carg(a) { return Math.atan2(a.im, a.re); }
  function cconj(a) { return C(a.re, -a.im); }
  function csqrt(a) {
    if (a.im === 0) return a.re >= 0 ? C(Math.sqrt(a.re), 0) : C(0, Math.sqrt(-a.re));
    var r = cabs(a);
    var w = Math.sqrt((r + a.re) / 2), v = Math.sqrt((r - a.re) / 2);
    if (a.im < 0) v = -v;
    return C(w, v);
  }
  function cexp(a) {
    var e = Math.exp(a.re);
    return C(e * Math.cos(a.im), e * Math.sin(a.im));
  }
  function clog(a) { return C(Math.log(cabs(a)), carg(a)); }
  function cpow(a, b) {
    if (b.im === 0 && b.re === Math.round(b.re) && Math.abs(b.re) < 1e9) {
      // integer powers: repeated squaring, no branch issues
      var n = Math.round(b.re);
      if (n === 0) return ONEc;
      var base = a, result = ONEc, m = Math.abs(n);
      while (m > 0) {
        if (m & 1) result = cmul(result, base);
        base = cmul(base, base);
        m >>= 1;
        if (cabs(result) > 1e250 || cabs(base) > 1e250) return C(NaN, NaN);
      }
      return n < 0 ? cdiv(ONEc, result) : result;
    }
    if (a.re === 0 && a.im === 0) return b.re > 0 ? ZEROc : C(NaN, NaN);
    return cexp(cmul(clog(a), b));
  }
  function csin(a) { return C(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im)); }
  function ccos(a) { return C(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im)); }
  function ctan(a) { return cdiv(csin(a), ccos(a)); }
  function ccot(a) { return cdiv(ccos(a), csin(a)); }
  function csec(a) { return cdiv(ONEc, ccos(a)); }
  function ccsc(a) { return cdiv(ONEc, csin(a)); }
  function csinh(a) { return C(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im)); }
  function ccosh(a) { return C(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im)); }
  function ctanh(a) { return cdiv(csinh(a), ccosh(a)); }
  function ccoth(a) { return cdiv(ccosh(a), csinh(a)); }
  function casin(z) {
    var iz = cmul(Ic, z);
    var inner = cadd(iz, csqrt(csub(ONEc, cmul(z, z))));
    return cdiv(clog(inner), Ic);
  }
  function cacos(z) { return csub(C(Math.PI / 2, 0), casin(z)); }
  function catan(z) {
    var iz = cmul(Ic, z);
    return cscale(csub(clog(csub(ONEc, iz)), clog(cadd(ONEc, iz))), 0.5 / 1);
  }
  function casinh(z) { return clog(cadd(z, csqrt(cadd(cmul(z, z), ONEc)))); }
  function cacosh(z) { return clog(cadd(z, csqrt(csub(cmul(z, z), ONEc)))); }
  function catanh(z) { return cscale(csub(clog(cadd(ONEc, z)), clog(csub(ONEc, z))), 0.5); }
  /* gamma: Lanczos approximation, reflected for Re z < 1/2 */
  var LANCZOS_G7 = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  function cgamma(z) {
    if (z.re < 0.5) {
      // reflection: Γ(z)Γ(1−z) = π / sin(πz)
      return cdiv(C(Math.PI, 0), cmul(csin(cscale(z, Math.PI)), cgamma(csub(ONEc, z))));
    }
    z = csub(z, ONEc);
    var x = C(LANCZOS_G7[0], 0), i;
    for (i = 1; i < LANCZOS_G7.length; i++) {
      x = cadd(x, cdiv(C(LANCZOS_G7[i], 0), cadd(z, C(i, 0))));
    }
    var t = cadd(z, C(LANCZOS_G7.length - 1.5, 0));
    return cmul(csqrt(cscale(C(2 * Math.PI, 0), 1)).re === 0 ? ZEROc : C(Math.sqrt(2 * Math.PI), 0),
      cmul(cpow(t, cadd(z, C(0.5, 0))), cmul(cexp(cneg(t)), x)));
  }
  /* error function: Taylor series (fine for |z| up to ~8) */
  function cerf(z) {
    var twoOverSqrtPi = 2 / Math.sqrt(Math.PI);
    var term = C(z.re, z.im), acc = C(z.re, z.im), n = 1;
    var z2 = cmul(z, z);
    while (n < 200) {
      term = cscale(cmul(term, z2), -1 / n);
      acc = cadd(acc, cdiv(term, C(2 * n + 1, 0)));
      if (cabs(term) < 1e-17 * Math.max(1, cabs(acc))) break;
      n++;
    }
    return cscale(acc, twoOverSqrtPi);
  }
  /* Lambert W: principal branch by Halley's method */
  function clambertw(z) {
    var w = cabs(z) < 1.6 ? z : clog(z);
    for (var i = 0; i < 60; i++) {
      var ew = cexp(w);
      var f = csub(cmul(w, ew), z);
      if (cabs(f) < 1e-15 * Math.max(1, cabs(z))) break;
      var w1 = cadd(w, ONEc);
      // Halley: w ← w − f / (f′ − f f″/(2f′)) with f′ = e^w(w+1), f″ = e^w(w+2)
      var fp = cmul(ew, w1);
      var fpp = cmul(ew, cadd(w, C(2, 0)));
      var denom = csub(fp, cdiv(cmul(f, fpp), cscale(fp, 2)));
      w = csub(w, cdiv(f, denom));
    }
    return w;
  }
  function isNaNC(a) { return isNaN(a.re) || isNaN(a.im); }
  function cstr(a) {
    if (a.im === 0) return String(a.re);
    return a.re + (a.im >= 0 ? ' + ' : ' - ') + Math.abs(a.im) + 'i';
  }

  /* ══════════════════════════════════════════════════════════════════════
     Expression → number
     ══════════════════════════════════════════════════════════════════════ */
  var CONSTS = {
    pi: function () { return C(Math.PI, 0); },
    tau: function () { return C(2 * Math.PI, 0); },
    e: function () { return C(Math.E, 0); },
    i: function () { return Ic; },
    phi: function () { return C((1 + Math.sqrt(5)) / 2, 0); },
    EulerGamma: function () { return C(0.5772156649015329, 0); },
    true: function () { return ONEc; }, false: function () { return ZEROc; }
  };
  var FUNCS1 = {
    sin: csin, cos: ccos, tan: ctan, cot: ccot, sec: csec, csc: ccsc,
    sinh: csinh, cosh: ccosh, tanh: ctanh, coth: ccoth,
    asin: casin, acos: cacos, atan: catan, asinh: casinh, acosh: cacosh, atanh: catanh,
    exp: cexp, ln: clog, sqrt: csqrt, gamma: cgamma, erf: cerf, lambertw: clambertw,
    abs: function (a) { return C(cabs(a), 0); },
    sign: function (a) { return C(a.re > 0 ? 1 : a.re < 0 ? -1 : 0, 0); },
    floor: function (a) { return C(Math.floor(a.re), 0); },
    ceil: function (a) { return C(Math.ceil(a.re), 0); },
    round: function (a) { return C(Math.round(a.re), 0); },
    factorial: function (a) { return cgamma(cadd(a, ONEc)); }
  };
  function evalExpr(e, env) {
    env = env || {};
    switch (e.t) {
      case 'num': return C(e.v.toNumber(), 0);
      case 'sym': {
        if (CONSTS[e.name]) return CONSTS[e.name]();
        if (env[e.name] !== undefined) {
          var v = env[e.name];
          return typeof v === 'number' ? C(v, 0) : (v.re !== undefined ? v : C(v, 0));
        }
        return C(NaN, NaN);
      }
      case 'inf': return C(e.s > 0 ? Infinity : -Infinity, 0);
      case 'nan': return C(NaN, NaN);
      case 'add': {
        var acc = ZEROc;
        for (var i = 0; i < e.args.length; i++) acc = cadd(acc, evalExpr(e.args[i], env));
        return acc;
      }
      case 'mul': {
        acc = ONEc;
        for (i = 0; i < e.args.length; i++) acc = cmul(acc, evalExpr(e.args[i], env));
        return acc;
      }
      case 'pow': return cpow(evalExpr(e.b, env), evalExpr(e.e, env));
      case 'fun': {
        var args = e.args.map(function (a) { return evalExpr(a, env); });
        switch (e.name) {
          case 'log':
            if (args.length === 1) return clog(args[0]);
            return cdiv(clog(args[0]), clog(args[1]));
          case 'hypot': {
            var r2 = 0; for (i = 0; i < args.length; i++) r2 += args[i].re * args[i].re;
            return C(Math.sqrt(r2), 0);
          }
          case 'atan2': return C(Math.atan2(args[0].re, args[1].re), 0);
          case 'mod': return C(args[0].re - args[1].re * Math.floor(args[0].re / args[1].re), 0);
          case 'min': {
            acc = args[0];
            for (i = 1; i < args.length; i++) if (args[i].re < acc.re) acc = args[i];
            return acc;
          }
          case 'max': {
            acc = args[0];
            for (i = 1; i < args.length; i++) if (args[i].re > acc.re) acc = args[i];
            return acc;
          }
          case 'gcd': case 'lcm': {
            var a1 = Math.abs(Math.round(args[0].re)), b1 = Math.abs(Math.round(args[1].re)), aa = a1, bb = b1, tmp;
            while (bb) { tmp = aa % bb; aa = bb; bb = tmp; }
            return C(e.name === 'gcd' ? aa : a1 / aa * b1, 0);
          }
          case 'binomial': {
            return C(Math.round(cdiv(cgamma(cadd(args[0], ONEc)), cmul(cgamma(cadd(args[1], ONEc)), cgamma(csub(cadd(args[0], ONEc), args[1])))).re), 0);
          }
          case 'erfc': return csub(ONEc, cerf(args[0]));
          case 'D': return C(NaN, NaN);          // symbolic derivative: no numeric value
          default:
            if (FUNCS1[e.name]) return FUNCS1[e.name](args[0], args);
            return C(NaN, NaN);
        }
      }
      case 'vec': case 'mat': {
        return C(NaN, NaN);
      }
      default: return C(NaN, NaN);
    }
  }
  function real1(e, env) { var v = evalExpr(e, env); return v.re; }
  function evalReal(e, env) { return evalExpr(e, env).re; }

  /* safe comparison helpers used by the verifier */
  function finite(a) { return !isNaN(a) && isFinite(a); }
  function closeRel(a, b, tol) {
    tol = tol === undefined ? 1e-7 : tol;
    var m = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= tol * m;
  }

  AE.numeric = {
    C: C, cadd: cadd, csub: csub, cmul: cmul, cdiv: cdiv, cneg: cneg, cabs: cabs, carg: carg,
    csqrt: csqrt, cexp: cexp, clog: clog, cpow: cpow, csin: csin, ccos: ccos, ctan: ctan,
    csinh: csinh, ccosh: ccosh, ctanh: ctanh, cgamma: cgamma, cerf: cerf, clambertw: clambertw,
    cconj: cconj, cscale: cscale, isNaN: isNaNC, str: cstr,
    ZERO: ZEROc, ONE: ONEc, I: Ic,
    evalExpr: evalExpr, evalReal: evalReal, real: real1, finite: finite, closeRel: closeRel,
    CONSTS: CONSTS
  };

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function ev(s, env) { return evalExpr(AE.parse(s), env || {}); }

  U.test('numeric', 'complex arithmetic', function (a) {
    a.near(cmul(C(3, 4), C(1, -2)).re, 11, 1e-12);
    a.near(cmul(C(3, 4), C(1, -2)).im, -2, 1e-12);
    a.near(cdiv(C(1, 2), C(3, 4)).re, 11 / 25, 1e-12);
    a.near(cabs(C(3, 4)), 5, 1e-12);
    a.near(cexp(C(0, Math.PI)).re, -1, 1e-12, 'e^{iπ} = -1');
    a.near(Math.abs(cexp(C(0, Math.PI)).im), 0, 1e-12);
    a.near(cpow(C(-8, 0), C(1 / 3, 0)).re, 1, 1e-9, 'principal cube root of -8');
    a.near(csqrt(C(-4, 0)).im, 2, 1e-12, 'sqrt(-4) = 2i');
    a.near(cgamma(C(5, 0)).re, 24, 1e-9, 'Γ(5) = 24');
    a.near(cgamma(C(0.5, 0)).re, Math.sqrt(Math.PI), 1e-9, 'Γ(1/2) = √π');
    a.near(cgamma(C(-1.5, 0)).re, 2.3632718012073544, 1e-8, 'reflection for negative arguments');
  });

  U.test('numeric', 'expression evaluation', function (a) {
    a.near(ev('2+3*4').re, 14, 1e-12);
    a.near(ev('sin(pi/6)').re, 0.5, 1e-12);
    a.near(ev('exp(i*pi)').re, -1, 1e-12);
    a.near(ev('ln(e)').re, 1, 1e-12);
    a.near(ev('sqrt(-1)').im, 1, 1e-12);
    a.near(ev('x^2+2*x+1', { x: 3 }).re, 16, 1e-12);
    a.near(ev('gamma(6)').re, 120, 1e-7);
    a.near(ev('erf(1)').re, 0.8427007929497149, 1e-10);
    a.near(ev('lambertw(1)').re, 0.5671432904097838, 1e-10, 'ω');
    a.near(ev('erf(3)').re, 0.9999779095030014, 1e-9);
    a.ok(isNaNC(ev('q')), 'unknown symbol evaluates to NaN');
    a.near(ev('ln(-1)').im, Math.PI, 1e-12, 'complex log branch');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
