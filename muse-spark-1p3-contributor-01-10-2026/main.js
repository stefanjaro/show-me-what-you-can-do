/* PRIMORDIA main: genesis, time loop, catastrophes. */
'use strict';

const Main = {
  seedStr: 'EDEN', frameNo: 0, acc: 0,

  boot() {
    Renderer.init(el('world'));
    UI.init();
    UI.updatePlayBtn();
    // seed from URL hash?
    let seed = null, preset = 'paradise';
    try {
      const h = location.hash;
      const m1 = h.match(/seed=([^&]+)/), m2 = h.match(/preset=([a-z]+)/);
      if (m1) seed = decodeURIComponent(m1[1]);
      if (m2 && ['paradise', 'archipelago', 'pangaea'].includes(m2[1])) preset = m2[1];
    } catch (e) { /* ignore */ }
    if (!seed) seed = (Math.random().toString(36).slice(2, 8)).toUpperCase();
    el('seedInput').value = seed;
    document.querySelectorAll('.preset').forEach(x => x.classList.toggle('sel', x.dataset.p === preset));
    this.newWorld(seed, preset, true);
    // intro visible on first visit; returning visitors with a hash jump straight in
    if (seed && location.hash.includes('seed=')) el('intro').classList.add('gone');
    requestAnimationFrame(() => this.loop());
    // welcome hints
    setTimeout(() => { if (!el('intro').classList.contains('gone')) return; UI.toast('Welcome, god of ' + World.name, 'drag to pan · scroll to zoom · ◉ to inspect life'); }, 1200);
  },

  newWorld(seedStr, preset, silent) {
    this.seedStr = (seedStr || 'EDEN').toUpperCase().slice(0, 16);
    World.init(this.seedStr, preset);
    Life.init(World.seed);
    Renderer.cam.x = World.W / 2; Renderer.cam.y = World.H / 2; Renderer.cam.z = 1;
    for (let d = 0; d < 30; d++) { World.day += 0.25; World.tickClimate(0.25); World.tickPlants(0.5, Life.rand); }
    World.day = 0;
    Life.seedLife(30, 7);
    World.effects.push({ kind: 'genesis', x: World.W / 2, y: World.H / 2, r: 90, t: 0, dur: 2.4 });
    Life.addEvent('god', '✦ <b>' + esc(World.name) + '</b> condenses from dust. Continents cool, rains gather, and the first cells divide.');
    UI.dirtySpecies = true; UI.dirtyCharts = true; UI.lastLogLen = -1;
    Life.selected = null; Life.followed = null; UI.updateFollowChip();
    UI.refreshFocus();
    try { history.replaceState(null, '', '#seed=' + encodeURIComponent(this.seedStr) + '&preset=' + World.preset); } catch (e) {}
    if (!silent) {
      UI.toast('World awakened: ' + World.name, 'seed ' + this.seedStr + ' · ' + World.preset);
      AudioEngine.chime();
    }
  },

  strikeAt(wx, wy, kind) {
    const tx = clamp(Math.round(wx), 2, World.W - 3), ty = clamp(Math.round(wy), 2, World.H - 3);
    if (kind === 'meteor') {
      World.meteor(tx, ty, 5 + Math.random() * 3);
      // kill creatures in blast
      let dead = 0;
      for (let i = Life.creatures.length - 1; i >= 0; i--) {
        const c = Life.creatures[i];
        const d = Math.hypot(c.x - tx, c.y - ty);
        if (d < 12) { Life.kill(i, 'impact'); dead++; }
        else if (d < 22 && Life.rand() < 0.5) { c.energy -= 30; c.flash = 1; }
      }
      Life.addEvent('bad', '☄ ' + pick(Life.rand, METEOR_TXT) + ' <b>' + dead + ' creatures perish</b> in fire and dust.');
      UI.toast('Meteor impact', dead + ' dead · fires rage · ash fertilises the soil', 'god');
      AudioEngine.boom();
    } else {
      World.volcano(tx, ty);
      Life.addEvent('god', '🌋 A new volcano tears open the crust. Lava takes, ash gives back.');
      UI.toast('Volcano erupts', 'fire now · fertile fields later', 'god');
      AudioEngine.boom();
    }
    UI.dirtyLog = true;
  },

  strikeRandom(kind) {
    for (let t = 0; t < 40; t++) {
      const x = 10 + Life.rand() * (World.W - 20), y = 10 + Life.rand() * (World.H - 20);
      if (!World.isWater(World.idx(x | 0, y | 0))) { this.strikeAt(x, y, kind || 'meteor'); return; }
    }
    this.strikeAt(World.W / 2, World.H / 2, kind || 'meteor');
  },

  stepDays(n) {
    const steps = Math.round(n / 0.25);
    for (let k = 0; k < steps; k++) this.tickOnce(0.25);
    UI.dirtyCharts = true; UI.frame();
  },

  tickOnce(dt) {
    World.day += dt;
    if ((this.frameNo & 1) === 0) World.tickClimate(dt);
    else World.tickClimate(0); // cheap weather-only? full is fine at half rate
    if ((this._pt = !this._pt)) World.tickPlants(dt * 2, Life.rand);
    Life.tick(dt);
  },

  loop() {
    requestAnimationFrame(() => this.loop());
    this.frameNo++;
    if (UI.playing) {
      const target = { 1: 8, 4: 30, 12: 90, 40: 300 }[UI.speed] || 30;
      const ticks = Math.min(UI.speed >= 40 ? 16 : UI.speed >= 12 ? 8 : UI.speed >= 4 ? 3 : 1, 16);
      const dt = (target / 60) / ticks;
      for (let k = 0; k < ticks; k++) this.tickOnce(dt);
      // spontaneous wildfires in hot dry forests
      if ((this.frameNo & 63) === 0 && World.meanTemp > 24) {
        for (let t = 0; t < 6; t++) {
          const x = (Life.rand() * World.W) | 0, y = (Life.rand() * World.H) | 0;
          const i = y * World.W + x;
          if (!World.isWater(i) && World.plant[i] > 0.6 && World.rain[i] < 0.1 && Life.rand() < 0.3) { World.fire[i] = 0.8; break; }
        }
      }
    }
    // audio + render always
    const isDay = Renderer.nightAlpha() < 0.4;
    let herbs = 0;
    for (const c of Life.creatures) if (c.gen.diet === 0) herbs++;
    AudioEngine.update(1 / 60, herbs, isDay);
    Renderer.draw();
    if ((this.frameNo % 6) === 0) UI.frame();
  },
};

window.addEventListener('DOMContentLoaded', () => Main.boot());
