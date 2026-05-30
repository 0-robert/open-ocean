import * as THREE from 'three';
import { config } from '../config.js';
import { skyGLSL } from '../glsl/sky.glsl.js';

/**
 * Ocean surface material. Vertex shader sums the FFT displacement of every
 * cascade (vertex texture fetch); fragment sums the slopes/foam and applies the
 * `fp` lighting ported from docs/reference/FFTWater.shader: roughness-aware
 * fresnel + Cook-Torrance/Beckmann specular + the Atlas subsurface-scattering
 * terms, with foam and fog.
 * @param {import('../env/Sky.js').Sky} sky shares the sky gradient + sun.
 */
export function createOceanMaterial(sky) {
  const nc = config.sim.cascades.length;

  const uniforms = {
    uNormalStrength: { value: config.lighting.normalStrength },
    uDisplacementScale: { value: config.sim.displacementScale },
    uSkyTop: { value: sky.topColor },
    uSkyBottom: { value: sky.bottomColor },
    uSunDirection: { value: sky.sunDirection },
    uSunColor: { value: sky.sunColor },
    uSunIrradiance: { value: new THREE.Color(...config.colors.sunIrradiance) },
    uScatterColor: { value: new THREE.Color(...config.colors.scatter) },
    uBubbleColor: { value: new THREE.Color(...config.colors.bubble) },
    uFoamColor: { value: new THREE.Color(...config.colors.foam) },
    uDeepColor: { value: new THREE.Color(...config.colors.deep) },
    uRoughness: { value: config.lighting.roughness },
    uWavePeakScatterStrength: { value: config.lighting.wavePeakScatterStrength },
    uScatterStrength: { value: config.lighting.scatterStrength },
    uScatterShadowStrength: { value: config.lighting.scatterShadowStrength },
    uEnvironmentLightStrength: { value: config.lighting.environmentLightStrength },
    uBubbleDensity: { value: config.lighting.bubbleDensity },
    uHeightModifier: { value: config.lighting.heightModifier },
    uFogColor: { value: new THREE.Color(...config.colors.fog) },
    uFogNear: { value: config.fog.near },
    uFogFar: { value: config.fog.far },
    uDetailFadeStart: { value: config.fog.near * 0.4 },
    uDetailFadeEnd: { value: config.fog.far },
    uFoamTex: { value: null },
    uFoamAmount: { value: config.foam.amount },
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(
      Math.cos((config.spectrum.windDirection / 180) * Math.PI),
      Math.sin((config.spectrum.windDirection / 180) * Math.PI),
    ) },
  };
  for (let i = 0; i < nc; i++) {
    uniforms[`uDisp${i}`] = { value: null };
    uniforms[`uSlope${i}`] = { value: null };
    uniforms[`uLengthScale${i}`] = { value: config.sim.cascades[i].lengthScale };
  }

  // Generated per-cascade sampling.
  const sampler2Ds = Array.from({ length: nc }, (_, i) =>
    `uniform sampler2D uDisp${i}; uniform sampler2D uSlope${i}; uniform float uLengthScale${i};`).join('\n');
  const sumDisp = Array.from({ length: nc }, (_, i) =>
    `{ vec4 d = texture2D(uDisp${i}, flatPos.xz / uLengthScale${i}); disp += d.xyz; foam += d.a; }`).join('\n');
  const sumSlope = Array.from({ length: nc }, (_, i) =>
    `slope += texture2D(uSlope${i}, vFlatXZ / uLengthScale${i}).xy;`).join('\n');

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      ${Array.from({ length: nc }, (_, i) => `uniform sampler2D uDisp${i}; uniform float uLengthScale${i};`).join('\n')}
      uniform float uDisplacementScale;
      varying vec3 vWorldPos;
      varying vec2 vFlatXZ;
      varying float vFoam;
      varying float vHeight;
      void main() {
        vec3 flatPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vFlatXZ = flatPos.xz;
        vec3 disp = vec3(0.0);
        float foam = 0.0;
        ${sumDisp}
        disp *= uDisplacementScale;
        vec3 wp = flatPos + disp;
        vFoam = foam;
        vHeight = disp.y;
        vWorldPos = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #define PI 3.141592653589793
      ${skyGLSL}
      ${sampler2Ds}
      uniform vec3 uSunIrradiance, uScatterColor, uBubbleColor, uFoamColor, uDeepColor;
      uniform float uNormalStrength;
      uniform float uRoughness, uWavePeakScatterStrength, uScatterStrength;
      uniform float uScatterShadowStrength, uEnvironmentLightStrength, uBubbleDensity, uHeightModifier;
      uniform vec3 uFogColor;
      uniform float uFogNear, uFogFar, uDetailFadeStart, uDetailFadeEnd, uTime, uFoamAmount;
      uniform sampler2D uFoamTex;
      uniform vec2 uWindDir;
      varying vec3 vWorldPos;
      varying vec2 vFlatXZ;
      varying float vFoam;
      varying float vHeight;

      float dotc(vec3 a, vec3 b) { return max(0.0, dot(a, b)); }

      float smithMaskingBeckmann(vec3 H, vec3 S, float roughness) {
        float hdots = max(0.001, dotc(H, S));
        float a = hdots / (roughness * sqrt(1.0 - hdots * hdots));
        float a2 = a * a;
        return a < 1.6 ? (1.0 - 1.259 * a + 0.396 * a2) / (3.535 * a + 2.181 * a2) : 0.0;
      }
      float beckmann(float ndoth, float roughness) {
        float r2 = roughness * roughness;
        float n2 = ndoth * ndoth;
        float exp_arg = (n2 - 1.0) / (r2 * n2);
        return exp(exp_arg) / (PI * r2 * n2 * n2);
      }

      void main() {
        vec2 slope = vec2(0.0);
        ${sumSlope}
        float fftDist = length(cameraPosition - vWorldPos);
        float detailFade = clamp(1.0 - (fftDist - uDetailFadeStart) / (uDetailFadeEnd - uDetailFadeStart), 0.0, 1.0);
        slope *= uNormalStrength * detailFade;
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 lightDir = normalize(uSunDirection);
        vec3 halfwayDir = normalize(lightDir + viewDir);
        float foam = clamp(vFoam, 0.0, 1.0);
        float a = max(0.02, uRoughness + foam * 0.3);

        // Roughness-aware fresnel (ported from FFTWater.shader).
        float eta = 1.33;
        float R0 = ((eta - 1.0) * (eta - 1.0)) / ((eta + 1.0) * (eta + 1.0));
        float fnum = pow(1.0 - dotc(normal, viewDir), 5.0 * exp(-2.69 * a));
        float F = clamp(R0 + (1.0 - R0) * fnum / (1.0 + 22.7 * pow(a, 1.5)), 0.0, 1.0);

        float ndoth = max(0.0001, dot(normal, halfwayDir));
        float viewMask = smithMaskingBeckmann(halfwayDir, viewDir, a);
        float lightMask = smithMaskingBeckmann(halfwayDir, lightDir, a);
        float G = 1.0 / (1.0 + viewMask + lightMask);
        vec3 specular = uSunIrradiance * F * G * beckmann(ndoth, a);
        specular /= 4.0 * max(0.001, dotc(vec3(0.0, 1.0, 0.0), lightDir));
        specular *= dotc(normal, lightDir);

        float NdotL = dotc(normal, lightDir);
        float H = max(0.0, vHeight) * uHeightModifier;
        float k1 = uWavePeakScatterStrength * H * pow(dotc(lightDir, -viewDir), 4.0)
                 * pow(0.5 - 0.5 * dot(lightDir, normal), 3.0);
        float k2 = uScatterStrength * pow(dotc(viewDir, normal), 2.0);
        float k3 = uScatterShadowStrength * NdotL;
        float k4 = uBubbleDensity;
        vec3 scatter = (k1 + k2) * uScatterColor * uSunIrradiance / (1.0 + lightMask);
        scatter += k3 * uScatterColor * uSunIrradiance + k4 * uBubbleColor * uSunIrradiance;
        // Height color gradient: dark navy trough -> turquoise crest (sharpened for contrast).
        float heightT = smoothstep(0.0, 1.0, clamp(vHeight * 0.22 + 0.45, 0.0, 1.0));
        scatter += mix(uDeepColor, uScatterColor, heightT) * uSunIrradiance * 0.42;

        vec3 reflectDir = reflect(-viewDir, normal);
        vec3 envReflection = skyColor(reflectDir) * uEnvironmentLightStrength;

        vec3 output_ = (1.0 - F) * scatter + specular + F * envReflection;
        output_ = max(vec3(0.0), output_);

        // Streaky foam: break the FFT crest-foam with stretched, flow-scrolled
        // noise so it reads as soft streaks (SoT) instead of speckle.
        vec2 fdir = normalize(uWindDir);
        vec2 fperp = vec2(-fdir.y, fdir.x);
        // anisotropic UV: compressed across flow, stretched along it -> streaks
        vec2 fuv = vec2(dot(vFlatXZ, fperp) * 0.06, dot(vFlatXZ, fdir) * 0.012);
        float n1 = texture2D(uFoamTex, fuv + fdir * uTime * 0.03).r;
        float n2 = texture2D(uFoamTex, fuv * 1.9 - fdir * uTime * 0.05).g;
        float foamNoise = n1 * 0.6 + n2 * 0.4;
        float foamMask = smoothstep(0.25, 0.8, foam * uFoamAmount * (0.4 + 1.2 * foamNoise));
        output_ = mix(output_, uFoamColor, clamp(foamMask, 0.0, 1.0) * detailFade);

        float fog = smoothstep(uFogNear, uFogFar, length(cameraPosition - vWorldPos));
        gl_FragColor = vec4(mix(output_, uFogColor, fog), 1.0);
      }`,
  });
}
