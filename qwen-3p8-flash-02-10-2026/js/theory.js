// CANTUS MACHINA — music theory substrate (pure, deterministic, testable anywhere)

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES  = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// flat-side roots get spelled with flats — a small act of notational respect
const FLAT_ROOTS = new Set([1, 3, 5, 8, 10]);

export const SCALES = {
  ionian:     { name: 'Ionian',     intervals: [0, 2, 4, 5, 7, 9, 11], dark: 0.10, hue: 44 },
  lydian:     { name: 'Lydian',     intervals: [0, 2, 4, 6, 7, 9, 11], dark: 0.16, hue: 62 },
  mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], dark: 0.24, hue: 28 },
  dorian:     { name: 'Dorian',     intervals: [0, 2, 3, 5, 7, 9, 10], dark: 0.42, hue: 162 },
  aeolian:    { name: 'Aeolian',    intervals: [0, 2, 3, 5, 7, 8, 10], dark: 0.58, hue: 212 },
  phrygian:   { name: 'Phrygian',   intervals: [0, 1, 3, 5, 7, 8, 10], dark: 0.72, hue: 278 },
};
export const MODE_KEYS = Object.keys(SCALES);

export function pcNamesFor(rootPc) {
  return FLAT_ROOTS.has(rootPc) ? FLAT_NAMES : SHARP_NAMES;
}

export function degToSemitones(mode, deg) {
  const iv = SCALES[mode].intervals;
  const oct = Math.floor(deg / 7);
  const i = ((deg % 7) + 7) % 7;
  return iv[i] + 12 * oct;
}

// --- chords: diatonic stacks; qualities derived from intervals, never guessed ---
// opts: {seventh, sus:2|4, add9, rootOffsetAbsDeg}
export function buildChord(mode, deg, rootPc, opts = {}) {
  const sev = !!opts.seventh;
  const members = [deg, deg + 2, deg + 4].concat(sev ? [deg + 6] : []);
  const rel = members.map((m) => degToSemitones(mode, m) - degToSemitones(mode, deg));
  const third = rel[1], fifth = rel[2];
  let qual = 'min';
  if (third === 4 && fifth === 7) qual = 'maj';
  else if (third === 3 && fifth === 7) qual = 'min';
  else if (third === 3 && fifth === 6) qual = 'dim';
  else if (third === 4 && fifth === 8) qual = 'aug';

  const pcs = rel.map((s) => ((s % 12) + 12) % 12);
  if (opts.minorize && qual === 'maj') {
    pcs[1] = 3;
    rel[1] = 3;
    qual = 'min';
  }
  const names = pcNamesFor(rootPc);
  const namePc = ((rootPc + degToSemitones(mode, deg)) % 12 + 12) % 12;
  const rootName = names[namePc];

  let label = rootName;
  let voicePcs = pcs.slice();
  if (opts.sus === 2) { voicePcs[1] = 2; label += 'sus2'; }
  else if (opts.sus === 4) { voicePcs[1] = 5; label += 'sus4'; }
  else if (qual === 'min') label += 'm';
  else if (qual === 'dim') label = rootName + (sev ? (rel[3] === 9 ? 'dim7' : 'ø7') : 'dim');

  if (sev && opts.sus == null && qual !== 'dim') {
    const seventh = rel[3];
    if (qual === 'maj') label += seventh === 11 ? 'maj7' : '7';
    else label += seventh === 11 ? 'maj7' : '7';
  }
  if (opts.add9) { voicePcs.push(2); label += (label.includes('sus') ? '' : 'add9'); }

  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  let roman = numerals[((deg % 7) + 7) % 7];
  if (qual === 'min' || qual === 'dim') roman = roman.toLowerCase();
  if (opts.sus) roman += 'sus';
  if (sev) roman += '7';

  return {
    mode, deg, qual, sev, rootPc, namePc,
    pcs: voicePcs,                                        // intervals above the root
    pcAbs: voicePcs.map((p) => (namePc + p) % 12),        // absolute pitch classes
    degrees: members,            // absolute diatonic degrees (for harmonization)
    name: label,
    roman,
  };
}

// nearest-octave voicing. Enumerate ≤2 octave candidates per pitch class (≤64 combos),
// pick the one that moves least from `prev`, with a gentle pull toward `center`.
export function voiceChord(pcs, prev, center) {
  const cand = pcs.map((pc) => {
    const out = [];
    for (let midi = center - 11; midi <= center + 11; midi++) {
      if (((midi % 12) + 12) % 12 === pc) out.push(midi);
    }
    return out.sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).slice(0, 2);
  });
  let best = null, bestCost = Infinity;
  const n = cand.length;
  const total = cand.reduce((s, c) => s * c.length, 1);
  const idx = new Array(n).fill(0);
  for (let iter = 0; iter < total; iter++) {
    const notes = cand.map((list, i) => list[idx[i]]);
    let cost = 0;
    for (let i = 0; i < n; i++) {
      cost += Math.abs(notes[i] - center) * 0.3;
      if (prev && prev.length) {
        // voice leading: same pitch class moves minimally; doubled/new voices take nearest
        let target = null;
        for (const p of prev) if (((p % 12) + 12) % 12 === pcs[i]) { target = p; break; }
        if (target == null) {
          let d = Infinity;
          for (const p of prev) { const dd = Math.abs(p - notes[i]); if (dd < d) { d = dd; target = p; } }
        }
        cost += Math.abs(notes[i] - target) * 1.4;
      }
    }
    if (cost < bestCost - 1e-9) { bestCost = cost; best = notes.slice(); }
    // odometer
    for (let i = n - 1; i >= 0; i--) {
      idx[i]++;
      if (idx[i] < cand[i].length) break;
      idx[i] = 0;
    }
  }
  return best.sort((a, b) => a - b);
}

// --- melody in diatonic steps: inversion/retrograde/etc stay in key by construction ---
export function motifInvert(notes, axis) {
  return notes.map((n) => ({ ...n, deg: 2 * axis - n.deg }));
}
export function motifRetrograde(notes) {
  const durs = notes.map((n) => n.dur);
  const out = notes.map((n, i) => ({ ...n, dur: durs[durs.length - 1 - i] })).reverse();
  return out;
}
export function motifAugment(notes, f = 2) {
  return notes.map((n) => ({ ...n, dur: n.dur * f }));
}
export function motifDiminish(notes, f = 2) {
  return notes.map((n) => ({ ...n, dur: n.dur / f }));
}
export function motifFragment(notes, keep = 0.6) {
  const total = notes.reduce((s, n) => s + n.dur, 0);
  const out = [];
  let t = 0;
  for (const n of notes) {
    if (t >= total * keep && out.length > 1) break;
    out.push(n);
    t += n.dur;
  }
  return out;
}
export function motifShiftDeg(notes, d) {
  return notes.map((n) => ({ ...n, deg: n.deg + d }));
}

// snap strong-beat notes to the nearest chord tone (within 2 diatonic steps),
// leave weak beats as diatonic passing tones
export function harmonize(notes, chord) {
  const members = [];
  for (const d of chord.degrees) for (let o = -2; o <= 2; o++) members.push(d + o * 7);
  return notes.map((n) => {
    if (!n.strong) return { ...n };
    let best = n.deg, bd = Infinity;
    for (const m of members) {
      const d = Math.abs(m - n.deg);
      if (d < bd - 1e-9) { bd = d; best = m; }
    }
    return { ...n, deg: best };
  });
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
