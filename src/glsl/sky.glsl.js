/**
 * Shared sky gradient, so the sky dome and the ocean's reflection sample the
 * exact same environment. `dir` should be a normalized direction.
 */
export const skyGLSL = /* glsl */`
  uniform vec3 uSkyTop;
  uniform vec3 uSkyBottom;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;

  vec3 skyColor(vec3 dir) {
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uSkyBottom, uSkyTop, pow(h, 0.6));
    float sun = pow(max(0.0, dot(normalize(dir), normalize(uSunDirection))), 2000.0);
    col += uSunColor * sun;
    return col;
  }
`;
