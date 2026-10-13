/* ═══════════════════════════════════════════════════════════════════════════
   THE IMPOSSIBLE HOUSE — landing.js
   The background of the front page is not a video: it is the same renderer
   the game uses, walking a real visitor through the real house on a loop.
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const IH = g.IH, M = IH.Math, V = M.V;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const world = IH.house.build();
  const tex = IH.textures.build({ size: 96, seed: 20261013 });
  IH.house.bindTextures(world, tex);

  const canvas = document.getElementById('landing-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 640, H = 360, buf = null, img = null, buf32 = null;
  const R = IH.render.create(W, H);
  R.far = 320;

  const player = IH.house.player(world);
  let fade = 0, fadeTarget = 0;

  /* A short itinerary: look, walk through a door, look again. */
  const route = [
    { look: 4.5, sweep: 0.5, then: { wing: null, gate: 'd-atrium-gallery' } },
    { look: 4.0, sweep: -0.4, then: { wing: null, gate: 'd-recess-0' } },
    { look: 3.6, sweep: 0.5, then: { wing: null, gate: 'd-recess-1' } },
    { look: 3.2, sweep: -0.5, then: { wing: null, gate: 'd-recess-2' } },
    { look: 3.0, sweep: 0.4, then: { wing: null, gate: 'd-recess-3' } },
    { look: 3.0, sweep: 0.3, then: { wing: null, gate: 'd-recess-4' } },
    { look: 4.0, sweep: -0.3, then: { wing: 'stairs', gate: 'd-step-0' } },
    { look: 2.4, sweep: 0.2, then: { wing: null, gate: 'd-step-1' } },
    { look: 2.4, sweep: -0.2, then: { wing: null, gate: 'd-step-2' } },
    { look: 2.4, sweep: 0.2, then: { wing: null, gate: 'd-step-3' } },
    { look: 3.6, sweep: 0.4, then: { wing: 'chapel', gate: 'd-chapel-flip' } },
    { look: 4.4, sweep: -0.5, then: { wing: 'core', gate: null } },
    { look: 6.0, sweep: 0.35, then: { wing: 'atrium', gate: null } },
  ];
  let step = 0, phase = 'look', phaseT = 0, yaw = 0, goalGate = null;

  function place(worldKey, sector, pos, f) {
    const p = player;
    if (sector !== undefined && sector !== null) p.sector = sector;
    if (pos) p.pos = pos.slice();
    if (f) IH.house.faceDir(p, f, [0, 1, 0]);
    p.ignore = null; p.ignoreT = 0;
  }

  function gotoStop(spec) {
    const w = world.wings[spec.wing];
    if (!w) return;
    const s = world.sectors[w.start];
    place(null, w.start,
      (s.place && s.place.pos) || [(s.min[0] + s.max[0]) / 2, 1.65, (s.min[2] + s.max[2]) / 2],
      (s.place && s.place.f) || [1, 0, 0]);
    fade = 1;
  }

  function nextStep() {
    const spec = route[step % route.length];
    if (spec.then && spec.then.wing) gotoStop(spec.then);
    phase = spec.look ? 'look' : 'walk';
    phaseT = 0;
    yaw = 0;
    goalGate = null;
  }

  function resize() {
    const dpr = Math.min(g.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth || g.innerWidth;
    const ch = canvas.clientHeight || g.innerHeight;
    canvas.width = Math.min(760, Math.max(360, Math.round(cw * dpr * 0.5)));
    canvas.height = Math.round(canvas.width * (ch / Math.max(1, cw)));
    W = canvas.width; H = canvas.height;
    IH.render.setSize(R, W, H);
    img = ctx.createImageData(W, H);
    buf32 = new Uint32Array(img.data.buffer);
    R.buf = buf32;
  }
  g.addEventListener('resize', resize);

  function draw(dt, t) {
    const p = player;
    const s = world.sectors[p.sector];
    const fog = s.fog;
    const clear = 0xff000000 | (((fog[2] * 0.5) | 0) << 16) | (((fog[1] * 0.5) | 0) << 8) | ((fog[0] * 0.5) | 0);
    const cam = M.pose(p.pos, p.r, p.u, p.f);
    IH.render.render(R, world, cam, p.sector, { clear: clear, fovY: 62 * M.DEG });
    if (s.sprites) for (const sp of s.sprites) {
      if (sp.kind !== 'flame') continue;
      const fr = (Math.floor(t * 10) + (sp.p[0] | 0)) % 4;
      IH.render.drawSprite(R, tex['flame' + fr], sp.p, sp.size * 1.1, [1, 1, 1], true);
    }
    ctx.putImageData(img, 0, 0);
    if (fade > 0.001) {
      ctx.fillStyle = 'rgba(5,5,8,' + fade.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      fade = Math.max(0, fade - dt * 2.6);
    }
  }

  let last = 0;
  function loop(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    const t = now / 1000;
    const p = player;
    const spec = route[step % route.length];

    if (phase === 'look') {
      /* a slow cinematic sweep, plus a touch of drift */
      phaseT += dt;
      const dir = (spec.sweep || 0.3) * 0.12;
      IH.house.look(p, dir * dt, Math.sin(phaseT * 0.4) * 0.0006);
      if (phaseT < 2.2) IH.house.step(world, p, IH.house.walkDir(p), dt, 0.55);
      if (phaseT > spec.look) {
        phase = 'walk'; phaseT = 0;
        goalGate = spec.then ? spec.then.gate : null;
        if (!goalGate) { step++; nextStep(); }
        else {
          const s = world.sectors[p.sector];
          if (!s.gates.some((x) => x.id === goalGate)) { step++; nextStep(); }
        }
      }
    } else {
      phaseT += dt;
      const s = world.sectors[p.sector];
      const gate = s.gates.find((x) => x.id === goalGate);
      if (!gate) { step++; nextStep(); }
      else {
        const voff = dot(V.sub(p.pos, gate.center), gate.v);
        const target = V.add(gate.center, V.mul(gate.v, voff));
        const rel = V.sub(target, p.pos);
        const du = dot(rel, gate.u);
        const dist = dot(V.sub(gate.center, p.pos), gate.n);
        const aligned = Math.abs(du) < gate.w * 0.4 && Math.abs(voff) < gate.h * 0.45;
        IH.house.faceDir(p, (aligned && dist > 0 && dist < 2.4) ? gate.n : V.norm(rel), p.u);
        IH.house.step(world, p, IH.house.walkDir(p), dt, 1.5);
        if (p.sector !== s.index) { step++; nextStep(); }
        if (phaseT > 22) { step++; nextStep(); }
      }
    }
    draw(dt, t);
    const el = document.getElementById('fps');
    if (el) el.textContent = W + '×' + H + ' · live';
    g.requestAnimationFrame(loop);
  }

  /* the front page starts quietly and only draws when it is on screen */
  let visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });
  function slowLoop() {
    if (visible) { resize(); nextStep(); g.requestAnimationFrame(loop); }
    else setTimeout(slowLoop, 500);
  }
  resize();
  place(null, world.start.sector, world.start.pos.slice(), world.start.f);
  nextStep();
  slowLoop();

  /* a click anywhere on the cover takes you in */
  const enter = document.getElementById('enter');
  if (enter) enter.addEventListener('click', () => { g.location.href = 'house.html'; });
  document.querySelector('.cover') && document.querySelector('.cover').addEventListener('click', (e) => {
    if (e.target.tagName === 'A' || e.target.closest('a')) return;
    g.location.href = 'house.html';
  });
})(typeof window !== 'undefined' ? window : globalThis);
