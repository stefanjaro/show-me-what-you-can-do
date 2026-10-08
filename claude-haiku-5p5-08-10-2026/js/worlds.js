/* ==========================================================================
   THE BLIND PHYSICIST · worlds.js
   Nature. Each world obeys a hidden law of motion, integrated with RK4.
   The machine never sees the law. It can only place the world in a state,
   let it run, and read back noisy measurements of the acceleration.

   Every world exposes:
     beginProbe(inputs)   start a fresh experiment from chosen inputs
     advance(dt)          run the world forward, returns new samples
     done                 true when the probe has finished
     target(inputs)       the noiseless truth (used for reveal and scoring)
   ========================================================================== */
(function () {
  'use strict';
  var BP = globalThis.BP || (globalThis.BP = {});
  var E = BP.Expr;
  var TAU = 2 * Math.PI;

  function World(id, seed) {
    this.id = id;
    this.rand = BP.GP.rng(seed == null ? 7 : seed);
    this.noiseFrac = 0;
    this.scale = 1;
    this.H = 1 / 240;
    this.timeScale = 1;                 // how much faster than the interface speed this world runs
    this.sampleEvery = 0.05;
    this.duration = 4;
    this.t = 0;
    this.nextSample = 0;
    this.done = false;
    this.s = null;
    this.probe = null;
    this.probeCount = 0;
    this.trail = [];
    this.maxTrail = 220;
    this.trailTick = 0;
  }

  World.prototype._uniform = function (a, b) { return a + (b - a) * this.rand(); };
  World.prototype._gauss = function () {
    var u = this.rand() || 1e-12, v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  World.prototype.noise = function () { return this.noiseFrac * this.scale * this._gauss(); };

  // Typical size of the target over the domain: sets the scale of the noise.
  World.prototype.computeScale = function () {
    var D = this.domain, pts = [], i, j, self = this;
    if (D.length === 1) {
      for (i = 0; i <= 60; i++) pts.push([D[0][0] + (D[0][1] - D[0][0]) * i / 60]);
    } else {
      for (i = 0; i <= 24; i++) for (j = 0; j <= 24; j++) {
        pts.push([D[0][0] + (D[0][1] - D[0][0]) * i / 24, D[1][0] + (D[1][1] - D[1][0]) * j / 24]);
      }
    }
    var s2 = 0, cnt = 0;
    pts.forEach(function (p) { var y = self.target(p); if (isFinite(y)) { s2 += y * y; cnt++; } });
    this.scale = Math.sqrt(s2 / Math.max(1, cnt)) || 1;
  };

  World.prototype.inputsOf = function (s) { return s.slice(0, this.dim); };
  World.prototype.terminal = function () { return false; };
  World.prototype._probeInit = function () {};

  // One classical Runge–Kutta step of size h on this.s.
  World.prototype._rk4 = function (h) {
    var s = this.s, n = s.length, i;
    var k1 = this.deriv(s), k2, k3, k4, t = new Array(n), out = new Array(n);
    for (i = 0; i < n; i++) t[i] = s[i] + 0.5 * h * k1[i];
    k2 = this.deriv(t);
    for (i = 0; i < n; i++) t[i] = s[i] + 0.5 * h * k2[i];
    k3 = this.deriv(t);
    for (i = 0; i < n; i++) t[i] = s[i] + h * k3[i];
    k4 = this.deriv(t);
    for (i = 0; i < n; i++) out[i] = s[i] + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    this.s = out;
  };

  World.prototype._sample = function (out) {
    var x = this.inputsOf(this.s);
    var y = this.target(x);
    if (!isFinite(y)) return;
    out.push({ x: x, y: y + this.noise() });
  };

  World.prototype._after = function (out) {
    if (this.terminal(this.s)) { this.done = true; return; }
    while (this.t + 1e-9 >= this.nextSample && this.nextSample <= this.duration + 1e-9) {
      this._sample(out);
      this.nextSample += this.sampleEvery;
    }
    if (++this.trailTick % 4 === 0) {
      this.trail.push(this.s.slice());
      if (this.trail.length > this.maxTrail) this.trail.shift();
    }
    if (this.t >= this.duration - 1e-9) this.done = true;
  };

  World.prototype.advance = function (dt) {
    var out = [], rem = dt, h;
    if (!this.s) return out;
    while (rem > 1e-12 && !this.done) {
      h = Math.min(this.H, rem);
      this._rk4(h);
      this.t += h;
      rem -= h;
      this._after(out, h);
    }
    return out;
  };

  World.prototype.beginProbe = function (p) {
    this.probe = p.slice();
    this.s = this.initState(p);
    this.t = 0;
    this.nextSample = 0;
    this.done = false;
    this.trail = [];
    this.trailTick = 0;
    this.probeCount++;
    this._probeInit();
  };

  // ---- 1. Pendulum: θ̈ = −k sin θ − b θ̇ ----------------------------------
  function Pendulum(seed) {
    World.call(this, 'pendulum', seed);
    this.k = this._uniform(4, 16);       // g / L
    this.b = this._uniform(0.02, 0.2);   // damping
    this.dim = 2;
    this.inputNames = ['θ', 'ω'];
    this.targetName = 'θ̈';
    this.domain = [[-Math.PI, Math.PI], [-8, 8]];
    this.duration = 4;
    this.truthText = 'θ̈ = −' + E.fmt(this.k) + '·sin θ − ' + E.fmt(this.b) + '·θ̇';
    this.computeScale();
  }
  Pendulum.prototype = Object.create(World.prototype);
  Pendulum.prototype.constructor = Pendulum;
  Pendulum.prototype.deriv = function (s) { return [s[1], this.target(s)]; };
  Pendulum.prototype.target = function (p) { return -this.k * Math.sin(p[0]) - this.b * p[1]; };
  Pendulum.prototype.initState = function (p) { return [p[0], p[1]]; };

  // ---- 2. Duffing spring: ẍ = −k x − β x³ − c ẋ ---------------------------
  function Duffing(seed) {
    World.call(this, 'duffing', seed);
    this.k = this._uniform(1.5, 6);
    this.beta = this._uniform(0.3, 1.5);
    this.c = this._uniform(0.05, 0.4);
    this.dim = 2;
    this.inputNames = ['x', 'v'];
    this.targetName = 'ẍ';
    this.domain = [[-2.5, 2.5], [-5, 5]];
    this.duration = 6;
    this.truthText = 'ẍ = −' + E.fmt(this.k) + '·x − ' + E.fmt(this.beta) + '·x³ − ' + E.fmt(this.c) + '·ẋ';
    this.computeScale();
  }
  Duffing.prototype = Object.create(World.prototype);
  Duffing.prototype.constructor = Duffing;
  Duffing.prototype.deriv = function (s) { return [s[1], this.target(s)]; };
  Duffing.prototype.target = function (p) {
    return -this.k * p[0] - this.beta * p[0] * p[0] * p[0] - this.c * p[1];
  };
  Duffing.prototype.initState = function (p) { return [p[0], p[1]]; };

  // ---- 3. Newtonian gravity: |a| = μ / r² (2-D orbit) ---------------------
  function Orbit(seed) {
    World.call(this, 'orbit', seed);
    this.mu = this._uniform(2, 8);
    this.dim = 2;
    this.inputNames = ['r', 'v'];
    this.targetName = '|a|';
    this.domain = [[0.5, 4], [0, 3]];
    this.duration = 6;
    this.truthText = '|a| = ' + E.fmt(this.mu) + ' / r²';
    this.computeScale();
  }
  Orbit.prototype = Object.create(World.prototype);
  Orbit.prototype.constructor = Orbit;
  Orbit.prototype.deriv = function (s) {
    var x = s[0], y = s[1], r3 = Math.pow(x * x + y * y, 1.5);
    return [s[2], s[3], -this.mu * x / r3, -this.mu * y / r3];
  };
  Orbit.prototype.inputsOf = function (s) {
    return [Math.sqrt(s[0] * s[0] + s[1] * s[1]), Math.sqrt(s[2] * s[2] + s[3] * s[3])];
  };
  Orbit.prototype.target = function (p) { return this.mu / (p[0] * p[0]); };
  Orbit.prototype.initState = function (p) { return [p[0], 0, 0, p[1]]; };
  Orbit.prototype.terminal = function (s) {
    var r = Math.sqrt(s[0] * s[0] + s[1] * s[1]);
    return !(r > 0.2 && r < 15);
  };
  // Observed |a| comes from the actual acceleration vector, not the formula.
  Orbit.prototype._sample = function (out) {
    var s = this.s, r3 = Math.pow(s[0] * s[0] + s[1] * s[1], 1.5);
    var amag = this.mu * Math.sqrt(s[0] * s[0] + s[1] * s[1]) / r3;
    if (!isFinite(amag)) return;
    out.push({ x: this.inputsOf(s), y: amag + this.noise() });
  };

  // ---- 4. Falling with quadratic drag: v̇ = −g − c v|v| (1-D) -------------
  function Drag(seed) {
    World.call(this, 'drag', seed);
    this.g = this._uniform(6, 12);
    this.c = this._uniform(0.02, 0.25);
    this.dim = 1;
    this.inputNames = ['v'];
    this.targetName = 'v̇';
    this.domain = [[-12, 12]];
    this.duration = 6;
    this.truthText = 'v̇ = −' + E.fmt(this.g) + ' − ' + E.fmt(this.c) + '·v|v|';
    this.computeScale();
  }
  Drag.prototype = Object.create(World.prototype);
  Drag.prototype.constructor = Drag;
  Drag.prototype.deriv = function (s) { return [s[1], this.target([s[1]])]; };
  Drag.prototype.target = function (p) { var v = p[0]; return -this.g - this.c * v * Math.abs(v); };
  Drag.prototype.inputsOf = function (s) { return [s[1]]; };
  Drag.prototype.initState = function (p) { return [150, p[0]]; };
  Drag.prototype.terminal = function (s) { return s[0] < 0; };

  // ---- 5. Kepler's survey: period of a circular orbit, T(r) --------------
  function Kepler(seed) {
    World.call(this, 'kepler', seed);
    this.mu = this._uniform(2, 8);
    this.dim = 1;
    this.inputNames = ['r'];
    this.targetName = 'T';
    this.domain = [[0.5, 6]];
    this.duration = 1e9;
    this.truthText = 'T = ' + E.fmt(TAU / Math.sqrt(this.mu)) + ' · r^(3/2)';
    this.timeScale = 4;                 // laps are long; fast-forward them
    this.computeScale();
  }
  Kepler.prototype = Object.create(World.prototype);
  Kepler.prototype.constructor = Kepler;
  Kepler.prototype.deriv = function (s) {
    var x = s[0], y = s[1], r3 = Math.pow(x * x + y * y, 1.5);
    return [s[2], s[3], -this.mu * x / r3, -this.mu * y / r3];
  };
  Kepler.prototype.target = function (p) { return TAU * Math.pow(p[0], 1.5) / Math.sqrt(this.mu); };
  Kepler.prototype.inputsOf = function (s) { return [Math.sqrt(s[0] * s[0] + s[1] * s[1])]; };
  Kepler.prototype.initState = function (p) {
    var r = p[0];
    return [r, 0, 0, Math.sqrt(this.mu / r)];
  };
  Kepler.prototype._probeInit = function () { this.acc = 0; this.prevAng = 0; this.r0 = this.probe[0]; };
  // One probe = one revolution. The period is read off the moment the
  // unwrapped polar angle completes a full turn (interpolated within the step).
  Kepler.prototype._after = function (out, h) {
    var s = this.s, ang = Math.atan2(s[1], s[0]), d = ang - this.prevAng;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    var accPrev = this.acc;
    this.acc += d;
    this.prevAng = ang;
    if (++this.trailTick % 4 === 0) {
      this.trail.push(s.slice());
      if (this.trail.length > this.maxTrail) this.trail.shift();
    }
    if (!this.done && this.acc >= TAU && d > 0) {
      var frac = (TAU - accPrev) / d;
      var T = (this.t - h) + frac * h;
      out.push({ x: [this.r0], y: T + this.noise() });
      this.done = true;
    }
    if (this.t > 400) this.done = true;
  };

  // ---- 6. A law typed by the visitor: ẍ = f(x, v) -------------------------
  function Custom(seed, tree, text) {
    World.call(this, 'custom', seed);
    this.tree = tree;
    this.dim = 2;
    this.inputNames = ['x', 'v'];
    this.targetName = 'ẍ';
    this.domain = [[-3, 3], [-3, 3]];
    this.duration = 6;
    this.truthText = 'ẍ = ' + E.show(E.tidy(tree), this.inputNames, true);
    this.text = text;
    this.computeScale();
  }
  Custom.prototype = Object.create(World.prototype);
  Custom.prototype.constructor = Custom;
  Custom.prototype.deriv = function (s) { return [s[1], this.target(s)]; };
  Custom.prototype.target = function (p) { return E.ev(this.tree, p); };
  Custom.prototype.initState = function (p) { return [p[0], p[1]]; };
  Custom.prototype.terminal = function (s) {
    return !(isFinite(s[0]) && isFinite(s[1]) && Math.abs(s[0]) < 80 && Math.abs(s[1]) < 80);
  };

  // ---- catalogue ----------------------------------------------------------
  var CATALOGUE = [
    { id: 'pendulum', title: 'Pendulum', blurb: 'A bob on a rod, swinging under gravity and friction.' },
    { id: 'duffing', title: 'Stiff spring', blurb: 'A mass on a spring that stiffens as it stretches.' },
    { id: 'orbit', title: 'Gravity', blurb: 'A body circling a massive star. Its speed is a red herring.' },
    { id: 'drag', title: 'Falling', blurb: 'A body dropped through air. Air resistance grows with speed.' },
    { id: 'kepler', title: 'Orbital periods', blurb: 'Circular orbits at many radii. How long does each lap take?' },
    { id: 'custom', title: 'Your law', blurb: 'A law you type. The machine has never heard of it.' }
  ];

  function create(id, seed, formula) {
    switch (id) {
      case 'pendulum': return new Pendulum(seed);
      case 'duffing': return new Duffing(seed);
      case 'orbit': return new Orbit(seed);
      case 'drag': return new Drag(seed);
      case 'kepler': return new Kepler(seed);
      case 'custom': {
        var tree = E.parse(formula || '-x - 0.5*v', ['x', 'v']);
        return new Custom(seed, tree, formula);
      }
    }
    throw new Error('unknown world ' + id);
  }

  BP.Worlds = { create: create, CATALOGUE: CATALOGUE, World: World };
})();
