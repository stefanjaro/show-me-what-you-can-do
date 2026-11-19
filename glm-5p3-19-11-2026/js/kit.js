/* HILBERT'S GARDEN — instrument kit.
   Shared parts: canvas handling, phase color, controls, the Bloch
   sphere renderer, amplitude bars. Everything hand-rolled. */
(function (global) {
'use strict';
var HG = global.HG;

var K = {};
global.HGK = K;

K.REDUCED = typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- canvas management ---------- */
var registry = [];
K.makeCanvas = function (container, h, ariaLabel) {
  var canvas = document.createElement('canvas');
  if (ariaLabel) canvas.setAttribute('aria-label', ariaLabel);
  else canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = h + 'px';
  container.appendChild(canvas);
  var entry = { canvas: canvas, ctx: canvas.getContext('2d'), h: h, cbs: [] };
  registry.push(entry);
  K.sizeCanvas(entry);
  entry.onResize = function (cb) { entry.cbs.push(cb); cb(entry.w, entry.h); return entry; };
  return entry;
};
K.sizeCanvas = function (entry) {
  var w = Math.max(120, entry.canvas.clientWidth);
  var dpr = window.devicePixelRatio || 1;
  if (dpr > 2) dpr = 2;
  entry.w = w;
  entry.h = entry.h;
  if (entry.canvas.width !== Math.round(w * dpr)) {
    entry.canvas.width = Math.round(w * dpr);
    entry.canvas.height = Math.round(entry.h * dpr);
  }
  entry.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};
window.addEventListener('resize', function () {
  registry.forEach(function (entry) {
    K.sizeCanvas(entry);
    entry.cbs.forEach(function (cb) { cb(entry.w, entry.h); });
  });
});

/* ---------- colors ---------- */
K.hue = function (re, im) {
  return Math.atan2(im, re) * 180 / Math.PI;
};
K.hueCss = function (re, im, alpha, light) {
  var h = K.hue(re, im);
  if (h < 0) h += 360;
  return 'hsla(' + h.toFixed(1) + ',72%,' + (light || 62) + '%,' + (alpha === undefined ? 1 : alpha) + ')';
};
K.hueCssDeg = function (deg, alpha, light) {
  var h = ((deg % 360) + 360) % 360;
  return 'hsla(' + h.toFixed(1) + ',72%,' + (light || 62) + '%,' + (alpha === undefined ? 1 : alpha) + ')';
};

var INK = '#0c111a';
K.INK = INK;
K.amber = function (a) { return 'rgba(220,170,74,' + a + ')'; };
K.cyan = function (a) { return 'rgba(132,216,207,' + a + ')'; };
K.faint = function (a) { return 'rgba(93,107,128,' + a + ')'; };
K.txt = function (a) { return 'rgba(232,227,212,' + a + ')'; };
K.red = function (a) { return 'rgba(226,105,79,' + a + ')'; };

/* ---------- tiny DOM helpers ---------- */
K.el = function (tag, cls, parent) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};
K.tag = function (stage, tagText, badgeText) {
  if (tagText) {
    var t = K.el('div', 'stage-tag', stage);
    t.textContent = tagText;
  }
  if (badgeText) {
    var b = K.el('div', 'stage-badge', stage);
    b.textContent = badgeText;
  }
};

/* ---------- controls ---------- */
K.buttons = function (parent) {
  var row = K.el('div', 'btn-row', parent);
  return {
    add: function (label, cb, opts) {
      var b = K.el('button', (opts && opts.cls ? opts.cls : '') + ' b', row);
      b.type = 'button';
      b.textContent = label;
      if (opts && opts.title) b.title = opts.title;
      if (opts && opts.disabled) b.disabled = true;
      b.addEventListener('click', function () {
        if (b.disabled) return;
        cb(b);
      });
      return b;
    }
  };
};
K.slider = function (parent, o) {
  var label = K.el('div', 'ctl-label', parent);
  label.textContent = o.label;
  var row = K.el('div', 'slider-row', parent);
  var input = K.el('input', '', row);
  input.type = 'range';
  input.min = o.min; input.max = o.max; input.step = o.step || 1;
  input.value = o.value;
  var val = K.el('div', 'sl-val', row);
  function fmt(v) { return o.fmt ? o.fmt(v) : String(v); }
  val.textContent = fmt(parseFloat(input.value));
  input.addEventListener('input', function () {
    var v = parseFloat(input.value);
    val.textContent = fmt(v);
    o.onInput(v);
  });
  return {
    set: function (v) { input.value = v; val.textContent = fmt(v); },
    get: function () { return parseFloat(input.value); },
    input: input
  };
};
K.toggle = function (parent, o) {
  var row = K.el('div', 'toggle-row', parent);
  var tgl = K.el('div', 'tgl' + (o.on ? ' on' : ''), row);
  var lab = K.el('span', 'tgl-label', row);
  lab.textContent = o.label;
  var state = !!o.on;
  function flip() {
    state = !state;
    tgl.classList.toggle('on', state);
    o.onChange(state);
  }
  tgl.addEventListener('click', flip);
  lab.addEventListener('click', flip);
  return {
    get: function () { return state; },
    set: function (v) { state = !!v; tgl.classList.toggle('on', state); }
  };
};
K.selectRow = function (parent, o) {
  if (o.label) {
    var label = K.el('div', 'ctl-label', parent);
    label.textContent = o.label;
  }
  var sel = K.el('select', 'b', parent);
  sel.style.marginBottom = '.6rem';
  o.options.forEach(function (op) {
    var opt = K.el('option', '', sel);
    opt.value = op.v; opt.textContent = op.t;
  });
  sel.value = o.value;
  sel.addEventListener('change', function () { o.onChange(sel.value); });
  return sel;
};

/* ---------- readouts ---------- */
K.readout = function (el) {
  var lines = {};
  return {
    head: function (text) {
      var h = K.el('div', 'ro-head', el);
      h.textContent = text;
    },
    line: function (key, label) {
      var row = K.el('div', 'ro-line', el);
      var k = K.el('span', 'k', row); k.textContent = label;
      var v = K.el('span', 'v', row);
      lines[key] = v;
      return {
        set: function (val, cls) {
          v.textContent = val;
          v.className = 'v' + (cls ? ' ' + cls : '');
        },
        el: v
      };
    },
    note: function (html) {
      var n = K.el('div', 'ro-wide', el);
      n.innerHTML = html;
      return n;
    }
  };
};

/* ---------- pointer drag ---------- */
K.drag = function (el, o) {
  var active = false, lastX = 0, lastY = 0, pid = null;
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', function (e) {
    active = true; lastX = e.clientX; lastY = e.clientY; pid = e.pointerId;
    el.setPointerCapture(pid);
    if (o.onStart) o.onStart();
  });
  el.addEventListener('pointermove', function (e) {
    if (!active) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (o.onMove) o.onMove(dx, dy, e);
  });
  function up(e) {
    if (!active) return;
    active = false;
    if (o.onEnd) o.onEnd();
  }
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return {
    get active() { return active; }
  };
};

