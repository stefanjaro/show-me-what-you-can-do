/* ALETHEIA — simplification.
 *
 * expand      multiply out, collecting like terms through the polynomial engine
 * together    write as a single reduced fraction numerator/denominator
 * apart       partial fractions: needs factoring + the extended Euclidean
 *             algorithm, and is used by the integrator every time it meets a
 *             rational function
 * simplify    rule tables + gcd cancellation, chosen only when it makes the
 *             expression smaller (so nothing ever loops or explodes)
 *
 * Nothing here converts an exact value to floating point. √(1/4) = 1/2, and
 * 2^(1/2) stays 2^(1/2) forever.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E, MPoly = AE.MPoly, UP = AE.UP;

  /* ── expansion ──────────────────────────────────────────────────────── */
  function tryExpandPiece(e) {
    if (e.t !== 'add' && e.t !== 'mul' && e.t !== 'pow') return e;
    if (e.t === 'pow' && !(e.e.t === 'num' && e.e.v.isInt() && e.e.v.n > 1n && Number(e.e.v.n) <= 24)) return e;
    if (e.t === 'mul') {
      // only worth doing if a factor is itself a sum
      for (var i = 0; i < e.args.length; i++) if (e.args[i].t === 'add') break;
      if (i === e.args.length) return e;
    }
    try {
      var ord = [], budget = { n: 0 };
      var p = MPoly.toPoly(e, ord, budget);
      return MPoly.fromPoly(p, ord);
    } catch (err) {
      return e;
    }
  }
  function expand(e) {
    return E.rewrite(e, function (n) {
      if (n.t === 'add' || n.t === 'mul' || n.t === 'pow') return tryExpandPiece(n);
      return n;
    });
  }

  /* ── numerator / denominator of a rational expression ───────────────── */
  function rational(e, ord) {
    ord = ord || [];
    try {
      var r = MPoly.toRational(e, ord, { n: 0 });
      var g = MPoly.gcd(r.n, r.d, ord);
      if (!(MPoly.isRat(g) && g.isOne())) {
        r = { n: MPoly.div(r.n, g, ord), d: MPoly.div(r.d, g, ord) };
      }
      var c = MPoly.canonFraction(r.n, r.d, ord);
      return { n: c.n, d: c.d, ord: ord };
    } catch (err) {
      return null;
    }
  }
  function numer(e) { var r = rational(e); return r ? MPoly.fromPoly(r.n, r.ord) : e; }
  function denom(e) { var r = rational(e); return r ? MPoly.fromPoly(r.d, r.ord) : E.ONE; }
  function together(e) {
    var r = rational(e);
    if (!r) return e;
    return MPoly.fromRational({ n: r.n, d: r.d }, r.ord);
  }
  /* cancellation that is safe to apply inside products */
  function cancelDivide(e) {
    var r = rational(e);
    if (!r) return e;
    var out = MPoly.fromRational({ n: r.n, d: r.d }, r.ord);
    return out;
  }

  /* ── special values of the elementary functions ─────────────────────── */
  var KNOWN_VALUES = (function () {
    var m = [];
    function add(name, arg, value) { m.push({ f: name, arg: AE.parse(arg), v: value }); }
    add('sin', '0', 0); add('cos', '0', 1); add('tan', '0', 0);
    add('sin', 'pi', 0); add('cos', 'pi', -1); add('tan', 'pi', 0);
    add('sin', 'pi/2', 1); add('cos', 'pi/2', 0);
    add('sin', '-pi/2', -1); add('cos', '-pi/2', 0);
    add('sin', 'pi/6', '1/2'); add('cos', 'pi/6', 'sqrt(3)/2'); add('tan', 'pi/6', 'sqrt(3)/3');
    add('sin', 'pi/4', 'sqrt(2)/2'); add('cos', 'pi/4', 'sqrt(2)/2'); add('tan', 'pi/4', 1);
    add('sin', 'pi/3', 'sqrt(3)/2'); add('cos', 'pi/3', '1/2'); add('tan', 'pi/3', 'sqrt(3)');
    add('sinh', '0', 0); add('cosh', '0', 1); add('tanh', '0', 0);
    add('asin', '0', 0); add('acos', '1', 0); add('atan', '0', 0); add('atan', '1', 'pi/4');
    add('exp', '0', 1); add('ln', '1', 0); add('ln', 'e', 1);
    return m;
  }());

  /* ── the rule engine ────────────────────────────────────────────────── */
  function size(e) { return E.size(e); }

  function tryRuleSet(e) {
    var i, out;
    switch (e.t) {
      case 'fun': {
        var name = e.name, a = e.args;
        if (a.length === 1) {
          // exact values
          for (i = 0; i < KNOWN_VALUES.length; i++) {
            var kv = KNOWN_VALUES[i];
            if (kv.f === name && E.eqq(a[0], kv.arg)) {
              return typeof kv.v === 'number' ? E.int(kv.v) : AE.parse(kv.v);
            }
          }
          // involution pairs
          if (name === 'ln' && E.isFun(a[0], 'exp')) return a[0].args[0];
          if (name === 'exp' && E.isFun(a[0], 'ln')) return a[0].args[0];
          if (name === 'sin' && E.isFun(a[0], 'asin')) return a[0].args[0];
          if (name === 'cos' && E.isFun(a[0], 'acos')) return a[0].args[0];
          if (name === 'tan' && E.isFun(a[0], 'atan')) return a[0].args[0];
          if (name === 'atan' && E.isFun(a[0], 'tan')) return a[0].args[0];
          if (name === 'abs') {
            if (a[0].t === 'num') return E.num(a[0].v.abs());
            if (E.isFun(a[0], 'abs')) return a[0];
            if (a[0].t === 'pow' && a[0].e.t === 'num' && a[0].e.v.d === 2n && a[0].b.t === 'num' && a[0].b.v.sign() >= 0) return a[0];
          }
          if (name === 'erf' && a[0].t === 'num' && a[0].v.isZero()) return E.ZERO;
          var neg = isOddNegated(a[0]);
          if (neg) {
            if (name === 'sin' || name === 'tan' || name === 'sinh' || name === 'tanh' ||
              name === 'asin' || name === 'atan' || name === 'asinh') {
              return E.neg(E.fun(name, [neg]));
            }
            if (name === 'cos' || name === 'cosh') return E.fun(name, [neg]);
          }
        }
        if (name === 'min' || name === 'max' || name === 'gcd' || name === 'lcm') {
          if (a.length === 1) return a[0];
        }
        return null;
      }
      case 'pow': {
        var b = e.b, ex = e.e;
        // (x^2)^(1/2) → |x| is wrong in general; sqrt(x)^2 → x is right for x ≥ 0
        if (ex.t === 'num' && ex.v.isInt() && b.t === 'fun' && b.name === 'sqrt' && Number(ex.v.n) === 2) return b.args[0];
        if (ex.t === 'num' && ex.v.isInt() && Number(ex.v.n) === 2 && b.t === 'pow' && b.e.t === 'num' && b.e.v.d === 2n) {
          var nb = Math.abs(Number(b.e.v.n));
          if (nb % 2 === 1) return E.pow(b.b, E.num(Rat.int(nb)));
        }
        if (b.t === 'fun' && b.name === 'exp' && b.args.length === 1) {
          return E.fun('exp', [E.mul(b.args[0], ex)]);
        }
        return null;
      }
      case 'mul': {
        // collect exp(a)·exp(b)
        var exps = [], coeffs = [], other = [];
        for (i = 0; i < e.args.length; i++) {
          var f = e.args[i];
          if (f.t === 'fun' && f.name === 'exp') exps.push(f.args[0]);
          else other.push(f);
        }
        if (exps.length >= 2) {
          var sum = E.add.apply(null, exps);
          return E.mul(E.fun('exp', [simplify(sum)]), other.length ? E.mul.apply(null, other) : E.ONE);
        }
        return null;
      }
      case 'add': {
        // sin²+cos² → 1 and friends
        if (e.args.length === 2) {
          var t0 = e.args[0], t1 = e.args[1];
          var pair = trigPair(t0, t1);
          if (pair) return pair;
        }
        return null;
      }
      default: return null;
    }
  }
  function isOddNegated(e) {
    if (e.t === 'mul' && e.args[0].t === 'num' && e.args[0].v.eq(Rat.MONE) && e.args.length === 2) return e.args[1];
    return null;
  }
  function trigPair(t0, t1) {
    var forms = [
      ['sin', 'cos', E.ONE], ['cos', 'sin', E.ONE],
      ['tan', null, null], ['sinh', 'cosh', null]
    ];
    // sin^2(u) + cos^2(u) = 1 ; cos^2 - sin^2 stays ; sec^2 - tan^2 = 1
    function sqOf(t) {
      if (t.t === 'pow' && t.e.t === 'num' && t.e.v.isInt() && Number(t.e.v.n) === 2) return t;
      return null;
    }
    var p0 = sqOf(t0), p1 = sqOf(t1), i;
    if (p0 && p1) {
      for (i = 0; i < 2; i++) {
        var A = i === 0 ? p0 : p1, B = i === 0 ? p1 : p0;
        if (A.b.t === 'fun' && B.b.t === 'fun' && E.eqq(A.b.args[0], B.b.args[0])) {
          var na = A.b.name, nb = B.b.name;
          if ((na === 'sin' && nb === 'cos') || (na === 'cos' && nb === 'sin')) return E.ONE;
          if (na === 'sinh' && nb === 'cosh') return E.int(-1);
          if (na === 'cosh' && nb === 'sinh') return E.ONE;
          if (na === 'sec' && nb === 'tan') return E.ONE;
          if (na === 'tan' && nb === 'sec') return E.int(-1);
        }
      }
    }
    return null;
  }

  /* ── the simplifier ─────────────────────────────────────────────────── */
  var DEPTH = 0;
  function simplify(e, opts) {
    opts = opts || {};
    if (DEPTH > 60) return e;
    DEPTH++;
    try {
      return simplify0(e, opts);
    } finally { DEPTH--; }
  }
  function simplify0(e, opts) {
    // 1. children first
    e = E.rewrite(e, function (n) { return n; });   // normalise structurally
    switch (e.t) {
      case 'add': {
        var terms = [], i;
        for (i = 0; i < e.args.length; i++) terms.push(simplify(e.args[i], opts));
        e = E.add.apply(null, terms); break;
      }
      case 'mul': {
        var facs = [];
        for (i = 0; i < e.args.length; i++) facs.push(simplify(e.args[i], opts));
        e = E.mul.apply(null, facs); break;
      }
      case 'pow': e = E.pow(simplify(e.b, opts), simplify(e.e, opts)); break;
      case 'fun':
        if (e.name === 'diff' || e.name === 'D') break;
        var args2 = [];
        for (i = 0; i < e.args.length; i++) args2.push(simplify(e.args[i], opts));
        if (e.name === 'sqrt' || e.name === 'root' || e.name === 'sum' || e.name === 'product') {
          // keep special forms structurally intact
          e = nameToNode(e.name, args2);
        } else {
          e = E.fun(e.name, args2);
        }
        break;
      case 'der': e = E.deriv(simplify(e.f, opts), e.x, e.n); break;
      case 'int': e = E.integ(simplify(e.f, opts), e.x); break;
      default: break;
    }
    // 3. rule tables
    var before = size(e);
    var r = tryRuleSet(e);
    if (r !== null && size(r) <= before + 2) e = r;

    // 4. cancellation through the polynomial engine, only if it helps
    if (!opts.noCancel && (e.t === 'add' || e.t === 'mul' || e.t === 'pow') && e.t !== 'num' && e.t !== 'sym') {
      if (hasQuotient(e)) {
        var out = viaRational(e);
        if (out !== null && size(out) < size(e)) e = out;
      }
    }
    if (e.t === 'add' || e.t === 'mul') {
      var g = gcdExtract(e);
      if (g !== null && size(g) < size(e)) e = g;
    }
    return e;
  }
  function nameToNode(name, args) {
    if (name === 'sqrt') return E.pow(args[0], E.rational(1, 2));
    if (name === 'root') return E.pow(args[0], E.div(E.ONE, args[1]));
    return E.fun(name, args);
  }
  function hasQuotient(e) {
    var found = false;
    E.walk(e, function (n) {
      if (n.t === 'pow' && n.e.t === 'num' && n.e.v.sign() < 0) found = true;
    });
    return found;
  }
  function viaRational(e) {
    try {
      var ord = [], budget = { n: 0 };
      var r = MPoly.toRational(e, ord, budget);
      if (MPoly.terms(r.n) > 600 || MPoly.terms(r.d) > 600) return null;
      var g = MPoly.gcd(r.n, r.d, ord);
      if (!(MPoly.isRat(g) && g.isOne())) {
        r = { n: MPoly.div(r.n, g, ord), d: MPoly.div(r.d, g, ord) };
      }
      var c = MPoly.canonFraction(r.n, r.d, ord);
      return MPoly.fromRational({ n: c.n, d: c.d }, ord);
    } catch (err) {
      return null;
    }
  }
  /* pull out a common multiplier from a sum: 2x + 2y → 2(x+y) is *not* always
     nicer, so only do it when the shared part is non-trivial */
  function gcdExtract(e) {
    if (e.t !== 'add' || e.args.length < 2) return null;
    try {
      var divisor = e.args[0], ok = true;
      for (var i = 1; i < e.args.length; i++) {
        if (!dividesCleanly(e.args[i], divisor)) { ok = false; break; }
      }
      if (!ok || E.isNum(divisor) || hasFractionalCoeff(divisor)) return null;
      if (E.size(divisor) < 2) return null;
      var terms = e.args.map(function (t) { return quotientOf(t, divisor); });
      var inner = E.add.apply(null, terms);
      return E.mul(divisor, inner);
    } catch (err) { return null; }
  }
  /* a factor is only worth pulling out if the quotient stays free of fractions:
     x²+2x → x(x+2) yes,  x²e^x+2xe^x → 2x(x/2+1)e^x no. */
  function hasFractionalCoeffDivisor(e) { return hasFractionalCoeff(e); }
  function hasFractionalCoeff(e) {
    var bad = false;
    E.walk(e, function (n) { if (n.t === 'num' && n.v.d !== 1n) bad = true; });
    return bad;
  }
  function dividesCleanly(a, b) {
    if (E.eqq(a, b)) return true;
    var q = viaRational(E.div(a, b));
    if (q === null) return false;
    if (hasQuotient(q) || hasFractionalCoeff(q)) return false;
    return true;
  }
  function quotientOf(a, b) {
    var q = viaRational(E.div(a, b));
    return q === null ? E.div(a, b) : q;
  }

  /* ── partial fractions (needed by the integrator) ───────────────────── */
  function upExtendedGcd(a, b) {
    var old = [a, new UP([Rat.ONE]), UP.zero()];
    var cur = [b, UP.zero(), new UP([Rat.ONE])], q, tmp;
    while (!cur[0].isZero()) {
      q = old[0].divmod(cur[0]).q;
      tmp = [old[0].sub(q.mul(cur[0])), old[1].sub(q.mul(cur[1])), old[2].sub(q.mul(cur[2]))];
      old = cur; cur = tmp;
    }
    return old;   // [gcd, s, t] with s·a + t·b = gcd
  }
  /* apart(N, D, x) → [ [numeratorPoly, factorPoly, multiplicity], quotientUP ] */
  function apartPolys(N, D, x) {
    var terms = [];
    var dm = N.divmod(D);
    var quotient = dm.q, rem = dm.r;
    if (rem.isZero()) return { poly: quotient, terms: terms };
    var fac = AE.factor.UP(D).factors;
    var currentD = D;
    for (var i = 0; i < fac.length && !rem.isZero(); i++) {
      var f = fac[i].poly, mult = fac[i].mult;
      var powDown = new UP([Rat.ONE]);
      for (var j = 0; j < mult; j++) powDown = powDown.mul(f);
      if (powDown.isConst()) continue;
      var rest = currentD.div(powDown);
      if (rest.isConst()) rest = new UP([Rat.ONE]);
      // solve s·powDown + t·rest = rem  (coprime)
      var eg = upExtendedGcd(powDown, rest);
      var scale = rem.divmod(eg[0]);
      if (!scale.r.isZero()) continue;      // should not happen: gcd = 1
      var s = eg[1].mul(scale.q), t = eg[2].mul(scale.q);
      // t/powDown → split into pieces of degree < deg f
      var tail = t;                          // contributes Σ a_k(x)/f^(mult-k)
      var power = mult;
      while (power > 0 && !tail.isZero()) {
        var d2 = tail.divmod(f);
        var residue = d2.r;
        if (!residue.isZero()) terms.push({ num: residue, den: f, mult: power });
        tail = d2.q;
        power--;
      }
      rem = s;                               // remaining part: s/rest
      currentD = rest;
      if (rem.isZero()) break;
    }
    if (!rem.isZero()) terms.push({ num: rem, den: currentD, mult: 1 });
    return { poly: quotient, terms: terms };
  }
  /* expression version */
  function apart(e, x) {
    x = x || (E.freeVars(e)[0] || E.sym('x'));
    var ord = [x];
    try {
      var r = MPoly.toRational(e, ord, { n: 0 });
      if (MPoly.isRat(r.d)) return MPoly.fromPoly(r.n, ord);
      var N = AE.factor.toUP ? AE.factor.toUP(r.n, x) : null;
      var D = AE.factor.toUP ? AE.factor.toUP(r.d, x) : null;
      if (N === null || D === null) return together(e);
      var res = apartPolys(N, D, x);
      var parts = [];
      if (!res.poly.isZero()) parts.push(res.poly.toExpr(x));
      for (var i = 0; i < res.terms.length; i++) {
        var t = res.terms[i];
        parts.push(E.div(t.num.toExpr(x), E.pow(t.den.toExpr(x), E.int(t.mult))));
      }
      return parts.length ? E.add.apply(null, parts) : together(e);
    } catch (err) {
      return together(e);
    }
  }

  AE.simplify = {
    simplify: simplify, expand: expand, together: together, apart: apart,
    apartPolys: apartPolys, numer: numer, denom: denom, cancelDivide: cancelDivide,
    rational: rational, upExtendedGcd: upExtendedGcd, tryRuleSet: tryRuleSet
  };

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function S(s) { return AE.print.text(simplify(AE.parse(s))); }
  function X(s) { return AE.print.text(expand(AE.parse(s))); }

  U.test('simplify', 'expansion', function (a) {
    a.eq(X('(x+1)^2'), 'x^2 + 2*x + 1', 'square');
    a.eq(X('(x+1)*(x-1)'), 'x^2 - 1', 'product');
    a.eq(X('(x+y)^3'), 'x^3 + 3*x^2*y + 3*x*y^2 + y^3', 'binomial cube');
    a.eq(X('x*(x+1)'), 'x^2 + x', 'distribute');
    a.eq(X('(x+1)^0'), '1', 'zeroth power');
    a.eq(X('2*(x+y)'), '2*x + 2*y', 'constant multiple');
  });

  U.test('simplify', 'rules', function (a) {
    a.eq(S('sin(pi)'), '0', 'sin pi');
    a.eq(S('cos(pi/3)'), '1/2', 'cos pi/3');
    a.eq(S('sqrt(3)^2'), '3', 'root square');
    a.eq(S('ln(exp(x))'), 'x', 'inverse functions');
    a.eq(S('exp(x)*exp(y)'), 'exp(x + y)', 'product of exponentials');
    a.eq(S('sin(x)^2+cos(x)^2'), '1', 'Pythagoras');
    a.eq(S('sin(-x)'), '-sin(x)', 'odd functions');
    a.eq(S('cos(-x)'), 'cos(x)', 'even functions');
    a.eq(S('abs(-3)'), '3', 'absolute value');
    a.eq(S('0*x'), '0', 'zero');
    a.eq(S('1*x'), 'x', 'one');
    a.eq(S('x^0'), '1', 'power zero');
    a.eq(S('x^1'), 'x', 'power one');
    a.eq(S('x-x'), '0', 'self difference');
    a.eq(S('x/x'), '1', 'self quotient');
  });

  U.test('simplify', 'rational cancellation', function (a) {
    a.eq(S('(x^2-1)/(x-1)'), 'x + 1', 'cancel');
    a.eq(S('(x^2-y^2)/(x+y)'), 'x - y', 'two variables');
    a.eq(AE.print.text(together(AE.parse('1/x+1/(x+1)'))), '(2*x + 1)/(x^2 + x)', 'together');
    a.eq(S('x/(x^2+x)'), '1/(x + 1)', 'common factor');
    a.eq(S('sin(x)/sin(x)'), '1', 'transcendental atom');
    a.eq(S('(x*y)/(y*z)'), 'x/z', 'monomial');
    a.eq(S('(a*b+a*c)/a'), 'b + c', 'extract divisor');
  });

  U.test('simplify', 'partial fractions', function (a) {
    function AP(s) { return AE.print.text(apart(AE.parse(s))); }
    a.eq(AP('1/(x^2-1)'), '-1/(2*(x + 1)) + 1/(2*(x - 1))', 'distinct linear factors');
    a.eq(AP('1/((x-1)*(x-2))'), '1/(x - 2) - 1/(x - 1)', 'two poles');
    a.eq(AP('(x+1)/(x^2-1)'), '1/(x - 1)', 'numerator cancels first');
    a.eq(AP('1/(x^2+1)'), '1/(x^2 + 1)', 'irreducible stays whole');
    a.eq(AP('x^2/(x-1)'), 'x + 1/(x - 1) + 1', 'polynomial part extracted');
    a.ok(E.eqq(AE.simplify.together(AE.parse('x^2/(x-1)')), AE.simplify.together(AE.parse('x + 1/(x-1) + 1'))), 'partial fractions equal the original');
    a.eq(AP('1/(x*(x+1))'), '-1/(x + 1) + 1/x', 'simple poles');
  });

  U.test('simplify', 'nothing is ever approximated', function (a) {
    a.eq(S('sqrt(2)*sqrt(2)'), '2', 'irrational squares exactly');
    a.eq(S('2^(1/2)'), 'sqrt(2)', 'keeps symbolic');
    a.eq(S('1/3+1/6'), '1/2', 'rational arithmetic exact');
    var big = AE.parse('2^100');
    a.eq(AE.print.text(big), '1267650600228229401496703205376', '2^100 exactly');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
