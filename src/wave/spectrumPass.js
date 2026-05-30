import * as THREE from 'three';
import { complexGLSL } from '../glsl/complex.glsl.js';
import { jonswapHelpersGLSL } from '../glsl/jonswap.glsl.js';
import { FullscreenPass, makeFloatTarget } from '../core/fullscreenPass.js';

// Ports CS_InitializeSpectrum (single cascade): writes h0 into .rg.
const INIT_FRAG = /* glsl */`
  precision highp float;
  precision highp int;
  ${complexGLSL}
  ${jonswapHelpersGLSL}
  uniform float uN, uLengthScale, uGravity, uDepth, uLowCutoff, uHighCutoff, uSeed;
  uniform vec4 uSpec0a, uSpec0b, uSpec1a, uSpec1b;
  out vec4 outColor;

  void main() {
    ivec2 id = ivec2(gl_FragCoord.xy);
    float halfN = uN / 2.0;
    float deltaK = 2.0 * PI / uLengthScale;
    vec2 K = (vec2(id) - halfN) * deltaK;
    float kLength = length(K);

    uint seed = uint(id.x) + uint(uN) * uint(id.y) + uint(uN) + uint(uSeed);
    seed += uint(hashf(seed) * 10.0);
    vec4 rnd = vec4(hashf(seed), hashf(seed * 2u), hashf(seed * 3u), hashf(seed * 4u));
    vec2 gauss1 = uniformToGaussian(rnd.x, rnd.y);
    vec2 gauss2 = uniformToGaussian(rnd.z, rnd.w);

    if (uLowCutoff <= kLength && kLength <= uHighCutoff) {
      Spec s0 = makeSpec(uSpec0a, uSpec0b);
      Spec s1 = makeSpec(uSpec1a, uSpec1b);
      float kAngle = atan(K.y, K.x);
      float omega = dispersion(kLength, uGravity, uDepth);
      float dOmegadk = dispersionDerivative(kLength, uGravity, uDepth);

      float spectrum = jonswap(omega, s0, uGravity, uDepth)
                     * directionSpectrum(kAngle, omega, s0)
                     * shortWavesFade(kLength, s0);
      if (s1.scale > 0.0) {
        spectrum += jonswap(omega, s1, uGravity, uDepth)
                  * directionSpectrum(kAngle, omega, s1)
                  * shortWavesFade(kLength, s1);
      }

      vec2 h0 = vec2(gauss2.x, gauss1.y)
              * sqrt(2.0 * spectrum * abs(dOmegadk) / kLength * deltaK * deltaK);
      outColor = vec4(h0, 0.0, 0.0);
    } else {
      outColor = vec4(0.0);
    }
  }
`;

// Ports CS_PackSpectrumConjugate: store h0 and conj(h0(-k)).
const CONJ_FRAG = /* glsl */`
  precision highp float;
  precision highp int;
  uniform sampler2D uSource;
  uniform float uN;
  out vec4 outColor;
  void main() {
    ivec2 id = ivec2(gl_FragCoord.xy);
    int N = int(uN);
    vec2 h0 = texelFetch(uSource, id, 0).rg;
    ivec2 minusK = ivec2((N - id.x) % N, (N - id.y) % N);
    vec2 h0conj = texelFetch(uSource, minusK, 0).rg;
    outColor = vec4(h0, h0conj.x, -h0conj.y);
  }
`;

export class SpectrumPass {
  constructor(renderer, N) {
    this.renderer = renderer;
    this.N = N;
    this.h0 = makeFloatTarget(N);
    this.tmp = makeFloatTarget(N);
    this.initUniforms = {
      uN: { value: N }, uLengthScale: { value: 250 }, uGravity: { value: 9.81 },
      uDepth: { value: 20 }, uLowCutoff: { value: 0.0001 }, uHighCutoff: { value: 9000 }, uSeed: { value: 0 },
      uSpec0a: { value: new THREE.Vector4() }, uSpec0b: { value: new THREE.Vector4() },
      uSpec1a: { value: new THREE.Vector4() }, uSpec1b: { value: new THREE.Vector4() },
    };
    this.initPass = new FullscreenPass(INIT_FRAG, this.initUniforms);
    this.conjPass = new FullscreenPass(CONJ_FRAG, { uSource: { value: null }, uN: { value: N } });
  }

  build(p0, p1, opts) {
    const u = this.initUniforms;
    u.uLengthScale.value = opts.lengthScale;
    u.uGravity.value = opts.gravity;
    u.uDepth.value = opts.depth;
    u.uLowCutoff.value = opts.lowCutoff;
    u.uHighCutoff.value = opts.highCutoff;
    u.uSeed.value = opts.seed;
    u.uSpec0a.value.set(p0.scale, p0.angle, p0.spreadBlend, p0.swell);
    u.uSpec0b.value.set(p0.alpha, p0.peakOmega, p0.gamma, p0.shortWavesFade);
    u.uSpec1a.value.set(p1.scale, p1.angle, p1.spreadBlend, p1.swell);
    u.uSpec1b.value.set(p1.alpha, p1.peakOmega, p1.gamma, p1.shortWavesFade);

    this.initPass.render(this.renderer, this.tmp);
    this.conjPass.material.uniforms.uSource.value = this.tmp.texture;
    this.conjPass.render(this.renderer, this.h0);
    return this.h0;
  }
}
