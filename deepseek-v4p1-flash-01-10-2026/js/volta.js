/*
 * VOLTA-16 — a computer that never existed.
 *
 * This file is the machine itself: an ISA, an assembler, a disassembler and
 * a CPU emulator. No dependencies, no build step. Everything is 16 bits wide.
 */

export const MEM_SIZE = 0x10000;
export const WORD_MASK = 0xffff;

export const VRAM_BASE = 0x4000;
export const VRAM_W = 160;
export const VRAM_H = 120;
export const VRAM_WORDS = VRAM_W * VRAM_H;
export const VRAM_END = VRAM_BASE + VRAM_WORDS;
export const CART_BASE = 0x0000;
export const CART_END = 0x4000;
export const RAM_BASE = VRAM_END;
export const RAM_END = 0xe000;
export const MMIO_BASE = 0xe000;
export const MMIO_END = 0xe100;
export const BIOS_BASE = 0xf000;
export const STACK_TOP = 0xffff;
export const FRAME_CYCLES = 204800;
export const CPU_HZ = 12288000;

export const MMIO = Object.freeze({
  PAL_INDEX: 0xe000,
  PAL_R: 0xe001,
  PAL_G: 0xe002,
  PAL_B: 0xe003,
  FILL_COLOR: 0xe004,
  FILL_LEN: 0xe005,
  FILL_START: 0xe006,
  INPUT: 0xe010,
  RNG: 0xe012,
  FRAME: 0xe013,
  CH0_FREQ: 0xe020,
  CH0_CTRL: 0xe021,
  CH1_FREQ: 0xe022,
  CH1_CTRL: 0xe023,
  CH2_FREQ: 0xe024,
  CH2_CTRL: 0xe025,
  VOLUME: 0xe026,
  INVERT: 0xe030,
});

export const PAD = Object.freeze({
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  A: 16,
  B: 32,
  START: 64,
  SELECT: 128,
});

export const BIOS = Object.freeze({
  CLR: 0xf000,
  PIXEL: 0xf002,
  RECT: 0xf004,
  HLINE: 0xf006,
  CHAR: 0xf008,
  PRINT: 0xf00a,
  NUM: 0xf00c,
  SIN: 0xf00e,
  COS: 0xf010,
  CHAR2: 0xf012,
  FONT: 0xf300,
  SINTAB: 0xf600,
  SCRATCH: 0xf7f0,
});

export const OP = Object.freeze({
  HLT: 0x00, NOP: 0x01, MOV: 0x02, LDI: 0x03, ADD: 0x04, SUB: 0x05, AND: 0x06, OR: 0x07,
  XOR: 0x08, SHL: 0x09, SHR: 0x0a, SAR: 0x0b, MUL: 0x0c, DIV: 0x0d, MOD: 0x0e, INC: 0x0f,
  DEC: 0x10, NEG: 0x11, NOT: 0x12, ADDI: 0x13, SUBI: 0x14, SHLI: 0x15, SHRI: 0x16, CMP: 0x17,
  CMPI: 0x18, LD: 0x19, LDO: 0x1a, ST: 0x1b, STO: 0x1c, LDB: 0x1d, STB: 0x1e, PUSH: 0x1f,
  POP: 0x20, JMP: 0x21, JE: 0x22, JNE: 0x23, JL: 0x24, JLE: 0x25, JG: 0x26, JGE: 0x27,
  JB: 0x28, JAE: 0x29, CALL: 0x2a, RET: 0x2b, DJNZ: 0x2c, WAIT: 0x2d, LEA: 0x2e, LDA: 0x30,
  STA: 0x31,
});

/* form: how operands are spelled; size: words per instruction. */
export const OPS = [
  { name: 'HLT', form: 'none', cost: 1 },
  { name: 'NOP', form: 'none', cost: 1 },
  { name: 'MOV', form: 'rr', cost: 1 },
  { name: 'LDI', form: 'ri', cost: 2 },
  { name: 'ADD', form: 'rr', cost: 1 },
  { name: 'SUB', form: 'rr', cost: 1 },
  { name: 'AND', form: 'rr', cost: 1 },
  { name: 'OR', form: 'rr', cost: 1 },
  { name: 'XOR', form: 'rr', cost: 1 },
  { name: 'SHL', form: 'rr', cost: 1 },
  { name: 'SHR', form: 'rr', cost: 1 },
  { name: 'SAR', form: 'rr', cost: 1 },
  { name: 'MUL', form: 'rr', cost: 3 },
  { name: 'DIV', form: 'rr', cost: 8 },
  { name: 'MOD', form: 'rr', cost: 8 },
  { name: 'INC', form: 'r', cost: 1 },
  { name: 'DEC', form: 'r', cost: 1 },
  { name: 'NEG', form: 'r', cost: 1 },
  { name: 'NOT', form: 'r', cost: 1 },
  { name: 'ADDI', form: 'rk', cost: 1 },
  { name: 'SUBI', form: 'rk', cost: 1 },
  { name: 'SHLI', form: 'rk', cost: 1 },
  { name: 'SHRI', form: 'rk', cost: 1 },
  { name: 'CMP', form: 'rr', cost: 1 },
  { name: 'CMPI', form: 'rk', cost: 1 },
  { name: 'LD', form: 'rm', cost: 2 },
  { name: 'LDO', form: 'rmo', cost: 2 },
  { name: 'ST', form: 'mr', cost: 2 },
  { name: 'STO', form: 'mro', cost: 2 },
  { name: 'LDB', form: 'rm', cost: 2 },
  { name: 'STB', form: 'mr', cost: 2 },
  { name: 'PUSH', form: 'r', cost: 2 },
  { name: 'POP', form: 'r', cost: 2 },
  { name: 'JMP', form: 'j', cost: 2 },
  { name: 'JE', form: 'j', cost: 2 },
  { name: 'JNE', form: 'j', cost: 2 },
  { name: 'JL', form: 'j', cost: 2 },
  { name: 'JLE', form: 'j', cost: 2 },
  { name: 'JG', form: 'j', cost: 2 },
  { name: 'JGE', form: 'j', cost: 2 },
  { name: 'JB', form: 'j', cost: 2 },
  { name: 'JAE', form: 'j', cost: 2 },
  { name: 'CALL', form: 'j', cost: 3 },
  { name: 'RET', form: 'none', cost: 3 },
  { name: 'DJNZ', form: 'rj', cost: 2 },
  { name: 'WAIT', form: 'none', cost: 1 },
  { name: 'LEA', form: 'lea', cost: 2 },
  undefined,
  { name: 'LDA', form: 'ra', cost: 2 },
  { name: 'STA', form: 'ar', cost: 2 },
];

