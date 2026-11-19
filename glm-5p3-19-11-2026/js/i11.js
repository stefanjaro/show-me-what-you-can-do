/* HILBERT'S GARDEN — INSTRUMENT XI · THE CIRCUIT BENCH */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i11-stage');
var controls = document.getElementById('i11-controls');
var readEl = document.getElementById('i11-readout');
if (!stage) return;
K.tag(stage, 'CIRCUIT BENCH · CLICK TO PLACE · RUNS LIVE', 'THE WHOLE GARDEN, ONE PEN');

var entry = K.makeCanvas(stage, 540, 'Quantum circuit editor: place gates on the wires, then run the statevector');
var ctx = entry.ctx;

var n = 3;
var ops = [];            /* see serialization below */
var tool = 'H';
var theta = Math.PI / 2;
var pending2 = null;     /* {g, c, col} awaiting target */
var hover = { col: -1, row: -1 };
var maxCols = 14;
var seed = 2026;
var stateNow = null;
var stepCol = -1;
var mBits = [];
var lastHist = null;

var ro = K.readout(readEl);
ro.head('BENCH LEDGER');
var roTool = ro.line('tool', 'SELECTED GATE');
var roDepth = ro.line('depth', 'CIRCUIT DEPTH · GATES');
var roRun = ro.line('run', 'RUN STATUS');
var roM = ro.line('m', 'MID-CIRCUIT BITS');
var roQ = ro.line('q', 'REDUCED BLOCH PER WIRE');
ro.note('Two-qubit gates: click the control wire, then the target wire. Mid-circuit measurement (M) collapses honestly; the teleportation preset uses classical feedback — corrections applied from the measured bits. The share button encodes the whole circuit into your address bar.');

/* ---------- serialization ---------- */
function opToken(o) {
  switch (o.type) {
    case '1q': return o.g + ':' + o.q + '.' + o.col + (o.ang !== undefined ? '.' + Math.round(o.ang * 1000).toString(36) : '');
    case '2q': return o.g + ':' + o.c + '.' + o.t + '.' + o.col + (o.ang !== undefined ? '.' + Math.round(o.ang * 1000).toString(36) : '');
    case 'm': return 'M:' + o.q + '.' + o.col;
    case 'cond': return 'Q' + o.g + ':' + o.q + '.' + o.col + '.' + o.ref;
  }
  return '';
}
function parseToken(t) {
  var ci = t.indexOf(':');
  if (ci < 0) return null;
  var head = t.slice(0, ci);
  var rest = t.slice(ci + 1).split('.');
  if (head === 'M' && rest.length === 2) return { type: 'm', q: +rest[0], col: +rest[1] };
  if ((head === 'QX' || head === 'QZ') && rest.length === 3) {
    return { type: 'cond', g: head[1], q: +rest[0], col: +rest[1], ref: +rest[2] };
  }
  if (head === 'C' || head === 'Z' || head === 'W' || head === 'P') {
    if (rest.length === 3 || (head === 'P' && rest.length === 4)) {
      var o = { type: '2q', g: head, c: +rest[0], t: +rest[1], col: +rest[2] };
      if (rest[3] !== undefined) o.ang = parseInt(rest[3], 36) / 1000;
      return o;
    }
    return null;
  }
  if (head === 'Rz') {
    if (rest.length === 2 || rest.length === 3) {
      var o2 = { type: '1q', g: 'Rz', q: +rest[0], col: +rest[1] };
      if (rest[2] !== undefined) o2.ang = parseInt(rest[2], 36) / 1000;
      return o2;
    }
    return null;
  }
  if (rest.length === 2) return { type: '1q', g: head, q: +rest[0], col: +rest[1] };
  return null;
}
function serialize() {
  return 'n' + n + '|' + ops.map(opToken).join(',');
}
function deserialize(str) {
  var m = /^n([2-6])\|(.*)$/.exec(str);
  if (!m) return false;
  n = +m[1];
  ops = [];
  m[2].split(',').forEach(function (t) {
    if (!t) return;
    var o = parseToken(t);
    if (o) ops.push(o);
  });
  return true;
}
var hashTimer = null;
function pushHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(function () {
    try { history.replaceState(null, '', '#c=' + encodeURIComponent(serialize())); } catch (e) {}
  }, 250);
}

