(function (global) {
  'use strict';
  var SL = global.SL || (global.SL = {});
  var M = SL.math;

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function relErr(a, b) {
    if (!isFinite(a) || !isFinite(b)) return Infinity;
    return Math.abs(a - b) / Math.max(Math.abs(a) + Math.abs(b), 1e-9);
  }

  function ProofPanel(write) {
    this.write = write || function () {};
    this.results = [];
  }

  ProofPanel.prototype.line = function (text, cls) {
    this.write(text, cls);
  };

  ProofPanel.prototype.record = function (name, ok, detail) {
    this.results.push({ name: name, ok: ok, detail: detail });
    this.line((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''), ok ? 'ok' : 'fail');
    return ok;
  };

  ProofPanel.prototype.runAll = function () {
    var self = this;
    this.results = [];
    var t0 = now();
    this.line('STRANGE LOOP / ONE BOOK — verification suite', 'head');
    this.line('every test below runs in this page, on this machine, just now.', 'dim');
    this.line('');
    var tests = [
      ['tokenizer round-trip', function () { return self.testTokenizer(); }],
      ['matmul agrees with textbook triple loop', function () { return self.testMatmul(); }],
      ['attention is strictly causal', function () { return self.testCausality(); }],
      ['attention rows sum to one', function () { return self.testAttentionRows(); }],
      ['backprop matches finite differences', function () { return self.testGradients(); }],
      ['a tiny model can memorise a random sequence', function () { return self.testOverfit(); }],
      ['weights survive a save and reload', function () { return self.testSerialize(); }],
      ['sampling stays inside the vocabulary', function () { return self.testSampling(); }],
      ['the shipped checkpoint survived quantisation', function () { return self.testCheckpoint(); }]
    ];
    for (var i = 0; i < tests.length; i++) {
      this.line('· ' + tests[i][0], 'dim');
      try {
        tests[i][1]();
      } catch (e) {
        this.record(tests[i][0], false, String(e && e.message ? e.message : e));
      }
    }
    var passed = 0;
    for (var j = 0; j < this.results.length; j++) if (this.results[j].ok) passed++;
    this.line('');
    this.line(passed + ' of ' + this.results.length + ' checks passed in ' + SL.util.fmtTime(now() - t0) + '.', passed === this.results.length ? 'ok' : 'fail');
    return passed === this.results.length;
  };

  ProofPanel.prototype.testTokenizer = function () {
    var text = 'the map is not the territory\nbut it is the only one we can carry\n';
    var tok = new SL.CharTokenizer(text);
    var ok = tok.decode(tok.encode(text)) === text;
    ok = ok && tok.contains('map') && !tok.contains('z');
    this.record('tokenizer round-trip', ok, 'vocab ' + tok.vocab + ' chars');
    return ok;
  };

  ProofPanel.prototype.testMatmul = function () {
    var m = 7, k = 9, n = 5;
    var rng = SL.rng.mulberry32(3);
    var A = new Float64Array(m * k), B = new Float64Array(k * n);
    for (var i = 0; i < A.length; i++) A[i] = rng() * 2 - 1;
    for (var j = 0; j < B.length; j++) B[j] = rng() * 2 - 1;
    var fast = new Float64Array(m * n);
    M.matmulNN(fast, A, B, m, k, n);
    var worst = 0;
    for (var r = 0; r < m; r++) {
      for (var c = 0; c < n; c++) {
        var acc = 0;
        for (var p = 0; p < k; p++) acc += A[r * k + p] * B[p * n + c];
        worst = Math.max(worst, Math.abs(acc - fast[r * n + c]));
      }
    }
    var ok = worst < 1e-9;
    this.record('matmul agrees with textbook triple loop', ok, 'max abs err ' + worst.toExponential(2));
    return ok;
  };

  ProofPanel.prototype.testCausality = function () {
    var model = new SL.Transformer({
      vocab: 13, dim: 12, heads: 3, layers: 2, block: 32, hidden: 24, dtype: 'f64', seed: 21
    });
    var idx = new Int32Array(32);
    for (var i = 0; i < 32; i++) idx[i] = (i * 7 + 3) % 13;
    function rowLogits(seq, row) {
      var T = seq.length;
      model.ensureShape(1, T);
      model.forward(seq, null);
      var out = new Float64Array(13);
      for (var j = 0; j < 13; j++) out[j] = model._acts.logits[row * 13 + j];
      return out;
    }
    var a = rowLogits(idx.subarray(0, 32), 19);
    var b = rowLogits(idx.subarray(0, 20), 19);
    var worst = 0;
    for (var j2 = 0; j2 < 13; j2++) worst = Math.max(worst, Math.abs(a[j2] - b[j2]));
    var ok = worst < 1e-12;
    this.record('attention is strictly causal', ok, 'rows unchanged by future tokens, err ' + worst.toExponential(2));
    return ok;
  };

  ProofPanel.prototype.testAttentionRows = function () {
    var model = new SL.Transformer({
      vocab: 11, dim: 12, heads: 3, layers: 2, block: 16, hidden: 24, dtype: 'f64', seed: 5
    });
    var idx = new Int32Array(16);
    for (var i = 0; i < 16; i++) idx[i] = i % 11;
    var maps = model.attentionMaps(idx);
    var worst = 0;
    for (var l = 0; l < maps.length; l++) {
      for (var h = 0; h < maps[l].length; h++) {
        for (var t = 0; t < 16; t++) {
          var sum = 0;
          for (var s = 0; s <= t; s++) sum += maps[l][h][t * 16 + s];
          for (var s2 = t + 1; s2 < 16; s2++) sum += maps[l][h][t * 16 + s2];
          worst = Math.max(worst, Math.abs(sum - 1));
        }
      }
    }
    var ok = worst < 1e-6;
    this.record('attention rows sum to one', ok, 'max deviation ' + worst.toExponential(2));
    return ok;
  };

  ProofPanel.prototype.testGradients = function () {
    var model = new SL.Transformer({
      vocab: 15, dim: 10, heads: 2, layers: 2, block: 6, hidden: 20, dtype: 'f64', seed: 9
    });
    var B = 2, T = 6;
    var idx = new Int32Array(B * T), tg = new Int32Array(B * T);
    var rng = SL.rng.mulberry32(77);
    for (var i = 0; i < B * T; i++) {
      idx[i] = Math.floor(rng() * 15);
      tg[i] = Math.floor(rng() * 15);
    }
    model.ensureShape(B, T);
    model.zeroGrad();
    var loss = model.forwardBackward(idx, tg);
    var eps = 1e-5;
    var worst = 0, worstName = '';
    for (var p = 0; p < model.params.length; p++) {
      var par = model.params[p];
      var stride = par.size > 40 ? Math.ceil(par.size / 8) : 1;
      for (var i2 = 0; i2 < par.size; i2 += stride) {
        var orig = par.w[i2];
        par.w[i2] = orig + eps;
        var lp = model.forward(idx, tg);
        par.w[i2] = orig - eps;
        var lm = model.forward(idx, tg);
        par.w[i2] = orig;
        var numeric = (lp - lm) / (2 * eps);
        var r = Math.abs(par.g[i2] - numeric) / (Math.abs(par.g[i2]) + Math.abs(numeric) + 1e-7);
        if (r > worst) { worst = r; worstName = par.name; }
      }
    }
    var ok = worst < 5e-3;
    this.record('backprop matches finite differences', ok,
      'loss ' + loss.toFixed(5) + ', worst relative error ' + worst.toExponential(2) + ' on ' + worstName + ' (float64, finite differences)');
    return ok;
  };

  ProofPanel.prototype.testOverfit = function () {
    var model = new SL.Transformer({
      vocab: 12, dim: 14, heads: 2, layers: 2, block: 8, hidden: 28, dtype: 'f32', seed: 4
    });
    var B = 4, T = 8;
    var idx = new Int32Array(B * T), tg = new Int32Array(B * T);
    var rng = SL.rng.mulberry32(31);
    for (var i = 0; i < B * T; i++) {
      idx[i] = Math.floor(rng() * 12);
      tg[i] = Math.floor(rng() * 12);
    }
    model.ensureShape(B, T);
    var adam = new SL.Adam(model);
    var first = 0, last = 0;
    var t0 = now();
    for (var s = 0; s < 220; s++) {
      model.zeroGrad();
      var loss = model.forwardBackward(idx, tg);
      adam.step(0.05, 0, 1);
      if (s === 0) first = loss;
      last = loss;
    }
    var ok = isFinite(last) && last < 0.12 && last < first * 0.25;
    this.record('a tiny model can memorise a random sequence', ok,
      first.toFixed(4) + ' → ' + last.toFixed(6) + ' in ' + SL.util.fmtTime(now() - t0));
    return ok;
  };

  ProofPanel.prototype.testSerialize = function () {
    var model = new SL.Transformer({
      vocab: 9, dim: 8, heads: 2, layers: 1, block: 6, hidden: 16, dtype: 'f32', seed: 12
    });
    var idx = new Int32Array([0, 1, 2, 3, 4, 5]);
    var a = model.logitsAt(idx);
    var state = model.serialize();
    var model2 = new SL.Transformer({
      vocab: 9, dim: 8, heads: 2, layers: 1, block: 6, hidden: 16, dtype: 'f32', seed: 99
    });
    var ok = model2.loadState(state);
    var b = model2.logitsAt(idx);
    var worst = 0;
    for (var j = 0; j < a.length; j++) worst = Math.max(worst, Math.abs(a[j] - b[j]));
    ok = ok && worst === 0;
    this.record('weights survive a save and reload', ok, 'max logit diff ' + worst.toExponential(2));
    return ok;
  };

  ProofPanel.prototype.testSampling = function () {
    var logits = new Float64Array(20);
    for (var i = 0; i < 20; i++) logits[i] = Math.sin(i * 1.7) * 3;
    var rng = SL.rng.mulberry32(8);
    var ok = true;
    for (var k = 0; k < 500; k++) {
      var v = M.sampleFromLogits(logits, 20, {
        temperature: 0.4 + (k % 9) * 0.15,
        topK: (k % 5) + 1,
        topP: 0.5 + (k % 5) * 0.1,
        repPenalty: (k % 3) * 0.3
      }, rng);
      if (!(v >= 0 && v < 20)) { ok = false; break; }
    }
    var greedy = M.sampleFromLogits(logits, 20, { temperature: 0 }, rng);
    var best = 0;
    for (var j = 1; j < 20; j++) if (logits[j] > logits[best]) best = j;
    ok = ok && greedy === best;
    this.record('sampling stays inside the vocabulary', ok, '500 draws, greedy agrees with argmax');
    return ok;
  };


  ProofPanel.prototype.testCheckpoint = function () {
    var bookId = this.bookId || 'reader';
    var ckpt = (SL.checkpoints || {})[bookId];
    if (!ckpt || !ckpt.weights || !SL.books || !SL.books[bookId]) {
      this.record('the shipped checkpoint survived quantisation', true, 'no checkpoint for this book — skipped');
      return true;
    }
    var text = SL.books[bookId].text;
    var tok = new SL.CharTokenizer(text);
    var model = new SL.Transformer({
      vocab: ckpt.config.vocab, dim: ckpt.config.dim, heads: ckpt.config.heads,
      layers: ckpt.config.layers, block: ckpt.config.block, hidden: ckpt.config.hidden,
      dtype: 'f64', seed: 1
    });
    var loaded = 0;
    var maxAbs = 0;
    for (var i = 0; i < model.params.length; i++) {
      var p = model.params[i];
      var bin = atob(ckpt.weights[p.name]);
      if (bin.length !== p.size) {
        this.record('the shipped checkpoint survived quantisation', false, 'size mismatch on ' + p.name);
        return false;
      }
      var scale = ckpt.scales[p.name];
      for (var k = 0; k < p.size; k++) {
        var q = bin.charCodeAt(k) > 127 ? bin.charCodeAt(k) - 256 : bin.charCodeAt(k);
        var rec = q * scale;
        p.w[k] = rec;
        if (Math.abs(rec) > maxAbs) maxAbs = Math.abs(rec);
        loaded++;
      }
    }
    var T = Math.min(ckpt.config.block, 64);
    var windows = 6;
    var idx = new Int32Array(windows * T), tg = new Int32Array(windows * T);
    var encoded = tok.encode(text);
    var span = encoded.length - T - 1;
    var rnd = SL.rng.mulberry32(1234);
    for (var b = 0; b < windows; b++) {
      var off = Math.floor(rnd() * span);
      for (var t = 0; t < T; t++) {
        idx[b * T + t] = encoded[off + t];
        tg[b * T + t] = encoded[off + t + 1];
      }
    }
    model.ensureShape(windows, T);
    var loss = model.forward(idx, tg);
    var recorded = ckpt.finalLoss;
    var ok = isFinite(loss) && isFinite(recorded) && loss <= recorded + 0.45 && maxAbs > 0;
    this.record('the shipped checkpoint survived quantisation', ok,
      loaded + ' weights unpacked from 8 bits, score on ' + windows + ' random pages ' +
      (isFinite(loss) ? loss.toFixed(4) : 'NaN') + ' nats against ' +
      (isFinite(recorded) ? recorded.toFixed(4) : '?') + ' recorded at the end of training');
    return ok;
  };

  SL.ProofPanel = ProofPanel;
})(typeof window !== 'undefined' ? window : globalThis);
