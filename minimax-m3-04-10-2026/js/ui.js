/* ui.js — DOM bindings, input, panels. */

'use strict';

const $ = (sel) => document.querySelector(sel);

const UI = {
  state: null, // reference to main state

  init(state) {
    this.state = state;
    this._bindTopbar();
    this._bindBrushes();
    this._bindMode();
    this._bindView();
    this._bindTime();
    this._bindTabs();
    this._bindCanvas();
    this._bindOverlay();
    this._bindKeyboard();
    this._populateBrushList();
  },

  _bindTopbar() {
    $('#btnPlayPause').addEventListener('click', () => this.state.togglePause());
    $('#btnStep').addEventListener('click', () => this.state.step());
    $('#btnSpeed').addEventListener('click', () => this.state.cycleSpeed());
    $('#btnSound').addEventListener('click', () => this.state.toggleSound());
    $('#btnReset').addEventListener('click', () => this.state.reset());
  },

  _bindBrushes() {
    // nothing — done in _populateBrushList
  },

  _populateBrushList() {
    const brushes = [
      { id: 'food',    name: 'Food',     sw: '#dc6e3c', desc: 'Meat piles', hot: '1' },
      { id: 'plants',  name: 'Plants',   sw: '#6dc35a', desc: 'Vegetation', hot: '2' },
      { id: 'water',   name: 'Water',    sw: '#3a6cb0', desc: 'Flood tile', hot: '3' },
      { id: 'wall',    name: 'Mountain', sw: '#8c847a', desc: 'Impasse',    hot: '4' },
      { id: 'heat',    name: 'Heat',     sw: '#ff7733', desc: 'Hot spot',   hot: '5' },
      { id: 'grass',   name: 'Grass',    sw: '#7fb050', desc: 'Plain',      hot: '6' },
      { id: 'clear',   name: 'Clear',    sw: '#222',    desc: 'Wipe food',  hot: '7' },
    ];
    const list = $('#brushList');
    list.innerHTML = '';
    for (const b of brushes) {
      const el = document.createElement('div');
      el.className = 'brush';
      el.dataset.id = b.id;
      el.innerHTML = `
        <div class="sw" style="--swatch:${b.sw}"></div>
        <div class="nm">${b.name}<span class="hk">${b.hot}</span></div>
        <div class="ds">${b.desc}</div>
      `;
      el.addEventListener('click', () => this._selectBrush(b.id));
      list.appendChild(el);
    }
    this._selectBrush('food');
  },

  _selectBrush(id) {
    document.querySelectorAll('.brush').forEach(el => {
      el.classList.toggle('on', el.dataset.id === id);
    });
    this.state.brush = id;
    R.brushName = id;
  },

  _bindMode() {
    $('#modeSeg').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const mode = btn.dataset.mode;
      this.state.mode = mode;
      document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b === btn));
    });
  },

  _bindView() {
    $('#viewSeg').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const view = btn.dataset.view;
      R.viewMode = view;
      document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b === btn));
    });
  },

  _bindTime() {
    const slider = $('#timeSlider');
    const label = $('#timeLabel');
    const auto = $('#autoTime');
    slider.addEventListener('input', () => {
      const v = +slider.value / 100;
      R.setTimeOfDay(v);
      R.autoTime = false;
      auto.checked = false;
      const totalMin = v * 24 * 60;
      const hh = Math.floor(totalMin / 60);
      const mm = Math.floor(totalMin % 60);
      label.textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    });
    auto.addEventListener('change', () => {
      R.autoTime = auto.checked;
    });
  },

  _bindTabs() {
    $('#tabs').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const tab = btn.dataset.tab;
      document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b === btn));
      document.querySelectorAll('.tab').forEach(t => t.hidden = t.dataset.tab !== tab);
      if (tab === 'tree') this.state.refreshTree();
      if (tab === 'graph') this.state.refreshGraph();
      if (tab === 'chronicle') this.state.refreshChronicle();
    });
  },

  _bindCanvas() {
    const canvas = R.canvas;
    let isPainting = false;
    let lastPx = 0, lastPy = 0;
    let isPanning = false;
    let panStart = null;
    let dragSelected = null;

    // Convert event -> world coords
    const toWorld = e => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      return [x, y, ...R.toWorld(x, y)];
    };

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousemove', e => {
      const [sx, sy, wx, wy] = toWorld(e);
      R.hoverX = wx; R.hoverY = wy;
      // Pan
      if (isPanning && panStart) {
        R.cam.x = panStart.camX - (sx - panStart.sx) / R.cam.zoom;
        R.cam.y = panStart.camY - (sy - panStart.sy) / R.cam.zoom;
        return;
      }
      if (isPainting && this.state.brush) {
        const r = R.brushSize;
        const additive = !e.shiftKey;
        R.brushAdditive = additive;
        // continuous painting along the path
        const dx = wx - lastPx, dy = wy - lastPy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = Math.max(4, r * 0.18);
        const n = Math.max(1, Math.ceil(dist / step));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const px = lastPx + dx * t;
          const py = lastPy + dy * t;
          W.paint(this.state.brush, px, py, r, additive);
        }
        lastPx = wx; lastPy = wy;
      }
    });

    canvas.addEventListener('mousedown', e => {
      const [sx, sy, wx, wy] = toWorld(e);
      if (e.button === 2 || e.altKey) {
        // Pan
        isPanning = true;
        panStart = { sx, sy, camX: R.cam.x, camY: R.cam.y };
        return;
      }
      if (e.button === 1) {
        isPanning = true;
        panStart = { sx, sy, camX: R.cam.x, camY: R.cam.y };
        return;
      }
      // Ctrl-click = spawn a starter creature
      if (e.ctrlKey || e.metaKey) {
        this.state.spawnAt(wx, wy);
        A.sfx('click');
        return;
      }
      // Left click: paint or select
      if (this.state.mode === 'observe' || (this.state.mode === 'paint' && !this.state.brush)) {
        const c = this.state.findCreatureAt(wx, wy, 14);
        if (c) {
          this.state.selectCreature(c);
        } else {
          this.state.selectCreature(null);
        }
        return;
      }
      if (this.state.mode === 'follow') {
        const c = this.state.findCreatureAt(wx, wy, 18);
        if (c) { this.state.followCreature(c); this.state.selectCreature(c); }
        return;
      }
      if (this.state.mode === 'control') {
        const c = this.state.findCreatureAt(wx, wy, 22);
        if (c) { this.state.controlCreature(c); this.state.selectCreature(c); this.state.followCreature(c); }
        return;
      }
      // Paint
      if (this.state.brush) {
        isPainting = true;
        lastPx = wx; lastPy = wy;
        const r = R.brushSize;
        const additive = !e.shiftKey;
        R.brushAdditive = additive;
        W.paint(this.state.brush, wx, wy, r, additive);
        if (this.state.brush === 'heat') {
          this.state.spawnHeat(wx, wy, r);
        }
      }
    });

    canvas.addEventListener('mouseup', e => {
      isPainting = false;
      isPanning = false;
      panStart = null;
    });
    canvas.addEventListener('mouseleave', () => {
      R.hoverX = -1; R.hoverY = -1;
      isPainting = false;
      isPanning = false;
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy, wx, wy] = toWorld(e);
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const oldZoom = R.cam.zoom;
      R.cam.zoom = U.clamp(R.cam.zoom * factor, 0.25, 2.5);
      // Zoom around mouse
      R.cam.x = wx - (wx - R.cam.x) * (oldZoom / R.cam.zoom);
      R.cam.y = wy - (wy - R.cam.y) * (oldZoom / R.cam.zoom);
    }, { passive: false });
  },

  _bindOverlay() {
    $('#btnBegin').addEventListener('click', () => {
      $('#overlay').classList.add('gone');
      A.init();
      A.resume();
      this.state.start();
    });
  },

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      // Pause / step
      if (e.key === ' ') {
        e.preventDefault();
        this.state.togglePause();
      } else if (e.key === '.') {
        e.preventDefault();
        this.state.step();
      } else if (e.key === '+' || e.key === '=') {
        this.state.cycleSpeed(1);
      } else if (e.key === '-' || e.key === '_') {
        this.state.cycleSpeed(-1);
      } else if (e.key === 'r' || e.key === 'R') {
        const hx = R.hoverX, hy = R.hoverY;
        if (hx > 0 && hy > 0) this.state.spawnAt(hx, hy);
      } else if (e.key === 'f' || e.key === 'F') {
        const hx = R.hoverX, hy = R.hoverY;
        if (hx > 0 && hy > 0) {
          W.addFood(hx, hy, 60);
          this.toast('Food dropped');
        }
      } else if (e.key === 'Escape') {
        this.state.selectCreature(null);
        this.state.followCreature(null);
        this.state.controlCreature(null);
      } else if (/^[1-9]$/.test(e.key)) {
        const ids = ['food','plants','water','wall','heat','grass','clear'];
        const idx = parseInt(e.key) - 1;
        if (ids[idx]) this._selectBrush(ids[idx]);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.state.cycleMode();
      }
    });
  },

  toast(msg, dur = 1400) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this._toastTm);
    this._toastTm = setTimeout(() => { t.hidden = true; }, dur);
  },

  // Refresh right panel content
  refreshInfo(creature) {
    if (!creature) {
      $('#infoEmpty').hidden = false;
      $('#infoBody').hidden = true;
      return;
    }
    $('#infoEmpty').hidden = true;
    $('#infoBody').hidden = false;
    const srec = E.species.get(creature.speciesId);
    $('#infSpecies').textContent = srec ? srec.name : '—';
    $('#infGen').textContent = creature.generation;
    $('#infAge').textContent = U.fmtAge(creature.age / (60 * 4));
    $('#infEnergy').textContent = `${creature.energy.toFixed(0)} / ${creature.maxEnergy.toFixed(0)}`;
    $('#infHealth').textContent = `${creature.health.toFixed(0)} / ${creature.maxHealth.toFixed(0)}`;
    $('#infParents').textContent = creature.parents
      ? creature.parents.map(p => '#' + p.id).join(' × ')
      : '—';
    $('#infChildren').textContent = creature.children.length || '—';
    $('#barEnergy').style.width = `${U.clamp(creature.energy / creature.maxEnergy * 100, 0, 100)}%`;
    $('#barHealth').style.width = `${U.clamp(creature.health / creature.maxHealth * 100, 0, 100)}%`;

    $('#infSpeed').textContent = creature.speed.toFixed(2);
    $('#infStomach').textContent = `${creature.stomachFill.toFixed(0)} / ${creature.stomachCap.toFixed(0)}`;
    $('#infVision').textContent = creature.vision.toFixed(0);
    $('#infSize').textContent = creature.size.toFixed(2);
    $('#infLife').textContent = U.fmtAge(creature.ageMax / (60 * 4));
    $('#infKids').textContent = creature.children.length;

    R.drawBrainPanel(document.getElementById('brainCanvas'), creature);
  },

  refreshSpecies() {
    const list = $('#speciesList');
    const arr = Array.from(E.species.values()).sort((a, b) => b.population - a.population);
    if (!arr.length) {
      list.innerHTML = '<div class="empty">No species yet — paint food and plants to attract founders.</div>';
      return;
    }
    list.innerHTML = '';
    for (const s of arr) {
      const div = document.createElement('div');
      div.className = 'row';
      if (this.state.followId) {
        const cf = W.creatures.find(c => c.id === this.state.followId);
        if (cf && cf.speciesId === s.id) div.classList.add('track');
      }
      div.innerHTML = `
        <span class="swatch" style="background:hsl(${s.color}, ${s.sat}%, ${s.lit}%);"></span>
        <span class="name">${s.name}<span class="latin">(${U.fmtAge(W.time - s.born)} old)</span></span>
        <span class="pop">${U.fmtNum(s.population)}</span>
      `;
      div.addEventListener('click', () => {
        const rep = s.members[Math.floor(Math.random() * s.members.length)];
        if (rep) {
          this.state.followCreature(rep);
          this.state.selectCreature(rep);
        }
      });
      list.appendChild(div);
    }
  },

  refreshChronicle() {
    const list = $('#chronicleList');
    list.innerHTML = '';
    if (!E.chronicle.length) {
      list.innerHTML = '<div class="empty">The chronicle is empty. Drop a few founders into a fertile area and wait.</div>';
      return;
    }
    // Show newest first, but limit
    const items = E.chronicle.slice().reverse().slice(0, 50);
    for (const e of items) {
      const div = document.createElement('div');
      div.className = `chron ${e.kind}`;
      div.innerHTML = `
        <span class="when">${U.fmtAge(e.time)}</span>
        <span class="what">${e.message.replace(e.speciesName, `<b>${e.speciesName}</b>`)}</span>
      `;
      list.appendChild(div);
    }
  },

  refreshStatsHUD() {
    const stats = W.getStats();
    $('#statGen').textContent = this.state.maxGeneration;
    $('#statAge').textContent = U.fmtAge(W.time);
    $('#statPop').textContent = U.fmtNum(stats.population);
    $('#statSpp').textContent = stats.species;
    $('#statExt').textContent = W.totalExtinctions;
    $('#statFps').textContent = this.state.fps.toFixed(0);
  },

  updateButtons() {
    const s = this.state;
    $('#btnPlayPause').textContent = s.paused ? '▶ Play' : '❚❚ Pause';
    $('#btnSpeed').textContent = `Speed ×${s.speedLevel}`;
    $('#btnSound').textContent = s.soundOn ? '♪ On' : '♪ Off';
  },

  setTimeLabel() {
    const t = R.timeOfDay;
    const totalMin = t * 24 * 60;
    const hh = Math.floor(totalMin / 60);
    const mm = Math.floor(totalMin % 60);
    $('#timeLabel').textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    $('#timeSlider').value = Math.round(t * 100);
  }
};

if (typeof module !== 'undefined') module.exports = UI;