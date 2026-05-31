# FFT Ocean Water MVP - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get a moving, Sea-of-Thieves-like FFT ocean running in the browser - a single-cascade Tessendorf/JONSWAP FFT simulation rendered on a camera-following grid, with stylized SSS lighting, sun specular, sky/fresnel reflection, foam, a Roblox-style orbit-follow camera, and a buoy that bobs on the surface via a CPU height readback.

**Architecture:** Port GarrettGunnell/Water (Unity compute-shader FFT) to **Three.js + WebGL2**. WebGL2 has no compute shaders or groupshared memory, so the GPU FFT becomes **fragment-shader ping-pong butterfly passes** using a precomputed butterfly texture, rendering into `RGBA16F` render targets. The frequency-domain spectrum, time evolution, IFFT, and map assembly are each fullscreen-quad passes. The ocean mesh samples the resulting displacement texture by vertex texture fetch; the fragment shader ports the reference's SSS lighting. A dedicated height readback feeds `OceanSampler` - the buoyancy seam - whose first consumer is the bobbing buoy.

**Tech Stack:** Vite, Three.js (r16x), WebGL2, plain JS + JSDoc, Vitest for unit tests.

**Reference (ported from, saved in repo):** `docs/reference/FFTWater.compute`, `docs/reference/FFTWater.shader`, `docs/reference/FFTWater.cs`, `docs/reference/Buoyancy.cs`. The HLSL functions named below (e.g. `JONSWAP`, `DirectionSpectrum`, `CS_UpdateSpectrumForFFT`, `CS_AssembleMaps`, `fp`) are the exact source to port; line references are into those files.

**MVP scope:** single cascade, `N=256`. **Deferred to a follow-up plan:** multiple cascades, foam accumulation-over-time texture (MVP uses instantaneous Jacobian foam), CDLOD clipmap rings (MVP uses one camera-following grid + fog), quality presets/auto-detect, origin rebasing, PBR upgrade, sea spray.

---

## File Structure

```
package.json              deps + scripts (vite, three, vitest)
vite.config.js            base config
index.html                canvas host
src/main.js               bootstrap + render loop, wiring
src/config.js             all tunables: N, lengthScale, JONSWAP spectrum, colors, sun, lambda, foam
src/core/Renderer.js      Three.js WebGLRenderer + WebGL2/float-target capability gate + resize
src/core/fullscreenPass.js  helper: run a fragment shader over a render target (scene+ortho cam+quad)
src/glsl/complex.glsl.js  shared GLSL: ComplexMult, EulerFormula, PI
src/wave/jonswap.js       CPU: JonswapAlpha, JonswapPeakFrequency, buildSpectrumParams  (UNIT TESTED)
src/wave/butterfly.js     CPU: build butterfly (twiddle+indices) Float32 data for the texture  (UNIT TESTED)
src/wave/fftReference.js  CPU radix-2 FFT/IFFT, for tests only  (UNIT TESTED)
src/wave/spectrumPass.js  GPU: build H0 texture (init + conjugate pack) from JONSWAP
src/wave/fft.js           GPU: ping-pong butterfly IFFT over an RGBA16F target
src/wave/OceanSim.js      GPU per-frame: time-evolve → IFFT → assemble (displacement+slope+height)
src/wave/OceanSampler.js  CPU: async readback of height target + bilinear sample(x,z)  (bilinear UNIT TESTED)
src/ocean/oceanMaterial.js  ShaderMaterial: VTF displacement (vertex) + SSS/specular/fresnel/foam (fragment)
src/ocean/OceanMesh.js    grid geometry that follows the focal point (snapped) + binds sim textures
src/env/Sky.js            gradient sky dome + directional sun + fog params
src/camera/OrbitFollowControls.js  mouse orbit + scroll zoom + WASD focal point  (clamp math UNIT TESTED)
src/objects/Buoy.js       marker mesh; samples OceanSampler each frame to bob + tilt
tests/*.test.js           Vitest unit tests
```

---

## Phase A - Scaffold, sky, camera (runnable: fly over a flat sea)

### Task A1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "watersimulation",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": { "three": "^0.169.0" },
  "devDependencies": { "vite": "^5.4.0", "vitest": "^2.1.0" }
}
```

- [ ] **Step 2: Create `vite.config.js`**

```js
import { defineConfig } from 'vite';
export default defineConfig({ server: { open: true } });
```

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FFT Ocean</title>
    <style>html,body{margin:0;height:100%;overflow:hidden;background:#0a2a3a}canvas{display:block}</style>
  </head>
  <body>
    <canvas id="app"></canvas>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Create placeholder `src/main.js`**

```js
console.log('FFT Ocean booting');
```

- [ ] **Step 5: Install and run**

Run: `npm install && npm run dev`
Expected: Vite serves at localhost; console logs "FFT Ocean booting"; blank dark canvas.

- [ ] **Step 6: Commit**

```bash
git add package.json vite.config.js index.html src/main.js
git commit -m "chore: scaffold Vite + Three.js project"
```

### Task A2: Renderer with WebGL2 + float-target capability gate

**Files:**
- Create: `src/core/Renderer.js`

- [ ] **Step 1: Implement `src/core/Renderer.js`**

```js
import * as THREE from 'three';

/** Creates the WebGL2 renderer and verifies float color-buffer support. */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) {
    throw new Error('WebGL2 is required for the FFT ocean simulation.');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float is required (float render targets).');
  }
  gl.getExtension('OES_texture_float_linear'); // optional: linear filtering of float textures
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** Wires resize handling for a renderer + perspective camera. */
export function handleResize(renderer, camera) {
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
}
```

- [ ] **Step 2: Smoke-test in `main.js`** - replace contents:

```js
import * as THREE from 'three';
import { createRenderer, handleResize } from './core/Renderer.js';

const canvas = document.getElementById('app');
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6fb7d6);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 20, 60);
camera.lookAt(0, 0, 0);
handleResize(renderer, camera);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

- [ ] **Step 3: Verify** - `npm run dev`. Expected: a solid light-blue canvas, no console errors. (If the machine lacks float targets you'll see the thrown error - that's the gate working.)

