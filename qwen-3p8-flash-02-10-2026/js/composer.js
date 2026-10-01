// CANTUS MACHINA — the composer.
// barEvents(seed, n) is a pure function: the nth bar of the piece exists as surely
// as the nth row of a spreadsheet. Form, harmony, melody, arrangement — all derived
// from (seed, bar) with no sequential state, so you can jump to bar 40,000 and hear
// the piece already there.

import { stream, rint, rrange, pick, pickW, chance, jitter } from './rng.js';
import {
  SCALES, MODE_KEYS, degToSemitones, buildChord, voiceChord, harmonize,
  motifInvert, motifRetrograde, motifAugment, motifFragment, motifShiftDeg, clamp,
} from './theory.js';

export const MOV_LEN = 64; // bars per movement

export const SECTIONS = [
  { start: 0,  len: 8,  name: 'Threshold', dark: 0.16, hue: 'text' },
  { start: 8,  len: 16, name: 'Ground',    dark: 0.44, hue: 'green' },
  { start: 24, len: 8,  name: 'Clearing',  dark: 0.24, hue: 'gold' },
  { start: 32, len: 16, name: 'Drift',     dark: 0.60, hue: 'cyan' },
  { start: 48, len: 8,  name: 'Signal',    dark: 0.82, hue: 'red' },
  { start: 56, len: 8,  name: 'Horizon',   dark: 0.30, hue: 'text' },
];

export function sectionAt(pb) {
  for (const s of SECTIONS) if (pb >= s.start && pb < s.start + s.len) return s;
  return SECTIONS[SECTIONS.length - 1];
}

// diatonic progression pools per mode, in scale degrees; tastefully chosen,
// diminished chords excluded, suspensions/substitutions marked inline
const PROG_POOLS = {
  ionian: [
    [{ d: 0 }, { d: 5 }, { d: 3 }, { d: 4 }],
    [{ d: 0 }, { d: 3 }, { d: 5 }, { d: 1 }],
    [{ d: 0 }, { d: 4 }, { d: 5 }, { d: 3, minorize: true }],   // the borrowed iv
    [{ d: 0 }, { d: 2 }, { d: 3 }, { d: 4 }],
  ],
  lydian: [
    [{ d: 0 }, { d: 1 }, { d: 4 }, { d: 0 }],
    [{ d: 0 }, { d: 4 }, { d: 1 }, { d: 3 }],
    [{ d: 0, sus: 2 }, { d: 1 }, { d: 3 }, { d: 4 }],
  ],
  mixolydian: [
    [{ d: 0 }, { d: 6 }, { d: 3 }, { d: 0 }],
    [{ d: 0 }, { d: 3 }, { d: 6 }, { d: 2 }],
    [{ d: 0, sus: 4 }, { d: 2 }, { d: 6 }, { d: 3 }],
  ],
  dorian: [
    [{ d: 0 }, { d: 3 }, { d: 6 }, { d: 2 }],
    [{ d: 0 }, { d: 2 }, { d: 3 }, { d: 4 }],
    [{ d: 0 }, { d: 3 }, { d: 0, sus: 2 }, { d: 6 }],
    [{ d: 0 }, { d: 6 }, { d: 2 }, { d: 3 }],
  ],
  aeolian: [
    [{ d: 0 }, { d: 5 }, { d: 2 }, { d: 6 }],
    [{ d: 0 }, { d: 6 }, { d: 5 }, { d: 6 }],
    [{ d: 0 }, { d: 3 }, { d: 5 }, { d: 4 }],
    [{ d: 0 }, { d: 2 }, { d: 6 }, { d: 5 }],
  ],
  phrygian: [
    [{ d: 0 }, { d: 1 }, { d: 5 }, { d: 3 }],
    [{ d: 0 }, { d: 3 }, { d: 1 }, { d: 0 }],
  ],
};

const BREAK_POOLS = {
  major: [[{ d: 0 }, { d: 3 }], [{ d: 0 }, { d: 5 }], [{ d: 3 }, { d: 0 }]],
  minor: [[{ d: 0 }, { d: 5 }], [{ d: 0 }, { d: 2 }], [{ d: 2 }, { d: 0 }]],
};

