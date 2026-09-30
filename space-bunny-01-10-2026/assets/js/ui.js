/* ═══════════════════════════════════════════════════════════════════
   ui.js — the choreography. Reveals, the accent that drifts from
   instrument to instrument, the rail, the progress hairline, and the
   declarative control panel that every instrument shares.
   ═══════════════════════════════════════════════════════════════════ */
SB.ui = (function () {
  'use strict';
  const { clamp, fmt, fmtBig, highlight, loadSource, reduced, gateFor, startLoop, fpsNow } = SB;

  const instruments = [];   // { el, spec, params, gate }
  let activeSection = null;

  /* ── 1. reveal on enter ───────────────────────────────────────── */
  function reveals() {
    const els = document.querySelectorAll('.reveal');
    if (reduced) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
    els.forEach((e) => io.observe(e));
  }

  /* ── 2. counters ─────────────────────────────────────────────── */
  function counters() {
    const els = document.querySelectorAll('[data-count]');
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        io.unobserve(el);
        const to = parseFloat(el.dataset.count);
        if (reduced) { el.textContent = to.toLocaleString(); continue; }
        const t0 = performance.now(), dur = 1500;
        const step = (t) => {
          const k = clamp((t - t0) / dur, 0, 1);
          const ease = 1 - Math.pow(1 - k, 4);
          el.textContent = Math.round(to * ease).toLocaleString();
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }, { threshold: 0.4 });
    els.forEach((e) => io.observe(e));
  }

  /* ── 3. progress + section tracking + accent ─────────────────── */
  function scrollWork() {
    const bar = document.querySelector('[data-progress]');
    const railLinks = [...document.querySelectorAll('[data-rail]')];
    const sections = [...document.querySelectorAll('[data-section]')];

    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting) continue;
        const id = e.target.id;
        if (activeSection === id) continue;
        activeSection = id;
        const accent = e.target.dataset.accent;
        if (accent) document.documentElement.style.setProperty('--accent', accent);
        railLinks.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
      }
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach((s) => io.observe(s));

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const k = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
        if (bar) bar.style.width = (k * 100).toFixed(2) + '%';
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return { sections, railLinks };
  }

  /* ── 4. global readout, bottom-left ──────────────────────────── */
  function globalHud() {
    const line = document.querySelector('[data-hudline]');
    if (!line) return;
    let acc = 0;
    startLoop((t, dt) => {
      acc += dt;
      if (acc < 260) return;
      acc = 0;
      const inst = instruments.find((i) => i.gate.visible);
      const bits = [];
      bits.push(fmt(fpsNow(), 0) + ' fps');
      if (inst && inst.spec.status) {
        const s = inst.spec.status();
        if (s) bits.push(s);
      }
      line.textContent = bits.join('  ·  ');
    });
  }

  /* ── 5. source viewer ────────────────────────────────────────── */
  function sourceToggles() {
    document.querySelectorAll('[data-src-toggle]').forEach((btn) => {
      const section = btn.closest('[data-section]');
      const box = section.querySelector('[data-src]');
      const code = section.querySelector('[data-src-code]');
      const name = section.querySelector('[data-src-name]');
      const url = section.dataset.source;
      let loaded = false;

      const load = () => {
        if (loaded) return;
        loaded = true;
        name.textContent = url.split('/').pop();
        code.innerHTML = '<span class="tk-c">/* fetching…</span>';
        loadSource(url).then((txt) => {
          code.innerHTML = highlight(txt);
          box.querySelector('.src__body').scrollTop = 0;
        });
      };

      btn.addEventListener('click', () => {
        const open = box.hasAttribute('hidden');
        if (open) { box.removeAttribute('hidden'); load(); }
        else box.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? 'hide the source' : 'read the source';
        if (!open) box.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
      });

      section.querySelector('[data-src-close]').addEventListener('click', () => {
        box.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'read the source';
      });
    });
  }

  /* ── 6. the shared control panel ──────────────────────────────── */
  /* An instrument hands over a spec; it gets sliders, segmented
     buttons, a hide toggle and a change callback for free. */
  function panel(el, spec) {
    const box = el.querySelector('[data-panel]');
    if (!box) return null;
    const params = Object.assign({}, spec.params || {});
    const change = () => { if (spec.onChange) spec.onChange(params); };

    /* sliders */
    const dpFor = (inp) => {
      if (inp.dataset.dp !== undefined) return parseInt(inp.dataset.dp, 10);
      const step = parseFloat(inp.step);
      return step >= 1 ? 0 : (step < 0.01 ? 4 : 2);
    };
    box.querySelectorAll('[data-slider]').forEach((inp) => {
      const k = inp.dataset.slider;
      const out = box.querySelector('[data-out="' + k + '"]');
      const show = () => {
        if (out) out.textContent = fmt(parseFloat(inp.value), dpFor(inp));
      };
      if (params[k] !== undefined) inp.value = params[k];
      show();
      inp.addEventListener('input', () => {
        params[k] = parseFloat(inp.value);
        show(); change();
      });
    });

    /* segmented buttons: single-choice groups keyed by preset name */
    box.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('[data-preset]').forEach((b) => {
        b.addEventListener('click', () => {
          seg.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          const name = b.dataset.preset;
          if (spec.presets && spec.presets[name]) {
            Object.assign(params, spec.presets[name]);
            box.querySelectorAll('[data-slider]').forEach((inp) => {
              const k = inp.dataset.slider;
              if (params[k] === undefined) return;
              inp.value = params[k];
              const out = box.querySelector('[data-out="' + k + '"]');
              if (out) out.textContent = fmt(params[k], dpFor(inp));
            });
            if (spec.onPreset) spec.onPreset(name, params);
          }
          change();
        });
      });
    });

    /* loose action buttons */
    box.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => { if (spec.onAct) spec.onAct(b.dataset.act, params); });
    });

    /* hide / show */
    const row = document.createElement('div');
    row.className = 'panel__row panel__row--end';
    const hide = document.createElement('button');
    hide.className = 'ghost';
    hide.textContent = 'hide controls';
    row.appendChild(hide);
    box.appendChild(row);
    hide.addEventListener('click', () => {
      const off = box.classList.toggle('hide');
      hide.textContent = off ? 'show controls' : 'hide controls';
    });

    return params;
  }

  /* ── 7. hint fades once the visitor touches the plate ────────── */
  function hints() {
    document.querySelectorAll('[data-frame]').forEach((f) => {
      const hint = f.querySelector('[data-hint]');
      if (!hint) return;
      const off = () => { hint.classList.add('gone'); f.removeEventListener('pointerdown', off); };
      f.addEventListener('pointerdown', off);
      setTimeout(off, 14000);
    });
  }

  /* ── 8. instrument registry ──────────────────────────────────── */
  /* An instrument calls this once. It gets woken and put to sleep
     by the viewport, and its live numbers get routed to the HUD. */
  function register(el, spec) {
    const frame = el.querySelector('[data-frame]');
    const gate = gateFor(frame, () => { if (spec.onVisibility) spec.onVisibility(gate.visible); });
    const inst = { el, spec, gate, frame, params: panel(el, spec) || {} };
    if (!inst.params) inst.params = spec.params || {};
    instruments.push(inst);
    return inst;
  }

  /* ── boot ────────────────────────────────────────────────────── */
  function init() {
    reveals();
    counters();
    scrollWork();
    sourceToggles();
    hints();
    globalHud();

    const d = new Date();
    const dateEl = document.querySelector('[data-date]');
    if (dateEl) dateEl.textContent = d.toLocaleDateString('en-GB',
      { day: 'numeric', month: 'long', year: 'numeric' });

    const t0 = performance.now();
    const clock = document.querySelector('[data-clock]');
    if (clock) {
      const tick = () => {
        const s = (performance.now() - t0) / 1000;
        const m = Math.floor(s / 60), r = Math.floor(s % 60);
        clock.textContent = m + ':' + String(r).padStart(2, '0') + ' elapsed';
      };
      tick();
      setInterval(tick, 1000);
    }
  }

  return { init, register, instruments };
})();