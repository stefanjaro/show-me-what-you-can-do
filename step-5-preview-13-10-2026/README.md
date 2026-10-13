# THE IMPOSSIBLE HOUSE

A playable museum of non-Euclidean architecture, built by a 3D engine written
from scratch in plain JavaScript. No engine, no WebGL, no libraries, no build
step, no image files, no audio files — only code.

**[Enter the house →](house.html)** &nbsp;·&nbsp; **[The blueprint →](blueprint.html)**

## What is here

| | |
|---|---|
| `index.html` | the front page. Its background is not a video: the real renderer is walking a real visitor through the real house, on a loop |
| `house.html` | the house itself: 52 rooms, four seals, four impossibilities |
| `blueprint.html` | how it works, with live renders from the engine and a contact sheet of the procedural textures |
| `js/core/` | the engine: noise, maths, textures, renderer, audio |
| `js/world/` | the house: geometry, doorways, the world, the visitor |
| `js/game/` | input, movement, HUD, the atlas, the front page |
| `dev/` | headless verification — the engine runs in Node |

## The four impossibilities

1. **The Hall of Turning** — four rooms in a ring; three doors are ordinary,
   the fourth is twisted a quarter turn about its own vertical. The ring carries
   holonomy: walk the loop and you come back facing the wrong way.
2. **The Penrose Ascent** — twelve steps to a flight, four flights to a circuit,
   and the top of every circuit is the bottom of the next, one landing higher.
3. **The Recessional** — seven rooms, each four fifths of the last, each turned a
   quarter turn. The renderer recurses until it runs out of depth.
4. **The Inverted Chapel** — a hatch cut high in the vault, hinged about
   nothing. Step through and stand on the ceiling.

A fifth wing, **the Core**, opens when the four seals are gathered.

## How the impossible part works

Rooms are convex brushes. Doorways are windows in their faces, and each window
is glued to a window in another room by a rigid transform:

```
X  =  [ −u_B  v_B  −n_B ] · [ u_A  v_A  n_A ]ᵀ ,   t = c_B − R·c_A
```

For two doors lying back to back on the same wall this is exactly the identity —
you can walk through it and nothing about you changes, which is what fixes the
signs. The minus on `u_B` keeps it orientation preserving: do it the other way
and you get a mirror world. On top of the gluing, a door can carry a twist about
the far door's own frame; half a turn about its width axis stands you on the
ceiling without turning you round.

The renderer culls by portals: rooms are convex, so the view is walked from room
to room through doorways, each level clipped to the cone of directions visible
through that doorway, and a z-buffer does the rest.

## Checking it

```
node dev/tests.js        # 82 checks: clipping, frustums, portal algebra,
                         # linkage, holonomy, the recession, the ascent, the
                         # inversion, the renderer, and the visitor
node dev/game-smoke.js   # 13 checks: the game layer boots, walks, reads,
                         # travels, takes seals, opens the core
node dev/page-smoke.js   # the front page drives its own itinerary
node dev/preview.js      # renders any view of the house as ASCII
```

## Controls

`W A S D` walk · mouse look · `Shift` hurry · `E` read / take · `M` atlas ·
`Esc` close. Touch is supported: left thumb walks, right thumb looks.