- [ ] **Step 4: Commit**

```bash
git add src/core/Renderer.js src/main.js
git commit -m "feat: WebGL2 renderer with float-target capability gate"
```

### Task A3: config.js

**Files:**
- Create: `src/config.js`

- [ ] **Step 1: Implement `src/config.js`** (values ported from `docs/reference/FFTWater.cs` defaults)

```js
export const config = {
  sim: {
    N: 256,                 // FFT resolution (power of two)
    lengthScale: 250,       // patch size in world units (reference lengthScale1)
    gravity: 9.81,
    depth: 20,
    repeatTime: 200,        // seconds before the sim loops
    speed: 1.0,
    lambda: [1.0, 1.0],     // horizontal (choppy) displacement strength [x, z]
    lowCutoff: 0.0001,
    highCutoff: 9000,
    seed: 0,
  },
  // JONSWAP display params (see buildSpectrumParams). Two summed spectra (wind sea + swell).
  spectrum: {
    scale: 1.0, windSpeed: 2.0, windDirection: 22.0, fetch: 100000,
    spreadBlend: 1.0, swell: 0.2, peakEnhancement: 3.3, shortWavesFade: 0.01,
  },
  mesh: { tiles: 200, quadRes: 2 },      // grid extent (world units) and vertices per unit
  foam: { bias: -0.5, threshold: 0.0, add: 0.5 },
  colors: {
    scatter: [0.0, 0.18, 0.22],
    bubble: [0.0, 0.02, 0.03],
    foam: [0.9, 0.95, 1.0],
    sunIrradiance: [1.0, 0.95, 0.85],
    sunDirection: [0.3, 0.6, 0.4],   // will be normalized
    fog: [0.62, 0.72, 0.84],
  },
  lighting: {
    roughness: 0.08, wavePeakScatterStrength: 1.0, scatterStrength: 1.0,
    scatterShadowStrength: 0.5, environmentLightStrength: 1.0, bubbleDensity: 1.0,
    heightModifier: 1.0,
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/config.js
git commit -m "feat: central config ported from reference defaults"
```

### Task A4: Orbit-follow camera (Roblox-style)

**Files:**
- Create: `src/camera/OrbitFollowControls.js`
- Test: `tests/orbitControls.test.js`

- [ ] **Step 1: Write the failing test** - `tests/orbitControls.test.js`

```js
import { describe, it, expect } from 'vitest';
import { clampPitch, clampZoom } from '../src/camera/OrbitFollowControls.js';

describe('orbit camera clamps', () => {
  it('clamps pitch within (-PI/2, PI/2) exclusive bounds', () => {
    expect(clampPitch(10)).toBeLessThan(Math.PI / 2);
    expect(clampPitch(-10)).toBeGreaterThan(-Math.PI / 2);
    expect(clampPitch(0.3)).toBeCloseTo(0.3);
  });
  it('clamps zoom into [min,max]', () => {
    expect(clampZoom(1, 10, 200)).toBe(10);
    expect(clampZoom(999, 10, 200)).toBe(200);
    expect(clampZoom(50, 10, 200)).toBe(50);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/orbitControls.test.js`
Expected: FAIL - module/exports not found.

- [ ] **Step 3: Implement `src/camera/OrbitFollowControls.js`**

```js
import * as THREE from 'three';

export const clampPitch = (p) => Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, p));
export const clampZoom = (z, min, max) => Math.max(min, Math.min(max, z));

/** Roblox-style third-person orbit-follow camera around a movable focal point. */
export class OrbitFollowControls {
  constructor(camera, domElement, { minZoom = 10, maxZoom = 300, moveSpeed = 40 } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.focal = new THREE.Vector3(0, 0, 0); // world anchor (boat later)
    this.yaw = 0; this.pitch = 0.5; this.dist = 80;
    this.minZoom = minZoom; this.maxZoom = maxZoom; this.moveSpeed = moveSpeed;
    this.keys = new Set();
    this._dragging = false; this._lastSmoothY = 0;

    domElement.addEventListener('mousedown', () => (this._dragging = true));
    window.addEventListener('mouseup', () => (this._dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this._dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = clampPitch(this.pitch - e.movementY * 0.005);
    });
    domElement.addEventListener('wheel', (e) => {
      this.dist = clampZoom(this.dist + e.deltaY * 0.05, this.minZoom, this.maxZoom);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** @param dt seconds @param surfaceY optional water height under the focal point */
  update(dt, surfaceY = 0) {
    // WASD moves the focal point in the camera-relative horizontal plane.
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.sub(f);
    if (this.keys.has('KeyS')) move.add(f);
    if (this.keys.has('KeyA')) move.sub(r);
    if (this.keys.has('KeyD')) move.add(r);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(this.moveSpeed * dt);
    this.focal.add(move);

    // Smooth the vertical follow so wave bob doesn't induce nausea.
    this._lastSmoothY += (surfaceY - this._lastSmoothY) * Math.min(1, dt * 3);
    const target = new THREE.Vector3(this.focal.x, this._lastSmoothY, this.focal.z);

    const offset = new THREE.Vector3(
      this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
      this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
    );
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/orbitControls.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into `main.js`** - add after camera creation, replacing the static lookAt and animation loop:

```js
import { OrbitFollowControls } from './camera/OrbitFollowControls.js';
const controls = new OrbitFollowControls(camera, canvas);
let prev = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = (now - prev) / 1000; prev = now;
  controls.update(dt, 0);
  renderer.render(scene, camera);
});
```

- [ ] **Step 6: Verify** - `npm run dev`. Drag to orbit, scroll to zoom, WASD to pan over the blank scene. Commit:

```bash
git add src/camera/OrbitFollowControls.js tests/orbitControls.test.js src/main.js
git commit -m "feat: Roblox-style orbit-follow camera"
```

### Task A5: Sky dome + sun + fog, flat water plane

**Files:**
- Create: `src/env/Sky.js`
- Modify: `src/main.js`

- [ ] **Step 1: Implement `src/env/Sky.js`** - a large inward-facing gradient dome and a sun direction.

```js
import * as THREE from 'three';
import { config } from '../config.js';

