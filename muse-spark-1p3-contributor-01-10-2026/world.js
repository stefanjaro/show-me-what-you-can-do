/* PRIMORDIA world: procedural planet, climate, biomes, plants, disasters. */
'use strict';

const World = {
  W: 200, H: 124,
  elev: null, moist0: null, fert0: null, fert: null,
  plant: null, fire: null, rain: null, biome: null, tmp: null,
  seed: 1, preset: 'paradise', name: 'Unnamed',
  day: 0, seaLevel: 0.44,
  warmth: 0, rainfall: 1, tilt: 1, iceAge: false,
  iceTimer: 0, weatherT: 0,
  rainBands: [], // moving storm cells {x,y,r,amt}
  effects: [],   // visual events {kind,x,y,r,t}
  rand: null, noise: null,
  oceanFrac: 0, forestFrac: 0, meanTemp: 15,

  init(seedStr, preset) {
    this.seed = hashSeed(seedStr);
    this.preset = preset || 'paradise';
    this.rand = mulberry32(this.seed);
    this.noise = makeNoise2D(mulberry32(this.seed ^ 0x9e3779b9));
    this.name = genWorldName(this.rand, seedStr);
    this.day = 0; this.effects.length = 0;
    this.warmth = 0; this.rainfall = 1; this.tilt = 1; this.iceAge = false;
    const n = this.W * this.H;
    this.elev = new Float32Array(n); this.moist0 = new Float32Array(n);
    this.fert0 = new Float32Array(n); this.fert = new Float32Array(n);
    this.plant = new Float32Array(n); this.fire = new Float32Array(n);
    this.rain = new Float32Array(n); this.biome = new Uint8Array(n);
    this.tmp = new Float32Array(n);
    this.generate();
  },

  generate() {
    const { W, H, noise } = this;
    const r = this.rand;
    const ox = r() * 500, oy = r() * 500, oz = r() * 500;
    let freq, sea, mAmp;
    if (this.preset === 'archipelago') { freq = 0.026; sea = 0.49; mAmp = 0.16; }
    else if (this.preset === 'pangaea') { freq = 0.012; sea = 0.40; mAmp = 0.34; }
    else { freq = 0.018; sea = 0.44; mAmp = 0.24; }
    this.baseSea = sea; this.seaLevel = sea;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const nx = x * freq + ox, ny = y * freq + oy;
        let e = noise.fbm(nx, ny, 5, 2.02, 0.5);            // 0..1 continents
        const m = noise.ridge(nx * 1.7 + oz, ny * 1.7, 4);   // mountains
        e = e * (1 - mAmp) + (e * 0.35 + m * 0.65) * mAmp;
        // edge falloff -> island planet feel, weaker for pangaea
        const dx = (x / W - 0.5) * 2, dy = (y / H - 0.5) * 2;
        const edge = Math.sqrt(dx * dx + dy * dy);
        e -= Math.max(0, edge - 0.95) * (this.preset === 'pangaea' ? 0.25 : 0.55);
        this.elev[i] = clamp(e, 0, 1);
        const mo = noise.fbm(nx * 2.3 + oy, ny * 2.3 + ox, 4, 2.1, 0.5);
        this.moist0[i] = clamp(mo * 1.15 - 0.08, 0, 1);
        const f = noise.fbm(nx * 3.1 + oz, ny * 3.1, 3, 2.0, 0.5);
        this.fert0[i] = clamp(f * 1.2 - 0.1, 0, 1);
        this.fert[i] = this.fert0[i];
      }
    }
    // blur elevation once to soften
    this.blur(this.elev, 1);
    this.rainBands = [];
    for (let k = 0; k < 5; k++) this.rainBands.push({ x: r() * W, y: r() * H * 0.8 + H * 0.1, r: 12 + r() * 16, amt: 0.5 + r() * 0.5 });
    this.classifyAll();
  },

  blur(a, passes) {
    const { W, H } = this;
    const tmp = new Float32Array(a.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          s += a[yy * W + xx]; c++;
        }
        tmp[y * W + x] = s / c;
      }
      a.set(tmp);
    }
  },

  idx(x, y) { return y * this.W + x; },
  inB(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; },
  isWater(i) { return this.elev[i] < this.seaLevel; },

  seasonT() { // -1..1 annual wave, scaled by tilt
    return Math.sin((this.day / 360) * Math.PI * 2 - Math.PI / 2) * this.tilt;
  },
  seasonName() {
    const d = ((this.day % 360) + 360) % 360;
    return d < 90 ? 'SPRING' : d < 180 ? 'SUMMER' : d < 270 ? 'AUTUMN' : 'WINTER';
  },
  year() { return Math.floor(this.day / 360); },
  dayOfYear() { return Math.floor(this.day % 360) + 1; },

  tempAt(i) { return this.tmp[i]; },

  tickClimate(dt) {
    const { W, H } = this;
    this.weatherT += dt;
    // drift storms
    for (const b of this.rainBands) {
      b.x += dt * (1.6 + this.weatherT * 0);
      b.y += Math.sin((this.weatherT * 0.2 + b.r)) * dt * 0.35;
      if (b.x - b.r > W) { b.x = -b.r; b.y = this.rand() * H; }
    }
    this.rain.fill(0);
    const rf = this.rainfall;
    for (const b of this.rainBands) {
      const x0 = Math.max(0, Math.floor(b.x - b.r)), x1 = Math.min(W - 1, Math.ceil(b.x + b.r));
      const y0 = Math.max(0, Math.floor(b.y - b.r)), y1 = Math.min(H - 1, Math.ceil(b.y + b.r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - b.x, y - b.y) / b.r;
        if (d < 1) {
          const i = y * W + x;
          if (!this.isWater(i)) this.rain[i] = Math.max(this.rain[i], (1 - d) * b.amt * rf);
        }
      }
    }
    const sT = this.seasonT();
    const iceMod = this.iceAge ? -11 : 0;
    let tSum = 0, ocean = 0, forest = 0, land = 0;
    for (let y = 0; y < H; y++) {
      const lat = Math.abs(y / H - 0.5) * 2; // 0 eq .. 1 pole
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const e = this.elev[i];
        const water = e < this.seaLevel;
        if (water) ocean++;
        else {
          land++;
          if (this.plant[i] > 0.45) forest++;
        }
        let t = 27 - lat * 34 - Math.max(0, e - this.seaLevel) * 46 + this.warmth + iceMod;
        t += sT * (4 + lat * 13) * (water ? 0.35 : 1); // seasons bite harder on land & poles
        this.tmp[i] = t;
        tSum += t;
      }
    }
    this.oceanFrac = ocean / (W * H);
    this.forestFrac = land ? forest / land : 0;
    this.meanTemp = tSum / (W * H);
  },

  tickPlants(dt, rand) {
    const { W, H } = this;
    const sT = this.seasonT();
    const lightBase = 0.72 + 0.28 * Math.cos((this.day / 360) * TAU());
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (this.isWater(i)) { if (this.plant[i] > 0) this.plant[i] = Math.max(0, this.plant[i] - dt * 0.4); continue; }
        // fire
        if (this.fire[i] > 0) {
          this.fire[i] = Math.max(0, this.fire[i] - dt * 0.55);
          this.plant[i] = Math.max(0, this.plant[i] - dt * 1.4);
          if (this.fire[i] <= 0) this.fert[i] = clamp(this.fert[i] + 0.25, 0, 1); // ash fertilises
          // spread
          if (rand() < dt * 0.5 && this.plant[i] > 0.25) {
            const dx = (rand() * 3) | 0, dy = (rand() * 3) | 0;
            const xx = x + dx - 1, yy = y + dy - 1;
            if (this.inB(xx, yy)) {
              const j = yy * W + xx;
              if (!this.isWater(j) && this.plant[j] > 0.3 && this.fire[j] <= 0 && rand() < 0.5) this.fire[j] = 0.6 + rand() * 0.6;
            }
          }
          continue;
        }
        const t = this.tmp[i];
        const tSuit = clamp(1 - Math.abs(t - 21) / 26, 0, 1);
        if (t < -6) { this.plant[i] = Math.max(0, this.plant[i] - dt * 0.25); continue; }
        const water = clamp(this.moist0[i] * 0.65 + this.rain[i] * 0.9, 0, 1.2);
        const light = lightBase * (0.55 + 0.45 * (1 - Math.abs(sT) * 0.3));
        const K = clamp(0.25 + this.fert[i] * 0.9, 0.1, 1) * (0.35 + 0.65 * tSuit);
        const p = this.plant[i];
        if (K <= 0.03) { this.plant[i] = Math.max(0, p - dt * 0.05); continue; }
        const growth = 0.16 * light * (0.25 + water) * tSuit * p * (1 - p / K) * dt * 4;
        this.plant[i] = clamp(p + growth + (p <= 0.001 && this.fert[i] > 0.25 && water > 0.3 && tSuit > 0.35 ? dt * 0.004 * rand() : 0), 0, 1);
        // spread to neighbour
        if (p > 0.55 && rand() < dt * 0.06) {
          const xx = x + ((rand() * 3) | 0) - 1, yy = y + ((rand() * 3) | 0) - 1;
          if (this.inB(xx, yy)) {
            const j = yy * W + xx;
            if (!this.isWater(j) && this.plant[j] < 0.12 && this.fire[j] <= 0) this.plant[j] = 0.12;
          }
        }
        // fertility relaxes to base
        this.fert[i] += (this.fert0[i] - this.fert[i]) * dt * 0.01;
      }
    }
    this.classifyTick++;
    if ((this.classifyTick & 7) === 0) this.classifyAll();
  },

  classifyTick: 0,
  classifyAll() {
    const { W, H } = this;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      this.biome[i] = this.biomeOf(i, x, y);
    }
  },
  biomeOf(i, x, y) {
    // 0 deep 1 ocean 2 coast 3 beach 4 grass 5 forest 6 jungle 7 desert 8 savanna 9 tundra 10 ice 11 rock
    const e = this.elev[i];
    if (e < this.seaLevel - 0.10) return 0;
    if (e < this.seaLevel) return 1;
    if (e < this.seaLevel + 0.012) return 3;
    const t = this.tmp[i] || 18;
    const m = clamp(this.moist0[i] * 0.6 + this.rain[i] * 0.7, 0, 1);
    if (t < -8) return 10;
    if (e > 0.78) return 11;
    if (t < 2) return 9;
    if (m < 0.18 && t > 22) return 7;
    if (m < 0.32) return 8;
    if (this.plant[i] > 0.5 && m > 0.5 && t > 20) return 6;
    if (this.plant[i] > 0.42) return 5;
    return 4;
  },

  /* ---- god tools ---- */
  brushApply(tx, ty, radius, tool, rand) {
    const r2 = radius * radius;
    let hitLife = 0;
    for (let y = Math.floor(ty - radius); y <= ty + radius; y++) {
      for (let x = Math.floor(tx - radius); x <= tx + radius; x++) {
        if (!this.inB(x, y)) continue;
        const d2 = (x - tx) * (x - tx) + (y - ty) * (y - ty);
        if (d2 > r2) continue;
        const fall = 1 - Math.sqrt(d2) / (radius + 0.001);
        const i = y * this.W + x;
        if (tool === 'raise') this.elev[i] = clamp(this.elev[i] + 0.03 * fall + 0.004, 0, 1);
        else if (tool === 'lower') this.elev[i] = clamp(this.elev[i] - 0.035 * fall - 0.004, 0, 1);
        else if (tool === 'forest') { if (!this.isWater(i) && this.fire[i] <= 0) this.plant[i] = clamp(this.plant[i] + 0.5 * fall, 0, 1); }
        else if (tool === 'rain') this.rain[i] = clamp(this.rain[i] + 0.9 * fall, 0, 1.4);
        else if (tool === 'fire') { if (!this.isWater(i) && this.plant[i] > 0.15) this.fire[i] = Math.max(this.fire[i], fall); }
      }
    }
    return hitLife;
  },

  meteor(tx, ty, radius) {
    const W = this.W, H = this.H;
    let kills = 0;
    for (let y = Math.floor(ty - radius * 2.2); y <= ty + radius * 2.2; y++) {
      for (let x = Math.floor(tx - radius * 2.2); x <= tx + radius * 2.2; x++) {
        if (!this.inB(x, y)) continue;
        const d = Math.hypot(x - tx, y - ty);
        const i = y * W + x;
        if (d < radius) { this.elev[i] = clamp(this.elev[i] - 0.10 * (1 - d / radius), 0, 1); this.plant[i] = 0; this.fire[i] = d < radius * 0.7 ? 1 : this.fire[i]; kills++; }
        else if (d < radius * 2.2) { if (this.plant[i] > 0.2 && Math.random() < 0.5) this.fire[i] = Math.max(this.fire[i], 0.7); }
      }
    }
    // rim mountains
    for (let a = 0; a < 26; a++) {
      const ang = (a / 26) * TAU();
      const x = Math.round(tx + Math.cos(ang) * radius * 1.15), y = Math.round(ty + Math.sin(ang) * radius * 1.15);
      if (this.inB(x, y)) this.elev[y * W + x] = clamp(this.elev[y * W + x] + 0.05, 0, 1);
    }
    this.effects.push({ kind: 'meteor', x: tx, y: ty, r: radius * 3, t: 0, dur: 1.6 });
    return kills;
  },

  volcano(tx, ty) {
    const W = this.W;
    for (let y = Math.floor(ty - 6); y <= ty + 6; y++) for (let x = Math.floor(tx - 6); x <= tx + 6; x++) {
      if (!this.inB(x, y)) continue;
      const d = Math.hypot(x - tx, y - ty);
      const i = y * W + x;
      if (d < 2.5) this.elev[i] = clamp(this.elev[i] + 0.09 * (1 - d / 3), 0, 1);
      else if (d < 7 && !this.isWater(i)) this.fire[i] = Math.max(this.fire[i], 0.8 * (1 - d / 8));
    }
    this.effects.push({ kind: 'volcano', x: tx, y: ty, r: 20, t: 0, dur: 2.2 });
  },

  totalPlant() { let s = 0; for (let i = 0; i < this.plant.length; i++) s += this.plant[i]; return s; },
};
