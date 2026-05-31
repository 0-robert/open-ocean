import { config } from '../config.js';

/** Bilinearly sample a single-channel NxN array at fractional uv (wrapped). */
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

/** Bilinear within a W x W window buffer, clamped to its edges. */
function bilinearWindow(data, W, fx, fy) {
  fx = Math.max(0, Math.min(W - 1.0001, fx));
  fy = Math.max(0, Math.min(W - 1.0001, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const at = (x, y) => data[y * W + x];
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Buoyancy seam: reads the FFT height field back to the CPU. OPTIMIZED — instead
 * of reading the full N×N displacement of every cascade each frame (O(N²), ~12MB
 * at N=512), it reads only a small W×W window around the boat (O(W²), ~64KB),
 * since the boat samples a handful of points in a tiny region. Same query API.
 */
export class OceanSampler {
  constructor(renderer, sim) {
    this.renderer = renderer;
    this.sim = sim;
    this.N = config.sim.N;
    this.nc = config.sim.cascades.length;
    this.W = Math.min(64, this.N); // readback window (texels) — covers the hull span
    this.centerX = 0;
    this.centerZ = 0;
    this.enabled = true;
    this.cascades = Array.from({ length: this.nc }, () => ({
      rgba: new Float32Array(this.W * this.W * 4),
      height: new Float32Array(this.W * this.W),
      x0: 0, y0: 0, // window origin (texels) the current `height` buffer holds
      busy: false,
    }));
  }

  /** @param x,z world position to center the readback window on (the boat). */
  setCenter(x, z) {
    this.centerX = x;
    this.centerZ = z;
  }

  refresh() {
    if (!this.enabled) return;
    for (let i = 0; i < this.nc; i++) this._refreshCascade(i);
  }

  async _refreshCascade(i) {
    const c = this.cascades[i];
    if (c.busy) return;
    c.busy = true;
    const { N, W } = this;
    const L = config.sim.cascades[i].lengthScale;
    const cx = (((this.centerX / L) % 1) + 1) % 1 * N;
    const cz = (((this.centerZ / L) % 1) + 1) % 1 * N;
    let x0 = Math.round(cx - W / 2);
    let y0 = Math.round(cz - W / 2);
    x0 = Math.max(0, Math.min(N - W, x0)); // keep the window inside the texture
    y0 = Math.max(0, Math.min(N - W, y0));
    const target = this.sim.cascades[i].displacement;
    try {
      if (this.renderer.readRenderTargetPixelsAsync) {
        await this.renderer.readRenderTargetPixelsAsync(target, x0, y0, W, W, c.rgba);
      } else {
        this.renderer.readRenderTargetPixels(target, x0, y0, W, W, c.rgba);
      }
      for (let j = 0; j < W * W; j++) c.height[j] = c.rgba[j * 4 + 1]; // .y = height
      c.x0 = x0;
      c.y0 = y0;
    } catch (err) {
      console.warn('OceanSampler readback failed; disabling.', err);
      this.enabled = false;
    } finally {
      c.busy = false;
    }
  }

  getHeightAndNormal(x, z) {
    const amp = config.sim.displacementScale;
    const { N, W } = this;
    let h = 0;
    for (let i = 0; i < this.nc; i++) {
      const c = this.cascades[i];
      const L = config.sim.cascades[i].lengthScale;
      const lx = (((x / L) % 1) + 1) % 1 * N - c.x0;
      const lz = (((z / L) % 1) + 1) % 1 * N - c.y0;
      h += bilinearWindow(c.height, W, lx, lz);
    }
    return { height: h * amp, normal: [0, 1, 0] };
  }
}