export class Sky {
  constructor(scene) {
    this.sunDirection = new THREE.Vector3(...config.colors.sunDirection).normalize();
    const geo = new THREE.SphereGeometry(4000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x3a7bd5) },
        bottomColor: { value: new THREE.Color(...config.colors.fog) },
        sunDir: { value: this.sunDirection },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        uniform vec3 topColor,bottomColor,sunDir; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y*0.5+0.5,0.0,1.0);
          vec3 col = mix(bottomColor, topColor, pow(h,0.6));
          float sun = pow(max(0.0, dot(normalize(vDir), normalize(sunDir))), 2000.0);
          col += vec3(1.0,0.9,0.7)*sun;
          gl_FragColor = vec4(col,1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);
    scene.fog = new THREE.Fog(new THREE.Color(...config.colors.fog), 600, 3500);
  }
}
```

- [ ] **Step 2: Add a flat placeholder water plane + sky in `main.js`**

```js
import { Sky } from './env/Sky.js';
new Sky(scene);
const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(config.mesh.tiles, config.mesh.tiles, 4, 4).rotateX(-Math.PI/2),
  new THREE.MeshStandardMaterial({ color: 0x10566b, roughness: 0.4 })
);
scene.add(plane);
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x10394a, 1.0));
```
(add `import { config } from './config.js';` at top)

- [ ] **Step 3: Verify** - `npm run dev`. Expected: gradient sky with a sun disc, a flat blue plane you can orbit/zoom/pan over. **This is the Phase A milestone - it runs.**

- [ ] **Step 4: Commit**

```bash
git add src/env/Sky.js src/main.js
git commit -m "feat: gradient sky dome, sun, fog, placeholder water plane"
```

---

## Phase B - FFT engine core (verified by round-trip)

### Task B1: CPU FFT reference (tests only)

**Files:**
- Create: `src/wave/fftReference.js`
- Test: `tests/fft.test.js`

- [ ] **Step 1: Write the failing test** - `tests/fft.test.js`

```js
import { describe, it, expect } from 'vitest';
import { fft1d, ifft1d } from '../src/wave/fftReference.js';

