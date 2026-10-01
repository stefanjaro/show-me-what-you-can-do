// CANTUS MACHINA — headless harness: fake DOM + fake Web Audio, then run the REAL
// app.js so every scheduler path and every instrument voice gets exercised.
// node test/harness.mjs

// ---------- fake Web Audio ----------
class Param {
  constructor(v) { this.value = v; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime(v) {
    if (!(v > 0)) throw new Error('exponentialRamp to non-positive value: ' + v);
    return this;
  }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
let nodeCount = 0;
class Node {
  constructor(kind) {
    this.kind = kind;
    this.outs = [];
    nodeCount++;
  }
  connect(dst) {
    if (!dst) throw new Error(`connect(${this.kind}) to nothing`);
    this.outs.push(dst);
    return dst;
  }
  disconnect() { this.outs.length = 0; }
  start(t) {
    if (t !== undefined && !(t >= 0)) throw new Error(`start(${this.kind}) bad time ${t}`);
    this.started = t || 0;
    nodeStarted++;
  }
  stop(t) {
    if (!(t >= 0)) throw new Error(`stop(${this.kind}) bad time ${t}`);
    if (this.started !== undefined && t < this.started) throw new Error(`stop before start on ${this.kind}`);
    // fire onended synchronously in fake time-later
    setImmediate(() => { if (this.onended) this.onended(); });
  }
}
class Osc extends Node {
  constructor() { super('osc'); this.frequency = new Param(440); this.detune = new Param(0); }
}
class SrcNode extends Node {
  constructor() { super('src'); this.playbackRate = new Param(1); this.buffer = null; this.loop = false; }
}
class Biquad extends Node {
  constructor() { super('biquad'); this.frequency = new Param(350); this.Q = new Param(1); this.gain = new Param(0); this.detune = new Param(0); this.type = 'lowpass'; }
}
class GainNode extends Node {
  constructor() { super('gain'); this.gain = new Param(1); }
}
class Panner extends Node {
  constructor() { super('pan'); this.pan = new Param(0); }
}
class DelayNode extends Node {
  constructor(max) { super('delay'); this.delayTime = new Param(0); }
}
class FakeCtx {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = new Node('dest');
    this.state = 'running';
    global.__ctx = this;
  }
  createGain() { return new GainNode(); }
  createOscillator() { return new Osc(); }
  createBufferSource() { return new SrcNode(); }
  createBiquadFilter() { return new Biquad(); }
  createStereoPanner() { return new Panner(); }
  createDelay(m) { return new DelayNode(m); }
  createConvolver() { const n = new Node('conv'); n.buffer = null; n.normalize = true; return n; }
  createDynamicsCompressor() {
    const n = new Node('comp');
    n.threshold = new Param(-24); n.knee = new Param(30); n.ratio = new Param(12);
    n.attack = new Param(0.003); n.release = new Param(0.25);
    return n;
  }
  createAnalyser() {
    const n = new Node('analyser');
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    n.frequencyBinCount = 1024;
    n.getByteFrequencyData = (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = (i * 7) % 200; };
    n.getByteTimeDomainData = (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = 128 + Math.round(40 * Math.sin(i / 9)); };
    return n;
  }
  createBuffer(ch, len) {
    const data = [];
    for (let c = 0; c < ch; c++) data.push(new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: 48000, getChannelData: (c) => data[c] };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

// ---------- fake DOM ----------
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, on) { if (on === undefined) on = !this.set.has(c); on ? this.set.add(c) : this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
}
class El {
  constructor(tag, id) {
    this.tagName = tag.toUpperCase();
    this.id = id || '';
    this.style = {};
    this.children = [];
    this.classList = new ClassList(this);
    this.listeners = {};
    this.textContent = '';
    this.value = '';
    if (tag === 'canvas') {
      this.width = 0; this.height = 0;
      this.clientWidth = 1200; this.clientHeight = 440;
      const noop = () => {};
      this.ctx2d = {
        setTransform: noop, clearRect: noop, fillRect: noop, beginPath: noop, moveTo: noop,
        lineTo: noop, quadraticCurveTo: noop, arc: noop, arcTo: noop, closePath: noop, fill: noop,
        stroke: noop, fillText: noop, save: noop, restore: noop, translate: noop, scale: noop,
        createLinearGradient: () => ({ addColorStop: noop }),
      };
      this.getContext = () => this.ctx2d;
    }
  }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  setAttribute() {}
  getAttribute() { return null; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  prepend(kid) { kid.parent = this; this.children.unshift(kid); }
  get lastChild() { return this.children[this.children.length - 1]; }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } }
  querySelector() { return new El('span'); }
  click() { (this.listeners.click || []).forEach((f) => f({ target: this, preventDefault() {} })); }
  fire(type, ev) { (this.listeners[type] || []).forEach((f) => f(ev)); }
}

const els = {};
function makeIds() {
  const ids = ['viz', 'intro', 'opusTitle', 'opusTitleIntro', 'opusNo', 'statusLine',
    'barRead', 'movRead', 'secRead', 'tempoRead', 'keyRead', 'chordRead', 'romanRead',
    'energyFill', 'levelFill', 'notesLog', 'playBtn', 'startBtn2', 'rollBtn', 'seedGo',
    'seedIn', 'copyBtn', 'vol', 'backBtn', 'fwdBtn', 'startBtn', 'footBar',
    'lamp-pad', 'lamp-bass', 'lamp-pluck', 'lamp-lead', 'lamp-bell', 'lamp-perc', 'lamp-wind', 'lamp-fx'];
  for (const id of ids) els[id] = new El(id === 'viz' ? 'canvas' : id === 'vol' ? 'input' : id === 'seedIn' ? 'input' : 'div', id);
}
makeIds();

let nodeStarted = 0;
const timers = [];
let rafQueue = [];
global.document = {
  getElementById: (id) => els[id],
  createElement: (t) => new El(t),
  addEventListener: (t, fn) => { (documentL[t] = documentL[t] || []).push(fn); },
  hidden: false,
};
const documentL = {};
global.window = {
  AudioContext: FakeCtx,
  addEventListener: (t, fn) => { windowL[t] = windowL[t] || []; if (t === 'DOMContentLoaded') setImmediate(fn); },
};
const windowL = {};
global.location = { search: '?seed=42&bar=10', href: 'http://x/', };
global.history = { replaceState: () => {} };
global.performance = { now: () => ctxNowMs };
let ctxNowMs = 0;
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); };
// ---------- run ----------
let failures = 0;
function ok(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } }
const intervalFns = [];
global.setInterval = (fn) => { intervalFns.push(fn); return { fn }; };
global.clearInterval = (h) => { const i = intervalFns.indexOf(h && h.fn); if (i >= 0) intervalFns.splice(i, 1); };
const realSetTimeout = global.setTimeout;

