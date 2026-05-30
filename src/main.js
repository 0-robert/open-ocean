import * as THREE from 'three';
import { config } from './config.js';
import { createRenderer, handleResize } from './core/Renderer.js';
import { OrbitFollowControls } from './camera/OrbitFollowControls.js';
import { Sky } from './env/Sky.js';
import { OceanSim } from './wave/OceanSim.js';
import { OceanMesh } from './ocean/OceanMesh.js';
import { createOceanMaterial } from './ocean/oceanMaterial.js';
import { OceanSampler } from './wave/OceanSampler.js';
import { Buoy } from './objects/Buoy.js';

const canvas = document.getElementById('app');
const renderer = createRenderer(canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 6000);
handleResize(renderer, camera);

const sky = new Sky(scene);
const controls = new OrbitFollowControls(camera, canvas);

// Lighting for lit meshes (the buoy); the ocean is lit analytically in its shader.
const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
sun.position.copy(sky.sunDirection).multiplyScalar(100);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x10394a, 0.6));

const sim = new OceanSim(renderer);
const oceanMat = createOceanMaterial(sky);
const ocean = new OceanMesh(oceanMat);
scene.add(ocean.mesh);

const sampler = new OceanSampler(renderer, sim);
const buoy = new Buoy(scene);

// Exposed for live tuning + headless verification.
window.__ocean = { THREE, scene, camera, controls, sim, oceanMat, config, sky };

let prev = performance.now();
let t = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  t += dt * config.sim.speed;

  sim.update(t);
  const dispTex = sim.displacementTextures;
  const slopeTex = sim.slopeTextures;
  for (let i = 0; i < dispTex.length; i++) {
    oceanMat.uniforms[`uDisp${i}`].value = dispTex[i];
    oceanMat.uniforms[`uSlope${i}`].value = slopeTex[i];
  }

  sampler.refresh();
  const surfaceY = buoy.update(controls.focal.x, controls.focal.z, sampler);

  controls.update(dt, surfaceY);
  ocean.recenter(controls.focal);

  renderer.render(scene, camera);
});
