/**
 * Precomputed butterfly/twiddle data for an inverse FFT, laid out as a
 * (log2N x N) RGBA float texture: (twiddleRe, twiddleIm, indexA, indexB).
 * Ported from ComputeTwiddleFactorAndInputIndices in the reference compute shader,
 * with the twiddle imaginary part negated to make it an inverse transform.
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
      const o = (stage * N + y) * 4; // texel (x=stage, y=index)
      data[o] = tw_re;
      data[o + 1] = tw_im;
      data[o + 2] = i;
      data[o + 3] = i + b;
    }
  }
  return { width: stages, height: N, data };
}
