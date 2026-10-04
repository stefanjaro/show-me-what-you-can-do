/* ALETHEIA — the expression language.
 *
 * A symbolic expression is a small immutable tree. Every node carries a
 * canonical hash, so structural equality is a string compare: that single fact
 * is what makes the integrator, simplifier and prover fast enough to run in a
 * browser tab.
 *
 * Node kinds
 *   num   rational constant          {t:'num',  v:Rat}
 *   sym   symbol / named constant    {t:'sym',  name}
 *   add   n-ary sum                  {t:'add',  args}
 *   mul   n-ary product              {t:'mul',  args}
 *   pow   power                      {t:'pow',  b, e}
 *   fun   named function             {t:'fun',  name, args}
 *   der   unevaluated derivative     {t:'der',  f, x, n}
 *   int   unevaluated integral       {t:'int',  f, x}
 *   ord   truncation term O(x^n)     {t:'ord',  x, n}
 *   inf   signed infinity            {t:'inf',  s}
 *   nan   indeterminate              {t:'nan'}
 *   vec / mat                        {t:'vec', items} {t:'mat', rows}
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, rat = AE.rat, bigRoot = AE.bigRoot;

  var ZERO, ONE, MONE, HALF;

  /* ── known symbols that are not variables ───────────────────────────── */
  var CONSTS = {
    pi: true, 'π': true, tau: true, 'τ': true, e: true, i: true, phi: true,
    gamma: 'EulerGamma', 'γ': 'EulerGamma', Infinity: true, '∞': true, true_: true
  };
  function constName(n) { return CONSTS[n] === 'EulerGamma' ? 'EulerGamma' : n; }

  /* ── function signature table (arity -1 = variadic) ─────────────────── */
  var FUNCS = {
    sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1,
    asin: 1, acos: 1, atan: 1, acot: 1,
    sinh: 1, cosh: 1, tanh: 1, coth: 1, asinh: 1, acosh: 1, atanh: 1,
    exp: 1, ln: 1, log: -1, sqrt: 1, cbrt: 1, abs: 1, sign: 1,
    floor: 1, ceil: 1, round: 1,
    erf: 1, erfc: 1, gamma: 1, zeta: -1, lambertw: 1,
    min: -1, max: -1, gcd: -1, lcm: -1, mod: 2, hypot: 2, atan2: 2, binomial: 2
  };
  /* functions whose numeric value we can compute (complex-aware) */
  var EVALUABLE = {};

  var ORDER = {
    num: 0, sym: 1, pow: 2, mul: 3, add: 4, der: 5, int: 5, ord: 5,
    fun: 6, vec: 7, mat: 7, inf: 8, nan: 9
  };

  function mk(t, o) { o.t = t; return o; }

  /* ── smart constructors ─────────────────────────────────────────────── */
  function num(v) {
    var r = v instanceof Rat ? v : rat(v);
    return mk('num', { v: r });
  }
  function int(v) { return num(typeof v === 'bigint' ? Rat.int(v) : Rat.int(v)); }
  function rational(a, b) { return num(new Rat(BigInt(a), BigInt(b))); }
  function sym(name) { return mk('sym', { name: constName(name) }); }
  function vec(items) { return mk('vec', { items: items }); }
  function mat(rows) { return mk('mat', { rows: rows }); }
  function inf(s) { return mk('inf', { s: s === undefined ? 1 : s }); }
  function NAN() { return mk('nan', {}); }
  function orderTerm(x, n) { return mk('ord', { x: x, n: n === undefined ? 1 : n }); }

  /* helper: pull the numeric trailing coefficient off an add */
  function isAdd(e) { return e.t === 'add'; }
  function isMul(e) { return e.t === 'mul'; }

  function collectAdd(e, out) {
    if (e.t === 'add') { for (var i = 0; i < e.args.length; i++) collectAdd(e.args[i], out); return; }
    out.push(e);
  }
  function monomialOf(t) {          // strip numeric coefficient: -6*x^2 → (coeff -6, rest x^2)
    if (t.t === 'mul') {
      var c = Rat.ONE, rest = [];
      for (var i = 0; i < t.args.length; i++) {
        if (t.args[i].t === 'num') c = c.mul(t.args[i].v); else rest.push(t.args[i]);
      }
      return { c: c, r: rest };
    }
    if (t.t === 'num') return { c: t.v, r: [] };
    return { c: Rat.ONE, r: [t] };
  }
  function add() {
    var flat = [], i, j;
    for (i = 0; i < arguments.length; i++) {
      var a0 = arguments[i];
      if (a0 == null) continue;
      if (Array.isArray(a0)) flat = flat.concat(a0); else flat.push(a0);
    }
    var atoms = [];
    for (i = 0; i < flat.length; i++) {
      var e = toExpr(flat[i]);
      if (e.t === 'nan') return e;
      collectAdd(e, atoms);
    }
    // group like terms: 2x + 3x → 5x,  x + x → 2x
    var keys = [], groups = [], carry = Rat.ZERO;
    for (i = 0; i < atoms.length; i++) {
      var at = atoms[i];
      if (at.t === 'num') { carry = carry.add(at.v); continue; }
      var m = monomialOf(at);
      var part = m.r.length === 0 ? null : (m.r.length === 1 ? m.r[0] : mul.apply(null, m.r));
      var key = part === null ? '@const' : hash(part);
      var slot = -1;
      for (j = 0; j < keys.length; j++) if (keys[j] === key) { slot = j; break; }
      if (slot < 0) { keys.push(key); groups.push({ part: part, c: m.c }); }
      else groups[slot].c = groups[slot].c.add(m.c);
    }
    var terms = [];
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g.c.isZero()) continue;
      if (g.part === null) { carry = carry.add(g.c); continue; }
      terms.push(g.c.isOne() ? g.part : mul(num(g.c), g.part));
    }
    terms.sort(cmp);
    if (!carry.isZero()) terms.push(num(carry)); else if (terms.length === 0) return ZERO;
    if (terms.length === 1) return terms[0];
    return mk('add', { args: terms });
  }

  function mul() {
    var flat = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a == null) continue;
      if (Array.isArray(a)) flat = flat.concat(a); else flat.push(a);
    }
    var coeff = Rat.ONE, factors = [], i2, j2;
    for (i2 = 0; i2 < flat.length; i2++) {
      var e = toExpr(flat[i2]);
      if (e.t === 'nan') return e;
      if (e.t === 'num') {
        coeff = coeff.mul(e.v);
        if (coeff.isZero()) return ZERO;
        continue;
      }
      if (isMul(e)) {
        for (j2 = 0; j2 < e.args.length; j2++) {
          if (e.args[j2].t === 'num') coeff = coeff.mul(e.args[j2].v); else factors.push(e.args[j2]);
        }
        continue;
      }
      factors.push(e);
    }
    if (coeff.isZero()) return ZERO;
    // combine equal bases into powers:  x*x^2 → x^3
    var buckets = [], exps = [];
    for (i2 = 0; i2 < factors.length; i2++) {
      var f = factors[i2], base = f, ex = Rat.ONE;
      if (f.t === 'pow' && f.e.t === 'num') { base = f.b; ex = f.e.v; }
      var found = -1;
      for (j2 = 0; j2 < buckets.length; j2++) if (eqq(buckets[j2], base)) { found = j2; break; }
      if (found >= 0) exps[found] = exps[found].add(ex);
      else { buckets.push(base); exps.push(ex); }
    }
    var out = [];
    for (i2 = 0; i2 < buckets.length; i2++) {
      var ee = exps[i2];
      if (ee.isZero()) continue;
      if (ee.isOne()) out.push(buckets[i2]);
      else out.push(pow(buckets[i2], num(ee)));
    }
    out.sort(cmp);
    if (!coeff.isOne()) out.unshift(num(coeff));
    if (out.length === 0) return ONE;
    if (out.length === 1) return out[0];
    return mk('mul', { args: out });
  }

  function pow(b, e) {
    b = toExpr(b); e = toExpr(e);
    if (b.t === 'nan' || e.t === 'nan') return NAN();
    if (e.t === 'num') {
      if (e.v.isZero()) return ONE;
      if (e.v.isOne()) return b;
      if (b.t === 'num') {
        if (b.v.isZero()) return e.v.sign() > 0 ? ZERO : NAN();
        if (b.v.isOne()) return ONE;
        var isInt = e.v.isInt(), bi = e.v.n;
        if (isInt) return num(b.v.pow(bi));
        // b^(p/q): exact whenever the q-th root of b is rational again
        if (b.v.sign() > 0) {
          var qn = Number(e.v.d);
          var rn = bigRoot(b.v.n, qn), rd = bigRoot(b.v.d, qn);
          if (rn !== null && rd !== null) {
            var baseR = new Rat(rn, rd);
            if (baseR.pow(e.v.d).eq(b.v)) return num(baseR.pow(e.v.n));
          }
        }
        // anything else stays symbolic and exact: 2^(1/2) never becomes 1.414...
        return mk('pow', { b: b, e: e });
      }
      if (b.t === 'pow' && (e.v.isInt())) {              // (x^a)^n → x^(a*n)
        var newe = mul(b.e, e);
        return pow(b.b, simplifyExponent(newe));
      }
      if (b.t === 'inf') return b.s > 0 ? (e.v.sign() > 0 ? inf(1) : ZERO) : NAN();
      return mk('pow', { b: b, e: e });
    }
    return mk('pow', { b: b, e: e });
  }
  function simplifyExponent(e) { return e; }

  function fun(name, args) {
    if (!Array.isArray(args)) args = [args];
    var ar = FUNCS[name];
    if (ar !== undefined && ar > 0 && args.length !== ar) {
      throw new Error(name + ' expects ' + ar + ' argument(s), got ' + args.length);
    }
    var as = [], i;
    for (i = 0; i < args.length; i++) {
      var v = toExpr(args[i]);
      if (v.t === 'nan') return v;
      as.push(v);
    }
    // a few identities that are always true
    if (name === 'abs' && as[0].t === 'num') return num(as[0].v.abs());
    if (name === 'sqrt' && as[0].t === 'num' && as[0].v.sign() >= 0) {
      var s = as[0].v.sqrt(); if (s) return num(s);
    }
    if (name === 'sqrt') return pow(as[0], rational(1, 2));
    if (name === 'ln' && as[0].t === 'num' && as[0].v.isOne()) return ZERO;
    if (name === 'ln' && as[0].t === 'sym' && as[0].name === 'e') return ONE;
    if (name === 'exp' && as[0].t === 'num' && as[0].v.isZero()) return ONE;
    if ((name === 'sin' || name === 'tan') && as[0].t === 'num' && as[0].v.isZero()) return ZERO;
    if (name === 'cos' && as[0].t === 'num' && as[0].v.isZero()) return ONE;
    if (name === 'floor' && as[0].t === 'num') return num(as[0].v.floor());
    if (name === 'ceil' && as[0].t === 'num') return num(as[0].v.ceil());
    if (name === 'round' && as[0].t === 'num') return num(as[0].v.round());
    return mk('fun', { name: name, args: as });
  }
  function deriv(f, x, n) { return mk('der', { f: toExpr(f), x: toExpr(x), n: n === undefined ? 1 : n }); }
  function integ(f, x) { return mk('int', { f: toExpr(f), x: toExpr(x) }); }

  function div(a, b) { return mul(a, pow(b, num(Rat.MONE))); }
  function neg(a) { return mul(MONE, a); }
  function sub(a, b) { return add(a, neg(b)); }

  /* ── coercion ───────────────────────────────────────────────────────── */
  function toExpr(x) {
    if (x === null || x === undefined) return NAN();
    if (x.t && x.v !== undefined && ORDER[x.t] !== undefined) { if (x.t === 'num' && !(x.v instanceof Rat)) return num(x.v); return x; }
    if (x.t && ORDER[x.t] !== undefined) return x;
    if (typeof x === 'number') return num(Rat.fromFloat(x));
    if (typeof x === 'bigint') return num(Rat.int(x));
    if (x instanceof Rat) return num(x);
    if (typeof x === 'string') return sym(x);
    if (Array.isArray(x)) return vec(x.map(toExpr));
    throw new Error('toExpr: cannot coerce ' + x);
  }

  /* ── canonical hash & structural equality ───────────────────────────── */
  var hashCache = new WeakMap();
  function hash(e) {
    var c = hashCache.get(e);
    if (c !== undefined) return c;
    var h;
    switch (e.t) {
      case 'num': h = '#' + e.v.hash(); break;
      case 'sym': h = '@' + e.name; break;
      case 'inf': h = e.s > 0 ? '+inf' : '-inf'; break;
      case 'nan': h = '?nan'; break;
      case 'add': h = '+(' + e.args.map(hash).join(',') + ')'; break;
      case 'mul': h = '*(' + e.args.map(hash).join(',') + ')'; break;
      case 'pow': h = '^(' + hash(e.b) + ',' + hash(e.e) + ')'; break;
      case 'fun': h = e.name + '(' + e.args.map(hash).join(',') + ')'; break;
      case 'der': h = 'D[' + hash(e.x) + ',' + e.n + ']' + hash(e.f); break;
      case 'int': h = 'I[' + hash(e.x) + ']' + hash(e.f); break;
      case 'ord': h = 'O[' + hash(e.x) + '^' + e.n + ']'; break;
      case 'vec': h = 'vec(' + e.items.map(hash).join(',') + ')'; break;
      case 'mat': h = 'mat(' + e.rows.map(function (r) { return r.map(hash).join(','); }).join(';') + ')'; break;
      default: h = '?';
    }
    hashCache.set(e, h);
    return h;
  }
  function eqq(a, b) { return a === b || hash(a) === hash(b); }
  function factorInfo(f) {
    if (f.t === 'sym') return { v: '@' + f.name, e: 1 };
    if (f.t === 'pow' && f.b.t === 'sym' && f.e.t === 'num') return { v: '@' + f.b.name, e: f.e.v.toNumber() };
    return null;
  }
  function cmp(a, b) {
    var fa = factorInfo(a), fb = factorInfo(b);
    if (fa && fb) {
      if (fa.v !== fb.v) return fa.v < fb.v ? -1 : 1;
      return fa.e - fb.e;
    }
    if (fa || fb) return fa ? -1 : 1;
    var ra = ORDER[a.t], rb = ORDER[b.t];
    if (ra !== rb) return ra - rb;
    var ha = hash(a), hb = hash(b);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  }

  /* ── predicates & accessors ─────────────────────────────────────────── */
  function isNum(e) { return e.t === 'num'; }
  function isZero(e) { return e.t === 'num' && e.v.isZero(); }
  function isOne(e) { return e.t === 'num' && e.v.isOne(); }
  function isSym(e) { return e.t === 'sym'; }
  function isConst(e) { return e.t === 'sym' && (CONSTS[e.name] !== undefined); }
  function isInfinity(e) { return e.t === 'inf'; }
  function isAddNode(e) { return e.t === 'add'; }
  function isMulNode(e) { return e.t === 'mul'; }
  function isPow(e) { return e.t === 'pow'; }
  function isFun(e, name) { return e.t === 'fun' && (name === undefined || e.name === name); }
  function arg(e, i) { return e.args[i]; }
  function nargs(e) { return (e.args || []).length; }
  function value(e) { return e.v; }

  /* does `e` contain symbol x anywhere? */
  function depends(e, x) {
    var hx = hash(x), found = false;
    walk(e, function (n) { if (!found && n.t === 'sym' && hash(n) === hx) found = true; });
    return found;
  }
  function hasAny(e, names) {
    var set = {}, i, found = false;
    for (i = 0; i < names.length; i++) set[hash(toExpr(names[i]))] = true;
    walk(e, function (n) { if (n.t === 'sym' && set[hash(n)]) found = true; });
    return found;
  }
  /* free variables, in canonical order, excluding declared constants */
  function freeVars(e) {
    var seen = Object.create(null), out = [];
    walk(e, function (n) {
      if (n.t === 'sym' && !isConst(n) && !seen[n.name]) { seen[n.name] = true; out.push(n); }
    });
    out.sort(cmp);
    return out;
  }
  /* all distinct subexpressions, deepest first (post-order) */
  function subexpressions(e) {
    var out = [];
    walk(e, function (n) { out.push(n); });
    return out;
  }

  /* ── traversal ──────────────────────────────────────────────────────── */
  /* post-order walk: children before parents */
  function walk(e, fn, parent) {
    switch (e.t) {
      case 'add': case 'mul': case 'fun':
        for (var i = 0; i < e.args.length; i++) walk(e.args[i], fn, e);
        break;
      case 'pow': walk(e.b, fn, e); walk(e.e, fn, e); break;
      case 'der': walk(e.f, fn, e); walk(e.x, fn, e); break;
      case 'int': walk(e.f, fn, e); walk(e.x, fn, e); break;
      case 'ord': walk(e.x, fn, e); break;
      case 'vec': for (i = 0; i < e.items.length; i++) walk(e.items[i], fn, e); break;
      case 'mat': for (i = 0; i < e.rows.length; i++) for (var j = 0; j < e.rows[i].length; j++) walk(e.rows[i][j], fn, e); break;
      default: break;
    }
    fn(e, parent);
    return e;
  }
  /* rebuild with a transformation applied bottom-up */
  function rewrite(e, fn) {
    var ne;
    switch (e.t) {
      case 'add': {
        var as = e.args.map(function (a) { return rewrite(a, fn); });
        ne = add.apply(null, as); break;
      }
      case 'mul': {
        var ms = e.args.map(function (a) { return rewrite(a, fn); });
        ne = mul.apply(null, ms); break;
      }
      case 'pow': ne = pow(rewrite(e.b, fn), rewrite(e.e, fn)); break;
      case 'fun': ne = fun(e.name, e.args.map(function (a) { return rewrite(a, fn); })); break;
      case 'ord': ne = orderTerm(rewrite(e.x, fn), e.n); break;
      case 'der': ne = deriv(rewrite(e.f, fn), rewrite(e.x, fn), e.n); break;
      case 'int': ne = integ(rewrite(e.f, fn), rewrite(e.x, fn)); break;
      case 'vec': ne = vec(e.items.map(function (a) { return rewrite(a, fn); })); break;
      case 'mat': ne = mat(e.rows.map(function (r) { return r.map(function (a) { return rewrite(a, fn); }); })); break;
      default: ne = e;
    }
    return fn(ne);
  }
  /* substitute: map of symbol-name|Expr → Expr  (or (x,val) pair form) */
  function subst(e, map, val) {
    if (val !== undefined) { var m = {}; m[hash(toExpr(map))] = toExpr(val); map = m; }
    return rewrite(e, function (n) {
      if (n.t !== 'sym') return n;
      var r = map[hash(n)];
      return r === undefined ? n : r;
    });
  }
  function size(e) { var n = 0; walk(e, function () { n++; }); return n; }

  /* ── structural helpers used everywhere later ───────────────────────── */
  /* split a product into (numeric coefficient, non-numeric factors) */
  function asProduct(e) {
    if (e.t === 'mul') {
      var c = Rat.ONE, rest = [];
      for (var i = 0; i < e.args.length; i++) {
        if (e.args[i].t === 'num') c = c.mul(e.args[i].v); else rest.push(e.args[i]);
      }
      return { coeff: c, rest: rest };
    }
    if (e.t === 'num') return { coeff: e.v, rest: [] };
    return { coeff: Rat.ONE, rest: [e] };
  }
  /* split a sum into (terms, constant part) */
  function asSum(e) {
    if (e.t === 'add') {
      var terms = [], c = Rat.ZERO;
      for (var i = 0; i < e.args.length; i++) {
        if (e.args[i].t === 'num') c = c.add(e.args[i].v); else terms.push(e.args[i]);
      }
      return { terms: terms, c: c };
    }
    return { terms: [e], c: Rat.ZERO };
  }
  function coefficientOf(e, x) {          /* e as polynomial part times x? see poly.js */
    return null;
  }

  ZERO = mk('num', { v: Rat.ZERO });
  ONE = mk('num', { v: Rat.ONE });
  MONE = mk('num', { v: Rat.MONE });
  HALF = mk('num', { v: Rat.HALF });

  var E = {
    num: num, int: int, rational: rational, sym: sym, add: add, mul: mul, pow: pow,
    div: div, neg: neg, sub: sub, fun: fun, deriv: deriv, integ: integ, vec: vec, mat: mat,
    inf: inf, nan: NAN, orderTerm: orderTerm, toExpr: toExpr, of: toExpr,
    hash: hash, eqq: eqq, cmp: cmp, walk: walk, rewrite: rewrite, subst: subst, size: size,
    depends: depends, hasAny: hasAny, freeVars: freeVars, subexpressions: subexpressions,
    asProduct: asProduct, asSum: asSum,
    isNum: isNum, isZero: isZero, isOne: isOne, isSym: isSym, isConst: isConst,
    isInfinity: isInfinity, isAddNode: isAddNode, isMulNode: isMulNode, isPow: isPow, isFun: isFun,
    arg: arg, nargs: nargs, value: value,
    FUNCS: FUNCS, CONSTS: CONSTS, ORDER: ORDER,
    ZERO: ZERO, ONE: ONE, MONE: MONE, HALF: HALF, EVALUABLE: EVALUABLE,
    pi: sym('pi'), e: sym('e'), i: sym('i'), x: sym('x'), y: sym('y')
  };
  AE.E = E;
  AE.expr = E;

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  U.test('expr', 'canonical form', function (a) {
    a.ok(E.eqq(E.add(E.sym('x'), E.sym('y')), E.add(E.sym('y'), E.sym('x'))), 'commutativity canonicalised');
    a.ok(E.eqq(E.mul(E.sym('x'), E.sym('x')), E.pow(E.sym('x'), E.int(2))), 'x*x = x^2');
    a.ok(E.eqq(E.mul(E.pow(E.sym('x'), E.int(2)), E.sym('x')), E.pow(E.sym('x'), E.int(3))), 'x^2*x = x^3');
    a.ok(E.eqq(E.add(E.mul(E.int(2), E.sym('x')), E.mul(E.int(3), E.sym('x'))), E.mul(E.int(5), E.sym('x'))), 'like terms');
    a.ok(E.eqq(E.mul(E.num(Rat.parse('2/3')), E.num(Rat.parse('3/2'))), E.ONE), 'exact rational cancel');
    a.ok(E.eqq(E.pow(E.int(2), E.int(10)), E.int(1024)), '2^10');
    a.ok(E.eqq(E.pow(E.int(8), E.rational(1, 3)), E.int(2)), '8^(1/3)=2');
    a.eq(E.pow(E.int(2), E.rational(1, 2)).t, 'pow', 'irrational stays exact');
    a.ok(E.eqq(E.fun('sqrt', [E.int(4)]), E.int(2)), 'sqrt(4)=2');
    a.ok(E.eqq(E.fun('sqrt', [E.sym('x')]), E.pow(E.sym('x'), E.rational(1, 2))), 'sqrt canonicalises');
    a.ok(E.eqq(E.pow(E.pow(E.sym('x'), E.int(2)), E.int(3)), E.pow(E.sym('x'), E.int(6))), '(x^2)^3');
    a.ok(E.eqq(E.mul(E.ZERO, E.sym('x')), E.ZERO), 'zero absorbing');
    a.ok(E.eqq(E.div(E.int(1), E.int(2)), E.rational(1, 2)), 'division');
  });

  U.test('expr', 'exactness', function (a) {
    var big = Rat.int(10n ** 30n);
    a.eq(E.add(E.num(big), E.ONE).v.toString(), '1000000000000000000000000000001', '30-digit exact add');
    a.eq(E.mul(E.num(Rat.parse('1/3')), E.int(3)).t, 'num', '1/3*3 collapses');
    a.eq(E.mul(E.num(Rat.parse('1/3')), E.int(3)).v.toString(), '1');
    a.eq(E.div(E.int(1), E.num(Rat.parse('3'))).t, 'num');
  });

  U.test('expr', 'traversal', function (a) {
    var e = E.add(E.pow(E.sym('x'), E.int(2)), E.mul(E.int(3), E.fun('sin', [E.sym('y')])), E.int(1));
    a.eq(E.freeVars(e).map(function (s) { return s.name; }).join(','), 'x,y');
    a.ok(E.depends(e, E.sym('x')) && E.depends(e, E.sym('y')) && !E.depends(e, E.sym('z')), 'depends');
    a.eq(E.size(e), 9, 'node count');
    var subbed = E.subst(e, E.sym('x'), E.int(2));
    a.ok(E.eqq(subbed, E.add(E.int(4), E.mul(E.int(3), E.fun('sin', [E.sym('y')])), E.int(1))), 'substitution');
    a.ok(E.isNum(E.subst(E.pow(E.sym('x'), E.int(2)), E.sym('x'), E.int(5))), 'substitution evaluates');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