/* ---------- animation loop ---------- */
K.loop = function (fn) {
  var running = true, id = null;
  function step(t) {
    if (!running) return;
    var keep = fn(t || performance.now());
    if (keep === false) { running = false; return; }
    id = requestAnimationFrame(step);
  }
  id = requestAnimationFrame(step);
  return {
    stop: function () { running = false; if (id) cancelAnimationFrame(id); }
  };
};
K.tween = function (dur, onUpdate, onDone) {
  var t0 = performance.now();
  var handle = K.loop(function (t) {
    var u = Math.min(1, (t - t0) / dur);
    var e = u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u;
    onUpdate(e);
    if (u >= 1) {
      if (onDone) onDone();
      return false;
    }
  });
  return handle;
};

/* ---------- amplitude bars ---------- */
K.drawBars = function (ctx, rect, probs, phases, o) {
  o = o || {};
  var n = probs.length;
  var gap = n > 32 ? 1 : 2;
  var bw = (rect.w - gap * (n - 1)) / n;
  var baseY = rect.y + rect.h - (o.labelSpace === undefined ? (n <= 16 ? 16 : 4) : o.labelSpace);
  var top = rect.y + 8;
  var scale = o.max || Math.max.apply(null, probs.slice()) || 1;
  if (o.autoMax !== false && scale < 0.18) scale = 0.18;
  var rects = [];
  ctx.strokeStyle = K.faint(0.25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x + 0.5, baseY + 0.5);
  ctx.lineTo(rect.x + rect.w - 0.5, baseY + 0.5);
  ctx.stroke();
  if (o.grid !== false) {
    ctx.strokeStyle = K.faint(0.12);
    for (var g = 1; g <= 3; g++) {
      var gy = Math.round(baseY - (baseY - top) * g / 3) + 0.5;
      ctx.beginPath();
      ctx.moveTo(rect.x + 4, gy);
      ctx.lineTo(rect.x + rect.w - 4, gy);
      ctx.stroke();
    }
  }
  for (var i = 0; i < n; i++) {
    var x = rect.x + i * (bw + gap);
    var p = probs[i];
    var hgt = Math.max(0, (baseY - top) * p / scale);
    var hue = phases ? K.hueCss(phases[i][0], phases[i][1], 0.9) : K.cyan(0.75);
    var hl = o.highlight === i;
    ctx.fillStyle = hue;
    ctx.globalAlpha = hl ? 1 : 0.8;
    ctx.fillRect(x, baseY - hgt, Math.max(1, bw - 0.5), hgt);
    ctx.globalAlpha = 1;
    if (hl) {
      ctx.strokeStyle = K.amber(0.9);
      ctx.strokeRect(x - 1.5, baseY - hgt - 1.5, bw + 2.5, hgt + 2);
    }
    rects.push({ x: x, w: bw, i: i });
    if (n <= 16 && o.labels !== false) {
      ctx.fillStyle = hl ? K.amber(0.95) : K.faint(0.8);
      ctx.font = '9px ' + 'ui-monospace,Menlo,monospace';
      ctx.textAlign = 'center';
      var bs = i.toString(2);
      while (bs.length < Math.log2(n)) bs = '0' + bs;
      ctx.fillText('|' + bs + '⟩', x + bw / 2, baseY + 12);
    }
  }
  return rects;
};

