/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — textures.js
   Every surface in the house is generated procedurally from noise: dressed
   stone, marble, oak, tile, gilt, tapestry, coffering, the void, flames.
   Textures are square, power-of-two, and stored as packed little-endian
   RGBA in Uint32Arrays — ready to be blitted straight into an ImageData.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = (g.IH = g.IH || {});
  const N = IH.noise;

  const pack = (r, gg, b) => (255 << 24) | ((b & 255) << 16) | ((gg & 255) << 8) | (r & 255);
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

  /* Generator registry: each takes (size, rand) and fills a Uint32Array. */
  const GENS = {};

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function heightShade(img, w, x, y, hArr, lx, ly, lz, light, amb) {
    const idx = (y & (w - 1)) * w + (x & (w - 1));
    const xr = (idx + 1) % w === 0 ? idx - w + 1 : idx + 1;
    const yu = (y <= 0 ? w - 1 : y - 1) * w + (x & (w - 1));
    const yd = (y >= w - 1 ? 0 : y + 1) * w + (x & (w - 1));
    const dx = hArr[xr] - hArr[idx];
    const dy = hArr[yd] - hArr[yu];
    const r = img[idx] & 255, gg = (img[idx] >> 8) & 255, b = (img[idx] >> 16) & 255;
    const d = dx * lx + dy * ly;
    const f = Math.max(0.25, light + d * lz);
    return pack(clamp255(r * f + amb), clamp255(gg * f + amb), clamp255(b * f + amb));
  }

  /* ── 1. dressed stone ────────────────────────────────────────────────── */
  GENS.stone = function (w, rand) {
    const img = new Uint32Array(w * w), H = new Float32Array(w * w);
    const bw = 4, bh = 4;                       // blocks across / down
    const rows = bh, cols = bw;
    const blockH = new Float32Array(rows * cols);
    const blockSeed = new Float32Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) { blockH[i] = rand(); blockSeed[i] = rand() * 1000; }
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cols, fy = (y / w) * rows;
        const row = Math.floor(fy), col = Math.floor(fx);
        const bi = (row % rows) * cols + (col % cols);
        const u = fx - Math.floor(fx), v = fy - Math.floor(fy);
        /* staggered courses */
        const shift = (row % 2) * 0.5;
        const uc = (u + shift) % 1;
        /* mortar gaps */
        const mortar = (u < 0.055 || u > 0.945 || v < 0.08 || v > 0.92);
        const edge = (u < 0.11 || u > 0.89 || v < 0.15 || v > 0.85);
        const grain = N.fbm2(x * 0.35, y * 0.35, 5, 17);
        const speck = N.value2(x * 1.7, y * 1.7, blockSeed[bi] | 0);
        const tone = blockH[bi] * 0.16;
        let base = 96 + tone * 120 + grain * 26 + speck * 12;
        if (mortar) base = 74 + grain * 20;
        else if (edge) base *= 0.9;
        const r = base * 1.0, gg = base * 0.965, b = base * 0.94;
        img[y * w + x] = pack(clamp255(r), clamp255(gg), clamp255(b));
        H[y * w + x] = base + (mortar ? -30 : edge ? 12 : 0);
      }
    }
    /* fake relief */
    const out = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = heightShade(img, w, x, y, H, -0.65, 0.65, 0.5, 0.86, 6);
    return out;
  };

  /* ── 2. dark basalt ──────────────────────────────────────────────────── */
  GENS.basalt = function (w, rand) {
    const img = new Uint32Array(w * w), H = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const nn = N.fbm2(x * 0.12, y * 0.12, 6, 41) * 0.6 + N.ridged2(x * 0.3, y * 0.3, 4, 7) * 0.4;
        const ve = N.ridged2(x * 0.07 + 11, y * 0.07 - 5, 5, 23);
        let v = 30 + nn * 46;
        if (ve > 0.86) v += 46;
        img[y * w + x] = pack(clamp255(v * 1.02), clamp255(v * 0.99), clamp255(v * 1.08));
        H[y * w + x] = v;
      }
    }
    const out = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = heightShade(img, w, x, y, H, -0.8, 0.8, 0.55, 0.82, 4);
    return out;
  };

  /* ── 3. veined marble ────────────────────────────────────────────────── */
  GENS.marble = function (w, rand) {
    const img = new Uint32Array(w * w);
    const per = 3;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / w) * per, v = (y / w) * per;
        const warp = N.fbm2(u * 1.6 + 3, v * 1.6, 5, 91) * 2.4;
        const vein = N.ridged2(u * 1.3 + warp, v * 1.3 + warp * 0.5, 5, 5);
        const cloud = N.warpFbm(u * 0.7, v * 0.7, 5, 33, 0.8);
        let v2 = 205 + cloud * 34;
        const t = Math.max(0, vein - 0.62) * 2.4;
        v2 = v2 * (1 - t) + 40 * t;
        const gold = Math.max(0, vein - 0.93) * 5;
        img[y * w + x] = pack(clamp255(v2 + gold * 120), clamp255(v2 + gold * 84), clamp255(v2 - gold * 10));
      }
    }
    return img;
  };

  /* ── 4. oak planks ───────────────────────────────────────────────────── */
  GENS.wood = function (w, rand) {
    const img = new Uint32Array(w * w), H = new Float32Array(w * w);
    const planks = 4;
    const seeds = [];
    for (let i = 0; i < planks; i++) seeds.push(rand() * 500);
    for (let y = 0; y < w; y++) {
      const p = Math.floor((y / w) * planks);
      const py = (y / w) * planks - p;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const grain = N.ridged2(u * 9 + seeds[p], py * 26 + seeds[p] * 0.3, 4, 61 + p * 13);
        const knot = N.worley2(u * 2.2 + seeds[p], py * 5 + 1, 77 + p);
        let v = 118 + grain * 26 + knot.f1 * 12;
        if (py < 0.045 || py > 0.955) v *= 0.55;             // plank gaps
        if (knot.f1 < 0.075) v = 74 + knot.f1 * 300;          // knots
        img[y * w + x] = pack(clamp255(v * 1.06), clamp255(v * 0.82), clamp255(v * 0.58));
        H[y * w + x] = v * 0.4 + grain * 20;
      }
    }
    const out = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = heightShade(img, w, x, y, H, 0.1, 0.9, 0.45, 0.88, 8);
    return out;
  };

  /* ── 5. ceramic tile ─────────────────────────────────────────────────── */
  GENS.tile = function (w, rand) {
    const img = new Uint32Array(w * w);
    const n = 8, s = w / n;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const cx = Math.floor(x / s), cy = Math.floor(y / s);
        const u = (x - cx * s) / s, v = (y - cy * s) / s;
        const odd = (cx + cy) & 1;
        /* greek-key band around each tile */
        const band = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
        const key = odd
          ? 0
          : Math.max(0, 1 - Math.abs(Math.min(u, 1 - u) - 0.34) * 16) * (v > 0.2 && v < 0.34 ? 1 : 0);
        const grout = band < 0.045;
        const on = odd ? 236 : 150;
        const col = [on * 0.98, on * 0.95, on * 0.86];
        if (key) { col[0] = 196; col[1] = 150; col[2] = 60; }
        let f = 1;
        if (grout) f = 0.62;
        else f = 0.93 + (band > 0.05 && band < 0.09 ? -0.1 : 0) + N.value2(x, y, 3) * 0.07;
        img[y * w + x] = pack(clamp255(col[0] * f), clamp255(col[1] * f), clamp255(col[2] * f));
      }
    }
    return img;
  };

  /* ── 6. lime plaster ─────────────────────────────────────────────────── */
  GENS.plaster = function (w, rand) {
    const img = new Uint32Array(w * w), H = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const t = N.fbm2(x * 0.09, y * 0.09, 5, 3);
        const stain = N.warpFbm(x * 0.045 + 20, y * 0.045, 5, 8, 1.2);
        const crack = N.ridged2(x * 0.3, y * 0.3, 4, 12);
        let v = 176 + t * 26;
        v -= Math.max(0, stain - 0.55) * 40;
        if (crack > 0.93) v *= 0.62;
        img[y * w + x] = pack(clamp255(v * 1.02), clamp255(v * 0.985), clamp255(v * 0.94));
        H[y * w + x] = v;
      }
    }
    const out = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = heightShade(img, w, x, y, H, -0.5, 0.7, 0.3, 0.9, 10);
    return out;
  };

  /* ── 7. gilt / gold leaf ─────────────────────────────────────────────── */
  GENS.gilt = function (w, rand) {
    const img = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const t = N.fbm2(x * 0.5, y * 0.5, 5, 5);
        const fleck = N.value2(x * 2.3, y * 2.3, 9);
        let v = 150 + t * 60 + fleck * 18;
        const edge = Math.min(Math.min(x, w - 1 - x), Math.min(y, w - 1 - y));
        if (edge < 3) v *= 0.6;
        img[y * w + x] = pack(clamp255(v * 1.12), clamp255(v * 0.88), clamp255(v * 0.38));
      }
    }
    return img;
  };

  /* ── 8. tapestry ────────────────────────────────────────────────────── */
  GENS.tapestry = function (w, rand) {
    const img = new Uint32Array(w * w);
    const deep = [96, 22, 28], mid = [150, 44, 40], gold = [212, 168, 82];
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / w;
        const weave = (N.value2(x * 4, y * 4, 2) - 0.5) * 16;
        let c = deep;
        const border = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
        if (border < 0.06) c = mid;
        /* central emblem: concentric rings + rays */
        const dx = u - 0.5, dy = v - 0.5;
        const rr = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);
        const rays = Math.max(0, Math.sin(ang * 12)) * (1 - Math.min(1, rr * 2.4));
        if (rr < 0.3) c = mid;
        if (Math.abs(rr - 0.19) < 0.012) c = gold;
        if (Math.abs(rr - 0.28) < 0.008) c = gold;
        if (rr < 0.06) c = gold;
        if (rays > 0.55 && rr > 0.3 && rr < 0.46) c = gold;
        const f = 0.86 + weave / 255;
        img[y * w + x] = pack(clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f));
      }
    }
    return img;
  };

  /* ── 9. coffered ceiling ─────────────────────────────────────────────── */
  GENS.coffer = function (w, rand) {
    const img = new Uint32Array(w * w), H = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / w;
        const cell = Math.floor(u * 3), cell2 = Math.floor(v * 3);
        const su = (u * 3) % 1, sv = (v * 3) % 1;
        const band = Math.min(Math.min(su, 1 - su), Math.min(sv, 1 - sv));
        const v0 = 168 - band * 44;
        img[y * w + x] = pack(clamp255(v0 * 1.01), clamp255(v0 * 0.97), clamp255(v0 * 0.9));
        H[y * w + x] = band < 0.12 ? -20 : 10;
      }
    }
    const out = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = heightShade(img, w, x, y, H, -0.7, 0.7, 0.4, 0.9, 12);
    return out;
  };

  /* ── 10. the void ────────────────────────────────────────────────────── */
  GENS.void = function (w, rand) {
    const img = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / w;
        const neb = N.warpFbm(u * 2.2, v * 2.2, 6, 4, 1.4);
        const far = N.fbm2(u * 0.6, v * 0.6, 5, 15);
        const r = 10 + neb * 22 + far * 8;
        const gg = 10 + neb * 16 + far * 6;
        const b = 26 + neb * 52 + far * 12;
        img[y * w + x] = pack(clamp255(r), clamp255(gg), clamp255(b));
      }
    }
    return img;
  };

  /* ── 11. rune stone ──────────────────────────────────────────────────── */
  GENS.rune = function (w, rand) {
    const img = new Uint32Array(w * w), H = new Float32Array(w * w);
    const glyphs = [];
    for (let i = 0; i < 26; i++) glyphs.push(rand());
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / w;
        const grain = N.fbm2(x * 0.2, y * 0.2, 5, 3);
        let v0 = 60 + grain * 26;
        let glow = 0;
        /* carved marks: dark grooves with a bright core */
        const cell = Math.floor(u * 6) + Math.floor(v * 6) * 6;
        const cu = (u * 6) % 1 - 0.5, cv = (v * 6) % 1 - 0.5;
        const seed = glyphs[cell % 26] * 7;
        const a = Math.max(0, 1 - Math.abs(cu + Math.sin(seed * 3 + cv * 3) * 0.3) * 22);
        const b2 = Math.max(0, 1 - Math.abs(cv - Math.cos(seed * 5 + cu * 2) * 0.3) * 22);
        const carve = Math.max(a, b2) * (0.6 + 0.4 * Math.sin(seed * 11));
        if (carve > 0.5) { v0 *= 0.45; glow = (carve - 0.5) * 1.6; }
        const g = glow * 130;
        img[y * w + x] = pack(clamp255(v0 * 0.95 + g), clamp255(v0 * 1.0 + g * 0.9), clamp255(v0 * 1.05 + g * 0.8));
        H[y * w + x] = v0 - glow * 30;
      }
    }
    const out = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = heightShade(img, w, x, y, H, -0.6, 0.6, 0.5, 0.9, 6);
    return out;
  };

  /* ── 12. flame sprite (additive, with alpha in the packed value) ─────── */
  GENS.flame = function (w, rand, frame) {
    const img = new Uint32Array(w * w);
    const ph = frame * 1.7;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / w) * 2 - 1, v = (y / w) * 2 - 1;
        const sway = Math.sin(v * 4 + ph) * 0.16 * (v + 1) * 0.4;
        const d = Math.sqrt((u - sway) * (u - sway) * 0.5 + v * v * 0.16);
        const body = Math.max(0, 1 - d * 1.5);
        const flick = 0.72 + 0.28 * Math.sin(v * 9 + ph * 2.4);
        const a = body * flick;
        const hot = Math.max(0, 1 - d * 3.2);
        let r = 255 * a, gg = 150 * a * a + 105 * hot, b = 60 * a * a * a;
        img[y * w + x] = (clamp255(a * 255) << 24) | (clamp255(b) << 16) | (clamp255(gg) << 8) | clamp255(r);
      }
    }
    return img;
  };

  /* ── 13. soft glow (for dust, embers, the fragments) ────────────────── */
  GENS.glow = function (w, rand) {
    const img = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / w) * 2 - 1, v = (y / w) * 2 - 1;
        const d = Math.sqrt(u * u + v * v);
        const a = Math.max(0, 1 - d);
        const a2 = a * a * 1.35;
        img[y * w + x] = (clamp255(a * 255) << 24) | (clamp255(70 * a2) << 16) | (clamp255(150 * a2) << 8) | clamp255(255 * a2);
      }
    }
    return img;
  };

  /* ── 14. iron grating ────────────────────────────────────────────────── */
  GENS.iron = function (w, rand) {
    const img = new Uint32Array(w * w), H = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        let v = 54 + N.fbm2(x * 0.4, y * 0.4, 4, 3) * 22;
        const onBar = (x % 16 < 4) || (y % 16 < 4);
        if (onBar) v = 40 + N.value2(x * 1.5, y * 1.5, 5) * 26;
        else v *= 0.35;
        img[y * w + x] = pack(clamp255(v * 1.05), clamp255(v * 1.03), clamp255(v * 1.06));
        H[y * w + x] = onBar ? 40 : 4;
      }
    }
    const out = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) out[y * w + x] = heightShade(img, w, x, y, H, -0.7, 0.7, 0.6, 0.85, 6);
    return out;
  };

  /* ── 15. starfield for the sky ──────────────────────────────────────── */
  GENS.starfield = function (w, rand) {
    const img = new Uint32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / w;
        const band = N.fbm2(u * 2, v * 2, 5, 3);
        let r = 12 + band * 18, gg = 12 + band * 16, b = 30 + band * 40;
        const st = N.hash2(Math.floor(x * 3), Math.floor(y * 3), 91);
        if (st > 0.9975) {
          const br = (st - 0.9975) * 40000;
          r += br; gg += br; b += br;
        }
        img[y * w + x] = pack(clamp255(r), clamp255(gg), clamp255(b));
      }
    }
    return img;
  };

  /* ── build ───────────────────────────────────────────────────────────── */
  function build(spec) {
    spec = spec || {};
    const S = spec.size || 128;
    const rand = N.mulberry32(spec.seed === undefined ? 20261013 : spec.seed);
    const out = {};
    const simple = ['marble', 'gilt', 'tapestry', 'void', 'tile', 'plaster', 'starfield', 'iron'];
    simple.forEach((k) => { out[k] = { w: S, img: GENS[k](S, rand) }; });
    ['stone', 'basalt', 'wood', 'coffer', 'rune', 'plaster'].forEach((k) => {
      out[k] = { w: S, img: GENS[k](S, rand) };
    });
    for (let f = 0; f < 4; f++) out['flame' + f] = { w: 64, img: GENS.flame(64, rand, f) };
    out.glow = { w: 64, img: GENS.glow(64, rand) };
    out.dust = { w: 32, img: GENS.glow(32, rand) };
    return out;
  }

  IH.textures = { build: build, GENS: GENS, pack: pack };
})(typeof window !== 'undefined' ? window : globalThis);
