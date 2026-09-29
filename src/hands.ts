import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { input } from "./input";
import { BEAKER_RADIUS } from "./lab";

const MODEL_URL = "/models/fps-arm-rig.glb";
const MODEL_SCALE = 0.0046;
const POUR_SENS = 0.007;
const POUR_LIMIT = 1.15;
const SLOW_POUR = 0.3;
const HAND_LERP = 9;
const SQUEEZE_LERP = 18;
const DROP_ANGLE = 1.35;
// A chain of segments following a circle of radius R turns by segment/R at each joint,
// so deriving each joint's curl from its own bone length wraps the fingers around a
// cylinder of that radius instead of rolling them into a fist. The slack lets the
// fingertips settle on the glass rather than driving through it.
const GRIP_RADIUS = BEAKER_RADIUS * 1.15;
const MAX_JOINT_CURL = 1.6;
// How hooked and how fanned the open hand is: together these make it a claw that can be
// placed around a beaker. Both fade out as the hand closes.
const CLAW_ANGLE = 0.18;
const FINGER_FAN_ANGLE = 0.3;
// Fanning runs about each knuckle's local X, which points the same way on both hands.
const FINGER_FAN: Record<string, number> = { Index: -1, Middle: -0.25, Ring: 0.5, Little: 1.25 };
// This rig numbers each digit from the fingertip inward, so Thumb_3 is the base knuckle
// that parents Thumb_2, which parents the distal Thumb_1.
//
// The base is a saddle joint with two degrees of freedom, and they do different jobs:
// local X abducts the thumb out to the side, and local Z swings it in toward the palm.
// Only Z mirrors between hands; X points the same way on both. Closing has to happen on
// Z, or the thumb travels sideways past the fingers instead of meeting them.
// Bind pose lays the thumb along the fingers. A right-angle swing at the base aims it
// across the body, toward where the other hand sits, and the grip leaves it there.
const THUMB_AIM = 1.25;
// The knuckle and tip are pre-bent toward the fingers. These undo that so the thumb
// runs straight out to the left instead of hooking forward. Same sign on both hands.
const THUMB_KNUCKLE_STRAIGHT = -0.4;
const THUMB_TIP_STRAIGHT = -0.35;
const SPLAY_ANGLE = 0.34;

const HAND_GROUP = 0x0004;
const WORLD_GROUP = 0x0002;
const PROP_GROUP = 0x0008;

function collisionGroups(membership: number, filter: number) {
  return (filter << 16) | membership;
}

type Digit = {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  wrap: number; // curl at full squeeze, sized to GRIP_RADIUS
  claw: number; // curl held by the open hand
  fan: number; // knuckle splay, open hand only
  thumb: boolean;
};

export type Arm = {
  side: -1 | 1;
  raised: boolean;
  blend: number;
  squeeze: number;
  upper: THREE.Bone;
  elbow: THREE.Bone;
  hand: THREE.Bone;
  digits: Digit[];
  restUpper: THREE.Quaternion;
  restElbow: THREE.Quaternion;
  restHand: THREE.Quaternion;
  body: RAPIER.RigidBody;
  // Contact points that close on a prop: the palm plus these make a tripod grasp.
  tips: { bone: THREE.Bone; collider: RAPIER.Collider }[];
  fingertip: THREE.Bone;
};

export type Hands = {
  model: THREE.Object3D;
  arm: Arm;
  // Tilt of a held beaker in the player's frame: roll tips it left and right, pitch
  // tips it away from and toward the player.
  pourRoll: number;
  pourPitch: number;
};

// The player has one arm, the rig's right. The rig ships both arms in one skinned mesh,
// so the left is collapsed onto its shoulder rather than removed from the geometry.
// reach.ts parents and places the model.
export async function createHands(world: RAPIER.World): Promise<Hands> {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;
  model.scale.setScalar(MODEL_SCALE);
  model.rotation.x = 0.2;

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.set(0xd2a07a);
        material.roughness = 0.62;
        material.metalness = 0;
        material.side = THREE.FrontSide;
      }
    }
  });

  removeLeftArm(model);
  model.updateMatrixWorld(true);
  return { model, arm: createArm(model, world, 1), pourRoll: 0, pourPitch: 0 };
}