const OP_BY_NAME = Object.create(null);
for (let i = 0; i < OPS.length; i++) if (OPS[i]) OP_BY_NAME[OPS[i].name] = i;

const TWO_WORD_FORMS = new Set(['ri', 'rmo', 'mro', 'ra', 'ar', 'j', 'rj', 'lea']);
const instrSize = (info) => (TWO_WORD_FORMS.has(info.form) ? 2 : 1);

export const DEFAULT_PALETTE = Uint8Array.from([
  0x0b, 0x0d, 0x10, /*  0 ink       */ 0xf2, 0xee, 0xe2, /*  1 bone      */
  0xe0, 0x60, 0x2c, /*  2 vermilion */ 0xf2, 0xb5, 0x3c, /*  3 amber     */
  0x6f, 0xae, 0x4e, /*  4 moss      */ 0x2f, 0x9e, 0x8f, /*  5 teal      */
  0x3f, 0x7f, 0xd4, /*  6 cobalt    */ 0x8a, 0x6f, 0xd1, /*  7 violet    */
  0xd1, 0x5a, 0x8a, /*  8 rose      */ 0x8a, 0x8f, 0x98, /*  9 grey      */
  0x4a, 0x4f, 0x58, /* 10 dim grey  */ 0x2a, 0x2e, 0x36, /* 11 slate     */
  0x16, 0x6b, 0x5f, /* 12 deep teal */ 0x7a, 0x4a, 0x12, /* 13 umber     */
  0xc9, 0xc2, 0xb0, /* 14 sand      */ 0xff, 0xff, 0xff, /* 15 pure white*/
]);

export const PREDEFINED = Object.freeze({
  VRAM: VRAM_BASE,
  VRAM_W,
  VRAM_H,
  VRAM_END,
  RAM: RAM_BASE,
  RAM_END,
  STACK_TOP,
  TRUE: 1,
  FALSE: 0,
  ...MMIO,
  ...Object.fromEntries(Object.entries(BIOS).map(([k, v]) => [`BIOS_${k}`, v])),
  PAD_LEFT: PAD.LEFT,
  PAD_RIGHT: PAD.RIGHT,
  PAD_UP: PAD.UP,
  PAD_DOWN: PAD.DOWN,
  PAD_A: PAD.A,
  PAD_B: PAD.B,
  PAD_START: PAD.START,
  PAD_SELECT: PAD.SELECT,
});

/* ── expressions ─────────────────────────────────────────────────────── */

class ExprError extends Error {}

function plainNumber(text, line) {
  const t = text.replace(/_/g, '');
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16);
  if (/^0b[01]+$/i.test(t)) return parseInt(t.slice(2), 2);
  if (/^%[01]+$/.test(t)) return parseInt(t.slice(1), 2);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return null;
}

