import { describe, it, expect } from 'vitest';
import { jonswapAlpha, jonswapPeakOmega, buildSpectrumParams } from '../src/wave/jonswap.js';

describe('JONSWAP params', () => {
  it('alpha matches reference formula', () => {
    const g = 9.81, fetch = 100000, U = 2;
    const expected = 0.076 * Math.pow((g * fetch) / (U * U), -0.22);
    expect(jonswapAlpha(fetch, U, g)).toBeCloseTo(expected, 6);
  });
  it('peakOmega matches reference formula', () => {
    const g = 9.81, fetch = 100000, U = 2;
    const expected = 22 * Math.pow((U * fetch) / (g * g), -0.33);
    expect(jonswapPeakOmega(fetch, U, g)).toBeCloseTo(expected, 6);
  });
  it('buildSpectrumParams converts windDirection to radians and clamps swell', () => {
    const p = buildSpectrumParams(
      { windDirection: 180, windSpeed: 2, fetch: 100000, scale: 1, spreadBlend: 1, swell: 0.2, peakEnhancement: 3.3, shortWavesFade: 0.01 },
      9.81,
    );
    expect(p.angle).toBeCloseTo(Math.PI, 5);
    expect(p.swell).toBeGreaterThanOrEqual(0.01);
    expect(p.gamma).toBeCloseTo(3.3, 5);
  });
});
