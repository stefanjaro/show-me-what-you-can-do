/*!
 * CONTINUUM CA-7 - presets.js
 * Ready-patched circuits. Each one is a system of differential
 * equations, laid out on the panel the way an operator would wire it.
 *
 * Sign bookkeeping (every block inverts, twice in a row is identity):
 *   integrator  d(OUT)/dt = -(g1*1 + g2*2 + g3*3)
 *   so a term you want to ADD to the derivative must arrive with a
 *   NEGATIVE gain, and vice versa.
 */
(function (root) {
  'use strict';
  var CA7 = root.CA7;

  function M(id, t, x, y, k, mode) {
    var m = { id: id, t: t, x: x, y: y, k: k || {} };
    if (mode) m.mode = mode;
    return m;
  }

  function C(mods, wires, scope, extra) {
    var c = {
      modules: mods,
      wires: wires,
      scope: scope,
      audio: { key: '', mode: 'vco', level: 0.35 },
      meter: { key: '' },
      speed: 1,
      shadow: false
    };
    if (extra) for (var k in extra) c[k] = extra[k];
    return c;
  }

  function S(xy, ch, div) {
    return {
      xy: { x: xy[0] || '', y: xy[1] || '', gx: xy[2] || 1, gy: xy[3] || 1, ox: xy[4] || 0, oy: xy[5] || 0 },
      time: { ch: ch || ['', '', ''], div: div === undefined ? 0.5 : div }
    };
  }

  /* row coordinates on the 800 x 540 patch field */
  var R1 = 56, R2 = 330;
  var C1 = 24, C2 = 224, C3 = 424;

  var P = [];

  /* 1 ---------------------------------------------------- SPRING */
  P.push({
    id: 'spring',
    chip: 'SPRING',
    tag: 'start here',
    circuit: C([
      M('x', 'integ', C1, R1, { ga: -1, gb: 0, gc: 0, ic: 4.5 }),
      M('v', 'integ', C1, R2, { ga: 4, gb: 1, gc: 0, ic: 0 }),
      M('d', 'pot', C2 + 10, R2, { k: 0 })
    ], [
      ['v:o', 'x:a'],
      ['x:o', 'v:a'],
      ['v:o', 'd:a'],
      ['d:o', 'v:b']
    ], S(['x:o', 'v:o', 1, 3.5, 0, 0], ['x:o', 'v:o', ''], 0.5),
      { audio: { key: 'x:o', mode: 'vco', level: 0.35 }, meter: { key: 'v:o' } }),
    doc: {
      title: 'A mass on a spring',
      eqs: ['\u1e8d = \u2212kx', 'v = \u1e8b', 'k = 4, so T = 2\u03c0/\u221a4 = \u03c0 s'],
      about: 'The whole machine, in its simplest form: two integrators wired in a circle. One integrates acceleration into velocity, the other velocity into position, and the circle closes on itself. Nothing in this circuit stores a number \u2014 the answer exists only as a voltage that keeps moving.',
      try: 'Turn the COEFFICIENT knob up from 0. The circle collapses into a spiral: that is friction, added by nothing but a gain of 0.2.',
      watch: 'The XY display plots position against velocity. A closed loop means the energy comes back; a spiral means it leaks away.'
    }
  });

  /* 2 --------------------------------------------------- PENDULUM */
  P.push({
    id: 'pendulum',
    chip: 'PENDULUM',
    tag: 'nonlinear',
    circuit: C([
      M('th', 'integ', C1, R1, { ga: -1, gb: 0, gc: 0, ic: 3 }),
      M('om', 'integ', C1, R2, { ga: 4, gb: 0.06, gc: 0, ic: 0 }),
      M('fn', 'fn', C2 + 10, R2, { g: 1 }, 'sin')
    ], [
      ['om:o', 'th:a'],
      ['th:o', 'fn:a'],
      ['fn:o', 'om:a'],
      ['om:o', 'om:b']
    ], S(['th:o', 'om:o', 1, 1.5, 0, 0], ['th:o', 'om:o', ''], 1),
      { audio: { key: 'th:o', mode: 'vco', level: 0.35 }, meter: { key: 'om:o' } }),
    doc: {
      title: 'A pendulum that swings both ways',
      eqs: ['\u03b8\u0308 = \u2212(g/L)\u00b7sin\u03b8 \u2212 b\u03b8\u0307', 'g/L = 4, b = 0.06'],
      about: 'sin\u03b8 is not a number you can get from resistors. It takes a whole extra block \u2014 the FUNCTION shaper \u2014 to bend a straight voltage into a sine wave, and that one bend is the difference between a spring (which always returns) and a pendulum (which can go over the top).',
      try: 'Set the initial angle to 6 radians (about 344\u00b0) on the integrator\u2019s IC knob, press IC RESET, and watch it start by falling the "wrong" way.',
      watch: 'Start in the middle of the loop and the bob swings side to side. Start outside the loop and the trace runs the other way entirely \u2014 that outer boundary is the separatrix, the exact energy where the pendulum balances on top.'
    }
  });

  /* 3 ------------------------------------------------ VAN DER POL */
  P.push({
    id: 'vanderpol',
    chip: 'VAN DER POL',
    tag: 'limit cycle',
    circuit: C([
      M('x', 'integ', C1, R1, { ga: -1, gb: 0, gc: 0, ic: 1.5 }),
      M('v', 'integ', C1, R2, { ga: 1, gb: -0.8, gc: 8.888888888888889, ic: 0 }),
      M('m1', 'mult', C2, R1, { g: 1 }),
      M('m2', 'mult', C2, R2, { g: 1 })
    ], [
      ['v:o', 'x:a'],
      ['x:o', 'v:a'],
      ['v:o', 'v:b'],
      ['x:o', 'm1:a'],
      ['x:o', 'm1:b'],
      ['m1:o', 'm2:a'],
      ['v:o', 'm2:b'],
      ['m2:o', 'v:c']
    ], S(['x:o', 'v:o', 1.5, 2.7, 0, 0], ['x:o', 'v:o', 'm2:o'], 1),
      { audio: { key: 'x:o', mode: 'vco', level: 0.35 }, meter: { key: 'x:o' } }),
    doc: {
      title: 'An oscillator that sets its own amplitude',
      eqs: ['\u1e8d = \u00b5\u00b7(1 \u2212 (x/3)\u00b2)\u00b7v \u2212 x', '\u00b5 = 0.8'],
      about: 'A spring rings forever; this one cannot. Below a certain amplitude the nonlinearity feeds energy in, above it energy is drained away, so the system settles onto a single loop it chose for itself. Every radio before the 1930s, and every heart cell in your body, works on this principle.',
      try: 'Change the IC to 0.1 and press IC RESET. It grows back to exactly the same loop. The limit cycle is an attractor \u2014 the amplitude is a property of the equation, not of the starting point.',
      watch: 'The inner multiplier\u2019s readout: when |x| is small it contributes almost nothing, near 6 V it dominates. That voltage-dependent damping is the whole trick.'
    }
  });

  /* 4 --------------------------------------------- PREDATOR / PREY */
  P.push({
    id: 'predator',
    chip: 'PREDATOR & PREY',
    tag: 'ecology',
    circuit: C([
      M('x', 'integ', C1, R1, { ga: -4, gb: 20, gc: 0, ic: 1 }),
      M('y', 'integ', C1, R2, { ga: -20, gb: 4, gc: 0, ic: 3 }),
      M('m', 'mult', C2 + 20, 178, { g: 1 })
    ], [
      ['x:o', 'x:a'],
      ['m:o', 'x:b'],
      ['m:o', 'y:a'],
      ['y:o', 'y:b'],
      ['x:o', 'm:a'],
      ['y:o', 'm:b']
    ], S(['x:o', 'y:o', 1, 1, -2.4, -2.4], ['x:o', 'y:o', ''], 0.5),
      { audio: { key: 'x:o', mode: 'vco', level: 0.35 }, meter: { key: 'y:o' } }),
    doc: {
      title: 'Lotka\u2013Volterra, the first mathematical ecology',
      eqs: ['\u1e8b = x(4 \u2212 y)', 'y\u0307 = y(x \u2212 4)', 'plotted at half voltage: X = x/2, Y = y/2'],
      about: 'Vito Volterra, watching fish stocks after the First World War, derived this from the same instincts. The only nonlinear term in the whole circuit is one multiplier \u2014 predation happens where the two populations meet, so it is literally the product of the two voltages.',
      try: 'Leave it running for a minute. The two curves chase each other and never settle down, and never grow without bound either.',
      watch: 'The loop closes. There is a hidden quantity this system refuses to change (x \u2212 4 ln x + y \u2212 4 ln y); if you could plot it, it would sit perfectly still while everything else turns.'
    }
  });

  /* 5 --------------------------------------------------- FISHERY */
  P.push({
    id: 'fishery',
    chip: 'THE FISHERY',
    tag: 'bifurcation',
    circuit: C([
      M('m', 'mult', C1, R1, { g: 1 }),
      M('net', 'summer', C2, R1, { ga: -1, gb: 1, gc: 1, gd: 0 }),
      M('x', 'integ', C1, R2, { ga: 0, gb: 0, gc: -1, ic: 9 }),
      M('e', 'pot', C2 + 10, R2, { k: 0.5 })
    ], [
      ['x:o', 'm:a'],
      ['x:o', 'm:b'],
      ['x:o', 'net:a'],
      ['m:o', 'net:b'],
      ['e:o', 'net:c'],
      ['x:o', 'e:a'],
      ['net:o', 'x:c']
    ], S(['x:o', 'net:o', 1, 1.4, -4.5, 0], ['x:o', 'e:o', 'net:o'], 1),
      { audio: { key: 'x:o', mode: 'vco', level: 0.4 }, meter: { key: 'x:o' } }),
    doc: {
      title: 'A stock, and the boats that harvest it',
      eqs: ['\u1e8b = r\u00b7x\u00b7(1 \u2212 x/K) \u2212 e\u00b7x', 'r = 1, K = 10', 'x* = K(1 \u2212 e), so e \u2265 1 empties it'],
      about: 'The Schaefer surplus-production model, the one fisheries agencies actually use: logistic growth minus a catch proportional to how much is left. Because both terms scale with x, the whole thing collapses onto one line and one summer \u2014 no division, no lookup tables, no computer.',
      try: 'The pot is fishing effort, sitting at 0.5 \u2014 maximum sustainable yield, where the stock stabilises at half of carrying capacity. Wind it up. Past 1.0 there is no equilibrium left, only a slow disappearance.',
      watch: 'The XY display plots net growth against stock: wherever that curve sits above zero the fishery recovers, below zero it bleeds. The equilibrium is simply where it crosses the axis \u2014 and effort only slides the crossing toward zero, never past it until the curve flips entirely.'
    }
  });

  /* 6 ---------------------------------------------------- EPIDEMIC */
  P.push({
    id: 'sir',
    chip: 'EPIDEMIC',
    tag: 'real world',
    circuit: C([
      M('s', 'integ', C1, R1, { ga: 0.1, gb: 0, gc: 0, ic: 10 }),
      M('i', 'integ', C1, R2, { ga: -0.3, gb: 0.12, gc: 0, ic: 0.3 }),
      M('m', 'mult', C2, R1, { g: 1 }),
      M('r', 'summer', C2, R2, { ga: 1, gb: 0.3333333333333333, gc: -1, gd: 0 }),
      M('c', 'const', C3, R2, { v: 10 })
    ], [
      ['m:o', 's:a'],
      ['m:o', 'i:a'],
      ['i:o', 'i:b'],
      ['s:o', 'm:a'],
      ['i:o', 'm:b'],
      ['s:o', 'r:a'],
      ['i:o', 'r:b'],
      ['c:o', 'r:c']
    ], S(['s:o', 'i:o', 2, 2, -2.5, -1.8], ['s:o', 'i:o', 'r:o'], 2),
      { audio: { key: 'i:o', mode: 'vco', level: 0.4 }, meter: { key: 'i:o' }, speed: 2 }),
    doc: {
      title: 'The Kermack\u2013McKendrick model, 1927',
      eqs: ['S\u0307 = \u2212\u03b2\u00b7S\u00b7I', 'I\u0307 = \u03b2\u00b7S\u00b7I \u2212 \u03b3\u00b7I', 'R\u0307 = \u03b3\u00b7I', 'R\u2080 = \u03b2/\u03b3 = 2.5'],
      about: 'S, I and R are susceptible, infected and recovered, scaled to volts (10 V = the whole population, 30 V = 1% infected). The single multiplier in the middle is the infection term: it takes both populations to be nonzero before anything spreads, exactly as a real contact does.',
      try: 'Watch the middle trace. It creeps, then detonates, then dies \u2014 and once it is gone the susceptible curve never comes back down to zero from above. There is no second wave without new susceptibles.',
      watch: 'The susceptible curve flattens exactly when it crosses \u03b3/\u03b2 = 4 V. That is herd immunity arriving as a voltage, and it happens with nobody deciding anything.'
    }
  });

  /* 7 ---------------------------------------------------- LORENZ */
  P.push({
    id: 'lorenz',
    chip: 'LORENZ',
    tag: 'chaos',
    circuit: C([
      M('x', 'integ', C1, R1, { ga: 10, gb: -10, gc: 0, ic: 1 }),
      M('y', 'integ', C1, R2, { ga: -28, gb: 27.272727272727273, gc: 1, ic: 1 }),
      M('mz', 'mult', C2, R1, { g: 2.2 }),
      M('mxy', 'mult', C2, R2, { g: 2.2 }),
      M('z', 'integ', C3, 178, { ga: -12.121212121212121, gb: 2.6666666666666665, gc: 0, ic: 1 })
    ], [
      ['x:o', 'x:a'],
      ['y:o', 'x:b'],
      ['x:o', 'y:a'],
      ['mz:o', 'y:b'],
      ['y:o', 'y:c'],
      ['mxy:o', 'z:a'],
      ['z:o', 'z:b'],
      ['x:o', 'mz:a'],
      ['z:o', 'mz:b'],
      ['x:o', 'mxy:a'],
      ['y:o', 'mxy:b']
    ], S(['x:o', 'y:o', 1.5, 2.8, -0.33, -0.22], ['x:o', 'y:o', 'z:o'], 1),
      { audio: { key: 'y:o', mode: 'vco', level: 0.35 }, meter: { key: 'z:o' }, shadow: true, shadowEps: 4e-4 }),
    doc: {
      title: 'Edward Lorenz, 1963',
      eqs: ['\u1e8b = \u03c3(y \u2212 x)', 'y\u0307 = x(\u03c1 \u2212 z) \u2212 y', '\u017c = xy \u2212 \u03b2z', '\u03c3 = 10, \u03c1 = 28, \u03b2 = 8/3'],
      about: 'Lorenz was running a weather model on a vacuum-tube computer and re-entering a number rounded from 0.506127 to 0.506. The trajectory came back completely different. This circuit \u2014 three integrators, two multipliers \u2014 is the smallest machine that can betray you that way.',
      try: 'The faint second trace is the same equations started 0.0004 V away from the first. For ten seconds you cannot tell them apart. Then you can, and you never can again.',
      watch: 'Nothing grows, nothing blows up, nothing repeats \u2014 and yet the butterfly never leaves the screen. Bounded forever, predictable for about ten seconds.'
    }
  });

  /* 8 -------------------------------------------------- ROSSLER */
  P.push({
    id: 'rossler',
    chip: 'R\u00d6SSLER',
    tag: 'chaos',
    circuit: C([
      M('x', 'integ', C1, R1, { ga: 1, gb: 2, gc: 0, ic: 1 }),
      M('y', 'integ', C1, R2, { ga: -1, gb: -0.2, gc: 0, ic: 1 }),
      M('mz', 'mult', C2, R1, { g: 1 }),
      M('z', 'integ', C2, R2, { ga: -1, gb: -20, gc: 5.7, ic: 0.5 }),
      M('c', 'const', C3, R2, { v: 0.05 })
    ], [
      ['y:o', 'x:a'],
      ['z:o', 'x:b'],
      ['x:o', 'y:a'],
      ['y:o', 'y:b'],
      ['c:o', 'z:a'],
      ['mz:o', 'z:b'],
      ['z:o', 'z:c'],
      ['x:o', 'mz:a'],
      ['z:o', 'mz:b']
    ], S(['x:o', 'y:o', 2, 3.5, 0, 0], ['x:o', 'y:o', 'z:o'], 1),
      { audio: { key: 'x:o', mode: 'vco', level: 0.35 }, meter: { key: 'z:o' }, shadow: true, shadowEps: 1e-3 }),
    doc: {
      title: 'Otto R\u00f6ssler, 1976',
      eqs: ['\u1e8b = \u2212y \u2212 z', 'y\u0307 = x + ay', '\u017c = b + z(x \u2212 c)', 'a = 0.2, b = 0.2, c = 5.7'],
      about: 'Lorenz needed three nonlinear terms; R\u00f6ssler went looking for the gentlest possible chaos and found it with one multiplier and a straight line. Most of the motion here is ordinary \u2014 the system loops calmly and then, once in a while, the z term flicks it around the band.',
      try: 'Leave the shadow trace on. It separates far more slowly than Lorenz does: this is a quieter kind of chaos, with a smaller Lyapunov exponent and a longer fuse.',
      watch: 'The XY trace is almost a circle with a fold in it. That fold is the entire mechanism \u2014 stretch, then fold, which is what all chaos is.'
    }
  });

  /* 9 ------------------------------------------- DRIVEN PENDULUM */
  P.push({
    id: 'driven',
    chip: 'DRIVEN PENDULUM',
    tag: 'chaos',
    circuit: (function () {
      var th = M('th', 'integ', C1, R1, { ga: -1, gb: 0, gc: 0, ic: 0.1 });
      th.mod = true;
      return C([
        th,
        M('om', 'integ', C1, R2, { ga: 1, gb: 0.2, gc: -1, ic: 0 }),
        M('fn', 'fn', C2, R1, { g: 1 }, 'sin'),
        M('gen', 'gen', C2, R2, { f: 0.0954929658551372, a: 2 })
      ], [
        ['om:o', 'th:a'],
        ['th:o', 'fn:a'],
        ['fn:o', 'om:a'],
        ['om:o', 'om:b'],
        ['gen:o', 'om:c']
      ], S(['fn:o', 'om:o', 0.4, 1.7, 0, 0], ['th:o', 'om:o', 'gen:o'], 1),
        { audio: { key: 'om:o', mode: 'vco', level: 0.35 }, meter: { key: 'om:o' }, shadow: true, shadowEps: 1e-3 });
    })(),
    doc: {
      title: 'One push, over and over',
      eqs: ['\u03b8\u0308 = \u2212sin\u03b8 \u2212 b\u03b8\u0307 + F\u00b7sin(2\u03c0ft)', 'b = 0.2, F = 2.0, f = 0.0955 Hz'],
      about: 'Everything you need for chaos, sitting on one line: gravity, a little friction, and a regular shove. Nothing in the circuit is nonlinear except gravity itself \u2014 one FUNCTION block set to SIN \u2014 and yet the pendulum cannot decide whether to swing or to whirl.',
      try: 'Wind the generator\u2019s AMP down below about 0.6: the wandering stops and the pendulum locks into one steady rhythm, repeatable to the millivolt. Above it, whirling takes over unpredictably.',
      watch: 'The middle trace is \u03b8, folded back into \u03b1\u03c0 every time it completes a turn (the integrator has its MOD switch on). Sawteeth mean the pendulum went over the top.'
    }
  });

  /* 10 ---------------------------------------------- WAVEFORMS */
  P.push({
    id: 'relaxation',
    chip: 'WAVEFORMS',
    tag: 'signal source',
    circuit: C([
      M('tri', 'integ', C1 + 40, R1 + 30, { ga: 2.4, gb: 0, gc: 0, ic: 0 }),
      M('cmp', 'comp', C2 + 30, R1 + 90, { h: 6 })
    ], [
      ['cmp:o', 'tri:a'],
      ['tri:o', 'cmp:a']
    ], S(['tri:o', 'cmp:o', 1.5, 4, 0, 0], ['tri:o', 'cmp:o', ''], 0.2),
      { audio: { key: 'tri:o', mode: 'vco', level: 0.45 }, meter: { key: 'tri:o' } }),
    doc: {
      title: 'A triangle and a square, from nothing',
      eqs: ['V\u0307 = \u2212g\u00b7Q', 'Q = +10 when V > +h, \u221210 when V < \u2212h', 'f = 10g / 4h'],
      about: 'The oldest trick in electronics: an integrator that ramps until a threshold fires and reverses it. Two blocks make two waveforms, and their frequency is nothing but a gain \u2014 turn a resistor and you tune the oscillator.',
      try: 'Drag the integrator\u2019s gain of 2.4 up and down. Frequency follows it exactly: f = 10g/4h, a formula you can verify off the screen.',
      watch: 'On the XY display the two signals draw a rectangle. That loop \u2014 the output only changes after the input crosses a threshold in the other direction \u2014 is hysteresis, and it is why thermostats do not chatter.'
    }
  });

  /* 11 ------------------------------------------------ BLANK PANEL */
  P.push({
    id: 'blank',
    chip: 'BLANK PANEL',
    tag: 'build your own',
    circuit: C([], [], S(['', '', 1, 1, 0, 0], ['', '', ''], 0.5)),
    doc: {
      title: 'An empty panel',
      eqs: [],
      about: 'No circuit is patched. Click a block in the strip below to drop one onto the field, drag it where you want it, and join its jacks with cord. Anything you build can be shared as a link.',
      try: 'The classic first build: two integrators in a circle. OUT of one into input 1 of the other, and back again \u2014 with a negative gain on one of the two, or the machine will run away to the rails.',
      watch: 'Every readout on the panel is live. Hover a jack to see its voltage in the status bar.'
    }
  });

  CA7.PRESETS = P;
  CA7.PRESET_BY_ID = {};
  for (var i = 0; i < P.length; i++) CA7.PRESET_BY_ID[P[i].id] = P[i];
})(typeof globalThis !== 'undefined' ? globalThis : this);