function parseEval(text, resolve) {
  let i = 0;
  const s = text;
  const fail = (msg) => { throw new ExprError(msg); };

  function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
  function peekOp(ops) { for (const op of ops) if (s.startsWith(op, i)) return op; return null; }

  function atom() {
    ws();
    if (i >= s.length) fail('expected a value');
    const c = s[i];
    if (c === '(') {
      i++;
      const v = orExpr();
      ws();
      if (s[i] !== ')') fail('missing ")"');
      i++;
      return v;
    }
    if (c === '\'') {
      i++;
      let v;
      if (s[i] === '\\') {
        i++;
        const e = s[i++];
        v = e === 'n' ? 10 : e === '0' ? 0 : e === 't' ? 9 : e === 'r' ? 13 : e.charCodeAt(0);
      } else if (i >= s.length) {
        fail('unterminated character literal');
      } else {
        v = s.charCodeAt(i++);
      }
      if (s[i] !== '\'') fail('unterminated character literal');
      i++;
      return v;
    }
    const num = /^(0x[0-9a-f_]+|\$[0-9a-f_]+|0b[01_]+|%[01_]+|[0-9][0-9_]*)/i.exec(s.slice(i));
    if (num) {
      const v = plainNumber(num[1], 0);
      if (v === null) fail(`bad number "${num[1]}"`);
      i += num[1].length;
      return v;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const v = resolve(id[0]);
      if (v === undefined) fail(`unknown symbol "${id[0]}"`);
      return v;
    }
    fail(`unexpected "${s.slice(i, i + 12)}"`);
  }

  function unary() {
    ws();
    if (s[i] === '-') { i++; return (-unary()) & WORD_MASK; }
    if (s[i] === '+') { i++; return unary(); }
    if (s[i] === '~') { i++; return (~unary()) & WORD_MASK; }
    return atom();
  }
  function mul() {
    let v = unary();
    for (;;) {
      ws();
      const op = peekOp(['*', '/', '%']);
      if (!op) return v;
      i += 1;
      const r = unary();
      if (op === '*') v = (v * r) & WORD_MASK;
      else if (r === 0) fail('division by zero');
      else if (op === '/') v = Math.floor(v / r) & WORD_MASK;
      else v = (v % r) & WORD_MASK;
    }
  }
  function add() {
    let v = mul();
    for (;;) {
      ws();
      const op = peekOp(['+', '-']);
      if (!op) return v;
      i += 1;
      const r = mul();
      v = op === '+' ? (v + r) & WORD_MASK : (v - r) & WORD_MASK;
    }
  }
  function shift() {
    let v = add();
    for (;;) {
      ws();
      const op = peekOp(['<<', '>>']);
      if (!op) return v;
      i += 2;
      const r = add();
      v = op === '<<' ? (v << r) & WORD_MASK : (v >> r) & WORD_MASK;
    }
  }
  function andExpr() {
    let v = shift();
    for (;;) {
      ws();
      if (s[i] !== '&' || s[i + 1] === '&') return v;
      i++;
      v = (v & shift()) & WORD_MASK;
    }
  }
  function xorExpr() {
    let v = andExpr();
    for (;;) {
      ws();
      if (s[i] !== '^') return v;
      i++;
      v = (v ^ andExpr()) & WORD_MASK;
    }
  }
  function orExpr() {
    let v = xorExpr();
    for (;;) {
      ws();
      if (s[i] !== '|' || s[i + 1] === '|') return v;
      i++;
      v = (v | xorExpr()) & WORD_MASK;
    }
  }

  const value = orExpr();
  ws();
  if (i !== s.length) fail(`unexpected "${s.slice(i, i + 12)}"`);
  return value;
}

/* ── assembler ───────────────────────────────────────────────────────── */

function stripComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inString = !inString;
    else if (!inString) {
      if (c === ';') return line.slice(0, i);
      if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
  }
  return line;
}

