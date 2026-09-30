/* ═══════════════════════════════════════════════════════════════════
   hero.js — a slow field of luminous strands. Every strand obeys
   three sine waves and nothing else; the forest is what happens
   when a few hundred of them are put in a current.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const { fit, clamp, lerp, rand, gateFor, startLoop, reduced } = SB;

  const SEG = 26;

  function boot() {
    const canvas = document.querySelector('[data-hero-canvas]');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let W = 0, H = 0, dpr = 1;
    let strands = [];
    let t = 0;
    let current = 0;          // smoothed pointer push
    let pointerX = 0.5, hasPointer = false;

    function build() {
      const target = Math.round(clamp(W * H / 3600, 90, 340));
      strands = [];
      for (let i = 0; i < target; i++) {
        const bend = rand(-1.35, 1.35);
        strands.push({
          x: rand(-0.08, 1.08),
          h: rand(0.16, 0.82),           // height as a fraction of H
          w: rand(0.8, 2.6),             // strand width at the root
          phase: rand(0, Math.PI * 2),
          speed: rand(0.20, 0.58),
          bend,                          // signed: which way it leans
          hue: rand(0, 1),               // 0 = bone, 1 = accent
          glow: rand(0.30, 1),
        });
      }
      strands.sort((a, b) => a.h - b.h);
    }

    function resize() {
      if (!fit(canvas, 1.35)) return;
      W = canvas.width; H = canvas.height; dpr = window.devicePixelRatio || 1;
      build();
    }

    /* One point on one strand, at s in [0,1] where 0 is the root.

       The root sits just below the frame and is very nearly vertical;
       the lean grows with the square of s, so the curve accelerates
       as it rises the way a real stem does under its own weight. A
       strand that is translated sideways as a rigid object just looks
       like rain, which is exactly what the first version looked
       like. */
    function point(s, st, out) {
      const wav = Math.sin(t * st.speed + st.phase)
                + Math.sin(t * st.speed * 0.63 + st.phase * 1.7) * 0.55
                + Math.sin(t * st.speed * 2.10 + st.phase * 0.4) * 0.22;
      const lean = st.bend * 0.17 * s * s;
      const sway = wav * 0.055 * s;
      out.x = (st.x + lean + sway + current * s * s * 0.7) * W;
      out.y = H * (1.14 - s * st.h * 1.06);
    }

    const p = { x: 0, y: 0 };
    const pts = [];

    function draw() {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createLinearGradient(0, H, 0, 0);
      glow.addColorStop(0, 'rgba(232,163,61,0.00)');
      glow.addColorStop(1, 'rgba(232,163,61,0.085)');

      for (let i = 0; i < strands.length; i++) {
        const st = strands[i];
        const accent = st.hue > 0.72;
        /* rebuild the polyline once per strand */
        pts.length = 0;
        for (let j = 0; j <= SEG; j++) {
          const s = j / SEG;
          point(s, st, p);
          pts.push(p.x, p.y);
        }
        /* the strand itself: brightening as it thins, so the tips
           read as light rather than as the ends of sticks */
        for (let j = 1; j <= SEG; j++) {
          const s = j / SEG;
          const a = (0.05 + 0.72 * Math.pow(s, 1.5)) * st.glow;
          ctx.strokeStyle = accent
            ? 'rgba(238,182,96,' + Math.min(a, 1).toFixed(3) + ')'
            : 'rgba(206,220,238,' + Math.min(a * 0.62, 1).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.35, st.w * dpr * (1 - s * 0.88));
          ctx.beginPath();
          ctx.moveTo(pts[(j - 1) * 2], pts[(j - 1) * 2 + 1]);
          ctx.lineTo(pts[j * 2], pts[j * 2 + 1]);
          ctx.stroke();
        }
        /* a small, soft light at the tip — not a bead */
        const tx = pts[SEG * 2], ty = pts[SEG * 2 + 1];
        const r = st.w * 1.05 * dpr;
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, r * 3.4);
        if (accent) {
          g.addColorStop(0, 'rgba(255,214,150,' + (0.62 * st.glow).toFixed(3) + ')');
          g.addColorStop(0.4, 'rgba(232,163,61,' + (0.10 * st.glow).toFixed(3) + ')');
        } else {
          g.addColorStop(0, 'rgba(224,236,250,' + (0.34 * st.glow).toFixed(3) + ')');
          g.addColorStop(0.4, 'rgba(220,230,245,' + (0.05 * st.glow).toFixed(3) + ')');
        }
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(tx - r * 3.4, ty - r * 3.4, r * 6.8, r * 6.8);
      }

      /* a slow breath of warm light from the floor */
      ctx.fillStyle = glow;
      ctx.fillRect(0, H * 0.35, W, H * 0.65);
      ctx.globalCompositeOperation = 'source-over';
    }

    SB.pointer(canvas, {
      onMove(q) { pointerX = q.x; hasPointer = true; },
      onDown(q) { pointerX = q.x; hasPointer = true; },
    });

    resize();
    window.addEventListener('resize', resize);

    const gate = gateFor(canvas.parentElement, () => {});
    let acc = 0;
    startLoop((ts, dt) => {
      if (!gate.visible) return;
      acc += dt;
      if (acc < 33) return;            // cap at ~30fps — this is a backdrop
      acc = 0;
      t += 0.0166 * 1.0;
      const want = hasPointer ? (pointerX - 0.5) * 0.16 : 0;
      current = lerp(current, Math.sin(t * 0.11) * 0.05 + want, 0.05);
      draw();
    });

    if (reduced) draw();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();