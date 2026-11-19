/* HILBERT'S GARDEN — INSTRUMENT VIII · THE UNBREAKABLE LETTER */
(function () {
'use strict';
var HG = window.HG, K = window.HGK;
var stage = document.getElementById('i8-stage');
var controls = document.getElementById('i8-controls');
var readEl = document.getElementById('i8-readout');
if (!stage) return;
K.tag(stage, 'BENNETT–BRASSARD 1984 · POLARIZED PHOTONS', 'YOU ARE THE ONLY SPY AVAILABLE');

var entry = K.makeCanvas(stage, 430, 'BB84 key exchange table: bits, bases, photons, sifting, and the error check that catches Eve');
var ctx = entry.ctx;

var eve = false;
var table = [];      /* rows for the visible 24 photons */
var key = [];
var stats = { sent: 0, sifted: 0, sampleN: 0, sampleErr: 0 };
var cipherBytes = null;
var sealedText = '';
var rng = Math.random;

var ro = K.readout(readEl);
ro.head('KEY LEDGER');
var roSent = ro.line('sent', 'PHOTONS SENT');
var roSift = ro.line('sift', 'SIFTED KEY BITS');
var roSam = ro.line('sam', 'PUBLIC SAMPLE CHECK');
var roQber = ro.line('qber', 'SAMPLE ERROR RATE');
var roVerdict = ro.line('v', 'VERDICT');
var roKey = ro.line('key', 'KEY (FIRST 48 BITS)');
var roLetter = ro.line('letter', 'YOUR LETTER');
ro.note('Honest photons only: each is a live qubit — prepared, possibly intercepted-and-collapsed, measured. The error rate is not scripted; with Eve in the line it converges to 25%, without her it is exactly 0. Physics signs this receipt.');

function basisGlyph(x, y, basis, bit, color, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(basis ? Math.PI / 4 : 0);
  var ang = bit ? Math.PI / 2 : 0;
  ctx.rotate(ang);
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-7, 0); ctx.lineTo(7, 0);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function onePhoton() {
  var bit = rng() < 0.5 ? 0 : 1;
  var aBasis = rng() < 0.5 ? 0 : 1;
  var q = new HG.QReg(1);
  if (bit) q.apply1(0, HG.G.X);
  if (aBasis) q.apply1(0, HG.G.H);
  var eBasis = -1, eBit = -1;
  if (eve) {
    eBasis = rng() < 0.5 ? 0 : 1;
    if (eBasis) q.apply1(0, HG.G.H);
    eBit = q.measure(0, rng);
    if (eBasis) q.apply1(0, HG.G.H);
  }
  var bBasis = rng() < 0.5 ? 0 : 1;
  if (bBasis) q.apply1(0, HG.G.H);
  var out = q.measure(0, rng);
  return { bit: bit, aB: aBasis, eB: eBasis, eBit: eBit, bB: bBasis, out: out, kept: bBasis === aBasis, ok: bBasis === aBasis ? out === bit : null };
}
function photonKeyBit(p) { return p.kept ? p.out : null; }

function runBatch(count, animate) {
  var rows = [];
  for (var i = 0; i < count; i++) rows.push(onePhoton());
  var kept = rows.filter(function (p) { return p.kept; });
  /* Alice and Bob publicly compare a random sample of the sifted bits */
  var sampleN = Math.max(8, Math.floor(kept.length * 0.25));
  var sampleIdx = [];
  var keptShuf = kept.slice();
  for (var s = 0; s < keptShuf.length; s++) {
    var j = Math.floor(rng() * (s + 1));
    var tmp = keptShuf[s]; keptShuf[s] = keptShuf[j]; keptShuf[j] = tmp;
  }
  for (var s2 = 0; s2 < sampleN && s2 < keptShuf.length; s2++) {
    sampleIdx.push(keptShuf[s2]);
    keptShuf[s2].sampled = true;
  }
  var errs = sampleIdx.filter(function (p) { return p.ok === false; }).length;
  key = kept.filter(function (p) { return !p.sampled; }).map(function (p) { return p.out; });
  stats = { sent: count, sifted: kept.length, sampleN: sampleIdx.length, sampleErr: errs };
  table = rows.slice(0, 24);
  cipherBytes = null; sealedText = '';
  updateReadout();
  if (animate && !K.REDUCED) animateTable();
  else drawAll();
}
function updateReadout() {
  roSent.set(String(stats.sent));
  roSift.set(String(stats.sifted) + '  (~half always match by chance)', 'cy');
  roSam.set(stats.sampleN + ' BITS COMPARED · ' + stats.sampleErr + ' DISAGREED', stats.sampleErr ? 'rd' : 'am');
  var qber = stats.sampleN ? stats.sampleErr / stats.sampleN : 0;
  roQber.set((qber * 100).toFixed(1) + '%  (abort line: 11%)', qber > 0.11 ? 'rd' : 'am');
  var good = stats.sampleN && qber <= 0.11;
  roVerdict.set(good ? 'KEY ESTABLISHED · THE LINE IS YOURS' : 'EVE DETECTED — BURN THE KEY, START OVER', good ? 'am' : 'rd');
  var preview = key.slice(0, 48).join('') || '—';
  roKey.set(preview + (key.length > 48 ? '…' : ''));
  roLetter.set(cipherBytes ? 'SEALED · ' + cipherBytes.length + ' BYTES' : 'UNSEALED');
}

function drawAll() { drawTable(-1); drawMeter(); }
function animateTable() {
  var i = 0;
  K.loop(function (t) {
    if (i > table.length) return false;
    drawTable(i);
    if (i === table.length) { drawMeter(); return false; }
    i++;
    return true;
  });
}

function colGeo(w) {
  var x0 = 76, x1 = w - 14;
  return { x0: x0, cw: (x1 - x0) / 24 };
}
function rowY(h, eveOn) {
  var ys = { aBit: 46, aB: 72, photon: 104, bB: 158, bOut: 184, sift: 216, check: 246 };
  if (eveOn) {
    ys.photon = 100;
    ys.eB = 124; ys.eOut = 146;
    ys.bB = 178; ys.bOut = 204; ys.sift = 236; ys.check = 266;
  }
  return ys;
}
function drawTable(upTo) {
  var w = entry.w, h = entry.h;
  ctx.clearRect(0, 0, w, h);
  var g = colGeo(w);
  var ys = rowY(h, eve);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = K.amber(0.9);
  ctx.fillText('ALICE · BIT', 12, ys.aBit + 3);
  ctx.fillText('ALICE · BASIS', 12, ys.aB + 3);
  ctx.fillText('PHOTON', 12, ys.photon + 3);
  if (eve) {
    ctx.fillStyle = K.red(0.9);
    ctx.fillText('EVE · BASIS', 12, ys.eB + 3);
    ctx.fillText('EVE · SAW', 12, ys.eOut + 3);
  }
  ctx.fillStyle = K.cyan(0.9);
  ctx.fillText('BOB · BASIS', 12, ys.bB + 3);
  ctx.fillText('BOB · READS', 12, ys.bOut + 3);
  ctx.fillStyle = K.faint(0.9);
  ctx.fillText('SIFT', 12, ys.sift + 3);
  ctx.fillText('CHECK', 12, ys.check + 3);

  table.forEach(function (p, i) {
    if (i > upTo && upTo >= 0) return;
    var x = g.x0 + g.cw * i + g.cw / 2;
    var shown = upTo < 0 || i <= upTo;
    if (!shown) return;
    ctx.fillStyle = K.txt(0.85);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(p.bit), x, ys.aBit + 3);
    basisGlyph(x, ys.aB, p.aB, p.bit, K.amber(0.8), 0.85);
    /* photon: polarization line with a glow dot */
    basisGlyph(x, ys.photon, p.aB, p.bit, K.hueCssDeg(p.aB * 45 + p.bit * 90, 0.95), 1);
    ctx.fillStyle = K.hueCssDeg(p.aB * 45 + p.bit * 90, 0.85);
    ctx.beginPath(); ctx.arc(x, ys.photon, 2, 0, 6.2832); ctx.fill();
    if (eve && p.eB >= 0) {
      basisGlyph(x, ys.eB, p.eB, p.eBit < 0 ? 0 : p.eBit, K.red(0.7), 0.8);
      ctx.fillStyle = K.red(0.9);
      ctx.font = '9px ui-monospace,Menlo,monospace';
      ctx.fillText(String(p.eBit), x, ys.eOut + 3);
    }
    basisGlyph(x, ys.bB, p.bB, p.out, K.cyan(0.8), 0.85);
    ctx.fillStyle = p.kept ? K.txt(0.9) : K.faint(0.5);
    ctx.font = '9px ui-monospace,Menlo,monospace';
    ctx.fillText(p.kept ? String(p.out) : '·', x, ys.bOut + 3);
    if (p.kept) {
      ctx.strokeStyle = K.amber(0.8);
      ctx.beginPath(); ctx.moveTo(x, ys.sift - 4); ctx.lineTo(x, ys.sift + 4); ctx.stroke();
    } else {
      ctx.strokeStyle = K.faint(0.3);
      ctx.beginPath(); ctx.moveTo(x - 3, ys.sift); ctx.lineTo(x + 3, ys.sift); ctx.stroke();
    }
    if (p.sampled) {
      if (p.ok === false) {
        ctx.strokeStyle = K.red(0.95);
        ctx.beginPath();
        ctx.moveTo(x - 4, ys.check - 4); ctx.lineTo(x + 4, ys.check + 4);
        ctx.moveTo(x + 4, ys.check - 4); ctx.lineTo(x - 4, ys.check + 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = K.cyan(0.7);
        ctx.beginPath(); ctx.arc(x, ys.check, 3.4, 0, 6.2832); ctx.stroke();
      }
    }
  });
}

function drawMeter() {
  var w = entry.w, h = entry.h;
  var y = h - 38, x0 = 76, x1 = w - 40;
  function sx(frac) { return x0 + (x1 - x0) * frac / 0.3; }
  ctx.fillStyle = 'rgba(93,107,128,0.12)';
  ctx.fillRect(sx(0), y, sx(0.11) - sx(0), 16);
  ctx.fillStyle = 'rgba(226,105,79,0.12)';
  ctx.fillRect(sx(0.11), y, x1 - sx(0.11), 16);
  ctx.strokeStyle = K.faint(0.5);
  ctx.strokeRect(x0 + 0.5, y + 0.5, x1 - x0, 16);
  [0, 0.11, 0.25, 0.3].forEach(function (t) {
    ctx.strokeStyle = K.faint(0.6);
    ctx.beginPath(); ctx.moveTo(sx(t), y + 16); ctx.lineTo(sx(t), y + 20); ctx.stroke();
    ctx.fillStyle = K.faint(0.9);
    ctx.font = '8px ui-monospace,Menlo,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t === 0.11 ? 'ABORT 11%' : (t * 100).toFixed(0) + '%', sx(t), y + 30);
  });
  var qber = stats.sampleN ? stats.sampleErr / stats.sampleN : 0;
  var nx = sx(Math.min(0.3, qber));
  ctx.strokeStyle = qber > 0.11 ? K.red(0.95) : K.amber(0.95);
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(nx, y); ctx.lineTo(nx, y + 16); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = K.faint(0.9);
  ctx.font = '8px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('SAMPLE DISAGREEMENT RATE', x0, y - 6);
}

/* ---------- the letter itself ---------- */
K.el('div', 'ctl-label', controls).textContent = 'THE LETTER (SEALED WITH THE FRESH KEY)';
var input = document.createElement('input');
input.type = 'text';
input.maxLength = 64;
input.value = 'meet me at the garden gate at dusk';
input.style.cssText = 'width:100%;font-family:var(--mono);font-size:.76rem;color:var(--txt);background:var(--bg2);border:1px solid var(--line2);border-radius:3px;padding:.55rem .7rem;margin-bottom:.7rem';
controls.appendChild(input);

function seal() {
  if (!key.length) { roLetter.set('NO KEY — RUN A BATCH FIRST', 'rd'); return; }
  var text = input.value;
  var need = text.length * 8;
  if (need > key.length) {
    roLetter.set('KEY TOO SHORT (' + key.length + ' BITS) — RUN 1024 PHOTONS', 'rd');
    return;
  }
  var bytes = [];
  for (var i = 0; i < text.length; i++) {
    var b = text.charCodeAt(i) & 0xFF, kb = 0;
    for (var j = 0; j < 8; j++) if (key[i * 8 + j]) kb |= (1 << (7 - j));
    bytes.push(b ^ kb);
  }
  cipherBytes = bytes;
  sealedText = text;
  var hex = bytes.map(function (b2) { return b2.toString(16).padStart(2, '0'); }).join(' ');
  var show = hex.length > 90 ? hex.slice(0, 90) + '…' : hex;
  roLetter.set('SEALED → ' + show, 'am');
}
function unseal() {
  if (!cipherBytes) { roLetter.set('NOTHING SEALED YET', 'rd'); return; }
  var out = '';
  for (var i = 0; i < cipherBytes.length; i++) {
    var kb = 0;
    for (var j = 0; j < 8; j++) if (key[i * 8 + j]) kb |= (1 << (7 - j));
    out += String.fromCharCode(cipherBytes[i] ^ kb);
  }
  var ok = out === sealedText;
  roLetter.set('OPENED → "' + out.slice(0, 40) + '"' + (ok ? ' · EXACT MATCH' : ' · MISMATCH'), ok ? 'am' : 'rd');
}

var row = K.buttons(controls);
row.add('RUN 24 PHOTONS · WATCH', function () { runBatch(24, true); }, { cls: 'big' });
row.add('RUN 1024 PHOTONS · WORK', function () { runBatch(1024, false); });
row.add('SEAL THE LETTER', function () { seal(); });
row.add('OPEN THE LETTER', function () { unseal(); });
K.toggle(controls, {
  label: 'EVE — INTERCEPT THE LINE (RESEND IN HER OWN BASIS)',
  on: false,
  onChange: function (v) { eve = v; }
});
row.add('RESET', function () {
  table = []; key = []; cipherBytes = null;
  stats = { sent: 0, sifted: 0, sampleN: 0, sampleErr: 0 };
  updateReadout();
  ctx.clearRect(0, 0, entry.w, entry.h);
}, { cls: 'danger' });

runBatch(24, false);
})();
