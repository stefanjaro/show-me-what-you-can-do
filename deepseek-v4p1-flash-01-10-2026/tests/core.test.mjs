import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, Volta, disassemble, OP, VRAM_BASE, MMIO } from '../js/volta.js';

function boot(src, opts = {}) {
  const rom = assemble(src);
  assert.equal(rom.errors.length, 0, JSON.stringify(rom.errors));
  const cpu = new Volta({ rom, ...opts });
  return { cpu, rom };
}

function runToHalt(cpu, maxFrames = 100) {
  for (let i = 0; i < maxFrames && !cpu.halted; i++) cpu.frame();
  return cpu;
}

test('arithmetic and immediates', () => {
  const { cpu } = boot(`
    LDI R0, 5
    LDI R1, 7
    ADD R0, R1
    STA 0x100, R0
    SUB R0, R1
    STA 0x101, R0
    LDI R2, 0xffff
    ADDI R2, 1
    STA 0x102, R2
    HLT
  `);
  runToHalt(cpu);
  assert.equal(cpu.mem[0x100], 12);
  assert.equal(cpu.mem[0x101], 5);
  assert.equal(cpu.mem[0x102], 0);
  assert.equal(cpu.z, 1);
  assert.equal(cpu.c, 1);
});

test('mul, div, mod, shifts', () => {
  const { cpu } = boot(`
    LDI R0, 1234
    LDI R1, 100
    MUL R0, R1
    STA 0x100, R0
    LDI R0, 1234
    DIV R0, R1
    STA 0x101, R0
    LDI R0, 1234
    MOD R0, R1
    STA 0x102, R0
    LDI R0, 1
    SHLI R0, 15
    STA 0x103, R0
    SHRI R0, 3
    STA 0x104, R0
    HLT
  `);
  runToHalt(cpu);
  assert.equal(cpu.mem[0x100], (1234 * 100) & 0xffff);
  assert.equal(cpu.mem[0x101], 12);
  assert.equal(cpu.mem[0x102], 34);
  assert.equal(cpu.mem[0x103], 0x8000);
  assert.equal(cpu.mem[0x104], 0x1000);
});

test('memory addressing', () => {
  const { cpu } = boot(`
    LDI R0, 0x200
    LDI R1, 42
    ST [R0], R1
    STO [R0+2], R1
    LD R2, [R0]
    STA 0x300, R2
    LDO R3, [R0+2]
    STA 0x301, R3
    LD R4, [0x300]
    STA 0x302, R4
    HLT
  `);
  runToHalt(cpu);
  assert.equal(cpu.mem[0x200], 42);
  assert.equal(cpu.mem[0x202], 42);
  assert.equal(cpu.mem[0x300], 42);
  assert.equal(cpu.mem[0x301], 42);
  assert.equal(cpu.mem[0x302], 42);
});

test('branches, calls, stack', () => {
  const { cpu } = boot(`
    LDI R7, 0
    LDI R0, 3
  loop:
    CALL double
    DEC R0
    JNE loop
    HLT
  double:
    ADD R7, R7
    ADDI R7, 1
    RET
  `);
  runToHalt(cpu);
  assert.equal(cpu.r[7], 7);
  assert.equal(cpu.sp, 0xffff);
});

test('signed and unsigned comparisons', () => {
  const { cpu } = boot(`
    LDI R0, 0xffff
    CMPI R0, 1
    JB below
    LDI R1, 1
    STA 0x100, R1
  below:
    HLT
  `);
  runToHalt(cpu);
  assert.equal(cpu.mem[0x100], 1, '0xFFFF is not unsigned-below 1');

  const { cpu: cpu2 } = boot(`
    LDI R0, 0xffff
    CMPI R0, 1
    JGE ok
    HLT
  ok:
    LDI R1, 2
    STA 0x100, R1
    HLT
  `);
  runToHalt(cpu2);
  assert.equal(cpu2.mem[0x100], 0, '-1 is not >= 1');
});

