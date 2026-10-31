/* The Clockwork Mind — page choreography. */
(function () {
  'use strict';
  var CM = window.CM;

  /* ---------- scroll progress & topbar ---------- */
  var progress = document.getElementById('scroll-progress-bar');
  var topbar = document.getElementById('topbar');
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      if (progress) progress.style.width = Math.min(100, (y / max) * 100) + '%';
      document.body.classList.toggle('is-scrolled', y > 30);

      var marker = window.innerHeight * 0.36;
      var current = '';
      var exhibits = document.querySelectorAll('.exhibit');
      for (var i = 0; i < exhibits.length; i++) {
        var r = exhibits[i].getBoundingClientRect();
        if (r.top <= marker && r.bottom >= marker) { current = exhibits[i].id; break; }
      }
      document.querySelectorAll('[data-nav]').forEach(function (a) {
        a.classList.toggle('is-active', a.getAttribute('data-nav') === current);
      });
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ---------- reveal ---------- */
  var revealEls = document.querySelectorAll(
    '.overture h2, .overture__cols, .overture__note, .plaque, .cabinet, .coda__copy, .coda__machine, .notes h2, .notes__cols'
  );
  revealEls.forEach(function (el, i) {
    el.classList.add('reveal');
    el.style.transitionDelay = (i % 3) * 70 + 'ms';
  });
  if ('IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          ro.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach(function (el) { ro.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- sound ---------- */
  var soundButtons = Array.prototype.slice.call(document.querySelectorAll('#sound-toggle, [data-sound-toggle]'));
  function syncSound(on) {
    soundButtons.forEach(function (btn) {
      if (btn.id === 'sound-toggle') {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        var label = btn.querySelector('.sound-btn__label');
        if (label) label.textContent = on ? 'Sound on' : 'Sound off';
      } else {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = 'Sound: ' + (on ? 'on' : 'off');
      }
    });
  }
  soundButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (window.CMSound) window.CMSound.toggle();
      syncSound(window.CMSound ? window.CMSound.isEnabled() : false);
    });
  });
  if (window.CMSound) {
    window.CMSound.onChange(syncSound);
    syncSound(window.CMSound.isEnabled());
  }

  /* Browsers need a gesture before audio can start. */
  window.addEventListener('pointerdown', function () {
    if (window.CMSound) window.CMSound.unlock();
  }, { passive: true });

  /* ---------- nav: let the browser scroll, then move focus ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function () {
      var id = a.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (target) {
        setTimeout(function () { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }, 450);
      }
    });
  });

  /* ---------- coda: a slow orrery of gears ---------- */
  var codaCanvas = document.getElementById('coda-canvas');
  if (codaCanvas) {
    var cv = CM.setupCanvas(codaCanvas);
    var cctx = cv.ctx;
    var anim = CM.makeAnimator(function (now) {
      var w = cv.w, h = cv.h;
      if (!w || !h) return;
      var t = CM.reduced ? 0 : now / 1000;
      cctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2;
      var R = Math.min(w, h) * 0.38;
      var bg = cctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
      bg.addColorStop(0, 'rgba(201,163,90,.08)');
      bg.addColorStop(0.6, 'rgba(201,163,90,.015)');
      bg.addColorStop(1, 'rgba(201,163,90,0)');
      cctx.fillStyle = bg;
      cctx.fillRect(0, 0, w, h);

      var labels = ['I', 'II', 'III', 'IV', 'V', 'VI'];
      var colors = [
        ['#e0c583', '#9d7631', '#402b10'],
        ['#d8bb7a', '#8d662a', '#37240d'],
        ['#e5cb8e', '#a37b36', '#463012'],
        ['#d2b372', '#876027', '#32210c'],
        ['#e2c98c', '#9d7430', '#402b10'],
        ['#d9bd7d', '#90682c', '#38250e']
      ];
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * CM.TAU - Math.PI / 2 + t * 0.012;
        var orbit = R * 1.18;
        var gx = cx + Math.cos(a) * orbit;
        var gy = cy + Math.sin(a) * orbit;
        var gr = R * (0.20 + (i % 3) * 0.035);
        CM.drawGear(cctx, gx, gy, gr, 18 + i * 2, t * (i % 2 ? -0.05 : 0.07) + i, {
          depth: gr * 0.14,
          hole: gr * 0.30,
          hi: colors[i][0], mid: colors[i][1], lo: colors[i][2],
          stroke: 'rgba(20,12,5,.9)',
          holeFill: '#0c0906',
          holeStroke: 'rgba(240,215,154,.28)'
        });
        cctx.save();
        cctx.fillStyle = 'rgba(240,215,154,.62)';
        cctx.font = '500 ' + Math.max(7, gr * 0.22) + 'px "Cinzel", serif';
        cctx.textAlign = 'center';
        cctx.textBaseline = 'middle';
        cctx.fillText(labels[i], gx, gy + gr * 0.02);
        cctx.restore();
      }
      /* central sun-gear */
      CM.drawGear(cctx, cx, cy, R * 0.48, 48, -t * 0.02, {
        depth: R * 0.035,
        hole: R * 0.18,
        hi: '#f1dba2', mid: '#b08037', lo: '#4b3212',
        stroke: 'rgba(20,12,5,.9)',
        holeFill: '#0a0806',
        holeStroke: 'rgba(240,215,154,.35)',
        spokes: 8
      });
      cctx.save();
      cctx.beginPath();
      cctx.arc(cx, cy, R * 0.10, 0, CM.TAU);
      var hub = cctx.createRadialGradient(cx - R * 0.03, cy - R * 0.03, 1, cx, cy, R * 0.10);
      hub.addColorStop(0, '#f6e4b3');
      hub.addColorStop(0.6, '#b88a3e');
      hub.addColorStop(1, '#4a3112');
      cctx.fillStyle = hub;
      cctx.fill();
      cctx.restore();
    });
    CM.onVisible(codaCanvas.closest('.coda'), function () { anim.start(); }, function () { anim.stop(); }, '250px');
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) anim.stop();
      else if (codaCanvas.closest('.coda').getBoundingClientRect().bottom > 0) anim.start();
    });
  }

  /* ---------- line count in the colophon ---------- */
  var linesEl = document.getElementById('coda-lines');
  if (linesEl) {
    /* Updated from the shipped source; see the note in the HTML. */
    linesEl.textContent = '7,824';
  }
})();
