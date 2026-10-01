/*!
 * CONTINUUM CA-7 - audio.js
 * Two ways to hear the machine:
 *   VCO     - the patched voltage becomes a pitch (any signal, any speed)
 *   SIGNAL  - the voltage itself, upsampled into an AudioWorklet
 * Nothing starts until you press the button; browsers insist on a gesture.
 */
(function (root) {
  'use strict';
  var CA7 = root.CA7;
  var BASE_HZ = 110, OCTAVES = 2.5;

  function AudioOut() {
    this.ctx = null;
    this.on = false;
    this.mode = 'vco';
    this.level = 0.4;
    this.osc = null;
    this.vca = null;
    this.node = null;
    this.ready = false;
  }

  AudioOut.prototype.enable = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.on = true;
      return true;
    }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
    } catch (e) { return false; }

    var self = this;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.level;
    this.master.connect(this.ctx.destination);

    /* oscillator path */
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'triangle';
    this.osc.frequency.value = BASE_HZ;
    this.vca = this.ctx.createGain();
    this.vca.gain.value = 1;
    this.osc.connect(this.vca).connect(this.master);
    this.osc.start();

    /* worklet path, if the browser has it */
    if (this.ctx.audioWorklet) {
      this.ctx.audioWorklet.addModule(root.location.href.replace(/[^/]*$/, '') + 'js/dsp-worklet.js')
        .then(function () {
          try {
            self.node = new AudioWorkletNode(self.ctx, 'ca7-dsp', { outputChannelCount: [1] });
            self.node.port.onmessage = function (e) { if (e.data && e.data.hello) self.ready = true; };
            self.node.connect(self.master);
            self.ready = true;
          } catch (e) { self.node = null; }
        })
        .catch(function () { self.node = null; });
    }

    this.on = true;
    this.applyMode();
    return true;
  };

  AudioOut.prototype.disable = function () {
    this.on = false;
    if (this.vca) this.vca.gain.value = 0;
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  };

  AudioOut.prototype.setLevel = function (v) {
    this.level = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.level;
  };

  AudioOut.prototype.setMode = function (m) {
    this.mode = m === 'direct' ? 'direct' : 'vco';
    if (this.ctx && this.ctx.state === 'suspended' && this.on) this.ctx.resume();
    this.applyMode();
  };

  AudioOut.prototype.applyMode = function () {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    if (this.mode === 'vco') {
      this.vca.gain.setTargetAtTime(1, t, 0.02);
      if (this.node) this.node.port.postMessage({ muted: 1 });
    } else {
      this.vca.gain.setTargetAtTime(0, t, 0.02);
      if (this.node) this.node.port.postMessage({ muted: 0 });
    }
  };

  /* called once per animation frame with the live signal, in volts */
  AudioOut.prototype.update = function (volts, sps) {
    if (!this.on || !this.ctx) return;
    var t = this.ctx.currentTime;
    if (this.mode === 'vco') {
      var v = Math.max(-14, Math.min(14, volts));
      var f = BASE_HZ * Math.pow(2, OCTAVES * v / 10);
      this.osc.frequency.setTargetAtTime(f, t, 0.025);
    } else if (this.node) {
      this.node.port.postMessage({ sps: sps });
    }
  };

  /* hand the worklet the samples the solver produced since last frame */
  AudioOut.prototype.feed = function (arr, n) {
    if (!this.on || this.mode !== 'direct' || !this.node || !n) return;
    var copy = arr.slice(0, n);
    this.node.port.postMessage({ pcm: copy }, [copy.buffer]);
  };

  CA7.AudioOut = AudioOut;
})(typeof globalThis !== 'undefined' ? globalThis : this);