/* ---------- geometry ---------- */
function grid() {
  var w = entry.w;
  var x0 = 50, x1 = w - 18;
  var colw = (x1 - x0) / maxCols;
  var y0 = 34, rowh = 30;
  return { x0: x0, colw: colw, y0: y0, rowh: rowh, rows: n, cols: maxCols };
}
function cellAt(x, y) {
  var g = grid();
  var col = Math.floor((x - g.x0) / g.colw);
  var row = Math.floor((y - g.y0) / g.rowh);
  if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) return null;
  return { col: col, row: row };
}
function opAtCell(col, row) {
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    if (o.type === '1q' || o.type === 'm') { if (o.q === row && o.col === col) return o; }
    else if (o.type === 'cond') { if (o.q === row && o.col === col) return o; }
    else { if ((o.c === row || o.t === row) && o.col === col) return o; }
  }
  return null;
}

/* ---------- run ---------- */
function resetState() {
  stateNow = new HG.QReg(n);
  stepCol = -1;
  mBits = [];
}
function applyCol(col) {
  var order = { '1q': 0, '2q': 1, 'm': 2, 'cond': 3 };
  var colOps = ops.filter(function (o) { return o.col === col; })
    .sort(function (a, b) { return order[a.type] - order[b.type]; });
  var rng = HG.mulberry32(seed + 77 * col);
  colOps.forEach(function (o) {
    if (o.type === '1q') {
      var m;
      if (o.g === 'Rz') m = HG.RZ(o.ang !== undefined ? o.ang : theta);
      else m = HG.G[o.g];
      stateNow.apply1(o.q, m);
    } else if (o.type === '2q') {
      if (o.g === 'C') stateNow.cnot(o.c, o.t);
      else if (o.g === 'Z') stateNow.cz(o.c, o.t);
      else if (o.g === 'P') stateNow.cp(o.c, o.t, o.ang !== undefined ? o.ang : Math.PI / 4);
      else if (o.g === 'W') stateNow.swap(o.c, o.t);
    } else if (o.type === 'm') {
      mBits.push({ q: o.q, col: col, bit: stateNow.measure(o.q, rng) });
    } else if (o.type === 'cond') {
      var ref = mBits[o.ref];
      if (ref && ref.bit) stateNow.apply1(o.q, o.g === 'X' ? HG.G.X : HG.G.Z);
    }
  });
}
function depthUsed() {
  var d = 0;
  ops.forEach(function (o) { if (o.col + 1 > d) d = o.col + 1; });
  return d;
}
function runFull() {
  resetState();
  for (var c = 0; c < maxCols; c++) applyCol(c);
  stepCol = depthUsed() - 1;
  /* histogram */
  lastHist = {};
  var hr = HG.mulberry32(seed + 5);
  for (var s = 0; s < 512; s++) {
    var idx = stateNow.sampleIndex(hr);
    lastHist[idx] = (lastHist[idx] || 0) + 1;
  }
  syncReadout();
  draw();
}
function stepOnce() {
  if (stepCol + 1 >= maxCols) { runFull(); return; }
  resetState();
  stepCol++;
  for (var c = 0; c <= stepCol; c++) applyCol(c);
  syncReadout();
  draw();
}
function syncReadout() {
  roTool.set(toolLabel());
  var gates = ops.filter(function (o) { return o.type !== 'm'; }).length;
  roDepth.set((depthUsed() || 0) + ' / ' + maxCols + ' · ' + gates + ' GATES' + (ops.some(function (o) { return o.type === 'm'; }) ? ' + ' + ops.filter(function (o) { return o.type === 'm'; }).length + ' MEASUREMENTS' : ''), 'cy');
  if (stepCol < 0) roRun.set('NOT RUN — PRESS RUN OR STEP', 'rd');
  else if (stepCol >= depthUsed() - 1) roRun.set('COMPLETE · ' + (1 << n) + ' AMPLITUDES LIVE', 'am');
  else roRun.set('STEPPED TO COLUMN ' + stepCol, 'am');
  roM.set(mBits.length ? mBits.map(function (m) { return 'q' + m.q + '=' + m.bit; }).join('  ') : '—', 'cy');
  if (stateNow && stepCol >= 0) {
    var parts = [];
    for (var q = 0; q < n; q++) {
      var b = stateNow.reducedBloch(q);
      var dead = Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.z) < 0.02;
      parts.push('q' + q + ': ' + (dead ? 'NO PRIVATE STATE (ENTANGLED)' : b.x.toFixed(2) + ',' + b.y.toFixed(2) + ',' + b.z.toFixed(2)));
    }
    roQ.set(parts.join('   '), 'am');
  } else roQ.set('—');
}
function toolLabel() {
  var map = {
    H: 'HADAMARD', X: 'PAULI X', Y: 'PAULI Y', Z: 'PAULI Z', S: 'PHASE S', T: 'PHASE T',
    Sdg: 'S†', Tdg: 'T†', Rz: 'RZ(θ) — USE THE θ SLIDER',
    CNOT: 'CNOT — CLICK CONTROL, THEN TARGET',
    CZ: 'CONTROLLED-Z — CLICK CONTROL, THEN TARGET',
    CP: 'CONTROLLED-PHASE CP(θ)', SWAP: 'SWAP — CLICK TWO WIRES',
    M: 'MEASUREMENT — COLLAPSES', erase: 'ERASER'
  };
  return map[tool] || tool;
}

