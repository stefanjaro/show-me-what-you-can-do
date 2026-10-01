/* PRIMORDIA audio: generative biosphere soundscape. No samples, pure synthesis. */
'use strict';

const AudioEngine = {
  ctx: null, master: null, padGain: null, windGain: null,
  enabled: false, chordT: 0, chord: [110, 138.6, 164.8, 220],
  birdT: 0,

  toggle() {
    if (!this.ctx) this.boot();
    this.enabled = !this.enabled;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.5 : 0.0, this.ctx.currentTime + 0.6);
    return this.enabled;
  },

  boot() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      // pad
      this.padGain = this.ctx.createGain(); this.padGain.gain.value = 0.16;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.6;
      this.padGain.connect(lp); lp.connect(this.master);
      this.padOsc = [];
      for (let i = 0; i < 4; i++) {
        const o = this.ctx.createOscillator(); o.type = i < 2 ? 'sawtooth' : 'triangle';
        o.frequency.value = this.chord[i]; o.detune.value = (i - 1.5) * 4;
        const g = this.ctx.createGain(); g.gain.value = i < 2 ? 0.5 : 0.8;
        o.connect(g); g.connect(this.padGain); o.start();
        this.padOsc.push(o);
      }
      // slow LFO on pad
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = this.ctx.createGain(); lg.gain.value = 0.06;
      lfo.connect(lg); lg.connect(this.padGain.gain); lfo.start();
      // wind: looped noise
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.5;
      this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.05;
      src.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.master);
      src.start();
    } catch (e) { this.ctx = null; }
  },

  setChordForWorld(alive, extinct, season) {
    // thriving -> bright major; collapse -> dark minor
    const health = clamp(alive / 8, 0, 1) - clamp(extinct / 30, 0, 0.5);
    const root = 98 + (health * 24);
    const major = health > 0.25;
    const third = major ? root * 1.26 : root * 1.189;
    this.chord = [root, third, root * 1.5, root * 2];
    if (season === 'WINTER') this.chord = this.chord.map(f => f * 0.89);
    if (this.padOsc) for (let i = 0; i < 4; i++) this.padOsc[i].frequency.linearRampToValueAtTime(this.chord[i], this.ctx.currentTime + 3);
  },

  chirp() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    const f = 2200 + Math.random() * 2400;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
  },

  boom() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.7);
  },

  chime() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.1, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.8);
      o.connect(g); g.connect(this.master); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.9);
    });
  },

  update(dt, herbCount, isDay) {
    if (!this.ctx || !this.enabled) return;
    this.chordT -= dt;
    if (this.chordT <= 0) {
      this.chordT = 14;
      this.setChordForWorld(Life.aliveCount(), Life.extinctions, World.seasonName());
    }
    if (this.windGain) {
      const target = 0.02 + clamp(World.rainfall - 0.6, 0, 1.4) * 0.05 + (World.iceAge ? 0.05 : 0);
      this.windGain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 1);
    }
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 1 + Math.random() * 6;
      if (isDay && herbCount > 12 && Math.random() < 0.75) { this.chirp(); if (Math.random() < 0.4) setTimeout(() => this.chirp(), 180); }
    }
  },
};
