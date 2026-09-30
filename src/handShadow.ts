import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Hands } from "./hands";

const RAY_GROUPS = ((0x0002 | 0x0008) << 16) | 0xffff;
const PALM = new THREE.Vector3(0, 0.06, 0);
const MAX_DROP = 1.4;
const FADE_DROP = 1.1;
const NEAR_RADIUS = 0.035;
const SPREAD = 0.1;
const DARKNESS = 0.6;
const LIFT = 0.002;

export type HandShadow = {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  ray: RAPIER.Ray;
};

// A soft disc dropped straight down from the palm. It sits directly under the hand, so
// it reads where the hand is over the bench, and it tightens and darkens as the hand
// comes down, which reads height.
export function createHandShadow(scene: THREE.Scene): HandShadow {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: blobTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    }),
  );
  mesh.visible = false;
  mesh.frustumCulled = false;
  // Draws after the glass so it still shows through a beaker wall.
  mesh.renderOrder = 4;
  scene.add(mesh);
  return { mesh, ray: new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }) };
}

function blobTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(0.45, "#aaa");
  gradient.addColorStop(1, "#000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const palm = new THREE.Vector3();
const offset = new THREE.Vector3();
const handQuat = new THREE.Quaternion();
const normal = new THREE.Vector3();
const facing = new THREE.Vector3(0, 0, 1);

export function updateHandShadow(
  shadow: HandShadow,
  world: RAPIER.World,
  hands: Hands,
  held: RAPIER.RigidBody | undefined,
) {
  const hand = hands.arm.hand;
  hand.getWorldPosition(palm);
  hand.getWorldQuaternion(handQuat);
  palm.add(offset.copy(PALM).applyQuaternion(handQuat));

  const ray = shadow.ray;
  ray.origin.x = palm.x;
  ray.origin.y = palm.y;
  ray.origin.z = palm.z;
  const hit = world.castRayAndGetNormal(
    ray,
    MAX_DROP,
    true,
    0 as RAPIER.QueryFilterFlags,
    RAY_GROUPS,
    undefined,
    held,
  );
  const mesh = shadow.mesh;
  if (!hit) {
    mesh.visible = false;
    return;
  }

  const drop = hit.timeOfImpact;
  normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
  mesh.position.set(palm.x, palm.y - drop, palm.z).addScaledVector(normal, LIFT);
  mesh.quaternion.setFromUnitVectors(facing, normal);
  mesh.scale.setScalar(NEAR_RADIUS + SPREAD * drop);
  mesh.material.opacity = DARKNESS * Math.max(0, 1 - drop / FADE_DROP);
  mesh.visible = mesh.material.opacity > 0.01;
}
