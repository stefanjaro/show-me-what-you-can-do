/* ═══════════════════════════════════════════════════════════════════
   culture.js — №1  ·  Two chemicals, no plan.

   The Gray–Scott reaction–diffusion system. A and B drift across a
   grid by diffusion; A is fed in at rate F; B eats A to make more of
   itself and dies at rate k. Everything else — stripes, coral,
   fingerprints, the reason a cow is patched — falls out of those
   four sentences.

     ∂A/∂t = Da∇²A − AB² + F(1 − A)
     ∂B/∂t = Db∇²B + AB² − (F + k)B

   Solved the lazy way: forward Euler on the CPU would be 65k cells of
   JavaScript per frame. Instead the whole grid is one fragment
   shader and the GPU runs every cell in parallel.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { Program, Quad, Flow, makeGL, VS_QUAD, fit, clamp, rand, randi,
          fmt, fmtBig, gateFor, startLoop, pointer } = SB;

  const SH = 256;           // simulation cells along the short side

  const STEP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState;
uniform vec2  uTexel;
uniform float uFeed;     // F — how much A is poured in
uniform float uKill;     // k — how fast B is taken away
uniform float uDa;       // diffusion of A
uniform float uDb;       // diffusion of B
uniform float uDt;

void main(){
  /* 9-point Laplacian. The diagonal corners are weighted so the
     stencil is isotropic — without them the grid betrays itself
     and every pattern comes out square. */
  vec2 t = uTexel;
  vec4 c  = texture(uState, vUv);
  float A = c.r, B = c.g;

  float aN  = texture(uState, vUv + vec2( 0.0,  t.y)).r;
  float aS  = texture(uState, vUv + vec2( 0.0, -t.y)).r;
  float aE  = texture(uState, vUv + vec2( t.x,  0.0)).r;
  float aW  = texture(uState, vUv + vec2(-t.x,  0.0)).r;
  float aNE = texture(uState, vUv + t).r;
  float aNW = texture(uState, vUv + vec2(-t.x,  t.y)).r;
  float aSE = texture(uState, vUv + vec2( t.x, -t.y)).r;
  float aSW = texture(uState, vUv - t).r;

  float bN  = texture(uState, vUv + vec2( 0.0,  t.y)).g;
  float bS  = texture(uState, vUv + vec2( 0.0, -t.y)).g;
  float bE  = texture(uState, vUv + vec2( t.x,  0.0)).g;
  float bW  = texture(uState, vUv + vec2(-t.x,  0.0)).g;
  float bNE = texture(uState, vUv + t).g;
  float bNW = texture(uState, vUv + vec2(-t.x,  t.y)).g;
  float bSE = texture(uState, vUv + vec2( t.x, -t.y)).g;
  float bSW = texture(uState, vUv - t).g;

  float lapA = (aN + aS + aE + aW) * 0.2 + (aNE + aNW + aSE + aSW) * 0.05 - A;
  float lapB = (bN + bS + bE + bW) * 0.2 + (bNE + bNW + bSE + bSW) * 0.05 - B;

  float rx = A * B * B;
  float nA = A + (uDa * lapA - rx + uFeed * (1.0 - A)) * uDt;
  float nB = B + (uDb * lapB + rx - (uFeed + uKill) * B) * uDt;

  outColor = vec4(clamp(nA, 0.0, 1.0), clamp(nB, 0.0, 1.0), 0.0, 1.0);
}`;

  /* Soft brush along a segment — the visitor's finger, in chemistry. */
  const BRUSH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;
uniform vec2  uP0, uP1;
uniform float uRadius;
uniform float uAmount;

void main(){
  vec2 s = texture(uState, vUv).xy;
  vec2 pa = vUv - uP0, ba = uP1 - uP0;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  float d = length(pa - ba * h);
  float m = smoothstep(uRadius, 0.0, d);
  s.y += uAmount * m;
  s.x -= uAmount * m * 0.45;
  outColor = vec4(clamp(s, 0.0, 1.0), 0.0, 1.0);
}`;

  const WIPE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uSeed;   // 0 = sterilise, >0 = sterilise then inoculate
