/*!
 * CONTINUUM CA-7 - site.js
 * Owns the solver, the loop, the presets and the page.
 */
(function (root) {
  'use strict';
  var CA7 = root.CA7;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'ca7.v1';

  var App = {
    circuit: null,
    sim: null,
    running: true,
    presetId: 'spring',
    last: 0,
    audio: null,
    scopeXY: null,
    scopeTime: null,
    shadowOn: false,
    scratch: new Float32Array(4096)
  };

  /* ------------------------------------------------------------ helpers */
  function outputKeys(c) {
    var out = [];
    c.modules.forEach(function (m) {
      var spec = CA7.TYPES[m.t];
      if (spec && spec.outputs && spec.outputs.length) out.push(m.id + ':' + spec.outputs[0]);
    });
    return out;
  }

  function audioSource() {
    var am = CA7.findModule(App.circuit, 'audio');
    if (!am) return '';
    return App.sim.main.inMap[am.id + ':a'] || '';
  }

  function unit(id) { return CA7.findModule(App.circuit, id); }

  function timeDiv() {
    var t = unit('time');
    return (t && t.k.div) || 0.5;
  }

  function makeScopes() {
    var inner = document.getElementById('rigInner');
    var cvx = inner.querySelector('[data-screen="xy"]');
    var cvt = inner.querySelector('[data-screen="time"]');
    App.scopeXY = cvx ? new CA7.Scope(cvx, 'xy') : null;
    App.scopeTime = cvt ? new CA7.Scope(cvt, 'time') : null;
    CA7.Rig.onLayout = function () {
      if (App.scopeXY) App.scopeXY.resize();
      if (App.scopeTime) App.scopeTime.resize();
    };
    CA7.Rig.onLayout();
  }

  /* ------------------------------------------------------- rig callbacks */
  function onKnob(modId, key, value) {
    if (key === 'speed') {
      App.speed = value;
      if (App.sim) App.sim.speed = value;
      App.circuit.speed = value;
      save();
      return;
    }
    var def = CA7.findById(App.circuit, modId);
    if (!def) return;
    if (!def.k) def.k = {};
    def.k[key] = value;
    var m = App.sim.main.mods[modId];
    if (m) {
      m.k[key] = value;
      if (m.spec.state && key === 'ic') {
        m.state = m.mod ? wrapPi(value) : value;
        if (App.sim.shadow && App.sim.shadow.mods[modId]) {
          App.sim.shadow.mods[modId].state = m.mod ? wrapPi(value) : value;
        }
      }
    }
    if (modId === audioUnitId() && key === 'level' && App.audio) App.audio.setLevel(value);
    save();
  }

  function wrapPi(v) {
    var p = 2 * Math.PI;
    return v - p * Math.round(v / p);
  }

  function onMode(modId, mode) {
    var m = App.sim.main.mods[modId];
    if (m) m.mode = mode;
    if (App.sim.shadow && App.sim.shadow.mods[modId]) App.sim.shadow.mods[modId].mode = mode;
    if (modId === audioUnitId() && App.audio) App.audio.setMode(mode);
    save();
  }

  function onEdited(kind) {
    if (kind === 'wires') {
      App.sim.rebuild();
      App.sim.watch(outputKeys(App.circuit));
      App.circuit.shadow = App.shadowOn;
      syncAudioUnit();
    }
    save();
  }

  function onRemove(id) {
    var def = CA7.findById(App.circuit, id);
    if (!def) return;
    if (CA7.TYPES[def.t].rack) return;
    CA7.removeModule(App.circuit, id);
    App.sim.rebuild();
    App.sim.watch(outputKeys(App.circuit));
    CA7.Rig.circuit = App.circuit;
    CA7.Rig.render();
    CA7.Rig.hint(!App.circuit.modules.some(function (m) { return !CA7.TYPES[m.t].rack; }));
    save();
  }

  function onAdd(type) {
    var field = document.getElementById('mods');
    var spec = CA7.TYPES[type];
    var spots = [];
    var ys = [56, 330], xs = [24, 224, 424];
    ys.forEach(function (y) { xs.forEach(function (x) { spots.push({ x: x, y: y }); }); });
    var taken = App.circuit.modules.filter(function (m) { return !CA7.TYPES[m.t].rack; });
    var pick = null;
    for (var i = 0; i < spots.length && !pick; i++) {
      var s = spots[i];
      if (s.x + spec.w > CA7.PANEL_W) continue;
      var clash = taken.some(function (m) {
        var sp = CA7.TYPES[m.t];
        return Math.abs(m.x - s.x) < Math.max(sp.w, spec.w) - 8 &&
          Math.abs(m.y - s.y) < 150;
      });
      if (!clash) pick = s;
    }
    if (!pick) pick = { x: 24, y: 56 };
    CA7.addModule(App.circuit, type, pick.x, pick.y);
    App.sim.rebuild();
    App.sim.watch(outputKeys(App.circuit));
    CA7.Rig.circuit = App.circuit;
    CA7.Rig.render();
    CA7.Rig.hint(false);
    save();
  }

  function onAct(name) {
    if (name === 'audio') toggleAudio();
  }

  function audioUnitId() {
    var a = unit('audio');
    return a ? a.id : '';
  }

  function syncAudioUnit() {
    var a = unit('audio');
    if (!a) return;
    var btn = document.querySelector('[data-act="audio"]');
    if (!btn) return;
    var on = !!(App.audio && App.audio.on);
    btn.textContent = on ? 'AUDIO ON' : 'ENABLE AUDIO';
    btn.classList.toggle('is-on', on);
    var mod = btn.closest('.mod');
    if (mod) mod.classList.toggle('is-live', on);
  }

  function toggleAudio() {
    if (!App.audio) App.audio = new CA7.AudioOut();
    if (App.audio.on) App.audio.disable();
    else {
      if (!App.audio.enable()) return;
      var a = unit('audio');
      if (a) {
        App.audio.setLevel(a.k.level === undefined ? 0.4 : a.k.level);
        App.audio.setMode(a.mode || 'vco');
      }
    }
    syncAudioUnit();
  }

  /* ------------------------------------------------------------- buttons */
  function syncButtons() {
    var run = $('btnRun');
    run.classList.toggle('is-on', App.running);
    run.setAttribute('aria-pressed', String(App.running));
    $('runLabel').textContent = App.running ? 'RUNNING' : 'HELD';
    var sh = $('btnShadow');
    sh.setAttribute('aria-pressed', String(App.shadowOn));
    sh.classList.toggle('is-on', App.shadowOn);
  }

  function setRunning(on) {
    App.running = on;
    syncButtons();
  }

  function resetIC() {
    App.sim.reset();
    CA7.Rig.setStatus('initial conditions reloaded');
  }

  function toggleShadow() {
    App.shadowOn = !App.shadowOn;
    App.sim.setShadow(App.shadowOn);
    App.circuit.shadow = App.shadowOn;
    syncButtons();
    save();
  }

  function clearCords() {
    App.circuit.wires = App.circuit.wires.filter(function (w) {
      var t = String(w[1]).split(':')[0];
      var def = CA7.findModule(App.circuit, t);
      return def && CA7.TYPES[def.t].rack;
    });
    App.sim.rebuild();
    App.sim.watch(outputKeys(App.circuit));
    CA7.Rig.render();
    save();
  }

  function copyLink() {
    var enc = CA7.encode(App.circuit);
    history.replaceState(null, '', '#' + enc);
    var url = location.href;
    var done = function () { flash('btnCopy', 'LINK COPIED'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { flash('btnCopy', 'IN THE URL'); });
    } else flash('btnCopy', 'IN THE URL');
  }

  function flash(id, text) {
    var b = $(id), old = b.textContent;
    b.textContent = text;
    setTimeout(function () { b.textContent = old; }, 1400);
  }

  /* --------------------------------------------------------- persistence */
  var saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          p: App.presetId,
          d: CA7.encode(App.circuit)
        }));
      } catch (e) { /* private mode */ }
    }, 400);
  }

  function restore() {
    if (location.hash.length > 3) {
      var c = CA7.decode(location.hash.slice(1));
      if (c) return { circuit: c, id: (c.__p || 'spring') };
    }
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        var c2 = o.d ? CA7.decode(o.d) : null;
        if (c2) return { circuit: c2, id: o.p || 'spring' };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ------------------------------------------------------------ the doc */
  function writeDoc(p) {
    var d = p.doc || {};
    $('docTitle').textContent = d.title || p.chip;
    $('docEq').textContent = (d.eqs || []).join('\n');
    $('docAbout').textContent = d.about || '';
    $('docTry').textContent = d.try || '';
    $('docWatch').textContent = d.watch || '';
    $('docTag').textContent = p.tag || '';
    $('docTry').parentNode.hidden = !d.try;
    $('docWatch').parentNode.hidden = !d.watch;
    CA7.Rig.setPlate(String(p.chip || 'CUSTOM'), (d.eqs || []).join('   \u00b7   '));
  }

  /* -------------------------------------------------------------- chips */
  function buildChips() {
    var nav = $('chips');
    nav.innerHTML = '';
    CA7.PRESETS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.dataset.preset = p.id;
      var n = CA7._el('span', 'n', (i + 1 < 10 ? '0' : '') + (i + 1));
      b.appendChild(n);
      b.appendChild(document.createTextNode(p.chip));
      b.addEventListener('click', function () { loadPreset(p.id); });
      nav.appendChild(b);
    });
  }

  function markChips(id) {
    var nav = $('chips');
    for (var i = 0; i < nav.children.length; i++) {
      var b = nav.children[i];
      if (b.dataset.preset === id) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  /* --------------------------------------------------------- adopt/load */
  function adopt(circuit, id) {
    CA7.ensureUnits(circuit);
    App.circuit = circuit;
    App.presetId = id;
    App.speed = circuit.speed || 1;
    App.sim = new CA7.Simulation(circuit, {
      shadow: !!circuit.shadow,
      watch: outputKeys(circuit)
    });
    App.sim.speed = App.speed;
    App.shadowOn = !!circuit.shadow;
    App.capKey = null;
    if (App.sim.capture) App.sim.capture('');

    var rig = CA7.Rig;
    rig.circuit = circuit;
    rig.net = App.sim.main;
    rig.render();
    rig.hint(!circuit.modules.some(function (m) { return !CA7.TYPES[m.t].rack; }));
    makeScopes();
    markChips(id);
    writeDoc(CA7.PRESET_BY_ID[id] || { chip: 'CUSTOM', doc: customDoc(circuit) });
    syncAudioUnit();
    syncButtons();
    history.replaceState(null, '', location.pathname + location.search);
    save();
  }

  function customDoc() {
    return {
      title: 'Your own circuit',
      eqs: [],
      about: 'This machine is no longer one of the ready-patched examples \u2014 it is whatever you (or the link you followed) made of it. Every block is still live.',
      try: 'COPY LINK keeps it: the whole patchboard, every knob, every cord, encoded into the address bar.',
      watch: 'Press R to reload each integrator\u2019s initial condition and start the trajectory again.'
    };
  }

  function loadPreset(id) {
    var p = CA7.PRESET_BY_ID[id];
    if (!p) return;
    adopt(CA7.clone(p.circuit), p.id);
    CA7.Rig.setStatus('patched: ' + p.chip.toLowerCase());
  }

  /* ------------------------------------------------------------ buttons */
  function bindButtons() {
    $('btnRun').addEventListener('click', function () { setRunning(!App.running); });
    $('btnReset').addEventListener('click', resetIC);
    $('btnShadow').addEventListener('click', toggleShadow);
    $('btnCopy').addEventListener('click', copyLink);
    $('btnClear').addEventListener('click', clearCords);
    $('btnHelp').addEventListener('click', function () { showCoach(true); });

    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (t && t.closest && t.closest('[data-knob]')) return;
      if (e.key === ' ' && (!t || t === document.body)) {
        e.preventDefault();
        setRunning(!App.running);
      } else if (e.key === 'r' || e.key === 'R') {
        resetIC();
      } else if (e.key >= '0' && e.key <= '9') {
        var n = e.key === '0' ? 9 : (parseInt(e.key, 10) - 1);
        if (CA7.PRESETS[n]) loadPreset(CA7.PRESETS[n].id);
      }
    });
  }

  /* -------------------------------------------------------------- coach */
  function showCoach(force) {
    var seen = false;
    try { seen = localStorage.getItem('ca7.seen') === '1'; } catch (e) { /* */ }
    if (seen && !force) return;
    $('coach').hidden = false;
  }
  function hideCoach() {
    $('coach').hidden = true;
    try { localStorage.setItem('ca7.seen', '1'); } catch (e) { /* */ }
  }

  /* --------------------------------------------------------- speed knob */
  function addSpeedKnob() {
    var wrap = $('speedKnob');
    wrap.innerHTML = '';
    CA7.Rig.knobs = CA7.Rig.knobs.filter(function (k) { return k.modId !== '__'; });
    var u = CA7.valueToU(App.speed || 1, CA7.RANGES.speed);
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'slider');
    wrap.setAttribute('aria-label', 'simulation speed');
    wrap.dataset.knob = '__:speed';
    wrap.dataset.u = String(u);
    wrap.style.setProperty('--a', (u * 135) + 'deg');
    wrap.appendChild(CA7._el('div', 'knob__cap'));
    CA7.Rig.knobs.push({
      el: wrap, modId: '__', key: 'speed',
      def: { id: 'speed', range: 'speed', label: 'SPEED' }
    });
  }

  /* -------------------------------------------------------------- audio */
  function updateAudio() {
    var a = App.audio;
    if (!a || !a.on) return;
    var src = audioSource();
    var v = src ? App.sim.value(src) : 0;
    if (a.mode === 'vco') {
      if (App.capKey) { App.sim.capture(''); App.capKey = null; }
      a.update(v);
    } else {
      if (App.capKey !== src) { App.sim.capture(src); App.capKey = src; }
      var n = App.sim.drain(App.scratch);
      if (n) a.feed(App.scratch, n);
      a.update(v, 4000 * (App.speed || 1));
    }
  }

  /* ----------------------------------------------------------- main loop */
  function frame(ts) {
    var wall = App.last ? (ts - App.last) / 1000 : 0.016;
    App.last = ts;
    if (wall > 0.12) wall = 0.12;
    if (wall < 0) wall = 0;
    var sim = App.sim;
    if (App.running) sim.advance(wall);

    var m = sim.main;
    var win = timeDiv() * 10;

    if (App.scopeXY) {
      var xy = unit('xy');
      if (xy) {
        App.scopeXY.resize();
        var kx = m.inMap[xy.id + ':x'], ky = m.inMap[xy.id + ':y'];
        var keys = { x: kx, y: ky };
        var sh = null;
        if (App.shadowOn && sim.shadow) {
          sh = sim.recShadow;
          keys.sx = kx; keys.sy = ky;
        }
        App.scopeXY.drawXY(sim.recMain, keys, {
          gx: xy.k.gx || 1, gy: xy.k.gy || 1,
          ox: xy.k.ox || 0, oy: xy.k.oy || 0,
          window: win, color: '#7dffa8'
        }, sh);
      }
    }
    if (App.scopeTime) {
      var tm = unit('time');
      if (tm) {
        App.scopeTime.resize();
        App.scopeTime.drawTime(sim.recMain, [
          m.inMap[tm.id + ':a'], m.inMap[tm.id + ':b'], m.inMap[tm.id + ':c']
        ], { window: win });
      }
    }

    CA7.Rig.refresh(m);
    CA7.Rig.setTime(sim.t);
    CA7.Rig.setLamps(m.clipping() !== null, m.loop);
    updateAudio();

    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    buildChips();
    var restored = restore();
    var circuit, id;
    if (restored) { circuit = restored.circuit; id = restored.id; }
    else { circuit = CA7.clone(CA7.PRESET_BY_ID.spring.circuit); id = 'spring'; }

    CA7.Rig.mount(circuit, {
      knob: onKnob, mode: onMode, edited: onEdited,
      remove: onRemove, add: onAdd, act: onAct
    });
    adopt(circuit, id);
    addSpeedKnob();
    bindButtons();
    $('coachClose').addEventListener('click', hideCoach);
    $('coachGo').addEventListener('click', hideCoach);
    CA7.Rig.setStatus('drag a cord \u00b7 twist a knob \u00b7 R resets');
    CA7.Rig.statusIdle = 'drag a cord \u00b7 twist a knob \u00b7 R resets';
    showCoach(false);
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  root.CA7App = App;
  root.CA7AppInternals = {
    loadPreset: loadPreset, onKnob: onKnob, onMode: onMode, onEdited: onEdited,
    onRemove: onRemove, onAdd: onAdd, onAct: onAct, toggleAudio: toggleAudio,
    syncAudioUnit: syncAudioUnit, syncButtons: syncButtons, setRunning: setRunning,
    resetIC: resetIC, toggleShadow: toggleShadow, clearCords: clearCords,
    copyLink: copyLink, save: save, restore: restore, outputKeys: outputKeys,
    audioSource: audioSource, timeDiv: timeDiv, unit: unit, makeScopes: makeScopes
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
