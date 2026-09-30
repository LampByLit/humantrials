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
// Pot-sized glass. Too wide for the fingers alone; the left hand comes in for these.
// Light glass so a full one is still a carry, not a deadlift.
const POT_S: Size = { radius: 0.065, height: 0.14, density: 150 };
const POT_M: Size = { radius: 0.085, height: 0.18, density: 130 };
const POT_L: Size = { radius: 0.105, height: 0.22, density: 120 };
const POT_XL: Size = { radius: 0.125, height: 0.27, density: 110 };

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
// Distance from the bench centre line to the front row of glass, and to the row behind it.
const FRONT_ROW = BENCH_DEPTH / 2 - 0.13;
const BACK_ROW = FRONT_ROW - 0.2;

// Half extents of the room. dressing.ts lays 2m wall modules along these, so keep them whole metres.
export const ROOM_X = 7;
export const ROOM_Z = 6;
const ROOM_HEIGHT = 3;

type Stock = { size: Size; hex?: number; fill: number };
type Bench = { x: number; z: number; facing: 1 | -1; width?: number; items: Stock[]; back?: Stock[] };

const FRONT_CYCLE = [MEDIUM, SMALL, LARGE, SMALL];
const BACK_CYCLE = [SMALL, MEDIUM];

function chems(hexes: number[], cycle = FRONT_CYCLE, fill = 0.62): Stock[] {
  return hexes.map((hex, i) => ({ size: cycle[i % cycle.length], hex, fill }));
}

function backChems(hexes: number[]): Stock[] {
  return chems(hexes, BACK_CYCLE, 0.66);
}

function waters(sizes: Size[], fill = 0.75): Stock[] {
  return sizes.map((size) => ({ size, fill }));
}

function empties(sizes: Size[]): Stock[] {
  return sizes.map((size) => ({ size, fill: 0 }));
}

const GRAYS = Array.from({ length: 16 }, (_, i) => i * 0x111111).concat(0xffffff);

