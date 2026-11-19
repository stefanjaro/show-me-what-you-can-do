/* HILBERT'S GARDEN — INSTRUMENT V · THE ONE-QUERY ORACLE */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i5-stage');
var controls = document.getElementById('i5-controls');
var readEl = document.getElementById('i5-readout');
if (!stage) return;
K.tag(stage, 'DEUTSCH–JOZSA · n = 3 · ONE ORACLE, TWO MACHINES', 'QUANTUM: EXACTLY ONE CALL');

var entry = K.makeCanvas(stage, 380, 'Race between a classical chip querying the oracle five times and a quantum circuit querying it once');
var ctx = entry.ctx;

var secret = null;   /* array of 8 bits */
var secretKind = '';
var raceStart = null;
var race = null;
var rng = Math.random;
var record = { classical: null, quantum: null };

var ro = K.readout(readEl);
ro.head('ORACLE LEDGER');
var roKind = ro.line('kind', 'SECRET (HIDDEN UNTIL RACED)');
var roC = ro.line('c', 'CLASSICAL QUERIES USED');
var roQ = ro.line('q', 'QUANTUM QUERIES USED');
var roBoth = ro.line('v', 'VERDICTS');
ro.note('The promise: f is constant or balanced — nothing else. Classical certainty can cost 2³⁻¹+1 = 5 calls; the secret below is always the worst case. The quantum verdict comes from a genuine run: Hadamards, oracle as a reversible unitary, interference, measurement.');

function newSecret() {
  secretKind = rng() < 0.5 ? 'constant' : 'balanced';
  secret = [];
  if (secretKind === 'constant') {
    var v = rng() < 0.5 ? 0 : 1;
    for (var i = 0; i < 8; i++) secret.push(v);
  } else {
    /* adversarial worst case: first half one value, second half the other */
    var v2 = rng() < 0.5 ? 0 : 1;
    for (var j = 0; j < 8; j++) secret.push(j < 4 ? v2 : 1 - v2);
  }
  race = null;
  raceStart = null;
  record = { classical: null, quantum: null };
  roKind.set('· · · · · · · ·');
  roC.set('—');
  roQ.set('—');
  roBoth.set('—');
  draw();
}

function classicalVerdict() {
  /* queries in order 0..7 until certain, worst-case logic */
  var seen0 = 0, seen1 = 0;
  for (var x = 0; x < 8; x++) {
    if (secret[x]) seen1++; else seen0++;
    if (seen0 >= 5 || seen1 >= 5) return { calls: x + 1, verdict: 'constant' };
    if (seen0 > 0 && seen1 > 0) return { calls: x + 1, verdict: 'balanced' };
  }
  return { calls: 8, verdict: 'constant' };
}
function quantumVerdict() {
  var q = new HG.QReg(4);
  for (var i = 0; i < 3; i++) q.apply1(i, HG.G.H);
  q.apply1(3, HG.G.X).apply1(3, HG.G.H);
  var qs = [0, 1, 2];
  q.oracleXor(qs, 3, function (x) { return secret[x]; });
  for (var j = 0; j < 3; j++) q.apply1(j, HG.G.H);
  var idx = q.sampleIndex();
  var x = HG.xvalOf(idx, qs);
  return { calls: 1, verdict: x === 0 ? 'constant' : 'balanced' };
}

function raceGo() {
  record.classical = classicalVerdict();
  record.quantum = quantumVerdict();
  roKind.set(secretKind.toUpperCase() + ' · ' + secret.join(''));
  raceStart = performance.now();
  if (K.REDUCED) {
    raceStart = null;
    roC.set(record.classical.calls + ' CALLS → ' + record.classical.verdict, 'am');
    roQ.set('1 CALL → ' + record.quantum.verdict, 'cy');
    roBoth.set(verdictCorrect() ? 'BOTH CORRECT · QUANTUM WON BY ' + (record.classical.calls - 1) + ' CALLS' : 'MISMATCH!', verdictCorrect() ? 'am' : 'rd');
    draw(-1);
    return;
  }
  ensureLoop();
}
function verdictCorrect() {
  return record.classical.verdict === secretKind && record.quantum.verdict === secretKind;
}