test('signed comparisons work for same-sign operands', () => {
  const { cpu } = boot(`
    LDI R0, 9
    CMPI R0, 15
    JL nine_less
    HLT
  nine_less:
    LDI R1, 1
    STA 0x100, R1
    LDI R2, 0xfff9       ; -7
    LDI R3, 0xfffa       ; -6
    CMP R2, R3
    JL neg_less
    HLT
  neg_less:
    LDI R4, 2
    STA 0x101, R4
    LDI R5, 15
    CMPI R5, 15
    JLE eq_ok
    HLT
  eq_ok:
    LDI R6, 3
    STA 0x102, R6
    LDI R7, 32767
    LDI R0, 0xffff       ; -1
    CMP R7, R0
    JL wrong
    LDI R0, 9
    STA 0x103, R0
    HLT
  wrong:
    HLT
  `);
  runToHalt(cpu);
  assert.equal(cpu.mem[0x100], 1, '9 < 15');
  assert.equal(cpu.mem[0x101], 2, '-7 < -6');
  assert.equal(cpu.mem[0x102], 3, '15 <= 15');
  assert.equal(cpu.mem[0x103], 9, '32767 is not less than -1');
});

test('directives and symbols', () => {
  const { cpu, rom } = boot(`
    .def COUNT 4
    .def START 0x100
    LDI R0, START
    LDI R1, COUNT
    ST [R0], R1
    LDI R2, message
    LD R3, [R2]
    STA 0x101, R3
    HLT
  message:
    .ascii "V"
  `);
  runToHalt(cpu);
  assert.equal(cpu.mem[0x100], 4);
  assert.equal(cpu.mem[0x101], 86);
  assert.equal(rom.symbols.get('MESSAGE'), 11);
});

test('mmio: input, rng, frame, palette', () => {
  const { cpu } = boot(`
    LD R0, [INPUT]
    STA 0x100, R0
    LD R1, [RNG]
    LD R2, [RNG]
    STA 0x101, R1
    STA 0x102, R2
    LDI R3, 15
    STA PAL_INDEX, R3
    LDI R4, 15
    STA PAL_R, R4
    LDI R5, 8
    STA PAL_G, R5
    HLT
  `);
  cpu.input = 0x2a;
  runToHalt(cpu);
  assert.equal(cpu.mem[0x100], 0x2a);
  assert.notEqual(cpu.mem[0x101], cpu.mem[0x102]);
  assert.equal(cpu.palette[45], 255);
  assert.equal(cpu.palette[46], 136);
});

test('frame budget stops runaway programs', () => {
  const { cpu } = boot(`
  loop:
    JMP loop
  `);
  const cycles = cpu.frame();
  assert.ok(cycles >= 200000);
  assert.equal(cpu.halted, false);
});

test('wait halts until next frame', () => {
  const { cpu } = boot(`
    LDI R0, 1
    STA 0x100, R0
    WAIT
    LDI R0, 2
    STA 0x101, R0
    HLT
  `);
  cpu.frame();
  assert.equal(cpu.mem[0x100], 1);
  assert.equal(cpu.mem[0x101], 0);
  cpu.frame();
  assert.equal(cpu.mem[0x101], 2);
});

test('disassembler round-trips encodings', () => {
  const src = `
    LDI R1, 0x1234
    LDO R2, [R3+7]
    ADD R1, R2
    STA 0x200, R1
    JNE 0x30
    WAIT
  `;
  const rom = assemble(src);
  const listing = disassemble(rom.words, 0, 10, rom.symbols);
  const text = listing.map((l) => l.text).join('\n');
  assert.match(text, /LDI R1, 0x1234/);
  assert.match(text, /LDO R2, \[R3\+0x0007\]/);
  assert.match(text, /ADD R1, R2/);
  assert.match(text, /STA 0x0200, R1/);
  assert.match(text, /JNE 0x0030/);
  assert.match(text, /WAIT/);
});

test('assembler reports friendly errors', () => {
  const bad = assemble(`
    ADDI R0, 40
    LDI R1
    FOO R2, R3
    JMP nowhere
  `);
  assert.ok(bad.errors.length >= 3);
  const messages = bad.errors.map((e) => e.message).join('\n');
  assert.match(messages, /0–31/);
  assert.match(messages, /operand/);
  assert.match(messages, /unknown instruction/);
  assert.match(messages, /unknown symbol/);
});

test('vram writes land where they should', () => {
  const { cpu } = boot(`
    LDI R0, 7
    STA VRAM, R0
    LDI R1, VRAM+19199
    ST [R1], R0
    HLT
  `);
  runToHalt(cpu);
  assert.equal(cpu.mem[VRAM_BASE], 7);
  assert.equal(cpu.mem[VRAM_BASE + 19199], 7);
});
