/* HILBERT'S GARDEN — INSTRUMENT IV · BELL'S ARBITER */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i4-stage');
var controls = document.getElementById('i4-controls');
var readEl = document.getElementById('i4-readout');
if (!stage) return;
K.tag(stage, 'CHSH GAME · SINGLET vs SEPARABLE SOURCE', 'CLASSICAL CEILING 2.000');

var entry = K.makeCanvas(stage, 380, 'Bell score meter rising past the classical limit of 2 toward 2.83');
var ctx = entry.ctx;

/* Optimal angles, found by exhaustive scan (see ledger). */
var A1 = Math.PI / 4, A2 = -Math.PI / 4, B1 = Math.PI / 2, B2 = 0;
var separable = false;
var rounds = 0;
var acc = [0, 0, 0, 0];
var cnt = [0, 0, 0, 0];
var rng = Math.random;
var running = false, loopHandle = null;

var ro = K.readout(readEl);
ro.head('BELL GAME LEDGER');
var roRounds = ro.line('r', 'ROUNDS PLAYED');
var roE = ro.line('e', 'CORRELATIONS E₁ E₂ E₃ E₄');
var roS = ro.line('s', 'BELL SCORE S');
var roSig = ro.line('sig', 'STATISTICAL NOISE ±σ');
var roTheo = ro.line('theo', 'THEORY PREDICTION');
var roVerdict = ro.line('v', 'VERDICT');
ro.note('S = E(a,b) + E(a,b′) − E(a′,b) + E(a′,b′) at angles 45°, 45°, 90°, 0°. Any universe whose particles carry pre-written answers scores |S| ≤ 2. The singlet\'s closed form: S = −2√2 ≈ −2.828.');

function singlet() {
  var q = new HG.QReg(2);
  q.apply1(0, HG.G.X);
  q.apply1(1, HG.G.X);
  q.apply1(0, HG.G.H);
  q.cnot(0, 1);
  return q;
}
function plainPair() {
  var q = new HG.QReg(2);
  return q;
}
function playBurst(n) {
  for (var i = 0; i < n; i++) {
    var cell = Math.floor(rng() * 4);
    var ta = (cell === 0 || cell === 1) ? A1 : A2;
    var tb = (cell === 0 || cell === 2) ? B1 : B2;
    var q = separable ? plainPair() : singlet();
    var ra = q.measurePlane(0, ta, rng);
    var rb = q.measurePlane(1, tb, rng);
    acc[cell] += (ra === rb ? 1 : -1);
    cnt[cell]++;
    rounds++;
  }
  syncReadout();
  draw();
}
function Svalue() {
  if (Math.min.apply(null, cnt) === 0) return null;
  var E = acc.map(function (a, i) { return a / cnt[i]; });
  return E[0] + E[1] - E[2] + E[3];
}
function syncReadout() {
  roRounds.set(rounds.toLocaleString(), 'am');
  var Es = acc.map(function (a, i) { return cnt[i] ? (a / cnt[i]).toFixed(2) : '—'; });
  roE.set(Es.join('  '), 'cy');
  var S = Svalue();
  roS.set(S === null ? '—' : S.toFixed(4), S !== null && Math.abs(S) > 2 ? 'am' : 'cy');
  var n = Math.min.apply(null, cnt);
  roSig.set(n ? (2 / Math.sqrt(n)).toFixed(4) : '—');
  var theo = separable ?
    (Math.cos(A1) * Math.cos(B1) + Math.cos(A1) * Math.cos(B2) - Math.cos(A2) * Math.cos(B1) + Math.cos(A2) * Math.cos(B2)).toFixed(3) + '  (local, pre-written answers)' :
    '−2√2 = −2.828';
  roTheo.set(theo, 'cy');
  var nmin = Math.min.apply(null, cnt);
  var sig = nmin ? 2 / Math.sqrt(nmin) : 99;
  if (S === null || nmin < 12) roVerdict.set('GATHERING DATA…');
  else if (Math.abs(S) - 2 > 3 * sig) {
    roVerdict.set(separable ? 'INCONSISTENT — CHECK THE SOURCE SWITCH' : 'CLASSICAL CEILING BROKEN', separable ? 'rd' : 'am');
  } else if (Math.abs(S) > 2) roVerdict.set('ABOVE 2 — NEED MORE ROUNDS');
  else roVerdict.set(separable ? 'WITHIN THE LOCAL LIMIT · AS ANY LOCAL UNIVERSE MUST BE' : 'WITHIN THE LOCAL LIMIT — SO FAR');
}

