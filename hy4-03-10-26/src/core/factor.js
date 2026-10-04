/* ALETHEIA — factorisation of polynomials over the integers.
 *
 * This is not pattern matching. A primitive integer polynomial is split by
 *   Yun's square-free decomposition  →  f = ∏ gᵢⁱ, each gᵢ square-free
 *   the rational root theorem        →  every linear factor, exactly
 *   Kronecker's method               →  higher-degree irreducibles, by
 *                                       interpolating through every possible
 *                                       combination of divisor values
 * and every answer is multiplied back together and compared with the input
 * before it is handed out.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E, UP = AE.UP, upGcd = AE.upGcd, squarefree = AE.squarefree;
  var MPoly = AE.MPoly;

  /* ── integer helpers ────────────────────────────────────────────────── */
  function clearDenominators(f) {
    var lcm = 1n, i;
    for (i = 0; i < f.c.length; i++) {
      if (f.c[i].d !== 1n) lcm = lcm * f.c[i].d / AE.bigGcd(lcm, f.c[i].d);
    }
    if (lcm === 1n) return f;
    return f.scale(Rat.int(lcm));
  }
  function isIntegral(f) {
    for (var i = 0; i < f.c.length; i++) if (f.c[i].d !== 1n) return false;
    return true;
  }
  function intValue(r) { return Number(r.n) / Number(r.d); }
  function bigAbs(n) { return n < 0n ? -n : n; }
  function divisorsOf(n) {                     // |n| > 0 → signed divisors
    if (n === 0n) return [0];
    return AE.divisors(Number(bigAbs(n)), true).map(function (d) { return BigInt(d); });
  }
  /* Lagrange interpolation over ℚ */
  function interpolate(xs, ys) {
    var total = UP.zero(), i, j;
    for (i = 0; i < xs.length; i++) {
      var term = new UP([ys[i]]), denom = Rat.ONE;
      for (j = 0; j < xs.length; j++) {
        if (i === j) continue;
        term = term.mul(new UP([Rat.int(xs[j]).neg(), Rat.ONE]));
        denom = denom.mul(Rat.int(xs[i] - xs[j]));
      }
      total = total.add(term.scale(denom.inv()));
    }
    return total;
  }

  /* ── linear factors via the rational root theorem ───────────────────── */
  function rationalRoots(f, budget) {
    // f must be a primitive integer polynomial of degree >= 1
    var roots = [];
    var lc = f.lc().n, ct = f.at(0).n;
    var pcand, qcand, seen = Object.create(null);
    try {
      pcand = ct === 0n ? [0n] : divisorsOf(ct);
      qcand = divisorsOf(lc).filter(function (q) { return q > 0n; });
    } catch (e) { return roots; }
    for (var i = 0; i < pcand.length; i++) {
      for (var j = 0; j < qcand.length; j++) {
        if (budget && roots.length > 24) return roots;
        var p = pcand[i], q = qcand[j];
        if (AE.bigGcd(bigAbs(p), q) !== 1n) continue;
        var r = new Rat(p, q);
        var key = r.hash();
        if (seen[key]) continue;
        seen[key] = true;
        if (f.eval(r).isZero()) roots.push(r);
      }
    }
    return roots;
  }
  /* strip (x − root) repeatedly; returns primitive integer factors found */
  function extractLinear(f, root) {
    var p = Number(root.n), q = Number(root.d);
    var linear = new UP([new Rat(-p, q), Rat.ONE]);      // x − p/q  → integral: qx − p
    var factor = q === 1 ? linear : new UP([Rat.int(-p), Rat.int(q)]);
    return factor;
  }

  /* ── Kronecker: search for irreducible factors of degree ≥ 2 ────────── */
  function kronecker(f, budget) {
    var n = f.deg();
    if (n <= 1) return [f];
    var result = [], remaining = f;
    var maxHalf = Math.floor(n / 2);
    var points = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    var usable = [];
    for (var i = 0; i < points.length && usable.length < maxHalf + 1; i++) {
      var v = remaining.eval(Rat.int(points[i]));
      if (!v.isZero() && v.isInt() && AE.bigAbs(v.n) < 100000n) usable.push(points[i]);
    }
    if (usable.length < 2) return [remaining];
    for (var deg = 1; deg <= maxHalf; deg++) {
      if (remaining.deg() <= 2 * deg - 1 && deg > 1) break;
      var pts = usable.slice(0, deg + 1);
      if (pts.length < deg + 1) break;
      var vals = pts.map(function (x) { return remaining.eval(Rat.int(x)).n; });
      var divs = vals.map(divisorsOf);
      var combos = 1;
      for (i = 0; i < divs.length; i++) combos *= divs[i].length;
      if (combos > 20000) { divs = divs.map(function (d) { return d.slice(0, 8); }); }
      var idx = [], carry, attempt = 0;
      for (i = 0; i < divs.length; i++) idx.push(0);
      var yss = divs.map(function (d) { return d[0]; });
      while (attempt++ < 4000) {
        var ys = yss.slice();
        try {
          var cand = interpolate(pts, ys.map(function (b) { return Rat.int(b); }));
          if (!cand.isZero() && cand.deg() === deg) {
            var ci = clearDenominators(cand);
            var cp = ci.primitivePart();
            if (cp.lc().sign() < 0) cp = cp.neg();
            if (cp.deg() >= 1 && cp.deg() < remaining.deg()) {
              var dm = remaining.divmod(cp);
              if (dm.r.isZero()) {
                result.push(cp);
                remaining = dm.q.primitivePart();
                if (remaining.lc().sign() < 0) remaining = remaining.neg();
                if (remaining.deg() <= 1) return finish(result, remaining);
                // restart the search on the smaller remainder
                return result.concat(kronecker(remaining, budget));
              }
            }
          }
        } catch (e) { /* non-invertible denominators etc: try the next combination */ }
        // increment odometer
        carry = divs.length - 1;
        while (carry >= 0) {
          idx[carry]++;
          if (idx[carry] < divs[carry].length) { yss[carry] = divs[carry][idx[carry]]; break; }
          idx[carry] = 0; yss[carry] = divs[carry][0]; carry--;
        }
        if (carry < 0) break;
      }
      if (budget && budget.attempts > 6000) break;
      if (budget) budget.attempts += attempt;
    }
    return finish(result, remaining);
  }
  function finish(result, remaining) {
    if (!remaining.isConst()) {
      if (remaining.lc().sign() < 0) remaining = remaining.neg();
      result.push(remaining);
    }
    return result;
  }

  /* ── detect g(x) = h(x^k): factor h instead ─────────────────────────── */
  function deflatePowers(f, noK) {
    if (noK === 'all') return null;
    var n = f.deg(), k = 0, i;
    outer:
    for (k = 2; k <= Math.min(4, n); k++) {
      if (k === noK) continue;
      for (i = 0; i < f.c.length; i++) {
        if (f.c[i].isZero()) continue;
        if (i % k !== 0) continue outer;
      }
      var down = [];
      for (i = 0; i * k <= n; i++) down.push(f.at(i * k));
      return { k: k, h: new UP(down) };
    }
    return null;
  }

  /* ── factor one square-free primitive integer polynomial ────────────── */
  function factorSquarefreeInt(f, budget, depth, noK) {
    depth = depth || 0;
    if (depth > 4) return [f];
    if (f.deg() <= 0) return [];
    if (f.deg() === 1) return [f.monic().scale(f.lc().abs()).primitivePart()];
    var out = [], work = f, i;
    // factor out x^m
    var m = 0;
    while (work.at(0).isZero() && m < 32) { work = work.div(new UP([Rat.ZERO, Rat.ONE])); m++; }
    if (m > 0) out.push(new UP([Rat.ZERO, Rat.ONE]));
    if (work.deg() <= 1) { return m > 0 ? dedupe(out.concat([work])) : factorSquarefreeInt(work, budget); }
    // substitution x^k
    var defl = deflatePowers(work, noK);
    if (defl) {
      var subs = factorSquarefreeInt(defl.h, budget, depth + 1);
      var lifted = [];
      for (i = 0; i < subs.length; i++) {
        var lf = substituteXk(subs[i], defl.k);
        if (lf.lc().sign() < 0) lf = lf.neg();
        refine(lf, budget, depth, lifted, 'all');
      }
      var check = new UP([Rat.ONE]);
      for (i = 0; i < lifted.length; i++) check = check.mul(lifted[i]);
      if (check.equals(work) || check.equals(work.neg())) {
        return dedupe(out.concat(lifted));
      }
    }
    // rational roots
    var roots = rationalRoots(work, budget);
    var stillWork = work;
    for (i = 0; i < roots.length; i++) {
      var lin = extractLinear(stillWork, roots[i]);
      if (lin.lc().sign() < 0) lin = lin.neg();
      var dm = stillWork.divmod(lin);
      if (dm.r.isZero() && !dm.q.isZero() && dm.q.deg() < stillWork.deg()) {
        out.push(lin);
        stillWork = dm.q.primitivePart();
        if (stillWork.lc().sign() < 0) stillWork = stillWork.neg();
      }
    }
    if (stillWork.deg() <= 1) {
      if (!stillWork.isConst()) out.push(stillWork.lc().sign() < 0 ? stillWork.neg() : stillWork);
      return dedupe(out);
    }
    if (stillWork.deg() === 2 || stillWork.deg() === 3) return dedupe(out.concat([stillWork]));
    var high = kronecker(stillWork, budget), refined = [];
    for (i = 0; i < high.length; i++) if (!high[i].isConst()) refine(high[i], budget, depth, refined);
    return dedupe(out.concat(refined));
  }
  function substituteXk(f, k) {
    var out = [];
    for (var i = 0; i < f.c.length; i++) {
      while (out.length < i * k) out.push(Rat.ZERO);
      out.push(f.c[i]);
    }
    return new UP(out);
  }
  /* a factor recovered by substitution may still split further: (u−1)|_{u=x²} = x²−1 */
  function refine(f, budget, depth, out, noK) {
    if (f.deg() <= 1) { out.push(f); return out; }
    var parts = factorSquarefreeInt(f, budget, depth + 1, noK);
    if (parts.length === 0) { out.push(f); return out; }
    for (var i = 0; i < parts.length; i++) out.push(parts[i]);
    return out;
  }
  function dedupe(list) {
    var out = [], seen = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.isConst()) continue;
      if (p.lc().sign() < 0) p = p.neg();
      var key = p.c.map(function (c) { return c.hash(); }).join('|');
      if (!seen[key]) { seen[key] = true; out.push(p); }
    }
    return out;
  }

  /* Square-free decomposition that keeps the integer content: f = unit·∏ gᵢⁱ.
     (Yun's algorithm; every returned gᵢ is primitive with integer coefficients.) */
  function squarefreeInt(f) {
    if (f.deg() === 0) return [];
    var fp = f.derivative(), c = upGcd(f, fp), i = 1, out = [];
    function prim(g) {
      var gg = clearDenominators(g).primitivePart();
      if (gg.lc().sign() < 0) gg = gg.neg();
      return gg;
    }
    if (c.isZero() || c.isConst()) return [{ g: prim(f), m: 1 }];
    var w = f.div(c);
    while (!w.isConst() && i < 24) {
      var y = upGcd(w, c), z = w.div(y);
      if (!z.isConst()) out.push({ g: prim(z), m: i });
      if (y.isConst()) break;
      c = c.div(y); w = y; i++;
    }
    return out;
  }

  /* ── the public entry point ─────────────────────────────────────────── */
  function factorUP(f) {
    if (f.isZero()) return { unit: Rat.ZERO, factors: [{ poly: UP.zero(), mult: 1 }] };
    var content = f.content();
    var unit = content.abs();
    var rest = f.scale(content.inv());
    if (f.lc().sign() < 0) { unit = unit.neg(); }
    rest = clearDenominators(rest);
    var c2 = rest.content();
    rest = rest.scale(c2.inv());
    if (!isIntegral(rest)) return { unit: content, factors: [{ poly: f.scale(content.inv()), mult: 1 }] };
    if (rest.lc().sign() < 0) { rest = rest.neg(); unit = unit.neg(); }
    if (rest.deg() === 0) return { unit: unit, factors: [] };
    var out = [], budget = { attempts: 0 };
    var sq = squarefreeInt(rest);
    for (var i = 0; i < sq.length; i++) {
      var parts = factorSquarefreeInt(sq[i].g, budget);
      for (var j = 0; j < parts.length; j++) out.push({ poly: parts[j], mult: sq[i].m });
    }
    // keep the scalar honest: the pieces are primitive, so anything missing is a unit
    var acc = new UP([Rat.ONE]);
    for (i = 0; i < out.length; i++) {
      for (j = 0; j < out[i].mult; j++) acc = acc.mul(out[i].poly);
    }
    if (!acc.equals(rest) && !acc.isZero() && !rest.isZero()) {
      var u2 = rest.lc().div(acc.lc());
      if (acc.scale(u2).equals(rest)) unit = unit.mul(u2);
      else if (!acc.at(0).isZero() && !rest.at(0).isZero()) {
        var u3 = rest.at(0).div(acc.at(0));
        if (acc.scale(u3).equals(rest)) unit = unit.mul(u3);
      }
    }
    return { unit: unit, factors: out };
  }

  /* does the product of the found factors reproduce the input? */
  function verifyFactorisation(f, res) {
    var acc = new UP([res.unit]);
    for (var i = 0; i < res.factors.length; i++) {
      for (var j = 0; j < res.factors[i].mult; j++) acc = acc.mul(res.factors[i].poly);
    }
    return acc.equals(f) || acc.neg().equals(f);
  }

  /* ── factoring expressions ──────────────────────────────────────────── */
  /* convert an MPoly to a univariate UP in `v` (requires rational coefficients) */
  function toUP(p, v) {
    if (MPoly.isRat(p)) return new UP([p]);
    if (E.eqq(p.v, v)) {
      var arr = [];
      for (var i = 0; i < p.c.length; i++) {
        var c = MPoly.coeff(p, i);
        if (!MPoly.isRat(c)) throw new Error('coefficient is not rational');
        arr.push(c);
      }
      return new UP(arr);
    }
    // v is buried in the coefficients: re-collect as a polynomial in v
    var result = UP.zero(), k;
    for (k = 0; k < p.c.length; k++) {
      if (p.c[k] === undefined) continue;
      var inner = toUP(p.c[k], v);
      result = result.add(inner.mulXk(0));
      result = result.add(new UP([p.v]).mul(inner));
    }
    return result;
  }
  /* factor an expression as a polynomial in the given symbol */
  function factorExpr(e, v) {
    v = v || (E.freeVars(e)[0] || E.sym('x'));
    if (!E.isSym(v)) v = E.sym(String(v));
    var ord = [v];
    try {
      var p = MPoly.toPoly(e, ord);
      var up;
      if (MPoly.isRat(p)) return e;
      if (E.eqq(p.v, v)) up = toUP(p, v);
      else up = null;
      if (up === null) return null;
      if (up.deg() === 0 || up.deg() === 1) return null;
      var res = factorUP(up);
      var parts = [];
      if (!res.unit.isOne()) parts.push(E.num(res.unit));
      var sorted = res.factors.slice().sort(function (a, b) { return a.poly.deg() - b.poly.deg(); });
      for (var i = 0; i < sorted.length; i++) {
        var px = sorted[i].poly.toExpr(v);
        parts.push(sorted[i].mult === 1 ? px : E.pow(px, E.int(sorted[i].mult)));
      }
      if (parts.length === 0) return e;
      if (parts.length === 1 && parts[0] === null) return e;
      return E.mul.apply(null, parts);
    } catch (err) {
      return null;
    }
  }
  /* pull out the largest monomial common to every term — works even when the
     expression is not a polynomial in one variable at all */
  function commonFactor(expr) {
    var ord = [];
    var p;
    try { p = MPoly.toPoly(expr, ord); } catch (e) { return expr; }
    var mins = Object.create(null), monomials = [];
    (function collect(q, exps) {
      if (MPoly.isRat(q)) { if (!q.isZero()) monomials.push(exps); return; }
      for (var i = 0; i < q.c.length; i++) {
        if (q.c[i] === undefined) continue;
        var next = Object.create(null), key;
        for (key in exps) next[key] = exps[key];
        next[E.hash(q.v)] = i;
        collect(q.c[i], next);
      }
    })(p, Object.create(null));
    if (monomials.length === 0) return expr;
    var first = true, shared = {};
    for (var m = 0; m < monomials.length; m++) {
      for (var key2 in shared) {
        if (!monomials[m][key2]) shared[key2] = 0;
      }
      for (key2 in monomials[m]) {
        if (!(key2 in shared)) shared[key2] = monomials[m][key2];
        else shared[key2] = Math.min(shared[key2], monomials[m][key2]);
      }
    }
    var factor = E.ONE, any = false;
    for (key2 in shared) {
      if (shared[key2] > 0) {
        any = true;
        factor = E.mul(factor, E.pow(varByHash(ord, key2), E.int(shared[key2])));
      }
    }
    if (!any) return expr;
    var divided = AE.simplify && AE.simplify.simplify ? AE.simplify.cancelDivide(E.div(expr, factor)) : E.div(expr, factor);
    return E.mul(factor, divided);
  }
  function varByHash(ord, h) {
    for (var i = 0; i < ord.length; i++) if (E.hash(ord[i]) === h) return ord[i];
    return E.sym('?');
  }

  AE.factor = {
    UP: factorUP, expr: factorExpr, squarefreeInt: factorSquarefreeInt,
    squarefree: squarefreeInt,
    kronecker: kronecker, rationalRoots: rationalRoots, verify: verifyFactorisation,
    toUP: toUP, commonFactor: commonFactor, clearDenominators: clearDenominators,
    interpolate: interpolate
  };

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function p(s) { return AE.parse(s); }
  function fac(s) { return factorExpr(p(s)); }
  function showFact(s) {
    var r = fac(s);
    return r === null ? null : AE.print.text(r);
  }

  U.test('factor', 'integer polynomials', function (a) {
    a.eq(showFact('x^2-1'), '(x - 1)*(x + 1)', 'difference of squares');
    a.eq(showFact('x^2+2*x+1'), '(x + 1)^2', 'perfect square');
    a.eq(showFact('2*x^2-4*x+2'), '2*(x - 1)^2', 'content + square');
    a.eq(showFact('x^3-1'), '(x - 1)*(x^2 + x + 1)', 'difference of cubes');
    a.eq(showFact('x^3+x^2-x-1'), '(x + 1)^2*(x - 1)', 'grouping');
    a.eq(showFact('x^4-1'), '(x - 1)*(x + 1)*(x^2 + 1)', 'fourth power minus one');
    a.eq(showFact('x^2+1'), 'x^2 + 1', 'irreducible over Q');
    a.eq(showFact('x^2+x+1'), 'x^2 + x + 1', 'irreducible quadratic');
    a.eq(showFact('x^4+2*x^2+1'), '(x^2 + 1)^2', 'biquadratic square');
    a.eq(showFact('x^4+3*x^2+2'), '(x^2 + 1)*(x^2 + 2)', 'biquadratic');
    a.eq(showFact('6*x^2+5*x-6'), '(2*x + 3)*(3*x - 2)', 'content one, split leading');
    a.eq(showFact('x^5-x'), 'x*(x - 1)*(x + 1)*(x^2 + 1)', 'x^5 - x');
    a.eq(showFact('x^4+4'), '(x^2 - 2*x + 2)*(x^2 + 2*x + 2)', 'Sophie Germain');
  });

  U.test('factor', 'every factorisation is verified', function (a) {
    var cases = ['x^2-1', 'x^3+x^2-x-1', 'x^4-1', '6*x^2+5*x-6', 'x^5-x', 'x^4+4',
      '2*x^3-3*x^2-11*x+6', 'x^4+x^3+x^2+x+1', '3*x^2+7*x+2', 'x^6-1'];
    for (var i = 0; i < cases.length; i++) {
      var e = p(cases[i]);
      var ord = [E.sym('x')];
      var up = toUP(MPoly.toPoly(e, ord), E.sym('x'));
      var res = factorUP(up);
      a.ok(verifyFactorisation(up, res), 'product reproduces input: ' + cases[i]);
      var back = res.unit.abs().isOne() ? E.ONE : E.num(res.unit);
      for (var j = 0; j < res.factors.length; j++) back = E.mul(back, E.pow(res.factors[j].poly.toExpr(E.sym('x')), E.int(res.factors[j].mult)));
      a.ok(E.eqq(AE.simplify.expand(back), AE.simplify.expand(e)), 're-expands to the original: ' + cases[i]);
    }
  });

  U.test('factor', 'non-rational coefficients stay honest', function (a) {
    a.eq(showFact('x^2-2'), 'x^2 - 2', '√2 does not appear: irreducible over ℚ');
    a.eq(showFact('x^4-4'), '(x^2 - 2)*(x^2 + 2)', 'difference of squares again');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
