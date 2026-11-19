/* HILBERT'S GARDEN — INSTRUMENT I · THE QUBIT */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i1-stage');
var controls = document.getElementById('i1-controls');
var readEl = document.getElementById('i1-readout');
if (!stage) return;
K.tag(stage, 'BLOCH SPHERE · 1 QUBIT · LIVE STATEVECTOR', 'DRAG TO ORBIT');

var entry = K.makeCanvas(stage, 440, 'Bloch sphere showing the qubit state; drag to orbit');
var bloch = new K.Bloch(entry);
var state = new HG.QReg(1);

var ro = K.readout(readEl);
ro.head('STATE READOUT');
var roState = K.el('div', '', readEl); roState.style.cssText = 'font-family:var(--mono);font-size:.8rem;color:var(--txt);line-height:1.7;min-height:1.7em';
roState.innerHTML = '';
var roTheta = ro.line('theta', 'θ POLAR');
var roPhi = ro.line('phi', 'φ AZIMUTH');
var roP0 = ro.line('p0', 'P(|0⟩)');
var roP1 = ro.line('p1', 'P(|1⟩)');
var roTally = ro.line('tally', 'MEASURED 0/1');
var roLast = ro.line('last', 'LAST OUTCOME');
ro.note('Every gate is an exact 2×2 complex unitary applied to the live statevector. The arrow is its Bloch vector — no animation is faked; the trail is where the state has actually been.');

var tally0 = 0, tally1 = 0;

function fmtAmp(re, im, ket) {
  var hueCss = K.hueCss(re, im, 0.95);
  return '<span style="color:' + hueCss + '">' + HG.cstr({ re: re, im: im }) + '</span> <span style="color:var(--faint)">' + ket + '</span>';
}
function sync() {
  var a0 = state.amp(0), a1 = state.amp(1);
  var b = state.reducedBloch(0);
  bloch.setTarget(b.x, b.y, b.z);
  var inner = fmtAmp(a0.re, a0.im, '|0⟩');
  if (Math.abs(a1.re) > 1e-4 || Math.abs(a1.im) > 1e-4) inner += ' + ' + fmtAmp(a1.re, a1.im, '|1⟩');
  roState.innerHTML = '|ψ⟩ = ' + inner;
  var th = Math.acos(Math.max(-1, Math.min(1, b.z))) * 180 / Math.PI;
  var ph = Math.atan2(b.y, b.x) * 180 / Math.PI;
  if (ph < 0) ph += 360;
  roTheta.set(th.toFixed(1) + '°', 'am');
  roPhi.set(ph.toFixed(1) + '°', 'am');
  var p = state.probs();
  roP0.set(p[0].toFixed(4), 'cy');
  roP1.set(p[1].toFixed(4), 'cy');
  roTally.set(tally0 + ' / ' + tally1);
}
sync();
bloch.render();

function apply(m) {
  state.apply1(0, m);
  bloch.pulse();
  sync();
}

var row1 = K.buttons(controls);
row1.add('X', function () { apply(HG.G.X); });
row1.add('Y', function () { apply(HG.G.Y); });
row1.add('Z', function () { apply(HG.G.Z); });
row1.add('H · hadamard', function () { apply(HG.G.H); });
row1.add('S', function () { apply(HG.G.S); });
row1.add('T', function () { apply(HG.G.T); });
row1.add('S†', function () { apply(HG.G.Sdg); });
row1.add('T†', function () { apply(HG.G.Tdg); });

K.el('div', 'ctl-label', controls).textContent = 'ROTATIONS BY ANGLE θ';
var row2 = K.buttons(controls);
var theta = Math.PI / 2;
var rotRow = K.buttons(controls);
rotRow.add('RX(θ)', function () { apply(HG.RX(theta)); }, { cls: 'big' });
rotRow.add('RY(θ)', function () { apply(HG.RY(theta)); }, { cls: 'big' });
rotRow.add('RZ(θ)', function () { apply(HG.RZ(theta)); }, { cls: 'big' });
K.slider(controls, {
  label: 'GATE ANGLE θ',
  min: 0, max: 360, step: 5, value: 90,
  fmt: function (v) { return v.toFixed(0) + '°'; },
  onInput: function (v) { theta = v * Math.PI / 180; }
});

var row3 = K.buttons(controls);
row3.add('RESET TO |0⟩', function () {
  state = new HG.QReg(1);
  tally0 = 0; tally1 = 0;
  roLast.set('—');
  sync();
}, { cls: 'danger' });

var measureBtn = row3.add('MEASURE', function () {
  measureBtn.disabled = true;
  bloch.pulse();
  var b = state.reducedBloch(0);
  var out = state.measure(0);
  if (out === 0) tally0++; else tally1++;
  var pole = { x: 0, y: 0, z: out === 0 ? 1 : -1 };
  setTimeout(function () {
    bloch.setTarget(pole.x, pole.y, pole.z, K.REDUCED);
    bloch.flashes.push({ r: 0, a: 0.9, at: pole });
    roLast.set(out === 0 ? '|0⟩' : '|1⟩', out === 0 ? 'am' : 'cy');
    sync();
    measureBtn.disabled = false;
  }, K.REDUCED ? 0 : 420);
}, { cls: 'big' });
})();