/* ---------- drawing ---------- */
function draw() {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);
  var g = grid();

  /* wires */
  for (var q = 0; q < n; q++) {
    var y = g.y0 + q * g.rowh + g.rowh / 2;
    ctx.strokeStyle = K.faint(0.45);
    ctx.beginPath();
    ctx.moveTo(g.x0 - 36, y);
    ctx.lineTo(g.x0 + g.colw * g.cols, y);
    ctx.stroke();
    ctx.fillStyle = K.faint(0.95);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'right';
    ctx.fillText('|0⟩', g.x0 - 12, y + 3);
    ctx.textAlign = 'left';
    ctx.fillText('q' + q, g.x0 - 10, y - 10);
  }
  /* column ticks */
  for (var c = 0; c <= g.cols; c += 2) {
    var x = g.x0 + g.colw * c;
    ctx.strokeStyle = K.faint(0.12);
    ctx.beginPath(); ctx.moveTo(x, g.y0 - 6); ctx.lineTo(x, g.y0 + g.rowh * n + 6); ctx.stroke();
  }
  /* step marker */
  if (stepCol >= 0) {
    var sx = g.x0 + g.colw * (stepCol + 0.5);
    ctx.strokeStyle = K.amber(0.35);
    ctx.beginPath(); ctx.moveTo(sx, g.y0 - 10); ctx.lineTo(sx, g.y0 + g.rowh * n + 10); ctx.stroke();
  }

  /* hover ghost */
  if (hover.col >= 0 && tool !== 'erase') {
    var hx = g.x0 + hover.col * g.colw + g.colw / 2;
    var hy = g.y0 + hover.row * g.rowh + g.rowh / 2;
    if (pending2) {
      ctx.strokeStyle = K.amber(0.4);
      ctx.setLineDash([3, 3]);
      var py = g.y0 + pending2.c * g.rowh + g.rowh / 2;
      ctx.beginPath(); ctx.moveTo(g.x0 + pending2.col * g.colw + g.colw / 2, py); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = K.amber(0.6);
      ctx.font = '8px ui-monospace,Menlo,monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TARGET?', hx, hy - 12);
    } else {
      ctx.strokeStyle = K.faint(0.4);
      ctx.strokeRect(hx - 11, hy - 10, 22, 20);
    }
  }

  /* ops */
  ops.forEach(function (o) {
    var cx = g.x0 + o.col * g.colw + g.colw / 2;
    if (o.type === '1q' || o.type === 'm' || o.type === 'cond') {
      var cy = g.y0 + o.q * g.rowh + g.rowh / 2;
      if (o.type === 'm') {
        ctx.strokeStyle = K.cyan(0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, 9, Math.PI, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy); ctx.stroke();
      } else if (o.type === 'cond') {
        ctx.strokeStyle = K.amber(0.9);
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(cx - 12, cy - 9, 24, 18);
        ctx.setLineDash([]);
        ctx.fillStyle = K.amber(0.95);
        ctx.font = '9px ui-monospace,Menlo,monospace';
        ctx.textAlign = 'center';
        ctx.fillText(o.g + '·m' + o.ref, cx, cy + 3);
      } else {
        ctx.strokeStyle = K.cyan(0.75);
        ctx.strokeRect(cx - 10, cy - 9, 20, 18);
        ctx.fillStyle = K.cyan(0.95);
        ctx.font = '9px ui-monospace,Menlo,monospace';
        ctx.textAlign = 'center';
        var lab = o.g === 'Rz' ? 'Rz' : o.g === 'Sdg' ? 'S†' : o.g === 'Tdg' ? 'T†' : o.g;
        ctx.fillText(lab, cx, cy + 3);
      }
    } else {
      var cy1 = g.y0 + o.c * g.rowh + g.rowh / 2;
      var cy2 = g.y0 + o.t * g.rowh + g.rowh / 2;
      ctx.strokeStyle = K.amber(0.85);
      ctx.beginPath(); ctx.moveTo(cx, cy1); ctx.lineTo(cx, cy2); ctx.stroke();
      if (o.g === 'C') {
        ctx.fillStyle = K.amber(0.95);
        ctx.beginPath(); ctx.arc(cx, cy1, 4, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = K.amber(0.95);
        ctx.beginPath(); ctx.arc(cx, cy2, 7, 0, 6.2832); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 7, cy2); ctx.lineTo(cx + 7, cy2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy2 - 7); ctx.lineTo(cx, cy2 + 7); ctx.stroke();
      } else if (o.g === 'Z' || o.g === 'P') {
        ctx.fillStyle = K.amber(0.95);
        ctx.beginPath(); ctx.arc(cx, cy1, 4, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy2, 4, 0, 6.2832); ctx.fill();
        if (o.g === 'P') {
          ctx.fillStyle = K.amber(0.8);
          ctx.font = '8px ui-monospace,Menlo,monospace';
          ctx.textAlign = 'center';
          ctx.fillText('cp', cx + 12, (cy1 + cy2) / 2);
        }
      } else if (o.g === 'W') {
        [cy1, cy2].forEach(function (yy) {
          ctx.strokeStyle = K.amber(0.95);
          ctx.beginPath();
          ctx.moveTo(cx - 5, yy - 5); ctx.lineTo(cx + 5, yy + 5);
          ctx.moveTo(cx + 5, yy - 5); ctx.lineTo(cx - 5, yy + 5);
          ctx.stroke();
        });
      }
    }
  });

  /* statevector + histogram */
  var areaY = g.y0 + n * g.rowh + 26;
  var state = (stateNow && stepCol >= 0) ? stateNow : new HG.QReg(n);
  ctx.fillStyle = K.faint(0.95);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FINAL STATEVECTOR · HEIGHT = P · COLOR = PHASE', 22, areaY - 6);
  var barsW = w * 0.55 - 30;
  K.drawBars(ctx, { x: 22, y: areaY, w: barsW, h: 132 }, state.probs(), statePhases(state), {
    labels: n <= 3,
    max: 1
  });
  ctx.fillStyle = K.faint(0.95);
  ctx.textAlign = 'left';
  ctx.fillText('512 SHOTS', w * 0.58, areaY - 6);
  drawHist(w * 0.58, areaY, w * 0.4, 132);
}
function statePhases(q) {
  var out = [];
  for (var i = 0; i < q.d; i++) out.push([q.re[i], q.im[i]]);
  return out;
}
function drawHist(x0, y0, tw, th) {
  var entries = [];
  if (lastHist) {
    Object.keys(lastHist).forEach(function (k) {
      entries.push({ idx: +k, n: lastHist[k] });
    });
    entries.sort(function (a, b) { return b.n - a.n; });
  }
  var top = entries.slice(0, 5);
  var otherN = entries.slice(5).reduce(function (a, e) { return a + e.n; }, 0);
  var maxN = Math.max(1, top.length ? top[0].n : 1, otherN);
  var rowH = 20;
  top.forEach(function (e, i) {
    var y = y0 + i * rowH;
    ctx.fillStyle = K.amber(0.8);
    ctx.fillRect(x0, y, (tw - 70) * e.n / maxN, 12);
    ctx.fillStyle = K.txt(0.85);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('|' + K.bits(e.idx, n) + '⟩', x0 + tw - 66, y + 10);
    ctx.textAlign = 'right';
    ctx.fillText((e.n / 512 * 100).toFixed(1) + '%', x0 + tw, y + 10);
  });
  if (otherN) {
    var y2 = y0 + 5 * rowH;
    ctx.fillStyle = K.faint(0.45);
    ctx.fillRect(x0, y2, (tw - 70) * otherN / maxN, 12);
    ctx.fillStyle = K.faint(0.9);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'right';
    ctx.fillText('OTHER ' + (otherN / 512 * 100).toFixed(1) + '%', x0 + tw, y2 + 10);
  }
  if (!top.length) {
    ctx.fillStyle = K.faint(0.7);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PRESS RUN', x0, y0 + 12);
  }
}

