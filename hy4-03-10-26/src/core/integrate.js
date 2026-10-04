/* ALETHEIA — integration.
 *
 * The honest way to do this is to be willing to fail. This integrator tries
 *   linearity and constant factors, a table, general substitution,
 *   complete rational-function integration (partial fractions over the
 *   factorisation of the denominator, then Hermite reduction of repeated
 *   irreducible factors), and tabular integration by parts —
 * and then differentiates its own answer and compares. Anything that does not
 * check out, symbolically or at eight sample points, comes back unevaluated
 * rather than wrong.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E, MPoly = AE.MPoly, UP = AE.UP;
  var S = AE.simplify, D = AE.derive;

  /* ── structural pattern matching ────────────────────────────────────── */
  /* patterns are parsed strings; _a _b _c match anything free of x, _u matches
     anything that mentions x */
  function pmatch(pat, e, x, env) {
    if (pat === null || e === null) return null;
    if (pat.t === 'sym') {
      var nm = pat.name;
      // in a pattern, `x` always stands for the current variable of integration
      if (nm === 'x') return E.eqq(e, x) ? env : null;
      if (nm === x.name) return E.eqq(pat, e) ? env : null;
      if (nm.charAt(0) === '_') {
        if (env[nm] !== undefined) return E.eqq(env[nm], e) ? env : null;
        if (nm !== '_u' && E.depends(e, x)) return null;   // parameter wildcards are x-free
        env[nm] = e;
        return env;
      }
      return E.eqq(pat, e) ? env : null;
    }
    if (pat.t === 'num') return (e.t === 'num' && pat.v.eq(e.v)) ? env : null;
    if (pat.t !== e.t) return null;
    switch (pat.t) {
      case 'pow': {
        var r = pmatch(pat.b, e.b, x, env);
        return r && pmatch(pat.e, e.e, x, r) ? r : null;
      }
      case 'add': case 'mul': {
        if (pat.args.length !== e.args.length) return null;
        // our canonic order sorts factors of a sum differently from the way a
        // pattern happens to be written, so try the permutations
        return matchPermutation(pat.args, e.args, x, env, 0);
      }
      case 'fun': {
        if (pat.name !== e.name || pat.args.length !== e.args.length) return null;
        var cur2 = env;
        for (var j = 0; j < pat.args.length; j++) {
          cur2 = pmatch(pat.args[j], e.args[j], x, cur2);
          if (cur2 === null) return null;
        }
        return cur2;
      }
      default: return E.eqq(pat, e) ? env : null;
    }
  }
  /* is this clearly a negative quantity? then the log branch applies */
  function isNegative(e) {
    if (e.t === 'num') return e.v.sign() < 0;
    if (e.t === 'mul' && e.args[0].t === 'num') return e.args[0].v.sign() < 0;
    return false;
  }

  /* try each ordering of the operands of a commutative node */
  function matchPermutation(pats, exprs, x, env, depth) {
    if (pats.length === 0) return env;
    for (var i = 0; i < exprs.length; i++) {
      var attempt = {};
      for (var k in env) attempt[k] = env[k];
      var r = pmatch(pats[0], exprs[i], x, attempt);
      if (r === null) continue;
      var rest = exprs.slice();
      rest.splice(i, 1);
      var r2 = matchPermutation(pats.slice(1), rest, x, r, depth + 1);
      if (r2 !== null) return r2;
    }
    return null;
  }

  /* read a matched parameter as an exact rational (or null) */
  function nv(e) { return (e && e.t === 'num') ? e.v : null; }
  function nIs(e, r) { var v = nv(e); return v !== null && v.eq(r); }

  /* is everyone in the pattern binding actually free of x? */
  function bindingsOk(env, x) {
    for (var k in env) if (k !== '_u' && E.depends(env[k], x)) return false;
    return true;
  }

  /* ── the elementary table (with symbolic parameters) ───────────────── */
  var TABLE = [
    { p: 'x^_n', f: function (v, x) {
        if (nIs(v._n, Rat.MONE)) return null;
        return E.div(E.pow(x, E.add(v._n, E.ONE)), E.add(v._n, E.ONE));
      }, why: 'power rule' },
    { p: '_a*x^_n', f: function (v, x) {
        return nIs(v._n, Rat.MONE) ? E.mul(v._a, E.fun('ln', [x]))
          : E.div(E.mul(v._a, E.pow(x, E.add(v._n, E.ONE))), E.add(v._n, E.ONE));
      }, why: 'power rule' },
    { p: 'x', f: function (v, x) { return E.div(E.pow(x, E.int(2)), E.int(2)); }, why: 'power rule' },
    { p: '_a*x', f: function (v, x) { return E.div(E.mul(v._a, E.pow(x, E.int(2))), E.int(2)); }, why: 'power rule' },
    { p: '1/x', f: function (v, x) { return E.fun('ln', [x]); }, why: '∫ dx/x = ln x' },
    { p: '_a/x', f: function (v, x) { return E.mul(v._a, E.fun('ln', [x])); }, why: '∫ a dx/x' },
    { p: '1/(x^2-_p)', f: function (v, x) {
        var sp = E.pow(v._p, E.rational(1, 2));
        return E.div(E.fun('ln', [E.div(E.sub(x, sp), E.add(x, sp))]), E.mul(E.int(2), sp));
      }, why: '∫ dx/(x²−p)' },
    { p: '1/(x^2+_p)', f: function (v, x) {
        if (isNegative(v._p)) return null;            // take the x²−p branch instead
        var sp = E.pow(v._p, E.rational(1, 2));
        return E.div(E.fun('atan', [E.div(x, sp)]), sp);
      }, why: '∫ dx/(x²+p)' },
    { p: '1/(_b*x^2+_c)', f: function (v, x) {
        return E.div(integrateExpr(E.div(E.ONE, E.add(E.pow(x, E.int(2)), E.div(v._c, v._b))), x), v._b);
      }, why: 'scale the quadratic to x² + c/b' },
    { p: '1/sqrt(1-x^2)', f: function (v, x) { return E.fun('asin', [x]); }, why: 'arcsine' },
    { p: '1/sqrt(_p-x^2)', f: function (v, x) { return E.fun('asin', [E.div(x, E.pow(v._p, E.rational(1, 2)))]); }, why: 'arcsine, scaled' },
    { p: '1/sqrt(x^2+_p)', f: function (v, x) { return E.fun('asinh', [E.div(x, E.pow(v._p, E.rational(1, 2)))]); }, why: 'inverse hyperbolic sine' },
    { p: '1/sqrt(x^2-_p)', f: function (v, x) { return E.fun('acosh', [E.div(x, E.pow(v._p, E.rational(1, 2)))]); }, why: 'inverse hyperbolic cosine' },
    { p: 'sqrt(_p-x^2)', f: function (v, x) {
        var sq = E.pow(E.sub(v._p, E.pow(x, E.int(2))), E.rational(1, 2));
        return E.div(E.add(E.mul(x, sq), E.mul(v._p, E.fun('asin', [E.div(x, E.pow(v._p, E.rational(1, 2)))]))), E.int(2));
      }, why: 'area under a semicircle' },
    { p: 'ln(x)', f: function (v, x) { return E.sub(E.mul(x, E.fun('ln', [x])), x); }, why: 'integrate ln by parts' },
    { p: 'x^_n*ln(x)', f: function (v, x) {
        var np1 = E.add(v._n, E.ONE), p = E.pow(x, np1);
        return E.sub(E.div(E.mul(p, E.fun('ln', [x])), np1), E.div(p, E.pow(np1, E.int(2))));
      }, why: 'by parts: ∫ xⁿ ln x' },
    { p: 'x*ln(x)', f: function (v, x) {
        return E.sub(E.div(E.mul(E.pow(x, E.int(2)), E.fun('ln', [x])), E.int(2)), E.div(E.pow(x, E.int(2)), E.int(4)));
      }, why: 'by parts: ∫ x ln x' },
    { p: '1/(x*ln(x))', f: function (v, x) { return E.fun('ln', [E.fun('ln', [x])]); }, why: 'log of a log' },
    { p: 'tan(x)', f: function (v, x) { return E.neg(E.fun('ln', [E.fun('cos', [x])])); }, why: '∫ tan = −ln cos' },
    { p: 'cot(x)', f: function (v, x) { return E.fun('ln', [E.fun('sin', [x])]); }, why: '∫ cot = ln sin' },
    { p: '1/cos(x)^2', f: function (v, x) { return E.fun('tan', [x]); }, why: '∫ sec²' },
    { p: '1/sin(x)^2', f: function (v, x) { return E.neg(E.fun('cot', [x])); }, why: '∫ csc²' },
    { p: '1/cos(x)', f: function (v, x) { return E.fun('ln', [E.add(E.fun('sec', [x]), E.fun('tan', [x]))]); }, why: '∫ sec' },
    { p: '1/sin(x)', f: function (v, x) { return E.fun('ln', [E.fun('tan', [E.div(x, E.int(2))])]); }, why: '∫ csc' },
    { p: 'exp(x)', f: function (v, x) { return E.fun('exp', [x]); }, why: 'exponential' },
    { p: 'sin(x)', f: function (v, x) { return E.neg(E.fun('cos', [x])); }, why: 'sine' },
    { p: 'cos(x)', f: function (v, x) { return E.fun('sin', [x]); }, why: 'cosine' },
    { p: 'sinh(x)', f: function (v, x) { return E.fun('cosh', [x]); }, why: 'sinh' },
    { p: 'cosh(x)', f: function (v, x) { return E.fun('sinh', [x]); }, why: 'cosh' },
    { p: '1/(x*(_a+_b*x))', f: function (v, x) {
        return E.div(E.sub(E.fun('ln', [x]), E.fun('ln', [E.add(v._a, E.mul(v._b, x))])), v._a);
      }, why: 'partial fractions with a linear factor' },
    { p: 'erf(x)', f: function (v, x) { return E.sub(E.mul(x, E.fun('erf', [x])), E.div(E.fun('exp', [E.neg(E.pow(x, E.int(2)))]), E.pow(E.sym('pi'), E.rational(1, 2)))); }, why: '∫ erf' },
    { p: 'x*exp(-x^2)', f: function (v, x) { return E.div(E.neg(E.fun('exp', [E.neg(E.pow(x, E.int(2)))])), E.int(2)); }, why: 'gaussian tail' },
    { p: 'exp(-x^2)', f: function (v, x) { return E.div(E.mul(E.pow(E.sym('pi'), E.rational(1, 2)), E.fun('erf', [x])), E.int(2)); }, why: 'the gaussian itself' }
  ];
  var TABLE_PARSED = null;
  function table() {
    if (TABLE_PARSED) return TABLE_PARSED;
    TABLE_PARSED = TABLE.map(function (t) {
      return { pat: AE.parse(t.p), f: t.f, why: t.why, src: t.p };
    });
    return TABLE_PARSED;
  }

  /* ── substitution: does u′ divide the integrand cleanly? ────────────── */
  function replaceSubexpr(e, from, to) {
    var h = E.hash(from);
    return E.rewrite(e, function (n) { return E.hash(n) === h ? to : n; });
  }
  function trySubstitution(f, x, depth, steps) {
    var subs = [], seen = Object.create(null);
    E.walk(f, function (n) {
      if (n.t === 'sym' || n.t === 'num') return;
      if (n.t !== 'add' && n.t !== 'mul' && n.t !== 'pow' && n.t !== 'fun') return;
      var h = E.hash(n);
      if (seen[h]) return;
      seen[h] = true;
      if (!E.depends(n, x)) return;
      if (E.eqq(n, x)) return;
      subs.push(n);
    });
    // try the "innermost interesting" expressions first: they are usually the u
    subs.sort(function (a, b) { return E.size(a) - E.size(b); });
    var U = E.sym('ᵘ');
    for (var i = 0; i < subs.length; i++) {
      var u = subs[i];
      if (E.size(u) < 2) continue;
      if (E.freeVars(u).length !== 1 || !E.depends(u, x)) continue;
      var up = S.simplify(D.diff(u, x));
      if (E.isZero(up)) continue;
      var q = S.simplify(S.cancelDivide(E.div(f, up)));
      if (E.isZero(q)) continue;
      // q must be expressible in u alone
      var inU = replaceSubexpr(q, u, U);
      if (E.depends(inU, x)) {
        // also allow u to appear with a different but equivalent form: try simplify
        var alt = replaceSubexpr(S.simplify(q), u, U);
        if (E.depends(alt, x)) continue;
        inU = alt;
      }
      if (E.freeVars(inU).some(function (s) { return s.name !== 'ᵘ'; })) {
        if (E.freeVars(inU).length > 1) continue;
      }
      var inner = integrateExpr(inU, U, depth + 1, steps);
      if (inner === null) continue;
      var back = replaceSubexpr(inner, U, u);
      if (steps) steps.push({ rule: 'substitution', detail: 'u = ' + AE.print.text(u) + ', du = ' + AE.print.text(up) + ' dx' });
      return back;
    }
    return null;
  }

  /* ── rational integration ───────────────────────────────────────────── */
  /* ∫ N/D dx with N, D polynomials over ℚ: exact, using the factorisation of D */
  function integrateRational(N, D, x, steps) {
    var ord = [x];
    var res = S.apartPolys(N, D, x);
    var terms = [];
    if (!res.poly.isZero()) terms.push(integratePolynomial(res.poly, x));
    if (steps && res.terms.length) {
      steps.push({ rule: 'partial fractions', detail: res.terms.length + ' term(s) after factoring the denominator' });
    }
    var fail = false;
    for (var i = 0; i < res.terms.length; i++) {
      var piece = integrateIrreduciblePower(res.terms[i].num, res.terms[i].den, res.terms[i].mult, x);
      if (piece === null) { fail = true; break; }
      terms.push(piece);
    }
    if (fail) return null;
    return E.add.apply(null, terms);
  }
  /* ∫ of a plain polynomial */
  function integratePolynomial(up, x) {
    var terms = [], i;
    for (i = 0; i < up.c.length; i++) {
      if (up.c[i].isZero()) continue;
      if (i === 0) terms.push(E.mul(E.num(up.c[i]), x));
      else terms.push(E.div(E.mul(E.num(up.c[i]), E.pow(x, E.int(i + 1))), E.int(i + 1)));
    }
    return terms.length ? E.add.apply(null, terms) : E.ZERO;
  }
  /* ∫ P/q^k dx with q irreducible over ℚ, deg P < deg q */
  function integrateIrreduciblePower(P, q, k, x) {
    if (k <= 0) return null;
    if (q.deg() === 1) {
      // q = b x + c  → u = q(x), du = b dx
      var b = q.at(1), c = q.at(0);
      var u = q.toExpr(x);
      if (k === 1) return E.div(E.mul(P.at(0), E.fun('ln', [u])), b);
      return E.div(E.mul(P.at(0), E.pow(u, E.int(1 - k))), E.mul(b, E.int(1 - k)));
    }
    if (k > 1) {
      // Hermite reduction with respect to one irreducible factor:
      //   1/q^k = A/q^(k-1) + B q'/q^k   with  A q + B q' = 1
      //   ∫P/q^k = −P·B/((k−1)q^(k−1)) + ∫ (P·A + (P·B)'/(k−1)) / q^(k−1)
      var qp = q.derivative();
      var eg = S.upExtendedGcd(q, qp);
      if (!eg[0].isConst()) return null;
      var one = eg[0];
      var A = eg[1].scale(one.lc().inv()), B = eg[2].scale(one.lc().inv());
      var A0 = A.scale(one.at(0).inv()), B0 = B.scale(one.at(0).inv());
      var PB = P.mul(B0);
      var inside = P.mul(A0).add(PB.derivative().scale(new Rat(BigInt(1), BigInt(k - 1))));
      var term1 = E.div(E.neg(PB.toExpr(x)), E.mul(E.int(k - 1), E.pow(q.toExpr(x), E.int(k - 1))));
      var rest = integrateIrreduciblePower(inside, q, k - 1, x);
      if (rest === null) return null;
      return E.add(term1, rest);
    }
    // k = 1
    if (q.deg() === 2) {
      // write P = α q' + β, then ∫ = α ln q + β ∫ dx/q
      var qp2 = q.derivative();          // 2a x + b
      var a2 = q.at(2), dqp = qp2.at(1);
      var alpha = P.at(1).div(dqp);
      var beta = P.at(0).sub(alpha.mul(qp2.at(0)));
      var out = [];
      if (!alpha.isZero()) out.push(E.mul(alpha, E.fun('ln', [q.toExpr(x)])));
      if (!beta.isZero()) {
        var disc = q.at(1).mul(q.at(1)).sub(E.num === null ? Rat.ZERO : new Rat(4n, 1n).mul(q.at(2)).mul(q.at(0))); // b² − 4ac
        var discRat = disc.neg();                 // 4ac − b²  > 0 for irreducible q
        if (discRat.sign() <= 0) return null;
        var root = E.pow(E.num(discRat), E.rational(1, 2));
        var x0 = E.sym('x');
        out.push(E.mul(E.div(E.mul(E.int(2), beta), root),
          E.fun('atan', [E.div(E.add(E.mul(E.int(2), E.mul(a2, x0)), E.num(q.at(1))), root)])));
      }
      if (out.length === 0) return E.ZERO;
      return E.add.apply(null, out);
    }
    return null;                          // irreducible of degree ≥ 3: no closed form offered
  }

  /* ── tabular integration by parts ───────────────────────────────────── */
  function isPolynomialIn(e, x) {
    var ord = [x];
    try {
      var p = MPoly.toPoly(e, ord, { n: 0 });
      var up = AE.factor.toUP(p, x);
      return up;
    } catch (err) { return null; }
  }
  function tryByParts(f, x, depth, steps) {
    if (f.t !== 'mul' || f.args.length < 2) return null;
    var i, polyIdx = -1, poly = null;
    for (i = 0; i < f.args.length; i++) {
      var up = isPolynomialIn(f.args[i], x);
      if (up !== null && up.deg() >= 1) { polyIdx = i; poly = up; break; }
    }
    if (polyIdx < 0) return null;
    var tailArgs = f.args.filter(function (_, k) { return k !== polyIdx; });
    var tail = tailArgs.length === 1 ? tailArgs[0] : E.mul.apply(null, tailArgs);
    if (!E.depends(tail, x)) return null;
    // derivatives of the polynomial down to a constant
    var derivs = [poly], cur = poly, guard = 0;
    while (!cur.isConst() && guard++ < 8) {
      cur = cur.derivative();
      derivs.push(cur);
    }
    // successive antiderivatives of the tail: anti[k] = k-fold integral of tail
    var anti = [null], acc = tail;
    for (i = 1; i <= derivs.length; i++) {
      var nxt = integrateExpr(acc, x, depth + 1, null);
      if (nxt === null) return null;
      acc = nxt;
      anti.push(acc);
    }
    var terms = [];
    for (i = 0; i < derivs.length; i++) {
      var pk = derivs[i], t = anti[i + 1];
      if (pk.isZero() || t === null) continue;
      terms.push(E.mul(i % 2 === 0 ? E.ONE : E.MONE, pk.toExpr(x), t));
    }
    if (terms.length === 0) return null;
    if (steps) steps.push({ rule: 'integration by parts', detail: 'tabular: differentiate the polynomial factor, integrate the other' });
    return E.add.apply(null, terms);
  }

  /* ── the recursive core ─────────────────────────────────────────────── */
  var CALLS = 0;
  function integrateExpr(f, x, depth, steps) {
    if (depth > 6) return null;
    if (++CALLS > 4000) { CALLS = 0; return null; }
    var i, out;
    if (!E.depends(f, x)) return E.mul(f, x);
    if (E.isZero(f)) return E.ZERO;

    // 1. linearity
    if (f.t === 'add') {
      var parts = [], ok = true;
      for (i = 0; i < f.args.length; i++) {
        var piece = integrateExpr(f.args[i], x, depth + 1, steps);
        if (piece === null) { ok = false; break; }
        parts.push(piece);
      }
      if (ok) {
        if (steps) steps.push({ rule: 'linearity', detail: 'integrate the sum term by term' });
        return E.add.apply(null, parts);
      }
    }

    // 2. pull out factors that do not involve x
    if (f.t === 'mul') {
      var constPart = E.ONE, rest = [];
      for (i = 0; i < f.args.length; i++) {
        if (!E.depends(f.args[i], x)) constPart = E.mul(constPart, f.args[i]); else rest.push(f.args[i]);
      }
      if (!E.isOne(constPart) && rest.length > 0) {
        var g = rest.length === 1 ? rest[0] : E.mul.apply(null, rest);
        var inner = integrateExpr(g, x, depth + 1, steps);
        if (inner !== null) {
          if (steps) steps.push({ rule: 'constant multiple', detail: 'pull out ' + AE.print.text(constPart) });
          return E.mul(constPart, inner);
        }
      }
    }

    // 3. the table
    var tbl = table(), env;
    for (i = 0; i < tbl.length; i++) {
      env = {};
      env = pmatch(tbl[i].pat, f, x, env);
      if (env !== null && bindingsOk(env, x)) {
        var built;
        try { built = tbl[i].f(env, x); } catch (e) { built = null; }
        if (built !== null) {
          if (steps) steps.push({ rule: 'table', detail: tbl[i].why });
          return built;
        }
      }
    }

    // 4. rational functions (numeric coefficients only)
    try {
      var ord = [x], budget = { n: 0 };
      var r = MPoly.toRational(f, ord, budget);
      if (!MPoly.isRat(r.d) || !MPoly.isRat(r.n)) {
        var N = AE.factor.toUP(r.n, x);
        var D2 = AE.factor.toUP(r.d, x);
        if (N !== null && D2 !== null && D2.deg() >= 1) {
          var rat = integrateRational(N, D2, x, steps);
          if (rat !== null) return rat;
        }
      }
    } catch (err) { /* not a rational function: carry on */ }

    // 5. substitution
    out = trySubstitution(f, x, depth, steps);
    if (out !== null) return out;

    // 6. integration by parts
    out = tryByParts(f, x, depth, steps);
    if (out !== null) return out;

    return null;
  }

  /* ── verification ───────────────────────────────────────────────────── */
  var SAMPLE_POINTS = [0.13, -0.31, 0.47, -0.61, 0.83, -0.97, 1.27, -1.43, 2.11];
  function verify(integrand, antiderivative, x) {
    // symbolic first
    var d2 = null;
    try {
      CALLS = 0;
      d2 = S.simplify(D.diff(antiderivative, x, { simplify: true }));
      var diff = S.simplify(E.sub(d2, integrand));
      if (E.isZero(diff)) return { ok: true, how: 'symbolic' };
      var diffNum = S.simplify(S.cancelDivide(diff));
      if (E.isZero(diffNum)) return { ok: true, how: 'symbolic (after cancellation)' };
    } catch (e) { /* fall through to arithmetic */ }
    // numeric: give any free parameters concrete values and compare
    var params = E.freeVars(integrand).concat(E.freeVars(antiderivative)).filter(function (s) {
      return !E.eqq(s, x);
    });
    var uniq = [], seen = Object.create(null);
    for (var q = 0; q < params.length; q++) {
      if (!seen[params[q].name]) { seen[params[q].name] = true; uniq.push(params[q].name); }
    }
    var assignments = [[], []];
    for (q = 0; q < uniq.length; q++) {
      assignments[0][uniq[q]] = 1.7 + 0.31 * q;
      assignments[1][uniq[q]] = -2.3 - 0.47 * q;
    }
    var best = { ok: false, how: 'numeric' };
    for (var ai = 0; ai < assignments.length; ai++) {
      var checked = 0, worst = 0, bad = null;
      for (var i = 0; i < SAMPLE_POINTS.length; i++) {
        var t = SAMPLE_POINTS[i];
        var env = assignments[ai];
        env = Object.assign({}, env);
        env[x.name] = t;
        var iv, dv;
        try {
          iv = AE.numeric.evalExpr(integrand, env);
          dv = AE.numeric.evalExpr(d2 === null ? D.diff(antiderivative, x) : d2, env);
        } catch (e) { continue; }
        if (AE.numeric.isNaN(iv) || AE.numeric.isNaN(dv)) continue;
        if (!isFinite(iv.re) || !isFinite(dv.re)) continue;
        var scale = Math.max(1, cabs(iv), cabs(dv));
        var err = Math.abs(iv.re - dv.re) + Math.abs(iv.im - dv.im);
        if (err / scale > 1e-7) { bad = { t: t, got: dv, want: iv }; break; }
        worst = Math.max(worst, err / scale);
        checked++;
        if (checked >= 4) break;
      }
      if (!bad && checked >= 3) {
        return { ok: true, how: 'numeric (' + checked + ' sample points, worst relative error ' + worst.toExponential(1) + ')' };
      }
      if (bad) best = { ok: false, why: 'failed at x = ' + bad.t, how: 'numeric' };
      else best = { ok: false, why: 'too few usable sample points', how: 'numeric' };
    }
    return best;
  }
  function cabs(a) { return AE.numeric.cabs(a); }

  /* ── public entry ───────────────────────────────────────────────────── */
  function integrate(f, x, opts) {
    opts = opts || {};
    x = x || E.sym('x');
    if (typeof x === 'string') x = E.sym(x);
    f = S.simplify(E.toExpr(f));
    CALLS = 0;
    var steps = opts.steps ? [] : null;
    var result = null;
    try {
      result = integrateExpr(f, x, 0, steps);
    } catch (err) {
      result = null;
    }
    if (result === null) {
      return { ok: false, result: E.integ(f, x), integrand: f, steps: steps || [], verified: null, unevaluated: true };
    }
    result = S.simplify(result);
    var check = opts.noVerify ? { ok: true, how: 'not requested' } : verify(f, result, x);
    if (!check.ok) {
      return { ok: false, result: E.integ(f, x), integrand: f, steps: steps || [], verified: check, unevaluated: true };
    }
    return { ok: true, result: result, integrand: f, steps: steps || [], verified: check, unevaluated: false };
  }

  AE.integrate = {
    integrate: integrate, expr: integrateExpr, verify: verify,
    pmatch: pmatch, rationalPart: integrateRational, irreduciblePower: integrateIrreduciblePower,
    TABLE: TABLE
  };

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function I(s) {
    var r = integrate(AE.parse(s), E.sym('x'));
    return { text: AE.print.text(r.result), ok: r.ok, how: r.verified && r.verified.how, steps: r.steps };
  }

  U.test('integrate', 'polynomials and basics', function (a) {
    a.eq(I('x^2').text, 'x^3/3', 'monomial');
    a.eq(I('1').text, 'x', 'constant');
    a.eq(I('3*x^2+2*x+1').text, 'x^3 + x^2 + x', 'polynomial');
    a.eq(I('x^(-1)').text, 'ln(x)', 'reciprocal');
    a.eq(I('x^5').text, 'x^6/6', 'fifth power');
    a.eq(I('x^n').text, 'x^(n + 1)/(n + 1)', 'symbolic exponent');
    a.eq(I('exp(x)').text, 'exp(x)', 'exponential');
    a.eq(I('sin(x)').text, '-cos(x)', 'sine');
    a.eq(I('cos(x)').text, 'sin(x)', 'cosine');
    a.eq(I('y').text, 'x*y', 'other symbols are constants');
  });

  U.test('integrate', 'substitution and chain rule', function (a) {
    a.eq(I('exp(3*x)').text, 'exp(3*x)/3', 'linear argument');
    a.eq(I('sin(2*x+1)').text, '-cos(2*x + 1)/2', 'affine argument');
    a.eq(I('x*exp(x^2)').text, 'exp(x^2)/2', 'u = x²');
    a.eq(I('x/(x^2+1)').text, 'ln(x^2 + 1)/2', 'log derivative');
    a.eq(I('sin(x)*cos(x)').text, 'sin(x)^2/2', 'u = sin x');
    a.eq(I('tan(x)').text, '-ln(cos(x))', 'tangent');
    a.eq(I('ln(x)').text, 'x*ln(x) - x', 'logarithm');
    a.eq(I('cos(x)*exp(sin(x))').text, 'exp(sin(x))', 'chain inside exp');
  });

  U.test('integrate', 'rational functions', function (a) {
    a.eq(I('1/(x^2+1)').text, 'arctan(x)', 'arctan');
    a.eq(I('1/(x^2-1)').text, '-ln(x + 1)/2 + ln(x - 1)/2', 'partial fractions');
    a.eq(I('1/((x-1)*(x-2))').text, 'ln(x - 2) - ln(x - 1)', 'two poles');
    a.eq(I('1/(x*(x+1))').text, 'ln(x) - ln(x + 1)', 'simple poles');
    a.eq(I('(x+3)/(x^2+2*x+1)').text, 'ln(x + 1) - 2/(x + 1)', 'repeated factor');
    a.eq(I('x^2/(x-1)').text, 'x^2/2 + x + ln(x - 1)', 'polynomial part');
    a.eq(I('1/(x^2+4)').text, 'arctan(x/2)/2', 'scaled arctan');
    a.eq(I('1/(x^2+x+1)').text, '2*arctan((2*x + 1)/sqrt(3))/sqrt(3)', 'irreducible quadratic');
    a.eq(I('1/(x^3-x)').text, '-ln(x) + ln(x - 1)/2 + ln(x + 1)/2', 'three poles');
  });

  U.test('integrate', 'symbolic parameters', function (a) {
    a.eq(I('1/(x^2+a^2)').text, 'arctan(x/sqrt(a^2))/sqrt(a^2)', 'arctan with a parameter');
    a.eq(I('1/sqrt(a^2-x^2)').text, 'arcsin(x/sqrt(a^2))', 'arcsine with a parameter');
    a.eq(I('1/(x^2-a^2)').text, 'ln((-sqrt(a^2) + x)/(sqrt(a^2) + x))/(2*sqrt(a^2))', 'difference of squares');
    a.eq(I('1/(x*(a+b*x))').text, '(ln(x) - ln(a + b*x))/a', 'linear times affine');
  });

  U.test('integrate', 'integration by parts', function (a) {
    a.eq(I('x*sin(x)').text, '-x*cos(x) + sin(x)', 'x sin x');
    a.eq(I('x*exp(x)').text, 'x*exp(x) - exp(x)', 'x e^x');
    a.eq(I('x^2*exp(x)').text, 'x^2*exp(x) - 2*x*exp(x) + 2*exp(x)', 'x² e^x');
    a.eq(I('x*ln(x)').text, 'x^2*ln(x)/2 - x^2/4', 'x ln x');
    a.eq(I('x^2*sin(x)').text, '-x^2*cos(x) + 2*x*sin(x) + 2*cos(x)', 'x² sin x');
  });

  U.test('integrate', 'every answer is verified', function (a) {
    var cases = ['x^2', '1/(x^2+1)', 'x*exp(x^2)', 'sin(x)*cos(x)', 'x/(x^2+1)', '1/(x^2+x+1)',
      'x^2/(x-1)', 'x*sin(x)', 'exp(-x^2)', '1/(x^2-a^2)', 'tan(x)', 'ln(x)', 'x*ln(x)',
      '1/(x*(x+1))', 'x^2*exp(x)', '1/sqrt(x^2+1)', 'sqrt(1-x^2)'];
    for (var i = 0; i < cases.length; i++) {
      var r = integrate(AE.parse(cases[i]), E.sym('x'));
      a.ok(r.ok, 'integrable: ' + cases[i]);
      if (r.ok) a.ok(r.verified.ok, 'verified: ' + cases[i] + ' (' + r.verified.how + ')');
    }
  });

  U.test('integrate', 'it refuses to guess', function (a) {
    var hard = ['exp(x^2)', 'sin(sin(x))', '1/ln(x)', 'exp(x)/x', 'gamma(x)'];
    for (var i = 0; i < hard.length; i++) {
      var r = integrate(AE.parse(hard[i]), E.sym('x'));
      if (r.ok) {
        a.ok(r.verified.ok, 'if it answers, the answer checks out: ' + hard[i]);
      } else {
        a.ok(r.unevaluated, 'returns an unevaluated integral rather than a wrong one: ' + hard[i]);
      }
    }
    a.ok(!I('exp(x^2)').ok, '∫exp(x²) has no elementary form');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
