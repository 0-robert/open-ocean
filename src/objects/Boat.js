import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { config } from '../config.js';

export class Boat {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.mesh = null;
    this.sizecoefficient = .5
    this.loaded = false;
    this.draft = 2.5*this.sizecoefficient; // Sinks deeper

    // Physics state
    this.y = 0;
    this.vy = 0;
    this.rotVel = new THREE.Vector2(0, 0); // pitch-rate, roll-rate
    this.rotPos = new THREE.Vector3(0, 0, 0); // pitch, roll, (yaw unused here)

    this.speed = 0;
    this.yawVelocity = 0;

    this.worldX = 0;
    this.worldZ = 0;
    this.yaw = 0;

    // Hull half-extents (set once the model is measured); fallback until loaded.
    this.halfLength = 9.0;
    this.halfWidth = 3.2;

    const loader = new GLTFLoader();
    loader.load('models/boat/Small_Sailing_Boat.gltf', (gltf) => {
      this.mesh = gltf.scene;
      
      const boatGroup = new THREE.Group();
      let sourceBoat = null;
      this.mesh.traverse((o) => {
        if (o.name === 'Small_Sailing_Boat_1_2' && !sourceBoat) sourceBoat = o;
      });
      if (!sourceBoat) sourceBoat = this.mesh;

      const meshes = [];
      sourceBoat.traverse((o) => { if (o.isMesh) meshes.push(o); });

      meshes.forEach(m => {
        const matrix = new THREE.Matrix4();
        m.updateMatrixWorld(true);
        sourceBoat.updateMatrixWorld(true);
        const invSource = sourceBoat.matrixWorld.clone().invert();
        matrix.multiplyMatrices(invSource, m.matrixWorld);
        m.position.set(0,0,0);
        m.quaternion.set(0,0,0,1);
        m.scale.set(1,1,1);
        m.applyMatrix4(matrix);
        boatGroup.add(m);
      });

      const box = new THREE.Box3().setFromObject(boatGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      boatGroup.children.forEach(c => { c.position.sub(center); });

      // Scale: Half of previous (previous was 75, so now 37.5)
      const targetLength = 37.5*this.sizecoefficient; 
      const baseScale = targetLength / size.z;
      boatGroup.scale.set(baseScale * 1.1, baseScale, baseScale);

      boatGroup.position.y = (size.y * 0.5 * baseScale) - this.draft;

      // Real hull half-extents (world units) for buoyancy sampling.
      this.halfLength = (size.z * baseScale) * 0.5;
      this.halfWidth = (size.x * baseScale * 1.1) * 0.5;

      this.group.add(boatGroup);
      this.loaded = true;
      
      boatGroup.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) o.material.roughness = Math.min(o.material.roughness, 0.7);
        }
      });
    }, undefined, (error) => {
      console.error('CRITICAL ERROR (Boat): Failed to load boat model', error);
    });
  }

  update(sampler, dt, keys) {
    if (!this.loaded) return 0;
    dt = Math.min(dt, 1 / 30); // clamp for integrator stability on frame hitches
    const B = config.boat;

    // 1. Driving (dt-correct exponential drag, so feel is frame-rate independent)
    if (keys.has('KeyW')) this.speed += B.accel * dt;
    if (keys.has('KeyS')) this.speed -= B.accel * dt;
    this.speed = Math.max(-B.maxSpeed * 0.5, Math.min(B.maxSpeed, this.speed));
    this.speed *= Math.exp(-B.linDrag * dt);

    // Rudder: turn authority scales with speed (no speed -> no steering)
    const steer = Math.max(-1, Math.min(1, this.speed / B.maxSpeed));
    if (keys.has('KeyA')) this.yawVelocity += B.turnAccel * steer * dt;
    if (keys.has('KeyD')) this.yawVelocity -= B.turnAccel * steer * dt;
    this.yawVelocity *= Math.exp(-B.angDrag * dt);
    this.yaw += this.yawVelocity * dt;

    this.worldX += Math.sin(this.yaw) * this.speed * dt;
    this.worldZ += Math.cos(this.yaw) * this.speed * dt;

    // 2. Sample the water under the hull at its ACTUAL extents.
    const hl = this.halfLength * B.sampleScale;
    const hw = this.halfWidth * B.sampleScale;
    const sample = (ox, oz) => {
      const rx = ox * Math.cos(this.yaw) + oz * Math.sin(this.yaw);
      const rz = -ox * Math.sin(this.yaw) + oz * Math.cos(this.yaw);
      return sampler.getHeightAndNormal(this.worldX + rx, this.worldZ + rz);
    };
    const sBow = sample(0, hl);
    const sStern = sample(0, -hl);
    const sPort = sample(hw, 0);
    const sStbd = sample(-hw, 0);
    const sCenter = sampler.getHeightAndNormal(this.worldX, this.worldZ);
    const waterY = (sBow.height + sStern.height + sPort.height + sStbd.height + sCenter.height) / 5.0;

    // 3. Heave: critically-ish damped spring toward the water surface.
    //    Lag behind the moving surface gives the natural bob; damping settles it.
    const accelY = B.heaveStiffness * (waterY - this.y) - B.heaveDamping * this.vy;
    this.vy += accelY * dt;
    this.y += this.vy * dt;

    // 4. Pitch/roll: damped spring toward the local wave slope across the hull.
    let targetPitch = Math.atan2(sStern.height - sBow.height, 2.0 * hl);
    let targetRoll = Math.atan2(sStbd.height - sPort.height, 2.0 * hw);
    targetPitch = Math.max(-B.rotMax, Math.min(B.rotMax, targetPitch));
    targetRoll = Math.max(-B.rotMax, Math.min(B.rotMax, targetRoll));

    this.rotVel.x += (B.rotStiffness * (targetPitch - this.rotPos.x) - B.rotDamping * this.rotVel.x) * dt;
    this.rotVel.y += (B.rotStiffness * (targetRoll - this.rotPos.y) - B.rotDamping * this.rotVel.y) * dt;
    this.rotPos.x += this.rotVel.x * dt;
    this.rotPos.y += this.rotVel.y * dt;

    // 5. Apply Transforms
    this.group.position.set(this.worldX, this.y, this.worldZ);
    
    // Construct rotation: 
    // 1. Start with Heading (Yaw)
    // 2. Apply Pitch and Roll relative to that heading
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.rotPos.x);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.rotPos.y);
    
    // Combine: Yaw first, then tilt
    this.group.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);

    return this.y;
  }
}
