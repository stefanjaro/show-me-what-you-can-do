/* evolution.js — speciation, phylogeny, chronicle, and selection. */

'use strict';

const E = {
  // Living species: Map<speciesId, SpeciesRecord>
  species: new Map(),
  // All species ever (extinct or alive): Map<speciesId, SpeciesRecord>
  allSpecies: new Map(),
  // Phylogenetic tree: array of nodes
  tree: [],
  // Chronicle events
  chronicle: [],

  // Distance threshold to call something a new species
  SPECIES_DIST: 0.18,
  // Brain distance threshold
  BRAIN_DIST: 0.45,

  // Stats tracking
  statsHistory: [], // {time, population, species}
  nextSpeciesId: 1,

  reset() {
    this.species.clear();
    this.allSpecies.clear();
    this.tree = [];
    this.chronicle = [];
    this.statsHistory = [];
    this.nextSpeciesId = 1;
  },

  // Determine the species id for a creature (using genome + brain distance)
  classify(creature) {
    let bestId = -1;
    let bestD = Infinity;
    for (const [id, srec] of this.species) {
      if (srec.population === 0) continue;
      const rep = srec.representative;
      const gd = G.distance(creature.genome, rep.genome);
      if (gd > this.SPECIES_DIST) continue;
      const bd = B.distance(creature.brain, rep.brain);
      if (bd > this.BRAIN_DIST) continue;
      // combined distance
      const d = gd + bd * 0.4;
      if (d < bestD) { bestD = d; bestId = id; }
    }

    if (bestId >= 0) {
      const srec = this.species.get(bestId);
      srec.members.push(creature);
      srec.population++;
      // Update representative occasionally
      if (srec.population % 6 === 0) {
        // pick member with highest fitness
        let best = srec.members[0];
        for (const m of srec.members) {
          if (m.fitness > best.fitness) best = m;
        }
        srec.representative = best;
      }
      return bestId;
    }

    // Found a new species
    const id = this.nextSpeciesId++;
    const seed = (creature.genome[8] * 1e9) | 0;
    const name = U.binomialFromSeed(creature.id * 1009 + (creature.genome[8] * 1e6) | 0);
    const rec = {
      id,
      name,
      latin: name,
      born: W.time,
      parent: null,
      population: 1,
      members: [creature],
      representative: creature,
      color: creature.hue,
      sat: creature.sat,
      lit: creature.lit,
      // Aggregate stats
      bestFitness: 0,
      meanFitness: 0,
      sumFitness: 0,
      extinct: false,
      extinctAt: null,
      killed: 0,
      children: [],
      // Heritage
      founderGenome: creature.genome.slice ? creature.genome.slice() : new Float32Array(creature.genome),
    };
    this.species.set(id, rec);
    this.allSpecies.set(id, rec);
    this.tree.push({
      id,
      parent: null,
      born: W.time,
      extinctAt: null,
      size: 1,
      color: creature.hue,
      sat: creature.sat,
      lit: creature.lit,
      generation: creature.generation,
    });
    this.chronicle.push({
      time: W.time,
      kind: 'first',
      speciesId: id,
      speciesName: name,
      message: `The first ${name} emerges onto the world.`,
    });
    return id;
  },

  // Try to speciate a child from its parents (returns species id, possibly new)
  classifyChild(creature, parentSpecies) {
    let bestId = -1;
    let bestD = Infinity;
    for (const [id, srec] of this.species) {
      if (srec.population === 0) continue;
      const rep = srec.representative;
      const gd = G.distance(creature.genome, rep.genome);
      if (gd > this.SPECIES_DIST) continue;
      const bd = B.distance(creature.brain, rep.brain);
      if (bd > this.BRAIN_DIST) continue;
      const d = gd + bd * 0.4;
      if (d < bestD) { bestD = d; bestId = id; }
    }
    if (bestId >= 0) {
      const srec = this.species.get(bestId);
      srec.members.push(creature);
      srec.population++;
      creature.speciesId = bestId;
      return bestId;
    }

    // New species! Branch from parent.
    const id = this.nextSpeciesId++;
    const name = U.binomialFromSeed(creature.id * 1009 + ((creature.genome[8] * 1e6) | 0));
    const rec = {
      id,
      name,
      latin: name,
      born: W.time,
      parent: parentSpecies,
      population: 1,
      members: [creature],
      representative: creature,
      color: creature.hue,
      sat: creature.sat,
      lit: creature.lit,
      bestFitness: 0,
      meanFitness: 0,
      sumFitness: 0,
      extinct: false,
      extinctAt: null,
      killed: 0,
      children: [],
      founderGenome: creature.genome.slice ? creature.genome.slice() : new Float32Array(creature.genome),
    };
    this.species.set(id, rec);
    this.allSpecies.set(id, rec);

    // Phylogenetic branch
    this.tree.push({
      id,
      parent: parentSpecies,
      born: W.time,
      extinctAt: null,
      size: 1,
      color: creature.hue,
      sat: creature.sat,
      lit: creature.lit,
      generation: creature.generation,
    });

    if (parentSpecies) {
      const psrec = this.species.get(parentSpecies) || this.allSpecies.get(parentSpecies);
      if (psrec) {
        psrec.children.push(id);
      }
      const par = this.allSpecies.get(parentSpecies);
      const parName = par ? par.name : 'an ancestor';
      this.chronicle.push({
        time: W.time,
        kind: 'speciation',
        speciesId: id,
        speciesName: name,
        message: `${name} branches off from ${parName}.`,
      });
      W.totalSpeciations++;
    }
    creature.speciesId = id;
    return id;
  },

  // Called once per world step to update populations + extinctions
  update() {
    const toRemove = [];
    for (const [id, rec] of this.species) {
      rec.population = 0;
      rec.members.length = 0;
      rec.sumFitness = 0;
    }
    for (const c of W.creatures) {
      if (c.dead) continue;
      const id = c.speciesId;
      if (id < 0) continue;
      const srec = this.species.get(id);
      if (!srec) continue;
      srec.members.push(c);
      srec.population++;
      srec.sumFitness += c.fitness;
      if (c.fitness > srec.bestFitness) srec.bestFitness = c.fitness;
    }
    for (const [id, rec] of this.species) {
      if (rec.population === 0) {
        rec.extinct = true;
        rec.extinctAt = W.time;
        // Remove from living map; keep in allSpecies for tree
        toRemove.push(id);
        const treeNode = this.tree.find(t => t.id === id);
        if (treeNode && !treeNode.extinctAt) treeNode.extinctAt = W.time;
        // Chronicle
        // Avoid duplicate chronicle entries
        const alreadyLogged = this.chronicle.some(e => e.kind === 'extinction' && e.speciesId === id);
        if (!alreadyLogged) {
          this.chronicle.push({
            time: W.time,
            kind: 'extinction',
            speciesId: id,
            speciesName: rec.name,
            message: `${rec.name} goes extinct after ${(rec.extinctAt - rec.born).toFixed(2)} world-years.`,
          });
          W.totalExtinctions++;
        }
      } else {
        rec.meanFitness = rec.sumFitness / rec.population;
        // Update representative occasionally
        if (rec.members.length > 0 && rec.population % 4 === 0) {
          let best = rec.members[0];
          for (const m of rec.members) {
            if (m.fitness > best.fitness) best = m;
          }
          rec.representative = best;
        }
      }
    }
    for (const id of toRemove) this.species.delete(id);
  },

  // Push periodic stats to history
  recordStats(time, population, speciesCount) {
    this.statsHistory.push({ time, population, species: speciesCount });
    if (this.statsHistory.length > 2000) this.statsHistory.shift();
  }
};

if (typeof module !== 'undefined') module.exports = E;