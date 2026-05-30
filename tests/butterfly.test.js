import { describe, it, expect } from 'vitest';
import { buildButterfly } from '../src/wave/butterfly.js';

describe('butterfly texture', () => {
  it('has dimensions log2(N) x N and 4 channels', () => {
    const N = 8;
    const { width, height, data } = buildButterfly(N);
    expect(width).toBe(3); // log2(8)
    expect(height).toBe(8);
    expect(data.length).toBe(3 * 8 * 4);
  });
  it('stage 0 pairs indices b apart with b=N/2', () => {
    const N = 8;
    const { data } = buildButterfly(N);
    // texel (stage=0, y=0): indices in channels .z (idxA), .w (idxB)
    const idxA = data[2], idxB = data[3];
    expect(idxA).toBe(0);
    expect(idxB).toBe(4); // 0 + N/2
  });
  it('throws for non-power-of-two', () => {
    expect(() => buildButterfly(6)).toThrow();
  });
});