function ensureLoop() {
  K.loop(function (t) {
    if (raceStart === null) return false;
    var done = t - raceStart > 3400;
    draw(t - raceStart);
    if (done) {
      if (record.classical) {
        roC.set(record.classical.calls + ' CALLS → ' + record.classical.verdict, 'am');
        roQ.set('1 CALL → ' + record.quantum.verdict, 'cy');
        roBoth.set(verdictCorrect() ? 'BOTH CORRECT · QUANTUM WON BY ' + (record.classical.calls - 1) + ' CALLS' : 'MISMATCH!', verdictCorrect() ? 'am' : 'rd');
      }
      return false;
    }
    return true;
  });
}

function drawClassical(t, w) {
  var y = 62;
  ctx.fillStyle = K.faint(0.95);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('CLASSICAL CHIP', 24, y - 16);
  var calls = (t < 0 && record.classical) ? record.classical.calls : (raceStart === null ? 0 : Math.min(record.classical.calls, Math.floor(t / 380) + 1));
  var shown = raceStart === null && t === -1 ? 8 : 0;
  if (t >= 0 && raceStart !== null) shown = Math.min(8, Math.floor(t / 380) + 1);
  if (t === -1) shown = 8;
  for (var x = 0; x < 8; x++) {
    var bx = 24 + x * 34;
    ctx.strokeStyle = x < shown ? K.amber(0.9) : K.faint(0.45);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx, y - 12, 26, 24);
    if (x < shown) {
      ctx.fillStyle = secret[x] ? K.cyan(0.95) : K.txt(0.9);
      ctx.font = '12px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(secret[x]), bx + 13, y + 5);
    } else {
      ctx.fillStyle = K.faint(0.5);
      ctx.font = '10px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', bx + 13, y + 5);
    }
    ctx.fillStyle = K.faint(0.85);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText('f(' + x + ')', bx + 13, y + 24);
  }
  var doneC = record.classical && shown >= record.classical.calls;
  ctx.fillStyle = doneC ? K.amber(0.95) : K.faint(0.6);
  ctx.font = '10px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText(doneC ? 'VERDICT: ' + record.classical.verdict.toUpperCase() + ' · ' + record.classical.calls + ' CALLS' : 'QUERYING… ' + Math.max(0, shown) + '/5 FOR CERTAINTY', 300, y + 5);
}

