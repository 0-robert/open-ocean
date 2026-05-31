# FFT Ocean Water Simulation - Design

**Date:** 2026-05-30
**Status:** Approved for planning

## 1. Goal

A browser game featuring an **endless ocean** whose water looks like *Sea of Thieves*. This spec covers **the water simulation and rendering only**. A user-controlled boat and **buoyancy** are an explicit *next* phase - out of scope here - but the architecture must expose a clean seam so that integration is straightforward later.

### Non-goals (this phase)
- Boat, player controls beyond a free-roaming camera, buoyancy physics, wakes.
- Sea-spray particles, underwater rendering.
- Networking, gameplay, audio.

## 2. Background research

*Sea of Thieves* water (and Black Flag, Crysis, and the *Titanic* CGI) is a genuine ocean simulation based on **Jerry Tessendorf's FFT method** ("Simulating Ocean Water", 2004). Oceanographic literature treats **Gerstner waves as unrealistic**; the FFT approach is the accepted technique. Key elements, drawn from Tessendorf, the Acerola video "I Tried Simulating The Entire Ocean", and the *Atlas* GDC talk:

- The ocean is built in the **frequency domain** by sampling an oceanographic **spectrum** times Gaussian random numbers, then converted to a spatial heightfield via an **inverse FFT** (O(n log n); naive DFT at O(n²) is too slow).
- SoT used the **Phillips spectrum**; the *Atlas* team recommend **JONSWAP** instead - more art-direction control (wind speed/direction/fetch, peak, directional spread, amplitude override, low-pass). We use JONSWAP.
- **Horizontal (choppy) displacement** via additional IFFTs gives peaked, realistic waves.
- **Cascades:** several FFT simulations at different spatial scales, summed, eliminate visible tiling and combine big swells with fine chop.
- **Lighting** is a stylized **subsurface-scattering approximation** (the *Atlas* scatter terms), specular, and environment reflection - not strictly PBR.
- **Foam** is detected from the **Jacobian** of the displacement (negative where waves curl/break) and **accumulated in a texture with exponential decay**.

## 3. Technology choices

