# CANTUS MACHINA

An endless orchestra that composes itself — forever, differently, and exactly the
same every time. Live at [`../`](../) → **Open site**, or directly at
`index.html`. **Turn the sound on.**

`test/render-preview.mp3` is the piece rendered offline by the browser's own
audio engine (seed 42, bars 33–40) — proof that nothing here is a fake-out.

## What it is

A single deterministic engine of about 1,900 lines of dependency-free JavaScript
that writes and performs complete ambient compositions:

- **Composition** — movements (64 bars) chained through related keys and modes;
  per-mode diatonic progression pools with sevenths, suspensions and a borrowed
  minor iv; a motif per movement expressed in *diatonic steps*, so inversion,
  retrograde, augmentation and fragmentation can never leave the key; strong
  beats harmonized into the current chord; six named sections per movement
  (Threshold → Ground → Clearing → Drift → Signal → Horizon) shaping an energy
  curve that gates every voice.
- **Sound** — nothing is sampled. Seven instruments (detuned-saw pad, sub+bass,
  filtered pluck, FM-flute lead, 2-op FM chimes, synthesized drums, noise wind
  and risers) built from oscillators, biquads and envelopes; a stereo reverb
  whose impulse response is generated at startup (smoothed decaying noise with
  pre-delay and early reflections); ping-pong delay locked to the current tempo.
- **Voice** — the machine writes program notes about what it is doing, from
  real state: key relations, motif treatments, rest windows, borrowed notes
  from your jam keyboard.
- **Determinism** — every bar is a pure function of `(seed, bar)`. Bar 4,000
  already exists; `?seed=…&bar=…` share-links drop a visitor into your exact
  moment of the same infinite piece.

## Console

Space or the dial: play/pause · `A S D F G H J K L`: jam in the live scale
(the piece keeps its place while you play) · ⚄ roll: a new infinity ·
⎘ share this bar: copy a link to this exact moment.

## Architecture

| file | role |
|---|---|
| `js/rng.js` | hash streams — named, salted, reproducible random number streams |
| `js/theory.js` | scales, chords, nearest-octave voicing, motif operations, harmonization |
| `js/composer.js` | movements, form, progressions, motifs, per-voice bar generation |
| `js/notes.js` | the program-notes narrator |
| `js/synth.js` | Web Audio instrument engine (also renders offline via `OfflineAudioContext`) |
| `js/viz.js` | aurora spectrum, scrolling score, chord compass |
| `js/app.js` | transport, lookahead scheduler, UI |

## Testing (all green at time of writing)

```
node test/run.mjs      # composition engine: determinism over 7 seeds × 420 bars,
                       # chord spelling, voice leading (1.8 st avg motion),
                       # melody harmony (98.9% of strong beats are chord tones),
                       # form coverage, narrator sanity
node test/harness.mjs  # the whole browser app run headlessly against a fake DOM
                       # and fake Web Audio: transport, jumps, pause/resume, jam,
                       # seed roll — ~3,000 instrumented voices scheduled
```

Plus a Playwright run (kept out of the repo) that rendered `render-preview.mp3`
in real Chromium and verified: audible, unclipped (peak 0.68), genuinely stereo
(L/R correlation 0.48), reverb tail ringing after the notes stop, the URL state
round-trips, and zero console errors.
