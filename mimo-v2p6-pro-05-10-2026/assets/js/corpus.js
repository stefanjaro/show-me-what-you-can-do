(function (global) {
  'use strict';
  var SL = global.SL || (global.SL = {});

  function build(text) {
    var tok = new SL.CharTokenizer(text);
    var tokens = tok.encode(text);
    return { tokenizer: tok, tokens: tokens, text: text };
  }

  function probeFor(id) {
    if (id === 'station') {
      return [
        { label: 'a log entry', prompt: '2214-03-1' },
        { label: 'the night', prompt: 'seeing 3 of 5. The comet' }
      ];
    }
    if (id === 'custom') {
      return [{ label: 'the text', prompt: 'The ' }];
    }
    return [
      { label: 'a saying', prompt: 'A map is not a country. A map is' },
      { label: 'the fable', prompt: 'There was once a map maker who' },
      { label: 'the machine', prompt: 'The machine does not read. It' }
    ];
  }

  SL.corpus = {
    build: build,
    probeFor: probeFor,
    byId: function (id) {
      if (id === 'custom') return null;
      return SL.books[id] || null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
