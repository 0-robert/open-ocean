export const config = {
  sim: {
    N: 512,                 // FFT resolution per cascade (power of two)
    gravity: 9.81,
    depth: 50,              // moderately deep so swells come through without exploding
    repeatTime: 200,        // seconds before the sim loops
    speed: 1.0,
    lambda: [0.9, 0.9],     // horizontal (choppy) displacement strength [x, z]
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
  boat: {
    // driving
    accel: 12, maxSpeed: 16, linDrag: 0.5, turnAccel: 0.9, angDrag: 1.6,
    // buoyancy heave: stiff enough to track waves (sink into troughs, climb
    // crests) but damped for weight (not a bouncy cork)
    heaveStiffness: 5.5, heaveDamping: 3.0,
    // pitch/roll: damped spring toward the local wave slope
    rotStiffness: 9.0, rotDamping: 4.5,
    rotMax: 0.5,        // clamp tilt (rad) so steep crests don't flip it
    sampleScale: 0.9,   // hull-extent fraction used for slope sampling
  },
  fog: { near: 240, far: 560 },           // pulled in so the plane edge dissolves into the horizon
  bloom: { strength: 0.14, radius: 0.25, threshold: 0.95 }, // subtle glow on brightest foam/specular only
  foam: { bias: 0.67, threshold: 0.0, add: 1.0, amount: 2.6, decay: 0.97, injectRate: 1.0, flow: 0.0006 },
  colors: {
    deep: [0.0, 0.28, 0.38],         // bright teal trough (SoT)
    scatter: [0.15, 0.6, 0.62],      // bright cyan SSS glow (less saturated)
    bubble: [0.1, 0.4, 0.45],
    foam: [0.95, 0.99, 1.0],
    sunIrradiance: [1.1, 1.08, 1.0],
    sunDirection: [0.35, 0.45, 0.30], // will be normalized (lower sun = more grazing scatter)
    fog: [0.7, 0.82, 0.92],
  },
  lighting: {
    roughness: 0.14, normalStrength: 0.85,
    wavePeakScatterStrength: 2.0, scatterStrength: 0.9,
    scatterShadowStrength: 0.25, environmentLightStrength: 0.45, bubbleDensity: 0.4,
    heightModifier: 0.6,
  },
};
