import * as THREE from 'three';
import GUI from 'lil-gui';

const hex = (rgb) => '#' + new THREE.Color(rgb[0], rgb[1], rgb[2]).getHexString();

/**
 * Live tuning panel. Every slider updates the running uniforms immediately.
 * @param {{renderer, oceanMat, sim, config}} refs
 */
export function createTuningPanel({ renderer, oceanMat, sim, config }) {
  const gui = new GUI({ title: 'Ocean / Boat Tuning' });
  const u = oceanMat.uniforms;

  // ✕ button in the title bar that removes (destroys) the panel entirely.
  const titleEl = gui.$title;
  titleEl.style.position = 'relative';
  const closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close panel';
  closeBtn.setAttribute('role', 'button');
  closeBtn.style.cssText =
    'position:absolute;top:0;right:8px;display:flex;align-items:center;height:100%;' +
    'font-size:13px;cursor:pointer;opacity:0.7;';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); gui.destroy(); });
  titleEl.appendChild(closeBtn);
  const setFlow = (v) => {
    const a = (config.spectrum.windDirection / 180) * Math.PI;
    sim.foamUniforms.uFlow.value.set(Math.cos(a), Math.sin(a)).multiplyScalar(v);
  };

  // ---- Water color ----
  const colors = { deep: hex(config.colors.deep), scatter: hex(config.colors.scatter), foam: hex(config.colors.foam) };
  const fc = gui.addFolder('Water Color');
  fc.addColor(colors, 'deep').name('deep / trough').onChange((v) => u.uDeepColor.value.set(v));
  fc.addColor(colors, 'scatter').name('scatter / crest').onChange((v) => u.uScatterColor.value.set(v));
  fc.addColor(colors, 'foam').onChange((v) => u.uFoamColor.value.set(v));

  // ---- Waves ----
  const fw = gui.addFolder('Waves');
  fw.add(config.sim, 'displacementScale', 0, 4, 0.05).name('height').onChange((v) => (u.uDisplacementScale.value = v));
  fw.add(config.sim.lambda, '0', 0, 2, 0.05).name('choppiness').onChange((v) => sim.assembleUniforms.uLambda.value.set(v, v));
  fw.add(config.spectrum, 'windSpeed', 1, 30, 0.5).name('wind speed').onChange(() => sim.rebuildSpectrum());
  fw.add(config.spectrum, 'windDirection', 0, 360, 1).name('wind dir').onChange(() => { sim.rebuildSpectrum(); setFlow(config.foam.flow); });

  // ---- Lighting ----
  const fl = gui.addFolder('Lighting');
  fl.add(renderer, 'toneMappingExposure', 0.1, 1.5, 0.01).name('exposure');
  fl.add(config.lighting, 'scatterStrength', 0, 3, 0.05).onChange((v) => (u.uScatterStrength.value = v));
  fl.add(config.lighting, 'wavePeakScatterStrength', 0, 5, 0.1).name('peak scatter').onChange((v) => (u.uWavePeakScatterStrength.value = v));
  fl.add(config.lighting, 'scatterShadowStrength', 0, 2, 0.05).name('shadow scatter').onChange((v) => (u.uScatterShadowStrength.value = v));
  fl.add(config.lighting, 'environmentLightStrength', 0, 2, 0.05).name('sky reflection').onChange((v) => (u.uEnvironmentLightStrength.value = v));
  fl.add(config.lighting, 'normalStrength', 0, 2, 0.05).onChange((v) => (u.uNormalStrength.value = v));
  fl.add(config.lighting, 'roughness', 0.02, 0.6, 0.01).onChange((v) => (u.uRoughness.value = v));

  // ---- Foam ----
  const ff = gui.addFolder('Foam');
  ff.add(config.foam, 'amount', 0, 6, 0.1).onChange((v) => (u.uFoamAmount.value = v));
  ff.add(config.foam, 'bias', -0.5, 1, 0.01).name('coverage (bias)').onChange((v) => (sim.assembleUniforms.uFoamBias.value = v));
  ff.add(config.foam, 'add', 0, 3, 0.05).name('inject amount').onChange((v) => (sim.assembleUniforms.uFoamAdd.value = v));
  ff.add(config.foam, 'decay', 0.9, 0.999, 0.001).name('persistence').onChange((v) => (sim.foamUniforms.uDecay.value = v));
  ff.add(config.foam, 'flow', 0, 0.01, 0.0005).name('drift speed').onChange(setFlow);

  // ---- Wake (follows the ship) ----
  const fk = gui.addFolder('Boat Wake');
  fk.add(config.foam, 'wakeStrength', 0, 2, 0.05).name('strength');
  fk.add(config.foam, 'wakeRadius', 1, 25, 0.5).name('width');
  fk.add(config.foam, 'wakeOffset', 0, 30, 0.5).name('trail offset (stern)');
  fk.add(config.foam, 'wakeDecay', 0.9, 0.999, 0.001).name('persistence');

  // ---- Boat physics (config.boat is read live each frame) ----
  const fb = gui.addFolder('Boat Physics');
  fb.add(config.boat, 'maxSpeed', 1, 30, 0.5);
  fb.add(config.boat, 'accel', 1, 30, 0.5);
  fb.add(config.boat, 'turnAccel', 0.1, 3, 0.05).name('turn rate');
  fb.add(config.boat, 'buoyancy', 1, 16, 0.1);
  fb.add(config.boat, 'gravity', 5, 50, 0.5);
  fb.add(config.boat, 'heaveDrag', 0, 12, 0.1).name('bob damping');
  fb.add(config.boat, 'inertia', 5, 120, 1).name('rock inertia');
  fb.add(config.boat, 'rotDrag', 0, 12, 0.1).name('rock damping');

  // ---- Fog ----
  const fp = gui.addFolder('Fog');
  fp.add(config.fog, 'near', 0, 1500, 10).onChange((v) => (u.uFogNear.value = v));
  fp.add(config.fog, 'far', 100, 5000, 10).onChange((v) => (u.uFogFar.value = v));

  return gui;
}