const RELATIVE = { dorian: 10, aeolian: 3, phrygian: 8, ionian: 9, lydian: 7, mixolydian: 5 };
const RELATIVE_MODE = {
  dorian: 'ionian', aeolian: 'ionian', phrygian: 'ionian',
  ionian: 'aeolian', lydian: 'ionian', mixolydian: 'ionian',
};

// ---------------- movement-level parameters ----------------

export function movementParams(seed, m) {
  const rootPc = rootChain(seed, m);
  const mode = modeChain(seed, m);
  const dark = SCALES[mode].dark;
  const r = stream(seed, 'mov', m);

  const tempo = Math.round(clamp(rrange(r, 50, 92) - dark * 12, 48, 88));
  const progMain = pick(r, PROG_POOLS[mode]);
  const progBreak = pick(r, dark > 0.35 ? BREAK_POOLS.minor : BREAK_POOLS.major);
  const tonicRef = 48 + rootPc;                 // tonic around C3–B3; all bands derive from it
  const seventhP = rrange(r, 0.35, 0.8);
  const arpGrid = pickW(r, ['eighth', 'sixteenth', 'three-three-two'], [0.45, 0.25 + dark * 0.2, 0.2]);
  const percStyle = pickW(r, ['soft', 'broken', 'four'], [0.4, 0.35, 0.25]);
  const bellP = rrange(r, 0.1, 0.4);
  const brightness = rrange(r, 0.35, 0.85) + (1 - dark) * 0.1;
  const padSpread = rrange(r, 6, 14);
  const hasCounter = chance(r, 0.35);
  const motif = makeMotif(seed, m);
  const dipBars = new Set();
  const nDips = rint(r, 1, 3);
  for (let i = 0; i < nDips; i++) dipBars.add(8 + rint(r, 0, 55));

  return {
    m, rootPc, mode, tempo, progMain, progBreak, tonicRef, seventhP, arpGrid,
    percStyle, bellP, brightness, padSpread, hasCounter, motif, dipBars,
    dark, hue: SCALES[mode].hue,
  };
}

const rootCache = new Map();
function rootChain(seed, m) {
  if (m === 0) return rint(stream(seed, 'root', 0), 0, 11);
  const key = seed + ':' + m;
  if (rootCache.has(key)) return rootCache.get(key);
  let rootPc;
  const r = stream(seed, 'key', m);
  if (chance(r, 0.42)) rootPc = rootChain(seed, m - 1);              // stay
  else rootPc = (rootChain(seed, m - 1) + pickW(r, [7, 5, 3, 8, 10, 1], [0.28, 0.2, 0.17, 0.12, 0.13, 0.1])) % 12;
  rootCache.set(key, rootPc);
  return rootPc;
}
const modeCache = new Map();
function modeChain(seed, m) {
  if (m === 0) return pickWMode(seed);
  const key = 'm' + seed + ':' + m;
  if (modeCache.has(key)) return modeCache.get(key);
  let mode;
  const r = stream(seed, 'mode', m);
  const prev = modeChain(seed, m - 1);
  if (chance(r, 0.5)) mode = prev;
  else if (chance(r, 0.45)) mode = RELATIVE_MODE[prev];            // pivot: same notes, new center
  else mode = pickW(r, MODE_KEYS, [0.16, 0.12, 0.12, 0.26, 0.22, 0.1]);
  modeCache.set(key, mode);
  return mode;
}
function pickWMode(seed) {
  return pickW(stream(seed, 'mode', 0), MODE_KEYS, [0.15, 0.13, 0.12, 0.27, 0.22, 0.08]);
}

// ---------------- motifs ----------------
// A motif is a rhythm + a contour in diatonic steps. Because melody lives in
// diatonic space, inversion / retrograde / sequencing can never leave the key.

const RHYTHM_VOCAB = [
  [0, 2, 3, 3.5],
  [0, 1.5, 2, 3],
  [0, 0.75, 2, 3],
  [0, 1, 2.5],
  [0, 2.5, 3.25],
  [0, 1.5, 2.75, 3.5],
  [0.5, 2, 3],
  [0, 0.5, 1.5, 2.5, 3.5],
];

