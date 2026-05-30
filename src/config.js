export const config = {
  sim: {
    N: 256,                 // FFT resolution (power of two)
    lengthScale: 250,       // patch size in world units (reference lengthScale1)
    gravity: 9.81,
    depth: 20,
    repeatTime: 200,        // seconds before the sim loops
    speed: 1.0,
    lambda: [1.3, 1.3],     // horizontal (choppy) displacement strength [x, z]
    lowCutoff: 0.0001,
    highCutoff: 9000,
    seed: 0,
  },
  // JONSWAP display params (see buildSpectrumParams).
  spectrum: {
    scale: 1.0, windSpeed: 12.0, windDirection: 22.0, fetch: 100000,
    spreadBlend: 1.0, swell: 0.2, peakEnhancement: 3.3, shortWavesFade: 0.01,
  },
  mesh: { tiles: 400, quadRes: 1.5 },     // grid extent (world units) and vertices per unit
  foam: { bias: -0.4, threshold: 0.0, add: 0.9 },
  colors: {
    deep: [0.02, 0.22, 0.30],        // body color of the water (deep teal)
    scatter: [0.06, 0.55, 0.52],     // turquoise SSS glow through crests
    bubble: [0.18, 0.55, 0.55],
    foam: [0.92, 0.97, 1.0],
    sunIrradiance: [1.3, 1.25, 1.15],
    sunDirection: [0.35, 0.45, 0.30], // will be normalized (lower sun = more grazing scatter)
    fog: [0.66, 0.76, 0.88],
  },
  lighting: {
    roughness: 0.10, normalStrength: 1.0,
    wavePeakScatterStrength: 2.2, scatterStrength: 1.2,
    scatterShadowStrength: 0.25, environmentLightStrength: 0.9, bubbleDensity: 0.7,
    heightModifier: 0.6,
  },
};
