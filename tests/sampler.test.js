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
    expect(bilinearSample(data, N, 0.5, 0.25)).toBeCloseTo(1, 5); // halfway (0,0)->(1,0)
  });
  it('wraps uv >= 1', () => {
    expect(bilinearSample(data, N, 1.25, 0.25)).toBeCloseTo(0, 5);
  });
});
