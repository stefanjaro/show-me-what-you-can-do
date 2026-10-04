/* ALETHEIA — differentiation.
 *
 * Complete for every function the engine knows, including the chain rule,
 * and it keeps derivatives of unknown functions symbolic (write f(x) and the
 * answer contains f′(x)) because pretending to know is worse than not knowing.
 *
 * Every step can be recorded, and the recorded steps are what the UI shows
 * when you ask it to "show the work".
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E;
  var S = AE.simplify;

  var ONE_OVER = { '1/': true };

  /* classic derivatives of the named unary functions: name → [resultBuilder] */
  var DERIV = {
    sin: function (u) { return E.fun('cos', [u]); },
    cos: function (u) { return E.neg(E.fun('sin', [u])); },
    tan: function (u) { return E.pow(E.fun('sec', [u]), E.int(2)); },
    cot: function (u) { return E.neg(E.pow(E.fun('csc', [u]), E.int(2))); },
    sec: function (u) { return E.mul(E.fun('sec', [u]), E.fun('tan', [u])); },
    csc: function (u) { return E.neg(E.mul(E.fun('csc', [u]), E.fun('cot', [u]))); },
    asin: function (u) { return E.div(E.ONE, E.pow(E.sub(E.ONE, E.pow(u, E.int(2))), E.rational(1, 2))); },
    acos: function (u) { return E.neg(E.div(E.ONE, E.pow(E.sub(E.ONE, E.pow(u, E.int(2))), E.rational(1, 2)))); },
    atan: function (u) { return E.div(E.ONE, E.add(E.ONE, E.pow(u, E.int(2)))); },
    acot: function (u) { return E.neg(E.div(E.ONE, E.add(E.ONE, E.pow(u, E.int(2))))); },
    sinh: function (u) { return E.fun('cosh', [u]); },
    cosh: function (u) { return E.fun('sinh', [u]); },
    tanh: function (u) { return E.sub(E.ONE, E.pow(E.fun('tanh', [u]), E.int(2))); },
    asinh: function (u) { return E.div(E.ONE, E.pow(E.add(E.pow(u, E.int(2)), E.ONE), E.rational(1, 2))); },
    acosh: function (u) { return E.div(E.ONE, E.pow(E.sub(E.pow(u, E.int(2)), E.ONE), E.rational(1, 2))); },
    atanh: function (u) { return E.div(E.ONE, E.sub(E.ONE, E.pow(u, E.int(2)))); },
    exp: function (u) { return E.fun('exp', [u]); },
    ln: function (u) { return E.div(E.ONE, u); },
    sqrt: function (u) { return E.div(E.ONE, E.mul(E.int(2), u)); },
    erf: function (u) { return E.div(E.mul(E.int(2), E.fun('exp', [E.neg(E.pow(u, E.int(2)))])), E.pow(E.sym('pi'), E.rational(1, 2))); },
    abs: function (u) { return E.mul(E.fun('sign', [u]), E.ONE); }
  };

  function d_(e, x, trace) {
    var hx = E.hash(x);
    switch (e.t) {
      case 'num': case 'inf': case 'nan': return E.ZERO;
      case 'sym': return E.hash(e) === hx ? E.ONE : E.ZERO;
      case 'add': {
        var terms = e.args.map(function (t) { return d_(t, x, trace); });
        for (var i = 0; i < terms.length; i++) if (E.isZero(terms[i])) terms.splice(i, 1), i--;
        if (terms.length === 0) return E.ZERO;
        if (!E.isZero(terms.find(function (t) { return !E.isZero(t); }) || E.ZERO)) { /* no-op */ }
        return E.add.apply(null, terms);
      }
      case 'mul': {
        // product rule over n factors: Σ fᵢ′∏_{j≠i} f_j
        var out = [];
        for (i = 0; i < e.args.length; i++) {
          var rest = e.args.slice();
          var di = d_(rest[i], x, trace);
          if (E.isZero(di)) continue;
          rest.splice(i, 1);
          if (rest.length === 0) out.push(di);
          else out.push(E.mul(di, rest.length === 1 ? rest[0] : E.mul.apply(null, rest)));
        }
        if (out.length === 0) return E.ZERO;
        var res = E.add.apply(null, out);
        if (trace) trace.push({ from: e, to: res, rule: 'product rule', note: 'd(uv) = u′v + uv′' });
        return res;
      }
      case 'pow': {
        var b = e.b, ex = e.e;
        var db = d_(b, x, trace), de = d_(ex, x, trace);
        var res2;
        if (E.isZero(de)) {
          // power rule + chain rule
          if (E.isZero(db)) return E.ZERO;
          res2 = E.mul(ex, db, E.pow(b, E.sub(ex, E.ONE)));
          if (trace) trace.push({ from: e, to: res2, rule: 'chain rule on u^n', note: '' });
        } else if (E.isZero(db)) {
          // b constant: b^e · ln(b) · e′
          res2 = E.mul(E.pow(b, ex), E.fun('ln', [b]), de);
          if (trace) trace.push({ from: e, to: res2, rule: 'exponential rule', note: 'd(aᵘ) = aᵘ ln(a) u′' });
        } else {
          // general: u^v = exp(v ln u)
          var inner = E.mul(E.fun('ln', [b]), ex);
          res2 = E.mul(E.pow(b, ex), d_(inner, x, trace));
          if (trace) trace.push({ from: e, to: res2, rule: 'rewrite uᵛ as exp(v ln u)', note: '' });
        }
        return res2;
      }
      case 'fun': {
        var args = e.args, name = e.name;
        if (args.length === 1) {
          var u = args[0], du = d_(u, x, trace);
          if (DERIV[name]) {
            var prime = DERIV[name](u);
            if (E.isZero(du)) return E.ZERO;
            var r = E.isOne(du) ? prime : E.mul(prime, du);
            if (trace) trace.push({ from: e, to: r, rule: 'derivative of ' + name, note: 'with the chain rule' });
            return r;
          }
          if (name === 'abs') return E.mul(E.fun('sign', [u]), du);
          if (name === 'sign' || name === 'floor' || name === 'ceil' || name === 'round') return E.ZERO;
          if (name === 'gamma') return E.mul(E.fun('gamma', [u]), prime0('digamma', u), du);
          // unknown function: leave it as D(f)(u)·u′
          var dfun = E.fun('D', [E.fun(name, [u])]);
          var out2 = E.isOne(du) ? dfun : E.mul(dfun, du);
          if (trace) trace.push({ from: e, to: out2, rule: 'unknown function', note: 'kept symbolic as ' + name + '′' });
          return out2;
        }
        if (name === 'mod' || name === 'min' || name === 'max') return E.ZERO;
        if (name === 'hypot' || name === 'atan2' || name === 'binomial') return E.ZERO;
        return null_derivative(e, x);
      }
      case 'der': return E.deriv(e.f, e.x, e.n + 1);
      case 'int': return e.f;                 // d/dx ∫ f dx = f
      case 'ord': return null_derivative(e, x);
      default: return null_derivative(e, x);
    }
  }
  function prime0(name, u) { return E.fun(name, [u]); }
  function null_derivative(e, x) {
    if (!E.depends(e, x)) return E.ZERO;
    return E.deriv(e, x, 1);                 // unevaluated, honest
  }

  function diff(e, x, opts) {
    opts = opts || {};
    x = x || E.sym('x');
    if (typeof x === 'string') x = E.sym(x);
    if (!(x.t === 'sym')) x = E.sym('x');
    var trace = opts.trace ? (opts.trace || []) : null;
    var n = opts.n || 1;
    var out = E.toExpr(e);
    for (var i = 0; i < n; i++) {
      out = d_(out, x, trace);
      if (opts.simplify !== false && S) out = S.simplify(out);
    }
    return out;
  }
  /* convenience: dⁿf/dxⁿ evaluated at a point, numerically later */
  function diffAt(e, x, point, n) {
    var d = diff(e, x, { n: n || 1 });
    return AE.numeric ? AE.numeric.evalExpr(E.subst(d, x, E.num(AE.rat(point)))) : null;
  }

  AE.derive = { diff: diff, raw: d_, table: DERIV, needsHas: ONE_OVER };

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function D(s, n) { return AE.print.text(diff(AE.parse(s), E.sym('x'), { n: n })); }

  U.test('derive', 'rules', function (a) {
    a.eq(D('x^2'), '2*x', 'power rule');
    a.eq(D('x^n'), 'n*x^(n - 1)', 'symbolic exponent');
    a.eq(D('sin(x)'), 'cos(x)', 'sine');
    a.eq(D('cos(x)'), '-sin(x)', 'cosine');
    a.eq(D('exp(x)'), 'exp(x)', 'exponential');
    a.eq(D('ln(x)'), '1/x', 'logarithm');
    a.eq(D('tan(x)'), 'sec(x)^2', 'tangent');
    a.eq(D('3*x^4 - 2*x + 7'), '12*x^3 - 2', 'linearity');
    a.eq(D('sin(x^2)'), '2*x*cos(x^2)', 'chain rule');
    a.eq(D('x*sin(x)'), 'x*cos(x) + sin(x)', 'product rule');
    a.eq(D('exp(x)*x^2'), 'x^2*exp(x) + 2*x*exp(x)', 'product rule again');
    a.eq(D('y'), '0', 'other variables vanish');
    a.eq(D('a*x^2'), '2*a*x', 'parameter');
  });

  U.test('derive', 'unknown functions stay symbolic', function (a) {
    a.eq(D('f(x)^2'), '2*D(f(x))*f(x)', 'unknown derivative');
    a.eq(D('sin(f(x))'), 'D(f(x))*cos(f(x))', 'composition with unknown');
  });

  U.test('derive', 'higher order', function (a) {
    a.eq(D('x^4', 2), '12*x^2', 'second derivative');
    a.eq(D('x^5', 5), '120', 'fifth derivative');
    a.eq(D('sin(x)', 4), 'sin(x)', 'sine cycles');
    a.eq(D('exp(x)*x', 3), 'x*exp(x) + 3*exp(x)', 'repeated product rule');
  });

  U.test('derive', 'inverse and hyperbolic functions', function (a) {
    a.eq(D('atan(x)'), '1/(x^2 + 1)', 'arctangent');
    a.eq(D('asin(x)'), '1/sqrt(-x^2 + 1)', 'arcsine');
    a.eq(D('sinh(x)'), 'cosh(x)', 'sinh');
    a.eq(D('sqrt(x)'), '1/(2*sqrt(x))', 'square root');
    a.eq(D('ln(sin(x))'), 'cos(x)/sin(x)', 'chain rule on log');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
