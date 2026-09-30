import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { solutionFromHex, water, type Solution } from "./fluid/solution";

const WORLD_GROUP = 0x0002;
const PROP_GROUP = 0x0008;
const ALL_GROUPS = 0xffff;

function collisionGroups(membership: number, filter: number) {
  return (filter << 16) | membership;
}

export type Beaker = {
  mesh: THREE.Group;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  height: number;
  solution: Solution;
};

// A 250mL beaker. The hand rig spans about 9.5cm between the thumb pad and the
// fingertips at full stretch, so anything much wider than this cannot be picked up:
// see tools/grip-lab.mjs. hands.ts sizes its grip from this radius.
export const BEAKER_RADIUS = 0.034;

type Size = { radius: number; height: number; density: number; tray?: boolean };
const SMALL: Size = { radius: 0.026, height: 0.068, density: 280 };
const MEDIUM: Size = { radius: BEAKER_RADIUS, height: 0.09, density: 280 };
// 8cm across, still inside the hand's span.
const LARGE: Size = { radius: 0.04, height: 0.115, density: 280 };
// A wide shallow dish to pour into and mix in. Heavy, so it stays put on the bench.
const TRAY: Size = { radius: 0.085, height: 0.03, density: 900, tray: true };

// Solute mass per cubic metre of stock solution: 10 per litre, so a 10mL draw is a dose
// of 0.1 against the body's deflection scale of 1.
const STOCK = 10000;

// The three elements.
const RED = 0xe23b2f;
const GREEN = 0x2f8f4e;
const BLUE = 0x2d6fdb;

const BENCH_TOP = 0.9;
// Top of the bench box. Dressing sits instruments on this.
export const BENCH_SURFACE = BENCH_TOP + 0.035;
const BENCH_WIDTH = 1.55;
const BENCH_DEPTH = 0.78;

type Stock = { size: Size; hex?: number; fill: number };

// Benches run left to right; items are listed from the player's left along the edge
// nearest the aisle. A missing hex is water; a zero fill is an empty vessel.
const BENCHES: { x: number; z: number; facing: 1 | -1; items: Stock[] }[] = [
  {
    // Elements, with empties to mix into.
    x: 0,
    z: -0.2,
    facing: 1,
    items: [
      { size: MEDIUM, hex: RED, fill: 0.72 },
      { size: MEDIUM, hex: GREEN, fill: 0.72 },
      { size: MEDIUM, hex: BLUE, fill: 0.72 },
      { size: TRAY, fill: 0 },
      { size: MEDIUM, fill: 0 },
      { size: SMALL, fill: 0 },
    ],
  },
  {
    // Water.
    x: -1.8,
    z: -0.2,
    facing: 1,
    items: [
      { size: LARGE, fill: 0.8 },
      { size: LARGE, fill: 0.8 },
      { size: MEDIUM, fill: 0.75 },
      { size: MEDIUM, fill: 0.75 },
      { size: SMALL, fill: 0.7 },
      { size: TRAY, fill: 0 },
    ],
  },
  {
    // Premixed secondaries and tertiaries.
    x: 1.8,
    z: -0.2,
    facing: 1,
    items: [
      { size: LARGE, hex: 0xe8c43a, fill: 0.6 }, // yellow
      { size: MEDIUM, hex: 0x2fb8c4, fill: 0.6 }, // cyan
      { size: SMALL, hex: 0xc8309a, fill: 0.65 }, // magenta
      { size: SMALL, hex: 0xe8742a, fill: 0.65 }, // orange
      { size: MEDIUM, hex: 0x6a3ad0, fill: 0.55 }, // violet
      { size: SMALL, hex: 0x8ad83a, fill: 0.65 }, // lime
    ],
  },
  {
    // Muddy, low-purity compounds: cheap and dirty.
    x: -0.9,
    z: 2.2,
    facing: -1,
    items: [
      { size: MEDIUM, hex: 0x8b6b3e, fill: 0.6 }, // brown
      { size: SMALL, hex: 0x7a7a34, fill: 0.6 }, // olive
      { size: MEDIUM, hex: 0x5a6a8a, fill: 0.6 }, // slate
      { size: SMALL, hex: 0xe8a0b4, fill: 0.6 }, // pastel rose
      { size: LARGE, hex: 0x3a7a6a, fill: 0.5 }, // teal
    ],
  },
  {
    // Mixing station.
    x: 0.9,
    z: 2.2,
    facing: -1,
    items: [
      { size: TRAY, fill: 0 },
      { size: LARGE, fill: 0 },
      { size: MEDIUM, fill: 0 },
      { size: SMALL, fill: 0 },
      { size: TRAY, fill: 0 },
    ],
  },
];

