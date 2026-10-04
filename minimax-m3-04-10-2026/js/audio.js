/* audio.js — procedural audio synthesis + ecosystem-reactive music. No libraries. */

'use strict';

const A = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  reverbBus: null,
  enabled: true,
  // Music state
  musicTimer: 0,
  musicState: {
    chordIdx: 0,
    nextChordAt: 0,
    lastNoteAt: 0,
    pulse: 0,
    tension: 0,
    brightness: 0,
    noteIdx: 0,
    chordRoot: 60, // MIDI
    scale: [0, 2, 3, 5, 7, 8, 10],
  },
  // Voices
  voices: { pad: null, lead: null, bass: null, pluck: null, drone: null },
  // Schedules
  scheduled: [],

  // ---------- Init ----------
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) { this.enabled = false; return; }
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.55;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.4;
    this.sfxGain.connect(this.master);

    // Simple reverb: chain of delays
    this.reverbBus = this.ctx.createGain();
    this.reverbBus.gain.value = 0.32;
    this.reverbBus.connect(this.musicGain);

    this._makeReverbImpulse();
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.55 : 0;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.4 : 0;
  },

  _makeReverbImpulse() {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 2.6);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Decaying noise + simple early reflections
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * 0.7;
        if (i < sr * 0.05) d[i] += Math.sin(i * 0.13) * Math.exp(-i / (sr * 0.03)) * 0.3;
      }
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = buf;
    this._reverb = conv;
    this._reverb.connect(this.reverbBus);
  },

  // ---------- Utilities ----------
  midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); },

  envelope(node, t0, attack, hold, release, peak = 1, sustain = 0.6) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
    g.setValueAtTime(Math.max(0.0001, peak * sustain), t0 + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  },

  // ---------- Synth voices ----------
  _makeVoice(type) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    let o1, o2, o3, f;
    if (type === 'pad') {
      o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.detune.value = -8;
      o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 8;
      f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 1.5;
      o1.connect(f); o2.connect(f); f.connect(g);
    } else if (type === 'lead') {
      o1 = ctx.createOscillator(); o1.type = 'square';
      o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.detune.value = 12;
      f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; f.Q.value = 4;
      const g2 = ctx.createGain(); g2.gain.value = 0.4;
      o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g);
    } else if (type === 'bass') {
      o1 = ctx.createOscillator(); o1.type = 'sine';
      o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.detune.value = -1200;
      o1.connect(g); o2.connect(g);
    } else if (type === 'pluck') {
      o1 = ctx.createOscillator(); o1.type = 'triangle';
      o2 = ctx.createOscillator(); o2.type = 'sine'; o2.detune.value = 1200;
      f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 5;
      o1.connect(f); o2.connect(f); f.connect(g);
    } else if (type === 'drone') {
      o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      o2 = ctx.createOscillator(); o2.type = 'sine'; o2.detune.value = 0;
      f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      o1.connect(f); o2.connect(f); f.connect(g);
    }
    if (o1) o1.start();
    if (o2) o2.start();
    if (o3) o3.start();
    g.connect(this.musicGain);
    g.connect(this._reverb);
    return { o1, o2, o3, g, f: f || null };
  },

  _ensureVoices() {
    if (!this.voices.pad) {
      this.voices.pad = this._makeVoice('pad');
      this.voices.lead = this._makeVoice('lead');
      this.voices.bass = this._makeVoice('bass');
      this.voices.pluck = this._makeVoice('pluck');
      this.voices.drone = this._makeVoice('drone');
    }
  },

  // ---------- Note scheduling ----------
  playNote(voice, midi, dur, when, vel = 1, detune = 0) {
    if (!this.ctx || !this.enabled) return;
    this._ensureVoices();
    const v = this.voices[voice];
    if (!v) return;
    const t = when ?? this.ctx.currentTime;
    const f = this.midiToHz(midi);
    if (v.o1) {
      v.o1.frequency.cancelScheduledValues(t);
      v.o1.frequency.setValueAtTime(f, t);
      if (v.o1.detune) v.o1.detune.setValueAtTime(detune, t);
    }
    if (v.o2) {
      v.o2.frequency.cancelScheduledValues(t);
      v.o2.frequency.setValueAtTime(f, t);
      if (v.o2.detune) v.o2.detune.setValueAtTime(-detune, t);
    }
    const peak = voice === 'pad' ? 0.22 * vel
              : voice === 'lead' ? 0.18 * vel
              : voice === 'bass' ? 0.35 * vel
              : voice === 'pluck' ? 0.24 * vel
              : voice === 'drone' ? 0.18 * vel
              : 0.2 * vel;
    const attack = voice === 'pad' ? 0.4 : voice === 'lead' ? 0.01 : voice === 'bass' ? 0.01 : 0.005;
    const release = voice === 'pad' ? 1.2 : voice === 'lead' ? 0.15 : voice === 'bass' ? 0.15 : voice === 'pluck' ? 0.6 : 1.5;
    this.envelope(v.g, t, attack, dur * 0.5, release, peak, 0.7);
    if (v.f && voice === 'lead') {
      v.f.frequency.cancelScheduledValues(t);
      v.f.frequency.setValueAtTime(800 + (midi - 60) * 90, t);
      v.f.frequency.linearRampToValueAtTime(2400, t + 0.05);
      v.f.frequency.exponentialRampToValueAtTime(400, t + dur + release);
    }
    if (v.f && voice === 'pad') {
      v.f.frequency.cancelScheduledValues(t);
      v.f.frequency.linearRampToValueAtTime(400 + (midi - 60) * 50, t + 0.2);
      v.f.frequency.linearRampToValueAtTime(800 + (midi - 60) * 70, t + dur);
    }
  },

  // ---------- Music tick (driven from main loop) ----------
  // dt is "music seconds" (real seconds * speed factor). We step notes at
  // a fixed tempo regardless of world sim speed.
  tick(dt, ecosystem) {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state === 'suspended') return;
    this._ensureVoices();

    this.musicTimer += dt;

    // Update reverb send a little
    if (ecosystem) {
      const pop = Math.min(1, ecosystem.population / 200);
      const div = Math.min(1, ecosystem.species / 12);
      this.reverbBus.gain.linearRampToValueAtTime(0.25 + div * 0.3, this.ctx.currentTime + 0.5);
      this.musicState.brightness = pop;
    }

    // Drone always on
    if (this.musicTimer < 0.2) {
      // Start drone on a low octave root
      const root = this.musicState.chordRoot - 24;
      const v = this.voices.drone;
      v.o1.frequency.linearRampToValueAtTime(this.midiToHz(root), this.ctx.currentTime + 1);
      v.o2.frequency.linearRampToValueAtTime(this.midiToHz(root + 7) * 0.5, this.ctx.currentTime + 1);
      this.envelope(v.g, this.ctx.currentTime, 3, 100, 3, 0.18, 0.9);
    }

    // Chord progression: simple 4-chord loop
    const progression = [
      [0, 4, 7],   // I
      [5, 9, 12],  // IV
      [7, 11, 14], // V
      [3, 7, 10],  // iii (or vi)
      [0, 4, 7],   // I
      [-2, 2, 5],  // bVII-ish
      [5, 9, 12],  // IV
      [3, 7, 10],  // iii
    ];
    const tempo = 50; // BPM
    const beat = 60 / tempo;
    const measureLen = beat * 4;
    if (this.musicTimer >= this.musicState.nextChordAt - this.musicTimer + measureLen) {
      this.musicState.nextChordAt = this.musicTimer + measureLen;
    }

    // Schedule next note events by lookahead
    const lookahead = 0.4;
    while (this.scheduled.length === 0 || this.scheduled[0] - this.ctx.currentTime < lookahead) {
      const when = this.scheduled.length === 0 ? this.ctx.currentTime + 0.05 : this.scheduled[0] + 0;
      const noteAtMusicTime = (this.scheduled.length === 0 ? 0 : this.scheduled[0] - this.ctx.currentTime) + this.musicTimer;

      // Pick next note based on a Markov-ish random walk over scale
      const scale = this.musicState.scale;
      let idx = (this.musicState.noteIdx + (Math.random() < 0.5 ? -1 : 1) +
                 (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) * 2 : 0) + scale.length) % scale.length;

      // Chord progression: figure out which beat we are on
      const beatInLoop = (noteAtMusicTime / beat) % 32; // 8-measure loop
      const measure = Math.floor(beatInLoop / 4);
      const beatInMeasure = beatInLoop % 4;
      const chord = progression[measure % progression.length];
      const root = this.musicState.chordRoot + chord[0];
      const third = this.musicState.chordRoot + chord[1];
      const fifth = this.musicState.chordRoot + chord[2];

      // Pad chord every measure
      if (beatInMeasure === 0) {
        this.playNote('pad', root, beat * 3.5, when, 0.7);
        this.playNote('pad', third, beat * 3.5, when, 0.55);
        this.playNote('pad', fifth, beat * 3.5, when, 0.5);
      }

      // Bass on beats 1 and 3
      if (beatInMeasure === 0 || beatInMeasure === 2) {
        this.playNote('bass', root - 24, beat * 1.5, when, 0.9);
      }

      // Lead: arpeggio + melodic fill
      const arp = [root, third, fifth, third + 12][beatInMeasure | 0];
      if (Math.random() < 0.7) {
        this.playNote('lead', arp + scale[idx] - 5, beat * 0.7, when, 0.5);
      }
      // Random melodic embellishment
      if (Math.random() < 0.18) {
        this.playNote('pluck', root + scale[(Math.random() * scale.length) | 0] + 12,
                      beat * 0.4, when, 0.3);
      }

      this.scheduled.push(when + beat);
      this.musicState.noteIdx = idx;
      if (this.scheduled.length > 256) this.scheduled.shift();
    }
  },

  // ---------- SFX ----------
  sfx(name, x, y) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.sfxGain);
    if (name === 'birth') {
      const o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(660 + Math.random() * 220, t);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.15);
      o.start(t); o.stop(t + 0.4);
      o.connect(g);
      this.envelope(g, t, 0.005, 0.1, 0.25, 0.18);
    } else if (name === 'death') {
      const o = this.ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.4);
      o.start(t); o.stop(t + 0.5);
      o.connect(g);
      this.envelope(g, t, 0.005, 0.1, 0.4, 0.16);
    } else if (name === 'speciation') {
      // Two-note ascending chime
      const o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(523, t);
      o.frequency.setValueAtTime(659, t + 0.18);
      o.frequency.setValueAtTime(784, t + 0.36);
      o.start(t); o.stop(t + 1.4);
      const o2 = this.ctx.createOscillator(); o2.type = 'triangle';
      o2.frequency.setValueAtTime(1046, t + 0.36);
      o2.start(t + 0.36); o2.stop(t + 1.6);
      o.connect(g); o2.connect(g);
      this.envelope(g, t, 0.01, 0.5, 1.0, 0.22);
    } else if (name === 'extinction') {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 1.5);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
      o.connect(f); f.connect(g);
      o.start(t); o.stop(t + 1.6);
      this.envelope(g, t, 0.05, 0.5, 1.0, 0.18);
    } else if (name === 'click') {
      const o = this.ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(440, t);
      o.start(t); o.stop(t + 0.05);
      o.connect(g);
      this.envelope(g, t, 0.001, 0.01, 0.05, 0.08);
    } else if (name === 'whoosh') {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.3, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 4);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(2000, t + 0.2);
      f.Q.value = 4;
      src.connect(f); f.connect(g);
      src.start(t); src.stop(t + 0.3);
      this.envelope(g, t, 0.02, 0.05, 0.2, 0.12);
    }
  }
};

if (typeof module !== 'undefined') module.exports = A;