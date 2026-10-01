# SPACE BUNNY №1

**Four instruments, built from simple rules.**

A single-page site containing four live simulations, written from scratch in one
session by one language model. No libraries, no frameworks, no bundler, no build
step, no image files, no analytics, no tracking. Open `index.html` through any
static file server and it runs.

The through-line is that beautiful things tend not to be designed. They are the
residue of simple rules, given time. Each instrument below starts with a handful
of numbers, runs one tiny rule over and over, and lets the pattern do the rest.

---

## №1 · The Culture — reaction & diffusion

Two invisible chemicals drift across a grid. `A` is fed in at rate `F`; `B`
eats `A` to make more of itself and dies at rate `k`. That is the entire
rulebook.

```
∂A/∂t = Da∇²A − AB² + F(1 − A)
∂B/∂t = Db∇²B + AB² − (F + k)B
```

Alan Turing published this in 1952 to explain why a cow is patched. It is also
the reason no two fingerprints match, and the reason you can grow bacteria in a
dish and watch them invent geometry.

* **Nine-point isotropic Laplacian.** A five-point stencil on a square grid
  betrays its own lattice and every pattern comes out square. Weighting the
  diagonals to match the axes costs nothing and removes the artefact.
* **Forward Euler on the GPU.** The obvious implementation is 65 536 cells of
  JavaScript per frame. Instead the whole grid is one fragment shader and every
  cell is solved in parallel; a full-screen triangle is all the geometry there
  is.
* **Relief rendering.** `B` is read as a height field, differentiated into a
  normal, and lit from the upper left. It stops looking like mathematics and
  starts looking like something that grew.

Drag on the plate to inject `B` by hand. Six morphologies, two sliders.

## №2 · The Dreamer — a neural network, from nothing

Draw anything. The network has never seen it and will never see it again. It
starts from random weights every single time, guesses, measures how badly it
did, and corrects itself by differentiating its own mistake.

```
ŷ = σ(W₁σ(W₂σ(…W_L · [x, y, sin 3x, cos 3y])))
L = (1/B) Σ (ŷ − y)²     ∂L/∂ŷ = (2/B)(ŷ − y)     ∂L/∂W = xᵀ·∂L/∂ŷ
```

* **A hand-written optimiser set.** Adam with bias correction, plain SGD, and
  heavy-ball momentum, all about thirty lines each. No autodiff library — the
  gradient of a mean-squared error with respect to a prediction is
  `2(ŷ − y)/B`, and from there the chain rule is bookkeeping.
* **Minibatches of 168 from a grid of 1024 points.** Using all of them costs
  proportionally more for an answer that is no less correct.
* **Weights stored output-major.** `[out][in]` rather than `[in][out]`. The
  arithmetic is identical; walking memory in a straight line instead of in
  strides is worth about 40%.
* **The graph is built once and refilled forever.** The obvious way to write
  this allocates half a megabyte of `Float32Array`s per training step, which
  costs more than all the arithmetic put together.
* **The neuron panels are not decoration.** They are each hidden unit evaluated
  across the entire plane — the question "how much, here, at this x and this
  y?" — with per-unit contrast. Within a few hundred steps each unit settles on
  a private opinion about the world. Some find edges. One always finds the
  diagonal.

The loss figure on screen is the exact mean squared error over the whole grid,
computed by one extra full forward pass every third frame. The counter in the
corner is a real count of the multiply-accumulates performed since the page
loaded.

## №3 · The Light — a path tracer in a browser tab

A Cornell box: five walls, a hanging lamp, four analytic spheres. No vertices,
no triangles, no textures, no mesh of any kind.

```
L(x₀, ω) = L(x_t, ω_t) · β(x_t, −ω_t, ω)
β        = albedo · cosθ / π
E[L]     = (1/N) Σ Lᵢ
```

* **Progressive accumulation** into a half-open float render target. Each frame
  adds a few more paths per pixel and divides by the running count on the way
  out. The image is noisy and then, while you are not moving, it is not.
* **Next-event estimation.** At every diffuse surface, pick one random point on
  the lamp, walk a single shadow ray at it, and add what arrives. Without this
  the lamp is a small bright thing that a cosine-sampled ray almost never
  happens to find, and the picture stays full of fireflies for minutes. The
  lamp is then removed from the random walk for non-specular paths so it is
  never counted twice.
* **Fresnel by Schlick, Beer–Lambert absorption, Russian roulette** after three
  bounces, a thin lens for depth of field, and the Narkowicz ACES curve fitted
  in 2015 standing in for a hundred years of photographic chemistry.
* **The pink cast on the white floor is not art direction.** It is the red wall
  reflecting into it, correctly, because the only rule implemented was an
  integral over a solid angle.

Drag to orbit, scroll to dolly, move a slider and watch the average restart.

## №4 · The Weather — an incompressible fluid

Jos Stam's *Stable Fluids* (1999), which is why every weather effect you have
seen in a game, a title sequence or a film runs at sixty frames a second.

```
∂u/∂t = −(u·∇)u − ∇p + ν∇²u + f      ∇·u = 0
pᵢ = (Σ p_j − ∇·u) / 4               28 sweeps per frame
```

* **Semi-Lagrangian advection.** To find where a parcel of dye ends up, walk
  *backwards* along the velocity field from the pixel and ask where it came
  from. Unconditionally stable, which is the whole trick.
* **Twenty-eight Jacobi sweeps** of the pressure Poisson equation, then
  subtract the gradient. Each cell asks its neighbours which way the wind is
  already blowing, works out how far it has been squeezed, and tries very hard
  to un-squeeze itself. That sounds like nothing at all, and yet a front, an
  eddy behind it, and a plume that rolls over on itself all come out of the
  subtraction.
* **Vorticity confinement** puts back the curl that numerical diffusion ate, so
  the small eddies survive; **buoyancy** makes bright dye climb.
* The grid carries the same shape as the window and is a third of its size.
  A square grid stretched across 16:9 makes the brush elliptical and the
  vortices oblong, which is a lie about the air.

---

## Engineering notes

* `assets/js/core.js` — the only shared code. A small WebGL 2 layer (program
  wrapper with typed uniform setters, ping-pong float render targets, adaptive
  precision), a frame scheduler that puts instruments to sleep when they scroll
  out of view, a unified pointer abstraction, and a source viewer that fetches
  and highlights the real file it is running.
* Every instrument registers with one declarative spec and gets its sliders,
  segmented presets, hide toggle, viewport gating and live readout for free.
* `read the source` on any instrument panel `fetch()`es that file and paints it.
  What you see is the code that produced the pixels above it, not a copy.
* Nothing allocates in any per-frame hot path in №2; §3 and §4 are GPU-resident
  throughout.
* Instruments never run while off-screen, and every one of them steps its own
  resolution down if the machine cannot hold a frame rate.

## Running it

```sh
python3 -m http.server 8000
# then open http://localhost:8000/space-bunny-01-10-2026/
```

A server is required (not `file://`) only because the source viewer uses
`fetch()`. Everything else works either way.

4 106 lines of hand-written code, and the only two external requests are two
web fonts.

## Requirements

WebGL 2 with `EXT_color_buffer_float` — Chrome, Firefox and Safari have all
supported it for years. №2 is pure JavaScript and runs regardless. If the
floating-point render targets are missing, §1 falls back to a 128×128 CPU
solver and §3 and §4 say so plainly rather than showing a black rectangle.
