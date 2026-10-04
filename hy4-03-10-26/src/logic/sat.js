/* ALETHEIA — satisfiability, by the other road.
 *
 * The proof search in logic/search.js builds lambda terms. This file decides
 * the same question by a completely unrelated method: convert to conjunctive
 * normal form (Tseitin's encoding, which keeps the formula linear in size) and
 * run Davis–Putnam–Logemann–Loveland with unit propagation and pure literals.
 *
 * Nothing is believed: a returned model is checked against the original
 * formula by the evaluation in logic/search.js, and satisfiability is checked
 * against failure to prove the negation. Two algorithms that share nothing
 * agreeing on thousands of formulas is worth more than either one alone.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, K = AE.kernel;

  /* ── Tseitin: proposition → CNF, with fresh names for subformulas ───── */
  function tseitin(prop) {
    var clauses = [], counter = 0;
    function fresh() { return '_' + (++counter); }
    function top(p) {
      switch (p.k) {
        case 'atom': return { lit: p.name, extra: [] };
        case 'true': { var v1 = fresh(); return { lit: v1, extra: [[v1]] }; }
        case 'false': { var v2 = fresh(); return { lit: v2, extra: [[neg(v2)]] }; }
        case 'and': {
          var a1 = top(p.a), b1 = top(p.b), v3 = fresh();
          var ex = a1.extra.concat(b1.extra, [
            [neg(v3), a1.lit], [neg(v3), b1.lit], [v3, neg(a1.lit), neg(b1.lit)]
          ]);
          return { lit: v3, extra: ex };
        }
        case 'or': {
          var a2 = top(p.a), b2 = top(p.b), v4 = fresh();
          var ex2 = a2.extra.concat(b2.extra, [
            [v4, neg(a2.lit)], [v4, neg(b2.lit)], [neg(v4), a2.lit, b2.lit]
          ]);
          return { lit: v4, extra: ex2 };
        }
        case 'imp': {
          var a3 = top(p.a), b3 = top(p.b), v5 = fresh();
          var ex3 = a3.extra.concat(b3.extra, [
            [neg(v5), neg(a3.lit), b3.lit], [v5, a3.lit], [v5, neg(b3.lit)]
          ]);
          return { lit: v5, extra: ex3 };
        }
        default: throw new Error('tseitin: ' + p.k);
      }
    }
    function neg(x) { return x[0] === '-' ? x.slice(1) : '-' + x; }
    var r = top(prop);
    var all = r.extra.concat([[r.lit]]);
    // canonicalise duplicate variables introduced by constants
    return all;
  }
  function parseLit(lit) { return lit[0] === '-' ? { name: lit.slice(1), sign: false } : { name: lit, sign: true }; }

  /* ── DPLL ──────────────────────────────────────────────────────────── */
  function dpll(clauses, opts) {
    opts = opts || {};
    var assign = Object.create(null);
    var steps = { decisions: 0, propagations: 0, backtracks: 0, pure: 0 };
    var budget = opts.budget || 200000;

    function value(name) { return assign[name]; }
    function satisfied(clause) {
      for (var i = 0; i < clause.length; i++) {
        var v = value(parseLit(clause[i]).name);
        if (v !== undefined && v === (clause[i][0] !== '-')) return true;
      }
      return false;
    }
    function empty(clause) {
      for (var i = 0; i < clause.length; i++) {
        var n = parseLit(clause[i]);
        if (assign[n.name] === undefined) return false;
        if (assign[n.name] === (clause[i][0] !== '-')) return false;
      }
      return true;
    }
    function findUnit(state) {
      for (var i = 0; i < state.length; i++) {
        var cl = state[i], unassigned = [], sat = false, j;
        for (j = 0; j < cl.length; j++) {
          var l0 = parseLit(cl[j]);
          if (assign[l0.name] === undefined) unassigned.push(cl[j]);
          else if (assign[l0.name] === (cl[j][0] !== '-')) { sat = true; break; }
        }
        if (sat) continue;
        if (unassigned.length === 0) return { conflict: true };
        if (unassigned.length === 1) return { lit: unassigned[0] };
      }
      return null;
    }
    /* occurrences of each variable, for the pure-literal rule and heuristics */
    /* Only clauses that are still *live* count: counting occurrences inside a
       clause that is already satisfied would call literals "pure" that are not,
       and that would throw away real models. */
    function countOccurrences(state) {
      var pos = Object.create(null), negc = Object.create(null), i, j;
      for (i = 0; i < state.length; i++) {
        if (satisfied(state[i])) continue;
        for (j = 0; j < state[i].length; j++) {
          var l1 = parseLit(state[i][j]);
          if (assign[l1.name] !== undefined) continue;
          if (l1.sign) pos[l1.name] = (pos[l1.name] || 0) + 1;
          else negc[l1.name] = (negc[l1.name] || 0) + 1;
        }
      }
      return { pos: pos, neg: negc };
    }
    function pureAssign(state) {
      var counts = countOccurrences(state), names = Object.keys(counts.pos).concat(Object.keys(counts.neg)), i;
      for (i = 0; i < names.length; i++) {
        var n2 = names[i];
        if (assign[n2] !== undefined) continue;
        var p2 = counts.pos[n2] || 0, n3 = counts.neg[n2] || 0;
        if (p2 > 0 && n3 === 0) { assign[n2] = true; steps.pure++; return true; }
        if (n3 > 0 && p2 === 0) { assign[n2] = false; steps.pure++; return true; }
      }
      return false;
    }
    function choose(state) {
      var counts = countOccurrences(state), best = null, bestScore = -1, i;
      var names = Object.keys(counts.pos).concat(Object.keys(counts.neg));
      for (i = 0; i < names.length; i++) {
        var n4 = names[i];
        if (assign[n4] !== undefined) continue;
        var score = (counts.pos[n4] || 0) + (counts.neg[n4] || 0);
        if (score > bestScore) { bestScore = score; best = n4; }
      }
      return best;
    }
    function solve(state, depth) {
      if (steps.decisions + steps.propagations > budget) return false;
      var i;
      // unit propagation
      for (;;) {
        var u5 = findUnit(state);
        if (u5 === null) break;
        if (u5.conflict) return false;
        var n5 = parseLit(u5.lit);
        assign[n5.name] = (u5.lit[0] !== '-');
        steps.propagations++;
      }
      var live = [];
      for (i = 0; i < state.length; i++) if (!satisfied(state[i])) live.push(state[i]);
      var pruned = [];
      for (i = 0; i < live.length; i++) {
        var keep = [];
        for (var j2 = 0; j2 < live[i].length; j2++) if (assign[parseLit(live[i][j2]).name] === undefined) keep.push(live[i][j2]);
        pruned.push(keep);
      }
      if (pruned.length === 0) return true;
      for (i = 0; i < pruned.length; i++) if (pruned[i].length === 0) return false;
      if (pureAssign(pruned)) return solve(pruned, depth + 1);
      var v6 = choose(pruned);
      if (v6 === null) return false;
      steps.decisions++;
      var saveU = Object.create(null), anyU = false;
      for (var key in assign) { saveU[key] = assign[key]; anyU = true; }
      assign[v6] = true;
      if (solve(pruned, depth + 1)) return true;
      steps.backtracks++;
      var restored = Object.create(null);
      for (var k2 in saveU) restored[k2] = saveU[k2];
      assign = restored;
      assign[v6] = false;
      if (solve(pruned, depth + 1)) return true;
      steps.backtracks++;
      assign = Object.create(null);
      for (var k3 in saveU) assign[k3] = saveU[k3];
      return false;
    }
    var okZ = solve(clauses.slice(), 0);
    return { sat: okZ, model: okZ ? assign : null, steps: steps };
  }

  function sat(prop, opts) {
    var clauses = tseitin(prop);
    return dpll(clauses, opts);
  }
  /* check a purported model against the formula itself, not against the CNF */
  function checkModel(prop, model) {
    var names = AE.search.atoms(prop);
    function valueOf(name, fallback) {
      if (model[name] !== undefined) return model[name];
      return fallback === undefined ? false : fallback;
    }
    var assign = {};
    for (var i = 0; i < names.length; i++) assign[names[i]] = !!valueOf(names[i], false);
    return AE.search.evalProp(prop, assign);
  }

  AE.sat = {
    sat: sat, dpll: dpll, tseitin: tseitin, checkModel: checkModel,
    /* is this formula satisfiable, and is the witness real? */
    decide: function (prop, opts) {
      var r = sat(prop, opts);
      var checked = r.sat ? checkModel(prop, r.model) : null;
      return { sat: r.sat, model: r.model, steps: r.steps, verified: checked };
    }
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;
  function P(s) { return K.parse(s); }

  U.test('sat', 'satisfiable and not', function (a) {
    var r = AE.sat.decide(P('P & (P -> 0)'));
    a.eq(r.sat, false, 'P ∧ ¬P is unsatisfiable');
    r = AE.sat.decide(P('P & Q'));
    a.eq(r.sat, true, 'P ∧ Q is satisfiable');
    a.eq(r.model.P, true, 'with P true');
    a.eq(r.model.Q, true, 'and Q true');
    a.eq(r.verified, true, 'and the kernel’s own evaluator agrees');
    r = AE.sat.decide(P('(P -> Q) & P & (Q -> 0)'));
    a.eq(r.sat, false, 'modus ponens into a contradiction');
    // Tseitin introduces its own variables; the model only has to speak about ours
    r = AE.sat.decide(P('(P | (Q -> 0)) & ((P -> 0) | Q)'));
    a.ok(r.sat, 'this has models');
    a.ok(typeof r.model.P === 'boolean', 'and they assign the atoms we asked about');
  });

  U.test('sat', 'two decision procedures agree', function (a) {
    /* SAT(F) means ¬F is not a theorem — so the two independent answers must
       line up exactly, formula by formula. */
    var S = AE.search;
    var formulas = S.enumerate(3, ['P', 'Q', 'R'], { cap: 1200 });
    var mismatches = [], checked = 0, satCount = 0;
    for (var i = 0; i < formulas.length; i++) {
      var f = formulas[i];
      var r1 = AE.sat.decide(f);
      var refuted = S.prove(K.parse('(' + K.str(f) + ') -> 0'));
      var unsat = refuted.ok && K.accepts(refuted.term, K.parse('(' + K.str(f) + ') -> 0'), refuted.ctx);
      if (r1.sat === unsat) mismatches.push(K.str(f));
      if (r1.sat && r1.verified !== true) mismatches.push('model failed: ' + K.str(f));
      if (r1.sat) satCount++;
      checked++;
    }
    a.eq(mismatches.length, 0, 'no disagreement over ' + checked + ' formulas' +
      (mismatches.length ? ': ' + mismatches.slice(0, 3).join(' ; ') : ''));
    a.ok(satCount > 500, satCount + ' of them turned out satisfiable');
  });

  U.test('sat', 'pigeonholes', function (a) {
    /* three pigeons, two holes: unsatisfiable, and no amount of cleverness
       should be needed to see it */
    var clauses = [], i, j;
    for (i = 0; i < 3; i++) {
      var clause = [];
      for (j = 0; j < 2; j++) clause.push('p' + i + 'h' + j);
      clauses.push(clause);
    }
    for (j = 0; j < 2; j++) {
      for (i = 0; i < 3; i++) {
        for (var k = i + 1; k < 3; k++) clauses.push(['-p' + i + 'h' + j, '-p' + k + 'h' + j]);
      }
    }
    var r = dpll(clauses, {});
    a.eq(r.sat, false, 'PHP(3,2) is unsatisfiable');
    a.ok(r.steps.decisions < 60, 'in ' + r.steps.decisions + ' decisions');
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