export function createLab(scene: THREE.Scene, world: RAPIER.World): Beaker[] {
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.95 });
  const topMaterial = new THREE.MeshStandardMaterial({ color: 0xe4dfd6, roughness: 0.45, metalness: 0.02 });
  const cabinetMaterial = new THREE.MeshStandardMaterial({ color: 0x8d5a32, roughness: 0.72 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x5e3b22, roughness: 0.8 });
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.2,
  });

  // Floor and walls are collision only. dressLab covers them with the classroom set.
  addBox(scene, world, ceilingMaterial, 8, 0.5, 8, 0, -0.25, 0, false);
  addBox(scene, world, ceilingMaterial, 8, 0.2, 8, 0, 3.1, 0);
  addBox(scene, world, ceilingMaterial, 8, 3, 0.2, 0, 1.5, -4, false);
  addBox(scene, world, ceilingMaterial, 8, 3, 0.2, 0, 1.5, 4, false);
  addBox(scene, world, ceilingMaterial, 0.2, 3, 8, -4, 1.5, 0, false);
  addBox(scene, world, ceilingMaterial, 0.2, 3, 8, 4, 1.5, 0, false);
  for (const x of [-1.8, 0, 1.8]) {
    for (const z of [-0.2, 2.2]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.3), panelMaterial);
      panel.position.set(x, 2.99, z);
      scene.add(panel);
    }
  }

  const beakers: Beaker[] = [];
  for (const bench of BENCHES) {
    addBench(scene, world, bench.x, bench.z, topMaterial, cabinetMaterial, trimMaterial);
    // Items line the aisle-side edge, within arm's length of someone standing at the bench.
    const edge = bench.z + bench.facing * (BENCH_DEPTH / 2 - 0.13);
    const widths = bench.items.map((item) => item.size.radius * 2);
    const gap = 0.06;
    const span = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
    let cursor = bench.x - bench.facing * (span / 2);
    for (const item of bench.items) {
      const r = item.size.radius;
      cursor += bench.facing * r;
      const z = edge - bench.facing * (item.size.tray ? r - 0.04 : 0);
      beakers.push(addVessel(scene, world, item, cursor, z));
      cursor += bench.facing * (r + gap);
    }
  }
  return beakers;
}

function addBench(
  scene: THREE.Scene,
  world: RAPIER.World,
  x: number,
  z: number,
  top: THREE.Material,
  cabinet: THREE.Material,
  trim: THREE.Material,
) {
  addBox(scene, world, top, BENCH_WIDTH, 0.07, BENCH_DEPTH, x, BENCH_TOP, z);
  const cabinetHeight = BENCH_TOP - 0.035 - 0.08;
  addBox(scene, world, cabinet, BENCH_WIDTH - 0.06, cabinetHeight, BENCH_DEPTH - 0.1, x, 0.08 + cabinetHeight / 2, z);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(BENCH_WIDTH - 0.1, 0.08, BENCH_DEPTH - 0.16), trim);
  kick.position.set(x, 0.04, z);
  scene.add(kick);
}

function addBox(
  scene: THREE.Scene,
  world: RAPIER.World,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  visible = true,
) {
  if (visible) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
      .setFriction(0.9)
      .setRestitution(0.05)
      .setCollisionGroups(collisionGroups(WORLD_GROUP, ALL_GROUPS)),
    body,
  );
}

const glass = new THREE.MeshPhysicalMaterial({
  color: 0xdfe7ea,
  transparent: true,
  opacity: 0.28,
  roughness: 0.08,
  metalness: 0,
  side: THREE.DoubleSide,
  depthWrite: true,
});

const plastic = new THREE.MeshStandardMaterial({
  color: 0xf4f6f7,
  roughness: 0.4,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  depthWrite: true,
});

function addVessel(scene: THREE.Scene, world: RAPIER.World, stock: Stock, x: number, z: number): Beaker {
  const { radius, height, density, tray } = stock.size;
  const material = tray ? plastic : glass;
  const mesh = new THREE.Group();

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * (tray ? 0.96 : 0.92), height, tray ? 40 : 28, 1, true),
    material,
  );
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, 28), material);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -height / 2 + 0.004;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, tray ? 0.004 : 0.006, 8, 28), material);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height / 2;
  wall.renderOrder = 3;
  bottom.renderOrder = 3;
  rim.renderOrder = 3;

  mesh.add(wall, bottom, rim);
  mesh.castShadow = true;
  scene.add(mesh);

  const centerY = BENCH_SURFACE + height / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, centerY, z)
      .setLinearDamping(0.45)
      .setAngularDamping(0.7)
      .setCcdEnabled(true),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cylinder(height / 2, radius)
      .setDensity(density)
      .setFriction(1.4)
      .setRestitution(0.04)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(collisionGroups(PROP_GROUP, ALL_GROUPS)),
    body,
  );

  mesh.position.set(x, centerY, z);
  const volume = Math.PI * radius * radius * height * stock.fill;
  return {
    mesh,
    body,
    collider,
    radius,
    height,
    solution: stock.hex === undefined ? water(volume) : solutionFromHex(stock.hex, volume, STOCK),
  };
}

export function syncBeakers(beakers: Beaker[]) {
  for (const beaker of beakers) {
    const position = beaker.body.translation();
    const rotation = beaker.body.rotation();
    beaker.mesh.position.set(position.x, position.y, position.z);
    beaker.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }
}
