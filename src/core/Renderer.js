import * as THREE from 'three';

/** Creates the WebGL2 renderer and verifies float color-buffer support. */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) {
    throw new Error('WebGL2 is required for the FFT ocean simulation.');
  }
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('EXT_color_buffer_float is required (float render targets).');
  }
  gl.getExtension('OES_texture_float_linear'); // optional: linear filtering of float textures
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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
