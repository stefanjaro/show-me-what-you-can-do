/* CONTINUUM CA-7 - dsp-worklet.js
 * Receives the solver's 4 kHz stream and resamples it to the audio rate
 * with linear interpolation. If the machine is held (or the tab stalls)
 * it simply holds the last voltage, which is what a sample-and-hold does.
 */
class CA7DSP extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(16384);
    this.w = 0;
    this.r = 0;
    this.count = 0;
    this.frac = 0;
    this.hold = 0;
    this.sps = 4000;
    this.muted = 1;
    this.port.onmessage = (e) => {
      var d = e.data || {};
      if (d.sps) this.sps = d.sps;
      if (d.muted !== undefined) this.muted = d.muted;
      if (d.pcm) {
        var a = d.pcm;
        for (var i = 0; i < a.length; i++) {
          this.buf[this.w & 16383] = a[i];
          this.w++;
          if (this.count < 16384) this.count++;
        }
      }
    };
    this.port.postMessage({ hello: 1 });
  }

  process(inputs, outputs) {
    var out = outputs[0][0];
    if (!out) return true;
    var ratio = this.sps / sampleRate;
    if (this.muted) {
      for (var z = 0; z < out.length; z++) out[z] = 0;
      return true;
    }
    for (var i = 0; i < out.length; i++) {
      if (this.count < 1) { out[i] = this.hold; continue; }
      this.frac += ratio;
      while (this.frac >= 1 && this.count > 0) {
        this.hold = this.buf[this.r & 16383];
        this.r++;
        this.count--;
        this.frac -= 1;
      }
      if (this.count < 1) { out[i] = this.hold; continue; }
      var nxt = this.buf[this.r & 16383];
      out[i] = this.hold + (nxt - this.hold) * this.frac;
    }
    return true;
  }
}

registerProcessor('ca7-dsp', CA7DSP);
