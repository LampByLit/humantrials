import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { input } from "./input";
import { BEAKER_RADIUS } from "./lab";

const MODEL_URL = "/models/fps-arm-rig.glb";
const MODEL_SCALE = 0.0046;
const POUR_SENS = 0.007;
const POUR_LIMIT = 1.15;
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
// How far the left shoulder can swing across. A second aim then lowers it onto
// the right fingertips and stops when they meet. The right arm is not part of this.
const LEFT_PINCH = 1.15;
// Bone-centre gap at which the fingertip skins meet. Closer than this and the
// fingers pass through each other.
const TIP_GAP = 0.028;

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
};

export type Hands = {
  model: THREE.Object3D;
  arm: Arm;
  left: Arm;
  leftMesh: THREE.SkinnedMesh;
  // 0 is the right hand alone. 1 brings the left arm in until the fingertips meet.
  pair: number;
  // Tilt of a held beaker in the player's frame: roll tips it left and right, pitch
  // tips it away from and toward the player.
  pourRoll: number;
  pourPitch: number;
};

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
  model.updateMatrixWorld(true);
  const left = createArm(model, world, -1, WORLD_GROUP);
  left.raised = false;
  left.blend = 0;
  setArmSolid(left, false);
  return { model, arm: createArm(model, world, 1, WORLD_GROUP | PROP_GROUP), left, leftMesh, pair: 0, pourRoll: 0, pourPitch: 0 };
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

function createArm(model: THREE.Object3D, world: RAPIER.World, side: -1 | 1, filter: number): Arm {
  const tag = side === 1 ? "R" : "L";
  const upper = findBone(model, `Upper_Arm${tag}`);
  const elbow = findBone(model, `Elbow${tag}`);
  const hand = findBone(model, `Hand${tag}`);
  const digits = fingerBones(model, tag).map(describeDigit);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
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
const yAxis = new THREE.Vector3(0, 1, 0);
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

export function updateHands(hands: Hands, dt: number) {
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
  // The right arm does not swing in. This pose is for holding something large
  // between the two hands, and only the left arm comes across to it.
  if (hands.pair > 0.2) holdFingertips(hands);
  poseArm(hands.arm, dt, squeezing, 0);
  poseArm(hands.left, dt, squeezing, hands.pair);
  hands.model.updateMatrixWorld(true);
  clampLeftToTips(hands);
  const material = hands.leftMesh.material as THREE.MeshStandardMaterial;
  material.opacity = hands.pair;
  material.depthWrite = hands.pair > 0.85;
  hands.leftMesh.visible = hands.pair > 0.02;
  hands.leftMesh.castShadow = hands.pair > 0.35;
  // The left hand only meets the bench. It stays out of the beakers, and it is
  // gone entirely while the arm is faded so it cannot knock anything.
  setArmSolid(hands.left, hands.pair > 0.2);
  hands.model.updateMatrixWorld(true);
  applyWristPour(hands);
  hands.model.updateMatrixWorld(true);
  syncArm(hands.arm);
  syncArm(hands.left);
}

const tipA = new THREE.Vector3();
const tipB = new THREE.Vector3();

// A finger that has reached the other hand stops curling, the same way a pad stops
// on glass. Opening still plays.
function holdFingertips(hands: Hands) {
  const block = (arm: Arm, other: Arm) => {
    for (const pad of arm.pads) {
      pad.bone.getWorldPosition(tipA);
      let gap = Infinity;
      for (const tip of other.pads) {
        tip.bone.getWorldPosition(tipB);
        gap = Math.min(gap, tipA.distanceTo(tipB));
      }
      const limit = pad.blocked ? TIP_GAP + 0.008 : TIP_GAP;
      // Only ever sets the stop. Clearing it is aimFingers' job, so a pad that
      // has met a beaker is not released just because the other hand is far.
      if (gap < limit) pad.blocked = true;
    }
  };
  block(hands.arm, hands.left);
  block(hands.left, hands.arm);
}

// The left shoulder swings in until the fingertips meet, and no farther. The right
// arm is already posed and is not moved again.
function clampLeftToTips(hands: Hands) {
  if (hands.pair < 0.02 || fingertipGap(hands) >= TIP_GAP) return;
  let lo = 0;
  let hi = hands.pair;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) * 0.5;
    armSpread(hands.left, mid);
    hands.model.updateMatrixWorld(true);
    if (fingertipGap(hands) < TIP_GAP) hi = mid;
    else lo = mid;
  }
  armSpread(hands.left, lo);
  hands.model.updateMatrixWorld(true);
}

function fingertipGap(hands: Hands) {
  let gap = Infinity;
  for (const left of hands.left.pads) {
    if (left.id === "thumb") continue;
    left.bone.getWorldPosition(tipA);
    for (const right of hands.arm.pads) {
      if (right.id === "thumb") continue;
      right.bone.getWorldPosition(tipB);
      gap = Math.min(gap, tipA.distanceTo(tipB));
    }
  }
  return gap;
}

function clampPour(angle: number) {
  return Math.max(-POUR_LIMIT, Math.min(POUR_LIMIT, angle));
}

function poseArm(arm: Arm, dt: number, squeezing: boolean, pinch: number) {
  if (arm.side === 1) {
    const raised = arm.raised ? 1 : 0;
    arm.blend += (raised - arm.blend) * (1 - Math.exp(-HAND_LERP * dt));
  } else {
    arm.blend = pinch;
  }
  const squeezeTarget = squeezing ? 1 : 0;
  const close = 1 - Math.exp(-SQUEEZE_LERP * dt);
  arm.squeeze += (squeezeTarget - arm.squeeze) * close;
  for (const pad of arm.pads) {
    // A pad that has met the glass stops. Opening still plays.
    if (pad.blocked && squeezeTarget > pad.curl) continue;
    pad.curl += (squeezeTarget - pad.curl) * close;
  }

  armSpread(arm, pinch);

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

function armSpread(arm: Arm, pinch: number) {
  const drop = (1 - arm.blend) * DROP_ANGLE;
  // Only the left arm pinches. A zero pinch leaves the right shoulder on its splay.
  const spread = SPLAY_ANGLE * (1 - pinch) - (arm.side === 1 ? 0 : LEFT_PINCH) * pinch;
  upperPose.copy(arm.restUpper);
  spin.setFromAxisAngle(zAxis, arm.side * spread);
  upperPose.multiply(spin);
  spin.setFromAxisAngle(xAxis, drop);
  upperPose.multiply(spin);
  arm.upper.quaternion.copy(upperPose);
  // Local Y lowers the left hand onto the right fingertips. The shoulder stays a
  // ball joint here; the elbow is left on its hinge so the forearm does not roll.
  if (arm.side === -1 && pinch > 0) {
    spin.setFromAxisAngle(yAxis, -0.5 * pinch);
    arm.upper.quaternion.multiply(spin);
  }
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
  tiltEuler.set(hands.pourPitch, 0, hands.pourRoll);
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
  arm.body.setNextKinematicTranslation({ x: handPosition.x, y: handPosition.y, z: handPosition.z });
  arm.body.setNextKinematicRotation({
    x: handQuaternion.x,
    y: handQuaternion.y,
    z: handQuaternion.z,
    w: handQuaternion.w,
  });

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
