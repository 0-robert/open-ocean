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
    dir = normalize(dir);
    vec3 sd = normalize(uSunDirection);
    float up = clamp(dir.y, 0.0, 1.0);

    // Zenith -> horizon gradient with a warm haze band near the horizon.
    vec3 col = mix(uSkyBottom, uSkyTop, pow(up, 0.45));
    float haze = pow(1.0 - up, 6.0);
    col = mix(col, uSkyBottom * 1.15 + vec3(0.06, 0.05, 0.03), haze * 0.6);

    // Sun: tight disc + broad warm glow halo, brighter toward the horizon.
    float sd_dot = max(0.0, dot(dir, sd));
    float disc = smoothstep(0.9995, 0.99985, sd_dot);
    float glow = pow(sd_dot, 350.0) * 0.5 + pow(sd_dot, 12.0) * 0.18;
    col += uSunColor * (disc * 6.0 + glow);
    return col;
  }
`;
