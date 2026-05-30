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
