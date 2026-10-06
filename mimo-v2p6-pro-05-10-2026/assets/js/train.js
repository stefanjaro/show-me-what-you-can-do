(function (global) {
  'use strict';
  var SL = global.SL || (global.SL = {});

  var presets = {
    tiny: { dim: 48, heads: 3, layers: 2, block: 64, hidden: 192, label: 'tiny' },
    standard: { dim: 64, heads: 4, layers: 2, block: 64, hidden: 256, label: 'standard' },
    deep: { dim: 96, heads: 4, layers: 3, block: 64, hidden: 384, label: 'deep' }
  };

  function lrAt(step, opts) {
    var warm = opts.warmup;
    var max = opts.decaySteps;
    if (step < warm) return opts.lrMax * (step + 1) / warm;
    var p = (step - warm) / Math.max(1, max - warm);
    if (p > 1) p = 1;
    return opts.lrMin + (opts.lrMax - opts.lrMin) * 0.5 * (1 + Math.cos(Math.PI * p));
  }

  function drawBatch(tokens, block, batch, rng) {
    var T = block;
    var idx = new Int32Array(batch * T);
    var tg = new Int32Array(batch * T);
    var span = tokens.length - T - 1;
    for (var b = 0; b < batch; b++) {
      var off = Math.floor(rng() * span);
      for (var t = 0; t < T; t++) {
        idx[b * T + t] = tokens[off + t];
        tg[b * T + t] = tokens[off + t + 1];
      }
    }
    return { idx: idx, tg: tg };
  }

  function Trainer(opts) {
    this.model = opts.model;
    this.tokens = opts.tokens;
    this.batch = opts.batch || 16;
    this.block = opts.block || 64;
    this.microbatch = opts.microbatch || 4;
    this.accum = opts.accum || 1;
    this.lrMax = opts.lrMax || 2e-3;
    this.lrMin = opts.lrMin !== undefined ? opts.lrMin : 2e-4;
    this.warmup = opts.warmup || 40;
    this.decaySteps = opts.decaySteps || 3000;
    this.weightDecay = opts.weightDecay || 0;
    this.clip = opts.clip || 1;
    this.seed = opts.seed || 2026;
    this.onStep = opts.onStep || function () {};
    this.onSnapshot = opts.onSnapshot || function () {};
    this.snapshotEvery = opts.snapshotEvery || 150;
    this.step = 0;
    this.running = false;
    this.loss = 0;
    this.lossEma = 0;
    this.valLoss = 0;
    this.tokensPerSec = 0;
    this._rng = SL.rng.mulberry32(this.seed);
    this._valRng = SL.rng.mulberry32(99);
    this._valIdx = null;
    this._valTg = null;
    this._buildVal();
    this._pending = false;
    this._workers = [];
    this._workerReady = 0;
    this._gradBufs = null;
    this._lastTimes = [];
    this._serial = true;
    this._adam = new SL.Adam(this.model);
    this._initWorkers();
  }

  Trainer.prototype._buildVal = function () {
    var T = this.block;
    var n = Math.min(8, Math.max(3, Math.floor(this.tokens.length / (T * 4))));
    var idx = new Int32Array(n * T);
    var tg = new Int32Array(n * T);
    for (var b = 0; b < n; b++) {
      var off = Math.floor(this._valRng() * (this.tokens.length - T - 1));
      for (var t = 0; t < T; t++) {
        idx[b * T + t] = this.tokens[off + t];
        tg[b * T + t] = this.tokens[off + t + 1];
      }
    }
    this._valIdx = idx;
    this._valTg = tg;
  };

  Trainer.prototype._initWorkers = function () {
    var self = this;
    if (typeof Worker === 'undefined') return;
    if (typeof location !== 'undefined' && location.protocol === 'file:') return;
    var count = 2;
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
      count = Math.max(1, Math.min(3, navigator.hardwareConcurrency - 1));
    }
    var base = this._workerBase();
    for (var i = 0; i < count; i++) {
      var w;
      try {
        w = new Worker(base + 'train-worker.js');
      } catch (e) {
        return;
      }
      w.onmessage = function (ev) { self._onWorkerMessage(ev); };
      w.onerror = function () {
        for (var k = 0; k < self._workers.length; k++) self._workers[k].terminate();
        self._workers = [];
        self._serial = true;
      };
      this._workers.push(w);
    }
    if (this._workers.length === 0) return;
    var payload = {
      type: 'init',
      config: {
        vocab: this.model.vocab,
        dim: this.model.dim,
        heads: this.model.heads,
        layers: this.model.layers,
        block: this.model.block,
        hidden: this.model.hidden
      },
      tokens: this.tokens,
      microbatch: this.microbatch,
      accum: this.accum
    };
    for (var j = 0; j < this._workers.length; j++) {
      this._workers[j].postMessage(payload);
    }
    this._serial = false;
    this.broadcastWeights();
  };

  Trainer.prototype._workerBase = function () {
    if (typeof document === 'undefined') return '';
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      if (src.indexOf('train.js') !== -1) {
        return src.slice(0, src.length - 'train.js'.length);
      }
    }
    return 'assets/js/';
  };

  Trainer.prototype._onWorkerMessage = function (ev) {
    var d = ev.data;
    if (d.type === 'grads') {
      this._workerReady++;
      this._workerGrads = this._workerGrads || [];
      this._workerGrads.push({ loss: d.loss, grads: d.grads, count: d.count });
      if (this._workerReady >= this._workers.length) {
        this._applyGradients();
      }
    }
  };

  Trainer.prototype._applyGradients = function () {
    var parts = this._workerGrads;
    this._workerGrads = [];
    this._workerReady = 0;
    this._pending = false;
    if (!parts || parts.length === 0) return;
    var params = this.model.params;
    var i, j, k;
    for (i = 0; i < params.length; i++) params[i].g.fill(0);
    var total = 0;
    var lossSum = 0;
    for (j = 0; j < parts.length; j++) {
      total += parts[j].count;
      lossSum += parts[j].loss * parts[j].count;
      var grads = parts[j].grads;
      for (i = 0; i < params.length; i++) {
        var g = grads[i];
        var tg = params[i].g;
        for (k = 0; k < tg.length; k++) tg[k] += g[k];
      }
    }
    for (i = 0; i < params.length; i++) {
      var pg = params[i].g;
      for (k = 0; k < pg.length; k++) pg[k] /= total;
    }
    this.loss = lossSum / total;
    this._afterStep();
  };

  Trainer.prototype._workPerStep = function () {
    var workers = (this._serial || this._workers.length === 0) ? 1 : this._workers.length;
    return this.microbatch * this.accum * workers * this.block;
  };

  Trainer.prototype._afterStep = function () {
    this.step += 1;
    this.lossEma = this.lossEma === 0 ? this.loss : this.lossEma * 0.97 + this.loss * 0.03;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    this._lastTimes.push(now);
    if (this._lastTimes.length > 30) this._lastTimes.shift();
    if (this._lastTimes.length > 4) {
      var dt = (this._lastTimes[this._lastTimes.length - 1] - this._lastTimes[0]) / (this._lastTimes.length - 1);
      var toks = this._workPerStep();
      this.tokensPerSec = dt > 0 ? toks / (dt / 1000) : 0;
    }
    if (this.step % 20 === 0 || this.step === 1) this._evalVal();
    if (this.step % this.snapshotEvery === 0) this.onSnapshot(this.snapshot());
    this.broadcastWeights();
    this.onStep(this);
    if (this.running) this.schedule();
  };

  Trainer.prototype.broadcastWeights = function () {
    if (this._serial || this._workers.length === 0) return;
    var params = [];
    for (var i = 0; i < this.model.params.length; i++) {
      params.push(this.model.params[i].w.slice());
    }
    var msg = { type: 'weights', params: params };
    for (var j = 0; j < this._workers.length; j++) {
      this._workers[j].postMessage(msg);
    }
  };

  Trainer.prototype._evalVal = function () {
    var B = this._valIdx.length / this.block;
    this.valLoss = this.evaluate();
  };

  Trainer.prototype.schedule = function () {
    if (!this.running || this._pending) return;
    this._pending = true;
    var self = this;
    if (this._serial || this._workers.length === 0) {
      setTimeout(function () { self._stepSerial(); }, 0);
    } else {
      var lr = lrAt(this.step, this);
      for (var i = 0; i < this._workers.length; i++) {
        this._workers[i].postMessage({
          type: 'grads',
          seed: (this.seed + this.step * 7919 + i * 104729) >>> 0,
          step: this.step
        });
      }
    }
  };

  Trainer.prototype._stepSerial = function () {
    var model = this.model;
    var T = this.block;
    var micro = this.microbatch;
    model.ensureShape(micro, T);
    model.zeroGrad();
    var lossSum = 0;
    for (var a = 0; a < this.accum; a++) {
      var batch = drawBatch(this.tokens, T, micro, this._rng);
      lossSum += model.forwardBackward(batch.idx, batch.tg);
    }
    var inv = 1 / this.accum;
    var params = model.params;
    for (var i = 0; i < params.length; i++) {
      var g = params[i].g;
      for (var j = 0; j < g.length; j++) g[j] *= inv;
    }
    this.loss = lossSum / this.accum;
    var lr = lrAt(this.step, this);
    this._adam.step(lr, this.weightDecay, this.clip);
    this._pending = false;
    this._afterStep();
  };

  Trainer.prototype.evaluate = function () {
    var B = this._valIdx.length / this.block;
    this.model.ensureShape(B, this.block);
    var loss = this.model.forward(this._valIdx, this._valTg);
    this.valLoss = loss;
    return loss;
  };

  Trainer.prototype.batchLoss = function () {
    var model = this.model;
    var T = this.block;
    model.ensureShape(this.microbatch, T);
    var batch = drawBatch(this.tokens, T, this.microbatch, this._rng);
    return model.forward(batch.idx, batch.tg);
  };

  Trainer.prototype.snapshot = function () {
    var model = this.model;
    var probe = this.probe || 'The ';
    var tok = this.tokenizer;
    var ids = tok.encode(probe);
    var rng = SL.rng.mulberry32(424242);
    var savedB = model._B, savedT = model._T;
    var gen = model.generate(ids, 90, {
      temperature: this.sampleTemp || 0.65,
      topK: 5,
      topP: 0.92,
      repPenalty: 0.18
    }, rng);
    model.ensureShape(savedB, savedT);
    return {
      step: this.step,
      loss: this.lossEma || this.loss,
      text: probe + tok.decode(gen)
    };
  };

  Trainer.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.schedule();
  };

  Trainer.prototype.pause = function () {
    this.running = false;
  };

  Trainer.prototype.dispose = function () {
    this.running = false;
    for (var i = 0; i < this._workers.length; i++) this._workers[i].terminate();
    this._workers = [];
    this._serial = true;
    this._pending = false;
    this._workerGrads = [];
    this._workerReady = 0;
  };

  Trainer.prototype.mode = function () {
    return (this._serial || this._workers.length === 0) ? 'single thread' : (this._workers.length + ' worker threads');
  };

  SL.presets = presets;
  SL.Trainer = Trainer;
  SL.trainUtil = { lrAt: lrAt, drawBatch: drawBatch };
})(typeof window !== 'undefined' ? window : globalThis);
