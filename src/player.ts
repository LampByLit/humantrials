import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { input } from "./input";

const EYE_HEIGHT = 1.58;
const MOVE_SPEED = 2.3;
const SLOW_MOVE = 0.35;
const LOOK_SENS = 0.0022;
const PITCH_MIN = -1.15;
const PITCH_MAX = 1.05;
// Drinking is looking up to the stop and pouring onto yourself.
export const DRINK_PITCH = 0.9;
const CAPSULE_HALF = 0.58;
const CAPSULE_RADIUS = 0.22;
const CAPSULE_CENTER = CAPSULE_HALF + CAPSULE_RADIUS;

const PLAYER_GROUP = 0x0001;
const WORLD_GROUP = 0x0002;
const PROP_GROUP = 0x0008;
const PLAYER_GROUPS = (WORLD_GROUP | PROP_GROUP) << 16 | PLAYER_GROUP;

export type Player = {
  yaw: number;
  pitch: number;
  object: THREE.Group;
  pivot: THREE.Group;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
};

export function createPlayer(
  scene: THREE.Scene,
  world: RAPIER.World,
  camera: THREE.PerspectiveCamera,
): Player {
  const object = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.y = EYE_HEIGHT;
  pivot.add(camera);
  object.add(pivot);
  scene.add(object);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CAPSULE_CENTER, 1.05),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(PLAYER_GROUPS),
    body,
  );

  const controller = world.createCharacterController(0.02);
  controller.enableSnapToGround(0.25);
  controller.setApplyImpulsesToDynamicBodies(true);
  controller.enableAutostep(0.25, 0.15, true);

  object.position.set(0, 0, 1.05);
  pivot.rotation.x = -0.28;

  return {
    yaw: 0,
    pitch: -0.28,
    object,
    pivot,
    body,
    collider,
    controller,
  };
}

export function playerCapsule(player: Player) {
  const at = player.body.translation();
  return { x: at.x, y: at.y, z: at.z, half: CAPSULE_HALF, radius: CAPSULE_RADIUS };
}

export function updatePlayer(player: Player, world: RAPIER.World, dt: number, grounded: { value: boolean }, verticalVelocity: { value: number }) {
  if (input.locked && input.playing && !input.space) {
    player.yaw -= input.lookX * LOOK_SENS;
    player.pitch -= input.lookY * LOOK_SENS;
    player.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, player.pitch));
  }
  input.lookX = 0;
  input.lookY = 0;

  let forward = 0;
  let strafe = 0;
  if (input.playing) {
    if (input.keys.has("KeyW")) forward += 1;
    if (input.keys.has("KeyS")) forward -= 1;
    if (input.keys.has("KeyA")) strafe -= 1;
    if (input.keys.has("KeyD")) strafe += 1;
  }
  const length = Math.hypot(forward, strafe);
  if (length > 0) {
    forward /= length;
    strafe /= length;
  }

  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const speed = MOVE_SPEED * (input.slow() ? SLOW_MOVE : 1);
  const moveX = (strafe * cos - forward * sin) * speed * dt;
  const moveZ = (-strafe * sin - forward * cos) * speed * dt;

  verticalVelocity.value += world.gravity.y * dt;
  if (grounded.value && verticalVelocity.value < 0) verticalVelocity.value = 0;

  player.controller.computeColliderMovement(
    player.collider,
    {
      x: moveX,
      y: verticalVelocity.value * dt,
      z: moveZ,
    },
    0 as RAPIER.QueryFilterFlags,
    PLAYER_GROUPS,
  );
  const movement = player.controller.computedMovement();
  grounded.value = player.controller.computedGrounded();
  if (grounded.value && movement.y <= 0.0001) verticalVelocity.value = 0;

  const position = player.body.translation();
  const next = {
    x: position.x + movement.x,
    y: position.y + movement.y,
    z: position.z + movement.z,
  };
  player.body.setNextKinematicTranslation(next);

  player.object.position.set(next.x, next.y - CAPSULE_CENTER, next.z);
  player.object.rotation.y = player.yaw;
  player.pivot.rotation.x = player.pitch;
}