| Decision | Choice | Rationale |
|---|---|---|
| Render API | **WebGL2** | Maximum device reach incl. older/mobile/Safari. WebGPU is faster but unavailable on the weak devices we target. |
| Framework | **Three.js** | Handles camera, math, render targets, loaders, GLSL chunk injection. Per-frame overhead negligible vs. raw WebGL for one ocean surface. |
| Build tool | **Vite** | Instant dev server + HMR; trivial static build. |
| Language | **Plain JS + JSDoc** | Keeps it light; JSDoc documents wave/sampler interfaces. Easy upgrade to TypeScript later for the buoyancy work. |
| Compute | **Ping-pong fragment-shader FFT** | WebGL2 has no compute shaders. Render-to-float-texture butterfly passes are the proven approach (cf. David Li's WebGL ocean, runs on integrated GPUs). |
| Mesh | **Nested LOD-ring clipmap** | WebGL2 has no hardware tessellation. Clipmap rings give constant vertex budget to the horizon and sample displacement via vertex texture fetch. |

**Required WebGL2 capabilities:** float/half-float color-renderable textures (`EXT_color_buffer_float`, with `RGBA16F` half-float preferred for speed/memory), vertex texture fetch (guaranteed in WebGL2), `OES_texture_float_linear` for bilinear sampling of displacement (fall back to manual bilinear if absent).

## 4. The FFT ocean simulation

### 4.1 Spectrum (built once per cascade)
`SpectrumGen` builds the initial complex spectrum **H̃₀(k)** into a texture: for each texel, wavevector **k** is derived from texel position and the cascade's patch size `L`; amplitude comes from the **JONSWAP** spectrum evaluated at |k| and direction, multiplied by two Gaussian random numbers (real + imaginary). A conjugate term **H̃₀*(−k)** is also stored so the time-evolved field is real.

JONSWAP parameters (in `config.js`, per cascade): wind speed, wind direction, fetch, peak enhancement γ, directional spread, amplitude scale, and a low-pass cutoff. Cascades use different patch sizes `L` (e.g. large swell vs. fine chop) and tiling rates.

### 4.2 Time evolution (per frame)
For each texel, evolve the frequency by Euler's formula `H̃(k,t) = H̃₀(k)·e^{iω(k)t} + H̃₀*(−k)·e^{−iω(k)t}`, with the deep-water dispersion relation `ω(k) = √(g·|k|)`, `g = 9.81`. This pass outputs, packed across render targets, the spectra needed for: vertical height, **x** and **z** horizontal displacement, and slope (∂/∂x, ∂/∂z) for normals.

### 4.3 Inverse FFT
`FFT` performs an inverse FFT per output field by ping-pong butterfly passes: `log₂N` horizontal passes then `log₂N` vertical passes, alternating between two render targets, using a precomputed **butterfly/twiddle texture**. Output spatial textures per cascade:
- **Displacement** (x, y, z) - y is height, x/z are choppy displacement.
- **Slope/normal** - exact normals from the slope IFFTs (cheaper central-difference normals are a fallback quality option).
- **Jacobian** - folding metric for foam.

### 4.4 Cascades and combination
`OceanSim` runs the above for **N cascades** and sums their contributions into combined displacement/normal/Jacobian results consumed by the renderer.

**Quality presets** (switchable at runtime; auto-detected on first load with **Low** as the safe fallback):

| Preset | Cascades × size | Approx. waves | Target |
|---|---|---|---|
| Low | 2 × 128² | ~33k | integrated/old GPUs, mobile |
| **Medium (default)** | **2 × 256²** | **~131k** | most laptops |
| High | 4 × 256² | ~262k | discrete GPUs |

(A 256² simulation is ~65k waves; the video's hero shot used 4 × 1024² ≈ 4M, which targets discrete desktop GPUs and is out of scope for our weak-device goal. A 1024² "Ultra" preset could be added later for high-end hardware.)

If measured frame time exceeds a budget over a rolling window, auto-downgrade one preset.

### 4.5 Foam
A persistent **foam texture** is updated each frame: where the combined **Jacobian < threshold** (waves folding), inject foam; apply **exponential decay** everywhere each frame so foam accumulates in turbulent areas and dissolves gradually. A `foamBias` knob increases coverage. Flat foam color initially; a stylized foam texture is a later enhancement.

## 5. Mesh - endless clipmap

`OceanMesh` builds **concentric LOD rings**: an inner finely-tessellated grid surrounded by rings whose cell size doubles outward, each ring an L-shaped band covering the area its inner neighbour does not. Every frame:
- **Re-center** the whole structure on the camera focal point; **snap** each ring to its own cell-size grid so vertices don't swim.
- The **vertex shader** samples the combined displacement texture(s) (vertex texture fetch) to raise and chop each vertex.
- **Distance fog** tinted to the sky color hides the outermost ring edge → seamless horizon.
- **Endless travel:** focal-point world coordinates accumulate as the player moves; when the offset grows large enough to risk float precision in the spectrum sampling, **rebase the world origin** (shift focal point and an accumulated offset uniform together) so high-frequency detail stays crisp arbitrarily far out.

Optional geomorph (CDLOD-style vertex morph across ring boundaries) is a later enhancement if popping is visible; Gerstner-free FFT displacement is smooth, so it is not expected to be necessary at first.

## 6. Shading - stylized, SoT-like

Implemented in `oceanMaterial` (Three.js `ShaderMaterial`):
- **Subsurface-scattering scatter term** (Atlas approximation): `scatterHeight + normalVisibility + Lambert + ambient`, each multiplied by a scatter color (blue), sun color, and ambient color - yields the green-blue hues of real water.
- **Specular:** Blinn-Phong initially (PBR microfacet a later enhancement) for sun glints.
- **Environment reflection:** Fresnel (Schlick) mix toward the sky color/cubemap at grazing angles.
- **Height color gradient:** deep trough color → bright crest color, reinforcing the SoT read.
- **Foam:** sampled from the foam texture, blended white over the surface.

`Sky` provides a gradient sky dome + directional sun, the reflection source, and fog parameters shared with the ocean material.

## 7. Camera & controls - Roblox-style orbit-follow

`OrbitFollowControls`:
- **Mouse drag** orbits (yaw/pitch) around the focal point.
- **Scroll wheel** zooms (clamped min/max).
- **WASD** glides the focal point across the sea, camera-relative.
- Camera trails the focal point's horizontal position with a **smoothed height** so wave bob does not induce motion sickness.

The focal point is the world anchor for the LOD-ring recenter and is exactly where the boat will attach later.

## 8. Buoyancy seam - `OceanSampler`

The stable interface buoyancy will consume:

```
OceanSampler.getHeightAndNormal(worldX, worldZ) -> { height, normal }
```

Backing implementation now: **async readback** of the combined displacement texture(s) (PBO / `getBufferSubData` to avoid GPU stalls), summed across cascades, **bilinearly sampled** in JS. The displacement textures are small (≤256²), so this is cheap.

**Choppy-displacement caveat:** because horizontal displacement moves a surface point sideways, the texel at `(x,z)` is not exactly the surface above `(x,z)`. For the single bobbing buoy now we sample vertical displacement directly (good enough). For accurate buoyancy later, a 1–2 iteration fixed-point inversion can be added behind the same interface without changing callers.

`Buoy` is the first consumer: a small visible marker that samples `OceanSampler` each frame to **bob** (set y to height) and **tilt** (orient to normal) - validating the seam live.

## 9. Module layout

```
config.js                  JONSWAP params/cascade, colors, sun, LOD config, quality presets
wave/SpectrumGen.js        builds H̃₀(k) per cascade (once)
wave/FFT.js                reusable ping-pong butterfly IFFT + twiddle texture
wave/OceanSim.js           per-frame time-evolve + IFFTs → displacement/normal/foam, across cascades
wave/OceanSampler.js       async readback + bilinear sample(x,z) → {height, normal}  [buoyancy seam]
ocean/OceanMesh.js         clipmap LOD rings, recenter/snap, binds sim textures
ocean/oceanMaterial.js     vertex (VTF displacement) + fragment (SSS/specular/reflect/foam)
env/Sky.js                 sky gradient + sun + reflection source + fog
camera/OrbitFollowControls.js   Roblox orbit-follow + WASD focal point
objects/Buoy.js            bobbing/tilting marker; first OceanSampler consumer
main.js                    bootstrap + render loop, wiring
```

### Data flow per frame
input → `OrbitFollowControls` moves focal point → `OceanSim` time-evolves + IFFTs into displacement/normal/foam textures (per cascade, summed) → `OceanMesh` recenters/snaps rings & samples displacement in the vertex shader → `oceanMaterial` shades (SSS + specular + sky reflect + foam) → `OceanSampler` reads back displacement → `Buoy` bobs/tilts → camera tracks the focal point.

## 10. Error handling & robustness

- **Capability gate** at startup: WebGL2 + float/half-float color-renderable textures. If unavailable, show a friendly message (and, where possible, a reduced fallback) rather than a blank canvas.
- **Context loss:** listen for `webglcontextlost`/`restored`; rebuild GPU resources on restore.
- **Resize:** handle canvas/viewport resize, update camera aspect and any screen-sized targets.
- **Auto quality downgrade** when frame time exceeds budget over a rolling window.
- **Spectrum sanity:** clamp parameters to avoid degenerate/NaN spectra.

## 11. Testing

CPU-testable units (Vitest):
- **SpectrumGen:** Hermitian symmetry (H̃₀*(−k) relationship), determinism for a fixed seed.
- **FFT:** forward∘inverse round-trip recovers input within tolerance; small-N FFT matches a naive DFT reference.
- **OceanSampler:** bilinear sampling correctness against known texture values; offset/rebase math.
- **Clipmap math:** ring snapping and coverage (no gaps/overlaps) for given focal points.

Manual visual checklist:
- Height gradient reads deep→bright; foam appears at curling crests and decays; sun glints track the sun; sky reflection strengthens at grazing angles; no popping at ring seams; horizon hidden by fog; buoy sits on and tilts with the surface; no visible tiling at the Medium preset within the field of view.

## 12. Open enhancements (deferred)

Stylized foam texture; sea-spray particles; PBR specular (Disney principled BRDF); CDLOD geomorphing; cubemap/HDR sky; choppy-inversion in `OceanSampler` for accurate buoyancy; then the boat + buoyancy phase.
