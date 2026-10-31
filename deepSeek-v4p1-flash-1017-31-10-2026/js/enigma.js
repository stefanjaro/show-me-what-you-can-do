/* Exhibit V — The Enigma Machine.
   Historical rotor wirings, ring settings, plugboard, double-step. */
(function () {
  'use strict';
  var CM = window.CM;
  var canvas = document.getElementById('enigma-canvas');
  var plugCanvas = document.getElementById('enigma-plugboard');
  if (!canvas) return;

  var view = CM.setupCanvas(canvas);
  var ctx = view.ctx;
  var plugView = CM.setupCanvas(plugCanvas);
  var pctx = plugView.ctx;
  var section = canvas.closest('.exhibit');
  var rotorBank = document.getElementById('enigma-rotors');
  var reflectorSel = document.getElementById('enigma-reflector');
  var keyPad = document.getElementById('enigma-keys');
  var lampPad = document.getElementById('enigma-lamps');
  var msgInput = document.getElementById('enigma-message');
  var runBtn = document.getElementById('enigma-run');
  var swapBtn = document.getElementById('enigma-swap');
  var clearBtn = document.getElementById('enigma-clear');
  var outEl = document.getElementById('enigma-output');
  var posEl = document.getElementById('enigma-pos');
  var stateEl = document.getElementById('enigma-state');
  var plugsInput = document.getElementById('enigma-plugs');
  var plugsApply = document.getElementById('enigma-plugs-apply');

  var ROTORS = {
    I:   { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notch: 'Q' },
    II:  { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notch: 'E' },
    III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notch: 'V' },
    IV:  { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', notch: 'J' },
    V:   { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', notch: 'Z' }
  };
  var REFLECTORS = {
    B: 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
    C: 'FVPJIAOYEDRZXWGCTKUQSBNMHL'
  };
  var ROTOR_NAMES = ['I', 'II', 'III', 'IV', 'V'];
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var KEY_ROWS = ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML'];

  Object.keys(ROTORS).forEach(function (name) {
    var inv = new Array(26);
    for (var i = 0; i < 26; i++) inv[ROTORS[name].wiring.charCodeAt(i) - 65] = i;
    ROTORS[name].inverse = inv;
  });

  var slots = {
    left: { rotor: 'I', pos: 0, ring: 0 },
    middle: { rotor: 'II', pos: 0, ring: 0 },
    right: { rotor: 'III', pos: 0, ring: 0 }
  };
  var reflector = 'B';
  var pairs = new Array(26).fill(-1);
  var selectedSocket = -1;
  var signal = null;
  var ghost = null;
  var lampOn = -1;
  var lastRun = null;
  var animator = CM.makeAnimator(frame);
  var reels = {};
  var socketPositions = [];
  var plugHover = -1;
  var lastSound = 0;
  var inView = false;

  /* ---------- machine logic ---------- */

  function plugMap(c) { return pairs[c] >= 0 ? pairs[c] : c; }

  function rotorForward(slot, c) {
    var def = ROTORS[slot.rotor];
    var shift = slot.pos - slot.ring;
    var idx = CM.mod(c + shift, 26);
    var out = def.wiring.charCodeAt(idx) - 65;
    return CM.mod(out - shift, 26);
  }

  function rotorInverse(slot, c) {
    var def = ROTORS[slot.rotor];
    var shift = slot.pos - slot.ring;
    var idx = def.inverse[CM.mod(c + shift, 26)];
    return CM.mod(idx - shift, 26);
  }

  function notchIndex(slot) {
    return ROTORS[slot.rotor].notch.charCodeAt(0) - 65;
  }

  function stepRotors() {
    var midNotch = slots.middle.pos === notchIndex(slots.middle);
    var rightNotch = slots.right.pos === notchIndex(slots.right);
    if (midNotch) slots.left.pos = CM.mod(slots.left.pos + 1, 26);
    if (midNotch || rightNotch) slots.middle.pos = CM.mod(slots.middle.pos + 1, 26);
    slots.right.pos = CM.mod(slots.right.pos + 1, 26);
    return { mid: midNotch || rightNotch, left: midNotch };
  }

  function encipherIndex(c) {
    c = plugMap(c);
    c = rotorForward(slots.right, c);
    c = rotorForward(slots.middle, c);
    c = rotorForward(slots.left, c);
    c = REFLECTORS[reflector].charCodeAt(c) - 65;
    c = rotorInverse(slots.left, c);
    c = rotorInverse(slots.middle, c);
    c = rotorInverse(slots.right, c);
    c = plugMap(c);
    return c;
  }

  function buildStages(key) {
    var p0 = plugMap(key);
    var r1 = rotorForward(slots.right, p0);
    var r2 = rotorForward(slots.middle, r1);
    var r3 = rotorForward(slots.left, r2);
    var refl = REFLECTORS[reflector].charCodeAt(r3) - 65;
    var l1 = rotorInverse(slots.left, refl);
    var l2 = rotorInverse(slots.middle, l1);
    var l3 = rotorInverse(slots.right, l2);
    var lamp = plugMap(l3);
    return [
      { panel: 0, lane: 'f', label: 'PLUGBOARD', in: key, out: p0 },
      { panel: 1, lane: 'f', label: 'ROTOR ' + slots.right.rotor, in: p0, out: r1 },
      { panel: 2, lane: 'f', label: 'ROTOR ' + slots.middle.rotor, in: r1, out: r2 },
      { panel: 3, lane: 'f', label: 'ROTOR ' + slots.left.rotor, in: r2, out: r3 },
      { panel: 4, lane: 'f', label: 'REFLECTOR ' + reflector, in: r3, out: refl },
      { panel: 4, lane: 'r', label: 'REFLECTOR ' + reflector, in: refl, out: refl, return: true },
      { panel: 3, lane: 'r', label: 'ROTOR ' + slots.left.rotor, in: refl, out: l1, return: true },
      { panel: 2, lane: 'r', label: 'ROTOR ' + slots.middle.rotor, in: l1, out: l2, return: true },
      { panel: 1, lane: 'r', label: 'ROTOR ' + slots.right.rotor, in: l2, out: l3, return: true },
      { panel: 0, lane: 'r', label: 'PLUGBOARD', in: l3, out: lamp, return: true }
    ];
  }

  function letter(i) { return ALPHA.charAt(i); }
  function indexOf(ch) { return ALPHA.indexOf(ch); }

  /* ---------- UI ---------- */

  function buildRotors() {
    var html = '';
    ['left', 'middle', 'right'].forEach(function (slotKey) {
      var slot = slots[slotKey];
      var title = slotKey === 'left' ? 'LEFT · SLOW' : slotKey === 'middle' ? 'MIDDLE' : 'RIGHT · FAST';
      html += '<div class="rotor" data-slot="' + slotKey + '">' +
        '<div class="rotor__label"><span>' + title + '</span><b data-rotor-name="' + slotKey + '">' + slot.rotor + '</b></div>' +
        '<div class="rotor__reel">' +
          '<button class="reel-btn" type="button" data-step="' + slotKey + '" data-dir="-1" aria-label="Step ' + slotKey + ' rotor back">▲</button>' +
          '<div class="reel-window"><span class="reel-letter" data-reel="' + slotKey + '">' + letter(slot.pos) + '</span></div>' +
          '<button class="reel-btn" type="button" data-step="' + slotKey + '" data-dir="1" aria-label="Step ' + slotKey + ' rotor forward">▼</button>' +
        '</div>' +
        '<div class="rotor__selects">' +
          '<label class="field"><span>Rotor</span><select data-rotor="' + slotKey + '">' +
            ROTOR_NAMES.map(function (r) { return '<option value="' + r + '"' + (r === slot.rotor ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="field"><span>Ring</span><select data-ring="' + slotKey + '">' +
            ALPHA.split('').map(function (ch, i) { return '<option value="' + i + '"' + (i === slot.ring ? ' selected' : '') + '>' + ch + ' · ' + CM.pad2(i + 1) + '</option>'; }).join('') +
          '</select></label>' +
        '</div>' +
      '</div>';
    });
    rotorBank.innerHTML = html;

    rotorBank.querySelectorAll('[data-reel]').forEach(function (el) { reels[el.getAttribute('data-reel')] = el; });

    rotorBank.querySelectorAll('[data-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-step');
        var dir = parseInt(btn.getAttribute('data-dir'), 10);
        slots[key].pos = CM.mod(slots[key].pos + dir, 26);
        updateReel(key, true);
        settingsChanged();
        CMSound.play('ratchet', { vol: .45, pitch: key === 'right' ? 1.1 : .9 });
      });
    });

    rotorBank.querySelectorAll('[data-rotor]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var key = sel.getAttribute('data-rotor');
        slots[key].rotor = sel.value;
        var nameEl = rotorBank.querySelector('[data-rotor-name="' + key + '"]');
        if (nameEl) nameEl.textContent = sel.value;
        settingsChanged();
        CMSound.play('tick', { vol: .5 });
      });
    });

    rotorBank.querySelectorAll('[data-ring]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var key = sel.getAttribute('data-ring');
        slots[key].ring = parseInt(sel.value, 10);
        settingsChanged();
        CMSound.play('tick', { vol: .5 });
      });
    });
  }

  function updateReel(slotKey, animate) {
    var el = reels[slotKey];
    if (!el) return;
    el.textContent = letter(slots[slotKey].pos);
    if (animate && !CM.reduced) {
      el.classList.remove('is-stepping');
      void el.offsetWidth;
      el.classList.add('is-stepping');
      setTimeout(function () { el.classList.remove('is-stepping'); }, 90);
    }
  }

  function buildKeyboards() {
    keyPad.innerHTML = '';
    lampPad.innerHTML = '';
    KEY_ROWS.forEach(function (row) {
      row.split('').forEach(function (ch) {
        var k = document.createElement('button');
        k.type = 'button';
        k.className = 'key';
        k.textContent = ch;
        k.setAttribute('data-key', ch);
        k.setAttribute('aria-label', 'Key ' + ch);
        k.addEventListener('click', function () { press(ch); });
        keyPad.appendChild(k);

        var l = document.createElement('span');
        l.className = 'lamp';
        l.textContent = ch;
        l.setAttribute('data-lamp', ch);
        lampPad.appendChild(l);
      });
    });
  }

  function clearLamps() {
    lampPad.querySelectorAll('.lamp.is-on').forEach(function (l) { l.classList.remove('is-on'); });
    lampOn = -1;
  }

  function lightLamp(ch) {
    clearLamps();
    var l = lampPad.querySelector('[data-lamp="' + ch + '"]');
    if (l) { l.classList.add('is-on'); lampOn = indexOf(ch); }
  }

  function flashKey(ch) {
    var k = keyPad.querySelector('[data-key="' + ch + '"]');
    if (!k) return;
    k.classList.add('is-down');
    setTimeout(function () { k.classList.remove('is-down'); }, 130);
  }

  function updatePositions() {
    posEl.textContent = slots.left.rotor + ' ' + letter(slots.left.pos) +
      ' · ' + slots.middle.rotor + ' ' + letter(slots.middle.pos) +
      ' · ' + slots.right.rotor + ' ' + letter(slots.right.pos);
  }

  function settingsChanged() {
    signal = null;
    ghost = buildStages(0);
    lastRun = null;
    clearLamps();
    stateEl.textContent = 'Ready.';
    outEl.textContent = '—';
    updatePositions();
  }

  function press(ch) {
    if (signal && !signal.done) {
      /* Finish the previous animation instantly, then carry on. */
      signal = null;
    }
    var idx = indexOf(ch);
    if (idx < 0) return;
    flashKey(ch);
    clearLamps();
    var stepped = stepRotors();
    var out = encipherIndex(idx);
    updateReel('right', true);
    if (stepped.mid) updateReel('middle', true);
    if (stepped.left) updateReel('left', true);
    updatePositions();
    var stages = buildStages(idx);
    signal = { stages: stages, start: performance.now(), done: false, lamp: out };
    ghost = null;
    stateEl.textContent = 'Signal: ' + ch + ' → ' + letter(out);
    CMSound.play('key', { vol: .7 });
  }

  function runMessage() {
    var raw = (msgInput.value || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!raw) { stateEl.textContent = 'Type a message first.'; return; }
    var startPositions = {
      left: slots.left.pos, middle: slots.middle.pos, right: slots.right.pos
    };
    var cipher = '';
    for (var i = 0; i < raw.length; i++) {
      var idx = indexOf(raw.charAt(i));
      stepRotors();
      cipher += letter(encipherIndex(idx));
    }
    updateReel('left', true);
    updateReel('middle', true);
    updateReel('right', true);
    updatePositions();
    var grouped = cipher.replace(/(.{5})/g, '$1 ').trim();
    outEl.textContent = grouped;
    var lastIdx = indexOf(raw.charAt(raw.length - 1));
    /* The last letter's path uses the final rotor positions. */
    signal = { stages: buildStages(lastIdx), start: performance.now(), done: false, lamp: indexOf(cipher.charAt(cipher.length - 1)) };
    ghost = null;
    clearLamps();
    stateEl.textContent = raw.length + ' letters enciphered. Rotors are now ' +
      letter(slots.left.pos) + letter(slots.middle.pos) + letter(slots.right.pos) + '.';
    lastRun = { cipher: cipher, grouped: grouped, startPositions: startPositions };
    for (var s = 0; s < Math.min(8, raw.length); s++) {
      CMSound.play('ratchet', { delay: s * 0.055, vol: .3, pitch: .8 + (s % 3) * .1 });
    }
    CMSound.play('lamp', { delay: Math.min(0.5, raw.length * 0.055) });
  }

  runBtn.addEventListener('click', runMessage);
  msgInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); runMessage(); }
  });
  swapBtn.addEventListener('click', function () {
    if (!lastRun) { stateEl.textContent = 'Encipher a message first.'; return; }
    slots.left.pos = lastRun.startPositions.left;
    slots.middle.pos = lastRun.startPositions.middle;
    slots.right.pos = lastRun.startPositions.right;
    ['left', 'middle', 'right'].forEach(function (k) { updateReel(k, true); });
    msgInput.value = lastRun.grouped;
    outEl.textContent = '—';
    signal = null;
    ghost = buildStages(0);
    clearLamps();
    updatePositions();
    stateEl.textContent = 'Ciphertext loaded. The rotors are back at the start. Press Encipher.';
    CMSound.play('tick', { vol: .6 });
  });
  clearBtn.addEventListener('click', function () {
    msgInput.value = '';
    outEl.textContent = '—';
    signal = null;
    ghost = buildStages(0);
    clearLamps();
    stateEl.textContent = 'Ready.';
  });
  reflectorSel.addEventListener('change', function () {
    reflector = reflectorSel.value;
    settingsChanged();
    CMSound.play('click');
  });

  /* ---------- plugboard ---------- */

  function parsePlugs(text) {
    var clean = (text || '').toUpperCase().replace(/[^A-Z]/g, '');
    var next = new Array(26).fill(-1);
    var used = {};
    var count = 0;
    for (var i = 0; i + 1 < clean.length && count < 10; i += 2) {
      var a = indexOf(clean.charAt(i));
      var b = indexOf(clean.charAt(i + 1));
      if (a < 0 || b < 0 || a === b || used[a] || used[b]) continue;
      next[a] = b; next[b] = a;
      used[a] = used[b] = true;
      count++;
    }
    return next;
  }

  function plugsToText() {
    var seen = {};
    var out = [];
    for (var i = 0; i < 26; i++) {
      if (pairs[i] >= 0 && !seen[i]) {
        seen[i] = seen[pairs[i]] = true;
        out.push(letter(i) + letter(pairs[i]));
      }
    }
    return out.join(' ');
  }

  function applyPlugs(text) {
    pairs = parsePlugs(text);
    plugsInput.value = plugsToText();
    selectedSocket = -1;
    settingsChanged();
    CMSound.play('relay', { vol: .45 });
  }

  plugsApply.addEventListener('click', function () { applyPlugs(plugsInput.value); });
  plugsInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyPlugs(plugsInput.value); }
  });

  function buildSocketPositions() {
    var w = plugView.w, h = plugView.h;
    var cx = w / 2, cy = h / 2;
    var radius = Math.min(w, h) * 0.34;
    socketPositions = [];
    for (var i = 0; i < 26; i++) {
      var a = (i / 26) * CM.TAU - Math.PI / 2;
      socketPositions.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, a: a });
    }
    return { cx: cx, cy: cy, radius: radius };
  }

  plugCanvas.addEventListener('pointermove', function (e) {
    var p = CM.pointerPos(plugCanvas, e);
    plugHover = -1;
    for (var i = 0; i < socketPositions.length; i++) {
      var s = socketPositions[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < Math.max(9, plugView.w * 0.032)) { plugHover = i; break; }
    }
    plugCanvas.style.cursor = plugHover >= 0 ? 'pointer' : 'default';
  });
  plugCanvas.addEventListener('pointerleave', function () { plugHover = -1; });
  plugCanvas.addEventListener('pointerdown', function (e) {
    var p = CM.pointerPos(plugCanvas, e);
    var hit = -1;
    for (var i = 0; i < socketPositions.length; i++) {
      var s = socketPositions[i];
      if (Math.hypot(p.x - s.x, p.y - s.y) < Math.max(10, plugView.w * 0.038)) { hit = i; break; }
    }
    if (hit < 0) return;
    if (pairs[hit] >= 0) {
      var other = pairs[hit];
      pairs[hit] = -1; pairs[other] = -1;
      selectedSocket = -1;
      plugsInput.value = plugsToText();
      settingsChanged();
      CMSound.play('relay', { vol: .5 });
      return;
    }
    if (selectedSocket < 0) {
      selectedSocket = hit;
      CMSound.play('tick', { vol: .5 });
    } else if (selectedSocket === hit) {
      selectedSocket = -1;
    } else {
      var count = pairs.filter(function (v) { return v >= 0; }).length / 2;
      if (count >= 10) {
        stateEl.textContent = 'Ten plugboard pairs are already connected.';
        CMSound.play('relay', { vol: .4, pitch: .7 });
        selectedSocket = -1;
        return;
      }
      var a = selectedSocket, b = hit;
      if (pairs[a] >= 0) pairs[pairs[a]] = -1;
      if (pairs[b] >= 0) pairs[pairs[b]] = -1;
      pairs[a] = b; pairs[b] = a;
      selectedSocket = -1;
      plugsInput.value = plugsToText();
      settingsChanged();
      CMSound.play('relay', { vol: .55 });
    }
  });

  /* ---------- keyboard input ---------- */

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { inView = e.isIntersecting; });
  }, { threshold: .25 });
  io.observe(section);

  window.addEventListener('keydown', function (e) {
    if (!inView || e.ctrlKey || e.metaKey || e.altKey) return;
    var target = e.target;
    var tag = target && target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    var ch = String(e.key || '').toUpperCase();
    if (ch.length === 1 && ch >= 'A' && ch <= 'Z') {
      press(ch);
    }
  });

  /* ---------- signal drawings ---------- */

  function bezier(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    return {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
    };
  }

  function buildGeometry(stages) {
    var w = view.w, h = view.h;
    var compact = w < 620;
    var geo = { compact: compact, stages: [] };
    if (compact) return geo;
    var left = 66, right = w - 62;
    var gap = Math.max(8, w * 0.011);
    var panelW = (right - left - gap * 4) / 5;
    var top = 44, bottom = h - 24;
    var laneGap = 16;
    var laneH = (bottom - top - laneGap) / 2;
    var fTop = top, rTop = top + laneH + laneGap;
    function rowY(lane, idx) {
      var t = lane === 'f' ? fTop : rTop;
      return t + (idx + 0.5) * laneH / 26;
    }
    geo.left = left; geo.right = right; geo.gap = gap; geo.panelW = panelW;
    geo.fTop = fTop; geo.rTop = rTop; geo.laneH = laneH; geo.rowY = rowY;
    geo.keyX = 24;
    geo.lampX = 24;
    stages.forEach(function (st, i) {
      var x = left + st.panel * (panelW + gap);
      var yIn = rowY(st.lane, st.in);
      var yOut = rowY(st.lane, st.out);
      var entry, exit, c1, c2;
      if (st.lane === 'f') {
        entry = { x: x, y: yIn };
        exit = { x: x + panelW, y: yOut };
        c1 = { x: x + panelW * 0.34, y: yIn };
        c2 = { x: x + panelW * 0.66, y: yOut };
      } else {
        entry = { x: x + panelW, y: yIn };
        exit = { x: x, y: yOut };
        c1 = { x: x + panelW * 0.66, y: yIn };
        c2 = { x: x + panelW * 0.34, y: yOut };
      }
      geo.stages.push({ entry: entry, exit: exit, c1: c1, c2: c2, stage: st, panelX: x });
    });
    return geo;
  }

  function frame(now, dtMs) {
    if (!view.w) return;
    if (signal && !signal.done) {
      var total = signal.stages.length;
      var dur = CM.reduced ? 1 : 950;
      if (now - signal.start >= dur) {
        signal.done = true;
        var lampCh = letter(signal.lamp);
        lightLamp(lampCh);
        /* Keep the dome light on after the fact. */
        signal.lampOn = lampCh;
        CMSound.play('lamp', { vol: .55 });
        stateEl.textContent = 'Lamp: ' + lampCh + '.';
      }
    }
    drawSignal(now);
    drawPlugboard(now);
  }

  function drawSignal(now) {
    var w = view.w, h = view.h;
    ctx.clearRect(0, 0, w, h);
    var bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * .72);
    bg.addColorStop(0, '#12130f');
    bg.addColorStop(0.6, '#0a0a08');
    bg.addColorStop(1, '#060605');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    var stages = signal ? signal.stages : ghost;
    if (!stages) return;
    if (w < 620) drawCompact(stages, now);
    else drawSchematic(stages, now);
  }

  function drawSchematic(stages, now) {
    var w = view.w, h = view.h;
    var geo = buildGeometry(stages);
    if (!geo.stages.length) return;
    var isGhost = !signal;
    var progress = 1;
    var active = stages.length;
    var t = 1;
    if (signal && !signal.done) {
      var dur = CM.reduced ? 1 : 950;
      var elapsed = now - signal.start;
      var per = dur / stages.length;
      active = Math.min(stages.length, Math.floor(elapsed / per));
      t = CM.clamp((elapsed - active * per) / per, 0, 1);
    }

    /* lane backgrounds */
    ctx.save();
    ctx.fillStyle = 'rgba(201,163,90,.018)';
    ctx.fillRect(geo.left - 6, geo.fTop, geo.right - geo.left + 12, geo.laneH);
    ctx.fillRect(geo.left - 6, geo.rTop, geo.right - geo.left + 12, geo.laneH);
    ctx.strokeStyle = 'rgba(201,163,90,.07)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(geo.left - 6, geo.fTop + geo.laneH);
    ctx.lineTo(geo.right + 6, geo.fTop + geo.laneH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(geo.left - 6, geo.rTop);
    ctx.lineTo(geo.right + 6, geo.rTop);
    ctx.stroke();
    ctx.restore();

    /* ruler letters */
    ctx.save();
    ctx.font = '400 ' + Math.max(5, w * 0.0065) + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(139,127,108,.5)';
    for (var i = 0; i < 26; i++) {
      var yf = geo.rowY('f', i), yr = geo.rowY('r', i);
      ctx.fillText(ALPHA.charAt(i), geo.left - 10, yf);
      ctx.fillText(ALPHA.charAt(i), geo.right + 10, yr);
    }
    ctx.restore();

    /* panels */
    var labels = ['PLUGBOARD', 'ROTOR ' + slots.right.rotor, 'ROTOR ' + slots.middle.rotor, 'ROTOR ' + slots.left.rotor, 'REFLECTOR ' + reflector];
    labels.forEach(function (label, i) {
      var x = geo.left + i * (geo.panelW + geo.gap);
      var panelTop = geo.fTop - 8;
      var panelH = geo.rTop + geo.laneH - geo.fTop + 16;
      /* background */
      var pg = ctx.createLinearGradient(0, panelTop, 0, panelTop + panelH);
      pg.addColorStop(0, 'rgba(201,163,90,.06)');
      pg.addColorStop(0.5, 'rgba(201,163,90,.02)');
      pg.addColorStop(1, 'rgba(201,163,90,.05)');
      CM.roundRect(ctx, x, panelTop, geo.panelW, panelH, 3);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(201,163,90,.18)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      /* contact banks: the rows behind the wiring */
      ctx.save();
      ctx.strokeStyle = 'rgba(201,163,90,.13)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([1, Math.max(3, geo.laneH / 26 - 1)]);
      [x + 3, x + geo.panelW - 3].forEach(function (xx) {
        ctx.beginPath();
        ctx.moveTo(xx, geo.fTop + 2); ctx.lineTo(xx, geo.fTop + geo.laneH - 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(xx, geo.rTop + 2); ctx.lineTo(xx, geo.rTop + geo.laneH - 2);
        ctx.stroke();
      });
      ctx.restore();
      /* label */
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 ' + Math.max(5.5, w * 0.0072) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = i === 4 ? 'rgba(169,200,189,.7)' : 'rgba(201,163,90,.68)';
      ctx.fillText(label, x + geo.panelW / 2, geo.fTop - 19);
      ctx.restore();
    });

    /* base path: all stage curves and connectors, faint */
    ctx.save();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(201,163,90,.20)';
    for (var s = 0; s < geo.stages.length; s++) {
      var g = geo.stages[s];
      ctx.beginPath();
      ctx.moveTo(g.entry.x, g.entry.y);
      ctx.bezierCurveTo(g.c1.x, g.c1.y, g.c2.x, g.c2.y, g.exit.x, g.exit.y);
      ctx.stroke();
    }
    /* connectors */
    ctx.beginPath();
    ctx.moveTo(geo.keyX, geo.rowY('f', stages[0].in));
    ctx.lineTo(geo.stages[0].entry.x, geo.stages[0].entry.y);
    for (var c = 1; c < geo.stages.length; c++) {
      var prev = geo.stages[c - 1];
      var cur = geo.stages[c];
      if (c === 5) {
        ctx.moveTo(prev.exit.x, prev.exit.y);
        ctx.bezierCurveTo(prev.exit.x + 26, prev.exit.y, cur.entry.x + 26, cur.entry.y, cur.entry.x, cur.entry.y);
      } else {
        ctx.moveTo(prev.exit.x, prev.exit.y);
        ctx.lineTo(cur.entry.x, cur.entry.y);
      }
    }
    var last = geo.stages[geo.stages.length - 1];
    ctx.moveTo(last.exit.x, last.exit.y);
    ctx.lineTo(geo.lampX, geo.rowY('r', stages[stages.length - 1].out));
    ctx.stroke();
    ctx.restore();

    /* ghost path: a slow, living exhibit before the first key */
    if (isGhost) {
      for (var gq = 0; gq < geo.stages.length; gq++) {
        var gst = geo.stages[gq];
        var gcol = gst.stage.return ? 'rgba(169,200,189,.32)' : 'rgba(240,215,154,.28)';
        ctx.save();
        ctx.strokeStyle = gcol;
        ctx.lineWidth = 1.2;
        ctx.shadowColor = gcol;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(gst.entry.x, gst.entry.y);
        ctx.bezierCurveTo(gst.c1.x, gst.c1.y, gst.c2.x, gst.c2.y, gst.exit.x, gst.exit.y);
        ctx.stroke();
        ctx.restore();
      }
      for (var gn = 0; gn < geo.stages.length; gn++) {
        var gsn = geo.stages[gn];
        drawGhostNode(gsn.exit.x, gsn.exit.y, stages[gn].out, gsn.stage.return);
      }
      if (!CM.reduced) {
        var gp = (now / 7200) % 1;
        var gactive = Math.min(geo.stages.length - 1, Math.floor(gp * geo.stages.length));
        var gt = gp * geo.stages.length - gactive;
        var gsg = geo.stages[gactive];
        if (!gsg) return;
        var gpp = bezier(gsg.entry, gsg.c1, gsg.c2, gsg.exit, gt);
        ctx.save();
        ctx.beginPath();
        ctx.arc(gpp.x, gpp.y, 3, 0, CM.TAU);
        ctx.fillStyle = 'rgba(255,236,180,.75)';
        ctx.shadowColor = '#ffe8a8';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();
      }
    }

    /* completed + active path */
    var completed = signal ? active : 0;
    for (var q = 0; q < geo.stages.length; q++) {
      var st = geo.stages[q];
      var on = isGhost ? false : (q < completed || (q === active && t > 0));
      if (!on) continue;
      var col = st.stage.return ? 'rgba(169,200,189,.92)' : 'rgba(240,215,154,.92)';
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 9;
      ctx.beginPath();
      if (q < completed) {
        ctx.moveTo(st.entry.x, st.entry.y);
        ctx.bezierCurveTo(st.c1.x, st.c1.y, st.c2.x, st.c2.y, st.exit.x, st.exit.y);
      } else {
        var steps = 18;
        for (var u = 0; u <= steps; u++) {
          var pt = bezier(st.entry, st.c1, st.c2, st.exit, (u / steps) * t);
          if (u === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    /* connectors bright */
    if (!isGhost && completed > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240,215,154,.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var cn = 1; cn <= Math.min(completed, geo.stages.length - 1); cn++) {
        var pr = geo.stages[cn - 1], cu = geo.stages[cn];
        if (cn === 5) {
          ctx.moveTo(pr.exit.x, pr.exit.y);
          ctx.bezierCurveTo(pr.exit.x + 26, pr.exit.y, cu.entry.x + 26, cu.entry.y, cu.entry.x, cu.entry.y);
        } else {
          ctx.moveTo(pr.exit.x, pr.exit.y);
          ctx.lineTo(cu.entry.x, cu.entry.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    /* pulse dot */
    if (signal && !signal.done && active < geo.stages.length) {
      var gs = geo.stages[active];
      if (!gs) return;
      var pp = bezier(gs.entry, gs.c1, gs.c2, gs.exit, t);
      ctx.save();
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 4, 0, CM.TAU);
      ctx.fillStyle = '#fff2c9';
      ctx.shadowColor = '#ffe8a8';
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.restore();
    }

    /* active letters */
    if (!isGhost) {
      var nodes = [{ x: geo.keyX, y: geo.rowY('f', stages[0].in), ch: stages[0].in }];
      for (var n = 0; n <= active && n < stages.length; n++) {
        var gsn = geo.stages[n];
        nodes.push({ x: gsn.exit.x, y: gsn.exit.y, ch: stages[n].out });
      }
      nodes.forEach(function (nd, ni) {
        var isLamp = ni === nodes.length - 1;
        var col = isLamp ? 'rgba(255,236,180,.95)' : 'rgba(240,215,154,.92)';
        ctx.save();
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, isLamp ? 9 : 7, 0, CM.TAU);
        ctx.fillStyle = 'rgba(9,8,6,.92)';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = '500 ' + Math.max(6, w * 0.0075) + 'px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ALPHA.charAt(nd.ch), nd.x, nd.y + 0.5);
        ctx.restore();
      });
    }

    /* key and lamp nodes */
    drawTerminal(geo.keyX, geo.rowY('f', stages[0].in), 'KEY', stages[0].in, false);
    drawTerminal(geo.lampX, geo.rowY('r', stages[stages.length - 1].out), 'LAMP',
      signal && signal.done ? signal.lamp : stages[stages.length - 1].out, !!(signal && signal.done));

    /* forward / return labels */
    ctx.save();
    ctx.font = '400 ' + Math.max(5, w * 0.0065) + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(201,163,90,.4)';
    ctx.fillText('FORWARD', geo.left, geo.fTop - 28);
    ctx.fillStyle = 'rgba(169,200,189,.4)';
    ctx.fillText('RETURN', geo.left, geo.rTop - 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(139,127,108,.4)';
    ctx.fillText('ENIGMA I · 3 ROTORS', geo.right, geo.fTop - 28);
    ctx.restore();
  }

  function drawTerminal(x, y, label, ch, lit) {
    ctx.save();
    if (lit) {
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, CM.TAU);
      var gl = ctx.createRadialGradient(x, y, 0, x, y, 18);
      gl.addColorStop(0, 'rgba(255,232,160,.45)');
      gl.addColorStop(1, 'rgba(255,232,160,0)');
      ctx.fillStyle = gl;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, CM.TAU);
    ctx.fillStyle = lit ? '#f0d79a' : 'rgba(13,11,8,.95)';
    ctx.fill();
    ctx.strokeStyle = lit ? '#fff2c9' : 'rgba(201,163,90,.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = lit ? '#241708' : 'rgba(240,215,154,.8)';
    ctx.font = '500 7px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ALPHA.charAt(ch), x, y + 0.5);
    ctx.fillStyle = 'rgba(139,127,108,.65)';
    ctx.font = '400 5px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x, y - 13);
    ctx.restore();
  }

  function drawCompact(stages, now) {
    var w = view.w, h = view.h;
    var top = 30, rowH = (h - top - 18) / stages.length;
    var active = stages.length, t = 1;
    if (signal && !signal.done) {
      var dur = CM.reduced ? 1 : 950;
      var per = dur / stages.length;
      active = Math.min(stages.length, Math.floor((now - signal.start) / per));
      t = CM.clamp(((now - signal.start) - active * per) / per, 0, 1);
    }
    var isGhost = !signal;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '500 6px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(201,163,90,.5)';
    ctx.fillText('SIGNAL PATH', 10, 14);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(139,127,108,.5)';
    ctx.fillText('ENIGMA I', w - 10, 14);
    ctx.restore();

    stages.forEach(function (st, i) {
      var y = top + i * rowH + rowH / 2;
      var on = isGhost ? false : i < active || (i === active && t > 0);
      var col = st.return ? 'rgba(169,200,189,' : 'rgba(240,215,154,';
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '400 ' + Math.max(5, Math.min(7, rowH * 0.3)) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = on ? col + '.9)' : 'rgba(139,127,108,.55)';
      ctx.fillText((st.return ? '↩ ' : '') + st.label, 10, y);
      ctx.restore();

      var inX = w * 0.57, outX = w * 0.83;
      var r = Math.max(5, Math.min(9, rowH * 0.32));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(inX + r, y);
      ctx.lineTo(outX - r, y);
      ctx.strokeStyle = on ? col + '.7)' : 'rgba(201,163,90,.12)';
      ctx.lineWidth = on ? 1.4 : 0.7;
      ctx.stroke();
      if (on && i === active && t > 0) {
        var px = inX + r + (outX - r - inX - r) * t;
        ctx.beginPath();
        ctx.arc(px, y, 2.5, 0, CM.TAU);
        ctx.fillStyle = '#fff2c9';
        ctx.shadowColor = '#ffe8a8';
        ctx.shadowBlur = 10;
        ctx.fill();
      }
      ctx.restore();

      drawNode(inX, y, st.in, on, r, col);
      drawNode(outX, y, st.out, on, r, col);
    });
  }

  function drawGhostNode(x, y, ch, ret) {
    var col = ret ? 'rgba(169,200,189,' : 'rgba(240,215,154,';
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, CM.TAU);
    ctx.fillStyle = 'rgba(9,8,6,.8)';
    ctx.fill();
    ctx.strokeStyle = col + '.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = col + '.75)';
    ctx.font = '500 6px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ALPHA.charAt(ch), x, y + 0.5);
    ctx.restore();
  }

  function drawNode(x, y, ch, on, r, col) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, CM.TAU);
    ctx.fillStyle = on ? 'rgba(16,14,10,.95)' : 'rgba(10,9,7,.8)';
    ctx.fill();
    ctx.strokeStyle = on ? col + '.85)' : 'rgba(201,163,90,.16)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = on ? '#f0d79a' : 'rgba(139,127,108,.55)';
    ctx.font = '500 ' + Math.max(5, r * 1.05) + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ALPHA.charAt(ch), x, y + 0.5);
    ctx.restore();
  }

  /* ---------- plugboard rendering ---------- */

  var CORD_COLORS = ['#b85c45', '#c19a4b', '#6f9a8d', '#8d7199', '#b6783f', '#7b8f4a', '#9c5b62', '#5f8496', '#a88455', '#857b5a'];

  function drawPlugboard(now) {
    var w = plugView.w, h = plugView.h;
    if (!w || !h) return;
    var geo = buildSocketPositions();
    var cx = geo.cx, cy = geo.cy, radius = geo.radius;
    pctx.clearRect(0, 0, w, h);
    var bg = pctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * .7);
    bg.addColorStop(0, '#14100b');
    bg.addColorStop(1, '#080706');
    pctx.fillStyle = bg;
    pctx.fillRect(0, 0, w, h);

    /* plate */
    pctx.beginPath();
    pctx.arc(cx, cy, radius * 1.42, 0, CM.TAU);
    pctx.fillStyle = 'rgba(20,15,10,.9)';
    pctx.fill();
    pctx.strokeStyle = 'rgba(201,163,90,.22)';
    pctx.lineWidth = 1;
    pctx.stroke();

    /* cords */
    for (var i = 0; i < 26; i++) {
      var j = pairs[i];
      if (j > i) {
        var a = socketPositions[i], b = socketPositions[j];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var dx = mx - cx, dy = my - cy;
        var pull = 0.28;
        var qx = mx - dx * pull, qy = my - dy * pull;
        var color = CORD_COLORS[Math.floor(i / 2) % CORD_COLORS.length];
        pctx.save();
        pctx.beginPath();
        pctx.moveTo(a.x, a.y);
        pctx.quadraticCurveTo(qx, qy, b.x, b.y);
        pctx.strokeStyle = 'rgba(0,0,0,.5)';
        pctx.lineWidth = 5;
        pctx.stroke();
        pctx.beginPath();
        pctx.moveTo(a.x, a.y);
        pctx.quadraticCurveTo(qx, qy, b.x, b.y);
        pctx.strokeStyle = color;
        pctx.lineWidth = 2.4;
        pctx.stroke();
        pctx.strokeStyle = 'rgba(255,240,200,.22)';
        pctx.lineWidth = 0.8;
        pctx.stroke();
        pctx.restore();
      }
    }

    /* sockets */
    for (var s = 0; s < 26; s++) {
      var sp = socketPositions[s];
      var paired = pairs[s] >= 0;
      var selected = selectedSocket === s;
      var hovered = plugHover === s;
      var r = Math.max(4, Math.min(7, w * 0.018));
      pctx.save();
      if (selected || hovered) {
        pctx.beginPath();
        pctx.arc(sp.x, sp.y, r * 2.1, 0, CM.TAU);
        pctx.fillStyle = selected ? 'rgba(240,215,154,.22)' : 'rgba(201,163,90,.1)';
        pctx.fill();
      }
      pctx.beginPath();
      pctx.arc(sp.x, sp.y, r, 0, CM.TAU);
      var sg = pctx.createRadialGradient(sp.x - r * .3, sp.y - r * .3, 1, sp.x, sp.y, r);
      sg.addColorStop(0, paired ? '#f0d79a' : '#8d6a34');
      sg.addColorStop(1, paired ? '#a87a2d' : '#2e2112');
      pctx.fillStyle = sg;
      pctx.fill();
      pctx.strokeStyle = selected ? '#fff2c9' : 'rgba(201,163,90,.4)';
      pctx.lineWidth = selected ? 1.4 : 0.7;
      pctx.stroke();
      /* label */
      var lr = radius + Math.max(9, w * 0.028);
      var lx = cx + Math.cos(sp.a) * lr;
      var ly = cy + Math.sin(sp.a) * lr;
      pctx.fillStyle = paired ? 'rgba(240,215,154,.95)' : 'rgba(139,127,108,.7)';
      pctx.font = '500 ' + Math.max(5, w * 0.017) + 'px "IBM Plex Mono", monospace';
      pctx.textAlign = 'center';
      pctx.textBaseline = 'middle';
      pctx.fillText(ALPHA.charAt(s), lx, ly);
      pctx.restore();
    }

    /* center label */
    pctx.save();
    pctx.textAlign = 'center';
    pctx.textBaseline = 'middle';
    pctx.font = '500 ' + Math.max(6, w * 0.022) + 'px "Cinzel", serif';
    pctx.fillStyle = 'rgba(201,163,90,.55)';
    pctx.fillText('STECKERBRETT', cx, cy - 6);
    pctx.font = '400 ' + Math.max(5, w * 0.015) + 'px "IBM Plex Mono", monospace';
    pctx.fillStyle = 'rgba(139,127,108,.65)';
    pctx.fillText('PLUGBOARD · ' + (pairs.filter(function (v) { return v >= 0; }).length / 2) + '/10', cx, cy + 9);
    pctx.restore();
  }

  /* ---------- init ---------- */

  buildRotors();
  buildKeyboards();
  reflectorSel.value = 'B';
  updatePositions();
  ghost = buildStages(0);
  stateEl.textContent = 'Ready. Type a letter or a message.';
  plugsInput.value = '';

  /* A little automatic demo helps the signal path show itself. */
  if (!CM.reduced) {
    setTimeout(function () {
      if (!signal && section.getBoundingClientRect().top < window.innerHeight) {
        ghost = buildStages(0);
      }
    }, 800);
  }

  CM.onVisible(section, function () { animator.start(); }, function () { animator.stop(); }, '250px');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) animator.stop();
    else if (section.getBoundingClientRect().bottom > 0) animator.start();
  });
})();