/* ---------- the Bloch sphere ---------- */
function Bloch(entry, o) {
  o = o || {};
  var self = this;
  this.entry = entry;
  this.ctx = entry.ctx;
  this.pad = o.pad || 26;
  this.yaw = o.yaw === undefined ? 0.85 : o.yaw;
  this.pitch = o.pitch === undefined ? 0.32 : o.pitch;
  this.cur = { x: 0, y: 0, z: 1 };
  this.target = { x: 0, y: 0, z: 1 };
  this.trail = [];
  this.flashes = [];
  this.arrows = o.arrows || [];  /* extra static vectors {x,y,z,cls} */
  this.ring = null;              /* {theta} highlight ring at angle */
  this.draggable = o.draggable !== false;
  this.onUserRotate = o.onUserRotate || null;
  this.hue = o.hue || null;      /* override color fn */

  this.loopActive = false;

  if (this.draggable) {
    K.drag(entry.canvas, {
      onMove: function (dx, dy) {
        self.yaw += dx * 0.011;
        self.pitch = Math.max(-1.35, Math.min(1.35, self.pitch + dy * 0.011));
        if (self.onUserRotate) self.onUserRotate();
        self.wake();
      }
    });
  }
  entry.onResize(function () { self.render(); });
}
Bloch.prototype.setTarget = function (x, y, z, snap) {
  this.target = { x: x, y: y, z: z };
  if (snap) this.cur = { x: x, y: y, z: z };
  this.wake();
};
Bloch.prototype.pulse = function () {
  this.flashes.push({ r: 0, a: 0.9, at: { x: this.cur.x, y: this.cur.y, z: this.cur.z } });
  this.wake();
};
Bloch.prototype.wake = function () {
  if (this.loopActive) return;
  this.loopActive = true;
  var self = this;
  K.loop(function (t) {
    var moving = Math.abs(self.cur.x - self.target.x) + Math.abs(self.cur.y - self.target.y) + Math.abs(self.cur.z - self.target.z) > 0.0008;
    if (moving) {
      self.cur.x += (self.target.x - self.cur.x) * 0.22;
      self.cur.y += (self.target.y - self.cur.y) * 0.22;
      self.cur.z += (self.target.z - self.cur.z) * 0.22;
      self.trail.push({ x: self.cur.x, y: self.cur.y, z: self.cur.z, a: 0.5 });
      if (self.trail.length > 30) self.trail.shift();
    } else if (self.trail.length) {
      self.trail.forEach(function (p) { p.a *= 0.92; });
      while (self.trail.length && self.trail[0].a < 0.02) self.trail.shift();
    }
    var i = self.flashes.length;
    while (i--) {
      var f = self.flashes[i];
      f.r += 0.045; f.a -= 0.02;
      if (f.a <= 0) self.flashes.splice(i, 1);
    }
    self.render();
    if (!moving && !self.trail.length && !self.flashes.length && !self.dragging) {
      self.loopActive = false;
      return false;
    }
    return true;
  });
};
Bloch.prototype.proj = function (p, R, cx, cy) {
  var cyw = Math.cos(this.yaw), syw = Math.sin(this.yaw);
  var x1 = p.x * cyw - p.y * syw;
  var y1 = p.x * syw + p.y * cyw;
  var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
  var depth = y1 * cp + p.z * sp;
  var up = -y1 * sp + p.z * cp;
  return { x: cx + x1 * R, y: cy - up * R, d: depth };
};
Bloch.prototype.render = function () {
  var ctx = this.ctx, w = this.entry.w, h = this.entry.h;
  var R = Math.min(w, h) / 2 - this.pad;
  var cx = w / 2, cy = h / 2;
  ctx.clearRect(0, 0, w, h);

  var grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.2);
  grad.addColorStop(0, 'rgba(19,26,42,0.6)');
  grad.addColorStop(1, 'rgba(9,12,18,0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = K.faint(0.4);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();

  var self = this;
  function ringPoints(fn, steps) {
    ctx.beginPath();
    for (var s = 0; s <= steps; s++) {
      var t = s / steps * 6.2832;
      var p = fn(t);
      var q = self.proj(p, R, cx, cy);
      if (s === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = K.faint(0.28);
  ringPoints(function (t) { return { x: Math.cos(t), y: Math.sin(t), z: 0 }; }, 64);
  ctx.strokeStyle = K.faint(0.16);
  ringPoints(function (t) { return { x: Math.sin(t), y: 0, z: Math.cos(t) }; }, 64);
  ringPoints(function (t) { return { x: 0, y: Math.sin(t), z: Math.cos(t) }; }, 64);

  /* axis */
  var top = this.proj({ x: 0, y: 0, z: 1.12 }, R, cx, cy);
  var bot = this.proj({ x: 0, y: 0, z: -1.12 }, R, cx, cy);
  ctx.strokeStyle = K.faint(0.35);
  ctx.beginPath(); ctx.moveTo(bot.x, bot.y); ctx.lineTo(top.x, top.y); ctx.stroke();
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '11px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('|0⟩', top.x, top.y - 6);
  ctx.fillText('|1⟩', bot.x, bot.y + 14);

  /* extra static arrows */
  this.arrows.forEach(function (a) {
    var q1 = self.proj({ x: 0, y: 0, z: 0 }, R, cx, cy);
    var q2 = self.proj({ x: a.x, y: a.y, z: a.z }, R, cx, cy);
    ctx.strokeStyle = a.color || K.cyan(0.5);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = a.color || K.cyan(0.7);
    ctx.beginPath(); ctx.arc(q2.x, q2.y, 3, 0, 6.2832); ctx.fill();
  });

  /* trail */
  this.trail.forEach(function (p) {
    if (!p) return;
    var q = self.proj(p, R, cx, cy);
    ctx.fillStyle = self.hue ? self.hue(p.x, p.y, p.a * 0.8) : K.hueCss(p.x, p.y, p.a * 0.8);
    ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, 6.2832); ctx.fill();
  });

  /* state vector */
  var c = this.proj({ x: 0, y: 0, z: 0 }, R, cx, cy);
  var q = this.proj(this.cur, R, cx, cy);
  var len = Math.sqrt(this.cur.x * this.cur.x + this.cur.y * this.cur.y + this.cur.z * this.cur.z);
  if (len > 0.01) {
    var color = this.hue ? this.hue(this.cur.x, this.cur.y, 1) : K.hueCss(this.cur.x, this.cur.y, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(q.x, q.y, 4.4, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* flashes */
  this.flashes.forEach(function (f) {
    var fp = self.proj(f.at, R, cx, cy);
    ctx.strokeStyle = K.amber(f.a);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(fp.x, fp.y, 4 + f.r * 46, 0, 6.2832); ctx.stroke();
  });
};
K.Bloch = Bloch;

/* ---------- formatting ---------- */
K.f = function (x, d) { return x.toFixed(d === undefined ? 3 : d); };
K.bits = function (i, n) {
  var s = i.toString(2);
  while (s.length < n) s = '0' + s;
  return s;
};
K.ampStr = function (re, im, d) {
  return HG.cstr({ re: re, im: im }, d === undefined ? 3 : d);
};
})(typeof window !== 'undefined' ? window : global);
