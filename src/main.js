import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { config } from './config.js';
import { createRenderer, handleResize } from './core/Renderer.js';
import { OrbitFollowControls } from './camera/OrbitFollowControls.js';
import { OceanSim } from './wave/OceanSim.js';
import { OceanSampler } from './wave/OceanSampler.js';
import { installFFTWaves } from './ocean/installFFTWaves.js';
import { Buoy } from './objects/Buoy.js';

const canvas = document.getElementById('app');
const renderer = createRenderer(canvas);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
handleResize(renderer, camera);

const controls = new OrbitFollowControls(camera, canvas);
const sun = new THREE.Vector3();

// --- FFT ocean simulation (our engine) ---
const sim = new OceanSim(renderer);
const sampler = new OceanSampler(renderer, sim);

// --- three.js Water (reflections + sun glitter), displaced by the FFT sim ---
const waterNormals = new THREE.TextureLoader().load('textures/waternormals.jpg', (t) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
});
const water = new Water(new THREE.PlaneGeometry(800, 800, 1536, 1536), {
  textureWidth: 512,
  textureHeight: 512,
  waterNormals,
  sunDirection: new THREE.Vector3(),
  sunColor: 0xffffff,
  waterColor: 0x0e5a6b,
  distortionScale: 3.7,
  fog: false,
});
water.rotation.x = -Math.PI / 2;
scene.add(water);
const fft = installFFTWaves(water.material, sim);

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
const envScene = new THREE.Scene();
function setSun(elevationDeg, azimuthDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  sun.setFromSphericalCoords(1, phi, theta);
  skyU['sunPosition'].value.copy(sun);
  water.material.uniforms['sunDirection'].value.copy(sun).normalize();
  envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.add(sky);
}
setSun(12, 150);

const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.5);
keyLight.position.copy(sun).multiplyScalar(100);
scene.add(keyLight);

const buoy = new Buoy(scene);

let prev = performance.now();
let t = 0;
window.__ocean = { THREE, scene, camera, controls, water, sky, sim, config, setSun };

// --- Debug: ?debug=disp|slope|height renders a raw FFT cascade-0 texture fullscreen ---
const debugMode = new URLSearchParams(location.search).get('debug');
let dbg = null;
if (debugMode) {
  const dbgScene = new THREE.Scene();
  const dbgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const dbgMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, mode: { value: debugMode === 'slope' ? 1 : debugMode === 'height' ? 2 : 0 } },
    vertexShader: 'varying vec2 vu; void main(){ vu = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tex; uniform int mode; varying vec2 vu;
      void main(){
        vec4 t = texture2D(tex, vu);
        if (mode == 2) gl_FragColor = vec4(vec3(t.y * 0.5 + 0.5), 1.0);       // height field
        else if (mode == 1) gl_FragColor = vec4(t.xy * 0.5 + 0.5, 0.5, 1.0);  // slopes
        else gl_FragColor = vec4(t.xyz * 0.4 + 0.5, 1.0);                      // displacement xyz
      }`,
  });
  dbgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dbgMat));
  dbg = { dbgScene, dbgCam, dbgMat };
}

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  t += dt * config.sim.speed;

  // Run the FFT simulation and feed its maps into the Water shader.
  sim.update(t);
  const disp = sim.displacementTextures;
  const slope = sim.slopeTextures;
  for (let i = 0; i < disp.length; i++) {
    fft[`uDisp${i}`].value = disp[i];
    fft[`uSlope${i}`].value = slope[i];
  }
  water.material.uniforms['time'].value += dt;

  // Keep the water patch centered on the camera focal point (waves are sampled
  // in world space, so they stay put while the plane follows).
  water.position.x = controls.focal.x;
  water.position.z = controls.focal.z;

  // Real buoyancy: read the FFT height field and ride the buoy on it.
  sampler.refresh();
  const surfaceY = buoy.update(controls.focal.x, controls.focal.z, sampler);

  controls.update(dt, surfaceY);

  if (dbg) {
    dbg.dbgMat.uniforms.tex.value = (debugMode === 'slope' ? sim.slopeTextures : sim.displacementTextures)[0];
    renderer.setRenderTarget(null);
    renderer.render(dbg.dbgScene, dbg.dbgCam);
    return;
  }
  renderer.render(scene, camera);
});
