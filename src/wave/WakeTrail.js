import * as THREE from 'three';
import { FullscreenPass } from '../core/fullscreenPass.js';

const WAKE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uPrevCenter, uNewCenter, uInjectPos;
  uniform float uSize, uWorldSize, uInjectRadius, uStrength, uDecay;
  out vec4 outColor;
  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    // World position of this texel in the NEW (recentered) region.
    vec2 worldPos = uNewCenter + (uv - 0.5) * uWorldSize;
    // Sample the previous trail at that world position (reproject so the trail
    // stays world-locked as the region follows the boat).
    vec2 prevUv = (worldPos - uPrevCenter) / uWorldSize + 0.5;
    float prev = 0.0;
    if (prevUv.x > 0.0 && prevUv.x < 1.0 && prevUv.y > 0.0 && prevUv.y < 1.0) {
      prev = texture(uPrev, prevUv).r * uDecay;
    }
    // Inject foam at the stern (world space) — no wind advection, so the trail
    // records the boat's actual path (N, then S, then E, ...).
    float d = length(worldPos - uInjectPos);
    float inj = uStrength * smoothstep(uInjectRadius, 0.0, d);
    outColor = vec4(clamp(max(prev, inj), 0.0, 1.0), 0.0, 0.0, 1.0);
  }
`;

/**
 * World-space, non-tiling foam trail that follows the boat. The region recenters
 * on the boat each frame and reprojects the previous trail so foam stays put in
 * the world (directional memory). The water shader samples it by world position.
 */
export class WakeTrail {
  constructor(renderer, { size = 512, worldSize = 350, decay = 0.992 } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.worldSize = worldSize;
    this.decay = decay;
    const opts = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(size, size, opts);
    this.rtB = new THREE.WebGLRenderTarget(size, size, opts);
    this.cur = 0;
    this.center = new THREE.Vector2(0, 0);
    this.uniforms = {
      uPrev: { value: null }, uPrevCenter: { value: new THREE.Vector2() },
      uNewCenter: { value: new THREE.Vector2() }, uInjectPos: { value: new THREE.Vector2() },
      uSize: { value: size }, uWorldSize: { value: worldSize },
      uInjectRadius: { value: 5 }, uStrength: { value: 0 }, uDecay: { value: decay },
    };
    this.pass = new FullscreenPass(WAKE_FRAG, this.uniforms);
    this.texture = this.rtA.texture;
  }

  /** @param sternX,sternZ world inject point; strength 0..1; radius world units */
  update(boatX, boatZ, sternX, sternZ, strength, radius) {
    const prev = this.cur === 0 ? this.rtA : this.rtB;
    const next = this.cur === 0 ? this.rtB : this.rtA;
    const u = this.uniforms;
    u.uPrev.value = prev.texture;
    u.uPrevCenter.value.copy(this.center);
    u.uNewCenter.value.set(boatX, boatZ); // region follows the boat
    u.uInjectPos.value.set(sternX, sternZ);
    u.uStrength.value = strength;
    u.uInjectRadius.value = radius;
    u.uDecay.value = this.decay;
    this.pass.render(this.renderer, next);
    this.center.set(boatX, boatZ);
    this.cur ^= 1;
    this.texture = next.texture;
  }
}
