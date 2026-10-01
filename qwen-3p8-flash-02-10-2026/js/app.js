// CANTUS MACHINA — the console: transport, scheduling, UI.

import { barEvents, MOV_LEN, pieceTitle } from './composer.js';
import { narrate, narrateJam } from './notes.js';
import { Engine } from './synth.js';
import { Viz } from './viz.js';
import { strHash32 } from './rng.js';
import { SCALES, pcNamesFor, degToSemitones } from './theory.js';

const $ = (id) => document.getElementById(id);
const engine = new Engine();
let viz = null;

const params = new URLSearchParams(location.search);
let seed = (() => {
  const s = params.get('seed');
  if (s == null) return (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  return /^\d+$/.test(s) ? (parseInt(s, 10) >>> 0) : strHash32(s) >>> 0;
})();
let userStartBar = Math.max(0, parseInt(params.get('bar') || '0', 10) || 0);

let running = false;
let scheduledCursor = 0;
let barNextTime = 0;
let prev = null;
let timer = null;

const VOICES = ['pad', 'bass', 'pluck', 'lead', 'bell', 'perc', 'wind', 'fx'];
const lastActive = {};

// ---------- transport ----------

function scheduleBar(b, t0) {
  const data = barEvents(seed, b);
  const beat = 60 / data.tempo;
  engine.setTempo(data.tempo);
  data.events.forEach((ev, idx) => {
    const when = t0 + ((ev.barOff || 0) * 4 + ev.t) * beat;
    engine.play(ev, when, beat, seed, b, idx);
    if (ev.midi > 0) viz.note(ev, when, beat);
    lastActive[ev.voice] = Math.max(lastActive[ev.voice] || 0, when);
  });
  const prevData = prev;
  pending.push({ t: t0, run: () => onBarPlay(data, prevData) });
  prev = data;
  return 4 * beat;
}

const pending = [];

function onBarPlay(data, prevData) {
  $('barRead').textContent = String(data.bar);
  $('footBar').textContent = String(data.bar);
  $('movRead').textContent = data.mov + 1;
  $('secRead').textContent = data.section;
  $('tempoRead').textContent = data.tempo + ' BPM';
  const key = pcNamesFor(data.rootPc)[data.rootPc] + ' ' + SCALES[data.mode].name.toLowerCase();
  $('keyRead').textContent = key;
  $('chordRead').textContent = data.chord.name;
  $('romanRead').textContent = data.chord.roman;
  $('energyFill').style.width = (data.energy * 100).toFixed(0) + '%';
  viz.setChord(data.chord.pcAbs, data.chord.name);
  viz.setTheme(SCALES[data.mode].hue, SCALES[data.mode].dark);
  viz.setScale(data.rootPc, SCALES[data.mode].intervals);
  viz.pulse(performanceNowAudio());
  const lines = narrate(seed, data, prevData);
  for (const l of lines) pushNote(data.bar, l);
  saveUrl(data.bar);
}

function performanceNowAudio() {
  return engine.ctx ? engine.ctx.currentTime : 0;
}

function tick() {
  if (!engine.ctx) return;
  const now = engine.ctx.currentTime;
  while (barNextTime < now + 0.45) {
    const dur = scheduleBar(scheduledCursor, barNextTime);
    barNextTime += dur;
    scheduledCursor++;
    if (barNextTime < now - 2) { // fell far behind: hard resync
      barNextTime = now + 0.12;
    }
  }
}

async function startTransport(fromBar) {
  await engine.start();
  if (!viz) viz = new Viz($('viz'), engine);
  viz.running = true;
  scheduledCursor = fromBar;
  prev = null;
  barNextTime = engine.ctx.currentTime + 0.35;
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 30);
  tick();
  running = true;
  $('playBtn').classList.add('on');
  $('playBtn').setAttribute('aria-label', 'pause');
  $('statusLine').textContent = 'engine running — the piece is being decided now';
  $('intro').classList.add('gone');
}

function pauseTransport() {
  if (!running) return;
  engine.suspend();
  running = false;
  $('playBtn').classList.remove('on');
  $('playBtn').setAttribute('aria-label', 'play');
  $('statusLine').textContent = 'held. the piece is still exactly where you left it.';
}

function resumeTransport() {
  if (running || !engine.ctx) return;
  engine.resume();
  running = true;
  $('playBtn').classList.add('on');
  $('statusLine').textContent = 'engine running — the piece is being decided now';
}

function jumpToBar(b) {
  const go = () => {
    scheduledCursor = b;
    prev = null;
    barNextTime = engine.ctx.currentTime + 0.12;
    userStartBar = b;
  };
  if (!running) { startTransport(b); return; }
  go();
}

function saveUrl(bar) {
  const p = new URLSearchParams();
  p.set('seed', String(seed));
  p.set('bar', String(bar));
  history.replaceState(null, '', '?' + p.toString());
}

// ---------- program notes ----------

function pushNote(bar, text) {
  const log = $('notesLog');
  const el = document.createElement('div');
  el.className = 'note';
  const b = document.createElement('span');
  b.className = 'note-bar';
  b.textContent = String(bar);
  const t = document.createElement('span');
  t.className = 'note-text';
  el.append(b, t);
  log.prepend(el);
  let i = 0;
  const typer = setInterval(() => {
    t.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(typer);
  }, 18);
  while (log.children.length > 7) log.lastChild.remove();
}

