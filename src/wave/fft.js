import * as THREE from 'three';
import { complexGLSL } from '../glsl/complex.glsl.js';
import { FullscreenPass, makeFloatTarget } from '../core/fullscreenPass.js';
import { buildButterfly } from './butterfly.js';

const FFT_FRAG = /* glsl */`
  precision highp float;
  ${complexGLSL}
  uniform sampler2D uButterfly;   // (N wide x log2N tall): (twRe, twIm, idxA, idxB)
  uniform sampler2D uSource;
  uniform float uN;
  uniform float uStage;
  uniform bool uHorizontal;
  uniform bool uNormalize;        // divide by N on the final pass of each axis
  out vec4 outColor;
  void main() {
    vec2 px = gl_FragCoord.xy - 0.5;             // integer pixel coords
    float idx = uHorizontal ? px.x : px.y;
    vec4 bf = texelFetch(uButterfly, ivec2(int(idx), int(uStage)), 0);
    vec2 tw = bf.xy;
    int a = int(bf.z);
    int b = int(bf.w);
    ivec2 pa = uHorizontal ? ivec2(a, int(px.y)) : ivec2(int(px.x), a);
    ivec2 pb = uHorizontal ? ivec2(b, int(px.y)) : ivec2(int(px.x), b);
    vec4 va = texelFetch(uSource, pa, 0);
    vec4 vb = texelFetch(uSource, pb, 0);
    vec2 r1 = va.xy + cmul(tw, vb.xy);
    vec2 r2 = va.zw + cmul(tw, vb.zw);
    vec4 res = vec4(r1, r2);
    if (uNormalize) res /= uN;
    outColor = res;
  }
`;

/** GPU inverse FFT over RGBA16F targets (two independent complex channels: .xy and .zw). */
export class FFT {
  constructor(renderer, N) {
    this.renderer = renderer;
    this.N = N;
    this.stages = Math.log2(N);
    const bf = buildButterfly(N);
    // Data is packed (stage*N + idx): a texture N wide x stages tall, fetched at
    // texel (idx, stage). (bf.width=stages, bf.height=N -> texture dims N, stages.)
    this.butterfly = new THREE.DataTexture(bf.data, bf.height, bf.width, THREE.RGBAFormat, THREE.FloatType);
    this.butterfly.needsUpdate = true;
    this.uniforms = {
      uButterfly: { value: this.butterfly },
      uSource: { value: null },
      uN: { value: N },
      uStage: { value: 0 },
      uHorizontal: { value: true },
      uNormalize: { value: false },
    };
    this.pass = new FullscreenPass(FFT_FRAG, this.uniforms);
    this.pingA = makeFloatTarget(N);
    this.pingB = makeFloatTarget(N);
  }

  /** Runs IFFT on `inputTarget`'s texture; returns the ping target holding the result. */
  run(inputTarget) {
    const lastStage = this.stages - 1;
    let read;

    // First horizontal pass reads the external input, writes into pingA.
    // NOTE: the Tessendorf ocean uses an UNNORMALIZED inverse sum — the spectrum
    // amplitude already carries the physical scale, so we never divide by N.
    this.uniforms.uSource.value = inputTarget.texture;
    this.uniforms.uHorizontal.value = true;
    this.uniforms.uStage.value = 0;
    this.uniforms.uNormalize.value = false;
    this.pass.render(this.renderer, this.pingA);
    read = this.pingA;

    const step = (horizontal, stage) => {
      this.uniforms.uSource.value = read.texture;
      this.uniforms.uHorizontal.value = horizontal;
      this.uniforms.uStage.value = stage;
      this.uniforms.uNormalize.value = false;
      const write = read === this.pingA ? this.pingB : this.pingA;
      this.pass.render(this.renderer, write);
      read = write;
    };

    for (let s = 1; s < this.stages; s++) step(true, s);
    for (let s = 0; s < this.stages; s++) step(false, s);
    return read;
  }
}
