/* ═══════════════════════════════════════════════════════════════════
   light.js — №3  ·  There is no geometry in this picture.

   A Cornell box: five walls, one lamp, four spheres. No vertices, no
   triangles, no textures, no meshes of any kind. What there is, is
   one honest question:

       if a photon left that lamp in this direction, what does it
       hit, and what does it hit next, and what does it hit after
       that?

   Ask it four hundred thousand times a second, average the answers,
   and the image assembles itself. The soft shadow is nobody's
   decision. The pink cast on the white floor is the red wall
   reflecting into it, correctly, because the only rule that was ever
   implemented was ∫L·cosθ·dω, over and over.

   Radiance transport, in full:

     L(x₀, ω) = L(xₜ, ωₜ) · β(xₜ, −ωₜ, ω)
     β        = albedo · cos θ / π           (Lambertian, sampled)
     E[L]     = (1/N) Σ Lᵢ                    (Monte Carlo, N → ∞)

   Two floating-point render targets and a fragment shader. That is
   the whole renderer.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { Program, Quad, Flow, makeGL, VS_QUAD, fit, clamp, fmt, fmtBig,
          gateFor, startLoop, pointer, reduced, floatKind } = SB;

  /* ── materials ─────────────────────────────────────────────── */
  const M = { WHITE: 0, RED: 1, GREEN: 2, MIRROR: 3, GLASS: 4, GLOSSY: 5, WARM: 6, EMIT: 7 };
  const EYE_H = 0.06;   // the camera stands on a stool, not on the floor

  const TRACE_FS = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPrev;      // the running total
uniform vec2  uRes;
uniform uint  uFrame;         // which sample this is
uniform int   uSpp;           // samples already accumulated
uniform vec3  uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uFocal, uAperture, uFocus;
uniform float uLight, uRough, uIor;
uniform int   uDepth, uPaths;

const float PI = 3.14159265359;
const float INF = 1e30;
const int  M_WHITE = 0, M_RED = 1, M_GREEN = 2, M_MIRROR = 3,
          M_GLASS = 4, M_GLOSSY = 5, M_WARM = 6, M_EMIT = 7;

/* ── random numbers ─────────────────────────────────────────
   PCG. A cheap xorshift-hash is fine too, but this one has a much
   longer period and it costs exactly the same. */
