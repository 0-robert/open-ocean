import { config } from '../config.js';

/**
 * Patches a three.js Water material (via onBeforeCompile) so its surface is
 * displaced by our FFT simulation: the vertex shader raises/chops each vertex by
 * the summed cascade displacement textures, and the fragment shader builds the
 * surface normal from the summed cascade slope textures (so the waves catch
 * light + reflections). Three.js Water keeps doing the reflections/sun/sky.
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
    `uniform sampler2D uSlope${i}; uniform float uLengthScale${i};`).join('\n');
  const dispSum = Array.from({ length: nc }, (_, i) =>
    `fftDisp += texture2D( uDisp${i}, fftWorld.xz / uLengthScale${i} ).xyz;`).join('\n');
  const slopeSum = Array.from({ length: nc }, (_, i) =>
    `fftSlope += texture2D( uSlope${i}, vFftXZ / uLengthScale${i} ).xy;`).join('\n');

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

    // --- Fragment: build the surface normal from summed cascade slopes ---
    shader.fragmentShader =
      `uniform float uNormalStrength;\n${slopeUniformDecls}\nvarying vec2 vFftXZ;\n` +
      shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      `vec2 fftSlope = vec2( 0.0 );
       ${slopeSum}
       fftSlope *= uNormalStrength;
       vec3 fftNormal = normalize( vec3( -fftSlope.x, 1.0, -fftSlope.y ) );
       vec3 surfaceNormal = normalize( fftNormal + noise.xzy * vec3( 1.0, 0.0, 1.0 ) * 0.35 );`,
    );
  };

  material.needsUpdate = true;
  return fft;
}
