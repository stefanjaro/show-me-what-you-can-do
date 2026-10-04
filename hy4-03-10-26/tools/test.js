#!/usr/bin/env node
/* ALETHEIA — node side of the test suite (the browser runs the very same
   assertions from src/core/util.js's registry). */
'use strict';
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'src');
const ORDER = [
  'core/util.js', 'core/rat.js', 'core/expr.js', 'core/parser.js', 'core/print.js',
  'core/poly.js', 'core/factor.js', 'core/simplify.js', 'core/derive.js', 'core/integrate.js',
  'core/integrate.js', 'core/solve.js', 'core/series.js',
  'numeric/complex.js', 'numeric/interval.js', 'numeric/ode.js', 'numeric/zeta.js',
  'logic/kernel.js', 'logic/search.js', 'logic/library.js', 'logic/sat.js', 'logic/finite.js',
  'render/typeset.js', 'render/plot.js', 'render/fractal.js',
  'exhibits/hyperbolic.js', 'exhibits/penrose.js', 'exhibits/attractor.js',
  'exhibits/fourier.js', 'exhibits/arithmetic.js', 'exhibits/ising.js'
];

const only = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
const listFiles = process.argv.includes('--files');

if (listFiles) {
  console.log(ORDER.filter(f => fs.existsSync(path.join(SRC, f))).join('\n'));
  process.exit(0);
}

const missing = [];
for (const f of ORDER) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) { missing.push(f); continue; }
  try { require(p); } catch (e) {
    console.error('\x1b[31mload error\x1b[0m in ' + f + '\n  ' + (e && e.stack || e));
    process.exit(2);
  }
}
if (missing.length) console.log('note: not present (yet): ' + missing.join(', '));

const AE = globalThis.AE;
const res = AE.util.runTests(only ? new RegExp(only) : null);
const byGroup = {};
let worst = 0;
for (const r of res.results) {
  (byGroup[r.group] = byGroup[r.group] || { pass: 0, fail: 0, ms: 0 });
  byGroup[r.group][r.ok ? 'pass' : 'fail']++;
  byGroup[r.group].ms += r.ms;
  worst = Math.max(worst, r.ms);
  if (!r.ok) console.log('  \x1b[31m✗\x1b[0m ' + r.group + '.' + r.name + '  \x1b[31m' + r.error + '\x1b[0m');
}
console.log('');
for (const g of Object.keys(byGroup)) {
  const b = byGroup[g];
  console.log('  ' + (b.fail ? '\x1b[31m' : '\x1b[32m') + '●\x1b[0m ' + g.padEnd(14) +
    String(b.pass).padStart(4) + ' passed' + (b.fail ? ', \x1b[31m' + b.fail + ' FAILED\x1b[0m' : '') +
    '   ' + b.ms.toFixed(1) + ' ms');
}
console.log('');
console.log((res.fail ? '\x1b[31m' : '\x1b[32m') + res.pass + '/' + res.total +
  ' assertions passed\x1b[0m in ' + res.ms.toFixed(0) + ' ms');
process.exit(res.fail ? 1 : 0);
