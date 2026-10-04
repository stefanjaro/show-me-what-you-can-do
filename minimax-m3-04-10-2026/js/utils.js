/* utils.js — math, RNG, noise, naming, helpers. No libraries. */

'use strict';

const U = {

  // ---------- Math ----------
  TAU: Math.PI * 2,
  PHI: 1.618033988749895,

  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  smoothstep(a, b, x) {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  },
  remap(v, a, b, c, d) { return c + (d - c) * ((v - a) / (b - a)); },
  mix(a, b, t) { return a + (b - a) * t; },

  // Signed distance
  sdist(x, y, cx, cy) {
    const dx = x - cx, dy = y - cy;
    return Math.sqrt(dx * dx + dy * dy);
  },

  // 2D rotation
  rot2(x, y, c, s) { return [c * x - s * y, s * x + c * y]; },

  // ---------- Deterministic RNG ----------
  // Mulberry32
  rng(seed) {
    let s = (seed | 0) || 1;
    return function() {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  // Random float
  rand(rng, a, b) { return a + (b - a) * rng(); },

  // Random int
  randi(rng, a, b) { return Math.floor(a + (b - a + 1) * rng()); },

  // Random pick from array
  pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; },

  // Gaussian-ish (sum of two)
  gauss(rng, mean = 0, std = 1) {
    const u = 1 - rng();
    const v = rng();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * std;
  },

  // Chance
  chance(rng, p) { return rng() < p; },

  // ---------- Hashing ----------
  hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  hashXY(x, y, seed = 0) {
    let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },

  // ---------- Value noise (2D, deterministic) ----------
  // Smooth interpolated noise
  noise2(rngSeed) {
    const r = U.rng(rngSeed);
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function grad(h, x, y) {
      h = h & 7;
      const u = h < 4 ? x : y;
      const v = h < 4 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
    }

    return function(x, y) {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      x -= Math.floor(x); y -= Math.floor(y);
      const u = fade(x), v = fade(y);
      const A = perm[X] + Y, B = perm[X + 1] + Y;
      return U.lerp(
        U.lerp(grad(perm[A], x, y),     grad(perm[B], x - 1, y),     u),
        U.lerp(grad(perm[A + 1], x, y - 1), grad(perm[B + 1], x - 1, y - 1), u),
        v
      );
    };
  },

  // FBM
  fbm2(noise, x, y, octaves = 4, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return sum / norm;
  },

  // ---------- HSL/RGB ----------
  hsl(h, s, l, a = 1) { return `hsla(${h % 360},${s}%,${l}%,${a})`; },
  rgb(r, g, b, a = 1) { return `rgba(${r|0},${g|0},${b|0},${a})`; },

  // ---------- Procedural name generator ----------
  // Generates pronounceable latin-style species names from a genome seed.
  nameFromSeed(seed) {
    const r = U.rng(seed);
    const ons = [
      'b','c','d','f','g','h','j','k','l','m','n','p','qu','r','s','t','v','w','x','z',
      'br','cr','dr','fl','fr','gl','gr','pl','pr','sc','sk','sl','sp','st','str','thr','thr','thr'
    ];
    const ons2 = [
      'b','c','d','f','g','h','j','k','l','m','n','p','r','s','t','v','w','z',
      'bb','cc','dd','ff','gg','ll','mm','nn','pp','rr','ss','tt',
      'bs','ls','ns','rs','st','rt','rm','rn','mn','gn'
    ];
    const voc = [
      'a','e','i','o','u','ae','ia','io','ea','oa','ui','au','eu','iu','ou',
      'y','ia','io','iu'
    ];
    const vocEnd = [
      'a','e','i','o','u','us','um','ix','ax','ella','ina','ora','ara','enna','enna','ura','ula','ina','anus','aria','ana'
    ];

    const syll = () => {
      const o = U.pick(r, ons);
      const v = U.pick(r, voc);
      const tail = r() < 0.45 ? U.pick(r, ons2) : '';
      return o + v + tail;
    };

    const nSyll = 2 + Math.floor(r() * 3);
    let name = '';
    for (let i = 0; i < nSyll; i++) name += syll();
    if (r() < 0.55) name += U.pick(r, vocEnd);

    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  },

  // A second-word modifier for full species names (binomial style)
  epithetFromSeed(seed) {
    const r = U.rng(seed);
    const adjectives = [
      'minor','major','communis','vulgaris','silvestris','palustris','aurea','nigra','alba',
      'rubra','viridis','caerulea','argentea','lutea','cinerea','purpurea','rosea',
      'longipes','brevipes','maculata','striata','picta','glabra','hirsuta','spinosa',
      'rapax','velox','tarda','tecta','lucens','tenebris','noctis','solis','lunae',
      'parva','magna','regalis','humilis','alpina','campestris','aquatica','terrestris',
      'insulana','montana','arenaria','limicola','pratensis','fluviatilis','lacustris',
      'peltata','radiata','tubulata','squamata','laevis','rugosa','pinnata','digitata'
    ];
    return U.pick(r, adjectives);
  },

  binomialFromSeed(seed) {
    return U.nameFromSeed(seed) + ' ' + U.epithetFromSeed(seed ^ 0x9e3779b9);
  },

  // ---------- Misc ----------
  uid() { return Math.floor(Math.random() * 0x7fffffff); },
  uidS(rng) { return Math.floor(rng() * 0x7fffffff); },

  fmtTime(seconds) {
    if (!isFinite(seconds)) return '—';
    if (seconds < 60) return seconds.toFixed(1) + ' s';
    if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
    if (seconds < 86400) return (seconds / 3600).toFixed(1) + ' h';
    if (seconds < 86400 * 365) return (seconds / 86400).toFixed(1) + ' d';
    return (seconds / (86400 * 365)).toFixed(2) + ' y';
  },

  fmtAge(years) {
    if (years < 1) return (years * 365).toFixed(0) + ' d';
    return years.toFixed(2) + ' y';
  },

  fmtNum(n) {
    if (n < 1000) return n.toFixed(0);
    if (n < 1e6)  return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k';
    if (n < 1e9)  return (n / 1e6).toFixed(1) + 'M';
    return (n / 1e9).toFixed(2) + 'B';
  },

  // Bin format for shared-linkable seeds
  fmtSeed(n) { return (n >>> 0).toString(16).padStart(8, '0'); },

  // ---------- World Coordinate ----------
  // The world is a fixed-size 2D plane. We simulate it as a grid for static
  // features (terrain, plants, water) but creatures are free particles.
};

if (typeof module !== 'undefined') module.exports = U;