function splitOperands(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  let inString = false;
  for (const c of text) {
    if (c === '"') inString = !inString;
    if (!inString) {
      if (c === '[' || c === '(') depth++;
      if (c === ']' || c === ')') depth--;
      if (c === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += c;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

const regRe = /^r([0-7])$/i;

function parseReg(text) {
  const m = regRe.exec(text);
  return m ? Number(m[1]) : null;
}

function parseMem(text) {
  const m = /^\[\s*(.*?)\s*\]$/.exec(text);
  if (!m) return null;
  const inner = m[1];
  const indexed = /^r([0-7])\s*(?:([+-])\s*(.+))?$/i.exec(inner);
  if (indexed) {
    return { kind: 'indexed', reg: Number(indexed[1]), sign: indexed[2] || '+', expr: (indexed[3] || '0').trim() };
  }
  return { kind: 'absolute', expr: inner };
}

function resolveInstruction(mnemonic, operands) {
  const op = OP_BY_NAME[mnemonic];
  if (op === undefined) return { error: `unknown instruction "${mnemonic}"` };
  const info = OPS[op];
  const form = info.form;
  const arity = { none: 0, r: 1, rr: 2, rk: 2, ri: 2, rm: 2, rmo: 2, mr: 2, mro: 2, ra: 2, ar: 2, j: 1, rj: 2, lea: 2 }[form];
  if (operands.length !== arity) {
    return { error: `${info.name} takes ${arity} operand${arity === 1 ? '' : 's'}, got ${operands.length}` };
  }
  const out = { op, size: instrSize(info) };
  const r0 = operands[0] ? parseReg(operands[0]) : null;
  const r1 = operands[1] ? parseReg(operands[1]) : null;
  switch (form) {
    case 'none':
      break;
    case 'r':
      if (r0 === null) return { error: `${info.name} expects a register (R0–R7)` };
      out.a = r0;
      break;
    case 'rr':
      if (r0 === null || r1 === null) return { error: `${info.name} expects two registers` };
      out.a = r0; out.b = r1;
      break;
    case 'rk':
      if (r0 === null) return { error: `${info.name} expects a register first` };
      out.a = r0; out.expr = operands[1];
      break;
    case 'ri':
      if (r0 === null) return { error: `${info.name} expects a register first` };
      out.a = r0; out.expr = operands[1];
      break;
    case 'rm':
    case 'mr': {
      const mem = parseMem(form === 'rm' ? operands[1] : operands[0]);
      if (!mem) return { error: `${info.name} expects [Rn] memory syntax; use ${form === 'rm' ? 'LDO' : 'STO'} with an offset for [Rn+imm]` };
      if (mem.kind === 'absolute') {
        if (form === 'rm') {
          if (r0 === null) return { error: `${info.name} expects a register first` };
          out.op = OP.LDA;
          out.size = 2;
          out.a = r0;
          out.expr = mem.expr;
        } else {
          if (r1 === null) return { error: `${info.name} expects a register after the address` };
          out.op = OP.STA;
          out.size = 2;
          out.a = r1;
          out.expr = mem.expr;
        }
        break;
      }
      if (form === 'rm') { if (r0 === null) return { error: `${info.name} expects a register first` }; out.a = r0; out.b = mem.reg; }
      else { if (r1 === null) return { error: `${info.name} expects a register after the address` }; out.a = mem.reg; out.b = r1; }
      break;
    }
    case 'rmo':
    case 'mro': {
      const mem = parseMem(form === 'rmo' ? operands[1] : operands[0]);
      if (!mem || mem.kind !== 'indexed') return { error: `${info.name} expects [Rn+imm]` };
      if (form === 'rmo') { if (r0 === null) return { error: `${info.name} expects a register first` }; out.a = r0; out.b = mem.reg; }
      else { if (r1 === null) return { error: `${info.name} expects a register after the address` }; out.a = mem.reg; out.b = r1; }
      out.expr = `${mem.sign === '-' ? '-' : ''}(${mem.expr})`;
      break;
    }
    case 'ra': {
      if (r0 === null) return { error: `${info.name} expects a register first` };
      const mem = parseMem(operands[1]);
      out.a = r0;
      out.expr = mem ? mem.expr : operands[1];
      if (mem && mem.kind === 'indexed') return { error: `LDA takes an absolute address; use LDO for [Rn+imm]` };
      break;
    }
    case 'ar': {
      if (r1 === null) return { error: `${info.name} expects a register after the address` };
      const mem = parseMem(operands[0]);
      out.a = r1;
      out.expr = mem ? mem.expr : operands[0];
      if (mem && mem.kind === 'indexed') return { error: `STA takes an absolute address; use STO for [Rn+imm]` };
      break;
    }
    case 'j':
      out.expr = operands[0];
      break;
    case 'rj':
      if (r0 === null) return { error: `${info.name} expects a register first` };
      out.a = r0; out.expr = operands[1];
      break;
    case 'lea': {
      if (r0 === null) return { error: 'LEA expects a register first' };
      const mem = parseMem(operands[1]);
      if (!mem || mem.kind !== 'indexed') return { error: 'LEA expects [Rn+imm]' };
      out.a = r0; out.b = mem.reg;
      out.expr = `${mem.sign === '-' ? '-' : ''}(${mem.expr})`;
      break;
    }
    default:
      return { error: `internal: unhandled form ${form}` };
  }
  return out;
}

function evalWith(text, symbols, line, errors) {
  try {
    return parseEval(text, (name) => {
      const key = name.toUpperCase();
      if (symbols.has(key)) return symbols.get(key);
      return undefined;
    });
  } catch (e) {
    errors.push({ line, message: e instanceof ExprError ? e.message : String(e) });
    return 0;
  }
}

function parseStringLiteral(text, line, errors) {
  const m = /^"(.*)"$/.exec(text.trim());
  if (!m) {
    errors.push({ line, message: 'expected a "string"' });
    return '';
  }
  let out = '';
  const raw = m[1];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const e = raw[++i];
      out += e === 'n' ? '\n' : e === 't' ? '\t' : e === '0' ? '\0' : e;
    } else out += raw[i];
  }
  return out;
}

export function assemble(source, options = {}) {
  const symbols = new Map();
  const predefined = { ...PREDEFINED, ...(options.predefined || {}) };
  for (const [k, v] of Object.entries(predefined)) symbols.set(k.toUpperCase(), v & WORD_MASK);
  const errors = [];
  const listing = [];
  const nodes = [];
  const lines = source.split(/\r?\n/);

  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    let text = stripComment(raw).trim();
    if (!text) continue;
    let label = null;
    const lm = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(text);
    if (lm) {
      label = lm[1];
      text = lm[2].trim();
    }
    if (!text) {
      nodes.push({ line: ln + 1, label, kind: 'empty', text: raw.trim() });
      continue;
    }
    if (text.startsWith('.')) {
      const dm = /^\.([A-Za-z]+)\s*(.*)$/.exec(text);
      if (!dm) {
        errors.push({ line: ln + 1, message: `bad directive "${text}"` });
        continue;
      }
      nodes.push({ line: ln + 1, label, kind: 'directive', name: dm[1].toLowerCase(), args: dm[2].trim(), text: raw.trim() });
      continue;
    }
    const im = /^([A-Za-z]+)\s*(.*)$/.exec(text);
    if (!im) {
      errors.push({ line: ln + 1, message: `cannot parse "${text}"` });
      continue;
    }
    const mnemonic = im[1].toUpperCase();
    const operands = im[2].trim() === '' ? [] : splitOperands(im[2]);
    nodes.push({ line: ln + 1, label, kind: 'instr', mnemonic, operands, text: raw.trim() });
  }

  /* pass 1 — lay out the program, define labels and constants */
  let pc = 0;
  let top = 0;
  const defined = [];
  const predefKeys = new Set(Object.keys(predefined).map((k) => k.toUpperCase()));
  const setSymbol = (name, value, node, what) => {
    const key = name.toUpperCase();
    if (symbols.has(key) && !predefKeys.has(key)) {
      if (symbols.get(key) !== (value & WORD_MASK)) {
        errors.push({ line: node.line, message: `${what} "${name}" is already defined (value 0x${symbols.get(key).toString(16)})` });
      }
      return;
    }
    predefKeys.delete(key);
    symbols.set(key, value & WORD_MASK);
    defined.push(key);
  };

  for (const node of nodes) {
    if (node.label) setSymbol(node.label, pc, node, 'label');
    if (node.kind === 'empty') continue;
    if (node.kind === 'instr') {
      const r = resolveInstruction(node.mnemonic, node.operands);
      if (r.error) { errors.push({ line: node.line, message: r.error }); continue; }
      node.resolve = r;
      pc += r.size;
      if (pc > top) top = pc;
      continue;
    }
    switch (node.name) {
      case 'org': {
        const v = evalWith(node.args, symbols, node.line, errors);
        pc = v;
        if (pc > top) top = pc;
        break;
      }
      case 'def': {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(node.args);
        if (!m) { errors.push({ line: node.line, message: '.def expects a name and a value' }); break; }
        const v = evalWith(m[2], symbols, node.line, errors);
        setSymbol(m[1], v, node, 'constant');
        break;
      }
      case 'word': {
        const count = node.args === '' ? 0 : splitOperands(node.args).length;
        node.size = count;
        pc += count;
        if (pc > top) top = pc;
        break;
      }
      case 'ascii':
      case 'asciiz': {
        const str = parseStringLiteral(node.args, node.line, errors);
        node.size = str.length + (node.name === 'asciiz' ? 1 : 0);
        pc += node.size;
        if (pc > top) top = pc;
        break;
      }
      case 'space':
      case 'fill': {
        const args = splitOperands(node.args);
        const count = evalWith(args[0] || '0', symbols, node.line, errors);
        node.size = count;
        pc += count;
        if (pc > top) top = pc;
        break;
      }
      default:
        errors.push({ line: node.line, message: `unknown directive ".${node.name}"` });
    }
  }

  /* pass 2 — emit */
  const image = new Map();
  pc = 0;
  let lastLine = 0;
  const emit = (addr, word) => {
    const a = addr & WORD_MASK;
    const w = word & WORD_MASK;
    if (image.has(a) && image.get(a) !== w) {
      errors.push({
        line: lastLine,
        message: `this writes over code or data already emitted at 0x${a.toString(16).toUpperCase()} — check .org and .space sizes`,
      });
    }
    image.set(a, w);
  };
  const encoded = (op, a = 0, b = 0) => ((op << 10) | ((a & 31) << 5) | (b & 31)) & WORD_MASK;

  const erroredBefore = errors.length;
  for (const node of nodes) {
    lastLine = node.line;
    if (node.label) pc = symbols.get(node.label.toUpperCase());
    if (node.kind === 'empty') continue;
    if (node.kind === 'instr') {
      const r = node.resolve;
      if (!r) continue;
      const info = OPS[r.op];
      const size = instrSize(info);
      const exprValue = r.expr !== undefined ? evalWith(r.expr, symbols, node.line, errors) : 0;
      if (info.form === 'rk') {
        const k = exprValue;
        if (r.op === OP.SHLI || r.op === OP.SHRI) {
          if (k > 15) errors.push({ line: node.line, message: `${info.name} shift must be 0–15; use a register shift for larger amounts` });
        } else if (k > 31) {
          errors.push({ line: node.line, message: `${info.name} takes 0–31; use LDI + ADD for larger values` });
        }
        emit(pc, encoded(r.op, r.a, k));
      } else if (TWO_WORD_FORMS.has(info.form)) {
        emit(pc, encoded(r.op, r.a, r.b || 0));
        emit(pc + 1, exprValue);
      } else {
        emit(pc, encoded(r.op, r.a, r.b));
      }
      listing.push({ addr: pc, size, line: node.line, text: node.text });
      pc += size;
      continue;
    }
    switch (node.name) {
      case 'org':
        pc = evalWith(node.args, symbols, node.line, errors);
        break;
      case 'def':
        break;
      case 'word': {
        for (const part of splitOperands(node.args)) {
          emit(pc++, evalWith(part, symbols, node.line, errors));
        }
        break;
      }
      case 'ascii':
      case 'asciiz': {
        const str = parseStringLiteral(node.args, node.line, errors);
        for (const ch of str) emit(pc++, ch.charCodeAt(0));
        if (node.name === 'asciiz') emit(pc++, 0);
        break;
      }
      case 'space':
      case 'fill': {
        const args = splitOperands(node.args);
        const count = evalWith(args[0] || '0', symbols, node.line, errors);
        const value = args[1] !== undefined ? evalWith(args[1], symbols, node.line, errors) : 0;
        for (let k = 0; k < count; k++) emit(pc++, value);
        break;
      }
      default:
        break;
    }
  }

  const ok = errors.length === 0;
  let maxAddr = 0;
  for (const addr of image.keys()) if (addr >= maxAddr) maxAddr = addr;
  const imageSize = image.size === 0 ? 0 : maxAddr + 1;
  const words = new Uint16Array(imageSize);
  for (const [addr, word] of image) words[addr] = word;
  const bytes = [];
  for (let a = 0; a < imageSize; a++) bytes.push(image.get(a) || 0);

  return {
    ok,
    errors,
    symbols,
    listing,
    words,
    base: 0,
    top: imageSize,
    bytes,
    origin: 0,
  };
}

/* ── disassembler ────────────────────────────────────────────────────── */

export function hex(n, width = 4) {
  return '0x' + (n & WORD_MASK).toString(16).toUpperCase().padStart(width, '0');
}

export function makeReverseSymbols(symbols) {
  const rev = new Map();
  if (!symbols) return rev;
  for (const [name, value] of symbols) {
    if (value < 0x100) continue;
    rev.set(value, name);
  }
  return rev;
}

function operandText(form, a, b, expr, rev) {
  const label = (v) => (rev && rev.has(v) ? rev.get(v) : hex(v));
  switch (form) {
    case 'none': return '';
    case 'r': return `R${a}`;
    case 'rr': return `R${a}, R${b}`;
    case 'rk': return `R${a}, ${b}`;
    case 'ri': return `R${a}, ${expr !== undefined ? expr : hex(b)}`;
    case 'rm': return `R${a}, [R${b}]`;
    case 'rmo': return `R${a}, [R${b}+${expr !== undefined ? expr : ''}]`;
    case 'mr': return `[R${a}], R${b}`;
    case 'mro': return `[R${a}+${expr !== undefined ? expr : ''}], R${b}`;
    case 'ra': return `R${a}, ${expr !== undefined ? expr : ''}`;
    case 'ar': return `${expr !== undefined ? expr : ''}, R${a}`;
    case 'j': return expr !== undefined ? expr : '';
    case 'rj': return `R${a}, ${expr !== undefined ? expr : ''}`;
    case 'lea': return `R${a}, [R${b}+${expr !== undefined ? expr : ''}]`;
    default: return '';
  }
}

export function disassemble(mem, addr, count, symbols) {
  const rev = makeReverseSymbols(symbols);
  const out = [];
  let pc = addr & WORD_MASK;
  for (let i = 0; i < count && pc < MEM_SIZE; i++) {
    const raw = mem[pc];
    const op = (raw >> 10) & 0x3f;
    const a = (raw >> 5) & 31;
    const b = raw & 31;
    const info = OPS[op];
    if (!info) {
      out.push({ addr: pc, size: 1, text: `.word ${hex(raw)}`, words: [raw] });
      pc++;
      continue;
    }
    const words = [raw];
    if (instrSize(info) === 2 && pc + 1 < MEM_SIZE) {
      const imm = mem[pc + 1];
      words.push(imm);
      let text;
      if (info.form === 'ri' || info.form === 'ra' || info.form === 'ar' || info.form === 'j' || info.form === 'rj' || info.form === 'rmo' || info.form === 'mro' || info.form === 'lea') {
        const label = rev.has(imm) ? rev.get(imm) : hex(imm);
        if (info.form === 'ri' || info.form === 'ra' || info.form === 'ar') text = `${info.name} ${operandText(info.form, a, b, label, rev)}`;
        else text = `${info.name} ${operandText(info.form, a, b, label, rev)}`;
      } else {
        text = `${info.name} ${operandText(info.form, a, b, hex(imm), rev)}`;
      }
      out.push({ addr: pc, size: 2, text, words });
      pc += 2;
    } else {
      out.push({ addr: pc, size: 1, text: `${info.name} ${operandText(info.form, a, b, undefined, rev)}`.trim(), words });
      pc++;
    }
  }
  return out;
}

/* ── the machine ─────────────────────────────────────────────────────── */

export class Volta {
  constructor({ rom, bios, seed } = {}) {
    this.mem = new Uint16Array(MEM_SIZE);
    this.palette = new Uint8Array(DEFAULT_PALETTE);
    this.reset();
    if (bios) this.mem.set(bios.words.subarray(0, Math.min(bios.words.length, MEM_SIZE - bios.base)), bios.base);
    if (rom) this.mem.set(rom.words.subarray(0, Math.min(rom.words.length, MEM_SIZE - rom.base)), rom.base);
    this.rngState = (seed === undefined ? (Date.now() ^ (Math.random() * 0xffff)) : seed) & WORD_MASK || 1;
  }

  reset() {
    this.r = new Uint16Array(8);
    this.pc = 0;
    this.sp = STACK_TOP;
    this.z = 1;
    this.c = 0;
    this.n = 0;
    this.v = 0;
    this.halted = false;
    this.waiting = false;
    this.cycles = 0;
    this.frameCount = 0;
    this.input = 0;
    this.palIndex = 0;
    this.palR = 0;
    this.palG = 0;
    this.palB = 0;
  }

  rng() {
    let x = this.rngState & WORD_MASK;
    if (x === 0) x = 1;
    x ^= (x << 7) & WORD_MASK;
    x ^= x >> 9;
    x ^= (x << 8) & WORD_MASK;
    this.rngState = x & WORD_MASK;
    return this.rngState;
  }

  peek(addr) {
    addr &= WORD_MASK;
    if (addr >= MMIO_BASE && addr < MMIO_END) {
      switch (addr) {
        case MMIO.INPUT: return this.input & 0xff;
        case MMIO.RNG: return this.rng();
        case MMIO.FRAME: return this.frameCount & WORD_MASK;
        default: break;
      }
    }
    return this.mem[addr];
  }

  poke(addr, value) {
    addr &= WORD_MASK;
    value &= WORD_MASK;
    this.mem[addr] = value;
    if (addr >= MMIO_BASE && addr < MMIO_END) {
      switch (addr) {
        case MMIO.PAL_INDEX: this.palIndex = value & 15; break;
        case MMIO.PAL_R: {
          this.palR = value & 15;
          this.palette[this.palIndex * 3] = this.palR * 17;
          break;
        }
        case MMIO.PAL_G: {
          this.palG = value & 15;
          this.palette[this.palIndex * 3 + 1] = this.palG * 17;
          break;
        }
        case MMIO.PAL_B: {
          this.palB = value & 15;
          this.palette[this.palIndex * 3 + 2] = this.palB * 17;
          break;
        }
        case MMIO.RNG: this.rngState = value || 1; break;
        case MMIO.FILL_START: {
          const len = this.mem[MMIO.FILL_LEN];
          const color = this.mem[MMIO.FILL_COLOR];
          for (let i = 0; i < len; i++) this.mem[(value + i) & WORD_MASK] = color;
          break;
        }
        default: break;
      }
    }
  }

  readReg(i) { return this.r[i] & WORD_MASK; }
  writeReg(i, v) { this.r[i] = v & WORD_MASK; }

  /* execute a single instruction; returns cycles spent */
  step() {
    const mem = this.mem;
    const raw = mem[this.pc];
    this.pc = (this.pc + 1) & WORD_MASK;
    const op = (raw >> 10) & 0x3f;
    const a = (raw >> 5) & 31;
    const b = raw & 31;
    const r = this.r;
    switch (op) {
      case OP.HLT:
        this.halted = true;
        return 1;
      case OP.NOP:
        return 1;
      case OP.MOV:
        r[a] = r[b];
        return 1;
      case OP.LDI: {
        r[a] = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      }
      case OP.ADD: {
        const t = r[a] + r[b];
        const res = t & WORD_MASK;
        this.z = res === 0 ? 1 : 0;
        this.c = t > WORD_MASK ? 1 : 0;
        this.n = res >> 15;
        this.v = ((r[a] ^ res) & (r[b] ^ res) & 0x8000) ? 1 : 0;
        r[a] = res;
        return 1;
      }
      case OP.SUB: {
        const t = r[a] - r[b];
        const res = t & WORD_MASK;
        this.z = res === 0 ? 1 : 0;
        this.c = t < 0 ? 1 : 0;
        this.n = res >> 15;
        this.v = ((r[a] ^ r[b]) & (r[a] ^ res) & 0x8000) ? 1 : 0;
        r[a] = res;
        return 1;
      }
      case OP.AND: {
        const t = r[a] & r[b];
        this.z = t === 0 ? 1 : 0;
        this.n = t >> 15;
        this.v = 0;
        r[a] = t;
        return 1;
      }
      case OP.OR: {
        const t = r[a] | r[b];
        this.z = t === 0 ? 1 : 0;
        this.n = t >> 15;
        this.v = 0;
        r[a] = t;
        return 1;
      }
      case OP.XOR: {
        const t = r[a] ^ r[b];
        this.z = t === 0 ? 1 : 0;
        this.n = t >> 15;
        this.v = 0;
        r[a] = t;
        return 1;
      }
      case OP.SHL: {
        const s = r[b] & 15;
        const t = r[a] << s;
        this.c = s === 0 ? this.c : (t >> 16) & 1;
        this.z = (t & WORD_MASK) === 0 ? 1 : 0;
        this.n = (t >> 15) & 1;
        r[a] = t & WORD_MASK;
        this.v = 0;
        return 1;
      }
      case OP.SHR: {
        const s = r[b] & 15;
        this.c = s === 0 ? this.c : (r[a] >> (s - 1)) & 1;
        const t = r[a] >> s;
        this.z = t === 0 ? 1 : 0;
        this.n = 0;
        r[a] = t & WORD_MASK;
        this.v = 0;
        return 1;
      }
      case OP.SAR: {
        const s = r[b] & 15;
        const signed = r[a] > 0x7fff ? r[a] - 0x10000 : r[a];
        const t = signed >> s;
        this.c = s === 0 ? this.c : (signed >> (s - 1)) & 1;
        this.z = (t & WORD_MASK) === 0 ? 1 : 0;
        this.n = (t >> 15) & 1;
        r[a] = t & WORD_MASK;
        this.v = 0;
        return 1;
      }
      case OP.MUL: {
        const t = r[a] * r[b];
        this.z = (t & WORD_MASK) === 0 ? 1 : 0;
        this.n = (t >> 15) & 1;
        r[a] = t & WORD_MASK;
        this.v = 0;
        return 3;
      }
      case OP.DIV: {
        r[a] = r[b] === 0 ? 0 : Math.floor(r[a] / r[b]);
        this.z = r[a] === 0 ? 1 : 0;
        this.n = (r[a] >> 15) & 1;
        this.v = 0;
        return 8;
      }
      case OP.MOD: {
        r[a] = r[b] === 0 ? r[a] : r[a] % r[b];
        this.z = r[a] === 0 ? 1 : 0;
        this.n = (r[a] >> 15) & 1;
        this.v = 0;
        return 8;
      }
      case OP.INC: {
        const t = (r[a] + 1) & WORD_MASK;
        this.z = t === 0 ? 1 : 0;
        this.n = t >> 15;
        this.v = r[a] === 0x7fff ? 1 : 0;
        r[a] = t;
        return 1;
      }
      case OP.DEC: {
        const t = (r[a] - 1) & WORD_MASK;
        this.z = t === 0 ? 1 : 0;
        this.n = t >> 15;
        this.v = r[a] === 0x8000 ? 1 : 0;
        r[a] = t;
        return 1;
      }
      case OP.NEG: {
        const t = (-r[a]) & WORD_MASK;
        this.z = t === 0 ? 1 : 0;
        this.n = t >> 15;
        this.v = r[a] === 0x8000 ? 1 : 0;
        r[a] = t;
        return 1;
      }
      case OP.NOT: {
        const t = (~r[a]) & WORD_MASK;
        this.z = t === 0 ? 1 : 0;
        this.n = t >> 15;
        this.v = 0;
        r[a] = t;
        return 1;
      }
      case OP.ADDI: {
        const t = r[a] + b;
        const res = t & WORD_MASK;
        this.z = res === 0 ? 1 : 0;
        this.c = t > WORD_MASK ? 1 : 0;
        this.n = res >> 15;
        this.v = ((r[a] ^ res) & (b ^ res) & 0x8000) ? 1 : 0;
        r[a] = res;
        return 1;
      }
      case OP.SUBI: {
        const t = r[a] - b;
        const res = t & WORD_MASK;
        this.z = res === 0 ? 1 : 0;
        this.c = t < 0 ? 1 : 0;
        this.n = res >> 15;
        this.v = ((r[a] ^ b) & (r[a] ^ res) & 0x8000) ? 1 : 0;
        r[a] = res;
        return 1;
      }
      case OP.SHLI: {
        const t = r[a] << b;
        if (b > 0) this.c = (t >> 16) & 1;
        this.z = (t & WORD_MASK) === 0 ? 1 : 0;
        this.n = (t >> 15) & 1;
        r[a] = t & WORD_MASK;
        return 1;
      }
      case OP.SHRI: {
        if (b > 0) this.c = (r[a] >> (b - 1)) & 1;
        const t = r[a] >> b;
        this.z = t === 0 ? 1 : 0;
        this.n = 0;
        r[a] = t;
        return 1;
      }
      case OP.CMP: {
        const t = r[a] - r[b];
        const res = t & WORD_MASK;
        this.z = res === 0 ? 1 : 0;
        this.c = t < 0 ? 1 : 0;
        this.n = res >> 15;
        this.v = ((r[a] ^ r[b]) & (r[a] ^ res) & 0x8000) ? 1 : 0;
        return 1;
      }
      case OP.CMPI: {
        const t = r[a] - b;
        const res = t & WORD_MASK;
        this.z = res === 0 ? 1 : 0;
        this.c = t < 0 ? 1 : 0;
        this.n = res >> 15;
        this.v = ((r[a] ^ b) & (r[a] ^ res) & 0x8000) ? 1 : 0;
        return 1;
      }
      case OP.LD: {
        r[a] = this.peek(r[b]);
        return 2;
      }
      case OP.LDO: {
        const off = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        r[a] = this.peek((r[b] + off) & WORD_MASK);
        return 2;
      }
      case OP.ST: {
        this.poke(r[a], r[b]);
        return 2;
      }
      case OP.STO: {
        const off = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        this.poke((r[a] + off) & WORD_MASK, r[b]);
        return 2;
      }
      case OP.LDB: {
        r[a] = this.peek(r[b]) & 0xff;
        return 2;
      }
      case OP.STB: {
        this.poke(r[a], r[b] & 0xff);
        return 2;
      }
      case OP.PUSH: {
        mem[this.sp] = r[a];
        this.sp = (this.sp - 1) & WORD_MASK;
        return 2;
      }
      case OP.POP: {
        this.sp = (this.sp + 1) & WORD_MASK;
        r[a] = mem[this.sp];
        return 2;
      }
      case OP.JMP:
        this.pc = mem[this.pc];
        return 2;
      case OP.JE:
        if (this.z) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.JNE:
        if (!this.z) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.JL:
        if (this.n !== this.v) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.JLE:
        if (this.z || this.n !== this.v) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.JG:
        if (!this.z && this.n === this.v) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.JGE:
        if (this.n === this.v) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.JB:
        if (this.c) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.JAE:
        if (!this.c) this.pc = mem[this.pc];
        else this.pc = (this.pc + 1) & WORD_MASK;
        return 2;
      case OP.CALL: {
        const target = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        mem[this.sp] = this.pc;
        this.sp = (this.sp - 1) & WORD_MASK;
        this.pc = target;
        return 3;
      }
      case OP.RET: {
        this.sp = (this.sp + 1) & WORD_MASK;
        this.pc = mem[this.sp];
        return 3;
      }
      case OP.DJNZ: {
        const target = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        r[a] = (r[a] - 1) & WORD_MASK;
        if (r[a] !== 0) this.pc = target;
        this.z = r[a] === 0 ? 1 : 0;
        this.n = r[a] >> 15;
        return 2;
      }
      case OP.WAIT:
        this.waiting = true;
        return 1;
      case OP.LEA: {
        const off = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        r[a] = (r[b] + off) & WORD_MASK;
        return 2;
      }
      case OP.LDA: {
        const addr = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        r[a] = this.peek(addr);
        return 2;
      }
      case OP.STA: {
        const addr = mem[this.pc];
        this.pc = (this.pc + 1) & WORD_MASK;
        this.poke(addr, r[a]);
        return 2;
      }
      default:
        this.halted = true;
        return 1;
    }
  }

  /* run until the frame's cycle budget is spent, or the program waits/halts */
  frame() {
    this.frameCount++;
    this.waiting = false;
    this.cycles = 0;
    while (!this.halted && !this.waiting && this.cycles < FRAME_CYCLES) {
      this.cycles += this.step();
    }
    return this.cycles;
  }

  runCycles(n) {
    let left = n;
    while (!this.halted && !this.waiting && left > 0) {
      const used = this.step();
      this.cycles += used;
      left -= used;
    }
    return left;
  }
}

export function makeMachine({ rom, bios, seed } = {}) {
  return new Volta({ rom, bios, seed });
}
