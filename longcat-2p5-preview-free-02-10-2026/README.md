# LUMEN — Real-Time Path Tracer

A real-time path tracer running entirely in your browser. Built with pure JavaScript and Web Workers — no libraries, no assets, just math.

## Features

- **Global Illumination** — indirect lighting via Monte Carlo path tracing
- **Soft Shadows** — area lights produce physically accurate penumbras
- **Depth of Field** — adjustable aperture and focal distance
- **Volumetric Fog** — light scattering through participating media
- **Motion Blur** — temporal sampling for animated scenes
- **Multiple Materials** — Lambertian, Metal, Dielectric (glass), Emissive
- **Seven Scenes** — Observatory, Glass Garden, Metal Forge, Abstract, Caustics, Mirror Room, Neon City
- **Progressive Rendering** — image refines over time
- **Post-Processing** — bloom, vignette, chromatic aberration
- **Procedural Textures** — marble, wood, checkerboard, gradient
- **Render Animation** — capture orbit and export as WebM video
- **Full Camera Control** — orbit, zoom, pan, plus preset viewpoints
- **PNG Export** — save your renders with one click

## How It Works

LUMEN uses a pool of Web Workers to parallelize path tracing across all available CPU cores. Each worker renders a horizontal strip of the image, and results are composited in the main thread.

The path tracer implements:
- Cosine-weighted hemisphere sampling for diffuse surfaces
- Fresnel equations for glass and dielectric materials
- Next event estimation for direct lighting
- Russian roulette for path termination
- ACES tone mapping for HDR-to-LDR conversion

## Usage

Open `index.html` in a modern browser. The renderer starts automatically and progressively refines the image.

### Controls

- **Left-drag** — orbit camera
- **Right-drag** — pan camera
- **Scroll** — zoom
- **Scene buttons** — switch between scenes
- **Samples/Max Depth** — adjust render quality
- **Resolution** — change output size
- **FOV/Aperture/Focal Distance** — camera controls
- **Post-Processing** — toggle bloom, vignette, chromatic aberration
- **Progressive** — continuous refinement mode
- **Animate** — capture orbit and export WebM video
- **Export PNG** — save the current render

## Technical Details

- **Renderer**: Monte Carlo path tracing with next event estimation
- **Parallelism**: Web Workers (one per CPU core)
- **Sampling**: Progressive refinement with accumulation
- **Tone Mapping**: ACES filmic curve
- **Gamma Correction**: sRGB transfer function

## Performance

Render times vary by scene complexity, resolution, and sample count. A 640×480 render at 4 samples/pixel typically completes in 1-3 seconds on a modern multi-core machine. Higher sample counts produce cleaner images with less noise.

## License

MIT
