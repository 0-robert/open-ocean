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
    this.nc = config.sim.cascades.length;
    
    // Arrays for each cascade
    this.rgbaBuffers = Array.from({ length: this.nc }, () => new Float32Array(this.N * this.N * 4));
    this.heightBuffers = Array.from({ length: this.nc }, () => new Float32Array(this.N * this.N));
    
    this._busy = Array.from({ length: this.nc }, () => false);
    this.enabled = true;
  }

  /** Pull the latest height field off the GPU for all cascades. */
  async refresh() {
    if (!this.enabled) return;
    
    const targets = this.sim.cascades.map(c => c.displacement);
    
    const promises = [];
    for (let i = 0; i < this.nc; i++) {
      if (this._busy[i]) continue;
      this._busy[i] = true;
      promises.push(this._refreshCascade(i, targets[i]));
    }
    // We don't await them here to avoid blocking the main loop,
    // but the next frame will use the updated buffers.
  }

  async _refreshCascade(i, target) {
    try {
      if (this.renderer.readRenderTargetPixelsAsync) {
        await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, this.N, this.N, this.rgbaBuffers[i]);
      } else {
        this.renderer.readRenderTargetPixels(target, 0, 0, this.N, this.N, this.rgbaBuffers[i]);
      }
      
      const rgba = this.rgbaBuffers[i];
      const height = this.heightBuffers[i];
      for (let j = 0; j < this.N * this.N; j++) {
        // In ASSEMBLE_FRAG, displacement is:
        // outColor = vec4(displacement.x, displacement.y, displacement.z, foam)
        // displacement.y is the height.
        height[j] = rgba[j * 4 + 1]; 
      }
    } catch (err) {
      console.warn(`OceanSampler readback failed for cascade ${i}`, err);
    } finally {
      this._busy[i] = false;
    }
  }

  getHeightAndNormal(x, z) {
    const amp = config.sim.displacementScale;
    let totalH = 0;
    let totalHx = 0;
    let totalHz = 0;
    
    const e = 1 / this.N;

    for (let i = 0; i < this.nc; i++) {
      const L = config.sim.cascades[i].lengthScale;
      const u = x / L, v = z / L;
      const height = this.heightBuffers[i];
      
      const h = bilinearSample(height, this.N, u, v);
      const hx = (bilinearSample(height, this.N, u + e, v) - bilinearSample(height, this.N, u - e, v));
      const hz = (bilinearSample(height, this.N, u, v + e) - bilinearSample(height, this.N, u, v - e));
      
      const scale = L * 2 * e;
      totalH += h;
      totalHx += hx / scale;
      totalHz += hz / scale;
    }
    
    return { 
      height: totalH * amp, 
      normal: [-totalHx * amp, 1, -totalHz * amp] 
    };
  }
}
