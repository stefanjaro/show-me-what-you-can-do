/* ALETHEIA — a library of theorems.
 *
 * Not a lookup table of answers: a list of *claims*, each of which the engine
 * has to settle itself. Every entry states what it expects — a constructive
 * proof, or a classical one, or neither — and the test suite refuses to let a
 * single entry be wrong about which it is.
 *
 * The point is the third column: the ones where classical logic and
 * constructive logic disagree, which are proofs of something even to somebody
 * who does not care about logic.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, K = AE.kernel, S = AE.search;

  /* status: 'constructive' | 'classical' | 'false' */
  var THEOREMS = [
    { name: 'identity', prop: 'P -> P', status: 'constructive', note: 'a proof is the function λx. x' },
    { name: 'constant', prop: 'P -> Q -> P', status: 'constructive', note: 'const: throw the second argument away' },
    { name: 'composition', prop: '(P -> Q) -> (Q -> R) -> P -> R', status: 'constructive', note: 'composition of functions' },
    { name: 'exchange', prop: 'P -> Q -> R -> Q -> P -> R', status: 'constructive', note: 'flip arguments' },
    { name: 'weakening left', prop: 'P & Q -> P', status: 'constructive', note: 'first projection' },
    { name: 'commutativity of ∧', prop: 'P & Q -> Q & P', status: 'constructive', note: 'swap a pair' },
    { name: 'associativity of ∧', prop: 'P & (Q & R) -> (P & Q) & R', status: 'constructive', note: 're-bracket a pair' },
    { name: 'currying', prop: '(P & Q -> R) -> P -> Q -> R', status: 'constructive', note: 'Schönfinkel' },
    { name: 'uncurrying', prop: '(P -> Q -> R) -> P & Q -> R', status: 'constructive', note: 'the inverse conversion' },
    { name: 'ex falso', prop: '0 -> P', status: 'constructive', note: 'from ⊥ anything follows — even constructively' },
    { name: 'introduction of ∨', prop: 'P -> P | Q', status: 'constructive', note: 'inl' },
    { name: 'elimination of ∨', prop: 'P | Q -> (P -> R) -> (Q -> R) -> R', status: 'constructive', note: 'proof by cases' },
    { name: 'truth is trivial', prop: 'P -> 1', status: 'constructive', note: '⊤ needs no witness' },
    { name: 'double negation introduction', prop: 'P -> ((P -> 0) -> 0)', status: 'constructive', note: 'not its converse' },

    { name: 'excluded middle', prop: 'P | (P -> 0)', status: 'classical', note: 'tertium non datur' },
    { name: 'double negation elimination', prop: '((P -> 0) -> 0) -> P', status: 'classical', note: 'the step that separates the two logics' },
    { name: 'Peirce’s law', prop: '((P -> Q) -> P) -> P', status: 'classical', note: 'formulated 1885; equivalent to excluded middle' },
    { name: 'contraposition', prop: '(P -> Q) -> ((Q -> 0) -> (P -> 0))', status: 'constructive', note: 'the easy direction is fine' },
    { name: 'reverse contraposition', prop: '((Q -> 0) -> (P -> 0)) -> P -> Q', status: 'classical', note: 'this direction is not constructive' },
    { name: 'De Morgan ∨', prop: '((P | Q) -> 0) -> (P -> 0) & (Q -> 0)', status: 'constructive', note: '¬(P∨Q) ⊃ ¬P ∧ ¬Q' },
    { name: 'De Morgan ∧ (constructive)', prop: '(P & Q -> 0) -> P -> (Q -> 0)', status: 'constructive', note: 'half of the other De Morgan law' },
    { name: 'De Morgan ∧ (classical)', prop: '((P & Q) -> 0) -> ((P -> 0) | (Q -> 0))', status: 'classical', note: 'needs excluded middle on ¬P' },
    { name: 'material implication', prop: '(P -> Q) -> ((P -> 0) | Q)', status: 'classical', note: 'implication as a disjunction' },
    { name: 'implication to disjunction reversed', prop: '((P -> 0) | Q) -> P -> Q', status: 'constructive', note: 'the other direction is fine' },
    { name: 'Meredith’s axiom', prop: '((((P -> Q) -> ((R -> 0) -> (S -> 0))) -> R) -> T) -> ((T -> P) -> (S -> P))',
      status: 'classical', note: 'one single axiom is enough for all of classical propositional logic' },

    { name: 'a ∧ b implies a is not refutable', prop: 'P & (P -> 0)', status: 'false', note: 'contradiction' },
    { name: 'affirming the consequent', prop: '(P -> Q) -> Q -> P', status: 'false', note: 'the classic fallacy' },
    { name: 'denying the antecedent', prop: '(P -> Q) -> (P -> 0) -> (Q -> 0)', status: 'false', note: 'another classic fallacy' }
  ];

  function settle(entry) {
    var prop = K.parse(entry.prop);
    var direct = S.proveIntuitionistic(prop);
    var full = S.prove(prop);
    return {
      entry: entry, prop: prop,
      intuitionistic: direct.ok,
      term: full.ok ? full.term : (direct.ok ? direct.term : null),
      ctx: full.ok ? full.ctx : {},
      provable: full.ok, classical: full.ok && full.classical,
      tautology: S.classicalValid(prop), nodes: full.nodes
    };
  }

  AE.library = {
    THEOREMS: THEOREMS, settle: settle,
    get: function (name) {
      for (var i = 0; i < THEOREMS.length; i++) if (THEOREMS[i].name === name) return THEOREMS[i];
      return null;
    },
    /* everything currently believed, with the engine's verdict next to it */
    table: function () {
      return THEOREMS.map(settle);
    }
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;

  U.test('library', 'every entry is what it says it is', function (a) {
    var rows = AE.library.table(), wrong = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], want = r.entry.status, got;
      if (r.intuitionistic) got = 'constructive';
      else if (r.provable) got = 'classical';
      else got = 'false';
      if (got !== want) wrong.push(r.entry.name + ': said ' + want + ', got ' + got);
      if (r.provable && !K.accepts(r.term, r.prop, r.ctx)) wrong.push(r.entry.name + ': the kernel would not accept the proof');
      if (r.provable !== !!r.tautology) wrong.push(r.entry.name + ': disagrees with its own truth table');
    }
    a.eq(wrong.length, 0, 'every claim checks out' + (wrong.length ? ': ' + wrong.slice(0, 4).join(' ; ') : ''));
    a.ok(rows.length > 20, 'the library has ' + rows.length + ' entries');
  });

  U.test('library', 'the classical entries really do need excluded middle', function (a) {
    var rows = AE.library.table(), checked = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].entry.status !== 'classical') continue;
      checked++;
      var r = rows[i];
      a.ok(r.intuitionistic === false, r.entry.name + ': constructive search genuinely fails');
      a.ok(r.classical === true, r.entry.name + ': classical search succeeds');
      a.ok(K.accepts(r.term, r.prop, r.ctx), r.entry.name + ': accepted with its axiom declared');
      a.ok(!K.accepts(r.term, r.prop, {}), r.entry.name + ': rejected when the axiom is withdrawn');
    }
    a.ok(checked >= 5, checked + ' entries separate the two logics');
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
