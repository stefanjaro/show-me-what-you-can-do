'use strict';
/* CONTINUUM CA-7 - verification suite.
 *
 * Every preset circuit is run headless and checked in two ways:
 *   1. against an independent RK4 integration of the exact equations
 *      the panel claims to implement, and
 *   2. against physical invariants (conserved quantities, equilibria,
 *      periods, attractor statistics).
 *
 * Run with:  node test/run.js
 */
var path = require('path');
var base = path.join(__dirname, '..', 'js');
require(path.join(base, 'core.js'));
require(path.join(base, 'modules.js'));
require(path.join(base, 'engine.js'));
require(path.join(base, 'presets.js'));
var CA7 = globalThis.CA7;

var pass = 0, fail = 0, notes = [];
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL  ' + msg); }
}
function near(a, b, tol, msg) {
  ok(Math.abs(a - b) <= tol, msg + '  (got ' + a + ', want ' + b + ' +/- ' + tol + ')');
}
function note(s) { notes.push('  ' + s); }

/* ---------------- harness ---------------- */

function watchKeys(c) {
  var k = [];
  c.modules.forEach(function (m) {
    var spec = CA7.TYPES[m.t];
    if (spec && spec.outputs && spec.outputs.length) k.push(m.id + ':' + spec.outputs[0]);
  });
  return k;
}

function make(id, mutate) {
  var p = CA7.PRESET_BY_ID[id];
  var c = CA7.clone(p.circuit);
  CA7.ensureUnits(c);
  if (mutate) mutate(c);
  return new CA7.Simulation(c, { shadow: c.shadow, watch: watchKeys(c) });
}

/* advance the machine in 50 ms slabs and keep a reference solution
   locked to exactly the same clock */