/* ---------- interaction ---------- */
entry.canvas.addEventListener('pointermove', function (e) {
  var rect = entry.canvas.getBoundingClientRect();
  var cell = cellAt(e.clientX - rect.left, e.clientY - rect.top);
  hover = cell || { col: -1, row: -1 };
  draw();
});
entry.canvas.addEventListener('pointerleave', function () {
  hover = { col: -1, row: -1 };
  draw();
});
entry.canvas.addEventListener('pointerdown', function (e) {
  var rect = entry.canvas.getBoundingClientRect();
  var cell = cellAt(e.clientX - rect.left, e.clientY - rect.top);
  if (!cell) return;
  var existing = opAtCell(cell.col, cell.row);

  if (tool === 'erase') {
    if (existing) {
      ops.splice(ops.indexOf(existing), 1);
      afterEdit();
    }
    return;
  }
  if (tool === 'CNOT' || tool === 'CZ' || tool === 'CP' || tool === 'SWAP') {
    if (pending2) {
      if (pending2.c === cell.row) { pending2 = null; draw(); return; }
      var o = { type: '2q', g: tool === 'CNOT' ? 'C' : tool === 'CZ' ? 'Z' : tool === 'CP' ? 'P' : 'W', c: pending2.c, t: cell.row, col: pending2.col };
      if (tool === 'CP') o.ang = theta;
      if (existing) ops.splice(ops.indexOf(existing), 1);
      ops.push(o);
      pending2 = null;
      afterEdit();
    } else {
      pending2 = { g: tool, c: cell.row, col: cell.col };
      draw();
    }
    return;
  }
  /* single-qubit or measurement */
  var op = tool === 'M' ? { type: 'm', q: cell.row, col: cell.col } :
    { type: '1q', g: tool, q: cell.row, col: cell.col };
  if (tool === 'Rz') op.ang = theta;
  if (existing) ops.splice(ops.indexOf(existing), 1);
  ops.push(op);
  afterEdit();
});
function afterEdit() {
  resetState();
  lastHist = null;
  syncReadout();
  draw();
  pushHash();
}

