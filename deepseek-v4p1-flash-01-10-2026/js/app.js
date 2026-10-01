/*
 * app.js — the page you are looking at.
 *
 * Wires the machine (volta.js), the firmware (bios.asm.js) and the library
 * (cartridges.js) to the DOM: screen, sound, editor, debugger and manual.
 */

import {
  assemble, disassemble, Volta, OPS, BIOS, MMIO, PAD, VRAM_BASE, VRAM_W, VRAM_H,
  FRAME_CYCLES, CPU_HZ, PREDEFINED,
} from './volta.js';
import { BIOS_ASM } from './bios.asm.js';
import { CARTS, CARTS_BY_ID } from './cartridges.js';
import { NOTES } from './notes.inc.js';
import { createAudio } from './audio.js';
import { highlight } from './highlight.js';

const $ = (id) => document.getElementById(id);

const TEMPLATE = `; ═══════════════════════════════════════════════════════════════════════
;  A NEW CARTRIDGE
;
;  This is a complete VOLTA-16 program. Assemble and run it, then change
;  it. The manual in section 05 lists every instruction and BIOS call.
; ═══════════════════════════════════════════════════════════════════════

    ; paint a palette
    LDI R0, pal
    LDI R1, 0
pal_loop:
    STA PAL_INDEX, R1
    LD R2, [R0]
    STA PAL_R, R2
    LDO R2, [R0+1]
    STA PAL_G, R2
    LDO R2, [R0+2]
    STA PAL_B, R2
    LDI R3, 3
    ADD R0, R3
    INC R1
    CMPI R1, 16
    JB pal_loop

    LDI R0, 0
    CALL BIOS_CLR

    LDI R0, greeting
    LDI R1, 24
    LDI R2, 50
    LDI R3, 2
    CALL BIOS_PRINT

loop:
    WAIT
    JMP loop

greeting:
    .asciiz "HELLO FROM MY CARTRIDGE"

pal:
    .word  0,  1,  3,    14, 13, 11,   15,  5,  2,   15, 11,  3
    .word  9,  2,  2,     2,  8,  7,    3,  7, 14,    9,  6, 14
    .word 13,  5,  9,     8,  9, 10,    4,  5,  7,    2,  3,  4
    .word  1,  6,  5,     8,  4,  1,   12, 11,  9,   15, 15, 15
`;

const EXAMPLE = `; say hello, politely, for one second
    LDI R0, 0
    CALL BIOS_CLR          ; black screen
    LDI R0, message
    LDI R1, 8
    LDI R2, 56
    LDI R3, 1              ; palette colour 1
    CALL BIOS_PRINT
loop:
    WAIT                   ; yield the rest of the frame
    JMP loop
message:
    .asciiz "HELLO, WORLD"
`;

const ISA_DOCS = {
  HLT: 'Stop the machine until reset.',
  NOP: 'Do nothing.',
  MOV: 'Copy a register.',
  LDI: 'Load a 16-bit immediate.',
  ADD: 'Add, setting Z, C, N and V.',
  SUB: 'Subtract, setting Z, C (borrow), N and V.',
  AND: 'Bitwise AND.',
  OR: 'Bitwise OR.',
  XOR: 'Bitwise XOR.',
  SHL: 'Shift left by Rs & 15.',
  SHR: 'Logical shift right.',
  SAR: 'Arithmetic shift right (sign fills).',
  MUL: 'Unsigned 16×16, keep the low word.',
  DIV: 'Unsigned divide. Divide by zero gives 0.',
  MOD: 'Unsigned remainder. Modulo zero gives the dividend.',
  INC: 'Add one.',
  DEC: 'Subtract one.',
  NEG: 'Two\u2019s complement.',
  NOT: 'Bitwise complement.',
  ADDI: 'Add a small constant 0–31.',
  SUBI: 'Subtract a small constant 0–31.',
  SHLI: 'Shift left by 0–15.',
  SHRI: 'Shift right by 0–15.',
  CMP: 'Compare: Z, C, N, V from Rd − Rs.',
  CMPI: 'Compare against 0–31 (sets Z, C, N, V).',
  LD: 'Load a word through a register.',
  LDO: 'Load a word at [Rs + offset].',
  ST: 'Store a word through a register.',
  STO: 'Store a word at [Rs + offset].',
  LDB: 'Load the low byte.',
  STB: 'Store the low byte.',
  PUSH: 'Push onto the stack.',
  POP: 'Pop from the stack.',
  JMP: 'Jump to an absolute address.',
  JE: 'Jump if Z (equal).',
  JNE: 'Jump if not equal.',
  JL: 'Signed less than.',
  JLE: 'Signed less or equal.',
  JG: 'Signed greater than.',
  JGE: 'Signed greater or equal.',
  JB: 'Unsigned below (carry).',
  JAE: 'Unsigned above or equal.',
  CALL: 'Call: push the return address.',
  RET: 'Return from a call.',
  DJNZ: 'Decrement and jump while not zero.',
  WAIT: 'Yield the rest of the frame.',
  LEA: 'Rd = Rs + offset (address arithmetic).',
  LDA: 'Load from an absolute address.',
  STA: 'Store to an absolute address.',
};

