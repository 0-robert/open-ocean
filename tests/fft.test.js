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
