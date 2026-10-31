/* Exhibit II — The Bronze Sky.
   An interactive reconstruction of the Antikythera mechanism's dials.
   Astronomy: low-precision formulae after Meeus. */
(function () {
  'use strict';
  var CM = window.CM;
  var canvas = document.getElementById('antikythera-canvas');
  if (!canvas) return;

  var view = CM.setupCanvas(canvas);
  var ctx = view.ctx;
  var section = canvas.closest('.exhibit');
  var stage = canvas.closest('.cabinet__stage');
  var slider = document.getElementById('ant-range');
  var dateEl = document.getElementById('ant-date');
  var sunEl = document.getElementById('ant-sun');
  var moonEl = document.getElementById('ant-moon');
  var statusEl = document.getElementById('ant-eclipse-status');
  var backBtn = document.getElementById('ant-back');
  var fwdBtn = document.getElementById('ant-forward');
  var eclipseBtn = document.getElementById('ant-eclipse');
  var playBtn = document.getElementById('ant-play');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-ant-view]'));

  var D2R = Math.PI / 180;
  var TAU = Math.PI * 2;
  var START_JD = 1629745.5;   /* 1 Jan 250 BCE, proleptic Julian */
  var END_JD = 1702795.5;     /* 1 Jan 50 BCE */
  var DEFAULT_JD = 1646663.5; /* 27 Apr 205 BCE */
  var LUNATION = 29.530588861;
  var NEW_MOON_EPOCH = 2451550.09766;
  var EGYPT_EPOCH = 1448638;
  var jd = DEFAULT_JD;
  var viewMode = 'front';
  var playing = false;
  var dragging = false;
  var dragStartX = 0;
  var dragStartJD = 0;
  var lastDayShown = null;
  var flash = 0;
  var flashType = '';
  var animator = CM.makeAnimator(frame);
  var t0 = performance.now();
  var sarosCycleIndex = null;
  var sarosMarks = [];
  var stars = [];

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var ZODIAC = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
  var ZODIAC_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
  var ZODIAC_ABBR = ['ARI', 'TAU', 'GEM', 'CAN', 'LEO', 'VIR', 'LIB', 'SCA', 'SAG', 'CAP', 'AQU', 'PIS'];
  var EGYPT_MONTHS = ['Thoth', 'Phaophi', 'Athyr', 'Choiak', 'Tybi', 'Mechir', 'Phamenoth', 'Pharmuthi', 'Pachon', 'Payni', 'Epiphi', 'Mesore'];

  /* ---------- calendar & astronomy ---------- */

  function julianToJD(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d - 1524.5;
  }

  function jdToJulian(jd) {
    var Z = Math.floor(jd + 0.5);
    var F = (jd + 0.5) - Z;
    var A = Z;
    var B = A + 1524;
    var C = Math.floor((B - 122.1) / 365.25);
    var D = Math.floor(365.25 * C);
    var E = Math.floor((B - D) / 30.6001);
    var day = B - D - Math.floor(30.6001 * E) + F;
    var month = E < 14 ? E - 1 : E - 13;
    var year = month > 2 ? C - 4716 : C - 4715;
    return { year: year, month: month, day: day };
  }

  function formatDate(jd) {
    var d = jdToJulian(jd);
    var y = d.year <= 0 ? (1 - d.year) + ' BCE' : d.year + ' CE';
    var day = Math.floor(d.day);
    if (day < 1) day = 1;
    return day + ' ' + MONTHS[d.month - 1] + ' ' + y;
  }

  function egyptianDate(jd) {
    var n = Math.floor(jd + 0.5) - EGYPT_EPOCH;
    var year = Math.floor(n / 365) + 1;
    var doy = CM.mod(n, 365);
    var m, d;
    if (doy < 360) { m = Math.floor(doy / 30); d = doy % 30 + 1; }
    else { m = 12; d = doy - 360 + 1; }
    return { year: year, month: m, day: d, name: m < 12 ? EGYPT_MONTHS[m] : 'Epagomenal' };
  }

  function sunLongitude(jd) {
    var T = (jd - 2451545) / 36525;
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
            (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    var omega = (125.04 - 1934.136 * T) * D2R;
    return CM.mod(L0 + C - 0.00569 - 0.00478 * Math.sin(omega), 360);
  }

  function moonPosition(jd) {
    var T = (jd - 2451545) / 36525;
    var T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    var Lp = CM.mod(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000, 360);
    var D = CM.mod(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000, 360) * D2R;
    var M = CM.mod(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000, 360) * D2R;
    var Mp = CM.mod(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000, 360) * D2R;
    var F = CM.mod(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000, 360) * D2R;
    var s = Math.sin;
    var sl =
      6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) -
      0.185116 * s(M) - 0.114332 * s(2 * F) + 0.058793 * s(2 * D - 2 * Mp) + 0.057066 * s(2 * D - M - Mp) +
      0.053322 * s(2 * D + Mp) + 0.045758 * s(2 * D - M) - 0.040923 * s(M - Mp) - 0.034720 * s(D) -
      0.030383 * s(M + Mp) + 0.015327 * s(2 * D - 2 * F) - 0.012528 * s(Mp + 2 * F) + 0.010980 * s(Mp - 2 * F) +
      0.010675 * s(4 * D - Mp) + 0.010034 * s(3 * Mp) + 0.008548 * s(4 * D - 2 * Mp) - 0.007888 * s(2 * D + M - Mp) -
      0.006766 * s(2 * D + M) - 0.005163 * s(D - Mp) + 0.004987 * s(D + M) + 0.004036 * s(2 * D - M + Mp) +
      0.003994 * s(2 * D + 2 * Mp) + 0.003861 * s(4 * D) + 0.003665 * s(2 * D - 3 * Mp);
    var sb =
      5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F) +
      0.055413 * s(2 * D - Mp + F) + 0.046271 * s(2 * D - Mp - F) + 0.032573 * s(2 * D + F) +
      0.017198 * s(2 * Mp + F) + 0.009266 * s(2 * D + Mp - F) + 0.008822 * s(2 * Mp - F) +
      0.008216 * s(2 * D - M - F) + 0.004324 * s(2 * D - 2 * Mp - F) + 0.004200 * s(2 * D + Mp + F) +
      0.003914 * s(2 * D - M + F) + 0.003666 * s(2 * D - M - Mp + F) + 0.002695 * s(2 * D + Mp - F) +
      0.002602 * s(2 * D - M - Mp - F) + 0.002396 * s(2 * D - M + F) + 0.002353 * s(2 * D - Mp + F);
    var node = CM.mod(125.0445479 - 1934.1362891 * T + 0.0020754 * T2 + T3 / 467441 - T4 / 60616000, 360);
    return { lon: CM.mod(Lp + sl, 360), lat: sb, node: node, F: CM.mod(F / D2R, 360) };
  }

  function elongation(jd) {
    return CM.mod(moonPosition(jd).lon - sunLongitude(jd), 360);
  }

  function phaseName(elong) {
    if (elong < 11.25 || elong >= 348.75) return 'New moon';
    if (elong < 78.75) return 'Waxing crescent';
    if (elong < 101.25) return 'First quarter';
    if (elong < 168.75) return 'Waxing gibbous';
    if (elong < 191.25) return 'Full moon';
    if (elong < 258.75) return 'Waning gibbous';
    if (elong < 281.25) return 'Last quarter';
    return 'Waning crescent';
  }

  function eclipseStatus(jd) {
    var e = elongation(jd);
    var lat = moonPosition(jd).lat;
    var d0 = Math.min(e, 360 - e);
    var d180 = Math.abs(e - 180);
    if (d0 < 1.8 && Math.abs(lat) < 1.65) return { type: 'solar', text: 'Solar eclipse possible — the Moon is near the node at new moon.' };
    if (d180 < 1.8 && Math.abs(lat) < 1.15) return { type: 'lunar', text: 'Lunar eclipse possible — the Moon is near the node at full moon.' };
    if (d0 < 7) return { type: 'near', text: 'New moon is near; the Moon is far enough from the node to miss the Sun.' };
    if (d180 < 7) return { type: 'near', text: 'Full moon is near; the shadow of the Earth misses the Moon.' };
    return { type: 'none', text: 'No eclipse. The Sun and Moon are far from the dragon’s nodes.' };
  }

  function meanNewMoon(k) {
    return NEW_MOON_EPOCH + LUNATION * k;
  }

  function monthIndex(jd) {
    return Math.floor((jd - NEW_MOON_EPOCH) / LUNATION);
  }

  function computeSarosMarks(cycleIndex) {
    var marks = [];
    var k0 = cycleIndex * 223;
    for (var i = 0; i < 223; i++) {
      var j = meanNewMoon(k0 + i);
      var solar = Math.abs(moonPosition(j).lat) < 1.57;
      var lunar = Math.abs(moonPosition(j + LUNATION / 2).lat) < 1.0;
      if (solar || lunar) marks.push({ month: i, solar: solar, lunar: lunar });
    }
    return marks;
  }

  function nextEclipse(fromJD) {
    for (var d = 1; d < 3200; d++) {
      var j = fromJD + d;
      var e = elongation(j);
      var lat = moonPosition(j).lat;
      var d0 = Math.min(e, 360 - e);
      var d180 = Math.abs(e - 180);
      if (d0 < 1.8 && Math.abs(lat) < 1.65) return { jd: j, type: 'solar' };
      if (d180 < 1.8 && Math.abs(lat) < 1.15) return { jd: j, type: 'lunar' };
    }
    return null;
  }

  /* ---------- state / UI ---------- */

  function setJD(next, opts) {
    opts = opts || {};
    jd = CM.clamp(next, START_JD, END_JD);
    var offset = Math.round(jd - START_JD);
    if (document.activeElement !== slider || opts.force) slider.value = offset;
    var k = monthIndex(jd);
    var cycle = Math.floor(k / 223);
    if (cycle !== sarosCycleIndex) {
      sarosCycleIndex = cycle;
      sarosMarks = computeSarosMarks(cycle);
    }
    if (opts.silent !== true) {
      var day = Math.floor(jd);
      if (day !== lastDayShown) {
        lastDayShown = day;
        updateReadout();
        if (opts.sound) CMSound.play('tick', { vol: .55, pitch: 0.9 + (k % 7) * 0.03 });
      }
    } else {
      updateReadout();
    }
  }

  function updateReadout() {
    var e = elongation(jd);
    var mp = moonPosition(jd);
    var slon = sunLongitude(jd);
    var sign = Math.floor(CM.mod(slon, 360) / 30);
    var deg = CM.mod(slon, 360) - sign * 30;
    var eg = egyptianDate(jd);
    var pct = Math.round((1 - Math.cos(e * D2R)) / 2 * 100);
    var k = monthIndex(jd);
    var metonic = CM.mod(k, 235) + 1;
    var sarosMonth = CM.mod(k, 223) + 1;
    var status = eclipseStatus(jd);

    dateEl.textContent = formatDate(jd) + ' · Egyptian: ' + eg.name + ' ' + eg.day;
    sunEl.textContent = deg.toFixed(1) + '° ' + ZODIAC_NAMES[sign] + ' · Metonic ' + metonic + '/235';
    moonEl.textContent = phaseName(e) + ' · ' + pct + '% lit · ' + ZODIAC_NAMES[Math.floor(mp.lon / 30)] + ' · Saros ' + sarosMonth + '/223';
    statusEl.textContent = status.text;
    if (status.type === 'solar' || status.type === 'lunar') {
      statusEl.style.color = 'var(--brass-hi)';
    } else {
      statusEl.style.color = '';
    }
  }

  function setView(mode) {
    viewMode = mode;
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-ant-view') === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (stage) stage.classList.toggle('is-back', mode === 'back');
    canvas.setAttribute('aria-label', mode === 'front'
      ? 'The front dial of the Antikythera mechanism: zodiac, calendar, Sun and Moon. Drag to move through time.'
      : 'The rear dials of the Antikythera mechanism: the Metonic and Saros spirals. Drag to move through time.');
    CMSound.play('tick', { vol: .5 });
  }

  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () { setView(btn.getAttribute('data-ant-view')); });
  });

  slider.min = '0';
  slider.max = String(Math.round(END_JD - START_JD));
  slider.step = '1';
  slider.value = String(Math.round(DEFAULT_JD - START_JD));
  slider.addEventListener('input', function () {
    stopPlay();
    setJD(START_JD + Number(slider.value), { force: true });
  });
  slider.addEventListener('change', function () {
    CMSound.play('tick', { vol: .5 });
  });

  function stepMonth(direction) {
    stopPlay();
    setJD(jd + direction * LUNATION, { force: true, sound: true });
  }
  backBtn.addEventListener('click', function () { stepMonth(-1); });
  fwdBtn.addEventListener('click', function () { stepMonth(1); });

  eclipseBtn.addEventListener('click', function () {
    stopPlay();
    var found = nextEclipse(jd);
    if (!found) {
      statusEl.textContent = 'No eclipse found in the next eight years.';
      return;
    }
    setJD(found.jd, { force: true });
    flash = 1;
    flashType = found.type;
    CMSound.play('chime', { notes: found.type === 'solar' ? [523.25, 783.99, 1046.5] : [392, 523.25, 659.25] });
  });

  function stopPlay() {
    if (!playing) return;
    playing = false;
    playBtn.setAttribute('aria-pressed', 'false');
    playBtn.textContent = 'Turn time';
  }

  playBtn.addEventListener('click', function () {
    playing = !playing;
    playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playBtn.textContent = playing ? 'Pause time' : 'Turn time';
    CMSound.play('tick');
  });

  canvas.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartJD = jd;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    stopPlay();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) { canvas.style.cursor = 'grab'; return; }
    var dx = e.clientX - dragStartX;
    setJD(dragStartJD + dx * 0.85, { force: true });
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
    if (e && e.pointerId != null) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', function () { if (!dragging) canvas.style.cursor = 'grab'; });
  canvas.style.cursor = 'grab';

  canvas.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { stepMonth(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { stepMonth(1); e.preventDefault(); }
  });
  canvas.tabIndex = 0;

  /* ---------- drawing ---------- */

  function frame(now, dtMs) {
    if (!view.w) return;
    var dt = Math.min(0.05, dtMs / 1000);
    if (playing) {
      setJD(jd + dt * 8, { silent: false });
      if (jd >= END_JD - 1) stopPlay();
    }
    /* rebuild stars on resize */
    if (!stars.length || stars.forW !== view.w) {
      stars = CM.stars(150, Math.min(150, Math.round(view.w * view.h / 9000)), view.w, view.h);
      stars.forW = view.w;
    }
    flash = Math.max(0, flash - dt * 0.55);
    ctx.clearRect(0, 0, view.w, view.h);
    if (viewMode === 'front') drawFront(now);
    else drawBack(now);
  }

  function drawBackdrop() {
    var w = view.w, h = view.h;
    var g = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, Math.max(w, h) * 0.72);
    g.addColorStop(0, '#15120c');
    g.addColorStop(0.55, '#0b0907');
    g.addColorStop(1, '#070604');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawFront(now) {
    drawBackdrop();
    var w = view.w, h = view.h;
    var mobile = w < 620;
    var R = Math.min(w * (mobile ? 0.455 : 0.42), h * 0.445);
    var cx = w * 0.5;
    var cy = h * 0.5;

    var sunLon = sunLongitude(jd);
    var mp = moonPosition(jd);
    var elong = CM.mod(mp.lon - sunLon, 360);
    var sunA = (sunLon - 90) * D2R;
    var moonA = (mp.lon - 90) * D2R;
    var nodeA = (mp.node - 90) * D2R;

    /* outer gear halo */
    var spin = CM.reduced ? 0 : now;
    CM.drawGear(ctx, cx, cy, R * 1.035, 90, spin * 0.000018 + 0.08, {
      depth: R * 0.018,
      hole: R * 0.985,
      holeFill: 'rgba(0,0,0,0)',
      fill: 'rgba(201,163,90,.09)',
      stroke: 'rgba(201,163,90,.22)',
      lineWidth: 0.7,
      holeStroke: 'rgba(201,163,90,.13)'
    });

    /* sky disc */
    var sky = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.05, cx, cy, R * 0.8);
    sky.addColorStop(0, '#15211f');
    sky.addColorStop(0.55, '#0b1211');
    sky.addColorStop(1, '#070a09');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.80, 0, TAU);
    ctx.fillStyle = sky;
    ctx.fill();

    /* stars inside the sky */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.79, 0, TAU);
    ctx.clip();
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var tw = CM.reduced ? 0.8 : 0.55 + 0.45 * Math.sin(now * 0.0009 + st.p);
      ctx.globalAlpha = st.a * tw * 0.8;
      ctx.fillStyle = '#d9d2b8';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r * 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    /* inner plate lines */
    ctx.save();
    ctx.strokeStyle = 'rgba(201,163,90,.13)';
    ctx.lineWidth = 0.7;
    for (var c = 0; c < 4; c++) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * (0.22 + c * 0.14), 0, TAU);
      ctx.stroke();
    }
    for (var spoke = 0; spoke < 24; spoke++) {
      var sa = spoke / 24 * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sa) * R * 0.36, cy + Math.sin(sa) * R * 0.36);
      ctx.lineTo(cx + Math.cos(sa) * R * 0.79, cy + Math.sin(sa) * R * 0.79);
      ctx.strokeStyle = 'rgba(201,163,90,.055)';
      ctx.stroke();
    }
    ctx.restore();

    /* node line (the dragon) */
    drawNodeLine(cx, cy, R, nodeA, mp.node);

    /* zodiac ring */
    drawZodiacRing(cx, cy, R);

    /* calendar ring */
    drawCalendarRing(cx, cy, R, sunA, egyptianDate(jd));

    /* outer bezel */
    ring(cx, cy, R * 1.005, 1.2, 'rgba(201,163,90,.55)');
    ring(cx, cy, R * 0.815, 1, 'rgba(201,163,90,.45)');
    ring(cx, cy, R * 0.645, 0.8, 'rgba(201,163,90,.3)');

    /* sun pointer */
    drawHand(cx, cy, sunA, R * 0.895, R * 0.075, '#e8c87b', 'rgba(70,45,14,.9)', 2.4, R * 0.020);
    drawSun(cx + Math.cos(sunA) * R * 0.895, cy + Math.sin(sunA) * R * 0.895, R * 0.030, spin);

    /* moon pointer */
    drawHand(cx, cy, moonA, R * 0.855, R * 0.065, '#cfd8c9', 'rgba(30,40,38,.9)', 2.1, R * 0.017);
    drawPhaseBall(cx + Math.cos(moonA) * R * 0.855, cy + Math.sin(moonA) * R * 0.855, R * 0.028, elong);

    /* center rosette */
    drawCenter(cx, cy, R, spin);

    /* small labels */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(7, R * 0.026) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(240,215,154,.58)';
    ctx.fillText('FRONT DIAL', cx, cy + R * 0.12);
    ctx.font = '400 ' + Math.max(6, R * 0.018) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(201,163,90,.38)';
    ctx.fillText('ZODIAC · CALENDAR · SUN · MOON', cx, cy + R * 0.155);
    ctx.restore();

    if (!mobile) {
      drawScaleMarks(cx, cy, R);
    }

    /* eclipse flash */
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.55;
      ctx.strokeStyle = flashType === 'solar' ? '#f0d79a' : '#bcd2c9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1.08 + (1 - flash) * 0.12), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    drawDialFooter('THE BRONZE SKY', 'drag to turn time');
  }

  function drawZodiacRing(cx, cy, R) {
    ctx.save();
    var r0 = R * 0.815, r1 = R * 1.005;
    var g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(44,32,16,.55)');
    g.addColorStop(0.55, 'rgba(76,54,24,.32)');
    g.addColorStop(1, 'rgba(24,16,8,.65)');
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, TAU);
    ctx.arc(cx, cy, r0, TAU, 0, true);
    ctx.fillStyle = g;
    ctx.fill();

    for (var i = 0; i < 12; i++) {
      var a = (i * 30 - 90) * D2R;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.strokeStyle = 'rgba(201,163,90,.42)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      var mid = a + 15 * D2R;
      var sr = R * 0.945;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * sr, cy + Math.sin(mid) * sr);
      ctx.rotate(mid + Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = Math.max(11, R * 0.045) + 'px "DejaVu Sans", "Segoe UI Symbol", "Apple Symbols", serif';
      ctx.fillStyle = 'rgba(240,215,154,.8)';
      ctx.fillText(ZODIAC[i], 0, 0);
      ctx.font = '500 ' + Math.max(6, R * 0.021) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(201,163,90,.48)';
      ctx.fillText(ZODIAC_ABBR[i], 0, R * 0.045);
      ctx.restore();
    }

    /* degree ticks */
    for (var d = 0; d < 360; d += 2) {
      var da = (d - 90) * D2R;
      var len = d % 30 === 0 ? R * 0.022 : d % 10 === 0 ? R * 0.012 : R * 0.006;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(da) * (r0 + 2), cy + Math.sin(da) * (r0 + 2));
      ctx.lineTo(cx + Math.cos(da) * (r0 + 2 + len), cy + Math.sin(da) * (r0 + 2 + len));
      ctx.strokeStyle = d % 30 === 0 ? 'rgba(240,215,154,.55)' : 'rgba(201,163,90,.26)';
      ctx.lineWidth = d % 30 === 0 ? 1 : 0.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCalendarRing(cx, cy, R, sunA, eg) {
    var r0 = R * 0.655, r1 = R * 0.805;
    var dayIndex = eg.month * 30 + (eg.day - 1);
    if (eg.month === 12) dayIndex = 360 + eg.day - 1;
    var calOffset = sunA - (dayIndex / 365) * TAU;

    ctx.save();
    var g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(30,25,17,.65)');
    g.addColorStop(0.5, 'rgba(62,49,28,.4)');
    g.addColorStop(1, 'rgba(18,14,9,.7)');
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, TAU);
    ctx.arc(cx, cy, r0, TAU, 0, true);
    ctx.fillStyle = g;
    ctx.fill();

    /* 365 ticks */
    for (var i = 0; i < 365; i++) {
      var a = calOffset + (i / 365) * TAU - Math.PI / 2;
      var len = i % 30 === 0 ? R * 0.024 : i % 5 === 0 ? R * 0.013 : R * 0.006;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r1 - 2), cy + Math.sin(a) * (r1 - 2));
      ctx.lineTo(cx + Math.cos(a) * (r1 - 2 - len), cy + Math.sin(a) * (r1 - 2 - len));
      ctx.strokeStyle = i % 30 === 0 ? 'rgba(240,215,154,.6)' : i % 5 === 0 ? 'rgba(201,163,90,.34)' : 'rgba(201,163,90,.16)';
      ctx.lineWidth = i % 30 === 0 ? 1 : 0.6;
      ctx.stroke();
    }

    /* month names */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(5.5, R * 0.017) + 'px "IBM Plex Mono", monospace';
    for (var m = 0; m < 13; m++) {
      var ma = calOffset + ((m * 30 + 15) / 365) * TAU - Math.PI / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(ma) * (r0 + (r1 - r0) * 0.48), cy + Math.sin(ma) * (r0 + (r1 - r0) * 0.48));
      ctx.rotate(ma + Math.PI / 2);
      ctx.fillStyle = 'rgba(201,163,90,.48)';
      ctx.fillText(m < 12 ? EGYPT_MONTHS[m].slice(0, 3).toUpperCase() : 'EPAG', 0, 0);
      ctx.restore();
    }
    ctx.restore();

    /* current-date marker */
    var da = calOffset + (dayIndex / 365) * TAU - Math.PI / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(da) * (r1 - R * 0.012), cy + Math.sin(da) * (r1 - R * 0.012));
    ctx.rotate(da + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.014);
    ctx.lineTo(R * 0.012, 0);
    ctx.lineTo(0, R * 0.014);
    ctx.lineTo(-R * 0.012, 0);
    ctx.closePath();
    ctx.fillStyle = '#d8a64e';
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function drawNodeLine(cx, cy, R, nodeA, nodeLon) {
    ctx.save();
    ctx.strokeStyle = 'rgba(126,160,145,.32)';
    ctx.lineWidth = 0.9;
    ctx.setLineDash([2, 5]);
    for (var side = 0; side < 2; side++) {
      var a = nodeA + side * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18);
      ctx.lineTo(cx + Math.cos(a) * R * 0.79, cy + Math.sin(a) * R * 0.79);
      ctx.stroke();
      ctx.save();
      ctx.translate(cx + Math.cos(a) * R * 0.68, cy + Math.sin(a) * R * 0.68);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.016);
      ctx.lineTo(R * 0.010, 0);
      ctx.lineTo(0, R * 0.016);
      ctx.lineTo(-R * 0.010, 0);
      ctx.closePath();
      ctx.fillStyle = 'rgba(126,160,145,.35)';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawHand(cx, cy, angle, len, tail, fill, stroke, width, hub) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(-width * 0.4, -tail);
    ctx.lineTo(0, -len);
    ctx.lineTo(width * 0.4, -tail);
    ctx.lineTo(width * 0.9, -tail * 0.1);
    ctx.lineTo(0, 0);
    ctx.lineTo(-width * 0.9, -tail * 0.1);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -tail, hub, 0, TAU);
    ctx.fillStyle = 'rgba(18,12,6,.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,215,154,.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  function drawSun(x, y, r, now) {
    ctx.save();
    ctx.translate(x, y);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
    g.addColorStop(0, 'rgba(255,232,170,.45)');
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = '#f3d58a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,220,.75)';
    ctx.lineWidth = 0.8;
    for (var i = 0; i < 8; i++) {
      var a = i * TAU / 8 + now * 0.0001;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
      ctx.lineTo(Math.cos(a) * r * 1.65, Math.sin(a) * r * 1.65);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPhaseBall(x, y, r, elong) {
    /* A lit sphere with a terminator. The shadow is a path, not a filter,
       so it never erases the machinery behind the ball. */
    ctx.save();
    ctx.translate(x, y);

    ctx.beginPath();
    ctx.arc(0, 0, r * 1.9, 0, TAU);
    ctx.fillStyle = 'rgba(193,211,201,.14)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    var g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#f7f3e2');
    g.addColorStop(0.68, '#cdd0c1');
    g.addColorStop(1, '#7e8478');
    ctx.fillStyle = g;
    ctx.fill();

    var waxing = elong < 180;
    var cosE = Math.cos(elong * D2R);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    if (!waxing) ctx.scale(-1, 1);

    /* Dark limb + terminator. */
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, true);
    ctx.ellipse(0, 0, Math.abs(r * cosE), r, 0, Math.PI / 2, -Math.PI / 2, cosE > 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(7,11,10,.9)';
    ctx.fill();

    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.strokeStyle = 'rgba(240,235,210,.5)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();
  }

  function drawCenter(cx, cy, R, now) {
    var r = R * 0.105;
    CM.drawGear(ctx, cx, cy, r, 28, now * 0.00005, {
      depth: r * 0.15,
      hole: r * 0.4,
      hi: '#e6c883',
      mid: '#9b7330',
      lo: '#3e2a10',
      stroke: 'rgba(20,12,5,.9)',
      holeFill: '#0a0806',
      holeStroke: 'rgba(240,215,154,.4)'
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, TAU);
    ctx.fillStyle = '#f0d79a';
    ctx.fill();
  }

  function drawScaleMarks(cx, cy, R) {
    /* small degree numerals at the cardinal points */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(7, R * 0.022) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(201,163,90,.4)';
    var labels = ['0°', '90°', '180°', '270°'];
    for (var i = 0; i < 4; i++) {
      var a = (i * 90 - 90) * D2R;
      ctx.fillText(labels[i], cx + Math.cos(a) * R * 1.025, cy + Math.sin(a) * R * 1.025);
    }
    ctx.restore();
  }

  function drawDialFooter(title, hint) {
    var w = view.w, h = view.h;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(7, w * 0.0105) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(201,163,90,.5)';
    ctx.fillText(title, w / 2, h - 20);
    ctx.font = '400 ' + Math.max(5.5, w * 0.0075) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(139,127,108,.7)';
    ctx.fillText(hint, w / 2, h - 8);
    ctx.restore();
  }

  function ring(cx, cy, r, lw, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  /* ---------- rear dials ---------- */

  function drawBack(now) {
    drawBackdrop();
    var w = view.w, h = view.h;
    var mobile = w < 560;
    var R = Math.min(w * 0.215, h * 0.36);
    var cy = h * 0.5;
    var cx1 = w * 0.27;
    var cx2 = w * 0.73;
    var k = monthIndex(jd);
    var metonicMonth = CM.mod(k, 235);
    var sarosMonth = CM.mod(k, 223);
    var cycle = Math.floor(k / 223);
    var callippic = Math.floor(CM.mod(k, 940) / 235);
    var exeligmos = CM.mod(cycle, 3);

    drawSpiralDial(cx1, cy, R, 235, 5, metonicMonth, null, 'METONIC', '235 lunations · 19 years', callippic, 4, 'CALLIPPIC', now, mobile);
    drawSpiralDial(cx2, cy, R, 223, 4, sarosMonth, sarosMarks, 'SAROS', '223 lunations · eclipse cycle', exeligmos, 3, 'EXELIGMOS', now, mobile);

    /* legend */
    var ly = h - 30;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(6, w * 0.0082) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(240,207,125,.85)';
    ctx.beginPath();
    ctx.arc(w * 0.5 - 78, ly, 3.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(201,163,90,.8)';
    ctx.fillText('solar possibility', w * 0.5 - 68, ly);
    ctx.beginPath();
    ctx.arc(w * 0.5 + 26, ly, 3.5, 0, TAU);
    ctx.fillStyle = 'rgba(190,214,204,.9)';
    ctx.fill();
    ctx.fillStyle = 'rgba(169,200,189,.8)';
    ctx.fillText('lunar possibility', w * 0.5 + 36, ly);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(7, w * 0.0105) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(201,163,90,.5)';
    ctx.fillText('THE REAR DIALS', w / 2, 17);
    ctx.restore();
  }

  function drawSpiralDial(cx, cy, R, months, turns, pointerMonth, marks, title, subtitle, subPointer, subSectors, subLabel, now, mobile) {
    /* outer gear ring */
    CM.drawGear(ctx, cx, cy, R * 1.03, Math.max(46, Math.round(R * 0.7)), (CM.reduced ? 0 : now) * 0.000012 + (title === 'SAROS' ? 0.05 : 0), {
      depth: R * 0.026,
      hole: R * 0.985,
      holeFill: 'rgba(0,0,0,0)',
      fill: 'rgba(201,163,90,.08)',
      stroke: 'rgba(201,163,90,.2)',
      lineWidth: 0.6,
      holeStroke: 'rgba(201,163,90,.12)'
    });

    /* body */
    var halo = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.3);
    halo.addColorStop(0, 'rgba(201,163,90,.10)');
    halo.addColorStop(0.7, 'rgba(201,163,90,.025)');
    halo.addColorStop(1, 'rgba(201,163,90,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.3, 0, TAU);
    ctx.fillStyle = halo;
    ctx.fill();

    var g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
    g.addColorStop(0, 'rgba(52,42,26,.82)');
    g.addColorStop(0.55, 'rgba(28,23,15,.94)');
    g.addColorStop(1, 'rgba(11,9,7,.97)');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.985, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,163,90,.38)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* decorative rings */
    for (var r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * (0.99 - r * 0.018), 0, TAU);
      ctx.strokeStyle = 'rgba(201,163,90,' + (0.18 - r * 0.04) + ')';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    var r0 = R * 0.35;
    var r1 = R * 0.84;
    var totalAngle = turns * TAU;

    /* spiral line */
    ctx.beginPath();
    var steps = 700;
    for (var i = 0; i <= steps; i++) {
      var u = i / steps;
      var a = u * totalAngle - Math.PI / 2;
      var rr = CM.lerp(r0, r1, u);
      var x = cx + Math.cos(a) * rr;
      var y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(201,163,90,.52)';
    ctx.lineWidth = 1.05;
    ctx.stroke();

    /* month ticks */
    for (var m = 0; m < months; m++) {
      var u2 = m / (months - 1);
      var aa = u2 * totalAngle - Math.PI / 2;
      var rr2 = CM.lerp(r0, r1, u2);
      var major = m % 10 === 0;
      var len = major ? R * 0.018 : R * 0.009;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(aa) * (rr2 - len * 0.5), cy + Math.sin(aa) * (rr2 - len * 0.5));
      ctx.lineTo(cx + Math.cos(aa) * (rr2 + len * 0.5), cy + Math.sin(aa) * (rr2 + len * 0.5));
      ctx.strokeStyle = major ? 'rgba(240,215,154,.7)' : 'rgba(201,163,90,.38)';
      ctx.lineWidth = major ? 1.1 : 0.65;
      ctx.stroke();
    }

    /* month numbers every twenty lunations */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 ' + Math.max(5, R * 0.030) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(201,163,90,.42)';
    for (var ml = 0; ml < months; ml += 20) {
      var um = ml / (months - 1);
      var am = um * totalAngle - Math.PI / 2;
      var rm = CM.lerp(r0, r1, um) + R * 0.055;
      ctx.save();
      ctx.translate(cx + Math.cos(am) * rm, cy + Math.sin(am) * rm);
      ctx.rotate(am + Math.PI / 2);
      ctx.fillText(String(ml + 1), 0, 0);
      ctx.restore();
    }
    ctx.restore();

    /* eclipse glyphs */
    if (marks) {
      marks.forEach(function (mk) {
        var u3 = mk.month / (months - 1);
        var a3 = u3 * totalAngle - Math.PI / 2;
        var rr3 = CM.lerp(r0, r1, u3) + R * 0.028;
        var gx = cx + Math.cos(a3) * rr3;
        var gy = cy + Math.sin(a3) * rr3;
        if (mk.solar) {
          ctx.beginPath();
          ctx.arc(gx, gy, Math.max(1.8, R * 0.010), 0, TAU);
          ctx.fillStyle = 'rgba(240,207,125,.95)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(gx, gy, Math.max(0.8, R * 0.0045), 0, TAU);
          ctx.fillStyle = 'rgba(20,12,4,.95)';
          ctx.fill();
        }
        if (mk.lunar) {
          var off = mk.solar ? R * 0.020 : 0;
          ctx.beginPath();
          ctx.arc(gx + off, gy + (mk.solar ? R * 0.014 : 0), Math.max(1.6, R * 0.0085), 0, TAU);
          ctx.fillStyle = 'rgba(175,205,193,.9)';
          ctx.fill();
        }
      });
    }

    /* pointer */
    var pu = pointerMonth / (months - 1);
    var pa = pu * totalAngle - Math.PI / 2;
    var pr = CM.lerp(r0, r1, pu);
    ctx.save();
    ctx.strokeStyle = 'rgba(245,215,150,.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(pa) * R * 0.16, cy + Math.sin(pa) * R * 0.16);
    ctx.lineTo(cx + Math.cos(pa) * (pr + R * 0.045), cy + Math.sin(pa) * (pr + R * 0.045));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + Math.cos(pa) * (pr + R * 0.045), cy + Math.sin(pa) * (pr + R * 0.045), Math.max(2, R * 0.016), 0, TAU);
    ctx.fillStyle = '#f0d79a';
    ctx.fill();
    ctx.restore();

    /* center subsidiary dial */
    var subR = R * 0.19;
    ctx.beginPath();
    ctx.arc(cx, cy, subR, 0, TAU);
    ctx.fillStyle = 'rgba(9,7,5,.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,163,90,.32)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    for (var s = 0; s < subSectors; s++) {
      var sa = (s / subSectors) * TAU - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sa) * subR, cy + Math.sin(sa) * subR);
      ctx.strokeStyle = 'rgba(201,163,90,.2)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    var spa = ((subPointer + 0.5) / subSectors) * TAU - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(spa) * subR * 0.25, cy + Math.sin(spa) * subR * 0.25);
    ctx.lineTo(cx + Math.cos(spa) * subR * 0.88, cy + Math.sin(spa) * subR * 0.88);
    ctx.strokeStyle = 'rgba(240,215,154,.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, R * 0.012), 0, TAU);
    ctx.fillStyle = '#d8b66b';
    ctx.fill();

    /* labels */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + Math.max(7, R * 0.075) + 'px "Cinzel", serif';
    ctx.fillStyle = 'rgba(240,215,154,.7)';
    ctx.fillText(title, cx, cy - R * 1.14);
    if (!mobile) {
      ctx.font = '400 ' + Math.max(5.5, R * 0.045) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(201,163,90,.72)';
      ctx.fillText(subtitle, cx, cy + R * 1.16);
      ctx.font = '400 ' + Math.max(5, R * 0.038) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(201,163,90,.62)';
      ctx.fillText(subLabel + ' ' + (subPointer + 1) + '/' + subSectors, cx, cy + R * 1.26);
    }
    ctx.restore();
  }

  /* ---------- init ---------- */

  setJD(DEFAULT_JD, { silent: true, force: true });
  updateReadout();
  CM.onVisible(section, function () { animator.start(); }, function () { animator.stop(); }, '250px');
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) animator.stop();
    else if (section.getBoundingClientRect().bottom > 0) animator.start();
  });
})();