const SYNTAX = {
  none: (n) => n,
  r: (n) => `${n} Rn`,
  rr: (n) => `${n} Rd, Rs`,
  rk: (n) => `${n} Rd, 0–31`,
  ri: (n) => `${n} Rd, imm16`,
  rm: (n) => `${n} Rd, [Rs]`,
  rmo: (n) => `${n} Rd, [Rs+imm16]`,
  mr: (n) => `${n} [Rs], Rd`,
  mro: (n) => `${n} [Rs+imm16], Rd`,
  ra: (n) => `${n} Rd, addr16`,
  ar: (n) => `${n} addr16, Rd`,
  j: (n) => `${n} addr16`,
  rj: (n) => `${n} Rs, addr16`,
  lea: (n) => `${n} Rd, [Rs+imm16]`,
};

const FORM_NAMES = {
  none: 'inherent', r: 'register', rr: 'register', rk: 'short immediate',
  ri: 'immediate', rm: 'indexed', rmo: 'indexed', mr: 'indexed', mro: 'indexed',
  ra: 'absolute', ar: 'absolute', j: 'absolute', rj: 'relative', lea: 'indexed',
};

const state = {
  bios: null,
  cartId: null,
  sources: {},
  rom: null,
  roms: {},
  cpu: null,
  powered: false,
  running: false,
  speed: 1,
  last: 0,
  acc: 0,
  frameCount: 0,
  fpsMark: 0,
  fps: 0,
  cps: 0,
  held: 0,
  virtual: 0,
  memAddr: 0x8b00,
  errors: [],
  dirty: false,
  audio: createAudio(),
  stepping: false,
};

const canvas = $('screen');
const ctx2d = canvas.getContext('2d');
const image = ctx2d.createImageData(VRAM_W, VRAM_H);
const screenWrap = $('screen-wrap');
const scopeCanvas = $('scope');
const scopeCtx = scopeCanvas.getContext('2d');

/* ── index statistics, computed from the actual library ─────────────────── */
function computeStats() {
  let words = 0;
  let lines = 0;
  for (const cart of CARTS) {
    const rom = assemble(cart.source, { predefined: NOTES });
    state.roms[cart.id] = rom;
    words += rom.top;
    lines += cart.source.split('\n').length;
  }
  const total = words.toLocaleString('en-US');
  $('foot-stats').textContent =
    `${CARTS.length} cartridges · ${lines.toLocaleString('en-US')} lines of assembly · ${total} ROM words`;
}

/* ── screen ─────────────────────────────────────────────────────────────── */
function renderScreen() {
  const data = image.data;
  if (state.cpu && state.powered) {
    const mem = state.cpu.mem;
    const pal = state.cpu.palette;
    const invert = state.powered && mem[MMIO.INVERT] & 1;
    for (let i = 0; i < VRAM_W * VRAM_H; i++) {
      let idx = mem[VRAM_BASE + i] & 15;
      if (invert) idx = 15 - idx;
      const p = idx * 3;
      const o = i * 4;
      data[o] = pal[p];
      data[o + 1] = pal[p + 1];
      data[o + 2] = pal[p + 2];
      data[o + 3] = 255;
    }
  } else {
    data.fill(0);
  }
  ctx2d.putImageData(image, 0, 0);
}

