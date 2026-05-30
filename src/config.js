export const config = {
  sim: {
    N: 256,                 // FFT resolution (power of two)
    lengthScale: 250,       // patch size in world units (reference lengthScale1)
    gravity: 9.81,
    depth: 20,
    repeatTime: 200,        // seconds before the sim loops
    speed: 1.0,
    lambda: [1.0, 1.0],     // horizontal (choppy) displacement strength [x, z]
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
  foam: { bias: -0.5, threshold: 0.0, add: 0.5 },
  colors: {
    scatter: [0.0, 0.18, 0.22],
    bubble: [0.0, 0.02, 0.03],
    foam: [0.9, 0.95, 1.0],
    sunIrradiance: [1.0, 0.95, 0.85],
    sunDirection: [0.3, 0.6, 0.4],   // will be normalized
    fog: [0.62, 0.72, 0.84],
  },
  lighting: {
    roughness: 0.08, wavePeakScatterStrength: 1.0, scatterStrength: 1.0,
    scatterShadowStrength: 0.5, environmentLightStrength: 1.0, bubbleDensity: 1.0,
    heightModifier: 1.0,
  },
};
