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

  /** @param dt seconds @param surfaceY vertical position to follow (the boat) */
  update(dt, surfaceY = 0) {
    // The boat drives movement; the camera just orbits its focal point (set by
    // main). We do NOT move the focal here, or it would fight the boat each frame.

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
