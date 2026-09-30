/* ═══════════════════════════════════════════════════════════════════
   main.js — boot.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function boot() {
    /* each instrument file registers itself with SB.ui as it boots;
       the UI layer only starts once they have all announced themselves. */
    SB.ui.init();

    /* deep links should land on the right accent, not the default one */
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) requestAnimationFrame(() => {
        const a = target.dataset.accent;
        if (a) document.documentElement.style.setProperty('--accent', a);
      });
    }

    /* honesty: if the browser can't do any of this, say so */
    if (!document.createElement('canvas').getContext('webgl2')) {
      const note = document.createElement('div');
      note.className = 'body body--dim';
      note.style.cssText = 'max-width:44rem;margin:2rem auto;padding:0 5vw';
      note.textContent = 'This browser has no WebGL 2, so instruments №1, №3 and №4 have nothing to run on. №2 is pure JavaScript and still works.';
      document.querySelector('.thesis')?.appendChild(note);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();