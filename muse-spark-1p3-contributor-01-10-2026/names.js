/* PRIMORDIA names: procedural world / species / event prose. */
'use strict';

const WORLD_ADJ = ['Verdant', 'Silent', 'Crimson', 'Hollow', 'Radiant', 'Drifting', 'Ancient', 'Velvet', 'Howling', 'Golden', 'Obsidian', 'Pale', 'Thundering', 'Mirrored', 'Wandering', 'Sacred'];
const WORLD_NOUN = ['Thalassa', 'Verde', 'Kethra', 'Ostrova', 'Meridia', 'Solace', 'Tundara', 'Zephyria', 'Nerissa', 'Aurelia', 'Borealis', 'Cinder', 'Lumen', 'Terranova', 'Okeanos', 'Vesper'];
const WORLD_SUF = ['Prime', 'Minor', 'Major', 'IX', 'IV', 'VII', 'II', 'X', 'III', 'VI'];

const S1 = ['vel', 'az', 'gra', 'thor', 'mir', 'sel', 'kor', 'lun', 'bra', 'fen', 'ost', 'ver', 'cal', 'drex', 'hal', 'nyx', 'sol', 'tal', 'ul', 'wyn', 'zor', 'quil'];
const S2 = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'os', 'ur'];
const S3 = ['dor', 'fin', 'gar', 'horn', 'jaw', 'kith', 'maw', 'pelt', 'scale', 'thorn', 'whisk', 'back', 'crest', 'fang', 'grazer', 'stalker', 'bloom', 'dancer', 'runner', 'singer'];

function genWorldName(rand, seedStr) {
  const a = WORLD_ADJ[(rand() * WORLD_ADJ.length) | 0];
  const b = WORLD_NOUN[(rand() * WORLD_NOUN.length) | 0];
  const c = WORLD_SUF[(rand() * WORLD_SUF.length) | 0];
  return a + ' ' + b + ' ' + c;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function genSpeciesName(rand, diet) {
  const core = cap(S1[(rand() * S1.length) | 0] + S2[(rand() * S2.length) | 0] + S3[(rand() * S3.length) | 0]);
  const epi = diet === 2 ? ['maw', 'reaver', 'fang', 'hunter', 'terror'][(rand() * 5) | 0]
    : diet === 1 ? ['omni', 'eater', 'forager', 'rooter', 'taster'][(rand() * 5) | 0]
    : ['grazer', 'browser', 'bloomback', 'meadowlark', 'leafcoat'][(rand() * 5) | 0];
  return core + ' ' + epi;
}

const FIRST_LIFE = [
  'In the warm shallows, the first green film spreads across the rocks. Photosynthesis has begun.',
  'A single cell divides in the sunlit tide. Then another. The world is no longer sterile.',
  'Green threads take hold along the coast. Life has found its first foothold.'
];
const SPEC_TXT = [
  'diverged from its ancestors. A new branch on the tree of life.',
  'can no longer interbreed with its cousins. Biologists declare a new species.',
  'has walked its own evolutionary road long enough to earn a new name.'
];
const EXT_TXT = [
  'has vanished. Its songs will never be sung again.',
  'is gone. Only fossils remember its shape.',
  'has slipped into the dark of extinction.'
];
const METEOR_TXT = [
  'The sky burns. A mountain of nickel and fire falls from the dark.',
  'A second sun crosses the heavens — then the world breaks.',
  'Stone from the void strikes the sea. The horizon becomes flame.'
];

function pick(rand, arr) { return arr[(rand() * arr.length) | 0]; }
