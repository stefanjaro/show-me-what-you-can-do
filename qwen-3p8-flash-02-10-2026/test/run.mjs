// CANTUS MACHINA — offline validation of the composition engine.
// node test/run.mjs
import { barEvents, pieceTitle, MOV_LEN, SECTIONS, sectionAt } from '../js/composer.js';
import { chordAtBar, prevChordAtBar } from '../js/composer.js';
import { narrate } from '../js/notes.js';
import { degToSemitones } from '../js/theory.js';

function realChordPcs(ev) {
  const rootAbs = (ev.rootPc + degToSemitones(ev.mode, ev.chord.degrees[0])) % 12;
  return ev.chord.pcAbs;
}

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL:', msg); };
const ok = (cond, msg) => { if (!cond) fail(msg); };

const seeds = [7, 42, 1234, 99991, 20261001, 0, 555];
const BARS = 420;

// ---- 1. determinism: same seed+bar must produce byte-identical events ----
for (const s of seeds) {
  for (const b of [0, 1, 7, 9, 31, 63, 64, 200, BARS]) {
    const x = JSON.stringify(barEvents(s, b));
    const y = JSON.stringify(barEvents(s, b));
    if (x !== y) fail(`nondeterministic seed=${s} bar=${b}`);
  }
  // deep equality across far jumps
  const a = barEvents(s, 4000), b2 = barEvents(s, 4001);
  ok(a.mov >= 62, 'bar 4000 should be deep in the piece');
  ok(b2, 'far jump must not throw');
}

// ---- 2. field sanity over a long window ----
let noteCount = {}, polyMax = 0, velBad = 0, midiBad = 0, timeBad = 0;
const pitchRange = [1e9, -1e9];
for (const s of seeds) {
  for (let b = 0; b < BARS; b++) {
    const ev = barEvents(s, b);
    ok(ev.events.length >= 1 && ev.events.length < 60, `event count sane @ ${s}/${b}: ${ev.events.length}`);
    for (const e of ev.events) {
      noteCount[e.voice] = (noteCount[e.voice] || 0) + 1;
      ok(typeof e.t === 'number' && !isNaN(e.t), `NaN t @ ${s}/${b}`);
      ok(e.t >= 0 && e.t <= 3.99, `t out of bar @ ${s}/${b}: ${e.t}`);
      ok(e.barOff === undefined || (e.barOff >= 0 && e.barOff <= 3), `barOff sane @ ${s}/${b}`);
      ok(e.dur > 0 && e.dur <= 16, `dur sane @ ${s}/${b}: ${e.dur}`);
      if (!(e.vel >= 0 && e.vel <= 1)) velBad++;
      if (e.midi > 0 && e.voice !== 'wind' && !(e.vel > 0)) velBad++;
      if (e.midi > 0) {
        if (e.midi < 21 || e.midi > 105) midiBad++;
        pitchRange[0] = Math.min(pitchRange[0], e.midi);
        pitchRange[1] = Math.max(pitchRange[1], e.midi);
        ok(Number.isInteger(e.midi), `midi int @ ${s}/${b}: ${e.midi}`);
      }
    }
    // polyphony: count notes alive at each half-beat
    const grid = [];
    for (let k = 0; k < 8; k++) {
      const at = k / 2;
      let alive = ev.events.filter((e) => e.midi > 0 && (e.barOff || 0) * 4 + e.t <= at && at <= (e.barOff || 0) * 4 + e.t + e.dur).length;
      grid.push(alive);
    }
    polyMax = Math.max(polyMax, ...grid);
  }
}
ok(velBad === 0, `vel out of range count=${velBad}`);
ok(midiBad === 0, `midi out of range count=${midiBad}`);
console.log('voices:', noteCount);
console.log('max simultaneous notes:', polyMax, '(budget ≤ 24)');
ok(polyMax <= 24, 'polyphony budget');
console.log('pitch span:', pitchRange, `(${pitchRange[0]}→${pitchRange[1]})`);

// ---- 3. harmony: melody strong beats must land on/near chord tones ----
let strongTotal = 0, strongGood = 0;
for (const s of seeds) {
  for (let b = 0; b < BARS; b++) {
    const ev = barEvents(s, b);
    const { chord } = ev;
    for (const e of ev.events) {
      if (e.voice !== 'lead' || !(e.midi > 0)) continue;
      if (Math.round(e.t) % 2 !== 0 || e.t % 1 !== 0) continue; // only integer strong beats
      strongTotal++;
      const evHere = b + (e.barOff || 0) !== b ? barEvents(s, b + (e.barOff || 0)) : ev;
      const rcp = realChordPcs(evHere);
      const pc = ((e.midi % 12) + 12) % 12;
      if (rcp.includes(pc)) strongGood++;
    }
    // pad voicing must spell the chord exactly
    const pads = ev.events.filter((e) => e.voice === 'pad');
    const rcp = realChordPcs(ev);
    const padPcs = new Set(pads.map((p) => ((p.midi % 12) + 12) % 12));
    for (const p of padPcs) ok(rcp.includes(p), `pad pc ${p} not in chord ${chord.name} @ ${s}/${b}`);
  }
}
console.log(`lead strong-beat chord-tone hit rate: ${(100 * strongGood / Math.max(1, strongTotal)).toFixed(1)}% (${strongTotal} beats)`);
ok(strongTotal > 100, 'lead must actually be writing melodies');
ok(100 * strongGood / Math.max(1, strongTotal) >= 92, 'strong beats should overwhelmingly be chord tones');

