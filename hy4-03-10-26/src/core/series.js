/* ALETHEIA — limits and power series.
 *
 * A truncated Laurent series is a floor `(the first exponent)`, a window of
 * coefficients, and a ceiling `(the truncation O(xⁿ))`. Everything else — the
 * arithmetic, the chain rule for functions of functions, limits — is built on
 * three operations: multiply, divide, and substitute.
 *
 * Because the coefficients are themselves exact expressions rather than
 * floats, `sin(x)/x` at x = 0 does not evaluate to something approximately 1:
 * it expands, cancels the x, and reads off 1. The O(xⁿ) at the end is not
 * decoration — it records exactly how much was thrown away.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, E = AE.E, Rat = AE.Rat;

  var ZERO = E.ZERO, ONE = E.ONE;

  /* ── the series itself ─────────────────────────────────────────────── */
  function Series(n0, coeffs, trunc) {
    this.n0 = n0;
    this.c = coeffs;                       // coefficients at exponents n0, n0+1, …
    this.trunc = trunc === undefined ? n0 + coeffs.length : trunc;
    this.trim();
  }
  Series.prototype.trim = function () {
    var i;
    while (this.c.length && E.isZero(AE.simplify.simplify(this.c[0]))) {
      this.c.shift(); this.n0++;
    }
    /* trailing zeros are known zeros, so the truncation bound does not shrink */
    while (this.c.length) {
      var last = AE.simplify.simplify(this.c[this.c.length - 1]);
      if (E.isZero(last)) this.c.pop();
      else break;
    }
    if (this.c.length === 0) this.c = [ZERO];      // a zero *known* up to O(x^trunc)
    return this;
  };
  Series.prototype.get = function (k) {
    var i = k - this.n0;
    if (i < 0 || i >= this.c.length) return ZERO;
    return this.c[i];
  };
  Series.prototype.set = function (k, v) {
    var i = k - this.n0;
    if (i < 0) { this.c = new Array(-i).fill(ZERO).concat(this.c); this.n0 += i; i = 0; }
    while (i >= this.c.length) this.c.push(ZERO);
    this.c[i] = v;
    return this;
  };
  Series.prototype.slice = function (trunc) {
    var out = new Series(this.n0, [], trunc);
    for (var k = this.n0; k < trunc; k++) {
      if (k - this.n0 >= this.c.length) break;
      out.set(k, this.c[k - this.n0]);
    }
    return out.trim();
  };
  Series.prototype.copy = function () {
    return new Series(this.n0, this.c.slice(), this.trunc);
  };
  Series.prototype.isZero = function () { return this.c.length === 0 || E.isZero(this.c[0]); };
  Series.prototype.toString = function () { return toExpr(this, E.sym('x')); };

  function constant(e) { return new Series(0, [e], 1e9); }
  function zeroSeries(n0) { return new Series(n0 === undefined ? 0 : n0, [ZERO], 1e9); }
  function isConstant(s) { return s.c.length === 1 && s.n0 === 0; }
  function constOf(s) { return s.c.length === 1 && s.n0 === 0 ? s.c[0] : null; }

  /* ── arithmetic ────────────────────────────────────────────────────── */
  function addS(a, b, trunc) {
    trunc = trunc || Math.min(a.trunc, b.trunc);
    var lo = Math.min(a.n0, b.n0), out = new Series(lo, [], trunc), k;
    for (k = lo; k < trunc; k++) {
      var v = AE.simplify.simplify(E.add(a.get(k), b.get(k)));
      if (!E.isZero(v)) out.set(k, v);
    }
    return out.trim();
  }
  function negS(a, trunc) {
    return new Series(a.n0, a.c.map(function (v) { return E.neg(v); }), a.trunc);
  }
  function mulS(a, b, trunc) {
    trunc = trunc === undefined ? Math.min(a.trunc, b.trunc) : trunc;
    var lo = a.n0 + b.n0, out = new Series(lo, [], trunc), i, j;
    for (i = a.n0; i < trunc - b.n0 && i - a.n0 < a.c.length; i++) {
      var ai = a.get(i);
      if (E.isZero(ai)) continue;
      for (j = b.n0; j < trunc - i && j - b.n0 < b.c.length; j++) {
        if (E.isZero(b.get(j))) continue;
        out.set(i + j, AE.simplify.simplify(E.add(out.get(i + j), E.mul(ai, b.get(j)))));
      }
    }
    return out.trim();
  }
  /* 1 / a, valid when the leading coefficient is invertible: if a·b = 1 then
     a₀b_k = −Σ_{i>a₀} a_i·b_{k−i}, so solve for b one coefficient at a time. */
  function invS(a, trunc) {
    trunc = trunc === undefined ? a.trunc : trunc;
    if (a.n0 !== 0) {                 // pull out the leading power of x first
      var shifted = new Series(0, a.c.slice(), a.trunc - a.n0);
      var invShifted = invS(shifted, trunc - a.n0);
      return new Series(invShifted.n0 - a.n0, invShifted.c, invShifted.trunc - a.n0).slice(trunc);
    }
    var a0 = a.get(a.n0);
    if (E.isZero(a0)) throw new Error('series inversion: zero leading coefficient');
    var out = new Series(-a.n0, [], trunc), j, i;
    out.set(-a.n0, AE.simplify.simplify(E.div(ONE, a0)));
    for (j = -a.n0 + 1; j < trunc; j++) {
      var keq = j + a.n0;                       // which product a·b = 1 equation
      var acc = ZERO;
      for (i = a.n0 + 1; i <= keq + a.n0 && i - a.n0 < a.c.length; i++) {
        var ai = a.get(i);
        if (E.isZero(ai)) continue;
        acc = E.add(acc, E.mul(ai, out.get(keq - i)));
      }
      out.set(j, AE.simplify.simplify(E.neg(E.div(AE.simplify.simplify(acc), a0))));
    }
    return out.slice(trunc);
  }
  function divS(a, b, trunc) {
    trunc = trunc === undefined ? Math.min(a.trunc, b.trunc) : trunc;
    if (isConstant(b) && !E.isZero(b.c[0])) {
      var s = new Series(a.n0, a.c.map(function (v) { return AE.simplify.simplify(E.div(v, b.c[0])); }), a.trunc);
      return s.slice(trunc);
    }
    return mulS(a, invS(b, trunc), trunc);
  }
  /* a^r: repeated multiplication for integers, the binomial series otherwise */
  function powSeries(a, r, trunc) {
    trunc = trunc === undefined ? a.trunc : trunc;
    var rE = typeof r === 'number' ? E.num(Rat.fromFloat(r)) : r;
    if (rE.t === 'num' && rE.v.isInt()) {
      var n = Number(rE.v.n), out = new Series(0, [ONE], trunc), i0;
      if (n < 0) return powSeries(invS(a, trunc), E.num(Rat.int(-n)), trunc);
      for (i0 = 0; i0 < n; i0++) out = mulS(out, a, trunc);
      return out.slice(trunc);
    }
    if (a.n0 !== 0) {
      // pull out the leading monomial x^a.n0 so the binomial series starts at 1
      if (rE.t !== 'num' || !rE.v.mul(Rat.int(a.n0)).isInt()) {
        throw new Error('series power: fractional power of x');
      }
      var shiftAlan = Number(rE.v.mul(Rat.int(a.n0)).n);
      var innerP = powSeries(new Series(0, a.c.slice(), a.trunc - a.n0), rE, trunc - a.n0);
      return new Series(innerP.n0 + shiftAlan, innerP.c, innerP.trunc + shiftAlan).slice(trunc);
    }
    var lead = a.get(0);
    if (E.isZero(lead)) throw new Error('series power: no leading term');
    var unit = new Series(0, a.c.map(function (v) { return AE.simplify.simplify(E.div(v, lead)); }), a.trunc);
    var w = new Series(1, unit.c.slice(1), unit.trunc);
    var acc2 = new Series(0, [ONE], trunc), term = new Series(0, [ONE], trunc), k2;
    for (k2 = 1; k2 < trunc; k2++) {
      term = mulS(term, w, trunc);
      if (term.isZero()) break;
      var factor = AE.simplify.simplify(E.div(E.sub(rE, E.int(k2 - 1)), E.num(Rat.int(k2))));
      if (E.isZero(factor)) continue;
      acc2 = addS(acc2, new Series(term.n0, term.c.map(function (v) {
        return AE.simplify.simplify(E.mul(v, factor));
      }), term.trunc), trunc);
    }
    var pref = AE.simplify.simplify(E.pow(lead, rE));
    return new Series(acc2.n0, acc2.c.map(function (v) { return AE.simplify.simplify(E.mul(v, pref)); }), acc2.trunc).slice(trunc);
  }
  function integrateSeries(a) {              // ∫ a dx, no constant term
    var out = new Series(a.n0 + 1, [], a.trunc + 1), k;
    for (k = a.n0; k < a.trunc && k - a.n0 < a.c.length; k++) {
      var den = E.num(Rat.int(k + 1));
      out.set(k + 1, AE.simplify.simplify(E.div(a.get(k), den)));
    }
    return out.slice(a.trunc + 1);
  }
  function diffSeries(a) {
    var out = new Series(a.n0 - 1, [], a.trunc - 1), k;
    for (k = a.n0; k < a.trunc && k - a.n0 < a.c.length; k++) {
      out.set(k - 1, AE.simplify.simplify(E.mul(a.get(k), E.num(Rat.int(k)))));
    }
    return out.slice(a.trunc - 1);
  }
  /* outer(inner(x)) with inner(0) = 0 — used for odd compositions */
  function composeSeries(outer, inner, trunc) {
    var sum = new Series(0, [ZERO], trunc), k3;
    for (k3 = outer.n0; k3 < Math.min(outer.trunc, trunc); k3++) {
      var cf = outer.get(k3);
      if (E.isZero(cf) || k3 < 0) continue;
      var pw2 = k3 === 0 ? new Series(0, [ONE], trunc) : powSeries(inner, E.num(Rat.int(k3)), trunc);
      sum = addS(sum, new Series(pw2.n0, pw2.c.map(function (v) {
        return AE.simplify.simplify(E.mul(v, cf));
      }), pw2.trunc), trunc);
    }
    return sum.slice(trunc);
  }

  /* ── elementary functions of a series ──────────────────────────────── */
  function expS(u, trunc) {
    trunc = trunc === undefined ? u.trunc : trunc;
    var u0 = constOf(u);
    if (u0 !== null) return constant(E.fun('exp', [u0]));
    if (u.n0 < 0) throw new Error('exp of a Laurent series with a pole');
    var base = u.n0 === 0 ? u.get(0) : E.ZERO;
    var w = u.n0 === 0 ? new Series(1, u.c.slice(1), u.trunc) : u;   // u = base + w
    // y = exp(w): y′ = w′·y, y(0) = 1
    var wp = diffSeries(w), y = new Series(0, [ONE], trunc), k, i;
    for (k = 1; k < trunc; k++) {
      var acc = ZERO;
      for (i = 1; i <= k; i++) {
        var f = wp.get(i - 1);
        if (E.isZero(f)) continue;
        acc = E.add(acc, E.mul(f, y.get(k - i)));
      }
      y.set(k, AE.simplify.simplify(E.div(AE.simplify.simplify(acc), E.num(Rat.int(k)))));
    }
    var pref = E.fun('exp', [base]);
    if (!E.isZero(base)) {
      y = new Series(y.n0, y.c.map(function (v) { return AE.simplify.simplify(E.mul(v, pref)); }), y.trunc);
    }
    return y.slice(trunc);
  }
  function logS(u, trunc) {
    trunc = trunc === undefined ? u.trunc : trunc;
    if (isConstant(u)) return constant(E.fun('ln', [u.c[0]]));
    if (u.n0 !== 0) throw new Error('logarithm of a series with a pole or zero: Laurent (ln x) not supported here');
    var base = u.get(0);
    if (E.isZero(base)) throw new Error('logarithm of a series vanishing at the point');
    var w = new Series(0, u.c.slice(), u.trunc);
    w.set(0, ZERO);
    w = divS(w, new Series(0, [base], 1e9), trunc);        // (u − u₀)/u₀
    // ln(1 + w)
    var out = new Series(0, [ZERO], trunc), term = new Series(0, [ONE], trunc), k;
    for (k = 1; k < trunc; k++) {
      term = mulS(term, w, trunc);
      var sgn = (k % 2 === 1) ? ONE : E.MONE;
      var addend = new Series(term.n0, term.c.map(function (v) {
        return AE.simplify.simplify(E.mul(sgn, E.div(v, E.num(Rat.int(k)))));
      }), term.trunc);
      out = addS(out, addend, trunc);
      if (term.isZero()) break;
    }
    out.set(0, E.fun('ln', [base]));
    return out.slice(trunc);
  }
  /* Functions we know through their differential equation: integrate y′, then
     add the constant f(u₀) which is computed once, symbolically. */
  var PRIMITIVE = {
    atan: function (u, tr) {
      return divS(diffSeries(u), addS(constant(ONE), mulS(u, u, tr), tr), tr);
    },
    atanh: function (u, tr) {
      return divS(diffSeries(u), addS(constant(ONE), negS(mulS(u, u, tr)), tr), tr);
    },
    asin: function (u, tr) {
      var rad = addS(constant(ONE), negS(mulS(u, u, tr)), tr);
      return divS(diffSeries(u), powSeries(rad, E.rational(1, 2), tr), tr);
    },
    acos: function (u, tr) {
      var rad2 = addS(constant(ONE), negS(mulS(u, u, tr)), tr);
      return negS(divS(diffSeries(u), powSeries(rad2, E.rational(1, 2), tr), tr));
    },
    asinh: function (u, tr) {
      var rad3 = addS(constant(ONE), mulS(u, u, tr), tr);
      return divS(diffSeries(u), powSeries(rad3, E.rational(1, 2), tr), tr);
    },
    acosh: function (u, tr) {
      var rad4 = addS(mulS(u, u, tr), negS(constant(ONE)), tr);
      return divS(diffSeries(u), powSeries(rad4, E.rational(1, 2), tr), tr);
    },
    erf: function (u, tr) {
      var gauss = expS(negS(mulS(u, u, tr)), tr);
      var twoOverSqrtPi = E.mul(E.int(2), E.div(ONE, E.pow(E.sym('pi'), E.rational(1, 2))));
      var factorS = new Series(0, [twoOverSqrtPi], tr);
      return mulS(diffSeries(u), mulS(gauss, factorS, tr), tr);
    }
  };
  function byODE(name, u, trunc) {
    var slope = PRIMITIVE[name](u, trunc);
    var y = integrateSeries(slope);
    y.set(0, E.fun(name, [u.get(0)]));
    return y.slice(trunc);
  }

  /* sin/cos pair: y′ = u′·z, z′ = −u′·y */
  function trigS(kind, u, trunc) {
    var base = u.get(0);
    var s0 = E.fun('sin', [base]), c0 = E.fun('cos', [base]);
    var du = diffSeries(u);
    var y = new Series(0, [s0], trunc), z = new Series(0, [c0], trunc), k, i;
    var zy = new Series(0, [c0], trunc), yy = new Series(0, [s0], trunc);
    for (k = 1; k < trunc; k++) {
      var accY = ZERO, accZ = ZERO;
      for (i = 1; i <= k; i++) {
        var f = du.get(i - 1);
        if (E.isZero(f)) continue;
        accY = E.add(accY, E.mul(f, zy.get(k - i)));
        accZ = E.sub(accZ, E.mul(f, yy.get(k - i)));
      }
      yy.set(k, AE.simplify.simplify(E.div(AE.simplify.simplify(accY), E.num(Rat.int(k)))));
      zy.set(k, AE.simplify.simplify(E.div(AE.simplify.simplify(accZ), E.num(Rat.int(k)))));
    }
    var hyp = kind === 'sinh' || kind === 'cosh';
    if (hyp) {
      // sinh′ = cosh·u′, cosh′ = sinh·u′  → same recurrence without the minus
      var sh = new Series(0, [E.fun('sinh', [base])], trunc), ch = new Series(0, [E.fun('cosh', [base])], trunc);
      for (k = 1; k < trunc; k++) {
        var accS = ZERO, accC = ZERO;
        for (i = 1; i <= k; i++) {
          var f2 = du.get(i - 1);
          if (E.isZero(f2)) continue;
          accS = E.add(accS, E.mul(f2, ch.get(k - i)));
          accC = E.add(accC, E.mul(f2, sh.get(k - i)));
        }
        sh.set(k, AE.simplify.simplify(E.div(AE.simplify.simplify(accS), E.num(Rat.int(k)))));
        ch.set(k, AE.simplify.simplify(E.div(AE.simplify.simplify(accC), E.num(Rat.int(k)))));
      }
      return (kind === 'sinh' ? sh : ch).slice(trunc);
    }
    return (kind === 'sin' ? yy : zy).slice(trunc);
  }
  /* sin/cos/sinh/cosh directly by the addition formula: cos(u₀+w)… */
  function basicTrig(name, u, trunc) {
    return trigS(name, u, trunc);
  }

  /* dispatch: turn an expression node into a series in t */
  function evalSeries(e, x, trunc, depth) {
    depth = depth || 0;
    if (depth > 40) throw new Error('series: too deep');
    if (!E.depends(e, x)) return constant(e);
    switch (e.t) {
      case 'add': {
        var acc = new Series(0, [ZERO], trunc), i;
        for (i = 0; i < e.args.length; i++) acc = addS(acc, evalSeries(e.args[i], x, trunc, depth + 1), trunc);
        return acc;
      }
      case 'mul': {
        var p = new Series(0, [ONE], trunc), nEG = false;
        for (i = 0; i < e.args.length; i++) {
          var f = evalSeries(e.args[i], x, trunc, depth + 1);
          p = mulS(p, f, trunc);
        }
        return p;
      }
      case 'pow': {
        var bse = evalSeries(e.b, x, trunc, depth + 1), ex = e.e;
        if (!E.depends(ex, x)) {
          if (ex.t === 'num' && ex.v.isInt()) return powSeries(bse, Number(ex.v.n), trunc);
          return powSeries(bse, ex.type ? ex : ex, trunc);
        }
        // x^x shape: exp(e·ln b)
        return expS(mulS(evalSeries(ex, x, trunc, depth + 1), logS(bse, trunc), trunc), trunc);
      }
      case 'fun': {
        var arg = evalSeries(e.args[0], x, trunc, depth + 1), nm = e.name;
        if (nm === 'sqrt') return powSeries(arg, E.rational(1, 2), trunc);
        if (nm === 'exp') return expS(arg, trunc);
        if (nm === 'ln' || nm === 'log') return logS(arg, trunc);
        if (nm === 'sin' || nm === 'cos' || nm === 'sinh' || nm === 'cosh') return basicTrig(nm, arg, trunc);
        if (nm === 'tan') return divS(trigS('sin', arg, trunc), trigS('cos', arg, trunc), trunc);
        if (nm === 'tanh') return divS(trigS('sinh', arg, trunc), trigS('cosh', arg, trunc), trunc);
        if (PRIMITIVE[nm]) return byODE(nm, arg, trunc);
        throw new Error('series: no expansion for ' + nm);
      }
      case 'sym': {
        if (E.eqq(e, x)) return new Series(1, [ONE], trunc);
        return constant(e);
      }
      default:
        throw new Error('series: cannot handle ' + e.t);
    }
  }
  /* ── series → expression ───────────────────────────────────────────── */
  function toExprSeries(s, v, opts) {
    opts = opts || {};
    var terms = [], k;
    for (k = s.n0; k < s.trunc && k - s.n0 < s.c.length; k++) {
      var c = s.c[k - s.n0];
      if (E.isZero(c)) continue;
      var mono = k === 0 ? c : (k === 1 ? E.mul(c, v) : E.mul(c, E.pow(v, E.num(Rat.int(k)))));
      terms.push(mono);
    }
    if (terms.length === 0) terms.push(ZERO);
    var out = E.add.apply(null, terms);
    if (opts.order !== false && s.trunc < 1e8) out = E.add(out, E.orderTerm(v, s.trunc));
    return out;
  }

  /* ── the public Taylor expansion ───────────────────────────────────── */
  /* Every operation costs a little precision at the top end: dividing by a
     series whose leading term is xⁿ loses n orders. Rather than track that
     through every rule, work a little deeper than asked and hand back only the
     terms that were requested. */
  var SLACK = 8;
  function taylor(expr, x, at, order) {
    x = x || E.sym('x');
    at = at === undefined ? E.ZERO : at;
    order = order === undefined ? 6 : order;
    var t = E.sym('%t' + U.hashSeed(E.hash(expr)).toString(36));
    var body = AE.simplify.simplify(E.subst(expr, x, E.add(at, t)));
    var deep = evalSeries(body, t, order + 1 + SLACK, 0);
    var s = deep.slice(order + 1);
    return {
      series: s, variable: x, point: at, temp: t, deeper: deep,
      expr: AE.simplify.simplify(E.subst(toExprSeries(s, t, { order: true }), t, E.sub(x, at)))
    };
  }

  /* ── limits ────────────────────────────────────────────────────────── */

  /* ── when there is no expansion: watch what the numbers do ─────────── */
  function safeEval(expr, x, value) {
    try {
      var env = {};
      env[x.name] = value;
      return AE.numeric.evalExpr(expr, env);
    } catch (err) { return null; }
  }
  function probeAt(expr, x, at, dir) {
    var i, pt, v, vals = [], mags = [];
    for (i = 0; i < 8; i++) {
      if (at.t === 'inf') {
        var mag = Math.pow(10, 3 + 1.5 * i) * at.s;
        if (dir === 'left') mag = -mag;
        v = safeEval(expr, x, mag);
      } else {
        var h = Math.pow(10, -1 - i);
        var centre = AE.numeric.evalExpr(at, {});
        if (!isFinite(centre.re)) return null;
        v = safeEval(expr, x, centre.re + (dir === 'left' ? -h : h));
      }
      if (v === null) break;
      if (Math.abs(v.im) > 1e-9 * Math.max(1, Math.abs(v.re))) break;
      if (!isFinite(v.re)) {
        if (vals.length >= 3) {
          var up = true, dn2 = true;
          for (var q = 1; q < vals.length; q++) {
            if (vals[q] <= vals[q - 1]) up = false;
            if (vals[q] >= vals[q - 1]) dn2 = false;
          }
          if (up || dn2) return { kind: 'infinite', sign: up ? 1 : -1, steps: vals };
        }
        break;
      }
      vals.push(v.re);
      mags.push(Math.abs(v.re));
    }
    if (vals.length < 2) return null;
    var n2 = vals.length;
    var last = vals[n2 - 1], prev = vals[n2 - 2], before = vals[n2 - 3];
    var scale = Math.max(1, Math.abs(last));
    /* flat enough: take it */
    if (vals.length >= 4 && Math.abs(last - prev) < 1e-11 * scale && Math.abs(prev - before) < 1e-8 * scale) {
      return { kind: 'finite', value: last, steps: vals };
    }
    /* or geometrically contracting: extrapolate the tail */
    var d1 = prev - before, d2 = last - prev;
    if (Math.abs(d2) < Math.abs(d1) * 0.6 && Math.abs(d1) > 0) {
      var ratio = d2 / d1;
      if (ratio > 0 && ratio < 0.95) {
        var extrapolated = last + d2 * ratio / (1 - ratio);
        return { kind: 'finite', value: extrapolated, steps: vals, extrapolated: true };
      }
    }
    /* growing without bound? */
    var grows = true;
    for (i = 1; i < mags.length; i++) if (mags[i] <= mags[i - 1]) grows = false;
    if (grows && mags[mags.length - 1] > 4 * mags[0] && mags[0] > 1) {
      return { kind: 'infinite', sign: vals[vals.length - 1] > 0 ? 1 : -1, steps: vals };
    }
    return null;
  }
  /* If the numbers land on 1.99999999999998 we say 2, and if they land on
     2.718281828459045 we say e — with the same caution a human would use. */
  function recognise(value) {
    if (!isFinite(value)) return null;
    if (Math.abs(value) < 1e-11) return E.ZERO;
    var candidates = [];
    var r = Rat.fromFloat(value, 1e-9);
    if (r !== null && Math.abs(r.toNumber() - value) < 1e-9 && r.den() <= 1000n) candidates.push(E.num(r));
    var smalls = [Math.PI, Math.E, Math.SQRT2, Math.SQRT3, Math.LN2, Math.LN10, Math.sqrt(Math.PI)];
    var names = [E.sym('pi'), E.sym('e'), E.pow(E.int(2), E.rational(1, 2)), E.pow(E.int(3), E.rational(1, 2)),
      E.fun('ln', [E.int(2)]), E.fun('ln', [E.int(10)]), E.pow(E.sym('pi'), E.rational(1, 2))];
    var i, k;
    for (i = 0; i < smalls.length; i++) {
      for (k = -8; k <= 8 && k !== 0; k++) {
        var scaled = value / (k * smalls[i]);
        if (Math.abs(scaled - Math.round(scaled)) < 1e-9 && Math.abs(scaled) < 1e4) {
          candidates.push(E.mul(E.num(Rat.int(Math.round(k * scaled))), names[i]));
          break;
        }
      }
    }
    for (i = 1; i < 4096; i++) {
      var sq = value * value;
      if (Math.abs(sq - i) < 1e-9) candidates.push(E.pow(E.num(Rat.int(i)), E.rational(1, 2)));
    }
    return candidates.length ? candidates[0] : null;
  }

  /* ── l'Hôpital: differentiate numerator and denominator until it settles ─ */
  function splitFraction(e) {
    try {
      var t2 = AE.simplify.together(e);
      return { n: AE.simplify.numer(t2), d: AE.simplify.denom(t2) };
    } catch (err) { return null; }
  }
  function lhopital(expr, x, at, depth) {
    depth = depth || 0;
    if (depth > 6) return null;
    var fr = splitFraction(expr);
    if (!fr) return null;
    /* 0·∞ is the same trap in disguise: rewrite f·g as g / (1/f) */
    if (E.isZero(AE.simplify.simplify(E.sub(fr.d, ONE))) && fr.n.t === 'mul') {
      var factors = fr.n.args, fi, small = null, big = null;
      var centreD = AE.numeric.evalExpr(at, {}).re;
      function probePair(d) { return at.t === 'inf' ? Math.pow(10, d) * at.s : centreD + Math.pow(10, d); }
      for (fi = 0; fi < factors.length; fi++) {
        var vNear = safeEval(factors[fi], x, probePair(-7));
        var vFar = safeEval(factors[fi], x, probePair(-13));
        if (vNear === null || vFar === null) continue;
        var a1 = Math.abs(vNear.re), a2 = Math.abs(vFar.re);
        if (!isFinite(a1) || !isFinite(a2)) continue;
        if (a2 < a1 * 0.5) { if (small === null) small = fi; }
        else if (a2 > a1 * 1.5 && a2 > 10) { if (big === null) big = fi; }
      }
      if (small !== null && big !== null && small !== big) {
        var restFactors = [];
        for (fi = 0; fi < factors.length; fi++) if (fi !== small) restFactors.push(factors[fi]);
        fr = { n: restFactors.length ? E.mul.apply(null, restFactors) : ONE, d: E.div(ONE, factors[small]) };
      }
    }
    var nv = AE.simplify.simplify(E.subst(fr.n, x, at)), dv = AE.simplify.simplify(E.subst(fr.d, x, at));
    try {
      var vn2 = AE.numeric.evalExpr(nv, {}).re, vd2 = AE.numeric.evalExpr(dv, {}).re;
      var bothZero = E.isZero(nv) && E.isZero(dv);
      var bothInf = !isFinite(vn2) && !isFinite(vd2);
      if (bothZero || bothInf) {
        var dn = AE.derive.diff(fr.n, x), dd = AE.derive.diff(fr.d, x);
        var ratio = AE.simplify.simplify(E.div(dn, dd));
        var r = limitHere(ratio, x, at, 'two', { quiet: true }, depth + 1);
        if (r.value !== null) {
          r.how = "l'Hôpital" + (depth + 1 > 1 ? ' applied ' + (depth + 1) + ' times' : '') + ': d/dx (' +
            AE.print.text(fr.n) + ') / d/dx (' + AE.print.text(fr.d) + ')';
          r.steps = (r.steps || []).concat([{ what: 'differentiate numerator and denominator', detail: AE.print.text(ratio) }]);
          return r;
        }
      }
    } catch (err) { return null; }
    return null;
  }

  function limitHere(expr, x, at, dir, opts, hopDepth) {
    opts = opts || {};
    dir = dir || 'two';
    hopDepth = hopDepth || 0;
    if (at === undefined) at = E.ZERO;
    /* ── 1. straight substitution, but only when it really is a value ──────
       In the expression language 0·ln(0) collapses to 0 and x/(e^x − 1) at 0
       collapses to 0 as well, so the raw substitution has to be checked for
       finiteness before we believe anything it says. */
    var rawAt = E.subst(expr, x, at);
    var rawNum = AE.numeric.evalExpr(rawAt, {});
    var direct = AE.simplify.simplify(rawAt);
    if (!E.depends(direct, x) && AE.numeric.finite(rawNum)) {
      return { value: direct, twoSided: true, how: 'continuous at the point', certain: true };
    }
    if (direct.t === 'inf') return { value: direct, twoSided: true, how: 'direct substitution', certain: true };

    /* ── 2. limits at ±∞ become limits at 0 under x = 1/t ─────────────── */
    if (at.t === 'inf') {
      var tv = E.sym('%u');
      var flipped = AE.simplify.simplify(E.subst(expr, x, E.div(ONE, tv)));
      var inner = limitHere(flipped, tv, E.ZERO, 'right', { silent: true }, hopDepth);
      if (inner && inner.value !== null) {
        return {
          value: inner.value, twoSided: true, certain: inner.certain,
          how: 'x = 1/t, then t → 0⁺', series: inner.series
        };
      }
    }

    /* ── 3. expand: the leading term decides everything ────────────────── */
    try {
      var ser = taylor(expr, x, at, opts.order || 8);
      var sr = ser.series;
      if (sr.n0 > 0) return { value: E.ZERO, twoSided: true, how: 'series: it all vanishes', certain: true, series: ser };
      if (sr.n0 === 0 && !E.depends(sr.c[0], x)) {
        var claimed = sr.c[0];
        /* Trust, but check: if the numbers flatly disagree, the "series" is
           nonsense (usually because something blew up inside it). */
        var check = probeAt(expr, x, at, dir === 'two' ? 'right' : dir);
        var claimNum = AE.numeric.evalExpr(claimed, {}).re;
        if (!isFinite(claimNum) || (check && check.kind === 'finite' &&
            Math.abs(check.value - claimNum) > 2e-2 * Math.max(1, Math.abs(claimNum)))) {
          seriesError = 'the expansion disagreed with the numbers';
        } else {
          return { value: claimed, twoSided: true, how: 'series: the constant term', certain: true, series: ser };
        }
      }
      if (sr.n0 < 0) {
        var lead = sr.c[0];
        var sgn = lead.t === 'num' ? lead.v.sign() : 1;
        if (sr.n0 % 2 === 0) {
          return { value: E.inf(sgn), twoSided: true, divergent: true, how: 'series: even-order pole', certain: true, series: ser };
        }
        return {
          value: null, twoSided: false, divergent: true, series: ser,
          right: E.inf(sgn), left: E.inf(-sgn),
          how: 'series: odd-order pole, so the two sides disagree', certain: true
        };
      }
    } catch (e2) {
      if (!opts.silent) seriesError = String(e2 && e2.message || e2);
    }

    /* ── 4. l'Hôpital, for the indeterminate forms series cannot reach ─── */
    var lh = lhopital(expr, x, at, hopDepth);
    if (lh && lh.value !== null) return lh;

    /* ── 5. and finally, watch the numbers ─────────────────────────────── */
    var probe = probeAt(expr, x, at, dir === 'two' ? 'right' : dir);
    if (probe && probe.kind === 'finite') {
      var other = probeAt(expr, x, at, 'left');
      var recognised = recognise(probe.value);
      if (!recognised && Math.abs(probe.value - Math.round(probe.value)) < 1e-6 * Math.max(1, Math.abs(probe.value))) {
        recognised = E.num(Rat.int(Math.round(probe.value)));
      }
      return {
        value: recognised || E.num(Rat.fromFloat(probe.value)), certain: !!recognised,
        numeric: probe.value,
        twoSided: !!(other && other.kind === 'finite' && Math.abs(other.value - probe.value) < 1e-6),
        how: recognised ? 'numerically, and the value is unmistakably ' + AE.print.text(recognised)
          : 'numerically' + (probe.extrapolated ? ' (extrapolated)' : '')
      };
    }
    if (probe && probe.kind === 'infinite') {
      var otherSide = probeAt(expr, x, at, dir === 'two' ? 'left' : (dir === 'left' ? 'right' : 'left'));
      if (otherSide && otherSide.kind === 'finite') {
        return {
          value: null, divergent: true, twoSided: false, certain: false,
          right: dir === 'left' ? recognise(otherSide.value) || E.num(Rat.fromFloat(otherSide.value)) : E.inf(probe.sign),
          left: dir === 'left' ? E.inf(probe.sign) : recognise(otherSide.value) || E.num(Rat.fromFloat(otherSide.value)),
          how: 'numerically: one side diverges, the other does not'
        };
      }
      return { value: E.inf(probe.sign), twoSided: false, divergent: true, certain: false, how: 'numerically: grows without bound' };
    }
    return { value: null, how: seriesError || 'no expansion found', certain: false };
  }
  function limit(expr, x, at, dir, opts) {
    return limitHere(expr, x || E.sym('x'), at === undefined ? E.ZERO : at, dir, opts, 0);
  }
  var seriesError = null;

  AE.series = {
    Series: Series, taylor: taylor, limit: limit,
    toExpr: toExprSeries, evalSeries: evalSeries,
    add: addS, mul: mulS, div: divS, inv: invS, pow: powSeries,
    exp: expS, log: logS, trig: basicTrig, compose: composeSeries,
    integrate: integrateSeries, differentiate: diffSeries, constant: constant
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;
  function p(s) { return AE.parse(s); }
  function show(s) { return AE.print.text(s); }
  function tay(s, n, at) {
    return show(taylor(p(s), E.sym('x'), at === undefined ? E.ZERO : AE.parse(String(at)), n === undefined ? 6 : n).expr);
  }

  U.test('series', 'Taylor expansions', function (a) {
    a.eq(tay('exp(x)', 5), 'x^5/120 + x^4/24 + x^3/6 + x^2/2 + x + O(x^6) + 1', 'exponential');
    a.eq(tay('sin(x)', 7), '-x^7/5040 + x^5/120 - x^3/6 + x + O(x^8)', 'sine');
    a.eq(tay('cos(x)', 6), '-x^6/720 + x^4/24 - x^2/2 + O(x^7) + 1', 'cosine');
    a.eq(tay('1/(1-x)', 5), 'x^5 + x^4 + x^3 + x^2 + x + O(x^6) + 1', 'geometric');
    a.eq(tay('ln(1+x)', 5), 'x^5/5 - x^4/4 + x^3/3 - x^2/2 + x + O(x^6)', 'logarithm');
    a.eq(tay('sqrt(1+x)', 4), '-5*x^4/8 - x^3/2 - x^2/4 + x/2 + O(x^5) + 1', 'binomial series');
    a.eq(tay('tan(x)', 7), '17*x^7/315 + 2*x^5/15 + x^3/3 + x + O(x^8)', 'tangent');
    a.eq(tay('atan(x)', 7), '-x^7/7 + x^5/5 - x^3/3 + x + O(x^8)', 'arctangent');
  });

  U.test('series', 'the chain rule, as arithmetic', function (a) {
    a.eq(tay('exp(x^2)', 8), 'x^8/24 + x^6/6 + x^4/2 + x^2 + O(x^9) + 1', 'composition');
    a.eq(tay('sin(x)*cos(x)', 6), '2*x^5/15 - 2*x^3/3 + x + O(x^7)', 'sin·cos = ½sin 2x');
    a.eq(tay('exp(x)*ln(1+x)', 4), 'x^3/3 + x^2/2 + x + O(x^5)', 'product of two series');
    a.eq(tay('1/(x+1)^2', 4), '5*x^4 - 4*x^3 + 3*x^2 - 2*x + O(x^5) + 1', 'reciprocal of a square');
    a.eq(tay('exp(sin(x))', 5), '-x^5/15 - x^4/8 + x^2/2 + x + O(x^6) + 1', 'exp∘sin');
    a.eq(tay('ln(cos(x))', 6), '-x^6/45 - x^4/12 - x^2/2 + O(x^7)', 'log of cos');
  });

  U.test('series', 'poles are Laurent series, and they cancel honestly', function (a) {
    a.eq(tay('1/x + x', 3), 'x + O(x^4) + 1/x', 'negative powers survive');
    a.eq(tay('sin(x)/x', 7), '-x^6/5040 + x^4/120 - x^2/6 + O(x^8) + 1', 'the pole disappears');
    a.eq(tay('1/sin(x)^2 - 1/x^2', 6), 'x^6/675 + 2*x^4/189 + x^2/15 + O(x^7) + 1/3', 'the famous 1/3');
    a.eq(tay('x/(exp(x)-1)', 7), 'x^6/30240 - x^4/720 + x^2/12 - x/2 + O(x^8) + 1', 'Bernoulli numbers, first three');
    // and they really are the Bernoulli numbers
    var co = taylor(p('x/(exp(x)-1)'), E.sym('x'), E.ZERO, 9).series;
    a.eq(show(co.get(2)), '1/12', 'B₂/2!');
    a.eq(show(co.get(4)), '-1/720', 'B₄/4!');
    a.eq(show(co.get(6)), '1/30240', 'B₆/6!');
  });

  U.test('series', 'around another point', function (a) {
    var r = taylor(p('sin(x)'), E.sym('x'), AE.parse('pi/6'), 5);
    a.eq(show(r.expr),
      'O((x - π/6)^6) + sqrt(3)*(x - π/6)^5/240 - sqrt(3)*(x - π/6)^3/12 + (x - π/6)^4/48 - (x - π/6)^2/4 + sqrt(3)*(x - π/6)/2 + 1/2',
      'sin about π/6');
    // numerically, the expansion really does track the function nearby
    var pt0 = 0.6236;                                  // π/6 + 0.1
    var approx = AE.numeric.evalExpr(
      E.subst(toExprSeries(r.series, E.sub(E.sym('x'), AE.parse('pi/6')), { order: false }),
        E.sym('x'), E.num(Rat.fromFloat(pt0))), {});
    a.ok(Math.abs(approx.re - Math.sin(pt0)) < 1e-7, 'agrees with sin near π/6');
    a.eq(tay('x^2', 4, 1), '(x - 1)^2 + O((x - 1)^5) + 2*(x - 1) + 1', 'parabola about 1');
  });

  U.test('series', 'limits', function (a) {
    function L(s, at, dir) {
      var pt = at === Infinity ? E.inf(1) : (at === -Infinity ? E.inf(-1) : (at === undefined ? E.ZERO : AE.parse(String(at))));
      var r = limit(p(s), E.sym('x'), pt, dir);
      return { text: r.value === null ? 'none' : show(r.value), two: r.twoSided, how: r.how, right: r.right && show(r.right), left: r.left && show(r.left) };
    }
    a.eq(L('sin(x)/x').text, '1', 'sin x / x');
    a.eq(L('(1-cos(x))/x^2').text, '1/2', '(1 − cos x)/x²');
    a.eq(L('(exp(x)-1)/x').text, '1', '(eˣ − 1)/x');
    a.eq(L('x/(exp(x)-1)').text, '1', 'the Bernoulli limit');
    a.eq(L('(x^2-1)/(x-1)', 1).text, '2', 'removable singularity');
    a.eq(L('x*ln(x)', 0, 'right').text, '0', 'x ln x, by l’Hôpital');
    a.eq(L('sqrt(x^2+1)-x', Infinity).text, '0', '√(x²+1) − x at ∞');
    a.eq(L('(2*x+1)/(x-1)', Infinity).text, '2', 'rational at infinity');
    a.eq(L('x*sin(1/x)', Infinity).text, '1', 'x sin(1/x) at ∞');
    a.eq(L('(1+1/x)^x', Infinity).text, 'exp(1)', 'the definition of e');
    a.eq(L('1/x^2').text, 'infinity', 'blows up');
    a.eq(L('1/x', 0).two, false, 'the two sides disagree');
    a.eq(L('1/x', 0).left + '|' + L('1/x', 0).right, '-infinity|infinity', 'and here they are');
    a.eq(L('exp(1/x)', 0).left, '0', 'exp(1/x) from the left');
    a.eq(L('exp(1/x)', 0).right, 'infinity', 'exp(1/x) from the right');
    a.eq(L('x^x', 0, 'right').text, '1', 'xˣ as x → 0⁺');
  });

  U.test('series', 'it refuses to guess', function (a) {
    // this one genuinely has no answer we can establish; silence beats a lie
    var r = limit(p('ln(ln(x))/ln(x)'), E.sym('x'), E.inf(1));
    a.eq(r.value, null, 'admits it does not know');
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
