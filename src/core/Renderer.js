import * as THREE from 'three';

/** Creates the WebGL2 renderer and verifies float color-buffer support. */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) {
    throw new Error('WebGL2 is required for the FFT ocean simulation.');
  }
  // The FFT pipeline renders to RGBA16F targets. EXT_color_buffer_float makes
  // 16F/32F renderable; some older mobile GPUs only expose the half-float variant,
  // which is enough for us. Require at least one.
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
    throw new Error('A floating-point colour buffer (EXT_color_buffer_float or _half_float) is required.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/** Wires resize handling for a renderer + perspective camera. */
export function handleResize(renderer, camera) {
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
}
