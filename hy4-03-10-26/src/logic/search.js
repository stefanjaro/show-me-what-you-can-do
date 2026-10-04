/* ALETHEIA — proof search.
 *
 * This module is *untrusted*. It guesses. What it produces is handed to
 * src/logic/kernel.js, which either accepts it or sends it back. The strategy:
 *
 *   1. try the introduction rules (λ, ⟨·,·⟩, inl/inr, ());
 *   2. otherwise use a hypothesis whose conclusion matches the goal;
 *   3. otherwise try to prove ⊥ from what we know, then use ex falso;
 *   4. if all of that fails, reason classically: prove ¬¬P intuitionistically
 *      and apply an instance of double-negation elimination — an axiom the
 *      kernel is told about explicitly, per proposition.
 *
 * Step 3 inside step 4 is what makes it complete for classical propositional
 * logic, and the algorithm is *verified*, not believed: the test suite sweeps
 * every formula up to a given size, compares against exhaustive truth tables,
 * and insists the two agree exactly.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util;
  var K = AE.kernel;
  var T = K.T, t = K.t;

  var freshCounter = 0;
  function fresh(p) { return p + (++freshCounter); }

  /* decompose A₁ → … → Aₙ → C into ([A₁…Aₙ], C) */
  function spine(ty) {
    var args = [];
    while (ty.k === 'imp') { args.push(ty.a); ty = ty.b; }
    return { args: args, result: ty };
  }
  function applyChain(head, argTerms) {
    var out = head;
    for (var i = 0; i < argTerms.length; i++) out = t.app(out, argTerms[i]);
    return out;
  }
  /* A hypothesis A∧B is the same information as A together with B, so every
     conjunctive hypothesis is split into the pieces you can project out of it. */
  function splitEntry(term, ty, out) {
    if (ty.k === 'and') {
      splitEntry(t.fst(term), ty.a, out);
      splitEntry(t.snd(term), ty.b, out);
      return out;
    }
    out.push({ term: term, ty: ty });
    return out;
  }
  function available(hyps) {
    var out = [];
    for (var i = 0; i < hyps.length; i++) {
      splitEntry(hyps[i].term || t.var(hyps[i].name), hyps[i].ty, out);
    }
    return out;
  }

  /* ── the searcher ───────────────────────────────────────────────────────
     Propositional intuitionistic search has the subformula property: every
     goal that can ever appear is a subformula of the original problem, and
     every hypothesis too. So the state space (multiset of hypotheses ⊢ goal)
     is *finite*. Two consequences worth exploiting:

       · the memo key carries no depth — a failure with few resources is still
         a failure with many, so each state is decided once and forever;
       · a state encountered again on its own ancestry is a loop, and is cut.

     That turns "search for a proof" into "decide a finite graph", which is why
     the whole thing terminates in milliseconds instead of running forever. */
  function Searcher(opts) {
    this.opts = opts || {};
    this.maxDepth = this.opts.maxDepth || 48;
    this.nodes = 0;
    this.memo = Object.create(null);
    this.active = Object.create(null);
    this.budget = this.opts.budget || 200000;
    this.looped = false;
    this.loopCuts = 0;
  }
  /* Types only: two hypothesis lists with the same types prove the same things,
     and terms are self-contained, so the variable names may be ignored. */
  Searcher.prototype.key = function (hyps, goal) {
    var hs = [], i;
    for (i = 0; i < hyps.length; i++) hs.push(K.hash(hyps[i].ty));
    hs.sort();
    return hs.join(',') + ' ⊢ ' + K.hash(goal);
  };
  Searcher.prototype.prove = function (hyps, goal, depth) {
    if (depth > this.maxDepth) return null;
    if (this.nodes > this.budget) return null;
    var k = this.key(hyps, goal);
    if (this.active[k]) { this.looped = true; this.loopCuts++; return null; }
    var cached = this.memo[k];
    if (cached !== undefined) {
      /* Successes are reused too, but the term was written against *those*
         variable names: translate it to speak about the ones we have here. */
      if (cached === null) return null;
      return reindex(cached.term, cached.hyps, hyps, t);
    }

    this.active[k] = true;
    this.nodes++;
    var outer = this.looped;
    this.looped = false;
    var res = this.prove1(hyps, goal, depth);
    var tainted = this.looped;              // a loop was cut somewhere below
    if (res === null) { if (!tainted) this.memo[k] = null; }
    else this.memo[k] = { term: res, hyps: hyps };
    this.looped = outer || tainted;
    delete this.active[k];
    return res;
  };

  /* simultaneous renaming of free variables, by hypothesis type */
  function reindex(term, fromHyps, toHyps, t) {
    var pool = Object.create(null), i;
    for (i = 0; i < toHyps.length; i++) {
      var h = K.hash(toHyps[i].ty);
      (pool[h] = pool[h] || []).push(toHyps[i].name);
    }
    var map = Object.create(null), used = false;
    for (i = 0; i < fromHyps.length; i++) {
      var list = pool[K.hash(fromHyps[i].ty)];
      if (!list || !list.length) return term;             // shouldn't happen; don't lie about it
      var to = list.pop();
      if (to !== fromHyps[i].name) { map[fromHyps[i].name] = t.var(to); used = true; }
    }
    return used ? renameMap(term, map) : term;
  }
  function shallowCopy(m) {
    var o = Object.create(null);
    for (var k in m) o[k] = m[k];
    return o;
  }
  function renameMap(tm, map) {
    switch (tm.k) {
      case 'var': return map[tm.name] || tm;
      case 'lam': {
        var inner2 = map;
        if (inner2[tm.v]) { inner2 = shallowCopy(map); delete inner2[tm.v]; }
        return t.lam(tm.v, tm.ty, renameMap(tm.body, inner2));
      }
      case 'case': {
        var m2 = map, m3 = map, copy;
        if (map[tm.lv] || map[tm.rv]) copy = shallowCopy(map);
        if (map[tm.lv]) { m2 = copy; delete m2[tm.lv]; }
        if (map[tm.rv]) { m3 = shallowCopy(copy || map); delete m3[tm.rv]; }
        return t.case(renameMap(tm.scrut, map), tm.lv, tm.lt, renameMap(tm.lbody, m2),
          tm.rv, tm.rt, renameMap(tm.rbody, m3));
      }
      case 'app': return t.app(renameMap(tm.f, map), renameMap(tm.a, map));
      case 'pair': return t.pair(renameMap(tm.a, map), renameMap(tm.b, map));
      case 'fst': return t.fst(renameMap(tm.p, map));
      case 'snd': return t.snd(renameMap(tm.p, map));
      case 'inl': return t.inl(renameMap(tm.t, map), tm.right);
      case 'inr': return t.inr(renameMap(tm.t, map), tm.left);
      case 'abort': return t.abort(renameMap(tm.e, map), tm.ty);
      default: return tm;
    }
  }
  /* ── projections out of a derived conjunction ───────────────────────── */
  /* a list of 'left'/'right' steps reaching `goal` inside `ty`, or null */
  function projection(ty, goal, acc) {
    acc = acc || [];
    if (K.eq(ty, goal)) return acc;
    if (ty.k === 'and') {
      var l = projection(ty.a, goal, acc.concat(['left']));
      return l !== null ? l : projection(ty.b, goal, acc.concat(['right']));
    }
    return null;
  }
  function through(term, path) {
    for (var i = 0; i < path.length; i++) term = path[i] === 'left' ? t.fst(term) : t.snd(term);
    return term;
  }
  /* same, but hunting for the first node of a given kind */
  function projectionKind(ty, kind, acc) {
    acc = acc || [];
    if (ty.k === kind) return acc;
    if (ty.k === 'and') {
      var l = projectionKind(ty.a, kind, acc.concat(['left']));
      return l !== null ? l : projectionKind(ty.b, kind, acc.concat(['right']));
    }
    return null;
  }
  function at(ty, path) {
    for (var i = 0; i < path.length; i++) ty = path[i] === 'left' ? ty.a : ty.b;
    return ty;
  }

  /* Adding an assumption we already have changes nothing (contraction is
     admissible), so contexts stay *sets* of types. This is what bounds the
     state space by 2^(number of subformulas) instead of letting contexts grow
     without limit. Returns the entry to build terms with — possibly the one
     that was already there. */
  function extend(hyps, ty) {
    for (var i = 0; i < hyps.length; i++) {
      if (K.eq(hyps[i].ty, ty)) return { hyps: hyps, entry: hyps[i] };
    }
    var name = fresh('h');
    var e = { name: name, ty: ty, term: t.var(name) };
    return { hyps: hyps.concat([e]), entry: e };
  }

  Searcher.prototype.prove1 = function (hyps, goal, depth) {
    var i;
    if (depth > this.maxDepth || this.nodes > this.budget) return null;

    /* ⊤ always holds */
    if (goal.k === 'true') return t.unit();

    /* introduction rules */
    if (goal.k === 'imp') {
      var ex = extend(hyps, goal.a);
      var body = this.prove(ex.hyps, goal.b, depth + 1);
      if (body === null) return null;
      return t.lam(ex.entry.name, goal.a, body);
    }
    if (goal.k === 'and') {
      var l = this.prove(hyps, goal.a, depth + 1);
      if (l === null) return null;
      var rr = this.prove(hyps, goal.b, depth + 1);
      if (rr === null) return null;
      return t.pair(l, rr);
    }
    if (goal.k === 'or') {
      var left = this.prove(hyps, goal.a, depth + 1);
      if (left !== null) return t.inl(left, goal.b);
      var right = this.prove(hyps, goal.b, depth + 1);
      if (right !== null) return t.inr(right, goal.a);
      return null;
    }

    /* Everything we can lay our hands on: each hypothesis, applied to proofs
       of its premises. Built lazily, because for most goals we never need it. */
    var avail = available(hyps), built = new Array(avail.length), self = this;
    function derive(k) {
      if (built[k] !== undefined) return built[k];
      var sp1 = spine(avail[k].ty), arr = [], j2;
      for (j2 = 0; j2 < sp1.args.length; j2++) {
        var karg = self.prove(hyps, sp1.args[j2], depth + 1);
        if (karg === null) { built[k] = null; return null; }
        arr.push(karg);
      }
      built[k] = applyChain(avail[k].term, arr);
      return built[k];
    }

    /* settle the goal directly, or project it out of a conjunction we have */
    for (i = 0; i < avail.length; i++) {
      var path = projection(spine(avail[i].ty).result, goal);
      if (path === null) continue;
      var tm0 = derive(i);
      if (tm0 !== null) return through(tm0, path);
    }

    /* case analysis on any disjunction we can get hold of */
    for (i = 0; i < avail.length; i++) {
      var sp2 = spine(avail[i].ty);
      var p = projectionKind(sp2.result, 'or');
      if (p === null) continue;
      var disc = derive(i);
      if (disc === null) continue;
      var scr = through(disc, p), dty = at(sp2.result, p);
      /* the two branches are alternatives — neither inherits the other's
         assumption */
      var el = extend(hyps, dty.a), er = extend(hyps, dty.b);
      var lbody = this.prove(el.hyps, goal, depth + 1);
      if (lbody === null) continue;
      var rbody = this.prove(er.hyps, goal, depth + 1);
      if (rbody === null) continue;
      return t.case(scr, el.entry.name, dty.a, lbody, er.entry.name, dty.b, rbody);
    }

    /* last resort: derive ⊥ and use ex falso (this is the classical step) */
    if (goal.k !== 'false') {
      var bot = this.prove(hyps, T.FALSE, depth + 1);
      if (bot !== null) return t.abort(bot, goal);
    }
    return null;
  };

  /* ── top level: intuitionistic first, classical on demand ───────────── */
  function prove(prop, opts) {
    opts = opts || {};
    var s = new Searcher(opts);
    var direct = s.prove([], prop, 0);
    if (direct !== null) {
      return {
        term: direct, ctx: {}, classical: false, intuitionistic: true,
        nodes: s.nodes, ok: true
      };
    }
    s.looped = false;
    // classical: dn : ((P → ⊥) → ⊥) → P, handed to the kernel as an axiom
    var name = 'dn_' + U.hashSeed(K.hash(prop)).toString(36);
    var ctx = {};
    ctx[name] = T.imp(T.not(T.not(prop)), prop);
    var nv = 'absurd' + (++freshCounter);
    var notP = T.not(prop);
    var inner = s.prove([{ name: nv, ty: notP, term: t.var(nv) }], T.FALSE, 0);
    if (inner !== null) {
      return {
        term: t.app(t.const(name), t.lam(nv, notP, inner)),
        ctx: ctx, classical: true, intuitionistic: false, nodes: s.nodes, ok: true
      };
    }
    return { term: null, ctx: {}, classical: false, intuitionistic: false, nodes: s.nodes, ok: false };
  }
  /* intuitionistic-only: what you get without reaching for excluded middle */
  function proveIntuitionistic(prop, opts) {
    opts = opts || {};
    var s = new Searcher(opts);
    var r = s.prove([], prop, 0);
    return r === null ? { ok: false, nodes: s.nodes } : { ok: true, term: r, nodes: s.nodes };
  }
  function provable(prop, opts) {
    var r = prove(prop, opts);
    return r.ok && K.accepts(r.term, prop, r.ctx);
  }

  /* ── truth tables: the oracle we test ourselves against ─────────────── */
  function atoms(ty, out) {
    out = out || [];
    switch (ty.k) {
      case 'atom': if (out.indexOf(ty.name) < 0) out.push(ty.name); break;
      case 'imp': case 'and': case 'or': atoms(ty.a, out); atoms(ty.b, out); break;
      default: break;
    }
    return out;
  }
  function evalProp(ty, assign) {
    switch (ty.k) {
      case 'atom': return !!assign[ty.name];
      case 'true': return true;
      case 'false': return false;
      case 'imp': return !evalProp(ty.a, assign) || evalProp(ty.b, assign);
      case 'and': return evalProp(ty.a, assign) && evalProp(ty.b, assign);
      case 'or': return evalProp(ty.a, assign) || evalProp(ty.b, assign);
      default: return false;
    }
  }
  function classicalValid(ty) {
    var names = atoms(ty);
    if (names.length > 16) return null;               // too many: give up rather than lie
    var n = names.length;
    for (var mask = 0; mask < (1 << n); mask++) {
      var assign = {};
      for (var i = 0; i < n; i++) assign[names[i]] = !!(mask & (1 << i));
      if (!evalProp(ty, assign)) return false;
    }
    return true;
  }
  /* every formula built from `names` with at most `maxOps` connectives.
     Levels are built up by connective-count and de-duplicated, so nothing is
     ever generated twice. */
  function enumerate(maxOps, names, opts) {
    opts = opts || {};
    var cap = opts.cap || 1200;
    var leaves = names.map(function (n) { return T.atom(n); });
    if (opts.bottom) { leaves.push(T.TRUE, T.FALSE); }
    var levels = [dedupe(leaves)];
    for (var op = 1; op <= maxOps; op++) {
      var prev = [], i, j, k;
      for (k = 0; k < op; k++) prev.push(levels[k]);
      var out = [];
      // unary
      var above = levels[op - 1];
      for (i = 0; i < above.length; i++) out.push(T.not(above[i]));
      // binary: sizes adding up to op-1
      for (var sa = 0; sa <= op - 1; sa++) {
        var sb = op - 1 - sa;
        if (sb > sa) continue;                             // unordered pairs
        var A = levels[sa], B = levels[sb];
        for (i = 0; i < A.length; i++) {
          for (j = 0; j < B.length; j++) {
            out.push(T.imp(A[i], B[j]));
            out.push(T.and(A[i], B[j]));
            out.push(T.or(A[i], B[j]));
            if (sa !== sb) {
              out.push(T.imp(B[j], A[i]));
              out.push(T.and(B[j], A[i]));
              out.push(T.or(B[j], A[i]));
            }
          }
        }
      }
      out = dedupe(out);
      if (out.length > cap) out = out.slice(0, cap);
      levels[op] = out;
    }
    var all = [];
    for (i = 0; i < levels.length; i++) all = all.concat(levels[i]);
    return dedupe(all);
  }
  function dedupe(list) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < list.length; i++) {
      var h = K.hash(list[i]);
      if (seen[h]) continue;
      seen[h] = true;
      out.push(list[i]);
    }
    return out;
  }

  AE.search = {
    prove: prove, proveIntuitionistic: proveIntuitionistic, provable: provable,
    intuitionisticallyProvable: function (p, o) { return proveIntuitionistic(p, o).ok; },
    Searcher: Searcher, spine: spine,
    classicalValid: classicalValid, evalProp: evalProp, atoms: atoms, enumerate: enumerate
  };

  /* ── tests ──────────────────────────────────────────────────────────── */
  var A = U.assert;
  function P(s) { return K.parse(s); }
  function pr(s) {
    var r = prove(P(s));
    if (!r.ok) return { ok: false, text: null, accepted: false };
    return { ok: true, text: K.termStr(r.term), accepted: K.accepts(r.term, P(s), r.ctx), classical: r.classical, term: r.term, ctx: r.ctx };
  }

  U.test('search', 'intuitionistic theorems', function (a) {
    var cases = ['P -> P', 'P -> Q -> P', '(P -> Q -> R) -> (P -> Q) -> P -> R',
      'P & Q -> P', 'P & Q -> Q & P', 'P -> P | Q', 'Q -> P | Q',
      '(P -> Q) -> (P -> R) -> P -> Q & R', 'P -> Q -> P & Q',
      'P | Q -> (P -> R) -> (Q -> R) -> R', '1', 'P -> 1',
      '(P & Q -> R) -> P -> Q -> R', 'P -> (P -> Q) -> Q',
      '(P -> Q) -> (Q -> R) -> P -> R', '0 -> P'];
    for (var i = 0; i < cases.length; i++) {
      var r = pr(cases[i]);
      a.ok(r.ok, 'proved: ' + cases[i]);
      a.ok(r.accepted, 'kernel accepts: ' + cases[i]);
      a.ok(!r.classical, 'constructively: ' + cases[i]);
    }
  });

  U.test('search', 'classical theorems', function (a) {
    var cases = ['P | (P -> 0)', '((P -> 0) -> 0) -> P', '((P -> Q) -> P) -> P',
      '((P -> 0) | Q) -> (P -> Q)', '(P -> Q) -> ((P -> 0) | Q)',
      '((P & Q -> 0)) -> ((P -> 0) | (Q -> 0))',
      '(((P -> 0) & (Q -> 0)) -> 0) -> P | Q',
      '(P -> Q) -> (((P -> 0) -> Q) -> Q)'];
    for (var i = 0; i < cases.length; i++) {
      var r = pr(cases[i]);
      a.ok(r.ok, 'proved: ' + cases[i]);
      a.ok(r.accepted, 'kernel accepts it: ' + cases[i]);
      a.ok(classicalValid(P(cases[i])), 'really is a tautology: ' + cases[i]);
    }
  });

  U.test('search', 'it never proves a lie', function (a) {
    var lies = ['P', 'P -> Q', 'P | Q', 'P & (P -> 0)', '(P -> Q) -> Q', 'P -> P & Q', '0'];
    for (var i = 0; i < lies.length; i++) {
      var r = prove(P(lies[i]));
      if (r.ok) {
        a.ok(!K.accepts(r.term, P(lies[i]), r.ctx), 'kernel would reject this "proof" of ' + lies[i]);
      }
      a.eq(classicalValid(P(lies[i])), false, 'is not a tautology: ' + lies[i]);
      a.eq(provable(P(lies[i])), false, 'search does not claim ' + lies[i]);
    }
  });

  U.test('search', 'completeness against exhaustive truth tables', function (a) {
    // Sweep every formula up to a connective budget, over two and three atoms.
    // Validity is decided independently by exhaustive truth table; the search
    // is then asked for exactly the tautologies — no more, no fewer.
    var sweeps = [
      { ops: 2, names: ['P', 'Q'], cap: 4000 },
      { ops: 3, names: ['P', 'Q'], cap: 6000 },
      { ops: 2, names: ['P', 'Q', 'R'], cap: 4000 }
    ];
    var totals = { formulas: 0, taut: 0, proved: 0, sound: 0, intuitionistic: 0 };
    for (var s = 0; s < sweeps.length; s++) {
      var formulas = enumerate(sweeps[s].ops, sweeps[s].names, { bottom: true, cap: sweeps[s].cap });
      var missed = [], admitted = [];
      for (var i = 0; i < formulas.length; i++) {
        var f = formulas[i];
        var valid = classicalValid(f);
        if (valid === null) continue;
        var r = prove(f, { maxDepth: 80, budget: 300000 });
        var good = r.ok && K.accepts(r.term, f, r.ctx);
        if (valid) {
          totals.taut++;
          if (good) { totals.proved++; totals.sound++; if (!r.classical) totals.intuitionistic++; }
          else missed.push(K.str(f));
        } else if (good) admitted.push(K.str(f));
      }
      totals.formulas += formulas.length;
      a.eq(missed.length, 0, 'no tautology was missed' + (missed.length ? ': ' + missed.slice(0, 4).join(' ; ') : ''));
      a.eq(admitted.length, 0, 'nothing false was admitted' + (admitted.length ? ': ' + admitted.slice(0, 4).join(' ; ') : ''));
    }
    a.eq(totals.proved, totals.taut, 'proved exactly the ' + totals.taut + ' tautologies among ' +
      totals.formulas + ' formulas (' + totals.intuitionistic + ' of them constructively)');
    a.ok(totals.taut > 3000, 'the sweep really is a sweep: ' + totals.taut + ' theorems');
  });

  U.test('search', 'hard negatives are refuted by search alone', function (a) {
    // no oracle short-cut here: the search itself must fail on these
    var lies = ['P | Q -> 0', 'P | (Q -> 0) -> 0', '(P -> Q) -> P',
      'P -> P & Q', '(P | Q) -> P', '(P -> Q) -> (Q -> P)', 'P & (P -> 0)'];
    for (var i = 0; i < lies.length; i++) {
      var f = P(lies[i]);
      a.eq(classicalValid(f), false, 'not a tautology: ' + lies[i]);
      a.eq(provable(f), false, 'search does not pretend to prove: ' + lies[i]);
    }
  });

  /* Three pillars of classical reasoning that intuitionistic logic refuses.
     They are tautologies, so search finds proofs — but only once it is allowed
     to appeal to double-negation elimination, and the term it produces then
     mentions the axiom `dn`, which the kernel has to be told about. */
  U.test('search', 'classical logic strictly stronger than intuitionistic', function (a) {
    var only = ['P | (P -> 0)', '((P -> 0) -> 0) -> P', '((P -> 0) -> P) -> P',
      '((P -> Q) -> P) -> P', '(P -> Q) -> ((P -> 0) | Q)'];
    for (var i = 0; i < only.length; i++) {
      var f = P(only[i]);
      a.eq(classicalValid(f), true, 'is a classical tautology: ' + only[i]);
      a.eq(proveIntuitionistic(f).ok, false, 'constructive search refuses: ' + only[i]);
      var r = prove(f);
      a.ok(r.ok && r.classical, 'classical search proves it: ' + only[i]);
      a.ok(K.accepts(r.term, f, r.ctx), 'kernel accepts, knowing about ' + Object.keys(r.ctx)[0] + ': ' + only[i]);
      a.ok(K.termStr(r.term).indexOf(Object.keys(r.ctx)[0]) >= 0, 'the proof mentions its axiom: ' + only[i]);
      a.ok(!K.accepts(r.term, f, {}), 'and is rejected if the axiom is withdrawn: ' + only[i]);
    }
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
