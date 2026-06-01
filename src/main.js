import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { config } from './config.js';
import { createRenderer, handleResize } from './core/Renderer.js';
import { OrbitFollowControls } from './camera/OrbitFollowControls.js';
import { OceanSim } from './wave/OceanSim.js';
import { OceanSampler } from './wave/OceanSampler.js';
import { WakeTrail } from './wave/WakeTrail.js';
import { createOceanMaterial } from './ocean/oceanMaterial.js';
import { Boat } from './objects/Boat.js';
import { createTuningPanel } from './ui/TuningPanel.js';
import { createTouchControls } from './ui/TouchControls.js';
import { createPixelatePass } from './post/pixelate.js';

const canvas = document.getElementById('app');
const renderer = createRenderer(canvas);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
handleResize(renderer, camera);

const controls = new OrbitFollowControls(camera, canvas);
createTouchControls(controls.keys); // on-screen WASD for touch devices (no-op on desktop)
const sun = new THREE.Vector3();

// --- FFT ocean simulation ---
const sim = new OceanSim(renderer);
const sampler = new OceanSampler(renderer, sim);
const wakeTrail = new WakeTrail(renderer, { worldSize: 350, decay: config.foam.wakeDecay });
const boat = new Boat(scene);

// --- Sky (three.js atmospheric scattering) for background + buoy env ---
const sky = new Sky();
sky.scale.setScalar(20000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU['turbidity'].value = 0.8;
skyU['rayleigh'].value = 2.4;
skyU['mieCoefficient'].value = 0.005;
skyU['mieDirectionalG'].value = 0.75;

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();

// --- Custom SSS water material driven by the FFT sim ---
const skyAdapter = {
  topColor: new THREE.Color(0x2f7ed6),     // rich blue zenith for water reflection
  bottomColor: new THREE.Color(0x9ec9ec),  // lighter blue horizon
  sunDirection: sun,
  sunColor: new THREE.Color(0xfff2dd),
};
const oceanMat = createOceanMaterial(skyAdapter);
const foamTex = new THREE.TextureLoader().load('textures/waternormals.jpg', (t) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
});
oceanMat.uniforms.uFoamTex.value = foamTex;
const water = new THREE.Mesh(new THREE.PlaneGeometry(800, 800, 1536, 1536), oceanMat);
water.rotation.x = -Math.PI / 2;
water.frustumCulled = false;
water.receiveShadow = true;
scene.add(water);

function setSun(elevationDeg, azimuthDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  sun.setFromSphericalCoords(1, phi, theta);
  skyU['sunPosition'].value.copy(sun);
  envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.add(sky);
}
setSun(32, 150);

const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.5);
keyLight.position.copy(sun).multiplyScalar(100);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -500;
keyLight.shadow.camera.right = 500;
keyLight.shadow.camera.top = 500;
keyLight.shadow.camera.bottom = -500;
keyLight.shadow.camera.far = 2000;
scene.add(keyLight);

// --- Post: tonemapping / color-space pass ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const pixelPass = createPixelatePass(config.post.pixelSize);
pixelPass.enabled = config.post.pixelate;
composer.addPass(pixelPass);
composer.addPass(new OutputPass());
window.addEventListener('resize', () => {
  composer.setSize(window.innerWidth, window.innerHeight);
  pixelPass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
});

// Live tuning panel (the ✕ in its title bar removes it entirely).
createTuningPanel({ renderer, oceanMat, sim, config, pixelPass });

let prev = performance.now();
let t = 0;

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
        if (mode == 2) gl_FragColor = vec4(vec3(t.y * 0.5 + 0.5), 1.0);
        else if (mode == 1) gl_FragColor = vec4(t.xy * 0.5 + 0.5, 0.5, 1.0);
        else gl_FragColor = vec4(t.xyz * 0.4 + 0.5, 1.0);
      }`,
  });
  dbgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dbgMat));
  dbg = { dbgScene, dbgCam, dbgMat };
}

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  t += dt * config.sim.speed;

  sim.update(t);
  const disp = sim.displacementTextures;
  const slope = sim.slopeTextures;
  for (let i = 0; i < disp.length; i++) {
    oceanMat.uniforms[`uDisp${i}`].value = disp[i];
    oceanMat.uniforms[`uSlope${i}`].value = slope[i];
  }
  const foam = sim.foamTextures;
  for (let i = 0; i < foam.length; i++) oceanMat.uniforms[`uFoam${i}`].value = foam[i];
  oceanMat.uniforms.uTime.value = t;

  // Snap the water patch to its own grid cell so the mesh vertices stay on fixed
  // world positions (the wave field is world-locked) -> no swimming/jiggle up close.
  const cell = 800 / 1536;
  water.position.x = Math.round(boat.worldX / cell) * cell;
  water.position.z = Math.round(boat.worldZ / cell) * cell;

  sampler.setCenter(boat.worldX, boat.worldZ); // read back only the window around the boat
  sampler.refresh();
  boat.update(sampler, dt, controls.keys);

  // Boat presses the water into a bowl around its hull (avoids flooding the deck).
  if (boat.loaded) {
    oceanMat.uniforms.uBoatPos.value.set(boat.worldX, boat.worldZ);
    oceanMat.uniforms.uBoatDir.value.set(Math.sin(boat.yaw), Math.cos(boat.yaw));
    oceanMat.uniforms.uBoatHalf.value.set(boat.halfLength * 1.05, boat.halfWidth * 1.25);
  }

  // World-space wake: inject foam at the stern (follows the ship's actual path).
  wakeTrail.decay = config.foam.wakeDecay;
  const wOff = config.foam.wakeOffset;
  const sternX = boat.worldX - Math.sin(boat.yaw) * wOff;
  const sternZ = boat.worldZ - Math.cos(boat.yaw) * wOff;
  const wakeStr = boat.loaded ? config.foam.wakeStrength * Math.min(Math.abs(boat.speed) / 4, 1) : 0;
  wakeTrail.update(boat.worldX, boat.worldZ, sternX, sternZ, wakeStr, config.foam.wakeRadius);
  oceanMat.uniforms.uWakeTex.value = wakeTrail.texture;
  oceanMat.uniforms.uWakeCenter.value.copy(wakeTrail.center);
  oceanMat.uniforms.uWakeWorldSize.value = wakeTrail.worldSize;
  
  // Camera follows the boat. Use the boat's own smooth vertical position (NOT the
  // async height readback, which is stepwise/laggy and makes the camera jitter).
  controls.focal.set(boat.worldX, 0, boat.worldZ);
  controls.update(dt, boat.y);

  if (dbg) {
    dbg.dbgMat.uniforms.tex.value = (debugMode === 'slope' ? sim.slopeTextures : sim.displacementTextures)[0];
    renderer.setRenderTarget(null);
    renderer.render(dbg.dbgScene, dbg.dbgCam);
    return;
  }
  composer.render();
});
