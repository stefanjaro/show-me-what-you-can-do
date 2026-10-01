/* PRIMORDIA UI: god tools, census, DNA lab, chronicle, transport, persistence. */
'use strict';

const UI = {
  tool: 'inspect', brushSize: 4, painting: false,
  speed: 4, playing: true,
  dirtySpecies: true, dirtyCharts: true, dirtyLog: true,
  lastLogLen: -1, geneEdits: null,

  init() {
    // toolbar
    document.querySelectorAll('#toolbar .tool').forEach(b => {
      b.addEventListener('click', () => this.setTool(b.dataset.tool));
    });
    el('brush').addEventListener('input', e => { this.brushSize = +e.target.value; });
    // transport
    el('btnPlay').addEventListener('click', () => this.togglePlay());
    el('btnStep').addEventListener('click', () => { this.playing = false; this.updatePlayBtn(); Main.stepDays(1); });
    document.querySelectorAll('.spd').forEach(b => b.addEventListener('click', () => {
      this.speed = +b.dataset.s;
      document.querySelectorAll('.spd').forEach(x => x.classList.toggle('active', x === b));
    }));
    // top
    el('btnGenesis').addEventListener('click', () => el('intro').classList.remove('gone'));
    el('btnNew').addEventListener('click', () => el('intro').classList.remove('gone'));
    el('btnSave').addEventListener('click', () => this.save());
    el('btnShare').addEventListener('click', () => this.share());
    el('btnSound').addEventListener('click', (e) => {
      const on = AudioEngine.toggle();
      e.target.textContent = on ? '🔊' : '🔈';
      if (on) this.toast('Soundscape on', 'generative music by the ecosystem');
    });
    el('btnHelp').addEventListener('click', () => this.showHelp());
    el('btnPanel').addEventListener('click', () => el('panel').classList.toggle('hidden'));
    el('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') el('modal').classList.remove('open'); });
    // tabs
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tabbody').forEach(b => b.classList.toggle('active', b.id === 'tab-' + t.dataset.tab));
    }));
    // census buttons
    el('btnReseed').addEventListener('click', () => { Life.seedLife(26, 6); this.toast('Life reseeded', 'new founders walk the earth', 'god'); this.dirtySpecies = true; });
    el('btnShot').addEventListener('click', () => this.screenshot());
    // dna buttons
    el('btnApplyGenes').addEventListener('click', () => this.applyGenes());
    el('btnFollow').addEventListener('click', () => {
      if (Life.selected) { Life.followed = Life.followed === Life.selected ? null : Life.selected; this.updateFollowChip(); }
    });
    el('btnKill').addEventListener('click', () => {
      if (Life.selected) { const i = Life.creatures.indexOf(Life.selected); if (i >= 0) Life.kill(i, 'god'); Life.selected = null; this.refreshFocus(); }
    });
    // planet sliders
    el('sWarm').addEventListener('input', e => { World.warmth = +e.target.value; el('oWarm').textContent = (World.warmth >= 0 ? '+' : '') + World.warmth.toFixed(1) + '°'; });
    el('sRain').addEventListener('input', e => { World.rainfall = +e.target.value / 100; el('oRain').textContent = e.target.value + '%'; });
    el('sSea').addEventListener('input', e => { World.seaLevel = World.baseSea + (+e.target.value) / 100; el('oSea').textContent = (e.target.value >= 0 ? '+' : '') + e.target.value + 'm'; });
    el('sTilt').addEventListener('input', e => { World.tilt = +e.target.value / 100; el('oTilt').textContent = World.tilt < 0.3 ? 'eternal spring' : World.tilt < 0.9 ? 'mild' : World.tilt < 1.4 ? 'normal' : 'extreme'; });
    el('btnMeteor').addEventListener('click', () => Main.strikeRandom('meteor'));
    el('btnVolcano').addEventListener('click', () => Main.strikeRandom('volcano'));
    el('btnIce').addEventListener('click', () => this.toggleIce());
    el('btnExport').addEventListener('click', () => this.exportDNA());
    // presets + awaken
    document.querySelectorAll('.preset').forEach(p => p.addEventListener('click', () => {
      document.querySelectorAll('.preset').forEach(x => x.classList.toggle('sel', x === p));
    }));
    el('btnDice').addEventListener('click', () => { el('seedInput').value = (Math.random().toString(36).slice(2, 8)).toUpperCase(); });
    el('awaken').addEventListener('click', () => {
      const preset = (document.querySelector('.preset.sel') || {}).dataset?.p || 'paradise';
      const seed = el('seedInput').value.trim() || (Math.random().toString(36).slice(2, 8)).toUpperCase();
      Main.newWorld(seed, preset);
      el('intro').classList.add('gone');
    });
    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.togglePlay(); }
      const map = { v: 'inspect', r: 'raise', e: 'lower', f: 'forest', h: 'herbivore', c: 'predator', n: 'rain', x: 'fire', m: 'meteor', p: 'plague', i: 'iceage' };
      if (map[k]) this.setTool(map[k]);
      if (k === '1') this.speed = 1; if (k === '2') this.speed = 4; if (k === '3') this.speed = 12; if (k === '4') this.speed = 40;
      if (['1','2','3','4'].includes(k)) document.querySelectorAll('.spd').forEach(x => x.classList.toggle('active', +x.dataset.s === this.speed));
      if (k === 'escape' && Life.followed) { Life.followed = null; this.updateFollowChip(); }
    });
    // canvas paint start flag
    Renderer.canvas.addEventListener('pointerdown', () => { if (this.tool !== 'inspect') this.painting = true; });
  },

  setTool(t) {
    if (t === 'iceage') { this.toggleIce(); return; }
    this.tool = t;
    document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    Renderer.canvas.style.cursor = t === 'inspect' ? 'crosshair' : 'cell';
  },

  toggleIce() {
    World.iceAge = !World.iceAge;
    Life.addEvent('god', World.iceAge ? '❄ The gods dim the sun. <b>An ice age begins.</b> Only the cold-hardy will endure.' : '☀ The sun returns. <b>The ice age ends.</b> Meltwater floods the lowlands.');
    this.toast(World.iceAge ? 'Ice age begins' : 'Ice age ends', World.iceAge ? 'global −11° · adapt or die' : 'the thaw has come', 'god');
    this.dirtyLog = true;
  },

  togglePlay() { this.playing = !this.playing; this.updatePlayBtn(); },
  updatePlayBtn() { el('btnPlay').textContent = this.playing ? '⏸' : '▶'; el('btnPlay').classList.toggle('play', this.playing); },

  paintAt(wx, wy) {
    const r = this.brushSize * 0.9;
    const t = this.tool;
    if (t === 'raise' || t === 'lower' || t === 'forest' || t === 'rain' || t === 'fire') {
      World.brushApply(wx, wy, r, t, Life.rand);
    } else if (t === 'herbivore' || t === 'predator') {
      if (!this._relT || performance.now() - this._relT > 350) {
        this._relT = performance.now();
        const n = Life.releaseAt(wx, wy, t === 'herbivore' ? 0 : 2, 5);
        if (n) { this.toast(t === 'herbivore' ? 'Grazers released' : 'Hunters released', n + ' creatures walk the earth', 'god'); this.dirtySpecies = true; }
      }
    } else if (t === 'meteor') {
      if (!this._metT || performance.now() - this._metT > 900) {
        this._metT = performance.now();
        Main.strikeAt(wx, wy, 'meteor');
      }
      this.painting = false;
    } else if (t === 'plague') {
      const n = Life.plagueAt(wx, wy, r);
      this.toast('Plague unleashed', n + ' creatures infected', 'bad');
      this.painting = false;
    }
  },

  clickAt(wx, wy) {
    if (this.tool !== 'inspect') { this.paintAt(wx, wy); if (this.tool === 'meteor' || this.tool === 'plague') return; if (this.tool !== 'herbivore' && this.tool !== 'predator') return; }
    // select nearest creature within 3 tiles
    let best = null, bd = 9;
    for (const c of Life.creatures) {
      const d2 = (c.x - wx) * (c.x - wx) + (c.y - wy) * (c.y - wy);
      if (d2 < bd) { bd = d2; best = c; }
    }
    Life.selected = best;
    if (best) {
      const sp = Life.speciesById(best.sp);
      this.toast(sp ? sp.name : 'creature', 'energy ' + Math.round(best.energy) + ' · age ' + Math.round(best.age) + 'd');
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'dna'));
      document.querySelectorAll('.tabbody').forEach(b => b.classList.toggle('active', b.id === 'tab-dna'));
      if (window.innerWidth < 900) el('panel').classList.remove('hidden');
    }
    this.refreshFocus();
  },

  /* ---------- toasts ---------- */
  toast(title, sub, kind) {
    const box = el('toasts');
    while (box.children.length > 4) box.removeChild(box.firstChild);
    const d = document.createElement('div');
    d.className = 'toast' + (kind === 'bad' ? ' bad' : kind === 'god' ? ' god' : '');
    d.innerHTML = '<b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '');
    box.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, 4600);
  },

  /* ---------- per-frame refresh ---------- */
  frame() {
    // clock
    const yr = World.year();
    el('clock').textContent = 'YR ' + yr + ' · ' + World.seasonName() + ' · DAY ' + World.dayOfYear();
    el('worldName').innerHTML = esc(World.name) + '<em>seed ' + esc(Main.seedStr) + ' · ' + esc(World.preset) + '</em>';
    // stats
    el('stPop').textContent = fmtInt(Life.creatures.length);
    el('stPlant').textContent = fmtInt(World.totalPlant());
    el('stSpec').textContent = Life.aliveCount();
    el('stExt').textContent = Life.extinctions;
    el('stYear').textContent = yr;
    el('stEvents').textContent = Life.events.length;
    el('kvTemp').textContent = World.meanTemp.toFixed(1) + '°C';
    el('kvRain').textContent = Math.round(World.rainfall * 100) + '%';
    el('kvForest').textContent = Math.round(World.forestFrac * 100) + '%';
    el('kvOcean').textContent = Math.round(World.oceanFrac * 100) + '%';
    el('kvSeed').textContent = Main.seedStr;
    el('kvAge').textContent = yr + ' yrs · ' + fmtInt(World.day) + ' days';
    if (this.dirtySpecies) { this.dirtySpecies = false; this.renderSpecies(); this.refreshFocus(); }
    if (Life.events.length !== this.lastLogLen) { this.lastLogLen = Life.events.length; this.renderLog(); }
    if (this.dirtyCharts) { this.dirtyCharts = false; this.drawCharts(); }
    this.refreshFocusLive();
  },

  renderSpecies() {
    const box = el('speciesList');
    const alive = Life.species.filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 30);
    const max = alive.length ? alive[0].count : 1;
    if (!alive.length) { box.innerHTML = '<p class="help">No living species. Press <b>✦ Reseed life</b> — or wait: spores drift on the wind and a new founder may yet arise…</p>'; return; }
    box.innerHTML = alive.map(s => {
      const h = (s.founder.hue * 360) | 0;
      const diet = s.founder.diet === 2 ? 'hunter' : s.founder.diet === 1 ? 'omnivore' : 'grazer';
      return '<div class="species' + (Life.selected && Life.selected.sp === s.id ? ' selected' : '') + '" data-sp="' + s.id + '">' +
        '<span class="dot" style="background:hsl(' + h + ',65%,60%);color:hsl(' + h + ',65%,60%)"></span>' +
        '<span class="nm"><b>' + esc(s.name) + '</b><span>' + diet + ' · ⬢' + s.id + (s.parent ? ' ← ⬢' + s.parent : ' · founder') + '</span>' +
        '<span class="bar"><i style="width:' + Math.round(s.count / max * 100) + '%;background:hsl(' + h + ',65%,55%)"></i></span></span>' +
        '<span class="ct">' + s.count + '</span></div>';
    }).join('');
    box.querySelectorAll('.species').forEach(row => row.addEventListener('click', () => {
      const sp = Life.speciesById(+row.dataset.sp);
      if (sp) {
        const c = Life.creatures.find(c => c.sp === sp.id);
        if (c) { Life.selected = c; Life.followed = null; this.updateFollowChip(); this.refreshFocus(); this.renderSpecies(); }
      }
    }));
  },

  renderLog() {
    const box = el('eventLog');
    box.innerHTML = Life.events.slice(0, 60).map(e =>
      '<div class="event ' + e.kind + '"><time>YR ' + e.year + ' · DAY ' + Math.round(e.day % 360) + '</time>' + e.text + '</div>'
    ).join('') || '<p class="help">Nothing has happened yet. History is waiting to be written.</p>';
  },

  /* ---------- DNA lab ---------- */
  focusCreature() {
    if (Life.selected && Life.selected.energy > 0 && Life.creatures.includes(Life.selected)) return Life.selected;
    if (Life.followed && Life.creatures.includes(Life.followed)) return Life.followed;
    let best = null;
    for (const c of Life.creatures) if (!best || c.energy > best.energy) best = c;
    return best;
  },
  refreshFocus() {
    const c = this.focusCreature();
    if (!c) {
      el('focusName').textContent = 'No life detected';
      el('focusSub').textContent = 'the world is silent… reseed?';
      el('focusStats').innerHTML = '';
      el('geneSliders').innerHTML = '<p class="help">Release or reseed creatures to begin genetic engineering.</p>';
      Renderer.drawPortrait(el('focusPortrait'), null);
      return;
    }
    const sp = Life.speciesById(c.sp);
    el('focusName').textContent = (sp ? sp.name : 'Unknown') + ' #' + c.cid;
    el('focusSub').textContent = (c.gen.diet === 2 ? 'apex hunter' : c.gen.diet === 1 ? 'omnivore' : 'grazer') + ' · E' + Math.round(c.energy) + ' · ' + Math.round(c.age) + 'd';
    Renderer.drawPortrait(el('focusPortrait'), c);
    const G = [
      ['speed', 'Speed', c.gen.speed], ['size', 'Size', c.gen.size], ['sense', 'Senses', c.gen.sense],
      ['longev', 'Longevity', c.gen.longev], ['fecund', 'Fertility', c.gen.fecund], ['aggro', 'Aggression', c.gen.aggro],
      ['hue', 'Pigment', c.gen.hue], ['pattern', 'Pattern', c.gen.pattern],
    ];
    this.geneEdits = {};
    G.forEach(([k, , v]) => this.geneEdits[k] = v);
    this.geneEdits.diet = c.gen.diet;
    el('geneSliders').innerHTML = G.map(([k, lab, v]) =>
      '<div class="sliderRow"><div class="lab"><span>' + lab + '</span><output id="g_' + k + '">' + v.toFixed(2) + '</output></div>' +
      '<input class="gene" data-g="' + k + '" type="range" min="0" max="1" step="0.01" value="' + v + '"></div>'
    ).join('') +
      '<div class="sliderRow"><div class="lab"><span>Diet</span><output>' + ['grazer', 'omnivore', 'hunter'][c.gen.diet] + '</output></div>' +
      '<div class="btnrow"><button class="btn" data-diet="0">🌿 grazer</button><button class="btn" data-diet="1">🍖 omnivore</button><button class="btn" data-diet="2">🦷 hunter</button></div></div>';
    el('geneSliders').querySelectorAll('input[data-g]').forEach(inp => inp.addEventListener('input', () => {
      this.geneEdits[inp.dataset.g] = +inp.value;
      el('g_' + inp.dataset.g).textContent = (+inp.value).toFixed(2);
    }));
    el('geneSliders').querySelectorAll('[data-diet]').forEach(b => b.addEventListener('click', () => {
      this.geneEdits.diet = +b.dataset.diet;
      b.parentElement.querySelectorAll('.btn').forEach(x => x.classList.toggle('go', x === b));
    }));
    this.refreshFocusStats(c);
  },
  refreshFocusStats(c) {
    c = c || this.focusCreature();
    if (!c) return;
    el('focusStats').innerHTML =
      '<div class="kv"><span>Speed / size / sense</span><b>' + c.gen.speed.toFixed(2) + ' · ' + c.gen.size.toFixed(2) + ' · ' + c.gen.sense.toFixed(2) + '</b></div>' +
      '<div class="kv"><span>Drive → turn/thrust/feed</span><b>' + c.out[0].toFixed(2) + ' · ' + c.out[1].toFixed(2) + ' · ' + c.out[2].toFixed(2) + '</b></div>' +
      '<div class="kv"><span>Perception → food/danger</span><b>' + c.inp[1].toFixed(2) + ' · ' + c.inp[3].toFixed(2) + '</b></div>' +
      '<div class="kv"><span>Lineage</span><b>⬢' + c.sp + ' · gen ' + c.cid + '</b></div>';
  },
  refreshFocusLive() {
    const c = this.focusCreature();
    if (!c) return;
    // brain viz: 6 senses + 3 drives
    const bars = el('brainViz');
    if (bars.children.length !== 9) bars.innerHTML = '<i></i>'.repeat(9);
    const vals = [c.inp[0] * 0.5 + 0.5, c.inp[1], c.inp[2] * 0.5 + 0.5, c.inp[3], c.inp[4], c.inp[5], (c.out[0] * 0.5 + 0.5), c.out[1], c.out[2]];
    for (let i = 0; i < 9; i++) bars.children[i].style.height = Math.round(clamp(vals[i], 0, 1) * 100) + '%';
    if ((Main.frameNo & 15) === 0) {
      Renderer.drawPortrait(el('focusPortrait'), c);
      this.refreshFocusStats(c);
    }
  },
  applyGenes() {
    const c = this.focusCreature();
    if (!c || !this.geneEdits) return;
    const g = { speed: 0.5, size: 0.5, sense: 0.5, diet: 0, hue: 0.5, pattern: 0.5, longev: 0.5, fecund: 0.5, aggro: 0.5 };
    Object.assign(g, this.geneEdits);
    const ns = Life.makeSpecies(g, c.sp, g.diet);
    for (let k = 0; k < 8; k++) {
      const p = { x: clamp(c.x + (Life.rand() - 0.5) * 10, 1, World.W - 2), y: clamp(c.y + (Life.rand() - 0.5) * 10, 1, World.H - 2) };
      const gg = Life.mutateGenome(Life.cloneGenome(g), 0.02);
      const br = { w1: c.brain.w1.slice(), b1: c.brain.b1.slice(), w2: c.brain.w2.slice(), b2: c.brain.b2.slice() };
      Life.mutateBrain(br, 0.2);
      Life.spawn(gg, br, p.x, p.y, ns.id);
    }
    Life.addEvent('god', '🧬 The gods sculpt flesh: <b>' + esc(ns.name) + '</b> is engineered in the DNA lab.');
    this.toast('Engineered: ' + ns.name, '8 clones released', 'god');
    this.dirtySpecies = true; this.dirtyLog = true;
  },

  /* ---------- charts ---------- */
  drawCharts() {
    this.drawSeries(el('popChart'), [Life.histPop], ['#46f2c1'], true);
    this.drawSeries(el('histChart'), [Life.histSpec], ['#7aa2ff'], true);
    const mc = el('miniPop');
    this.drawSeries(mc, [Life.histPop.slice(-120)], ['#46f2c1'], false);
    const mx = Math.max(1, ...Life.histPop);
    el('popScale').textContent = 'peak ' + fmtInt(mx);
  },
  drawSeries(cv, series, colors, axes) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    series.forEach((s, si) => {
      if (s.length < 2) return;
      const mx = Math.max(1, ...s);
      ctx.beginPath();
      s.forEach((v, i) => {
        const x = (i / (599)) * W, y = H - 8 - (v / mx) * (H - 20);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = colors[si]; ctx.lineWidth = axes ? 3 : 2.5; ctx.stroke();
      // fill
      ctx.lineTo(((s.length - 1) / 599) * W, H); ctx.lineTo(0, H); ctx.closePath();
      const gr = ctx.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, colors[si] + '55'); gr.addColorStop(1, colors[si] + '00');
      ctx.fillStyle = gr; ctx.fill();
    });
    if (axes) { ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.font = '20px ui-monospace,monospace'; }
  },

  updateFollowChip() {
    const chip = el('followChip');
    if (Life.followed) {
      const sp = Life.speciesById(Life.followed.sp);
      chip.textContent = '◉ following ' + (sp ? sp.name : '') + ' #' + Life.followed.cid + ' — ESC to release';
      chip.classList.add('show');
    } else chip.classList.remove('show');
  },

  /* ---------- persistence ---------- */
  save() {
    try {
      const data = {
        v: 1, seed: Main.seedStr, preset: World.preset, day: World.day,
        warmth: World.warmth, rainfall: World.rainfall, sea: World.seaLevel, tilt: World.tilt, ice: World.iceAge,
        elev: Array.from(World.elev, v => +v.toFixed(3)),
        plant: Array.from(World.plant, v => +v.toFixed(2)),
        species: Life.species, nextSpId: Life.nextSpId,
        creatures: Life.creatures.slice(0, 400).map(c => ({
          x: +c.x.toFixed(1), y: +c.y.toFixed(1), e: Math.round(c.energy), a: Math.round(c.age),
          g: { speed: +c.gen.speed.toFixed(3), size: +c.gen.size.toFixed(3), sense: +c.gen.sense.toFixed(3), diet: c.gen.diet, hue: +c.gen.hue.toFixed(3), pattern: +c.gen.pattern.toFixed(3), longev: +c.gen.longev.toFixed(3), fecund: +c.gen.fecund.toFixed(3), aggro: +c.gen.aggro.toFixed(3) },
          b: [c.brain.w1.map(v => +v.toFixed(2)), c.brain.b1.map(v => +v.toFixed(2)), c.brain.w2.map(v => +v.toFixed(2)), c.brain.b2.map(v => +v.toFixed(2))],
          sp: c.sp,
        })),
        events: Life.events.slice(0, 60),
      };
      localStorage.setItem('primordia-save-v1', JSON.stringify(data));
      this.toast('World saved', 'sleeping in this browser');
    } catch (e) { this.toast('Save failed', String(e).slice(0, 80), 'bad'); }
  },
  load() {
    try {
      const raw = localStorage.getItem('primordia-save-v1');
      if (!raw) return false;
      const d = JSON.parse(raw);
      Main.newWorld(d.seed, d.preset, true);
      World.day = d.day; World.warmth = d.warmth; World.rainfall = d.rainfall; World.seaLevel = d.sea; World.tilt = d.tilt; World.iceAge = d.ice;
      World.elev.set(d.elev); World.plant.set(d.plant);
      Life.species = d.species; Life.nextSpId = d.nextSpId;
      Life.events = d.events || [];
      for (const s of d.creatures) {
        Life.spawn(s.g, { w1: s.b[0], b1: s.b[1], w2: s.b[2], b2: s.b[3] }, s.x, s.y, s.sp).energy = s.e;
        Life.creatures[Life.creatures.length - 1].age = s.a;
      }
      el('intro').classList.add('gone');
      this.toast('World restored', d.seed + ' · yr ' + World.year());
      return true;
    } catch (e) { return false; }
  },
  share() {
    const url = location.origin + location.pathname.replace(/\/[^/]*$/, '/') + 'muse-spark-1p3-contributor-01-10-2026/' + '#seed=' + encodeURIComponent(Main.seedStr) + '&preset=' + World.preset;
    const full = location.href.split('#')[0].split('?')[0].includes('http') ? location.href.split('#')[0] + '#seed=' + encodeURIComponent(Main.seedStr) + '&preset=' + World.preset : url;
    const done = () => this.toast('Link copied', 'same seed → same planet');
    if (navigator.clipboard) navigator.clipboard.writeText(full).then(done, () => { prompt('Copy your world link:', full); });
    else prompt('Copy your world link:', full);
  },
  screenshot() {
    const a = document.createElement('a');
    a.download = 'primordia-' + Main.seedStr + '-yr' + World.year() + '.png';
    a.href = Renderer.canvas.toDataURL('image/png');
    a.click();
    this.toast('Screenshot saved', 'a postcard from deep time');
  },
  exportDNA() {
    const alive = Life.species.filter(s => s.count > 0);
    const blob = new Blob([JSON.stringify({ world: World.name, seed: Main.seedStr, year: World.year(), species: alive }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = 'primordia-dna-' + Main.seedStr + '.json';
    a.href = URL.createObjectURL(blob); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },

  showHelp() {
    el('modalCard').innerHTML =
      '<h2>What is PRIMORDIA?</h2><p>A complete living planet, simulated live in your browser. Continents rise from fractal noise. Rain, seasons, wildfire and ice ages shape them. Plants spread where it is warm and wet. Animals — each with its own <b>genome</b> and a tiny <b>evolving neural brain</b> — graze, hunt, flee, starve, mate and mutate. Close cousins become <b>new species</b>; the unlucky become <b>fossils</b>.</p>' +
      '<h3>God tools <span style="color:#5b6579">left rail · keys V–I</span></h3><ul><li><kbd>◉</kbd> inspect any creature → open the DNA lab</li><li><kbd>▲</kbd><kbd>▼</kbd> raise continents, carve oceans</li><li><kbd>🌲</kbd><kbd>🦌</kbd><kbd>🐺</kbd> seed forests, grazers, hunters</li><li><kbd>🔥</kbd><kbd>☄</kbd><kbd>☠</kbd> fire, meteors, plague — extinctions included</li><li><kbd>❄</kbd> ice age toggle · <kbd>Space</kbd> pause · <kbd>1–4</kbd> time warp</li></ul>' +
      '<h3>The science inside</h3><p>Terrain: seeded fractal value-noise + ridged mountains. Climate: latitude + altitude + axial seasons + drifting storms. Plants: logistic growth limited by light, water, temperature and soil. Animals: 6 senses → 8 tanh neurons → 3 drives, with Gaussian mutation; speciation at genetic distance &gt; 0.28. Nothing is scripted — open the History tab after 200 years and read what <i>your</i> world did.</p>' +
      '<h3>Built from nothing</h3><p>No libraries. No images. No servers, no trackers. ~2,300 lines of hand-written JavaScript, canvas pixels and WebAudio oscillators. By <b>Muse Spark</b> for the <i>Show Me What You Can Do</i> experiment. Worlds are deterministic: share the seed, share the planet.</p>' +
      '<div class="btnrow"><button class="btn go" id="mClose">Begin</button></div>';
    el('modal').classList.add('open');
    el('mClose').addEventListener('click', () => el('modal').classList.remove('open'));
  },
};