function lockstep(s, f, y0, keys, seconds, mapOut, onSample) {
  var y = y0.slice(), tRef = 0;
  var sub = 1 / 8000;
  function refIntegrate(from, span) {
    var t = from, left = span;
    while (left > 1e-12) {
      var h = Math.min(sub, left);
      var k1 = f(t, y);
      var y2 = y.map(function (v, i) { return v + h / 2 * k1[i]; });
      var k2 = f(t + h / 2, y2);
      var y3 = y.map(function (v, i) { return v + h / 2 * k2[i]; });
      var k3 = f(t + h / 2, y3);
      var y4 = y.map(function (v, i) { return v + h * k3[i]; });
      var k4 = f(t + h, y4);
      for (var i = 0; i < y.length; i++) {
        y[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      }
      t += h; left -= h;
    }
  }
  var chunk = 0.05, worst = 0;
  var done = 0;
  while (done < seconds) {
    var step = Math.min(chunk, seconds - done);
    s.advance(step / s.speed);
    done += step;
    refIntegrate(tRef, s.t - tRef);
    tRef = s.t;
    for (var i = 0; i < keys.length; i++) {
      var want = mapOut ? mapOut(i, y, s) : y[i];
      var got = s.value(keys[i]);
      var e = Math.abs(got - want);
      if (e > worst) worst = e;
    }
    if (onSample) onSample(s.t, y, s);
  }
  return worst;
}

function audit(s, label, seconds) {
  var nan = [], clip = [], peak = 0, peakId = '';
  var done = 0;
  function sample() {
    for (var id in s.main.mods) {
      var m = s.main.mods[id];
      if (!isFinite(m.out)) { nan.push(id + '=' + m.out); continue; }
      if (m.type === 'comp' || m.type === 'const' || m.type === 'ref') continue;
      var a = Math.abs(m.out);
      if (a > peak) { peak = a; peakId = id; }
      if (m.sat && clip.indexOf(id) < 0) clip.push(id);
    }
  }
  while (done < seconds) {
    var st = Math.min(0.05, seconds - done);
    s.advance(st / s.speed);
    done += st;
    sample();
  }
  ok(nan.length === 0, label + ': no NaN (' + nan.join(',') + ')');
  ok(clip.length === 0, label + ': no rail saturation (' + clip.join(',') + ')');
  note(label + ': peak |V| = ' + peak.toFixed(2) + ' (' + peakId + ')');
}

function runFor(s, seconds) {
  var done = 0;
  while (done < seconds) {
    var st = Math.min(0.2 / s.speed, seconds - done);
    s.advance(st);
    done += st;
  }
}

function crossings(s, key, seconds) {
  var times = [], prev = null, t0 = s.t, done = 0;
  while (done < seconds) {
    s.advance(0.01 / s.speed);
    done += 0.01;
    var v = s.value(key);
    if (prev !== null && prev < 0 && v >= 0) times.push(s.t - t0);
    prev = v;
  }
  return times;
}
function period(times) {
  return times.length > 3 ? (times[times.length - 1] - times[0]) / (times.length - 1) : NaN;
}

/* ================= 1. every circuit runs clean ================= */
console.log('\n== circuits ==');
['spring', 'pendulum', 'vanderpol', 'predator', 'fishery', 'sir',
  'lorenz', 'rossler', 'driven', 'relaxation'].forEach(function (id) {
    var s = make(id);
    audit(s, id, id === 'sir' ? 60 : 45);
  });

/* ================= 2. vs an independent RK4 solution ================= */
console.log('\n== vs reference ODE ==');

function compare(label, id, f, y0, keys, seconds, tol, mutate, mapOut, after) {
  var s = make(id, mutate);
  var err = lockstep(s, f, y0, keys, seconds, mapOut, after);
  note(label + ': RK4 agreement ' + err.toExponential(2) + ' over ' + seconds + ' s (tol ' + tol + ')');
  ok(err < tol, label + ': matches reference RK4 (max error ' +
    err.toExponential(2) + ' < ' + tol + ')');
  return s;
}

compare('spring', 'spring',
  function (t, y) { return [y[1], -4 * y[0]]; },
  [4.5, 0], ['x:o', 'v:o'], 20, 1e-3);

compare('pendulum', 'pendulum',
  function (t, y) { return [y[1], -4 * Math.sin(y[0]) - 0.06 * y[1]]; },
  [3, 0], ['th:o', 'om:o'], 15, 1e-3);

compare('van der pol', 'vanderpol',
  function (t, y) {
    var x = y[0], v = y[1];
    return [v, 0.8 * (1 - (x / 3) * (x / 3)) * v - x];
  },
  [1.5, 0], ['x:o', 'v:o'], 20, 1e-3);

compare('predator / prey', 'predator',
  function (t, y) {
    var X = y[0], Y = y[1];
    return [4 * X - 2 * X * Y, 2 * X * Y - 4 * Y];
  },
  [1, 3], ['x:o', 'y:o'], 20, 1e-3);

compare('fishery', 'fishery',
  function (t, y) {
    var x = y[0];
    return [x - x * x / 10 - 0.5 * x];
  },
  [9], ['x:o'], 25, 3e-3);

compare('epidemic', 'sir',
  function (t, y) {
    var S = y[0], I = y[1];
    return [-0.01 * S * I, 0.03 * S * I - 0.12 * I];
  },
  [10, 0.3], ['s:o', 'i:o'], 25, 1e-3);

compare('lorenz', 'lorenz',
  function (t, y) {
    var X = y[0], Y = y[1], Z = y[2];
    return [10 * (Y - X), 28 * X - 6 * X * Z - Y,
      (16 / 6) * X * Y - (8 / 3) * Z];
  },
  [1, 1, 1], ['x:o', 'y:o', 'z:o'], 2, 6e-2);

compare('rossler', 'rossler',
  function (t, y) {
    var X = y[0], Y = y[1], Z = y[2];
    return [-Y - 2 * Z, X + 0.2 * Y, 0.05 + 2 * X * Z - 5.7 * Z];
  },
  [1, 1, 0.5], ['x:o', 'y:o', 'z:o'], 15, 5e-3);

compare('driven pendulum', 'driven',
  function (t, y) {
    var th = y[0], om = y[1];
    return [om, -Math.sin(th) - 0.2 * om + 2 * Math.sin(2 * Math.PI * 0.0954929658551372 * t)];
  },
  [0.1, 0], ['fn:o', 'om:o'], 12, 5e-3,
  null,
  function (i, y) { return i === 0 ? Math.sin(y[0]) : y[1]; });

/* ================= 3. physical invariants ================= */
console.log('\n== physics ==');

(function () {
  var s = make('spring'), e0 = null, worst = 0;
  lockstep(s, function (t, y) { return [y[1], -4 * y[0]]; }, [4.5, 0],
    ['x:o', 'v:o'], 30, null, function () {
      var x = s.value('x:o'), v = s.value('v:o');
      var E = 0.5 * (v * v + 4 * x * x);
      if (e0 === null) e0 = E;
      worst = Math.max(worst, Math.abs(E - e0) / e0);
    });
  note('spring: energy drift ' + (worst * 100).toFixed(4) + '% over 30 s');
  ok(worst < 0.005, 'spring: energy conserved (got ' + (worst * 100).toFixed(3) + '%)');

  var s2 = make('spring');
  near(period(crossings(s2, 'x:o', 30)), Math.PI, 0.02, 'spring: period = pi');

  var s3 = make('spring', function (c) {
    CA7.findById(c, 'd').k.k = 0.8;
  });
  runFor(s3, 25);
  ok(Math.abs(s3.value('x:o')) < 0.2, 'spring: friction collapses the swing (got ' +
    s3.value('x:o').toFixed(3) + ')');
})();

(function () {
  var s = make('pendulum', function (c) {
    CA7.findById(c, 'th').k.ic = 0.1;
  });
  near(period(crossings(s, 'th:o', 30)), Math.PI, 0.03,
    'pendulum: small-angle period = pi');

  var s2 = make('pendulum'), maxOm = 0, minTh = 99, done = 0;
  while (done < 12) {
    s2.advance(0.01);
    done += 0.01;
    maxOm = Math.max(maxOm, Math.abs(s2.value('om:o')));
    minTh = Math.min(minTh, Math.abs(s2.value('th:o')));
  }
  note('pendulum (IC=3 rad): max |omega| = ' + maxOm.toFixed(2) +
    ', closest approach to bottom = ' + minTh.toFixed(3) + ' rad');
  ok(maxOm > 3.2 && maxOm < 4.6,
    'pendulum: near-separatrix swing has omega ~ 4 (got ' + maxOm.toFixed(2) + ')');
  ok(minTh < 1, 'pendulum: passes through the bottom (got ' + minTh.toFixed(3) + ')');
  ok(Math.abs(s2.value('fn:o') - Math.sin(s2.value('th:o'))) < 1e-6,
    'pendulum: FUNCTION block = sin(theta) exactly');
})();

(function () {
  var s = make('vanderpol'), peak = 0, amps = [];
  var done = 0;
  while (done < 100) {
    s.advance(0.01);
    done += 0.01;
    peak = Math.max(peak, Math.abs(s.value('x:o')));
    if (Math.abs(s.value('v:o')) < 0.05 && peak > 1) { amps.push(peak); peak = 0; }
  }
  var late = amps.slice(-3);
  note('van der pol: limit-cycle amplitude ' +
    late.map(function (a) { return a.toFixed(2); }).join(' V, ') + ' V');
  ok(late.length >= 2, 'van der pol: completes several cycles');
  var spread = Math.max.apply(null, late) - Math.min.apply(null, late);
  ok(spread < 0.1, 'van der pol: the same loop every time (spread ' + spread.toFixed(3) + ' V)');
})();

(function () {
  var s = make('predator'), v0 = null, worst = 0, minX = 99, done = 0;
  while (done < 40) {
    s.advance(0.02);
    done += 0.02;
    var x = s.value('x:o') * 2, y = s.value('y:o') * 2;
    minX = Math.min(minX, x);
    var V = x - 4 * Math.log(x) + y - 4 * Math.log(y);
    if (v0 === null) v0 = V;
    worst = Math.max(worst, Math.abs(V - v0) / Math.abs(v0));
  }
  note('predator: conserved-quantity drift ' + (worst * 100).toFixed(4) + '% in 40 s');
  ok(worst < 0.005, 'predator: V conserved to <0.5% (got ' + (worst * 100).toFixed(3) + '%)');
  ok(minX > 0.2, 'predator: populations stay positive (min ' + minX.toFixed(2) + ')');
})();

(function () {
  var s = make('fishery');
  runFor(s, 45);
  near(s.value('x:o'), 5, 0.1, 'fishery: effort 0.5 -> K(1-e) = 5 V');

  var s0 = make('fishery', function (c) {
    CA7.findById(c, 'e').k.k = 0;
  });
  runFor(s0, 60);
  near(s0.value('x:o'), 10, 0.25, 'fishery: no effort -> carrying capacity');

  var s1 = make('fishery', function (c) {
    CA7.findById(c, 'e').k.k = 1;
  });
  runFor(s1, 60);
  var x = s1.value('x:o');
  note('fishery: effort 1.0 leaves ' + x.toFixed(3) + ' V');
  ok(x > 0 && x < 1.5, 'fishery: full effort empties the stock, never below zero (' +
    x.toFixed(3) + ')');
})();

(function () {
  var s = make('sir'), worst = 0, prevS = 99, maxI = 0, done = 0;
  while (done < 60) {
    s.advance(0.02);
    done += 0.02;
    var S = s.value('s:o'), I = s.value('i:o'), R = s.value('r:o');
    var err = Math.abs(S + I / 3 + R - 10);
    if (S > prevS + 1e-6) err = 99;
    worst = Math.max(worst, err);
    prevS = S;
    maxI = Math.max(maxI, I);
  }
  ok(worst < 0.02, 'epidemic: S + I + R = 10 V and S never rises (err ' +
    worst.toFixed(4) + ')');
  ok(maxI < 9.5, 'epidemic: peak infection fits the rails (' + maxI.toFixed(2) + ' V)');

  var s2 = make('sir');
  runFor(s2, 150);
  note('epidemic: after 150 days  S = ' + s2.value('s:o').toFixed(2) +
    ' V,  I = ' + s2.value('i:o').toFixed(4) + ' V');
  ok(s2.value('s:o') > 0.5 && s2.value('s:o') < 2.0,
    'epidemic: ~10% never infected (got ' + s2.value('s:o').toFixed(2) + ' V)');
  ok(s2.value('i:o') < 0.05, 'epidemic: outbreak burns out (got ' +
    s2.value('i:o').toFixed(3) + ' V)');
})();

/* ================= 4. chaos ================= */
console.log('\n== chaos ==');

(function () {
  var s = make('lorenz'), sum = 0, sum2 = 0, n = 0, done = 0, maxD = 0;
  while (done < 100) {
    s.advance(0.02);
    done += 0.02;
    var x = s.value('x:o');
    sum += x; sum2 += x * x; n++;
    if (done > 40) maxD = Math.max(maxD, Math.abs(x - s.shadow.value('x:o')));
  }
  var std = Math.sqrt(sum2 / n - (sum / n) * (sum / n));
  note('lorenz: std(X) = ' + std.toFixed(2) + ' V, twin separation peaks at ' +
    maxD.toFixed(2) + ' V (from 0.0004 V apart)');
  ok(std > 1.5, 'lorenz: wanders (std ' + std.toFixed(2) + ')');
  ok(maxD > 3, 'lorenz: the butterfly forgets where it started (' + maxD.toFixed(2) + ' V)');
})();

(function () {
  var s = make('rossler'), maxD = 0, done = 0;
  while (done < 250) {
    s.advance(0.02);
    done += 0.02;
    if (done > 120) maxD = Math.max(maxD, Math.abs(s.value('x:o') - s.shadow.value('x:o')));
  }
  note('rossler: twin separation peaks at ' + maxD.toFixed(2) + ' V (from 0.001 V apart)');
  ok(maxD > 0.5, 'rossler: quiet but real chaos (' + maxD.toFixed(2) + ' V)');
})();

(function () {
  var s = make('driven'), maxOm = 0, maxTh = 0, om = [], done = 0, maxD = 0;
  while (done < 90) {
    s.advance(0.02);
    done += 0.02;
    maxOm = Math.max(maxOm, Math.abs(s.value('om:o')));
    maxTh = Math.max(maxTh, Math.abs(s.value('th:o')));
    om.push(s.value('om:o'));
    if (done > 30) maxD = Math.max(maxD, Math.abs(s.value('om:o') - s.shadow.value('om:o')));
  }
  var mean = om.reduce(function (a, b) { return a + b; }, 0) / om.length;
  var sd = Math.sqrt(om.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / om.length);
  note('driven: max|omega| = ' + maxOm.toFixed(2) + ' V, sd(omega) = ' + sd.toFixed(2) +
    ' V, twin separation peaks at ' + maxD.toFixed(2) + ' V');
  ok(maxTh <= Math.PI + 0.01, 'driven: modulus integrator folds theta into +/-pi');
  ok(maxOm < 9.5, 'driven: omega stays inside the rails (' + maxOm.toFixed(2) + ')');
  ok(sd > 0.8, 'driven: not a repeating rhythm (sd ' + sd.toFixed(2) + ')');
  ok(maxD > 1, 'driven: shadow trajectory separates (' + maxD.toFixed(2) + ' V)');
})();

(function () {
  var s = make('relaxation');
  near(period(crossings(s, 'cmp:o', 30)), 4 * 6 / (10 * 2.4), 0.03,
    'relaxation: f = 10g/4h');
  var amp = 0, done = 0;
  while (done < 10) {
    s.advance(0.01);
    done += 0.01;
    amp = Math.max(amp, Math.abs(s.value('tri:o')));
  }
  near(amp, 6, 0.15, 'relaxation: triangle amplitude = hysteresis band');
})();

/* ================= 5. plumbing ================= */
console.log('\n== plumbing ==');

(function () {
  var c = CA7.clone(CA7.PRESET_BY_ID['lorenz'].circuit);
  var enc = CA7.encode(c);
  var dec = CA7.decode(enc);
  ok(!!dec, 'share link: encode/decode round trip');
  ok(dec && dec.modules.length === c.modules.length && dec.wires.length === c.wires.length,
    'share link: nothing lost');
  ok(CA7.decode('!!!not-base64!!!') === null, 'share link: garbage rejected');
  ok(!CA7.decode(CA7.encode({ modules: [{ id: 'a', t: 'evil' }], wires: [] })),
    'share link: unknown module type rejected');
  note('share link: lorenz circuit = ' + enc.length + ' characters');

  var s = make('spring'), t0 = Date.now();
  runFor(s, 10);
  var ms = Date.now() - t0;
  note('performance: 10 simulated seconds in ' + ms + ' ms (' +
    (ms / 10).toFixed(1) + ' ms per simulated second)');
  ok(ms < 500, 'performance: 10 simulated seconds in under 500 ms (got ' + ms + ' ms)');

  var s2 = make('vanderpol');
  s2.advance(12);
  var before = s2.main.mods.x.state;
  CA7.connect(s2.circuit, 'm1:o', 'v:c');
  s2.rebuild();
  ok(Math.abs(s2.main.mods.x.state - before) < 1e-9,
    'live edit: integrator state survives a patch change');
  runFor(s2, 0.5);
  ok(isFinite(s2.value('x:o')), 'live edit: still solving after the edit');
  note('live edit: state held at ' + before.toFixed(3) + ' V across a rebuild');

  var mg = CA7.clone(CA7.PRESET_BY_ID['lorenz'].circuit);
  CA7.ensureUnits(mg);
  ok(!!CA7.findModule(mg, 'xy') && !!CA7.findModule(mg, 'time') &&
    !!CA7.findModule(mg, 'meter') && !!CA7.findModule(mg, 'audio'),
    'units: every preset grows an instrument rack');
  ok(mg.wires.some(function (w) { return w[0] === 'x:o' && /:x$/.test(w[1]); }),
    'units: scope channels arrive as cords');
  ok(mg.wires.filter(function (w) { return /:a$/.test(w[1]) || /:b$/.test(w[1]) || /:c$/.test(w[1]); }).length >= 4,
    'units: time, meter and audio are patched too');
  ok(!mg.scope && !mg.audio && !mg.meter,
    'units: legacy description is replaced by real wiring');
  ok(CA7.findModule(mg, 'xy').k.gx === 1.5, 'units: display settings survive migration');

  var c2 = CA7.clone(CA7.PRESET_BY_ID['blank'].circuit);
  CA7.ensureUnits(c2);
  var n0 = c2.modules.length;
  var m = CA7.addModule(c2, 'integ', 10, 10);
  ok(!!m && c2.modules.length === n0 + 1, 'toolbox: add module');
  var m2 = CA7.addModule(c2, 'summer', 200, 10);
  ok(!!m2 && m2.id !== m.id, 'toolbox: ids stay unique');
  CA7.connect(c2, m.id + ':o', m2.id + ':a');
  ok(c2.wires.length === 1, 'toolbox: connect');
  CA7.connect(c2, m2.id + ':o', m.id + ':a');
  ok(c2.wires.length === 2, 'toolbox: feedback through an integrator is allowed');
  CA7.disconnect(c2, m.id + ':a');
  ok(c2.wires.length === 1, 'toolbox: unplug');
  CA7.connect(c2, m2.id + ':o', m.id + ':a');
  CA7.removeModule(c2, m.id);
  ok(!!CA7.findModule(c2, 'xy'), 'units: fixed instruments cannot be swept away');
  ok(c2.modules.length === n0 + 1 && c2.wires.length === 0,
    'toolbox: deleting a module sweeps its cords');

  var sim = new CA7.Simulation(c2, { watch: [] });
  runFor(sim, 1);
  ok(isFinite(sim.value(m2.id + ':o')), 'toolbox: an empty machine still runs');
})();

/* ---------------- report ---------------- */
notes.forEach(function (n) { console.log(n); });
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

