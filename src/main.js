import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createRenderer, handleResize } from './core/Renderer.js';
import { OrbitFollowControls } from './camera/OrbitFollowControls.js';
import { Buoy } from './objects/Buoy.js';

const canvas = document.getElementById('app');
const renderer = createRenderer(canvas);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
handleResize(renderer, camera);

const controls = new OrbitFollowControls(camera, canvas);

// --- Sun direction (shared by sky + water) ---
const sun = new THREE.Vector3();

// --- Water (three.js official ocean): planar reflections + sun glitter ---
const waterNormals = new THREE.TextureLoader().load('textures/waternormals.jpg', (t) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
});
const water = new Water(new THREE.PlaneGeometry(20000, 20000), {
  textureWidth: 512,
  textureHeight: 512,
  waterNormals,
  sunDirection: new THREE.Vector3(),
  sunColor: 0xffffff,
  waterColor: 0x0a3a4a,     // teal, toward the Sea of Thieves palette
  distortionScale: 3.7,
  fog: false,
});
water.rotation.x = -Math.PI / 2;
scene.add(water);

// --- Sky (three.js atmospheric scattering) ---
const sky = new Sky();
sky.scale.setScalar(20000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU['turbidity'].value = 10;
skyU['rayleigh'].value = 2;
skyU['mieCoefficient'].value = 0.005;
skyU['mieDirectionalG'].value = 0.8;

const pmrem = new THREE.PMREMGenerator(renderer);
const sceneEnv = new THREE.Scene();

function setSun(elevationDeg, azimuthDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  sun.setFromSphericalCoords(1, phi, theta);
  skyU['sunPosition'].value.copy(sun);
  water.material.uniforms['sunDirection'].value.copy(sun).normalize();
  sceneEnv.add(sky);
  scene.environment = pmrem.fromScene(sceneEnv).texture;
  scene.add(sky);
}
setSun(12, 150);

// Light for the buoy (env handles ambient; this adds a key light).
const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.5);
keyLight.position.copy(sun).multiplyScalar(100);
scene.add(keyLight);

const buoy = new Buoy(scene);

let prev = performance.now();
window.__ocean = { THREE, scene, camera, controls, water, sky, setSun };

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  water.material.uniforms['time'].value += dt;

  // The three.js Water plane is essentially flat (normal-map ripples), so the
  // buoy uses a gentle procedural bob/tilt to feel alive.
  const f = controls.focal;
  const t = water.material.uniforms['time'].value;
  const surfaceY = Math.sin(t * 0.8 + f.x * 0.05) * 0.6 + Math.cos(t * 0.6 + f.z * 0.04) * 0.6;
  buoy.mesh.position.set(f.x, surfaceY, f.z);
  buoy.mesh.rotation.z = Math.sin(t * 0.7) * 0.06;
  buoy.mesh.rotation.x = Math.cos(t * 0.5) * 0.06;

  controls.update(dt, surfaceY);
  renderer.render(scene, camera);
});
