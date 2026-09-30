/* ═══════════════════════════════════════════════════════════════════
   dreamer.js — №2  ·  A neural network, from nothing.

   There is no library here. Below is a tape-based autodiff engine, a
   stack of dense layers on top of it, three hand-written optimisers,
   and a little 2-D regression that is trying to reproduce whatever
   you drew. It is about 300 lines and it is the whole thing.

   How learning actually works, in as few words as possible:

     forward   y  = W·x            guess an answer
     loss      L  = (y − t)²       see how wrong it was
     backward  ∂L/∂W = 2(y − t)·∂y/∂W    work out whose fault it was
     step      W -= lr · ∂L/∂W     nudge the guilty weights
     repeat    until bored

   The magic in the middle step is the chain rule. This code
   implements it the way the original 1986 paper described: record
   every operation onto a tape, then walk the tape backwards,
   multiplying the incoming gradient by each operation's own local
   derivative as you go. No magic. Just bookkeeping, applied 1024
   times at a time, 60 times a second.

   Input features per sample:  x, y, sin(3x), cos(3y)
   Layout convention: activations are [samples × features] row-major.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { clamp, lerp, rand, fit, fmt, fmtBig, gateFor, startLoop, pointer, reduced } = SB;

  const GRID = 32;                       // 1024 samples — all it can ever see
  const N = GRID * GRID;
  const IN = 4;                         // x, y, sin 3x, cos 3y
  const BATCH = 168;                    // samples per update (~1/6 of the grid)
  const ACCENT = [94, 224, 200];
  const NEG = [86, 74, 168];
  const BG = [7, 10, 16];

  /* ══════════════════════════════════════════════════════════════
     1.  THE TAPE
     A Tensor is a float array plus, once it is used in a graph, a
     slot for its gradient and a note of who made it.

     One important detail: the graph is built exactly once and then
     reused forever. Allocating half a megabyte of Float32Arrays on
     every training step — which is the obvious way to write this —
     costs more than all the arithmetic. So the tensors below are
     built once, and each step only refills them.
     ══════════════════════════════════════════════════════════════ */
  function tensor(n) {
    return { n, d: new Float32Array(n), g: new Float32Array(n), z: new Float32Array(n) };
  }

  /* ── op: dense layer  y[n,o] = b[o] + Σ_f x[n,f]·W[o,f] ─────────
     W is stored output-major so that both the weight row and the
     input row are contiguous in the innermost loop. The obvious
     [in][out] layout walks memory in strides and runs about 40%
     slower for exactly the same arithmetic. */
  function linearInto(x, y, P) {
    const w = P.w, b = P.b, I = P.IN, O = P.OUT;
    const rows = y.n / O;
    const xd = x.d, yd = y.d;
    for (let n = 0; n < rows; n++) {
      const xo = n * I, yo = n * O;
      for (let o = 0; o < O; o++) {
        const wo = o * I;
        let s = b[o];
        for (let f = 0; f < I; f++) s += xd[xo + f] * w[wo + f];
        yd[yo + o] = s;
      }
    }
  }

  const GAIN = { tanh: 1.0, relu: Math.SQRT2, sine: 1.0, gelu: 1.15, sigmoid: 1.0 };

  /* ── op: elementwise nonlinearity ─────────────────────────────
     Five of them, because which one you pick is the single biggest
     decision in any network: tanh saturates, ReLU dies, sine
     memorises, GELU thinks about it, sigmoid is polite but slow. */
  function activateInto(x, y, kind) {
    const a = x.d, o = y.d, z = y.z;
    if (kind === 0) for (let i = 0; i < x.n; i++) { const v = a[i]; z[i] = v; o[i] = Math.tanh(v); }
    else if (kind === 1) for (let i = 0; i < x.n; i++) { const v = a[i]; z[i] = v; o[i] = v > 0 ? v : 0; }
    else if (kind === 2) for (let i = 0; i < x.n; i++) { const v = a[i]; z[i] = v; o[i] = Math.sin(v); }
    else if (kind === 3) for (let i = 0; i < x.n; i++) {
      const v = a[i]; z[i] = v;
      o[i] = 0.5 * v * (1 + Math.tanh(0.7978845608 * (v + 0.044715 * v * v * v)));
    }
    else for (let i = 0; i < x.n; i++) { const v = a[i]; z[i] = v; o[i] = 1 / (1 + Math.exp(-v)); }
  }

  /* ── op: mean squared error ─────────────────────────────────
     Returns the number. The gradient of an MSE with respect to a
     prediction is just 2·(prediction − truth), divided by however
     many predictions there were. That is the entire derivative. */
  function mse(y, target, count) {
    let s = 0;
    for (let i = 0; i < count; i++) { const e = y.d[i] - target[i]; s += e * e; }
    return s / count;
  }
  function mseGrad(y, target, count, into) {
    const k = 2 / count;
    for (let i = 0; i < count; i++) into[i] = k * (y.d[i] - target[i]);
  }

  /* ══════════════════════════════════════════════════════════════
     2.  BACKWARD — the chain rule, walked in reverse
     ══════════════════════════════════════════════════════════════ */
  /* gradient of one dense layer */
  function linearGrad(x, y, P) {
    const xd = x.d, gx = x.g, gd = y.g, w = P.w, gw = P.gw, gb = P.gb;
    const I = P.IN, O = P.OUT, rows = y.n / O;
    for (let n = 0; n < rows; n++) {
      const xo = n * I, go = n * O;
      for (let o = 0; o < O; o++) {
        const gv = gd[go + o];
        if (gv === 0) continue;
        gb[o] += gv;
        const wo = o * I;
        for (let f = 0; f < I; f++) {
          gw[wo + f] += xd[xo + f] * gv;
          gx[xo + f] += w[wo + f] * gv;
        }
      }
    }
  }

  function actGrad(x, y, kind) {
    const gx = x.g, gd = y.g, z = y.z, d = y.d;
    if (kind === 0) for (let i = 0; i < y.n; i++) gx[i] += gd[i] * (1 - d[i] * d[i]);
    else if (kind === 1) for (let i = 0; i < y.n; i++) if (z[i] > 0) gx[i] += gd[i];
    else if (kind === 2) for (let i = 0; i < y.n; i++) gx[i] += gd[i] * Math.cos(z[i]);
    else if (kind === 3) for (let i = 0; i < y.n; i++) {
      const v = z[i];
      const c = 0.7978845608 * (v + 0.044715 * v * v * v);
      const t2 = Math.tanh(c), s2 = 1 - t2 * t2;
      gx[i] += gd[i] * (0.5 * (1 + t2) + 0.5 * v * s2 * 0.7978845608 * (1 + 3 * 0.044715 * v * v));
    }
    else for (let i = 0; i < y.n; i++) gx[i] += gd[i] * d[i] * (1 - d[i]);
  }

  /* ══════════════════════════════════════════════════════════════
     3.  PARAMETERS AND OPTIMISERS
     ══════════════════════════════════════════════════════════════ */
  function initParams(fanIn, fanOut, kind) {
    const w = new Float32Array(fanIn * fanOut);
    const g = new Float32Array(fanIn * fanOut);
    const s = Math.sqrt(2 / (fanIn + fanOut)) * (GAIN[kind] || 1);
    /* Box–Muller, then scale: a Gaussian, not a uniform. Uniform
       init makes the first few hundred steps suspiciously dead. */
    for (let i = 0; i < w.length; i += 2) {
      const u = Math.max(1e-7, Math.random()), v = Math.random();
      const r = Math.sqrt(-2 * Math.log(u));
      w[i] = r * Math.cos(2 * Math.PI * v) * s;
      if (i + 1 < w.length) w[i + 1] = r * Math.sin(2 * Math.PI * v) * s;
    }
    return { w, gw: g, b: new Float32Array(fanOut), gb: new Float32Array(fanOut), IN: fanIn, OUT: fanOut };
  }

  const OPTS = {
    adam: { b1: 0.9, b2: 0.999, eps: 1e-8 },
    sgd: null,
    momentum: { mu: 0.9 },
  };

  function makeOptimiser(name, params) {
    if (name === 'adam') {
      const st = params.map((P) => ({
        mw: new Float32Array(P.w.length), vw: new Float32Array(P.w.length),
        mb: new Float32Array(P.b.length), vb: new Float32Array(P.b.length),
      }));
      let t = 0;
      return (lr) => {
        t++;
        const c1 = 1 - Math.pow(OPTS.adam.b1, t), c2 = 1 - Math.pow(OPTS.adam.b2, t);
        const { b1, b2, eps } = OPTS.adam;
        for (let i = 0; i < params.length; i++) {
          const P = params[i], S = st[i];
          for (let k = 0; k < P.w.length; k++) {
            const g = P.gw[k];
            S.mw[k] = b1 * S.mw[k] + (1 - b1) * g;
            S.vw[k] = b2 * S.vw[k] + (1 - b2) * g * g;
            P.w[k] -= lr * (S.mw[k] / c1) / (Math.sqrt(S.vw[k] / c2) + eps);
          }
          for (let k = 0; k < P.b.length; k++) {
            const g = P.gb[k];
            S.mb[k] = b1 * S.mb[k] + (1 - b1) * g;
            S.vb[k] = b2 * S.vb[k] + (1 - b2) * g * g;
            P.b[k] -= lr * (S.mb[k] / c1) / (Math.sqrt(S.vb[k] / c2) + eps);
          }
        }
      };
    }
    if (name === 'momentum') {
      const st = params.map((P) => ({ vw: new Float32Array(P.w.length), vb: new Float32Array(P.b.length) }));
      return (lr) => {
        const mu = OPTS.momentum.mu;
        for (let i = 0; i < params.length; i++) {
          const P = params[i], S = st[i];
          for (let k = 0; k < P.w.length; k++) {
            S.vw[k] = mu * S.vw[k] - lr * P.gw[k];
            P.w[k] += S.vw[k];
          }
          for (let k = 0; k < P.b.length; k++) {
            S.vb[k] = mu * S.vb[k] - lr * P.gb[k];
            P.b[k] += S.vb[k];
          }
        }
      };
    }
    return (lr) => {
      for (const P of params) {
        for (let k = 0; k < P.w.length; k++) P.w[k] -= lr * P.gw[k];
        for (let k = 0; k < P.b.length; k++) P.b[k] -= lr * P.gb[k];
      }
    };
  }

