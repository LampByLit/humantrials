import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Arm, Hands } from "./hands";
import { PAD_RADIUS } from "./hands";
import { BEAKER_RADIUS, type Beaker } from "./lab";

const PROP = 0x0008;
const HAND = 0x0004;
const PLAYER = 0x0001;
// A carried pot stays a prop for the room, and stops being one for the body and the hands.
const CARRIED_FILTER = 0xffff ^ HAND ^ PLAYER;
const GRAB_SQUEEZE = 0.35;
const RELEASE_SQUEEZE = 0.22;
// Gap from a pad centre to the glass. The sphere radius plus a couple of millimetres,
// so a grab is a touch and not a magnet.
const TOUCH = PAD_RADIUS + 0.002;
const UNBLOCK = PAD_RADIUS + 0.012;
const FIST_RADIUS = BEAKER_RADIUS * 1.15;
const NEAR = 0.12;
// Palm centres sit back inside the hand, so a face that is on the glass can be a few
// centimetres out by this measure. Fingertips are closer. Deep overlap is rejected below.
const PAIR_TOUCH = 0.038;
// Outward directions at the two contacts. 1 is the same face, 0 is a right angle,
// -1 is opposite. Front and side is how a pot is actually picked up; both on one face is not.
const PAIR_OPPOSE = 0.45;
// A sample this far inside the cylinder is through the wall, not a hand resting on it.
const PAIR_SUNK = 0.02;
// Centre of the palm pad, in the hand bone's frame.
const PALM = new THREE.Vector3(0, 0.045, 0);
// The bench pushes up on a beaker the whole time it is sitting there. That contact
// gets heavy when the hand starts to lift, and it is not the glass being knocked
// out of the fingers. Only a sideways hit, or the hand actually leaving the glass,
// breaks the weld.
const BREAK_SEPARATION = 0.06;
const STUCK_TIME = 0.2;
const BREAK_ANGLE = 1.7;
const BREAK_FORCE = 80;
const GRACE = 0.2;
const SUPPORT_NORMAL = 0.55;

// A one-hand pinch stays a dynamic body on a fixed joint. A pot taken with F is kinematic
// on the hand instead: the joint cannot keep up with a turn or a step, and the body
// was walking into the glass.
type Grip = {
  arm: Arm;
  beaker: Beaker;
  joint: RAPIER.ImpulseJoint;
  anchor1: THREE.Vector3;
  anchor2: THREE.Vector3;
  // Beaker orientation relative to the wrist at the moment of the pinch.
  handRel: THREE.Quaternion;
  age: number;
  stuck: number;
  // Held because F put it between both hands, not because the right hand pinched.
  paired: boolean;
  lastPos: THREE.Vector3;
  velocity: THREE.Vector3;
};

type Quiet = { beaker: Beaker; time: number };

export type Hold = {
  grips: Grip[];
  quiet: Quiet[];
};

const handPos = new THREE.Vector3();
const handQuat = new THREE.Quaternion();
const bodyPos = new THREE.Vector3();
const bodyQuat = new THREE.Quaternion();
const invQuat = new THREE.Quaternion();
const desiredQuat = new THREE.Quaternion();
const point = new THREE.Vector3();
const fingerPos = new THREE.Vector3();
const anchor = new THREE.Vector3();
const axis = new THREE.Vector3();
const rel = new THREE.Vector3();
const beakerPos = new THREE.Vector3();
const beakerAxis = new THREE.Vector3();
// The part of a vessel, body or handle, that the last cylinderGap call found nearest.
const touchPos = new THREE.Vector3();
const touchAxis = new THREE.Vector3();
let touchRadius = 0;
const partPos = new THREE.Vector3();
const partAxis = new THREE.Vector3();
const thumbRadial = new THREE.Vector3();
const fingerRadial = new THREE.Vector3();
const solvedA = new THREE.Vector3();
const solvedB = new THREE.Vector3();
const sideR = new THREE.Vector3();
const sideL = new THREE.Vector3();

