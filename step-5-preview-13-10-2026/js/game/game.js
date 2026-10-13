/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — game.js
   The visitor: walking, looking, gathering the four seals, reading what the
   house says about itself — and the atlas, in case you want out.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = g.IH;
  const M = IH.Math, V = M.V;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const WING_ORDER = ['atrium', 'annex', 'turning', 'stairs', 'gallery', 'chapel', 'core'];
  const WING_LABEL = {
    atrium: 'The Atrium', annex: 'The Annex', turning: 'The Hall of Turning',
    stairs: 'The Penrose Ascent', gallery: 'The Recessional',
    chapel: 'The Inverted Chapel', core: 'The Core',
  };

  function wingOf(world, sectorIndex) {
    for (const k of WING_ORDER) {
      const w = world.wings[k];
      if (w && sectorIndex >= w.start && sectorIndex < w.start + w.count) return k;
    }
    return 'atrium';
  }

  function create(opts) {
    opts = opts || {};
    const G = {
      canvas: opts.canvas, ui: opts.ui || {}, audio: null,
      world: null, R: null, img: null, ctx: null, buf32: null,
      keys: {}, mouse: { dx: 0, dy: 0, locked: false },
      touch: { id: -1, lookId: -1, ox: 0, oy: 0, lx: 0, ly: 0, mx: 0, my: 0 },
      player: null, paused: true, t: 0, last: 0, frames: 0, fpsT: 0, fps: 60,
      quality: 1, cssW: 0, cssH: 0, dpr: 1,
      stepAcc: 0, lastDist: 0, message: '', messageT: 0,
      visited: {}, seals: 0, note: null, atlasOpen: false,
      shake: 0, flash: 0, ended: false, ending: 0, lastSector: 0,
    };

    /* ── the house, and its textures ── */
    G.world = IH.house.build();
    G.tex = IH.textures.build({ size: 128, seed: 20261013 });
    IH.house.bindTextures(G.world, G.tex);
    G.player = IH.house.player(G.world);
    G.lastSector = G.player.sector;

    G.ctx = G.canvas.getContext('2d', { alpha: false });
    G.dpr = Math.min(g.devicePixelRatio || 1, 2);
    resize(G);

    /* ── input ── */
    g.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      G.keys[k] = true;
      if (k === 'e' && !G.atlasOpen) G.interact();
      if (k === 'm') G.toggleAtlas();
      if (k === 'escape') G.closeAll();
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].indexOf(k) >= 0) e.preventDefault();
    });
    g.addEventListener('keyup', (e) => { G.keys[e.key.toLowerCase()] = false; });
    g.addEventListener('blur', () => { G.keys = {}; });
    g.addEventListener('resize', () => { G.dpr = Math.min(g.devicePixelRatio || 1, 2); resize(G); });

    if (G.canvas) {
      G.canvas.addEventListener('click', () => {
        if (!G.paused && !G.atlasOpen && G.canvas.requestPointerLock) G.canvas.requestPointerLock();
      });
      document.addEventListener('pointerlockchange', () => {
        G.mouse.locked = document.pointerLockElement === G.canvas;
        if (G.ui.crosshair) G.ui.crosshair.style.opacity = G.mouse.locked ? '1' : '0.35';
      });
      document.addEventListener('mousemove', (e) => {
        if (!G.mouse.locked || G.paused || G.atlasOpen) return;
        G.mouse.dx += e.movementX; G.mouse.dy += e.movementY;
      });
      /* touch: left thumb walks, right thumb looks */
      const ts = (e) => {
        for (const t of e.changedTouches) {
          if (t.clientX < g.innerWidth * 0.45 && G.touch.id < 0) {
            G.touch.id = t.identifier; G.touch.ox = t.clientX; G.touch.oy = t.clientY;
          } else if (G.touch.lookId < 0) {
            G.touch.lookId = t.identifier; G.touch.lx = t.clientX; G.touch.ly = t.clientY;
          }
        }
        if (e.cancelable) e.preventDefault();
      };
      const tm = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === G.touch.id) {
            G.touch.mx = Math.max(-1, Math.min(1, (t.clientX - G.touch.ox) / 55));
            G.touch.my = Math.max(-1, Math.min(1, (t.clientY - G.touch.oy) / 55));
          } else if (t.identifier === G.touch.lookId) {
            G.mouse.dx += (t.clientX - G.touch.lx) * 1.7;
            G.mouse.dy += (t.clientY - G.touch.ly) * 1.7;
            G.touch.lx = t.clientX; G.touch.ly = t.clientY;
          }
        }
        if (e.cancelable) e.preventDefault();
      };
      const te = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === G.touch.id) { G.touch.id = -1; G.touch.mx = 0; G.touch.my = 0; }
          if (t.identifier === G.touch.lookId) G.touch.lookId = -1;
        }
      };
      G.canvas.addEventListener('touchstart', ts, { passive: false });
      G.canvas.addEventListener('touchmove', tm, { passive: false });
      G.canvas.addEventListener('touchend', te);
      G.canvas.addEventListener('touchcancel', te);
    }

    /* the public handle */
    G.say = (t) => say(G, t);
    G.interact = () => interact(G);
    G.toggleAtlas = () => toggleAtlas(G);
    G.travelTo = (k) => travel(G, k);
    G.closeAll = () => closeAll(G);
    return G;
  }

  /* ── sizing: the render runs at a fraction of the display and is scaled up ── */
  function resize(G) {
    const c = G.canvas;
    if (!c || !G.ctx) return;
    const w = Math.max(320, c.clientWidth | 0), h = Math.max(220, c.clientHeight | 0);
    G.cssW = w; G.cssH = h;
    c.width = Math.round(w * G.dpr);
    c.height = Math.round(h * G.dpr);
    const target = 300000;                       // pixel budget
    let s = G.quality * (g.devicePixelRatio > 1 ? 0.62 : 0.72);
    let rw = Math.round(c.width * s), rh = Math.round(c.height * s);
    const px = rw * rh;
    if (px > target) { const k = Math.sqrt(target / px); rw *= k; rh *= k; }
    rw = Math.max(200, rw | 0); rh = Math.max(120, rh | 0);
    if (!G.R || G.R.w !== rw || G.R.h !== rh) {
      if (!G.R) G.R = IH.render.create(rw, rh);
      else IH.render.setSize(G.R, rw, rh);
      G.img = G.ctx.createImageData(G.R.w, G.R.h);
      G.buf32 = new Uint32Array(G.img.data.buffer);
      G.R.buf = G.buf32;
    }
  }

  function start(G, audio) {
    G.paused = false;
    if (audio) G.audio = audio;
    if (G.audio) { G.audio.start(); G.audio.windLevel(0.06); }
    G.last = 0;
    if (G.canvas.requestPointerLock) G.canvas.requestPointerLock();
    g.requestAnimationFrame((t) => frame(G, t));
  }

  /* ── one frame ── */
  function frame(G, now) {
    if (G.paused) return;
    const dt = G.last ? Math.min(0.05, (now - G.last) / 1000) : 0.016;
    G.last = now;
    G.t += dt;
    G.frames++;
    G.fpsT += dt;
    if (G.fpsT > 0.5) { G.fps = G.frames / G.fpsT; G.frames = 0; G.fpsT = 0; adapt(G); }
    update(G, dt);
    render(G);
    g.requestAnimationFrame((t) => frame(G, t));
  }

  function adapt(G) {
    /* keep the frame near 16 ms by trading resolution for smoothness */
    if (G.fps < 26 && G.quality > 0.5) { G.quality = Math.max(0.5, G.quality - 0.12); resize(G); }
    else if (G.fps > 52 && G.quality < 1) { G.quality = Math.min(1, G.quality + 0.08); resize(G); }
  }

  function update(G, dt) {
    const p = G.player, world = G.world;
    if (G.messageT > 0) { G.messageT -= dt; if (G.messageT <= 0) G.message = ''; }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 3);
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 1.6);
    if (G.ended && G.seals >= 4) epilogue(G, dt);

    /* look */
    const sens = 0.0022;
    if (G.mouse.dx || G.mouse.dy) {
      IH.house.look(p, -G.mouse.dx * sens, -G.mouse.dy * sens);
      G.mouse.dx = 0; G.mouse.dy = 0;
    }

    /* walk */
    const K = G.keys;
    let fwd = 0, str = 0;
    if (K['w'] || K['arrowup']) fwd += 1;
    if (K['s'] || K['arrowdown']) fwd -= 1;
    if (K['d'] || K['arrowright']) str += 1;
    if (K['a'] || K['arrowleft']) str -= 1;
    fwd -= G.touch.my; str += G.touch.mx;
    const run = (K['shift'] ? 1.9 : 1);
    const speed = 2.35 * run;
    if (fwd || str) {
      const d = IH.house.walkDir(p);
      const r = V.norm(V.cross(p.u, d));
      const dir = [
        d[0] * fwd + r[0] * str,
        d[1] * fwd + r[1] * str,
        d[2] * fwd + r[2] * str,
      ];
      const l = V.len(dir) || 1;
      IH.house.step(world, p, [dir[0] / l, dir[1] / l, dir[2] / l], dt, speed);
      G.stepAcc += (p.dist - G.lastDist);
      G.lastDist = p.dist;
      if (G.stepAcc > (run > 1 ? 2.9 : 2.2)) {
        G.stepAcc = 0;
        if (G.audio) G.audio.step(0.9 + Math.random() * 0.3);
      }
    } else {
      G.lastDist = p.dist;
    }

    /* doorways: notice when the geometry moves under our feet */
    if (p.sector !== G.lastSector) {
      const wing = wingOf(world, p.sector);
      G.visited[p.sector] = true;
      if (!G.visited[wing]) { G.visited[wing] = true; G.say('— ' + WING_LABEL[wing] + ' —'); }
      const up = p.u[1] < 0.5;
      if (up) { G.say('THE FLOOR HAS GONE'); }
      if (G.audio) G.audio.door(up);
      G.shake = up ? 1 : 0.5;
      if (p.sector === world.wings.core.start) enterCore(G);
      G.lastSector = p.sector;
    }

    /* the nearest thing worth touching */
    G.near = nearest(G);
    hud(G);
  }

  function nearest(G) {
    const p = G.player, world = G.world;
    let best = null, bd = 2.5;
    const s = world.sectors[p.sector];
    if (s.items) for (const it of s.items) {
      if (G.sealIds && G.sealIds.indexOf(it.id) >= 0) continue;
      const d = V.dist(it.pos, p.pos);
      if (d < bd) { bd = d; best = { kind: 'seal', item: it }; }
    }
    if (s.note && !G.readNotes[s.note.id]) {
      const d = V.dist(notePoint(s), p.pos);
      if (d < 3.0 && (!best || d < best.d)) best = { kind: 'note', note: s.note, d: d };
    }
    return best;
  }

  /* a note is read where the room keeps it: the middle of the floor */
  function notePoint(s) { return s.note.pos || [(s.min[0] + s.max[0]) * 0.5, 1.4, (s.min[2] + s.max[2]) * 0.5]; }

  function interact(G) {
    if (G.atlasOpen) { toggleAtlas(G); return; }
    if (G.note) { openNote(G, G.note.note); return; }
    if (G.near && G.near.kind === 'seal') takeSeal(G, G.near.item);
  }

  function takeSeal(G, item) {
    if (!G.sealIds) G.sealIds = [];
    G.sealIds.push(item.id);
    G.seals = G.sealIds.length;
    if (G.audio) G.audio.bell(item.id === 'frag-4' ? 330 : 262 * Math.pow(2, G.seals / 6));
    G.flash = 1;
    G.say('SEAL ' + G.seals + ' OF 4 — ' + item.name);
    const world = G.world;
    for (const s of world.sectors) for (const gt of s.gates) {
      if (G.seals >= 4 && (gt.id === 'd-core' || gt.id === 'd-stairs-core')) gt.active = true;
    }
    if (G.seals >= 4) {
      G.say('The core is open.');
      if (G.audio) { G.audio.bell(392); setTimeout(() => G.audio && G.audio.bell(523), 260); }
    }
  }

  function enterCore(G) {
    if (G.ended) return;
    G.ended = true;
    G.ending = 0;
    G.say('THE CORE');
    if (G.audio) { G.audio.pad(0.5, [110, 164.8, 220, 277.2]); G.audio.windLevel(0.02); }
  }

  /* a short epilogue, once the seals are gathered and you are standing in
     the room the house was built around                                   */
  const EPILOGUE = [
    'Four seals, four wings, one room no surveyor could agree on.',
    'The house holds because the doorways agree to disagree about where they are.',
    'Nothing here is a trick of the camera. The walls are solid. The doors are the liars.',
    'Thank you for walking through it.',
  ];
  function epilogue(G, dt) {
    G.ending += dt;
    const n = G.epilogueLine | 0;
    if (G.ending > (n + 1) * 7 && n < EPILOGUE.length) {
      G.epilogueLine = n + 1;
      G.say(EPILOGUE[n]);
      if (G.audio) G.audio.bell(196 * Math.pow(2, n / 6));
    }
  }

  function say(G, text) { G.message = text; G.messageT = 5.5; }

  function openNote(G, note) {
    G.note = note;
    G.readNotes[note.id] = true;
    if (G.ui.note) {
      G.ui.note.querySelector('[data-title]').textContent = note.title;
      G.ui.note.querySelector('[data-text]').textContent = note.text;
      G.ui.note.classList.add('show');
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function toggleAtlas(G) {
    if (G.atlasOpen) { closeAll(G); return; }
    G.atlasOpen = true;
    const world = G.world;
    const list = [];
    for (const k of WING_ORDER) {
      const w = world.wings[k];
      if (!w) continue;
      const seen = G.visited[k];
      list.push({ key: k, label: WING_LABEL[k], seen: seen });
    }
    if (G.ui.atlas) {
      G.ui.atlas.querySelector('[data-list]').innerHTML = list.map((l) =>
        '<button data-wing="' + l.key + '"' + (l.seen ? '' : ' disabled') + '>' +
        '<span>' + l.label + '</span><em>' + (l.seen ? 'travel' : 'unvisited') + '</em></button>').join('');
      G.ui.atlas.querySelectorAll('[data-wing]').forEach((b) => {
        b.onclick = () => { travel(G, b.getAttribute('data-wing')); };
      });
      G.ui.atlas.classList.add('show');
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function closeAll(G) {
    G.atlasOpen = false;
    if (G.ui.atlas) G.ui.atlas.classList.remove('show');
    if (G.ui.note) G.ui.note.classList.remove('show');
    G.note = null;
  }

  function travel(G, key) {
    const world = G.world, w = world.wings[key];
    if (!w || !G.visited[key]) return;
    const s = world.sectors[w.start];
    const place = s.place || {};
    const p = G.player;
    p.sector = w.start;
    p.pos = (place.pos || [(s.min[0] + s.max[0]) / 2, 1.65, (s.min[2] + s.max[2]) / 2]).slice();
    IH.house.faceDir(p, place.f || [1, 0, 0], place.u || [0, 1, 0]);
    p.ignore = null; p.ignoreT = 0;
    closeAll(G);
    G.lastSector = p.sector;
    if (G.audio) G.audio.bell(174);
    G.flash = 0.8;
    G.say('— ' + WING_LABEL[key] + ' —');
  }

  /* ── drawing ── */
  function render(G) {
    const R = G.R, world = G.world, p = G.player;
    if (!R) return;
    const shake = G.shake;
    const cam = M.pose(p.pos, p.r, p.u, p.f);
    const fogClear = world.sectors[p.sector].fog;
    IH.render.render(R, world, cam, p.sector, {
      clear: (0xff000000 | ((fogClear[2] * 0.55) << 16) | ((fogClear[1] * 0.55) << 8) | (fogClear[0] * 0.55)),
      fovY: 74 * M.DEG,
    });
    /* flames, dust, and the seals you carry */
    const s = world.sectors[p.sector];
    if (s.sprites) for (const sp of s.sprites) {
      let tx, size = sp.size;
      if (sp.kind === 'flame') {
        const fr = ((Math.floor(G.t * 11) + (sp.p[0] | 0)) & 3);
        tx = G.tex['flame' + fr];
      } else if (sp.kind === 'seal') {
        tx = G.tex.glow;
        size = sp.size * (1 + 0.16 * Math.sin(G.t * 2.6 + sp.p[0]));
      } else {
        tx = G.tex.dust;
        size = sp.size * (0.85 + 0.15 * Math.sin(G.t * 1.7 + sp.p[2]));
      }
      if (tx) IH.render.drawSprite(R, tx, sp.p, size, [1, 1, 1], true);
    }
    if (G.seals > 0) {
      /* the seals you have gathered drift in front of you */
      for (let i = 0; i < G.seals; i++) {
        const a = G.t * 0.6 + i * 2.1;
        const pos = [p.pos[0] + p.r[0] * Math.cos(a) * 0.5 + p.f[0] * 0.8,
                     p.pos[1] + 0.25 + p.u[1] * 0.0 + Math.sin(a * 1.3) * 0.12,
                     p.pos[2] + p.r[2] * Math.cos(a) * 0.5 + p.f[2] * 0.8];
        IH.render.drawSprite(R, G.tex.glow, pos, 0.22, [1.0, 0.85, 0.5], true);
      }
    }
    G.ctx.putImageData(G.img, 0, 0);
    if (shake > 0) {
      G.ctx.save();
      G.ctx.globalAlpha = shake * 0.5;
      G.ctx.fillStyle = '#000';
      const m = shake * 10;
      G.ctx.fillRect(0, 0, G.canvas.width, m);
      G.ctx.fillRect(0, G.canvas.height - m, G.canvas.width, m);
      G.ctx.restore();
    }
    if (G.flash > 0) {
      G.ctx.save();
      G.ctx.globalAlpha = G.flash * 0.5;
      G.ctx.fillStyle = '#fff6e0';
      G.ctx.fillRect(0, 0, G.canvas.width, G.canvas.height);
      G.ctx.restore();
    }
  }

  /* ── the heads-up display ── */
  function hud(G) {
    const u = G.ui;
    if (u.room) u.room.textContent = world_name(G);
    if (u.seals) u.seals.textContent = G.seals + ' / 4';
    if (u.elev) {
      const world = G.world;
      const base = 0;
      u.elev.textContent = (G.player.pos[1] * 1).toFixed(1) + ' m';
    }
    if (u.compass) {
      const f = G.player.f, u_ = G.player.u;
      const h = V.norm([f[0] - u_[0] * dot(f, u_), f[1] - u_[1] * dot(f, u_), f[2] - u_[2] * dot(f, u_)]);
      const ang = Math.atan2(h[0], -h[2]);
      const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      u.compass.textContent = names[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    }
    if (u.inverted) u.inverted.style.opacity = (dot(G.player.u, [0, 1, 0]) < 0.5) ? '1' : '0';
    if (u.msg) {
      u.msg.textContent = G.message || '';
      u.msg.style.opacity = G.message ? '1' : '0';
    }
    if (u.prompt) {
      let t = '';
      if (!G.atlasOpen && G.near) t = G.near.kind === 'seal' ? 'E — take the seal' : 'E — read';
      u.prompt.textContent = t;
      u.prompt.style.opacity = t ? '1' : '0';
    }
    if (u.fps) u.fps.textContent = Math.round(G.fps) + ' fps · ' + G.R.w + '×' + G.R.h +
      ' · ' + R_stats(G);
  }

  function R_stats(G) {
    const s = G.R.stats;
    return s.polys + ' polys · ' + s.portals + ' doors seen';
  }

  function world_name(G) {
    const s = G.world.sectors[G.player.sector];
    return s.name;
  }

  IH.game = {
    create: create, resize: resize, start: start, update: update, render: render,
    interact: function (G) { interact(G); }, toggleAtlas: function (G) { toggleAtlas(G); },
    travel: function (G, k) { travel(G, k); }, say: say, wingOf: wingOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
