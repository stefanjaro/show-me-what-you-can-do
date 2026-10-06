'use strict';
importScripts('core.js', 'model.js', 'train.js');

var model = null;
var tokens = null;
var microbatch = 4;
var accum = 1;
var block = 64;

function handleInit(d) {
  model = new SL.Transformer({
    vocab: d.config.vocab,
    dim: d.config.dim,
    heads: d.config.heads,
    layers: d.config.layers,
    block: d.config.block,
    hidden: d.config.hidden,
    dtype: 'f32',
    seed: 1
  });
  tokens = d.tokens;
  microbatch = d.microbatch;
  accum = d.accum;
  block = d.config.block;
}

function handleWeights(d) {
  if (!model) return;
  for (var i = 0; i < model.params.length; i++) {
    model.params[i].w.set(d.params[i]);
  }
}

function handleGrads(d) {
  if (!model) return;
  var rng = SL.rng.mulberry32(d.seed);
  model.ensureShape(microbatch, block);
  model.zeroGrad();
  var loss = 0;
  for (var a = 0; a < accum; a++) {
    var batch = SL.trainUtil.drawBatch(tokens, block, microbatch, rng);
    loss += model.forwardBackward(batch.idx, batch.tg);
  }
  var inv = 1 / accum;
  var grads = [];
  for (var i = 0; i < model.params.length; i++) {
    var g = model.params[i].g;
    for (var j = 0; j < g.length; j++) g[j] *= inv;
    grads.push(g.slice());
  }
  postMessage({ type: 'grads', loss: loss / accum, count: microbatch * accum, grads: grads });
}

onmessage = function (ev) {
  var d = ev.data;
  if (d.type === 'init') handleInit(d);
  else if (d.type === 'weights') handleWeights(d);
  else if (d.type === 'grads') handleGrads(d);
};
