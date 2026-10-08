/* ==========================================================================
   THE BLIND PHYSICIST · expr.js
   Expression trees: parse, evaluate, simplify, compile, print.

   A tree is a plain object with one fixed shape so it can be rewritten
   in place during evolution:
     t  'c' constant (v)       'x' input variable (i)
     t  'u' unary  (op, a)     'b' binary (op, a, b)
   Unary ops:  sin cos exp log sqrt abs neg
   Binary ops: + - * /   (and ^, which only typed formulas may use)
   ========================================================================== */
(function () {
  'use strict';
  var BP = globalThis.BP || (globalThis.BP = {});

  // Protected operators: every function is total on the reals, so random
  // programs can never throw. Non-finite results are caught by the fitness.
  var UF = {
    sin: function (x) { return Math.sin(x); },
    cos: function (x) { return Math.cos(x); },
    exp: function (x) { return Math.exp(x > 60 ? 60 : (x < -60 ? -60 : x)); },
    log: function (x) { return Math.log(Math.abs(x) + 1e-12); },
    sqrt: function (x) { return Math.sqrt(Math.abs(x)); },
    abs: function (x) { return Math.abs(x); },
    neg: function (x) { return -x; },
    sq: function (x) { return x * x; },
    cube: function (x) { return x * x * x; }
  };
  var BF = {
    '+': function (a, b) { return a + b; },
    '-': function (a, b) { return a - b; },
    '*': function (a, b) { return a * b; },
    '/': function (a, b) { return (b > 1e-12 || b < -1e-12) ? a / b : 1; },
    '^': function (a, b) { return Math.pow(a, b); }
  };
  var OPC = { c: 0, x: 1, neg: 2, sin: 3, cos: 4, exp: 5, log: 6, sqrt: 7, abs: 8,
              '+': 9, '-': 10, '*': 11, '/': 12, '^': 13, sq: 14, cube: 15 };

  function mk(t, v, i, op, a, b) { return { t: t, v: v, i: i, op: op, a: a, b: b }; }
  function cst(v) { return mk('c', v, 0, null, null, null); }
  function inp(i) { return mk('x', 0, i, null, null, null); }
  function un(op, a) { return mk('u', 0, 0, op, a, null); }
  function bin(op, a, b) { return mk('b', 0, 0, op, a, b); }

  function ev(n, s) {
    switch (n.t) {
      case 'c': return n.v;
      case 'x': return s[n.i];
      case 'u': return UF[n.op](ev(n.a, s));
      default:  return BF[n.op](ev(n.a, s), ev(n.b, s));
    }
  }

  function clone(n) {
    switch (n.t) {
      case 'c': return cst(n.v);
      case 'x': return inp(n.i);
      case 'u': return un(n.op, clone(n.a));
      default:  return bin(n.op, clone(n.a), clone(n.b));
    }
  }

  // Pre-order list of every node (references, so they can be rewritten).
  function collect(n, out) {
    out = out || [];
    out.push(n);
    if (n.t === 'u') collect(n.a, out);
    else if (n.t === 'b') { collect(n.a, out); collect(n.b, out); }
    return out;
  }

  function size(n) { return collect(n).length; }

  function depthOf(n) {
    if (n.t === 'u') return 1 + depthOf(n.a);
    if (n.t === 'b') return 1 + Math.max(depthOf(n.a), depthOf(n.b));
    return 1;
  }

  function same(a, b) {
    if (a.t !== b.t) return false;
    switch (a.t) {
      case 'c': return a.v === b.v;
      case 'x': return a.i === b.i;
      case 'u': return a.op === b.op && same(a.a, b.a);
      default:  return a.op === b.op && same(a.a, b.a) && same(a.b, b.b);
    }
  }

  // Overwrite node dst with the contents of src (used for in-place mutation).
  function setNode(dst, src) {
    dst.t = src.t; dst.v = src.v; dst.i = src.i; dst.op = src.op; dst.a = src.a; dst.b = src.b;
  }

  function isC(n, v) { return n.t === 'c' && n.v === v; }

  // Bottom-up algebra: constant folding and identities that keep trees tidy,
  // so that complexity (node count) means something to the Pareto front.
  function simplify(n) {
    switch (n.t) {
      case 'c': case 'x': return n;
      case 'u': {
        var a = simplify(n.a);
        if (a.t === 'c') {
          var v = UF[n.op](a.v);
          if (isFinite(v)) return cst(v);
        }
        if (n.op === 'neg' && a.t === 'u' && a.op === 'neg') return a.a;
        // sqrt and log already work on |x|, and sqrt is never negative
        if ((n.op === 'sqrt' || n.op === 'log') && a.t === 'u' && a.op === 'abs') return un(n.op, a.a);
        if (n.op === 'abs' && a.t === 'u' && (a.op === 'abs' || a.op === 'sqrt')) return a;
        return un(n.op, a);
      }
      default: {
        var l = simplify(n.a), r = simplify(n.b);
        if (l.t === 'c' && r.t === 'c') {
          var w = BF[n.op](l.v, r.v);
          if (isFinite(w)) return cst(w);
        }
        switch (n.op) {
          case '+': if (isC(l, 0)) return r; if (isC(r, 0)) return l; break;
          case '-': if (isC(r, 0)) return l; if (same(l, r)) return cst(0); break;
          case '*':
            if (isC(l, 0) || isC(r, 0)) return cst(0);
            if (isC(l, 1)) return r;
            if (isC(r, 1)) return l;
            break;
          case '/':
            if (isC(r, 1)) return l;
            if (isC(l, 0)) return cst(0);
            if (same(l, r)) return cst(1);
            break;
        }
        return bin(n.op, l, r);
      }
    }
  }

  // Constants in left-to-right order (identical to the order compile() uses).
  function getConsts(n) {
    var out = [];
    collect(n).forEach(function (m) { if (m.t === 'c') out.push(m.v); });
    return out;
  }
  function setConsts(n, vals) {
    var k = 0;
    collect(n).forEach(function (m) { if (m.t === 'c') m.v = vals[k++]; });
  }

  // Compile a tree to a flat postfix program for vectorized evaluation.
  function compile(tree) {
    var ops = [], args = [], nc = 0, d = 0, maxd = 0;
    (function rec(n) {
      switch (n.t) {
        case 'c': ops.push(0); args.push(nc++); d++; break;
        case 'x': ops.push(1); args.push(n.i); d++; break;
        case 'u': rec(n.a); ops.push(OPC[n.op]); args.push(0); break;
        default:  rec(n.a); rec(n.b); ops.push(OPC[n.op]); args.push(0); d--; break;
      }
      if (d > maxd) maxd = d;
    })(tree);
    return { op: Int32Array.from(ops), arg: Int32Array.from(args), nc: nc, depth: maxd };
  }

  function makeScratch(depth, n) {
    var S = [];
    for (var i = 0; i <= depth; i++) S.push(new Float64Array(n));
    return S;
  }

  // Evaluate a compiled program over n samples. cols[i] is input i (length n),
  // th holds the constant values. Returns a view of scratch slot 0.
  function run(prog, th, cols, n, S) {
    var op = prog.op, arg = prog.arg, len = op.length, sp = 0;
    for (var i = 0; i < len; i++) {
      var o = op[i], k, a, b;
      switch (o) {
        case 0: S[sp++].fill(th[arg[i]], 0, n); break;
        case 1: S[sp++].set(cols[arg[i]]); break;
        case 2: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = -a[k]; break;
        case 3: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = Math.sin(a[k]); break;
        case 4: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = Math.cos(a[k]); break;
        case 5: a = S[sp - 1]; for (k = 0; k < n; k++) { var x = a[k]; a[k] = Math.exp(x > 60 ? 60 : (x < -60 ? -60 : x)); } break;
        case 6: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = Math.log(Math.abs(a[k]) + 1e-12); break;
        case 7: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = Math.sqrt(Math.abs(a[k])); break;
        case 8: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = Math.abs(a[k]); break;
        case 9:  a = S[sp - 2]; b = S[sp - 1]; for (k = 0; k < n; k++) a[k] += b[k]; sp--; break;
        case 10: a = S[sp - 2]; b = S[sp - 1]; for (k = 0; k < n; k++) a[k] -= b[k]; sp--; break;
        case 11: a = S[sp - 2]; b = S[sp - 1]; for (k = 0; k < n; k++) a[k] *= b[k]; sp--; break;
        case 12: a = S[sp - 2]; b = S[sp - 1];
          for (k = 0; k < n; k++) { var d = b[k]; a[k] = (d > 1e-12 || d < -1e-12) ? a[k] / d : 1; }
          sp--; break;
        case 13: a = S[sp - 2]; b = S[sp - 1]; for (k = 0; k < n; k++) a[k] = Math.pow(a[k], b[k]); sp--; break;
        case 14: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = a[k] * a[k]; break;
        case 15: a = S[sp - 1]; for (k = 0; k < n; k++) a[k] = a[k] * a[k] * a[k]; break;
      }
    }
    return S[0];
  }

  // ---- printing -----------------------------------------------------------
  // Compact number: three significant figures.
  function fmt(v) {
    if (v === 0) return '0';
    return String(Number(v.toPrecision(3)));
  }

  // If n is "negative", return its positive counterpart (so a sum can subtract it).
  function negOf(n) {
    if (n.t === 'u' && n.op === 'neg') return n.a;
    if (n.t === 'c' && n.v < 0) return cst(-n.v);
    if (n.t === 'b' && n.op === '*') {
      if (n.a.t === 'c' && n.a.v < 0) return n.a.v === -1 ? n.b : bin('*', cst(-n.a.v), n.b);
      if (n.b.t === 'c' && n.b.v < 0) return n.b.v === -1 ? n.a : bin('*', n.a, cst(-n.b.v));
    }
    return null;
  }

  // show(tree, names, pretty) -> string. pretty=true uses · − √ and superscripts.
  function show(n, names, pretty) {
    var M = pretty ? '·' : '*';
    var MINUS = pretty ? '−' : '-';
    function paren(r, minp) { return r.p < minp ? '(' + r.s + ')' : r.s; }
    // a right-hand factor needs parentheses unless it is a power, an atom or a product
    function factor(r) {
      if (r.p >= 3) return r.s;
      if (r.p === 2 && r.s.charAt(0) !== MINUS) return r.s;
      return '(' + r.s + ')';
    }
    function go(m) {
      switch (m.t) {
        case 'c':
          if (m.v < 0) return { s: MINUS + fmt(-m.v), p: 2 };
          return { s: fmt(m.v), p: 4 };
        case 'x':
          return { s: names[m.i], p: 4 };
        case 'u': {
          if (m.op === 'neg') return { s: MINUS + paren(go(m.a), 2), p: 2 };
          var inner = go(m.a).s;
          switch (m.op) {
            case 'sin': return { s: 'sin(' + inner + ')', p: 4 };
            case 'cos': return { s: 'cos(' + inner + ')', p: 4 };
            case 'exp': return { s: (pretty ? 'e^(' : 'exp(') + inner + ')', p: 4 };
            case 'log': return { s: 'ln|' + inner + '|', p: 4 };
            case 'sqrt': return { s: (pretty ? '√|' : 'sqrt|') + inner + '|', p: 4 };
            case 'abs': return { s: '|' + inner + '|', p: 4 };
            case 'sq': case 'cube': {
              var pw = m.op === 'sq' ? '2' : '3';
              var sup = m.op === 'sq' ? '²' : '³';
              if (m.a.t === 'x') return { s: inner + (pretty ? sup : '^' + pw), p: 4 };
              return { s: '(' + inner + ')' + (pretty ? sup : '^' + pw), p: 4 };
            }
          }
          return { s: m.op + '(' + inner + ')', p: 4 };
        }
        default: {
          var A, R, rn;
          if (m.op === '+' || m.op === '-') {
            A = go(m.a);
            rn = negOf(m.b);
            if (rn) {
              var sg = (m.op === '+') ? MINUS : '+';
              return { s: A.s + ' ' + sg + ' ' + paren(go(rn), 2), p: 1 };
            }
            R = go(m.b);
            return { s: A.s + ' ' + m.op + ' ' + paren(R, 2), p: 1 };
          }
          if (m.op === '*' && m.a.t === 'x' && same(m.a, m.b)) {
            return { s: names[m.a.i] + (pretty ? '²' : '^2'), p: 4 };
          }
          if (m.op === '*') {
            var lead = m.a.t === 'c' ? m.a : (m.b.t === 'c' ? m.b : null);
            if (lead && lead.v === 1) return go(lead === m.a ? m.b : m.a);
            if (lead && lead.v === -1) return { s: MINUS + paren(go(lead === m.a ? m.b : m.a), 2), p: 2 };
            if (m.b.t === 'c' && m.a.t !== 'c') {          // constants read first: 2.5·x
              A = go(m.b); R = go(m.a);
            } else {
              A = go(m.a); R = go(m.b);
            }
            return { s: paren(A, 2) + M + factor(R), p: 2 };
          }
          if (m.op === '/') {
            A = go(m.a); R = go(m.b);
            return { s: paren(A, 2) + '/' + paren(R, 4), p: 2 };
          }
          // '^' (typed formulas only)
          A = go(m.a); R = go(m.b);
          return { s: paren(A, 4) + '^' + paren(R, 4), p: 3 };
        }
      }
    }
    return go(n).s;
  }

  // ---- display tidy-up ---------------------------------------------------
  // Rewrites a tree into the form a physicist would write: constants pulled
  // out front, distributed over sums, sums flattened with like constants
  // merged. Purely cosmetic: the result is algebraically identical.
  // t = k·rest with a numeric coefficient k (k = 1 when there is none)
  function split(t) {
    if (t.t === 'b' && t.op === '*') {
      if (t.a.t === 'c') return { k: t.a.v, rest: t.b };
      if (t.b.t === 'c') return { k: t.b.v, rest: t.a };
    }
    return { k: 1, rest: t };
  }
  function tidy(n) {
    switch (n.t) {
      case 'c': case 'x': return n;
      case 'u': {
        if (n.op === 'neg') return scale(-1, n.a);
        var a = tidy(n.a), sp;
        // exact power rules, so that (2.5/r)² prints as 6.25/r²
        if (n.op === 'sq') {
          if (a.t === 'b' && a.op === '/' && a.a.t === 'c') return bin('/', cst(a.a.v * a.a.v), un('sq', a.b));
          sp = split(a);
          if (sp.k !== 1) return scale(sp.k * sp.k, un('sq', sp.rest));
          return un('sq', a);
        }
        if (n.op === 'cube') {
          sp = split(a);
          if (sp.k === 1 && sp.rest.t === 'u' && sp.rest.op === 'sqrt') return bin('*', un('abs', sp.rest.a), sp.rest);
          if (sp.k !== 1) return scale(sp.k * sp.k * sp.k, un('cube', sp.rest));
          return un('cube', a);
        }
        if (n.op === 'sqrt') {
          sp = split(a);
          if (sp.k !== 1) return scale(Math.sqrt(Math.abs(sp.k)), un('sqrt', sp.rest));
          return un('sqrt', a);
        }
        if (n.op === 'abs') {
          sp = split(a);
          if (sp.k !== 1) return scale(Math.abs(sp.k), un('abs', sp.rest));
          return un('abs', a);
        }
        return un(n.op, a);
      }
      default:
        if (n.op === '+' || n.op === '-') return tidySum(n);
        if (n.op === '^' && n.b.t === 'c' && (n.b.v === 2 || n.b.v === 3)) {
          return tidy(un(n.b.v === 2 ? 'sq' : 'cube', n.a));
        }
        if (n.op === '*') {
          if (n.a.t === 'c') return scale(n.a.v, n.b);
          if (n.b.t === 'c') return scale(n.b.v, n.a);
          var ta = tidy(n.a), tb = tidy(n.b);
          // a plain variable multiplies a sum term by term: x·(a − b) = x·a − x·b
          if (ta.t === 'x' && isSum(tb)) return tidySum(distribute(ta, tb));
          if (tb.t === 'x' && isSum(ta)) return tidySum(distribute(tb, ta));
          // constants move to the front: x·(−2·|v|) = −2·x·|v|
          if (tb.t === 'b' && tb.op === '*' && (tb.a.t === 'c' || tb.b.t === 'c')) {
            return tb.a.t === 'c' ? scale(tb.a.v, bin('*', ta, tb.b)) : scale(tb.b.v, bin('*', ta, tb.a));
          }
          if (ta.t === 'b' && ta.op === '*' && (ta.a.t === 'c' || ta.b.t === 'c')) {
            return ta.a.t === 'c' ? scale(ta.a.v, bin('*', ta.b, tb)) : scale(ta.b.v, bin('*', ta.a, tb));
          }
          // c/|x| · x³ = c·x·|x|
          if (ta.t === 'b' && ta.op === '/' && isAbs(ta.b) && isCube(tb) && same(ta.b.a, tb.a)) {
            return tidy(bin('*', ta.a, bin('*', tb.a, ta.b)));
          }
          if (tb.t === 'b' && tb.op === '/' && isAbs(tb.b) && isCube(ta) && same(tb.b.a, ta.a)) {
            return tidy(bin('*', tb.a, bin('*', ta.a, tb.b)));
          }
          return bin('*', ta, tb);
        }
        if (n.op === '/') {
          if (n.b.t === 'c' && n.b.v !== 0) return scale(1 / n.b.v, n.a);
          var num = tidy(n.a), den = tidy(n.b), nsp = split(num);
          // x³/|x| = x·|x|, also with a coefficient in front: c·x³/|x| = c·x·|x|
          if (isCube(nsp.rest) && isAbs(den) && same(nsp.rest.a, den.a)) {
            return scale(nsp.k, bin('*', den.a, den));
          }
          return bin('/', num, den);
        }
        return bin(n.op, tidy(n.a), tidy(n.b));
    }
  }
  function isSum(t) { return t.t === 'b' && (t.op === '+' || t.op === '-'); }
  function isAbs(t) { return t.t === 'u' && t.op === 'abs'; }
  function isCube(t) { return t.t === 'u' && t.op === 'cube'; }
  // v · (a ± b) as a sum of products, each of which is then tidied
  function distribute(v, s) {
    if (isSum(s)) return bin(s.op, distribute(v, s.a), distribute(v, s.b));
    return bin('*', v, s);
  }
  // k * n, with the constant folded into any coefficient that is already there
  function scale(k, n) {
    if (k === 1) return tidy(n);
    if (n.t === 'c') return cst(k * n.v);
    if (n.t === 'u' && n.op === 'neg') return scale(-k, n.a);
    if (n.t === 'b' && (n.op === '+' || n.op === '-')) return tidySum(bin(n.op, scale(k, n.a), scale(k, n.b)));
    if (n.t === 'b' && n.op === '*' && n.a.t === 'c') return scale(k * n.a.v, n.b);
    if (n.t === 'b' && n.op === '*' && n.b.t === 'c') return scale(k * n.b.v, n.a);
    if (n.t === 'b' && n.op === '/' && n.b.t === 'c' && n.b.v !== 0) return scale(k / n.b.v, n.a);
    return bin('*', cst(k), tidy(n));
  }
  // Flatten a +/- chain into its signed terms (each term returned positive).
  function terms(n, k, out) {
    if (n.t === 'b' && (n.op === '+' || n.op === '-')) {
      terms(n.a, k, out);
      terms(n.b, n.op === '+' ? k : -k, out);
      return;
    }
    flatten(scale(k, n), 1, out);
  }
  function flatten(t, sg, out) {
    if (t.t === 'b' && (t.op === '+' || t.op === '-')) {
      flatten(t.a, sg, out);
      flatten(t.b, t.op === '+' ? sg : -sg, out);
    } else {
      out.push(sg > 0 ? t : scale(-1, t));
    }
  }
  function tidySum(n) {
    var list = [], c = 0, acc = null, i;
    terms(n, 1, list);
    for (i = 0; i < list.length; i++) {
      if (list[i].t === 'c') c += list[i].v;
      else acc = acc ? bin('+', acc, list[i]) : list[i];
    }
    if (!acc) return cst(c);
    if (c === 0) return acc;
    // a negative constant leads the sum (−10.3 − 0.029·v|v|); a positive one closes it
    if (c < 0) return terms2(cst(c), list, acc);
    return bin('+', acc, cst(c));
  }
  function terms2(lead, list, acc) {
    var out = lead, i, skip = false;
    for (i = 0; i < list.length; i++) {
      if (list[i].t === 'c') continue;
      out = bin('+', out, list[i]);
    }
    return out;
  }

  // ---- typed formulas -----------------------------------------------------
  function lex(src) {
    var s = String(src).replace(/[·×⋅]/g, '*').replace(/−/g, '-');
    var toks = [], i = 0, m;
    while (i < s.length) {
      var c = s.charAt(i), rest = s.slice(i);
      if (/\s/.test(c)) {
        i++;
      } else if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest))) {
        toks.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length;
      } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
        toks.push({ k: 'id', v: m[0].toLowerCase() }); i += m[0].length;
      } else if (c === '²' || c === '³') {
        toks.push({ k: 'op', v: '^' }); toks.push({ k: 'num', v: c === '²' ? 2 : 3 }); i++;
      } else if (c === 'π') {
        toks.push({ k: 'id', v: 'pi' }); i++;
      } else if ('+-*/^()'.indexOf(c) >= 0) {
        toks.push({ k: 'op', v: c }); i++;
      } else {
        throw new Error("unexpected character '" + c + "'");
      }
    }
    return toks;
  }

  var FUNCS = { sin: 1, cos: 1, tan: 1, exp: 1, log: 1, ln: 1, sqrt: 1, abs: 1 };

  // parse(src, names) -> tree. Throws Error with a readable message.
  function parse(src, names) {
    var toks = lex(src), pos = 0;
    if (toks.length === 0) throw new Error('the formula is empty');
    function peek() { return toks[pos]; }
    function take() { return toks[pos++]; }
    function isOp(t, s) { return !!t && t.k === 'op' && t.v === s; }
    function expr() {
      var n = term();
      while (isOp(peek(), '+') || isOp(peek(), '-')) {
        var op = take().v;
        n = bin(op, n, term());
      }
      return n;
    }
    function term() {
      var n = unary();
      for (;;) {
        var t = peek();
        if (isOp(t, '*') || isOp(t, '/')) { take(); n = bin(t.v, n, unary()); }
        else if (t && (t.k === 'num' || t.k === 'id' || isOp(t, '('))) { n = bin('*', n, unary()); }
        else break;
      }
      return n;
    }
    function unary() {
      if (isOp(peek(), '-')) { take(); return un('neg', unary()); }
      if (isOp(peek(), '+')) { take(); return unary(); }
      return power();
    }
    function power() {
      var base = atom();
      if (isOp(peek(), '^')) { take(); return bin('^', base, unary()); }
      return base;
    }
    function atom() {
      var t = take();
      if (!t) throw new Error('the formula ends too early');
      if (t.k === 'num') return cst(t.v);
      if (isOp(t, '(')) {
        var e = expr();
        if (!isOp(take(), ')')) throw new Error("a '(' is missing its ')'");
        return e;
      }
      if (t.k === 'id') {
        if (isOp(peek(), '(')) {
          if (!FUNCS[t.v]) throw new Error("unknown function '" + t.v + "'");
          take();
          var arg = expr();
          if (!isOp(take(), ')')) throw new Error("'" + t.v + "(' is missing its ')'");
          if (t.v === 'tan') return bin('/', un('sin', arg), un('cos', arg));
          if (t.v === 'ln') return un('log', arg);
          return un(t.v, arg);
        }
        if (t.v === 'pi') return cst(Math.PI);
        if (t.v === 'e') return cst(Math.E);
        var idx = names.indexOf(t.v);
        if (idx >= 0) return inp(idx);
        // run-together variables such as "xv" mean x·v
        var letters = t.v.split('');
        if (letters.length > 1 && letters.every(function (ch) { return names.indexOf(ch) >= 0; })) {
          var prod = inp(names.indexOf(letters[0]));
          for (var q = 1; q < letters.length; q++) prod = bin('*', prod, inp(names.indexOf(letters[q])));
          return prod;
        }
        throw new Error("unknown name '" + t.v + "' (use " + names.join(' and ') + ")");
      }
      throw new Error("unexpected '" + t.v + "'");
    }
    var tree = expr();
    if (pos < toks.length) throw new Error("unexpected '" + toks[pos].v + "'");
    return tree;
  }

  function usesInput(n, out) {
    out = out || {};
    collect(n).forEach(function (m) { if (m.t === 'x') out[m.i] = true; });
    return out;
  }

  BP.Expr = {
    UF: UF, BF: BF,
    cst: cst, inp: inp, un: un, bin: bin,
    ev: ev, clone: clone, collect: collect, size: size, depth: depthOf, same: same,
    setNode: setNode, simplify: simplify,
    getConsts: getConsts, setConsts: setConsts,
    compile: compile, run: run, makeScratch: makeScratch,
    show: show, fmt: fmt, parse: parse, usesInput: usesInput, tidy: function (n) { return simplify(tidy(simplify(n))); }
  };
})();
