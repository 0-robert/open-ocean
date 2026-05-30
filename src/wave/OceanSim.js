import * as THREE from 'three';
import { complexGLSL } from '../glsl/complex.glsl.js';
import { FullscreenPass, makeFloatTarget } from '../core/fullscreenPass.js';
import { SpectrumPass } from './spectrumPass.js';
import { FFT } from './fft.js';
import { buildSpectrumParams } from './jonswap.js';
import { config } from '../config.js';

// Ports CS_UpdateSpectrumForFFT (single cascade). uMode selects which packed
// field to output (0 = displacement, 1 = slope) so we avoid MRT.
const EVOLVE_FRAG = /* glsl */`
  precision highp float;
  precision highp int;
  ${complexGLSL}
  uniform sampler2D uH0;
  uniform float uN, uLengthScale, uGravity, uRepeatTime, uTime;
  uniform int uMode;
  out vec4 outColor;

  void main() {
    ivec2 id = ivec2(gl_FragCoord.xy);
    vec4 initialSignal = texelFetch(uH0, id, 0);
    vec2 h0 = initialSignal.xy;
    vec2 h0conj = initialSignal.zw;

    float halfN = uN / 2.0;
    vec2 K = (vec2(id) - halfN) * 2.0 * PI / uLengthScale;
    float kMag = length(K);
    float kMagRcp = (kMag < 0.0001) ? 1.0 : 1.0 / kMag;

    float w_0 = 2.0 * PI / uRepeatTime;
    float disp = floor(sqrt(uGravity * kMag) / w_0) * w_0 * uTime;
    vec2 exponent = euler(disp);

    vec2 htilde = cmul(h0, exponent) + cmul(h0conj, vec2(exponent.x, -exponent.y));
    vec2 ih = vec2(-htilde.y, htilde.x);

    vec2 displacementX = ih * K.x * kMagRcp;
    vec2 displacementY = htilde;
    vec2 displacementZ = ih * K.y * kMagRcp;
    vec2 displacementX_dx = -htilde * K.x * K.x * kMagRcp;
    vec2 displacementY_dx = ih * K.x;
    vec2 displacementZ_dx = -htilde * K.x * K.y * kMagRcp;
    vec2 displacementY_dz = ih * K.y;
    vec2 displacementZ_dz = -htilde * K.y * K.y * kMagRcp;

    vec2 htildeDisplacementX = vec2(displacementX.x - displacementZ.y, displacementX.y + displacementZ.x);
    vec2 htildeDisplacementZ = vec2(displacementY.x - displacementZ_dx.y, displacementY.y + displacementZ_dx.x);
    vec2 htildeSlopeX = vec2(displacementY_dx.x - displacementY_dz.y, displacementY_dx.y + displacementY_dz.x);
    vec2 htildeSlopeZ = vec2(displacementX_dx.x - displacementZ_dz.y, displacementX_dx.y + displacementZ_dz.x);

    if (uMode == 0) outColor = vec4(htildeDisplacementX, htildeDisplacementZ);
    else outColor = vec4(htildeSlopeX, htildeSlopeZ);
  }
`;

