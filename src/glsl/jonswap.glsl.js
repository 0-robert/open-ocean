/**
 * JONSWAP spectrum helpers, ported from docs/reference/FFTWater.compute.
 * HLSL -> GLSL ES 3.0: float2->vec2, lerp->mix, rcp->1.0/x, atan2->atan,
 * saturate->clamp(...,0,1). Hyperbolic fns (tanh/cosh) are built into GLSL ES 3.00.
 */
export const jonswapHelpersGLSL = /* glsl */`
  struct Spec {
    float scale; float angle; float spreadBlend; float swell;
    float alpha; float peakOmega; float gamma; float shortWavesFade;
  };

  uint hashU(uint n) {
    n = (n << 13u) ^ n;
    n = n * (n * n * 15731u + 789221u) + 1376312589u;
    return n;
  }
  float hashf(uint n) { return float(hashU(n) & 0x7fffffffu) / float(0x7fffffff); }

  vec2 uniformToGaussian(float u1, float u2) {
    float R = sqrt(-2.0 * log(max(u1, 1e-6)));
    float theta = 2.0 * PI * u2;
    return vec2(R * cos(theta), R * sin(theta));
  }

  float dispersion(float kMag, float g, float depth) {
    return sqrt(g * kMag * tanh(min(kMag * depth, 20.0)));
  }
  float dispersionDerivative(float kMag, float g, float depth) {
    float th = tanh(min(kMag * depth, 20.0));
    float ch = cosh(kMag * depth);
    return g * (depth * kMag / (ch * ch) + th) / dispersion(kMag, g, depth) / 2.0;
  }

  float normalizationFactor(float s) {
    float s2 = s * s, s3 = s2 * s, s4 = s3 * s;
    if (s < 5.0) return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163;
    return -4.80e-08 * s4 + 1.07e-05 * s3 - 9.53e-04 * s2 + 5.90e-02 * s + 3.93e-01;
  }
  float cosine2s(float theta, float s) {
    return normalizationFactor(s) * pow(abs(cos(0.5 * theta)), 2.0 * s);
  }
  float spreadPower(float omega, float peakOmega) {
    if (omega > peakOmega) return 9.77 * pow(abs(omega / peakOmega), -2.5);
    return 6.97 * pow(abs(omega / peakOmega), 5.0);
  }
  float directionSpectrum(float theta, float omega, Spec s) {
    float sp = spreadPower(omega, s.peakOmega)
             + 16.0 * tanh(min(omega / s.peakOmega, 20.0)) * s.swell * s.swell;
    return mix(2.0 / PI * cos(theta) * cos(theta), cosine2s(theta - s.angle, sp), s.spreadBlend);
  }

  float tmaCorrection(float omega, float g, float depth) {
    float omegaH = omega * sqrt(depth / g);
    if (omegaH <= 1.0) return 0.5 * omegaH * omegaH;
    if (omegaH < 2.0) return 1.0 - 0.5 * (2.0 - omegaH) * (2.0 - omegaH);
    return 1.0;
  }

  float jonswap(float omega, Spec s, float g, float depth) {
    float sigma = (omega <= s.peakOmega) ? 0.07 : 0.09;
    float r = exp(-(omega - s.peakOmega) * (omega - s.peakOmega)
                  / 2.0 / sigma / sigma / s.peakOmega / s.peakOmega);
    float oneOverOmega = 1.0 / omega;
    float peakOmegaOverOmega = s.peakOmega / omega;
    return s.scale * tmaCorrection(omega, g, depth) * s.alpha * g * g
      * oneOverOmega * oneOverOmega * oneOverOmega * oneOverOmega * oneOverOmega
      * exp(-1.25 * peakOmegaOverOmega * peakOmegaOverOmega * peakOmegaOverOmega * peakOmegaOverOmega)
      * pow(abs(s.gamma), r);
  }

  float shortWavesFade(float kLength, Spec s) {
    return exp(-s.shortWavesFade * s.shortWavesFade * kLength * kLength);
  }

  Spec makeSpec(vec4 a, vec4 b) {
    return Spec(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w);
  }
`;
