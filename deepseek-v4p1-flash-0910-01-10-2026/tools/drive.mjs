/*
 * drive.mjs — a small Chrome DevTools Protocol driver used to test the site
 * the way a person would: clicking cartridges, typing in the editor, pressing
 * keys, reading the screen back. Run the development server first:
 *
 *   python3 -m http.server 8099
 *   node tools/drive.mjs
 *
 * Screenshots land in tools/../.drive/ (kept out of the repository).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`;
const URL_BASE = process.env.URL_BASE || 'http://localhost:8099/deepseek-v4p1-flash-01-10-2026/';
const PORT = 9333;
const OUT = new URL('../.drive/', import.meta.url).pathname;

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function launch() {
  const proc = spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1400,1000',
    '--autoplay-policy=no-user-gesture-required',
    URL_BASE,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, page };
    } catch { /* not up yet */ }
    await sleep(100);
  }
  proc.kill();
  throw new Error('chrome did not start');
}

const problems = [];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { proc, page } = await launch();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const cdp = new CDP(ws);

  cdp.on('Runtime.exceptionThrown', (p) => {
    problems.push(`page exception: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') problems.push(`console error: ${entry.text}`);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') problems.push(`console error: ${args.map((a) => a.value).join(' ')}`);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, timeout = 8000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await evaluate(expression)) return true;
      await sleep(100);
    }
    throw new Error(`timed out waiting for: ${expression}`);
  };
  const shot = async (name, clipSelector) => {
    let clip;
    if (clipSelector) {
      const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(clipSelector)}); if (!el) return null; el.scrollIntoView({block:'center', behavior:'instant'}); const r = el.getBoundingClientRect(); return {x:r.x + window.scrollX, y:r.y + window.scrollY, w:r.width, h:r.height}; })()`);
      if (rect) clip = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.w, height: rect.h, scale: 1 };
    }
    const result = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    writeFileSync(`${OUT}${name}.png`, Buffer.from(result.data, 'base64'));
    console.log(`  shot ${name}.png`);
  };
  const click = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await sleep(120);
  };
  const key = async (type, code, keyName, vk) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  };

  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) problems.push(`${label}: ${detail}`);
  };

  console.log('VOLTA-16 driver');
  await waitFor('!!window.VOLTA');
  await sleep(1500);

  /* ── 1. the boot cartridge runs and paints ─────────────────────────────── */
  const lit = await evaluate(`(() => { const c = VOLTA.state.cpu; let n = 0; for (let i = 0; i < 19200; i++) if (c.mem[0x4000 + i]) n++; return n; })()`);
  check('boot paints the screen', lit > 600, `${lit} lit pixels`);
  check('boot cartridge in slot', await evaluate('VOLTA.state.cartId') === 'boot');
  await shot('01-console-boot', '#console');

  /* ── 2. insert snake and steer it ──────────────────────────────────────── */
  await evaluate(`VOLTA.insertCart('snake')`);
  await sleep(1200);
  await evaluate(`document.getElementById('screen-wrap').focus()`);
  await key('rawKeyDown', 'ArrowUp', 'ArrowUp', 38);
  await sleep(500);
  await key('keyUp', 'ArrowUp', 'ArrowUp', 38);
  await sleep(300);
  const dir = await evaluate(`VOLTA.state.rom.symbols.get('S_DIR')`);
  const dirVal = await evaluate(`VOLTA.state.cpu.mem[${dir}]`);
  check('keyboard steers snake upward', dirVal === 3, `dir=${dirVal}`);
  await shot('02-console-snake', '#console');

  /* ── 3. the editor assembles, reports errors, and runs ─────────────────── */
  const broken = `LDI R0, unknown_label\nADDI R3, 40\nFOO R0\n`;
  await evaluate(`(() => { const ta = document.getElementById('source'); ta.value = ${JSON.stringify(broken)}; ta.dispatchEvent(new Event('input')); })()`);
  await sleep(700);
  const status = await evaluate(`document.getElementById('ed-status').textContent`);
  check('editor reports errors live', /error/.test(status), status);
  const diagCount = await evaluate(`document.querySelectorAll('#diagnostics li[data-line]').length`);
  check('diagnostics list the problems', diagCount >= 3, `${diagCount} entries`);
  await shot('03-editor-errors', '#language .workbench');

  const good = `    LDI R0, 0\n    CALL BIOS_CLR\n    LDI R0, msg\n    LDI R1, 10\n    LDI R2, 50\n    LDI R3, 1\n    CALL BIOS_PRINT\nloop:\n    WAIT\n    JMP loop\nmsg:\n    .asciiz "EDITED LIVE"\n`;
  await evaluate(`(() => { const ta = document.getElementById('source'); ta.value = ${JSON.stringify(good)}; ta.dispatchEvent(new Event('input')); })()`);
  await sleep(600);
  await click('#btn-assemble');
  await sleep(600);
  const status2 = await evaluate(`document.getElementById('ed-status').textContent`);
  check('edited cartridge runs', status2 === 'assembled', status2);
  const editedLit = await evaluate(`(() => { const c = VOLTA.state.cpu; let n = 0; for (let i = 0; i < 19200; i++) if (c.mem[0x4000 + i]) n++; return n; })()`);
  check('edited program draws its text', editedLit > 100, `${editedLit} lit pixels`);

  /* ── 4. debugger steps instructions ────────────────────────────────────── */
  await click('#btn-reset');
  await click('#btn-step');
  const pc1 = await evaluate('VOLTA.state.cpu.pc');
  await click('#btn-step');
  const pc2 = await evaluate('VOLTA.state.cpu.pc');
  check('single stepping advances the PC', pc2 > pc1, `0x${pc1.toString(16)} -> 0x${pc2.toString(16)}`);
  await evaluate(`document.getElementById('monitor').scrollIntoView({behavior:'instant'})`);
  await sleep(400);
  await shot('04-monitor', '#monitor .monitor-grid');

  /* ── 5. chiptune drives the sound registers ────────────────────────────── */
  await evaluate(`VOLTA.insertCart('chiptune')`);
  await sleep(1500);
  const ctrl = await evaluate('VOLTA.state.cpu.mem[0xE021]');
  const bass = await evaluate('VOLTA.state.cpu.mem[0xE022]');
  check('chiptune arms the pulse channels', (ctrl & 1) === 1 && bass > 0, `ctrl=${ctrl} bassPeriod=${bass}`);
  await shot('05-console-chiptune', '#console');

  /* ── 6. cube renders its wireframe ─────────────────────────────────────── */
  await evaluate(`VOLTA.insertCart('cube')`);
  await sleep(1500);
  const cubePixels = await evaluate(`(() => { const c = VOLTA.state.cpu; let n = 0; for (let i = 0; i < 19200; i++) if (c.mem[0x4000 + i]) n++; return n; })()`);
  check('cube draws edges', cubePixels > 200, `${cubePixels} lit pixels`);
  await shot('06-console-cube', '#console');

  /* ── 7. ripple paints the whole field and cycles colour ────────────────── */
  await evaluate(`VOLTA.insertCart('ripple')`);
  await sleep(1600);
  const rippleLit = await evaluate(`(() => { const c = VOLTA.state.cpu; let n = 0; for (let i = 0; i < 19200; i++) if (c.mem[0x4000 + i]) n++; return n; })()`);
  const palBefore = await evaluate('Array.from(VOLTA.state.cpu.palette).join(",")');
  await sleep(500);
  const palAfter = await evaluate('Array.from(VOLTA.state.cpu.palette).join(",")');
  check('ripple paints the field', rippleLit > 12000, `${rippleLit} lit pixels`);
  check('ripple cycles its palette', palBefore !== palAfter);
  await shot('09-console-ripple', '#console');

  /* ── 8. deep links and mobile layout ───────────────────────────────────── */
  await cdp.send('Page.navigate', { url: `${URL_BASE}#life` });
  await waitFor('!!window.VOLTA');
  await sleep(1200);
  check('deep link inserts the right cartridge', await evaluate('VOLTA.state.cartId') === 'life');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  const overflow = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
  check('no horizontal overflow on phones', overflow <= 1, `overflow=${overflow}px`);
  await shot('07-mobile', '#machine');

  /* ── 9. library card insertion via real click ──────────────────────────── */
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  await evaluate(`document.querySelector('[data-load="fire"]').click()`);
  await sleep(1500);
  check('clicking a shelf card inserts it', await evaluate('VOLTA.state.cartId') === 'fire');
  const fireHot = await evaluate(`(() => { const c = VOLTA.state.cpu; let n = 0; for (let y = 110; y < 120; y++) for (let x = 0; x < 160; x++) if (c.mem[0x4000 + y*160 + x] > 7) n++; return n; })()`);
  check('fire is burning', fireHot > 300, `${fireHot} hot pixels`);
  await shot('08-console-fire', '#console');

  await sleep(300);
  console.log(problems.length ? `\n${problems.length} problem(s):` : '\nall checks clean');
  for (const p of problems) console.log('  -', p);
  ws.close();
  proc.kill();
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
