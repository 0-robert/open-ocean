import * as THREE from 'three';

export const clampPitch = (p) => Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, p));
export const clampZoom = (z, min, max) => Math.max(min, Math.min(max, z));

/** Roblox-style third-person orbit-follow camera around a movable focal point. */
export class OrbitFollowControls {
  constructor(camera, domElement, { minZoom = 15, maxZoom = 400, moveSpeed = 60 } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.focal = new THREE.Vector3(0, 0, 0); // world anchor (boat later)
    this.yaw = 0.5; this.pitch = 0.22; this.dist = 48;
    this.minZoom = minZoom; this.maxZoom = maxZoom; this.moveSpeed = moveSpeed;
    this.keys = new Set();
    this._dragging = false; this._lastSmoothY = 0;

    domElement.addEventListener('mousedown', () => (this._dragging = true));
    window.addEventListener('mouseup', () => (this._dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this._dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = clampPitch(this.pitch - e.movementY * 0.005);
    });
    domElement.addEventListener('wheel', (e) => {
      this.dist = clampZoom(this.dist + e.deltaY * 0.05, this.minZoom, this.maxZoom);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** @param dt seconds @param surfaceY optional water height under the focal point */
  update(dt, surfaceY = 0) {
    // WASD moves the focal point in the camera-relative horizontal plane.
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.sub(f);
    if (this.keys.has('KeyS')) move.add(f);
    if (this.keys.has('KeyA')) move.sub(r);
    if (this.keys.has('KeyD')) move.add(r);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(this.moveSpeed * dt);
    this.focal.add(move);

    // Smooth the vertical follow so wave bob doesn't induce nausea.
    this._lastSmoothY += (surfaceY - this._lastSmoothY) * Math.min(1, dt * 3);
    const target = new THREE.Vector3(this.focal.x, this._lastSmoothY, this.focal.z);

    const offset = new THREE.Vector3(
      this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
      this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
    );
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
  }
}
