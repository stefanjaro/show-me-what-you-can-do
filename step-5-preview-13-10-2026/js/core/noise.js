/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — noise.js
   A small procedural noise library written from scratch: integer hashing,
   value noise, fBm, ridged noise, Worley/cellular noise and domain warping.
   No dependencies. Runs identically in the browser and in Node.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = (g.IH = g.IH || {});

  /* ── deterministic PRNG ───────────────────────────────────────────────── */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 2D integer hash -> [0,1) */
  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* 3D integer hash -> [0,1) */
  function hash3(x, y, z, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
            Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1013904223);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10); // quintic

  /* Smooth (interpolated) value noise, period `period` (0 = infinite). */
  function value2(x, y, seed, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const p = period || 0;
    const wrap = (v) => {
      if (!p) return v;
      return ((v % p) + p) % p;
    };
    const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi), y1 = wrap(yi + 1);
    const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
    const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
    const top = a + (b - a) * xf, bot = c + (d - c) * xf;
    return top + (bot - top) * yf;
  }

  /* Fractal Brownian motion */
  function fbm2(x, y, octaves, seed, lacunarity, gain) {
    lacunarity = lacunarity || 2;
    gain = gain === undefined ? 0.5 : gain;
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * value2(x * freq, y * freq, seed + i * 1013);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /* Ridged multifractal — good for rock, veins and marble */
  function ridged2(x, y, octaves, seed) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(value2(x * freq, y * freq, seed + i * 7919) * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return sum / norm;
  }

  /* Worley / cellular noise: returns {f1, f2, id} */
  function worley2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = xi + ox, cy = yi + oy;
        const px = cx + hash2(cx, cy, seed);
        const py = cy + hash2(cy, cx, seed + 977);
        const dx = px - x, dy = py - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const cid = hash2(cx, cy, seed + 313);
        if (d < f1) { f2 = f1; f1 = d; id = cid; }
        else if (d < f2) f2 = d;
      }
    }
    return { f1: f1, f2: f2, id: id };
  }

  /* Domain-warped fBm — the classic "marble / nebula" swirl */
  function warpFbm(x, y, octaves, seed, strength) {
    strength = strength === undefined ? 0.6 : strength;
    const qx = fbm2(x + 5.2, y + 1.3, 4, seed + 11, 2, 0.5);
    const qy = fbm2(x + 1.7, y + 9.2, 4, seed + 71, 2, 0.5);
    return fbm2(x + strength * qx * 6, y + strength * qy * 6, octaves, seed + 401, 2, 0.5);
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const mix = (a, b, t) => a + (b - a) * t;

  IH.noise = {
    mulberry32: mulberry32,
    hash2: hash2,
    hash3: hash3,
    value2: value2,
    fbm2: fbm2,
    ridged2: ridged2,
    worley2: worley2,
    warpFbm: warpFbm,
    clamp01: clamp01,
    mix: mix,
    smooth: smooth,
  };
})(typeof window !== 'undefined' ? window : globalThis);