uint  rngState;
uint pcg(inout uint s){
  s = s * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(){ return float(pcg(rngState)) * (1.0 / 4294967296.0); }
vec2  rnd2(){ return vec2(rnd(), rnd()); }

/* ── the scene ──────────────────────────────────────────────
   Four analytic spheres and five planes. That's the entire model. */
struct Hit { float t; vec3 n; vec3 alb; int mat; float rough; vec3 emit; };

/* the box is wider than it is tall, 16:9, so that a camera placed
   outside it sees the interior fill the frame edge to edge with no
   void anywhere. A cubic box in a 16:9 window is a box in a letterbox. */
const vec3 BOX = vec3(1.62, 1.0, 1.0);

/* 1/direction, without dividing by zero. The only thing that matters
   here is that the sign of the result is the sign of the input — an
   earlier version used sign() to dodge the zero case and quietly
   inverted half the ray directions, which made every ray miss the
   box and the whole render come out black. */
vec3 safeInv(vec3 v){
  vec3 m = max(abs(v), vec3(1e-9));
  return vec3(v.x < 0.0 ? -1.0 : 1.0,
              v.y < 0.0 ? -1.0 : 1.0,
              v.z < 0.0 ? -1.0 : 1.0) / m;
}
float sgn1(float v){ return v < 0.0 ? -1.0 : 1.0; }

/* the lamp: a slab of light hanging in the room, so that you can
   see where the light is coming from — which is the whole argument */
bool hitLamp(vec3 ro, vec3 rd, float tmax, out float t){
  if (abs(rd.y) < 1e-8) return false;
  t = (0.520 - ro.y) / rd.y;
  if (t < 1e-4 || t > tmax) return false;
  vec3 p = ro + rd * t;
  return abs(p.x) < 0.30 && abs(p.z) < 0.26;
}

/* the box: a closed room with five of the six walls painted.
   The camera sits inside it, which is how a Cornell box has always
   been drawn — with the lamp overhead, one wall red, one wall green,
   and a polished sphere to show you what the walls are doing. */
bool hitBox(vec3 ro, vec3 rd, float tmax, out float t, out vec3 n, out int mat){
  vec3 iv = safeInv(rd);
  vec3 a = (-BOX - ro) * iv, b = (BOX - ro) * iv;
  vec3 lo = min(a, b), hi = max(a, b);
  float tmin  = max(max(lo.x, lo.y), lo.z);
  float tmaxb = min(min(hi.x, hi.y), hi.z);
  if (tmaxb < 1e-4) return false;

  int ax; float wall; float tt;
  if (tmin > 1e-4) {                       // came in from outside
    ax   = (tmin == lo.x) ? 0 : ((tmin == lo.y) ? 1 : 2);
    wall = (ax == 0) ? -sgn1(rd.x) : (ax == 1) ? -sgn1(rd.y) : -sgn1(rd.z);
    tt   = tmin;
  } else {                                 // already inside: leave through a wall
    tt   = tmaxb;
    ax   = (tmaxb == hi.x) ? 0 : ((tmaxb == hi.y) ? 1 : 2);
    wall = (ax == 0) ? sgn1(rd.x) : (ax == 1) ? sgn1(rd.y) : sgn1(rd.z);
  }
  if (tt < 1e-4 || tt > tmax) return false;

  /* the normal always faces back into the room, whichever side of
     the slab we happened to arrive from */
  float face = (tmin > 1e-4) ? wall : -wall;
  t = tt;
  if (ax == 0) { n = vec3(face, 0.0, 0.0); mat = wall < 0.0 ? M_RED : M_GREEN; }
  else if (ax == 1) { n = vec3(0.0, face, 0.0); mat = M_WHITE; }
  else { n = vec3(0.0, 0.0, face); mat = M_WHITE; }
  return true;
}

bool hitSphere(vec3 ro, vec3 rd, vec3 c, float r, float tmax, out float t, out vec3 n){
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cq = dot(oc, oc) - r * r;
  float h = b * b - cq;
  if (h < 0.0) return false;
  h = sqrt(h);
  t = -b - h;
  if (t < 1e-4) t = -b + h;
  if (t < 1e-4 || t > tmax) return false;
  n = (ro + rd * t - c) / r;
  return true;
}

bool trace(vec3 ro, vec3 rd, out Hit h){
  float best = INF;
  h.mat = M_WHITE; h.rough = 0.0; h.emit = vec3(0.0);

  float t; vec3 n; int m;
  if (hitBox(ro, rd, best, t, n, m)) {
    best = t; h.t = t; h.n = n; h.mat = m;
    h.alb = m == M_RED ? vec3(0.50, 0.055, 0.048)
          : m == M_GREEN ? vec3(0.055, 0.30, 0.085)
          : vec3(0.73, 0.725, 0.705);
  }
  float lt;
  if (hitLamp(ro, rd, best, lt)) {
    best = lt; h.t = lt; h.n = vec3(0, -1, 0); h.mat = M_EMIT;
    h.emit = vec3(1.0, 0.945, 0.86) * uLight;
  }
  vec3 sc[4] = vec3[4](
    vec3(-0.94, -0.36, -0.16),   // mirror, against the red wall
    vec3( 0.88, -0.31, -0.10),   // glass, against the green wall
    vec3(-0.10, -0.38,  0.14),   // glossy, low and near the middle
    vec3( 0.86, -0.27, -0.52)    // a small warm one, to be refracted
  );
  float sr[4] = float[4](0.36, 0.34, 0.22, 0.13);
  int   sm[4] = int[4](M_MIRROR, M_GLASS, M_GLOSSY, M_WARM);
  for (int i = 0; i < 4; i++) {
    if (!hitSphere(ro, rd, sc[i], sr[i], best, t, n)) continue;
    best = t; h.t = t; h.n = n; h.mat = sm[i];
    h.alb = sm[i] == M_WARM ? vec3(0.72, 0.44, 0.12) : vec3(0.5);
  }
  return best < INF;
}

vec3 cosineDir(vec3 n, out vec3 t, out vec3 bt){
  float s = rnd() * 2.0 - 1.0, a = rnd() * 2.0 * PI, r = sqrt(1.0 - s * s);
  vec3 w = normalize(abs(n.x) > 0.7 ? vec3(0, 1, 0) : vec3(1, 0, 0));
  t = normalize(cross(n, w));
  bt = cross(n, t);
  return normalize(t * (r * cos(a)) + bt * (r * sin(a)) + n * s);
}

vec3 reflectDir(vec3 d, vec3 n, float rough){
  vec3 t, bt;
  cosineDir(n, t, bt);
  /* a rough surface scatters the mirror direction over a cone */
  return normalize(reflect(d, n) + (t * rnd() - bt * rnd()) * rough * rough * 2.2);
}

float schlick(float ci, float eta){
  float r0 = (1.0 - eta) / (1.0 + eta);
  r0 *= r0;
  return r0 + (1.0 - r0) * pow(1.0 - ci, 5.0);
}

/* there is no sun, no moon and no atmosphere in here. Rays that
   leave the box find almost nothing, which is exactly why the box
   looks like it is floating in the dark. */
vec3 sky(vec3 d){
  return mix(vec3(0.004, 0.005, 0.008), vec3(0.010, 0.011, 0.015), d.y * 0.5 + 0.5);
}

/* ── direct lighting ─────────────────────────────────────────
   The reason a naive path tracer looks like static: the lamp is a
   small bright thing, and a cosine-sampled ray almost never happens
   to land on it. You wait minutes for a few lucky photons and the
   picture stays full of fireflies.

   So: at every diffuse surface, pick one random point on the lamp,
   walk a single shadow ray straight at it, and add what arrives. One
   extra intersection per bounce, and the noise collapses. The lamp
   is then taken out of the random walk for non-specular paths, so it
   is never counted twice. */
const float LAMP_HX = 0.30, LAMP_HZ = 0.26;
const float LAMP_AREA = (2.0 * LAMP_HX) * (2.0 * LAMP_HZ);

vec3 directLight(vec3 p, vec3 n, vec3 alb){
  vec3 q = vec3((rnd() * 2.0 - 1.0) * LAMP_HX, 0.520, (rnd() * 2.0 - 1.0) * LAMP_HZ);
  vec3 d = q - p;
  float d2 = max(dot(d, d), 1e-4);
  vec3 wi = d * inversesqrt(d2);
  float cosS = dot(n, wi);
  if (cosS <= 0.0) return vec3(0.0);
  float cosL = wi.y;                       // the lamp faces straight down
  if (cosL <= 0.0) return vec3(0.0);

  Hit sh;
  if (!trace(p + n * 3e-3, wi, sh)) return vec3(0.0);
  if (sh.mat != M_EMIT) return vec3(0.0);  // something was in the way

  /* albedo/π · L · cosθ · cosθ' · A / d² */
  return alb * vec3(1.0, 0.945, 0.86) * uLight * (cosS * cosL * LAMP_AREA / (PI * d2));
}

vec3 radiance(vec3 ro, vec3 rd){
  vec3 L = vec3(0.0), beta = vec3(1.0);
  bool spec = true;                 // still in a chain of mirrors?

  for (int depth = 0; depth < uDepth; depth++) {
    Hit h;
    if (!trace(ro, rd, h)) { L += beta * sky(rd); break; }

    /* the lamp only contributes here if we got to it through
       reflections, because diffuse surfaces already looked for it */
    if (h.mat == M_EMIT) { if (spec) L += beta * h.emit; break; }

    /* where we actually are. Everything below offsets from this
       point and not from ro, which on the first bounce is still
       the camera — a bug that renders every mirror black. */
    vec3 p = ro + rd * h.t;

    if (h.mat == M_GLASS) {
      float eta = dot(rd, h.n) < 0.0 ? uIor : 1.0 / uIor;
      float ci = -dot(rd, eta > 1.0 ? -h.n : h.n);
      float F = schlick(clamp(ci, 0.0, 1.0), eta);
      if (rnd() < F) { rd = reflect(rd, h.n); ro = p + h.n * 1e-4; spec = true; continue; }
      vec3 t = refract(rd, h.n, eta);
      if (dot(t, t) < 1e-6) { rd = reflect(rd, h.n); ro = p + h.n * 1e-4; spec = true; continue; }
      rd = normalize(t);
      ro = p - h.n * 1e-4;
      beta *= exp(-0.10 * vec3(0.06, 0.02, 0.01));
      spec = true;
      continue;
    }

    if (h.mat == M_MIRROR) {
      rd = reflect(rd, h.n);
      ro = p + h.n * 1e-4;
      spec = true;
      continue;
    }

    if (h.mat == M_GLOSSY) {
      /* a rough coat over a diffuse body: sample the coat separately,
         and let the body look for the lamp as usual */
      L += beta * directLight(p, h.n, h.alb);
      float F = schlick(clamp(dot(-rd, h.n), 0.0, 1.0), 1.55);
      if (rnd() < F * 0.85) {
        rd = reflectDir(rd, h.n, uRough);
        beta *= mix(vec3(0.045), h.alb, uRough);
        ro = p + h.n * 1e-4;
        spec = true;
      } else {
        vec3 t, bt;
        rd = cosineDir(h.n, t, bt);
        beta *= h.alb;
        ro = p + h.n * 1e-4;
        spec = false;
      }
    } else {
      L += beta * directLight(p, h.n, h.alb);
      vec3 t, bt;
      rd = cosineDir(h.n, t, bt);
      beta *= h.alb;
      ro = p + h.n * 1e-4;
      spec = false;
    }

    /* Russian roulette: once a path has dimmed, killing it is cheaper
       than carrying it. Dividing what survives keeps the average
       honest. */
    if (depth > 2) {
      float q = clamp(max(beta.r, max(beta.g, beta.b)), 0.05, 0.98);
      if (rnd() > q) break;
      beta /= q;
    }
  }
  /* a single path that got lucky should not be allowed to ruin the
     average. Everything real in this scene is under 30. */
  return min(L, vec3(60.0));
}

void main(){
  uint seed = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uFrame * 26699u;
  rngState = seed | 1u;
  for (int k = 0; k < 8; k++) pcg(rngState);      // warm up

  vec3 sum = vec3(0.0);
  /* A handful of paths per pixel per frame. More is fewer seconds,
     not better pixels — the running average is the point. How many
     is chosen by looking at the frame rate. */
  for (int s = 0; s < uPaths; s++) {
    vec2 jit = rnd2() - 0.5;
    vec2 uv = (gl_FragCoord.xy + jit) * 2.0 - uRes;
    vec3 dir = normalize(uv.x / uRes.y * uCamRight + uv.y / uRes.y * uCamUp + uFocal * uCamFwd);

    vec3 ro = uCamPos;
    if (uAperture > 0.0001) {
      /* thin lens: pick a point on the aperture, aim at the focal plane */
      float a = rnd() * 2.0 * PI, r = sqrt(rnd()) * uAperture;
      vec3 off = uCamRight * cos(a) * r + uCamUp * sin(a) * r;
      ro += off;
      dir = normalize(dir - off / uFocus);
    }
    sum += radiance(ro, dir);
  }

  vec3 prev = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).rgb;
  outColor = vec4(prev + sum, 1.0);
}`;

  const SHOW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAccum;
uniform float uSpp, uExposure;

vec3 aces(vec3 x){
  /* the filmic curve Narkowicz fitted in 2015 — three coefficients
     of polynomial standing in for a hundred years of chemistry */
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main(){
  vec3 c = texture(uAccum, vUv).rgb / max(uSpp, 1.0);
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));

  /* a whisper of vignette and grain, so it reads as a photograph
     rather than as a spreadsheet */
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.42;
  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * 0.012;
  outColor = vec4(c, 1.0);
}`;

  const VIEWS = {
    box:    { yaw: 0.00, pitch: -0.17, dist: 0.86, aperture: 0.010, rough: 0.10, ior: 1.52 },
    glass:  { yaw: -0.13, pitch: -0.20, dist: 0.50, aperture: 0.050, rough: 0.02, ior: 1.95 },
    mirror: { yaw: 0.24, pitch: -0.09, dist: 0.58, aperture: 0.036, rough: 0.60, ior: 1.52 },
    orbit:  { yaw: 0.00, pitch: -0.15, dist: 0.86, aperture: 0.020, rough: 0.12, ior: 1.52 },
  };

  function boot() {
    const section = document.getElementById('light');
    if (!section) return;
    const canvas = section.querySelector('[data-canvas]');
    const hud = section.querySelector('[data-hud]');
    canvas.style.aspectRatio = '16 / 9';
    canvas.style.width = '100%';

    const gl = makeGL(canvas);
    if (!gl || floatKind(gl) === 'none') { noFloat(canvas, section); return; }

    let traceP, showP, quad;
    try {
      traceP = Program(gl, VS_QUAD, TRACE_FS, 'pt.trace');
      showP = Program(gl, VS_QUAD, SHOW_FS, 'pt.show');
      quad = Quad(gl);
    } catch (e) { console.error(e); noFloat(canvas, section); return; }

    let acc = null, aw = 0, ah = 0;
    /* if the machine cannot hold a frame rate at full resolution,
       step down once or twice and stop asking. Never step back up:
       a resolution that oscillates is worse than one that is low. */
    let quality = 1, slowFrames = 0;
    const cam = { yaw: 0.00, pitch: -0.17, dist: 0.86, auto: false, dragging: false };
    let spp = 0, frame = 0, lastKey = '';
    let pathsPerSec = 0, pathAcc = 0, lastPathT = performance.now();

    /* Internal resolution, chosen by pixel *count* rather than by
       fraction of the window, so a huge monitor does not quietly
       quadruple the cost. Progressive averaging fills in the detail,
       so trading pixels for samples is free quality once it settles. */
    const BUDGET = 250000;
    function resize() {
      const r = canvas.getBoundingClientRect();
      if (r.width < 8) return;
      const fit2 = Math.sqrt(BUDGET / Math.max(1, r.width * r.height));
      const scale = Math.min(0.7, Math.max(0.24, fit2)) * quality;
      const w = Math.max(120, Math.round(r.width * scale));
      const h = Math.max(80, Math.round(r.height * scale));
      if (w === aw && h === ah) return;
      aw = w; ah = h;
      if (acc) acc.dispose();
      acc = Flow(gl, aw, ah);
      acc.clear(0, 0, 0, 1);
      spp = 0;
    }

    /* anything that changes what a photon would do resets the average */
    function invalidate() { spp = 0; }

    function applyView(v) {
      cam.yaw = v.yaw; cam.pitch = v.pitch; cam.dist = v.dist;
      cam.auto = (v === VIEWS.orbit);
      invalidate();
    }

    const params = {
      exposure: 1.15, rough: 0.10, bounces: 6, light: 30, ior: 1.52, aperture: 0.010,
    };

    const inst = SB.ui.register(section, {
      params,
      presets: VIEWS,
      onPreset(name, p) {
        applyView(VIEWS[name]);
        Object.assign(params, {
          rough: VIEWS[name].rough, ior: VIEWS[name].ior, aperture: VIEWS[name].aperture,
        });
        invalidate();
      },
      onChange(p) { invalidate(); },
      onAct() { cam.auto = !cam.auto; invalidate(); },
      status() { return 'tracing · ' + fmtBig(spp * aw * ah * 2) + ' paths so far'; },
    });
    section.dataset.source = 'assets/js/light.js';

    /* ── camera ─────────────────────────────────────────────────── */
    pointer(canvas, {
      onDown() { cam.dragging = true; cam.auto = false; },
      onUp() { cam.dragging = false; },
      onMove(q) {
        if (!q.down) return;
        cam.yaw -= q.dx * 3.4;
        cam.pitch = clamp(cam.pitch + q.dy * 2.4, -0.55, 0.60);
        invalidate();
      },
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.09), 0.40, 1.30);
      invalidate();
    }, { passive: false });

    resize();
    window.addEventListener('resize', resize);

    /* ── render ─────────────────────────────────────────────────── */
    const basis = { r: [0, 0, 0], u: [0, 0, 0], f: [0, 0, 0], p: [0, 0, 0] };

    /* The camera stands on a circle inside the room and looks at the
       middle of it; the drag tilts its gaze up and down without
       letting it float through the floor. Orbiting in a horizontal
       plane only is duller than a free orbit and much less likely to
       walk the camera into a wall. */
    function updateCamera(t) {
      if (cam.auto) { cam.yaw = t * 0.00016; invalidate(); }
      const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
      const p = [sy * cam.dist, EYE_H, cy * cam.dist];

      let f = [-sy, 0, -cy];                       // toward the middle
      let r = [cy, 0, -sy];                        // f × worldUp
      let u = [0, 1, 0];
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      basis.f = [f[0] * cp + u[0] * sp, f[1] * cp + u[1] * sp, f[2] * cp + u[2] * sp];
      basis.u = [u[0] * cp - f[0] * sp, u[1] * cp - f[1] * sp, u[2] * cp - f[2] * sp];
      basis.r = r;
      basis.p = p;
      return Math.hypot(p[0], p[1], p[2]);
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const gate = gateFor(section, () => {});
    let frameN = 0;

    startLoop((ts) => {
      if (!gate.visible) return;
      if (fit(canvas, 1.4)) resize();
      if (!acc) return;
      frameN++;

      /* If the machine cannot hold a frame rate, step the internal
         resolution down once and then once more, and stop. Never
         step it back up: a resolution that oscillates restarts the
         average every few seconds, and a restarting average is far
         worse than a permanently modest one. */
      if (quality > 0.5) {
        if (SB.fpsNow() < 20) {
          if (++slowFrames > 70) { quality = quality > 0.7 ? 0.68 : 0.47; slowFrames = 0; aw = -1; resize(); }
        } else slowFrames = 0;
      }

      const focus = updateCamera(ts);
      const p = inst.params;
      /* spend what the machine can spare: a slow device gets one path
         per pixel and takes longer to settle, a fast one gets three */
      const paths = SB.fpsNow() < 20 ? 1 : (SB.fpsNow() < 40 ? 2 : 3);

      /* ── accumulate two paths per pixel ── */
      acc.target();
      traceP.use()
        .set('uRes', aw, ah)
        .set('uFrame', frame >>> 0)
        .set('uSpp', spp)
        .set('uCamPos', ...basis.p)
        .set('uCamRight', ...basis.r)
        .set('uCamUp', ...basis.u)
        .set('uCamFwd', ...basis.f)
        .set('uFocal', 1.00)
        .set('uAperture', p.aperture)
        .set('uFocus', focus)
        .set('uLight', p.light)
        .set('uRough', clamp(p.rough, 0, 1))
        .set('uIor', p.ior)
        .set('uDepth', Math.round(clamp(p.bounces, 1, 12)))
        .set('uPaths', paths)
        .tex('uPrev', acc.read, 0);
      quad.draw();
      acc.swap();
      spp += paths;
      frame++;
      pathAcc += aw * ah * paths;
      const now = performance.now();
      if (now - lastPathT > 480) {
        pathsPerSec = pathAcc / ((now - lastPathT) / 1000);
        pathAcc = 0; lastPathT = now;
      }

      /* ── show it ── */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      showP.use()
        .set('uSpp', spp)
        .set('uExposure', p.exposure)
        .tex('uAccum', acc.read, 0);
      quad.draw();

      if (hud && frameN % 10 === 0) {
        const converged = spp > 240;
        hud.textContent =
          fmtBig(spp) + ' samples / pixel\n' +
          fmtBig(spp * aw * ah * paths) + ' paths total\n' +
          fmtBig(pathsPerSec) + ' paths / s\n' +
          aw + '×' + ah + ' internal\n' +
          (converged ? 'converging…' : 'noisy — keep still') + '\n' +
          fmt(SB.fpsNow(), 0) + ' fps';
      }
    });
  }

  function noFloat(canvas, section) {
    canvas.style.aspectRatio = '16 / 9';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const note = document.createElement('p');
    note.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:2rem;text-align:center;color:#9a9aa2;font-size:.8rem';
    note.textContent = 'This browser cannot render to floating-point textures, which is what a path tracer needs in order to average. Chrome, Firefox and Safari all can.';
    canvas.style.display = 'none';
    canvas.parentElement.appendChild(note);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();