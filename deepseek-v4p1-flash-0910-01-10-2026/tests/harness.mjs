/*
 * harness.mjs — headless test rig. Boots the BIOS, assembles a cartridge,
 * runs frames with scripted input and renders the frame buffer to PNG so the
 * result can actually be looked at.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assemble, Volta, VRAM_BASE, VRAM_W, VRAM_H, PAD } from '../js/volta.js';
import { BIOS_ASM } from '../js/bios.asm.js';
import { NOTES } from '../js/notes.inc.js';
import { encodePNG } from '../tools/png.mjs';

let cachedBIOS = null;

export function biosImage() {
  if (!cachedBIOS) {
    cachedBIOS = assemble(BIOS_ASM);
    if (cachedBIOS.errors.length) {
      throw new Error('BIOS assembly failed:\n' + JSON.stringify(cachedBIOS.errors, null, 2));
    }
  }
  return cachedBIOS;
}

export function assembleCart(source, options = {}) {
  const rom = assemble(source, { predefined: NOTES, ...options });
  if (rom.errors.length) {
    const detail = rom.errors.map((e) => `  line ${e.line}: ${e.message}`).join('\n');
    throw new Error(`cartridge assembly failed:\n${detail}`);
  }
  return rom;
}

export function makeCPU(source, { seed = 12345, bios } = {}) {
  const rom = assembleCart(source);
  const cpu = new Volta({ rom, bios: bios || biosImage(), seed });
  return { cpu, rom };
}

/* script: number for every frame, array of masks, or fn(frame) -> mask */
export function run(cpu, frames, script = 0) {
  for (let f = 0; f < frames; f++) {
    if (cpu.halted) break;
    const input = typeof script === 'function' ? script(f) : Array.isArray(script) ? script[f] || 0 : script;
    cpu.input = input;
    cpu.frame();
  }
  return cpu;
}

export function renderRGBA(cpu, scale = 1) {
  const w = VRAM_W * scale;
  const h = VRAM_H * scale;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < VRAM_H; y++) {
    for (let x = 0; x < VRAM_W; x++) {
      const idx = (cpu.mem[VRAM_BASE + y * VRAM_W + x] & 15) * 3;
      const r = cpu.palette[idx];
      const g = cpu.palette[idx + 1];
      const b = cpu.palette[idx + 2];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const o = (((y * scale + sy) * w) + (x * scale + sx)) * 4;
          rgba[o] = r;
          rgba[o + 1] = g;
          rgba[o + 2] = b;
          rgba[o + 3] = 255;
        }
      }
    }
  }
  return { width: w, height: h, rgba };
}

export function snapshot(cpu, path, scale = 3) {
  const { width, height, rgba } = renderRGBA(cpu, scale);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(width, height, rgba));
  return path;
}

export function textOf(cpu, x, y, w = 16, h = 1) {
  let out = '';
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = cpu.mem[VRAM_BASE + (y + j) * VRAM_W + x + i];
      out += v === 0 ? ' ' : '#';
    }
    out += '\n';
  }
  return out;
}

export { PAD };