// Drops every triangle that touches a vertex bound mostly to the left shoulder chain.
function removeLeftArm(model: THREE.Object3D) {
  const left = new Set<THREE.Object3D>();
  findBone(model, "ShoulderL").traverse((object) => left.add(object));
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const onLeft = mesh.skeleton.bones.map((bone) => left.has(bone));
    const geometry = mesh.geometry;
    const joints = geometry.getAttribute("skinIndex");
    const weights = geometry.getAttribute("skinWeight");
    const leftVertex = (vertex: number) => {
      let best = 0;
      let joint = 0;
      for (let k = 0; k < 4; k++) {
        const weight = weights.getComponent(vertex, k);
        if (weight > best) {
          best = weight;
          joint = joints.getComponent(vertex, k);
        }
      }
      return onLeft[joint];
    };
    const index = geometry.index;
    const count = index ? index.count : geometry.getAttribute("position").count;
    const keep: number[] = [];
    for (let i = 0; i < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      if (!leftVertex(a) && !leftVertex(b) && !leftVertex(c)) keep.push(a, b, c);
    }
    geometry.setIndex(keep);
  });
}

function createArm(model: THREE.Object3D, world: RAPIER.World, side: -1 | 1): Arm {
  const tag = side === 1 ? "R" : "L";
  const upper = findBone(model, `Upper_Arm${tag}`);
  const elbow = findBone(model, `Elbow${tag}`);
  const hand = findBone(model, `Hand${tag}`);
  const digits = fingerBones(model, tag).map(describeDigit);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const groups = collisionGroups(HAND_GROUP, WORLD_GROUP | PROP_GROUP);
  const solid = (desc: RAPIER.ColliderDesc) =>
    desc
      .setFriction(2.2)
      .setRestitution(0.02)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(groups);
  world.createCollider(solid(RAPIER.ColliderDesc.cuboid(0.035, 0.05, 0.02).setTranslation(0, 0.06, 0)), body);
  // The thumb needs a collider of its own, or nothing opposes the fingers and a
  // cylinder just squirts out of the hand.
  const tips = [`Middle_1${tag}`, `Index_1${tag}`, `Thumb_1${tag}`].map((name) => ({
    bone: findBone(model, name),
    collider: world.createCollider(solid(RAPIER.ColliderDesc.cuboid(0.016, 0.016, 0.022)), body),
  }));

  return {
    side,
    raised: true,
    blend: 1,
    squeeze: 0,
    upper,
    elbow,
    hand,
    digits,
    restUpper: upper.quaternion.clone(),
    restElbow: elbow.quaternion.clone(),
    restHand: hand.quaternion.clone(),
    body,
    tips,
    fingertip: tips[0].bone,
  };
}

function describeDigit(bone: THREE.Bone): Digit {
  const thumb = bone.name.startsWith("Thumb");
  const knuckle = bone.name.startsWith("Thumb_3") || /^(Index|Middle|Ring|Little)_3/.test(bone.name);
  const digit = bone.name.slice(0, bone.name.indexOf("_"));
  return {
    bone,
    rest: bone.quaternion.clone(),
    wrap: Math.min(MAX_JOINT_CURL, segmentLength(bone) / GRIP_RADIUS),
    claw: CLAW_ANGLE,
    fan: knuckle && !thumb ? (FINGER_FAN[digit] ?? 0) * FINGER_FAN_ANGLE : 0,
    thumb,
  };
}

const spanA = new THREE.Vector3();
const spanB = new THREE.Vector3();

// Length of the bone, i.e. the distance to the joint it drives. The fingertip bones have
// no child to measure against, so they inherit most of the phalanx behind them.
function segmentLength(bone: THREE.Bone) {
  const child = bone.children.find((object) => (object as THREE.Bone).isBone);
  if (child) return bone.getWorldPosition(spanA).distanceTo(child.getWorldPosition(spanB));
  const parent = bone.parent;
  if (!parent) return 0;
  return 0.75 * bone.getWorldPosition(spanA).distanceTo(parent.getWorldPosition(spanB));
}

function findBone(root: THREE.Object3D, prefix: string) {
  let match: THREE.Bone | undefined;
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone && object.name.startsWith(prefix)) match = object as THREE.Bone;
  });
  if (!match) throw new Error(`Missing bone ${prefix}`);
  return match;
}

function fingerBones(root: THREE.Object3D, tag: "L" | "R") {
  const bones: THREE.Bone[] = [];
  root.traverse((object) => {
    if (!(object as THREE.Bone).isBone) return;
    if (new RegExp(`^(Thumb|Index|Middle|Ring|Little)_[123]${tag}`).test(object.name)) {
      bones.push(object as THREE.Bone);
    }
  });
  return bones;
}

const spin = new THREE.Quaternion();
const thumbSpin = new THREE.Quaternion();
const upperPose = new THREE.Quaternion();
const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3(0, 0, 1);
const handPosition = new THREE.Vector3();
const handQuaternion = new THREE.Quaternion();
const handInverse = new THREE.Quaternion();
const tipPosition = new THREE.Vector3();
const tipQuaternion = new THREE.Quaternion();

