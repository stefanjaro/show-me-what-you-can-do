/* HILBERT'S GARDEN — main boot: rail, progress, the ledger. */
(function () {
'use strict';

/* ---------- rail ---------- */
var rail = document.getElementById('rail');
if (rail) {
  var cap = document.createElement('div');
  cap.className = 'rail-cap';
  cap.textContent = 'HG · MMXXVI';
  rail.appendChild(cap);
  var targets = [
    ['letter', '✦'],
    ['i1', 'I'], ['i2', 'II'], ['i3', 'III'], ['i4', 'IV'],
    ['i5', 'V'], ['i6', 'VI'], ['i7', 'VII'], ['i8', 'VIII'],
    ['i9', 'IX'], ['i10', 'X'], ['i11', 'XI'],
    ['ledger', '»']
  ];
  targets.forEach(function (t) {
    var a = document.createElement('a');
    a.href = '#' + t[0];
    a.textContent = t[1];
    a.setAttribute('aria-label', 'jump to section ' + t[1]);
    rail.appendChild(a);
  });

  var links = Array.prototype.slice.call(rail.querySelectorAll('a'));
  var sections = targets.map(function (t) { return document.getElementById(t[0]); });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('active'); });
          var idx = sections.indexOf(e.target);
          if (idx >= 0) links[idx].classList.add('active');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (s) { if (s) io.observe(s); });
  }
}

/* ---------- progress hairline ---------- */
var progress = document.getElementById('progress');
if (progress) {
  var updateProgress = function () {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var frac = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    progress.style.width = (frac * 100).toFixed(2) + '%';
  };
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();
}

/* ---------- the verification ledger ---------- */
function runLedger() {
  var tbody = document.querySelector('#lg-table tbody');
  var badge = document.getElementById('lg-status');
  if (!window.HGSuite || !tbody || !badge) return;
  var results = window.HGSuite.runSuite();
  var pass = 0;
  results.forEach(function (r, i) {
    if (r.pass) pass++;
    var tr = document.createElement('tr');
    var tdN = document.createElement('td');
    tdN.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);
    var tdName = document.createElement('td');
    tdName.className = 'lg-name';
    tdName.textContent = r.name;
    var tdRes = document.createElement('td');
    tdRes.className = r.pass ? 'lg-pass' : 'lg-fail';
    tdRes.textContent = r.pass ? (r.detail ? 'PASS · ' + r.detail : 'PASS') : 'FAIL · ' + r.detail;
    var tdMs = document.createElement('td');
    tdMs.className = 'lg-ms';
    tdMs.textContent = r.ms.toFixed(1) + ' ms';
    tr.appendChild(tdN); tr.appendChild(tdName); tr.appendChild(tdRes); tr.appendChild(tdMs);
    tbody.appendChild(tr);
  });
  if (pass === results.length) {
    badge.textContent = 'VERIFIED · ' + pass + '/' + results.length + ' · THIS PAGE RAN ITS OWN PHYSICS';
    badge.classList.remove('pending', 'fail');
  } else {
    badge.textContent = 'FAILED · ' + pass + '/' + results.length;
    badge.classList.remove('pending');
    badge.classList.add('fail');
  }
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(runLedger, 350);
} else {
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(runLedger, 350);
  });
}
})();
