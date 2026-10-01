# CONTINUUM CA-7 — a virtual analog computer

Built by **mimo-v2.6-flash** for [*Show Me What You Can Do*](https://github.com/stefanjaro/show-me-what-you-can-do).

You solve differential equations the way engineers did before digital: by wiring the
mathematics and watching a voltage obey it. Nine patchable blocks on ±10 V rails, real patch
cords that sag under their own weight, two phosphor displays, a moving-coil meter and a
loudspeaker. Ten circuits come ready-patched, from a mass on a spring to the Lorenz attractor;
everything else is yours to build.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

No build step, no dependencies, no assets — plain HTML, CSS and JavaScript.

## What's here

```
index.html        the machine
manual.html       operator's manual: theory, block reference, derivations, numerical notes
css/site.css      page chrome
css/rig.css       the instrument: racks, panel, blocks, knobs, jacks, cords
css/manual.css    printed-manual styling
js/core.js        knob travel, ranges, helpers
js/modules.js     the nine block types and the four instrument units
js/engine.js      patch network, solver, recorders, share-link codec
js/presets.js     ten ready-patched circuits (each is a system of ODEs)
js/scope.js       phosphor displays
js/rig.js         panel rendering and every interaction
js/audio.js       VCO + worklet monitor
js/site.js        solver ownership, main loop, page wiring
js/dsp-worklet.js 4 kHz → device-rate resampling
test/run.js       76 assertions against physics
test/ui.js        18 assertions against the real page in headless Chromium
```

## How it works

Every circuit is a network of blocks that do one physical thing each: invert-and-sum, integrate,
multiply, bend, compare, oscillate. Integrators hold the state, which is why every feedback loop
has to pass through one — the same rule that makes a real analog computer work. The solver is
explicit trapezoidal (Heun) at 4 kHz with three network evaluations per step; outputs saturate at
the rails exactly as op-amps do; a loop with no integrator in it lights the `LOOP` lamp and gets
iterated to convergence.

## Tests

```bash
node test/run.js    # every preset vs an independent RK4 integration of the same equations,
                    # plus invariants: energy, conserved quantities, equilibria, periods,
                    # chaos statistics, saturation, share links, live edits, performance
NODE_PATH=<path-to-playwright-core> node test/ui.js   # optional: drags cords, turns knobs,
                    # builds blocks, shares and reloads a link, checks a phone's width
```

76 assertions in `test/run.js` and 18 in `test/ui.js`, all passing. Nothing on the panel was trusted on sight.

## Credits

Stefan Jaro for the prompt. Everyone who built one of the other folders — this entry was written
without looking at them.
