/* brain.js — fast feedforward neural network. Forward pass + mutation. */

'use strict';

const B = {

  // Create a new brain with the given topology (array of layer sizes).
  // First layer = sensors. Last layer = effectors.
  create(topology) {
    return {
      topology: topology.slice(),
      layers: topology.map((n, i) => new Float32Array(n)),
      weights: [],   // weights[i] connects layer i to layer i+1
      biases:  [],   // biases[i] is layer i+1's bias
      acts:    [],   // activation functions per layer ('tanh' or 'sigmoid')
      fitness: 0,
      species: -1,
      id: -1,
    };
  },

  init(brain, rng) {
    const t = brain.topology;
    // Create / re-create the layers Float32Arrays
    brain.layers = t.map(n => new Float32Array(n));
    brain.weights = [];
    brain.biases = [];
    brain.acts = [];
    for (let i = 0; i < t.length - 1; i++) {
      const a = t[i], b = t[i + 1];
      const w = new Float32Array(a * b);
      // He/Xavier-like scale
      const s = Math.sqrt(2 / a);
      for (let k = 0; k < w.length; k++) {
        w[k] = (rng() * 2 - 1) * s;
      }
      brain.weights.push(w);
      const bias = new Float32Array(b);
      for (let k = 0; k < b; k++) bias[k] = (rng() * 2 - 1) * 0.1;
      brain.biases.push(bias);
      brain.acts.push('tanh');
    }
    brain.fitness = 0;
    return brain;
  },

  // Forward pass. Inputs is a Float32Array; result overwrites internal layers.
  forward(brain, inputs) {
    const t = brain.topology;
    const L = brain.layers;
    // Copy inputs into first layer
    L[0].set(inputs);
    for (let i = 0; i < brain.weights.length; i++) {
      const w = brain.weights[i];
      const b = brain.biases[i];
      const prev = L[i];
      const cur = L[i + 1];
      const prevN = prev.length;
      const curN = cur.length;
      cur.fill(0);
      for (let j = 0; j < curN; j++) {
        let sum = b[j];
        const off = j * prevN;
        for (let k = 0; k < prevN; k++) sum += w[off + k] * prev[k];
        cur[j] = Math.tanh(sum);
      }
    }
    return L[L.length - 1];
  },

  // Clone brain for reproduction
  clone(brain) {
    const nb = B.create(brain.topology);
    nb.weights = brain.weights.map(w => new Float32Array(w));
    nb.biases  = brain.biases.map(b => new Float32Array(b));
    nb.acts    = brain.acts.slice();
    nb.id = brain.id;
    nb.species = brain.species;
    return nb;
  },

  // Crossover: take average of two parents
  crossover(rng, a, b) {
    const nb = B.create(a.topology);
    nb.weights = [];
    nb.biases = [];
    nb.acts = a.acts.slice();
    for (let i = 0; i < a.weights.length; i++) {
      const wa = a.weights[i], wb = b.weights[i];
      const w = new Float32Array(wa.length);
      for (let k = 0; k < w.length; k++) {
        w[k] = (rng() < 0.5) ? wa[k] : wb[k];
        // Occasional average
        if (rng() < 0.05) w[k] = (wa[k] + wb[k]) * 0.5;
      }
      nb.weights.push(w);
      const ba = a.biases[i], bb = b.biases[i];
      const bias = new Float32Array(ba.length);
      for (let k = 0; k < bias.length; k++) {
        bias[k] = (rng() < 0.5) ? ba[k] : bb[k];
      }
      nb.biases.push(bias);
    }
    return nb;
  },

  // Mutate weights/biases in place
  mutate(brain, rng, rate = 0.05, scale = 0.4) {
    for (let i = 0; i < brain.weights.length; i++) {
      const w = brain.weights[i];
      for (let k = 0; k < w.length; k++) {
        if (rng() < rate) {
          // Gaussian perturbation
          const u = 1 - rng();
          const v = rng();
          const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
          w[k] += z * scale;
          // Clamp to avoid runaway
          if (w[k] >  3) w[k] =  3;
          if (w[k] < -3) w[k] = -3;
        }
      }
      const b = brain.biases[i];
      for (let k = 0; k < b.length; k++) {
        if (rng() < rate) {
          const u = 1 - rng();
          const v = rng();
          const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
          b[k] += z * scale * 0.5;
        }
      }
    }
  },

  // Distance between two brains (for speciation)
  distance(a, b) {
    if (a.topology.join() !== b.topology.join()) return Infinity;
    let d = 0, n = 0;
    for (let i = 0; i < a.weights.length; i++) {
      const wa = a.weights[i], wb = b.weights[i];
      for (let k = 0; k < wa.length; k++) {
        d += (wa[k] - wb[k]) * (wa[k] - wb[k]);
        n++;
      }
      const ba = a.biases[i], bb = b.biases[i];
      for (let k = 0; k < ba.length; k++) {
        d += (ba[k] - bb[k]) * (ba[k] - bb[k]);
        n++;
      }
    }
    return Math.sqrt(d / Math.max(1, n));
  },

  // Serialize to compact string (for save/load)
  serialize(brain) {
    const parts = [];
    parts.push(brain.topology.join(','));
    for (let i = 0; i < brain.weights.length; i++) {
      parts.push('W' + Array.from(brain.weights[i]).map(x => x.toFixed(3)).join(','));
      parts.push('B' + Array.from(brain.biases[i]).map(x => x.toFixed(3)).join(','));
    }
    return parts.join('|');
  },

  deserialize(s) {
    const parts = s.split('|');
    const top = parts[0].split(',').map(Number);
    const brain = B.create(top);
    for (let i = 1; i < parts.length; i += 2) {
      const w = new Float32Array(parts[i].slice(1).split(',').map(Number));
      const b = new Float32Array(parts[i + 1].slice(1).split(',').map(Number));
      brain.weights.push(w);
      brain.biases.push(b);
      brain.acts.push('tanh');
    }
    return brain;
  },

  // Counts the total number of weights (for fitness share / display)
  size(brain) {
    let n = 0;
    for (const w of brain.weights) n += w.length;
    return n;
  }
};

if (typeof module !== 'undefined') module.exports = B;