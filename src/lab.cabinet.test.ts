import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";

const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({ fillRect() {}, fillText() {} }),
};
Object.assign(globalThis, { document: { createElement: () => canvas } });
const { addBox, addCabinetShell, addVessel, WELL_RADIUS } = await import("./lab");
const { createFluid, updateFluid } = await import("./fluid/sim");
const { water } = await import("./fluid/solution");

await RAPIER.init();

const TOP = 1.2;

function cabinet() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.numSolverIterations = 16;
  world.integrationParameters.normalizedPredictionDistance = 0.002;
  const scene = new THREE.Scene();
  addBox(scene, world, new THREE.MeshBasicMaterial(), 8, 0.2, 8, 0, -0.1, 0, false);
  const fitted = new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.4), new THREE.Vector3(0.3, TOP, 0.4));
  const well = addVessel(
    scene,
    world,
    { size: { radius: WELL_RADIUS, height: 0.1, density: 1 }, fill: 0, fixed: true, y: TOP - 0.04 },
    0,
    0,
    1,
  );
  addCabinetShell(scene, world, fitted, WELL_RADIUS);
  return { world, scene, well };
}

function dropBeaker(world: RAPIER.World, scene: THREE.Scene, x: number, z: number) {
  const beaker = addVessel(scene, world, { size: { radius: 0.034, height: 0.09, density: 280 }, fill: 0, y: TOP + 0.1 }, x, z, 1);
  for (let i = 0; i < 180; i++) world.step();
  return beaker.body.translation();
}

describe("cabinet top", () => {
  it("holds a beaker set on the top and lets one over the well drop in", () => {
    const { world, scene } = cabinet();
    const onTop = dropBeaker(world, scene, -0.18, 0.2);
    expect(onTop.y).toBeGreaterThan(TOP + 0.04);
    expect(onTop.y).toBeLessThan(TOP + 0.05);

    const inWell = dropBeaker(world, scene, 0, 0);
    expect(inWell.y).toBeLessThan(TOP);
    expect(inWell.y).toBeGreaterThan(TOP - 0.09);
  }, 60000);

  it("puddles a spill on the top and sends a pour over the hole into the well", () => {
    const { world, scene, well } = cabinet();
    // 40 mL spreads to about 7 cm across, so it stays on the top clear of the edge and the hole.
    const spill = { x: -0.18, y: TOP + 0.3, z: 0.2, rate: 0.00004, liquid: water(0.00004) };
    const pour = { x: 0, y: TOP + 0.3, z: 0, rate: 0.00004, liquid: water(0.0004) };
    const fluid = createFluid(scene, [well], null, new THREE.Vector3(0, 1, 0), [spill, pour]);
    for (let i = 0; i < 240; i++) {
      world.step();
      updateFluid(fluid, world, 1 / 60);
    }
    expect(well.solution.volume).toBeGreaterThan(0.0001);
    const onTop = fluid.puddles.filter((p) => p.volume > 0 && Math.abs(p.mesh.position.y - TOP) < 0.02);
    expect(onTop.reduce((sum, p) => sum + p.volume, 0)).toBeCloseTo(0.00004, 6);
    const onFloor = fluid.puddles.filter((p) => p.volume > 0 && p.mesh.position.y < 0.1);
    expect(onFloor.length).toBe(0);
  }, 60000);
});
