// CANTUS MACHINA — program notes.
// The machine narrates its own compositional decisions, drawn from real state.

import { stream, pick, chance, rint } from './rng.js';
import { pcNamesFor, SCALES } from './theory.js';

const ROMAN = ['I', 'II', 'III', 'IV'];
function keyName(rootPc, mode) {
  return `${pcNamesFor(rootPc)[rootPc]} ${SCALES[mode].name.toLowerCase()}`;
}

const SECTION_LINES = {
  Ground: [
    'The ground arrives under everything. Bass, arpeggio — the floorboards settle.',
    'I add the pulse now, quietly, the way you notice a train a town away.',
    'Groove is just honesty about tempo. Here it is.',
    'The pad holds the chord; the arpeggio remembers it differently each time.',
  ],
  Clearing: [
    'A clearing. I drop the weight and let the motif walk back alone, slower.',
    'Everything away except the high air and one remembered phrase.',
    'Silence is an instrument I play often. Now it is soloing.',
    'Less. The room is bigger when there is less in it.',
  ],
  Drift: [
    'The motif returns backwards. Same notes, opposite direction — it means something else now.',
    'Percussion enters from nowhere in particular. We drift.',
    'I sequence the figure up a third and pretend I planned that. I did.',
    'Texture thickens. The reverb is doing legal work.',
  ],
  Signal: [
    'Peak. Inversion in the lead, counter-chimes above. Say it loud before you must say it softly.',
    'The piece leans its full weight onto this bar. Four bars from the top of the hour.',
    'Everything the movement believes, it believes here.',
    'Maximum density. The limiter and I have an understanding.',
  ],
  Horizon: [
    'Now the long way home: dominants resolving like late trains finally arriving.',
    'I thin the texture to its shadow. The cadence is not rushed.',
    'Everything points to the tonic now. There is no hurry. The tonic is not going anywhere.',
    'Release means the riser stops rising. Listen how the room reappears.',
  ],
  Threshold: [
    'A new movement. First: the old tonic, alone, until it is a memory.',
    'Threshold again. One chord, wide open, no intentions yet.',
    'I always begin a movement with the door half closed.',
  ],
};

const DIP_LINES = [
  'Stepping back. The density drops a floor for a breath.',
  'A bar of thinning. Most pieces would not dare.',
  'Almost everything stops for two seconds. Keep listening.',
];

const META = [
  'A reminder: bar {B} exists whether or not anyone is here for it.',
  'Nothing you hear is a recording. It is being decided now, then again exactly the same, forever.',
  'If the same bar is played twice in the same opus it is the same bar. That is the whole design.',
  'You could close your eyes. It would still be composing. It is the watching that pauses.',
];

const JAM_LINES = [
  'You play {N}. I know that note — it lives here. I will build around it.',
  '{N} — borrowed. The chord tilts, and I like the tilt.',
  'Noted. {N} enters the room. The pad will speak it back to you.',
];

// main entry: returns string[] (possibly empty) for the start of `b` (barEvents output)
export function narrate(seed, b, prev) {
  const out = [];
  const pb = b.bar % 64;
  const r = stream(seed, 'narr', b.bar);

  if (b.bar === 0) {
    out.push('Movement I. ' + keyName(b.rootPc, b.mode) + '. The piece begins where the seed begins.');
    out.push('Every sound is being built from nothing, now. There are no samples in this machine.');
    return out;
  }
  if (prev && b.mov !== prev.mov) {
    const rm = ROMAN[Math.min(b.mov, 3)];
    out.push(`Movement ${rm}. ${keyName(prev.rootPc, prev.mode)} → ${keyName(b.rootPc, b.mode)} — the piece changes its mind about home.`);
    if (chance(r, 0.5)) out.push(SECTION_LINES.Threshold[Math.floor(r() * SECTION_LINES.Threshold.length)]);
    if (b.mov > 0 && chance(r, 0.33)) out.push(META[Math.floor(r() * META.length)].replace('{B}', String(b.bar)));
  }
  if (prev && b.section !== prev.section) {
    const pool = SECTION_LINES[b.section] || [];
    if (pool.length) out.push(pool[Math.floor(r() * pool.length)]);
  }
  if (prev && b.flags.leadOp && (!prev || prev.flags.leadOp !== b.flags.leadOp || b.section !== prev.section)) {
    const ops = {
      'statement': 'The motif returns plain. Let it say the words first time.',
      'first statement': 'The motif says its name for the first time.',
      'fragment, slowed': 'Half the motif, held longer than it wants to be.',
      'retrograde': 'Watch the melody walk home by its own footsteps.',
      'sequence': 'The figure answers itself, a third higher.',
      'inversion': 'The motif turns over in its sleep.',
      'high sequence': 'One octave up. Same thought, different nerve.',
      'augmentation, home': 'The phrase stretched out like evening light. This is the close.',
    };
    const line = ops[b.flags.leadOp];
    if (line && chance(r, 0.6)) out.push(line);
  }
  if (b.flags.leadRest && prev && !prev.flags.leadRest && chance(r, 0.35)) {
    out.push('The lead window is left empty. Rests are decisions too.');
  }
  // dip bar detection: energy drop with no section change
  if (prev && b.energy < prev.energy * 0.55 && prev.energy > 0.18 && chance(r, 0.8)) {
    out.push(DIP_LINES[Math.floor(r() * DIP_LINES.length)]);
  }
  return out.slice(0, 2);
}

export function narrateJam(seed, midi, chordName) {
  const names = pcNamesFor(midi % 12);
  const note = names[midi % 12] + (Math.floor(midi / 12) - 1);
  const r = stream(seed, 'jam', midi, Date.now() >> 12);
  const line = JAM_LINES[rint(r, 0, JAM_LINES.length - 1)];
  return line.replace('{N}', note);
}
