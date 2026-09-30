/* ═══════════════════════════════════════════════════════════════════
   weather.js — №4  ·  Incompressible, swirling, obedient.

   Jos Stam's "Stable Fluids" (1999), which is the reason every
   weather effect you have ever seen in a game, a title sequence or a
   film runs at sixty frames a second. It is a page of maths and one
   enormous insight:

       fluids look like fluid because of two things, and only two

         1. the stuff you can see is carried along by the velocity
         2. the velocity field must not compress

   The first is semi-Lagrangian advection. To find where a parcel of
   dye ends up, walk *backwards* along the velocity field from the
   pixel and ask where it came from. Unconditionally stable, which is
   the whole trick — it never explodes, however large the step.

   The second is a linear algebra problem that is embarrassingly
   parallel, so it lives on the GPU. Twenty-eight Jacobi sweeps of

       p = (Σ p_j − ∇·u) / 4

   subtract the pressure gradient from the velocity and the air stops
   squeezing. Everything else — the vorticity confinement that puts
   the curl back after the numerical soup has smoothed it away, the
   buoyancy that makes bright dye climb — is garnish, added because
   real air does it.

   Units, because getting these wrong is how you end up with a blank
   screen: velocity is measured in grid cells per second, so the
   advection step is  dt · v · texelSize  and a gust of 300 is a
   comfortable 1.8 cells per frame.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { Program, Quad, Flow, makeGL, VS_QUAD, fit, clamp, fmt, fmtBig,
          gateFor, startLoop, pointer, floatKind } = SB;

  const ADVECT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uVel, uSrc;
uniform vec2  uTexel;
uniform float uDt, uDiss;

vec4 bilerp(sampler2D t, vec2 uv, vec2 texel){
  vec2 st = uv / texel - 0.5;
  vec2 i = floor(st), f = st - i;
  vec4 a = texture(t, (i + vec2(0.5, 0.5)) * texel);
  vec4 b = texture(t, (i + vec2(1.5, 0.5)) * texel);
  vec4 c = texture(t, (i + vec2(0.5, 1.5)) * texel);
  vec4 d = texture(t, (i + vec2(1.5, 1.5)) * texel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main(){
  /* stand still and the wind simply evaporates */
  vec2 v = texture(uVel, vUv).xy;
  vec2 coord = vUv - uDt * v * uTexel;
  outColor = bilerp(uSrc, coord, uTexel) * uDiss;
}`;

  const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTarget;
uniform vec2  uPoint, uForce;
uniform float uRadius, uAmount, uAspect;
uniform vec3  uDye;
uniform int   uWhich;         /* 0 = velocity, 1 = dye */

void main(){
  vec4 s = texture(uTarget, vUv);
  /* the grid is not square, so measure distance in square units */
  vec2 d = (vUv - uPoint) * vec2(uAspect, 1.0);
  float f = exp(-dot(d, d) / max(uRadius * uRadius, 1e-8));
  if (uWhich == 0) s.xy += uForce * f;
  else             s.rgb = mix(s.rgb, uDye, f * uAmount);
  outColor = s;
}`;

  const CURL_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uVel;
uniform vec2 uTexel;
void main(){
  float l = texture(uVel, vUv - vec2(uTexel.x, 0.0)).y;
  float r = texture(uVel, vUv + vec2(uTexel.x, 0.0)).y;
  float b = texture(uVel, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uVel, vUv + vec2(0.0, uTexel.y)).x;
  outColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
}`;

  const CONFINE_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uVel, uCurl;
uniform vec2  uTexel;
uniform float uCurlStrength, uDt;
void main(){
  float l = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float c = texture(uCurl, vUv).x;

  /* N = ∇|ω| — wherever the twist is getting sharper, push the air
     that way, and the small eddies grow back into real ones */
  vec2 g = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  g /= length(g) + 1e-5;
  vec2 force = uCurlStrength * c * vec2(g.y, -g.x);
  outColor = vec4(texture(uVel, vUv).xy + force * uDt, 0.0, 1.0);
}`;

  const DIVERGE_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uVel;
