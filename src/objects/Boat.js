import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Boat {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.mesh = null;
    this.sizecoefficient = .5
    this.loaded = false;
    this.draft = 2.5*this.sizecoefficient; // Sinks deeper
    
    // Physics - Heavy Spring-Damper
    this.y = 0;
    this.vy = 0;
    this.rotVel = new THREE.Vector2(0, 0); 
    this.rotPos = new THREE.Vector3(0, 0, 0); // pitch, roll, yaw
    
    this.speed = 0;
    this.maxSpeed = 35.0;
    this.accel = 15.0;
    this.drag = 0.994;
    
    // Realistic Steering - derived from old linear turn speed
    this.yawVelocity = 0;
    this.turnAccel = 0.01; // Extremely sluggish build up
    this.turnDrag = 0.97; // High inertia
    this.rudderEffect = 0.04; 

    this.worldX = 0; 
    this.worldZ = 0;
    this.yaw = 0; 

    // Hull sampling points relative to center (unscaled)
    this.hullOffsets = [
      new THREE.Vector3(0, 0, 1.0)*this.sizecoefficient,   // Bow
      new THREE.Vector3(0, 0, -1.0)*this.sizecoefficient,  // Stern
      new THREE.Vector3(0.3, 0, 0)*this.sizecoefficient,   // Port
      new THREE.Vector3(-0.3, 0, 0)*this.sizecoefficient,  // Starboard
    ];

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

    // 1. Driving Controls
    if (keys.has('KeyW')) this.speed += this.accel * dt;
    if (keys.has('KeyS')) this.speed -= this.accel * dt;

    // Steering requires movement (Rudder effect)
    // Turning is more effective the faster we move
    const speedFactor = Math.abs(this.speed) * this.rudderEffect;
    if (keys.has('KeyA')) this.yawVelocity += this.turnAccel * speedFactor * dt;
    if (keys.has('KeyD')) this.yawVelocity -= this.turnAccel * speedFactor * dt;

    this.speed = Math.max(-this.maxSpeed * 0.5, Math.min(this.maxSpeed, this.speed));
    this.speed *= this.drag;

    this.yawVelocity *= this.turnDrag;
    this.yaw += this.yawVelocity;

    this.worldX += Math.sin(this.yaw) * this.speed * dt;
    this.worldZ += Math.cos(this.yaw) * this.speed * dt;

    // 2. Hull Buoyancy Physics (Multi-point sampling)
    const L = 37.5 * 0.6; // Wider sampling for crest detection
    const W = L * 0.4;
    
    const sample = (ox, oz) => {
      const rx = ox * Math.cos(this.yaw) + oz * Math.sin(this.yaw);
      const rz = -ox * Math.sin(this.yaw) + oz * Math.cos(this.yaw);
      return sampler.getHeightAndNormal(this.worldX + rx, this.worldZ + rz);
    };

    const sBow = sample(0, L);
    const sStern = sample(0, -L);
    const sPort = sample(W, 0);
    const sStbd = sample(-W, 0);
    const sCenter = sampler.getHeightAndNormal(this.worldX, this.worldZ);

    // Calculate displacement depth (submergence)
    const surfaceY = (sBow.height + sStern.height + sPort.height + sStbd.height + sCenter.height) / 5.0;
    const submergence = surfaceY - this.y;
    
    // Aggressive Non-linear Buoyancy: 
    // The deeper the boat is under the wave, the stronger the upward force.
    let buoyancyForce = submergence * 50.0; 
    if (submergence > this.draft) {
      buoyancyForce += Math.pow(submergence - this.draft, 2.0) * 150.0;
    }
    
    const ay = buoyancyForce - 9.81 * 2.5; 
    this.vy += ay * dt;
    this.vy *= 0.9; 
    this.y += this.vy * dt;

    // 3. Rotation (Pitch and Roll from height differences)
    const targetPitch = Math.atan2(sStern.height - sBow.height, L * 2.0);
    const targetRoll = Math.atan2(sStbd.height - sPort.height, W * 2.0);

    const rotSmooth = 8.0 + Math.abs(this.speed) * 0.2;
    const aRotX = (targetPitch - this.rotPos.x) * rotSmooth;
    const aRotY = (targetRoll - this.rotPos.y) * rotSmooth;
    
    this.rotVel.x += aRotX * dt;
    this.rotVel.y += aRotY * dt;
    this.rotVel.multiplyScalar(0.92); 
    
    this.rotPos.x += this.rotVel.x * dt;
    this.rotPos.y += this.rotVel.y * dt;

    // 4. Apply Transforms
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