export function createHold(): Hold {
  return { grips: [], quiet: [] };
}

export function updateHold(hold: Hold, hands: Hands, beakers: Beaker[], world: RAPIER.World, dt: number) {
  if (dt < 1e-4) return;
  const arm = hands.arm;
  const gripping = hold.grips.find((grip) => grip.arm === arm);

  for (let i = hold.grips.length - 1; i >= 0; i--) {
    const grip = hold.grips[i];
    if (grip.paired) {
      // F is the only release. The pot is kinematic on the hand, so a turn or a step
      // cannot pull the anchors apart and the old separation check must not drop it.
      if (!hands.left.raised) release(hold, grip, world);
      else {
        grip.age += dt;
        snapGrip(grip, dt);
      }
      continue;
    }
    if (grip.arm.squeeze < RELEASE_SQUEEZE || lost(grip, world, dt)) release(hold, grip, world);
    else grip.age += dt;
  }

  // The left hand has been pressing in. Once both hands are on the glass, the pot is
  // locked to the right hand. Squeezing alone is what sends it flying.
  if (hands.left.raised && hands.pair > 0.65 && !hold.grips.some((grip) => grip.arm === arm)) {
    const beaker = betweenHands(hands, hold, beakers);
    if (beaker) {
      const at = beaker.body.translation();
      anchor.set(at.x, at.y, at.z);
      const before = hold.grips.length;
      grab(hold, hands, arm, beaker, world);
      const grip = hold.grips[before];
      if (grip) {
        grip.paired = true;
        lockPaired(grip, world);
      }
    }
  }

  if (!hands.left.raised && arm.squeeze >= GRAB_SQUEEZE && !hold.grips.some((grip) => grip.arm === arm)) {
    const beaker = pinch(arm, hold, beakers);
    if (beaker) grab(hold, hands, arm, beaker, world);
  }
  const carrying = hold.grips.some((grip) => grip.paired);
  if (carrying !== hands.carrying) setCarryBody(hands.left, carrying);
  hands.carrying = carrying;

  settleQuiet(hold, hands, dt);
  const held = hold.grips.find((grip) => grip.arm === arm);
  const reach = hands.left.raised ? 0.28 : NEAR;
  aimFingers(arm, beakers, held?.beaker ?? gripping?.beaker, reach);
  aimFingers(hands.left, beakers, undefined, reach);
}

const turnQuat = new THREE.Quaternion();
const turnVec = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);

// Mouse yaw swings the hands around the body in a single frame, far faster than the weld
// can drag a heavy pot after them. Held glass turns with the body instead.
export function turnHeld(hold: Hold, pivot: THREE.Vector3, yaw: number) {
  if (Math.abs(yaw) < 1e-7) return;
  turnQuat.setFromAxisAngle(upAxis, yaw);
  const turned = new Set<Beaker>();
  for (const grip of hold.grips) {
    // A paired pot is snapped to the hand, which already turned with the body.
    if (grip.paired) continue;
    const body = grip.beaker.body;
    if (turned.has(grip.beaker)) continue;
    turned.add(grip.beaker);
    const at = body.translation();
    turnVec.set(at.x, at.y, at.z).sub(pivot).applyQuaternion(turnQuat).add(pivot);
    body.setTranslation({ x: turnVec.x, y: turnVec.y, z: turnVec.z }, true);
    const rotation = body.rotation();
    bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w).premultiply(turnQuat);
    body.setRotation({ x: bodyQuat.x, y: bodyQuat.y, z: bodyQuat.z, w: bodyQuat.w }, true);
    const v = body.linvel();
    turnVec.set(v.x, v.y, v.z).applyQuaternion(turnQuat);
    body.setLinvel({ x: turnVec.x, y: turnVec.y, z: turnVec.z }, true);
  }
}

