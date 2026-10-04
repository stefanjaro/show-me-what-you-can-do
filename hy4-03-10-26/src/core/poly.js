/* ALETHEIA — polynomial machinery.
 *
 * Two representations, because they answer different questions:
 *
 *   UP    univariate polynomial over ℚ, dense ascending coefficient array.
 *         Everything exact: gcd, division, square-free decomposition, Sturm
 *         sequences, real-root isolation, integer factorisation.
 *
 *   Poly  multivariate polynomial, recursive: a polynomial is either a rational
 *         constant or {v, c:[coefficients in the *later* variables]}. Any
 *         sub-expression that is not a polynomial (sin x, √2, …) becomes a
 *         generator of its own, which is what lets (sin x)²−(cos x)² cancel.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E;

  var MAXDEG = 96, MAXTERMS = 4000;

  /* ══════════════════════════════════════════════════════════════════════
     Part I — multivariate polynomials (recursive representation)
     ══════════════════════════════════════════════════════════════════════ */
  function isRat(p) { return p instanceof Rat; }
  function pIsZero(p) { return isRat(p) && p.isZero(); }
  function pIsOne(p) { return isRat(p) && p.isOne(); }
  function indexOfVar(ord, v) {
    for (var i = 0; i < ord.length; i++) if (E.eqq(ord[i], v)) return i;
    return -1;
  }
  function ensureVar(ord, v) {
    var i = indexOfVar(ord, v);
    if (i < 0) { ord.push(v); return ord.length - 1; }
    return i;
  }
  /* x^0 is 0 in Z, x^0 is 1 everywhere else */
  function trim(c) { while (c.length > 1 && (c[c.length - 1] === undefined || (isRat(c[c.length - 1]) && c[c.length - 1].isZero()))) c.pop(); return c; }
  function mkPoly(v, c) {
    c = trim(c);
    if (c.length === 1 && isRat(c[0])) return c[0];       // constant collapses to Rat
    return { v: v, c: c };
  }
  function pDeg(p) { return isRat(p) ? 0 : p.c.length - 1; }
  function pMain(p) { return isRat(p) ? null : p.v; }
  function pCoeff(p, i) {
    if (isRat(p)) return i === 0 ? p : Rat.ZERO;
    return p.c[i] === undefined ? Rat.ZERO : p.c[i];
  }
  /* view p as a polynomial in v (only legal when v has priority over p's own
     variable: an inner polynomial is simply a coefficient of the outer one) */
  function liftTo(p, v, ord) {
    if (isRat(p)) return { v: v, c: [p] };
    var iv = indexOfVar(ord, p.v), iv2 = indexOfVar(ord, v);
    if (iv === iv2) return p;
    if (iv > iv2) return { v: v, c: [p] };
    throw new Error('cannot re-group an outer polynomial into an inner variable');
  }

  function pAdd(a, b, ord) {
    if (isRat(a) && isRat(b)) return a.add(b);
    if (isRat(a) || isRat(b)) {
      var poly = isRat(a) ? b : a, r = isRat(a) ? a : b;
      var c2 = poly.c.slice();
      c2[0] = pAdd(pCoeff(poly, 0), r, ord);
      return mkPoly(poly.v, c2);
    }
    ensureVar(ord, a.v); ensureVar(ord, b.v);
    var ia = indexOfVar(ord, a.v), ib = indexOfVar(ord, b.v);
    if (ia < ib) { var s = liftTo(b, a.v, ord); return pAddPoly(a, s, ord); }
    if (ib < ia) { var s2 = liftTo(a, b.v, ord); return pAddPoly(s2, b, ord); }
    return pAddPoly(a, b, ord);
  }
  function pAddPoly(a, b, ord) {
    var n = Math.max(a.c.length, b.c.length), out = [];
    for (var i = 0; i < n; i++) out.push(pAdd(pCoeff(a, i), pCoeff(b, i), ord));
    return mkPoly(a.v, out);
  }
  function pNeg(p, ord) {
    if (isRat(p)) return p.neg();
    var out = p.c.map(function (c) { return c === undefined ? Rat.ZERO : pNeg(c, ord); });
    return mkPoly(p.v, out);
  }
  function pSub(a, b, ord) { return pAdd(a, pNeg(b, ord), ord); }
  function pMul(a, b, ord) {
    if (pIsZero(a) || pIsZero(b)) return Rat.ZERO;
    if (isRat(a) && isRat(b)) return a.mul(b);
    if (isRat(a)) return pMulRat(b, a, ord);
    if (isRat(b)) return pMulRat(a, b, ord);
    ensureVar(ord, a.v); ensureVar(ord, b.v);
    var ia = indexOfVar(ord, a.v), ib = indexOfVar(ord, b.v);
    if (ia < ib) return pMul(liftTo(b, a.v, ord), a, ord);
    if (ib < ia) return pMul(a, liftTo(b, a.v, ord), ord);
    var out = [];
    for (var i = 0; i < a.c.length; i++) {
      if (a.c[i] === undefined || pIsZero(a.c[i])) continue;
      for (var j = 0; j < b.c.length; j++) {
        if (b.c[j] === undefined || pIsZero(b.c[j])) continue;
        var term = pMul(a.c[i], b.c[j], ord);
        out[i + j] = out[i + j] === undefined ? term : pAdd(out[i + j], term, ord);
      }
    }
    return mkPoly(a.v, out);
  }
  function pMulRat(p, r, ord) {
    if (r.isOne()) return p;
    if (isRat(p)) return p.mul(r);
    var out = p.c.map(function (c) { return c === undefined ? Rat.ZERO : pMul(c, r, ord); });
    return mkPoly(p.v, out);
  }
  function pShift(p, n, ord) {                 // multiply by (main variable)^n
    if (isRat(p)) throw new Error('pShift: needs a variable to multiply');
    if (n === 0) return p;
    var out = [];
    for (var i = 0; i < n; i++) out.push(Rat.ZERO);
    for (var j = 0; j < p.c.length; j++) out.push(p.c[j] === undefined ? Rat.ZERO : p.c[j]);
    return mkPoly(p.v, out);
  }
  function mono(v, k, coeff, ord) {            // coeff · v^k
    var arr = [];
    for (var i = 0; i < k; i++) arr.push(Rat.ZERO);
    arr.push(coeff);
    return mkPoly(v, arr);
  }
  /* the set of variables actually present */
  function pVars(p, out) {
    out = out || Object.create(null);
    if (isRat(p)) return out;
    out[E.hash(p.v)] = p.v;
    for (var i = 0; i < p.c.length; i++) if (p.c[i] !== undefined) pVars(p.c[i], out);
    return out;
  }
  function pTerms(p) {                          // rough size guard
    var n = 0;
    (function rec(q) {
      if (isRat(q)) { if (!q.isZero()) n++; return; }
      for (var i = 0; i < q.c.length; i++) if (q.c[i] !== undefined) rec(q.c[i]);
    })(p);
    return n;
  }
  /* derivative with respect to one generator */
  function pDiff(p, v, ord) {
    if (isRat(p)) return Rat.ZERO;
    if (E.eqq(p.v, v)) {
      var out = [];
      for (var i = 1; i < p.c.length; i++) out.push(pMul(p.c[i] === undefined ? Rat.ZERO : p.c[i], Rat.int(i), ord));
      return mkPoly(p.v, out);
    }
    var inner = p.c.map(function (c) { return c === undefined ? Rat.ZERO : pDiff(c, v, ord); });
    return mkPoly(p.v, inner);
  }
  /* content: gcd of all coefficients, recursively (up to units) */
  function pContent(p, ord) {
    if (isRat(p)) return p.abs();
    var g = Rat.ZERO, i;
    for (i = 0; i < p.c.length; i++) {
      if (p.c[i] === undefined) continue;
      var c = pContent(p.c[i], ord);
      g = g.isZero() ? c : pGcd(g, c, ord);
      if (pIsOne(g)) break;
    }
    if (pIsZero(g)) return Rat.ONE;
    return g;
  }
  /* divide every coefficient by `c` — exact when c really divides */
  function pDivCoeffs(p, c, ord) {
    if (isRat(p)) return p.div(c);
    var out = p.c.map(function (x) { return x === undefined ? Rat.ZERO : pDivCoeffs(x, c, ord); });
    return mkPoly(p.v, out);
  }
  function pDivRat(p, r, ord) { return pMulRat(p, r.inv(), ord); }

  /* pseudo-remainder: lc(b)^k · a ≡ prem(a,b)  (mod b) */
  function pPrem(a, b, ord) {
    if (isRat(b)) return Rat.ZERO;
    if (isRat(a)) return a;
    ensureVar(ord, a.v); ensureVar(ord, b.v);
    if (indexOfVar(ord, a.v) !== indexOfVar(ord, b.v)) a = liftTo(a, b.v, ord);
    var r = a, db = pDeg(b), lc = pCoeff(b, db), steps = 0;
    while (!pIsZero(r) && pDeg(r) >= db && steps++ < 200) {
      var dr = pDeg(r), lr = pCoeff(r, dr);
      // r ← lc·r − lr·b·x^(dr−db)
      var t1 = pMul(r, lc, ord);                 // coefficients live in the ring below
      var t2 = pShift(pMul(b, lr, ord), dr - db, ord);
      var next = pSub(t1, t2, ord);
      var g = pContent(next, ord);
      if (!pIsZero(g) && !pIsOne(g)) next = primitiveDiv(next, g, ord);
      r = next;
    }
    return r;
  }
  function primitiveDiv(p, c, ord) {
    if (isRat(c)) return pDivRat(p, c, ord);
    if (isRat(p)) return Rat.ZERO;                 // a proper constant can't be divided by a poly
    return mkPoly(p.v, p.c.map(function (x) { return x === undefined ? Rat.ZERO : pDivExact(x, c, ord); }));
  }
  /* exact division a / b  (b must actually divide a) */
  function pDivExact(a, b, ord) {
    if (pIsZero(a)) return Rat.ZERO;
    if (isRat(b)) return pDivRat(a, b, ord);
    if (isRat(a)) throw new Error('pDivExact: polynomial does not divide the constant');
    ensureVar(ord, a.v); ensureVar(ord, b.v);
    var iav = indexOfVar(ord, a.v), ibv = indexOfVar(ord, b.v);
    if (iav !== ibv) {
      if (iav < ibv) {                      // divisor is a coefficient-ring element
        var arr = a.c.map(function (cc) { return cc === undefined ? Rat.ZERO : pDivExact(cc, b, ord); });
        return mkPoly(a.v, arr);
      }
      throw new Error('pDivExact: divisor involves an outer variable absent from the dividend');
    }
    var da = pDeg(a), db = pDeg(b), lc = pCoeff(b, db), steps = 0, i;
    if (db === 0) return isRat(lc) ? pDivRat(a, lc, ord) : primitiveDiv(a, lc, ord);
    var q = Rat.ZERO, rem = a;
    for (i = da; i >= db; i--) {
      var lr = pCoeff(rem, i);
      if (pIsZero(lr)) continue;
      var factor = pDivExact(lr, lc, ord);
      var term = mono(b.v, i - db, factor, ord);
      q = pAdd(q, term, ord);
      rem = pSub(rem, pMul(term, b, ord), ord);
      if (++steps > 400) throw new Error('polynomial division exceeded budget');
    }
    return q;
  }
  function pDivides(a, b, ord) {                  // does b divide a?
    try {
      if (isRat(b)) return true;
      if (pIsZero(b)) return pIsZero(a);
      var q = pDivExact(a, b, ord);
      return !pIsZero(pSub(a, pMul(q, b, ord), ord)) === false;
    } catch (e) { return false; }
  }

  /* ── the multivariate gcd ───────────────────────────────────────────── */
  /* primitive polynomial remainder sequence; recursive on the generator order */
  function pGcd(a, b, ord) {
    if (pIsZero(a)) return b;
    if (pIsZero(b)) return a;
    if (pTerms(a) > MAXTERMS || pTerms(b) > MAXTERMS) return Rat.ONE;
    if (isRat(a) && isRat(b)) return gcdRat(a, b);
    if (isRat(a)) return pgcdConst(a, b, ord);
    if (isRat(b)) return pgcdConst(b, a, ord);
    ensureVar(ord, a.v); ensureVar(ord, b.v);
    var ia = indexOfVar(ord, a.v), ib = indexOfVar(ord, b.v);
    if (ia !== ib) {
      // a common divisor cannot involve a variable that is absent from one side
      if (ia < ib) return pGcd(contentIn(a, a.v, ord), b, ord);
      return pGcd(a, contentIn(b, b.v, ord), ord);
    }
    /* both now share the main variable v. Work in R[v] with R = ℚ[remaining]:
       strip the R-content of each side, remember its gcd, and run a primitive
       polynomial remainder sequence. */
    var v = a.v;
    var cA = contentIn(a, v, ord), cB = contentIn(b, v, ord);
    var cg = pGcd(cA, cB, ord);
    var A = ringPP(a, cA, ord), B = ringPP(b, cB, ord), steps = 0;
    while (!pIsZero(B) && steps++ < 80) {
      var r = pPrem(A, B, ord);
      if (pIsZero(r)) break;
      A = B;
      B = ringPP(r, contentIn(r, v, ord), ord);
    }
    if (pIsZero(B)) B = A;
    var g = ringPP(B, contentIn(B, v, ord), ord);
    return pIsZero(cg) || pIsOne(cg) ? g : pMul(g, cg, ord);
  }
  function ringPP(p, c, ord) {
    if (pIsZero(p)) return Rat.ZERO;
    if (isRat(c)) return c.isOne() ? p : pDivRat(p, c, ord);
    if (isRat(p)) return p;
    try { return primitiveDiv(p, c, ord); } catch (e) { return p; }
  }
  function gcdRatish(b) { return isRat(b) ? b.abs() : primitivePart(b, []); }
  function gcdRat(a, b) {
    // gcd of two rationals, as a rational:  gcd(p/q, r/s) = gcd(ps, rq)/(qs)
    var an = AE.bigAbs(a.n), ad = a.d, bn = AE.bigAbs(b.n), bd = b.d;
    var gn = AE.bigGcd(an * bd, bn * ad);
    var gd = ad * bd;
    return new Rat(gn, gd);
  }
  function pgcdConst(c, p, ord) {                 // gcd(constant, polynomial)
    if (c.isZero()) return p;
    var vs = pVars(p), keys = Object.keys(vs), g = c.abs();
    for (var i = 0; i < keys.length; i++) { /* no-op: keep ord stable */ }
    var acc = Rat.ZERO;
    (function rec(q) {
      if (isRat(q)) { acc = acc.isZero() ? q.abs() : gcdRat(acc, q.abs()); return; }
      for (var j = 0; j < q.c.length; j++) if (q.c[j] !== undefined) rec(q.c[j]);
    })(p);
    var out = gcdRat(g, acc);
    return out;
  }
  function contentIn(p, v, ord) {          // gcd of the coefficients of p as a poly in v
    if (isRat(p)) return p.abs();
    if (!E.eqq(p.v, v)) return p;
    var g = null, i, c;
    for (i = 0; i < p.c.length; i++) {
      c = p.c[i];
      if (c === undefined || pIsZero(c)) continue;
      g = g === null ? c : pGcd(g, c, ord);
      if (pIsOne(g)) break;
    }
    return g === null ? Rat.ZERO : g;
  }
  function primitivePart(p, ord) {
    if (isRat(p)) return Rat.ONE;
    var c = pContent(p, ord);
    if (isRat(c)) { if (c.isZero() || c.isOne()) return p; return pDivRat(p, c, ord); }
    try { return primitiveDiv(p, c, ord); } catch (e) { return p; }
  }

  /* ══════════════════════════════════════════════════════════════════════
     Part II — conversions between expressions and polynomials
     ══════════════════════════════════════════════════════════════════════ */
  /* Every sub-expression that is not literally a polynomial becomes its own
     generator:  sin(x), sqrt(2), x^y, Γ(z) … all behave as variables here. */
  function atom(e) { return e; }
  function toPoly(e, ord, budget) {
    budget = budget || { n: 0 };
    if (++budget.n > 20000) throw new Error('expression too large to algebraise');
    ord = ord || [];
    switch (e.t) {
      case 'num': return e.v;
      case 'sym': ensureVar(ord, e); return mkPoly(e, [Rat.ZERO, Rat.ONE]);
      case 'inf': case 'nan': ensureVar(ord, atom(e)); return mkPoly(atom(e), [Rat.ZERO, Rat.ONE]);
      case 'add': {
        var acc = Rat.ZERO;
        for (var i = 0; i < e.args.length; i++) acc = pAdd(acc, toPoly(e.args[i], ord, budget), ord);
        return acc;
      }
      case 'mul': {
        acc = Rat.ONE;
        for (i = 0; i < e.args.length; i++) acc = pMul(acc, toPoly(e.args[i], ord, budget), ord);
        return acc;
      }
      case 'pow': {
        var b = toPoly(e.b, ord, budget);
        if (e.e.t === 'num' && e.e.v.isInt()) {
          var k = Number(e.e.v.n);
          if (k >= 0 && k <= MAXDEG) {
            var r = Rat.ONE;
            for (var j = 0; j < k; j++) r = pMul(r, b, ord);
            return r;
          }
        }
        ensureVar(ord, atom(e));
        return mkPoly(atom(e), [Rat.ZERO, Rat.ONE]);
      }
      default: {
        ensureVar(ord, atom(e));
        return mkPoly(atom(e), [Rat.ZERO, Rat.ONE]);
      }
    }
  }
  function fromPoly(p, ord) {
    if (isRat(p)) return E.num(p);
    switch (p.c.length) {
      case 1: return fromPoly(p.c[0], ord);
      default: {
        var terms = [];
        for (var i = 0; i < p.c.length; i++) {
          if (p.c[i] === undefined || pIsZero(p.c[i])) continue;
          var co = fromPoly(p.c[i], ord);
          terms.push(i === 0 ? co : (isRat(p.c[i]) && p.c[i].isOne() && i === 1 ? p.v : E.mul(co, E.pow(p.v, E.int(i)))));
        }
        if (terms.length === 0) return E.ZERO;
        return E.add.apply(null, terms);
      }
    }
  }

  /* ── rational normal form: expression → numerator / denominator ─────── */
  function toRational(e, ord, budget) {
    ord = ord || [];
    budget = budget || { n: 0 };
    if (++budget.n > 20000) throw new Error('expression too large to algebraise');
    var i;
    switch (e.t) {
      case 'num': return { n: e.v, d: Rat.ONE };
      case 'sym': ensureVar(ord, e); return { n: mkPoly(e, [Rat.ZERO, Rat.ONE]), d: Rat.ONE };
      case 'add': {
        var N = Rat.ZERO, D = Rat.ONE;
        for (i = 0; i < e.args.length; i++) {
          var t = toRational(e.args[i], ord, budget);
          N = pAdd(pMul(N, t.d, ord), pMul(t.n, D, ord), ord);
          D = pMul(D, t.d, ord);
          var g = safeGcd(N, D, ord);
          if (!(isRat(g) && g.isOne())) { N = pDivSafe(N, g, ord); D = pDivSafe(D, g, ord); }
        }
        return { n: N, d: D };
      }
      case 'mul': {
        N = Rat.ONE; D = Rat.ONE;
        for (i = 0; i < e.args.length; i++) {
          var f = toRational(e.args[i], ord, budget);
          N = pMul(N, f.n, ord); D = pMul(D, f.d, ord);
        }
        return { n: N, d: D };
      }
      case 'pow': {
        var base = toRational(e.b, ord, budget);
        if (e.e.t === 'num' && e.e.v.isInt()) {
          var k = Number(e.e.v.n);
          if (k >= 0) {
            var nn = Rat.ONE, dd = Rat.ONE;
            for (i = 0; i < k && i <= MAXDEG; i++) { nn = pMul(nn, base.n, ord); dd = pMul(dd, base.d, ord); }
            return { n: nn, d: dd };
          }
          if (k < 0) {
            nn = Rat.ONE; dd = Rat.ONE;
            for (i = 0; i < -k && i <= 32; i++) { nn = pMul(nn, base.d, ord); dd = pMul(dd, base.n, ord); }
            if (pIsZero(dd)) throw new Error('division by zero');
            return { n: nn, d: dd };
          }
        }
        ensureVar(ord, atom(e));
        return { n: mkPoly(atom(e), [Rat.ZERO, Rat.ONE]), d: Rat.ONE };
      }
      default: ensureVar(ord, atom(e)); return { n: mkPoly(atom(e), [Rat.ZERO, Rat.ONE]), d: Rat.ONE };
    }
  }
  function leadingCoeff(p) { while (!isRat(p)) p = p.c[p.c.length - 1]; return p; }
  /* canonicalise a quotient: divide numerator *and* denominator by the common
     rational content, then make the leading sign of the denominator positive */
  function canonFraction(n, d, ord) {
    var cn = pContent(n, ord), cd = pContent(d, ord);
    if (isRat(cn) && isRat(cd) && !cn.isZero() && !cd.isZero()) {
      var c = gcdRat(cn, cd);
      if (!c.isZero() && !c.isOne()) {
        n = pDivCoeffs(n, c, ord);
        d = pDivCoeffs(d, c, ord);
      }
    }
    var lc = leadingCoeff(d);
    if (isRat(lc) && lc.sign() < 0) { n = pNeg(n, ord); d = pNeg(d, ord); }
    return { n: n, d: d };
  }
  function safeGcd(a, b, ord) {
    try { return pGcd(a, b, ord); } catch (err) { return Rat.ONE; }
  }
  function pDivSafe(a, b, ord) {
    try { return pDivExact(a, b, ord); } catch (err) { return a; }
  }
  function fromRational(r, ord) {
    if (isRat(r.d) && r.d.isOne()) return fromPoly(r.n, ord);
    if (pIsZero(r.n)) return E.ZERO;
    return E.div(fromPoly(r.n, ord), fromPoly(r.d, ord));
  }

  /* ══════════════════════════════════════════════════════════════════════
     Part III — univariate polynomials over ℚ (dense, ascending)
     ══════════════════════════════════════════════════════════════════════ */
  function UP(coeffs) {
    if (!(this instanceof UP)) return new UP(coeffs);
    this.c = trimUP(coeffs.slice());
  }
  function trimUP(c) { while (c.length > 1 && c[c.length - 1].isZero()) c.pop(); return c; }
  UP.fromInts = function (arr) { return new UP(arr.map(function (v) { return Rat.int(v); })); };
  UP.zero = function () { return new UP([Rat.ZERO]); };
  UP.one = function () { return new UP([Rat.ONE]); };
  UP.monomial = function (k, c) {
    var arr = [];
    for (var i = 0; i <= k; i++) arr.push(Rat.ZERO);
    arr[k] = c === undefined ? Rat.ONE : c;
    return new UP(arr);
  };
  var PPP = UP.prototype;
  PPP.deg = function () { return this.c.length - 1; };
  PPP.isZero = function () { return this.c.length === 1 && this.c[0].isZero(); };
  PPP.isOne = function () { return this.c.length === 1 && this.c[0].isOne(); };
  PPP.isConst = function () { return this.c.length === 1; };
  PPP.lc = function () { return this.c[this.c.length - 1]; };
  PPP.at = function (i) { return this.c[i] === undefined ? Rat.ZERO : this.c[i]; };
  PPP.add = function (o) {
    var n = Math.max(this.c.length, o.c.length), out = [];
    for (var i = 0; i < n; i++) out.push(this.at(i).add(o.at(i)));
    return new UP(out);
  };
  PPP.sub = function (o) {
    var n = Math.max(this.c.length, o.c.length), out = [];
    for (var i = 0; i < n; i++) out.push(this.at(i).sub(o.at(i)));
    return new UP(out);
  };
  PPP.neg = function () { return new UP(this.c.map(function (v) { return v.neg(); })); };
  PPP.mul = function (o) {
    if (this.isZero() || o.isZero()) return UP.zero();
    var out = [];
    for (var i = 0; i < this.c.length + o.c.length; i++) out.push(Rat.ZERO);
    for (i = 0; i < this.c.length; i++) {
      if (this.c[i].isZero()) continue;
      for (var j = 0; j < o.c.length; j++) {
        if (o.c[j].isZero()) continue;
        out[i + j] = out[i + j].add(this.c[i].mul(o.c[j]));
      }
    }
    return new UP(out);
  };
  PPP.scale = function (r) { return new UP(this.c.map(function (v) { return v.mul(r); })); };
  PPP.mulXk = function (k) {
    var out = [];
    for (var i = 0; i < k; i++) out.push(Rat.ZERO);
    return new UP(out.concat(this.c));
  };
  PPP.divmod = function (o) {
    if (o.isZero()) throw new Error('UP: division by zero');
    var rem = this.c.slice(), dq = o.c.length, out = [], i, guard = 0;
    var lcv = o.lc();
    for (i = this.c.length - 1; i >= dq - 1 && guard++ < 500; i--) {
      if (rem[i] === undefined || rem[i].isZero()) { continue; }
      var q = rem[i].div(lcv);
      out[i - dq + 1] = q;
      for (var j = 0; j < dq; j++) {
        rem[i - dq + 1 + j] = (rem[i - dq + 1 + j] === undefined ? Rat.ZERO : rem[i - dq + 1 + j]).sub(q.mul(o.at(j)));
      }
      rem[i] = Rat.ZERO;
    }
    var qc = [];
    for (i = 0; i <= Math.max(0, this.c.length - dq); i++) qc.push(out[i] === undefined ? Rat.ZERO : out[i]);
    return { q: new UP(qc), r: new UP(rem) };
  };
  PPP.div = function (o) { return this.divmod(o).q; };
  PPP.mod = function (o) { return this.divmod(o).r; };
  PPP.derivative = function () {
    if (this.c.length <= 1) return UP.zero();
    var out = [];
    for (var i = 1; i < this.c.length; i++) out.push(this.c[i].mul(Rat.int(i)));
    return new UP(out.length ? out : [Rat.ZERO]);
  };
  PPP.eval = function (x) {
    x = x instanceof Rat ? x : Rat.from(x);
    // Horner
    var acc = Rat.ZERO;
    for (var i = this.c.length - 1; i >= 0; i--) acc = acc.mul(x).add(this.c[i]);
    return acc;
  };
  PPP.evalFloat = function (x) { return this.eval(Rat.fromFloat(x)).toNumber(); };
  PPP.toString = function () {
    var parts = [];
    for (var i = this.c.length - 1; i >= 0; i--) {
      if (this.c[i].isZero()) continue;
      parts.push((this.c[i].d === 1n ? this.c[i].n.toString() : '(' + this.c[i] + ')') + (i === 0 ? '' : (i === 1 ? 'x' : 'x^' + i)));
    }
    return parts.length ? parts.join(' + ') : '0';
  };
  PPP.equals = function (o) {
    var n = Math.max(this.c.length, o.c.length);
    for (var i = 0; i < n; i++) if (!this.at(i).eq(o.at(i))) return false;
    return true;
  };
  PPP.toExpr = function (v) {
    v = v || E.sym('x');
    var terms = [];
    for (var i = 0; i < this.c.length; i++) {
      if (this.c[i].isZero()) continue;
      if (i === 0) terms.push(E.num(this.c[i]));
      else terms.push(E.mul(E.num(this.c[i]), E.pow(v, E.int(i))));
    }
    return terms.length ? E.add.apply(null, terms) : E.ZERO;
  };
  /* content / primitive part over ℤ */
  PPP.content = function () {
    // over ℚ: gcd of numerators scaled by lcm of denominators, expressed as a rational
    var lcmD = 1n, gN = 0n, i;
    for (i = 0; i < this.c.length; i++) if (!this.c[i].isZero()) lcmD = lcmD * this.c[i].d / AE.bigGcd(lcmD, this.c[i].d);
    for (i = 0; i < this.c.length; i++) {
      if (this.c[i].isZero()) continue;
      var scaled = AE.bigAbs(this.c[i].n) * (lcmD / this.c[i].d);
      gN = gN === 0n ? scaled : AE.bigGcd(gN, scaled);
    }
    if (gN === 0n) return Rat.ZERO;
    return new Rat(gN, lcmD).mul(this.lc().sign() < 0 ? Rat.MONE : Rat.ONE);
  };
  PPP.primitivePart = function () {
    var c = this.content();
    if (c.isZero() || c.isOne()) return this;
    return this.scale(c.inv());
  };
  PPP.monic = function () {
    var lcv = this.lc();
    if (lcv.isOne()) return this;
    return this.scale(lcv.inv());
  };
  /* gcd over ℚ */
  function upGcd(a, b) {
    if (a.isZero()) return b;
    if (b.isZero()) return a;
    var x = a, y = b, guard = 0;
    while (!y.isZero() && guard++ < 500) {
      var dv = x.divmod(y);
      x = y; y = dv.r;
    }
    return x.isZero() ? x : x.monic();
  }
  /* square-free decomposition (Yun's algorithm) → [g1, g2, ...] with f = ∏ gi^i */
  function squarefree(f) {
    var out = [], fp = f.derivative(), c = upGcd(f, fp), i = 1, w, z, y;
    if (c.isZero()) return [f];
    if (f.deg() === 0) return [];
    w = f.div(c);
    while (!w.isConst()) {
      y = upGcd(w, c);
      z = w.div(y);
      if (!z.isConst()) out.push({ g: z.monic(), m: i });
      i++;
      if (y.isConst() && y.lc().isOne()) break;
      w = y; c = c.div(y);
      if (i > 16) break;
    }
    return out;
  }
  /* substitute x → x + t  (used by root isolation) */
  PPP.shift = function (k) {
    if (k === 0 || this.isZero()) return this;
    var out = this, xk = new UP([Rat.from(k), Rat.ONE]);   // (x + k)
    // Horner-style: f(x+k)
    var res = UP.zero(), i;
    for (i = this.c.length - 1; i >= 0; i--) res = res.mul(xk).add(UP.monomial(0, this.c[i]));
    return res;
  };

  AE.MPoly = {
    add: pAdd, sub: pSub, mul: pMul, neg: pNeg, div: pDivExact, gcd: pGcd, prem: pPrem,
    diff: pDiff, content: pContent, primitive: primitivePart, toPoly: toPoly, fromPoly: fromPoly,
    toRational: toRational, fromRational: fromRational, deg: pDeg, terms: pTerms,
    canonFraction: canonFraction, leadingCoeff: leadingCoeff, divides: pDivides,
    vars: pVars, isRat: isRat, isZero: pIsZero, coeff: pCoeff
  };
  AE.UP = UP;
  AE.upGcd = upGcd;
  AE.squarefree = squarefree;

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function P(s) { return AE.parse(s); }
  function poly(s) { var ord = []; return { p: toPoly(P(s), ord), ord: ord }; }

  U.test('poly', 'multivariate arithmetic', function (a) {
    var A1 = poly('x^2 + 2*x*y + y^2'), B1 = poly('x + y');
    var prod = pMul(A1.p, B1.p, A1.ord);
    var expect = poly('(x+y)^3');
    a.ok(pSub(prod, expect.p, expect.ord).isZero() || pIsZero(pSub(prod, expect.p, expect.ord)), '(x+y)^2(x+y) = (x+y)^3');
    var diff = pDiff(A1.p, P('x'), A1.ord);
    a.ok(pIsZero(pSub(diff, poly('2*x + 2*y').p, A1.ord)), '∂/∂x of (x+y)^2');
    a.eq(pDeg(A1.p), 2, 'degree');
  });

  U.test('poly', 'multivariate gcd cancels', function (a) {
    function cancel(s) {
      var ord = [], r = toRational(P(s), ord);
      var g = pGcd(r.n, r.d, ord);
      var n = pDivExact(r.n, g, ord), d = pDivExact(r.d, g, ord);
      var c = canonFraction(n, d, ord);
      return AE.print.text(fromRational({ n: c.n, d: c.d }, ord));
    }
    a.eq(cancel('(x^2-y^2)/(x+y)'), 'x - y', 'difference of squares');
    a.eq(cancel('(x^2-1)/(x-1)'), 'x + 1', 'univariate');
    a.eq(cancel('1/x + 1/(x+1)'), '(2*x + 1)/(x^2 + x)', 'sum of fractions');
    a.eq(cancel('sin(x)/sin(x)'), '1', 'non-polynomial atom cancels');
    a.eq(cancel('x*y/(y*z)'), 'x/z', 'monomial cancellation');
    a.eq(cancel('(x^3-x^2+x-1)/(x-1)'), 'x^2 + 1', 'cubic by linear');
    a.eq(cancel('(sin(x)^2 - cos(x)^2)/(sin(x)+cos(x))'), 'sin(x) - cos(x)', 'atoms as variables');
  });

  U.test('poly', 'univariate over Q', function (a) {
    var f = UP.fromInts([-1, 0, 1]);            // x^2 - 1
    var g = UP.fromInts([-1, 1]);               // x - 1
    var h = UP.fromInts([1, 1]);                // x + 1
    a.eq(f.divmod(g).r.isZero(), true, 'x-1 divides x^2-1');
    a.ok(f.div(g).equals(h), 'quotient is x+1');
    a.ok(upGcd(f, UP.fromInts([-1, 0, 0, 1])).equals(UP.fromInts([-1, 1])), 'gcd(x^2-1, x^3-1) = x-1');
    a.eq(f.eval(Rat.int(2)).toString(), '3', 'evaluation');
    a.eq(UP.fromInts([1, 2, 3]).derivative().toString(), '6x + 2', 'derivative');
    a.eq(UP.fromInts([2, 4, 6]).content().toString(), '2', 'content');
    a.eq(UP.fromInts([2, 4, 6]).primitivePart().toString(), '3x^2 + 2x + 1', 'primitive part');
    var sq = squarefree(f.mul(f).mul(UP.fromInts([1, 1])));   // (x-1)^2 (x+1)^3
    a.eq(sq.length, 2, 'squarefree splits into two groups');
    a.eq(sq[0].m, 2, 'multiplicity of (x-1)');
    a.ok(sq[0].g.equals(UP.fromInts([-1, 1])), 'first factor is x-1');
    a.eq(sq[1].m, 3, 'multiplicity of (x+1)');
    a.ok(sq[1].g.equals(UP.fromInts([1, 1])), 'second factor is x+1');
    var rebuilt = UP.one(), k;
    for (k = 0; k < sq.length; k++) {
      var m = sq[k].g;
      for (var j = 0; j < sq[k].m; j++) rebuilt = rebuilt.mul(m);
    }
    a.ok(rebuilt.equals(f.mul(f).mul(UP.fromInts([1, 1])).monic()), 'squarefree decomposition rebuilds f');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
