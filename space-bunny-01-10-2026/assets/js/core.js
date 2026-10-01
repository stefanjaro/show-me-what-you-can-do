/* ═══════════════════════════════════════════════════════════════════
   core.js — the only shared code. A tiny WebGL2 layer, a frame
   scheduler that sleeps when nobody is looking, a source-viewer.
   No dependencies. If you are reading this to find out how it's
   possible, start at Program() and Flow().
   ═══════════════════════════════════════════════════════════════════ */
window.SB = window.SB || (function () {
  'use strict';

  /* ── math ─────────────────────────────────────────────────────── */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (n) => (Math.random() * n) | 0;

  /* fixed-width number so HUD readouts don't jitter */
  function fmt(v, dp) {
    dp = dp === undefined ? 2 : dp;
    if (!isFinite(v)) return '—';
    const s = v.toFixed(dp);
    if (dp > 0 && Math.abs(v) < Math.pow(10, -dp) && v !== 0) return '0' + s;
    return s;
  }
  function fmtBig(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  /* ── environment ──────────────────────────────────────────────── */
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const MAX_DPR = coarse ? 2 : 1.75;

  function dprFor(canvas, cap) {
    return Math.min(window.devicePixelRatio || 1, cap || MAX_DPR);
  }

  /* Resize a canvas to its CSS box, honouring DPR. Returns true if changed. */
  function fit(canvas, cap) {
    const r = canvas.getBoundingClientRect();
    const d = dprFor(canvas, cap);
    const w = Math.max(1, Math.round(r.width * d));
    const h = Math.max(1, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      return true;
    }
    return false;
  }

  /* ── visibility gate ──────────────────────────────────────────── */
  /* An element that is off-screen should not burn a GPU. Every
     instrument registers here instead of calling requestAnimationFrame. */
  const Gates = new Map();
  function gateFor(el, onChange) {
    let g = Gates.get(el);
    if (g) return g;
    g = { visible: false, el, onChange };
    Gates.set(el, g);
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        g.visible = e.isIntersecting;
        g.onChange(g.visible);
      }
    }, { rootMargin: '160px 0px' });
    io.observe(el);
    return g;
  }

  /* One shared rAF. Instruments add ticks and get skipped when hidden. */
  const Ticks = new Set();
  let raf = 0, lastT = performance.now(), fps = 60;
  function pump(t) {
    raf = requestAnimationFrame(pump);
    const dt = t - lastT; lastT = t;
    if (dt > 0 && dt < 500) fps = fps * 0.9 + (1000 / dt) * 0.1;
    for (const fn of Ticks) fn(t, dt, fps);
  }
  function startLoop(fn) {
    Ticks.add(fn);
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(pump); }
    return () => { Ticks.delete(fn); if (!Ticks.size && raf) { cancelAnimationFrame(raf); raf = 0; } };
  }
  function fpsNow() { return fps; }

  /* ── pointer: unified drag/hover on any canvas ────────────────── */
  /* Gives every instrument identical feel: uv in [0,1], pixel pos,
     drag state, and a "did the visitor ever touch it" flag. */
  function pointer(el, opts) {
    opts = opts || {};
    const p = {
      x: 0.5, y: 0.5, px: 0, py: 0, dx: 0, dy: 0,
      down: false, over: false, everTouched: false, inside: false,
      speed: 0,
    };
    const loc = (e) => {
      const r = el.getBoundingClientRect();
      p.px = (e.clientX - r.left);
      p.py = (e.clientY - r.top);
      p.x = clamp(p.px / r.width, 0, 1);
      p.y = clamp(p.py / r.height, 0, 1);
      p.inside = true;
    };
    el.addEventListener('pointerdown', (e) => {
      loc(e); p.dx = p.x; p.dy = p.y;
      p.down = true; p.everTouched = true; p.speed = 0;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      if (opts.onDown) opts.onDown(p);
    });
    el.addEventListener('pointermove', (e) => {
      loc(e); p.over = true; p.everTouched = true;
      if (p.down) { p.speed = Math.hypot(p.x - p.dx, p.y - p.dy); }
      if (opts.onMove) opts.onMove(p);
    });
    const up = (e) => {
      if (!p.down) return;
      p.down = false; p.speed = 0;
      if (opts.onUp) opts.onUp(p, loc(e) || p);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { p.over = false; p.inside = false; });
    return p;
  }

  /* ═══ WebGL2 ══════════════════════════════════════════════════ */

  function compile(gl, type, src, tag) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => (i + 1) + ' | ' + l).join('\n');
      console.error('[' + tag + '] shader failed:\n' + log + '\n' + lines);
      throw new Error(tag + ': ' + log);
    }
    return s;
  }

  /* Program wrapper. Caches uniform locations *and their types*, so
     call sites can say set('uFeed', 0.0545) and never think about it.
     `bound` is shared by every Program on the page: GL uniform setters
     always act on whichever program is current, so the guard has to be
     global or two programs will each believe they are still bound. */
  let bound = null;
  function Program(gl, vsSrc, fsSrc, tag) {
    tag = tag || 'program';
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, tag + '.vert');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, tag + '.frag');
    const id = gl.createProgram();
    gl.attachShader(id, vs); gl.attachShader(id, fs); gl.linkProgram(id);
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) {
      throw new Error(tag + ' link: ' + gl.getProgramInfoLog(id));
    }
    gl.deleteShader(vs); gl.deleteShader(fs);

    const loc = new Map(), type = new Map();
    const n = gl.getProgramParameter(id, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(id, i);
      const name = info.name.replace(/\[0\]$/, '');
      loc.set(name, gl.getUniformLocation(id, name));
      type.set(name, info.type);
    }
    /* Uniform types we know how to set. Anything else is a trap:
       gl.uniform* called with a stale location is an INVALID_OPERATION
       that the driver reports once and then ignores, so the value
       silently stays zero. Warn loudly, once, rather than letting a
       shader quietly sample the same random number every frame. */
    const known = new Set([
      gl.FLOAT, gl.FLOAT_VEC2, gl.FLOAT_VEC3, gl.FLOAT_VEC4,
      gl.INT, gl.INT_VEC2, gl.INT_VEC3, gl.INT_VEC4,
      gl.UNSIGNED_INT, gl.BOOL,
      gl.FLOAT_MAT2, gl.FLOAT_MAT3, gl.FLOAT_MAT4,
      gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D,
    ]);
    const warned = new Set();
    for (const [name, t] of type) {
      if (known.has(t) || t >= gl.FLOAT_VEC2) continue;
      if (warned.has(name)) continue;
      warned.add(name);
      console.warn('[SB] uniform "' + name + '" has an unhandled type (0x' + t.toString(16) + '); it will always be 0');
    }
    const attribs = new Map();
    const na = gl.getProgramParameter(id, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(id, i);
      attribs.set(info.name, gl.getAttribLocation(id, info.name));
    }

    return {
      id, loc, type, attribs,
      use() { if (bound !== id) { gl.useProgram(id); bound = id; } return this; },
      /* set(name, a [,b,c,d]) — 1,2,3,4,9,16 components or a texture unit */
      set(name, a, b, c, d) {
        this.use();
        const l = loc.get(name);
        if (l === undefined || l === null) return this;
        switch (type.get(name)) {
          case gl.FLOAT: typeof a === 'number' ? gl.uniform1f(l, a) : gl.uniform1fv(l, a); break;
          case gl.FLOAT_VEC2: gl.uniform2f(l, a, b); break;
          case gl.FLOAT_VEC3: gl.uniform3f(l, a, b, c); break;
          case gl.FLOAT_VEC4: gl.uniform4f(l, a, b, c, d); break;
          case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, a); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, a); break;
          case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: case gl.SAMPLER_CUBE:
            (a instanceof WebGLTexture || (a && a.tex)) ? gl.uniform1i(l, a.unit || 0) : gl.uniform1i(l, a | 0); break;
          case gl.UNSIGNED_INT: gl.uniform1ui(l, a >>> 0); break;
          case gl.INT_VEC2: gl.uniform2i(l, a, b); break;
          case gl.INT_VEC3: gl.uniform3i(l, a, b, c); break;
          case gl.INT_VEC4: gl.uniform4i(l, a, b, c, d); break;
          case gl.FLOAT_VEC2_ARRAY: gl.uniform2fv(l, a); break;
          case gl.FLOAT_VEC3_ARRAY: gl.uniform3fv(l, a); break;
          case gl.FLOAT_VEC4_ARRAY: gl.uniform4fv(l, a); break;
          case gl.FLOAT_MAT2: gl.uniformMatrix2fv(l, false, a); break;
          default: break;
        }
        return this;
      },
      /* bind a texture (or our Tex wrapper) to a unit and point a sampler at it */
      tex(name, t, unit) {
        this.use();
        const l = loc.get(name);
        if (l === undefined || l === null) return this;
        const tex = t instanceof WebGLTexture ? t : (t && t.tex);
        if (tex) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(l, unit);
        }
        return this;
      },
    };
  }

  const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  function Quad(gl) {
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return {
      vao,
      draw() { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); },
    };
  }

  /* A render target. `fmt` picks float precision; we prefer 32-bit
     when linear filtering is available (higher precision solve), and
     fall back to 16-bit half-float otherwise. */
  let Floats = null;
  function floatKind(gl) {
    if (Floats) return Floats;
    const half = gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float');
    if (!half) { Floats = 'none'; return Floats; }
    Floats = gl.getExtension('OES_texture_float_linear') ? 'float' : 'half';
    return Floats;
  }
  function RTFormat(gl) {
    const k = floatKind(gl);
    if (k === 'float') return { internal: gl.RGBA32F, type: gl.FLOAT };
    if (k === 'half') return { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
    return { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
  }

  function Tex(gl, w, h, opt) {
    opt = opt || {};
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = opt.fmt || null;
    if (f) {
      gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, gl.RGBA, f.type, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, opt.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const filter = opt.nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opt.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opt.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    const self = { tex: t, w, h, unit: 0 };
    self.dispose = () => gl.deleteTexture(t);
    return self;
  }

  /* Ping-pong pair. Every numerical solver on this site is two of
     these plus a fullscreen fragment shader. */
  function Flow(gl, w, h, opt) {
    opt = opt || {};
    const f = opt.fmt || RTFormat(gl);
    let a = Tex(gl, w, h, Object.assign({}, opt, { fmt: f }));
    let b = Tex(gl, w, h, Object.assign({}, opt, { fmt: f }));
    const makeFbo = (t) => {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return fb;
    };
    let fa = makeFbo(a), fb2 = makeFbo(b);
    return {
      get read() { return a; },
      get write() { return b; },
      get fbo() { return fa; },
      w, h,
      /* draw target: bind the write buffer for drawing, return read for sampling */
      target() { gl.bindFramebuffer(gl.FRAMEBUFFER, fb2); gl.viewport(0, 0, w, h); return this; },
      source() { return a; },
      swap() { const t = a; a = b; b = t; const f = fa; fa = fb2; fb2 = f; },
      clear(r, g_, b_, al) {
        for (const fb of [fa, fb2]) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.clearColor(r || 0, g_ || 0, b_ || 0, al === undefined ? 1 : al);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
      dispose() { a.dispose(); b.dispose(); gl.deleteFramebuffer(fa); gl.deleteFramebuffer(fb2); },
    };
  }

  function makeGL(canvas, opt) {
    const gl = canvas.getContext('webgl2', Object.assign({
      alpha: false, antialias: false, depth: true, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }, opt || {}));
    if (!gl) return null;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_float_blend');
    return gl;
  }

  /* ═══ source viewer ═══════════════════════════════════════════
     Fetches the real file this page is running and paints it.
     Whatever appears on screen is the actual code — not a copy. */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const KW = new RegExp('\\b(?:' + [
    'const', 'let', 'var', 'function', 'return', 'for', 'while', 'if', 'else', 'do', 'break',
    'continue', 'class', 'new', 'this', 'typeof', 'instanceof', 'of', 'in', 'switch', 'case',
    'try', 'catch', 'finally', 'throw', 'async', 'await', 'export', 'import', 'from',
    'default', 'extends', 'super', 'delete', 'void', 'null', 'undefined', 'true', 'false',
    'static', 'get', 'set', 'uniform', 'layout', 'precision', 'highp', 'mediump', 'lowp',
    'discard', 'struct', 'inout', 'out', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'mat3',
    'mat4', 'float', 'int', 'bool', 'void', 'sampler2D', 'samplerCube', 'break',
  ].join('|') + ')\\b', 'g');

  const TY = /\b(?:Float32Array|Float64Array|Uint8Array|Uint16Array|Uint32Array|Int32Array|Array|Object|Math|JSON|Promise|Map|Set|WebGL2RenderingContext|Float32List)\b/g;

  function highlight(src) {
    /* one pass, ordered: comments → strings → numbers → types → keywords
       → call sites. Everything is escaped as it is emitted. */
    const re = new RegExp([
      '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)',       // 1 comment
      '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)', // 2 string
      '\\b(0[xX][0-9a-fA-F]+|\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)\\b', // 3 number
      '\\b([A-Z][A-Za-z0-9_]{2,})\\b',               // 4 type-ish
      '\\b([a-z_][A-Za-z0-9_]*)(?=\\s*\\()',          // 5 call
      '\\b(' + KW.source.slice(2, -2) + ')\\b',      // 6 keyword
    ].join('|'), 'g');

    let out = '', last = 0, m;
    const cls = { 1: 'tk-c', 2: 'tk-s', 3: 'tk-n', 4: 'tk-t', 5: 'tk-f', 6: 'tk-k' };
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      const idx = m.slice(1).findIndex((g) => g !== undefined) + 1;
      out += '<span class="' + cls[idx] + '">' + esc(m[0]) + '</span>';
      last = re.lastIndex;
    }
    out += esc(src.slice(last));
    return out;
  }

  const srcCache = new Map();
  function loadSource(url) {
    if (srcCache.has(url)) return srcCache.get(url);
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.text();
    }).then((txt) => {
      srcCache.set(url, txt);
      return txt;
    }).catch((e) => {
      const msg = '/* Could not fetch ' + url + ' —\n   ' + e.message +
        '\n   (this happens when the page is opened straight from disk,\n    where fetch() is not allowed. Serve the folder over http and\n    the real source will appear here. */';
      srcCache.set(url, msg);
      return msg;
    });
    return p;
  }

  return {
    clamp, lerp, rand, randi, fmt, fmtBig, reduced, fit,
    gateFor, startLoop, fpsNow, pointer,
    Program, Quad, Tex, Flow, makeGL, VS_QUAD, floatKind,
    highlight, loadSource,
  };
})();