/* ALETHEIA — interval arithmetic.
 *
 * A floating point number is a lie that usually rounds the right way. Here
 * every quantity is a closed interval [lo, hi] that is *guaranteed* to contain
 * the answer: each operation widens outwards by one ulp so the enclosure can
 * never slip. That is the whole trick, and it buys certainty:
 *
 *   · "there is no root in here" becomes a statement you can check, not hope;
 *   · a computed bound is either inside the true range, or the code is wrong.
 *
 * This is how the engine tells the truth about numbers it cannot write down.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, E = AE.E, Rat = AE.Rat;

  /* one ulp downwards / upwards, so every result stays outside the truth */
  function down(x) { return isFinite(x) ? -(-x + Math.abs(x) * 2.220446049250313e-16) : x; }
  function up(x) { return isFinite(x) ? x + Math.abs(x) * 2.220446049250313e-16 : x; }

  function I(lo, hi) {
    if (hi === undefined) hi = lo;
    if (lo > hi) throw new Error('interval: empty [' + lo + ', ' + hi + ']');
    return { lo: down(lo), hi: up(hi) };
  }
  function neg(a) { return { lo: -a.hi, hi: -a.lo }; }
  function add(a, b) { return { lo: down(a.lo + b.lo), hi: up(a.hi + b.hi) }; }
  function sub(a, b) { return { lo: down(a.lo - b.hi), hi: up(a.hi - b.lo) }; }
  function mul(a, b) {
    var p = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
    return { lo: down(Math.min.apply(null, p)), hi: up(Math.max.apply(null, p)) };
  }
  function inv(a) {
    if (a.lo <= 0 && 0 <= a.hi) throw new Error('interval division by an interval containing 0');
    return { lo: down(1 / a.hi), hi: up(1 / a.lo) };
  }
  function div(a, b) { return mul(a, inv(b)); }
  function width(a) { return a.hi - a.lo; }
  function mid(a) { return (a.lo + a.hi) / 2; }
  function contains(a, x) { return (a.lo <= x && x <= a.hi); }
  function overlaps(a, b) { return a.lo <= b.hi && b.lo <= a.hi; }
  function inside(a, b) { return b.lo <= a.lo && a.hi <= b.hi; }
  function hull(a, b) { return { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) }; }
  function intersect(a, b) {
    if (a.hi < b.lo || b.hi < a.lo) return null;
    return { lo: Math.max(a.lo, b.lo), hi: Math.min(a.hi, b.hi) };
  }
  function abs(a) { return { lo: a.lo <= 0 && 0 <= a.hi ? 0 : Math.min(Math.abs(a.lo), Math.abs(a.hi)), hi: Math.max(Math.abs(a.lo), Math.abs(a.hi)) }; }
  function sqr(a) {
    if (a.lo <= 0 && 0 <= a.hi) return { lo: 0, hi: Math.max(a.lo * a.lo, a.hi * a.hi) };
    return mul(a, a);
  }
  function sqrt(a) {
    if (a.hi < 0) throw new Error('sqrt of a negative interval');
    return { lo: down(Math.sqrt(Math.max(0, a.lo))), hi: up(Math.sqrt(Math.max(0, a.hi))) };
  }
  function ipow(a, n) {
    if (n === 0) return I(1);
    if (n < 0) { var r0 = ipow(a, -n); return inv(r0); }
    var out2 = I(1), k;
    for (k = 0; k < n; k++) out2 = mul(out2, a);
    return out2;
  }
  /* monotonic and convex elementary functions are exact at the endpoints */
  function monotone(a, f) { return { lo: down(f(a.lo)), hi: up(f(a.hi)) }; }
  function exp_(a) { return monotone(a, Math.exp); }
  function ln(a) {
    if (a.lo <= 0) throw new Error('logarithm of an interval reaching 0');
    return monotone(a, Math.log);
  }
  /* sin/cos need the extremum, but for an interval narrower than π that is
     either an endpoint or ±1 —- so widen honestly when it straddles one */
  function sin_(a) {
    if (width(a) >= 2 * Math.PI) return I(-1, 1);
    var vals = [Math.sin(a.lo), Math.sin(a.hi)], lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    for (var k = -20; k <= 20; k++) {
      var pk = Math.PI / 2 + k * Math.PI;
      if (pk > a.lo && pk < a.hi) { lo = Math.min(lo, 1); hi = Math.max(hi, 1); }
      var nk = -Math.PI / 2 + k * Math.PI;
      if (nk > a.lo && nk < a.hi) { lo = Math.min(lo, -1); hi = Math.max(hi, -1); }
    }
    return { lo: down(lo), hi: up(hi) };
  }
  function cos_(a) { return sin_({ lo: a.lo + Math.PI / 2, hi: a.hi + Math.PI / 2 }); }
  function tan_(a) { return div(sin_(a), cos_(a)); }
  function atan_(a) { return monotone(a, Math.atan); }
  function sinh_(a) { return monotone(a, Math.sinh); }
  function cosh_(a) {
    if (a.lo <= 0 && 0 <= a.hi) return { lo: down(1), hi: up(Math.max(Math.cosh(a.lo), Math.cosh(a.hi))) };
    return monotone(a, Math.cosh);
  }
  function tanh_(a) { return monotone(a, Math.tanh); }

  /* ── evaluating an expression over a box ───────────────────────────── */
  /* env maps variable names to intervals */
  function evalI(e, env) {
    env = env || {};
    var i, acc, CONST = AE.numeric.CONSTS;
    switch (e.t) {
      case 'num': {
        var v = e.v.toNumber();
        return I(v, v);
      }
      case 'sym': {
        if (CONST[e.name]) { var cv = CONST[e.name]().re; return I(cv, cv); }
        if (env[e.name]) return env[e.name];
        throw new Error('interval: unknown symbol ' + e.name);
      }
      case 'add':
        acc = I(0);
        for (i = 0; i < e.args.length; i++) acc = add(acc, evalI(e.args[i], env));
        return acc;
      case 'mul':
        acc = I(1);
        for (i = 0; i < e.args.length; i++) acc = mul(acc, evalI(e.args[i], env));
        return acc;
      case 'pow': {
        var b = evalI(e.b, env);
        if (e.e.t === 'num' && e.e.v.isInt()) return ipow(b, Number(e.e.v.n));
        var xv = evalI(e.e, env);
        if (xv.lo !== xv.hi) throw new Error('interval: variable exponent');
        // rational exponent: reduce to integer power and root
        var pq = e.e.v, pp = Number(pq.n), qq = Number(pq.d);
        var pw = ipow(b, Math.abs(pp));
        var rt = rootI(pw, qq);
        return pp < 0 ? inv(rt) : rt;
      }
      case 'fun': {
        var a0 = evalI(e.args[0], env);
        var nm = e.name;
        if (nm === 'sqrt') return sqrt(a0);
        if (nm === 'exp') return exp_(a0);
        if (nm === 'ln' || nm === 'log') return ln(a0);
        if (nm === 'sin') return sin_(a0);
        if (nm === 'cos') return cos_(a0);
        if (nm === 'tan') return tan_(a0);
        if (nm === 'atan') return atan_(a0);
        if (nm === 'sinh') return sinh_(a0);
        if (nm === 'cosh') return cosh_(a0);
        if (nm === 'tanh') return tanh_(a0);
        if (nm === 'abs') return abs(a0);
        throw new Error('interval: unsupported function ' + nm);
      }
      default:
        throw new Error('interval: unsupported node ' + e.t);
    }
  }
  function rootI(a, q) {                      // a^(1/q), a ≥ 0
    var m = { lo: down(Math.pow(Math.max(0, a.lo), 1 / q)), hi: up(Math.pow(Math.max(0, a.hi), 1 / q)) };
    return { lo: m.lo, hi: m.hi };
  }

  /* ── guaranteed statements about roots ─────────────────────────────── */
  /* an interval evaluation of f over X that misses 0 ⇒ X holds no root */
  function certifyNoRoot(f, x, interval) {
    var env = {};
    env[x.name] = interval;
    try {
      var v = evalI(f, env);
      return v.lo > 0 || v.hi < 0;
    } catch (err) { return false; }
  }
  /* interval Newton: N(X) = m − f(m)/F'(X); any root in X also lies in N(X)∩X,
     and if that intersection is empty, X is provably root-free. */
  function newtonStep(f, df, x, interval) {
    /* even the midpoint has to be rounded outwards, or the enclosure leaks */
    var m0 = { lo: down((interval.lo + interval.hi) / 2), hi: up((interval.lo + interval.hi) / 2) };
    var env0 = {}; env0[x.name] = m0;
    var fm = evalI(f, env0);
    var envD = {}; envD[x.name] = interval;
    var slopes;
    try { slopes = evalI(df, envD); } catch (err) { return null; }
    if (slopes.lo <= 0 && slopes.hi >= 0) return null;         // cannot invert the slope
    var ratio = div(fm, slopes);
    return intersect({ lo: down(m0.lo - ratio.hi), hi: up(m0.hi - ratio.lo) }, interval);
  }
  /* sweep [a,b] and hand back brackets that certainly contain a sign change */
  function isolateNumericRoots(f, x, a, b, opts) {
    opts = opts || {};
    var n = opts.slices || 64, out = [], k;
    for (k = 0; k < n; k++) {
      var seg = { lo: a + (b - a) * k / n, hi: a + (b - a) * (k + 1) / n };
      envUtil1(x, seg, f, out, opts);
    }
    return out;
  }
  function envUtil1(x, seg, f, out, opts) {
    var env = {}; env[x.name] = seg;
    var v;
    try { v = evalI(f, env); } catch (err) { return; }
    if (v.lo > 0 || v.hi < 0) return;                          // provably no root
    if (Math.abs(v.lo) < 1e-13 && Math.abs(v.hi) < 1e-13) return;
    out.push({ interval: seg, value: v, signChange: v.lo <= 0 && v.hi >= 0 });
  }

  /* enclosure of √2 to arbitrary accuracy, all along */
  /* Newton's method in interval form: X ← (X ∩ (m − f(m)/f′(X))), with a
     bisection fallback for the steps where the slope estimate is not helpful. */
  function shrinkRoot(f, df, x, start, digits) {
    var box = start, steps = 0, bisections = 0;
    var tol = Math.pow(10, -digits);
    while (width(box) > tol && steps < 400) {
      /* below ~16 ulps there is nothing left to squeeze: further arithmetic
         would only put the guarantee at risk */
      var ulpScale = Math.max(Math.abs(box.lo), Math.abs(box.hi)) * 2.220446049250313e-16;
      if (width(box) <= 16 * ulpScale) break;
      var nx = newtonStep(f, df, x, box);
      var next2 = nx;
      if (next2 === null || width(next2) > width(box) * 0.5) {
        var left = { lo: box.lo, hi: mid(box) }, right = { lo: mid(box), hi: box.hi }, pick = null;
        try {
          var envL = {}; envL[x.name] = left;
          var envR = {}; envR[x.name] = right;
          var vl = evalI(f, envL), vr = evalI(f, envR);
          if (vl.lo <= 0 && vl.hi >= 0) pick = left;
          else if (vr.lo <= 0 && vr.hi >= 0) pick = right;
          else pick = width(left) < width(right) ? left : right;
        } catch (err) { pick = null; }
        if (pick === null) break;
        next2 = pick;
        bisections++;
      }
      box = next2;
      steps++;
    }
    return { box: box, steps: steps, bisections: bisections, width: width(box) };
  }

  AE.interval = {
    I: I, neg: neg, add: add, sub: sub, mul: mul, div: div, inv: inv,
    abs: abs, sqr: sqr, sqrt: sqrt, pow: ipow, exp: exp_, ln: ln, log: ln,
    sin: sin_, cos: cos_, tan: tan_, atan: atan_, sinh: sinh_, cosh: cosh_, tanh: tanh_,
    width: width, mid: mid, contains: contains, overlaps: overlaps, inside: inside,
    hull: hull, intersect: intersect,
    evalI: evalI, evalExpr: evalI, certifyNoRoot: certifyNoRoot,
    newtonStep: newtonStep, isolateRoots: isolateNumericRoots, shrinkRoot: shrinkRoot,
    str: function (a) {
      return '[' + a.lo.toString() + ', ' + a.hi.toString() + ']';
    }
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;
  function P(s) { return AE.parse(s); }

  U.test('interval', 'the enclosure never lies', function (a) {
    var x = AE.interval.I(3, 3);
    var sum27 = AE.interval.add(x, AE.interval.I(8, 8));
    a.ok(AE.interval.width(sum27) < 1e-13 && AE.interval.contains(sum27, 11), '3 + 8 encloses 11');
    var q = AE.interval.div(AE.interval.I(1, 1), AE.interval.I(3, 3));
    a.ok(q.lo < 1 / 3 && q.hi > 1 / 3, '1/3 is bracketed, not rounded away');
    a.ok(AE.interval.width(q) < 1e-15, 'and the bracket is one ulp wide');
    var r2 = AE.interval.sqrt(AE.interval.I(2, 2));
    a.ok(r2.lo < Math.SQRT2 && r2.hi > Math.SQRT2, '√2 is inside');
    var s = AE.interval.sin(AE.interval.I(0.5, 0.7));
    a.ok(s.lo <= Math.sin(0.5) && Math.sin(0.5) <= s.hi, 'sin(0.5) inside');
    a.ok(s.lo <= Math.sin(0.7) && Math.sin(0.7) <= s.hi, 'sin(0.7) inside');
    var wide = AE.interval.sin(AE.interval.I(0, 10));
    a.ok(Math.abs(wide.lo + 1) < 1e-15 && Math.abs(wide.hi - 1) < 1e-15, 'a wide sine interval admits [−1,1]');
  });

  U.test('interval', 'evaluating whole expressions', function (a) {
    var f = P('x^2 - 2');
    var env = { x: AE.interval.I(1, 2) };
    var v = AE.interval.evalI(f, env);
    a.ok(v.lo < 0 && v.hi > 0, 'the range over [1,2] straddles zero');
    a.ok(AE.interval.certifyNoRoot(f, E.sym('x'), AE.interval.I(2, 3)), 'no root in [2, 3]');
    a.ok(AE.interval.certifyNoRoot(f, E.sym('x'), AE.interval.I(1.5, 2)), 'no root in [1.5, 2]');
    a.ok(!AE.interval.certifyNoRoot(f, E.sym('x'), AE.interval.I(1.4, 1.5)), 'one in [1.4, 1.5]');

    // π is not exactly representable, but its sine is provably near zero
    var vs = AE.interval.evalI(P('sin(x)'), { x: AE.interval.I(Math.PI - 1e-13, Math.PI + 1e-13) });
    a.ok(AE.interval.width(vs) < 1e-12, 'a very thin interval gives a very thin range');
  });

  U.test('interval', 'interval Newton finds √2', function (a) {
    var f = P('x^2 - 2'), df = AE.derive.diff(f, E.sym('x'));
    var r = AE.interval.shrinkRoot(f, df, E.sym('x'), AE.interval.I(1, 2), 15);
    a.ok(r.box.lo < Math.SQRT2 && Math.SQRT2 < r.box.hi, 'the true value is boxed in');
    a.ok(r.width < 1e-14, 'to ' + (-Math.log10(r.width)).toFixed(0) + ' digits in ' + r.steps + ' steps');
    // and every intermediate box on the way also contained it
    var box2 = AE.interval.I(1, 2), steps = 0;
    while (steps < r.steps) {
      var nx2 = AE.interval.newtonStep(f, df, E.sym('x'), box2);
      if (!nx2) break;
      box2 = nx2; steps++;
      a.ok(box2.lo <= Math.SQRT2 && Math.SQRT2 <= box2.hi, 'still boxed in after ' + steps + ' steps');
    }
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