uniform vec2 uTexel;
void main(){
  float l = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;
  /* nothing leaves through the edges of the frame */
  if (vUv.x < uTexel.x * 1.5) l = -r;
  if (vUv.x > 1.0 - uTexel.x * 1.5) r = -l;
  if (vUv.y < uTexel.y * 1.5) b = -t;
  if (vUv.y > 1.0 - uTexel.y * 1.5) t = -b;
  outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`;

  const PRESSURE_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uPressure, uDiv;
uniform vec2 uTexel;
void main(){
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float d = texture(uDiv, vUv).x;
  outColor = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}`;

  const GRADIENT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uPressure, uVel;
uniform vec2 uTexel;
void main(){
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVel, vUv).xy - vec2(r - l, t - b) * 0.5;
  if (vUv.x < uTexel.x * 1.5) v.x = -v.x;
  if (vUv.x > 1.0 - uTexel.x * 1.5) v.x = -v.x;
  if (vUv.y < uTexel.y * 1.5) v.y = -v.y;
  if (vUv.y > 1.0 - uTexel.y * 1.5) v.y = -v.y;
  outColor = vec4(clamp(v, -300.0, 300.0), 0.0, 1.0);
}`;

  const LIFT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uVel, uDye;
uniform float uBuoy, uDt;
void main(){
  /* bright dye rises, dark dye falls. The vertical force is simply
     how much of the dye underneath you there is */
  float d = dot(texture(uDye, vUv).rgb, vec3(0.34, 0.4, 0.26)) - 0.40;
  outColor = vec4(texture(uVel, vUv).xy + vec2(0.0, d * uBuoy * 190.0 * uDt), 0.0, 1.0);
}`;

  const SHOW_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uDye, uVel;
uniform vec3 uCold, uHot;