function meter(w, h) {
  var y0 = 52, x0 = 70, x1 = w - 70;
  function sx(Sv) { return x0 + (x1 - x0) * (Sv + 4) / 8; }
  /* zones */
  ctx.fillStyle = 'rgba(93,107,128,0.10)';
  ctx.fillRect(sx(-2), y0, sx(2) - sx(-2), 46);
  ctx.fillStyle = 'rgba(220,170,74,0.10)';
  ctx.fillRect(sx(2), y0, sx(2.828) - sx(2), 46);
  ctx.fillRect(sx(-2.828), y0, sx(-2) - sx(-2.828), 46);
  ctx.fillStyle = 'rgba(226,105,79,0.10)';
  ctx.fillRect(sx(2.828), y0, x1 - sx(2.828), 46);
  ctx.fillRect(sx(-4), y0, sx(-2.828) - sx(-4), 46);
  ctx.strokeStyle = K.faint(0.5);
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, 46);
  [-4, -2.828, -2, 0, 2, 2.828, 4].forEach(function (tick) {
    var x = sx(tick);
    ctx.strokeStyle = tick === 0 ? K.faint(0.8) : K.faint(0.35);
    ctx.beginPath(); ctx.moveTo(x, y0 + 46); ctx.lineTo(x, y0 + (tick === 0 ? 54 : 50)); ctx.stroke();
    ctx.fillStyle = K.faint(0.9);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    var lab = Math.abs(tick) === 2.828 ? '±2√2' : (tick === 2 ? '+2' : tick === -2 ? '−2' : tick.toFixed(0));
    ctx.fillText(lab, x, y0 + 64);
  });
  ctx.fillStyle = K.faint(0.85);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('LOCAL REALISM', sx(0), y0 - 8);
  ctx.fillStyle = K.amber(0.8);
  ctx.fillText('QUANTUM', (sx(2) + sx(2.828)) / 2, y0 - 8);
  ctx.fillText('QUANTUM', (sx(-2) + sx(-2.828)) / 2, y0 - 8);
  ctx.fillStyle = K.red(0.8);
  ctx.fillText('NO-GO', (sx(2.828) + x1) / 2, y0 - 8);
  ctx.fillText('NO-GO', (sx(-4) + sx(-2.828)) / 2, y0 - 8);

  /* theory ghost */
  var thx = sx(separable ? 1.414 : -2.828);
  ctx.strokeStyle = K.cyan(0.4);
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(thx, y0); ctx.lineTo(thx, y0 + 46); ctx.stroke();
  ctx.setLineDash([]);

  /* needle */
  var S = Svalue();
  if (S !== null) {
    var nx = sx(Math.max(-4, Math.min(4, S)));
    ctx.strokeStyle = K.amber(0.95);
    ctx.lineWidth = 2.6;
    ctx.shadowColor = K.amber(0.9);
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(nx, y0 + 2); ctx.lineTo(nx, y0 + 44); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.fillStyle = K.amber(0.95);
    ctx.font = '10px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText('S = ' + S.toFixed(3), nx, y0 + 30);
  }
}

