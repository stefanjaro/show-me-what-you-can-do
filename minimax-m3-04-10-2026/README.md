# PROTOGAIA — a world that builds itself

A complete artificial life simulator, written from scratch in plain JavaScript with no libraries. Watch and shape a 2D world where creatures with neural-network brains are born, eat, fight, mate, mutate and speciate over thousands of generations.

**~5,000 lines of vanilla JavaScript, HTML and CSS — zero dependencies, zero build step, zero assets.**

## What you'll see

The moment you open it, a tiny archipelago appears. Eight founders — random neural-network-brained creatures with randomised bodies — are dropped into a clearing and left to themselves. Within minutes you'll see them flock, graze, fight, mate, give birth. Within hours they'll have speciated: a fast herding herbivore, a sluggish carnivore lurking at the edges, a tiny scavenger. Some will go extinct. New branches of the tree of life will form. The chronicle on the right records every speciation and extinction in procedural Latin.

There is no goal. The world is yours to perturb, or to leave alone.

## Controls

| | |
|---|---|
| **Click** | paint with the active brush (Shift = subtract) |
| **Right-drag** / **Middle-drag** | pan |
| **Scroll** | zoom |
| **Ctrl-click** | spawn a single random creature at the cursor |
| **Space** | pause / resume |
| **.** | step one frame |
| **+ / −** | cycle simulation speed (×0.25 → ×32) |
| **Tab** | cycle modes: paint, follow, control, observe |
| **R** | spawn a creature at the cursor |
| **F** | drop food at the cursor |
| **1–7** | pick a brush |
| **Esc** | deselect / stop following |

When **following** a creature, the camera locks onto it. When **controlling** it, the brain is bypassed and you drive it directly with **WASD / Arrows**, **E** to force it to eat.

## Brushes

- **Food** — red meat piles; creatures prefer them, especially carnivores
- **Plants** — vegetation, the slow-growing staple of herbivores
- **Water** — turns a tile into impassable water
- **Mountain** — turns a tile into impassable mountain
- **Heat** — a pulsing warm spot (visual only)
- **Grass** — reset a tile to grassland
- **Clear** — wipe food piles (leave plants alone)

## View modes

- **Surface** — normal terrain
- **Traits** — fertility heatmap (where life can flourish)
- **Energy** — plant density / climate visualisation
- **X-ray** — each creature shows its neural network instead of its body

## Brain

Every creature has a small feed-forward neural net with 11 sensors and a number of outputs (one per limb + thrust + turn + bias). The sensors are:

1. distance to nearest creature in the forward cone
2. type hint (prey / predator / friend)
3. local ground fertility
4. local plant density (smell)
5. local prey density
6. hunger
7. energy level
8. temperature
9. forward velocity
10. oscillator (helps evolve gait)
11. oscillator

The brains are randomly initialised, then evolved with crossover and mutation. Speciation happens when a child's genome drifts more than 0.10 from the closest living species in both gene-space and brain-space.

## Genetics

16-gene genomes encode body size, top speed, vision range, stomach capacity, metabolic rate, lifespan, maturity age, fertility, hue / saturation / lightness, limb count, mouth size, carnivory preference, herbivory preference and aggression.

## Code layout

```
index.html         entry, DOM scaffolding, overlay
style.css          all styling
js/utils.js        RNG, noise, math, naming
js/audio.js        procedural music + SFX
js/brain.js        feed-forward neural net
js/genome.js       16-gene body plan
js/creature.js     bodies, sensors, motors, lifecycle
js/world.js         the world, terrain, plants, spatial index
js/evolution.js    speciation, phylogeny, chronicle
js/render.js       canvas renderer, view modes, panels
js/ui.js           DOM bindings
js/main.js         the loop, integration, state
```

No build step. Open `index.html` from any static server.

## Notes on this site

PROTOGAIA was built as part of a one-prompt challenge against other models. The workspace, design, and idea were chosen without looking at the other models' sites. The full source is here for anyone who wants to read, learn from, or fork it.

> *A world that builds itself.*