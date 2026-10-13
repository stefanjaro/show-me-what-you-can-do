/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — audio.js
   Every sound in the house is synthesised live: a breathing drone, wind in
   the corridors, footsteps on stone, a bell for the seals, and the sound a
   doorway makes when it bends geometry. No audio files, no libraries.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = (g.IH = g.IH || {});

  function create() {
    const A = {
      ctx: null, ok: false, master: null, started: false,
      drone: null, wind: null, crackle: null, padGain: null,
      stepGain: null, noiseBuf: null,
    };

    A.start = function () {
      if (A.started) return;
      try {
        const Ctx = g.AudioContext || g.webkitAudioContext;
        if (!Ctx) return;
        A.ctx = new Ctx();
        A.started = true;
      } catch (e) { A.ok = false; return; }
      const ctx = A.ctx;
      A.master = ctx.createGain();
      A.master.gain.value = 0.0001;
      A.master.connect(ctx.destination);

      /* a single shared buffer of white noise */
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A.noiseBuf = buf;

      /* ── the drone: three detuned saws through a slowly wobbling filter ── */
      const dg = ctx.createGain(); dg.gain.value = 0.16;
      const df = ctx.createBiquadFilter();
      df.type = 'lowpass'; df.frequency.value = 220; df.Q.value = 3;
      dg.connect(df); df.connect(A.master);
      A.droneGain = dg;
      const freqs = [55, 82.4, 110.5];
      A.drone = freqs.map((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = i === 2 ? 0.5 : 0.32;
        o.connect(og); og.connect(dg);
        o.start();
        return o;
      });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
      const lg = ctx.createGain(); lg.gain.value = 90;
      lfo.connect(lg); lg.connect(df.frequency); lfo.start();

      /* ── wind: noise through a bandpass that breathes ── */
      const w = ctx.createBufferSource(); w.buffer = A.noiseBuf; w.loop = true;
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 1.4;
      const wg = ctx.createGain(); wg.gain.value = 0.05;
      w.connect(wf); wf.connect(wg); wg.connect(A.master); w.start();
      const wl = ctx.createOscillator(); wl.frequency.value = 0.09;
      const wlg = ctx.createGain(); wlg.gain.value = 260;
      wl.connect(wlg); wlg.connect(wf.frequency); wl.start();
      A.wind = { gain: wg, filter: wf };

      /* ── torch crackle: sparse grains of noise ── */
      const cg = ctx.createGain(); cg.gain.value = 0.0; cg.connect(A.master);
      A.crackle = cg;

      /* ── a pad that swells when a wing is entered ── */
      const pg = ctx.createGain(); pg.gain.value = 0.0;
      const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 900;
      pg.connect(pf); pf.connect(A.master);
      A.padGain = pg;
      A.pad = [110, 164.8, 220, 277.2].map((f) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = 0.25;
        o.connect(og); og.connect(pg); o.start(); return o;
      });
      void dg;
      A.ok = true;
      /* fade the whole house in */
      const t = ctx.currentTime;
      A.master.gain.setValueAtTime(0.0001, t);
      A.master.gain.exponentialRampToValueAtTime(0.9, t + 3);
    };

    A.suspend = function () { if (A.ctx && A.ctx.state === 'running') A.ctx.suspend(); };
    A.resume = function () { if (A.ctx && A.ctx.state !== 'running') A.ctx.resume(); };

    A.noise = function (dur, freq, q, gain, type) {
      if (!A.ok) return;
      const ctx = A.ctx, t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = A.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(gn); gn.connect(A.master);
      s.start(t); s.stop(t + dur + 0.05);
    };

    A.step = function (pitch) {
      if (!A.ok) return;
      const ctx = A.ctx, t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = A.noiseBuf;
      s.playbackRate.value = pitch || 1;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700 + 400 * (pitch || 1);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      s.connect(f); f.connect(gn); gn.connect(A.master);
      s.start(t, Math.random() * 1.5); s.stop(t + 0.2);
    };

    A.bell = function (f0) {
      if (!A.ok) return;
      const ctx = A.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0;
      const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.value = f0 * 2.01;
      const mg = ctx.createGain(); mg.gain.value = 220;
      m.connect(mg); mg.connect(o.frequency);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.42, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(gn); gn.connect(A.master);
      o.start(t); m.start(t); o.stop(t + 2.7); m.stop(t + 2.7);
    };

    A.door = function (up) {
      if (!A.ok) return;
      const ctx = A.ctx, t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = A.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.2;
      f.frequency.setValueAtTime(up ? 180 : 1500, t);
      f.frequency.exponentialRampToValueAtTime(up ? 1500 : 180, t + 0.42);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      s.connect(f); f.connect(gn); gn.connect(A.master);
      s.start(t); s.stop(t + 0.6);
      if (up) A.bell(196);
    };

    A.pad = function (level, hz) {
      if (!A.ok) return;
      const t = A.ctx.currentTime;
      A.padGain.gain.cancelScheduledValues(t);
      A.padGain.gain.linearRampToValueAtTime(level, t + 1.4);
      if (hz && A.pad) for (let i = 0; i < A.pad.length; i++) A.pad[i].frequency.value = hz[i];
    };

    A.crackleNow = function () {
      if (!A.ok) return;
      const t = A.ctx.currentTime;
      A.crackle.gain.cancelScheduledValues(t);
      A.crackle.gain.setValueAtTime(0.35, t);
      A.crackle.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      A.noise(0.09, 2600, 0.8, 0.12, 'highpass');
    };

    A.windLevel = function (v) {
      if (!A.ok) return;
      A.wind.gain.gain.linearRampToValueAtTime(v, A.ctx.currentTime + 1.2);
    };
    return A;
  }

  IH.audio = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
