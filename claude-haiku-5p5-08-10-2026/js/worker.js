/* ==========================================================================
   THE BLIND PHYSICIST · worker.js
   The search runs here, on its own thread, while the world keeps moving.
   Messages in:  {type:'reset', opts}  {type:'data', cols, y}  {type:'run', on}
   Messages out: {type:'status', pareto, stats}
   ========================================================================== */
importScripts('expr.js', 'gp.js');

var disc = null;
var running = false;
var looping = false;
var lastPost = 0;
var now = function () { return Date.now(); };

function post() {
  lastPost = now();
  self.postMessage({ type: 'status', pareto: disc.pareto(), stats: disc.stats() });
}

function loop() {
  if (!running || !disc) { looping = false; return; }
  if (disc.n > 0) disc.evolve(25);
  if (now() - lastPost > 250) post();
  setTimeout(loop, 0);
}

self.onmessage = function (e) {
  var m = e.data;
  if (m.type === 'reset') {
    disc = new BP.Discoverer(m.opts);
    lastPost = 0;
  } else if (m.type === 'data') {
    if (!disc) return;
    disc.setData(m.cols, m.y, m.norm);
    post();
  } else if (m.type === 'run') {
    running = !!m.on;
    if (running && !looping) { looping = true; loop(); }
  }
};