function cells(w, h) {
  var y0 = 158, x0 = 40, cw = (w - 80) / 4;
  var names = ['E(a,b)', 'E(a,b′)', 'E(a′,b)', 'E(a′,b′)'];
  var signs = ['+', '+', '−', '+'];
  for (var i = 0; i < 4; i++) {
    var x = x0 + i * cw;
    ctx.fillStyle = K.faint(0.9);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(names[i] + ' ' + signs[i], x + cw / 2, y0);
    ctx.strokeStyle = K.faint(0.4);
    ctx.beginPath(); ctx.moveTo(x + 10, y0 + 26); ctx.lineTo(x + cw - 10, y0 + 26); ctx.stroke();
    var E = cnt[i] ? acc[i] / cnt[i] : 0;
    var mid = x + cw / 2;
    ctx.fillStyle = K.amber(0.85);
    var half = (cw / 2 - 12) * Math.abs(E);
    if (E >= 0) ctx.fillRect(mid, y0 + 19, half, 13);
    else ctx.fillRect(mid - half, y0 + 19, half, 13);
    ctx.fillStyle = K.txt(0.85);
    ctx.font = '10px ui-monospace,Menlo,monospace';
    ctx.fillText(cnt[i] ? E.toFixed(3) : '—', x + cw / 2, y0 + 52);
    ctx.fillStyle = K.faint(0.7);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.fillText(cnt[i].toLocaleString() + ' ROUNDS', x + cw / 2, y0 + 66);
  }
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('THE FOUR CORRELATORS — EACH DIAL SETTING PAIRED UNIFORMLY AT RANDOM', w / 2, y0 - 16);
}

function verdict(w, h) {
  var y = h - 34;
  ctx.font = '10px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  var S = Svalue();
  var nmin = Math.min.apply(null, cnt);
  var sig = nmin ? 2 / Math.sqrt(nmin) : 99;
  if (S !== null && nmin >= 12 && Math.abs(S) - 2 > 3 * sig) {
    ctx.fillStyle = separable ? K.red(0.95) : K.amber(0.95);
    ctx.fillText(separable ?
      'SEPARABLE SOURCE: |S| ≤ 2 — LOCAL RULES HOLD' :
      'S HAS LEFT THE CLASSICAL BAND. THE ANSWERS WERE NEVER WRITTEN DOWN.', w / 2, y);
  } else {
    ctx.fillStyle = K.faint(0.9);
    ctx.fillText('PLAY MORE ROUNDS TO SETTLE THE SCORE', w / 2, y);
  }
}

function draw() {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);
  meter(w, h);
  cells(w, h);
  verdict(w, h);
}

var row = K.buttons(controls);
row.add('PLAY 1,000 ROUNDS', function () {
  if (K.REDUCED) playBurst(1000);
  else {
    var left = 1000;
    (function step() {
      playBurst(120);
      left -= 120;
      if (left > 0) setTimeout(step, 16);
    })();
  }
});
var autoBtn = row.add('RUN CONTINUOUSLY', function (b) {
  running = !running;
  b.classList.toggle('on', running);
  b.textContent = running ? 'STOP THE MACHINE' : 'RUN CONTINUOUSLY';
  if (running) ensureLoop();
});
K.toggle(controls, {
  label: 'CONTROL EXPERIMENT — SEPARABLE SOURCE (NO ENTANGLEMENT)',
  on: false,
  onChange: function (v) {
    separable = v;
    rounds = 0; acc = [0, 0, 0, 0]; cnt = [0, 0, 0, 0];
    syncReadout();
    draw();
  }
});
row.add('RESET SCORE', function () {
  rounds = 0; acc = [0, 0, 0, 0]; cnt = [0, 0, 0, 0];
  syncReadout();
  draw();
}, { cls: 'danger' });

function ensureLoop() {
  if (loopHandle) return;
  loopHandle = K.loop(function () {
    if (!running) { loopHandle = null; return false; }
    playBurst(240);
    return true;
  });
}

playBurst(200);
})();
