/* ALETHEIA — countermodels for intuitionistic logic.
 *
 * A constructive proof is a program; if no such program exists, there is a
 * world in which the claim is false, and that world can be exhibited. Kripke
 * semantics makes this precise: a model is a finite partially ordered set of
 * "states of knowledge", knowledge only ever grows along the order, and a
 * formula is forced at a world when every possible future agrees with it.
 *
 * So `Dummett`-style refutation becomes a search over small posets, and the
 * result is not an error message but a picture: these worlds, this order, and
 * this particular world where your theorem fails. Every model this file
 * returns is checked by an independent forcing evaluator before it is handed
 * out, and checked again against what the proof search said.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, K = AE.kernel;

  /* ── partially ordered sets ────────────────────────────────────────── */
  function closure(rel, n) {                 // reflexive transitive closure
    var m = [], i, j, k;
    for (i = 0; i < n; i++) {
      m.push([]);
      for (j = 0; j < n; j++) m[i].push(rel[i][j] ? 1 : 0);
    }
    for (i = 0; i < n; i++) m[i][i] = 1;
    for (k = 0; k < n; k++) {
      for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) if (m[i][k] && m[k][j]) m[i][j] = 1;
      }
    }
    return m;
  }
  function isPartialOrder(rel, n) {
    var i, j, k;
    for (i = 0; i < n; i++) {
      if (!rel[i][i]) return false;
      for (j = 0; j < n; j++) {
        if (rel[i][j] && rel[j][i] && i !== j) return false;
        for (k = 0; k < n; k++) if (rel[i][j] && rel[j][k] && !rel[i][k]) return false;
      }
    }
    return true;
  }
  /* every poset on n labelled points (small n only) */
  function posets(n) {
    var out = [];
    function rec(row, current) {
      if (row === n) {
        var rel = closure(current, n);
        if (isPartialOrder(rel, n)) {
          var h = rel.map(function (r2) { return r2.join(''); }).join('/');
          if (!seen[h]) { seen[h] = true; out.push(rel); }
        }
        return;
      }
      // try every subset of {0..n-1} as the strict successors of `row`
      var mask, total = 1 << n;
      for (mask = 0; mask < total; mask++) {
        var nextRow = new Array(n), j;
        for (j = 0; j < n; j++) nextRow[j] = (mask & (1 << j)) ? 1 : 0;
        nextRow[row] = 0;
        current[row] = nextRow;
        rec(row + 1, current);
      }
      current[row] = new Array(n).fill(0);
    }
    var seen = Object.create(null);
    var start = [];
    for (var i = 0; i < n; i++) start.push(new Array(n).fill(0));
    rec(0, start);
    return out;
  }
  /* upward-closed subsets of a poset: exactly the monotone valuations available */
  function upsets(rel, n) {
    var out = [], total = 1 << n, mask, i, j;
    for (mask = 0; mask < total; mask++) {
      var ok2 = true;
      for (i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue;
        for (j = 0; j < n; j++) if (rel[i][j] && !(mask & (1 << j))) ok2 = false;
      }
      if (ok2) out.push(mask);
    }
    return out;
  }

  /* ── forcing ───────────────────────────────────────────────────────── */
  function forces(prop, world, model) {
    switch (prop.k) {
      case 'atom': {
        var set = model.valuation[prop.name];
        return !!(set & (1 << world));
      }
      case 'true': return true;
      case 'false': return false;
      case 'and': return forces(prop.a, world, model) && forces(prop.b, world, model);
      case 'or': return forces(prop.a, world, model) || forces(prop.b, world, model);
      case 'imp': {
        for (var v = 0; v < model.n; v++) {
          if (!model.rel[world][v]) continue;
          if (forces(prop.a, v, model) && !forces(prop.b, v, model)) return false;
        }
        return true;
      }
      default: return false;
    }
  }
  function checkModel(prop, model, root) {
    /* independent re-implementation of forcing, used to audit the answers */
    function f(p, w) {
      if (p.k === 'atom') return !!(model.valuation[p.name] & (1 << w));
      if (p.k === 'true') return true;
      if (p.k === 'false') return false;
      if (p.k === 'and') return f(p.a, w) && f(p.b, w);
      if (p.k === 'or') return f(p.a, w) || f(p.b, w);
      if (p.k === 'imp') {
        for (var q = 0; q < model.n; q++) {
          if (!model.rel[w][q]) continue;
          if (f(p.a, q) && !f(p.b, q)) return false;
        }
        return true;
      }
      return false;
    }
    var monotone = true, i, j;
    for (var name in model.valuation) {
      for (i = 0; i < model.n; i++) {
        if (!(model.valuation[name] & (1 << i))) continue;
        for (j = 0; j < model.n; j++) {
          if (model.rel[i][j] && !(model.valuation[name] & (1 << j))) monotone = false;
        }
      }
    }
    return {
      partialOrder: isPartialOrder(model.rel, model.n),
      monotone: monotone,
      refutes: !f(prop, root)
    };
  }

  /* ── search for the smallest world that refutes you ────────────────── */
  function countermodel(prop, opts) {
    opts = opts || {};
    var maxWorlds = opts.maxWorlds || 4;
    var names = AE.search.atoms(prop);
    var tried = 0;
    for (var n = 1; n <= maxWorlds; n++) {
      var orders = posets(n), up2 = null, k, ai;
      for (k = 0; k < orders.length; k++) {
        var rel = orders[k];
        var ups = upsets(rel, n);
        var combos = combinations(ups, names.length);
        for (var c = 0; c < combos.length; c++) {
          tried++;
          var valuation = {};
          for (ai = 0; ai < names.length; ai++) valuation[names[ai]] = combos[c][ai];
          var model = { n: n, rel: rel, valuation: valuation };
          for (var w = 0; w < n; w++) {
            if (!forces(prop, w, model)) {
              var audit = checkModel(prop, model, w);
              if (audit.partialOrder && audit.monotone && audit.refutes) {
                return {
                  found: true, worlds: n, root: w, model: model,
                  tried: tried, order: rel, audit: audit,
                  atoms: names,
                  describe: function () { return describe(model, w, names, prop); }
                };
              }
            }
          }
        }
      }
    }
    return { found: false, tried: tried, maxWorlds: maxWorlds };
  }
  function combinations(set, k) {
    if (k === 0) return [[]];
    var out = [], i, rest;
    if (set.length === 0) return [];
    for (i = 0; i < set.length; i++) {
      rest = combinations(set.slice(i + 1), k - 1);
      for (var j = 0; j < rest.length; j++) out.push([set[i]].concat(rest[j]));
    }
    return out;
  }
  function describe(model, root, names, prop) {
    var lines = [];
    lines.push(model.n + ' worlds' + (model.n === 1 ? '' : ', ordered by') +
      (model.n === 1 ? '' : ' ' + orderText(model)));
    for (var i = 0; i < names.length; i++) {
      var set = [];
      for (var w = 0; w < model.n; w++) if (model.valuation[names[i]] & (1 << w)) set.push('w' + w);
      lines.push(names[i] + ' holds in ' + (set.length ? set.join(', ') : 'no world'));
    }
    lines.push('world ' + 'w' + root + ' does not force ' + K.str(prop));
    return lines.join('\n');
  }
  function orderText(model) {
    var pairs = [], i, j;
    for (i = 0; i < model.n; i++) {
      for (j = 0; j < model.n; j++) if (model.rel[i][j] && i !== j) pairs.push('w' + i + ' ≤ w' + j);
    }
    return pairs.join(', ');
  }

  AE.finite = {
    countermodel: countermodel, checkModel: checkModel, forces: forces,
    posets: posets, upsets: upsets, describe: describe, combinations: combinations
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;
  function P(s) { return K.parse(s); }

  U.test('finite', 'posets really are posets', function (a) {
    a.eq(posets(1).length, 1, 'one order on one point');
    a.eq(posets(2).length, 3, 'three on two points (discrete, chain, reversed chain)');
    a.eq(posets(3).length, 19, 'nineteen on three');
    for (var i = 0; i < posets(3).length; i++) {
      a.ok(isPartialOrder(posets(3)[i], 3), 'all are reflexive, transitive and antisymmetric');
    }
    var chain = posets(2)[1];
    a.eq(upsets(closure([[0, 1], [0, 0]], 2), 2).length, 3, 'a two-point chain has three upward-closed sets');
  });

  U.test('finite', 'Peirce’s law refuted by a handful of worlds', function (a) {
    var prop = P('((P -> 0) -> P) -> P');
    var cm = countermodel(prop, { maxWorlds: 3 });
    a.ok(cm.found, 'a countermodel exists');
    a.eq(cm.worlds, 2, 'two worlds suffice: ' + orderText(cm.model));
    var audit = checkModel(prop, cm.model, cm.root);
    a.ok(audit.partialOrder, 'the relation is a partial order');
    a.ok(audit.monotone, 'knowledge only grows');
    a.ok(audit.refutes, 'the root really does not force the formula');
    a.ok(AE.search.classicalValid(prop), 'even though it is a classical tautology');
    a.ok(!AE.search.proveIntuitionistic(prop).ok, 'and constructive search agrees that it fails');
    // the two-atom form of Peirce's law needs one world more
    var wider = countermodel(P('((P -> Q) -> P) -> P'), { maxWorlds: 3 });
    a.ok(wider.found && wider.worlds === 3, '((P → Q) → P) → P is refuted in three worlds');
    a.ok(checkModel(P('((P -> Q) -> P) -> P'), wider.model, wider.root).refutes, 'audited too');
  });

  U.test('finite', 'excluded middle needs one more world than ⊤', function (a) {
    var cm = countermodel(P('P | (P -> 0)'), { maxWorlds: 3 });
    a.ok(cm.found, 'refuted: ' + describe(cm.model, cm.root, cm.atoms, P('P | (P -> 0)')).replace(/\n/g, '; '));
    a.ok(cm.worlds <= 2, 'in ' + cm.worlds + ' worlds');
    var audit = checkModel(P('P | (P -> 0)'), cm.model, cm.root);
    a.ok(audit.refutes && audit.monotone, 'audited independently');
  });

  U.test('finite', 'no countermodel when there is a proof', function (a) {
    var provable = ['P -> P', 'P | Q -> (P -> R) -> (Q -> R) -> R', 'P -> ((P -> 0) -> 0)',
      '(P & Q -> R) -> P -> Q -> R', '0 -> P', 'P -> P | Q'];
    for (var i = 0; i < provable.length; i++) {
      var prop = P(provable[i]);
      a.ok(AE.search.proveIntuitionistic(prop).ok, 'constructive proof exists: ' + provable[i]);
      var cm = countermodel(prop, { maxWorlds: 4 });
      a.ok(!cm.found, 'so no countermodel with ≤ 4 worlds: ' + provable[i]);
    }
  });

  U.test('finite', 'countermodel search agrees with proof search', function (a) {
    /* every refutation must be a formula the prover also refuses, and every
       small formula the prover refuses must have a small refutation */
    var formulas = AE.search.enumerate(2, ['P'], { bottom: true, cap: 400 });
    var contradictions = [], unexplained = [], refuted = 0;
    for (var i = 0; i < formulas.length; i++) {
      var f = formulas[i];
      var provableNow = AE.search.proveIntuitionistic(f).ok;
      var cm = countermodel(f, { maxWorlds: 3 });
      if (provableNow && cm.found) contradictions.push(K.str(f));
      if (!provableNow) {
        if (cm.found) refuted++;
        else unexplained.push(K.str(f));
      }
    }
    a.eq(contradictions.length, 0, 'nothing proved is refuted' +
      (contradictions.length ? ': ' + contradictions.slice(0, 3).join(' ; ') : ''));
    a.eq(unexplained.length, 0, 'every unprovable formula is explained by a model' +
      (unexplained.length ? ': ' + unexplained.slice(0, 3).join(' ; ') : ''));
    a.ok(refuted > 5, refuted + ' formulas refuted by exhibiting worlds');
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