function drawQuantum(t, w, h) {
  var y0 = 130, y1 = h - 66;
  ctx.fillStyle = K.cyan(0.95);
  ctx.font = '9px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('QUANTUM CIRCUIT', 24, y0 - 10);
  var wires = [];
  for (var i = 0; i < 3; i++) wires.push(y0 + 16 + i * 26);
  var yOut = y1 - 6;
  wires.push(yOut);
  var xH1 = 90, xOracle = w * 0.42, xH2 = w * 0.62, xM = w - 190;
  ctx.strokeStyle = K.faint(0.5);
  wires.forEach(function (wy, idx) {
    ctx.beginPath();
    ctx.moveTo(34, wy);
    ctx.lineTo(xM - 26, wy);
    ctx.stroke();
    ctx.fillStyle = K.faint(0.95);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'right';
    ctx.fillText(idx < 3 ? '|0⟩' : '|1⟩', 30, wy + 3);
  });
  function block(x, wy, label) {
    ctx.strokeStyle = K.cyan(0.7);
    ctx.strokeRect(x - 11, wy - 10, 22, 20);
    ctx.fillStyle = K.cyan(0.95);
    ctx.font = '10px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, wy + 3.5);
  }
  wires.forEach(function (wy, idx) {
    if (idx < 3) block(xH1, wy, 'H');
    else { block(xH1 - 14, wy, 'X'); block(xH1 + 14, wy, 'H'); }
    if (idx < 3) block(xH2, wy, 'H');
  });

  /* oracle */
  var oy0 = wires[0] - 16, oy1 = wires[3] + 16;
  ctx.strokeStyle = K.amber(0.9);
  ctx.lineWidth = 1.6;
  ctx.strokeRect(xOracle - 34, oy0, 68, oy1 - oy0);
  ctx.fillStyle = K.amber(0.95);
  ctx.font = '11px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Uf', xOracle, (oy0 + oy1) / 2 + 1);
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.fillText('THE ONE QUERY', xOracle, oy1 + 12);
  ctx.lineWidth = 1;

  /* lens annotation */
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('INTERFERENCE LENS', xH2, oy0 - 8);

  /* measurement gauge */
  ctx.strokeStyle = K.faint(0.6);
  ctx.beginPath();
  ctx.arc(xM, (wires[1] + wires[2]) / 2, 30, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();

  /* pulse animation */
  if (t >= 0 && raceStart !== null) {
    var u = t / 3400;
    var px;
    if (u < 0.25) {
      px = 34 + (xH1 - 34) * (u / 0.25);
      dot(px, wires[1], K.cyan(0.9));
    } else if (u < 0.45) {
      /* superposition glow on all wires */
      var su = (u - 0.25) / 0.2;
      var sx = xH1 + (xOracle - xH1) * su;
      wires.slice(0, 3).forEach(function (wy) {
        dot(sx, wy, K.cyan(0.55));
      });
      dot(sx, wires[3], K.amber(0.4));
    } else if (u < 0.6) {
      var ou = (u - 0.45) / 0.15;
      var cx = xOracle - 34 + 68 * ou;
      wires.slice(0, 3).forEach(function (wy) { dot(cx, wy, K.amber(0.75)); });
      dot(cx, wires[3], K.amber(0.75));
      if (ou > 0.98) {
        ctx.fillStyle = K.amber(0.25);
        ctx.fillRect(xOracle - 34, oy0, 68, oy1 - oy0);
      }
    } else if (u < 0.78) {
      var lu = (u - 0.6) / 0.18;
      var lx = xOracle + (xH2 - xOracle) * lu;
      wires.slice(0, 3).forEach(function (wy) { dot(lx, wy, K.cyan(0.7)); });
    } else {
      /* collapse to verdict */
      var my = (wires[1] + wires[2]) / 2;
      dot(xM, my, K.amber(1));
      ctx.fillStyle = K.amber(0.95);
      ctx.font = '10px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'left';
      ctx.fillText('→ ' + record.quantum.verdict.toUpperCase() + ' · 1 CALL', xM + 44, my + 3);
    }
  } else if (t === -1) {
    var my2 = (wires[1] + wires[2]) / 2;
    dot(xM, my2, K.amber(1));
    ctx.fillStyle = K.amber(0.95);
    ctx.font = '10px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('→ ' + record.quantum.verdict.toUpperCase() + ' · 1 CALL', xM + 44, my2 + 3);
  }
}
function dot(x, y, color) {
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fill();
  ctx.shadowBlur = 0;
}

function draw(t) {
  var w = entry.w, h = entry.h;
  if (t === undefined) t = -2;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = K.faint(0.25);
  ctx.beginPath(); ctx.moveTo(20, 96); ctx.lineTo(w - 20, 96); ctx.stroke();
  drawClassical(raceStart === null ? (t === -1 ? -1 : 0) : t, w);
  drawQuantum(raceStart === null ? (t === -1 ? -1 : -2) : t, w, h);
  ctx.fillStyle = K.faint(0.85);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('THE SECRET:  ' + (raceStart === null && record.classical === null ? '· · ·  HIDDEN  · · ·' : secret.join(' ') + '   (' + secretKind.toUpperCase() + ')'), w / 2, h - 24);
}

var row = K.buttons(controls);
row.add('RACE THE MACHINES', function () { raceGo(); }, { cls: 'big' });
row.add('NEW SECRET', function () { newSecret(); });
newSecret();
})();
