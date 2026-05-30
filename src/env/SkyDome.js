import * as THREE from 'three';
import { skyGLSL } from '../glsl/sky.glsl.js';

/**
 * Stylized SoT-ish sky: a big inward sphere with a blue gradient (deep zenith ->
 * light horizon, never white) + a bright sun + slow procedural fbm clouds.
 * Shares skyColor() (and uSky* uniforms) with the ocean's reflection so they match.
 *
 * @param {{topColor:THREE.Color, bottomColor:THREE.Color, sunDirection:THREE.Vector3, sunColor:THREE.Color}} skyAdapter
 */
export function createSkyDome(skyAdapter, { cloudAmount = 0.7 } = {}) {
  const uniforms = {
    uSkyTop: { value: skyAdapter.topColor },
    uSkyBottom: { value: skyAdapter.bottomColor },
    uSunDirection: { value: skyAdapter.sunDirection },
    uSunColor: { value: skyAdapter.sunColor },
    uTime: { value: 0 },
    uCloudAmount: { value: cloudAmount },
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${skyGLSL}
      uniform float uTime, uCloudAmount;
      varying vec3 vDir;

      float hash21(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
        return s;
      }

      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyColor(dir);

        // Procedural clouds projected onto a sky plane, fading out near the horizon.
        float up = max(dir.y, 0.0001);
        vec2 cuv = (dir.xz / up) * 0.55 + vec2(uTime * 0.004, uTime * 0.002);
        float c = fbm(cuv);
        c = smoothstep(0.55, 1.0, c);
        float horizonFade = smoothstep(0.02, 0.28, dir.y);
        float cloud = c * horizonFade * uCloudAmount;
        vec3 sunTint = uSunColor * pow(max(0.0, dot(dir, normalize(uSunDirection))), 4.0);
        vec3 cloudCol = mix(vec3(0.82, 0.86, 0.93), vec3(1.0), c) + sunTint * 0.4;
        col = mix(col, cloudCol, cloud);

        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), material);
  mesh.frustumCulled = false;
  return { mesh, material, uniforms };
}