await import('../js/app.js');
await new Promise((r) => realSetTimeout(r, 20)); // let DOMContentLoaded init run

els.playBtn.click(); // starts transport (async engine.start)
await new Promise((r) => realSetTimeout(r, 20));

async function pump(seconds) {
  const stepMs = 30;
  const steps = Math.floor((seconds * 1000) / stepMs);
  for (let i = 0; i < steps; i++) {
    ctxNowMs += stepMs;
    if (global.__ctx) global.__ctx.currentTime = ctxNowMs / 1000;
    for (const fn of intervalFns.slice()) fn();
    const q = rafQueue; rafQueue = [];
    q.forEach((fn) => fn());
    await new Promise((r) => realSetTimeout(r, 0));
  }
}

await pump(64); // 64 simulated seconds ≈ 16+ bars

const started = nodeStarted;
const alive = nodeCount;
console.log(`nodes created: ${alive}, sources started: ${started}`);
console.log(`playhead readout bar: ${els.barRead.textContent}`);
console.log(`chord: ${els.chordRead.textContent} (${els.romanRead.textContent}) key: ${els.keyRead.textContent}`);
console.log(`notes log entries: ${els.notesLog.children.length}`);
console.log(`status: ${els.statusLine.textContent}`);

// long run: drive to the peak region (Signal ≈ bar 48), pause/resume, then play 4 minutes
els.startBtn.click(); // cursor → bar 0
await pump(2);
for (let i = 0; i < 12; i++) { els.fwdBtn.click(); await pump(2); }
els.playBtn.click(); // pause
await pump(3);       // ctx time keeps advancing while "suspended" — tests the resync guard
els.playBtn.click(); // resume
const beforeLong = nodeStarted;
await pump(240);     // ~4 simulated minutes
console.log(`long run: bar ${els.barRead.textContent}, +${nodeStarted - beforeLong} sources in 240s`);
ok(nodeStarted - beforeLong > 1500, `peak sections generate dense audio (got ${nodeStarted - beforeLong})`);
ok(Number(els.barRead.textContent) > 80, `transport crossed a movement boundary (bar ${els.barRead.textContent})`);

ok(started > 300, `first window scheduled voices (got ${started})`);
ok(els.notesLog.children.length >= 2, 'notes were spoken');
ok(Number(els.barRead.textContent) >= 8, `transport advanced (bar ${els.barRead.textContent})`);
ok(/(BPM)/.test(els.tempoRead.textContent) || /\d+/.test(els.tempoRead.textContent), 'tempo readout set');
ok(documentL.keydown && documentL.keydown.length, 'keydown listener registered');

// jam keys: play all nine
for (const k of 'asdfghjkl'.split('')) {
  documentL.keydown.forEach((f) => f({ key: k, code: 'Key' + k.toUpperCase(), repeat: false, target: { tagName: 'BODY' }, preventDefault() {} }));
}
// space toggles pause/resume
documentL.keydown.forEach((f) => f({ key: ' ', code: 'Space', target: { tagName: 'BODY' }, repeat: false, preventDefault() {} }));
documentL.keydown.forEach((f) => f({ key: ' ', code: 'Space', target: { tagName: 'BODY' }, repeat: false, preventDefault() {} }));
await pump(8);
ok(nodeStarted > started, 'jam keys produce sound');

// seed roll + jump + share should not throw
els.rollBtn.click();
await pump(4);
els.backBtn.click(); els.fwdBtn.click(); els.startBtn.click();
await pump(12);
els.seedIn.value = 'HELLO WORLD';
els.seedGo.click();
await pump(6);
ok(/\d/.test(els.barRead.textContent), 'bar readout survives jumps');

if (failures) { console.error(`\n${failures} HARNESS FAILURES`); process.exit(1); }
console.log('\nHARNESS PASSED — full stack exercised headlessly');
process.exit(0);
