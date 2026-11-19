/* HILBERT'S GARDEN — INSTRUMENT II · THE INTERFEROMETER */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i2-stage');
var controls = document.getElementById('i2-controls');
var readEl = document.getElementById('i2-readout');
if (!stage) return;
K.tag(stage, 'MACH–ZEHNDER · ONE PHOTON, TWO ROADS', 'BORN RULE LIVE');

var entry = K.makeCanvas(stage, 420, 'Mach-Zehnder interferometer animation; photons take both roads unless you watch');
var ctx = entry.ctx;

var phi = 0;
var eye = false;
var counts = [0, 0];
var flights = [];
var flashes = [];
var streaming = false;
var loopHandle = null;
var rng = Math.random;

var ro = K.readout(readEl);
ro.head('INTERFEROMETER LEDGER');
var roPhi = ro.line('phi', 'PHASE φ');
var roTheo = ro.line('theo', 'P(D0) THEORY');
var roObs = ro.line('obs', 'P(D0) OBSERVED');
var roVis = ro.line('vis', 'VISIBILITY');
var roMode = ro.line('mode', 'MODE');
ro.note('Each dot is one real engine run: prepared as (|0⟩+eᶦᵠ|1⟩)∕√2, measured in the diagonal basis. Colors are the roads\' live phases — when both dots share a color the exits go extreme; when they oppose, they cancel.');

function syncReadout() {
  roPhi.set((phi * 180 / Math.PI).toFixed(0) + '°', 'am');
  var p0 = Math.cos(phi / 2) * Math.cos(phi / 2);
  roTheo.set(p0.toFixed(3), 'am');
  var tot = counts[0] + counts[1];
  roObs.set(tot ? (counts[0] / tot).toFixed(3) : '—', 'cy');
  roVis.set(tot ? (Math.abs(counts[0] - counts[1]) / tot).toFixed(3) : '—', tot && Math.abs(counts[0] - counts[1]) / tot > 0.9 ? 'am' : 'cy');
  roMode.set(eye ? 'ROADS WATCHED · NO INTERFERENCE' : 'ROADS OPEN · INTERFERING', eye ? 'rd' : 'am');
}

function geo(w, h) {
  var cy = h * 0.42, yTop = h * 0.13;
  return {
    S: { x: w * 0.05, y: cy },
    BS1: { x: w * 0.27, y: cy },
    M1: { x: w * 0.27, y: yTop },
    M2: { x: w * 0.71, y: cy },
    BS2: { x: w * 0.71, y: yTop },
    D0: { x: w * 0.71, y: h * 0.045 },
    D1: { x: w * 0.93, y: yTop },
    cy: cy, yTop: yTop,
    ph: { x: w * 0.49, y: yTop }
  };
}
function lerpPt(a, b, u) { return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; }
function poly(a, b, u) {
  if (u <= 0.5) return lerpPt(a.m, a.n, u * 2);
  return lerpPt(b.m, b.n, u * 2 - 1);
}

function fire() {
  var q = new HG.QReg(1);
  q.apply1(0, HG.U1(phi));
  var road = -1;
  if (eye) road = q.measure(0, rng);
  q.apply1(0, HG.G.H);
  var det = q.measure(0, rng);
  flights.push({
    t0: performance.now(),
    road: road,
    det: det,
    dur: K.REDUCED ? 1 : 2300
  });
  ensureLoop();
}
function ensureLoop() {
  if (loopHandle) return;
  loopHandle = K.loop(function (t) {
    draw(t);
    for (var i = flights.length - 1; i >= 0; i--) {
      if (t - flights[i].t0 > flights[i].dur + 380) flights.splice(i, 1);
    }
    if (!flights.length && !streaming && !flashes.length) {
      loopHandle = null;
      return false;
    }
    if (streaming && t - lastStream > 150) {
      lastStream = t;
      if (flights.length < 7) fire();
    }
    return true;
  });
}
var lastStream = 0;

