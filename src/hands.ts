import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { input } from "./input";
import type { Sense } from "./sim/reactions";
import { BEAKER_RADIUS, type Beaker } from "./lab";

const MODEL_URL = "/models/fps-arm-rig.glb";
const MODEL_SCALE = 0.0046;
const POUR_SENS = 0.007;
// About 120 degrees, past horizontal, so a vessel can be emptied.
const POUR_LIMIT = 2.1;
const SLOW_POUR = 0.08;
const HAND_LERP = 9;
const SQUEEZE_LERP = 18;
const DROP_ANGLE = 1.35;
// A chain of segments following a circle of radius R turns by segment/R at each joint,
// so deriving each joint's curl from its own bone length wraps the fingers around a
// cylinder of that radius instead of rolling them into a fist. The slack lets the
// fingertips settle on the glass rather than driving through it.
const GRIP_RADIUS = BEAKER_RADIUS * 1.15;
const MAX_JOINT_CURL = 1.6;
// Fingertip spheres. Small enough that a pad has to actually meet the glass.
export const PAD_RADIUS = 0.008;
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
// Palms meet this far apart when F brings the left hand in from the side.
const PALM_GAP = BEAKER_RADIUS * 2;
// Mass of the soft left hand. Heavy enough that a full pot doesn't flick it away.
const LEFT_MASS = 1.1;
// Push of the left hand into a large vessel, in newtons. Friction here combines to the
// hand's 2.2, so the push needed scales with the vessel's weight over that.
const GRIP_FRICTION = 2.2;
const GRIP_MARGIN = 2;
const MIN_GRIP_FORCE = 12;
const MAX_GRIP_FORCE = 80;

const HAND_GROUP = 0x0004;
const WORLD_GROUP = 0x0002;
const PROP_GROUP = 0x0008;

function collisionGroups(membership: number, filter: number) {
  return (filter << 16) | membership;
}

type Digit = {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  length: number;
  claw: number; // curl held by the open hand
  fan: number; // knuckle splay, open hand only
  thumb: boolean;
};

export type Pad = {
  id: string;
  bone: THREE.Bone;
  collider: RAPIER.Collider;
  curl: number;
  blocked: boolean;
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
  colliders: RAPIER.Collider[];
  // Curl target radius. A nearby beaker replaces the default fist.
  gripRadius: number;
  // Pads that close on a prop. Curl stops when a pad meets the glass.
  pads: Pad[];
  fingertip: THREE.Bone;
  solid: boolean;
  // The left hand is a dynamic body pulled toward the pose. The pull is strong
  // enough to carry a full beaker and soft enough that the glass can stop it.
  driven: boolean;
};

export type Hands = {
  model: THREE.Object3D;
  arm: Arm;
  left: Arm;
  leftMesh: THREE.SkinnedMesh;
  // 0 is the right hand alone. 1 has faded the left arm in beside it.
  pair: number;
  leftShoulder: THREE.Bone;
  leftShoulderRest: THREE.Vector3;
  // Tilt of a held beaker in the player's frame: roll tips it left and right, pitch
  // tips it away from and toward the player.
  pourRoll: number;
  pourPitch: number;
  // Side grip the left hand is reaching for, and the mass of a large vessel in reach.
  aiming: boolean;
  aimPoint: THREE.Vector3;
  gripMass: number;
  // A large beaker is carried between the hands. The fingers are only visual then.
  carrying: boolean;
  skin: THREE.MeshStandardMaterial[];
  tremor: number;
  clock: number;
};

const SKIN = new THREE.Color(0xd2a07a);
const SKIN_TARGET = new THREE.Color();

// Both arms live in one skinned mesh. The left triangles move to their own mesh so
// that arm can fade in on its own. reach.ts parents and places the model.
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

  const leftMesh = splitLeftArm(model);
  const skin: THREE.MeshStandardMaterial[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) skin.push(material);
    }
  });
  const leftShoulder = findBone(model, "ShoulderL");
  model.updateMatrixWorld(true);
  const left = createArm(model, world, -1, WORLD_GROUP | PROP_GROUP, true);
  left.raised = false;
  left.blend = 0;
  setArmSolid(left, false);
  return {
    model,
    arm: createArm(model, world, 1, WORLD_GROUP | PROP_GROUP, false),
    left,
    leftMesh,
    pair: 0,
    leftShoulder,
    leftShoulderRest: leftShoulder.position.clone(),
    pourRoll: 0,
    pourPitch: 0,
    aiming: false,
    aimPoint: new THREE.Vector3(),
    skin,
    tremor: 0,
    clock: 0,
    gripMass: 0,
    carrying: false,
  };
}