function grab(hold: Hold, hands: Hands, arm: Arm, beaker: Beaker, world: RAPIER.World) {
  const parent = hands.model.parent;
  if (!parent) return;
  arm.hand.getWorldPosition(handPos);
  arm.hand.getWorldQuaternion(handQuat);
  const translation = beaker.body.translation();
  bodyPos.set(translation.x, translation.y, translation.z);
  const rotation = beaker.body.rotation();
  bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);

  invQuat.copy(handQuat).invert();
  const anchor1 = point.copy(anchor).sub(handPos).applyQuaternion(invQuat).clone();
  invQuat.copy(bodyQuat).invert();
  const anchor2 = fingerPos.copy(anchor).sub(bodyPos).applyQuaternion(invQuat).clone();

  const invHand = handQuat.clone().invert();
  const invBeaker = bodyQuat.clone().invert();
  const joint = world.createImpulseJoint(
    RAPIER.JointData.fixed(
      { x: anchor1.x, y: anchor1.y, z: anchor1.z },
      { x: invHand.x, y: invHand.y, z: invHand.z, w: invHand.w },
      { x: anchor2.x, y: anchor2.y, z: anchor2.z },
      { x: invBeaker.x, y: invBeaker.y, z: invBeaker.z, w: invBeaker.w },
    ),
    arm.body,
    beaker.body,
    true,
  );
  joint.setContactsEnabled(false);
  // The pads are already on the glass. Leaving them solid shoves the cylinder out,
  // because a kinematic hand has infinite mass. The joint carries it instead.
  setHandCollision(beaker, false);
  const quiet = hold.quiet.findIndex((item) => item.beaker === beaker);
  if (quiet >= 0) hold.quiet.splice(quiet, 1);

  beaker.body.wakeUp();
  hold.grips.push({
    arm,
    beaker,
    joint,
    anchor1,
    anchor2,
    handRel: invQuat.copy(handQuat).invert().multiply(bodyQuat).clone(),
    age: 0,
    stuck: 0,
    paired: false,
    lastPos: bodyPos.clone(),
    velocity: new THREE.Vector3(),
  });
}

// Puts a paired pot on the hand before the arms aim, so the left hand reaches the
// glass that is already moving with the body and not last frame's pot.
export function snapHeld(hold: Hold, dt: number) {
  for (const grip of hold.grips) {
    if (grip.paired) snapGrip(grip, dt);
  }
}

function lockPaired(grip: Grip, world: RAPIER.World) {
  if (grip.joint.isValid()) world.removeImpulseJoint(grip.joint, true);
  const body = grip.beaker.body;
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  body.setGravityScale(0, true);
  setCarriedCollision(grip.beaker);
  const at = body.translation();
  grip.lastPos.set(at.x, at.y, at.z);
  grip.velocity.set(0, 0, 0);
  snapGrip(grip, 0);
}

