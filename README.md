# Open Ocean 🌊

A real-time, **Sea-of-Thieves-style ocean** that runs in the browser — a Tessendorf
**FFT** wave simulation (JONSWAP spectrum, stacked cascades) with stylized
subsurface-scatter shading, persistent foam, and a **sailable boat** driven by real
rigid-body buoyancy.

The entire FFT runs on the **GPU** via fragment-shader ping-pong — no compute shaders —
so it works on WebGL2 (i.e. most laptops and phones), not just bleeding-edge hardware.

<p align="center">
  <img src="docs/demo.webp" width="100%" alt="FFT ocean — a small boat sailing rough turquoise seas">
</p>

Built with [three.js](https://threejs.org) + WebGL2 + [Vite](https://vitejs.dev).

---

## Contents

- [Quick start](#quick-start)
- [Adding the boat (optional)](#adding-the-boat-optional)
- [Controls](#controls)
- [Configuration & live tuning](#configuration--live-tuning)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Tests](#tests)
- [Performance notes](#performance-notes)
- [Credits & licensing](#credits--licensing)

---

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org) **18+** and a browser with WebGL2
(every current Chrome / Firefox / Safari / Edge, desktop or mobile).

```bash
# 1. clone
git clone https://github.com/0-robert/open-ocean.git
cd open-ocean

# 2. install dependencies
npm install

# 3. run the dev server (opens http://localhost:5173)
npm run dev
```

That's it — you'll get the full ocean immediately. The boat is optional (see below).

Other scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with hot-reload at `localhost:5173`. |
| `npm run build` | Production build into `dist/`. |
| `npm run preview` | Serve the built `dist/` locally to sanity-check a production build. |
| `npm test` | Run the unit tests (Vitest). |

---

## Adding the boat (optional)

The ocean runs on its own — **the boat is not required**, and the model is **not
bundled** in this repo (the one in the demo is under the Sketchfab Standard License,
which forbids redistributing the files). Without a model you simply see the open sea;
with one you get a sailable, physically-buoyant boat.

To add a boat, drop a glTF model here:

```
public/models/boat/Small_Sailing_Boat.gltf   (+ its .bin and images/ next to it)
```

The loader expects a node named `Small_Sailing_Boat_1_2`; for a different model, adjust
the lookup and the scale/draft constants at the top of [`src/objects/Boat.js`](src/objects/Boat.js).
Anything under `public/` is served at the site root, so the path the code requests is
`models/boat/Small_Sailing_Boat.gltf`.

> The exact model used in the demo is *"Small Sailing Boat" by kraffing*
> ([Sketchfab](https://sketchfab.com/3d-models/small-sailing-boat-e11b3012941b421fb192fb57d5b38d78)).
> Download your own copy as glTF if you want the identical look.

---

## Controls

| Input | Action |
|---|---|
| **W / S** | Throttle forward / reverse |
| **A / D** | Steer (rudder authority scales with speed — no speed, no turn) |
| **Mouse drag** | Orbit the camera |
| **Scroll** | Zoom in / out |
| **✕** (top-right panel) | Removes the live tuning panel; reload to bring it back |

**Debug views:** append `?debug=disp`, `?debug=slope`, or `?debug=height` to the URL to
render a raw FFT cascade texture fullscreen (useful when hacking on the shaders).

---

## Configuration & live tuning

Every tunable lives in [`src/config.js`](src/config.js) — wave height, choppiness, wind
speed/direction, JONSWAP spectrum, foam behaviour, water colors, lighting, fog, and the
boat's buoyancy/handling.

A **lil-gui tuning panel** is shown on load so you can adjust most of these *live* and
watch the ocean change in real time (wind changes rebuild the spectrum on the fly). Once
you've dialled in a look, copy the values back into `config.js` to make them the
defaults. Click the panel's **✕** to dismiss it.

---

## How it works

The simulation is a GPU implementation of Jerry Tessendorf's *Simulating Ocean Water*.
Each frame, per cascade:

1. **Spectrum** — a JONSWAP wave spectrum seeds an initial frequency-domain field `H₀`.
2. **Time evolution** — `H₀` is advanced to the current time using the deep/finite-depth
   dispersion relation `ω = √(g·k·tanh(k·d))`.
3. **Inverse FFT** — the spectrum is transformed back to a spatial height/displacement
   field with a GPU inverse FFT: ping-ponging between two render targets, driven by a
   **precomputed butterfly (twiddle) texture**, instead of a compute shader.
4. **Assembly** — height + horizontal (choppy) displacement + slope/normal maps are
   packed into textures.
5. **Foam** — whitecaps are derived from the wave Jacobian and accumulated into a buffer
   that **persists, advects downwind, and decays**, so foam streaks trail realistically.

Several **cascades** at non-harmonic patch sizes (swell / waves / ripples) are summed so
the tiling period is effectively invisible. The surface shader adds stylized
subsurface-scatter glow, roughness-aware Fresnel, height-driven deep→turquoise color,
distance normal-fade, and horizon fog. A separate **world-space wake trail** follows the
boat's actual path, and a **windowed GPU read-back** feeds the boat's buoyancy without
stalling on a full-texture `readPixels` every frame.

| File | Responsibility |
|---|---|
| [`src/wave/OceanSim.js`](src/wave/OceanSim.js) | Per-frame GPU pipeline: spectrum → time-evolve → inverse FFT → map assembly → foam, per cascade |
| [`src/wave/fft.js`](src/wave/fft.js), [`butterfly.js`](src/wave/butterfly.js) | Ping-pong inverse FFT + precomputed butterfly/twiddle texture |
| [`src/wave/spectrumPass.js`](src/wave/spectrumPass.js), [`src/glsl/jonswap.glsl.js`](src/glsl/jonswap.glsl.js) | JONSWAP initial spectrum |
| [`src/ocean/oceanMaterial.js`](src/ocean/oceanMaterial.js) | Surface shader: SSS, Fresnel, height color, foam, fog, hull displacement |
| [`src/wave/WakeTrail.js`](src/wave/WakeTrail.js) | World-space foam trail behind the boat |
| [`src/wave/OceanSampler.js`](src/wave/OceanSampler.js) | Windowed GPU read-back for boat buoyancy queries |
| [`src/objects/Boat.js`](src/objects/Boat.js) | Rigid-body buoyancy (gravity + Archimedes force + righting torque) + driving |
| [`src/camera/OrbitFollowControls.js`](src/camera/OrbitFollowControls.js) | Orbit/zoom camera that follows the boat |
| [`src/config.js`](src/config.js) | All tunable parameters |

---

## Project structure

```
open-ocean/
├── index.html              # entry; mounts the canvas + src/main.js
├── src/
│   ├── main.js             # scene setup, render loop, wiring
│   ├── config.js           # all tunable parameters
│   ├── core/               # renderer + fullscreen-pass helpers
│   ├── wave/               # FFT engine, spectrum, foam, wake, sampler
│   ├── ocean/              # the water ShaderMaterial
│   ├── objects/            # the boat (buoyancy + driving)
│   ├── camera/             # orbit-follow camera
│   ├── glsl/               # shared GLSL chunks (JONSWAP, complex math, sky)
│   └── ui/                 # lil-gui tuning panel
├── tests/                  # Vitest unit tests
├── public/                 # static assets served at site root (textures, your boat)
└── docs/                   # demo media + design notes
```

---

## Deployment

It's a static Vite site — `npm run build` produces a self-contained `dist/` you can host
anywhere (Cloudflare Pages, Netlify, Vercel, GitHub Pages, S3, …).

> ⚠️ **The boat model isn't in the repo.** A CI/Git-connected build won't include it. To
> ship a demo *with* the boat, build locally (where your model lives in
> `public/models/boat/`) and upload the resulting `dist/` directly.

### Cloudflare Pages — direct upload (includes the boat) — recommended

```bash
npm install
npm run build                                   # Vite copies public/ (incl. your boat) into dist/
npx wrangler pages deploy dist --project-name open-ocean
```

The first run logs you into Cloudflare in the browser, creates the Pages project, and
returns a `open-ocean.pages.dev` URL. Re-run the same command to redeploy.

### Cloudflare Pages — Git integration (auto-deploy, no boat)

Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → select this repo, then:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Framework preset:** Vite

Every push to `main` rebuilds and deploys. The boat won't appear (model not committed).

**Custom domain:** in the Pages project → **Custom domains**, add a subdomain (e.g.
`ocean.example.com`). If your DNS is already on Cloudflare it's a one-click setup, no DNS
edits. The default `base: '/'` works on `*.pages.dev` and on a domain root; only set
`base: '/subpath/'` in `vite.config.js` if you serve it from a sub-path.

---

## Tests

```bash
npm test
```

Covers the CPU FFT reference, the GPU butterfly texel layout (the regression test for the
exact bug that turns the ocean into moiré noise), the JONSWAP parameter math, the
orbit-camera clamps, and the height sampler.

---

## Performance notes

- **No compute shaders.** The whole FFT is fragment-shader ping-pong, so it runs on plain
  WebGL2 — broad device support, including mobile.
- **Windowed read-back.** Boat buoyancy reads only a small `W×W` window of the height
  texture around the hull (O(W²)) instead of the full `N×N` map (O(N²)) — ~60× less
  per-frame read-back, which avoids the `readPixels` GPU stall.
- **Cascade frequency bands.** Each cascade is band-limited by wavenumber so stacking them
  doesn't double-count overlapping frequencies.

Knobs in `config.js` that trade quality for speed: `sim.N` (FFT resolution per cascade),
the number of `sim.cascades`, and `mesh.quadRes` (surface tessellation).

---

## Credits & licensing

Code in `src/` is **MIT** — see [`LICENSE`](LICENSE). Third-party:

- **three.js**, **lil-gui** — MIT.
- The FFT/JONSWAP approach follows Tessendorf's *Simulating Ocean Water* and was informed
  by [GarrettGunnell/Water](https://github.com/GarrettGunnell/Water); the GLSL here is an
  original WebGL2 implementation.
- **Boat model** — *not included*; the demo used *"Small Sailing Boat"* by **kraffing**
  (Sketchfab Standard License — not redistributed here; see
  [Adding the boat](#adding-the-boat-optional)).
- `public/textures/waternormals.jpg` — from the three.js examples.