function renderScope() {
  const w = scopeCanvas.width;
  const h = scopeCanvas.height;
  scopeCtx.clearRect(0, 0, w, h);
  scopeCtx.fillStyle = '#0a0d12';
  scopeCtx.fillRect(0, 0, w, h);
  scopeCtx.strokeStyle = 'rgba(120,255,160,.9)';
  scopeCtx.lineWidth = 1;
  scopeCtx.beginPath();
  const wave = state.audio.getWaveform();
  if (wave && state.powered) {
    for (let x = 0; x < w; x++) {
      const v = wave[Math.floor((x / w) * wave.length)];
      const y = h / 2 - v * (h / 2 - 3);
      if (x === 0) scopeCtx.moveTo(x, y);
      else scopeCtx.lineTo(x, y);
    }
  } else {
    scopeCtx.moveTo(0, h / 2);
    scopeCtx.lineTo(w, h / 2);
  }
  scopeCtx.stroke();
}

/* ── audio ──────────────────────────────────────────────────────────────── */
function syncAudio() {
  if (!state.audio.ready) return;
  if (!state.powered || !state.cpu || state.cpu.halted) {
    state.audio.sync(null);
    return;
  }
  const mem = state.cpu.mem;
  state.audio.sync({
    freq0: mem[MMIO.CH0_FREQ],
    ctrl0: mem[MMIO.CH0_CTRL],
    freq1: mem[MMIO.CH1_FREQ],
    ctrl1: mem[MMIO.CH1_CTRL],
    freq2: mem[MMIO.CH2_FREQ],
    ctrl2: mem[MMIO.CH2_CTRL],
    volume: mem[MMIO.VOLUME],
  });
}

/* ── input ──────────────────────────────────────────────────────────────── */
const KEYMAP = {
  ArrowLeft: PAD.LEFT, ArrowRight: PAD.RIGHT, ArrowUp: PAD.UP, ArrowDown: PAD.DOWN,
  KeyA: PAD.LEFT, KeyD: PAD.RIGHT, KeyW: PAD.UP, KeyS: PAD.DOWN,
  KeyZ: PAD.A, Space: PAD.A, KeyX: PAD.B,
  Enter: PAD.START, ShiftLeft: PAD.SELECT, ShiftRight: PAD.SELECT,
};
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter']);

function machineHasFocus() {
  const el = document.activeElement;
  return el === screenWrap || (el && el.closest && el.closest('.console-pads'));
}

window.addEventListener('keydown', (e) => {
  const bit = KEYMAP[e.code];
  if (bit === undefined) return;
  if (machineHasFocus()) {
    if (PREVENT.has(e.code)) e.preventDefault();
    state.held |= bit;
  }
});
window.addEventListener('keyup', (e) => {
  const bit = KEYMAP[e.code];
  if (bit === undefined) return;
  state.held &= ~bit;
});
window.addEventListener('blur', () => { state.held = 0; });
window.addEventListener('hashchange', () => {
  const id = location.hash.replace('#', '');
  if (id && id !== state.cartId && CARTS_BY_ID[id] && id !== 'scratch' && id !== 'example') {
    insertCart(id, { updateHash: false });
  }
});
screenWrap.addEventListener('pointerdown', () => screenWrap.focus());

