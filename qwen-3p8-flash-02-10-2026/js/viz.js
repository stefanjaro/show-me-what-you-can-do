// CANTUS MACHINA — the visual field: spectrum aurora, scrolling score, chord compass.
// Everything here is driven by the same numbers the audio engine hears.

const VOICE_COLOR = {
  pad: '#4c6f9b', bass: '#8a5a7a', pluck: '#59c8a5', lead: '#f2b134',
  bell: '#ffe9a6', perc: '#9aa7b1', jam: '#ff8f5e', user: '#ff8f5e',
};
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const PCSHARP = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export class Viz {
  constructor(canvas, engine) {
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.engine = engine;
    this.notes = [];        // {start, dur, pitch, voice, vel}
    this.particles = [];
    this.chordTrail = [];   // pitch classes of recent chords
    this.pulses = [];
    this.hue = 40; this.dark = 0.5;
    this.scale = null;
    this.curName = '';
    this.P0 = 40; this.P1 = 92;
    this.running = true;
    this.t0 = performance.now();
    this.loop = this.frame.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.c.clientWidth, h = this.c.clientHeight;
    if (this.c.width !== Math.floor(w * dpr) || this.c.height !== Math.floor(h * dpr)) {
      this.c.width = Math.floor(w * dpr);
      this.c.height = Math.floor(h * dpr);
      this.x.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
    }
  }

  note(ev, absStart, beatDur, voiceOverride) {
    if (!(ev.midi > 0)) return;
    const v = voiceOverride || ev.voice;
    this.notes.push({ start: absStart, dur: ev.dur, pitch: ev.midi, voice: v, vel: ev.vel });
    if (v === 'bell' || v === 'jam') {
      if (this.particles.length < 60) {
        this.particles.push({
          x: Math.random() * this.W, y: this.H * (0.4 + Math.random() * 0.5),
          vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 10,
          life: 1, size: 1 + Math.random() * 1.6,
          color: v === 'jam' ? VOICE_COLOR.jam : '#ffe9a6',
        });
      }
    }
  }

  pulse(absTime) { this.pulses.push(absTime); }

  setChord(pcAbs, name) {
    const pc = pcAbs[0];
    this.curName = name || '';
    const last = this.chordTrail[this.chordTrail.length - 1];
    if (last !== pc) {
      this.chordTrail.push(pc);
      if (this.chordTrail.length > 24) this.chordTrail.shift();
    }
  }

  setTheme(hue, dark) { this.hue = hue; this.dark = dark; }
  setScale(rootPc, intervals) { this.scale = { root: rootPc, iv: intervals }; }

  frame() {
    if (!this.running) return;
    this.resize();
    const { x, W, H } = this;
    if (!W) { requestAnimationFrame(this.loop); return; }
    const now = this.engine && this.engine.ctx ? this.engine.ctx.currentTime : 0;
    const t = (performance.now() - this.t0) / 1000;

    // background wash
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = `rgba(8,10,14,0.22)`;
    x.fillRect(0, 0, W, H);

    this.drawAurora(now, t);
    this.drawScore(now, t);
    this.drawCompass(now);
    this.drawParticles();

    requestAnimationFrame(this.loop);
  }

  drawAurora(now, t) {
    const { x, W, H, engine } = this;
    if (!engine.ctx) return;
    const sp = engine.spectrum();
    const bands = 64;
    x.save();
    x.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 3; layer++) {
      const hue = layer === 1 ? (this.hue + 40) % 360 : (this.hue + 12 * layer) % 360;
      x.beginPath();
      const band = H * 0.24;                       // aurora lives in the top quarter
      const baseY = band * 0.5;
      for (let i = 0; i <= bands; i++) {
        const bin = Math.floor(Math.pow(i / bands, 1.7) * 300) + 2;
        const v = sp[bin] / 255;
        const px = (i / bands) * W;
        const py = baseY + layer * 7 - Math.pow(v, 1.4) * band * (1.05 - layer * 0.22)
          * (1 + 0.18 * Math.sin(t * 0.7 + i * 0.33 + layer * 2));
        if (i === 0) x.moveTo(px, py);
        else x.quadraticCurveTo(px - W / bands / 2, py, px, py);
      }
      x.lineTo(W, band * 1.15); x.lineTo(0, band * 1.15); x.closePath();
      const grad = x.createLinearGradient(0, 0, 0, band);
      grad.addColorStop(0, `hsla(${hue},64%,58%,${0.075 - layer * 0.017})`);
      grad.addColorStop(1, 'hsla(0,0%,0%,0)');
      x.fillStyle = grad;
      x.fill();
    }
    x.restore();
  }

  drawScore(now, t) {
    const { x, W, H } = this;
    const PH = W * 0.22;                 // playhead position
    const pps = W * 0.05;                // px per beat
    const top = H * 0.3, bot = H * 0.965;
    const yFor = (p) => bot - ((p - this.P0) / (this.P1 - this.P0)) * (bot - top);
    const beat = this.engine.beat || 0.8;
    const pxx = (sec) => PH + (sec - now) * pps / beat;

    // scale rows of the current key glow faintly — you can see the mode's shape
    if (this.scale) {
      const inScale = new Set(this.scale.iv.map((s) => (this.scale.root + s) % 12));
      for (let p = this.P0; p <= this.P1; p++) {
        const pc = ((p % 12) + 12) % 12;
        if (!inScale.has(pc)) continue;
        x.fillStyle = pc === this.scale.root ? 'rgba(242,177,52,0.045)' : 'rgba(160,180,210,0.02)';
        const y = yFor(p);
        x.fillRect(0, y - 1.5, W, 3);
      }
    }

    // bar lines (future)
    x.strokeStyle = 'rgba(255,255,255,0.055)';
    x.lineWidth = 1;
    const nextBar = Math.ceil(now / (beat * 4)) * beat * 4;
    for (let b = 0; b < 8; b++) {
      const px = pxx(nextBar + b * beat * 4);
      if (px > W) break;
      x.beginPath(); x.moveTo(px, top); x.lineTo(px, bot); x.stroke();
    }

    // playhead + pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const age = now - this.pulses[i];
      if (age > 2.2) { this.pulses.splice(i, 1); continue; }
      if (age < 0) continue;
      const px = pxx(this.pulses[i]);
      const a = Math.max(0, 0.30 * (1 - age / 2.2));
      x.fillStyle = `rgba(242,177,52,${a})`;
      x.fillRect(px - 1.5, top, 3, bot - top);
    }
    x.strokeStyle = 'rgba(242,177,52,0.9)';
    x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(PH, top); x.lineTo(PH, bot); x.stroke();

    // notes
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      if (now > n.start + n.dur * beat + 2.2) { this.notes.splice(i, 1); continue; }
      const x0 = Math.max(-24, pxx(n.start));
      const x1 = pxx(n.start + n.dur * beat);
      if (x0 > W + 24) continue;
      const w = Math.max(3, x1 - x0);
      const y = yFor(n.pitch);
      const h = n.voice === 'bass' ? 6.5 : n.voice === 'pad' ? 4.5 : n.voice === 'lead' || n.voice === 'jam' ? 4.5 : 3.4;
      const col = VOICE_COLOR[n.voice] || '#ccc';
      const future = n.start > now;
      let a = Math.min(1, n.vel * 2.1);
      if (future) a *= 0.55;
      else {
        const past = (now - n.start) / 2.4;
        a *= Math.max(0, 1 - past * past);
      }
      const xw = Math.min(w, W + 30 - x0);
      // glow pass for prominent voices
      if ((n.voice === 'lead' || n.voice === 'jam') && !future && a > 0.2) {
        x.fillStyle = hexA(col, a * 0.16);
        rr(x, x0 - 4, y - h, xw + 8, h * 2, h);
        x.fill();
      }
      x.fillStyle = hexA(col, a);
      rr(x, x0, y - h / 2, xw, h, h / 2);
      x.fill();
      if (future) { // leading edge tick
        x.fillStyle = hexA(col, a * 2);
        x.fillRect(x0 - 0.5, y - h / 2, 1.5, h);
      }
    }

    // register labels
    x.fillStyle = 'rgba(255,255,255,0.3)';
    x.font = '10px ui-monospace, Menlo, Consolas, monospace';
    for (const p of [48, 60, 72, 84]) {
      x.fillText(midiLabel(p), 6, yFor(p) + 3);
    }
  }

  drawCompass(now) {
    const { x, W, H, engine } = this;
    const r = Math.min(58, W * 0.09);
    const cx = W - r - 26, cy = H - r - 40;
    x.save();
    x.strokeStyle = 'rgba(255,255,255,0.09)';
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    const pos = (pc) => {
      const i = FIFTHS.indexOf(pc);
      const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    };
    // trail path: roots walking the circle of fifths
    const tr = this.chordTrail;
    for (let i = 1; i < tr.length; i++) {
      const [x0, y0] = pos(tr[i - 1]), [x1, y1] = pos(tr[i]);
      x.strokeStyle = `rgba(242,177,52,${0.05 + 0.5 * (i / tr.length) ** 2})`;
      x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    }
    const cur = tr[tr.length - 1];
    x.font = '9px ui-monospace, Menlo, monospace';
    for (let i = 0; i < 12; i++) {
      const pc = FIFTHS[i];
      const [px, py] = pos(pc);
      const lastIdx = tr.lastIndexOf(pc);
      const age = lastIdx >= 0 ? tr.length - 1 - lastIdx : 99;
      const a = Math.max(0.12, Math.min(1, 1 - age / 7));
      x.fillStyle = `hsla(${(this.hue + age * 6) % 360},58%,64%,${a})`;
      x.beginPath(); x.arc(px, py, pc === cur ? 4.8 : 2.8, 0, Math.PI * 2); x.fill();
      const lx = cx + (px - cx) * (1 + 15 / r), ly = cy + (py - cy) * (1 + 15 / r);
      x.fillStyle = 'rgba(255,255,255,0.34)';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(PCSHARP[pc], lx, ly);
      if (pc === cur) {
        x.strokeStyle = hexA(VOICE_COLOR.lead, 0.75);
        x.lineWidth = 1.5;
        x.beginPath(); x.arc(px, py, 9 + Math.sin(now * 3) * 1.6, 0, Math.PI * 2); x.stroke();
      }
    }
    x.textAlign = 'center';
    x.fillStyle = 'rgba(255,255,255,0.5)';
    x.font = '10px ui-monospace, Menlo, monospace';
    x.fillText('ROOTS', cx, cy - 4);
    x.fillStyle = hexA(VOICE_COLOR.lead, 0.85);
    x.font = 'bold 12px ui-monospace, Menlo, monospace';
    x.fillText(this.curName || '·', cx, cy + 10);
    x.restore();
  }

  drawParticles() {
    const { x } = this;
    x.save();
    x.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= 0.008;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.vy += 1.4 * 0.016;
      x.globalAlpha = p.life * 0.5;
      x.fillStyle = p.color;
      x.beginPath(); x.arc(p.x, p.y, p.size, 0, Math.PI * 2); x.fill();
    }
    x.restore();
  }
}

function midiLabel(p) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return names[p % 12] + (Math.floor(p / 12) - 1);
}
function rr(x, px, py, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