/* ---------- controls ---------- */
var row1 = K.buttons(controls);
['H', 'X', 'Y', 'Z', 'S', 'T', 'Sdg', 'Tdg', 'Rz'].forEach(function (g) {
  row1.add(g === 'Sdg' ? 'S†' : g === 'Tdg' ? 'T†' : g, function (b) {
    tool = g;
    pending2 = null;
    syncReadout();
    draw();
  });
});
var row2 = K.buttons(controls);
row2.add('CNOT', function () { tool = 'CNOT'; pending2 = null; syncReadout(); draw(); });
row2.add('CZ', function () { tool = 'CZ'; pending2 = null; syncReadout(); draw(); });
row2.add('CP(θ)', function () { tool = 'CP'; pending2 = null; syncReadout(); draw(); });
row2.add('SWAP', function () { tool = 'SWAP'; pending2 = null; syncReadout(); draw(); });
row2.add('MEASURE', function () { tool = 'M'; pending2 = null; syncReadout(); draw(); });
row2.add('ERASE', function () { tool = 'erase'; pending2 = null; syncReadout(); draw(); }, { cls: 'danger' });

K.slider(controls, {
  label: 'ANGLE θ FOR Rz / CP',
  min: 0, max: 360, step: 5, value: 90,
  fmt: function (v) { return v.toFixed(0) + '°'; },
  onInput: function (v) { theta = v * Math.PI / 180; }
});