export function updateHands(hands: Hands, dt: number) {
  if (input.toggle) {
    hands.arm.raised = !hands.arm.raised;
    input.toggle = false;
  }

  if (input.playing && input.space) {
    const sens = POUR_SENS * (input.slow() ? SLOW_POUR : 1);
    hands.pourRoll = clampPour(hands.pourRoll - input.pourX * sens);
    hands.pourPitch = clampPour(hands.pourPitch + input.pourY * sens);
  } else {
    const settle = 1 - Math.exp(-7 * dt);
    hands.pourRoll -= hands.pourRoll * settle;
    hands.pourPitch -= hands.pourPitch * settle;
  }
  input.pourX = 0;
  input.pourY = 0;

  poseArm(hands.arm, hands.pourRoll, dt, input.squeeze);
  hands.model.updateMatrixWorld(true);
  syncArm(hands.arm);
}

function clampPour(angle: number) {
  return Math.max(-POUR_LIMIT, Math.min(POUR_LIMIT, angle));
}

function poseArm(arm: Arm, pourRoll: number, dt: number, squeezing: boolean) {
  const raised = arm.raised ? 1 : 0;
  arm.blend += (raised - arm.blend) * (1 - Math.exp(-HAND_LERP * dt));
  const squeezeTarget = squeezing ? 1 : 0;
  arm.squeeze += (squeezeTarget - arm.squeeze) * (1 - Math.exp(-SQUEEZE_LERP * dt));

  const drop = (1 - arm.blend) * DROP_ANGLE;
  upperPose.copy(arm.restUpper);
  spin.setFromAxisAngle(zAxis, arm.side * SPLAY_ANGLE);
  upperPose.multiply(spin);
  spin.setFromAxisAngle(xAxis, drop);
  upperPose.multiply(spin);
  arm.upper.quaternion.copy(upperPose);
  spin.setFromAxisAngle(xAxis, drop * 0.65);
  arm.elbow.quaternion.copy(arm.restElbow).multiply(spin);

  spin.setFromAxisAngle(yAxis, -arm.side * pourRoll * arm.blend);
  arm.hand.quaternion.copy(arm.restHand).multiply(spin);

  // Every joint hinges about its local Z, whose sign mirrors between the two hands. The
  // thumb base and the knuckle fan are the exceptions: they run about local X, which
  // points the same way on both hands.
  for (const digit of arm.digits) {
    const bone = digit.bone;
    bone.quaternion.copy(digit.rest);
    if (bone.name.startsWith("Thumb_3")) {
      thumbSpin.setFromAxisAngle(zAxis, -arm.side * THUMB_AIM);
      bone.quaternion.multiply(thumbSpin);
    } else if (bone.name.startsWith("Thumb_2")) {
      thumbSpin.setFromAxisAngle(xAxis, THUMB_KNUCKLE_STRAIGHT);
      bone.quaternion.multiply(thumbSpin);
    } else if (bone.name.startsWith("Thumb_1")) {
      thumbSpin.setFromAxisAngle(xAxis, THUMB_TIP_STRAIGHT);
      bone.quaternion.multiply(thumbSpin);
    } else if (!digit.thumb) {
      spin.setFromAxisAngle(zAxis, -arm.side * (digit.claw + arm.squeeze * (digit.wrap - digit.claw)));
      bone.quaternion.multiply(spin);
      if (digit.fan !== 0) {
        spin.setFromAxisAngle(xAxis, digit.fan * (1 - arm.squeeze));
        bone.quaternion.multiply(spin);
      }
    }
  }
}

function syncArm(arm: Arm) {
  arm.hand.getWorldPosition(handPosition);
  arm.hand.getWorldQuaternion(handQuaternion);
  arm.body.setNextKinematicTranslation({ x: handPosition.x, y: handPosition.y, z: handPosition.z });
  arm.body.setNextKinematicRotation({
    x: handQuaternion.x,
    y: handQuaternion.y,
    z: handQuaternion.z,
    w: handQuaternion.w,
  });

  handInverse.copy(handQuaternion).invert();
  for (const tip of arm.tips) {
    tip.bone.getWorldPosition(tipPosition);
    tip.bone.getWorldQuaternion(tipQuaternion);
    // The body is unscaled, so the offset must stay in metres: worldToLocal on the bone
    // would divide by the rig's model scale and fling the collider metres away.
    tipPosition.sub(handPosition).applyQuaternion(handInverse);
    tipQuaternion.premultiply(handInverse);
    tip.collider.setTranslationWrtParent({ x: tipPosition.x, y: tipPosition.y, z: tipPosition.z });
    tip.collider.setRotationWrtParent({
      x: tipQuaternion.x,
      y: tipQuaternion.y,
      z: tipQuaternion.z,
      w: tipQuaternion.w,
    });
  }
}