function setCarryBody(arm: Arm, carried: boolean) {
  const body = arm.body;
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.setGravityScale(0, true);
  body.setBodyType(carried ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
}

function snapGrip(grip: Grip, dt: number) {
  grip.arm.hand.getWorldPosition(handPos);
  grip.arm.hand.getWorldQuaternion(handQuat);
  desiredQuat.copy(handQuat).multiply(grip.handRel);
  solvedA.copy(grip.anchor1).applyQuaternion(handQuat).add(handPos);
  solvedB.copy(grip.anchor2).applyQuaternion(desiredQuat);
  bodyPos.copy(solvedA).sub(solvedB);
  if (dt > 1e-4 && bodyPos.distanceToSquared(grip.lastPos) > 1e-8) {
    grip.velocity.subVectors(bodyPos, grip.lastPos).multiplyScalar(1 / dt);
  }
  grip.lastPos.copy(bodyPos);
  const body = grip.beaker.body;
  body.setTranslation({ x: bodyPos.x, y: bodyPos.y, z: bodyPos.z }, true);
  body.setRotation({ x: desiredQuat.x, y: desiredQuat.y, z: desiredQuat.z, w: desiredQuat.w }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  if (body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased) {
    body.setNextKinematicTranslation({ x: bodyPos.x, y: bodyPos.y, z: bodyPos.z });
    body.setNextKinematicRotation({ x: desiredQuat.x, y: desiredQuat.y, z: desiredQuat.z, w: desiredQuat.w });
  }
}

function setCarriedCollision(beaker: Beaker) {
  for (let i = 0; i < beaker.body.numColliders(); i++) {
    beaker.body.collider(i).setCollisionGroups((CARRIED_FILTER << 16) | PROP);
  }
}

function restoreDynamic(grip: Grip) {
  const body = grip.beaker.body;
  body.setGravityScale(1, true);
  body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  setHandCollision(grip.beaker, false);
  body.setLinvel({ x: grip.velocity.x, y: grip.velocity.y, z: grip.velocity.z }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.wakeUp();
}

function release(hold: Hold, grip: Grip, world: RAPIER.World) {
  if (grip.joint.isValid()) world.removeImpulseJoint(grip.joint, true);
  if (grip.paired) restoreDynamic(grip);
  const index = hold.grips.indexOf(grip);
  if (index >= 0) hold.grips.splice(index, 1);
  // Keep the hand out of the glass until the fingers have opened, or the pads pop it.
  if (!hold.quiet.some((item) => item.beaker === grip.beaker)) {
    hold.quiet.push({ beaker: grip.beaker, time: 0 });
  }
}

function lost(grip: Grip, world: RAPIER.World, dt: number) {
  if (grip.age < GRACE) return false;
  if (separation(grip) > BREAK_SEPARATION) grip.stuck += dt;
  else grip.stuck = 0;
  if (grip.stuck > STUCK_TIME) return true;
  grip.arm.hand.getWorldQuaternion(handQuat);
  const rotation = grip.beaker.body.rotation();
  bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  desiredQuat.copy(handQuat).multiply(grip.handRel);
  if (rotationError(bodyQuat, desiredQuat, axis) > BREAK_ANGLE) return true;
  const mass = grip.beaker.body.mass();
  return sideForce(world, grip) / dt > Math.max(BREAK_FORCE, mass * 9.81 * 8);
}

function separation(grip: Grip) {
  const hand = grip.arm.body.translation();
  handPos.set(hand.x, hand.y, hand.z);
  const handRot = grip.arm.body.rotation();
  handQuat.set(handRot.x, handRot.y, handRot.z, handRot.w);
  const beaker = grip.beaker.body.translation();
  bodyPos.set(beaker.x, beaker.y, beaker.z);
  const beakerRot = grip.beaker.body.rotation();
  bodyQuat.set(beakerRot.x, beakerRot.y, beakerRot.z, beakerRot.w);
  solvedA.copy(grip.anchor1).applyQuaternion(handQuat).add(handPos);
  solvedB.copy(grip.anchor2).applyQuaternion(bodyQuat).add(bodyPos);
  return solvedA.distanceTo(solvedB);
}

function sideForce(world: RAPIER.World, grip: Grip) {
  let impulse = 0;
  const hand = grip.arm.body.handle;
  const body = grip.beaker.body;
  for (let c = 0; c < body.numColliders(); c++) {
    const collider = body.collider(c);
    world.contactPairsWith(collider, (other) => {
      const parent = other.parent();
      if (parent && parent.handle === hand) return;
      world.contactPair(collider, other, (manifold, flipped) => {
        const normal = manifold.normal();
        const ny = flipped ? -normal.y : normal.y;
        // Vertical contacts are the bench or the floor holding the glass up.
        if (Math.abs(ny) > SUPPORT_NORMAL) return;
        const count = manifold.numContacts();
        for (let i = 0; i < count; i++) impulse += manifold.contactImpulse(i);
      });
    });
  }
  return impulse;
}

function settleQuiet(hold: Hold, hands: Hands, dt: number) {
  for (let i = hold.quiet.length - 1; i >= 0; i--) {
    const item = hold.quiet[i];
    if (hold.grips.some((grip) => grip.beaker === item.beaker)) continue;
    item.time += dt;
    let clear = item.time > 0.6;
    if (!clear) {
      clear = true;
      for (const arm of [hands.arm, hands.left]) {
        if (!arm.solid) continue;
        for (const pad of arm.pads) {
          pad.bone.getWorldPosition(point);
          if (cylinderGap(point, item.beaker) < UNBLOCK) {
            clear = false;
            break;
          }
        }
        if (!clear) break;
      }
    }
    if (!clear) continue;
    setHandCollision(item.beaker, true);
    hold.quiet.splice(i, 1);
  }
}

function aimFingers(arm: Arm, beakers: Beaker[], held: Beaker | undefined, reach = NEAR) {
  let radius = FIST_RADIUS;
  if (held) {
    // Close to whatever part the thumb is on, so a handle is not held open to the tray's width.
    arm.pads.find((pad) => pad.id === "thumb")?.bone.getWorldPosition(point);
    cylinderGap(point, held);
    radius = touchRadius * 1.08;
  }
  let nearest = held ? 0 : reach;
  for (const pad of arm.pads) {
    pad.bone.getWorldPosition(point);
    let gap = Infinity;
    for (const beaker of beakers) {
      const distance = cylinderGap(point, beaker);
      gap = Math.min(gap, distance);
      if (!held && distance < nearest) {
        nearest = distance;
        radius = touchRadius * 1.08;
      }
    }
    const limit = pad.blocked ? UNBLOCK : TOUCH;
    pad.blocked = gap < limit;
  }
  arm.gripRadius = Math.max(0.012, radius);
}

// A large vessel sitting in the gap, with both hands on the glass from opposite sides.
function betweenHands(hands: Hands, hold: Hold, beakers: Beaker[]) {
  let beaker: Beaker | null = null;
  let best = Infinity;
  for (const candidate of beakers) {
    if (candidate.radius <= BEAKER_RADIUS || candidate.fixed) continue;
    if (candidate.body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;
    if (hold.grips.some((grip) => grip.beaker === candidate)) continue;
    const gapR = handGap(hands.arm, candidate, sideR);
    if (gapR > PAIR_TOUCH) continue;
    const gapL = handGap(hands.left, candidate, sideL);
    if (gapL > PAIR_TOUCH) continue;
    if (sideR.dot(sideL) > PAIR_OPPOSE) continue;
    const score = gapR + gapL;
    if (score < best) {
      best = score;
      beaker = candidate;
    }
  }
  return beaker;
}

// Gap from the glass to the nearest of the palm and fingertips, measured to the
// surface so holding high or low on a tall pot counts the same. `side` gets the
// direction out from the vessel at that point.
function handGap(arm: Arm, beaker: Beaker, side: THREE.Vector3) {
  arm.hand.getWorldPosition(handPos);
  arm.hand.getWorldQuaternion(handQuat);
  let best = Infinity;
  let through = false;
  const test = (sample: THREE.Vector3) => {
    const gap = cylinderGap(sample, beaker);
    // The open mouth is a large negative gap. Ignore it. A sample just inside the
    // wall means the hand has gone through the glass, so this is not a grip yet.
    if (gap < -PAIR_SUNK && gap > -0.055) through = true;
    if (gap < -0.01) return;
    if (gap < best && radial(sample, beaker, side)) best = gap;
  };
  test(point.copy(PALM).applyQuaternion(handQuat).add(handPos));
  for (const pad of arm.pads) test(pad.bone.getWorldPosition(point));
  return through ? Infinity : best;
}

// Thumb on one side of the cylinder, a finger on the other. The anchor is the
// midpoint of that pinch, which is where the joint holds the glass.
function pinch(arm: Arm, hold: Hold, beakers: Beaker[]) {
  const thumb = arm.pads.find((pad) => pad.id === "thumb");
  if (!thumb) return null;
  thumb.bone.getWorldPosition(point);
  let beaker: Beaker | null = null;
  let best = TOUCH;
  for (const candidate of beakers) {
    if (candidate.fixed) continue;
    if (candidate.body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;
    if (hold.grips.some((grip) => grip.beaker === candidate)) continue;
    const gap = cylinderGap(point, candidate);
    if (gap < best) {
      beaker = candidate;
      best = gap;
    }
  }
  if (!beaker || !radial(point, beaker, thumbRadial)) return null;

  anchor.copy(point);
  let count = 1;
  let opposed = false;
  for (const pad of arm.pads) {
    if (pad === thumb) continue;
    pad.bone.getWorldPosition(fingerPos);
    if (cylinderGap(fingerPos, beaker) > TOUCH) continue;
    if (!radial(fingerPos, beaker, fingerRadial)) continue;
    if (thumbRadial.dot(fingerRadial) > 0.2) continue;
    opposed = true;
    anchor.add(fingerPos);
    count += 1;
  }
  if (!opposed) return null;
  anchor.multiplyScalar(1 / count);
  return beaker;
}

function setHandCollision(beaker: Beaker, hit: boolean) {
  const filter = hit ? 0xffff : 0xffff ^ HAND;
  for (let i = 0; i < beaker.body.numColliders(); i++) beaker.body.collider(i).setCollisionGroups((filter << 16) | PROP);
}

// Direction out from the axis of the part nearest the sample.
function radial(sample: THREE.Vector3, beaker: Beaker, out: THREE.Vector3) {
  cylinderGap(sample, beaker);
  rel.copy(sample).sub(touchPos);
  rel.addScaledVector(touchAxis, -rel.dot(touchAxis));
  const length = rel.length();
  if (length < 1e-4) return false;
  out.copy(rel).multiplyScalar(1 / length);
  return true;
}

// Gap to the nearest part of the vessel: its own cylinder or any handle.
function cylinderGap(sample: THREE.Vector3, beaker: Beaker) {
  placeBeaker(beaker);
  let best = partGap(sample, beakerPos, beakerAxis, beaker.radius, beaker.height / 2);
  touchPos.copy(beakerPos);
  touchAxis.copy(beakerAxis);
  touchRadius = beaker.radius;
  for (const handle of beaker.handles) {
    partPos.copy(handle.center).applyQuaternion(bodyQuat).add(beakerPos);
    partAxis.copy(handle.axis).applyQuaternion(bodyQuat);
    const gap = partGap(sample, partPos, partAxis, handle.radius, handle.half);
    if (gap < best) {
      best = gap;
      touchPos.copy(partPos);
      touchAxis.copy(partAxis);
      touchRadius = handle.radius;
    }
  }
  return best;
}

function partGap(sample: THREE.Vector3, center: THREE.Vector3, axis: THREE.Vector3, radius: number, half: number) {
  rel.copy(sample).sub(center);
  const axial = rel.dot(axis);
  rel.addScaledVector(axis, -axial);
  const radialDistance = rel.length();
  const axialGap = Math.abs(axial) - half;
  if (axialGap <= 0) return radialDistance - radius;
  if (radialDistance <= radius) return axialGap;
  return Math.hypot(axialGap, radialDistance - radius);
}

function placeBeaker(beaker: Beaker) {
  const translation = beaker.body.translation();
  beakerPos.set(translation.x, translation.y, translation.z);
  const rotation = beaker.body.rotation();
  bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  beakerAxis.set(0, 1, 0).applyQuaternion(bodyQuat);
}

function rotationError(from: THREE.Quaternion, to: THREE.Quaternion, out: THREE.Vector3) {
  invQuat.copy(from).invert();
  invQuat.premultiply(to);
  if (invQuat.w < 0) {
    invQuat.x *= -1;
    invQuat.y *= -1;
    invQuat.z *= -1;
    invQuat.w *= -1;
  }
  const w = Math.min(1, invQuat.w);
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-5 || angle < 1e-5) {
    out.set(0, 0, 0);
    return 0;
  }
  out.set(invQuat.x / s, invQuat.y / s, invQuat.z / s);
  return angle;
}
