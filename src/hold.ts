import * as THREE from "three";
import type { Hands } from "./hands";
import type { Beaker } from "./lab";

const HAND = 0x0004;
const WORLD = 0x0002;
const PROP = 0x0008;
const GRAB_SQUEEZE = 0.62;
const RELEASE_SQUEEZE = 0.28;
const REACH_SQUEEZE = 0.15;
const GRAB_GAP = 0.04;
const BREAK_DISTANCE = 0.22;
const BREAK_ANGLE = 1.25;
const MAX_SPEED = 6;
const MAX_SPIN = 25;
const PALM = new THREE.Vector3(0, 0.06, 0);

type Arm = Hands["left"];

type Grip = {
  arm: Arm;
  beaker: Beaker;
  localPos: THREE.Vector3;
  localRot: THREE.Quaternion;
};

export type Hold = {
  grips: Grip[];
  reaching: WeakMap<Arm, boolean>;
};

const handPos = new THREE.Vector3();
const handQuat = new THREE.Quaternion();
const invHand = new THREE.Quaternion();
const bodyPos = new THREE.Vector3();
const bodyQuat = new THREE.Quaternion();
const targetPos = new THREE.Vector3();
const targetQuat = new THREE.Quaternion();
const axis = new THREE.Vector3();
const point = new THREE.Vector3();
const palmPos = new THREE.Vector3();
const rel = new THREE.Vector3();
const beakerPos = new THREE.Vector3();
const beakerAxis = new THREE.Vector3();

export function createHold(): Hold {
  return { grips: [], reaching: new WeakMap() };
}

export function updateHold(hold: Hold, hands: Hands, beakers: Beaker[], dt: number) {
  if (dt < 1e-4) return;
  for (const arm of [hands.left, hands.right]) {
    const holding = hold.grips.some((grip) => grip.arm === arm);
    const reaching = holding || (arm.squeeze > REACH_SQUEEZE && handNearBeaker(arm, beakers));
    if (hold.reaching.get(arm) !== reaching) {
      setHandSolids(arm, !reaching);
      hold.reaching.set(arm, reaching);
    }
  }

  for (let i = hold.grips.length - 1; i >= 0; i--) {
    const grip = hold.grips[i];
    if (grip.arm.squeeze < RELEASE_SQUEEZE) release(hold, grip);
    else servo(hold, grip, dt);
  }

  for (const arm of [hands.left, hands.right]) {
    if (arm.squeeze < GRAB_SQUEEZE || hold.grips.some((grip) => grip.arm === arm)) continue;
    const beaker = nearestBeaker(hold, arm, beakers);
    if (beaker) grab(hold, arm, beaker);
  }
}

function setHandSolids(arm: Arm, push: boolean) {
  const filter = push ? WORLD | PROP : WORLD;
  const groups = (filter << 16) | HAND;
  const count = arm.body.numColliders();
  for (let i = 0; i < count; i++) arm.body.collider(i).setCollisionGroups(groups);
}

function grab(hold: Hold, arm: Arm, beaker: Beaker) {
  arm.hand.getWorldPosition(handPos);
  arm.hand.getWorldQuaternion(handQuat);
  const translation = beaker.body.translation();
  const rotation = beaker.body.rotation();
  bodyPos.set(translation.x, translation.y, translation.z);
  bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  invHand.copy(handQuat).invert();
  const grip: Grip = {
    arm,
    beaker,
    localPos: bodyPos.clone().sub(handPos).applyQuaternion(invHand),
    localRot: invHand.clone().multiply(bodyQuat),
  };
  beaker.body.setGravityScale(0, true);
  beaker.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  beaker.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  beaker.body.wakeUp();
  hold.grips.push(grip);
}

function release(hold: Hold, grip: Grip) {
  grip.beaker.body.setGravityScale(1, true);
  grip.beaker.body.wakeUp();
  const index = hold.grips.indexOf(grip);
  if (index >= 0) hold.grips.splice(index, 1);
}

