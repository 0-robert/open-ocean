export const config = {
  sim: {
    N: 512,                 // FFT resolution per cascade (power of two)
    gravity: 9.81,
    depth: 50,              // moderately deep so swells come through without exploding
    repeatTime: 200,        // seconds before the sim loops
    speed: 1.0,
    lambda: [0.9, 0.9],     // horizontal (choppy) displacement strength [x, z]
    displacementScale: 0.75, // global wave-height multiplier (visibility)
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
    scale: 1.0, windSpeed: 12.0, windDirection: 22.0, fetch: 100000,
    spreadBlend: 1.0, swell: 0.3, peakEnhancement: 3.3, shortWavesFade: 0.02,
  },
  mesh: { tiles: 1000, quadRes: 0.8 },    // grid extent (world units) and vertices per unit
  boat: {
    // driving
    accel: 7, maxSpeed: 9, linDrag: 0.5, turnAccel: 0.7, angDrag: 1.6,
    // RIGID-BODY BUOYANCY: real gravity + Archimedes force (~submerged depth) at
    // each hull point; the same forces produce pitch/roll torque (self-righting).
    // World is 2.68 units/metre (boat 7 m = 18.75 units), so gravity = 9.81*2.68
    // or the fall looks moon-slow. Buoyancy scales with it to hold the waterline.
    gravity: 26.3,
    mass: 1.0,
    buoyancy: 5.9,      // upward force per unit submerged depth per hull point
    heaveDrag: 4.5,     // vertical water resistance (damps the bob)
    inertia: 35.0,      // rotational inertia (higher = slower to rock)
    rotDrag: 2.8,       // angular water resistance
    rotMax: 0.5,        // clamp tilt (rad) so steep crests don't flip it
    sampleScale: 0.9,   // hull-extent fraction used for buoyancy sampling
  },
  fog: { near: 240, far: 560 },           // pulled in so the plane edge dissolves into the horizon
  bloom: { strength: 0.15, radius: 0.25, threshold: 0.95 }, // subtle glow on brightest foam/specular only
  foam: {
    bias: 0.96, threshold: 0.0, add: 0.15, amount: 4.2,
    decay: 0.986,       // per-frame foam persistence (tuned)
    injectRate: 1.0,
    flow: 0.002,        // uv advection/frame (foam drifts downwind)
    wakeStrength: 0.6,  // foam injected along the boat's path (scaled by speed)
    wakeRadius: 5.0,    // world-unit radius of the wake foam
    wakeOffset: 5.0,    // how far behind the stern the wake is injected
    wakeDecay: 0.992,   // wake-trail persistence per frame (higher = longer trail)
  },
  colors: {
    deep: [0.0, 0.667, 1.0],         // 00aaff (tuned)
    scatter: [0.424, 0.796, 0.808],  // 6ccbce (tuned)
    bubble: [0.1, 0.4, 0.45],
    foam: [0.976, 0.996, 1.0],       // f9feff (tuned)
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