// Benches run left to right; items are listed from the player's left along the edge
// nearest the aisle, and `back` is a second row behind them. A missing hex is water;
// a zero fill is an empty vessel. Rows pair up across aisles: facing 1 is worked from
// the south side, facing -1 from the north.
const BENCHES: Bench[] = [
  // Centre row, where the player starts.
  {
    // Reds and warm tones.
    x: -3.6,
    z: -0.2,
    facing: 1,
    items: chems([0xff0000, 0xb01030, 0xff2400, 0xff7f50, 0xfa8072, 0xb7410e, 0xe34234]),
    back: backChems([0x800000, 0x9c2a1c, 0xff3366, 0xcd5c5c, 0xdc143c, 0xff6347]),
  },
  {
    // Water.
    x: -1.8,
    z: -0.2,
    facing: 1,
    items: [...waters([LARGE, LARGE, MEDIUM, MEDIUM, SMALL], 0.8), { size: TRAY, fill: 0 }],
    back: waters([MEDIUM, MEDIUM, SMALL, SMALL, MEDIUM, SMALL]),
  },
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
    back: chems([RED, GREEN, BLUE, RED, GREEN, BLUE], [LARGE], 0.7),
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
    back: backChems([0xffff00, 0x00ffff, 0xff00ff, 0xff8000, 0x8000ff, 0x80ff00, 0x0080ff, 0xff0080]),
  },
  {
    // Blues and cyans.
    x: 3.6,
    z: -0.2,
    facing: 1,
    items: chems([0x1b2a6b, 0x007fff, 0x2a52be, 0x87ceeb, 0x0047ab, 0x40e0d0, 0x4682b4]),
    back: backChems([0xa8d8f0, 0x4b0082, 0x00ced1, 0x191970, 0x6495ed, 0x5f9ea0]),
  },

  // Across the aisle from the start.
  {
    // Greens.
    x: -2.7,
    z: 2.2,
    facing: -1,
    items: chems([0x50c878, 0x228b22, 0x98ff98, 0x7fff00, 0x00a86b, 0x8a9a5b, 0x2e8b57]),
    back: backChems([0x01796f, 0x9caf88, 0x39ff14, 0x006400, 0x3cb371, 0xadff2f]),
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
    back: backChems([0x6b5a4a, 0x7a6a5a, 0x5a5a4a, 0x8a7a6a, 0x4a5a5a, 0x6a5a6a]),
  },
  {
    // Mixing station.
    x: 0.9,
    z: 2.2,
    facing: -1,
    items: empties([TRAY, LARGE, MEDIUM, SMALL, TRAY]),
    back: empties([MEDIUM, SMALL, MEDIUM, SMALL, MEDIUM, SMALL]),
  },
  {
    // Purples and pinks.
    x: 2.7,
    z: 2.2,
    facing: -1,
    items: chems([0x9966cc, 0x8e4585, 0xda70d6, 0xb57edc, 0xff00ff, 0xff69b4, 0xc71585]),
    back: backChems([0x6f2da8, 0xe0b0ff, 0xe30b5c, 0x614051, 0xdda0dd, 0x9400d3]),
  },

  // North pair of rows.
  {
    // Yellows and oranges.
    x: -2.7,
    z: -2.2,
    facing: -1,
    items: chems([0xffd700, 0xffbf00, 0xf4c430, 0xf28500, 0xff7518, 0xe1ad01, 0xffa500]),
    back: backChems([0xfff44f, 0xcc7722, 0xfbceb1, 0xeba937, 0xffdab9, 0xff8c00]),
  },
  {
    // Earths.
    x: -0.9,
    z: -2.2,
    facing: -1,
    items: chems([0xa0522d, 0x635147, 0xd2b48c, 0xc3b091, 0x704214, 0x483c32, 0x8b4513]),
    back: backChems([0xdeb887, 0xbc8f8f, 0xcd853f, 0x826644, 0x967117, 0x5c4033]),
  },
  {
    // Pastels.
    x: 0.9,
    z: -2.2,
    facing: -1,
    items: chems([0xffd1dc, 0xc1e1c1, 0xaec6cf, 0xfdfd96, 0xcfcfc4, 0xb39eb5, 0xffb347]),
    back: backChems([0x77dd77, 0x836953, 0xf49ac2, 0xcb99c9, 0x779ecb, 0xff6961]),
  },
  {
    // Second water station, with empties.
    x: 2.7,
    z: -2.2,
    facing: -1,
    items: [...waters([LARGE, LARGE, MEDIUM, MEDIUM], 0.8), ...empties([TRAY, SMALL])],
    back: [...waters([MEDIUM, SMALL, MEDIUM]), ...empties([MEDIUM, SMALL, MEDIUM])],
  },
  {
    // Neons.
    x: -3.6,
    z: -4.4,
    facing: 1,
    items: chems([0xff073a, 0xccff00, 0x1f51ff, 0xff5f1f, 0xbc13fe, 0x0ff0fc, 0xfe019a]),
    back: backChems([0x39ff14, 0xffff33, 0xff3131, 0x04d9ff, 0xff10f0, 0xdfff00]),
  },
  {
    // Deep, dark compounds.
    x: -1.8,
    z: -4.4,
    facing: 1,
    items: chems([0x3b0a45, 0x0b3d2e, 0x1c1c5c, 0x4a1010, 0x2e2a0a, 0x0a2e3b, 0x2b0f24]),
    back: backChems([0x301934, 0x013220, 0x000080, 0x3d0c02, 0x353839, 0x0d1b2a]),
  },
  {
    // Washed-out, low-purity tints.
    x: 0,
    z: -4.4,
    facing: 1,
    items: chems([0xc08080, 0x80c080, 0x8080c0, 0xc0c080, 0x80c0c0, 0xc080c0, 0xa09080]),
    back: backChems([0xd0a0a0, 0xa0d0a0, 0xa0a0d0, 0xd0d0a0, 0xa0d0d0, 0xd0a0d0]),
  },
  {
    // Pots of stock: elements and the ends of the gray scale.
    x: 2.5,
    z: -4.4,
    facing: 1,
    width: 3.4,
    items: [
      { size: POT_L, hex: RED, fill: 0.65 },
      { size: POT_M, hex: GREEN, fill: 0.65 },
      { size: POT_L, hex: BLUE, fill: 0.65 },
      { size: POT_S, hex: 0x000000, fill: 0.7 },
      { size: POT_M, hex: 0xffffff, fill: 0.65 },
      { size: POT_S, hex: 0xffd700, fill: 0.7 },
      { size: POT_M, hex: 0xff00ff, fill: 0.65 },
    ],
  },

  // South wall.
  {
    // Black to white.
    x: -2.2,
    z: 4.6,
    facing: -1,
    width: 3.4,
    items: chems(GRAYS, FRONT_CYCLE, 0.66),
    back: chems([0x000000, 0xffffff, 0x000000, 0xffffff, 0x000000, 0xffffff, 0x000000, 0xffffff, 0x000000, 0xffffff], [LARGE, MEDIUM], 0.72),
  },
  {
    // Pots of water and empty pots, big enough to mix a batch in.
    x: 2.2,
    z: 4.6,
    facing: -1,
    width: 3.4,
    items: [
      { size: POT_XL, fill: 0.7 },
      { size: POT_L, fill: 0 },
      { size: POT_M, fill: 0.7 },
      { size: POT_S, fill: 0 },
      { size: POT_S, fill: 0.7 },
      { size: POT_M, fill: 0 },
      { size: POT_L, fill: 0.7 },
      { size: POT_XL, fill: 0 },
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
  const w = ROOM_X * 2;
  const d = ROOM_Z * 2;
  addBox(scene, world, ceilingMaterial, w, 0.5, d, 0, -0.25, 0, false);
  addBox(scene, world, ceilingMaterial, w, 0.2, d, 0, ROOM_HEIGHT + 0.1, 0);
  addBox(scene, world, ceilingMaterial, w, ROOM_HEIGHT, 0.2, 0, ROOM_HEIGHT / 2, -ROOM_Z, false);
  addBox(scene, world, ceilingMaterial, w, ROOM_HEIGHT, 0.2, 0, ROOM_HEIGHT / 2, ROOM_Z, false);
  addBox(scene, world, ceilingMaterial, 0.2, ROOM_HEIGHT, d, -ROOM_X, ROOM_HEIGHT / 2, 0, false);
  addBox(scene, world, ceilingMaterial, 0.2, ROOM_HEIGHT, d, ROOM_X, ROOM_HEIGHT / 2, 0, false);

  const beakers: Beaker[] = [];
  for (const bench of BENCHES) {
    const width = bench.width ?? BENCH_WIDTH;
    addBench(scene, world, bench.x, bench.z, width, topMaterial, cabinetMaterial, trimMaterial);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, 0.02, 0.3), panelMaterial);
    panel.position.set(bench.x, ROOM_HEIGHT - 0.01, bench.z);
    scene.add(panel);
    // Items line the aisle-side edge, within arm's length of someone standing at the bench.
    lineUp(scene, world, bench, bench.items, FRONT_ROW, beakers);
    if (bench.back) lineUp(scene, world, bench, bench.back, BACK_ROW, beakers);
  }
  return beakers;
}

