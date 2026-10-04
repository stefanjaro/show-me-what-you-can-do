/* ALETHEIA — textual mathematics → expression tree.
 *
 * Accepts ordinary ASCII typing ("x^2 + 3*x - 1", "integrate(sin(x)*x, x)")
 * and also the symbols a human actually reaches for: √, π, ·, ×, ÷, ≤, ²,
 * |x|, [1,2;3,4], 2x, ⌊x⌋. Parse errors come back with a caret under the
 * offending character so the UI can show exactly what went wrong.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, Rat = AE.Rat, E = AE.E;

  /* ── Unicode normalisation ──────────────────────────────────────────── */
  var SUBST = {
    '−': '-', '–': '-', '—': '-', '∓': '-',
    '×': '*', '⋅': '*', '·': '*', '∗': '*', '†': '*',
    '÷': '/', '⁄': '/',
    '¬': '!', '∣': '|', '｜': '|'
  };
  var SUPERS = { '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁰': '0', '¹': '1', '⁺': '+', '⁻': '-' };

  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isAlpha(c) { return /[A-Za-z]/.test(c); }
  function isMathLetter(c) {
    // Greek, Hebrew (aleph), letter-like symbols and planks: all valid identifiers
    return /[^\x00-\x7F]/.test(c) && /[\p{L}\p{Nl}]/u.test(c);
  }
  function isIdentChar(c) {
    return (c >= '0' && c <= '9') || /[A-Za-z_]/.test(c) || isMathLetter(c) ||
      c === "'" || c === '_';
  }

  /* ── tokenizer ──────────────────────────────────────────────────────── */
  function tokenize(src) {
    var toks = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u00a0') { i++; continue; }
      if (SUBST[c] !== undefined) { toks.push({ k: 'op', v: SUBST[c], i: i }); i++; continue; }
      if (SUPERS[c] !== undefined) {          // x² → x^2,  x⁻¹ → x^-1
        var acc = '', i0 = i;
        while (i < n && SUPERS[src[i]] !== undefined) { acc += SUPERS[src[i]]; i++; }
        var neg = acc[0] === '-';
        if (neg || acc[0] === '+') acc = acc.slice(1);
        if (acc === '') acc = '1';
        toks.push({ k: 'op', v: '^', i: i0 });
        if (neg) toks.push({ k: 'op', v: '-', i: i0 });
        toks.push({ k: 'num', v: acc, i: i0 });
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
        var j = i, sawDot = false, sawE = false;
        while (j < n) {
          var d = src[j];
          if (isDigit(d)) { j++; continue; }
          if (d === '.' && !sawDot && !sawE) { sawDot = true; j++; continue; }
          if ((d === 'e' || d === 'E') && !sawE && j > i) {
            var nx = src[j + 1];
            if (isDigit(nx) || ((nx === '+' || nx === '-') && isDigit(src[j + 2]))) {
              sawE = true; j += (nx === '+' || nx === '-') ? 2 : 1; continue;
            }
          }
          break;
        }
        toks.push({ k: 'num', v: src.slice(i, j), i: i });
        i = j; continue;
      }
      if (isAlpha(c) || isMathLetter(c) || c === '_') {
        var k2 = i;
        while (k2 < n && isIdentChar(src[k2])) k2++;
        toks.push({ k: 'name', v: src.slice(i, k2), i: i });
        i = k2; continue;
      }
      if ('+-*/^(),[]|!;{}'.indexOf(c) >= 0) { toks.push({ k: c === '(' || c === ')' || c === '[' || c === ']' || c === '{' || c === '}' ? 'paren' : (c === ',' || c === ';' ? 'sep' : 'op'), v: c, i: i }); i++; continue; }
      if ('=<>≤≥≠≈≡→←⇒⇔∂∫∑∏√∞±'.indexOf(c) >= 0) { toks.push({ k: 'op', v: c, i: i }); i++; continue; }
      throw parseError(src, i, 'unexpected character “' + c + '”');
    }
    toks.push({ k: 'eof', v: null, i: n });
    return toks;
  }
  function parseError(src, pos, msg) {
    var line = 1, col = 1, i;
    for (i = 0; i < pos && i < src.length; i++) { if (src[i] === '\n') { line++; col = 1; } else col++; }
    var after = src.slice(pos, pos + 24).split('\n')[0];
    var err = new Error((msg || 'parse error') + ' at line ' + line + ', column ' + col +
      '\n    ' + src.split('\n')[line - 1] + '\n    ' + ' '.repeat(Math.max(0, col - 1)) + '^');
    err.parse = { line: line, col: col, pos: pos, snippet: after };
    return err;
  }

  /* ── parser ─────────────────────────────────────────────────────────── */
  /* Operator names that are *not* variables. */
  var KEYWORD = {
    pi: 'pi', '\u03c0': 'pi', tau: 'tau', '\u03c4': 'tau', e: 'e',
    infinity: 'inf', '\u221e': 'inf', true: 'true', false: 'false',
    i: 'i', phi: 'phi', '\u03c6': 'phi'
  };
  var KNOWN_FUNCS = {};
  (function () {
    var names = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'acot',
      'sinh', 'cosh', 'tanh', 'coth', 'asinh', 'acosh', 'atanh', 'exp', 'ln', 'log', 'sqrt',
      'cbrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'erf', 'erfc', 'gamma', 'zeta',
      'lambertw', 'min', 'max', 'gcd', 'lcm', 'mod', 'hypot', 'atan2', 'binomial',
      'diff', 'D', 'integrate', 'int', 'sum', 'product', 'factorial', 'root', 'limit', 'taylor', 'solve'];
    for (var i = 0; i < names.length; i++) KNOWN_FUNCS[names[i]] = names[i];
  }());

  function Parser(src) {
    this.src = src;
    this.toks = tokenize(src);
    this.p = 0;
  }
  Parser.prototype.peek = function (o) { return o ? this.toks[this.p + o] : this.toks[this.p]; };
  Parser.prototype.next = function () { return this.toks[this.p++]; };
  Parser.prototype.at = function (kind, val) {
    var t = this.toks[this.p];
    return t.k === kind && (val === undefined || t.v === val) ? t : null;
  };
  Parser.prototype.expect = function (kind, val) {
    var t = this.toks[this.p];
    if (t.k === kind && (val === undefined || t.v === val)) { this.p++; return t; }
    throw parseError(this.src, t.i, 'expected ' + (val || kind) + ' but found ' +
      (t.k === 'eof' ? 'end of input' : '“' + t.v + '”'));
  };

  Parser.prototype.parse = function () {
    var e = this.pAdd();
    if (!this.at('eof')) {
      var t = this.peek();
      throw parseError(this.src, t.i, 'unexpected trailing input “' + (t.v === null ? '' : t.v) + '”');
    }
    return e;
  };

  Parser.prototype.pAdd = function () {
    var left = this.pMul();
    for (;;) {
      var t = this.peek();
      if (t.k === 'op' && (t.v === '+' || t.v === '-' || t.v === '±')) {
        this.next();
        var right = this.pMul();
        left = t.v === '-' ? E.sub(left, right) : E.add(left, right);
        continue;
      }
      return left;
    }
  };
  /* does the next token start a factor? used for implicit multiplication */
  Parser.prototype.startsFactor = function () {
    var t = this.peek();
    return t.k === 'num' || t.k === 'name' || t.k === 'digits' ||
      (t.k === 'paren' && (t.v === '(' || t.v === '[' || t.v === '{')) || t.v === '√';
  };
  Parser.prototype.pMul = function () {
    var left = this.pUnary(), t;
    for (;;) {
      t = this.peek();
      if (t.k === 'op' && (t.v === '*' || t.v === '/' || t.v === '·')) {
        this.next();
        var right = this.pUnary();
        left = t.v === '/' ? E.div(left, right) : E.mul(left, right);
        // implicit multiplication after explicit division/times:  2/3x
        while (this.startsImplicitMul()) left = E.mul(left, this.pUnary());
        continue;
      }
      if (this.startsImplicitMul()) { left = E.mul(left, this.pUnary()); continue; }
      return left;
    }
  };
  Parser.prototype.startsImplicitMul = function () {
    var prev = this.toks[this.p - 1], t = this.peek();
    if (!prev || !t) return false;
    var prevIsValue = prev.k === 'num' || prev.k === 'digits' ||
      (prev.k === 'paren' && (prev.v === ')' || prev.v === ']' || prev.v === '}')) ||
      prev.v === '\u221a';
    if (prevIsValue) {
      return t.k === 'num' || t.k === 'digits' || t.k === 'name' ||
        (t.k === 'paren' && (t.v === '(' || t.v === '[')) || t.v === '\u221a';
    }
    return false;
  };
  Parser.prototype.pUnary = function () {
    var t = this.peek();
    if (t.k === 'op' && (t.v === '-' || t.v === '+')) {
      this.next();
      var operand = this.pPow();
      return t.v === '-' ? E.neg(operand) : operand;
    }
    return this.pPow();
  };
  Parser.prototype.pPow = function () {
    var base = this.pPostfix();
    var t = this.peek();
    if (t.k === 'op' && (t.v === '^' || t.v === '**')) {
      this.next();
      var ex = this.pUnary();          // right associative: 2^3^2 = 2^(3^2)
      return E.pow(base, ex);
    }
    return base;
  };
  Parser.prototype.pPostfix = function () {
    var e = this.pAtom();
    for (;;) {
      var t = this.peek();
      if (t.k === 'op' && t.v === '!') { this.next(); e = E.fun('factorial', [e]); continue; }
      if (t.k === 'op' && t.v === '²') { this.next(); e = E.pow(e, E.int(2)); continue; }
      return e;
    }
  };
  Parser.prototype.pArgs = function (open, close) {
    this.expect('paren', open);
    var args = [[]];
    if (!this.at('paren', close)) {
      for (;;) {
        args[args.length - 1].push(this.pAdd());
        if (this.at('sep', ',')) { this.next(); continue; }
        if (this.at('sep', ';') || (open === '[' && this.at('sep', ';'))) {
          this.next(); args.push([]); continue;
        }
        break;
      }
    }
    this.expect('paren', close);
    return args;
  };
  Parser.prototype.pAtom = function () {
    var t = this.peek(), src = this.src;
    if (t.k === 'num') { this.next(); return numberNode(t.v); }
    if (t.k === 'digits') {                 // from a Unicode superscript (x²)
      var acc = '';
      while (this.peek().k === 'digits') acc += this.next().v;
      return numberNode(acc);
    }
    if (t.k === 'name') {
      this.next();
      var name = t.v;
      // `name(` is a function call — including names we have never heard of,
      // so f(x), g(t) and friends work. Implicit multiplication is 2x, 3(x+1),
      // (x+1)(x+2): a bare `x(y+1)` is written `x*(y+1)`.
      if (this.at('paren', '(')) {
        var args = this.pArgs('(', ')');
        if (args.length === 1) return buildCall(name, args[0]);
        throw parseError(src, t.i, 'function arguments may not be separated by “;”');
      }
      if (KNOWN_FUNCS[name] !== undefined && E.FUNCS[name] === 1 && this.startsFactor()) {
        return buildCall(name, [this.pUnary()]);      // sin x  →  sin(x)
      }
      if (KEYWORD[name] !== undefined) {
        var kw = KEYWORD[name];
        if (kw === 'inf') return E.inf(this.at('op', '-') ? -1 : 1);
        if (kw === 'true' || kw === 'false') return E.sym(kw === 'true' ? 'true' : 'false');
        return E.sym(kw);
      }
      return E.sym(name);
    }
    if (t.k === 'paren' && t.v === '(') {
      this.next();
      var e = this.pAdd();
      this.expect('paren', ')');
      return e;
    }
    if (t.k === 'paren' && t.v === '[') {
      var rows = this.pArgs('[', ']');
      if (rows.length === 1) return E.vec(rows[0]);
      return E.mat(rows);
    }
    if (t.k === 'paren' && t.v === '{') {
      var set = this.pArgs('{', '}');
      return E.vec(set.length === 1 ? set[0] : [].concat.apply([], set));
    }
    if (t.v === '√') { this.next(); return E.pow(this.pUnary(), E.rational(1, 2)); }
    if (t.k === 'op' && t.v === '|') {                 // |x| → abs(x)
      this.next();
      var inner = this.pAdd();
      this.expect('op', '|');
      return E.fun('abs', [inner]);
    }
    if (t.k === 'op' && t.v === '∫') { this.next(); return E.integ(this.pUnary(), symbolOrDefault(this)); }
    if (t.k === 'op' && t.v === '∑') { this.next(); return E.fun('sum', [this.pUnary()]); }
    throw parseError(src, t.i, t.k === 'eof' ? 'unexpected end of input' : 'unexpected “' + t.v + '”');
  };
  function symbolOrDefault(pp) { void pp; return E.sym('x'); }

  function numberNode(s) {
    if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) {
      var m = /^([+-]?\d*\.?\d*)[eE]([+-]?\d+)$/.exec(s);
      if (m) {
        var mant = Rat.parse(m[1] || '1'), ex = parseInt(m[2], 10);
        return E.num(ex >= 0 ? mant.mul(Rat.int(10n ** BigInt(ex))) : mant.div(Rat.int(10n ** BigInt(-ex))));
      }
    }
    return E.num(Rat.parse(s));
  }

  function buildCall(name, args) {
    switch (name) {
      case 'diff': case 'D':
        if (args.length === 1) return E.deriv(args[0], E.sym('x'), 1);
        return E.deriv(args[0], args[1], args.length > 2 && args[2].t === 'num' ? Number(args[2].v.toNumber()) : 1);
      case 'integrate': case 'int':
        if (args.length === 1) return E.integ(args[0], E.sym('x'));
        return E.integ(args[0], args[1]);
      case 'sqrt': return E.pow(args[0], E.rational(1, 2));
      case 'root': return E.pow(args[0], E.div(E.int(1), args[1]));
      case 'factorial': return E.fun('factorial', [args[0]]);
      case 'log':
        if (args.length === 1) return E.fun('ln', [args[0]]);
        return E.div(E.fun('ln', [args[0]]), E.fun('ln', [args[1]]));
      default:
        return E.fun(name, args);
    }
  }

  function parse(src) {
    if (src == null) throw new Error('parse: nothing to parse');
    var s = String(src).trim();
    if (s === '') throw new Error('parse: empty input');
    return new Parser(s).parse();
  }
  function tryParse(src) {
    try { return { ok: true, value: parse(src) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  AE.parse = parse;
  AE.tryParse = tryParse;
  AE.tokenize = tokenize;
  AE.Parser = Parser;

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function p(s) { return parse(s); }
  U.test('parser', 'basics', function (a) {
    a.ok(E.eqq(p('x'), E.sym('x')), 'symbol');
    a.ok(E.eqq(p('2'), E.int(2)), 'integer');
    a.ok(E.eqq(p('1.5'), E.rational(3, 2)), 'decimal is exact');
    a.ok(E.eqq(p('1/2'), E.rational(1, 2)), 'fraction');
    a.ok(E.eqq(p('2 x'), E.mul(E.int(2), E.sym('x'))), 'implicit multiplication');
    a.ok(E.eqq(p('2x'), E.mul(E.int(2), E.sym('x'))), 'implicit multiplication, no space');
    a.ok(E.eqq(p('3(x+1)'), E.mul(E.int(3), E.add(E.sym('x'), E.ONE))), 'implicit paren');
    a.ok(E.eqq(p('(x+1)(x+2)'), E.mul(E.add(E.sym('x'), E.ONE), E.add(E.sym('x'), E.int(2)))), 'adjacent parens');
    a.ok(E.eqq(p('-x^2'), E.neg(E.pow(E.sym('x'), E.int(2)))), 'unary minus binds looser than ^');
    a.ok(E.eqq(p('2^3^2'), E.pow(E.int(2), E.pow(E.int(3), E.int(2)))), 'power is right associative');
    a.ok(E.eqq(p('x^2 + 3*x - 1'), E.add(E.pow(E.sym('x'), E.int(2)), E.mul(E.int(3), E.sym('x')), E.int(-1))), 'polynomial');
    a.ok(E.eqq(p('1/2x'), E.mul(E.rational(1, 2), E.sym('x'))), 'slash binds like times');
    a.ok(E.eqq(p('2.5e3'), E.int(2500)), 'scientific notation exact');
    a.ok(E.eqq(p('1e-3'), E.rational(1, 1000)), 'negative exponent notation');
  });

  U.test('parser', 'unicode', function (a) {
    a.ok(E.eqq(p('√2'), E.pow(E.int(2), E.rational(1, 2))), '√');
    a.ok(E.eqq(p('√(x^2+1)'), E.pow(E.add(E.pow(E.sym('x'), E.int(2)), E.ONE), E.rational(1, 2))), '√expr');
    a.ok(E.eqq(p('π'), E.sym('pi')), 'π');
    a.ok(E.eqq(p('2π'), E.mul(E.int(2), E.sym('pi'))), '2π');
    a.ok(E.eqq(p('x²'), E.pow(E.sym('x'), E.int(2))), 'superscript');
    a.ok(E.eqq(p('x⁻¹'), E.pow(E.sym('x'), E.int(-1))), 'negative superscript');
    a.ok(E.eqq(p('x³⁴'), E.pow(E.sym('x'), E.int(34))), 'multi-digit superscript');
    a.ok(E.eqq(p('3·x'), E.mul(E.int(3), E.sym('x'))), 'middle dot');
    a.ok(E.eqq(p('a×b'), E.mul(E.sym('a'), E.sym('b'))), 'times');
    a.ok(E.eqq(p('6÷2'), E.int(3)), 'division sign');
    a.ok(E.eqq(p('|x|'), E.fun('abs', [E.sym('x')])), 'absolute value');
    a.ok(E.eqq(p('α+β'), E.add(E.sym('α'), E.sym('β'))), 'greek identifiers');
    a.ok(E.eqq(p('−x'), E.neg(E.sym('x'))), 'unicode minus');
  });

  U.test('parser', 'functions & structures', function (a) {
    a.ok(E.eqq(p('sin(x)'), E.fun('sin', [E.sym('x')])), 'call');
    a.ok(E.eqq(p('sin x'), E.fun('sin', [E.sym('x')])), 'call without parens');
    a.ok(E.eqq(p('log(x,2)'), E.div(E.fun('ln', [E.sym('x')]), E.fun('ln', [E.int(2)]))), 'log base');
    a.ok(E.eqq(p('diff(sin(x),x)'), E.deriv(E.fun('sin', [E.sym('x')]), E.sym('x'), 1)), 'derivative node');
    a.ok(E.eqq(p('integrate(x,x)'), E.integ(E.sym('x'), E.sym('x'))), 'integral node');
    a.ok(E.eqq(p('x!'), E.fun('factorial', [E.sym('x')])), 'factorial');
    a.eq(p('[1,2]').t, 'vec', 'vector');
    a.eq(p('[1,2;3,4]').t, 'mat', 'matrix');
    a.eq(p('[1,2;3,4]').rows.length, 2, 'matrix rows');
    a.ok(E.eqq(p('exp(-x^2/2)'), E.fun('exp', [E.neg(E.div(E.pow(E.sym('x'), E.int(2)), E.int(2)))])), 'gaussian');
    a.eq(p('sum(f, i, 1, n)').t, 'fun', 'sum stays symbolic');
  });

  U.test('parser', 'errors', function (a) {
    a.throws(function () { p('1 +'); }, 'trailing operator');
    a.throws(function () { p('(x'); }, 'missing paren');
    a.throws(function () { p(''); }, 'empty');
    a.throws(function () { p('x $ y'); }, 'bad character');
    var err = null;
    try { p('1 +* 2'); } catch (e) { err = e; }
    a.ok(err && err.parse && err.parse.col > 0, 'error carries position');
  });

  U.test('parser', 'round trip through the printer', function (a) {
    var cases = ['x^2+3*x-1', 'sin(x)*cos(y)', '(x+1)/(x-1)', 'sqrt(2)/2', 'pi*r^2',
      'exp(-x^2)', '1/(1+x^2)', 'x^3-2*x+5', 'ln(abs(x))', '2*x*y', 'a^2+b^2-c^2'];
    for (var i = 0; i < cases.length; i++) {
      var e = p(cases[i]);
      var s = AE.print && AE.print.text ? AE.print.text(e) : null;
      if (!s) continue;
      var back = p(s);
      a.ok(E.eqq(e, back), 'round trip: ' + cases[i] + ' → ' + s);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
