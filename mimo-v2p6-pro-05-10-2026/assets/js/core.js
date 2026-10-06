(function (global) {
  'use strict';
  var SL = global.SL || (global.SL = {});

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function fmt(x, digits) {
    if (!isFinite(x)) return '—';
    if (digits === undefined) digits = 3;
    return x.toFixed(digits);
  }

  function fmtInt(x) {
    return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' kB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function fmtTime(ms) {
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(2) + ' s';
    var m = Math.floor(ms / 60000);
    var s = Math.round((ms % 60000) / 1000);
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c === null || c === undefined) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    return function () { target.removeEventListener(type, fn, opts); };
  }

  function storageGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function matmulNN(out, A, B, m, k, n, aOff, bOff, outOff) {
    aOff = aOff | 0; bOff = bOff | 0; outOff = outOff | 0;
    for (var i = 0; i < m; i++) {
      var ao = aOff + i * k;
      var co = outOff + i * n;
      for (var j = 0; j < n; j++) out[co + j] = 0;
      for (var p = 0; p < k; p++) {
        var a = A[ao + p];
        if (a === 0) continue;
        var bo = bOff + p * n;
        for (var q = 0; q < n; q++) out[co + q] += a * B[bo + q];
      }
    }
  }

  function matmulNT(out, A, B, m, k, n, aOff, bOff, outOff) {
    aOff = aOff | 0; bOff = bOff | 0; outOff = outOff | 0;
    for (var i = 0; i < m; i++) {
      var ao = aOff + i * k;
      var co = outOff + i * n;
      for (var j = 0; j < n; j++) {
        var bo = bOff + j * k;
        var s = 0;
        for (var p = 0; p < k; p++) s += A[ao + p] * B[bo + p];
        out[co + j] = s;
      }
    }
  }

  function matmulTN(out, A, B, m, k, n, aOff, bOff, outOff) {
    aOff = aOff | 0; bOff = bOff | 0; outOff = outOff | 0;
    for (var i = 0; i < m; i++) {
      var co = outOff + i * n;
      for (var j = 0; j < n; j++) out[co + j] = 0;
    }
    for (var p = 0; p < k; p++) {
      var ao = aOff + p * m;
      var bo = bOff + p * n;
      for (var i2 = 0; i2 < m; i2++) {
        var a = A[ao + i2];
        if (a === 0) continue;
        var co2 = outOff + i2 * n;
        for (var j2 = 0; j2 < n; j2++) out[co2 + j2] += a * B[bo + j2];
      }
    }
  }

  function bmmNN(out, A, B, m, k, n, batches, aStride, bStride, outStride) {
    for (var b = 0; b < batches; b++) {
      matmulNN(out, A, B, m, k, n, b * aStride, b * bStride, b * outStride);
    }
  }

  function bmmNT(out, A, B, m, k, n, batches, aStride, bStride, outStride) {
    for (var b = 0; b < batches; b++) {
      matmulNT(out, A, B, m, k, n, b * aStride, b * bStride, b * outStride);
    }
  }

  function bmmTN(out, A, B, m, k, n, batches, aStride, bStride, outStride) {
    for (var b = 0; b < batches; b++) {
      matmulTN(out, A, B, m, k, n, b * aStride, b * bStride, b * outStride);
    }
  }

  function addInPlace(dst, src, n) {
    for (var i = 0; i < n; i++) dst[i] += src[i];
  }

  function addScaledInPlace(dst, src, scale, n) {
    for (var i = 0; i < n; i++) dst[i] += src[i] * scale;
  }

  function colSum(out, A, rows, cols) {
    for (var j = 0; j < cols; j++) out[j] = 0;
    for (var i = 0; i < rows; i++) {
      var off = i * cols;
      for (var j2 = 0; j2 < cols; j2++) out[j2] += A[off + j2];
    }
  }

  function transposeSquare(out, A, n) {
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) out[i * n + j] = A[j * n + i];
    }
  }

  function softmaxRows(out, inp, rows, cols, causal, masked) {
    for (var i = 0; i < rows; i++) {
      var off = i * cols;
      var limit = cols;
      if (causal) {
        var rowIndex = masked[i];
        limit = rowIndex + 1;
        for (var j = limit; j < cols; j++) out[off + j] = 0;
      }
      var max = -Infinity;
      for (var j2 = 0; j2 < limit; j2++) {
        var v = inp[off + j2];
        if (v > max) max = v;
      }
      var sum = 0;
      for (var j3 = 0; j3 < limit; j3++) {
        var e = Math.exp(inp[off + j3] - max);
        out[off + j3] = e;
        sum += e;
      }
      var inv = sum > 0 ? 1 / sum : 0;
      for (var j4 = 0; j4 < limit; j4++) out[off + j4] *= inv;
    }
  }

  function logSoftmaxLoss(logits, targets, rows, cols) {
    var total = 0;
    for (var i = 0; i < rows; i++) {
      var off = i * cols;
      var max = -Infinity;
      for (var j = 0; j < cols; j++) {
        var v = logits[off + j];
        if (v > max) max = v;
      }
      var sum = 0;
      for (var j2 = 0; j2 < cols; j2++) sum += Math.exp(logits[off + j2] - max);
      var logProb = logits[off + targets[i]] - max - Math.log(sum);
      total -= logProb;
    }
    return total / rows;
  }

  function argmaxRow(logits, rows, cols) {
    var out = new Int32Array(rows);
    for (var i = 0; i < rows; i++) {
      var off = i * cols;
      var best = 0;
      var bv = logits[off];
      for (var j = 1; j < cols; j++) {
        var v = logits[off + j];
        if (v > bv) { bv = v; best = j; }
      }
      out[i] = best;
    }
    return out;
  }

  function sampleFromLogits(logits, cols, opts, rng) {
    var temperature = opts && opts.temperature !== undefined ? opts.temperature : 1;
    var topK = opts && opts.topK !== undefined ? opts.topK : 0;
    var topP = opts && opts.topP !== undefined ? opts.topP : 1;
    var repPenalty = opts && opts.repPenalty !== undefined ? opts.repPenalty : 0;
    var recent = opts && opts.recent ? opts.recent : null;
    var idx = new Int32Array(cols);
    var scores = new Float64Array(cols);
    for (var i = 0; i < cols; i++) { idx[i] = i; scores[i] = logits[i]; }
    if (recent && repPenalty > 0) {
      for (var r = 0; r < recent.length; r++) {
        var rid = recent[r];
        if (rid >= 0 && rid < cols) scores[rid] -= repPenalty;
      }
    }
    if (temperature > 0 && temperature !== 1) {
      var inv = 1 / temperature;
      for (var i2 = 0; i2 < cols; i2++) scores[i2] *= inv;
    } else if (temperature <= 0) {
      var best = 0;
      for (var i3 = 1; i3 < cols; i3++) if (scores[i3] > scores[best]) best = i3;
      return best;
    }
    var order = Array.prototype.slice.call(idx);
    order.sort(function (a, b) { return scores[b] - scores[a]; });
    if (topK > 0 && topK < order.length) order.length = topK;
    if (topP < 1) {
      var max = -Infinity;
      for (var i4 = 0; i4 < order.length; i4++) if (scores[order[i4]] > max) max = scores[order[i4]];
      var exps = new Float64Array(order.length);
      var sum = 0;
      for (var i5 = 0; i5 < order.length; i5++) {
        var e = Math.exp(scores[order[i5]] - max);
        exps[i5] = e;
        sum += e;
      }
      var cum = 0;
      var cut = order.length;
      for (var i6 = 0; i6 < order.length; i6++) {
        cum += exps[i6] / sum;
        if (cum >= topP) { cut = i6 + 1; break; }
      }
      order.length = cut;
      sum = 0;
      for (var i7 = 0; i7 < order.length; i7++) sum += exps[i7];
      var r = rng() * sum;
      var acc = 0;
      for (var i8 = 0; i8 < order.length; i8++) {
        acc += exps[i8];
        if (r <= acc) return order[i8];
      }
      return order[order.length - 1];
    }
    var probs = new Float64Array(order.length);
    var total = 0;
    for (var i9 = 0; i9 < order.length; i9++) {
      var p = Math.exp(scores[order[i9]]);
      probs[i9] = p;
      total += p;
    }
    var rr = rng() * total;
    var a2 = 0;
    for (var i10 = 0; i10 < order.length; i10++) {
      a2 += probs[i10];
      if (rr <= a2) return order[i10];
    }
    return order[order.length - 1];
  }

  function globalNorm(arrays) {
    var s = 0;
    for (var i = 0; i < arrays.length; i++) {
      var a = arrays[i];
      for (var j = 0; j < a.length; j++) s += a[j] * a[j];
    }
    return Math.sqrt(s);
  }

  SL.rng = { mulberry32: mulberry32, gaussian: gaussian };
  SL.math = {
    clamp: clamp,
    lerp: lerp,
    matmulNN: matmulNN,
    matmulNT: matmulNT,
    matmulTN: matmulTN,
    bmmNN: bmmNN,
    bmmNT: bmmNT,
    bmmTN: bmmTN,
    addInPlace: addInPlace,
    addScaledInPlace: addScaledInPlace,
    colSum: colSum,
    transposeSquare: transposeSquare,
    softmaxRows: softmaxRows,
    logSoftmaxLoss: logSoftmaxLoss,
    argmaxRow: argmaxRow,
    sampleFromLogits: sampleFromLogits,
    globalNorm: globalNorm
  };
  SL.util = {
    fmt: fmt,
    fmtInt: fmtInt,
    fmtBytes: fmtBytes,
    fmtTime: fmtTime,
    el: el,
    on: on,
    storageGet: storageGet,
    storageSet: storageSet
  };
  if (typeof document !== 'undefined') {
    SL.util.$ = $;
    SL.util.$$ = $$;
  }
})(typeof window !== 'undefined' ? window : globalThis);