function makeMotif(seed, m) {
  const r = stream(seed, 'motif', m);
  const cell = () => {
    const pos = pick(r, RHYTHM_VOCAB);
    const start = pickW(r, [0, 4, 7, 2], [0.3, 0.3, 0.15, 0.25]);
    let deg = start;
    const notes = pos.map((p, i) => {
      const dur = (i + 1 < pos.length ? pos[i + 1] : 4) - p;
      const n = { t: p, dur, deg, vel: rrange(r, 0.55, 0.95) };
      deg += pickW(r, [-2, -1, 1, 2, 0], [0.12, 0.22, 0.24, 0.14, 0.18]);
      deg = clamp(deg, start - 4, start + 6);
      return n;
    });
    return notes;
  };
  const A = cell();
  const B = cell();
  // close the cell on stable ground
  A[A.length - 1].deg = pickW(r, [0, 2, 4], [0.4, 0.3, 0.3]);
  return { A, B };
}

// ---------------- harmony ----------------

export function chordAtBar(seed, bar) {
  const m = Math.floor(bar / MOV_LEN);
  const pb = bar % MOV_LEN;
  const mp = movementParams(seed, m);
  const sec = sectionAt(pb);
  let deg = 0, opts = {}, chordBeats = 1;

  if (sec.name === 'Threshold') {
    deg = 0;
    opts = pb >= 4 ? { add9: true } : {};
  } else if (sec.name === 'Clearing') {
    const i = Math.floor((pb - sec.start) / 4) % mp.progBreak.length;
    const spec = mp.progBreak[i];
    deg = spec.d;
    opts = { seventh: false };
    chordBeats = 4;
  } else if (sec.name === 'Horizon') {
    const local = pb - sec.start;
    if (local < 4) {
      const pre = pickW(stream(seed, 'cad', m), [3, 5, 1, 4], [0.35, 0.3, 0.2, 0.15]);
      deg = pre; opts = { seventh: true };
    } else {
      deg = 0; opts = { add9: true };
    }
    chordBeats = 2;
  } else {
    const off = bar - (m * MOV_LEN + 8); // progressions run from Ground through Signal
    const len = mp.progMain.length;
    const pos = Math.floor(off / chordBarsOf(mp)) % len;
    const spec = mp.progMain[pos];
    deg = spec.d;
    opts = {};
    if (spec.minorize) opts.minorize = true;
    if (spec.sus) opts.sus = spec.sus;
    const canSeventh = (sec.name === 'Ground' || sec.name === 'Drift' || sec.name === 'Signal');
    opts.seventh = chance(stream(seed, 'sev', bar), mp.seventhP) && canSeventh && !(opts.sus);
    if (chance(stream(seed, 'add9', bar), 0.3) && !opts.sus) opts.add9 = true;
  }

  const chord = buildChord(mp.mode, deg, mp.rootPc, opts);
  chord.chordBeats = chordBeats;
  return { mp, sec, pb, chord };
}

function chordBarsOf(mp) {
  return mp.progMain.length === 4 ? 1 : 1;
}

export function prevChordAtBar(seed, bar) {
  if (bar <= 0) return chordAtBar(seed, 0).chord;
  return chordAtBar(seed, bar - 1).chord;
}

function canonicalVoicing(chord, center) {
  return voiceChord(chord.pcAbs || chord.pcs, null, center);
}

// ---------------- energy ----------------

function energyAt(seed, mp, pb, bar) {
  const sec = sectionAt(pb);
  const local = pb - sec.start;
  const next = SECTIONS.find((s) => s.start === sec.start + sec.len);
  const from = sec.dark;
  const to = next ? next.dark : 0.14;
  let e = from + (to - from) * (local / sec.len);
  // phrase undulation
  e += Math.sin(((bar % 4) / 4) * Math.PI * 2 + mp.m) * 0.03;
  e += jitter(stream(seed, 'ewob', bar), 0.02);
  if (mp.dipBars.has(pb)) e *= 0.5;
  return clamp(e, 0.02, 1);
}

// ---------------- helpers ----------------

const wrapBand = (midi, center, half = 6) => {
  let m = midi;
  while (m < center - half) m += 12;
  while (m > center + half) m -= 12;
  return m;
};
const midiForDeg = (mode, ref, deg, center, half) =>
  wrapBand(ref + degToSemitones(mode, deg) - degToSemitones(mode, 0), center, half);

