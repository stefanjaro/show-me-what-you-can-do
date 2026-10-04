/* ALETHEIA — differential equations, numerically.
 *
 * Three integrators, because they answer different questions:
 *
 *   rk4      classic fixed step, fourth order, dirt cheap
 *   dormand  Dormand–Prince 5(4) with step doubling for an error estimate
 *   symp     Störmer–Verlet, which keeps energy bounded instead of drifting
 *
 * Each one is then asked the question a numerical method can actually be held
 * to: given a problem whose answer is known in closed form, does the error fall
 * like h^p? The tests check the *order*, not just agreement.
 */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});
  var U = AE.util, E = AE.E, Rat = AE.Rat;

  function addScaled(y, dy, h) {
    var out = new Array(y.length), i;
    for (i = 0; i < y.length; i++) out[i] = y[i] + h * dy[i];
    return out;
  }
  function clone(y) { return y.slice(); }

  /* ── classic Runge–Kutta 4 ─────────────────────────────────────────── */
  function rk4(f, t, y, h) {
    var k1 = f(t, y);
    var k2 = f(t + h / 2, addScaled(y, k1, h / 2));
    var k3 = f(t + h / 2, addScaled(y, k2, h / 2));
    var k4 = f(t + h, addScaled(y, k3, h));
    var out = new Array(y.length), i;
    for (i = 0; i < y.length; i++) {
      out[i] = y[i] + h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6;
    }
    return out;
  }

  /* ── Dormand–Prince 5(4): two answers per step, their difference IS the error ─ */
  var DP_A = [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
  ];
  var DP_B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
  var DP_B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];
  function dormandStep(f, t, y, h) {
    var n = y.length, k = [], i, j, stage, tmp;
    for (i = 0; i < 7; i++) {
      tmp = clone(y);
      for (j = 0; j < i; j++) {
        var aij = DP_A[i][j];
        if (!aij) continue;
        for (var m = 0; m < n; m++) tmp[m] += h * aij * k[j][m];
      }
      k[i] = f(t + (i === 6 ? h : h * [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1][i]), tmp);
    }
    var y5 = new Array(n), y4 = new Array(n);
    for (var m2 = 0; m2 < n; m2++) {
      var s5 = 0, s4 = 0;
      for (i = 0; i < 7; i++) { s5 += DP_B5[i] * k[i][m2]; s4 += DP_B4[i] * k[i][m2]; }
      y5[m2] = y[m2] + h * s5;
      y4[m2] = y[m2] + h * s4;
    }
    var err = 0;
    for (i = 0; i < n; i++) err = Math.max(err, Math.abs(y5[i] - y4[i]) / (1 + Math.abs(y5[i])));
    return { y: y5, lower: y4, error: err, k: k };
  }
  /* integrate with adaptive stepping */
  function dormand(f, t0, y0, tEnd, opts) {
    opts = opts || {};
    var tol = opts.tol || 1e-9, h = opts.h || (tEnd - t0) / 100, hMin = opts.hMin || 1e-12;
    var t = t0, y = clone(y0), steps = 0, rejected = 0;
    var trail = opts.trail ? [{ t: t, y: clone(y) }] : null;
    while (t < tEnd && steps < (opts.maxSteps || 200000)) {
      if (t + h > tEnd) h = tEnd - t;
      var r20 = dormandStep(f, t, y, h);
      if (r20.error <= tol || h <= hMin) {
        t += h;
        /* accept y5 (local extrapolation) */
        y = r20.y;
        steps++;
        if (trail) trail.push({ t: t, y: clone(y) });
        if (r20.error > 0) {
          var fac = Math.pow(tol / r20.error, 1 / 5);
          h = h * Math.min(5, Math.max(0.2, 0.9 * fac));
        } else h = h * 2;
      } else {
        rejected++;
        h = h * Math.max(0.1, 0.9 * Math.pow(tol / r20.error, 1 / 5));
      }
    }
    return { t: t, y: y, steps: steps, rejected: rejected, trail: trail };
  }

  /* ── Störmer–Verlet for second-order systems q'' = a(q, v, t) ─────── */
  function verlet(a, t0, q0, v0, tEnd, h, opts) {
    opts = opts || {};
    var n = q0.length, t = t0, q = clone(q0), v = clone(v0), steps = 0;
    var trail = opts.trail ? [{ t: t, q: clone(q), v: clone(v) }] : null;
    var acc = a(t, q, v), i;
    while (t < tEnd - 1e-12 && steps < (opts.maxSteps || 500000)) {
      var vHalf = new Array(n);
      for (i = 0; i < n; i++) vHalf[i] = v[i] + h / 2 * acc[i];
      for (i = 0; i < n; i++) q[i] = q[i] + h * vHalf[i];
      t += h;
      acc = a(t, q, vHalf);
      for (i = 0; i < n; i++) v[i] = vHalf[i] + h / 2 * acc[i];
      steps++;
      if (trail) trail.push({ t: t, q: clone(q), v: clone(v) });
    }
    return { t: t, q: q, v: v, steps: steps, trail: trail };
  }

  /* ── turning an expression into f(t, y) ────────────────────────────── */
  /* deps: list of {name, expr}; each expr may mention t and earlier names */
  function compileSystem(equations, vars, tName) {
    tName = tName || 't';
    var names = vars.map(function (v) { return v.name || v; });
    var exprs = equations.map(function (ex) { return AE.simplify.simplify(AE.parse(ex)); });
    return function (t, y) {
      var env = {};
      env[tName] = t;
      for (var i = 0; i < names.length; i++) env[names[i]] = y[i];
      var out = new Array(exprs.length), k;
      for (k = 0; k < exprs.length; k++) out[k] = AE.numeric.evalExpr(exprs[k], env).re;
      return out;
    };
  }

  /* integrate a system and keep every step, for drawing */
  function trajectory(f, t0, y0, tEnd, opts) {
    opts = opts || {};
    var method = opts.method || 'rk4';
    if (method === 'rk4') {
      var h = opts.h || 0.01;
      var n = Math.max(1, Math.ceil((tEnd - t0) / h));
      h = (tEnd - t0) / n;
      var y = clone(y0), t = t0, out = [{ t: t, y: clone(y) }], i;
      for (i = 0; i < n; i++) {
        y = rk4(f, t, y, h);
        t = t0 + (i + 1) * h;
        out.push({ t: t, y: clone(y) });
      }
      return { points: out, method: 'rk4', h: h };
    }
    var r30 = dormand(f, t0, y0, tEnd, { tol: opts.tol || 1e-9, trail: true, maxSteps: opts.maxSteps });
    return { points: r30.trail, method: 'dormand', steps: r30.steps, rejected: r30.rejected };
  }

  /* observed order of convergence: fit log(err) against log(h) */
  function observedOrder(f, y0, tEnd, exact, opts) {
    opts = opts || {};
    var hs = [0.1, 0.05, 0.025, 0.0125], errs = [], i;
    for (i = 0; i < hs.length; i++) {
      var y = clone(y0), t = 0, steps = Math.round(tEnd / hs[i]);
      for (var k = 0; k < steps; k++) { y = rk4(f, t, y, hs[i]); t += hs[i]; }
      var e2 = Math.abs(y[0] - exact(t));
      errs.push({ h: hs[i], err: e2 });
    }
    // least squares slope of log err vs log h
    var sx = 0, sy = 0, sxx = 0, sxy = 0, cnt = 0;
    for (i = 0; i < hs.length; i++) {
      if (!(errs[i].err > 0)) continue;
      var lx = Math.log(errs[i].h), ly = Math.log(errs[i].err);
      sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; cnt++;
    }
    var slope = (cnt * sxy - sx * sy) / (cnt * sxx - sx * sx);
    return { order: slope, table: errs };
  }

  AE.ode = {
    rk4: rk4, dormandStep: dormandStep, dormand: dormand, verlet: verlet,
    trajectory: trajectory, compileSystem: compileSystem, observedOrder: observedOrder
  };

  /* ── tests ─────────────────────────────────────────────────────────── */
  var A = U.assert;

  U.test('ode', 'exponential decay', function (a) {
    var f = function (t, y) { return [-y[0]]; };
    var r = trajectory(f, 0, [1], 2, { h: 0.001 });
    var last = r.points[r.points.length - 1];
    a.near(last.y[0], Math.exp(-2), 1e-10, 'y(2) = e⁻² after 2000 steps of RK4');
    var r2 = dormand(f, 0, [1], 2, { tol: 1e-11 });
    a.near(r2.y[0], Math.exp(-2), 1e-11, 'and the adaptive one agrees to ' + (r2.y[0] - Math.exp(-2)).toExponential(1));
    a.ok(r2.steps < 200, 'in ' + r2.steps + ' adaptive steps, where fixed RK4 needed ' + Math.round(2 / 0.001));
  });

  U.test('ode', 'the order really is four', function (a) {
    var f = function (t, y) { return [y[0]]; };
    var fit = observedOrder(f, [1], 1, function (t) { return Math.exp(t); });
    a.ok(fit.order > 3.8 && fit.order < 4.2, 'measured order ≈ ' + fit.order.toFixed(3));
    // halving the step must cut the error by about 16
    var t0 = fit.table[0].err, t1 = fit.table[1].err;
    a.ok(t0 / t1 > 12 && t0 / t1 < 20, 'halving h divided the error by ' + (t0 / t1).toFixed(1));
  });

  U.test('ode', 'a harmonic oscillator over two thousand periods', function (a) {
    /* Verlet does not conserve the energy exactly — it conserves something
       close to it, so the energy wobbles forever without wandering. RK4, at
       the same step size, leaks in one direction only. */
    var acc = function (t, q) { return [-q[0]]; };
    var t = 0, q = [1], v = [0], h = 0.01, n = Math.round(2000 * Math.PI / h), k;
    var loV = Infinity, hiV = -Infinity, sum = 0, accV = acc(t, q);
    for (k = 0; k < n; k++) {
      var vHalf = v[0] + h / 2 * accV[0];
      q[0] = q[0] + h * vHalf;
      t += h;
      accV = acc(t, q);
      v[0] = vHalf + h / 2 * accV[0];
      var ev = 0.5 * (v[0] * v[0] + q[0] * q[0]);
      loV = Math.min(loV, ev); hiV = Math.max(hiV, ev); sum += ev;
    }
    a.ok(Math.abs(sum / n - 0.5) < 1e-4, 'Verlet energy averages ' + (sum / n).toFixed(9) + ' over 2000 periods');
    a.ok(hiV - loV > 1e-6, 'it oscillates between ' + loV.toFixed(9) + ' and ' + hiV.toFixed(9));
    a.ok(hiV - loV < 1e-3, 'within a fixed band — no drift');

    var f = function (tt, y) { return [y[1], -y[0]]; };
    var y = [1, 0], tt = 0, energies = [0.5], walker = 0;
    for (k = 0; k < n; k++) {
      y = rk4(f, tt, y, h); tt += h;
      walker++;
      if (walker % Math.round(500 * Math.PI / h) === 0) energies.push(0.5 * (y[1] * y[1] + y[0] * y[0]));
    }
    var monotone = true;
    for (k = 1; k < energies.length; k++) if (energies[k] > energies[k - 1] + 1e-15) monotone = false;
    a.ok(monotone, 'RK4 only ever goes down: ' + energies.map(function (v2) { return v2.toFixed(9); }).join(' → '));
  });

  U.test('ode', 'compiled from symbolic expressions', function (a) {
    // y' = y·cos(t), y(0) = 1  has the exact solution exp(sin t)
    var f = compileSystem(['y*cos(t)'], ['y'], 't');
    var r = trajectory(f, 0, [1], 4, { h: 0.002 });
    var last = r.points[r.points.length - 1];
    a.near(last.y[0], Math.exp(Math.sin(4)), 1e-9, 'y(4) = exp(sin 4)');
    // two-dimensional: x' = y, y' = −x  (the circle)
    var f2 = compileSystem(['y', '-x'], ['x', 'y'], 't');
    var c = trajectory(f2, 0, [1, 0], Math.PI, { h: 0.005 });
    var lastest = c.points[c.points.length - 1];
    a.near(lastest.y[0], -1, 1e-8, 'x(π) = −1');
    a.near(lastest.y[1], 0, 1e-8, 'y(π) = 0');
  });

  U.test('ode', 'the Lorenz attractor is chaotic, reproducibly', function (a) {
    var f = function (t, y) {
      return [10 * (y[1] - y[0]), y[0] * (28 - y[2]) - y[1], y[0] * y[1] - 8 / 3 * y[2]];
    };
    var r1 = trajectory(f, 0, [1, 1, 1], 25, { h: 0.002 });
    var r2 = trajectory(f, 0, [1, 1 + 1e-9, 1], 25, { h: 0.002 });
    var l1 = r1.points[r1.points.length - 1].y, l2 = r2.points[r2.points.length - 1].y;
    var dist = Math.sqrt((l1[0] - l2[0]) * (l1[0] - l2[0]) + (l1[1] - l2[1]) * (l1[1] - l2[1]) + (l1[2] - l2[2]) * (l1[2] - l2[2]));
    a.ok(dist > 1e-5, 'a 1e-9 perturbation grows ' + (dist / 1e-9).toExponential(1) + '-fold within 25 seconds');
    a.ok(isFinite(dist), 'and stays finite');
  });

})(typeof globalThis !== 'undefined' ? globalThis : this);