/* ══════════════════════════════════════════════════════════════
     4.  THE MODEL
     ══════════════════════════════════════════════════════════════ */
  const input = tensor(N * IN);
  (function fillInputs() {
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const i = gy * GRID + gx;
        const x = (gx / (GRID - 1)) * 2 - 1;
        const y = (gy / (GRID - 1)) * 2 - 1;
        input.d[i * IN + 0] = x;
        input.d[i * IN + 1] = y;
        input.d[i * IN + 2] = Math.sin(x * 3.0);
        input.d[i * IN + 3] = Math.cos(y * 3.0);
      }
    }
  })();

  const Model = {
    depth: 3, width: 24, act: 0, opt: 'adam', lr: 0.012,
    layers: [], nodes: [], step: 0, loss: 1, corrections: 0,

    /* Build the network and its graph, once. Every tensor here lives
       for the lifetime of this architecture. */
    build() {
      this.layers = [];
      let f = IN;
      for (let i = 0; i < this.depth; i++) {
        const out = i === this.depth - 1 ? 1 : this.width;
        this.layers.push(initParams(f, out, i === this.depth - 1 ? 1 : this.act));
        f = out;
      }
      this.nodes = [];
      let nf = IN;
      for (let i = 0; i < this.depth; i++) {
        const out = i === this.depth - 1 ? 1 : this.width;
        const t = tensor(N * out);
        t.prevF = nf; t.isLast = i === this.depth - 1;
        this.nodes.push(t);
        nf = out;
      }
      this.step = 0;
      this.corrections = 0;
    },

    paramCount() {
      return this.layers.reduce((a, P) => a + P.w.length + P.b.length, 0);
    },

    /* one forward pass, in place */
    forward() {
      let x = input;
      const ns = this.nodes;
      for (let i = 0; i < ns.length; i++) {
        linearInto(x, ns[i], this.layers[i]);
        if (!ns[i].isLast) activateInto(ns[i], ns[i], this.act);
        x = ns[i];
      }
      return ns[ns.length - 1];
    },

    /* forward over the whole grid with gradients switched off —
       used to draw the network's answer without disturbing training */
    predict(out) {
      let x = input;
      const ns = this.nodes;
      for (let i = 0; i < ns.length; i++) {
        linearInto(x, ns[i], this.layers[i]);
        if (!ns[i].isLast) activateInto(ns[i], ns[i], this.act);
        x = ns[i];
      }
      out.set(x.d.subarray(0, N));
      return out;
    },

    /* the first hidden layer's opinion about every point in the
       plane, written straight into `out` (units × samples) */
    hiddenFieldInto(out) {
      const P = this.layers[0], H = P.OUT, w = P.w, b = P.b, d = input.d;
      for (let o = 0; o < H; o++) {
        const wo = o * IN;
        const w0 = w[wo], w1 = w[wo + 1], w2 = w[wo + 2], w3 = w[wo + 3];
        const bb = b[o], base = o * N;
        for (let i = 0; i < N; i++) {
          const q = i * 4;
          const v = d[q] * w0 + d[q + 1] * w1 + d[q + 2] * w2 + d[q + 3] * w3 + bb;
          out[base + i] = this.act === 1 ? (v > 0 ? v : 0) : Math.tanh(v);
        }
      }
      return out;
    },
  };
  Model.build();

  /* ══════════════════════════════════════════════════════════════
     5.  THE INTERFACE
     ══════════════════════════════════════════════════════════════ */
  function boot() {
    const section = document.getElementById('dreamer');
    if (!section) return;

    const q = (n) => section.querySelector(n);
    const padT = q('[data-d=target]'), padO = q('[data-d=output]');
    const chart = q('[data-d=curve]'), actsC = q('[data-d=acts]'), wC = q('[data-d=weights]');
    const lossEl = q('[data-d=loss]'), stepEl = q('[data-d=step]'), epEl = q('[data-d=epochs]');
    const netDesc = q('[data-d=netdesc]');
    const hud = q('[data-hud]');

    const ctxT = padT.getContext('2d', { willReadFrequently: true });
    const ctxO = padO.getContext('2d');
    const ctxC = chart.getContext('2d');
    const ctxA = actsC.getContext('2d');
    const ctxW = wC.getContext('2d');

    /* the target lives at low resolution, because that is all the
       network can be told about. Display it sharp; it is only ever
       sampled at GRID² points. */
    const target = new Float32Array(N);
    let brushW = 0.055, tool = 'pen';
    const history = [];
    let marks = [];
    let rate = 0, rateAcc = 0, rateT = performance.now();
    let lastSum = 0, lastMark = 0;

    /* ── drawing ─────────────────────────────────────────────────── */
    function readPad() {
      fit(padT);
      const d = ctxT.getImageData(0, 0, padT.width, padT.height).data;
      /* box-average down to GRID² — this is the network's whole world */
      for (let gy = 0; gy < GRID; gy++) {
        const y0 = Math.floor(gy * padT.height / GRID), y1 = Math.floor((gy + 1) * padT.height / GRID);
        for (let gx = 0; gx < GRID; gx++) {
          const x0 = Math.floor(gx * padT.width / GRID), x1 = Math.floor((gx + 1) * padT.width / GRID);
          let s = 0, c = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * padT.width + x) * 4;
            s += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114); c++;
          }
          target[gy * GRID + gx] = c ? (s / c) / 255 : 0;
        }
      }
      /* A tick on the curve where the visitor changed the subject —
         but readPad() runs on every pointermove, so mark only when
         the drawing has genuinely changed and not more than three
         times a second, or the curve turns into a solid hatch. */
      let sum = 0;
      for (let i = 0; i < N; i += 17) sum += target[i];
      const now = performance.now();
      if (Math.abs(sum - lastSum) > 0.9 && now - lastMark > 350) {
        marks.push(Model.step);
        if (marks.length > 40) marks.shift();
        lastSum = sum; lastMark = now;
      }
    }

    function blankTarget() {
      fit(padT);
      ctxT.fillStyle = '#05070c';
      ctxT.fillRect(0, 0, padT.width, padT.height);
    }

    function drawAt(q2, prev) {
      const X = q2.x * cw(), Y = q2.y * ch();
      ctxT.lineCap = 'round'; ctxT.lineJoin = 'round';
      ctxT.lineWidth = brushW * cw();
      ctxT.strokeStyle = tool === 'erase' ? '#05070c' : '#f2efe8';
      if (prev) { ctxT.moveTo(prev.x * cw(), prev.y * ch()); ctxT.lineTo(X, Y); }
      else { ctxT.moveTo(X, Y); ctxT.lineTo(X + cw() * 0.012, Y + cw() * 0.012); }
      ctxT.stroke();
    }

    /* `prev` has to be remembered: pointer state is always the
       current position, so passing it as its own predecessor draws a
       row of beads instead of a line */
    let penAt = null;
    const ptrT = pointer(padT, {
      onDown() { penAt = { x: ptrT.x, y: ptrT.y }; drawAt(ptrT, null); readPad(); },
      onMove() {
        if (!ptrT.down) return;
        drawAt(ptrT, penAt);
        penAt = { x: ptrT.x, y: ptrT.y };
        readPad();
      },
      onUp() { penAt = null; readPad(); },
    });

    /* ── presets to draw when nobody has ──────────────────────────
       Everything here is deliberately small and legible at 32×32,
       because that is the resolution the network will be shown. */
    const WORDS = ['one', 'ok', 'hi', 'bunny', 'moonshine', 'quasar', '42'];
    const GLYPHS = ['∞', '☾', 'Ω', '∴', '★', '≈', '№1', '⊗', '∿', '☰'];
    const EMOJI = ['🐇', '🌘', '🌀', '✳'];

    /* The 2-D contexts are untransformed, so everything drawn into
       them is in *device* pixels, not CSS pixels. On a phone with a
       2× screen the two differ by a factor of two, and a preset drawn
       in CSS pixels lands in the top-left corner at half size. */
    const cw = () => padT.width;
    const ch = () => padT.height;

    function centred(text, maxFrac, family) {
      /* shrink until the text fits the plate with room to spare */
      let size = maxFrac * cw();
      for (let k = 0; k < 16; k++) {
        ctxT.font = (family || '') + size.toFixed(1) + 'px ' + getComputedStyle(document.body).fontFamily;
        const m = ctxT.measureText(text).width;
        if (m <= cw() * 0.82) return size;
        size *= Math.max(0.5, (cw() * 0.82) / Math.max(m, 1));
      }
      return size;
    }

    function surprise() {
      blankTarget();
      const roll = Math.random();
      ctxT.save();
      ctxT.textAlign = 'center'; ctxT.textBaseline = 'middle';
      ctxT.fillStyle = '#f2efe8';
      let t;
      if (roll < 0.44) { t = WORDS[(Math.random() * WORDS.length) | 0]; centred(t, 0.44); }
      else if (roll < 0.80) { t = GLYPHS[(Math.random() * GLYPHS.length) | 0]; centred(t, 0.80, '400 '); }
      else { t = EMOJI[(Math.random() * EMOJI.length) | 0]; centred(t, 0.72); }
      ctxT.fillText(t, cw() / 2, ch() / 2);
      ctxT.restore();
      readPad();
    }

    q('[data-d=clear]').addEventListener('click', () => { blankTarget(); readPad(); });
    q('[data-d=surprise]').addEventListener('click', surprise);
    q('[data-d=pen]').addEventListener('click', (e) => setTool('pen', e));
    q('[data-d=erase]').addEventListener('click', (e) => setTool('erase', e));
    function setTool(t, e) {
      tool = t;
      q('[data-d=pen]').classList.toggle('on', t === 'pen');
      q('[data-d=erase]').classList.toggle('on', t === 'erase');
    }
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'b') setTool('pen');
      if (k === 'e') setTool('erase');
      if (k === 'r') surprise();
    });

    /* ── colour maps ─────────────────────────────────────────────── */
    function divColor(v) {                       // −1 … +1
      const t = clamp(v, -1, 1);
      const a = Math.abs(t);
      const c = t > 0 ? ACCENT : NEG;
      const base = t > 0 ? BG[0] : BG[0];
      return [
        Math.round(base + (c[0] - base) * a),
        Math.round(base + (c[1] - base) * a),
        Math.round(base + (c[2] - base) * a),
      ];
    }
    function dreamColor(v) {
      const t = clamp(v, 0, 1);
      const k = Math.pow(t, 0.85);
      return [
        Math.round(BG[0] + (232 - BG[0]) * k),
        Math.round(BG[1] + (247 - BG[1]) * k),
        Math.round(BG[2] + (241 - BG[2]) * k),
      ];
    }

    /* an offscreen GRID² image, reused by both blits */
    const small = document.createElement('canvas');
    small.width = GRID; small.height = GRID;
    const smallCtx = small.getContext('2d');
    const imgData = smallCtx.createImageData(GRID, GRID);

    /* one GRID² buffer, blown up to whatever display canvas wants it.
       1024 samples, smooth — the network's answer is a dream of the
       drawing, not a copy of it, and the blur is the point. */
    function blit(canvas, ctx, data, colorFn, bg) {
      const d = imgData.data;
      for (let i = 0; i < N; i++) {
        const c = colorFn(data[i]);
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      }
      smallCtx.putImageData(imgData, 0, 0);
      ctx.fillStyle = 'rgb(' + bg[0] + ',' + bg[1] + ',' + bg[2] + ')';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    }

    /* ── the loss curve ──────────────────────────────────────────── */
    function drawCurve() {
      fit(chart);
      const W = chart.width, H = chart.height;
      const ctx = ctxC;
      ctx.fillStyle = 'rgb(7,10,16)';
      ctx.fillRect(0, 0, W, H);
      const pad = Math.round(W * 0.09);
      const gw = W - pad * 2, gh = H - pad * 2;
      /* log grid: 10⁰ … 10⁻⁴ */
      ctx.strokeStyle = 'rgba(236,231,221,.055)';
      ctx.lineWidth = 1;
      for (let e = 0; e <= 4; e++) {
        const y = pad + gh * (e / 4);
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
        ctx.fillStyle = 'rgba(236,231,221,.28)';
        ctx.font = (W * 0.032) + 'px ui-monospace,monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText('1e-' + e, pad - W * 0.015, y);
      }
      if (history.length < 2) return;
      const n = history.length;
      const X = (i) => pad + (i / (n - 1)) * gw;
      const Y = (v) => {
        const l = clamp(-Math.log10(Math.max(v, 1e-5)) / 4, 0, 1);
        return pad + l * gh;
      };
      /* marks where the visitor changed the subject */
      ctx.strokeStyle = 'rgba(232,163,61,.35)';
      for (const m of marks) {
        const i = Math.round((m / Math.max(1, Model.step)) * (n - 1));
        if (i < 2 || i > n - 2) continue;
        ctx.beginPath(); ctx.moveTo(X(i), pad); ctx.lineTo(X(i), pad + gh); ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(X(0), pad + gh);
      for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(history[i]));
      ctx.lineTo(X(n - 1), pad + gh);
      ctx.closePath();
      const grd = ctx.createLinearGradient(0, pad, 0, pad + gh);
      grd.addColorStop(0, 'rgba(94,224,200,.22)');
      grd.addColorStop(1, 'rgba(94,224,200,0)');
      ctx.fillStyle = grd; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(i), Y(history[i]));
      ctx.strokeStyle = '#5ee0c8'; ctx.lineWidth = Math.max(1, W * 0.0035);
      ctx.stroke();
      const lx = X(n - 1), ly = Y(history[n - 1]);
      ctx.fillStyle = '#5ee0c8';
      ctx.beginPath(); ctx.arc(lx, ly, Math.max(2, W * 0.006), 0, 6.2832); ctx.fill();
    }

    /* ── the neuron panels ───────────────────────────────────────── */
    let actBuf = null;
    const tile = document.createElement('canvas');
    const tileCtx = tile.getContext('2d');
    function drawActs() {
      fit(actsC);
      const W = actsC.width, H = actsC.height;
      ctxA.fillStyle = 'rgb(7,10,16)'; ctxA.fillRect(0, 0, W, H);
      const Hn = Model.layers[0].OUT;
      const cols = Math.max(1, Math.round(Math.sqrt(Hn * (W / H))));
      const rows = Math.ceil(Hn / cols);
      const cw = Math.floor(W / cols), ch = Math.floor(H / rows);
      const res = clamp(Math.round(Math.min(cw, ch)), 8, GRID);
      if (!actBuf || actBuf.length !== Hn * N) actBuf = new Float32Array(Hn * N);
      Model.hiddenFieldInto(actBuf);
      /* each unit gets its own contrast, otherwise one loud neuron
         decides what all the others look like */
      const gain = new Float32Array(Hn);
      for (let u = 0; u < Hn; u++) {
        let m = 1e-4;
        const base = u * N;
        for (let i = 0; i < N; i++) { const a = Math.abs(actBuf[base + i]); if (a > m) m = a; }
        gain[u] = 1 / m;
      }
      tile.width = res; tile.height = res;
      const img = tileCtx.createImageData(res, res);
      const d = img.data;
      for (let u = 0; u < Hn; u++) {
        const cx = (u % cols) * cw, cy = ((u / cols) | 0) * ch;
        const g = gain[u];
        for (let y = 0; y < res; y++) {
          const gy = Math.min(GRID - 1, (y * GRID / res) | 0);
          for (let x = 0; x < res; x++) {
            const gx = Math.min(GRID - 1, (x * GRID / res) | 0);
            const c = divColor(actBuf[u * N + gy * GRID + gx] * g);
            const i = (y * res + x) * 4;
            d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i * 4 + 3] = 255;
            d[i + 3] = 255;
          }
        }
        tileCtx.putImageData(img, 0, 0);
        ctxA.imageSmoothingEnabled = true;
        ctxA.drawImage(tile, cx + 1, cy + 1, cw - 2, ch - 2);
        ctxA.fillStyle = 'rgba(236,231,221,.20)';
        ctxA.font = (Math.min(cw, ch) * 0.17) + 'px ui-monospace,monospace';
        ctxA.textAlign = 'left'; ctxA.textBaseline = 'top';
        ctxA.fillText(String(u), cx + 4, cy + 3);
      }
    }

    /* ── the weight matrices ─────────────────────────────────────── */
    const wtile = document.createElement('canvas');
    const wtileCtx = wtile.getContext('2d');
    function drawWeights() {
      fit(wC);
      const W = wC.width, H = wC.height;
      ctxW.fillStyle = 'rgb(7,10,16)'; ctxW.fillRect(0, 0, W, H);
      const layers = Model.layers;
      const shown = layers.slice(0, 2);
      const widths = shown.map((P) => clamp(P.IN * 15, 26, W * 0.28));
      let x = (W - (widths.reduce((a, b) => a + b, 0) + 28 * (shown.length - 1))) / 2;
      for (let li = 0; li < shown.length; li++) {
        const P = shown[li];
        const mw = widths[li], mh = H - 24;
        const rows = P.IN, cols = P.OUT;
        let peak = 1e-6;
        for (let k = 0; k < P.w.length; k++) peak = Math.max(peak, Math.abs(P.w[k]));
        wtile.width = cols; wtile.height = rows;
        const img = wtileCtx.createImageData(cols, rows);
        const d = img.data;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const col = divColor(P.w[r * cols + c] / peak);
          const i = (r * cols + c) * 4;
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
        }
        wtileCtx.putImageData(img, 0, 0);
        ctxW.imageSmoothingEnabled = true;
        ctxW.drawImage(wtile, x, 6, mw, mh);
        /* biases, as a thin strip beside each matrix */
        for (let c = 0; c < cols; c++) {
          const col = divColor(P.b[c] / peak);
          ctxW.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
          ctxW.fillRect(x + mw + 3, 6 + (1 - 0.5 - P.b[c] / peak * 0.5) * mh, 6, mh / cols);
        }
        ctxW.fillStyle = 'rgba(236,231,221,.10)';
        ctxW.fillRect(x + mw + 3, 6, 1, mh);
        ctxW.fillStyle = 'rgba(236,231,221,.42)';
        ctxW.font = (H * 0.05) + 'px ui-monospace,monospace';
        ctxW.textAlign = 'left'; ctxW.textBaseline = 'bottom';
        ctxW.fillText('W' + (li + 1) + '   ' + P.IN + '→' + P.OUT + '   bias →', x, H - 4);
        x += mw + 28;
      }
    }

    /* ── one training step ───────────────────────────────────────
       Only BATCH of the N points are shown to it each time. Using
       all N costs proportionally more for an answer that is no less
       correct; a random slice is both cheaper and, on a smooth
       function like this one, effectively just as good. It is the
       same reason nobody re-reads a whole book to find a typo. */
    let optimiser = makeOptimiser('adam', Model.layers);

    const pick = new Int32Array(N);
    for (let i = 0; i < N; i++) pick[i] = i;
    function reshuffle() {
      for (let i = N - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = pick[i]; pick[i] = pick[j]; pick[j] = t;
      }
    }
    let cursor = 0;

    /* batch scratch space, re-cut whenever the architecture changes */
    let batchIn, batchInG, batchTgt, scratch;
    function allocScratch() {
      batchIn = new Float32Array(BATCH * IN);
      batchInG = new Float32Array(BATCH * IN);
      batchTgt = new Float32Array(BATCH);
      scratch = Model.layers.map((P, i) => ({
        n: BATCH * P.OUT,
        isLast: i === Model.layers.length - 1,
        d: new Float32Array(BATCH * P.OUT),
        g: new Float32Array(BATCH * P.OUT),
        z: new Float32Array(BATCH * P.OUT),
      }));
      cursor = 0;
    }
    allocScratch();

    function trainStep(lr) {
      if (cursor + BATCH > N) { reshuffle(); cursor = 0; }
      const B = BATCH, L = Model.layers, ns = Model.nodes;

      for (let k = 0; k < B; k++) {
        const s = pick[cursor + k], d = k * IN, q = s * IN;
        batchIn[d] = input.d[q]; batchIn[d + 1] = input.d[q + 1];
        batchIn[d + 2] = input.d[q + 2]; batchIn[d + 3] = input.d[q + 3];
        batchTgt[k] = target[s];
      }
      cursor += B;

      /* forward, on the batch */
      let x = scratch[0], prev = { d: batchIn, g: batchInG };
      for (let i = 0; i < ns.length; i++) {
        linearInto(prev, scratch[i], L[i]);
        if (!scratch[i].isLast) activateInto(scratch[i], scratch[i], Model.act);
        prev = scratch[i];
      }
      const yOut = scratch[ns.length - 1];

      /* blame — walk the chain backwards, multiplying by each
         operation's own local derivative as we go */
      for (const P of L) { P.gw.fill(0); P.gb.fill(0); }
      for (const s of scratch) s.g.fill(0);
      batchInG.fill(0);
      mseGrad(yOut, batchTgt, B, yOut.g);
      for (let i = ns.length - 1; i >= 0; i--) {
        if (!scratch[i].isLast) actGrad(scratch[i], scratch[i], Model.act);
        linearGrad(i === 0 ? { d: batchIn, g: batchInG } : scratch[i - 1], scratch[i], L[i]);
      }

      /* apologise */
      optimiser(lr);
      Model.step++;

      /* honest bookkeeping: count the multiply-accumulates we did */
      let c = 0;
      for (const P of L) c += 2 * B * P.IN * P.OUT + B * P.OUT;
      Model.corrections += c;
    }

    function rebuild(next) {
      Object.assign(Model, next);
      Model.build();
      allocScratch();
      optimiser = makeOptimiser(Model.opt, Model.layers);
      actBuf = null;
    }

    /* ── wire it to the shared panel ─────────────────────────────── */
    const PRESETS = {
      tiny:     { depth: 2, width: 12 },
      small:    { depth: 3, width: 24 },
      wide:     { depth: 3, width: 40 },
      deep:     { depth: 4, width: 28 },
      adam:     { opt: 'adam' },
      sgd:      { opt: 'sgd' },
      momentum: { opt: 'momentum' },
    };
    const state = { depth: 3, width: 24, lr: 0.012, thrash: 10 };
    const inst = SB.ui.register(section, {
      params: state,
      presets: PRESETS,
      onPreset(name, p) {
        if (p.opt) { Model.opt = p.opt; optimiser = makeOptimiser(p.opt, Model.layers); return; }
        rebuild({ depth: p.depth, width: p.width, act: Model.act, opt: Model.opt });
        history.length = 0; marks = []; Model.loss = 1;
      },
      onChange(p) {
        if (p.depth !== Model.depth || p.width !== Model.width) {
          rebuild({ depth: p.depth, width: p.width, act: Model.act, opt: Model.opt });
          history.length = 0; marks = []; Model.loss = 1;
        }
        Model.lr = p.lr;
      },
      status() {
        return fmtBig(Model.paramCount()) + ' weights · ' + fmtBig(Model.corrections) + ' corrections';
      },
    });
    section.dataset.source = 'assets/js/dreamer.js';

    /* ── go ──────────────────────────────────────────────────────── */
    blankTarget();
    surprise();
    history.length = 0;

    const gate = gateFor(section, () => {});
    let frameN = 0, last = new Float32Array(N);

    startLoop((ts, dt) => {
      if (!gate.visible) return;
      const budget = clamp(inst.params.thrash, 1, 16);

      /* ── learn, for a fixed slice of wall-clock time ──
         The budget, not a step count, so the page stays at 60fps
         whether the network is 2×12 or 3×48. */
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < budget) { trainStep(Model.lr); n++; }

      /* ── ask it for its answer, and measure it properly.
         One full pass over all N points: an honest, smooth error
         figure and the picture, in one go. Not every frame — that
         pass is a third of a training step and the picture is blurry
         anyway. */
      frameN++;
      if (frameN % 3 === 1) {
        const y = Model.forward();
        Model.loss = mse(y, target, N);
        last.set(y.d.subarray(0, N));
        history.push(Model.loss);
        if (history.length > 3000) history.shift();
      }

      rateAcc += n;
      if (performance.now() - rateT > 500) {
        rate = rateAcc / ((performance.now() - rateT) / 1000);
        rateAcc = 0; rateT = performance.now();
      }

      /* ── show it ── */
      if (frameN % 3 === 0) {
        blit(padO, ctxO, last, dreamColor, BG);
        drawCurve();
      }
      if (frameN % 5 === 1) drawActs();
      if (frameN % 9 === 1) drawWeights();

      if (frameN % 5 === 0) {
        lossEl.textContent = Model.loss.toExponential(2);
        stepEl.textContent = 'step ' + fmtBig(Model.step);
        epEl.textContent = fmtBig(Model.step) + ' steps · sees ' + GRID + '×' + GRID;
        if (netDesc) {
          netDesc.textContent = Model.depth + ' layers, ' + Model.width +
            ' wide → 1 output · ' + fmtBig(Model.paramCount()) + ' weights';
        }
        if (hud) {
          hud.textContent =
            fmtBig(Model.paramCount()) + ' weights\n' +
            fmtBig(Model.corrections) + ' corrections\n' +
            fmt(rate, 0) + ' steps / s\n' +
            GRID + '×' + GRID + ' samples · batch ' + BATCH + '\n' +
            fmt(SB.fpsNow(), 0) + ' fps';
        }
      }
    });

    window.addEventListener('resize', () => { drawActs(); drawWeights(); drawCurve(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();