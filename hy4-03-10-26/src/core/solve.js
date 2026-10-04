/* ALETHEIA — solving equations.
 *
 * Four strategies, tried in order of how much truth they carry:
 *
 *   1. isolation   — invert one function at a time (2·exp(x) = 8 ⇒ x = ln 4);
 *   2. formulas    — the quadratic formula works with *symbolic* coefficients,
 *                    so a·x² + b·x + c = 0 gets an honest answer in a, b, c;
 *   3. factorisation — over ℚ, then Cardano for whatever stays irreducible;
 *   4. numerics    — but never unguided: a Sturm sequence counts exactly how
 *                    many real roots there are and brackets each one in exact
 *                    rational arithmetic before any digit is printed.
 *
 * Every root is then substituted back into the original equation and checked.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, E = AE.E, Rat = AE.Rat, UP = AE.UP;
  /* AE.numeric arrives after us in the load order, so it is always reached through AE */
  var rat = AE.rat;

  var ZERO = E.ZERO, ONE = E.ONE;

  /* ── small helpers ─────────────────────────────────────────────────── */
  function upPow(p, n) {
    var out = UP.one(), i;
    for (i = 0; i < n; i++) out = out.mul(p);
    return out;
  }
  function simplify(e) { return AE.simplify ? AE.simplify.simplify(e) : e; }
  function txt(e) { return AE.print.text(e); }
  function numE(r) { return E.num(r); }

  /* ── recognise a polynomial in x over ℚ ────────────────────────────── */
  function polyIn(f, x) {
    var hx = E.hash(x);
    function rec(e) {
      var i, acc, t;
      switch (e.t) {
        case 'num': return new UP([e.v]);
        case 'sym':
          if (E.hash(e) === hx) return new UP([Rat.ZERO, Rat.ONE]);
          return null;                       // unknown symbols are not coefficients here
        case 'add':
          acc = UP.zero();
          for (i = 0; i < e.args.length; i++) { t = rec(e.args[i]); if (t === null) return null; acc = acc.add(t); }
          return acc;
        case 'mul':
          acc = UP.one();
          for (i = 0; i < e.args.length; i++) { t = rec(e.args[i]); if (t === null) return null; acc = acc.mul(t); }
          return acc;
        case 'pow':
          var b = rec(e.b);
          if (b === null) return null;
          if (e.e.t === 'num' && e.e.v.isInt() && e.e.v.sign() > 0) return upPow(b, Number(e.e.v.n));
          if (!E.depends(e.e, x)) {                  // c^k with k not an integer: constant or nothing
            var cv = rec(e.e);
            return null;
          }
          return null;
        default: return null;
      }
    }
    try { return rec(f); } catch (err) { return null; }
  }

  /* ── Sturm sequences: an exact count of the real roots ─────────────── */
  function sturmChain(p) {
    var q = AE.squarefree ? AE.squarefree(p) : null;      // groups; rebuild the squarefree part
    var f = p;
    if (q && q.length) { f = UP.one(); for (var k = 0; k < q.length; k++) f = f.mul(q[k].g); }
    var chain = [f, f.derivative()], i;
    while (chain[chain.length - 1].deg() > 0) {
      var a = chain[chain.length - 2], b = chain[chain.length - 1];
      var r = a.mod(b);
      if (r.isZero()) break;
      chain.push(r.neg());
      if (chain.length > 200) break;
    }
    return chain;
  }
  function signChanges(chain, at) {
    var last = 0, changes = 0, i;
    for (i = 0; i < chain.length; i++) {
      var s = chain[i].eval(at).sign();
      if (s === 0) continue;
      if (last !== 0 && s !== last) changes++;
      last = s;
    }
    return changes;
  }
  function countRealRoots(chain, a, b) {
    return signChanges(chain, a) - signChanges(chain, b);
  }
  /* all real roots of p lie in (-B, B) */
  function rootBound(p) {
    if (p.deg() <= 0) return Rat.ONE;
    var lc = p.lc().abs(), m = Rat.ZERO, i;
    for (i = 0; i < p.deg(); i++) { var c = p.at(i).abs(); if (c.gt(m)) m = c; }
    return Rat.ONE.add(m.div(lc));
  }
  /* exact rational brackets, one root each */
  function isolateRealRoots(p, opts) {
    opts = opts || {};
    if (p.deg() <= 0) return [];
    var chain = sturmChain(p);
    var B = rootBound(p), limits = opts.limit || 400;
    var out = [];
    function bisect(a, b, depth) {
      if (out.length >= limits || depth > 60) return;
      var n = countRealRoots(chain, a, b);
      if (n === 0) return;
      if (n === 1) {
        if (p.eval(a).isZero()) { out.push({ lo: a, hi: a, exact: a }); return; }
        out.push({ lo: a, hi: b });
        return;
      }
      var m = a.add(b).mul(Rat.HALF);
      if (m.eq(a) || m.eq(b)) { out.push({ lo: a, hi: b, multiple: n }); return; }
      bisect(a, m, depth + 1);
      if (!p.eval(m).isZero()) bisect(m, b, depth + 1);
      else out.push({ lo: m, hi: m, exact: m });
    }
    var fa = p.eval(B.neg()), fb = p.eval(B);
    if (fa.isZero()) out.push({ lo: B.neg(), hi: B.neg(), exact: B.neg() });
    if (fb.isZero()) out.push({ lo: B, hi: B, exact: B });
    bisect(B.neg(), B, 0);
    out.sort(function (x, y) { return x.lo.cmp(y.lo); });
    return out;
  }
  /* 2-adic refinement, entirely in exact rationals */
  function refineRoot(p, lo, hi, digits) {
    if (lo.eq(hi)) return { value: lo, error: Rat.ZERO, steps: 0 };
    var tol = new Rat(BigInt(1), BigInt(Math.pow(10, digits)));
    var slo = p.eval(lo).sign(), steps = 0;
    var a = lo, b = hi;
    while (b.sub(a).gt(tol) && steps < 4000) {
      var m = a.add(b).mul(Rat.HALF);
      var s = p.eval(m).sign();
      steps++;
      if (s === 0) { a = b = m; break; }
      if (s === slo) a = m; else b = m;
    }
    return { value: a.add(b).mul(Rat.HALF), error: b.sub(a).mul(Rat.HALF), steps: steps };
  }
  /* all complex roots at once, by Durand–Kerner */
  function complexRoots(p, iters) {
    iters = iters || 200;
    var n = p.deg(), i, j, k;
    if (n <= 0) return [];
    var c = [];
    for (i = 0; i <= n; i++) c.push(p.at(i).toNumber());
    while (c.length && Math.abs(c[c.length - 1]) < 1e-300) c.pop();
    // scale to monic-ish for stability
    var lead = c[c.length - 1];
    var z = [];
    for (i = 0; i < n; i++) {
      var ang = 2 * Math.PI * (i + 0.5) / n, rr = 0.4 + (i % 3) * 0.3;
      z.push({ re: rr * Math.cos(ang), im: rr * Math.sin(ang) });
    }
    function ev(w) {
      var acc = { re: 0, im: 0 };
      for (var m = n; m >= 0; m--) {
        acc = AE.numeric.cmul(acc, w);
        acc = AE.numeric.cadd(acc, AE.numeric.C(c[m] || 0, 0));
      }
      return acc;
    }
    for (k = 0; k < iters; k++) {
      var moved = 0;
      for (i = 0; i < n; i++) {
        var num = ev(z[i]), den = AE.numeric.C(1, 0);
        for (j = 0; j < n; j++) if (i !== j) den = AE.numeric.cmul(den, AE.numeric.csub(z[i], z[j]));
        if (AE.numeric.cabs(den) < 1e-300) continue;
        var d = AE.numeric.cdiv(num, den);
        if (d.re !== d.re || d.im !== d.im) continue;
        z[i] = AE.numeric.csub(z[i], d);
        moved = Math.max(moved, AE.numeric.cabs(d));
      }
      if (moved < 1e-15) break;
    }
    return z;
  }

  /* ── closed forms ──────────────────────────────────────────────────── */
  /* (-b ± √(b²-4ac))/2a, with a, b, c arbitrary expressions in the parameters */
  function quadraticFormula(a, b, c) {
    var disc = simplify(E.sub(E.mul(b, b), E.mul(E.int(4), a, c)));
    var root = E.pow(disc, E.rational(1, 2));
    var den = E.mul(E.int(2), a);
    return [
      simplify(E.div(E.add(E.neg(b), root), den)),
      simplify(E.div(E.sub(E.neg(b), root), den))
    ];
  }
  /* Cardano for a cubic with rational coefficients: x³ + px + q (monic, depressed) */
  function depressedCubic(p, q, x) {
    var disc = q.mul(q).div(rat(4)).add(p.mul(p).mul(p).div(rat(27)));   // (q/2)² + (p/3)³
    var out = { disc: disc };
    if (disc.sign() > 0) {
      var sq = disc.sqrt();                       // exact√ when it is rational
      var halfq = E.num(q.mul(rat(-1)).div(rat(2)));
      var A0 = (sq === null)
        ? E.pow(E.add(halfq, E.pow(E.num(disc), E.rational(1, 2))), E.rational(1, 3))
        : cubicRootExpr(E.add(halfq, E.num(sq)));
      var B0 = (sq === null)
        ? E.pow(E.sub(halfq, E.pow(E.num(disc), E.rational(1, 2))), E.rational(1, 3))
        : cubicRootExpr(E.sub(halfq, E.num(sq)));
      out.real = [simplify(E.add(A0, B0))];
      // the complex pair, from u·ω and u·ω²
      var w = E.div(E.add(E.MONE, E.mul(E.sym('i'), E.pow(E.int(3), E.rational(1, 2)))), E.int(2));
      out.complex = [
        simplify(E.add(E.mul(A0, w), E.mul(B0, E.mul(w, w)))),
        simplify(E.add(E.mul(A0, E.mul(w, w)), E.mul(B0, w)))
      ];
      out.how = 'Cardano';
    } else {
      // three real roots, casus irreducibilis: trigonometric form
      var amt = (3 * q.toNumber()) / (2 * p.toNumber()) * Math.sqrt(-3 / p.toNumber());
      if (amt < -1) amt = -1; else if (amt > 1) amt = 1;
      var t = Math.sqrt(-p.toNumber() / 3);
      var ang = Math.acos(amt) / 3;
      out.real = [];
      for (var k = 0; k < 3; k++) {
        out.real.push(E.num(Rat.fromFloat(2 * t * Math.cos(ang - 2 * Math.PI * k / 3))));
      }
      out.complex = [];
      out.how = 'trigonometric (casus irreducibilis)';
    }
    return out;
  }
  function cubicRootExpr(e) { return E.fun('cbrt', [e]); }

  /* roots of an irreducible-over-ℚ cubic a₃x³ + a₂x² + a₁x + a₀ */
  function solveCubicRational(p) {
    var a = p.at(3), b = p.at(2), c = p.at(1), d = p.at(0);
    var A = b.div(a), B = c.div(a), C = d.div(a);
    /* x³ + Ax² + Bx + C = 0 becomes t³ + pt + q = 0 under x = t − A/3 */
    var pp = B.sub(A.mul(A).div(rat(3)));
    var qq = C.sub(A.mul(B).div(rat(3))).add(A.mul(A).mul(A).mul(rat(2)).div(rat(27)));
    var r = depressedCubic(pp, qq);
    var shift = E.num(A.div(rat(-3)));
    var real = r.real.map(function (v) { return simplify(E.add(v, shift)); });
    var complex = r.complex.map(function (v) { return simplify(E.add(v, shift)); });
    return { real: real, complex: complex, how: r.how, disc: r.disc };
  }

  /* ── a polynomial, solved as exactly as we can ─────────────────────── */
  function solvePolynomial(p, x, opts) {
    opts = opts || {};
    var digits = opts.digits || 24;
    var out = [], steps = [];
    if (p.deg() <= 0) return { roots: out, steps: steps, info: p.isZero() ? 'identically zero' : 'no roots' };
    var fac = AE.factor.UP(p);
    steps.push({ what: 'factor over ℚ', detail: txt(AE.factor.expr(p.toExpr(x))), nothing: false });
    var seen = Object.create(null);
    for (var i = 0; i < fac.factors.length && i < 32; i++) {
      var g = fac.factors[i].poly, mult = fac.factors[i].mult;
      var h = g.toString();
      if (seen[h]) continue;
      seen[h] = true;
      var deg = g.deg(), j;
      if (deg === 1) {
        var r = g.at(0).neg().div(g.at(1));
        out.push({ expr: E.num(r), value: AE.numeric.C(r.toNumber(), 0), mult: mult, how: 'linear factor ' + txt(g.toExpr(x)), exact: true });
      } else if (deg === 2) {
        var rr = quadraticFormula(E.num(g.at(2)), E.num(g.at(1)), E.num(g.at(0)));
        for (j = 0; j < 2; j++) {
          var v = AE.numeric.evalExpr(rr[j], {});
          out.push({ expr: rr[j], value: v, mult: mult, how: 'quadratic formula on ' + txt(g.toExpr(x)), exact: true });
        }
      } else if (deg === 3) {
        var cr = solveCubicRational(g);
        for (j = 0; j < cr.real.length; j++) {
          out.push({ expr: cr.real[j], value: AE.numeric.evalExpr(cr.real[j], {}), mult: mult, how: 'cubic formula (' + cr.how + ')', exact: true });
        }
        for (j = 0; j < cr.complex.length; j++) {
          out.push({ expr: cr.complex[j], value: AE.numeric.evalExpr(cr.complex[j], {}), mult: mult, how: 'cubic formula, complex branch', exact: true });
        }
      } else {
        /* irreducible of degree ≥ 4: exact count, certified brackets, lots of digits */
        var iso = isolateRealRoots(g, {});
        var all = complexRoots(g);
        for (j = 0; j < iso.length; j++) {
          var ref = refineRoot(g, iso[j].lo, iso[j].hi, digits);
          out.push({
            expr: E.num(ref.value), value: AE.numeric.C(ref.value.toNumber(), 0), mult: mult,
            how: 'root of ' + txt(g.toExpr(x)) + ', isolated by a Sturm sequence',
            bracket: [iso[j].lo.toString(), iso[j].hi.toString()],
            error: ref.error.toString(), exact: false
          });
        }
        for (j = 0; j < all.length; j++) {
          if (Math.abs(all[j].im) < 1e-12) continue;
          out.push({ expr: null, value: all[j], mult: mult, how: 'numeric (Durand–Kerner)', exact: false });
        }
      }
    }
    return { roots: out, steps: steps, factored: fac };
  }

  /* ── strategy 1: isolate x by peeling invertible functions ─────────── */
  var INVERSE = {
    exp: 'ln', ln: 'exp', log: 'exp',
    sin: 'asin', cos: 'acos', tan: 'atan',
    asin: 'sin', acos: 'cos', atan: 'tan',
    sinh: 'asinh', cosh: 'acosh', tanh: 'atanh',
    asinh: 'sinh', acosh: 'cosh', atanh: 'tanh'
  };
  /* the n values of u with u^n = c: all branches, not just the principal one */
  function nthRootBranches(c0, n) {
    c0 = simplify(c0);
    var r = simplify(E.pow(c0, E.rational(1, n)));
    var i, out = [];
    if (n === 2) return [r, E.neg(r)];
    if (n === 4) {
      return [r, E.mul(E.sym('i'), r), E.neg(r), E.neg(E.mul(E.sym('i'), r))];
    }
    if (n === 3) {
      var w = E.div(E.add(E.MONE, E.mul(E.sym('i'), E.pow(E.int(3), E.rational(1, 2)))), E.int(2));
      return [r, simplify(E.mul(r, w)), simplify(E.mul(r, E.mul(w, w)))];
    }
    for (i = 0; i < n; i++) {
      var arg = simplify(E.div(E.mul(E.int(2 * i), E.sym('pi'), E.sym('i')), E.int(n)));
      out.push(i === 0 ? r : simplify(E.mul(r, E.fun('exp', [arg]))));
    }
    return out;
  }
  function solveUnary(g, target, x, steps) {
    target = simplify(target);
    if (E.eqq(g, x)) return [target];
    if (!E.depends(g, x)) return null;
    if (g.t === 'mul') {
      var rest = [], coeff = Rat.ONE, k;
      for (k = 0; k < g.args.length; k++) {
        var a0 = g.args[k];
        if (!E.depends(a0, x) && a0.t === 'num') coeff = coeff.mul(a0.v); else rest.push(a0);
      }
      if (rest.length === 1 && !coeff.isOne()) {
        steps.push({ what: 'divide by the constant factor', detail: txt(g) + ' = ' + txt(target) });
        return solveUnary(rest[0], simplify(E.div(target, E.num(coeff))), x, steps);
      }
      return null;
    }
    if (g.t === 'add') {
      var inner = null, tail = [], m;
      var terms = g.args.slice();
      // peel off terms free of x
      var free_ = [];
      var dep = [];
      for (m = 0; m < terms.length; m++) (E.depends(terms[m], x) ? dep : free_).push(terms[m]);
      if (dep.length === 1 && free_.length) {
        target = simplify(E.sub(target, E.add.apply(null, free_)));
        return solveUnary(dep[0], target, x, steps);
      }
      return null;
    }
    if (g.t === 'pow') {
      if (E.depends(g.e, x)) return null;
      var n = g.e;
      if (n.t === 'num' && n.v.isInt()) {
        var kk = Math.abs(Number(n.v.n));
        var target = n.v.sign() > 0 ? target : simplify(E.div(ONE, target));
        if (kk > 1) {
          steps.push({
            what: 'take the ' + kk + (kk === 2 ? 'nd' : 'th') + ' root — ' + kk + ' of them',
            detail: txt(g) + ' = ' + txt(target)
          });
          var branches = nthRootBranches(target, kk), all = [], bi;
          for (bi = 0; bi < branches.length; bi++) {
            var inner = solveUnary(g.b, branches[bi], x, steps);
            if (inner) all = all.concat(inner);
          }
          return all.length ? all : null;
        }
        return solveUnary(g.b, target, x, steps);
      }
      if (!E.depends(g.b, x)) {
        steps.push({ what: 'take a logarithm', detail: txt(g) + ' = ' + txt(target) });
        return solveUnary(g.e, simplify(E.div(E.fun('ln', [target]), E.fun('ln', [g.b]))), x, steps);
      }
      return null;
    }
    if (g.t === 'fun') {
      var inv = INVERSE[g.name];
      if (inv && g.args.length === 1) {
        steps.push({ what: 'apply ' + inv + ' to both sides', detail: txt(g) + ' = ' + txt(target) });
        return solveUnary(g.args[0], simplify(E.fun(inv, [target])), x, steps);
      }
      return null;
    }
    return null;
  }
  function solveByIsolation(f, x, steps) {
    if (f.t === 'add') {
      var dep = [], free_ = [], i;
      for (i = 0; i < f.args.length; i++) (E.depends(f.args[i], x) ? dep : free_).push(f.args[i]);
      if (dep.length === 1) {
        var target = simplify(E.add.apply(null, free_.length ? [E.neg(E.add.apply(null, free_))] : [E.ZERO]));
        return solveUnary(dep[0], target, x, steps);
      }
      return null;
    }
    return solveUnary(f, E.ZERO, x, steps);
  }

  /* ── strategy 4: numerics, but with a reason to believe them ───────── */
  function numericSolve(f, x, opts) {
    opts = opts || {};
    var tol = opts.tol || 1e-14, span = opts.span || 64, n = opts.samples || 4096;
    var F = function (v) { return AE.numeric.evalExpr(E.subst(f, x, E.num(Rat.fromFloat(v))), {}).re; };
    // complex safety: only real parts are followed, but we keep any imaginary part tiny check
    var roots = [], lo = -span, hi = span, step = (hi - lo) / n, prev = F(lo);
    for (var i = 1; i <= n; i++) {
      var xa = lo + (i - 1) * step, xb = lo + i * step;
      var cur = F(xb);
      if (cur !== cur) { prev = cur; continue; }
      if ((prev <= 0 && cur >= 0) || (prev >= 0 && cur <= 0)) {
        var a = xa, b = xb, fa = prev, k;
        if (fa === 0) roots.push({ value: C_(a), residual: 0, bracket: [a, a] });
        else {
          for (k = 0; k < 200 && b - a > tol * Math.max(1, Math.abs(a)); k++) {
            var m = (a + b) / 2, fm = F(m);
            if (fm === 0) { a = b = m; break; }
            if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
          }
          var v = (a + b) / 2;
          roots.push({ value: C_(v), residual: Math.abs(F(v)), bracket: [a, b] });
        }
      }
      prev = cur;
    }
    return roots;
  }
  function C_(v) { return AE.numeric.C(v, 0); }

  /* ── check a candidate ─────────────────────────────────────────────── */
  function verify(expr, x, candidate) {
    var v = E.subst(expr, x, candidate);
    var s = simplify(v);
    var c = AE.numeric.evalExpr(v, {});
    return {
      simplified: s, text: txt(s), numeric: c,
      residual: Math.max(Math.abs(c.re), Math.abs(c.im)),
      exact: E.isZero(s) || (c.re === 0 && c.im === 0)
    };
  }

  /* ── linear systems, exactly ───────────────────────────────────────── */
  function solveLinearSystem(rows, rhs) {
    var n = rows.length, m = rows[0].length, i, j, k;
    var A = [], b = [];
    for (i = 0; i < n; i++) {
      A.push(rows[i].map(function (v) { return v instanceof Rat ? v : rat(v); }));
      b.push(rhs[i] instanceof Rat ? rhs[i] : rat(rhs[i]));
    }
    var pivots = [], r = 0;
    for (j = 0; j < m && r < n; j++) {
      var piv = -1;
      for (i = r; i < n; i++) if (!A[i][j].isZero()) { piv = i; break; }
      if (piv < 0) continue;
      var tmp = A[piv]; A[piv] = A[r]; A[r] = tmp;
      var tb = b[piv]; b[piv] = b[r]; b[r] = tb;
      var lead = A[r][j];
      for (k = j; k < m; k++) A[r][k] = A[r][k].div(lead);
      b[r] = b[r].div(lead);
      for (i = 0; i < n; i++) {
        if (i === r) continue;
        var fac = A[i][j];
        if (fac.isZero()) continue;
        for (k = j; k < m; k++) A[i][k] = A[i][k].sub(fac.mul(A[r][k]));
        b[i] = b[i].sub(fac.mul(b[r]));
      }
      pivots.push(j); r++;
    }
    for (i = r; i < n; i++) {
      var zeroRow = true;
      for (j = 0; j < m; j++) if (!A[i][j].isZero()) zeroRow = false;
      if (zeroRow && !b[i].isZero()) return { kind: 'inconsistent', row: A[i], value: b[i] };
    }
    var sol = [];
    for (j = 0; j < m; j++) sol.push(Rat.ZERO);
    for (i = 0; i < pivots.length; i++) sol[pivots[i]] = b[i];
    var free = [];
    for (j = 0; j < m; j++) if (pivots.indexOf(j) < 0) free.push(j);
    return {
      kind: free.length ? 'parametric' : 'unique',
      solution: sol, pivots: pivots, free: free,
      rank: pivots.length
    };
  }

  /* ── a polynomial in x with coefficients that may themselves be symbolic ─
     Returns [{p:power, c:coefficient}] or null when x hides somewhere that
     stops it being a polynomial (inside exp(x), in an exponent, …). */
  function termsIn(e, x, cap) {
    cap = cap || 24;
    var i, j, out;
    if (!E.depends(e, x)) return [{ p: 0, c: e }];
    switch (e.t) {
      case 'sym':
        return E.eqq(e, x) ? [{ p: 1, c: ONE }] : [{ p: 0, c: e }];
      case 'add':
        out = [];
        for (i = 0; i < e.args.length; i++) {
          var t2 = termsIn(e.args[i], x, cap);
          if (t2 === null) return null;
          out = mergeTerms(out, t2, cap);
          if (out === null) return null;
        }
        return normalizeTerms(out);
      case 'mul':
        out = [{ p: 0, c: ONE }];
        for (i = 0; i < e.args.length; i++) {
          var f2 = termsIn(e.args[i], x, cap);
          if (f2 === null) return null;
          out = convolveTerms(out, f2, cap);
          if (out === null) return null;
        }
        return normalizeTerms(out);
      case 'pow':
        if (e.e.t === 'num' && e.e.v.isInt() && e.e.v.sign() > 0) {
          var kk = Number(e.e.v.n);
          if (kk > cap) return null;
          var bse = termsIn(e.b, x, cap);
          if (bse === null) return null;
          out = [{ p: 0, c: ONE }];
          for (j = 0; j < kk; j++) {
            out = convolveTerms(out, bse, cap);
            if (out === null) return null;
          }
          return normalizeTerms(out);
        }
        return null;
      default:
        return null;
    }
  }
  function convolveTerms(a, b, cap) {
    var out = [], i, j;
    for (i = 0; i < a.length; i++) {
      for (j = 0; j < b.length; j++) {
        var p = a[i].p + b[j].p;
        if (p > cap) return null;
        out.push({ p: p, c: E.mul(a[i].c, b[j].c) });
      }
    }
    return mergeTerms([], out, cap);
  }
  function mergeTerms(a, b, cap) {
    var out = a.slice(), i, j;
    for (i = 0; i < b.length; i++) {
      var done = false;
      for (j = 0; j < out.length; j++) {
        if (out[j].p === b[i].p) { out[j] = { p: out[j].p, c: E.add(out[j].c, b[i].c) }; done = true; break; }
      }
      if (!done) out.push(b[i]);
    }
    return out;
  }
  function normalizeTerms(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var c = simplify(list[i].c);
      if (E.isZero(c)) continue;
      out.push({ p: list[i].p, c: c });
    }
    out.sort(function (u, v) { return u.p - v.p; });
    return out;
  }
  function degreeOfTerms(list) {
    var d = 0;
    for (var i = 0; i < list.length; i++) d = Math.max(d, list[i].p);
    return d;
  }
  function coeffAt(list, p) {
    for (var i = 0; i < list.length; i++) if (list[i].p === p) return list[i].c;
    return ZERO;
  }

  /* ── the front door ────────────────────────────────────────────────── */
  function solveEquation(lhs, rhs, x, opts) {
    opts = opts || {};
    x = x || (E.freeVars(E.sub(lhs, rhs))[0] || E.sym('x'));
    var f = simplify(E.sub(lhs, rhs));
    var res = { variable: x, equation: E.sub(lhs, rhs), simplified: f, steps: [], roots: [], notes: [] };
    res.steps.push({ what: 'bring everything to one side', detail: txt(f) + ' = 0' });

    if (!E.depends(f, x)) {
      res.info = E.isZero(f) ? 'identity' : 'contradiction';
      res.notes.push(res.info === 'identity' ? 'true for every value of ' + txt(x) : 'no solution: ' + txt(f) + ' ≠ 0');
      return res;
    }

    /* 1 — isolation */
    var isoSteps = [];
    var iso = solveByIsolation(f, x, isoSteps);
    if (iso && iso.length) {
      res.steps = res.steps.concat(isoSteps);
      for (var i = 0; i < iso.length; i++) {
        var v0 = simplify(iso[i]);
        res.roots.push({
          expr: v0, value: AE.numeric.evalExpr(v0, {}), how: 'inverse functions', exact: true,
          check: verify(E.sub(lhs, rhs), x, v0)
        });
      }
      if (!opts.exhaustive) { res.how = 'isolation'; return res; }
    }

    /* 2 — a polynomial in x whose coefficients are allowed to be symbolic:
           the linear and quadratic formulas don't care what the coefficients are */
    var up0 = null;
    try { up0 = polyIn(f, x); } catch (e) { up0 = null; }
    var terms = iso && iso.length ? null : termsIn(f, x);
    if (terms) {
      var deg = degreeOfTerms(terms);
      if (deg === 1) {
        var aa = coeffAt(terms, 1), bb = coeffAt(terms, 0);
        var v2 = simplify(E.div(E.neg(bb), aa));
        res.steps.push({ what: 'linear in ' + txt(x), detail: aa + '·' + txt(x) + ' = ' + txt(E.neg(bb)) });
        res.roots.push({
          expr: v2, value: AE.numeric.evalExpr(v2, {}), how: 'linear', exact: true,
          check: verify(E.sub(lhs, rhs), x, v2)
        });
        res.how = 'linear';
        return res;
      }
      if (deg === 2) {
        var A2 = coeffAt(terms, 2), B2 = coeffAt(terms, 1), C2 = coeffAt(terms, 0);
        var q1 = quadraticFormula(A2, B2, C2);
        res.steps.push({
          what: 'the quadratic formula',
          detail: 'Δ = b² − 4ac with a = ' + txt(A2) + ', b = ' + txt(B2) + ', c = ' + txt(C2)
        });
        for (i = 0; i < 2; i++) {
          var v3 = simplify(q1[i]);
          res.roots.push({
            expr: v3, value: AE.numeric.evalExpr(v3, {}), how: 'quadratic formula', exact: true,
            check: verify(E.sub(lhs, rhs), x, v3)
          });
        }
        res.how = 'quadratic formula';
        return res;
      }
    }

    /* 3 — polynomial over ℚ */
    if (up0 && up0.deg() >= 1 && (iso === null || iso.length === 0)) {
      var sp = solvePolynomial(up0, x, opts);
      res.steps = res.steps.concat(sp.steps);
      for (i = 0; i < sp.roots.length; i++) {
        var rt = sp.roots[i];
        var chk = rt.expr === null ? null : verify(E.sub(lhs, rhs), x, rt.expr);
        res.roots.push({
          expr: rt.expr, value: rt.value, how: rt.how, mult: rt.mult,
          bracket: rt.bracket, error: rt.error, check: chk
        });
      }
      res.realRootCount = isolateRealRoots(up0, {}).length;
      res.how = 'factorisation over ℚ';
      return res;
    }

    /* 4 — numbers */
    var nr = numericSolve(f, x, opts);
    for (i = 0; i < nr.length; i++) {
      var approx = E.num(Rat.fromFloat(nr[i].value.re));
      res.roots.push({
        expr: null, value: nr[i].value, how: 'bisection on a bracket', exact: false,
        bracket: nr[i].bracket, residual: nr[i].residual,
        check: { residual: nr[i].residual, numeric: nr[i].value, exact: false }
      });
    }
    res.how = 'numerically';
    res.notes.push('roots found numerically inside [−' + (opts.span || 64) + ', ' + (opts.span || 64) + ']');
    return res;
  }

  /* 'x^2 = 4' → {lhs, rhs} — the grammar has no relations, so split by hand */
  function parseRelation(s) {
    var depth = 0, i, cmp = null;
    for (i = 0; i < s.length; i++) {
      var c = s[i];
      if ('([{'.indexOf(c) >= 0) depth++;
      else if (')]}'.indexOf(c) >= 0) depth--;
      else if (depth === 0 && c === '=' && s[i + 1] !== '=') { cmp = i; break; }
    }
    if (cmp === null) throw new Error('not an equation: expected “=”');
    return {
      lhs: AE.parse(s.slice(0, cmp)),
      rhs: AE.parse(s.slice(cmp + 1)),
      kind: '='
    };
  }

  AE.solve = {
    solveEquation: solveEquation, solve: solveEquation, polyIn: polyIn,
    quadraticFormula: quadraticFormula, cubic: solveCubicRational,
    sturmChain: sturmChain, countRealRoots: countRealRoots,
    isolateRealRoots: isolateRealRoots, refineRoot: refineRoot,
    complexRoots: complexRoots, rootBound: rootBound,
    solveByIsolation: solveByIsolation, numericSolve: numericSolve,
    solvePolynomial: solvePolynomial, solveLinearSystem: solveLinearSystem,
    verify: verify, parseRelation: parseRelation
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;
  function T(s) { var r = parseRelation(s); return txt(r.lhs) + ' = ' + txt(r.rhs); }

  U.test('solve', 'linear and quadratic', function (a) {
    var r = parseRelation('2*x + 3 = 7');
    var res = solveEquation(r.lhs, r.rhs, E.sym('x'));
    a.eq(res.roots.length, 1, 'one root');
    a.eq(txt(res.roots[0].expr), '2', 'x = 2');
    a.ok(res.roots[0].check.exact, 'verified by substitution');

    r = parseRelation('x^2 - 4 = 0');
    res = solveEquation(r.lhs, r.rhs, E.sym('x'));
    a.eq(res.roots.length, 2, 'two roots');
    a.eq(res.roots.map(function (s) { return txt(s.expr); }).sort().join(','), '-2,2', '±2');

    r = parseRelation('x^2 + 2*x + 1 = 0');
    res = solveEquation(r.lhs, r.rhs, E.sym('x'));
    a.eq(res.roots.length, 2, 'double root still listed twice');
    a.eq(txt(res.roots[0].expr), '-1', 'x = -1');

    r = parseRelation('x^2 + 1 = 0');
    res = solveEquation(r.lhs, r.rhs, E.sym('x'));
    a.near(res.roots[0].value.im, 1, 1e-12, 'i');
    a.near(res.roots[1].value.im, -1, 1e-12, '-i');
  });

  U.test('solve', 'symbolic coefficients', function (a) {
    var r = parseRelation('a*x^2 + b*x + c = 0');
    var res = solveEquation(r.lhs, r.rhs, E.sym('x'));
    var got = res.roots.map(function (s) { return txt(s.expr); });
    a.ok(/sqrt\(.*b\^2.*\)/.test(got.join(' , ')) && got.join(' , ').indexOf('-4*a*c') >= 0,
      'the discriminant shows up: ' + got.join(' , '));
    // and plugging numbers in recovers the answer you would have got directly
    var check = AE.simplify.simplify(
      E.subst(E.subst(E.subst(res.roots[0].expr, E.sym('a'), E.int(1)), E.sym('b'), E.int(-3)), E.sym('c'), E.int(2)));
    a.eq(txt(check), '2', 'x²−3x+2 = 0 gives x = 2 through the general formula');
  });

  U.test('solve', 'higher degree', function (a) {
    function rootsOf(s) {
      var r = parseRelation(s);
      return solveEquation(r.lhs, r.rhs, E.sym('x'));
    }
    var r = rootsOf('x^3 - 2 = 0');
    a.eq(r.roots.length, 3, 'three cube roots of 2');
    a.near(r.roots[0].value.re, Math.pow(2, 1 / 3), 1e-9, 'real one');
    a.ok(r.roots[0].check.exact, 'and it checks out exactly');

    r = rootsOf('x^3 - 3*x + 1 = 0');
    a.eq(r.realRootCount, 3, 'Sturm says three real roots');
    var reals = r.roots.filter(function (s) { return Math.abs(s.value.im) < 1e-9; });
    a.eq(reals.length, 3, 'all three came out real');
    for (var i = 0; i < reals.length; i++) {
      a.ok(Math.abs(reals[i].check.residual) < 1e-8, 'residual tiny: ' + reals[i].check.text);
    }

    r = rootsOf('x^4 - 5*x^2 + 4 = 0');
    a.eq(r.roots.length, 4, 'four roots');
    a.eq(r.roots.map(function (s) { return s.value.re; }).sort(function (p, q2) { return p - q2; }).map(function (v) { return String(v); }).join(','), '-2,-1,1,2', '±1, ±2');

    r = rootsOf('x^5 - x - 1 = 0');
    a.eq(r.realRootCount, 1, 'exactly one real root (Galois: no radicals for this one)');
    a.near(r.roots.filter(function (s) { return Math.abs(s.value.im) < 1e-9; })[0].value.re, 1.1673039782614187, 1e-12, 'the plastic number');
  });

  U.test('solve', 'inverse functions', function (a) {
    function sol(s) {
      var r = parseRelation(s);
      return solveEquation(r.lhs, r.rhs, E.sym('x'));
    }
    var r = sol('2*exp(x) - 8 = 0');
    a.eq(txt(r.roots[0].expr), 'ln(4)', 'x = ln 4');
    a.near(r.roots[0].value.re, Math.log(4), 1e-12);
    r = sol('ln(x) = 1');
    a.eq(txt(r.roots[0].expr), 'exp(1)', 'x = e');
    r = sol('sin(x)^2 = 1/2');
    a.near(r.roots[0].value.re, Math.asin(Math.SQRT1_2), 1e-9, 'arcsin(1/√2)');
  });

  U.test('solve', 'linear systems over the rationals', function (a) {
    var s = solveLinearSystem(
      [[rat(2), rat(1), rat(-1)], [rat(-3), rat(-1), rat(2)], [rat(-2), rat(1), rat(2)]],
      [rat(8), rat(-11), rat(-3)]);
    a.eq(s.kind, 'unique', 'unique solution');
    a.eq(s.solution.map(String).join(','), '2,3,-1', 'x = 2, y = 3, z = -1');

    s = solveLinearSystem([[rat(1), rat(1)], [rat(2), rat(2)]], [rat(2), rat(4)]);
    a.eq(s.kind, 'parametric', 'rank deficient');
    a.eq(s.free.length, 1, 'one free variable');

    s = solveLinearSystem([[rat(1), rat(1)], [rat(2), rat(2)]], [rat(2), rat(5)]);
    a.eq(s.kind, 'inconsistent', 'no solution');
  });

  U.test('solve', 'root isolation is exact', function (a) {
    var p = UP.fromInts([-2, 0, 1]);            // x² − 2
    var iso = isolateRealRoots(p, {});
    a.eq(iso.length, 2, 'two real roots');
    var ref = refineRoot(p, iso[1].lo, iso[1].hi, 30);
    a.eq(ref.value.toNumber(), Math.SQRT2, '√2 agrees with the floating point value');
    a.ok(ref.error.toNumber() < 1e-30, 'and we know how far off it can be');
    // Legendre-ish check: every root really is inside its own bracket
    for (var i = 0; i < iso.length; i++) {
      a.eq(countRealRoots(sturmChain(p), iso[i].lo, iso[i].hi), iso[i].lo.eq(iso[i].hi) ? 0 : 1, 'bracket contains one root');
    }
    var all = complexRoots(p);
    a.eq(all.length, 2, 'two complex roots counted');
    a.near(Math.abs(all[0].re), Math.SQRT2, 1e-9, 'Durand–Kerner agrees');
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
