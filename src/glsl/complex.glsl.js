export const complexGLSL = /* glsl */`
  #define PI 3.141592653589793
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  vec2 euler(float x) { return vec2(cos(x), sin(x)); }
`;
