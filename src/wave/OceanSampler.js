import { config } from '../config.js';

/** Bilinearly sample a single-channel NxN height array at fractional uv (wrapped). */
export function bilinearSample(data, N, u, v) {
  u = ((u % 1) + 1) % 1;
  v = ((v % 1) + 1) % 1;
  const fx = u * N - 0.5, fy = v * N - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const at = (x, y) => data[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * The buoyancy seam: reads the FFT height field back to the CPU and exposes a
 * bilinear height/normal query. Mirrors the async-readback approach in
 * docs/reference/Buoyancy.cs. Resilient to readback failures (disables itself
 * and reports a flat surface so rendering is never blocked).
 */
export class OceanSampler {
  constructor(renderer, sim) {
    this.renderer = renderer;
    this.sim = sim;
    this.N = config.sim.N;
    this.rgba = new Float32Array(this.N * this.N * 4);
    this.height = new Float32Array(this.N * this.N);
    this._busy = false;
    this.enabled = true;
  }

  /** Pull the latest height field off the GPU (call once per frame). */
  async refresh() {
    if (!this.enabled || this._busy) return;
    this._busy = true;
    const t = this.sim.heightTarget;
    try {
      if (this.renderer.readRenderTargetPixelsAsync) {
        await this.renderer.readRenderTargetPixelsAsync(t, 0, 0, this.N, this.N, this.rgba);
      } else {
        this.renderer.readRenderTargetPixels(t, 0, 0, this.N, this.N, this.rgba);
      }
      for (let i = 0; i < this.N * this.N; i++) this.height[i] = this.rgba[i * 4 + 1]; // .y
    } catch (err) {
      console.warn('OceanSampler readback failed; disabling buoy height sampling.', err);
      this.enabled = false;
    } finally {
      this._busy = false;
    }
  }

  getHeightAndNormal(x, z) {
    const L = config.sim.cascades[0].lengthScale;
    const amp = config.sim.displacementScale;
    const u = x / L, v = z / L;
    const h = bilinearSample(this.height, this.N, u, v) * amp;
    const e = 1 / this.N;
    const hx = (bilinearSample(this.height, this.N, u + e, v) - bilinearSample(this.height, this.N, u - e, v)) * amp;
    const hz = (bilinearSample(this.height, this.N, u, v + e) - bilinearSample(this.height, this.N, u, v - e)) * amp;
    const scale = L * 2 * e;
    return { height: h, normal: [-hx / scale, 1, -hz / scale] };
  }
}
