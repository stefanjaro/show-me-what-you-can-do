(function (global) {
  'use strict';
  var SL = global.SL;
  var M = SL.math;

  function CharTokenizer(text) {
    var seen = {};
    var chars = [];
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (!seen[c]) { seen[c] = true; chars.push(c); }
    }
    chars.sort();
    this.itos = chars;
    this.stoi = {};
    for (var j = 0; j < chars.length; j++) this.stoi[chars[j]] = j;
    this.vocab = chars.length;
  }

  CharTokenizer.prototype.encode = function (str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var id = this.stoi[str[i]];
      if (id !== undefined) out.push(id);
    }
    return Int32Array.from(out);
  };

  CharTokenizer.prototype.decode = function (ids) {
    var s = '';
    for (var i = 0; i < ids.length; i++) s += this.itos[ids[i]] || '';
    return s;
  };

  CharTokenizer.prototype.contains = function (str) {
    for (var i = 0; i < str.length; i++) {
      if (this.stoi[str[i]] === undefined) return false;
    }
    return true;
  };

  function Param(name, rows, cols, kind) {
    this.name = name;
    this.rows = rows;
    this.cols = cols;
    this.size = rows * cols;
    this.kind = kind || 'w';
    this.decay = this.kind === 'w';
    this.w = null;
    this.g = null;
  }

  Param.prototype.alloc = function (dtype) {
    var Ctor = dtype === 'f64' ? Float64Array : Float32Array;
    this.w = new Ctor(this.size);
    this.g = new Ctor(this.size);
    return this;
  };

  function layerNorm(out, x, g, b, mean, rstd, rows, C) {
    for (var i = 0; i < rows; i++) {
      var off = i * C;
      var m = 0;
      for (var j = 0; j < C; j++) m += x[off + j];
      m /= C;
      var v = 0;
      for (var j2 = 0; j2 < C; j2++) {
        var d = x[off + j2] - m;
        v += d * d;
      }
      v /= C;
      var rs = 1 / Math.sqrt(v + 1e-5);
      mean[i] = m;
      rstd[i] = rs;
      for (var j3 = 0; j3 < C; j3++) {
        out[off + j3] = (x[off + j3] - m) * rs * g[j3] + b[j3];
      }
    }
  }

  function layerNormBackward(dx, dg, db, dy, x, g, mean, rstd, rows, C, dxAcc) {
    for (var j = 0; j < C; j++) { dg[j] = 0; db[j] = 0; }
    for (var i = 0; i < rows; i++) {
      var off = i * C;
      var m = mean[i];
      var rs = rstd[i];
      var meanDy = 0;
      var meanDyx = 0;
      for (var j2 = 0; j2 < C; j2++) {
        var xhat = (x[off + j2] - m) * rs;
        var d = dy[off + j2];
        dg[j2] += d * xhat;
        db[j2] += d;
        var dxh = d * g[j2];
        meanDy += dxh;
        meanDyx += dxh * xhat;
      }
      meanDy /= C;
      meanDyx /= C;
      for (var j3 = 0; j3 < C; j3++) {
        var xhat2 = (x[off + j3] - m) * rs;
        var dxh2 = dy[off + j3] * g[j3];
        var val = (dxh2 - meanDy - xhat2 * meanDyx) * rs;
        dx[off + j3] = val;
        if (dxAcc) dxAcc[off + j3] += val;
      }
    }
  }

  function gelu(out, x, n) {
    var k = Math.sqrt(2 / Math.PI);
    for (var i = 0; i < n; i++) {
      var v = x[i];
      var u = k * (v + 0.044715 * v * v * v);
      out[i] = 0.5 * v * (1 + Math.tanh(u));
    }
  }

  function geluBackward(dx, dy, x, n) {
    var k = Math.sqrt(2 / Math.PI);
    for (var i = 0; i < n; i++) {
      var v = x[i];
      var u = k * (v + 0.044715 * v * v * v);
      var t = Math.tanh(u);
      var dt = (1 - t * t) * k * (1 + 3 * 0.044715 * v * v);
      dx[i] = dy[i] * (0.5 * (1 + t) + 0.5 * v * dt);
    }
  }

  function causalSoftmax(out, inp, matrices, T) {
    for (var m = 0; m < matrices; m++) {
      var base = m * T * T;
      for (var t = 0; t < T; t++) {
        var off = base + t * T;
        var max = -Infinity;
        for (var j = 0; j <= t; j++) {
          var v = inp[off + j];
          if (v > max) max = v;
        }
        var sum = 0;
        for (var j2 = 0; j2 <= t; j2++) {
          var e = Math.exp(inp[off + j2] - max);
          out[off + j2] = e;
          sum += e;
        }
        var inv = sum > 0 ? 1 / sum : 0;
        for (var j3 = 0; j3 <= t; j3++) out[off + j3] *= inv;
        for (var j4 = t + 1; j4 < T; j4++) out[off + j4] = 0;
      }
    }
  }

  function causalSoftmaxBackward(dinp, dout, probs, matrices, T) {
    for (var m = 0; m < matrices; m++) {
      var base = m * T * T;
      for (var t = 0; t < T; t++) {
        var off = base + t * T;
        var dot = 0;
        for (var j = 0; j <= t; j++) dot += dout[off + j] * probs[off + j];
        for (var j2 = 0; j2 <= t; j2++) {
          dinp[off + j2] = probs[off + j2] * (dout[off + j2] - dot);
        }
        for (var j3 = t + 1; j3 < T; j3++) dinp[off + j3] = 0;
      }
    }
  }

  function permuteToHeadMajor(out, inp, B, H, T, Hc) {
    for (var b = 0; b < B; b++) {
      for (var h = 0; h < H; h++) {
        for (var t = 0; t < T; t++) {
          var src = ((b * T + t) * H + h) * Hc;
          var dst = ((b * H + h) * T + t) * Hc;
          for (var d = 0; d < Hc; d++) out[dst + d] = inp[src + d];
        }
      }
    }
  }

  function permuteToTokenMajor(out, inp, B, H, T, Hc) {
    for (var b = 0; b < B; b++) {
      for (var h = 0; h < H; h++) {
        for (var t = 0; t < T; t++) {
          var dst = ((b * T + t) * H + h) * Hc;
          var src = ((b * H + h) * T + t) * Hc;
          for (var d = 0; d < Hc; d++) out[dst + d] = inp[src + d];
        }
      }
    }
  }

  function softmaxCrossEntropy(logits, targets, probs, rows, cols) {
    var total = 0;
    for (var i = 0; i < rows; i++) {
      var off = i * cols;
      var max = -Infinity;
      for (var j = 0; j < cols; j++) {
        var v = logits[off + j];
        if (v > max) max = v;
      }
      var sum = 0;
      for (var j2 = 0; j2 < cols; j2++) {
        var e = Math.exp(logits[off + j2] - max);
        probs[off + j2] = e;
        sum += e;
      }
      var inv = sum > 0 ? 1 / sum : 0;
      for (var j3 = 0; j3 < cols; j3++) probs[off + j3] *= inv;
      total -= logits[off + targets[i]] - max - Math.log(sum);
    }
    return total / rows;
  }

  function Transformer(config) {
    this.vocab = config.vocab;
    this.dim = config.dim;
    this.heads = config.heads;
    this.layers = config.layers;
    this.block = config.block;
    this.hidden = config.hidden || config.dim * 4;
    this.dtype = config.dtype || 'f32';
    this.name = config.name || 'strange-loop';
    if (this.dim % this.heads !== 0) throw new Error('dim must divide heads');
    this.headDim = this.dim / this.heads;
    this.params = [];
    this._buildParams(config.seed === undefined ? 1337 : config.seed);
    this._B = 0;
    this._T = 0;
    this._lastIdx = null;
    this.ensureShape(1, this.block);
  }

  Transformer.prototype._add = function (name, rows, cols, kind) {
    var p = new Param(name, rows, cols, kind).alloc(this.dtype);
    this.params.push(p);
    return p;
  };

  Transformer.prototype._buildParams = function (seed) {
    var C = this.dim, D = this.hidden, V = this.vocab, T = this.block, L = this.layers;
    var rng = SL.rng.mulberry32(seed);
    this.tokEmb = this._add('tokEmb', V, C, 'w');
    this.posEmb = this._add('posEmb', T, C, 'w');
    this.blocks = [];
    for (var l = 0; l < L; l++) {
      this.blocks.push({
        ln1g: this._add('b' + l + '.ln1g', 1, C, 'g'),
        ln1b: this._add('b' + l + '.ln1b', 1, C, 'b'),
        wq: this._add('b' + l + '.wq', C, C, 'w'),
        bq: this._add('b' + l + '.bq', 1, C, 'b'),
        wk: this._add('b' + l + '.wk', C, C, 'w'),
        bk: this._add('b' + l + '.bk', 1, C, 'b'),
        wv: this._add('b' + l + '.wv', C, C, 'w'),
        bv: this._add('b' + l + '.bv', 1, C, 'b'),
        wo: this._add('b' + l + '.wo', C, C, 'w'),
        bo: this._add('b' + l + '.bo', 1, C, 'b'),
        ln2g: this._add('b' + l + '.ln2g', 1, C, 'g'),
        ln2b: this._add('b' + l + '.ln2b', 1, C, 'b'),
        w1: this._add('b' + l + '.w1', C, D, 'w'),
        b1: this._add('b' + l + '.b1', 1, D, 'b'),
        w2: this._add('b' + l + '.w2', D, C, 'w'),
        b2: this._add('b' + l + '.b2', 1, C, 'b')
      });
    }
    this.lnfg = this._add('lnfg', 1, C, 'g');
    this.lnfb = this._add('lnfb', 1, C, 'b');
    this.wOut = this._add('wOut', C, V, 'w');
    this.bOut = this._add('bOut', 1, V, 'b');

    for (var i = 0; i < this.params.length; i++) {
      var p = this.params[i];
      if (p.kind === 'g') {
        for (var j = 0; j < p.size; j++) p.w[j] = 1;
        continue;
      }
      if (p.kind === 'b') continue;
      var s = 0.02;
      if (p.name.slice(-2) === 'wo' || p.name.slice(-2) === 'w2') {
        s = 0.02 / Math.sqrt(2 * L);
      }
      for (var j2 = 0; j2 < p.size; j2++) p.w[j2] = SL.rng.gaussian(rng) * s;
    }
  };

  Transformer.prototype.paramCount = function () {
    var n = 0;
    for (var i = 0; i < this.params.length; i++) n += this.params[i].size;
    return n;
  };

  Transformer.prototype.zeroGrad = function () {
    for (var i = 0; i < this.params.length; i++) this.params[i].g.fill(0);
  };

  Transformer.prototype.ensureShape = function (B, T) {
    if (this._B === B && this._T === T) return;
    this._B = B;
    this._T = T;
    var C = this.dim, D = this.hidden, V = this.vocab, L = this.layers;
    var H = this.heads;
    var BTC = B * T * C;
    var BTD = B * T * D;
    var BTTV = B * T * V;
    var BH = B * H * T * T;
    var rows = B * T;
    var Ctor = this.dtype === 'f64' ? Float64Array : Float32Array;
    var mk = function (n) { return new Ctor(n); };
    var a = { blocks: [] };
    var g = { blocks: [] };
    a.emb = mk(BTC);
    a.nf = mk(BTC);
    a.logits = mk(BTTV);
    a.probs = mk(BTTV);
    a.mf = mk(rows);
    a.rf = mk(rows);
    a.loss = 0;
    g.nf = mk(BTC);
    for (var l = 0; l < L; l++) {
      a.blocks.push({
        n1: mk(BTC), q: mk(BTC), k: mk(BTC), v: mk(BTC),
        qh: mk(BTC), kh: mk(BTC), vh: mk(BTC),
        scores: mk(BH), probs: mk(BH),
        ctx: mk(BTC), ctxp: mk(BTC), o: mk(BTC),
        xin: mk(BTC), xmid: mk(BTC), n2: mk(BTC),
        h1: mk(BTD), a1: mk(BTD), f: mk(BTC), xout: mk(BTC),
        m1: mk(rows), r1: mk(rows), m2: mk(rows), r2: mk(rows)
      });
      g.blocks.push({
        n1: mk(BTC), q: mk(BTC), k: mk(BTC), v: mk(BTC),
        qh: mk(BTC), kh: mk(BTC), vh: mk(BTC),
        scores: mk(BH), probs: mk(BH),
        ctx: mk(BTC), ctxp: mk(BTC), o: mk(BTC),
        xin: mk(BTC), xmid: mk(BTC), n2: mk(BTC),
        h1: mk(BTD), a1: mk(BTD), f: mk(BTC), xout: mk(BTC)
      });
    }
    this._acts = a;
    this._grads = g;
    this._scratch = {
      dW: mk(Math.max(C * C, C * D, D * C, C * V)),
      db: mk(Math.max(C, D, V)),
      dx: mk(rows * Math.max(C, D)),
      dx2: mk(rows * Math.max(C, D)),
      dlogits: mk(BTTV)
    };
  };

  Transformer.prototype.forward = function (idx, targets) {
    this._lastIdx = idx;
    var B = this._B, T = this._T, C = this.dim, D = this.hidden, V = this.vocab;
    var H = this.heads, Hc = this.headDim, L = this.layers;
    var rows = B * T;
    var a = this._acts;
    var emb = a.emb;
    for (var i = 0; i < rows; i++) {
      var t = i % T;
      var eOff = idx[i] * C;
      var pOff = t * C;
      var oOff = i * C;
      for (var j = 0; j < C; j++) emb[oOff + j] = this.tokEmb.w[eOff + j] + this.posEmb.w[pOff + j];
    }
    var xin = emb;
    for (var l = 0; l < L; l++) {
      var blk = this.blocks[l];
      var ab = a.blocks[l];
      ab.xin.set(xin);
      layerNorm(ab.n1, xin, blk.ln1g.w, blk.ln1b.w, ab.m1, ab.r1, rows, C);
      M.matmulNN(ab.q, ab.n1, blk.wq.w, rows, C, C);
      M.matmulNN(ab.k, ab.n1, blk.wk.w, rows, C, C);
      M.matmulNN(ab.v, ab.n1, blk.wv.w, rows, C, C);
      for (var r = 0; r < rows; r++) {
        var ro = r * C;
        for (var j2 = 0; j2 < C; j2++) {
          ab.q[ro + j2] += blk.bq.w[j2];
          ab.k[ro + j2] += blk.bk.w[j2];
          ab.v[ro + j2] += blk.bv.w[j2];
        }
      }
      permuteToHeadMajor(ab.qh, ab.q, B, H, T, Hc);
      permuteToHeadMajor(ab.kh, ab.k, B, H, T, Hc);
      permuteToHeadMajor(ab.vh, ab.v, B, H, T, Hc);
      var mCount = B * H;
      var scale = 1 / Math.sqrt(Hc);
      M.bmmNT(ab.scores, ab.qh, ab.kh, T, Hc, T, mCount, T * Hc, T * Hc, T * T);
      for (var s = 0; s < ab.scores.length; s++) ab.scores[s] *= scale;
      causalSoftmax(ab.probs, ab.scores, mCount, T);
      M.bmmNN(ab.ctx, ab.probs, ab.vh, T, T, Hc, mCount, T * T, T * Hc, T * Hc);
      permuteToTokenMajor(ab.ctxp, ab.ctx, B, H, T, Hc);
      M.matmulNN(ab.o, ab.ctxp, blk.wo.w, rows, C, C);
      for (var r2 = 0; r2 < rows; r2++) {
        var ro2 = r2 * C;
        for (var j3 = 0; j3 < C; j3++) ab.o[ro2 + j3] += blk.bo.w[j3];
      }
      for (var r3 = 0; r3 < rows; r3++) {
        var ro3 = r3 * C;
        for (var j4 = 0; j4 < C; j4++) ab.xmid[ro3 + j4] = ab.xin[ro3 + j4] + ab.o[ro3 + j4];
      }
      layerNorm(ab.n2, ab.xmid, blk.ln2g.w, blk.ln2b.w, ab.m2, ab.r2, rows, C);
      M.matmulNN(ab.h1, ab.n2, blk.w1.w, rows, C, D);
      for (var r4 = 0; r4 < rows; r4++) {
        var ro4 = r4 * D;
        for (var j5 = 0; j5 < D; j5++) ab.h1[ro4 + j5] += blk.b1.w[j5];
      }
      gelu(ab.a1, ab.h1, B * T * D);
      M.matmulNN(ab.f, ab.a1, blk.w2.w, rows, D, C);
      for (var r5 = 0; r5 < rows; r5++) {
        var ro5 = r5 * C;
        for (var j6 = 0; j6 < C; j6++) ab.f[ro5 + j6] += blk.b2.w[j6];
      }
      for (var r6 = 0; r6 < rows; r6++) {
        var ro6 = r6 * C;
        for (var j7 = 0; j7 < C; j7++) ab.xout[ro6 + j7] = ab.xmid[ro6 + j7] + ab.f[ro6 + j7];
      }
      xin = ab.xout;
    }
    layerNorm(a.nf, xin, this.lnfg.w, this.lnfb.w, a.mf, a.rf, rows, C);
    M.matmulNN(a.logits, a.nf, this.wOut.w, rows, C, V);
    for (var r7 = 0; r7 < rows; r7++) {
      var ro7 = r7 * V;
      for (var j8 = 0; j8 < V; j8++) a.logits[ro7 + j8] += this.bOut.w[j8];
    }
    if (targets) {
      a.loss = softmaxCrossEntropy(a.logits, targets, a.probs, rows, V);
      return a.loss;
    }
    a.loss = 0;
    return 0;
  };

  Transformer.prototype._linearBackward = function (dx, dy, x, W, b, rows, K, N) {
    var sc = this._scratch;
    M.matmulNT(dx, dy, W.w, rows, N, K);
    M.matmulTN(sc.dW, x, dy, K, rows, N);
    for (var i = 0; i < W.size; i++) W.g[i] += sc.dW[i];
    M.colSum(sc.db, dy, rows, N);
    for (var j = 0; j < N; j++) b.g[j] += sc.db[j];
  };

  Transformer.prototype.backward = function (targets) {
    var B = this._B, T = this._T, C = this.dim, D = this.hidden, V = this.vocab;
    var H = this.heads, Hc = this.headDim, L = this.layers;
    var rows = B * T;
    var a = this._acts;
    var g = this._grads;
    var sc = this._scratch;
    var invRows = 1 / rows;
    for (var i = 0; i < rows; i++) {
      var off = i * V;
      for (var j = 0; j < V; j++) sc.dlogits[off + j] = a.probs[off + j] * invRows;
      sc.dlogits[off + targets[i]] -= invRows;
    }
    this._linearBackward(g.nf, sc.dlogits, a.nf, this.wOut, this.bOut, rows, C, V);

    var dX = sc.dx;
    layerNormBackward(dX, this.lnfg.g, this.lnfb.g, g.nf, a.blocks[L - 1].xout, this.lnfg.w, a.mf, a.rf, rows, C, null);

    for (var l = L - 1; l >= 0; l--) {
      var blk = this.blocks[l];
      var ab = a.blocks[l];
      var gb = g.blocks[l];
      for (var i2 = 0; i2 < rows * C; i2++) {
        gb.xmid[i2] = dX[i2];
        gb.f[i2] = dX[i2];
      }
      this._linearBackward(sc.dx2, gb.f, ab.a1, blk.w2, blk.b2, rows, D, C);
      geluBackward(gb.a1, sc.dx2, ab.h1, B * T * D);
      this._linearBackward(gb.n2, gb.a1, ab.n2, blk.w1, blk.b1, rows, C, D);

      layerNormBackward(sc.dx2, blk.ln2g.g, blk.ln2b.g, gb.n2, ab.xmid, blk.ln2g.w, ab.m2, ab.r2, rows, C, null);
      for (var i3 = 0; i3 < rows * C; i3++) gb.xmid[i3] += sc.dx2[i3];

      for (var i4 = 0; i4 < rows * C; i4++) {
        gb.xin[i4] = gb.xmid[i4];
        gb.o[i4] = gb.xmid[i4];
      }
      this._linearBackward(sc.dx2, gb.o, ab.ctxp, blk.wo, blk.bo, rows, C, C);
      permuteToHeadMajor(gb.ctx, sc.dx2, B, H, T, Hc);

      var mCount = B * H;
      M.bmmNT(gb.probs, gb.ctx, ab.vh, T, Hc, T, mCount, T * Hc, T * Hc, T * T);
      M.bmmTN(gb.vh, ab.probs, gb.ctx, T, T, Hc, mCount, T * T, T * Hc, T * Hc);
      causalSoftmaxBackward(gb.scores, gb.probs, ab.probs, mCount, T);
      var scale = 1 / Math.sqrt(Hc);
      for (var i5 = 0; i5 < gb.scores.length; i5++) gb.scores[i5] *= scale;
      M.bmmNN(gb.qh, gb.scores, ab.kh, T, T, Hc, mCount, T * T, T * Hc, T * Hc);
      M.bmmTN(gb.kh, gb.scores, ab.qh, T, T, Hc, mCount, T * T, T * Hc, T * Hc);

      permuteToTokenMajor(gb.q, gb.qh, B, H, T, Hc);
      permuteToTokenMajor(gb.k, gb.kh, B, H, T, Hc);
      permuteToTokenMajor(gb.v, gb.vh, B, H, T, Hc);

      this._linearBackward(sc.dx2, gb.q, ab.n1, blk.wq, blk.bq, rows, C, C);
      for (var i6 = 0; i6 < rows * C; i6++) gb.n1[i6] = sc.dx2[i6];
      this._linearBackward(sc.dx2, gb.k, ab.n1, blk.wk, blk.bk, rows, C, C);
      for (var i7 = 0; i7 < rows * C; i7++) gb.n1[i7] += sc.dx2[i7];
      this._linearBackward(sc.dx2, gb.v, ab.n1, blk.wv, blk.bv, rows, C, C);
      for (var i8 = 0; i8 < rows * C; i8++) gb.n1[i8] += sc.dx2[i8];

      layerNormBackward(sc.dx2, blk.ln1g.g, blk.ln1b.g, gb.n1, ab.xin, blk.ln1g.w, ab.m1, ab.r1, rows, C, null);
      for (var i9 = 0; i9 < rows * C; i9++) gb.xin[i9] += sc.dx2[i9];
      dX = gb.xin;
    }

    var idx = this._lastIdx;
    for (var i10 = 0; i10 < rows; i10++) {
      var t = i10 % T;
      var eOff = idx[i10] * C;
      var pOff = t * C;
      var oOff = i10 * C;
      for (var j2 = 0; j2 < C; j2++) {
        this.tokEmb.g[eOff + j2] += dX[oOff + j2];
        this.posEmb.g[pOff + j2] += dX[oOff + j2];
      }
    }
  };

  Transformer.prototype.forwardBackward = function (idx, targets) {
    this._lastIdx = idx;
    var loss = this.forward(idx, targets);
    this.backward(targets);
    return loss;
  };

  Transformer.prototype.logitsAt = function (idx) {
    var T = idx.length;
    this.ensureShape(1, T);
    this._lastIdx = idx;
    this.forward(idx, null);
    var V = this.vocab;
    var row = T - 1;
    var out = new Float64Array(V);
    for (var j = 0; j < V; j++) out[j] = this._acts.logits[row * V + j];
    return out;
  };

  Transformer.prototype.attentionMaps = function (idx) {
    var T = idx.length;
    this.ensureShape(1, T);
    this._lastIdx = idx;
    this.forward(idx, null);
    var H = this.heads, L = this.layers;
    var out = [];
    for (var l = 0; l < L; l++) {
      var maps = [];
      for (var h = 0; h < H; h++) {
        var mat = new Float64Array(T * T);
        for (var t = 0; t < T; t++) {
          for (var s = 0; s <= t; s++) {
            mat[t * T + s] = this._acts.blocks[l].probs[(h * T + t) * T + s];
          }
        }
        maps.push(mat);
      }
      out.push(maps);
    }
    return out;
  };

  Transformer.prototype.generate = function (promptIds, count, opts, rng) {
    var ids = Array.prototype.slice.call(promptIds);
    if (ids.length === 0) ids.push(0);
    var block = this.block;
    var V = this.vocab;
    var out = [];
    var repWindow = (opts && opts.repWindow) || 48;
    for (var n = 0; n < count; n++) {
      var ctx = ids.slice(Math.max(0, ids.length - block));
      var T = ctx.length;
      this.ensureShape(1, T);
      var buf = Int32Array.from(ctx);
      this._lastIdx = buf;
      this.forward(buf, null);
      var row = T - 1;
      var logits = new Float64Array(V);
      for (var j = 0; j < V; j++) logits[j] = this._acts.logits[row * V + j];
      var stepOpts = opts;
      if (opts && opts.repPenalty) {
        stepOpts = {
          temperature: opts.temperature,
          topK: opts.topK,
          topP: opts.topP,
          repPenalty: opts.repPenalty,
          recent: ids.slice(Math.max(0, ids.length - repWindow))
        };
      }
      var next = M.sampleFromLogits(logits, V, stepOpts, rng);
      ids.push(next);
      out.push(next);
    }
    return out;
  };

  Transformer.prototype.serialize = function () {
    var out = {
      name: this.name,
      vocab: this.vocab,
      dim: this.dim,
      heads: this.heads,
      layers: this.layers,
      block: this.block,
      hidden: this.hidden,
      params: {}
    };
    for (var i = 0; i < this.params.length; i++) {
      var p = this.params[i];
      out.params[p.name] = Array.prototype.slice.call(p.w);
    }
    return out;
  };

  Transformer.prototype.loadState = function (state) {
    if (!state || !state.params) return false;
    if (state.vocab !== this.vocab || state.dim !== this.dim ||
        state.layers !== this.layers || state.block !== this.block ||
        state.hidden !== this.hidden) return false;
    for (var i = 0; i < this.params.length; i++) {
      var src = state.params[this.params[i].name];
      if (!src || src.length !== this.params[i].size) return false;
    }
    for (var j = 0; j < this.params.length; j++) {
      var p = this.params[j];
      var s = state.params[p.name];
      for (var k = 0; k < p.size; k++) p.w[k] = s[k];
    }
    return true;
  };

  function Adam(model, opts) {
    this.model = model;
    this.beta1 = opts && opts.beta1 !== undefined ? opts.beta1 : 0.9;
    this.beta2 = opts && opts.beta2 !== undefined ? opts.beta2 : 0.99;
    this.eps = opts && opts.eps !== undefined ? opts.eps : 1e-8;
    this.t = 0;
    this.m = [];
    this.v = [];
    var Ctor = model.dtype === 'f64' ? Float64Array : Float32Array;
    for (var i = 0; i < model.params.length; i++) {
      this.m.push(new Ctor(model.params[i].size));
      this.v.push(new Ctor(model.params[i].size));
    }
  }

  Adam.prototype.step = function (lr, weightDecay, clip) {
    this.t += 1;
    var params = this.model.params;
    if (clip && clip > 0) {
      var grads = [];
      for (var i = 0; i < params.length; i++) grads.push(params[i].g);
      var norm = M.globalNorm(grads);
      if (norm > clip) {
        var scale = clip / (norm + 1e-8);
        for (var i2 = 0; i2 < params.length; i2++) {
          var g = params[i2].g;
          for (var j = 0; j < g.length; j++) g[j] *= scale;
        }
      }
    }
    var b1 = this.beta1, b2 = this.beta2;
    var bc1 = 1 - Math.pow(b1, this.t);
    var bc2 = 1 - Math.pow(b2, this.t);
    for (var p = 0; p < params.length; p++) {
      var par = params[p];
      var g = par.g;
      var w = par.w;
      var m = this.m[p];
      var v = this.v[p];
      var wd = (weightDecay && par.decay) ? weightDecay : 0;
      for (var k = 0; k < par.size; k++) {
        var gi = g[k];
        m[k] = b1 * m[k] + (1 - b1) * gi;
        v[k] = b2 * v[k] + (1 - b2) * gi * gi;
        w[k] -= lr * (m[k] / bc1) / (Math.sqrt(v[k] / bc2) + this.eps);
        if (wd) w[k] -= lr * wd * w[k];
      }
    }
  };

  SL.CharTokenizer = CharTokenizer;
  SL.Transformer = Transformer;
  SL.Adam = Adam;
  SL.Param = Param;
  SL.ops = {
    layerNorm: layerNorm,
    layerNormBackward: layerNormBackward,
    gelu: gelu,
    geluBackward: geluBackward,
    causalSoftmax: causalSoftmax,
    causalSoftmaxBackward: causalSoftmaxBackward,
    permuteToHeadMajor: permuteToHeadMajor,
    permuteToTokenMajor: permuteToTokenMajor,
    softmaxCrossEntropy: softmaxCrossEntropy
  };
})(typeof window !== 'undefined' ? window : globalThis);
