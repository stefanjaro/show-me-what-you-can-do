/* PRIMORDIA life: genetics, evolvable neural brains, ecology, speciation. */
'use strict';

const Life = {
  creatures: [], species: [], nextSpId: 1, nextCid: 1,
  rand: null, grid: null, gridW: 0, gridH: 0, cell: 4,
  births: 0, deaths: 0, extinctions: 0,
  events: [],
  histPop: [], histSpec: [], histTemp: [],
  histTick: 0,
  selected: null, followed: null,
  plagueActive: 0,

  init(seed) {
    this.rand = mulberry32(seed ^ 0x51ab);
    this.creatures.length = 0; this.species.length = 0;
    this.nextSpId = 1; this.nextCid = 1;
    this.births = 0; this.deaths = 0; this.extinctions = 0;
    this.events.length = 0; this.histPop.length = 0; this.histSpec.length = 0; this.histTemp.length = 0;
    this.selected = null; this.followed = null; this.plagueActive = 0;
  },

  /* ---------- genomes & brains ---------- */
  randomGenome(diet) {
    const r = this.rand;
    return {
      speed: 0.3 + r() * 0.5, size: 0.25 + r() * 0.5, sense: 0.3 + r() * 0.5,
      diet: diet === undefined ? (r() < 0.72 ? 0 : r() < 0.6 ? 1 : 2) : diet,
      hue: r(), pattern: r(), longev: 0.3 + r() * 0.5, fecund: 0.3 + r() * 0.5,
      aggro: diet === 2 ? 0.6 + r() * 0.4 : r() * 0.5,
    };
  },
  cloneGenome(g) { return { speed: g.speed, size: g.size, sense: g.sense, diet: g.diet, hue: g.hue, pattern: g.pattern, longev: g.longev, fecund: g.fecund, aggro: g.aggro }; },
  mutateGenome(g, amt) {
    const r = this.rand;
    const j = (v) => clamp(v + (r() + r() + r() - 1.5) * amt, 0, 1);
    g.speed = j(g.speed); g.size = j(g.size); g.sense = j(g.sense);
    g.hue = (g.hue + (r() - 0.5) * amt * 2 + 1) % 1; g.pattern = j(g.pattern);
    g.longev = j(g.longev); g.fecund = j(g.fecund); g.aggro = j(g.aggro);
    if (r() < 0.03) g.diet = (r() * 3) | 0;
    return g;
  },
  genDist(a, b) {
    const d = (x, y) => (x - y) * (x - y);
    let hueD = Math.abs(a.hue - b.hue); hueD = Math.min(hueD, 1 - hueD);
    return Math.sqrt(d(a.speed, b.speed) + d(a.size, b.size) + d(a.sense, b.sense) + d(a.longev, b.longev) * 0.7 + d(a.fecund, b.fecund) * 0.5 + hueD * hueD * 1.4 + (a.diet === b.diet ? 0 : 0.55));
  },
  randomBrain() {
    const r = this.rand;
    const w1 = [], b1 = [], w2 = [], b2 = [];
    for (let i = 0; i < 48; i++) w1.push((r() * 2 - 1) * 1.4);
    for (let i = 0; i < 8; i++) b1.push((r() * 2 - 1) * 0.5);
    for (let i = 0; i < 24; i++) w2.push((r() * 2 - 1) * 1.4);
    for (let i = 0; i < 3; i++) b2.push((r() * 2 - 1) * 0.5);
    return { w1, b1, w2, b2 };
  },
  mutateBrain(br, amt) {
    const r = this.rand;
    const m = (arr, n) => { for (let i = 0; i < n; i++) if (r() < 0.35) arr[i] += (r() + r() - 1) * amt; };
    m(br.w1, 48); m(br.b1, 8); m(br.w2, 24); m(br.b2, 3);
  },
  brainOut(br, inp, out) {
    // 6 -> 8 tanh -> 3 (tanh, sigmoid, sigmoid)
    let h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0;
    const w1 = br.w1;
    const i0 = inp[0], i1 = inp[1], i2 = inp[2], i3 = inp[3], i4 = inp[4], i5 = inp[5];
    h0 = Math.tanh(w1[0]*i0+w1[1]*i1+w1[2]*i2+w1[3]*i3+w1[4]*i4+w1[5]*i5+br.b1[0]);
    h1 = Math.tanh(w1[6]*i0+w1[7]*i1+w1[8]*i2+w1[9]*i3+w1[10]*i4+w1[11]*i5+br.b1[1]);
    h2 = Math.tanh(w1[12]*i0+w1[13]*i1+w1[14]*i2+w1[15]*i3+w1[16]*i4+w1[17]*i5+br.b1[2]);
    h3 = Math.tanh(w1[18]*i0+w1[19]*i1+w1[20]*i2+w1[21]*i3+w1[22]*i4+w1[23]*i5+br.b1[3]);
    h4 = Math.tanh(w1[24]*i0+w1[25]*i1+w1[26]*i2+w1[27]*i3+w1[28]*i4+w1[29]*i5+br.b1[4]);
    h5 = Math.tanh(w1[30]*i0+w1[31]*i1+w1[32]*i2+w1[33]*i3+w1[34]*i4+w1[35]*i5+br.b1[5]);
    h6 = Math.tanh(w1[36]*i0+w1[37]*i1+w1[38]*i2+w1[39]*i3+w1[40]*i4+w1[41]*i5+br.b1[6]);
    h7 = Math.tanh(w1[42]*i0+w1[43]*i1+w1[44]*i2+w1[45]*i3+w1[46]*i4+w1[47]*i5+br.b1[7]);
    const w2 = br.w2;
    out[0] = Math.tanh(w2[0]*h0+w2[3]*h1+w2[6]*h2+w2[9]*h3+w2[12]*h4+w2[15]*h5+w2[18]*h6+w2[21]*h7+br.b2[0]);
    out[1] = 1 / (1 + Math.exp(-(w2[1]*h0+w2[4]*h1+w2[7]*h2+w2[10]*h3+w2[13]*h4+w2[16]*h5+w2[19]*h6+w2[22]*h7+br.b2[1])));
    out[2] = 1 / (1 + Math.exp(-(w2[2]*h0+w2[5]*h1+w2[8]*h2+w2[11]*h3+w2[14]*h4+w2[17]*h5+w2[20]*h6+w2[23]*h7+br.b2[2])));
    return out;
  },

  /* ---------- species ---------- */
  makeSpecies(founderGen, parentId, diet) {
    const sp = {
      id: this.nextSpId++, name: genSpeciesName(this.rand, founderGen.diet),
      parent: parentId || 0, founder: this.cloneGenome(founderGen),
      born: World.day, extinct: -1, count: 0, totalBorn: 0, maxPop: 0,
    };
    this.species.push(sp);
    return sp;
  },
  speciesById(id) { for (let i = 0; i < this.species.length; i++) if (this.species[i].id === id) return this.species[i]; return null; },
  aliveSpecies() { return this.species.filter(s => s.extinct < 0 && s.count > 0); },

  /* ---------- seeding ---------- */
  randomLand() {
    for (let t = 0; t < 60; t++) {
      const x = this.rand() * World.W, y = (0.12 + this.rand() * 0.76) * World.H;
      const i = World.idx(x | 0, clamp(y | 0, 0, World.H - 1));
      if (!World.isWater(i) && World.tmp[i] > 2) return { x, y };
    }
    return { x: World.W / 2, y: World.H / 2 };
  },
  spawn(gen, brain, x, y, spId) {
    if (this.creatures.length >= 650) return null;
    const c = {
      cid: this.nextCid++, x, y, vx: 0, vy: 0, ang: this.rand() * TAU(),
      energy: 55 + this.rand() * 25, age: 0, gen, brain, sp: spId,
      inp: [0,0,0,0,0.5,0], out: [0,0.5,0.5], senseTick: (this.nextCid % 3),
      sick: 0, drown: 0, reproCool: 20 + this.rand() * 30, flash: 0,
    };
    this.creatures.push(c);
    const sp = this.speciesById(spId);
    if (sp) { sp.totalBorn++; }
    this.births++;
    return c;
  },
  seedLife(nH, nP) {
    const herb = this.makeSpecies(this.randomGenome(0), 0);
    const herbB = this.randomBrain();
    for (let k = 0; k < nH; k++) { const p = this.randomLand(); const g = this.mutateGenome(this.cloneGenome(herb.founder), 0.25); this.spawn(g, this.randomBrain(), p.x, p.y, herb.id); }
    this.addEvent('good', '🌱 ' + pick(this.rand, FIRST_LIFE));
    if (nP > 0) {
      const pred = this.makeSpecies(this.randomGenome(2), 0);
      for (let k = 0; k < nP; k++) { const p = this.randomLand(); const g = this.mutateGenome(this.cloneGenome(pred.founder), 0.2); this.spawn(g, this.randomBrain(), p.x, p.y, pred.id); }
    }
    void herbB;
  },

  addEvent(kind, text) {
    this.events.unshift({ day: World.day, year: World.year(), kind, text });
    if (this.events.length > 220) this.events.pop();
  },

  /* ---------- spatial grid ---------- */
  rebuildGrid() {
    const gw = Math.ceil(World.W / this.cell), gh = Math.ceil(World.H / this.cell);
    this.gridW = gw; this.gridH = gh;
    if (!this.grid || this.grid.length !== gw * gh) this.grid = new Array(gw * gh);
    else for (let i = 0; i < this.grid.length; i++) this.grid[i] = undefined;
    for (let k = 0; k < this.creatures.length; k++) {
      const c = this.creatures[k];
      const gx = clamp((c.x / this.cell) | 0, 0, gw - 1), gy = clamp((c.y / this.cell) | 0, 0, gh - 1);
      const gi = gy * gw + gx;
      if (!this.grid[gi]) this.grid[gi] = [];
      this.grid[gi].push(c);
    }
  },
  nearestOther(c, wantPredatorOfMe) {
    // returns {c, d2} — prey for hunters, threat for prey
    const gw = this.gridW, gh = this.gridH;
    const gx = clamp((c.x / this.cell) | 0, 0, gw - 1), gy = clamp((c.y / this.cell) | 0, 0, gh - 1);
    const sense = 4 + c.gen.sense * 11;
    const R = Math.ceil(sense / this.cell);
    let best = null, bd = sense * sense;
    const mySize = c.gen.size;
    for (let yy = gy - R; yy <= gy + R; yy++) {
      if (yy < 0 || yy >= gh) continue;
      for (let xx = gx - R; xx <= gx + R; xx++) {
        if (xx < 0 || xx >= gw) continue;
        const cell = this.grid[yy * gw + xx];
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const o = cell[k];
          if (o === c) continue;
          const dx = o.x - c.x, dy = o.y - c.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > bd) continue;
          if (!wantPredatorOfMe) {
            // am I hunting o? need diet>0 and I'm bigger-ish
            if (c.gen.diet === 0) continue;
            if (c.gen.diet === 1 && o.gen.size > mySize + 0.12) continue;
            if (o.gen.size > mySize + 0.3) continue;
            best = o; bd = d2;
          } else {
            // is o a threat to me?
            if (o.gen.diet === 0) continue;
            if (mySize > o.gen.size + 0.3) continue;
            best = o; bd = d2;
          }
        }
      }
    }
    return best ? { c: best, d: Math.sqrt(bd), sense } : null;
  },

  plantSense(c) {
    // sample 8 directions at sense range, return best {ang, amt}
    const sense = 3 + c.gen.sense * 9;
    let bestA = 0, bestV = -1;
    for (let d = 0; d < 8; d++) {
      const a = c.ang + (d / 8) * TAU();
      const px = clamp(Math.round(c.x + Math.cos(a) * sense), 0, World.W - 1);
      const py = clamp(Math.round(c.y + Math.sin(a) * sense), 0, World.H - 1);
      const v = World.plant[py * World.W + px];
      if (v > bestV) { bestV = v; bestA = a; }
    }
    return { ang: bestA, amt: bestV < 0 ? 0 : bestV, sense };
  },

  /* ---------- main tick ---------- */
  tick(dt) {
    const W = World.W, H = World.H;
    const rand = this.rand;
    this.rebuildGrid();
    const out = [0, 0, 0];
    const maxC = this.creatures.length;

    for (let idx = maxC - 1; idx >= 0; idx--) {
      const c = this.creatures[idx];
      const g = c.gen;
      const speedMax = 2.2 + g.speed * 5.2;
      const tx = clamp(c.x | 0, 0, W - 1), ty = clamp(c.y | 0, 0, H - 1);
      const ti = ty * W + tx;
      const inWater = World.isWater(ti);
      const temp = World.tmp[ti];

      // staggered sensing (cheap)
      c.senseTick -= dt;
      if (c.senseTick <= 0) {
        c.senseTick = 2 + rand() * 2;
        let foodDir = 0, foodNear = 0, dangDir = 0, dangNear = 0;
        if (g.diet < 2) {
          const ps = this.plantSense(c);
          let da = ps.ang - c.ang;
          while (da > Math.PI) da -= TAU(); while (da < -Math.PI) da += TAU();
          foodDir = clamp(da / 1.2, -1, 1);
          foodNear = clamp(ps.amt * 1.6, 0, 1);
        } else {
          const prey = this.nearestOther(c, false);
          if (prey) {
            let da = Math.atan2(prey.c.y - c.y, prey.c.x - c.x) - c.ang;
            while (da > Math.PI) da -= TAU(); while (da < -Math.PI) da += TAU();
            foodDir = clamp(da / 1.2, -1, 1);
            foodNear = clamp(1 - prey.d / prey.sense, 0, 1);
            c.hunt = prey.c;
          } else { c.hunt = null; foodNear = 0; }
        }
        if (g.diet === 2 && rand() < 0.3 && c.hunt) { /* keep */ }
        else if (g.diet < 2 || true) {
          const th = this.nearestOther(c, true);
          if (th) {
            let da = Math.atan2(th.c.y - c.y, th.c.x - c.x) - c.ang;
            while (da > Math.PI) da -= TAU(); while (da < -Math.PI) da += TAU();
            dangDir = clamp(da / 1.2, -1, 1);
            dangNear = clamp(1 - th.d / th.sense, 0, 1);
          } else { dangNear = 0; }
          if (g.diet < 2 && !c.hunt) {
            const maybePrey = (g.diet === 1 && rand() < 0.25) ? this.nearestOther(c, false) : null;
            if (maybePrey) c.hunt = maybePrey.c;
          }
        }
        c.inp[0] = foodDir; c.inp[1] = foodNear; c.inp[2] = dangDir; c.inp[3] = dangNear;
        c.inp[4] = clamp(c.energy / 100, 0, 1);
        const life = 120 + g.longev * 480;
        c.inp[5] = clamp(c.age / life, 0, 1);
      }

      this.brainOut(c.brain, c.inp, out);
      c.out[0] = out[0]; c.out[1] = out[1]; c.out[2] = out[2];

      // movement
      const turn = out[0] * (0.9 + g.speed * 1.4);
      c.ang += turn * dt * 3.2;
      let thrust = out[1];
      // fear override: flee threat
      if (c.inp[3] > 0.25) {
        const flee = c.inp[2] > 0 ? -1 : 1;
        c.ang += flee * c.inp[3] * dt * 4;
        thrust = Math.max(thrust, 0.75);
      }
      const acc = thrust * (3.5 + g.speed * 9);
      c.vx += Math.cos(c.ang) * acc * dt;
      c.vy += Math.sin(c.ang) * acc * dt;
      const fr = inWater ? 0.90 : 0.94;
      c.vx *= fr; c.vy *= fr;
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > speedMax) { c.vx *= speedMax / sp; c.vy *= speedMax / sp; }
      c.x += c.vx * dt * 3; c.y += c.vy * dt * 3;
      if (c.x < 1) { c.x = 1; c.vx = Math.abs(c.vx); }
      if (c.y < 1) { c.y = 1; c.vy = Math.abs(c.vy); }
      if (c.x > W - 2) { c.x = W - 2; c.vx = -Math.abs(c.vx); }
      if (c.y > H - 2) { c.y = H - 2; c.vy = -Math.abs(c.vy); }

      // water hazard — the sea is survivable but costly; the shore pulls back
      if (inWater) {
        c.drown += dt;
        const deep = World.elev[ti] < World.seaLevel - 0.10;
        c.energy -= (deep ? 1.1 : 0.45) * dt;
        // steer to shore: sample uphill
        {
          let bx = 0, by = 0;
          const ex = World.elev[ti];
          if (tx + 1 < W && World.elev[ti + 1] > ex) bx += 1;
          if (tx - 1 >= 0 && World.elev[ti - 1] > ex) bx -= 1;
          if (ty + 1 < H && World.elev[ti + W] > ex) by += 1;
          if (ty - 1 >= 0 && World.elev[ti - W] > ex) by -= 1;
          if (bx || by) { const want = Math.atan2(by, bx); let da = want - c.ang; while (da > Math.PI) da -= TAU(); while (da < -Math.PI) da += TAU(); c.ang += clamp(da, -1, 1) * dt * 3.2; }
        }
        if (c.drown > 60) { this.kill(idx, 'drowned'); continue; }
      } else c.drown = Math.max(0, c.drown - dt * 3);

      // fire hurts
      if (World.fire[ti] > 0.1) { c.energy -= 14 * dt * World.fire[ti]; c.flash = 1; if (c.energy <= 0) { this.kill(idx, 'burned'); continue; } }

      // eating
      const urge = out[2];
      if (urge > 0.45) {
        if (g.diet < 2) {
          const avail = World.plant[ti];
          if (avail > 0.02) {
            const bite = Math.min(avail, (0.10 + g.size * 0.22) * urge * dt * 3);
            World.plant[ti] = avail - bite;
            const tSuitE = clamp(1 - Math.abs(temp - 21) / 30, 0.3, 1);
            c.energy += bite * 23 * tSuitE * (1.15 - g.size * 0.4);
          }
        }
        if (g.diet > 0) {
          const prey = c.hunt;
          if (prey && prey.energy > 0) {
            const dx = prey.x - c.x, dy = prey.y - c.y;
            if (dx * dx + dy * dy < 1.7 + g.size * 3.4) {
              const dmg = (6 + g.size * 22 + g.aggro * 14) * urge * dt * 3;
              prey.energy -= dmg;
              c.energy += dmg * 0.55;
              prey.flash = 1;
              if (prey.energy <= 0) {
                const pi = this.creatures.indexOf(prey);
                if (pi >= 0) { this.kill(pi, 'eaten'); if (pi < idx) idx--; }
                c.energy = Math.min(110, c.energy + 14);
                c.hunt = null;
              }
            } else if (prey.energy > 0) {
              // chase
              const want = Math.atan2(dy, dx);
              let da = want - c.ang; while (da > Math.PI) da -= TAU(); while (da < -Math.PI) da += TAU();
              c.ang += clamp(da, -1, 1) * dt * 3.5;
              c.vx += Math.cos(c.ang) * acc * dt * 0.7; c.vy += Math.sin(c.ang) * acc * dt * 0.7;
            }
          } else if (urge > 0.7) c.hunt = null;
        }
      }

      // metabolism
      const tempMod = temp < 0 ? 1.35 : temp > 34 ? 1.25 : 1;
      const moveCost = (c.vx * c.vx + c.vy * c.vy) * 0.045 * (0.6 + g.size);
      const base = (0.55 + g.size * 1.5 + g.sense * 0.35 + g.speed * 0.5) * tempMod;
      c.energy -= (base + moveCost) * dt;
      if (c.sick > 0) { c.sick -= dt; c.energy -= 3.2 * dt; }
      c.age += dt;
      c.reproCool -= dt;
      if (c.flash > 0) c.flash -= dt * 4;
      c.energy = Math.min(c.energy, 115);

      // death
      const lifespan = 130 + g.longev * 500;
      if (c.energy <= 0) { this.kill(idx, 'starved'); continue; }
      if (c.age > lifespan * (0.85 + (c.cid % 7) * 0.05)) { this.kill(idx, 'age'); continue; }

      // reproduction
      const thresh = 72 + g.size * 36 - g.fecund * 20;
      if (c.energy > thresh && c.age > 26 && c.reproCool <= 0 && this.creatures.length < 650) {
        c.energy *= 0.52;
        c.reproCool = 40 - g.fecund * 26;
        const childGen = this.mutateGenome(this.cloneGenome(g), 0.03 + (1 - g.fecund) * 0.02);
        const childBrain = { w1: c.brain.w1.slice(), b1: c.brain.b1.slice(), w2: c.brain.w2.slice(), b2: c.brain.b2.slice() };
        this.mutateBrain(childBrain, 0.35);
        const parentSp = this.speciesById(c.sp);
        let spId = c.sp;
        if (parentSp && this.genDist(childGen, parentSp.founder) > 0.28) {
          const ns = this.makeSpecies(childGen, parentSp.id, childGen.diet);
          spId = ns.id;
          this.addEvent('good', '🧬 <b>' + esc(ns.name) + '</b> ' + pick(rand, SPEC_TXT) + ' Split from <i>' + esc(parentSp.name) + '</i>.');
          if (UI && UI.toast) UI.toast('New species: ' + ns.name, 'descendant of ' + parentSp.name);
          if (UI) UI.dirtySpecies = true;
        }
        const ch = this.spawn(childGen, childBrain, c.x + (rand() - 0.5) * 2, c.y + (rand() - 0.5) * 2, spId);
        if (ch) { ch.energy = 38; }
      }
    }

    // plague spread
    if (this.plagueActive > 0) {
      this.plagueActive -= dt;
      for (let k = 0; k < this.creatures.length; k++) {
        const c = this.creatures[k];
        if (c.sick > 0 && rand() < dt * 0.8) {
          const n = this.nearestOther(c, false) || this.nearestOther(c, true);
          void n;
          // infect random neighbour in grid cell
          const gx = clamp((c.x / this.cell) | 0, 0, this.gridW - 1), gy = clamp((c.y / this.cell) | 0, 0, this.gridH - 1);
          const cell = this.grid[gy * this.gridW + gx];
          if (cell) for (let j = 0; j < cell.length; j++) { if (rand() < 0.25 && cell[j].sick <= 0) cell[j].sick = 14 + rand() * 14; }
        }
      }
    }

    this.recount(dt);
    // spores on the solar wind: a sterile world never stays sterile forever
    if (this.creatures.length === 0) {
      this.emptyT = (this.emptyT || 0) + dt;
      if (this.emptyT > 18) {
        this.emptyT = 0;
        this.seedLife(14, 0);
        this.addEvent('good', '☄ Spores ride the solar wind. <b>Life returns</b> to a silent world.');
        if (UI) { UI.dirtySpecies = true; UI.toast('Life returns', 'spores from the stars reseed the world'); }
      }
    } else this.emptyT = 0;
  },

  kill(idx, cause) {
    const c = this.creatures[idx];
    // fertilise soil
    const tx = clamp(c.x | 0, 0, World.W - 1), ty = clamp(c.y | 0, 0, World.H - 1);
    const ti = ty * World.W + tx;
    World.fert[ti] = clamp(World.fert[ti] + 0.06 + c.gen.size * 0.1, 0, 1);
    if (this.selected === c) this.selected = null;
    if (this.followed === c) { this.followed = null; if (UI) UI.updateFollowChip(); }
    // swap-remove
    this.creatures[idx] = this.creatures[this.creatures.length - 1];
    this.creatures.pop();
    this.deaths++;
  },

  recount(dt) {
    // species counts every tick (cheap: species count small)
    for (let s = 0; s < this.species.length; s++) this.species[s].count = 0;
    for (let k = 0; k < this.creatures.length; k++) {
      const sp = this.speciesById(this.creatures[k].sp);
      if (sp) sp.count++;
    }
    let alive = 0;
    for (let s = 0; s < this.species.length; s++) {
      const sp = this.species[s];
      if (sp.count > sp.maxPop) sp.maxPop = sp.count;
      if (sp.count > 0) alive++;
      else if (sp.extinct < 0 && sp.totalBorn > 0) {
        sp.extinct = World.day;
        this.extinctions++;
        this.addEvent('bad', '💀 <b>' + esc(sp.name) + '</b> ' + pick(this.rand, EXT_TXT));
        if (UI) { UI.dirtySpecies = true; UI.toast('Extinction: ' + sp.name, 'lived ' + Math.round(sp.extinct - sp.born) + ' days · peak ' + sp.maxPop, 'bad'); }
      }
    }
    this.histTick -= dt;
    // wall-clock sampling so charts cover ~5 minutes at any warp speed
    if (typeof Main !== 'undefined' && (Main.frameNo & 31) === 0 && this._lastHistFrame !== Main.frameNo) {
      this._lastHistFrame = Main.frameNo;
      this.histPop.push(this.creatures.length);
      this.histSpec.push(alive);
      this.histTemp.push(World.meanTemp);
      if (this.histPop.length > 600) { this.histPop.shift(); this.histSpec.shift(); this.histTemp.shift(); }
      if (UI) UI.dirtyCharts = true;
    }
    this._alive = alive;
  },
  aliveCount() { return this._alive || 0; },

  releaseAt(tx, ty, diet, n) {
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const x = tx + (this.rand() - 0.5) * 8, y = ty + (this.rand() - 0.5) * 8;
      if (x < 1 || y < 1 || x >= World.W - 1 || y >= World.H - 1) continue;
      const i = World.idx(x | 0, y | 0);
      if (World.isWater(i)) continue;
      // find a matching living species or found one
      let sp = null;
      const alive = this.aliveSpecies().filter(s => this.speciesById(s.id) && this.speciesById(s.id).founder.diet === diet);
      if (alive.length && this.rand() < 0.7) sp = alive[(this.rand() * alive.length) | 0];
      else { const g0 = this.randomGenome(diet); sp = this.makeSpecies(g0, 0); this.addEvent('god', '✦ The gods release <b>' + esc(sp.name) + '</b> upon the world.'); }
      const g = this.mutateGenome(this.cloneGenome(sp.founder), 0.15);
      this.spawn(g, this.randomBrain(), x, y, sp.id);
      placed++;
    }
    return placed;
  },

  plagueAt(tx, ty, r) {
    let n = 0;
    for (const c of this.creatures) {
      if ((c.x - tx) * (c.x - tx) + (c.y - ty) * (c.y - ty) < r * r) { c.sick = 16 + this.rand() * 14; n++; }
    }
    this.plagueActive = Math.max(this.plagueActive, 40);
    return n;
  },
};
