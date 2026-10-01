/*
 * highlight.js — a very small syntax highlighter for VOLTA assembly.
 * Good enough to make the editor feel like part of the machine.
 */

import { OPS } from './volta.js';

const MNEMONICS = new Set(OPS.filter(Boolean).map((o) => o.name));
const DIRECTIVES = new Set(['.org', '.def', '.word', '.ascii', '.asciiz', '.space', '.fill']);

function esc(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function classify(word) {
  const upper = word.toUpperCase();
  if (MNEMONICS.has(upper)) return 'm';
  if (DIRECTIVES.has(word.toLowerCase())) return 'd';
  return 's';
}

export function highlight(source) {
  const out = [];
  for (const line of source.split('\n')) {
    let i = 0;
    let html = '';
    while (i < line.length) {
      const rest = line.slice(i);
      let m;
      if ((m = /^;.*|^\/\/.*/.exec(rest))) {
        html += `<span class="c">${esc(m[0])}</span>`;
        i += m[0].length;
      } else if ((m = /^"(?:[^"\\]|\\.)*"?/.exec(rest))) {
        html += `<span class="q">${esc(m[0])}</span>`;
        i += m[0].length;
      } else if ((m = /^\.[A-Za-z]+/.exec(rest))) {
        const cls = DIRECTIVES.has(m[0].toLowerCase()) ? 'd' : 's';
        html += `<span class="${cls}">${esc(m[0])}</span>`;
        i += m[0].length;
      } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*:/.exec(rest))) {
        html += `<span class="l">${esc(m[0])}</span>`;
        i += m[0].length;
      } else if ((m = /^R[0-7]\b/i.exec(rest))) {
        html += `<span class="r">${esc(m[0])}</span>`;
        i += m[0].length;
      } else if ((m = /^(0x[0-9a-fA-F_]+|0b[01_]+|\$[0-9a-fA-F_]+|\d[\d_]*)/.exec(rest))) {
        html += `<span class="n">${esc(m[0])}</span>`;
        i += m[0].length;
      } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
        html += `<span class="${classify(m[0])}">${esc(m[0])}</span>`;
        i += m[0].length;
      } else {
        html += esc(line[i]);
        i++;
      }
    }
    out.push(html);
  }
  return out.join('\n');
}