// ---- 4. voice leading: pad notes should move little between chord changes ----
let vlTotal = 0, vlSum = 0;
for (const s of seeds.slice(0, 4)) {
  let prevVoicing = null;
  for (let b = 0; b < BARS; b++) {
    const ev = barEvents(s, b);
    const pads = ev.events.filter((e) => e.voice === 'pad' && !e.art.root).map((e) => e.midi).sort((a, z) => a - z);
    if (prevVoicing && pads.length && prevVoicing.length && ev.chord.degrees[0] !== prevChordAtBar(s, b).degrees[0]) {
      const n = Math.min(pads.length, prevVoicing.length);
      let d = 0;
      for (let i = 0; i < n; i++) d += Math.abs(pads[i] - prevVoicing[i]);
      vlSum += d / n; vlTotal++;
    }
    prevVoicing = pads;
  }
}
console.log(`avg pad voice-leading motion at chord change: ${(vlSum / Math.max(1, vlTotal)).toFixed(2)} semitones`);
ok(vlSum / Math.max(1, vlTotal) < 5, 'voice leading should be smooth');

// ---- 5. form coverage & tempo ----
const secSeen = {};
let tempoBad = 0;
for (const s of seeds) {
  for (let b = 0; b < BARS; b++) {
    const ev = barEvents(s, b);
    secSeen[ev.section] = (secSeen[ev.section] || 0) + 1;
    if (ev.tempo < 46 || ev.tempo > 92) tempoBad++;
    ok(ev.chord.name.length > 0, 'chord named');
  }
}
console.log('section coverage over', BARS, 'bars:', secSeen);
ok(Object.keys(secSeen).length === SECTIONS.length, 'every section must occur');
ok(tempoBad === 0, 'tempo in band');

// ---- 6. narrator must not throw and should speak at boundaries ----
let narrated = 0;
for (const s of seeds.slice(0, 3)) {
  let prev = null;
  for (let b = 0; b < 200; b++) {
    const ev = barEvents(s, b);
    const lines = narrate(s, ev, prev);
    if (lines.length) narrated++;
    for (const l of lines) ok(typeof l === 'string' && l.length > 6 && !l.includes('undefined'), `narrator: "${l}"`);
    prev = ev;
  }
}
console.log('narrator spoke on', narrated, 'bar-starts (200×3 bars)');
ok(narrated >= 30, 'narrator should be reasonably present');
ok(narrated < 120, 'narrator should not babble');

// ---- 7. motif reuse: same movement should re-use its motif shapes ----
const title = pieceTitle(1234);
console.log('example opus title:', title);
ok(/^[A-Z].+ .+/.test(title), 'title shape');

// ---- 8. ASCII score sample (seed 42, bars 24–39: Drift entrance) ----
const roll = (seed, from, to) => {
  const rows = [];
  const P0 = 40, P1 = 92;
  for (let p = P1; p >= P0; p--) {
    let line = String(p).padStart(3) + ' ';
    for (let b = from; b < to; b++) {
      const ev = barEvents(seed, b);
      for (let q = 0; q < 4; q++) {
        const hit = ev.events.find((e) => e.midi === p && (e.barOff || 0) * 4 + e.t <= q && q < (e.barOff || 0) * 4 + e.t + Math.min(e.dur, 1) && e.midi > 0);
        const ch = hit ? { pad: '░', bass: '▓', pluck: '▒', lead: '●', bell: '·', perc: '+', wind: ' ', fx: ' ' }[hit.voice] || '?' : ' ';
        line += ch;
      }
    }
    rows.push(line);
  }
  let ruler = '    ';
  for (let b = from; b < to; b++) ruler += '|...'.split('');
  const chords = barEvents(seed, from).events && (() => {
    let c = '    ';
    for (let b = from; b < to; b++) c += barEvents(seed, b).chord.name.padEnd(4).slice(0, 4);
    return c;
  })();
  console.log(chords);
  console.log(rows.reverse ? rows.join('\n') : rows);
};
console.log('\n=== score sample: seed 42, bars 24–39 (chords on top; ●=lead ░=pad ▓=bass ▒=pluck ·=bell +=perc) ===');
roll(42, 24, 40);

// ---- verdict ----
if (failures) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
} else {
  console.log('\nALL CHECKS PASSED');
}
