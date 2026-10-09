import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";
import type { Arm, Hands } from "./hands";
import type { Beaker } from "./lab";

const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({ fillRect() {}, fillText() {} }),
};
Object.assign(globalThis, { document: { createElement: () => canvas } });

const { shiftOutOfGlass } = await import("./hands");
const { createHold, updateHold } = await import("./hold");

await RAPIER.init();

const DT = 1 / 60;

function worldOf() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.dt = DT;
  world.integrationParameters.numSolverIterations = 16;
  world.integrationParameters.normalizedPredictionDistance = 0.002;
  return world;
}

function pot(world: RAPIER.World, y: number): Beaker {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, y, 0).setCanSleep(false).setLinearDamping(0.4).setAngularDamping(0.8),
  );
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.11, 0.105).setDensity(800).setFriction(1.4), body);
  return { body, radius: 0.105, height: 0.22, handles: [], fixed: false } as unknown as Beaker;
}

function arm(world: RAPIER.World, palm: THREE.Vector3, kinematic: boolean): Arm {
  const hand = new THREE.Object3D();
  hand.position.set(palm.x, palm.y - 0.045, palm.z);
  const pads = ["thumb", "index", "middle", "ring", "little"].map((id) => {
    const bone = new THREE.Object3D();
    bone.position.set(0, 0.045, 0);
    hand.add(bone);
    return { id, bone, curl: 0, blocked: false };
  });
  new THREE.Group().add(hand);
  hand.updateMatrixWorld(true);
  const body = world.createRigidBody(
    kinematic
      ? RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hand.position.x, hand.position.y, hand.position.z)
      : RAPIER.RigidBodyDesc.dynamic().setTranslation(hand.position.x, hand.position.y, hand.position.z).setGravityScale(0),
  );
  if (kinematic) {
    body.setNextKinematicTranslation({ x: hand.position.x, y: hand.position.y, z: hand.position.z });
    body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
  }
  return { hand, pads, body, squeeze: 0, raised: true, solid: true, gripRadius: 0.05 } as unknown as Arm;
}

function handsOf(right: Arm, left: Arm): Hands {
  const model = new THREE.Group();
  new THREE.Group().add(model);
  return { model, arm: right, left, pair: 1, carrying: false } as unknown as Hands;
}

function place(right: Arm, left: Arm) {
  right.hand.updateMatrixWorld(true);
  left.hand.updateMatrixWorld(true);
}

describe("two-hand pot grab", () => {
  it("welds when the hands are on the front and the side, and lifts the pot off the bench", () => {
    const world = worldOf();
    const bench = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.85, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.05, 0.6), bench);
    const beaker = pot(world, 1.01);
    for (let i = 0; i < 20; i++) world.step();
    const rest = beaker.body.translation().y;

    const y = beaker.body.translation().y;
    const right = arm(world, new THREE.Vector3(0, y, 0.105 + 0.025), true);
    const left = arm(world, new THREE.Vector3(-(0.105 + 0.025), y, 0), false);
    const hands = handsOf(right, left);
    const hold = createHold();
    place(right, left);
    updateHold(hold, hands, [beaker], world, DT);
    expect(hold.grips.filter((grip) => grip.paired)).toHaveLength(1);

    const startY = right.hand.position.y;
    for (let i = 0; i < 40; i++) {
      right.hand.position.y = startY + (i + 1) * 0.012;
      right.hand.updateMatrixWorld(true);
      world.integrationParameters.dt = DT;
      updateHold(hold, hands, [beaker], world, DT);
      world.step();
    }
    expect(hold.grips.filter((grip) => grip.paired)).toHaveLength(1);
    expect(beaker.body.translation().y).toBeGreaterThan(rest + 0.35);
  });

  it("keeps the pot on the hand through a fast turn and a long step, and out of the body", () => {
    const world = worldOf();
    const beaker = pot(world, 1);
    const y = 1;
    const right = arm(world, new THREE.Vector3(0, y, 0.105 + 0.025), true);
    const left = arm(world, new THREE.Vector3(-(0.105 + 0.025), y, 0), false);
    const hands = handsOf(right, left);
    const hold = createHold();
    place(right, left);
    updateHold(hold, hands, [beaker], world, DT);
    expect(hold.grips.filter((grip) => grip.paired)).toHaveLength(1);

    const groups = beaker.body.collider(0).collisionGroups();
    const playerGroups = (0x0002 | 0x0008) << 16 | 0x0001;
    const hitsPlayer =
      (playerGroups & 0xffff & (groups >> 16)) !== 0 && ((groups & 0xffff) & (playerGroups >> 16)) !== 0;
    expect(hitsPlayer).toBe(false);

    const parent = right.hand.parent!;
    parent.position.set(0.55, 0.3, -0.4);
    parent.rotation.y = 1.4;
    parent.updateMatrixWorld(true);
    updateHold(hold, hands, [beaker], world, DT);
    world.step();
    expect(hold.grips.filter((grip) => grip.paired)).toHaveLength(1);
    const at = beaker.body.translation();
    const hand = right.hand.getWorldPosition(new THREE.Vector3());
    expect(Math.hypot(at.x - hand.x, at.y - hand.y, at.z - hand.z)).toBeLessThan(0.25);
    expect(Math.hypot(at.x, at.z)).toBeGreaterThan(0.3);
  });

  it("does not weld when both hands are on the same face or one has gone through the wall", () => {
    const world = worldOf();
    const beaker = pot(world, 1);
    const y = 1;
    const sameA = arm(world, new THREE.Vector3(-0.02, y, 0.105 + 0.025), true);
    const sameB = arm(world, new THREE.Vector3(0.02, y, 0.105 + 0.025), false);
    const hands = handsOf(sameA, sameB);
    const hold = createHold();
    place(sameA, sameB);
    updateHold(hold, hands, [beaker], world, DT);
    expect(hold.grips).toHaveLength(0);

    const sunk = arm(world, new THREE.Vector3(0, y, 0.105 - 0.04), true);
    const side = arm(world, new THREE.Vector3(-(0.105 + 0.025), y, 0), false);
    const again = handsOf(sunk, side);
    const other = createHold();
    place(sunk, side);
    updateHold(other, again, [beaker], world, DT);
    expect(other.grips).toHaveLength(0);
  });

  it("pushes a point in the wall back outside, and leaves the mouth and the far wall alone", () => {
    const world = worldOf();
    const beaker = pot(world, 0);
    const quat = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const sample = new THREE.Vector3(0.08, 0, 0);
    const wrist = new THREE.Vector3(0.2, 0, 0);
    const dist = shiftOutOfGlass([beaker], sample, wrist, quat, true, dir);
    sample.addScaledVector(dir, dist);
    expect(sample.x).toBeGreaterThanOrEqual(0.105 + 0.008);

    const far = new THREE.Vector3(-0.08, 0, 0);
    expect(shiftOutOfGlass([beaker], far, wrist, quat, true, dir)).toBe(0);

    const mouth = new THREE.Vector3(0.01, 0, 0);
    const mouthWrist = new THREE.Vector3(0.02, 0, 0);
    expect(shiftOutOfGlass([beaker], mouth, mouthWrist, quat, true, dir)).toBe(0);

    const pulled = shiftOutOfGlass([beaker], mouth, wrist, quat, true, dir);
    expect(pulled).toBeGreaterThan(0.05);
  });
});
