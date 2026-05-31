import * as THREE from 'three';
import { LinearFilter } from 'three';
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

// Foam accumulation: persist + advect + decay so foam trails crests as streaks.
const FOAM_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uInject;   // displacement target; .a = instantaneous Jacobian foam
  uniform sampler2D uPrev;     // previous accumulated foam (.r)
  uniform float uN, uDecay, uInjectRate;
  uniform vec2 uFlow;          // uv advection per frame
  out vec4 outColor;
  void main() {
    ivec2 id = ivec2(gl_FragCoord.xy);
    vec2 uv = (vec2(id) + 0.5) / uN;
    float prev = texture(uPrev, uv - uFlow).r;
    float inject = texelFetch(uInject, id, 0).a * uInjectRate;
    float foam = max(prev * uDecay, inject);
    outColor = vec4(clamp(foam, 0.0, 1.0), 0.0, 0.0, 1.0);
  }
`;

export class OceanSim {
  constructor(renderer) {
    const N = config.sim.N;
    const sim = config.sim;
    this.renderer = renderer;
    this.N = N;

    const p0 = buildSpectrumParams(config.spectrum, sim.gravity);
    const p1 = { ...p0, scale: 0 }; // single JONSWAP spectrum per cascade for now

    // One cascade per frequency band: each has its own initial spectrum + output maps.
    this.cascades = sim.cascades.map((c) => {
      const spectrum = new SpectrumPass(renderer, N);
      spectrum.build(p0, p1, {
        lengthScale: c.lengthScale, lowCutoff: c.lowCutoff, highCutoff: c.highCutoff,
        gravity: sim.gravity, depth: sim.depth, seed: sim.seed,
      });
      return {
        lengthScale: c.lengthScale,
        lowCutoff: c.lowCutoff,
        highCutoff: c.highCutoff,
        spectrum,                                                // kept for live rebuild
        h0: spectrum.h0,
        displacement: makeFloatTarget(N, 1, THREE.LinearFilter), // xyz + foam (RGBA)
        slope: makeFloatTarget(N, 1, THREE.LinearFilter),        // normal slopes (RG)
        foamPing: makeFloatTarget(N, 1, THREE.LinearFilter),     // accumulated foam (ping-pong)
        foamPong: makeFloatTarget(N, 1, THREE.LinearFilter),
        foamCurr: 0,
        foamTexture: null,
      };
    });
    // Cascades that contribute foam (skip the finest -> avoids speckle).
    this.foamCount = Math.max(1, this.cascades.length - 1);

    // Shared scratch + engines reused across cascades (run sequentially).
    this.fftDisp = new FFT(renderer, N);
    this.fftSlope = new FFT(renderer, N);
    this.dispSpectrum = makeFloatTarget(N);
    this.slopeSpectrum = makeFloatTarget(N);

    this.evolveUniforms = {
      uH0: { value: null },
      uN: { value: N }, uLengthScale: { value: 0 },
      uGravity: { value: sim.gravity }, uRepeatTime: { value: sim.repeatTime },
      uTime: { value: 0 }, uMode: { value: 0 },
    };
    this.evolvePass = new FullscreenPass(EVOLVE_FRAG, this.evolveUniforms);

    this.assembleUniforms = {
      uDisp: { value: null }, uSlope: { value: null },
      uLambda: { value: new THREE.Vector2(...sim.lambda) },
      uFoamBias: { value: config.foam.bias }, uFoamThreshold: { value: config.foam.threshold },
      uFoamAdd: { value: config.foam.add }, uMode: { value: 0 },
    };
    this.assemblePass = new FullscreenPass(ASSEMBLE_FRAG, this.assembleUniforms);

    const windRad = (config.spectrum.windDirection / 180) * Math.PI;
    this.foamUniforms = {
      uInject: { value: null }, uPrev: { value: null }, uN: { value: N },
      uDecay: { value: config.foam.decay }, uInjectRate: { value: config.foam.injectRate },
      uFlow: { value: new THREE.Vector2(Math.cos(windRad), Math.sin(windRad)).multiplyScalar(config.foam.flow) },
    };
    this.foamPass = new FullscreenPass(FOAM_FRAG, this.foamUniforms);
  }

  /** @param time seconds (already scaled by sim speed) */
  update(time) {
    const eu = this.evolveUniforms;
    const au = this.assembleUniforms;
    eu.uTime.value = time;

    for (const cascade of this.cascades) {
      eu.uH0.value = cascade.h0.texture;
      eu.uLengthScale.value = cascade.lengthScale;
      eu.uMode.value = 0;
      this.evolvePass.render(this.renderer, this.dispSpectrum);
      eu.uMode.value = 1;
      this.evolvePass.render(this.renderer, this.slopeSpectrum);

      const dispSpatial = this.fftDisp.run(this.dispSpectrum);
      const slopeSpatial = this.fftSlope.run(this.slopeSpectrum);

      au.uDisp.value = dispSpatial.texture;
      au.uSlope.value = slopeSpatial.texture;
      au.uMode.value = 0;
      this.assemblePass.render(this.renderer, cascade.displacement);
      au.uMode.value = 1;
      this.assemblePass.render(this.renderer, cascade.slope);
    }

    // Foam accumulation (ping-pong) for the foam-contributing cascades.
    const fu = this.foamUniforms;
    for (let i = 0; i < this.foamCount; i++) {
      const cascade = this.cascades[i];
      const prev = cascade.foamCurr === 0 ? cascade.foamPing : cascade.foamPong;
      const next = cascade.foamCurr === 0 ? cascade.foamPong : cascade.foamPing;
      fu.uInject.value = cascade.displacement.texture;
      fu.uPrev.value = prev.texture;
      this.foamPass.render(this.renderer, next);
      cascade.foamCurr ^= 1;
      cascade.foamTexture = next.texture;
    }
  }

  get displacementTextures() { return this.cascades.map((c) => c.displacement.texture); }
  get slopeTextures() { return this.cascades.map((c) => c.slope.texture); }
  /** Recompute the initial spectra (call after changing wind speed / spectrum). */
  rebuildSpectrum() {
    const sim = config.sim;
    const p0 = buildSpectrumParams(config.spectrum, sim.gravity);
    const p1 = { ...p0, scale: 0 };
    for (const c of this.cascades) {
      c.spectrum.build(p0, p1, {
        lengthScale: c.lengthScale, lowCutoff: c.lowCutoff, highCutoff: c.highCutoff,
        gravity: sim.gravity, depth: sim.depth, seed: sim.seed,
      });
    }
  }

  get foamTextures() { return this.cascades.slice(0, this.foamCount).map((c) => c.foamTexture); }
  get lengthScales() { return this.cascades.map((c) => c.lengthScale); }
  get heightTarget() { return this.cascades[0].displacement; } // dominant swell, for buoy readback
}