// ---------------- per-voice writers ----------------

function writePad(out, seed, mp, bar, e, chord, prevChord) {
  const prevVoicing = canonicalVoicing(prevChord, mp.tonicRef);
  const voicing = voiceChord(chord.pcAbs, prevVoicing, mp.tonicRef + 2);
  const r = stream(seed, 'pad', bar);
  const atk = rrange(r, 0.9, 2.4) * (1.3 - e);
  for (let i = 0; i < voicing.length; i++) {
    out.push({
      t: i === 0 ? 0 : i * 0.015, dur: 4.4, voice: 'pad',
      midi: voicing[i], vel: clamp(0.26 + e * 0.22 - i * 0.02, 0.1, 0.6),
      art: {
        atk, bright: clamp(0.3 + mp.brightness * 0.5 + e * 0.4, 0.15, 1),
        pan: (i / (voicing.length - 1 || 1)) * 2 - 1, width: mp.padSpread,
      },
    });
  }
  // first bar of the movement gets a low root doubling for weight
  if (bar % MOV_LEN === 0) {
    out.push({
      t: 0, dur: 4.5, voice: 'pad', midi: midiForDeg(mp.mode, mp.tonicRef, chord.degrees[0], mp.tonicRef - 12, 6),
      vel: 0.3, art: { atk: 2.2, bright: 0.2, pan: 0, width: 2, root: true },
    });
  }
}

function writeBass(out, seed, mp, bar, e, chord, prevChord, sec) {
  const pb = bar % MOV_LEN;
  if (sec.name === 'Threshold' && pb < 4) return;
  if (sec.name === 'Clearing' && !chance(stream(seed, 'bassgo', bar), 0.5)) return;
  if (sec.name === 'Horizon' && pb % MOV_LEN >= 60) return;
  const r = stream(seed, 'bass', bar);
  const degRoot = chord.degrees[0];
  const fifth = degRoot + 4;
  const styles = [
    [{ t: 0, d: 1.6, k: 'root' }, { t: 2.5, d: 0.8, k: 'fifth' }],
    [{ t: 0, d: 3.6, k: 'root' }],
    [{ t: 0, d: 0.8, k: 'root' }, { t: 1.5, d: 0.6, k: 'root' }, { t: 2, d: 0.8, k: 'fifth' }],
    [{ t: 0, d: 1.1, k: 'root' }, { t: 2.2, d: 0.6, k: 'oct' }, { t: 3, d: 0.9, k: 'root' }],
  ];
  const pat = pickW(r, styles, [0.3, 0.3 - e * 0.15, 0.2 + e * 0.1, 0.2]);
  for (const n of pat) {
    let deg = degRoot;
    if (n.k === 'fifth') deg = fifth;
    if (n.k === 'oct') deg = degRoot + 7;
    // approaching tone: last bass note of the bar before a chord change walks toward it
    if (n.t >= 2 && prevNext(seed, bar, chord)) {
      const nc = prevChordAtBar(seed, bar + 1).degrees[0];
      if (Math.abs(nc - deg) > 1) deg = deg + (nc > deg ? 1 : -1);
    }
    const midi = midiForDeg(mp.mode, mp.tonicRef, deg, mp.tonicRef - 12, 5);
    out.push({
      t: n.t, dur: n.d, voice: 'bass', midi,
      vel: clamp(0.4 + e * 0.3 + (n.t === 0 ? 0.12 : -0.05), 0.12, 0.85),
      art: { slide: chance(r, 0.16 + e * 0.1), sub: 0.8 - e * 0.25 },
    });
  }
}
function prevNext(seed, bar, chord) {
  return prevChordAtBar(seed, bar + 1).degrees[0] !== chord.degrees[0];
}

const ARP_GRIDS = {
  eighth: [0, 2, 4, 6, 8, 10, 12, 14],
  sixteenth: [0, 3, 6, 8, 11, 14],
  'three-three-two': [0, 3, 6, 10, 13], // 3+3+2 sixteenth pulse
};

