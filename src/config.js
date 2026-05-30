export const config = {
  sim: {
    N: 256,                 // FFT resolution per cascade (power of two)
    gravity: 9.81,
    depth: 50,              // moderately deep so swells come through without exploding
    repeatTime: 200,        // seconds before the sim loops
    speed: 1.0,
    lambda: [0.8, 0.8],     // horizontal (choppy) displacement strength [x, z]
    displacementScale: 1.1, // global wave-height multiplier (visibility)
    seed: 0,
    // Stacked FFT cascades at different patch sizes + frequency bands (wavenumber
    // cutoffs) so they don't double-count: swell, waves, ripples. Non-harmonic
    // length scales make the combined tiling period effectively invisible.
    cascades: [
      { lengthScale: 250, lowCutoff: 0.0001, highCutoff: 0.6 },
      { lengthScale: 90,  lowCutoff: 0.6,    highCutoff: 3.0 },
      { lengthScale: 28,  lowCutoff: 3.0,    highCutoff: 9000 },
    ],
  },
  // JONSWAP display params (see buildSpectrumParams).
  spectrum: {
    scale: 1.0, windSpeed: 13.0, windDirection: 22.0, fetch: 100000,
    spreadBlend: 1.0, swell: 0.3, peakEnhancement: 3.3, shortWavesFade: 0.02,
  },
  mesh: { tiles: 1000, quadRes: 0.8 },    // grid extent (world units) and vertices per unit
  fog: { near: 240, far: 560 },           // pulled in so the plane edge dissolves into the horizon
  foam: { bias: 0.45, threshold: 0.0, add: 1.0, amount: 2.5 },
  colors: {
    deep: [0.0, 0.09, 0.16],         // dark navy trough
    scatter: [0.0, 0.32, 0.40],      // ocean teal SSS glow (not neon)
    bubble: [0.0, 0.12, 0.18],
    foam: [0.92, 0.97, 1.0],
    sunIrradiance: [1.0, 0.98, 0.92],
    sunDirection: [0.35, 0.45, 0.30], // will be normalized (lower sun = more grazing scatter)
    fog: [0.66, 0.76, 0.88],
  },
  lighting: {
    roughness: 0.10, normalStrength: 1.0,
    wavePeakScatterStrength: 1.6, scatterStrength: 0.6,
    scatterShadowStrength: 0.2, environmentLightStrength: 1.0, bubbleDensity: 0.2,
    heightModifier: 0.6,
  },
};
