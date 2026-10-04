/* world.js — terrain, food, plants, climate, spatial queries. */

'use strict';

const W = {
  W: 256,         // grid width (in tiles)
  H: 256,         // grid height
  scale: 5,       // world pixels per tile
  // Genome-like state
  tiles: null,    // Uint8Array of W*H, with terrain type (0..8)
  plants: null,   // Uint32Array of W*H, plant density (0..1024)
  food: null,     // Float32Array of W*H, food pile
  water: null,    // Float32Array of W*H, water level (also affects terrain)
  regrow: null,   // Float32Array of W*H, regrow timer
  // Spatial index
  cellIdx: null,
  cellSize: 64,
  gridCols: 0, gridRows: 0,
  // Creatures
  creatures: null,
  // Tracking
  time: 0,        // simulated years
  speedFactor: 1,
  // Climate
  seasonTime: 0,
  // Tile types
  T_WATER: 0,
  T_BEACH: 1,
  T_GRASS: 2,
  T_FOREST: 3,
  T_JUNGLE: 4,
  T_DESERT: 5,
  T_TUNDRA: 6,
  T_MOUNTAIN: 7,
  T_SNOW: 8,
  // Counts
  totalBirths: 0,
  totalDeaths: 0,
  totalExtinctions: 0,
  totalSpeciations: 0,
  // Reference to RNG for determinism
  rng: null,
  seed: 0,

  // Init world
  init(opts) {
    this.seed = (opts.seed | 0) || 1;
    this.rng = U.rng(this.seed);
    const N = this.W * this.H;
    this.tiles = new Uint8Array(N);
    this.plants = new Uint32Array(N);
    this.food = new Float32Array(N);
    this.water = new Float32Array(N);
    this.regrow = new Float32Array(N);
    this.creatures = [];

    // Spatial grid
    this.gridCols = Math.ceil(this.W * this.scale / this.cellSize) + 2;
    this.gridRows = Math.ceil(this.H * this.scale / this.cellSize) + 2;
    this.cellIdx = new Array(this.gridCols * this.gridRows);
    for (let i = 0; i < this.cellIdx.length; i++) this.cellIdx[i] = [];

    this._generateTerrain();
    this._scatterPlants();
    this.time = 0;
    this.seasonTime = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.totalExtinctions = 0;
    this.totalSpeciations = 0;
    if (typeof R !== 'undefined' && R.invalidateTerrain) R.invalidateTerrain();
  },

  // Generate heightmap + biome assignment
  _generateTerrain() {
    const noise = U.noise2(this.seed);
    const noiseB = U.noise2(this.seed ^ 0xb16b00b5);
    const noiseC = U.noise2(this.seed ^ 0xdeadbeef);
    const noiseT = U.noise2(this.seed ^ 0x12345678);
    const W = this.W, H = this.H;

    // Build heightmap
    const heights = new Float32Array(W * H);
    let minH = Infinity, maxH = -Infinity;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Continent shape: large-scale noise
        const u = x / W - 0.5, v = y / H - 0.5;
        const rad = Math.sqrt(u * u + v * v);
        const continent = 0.55 - rad * 0.95 + U.fbm2(noise, x * 1.5, y * 1.5, 3) * 0.45;
        const detail = U.fbm2(noiseB, x * 6, y * 6, 5, 2.4, 0.55) * 0.45;
        const ridge = Math.abs(U.fbm2(noiseC, x * 3, y * 3, 4, 2.1, 0.5));
        let hgt = continent + detail * 0.5 - (1 - ridge) * 0.25;
        // Add a few inland seas
        hgt += (U.fbm2(noiseT, x * 1.8, y * 1.8, 2) - 0.5) * 0.12;
        heights[y * W + x] = hgt;
        if (hgt < minH) minH = hgt;
        if (hgt > maxH) maxH = hgt;
      }
    }

    // Normalize
    for (let i = 0; i < heights.length; i++) {
      heights[i] = (heights[i] - minH) / (maxH - minH);
    }

    // Assign tiles
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const h = heights[y * W + x];
        const lat = Math.abs(y / H - 0.5) * 2; // 0 at equator, 1 at poles
        let t;
        if (h < 0.32) t = this.T_WATER;
        else if (h < 0.36) t = this.T_BEACH;
        else if (h < 0.55) t = lat < 0.55 ? this.T_GRASS : (lat < 0.78 ? this.T_FOREST : this.T_TUNDRA);
        else if (h < 0.7) t = lat < 0.4 ? this.T_JUNGLE : (lat < 0.7 ? this.T_FOREST : this.T_TUNDRA);
        else if (h < 0.85) t = lat < 0.6 ? this.T_FOREST : this.T_TUNDRA;
        else if (h < 0.93) t = this.T_MOUNTAIN;
        else t = this.T_SNOW;

        // Deserts: at certain latitudes
        const desertLat = Math.abs(y / H - 0.32);
        if ((desertLat < 0.08) && h > 0.42 && h < 0.62) t = this.T_DESERT;
        // Tundra near poles
        if (lat > 0.82 && h < 0.7) t = this.T_TUNDRA;
        if (lat > 0.88) t = this.T_SNOW;

        this.tiles[y * W + x] = t;
        this.water[y * W + x] = (h < 0.32) ? 1 : 0;
      }
    }
  },

  // Scatter plants in fertile areas
  _scatterPlants() {
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        const t = this.tiles[i];
        let cap = 0;
        if (t === this.T_GRASS) cap = 700 + (this.rng() * 200) | 0;
        else if (t === this.T_FOREST) cap = 950 + (this.rng() * 100) | 0;
        else if (t === this.T_JUNGLE) cap = 1100 + (this.rng() * 100) | 0;
        else if (t === this.T_BEACH) cap = 200 + (this.rng() * 100) | 0;
        else if (t === this.T_DESERT) cap = (this.rng() * 40) | 0;
        else if (t === this.T_TUNDRA) cap = 30 + (this.rng() * 30) | 0;
        else cap = 0;
        this.plants[i] = cap * (0.4 + this.rng() * 0.6);
      }
    }
  },

  // Convert world pixel coords to tile coords
  _toTile(x, y) {
    return [(x / this.scale) | 0, (y / this.scale) | 0];
  },

  tileAt(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return null;
    const i = y * this.W + x;
    return {
      type: this.tiles[i],
      plants: this.plants[i],
      food: this.food[i],
      water: this.water[i],
      fertility: this._fertility(this.tiles[i], this.plants[i]),
    };
  },

  // Tile is fertile if it has plants and is not water/mountain
  _fertility(t, plants) {
    if (t === this.T_WATER || t === this.T_MOUNTAIN || t === this.T_SNOW) return 0;
    if (t === this.T_DESERT) return 0.05;
    return U.clamp(plants / 1000, 0, 1) * 0.8 + 0.05;
  },

  // Temperature based on latitude + altitude (simplified)
  tempAt(x, y) {
    const wx = (x / this.scale) | 0, wy = (y / this.scale) | 0;
    if (wy < 0 || wy >= this.H) return 0.5;
    const lat = Math.abs(wy / this.H - 0.5) * 2;
    const t = this.tiles[wy * this.W + wx];
    let base = 1 - lat * 0.7;
    if (t === this.T_SNOW || t === this.T_TUNDRA) base = 0.15;
    if (t === this.T_DESERT) base = 0.9;
    if (t === this.T_JUNGLE) base = 0.85;
    return U.clamp(base, 0, 1);
  },

  // Local plant density around a point (smell)
  localPlants(x, y, radius) {
    const [cx, cy] = this._toTile(x, y);
    let total = 0, n = 0;
    const r = Math.ceil(radius / this.scale);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
        total += this.plants[ny * this.W + nx];
        n++;
      }
    }
    return U.clamp((total / Math.max(1, n)) / 1000, 0, 1);
  },

  // Density of nearby prey (creatures smaller than `creature`)
  localPrey(x, y, radius, creature) {
    const cells = this._cellsAround(x, y, radius);
    let total = 0;
    for (const ci of cells) {
      const list = this.cellIdx[ci];
      for (const o of list) {
        if (o === creature || o.dead) continue;
        const dx = o.x - x, dy = o.y - y;
        if (dx * dx + dy * dy > radius * radius) continue;
        if (o.size < creature.size * 0.9 && creature.diet.carni > 0.2) total++;
      }
    }
    return U.clamp(total / 8, 0, 1);
  },

  // Consume food (decaying meat piles) from a circle
  consumeFood(x, y, radius) {
    let got = 0;
    const [cx, cy] = this._toTile(x, y);
    const r = Math.ceil(radius / this.scale);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
        const i = ny * this.W + nx;
        const tile = this.tiles[i];
        if (tile === this.T_WATER) continue;
        const cxw = nx * this.scale + this.scale * 0.5;
        const cyw = ny * this.scale + this.scale * 0.5;
        const d = Math.sqrt((cxw - x) ** 2 + (cyw - y) ** 2);
        if (d > radius) continue;
        const f = this.food[i];
        if (f <= 0) continue;
        const take = Math.min(f, 0.6);
        this.food[i] -= take;
        got += take;
      }
    }
    return got;
  },

  // Consume plants in a small radius
  consumePlant(x, y, radius) {
    let got = 0;
    const [cx, cy] = this._toTile(x, y);
    const r = Math.ceil(radius / this.scale);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
        const i = ny * this.W + nx;
        if (this.plants[i] <= 0) continue;
        const cxw = nx * this.scale + this.scale * 0.5;
        const cyw = ny * this.scale + this.scale * 0.5;
        const d = Math.sqrt((cxw - x) ** 2 + (cyw - y) ** 2);
        if (d > radius) continue;
        const take = Math.min(this.plants[i], 30);
        this.plants[i] -= take;
        got += take * 0.08;
      }
    }
    return got;
  },

  // Add food (e.g., from corpses)
  addFood(x, y, amount) {
    const [cx, cy] = this._toTile(x, y);
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return;
    this.food[cy * this.W + cx] += amount;
  },

  // Paint a brush at this location
  paint(brush, x, y, radius, additive) {
    const [cx, cy] = this._toTile(x, y);
    const r = Math.ceil(radius / this.scale);
    let tileChanged = false;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue;
        const i = ny * this.W + nx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) continue;
        const falloff = 1 - dist / r;
        const sign = additive ? 1 : -1;

        if (brush === 'food') {
          this.food[i] = U.clamp(this.food[i] + sign * 60 * falloff, 0, 1000);
        } else if (brush === 'plants') {
          this.plants[i] = U.clamp(this.plants[i] + sign * 800 * falloff, 0, 1100);
        } else if (brush === 'water') {
          if (additive) {
            this.water[i] = 1;
            this.tiles[i] = this.T_WATER;
            tileChanged = true;
          } else {
            this.water[i] = 0;
            this.tiles[i] = this.T_GRASS;
            tileChanged = true;
          }
        } else if (brush === 'wall') {
          // mountains act as walls
          if (additive) this.tiles[i] = this.T_MOUNTAIN;
          else if (this.tiles[i] === this.T_MOUNTAIN) this.tiles[i] = this.T_GRASS;
          tileChanged = true;
        } else if (brush === 'heat') {
          // Visual heat zone — doesn't affect tiles but adds a glow
        } else if (brush === 'clear') {
          this.food[i] = 0;
        } else if (brush === 'grass') {
          if (this.tiles[i] !== this.T_WATER && this.tiles[i] !== this.T_MOUNTAIN) {
            this.tiles[i] = this.T_GRASS;
            tileChanged = true;
          }
        }
      }
    }
    if (tileChanged && typeof R !== 'undefined' && R.invalidateAll) {
      R.invalidateAll();
    }
  },

  // Plant regrowth + food decay per tick. We sample (skip many tiles each tick)