// Ports CS_AssembleMaps (single cascade, instantaneous foam for the MVP).
const ASSEMBLE_FRAG = /* glsl */`
  precision highp float;
  precision highp int;
  uniform sampler2D uDisp;   // IFFT of displacement spectrum
  uniform sampler2D uSlope;  // IFFT of slope spectrum
  uniform vec2 uLambda;
  uniform float uFoamBias, uFoamThreshold, uFoamAdd;
  uniform int uMode;
  out vec4 outColor;

  vec4 permute(vec4 data, ivec2 id) {
    return data * (1.0 - 2.0 * mod(float(id.x + id.y), 2.0));
  }

  void main() {
    ivec2 id = ivec2(gl_FragCoord.xy);
    vec4 htildeDisplacement = permute(texelFetch(uDisp, id, 0), id);
    vec4 htildeSlope = permute(texelFetch(uSlope, id, 0), id);

    vec2 dxdz = htildeDisplacement.rg;
    vec2 dydxz = htildeDisplacement.ba;
    vec2 dyxdyz = htildeSlope.rg;
    vec2 dxxdzz = htildeSlope.ba;

    float jacobian = (1.0 + uLambda.x * dxxdzz.x) * (1.0 + uLambda.y * dxxdzz.y)
                   - uLambda.x * uLambda.y * dydxz.y * dydxz.y;
    vec3 displacement = vec3(uLambda.x * dxdz.x, dydxz.x, uLambda.y * dxdz.y);
    vec2 slopes = dyxdyz.xy / (1.0 + abs(dxxdzz * uLambda));

    float biasedJacobian = max(0.0, -(jacobian - uFoamBias));
    float foam = (biasedJacobian > uFoamThreshold) ? uFoamAdd * biasedJacobian : 0.0;

    if (uMode == 0) outColor = vec4(displacement, clamp(foam, 0.0, 1.0));
    else outColor = vec4(slopes, 0.0, 0.0);
  }
`;

export class OceanSim {
  constructor(renderer) {
    const N = config.sim.N;
    this.renderer = renderer;
    this.N = N;

    this.spectrum = new SpectrumPass(renderer, N);
    const p0 = buildSpectrumParams(config.spectrum, config.sim.gravity);
    const p1 = { ...p0, scale: 0 }; // MVP: single spectrum; second disabled
    this.h0 = this.spectrum.build(p0, p1, config.sim);

    this.fftDisp = new FFT(renderer, N);
    this.fftSlope = new FFT(renderer, N);

    this.dispSpectrum = makeFloatTarget(N);
    this.slopeSpectrum = makeFloatTarget(N);
    this.displacement = makeFloatTarget(N); // xyz + foam
    this.slope = makeFloatTarget(N);        // normal slopes

    this.evolveUniforms = {
      uH0: { value: this.h0.texture },
      uN: { value: N }, uLengthScale: { value: config.sim.lengthScale },
      uGravity: { value: config.sim.gravity }, uRepeatTime: { value: config.sim.repeatTime },
      uTime: { value: 0 }, uMode: { value: 0 },
    };
    this.evolvePass = new FullscreenPass(EVOLVE_FRAG, this.evolveUniforms);

    this.assembleUniforms = {
      uDisp: { value: null }, uSlope: { value: null },
      uLambda: { value: new THREE.Vector2(...config.sim.lambda) },
      uFoamBias: { value: config.foam.bias }, uFoamThreshold: { value: config.foam.threshold },
      uFoamAdd: { value: config.foam.add }, uMode: { value: 0 },
    };
    this.assemblePass = new FullscreenPass(ASSEMBLE_FRAG, this.assembleUniforms);
  }

  /** @param time seconds (already scaled by sim speed) */
  update(time) {
    const eu = this.evolveUniforms;
    eu.uTime.value = time;
    eu.uMode.value = 0;
    this.evolvePass.render(this.renderer, this.dispSpectrum);
    eu.uMode.value = 1;
    this.evolvePass.render(this.renderer, this.slopeSpectrum);

    const dispSpatial = this.fftDisp.run(this.dispSpectrum);
    const slopeSpatial = this.fftSlope.run(this.slopeSpectrum);

    const au = this.assembleUniforms;
    au.uDisp.value = dispSpatial.texture;
    au.uSlope.value = slopeSpatial.texture;
    au.uMode.value = 0;
    this.assemblePass.render(this.renderer, this.displacement);
    au.uMode.value = 1;
    this.assemblePass.render(this.renderer, this.slope);
  }

  get displacementTexture() { return this.displacement.texture; }
  get slopeTexture() { return this.slope.texture; }
  get heightTarget() { return this.displacement; } // .y channel = height
}
