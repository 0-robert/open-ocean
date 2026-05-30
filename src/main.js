import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { config } from './config.js';
import { createRenderer, handleResize } from './core/Renderer.js';
import { OrbitFollowControls } from './camera/OrbitFollowControls.js';
import { OceanSim } from './wave/OceanSim.js';
import { OceanSampler } from './wave/OceanSampler.js';
import { createOceanMaterial } from './ocean/oceanMaterial.js';
import { Buoy } from './objects/Buoy.js';

const canvas = document.getElementById('app');
const renderer = createRenderer(canvas);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
handleResize(renderer, camera);

const controls = new OrbitFollowControls(camera, canvas);
const sun = new THREE.Vector3();

// --- FFT ocean simulation ---
const sim = new OceanSim(renderer);
const sampler = new OceanSampler(renderer, sim);

// --- Sky (three.js atmospheric scattering) for background + buoy env ---
const sky = new Sky();
sky.scale.setScalar(20000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU['turbidity'].value = 1.2;
skyU['rayleigh'].value = 4.0;
skyU['mieCoefficient'].value = 0.003;
skyU['mieDirectionalG'].value = 0.7;

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();

// --- Custom SSS water material driven by the FFT sim ---
const skyAdapter = {
  topColor: new THREE.Color(0x2a6fb0),
  bottomColor: new THREE.Color(0xb8dcf0),
  sunDirection: sun,
  sunColor: new THREE.Color(0xfff2dd),
};
const oceanMat = createOceanMaterial(skyAdapter);
const water = new THREE.Mesh(new THREE.PlaneGeometry(800, 800, 1536, 1536), oceanMat);
water.rotation.x = -Math.PI / 2;
water.frustumCulled = false;
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
setSun(24, 150);

const keyLight = new THREE.DirectionalLight(0xfff2dd, 1.5);
keyLight.position.copy(sun).multiplyScalar(100);
scene.add(keyLight);

const buoy = new Buoy(scene);

let prev = performance.now();
let t = 0;
window.__ocean = { THREE, scene, camera, controls, water, oceanMat, sky, sim, config, setSun };

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

  water.position.x = controls.focal.x;
  water.position.z = controls.focal.z;

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