// ---------- jam keyboard ----------

const JAM_KEYS = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6, k: 7, l: 8 };
function jamPlay(deg) {
  if (!engine.ctx) return;
  const data = prev || barEvents(seed, scheduledCursor);
  const semi = degToSemitones(data.mode, deg);
  const midi = data.tonicRef + 24 + semi;
  const ev = {
    t: 0, dur: 1.4, voice: 'lead', midi, vel: 0.62,
    art: { vib: 0.8, glide: false, bright: 0.85, pan: ((deg % 3) - 1) * 0.3 },
  };
  const when = engine.ctx.currentTime + 0.02;
  engine.play(ev, when, 60 / data.tempo, seed, -1, deg);
  viz.note(ev, when, 60 / data.tempo, 'jam');
  if (Math.random() < 0.5) pushNote(data.bar, narrateJam(seed, midi, data.chord.name));
}

// ---------- readouts loop ----------

function raf() {
  if (engine.ctx) {
    const now = engine.ctx.currentTime;
    while (pending.length && pending[0].t <= now) {
      const item = pending.shift();
      item.run();
    }
    const lvl = engine.level();
    $('levelFill').style.width = Math.min(100, lvl * 260).toFixed(1) + '%';
    for (const v of VOICES) {
      const el = $('lamp-' + v);
      if (el) el.classList.toggle('lit', (lastActive[v] || 0) > now - 0.4);
    }
  }
  requestAnimationFrame(raf);
}

// ---------- UI wiring ----------

window.addEventListener('DOMContentLoaded', () => {
  const data0 = barEvents(seed, userStartBar);
  $('opusTitle').textContent = pieceTitle(seed);
  $('opusTitleIntro').textContent = pieceTitle(seed);
  $('opusNo').textContent = 'OPUS No. ' + seed.toString(36).toUpperCase();
  $('seedIn').value = String(seed);
  $('barRead').textContent = String(userStartBar);
  $('footBar').textContent = String(userStartBar);
  $('movRead').textContent = data0.mov + 1;
  $('secRead').textContent = data0.section;
  $('tempoRead').textContent = data0.tempo + ' BPM';
  const key = pcNamesFor(data0.rootPc)[data0.rootPc] + ' ' + SCALES[data0.mode].name.toLowerCase();
  $('keyRead').textContent = key;
  $('chordRead').textContent = data0.chord.name;
  $('romanRead').textContent = data0.chord.roman;

  $('playBtn').addEventListener('click', () => {
    if (!engine.ctx) startTransport(userStartBar);
    else if (running) pauseTransport();
    else resumeTransport();
  });
  $('startBtn2').addEventListener('click', () => startTransport(userStartBar));
  $('rollBtn').addEventListener('click', () => newSeed());
  $('seedGo').addEventListener('click', () => {
    const s = $('seedIn').value.trim();
    if (s) setSeed(/^[0-9]+$/.test(s) ? parseInt(s, 10) >>> 0 : strHash32(s) >>> 0);
  });
  $('seedIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('seedGo').click(); });
  $('copyBtn').addEventListener('click', async () => {
    saveUrl(prev ? prev.bar : userStartBar);
    try { await navigator.clipboard.writeText(location.href); flash($('copyBtn'), 'copied'); }
    catch { flash($('copyBtn'), 'copy failed'); }
  });
  $('vol').addEventListener('input', (e) => {
    if (engine.ctx) engine.setVolume(parseFloat(e.target.value) / 100);
  });
  $('backBtn').addEventListener('click', () => jumpToBar(Math.max(0, (prev ? prev.bar : userStartBar) - 4)));
  $('fwdBtn').addEventListener('click', () => jumpToBar((prev ? prev.bar : userStartBar) + 4));
  $('startBtn').addEventListener('click', () => jumpToBar(0));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); return; }
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k in JAM_KEYS) jamPlay(JAM_KEYS[k]);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) pauseTransport();
  });

  requestAnimationFrame(raf);
});

function newSeed() {
  setSeed(((Math.random() * 0xfffffff) ^ Date.now()) >>> 0);
}
function setSeed(s) {
  seed = s >>> 0;
  $('seedIn').value = String(seed);
  $('opusTitle').textContent = pieceTitle(seed);
  $('opusNo').textContent = 'OPUS No. ' + seed.toString(36).toUpperCase();
  const d = barEvents(seed, 0);
  $('movRead').textContent = d.mov + 1;
  $('secRead').textContent = d.section;
  $('tempoRead').textContent = d.tempo + ' BPM';
  $('keyRead').textContent = pcNamesFor(d.rootPc)[d.rootPc] + ' ' + SCALES[d.mode].name.toLowerCase();
  $('chordRead').textContent = d.chord.name;
  $('romanRead').textContent = d.chord.roman;
  jumpToBar(0);
  pushNote(0, 'New seed. The engine rolls a fresh infinity: ' + pieceTitle(seed) + '.');
}

function flash(el, msg) {
  const old = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = old; }, 1200);
}