function bindPad() {
  document.querySelectorAll('[data-pad]').forEach((btn) => {
    const bit = {
      left: PAD.LEFT, right: PAD.RIGHT, up: PAD.UP, down: PAD.DOWN,
      a: PAD.A, b: PAD.B, start: PAD.START,
    }[btn.dataset.pad];
    const down = (e) => { e.preventDefault(); state.virtual |= bit; btn.classList.add('down'); };
    const up = (e) => { e.preventDefault(); state.virtual &= ~bit; btn.classList.remove('down'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });
}

const readInput = () => (state.held | state.virtual) & 0xff;

/* ── machine control ────────────────────────────────────────────────────── */
function ensureBIOS() {
  if (state.bios) return true;
  const bios = assemble(BIOS_ASM);
  if (bios.errors.length) {
    showDiagnostics(bios.errors);
    $('ed-status').textContent = 'BIOS FAILED';
    $('ed-status').className = 'bad';
    return false;
  }
  state.bios = bios;
  return true;
}

function loadROM(source) {
  const rom = assemble(source, { predefined: NOTES });
  return rom;
}

function insertCart(id, { updateHash = true, keepEdits = true } = {}) {
  if (id !== 'scratch' && !CARTS_BY_ID[id]) return;
  if (!ensureBIOS()) return;
  const source = keepEdits && state.sources[id] !== undefined
    ? state.sources[id]
    : (id === 'scratch' ? TEMPLATE : CARTS_BY_ID[id].source);
  state.sources[id] = source;
  state.cartId = id;
  state.dirty = false;

  const rom = loadROM(source);
  state.errors = rom.errors;
  state.sources[id] = source;
  setEditor(source);
  updateAssemblyUI(rom);

  if (rom.errors.length) {
    // an edited cartridge with errors: hold the old ROM, power down
    powerOff();
    $('ro-cart').textContent = '—';
    return;
  }
  state.rom = rom;
  resetMachine();
  powerOn();
  updateShelf();
  if (updateHash) history.replaceState(null, '', `#${id}`);
}

function resetMachine() {
  if (!state.rom || state.rom.errors.length) return;
  state.cpu = new Volta({ rom: state.rom, bios: state.bios, seed: (Date.now() ^ (Math.random() * 0xffff)) >>> 0 });
  state.acc = 0;
  state.frameCount = 0;
}

function powerOn() {
  if (!state.cpu) resetMachine();
  if (!state.cpu) return;
  state.powered = true;
  state.running = true;
  $('screen-off').classList.add('hide');
  $('power-led').classList.add('on');
  $('btn-run').textContent = 'Pause';
  state.audio.resume();
  state.audio.setUserVolume(Number($('rng-vol').value) / 100);
  state.last = performance.now();
}

function powerOff() {
  state.powered = false;
  state.running = false;
  $('screen-off').classList.remove('hide');
  $('power-led').classList.remove('on');
  $('btn-run').textContent = 'Run';
  syncAudio();
}

function setRunning(run) {
  if (!state.powered) return;
  state.running = run;
  $('btn-run').textContent = run ? 'Pause' : 'Run';
  state.last = performance.now();
}

/* ── main loop ──────────────────────────────────────────────────────────── */
let hudAt = 0;
let dbgAt = 0;

function tick(now) {
  requestAnimationFrame(tick);
  if (state.powered && state.cpu) {
    if (state.running && !state.cpu.halted) {
      const dt = Math.min(0.25, (now - state.last) / 1000);
      state.acc += dt * 60 * state.speed;
      let frames = Math.floor(state.acc);
      state.acc -= frames;
      frames = Math.min(frames, 12);
      for (let i = 0; i < frames; i++) {
        state.cpu.input = readInput();
        state.cpu.frame();
        state.frameCount++;
        if (state.cpu.halted) { setRunning(false); break; }
      }
      if (frames > 0) syncAudio();
    }
    renderScreen();
    renderScope();
  } else {
    renderScreen();
    renderScope();
  }
  state.last = now;
  if (now - hudAt > 250) { hudAt = now; updateHUD(); }
  if (now - dbgAt > 200) { dbgAt = now; updateDebugger(); }
}

/* ── HUD ────────────────────────────────────────────────────────────────── */
function updateHUD() {
  const cart = state.cartId === 'scratch'
    ? { name: 'SCRATCH', file: 'SCRATCH.ASM' }
    : CARTS_BY_ID[state.cartId];
  $('ro-cart').textContent = cart ? cart.name : '—';
  $('bezel-state').textContent = !state.powered ? 'STANDBY'
    : !state.cpu ? 'NO ROM'
    : state.cpu.halted ? 'HALTED'
    : state.running ? 'RUNNING' : 'PAUSED';
  $('ro-state').textContent = $('bezel-state').textContent;
  if (state.cpu) {
    $('ro-pc').textContent = `0x${state.cpu.pc.toString(16).toUpperCase().padStart(4, '0')}`;
    $('ro-frame').textContent = String(state.cpu.frameCount);
    $('ro-cycles').textContent = state.powered ? `${Math.round(CPU_HZ * state.speed).toLocaleString('en-US')}` : '—';
  } else {
    $('ro-pc').textContent = '—';
    $('ro-frame').textContent = '—';
    $('ro-cycles').textContent = '—';
  }
}

/* ── debugger ───────────────────────────────────────────────────────────── */
function updateDebugger() {
  if (!state.cpu) return;
  const cpu = state.cpu;
  const tbody = $('reg-table').querySelector('tbody');
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const v = cpu.r[i];
    rows.push(`<tr><td>R${i}</td><td>0x${v.toString(16).toUpperCase().padStart(4, '0')}</td><td>${v}</td></tr>`);
  }
  tbody.innerHTML = rows.join('');
  $('flags').innerHTML = `
    <span class="${cpu.z ? 'on' : ''}"><b>Z</b>${cpu.z}</span>
    <span class="${cpu.c ? 'on' : ''}"><b>C</b>${cpu.c}</span>
    <span class="${cpu.n ? 'on' : ''}"><b>N</b>${cpu.n}</span>
    <span class="${cpu.v ? 'on' : ''}"><b>V</b>${cpu.v}</span>
    <span><b>SP</b>0x${cpu.sp.toString(16).toUpperCase().padStart(4, '0')}</span>
    <span><b>PC</b>0x${cpu.pc.toString(16).toUpperCase().padStart(4, '0')}</span>`;
  $('mon-pc').textContent = `PC 0x${cpu.pc.toString(16).toUpperCase().padStart(4, '0')}`;
  const lines = disassemble(cpu.mem, cpu.pc, 14, state.rom ? state.rom.symbols : null);
  $('disasm').innerHTML = lines.map((l, i) => {
    const addr = l.addr.toString(16).toUpperCase().padStart(4, '0');
    return `<li class="${i === 0 ? 'at' : ''}"><span>${addr}</span>${escapeHtml(l.text)}</li>`;
  }).join('');
  const addr = state.memAddr & 0xffff;
  const out = [];
  for (let row = 0; row < 16; row++) {
    const base = (addr + row * 8) & 0xffff;
    let line = `<b>${base.toString(16).toUpperCase().padStart(4, '0')}</b> `;
    let chars = '  ';
    for (let col = 0; col < 8; col++) {
      const v = cpu.mem[(base + col) & 0xffff];
      line += v.toString(16).toUpperCase().padStart(4, '0') + ' ';
      chars += v >= 32 && v < 127 ? String.fromCharCode(v) : '.';
    }
    out.push(line + ' ' + chars);
  }
  $('mem-grid').innerHTML = out.join('\n');
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ── editor ─────────────────────────────────────────────────────────────── */
const sourceEl = $('source');
const highlightEl = $('highlight');
const gutterEl = $('gutter');
let previewTimer = 0;

function setEditor(text) {
  sourceEl.value = text;
  syncEditor();
}

function syncEditor() {
  const text = sourceEl.value;
  highlightEl.innerHTML = highlight(text) + '\n';
  const n = text.split('\n').length;
  let g = '';
  for (let i = 1; i <= n; i++) g += i + '\n';
  gutterEl.innerHTML = `<pre>${g}</pre>`;
  syncScroll();
}

function syncScroll() {
  const pre = gutterEl.querySelector('pre');
  if (pre) pre.style.transform = `translateY(${-sourceEl.scrollTop}px)`;
  highlightEl.scrollTop = sourceEl.scrollTop;
  highlightEl.scrollLeft = sourceEl.scrollLeft;
}

sourceEl.addEventListener('input', () => {
  state.sources[state.cartId] = sourceEl.value;
  state.dirty = true;
  syncEditor();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (!ensureBIOS()) return;
    const rom = loadROM(sourceEl.value);
    updateAssemblyUI(rom);
  }, 250);
});
sourceEl.addEventListener('scroll', syncScroll);
sourceEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = sourceEl.selectionStart;
    const end = sourceEl.selectionEnd;
    sourceEl.setRangeText('    ', start, end, 'end');
    sourceEl.dispatchEvent(new Event('input'));
  }
});

