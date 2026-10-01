/*!
 * CONTINUUM CA-7 - modules.js
 * The blocks silkscreened on the front panel.
 *
 * Every type declares its jacks, its knobs and its transfer function.
 * `eval(m, get)` returns the output voltage; integrators instead expose
 * `deriv(m, get)` because their output is state held in a capacitor.
 */
(function (root) {
  'use strict';
  var CA7 = root.CA7;
  if (!CA7) throw new Error('core.js must load first');

  function gainSum(m, get, ids) {
    var s = 0;
    for (var i = 0; i < ids.length; i++) s += m.k['g' + ids[i]] * get(ids[i]);
    return s;
  }

  var TYPES = {

    /* inverting summing amplifier ------------------------------------ */
    summer: {
      label: 'SUM', sub: '\u03a3 INVERTING',
      w: 176, h: 158,
      inputs: ['a', 'b', 'c', 'd'],
      outputs: ['o'],
      knobs: [
        { id: 'ga', j: 'a', range: 'gain', label: '1' },
        { id: 'gb', j: 'b', range: 'gain', label: '2' },
        { id: 'gc', j: 'c', range: 'gain', label: '3' },
        { id: 'gd', j: 'd', range: 'gain', label: '4' }
      ],
      eval: function (m, get) {
        return -gainSum(m, get, ['a', 'b', 'c', 'd']);
      },
      formula: 'OUT = \u2212(g\u2081\u00b71 + g\u2082\u00b72 + g\u2083\u00b73 + g\u2084\u00b74)',
      note: 'Adds its inputs and flips the sign, weighted by the four gain knobs.'
    },

    /* summing integrator -------------------------------------------- */
    integ: {
      label: 'INTEGRATOR', sub: '\u222bdt \u00b7 IC',
      w: 176, h: 186,
      inputs: ['a', 'b', 'c'],
      outputs: ['o'],
      state: true,
      knobs: [
        { id: 'ga', j: 'a', range: 'gain', label: '1' },
        { id: 'gb', j: 'b', range: 'gain', label: '2' },
        { id: 'gc', j: 'c', range: 'gain', label: '3' }
      ],
      extra: [{ id: 'ic', range: 'ic', label: 'IC', big: true }],
      eval: function (m) { return m.state; },
      deriv: function (m, get) { return -gainSum(m, get, ['a', 'b', 'c']); },
      formula: 'OUT = IC \u2212 \u222b(g\u2081\u00b71 + g\u2082\u00b72 + g\u2083\u00b73) dt',
      note: 'The capacitor. Every loop in a circuit must pass through one of these.'
    },

    /* four-quadrant multiplier --------------------------------------- */
    mult: {
      label: 'MULTIPLIER', sub: 'A \u00d7 B \u00b7 10',
      w: 148, h: 152,
      inputs: ['a', 'b'],
      outputs: ['o'],
      labels: { a: 'A', b: 'B' },
      extra: [{ id: 'g', range: 'amp', label: 'GAIN', big: true }],
      eval: function (m, get) {
        return m.k.g * (get('a') * get('b')) / 10;
      },
      formula: 'OUT = g\u00b7(A\u00b7B) / 10',
      note: 'The nonlinear heart of every chaotic circuit.'
    },

    /* nonlinear function shaper -------------------------------------- */
    fn: {
      label: 'FUNCTION', sub: 'f(x) SHAPER',
      w: 148, h: 168,
      inputs: ['a'],
      outputs: ['o'],
      labels: { a: 'IN' },
      modes: ['sin', 'cube', 'sq', 'abs', 'tanh'],
      modeLabels: { sin: 'SIN', cube: 'x\u00b3', sq: 'x|x|', abs: '|x|', tanh: 'TANH' },
      extra: [{ id: 'g', range: 'fng', label: 'GAIN' }],
      eval: function (m, get) {
        var f = CA7.FN[m.mode] || CA7.FN.sin;
        return m.k.g * f(get('a'));
      },
      formula: 'OUT = g \u00b7 f(IN)',
      note: 'Bends a straight line. SIN turns a pendulum into a pendulum.'
    },

    /* schmitt comparator --------------------------------------------- */
    comp: {
      label: 'COMPARATOR', sub: 'SCHMITT TRIGGER',
      w: 148, h: 152,
      inputs: ['a', 'b'],
      outputs: ['o'],
      labels: { a: '+', b: '\u2212' },
      extra: [{ id: 'h', range: 'hyst', label: 'HYST' }],
      eval: function (m, get) {
        var d = get('a') - get('b');
        if (d >= m.k.h) m.latch = 10;
        else if (d <= -m.k.h) m.latch = -10;
        return m.latch === undefined ? 10 : m.latch;
      },
      formula: 'OUT = +10 while A > B+h, \u221210 while A < B\u2212h',
      note: 'Snaps between the rails. Square waves, thresholds, bang-bang control.'
    },

    /* signal generator ------------------------------------------------ */
    gen: {
      label: 'GENERATOR', sub: 'OSCILLATOR',
      w: 176, h: 176,
      inputs: [],
      outputs: ['o'],
      modes: ['sine', 'tri', 'sqr', 'saw'],
      modeLabels: { sine: 'SIN', tri: 'TRI', sqr: 'SQR', saw: 'SAW' },
      extra: [
        { id: 'f', range: 'freq', label: 'FREQ', big: true, unit: 'Hz' },
        { id: 'a', range: 'genamp', label: 'AMP' }
      ],
      tick: function (m, dt) {
        m.phase += 2 * Math.PI * m.k.f * dt;
        if (m.phase > 1e6) m.phase -= 1e6;
      },
      eval: function (m) {
        var w = CA7.WAVES[m.mode] || CA7.WAVES.sine;
        return m.k.a * w(m.phase);
      },
      formula: 'OUT = A \u00b7 wave(2\u03c0ft)',
      note: 'The only block allowed to make its own voltage.'
    },

    /* coefficient potentiometer -------------------------------------- */
    pot: {
      label: 'POT', sub: 'COEFFICIENT',
      w: 124, h: 152,
      inputs: ['a'],
      outputs: ['o'],
      labels: { a: 'IN' },
      extra: [{ id: 'k', range: 'pot', label: 'k', big: true }],
      eval: function (m, get) { return m.k.k * get('a'); },
      formula: 'OUT = k \u00b7 IN',
      note: 'A ten-turn helical pot. Sets a constant from 0 to 1.'
    },

    /* reference source ------------------------------------------------ */
    const: {
      label: 'CONSTANT', sub: 'DC SOURCE',
      w: 124, h: 152,
      inputs: [],
      outputs: ['o'],
      extra: [{ id: 'v', range: 'cv', label: 'VOLTS', big: true, unit: 'V' }],
      eval: function (m) { return m.k.v; },
      formula: 'OUT = V',
      note: 'A fixed voltage: the term in your equation that never changes.'
    },

    /* ground and rails ------------------------------------------------ */
    ref: {
      label: 'REFERENCE', sub: 'RAILS',
      w: 136, h: 146,
      inputs: [],
      outputs: ['g', 'p', 'n'],
      outLabels: { g: 'GND 0V', p: '+10V', n: '\u221210V' },
      eval: function () { return { g: 0, p: 10, n: -10 }; },
      formula: 'OUT = 0 V, +10 V, \u221210 V',
      note: 'The supply rails, broken out as jacks.'
    },

    /* ---- instrument units: they live in the right-hand rack ---- */

    xy: {
      label: 'XY DISPLAY', sub: 'PHOSPHOR',
      rack: 'xy',
      inputs: ['x', 'y'],
      outputs: [],
      labels: { x: 'X', y: 'Y' },
      extra: [
        { id: 'gx', range: 'vdiv', label: 'X V/DIV' },
        { id: 'gy', range: 'vdiv', label: 'Y V/DIV' },
        { id: 'ox', range: 'pos', label: 'X POS' },
        { id: 'oy', range: 'pos', label: 'Y POS' }
      ],
      eval: function () { return null; },
      formula: 'plots two voltages against each other',
      note: 'The phase plane. Closed loops are orbits; spirals are transients.'
    },

    time: {
      label: 'TIME BASE', sub: 'MULTI-TRACE',
      rack: 'time',
      inputs: ['a', 'b', 'c'],
      outputs: [],
      labels: { a: 'CH1', b: 'CH2', c: 'CH3' },
      extra: [{ id: 'div', range: 'tdiv', label: 'TIME/DIV', big: true, unit: 's' }],
      eval: function () { return null; },
      formula: 'plots voltage against time',
      note: 'Three beams, ten divisions, phosphor that keeps a little of the past.'
    },

    meter: {
      label: 'METER', sub: '\u00b110 VDC',
      rack: 'meter',
      inputs: ['a'],
      outputs: [],
      labels: { a: 'IN' },
      eval: function () { return null; },
      formula: 'reads one voltage',
      note: 'A moving-coil voltmeter: the physics of being a needle.'
    },

    audio: {
      label: 'AUDIO', sub: 'MONITOR',
      rack: 'audio',
      inputs: ['a'],
      outputs: [],
      labels: { a: 'IN' },
      modes: ['vco', 'direct'],
      modeLabels: { vco: 'VCO', direct: 'SIGNAL' },
      extra: [{ id: 'level', range: 'level', label: 'LEVEL', big: true }],
      eval: function () { return null; },
      formula: 'VCO: pitch = 110 Hz \u00b7 2^(2.5V/10)',
      note: 'Hear the mathematics. VCO turns any voltage into a pitch.'
    }
  };

  CA7.TYPES = TYPES;
  CA7.TYPE_ORDER = ['integ', 'summer', 'mult', 'fn', 'gen', 'comp', 'pot', 'const', 'ref'];
  CA7.UNIT_ORDER = ['xy', 'time', 'meter', 'audio'];
})(typeof globalThis !== 'undefined' ? globalThis : this);
