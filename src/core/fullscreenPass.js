import * as THREE from 'three';

/** Wraps a fragment shader as a fullscreen pass writing to render targets. */
export class FullscreenPass {
  constructor(fragmentShader, uniforms) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  render(renderer, target) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }
}

/**
 * Half-float (RGBA16F) render target sized N x N, repeat-wrapped.
 * FFT ping-pong targets use NearestFilter (they read via exact texelFetch);
 * the final sampled maps (displacement/slope) use LinearFilter so the surface
 * interpolates smoothly instead of showing per-texel facets.
 *
 * HalfFloatType (not FloatType) is deliberate: RGBA16F is colour-renderable AND
 * texture-filterable in core WebGL2, whereas RGBA32F linear filtering needs
 * OES_texture_float_linear - which most mobile GPUs lack, making 32F maps sample
 * as zero (flat ocean) on phones. 16F has ample precision for the wave field.
 */
export function makeFloatTarget(N, count = 1, filter = THREE.NearestFilter) {
  return new THREE.WebGLRenderTarget(N, N, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    count,
  });
}
