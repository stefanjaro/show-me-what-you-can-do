/* main.js — the simulation loop, state, integration. */

'use strict';

const M = {
  // ── State ────────────────────────────────────────────
  paused: false,
  speedLevel: 4,
  speedTable: [0.25, 0.5, 1, 2, 4, 8, 16, 32],
  fps: 0,
  brush: 'food',
  mode: 'paint',
  soundOn: true,
  // Currently selected / followed / controlled
  selected: null,
  followId: -1,
  controlId: -1,
  // Camera
  // Stats
  maxGeneration: 0,
  // Heat spots (visual brush)
  heatSpots: [],
  // Frame timing
  lastFrame: 0,
  fpsAcc: 0,
  fpsCount: 0,
  fpsTimer: 0,
  // Track chronicle buffer
  lastChronicleAt: 0,
  // AI control keys
  controlKeys: { fwd: false, back: false, left: false, right: false, eat: false },
  // Save key
  saveStr: '',
  // Auto-pause on tab hide
  hidden: false,

  start() {
    this._initWorld();
    this._initPopulation();
    this._centerCamera();
    requestAnimationFrame(this._loop.bind(this));
    window.addEventListener('blur', () => { this.hidden = true; this.paused = true; UI.updateButtons(); });
    window.addEventListener('focus', () => { this.hidden = false; });

    // Control keys (when in control mode)
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (this.controlId >= 0) {
        if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') this.controlKeys.fwd = true;
        if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.controlKeys.back = true;
        if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.controlKeys.left = true;
        if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.controlKeys.right = true;
        if (e.key === 'e' || e.key === 'E') this.controlKeys.eat = true;
      }
    });
    window.addEventListener('keyup', e => {
      if (e.target.tagName === 'INPUT') return;
      if (this.controlId >= 0) {
        if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') this.controlKeys.fwd = false;
        if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.controlKeys.back = false;
        if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.controlKeys.left = false;
        if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.controlKeys.right = false;
        if (e.key === 'e' || e.key === 'E') this.controlKeys.eat = false;
      }
    });
  },

  _initWorld() {
    const seed = (Math.random() * 0xffffffff) | 0;
    W.init({ seed });
    R.cam.x = W.W * W.scale * 0.5;
    R.cam.y = W.H * W.scale * 0.5;
    R.cam.zoom = 0.55;
    E.reset();
    this.maxGeneration = 0;
    this.selected = null;
    this.followId = -1;
    this.controlId = -1;
    this.heatSpots.length = 0;
  },

  _centerCamera() {
    R.cam.x = W.W * W.scale * 0.5;
    R.cam.y = W.H * W.scale * 0.5;
    R.cam.zoom = 0.55;
  },

  _initPopulation() {
    // Drop a small set of founding creatures in the middle.
    // We make several "tribes" of similar genomes so they can interbreed
    // and produce visible evolution.
    const rng = Math.random;
    const center = [W.W * W.scale * 0.5, W.H * W.scale * 0.5];
    const tribes = 3;
    const perTribe = 5;
    for (let t = 0; t < tribes; t++) {
      // Each tribe has a base genome + per-individual jitter
      const base = G.createSeeded(rng);
      // Bias diet for each tribe (some herbivores, some carnivores, some omnivores)
      if (t === 0) { base[13] = 0.1; base[14] = 0.8; base[15] = 0.2; } // herbivore tribe
      if (t === 1) { base[13] = 0.7; base[14] = 0.2; base[15] = 0.6; } // carnivore tribe
      if (t === 2) { base[13] = 0.3; base[14] = 0.5; base[15] = 0.3; } // omnivore tribe
      for (let i = 0; i < perTribe; i++) {
        const angle = rng() * U.TAU;
        const dist = 60 + rng() * 60;
        const tx = center[0] + Math.cos(angle) * dist;
        const ty = center[1] + Math.sin(angle) * dist;
        // Mutate base slightly per founder
        const g = base.slice();
        G.mutate(g, rng, 0.3, 0.07);
        const brain = B.create([]);
        B.init(brain, rng);
        // Initialise layers via creature creation
        const c = C.create(g, brain, tx, ty, W, null);
        c.energy = c.maxEnergy * 0.9;
        c.stomachFill = c.stomachCap * 0.8;
        const speciesId = E.classify(c);
        c.speciesId = speciesId;
        W.spawnCreature(c);
      }
    }
    // Add a starter food pile
    for (let i = 0; i < 20; i++) {
      const x = center[0] + (rng() - 0.5) * 220;
      const y = center[1] + (rng() - 0.5) * 220;
      W.addFood(x, y, 120);
    }
    // Seed plants in the central area (more density so the founders thrive)
    for (let i = 0; i < 30; i++) {
      const x = center[0] + (rng() - 0.5) * 400;
      const y = center[1] + (rng() - 0.5) * 400;
      W.paint('plants', x, y, 80, true);
    }
  },

  spawnAt(x, y, isFounder = false) {
    // Make sure we spawn on solid
    const [tx, ty] = W._toTile(x, y);
    if (tx < 0 || ty < 0 || tx >= W.W || ty >= W.H) return;
    const t = W.tiles[ty * W.W + tx];
    if (t === W.T_WATER || t === W.T_MOUNTAIN) {
      // try to find a nearby solid tile
      for (let r = 1; r < 20; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= W.W || ny >= W.H) continue;
            const tt = W.tiles[ny * W.W + nx];
            if (tt !== W.T_WATER && tt !== W.T_MOUNTAIN) {
              x = nx * W.scale + W.scale * 0.5;
              y = ny * W.scale + W.scale * 0.5;
              return this._doSpawn(x, y, isFounder);
            }
          }
        }
      }
      return;
    }
    this._doSpawn(x, y, isFounder);
  },

  _doSpawn(x, y, isFounder) {
    const rng = Math.random;
    const g = G.createSeeded(rng);
    // For founders, give them some variation
    if (isFounder) {
      // bias diet slightly toward herbi and some carni
      g[13] = rng() * 0.6;
      g[14] = 0.5 + rng() * 0.5;
    }
    const brain = B.create([]);
    B.init(brain, rng);
    const c = C.create(g, brain, x, y, W, null);
    // Determine species (new at first)
    const speciesId = E.classify(c);
    c.speciesId = speciesId;
    W.spawnCreature(c);
    W.totalBirths++;
    if (!isFounder) {
      A.sfx('birth');
    }
    return c;
  },

  // ── Loop ─────────────────────────────────────────────
  _loop(t) {
    requestAnimationFrame(this._loop.bind(this));
    if (this.hidden) return;
    const now = t * 0.001;
    let dt = now - this.lastFrame;
    if (dt > 0.1) dt = 0.1;
    this.lastFrame = now;

    // FPS
    this.fpsAcc += dt;
    this.fpsCount++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsCount / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsCount = 0;
    }

    // Music tick (independent of pause, but pause mutes)
    const speedMul = this.speedTable[this.speedLevel - 1] || 1;
    if (!this.paused) {
      A.tick(dt * Math.min(1, speedMul * 0.3), W.getStats());
    }

    // Auto time-of-day advance
    if (R.autoTime) {
      const t2 = (R.timeOfDay + dt * (speedMul) * 0.02) % 1;
      R.setTimeOfDay(t2);
      UI.setTimeLabel();
    }

    if (!this.paused) {
      // Multiple sim ticks per frame at higher speeds
      const simSteps = Math.max(1, Math.round(speedMul));
      const simDt = 1 / 60; // each step is 1 sim-second
      for (let s = 0; s < simSteps; s++) {
        this._simStep(simDt);
      }
    }

    // Render
    R.render(this);

    // Follow camera
    if (this.followId >= 0) {
      const c = W.creatures.find(o => o.id === this.followId);
      if (c) {
        R.cam.x += (c.x - R.cam.x) * Math.min(1, dt * 4);
        R.cam.y += (c.y - R.cam.y) * Math.min(1, dt * 4);
      }
    }

    // HUD update
    UI.refreshStatsHUD();
    UI.updateButtons();
    UI.refreshSpecies();
    if (this.selected && this.selected.dead) {
      this.selectCreature(null);
    } else if (this.selected) {
      UI.refreshInfo(this.selected);
    }
  },

  // ── Sim step (one tick) ──────────────────────────────
  _simStep(dt) {
    // Safety net: if population is critically low, seed new founders
    let livingCount = 0;
    for (const c of W.creatures) if (!c.dead) livingCount++;
    if (livingCount === 0) {
      // Re-seed world
      console.warn('[protogaia] population extinct — re-seeding founders');
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * U.TAU;
        const r = 80 + Math.random() * 80;
        this.spawnAt(
          W.W * W.scale * 0.5 + Math.cos(ang) * r,
          W.H * W.scale * 0.5 + Math.sin(ang) * r,
          true
        );
      }
      // Drop food and plants
      for (let i = 0; i < 15; i++) {
        const x = W.W * W.scale * 0.5 + (Math.random() - 0.5) * 300;
        const y = W.H * W.scale * 0.5 + (Math.random() - 0.5) * 300;
        W.addFood(x, y, 200);
        W.paint('plants', x, y, 60, true);
      }
    } else if (livingCount < 3 && E.species.size > 0) {
      // Bring in a few more founders of an existing species
      const arr = Array.from(E.species.values()).sort((a, b) => b.population - a.population);
      if (arr.length > 0) {
        const srec = arr[0];
        // Use the founder genome
        const g = srec.founderGenome.slice();
        G.mutate(g, Math.random, 0.3, 0.07);
        const brain = B.create([]);
        B.init(brain, Math.random);
        const ang = Math.random() * U.TAU;
        const r = 80 + Math.random() * 80;
        const c = C.create(g, brain,
          W.W * W.scale * 0.5 + Math.cos(ang) * r,
          W.H * W.scale * 0.5 + Math.sin(ang) * r,
          W, null);
        c.energy = c.maxEnergy * 0.9;
        c.stomachFill = c.stomachCap * 0.8;
        c.speciesId = E.classify(c);
        W.spawnCreature(c);
        W.totalBirths++;
      }
    }

    // Reproduce
    this._reproduceTick();

    // Day/night activity factor — affects vision & behavior
    const tod = R.timeOfDay;
    const isNight = (tod < 0.2 || tod > 0.8);
    const isDuskDawn = (tod > 0.65 && tod < 0.85) || (tod > 0.15 && tod < 0.35);

    // Sense + think + act
    for (const c of W.creatures) {
      if (c.dead) continue;
      C.sense(c, W);
      C.think(c, W);

      // If being controlled by user, override brain outputs
      if (c.id === this.controlId) {
        const k = this.controlKeys;
        // Build output array
        const out = c.brainOutputs;
        for (let i = 0; i < c.nLimbs; i++) out[i] = 0;
        out[c.nLimbs] = 0;
        out[c.nLimbs + 1] = 0;
        out[c.nLimbs + 2] = 0;
        if (k.fwd) out[c.nLimbs + 1] += 1;
        if (k.back) out[c.nLimbs + 1] -= 1;
        if (k.left) out[c.nLimbs + 2] -= 1;
        if (k.right) out[c.nLimbs + 2] += 1;
        for (let i = 0; i < c.nLimbs; i++) {
          out[i] = (k.fwd ? Math.sin(c.age * 6 + i) : 0);
        }
      }

      C.act(c, W, dt);

      // Try to eat
      if (c.age % 10 < 1) {
        // Carnivores eat less frequently during day (nocturnal preference)
        const eatProb = (c.diet.carni > c.diet.herbi + 0.1) ? (isNight ? 0.7 : 0.3)
                       : (c.diet.herbi > c.diet.carni + 0.1) ? (isNight ? 0.3 : 0.7)
                       : 0.5;
        if (Math.random() < eatProb) {
          const ate = C.tryEat(c, W);
          if (ate) c.fitness += 0.4;
        }
      }

      // Attack — carnivores more aggressive at night
      if (c.diet.carni > 0.3 && c.age % 16 < 1) {
        const aggro = c.aggression * (isNight ? 1.3 : (isDuskDawn ? 1.15 : 0.85));
        if (Math.random() < aggro) {
          C.tryAttack(c, W);
        }
      }

      // Update fitness
      c.fitness += dt * 0.02;
      if (c.age > c.maturityAge) c.fitness += dt * 0.03;
      if (c.energy > c.maxEnergy * 0.6) c.fitness += dt * 0.02;
    }

    // Integrate (position + life)
    for (const c of W.creatures) {
      if (c.dead) continue;
      C.integrate(c, W, dt);
    }

    // Bounds: clamp to world edges
    const maxX = W.W * W.scale, maxY = W.H * W.scale;
    for (const c of W.creatures) {
      if (c.dead) continue;
      if (c.x < 0) { c.x = 0; c.vx = Math.abs(c.vx); }
      if (c.y < 0) { c.y = 0; c.vy = Math.abs(c.vy); }
      if (c.x > maxX) { c.x = maxX; c.vx = -Math.abs(c.vx); }
      if (c.y > maxY) { c.y = maxY; c.vy = -Math.abs(c.vy); }
      // Mountain collision: bounce
      const [tx, ty] = W._toTile(c.x, c.y);
      if (tx >= 0 && ty >= 0 && tx < W.W && ty < W.H) {
        if (W.tiles[ty * W.W + tx] === W.T_MOUNTAIN) {
          // Push out
          c.x = (tx + 0.5) * W.scale;
          c.y = (ty + 0.5) * W.scale;
          c.vx = -c.vx * 0.5;
          c.vy = -c.vy * 0.5;
        }
      }
    }

    // Cull dead
    const before_count = W.creatures.length;
    W.creatures = W.creatures.filter(c => {
      if (!c.dead) return true;
      W.totalDeaths++;
      return false;
    });

    // Update evolution bookkeeping
    E.update();

    // Track max generation
    for (const c of W.creatures) {
      if (c.generation > this.maxGeneration) this.maxGeneration = c.generation;
    }

    // Periodic stats record
    if (W.time - this.lastChronicleAt > 0.5) {
      const s = W.getStats();
      E.recordStats(W.time, s.population, s.species);
      this.lastChronicleAt = W.time;
    }

    // World step (plants regrow etc.) - scale by sim time.
    W.step(dt);

    // Heat spots pulse
    for (const h of this.heatSpots) {
      h.life -= dt;
    }
    this.heatSpots = this.heatSpots.filter(h => h.life > 0);

    // Birth/death SFX (sample, not every one)
    // (We'll skip per-event sounds; the procedural music handles atmosphere)
  },

  _reproduceTick() {
    // Each tick, attempt mating for some creatures
    const candidates = [];
    for (const c of W.creatures) {
      if (c.dead) continue;
      if (C.canMate(c)) candidates.push(c);
    }
    // Shuffle and pair
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const used = new Set();
    let birthsThisStep = 0;
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (used.has(a.id)) continue;
      const mate = C.findMate(a, W);
      if (!mate) continue;
      if (used.has(mate.id)) continue;
      // Distance check
      const dx = a.x - mate.x, dy = a.y - mate.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 100) continue;
      // Reproduce!
      const child = C.reproduce(a, mate, W, Math.random);
      child.speciesId = E.classifyChild(child, a.speciesId);
      W.totalBirths++;
      birthsThisStep++;
      used.add(a.id);
      used.add(mate.id);
      // Random sound (sparse)
      if (Math.random() < 0.04) A.sfx('birth');
    }
    return birthsThisStep;
  },

  // ── Selection / following ────────────────────────────
  findCreatureAt(x, y, radius) {
    let best = null, bestD = radius * radius;
    for (const c of W.creatures) {
      if (c.dead) continue;
      const dx = c.x - x, dy = c.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  },

  selectCreature(c) {
    this.selected = c;
    UI.refreshInfo(c);
  },

  followCreature(c) {
    this.followId = c ? c.id : -1;
  },

  controlCreature(c) {
    this.controlId = c ? c.id : -1;
    if (c) UI.toast('Controlling — use WASD/Arrows to drive, E to eat');
  },

  spawnHeat(x, y, radius) {
    this.heatSpots.push({ x, y, radius, life: 8 });
    // Visual warmth indicator only — no actual effect
  },

  // ── Tabs refresh ─────────────────────────────────────
  refreshTree() { R.drawTreePanel(document.getElementById('treeCanvas')); },
  refreshGraph() { R.drawGraphPanel(document.getElementById('graphCanvas')); },
  refreshChronicle() { UI.refreshChronicle(); },

  // ── Controls ─────────────────────────────────────────
  togglePause() {
    this.paused = !this.paused;
    if (!this.paused) {
      this.lastFrame = performance.now() * 0.001;
    }
    UI.updateButtons();
  },

  cycleSpeed(dir = 1) {
    this.speedLevel = U.clamp(this.speedLevel + dir, 1, this.speedTable.length);
    UI.updateButtons();
    UI.toast(`Speed ×${this.speedLevel}`);
  },

  toggleSound() {
    this.soundOn = !this.soundOn;
    A.setEnabled(this.soundOn);
    UI.updateButtons();
  },

  cycleMode() {
    const modes = ['paint', 'follow', 'control', 'observe'];
    const i = modes.indexOf(this.mode);
    const next = modes[(i + 1) % modes.length];
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === next));
    this.mode = next;
    UI.toast(`Mode: ${next}`);
  },

  reset() {
    if (!confirm('Reset the world and start a new evolution?')) return;
    this._initWorld();
    this._initPopulation();
    this._centerCamera();
    E.reset();
    UI.refreshInfo(null);
    UI.refreshSpecies();
    UI.refreshChronicle();
    UI.refreshTree();
    UI.refreshGraph();
    UI.toast('New world seeded');
  },

  step() {
    if (!this.paused) {
      this.paused = true;
      UI.updateButtons();
    }
    this._simStep(1 / 60);
    R.render(this);
  }
};

if (typeof module !== 'undefined') module.exports = M;

// Init UI bindings when DOM is ready
function bootProtogaia() {
  R.init(document.getElementById('world'));
  UI.init(M);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootProtogaia);
} else {
  bootProtogaia();
}