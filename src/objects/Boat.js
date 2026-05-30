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
    this.draft = 2.0*this.sizecoefficient; // visual seating offset (hull bottom below boat origin)

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

    // 3 & 4. Rigid-body buoyancy: gravity pulls down at all times; each hull point
    // that is underwater pushes up with a force ~ its submerged depth (Archimedes).
    // Summed -> heave; the same forces at their offsets -> pitch/roll torque.
    const g = B.gravity;
    const pts = [
      [0, hl, sBow.height],
      [0, -hl, sStern.height],
      [hw, 0, sPort.height],
      [-hw, 0, sStbd.height],
      [0, 0, sCenter.height],
    ];
    let fy = -B.mass * g; // gravity (constant downward)
    let torquePitch = 0;  // about boat X axis
    let torqueRoll = 0;   // about boat Z axis
    let wet = 0;          // how many hull points are underwater
    for (let k = 0; k < pts.length; k++) {
      const px = pts[k][0], pz = pts[k][1], waterH = pts[k][2];
      // world height of this hull point given current heave + small-angle tilt
      const pointY = this.y - this.rotPos.x * pz + this.rotPos.y * px;
      const sub = Math.max(0, waterH - pointY); // submerged depth (0 if in air)
      if (sub > 0) wet += 1;
      const fb = B.buoyancy * sub;               // buoyant force, up
      fy += fb;
      torquePitch += -pz * fb;
      torqueRoll += px * fb;
    }
    const wetFrac = wet / pts.length;

    // Heave: real gravity always; water drag ONLY when submerged. In air the boat
    // falls at g (no feather); underwater the drag damps the bob.
    const ay = fy / B.mass - B.heaveDrag * wetFrac * this.vy;
    this.vy += ay * dt;
    this.y += this.vy * dt;

    // Pitch/roll from buoyancy torque (deeper side gets lifted -> self-rights).
    const aPitch = torquePitch / B.inertia - B.rotDrag * this.rotVel.x;
    const aRoll = torqueRoll / B.inertia - B.rotDrag * this.rotVel.y;
    this.rotVel.x += aPitch * dt;
    this.rotVel.y += aRoll * dt;
    this.rotPos.x = Math.max(-B.rotMax, Math.min(B.rotMax, this.rotPos.x + this.rotVel.x * dt));
    this.rotPos.y = Math.max(-B.rotMax, Math.min(B.rotMax, this.rotPos.y + this.rotVel.y * dt));

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
