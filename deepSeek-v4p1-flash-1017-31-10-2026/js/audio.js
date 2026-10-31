/* Tiny synthesized sound kit. No samples, no libraries. */
(function () {
  'use strict';

  var enabled = false;
  var ctx = null;
  var master = null;
  var noiseBuffer = null;
  var listeners = [];

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
      var len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function burst(t, dur, freq, q, gain, type) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    var filter = ctx.createBiquadFilter();
    filter.type = type || 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(t, dur, freq, gain, type, slideTo, attack) {
    var osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    var g = ctx.createGain();
    var a = attack == null ? 0.006 : attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  var kit = {
    tick: function (t, o) {
      var p = (o && o.pitch) || 1;
      burst(t, 0.028, 2400 * p, 1.1, 0.06 * ((o && o.vol) || 1), 'bandpass');
      tone(t, 0.035, 680 * p, 0.025 * ((o && o.vol) || 1), 'triangle', 510 * p);
    },
    bead: function (t, o) {
      var p = (o && o.pitch) || 1;
      burst(t, 0.04, 1600 * p, 1.8, 0.05 * ((o && o.vol) || 1), 'bandpass');
      tone(t, 0.14, 760 * p, 0.055 * ((o && o.vol) || 1), 'sine', 520 * p);
      tone(t, 0.09, 210 * p, 0.03 * ((o && o.vol) || 1), 'sine', 180 * p);
    },
    ratchet: function (t, o) {
      for (var i = 0; i < 3; i++) {
        burst(t + i * 0.035, 0.025, 3000 - i * 300, 2.2, 0.045, 'bandpass');
        tone(t + i * 0.035, 0.03, 190 - i * 20, 0.025, 'square', 120);
      }
    },
    relay: function (t, o) {
      var p = (o && o.pitch) || 1;
      burst(t, 0.035, 1700 * p, 1.4, 0.075 * ((o && o.vol) || 1), 'bandpass');
      tone(t, 0.07, 120 * p, 0.06 * ((o && o.vol) || 1), 'triangle', 70 * p);
      tone(t, 0.045, 420 * p, 0.02, 'square', 350 * p);
    },
    key: function (t, o) {
      burst(t, 0.025, 2200, 1.3, 0.055, 'bandpass');
      tone(t, 0.06, 330, 0.03, 'triangle', 240);
    },
    lamp: function (t, o) {
      var p = (o && o.pitch) || 1;
      tone(t, 0.22, 620 * p, 0.04, 'sine', 660 * p, 0.012);
      tone(t, 0.18, 930 * p, 0.018, 'sine', 940 * p, 0.012);
    },
    slide: function (t, o) {
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      var f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.4;
      f.frequency.setValueAtTime(420, t);
      f.frequency.exponentialRampToValueAtTime(1500, t + 0.13);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.2);
    },
    chime: function (t, o) {
      var notes = (o && o.notes) || [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (f, i) {
        tone(t + i * 0.11, 1.5, f, 0.035, 'sine', null, 0.01);
        tone(t + i * 0.11, 1.2, f * 2.01, 0.012, 'sine', null, 0.01);
      });
    },
    wind: function (t, o) {
      for (var i = 0; i < 6; i++) {
        burst(t + i * 0.055, 0.03, 1800 + i * 180, 2.4, 0.035, 'bandpass');
      }
      tone(t, 0.38, 90, 0.018, 'sawtooth', 140, 0.04);
    }
  };

  function play(name, opts) {
    if (!enabled || !ensure()) return;
    var fn = kit[name];
    if (!fn) return;
    var t = ctx.currentTime + (opts && opts.delay ? opts.delay : 0.001);
    try { fn(t, opts || {}); } catch (e) { /* audio is garnish */ }
  }

  function notify() {
    listeners.forEach(function (fn) { fn(enabled); });
  }

  function setEnabled(v) {
    enabled = !!v;
    if (enabled) {
      ensure();
      play('wind');
    }
    notify();
  }

  window.CMSound = {
    play: play,
    setEnabled: setEnabled,
    toggle: function () { setEnabled(!enabled); return enabled; },
    isEnabled: function () { return enabled; },
    onChange: function (fn) { listeners.push(fn); },
    unlock: function () { if (enabled) ensure(); }
  };
})();
