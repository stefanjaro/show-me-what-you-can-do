/*!
 * CONTINUUM CA-7 - engine.js
 * Patch network, solver and recorders.
 */
(function (root) {
  'use strict';
  var CA7 = root.CA7;
  if (!CA7) throw new Error('core.js must load first');

  var RAIL = CA7.RAIL, DT = CA7.DT, TRACE_LEN = CA7.TRACE_LEN;
  var SAMPLE_EVERY = CA7.SAMPLE_EVERY;
  var clamp = CA7.clamp;
  var TYPES = null; // lazy: modules.js may load after this file

  function types() { return TYPES || (TYPES = CA7.TYPES); }

  function inKey(id, jack) { return id + ':' + jack; }

  /* ---------------------------------------------------------------- *
   *  Net - one compiled copy of a circuit
   * ---------------------------------------------------------------- */

  function Net(circuit) {
    this.circuit = circuit;
    this.mods = Object.create(null);
    this.val = Object.create(null);
    this.inMap = Object.create(null);
    this.order = [];
    this.integs = [];
    this.loop = false;
    this.build({ keep: false });
  }

  Net.prototype.build = function (opts) {
    opts = opts || {};
    var T = types();
    var prev = opts.keep ? this.mods : null;
    var c = this.circuit;
    this.mods = Object.create(null);
    this.val = Object.create(null);
    this.inMap = Object.create(null);
    this.order = [];
    this.integs = [];

    for (var i = 0; i < c.modules.length; i++) {
      var def = c.modules[i];
      var spec = T[def.t];
      if (!spec) continue;
      var m = {
        id: def.id, type: def.t, spec: spec, def: def,
        k: Object.create(null), out: 0, phase: 0, latch: -10, state: 0, dstate: 0,
        sat: false,
        mod: !!def.mod
      };
      var knobs = (spec.knobs || []).concat(spec.extra || []);
      for (var j = 0; j < knobs.length; j++) {
        var ko = knobs[j];
        var r = CA7.RANGES[ko.range];
        var v = (def.k && def.k[ko.id] !== undefined) ? def.k[ko.id] : r.def;
        m.k[ko.id] = v;
      }
      if (def.mode) m.mode = def.mode;
      else if (spec.modes) m.mode = spec.modes[0];
      if (prev && prev[def.id]) {
        var p = prev[def.id];
        m.state = p.state; m.phase = p.phase; m.latch = p.latch;
        if (m.mode) m.mode = p.mode;
      } else if (spec.state) {
        m.state = m.k.ic;
      }
      this.mods[def.id] = m;
      if (spec.state) this.integs.push(m);
    }
    this._s0 = new Array(this.integs.length);
    this._k1 = new Array(this.integs.length);
    this._k2 = new Array(this.integs.length);
    this.indexWires();
    this.computeOrder();
  };

  Net.prototype.indexWires = function () {
    var c = this.circuit, map = this.inMap;
    for (var i = 0; i < c.wires.length; i++) {
      var w = c.wires[i];
      if (!w || w.length < 2) continue;
      var from = w[0], to = w[1];
      if (!from || !to) continue;
      var src = from.split(':'), dst = to.split(':');
      if (!this.mods[src[0]] || !this.mods[dst[0]]) continue;
      map[to] = from;
    }
  };

  /* Kahn's algorithm. Integrator outputs are state, so they break every
     loop they take part in; anything still cyclic afterwards is an
     algebraic loop and gets iterated to convergence instead. */
  Net.prototype.computeOrder = function () {
    var ids = Object.keys(this.mods);
    var indeg = Object.create(null), adj = Object.create(null);
    for (var i = 0; i < ids.length; i++) { indeg[ids[i]] = 0; adj[ids[i]] = []; }

    var ws = this.circuit.wires;
    for (var w = 0; w < ws.length; w++) {
      var a = String(ws[w][0]).split(':'), b = String(ws[w][1]).split(':');
      var from = a[0], to = b[0];
      if (!this.mods[from] || !this.mods[to] || from === to) continue;
      if (this.mods[from].spec.state || this.mods[to].spec.state) continue;
      adj[from].push(to);
      indeg[to]++;
    }

    var queue = [], order = [];
    for (var q = 0; q < ids.length; q++) if (indeg[ids[q]] === 0) queue.push(ids[q]);
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      var next = adj[id];
      for (var n = 0; n < next.length; n++) {
        if (--indeg[next[n]] === 0) queue.push(next[n]);
      }
    }

    this.loop = false;
    if (order.length !== ids.length) {
      this.loop = true;
      for (var r = 0; r < ids.length; r++) {
        if (order.indexOf(ids[r]) < 0) order.push(ids[r]);
      }
    }
    this.order = order;
  };

  Net.prototype.tick = function (dt) {
    var T = types();
    for (var id in this.mods) {
      var m = this.mods[id];
      if (m.spec.tick) m.spec.tick(m, dt);
    }
  };

  Net.prototype.get = function (modId, jack) {
    var src = this.inMap[inKey(modId, jack)];
    if (src === undefined) return 0;
    var v = this.val[src];
    return v === undefined ? 0 : v;
  };

  Net.prototype.eval = function () {
    var passes = this.loop ? 6 : 1;
    var T = types();
    for (var p = 0; p < passes; p++) {
      for (var i = 0; i < this.order.length; i++) {
        var m = this.mods[this.order[i]];
        if (!m) continue;
        var self = this;
        var get = function (jack) { return self.get(m.id, jack); };
        var out = m.spec.eval(m, get);
        if (out !== null && typeof out === 'object') {
          for (var j in out) {
            if (out[j] > RAIL || out[j] < -RAIL) m.sat = true;
            var v = clamp(out[j], -RAIL, RAIL);
            m.out = v;
            this.val[inKey(m.id, j)] = v;
          }
        } else {
          if (out > RAIL || out < -RAIL) m.sat = true;
          var val = clamp(out, -RAIL, RAIL);
          m.out = val;
          this.val[inKey(m.id, 'o')] = val;
        }
      }
    }
    for (var d = 0; d < this.integs.length; d++) {
      var im = this.integs[d];
      var self2 = this;
      var get2 = function (jack) { return self2.get(im.id, jack); };
      im.dstate = im.spec.deriv(im, get2);
    }
  };

  /* modulus integrator: state folds back into (-pi, pi], the way a real
     machine used a relay to reset an angular integrator */
  function wrapPi(v) {
    var p = 2 * Math.PI;
    return v - p * Math.round(v / p);
  }

  /* one explicit trapezoidal (Heun) step */
  Net.prototype.step = function (dt) {
    this.tick(dt);
    this.eval();
    var n = this.integs.length;
    var s0 = this._s0, k1 = this._k1, k2 = this._k2;
    var i;
    for (i = 0; i < n; i++) { s0[i] = this.integs[i].state; k1[i] = this.integs[i].dstate; }
    for (i = 0; i < n; i++) {
      var p1 = s0[i] + k1[i] * dt;
      if (p1 > RAIL || p1 < -RAIL) this.integs[i].sat = true;
      this.integs[i].state = clamp(p1, -RAIL, RAIL);
    }
    this.eval();
    for (i = 0; i < n; i++) k2[i] = this.integs[i].dstate;
    for (i = 0; i < n; i++) {
      var p2 = s0[i] + 0.5 * (k1[i] + k2[i]) * dt;
      if (p2 > RAIL || p2 < -RAIL) this.integs[i].sat = true;
      var st = clamp(p2, -RAIL, RAIL);
      this.integs[i].state = this.integs[i].mod ? wrapPi(st) : st;
    }
    this.eval();
  };

  Net.prototype.resetIC = function () {
    for (var i = 0; i < this.integs.length; i++) {
      var im = this.integs[i];
      im.state = im.mod ? wrapPi(im.k.ic) : im.k.ic;
    }
    for (var id in this.mods) {
      var m = this.mods[id];
      m.phase = 0;
      m.latch = -10;
      m.sat = false;
    }
    this.eval();
  };

  Net.prototype.value = function (key) {
    var v = this.val[key];
    return v === undefined ? 0 : v;
  };

  /* id of a block whose output is actually being held against a rail */
  Net.prototype.clipping = function () {
    for (var id in this.mods) {
      if (this.mods[id].sat) return id;
    }
    return null;
  };

  /* ---------------------------------------------------------------- *
   *  Recorder - ring buffers of watched signals (400 Hz)
   * ---------------------------------------------------------------- */

  function Recorder() {
    this.bufs = Object.create(null);
    this.keys = [];
    this.count = 0;
  }

  Recorder.prototype.watch = function (keys) {
    this.keys = keys.slice();
    for (var i = 0; i < keys.length; i++) {
      if (!this.bufs[keys[i]]) this.bufs[keys[i]] = new Float32Array(TRACE_LEN);
    }
  };

  Recorder.prototype.record = function (net) {
    for (var i = 0; i < this.keys.length; i++) {
      var k = this.keys[i];
      var buf = this.bufs[k];
      buf[this.count % TRACE_LEN] = net.value(k);
    }
    this.count++;
  };

  Recorder.prototype.copy = function (key, out, n) {
    var buf = this.bufs[key];
    var avail = Math.min(this.count, TRACE_LEN);
    n = Math.min(n === undefined ? avail : n, avail);
    if (!buf) { for (var z = 0; z < n; z++) out[z] = 0; return n; }
    var start = this.count - n;
    for (var i = 0; i < n; i++) out[i] = buf[(start + i) % TRACE_LEN];
    return n;
  };

  /* ---------------------------------------------------------------- *
   *  Simulation - main + optional shadow (perturbed twin)
   * ---------------------------------------------------------------- */

  function Simulation(circuit, opts) {
    opts = opts || {};
    this.circuit = circuit;
    this.main = new Net(circuit);
    this.shadow = opts.shadow ? new Net(circuit) : null;
    this.recMain = new Recorder();
    this.recShadow = new Recorder();
    this.watchList = [];
    this.t = 0;
    this.acc = 0;
    this.steps = 0;
    this.speed = circuit.speed || 1;
    this.shadowEps = opts.shadowEps || circuit.shadowEps || 4e-4;
    if (this.shadow) this.perturb();
    this.watch(opts.watch || []);
  }

  Simulation.prototype.watch = function (keys) {
    this.watchList = keys.slice();
    this.recMain.watch(keys);
    this.recShadow.watch(keys);
  };

  Simulation.prototype.perturb = function () {
    if (!this.shadow) return;
    var e = this.shadowEps;
    for (var i = 0; i < this.shadow.integs.length; i++) {
      var sm = this.shadow.integs[i];
      var mm = this.main.integs[i];
      sm.state = clamp(mm.state + (mm.state >= 0 ? e : -e), -RAIL, RAIL);
    }
  };

  Simulation.prototype.setShadow = function (on) {
    if (on && !this.shadow) {
      this.shadow = new Net(this.circuit);
      this.perturb();
    } else if (!on) {
      this.shadow = null;
    }
  };

  Simulation.prototype.rebuild = function () {
    this.main.build({ keep: true });
    if (this.shadow) { this.shadow.build({ keep: true }); this.perturb(); }
  };

  Simulation.prototype.reset = function () {
    this.t = 0;
    this.acc = 0;
    this.main.resetIC();
    if (this.shadow) { this.shadow.resetIC(); this.perturb(); }
  };

  Simulation.prototype.stepOnce = function () {
    this.main.step(DT);
    if (this.cap && this.cap.key) {
      this.cap.buf[this.cap.w++ & 16383] = this.main.value(this.cap.key);
    }
    if (this.shadow) this.shadow.step(DT);
    this.t += DT;
    this.steps++;
    if (this.steps % SAMPLE_EVERY === 0) {
      this.recMain.record(this.main);
      if (this.shadow) this.recShadow.record(this.shadow);
    }
  };

  Simulation.prototype.advance = function (wallSeconds) {
    if (!(wallSeconds > 0)) return 0;
    this.acc += wallSeconds * this.speed;
    var n = Math.floor(this.acc / DT);
    if (n > 900) { n = 900; this.acc = n * DT; }
    this.acc -= n * DT;
    for (var i = 0; i < n; i++) this.stepOnce();
    return n;
  };

  Simulation.prototype.value = function (key) { return this.main.value(key); };
  Simulation.prototype.clip = function () { return this.main.clipping(); };

  /* audio capture: every solver step of one signal goes into a ring, so
     the worklet can resample 4 kHz to 48 kHz without aliasing to mush */
  Simulation.prototype.capture = function (key) {
    if (!this.cap) this.cap = { key: '', buf: new Float32Array(16384), w: 0, r: 0 };
    if (key !== this.cap.key) {
      this.cap.key = key || '';
      this.cap.w = 0;
      this.cap.r = 0;
    }
  };

  Simulation.prototype.drain = function (out) {
    var c = this.cap;
    if (!c || !c.key) return 0;
    var avail = c.w - c.r;
    if (avail > 8192) { c.r = c.w - 8192; avail = 8192; }
    var n = Math.min(avail, out.length);
    for (var i = 0; i < n; i++) out[i] = c.buf[(c.r + i) & 16383];
    c.r += n;
    return n;
  };

  /* ---------------------------------------------------------------- *
   *  circuit helpers + share-link serialisation
   * ---------------------------------------------------------------- */

  function clone(circuit) {
    return JSON.parse(JSON.stringify(circuit));
  }

  function nextId(circuit) {
    var used = Object.create(null), i;
    for (i = 0; i < circuit.modules.length; i++) used[circuit.modules[i].id] = 1;
    var n = 1;
    while (used['m' + n]) n++;
    return 'm' + n;
  }

  function addModule(circuit, type, x, y) {
    if (!CA7.TYPES[type]) return null;
    var m = { id: nextId(circuit), t: type, x: x, y: y, k: {} };
    var spec = CA7.TYPES[type];
    var knobs = (spec.knobs || []).concat(spec.extra || []);
    for (var i = 0; i < knobs.length; i++) m.k[knobs[i].id] = CA7.RANGES[knobs[i].range].def;
    if (spec.modes) m.mode = spec.modes[0];
    circuit.modules.push(m);
    return m;
  }

  function removeModule(circuit, id) {
    circuit.modules = circuit.modules.filter(function (m) { return m.id !== id; });
    circuit.wires = circuit.wires.filter(function (w) {
      return String(w[0]).split(':')[0] !== id && String(w[1]).split(':')[0] !== id;
    });
    scrubScope(circuit, id);
  }

  function scrubScope(circuit, id) {
    var s = circuit.scope;
    if (!s) return;
    if (s.xy && s.xy.x && s.xy.x.split(':')[0] === id) s.xy.x = '';
    if (s.xy && s.xy.y && s.xy.y.split(':')[0] === id) s.xy.y = '';
    if (s.time) s.time.ch = s.time.ch.map(function (c) {
      return c && c.split(':')[0] === id ? '' : c;
    });
    if (circuit.audio && circuit.audio.key && circuit.audio.key.split(':')[0] === id) circuit.audio.key = '';
    if (circuit.meter && circuit.meter.key && circuit.meter.key.split(':')[0] === id) circuit.meter.key = '';
  }

  /* connect: replaces whatever was already on the input jack */
  function connect(circuit, from, to) {
    if (!from || !to || from === to) return false;
    var toMod = String(to).split(':')[0], fromMod = String(from).split(':')[0];
    var okFrom = false, okTo = false;
    for (var i = 0; i < circuit.modules.length; i++) {
      var m = circuit.modules[i];
      if (m.id === fromMod) okFrom = true;
      if (m.id === toMod) okTo = true;
    }
    if (!okFrom || !okTo) return false;
    var spec = CA7.TYPES[lookupType(circuit, toMod)];
    if (spec && spec.inputs && spec.inputs.indexOf(String(to).split(':')[1]) < 0) return false;
    circuit.wires = circuit.wires.filter(function (w) { return w[1] !== to; });
    circuit.wires.push([from, to]);
    return true;
  }

  function disconnect(circuit, to) {
    var before = circuit.wires.length;
    circuit.wires = circuit.wires.filter(function (w) { return w[1] !== to; });
    return circuit.wires.length !== before;
  }

  function lookupType(circuit, id) {
    for (var i = 0; i < circuit.modules.length; i++) {
      if (circuit.modules[i].id === id) return circuit.modules[i].t;
    }
    return null;
  }

  function validate(circuit) {
    if (!circuit || !Array.isArray(circuit.modules) || !Array.isArray(circuit.wires)) return false;
    var ids = Object.create(null);
    for (var i = 0; i < circuit.modules.length; i++) {
      var m = circuit.modules[i];
      if (!m || typeof m.id !== 'string' || !CA7.TYPES[m.t]) return false;
      if (ids[m.id]) return false;
      ids[m.id] = true;
    }
    for (var w = 0; w < circuit.wires.length; w++) {
      var wire = circuit.wires[w];
      if (!Array.isArray(wire) || wire.length < 2) return false;
      if (!ids[String(wire[0]).split(':')[0]] || !ids[String(wire[1]).split(':')[0]]) return false;
    }
    if (!isFinite(circuit.speed)) circuit.speed = 1;
    return true;
  }

  function defaultScope() {
    return {
      xy: { x: '', y: '', gx: 1, gy: 1, ox: 0, oy: 0 },
      time: { ch: ['', '', ''], div: 0.5 }
    };
  }

  function encode(circuit) {
    var json = JSON.stringify(circuit);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode(str) {
    try {
      var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var json = decodeURIComponent(escape(atob(b64)));
      var c = JSON.parse(json);
      return validate(c) ? c : null;
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- *
   *  instrument units - the four blocks that live in the right rack.
   *  Presets describe them the friendly way (scope.xy.x = 'x:o'); this
   *  turns that description into real modules and real cords.
   * ---------------------------------------------------------------- */

  var UNITS = ['xy', 'time', 'meter', 'audio'];

  function findModule(c, type) {
    for (var i = 0; i < c.modules.length; i++) if (c.modules[i].t === type) return c.modules[i];
    return null;
  }

  function findById(c, id) {
    for (var i = 0; i < c.modules.length; i++) if (c.modules[i].id === id) return c.modules[i];
    return null;
  }

  function setK(c, type, id, val) {
    var m = findModule(c, type);
    if (m && val !== undefined && val !== null) {
      if (!m.k) m.k = {};
      m.k[id] = val;
    }
  }

  function ensureUnits(c) {
    if (!c || !c.modules) return;
    for (var i = 0; i < UNITS.length; i++) {
      if (!findModule(c, UNITS[i])) {
        var m = addModule(c, UNITS[i], 0, 0);
        m.fixed = true;
      }
    }
    var s = c.scope;
    var xm = findModule(c, 'xy'), tm = findModule(c, 'time');
    var am = findModule(c, 'audio'), mm = findModule(c, 'meter');
    if (s && s.xy) {
      if (s.xy.x && xm) connect(c, s.xy.x, xm.id + ':x');
      if (s.xy.y && xm) connect(c, s.xy.y, xm.id + ':y');
      setK(c, 'xy', 'gx', s.xy.gx);
      setK(c, 'xy', 'gy', s.xy.gy);
      setK(c, 'xy', 'ox', s.xy.ox);
      setK(c, 'xy', 'oy', s.xy.oy);
    }
    if (s && s.time && tm) {
      var jacks = ['a', 'b', 'c'];
      for (var t = 0; t < jacks.length; t++) {
        if (s.time.ch && s.time.ch[t]) connect(c, s.time.ch[t], tm.id + ':' + jacks[t]);
      }
      setK(c, 'time', 'div', s.time.div);
    }
    if (c.audio) {
      if (c.audio.key && am) connect(c, c.audio.key, am.id + ':a');
      if (am) {
        if (c.audio.mode) am.mode = c.audio.mode;
        setK(c, 'audio', 'level', c.audio.level);
      }
    }
    if (c.meter && c.meter.key && mm) connect(c, c.meter.key, mm.id + ':a');
    delete c.scope;
    delete c.audio;
    delete c.meter;
  }

  CA7.Net = Net;
  CA7.Simulation = Simulation;
  CA7.Recorder = Recorder;
  CA7.clone = clone;
  CA7.addModule = addModule;
  CA7.removeModule = removeModule;
  CA7.connect = connect;
  CA7.disconnect = disconnect;
  CA7.lookupType = lookupType;
  CA7.validate = validate;
  CA7.ensureUnits = ensureUnits;
  CA7.findModule = findModule;
  CA7.findById = findById;
  CA7.defaultScope = defaultScope;
  CA7.encode = encode;
  CA7.decode = decode;
  CA7.inKey = inKey;
})(typeof globalThis !== 'undefined' ? globalThis : this);
