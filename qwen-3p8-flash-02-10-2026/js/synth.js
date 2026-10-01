// CANTUS MACHINA — the instrument. Every sound is synthesized live by the Web Audio
// API: oscillators, envelope-shaped FM, filtered noise, and a reverb whose impulse
// response is procedurally generated at startup. No samples, no files, no network.

import { midiToFreq } from './theory.js';
import { stream, jitter } from './rng.js';

const T20 = 0.0001;

export class Engine {
  constructor() {
    this.ctx = null;
    this.voices = 0;
    this.prevLeadF = 0;
    this.Ctor = null;            // set to OfflineAudioContext for test rendering
    this.sampleRateHint = 44100;
    this.offlineSeconds = 24;
  }

  async start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return this.ctx; }
    if (this.Ctor) {
      // offline rendering (used by the test suite to prove the audio actually works)
      this.ctx = new this.Ctor(2, Math.floor(this.sampleRateHint * this.offlineSeconds), this.sampleRateHint);
      this.buildGraph();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.buildGraph();
    return this.ctx;
  }

  buildGraph() {
    const ctx = this.ctx;

    this.master = ctx.createGain(); this.master.gain.value = 0.86;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -15; this.comp.knee.value = 10;
    this.comp.ratio.value = 4.5; this.comp.attack.value = 0.006; this.comp.release.value = 0.22;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.buses = {};
    for (const name of ['pad', 'bass', 'pluck', 'lead', 'bell', 'perc', 'wind', 'fx']) {
      const g = ctx.createGain();
      g.gain.value = { pad: 0.85, bass: 1.0, pluck: 0.85, lead: 0.95, bell: 0.8, perc: 0.8, wind: 0.7, fx: 0.75 }[name];
      g.connect(this.master);
      this.buses[name] = g;
    }

    // reverb: procedural impulse response (stereo decaying noise + early reflections)
    this.revIn = ctx.createGain(); this.revIn.gain.value = 1;
    this.conv = ctx.createConvolver();
    this.conv.buffer = this.makeIR(3.2, 2.4);
    this.revOut = ctx.createGain(); this.revOut.gain.value = 0.9;
    this.revIn.connect(this.conv); this.conv.connect(this.revOut); this.revOut.connect(this.master);

    // ping-pong delay, beat-locked
    this.delayIn = ctx.createGain();
    this.dL = ctx.createDelay(2.0); this.dR = ctx.createDelay(2.0);
    this.fbL = ctx.createGain(); this.fbR = ctx.createGain();
    this.fbL.gain.value = 0.36; this.fbR.gain.value = 0.36;
    this.lpL = ctx.createBiquadFilter(); this.lpL.type = 'lowpass'; this.lpL.frequency.value = 2400;
    this.lpR = ctx.createBiquadFilter(); this.lpR.type = 'lowpass'; this.lpR.frequency.value = 2400;
    this.pL = ctx.createStereoPanner(); this.pL.pan.value = -0.68;
    this.pR = ctx.createStereoPanner(); this.pR.pan.value = 0.68;
    this.delayIn.connect(this.dL);
    this.dL.connect(this.lpL); this.lpL.connect(this.pL); this.pL.connect(this.master);
    this.lpL.connect(this.fbR); this.fbR.connect(this.dR);
    this.dR.connect(this.lpR); this.lpR.connect(this.pR); this.pR.connect(this.master);
    this.lpR.connect(this.fbL); this.fbL.connect(this.dL);
    this.setTempo(70);

    // noise bed source + a slow filter-motion LFO shared by the pads
    this.noise = ctx.createBufferSource();
    this.noise.buffer = this.makeNoise(2.5);
    this.noise.loop = true;
    this.noise.start();

    this.windBp = ctx.createBiquadFilter();
    this.windBp.type = 'bandpass'; this.windBp.frequency.value = 620; this.windBp.Q.value = 0.8;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windLfo = ctx.createOscillator(); this.windLfo.frequency.value = 0.045;
    this.windLfoAmt = ctx.createGain(); this.windLfoAmt.gain.value = 380;
    this.windLfo.connect(this.windLfoAmt); this.windLfoAmt.connect(this.windBp.frequency);
    this.windLfo.start();
    this.noise.connect(this.windBp);
    this.windBp.connect(this.windGain);
    this.windGain.connect(this.buses.wind);
    this.windRevSend = ctx.createGain(); this.windRevSend.gain.value = 0.7;
    this.windGain.connect(this.windRevSend); this.windRevSend.connect(this.revIn);

    this.padLfo = ctx.createOscillator(); this.padLfo.frequency.value = 0.11;
    this.padLfoAmt = ctx.createGain(); this.padLfoAmt.gain.value = 170;
    this.padLfo.connect(this.padLfoAmt); this.padLfo.start();

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(1024);
    return ctx;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const r = stream(Math.floor(Math.random() * 1e9), 'noise');
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    }
    return buf;
  }

  makeIR(seconds, decay) {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const r = stream(ctx.sampleRate, 'ir');
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay) * (t < 0.008 ? 0 : 1); // pre-delay hole
        lp = lp * 0.62 + (r() * 2 - 1) * 0.38;                   // one-pole smoothing = warm tail
        d[i] = lp * env;
      }
      // discrete early reflections, different per channel
      for (let k = 0; k < 7; k++) {
        const idx = Math.floor((0.012 + r() * 0.06) * sr) + ch * 97;
        if (idx < len) d[idx] += (r() - 0.5) * 0.5;
      }
    }
    return buf;
  }

  setTempo(bpm) {
    if (!this.ctx) return;
    const b = 60 / bpm, now = this.ctx.currentTime;
    this.beat = b;
    this.dL.delayTime.setTargetAtTime(b * 0.75, now, 0.4);
    this.dR.delayTime.setTargetAtTime(b * 0.5, now, 0.4);
  }

  setVolume(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  suspend() { return this.ctx && this.ctx.suspend(); }
  resume() { return this.ctx && this.ctx.resume(); }

  spectrum() { this.analyser.getByteFrequencyData(this.freqData); return this.freqData; }
  level() {
    this.analyser.getByteTimeDomainData(this.timeData);
    let s = 0;
    for (let i = 0; i < this.timeData.length; i++) { const x = (this.timeData[i] - 128) / 128; s += x * x; }
    return Math.sqrt(s / this.timeData.length);
  }

  // ---- plumbing helpers ----
  send(pan, node, rev, del) {
    const ctx = this.ctx;
    if (rev > 0) {
      const g = ctx.createGain(); g.gain.value = rev;
      node.connect(g); g.connect(this.revIn);
    }
    if (del > 0) {
      const g = ctx.createGain(); g.gain.value = del;
      node.connect(g); g.connect(this.delayIn);
    }
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    node.connect(p);
    return p;
  }

  cleanup(stopNode, nodes) {
    stopNode.onended = () => {
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
      this.voices = Math.max(0, this.voices - 1);
    };
  }

  // schedule a composer event at absolute audio time `when` (seconds), beat = seconds/beat
  play(ev, when, beat, seed, bar, idx) {
    if (!this.ctx) return;
    if (ev.voice === 'fx' && ev.art.kind === 'mark') return; // pure visual marker
    if (ev.voice === 'wind') { this.setWind(ev, when, beat); return; } // automation only, no nodes
    if (this.voices > 30) return; // polyphony guard (should never bind)
    this.voices++;
    const hum = { perc: 0.013, pluck: 0.010, lead: 0.015, bell: 0.02, bass: 0.006, pad: 0 }[ev.voice] || 0;
    if (hum) when += jitter(stream(seed, 'hum', bar, idx), hum);
    switch (ev.voice) {
      case 'pad': this.padVoice(ev, when, beat); break;
      case 'bass': this.bassVoice(ev, when, beat); break;
      case 'pluck': this.pluckVoice(ev, when, beat); break;
      case 'lead': this.leadVoice(ev, when, beat); break;
      case 'bell': this.bellVoice(ev, when, beat); break;
      case 'perc': this.percVoice(ev, when); break;
      case 'wind': this.setWind(ev, when, beat); break;
      case 'fx': this.fxVoice(ev, when, beat); break;
    }
  }

  padVoice(ev, when, beat) {
    const ctx = this.ctx, f = midiToFreq(ev.midi), d = ev.dur * beat;
    const amp = ctx.createGain(); amp.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 260 + ev.art.bright * 2500; lp.Q.value = 0.6;
    const s1 = ctx.createOscillator(); s1.type = 'sawtooth'; s1.frequency.value = f;
    const s2 = ctx.createOscillator(); s2.type = 'sawtooth'; s2.frequency.value = f;
    s2.detune.value = ev.art.width || 8;
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
    const subG = ctx.createGain(); subG.gain.value = 0.55;
    s1.connect(lp); s2.connect(lp); lp.connect(amp);
    sub.connect(subG); subG.connect(amp);
    this.padLfoAmt.connect(lp.frequency);
    const rel = 1.1 + (1 - ev.art.bright) * 0.8;
    const a = Math.max(0.05, ev.art.atk * beat);
    amp.gain.setValueAtTime(T20, when);
    amp.gain.linearRampToValueAtTime(ev.vel * 0.14, when + a);
    amp.gain.setValueAtTime(ev.vel * 0.14, when + Math.max(a, d * 0.7));
    amp.gain.exponentialRampToValueAtTime(T20, when + d + rel);
    const p = this.send(ev.art.pan || 0, amp, 0.45, 0.06);
    p.connect(this.buses.pad);
    const end = when + d + rel + 0.05;
    for (const o of [s1, s2, sub]) { o.start(when); o.stop(end); }
    this.cleanup(s1, [s1, s2, sub, subG, lp, amp, p]);
  }

  bassVoice(ev, when, beat) {
    const ctx = this.ctx, f = midiToFreq(ev.midi), d = ev.dur * beat;
    const amp = ctx.createGain(); amp.gain.value = 0;
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
    const body = ctx.createOscillator(); body.type = 'sawtooth'; body.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(900 + ev.vel * 700, when);
    lp.frequency.exponentialRampToValueAtTime(140, when + 0.25);
    const bg = ctx.createGain(); bg.gain.value = 0.5;
    body.connect(lp); lp.connect(bg); bg.connect(amp);
    sub.connect(amp);
    if (ev.art.slide) {
      for (const o of [sub, body]) {
        o.frequency.setValueAtTime(f * 0.972, when);
        o.frequency.exponentialRampToValueAtTime(f, when + 0.12);
      }
    }
    const rel = 0.15;
    amp.gain.setValueAtTime(T20, when);
    amp.gain.linearRampToValueAtTime(ev.vel * 0.5 * (1 - ev.art.sub * 0.2), when + 0.012);
    amp.gain.exponentialRampToValueAtTime(T20, when + d + rel);
    const p = this.send(0, amp, 0.05, 0.04);
    p.connect(this.buses.bass);
    const end = when + d + rel + 0.05;
    for (const o of [sub, body]) { o.start(when); o.stop(end); }
    this.cleanup(sub, [sub, body, lp, bg, amp, p]);
  }

  pluckVoice(ev, when, beat) {
    const ctx = this.ctx, f = midiToFreq(ev.midi);
    const dec = ev.art.dec * beat + 0.15;
    const amp = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(Math.min(9000, 900 + ev.vel * 3400), when);
    lp.frequency.exponentialRampToValueAtTime(220, when + dec * 0.8);
    const t1 = ctx.createOscillator(); t1.type = 'triangle'; t1.frequency.value = f;
    const t2 = ctx.createOscillator(); t2.type = 'sawtooth'; t2.frequency.value = f; t2.detune.value = -6;
    const g2 = ctx.createGain(); g2.gain.value = 0.28;
    t1.connect(lp); t2.connect(g2); g2.connect(lp); lp.connect(amp);
    amp.gain.setValueAtTime(ev.vel * 0.4, when);
    amp.gain.exponentialRampToValueAtTime(T20, when + dec);
    const p = this.send(ev.art.pan, amp, 0.24, 0.5);
    p.connect(this.buses.pluck);
    const end = when + dec + 0.05;
    t1.start(when); t2.start(when); t1.stop(end); t2.stop(end);
    this.cleanup(t1, [t1, t2, g2, lp, amp, p]);
  }

  leadVoice(ev, when, beat) {
    const ctx = this.ctx, f = midiToFreq(ev.midi), d = ev.dur * beat;
    const car = ctx.createOscillator(); car.type = 'sine';
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 1.006;
    const modG = ctx.createGain();
    modG.gain.setValueAtTime(ev.vel * 240 * ev.art.bright + 30, when);
    modG.gain.exponentialRampToValueAtTime(8, when + Math.min(0.5, d * 0.4));
    mod.connect(modG); modG.connect(car.frequency);
    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 4.9 + ev.art.vib * 1.4;
    const vibG = ctx.createGain(); vibG.gain.value = 0;
    vibG.gain.setValueAtTime(0, when + 0.25);
    vibG.gain.linearRampToValueAtTime(4 + ev.art.vib * 9, when + 0.8);
    vib.connect(vibG); vibG.connect(car.detune);
    if (ev.art.glide) {
      car.frequency.setValueAtTime(f * 0.955, when);
      car.frequency.exponentialRampToValueAtTime(f, when + 0.1);
    } else {
      car.frequency.setValueAtTime(f, when);
    }
    const amp = ctx.createGain(); amp.gain.value = 0;
    car.connect(amp);
    const rel = 0.45;
    amp.gain.setValueAtTime(T20, when);
    amp.gain.linearRampToValueAtTime(ev.vel * 0.34, when + 0.055);
    amp.gain.setValueAtTime(ev.vel * 0.34, when + Math.max(0.055, d * 0.85));
    amp.gain.exponentialRampToValueAtTime(T20, when + d + rel);
    const p = this.send(ev.art.pan, amp, 0.4, 0.22);
    p.connect(this.buses.lead);
    const end = when + d + rel + 0.05;
    car.start(when); mod.start(when); vib.start(when);
    car.stop(end); mod.stop(end); vib.stop(end);
    this.cleanup(car, [car, mod, modG, vib, vibG, amp, p]);
  }

  bellVoice(ev, when, beat) {
    const ctx = this.ctx, f = midiToFreq(ev.midi);
    const dec = Math.max(0.6, ev.art.dec);
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * (ev.art.ratio || 3.0);
    const modG = ctx.createGain();
    modG.gain.setValueAtTime(f * (ev.art.counter ? 1.8 : 2.8), when);
    modG.gain.exponentialRampToValueAtTime(1, when + 0.16);
    mod.connect(modG); modG.connect(car.frequency);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(ev.vel * 0.3, when);
    amp.gain.exponentialRampToValueAtTime(T20, when + dec);
    const p = this.send(ev.art.pan, amp, 0.85, 0.3);
    p.connect(this.buses.bell);
    const end = when + dec + 0.05;
    car.start(when); mod.start(when); car.stop(end); mod.stop(end);
    this.cleanup(car, [car, mod, modG, amp, p]);
  }

  percVoice(ev, when) {
    const ctx = this.ctx, kind = ev.art.kind;
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(42, when + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(ev.vel * 0.75, when);
      g.gain.exponentialRampToValueAtTime(T20, when + 0.36);
      o.connect(g);
      const p = this.send(0, g, 0.08, 0.05);
      p.connect(this.buses.perc);
      o.start(when); o.stop(when + 0.42);
      this.cleanup(o, [o, g, p]);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise.buffer;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (kind === 'hat') {
      f.type = 'highpass'; f.frequency.value = 5600;
      g.gain.setValueAtTime(ev.vel * 0.5, when);
      g.gain.exponentialRampToValueAtTime(T20, when + 0.03 + ev.vel * 0.06);
    } else { // rim / fill
      f.type = 'bandpass'; f.frequency.value = 1750; f.Q.value = 6;
      g.gain.setValueAtTime(ev.vel * 0.6, when);
      g.gain.exponentialRampToValueAtTime(T20, when + 0.08);
      const tone = ctx.createOscillator(); tone.type = 'sine'; tone.frequency.value = 392;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(ev.vel * 0.2, when);
      tg.gain.exponentialRampToValueAtTime(T20, when + 0.05);
      tone.connect(tg); tg.connect(g);
      tone.start(when); tone.stop(when + 0.08);
    }
    src.connect(f); f.connect(g);
    const p = this.send(Math.random() * 0.4 - 0.2, g, 0.2, 0.08);
    p.connect(this.buses.perc);
    const end = when + 0.15;
    src.start(when); src.stop(end);
    this.cleanup(src, [src, f, g, p]);
  }

  setWind(ev, when, beat) {
    const g = this.windGain.gain;
    g.setTargetAtTime(ev.art.level * ev.vel * 1.1, when, 0.9);
    this.windBp.frequency.setTargetAtTime(380 + ev.art.bright * 900, when, 2.0);
    this.windLfoAmt.gain.setTargetAtTime(220 + ev.art.level * 500, when, 3.0);
  }

  fxVoice(ev, when, beat) {
    const ctx = this.ctx;
    if (ev.art.kind === 'riser') {
      const d = ev.dur * beat;
      const src = ctx.createBufferSource();
      src.buffer = this.noise.buffer; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(160, when);
      bp.frequency.exponentialRampToValueAtTime(6000, when + d * 0.92);
      const g = ctx.createGain();
      g.gain.setValueAtTime(T20, when);
      g.gain.linearRampToValueAtTime(ev.vel * 0.16, when + d * 0.9);
      g.gain.exponentialRampToValueAtTime(T20, when + d + 0.18);
      src.connect(bp); bp.connect(g);
      const p = this.send(0, g, 0.75, 0.1);
      p.connect(this.buses.fx);
      src.start(when); src.stop(when + d + 0.3);
      this.cleanup(src, [src, bp, g, p]);
    } else if (ev.art.kind === 'subdrop') {
      const d = ev.dur * beat;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(64, when);
      o.frequency.exponentialRampToValueAtTime(26, when + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(ev.vel * 0.4, when);
      g.gain.exponentialRampToValueAtTime(T20, when + d);
      o.connect(g);
      const p = this.send(0, g, 0.2, 0);
      p.connect(this.buses.fx);
      o.start(when); o.stop(when + d + 0.1);
      this.cleanup(o, [o, g, p]);
    }
  }
}