describe('CPU FFT reference', () => {
  it('round-trips a signal (ifft(fft(x)) == x)', () => {
    const re = [1, 2, 3, 4, 4, 3, 2, 1], im = new Array(8).fill(0);
    const f = fft1d(re.slice(), im.slice());
    const g = ifft1d(f.re, f.im);
    for (let i = 0; i < 8; i++) {
      expect(g.re[i]).toBeCloseTo(re[i], 5);
      expect(g.im[i]).toBeCloseTo(0, 5);
    }
  });
  it('fft of a constant is a single DC spike', () => {
    const re = [2, 2, 2, 2], im = [0, 0, 0, 0];
    const f = fft1d(re, im);
    expect(f.re[0]).toBeCloseTo(8, 5);
    expect(f.re[1]).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/fft.test.js`
Expected: FAIL - exports missing.

- [ ] **Step 3: Implement `src/wave/fftReference.js`** (iterative radix-2 Cooley-Tukey)

```js
/** In-place-ish radix-2 FFT. Returns {re, im}. Length must be a power of two. */
export function fft1d(re, im, inverse = false) {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  return { re, im };
}

export function ifft1d(re, im) {
  const n = re.length;
  const r = fft1d(re.slice(), im.slice(), true);
  for (let i = 0; i < n; i++) { r.re[i] /= n; r.im[i] /= n; }
  return r;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/fft.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/wave/fftReference.js tests/fft.test.js
git commit -m "feat: CPU FFT reference for verification"
```

### Task B2: Butterfly texture data (TDD)

**Files:**
- Create: `src/wave/butterfly.js`
- Test: `tests/butterfly.test.js`

This ports `ComputeTwiddleFactorAndInputIndices` (`docs/reference/FFTWater.compute:237-244`) to a precomputed texture: size `log2(N) × N`, each texel = `(twiddle.re, twiddle.im, indexA, indexB)`. The inverse FFT negates the twiddle imaginary part.

- [ ] **Step 1: Write the failing test** - `tests/butterfly.test.js`

```js
import { describe, it, expect } from 'vitest';
import { buildButterfly } from '../src/wave/butterfly.js';

describe('butterfly texture', () => {
  it('has dimensions log2(N) x N and 4 channels', () => {
    const N = 8; const { width, height, data } = buildButterfly(N);
    expect(width).toBe(3);          // log2(8)
    expect(height).toBe(8);
    expect(data.length).toBe(3 * 8 * 4);
  });
  it('stage 0 pairs indices b apart with b=N/2', () => {
    const N = 8; const { data } = buildButterfly(N);
    // texel (stage=0, y=0): indices channels .z,.w
    const idxA = data[2], idxB = data[3];
    expect(idxA).toBe(0);
    expect(idxB).toBe(4);           // 0 + N/2
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/butterfly.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/wave/butterfly.js`**

```js
/**
 * Precomputed butterfly/twiddle data for an inverse FFT, laid out as a
 * (log2N x N) RGBA float texture: (twiddleRe, twiddleIm, indexA, indexB).
 * Ported from ComputeTwiddleFactorAndInputIndices in the reference compute shader.
 */
export function buildButterfly(N) {
  const stages = Math.log2(N);
  if (!Number.isInteger(stages)) throw new Error('N must be a power of two');
  const data = new Float32Array(stages * N * 4);
  for (let stage = 0; stage < stages; stage++) {
    for (let y = 0; y < N; y++) {
      const b = N >> (stage + 1);
      const w = b * Math.floor(y / b);
      const i = (w + y) % N;
      const ang = (-2 * Math.PI / N) * w;
      const tw_re = Math.cos(ang);
      const tw_im = -Math.sin(ang); // negated => inverse FFT
      const o = (stage * N + y) * 4; // texel (x=stage, y)
      data[o] = tw_re; data[o + 1] = tw_im; data[o + 2] = i; data[o + 3] = i + b;
    }
  }
  return { width: stages, height: N, data };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/butterfly.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/wave/butterfly.js tests/butterfly.test.js
git commit -m "feat: precomputed butterfly texture data"
```

### Task B3: Shared complex GLSL + fullscreen-pass helper

**Files:**
- Create: `src/glsl/complex.glsl.js`, `src/core/fullscreenPass.js`

- [ ] **Step 1: Implement `src/glsl/complex.glsl.js`**

```js
export const complexGLSL = /* glsl */`
  #define PI 3.141592653589793
  vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
  vec2 euler(float x){ return vec2(cos(x), sin(x)); }
`;
```

- [ ] **Step 2: Implement `src/core/fullscreenPass.js`** - render a fragment shader into a target.

```js
import * as THREE from 'three';

/** Wraps a fragment shader as a fullscreen pass writing to render targets. */
export class FullscreenPass {
  constructor(fragmentShader, uniforms) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader,
      glslVersion: THREE.GLSL3,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }
  render(renderer, target) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
  }
}

export function makeFloatTarget(N, count = 1) {
  return new THREE.WebGLRenderTarget(N, N, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    depthBuffer: false, count,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/glsl/complex.glsl.js src/core/fullscreenPass.js
git commit -m "feat: complex GLSL chunk + fullscreen-pass helper"
```

### Task B4: GPU IFFT (ping-pong) verified by round-trip readback

**Files:**
- Create: `src/wave/fft.js`
- Test: `tests/gpuFft.test.js` (jsdom + headless GL is unreliable, so this is a manual/browser-asserted check documented as a runtime self-test instead)

GLSL FFT fragment shader: for each pixel, read the butterfly texel for the current `stage` (indexed by x for horizontal passes, y for vertical), gather the two source texels at the encoded indices along the pass axis, combine `a + cmul(twiddle, b)` independently for `.xy` and `.zw` complex channels. Ping-pong between two targets for `log2N` horizontal then `log2N` vertical passes. Normalize by `1/N` after each 1D axis (1/N² total) - matches `ifft1d`.

- [ ] **Step 1: Implement `src/wave/fft.js`**

```js
import * as THREE from 'three';
import { complexGLSL } from '../glsl/complex.glsl.js';
import { FullscreenPass, makeFloatTarget } from '../core/fullscreenPass.js';
import { buildButterfly } from './butterfly.js';

const FFT_FRAG = /* glsl */`
  precision highp float;
  ${complexGLSL}
  uniform sampler2D uButterfly;   // (log2N x N): (twRe,twIm,idxA,idxB)
  uniform sampler2D uSource;
  uniform float uN;
  uniform float uStage;
  uniform bool uHorizontal;
  uniform bool uNormalize;        // divide by N on the final pass of each axis
  out vec4 outColor;
  void main(){
    vec2 px = gl_FragCoord.xy - 0.5;             // integer pixel coords
    float idx = uHorizontal ? px.x : px.y;
    vec4 bf = texelFetch(uButterfly, ivec2(int(uStage), int(idx)), 0);
    vec2 tw = bf.xy; float a = bf.z; float b = bf.w;
    ivec2 pa = uHorizontal ? ivec2(int(a), int(px.y)) : ivec2(int(px.x), int(a));
    ivec2 pb = uHorizontal ? ivec2(int(b), int(px.y)) : ivec2(int(px.x), int(b));
    vec4 va = texelFetch(uSource, pa, 0);
    vec4 vb = texelFetch(uSource, pb, 0);
    vec2 r1 = va.xy + cmul(tw, vb.xy);
    vec2 r2 = va.zw + cmul(tw, vb.zw);
    vec4 res = vec4(r1, r2);
    if (uNormalize) res /= uN;
    outColor = res;
  }
`;

/** GPU inverse FFT over RGBA16F targets (two independent complex channels: .xy and .zw). */
export class FFT {
  constructor(renderer, N) {
    this.renderer = renderer; this.N = N; this.stages = Math.log2(N);
    const bf = buildButterfly(N);
    this.butterfly = new THREE.DataTexture(bf.data, bf.width, bf.height, THREE.RGBAFormat, THREE.FloatType);
    this.butterfly.needsUpdate = true;
    this.uniforms = {
      uButterfly: { value: this.butterfly }, uSource: { value: null },
      uN: { value: N }, uStage: { value: 0 }, uHorizontal: { value: true }, uNormalize: { value: false },
    };
    this.pass = new FullscreenPass(FFT_FRAG, this.uniforms);
    this.pingA = makeFloatTarget(N); this.pingB = makeFloatTarget(N);
  }

  /** Runs IFFT on `inputTarget`'s texture; returns the target holding the result. */
  run(inputTarget) {
    let src = inputTarget, dstA = this.pingA, dstB = this.pingB, read = src;
    const step = (horizontal, stage, normalize) => {
      this.uniforms.uSource.value = read.texture;
      this.uniforms.uHorizontal.value = horizontal;
      this.uniforms.uStage.value = stage;
      this.uniforms.uNormalize.value = normalize;
      const write = (read === dstA) ? dstB : dstA;
      this.pass.render(this.renderer, write);
      read = write;
    };
    // first horizontal pass reads the input, writes into pingA
    this.uniforms.uSource.value = src.texture;
    this.uniforms.uHorizontal.value = true; this.uniforms.uStage.value = 0;
    this.uniforms.uNormalize.value = (this.stages === 1);
    this.pass.render(this.renderer, dstA); read = dstA;
    for (let s = 1; s < this.stages; s++) step(true, s, s === this.stages - 1);
    for (let s = 0; s < this.stages; s++) step(false, s, s === this.stages - 1);
    return read;
  }
}
```

- [ ] **Step 2: Add a browser self-test** - temporarily in `main.js`, upload a known float4 pattern, run forward via the CPU reference, push its spectrum to a target, IFFT on GPU, `readRenderTargetPixels`, and compare to the original within tolerance; `console.assert` and log PASS/FAIL.

```js
// TEMP verification (remove after): see plan Task B4 step 2
import { FFT } from './wave/fft.js';
import { fft1d } from './wave/fftReference.js';
// build a small N=8 case: constant field -> after IFFT(FFT) returns constant.
// Upload constant 1.0 in .x, run FFT.run on its forward transform, expect ~1.0 back.
```
Document the exact assertion you run and its console output here when executing.

- [ ] **Step 3: Verify** - `npm run dev`, open console. Expected: "FFT round-trip PASS". If FAIL, the usual culprits are butterfly index encoding, normalization placement, or `texelFetch` y-flip - fix before proceeding.

- [ ] **Step 4: Remove the temp self-test, commit**

```bash
git add src/wave/fft.js
git commit -m "feat: GPU ping-pong inverse FFT (round-trip verified)"
```

---

## Phase C - Spectrum, simulation, displaced mesh (runnable: moving FFT water)

### Task C1: JONSWAP CPU params (TDD)

**Files:**
- Create: `src/wave/jonswap.js`
- Test: `tests/jonswap.test.js`

Ports `JonswapAlpha`, `JonswapPeakFrequency`, `FillSpectrumStruct` (`docs/reference/FFTWater.cs:706-723`).

- [ ] **Step 1: Write the failing test** - `tests/jonswap.test.js`

```js
import { describe, it, expect } from 'vitest';
import { jonswapAlpha, jonswapPeakOmega, buildSpectrumParams } from '../src/wave/jonswap.js';

describe('JONSWAP params', () => {
  it('alpha matches reference formula', () => {
    // 0.076 * (g*fetch/U^2)^-0.22
    const g = 9.81, fetch = 100000, U = 2;
    const expected = 0.076 * Math.pow(g * fetch / (U * U), -0.22);
    expect(jonswapAlpha(fetch, U, g)).toBeCloseTo(expected, 6);
  });
  it('peakOmega matches reference formula', () => {
    const g = 9.81, fetch = 100000, U = 2;
    const expected = 22 * Math.pow(U * fetch / (g * g), -0.33);
    expect(jonswapPeakOmega(fetch, U, g)).toBeCloseTo(expected, 6);
  });
  it('buildSpectrumParams converts windDirection to radians', () => {
    const p = buildSpectrumParams({ windDirection: 180, windSpeed: 2, fetch: 100000, scale: 1, spreadBlend: 1, swell: 0.2, peakEnhancement: 3.3, shortWavesFade: 0.01 }, 9.81);
    expect(p.angle).toBeCloseTo(Math.PI, 5);
    expect(p.swell).toBeGreaterThanOrEqual(0.01);
  });
});
```

- [ ] **Step 2: Run, verify fail** - `npx vitest run tests/jonswap.test.js` → FAIL.

- [ ] **Step 3: Implement `src/wave/jonswap.js`**

```js
export const jonswapAlpha = (fetch, windSpeed, g) =>
  0.076 * Math.pow((g * fetch) / (windSpeed * windSpeed), -0.22);

export const jonswapPeakOmega = (fetch, windSpeed, g) =>
  22 * Math.pow((windSpeed * fetch) / (g * g), -0.33);

/** Maps display settings → the 8 floats the spectrum shader expects. */
export function buildSpectrumParams(s, g) {
  return {
    scale: s.scale,
    angle: (s.windDirection / 180) * Math.PI,
    spreadBlend: s.spreadBlend,
    swell: Math.max(0.01, Math.min(1, s.swell)),
    alpha: jonswapAlpha(s.fetch, s.windSpeed, g),
    peakOmega: jonswapPeakOmega(s.fetch, s.windSpeed, g),
    gamma: s.peakEnhancement,
    shortWavesFade: s.shortWavesFade,
  };
}
```

- [ ] **Step 4: Run, verify pass** - `npx vitest run tests/jonswap.test.js` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/wave/jonswap.js tests/jonswap.test.js
git commit -m "feat: JONSWAP CPU parameter helpers"
```

### Task C2: Initial spectrum pass (H0)

**Files:**
- Create: `src/wave/spectrumPass.js`

Two fullscreen passes building the `RGBA16F` initial-spectrum texture: pass 1 ports `CS_InitializeSpectrum` (`docs/reference/FFTWater.compute:134-169`) - JONSWAP × DirectionSpectrum × ShortWavesFade, Gaussian-weighted, writing `h0` into `.rg`. Pass 2 ports `CS_PackSpectrumConjugate` (`:171-179`) - reads the `(-k)` texel and writes `h0conj` into `.ba`. Port the helper functions verbatim (`Dispersion`, `DispersionDerivative`, `JONSWAP`, `DirectionSpectrum`, `Cosine2s`, `SpreadPower`, `NormalizationFactor`, `TMACorrection`, `ShortWavesFade`, `hash`, `UniformToGaussian`) into the fragment shader, translating HLSL→GLSL (`float2`→`vec2`, `rcp(x)`→`1.0/x`, `lerp`→`mix`, `saturate`→`clamp(...,0,1)`, `atan2`→`atan`, integer `hash` using `uint`). The spectrum params (8 floats) are passed as uniforms.

- [ ] **Step 1: Implement `src/wave/spectrumPass.js`** - exports `class SpectrumPass { constructor(renderer, N); build(params0, params1, simConfig) -> WebGLRenderTarget }`. The init fragment computes `K = (gl_FragCoord.xy - N/2) * 2π/lengthScale`, evaluates the spectrum, and writes `vec4(gaussWeighted_h0, 0, 0)`; the conjugate fragment does `texelFetch` at `ivec2((N-x)%N,(N-y)%N)` and packs. Include the full ported GLSL inline (see reference lines above for the exact expressions).

```js
import * as THREE from 'three';
import { complexGLSL } from '../glsl/complex.glsl.js';
import { FullscreenPass, makeFloatTarget } from '../core/fullscreenPass.js';

// INIT_FRAG and CONJ_FRAG: port the named HLSL helpers + CS_InitializeSpectrum /
// CS_PackSpectrumConjugate bodies here (single cascade: drop the `for i<4` loop and
// the texture-array slice index). Uniforms: uN, uLengthScale, uGravity, uDepth,
// uLowCutoff, uHighCutoff, uSeed, and the 8 spectrum floats for params0/params1.
export class SpectrumPass {
  constructor(renderer, N) {
    this.renderer = renderer; this.N = N;
    this.h0 = makeFloatTarget(N);
    this.initPass = new FullscreenPass(INIT_FRAG, INIT_UNIFORMS(N));
    this.conjPass = new FullscreenPass(CONJ_FRAG, { uSource: { value: null }, uN: { value: N } });
    this.tmp = makeFloatTarget(N);
  }
  build(p0, p1, sim) {
    /* set uniforms from p0,p1,sim; initPass.render(renderer, this.tmp);
       conjPass uSource = tmp.texture; conjPass.render(renderer, this.h0); return this.h0; */
  }
}
```

(Execution note: write the full INIT_FRAG/CONJ_FRAG GLSL by porting the referenced HLSL functions line-for-line; they are long but mechanical. Keep them in this file.)

- [ ] **Step 2: Visual verify** - temporarily render `h0.texture` to the screen with a debug quad; expect a symmetric speckled spectrum concentrated near the center (low frequencies). Commit:

```bash
git add src/wave/spectrumPass.js
git commit -m "feat: initial JONSWAP spectrum (H0) GPU passes"
```

### Task C3: Time evolution + IFFT + assemble → OceanSim

**Files:**
- Create: `src/wave/OceanSim.js`

Ports `CS_UpdateSpectrumForFFT` (`:181-228`) → two `RGBA16F` targets (displacement-spectrum, slope-spectrum, using the two-for-one complex packing), runs `FFT.run` on each, then ports `CS_AssembleMaps` (`:305-340`) → a displacement target (`xyz` + instantaneous foam in `.a`) and a slope/normal target, plus writes height into a single-channel readback target for buoyancy. MVP foam = instantaneous `max(0, -(jacobian - foamBias))` (no accumulation texture).

- [ ] **Step 1: Implement `src/wave/OceanSim.js`**

```js
import { FullscreenPass, makeFloatTarget } from '../core/fullscreenPass.js';
import { SpectrumPass } from './spectrumPass.js';
import { FFT } from './fft.js';
import { buildSpectrumParams } from './jonswap.js';
import { config } from '../config.js';
import { complexGLSL } from '../glsl/complex.glsl.js';

export class OceanSim {
  constructor(renderer) {
    const N = config.sim.N;
    this.renderer = renderer; this.N = N;
    this.spectrum = new SpectrumPass(renderer, N);
    const p0 = buildSpectrumParams(config.spectrum, config.sim.gravity);
    const p1 = { ...p0, scale: 0 }; // MVP: single spectrum; second disabled
    this.h0 = this.spectrum.build(p0, p1, config.sim);
    this.fft = new FFT(renderer, N);

    this.dispSpectrum = makeFloatTarget(N);   // htildeDisplacement packed
    this.slopeSpectrum = makeFloatTarget(N);  // htildeSlope packed
    this.evolvePass = new FullscreenPass(EVOLVE_FRAG, EVOLVE_UNIFORMS(N)); // writes both via MRT (count:2) OR run twice
    this.displacement = makeFloatTarget(N);   // xyz + foam
    this.slope = makeFloatTarget(N);          // normal slopes
    this.assemblePass = new FullscreenPass(ASSEMBLE_FRAG, ASSEMBLE_UNIFORMS(N));
  }
  /** @param time seconds */
  update(time) {
    /* set evolve uniforms (uTime, uN, uLengthScale, uGravity, uRepeatTime, h0 texture);
       render evolve -> dispSpectrum & slopeSpectrum (use two passes if not using MRT);
       this.fft.run(dispSpectrum) -> dispSpatial; this.fft.run(slopeSpectrum) -> slopeSpatial;
       set assemble uniforms (lambda, foam bias/threshold/add, the two spatial textures);
       render assemble -> this.displacement and this.slope (MRT or two passes). */
  }
  get displacementTexture() { return this.displacement.texture; }
  get slopeTexture() { return this.slope.texture; }
  get heightTarget() { return this.displacement; } // .y channel used for readback
}
```

(Execution note: port `EVOLVE_FRAG` from `CS_UpdateSpectrumForFFT` - compute `K`, `htilde = cmul(h0, euler(ωt)) + cmul(h0conj, euler(-ωt))`, then the displacement/slope packings exactly as the HLSL. Port `ASSEMBLE_FRAG` from `CS_AssembleMaps` - `Permute` sign flip `(1 - 2*mod(x+y,2))`, Jacobian, `displacement = vec3(λ.x*dxdz.x, dydxz.x, λ.y*dxdz.y)`, slopes, instantaneous foam.)

- [ ] **Step 2: Visual verify** - debug-render `displacement.texture`: expect smoothly varying RGB blobs that animate over time. Commit:

```bash
git add src/wave/OceanSim.js
git commit -m "feat: ocean simulation (evolve + IFFT + assemble)"
```

### Task C4: Ocean mesh + displacement (vertex texture fetch)

**Files:**
- Create: `src/ocean/OceanMesh.js`, `src/ocean/oceanMaterial.js`
- Modify: `src/main.js` (replace placeholder plane)

- [ ] **Step 1: Implement `src/ocean/oceanMaterial.js`** with a height-only debug fragment first (full lighting in Phase D).

```js
import * as THREE from 'three';
import { config } from '../config.js';

export function createOceanMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDisplacement: { value: null }, uSlope: { value: null },
      uLengthScale: { value: config.sim.lengthScale },
      uFogColor: { value: new THREE.Color(...config.colors.fog) },
      uFogNear: { value: 600 }, uFogFar: { value: 3500 },
    },
    vertexShader: /* glsl */`
      uniform sampler2D uDisplacement; uniform float uLengthScale;
      varying vec3 vWorldPos; varying vec2 vUv; varying float vFoam;
      void main(){
        vec3 wp = (modelMatrix * vec4(position,1.0)).xyz;
        vec2 uv = wp.xz / uLengthScale;
        vec4 d = texture2D(uDisplacement, uv);
        wp += d.xyz; vFoam = d.a; vUv = uv; vWorldPos = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp,1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorldPos; varying vec2 vUv; varying float vFoam;
      uniform vec3 uFogColor; uniform float uFogNear, uFogFar;
      void main(){
        float h = clamp(vWorldPos.y*0.1+0.5,0.0,1.0);
        vec3 col = mix(vec3(0.0,0.15,0.2), vec3(0.1,0.4,0.5), h);
        col = mix(col, vec3(1.0), clamp(vFoam,0.0,1.0));
        float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorldPos));
        gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
      }`,
  });
}
```

- [ ] **Step 2: Implement `src/ocean/OceanMesh.js`** - a grid that re-centers (snapped to texel size) on the focal point.

```js
import * as THREE from 'three';
import { config } from '../config.js';

export class OceanMesh {
  constructor(material) {
    const segs = config.mesh.tiles * config.mesh.quadRes;
    const geo = new THREE.PlaneGeometry(config.mesh.tiles, config.mesh.tiles, segs, segs).rotateX(-Math.PI/2);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }
  /** snap mesh under the focal point so vertices don't swim */
  recenter(focal) {
    const cell = config.sim.lengthScale / config.sim.N;
    this.mesh.position.x = Math.round(focal.x / cell) * cell;
    this.mesh.position.z = Math.round(focal.z / cell) * cell;
  }
}
```

- [ ] **Step 3: Wire into `main.js`** - remove the placeholder plane; create `OceanSim`, `OceanMesh`, set material textures each frame.

```js
import { OceanSim } from './wave/OceanSim.js';
import { OceanMesh } from './ocean/OceanMesh.js';
import { createOceanMaterial } from './ocean/oceanMaterial.js';

const sim = new OceanSim(renderer);
const oceanMat = createOceanMaterial();
const ocean = new OceanMesh(oceanMat);
scene.add(ocean.mesh);

let prev = performance.now(), t = 0;
renderer.setAnimationLoop((now) => {
  const dt = (now - prev) / 1000; prev = now; t += dt * config.sim.speed;
  sim.update(t);
  oceanMat.uniforms.uDisplacement.value = sim.displacementTexture;
  oceanMat.uniforms.uSlope.value = sim.slopeTexture;
  controls.update(dt, 0);
  ocean.recenter(controls.focal);
  renderer.render(scene, camera);
});
```

- [ ] **Step 4: Verify** - `npm run dev`. **Phase C milestone:** moving FFT waves on the grid, height-tinted, no obvious tiling within view. Commit:

```bash
git add src/ocean/OceanMesh.js src/ocean/oceanMaterial.js src/main.js
git commit -m "feat: displaced ocean mesh sampling FFT textures"
```

---

## Phase D - SoT-like shading (runnable: it looks like the ocean)

### Task D1: SSS + specular + fresnel + foam fragment

**Files:**
- Modify: `src/ocean/oceanMaterial.js`

Replace the debug fragment by porting the `fp` function from `docs/reference/FFTWater.shader:231-308`: `SchlickFresnel`, `SmithMaskingBeckmann`, `Beckmann`, the scatter terms `k1..k4`, and `output = (1-F)*scatter + specular + F*envReflection`. Compute the mesoNormal from the slope texture: `normal = normalize(vec3(-slope.x, 1.0, -slope.y))`. Use `Sky`'s gradient as `envReflection` by reflecting the view vector and sampling the same gradient function (share a `skyColor(dir)` GLSL helper). Feed `uSunDirection`, `uSunColor`, and the color/lighting uniforms from `config`.

- [ ] **Step 1: Add lighting uniforms** to `createOceanMaterial` (sun dir/color, scatter/bubble/foam colors, roughness, the scatter strengths, environmentLightStrength, heightModifier).

- [ ] **Step 2: Port the fragment shader** - full ported GLSL of `fp` with the slope-derived normal and a `skyColor(reflectDir)` environment term. Keep the height-gradient tint as a subtle base under the scatter.

- [ ] **Step 3: Verify** - `npm run dev`. **Phase D milestone:** deep-to-bright color, sun glints tracking the sun, brighter sky reflection at grazing angles, white foam on steep/curling crests. Tune `config` colors/strengths until it reads as SoT-like.

- [ ] **Step 4: Commit**

```bash
git add src/ocean/oceanMaterial.js src/config.js
git commit -m "feat: SoT-style SSS + specular + fresnel + foam shading"
```

---

## Phase E - Buoyancy seam + bobbing buoy (runnable: buoy rides the waves)

### Task E1: OceanSampler (async readback + bilinear)

**Files:**
- Create: `src/wave/OceanSampler.js`
- Test: `tests/sampler.test.js`

Mirrors `Buoyancy.cs`'s readback seam: each frame read back the displacement target's height channel into a CPU `Float32Array`, then `getHeightAndNormal(x,z)` bilinearly samples it (UV = `worldXZ / lengthScale`, wrapped). Async readback via `renderer.readRenderTargetPixelsAsync` (fallback to sync `readRenderTargetPixels`). MVP returns height (vertical displacement) and an up normal from neighboring texels.

- [ ] **Step 1: Write the failing test** - `tests/sampler.test.js` (pure bilinear math, no GPU)

```js
import { describe, it, expect } from 'vitest';
import { bilinearSample } from '../src/wave/OceanSampler.js';

describe('bilinear sample', () => {
  const N = 2;
  // texel heights: (0,0)=0 (1,0)=2 (0,1)=4 (1,1)=6
  const data = new Float32Array([0, 2, 4, 6]);
  it('returns texel value at integer centers', () => {
    expect(bilinearSample(data, N, 0.25, 0.25)).toBeCloseTo(0, 5); // center of texel (0,0)
  });
  it('interpolates along x', () => {
    expect(bilinearSample(data, N, 0.5, 0.25)).toBeCloseTo(1, 5);  // halfway (0,0)->(1,0)
  });
  it('wraps uv >= 1', () => {
    expect(bilinearSample(data, N, 1.25, 0.25)).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run, verify fail** - `npx vitest run tests/sampler.test.js` → FAIL.

- [ ] **Step 3: Implement `src/wave/OceanSampler.js`**

```js
/** Bilinearly sample a single-channel NxN height array at fractional uv (wrapped). */
export function bilinearSample(data, N, u, v) {
  u = ((u % 1) + 1) % 1; v = ((v % 1) + 1) % 1;
  const fx = u * N - 0.5, fy = v * N - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const at = (x, y) => data[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

import { config } from '../config.js';
export class OceanSampler {
  constructor(renderer, sim) {
    this.renderer = renderer; this.sim = sim; this.N = config.sim.N;
    this.rgba = new Float32Array(this.N * this.N * 4);
    this.height = new Float32Array(this.N * this.N);
    this._busy = false;
  }
  /** Pull the latest height field off the GPU (call once per frame). */
  async refresh() {
    if (this._busy) return; this._busy = true;
    const t = this.sim.heightTarget;
    try {
      if (this.renderer.readRenderTargetPixelsAsync)
        await this.renderer.readRenderTargetPixelsAsync(t, 0, 0, this.N, this.N, this.rgba);
      else this.renderer.readRenderTargetPixels(t, 0, 0, this.N, this.N, this.rgba);
      for (let i = 0; i < this.N * this.N; i++) this.height[i] = this.rgba[i * 4 + 1]; // .y
    } finally { this._busy = false; }
  }
  getHeightAndNormal(x, z) {
    const u = x / config.sim.lengthScale, v = z / config.sim.lengthScale;
    const h = bilinearSample(this.height, this.N, u, v);
    const e = 1 / this.N;
    const hx = bilinearSample(this.height, this.N, u + e, v) - bilinearSample(this.height, this.N, u - e, v);
    const hz = bilinearSample(this.height, this.N, u, v + e) - bilinearSample(this.height, this.N, u, v - e);
    const scale = config.sim.lengthScale * 2 * e;
    return { height: h, normal: [-hx / scale, 1, -hz / scale] };
  }
}
```

- [ ] **Step 4: Run, verify pass** - `npx vitest run tests/sampler.test.js` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/wave/OceanSampler.js tests/sampler.test.js
git commit -m "feat: OceanSampler readback + bilinear height query (buoyancy seam)"
```

### Task E2: Bobbing buoy + camera follows surface

**Files:**
- Create: `src/objects/Buoy.js`
- Modify: `src/main.js`

- [ ] **Step 1: Implement `src/objects/Buoy.js`**

```js
import * as THREE from 'three';

export class Buoy {
  constructor(scene) {
    const g = new THREE.SphereGeometry(2, 16, 12);
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xff5522, roughness: 0.5 }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._up = new THREE.Vector3(0, 1, 0);
  }
  /** Place + tilt on the surface using a sampler query. */
  update(x, z, sampler) {
    const { height, normal } = sampler.getHeightAndNormal(x, z);
    this.mesh.position.set(x, height, z);
    const n = new THREE.Vector3(...normal).normalize();
    this.mesh.quaternion.setFromUnitVectors(this._up, n);
    return height;
  }
}
```

- [ ] **Step 2: Wire into `main.js`** - create sampler + buoy; each frame refresh sampler, place the buoy at the focal point, feed its surface height to the camera follow.

```js
import { OceanSampler } from './wave/OceanSampler.js';
import { Buoy } from './objects/Buoy.js';
const sampler = new OceanSampler(renderer, sim);
const buoy = new Buoy(scene);
// inside the animation loop, after sim.update(t) and texture binding:
sampler.refresh();
const surfaceY = buoy.update(controls.focal.x, controls.focal.z, sampler);
controls.update(dt, surfaceY);
ocean.recenter(controls.focal);
```
(Remove the earlier `controls.update(dt, 0)` line so it isn't called twice.)

- [ ] **Step 3: Verify** - `npm run dev`. **Phase E / MVP milestone:** the orange buoy rides up and down with the waves and tilts to the surface; the camera follows its smoothed height; WASD sails the whole scene endlessly with no obvious tiling. Run the full test suite: `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add src/objects/Buoy.js src/main.js
git commit -m "feat: bobbing buoy consuming OceanSampler; camera follows surface"
```

---

## Self-Review

**Spec coverage:** WebGL2+Three.js+Vite (A1-A2) ✓; FFT/JONSWAP simulation (B,C) ✓; cascades - MVP single cascade, multi-cascade deferred (noted) ✓; clipmap - MVP following grid, clipmap deferred (noted) ✓; SSS+specular+fresnel+foam shading (D) ✓; height gradient (C4/D1) ✓; orbit-follow camera (A4) ✓; OceanSampler buoyancy seam + buoy (E) ✓; foam - MVP instantaneous, accumulation deferred (noted) ✓; error handling - capability gate (A2) + resize (A2) ✓ (context-loss deferred); testing - FFT/butterfly/jonswap/sampler/camera unit tests + visual milestones ✓.

**Placeholder scan:** Tasks C2/C3 intentionally summarize long mechanical HLSL→GLSL ports with explicit source line references rather than duplicating ~300 lines of shader; every other task has complete code. The shader bodies to port are pinned to exact files/lines in `docs/reference/`. This is the one place execution must transcribe from the saved reference.

**Type consistency:** `OceanSim` exposes `displacementTexture`, `slopeTexture`, `heightTarget` (used by `oceanMaterial`, `OceanSampler`). `OceanSampler.getHeightAndNormal` returns `{height, normal}` (consumed by `Buoy`). `controls.focal` is a `THREE.Vector3` used by `OceanMesh.recenter` and `Buoy.update`. `FullscreenPass`/`makeFloatTarget` signatures consistent across `fft.js`, `spectrumPass.js`, `OceanSim.js`.

---

## Deferred follow-up plan (after MVP)
Second cascade (kill remaining tiling), foam accumulation texture (decay over frames), CDLOD clipmap rings + geomorph for a true horizon, quality presets + auto-detect, origin rebasing for far travel, PBR specular upgrade, sea-spray particles, context-loss recovery - then the boat + buoyancy phase building on `OceanSampler`.
