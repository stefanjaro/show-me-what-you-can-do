import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, PAD, VRAM_BASE, VRAM_W, MMIO, BIOS } from '../js/volta.js';
import { BIOS_ASM } from '../js/bios.asm.js';
import { CARTS, CARTS_BY_ID } from '../js/cartridges.js';
import { NOTES } from '../js/notes.inc.js';
import { makeCPU, run } from './harness.mjs';

test('BIOS assembles and fits its code region', () => {
  const bios = assemble(BIOS_ASM);
  assert.deepEqual(bios.errors, []);
  for (const name of ['CLR', 'PIXEL', 'RECT', 'HLINE', 'CHAR', 'CHAR2', 'PRINT', 'NUM', 'SIN', 'COS']) {
    assert.ok(bios.symbols.has(name), `missing BIOS routine ${name}`);
  }
  assert.ok(bios.symbols.get('COS') < BIOS.FONT, 'BIOS code runs into the font table');
  assert.equal(bios.symbols.get('BIOS_FONT'), BIOS.FONT);
});

test('BIOS draws text, numbers and fills', () => {
  const { cpu } = makeCPU(`
    LDI R0, 0
    CALL BIOS_CLR
    LDI R0, msg
    LDI R1, 4
    LDI R2, 4
    LDI R3, 1
    CALL BIOS_PRINT
    LDI R0, 609
    LDI R1, 4
    LDI R2, 20
    LDI R3, 2
    CALL BIOS_NUM
    HLT
msg:
    .asciiz "AZ"
  `);
  run(cpu, 2);
  const lit = (x0, y0, w, h) => {
    let n = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (cpu.mem[VRAM_BASE + y * VRAM_W + x]) n++;
    return n;
  };
  assert.ok(lit(4, 4, 12, 7) > 10, 'letters should draw pixels');
  assert.ok(lit(4, 20, 20, 7) > 10, 'the number 609 should draw pixels');
  assert.equal(cpu.mem[VRAM_BASE], 0, 'CLR should leave the background black');
});

test('every cartridge assembles and stays in cartridge space', () => {
  const bios = assemble(BIOS_ASM);
  for (const cart of CARTS) {
    const rom = assemble(cart.source, { predefined: NOTES });
    assert.deepEqual(rom.errors, [], `${cart.id} failed to assemble`);
    assert.ok(rom.top <= 0x4000, `${cart.id} overflows cartridge space (0x${rom.top.toString(16)})`);
    const cpu = makeCPU(cart.source, { seed: 1 }).cpu;
    run(cpu, 8);
    assert.equal(cpu.halted, false, `${cart.id} halted unexpectedly`);
  }
  assert.ok(bios.symbols.get('COS') < BIOS.FONT);
});

test('BOOT wakes up, paints and plays', () => {
  const { cpu } = makeCPU(CARTS_BY_ID.boot.source, { seed: 2 });
  run(cpu, 40);
  let lit = 0;
  for (let i = 0; i < 160 * 120; i++) if (cpu.mem[VRAM_BASE + i]) lit++;
  assert.ok(lit > 500, `boot screen should have content (${lit} px)`);
  assert.ok(cpu.mem[MMIO.VOLUME] > 0, 'boot should raise the master volume');
  const freqHistory = new Set();
  for (let f = 0; f < 30; f++) {
    run(cpu, 1);
    freqHistory.add(cpu.mem[MMIO.CH0_FREQ]);
  }
  assert.ok(freqHistory.size >= 2, 'the boot chime should change notes');
});

test('SNAKE grows when it eats and dies at the wall', () => {
  const { cpu, rom } = makeCPU(CARTS_BY_ID.snake.source, { seed: 3 });
  const S = (name) => rom.symbols.get(name);
  run(cpu, 12);
  assert.equal(cpu.mem[S('S_ALIVE')], 1);
  for (let f = 0; f < 200; f++) {
    const hp = cpu.mem[S('S_HP')];
    const head = cpu.mem[hp - 1];
    if (cpu.mem[S('S_ALIVE')] && head % 20 < 18) cpu.mem[S('S_FOOD')] = (head + 1) % 280;
    cpu.input = 0;
    cpu.frame();
    if (cpu.mem[S('S_LEN')] >= 8) break;
  }
  assert.ok(cpu.mem[S('S_LEN')] >= 8, 'snake should grow to at least eight segments');
  assert.ok(cpu.mem[S('S_SCORE')] >= 40, 'eating should score');
  assert.ok(cpu.mem[S('S_SPEED')] < 10, 'the game should speed up');
  run(cpu, 400, () => PAD.UP);
  assert.equal(cpu.mem[S('S_ALIVE')], 0, 'steering up into the wall should kill');
  run(cpu, 20, () => PAD.A);
  assert.equal(cpu.mem[S('S_ALIVE')], 1, 'A should restart the game');
  assert.equal(cpu.mem[S('S_LEN')], 4, 'restart should rebuild the snake');
});