function drawRig(w, h, g) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = K.faint(0.5);
  function seg(a, b) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  seg(g.S, g.BS1);
  seg(g.BS1, g.M1);
  seg(g.M1, g.BS2);
  seg(g.BS1, g.M2);
  seg(g.M2, g.BS2);
  ctx.setLineDash([2, 4]);
  seg(g.BS2, g.D0);
  seg(g.BS2, g.D1);
  ctx.setLineDash([]);

  function mirror(p, glow) {
    ctx.strokeStyle = K.txt(0.75);
    ctx.lineWidth = 2;
    if (glow) { ctx.strokeStyle = K.cyan(0.85); ctx.shadowColor = K.cyan(0.8); ctx.shadowBlur = 8; }
    ctx.beginPath();
    ctx.moveTo(p.x - 7, p.y + 7);
    ctx.lineTo(p.x + 7, p.y - 7);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
  }
  mirror(g.BS1, true); mirror(g.BS2, true);
  mirror(g.M1, false); mirror(g.M2, false);

  ctx.fillStyle = K.amber(0.95);
  ctx.beginPath(); ctx.arc(g.S.x, g.S.y, 4, 0, 6.2832); ctx.fill();
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SOURCE', g.S.x, g.S.y + 18);

  [g.D0, g.D1].forEach(function (d, i) {
    ctx.strokeStyle = counts[i] ? K.amber(0.9) : K.faint(0.6);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(d.x, d.y, 6.5, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = K.faint(0.95);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(i === 0 ? 'D0' : 'D1', d.x + (i === 0 ? 0 : 2), d.y - 11);
  });

  /* phase marker on upper arm */
  ctx.fillStyle = K.hueCssDeg(phi * 180 / Math.PI, 0.9);
  ctx.beginPath(); ctx.arc(g.ph.x, g.ph.y, 5.5, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = K.faint(0.8);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(g.ph.x, g.ph.y, 9, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = K.faint(0.95);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('φ', g.ph.x, g.ph.y + 20);

  /* which-path eye */
  if (eye) {
    var ex = g.BS1.x, ey = (g.BS1.y + g.M1.y) / 2;
    ctx.strokeStyle = K.red(0.95);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(ex + 26, ey, 9, 5.5, 0, 0, 6.2832);
    ctx.stroke();
    ctx.fillStyle = K.red(0.95);
    ctx.beginPath(); ctx.arc(ex + 26, ey, 2.2, 0, 6.2832); ctx.fill();
    ctx.fillStyle = K.red(0.9);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WATCHING', ex + 26, ey - 10);
  }
}

function drawPhasors(w, h) {
  var cx = w * 0.13, cy = h * 0.84, R = Math.min(w * 0.075, h * 0.115);
  ctx.strokeStyle = K.faint(0.3);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R - 6, cy); ctx.lineTo(cx + R + 6, cy); ctx.stroke();

  function vec(ang, len, color, dashed, label) {
    var rad = ang * Math.PI / 180;
    var ex = cx + Math.cos(rad) * len, ey = cy - Math.sin(rad) * len;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, 6.2832); ctx.fill();
    if (label) {
      ctx.font = '8px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, ex + 5, ey + 3);
    }
  }
  var s = R / 1.45;
  vec(0, s * 0.707, K.hueCssDeg(0, 0.95), false, 'ROAD A');
  vec(phi * 180 / Math.PI, s * 0.707, K.hueCssDeg(phi * 180 / Math.PI, 0.95), false, 'ROAD B');
  var sumLen = s * Math.SQRT2 * Math.cos(phi / 2);
  vec(phi * 90 / Math.PI, sumLen, K.amber(0.9), true, 'SUM');
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TWO AMPLITUDES, ONE SUM', cx, cy + R + 16);
}