function updateAssemblyUI(rom) {
  state.errors = rom.errors;
  const status = $('ed-status');
  if (rom.errors.length) {
    status.textContent = `${rom.errors.length} error${rom.errors.length === 1 ? '' : 's'}`;
    status.className = 'bad';
  } else {
    status.textContent = 'assembled';
    status.className = 'ok';
  }
  const pct = ((rom.top / 0x4000) * 100).toFixed(1);
  $('rom-stat').textContent = `${rom.top.toLocaleString('en-US')} words · ${pct}% of cartridge ROM`;
  showDiagnostics(rom.errors);
  updateSymbols(rom);
  updateListing(rom);
}

function showDiagnostics(errors) {
  const list = $('diagnostics');
  if (!errors.length) {
    list.innerHTML = '<li class="muted">No problems. The assembler is satisfied.</li>';
    return;
  }
  list.innerHTML = errors.map((e) =>
    `<li data-line="${e.line}"><b>line ${e.line}</b><span>${escapeHtml(e.message)}</span></li>`
  ).join('');
  list.querySelectorAll('li[data-line]').forEach((li) => {
    li.addEventListener('click', () => {
      const line = Number(li.dataset.line);
      const lines = sourceEl.value.split('\n');
      let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      sourceEl.focus();
      sourceEl.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
      const lh = 1.6 * 12; // approximate scroll into view
      sourceEl.scrollTop = Math.max(0, (line - 6) * lh);
    });
  });
}