function lineUp(scene: THREE.Scene, world: RAPIER.World, bench: Bench, items: Stock[], depth: number, out: Beaker[]) {
  const edge = bench.z + bench.facing * depth;
  const gap = 0.06;
  const span = items.reduce((sum, item) => sum + item.size.radius * 2, 0) + gap * (items.length - 1);
  let cursor = bench.x - bench.facing * (span / 2);
  for (const item of items) {
    const r = item.size.radius;
    cursor += bench.facing * r;
    // Anything wider than a beaker is pulled back so its front rim stays on the bench edge line.
    const z = edge - bench.facing * Math.max(0, r - 0.04);
    out.push(addVessel(scene, world, item, cursor, z));
    cursor += bench.facing * (r + gap);
  }
}

function addBench(
  scene: THREE.Scene,
  world: RAPIER.World,
  x: number,
  z: number,
  width: number,
  top: THREE.Material,
  cabinet: THREE.Material,
  trim: THREE.Material,
) {
  addBox(scene, world, top, width, 0.07, BENCH_DEPTH, x, BENCH_TOP, z);
  const cabinetHeight = BENCH_TOP - 0.035 - 0.08;
  addBox(scene, world, cabinet, width - 0.06, cabinetHeight, BENCH_DEPTH - 0.1, x, 0.08 + cabinetHeight / 2, z);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, 0.08, BENCH_DEPTH - 0.16), trim);
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
  const segments = radius > 0.05 ? 40 : 28;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * (tray ? 0.96 : 0.92), height, segments, 1, true),
    material,
  );
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.9, segments), material);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = -height / 2 + 0.004;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, tray ? 0.004 : 0.006, 8, segments), material);
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