function writeArp(out, seed, mp, bar, e, chord) {
  if (e < 0.3) return;
  const sec = sectionAt(bar % MOV_LEN);
  if (sec.name === 'Threshold' || sec.name === 'Clearing') return;
  const r = stream(seed, 'arp', Math.floor(bar / 2));
  const grid = ARP_GRIDS[mp.arpGrid] || ARP_GRIDS.eighth;
  const sixteenth = grid === ARP_GRIDS.sixteenth;
  const members = [0, 2, 4, chord.sev ? 6 : 8]; // diatonic offsets above the chord root
  const shape = pickW(r, [[0, 1, 2, 1], [0, 2, 3, 2, 1], [0, 1, 2, 3], [2, 1, 0, 1, 2], [0, 3, 1, 2]], [0.24, 0.2, 0.2, 0.18, 0.18]);
  let idx = 0;
  for (const pos of grid) {
    const beats = pos / 4;
    if (beats >= 4) break;
    if (chance(r, 0.14)) { idx++; continue; } // deterministic rests breathe
    const deg = chord.degrees[0] + members[shape[idx % shape.length] % members.length];
    const oct = sixteenth && idx % 4 === 3 ? 7 : 0;
    const midi = midiForDeg(mp.mode, mp.tonicRef, deg + oct, mp.tonicRef + 8, 7);
    const acc = pos % 4 === 0 ? 0.12 : pos % 2 === 0 ? 0.04 : -0.06;
    out.push({
      t: beats, dur: sixteenth ? 0.24 : 0.5, voice: 'pluck', midi,
      vel: clamp(0.22 + e * 0.3 + acc + jitter(r, 0.06), 0.05, 0.75),
      art: { pan: ((idx % 4) - 1.5) * 0.34, dec: rrange(r, 0.5, 1.4) },
    });
    idx++;
  }
}

function writeLead(out, seed, mp, bar, e, chord, sec, pb, flags) {
  // 4-bar windows, aligned to section start
  const win = Math.floor((pb - sec.start) / 4);
  const winStart = sec.start + win * 4;
  if (pb !== winStart) return; // lead is written once per window, at its first bar
  const r = stream(seed, 'lead', bar);
  if (sec.name === 'Threshold' && pb < 4) return;
  if (chance(r, sec.name === 'Clearing' ? 0.45 : 0.2)) { if (flags) flags.leadRest = true; return; } // silence is part of the piece

  const { A, B } = mp.motif;
  let notes, op = 'statement', octave = 12;
  if (sec.name === 'Threshold') { notes = A.slice(); op = 'first statement'; octave = 19; }
  else if (sec.name === 'Ground') {
    const which = win % 4;
    if (which === 0) notes = A.slice();
    else if (which === 1) notes = A.map((n) => ({ ...n })); // reprise
    else if (which === 2) notes = B.slice();
    else notes = motifShiftDeg(A, 2);
  } else if (sec.name === 'Clearing') {
    notes = motifAugment(motifFragment(A, 0.5), 1.5); op = 'fragment, slowed'; octave = 19;
  } else if (sec.name === 'Drift') {
    notes = win % 2 ? motifRetrograde(B) : motifShiftDeg(B, 4);
    op = win % 2 ? 'retrograde' : 'sequence';
  } else if (sec.name === 'Signal') {
    if (mp.hasCounter) { notes = motifInvert(A, A[0].deg + 3); op = 'inversion'; octave = 14; }
    else { notes = motifShiftDeg(A, 4); op = 'high sequence'; octave = 19; }
  } else { // Horizon
    notes = motifAugment(A, 2); op = 'augmentation, home';
  }

  // repeat the treated cell across the window like a real phrase, harmonizing bar by bar
  const tOff = win === 3 && sec.name === 'Ground' ? 2 : pickW(r, [0, 0, 0.5, 1], [0.55, 0.2, 0.15, 0.1]);
  const cellDur = sec.name === 'Horizon' ? 8 : op.includes('slowed') ? 6 : 4;
  const maxCopies = Math.max(1, Math.floor((15.5 - tOff) / cellDur));
  const copies = sec.name === 'Clearing' ? 1
    : Math.min(maxCopies, pickW(r, [1, 2, 3], [0.25, 0.45, 0.3]));
  const voiced = [];
  for (let c = 0; c < copies; c++) {
    for (const n of notes) {
      const tt = tOff + c * cellDur + n.t;
      if (tt >= 15.5) break;
      voiced.push({ ...n, _t: tt });
    }
  }
  if (flags && voiced.length) flags.leadOp = op;
  let prevMidi = null;
  for (const n of voiced) {
    const barOff = Math.floor(n._t / 4);
    const inBar = n._t % 4;
    const { chord: cHere } = chordAtBar(seed, bar + barOff);
    const strong = inBar % 2 === 0;
    const [h] = harmonize([{ ...n, strong }], cHere);
    const midi = midiForDeg(mp.mode, mp.tonicRef, h.deg, mp.tonicRef + octave, 7);
    const nextOnset = voiced.find((x) => x._t > n._t);
    const gap = nextOnset ? nextOnset._t - n._t : 4;
    const dur = clamp(Math.min(n.dur, gap * 0.92), 0.16, 6);
    out.push({
      t: inBar, barOff, dur, voice: 'lead', midi, vel: clamp(n.vel * (0.5 + e * 0.55), 0.15, 0.9),
      art: {
        vib: 0.4 + e * 0.5, glide: prevMidi != null && Math.abs(prevMidi - midi) <= 2 && gap < 1.2,
        bright: clamp(0.35 + e * 0.5 + jitter(r, 0.08), 0.1, 1),
        pan: clamp((midi - (mp.tonicRef + octave)) / 14, -0.5, 0.5),
      },
    });
    prevMidi = midi;
  }
}