function updateSymbols(rom) {
  const el = $('symbols');
  if (rom.errors.length && rom.symbols.size < 20) {
    el.innerHTML = '<p class="muted">Fix the errors to see symbols.</p>';
    return;
  }
  const noteNames = new Set(Object.keys(NOTES));
  const entries = [...rom.symbols.entries()]
    .filter(([name]) => !(name in PREDEFINED) && !noteNames.has(name))
    .sort((a, b) => a[1] - b[1])
    .slice(0, 80);
  if (!entries.length) {
    el.innerHTML = '<p class="muted">No labels yet.</p>';
    return;
  }
  el.innerHTML = entries.map(([name, value]) =>
    `<span>${escapeHtml(name)}</span><b>0x${value.toString(16).toUpperCase().padStart(4, '0')}</b>`
  ).join('');
}

function updateListing(rom) {
  const el = $('listing');
  if (!rom.listing.length) {
    el.textContent = 'Nothing assembled yet.';
    return;
  }
  const shown = rom.listing.slice(0, 60).map((l) =>
    `${l.addr.toString(16).toUpperCase().padStart(4, '0')}  ${l.text}`
  );
  if (rom.listing.length > shown.length) shown.push(`… ${rom.listing.length - shown.length} more`);
  el.textContent = shown.join('\n');
}

