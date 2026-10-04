/* ALETHEIA — tool utilities.
   Shared by every module. Works as a classic <script> in the browser and as a
   require()'d module under node: both attach to globalThis in the end. */

(function (root) {
  'use strict';
  var AE = root.AE || (root.AE = {});

  /* ── tiny test registry ─────────────────────────────────────────────── */
  var tests = [];
  function test(group, name, fn) {
    tests.push({ group: group, name: name, fn: fn });
  }
  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }
  function eq(a, b, msg) {
    if (a !== b) {
      throw new Error((msg || 'mismatch') + ': got ' + fmt(a) + ', want ' + fmt(b));
    }
  }
  function eqRationalish(a, b, msg) {
    var ok = (typeof a === 'number' && typeof b === 'number')
      ? Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
      : String(a) === String(b);
    if (!ok) throw new Error((msg || 'mismatch') + ': got ' + fmt(a) + ', want ' + fmt(b));
  }
  function fmt(v) {
    if (v == null) return String(v);
    if (typeof v === 'object' && typeof v.toString === 'function') {
      var s = v.toString();
      if (s !== '[object Object]') return s;
    }
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function runTests(filter) {
    var out = [], pass = 0, fail = 0, t0 = now();
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      if (filter && !(t.group + '.' + t.name).match(filter)) continue;
      var start = now();
      try {
        t.fn(asrt);
        var ms = now() - start;
        pass++;
        out.push({ group: t.group, name: t.name, ok: true, ms: ms });
      } catch (e) {
        var msz = now() - start;
        fail++;
        out.push({ group: t.group, name: t.name, ok: false, ms: msz, error: String(e && e.message || e) });
      }
    }
    return { total: pass + fail, pass: pass, fail: fail, ms: now() - t0, results: out };
  }

  /* a richer assert object handed to tests */
  var asrt = {
    ok: assert,
    eq: eq,
    near: function (a, b, tol, msg) {
      tol = tol == null ? 1e-9 : tol;
      if (!(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)))) {
        throw new Error((msg || 'not near') + ': ' + a + ' vs ' + b);
      }
    },
    throws: function (fn, msg) {
      var threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (!threw) throw new Error(msg || 'expected a throw');
    }
  };

  /* ── timing ─────────────────────────────────────────────────────────── */
  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    if (typeof process !== 'undefined' && process.hrtime) {
      var s = process.hrtime(); return s[0] * 1000 + s[1] / 1e6;
    }
    return Date.now();
  }

  /* ── deterministic PRNG (mulberry32) — reproducible exhibits ────────── */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* xmur3 string→seed hash */
  function hashSeed(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h ^ (h >>> 16)) >>> 0;
  }

  /* ── misc helpers ───────────────────────────────────────────────────── */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function timed(fn) { var t = now(); var v = fn(); return { value: v, ms: now() - t }; }
  function memoize(fn, keyFn) {
    var m = new Map();
    return function () {
      var k = keyFn ? keyFn.apply(null, arguments) : arguments[0];
      if (m.has(k)) return m.get(k);
      var v = fn.apply(null, arguments);
      if (m.size > 20000) m.clear();
      m.set(k, v);
      return v;
    };
  }
  /* build a Map key that distinguishes string keys cleanly */
  function keyize(k) { return typeof k === 'string' ? 's' + k : 'o' + k; }

  AE.util = {
    test: test, runTests: runTests, assert: asrt, now: now,
    rng: rng, hashSeed: hashSeed, clamp: clamp, lerp: lerp,
    smoothstep: smoothstep, timed: timed, memoize: memoize, keyize: keyize,
    fmt: fmt, _tests: tests
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
