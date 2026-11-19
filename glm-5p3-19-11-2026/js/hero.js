/* HILBERT'S GARDEN — hero canvas.
   Amplitude motes drifting in the field of two wave sources;
   every second or so, one is measured: a ring, a choice, a color. */
(function () {
'use strict';
var K = window.HGK;
var canvas = document.getElementById('hero-canvas');
if (!canvas) return;
var ctx = canvas.getContext('2d');
var W = 0, H = 0, dpr = 1;

function size() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
size();
window.addEventListener('resize', size);

var rng = Math.random;
var motes = [];
var ripples = [];
var waves = [
  { x: 0.28, y: 0.32, r: 0, a: 0.05, dx: 0.006, dy: 0.004 },
  { x: 0.74, y: 0.6, r: 0, a: 0.045, dx: -0.005, dy: 0.007 }
];
var pointer = { x: -1, y: -1, has: false };

function newMote() {
  return {
    x: rng(), y: rng() * 0.92 + 0.04,
    vx: (rng() - 0.5) * 0.00022,
    vy: (rng() - 0.5) * 0.00016,
    ph: rng() * 6.2832,
    size: 1.6 + rng() * 2.4,
    born: 0
  };
}
for (var i = 0; i < 64; i++) motes.push(newMote());

var lastCollapse = 0;
var collapseEvery = 1500;

function draw(t) {
  ctx.clearRect(0, 0, W, H);

  /* wave rings from two sources */
  for (var wv = 0; wv < waves.length; wv++) {
    var w = waves[wv];
    w.x += w.dx * 0.016; w.y += w.dy * 0.016;
    if (w.x < 0.1 || w.x > 0.9) w.dx = -w.dx;
    if (w.y < 0.1 || w.y > 0.9) w.dy = -w.dy;
    w.r += 0.9;
    if (w.r > 160) w.r = 0;
    for (var k = 0; k < 3; k++) {
      var rr = w.r - k * 53;
      if (rr < 4) continue;
      ctx.strokeStyle = K.cyan(0.028 * (1 - rr / 160));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(w.x * W, w.y * H, rr, 0, 6.2832);
      ctx.stroke();
    }
  }

  /* ripples from pointer & collapses */
  for (var r = ripples.length - 1; r >= 0; r--) {
    var rp = ripples[r];
    rp.r += 1.6; rp.a -= 0.012;
    if (rp.a <= 0) { ripples.splice(r, 1); continue; }
    ctx.strokeStyle = (rp.collapse ? K.amber(rp.a) : K.cyan(rp.a * 0.6));
    ctx.lineWidth = rp.collapse ? 1.6 : 1;
    ctx.beginPath();
    ctx.arc(rp.x * W, rp.y * H, rp.r, 0, 6.2832);
    ctx.stroke();
  }

  /* motes */
  for (var m = 0; m < motes.length; m++) {
    var mo = motes[m];
    mo.x += mo.vx * 16; mo.y += mo.vy * 16;
    mo.ph += 0.006;
    if (mo.x < -0.02) mo.x = 1.02; if (mo.x > 1.02) mo.x = -0.02;
    if (mo.y < 0.02) mo.y = 0.98; if (mo.y > 0.98) mo.y = 0.02;
    if (pointer.has) {
      var dxm = mo.x - pointer.x / W, dym = mo.y - pointer.y / H;
      var dm = dxm * dxm + dym * dym;
      if (dm < 0.012 && dm > 1e-6) {
        var push = 0.0006 / (dm * 40 + 1);
        mo.x += dxm * push; mo.y += dym * push;
      }
    }
    var breathe = 0.72 + 0.28 * Math.sin(t / 900 + mo.ph * 3);
    ctx.fillStyle = K.hueCssDeg(mo.ph * 57.3, 0.34 * breathe + 0.14);
    ctx.beginPath();
    ctx.arc(mo.x * W, mo.y * H, mo.size * breathe, 0, 6.2832);
    ctx.fill();
  }

  /* scheduled collapse: the Born rule, quietly, forever */
  if (t - lastCollapse > collapseEvery) {
    lastCollapse = t;
    collapseEvery = 1200 + Math.random() * 1400;
    var victim = motes[Math.floor(Math.random() * motes.length)];
    var outcome = Math.random() < 0.5 ? 0 : 1;
    ripples.push({ x: victim.x, y: victim.y, r: 3, a: 0.5, collapse: true });
    flashes.push({ x: victim.x, y: victim.y, a: 1, o: outcome });
    motes[motes.indexOf(victim)] = newMote();
  }

  /* flash blossoms */
  for (var fi = flashes.length - 1; fi >= 0; fi--) {
    var fl = flashes[fi];
    fl.a -= 0.02;
    if (fl.a <= 0) { flashes.splice(fi, 1); continue; }
    var col = fl.o ? 'rgba(132,216,207,' : 'rgba(220,170,74,';
    ctx.fillStyle = col + (fl.a * 0.8) + ')';
    ctx.beginPath();
    ctx.arc(fl.x * W, fl.y * H, 3 + (1 - fl.a) * 8, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = col + fl.a + ')';
    ctx.font = '10px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fl.o ? '|1⟩' : '|0⟩', fl.x * W, fl.y * H - 14 - (1 - fl.a) * 10);
  }
}

var flashes = [];

if (K.REDUCED) {
  draw(0);
} else {
  var visible = true;
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { visible = e.isIntersecting; });
    }, { threshold: 0.02 });
    io.observe(canvas);
  }
  K.loop(function (t) {
    if (visible) draw(t);
    return true;
  });
}

canvas.addEventListener('pointermove', function (e) {
  var rect = canvas.getBoundingClientRect();
  pointer.x = e.clientX - rect.left;
  pointer.y = e.clientY - rect.top;
  pointer.has = true;
  if (ripples.length < 24 && Math.random() < 0.24) {
    ripples.push({ x: pointer.x / W, y: pointer.y / H, r: 2, a: 0.16 });
  }
});
canvas.addEventListener('pointerleave', function () { pointer.has = false; });
})();