// so this is fast even at high speeds. When a tile is processed, it gets
// the regrowth it would have accumulated over the whole skip interval.
  _regrow(dt) {
    const N = this.tiles.length;
    const CHUNK = 4096;
    const stride = N / CHUNK;
    const start = this._regrowCursor || 0;
    const end = Math.min(N, start + CHUNK);
    for (let i = start; i < end; i++) {
      const t = this.tiles[i];
      if (t === this.T_WATER || t === this.T_MOUNTAIN || t === this.T_SNOW) continue;
      const cap = this._capForTile(t);
      if (this.plants[i] < cap) {
        // Multiplier because each tile is processed once every `stride` ticks.
        this.plants[i] = Math.min(cap, this.plants[i] + cap * 0.012 * dt * stride * (0.5 + this.water[i] * 0.4 + 0.3));
      }
      // Food decay
      if (this.food[i] > 0) {
        this.food[i] = Math.max(0, this.food[i] - 0.04 * dt * stride);
      }
    }
    this._regrowCursor = end >= N ? 0 : end;
  },

  _capForTile(t) {
    switch (t) {
      case this.T_GRASS: return 800;
      case this.T_FOREST: return 1000;
      case this.T_JUNGLE: return 1100;
      case this.T_BEACH: return 250;
      case this.T_DESERT: return 30;
      case this.T_TUNDRA: return 50;
    }
    return 0;
  },

  // Spawn a creature at this position
  spawnCreature(c) { this.creatures.push(c); this._addToCell(c); },

  // Spatial grid helpers
  _cellOf(x, y) {
    const cx = (x / this.cellSize) | 0;
    const cy = (y / this.cellSize) | 0;
    return cy * this.gridCols + cx;
  },

  _addToCell(c) {
    const ci = this._cellOf(c.x, c.y);
    if (!this.cellIdx[ci]) this.cellIdx[ci] = [];
    this.cellIdx[ci].push(c);
  },

  _rebuildCells() {
    for (let i = 0; i < this.cellIdx.length; i++) this.cellIdx[i].length = 0;
    for (const c of this.creatures) {
      if (!c.dead) this._addToCell(c);
    }
  },

  _cellsAround(x, y, radius) {
    const minCx = ((x - radius) / this.cellSize) | 0;
    const maxCx = ((x + radius) / this.cellSize) | 0;
    const minCy = ((y - radius) / this.cellSize) | 0;
    const maxCy = ((y + radius) / this.cellSize) | 0;
    const out = [];
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (cx < 0 || cy < 0 || cx >= this.gridCols || cy >= this.gridRows) continue;
        out.push(cy * this.gridCols + cx);
      }
    }
    return out;
  },

  // Step world (plants regrow, food decays, time advances)
  step(dt) {
    // Each sim-step is 1/60 sim-second. We treat sim-seconds as world-time
    // directly but scaled: 1 sim-second = 0.04 world-years; 1 year = 25 sim-sec.
    this.time += dt * 0.04;
    this.seasonTime += dt * 0.04;
    this._regrow(dt);
    this._rebuildCells();
  },

  // Used by evolution module: species list and stats
  countBySpecies(species) {
    let count = 0;
    for (const c of this.creatures) {
      if (c.dead) continue;
      if (c.speciesId === species) count++;
    }
    return count;
  },

  // Stats
  getStats() {
    let pop = 0, species = new Set();
    for (const c of this.creatures) {
      if (c.dead) continue;
      pop++;
      species.add(c.speciesId);
    }
    return { population: pop, species: species.size };
  },

  // Get a random spawn point on solid ground near center
  randomSpawnPoint(rng, nearCenter) {
    for (let tries = 0; tries < 80; tries++) {
      const tx = (nearCenter ? (rng() * 30 + this.W / 2 - 15) : (rng() * this.W)) | 0;
      const ty = (nearCenter ? (rng() * 30 + this.H / 2 - 15) : (rng() * this.H)) | 0;
      if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) continue;
      const t = this.tiles[ty * this.W + tx];
      if (t !== this.T_WATER && t !== this.T_MOUNTAIN && t !== this.T_SNOW) {
        return [tx * this.scale + rng() * this.scale, ty * this.scale + rng() * this.scale];
      }
    }
    return [this.W * this.scale * 0.5, this.H * this.scale * 0.5];
  }
};

if (typeof module !== 'undefined') module.exports = W;