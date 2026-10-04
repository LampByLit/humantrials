import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { input } from "./input";
import type { Sense } from "./sim/reactions";

const EYE_HEIGHT = 1.58;
const MOVE_SPEED = 2.3;
const SLOW_MOVE = 0.08;
const LOOK_SENS = 0.0022;
const PITCH_MIN = -1.15;
const PITCH_MAX = 1.05;
// Drinking is looking up to the stop and pouring onto yourself.
export const DRINK_PITCH = 0.9;
const CAPSULE_HALF = 0.58;
const CAPSULE_RADIUS = 0.22;
// Wider than the body so a pour from the hand in front still counts as swallowed.
const DRINK_RADIUS = 0.55;
const CAPSULE_CENTER = CAPSULE_HALF + CAPSULE_RADIUS;

const PLAYER_GROUP = 0x0001;
const WORLD_GROUP = 0x0002;
const PROP_GROUP = 0x0008;
const PLAYER_GROUPS = (WORLD_GROUP | PROP_GROUP) << 16 | PLAYER_GROUP;

const REST_FOV = 68;

export type Player = {
  yaw: number;
  pitch: number;
  clock: number;
  object: THREE.Group;
  pivot: THREE.Group;
  camera: THREE.PerspectiveCamera;
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
    clock: 0,
    object,
    pivot,
    camera,
    body,
    collider,
    controller,
  };
}

export function playerCapsule(player: Player) {
  const at = player.body.translation();
  return { x: at.x, y: at.y, z: at.z, half: CAPSULE_HALF, radius: DRINK_RADIUS };
}

const steady: Sense = {
  shake: 0,
  spasm: 0,
  pound: 0,
  rate: 1.15,
  tint: [0, 0, 0],
  wash: 0,
  skin: [0, 0, 0],
  flush: 0,
  vignette: 0,
  sway: 0,
  blur: 0,
  move: 1,
  operate: 1,
  pulse: 0,
};

export function updatePlayer(
  player: Player,
  world: RAPIER.World,
  dt: number,
  grounded: { value: boolean },
  verticalVelocity: { value: number },
  sense: Sense = steady,
) {
  player.clock += dt;
  const operate = sense.operate;
  if (input.locked && input.playing && !input.space && operate > 0) {
    const lookSens = LOOK_SENS * (input.slow() ? SLOW_MOVE : 1) * operate;
    player.yaw -= input.lookX * lookSens;
    player.pitch -= input.lookY * lookSens;
    player.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, player.pitch));
  }
  input.lookX = 0;
  input.lookY = 0;

  if (sense.move <= 0) {
    const settle = 1 - Math.exp(-1.4 * dt);
    player.pitch += (-1.05 - player.pitch) * settle;
    player.pivot.position.y += (0.45 - player.pivot.position.y) * settle;
  }

  let forward = 0;
  let strafe = 0;
  if (input.playing && sense.move > 0) {
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
  const speed = MOVE_SPEED * (input.slow() ? SLOW_MOVE : 1) * sense.move;
  const weave = Math.sin(player.clock * 1.8) * sense.sway * speed * 0.55;
  const moveX = (strafe * cos - forward * sin) * speed * dt + weave * dt;
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
  applyFeel(player, sense);
}

export function applyFeel(player: Player, sense: Sense) {
  const time = player.clock;
  const beat = Math.sin(time * sense.rate * Math.PI * 2);
  const jolt = sense.spasm > 0.35 && Math.sin(time * 2.6) > 0.9 ? sense.spasm : 0;
  const shake = sense.shake * 0.034 + sense.spasm * 0.02 + jolt * 0.05;
  player.camera.position.set(
    Math.sin(time * 23.1) * shake + Math.sin(time * 47) * sense.spasm * 0.028,
    Math.sin(time * 19.4) * shake * 0.85 + beat * sense.pound * 0.022 + jolt * 0.03,
    0,
  );
  player.camera.rotation.z =
    Math.sin(time * 1.4) * sense.sway * 0.18 + Math.sin(time * 29) * sense.spasm * 0.1 + jolt * 0.2;
  const fov = REST_FOV + beat * sense.pound * 8 + Math.sin(time * (2 + sense.pulse * 3)) * sense.pulse * 6;
  if (Math.abs(player.camera.fov - fov) > 0.01) {
    player.camera.fov = fov;
    player.camera.updateProjectionMatrix();
  }
}
