/* creature.js — the agents. Bodies with limbs driven by brains. */

'use strict';

const C = {
  // Sensor + effector layout:
  // SENSORS (11 inputs):
  //   0: forward eye — distance to nearest creature in front (0..1, 1=close)
  //   1: forward eye — type: friend (1) / prey (-1) / predator (-1) / neutral (0)
  //   2: ground — height/brightness (0..1)
  //   3: food smell — local plant density (0..1)
  //   4: prey smell — local prey density (0..1)
  //   5: health / hunger (0..1)
  //   6: energy (0..1)
  //   7: temperature (0..1)
  //   8: velocity along forward (0..1, 0.5 = stopped)
  //   9: oscillator 1 — sine of (age * freq1), useful for rhythmic gait
  //   10: oscillator 2 — sine of (age * freq2)
  //
  // EFFECTORS (8 outputs):
  //   0..nLimbs-2: muscle contraction for each limb (sign + magnitude)
  //   last:  bias / thrust
  //   second-last: turn
  //
  // We pad with a "bias" output that is always fed as +1 to a neuron (so the network can tune it).

  SENSOR_COUNT: 11,
  EFFECTOR_BASE: 3,  // bias + thrust + turn

  nextId: 1,

// A creature: body, brain, lifecycle, behavior
  create(genome, brain, x, y, world, parents = null) {
    const id = C.nextId++;
    const speed = G.geneVal(8, genome[7]); // speed gene
    const vision = G.geneVal(2, genome[2]);
    const stomach = G.geneVal(3, genome[3]);
    const size = G.geneVal(0, genome[0]);
    const lifespan = G.geneVal(5, genome[5]);
    const maturity = G.geneVal(6, genome[6]);
    const nLimbs = G.geneInt(11, genome[11]);

    const topology = [
      C.SENSOR_COUNT,
      12, 10,
      nLimbs + C.EFFECTOR_BASE,
    ];

    // Compute base hue/sat/lit; we'll bias by diet to make ecology legible
    const baseHue = G.geneVal(8, genome[8]) * 360;
    const baseSat = G.geneVal(9, genome[9]) * 100;
    const baseLit = G.geneVal(10, genome[10]) * 100;

    // Determine body shape class by diet
    const carni = G.geneVal(13, genome[13]);
    const herbi = G.geneVal(14, genome[14]);
    let bodyClass;
    if (carni > herbi + 0.1) bodyClass = 'carni';
    else if (herbi > carni + 0.1) bodyClass = 'herbi';
    else bodyClass = 'omni';

    // Bias hue by body class so carnivores are reddish, herbivores greenish
    let finalHue = baseHue;
    if (bodyClass === 'carni') {
      // Push hue toward warm reds/oranges (0-40 or 320-360)
      finalHue = baseHue * 0.18 + (baseHue > 180 ? 320 : 0);
    } else if (bodyClass === 'herbi') {
      // Push hue toward greens (60-160)
      finalHue = 60 + baseHue * 0.4;
    } else {
      // Omnivore: yellows/oranges (30-70)
      finalHue = 30 + baseHue * 0.2;
    }

    const cr = {
      id,
      genome: genome.slice ? genome.slice() : new Float32Array(genome),
      brain,
      // World position
      x, y,
      vx: 0, vy: 0,
      angle: Math.random() * U.TAU,
      // Lifecycle — measured in sim seconds. We use 60 sim-steps/sec.
      // Each sim-second is roughly 1/240 of an in-world day.
      age: 0,
      ageAtBirth: 0,
      ageMax: Math.max(20, (lifespan * 60 * 2.5) | 0),
      maturityAge: Math.max(8, (maturity * 60 * 0.8) | 0),
      energy: 80,
      maxEnergy: 100 * size,
      stomachFill: 30,
      stomachCap: 40 * stomach,
      health: 100,
      maxHealth: 100 * size,
      // Body
      size,
      speed,
      vision: vision * 220,
      nLimbs,
      limbs: [],
      bodyClass,
      bodyAspect: 1.0 + (bodyClass === 'carni' ? 0.4 : (bodyClass === 'herbi' ? -0.15 : 0.05)),
      // Genealogy
      parents,
      children: [],
      generation: parents ? parents[0].generation + 1 : 0,
      // Diet
      diet: { carni, herbi },
      aggression: G.geneVal(15, genome[15]),
      // Color (computed)
      hue: finalHue,
      sat: baseSat,
      lit: baseLit,
      // Brain state
      brainInputs: new Float32Array(C.SENSOR_COUNT),
      brainOutputs: new Float32Array(nLimbs + C.EFFECTOR_BASE),
      // Behavior / events
      lastAteAt: 0,
      lastMateAt: -10,
      eatCount: 0,
      killCount: 0,
      mateCount: 0,
      // Selection / fitness tracking
      fitness: 0,
      speciesId: -1,
      // Dead flag
      dead: false,
      // Visual FX
      spawnFlash: 1.0,
    };

    // Build limbs
    for (let i = 0; i < nLimbs; i++) {
      const a = (i / nLimbs) * U.TAU;
      cr.limbs.push({
        angle: a,
        baseAngle: a,
        phase: i / nLimbs * U.TAU,
        amp: 0.4 + Math.random() * 0.3,
        freq: 4 + Math.random() * 4,
      });
    }

brain.id = id;
    brain.topology = topology;
    // Reshape brain weights if topology changed
    const needsResize = brain.weights.length === 0 ||
      brain.weights[0].length / topology[0] !== topology[1];
    if (needsResize) {
      B.init(brain, Math.random);
    }
    cr.maxEnergy = 100 * size;

    return cr;
  },

  // Build a brain input vector from the world.
  // Returns the same array, mutated by AI.
  sense(creature, world) {
    const inp = creature.brainInputs;
    const cosA = Math.cos(creature.angle);
    const sinA = Math.sin(creature.angle);
    const vR = creature.vision;

    // 0: nearest creature in forward 90° cone, distance -> closeness
    // 1: prey/friend/predator hint
    let bestD = Infinity;
    let bestType = 0;
    for (const o of world.creatures) {
      if (o === creature || o.dead) continue;
      const dx = o.x - creature.x, dy = o.y - creature.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > vR) continue;
      const ang = Math.atan2(dy, dx) - creature.angle;
      const wrap = ((ang + Math.PI) % U.TAU + U.TAU) % U.TAU - Math.PI;
      if (Math.abs(wrap) > Math.PI * 0.55) continue;
      if (d < bestD) {
        bestD = d;
        const dietH = o.diet.herbi;
        const dietC = o.diet.carni;
        const ownSize = creature.size;
        const otherSize = o.size;
        // Type hint: prey (other is small and edible), predator (other is large and carnivorous), or neutral
        let isPrey = (o.size < ownSize * 0.85) && (creature.diet.carni > 0.3);
        let isPredator = (o.size > ownSize * 1.1) && (o.diet.carni > 0.5);
        let isFriend = (o.diet.herbi > 0.5) && (creature.diet.herbi > 0.5);
        if (isPrey) bestType = 1;
        else if (isPredator) bestType = -1;
        else if (isFriend) bestType = -0.5;
        else bestType = 0;
      }
    }
    inp[0] = bestD < Infinity ? 1 - bestD / vR : 0;
    inp[1] = bestType;

    // 2: ground height
    const wx = (creature.x / world.scale) | 0;
    const wy = (creature.y / world.scale) | 0;
    const tile = world.tileAt(wx, wy);
    inp[2] = tile ? tile.fertility : 0;

    // 3: food smell — local plant density
    inp[3] = world.localPlants(creature.x, creature.y, creature.vision * 0.4) || 0;

    // 4: prey smell — local edible creatures density
    inp[4] = world.localPrey(creature.x, creature.y, creature.vision * 0.5, creature) || 0;

    // 5: hunger (0 full, 1 starving)
    inp[5] = 1 - creature.stomachFill / creature.stomachCap;

    // 6: energy (0 empty, 1 full)
    inp[6] = creature.energy / creature.maxEnergy;

    // 7: temperature (placeholder — will be set from world temp)
    inp[7] = world.tempAt(creature.x, creature.y);

    // 8: velocity along forward
    const fwdV = creature.vx * cosA + creature.vy * sinA;
    inp[8] = U.clamp(0.5 + fwdV * 0.2, 0, 1);

    // 9, 10: oscillators (rhythmic gait helpers)
    inp[9] = Math.sin(creature.age * 0.18) * 0.5 + 0.5;
    inp[10] = Math.sin(creature.age * 0.31 + 1.7) * 0.5 + 0.5;

    return inp;
  },

  // Forward brain, then act based on outputs
  think(creature, world) {
    const out = B.forward(creature.brain, creature.brainInputs);
    creature.brainOutputs = out;
    return out;
  },

  // Apply brain output to body: thrust, turn, limb actuation.
  act(creature, world, dt) {
    const out = creature.brainOutputs;
    const nLimbs = creature.nLimbs;
    // last output = turn
    // second-last = thrust (forward/back)
    const turn = out[nLimbs + 2 - 1]; // wait careful: EFFECTOR_BASE = 3, last index = nLimbs + 2
    const thrust = out[nLimbs + 1];

    const speed = creature.speed * 60; // px / s base
    creature.angle += turn * 4.0 * dt;
    // Wrap angle
    if (creature.angle > Math.PI) creature.angle -= U.TAU;
    if (creature.angle < -Math.PI) creature.angle += U.TAU;

    // Each limb's amplitude modulated by brain output
    for (let i = 0; i < nLimbs; i++) {
      const limb = creature.limbs[i];
      const ctrl = out[i]; // -1..1
      limb.amp = 0.25 + Math.abs(ctrl) * 0.45;
      limb.freq = 4 + (ctrl + 1) * 2;
      limb.phase += limb.freq * dt;
    }

    // Walking: use mean of limb outputs to drive forward motion
    let walk = 0;
    for (let i = 0; i < nLimbs; i++) walk += out[i];
    walk = walk / nLimbs;

    const thrustMag = (thrust * 0.5 + walk * 0.6) * speed * creature.size;
    const cosA = Math.cos(creature.angle);
    const sinA = Math.sin(creature.angle);

    // Apply thrust
    creature.vx += cosA * thrustMag * dt;
    creature.vy += sinA * thrustMag * dt;

    // Drag
    creature.vx *= 0.92;
    creature.vy *= 0.92;

    // Speed cap
    const maxV = creature.speed * 70 * creature.size;
    const sp = Math.sqrt(creature.vx * creature.vx + creature.vy * creature.vy);
    if (sp > maxV) {
      creature.vx = creature.vx / sp * maxV;
      creature.vy = creature.vy / sp * maxV;
    }
  },

  // Integrate position, energy, life
  integrate(creature, world, dt) {
    creature.x += creature.vx * dt;
    creature.y += creature.vy * dt;
    creature.age += dt;
    if (creature.spawnFlash > 0) creature.spawnFlash = Math.max(0, creature.spawnFlash - dt * 1.5);

    // Energy decay (metabolism)
    const meta = G.geneVal(4, creature.genome[4]);
    const baseCost = 0.32 * meta * (0.6 + creature.size * 0.4);
    const moveCost = 0.008 * Math.sqrt(creature.vx * creature.vx + creature.vy * creature.vy);
    const brainCost = 0.03;
    creature.energy -= (baseCost + moveCost + brainCost) * dt;

    // Stomach empties into energy slowly
    if (creature.stomachFill > 0) {
      const drain = Math.min(creature.stomachFill, 1.5 * dt);
      creature.stomachFill -= drain;
      creature.energy = Math.min(creature.maxEnergy, creature.energy + drain * 2.8);
    }

    // Damage from low energy
    if (creature.energy < 0) {
      creature.health += creature.energy * 0.5 * dt; // negative
    }

    // Old age
    if (creature.age > creature.ageMax) {
      const over = creature.age - creature.ageMax;
      creature.health -= (over * 0.02) * dt;
    }

    // Death check
    if (creature.health <= 0 || creature.energy <= -40) {
      creature.dead = true;
      // Drop a corpse (food) for the world to recycle.
      world.addFood(creature.x, creature.y, creature.size * 1.2);
    }
  },

  // Attempt to eat food at this position
  tryEat(creature, world) {
    const r = 8 * G.geneVal(12, creature.genome[12]);
    const eaten = world.consumeFood(creature.x, creature.y, r);
    if (eaten > 0) {
      creature.stomachFill = Math.min(creature.stomachCap, creature.stomachFill + eaten);
      creature.lastAteAt = creature.age;
      creature.eatCount++;
      creature.health = Math.min(creature.maxHealth, creature.health + 1.5);
      return true;
    }
    // Try plants
    const plant = world.consumePlant(creature.x, creature.y, r);
    if (plant > 0 && creature.diet.herbi > 0.1) {
      creature.stomachFill = Math.min(creature.stomachCap, creature.stomachFill + plant * 0.6);
      creature.lastAteAt = creature.age;
      creature.eatCount++;
      creature.health = Math.min(creature.maxHealth, creature.health + 1);
      return true;
    }
    return false;
  },

  // Attack another creature (carnivore behavior)
  tryAttack(creature, world) {
    if (creature.diet.carni < 0.2) return false;
    const reach = 10 * creature.size;
    let victim = null;
    let bestD = Infinity;
    for (const o of world.creatures) {
      if (o === creature || o.dead) continue;
      const dx = o.x - creature.x, dy = o.y - creature.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach) continue;
      // Only "ahead" — body collision based
      const ang = Math.atan2(dy, dx) - creature.angle;
      const wrap = ((ang + Math.PI) % U.TAU + U.TAU) % U.TAU - Math.PI;
      if (Math.abs(wrap) > Math.PI * 0.6) continue;
      // Predator > prey filter
      if (o.size >= creature.size * 0.95 && creature.aggression < 0.6) continue;
      if (d < bestD) { bestD = d; victim = o; }
    }
    if (!victim) return false;
    const dmg = (1.2 * creature.size + creature.aggression * 0.6) *
                (0.5 + creature.diet.carni * 0.7);
    victim.health -= dmg;
    // Energy cost to attacker
    creature.energy -= 1.5 * creature.size;
    if (victim.health <= 0) {
      victim.dead = true;
      world.addFood(victim.x, victim.y, victim.size * 1.4);
      creature.killCount++;
      // Eating the corpse
      creature.stomachFill = Math.min(creature.stomachCap,
        creature.stomachFill + victim.size * 4);
      return true;
    }
    return false;
  },

  // Sexual reproduction: requires another creature of similar species nearby
  canMate(creature) {
    if (creature.age < creature.maturityAge) return false;
    if (creature.stomachFill < creature.stomachCap * 0.15) return false;
    if (creature.energy < creature.maxEnergy * 0.2) return false;
    if (creature.age - creature.lastMateAt < 3) return false;
    return true;
  },

  // Returns nearby creature of same species that can also mate
  findMate(creature, world) {
    if (!C.canMate(creature)) return null;
    let best = null, bestD = Infinity;
    for (const o of world.creatures) {
      if (o === creature || o.dead) continue;
      if (!C.canMate(o)) continue;
      if (o.speciesId !== creature.speciesId) continue;
      const dx = o.x - creature.x, dy = o.y - creature.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 160) continue;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  },

  // Birth a child from two parents (crossover + mutation)
  reproduce(parentA, parentB, world, rng) {
    const childGenome = G.crossover(rng, parentA.genome, parentB.genome);
    G.mutate(childGenome, rng, 0.12, 0.13);
    const childBrain = B.crossover(rng, parentA.brain, parentB.brain);
    B.mutate(childBrain, rng, 0.06, 0.32);

    // Place child between parents
    const x = (parentA.x + parentB.x) * 0.5 + (rng() - 0.5) * 12;
    const y = (parentA.y + parentB.y) * 0.5 + (rng() - 0.5) * 12;

    const child = C.create(childGenome, childBrain, x, y, world, [parentA, parentB]);
    parentA.children.push(child.id);
    parentB.children.push(child.id);
    parentA.mateCount++;
    parentB.mateCount++;
    parentA.lastMateAt = parentA.age;
    parentB.lastMateAt = parentB.age;
    // Cost
    parentA.energy *= 0.85;
    parentB.energy *= 0.85;
    parentA.stomachFill *= 0.7;
    parentB.stomachFill *= 0.7;
    world.spawnCreature(child);
    return child;
  }
};

if (typeof module !== 'undefined') module.exports = C;