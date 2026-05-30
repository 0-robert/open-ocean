import { describe, it, expect } from 'vitest';
import { buildButterfly } from '../src/wave/butterfly.js';
import { fft1d } from '../src/wave/fftReference.js';

/**
 * Locks the butterfly-texture LAYOUT contract used by src/wave/fft.js:
 * the data is packed (stage*N + idx) and the GPU fetches it at texel
 * (x=idx, y=stage) on a texture sized (width=N, height=stages). This test
 * simulates that exact texel addressing and verifies the ping-pong FFT inverts
 * a transform. If the texture dims / fetch coords are ever transposed again,
 * the resulting moiré garbage shows up here.
 */
function texelFetchButterfly(bf, N, idx, stage) {
  // texture width=N, height=stages, row-major => texel(x=idx, y=stage) at (stage*N + idx)
  const o = (stage * N + idx) * 4;
  return { tw: [bf.data[o], bf.data[o + 1]], a: bf.data[o + 2], b: bf.data[o + 3] };
}

function gpuInverse(re, im, N) {
  const bf = buildButterfly(N);
  const stages = Math.log2(N);
  let A = { re: re.slice(), im: im.slice() };
  let B = { re: new Array(N), im: new Array(N) };
  for (let s = 0; s < stages; s++) {
    for (let idx = 0; idx < N; idx++) {
      const { tw, a, b } = texelFetchButterfly(bf, N, idx, s);
      const br = A.re[b], bi = A.im[b];
      const cr = tw[0] * br - tw[1] * bi, ci = tw[0] * bi + tw[1] * br;
      B.re[idx] = A.re[a] + cr;
      B.im[idx] = A.im[a] + ci;
    }
    [A, B] = [B, A];
  }
  return A;
}

describe('GPU butterfly FFT layout', () => {
  it('inverts a forward FFT (recovers the signal) at the texel layout fft.js uses', () => {
    const N = 8;
    const sig = [0, 0.7, 1, 0.7, 0, -0.7, -1, -0.7];
    const fwd = fft1d(sig.slice(), new Array(N).fill(0), false);
    const inv = gpuInverse(fwd.re, fwd.im, N);
    for (let i = 0; i < N; i++) {
      expect(inv.re[i] / N).toBeCloseTo(sig[i], 6); // unnormalized inverse => divide by N
      expect(inv.im[i] / N).toBeCloseTo(0, 6);
    }
  });
});
