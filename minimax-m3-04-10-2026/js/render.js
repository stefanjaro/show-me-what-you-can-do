/* render.js — canvas-based rendering with multiple view modes. */

'use strict';

const R = {
  canvas: null,
  ctx: null,
  // Camera
  cam: { x: 0, y: 0, zoom: 0.6 },
  // Time of day (0..1, 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset)
  timeOfDay: 0.25,
  autoTime: true,
  // Selected creature id
  selectedId: -1,
  followId: -1,
  // Brush preview
  hoverX: -1,
  hoverY: -1,
  brushSize: 80,
  brushName: null,
  brushAdditive: true,
  // View mode
  viewMode: 'surface',
  // Time of day cached colors
  _sky: null,
  _fog: 0,
  // Cached terrain canvas (re-rendered only when world changes substantially)
  _terrainCache: null,
  _terrainCacheKey: -1,
  _terrainCacheCtx: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._fitDpi();
    this._sky = this._skyColors(this.timeOfDay);
    // Offscreen for terrain cache
    this._terrainCache = document.createElement('canvas');
    this._terrainCache.width = W.W;
    this._terrainCache.height = W.H;
    this._terrainCacheCtx = this._terrainCache.getContext('2d');
    this._terrainCacheKey = -1;
    window.addEventListener('resize', () => this._fitDpi());
  },

  _fitDpi() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = (rect.width * dpr) | 0;
    this.canvas.height = (rect.height * dpr) | 0;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
  },

  get size() { return { w: this._w || 1200, h: this._h || 800 }; },

  // Map view coords -> screen coords
  toScreen(x, y) {
    const s = this.size;
    return [
      s.w * 0.5 + (x - this.cam.x) * this.cam.zoom,
      s.h * 0.5 + (y - this.cam.y) * this.cam.zoom,
    ];
  },

  toWorld(sx, sy) {
    const s = this.size;
    return [
      this.cam.x + (sx - s.w * 0.5) / this.cam.zoom,
      this.cam.y + (sy - s.h * 0.5) / this.cam.zoom,
    ];
  },

  setCamera(x, y, zoom) {
    this.cam.x = x;
    this.cam.y = y;
    this.cam.zoom = Math.max(0.2, Math.min(2.5, zoom));
  },

  pan(dx, dy) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
  },

  // Sky / lighting for a given time of day (0..1)
  _skyColors(t) {
    // t=0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
    let r, g, b, intensity;
    if (t < 0.2) { // night
      const k = t / 0.2;
      r = U.lerp(8, 28, k);
      g = U.lerp(10, 36, k);
      b = U.lerp(20, 60, k);
      intensity = U.lerp(0.25, 0.45, k);
    } else if (t < 0.35) { // sunrise
      const k = (t - 0.2) / 0.15;
      r = U.lerp(28, 240, k);
      g = U.lerp(36, 160, k);
      b = U.lerp(60, 100, k);
      intensity = U.lerp(0.45, 1.0, k);
    } else if (t < 0.6) { // day
      const k = (t - 0.35) / 0.25;
      r = U.lerp(240, 180, k);
      g = U.lerp(160, 220, k);
      b = U.lerp(100, 250, k);
      intensity = 1.0;
    } else if (t < 0.85) { // sunset
      const k = (t - 0.6) / 0.25;
      r = U.lerp(180, 80, k);
      g = U.lerp(220, 30, k);
      b = U.lerp(250, 80, k);
      intensity = U.lerp(1.0, 0.4, k);
    } else { // night again
      const k = (t - 0.85) / 0.15;
      r = U.lerp(80, 8, k);
      g = U.lerp(30, 10, k);
      b = U.lerp(80, 20, k);
      intensity = U.lerp(0.4, 0.25, k);
    }
    return { r, g, b, intensity };
  },

  setTimeOfDay(t) { this.timeOfDay = U.clamp(t, 0, 1); this._sky = this._skyColors(this.timeOfDay); },

  // ── Main render ───────────────────────────────────────
  render(state) {
    const ctx = this.ctx;
    const s = this.size;

    // Background gradient based on time
    const sky = this._skyColors(this.timeOfDay);
    this._sky = sky;
    const grad = ctx.createLinearGradient(0, 0, 0, s.h);
    grad.addColorStop(0, U.rgb(sky.r * 0.7, sky.g * 0.7, sky.b * 0.7));
    grad.addColorStop(1, U.rgb(sky.r * 0.45, sky.g * 0.45, sky.b * 0.55));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s.w, s.h);

    // Water / ground base color
    this._drawTerrain();
    this._drawPlants();
    this._drawFood();
    this._drawCreatures(state);
    this._drawSelectedHighlight();
    this._drawBrush();
    this._drawFogAndVignette();

    // Mini-map (optional)
    this._drawMinimap(state);
  },

  _drawTerrain() {
    const ctx = this.ctx;
    const s = this.size;
    const cam = this.cam;
    const zoom = cam.zoom;
    const ts = W.scale * zoom;

    if (this.viewMode === 'traits' || this.viewMode === 'energy') {
      // These modes recompute per-tile on the fly (slow but visible)
      // but only for the visible region.
      const minTx = Math.max(0, ((cam.x - s.w * 0.5 / zoom) / W.scale) | 0);
      const maxTx = Math.min(W.W - 1, ((cam.x + s.w * 0.5 / zoom) / W.scale) | 0);
      const minTy = Math.max(0, ((cam.y - s.h * 0.5 / zoom) / W.scale) | 0);
      const maxTy = Math.min(W.H - 1, ((cam.y + s.h * 0.5 / zoom) / W.scale) | 0);

      for (let y = minTy; y <= maxTy; y++) {
        for (let x = minTx; x <= maxTx; x++) {
          const i = y * W.W + x;
          const t = W.tiles[i];
          const [sx, sy] = this.toScreen(x * W.scale, y * W.scale);
          let col;
          if (this.viewMode === 'traits') {
            if (t === W.T_WATER) continue;
            const fert = W._fertility(t, W.plants[i]);
            col = `hsla(${(1 - fert) * 220}, 60%, 50%, 0.45)`;
          } else {
            let h = 0;
            if (t === W.T_WATER) h = 200;
            else if (t === W.T_DESERT || t === W.T_TUNDRA || t === W.T_SNOW) h = 30;
            else if (t === W.T_GRASS) h = 90;
            else if (t === W.T_FOREST) h = 120;
            else if (t === W.T_JUNGLE) h = 140;
            else if (t === W.T_MOUNTAIN) h = 0;
            const intensity = W.plants[i] / 1100;
            col = `hsla(${h}, 60%, ${20 + intensity * 40}%, 1)`;
          }
          ctx.fillStyle = col;
          ctx.fillRect(sx, sy, ts + 1, ts + 1);
        }
      }
      return;
    }

    // Surface mode: use cached terrain image, scaled to viewport.
    // Cache is invalidated when user paints or world state changes.
    this._ensureTerrainCache();
    // Compute screen rect for the world
    const [sw, sh] = this.toScreen(W.W * W.scale, W.H * W.scale);
    const [sx0, sy0] = this.toScreen(0, 0);
    const w = sw - sx0;
    const h = sh - sy0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._terrainCache, sx0, sy0, w, h);
  },

  // Render the world terrain into a small canvas (W.W × W.H px) once, and
  // re-render only when invalidated. We update it lazily on paint and at most
  // every few frames.
  _ensureTerrainCache() {
    if (!this._terrainCache) return;
    // Only refresh when invalidated
    if (!this._terrainDirty) return;
    this._terrainDirty = false;
    const tctx = this._terrainCacheCtx;
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, this._terrainCache.width, this._terrainCache.height);
    const W_ = W.W, H_ = W.H;
    const img = tctx.createImageData(W_, H_);
    const data = img.data;
    for (let y = 0; y < H_; y++) {
      for (let x = 0; x < W_; x++) {
        const i = y * W_ + x;
        const t = W.tiles[i];
        let r, g, b;
        switch (t) {
          case W.T_WATER: {
            const k = W.water[i];
            r = 22 + k * 16; g = 64 + k * 24; b = 110 + k * 22;
            break;
          }
          case W.T_BEACH: r = 222; g = 200; b = 140; break;
          case W.T_GRASS: {
            const v = W.plants[i] / 1000;
            r = 78 + v * 14; g = 130 + v * 36; b = 56 + v * 14; break;
          }
          case W.T_FOREST: r = 38; g = 92; b = 38; break;
          case W.T_JUNGLE: r = 30; g = 80; b = 38; break;
          case W.T_DESERT: r = 222; g = 196; b = 130; break;
          case W.T_TUNDRA: r = 178; g = 184; b = 168; break;
          case W.T_MOUNTAIN: r = 92; g = 88; b = 80; break;
          case W.T_SNOW: r = 240; g = 244; b = 248; break;
          default: r = 0; g = 0; b = 0;
        }
        const j = (y * W_ + x) * 4;
        data[j] = r;
        data[j + 1] = g;
        data[j + 2] = b;
        data[j + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
  },

  invalidateTerrain() { this._terrainDirty = true; },

  _drawPlants() {
    if (this.viewMode === 'energy' || this.viewMode === 'xray') return;
    const ctx = this.ctx;
    const cam = this.cam;
    const zoom = cam.zoom;
    const ts = W.scale * zoom;
    const s = this.size;
    const minTx = Math.max(0, ((cam.x - s.w * 0.5 / zoom) / W.scale) | 0);
    const maxTx = Math.min(W.W - 1, ((cam.x + s.w * 0.5 / zoom) / W.scale) | 0);
    const minTy = Math.max(0, ((cam.y - s.h * 0.5 / zoom) / W.scale) | 0);
    const maxTy = Math.min(W.H - 1, ((cam.y + s.h * 0.5 / zoom) / W.scale) | 0);

    const sky = this._sky;
    if (ts < 1) return; // skip plant detail when zoomed out

    for (let y = minTy; y <= maxTy; y++) {
      for (let x = minTx; x <= maxTx; x++) {
        const i = y * W.W + x;
        const t = W.tiles[i];
        const plants = W.plants[i];
        if (plants < 60) continue;
        if (t === W.T_WATER || t === W.T_MOUNTAIN || t === W.T_SNOW) continue;
        const [sx, sy] = this.toScreen(x * W.scale, y * W.scale);
        const cx = sx + ts * 0.5, cy = sy + ts * 0.5;

        let g, baseCol;
        if (t === W.T_DESERT) {
          g = plants / 60;
          baseCol = `hsla(40, 50%, ${50 + g * 20}%, ${0.4 + g * 0.5})`;
        } else if (t === W.T_TUNDRA) {
          g = plants / 60;
          baseCol = `hsla(140, 18%, ${50 + g * 10}%, ${0.3 + g * 0.4})`;
        } else if (t === W.T_BEACH) {
          g = plants / 250;
          baseCol = `hsla(95, 35%, ${45 + g * 10}%, ${0.4 + g * 0.4})`;
        } else {
          // grass/forest/jungle
          const density = Math.min(1, plants / 1000);
          if (t === W.T_FOREST || t === W.T_JUNGLE) {
            // tree-like blobs
            ctx.fillStyle = `hsla(${110 + (x + y) % 18}, 50%, ${22 + density * 14}%, ${0.5 + density * 0.5})`;
            ctx.beginPath();
            ctx.arc(cx + ((x * 31) % 7 - 3), cy + ((y * 53) % 7 - 3), 2 + ts * 0.45, 0, U.TAU);
            ctx.fill();
          } else {
            ctx.fillStyle = `hsla(${95 + (x + y * 3) % 12}, 50%, ${30 + density * 14}%, ${0.3 + density * 0.4})`;
            for (let k = 0; k < 3; k++) {
              ctx.beginPath();
              ctx.arc(cx + (k * 13) % 5 - 2, cy + (k * 23) % 5 - 2, 1 + ts * 0.25, 0, U.TAU);
              ctx.fill();
            }
          }
          continue;
        }
        ctx.fillStyle = baseCol;
        ctx.beginPath();
        ctx.arc(cx, cy, 1 + ts * 0.3, 0, U.TAU);
        ctx.fill();
      }
    }
  },

  _drawFood() {
    if (this.viewMode === 'energy') return;
    const ctx = this.ctx;
    const cam = this.cam;
    const zoom = cam.zoom;
    const ts = W.scale * zoom;
    const s = this.size;
    const minTx = Math.max(0, ((cam.x - s.w * 0.5 / zoom) / W.scale) | 0);
    const maxTx = Math.min(W.W - 1, ((cam.x + s.w * 0.5 / zoom) / W.scale) | 0);
    const minTy = Math.max(0, ((cam.y - s.h * 0.5 / zoom) / W.scale) | 0);
    const maxTy = Math.min(W.H - 1, ((cam.y + s.h * 0.5 / zoom) / W.scale) | 0);

    for (let y = minTy; y <= maxTy; y++) {
      for (let x = minTx; x <= maxTx; x++) {
        const i = y * W.W + x;
        const f = W.food[i];
        if (f < 1) continue;
        const [sx, sy] = this.toScreen(x * W.scale, y * W.scale);
        const cx = sx + ts * 0.5, cy = sy + ts * 0.5;
        ctx.fillStyle = `rgba(220, 110, 60, ${Math.min(0.9, f * 0.1)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 1 + Math.min(2.5, f * 0.05), 0, U.TAU);
        ctx.fill();
      }
    }
  },

  _drawCreatures(state) {
    const ctx = this.ctx;
    const sky = this._sky;
    const zoom = this.cam.zoom;
    const showBrains = this.viewMode === 'xray';

    // Sort by size for nicer overlap
    const list = W.creatures.slice();
    list.sort((a, b) => a.size - b.size);
    for (const c of list) {
      if (c.dead) continue;
      const [sx, sy] = this.toScreen(c.x, c.y);

      // Age-based size scaling (babies are smaller, adults full size)
      const ageFrac = U.clamp(c.age / Math.max(1, c.maturityAge), 0, 1.5);
      const sizeFrac = U.clamp(c.age / 5, 0.25, 1); // grows over first 5 sim sec
      const effectiveSize = c.size * (0.5 + 0.5 * sizeFrac);
      const r = effectiveSize * 7 * zoom;
      if (sx < -50 || sy < -50 || sx > this.size.w + 50 || sy > this.size.h + 50) continue;

      // Selection / follow outline
      const isSelected = (c.id === this.selectedId);
      const isFollowed = (c.id === this.followId);

      // Glow underlay
      if (r > 1.5) {
        const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.6);
        const flash = c.spawnFlash;
        const a = 0.18 + flash * 0.35;
        grd.addColorStop(0, `hsla(${c.hue}, ${c.sat}%, ${c.lit}%, ${a * sky.intensity})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 1.6, 0, U.TAU);
        ctx.fill();
      }

      // Body shape — based on limb count
      // Old age slightly grays the body
      const oldAge = U.clamp((c.age - c.ageMax * 0.85) / (c.ageMax * 0.15), 0, 1);
      const baseLit = (c.lit - oldAge * 18) * sky.intensity;
      const baseSat = c.sat * (1 - oldAge * 0.5);
      ctx.fillStyle = `hsla(${c.hue}, ${baseSat}%, ${baseLit}%, 0.95)`;
      ctx.strokeStyle = `hsla(${c.hue}, ${baseSat}%, ${baseLit * 0.6}%, 0.8)`;
      ctx.lineWidth = 1.0;

      if (showBrains) {
        // Draw brain connection-ish visualisation
        this._drawCreatureBrain(c, sx, sy, r);
        continue;
      }

      const nL = c.nLimbs;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(c.angle);

      // Body ellipse — shape depends on diet class
      const asp = c.bodyAspect || 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.1 * asp, r * 0.75 / Math.max(0.6, asp), 0, 0, U.TAU);
      ctx.fill();
      ctx.stroke();

      // Eye(s)
      ctx.fillStyle = `rgba(255,255,255,${0.85 * sky.intensity})`;
      ctx.beginPath();
      ctx.arc(r * 0.5 * asp, -r * 0.3, r * 0.22, 0, U.TAU);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(r * 0.55 * asp, -r * 0.3, r * 0.1, 0, U.TAU);
      ctx.fill();

      // Mouth indicator — color by diet
      const mouthR = r * 0.12;
      let mouthColor;
      if (c.diet.carni > c.diet.herbi + 0.1) {
        // Carnivore mouth — fangs hint
        mouthColor = `rgba(220,60,60,${0.95 * sky.intensity})`;
      } else if (c.diet.herbi > c.diet.carni + 0.1) {
        // Herbivore — beak-ish
        mouthColor = `rgba(80,180,90,${0.95 * sky.intensity})`;
      } else {
        mouthColor = `rgba(220,200,80,${0.95 * sky.intensity})`;
      }
      ctx.fillStyle = mouthColor;
      ctx.beginPath();
      ctx.arc(r * 0.95 * asp, r * 0.15, mouthR, 0, U.TAU);
      ctx.fill();

      // For carnivores: little fang triangles
      if (c.diet.carni > c.diet.herbi + 0.1) {
        ctx.fillStyle = '#fff';
        const fx = r * 0.95 * asp;
        const fy = r * 0.15;
        ctx.beginPath();
        ctx.moveTo(fx - 0.7, fy);
        ctx.lineTo(fx + 0.3, fy + 1.2);
        ctx.lineTo(fx + 0.3, fy);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(fx + 0.7, fy);
        ctx.lineTo(fx - 0.3, fy + 1.2);
        ctx.lineTo(fx - 0.3, fy);
        ctx.closePath();
        ctx.fill();
      }

      // Limbs
      for (let i = 0; i < nL; i++) {
        const limb = c.limbs[i];
        const phase = limb.phase;
        const a = limb.baseAngle + Math.sin(phase) * limb.amp;
        const lx = Math.cos(a) * r * 0.8;
        const ly = Math.sin(a) * r * 0.8;
        ctx.strokeStyle = `hsla(${c.hue}, ${baseSat}%, ${baseLit * 0.7}%, 0.75)`;
        ctx.lineWidth = r * 0.18;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(lx, ly);
        ctx.stroke();
      }

      // Outline for selected/followed
      if (isSelected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.4 * asp, r * 1.0 / Math.max(0.6, asp), 0, 0, U.TAU);
        ctx.stroke();
      }
      if (isFollowed && !isSelected) {
        ctx.strokeStyle = 'rgba(108,242,193,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.35 * asp, r * 0.95 / Math.max(0.6, asp), 0, 0, U.TAU);
        ctx.stroke();
      }

      ctx.restore();

      // Health bar above creature
      if (zoom > 0.4) {
        const bw = r * 1.6, bh = 2;
        const bx = sx - bw * 0.5, by = sy - r * 1.7;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(bx, by, bw, bh);
        const hp = U.clamp(c.health / c.maxHealth, 0, 1);
        ctx.fillStyle = hp > 0.5 ? '#6cf2c1' : (hp > 0.25 ? '#ffb85e' : '#ff6b8a');
        ctx.fillRect(bx, by, bw * hp, bh);
      }

      // Selection: name label
      if (isSelected) {
        const srec = E.species.get(c.speciesId);
        const label = srec ? srec.name : '—';
        ctx.font = '11px ui-sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = `hsla(${c.hue}, ${baseSat}%, ${Math.min(95, baseLit + 30)}%, 1)`;
        ctx.fillText(label, sx, sy - r * 1.9 - 4);
      }
    }
  },

  _drawCreatureBrain(c, sx, sy, r) {
    const ctx = this.ctx;
    const layers = c.brain.layers;
    const dx = (r * 2.4) / (layers.length - 1);
    const nodes = [];
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const col = [];
      for (let ni = 0; ni < layer.length; ni++) {
        col.push({
          x: sx - r * 1.2 + li * dx,
          y: sy + (ni - layer.length / 2) * (Math.min(8, r * 0.5)),
          v: layer[ni],
        });
      }
      nodes.push(col);
    }
    // Connections
    ctx.strokeStyle = 'rgba(108,242,193,0.18)';
    ctx.lineWidth = 0.5;
    for (let li = 0; li < nodes.length - 1; li++) {
      const a = nodes[li], b = nodes[li + 1];
      const w = c.brain.weights[li];
      let k = 0;
      for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
          const wt = w[k++];
          if (Math.abs(wt) < 0.05) continue;
          ctx.strokeStyle = wt > 0
            ? `rgba(108,242,193,${Math.min(0.4, wt * 0.15)})`
            : `rgba(255,107,138,${Math.min(0.4, -wt * 0.15)})`;
          ctx.beginPath();
          ctx.moveTo(a[i].x, a[i].y);
          ctx.lineTo(b[j].x, b[j].y);
          ctx.stroke();
        }
      }
    }
    // Nodes
    for (const col of nodes) {
      for (const n of col) {
        ctx.fillStyle = n.v >= 0
          ? `rgba(108,242,193,${0.4 + n.v * 0.5})`
          : `rgba(255,107,138,${0.4 - n.v * 0.5})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.2, 0, U.TAU);
        ctx.fill();
      }
    }
  },

  _drawSelectedHighlight() {}, // already done above

  _drawBrush() {
    if (this.hoverX < 0 || !this.brushName) return;
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(this.hoverX, this.hoverY);
    const zoom = this.cam.zoom;
    const r = this.brushSize * zoom;
    ctx.strokeStyle = this.brushAdditive ? 'rgba(108,242,193,0.85)' : 'rgba(255,107,138,0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, U.TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  },

  _drawFogAndVignette() {
    const ctx = this.ctx;
    const sky = this._sky;
    if (sky.intensity < 0.9) {
      const a = (0.9 - sky.intensity) * 0.55;
      ctx.fillStyle = `rgba(6,10,20,${a})`;
      ctx.fillRect(0, 0, this.size.w, this.size.h);
    }
    // Heat spots from brushes
    if (M.heatSpots) {
        for (const spot of M.heatSpots) {
          const [sx, sy] = this.toScreen(spot.x, spot.y);
          const r = spot.radius * this.cam.zoom * (1 + (1 - spot.life / 8) * 0.4);
          const a = spot.life / 8;
          const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
          grd.addColorStop(0, `rgba(255,140,40,${0.35 * a})`);
          grd.addColorStop(0.4, `rgba(255,80,30,${0.18 * a})`);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, U.TAU);
          ctx.fill();
        }
      }
    // Vignette
    const grad = ctx.createRadialGradient(
      this.size.w / 2, this.size.h / 2, this.size.w * 0.4,
      this.size.w / 2, this.size.h / 2, this.size.w * 0.7
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.size.w, this.size.h);
  },

  // ── Mini-map ────────────────────────────────────────
  _drawMinimap(state) {
    const ctx = this.ctx;
    const w = 130, h = 130;
    const pad = 12;
    const x = this.size.w - w - pad;
    const y = this.size.h - h - pad;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(8,12,24,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - 1, y - 1, w + 2, h + 2);
    ctx.fill();
    ctx.stroke();

    // Use cached minimap image if available
    if (!this._minimapCache || this._minimapDirty) {
      if (!this._minimapCache) {
        this._minimapCache = document.createElement('canvas');
        this._minimapCache.width = w;
        this._minimapCache.height = h;
        this._minimapCtx = this._minimapCache.getContext('2d');
      }
      this._minimapDirty = false;
      const mctx = this._minimapCtx;
      mctx.fillStyle = 'rgba(8,12,24,1)';
      mctx.fillRect(0, 0, w, h);
      // Sample at coarser resolution for speed
      const step = 4; // sample every 4th tile
      const sx = w / W.W, sy = h / W.H;
      for (let yy = 0; yy < W.H; yy += step) {
        for (let xx = 0; xx < W.W; xx += step) {
          const t = W.tiles[yy * W.W + xx];
          let col;
          if (t === W.T_WATER) col = 'rgba(40,80,140,0.7)';
          else if (t === W.T_BEACH) col = 'rgba(200,180,120,0.7)';
          else if (t === W.T_DESERT) col = 'rgba(220,200,150,0.7)';
          else if (t === W.T_GRASS) col = 'rgba(120,180,80,0.7)';
          else if (t === W.T_FOREST) col = 'rgba(60,120,60,0.7)';
          else if (t === W.T_JUNGLE) col = 'rgba(40,100,50,0.7)';
          else if (t === W.T_TUNDRA) col = 'rgba(180,180,180,0.7)';
          else if (t === W.T_MOUNTAIN) col = 'rgba(110,100,90,0.7)';
          else if (t === W.T_SNOW) col = 'rgba(240,240,250,0.7)';
          mctx.fillStyle = col;
          mctx.fillRect(xx * sx, yy * sy, sx * step + 1, sy * step + 1);
        }
      }
    }
    ctx.drawImage(this._minimapCache, x, y);

    // Viewport rectangle
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1;
    const sx = w / W.W, sy = h / W.H;
    const vx = x + (this.cam.x - this.size.w * 0.5 / this.cam.zoom) / W.scale * sx;
    const vy = y + (this.cam.y - this.size.h * 0.5 / this.cam.zoom) / W.scale * sy;
    const vw = this.size.w / this.cam.zoom / W.scale * sx;
    const vh = this.size.h / this.cam.zoom / W.scale * sy;
    ctx.strokeRect(vx, vy, vw, vh);

    // Creatures as dots, color by species
    for (const c of W.creatures) {
      if (c.dead) continue;
      const cx = x + (c.x / (W.W * W.scale)) * w;
      const cy = y + (c.y / (W.H * W.scale)) * h;
      const srec = E.species.get(c.speciesId);
      const lit = srec ? srec.lit : c.lit;
      const sat = srec ? srec.sat : c.sat;
      const hue = srec ? srec.color : c.hue;
      ctx.fillStyle = `hsla(${hue},${sat}%,${lit}%,1)`;
      ctx.fillRect(cx - 0.5, cy - 0.5, 1.5, 1.5);
    }

    ctx.restore();
  },

  invalidateMinimap() { this._minimapDirty = true; },
  invalidateAll() { this._terrainDirty = true; this._minimapDirty = true; },

  // ── Brain canvas (separate, on right panel) ────────
  drawBrainPanel(canvas, creature) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!creature) {
      ctx.fillStyle = '#5a6273';
      ctx.font = '11px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click a creature', w / 2, h / 2);
      return;
    }
    const brain = creature.brain;
    const layers = brain.layers;
    const margin = 14;
    const usableW = w - margin * 2;
    const usableH = h - margin * 2;
    const dx = usableW / (layers.length - 1);
    const nodes = [];
    for (let li = 0; li < layers.length; li++) {
      const col = [];
      const layer = layers[li];
      for (let ni = 0; ni < layer.length; ni++) {
        col.push({
          x: margin + li * dx,
          y: margin + (ni + 0.5) * (usableH / layer.length),
          v: layer[ni],
          idx: ni,
        });
      }
      nodes.push(col);
    }
    // Connections (sample for clarity)
    ctx.lineWidth = 0.4;
    for (let li = 0; li < nodes.length - 1; li++) {
      const a = nodes[li], b = nodes[li + 1];
      const wts = brain.weights[li];
      let k = 0;
      for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
          const wt = wts[k++];
          if (Math.abs(wt) < 0.04) continue;
          if (Math.random() > 0.5) continue; // sample
          ctx.strokeStyle = wt > 0
            ? `rgba(108,242,193,${Math.min(0.5, wt * 0.2)})`
            : `rgba(255,107,138,${Math.min(0.5, -wt * 0.2)})`;
          ctx.beginPath();
          ctx.moveTo(a[i].x, a[i].y);
          ctx.lineTo(b[j].x, b[j].y);
          ctx.stroke();
        }
      }
    }
    for (const col of nodes) {
      for (const n of col) {
        ctx.fillStyle = n.v >= 0
          ? `rgba(108,242,193,${0.6 + n.v * 0.4})`
          : `rgba(255,107,138,${0.6 - n.v * 0.4})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.v >= 0 ? 2.4 : 2.0, 0, U.TAU);
        ctx.fill();
      }
    }
    // Sensor / effector labels
    ctx.fillStyle = '#8a93a6';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const sensorLabels = ['eye','type','ground','food','prey','hunger','energy','temp','vel','osc1','osc2'];
    const effectorLabels = ['L0','L1','L2','L3','L4','L5','L6','L7','thrust','turn','bias'];
    for (let i = 0; i < nodes[0].length && i < sensorLabels.length; i++) {
      ctx.fillText(sensorLabels[i], 2, nodes[0][i].y + 3);
    }
    const last = nodes[nodes.length - 1];
    for (let i = 0; i < last.length && i < effectorLabels.length; i++) {
      ctx.fillText(effectorLabels[i], w - 28, last[i].y + 3);
    }
  },

  // ── Tree panel ──────────────────────────────────────
  drawTreePanel(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!E.tree.length) {
      ctx.fillStyle = '#5a6273';
      ctx.font = '11px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No species yet', w / 2, h / 2);
      return;
    }
    // Layout: vertical by species id, with branch from parent
    // For readability, do a layered layout: depth = "generation distance from root"
    // Find root species (no parent)
    const byId = new Map();
    E.tree.forEach(n => byId.set(n.id, n));
    const depth = new Map();
    const computeDepth = (id, d) => {
      depth.set(id, d);
      const n = byId.get(id);
      if (n && n.parent != null) computeDepth(n.parent, d + 1);
    };
    E.tree.forEach(n => {
      if (n.parent == null) computeDepth(n.id, 0);
    });
    // Group by depth
    const layers = new Map();
    for (const n of E.tree) {
      const d = depth.get(n.id) || 0;
      if (!layers.has(d)) layers.set(d, []);
      layers.get(d).push(n);
    }
    const layerKeys = Array.from(layers.keys()).sort((a,b) => a - b);
    const padding = 12;
    const colW = (w - padding * 2) / Math.max(1, layerKeys.length - 1);
    // Position by row within column
    const pos = new Map();
    layerKeys.forEach((d, ci) => {
      const col = layers.get(d);
      const rowH = (h - padding * 2) / Math.max(1, col.length);
      col.forEach((n, ri) => {
        pos.set(n.id, {
          x: padding + ci * colW,
          y: padding + (ri + 0.5) * rowH,
        });
      });
    });

    // Edges
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.7;
    for (const n of E.tree) {
      if (n.parent != null) {
        const a = pos.get(n.parent), b = pos.get(n.id);
        if (a && b) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    // Nodes
    for (const n of E.tree) {
      const p = pos.get(n.id);
      if (!p) continue;
      const extinct = !!n.extinctAt;
      const lit = extinct ? 18 : (n.lit);
      const sat = extinct ? 12 : (n.sat);
      ctx.fillStyle = `hsla(${n.color}, ${sat}%, ${lit}%, 0.9)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, U.TAU);
      ctx.fill();
      if (extinct) {
        ctx.strokeStyle = 'rgba(255,107,138,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, U.TAU);
        ctx.stroke();
      }
    }
  },

  // ── Graph panel ─────────────────────────────────────
  drawGraphPanel(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!E.statsHistory.length) return;
    const pad = 16;
    const innerW = w - pad * 2, innerH = h - pad * 2;
    const hist = E.statsHistory;
    const tMin = hist[0].time, tMax = hist[hist.length - 1].time;
    const tRange = Math.max(0.001, tMax - tMin);
    let maxPop = 1;
    for (const e of hist) if (e.population > maxPop) maxPop = e.population;
    let maxSpp = 1;
    for (const e of hist) if (e.species > maxSpp) maxSpp = e.species;

    // Background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const y = pad + (i / 4) * innerH;
      ctx.beginPath();
      ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }

    // Population line
    ctx.strokeStyle = 'rgba(108,242,193,0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const x = pad + (hist[i].time - tMin) / tRange * innerW;
      const y = pad + (1 - hist[i].population / maxPop) * innerH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under population
    ctx.fillStyle = 'rgba(108,242,193,0.10)';
    ctx.lineTo(pad + innerW, pad + innerH);
    ctx.lineTo(pad, pad + innerH);
    ctx.closePath();
    ctx.fill();

    // Species line
    ctx.strokeStyle = 'rgba(138,168,255,0.95)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const x = pad + (hist[i].time - tMin) / tRange * innerW;
      const y = pad + (1 - hist[i].species / maxSpp) * innerH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#8a93a6';
    ctx.font = '10px ui-monospace';
    ctx.textAlign = 'left';
    ctx.fillText('pop (green)', pad + 4, pad + 12);
    ctx.fillStyle = '#8aa8ff';
    ctx.fillText('species (blue)', pad + 4, pad + 24);

    // y-axis ticks
    ctx.fillStyle = '#5a6273';
    ctx.textAlign = 'right';
    ctx.fillText(U.fmtNum(maxPop), w - pad - 2, pad + 8);
    ctx.fillText(U.fmtNum(maxSpp), w - pad - 2, pad + 20);

    // x-axis label
    ctx.fillStyle = '#8a93a6';
    ctx.textAlign = 'center';
    ctx.fillText(`${U.fmtAge(tMin)} → ${U.fmtAge(tMax)}`, w / 2, h - 4);
  }
};

if (typeof module !== 'undefined') module.exports = R;