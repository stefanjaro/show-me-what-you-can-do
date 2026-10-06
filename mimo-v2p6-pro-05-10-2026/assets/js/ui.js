(function (global) {
  'use strict';
  var SL = global.SL;
  var U = SL.util;
  var V = SL.viz;

  var state = {
    bookId: 'reader',
    preset: 'standard',
    dataset: null,
    model: null,
    trainer: null,
    optimizer: null,
    voice: [],
    voicePos: 0,
    snapshots: [],
    lastAttn: 0,
    lastEmb: 0,
    dirty: {
      loss: true, attn: true, emb: true, logits: true, metrics: true, timeline: true
    },
    attnText: 'There was once a map maker',
    prompt: 'A map is not a country. A map is',
    startedAt: Date.now()
  };

  function $(id) { return document.getElementById(id); }

  function fmt(n, d) { return SL.util.fmt(n, d); }

  function decodeWeights(model, ckpt) {
    if (!ckpt || !ckpt.weights) return false;
    var names = Object.keys(ckpt.weights);
    if (names.length !== model.params.length) return false;
    var byName = {};
    for (var i = 0; i < model.params.length; i++) byName[model.params[i].name] = model.params[i];
    for (var j = 0; j < names.length; j++) {
      var p = byName[names[j]];
      if (!p) return false;
      var scale = ckpt.scales[names[j]];
      var bin = atob(ckpt.weights[names[j]]);
      if (bin.length !== p.size) return false;
      for (var k = 0; k < p.size; k++) p.w[k] = (bin.charCodeAt(k) > 127 ? bin.charCodeAt(k) - 256 : bin.charCodeAt(k)) * scale;
    }
    return true;
  }

  function currentProbe() {
    var probes = SL.corpus.probeFor(state.bookId);
    return probes[0];
  }

  function onTrainStep(trainer) {
    state.dirty.loss = true;
    state.dirty.metrics = true;
    if (trainer.step % 12 === 0) state.dirty.emb = true;
    if (trainer.step % 40 === 0) {
      lossCurve.push(trainer.step, trainer.lossEma || trainer.loss, trainer.valLoss);
    } else {
      lossCurve.push(trainer.step, trainer.lossEma || trainer.loss);
    }
  }

  function rebuildModel(opts) {
    opts = opts || {};
    if (state.trainer) state.trainer.dispose();
    var preset = SL.presets[state.preset];
    var data = state.dataset;
    var config = {
      vocab: data.tokenizer.vocab,
      dim: preset.dim,
      heads: preset.heads,
      layers: preset.layers,
      block: preset.block,
      hidden: preset.hidden,
      dtype: 'f32',
      seed: opts.seed || 1337
    };
    state.model = new SL.Transformer(config);
    var ckpt = null;
    if (SL.checkpoints && SL.checkpoints[state.bookId] && state.preset === 'standard') {
      ckpt = SL.checkpoints[state.bookId];
      if (ckpt.config && ckpt.config.vocab === config.vocab) {
        decodeWeights(state.model, ckpt);
      } else {
        ckpt = null;
      }
    }
    var probes = SL.corpus.probeFor(state.bookId);
    state.trainer = new SL.Trainer({
      model: state.model,
      tokens: data.tokens,
      batch: 12,
      microbatch: 4,
      accum: 1,
      block: preset.block,
      lrMax: 2e-3,
      lrMin: 2e-4,
      warmup: 40,
      decaySteps: 2200,
      snapshotEvery: 220,
      seed: 2026,
      tokenizer: data.tokenizer,
      probe: probes[0].prompt,
      sampleTemp: 0.65,
      onStep: onTrainStep,
      onSnapshot: function (snap) {
        state.snapshots.push(snap);
        state.dirty.timeline = true;
      }
    });
    if (ckpt && ckpt.snapshots && ckpt.snapshots.length) {
      state.snapshots = ckpt.snapshots.map(function (s) {
        return { step: s.step, loss: s.loss, text: s.texts[0], recorded: true };
      });
    } else {
      state.snapshots = [];
    }
    state.voice = [];
    state.voicePos = 0;
    state.dirty.loss = true;
    state.dirty.attn = true;
    state.dirty.emb = true;
    state.dirty.logits = true;
    state.dirty.metrics = true;
    state.dirty.timeline = true;
    lossCurve.reset();
    if (ckpt && ckpt.losses && ckpt.losses.length) {
      var stride = Math.max(1, Math.floor(ckpt.losses.length / 700));
      for (var s = 0; s < ckpt.losses.length; s += stride) {
        lossCurve.push(s, ckpt.losses[s]);
      }
      lossCurve.push(ckpt.losses.length - 1, ckpt.losses[ckpt.losses.length - 1]);
      state.trainer.step = ckpt.losses.length;
      state.trainer.loss = ckpt.losses[ckpt.losses.length - 1];
      state.trainer.lossEma = state.trainer.loss;
    }
    state.checkpoint = ckpt;
    state.trainer.evaluate();
    return ckpt;
  }

  function setBook(id) {
    state.bookId = id;
    var book = SL.corpus.byId(id);
    var text;
    if (id === 'custom') {
      text = $('custom-text').value || '';
      if (text.length < 400) return false;
    } else {
      text = book.text;
    }
    state.dataset = SL.corpus.build(text);
    rebuildModel();
    syncBookPlate();
    seedPrompts();
    $('hero-text').innerHTML = '<span class="dim">waking the machine</span><span class="caret"></span>';
    state.voice = [];
    state.voicePos = 0;
    state.voiceLen = 0;
    speakNow();
    return true;
  }

  function syncBookPlate() {
    var book = SL.corpus.byId(state.bookId);
    var data = state.dataset;
    var ckpt = SL.checkpoints && SL.checkpoints[state.bookId];
    if (ckpt && ckpt.steps) {
      $('build-stamp').textContent = 'trained offline · ' + U.fmtInt(ckpt.steps) + ' steps · ' + ckpt.minutes + ' min';
    } else {
      $('build-stamp').textContent = 'trained in this tab';
    }
    $('book-title').textContent = book ? book.title : 'Your own text';
    $('book-chars').textContent = U.fmtInt(data.text.length);
    $('book-vocab').textContent = U.fmtInt(data.tokenizer.vocab);
    $('book-steps').textContent = ckpt ? U.fmtInt(ckpt.steps) + ' (offline)' : 'live';
    $('book-size').textContent = U.fmtInt(state.model.paramCount());
    $('essay-chars').textContent = U.fmtInt(data.text.length) + ' characters';
    $('essay-vocab').textContent = data.tokenizer.vocab + ' letters, spaces and marks';
    $('essay-params').textContent = U.fmtInt(state.model.paramCount());
    $('m-params').textContent = U.fmtInt(state.model.paramCount());
    $('h-params').textContent = U.fmtInt(state.model.paramCount());
    $('colophon-machine').innerHTML =
      'transformer · char-level tokenizer · ' + state.model.layers + ' blocks<br>' +
      state.model.heads + ' attention heads · ' + state.model.dim + ' dimensions<br>' +
      'adamw · cosine schedule · global grad clip';
  }

  function pushVoice(text) {
    state.voice.push(text);
    while (state.voice.length > 12) state.voice.shift();
  }

  function typeVoice() {
    var el = $('hero-text');
    if (state.voicePos < state.voice.length) {
      var cur = state.voice[state.voicePos];
      if (cur.length < 4) {
        state.voicePos++;
        return;
      }
      var head = state.voice.slice(0, state.voicePos).join('');
      var shown = cur.slice(0, state.voiceLen || 0);
      state.voiceLen = (state.voiceLen || 0) + 3;
      if (state.voiceLen >= cur.length) {
        state.voiceLen = 0;
        state.voicePos++;
      }
      el.innerHTML = escapeHtml(head + shown) + '<span class="caret"></span>';
    } else if (state.voice.length) {
      el.innerHTML = escapeHtml(state.voice.join('')) + '<span class="caret"></span>';
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  function speakNow() {
    if (!state.model || !state.dataset) return;
    var probe = currentProbe();
    var rng = SL.rng.mulberry32((Date.now() % 100000) | 0);
    var savedB = state.model._B, savedT = state.model._T;
    var ids = state.dataset.tokenizer.encode(probe.prompt);
    var gen = state.model.generate(ids, 220, {
      temperature: 0.62, topK: 5, topP: 0.92, repPenalty: 0.18
    }, rng);
    state.model.ensureShape(savedB, savedT);
    pushVoice(probe.prompt + state.dataset.tokenizer.decode(gen) + '\n\n');
  }

  function updateMetrics() {
    var t = state.trainer;
    if (!t) return;
    $('m-step').textContent = U.fmtInt(t.step);
    $('h-step').textContent = U.fmtInt(t.step);
    var loss = t.lossEma || t.loss;
    $('m-loss').textContent = isFinite(loss) ? loss.toFixed(3) : '—';
    $('h-loss').textContent = isFinite(loss) ? loss.toFixed(3) : '—';
    $('m-val').textContent = isFinite(t.valLoss) && t.valLoss > 0 ? t.valLoss.toFixed(3) : '—';
    $('h-val').textContent = isFinite(t.valLoss) && t.valLoss > 0 ? t.valLoss.toFixed(3) : '—';
    $('m-tps').textContent = t.tokensPerSec > 0 ? U.fmtInt(t.tokensPerSec) : '—';
    $('h-tps').textContent = t.tokensPerSec > 0 ? U.fmtInt(t.tokensPerSec) : '—';
    var lr = SL.trainUtil.lrAt(t.step, t);
    $('m-lr').textContent = lr.toExponential(1);
    $('train-mode').textContent = t.mode();
    var ema = t.lossEma;
    $('essay-loss').textContent = isFinite(ema) && ema > 0
      ? ('currently ' + ema.toFixed(3) + ' nats per letter')
      : 'a number that falls as the mind sharpens';
    $('voice-status').textContent = t.running
      ? 'the mind is dreaming its book'
      : 'the mind is resting';
  }

  function renderTimeline() {
    var box = $('timeline');
    box.innerHTML = '';
    var items = state.snapshots.slice(-14);
    if (!items.length) {
      var note = document.createElement('div');
      note.className = 'mini-note';
      note.textContent = 'Snapshots appear as the model trains.';
      box.appendChild(note);
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      var card = document.createElement('div');
      card.className = 'snap' + (i === 0 ? ' origin' : '');
      var head = document.createElement('div');
      head.className = 'step';
      var a = document.createElement('span');
      a.textContent = 'step ' + U.fmtInt(s.step);
      var b = document.createElement('span');
      b.textContent = 'loss ' + (s.loss !== undefined ? s.loss.toFixed(3) : '—');
      head.appendChild(a);
      head.appendChild(b);
      var txt = document.createElement('div');
      txt.className = 'txt';
      txt.textContent = s.text.replace(/\n/g, ' ¶ ');
      card.appendChild(head);
      card.appendChild(txt);
      card.addEventListener('click', function () {
        $('prompt-input').value = s.text.split('\n').join(' ').slice(0, 160);
        state.dirty.logits = true;
        $('prompt-input').scrollIntoView({ block: 'center' });
      });
      card.title = 'click to load this moment into the playground';
      box.appendChild(card);
    }
    box.scrollLeft = box.scrollWidth;
  }

  function renderPipeline() {
    var box = $('pipeline');
    if (box.childNodes.length) return;
    var stages = [
      ['tokens', 'The sentence is cut into letters. Each letter gets an index in a small vocabulary.'],
      ['embedding', 'Each index is exchanged for a list of learned numbers — a home in a space of ' + (state.model ? state.model.dim : 64) + ' dimensions — and the position is added.'],
      ['attention', 'Every letter looks back at the letters before it and decides how much to listen. This is where clauses get tied together.'],
      ['mlp', 'Each position, alone, rewrites what it has heard. Two matrices and a bend between them.'],
      ['logits', 'The final numbers are turned into one score per possible letter. Softmax turns the scores into probabilities.']
    ];
    for (var i = 0; i < stages.length; i++) {
      (function (st) {
        var chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = st[0];
        chip.addEventListener('click', function () {
          $('pipeline-note').textContent = st[1];
        });
        box.appendChild(chip);
      })(stages[i]);
    }
    $('pipeline-note').textContent = stages[1][1];
  }


  function readSurprise() {
    if (!state.model || !state.dataset) return;
    var tok = state.dataset.tokenizer;
    var T = state.model.block;
    var start = Math.min(state.dataset.tokens.length - T - 1, Math.max(0, state.surpriseOffset || 0));
    var idx = new Int32Array(T), tg = new Int32Array(T);
    for (var t = 0; t < T; t++) {
      idx[t] = state.dataset.tokens[start + t];
      tg[t] = state.dataset.tokens[start + t + 1];
    }
    var savedB = state.model._B, savedT = state.model._T;
    state.model.ensureShape(1, T);
    state.model.forward(idx, tg);
    var Vv = state.model.vocab;
    var cells = [];
    var chars = [];
    var segs = [];
    var cur = '';
    var curLoss = 0;
    for (var i = 0; i < T; i++) {
      var p = state.model._acts.probs[i * Vv + tg[i]];
      var l = -Math.log(Math.max(p, 1e-9));
      cells.push(l);
      var ch = tok.itos[idx[i]];
      chars.push(ch);
      cur += ch;
      curLoss += l;
      if (ch === ' ' || ch === '\n' || cur.length > 34) {
        segs.push({ text: cur, loss: curLoss / Math.max(1, cur.length) });
        cur = '';
        curLoss = 0;
      }
    }
    if (cur) segs.push({ text: cur, loss: curLoss / Math.max(1, cur.length) });
    state.model.ensureShape(savedB, savedT);
    surpriseStrip.set(chars, cells);
    surpriseStrip.draw();
    segs.sort(function (a, b) { return b.loss - a.loss; });
    var box = $('surprise-list');
    box.innerHTML = '';
    for (var k = 0; k < Math.min(4, segs.length); k++) {
      var line = document.createElement('div');
      line.style.margin = '0.55rem 0';
      line.innerHTML = '<b style="color:var(--amber)">' + segs[k].loss.toFixed(2) + '</b> &nbsp;' +
        String(segs[k].text).replace(/[&<>]/g, function (c) {
          return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
        });
      box.appendChild(line);
    }
    state.surpriseOffset = (start + T) % Math.max(1, state.dataset.tokens.length - T - 1);
    state.dirty.loss = true;
  }

  function drawAttention() {
    if (!state.model || !state.dataset) return;
    var text = $('attn-text').value || state.attnText;
    var tok = state.dataset.tokenizer;
    if (!tok.contains(text) || text.length < 2) return;
    var layer = parseInt($('attn-layer').value, 10) || 0;
    var head = parseInt($('attn-head').value, 10) || 0;
    layer = Math.min(layer, state.model.layers - 1);
    head = Math.min(head, state.model.heads - 1);
    var ids = tok.encode(text);
    if (ids.length > state.model.block) ids = ids.subarray(0, state.model.block);
    var savedB = state.model._B, savedT = state.model._T;
    var maps;
    try {
      maps = state.model.attentionMaps(ids);
    } catch (e) {
      return;
    }
    state.model.ensureShape(savedB, savedT);
    var chars = [];
    for (var i = 0; i < ids.length; i++) chars.push(tok.itos[ids[i]]);
    attnGrid.set(chars, maps[layer][head], 'layer ' + (layer + 1) + ' · head ' + (head + 1));
    attnGrid.draw();
  }

  function drawEmbeddings() {
    if (!state.model) return;
    var C = state.model.dim;
    var rows = state.model.tokEmb.rows;
    var box = $('emb-canvas');
    var pts = V.pcaProject(state.model.tokEmb.w, rows, C, box.clientWidth || 400, box.clientHeight || 300);
    var tok = state.dataset.tokenizer;
    var out = [];
    var freq = {};
    var text = state.dataset.text;
    for (var i = 0; i < text.length; i++) freq[text[i]] = (freq[text[i]] || 0) + 1;
    var order = [];
    for (var q = 0; q < pts.length; q++) order.push(q);
    order.sort(function (a, b) { return (freq[tok.itos[b]] || 0) - (freq[tok.itos[a]] || 0); });
    var labelled = {};
    for (var q2 = 0; q2 < Math.min(16, order.length); q2++) labelled[order[q2]] = true;
    for (var j = 0; j < pts.length; j++) {
      var ch = tok.itos[j];
      var pretty = ch === '\n' ? '⏎' : ch === ' ' ? '␣' : ch;
      out.push({
        x: pts[j].x, y: pts[j].y,
        ch: pretty,
        name: pretty + '  ·  ' + U.fmtInt(freq[ch] || 0) + ' uses',
        hot: !!labelled[j]
      });
    }
    embScatter.set(out);
    embScatter.draw();
  }

  function drawLogits() {
    if (!state.model || !state.dataset) return;
    var tok = state.dataset.tokenizer;
    var text = $('prompt-input').value || ' ';
    if (!tok.contains(text)) {
      var stripped = '';
      for (var i = 0; i < text.length; i++) if (tok.stoi[text[i]] !== undefined) stripped += text[i];
      text = stripped || ' ';
    }
    var ids = tok.encode(text.slice(-state.model.block));
    if (ids.length === 0) ids = Int32Array.from([0]);
    var savedB = state.model._B, savedT = state.model._T;
    var lg = state.model.logitsAt(ids);
    state.model.ensureShape(savedB, savedT);
    var idxs = Array.from(lg.keys()).sort(function (a, b) { return lg[b] - lg[a]; }).slice(0, 10);
    var max = lg[idxs[0]];
    var items = idxs.map(function (i) {
      return {
        label: tok.itos[i] === '\n' ? '⏎' : tok.itos[i] === ' ' ? '␣' : tok.itos[i],
        p: Math.exp(lg[i] - max)
      };
    });
    var sum = 0;
    for (var k = 0; k < items.length; k++) sum += items[k].p;
    for (var m = 0; m < items.length; m++) items[m].p = items[m].p / sum;
    logitBars.set(items);
    logitBars.draw();
  }

  var lossCurve, logitBars, attnGrid, embScatter, heroField, surpriseStrip;

  function frame() {
    var now = Date.now();
    heroField.draw(16);
    if (state.dirty.loss) {
      state.dirty.loss = false;
      lossCurve.draw();
    }
    if (state.dirty.logits) {
      state.dirty.logits = false;
      drawLogits();
    }
    if (state.dirty.attn && now - state.lastAttn > 700) {
      state.lastAttn = now;
      state.dirty.attn = false;
      drawAttention();
    }
    if (state.dirty.emb && now - state.lastEmb > 2600) {
      state.lastEmb = now;
      state.dirty.emb = false;
      drawEmbeddings();
    }
    if (state.dirty.metrics && now - (state.lastMetrics || 0) > 260) {
      state.lastMetrics = now;
      state.dirty.metrics = false;
      updateMetrics();
    }
    if (state.dirty.timeline) {
      state.dirty.timeline = false;
      renderTimeline();
    }
    typeVoice();
    requestAnimationFrame(frame);
  }

  function bind() {
    $('btn-train').addEventListener('click', function () {
      var t = state.trainer;
      if (t.running) {
        t.pause();
        this.textContent = 'Train';
      } else {
        t.start();
        this.textContent = 'Pause';
      }
      updateMetrics();
    });
    $('hero-train').addEventListener('click', function () {
      var t = state.trainer;
      if (t.running) {
        t.pause();
        this.textContent = 'Resume training';
      } else {
        t.start();
        this.textContent = 'Pause training';
      }
    });
    function unlearn() {
      state.trainer.pause();
      rebuildModel({ seed: (Math.random() * 1e9) | 0 });
      state.snapshots = [{ step: 0, loss: 4.2, text: currentProbe().prompt + ' …', recorded: true }];
      state.trainer.step = 0;
      state.trainer.lossEma = 0;
      state.trainer.valLoss = 0;
      $('btn-train').textContent = 'Train';
      $('hero-train').textContent = 'Start training';
      updateMetrics();
      state.trainer.start();
    }
    $('btn-unlearn').addEventListener('click', unlearn);
    $('hero-unlearn').addEventListener('click', unlearn);
    $('btn-step').addEventListener('click', function () {
      state.trainer.pause();
      state.trainer._stepSerial();
    });
    $('btn-speak').addEventListener('click', speakNow);
    $('book-select').addEventListener('change', function () {
      if (this.value === 'custom') {
        $('custom-wrap').style.display = 'block';
        return;
      }
      $('custom-wrap').style.display = 'none';
      if (setBook(this.value)) {
        state.trainer.start();
        $('btn-train').textContent = 'Pause';
      }
    });
    $('preset-select').addEventListener('change', function () {
      state.preset = this.value;
      rebuildModel();
      state.trainer.start();
      $('btn-train').textContent = 'Pause';
    });
    $('btn-use-custom').addEventListener('click', function () {
      var text = $('custom-text').value || '';
      if (text.length < 400) {
        $('custom-status').textContent = 'needs at least 400 characters';
        return;
      }
      $('custom-status').textContent = 'training on ' + U.fmtInt(text.length) + ' characters';
      state.bookId = 'custom';
      if (setBook('custom')) {
        state.trainer.start();
        $('btn-train').textContent = 'Pause';
      }
    });
    $('btn-generate').addEventListener('click', function () {
      var t0 = performance.now();
      state.prompt = $('prompt-input').value;
      var tok = state.dataset.tokenizer;
      var clean = '';
      for (var i = 0; i < state.prompt.length; i++) if (tok.stoi[state.prompt[i]] !== undefined) clean += state.prompt[i];
      var ids = tok.encode(clean.slice(-state.model.block));
      if (ids.length === 0) ids = Int32Array.from([0]);
      var rng = SL.rng.mulberry32((Date.now() % 1e6) | 0);
      var opts = {
        temperature: parseFloat($('s-temp').value),
        topK: parseInt($('s-topk').value, 10),
        topP: parseFloat($('s-topp').value),
        repPenalty: parseFloat($('s-rep').value)
      };
      var savedB = state.model._B, savedT = state.model._T;
      var gen = state.model.generate(ids, 260, opts, rng);
      state.model.ensureShape(savedB, savedT);
      $('output-text').value = clean + tok.decode(gen);
      $('gen-time').textContent = SL.util.fmtTime(performance.now() - t0) + ' · ' + (opts.temperature).toFixed(2) + ' temperature';
      state.dirty.logits = true;
    });
    $('btn-clear').addEventListener('click', function () {
      $('output-text').value = '';
      $('gen-time').textContent = '';
    });
    var sliders = [
      ['s-temp', 'o-temp', 2],
      ['s-topk', 'o-topk', 0],
      ['s-topp', 'o-topp', 2],
      ['s-rep', 'o-rep', 2]
    ];
    for (var s = 0; s < sliders.length; s++) {
      (function (triple) {
        var input = $(triple[0]), out = $(triple[1]);
        input.addEventListener('input', function () {
          out.textContent = parseFloat(input.value).toFixed(triple[2]);
        });
      })(sliders[s]);
    }
    $('attn-text').addEventListener('input', function () {
      state.dirty.attn = true;
    });
    $('attn-layer').addEventListener('change', function () { state.dirty.attn = true; });
    $('attn-head').addEventListener('change', function () { state.dirty.attn = true; });
    $('prompt-input').addEventListener('input', function () {
      state.dirty.logits = true;
    });
    $('btn-surprise').addEventListener('click', function () {
      readSurprise();
    });
    $('hero-read').addEventListener('click', function () {
      var book = SL.corpus.byId(state.bookId);
      $('overlay-title').textContent = book ? book.title : 'Your own text';
      $('overlay-text').textContent = book ? book.text : ($('custom-text').value || '');
      $('book-overlay').hidden = false;
    });
    $('overlay-close').addEventListener('click', function () {
      $('book-overlay').hidden = true;
    });
    $('book-overlay').addEventListener('click', function (ev) {
      if (ev.target === this) this.hidden = true;
    });
    $('btn-proof').addEventListener('click', function () {
      var out = $('proof-output');
      out.textContent = '';
      var panel = new SL.ProofPanel(function (text, cls) {
        var span = document.createElement('div');
        span.className = cls || '';
        span.textContent = text;
        out.appendChild(span);
        out.scrollTop = out.scrollHeight;
      });
      panel.bookId = state.bookId;
      var btn = this;
      btn.disabled = true;
      setTimeout(function () {
        panel.runAll();
        btn.disabled = false;
      }, 30);
    });
    window.addEventListener('resize', function () {
      state.dirty.loss = true;
      state.dirty.attn = true;
      state.dirty.emb = true;
      state.dirty.logits = true;
    });
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === ' ') {
        ev.preventDefault();
        $('btn-train').click();
      } else if (ev.key === 'g' || ev.key === 'G') {
        $('btn-generate').click();
      } else if (ev.key === 'u' || ev.key === 'U') {
        $('btn-unlearn').click();
      } else if (ev.key === 's' || ev.key === 'S') {
        $('btn-speak').click();
      } else if (ev.key === 'Escape') {
        $('book-overlay').hidden = true;
      }
    });
  }

  function seedPrompts() {
    var box = $('prompt-chips');
    var probes = SL.corpus.probeFor(state.bookId);
    box.innerHTML = '';
    for (var i = 0; i < probes.length; i++) {
      (function (pr) {
        var chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = pr.label;
        chip.addEventListener('click', function () {
          $('prompt-input').value = pr.prompt;
          state.dirty.logits = true;
        });
        box.appendChild(chip);
      })(probes[i]);
    }
    $('prompt-input').value = probes[0].prompt;
  }

  function boot() {
    lossCurve = new V.LossCurve($('loss-canvas'));
    logitBars = new V.LogitBars($('logit-canvas'));
    attnGrid = new V.AttentionGrid($('attn-canvas'));
    embScatter = new V.EmbeddingScatter($('emb-canvas'));
    heroField = new V.HeroField($('hero-field'));
    surpriseStrip = new V.SurpriseStrip($('surprise-canvas'));

    $('custom-text').value = SL.corpus.build ? '' : '';
    setBook('reader');
    seedPrompts();
    renderPipeline();
    bind();

    var ckpt = SL.checkpoints && SL.checkpoints.reader;
    if (ckpt) {
      $('build-stamp').textContent = 'trained offline · ' + U.fmtInt(ckpt.steps) + ' steps · ' + ckpt.minutes + ' min';
      $('book-steps').textContent = U.fmtInt(ckpt.steps) + ' (offline)';
    }

    state.trainer.start();
    $('btn-train').textContent = 'Pause';
    $('hero-train').textContent = 'Pause training';

    speakNow();
    setInterval(function () {
      if (state.voicePos >= state.voice.length - 1) speakNow();
    }, 14000);
    setInterval(function () {
      if (state.trainer && state.trainer.step % 220 === 0 && state.trainer.step > 0) {
        state.dirty.attn = true;
      }
    }, 3000);

    var elapsed = Math.round((Date.now() - state.startedAt) / 1000);
    $('colophon-time').textContent = 'opened ' + new Date().toISOString().slice(0, 10);
    $('colophon-runtime').textContent = 'this page has been running for ' + elapsed + 's';

    requestAnimationFrame(frame);
    setInterval(function () {
      $('colophon-runtime').textContent = 'this page has been running for ' +
        Math.round((Date.now() - state.startedAt) / 1000) + 's';
    }, 5000);

    window.ONEBOOK = state;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