function drawBars(w, h) {
  var x0 = w * 0.42, y0 = h * 0.78, bw = w * 0.52;
  var tot = Math.max(1, counts[0] + counts[1]);
  [['D0', 0, K.amber(0.85)], ['D1', 1, K.cyan(0.85)]].forEach(function (dd) {
    var y = y0 + dd[1] * 16;
    ctx.fillStyle = K.faint(0.9);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText(dd[0], x0, y + 9);
    ctx.strokeStyle = K.faint(0.35);
    ctx.strokeRect(x0 + 26, y, bw - 80, 10);
    var frac = counts[dd[1]] / tot;
    ctx.fillStyle = dd[2];
    ctx.fillRect(x0 + 26, y, (bw - 80) * frac, 10);
    ctx.fillStyle = K.txt(0.8);
    ctx.textAlign = 'right';
    ctx.fillText(counts[dd[1]] + ' · ' + (frac * 100).toFixed(1) + '%', x0 + bw, y + 9);
  });
}

function draw(t) {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);
  var g = geo(w, h);
  drawRig(w, h, g);

  var armA = { m: g.BS1, n: g.M1 }, armA2 = { m: g.M1, n: g.BS2 };
  var armB = { m: g.BS1, n: g.M2 }, armB2 = { m: g.M2, n: g.BS2 };

  flights.forEach(function (f) {
    var u = (t - f.t0) / f.dur;
    if (u < 0 || u > 1.3) return;
    if (u <= 0.18) {
      var p = lerpPt(g.S, g.BS1, u / 0.18);
      dot(p.x, p.y, 1, 0);
    } else if (u <= 0.72) {
      var uu = (u - 0.18) / 0.54;
      if (eye) {
        var pt = f.road === 0 ? poly(armA, armA2, uu) : poly(armB, armB2, uu);
        dot(pt.x, pt.y, 1, f.road === 0 ? 0 : phi);
      } else {
        var pa = poly(armA, armA2, uu);
        var pb = poly(armB, armB2, uu);
        dot(pa.x, pa.y, 0.55, 0);
        dot(pb.x, pb.y, 0.55, phi);
      }
    } else if (u <= 0.9) {
      var target = f.det === 0 ? g.D0 : g.D1;
      var q = lerpPt(g.BS2, target, (u - 0.72) / 0.18);
      dot(q.x, q.y, 1, f.det === 0 ? 0 : phi + Math.PI);
    }
    if (u >= 0.9 && !f.counted) {
      f.counted = true;
      counts[f.det]++;
      flashes.push({ x: f.det === 0 ? g.D0.x : g.D1.x, y: f.det === 0 ? g.D0.y : g.D1.y, r: 3, a: 0.8 });
      syncReadout();
    }
  });
  for (var i = flashes.length - 1; i >= 0; i--) {
    var fl = flashes[i];
    fl.r += 0.5; fl.a -= 0.02;
    if (fl.a <= 0) { flashes.splice(i, 1); continue; }
    ctx.strokeStyle = K.amber(fl.a);
    ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r, 0, 6.2832); ctx.stroke();
  }

  drawPhasors(w, h);
  drawBars(w, h);
}
function dot(x, y, alpha, ph) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = K.hueCssDeg(ph * 180 / Math.PI, 0.95);
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 9;
  ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

var row = K.buttons(controls);
var row2, row3;
K.slider(controls, {
  label: 'PHASE φ ON ROAD B',
  min: 0, max: 360, step: 1, value: 0,
  fmt: function (v) { return v.toFixed(0) + '°'; },
  onInput: function (v) { phi = v * Math.PI / 180; syncReadout(); }
});
row2 = K.buttons(controls);
row2.add('FIRE ONE PHOTON', function () { fire(); });
var streamBtn = row2.add('STREAM PHOTONS', function (b) {
  streaming = !streaming;
  b.classList.toggle('on', streaming);
  b.textContent = streaming ? 'STOP STREAM' : 'STREAM PHOTONS';
  if (streaming) { lastStream = 0; ensureLoop(); }
});
K.toggle(controls, {
  label: 'WHICH-PATH DETECTOR (PLAY THE SPY)',
  on: false,
  onChange: function (v) { eye = v; syncReadout(); }
});
row3 = K.buttons(controls);
row3.add('RESET COUNTS', function () {
  counts = [0, 0];
  flights = [];
  syncReadout();
}, { cls: 'danger' });

syncReadout();
})();
