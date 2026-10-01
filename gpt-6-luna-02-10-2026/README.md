# The Elsewhere Atlas

A standalone, no-build generative mapmaking studio. Open `index.html`, or serve this folder as a static site. It has no dependencies, third-party assets, tracking, API calls, or server-side processing.

## Making a chart

Enter up to 180 characters about a remembered place. The sentence is hashed locally into a repeatable seed for the atlas's procedural terrain: three scales of value noise and 23 seeded hills and hollows, shaded into a small heightfield. The heightfield is traced into nineteen isolines using marching squares. A meandering river, a wandering route, and eight imaginary place names are generated from the same seed. A moving light travels along the water; the time dial recolors the whole chart from first light to night.

Every layer can be toggled independently. Click the map to drop your pin, save a high-resolution PNG, or copy a URL that reconstructs the chart. A share URL contains the memory text, selected layers, light, and optional pin; the text is only put in a link when someone chooses to share it. Nothing is sent to a service.

## Implementation

- `index.html` — semantic page, form, studio, and field notes
- `style.css` — responsive art direction, controls, reduced-motion support, and print layout
- `app.js` — seeded terrain generator, marching-squares renderer, canvas interactions, and local chart export

All type, decoration, terrain, rivers, routes, paper grain, and colors are drawn or styled locally. There is no package manager or build step.
