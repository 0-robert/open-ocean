import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Retro pixelation post-pass. Snaps each output pixel to a coarse cell grid by
 * flooring the UV to a multiple of (pixelSize / resolution) and sampling the cell
 * centre, so the whole frame reads as chunky blocks.
 *
 * @param {number} pixelSize screen pixels per block.
 * @returns {ShaderPass}
 */
export function createPixelatePass(pixelSize = 6) {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uPixelSize: { value: pixelSize },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uPixelSize;
      varying vec2 vUv;
      void main() {
        vec2 cell = max(uPixelSize, 1.0) / uResolution;
        vec2 uv = cell * (floor(vUv / cell) + 0.5); // sample each block's centre
        gl_FragColor = texture2D(tDiffuse, uv);
      }
    `,
  });
}
