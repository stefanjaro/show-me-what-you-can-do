/* PRIMORDIA utils: seeded RNG, value noise, helpers. */
'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  if (typeof str === 'number') return str >>> 0;
  str = String(str);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function TAU() { return Math.PI * 2; }

/* Deterministic 2D value-noise with permutation grid. */
function makeNoise2D(rand) {
  const P = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) grad[i] = rand();
  function val(ix, iy) { return grad[P[(P[ix & 255] + iy) & 255]]; }
  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const a = val(ix, iy), b = val(ix + 1, iy), c = val(ix, iy + 1), d = val(ix + 1, iy + 1);
    const ux = smooth(fx), uy = smooth(fy);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy); // 0..1
  }
  function fbm(x, y, oct, lac, gain) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += amp * noise(x * f, y * f); norm += amp; amp *= gain; f *= lac; }
    return sum / norm;
  }
  function ridge(x, y, oct) {
    let amp = 0.55, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { const n = noise(x * f, y * f); sum += amp * (1 - Math.abs(n * 2 - 1)); norm += amp; amp *= 0.5; f *= 2.1; }
    return sum / norm;
  }
  return { noise, fbm, ridge };
}

function fmtInt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