function servo(hold: Hold, grip: Grip, dt: number) {
  grip.arm.hand.getWorldPosition(handPos);
  grip.arm.hand.getWorldQuaternion(handQuat);
  targetPos.copy(grip.localPos).applyQuaternion(handQuat).add(handPos);
  targetQuat.copy(handQuat).multiply(grip.localRot);

  const translation = grip.beaker.body.translation();
  const rotation = grip.beaker.body.rotation();
  bodyPos.set(translation.x, translation.y, translation.z);
  bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);

  const error = targetPos.distanceTo(bodyPos);
  const angle = rotationError(bodyQuat, targetQuat, axis);
  if (error > BREAK_DISTANCE || angle > BREAK_ANGLE) {
    const velocity = grip.beaker.body.linvel();
    grip.beaker.body.setLinvel(
      { x: velocity.x * 0.25, y: velocity.y * 0.25, z: velocity.z * 0.25 },
      true,
    );
    release(hold, grip);
    return;
  }

  let vx = (targetPos.x - bodyPos.x) / dt;
  let vy = (targetPos.y - bodyPos.y) / dt;
  let vz = (targetPos.z - bodyPos.z) / dt;
  const speed = Math.hypot(vx, vy, vz);
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed;
    vx *= scale;
    vy *= scale;
    vz *= scale;
  }
  grip.beaker.body.setLinvel({ x: vx, y: vy, z: vz }, true);

  const spin = Math.min(MAX_SPIN, angle / dt);
  grip.beaker.body.setAngvel(
    { x: axis.x * spin, y: axis.y * spin, z: axis.z * spin },
    true,
  );
}

function rotationError(from: THREE.Quaternion, to: THREE.Quaternion, out: THREE.Vector3) {
  invHand.copy(from).invert();
  invHand.premultiply(to);
  if (invHand.w < 0) {
    invHand.x *= -1;
    invHand.y *= -1;
    invHand.z *= -1;
    invHand.w *= -1;
  }
  const w = Math.min(1, invHand.w);
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-5 || angle < 1e-5) {
    out.set(0, 0, 0);
    return 0;
  }
  out.set(invHand.x / s, invHand.y / s, invHand.z / s);
  return angle;
}

function handNearBeaker(arm: Arm, beakers: Beaker[]) {
  arm.hand.getWorldPosition(handPos);
  arm.hand.getWorldQuaternion(handQuat);
  palmPos.copy(PALM).applyQuaternion(handQuat).add(handPos);
  for (const beaker of beakers) {
    if (cylinderGap(palmPos, beaker) < 0.08) return true;
    for (const tip of arm.tips) {
      tip.bone.getWorldPosition(point);
      if (cylinderGap(point, beaker) < 0.08) return true;
    }
  }
  return false;
}

function nearestBeaker(hold: Hold, arm: Arm, beakers: Beaker[]) {
  arm.hand.getWorldPosition(handPos);
  arm.hand.getWorldQuaternion(handQuat);
  const palm = palmPos.copy(PALM).applyQuaternion(handQuat).add(handPos);
  let best: Beaker | null = null;
  let bestGap = GRAB_GAP;
  for (const beaker of beakers) {
    if (hold.grips.some((grip) => grip.beaker === beaker)) continue;
    let gap = Math.min(cylinderGap(handPos, beaker), cylinderGap(palm, beaker));
    for (const tip of arm.tips) {
      tip.bone.getWorldPosition(point);
      gap = Math.min(gap, cylinderGap(point, beaker));
    }
    if (gap < bestGap) {
      best = beaker;
      bestGap = gap;
    }
  }
  return best;
}

function cylinderGap(sample: THREE.Vector3, beaker: Beaker) {
  const translation = beaker.body.translation();
  const rotation = beaker.body.rotation();
  beakerPos.set(translation.x, translation.y, translation.z);
  bodyQuat.set(rotation.x, rotation.y, rotation.z, rotation.w);
  beakerAxis.set(0, 1, 0).applyQuaternion(bodyQuat);
  const half = beaker.height / 2;
  rel.copy(sample).sub(beakerPos);
  const axial = rel.dot(beakerAxis);
  rel.addScaledVector(beakerAxis, -axial);
  const radial = rel.length();
  const axialGap = Math.abs(axial) - half;
  if (axialGap <= 0) return radial - beaker.radius;
  if (radial <= beaker.radius) return axialGap;
  return Math.hypot(axialGap, radial - beaker.radius);
}
