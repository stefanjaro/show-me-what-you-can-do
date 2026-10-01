/*
 * audio.js — the sound chip, implemented with Web Audio.
 *
 * Three channels: two pulse channels with selectable duty and a noise
 * channel for percussion. Cartridges only ever poke the chip's registers at
 * 0xE020–0xE026; this file turns those numbers into sound.
 */

const HARMONICS = 48;

function pulseWave(ctx, duty) {
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let n = 1; n <= HARMONICS; n++) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function noiseBuffer(ctx) {
  const seconds = 1;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x1234;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 7;
    seed ^= seed >> 9;
    seed ^= seed << 8;
    data[i] = ((seed & 0xffff) / 0x8000) - 1;
  }
  return buffer;
}

export function createAudio() {
  let ctx = null;
  let ready = false;
  let master = null;
  let userGain = null;
  let analyser = null;
  let wave = null;
  let pulses = null;
  let noise = null;

  function init() {
    if (ready) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (err) {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0;
    userGain = ctx.createGain();
    userGain.gain.value = 0.75;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    wave = new Float32Array(analyser.fftSize);
    master.connect(userGain);
    userGain.connect(analyser);
    analyser.connect(ctx.destination);
    pulses = [0, 1].map(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      return { osc, gain, duty: -1, wave: null };
    });
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(master);
    src.start();
    noise = { src, gain };
    ready = true;
    return true;
  }

  function resume() {
    if (!init()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend();
  }

  function setUserVolume(v) {
    if (!ready) return;
    userGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) ** 1.5, ctx.currentTime, 0.02);
  }

  const PULSE_FREQ = (period) => 12288 / ((period & 0xffff) + 1);
  const NOISE_RATE = (period) => 12288 / ((period & 0xffff) + 1) / 64;
  const VOL = (v) => (Math.max(0, Math.min(15, v)) / 15) ** 2;

  function syncPulse(ch, freq, ctrl, on) {
    const t = ctx.currentTime;
    const enabled = on && (ctrl & 1) && ((ctrl >> 1) & 15) > 0;
    const vol = (ctrl >> 1) & 15;
    const dutySel = (ctrl >> 5) & 3;
    const duty = [0.125, 0.25, 0.5, 0.75][dutySel];
    if (duty !== ch.duty) {
      ch.wave = pulseWave(ctx, duty);
      ch.osc.setPeriodicWave(ch.wave);
      ch.duty = duty;
    }
    const f = Math.max(16, Math.min(16000, PULSE_FREQ(freq)));
    ch.osc.frequency.setTargetAtTime(f, t, 0.004);
    ch.gain.gain.setTargetAtTime(enabled ? VOL(vol) * 0.32 : 0, t, 0.006);
  }

  function syncNoise(freq, ctrl, on) {
    const t = ctx.currentTime;
    const enabled = on && (ctrl & 1) && ((ctrl >> 1) & 15) > 0;
    const vol = (ctrl >> 1) & 15;
    const rate = Math.max(0.04, Math.min(14, NOISE_RATE(freq)));
    noise.src.playbackRate.setTargetAtTime(rate, t, 0.01);
    noise.gain.gain.setTargetAtTime(enabled ? VOL(vol) * 0.25 : 0, t, 0.006);
  }

  /*
   * regs: { freq0, ctrl0, freq1, ctrl1, freq2, ctrl2, volume } or null to
   * silence everything (machine off or halted).
   */
  function sync(regs) {
    if (!ready) return;
    const t = ctx.currentTime;
    if (!regs) {
      master.gain.setTargetAtTime(0, t, 0.02);
      syncPulse(pulses[0], 0, 0, false);
      syncPulse(pulses[1], 0, 0, false);
      syncNoise(0, 0, false);
      return;
    }
    master.gain.setTargetAtTime(VOL(regs.volume) * 0.9, t, 0.03);
    syncPulse(pulses[0], regs.freq0, regs.ctrl0, true);
    syncPulse(pulses[1], regs.freq1, regs.ctrl1, true);
    syncNoise(regs.freq2, regs.ctrl2, true);
  }

  function getWaveform() {
    if (!ready) return null;
    analyser.getFloatTimeDomainData(wave);
    return wave;
  }

  return { init, resume, suspend, sync, setUserVolume, getWaveform, get ready() { return ready; } };
}