test('FIRE makes heat that fades upward', () => {
  const { cpu } = makeCPU(CARTS_BY_ID.fire.source, { seed: 4 });
  run(cpu, 60);
  let bottomHeat = 0;
  let topHeat = 0;
  for (let y = 110; y < 120; y++) for (let x = 0; x < 160; x++) bottomHeat += cpu.mem[VRAM_BASE + y * VRAM_W + x] > 7 ? 1 : 0;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 160; x++) topHeat += cpu.mem[VRAM_BASE + y * VRAM_W + x] > 7 ? 1 : 0;
  assert.ok(bottomHeat > 400, 'the bottom of the fire should be hot');
  assert.ok(topHeat < bottomHeat, 'heat should fade toward the top');
  assert.ok(cpu.cycles <= 204800, 'fire must fit in one frame of cycles');
});

test('LIFE advances a blinker correctly', () => {
  const { cpu, rom } = makeCPU(CARTS_BY_ID.life.source, { seed: 5 });
  run(cpu, 3);
  const SRC = rom.symbols.get('SRC');
  const STRIDE = rom.symbols.get('STRIDE');
  const clear = (buf) => { for (let i = 0; i < 42 * 55; i++) cpu.mem[buf + i] = 0; };
  clear(cpu.mem[SRC]);
  clear(cpu.mem[rom.symbols.get('DST')]);
  const put = (x, y) => { cpu.mem[cpu.mem[SRC] + y * STRIDE + x] = 1; };
  put(10, 10); put(10, 11); put(10, 12);
  cpu.mem[rom.symbols.get('ACC')] = 0;
  const gen0 = cpu.mem[rom.symbols.get('GEN')];
  for (let f = 0; f < 30 && cpu.mem[rom.symbols.get('GEN')] === gen0; f++) { cpu.input = 0; cpu.frame(); }
  const alive = [];
  for (let y = 9; y <= 13; y++) for (let x = 9; x <= 13; x++) if (cpu.mem[cpu.mem[SRC] + y * STRIDE + x]) alive.push(`${x},${y}`);
  assert.deepEqual(alive.sort(), ['10,10', '11,10', '9,10'], 'a vertical blinker becomes horizontal');
});

test('RIPPLE travels and cycles its palette', () => {
  const { cpu } = makeCPU(CARTS_BY_ID.ripple.source, { seed: 8 });
  run(cpu, 30);
  const indexes = new Set();
  for (let i = 0; i < 160 * 120; i++) indexes.add(cpu.mem[0x4000 + i]);
  assert.ok(indexes.size >= 8, `rings should use many palette entries (${indexes.size})`);
  const before = Array.from(cpu.palette).join(',');
  run(cpu, 10);
  const after = Array.from(cpu.palette).join(',');
  assert.notEqual(before, after, 'the palette should crawl between frames');
  assert.ok(cpu.cycles <= 204800, 'ripple must fit in one frame of cycles');
});

test('CHIPTUNE advances rows and drives all three channels', () => {
  const { cpu, rom } = makeCPU(CARTS_BY_ID.chiptune.source, { seed: 6 });
  run(cpu, 1);
  assert.equal(cpu.mem[MMIO.CH0_CTRL] & 1, 1, 'the lead channel should be on');
  assert.equal(cpu.mem[MMIO.CH1_CTRL] & 1, 1, 'the bass channel should be on');
  run(cpu, 7);
  assert.equal(cpu.mem[rom.symbols.get('ROW')], 1, 'the pattern should advance one row every six frames');
  for (let f = 0; f < 30; f++) run(cpu, 1);
  const rows = [];
  for (let f = 0; f < 24; f++) { run(cpu, 1); rows.push(cpu.mem[rom.symbols.get('ROW')]); }
  assert.ok(new Set(rows).size > 2, 'the row counter should keep moving');
  assert.ok(cpu.mem[rom.symbols.get('DV')] >= 0 && cpu.mem[MMIO.CH2_FREQ] > 0, 'drums should hit the noise channel');
});

test('CUBE projects exactly like the reference math', () => {
  const { cpu, rom } = makeCPU(CARTS_BY_ID.cube.source, { seed: 7 });
  run(cpu, 45);
  const a = cpu.mem[rom.symbols.get('ANG_A')];
  const b = cpu.mem[rom.symbols.get('ANG_B')];
  const verts = [
    [-200, -200, -200], [200, -200, -200], [-200, 200, -200], [200, 200, -200],
    [-200, -200, 200], [200, -200, 200], [-200, 200, 200], [200, 200, 200],
  ];
  const sinT = (i) => Math.round(Math.sin(((i & 255) / 256) * Math.PI * 2) * 256);
  const sA = sinT(a), cA = sinT(a + 64), sB = sinT(b), cB = sinT(b + 64);
  for (let i = 0; i < 8; i++) {
    const [x, y, z] = verts[i];
    const x1 = (x * cA - z * sA) >> 8;
    const z1 = (x * sA + z * cA) >> 8;
    const y2 = (y * cB - z1 * sB) >> 8;
    const z2 = (y * sB + z1 * cB) >> 8;
    const den = z2 + 768;
    const sx = 80 + Math.trunc((x1 * 96) / den);
    const sy = 60 + Math.trunc((y2 * 96) / den);
    assert.equal(cpu.mem[rom.symbols.get('SX') + i], sx, `vertex ${i} x`);
    assert.equal(cpu.mem[rom.symbols.get('SY') + i], sy, `vertex ${i} y`);
  }
});