var row3 = K.buttons(controls);
row3.add('RUN', function () { runFull(); }, { cls: 'big' });
row3.add('STEP ▸', function () { stepOnce(); });
row3.add('CLEAR', function () {
  ops = []; pending2 = null;
  afterEdit();
}, { cls: 'danger' });
row3.add('RE-ROLL SEED', function () {
  seed = Math.floor(Math.random() * 1e9);
  if (stepCol >= 0) runFull();
});
var shareBtn = row3.add('COPY SHARE LINK', function () {
  pushHash();
  try {
    var url = location.href.split('#')[0] + '#c=' + encodeURIComponent(serialize());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        var old = shareBtn.textContent;
        shareBtn.textContent = 'LINK COPIED ✓';
        setTimeout(function () { shareBtn.textContent = old; }, 1600);
      }, function () { location.hash = 'c=' + encodeURIComponent(serialize()); });
    } else {
      location.hash = 'c=' + encodeURIComponent(serialize());
    }
  } catch (e) {}
});

K.selectRow(controls, {
  label: 'WIRES',
  options: [
    { v: '2', t: '2 qubits' }, { v: '3', t: '3 qubits' },
    { v: '4', t: '4 qubits' }, { v: '5', t: '5 qubits' }, { v: '6', t: '6 qubits' }
  ],
  value: '3',
  onChange: function (v) {
    n = +v;
    ops = ops.filter(function (o) {
      if (o.type === '2q') return o.c < n && o.t < n;
      return o.q < n;
    });
    selWires.value = String(n);
    afterEdit();
  }
});
var selWires = controls.querySelector('select');