void main(){
  vec2 p = vUv * 6.0;
  float n = fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  float blob = step(0.9965 - uSeed * 0.02, n);
  outColor = vec4(1.0, blob, 0.0, 1.0);
}`;

  /* The relief. B is treated as a height field, lit from the upper
     left, with a cool shadow in the trenches and a wet specular on
     the ridges. It stops looking like maths and starts looking like
     something that grew. */
  const DRAW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;
uniform vec2  uTexel;
uniform float uRelief;
uniform vec3  uDeep, uMid, uRidge, uSpec, uKey;

float H(vec2 uv){ return texture(uState, uv).g; }

void main(){
  vec2 t = uTexel * uRelief;

  float h  = H(vUv);
  float hL = H(vUv - vec2(t.x, 0.0));
  float hR = H(vUv + vec2(t.x, 0.0));
  float hD = H(vUv - vec2(0.0, t.y));
  float hU = H(vUv + vec2(0.0, t.y));

  vec3 n = normalize(vec3((hL - hR) * 3.2, (hD - hU) * 3.2, 0.14));
  vec3 L = normalize(uKey);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 R = reflect(-L, n);

  float lam = max(dot(n, L), 0.0);
  float back = max(dot(n, -L), 0.0);
  float spec = pow(max(dot(R, V), 0.0), 46.0);
  float fres = pow(1.0 - max(n.z, 0.0), 3.0);

  /* where the film is thick, the base colour comes forward */
  float band = smoothstep(0.02, 0.16, h);
  float crest = smoothstep(0.24, 0.52, h);

  vec3 col = mix(uDeep, uMid, band);
  col = mix(col, uRidge, crest * 0.85);

  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.30, h));
  col *= (0.20 + 1.05 * lam) * ao;
  col += uRidge * back * 0.055;
  col += uSpec * spec * (0.35 + 0.65 * band);
  col += uMid * fres * 0.10 * band;

  /* faint concentric interference in the flat regions, so still
     areas still breathe */
  float rings = sin(h * 120.0 - 1.2) * 0.5 + 0.5;
  col += uRidge * rings * 0.012 * (1.0 - band);

  outColor = vec4(col, 1.0);
}`;

  const PRESETS = {
    coral:    { f: 0.0545, k: 0.0620 },
    mitosis:  { f: 0.0367, k: 0.0649 },
    worms:    { f: 0.0780, k: 0.0610 },
    spots:    { f: 0.0350, k: 0.0650 },
    solitons: { f: 0.0300, k: 0.0620 },
    chaos:    { f: 0.0260, k: 0.0510 },
  };

  function boot() {
    const section = document.getElementById('culture');
    if (!section) return;
    const canvas = section.querySelector('[data-canvas]');
    const hud = section.querySelector('[data-hud]');
    canvas.style.aspectRatio = '16 / 9';
    canvas.style.width = '100%';

    const gl = makeGL(canvas);
    if (!gl) { fallbackCPU(canvas, section); return; }

    const params = Object.assign({ f: 0.0545, k: 0.0620, speed: 14 }, PRESETS.coral);

    let stepP, brushP, wipeP, drawP, quad;
    try {
      stepP  = Program(gl, VS_QUAD, STEP_FS, 'rd.step');
      brushP = Program(gl, VS_QUAD, BRUSH_FS, 'rd.brush');
      wipeP  = Program(gl, VS_QUAD, WIPE_FS, 'rd.wipe');
      drawP  = Program(gl, VS_QUAD, DRAW_FS, 'rd.draw');
      quad = Quad(gl);
    } catch (e) {
      console.error(e);
      fallbackCPU(canvas, section);
      return;
    }

    let flow = null, sw = 0, sh = 0, steps = 0, frameN = 0;
    let spsAcc = 0, spsN = 0;
    const pt = { x: 0, y: 0, px: 0, py: 0, lastx: -1, lasty: -1 };

    function wipe(amount) {
      wipeP.use().set('uSeed', amount);
      flow.target();
      quad.draw();
      flow.swap();
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (r.width < 4) return;
      const aspect = r.width / r.height;
      const w = aspect >= 1 ? SH : Math.round(SH * aspect);
      const h = aspect >= 1 ? Math.round(SH / aspect) : SH;
      if (w === sw && h === sh) return;
      sw = w; sh = h;
      if (flow) flow.dispose();
      flow = Flow(gl, sw, sh);
      wipe(0.55);
      steps = 0;
    }

    /* a line brush, so fast drags don't leave dotted trails */
    function brush(x0, y0, x1, y1, amount, radius) {
      const r = Math.hypot(x1 - x0, y1 - y0);
      const steps2 = clamp(Math.ceil(r / (radius * 0.5)), 1, 24);
      for (let i = 0; i < steps2; i++) {
        const s0 = i / steps2, s1 = (i + 1) / steps2;
        brushP.use()
          .set('uP0', x0 + (x1 - x0) * s0, 1 - (y0 + (y1 - y0) * s0))
          .set('uP1', x0 + (x1 - x0) * s1, 1 - (y0 + (y1 - y0) * s1))
          .set('uRadius', radius)
          .set('uAmount', amount / steps2)
          .tex('uState', flow.read, 0);
        flow.target();
        quad.draw();
        flow.swap();
      }
      steps += steps2;
    }

    const ptr = pointer(canvas, {
      onDown() { pt.lastx = -1; },
      onMove(q) {
        if (!q.down) return;
        const y = 1 - q.y;
        if (pt.lastx < 0) { pt.lastx = q.x; pt.lasty = y; }
        brush(pt.lastx, pt.lasty, q.x, y, 0.42, 0.014);
        pt.lastx = q.x; pt.lasty = y;
      },
    });

    const inst = SB.ui.register(section, {
      params,
      presets: PRESETS,
      source: 'assets/js/culture.js',
      onPreset(name) {
        if (name in PRESETS) wipe(0.6);
      },
      onAct(name) {
        wipe(name === 'clear' ? 0 : 0.75);
      },
      status() { return 'culture · ' + fmtBig(steps * (sw * sh)) + ' cell-updates/s'; },
    });
    section.dataset.source = 'assets/js/culture.js';

    /* palette — deep ink, warm ridge, bone crest */
    const PAL = {
      deep:  [0.035, 0.043, 0.062],
      mid:   [0.360, 0.250, 0.105],
      ridge: [0.980, 0.880, 0.700],
      spec:  [1.000, 0.960, 0.860],
      key:   [-0.45, 0.62, 0.64],
    };

    resize();
    window.addEventListener('resize', resize);

    const gate = gateFor(section, () => {});
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    startLoop((t, dt) => {
      if (!gate.visible) return;
      if (fit(canvas, 1.3)) resize();

      /* ── the arithmetic ── */
      const n = Math.round(inst.params.speed);
      for (let i = 0; i < n; i++) {
        stepP.use()
          .set('uTexel', 1 / sw, 1 / sh)
          .set('uFeed', inst.params.f)
          .set('uKill', inst.params.k)
          .set('uDa', 1.0).set('uDb', 0.5).set('uDt', 1.0)
          .tex('uState', flow.read, 0);
        flow.target();
        quad.draw();
        flow.swap();
      }
      steps += n;
      spsAcc += n; spsN++;
      if (spsAcc > 24) { spsAcc = 0; spsN = 0; }

      /* ── the looking at ── */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      drawP.use()
        .set('uTexel', 1 / sw, 1 / sh)
        .set('uRelief', 2.2)
        .set('uDeep', ...PAL.deep)
        .set('uMid', ...PAL.mid)
        .set('uRidge', ...PAL.ridge)
        .set('uSpec', ...PAL.spec)
        .set('uKey', ...PAL.key)
        .tex('uState', flow.read, 0);
      quad.draw();

      if (hud && (frameN++ % 12 === 0)) {
        hud.textContent =
          (sw * sh).toLocaleString() + ' cells\n' +
          fmtBig(steps) + ' steps taken\n' +
          'F ' + inst.params.f.toFixed(4) + '\nk ' + inst.params.k.toFixed(4) + '\n' +
          fmt(SB.fpsNow(), 0) + ' fps · ' + SB.floatKind(gl);
      }
    });
  }

  /* ── no WebGL2? the same equations, in JavaScript, 128×128 ────── */
  function fallbackCPU(canvas, section) {
    canvas.style.aspectRatio = '16 / 9';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 128, H = 128;
    let A = new Float32Array(W * H).fill(1), B = new Float32Array(W * H);
    let A2 = new Float32Array(W * H), B2 = new Float32Array(W * H);
    for (let i = 0; i < 40; i++) {
      const cx = randi(W), cy = randi(H);
      for (let y = -4; y < 5; y++) for (let x = -4; x < 5; x++)
        B[((cy + y + H) % H) * W + ((cx + x + W) % W)] = 1;
    }
    const img = ctx.createImageData(W, H);
    const st = { f: 0.0545, k: 0.062, speed: 6 };
    const T = (a, x, y) => a[((y + H) % H) * W + ((x + W) % W)];
    SB.ui.register(section, {
      params: st, presets: PRESETS,
      onAct() { for (let i = 0; i < B.length; i++) { B[i] = Math.random() < 0.002 ? 1 : 0; } },
      status() { return 'culture · software solver'; },
    });
    const gate = gateFor(section, () => {});
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const offCtx = off.getContext('2d');
    let steps = 0;
    SB.startLoop(() => {
      if (!gate.visible) return;
      for (let s = 0; s < st.speed; s++) {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const lA = T(A, x, y - 1) + T(A, x, y + 1) + T(A, x - 1, y) + T(A, x + 1, y)
                   + 0.05 * (T(A, x - 1, y - 1) + T(A, x + 1, y - 1) + T(A, x - 1, y + 1) + T(A, x + 1, y + 1)) - 4 * A[i];
          const lB = T(B, x, y - 1) + T(B, x, y + 1) + T(B, x - 1, y) + T(B, x + 1, y)
                   + 0.05 * (T(B, x - 1, y - 1) + T(B, x + 1, y - 1) + T(B, x - 1, y + 1) + T(B, x + 1, y + 1)) - 4 * B[i];
          const r = A[i] * B[i] * B[i];
          A2[i] = clamp(A[i] + (lA - r + st.f * (1 - A[i])) * 0.25, 0, 1);
          B2[i] = clamp(B[i] + (lB * 0.5 + r - (st.f + st.k) * B[i]) * 0.25, 0, 1);
        }
        [A, A2] = [A2, A]; [B, B2] = [B2, B]; steps++;
      }
      const d = img.data;
      for (let i = 0; i < W * H; i++) {
        const h = B[i];
        d[i * 4] = clamp(18 + h * 240, 0, 255);
        d[i * 4 + 1] = clamp(12 + h * 224, 0, 255);
        d[i * 4 + 2] = clamp(20 + h * 190, 0, 255);
        d[i * 4 + 3] = 255;
      }
      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(off, 0, 0, W, H, 0, 0, canvas.width, canvas.height);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();