import * as THREE from 'three';
import { config } from '../config.js';

/** A grid that re-centers (snapped to texel size) on the focal point. */
export class OceanMesh {
  constructor(material) {
    const segs = Math.round(config.mesh.tiles * config.mesh.quadRes);
    const geo = new THREE.PlaneGeometry(config.mesh.tiles, config.mesh.tiles, segs, segs).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    // Snap to the finest cascade's texel size so vertices don't swim.
    const finestScale = Math.min(...config.sim.cascades.map((c) => c.lengthScale));
    this._cell = finestScale / config.sim.N;
  }

  /** Snap the mesh under the focal point so vertices don't swim as you sail. */
  recenter(focal) {
    this.mesh.position.x = Math.round(focal.x / this._cell) * this._cell;
    this.mesh.position.z = Math.round(focal.z / this._cell) * this._cell;
  }
}