function writeBells(out, seed, mp, bar, e, chord) {
  const r = stream(seed, 'bell', bar);
  let n = 0;
  const p = mp.bellP * (sectionAt(bar % MOV_LEN).name === 'Clearing' ? 2.4 : 0.9) * (0.4 + e);
  if (chance(r, p)) n = 1;
  if (chance(r, p * 0.3)) n = 2;
  for (let i = 0; i < n; i++) {
    const deg = pick(r, chord.degrees.concat([chord.degrees[0] + 7]));
    const midi = midiForDeg(mp.mode, mp.tonicRef, deg, mp.tonicRef + 31, 9);
    out.push({
      t: rrange(r, 0, 3.75), dur: rrange(r, 0.5, 1.2), voice: 'bell', midi,
      vel: rrange(r, 0.08, 0.2) * (1 + e * 0.4),
      art: { pan: rrange(r, -0.8, 0.8), dec: rrange(r, 1.5, 3.5), ratio: pickW(r, [2.76, 3.48, 4.2, 5.4], [0.4, 0.25, 0.2, 0.15]) },
    });
  }
}

const PERC_PATTERNS = {
  soft:   { kick: [0], hat: [0, 1, 2, 3], rim: [2.5] },
  broken: { kick: [0, 2.66], hat: [0.5, 1.5, 2, 2.5, 3.5], rim: [1.33] },
  four:   { kick: [0, 2.5], hat: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], rim: [1.5, 3] },
};

function writePerc(out, seed, mp, bar, e, sec) {
  if (mp.percStyle === 'none') return;
  const inMain = sec.name === 'Drift' || sec.name === 'Signal' || (sec.name === 'Ground' && bar % MOV_LEN >= 16);
  if (!inMain) return;
  if (e < 0.42) return;
  const r = stream(seed, 'perc', bar);
  const pat = PERC_PATTERNS[mp.percStyle];
  const kickP = clamp(0.4 + e, 0, 1);
  for (const k of pat.kick) if (chance(r, kickP)) out.push({ t: k, dur: 0.5, voice: 'perc', midi: 0, vel: clamp(0.55 + e * 0.3 + jitter(r, 0.08), 0.2, 1), art: { kind: 'kick' } });
  const hatOn = clamp(e * 1.6, 0.25, 1);
  for (const h of pat.hat) if (chance(r, hatOn * 0.8)) out.push({ t: h + (h > 0 ? jitter(r, 0.02) : 0), dur: 0.2, voice: 'perc', midi: 0, vel: clamp(0.22 + jitter(r, 0.1) + (h % 1 === 0.5 ? -0.06 : 0.05), 0.05, 0.6), art: { kind: 'hat' } });
  for (const m of pat.rim) if (chance(r, 0.72)) out.push({ t: m + jitter(r, 0.03), dur: 0.2, voice: 'perc', midi: 0, vel: clamp(0.4 + jitter(r, 0.1), 0.15, 0.8), art: { kind: 'rim' } });
  // small fill at the end of 4-bar groups before a new phrase
  if ((bar + 1) % 4 === 0 && chance(r, 0.55 + e * 0.3)) {
    const steps = rint(r, 3, 5);
    for (let i = 0; i < steps; i++) {
      out.push({ t: 4 - steps * 0.14 + i * 0.14, dur: 0.14, voice: 'perc', midi: 0, vel: clamp(0.18 + i * 0.08 + jitter(r, 0.05), 0.06, 0.7), art: { kind: 'rim', fill: true } });
    }
  }
}

