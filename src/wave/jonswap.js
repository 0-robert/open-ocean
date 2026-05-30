export const jonswapAlpha = (fetch, windSpeed, g) =>
  0.076 * Math.pow((g * fetch) / (windSpeed * windSpeed), -0.22);

export const jonswapPeakOmega = (fetch, windSpeed, g) =>
  22 * Math.pow((windSpeed * fetch) / (g * g), -0.33);

/** Maps display settings -> the 8 floats the spectrum shader expects. */
export function buildSpectrumParams(s, g) {
  return {
    scale: s.scale,
    angle: (s.windDirection / 180) * Math.PI,
    spreadBlend: s.spreadBlend,
    swell: Math.max(0.01, Math.min(1, s.swell)),
    alpha: jonswapAlpha(s.fetch, s.windSpeed, g),
    peakOmega: jonswapPeakOmega(s.fetch, s.windSpeed, g),
    gamma: s.peakEnhancement,
    shortWavesFade: s.shortWavesFade,
  };
}
