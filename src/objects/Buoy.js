import * as THREE from 'three';

/** A marker that rides + tilts on the surface using an OceanSampler query. */
export class Buoy {
  constructor(scene) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.2, 4, 16),
      new THREE.MeshStandardMaterial({ color: 0xff5522, roughness: 0.5, metalness: 0.1 }),
    );
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.4 }),
    );
    top.position.y = 2.6;
    group.add(body, top);
    group.traverse((o) => (o.frustumCulled = false));
    scene.add(group);
    this.mesh = group;
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Place + tilt on the surface; returns the sampled water height. */
  update(x, z, sampler) {
    const { height, normal } = sampler.getHeightAndNormal(x, z);
    this.mesh.position.set(x, height, z);
    const n = new THREE.Vector3(...normal).normalize();
    this.mesh.quaternion.setFromUnitVectors(this._up, n);
    return height;
  }
}
