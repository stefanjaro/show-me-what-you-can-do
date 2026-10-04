/* genome.js — creature body plan encoded as a genome. */

'use strict';

const G = {

  // Number of genes in a body
  GENE_SIZE: 16,

  // Gene names and their ranges (0..1)
  geneDefs: [
    { name: 'size',       desc: 'Body size',          range: [0.3, 1.4] },
    { name: 'speed',      desc: 'Top speed',          range: [0.4, 1.6] },
    { name: 'vision',     desc: 'Eye range',          range: [0.2, 1.5] },
    { name: 'stomach',    desc: 'Stomach capacity',   range: [0.4, 1.6] },
    { name: 'metabolism', desc: 'Metabolic rate',     range: [0.5, 1.8] },
    { name: 'lifespan',   desc: 'Maximum lifespan',   range: [0.4, 2.0] },
    { name: 'maturity',   desc: 'Reproductive age',   range: [0.3, 1.5] },
    { name: 'fertility',  desc: 'Offspring rate',     range: [0.0, 1.0] },
    { name: 'hue',        desc: 'Hue',                range: [0.0, 1.0] },
    { name: 'sat',        desc: 'Saturation',         range: [0.2, 1.0] },
    { name: 'lit',        desc: 'Lightness',          range: [0.35, 0.7] },
    { name: 'limbs',      desc: 'Limbs',              range: [2, 8] },     // integer
    { name: 'mouthsize',  desc: 'Mouth radius',       range: [0.3, 1.5] },
    { name: 'carni',      desc: 'Carnivory preference', range: [0.0, 1.0] },
    { name: 'herbi',      desc: 'Herbivory preference', range: [0.0, 1.0] },
    { name: 'aggression', desc: 'Aggression',         range: [0.0, 1.0] },
  ],

  create() {
    const g = new Float32Array(G.GENE_SIZE);
    for (let i = 0; i < G.GENE_SIZE; i++) g[i] = Math.random();
    return g;
  },

  // Fill with random values from RNG (for seeded init)
  createSeeded(rng) {
    const g = new Float32Array(G.GENE_SIZE);
    for (let i = 0; i < G.GENE_SIZE; i++) g[i] = rng();
    return g;
  },

  clone(g) { return new Float32Array(g); },

  // Crossover: each gene from random parent, with small chance of mutation
  crossover(rng, a, b) {
    const g = new Float32Array(G.GENE_SIZE);
    for (let i = 0; i < G.GENE_SIZE; i++) {
      g[i] = (rng() < 0.5) ? a[i] : b[i];
    }
    return g;
  },

  // Mutation: perturb each gene by gaussian, with rate and scale.
  mutate(g, rng, rate = 0.1, scale = 0.15) {
    for (let i = 0; i < G.GENE_SIZE; i++) {
      if (rng() < rate) {
        const u = 1 - rng();
        const v = rng();
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        g[i] += z * scale;
        if (g[i] < 0) g[i] = 0;
        if (g[i] > 1) g[i] = 1;
      }
    }
    return g;
  },

  // Map a gene to its actual range value
  geneVal(idx, val) {
    const [lo, hi] = G.geneDefs[idx].range;
    return lo + (hi - lo) * val;
  },

  // Pack + iterate of the genes that are integer
  geneInt(idx, val) { return Math.round(G.geneVal(idx, val)); },

  // Hash genome to a 32-bit number (used as species ID seed)
  hash(g) {
    let h = 5381 >>> 0;
    for (let i = 0; i < g.length; i++) {
      // Quantize first so small mutations don't change species hash
      const q = Math.round(g[i] * 64);
      h = Math.imul(h ^ q, 2654435761);
    }
    return h >>> 0;
  },

  // Distance between genomes (for speciation threshold)
  distance(a, b) {
    let d = 0;
    for (let i = 0; i < G.GENE_SIZE; i++) {
      const diff = a[i] - b[i];
      d += diff * diff;
    }
    return Math.sqrt(d / G.GENE_SIZE);
  },

  // For species hash, we discretize
  discreteKey(g) {
    let s = '';
    for (let i = 0; i < G.GENE_SIZE; i++) s += Math.round(g[i] * 16).toString(16);
    return s;
  },

  // Serialize to base64-ish for export
  serialize(g) {
    return Array.from(g).map(x => x.toFixed(3)).join(',');
  },
  deserialize(s) {
    const p = s.split(',').map(Number);
    const g = new Float32Array(G.GENE_SIZE);
    for (let i = 0; i < G.GENE_SIZE; i++) g[i] = p[i] || 0;
    return g;
  },
};

if (typeof module !== 'undefined') module.exports = G;