function writeWindAndFx(out, seed, mp, bar, e, sec) {
  const pb = bar % MOV_LEN;
  out.push({ t: 0, dur: 4, voice: 'wind', midi: 0, vel: clamp(0.05 + e * 0.16, 0.02, 0.22), art: { level: e, bright: mp.brightness } });
  if (mp.hasCounter && sec.name === 'Signal' && (pb - sec.start) % 2 === 0) {
    const r = stream(seed, 'counter', bar);
    const deg = pick(r, [0, 2, 4]);
    out.push({
      t: rrange(r, 0, 1), dur: rrange(r, 2, 3.6), voice: 'bell',
      midi: midiForDeg(mp.mode, mp.tonicRef, deg + 7, mp.tonicRef + 26, 8),
      vel: 0.1, art: { pan: rrange(r, -0.6, 0.6), dec: 3, ratio: 3.48, counter: true },
    });
  }
  // riser into each new section, two bars ahead
  const secNext = SECTIONS.find((s) => s.start === pb + 2);
  if (secNext) out.push({ t: 0, dur: 8, voice: 'fx', midi: 0, vel: 0.5, art: { kind: 'riser' } });
  if (pb === MOV_LEN - 1) out.push({ t: 2, dur: 2.6, voice: 'fx', midi: 0, vel: 0.42, art: { kind: 'subdrop' } });
  if (pb === 0) out.push({ t: 0, dur: 0.01, voice: 'fx', midi: 0, vel: 0, art: { kind: 'mark' } });
}

// ---------------- the API ----------------

export function barEvents(seed, bar) {
  const { mp, sec, pb, chord } = chordAtBar(seed, bar);
  const prevChord = prevChordAtBar(seed, bar);
  const e = energyAt(seed, mp, pb, bar);
  const ev = [];
  const flags = { leadOp: null, leadRest: false, drums: false };
  writePad(ev, seed, mp, bar, e, chord, prevChord);
  writeBass(ev, seed, mp, bar, e, chord, prevChord, sec);
  writeArp(ev, seed, mp, bar, e, chord);
  writeLead(ev, seed, mp, bar, e, chord, sec, pb, flags);
  writeBells(ev, seed, mp, bar, e, chord);
  writePerc(ev, seed, mp, bar, e, sec);
  writeWindAndFx(ev, seed, mp, bar, e, sec);
  flags.drums = ev.some((x) => x.voice === 'perc' && x.art.kind === 'kick');
  return {
    bar, mov: mp.m, section: sec.name, energy: e, chord,
    tempo: mp.tempo, mode: mp.mode, rootPc: mp.rootPc,
    tonicRef: mp.tonicRef, flags,
    events: ev,
  };
}

// deterministic share-title for the opus, e.g. "Nocturne for the Amber Hours"
const TITLE_A = ['Nocturne', 'Salmo', 'Field Recording', 'Vespers', 'Study', 'Interlude', 'Aubade', 'Prelude', 'Canon', 'Meditation', 'Invention', 'Rhapsody'];
const TITLE_B = ['for the Amber Hours', 'for a Room That Remembers', 'in Low Tide', 'for Long Corridors', 'of Slow Weather', 'for Unsent Letters', 'in Copper Light', 'at the Edge of Listening', 'for Sleeping Machines', 'of the Second Coast', 'in Almost Everything', 'for the Space Between Stations'];
export function pieceTitle(seed) {
  const r = stream(seed, 'title');
  return `${pick(r, TITLE_A)} ${pick(r, TITLE_B)}`;
}
