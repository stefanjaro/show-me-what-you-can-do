/* ==========================================================================
   THE BLIND PHYSICIST · gp.js
   Symbolic regression by genetic programming.

   - Subtree crossover and six mutation operators on expression trees.
   - Every constant is solved for by Levenberg–Marquardt, so the search only
     has to discover the *shape* of a law; the numbers are fitted exactly.
   - A Pareto hall of fame: the best law found at each complexity.
   - Parsimony pressure, duplicate removal and a steady stream of immigrants.
   ========================================================================== */
(function () {
  'use strict';
  var BP = globalThis.BP || (globalThis.BP = {});
  var E = BP.Expr;

  var UN_SET = ['sin', 'cos', 'exp', 'log', 'sqrt', 'abs', 'neg', 'sq', 'cube'];
  var BIN_SET = ['+', '-', '*', '/'];
  var POOL = [1, 2, 3, 4, 0.5, 0.25, 10, -1, -2, -3];
  var PARS = 0.08;   // score = log10(loss) + PARS * size   (lower is better)

  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  // mulberry32: small, fast, seedable PRNG so runs can be reproduced exactly
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Solve A x = b for a small dense system (Gaussian elimination, pivoting).
  function solve(A, b, c) {
    var M = Float64Array.from(A), x = Float64Array.from(b), i, j, k, r, p;
    for (i = 0; i < c; i++) {
      p = i;
      for (r = i + 1; r < c; r++) if (Math.abs(M[r * c + i]) > Math.abs(M[p * c + i])) p = r;
      if (!(Math.abs(M[p * c + i]) > 1e-300)) return null;
      if (p !== i) {
        for (k = 0; k < c; k++) { var t = M[i * c + k]; M[i * c + k] = M[p * c + k]; M[p * c + k] = t; }
        var tx = x[i]; x[i] = x[p]; x[p] = tx;
      }
      for (r = i + 1; r < c; r++) {
        var f = M[r * c + i] / M[i * c + i];
        if (f === 0) continue;
        for (k = i; k < c; k++) M[r * c + k] -= f * M[i * c + k];
        x[r] -= f * x[i];
      }
    }
    for (i = c - 1; i >= 0; i--) {
      var s = x[i];
      for (k = i + 1; k < c; k++) s -= M[i * c + k] * x[k];
      x[i] = s / M[i * c + i];
      if (!isFinite(x[i])) return null;
    }
    return x;
  }

  function Discoverer(opt) {
    opt = opt || {};
    this.names = opt.names || ['x', 'v'];
    this.nVars = this.names.length;
    this.maxSize = opt.maxSize || 25;
    this.maxDepth = opt.maxDepth || 8;
    this.popSize = opt.popSize || 200;
    this.fitProb = opt.fitProb == null ? 0.6 : opt.fitProb;
    this.fitIters = opt.fitIters || 10;
    this.immigrants = opt.immigrants == null ? 0.10 : opt.immigrants;
    this.pars = opt.pars == null ? PARS : opt.pars;
    this.rand = rng(opt.seed == null ? 12345 : opt.seed);
    this.maxFit = opt.maxFit || 300;          // samples used to search; the rest only score the front
    this.cols = null; this.y = null; this.n = 0;
    this.fullCols = null; this.fullY = null; this.fullN = 0; this.fullVar = 1;
    this.yvar = 1; this.sd = 1; this.S = null; this._tmp = null;
    this.pop = [];
    this.hof = new Array(this.maxSize + 1);
    this.bestLoss = Infinity;
    this.gen = 0;
    this.evals = 0;
  }

  // ---- random helpers -----------------------------------------------------
  Discoverer.prototype._int = function (n) { return Math.floor(this.rand() * n); };
  Discoverer.prototype._pick = function (arr) { return arr[this._int(arr.length)]; };
  Discoverer.prototype._gauss = function () {
    var u = this.rand() || 1e-12, v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  Discoverer.prototype._constant = function () {
    if (this.rand() < 0.5) return this._pick(POOL);
    var mag = Math.pow(10, -1.3 + 2.6 * this.rand());
    return (this.rand() < 0.5 ? -1 : 1) * mag;
  };
  Discoverer.prototype._leaf = function () {
    if (this.rand() < 0.6) return E.inp(this._int(this.nVars));
    return E.cst(this._constant());
  };
  Discoverer.prototype._randTree = function (d, maxd) {
    if (d >= maxd || (d > 0 && this.rand() < 0.3)) return this._leaf();
    if (this.rand() < 0.3) return E.un(this._pick(UN_SET), this._randTree(d + 1, maxd));
    return E.bin(this._pick(BIN_SET), this._randTree(d + 1, maxd), this._randTree(d + 1, maxd));
  };

  // ---- evaluation ---------------------------------------------------------
  // Residuals r_k = (f_k - y_k) / sd. Returns sum of squares (Infinity if the
  // program produces any non-finite value).
  Discoverer.prototype._residuals = function (prog, th, out) {
    var n = this.n, y = this.y, sd = this.sd;
    var o = E.run(prog, th, this.cols, n, this.S);
    var s = 0, k, d;
    for (k = 0; k < n; k++) {
      d = (o[k] - y[k]) / sd;
      out[k] = d;
      s += d * d;
    }
    return s < 1e300 ? s : Infinity;
  };

  // Levenberg–Marquardt on the constants of one individual (in place).
  Discoverer.prototype._fit = function (ind) {
    var c = ind.th.length, n = this.n;
    if (c === 0 || n === 0) return;
    var prog = ind.prog, th = Float64Array.from(ind.th);
    var r = new Float64Array(n), rt = new Float64Array(n), r2 = new Float64Array(n);
    var J = new Float64Array(n * c);
    var cur = this._residuals(prog, th, r);
    if (!isFinite(cur)) return;
    var lambda = 1e-3, it, j, k, i, tries, improved;
    for (it = 0; it < this.fitIters; it++) {
      // Jacobian by forward differences, one column per constant
      var bad = false;
      for (j = 0; j < c; j++) {
        var h = 1e-6 * (1 + Math.abs(th[j]));
        var keep = th[j];
        th[j] = keep + h;
        var sj = this._residuals(prog, th, rt);
        th[j] = keep;
        if (!isFinite(sj)) { bad = true; break; }
        for (k = 0; k < n; k++) J[k * c + j] = (rt[k] - r[k]) / h;
      }
      if (bad) break;
      // normal equations A = JᵀJ, g = Jᵀr
      var A = new Float64Array(c * c), g = new Float64Array(c);
      for (i = 0; i < c; i++) {
        var gi = 0;
        for (k = 0; k < n; k++) gi += J[k * c + i] * r[k];
        g[i] = gi;
        for (j = i; j < c; j++) {
          var aij = 0;
          for (k = 0; k < n; k++) aij += J[k * c + i] * J[k * c + j];
          A[i * c + j] = aij; A[j * c + i] = aij;
        }
      }
      improved = false;
      for (tries = 0; tries < 8 && !improved; tries++) {
        var M = Float64Array.from(A);
        for (i = 0; i < c; i++) M[i * c + i] += lambda * A[i * c + i] + 1e-12;
        var rhs = new Float64Array(c);
        for (i = 0; i < c; i++) rhs[i] = -g[i];
        var d = solve(M, rhs, c);
        if (!d) { lambda *= 10; continue; }
        var tn = new Float64Array(c);
        for (i = 0; i < c; i++) tn[i] = th[i] + d[i];
        var sn = this._residuals(prog, tn, r2);
        if (sn < cur) {
          var gain = (cur - sn) / (cur + 1e-300);
          th = tn; cur = sn;
          var swap = r; r = r2; r2 = swap;
          lambda = Math.max(lambda / 3, 1e-9);
          improved = true;
          if (gain < 1e-7) { it = this.fitIters; }   // converged: stop early
        } else {
          lambda *= 4;
        }
      }
      if (!improved) break;
    }
    ind.th = th;
    E.setConsts(ind.tree, th);
    ind.loss = cur / n;
  };

  // Wrap a tree into an individual: compile, evaluate, optionally refit
  // constants, and compute its canonical key for duplicate removal.
  Discoverer.prototype._newInd = function (tree, doFit) {
    var ind = {
      tree: tree,
      prog: E.compile(tree),
      th: Float64Array.from(E.getConsts(tree)),
      loss: Infinity,
      size: E.size(tree),
      key: ''
    };
    ind.loss = this._residuals(ind.prog, ind.th, this._tmp) / this.n;
    // refit constants on a random share of children, and always on promising ones
    if (ind.th.length && isFinite(ind.loss) && (doFit || ind.loss < 2 * this.bestLoss)) this._fit(ind);
    ind.key = E.show(ind.tree, this.names, false);
    this.evals++;
    return ind;
  };

  Discoverer.prototype._score = function (ind) {
    return Math.log10(ind.loss + 1e-15) + this.pars * ind.size;
  };

  Discoverer.prototype._offer = function (ind) {
    if (!isFinite(ind.loss) || ind.size > this.maxSize) return;
    var cur = this.hof[ind.size];
    if (!cur || ind.loss < cur.loss) this.hof[ind.size] = ind;
    if (ind.loss < this.bestLoss) this.bestLoss = ind.loss;
  };

  // ---- variation ----------------------------------------------------------
  Discoverer.prototype._tournament = function (pop) {
    var best = null, bs = Infinity;
    for (var i = 0; i < 3; i++) {
      var c = pop[this._int(pop.length)];
      var s = this._score(c);
      if (!best || s < bs) { bs = s; best = c; }
    }
    return best;
  };

  Discoverer.prototype._crossover = function (t1, t2) {
    var c1 = E.clone(t1);
    var a = E.collect(c1);
    var b = E.collect(t2);
    var donor = E.clone(b[this._int(b.length)]);
    E.setNode(a[this._int(a.length)], donor);
    return c1;
  };

  Discoverer.prototype._perturb = function (v) {
    var r = this.rand();
    if (r < 0.4) return v * Math.exp(0.6 * this._gauss());
    if (r < 0.7) return v + 0.5 * this._gauss();
    if (r < 0.8) return -v;
    return this._constant();
  };

  // Mutations act in place on a freshly cloned tree.
  Discoverer.prototype._mutate = function (tree) {
    var nodes = E.collect(tree);
    var node = nodes[this._int(nodes.length)];
    var r = this.rand(), old, leaf;
    if (r < 0.30) {                       // point mutation
      if (node.t === 'c') node.v = this._perturb(node.v);
      else if (node.t === 'x') { if (this.nVars > 1) node.i = (node.i + 1 + this._int(this.nVars - 1)) % this.nVars; }
      else if (node.t === 'u') node.op = this._pick(UN_SET);
      else node.op = this._pick(BIN_SET);
    } else if (r < 0.45) {                // regrow a subtree
      E.setNode(node, this._randTree(0, 3));
    } else if (r < 0.62) {                // wrap in a unary function
      old = E.clone(node);
      E.setNode(node, E.un(this._pick(UN_SET), old));
    } else if (r < 0.80) {                // combine with a small new term
      old = E.clone(node);
      leaf = this._randTree(0, 2);
      E.setNode(node, this.rand() < 0.5 ? E.bin(this._pick(BIN_SET), old, leaf)
                                        : E.bin(this._pick(BIN_SET), leaf, old));
    } else {                              // delete an operator, keep a child
      if (node.t === 'u') E.setNode(node, E.clone(node.a));
      else if (node.t === 'b') E.setNode(node, E.clone(this.rand() < 0.5 ? node.a : node.b));
    }
  };

  // ---- one generation -----------------------------------------------------
  Discoverer.prototype._init = function () {
    var kids = [], tries = 0;
    while (kids.length < this.popSize && tries < 40 * this.popSize) {
      tries++;
      var t = this._randTree(0, 1 + this._int(5));
      if (E.size(t) > this.maxSize) continue;
      var ind = this._newInd(t, true);
      if (isFinite(ind.loss)) kids.push(ind);
    }
    this.pop = kids;
    kids.forEach(this._offer, this);
  };

  Discoverer.prototype._step = function () {
    var pop = this.pop, N = this.popSize;
    var nImm = Math.round(N * this.immigrants);
    var kids = [], tries = 0;
    while (kids.length < N - nImm && tries < 30 * N) {
      tries++;
      var p1 = this._tournament(pop), tree;
      if (this.rand() < 0.5) {
        tree = this._crossover(p1.tree, this._tournament(pop).tree);
      } else {
        tree = E.clone(p1.tree);
        this._mutate(tree);
      }
      tree = E.simplify(tree);
      if (E.size(tree) > this.maxSize || E.depth(tree) > this.maxDepth) continue;
      kids.push(this._newInd(tree, this.rand() < this.fitProb));
    }
    tries = 0;
    while (kids.length < N && tries < 40 * N) {
      tries++;
      var t = this._randTree(0, 1 + this._int(5));
      if (E.size(t) > this.maxSize) continue;
      kids.push(this._newInd(t, true));
    }
    // (mu + lambda) survivor selection with duplicate removal
    var all = pop.concat(kids).filter(function (x) { return isFinite(x.loss); });
    var self = this;
    all.sort(function (a, b) { return self._score(a) - self._score(b); });
    var seen = Object.create(null), next = [];
    for (var i = 0; i < all.length && next.length < N; i++) {
      if (seen[all[i].key]) continue;
      seen[all[i].key] = true;
      next.push(all[i]);
    }
    this.pop = next;
    kids.forEach(this._offer, this);
    this.gen++;
  };

  // ---- public API ---------------------------------------------------------
  // cols: array of Float64Array (one per input, each of length n); y: Float64Array.
  // norm (optional): a fixed scale for the error, the world's typical size. With
  // it, a law's error is measured in the same units as the instrument noise.
  Discoverer.prototype.setData = function (cols, y, norm) {
    var N = y.length, k, i;
    this.fullCols = cols; this.fullY = y; this.fullN = N;
    // Search on a random subset when there is a lot of data (much faster);
    // the complete data set is used again when the front is scored.
    if (N > this.maxFit) {
      var perm = new Int32Array(N), idx = new Int32Array(this.maxFit);
      for (i = 0; i < N; i++) perm[i] = i;
      for (i = 0; i < this.maxFit; i++) {
        var j = i + this._int(N - i), t = perm[i];
        perm[i] = perm[j]; perm[j] = t; idx[i] = perm[i];
      }
      this.cols = cols.map(function (c) {
        var o = new Float64Array(idx.length);
        for (var q = 0; q < idx.length; q++) o[q] = c[idx[q]];
        return o;
      });
      this.y = new Float64Array(idx.length);
      for (k = 0; k < idx.length; k++) this.y[k] = y[idx[k]];
    } else {
      this.cols = cols; this.y = y;
    }
    var n = this.y.length, mean = 0, v = 0;
    this.n = n;
    for (k = 0; k < n; k++) mean += this.y[k];
    mean /= Math.max(1, n);
    for (k = 0; k < n; k++) { var d = this.y[k] - mean; v += d * d; }
    v /= Math.max(1, n);
    this.yvar = Math.max(v, 1e-24);
    this.sd = Math.sqrt(this.yvar);
    this._tmp = new Float64Array(n);
    this.S = E.makeScratch(32, n);
    // full-data variance, for honest error figures
    var fm = 0, fv = 0;
    for (k = 0; k < N; k++) fm += y[k];
    fm /= Math.max(1, N);
    for (k = 0; k < N; k++) { var e = y[k] - fm; fv += e * e; }
    this.fullVar = Math.max(fv / Math.max(1, N), 1e-24);
    if (norm > 0) {
      this.yvar = norm * norm; this.sd = norm; this.fullVar = norm * norm;
      this._tmp = new Float64Array(n);
    }
    if (n === 0) return;
    // Re-score everything on the new data; refit constants for the front and
    // the best of the population only (the rest are refitted as they come).
    var all = this.pop.slice();
    for (var c = 1; c <= this.maxSize; c++) {
      var h = this.hof[c];
      if (h && all.indexOf(h) < 0) all.push(h);
    }
    var self0 = this;
    all.forEach(function (ind) {
      ind.loss = self0._residuals(ind.prog, ind.th, self0._tmp) / n;
    });
    all.sort(function (a, b) { return self0._score(a) - self0._score(b); });
    all.forEach(function (ind, rank) {
      if (ind.th.length && isFinite(ind.loss) && (rank < 24 || this.hof.indexOf(ind) >= 0)) this._fit(ind);
      ind.key = E.show(ind.tree, this.names, false);
    }, this);
    this.hof = new Array(this.maxSize + 1);
    this.bestLoss = Infinity;
    all.forEach(this._offer, this);
    var self = this;
    all = all.filter(function (x) { return isFinite(x.loss); });
    all.sort(function (a, b) { return self._score(a) - self._score(b); });
    var seen = Object.create(null), next = [];
    for (var i = 0; i < all.length && next.length < this.popSize; i++) {
      if (seen[all[i].key]) continue;
      seen[all[i].key] = true;
      next.push(all[i]);
    }
    this.pop = next;
  };

  // Run generations for about `ms` milliseconds. Returns generations run.
  Discoverer.prototype.evolve = function (ms) {
    if (!this.n) return 0;
    var t0 = now(), g = 0;
    if (!this.pop.length) this._init();
    do { this._step(); g++; } while (now() - t0 < ms);
    return g;
  };

  // The Pareto front: strictly better laws at increasing complexity.
  // Normalized RMSE of one law on the complete data set.
  Discoverer.prototype._fullNRMSE = function (ind) {
    var N = this.fullN;
    if (!N) return Infinity;
    if (this.n === N) return Math.sqrt(ind.loss);
    if (!this._fullS || this._fullS[0].length !== N) this._fullS = E.makeScratch(32, N);
    var o = E.run(ind.prog, ind.th, this.fullCols, N, this._fullS), s = 0, k;
    for (k = 0; k < N; k++) { var d = o[k] - this.fullY[k]; s += d * d; }
    var mse = s / N;
    return isFinite(mse) ? Math.sqrt(mse / this.fullVar) : Infinity;
  };

  Discoverer.prototype.pareto = function () {
    var out = [], best = Infinity;
    for (var c = 1; c <= this.maxSize; c++) {
      var ind = this.hof[c];
      if (!ind) continue;
      var nr = this._fullNRMSE(ind);
      if (!(nr * nr < best)) continue;
      best = nr * nr;
      out.push({
        size: c,
        loss: best,
        nrmse: nr,
        expr: E.show(ind.tree, this.names, true),
        tree: ind.tree
      });
    }
    return out;
  };

  Discoverer.prototype.stats = function () {
    return { gen: this.gen, evals: this.evals, n: this.n, popSize: this.pop.length };
  };

  BP.Discoverer = Discoverer;
  BP.GP = { UN_SET: UN_SET, BIN_SET: BIN_SET, solve: solve, rng: rng };
})();
