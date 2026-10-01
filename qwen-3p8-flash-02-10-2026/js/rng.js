// CANTUS MACHINA — deterministic randomness
// Every bar of the piece is a function of (seed, bar) alone. No hidden state.
// That is what makes the claim "the whole infinite piece already exists" true.

export function hash32(...nums) {
  // avalanche mix over a few uint32s → uint32
  let h = 0x9e3779b9 ^ (nums.length * 0x85ebca6b);
  for (const n of nums) {
    let k = (n | 0) >>> 0;
    k = Math.imul(k ^ (k >>> 16), 0x2545f491) >>> 0;
    k = Math.imul(k ^ (k >>> 13), 0x2545f491) >>> 0;
    k = (k ^ (k >>> 16)) >>> 0;
    h = (h ^ k) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7a5d2a1b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t ^= t + (Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function strHash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// A named, salted stream of deterministic random numbers.
export function stream(seed, ...context) {
  let h = typeof seed === 'number' ? seed >>> 0 : strHash32(String(seed));
  for (const c of context) {
    h = hash32(h, typeof c === 'number' ? (c | 0) : strHash32(String(c)));
  }
  return mulberry32(h);
}

// helpers that read from a stream function r() ∈ [0,1)
export const rnd = (r) => r();
export const rint = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
export const rrange = (r, lo, hi) => lo + r() * (hi - lo);
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export function pickW(r, arr, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  let x = r() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}
export const chance = (r, p) => r() < p;

export function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// humanized offsets: sum of two uniforms gives a soft triangular distribution
export function jitter(r, amount) {
  return (r() + r() - 1) * amount;
}
