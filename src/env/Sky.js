import * as THREE from 'three';
import { config } from '../config.js';
import { skyGLSL } from '../glsl/sky.glsl.js';

export class Sky {
  constructor(scene) {
    this.sunDirection = new THREE.Vector3(...config.colors.sunDirection).normalize();
    this.sunColor = new THREE.Color(1.0, 0.9, 0.7);
    this.topColor = new THREE.Color(0x3a7bd5);
    this.bottomColor = new THREE.Color(...config.colors.fog);

    const geo = new THREE.SphereGeometry(4000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSkyTop: { value: this.topColor },
        uSkyBottom: { value: this.bottomColor },
        uSunDirection: { value: this.sunDirection },
        uSunColor: { value: this.sunColor },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${skyGLSL}
        varying vec3 vDir;
        void main() { gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    scene.fog = new THREE.Fog(new THREE.Color(...config.colors.fog), config.fog.near, config.fog.far);
  }
}
