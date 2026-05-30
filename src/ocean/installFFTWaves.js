import * as THREE from 'three';
import { config } from '../config.js';

/**
 * Patches a three.js Water material (via onBeforeCompile) so its surface is
 * driven by our FFT simulation:
 *  - vertex: displaces each vertex by the summed cascade displacement textures
 *  - fragment: builds the surface normal from the summed cascade slopes (faded
 *    out with distance to kill shimmer), and blends white foam from the FFT
 *    Jacobian (the displacement .a channel) for Sea-of-Thieves whitecaps.
 * Three.js Water keeps doing the reflections / sun / sky.
 *
 * @param {THREE.ShaderMaterial} material  water.material
 * @param {import('../wave/OceanSim.js').OceanSim} sim
 * @returns {object} the fft uniforms (assign .value each frame from sim)
 */
export function installFFTWaves(material, sim) {
  const nc = sim.cascades.length;

  const fft = {
    uDisplacementScale: { value: config.sim.displacementScale },
    uNormalStrength: { value: config.lighting.normalStrength },
    uFoamColor: { value: new THREE.Color(...config.colors.foam) },
    uFoamAmount: { value: config.foam.amount },
    uDetailFadeStart: { value: config.fog.near * 0.4 },
    uDetailFadeEnd: { value: config.fog.far },
  };
  for (let i = 0; i < nc; i++) {
    fft[`uDisp${i}`] = { value: null };
    fft[`uSlope${i}`] = { value: null };
    fft[`uLengthScale${i}`] = { value: sim.cascades[i].lengthScale };
  }
  material.userData.fft = fft;

  const dispUniformDecls = Array.from({ length: nc }, (_, i) =>
    `uniform sampler2D uDisp${i}; uniform float uLengthScale${i};`).join('\n');
  const slopeUniformDecls = Array.from({ length: nc }, (_, i) =>
    `uniform sampler2D uSlope${i}; uniform sampler2D uDisp${i}; uniform float uLengthScale${i};`).join('\n');
  const dispSum = Array.from({ length: nc }, (_, i) =>
    `fftDisp += texture2D( uDisp${i}, fftWorld.xz / uLengthScale${i} ).xyz;`).join('\n');
  const slopeSum = Array.from({ length: nc }, (_, i) =>
    `fftSlope += texture2D( uSlope${i}, vFftXZ / uLengthScale${i} ).xy;`).join('\n');
  const foamSum = Array.from({ length: nc }, (_, i) =>
    `fftFoam += texture2D( uDisp${i}, vFftXZ / uLengthScale${i} ).a;`).join('\n');

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fft);

    // --- Vertex: displace by summed cascade displacement ---
    shader.vertexShader =
      `uniform float uDisplacementScale;\n${dispUniformDecls}\nvarying vec2 vFftXZ;\n` +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      'mirrorCoord = modelMatrix * vec4( position, 1.0 );',
      `vec3 fftWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
       vFftXZ = fftWorld.xz;
       vec3 fftDisp = vec3( 0.0 );
       ${dispSum}
       fftWorld += fftDisp * uDisplacementScale;
       vec3 fftWorldPos = fftWorld;
       mirrorCoord = vec4( fftWorld, 1.0 );`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      'vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );',
      'vec4 mvPosition = viewMatrix * vec4( fftWorldPos, 1.0 );',
    );

    // --- Fragment: FFT normals (distance-faded) + Jacobian foam ---
    shader.fragmentShader =
      `uniform float uNormalStrength, uFoamAmount, uDetailFadeStart, uDetailFadeEnd;\n` +
      `uniform vec3 uFoamColor;\n${slopeUniformDecls}\nvarying vec2 vFftXZ;\n` +
      shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      `float fftDist = length( eye - worldPosition.xyz );
       float detailFade = clamp( 1.0 - ( fftDist - uDetailFadeStart ) / ( uDetailFadeEnd - uDetailFadeStart ), 0.0, 1.0 );
       vec2 fftSlope = vec2( 0.0 );
       ${slopeSum}
       fftSlope *= uNormalStrength * detailFade;
       vec3 fftNormal = normalize( vec3( -fftSlope.x, 1.0, -fftSlope.y ) );
       vec3 surfaceNormal = normalize( fftNormal + noise.xzy * vec3( 1.0, 0.0, 1.0 ) * 0.35 * detailFade );`,
    );

    // Blend foam into the final color.
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 outgoingLight = albedo;',
      `float fftFoam = 0.0;
       ${foamSum}
       fftFoam = clamp( fftFoam * uFoamAmount, 0.0, 1.0 );
       vec3 outgoingLight = mix( albedo, uFoamColor, fftFoam );`,
    );
  };

  material.needsUpdate = true;
  return fft;
}