/* ── shelf ──────────────────────────────────────────────────────────────── */
function buildShelf() {
  const shelf = $('shelf');
  shelf.innerHTML = CARTS.map((cart, i) => {
    const rom = state.roms[cart.id];
    const pct = rom ? ((rom.top / 0x4000) * 100).toFixed(1) : '—';
    return `
      <article class="cart-card" data-id="${cart.id}">
        <div class="cart-head">
          <p class="cart-no">CARTRIDGE №${String(i + 1).padStart(2, '0')}</p>
          <h3 class="cart-name">${cart.name}</h3>
          <p class="cart-file">${cart.file} · ${rom ? rom.top : '—'} words · ${pct}% ROM</p>
        </div>
        <div class="cart-body">
          <p class="cart-tag">${cart.tagline}</p>
          <p class="cart-blurb">${cart.blurb}</p>
          <ul class="cart-chips">${cart.chips.map((c) => `<li class="chip">${c}</li>`).join('')}</ul>
        </div>
        <div class="cart-foot">
          <span class="cart-stats">${rom ? `${rom.listing.length} instructions` : ''}</span>
          <button class="btn cart-load" type="button" data-load="${cart.id}">Insert</button>
        </div>
      </article>`;
  }).join('');
  shelf.querySelectorAll('[data-load]').forEach((btn) => {
    btn.addEventListener('click', () => {
      insertCart(btn.dataset.load);
      document.getElementById('machine').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  updateShelf();
}

function updateShelf() {
  document.querySelectorAll('.cart-card').forEach((card) => {
    card.classList.toggle('loaded', card.dataset.id === state.cartId);
  });
}

/* ── manual tables ──────────────────────────────────────────────────────── */
function buildISA() {
  const tbody = $('isa').querySelector('tbody');
  tbody.innerHTML = OPS.map((op, code) => {
    if (!op) return '';
    const syntax = (SYNTAX[op.form] || ((n) => n))(op.name);
    return `<tr>
      <td>${op.name}</td>
      <td>0x${code.toString(16).toUpperCase().padStart(2, '0')} · ${FORM_NAMES[op.form]}</td>
      <td>${syntax}</td>
      <td>${["ri", "rmo", "mro", "ra", "ar", "j", "rj", "lea"].includes(op.form) ? 2 : 1}</td>
      <td>${op.cost}</td>
      <td>${ISA_DOCS[op.name] || ''}</td>
    </tr>`;
  }).join('');
}

/* ── wiring ─────────────────────────────────────────────────────────────── */
function bindControls() {
  $('btn-power').addEventListener('click', () => {
    if (state.powered) powerOff();
    else powerOn();
  });
  $('btn-run').addEventListener('click', () => setRunning(!state.running));
  $('btn-frame').addEventListener('click', () => {
    if (!state.powered || !state.cpu) return;
    setRunning(false);
    state.cpu.input = readInput();
    state.cpu.frame();
    state.frameCount++;
    syncAudio();
    updateDebugger();
  });
  $('btn-step').addEventListener('click', () => {
    if (!state.powered || !state.cpu) return;
    setRunning(false);
    if (!state.cpu.halted) state.cpu.step();
    updateDebugger();
  });
  $('btn-reset').addEventListener('click', () => {
    resetMachine();
    state.powered = true;
    state.running = true;
    $('screen-off').classList.add('hide');
    $('power-led').classList.add('on');
    $('btn-run').textContent = 'Pause';
  });
  $('sel-speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); });
  $('rng-vol').addEventListener('input', (e) => { state.audio.setUserVolume(Number(e.target.value) / 100); });
  $('btn-shot').addEventListener('click', saveScreen);
  $('btn-fs').addEventListener('click', () => {
    const el = $('console');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
  });
  $('btn-assemble').addEventListener('click', () => {
    insertCart(state.cartId, { updateHash: false });
  });
  $('btn-revert').addEventListener('click', () => {
    if (state.cartId === 'scratch') state.sources.scratch = TEMPLATE;
    else delete state.sources[state.cartId];
    insertCart(state.cartId, { updateHash: false });
  });
  $('btn-new').addEventListener('click', () => {
    state.sources.scratch = TEMPLATE;
    insertCart('scratch', { updateHash: false });
    document.getElementById('language').scrollIntoView({ behavior: 'smooth' });
  });
  $('btn-example').addEventListener('click', () => {
    state.sources.example = EXAMPLE;
    insertCart('example', { updateHash: false, keepEdits: true });
  });
  $('mem-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt($('mem-addr').value.replace(/[^0-9a-f]/gi, ''), 16);
    if (!Number.isNaN(v)) state.memAddr = v & 0xffff;
  });
}

function saveScreen() {
  const big = document.createElement('canvas');
  const scale = 4;
  big.width = VRAM_W * scale;
  big.height = VRAM_H * scale;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, big.width, big.height);
  bctx.drawImage(canvas, 0, 0, big.width, big.height);
  const name = (state.cartId || 'volta').toUpperCase();
  const a = document.createElement('a');
  a.download = `VOLTA16-${name}-${state.frameCount}.png`;
  a.href = big.toDataURL('image/png');
  a.click();
}

/* ── unlisted cartridge ids: scratch and example ────────────────────────── */
CARTS_BY_ID.scratch = { id: 'scratch', name: 'SCRATCH', file: 'SCRATCH.ASM', source: TEMPLATE };
CARTS_BY_ID.example = { id: 'example', name: 'EXAMPLE', file: 'EXAMPLE.ASM', source: EXAMPLE };

/* ── boot the page ──────────────────────────────────────────────────────── */
function revealOnScroll() {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.sec-head, .bench, .shelf, .workbench, .monitor-grid, .manual-grid, .isa-wrap').forEach((el) => {
    el.classList.add('rev');
    io.observe(el);
  });
}

function start() {
  computeStats();
  buildISA();
  buildShelf();
  bindControls();
  bindPad();
  revealOnScroll();
  const hash = location.hash.replace('#', '');
  const initial = CARTS_BY_ID[hash] && hash !== 'scratch' && hash !== 'example' ? hash : 'boot';
  insertCart(initial, { updateHash: false });
  requestAnimationFrame(tick);
  window.VOLTA = {
    state,
    insertCart,
    assemble: (source) => assemble(source, { predefined: NOTES }),
    BIOS_ASM,
    cartridges: CARTS,
  };
}

try {
  start();
} catch (err) {
  const status = $('ed-status');
  if (status) {
    status.textContent = 'startup failed';
    status.className = 'bad';
  }
  showDiagnostics([{ line: 0, message: String(err && err.message || err) }]);
  throw err;
}
