/* ALETHEIA — the trusted kernel.
 *
 * Propositions are types; proofs are programs; checking a proof is typechecking
 * a term. Everything else in this project — the search, the tactics, the
 * theorem library — is untrusted code that must produce terms this file
 * accepts. If any of them lies, the kernel says no.
 *
 * The whole logical content of the system is these typing rules:
 *
 *   Γ,x:A ⊢ x : A              Γ,x:A ⊢ b : B            Γ ⊢ λx.b : A→B
 *   Γ ⊢ f : A→B   Γ ⊢ a : A    Γ ⊢ f a : B
 *   Γ ⊢ a : A    Γ ⊢ b : B     Γ ⊢ ⟨a,b⟩ : A∧B
 *   Γ ⊢ p : A∧B                Γ ⊢ fst p : A      Γ ⊢ snd p : B
 *   Γ ⊢ a : A                  Γ ⊢ inl a : A∨B    (and symmetrically)
 *   Γ ⊢ s : A∨B  x:A ⊢ l : C  y:B ⊢ r : C          Γ ⊢ case s of ... : C
 *   Γ ⊢ () : ⊤                 Γ ⊢ e : ⊥            Γ ⊢ abort e : A
 *
 * Classical reasoning is not built in. It is added as an axiom *instance* per
 * proposition:  dn_P : ((P → ⊥) → ⊥) → P, so even classical theorems are
 * checked down to these same eight rules.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util;

  /* ══════════════════════════════════════════════════════════════════════
     Types (propositions)
     ══════════════════════════════════════════════════════════════════════ */
  function TAtom(name) { return { k: 'atom', name: name }; }
  function TImp(a, b) { return { k: 'imp', a: a, b: b }; }
  function TAnd(a, b) { return { k: 'and', a: a, b: b }; }
  function TOr(a, b) { return { k: 'or', a: a, b: b }; }
  var TTrue = { k: 'true' };
  var TFalse = { k: 'false' };
  function TNot(a) { return TImp(a, TFalse); }

  function typeEq(a, b) {
    if (a === b) return true;
    if (a.k !== b.k) return false;
    switch (a.k) {
      case 'atom': return a.name === b.name;
      case 'imp': case 'and': case 'or': return typeEq(a.a, b.a) && typeEq(a.b, b.b);
      default: return true;
    }
  }
  function typeHash(t) {
    switch (t.k) {
      case 'atom': return '@' + t.name;
      case 'imp': return '(' + typeHash(t.a) + '→' + typeHash(t.b) + ')';
      case 'and': return '(' + typeHash(t.a) + '∧' + typeHash(t.b) + ')';
      case 'or': return '(' + typeHash(t.a) + '∨' + typeHash(t.b) + ')';
      case 'true': return '⊤';
      case 'false': return '⊥';
      default: return '?';
    }
  }
  /* Pretty printing with the *fewest* parentheses that still parse back to
     exactly the same tree. Binding powers: 1 →, 2 ∨, 3 ∧, 4 atoms; → is
     right-associative, the others left. The round trip through this printer is
     tested, because printing something that re-parses differently is the
     oldest way for a theorem prover to lie to you. */
  function precOf(t) {
    switch (t.k) { case 'imp': return 1; case 'or': return 2; case 'and': return 3; default: return 4; }
  }
  function typeStr(t, minPrec) {
    minPrec = minPrec === undefined ? 0 : minPrec;
    function child(sub, required) {
      return precOf(sub) < required ? '(' + typeStr(sub, 0) + ')' : typeStr(sub, required);
    }
    function parent(s, myPrec) { return myPrec < minPrec ? '(' + s + ')' : s; }
    switch (t.k) {
      case 'atom': return t.name;
      case 'true': return '⊤';
      case 'false': return '⊥';
      case 'imp': return parent(child(t.a, 2) + ' → ' + child(t.b, 1), 1);
      case 'or': return parent(child(t.a, 2) + ' ∨ ' + child(t.b, 3), 2);
      case 'and': return parent(child(t.a, 3) + ' ∧ ' + child(t.b, 4), 3);
      default: return '?';
    }
  }

  /* ── a miniature proposition parser ─────────────────────────────────── */
  function tokenizeProp(s) {
    var toks = [], i = 0;
    s = s.replace(/→/g, '->').replace(/∧/g, '&').replace(/∨/g, '|')
      .replace(/¬/g, '!').replace(/⊤/g, '1').replace(/⊥/g, '0')
      .replace(/<->/g, '<->').replace(/↔/g, '<->');
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (s.substr(i, 3) === '<->') { toks.push({ k: 'iff', v: '<->', i: i }); i += 3; continue; }
      if (s.substr(i, 2) === '->') { toks.push({ k: 'arrow', v: '->', i: i }); i += 2; continue; }
      if ('&|!10()'.indexOf(c) >= 0) { toks.push({ k: c, v: c, i: i }); i++; continue; }
      var m = /^[A-Za-z][A-Za-z0-9_']*/.exec(s.slice(i));
      if (m) {
        toks.push({ k: 'name', v: m[0], i: i }); i += m[0].length; continue;
      }
      throw new Error('cannot tokenise proposition at position ' + i);
    }
    toks.push({ k: 'eof', v: null, i: s.length });
    return toks;
  }
  function parseProp(s) {
    var toks = tokenizeProp(s), p = 0;
    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function eat(k) { if (toks[p].k === k) return next(); throw new Error('expected ' + k); }
    /* iff <-> arrow <-> ... ; parsed at the lowest level so that
       P ↔ Q really does become the conjunction of two implications */
    function pIff() {
      var left = pArrow();
      while (peek().k === 'iff') {
        next();
        var right = pArrow();
        left = TAnd(TImp(left, right), TImp(right, left));
      }
      return left;
    }
    function pArrow() {                     // right associative, as it should be
      var left = pOr();
      if (peek().k === 'arrow') {
        next();
        return TImp(left, pArrow());
      }
      return left;
    }
    function pOr() {
      var left = pAnd();
      while (peek().k === '|') { next(); left = TOr(left, pAnd()); }
      return left;
    }
    function pAnd() {
      var left = pUnary();
      while (peek().k === '&') { next(); left = TAnd(left, pUnary()); }
      return left;
    }
    function pUnary() {
      if (peek().k === '!') { next(); return TNot(pUnary()); }
      return pAtom();
    }
    function pAtom() {
      var t = peek();
      if (t.k === '(') { next(); var inner = pIff(); eat(')'); return inner; }
      if (t.k === 'name') { next(); return TAtom(t.v); }
      if (t.k === '1') { next(); return TTrue; }
      if (t.k === '0') { next(); return TFalse; }
      throw new Error('unexpected token in proposition: ' + t.v);
    }
    var r = pIff();
    if (peek().k !== 'eof') throw new Error('trailing input in proposition');
    return r;
  }

  /* ══════════════════════════════════════════════════════════════════════
     Terms (proofs)
     ══════════════════════════════════════════════════════════════════════ */
  function Var(n) { return { k: 'var', name: n }; }
  function Lam(v, ty, body) { return { k: 'lam', v: v, ty: ty, body: body }; }
  function App(f, a) { return { k: 'app', f: f, a: a }; }
  function Pair(a, b) { return { k: 'pair', a: a, b: b }; }
  function Fst(p) { return { k: 'fst', p: p }; }
  function Snd(p) { return { k: 'snd', p: p }; }
  function Inl(t, right) { return { k: 'inl', t: t, right: right }; }
  function Inr(t, left) { return { k: 'inr', t: t, left: left }; }
  function Case(s, lv, lt, lbody, rv, rt, rbody) {
    return { k: 'case', scrut: s, lv: lv, lt: lt, lbody: lbody, rv: rv, rt: rt, rbody: rbody };
  }
  function Unit() { return { k: 'unit' }; }
  function Abort(e, ty) { return { k: 'abort', e: e, ty: ty }; }
  function Const(name) { return { k: 'const', name: name }; }

  /* ── the kernel: infer ⊢ term : type ────────────────────────────────── */
  function CheckError(msg) { return new Error(msg); }

  function lookupVar(env, name) {
    for (var i = env.length - 1; i >= 0; i--) if (env[i].name === name) return env[i].ty;
    return null;
  }
  /* env: array of {name, ty}; constants live in `ctx` = {name → type} */
  function infer(term, env, ctx) {
    switch (term.k) {
      case 'var': {
        var ty = lookupVar(env, term.name);
        if (ty === null) throw CheckError('unbound variable: ' + term.name);
        return ty;
      }
      case 'const': {
        if (!ctx || ctx[term.name] === undefined) throw CheckError('unknown constant: ' + term.name);
        return ctx[term.name];
      }
      case 'lam': {
        if (term.ty === undefined || term.ty === null) throw CheckError('λ needs an annotated type');
        var inner = env.concat([{ name: term.v, ty: term.ty }]);
        var bt = infer(term.body, inner, ctx);
        return TImp(term.ty, bt);
      }
      case 'app': {
        var ft = infer(term.f, env, ctx);
        if (ft.k !== 'imp') throw CheckError('applying something that is not a function: ' + typeStr(ft));
        var at = infer(term.a, env, ctx);
        if (!typeEq(at, ft.a)) {
          throw CheckError('argument type mismatch: expected ' + typeStr(ft.a) + ', got ' + typeStr(at));
        }
        return ft.b;
      }
      case 'pair': return TAnd(infer(term.a, env, ctx), infer(term.b, env, ctx));
      case 'fst': {
        var pt = infer(term.p, env, ctx);
        if (pt.k !== 'and') throw CheckError('fst of a non-conjunction');
        return pt.a;
      }
      case 'snd': {
        var st = infer(term.p, env, ctx);
        if (st.k !== 'and') throw CheckError('snd of a non-conjunction');
        return st.b;
      }
      case 'inl': return TOr(infer(term.t, env, ctx), term.right);
      case 'inr': return TOr(term.left, infer(term.t, env, ctx));
      case 'case': {
        var scr = infer(term.scrut, env, ctx);
        if (scr.k !== 'or') throw CheckError('case analysis on a non-disjunction');
        if (!typeEq(scr.a, term.lt)) throw CheckError('left branch type mismatch in case');
        if (!typeEq(scr.b, term.rt)) throw CheckError('right branch type mismatch in case');
        var lt = infer(term.lbody, env.concat([{ name: term.lv, ty: term.lt }]), ctx);
        var rt = infer(term.rbody, env.concat([{ name: term.rv, ty: term.rt }]), ctx);
        if (!typeEq(lt, rt)) throw CheckError('case branches disagree');
        return lt;
      }
      case 'unit': return TTrue;
      case 'abort': {
        var et = infer(term.e, env, ctx);
        if (et.k !== 'false') throw CheckError('ex falso requires a proof of ⊥, got ' + typeStr(et));
        if (term.ty === undefined || term.ty === null) throw CheckError('abort needs a result type');
        return term.ty;
      }
      default: throw CheckError('malformed term');
    }
  }
  /* check a claimed theorem: term must have exactly type `claim` */
  function check(term, claim, ctx) {
    var t = infer(term, [], ctx || {});
    if (!typeEq(t, claim)) {
      throw CheckError('proof has type ' + typeStr(t) + ' but claims ' + typeStr(claim));
    }
    return true;
  }
  function accepts(term, claim, ctx) {
    try { check(term, claim, ctx); return true; } catch (e) { return false; }
  }
  function why(term, claim, ctx) {
    try { check(term, claim, ctx); return null; } catch (e) { return e.message; }
  }

  /* ── β-normalisation: proofs are programs, so run them ──────────────── */
  function substTerm(t, name, value) {
    switch (t.k) {
      case 'var': return t.name === name ? value : t;
      case 'lam':
        if (t.v === name) return t;
        return Lam(t.v, t.ty, substTerm(t.body, name, value));
      case 'app': return App(substTerm(t.f, name, value), substTerm(t.a, name, value));
      case 'pair': return Pair(substTerm(t.a, name, value), substTerm(t.b, name, value));
      case 'fst': return Fst(substTerm(t.p, name, value));
      case 'snd': return Snd(substTerm(t.p, name, value));
      case 'inl': return Inl(substTerm(t.t, name, value), t.right);
      case 'inr': return Inr(substTerm(t.t, name, value), t.left);
      case 'case':
        return Case(substTerm(t.scrut, name, value), t.lv, t.lt,
          t.lv === name ? t.lbody : substTerm(t.lbody, name, value),
          t.rv, t.rt,
          t.rv === name ? t.rbody : substTerm(t.rbody, name, value));
      default: return t;
    }
  }
  function normalize(t, steps) {
    steps = steps || { n: 0 };
    switch (t.k) {
      case 'app': {
        var f = normalize(t.f, steps), a = normalize(t.a, steps);
        if (f.k === 'lam') { steps.n++; return normalize(substTerm(f.body, f.v, a), steps); }
        return App(f, a);
      }
      case 'fst': {
        var p = normalize(t.p, steps);
        if (p.k === 'pair') { steps.n++; return normalize(p.a, steps); }
        return Fst(p);
      }
      case 'snd': {
        var q = normalize(t.p, steps);
        if (q.k === 'pair') { steps.n++; return normalize(q.b, steps); }
        return Snd(q);
      }
      case 'case': {
        var s = normalize(t.scrut, steps);
        if (s.k === 'inl') { steps.n++; return normalize(substTerm(t.lbody, t.lv, s.t), steps); }
        if (s.k === 'inr') { steps.n++; return normalize(substTerm(t.rbody, t.rv, s.t), steps); }
        return Case(s, t.lv, t.lt, normalize(t.lbody, steps), t.rv, t.rt, normalize(t.rbody, steps));
      }
      case 'lam': return Lam(t.v, t.ty, normalize(t.body, steps));
      case 'pair': return Pair(normalize(t.a, steps), normalize(t.b, steps));
      case 'inl': return Inl(normalize(t.t, steps), t.right);
      case 'inr': return Inr(normalize(t.t, steps), t.left);
      case 'abort': return Abort(normalize(t.e, steps), t.ty);
      default: return t;
    }
  }
  function termStr(t, prec) {
    prec = prec === undefined ? 0 : prec;
    function wrap(s, p) { return p < prec ? '(' + s + ')' : s; }
    switch (t.k) {
      case 'var': case 'const': return t.name;
      case 'lam': return wrap('λ' + t.v + ':' + typeStr(t.ty, 3) + '. ' + termStr(t.body, 0), 1);
      case 'app': return wrap(termStr(t.f, 2) + ' ' + termStr(t.a, 3), 2);
      case 'pair': return '⟨' + termStr(t.a) + ', ' + termStr(t.b) + '⟩';
      case 'fst': return wrap('fst ' + termStr(t.p, 3), 2);
      case 'snd': return wrap('snd ' + termStr(t.p, 3), 2);
      case 'inl': return wrap('inl ' + termStr(t.t, 3), 2);
      case 'inr': return wrap('inr ' + termStr(t.t, 3), 2);
      case 'case':
        return wrap('case ' + termStr(t.scrut, 3) + ' of inl ' + t.lv + ' ⇒ ' + termStr(t.lbody, 0) +
          ' | inr ' + t.rv + ' ⇒ ' + termStr(t.rbody, 0), 1);
      case 'unit': return '()';
      case 'abort': return wrap('abort ' + termStr(t.e, 3), 2);
      default: return '?';
    }
  }
  function termSize(t) {
    switch (t.k) {
      case 'var': case 'const': case 'unit': return 1;
      case 'lam': return 1 + termSize(t.body);
      case 'app': return 1 + termSize(t.f) + termSize(t.a);
      case 'pair': return 1 + termSize(t.a) + termSize(t.b);
      case 'fst': case 'snd': case 'inl': case 'inr': case 'abort': return 1 + termSize(t.p || t.t || t.e);
      case 'case': return 1 + termSize(t.scrut) + termSize(t.lbody) + termSize(t.rbody);
      default: return 1;
    }
  }

  var Kernel = {
    T: { atom: TAtom, imp: TImp, and: TAnd, or: TOr, not: TNot, TRUE: TTrue, FALSE: TFalse },
    t: { var: Var, lam: Lam, app: App, pair: Pair, fst: Fst, snd: Snd, inl: Inl, inr: Inr, case: Case, unit: Unit, abort: Abort, const: Const },
    parse: parseProp, str: typeStr, termStr: termStr, termSize: termSize,
    eq: typeEq, hash: typeHash,
    infer: infer, check: check, accepts: accepts, why: why,
    normalize: normalize, subst: substTerm
  };
  AE.kernel = Kernel;

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  var K = Kernel;
  function T(s) { return parseProp(s); }
  function COMM(ctx, n) { return {a:1}; }

  U.test('kernel', 'proposition syntax', function (a) {
    a.eq(typeStr(T('P -> Q')), 'P → Q', 'implication');
    a.eq(typeStr(T('P & Q -> P')), 'P ∧ Q → P', 'conjunction');
    a.eq(typeStr(T('(P -> 0) -> 0')), '(P → ⊥) → ⊥', 'double negation');
    a.eq(typeStr(T('P | Q -> P')), 'P ∨ Q → P', 'disjunction');
    a.ok(typeEq(T('P -> Q -> R'), T('P -> (Q -> R)')), 'implication is right associative');
    a.ok(typeEq(T('P <-> Q'), T('(P -> Q) & (Q -> P)')), 'iff expands to a conjunction');
    a.ok(!typeEq(T('P -> Q'), T('Q -> P')), 'not commutative');
  });

  U.test('kernel', 'printing round-trips', function (a) {
    var cases = ['P & (Q | R)', '(P -> 0) & P | P', 'P -> Q -> R', 'P | Q -> P & Q',
      '((P -> Q) -> P) -> P', 'P & Q & R', 'P | Q | R', '(P & Q) -> (P | Q)',
      '0 -> P', 'P -> 1', 'P -> (Q -> 0)', '(P | (Q -> 0)) & ((P -> 0) | Q)'];
    for (var i = 0; i < cases.length; i++) {
      var orig = T(cases[i]);
      var printed = K.str(orig);
      var back = T(printed);
      a.ok(typeEq(orig, back), '“' + printed + '” parses back to itself');
    }
  });

  U.test('kernel', 'the typing rules', function (a) {
    // identity: λ(P).λ(x:P).x  ⊢  P → P
    var id = Lam('P', null, null);
    var ident = Lam('x', T('P'), Var('x'));
    a.ok(typeEq(infer(ident, [], {}), T('P -> P')), 'identity term types as P → P');
    // ⟨⟩ pair projections
    var pp = Pair(Var('x'), Var('y'));
    a.ok(typeEq(infer(Fst(pp), [{ name: 'x', ty: T('P') }, { name: 'y', ty: T('Q') }], {}), T('P')), 'fst');
    a.ok(typeEq(infer(Snd(pp), [{ name: 'x', ty: T('P') }, { name: 'y', ty: T('Q') }], {}), T('Q')), 'snd');
    // ex falso
    a.ok(typeEq(infer(Abort(Var('f'), T('Z')), [{ name: 'f', ty: TFalse }], {}), T('Z')), 'ex falso');
    // unit
    a.ok(typeEq(infer(Unit(), [], {}), TTrue), 'unit');
  });

  U.test('kernel', 'rejects forged proofs', function (a) {
    var P = T('P'), Q = T('Q');
    var wrong1 = App(Lam('x', P, Var('x')), Unit());                 // applied to the wrong thing
    a.ok(!accepts(wrong1, P, {}), 'argument type mismatch rejected');
    var wrong2 = App(Lam('x', P, Var('x')), Lam('y', Q, Var('y')));  // P→P applied to Q→Q
    a.ok(!accepts(wrong2, P, {}), 'function type mismatch rejected');
    a.ok(!accepts(Var('x'), P, {}), 'unbound variable rejected');
    a.ok(!accepts(Const('miracle'), P, {}), 'undeclared axiom rejected');
    a.ok(!accepts(Fst(Var('x')), P, { x: P }), 'projection from a non-pair rejected');
    a.ok(!accepts(Lam('x', P, Var('y')), T('P -> Q'), {}), 'unbound variable in a λ rejected');
    var sneaky = Lam('x', T('P & Q'), Pair(Fst(Var('x')), Snd(Var('x'))));
    a.ok(accepts(sneaky, T('P & Q -> Q & P'), {}) === false, 'swapped pair does not prove commutativity');
    a.ok(accepts(Lam('x', T('P & Q'), Pair(Snd(Var('x')), Fst(Var('x')))), T('P & Q -> Q & P'), {}),
      'the honest swap does');
  });

  U.test('kernel', 'proofs compute', function (a) {
    // K = λx:P. λy:Q. x  applied to two witnesses normalises to the first
    var P = T('P'), Q = T('Q');
    var Kterm = App(App(Lam('x', P, Lam('y', Q, Var('x'))), Const('wP')), Const('wQ'));
    var steps = { n: 0 };
    var out = normalize(Kterm, steps);
    a.eq(termStr(out), 'wP', 'K discards its second argument');
    a.eq(steps.n, 2, 'two β steps');
    // swap: ⟨a,b⟩ ↦ ⟨b,a⟩
    var swap = App(Lam('p', T('P & Q'), Pair(Snd(Var('p')), Fst(Var('p')))), Pair(Const('a'), Const('b')));
    a.eq(termStr(normalize(swap)), '⟨b, a⟩', 'the commutativity proof swaps the pair');
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
