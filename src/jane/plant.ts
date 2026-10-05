import * as THREE from "three";

const box = new THREE.Box3();
const size = new THREE.Vector3();

/** Puts the object's feet on y=0 and its longest axis at `length` metres. */
export function plantLength(object: THREE.Object3D, length: number) {
  object.position.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.rotation.set(0, 0, 0);
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z, 1e-4);
  object.scale.setScalar(length / longest);
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  object.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
}

/** Puts the object's feet on y=0 and its height at `height` metres. */
export function plantHeight(object: THREE.Object3D, height: number) {
  object.position.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.rotation.set(0, 0, 0);
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  const current = Math.max(box.max.y - box.min.y, 1e-4);
  object.scale.setScalar(height / current);
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  object.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
}
