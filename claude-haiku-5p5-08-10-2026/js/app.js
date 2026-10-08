/* ==========================================================================
   THE BLIND PHYSICIST · app.js
   The page: runs the experiment, hands the data to the search, shows what
   the machine sees, believes and does next, and keeps its notebook.
   ========================================================================== */
(function () {
  'use strict';
  var BP = globalThis.BP;
  var E = BP.Expr, W = BP.Worlds, Sci = BP.Scientist, R = BP.Render;
  var CAT = W.CATALOGUE;
  var GRID_M = 56, CURVE_N = 240, MAX_LOG = 160;
  var now = function () { return performance.now(); };
  var $ = function (id) { return document.getElementById(id); };

  var INTRO = {
    pendulum: 'A pendulum swings under a law I was never given. I may start it anywhere in (θ, ω) and read its angular acceleration, with noise.',
    duffing: 'A spring with unknown stiffness and damping. I can release it from any position and velocity and read its acceleration.',
    orbit: 'A body circles a massive star. I can place it at any distance r with any speed, then read how hard the star pulls.',
    drag: 'A body is thrown through the air. I can set its velocity and read its acceleration.',
    kepler: 'Circular orbits at many radii. I cannot see the law, only how long each lap takes.',
    custom: 'Someone has typed a law of motion. I have never seen it. I only know what it does.'
  };

  var app = {
    expId: 'pendulum', formula: '-sin(2*x) - 0.4*v*abs(v)',
    world: null, sci: null, engine: null,
    seed: 0, speed: 3, noise: 0.01, running: true,
    pareto: [], stats: null, assessed: null,
    lawKey: '', lawLogAt: -1e9, foundAt: null, revealed: false,
    simTime: 0, probeRadii: [], recent: [], grid: null, cache: {},
    lastSend: 0, needSend: false, lastMind: 0, lastPareto: 0, lastStats: 0,
    mindDirty: true, paretoDirty: true, lastFrame: 0, errorShown: false
  };

  // ---- formatting ---------------------------------------------------------
  function sgn(s) { return String(s).replace('-', '−'); }
  function fmt3(v) { return sgn(E.fmt(v)); }
  function pct(x) {
    if (!isFinite(x)) return 'n/a';
    return (100 * x).toFixed(x < 0.01 ? 2 : 1) + '%';
  }
  function inputsText(p) {
    var names = app.world.inputNames;
    return p.map(function (v, i) { return names[i] + ' = ' + fmt3(v); }).join(', ');
  }
  function displayLaw(tree) {
    return E.show(E.tidy(tree), app.world.inputNames, true);
  }

  // ---- notebook -----------------------------------------------------------
  function log(kind, msg) {
    var t = app.simTime;
    var box = $('notebook');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'entry ' + kind;
    var tt = document.createElement('span');
    tt.className = 'time';
    tt.textContent = 't ' + t.toFixed(1) + 's';
    var mm = document.createElement('span');
    mm.className = 'msg';
    mm.textContent = msg;
    row.appendChild(tt);
    row.appendChild(mm);
    box.appendChild(row);
    while (box.childNodes.length > MAX_LOG) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function clearNotebook() { var box = $('notebook'); if (box) box.textContent = ''; }

  // ---- the search, in a worker when possible ------------------------------
  function Engine(opts) {
    var self = this;
    this.opts = opts; this.mode = 'none'; this.worker = null; this.disc = null; this.lastData = null;
    try {
      if (typeof Worker === 'undefined') throw new Error('no workers');
      this.worker = new Worker('js/worker.js');
      this.mode = 'worker';
      this.worker.onmessage = function (e) { if (e.data && e.data.type === 'status') onStatus(e.data); };
      this.worker.onerror = function () { self.fallback(); };
      this.worker.postMessage({ type: 'reset', opts: opts });
      this.worker.postMessage({ type: 'run', on: app.running });
    } catch (err) {
      this.fallback();
    }
  }
  Engine.prototype.fallback = function () {
    if (this.mode === 'main') return;
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignore */ } this.worker = null; }
    this.mode = 'main';
    this.disc = new BP.Discoverer(this.opts);
    if (this.lastData) this.disc.setData(this.lastData.cols, this.lastData.y, this.lastData.norm);
  };
  Engine.prototype.data = function (cols, y, norm) {
    this.lastData = { cols: cols, y: y, norm: norm };
    if (this.mode === 'worker') this.worker.postMessage({ type: 'data', cols: cols, y: y, norm: norm });
    else if (this.disc) { this.disc.setData(cols, y, norm); onStatus({ pareto: this.disc.pareto(), stats: this.disc.stats() }); }
  };
  Engine.prototype.run = function (on) {
    if (this.mode === 'worker' && this.worker) this.worker.postMessage({ type: 'run', on: on });
  };
  Engine.prototype.stop = function () {
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignore */ } this.worker = null; }
    this.mode = 'none';
  };

  // ---- candidates, hypotheses and the law ---------------------------------
  function candidates() {
    var par = app.pareto;
    if (!par || !par.length) return [];
    var best = par[par.length - 1].nrmse;
    return par.filter(function (q) { return q.nrmse <= 3 * best + 1e-3; }).slice(-6);
  }

  function onStatus(st) {
    app.pareto = st.pareto || [];
    app.stats = st.stats || null;
    app.mindDirty = true;
    app.paretoDirty = true;
    evaluateLaw();
  }

  function evaluateLaw() {
    if (!app.sci) return;
    var a = app.sci.assess(app.pareto);
    app.assessed = a;
    var law = a && a.law;
    if (law && law.expr !== app.lawKey) {
      var wall = now();
      if (app.lawKey === '' || wall - app.lawLogAt > 2500) {
        log('hyp', 'Hypothesis: ' + displayLaw(law.tree) + '   (complexity ' + law.size + ', error ' + pct(law.nrmse) + ')');
        app.lawLogAt = wall;
      }
      app.lawKey = law.expr;
    }
    if (a && a.found && app.foundAt === null) {
      app.foundAt = app.simTime;
      app.revealed = true;
      log('found', 'Law found: ' + displayLaw(law.tree) + '. Its error, ' + pct(law.nrmse) +
          ', is within the instrument noise (' + pct(a.noise) + ').');
      flashFound();
    }
  }

  function flashFound() {
    var el = $('law');
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---- experiments ---------------------------------------------------------
  function sendData(force) {
    if (!app.sci || !app.engine) return;
    var t = now();
    if (!force && t - app.lastSend < 1000) { app.needSend = true; return; }
    app.needSend = false;
    app.lastSend = t;
    var c = app.sci.columns();
    app.engine.data(c.cols, c.y, c.norm);
  }

  function announce(choice, p) {
    var where = inputsText(p);
    if (!choice || choice.kind === 'random') {
      log('exp', 'Exploring at random: ' + where + '.');
    } else {
      log('exp', 'My ' + choice.count + ' best laws disagree most at ' + where +
          ' (spread ' + pct(choice.spread) + ' of a typical reading). Setting up the experiment there.');
    }
  }

  function beginProbe() {
    var p = app.sci.begin(candidates());
    app.recent = [];
    if (app.world.id === 'kepler') app.probeRadii.push(p[0]);
    announce(app.sci.choice, p);
  }

  function onProbeDone() {
    var sc = app.sci, world = app.world;
    if (world.id === 'kepler' && sc.X.length) {
      var lastY = sc.Y[sc.Y.length - 1];
      log('obs', 'One lap at r = ' + fmt3(sc.X[sc.X.length - 1][0]) + ' took T = ' + fmt3(lastY) + '.');
    } else {
      log('obs', 'Experiment ' + sc.probesDone + ' complete: ' + sc.X.length + ' measurements on file.');
    }
    sendData(true);
    beginProbe();
  }

  function buildGrid(world) {
    var D = world.domain, M = GRID_M, N = M * M;
    var cols = [new Float64Array(N), new Float64Array(N)], pts = new Array(N), iy, ix;
    for (iy = 0; iy < M; iy++) {
      for (ix = 0; ix < M; ix++) {
        var k = iy * M + ix;
        var x = D[0][0] + (D[0][1] - D[0][0]) * ix / (M - 1);
        var y = D[1][0] + (D[1][1] - D[1][0]) * iy / (M - 1);
        cols[0][k] = x; cols[1][k] = y; pts[k] = [x, y];
      }
    }
    var truth = new Float64Array(N), tmin = Infinity, tmax = -Infinity;
    for (var q = 0; q < N; q++) {
      truth[q] = world.target(pts[q]);
      if (isFinite(truth[q])) { tmin = Math.min(tmin, truth[q]); tmax = Math.max(tmax, truth[q]); }
    }
    if (!isFinite(tmin)) { tmin = -1; tmax = 1; }
    return { M: M, N: N, cols: cols, truth: truth, tmin: tmin, tmax: tmax, pts: pts };
  }

  function scratchFor(n) {
    if (!app.cache.scratch) app.cache.scratch = {};
    if (!app.cache.scratch[n]) app.cache.scratch[n] = E.makeScratch(32, n);
    return app.cache.scratch[n];
  }

  // Values of a law on a set of input columns.
  function predict(tree, cols, n) {
    var prog = E.compile(tree);
    var th = Float64Array.from(E.getConsts(tree));
    return Float64Array.from(E.run(prog, th, cols, n, scratchFor(n)));
  }

  // Spread across the candidate laws at each point, relative to a typical reading.
  function disagreement(cands, cols, n) {
    var K = cands.length, preds = cands.map(function (c) { return predict(c.tree, cols, n); });
    var out = new Float64Array(n), sc = app.world.scale || 1, i, j;
    for (i = 0; i < n; i++) {
      var m = 0;
      for (j = 0; j < K; j++) m += preds[j][i];
      m /= K;
      var v = 0;
      for (j = 0; j < K; j++) { var d = preds[j][i] - m; v += d * d; }
      out[i] = Math.sqrt(v / K) / sc;
    }
    return out;
  }

  // ---- drawing ------------------------------------------------------------
  function drawHidden(ctx, w, h, t) {
    ctx.fillStyle = '#0c0d15'; ctx.fillRect(0, 0, w, h);
    var seedv = 7, k;
    for (k = 0; k < 260; k++) {
      seedv = (seedv * 16807) % 2147483647;
      var x = (seedv % 1000) / 1000 * w;
      seedv = (seedv * 16807) % 2147483647;
      var y = (seedv % 1000) / 1000 * h;
      ctx.fillStyle = 'rgba(141,147,168,' + (0.04 + 0.06 * ((k * 37 + Math.floor(t / 400)) % 7) / 7) + ')';
      ctx.fillRect(x, y, 2, 2);
    }
    R.text(ctx, 'nature is hidden', w / 2, h / 2 - 6, R.PAL.muted, 13, 'center');
    R.text(ctx, 'until the machine finds its law', w / 2, h / 2 + 12, 'rgba(141,147,168,0.7)', 11, 'center');
  }

  function drawScatter2D(ctx, box, dom) {
    var X = app.sci.X, n = X.length, start = Math.max(0, n - 900), i;
    ctx.fillStyle = 'rgba(231,233,242,0.38)';
    for (i = start; i < n; i++) {
      var q = R.toPix(box, dom, X[i]);
      ctx.fillRect(q[0] - 0.8, q[1] - 0.8, 1.6, 1.6);
    }
    if (app.recent.length > 1) {
      ctx.strokeStyle = 'rgba(244,194,91,0.75)'; ctx.lineWidth = 1.2; ctx.beginPath();
      app.recent.forEach(function (p, j) {
        var s = R.toPix(box, dom, p);
        if (j) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]);
      });
      ctx.stroke();
    }
    if (app.sci.current) {
      var c = R.toPix(box, dom, app.sci.current);
      ctx.strokeStyle = R.PAL.gold; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c[0], c[1], 6, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawMap(canvas, drawFn) {
    var p = R.prepare(canvas);
    drawFn(p.ctx, p.w, p.h);
  }

  function updateMind2D(law, cands) {
    var g = app.grid, w = app.world, dom = w.domain;
    if (!g) return;
    var belief = law ? predict(law.tree, g.cols, g.N) : null;
    var spread = cands.length >= 2 ? disagreement(cands, g.cols, g.N) : null;
    var smax = 0;
    if (spread) for (var i = 0; i < g.N; i++) if (isFinite(spread[i])) smax = Math.max(smax, spread[i]);

    drawMap($('map-nature'), function (ctx, cw, ch) {
      var box = { x: 26, y: 8, w: cw - 34, h: ch - 30 };
      if (app.revealed) {
        R.heatmap(ctx, box.x, box.y, box.w, box.h, g.truth, g.M, g.tmin, g.tmax, false);
      } else {
        drawHidden(ctx, cw, ch, now());
      }
      drawScatter2D(ctx, box, dom);
      axes(ctx, box, dom, w.inputNames);
    });
    drawMap($('map-belief'), function (ctx, cw, ch) {
      var box = { x: 26, y: 8, w: cw - 34, h: ch - 30 };
      ctx.fillStyle = '#0c0d15'; ctx.fillRect(box.x, box.y, box.w, box.h);
      if (belief) {
        var lo = app.revealed ? g.tmin : belief.reduce(function (a, b) { return isFinite(b) ? Math.min(a, b) : a; }, Infinity);
        var hi = app.revealed ? g.tmax : belief.reduce(function (a, b) { return isFinite(b) ? Math.max(a, b) : a; }, -Infinity);
        if (!isFinite(lo)) { lo = -1; hi = 1; }
        R.heatmap(ctx, box.x, box.y, box.w, box.h, belief, g.M, lo, hi, false);
      } else {
        R.text(ctx, 'no hypothesis yet', box.x + box.w / 2, box.y + box.h / 2, R.PAL.muted, 12, 'center');
      }
      drawScatter2D(ctx, box, dom);
      axes(ctx, box, dom, w.inputNames);
    });
    drawMap($('map-disagree'), function (ctx, cw, ch) {
      var box = { x: 26, y: 8, w: cw - 34, h: ch - 30 };
      ctx.fillStyle = '#0c0d15'; ctx.fillRect(box.x, box.y, box.w, box.h);
      if (spread) {
        R.heatmap(ctx, box.x, box.y, box.w, box.h, spread, g.M, 0, Math.max(smax, 1e-9), true);
      } else {
        R.text(ctx, 'waiting for two rival laws', box.x + box.w / 2, box.y + box.h / 2, R.PAL.muted, 12, 'center');
      }
      drawScatter2D(ctx, box, dom);
      axes(ctx, box, dom, w.inputNames);
    });
  }

  function axes(ctx, box, dom, names) {
    R.text(ctx, names[0], box.x + box.w / 2, box.y + box.h + 18, R.PAL.muted, 11, 'center');
    R.text(ctx, names[1], 6, box.y + 10, R.PAL.muted, 11, 'left');
    R.text(ctx, dom[0][0].toFixed(1), box.x, box.y + box.h + 13, R.PAL.muted, 9, 'left');
    R.text(ctx, dom[0][1].toFixed(1), box.x + box.w, box.y + box.h + 13, R.PAL.muted, 9, 'right');
  }

  function updateMind1D(law, cands) {
    var w = app.world, dom = w.domain[0], n = CURVE_N, xs = new Float64Array(n), i;
    for (i = 0; i < n; i++) xs[i] = dom[0] + (dom[1] - dom[0]) * i / (n - 1);
    var cols = [xs];
    var truth = new Float64Array(n), tlo = Infinity, thi = -Infinity;
    for (i = 0; i < n; i++) {
      truth[i] = w.target([xs[i]]);
      if (isFinite(truth[i])) { tlo = Math.min(tlo, truth[i]); thi = Math.max(thi, truth[i]); }
    }
    var belief = law ? predict(law.tree, cols, n) : null;
    var candCurves = cands.slice(0, 3).map(function (c) { return predict(c.tree, cols, n); });
    var X = app.sci.X, Y = app.sci.Y, pts = [], ylo = Infinity, yhi = -Infinity;
    for (i = Math.max(0, X.length - 500); i < X.length; i++) {
      pts.push([X[i][0], Y[i]]);
      ylo = Math.min(ylo, Y[i]); yhi = Math.max(yhi, Y[i]);
    }
    if (!isFinite(ylo)) { ylo = -1; yhi = 1; }
    if (app.revealed && isFinite(tlo)) { ylo = Math.min(ylo, tlo); yhi = Math.max(yhi, thi); }
    var pad = (yhi - ylo) * 0.12 || 1;
    var series = [];
    candCurves.forEach(function (c) { series.push({ ys: Array.from(c), color: 'rgba(95,211,255,0.22)', width: 1 }); });
    if (belief) series.push({ ys: Array.from(belief), color: R.PAL.cyan, width: 2.2 });
    if (app.revealed) series.push({ ys: Array.from(truth), color: R.PAL.gold, width: 1.5, dash: [5, 4], alpha: 0.9 });
    var p = R.prepare($('curve'));
    var marker = app.sci.current ? app.sci.current[0] : null;
    R.curve1D(p.ctx, p.w, p.h, dom, Array.from(xs), series, pts, marker, [ylo - pad, yhi + pad]);
    R.text(p.ctx, w.targetName + ' against ' + w.inputNames[0], p.w - 14, 17, R.PAL.muted, 11, 'right');
  }

  function updatePareto() {
    var a = app.assessed, law = a && a.law;
    var p = R.prepare($('pareto'));
    R.pareto(p.ctx, p.w, p.h, app.pareto, law ? law.size : -1, a ? a.noise : 0, 25);
  }

  function updateMind() {
    var a = app.assessed, law = a && a.law, cands = candidates();
    if (app.world.dim === 2) updateMind2D(law, cands);
    else updateMind1D(law, cands);
  }

  function updateNature() {
    var p = R.prepare($('nature'));
    R.drawNature(p.ctx, p.w, p.h, app.world, { probeRadii: app.probeRadii });
  }

  function updateLawCard() {
    var w = app.world, a = app.assessed, law = a && a.law, sc = app.sci;
    $('law-target').textContent = w.targetName + ' =';
    $('law-expr').textContent = law ? displayLaw(law.tree) : 'no law yet';
    var meta = [];
    if (law) {
      meta.push('error ' + pct(law.nrmse));
      meta.push('complexity ' + law.size);
    }
    meta.push(sc.probesDone + ' experiments');
    meta.push(sc.X.length + ' measurements');
    $('law-meta').textContent = meta.join('  ·  ');
    $('law-stamp').hidden = !(a && a.found);
    $('law-truth').textContent = app.revealed ? 'Truth: ' + w.truthText
      : 'Truth hidden. Press Reveal to compare.';
    $('law-truth').className = app.revealed ? 'truth shown' : 'truth';
    $('law-note').textContent = law
      ? (a.found ? 'Consistent with the measurement noise: nothing simpler explains these readings.'
                 : 'Still searching. The simplest law that explains the readings as well as the best one is shown.')
      : 'Waiting for the first hypotheses.';
    var btn = $('btn-reveal');
    btn.textContent = app.revealed ? 'Hide truth' : 'Reveal truth';
  }

  function updateStats() {
    var s = app.stats || {}, sc = app.sci;
    $('stat-evals').textContent = (s.evals || 0).toLocaleString('en-US');
    $('stat-gens').textContent = (s.gen || 0).toLocaleString('en-US');
    $('stat-meas').textContent = sc ? sc.X.length.toLocaleString('en-US') : '0';
    $('stat-exp').textContent = sc ? String(sc.probesDone) : '0';
    $('stat-mode').textContent = app.engine ? (app.engine.mode === 'worker' ? 'worker thread' : 'main thread') : '-';
  }

  // ---- lifecycle -----------------------------------------------------------
  function startExperiment(id, formula) {
    if (app.engine) app.engine.stop();
    var seed = (Math.random() * 1e9) | 0;
    var world = W.create(id, seed, formula);
    world.noiseFrac = app.noise;
    var meta = CAT.filter(function (c) { return c.id === id; })[0];
    world.title = meta ? meta.title : 'Your law';
    app.expId = id;
    if (formula) app.formula = formula;
    app.world = world;
    app.sci = new Sci({ world: world, seed: (seed % 65521) + 3 });
    app.engine = new Engine({ names: world.inputNames, seed: (seed % 99991) + 11, maxSize: 25 });
    app.pareto = []; app.assessed = null; app.stats = null;
    app.lawKey = ''; app.lawLogAt = -1e9; app.foundAt = null; app.revealed = false;
    app.simTime = 0; app.probeRadii = []; app.recent = []; app.cache = {};
    app.needSend = false; app.lastSend = 0; app.mindDirty = true; app.paretoDirty = true;
    app.grid = world.dim === 2 ? buildGrid(world) : null;
    $('mind-2d').hidden = world.dim !== 2;
    $('mind-1d').hidden = world.dim === 2;
    clearNotebook();
    log('note', INTRO[id] || INTRO.custom);
    log('note', 'My vocabulary: + − × ÷, powers, sin, cos, exp, log, √, |·|. Nothing about physics is built in.');
    beginProbe();
    highlightChips();
    updateLawCard();
    mark();
  }

  function mark() {
    document.querySelectorAll('[data-exp]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-exp') === app.expId);
    });
  }
  function highlightChips() { mark(); }

  function setSpeed(s) {
    app.speed = s;
    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-speed')) === s);
    });
  }
  function setNoise(n) {
    app.noise = n;
    document.querySelectorAll('[data-noise]').forEach(function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-noise')) === n);
    });
  }

  function toggleReveal() {
    app.revealed = !app.revealed;
    if (app.revealed) {
      log('found', 'Truth: ' + app.world.truthText + (app.assessed && app.assessed.law
        ? '.  My law: ' + displayLaw(app.assessed.law.tree) + '.' : '.'));
    }
    app.mindDirty = true;
    updateLawCard();
  }

  // ---- custom law ----------------------------------------------------------
  function applyFormula() {
    var src = $('formula').value;
    var msg = $('formula-msg');
    try {
      var tree = E.parse(src, ['x', 'v']);
      var used = E.usesInput(tree);
      if (!used[0] && !used[1]) throw new Error('the law must depend on x or v');
      var bad = 0, rnd = BP.GP.rng(3), k;
      for (k = 0; k < 40; k++) {
        var val = E.ev(tree, [rnd() * 6 - 3, rnd() * 6 - 3]);
        if (!isFinite(val)) bad++;
      }
      if (bad > 10) throw new Error('the law is not finite over much of the domain');
      msg.textContent = '';
      startExperiment('custom', src.trim());
    } catch (err) {
      msg.textContent = err.message;
    }
  }

  function buildControls() {
    var holder = $('experiments');
    CAT.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.setAttribute('data-exp', c.id);
      b.type = 'button';
      var t = document.createElement('span'); t.className = 'chip-title'; t.textContent = c.title;
      var d = document.createElement('span'); d.className = 'chip-blurb'; d.textContent = c.blurb;
      b.appendChild(t); b.appendChild(d);
      b.addEventListener('click', function () {
        if (c.id === 'custom') { $('custom-panel').hidden = false; applyFormula(); return; }
        $('custom-panel').hidden = true;
        startExperiment(c.id);
      });
      holder.appendChild(b);
    });

    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.addEventListener('click', function () { setSpeed(Number(b.getAttribute('data-speed'))); });
    });
    document.querySelectorAll('[data-noise]').forEach(function (b) {
      b.addEventListener('click', function () {
        setNoise(Number(b.getAttribute('data-noise')));
        startExperiment(app.expId, app.expId === 'custom' ? app.formula : undefined);
      });
    });
    $('btn-play').addEventListener('click', function () {
      app.running = !app.running;
      $('btn-play').textContent = app.running ? 'Pause' : 'Resume';
      if (app.engine) app.engine.run(app.running);
    });
    $('btn-restart').addEventListener('click', function () {
      startExperiment(app.expId, app.expId === 'custom' ? app.formula : undefined);
    });
    $('btn-reveal').addEventListener('click', toggleReveal);

    var ex = ['-4*x - 0.3*v', '-x^3 + sin(v)', '-2*x*abs(v) - x', '-sin(2*x) - 0.4*v*abs(v)'];
    var exHolder = $('formula-examples');
    ex.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'example'; b.textContent = s.replace(/\*/g, '');
      b.addEventListener('click', function () { $('formula').value = s; applyFormula(); });
      exHolder.appendChild(b);
    });
    $('formula').value = app.formula;
    $('formula-go').addEventListener('click', applyFormula);
    $('formula').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyFormula(); });
    $('custom-panel').hidden = true;
    setSpeed(app.speed);
    setNoise(app.noise);
  }

  // ---- main loop -----------------------------------------------------------
  function frame(ts) {
    requestAnimationFrame(frame);
    try {
      var dt = app.lastFrame ? Math.min(0.05, (ts - app.lastFrame) / 1000) : 0.016;
      app.lastFrame = ts;
      var eng = app.engine;
      if (eng && eng.mode === 'main' && eng.disc) {
        eng.disc.evolve(8);
        if (now() - app.lastPareto > 250) {
          app.lastPareto = now();
          onStatus({ pareto: eng.disc.pareto(), stats: eng.disc.stats() });
        }
      }
      if (app.running && app.sci) {
        var rate = app.speed * (app.world.timeScale || 1);
        var step = app.sci.advance(dt * rate);
        app.simTime += dt * rate;
        if (step.samples.length) {
          var last = step.samples[step.samples.length - 1].x;
          app.recent.push(last);
          if (app.recent.length > 160) app.recent.shift();
          app.needSend = true;
        }
        if (step.finished) onProbeDone();
      }
      if (app.needSend) sendData(false);
      var t = now();
      if (app.mindDirty && t - app.lastMind > 180) {
        app.lastMind = t;
        app.mindDirty = false;
        updateMind();
      } else if (app.world && app.world.dim === 2 && app.revealed === false && t - app.lastMind > 180) {
        app.lastMind = t;
        updateMind();   // keeps the hidden field and the observations alive
      }
      if (app.paretoDirty) { app.paretoDirty = false; updatePareto(); }
      if (app.world) updateNature();
      if (t - app.lastStats > 200) { app.lastStats = t; updateStats(); updateLawCard(); }
    } catch (err) {
      if (!app.errorShown) {
        app.errorShown = true;
        log('found', 'Something went wrong: ' + (err && err.message ? err.message : err));
        console.error(err);
      }
    }
  }

  function boot() {
    buildControls();
    setSpeed(app.speed);
    startExperiment('pendulum');
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
