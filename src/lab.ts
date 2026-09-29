import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { solutionFromHex, type Solution } from "./fluid/solution";

const WORLD_GROUP = 0x0002;
const PROP_GROUP = 0x0008;
const ALL_GROUPS = 0xffff;

function collisionGroups(membership: number, filter: number) {
  return (filter << 16) | membership;
}

export type Beaker = {
  mesh: THREE.Group;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  height: number;
  solution: Solution;
};

// A 250mL beaker. The hand rig spans about 9.5cm between the thumb pad and the
// fingertips at full stretch, so anything much wider than this cannot be picked up:
// see tools/grip-lab.mjs. hands.ts sizes its grip from this radius.
export const BEAKER_RADIUS = 0.034;
const BEAKER_HEIGHT = 0.09;

export function createLab(scene: THREE.Scene, world: RAPIER.World): Beaker[] {
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.95 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x3c434b, roughness: 0.9 });
  const benchMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.55, metalness: 0.04 });

  addBox(scene, world, floorMaterial, 8, 0.5, 8, 0, -0.25, 0);
  addBox(scene, world, wallMaterial, 8, 1.5, 0.2, 0, 1.5, -4);
  addBox(scene, world, wallMaterial, 8, 1.5, 0.2, 0, 1.5, 4);
  addBox(scene, world, wallMaterial, 0.2, 1.5, 8, -4, 1.5, 0);
  addBox(scene, world, wallMaterial, 0.2, 1.5, 8, 4, 1.5, 0);

  const topY = 0.9;
  addBox(scene, world, benchMaterial, 1.55, 0.07, 0.78, 0, topY, -0.2);
  const legH = 0.86;
  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.48, 0.08]) {
      addBox(scene, world, benchMaterial, 0.08, legH, 0.08, x, legH / 2, z);
    }
  }

  const surface = topY + 0.035;
  return [
    addBeaker(scene, world, 0xe23b2f, -0.3, surface, 0.0, 0.72),
    addBeaker(scene, world, 0x2f8f4e, 0.02, surface, 0.06, 0.5),
    addBeaker(scene, world, 0x2d6fdb, 0.32, surface, -0.04, 0.64),
  ];
}

function addBox(
  scene: THREE.Scene,
  world: RAPIER.World,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
      .setFriction(0.9)
      .setRestitution(0.05)
      .setCollisionGroups(collisionGroups(WORLD_GROUP, ALL_GROUPS)),
    body,
  );
}

function addBeaker(
  scene: THREE.Scene,
  world: RAPIER.World,
  color: number,
  x: number,
  surfaceY: number,
  z: number,
  fill: number,
): Beaker {
  const radius = BEAKER_RADIUS;
  const height = BEAKER_HEIGHT;
  const mesh = new THREE.Group();

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xdfe7ea,
    transparent: true,
    opacity: 0.28,
    roughness: 0.08,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.92, height, 28, 1, true),
    glass,
  );
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, 28), glass);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -height / 2 + 0.004;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.006, 8, 28), glass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height / 2;
  wall.renderOrder = 3;
  bottom.renderOrder = 3;
  rim.renderOrder = 3;

  mesh.add(wall, bottom, rim);
  mesh.castShadow = true;
  scene.add(mesh);

  const centerY = surfaceY + height / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, centerY, z)
      .setLinearDamping(0.45)
      .setAngularDamping(0.7)
      .setCcdEnabled(true),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cylinder(height / 2, radius)
      .setDensity(280)
      .setFriction(1.4)
      .setRestitution(0.04)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(collisionGroups(PROP_GROUP, ALL_GROUPS)),
    body,
  );

  mesh.position.set(x, centerY, z);
  return {
    mesh,
    body,
    collider,
    radius,
    height,
    solution: solutionFromHex(color, Math.PI * radius * radius * height * fill),
  };
}

export function syncBeakers(beakers: Beaker[]) {
  for (const beaker of beakers) {
    const position = beaker.body.translation();
    const rotation = beaker.body.rotation();
    beaker.mesh.position.set(position.x, position.y, position.z);
    beaker.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }
}
