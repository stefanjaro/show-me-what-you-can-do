/*!
 * CONTINUUM CA-7 - rig.js
 * The front panel: blocks, knobs, jacks, cords, displays.
 * Everything here talks to the circuit data; site.js owns the solver.
 */
(function (root) {
  'use strict';
  var CA7 = root.CA7;

  var CABLE_COLORS = [
    '#e5473f', '#f5c542', '#4d9de0', '#48c774',
    '#e9e9e9', '#b06ae0', '#ff8a3d', '#4fd1c5'
  ];
  var INNER_W = 1080, PANEL_W = 620;
  var MIN_SCALE = 0.58;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) text = String(text), e.textContent = text;
    return e;
  }

  function fmtNum(v) {
    var a = Math.abs(v);
    if (!isFinite(v)) return '--';
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a === 0) return '0';
    return v.toPrecision(2);
  }

  function fmtKnob(ko, v) {
    var a = Math.abs(v), s;
    if (ko.range === 'freq') s = a < 10 ? v.toFixed(2) : v.toFixed(1);
    else if (ko.range === 'level') s = v.toFixed(2);
    else if (ko.range === 'tdiv') s = v.toFixed(2);
    else if (ko.range === 'vdiv') s = v.toFixed(2);
    else s = fmtNum(v);
    return s + (ko.unit || '');
  }

  function fmtVolt(v) {
    if (!isFinite(v)) return '--';
    var s = (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1));
    return s + ' V';
  }

  var Rig = {
    circuit: null,
    cb: {},
    scale: 1,
    jacks: {},
    knobs: [],
    sigs: [],
    mods: {},

    /* ------------------------------------------------------------ mount */
    mount: function (circuit, cb) {
      this.circuit = circuit;
      this.cb = cb || {};
      this.$ = {
        rig: document.getElementById('rig'),
        inner: document.getElementById('rigInner'),
        panel: document.getElementById('panel'),
        mods: document.getElementById('mods'),
        inst: document.getElementById('rackInst'),
        cables: document.getElementById('cables'),
        plateName: document.getElementById('plateName'),
        plateEq: document.getElementById('plateEq'),
        toolbox: document.getElementById('toolbox')
      };
      this.svgNS = 'http://www.w3.org/2000/svg';
      this.buildToolbox();
      this.render();
      this.bindGlobal();
      return this;
    },

    /* ----------------------------------------------------------- render */
    setCircuit: function (circuit) {
      this.circuit = circuit;
      this.render();
    },

    render: function () {
      var c = this.circuit, self = this;
      this.knobs = this.knobs.filter(function (k) { return k.modId === '__'; });
      this.jacks = {};
      this.sigs = [];
      this.mods = {};
      this.$.mods.innerHTML = '';
      this.$.inst.innerHTML = '';

      var units = {};
      c.modules.forEach(function (m) {
        var spec = CA7.TYPES[m.t];
        if (!spec) return;
        if (spec.rack) units[m.t] = m;
        else self.mountMod(m, self.$.mods);
      });
      CA7.UNIT_ORDER.forEach(function (t) {
        if (units[t]) self.mountMod(units[t], self.$.inst);
      });
      var mm = CA7.findModule(c, 'meter');
      this.meterIn = mm ? mm.id + ':a' : '';
      this.statusIdle = 'hover a jack';
      this.drawCables();
      this.layout();
    },

    mountMod: function (mod, parent) {
      var spec = CA7.TYPES[mod.t];
      var self = this;
      var e = el('div', 'mod mod--' + mod.t);
      e.dataset.id = mod.id;
      if (!spec.rack) {
        e.style.left = mod.x + 'px';
        e.style.top = mod.y + 'px';
        e.style.width = spec.w + 'px';
      }

      /* nameplate */
      var head = el('div', 'mod__head');
      head.appendChild(el('b', '', spec.label));
      if (spec.rack) {
        var src = el('span', 'unit__src', '\u2014');
        src.dataset.src = mod.id;
        head.appendChild(src);
      } else {
        head.appendChild(el('i', '', spec.sub || ''));
        var del = el('button', 'mod__del', '\u00d7');
        del.type = 'button';
        del.title = 'remove this block';
        del.setAttribute('aria-label', 'remove block');
        head.appendChild(del);
      }
      e.appendChild(head);

      if (mod.t === 'xy') e.appendChild(this.screen(380, 130, 'xy'));
      if (mod.t === 'time') e.appendChild(this.screen(380, 105, 'time'));
      if (mod.t === 'meter') e.appendChild(this.meterFace());

      /* inputs */
      var body = el('div', 'mod__body');
      if (spec.inputs && spec.inputs.length) {
        var terms = el('div', 'terms');
        spec.inputs.forEach(function (jack) {
          var t = el('div', 'term');
          var gk = null;
          (spec.knobs || []).forEach(function (k) { if (k.j === jack) gk = k; });
          if (gk) t.appendChild(self.knobEl(mod, gk));
          var j = self.jackEl(mod, jack, 'in');
          t.appendChild(j);
          if (gk) {
            var kv = el('span', 'term__val', fmtKnob(gk, mod.k[gk.id]));
            kv.dataset.kval = mod.id + ':' + gk.id;
            t.appendChild(kv);
          } else {
            var sg = el('span', 'term__sig', '--');
            sg.dataset.sig = mod.id + ':' + jack;
            t.appendChild(sg);
          }
          t.appendChild(el('span', 'term__lbl', (spec.labels && spec.labels[jack]) || jack.toUpperCase()));
          terms.appendChild(t);
        });
        body.appendChild(terms);
      }

      /* extra knobs */
      if (spec.extra && spec.extra.length) {
        var ctl = el('div', 'mod__ctl');
        spec.extra.forEach(function (ko) {
          var box = el('div', 'ctl');
          box.appendChild(self.knobEl(mod, ko));
          var v = el('span', 'ctl__val', fmtKnob(ko, mod.k[ko.id]));
          v.dataset.kval = mod.id + ':' + ko.id;
          box.appendChild(v);
          box.appendChild(el('span', 'ctl__lbl', ko.label));
          ctl.appendChild(box);
        });
        body.appendChild(ctl);
      }

      /* mode switches */
      if (spec.modes) {
        var modes = el('div', 'modes');
        spec.modes.forEach(function (id) {
          var b = el('button', 'mode', (spec.modeLabels && spec.modeLabels[id]) || id);
          b.type = 'button';
          b.dataset.mode = mod.id + ':' + id;
          b.setAttribute('aria-pressed', String((mod.mode || spec.modes[0]) === id));
          modes.appendChild(b);
        });
        body.appendChild(modes);
      }

      if (mod.t === 'audio') {
        var power = el('button', 'btn btn--audio', 'ENABLE AUDIO');
        power.type = 'button';
        power.dataset.act = 'audio';
        body.appendChild(power);
      }

      e.appendChild(body);

      /* outputs */
      if (!spec.rack && spec.outputs && spec.outputs.length) {
        var foot = el('div', 'mod__foot');
        if (spec.outputs.length === 1) {
          var mark = el('span', 'outmark');
          mark.appendChild(this.jackEl(mod, spec.outputs[0], 'out'));
          mark.appendChild(el('span', '', 'OUT'));
          foot.appendChild(mark);
          var ov = el('span', 'outval', '--');
          ov.dataset.sig = mod.id + ':' + spec.outputs[0];
          foot.appendChild(ov);
        } else {
          var oterms = el('div', 'terms');
          var self2 = this;
          spec.outputs.forEach(function (o) {
            var t = el('div', 'term');
            var cls = o === 'g' ? 'gnd' : (o === 'p' ? 'pos' : (o === 'n' ? 'neg' : 'out'));
            t.appendChild(self2.jackEl(mod, o, cls));
            var sv = el('span', 'term__sig', '--');
            sv.dataset.sig = mod.id + ':' + o;
            t.appendChild(sv);
            t.appendChild(el('span', 'term__lbl',
              (spec.outLabels && spec.outLabels[o]) || o.toUpperCase()));
            oterms.appendChild(t);
          });
          foot.appendChild(oterms);
        }
        e.appendChild(foot);
      }

      parent.appendChild(e);
      this.mods[mod.id] = e;
    },

    screen: function (w, h, kind) {
      var wrap = el('div', 'screen');
      var cv = el('canvas');
      cv.width = w;
      cv.height = h;
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      cv.dataset.screen = kind;
      wrap.appendChild(cv);
      return wrap;
    },

    /* ---------------------------------------------------------- elements */
    knobEl: function (mod, ko) {
      var u = CA7.valueToU(mod.k[ko.id] === undefined ? CA7.RANGES[ko.range].def : mod.k[ko.id],
        CA7.RANGES[ko.range]);
      var w = el('div', 'knob' + (ko.big ? ' knob--big' : ''));
      w.tabIndex = 0;
      w.setAttribute('role', 'slider');
      w.setAttribute('aria-label', (CA7.TYPES[mod.t].label + ' ' + mod.id + ' ' + ko.label).trim());
      w.setAttribute('aria-valuemin', String(CA7.RANGES[ko.range].min));
      w.setAttribute('aria-valuemax', String(CA7.RANGES[ko.range].max));
      w.dataset.knob = mod.id + ':' + ko.id;
      w.dataset.u = String(u);
      w.style.setProperty('--a', (u * 135) + 'deg');
      w.appendChild(el('div', 'knob__cap'));
      this.knobs.push({ el: w, modId: mod.id, key: ko.id, def: ko });
      return w;
    },

    jackEl: function (mod, jack, cls) {
      var b = el('button', 'jack jack--' + cls);
      b.type = 'button';
      b.dataset.jack = mod.id + ':' + jack;
      b.dataset.dir = cls === 'in' ? 'in' : 'out';
      b.setAttribute('aria-label',
        (cls === 'in' ? 'input ' : 'output ') + jack.toUpperCase() + ' on ' + mod.id);
      this.jacks[mod.id + ':' + jack] = b;
      return b;
    },

    meterFace: function () {
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'meterface');
      svg.setAttribute('viewBox', '0 0 200 92');
      var g = document.createElementNS(NS, 'g');
      var arc = document.createElementNS(NS, 'path');
      arc.setAttribute('d', 'M 24 74 A 78 78 0 0 1 176 74');
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke', '#3a4048');
      arc.setAttribute('stroke-width', '2');
      g.appendChild(arc);
      var i, ang, x1, y1, x2, y2, line;
      for (i = -10; i <= 10; i += 2) {
        ang = (i / 10) * 50 * Math.PI / 180;
        var long = (i % 10 === 0 || i === 0);
        var r0 = long ? 62 : 68, r1 = 74;
        x1 = 100 + Math.sin(ang) * r0;
        y1 = 86 - Math.cos(ang) * r0;
        x2 = 100 + Math.sin(ang) * r1;
        y2 = 86 - Math.cos(ang) * r1;
        line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', x1.toFixed(1)); line.setAttribute('y1', y1.toFixed(1));
        line.setAttribute('x2', x2.toFixed(1)); line.setAttribute('y2', y2.toFixed(1));
        line.setAttribute('stroke', i === 0 ? '#ffb454' : '#79818b');
        line.setAttribute('stroke-width', long ? 2 : 1);
        g.appendChild(line);
      }
      var labels = [['-10', 24, 88], ['0', 96, 16], ['+10', 164, 88]];
      labels.forEach(function (L) {
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('x', L[1]); t.setAttribute('y', L[2]);
        t.setAttribute('fill', '#79818b');
        t.setAttribute('font-size', '9');
        t.setAttribute('font-family', 'ui-monospace,monospace');
        t.setAttribute('text-anchor', 'middle');
        t.textContent = L[0];
        g.appendChild(t);
      });
      var needle = document.createElementNS(NS, 'line');
      needle.setAttribute('x1', '100'); needle.setAttribute('y1', '86');
      needle.setAttribute('x2', '100'); needle.setAttribute('y2', '14');
      needle.setAttribute('stroke', '#ffcf8a');
      needle.setAttribute('stroke-width', '2');
      needle.setAttribute('stroke-linecap', 'round');
      needle.dataset.needle = '1';
      g.appendChild(needle);
      var hub = document.createElementNS(NS, 'circle');
      hub.setAttribute('cx', '100'); hub.setAttribute('cy', '86');
      hub.setAttribute('r', '5');
      hub.setAttribute('fill', '#2b3038');
      hub.setAttribute('stroke', '#0d0f12');
      g.appendChild(hub);
      svg.appendChild(g);
      return svg;
    },

    /* ------------------------------------------------------------ cords */
    posOf: function (elm) {
      var r = elm.getBoundingClientRect();
      var ir = this.$.inner.getBoundingClientRect();
      var s = this.scale || 1;
      return {
        x: (r.left + r.width / 2 - ir.left) / s,
        y: (r.top + r.height / 2 - ir.top) / s
      };
    },

    sag: function (p, q) {
      var dx = q.x - p.x, dy = q.y - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var drop = Math.min(96, 18 + dist * 0.17);
      return 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) +
        ' Q' + ((p.x + q.x) / 2).toFixed(1) + ' ' + ((p.y + q.y) / 2 + drop).toFixed(1) +
        ' ' + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
    },

    cordPath: function (g, d, color) {
      var NS = this.svgNS;
      ['cord-hit', 'cord', 'cord-gloss'].forEach(function (cls) {
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('class', cls);
        p.setAttribute('d', d);
        if (cls !== 'cord-hit') p.setAttribute('stroke', cls === 'cord' ? color : 'none');
        g.appendChild(p);
      });
    },

    drawCables: function () {
      var svg = this.$.cables, self = this;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      Object.keys(this.jacks).forEach(function (k) {
        self.jacks[k].classList.remove('is-plugged');
      });
      this.circuit.wires.forEach(function (w, i) {
        var a = self.jacks[w[0]], b = self.jacks[w[1]];
        if (!a || !b) return;
        if (w[2] === undefined) w[2] = i % CABLE_COLORS.length;
        var color = CABLE_COLORS[w[2] % CABLE_COLORS.length];
        var p = self.posOf(a), q = self.posOf(b);
        var g = document.createElementNS(self.svgNS, 'g');
        g.setAttribute('class', 'cord');
        g.dataset.w = String(i);
        self.cordPath(g, self.sag(p, q), color);
        [[p, color], [q, color]].forEach(function (pair) {
          var c = document.createElementNS(self.svgNS, 'circle');
          c.setAttribute('class', 'plug');
          c.setAttribute('cx', pair[0].x.toFixed(1));
          c.setAttribute('cy', pair[0].y.toFixed(1));
          c.setAttribute('r', '4.4');
          c.setAttribute('fill', pair[1]);
          g.appendChild(c);
        });
        svg.appendChild(g);
        if (b.dataset.dir === 'in') b.classList.add('is-plugged');
      });
      if (this.ghost) svg.appendChild(this.ghost);
    },

    ghostPath: function (fromKey, x, y) {
      var a = this.jacks[fromKey];
      if (!a) return;
      var p = this.posOf(a);
      var NS = this.svgNS;
      if (!this.ghost) {
        this.ghost = document.createElementNS(NS, 'g');
        this.ghost.setAttribute('class', 'cord ghost');
        this.ghostColor = CABLE_COLORS[this.nextColor % CABLE_COLORS.length];
        this.cordPath(this.ghost, '', this.ghostColor);
      }
      var d = this.sag(p, { x: x, y: y });
      var paths = this.ghost.querySelectorAll('path');
      for (var i = 0; i < paths.length; i++) {
        paths[i].setAttribute('d', d);
        if (paths[i].getAttribute('class') === 'cord-gloss') paths[i].setAttribute('stroke', 'none');
      }
      var circ = this.ghost.querySelector('circle');
      if (circ) { circ.setAttribute('cx', p.x.toFixed(1)); circ.setAttribute('cy', p.y.toFixed(1)); }
      if (!this.ghost.parentNode) this.$.cables.appendChild(this.ghost);
    },

    clearGhost: function () {
      if (this.ghost && this.ghost.parentNode) this.ghost.parentNode.removeChild(this.ghost);
      this.ghost = null;
    },

    /* ---------------------------------------------------------- toolbox */
    buildToolbox: function () {
      var self = this;
      var box = this.$.toolbox;
      box.innerHTML = '';
      CA7.TYPE_ORDER.forEach(function (t) {
        var spec = CA7.TYPES[t];
        var b = el('button', 'tool');
        b.type = 'button';
        b.dataset.add = t;
        b.appendChild(el('span', 'plus', '+'));
        b.appendChild(document.createTextNode(spec.label));
        box.appendChild(b);
      });
    },

    /* ----------------------------------------------------------- layout */
    layout: function () {
      var avail = this.$.rig.clientWidth || INNER_W;
      var inner = this.$.inner;
      var column = avail < INNER_W;
      inner.classList.toggle('is-column', column);
      var basis = column ? 660 : INNER_W;
      var s = Math.min(1, avail / basis);
      if (s < MIN_SCALE) s = MIN_SCALE;
      this.scale = s;
      inner.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      var h = inner.offsetHeight;
      this.$.rig.style.height = Math.ceil(h * s) + 'px';
      this.$.rig.style.overflowX = (avail / basis < MIN_SCALE) ? 'auto' : 'hidden';
      this.collect();
      if (this.onLayout) this.onLayout();
    },

    collect: function () {
      var self = this;
      this.sigs = this.$.inner.querySelectorAll('[data-sig]');
      this.kvals = {};
      var kv = this.$.inner.querySelectorAll('[data-kval]');
      for (var i = 0; i < kv.length; i++) this.kvals[kv[i].dataset.kval] = kv[i];
      this.srcs = this.$.inner.querySelectorAll('[data-src]');
      this.needle = this.$.inner.querySelector('[data-needle]');
      this.knobs.forEach(function (k) { k.el = self.$.inner.querySelector('[data-knob="' + k.modId + ':' + k.key + '"]') || k.el; });
    },

    /* ----------------------------------------------------- live readouts */
    refresh: function (m) {
      var i, elm, key, v;
      for (i = 0; i < this.sigs.length; i++) {
        elm = this.sigs[i];
        key = elm.dataset.sig;
        v = readSignal(m, key);
        elm.textContent = v.open ? '\u2014'
          : (elm.classList.contains('term__sig') ? CA7._fmtNum(v.v) : CA7._fmtVolt(v.v));
      }
      for (i = 0; i < this.srcs.length; i++) {
        this.srcs[i].textContent = srcLabel(m, this.srcs[i].dataset.src);
      }
      if (this.needle) {
        var mv = readSignal(m, this.meterIn || '');
        var deg = Math.max(-50, Math.min(50, (mv.open ? 0 : mv.v) * 5));
        this.needle.setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 100 86)');
      }
    },

    setKnobValue: function (modId, key, v) {
      var rec = null;
      for (var i = 0; i < this.knobs.length; i++) {
        if (this.knobs[i].modId === modId && this.knobs[i].key === key) { rec = this.knobs[i]; break; }
      }
      if (!rec) return;
      var u = CA7.valueToU(v, CA7.RANGES[rec.def.range]);
      rec.el.dataset.u = String(u);
      rec.el.style.setProperty('--a', (u * 135) + 'deg');
      rec.el.setAttribute('aria-valuenow', String(v));
      this.setKnobLabel(modId, key, v);
    },

    setKnobLabel: function (modId, key, v) {
      var elm = this.kvals[modId + ':' + key];
      if (!elm) return;
      var rec = null;
      for (var i = 0; i < this.knobs.length; i++) {
        if (this.knobs[i].modId === modId && this.knobs[i].key === key) { rec = this.knobs[i]; break; }
      }
      if (rec) elm.textContent = CA7._fmtKnob(rec.def, v);
    },

    setStatus: function (text) {
      var e = document.getElementById('roSig');
      if (e) e.textContent = text;
    },

    setTime: function (t) {
      var e = document.getElementById('roTime');
      if (e) e.textContent = 't ' + t.toFixed(3) + ' s';
    },

    setLamps: function (sat, loop) {
      var a = document.getElementById('lampSat'), b = document.getElementById('lampLoop');
      if (a) a.hidden = !sat;
      if (b) b.hidden = !loop;
    },

    setPlate: function (name, eqs) {
      this.$.plateName.textContent = name;
      this.$.plateEq.textContent = eqs || '';
    },

    hint: function (show) {
      var p = this.$.panel.querySelector('.panel__hint');
      if (show && !p) {
        p = el('div', 'panel__hint', 'The panel is empty \u2014 add a block below');
        this.$.panel.appendChild(p);
      } else if (!show && p) p.remove();
    }
  };

  /* ==================================================== interactions == */

  function findKnob(elm) {
    var list = Rig.knobs;
    for (var i = 0; i < list.length; i++) if (list[i].el === elm) return list[i];
    return null;
  }

  Rig.applyKnob = function (rec, u) {
    u = u < -1 ? -1 : (u > 1 ? 1 : u);
    var range = CA7.RANGES[rec.def.range];
    rec.el.dataset.u = String(u);
    rec.el.style.setProperty('--a', (u * 135) + 'deg');
    var v = CA7.uToValue(u, range);
    rec.el.setAttribute('aria-valuenow', fmtNum(v));
    this.setKnobLabel(rec.modId, rec.key, v);
    if (this.cb.knob) this.cb.knob(rec.modId, rec.key, v);
  };

  Rig.knobTip = function (knob, on, text) {
    var tip = knob.querySelector('.knob-tip');
    if (!on) { if (tip) tip.parentNode.removeChild(tip); return; }
    if (!tip) { tip = el('div', 'knob-tip'); knob.appendChild(tip); }
    if (text !== undefined) tip.textContent = text;
  };

  Rig.knobDown = function (elm, e) {
    var self = this;
    var rec = findKnob(elm);
    if (!rec) return;
    elm.classList.add('is-live');
    if (elm.setPointerCapture) elm.setPointerCapture(e.pointerId);
    var u0 = parseFloat(elm.dataset.u), x0 = e.clientX, y0 = e.clientY;
    var range = CA7.RANGES[rec.def.range];
    self.knobTip(elm, true, CA7._fmtKnob(rec.def, CA7.uToValue(u0, range)));

    function move(ev) {
      var du = ((y0 - ev.clientY) + (ev.clientX - x0)) / 130;
      if (ev.shiftKey) du *= 0.15;
      var u = Math.max(-1, Math.min(1, u0 + du));
      self.applyKnob(rec, u);
      self.knobTip(elm, true, CA7._fmtKnob(rec.def, CA7.uToValue(u, range)));
    }
    function up(ev) {
      elm.classList.remove('is-live');
      if (elm.releasePointerCapture) {
        try { elm.releasePointerCapture(ev.pointerId); } catch (err) { /* gone */ }
      }
      self.knobTip(elm, false);
      elm.removeEventListener('pointermove', move);
      elm.removeEventListener('pointerup', up);
      elm.removeEventListener('pointercancel', up);
    }
    elm.addEventListener('pointermove', move);
    elm.addEventListener('pointerup', up);
    elm.addEventListener('pointercancel', up);
  };

  Rig.jackAtPoint = function (cx, cy, r) {
    var q = this.innerPoint({ clientX: cx, clientY: cy });
    var best = null, bestD = r * r;
    for (var key in this.jacks) {
      var el = this.jacks[key];
      if (!el.isConnected) continue;
      var pt = this.posOf(el);
      var dx = pt.x - q.x, dy = pt.y - q.y, d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = el; }
    }
    return best;
  };

  Rig.knobAtPoint = function (cx, cy, r) {
    var q = this.innerPoint({ clientX: cx, clientY: cy });
    var best = null, bestD = r * r;
    for (var i = 0; i < this.knobs.length; i++) {
      var el = this.knobs[i].el;
      if (!el || !el.isConnected) continue;
      var pt = this.posOf(el);
      var dx = pt.x - q.x, dy = pt.y - q.y, d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = el; }
    }
    return best;
  };

  Rig.innerPoint = function (e) {
    var ir = this.$.inner.getBoundingClientRect();
    var s = this.scale || 1;
    return { x: (e.clientX - ir.left) / s, y: (e.clientY - ir.top) / s };
  };

  Rig.startCord = function (fromKey, existingKey, e) {
    var self = this;
    this.dragging = { from: fromKey, to: existingKey || null };
    this.$.cables.classList.add('is-live');
    var idx = 0;
    for (var i = 0; i < this.circuit.wires.length; i++) idx = i;
    this.nextColor = existingKey
      ? (function () {
        for (var j = 0; j < self.circuit.wires.length; j++) {
          if (self.circuit.wires[j][1] === existingKey) return self.circuit.wires[j][2] !== undefined
            ? self.circuit.wires[j][2] : j % CABLE_COLORS.length;
        }
        return 0;
      })()
      : (this.circuit.wires.length % CABLE_COLORS.length);
    this.ghost = null;
    this.hotJack = null;

    var target = null;

    function highlight() {
      if (self.hotJack === target) return;
      if (self.hotJack) self.hotJack.classList.remove('is-target');
      self.hotJack = target;
      if (target) target.classList.add('is-target');
    }

    function move(ev) {
      var p = self.innerPoint(ev);
      self.ghostPath(fromKey, p.x, p.y);
      var el2 = document.elementFromPoint(ev.clientX, ev.clientY);
      var j = el2 && el2.closest ? el2.closest('[data-jack]') : null;
      target = (j && j.dataset.dir === 'in') ? j : null;
      highlight();
    }
    function up(ev) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (self.hotJack) self.hotJack.classList.remove('is-target');
      var landed = self.jackAtPoint(ev.clientX, ev.clientY, 17);
      if (landed && landed.dataset.dir !== 'in') landed = null;
      self.hotJack = null;
      self.clearGhost();
      self.$.cables.classList.remove('is-live');
      self.dragging = null;

      self.hotJack = null;
      var to = landed ? landed.dataset.jack : null;
      if (to && to !== fromKey) {
        if (CA7.connect(self.circuit, fromKey, to)) {
          var w = self.circuit.wires[self.circuit.wires.length - 1];
          if (w[2] === undefined) w[2] = self.nextColor;
          self.afterEdit('wires');
        }
      } else if (existingKey) {
        if (CA7.disconnect(self.circuit, existingKey)) self.afterEdit('wires');
      }
      self.drawCables();
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    move(e);
  };

  Rig.afterEdit = function (kind) {
    if (this.cb.edited) this.cb.edited(kind);
  };

  Rig.modDown = function (modEl, def, e) {
    var self = this;
    var spec = CA7.TYPES[def.t];
    var fieldH = this.$.mods.clientHeight;
    var sx = e.clientX, sy = e.clientY, x0 = def.x, y0 = def.y;
    modEl.classList.add('is-dragging');

    function move(ev) {
      var s = self.scale || 1;
      def.x = Math.max(0, Math.min(PANEL_W - spec.w, x0 + (ev.clientX - sx) / s));
      def.y = Math.max(0, Math.min(fieldH - modEl.offsetHeight, y0 + (ev.clientY - sy) / s));
      modEl.style.left = def.x + 'px';
      modEl.style.top = def.y + 'px';
      self.drawCables();
    }
    function up() {
      modEl.classList.remove('is-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      self.afterEdit('move');
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  Rig.jackStatus = function (jack, on) {
    if (!on) { this.setStatus(this.statusIdle || 'hover a jack'); return; }
    var key = jack.dataset.jack;
    var m = this.net;
    if (!m) return;
    var dir = jack.dataset.dir;
    if (dir === 'out') {
      var v = m.val[key];
      this.setStatus(key + '  ' + (v === undefined ? '--' : CA7._fmtVolt(v)));
    } else {
      var src = m.inMap[key];
      if (src === undefined) this.setStatus(key + '  open');
      else {
        var sv = m.val[src];
        this.setStatus(key + ' \u2190 ' + src + '  ' + (sv === undefined ? '--' : CA7._fmtVolt(sv)));
      }
    }
  };

  Rig.bindGlobal = function () {
    var self = this;
    var inner = document;

    inner.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (!t.closest) return;
      if (t.closest('.mod__del') || t.closest('.mode') || t.closest('[data-act]')) return;
      var knob = self.knobAtPoint(e.clientX, e.clientY, 17) || t.closest('[data-knob]');
      if (knob) { e.preventDefault(); self.knobDown(knob, e); return; }
      var jack = self.jackAtPoint(e.clientX, e.clientY, 15) || t.closest('[data-jack]');
      if (jack) {
        e.preventDefault();
        if (jack.dataset.dir === 'out') self.startCord(jack.dataset.jack, null, e);
        else {
          var found = null;
          for (var i = 0; i < self.circuit.wires.length; i++) {
            if (self.circuit.wires[i][1] === jack.dataset.jack) { found = i; break; }
          }
          if (found >= 0) self.startCord(self.circuit.wires[found][0], jack.dataset.jack, e);
        }
        return;
      }
      var hit = t.closest('.cord-hit');
      if (hit) {
        e.preventDefault();
        var g = hit.parentNode;
        var w = self.circuit.wires[+g.dataset.w];
        if (w) self.startCord(w[0], w[1], e);
        return;
      }
      var head = t.closest('.mod__head');
      if (head && !head.querySelector('.unit__src')) {
        var mod = head.closest('.mod');
        var def = mod && CA7.findById(self.circuit, mod.dataset.id);
        if (def && !CA7.TYPES[def.t].rack) { e.preventDefault(); self.modDown(mod, def, e); }
      }
    });

    inner.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var del = t.closest('.mod__del');
      if (del) { if (self.cb.remove) self.cb.remove(del.closest('.mod').dataset.id); return; }
      var mode = t.closest('[data-mode]');
      if (mode) {
        var parts = mode.dataset.mode.split(':');
        var def = CA7.findById(self.circuit, parts[0]);
        if (!def) return;
        def.mode = parts[1];
        var sibs = mode.parentNode.querySelectorAll('.mode');
        for (var i = 0; i < sibs.length; i++) {
          sibs[i].setAttribute('aria-pressed', String(sibs[i].dataset.mode === parts[0] + ':' + parts[1]));
        }
        if (self.cb.mode) self.cb.mode(parts[0], parts[1]);
        return;
      }
      var act = t.closest('[data-act]');
      if (act && self.cb.act) { self.cb.act(act.dataset.act, act); return; }
    });

    inner.addEventListener('keydown', function (e) {
      var knob = e.target.closest && e.target.closest('[data-knob]');
      if (!knob) return;
      var rec = findKnob(knob);
      if (!rec) return;
      var step = e.shiftKey ? 0.004 : 0.02;
      var u = parseFloat(knob.dataset.u);
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') u += step;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') u -= step;
      else if (e.key === 'Home') u = -1;
      else if (e.key === 'End') u = 1;
      else if (e.key === 'Enter' || e.key === ' ') u = CA7.valueToU(CA7.RANGES[rec.def.range].def, CA7.RANGES[rec.def.range]);
      else return;
      e.preventDefault();
      self.applyKnob(rec, u);
      self.knobTip(knob, true, CA7._fmtKnob(rec.def, CA7.uToValue(u, CA7.RANGES[rec.def.range])));
      clearTimeout(knob._tipT);
      knob._tipT = setTimeout(function () { self.knobTip(knob, false); }, 900);
    });

    inner.addEventListener('dblclick', function (e) {
      var knob = e.target.closest && e.target.closest('[data-knob]');
      if (!knob) return;
      var rec = findKnob(knob);
      if (!rec) return;
      self.applyKnob(rec, CA7.valueToU(CA7.RANGES[rec.def.range].def, CA7.RANGES[rec.def.range]));
    });

    inner.addEventListener('pointerover', function (e) {
      var jack = e.target.closest && e.target.closest('[data-jack]');
      if (jack) { jack.classList.add('is-hot'); self.jackStatus(jack, true); }
    });
    inner.addEventListener('pointerout', function (e) {
      var jack = e.target.closest && e.target.closest('[data-jack]');
      if (jack) { jack.classList.remove('is-hot'); self.jackStatus(jack, false); }
    });
    inner.addEventListener('focusin', function (e) {
      var jack = e.target.closest && e.target.closest('[data-jack]');
      if (jack) self.jackStatus(jack, true);
    });

    this.$.toolbox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]');
      if (b && self.cb.add) self.cb.add(b.dataset.add);
    });

    window.addEventListener('resize', function () { self.layout(); self.drawCables(); });
  };

  function readSignal(m, key) {
    if (!key) return { open: true };
    if (m.val[key] !== undefined) return { v: m.val[key] };
    var src = m.inMap[key];
    if (src === undefined) return { open: true };
    var v = m.val[src];
    return { v: v === undefined ? 0 : v };
  }

  function srcLabel(m, unitId) {
    var out = [];
    var id = String(unitId).split(':')[0];
    var def = null;
    for (var k in m.mods) { if (k === id) def = m.mods[k]; }
    var spec = def ? def.spec : null;
    if (!spec || !spec.inputs) return '\u2014';
    for (var j = 0; j < spec.inputs.length; j++) {
      var k = unitId + ':' + spec.inputs[j];
      var src = m.inMap[k];
      out.push(src ? String(src).replace(/:o$/, '') : '\u2014');
    }
    return out.join('  \u00b7  ');
  }

  CA7.Rig = Rig;
  CA7._el = el;
  CA7._fmtNum = fmtNum;
  CA7._fmtKnob = fmtKnob;
  CA7._fmtVolt = fmtVolt;
  CA7._readSignal = readSignal;
  CA7.CABLE_COLORS = CABLE_COLORS;
  CA7.INNER_W = INNER_W;
  CA7.PANEL_W = PANEL_W;
  CA7.MIN_SCALE = MIN_SCALE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
