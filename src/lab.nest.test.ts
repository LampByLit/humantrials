import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";

const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({ fillRect() {}, fillText() {} }),
};
Object.assign(globalThis, { document: { createElement: () => canvas } });
const { createLab, containVessels } = await import("./lab");

await RAPIER.init();

function settle(world: RAPIER.World) {
  for (let i = 0; i < 100; i++) world.step();
}

function dropInto(world: RAPIER.World, inner: { body: RAPIER.RigidBody; height: number }, outer: { body: RAPIER.RigidBody; height: number; radius: number }) {
  const y = 0.8;
  outer.body.setTranslation({ x: 0, y, z: 0 }, true);
  outer.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  outer.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  outer.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  inner.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  inner.body.setTranslation({ x: 0, y: y + outer.height / 2 + inner.height / 2 + 0.03, z: 0 }, true);
  inner.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  inner.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  inner.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  inner.body.wakeUp();
  settle(world);
  return inner.body.translation();
}

describe("vessel shells", () => {
  it("lets a smaller beaker come to rest inside a larger one and a pot", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.integrationParameters.numSolverIterations = 16;
    world.integrationParameters.normalizedPredictionDistance = 0.002;
    const beakers = createLab(new THREE.Scene(), world);
    const medium = beakers.find((beaker) => Math.abs(beaker.radius - 0.034) < 1e-4);
    const large = beakers.find((beaker) => Math.abs(beaker.radius - 0.04) < 1e-4);
    const pot = beakers.find((beaker) => beaker.radius > 0.1);
    expect(medium && large && pot).toBeTruthy();
    if (!medium || !large || !pot) return;

    const inLarge = dropInto(world, medium, large);
    expect(inLarge.y).toBeLessThan(0.8 + large.height / 2);
    expect(Math.hypot(inLarge.x, inLarge.z)).toBeLessThan(large.radius);

    medium.body.setTranslation({ x: 4, y: 0.3, z: 4 }, true);
    const inPot = dropInto(world, large, pot);
    expect(inPot.y).toBeLessThan(0.8 + pot.height / 2);
    expect(Math.hypot(inPot.x, inPot.z)).toBeLessThan(pot.radius);
  }, 60000);

  it("keeps a nested beaker in a lifted pot and mixes a full beaker into a full pot", async () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.integrationParameters.numSolverIterations = 16;
    world.integrationParameters.normalizedPredictionDistance = 0.002;
    const beakers = createLab(new THREE.Scene(), world);
    const medium = beakers.find((beaker) => Math.abs(beaker.radius - 0.034) < 1e-4);
    const pot = beakers.find((beaker) => beaker.radius > 0.1);
    expect(medium && pot).toBeTruthy();
    if (!medium || !pot) return;

    dropInto(world, medium, pot);
    const innerY = medium.body.translation().y;
    const hostY = pot.body.translation().y;
    pot.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    pot.body.setGravityScale(0, true);
    medium.body.setGravityScale(0, true);
    containVessels(beakers, world, []);
    pot.body.setLinvel({ x: 0, y: 1.2, z: 0 }, true);
    for (let i = 0; i < 30; i++) {
      containVessels(beakers, world, []);
      world.step();
    }
    const raised = medium.body.translation().y - innerY;
    const potRaised = pot.body.translation().y - hostY;
    expect(raised).toBeGreaterThan(0.25);
    expect(Math.abs(raised - potRaised)).toBeLessThan(0.08);

    const { solutionFromHex, STOCK_CONCENTRATION } = await import("./fluid/solution");
    const { createFluid, updateFluid } = await import("./fluid/sim");
    const capacity = (beaker: { radius: number; height: number }) => Math.PI * beaker.radius ** 2 * beaker.height;
    medium.solution = solutionFromHex(0xff0000, capacity(medium), STOCK_CONCENTRATION);
    pot.solution = solutionFromHex(0x0000ff, capacity(pot), STOCK_CONCENTRATION);
    const fluid = createFluid(new THREE.Scene(), [medium, pot], null, new THREE.Vector3(0, 1, 0));
    for (let i = 0; i < 40; i++) updateFluid(fluid, world, 1 / 60);
    expect(medium.solution.volume).toBeLessThan(1e-5);
    expect(pot.solution.volume).toBeGreaterThan(capacity(pot) * 0.9);
    expect(pot.solution.volume).toBeLessThan(capacity(pot) * 1.05);
    expect(pot.solution.r).toBeGreaterThan(0.02);
    expect(pot.solution.b).toBeGreaterThan(0.5);
  }, 60000);
});
