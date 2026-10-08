/* ==========================================================================
   THE BLIND PHYSICIST · scientist.js
   The experimenter. It keeps a notebook of observations, reads what the
   search currently believes, and chooses its next experiment where its best
   candidate laws disagree the most. Curiosity, made literal.
   ========================================================================== */
(function () {
  'use strict';
  var BP = globalThis.BP || (globalThis.BP = {});
  var E = BP.Expr;

  function Scientist(opt) {
    opt = opt || {};
    this.world = opt.world;
    this.rand = BP.GP.rng(opt.seed == null ? 99 : opt.seed);
    this.maxData = opt.maxData || 900;
    this.explore = opt.explore == null ? 0.12 : opt.explore;   // share of purely random probes
    this.X = [];          // observed inputs, one array per sample
    this.Y = [];          // observed (noisy) accelerations / periods
    this.probesDone = 0;
    this.probeStart = 0;  // index into X where the current probe's samples begin
    this.current = null;  // inputs of the probe in progress
    this.choice = null;   // why the last probe was chosen
    this.version = 0;
    this.tolFactor = opt.tolFactor == null ? 1.0 : opt.tolFactor;   // how far above the noise a law may sit
  }

  Scientist.prototype._randomPoint = function () {
    var dom = this.world.domain, p = [], k;
    for (k = 0; k < dom.length; k++) p.push(dom[k][0] + (dom[k][1] - dom[k][0]) * this.rand());
    return p;
  };

  // Reservoir-style bookkeeping: once full, new samples replace random old ones.
  Scientist.prototype.addSamples = function (samples) {
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (this.X.length < this.maxData) {
        this.X.push(s.x); this.Y.push(s.y);
      } else {
        var j = Math.floor(this.rand() * this.X.length);
        this.X[j] = s.x; this.Y[j] = s.y;
      }
    }
    if (samples.length) this.version++;
  };

  // Columns for the search engine: one Float64Array per input, plus targets.
  Scientist.prototype.columns = function () {
    var n = this.X.length, d = this.world.dim, cols = [], k, i;
    for (k = 0; k < d; k++) {
      var c = new Float64Array(n);
      for (i = 0; i < n; i++) c[i] = this.X[i][k];
      cols.push(c);
    }
    return { cols: cols, y: Float64Array.from(this.Y), norm: this.world.scale };
  };

  // Standard deviation of the measured targets (for noise bookkeeping).
  Scientist.prototype.stdY = function () {
    var n = this.Y.length;
    if (n < 2) return 1;
    var m = 0, v = 0, i;
    for (i = 0; i < n; i++) m += this.Y[i];
    m /= n;
    for (i = 0; i < n; i++) v += (this.Y[i] - m) * (this.Y[i] - m);
    return Math.sqrt(v / n) || 1;
  };

  // The relative error an honest law should show, given the instrument noise.
  // Errors are measured against the world's typical size, the same scale the
  // noise is set in, so this is simply the noise setting.
  Scientist.prototype.expectedNRMSE = function () {
    return this.world.noiseFrac;
  };

  // Choose where to experiment next. cands: [{tree}, ...] are the currently
  // best candidate laws. The point maximizes their disagreement.
  Scientist.prototype.nextProbe = function (cands) {
    var d = this.world.domain.length, M = 320, k, i, j;
    if (!cands || cands.length < 2 || this.rand() < this.explore) {
      var p = this._randomPoint();
      this.choice = { kind: 'random', point: p, spread: 0, count: cands ? cands.length : 0 };
      return p;
    }
    var cols = [], pts = [];
    for (k = 0; k < d; k++) cols.push(new Float64Array(M));
    for (i = 0; i < M; i++) {
      var q = this._randomPoint();
      pts.push(q);
      for (k = 0; k < d; k++) cols[k][i] = q[k];
    }
    var S = E.makeScratch(32, M);
    var preds = cands.map(function (c) {
      var prog = E.compile(c.tree);
      var th = Float64Array.from(E.getConsts(c.tree));
      return Float64Array.from(E.run(prog, th, cols, M, S));
    });
    var best = -1, bestSpread = -Infinity, sc = this.world.scale || 1, K = preds.length;
    for (i = 0; i < M; i++) {
      var mean = 0;
      for (j = 0; j < K; j++) mean += preds[j][i];
      mean /= K;
      var v = 0;
      for (j = 0; j < K; j++) { var dd = preds[j][i] - mean; v += dd * dd; }
      var spread = Math.sqrt(v / K) / sc;
      if (isFinite(spread) && spread > bestSpread) { bestSpread = spread; best = i; }
    }
    if (best < 0 || !(bestSpread > 1e-9)) {
      var r = this._randomPoint();
      this.choice = { kind: 'random', point: r, spread: 0, count: K };
      return r;
    }
    this.choice = { kind: 'disagree', point: pts[best], spread: bestSpread, count: K };
    return pts[best];
  };

  // Start the next experiment.
  Scientist.prototype.begin = function (cands) {
    var p = this.nextProbe(cands);
    this.current = p;
    this.probeStart = this.X.length;
    this.world.beginProbe(p);
    return p;
  };

  // Advance the world by dt seconds of simulated time. Returns the samples it
  // produced and whether the probe has now finished.
  Scientist.prototype.advance = function (dt) {
    var samples = this.world.advance(dt);
    if (samples.length) this.addSamples(samples);
    var finished = this.world.done;
    if (finished) this.probesDone++;
    return { samples: samples, finished: finished, probe: this.current };
  };

  // From the Pareto front, pick the simplest law that is about as accurate as
  // the best one. Mark it found once its error is consistent with the noise.
  // A law that explains the data to within the instrument noise is as good as
  // the best fit, so among those the simplest wins (Occam, with error bars).
  Scientist.prototype.assess = function (pareto) {
    if (!pareto || !pareto.length) return null;
    var best = pareto[pareto.length - 1];
    var noise = this.expectedNRMSE();
    var tol = Math.max(best.nrmse * 1.3 + 1e-4, this.tolFactor * noise + 1e-4);
    var pick = null;
    for (var i = 0; i < pareto.length; i++) {
      if (pareto[i].nrmse <= tol) { pick = pareto[i]; break; }
    }
    var found = !!pick && this.probesDone >= 6 && pick.nrmse <= 1.5 * noise + 0.004;
    return { law: pick, best: best, noise: noise, found: found };
  };

  BP.Scientist = Scientist;
})();