K.el('div', 'ctl-label', controls).textContent = 'PRESETS — THE GARDEN\'S GREATEST HITS';
var row4 = K.buttons(controls);
row4.add('BELL PAIR', function () {
  n = 2; ops = [
    { type: '1q', g: 'H', q: 0, col: 0 },
    { type: '2q', g: 'C', c: 0, t: 1, col: 1 }
  ];
  selWires.value = String(n);
  afterEdit(); runFull();
});
row4.add('GHZ', function () {
  n = 3; ops = [
    { type: '1q', g: 'H', q: 0, col: 0 },
    { type: '2q', g: 'C', c: 0, t: 1, col: 1 },
    { type: '2q', g: 'C', c: 0, t: 2, col: 2 }
  ];
  selWires.value = String(n);
  afterEdit(); runFull();
});
row4.add('GROVER N=4', function () {
  n = 2; ops = [
    { type: '1q', g: 'H', q: 0, col: 0 }, { type: '1q', g: 'H', q: 1, col: 0 },
    { type: '1q', g: 'X', q: 0, col: 1 },
    { type: '2q', g: 'Z', c: 0, t: 1, col: 2 },
    { type: '1q', g: 'X', q: 0, col: 3 },
    { type: '1q', g: 'H', q: 0, col: 4 }, { type: '1q', g: 'H', q: 1, col: 4 },
    { type: '1q', g: 'X', q: 0, col: 5 }, { type: '1q', g: 'X', q: 1, col: 5 },
    { type: '2q', g: 'Z', c: 0, t: 1, col: 6 },
    { type: '1q', g: 'X', q: 0, col: 7 }, { type: '1q', g: 'X', q: 1, col: 7 },
    { type: '1q', g: 'H', q: 0, col: 8 }, { type: '1q', g: 'H', q: 1, col: 8 }
  ];
  selWires.value = String(n);
  afterEdit(); runFull();
});
row4.add('DEUTSCH–JOZSA', function () {
  n = 4; ops = [
    { type: '1q', g: 'H', q: 0, col: 0 }, { type: '1q', g: 'H', q: 1, col: 0 }, { type: '1q', g: 'H', q: 2, col: 0 },
    { type: '1q', g: 'X', q: 3, col: 0 }, { type: '1q', g: 'H', q: 3, col: 1 },
    { type: '2q', g: 'C', c: 0, t: 3, col: 2 },
    { type: '2q', g: 'C', c: 1, t: 3, col: 3 },
    { type: '2q', g: 'C', c: 2, t: 3, col: 4 },
    { type: '1q', g: 'H', q: 0, col: 5 }, { type: '1q', g: 'H', q: 1, col: 5 }, { type: '1q', g: 'H', q: 2, col: 5 }
  ];
  selWires.value = String(n);
  afterEdit(); runFull();
});
row4.add('QFT × 8', function () {
  n = 3; ops = [
    { type: '1q', g: 'H', q: 2, col: 0 },
    { type: '2q', g: 'P', c: 1, t: 2, col: 1, ang: Math.PI / 2 },
    { type: '2q', g: 'P', c: 0, t: 2, col: 2, ang: Math.PI / 4 },
    { type: '1q', g: 'H', q: 1, col: 3 },
    { type: '2q', g: 'P', c: 0, t: 1, col: 4, ang: Math.PI / 2 },
    { type: '1q', g: 'H', q: 0, col: 5 },
    { type: '2q', g: 'W', c: 0, t: 2, col: 6 }
  ];
  selWires.value = String(n);
  afterEdit(); runFull();
});
row4.add('TELEPORTATION', function () {
  n = 3; ops = [
    { type: '1q', g: 'H', q: 0, col: 0 },
    { type: '1q', g: 'T', q: 0, col: 1 },
    { type: '1q', g: 'H', q: 1, col: 2 },
    { type: '2q', g: 'C', c: 1, t: 2, col: 3 },
    { type: '2q', g: 'C', c: 0, t: 1, col: 4 },
    { type: '1q', g: 'H', q: 0, col: 5 },
    { type: 'm', q: 0, col: 6 },
    { type: 'm', q: 1, col: 7 },
    { type: 'cond', g: 'X', q: 2, col: 8, ref: 1 },
    { type: 'cond', g: 'Z', q: 2, col: 9, ref: 0 }
  ];
  selWires.value = String(n);
  afterEdit(); runFull();
});

/* boot: hash? */
var mHash = /[#&]c=([^&]+)/.exec(location.hash || '');
if (mHash) {
  try {
    if (deserialize(decodeURIComponent(mHash[1]))) {
      afterEdit();
      runFull();
    }
  } catch (e) {}
} else {
  ops = [
    { type: '1q', g: 'H', q: 0, col: 0 },
    { type: '2q', g: 'C', c: 0, t: 1, col: 1 },
    { type: '1q', g: 'H', q: 2, col: 2 },
    { type: '2q', g: 'C', c: 2, t: 1, col: 3 }
  ];
  afterEdit();
  runFull();
}
})();