// Moves every triangle bound mostly to the left shoulder chain onto a second skinned
// mesh that shares the skeleton, so its opacity can fade on its own.
function splitLeftArm(model: THREE.Object3D) {
  const left = new Set<THREE.Object3D>();
  findBone(model, "ShoulderL").traverse((object) => left.add(object));
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh);
  });
  let leftMesh: THREE.SkinnedMesh | undefined;
  for (const mesh of meshes) {
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
    const moved: number[] = [];
    for (let i = 0; i < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      const dest = leftVertex(a) || leftVertex(b) || leftVertex(c) ? moved : keep;
      dest.push(a, b, c);
    }
    if (moved.length === 0) continue;
    geometry.setIndex(keep);
    const leftGeometry = geometry.clone();
    leftGeometry.setIndex(moved);
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const material = (source as THREE.MeshStandardMaterial).clone();
    material.transparent = true;
    material.opacity = 0;
    material.depthWrite = false;
    const split = new THREE.SkinnedMesh(leftGeometry, material);
    split.name = "LeftArm";
    split.frustumCulled = false;
    split.castShadow = false;
    split.visible = false;
    split.position.copy(mesh.position);
    split.quaternion.copy(mesh.quaternion);
    split.scale.copy(mesh.scale);
    split.bind(mesh.skeleton, mesh.bindMatrix);
    mesh.parent?.add(split);
    leftMesh = split;
  }
  if (!leftMesh) throw new Error("Missing left arm");
  return leftMesh;
}

