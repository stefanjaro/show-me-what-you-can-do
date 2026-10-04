/* ALETHEIA — expression → human.
 *
 * Three back ends:
 *   text(e)   Unicode/ASCII mathematics that can be fed straight back to the
 *             parser (the test suite checks that round trip).
 *   tree(e)   a layout tree of boxes: fractions with real bars, square roots
 *             with drawn surds, matrices. render/typeset.js draws these.
 *   latex(e)  export, for pasting into a paper.
 *
 * Quotients are always *displayed* as quotients: nobody wants to read
 * `x*(x^2+1)^-1`.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E;

  var PREC = { add: 1, mul: 2, pow: 3, fun: 4, num: 5, sym: 5, der: 1, int: 1, ord: 5, vec: 5, mat: 5, inf: 5, nan: 5 };
  var PRETTY = { pi: 'π', tau: 'τ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', phi: 'φ', omega: 'ω', epsilon: 'ε' };
  var FUNCNAME = { sqrt: '√', ln: 'ln', asin: 'arcsin', acos: 'arccos', atan: 'arctan' };

  function isNegCoeffTerm(t) {
    if (t.t === 'mul' && t.args[0].t === 'num' && t.args[0].v.sign() < 0) return true;
    if (t.t === 'num' && t.v.sign() < 0) return true;
    return false;
  }
  /* strip a leading -1 / -c off a product */
  function splitSign(t) {
    if (t.t === 'num') {
      if (t.v.sign() < 0) return { neg: true, body: E.num(t.v.abs()), coeff: t.v.neg() };
      return { neg: false, body: t, coeff: t.v };
    }
    if (t.t === 'mul' && t.args[0].t === 'num') {
      var c = t.args[0].v;
      if (c.sign() < 0) {
        var rest = t.args.slice(1);
        var body;
        if (c.eq(Rat.MONE) || c.neg().isOne()) {
          body = rest.length === 1 ? rest[0] : (rest.length === 0 ? E.ONE : mulRaw(rest));
        } else {
          body = E.mul(E.num(c.neg()), rest.length === 1 ? rest[0] : mulRaw(rest));
        }
        return { neg: true, body: body, coeff: c.neg() };
      }
    }
    return { neg: false, body: t, coeff: Rat.ONE };
  }
  function mulRaw(list) {
    // rebuild without re-canonicalising through E.mul's power combining (already canonical)
    return { t: 'mul', args: list };
  }

  /* ── textual form ───────────────────────────────────────────────────── */
  function text(e, parentPrec) {
    parentPrec = parentPrec === undefined ? 0 : parentPrec;
    var s = textRaw(e);
    var pr = PREC[e.t] || 5;
    return pr < parentPrec ? '(' + s + ')' : s;
  }
  function textRaw(e) {
    switch (e.t) {
      case 'num': {
        var v = e.v;
        if (v.isInt()) return v.n.toString();
        return v.n.toString() + '/' + v.d.toString();
      }
      case 'sym': return PRETTY[e.name] || e.name;
      case 'inf': return e.s > 0 ? 'infinity' : '-infinity';
      case 'nan': return 'undefined';
      case 'ord': {
        var base8 = text(e.x);
        return 'O(' + (e.x.t === 'sym' || e.x.t === 'num' ? base8 : '(' + base8 + ')') + '^' + e.n + ')';
      }
      case 'vec': return '[' + e.items.map(text).join(', ') + ']';
      case 'mat': return '[' + e.rows.map(function (r) { return r.map(text).join(', '); }).join('; ') + ']';
      case 'fun': return printCall(e);
      case 'der': return 'diff(' + text(e.f) + ', ' + text(e.x) + (e.n === 1 ? '' : ', ' + e.n) + ')';
      case 'int': return 'integrate(' + text(e.f) + ', ' + text(e.x) + ')';
      case 'add': {
        displayVars = E.freeVars(e);
        var terms = e.args.slice().sort(displayOrder);
        var out = '';
        for (var i = 0; i < terms.length; i++) {
          var t = terms[i], sg = splitSign(t);
          var body = text(sg.body, 1);
          if (i === 0) out += (sg.neg ? '-' + body : body);
          else out += (sg.neg ? ' - ' + body : ' + ' + body);
        }
        return out;
      }
      case 'mul': {
        var fr = asFraction(e);
        if (fr) {
          return productText(productParts(fr.p, fr.rest), 3) + '/' + text(fr.den, 3);
        }
        var parts = [], k, sign = '', list = e.args;
        if (e.args[0].t === 'num' && e.args.length > 1) {
          var lead = e.args[0].v;
          list = e.args.slice(1);
          if (lead.sign() < 0) {
            sign = '-';
            if (!lead.abs().isOne()) parts.push(text(E.num(lead.abs()), 2));
          } else if (!lead.isOne()) {
            parts.push(text(E.num(lead), 2));
          }
        }
        for (k = 0; k < list.length; k++) parts.push(text(list[k], 2));
        if (parts.length === 0) return sign + '1';
        return sign + parts.join('*');
      }
      case 'pow': {
        if (e.e.t === 'num') {
          var ev = e.e.v;
          if (ev.d === 2n && ev.n === 1n) return 'sqrt(' + text(e.b) + ')';
          if (ev.d === 2n && ev.n === -1n) return '1/sqrt(' + text(e.b) + ')';
          if (ev.sign() < 0) {
            var denomv = E.pow(e.b, E.num(ev.neg()));
            return '1/' + text(denomv, 3);
          }
        }
        var bs = text(e.b, 4), es = text(e.e, 4);
        if (e.e.t === 'num' && e.e.v.isInt() && e.e.v.n < 0n) es = '(' + es + ')';
        return bs + '^' + es;
      }
      default: return '?';
    }
  }
  function printCall(e) {
    if (e.name === 'sqrt') return 'sqrt(' + e.args.map(text).join(', ') + ')';
    if (e.name === 'factorial') return text(e.args[0], 4) + '!';
    if (e.name === 'abs') return '|' + text(e.args[0]) + '|';
    var nm = FUNCNAME[e.name] || e.name;
    if (nm === '√') return 'sqrt(' + e.args.map(text).join(', ') + ')';
    return nm + '(' + e.args.map(text).join(', ') + ')';
  }
  /* display order: highest total degree first, then lexicographic by the
     expression's own variables — the order a human would write it in */
  function displayOrder(a, b, vars) {
    vars = vars || displayVars;
    if (vars && vars.length) {
      var ka = termKey(a, vars), kb = termKey(b, vars);
      for (var i = 0; i < vars.length; i++) {
        if (ka[i] !== kb[i]) return kb[i] - ka[i];
      }
    }
    var da = totalDegree(a), db = totalDegree(b);
    if (da !== db) return db - da;
    return E.cmp(a, b);
  }
  var displayVars = null;
  function termKey(e, vars) {
    var key = [], init;
    for (init = 0; init < vars.length; init++) key.push(0);
    (function rec(n, mul2) {
      var k;
      switch (n.t) {
        case 'pow':
          if (n.e.t === 'num') {
            var ex = n.e.v.toNumber();
            var hit = false;
            for (k = 0; k < vars.length; k++) if (E.eqq(n.b, vars[k])) { key[k] += mul2 * ex; hit = true; }
            if (hit) return;
            rec(n.b, mul2 * ex); return;
          }
          rec(n.b, mul2); return;
        case 'sym':
          for (k = 0; k < vars.length; k++) if (E.eqq(n, vars[k])) key[k] += mul2;
          return;
        case 'mul':
          for (k = 0; k < n.args.length; k++) rec(n.args[k], mul2);
          return;
        default: return;
      }
    })(e, 1);
    return key;
  }
  function totalDegree(e) {
    switch (e.t) {
      case 'num': return -1000;
      case 'sym': return E.isConst(e) ? -1000 : 1;
      case 'pow':
        if (e.e.t === 'num') {
          if (e.b.t === 'sym') return e.e.v.toNumber();
          if (e.b.t === 'add' || e.b.t === 'mul') return totalDegree(e.b) * e.e.v.toNumber();
        }
        return 1;
      case 'mul': {
        var d = 0;
        for (var i = 0; i < e.args.length; i++) d += totalDegree(e.args[i]);
        return d;
      }
      case 'add': {
        var m = -1e9;
        for (var j = 0; j < e.args.length; j++) m = Math.max(m, totalDegree(e.args[j]));
        return m;
      }
      case 'fun': return 1;
      default: return 0;
    }
  }
  function isOneish(e) { return e.t === 'num' && e.v.isOne(); }

  /* Split a product into numerator pieces and a denominator expression.
     -1/2*x^2  →  (-x^2) / 2      x/(x+1)  →  x / (x+1)      1/2  →  1 / 2   */
  function asFraction(e) {
    var c = Rat.ONE, rest = [], den = [], i, f;
    if (e.t === 'pow' && e.e.t === 'num' && e.e.v.sign() < 0) {
      return { p: c, rest: [], den: E.pow(e.b, E.num(e.e.v.neg())) };
    }
    if (e.t === 'num') {
      if (e.v.isInt()) return null;
      return { p: Rat.int(e.v.n), rest: [], den: E.num(Rat.int(e.v.d)) };
    }
    if (e.t !== 'mul') return null;
    for (i = 0; i < e.args.length; i++) {
      f = e.args[i];
      if (f.t === 'num') { c = c.mul(f.v); continue; }
      if (f.t === 'pow' && f.e.t === 'num' && f.e.v.sign() < 0) {
        den.push(E.pow(f.b, E.num(f.e.v.neg()))); continue;
      }
      rest.push(f);
    }
    var p = Rat.int(c.n), extraDen = c.d;
    if (den.length === 0 && extraDen === 1n) return null;
    var dest = den.slice();
    if (extraDen !== 1n) dest.unshift(E.num(Rat.int(extraDen)));
    var denExpr = dest.length === 1 ? dest[0] : E.mul.apply(null, dest);
    return { p: p, rest: rest, den: denExpr };
  }
  function productParts(p, rest) {
    if (rest.length === 0) return [E.num(p)];
    if (p.isOne()) return rest.slice();
    var parts = [E.num(p)];
    return parts.concat(rest);
  }
  function productText(parts, prec) {
    prec = prec || 3;
    var items = [], i, neg = false;
    for (i = 0; i < parts.length; i++) {
      var el = parts[i];
      if (i === 0 && el.t === 'num' && el.v.sign() < 0 && parts.length > 1) {
        neg = true;
        if (el.v.abs().isOne()) continue;
        items.push(text(E.num(el.v.abs()), 2));
        continue;
      }
      items.push(text(el, 2));
    }
    if (items.length === 0) items.push('1');
    return (neg ? '-' : '') + items.join('*');
  }

  /* ── layout tree for the canvas typesetter ──────────────────────────── */
  /* box kinds: row, num, sym, op, frac, sqrt, sup, sub, paren, func, text, matrix */
  function tree(e) {
    switch (e.t) {
      case 'num': {
        var v = e.v;
        if (v.isInt()) return { k: 'num', s: v.n.toString() };
        return { k: 'frac', a: { k: 'num', s: v.n.toString() }, b: { k: 'num', s: v.d.toString() }, packed: true };
      }
      case 'sym': return { k: 'sym', s: PRETTY[e.name] || e.name };
      case 'inf': return { k: 'sym', s: e.s > 0 ? '∞' : '-∞' };
      case 'nan': return { k: 'text', s: 'undefined' };
      case 'ord': {
        var inner8 = [tree(e.x)];
        if (e.x.t !== 'sym' && e.x.t !== 'num') inner8 = [{ k: 'row', items: [{ k: 'text', s: '(' }, tree(e.x), { k: 'text', s: ')' }] }];
        return { k: 'row', items: [{ k: 'text', s: 'O(' }].concat(inner8, [{ k: 'sym', s: '^' + e.n }, { k: 'text', s: ')' }]) };
      }
      case 'vec': return { k: 'row', items: [{ k: 'op', s: '[' }].concat(interleave(e.items.map(tree), { k: 'op', s: ',' })).concat([{ k: 'op', s: ']' }]) };
      case 'mat':
        return { k: 'matrix', rows: e.rows.map(function (r) { return r.map(tree); }) };
      case 'pow': {
        if (e.e.t === 'num') {
          var ev2 = e.e.v;
          if (ev2.d === 2n && (ev2.n === 1n || ev2.n === -1n)) {
            return ev2.n === 1n ? { k: 'sqrt', a: tree(e.b) } : { k: 'frac', a: { k: 'num', s: '1' }, b: { k: 'sqrt', a: tree(e.b) } };
          }
          if (ev2.sign() < 0) {
            return { k: 'frac', a: { k: 'num', s: '1' }, b: tree(E.pow(e.b, E.num(ev2.neg()))) };
          }
        }
        var bb = tree(e.b), wrap2 = needsWrap(e.b);
        return { k: 'sup', b: wrap2 ? { k: 'paren', a: bb } : bb, e: tree(e.e) };
      }
      case 'mul': {
        var fr2 = asFraction(e);
        if (fr2) return { k: 'frac', a: productBox(productParts(fr2.p, fr2.rest)), b: tree(fr2.den) };
        var items = [], i2;
        for (i2 = 0; i2 < e.args.length; i2++) {
          var f2 = e.args[i2];
          if (i2 > 0 && (f2.t === 'num' || f2.t === 'sym')) items.push({ k: 'op', s: '\u00b7' });
          items.push(wrapOperand(f2));
        }
        return { k: 'row', items: items };
      }
      case 'add': {
        displayVars = E.freeVars(e);
        var ordered = e.args.slice().sort(displayOrder);
        var out = [];
        for (var i3 = 0; i3 < ordered.length; i3++) {
          var t3 = ordered[i3], sg = splitSign(t3);
          if (i3 > 0) out.push({ k: 'op', s: sg.neg ? '−' : '+' });
          else if (sg.neg) out.push({ k: 'op', s: '−' });
          out.push(sg.body.t === 'add' || sg.body.t === 'mul' ? wrapOperand(sg.body) : tree(sg.body));
        }
        return { k: 'row', items: out };
      }
      case 'fun': {
        if (e.name === 'sqrt') return { k: 'sqrt', a: tree(e.args[0]) };
        if (e.name === 'abs') return { k: 'row', items: [{ k: 'op', s: '|' }, tree(e.args[0]), { k: 'op', s: '|' }] };
        if (e.name === 'factorial') return { k: 'row', items: [wrapOperand(e.args[0]), { k: 'op', s: '!' }] };
        if (e.name === 'binomial') return { k: 'binom', a: tree(e.args[0]), b: tree(e.args[1]) };
        var nmz = FUNCNAME[e.name] || e.name;
        if (e.name === 'ln' && e.args.length === 1) nmz = 'ln';
        return { k: 'row', items: [{ k: 'func', s: nmz }, { k: 'paren', a: { k: 'row', items: interleave(e.args.map(tree), { k: 'op', s: ',' }) } }] };
      }
      case 'int': {
        return {
          k: 'row', items: [
            { k: 'bigop', s: '∫', sub: null },
            tree(e.f),
            { k: 'op', s: 'd' + (PRETTY[e.x.name] || (e.x.t === 'sym' ? e.x.name : 'x')) }
          ]
        };
      }
      case 'der': {
        var frac = {
          k: 'frac', packed: true,
          a: { k: 'func', s: 'd' + (e.n > 1 ? '^' + e.n : '') },
          b: { k: 'row', items: [{ k: 'func', s: 'd' + (PRETTY[e.x.name] || e.x.name) + (e.n > 1 ? '^' + e.n : '') }] }
        };
        return { k: 'row', items: [frac, needsWrap(e.f) ? { k: 'paren', a: tree(e.f) } : tree(e.f)] };
      }
      default: return { k: 'text', s: '?' };
    }
  }
  function productBox(parts) {
    if (parts.length === 1) return tree(parts[0]);
    var items = [], i;
    for (i = 0; i < parts.length; i++) {
      if (i > 0) items.push({ k: 'op', s: '\u00b7' });
      items.push(wrapOperand(parts[i]));
    }
    return { k: 'row', items: items };
  }
  function interleave(arr, sep) {
    var out = [];
    for (var i = 0; i < arr.length; i++) { if (i) out.push(sep); out.push(arr[i]); }
    return out;
  }
  function needsWrap(e) { return e.t === 'add' || e.t === 'mul' || (e.t === 'pow' && true) || e.t === 'der' || e.t === 'int'; }
  function wrapOperand(e) {
    if (e.t === 'add') return { k: 'paren', a: tree(e) };
    if (e.t === 'mul') {
      var fr = asFraction(e);
      if (fr) return { k: 'frac', a: tree(fr.num), b: tree(fr.den) };
      return tree(e);
    }
    if (e.t === 'num' && !e.v.isInt()) return tree(e);
    return tree(e);
  }

  /* ── LaTeX export ───────────────────────────────────────────────────── */
  function latex(e, prec) {
    prec = prec === undefined ? 0 : prec;
    var s = latexRaw(e);
    return prec > (PREC[e.t] || 5) ? '\\left(' + s + '\\right)' : s;
  }
  function latexRaw(e) {
    switch (e.t) {
      case 'num': return e.v.toLatex();
      case 'sym': {
        if (e.name === 'pi') return '\\pi';
        if (e.name === 'tau') return '\\tau';
        var m = /^([A-Za-z]+)$/.exec(e.name);
        if (m) return e.name;
        return e.name;
      }
      case 'inf': return e.s > 0 ? '\\infty' : '-\\infty';
      case 'nan': return '\\mathrm{undefined}';
      case 'add': {
        var o = '';
        for (var i = 0; i < e.args.length; i++) {
          var sg = splitSign(e.args[i]);
          o += (i === 0 ? (sg.neg ? '-' : '') : (sg.neg ? ' - ' : ' + ')) + latex(sg.body, 1);
        }
        return o;
      }
      case 'mul': {
        var fr = asFraction(e);
        if (fr) return '\\frac{' + latex(fr.num) + '}{' + latex(fr.den) + '}';
        return e.args.map(function (f) { return latex(f, 2); }).join(' \\, ');
      }
      case 'pow': {
        if (e.e.t === 'num' && e.e.v.d === 2n && e.e.v.n === 1n) return '\\sqrt{' + latex(e.b) + '}';
        return latex(e.b, 4) + '^{' + latex(e.e) + '}';
      }
      case 'fun': {
        if (e.name === 'sqrt') return '\\sqrt{' + latex(e.args[0]) + '}';
        if (e.name === 'abs') return '\\left|' + latex(e.args[0]) + '\\right|';
        if (e.name === 'factorial') return latex(e.args[0], 4) + '!';
        if (e.name === 'ln') return '\\ln\\left(' + latex(e.args[0]) + '\\right)';
        return '\\' + e.name + '\\left(' + e.args.map(function (a) { return latex(a); }).join(',') + '\\right)';
      }
      case 'int': return '\\int ' + latex(e.f, 1) + '\\, d' + latex(e.x);
      case 'der': return '\\frac{d}{d' + latex(e.x) + '}' + latex(e.f, 4);
      case 'mat': return '\\begin{pmatrix}' + e.rows.map(function (r) { return r.map(function (c) { return latex(c); }).join(' & '); }).join(' \\\\ ') + '\\end{pmatrix}';
      case 'vec': return '\\begin{pmatrix}' + e.items.map(function (c) { return latex(c); }).join(' \\\\ ') + '\\end{pmatrix}';
      default: return '?';
    }
  }

  AE.print = { text: text, tree: tree, latex: latex, asFraction: asFraction, PRETTY: PRETTY };

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function t(s) { return text(AE.parse(s)); }
  U.test('print', 'text form', function (a) {
    a.eq(t('2*x'), '2*x', 'product');
    a.eq(t('x+1'), 'x + 1', 'sum');
    a.eq(t('x-1'), 'x - 1', 'difference');
    a.eq(t('1/2'), '1/2', 'rational');
    a.eq(t('3*x^2-2*x+1'), '3*x^2 - 2*x + 1', 'polynomial');
    a.eq(t('1/(x+1)'), '1/(x + 1)', 'quotient display');
    a.eq(t('sqrt(2)'), 'sqrt(2)', 'root');
    a.eq(t('x^(-1/2)'), '1/sqrt(x)', 'negative half power');
    a.eq(t('sin(x)*cos(x)'), 'cos(x)*sin(x)', 'products of calls');
    a.eq(t('-x^2'), '-x^2', 'leading minus');
    a.eq(t('pi*r^2'), 'π*r^2', 'unicode constant');
    a.eq(t('|(x)|'), '|x|', 'abs');
    a.eq(t('x!'), 'x!', 'factorial');
    a.eq(t('integrate(x^2,x)'), 'integrate(x^2, x)', 'integral');
  });
  U.test('print', 'round trip', function (a) {
    var cases = ['3*x^2-2*x+1', '1/(x+1)', 'sqrt(2)/2', 'sin(x)*cos(x)', 'x^(-1/2)',
      '2*x*y', 'a^2+b^2-c^2', 'exp(-x^2/2)', '1/(1+x^2)', 'ln(x)/x', 'pi*r^2', '5!'];
    for (var i = 0; i < cases.length; i++) {
      var e = AE.parse(cases[i]), s = text(e), back = AE.parse(s);
      a.ok(E.eqq(e, back), cases[i] + '  →  ' + s);
    }
  });
  U.test('print', 'latex', function (a) {
    a.eq(latex(AE.parse('1/2')), '\\frac{1}{2}', 'fraction');
    a.eq(latex(AE.parse('sqrt(x)')), '\\sqrt{x}', 'root');
    a.eq(latex(AE.parse('x^2+1')), 'x^{2} + 1', 'polynomial');
    a.eq(latex(AE.parse('integrate(x,x)')), '\\int x\\, dx', 'integral');
    a.eq(latex(AE.parse('diff(sin(x),x)')), '\\frac{d}{dx}\\sin\\left(x\\right)', 'derivative');
  });
  U.test('print', 'layout tree', function (a) {
    var tr = tree(AE.parse('1/(x+1)'));
    a.eq(tr.k, 'frac', 'quotient becomes a fraction box');
    a.eq(tree(AE.parse('sqrt(x)')).k, 'sqrt', 'root box');
    a.eq(tree(AE.parse('x^2')).k, 'sup', 'superscript box');
    a.eq(tree(AE.parse('1/2')).k, 'frac', 'rational is a fraction');
    a.eq(tree(AE.parse('[1,2;3,4]')).k, 'matrix', 'matrix box');
    a.eq(tree(AE.parse('x+y')).items.length, 3, 'sum rows include operators');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