void main(){
  vec3 d = max(texture(uDye, vUv).rgb, vec3(0.0));
  vec2 v = texture(uVel, vUv).xy;

  /* the dye field holds a concentration, not a colour; the palette
     is applied here, and a curve keeps the thin wisps visible */
  float m = pow(clamp(dot(d, vec3(0.30, 0.50, 0.20)), 0.0, 1.0), 0.72);
  vec3 col = mix(uCold, uHot, m);
  col *= 0.14 + 1.55 * m;

  /* let the swirls catch the light: where the air is turning fastest
     the dye gets a little extra glow */
  col += vec3(0.30, 0.26, 0.46) * clamp(length(v) * 0.0022, 0.0, 0.45) * smoothstep(0.01, 0.35, m);

  outColor = vec4(col, clamp(m * 2.6, 0.0, 1.0));
}`;

  const MEDIUMS = {
    ink:    { cold: [0.04, 0.06, 0.15], hot: [0.62, 0.88, 1.00], dye: [0.62, 0.86, 1.00], buoy: 0.55, vort: 26, dissip: 0.22, n: 20 },
    smoke:  { cold: [0.08, 0.08, 0.10], hot: [0.95, 0.93, 0.88], dye: [1.00, 0.99, 0.96], buoy: 1.10, vort: 12, dissip: 0.30, n: 18 },
    storm:  { cold: [0.05, 0.04, 0.13], hot: [0.88, 0.58, 1.00], dye: [0.86, 0.66, 1.00], buoy: 0.30, vort: 46, dissip: 0.12, n: 24 },
    embers: { cold: [0.11, 0.03, 0.02], hot: [1.00, 0.74, 0.34], dye: [1.00, 0.72, 0.30], buoy: 1.80, vort: 30, dissip: 0.18, n: 18 },
  };

  const SIMW = 320;
  const ITER = 28;
  const STEP = 1 / 60;

  function boot() {
    const section = document.getElementById('weather');
    if (!section) return;
    const canvas = section.querySelector('[data-canvas]');
    const hud = section.querySelector('[data-hud]');
    canvas.style.aspectRatio = '16 / 9';
    canvas.style.width = '100%';

    const gl = makeGL(canvas);
    if (!gl || floatKind(gl) === 'none') { fallback(canvas); return; }

    let P;
    try {
      P = {
        advect: Program(gl, VS_QUAD, ADVECT_FS, 'fl.advect'),
        splat:  Program(gl, VS_QUAD, SPLAT_FS, 'fl.splat'),
        curl:   Program(gl, VS_QUAD, CURL_FS, 'fl.curl'),
        confine:Program(gl, VS_QUAD, CONFINE_FS, 'fl.confine'),
        diverge:Program(gl, VS_QUAD, DIVERGE_FS, 'fl.diverge'),
        press:  Program(gl, VS_QUAD, PRESSURE_FS, 'fl.pressure'),
        grad:   Program(gl, VS_QUAD, GRADIENT_FS, 'fl.gradient'),
        lift:   Program(gl, VS_QUAD, LIFT_FS, 'fl.lift'),
        show:   Program(gl, VS_QUAD, SHOW_FS, 'fl.show'),
      };
    } catch (e) { console.error(e); fallback(canvas); return; }
    const quad = Quad(gl);

    /* The grid carries the same shape as the window it is drawn
       into, and is a third of its size. Nobody can tell, and the
       twenty-eight sweep pressure solve stays affordable. */
    let SW = SIMW, SH = 169, aspect = SIMW / SH;
    const G = {};
    function build() {
      for (const k in G) G[k].dispose();
      for (const k of ['vel', 'dye', 'prs', 'div', 'crl']) G[k] = Flow(gl, SW, SH);
      for (const k of ['vel', 'dye', 'prs', 'div', 'crl']) G[k].clear(0, 0, 0, 1);
    }
    build();

    const state = Object.assign({ radius: 0.006 }, MEDIUMS.ink);
    let frames = 0, simSteps = 0, inked = 0, gust = 0;
    let last = { x: 0.5, y: 0.5 };

    /* one shader pass: bind the write buffer, draw, swap */
    const pass = (which, setup) => {
      G[which].target();
      setup();
      quad.draw();
      G[which].swap();
    };

    function splat(x, y, fx, fy, r, col, which, amount) {
      const key = which === 0 ? 'vel' : 'dye';
      G[key].target();
      P.splat.use()
        .set('uPoint', x, y)
        .set('uForce', fx, fy)
        .set('uRadius', r)
        .set('uAspect', aspect)
        .set('uAmount', amount)
        .set('uDye', col[0], col[1], col[2])
        .set('uWhich', which)
        .tex('uTarget', G[key].read, 0);
      quad.draw();
      G[key].swap();
    }

    /* Puffs, each with its own heading. The point is not that the
       dye moves — it is that a velocity field with structure in it
       shears the dye into structure, and then the structure takes
       over and the dye is only its evidence. */
    function reseed(n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 30 + Math.random() * 110;
        const x = 0.05 + Math.random() * 0.90;
        const y = Math.random() * 0.72;
        const r = 0.030 + Math.random() * 0.055;
        splat(x, y, Math.cos(a) * sp, Math.sin(a) * sp * 0.7 + 26, r, state.dye, 0, 0);
        splat(x, y, 0, 0, r, state.dye, 1, 1.0);
      }
      inked += n;
    }

    function step() {
      const texel = [1 / SW, 1 / SH];
      /* Drag is a rate per second, not a fraction per frame. Treating
         it as the latter makes the plate clean itself in a third of a
         second and then sit there, mysteriously empty. */
      const velKeep = clamp(1 - state.dissip * STEP * 2.2, 0.90, 1);
      const dyeKeep = clamp(1 - state.dissip * STEP * 0.55, 0.90, 1);

      /* 1. carry the velocity along itself */
      pass('vel', () => P.advect.use()
        .set('uTexel', ...texel).set('uDt', STEP).set('uDiss', velKeep)
        .tex('uVel', G.vel.read, 0).tex('uSrc', G.vel.read, 1));

      /* 2. buoyancy — bright dye climbs */
      if (state.buoy > 0) {
        pass('vel', () => P.lift.use()
          .set('uBuoy', state.buoy).set('uDt', STEP)
          .tex('uVel', G.vel.read, 0).tex('uDye', G.dye.read, 1));
      }

      /* 3. how much twist is in the air? */
      pass('crl', () => P.curl.use()
        .set('uTexel', ...texel).tex('uVel', G.vel.read, 0));

      /* 4. put the twist back — numerical diffusion ate it */
      if (state.vort > 0) {
        pass('vel', () => P.confine.use()
          .set('uTexel', ...texel).set('uCurlStrength', state.vort).set('uDt', STEP)
          .tex('uVel', G.vel.read, 0).tex('uCurl', G.crl.read, 1));
      }

      /* 5. how squashed is the air here? */
      pass('div', () => P.diverge.use()
        .set('uTexel', ...texel).tex('uVel', G.vel.read, 0));

      /* 6. find a pressure field that undoes the squashing */
      for (let i = 0; i < ITER; i++) {
        pass('prs', () => P.press.use()
          .set('uTexel', ...texel)
          .tex('uDiv', G.div.read, 1).tex('uPressure', G.prs.read, 0));
      }

      /* 7. take the pressure out of the velocity */
      pass('vel', () => P.grad.use()
        .set('uTexel', ...texel)
        .tex('uPressure', G.prs.read, 1).tex('uVel', G.vel.read, 0));

      /* 8. and finally carry the dye along the corrected air */
      pass('dye', () => P.advect.use()
        .set('uTexel', ...texel).set('uDt', STEP).set('uDiss', dyeKeep)
        .tex('uVel', G.vel.read, 0).tex('uSrc', G.dye.read, 1));

      simSteps++;
    }

    /* ── stirring ─────────────────────────────────────────────── */
    const ptr = pointer(canvas, {
      onDown() {
        last.x = ptr.x; last.y = ptr.y;
        splat(ptr.x, 1 - ptr.y, 0, -64, state.radius * 1.1, state.dye, 0, 0);
        splat(ptr.x, 1 - ptr.y, 0, 0, state.radius * 0.55, state.dye, 1, 0.95);
      },
      onMove() {
        if (!ptr.down) return;
        const dx = ptr.x - last.x, dy = ptr.y - last.y;
        const k = 620 * (state.radius / 0.006);
        if (Math.hypot(dx, dy) > 1e-6) {
          splat(ptr.x, 1 - ptr.y, dx * k, -dy * k, state.radius, state.dye, 0, 0);
          splat(ptr.x, 1 - ptr.y, dx * k * 0.45, -dy * k * 0.45,
            state.radius * 0.75, state.dye, 1, 0.85);
          last.x = ptr.x; last.y = ptr.y;
        }
      },
      onUp() { gust = Math.min(1, Math.hypot(ptr.dx, ptr.dy) * 26); },
    });

    const inst = SB.ui.register(section, {
      params: state,
      presets: MEDIUMS,
      onPreset(name, p) { reseed(p.n); },
      onAct() { for (const k in G) G[k].clear(0, 0, 0, 1); inked = 0; },
      status() { return 'weather · ' + fmtBig(SW * SH) + ' cells · ' + (ITER + 7) + ' passes/frame'; },
    });
    section.dataset.source = 'assets/js/weather.js';

    reseed(MEDIUMS.ink.n);

    const gate = gateFor(section, () => {});
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let acc = 0;
    startLoop((t, dt) => {
      if (!gate.visible) return;
      if (fit(canvas, 1.25)) {
        const r = canvas.getBoundingClientRect();
        const a = r.height > 4 ? r.width / r.height : 16 / 9;
        const h = clamp(Math.round(SIMW / a), 120, 360);
        if (h !== SH) { SH = h; aspect = SIMW / SH; build(); reseed(12); }
      }

      /* a fixed 60 Hz of imagined time, however fast the page runs */
      acc = Math.min(acc + dt, 120);
      let n = 0;
      while (acc >= 16.7 && n < 3) { step(); acc -= 16.7; n++; }

      /* a source along the floor and a slow draft overhead, so the
         plate is never completely still and never completely empty */
      if (frames % 2 === 0) {
        const bx = 0.5 + Math.sin(frames * 0.0022) * 0.30;
        splat(bx + (Math.random() - 0.5) * 0.10, 0.09,
          (Math.random() - 0.5) * 22, 40 + Math.random() * 40,
          0.062, state.dye, 1, 0.80);
      }
      if (frames % 9 === 0) {
        const a = frames * 0.017;
        splat(0.5 + Math.cos(a) * 0.30, 0.90 + Math.sin(a * 0.6) * 0.06,
          Math.sin(a) * 78, -26, 0.05, state.dye, 0, 0);
      }
      if (gust > 0.02) {
        splat(last.x, 1 - last.y, 0, -gust * 150, state.radius * 1.6, state.dye, 0, 0);
        gust *= 0.88;
      }
      frames++;

      /* ── show it ── */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.016, 0.022, 0.039, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      P.show.use()
        .set('uCold', ...state.cold)
        .set('uHot', ...state.hot)
        .tex('uDye', G.dye.read, 0)
        .tex('uVel', G.vel.read, 1);
      quad.draw();

      if (hud && frames % 8 === 0) {
        hud.textContent =
          (SW * SH).toLocaleString() + ' cells\n' +
          (ITER + 7) + ' passes / frame\n' +
          fmtBig(simSteps) + ' steps taken\n' +
          fmtBig(inked) + ' puffs of dye\n' +
          'buoyancy ' + state.buoy.toFixed(2) +
          '\nswirl ' + fmt(state.vort, 0) +
          '\ndrag ' + state.dissip.toFixed(2) +
          '\n' + fmt(SB.fpsNow(), 0) + ' fps';
      }
    });
  }

  function fallback(canvas) {
    const p = document.createElement('p');
    p.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:2rem;text-align:center;color:#9a9aa2;font-size:.8rem';
    p.textContent = 'This browser cannot render to floating-point textures, which the pressure solver needs. Chrome, Firefox and Safari all can.';
    canvas.style.display = 'none';
    canvas.parentElement.appendChild(p);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