function createArm(model: THREE.Object3D, world: RAPIER.World, side: -1 | 1, filter: number, driven: boolean): Arm {
  const tag = side === 1 ? "R" : "L";
  const upper = findBone(model, `Upper_Arm${tag}`);
  const elbow = findBone(model, `Elbow${tag}`);
  const hand = findBone(model, `Hand${tag}`);
  const digits = fingerBones(model, tag).map(describeDigit);

  // A driven hand has real mass. Gravity stays off; the pose spring carries it.
  const body = world.createRigidBody(
    driven
      ? RAPIER.RigidBodyDesc.dynamic().setGravityScale(0).setCanSleep(false).setCcdEnabled(true).setLinearDamping(0.4)
      : RAPIER.RigidBodyDesc.kinematicPositionBased(),
  );
  if (driven) body.setAdditionalMass(LEFT_MASS, true);
  const groups = collisionGroups(HAND_GROUP, filter);
  const colliders: RAPIER.Collider[] = [];
  const solid = (desc: RAPIER.ColliderDesc) => {
    const collider = world.createCollider(
      desc
        .setFriction(2.2)
        .setRestitution(0.02)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(groups),
      body,
    );
    colliders.push(collider);
    return collider;
  };
  // A thin pad on the palm. The old box was a mitten: 7cm by 10cm by 4cm.
  solid(RAPIER.ColliderDesc.cuboid(0.018, 0.028, 0.007).setTranslation(0, 0.045, 0));
  const pads = ["Thumb", "Index", "Middle", "Ring", "Little"].map((name) => ({
    id: name.toLowerCase(),
    bone: findBone(model, `${name}_1${tag}`),
    collider: solid(RAPIER.ColliderDesc.ball(PAD_RADIUS)),
    curl: 0,
    blocked: false,
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
    colliders,
    gripRadius: GRIP_RADIUS,
    pads,
    fingertip: pads[2].bone,
    solid: true,
    driven,
  };
}

function setArmSolid(arm: Arm, solid: boolean) {
  if (arm.solid === solid) return;
  arm.solid = solid;
  for (const collider of arm.colliders) collider.setEnabled(solid);
}

function describeDigit(bone: THREE.Bone): Digit {
  const thumb = bone.name.startsWith("Thumb");
  const knuckle = bone.name.startsWith("Thumb_3") || /^(Index|Middle|Ring|Little)_3/.test(bone.name);
  const digit = bone.name.slice(0, bone.name.indexOf("_"));
  return {
    bone,
    rest: bone.quaternion.clone(),
    length: segmentLength(bone),
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
const zAxis = new THREE.Vector3(0, 0, 1);
const handPosition = new THREE.Vector3();
const handQuaternion = new THREE.Quaternion();
const handInverse = new THREE.Quaternion();
const tipPosition = new THREE.Vector3();
const tipQuaternion = new THREE.Quaternion();
const parentQuat = new THREE.Quaternion();
const handQuat = new THREE.Quaternion();
const playerQuat = new THREE.Quaternion();
const pourQ = new THREE.Quaternion();
const invPlayer = new THREE.Quaternion();
const desired = new THREE.Quaternion();
const tiltEuler = new THREE.Euler(0, 0, 0, "XZY");

export function tintSkin(hands: Hands, sense: Sense) {
  hands.tremor = sense.spasm;
  SKIN_TARGET.setRGB(sense.skin[0], sense.skin[1], sense.skin[2]);
  for (const material of hands.skin) material.color.copy(SKIN).lerp(SKIN_TARGET, sense.flush);
}

export function updateHands(hands: Hands, beakers: Beaker[], dt: number, sense?: Sense) {
  hands.clock += dt;
  hands.tremor = sense?.spasm ?? 0;
  if (input.toggle) {
    input.gripLocked = !input.gripLocked;
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

  if (input.pairToggle) {
    hands.left.raised = !hands.left.raised;
    input.pairToggle = false;
  }
  const pairTarget = hands.left.raised ? 1 : 0;
  hands.pair += (pairTarget - hands.pair) * (1 - Math.exp(-HAND_LERP * dt));

  const squeezing = input.squeeze || input.gripLocked;
  const showing = hands.left.raised || hands.pair > 0.02;
  if (showing) hands.left.blend = 1;
  const grip = showing && hands.left.raised && findSideGrip(hands, beakers);
  if (grip) hands.left.gripRadius = gripRadius;
  hands.aiming = grip;
  if (grip) hands.aimPoint.copy(gripPoint);
  hands.gripMass = showing && hands.left.raised ? nearestHeavy(hands, beakers) : 0;
  // F closes both hands only once the beaker is actually carried. Curling on the
  // way in is what knocks it off the bench.
  const paired = hands.left.raised && hands.carrying;
  poseArm(hands.arm, dt, squeezing, false, paired ? 1 : 0);
  poseArm(hands.left, dt, squeezing || paired, showing);
  hands.model.updateMatrixWorld(true);
  const material = hands.leftMesh.material as THREE.MeshStandardMaterial;
  material.opacity = hands.pair;
  material.depthWrite = hands.pair > 0.85;
  hands.leftMesh.visible = hands.pair > 0.02;
  hands.leftMesh.castShadow = hands.pair > 0.35;
  // The fade is only the mesh. The hand is solid as soon as F brings it in,
  // so the grip is physics for the whole approach.
  setArmSolid(hands.left, hands.left.raised && hands.pair > 0.05);
  if (sense) tintSkin(hands, sense);
  hands.model.updateMatrixWorld(true);
  applyWristPour(hands);
  hands.model.updateMatrixWorld(true);
  syncArm(hands.arm);
  if (!hands.left.driven) syncArm(hands.left);
}

const tipA = new THREE.Vector3();
const tipB = new THREE.Vector3();
const across = new THREE.Vector3();
const shoulderAt = new THREE.Vector3();
const gripPoint = new THREE.Vector3();
const fingerAxis = new THREE.Vector3();
let gripRadius = PALM_GAP * 0.5;

// The side grip of a wide vessel near the right hand. The left hand goes to
// that grip, not to the far side of the body.
function findSideGrip(hands: Hands, beakers: Beaker[]) {
  hands.arm.hand.getWorldPosition(tipA);
  const parent = hands.model.parent;
  if (parent) parent.getWorldQuaternion(handQuat);
  let found = false;
  let best = 0.3;
  for (const beaker of beakers) {
    if (beaker.radius <= BEAKER_RADIUS) continue;
    const at = beaker.body.translation();
    shoulderAt.set(at.x, at.y, at.z);
    const handle = beaker.handles[0];
    if (handle) {
      const rotation = beaker.body.rotation();
      parentQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
      tipB.copy(handle.center).applyQuaternion(parentQuat).add(shoulderAt);
      const distance = tipA.distanceTo(tipB);
      if (distance < best) {
        best = distance;
        found = true;
        gripPoint.copy(tipB);
        gripRadius = handle.radius * 1.08;
      }
      continue;
    }
    if (!parent) continue;
    // The left hand comes from the player's left and stops on the outside of the wall.
    across.set(-1, 0, 0).applyQuaternion(handQuat);
    across.y = 0;
    if (across.lengthSq() < 1e-6) continue;
    across.normalize();
    const surface = tipA.distanceTo(shoulderAt) - beaker.radius;
    if (surface > 0.22 || surface >= best) continue;
    best = surface;
    found = true;
    gripPoint.copy(shoulderAt).addScaledVector(across, beaker.radius + 0.02);
    const low = at.y - beaker.height / 2 + 0.03;
    const high = at.y + beaker.height / 2 - 0.02;
    gripPoint.y = Math.min(high, Math.max(low, tipA.y));
    gripRadius = 0.05;
  }
  return found;
}

// Mass of the nearest large vessel. A full one is mostly liquid, so the grip
// scales off the body, not the empty glass.
function nearestHeavy(hands: Hands, beakers: Beaker[]) {
  hands.arm.hand.getWorldPosition(tipA);
  let best = 0.55;
  let mass = 0;
  for (const beaker of beakers) {
    if (beaker.radius <= BEAKER_RADIUS) continue;
    const at = beaker.body.translation();
    const distance = tipA.distanceTo(tipB.set(at.x, at.y, at.z));
    if (distance < best) {
      best = distance;
      mass = beaker.body.mass();
    }
  }
  return mass;
}

// Slides the whole left arm sideways. Joint angles stay the chimeric pose.
function placeLeft(hands: Hands, grip: THREE.Vector3 | null, amount: number) {
  const shoulder = hands.leftShoulder;
  shoulder.position.copy(hands.leftShoulderRest);
  if (amount < 0.02) return;
  const parent = hands.model.parent;
  const shoulderParent = shoulder.parent;
  if (!parent || !shoulderParent) return;
  hands.model.updateMatrixWorld(true);
  hands.left.hand.getWorldPosition(tipB);
  hands.arm.hand.getWorldPosition(tipA);
  if (grip) {
    hands.left.hand.getWorldQuaternion(handQuat);
    fingerAxis.set(0, 1, 0).applyQuaternion(handQuat);
    // The grip sits in the palm, where a small beaker would.
    across.copy(grip).addScaledVector(fingerAxis, -0.03);
  } else {
    parent.getWorldQuaternion(parentQuat);
    across.set(-1, 0, 0).applyQuaternion(parentQuat).multiplyScalar(PALM_GAP).add(tipA);
  }
  across.sub(tipB).multiplyScalar(amount);
  shoulder.getWorldPosition(shoulderAt);
  shoulderAt.add(across);
  shoulderParent.worldToLocal(shoulderAt);
  shoulder.position.copy(shoulderAt);
}

const savedShoulder = new THREE.Vector3();
const leftTarget = new THREE.Vector3();
const palmShift = new THREE.Vector3();
const vesselAxis = new THREE.Vector3();
const vesselRel = new THREE.Vector3();
const vesselQuat = new THREE.Quaternion();

// Pulls the dynamic left hand toward the same pose placeLeft would use.
// Clear air is that pose exactly. A large beaker stops the hand and the
// squeeze scales with how heavy the glass is.
export function driveLeftHand(hands: Hands, beakers: Beaker[], dt: number) {
  const arm = hands.left;
  if (!arm.driven) return;
  const shoulder = hands.leftShoulder;
  const amount = hands.left.raised || hands.pair > 0.02 ? hands.pair : 0;
  const aim = hands.aiming ? hands.aimPoint : null;
  savedShoulder.copy(shoulder.position);
  placeLeft(hands, aim, amount);
  hands.model.updateMatrixWorld(true);
  arm.hand.getWorldPosition(leftTarget);
  clearOfVessel(beakers, leftTarget);
  arm.hand.getWorldQuaternion(handQuaternion);
  if (!arm.solid) {
    parkLeft(arm, leftTarget);
    return;
  }
  shoulder.position.copy(savedShoulder);
  hands.model.updateMatrixWorld(true);
  arm.hand.getWorldPosition(handPosition);
  palmShift.set(0, 0.045, 0).applyQuaternion(handQuaternion);
  const hitMass = sampleMass(arm, beakers, leftTarget, handPosition, palmShift);
  if (hitMass <= 0 && !leftBlocked) {
    placeLeft(hands, aim, amount);
    hands.model.updateMatrixWorld(true);
    parkLeft(arm, leftTarget);
    return;
  }
  const free = hitMass > 0 ? freeApproach(arm, beakers, handPosition, leftTarget, palmShift) : handPosition;
  arm.body.setTranslation({ x: handPosition.x, y: handPosition.y, z: handPosition.z }, true);
  arm.body.setRotation({ x: handQuaternion.x, y: handQuaternion.y, z: handQuaternion.z, w: handQuaternion.w }, true);
  syncPads(arm);
  arm.body.setTranslation({ x: free.x, y: free.y, z: free.z }, true);
  across.subVectors(leftTarget, free);
  const dist = across.length();
  const mass = Math.max(0.2, arm.body.mass());
  // Once the joint has the beaker, the hand just rests on the glass.
  const gripForce = hands.carrying ? 0 : leftGripForce(hands.gripMass);
  const step = dist < 1e-4 || dt < 1e-4 ? 0 : Math.min(dist / dt, (gripForce * dt) / mass);
  if (dist > 1e-4) across.multiplyScalar(step / dist);
  else across.set(0, 0, 0);
  arm.body.setLinvel({ x: across.x, y: across.y, z: across.z }, true);
  arm.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  arm.body.wakeUp();
}

// Enough that friction at both palms holds the vessel's weight with margin to spare.
// An empty pot still gets the light touch, so it isn't knocked off the bench.
function leftGripForce(mass: number) {
  const hold = (mass * 9.81 * GRIP_MARGIN) / (2 * GRIP_FRICTION);
  return Math.min(MAX_GRIP_FORCE, Math.max(MIN_GRIP_FORCE, hold));
}

function parkLeft(arm: Arm, at: THREE.Vector3) {
  arm.body.setTranslation({ x: at.x, y: at.y, z: at.z }, true);
  arm.body.setRotation({ x: handQuaternion.x, y: handQuaternion.y, z: handQuaternion.z, w: handQuaternion.w }, true);
  arm.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  arm.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  syncPads(arm);
}

function freeApproach(arm: Arm, beakers: Beaker[], from: THREE.Vector3, to: THREE.Vector3, shift: THREE.Vector3) {
  let lo = 0;
  let hi = 1;
  if (sampleMass(arm, beakers, from, from, shift) <= 0) {
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      probe.lerpVectors(from, to, mid);
      if (sampleMass(arm, beakers, probe, from, shift) > 0) hi = mid;
      else lo = mid;
    }
  }
  return probe.lerpVectors(from, to, lo);
}

const probe = new THREE.Vector3();
const palmProbe = new THREE.Vector3();

function sampleMass(arm: Arm, beakers: Beaker[], at: THREE.Vector3, origin: THREE.Vector3, shift: THREE.Vector3) {
  let mass = vesselMass(beakers, at);
  palmProbe.copy(at).add(shift);
  mass = Math.max(mass, vesselMass(beakers, palmProbe));
  for (const pad of arm.pads) {
    pad.bone.getWorldPosition(tipA);
    tipA.add(at).sub(origin);
    mass = Math.max(mass, vesselMass(beakers, tipA));
  }
  return mass;
}

// The pose target can sit in the cavity of a wide pot. Put it back on the outside
// of the wall so the hand is not driven through the glass.
function clearOfVessel(beakers: Beaker[], point: THREE.Vector3) {
  for (const beaker of beakers) {
    if (beaker.radius <= BEAKER_RADIUS) continue;
    const at = beaker.body.translation();
    const rotation = beaker.body.rotation();
    vesselQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    vesselAxis.set(0, 1, 0).applyQuaternion(vesselQuat);
    vesselRel.set(point.x - at.x, point.y - at.y, point.z - at.z);
    const axial = vesselRel.dot(vesselAxis);
    vesselRel.addScaledVector(vesselAxis, -axial);
    if (Math.abs(axial) > beaker.height / 2) continue;
    const radial = vesselRel.length();
    const limit = beaker.radius + 0.02;
    if (radial >= limit) continue;
    if (radial < 1e-4) vesselRel.set(1, 0, 0);
    else vesselRel.multiplyScalar(limit / radial);
    point.set(at.x, at.y, at.z).addScaledVector(vesselAxis, axial).add(vesselRel);
  }
}

function ejectLeft(arm: Arm, beakers: Beaker[]) {
  const at = arm.body.translation();
  handPosition.set(at.x, at.y, at.z);
  const rotation = arm.body.rotation();
  handQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  let push = 0;
  vesselRel.set(0, 0, 0);
  const sample = (x: number, y: number, z: number) => {
    const out = outsidePush(beakers, handPosition.x + x, handPosition.y + y, handPosition.z + z);
    if (out > push) {
      push = out;
      vesselAxis.copy(vesselRel);
    }
  };
  sample(0, 0, 0);
  palmShift.set(0, 0.045, 0).applyQuaternion(handQuaternion);
  sample(palmShift.x, palmShift.y, palmShift.z);
  for (const pad of arm.pads) {
    const local = pad.collider.translation();
    palmShift.set(local.x, local.y, local.z).applyQuaternion(handQuaternion);
    sample(palmShift.x, palmShift.y, palmShift.z);
  }
  if (push < 1e-4) return;
  handPosition.addScaledVector(vesselAxis, push);
  arm.body.setTranslation({ x: handPosition.x, y: handPosition.y, z: handPosition.z }, true);
  arm.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
}

// How far a point sits inside a large pot, and the horizontal direction back out.
// `vesselRel` is overwritten with that direction. Returns 0 when the point is outside.
function outsidePush(beakers: Beaker[], x: number, y: number, z: number) {
  let push = 0;
  for (const beaker of beakers) {
    if (beaker.radius <= BEAKER_RADIUS) continue;
    const at = beaker.body.translation();
    const rotation = beaker.body.rotation();
    vesselQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    const axis = fingerAxis.set(0, 1, 0).applyQuaternion(vesselQuat);
    const relX = x - at.x;
    const relY = y - at.y;
    const relZ = z - at.z;
    const axial = relX * axis.x + relY * axis.y + relZ * axis.z;
    if (Math.abs(axial) > beaker.height / 2) continue;
    const rx = relX - axis.x * axial;
    const ry = relY - axis.y * axial;
    const rz = relZ - axis.z * axial;
    const radial = Math.hypot(rx, ry, rz);
    const need = beaker.radius + 0.012 - radial;
    if (need <= push) continue;
    push = need;
    if (radial < 1e-4) vesselRel.set(1, 0, 0);
    else vesselRel.set(rx / radial, ry / radial, rz / radial);
  }
  return push;
}

function vesselMass(beakers: Beaker[], sample: THREE.Vector3) {
  let mass = 0;
  for (const beaker of beakers) {
    if (beaker.radius <= BEAKER_RADIUS) continue;
    const at = beaker.body.translation();
    const rotation = beaker.body.rotation();
    vesselQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
    vesselAxis.set(0, 1, 0).applyQuaternion(vesselQuat);
    vesselRel.set(sample.x - at.x, sample.y - at.y, sample.z - at.z);
    const axial = vesselRel.dot(vesselAxis);
    vesselRel.addScaledVector(vesselAxis, -axial);
    if (Math.abs(axial) > beaker.height / 2 + 0.025) continue;
    if (vesselRel.length() < beaker.radius + 0.016) mass = Math.max(mass, beaker.body.mass());
  }
  return mass;
}

let leftBlocked = false;

// After the step, the mesh goes where the soft hand actually stopped.
export function followLeftHand(hands: Hands, beakers: Beaker[], world: RAPIER.World) {
  const arm = hands.left;
  if (!arm.driven || !arm.solid) {
    leftBlocked = false;
    return;
  }
  leftBlocked = false;
  for (const collider of arm.colliders) {
    world.contactPairsWith(collider, (other) => {
      const membership = other.collisionGroups() & 0xffff;
      if (membership & (WORLD_GROUP | PROP_GROUP)) leftBlocked = true;
    });
  }
  // The carried pot does not collide with the hands, so a bump can leave the
  // left hand in the cavity. Put it back on the outside before the mesh follows.
  ejectLeft(arm, beakers);
  const at = arm.body.translation();
  arm.hand.getWorldPosition(tipB);
  across.set(at.x - tipB.x, at.y - tipB.y, at.z - tipB.z);
  if (across.lengthSq() < 1e-10) return;
  const shoulder = hands.leftShoulder;
  const shoulderParent = shoulder.parent;
  if (!shoulderParent) return;
  shoulder.getWorldPosition(shoulderAt);
  shoulderAt.add(across);
  shoulderParent.worldToLocal(shoulderAt);
  shoulder.position.copy(shoulderAt);
  hands.model.updateMatrixWorld(true);
}

function clampPour(angle: number) {
  return Math.max(-POUR_LIMIT, Math.min(POUR_LIMIT, angle));
}

function poseArm(arm: Arm, dt: number, squeezing: boolean, lockBlend: boolean, assist = 0) {
  if (!lockBlend) {
    const raised = arm.raised ? 1 : 0;
    arm.blend += (raised - arm.blend) * (1 - Math.exp(-HAND_LERP * dt));
  }
  const squeezeTarget = squeezing ? 1 : 0;
  const curlTarget = Math.max(squeezeTarget, assist);
  const close = 1 - Math.exp(-SQUEEZE_LERP * dt);
  arm.squeeze += (squeezeTarget - arm.squeeze) * close;
  for (const pad of arm.pads) {
    // A pad that has met the glass stops. Opening still plays.
    if (pad.blocked && curlTarget > pad.curl) continue;
    pad.curl += (curlTarget - pad.curl) * close;
  }

  armSpread(arm);

  arm.hand.quaternion.copy(arm.restHand);

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
      const curl = padCurl(arm, bone.name);
      const wrap = Math.min(MAX_JOINT_CURL, digit.length / arm.gripRadius);
      spin.setFromAxisAngle(zAxis, -arm.side * (digit.claw + curl * (wrap - digit.claw)));
      bone.quaternion.multiply(spin);
      if (digit.fan !== 0) {
        spin.setFromAxisAngle(xAxis, digit.fan * (1 - curl));
        bone.quaternion.multiply(spin);
      }
    }
  }
}

function armSpread(arm: Arm) {
  const drop = (1 - arm.blend) * DROP_ANGLE;
  upperPose.copy(arm.restUpper);
  spin.setFromAxisAngle(zAxis, arm.side * SPLAY_ANGLE);
  upperPose.multiply(spin);
  spin.setFromAxisAngle(xAxis, drop);
  upperPose.multiply(spin);
  arm.upper.quaternion.copy(upperPose);
  spin.setFromAxisAngle(xAxis, drop * 0.65);
  arm.elbow.quaternion.copy(arm.restElbow).multiply(spin);
}

function padCurl(arm: Arm, boneName: string) {
  const id = boneName.slice(0, boneName.indexOf("_")).toLowerCase();
  const pad = arm.pads.find((item) => item.id === id);
  return pad ? pad.curl : arm.squeeze;
}

// Pour is a rotation in the player's frame, laid on top of the posed wrist, so pitch
// tips the glass away and roll tips it sideways. The same delta turns a held beaker.
function applyWristPour(hands: Hands) {
  const hand = hands.arm.hand;
  const parent = hand.parent;
  const player = hands.model.parent;
  if (!parent || !player) return;
  parent.getWorldQuaternion(parentQuat);
  hand.getWorldQuaternion(handQuat);
  player.getWorldQuaternion(playerQuat);
  const twitch = hands.tremor * 0.9;
  const time = hands.clock;
  tiltEuler.set(
    hands.pourPitch + Math.sin(time * 23) * twitch,
    Math.sin(time * 17) * twitch * 0.35,
    hands.pourRoll + Math.sin(time * 31) * twitch,
  );
  pourQ.setFromEuler(tiltEuler);
  invPlayer.copy(playerQuat).invert();
  desired.copy(playerQuat).multiply(pourQ).multiply(invPlayer).multiply(handQuat);
  hand.quaternion.copy(parentQuat.invert()).multiply(desired);
}

const WORLD_QUERY = (WORLD_GROUP << 16) | 0xffff;
const SURFACE_SKIN = 0.02;
const SURFACE_REACH = 0.5;
const palmLocal = new THREE.Vector3(0, 0.045, 0);
const sample = new THREE.Vector3();
const surfaceRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
const worldPush = new THREE.Vector3();
const localPush = new THREE.Vector3();

// The wrist follows the look arc, which does not know about the counter. Keep the
// palm and fingertips on top of the benches instead of letting the mesh sink in.
export function settleHand(hands: Hands, world: RAPIER.World) {
  const parent = hands.model.parent;
  if (!parent) return;
  let moved = false;
  for (let pass = 0; pass < 3; pass++) {
    worldPush.set(0, 0, 0);
    let lift = 0;
    let slide = 0;
    const consider = (arm: Arm) => {
      if (!arm.solid && arm.side === -1) return;
      if (arm.driven) return;
      const sampleArm = (x: number, y: number, z: number) => {
        surfaceRay.origin.x = x;
        surfaceRay.origin.y = y + SURFACE_REACH;
        surfaceRay.origin.z = z;
        const hit = world.castRayAndGetNormal(
          surfaceRay,
          SURFACE_REACH + 0.05,
          false,
          0 as RAPIER.QueryFilterFlags,
          WORLD_QUERY,
          undefined,
          hands.arm.body,
        );
        if (hit && hit.normal.y > 0.55) {
          const surface = surfaceRay.origin.y - hit.timeOfImpact;
          lift = Math.max(lift, surface + SURFACE_SKIN - y);
        }
        const projection = world.projectPoint(
          { x, y, z },
          false,
          0 as RAPIER.QueryFilterFlags,
          WORLD_QUERY,
          undefined,
          hands.arm.body,
        );
        if (!projection?.isInside) return;
        const px = projection.point.x;
        const py = projection.point.y;
        const pz = projection.point.z;
        const dx = px - x;
        const dy = py - y;
        const dz = pz - z;
        const horizontal = Math.hypot(dx, dz);
        if (horizontal < 1e-4 || Math.abs(dy) > horizontal) return;
        const length = Math.hypot(dx, dy, dz);
        if (length <= slide) return;
        slide = length;
        const scale = (length + SURFACE_SKIN) / length;
        worldPush.set(dx * scale, Math.max(0, dy * scale), dz * scale);
      };
      arm.hand.getWorldPosition(sample);
      arm.hand.getWorldQuaternion(handQuat);
      sample.add(tipPosition.copy(palmLocal).applyQuaternion(handQuat));
      sampleArm(sample.x, sample.y, sample.z);
      for (const pad of arm.pads) {
        pad.bone.getWorldPosition(sample);
        sampleArm(sample.x, sample.y, sample.z);
      }
    };
    consider(hands.arm);
    consider(hands.left);
    worldPush.y = Math.max(worldPush.y, lift);
    if (worldPush.lengthSq() < 1e-8) break;
    parent.getWorldQuaternion(parentQuat);
    hands.model.position.add(localPush.copy(worldPush).applyQuaternion(parentQuat.invert()));
    hands.model.updateMatrixWorld(true);
    moved = true;
  }
  if (moved) {
    syncArm(hands.arm);
    syncArm(hands.left);
  }
}

function syncArm(arm: Arm) {
  arm.hand.getWorldPosition(handPosition);
  arm.hand.getWorldQuaternion(handQuaternion);
  if (!arm.driven) {
    arm.body.setNextKinematicTranslation({ x: handPosition.x, y: handPosition.y, z: handPosition.z });
    arm.body.setNextKinematicRotation({
      x: handQuaternion.x,
      y: handQuaternion.y,
      z: handQuaternion.z,
      w: handQuaternion.w,
    });
  }
  syncPads(arm);
}

function syncPads(arm: Arm) {
  arm.hand.getWorldPosition(handPosition);
  arm.hand.getWorldQuaternion(handQuaternion);
  handInverse.copy(handQuaternion).invert();
  for (const tip of arm.pads) {
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
