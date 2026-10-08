#!/usr/bin/env node
/* ==========================================================================
   THE BLIND PHYSICIST · verification
     node tests/verify.js             unit and physics checks (fast)
     node tests/verify.js discover    also rediscover every law from scratch
     node tests/verify.js discover pendulum   just one world
   Discovery is scored against the true law on the whole domain, not just on
   the noisy data the machine saw.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.BP = {};
for (const f of ['expr.js', 'gp.js', 'worlds.js', 'scientist.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f });
}
const E = BP.Expr;
const Worlds = BP.Worlds;
const TAU = 2 * Math.PI;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail !== undefined ? '   [' + detail + ']' : ''));
  if (!ok) failures++;
}

// ---- unit checks: the expression engine ----------------------------------
function unitTests() {
  console.log('expression engine');
  const names = ['x', 'v'];
  let t = E.parse('-3*x^3 + sin(v)', names);
  check('parses -3*x^3 + sin(v)', Math.abs(E.ev(t, [2, 0.5]) - (-24 + Math.sin(0.5))) < 1e-12);
  t = E.parse('2x²−v', names);
  check('superscripts and unicode minus', Math.abs(E.ev(t, [3, 1]) - 17) < 1e-12);
  t = E.parse('tan(v)', names);
  check('tan is sin/cos', Math.abs(E.ev(t, [0, 0.5]) - Math.tan(0.5)) < 1e-12);
  t = E.parse('2 x v', names);
  check('implicit products', Math.abs(E.ev(t, [1.5, 2]) - 6) < 1e-12);
  let threw = false;
  try { E.parse('x + q', names); } catch (e) { threw = true; }
  check('unknown names are rejected', threw);
  check('pretty printing', E.show(E.parse('-3*x^3 + sin(v)', names), names, true) === '−3·x^3 + sin(v)',
        E.show(E.parse('-3*x^3 + sin(v)', names), names, true));
  check('simplify removes identities', E.show(E.simplify(E.parse('x*1 + 0*v', names)), names, false) === 'x');
  check('simplify folds constants', E.show(E.simplify(E.parse('2*3 - x', names)), names, false) === '6 - x',
        E.show(E.simplify(E.parse('2*3 - x', names)), names, false));

  // compiled vectorized evaluation must agree with the scalar interpreter
  const rnd = BP.GP.rng(11);
  const gp = new BP.Discoverer({ names: names, seed: 3 });
  let maxDiff = 0, n = 200;
  const cols = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) { cols[0][i] = rnd() * 4 - 2; cols[1][i] = rnd() * 4 - 2; }
  for (let trial = 0; trial < 150; trial++) {
    const tree = gp._randTree(0, 5);
    const prog = E.compile(tree);
    const th = Float64Array.from(E.getConsts(tree));
    const S = E.makeScratch(prog.depth + 2, n);
    const out = E.run(prog, th, cols, n, S);
    for (let i = 0; i < n; i++) {
      const a = out[i], b = E.ev(tree, [cols[0][i], cols[1][i]]);
      if (isFinite(a) || isFinite(b)) maxDiff = Math.max(maxDiff, Math.abs(a - b) || 0);
    }
  }
  check('vectorized evaluation matches scalar on 150 random trees', maxDiff < 1e-9, 'max diff ' + maxDiff.toExponential(2));

  // the display rewrite must never change the law it prints
  let tidyWorst = 0;
  for (let trial = 0; trial < 300; trial++) {
    const tree = gp._randTree(0, 5);
    const pretty = E.tidy(tree);
    for (let i = 0; i < 20; i++) {
      const p = [rnd() * 4 - 2, rnd() * 4 - 2];
      const a = E.ev(tree, p), b = E.ev(pretty, p);
      // well-conditioned points only: protected division differs at exact singularities
      if (isFinite(a) && isFinite(b) && Math.abs(a) < 1e6) tidyWorst = Math.max(tidyWorst, Math.abs(a - b) / (1 + Math.abs(a)));
    }
  }
  // round-off can be amplified through cos() of huge arguments, hence 1e-6 rather than machine precision
  check('tidy() preserves every random law it prints (300 trees)', tidyWorst < 1e-6, 'worst relative change ' + tidyWorst.toExponential(2));
  const r = [1.7, 0.9];
  const pow = (t) => E.ev(E.tidy(E.parse(t, names)), r);
  check('tidy: (2.5/x)² reads as 6.25/x²', Math.abs(pow('(2.5/x)^2') - 6.25 / (1.7 * 1.7)) < 1e-12 && E.show(E.tidy(E.parse('(2.5/x)^2', names)), names, true) === '6.25/x²',
        E.show(E.tidy(E.parse('(2.5/x)^2', names)), names, true));
  const drag = E.parse('-9.8 - 0.225*v^3/abs(v)', names), dragT = E.tidy(drag);
  check('tidy: v³/|v| reads as v·|v|', E.show(dragT, names, true) === '−9.8 − 0.225·v·|v|' &&
        Math.abs(E.ev(dragT, [0.4, -2.3]) - E.ev(drag, [0.4, -2.3])) < 1e-12 && Math.abs(E.ev(dragT, [0.4, 1.9]) - E.ev(drag, [0.4, 1.9])) < 1e-12,
        E.show(dragT, names, true));
  const vr = E.tidy(E.parse('x*(-0.993 - abs(-2*v))', names));
  check('tidy: a variable distributes over a sum and |−2v| = 2|v|', E.show(vr, names, true) === '−0.993·x − 2·x·|v|',
        E.show(vr, names, true));
}

// ---- physics checks: the worlds really obey their laws -------------------
function physicsTests() {
  console.log('physics');
  // pendulum energy, no damping
  const p = Worlds.create('pendulum', 3);
  p.b = 0; p.noiseFrac = 0; p.duration = 1e9;
  p.beginProbe([2.5, 0]);
  const En = (s) => 0.5 * s[1] * s[1] + p.k * (1 - Math.cos(s[0]));
  const E0 = En(p.s);
  for (let i = 0; i < 20 * 240; i++) p.advance(1 / 240);
  check('pendulum conserves energy (RK4, 20 s)', Math.abs(En(p.s) - E0) / E0 < 1e-6,
        'drift ' + (Math.abs(En(p.s) - E0) / E0).toExponential(2));

  // orbit energy and angular momentum
  const o = Worlds.create('orbit', 5);
  o.noiseFrac = 0; o.duration = 1e9;
  o.beginProbe([1.0, 1.3]);
  const Eo = (s) => 0.5 * (s[2] * s[2] + s[3] * s[3]) - o.mu / Math.sqrt(s[0] * s[0] + s[1] * s[1]);
  const Lo = (s) => s[0] * s[3] - s[1] * s[2];
  const E0o = Eo(o.s), L0o = Lo(o.s);
  for (let i = 0; i < 30 * 240; i++) o.advance(1 / 240);
  check('orbit conserves energy (30 s, RK4 truncation level)', Math.abs(Eo(o.s) - E0o) / Math.abs(E0o) < 1e-5,
        'drift ' + (Math.abs(Eo(o.s) - E0o) / Math.abs(E0o)).toExponential(2));
  check('orbit conserves angular momentum (30 s)', Math.abs(Lo(o.s) - L0o) / Math.abs(L0o) < 1e-5,
        'drift ' + (Math.abs(Lo(o.s) - L0o) / Math.abs(L0o)).toExponential(2));

  // Kepler's survey measures periods to high accuracy
  let worst = 0;
  for (const r of [0.6, 1.5, 3, 5]) {
    const k = Worlds.create('kepler', 9);
    k.mu = 4; k.noiseFrac = 0; k.computeScale();
    k.beginProbe([r]);
    let out = [];
    while (!k.done) out = out.concat(k.advance(1 / 60));
    const analytic = TAU * Math.pow(r, 1.5) / Math.sqrt(k.mu);
    const measured = out.length ? out[0].y : NaN;
    worst = Math.max(worst, Math.abs(measured - analytic) / analytic);
  }
  check('Kepler periods match 2π r^1.5 / √μ', worst < 1e-5, 'worst relative error ' + worst.toExponential(2));

  // each world's measured acceleration equals its target() at the same state
  let mism = 0;
  for (const id of ['pendulum', 'duffing', 'drag', 'custom']) {
    const w = Worlds.create(id, 21, id === 'custom' ? '-3*x^3 + 0.5*sin(v)' : undefined);
    for (let i = 0; i < 50; i++) {
      const s = [w.domain[0][0] + (w.domain[0][1] - w.domain[0][0]) * (i / 50),
                 w.dim > 1 ? w.domain[1][0] + (w.domain[1][1] - w.domain[1][0]) * ((i * 7 % 50) / 50) : 0];
      const st = w.dim === 1 ? [0, s[0]] : [s[0], s[1]];
      const acc = w.deriv(st)[1];
      const tgt = w.target(w.inputsOf(st));
      if (Math.abs(acc - tgt) > 1e-12) mism++;
    }
  }
  const o2 = Worlds.create('orbit', 2);
  for (let i = 0; i < 40; i++) {
    const st = [1 + i * 0.05, 0.3, 0.2, 0.9];
    const d = o2.deriv(st);
    const amag = Math.hypot(d[2], d[3]);
    if (Math.abs(amag - o2.target(o2.inputsOf(st))) > 1e-12) mism++;
  }
  check('measured acceleration equals the law everywhere sampled', mism === 0, 'mismatches ' + mism);
}

// ---- discovery trials ----------------------------------------------------
// Noiseless truth on the domain: how wrong is a candidate law, really?
function trueNRMSE(world, tree) {
  const rnd = BP.GP.rng(4242), D = world.domain, N = 500;
  const ys = [], yh = [];
  for (let i = 0; i < N; i++) {
    const p = D.map((d) => d[0] + (d[1] - d[0]) * rnd());
    const y = world.target(p);
    const h = E.ev(tree, p);
    if (isFinite(y) && isFinite(h)) { ys.push(y); yh.push(h); }
  }
  if (ys.length < 10) return Infinity;
  let m = 0, v = 0, mse = 0;
  for (const y of ys) m += y;
  m /= ys.length;
  for (let i = 0; i < ys.length; i++) { v += (ys[i] - m) ** 2; mse += (yh[i] - ys[i]) ** 2; }
  return Math.sqrt(mse / Math.max(v, 1e-30));
}

function trial(id, seed, opts) {
  const world = Worlds.create(id, seed, opts.formula);
  world.noiseFrac = opts.noise;
  const sci = new BP.Scientist({ world: world, seed: seed * 7 + 1 });
  const disc = new BP.Discoverer({ names: world.inputNames, seed: seed * 13 + 5, maxSize: opts.maxSize || 25 });
  let cands = null, found = null, probeStartTime = 0;
  const t0 = Date.now();
  let cumulativeEvolve = 0;
  for (let p = 0; p < opts.probes; p++) {
    sci.begin(cands);
    let fin = false;
    while (!fin) fin = sci.advance(1 / 60).finished;
    const c = sci.columns();
    disc.setData(c.cols, c.y, c.norm);
    const te = Date.now();
    disc.evolve(opts.evolveMs);
    cumulativeEvolve += Date.now() - te;
    const par = disc.pareto();
    const bestNr = par.length ? par[par.length - 1].nrmse : Infinity;
    cands = par.filter((q) => q.nrmse <= 3 * bestNr + 1e-3).slice(-6);
    const a = sci.assess(par);
    if (a && a.found && found === null) found = { probe: p + 1, evolveSec: cumulativeEvolve / 1000 };
  }
  const par = disc.pareto();
  const a = sci.assess(par);
  const law = a && a.law;
  return {
    id, seed,
    found,
    law: law ? law.expr : '(none)',
    size: law ? law.size : 0,
    trueErr: law ? trueNRMSE(world, law.tree) : Infinity,
    truth: world.truthText,
    wall: (Date.now() - t0) / 1000,
    evals: disc.evals,
    gens: disc.gen,
    samples: sci.X.length
  };
}

function discoveryTests(only) {
  console.log('discovery (noise 1% of typical size, scored on the whole domain)');
  const suite = [
    { id: 'pendulum', probes: 14, evolveMs: 400 },
    { id: 'duffing', probes: 14, evolveMs: 400 },
    { id: 'orbit', probes: 14, evolveMs: 400 },
    { id: 'drag', probes: 14, evolveMs: 400 },
    { id: 'kepler', probes: 24, evolveMs: 300 },
    { id: 'custom', probes: 14, evolveMs: 400, formula: '-3*x^3 + 0.5*sin(v)' }
  ];
  const seeds = [1, 2, 3];
  const summary = [];
  for (const s of suite) {
    if (only && only !== s.id) continue;
    for (const seed of seeds) {
      const r = trial(s.id, seed, { noise: 0.01, probes: s.probes, evolveMs: s.evolveMs, formula: s.formula, maxSize: 25 });
      const ok = r.trueErr < 0.03;
      console.log('  ' + (ok ? 'ok    ' : 'MISS  ') + s.id.padEnd(9) + ' seed ' + seed +
        '  found@' + (r.found ? 'probe ' + r.found.probe + ' (' + r.found.evolveSec.toFixed(1) + 's search)' : 'never').padEnd(30) +
        ' true error ' + (isFinite(r.trueErr) ? (100 * r.trueErr).toFixed(2) + '%' : 'n/a').padEnd(8) +
        ' size ' + String(r.size).padEnd(3) + ' ' + r.law);
      console.log('          truth: ' + r.truth + '    evals ' + r.evals + ', generations ' + r.gens + ', wall ' + r.wall.toFixed(1) + 's');
      summary.push(ok);
    }
  }
  if (summary.length) {
    const good = summary.filter(Boolean).length;
    console.log('  rediscovered ' + good + ' of ' + summary.length + ' trials to within 3% of truth');
  }
}

const args = process.argv.slice(2);
unitTests();
physicsTests();
if (args[0] === 'discover') discoveryTests(args[1]);
console.log(failures === 0 ? '\nall checks passed' : '\n' + failures + ' check(s) failed');
process.exitCode = failures ? 1 : 0;
