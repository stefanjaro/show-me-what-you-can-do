/*!
 * CONTINUUM CA-7 - engine.js
 * The solver at the heart of the machine.
 *
 * A patchable network of simulated operational-amplifier blocks.
 * Everything runs on voltages between the rails (-10 V .. +10 V).
 * Integrators break feedback loops the same way a capacitor does on a
 * real analog computer, so a patched circuit is just a system of
 * ordinary differential equations.
 *
 * No dependencies. Runs in the browser and in Node (for the test suite).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CA7 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RAIL = 10;
  var DT = 1 / 4000;
  var SAMPLE_EVERY = 10;
  var TRACE_LEN = 8192;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function sgn(x) { return x < 0 ? -1 : (x > 0 ? 1 : 0); }

  var RANGES = {
    gain:   { min: -30,  max: 30,   curve: 1.9,  def: 1 },
    ic:     { min: -10,  max: 10,   curve: 1.5,  def: 0 },
    amp:    { min: -10,  max: 10,   curve: 1.6,  def: 1 },
    pot:    { min: -1,   max: 1,    curve: 1.3,  def: 0.5 },
    cv:     { min: -10,  max: 10,   curve: 1.6,  def: 0 },
    freq:   { min: 0.05, max: 800,  log: true,   def: 2 },
    genamp: { min: 0,    max: 10,   curve: 1.3,  def: 5 },
    hyst:   { min: 0.02, max: 8,    curve: 1.6,  def: 1 },
    fng:    { min: -4,   max: 4,    curve: 1.5,  def: 1 },
    tdiv:   { min: 0.05, max: 4,    curve: 1.5,  def: 0.5 },
    vdiv:   { min: 0.1,  max: 4,    curve: 1.5,  def: 1 },
    pos:    { min: -6,   max: 6,    curve: 1.5,  def: 0 },
    level:  { min: 0,    max: 1,    curve: 1.4,  def: 0.5 },
    speed:  { min: 0.1,  max: 4,    curve: 1.5,  def: 1 }
  };

  function uToValue(u, r) {
    u = clamp(u, -1, 1);
    if (r.log) return r.min * Math.pow(r.max / r.min, (u + 1) / 2);
    var c = r.curve || 1;
    if (r.min === -r.max) return r.max * sgn(u) * Math.pow(Math.abs(u), c);
    var t = (u + 1) / 2;
    return r.min + (r.max - r.min) * Math.pow(t, c);
  }

  function valueToU(v, r) {
    if (r.log) {
      var ratio = clamp(v, r.min, r.max) / r.min;
      return 2 * (Math.log(ratio) / Math.log(r.max / r.min)) - 1;
    }
    var c = r.curve || 1;
    if (r.min === -r.max) {
      if (v === 0) return 0;
      return sgn(v) * Math.pow(Math.min(Math.abs(v), r.max) / r.max, 1 / c);
    }
    var t = clamp((v - r.min) / (r.max - r.min), 0, 1);
    return 2 * Math.pow(t, 1 / c) - 1;
  }

  function fmt(v, digits) {
    if (v === undefined || v === null || !isFinite(v)) return '-';
    var d = digits === undefined ? 2 : digits;
    var a = Math.abs(v);
    if (a !== 0 && (a < 0.001 || a >= 10000)) return v.toExponential(1);
    return v.toFixed(d);
  }

  var FN = {
    sin:  function (x) { return Math.sin(x); },
    cube: function (x) { return x * x * x / 100; },
    sq:   function (x) { return x * Math.abs(x) / 10; },
    abs:  function (x) { return Math.abs(x); },
    tanh: function (x) { return 10 * Math.tanh(x / 4); }
  };

  var WAVES = {
    sine: function (p) { return Math.sin(p); },
    tri:  function (p) {
      var t = p / Math.PI;
      t = t - 2 * Math.floor(t / 2);
      return t < 1 ? 1 - 2 * t : 2 * t - 3;
    },
    sqr:  function (p) { return Math.sin(p) >= 0 ? 1 : -1; },
    saw:  function (p) { var t = p / (2 * Math.PI); t = t - Math.floor(t); return 2 * t - 1; }
  };

  return {
    RAIL: RAIL,
    DT: DT,
    SAMPLE_EVERY: SAMPLE_EVERY,
    TRACE_LEN: TRACE_LEN,
    RANGES: RANGES,
    FN: FN,
    WAVES: WAVES,
    clamp: clamp,
    sgn: sgn,
    uToValue: uToValue,
    valueToU: valueToU,
    fmt: fmt
  };
});
