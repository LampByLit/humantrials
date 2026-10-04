import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { milk, solutionFromHex, STOCK_CONCENTRATION, toChem, water, type Solution } from "./fluid/solution";
import { chemLabel, latinName, namedColor } from "./sim/colorName";
import { whiteSurface } from "./theme";
import catalog from "../concept/chems.json";

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
  handles: Handle[];
  fixed?: boolean;
};

// A grippable cylinder fixed to a vessel's body, in the body's local frame.
export type Handle = {
  collider: RAPIER.Collider;
  center: THREE.Vector3;
  axis: THREE.Vector3;
  radius: number;
  half: number;
};

// Trays carry an upside-down L: a post up from the rim nearest the player, and a
// bar off its top pointing at the player, thick enough to pinch.
const HANDLE_RADIUS = 0.009;
const HANDLE_RISE = 0.08;
const HANDLE_REACH = 0.07;

// A 250mL beaker. The hand rig spans about 9.5cm between the thumb pad and the
// fingertips at full stretch, so anything much wider than this cannot be picked up:
// see tools/grip-lab.mjs. hands.ts sizes its grip from this radius.
export const BEAKER_RADIUS = 0.034;

type Size = { radius: number; height: number; density: number; tray?: boolean; flange?: boolean };
const MEDIUM: Size = { radius: BEAKER_RADIUS, height: 0.09, density: 280 };
// 8cm across, still inside the hand's span.
const LARGE: Size = { radius: 0.04, height: 0.115, density: 280 };
// A wide shallow dish to pour into and mix in. Heavy, so it stays put on the bench.
const TRAY: Size = { radius: 0.085, height: 0.03, density: 900, tray: true };
// Pot-sized glass. Too wide for the fingers alone; the left hand comes in for these.
// Light glass so a full one is still a carry, not a deadlift.
const POT_S: Size = { radius: 0.065, height: 0.14, density: 150, flange: true };
const POT_M: Size = { radius: 0.085, height: 0.18, density: 130, flange: true };
const POT_L: Size = { radius: 0.105, height: 0.22, density: 120, flange: true };
const POT_XL: Size = { radius: 0.125, height: 0.27, density: 110, flange: true };
// A flat lip round a pot's mouth. The hands lift from under it, so a full pot sits
// on them instead of hanging on friction alone.
const FLANGE_WIDTH = 0.014;
const FLANGE_THICK = 0.008;
const FLANGE_SEGMENTS = 20;
// Room between pots for a hand to get round the side of one.
const POT_GAP = 0.14;

// White lets every colour through, so a white stock is stocked as milk to be seen at all.
const MILK = 0xffffff;

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
export const ROOM_X = 12;
export const ROOM_Z = 10;
export const ROOM_HEIGHT = 5.4;

type Stock = { size: Size; hex?: number; fill: number; exact?: boolean; fixed?: boolean; y?: number };
type Bench = { x: number; z: number; facing: 1 | -1; width?: number; items: Stock[]; back?: Stock[] };

const FRONT_CYCLE = [MEDIUM, MEDIUM, LARGE, MEDIUM];
const BACK_CYCLE = [MEDIUM, LARGE];

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
const CATALOG = catalog.map((entry) => parseInt(entry.hex.slice(1), 16));

const BENCHES: Bench[] = [
  // Centre aisle, worked from the north side of each bench.
  { x: -7.5, z: -1.8, facing: 1, items: chems([0xff0000, 0xb01030, 0xff2400, 0xff7f50, 0xfa8072, 0xb7410e, 0xe34234]), back: backChems([0x800000, 0x9c2a1c, 0xff3366, 0xcd5c5c, 0xdc143c, 0xff6347]) },
  { x: -5, z: -1.8, facing: 1, items: [...waters([MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM], 0.8), { size: TRAY, fill: 0 }], back: waters([MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM]) },
  { x: -2.5, z: -1.8, facing: 1, items: [{ size: MEDIUM, hex: RED, fill: 0.72 }, { size: MEDIUM, hex: GREEN, fill: 0.72 }, { size: MEDIUM, hex: BLUE, fill: 0.72 }, { size: TRAY, fill: 0 }, { size: MEDIUM, fill: 0 }, { size: MEDIUM, fill: 0 }], back: chems([RED, GREEN, BLUE, RED, GREEN, BLUE], [LARGE], 0.7) },
  { x: 0, z: -1.8, facing: 1, items: [{ size: LARGE, hex: 0xe8c43a, fill: 0.6 }, { size: MEDIUM, hex: 0x2fb8c4, fill: 0.6 }, { size: MEDIUM, hex: 0xc8309a, fill: 0.65 }, { size: MEDIUM, hex: 0xe8742a, fill: 0.65 }, { size: MEDIUM, hex: 0x6a3ad0, fill: 0.55 }, { size: MEDIUM, hex: 0x8ad83a, fill: 0.65 }], back: backChems([0xffff00, 0x00ffff, 0xff00ff, 0xff8000, 0x8000ff, 0x80ff00, 0x0080ff, 0xff0080]) },
  { x: 2.5, z: -1.8, facing: 1, items: chems([0x1b2a6b, 0x007fff, 0x2a52be, 0x87ceeb, 0x0047ab, 0x40e0d0, 0x4682b4]), back: backChems([0xa8d8f0, 0x4b0082, 0x00ced1, 0x191970, 0x6495ed, 0x5f9ea0]) },
  { x: 5, z: -1.8, facing: 1, items: chems([0xff073a, 0xccff00, 0x1f51ff, 0xff5f1f, 0xbc13fe, 0x0ff0fc, 0xfe019a]), back: backChems([0x39ff14, 0xffff33, 0xff3131, 0x04d9ff, 0xff10f0, 0xdfff00]) },

  // Across that aisle.
  { x: -7.5, z: 2, facing: -1, items: chems([0x50c878, 0x228b22, 0x98ff98, 0x7fff00, 0x00a86b, 0x8a9a5b, 0x2e8b57]), back: backChems([0x01796f, 0x9caf88, 0x39ff14, 0x006400, 0x3cb371, 0xadff2f]) },
  { x: -5, z: 2, facing: -1, items: [{ size: MEDIUM, hex: 0x8b6b3e, fill: 0.6 }, { size: MEDIUM, hex: 0x7a7a34, fill: 0.6 }, { size: MEDIUM, hex: 0x5a6a8a, fill: 0.6 }, { size: MEDIUM, hex: 0xe8a0b4, fill: 0.6 }, { size: LARGE, hex: 0x3a7a6a, fill: 0.5 }], back: backChems([0x6b5a4a, 0x7a6a5a, 0x5a5a4a, 0x8a7a6a, 0x4a5a5a, 0x6a5a6a]) },
  { x: -2.5, z: 2, facing: -1, items: empties([TRAY, LARGE, MEDIUM, MEDIUM, TRAY]), back: empties([MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM]) },
  { x: 0, z: 2, facing: -1, items: chems([0x9966cc, 0x8e4585, 0xda70d6, 0xb57edc, 0xff00ff, 0xff69b4, 0xc71585]), back: backChems([0x6f2da8, 0xe0b0ff, 0xe30b5c, 0x614051, 0xdda0dd, 0x9400d3]) },
  { x: 2.5, z: 2, facing: -1, items: chems([0xffd700, 0xffbf00, 0xf4c430, 0xf28500, 0xff7518, 0xe1ad01, 0xffa500]), back: backChems([0xfff44f, 0xcc7722, 0xfbceb1, 0xeba937, 0xffdab9, 0xff8c00]) },
  { x: 5, z: 2, facing: -1, items: chems([0xa0522d, 0x635147, 0xd2b48c, 0xc3b091, 0x704214, 0x483c32, 0x8b4513]), back: backChems([0xdeb887, 0xbc8f8f, 0xcd853f, 0x826644, 0x967117, 0x5c4033]) },

  // North row.
  { x: -6, z: -6.4, facing: 1, items: chems([0xffd1dc, 0xc1e1c1, 0xaec6cf, 0xfdfd96, 0xcfcfc4, 0xb39eb5, 0xffb347]), back: backChems([0x77dd77, 0x836953, 0xf49ac2, 0xcb99c9, 0x779ecb, 0xff6961]) },
  { x: -2, z: -6.4, facing: 1, width: 3.4, items: chems(GRAYS, FRONT_CYCLE, 0.66), back: chems([0x000000, 0xffffff, 0x000000, 0xffffff, 0x000000, 0xffffff, 0x000000, 0xffffff], [LARGE, MEDIUM], 0.72) },
  { x: 2.2, z: -6.4, facing: 1, width: 3.4, items: [{ size: POT_S, hex: 0x000000, fill: 0.7 }, { size: POT_S, hex: 0xffffff, fill: 0.7 }, { size: POT_M, hex: 0xffd700, fill: 0.65 }, { size: POT_M, hex: 0xff00ff, fill: 0.65 }, { size: POT_L, hex: RED, fill: 0.65 }, { size: POT_L, hex: GREEN, fill: 0.65 }, { size: POT_L, hex: BLUE, fill: 0.65 }] },
  { x: 6.2, z: -6.4, facing: 1, items: chems([0x3b0a45, 0x0b3d2e, 0x1c1c5c, 0x4a1010, 0x2e2a0a, 0x0a2e3b, 0x2b0f24]), back: backChems([0x301934, 0x013220, 0x000080, 0x3d0c02, 0x353839, 0x0d1b2a]) },

  // South row, then the catalog of fifty along the south wall.
  { x: -6, z: 5.4, facing: -1, items: chems([0xc08080, 0x80c080, 0x8080c0, 0xc0c080, 0x80c0c0, 0xc080c0, 0xa09080]), back: backChems([0xd0a0a0, 0xa0d0a0, 0xa0a0d0, 0xd0d0a0, 0xa0d0d0, 0xd0a0d0]) },
  { x: -2, z: 5.4, facing: -1, width: 3.4, items: [{ size: POT_S, fill: 0.7 }, { size: POT_S, fill: 0 }, { size: POT_M, fill: 0.7 }, { size: POT_M, fill: 0 }, { size: POT_L, fill: 0.7 }, { size: POT_L, fill: 0 }, { size: POT_XL, fill: 0.7 }, { size: POT_XL, fill: 0 }] },
  { x: 2.4, z: 5.4, facing: -1, items: chems([0x4b0082, 0x6a5acd, 0x7b68ee, 0x9370db, 0x8a2be2, 0x9932cc, 0xba55d3]), back: backChems([0x483d8b, 0x6a0dad, 0xccccff, 0xe6e6fa, 0xdda0dd, 0x800080]) },
  { x: 5.6, z: 5.4, facing: -1, items: chems([0x8b0000, 0xb22222, 0xdc143c, 0xff1493, 0xff69b4, 0xdb7093, 0xc71585]), back: backChems([0x800020, 0xaa336a, 0xffb6c1, 0xffc0cb, 0xe75480, 0xf88379]) },

  {
    x: -3.2,
    z: 8.1,
    facing: -1,
    width: 3.8,
    items: chems(CATALOG.slice(0, 25), [MEDIUM], 0.7).map((item) => ({ ...item, exact: true })),
    back: chems(CATALOG.slice(25), [MEDIUM], 0.7).map((item) => ({ ...item, exact: true })),
  },
  {
    x: 7.5,
    z: 2,
    facing: -1,
    items: [
      { size: MEDIUM, hex: 0xc93f38, fill: 0.85, exact: true },
      { size: MEDIUM, hex: 0xffffff, fill: 0.8 },
      { size: LARGE, hex: 0xffffff, fill: 0.75 },
      { size: MEDIUM, hex: 0xffffff, fill: 0.8 },
      { size: LARGE, hex: 0xffffff, fill: 0.75 },
      { size: MEDIUM, hex: 0xffffff, fill: 0.8 },
    ],
  },
];

export function createLab(scene: THREE.Scene, world: RAPIER.World): Beaker[] {
  const shell = whiteSurface(0.94);
  const topMaterial = whiteSurface(0.5);
  const cabinetMaterial = whiteSurface(0.78);
  const trimMaterial = whiteSurface(0.84);
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.1,
  });

  // Floor and walls are collision only. dressLab covers them with the classroom set.
  const w = ROOM_X * 2;
  const d = ROOM_Z * 2;
  addBox(scene, world, shell, w, 0.5, d, 0, -0.25, 0, false);
  addBox(scene, world, shell, w, 0.2, d, 0, ROOM_HEIGHT + 0.1, 0);
  addBox(scene, world, shell, w, ROOM_HEIGHT, 0.2, 0, ROOM_HEIGHT / 2, -ROOM_Z, false);
  addBox(scene, world, shell, w, ROOM_HEIGHT, 0.2, 0, ROOM_HEIGHT / 2, ROOM_Z, false);
  addBox(scene, world, shell, 0.2, ROOM_HEIGHT, d, -ROOM_X, ROOM_HEIGHT / 2, 0, false);
  addBox(scene, world, shell, 0.2, ROOM_HEIGHT, d, ROOM_X, ROOM_HEIGHT / 2, 0, false);

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
  const gap = items.some((item) => item.size.flange) ? POT_GAP : 0.06;
  const span = items.reduce((sum, item) => sum + outerRadius(item.size) * 2, 0) + gap * (items.length - 1);
  let cursor = bench.x - bench.facing * (span / 2);
  for (const item of items) {
    const r = outerRadius(item.size);
    cursor += bench.facing * r;
    // Anything wider than a beaker is pulled back so its front rim stays on the bench edge line.
    const z = edge - bench.facing * Math.max(0, r - 0.04);
    out.push(addVessel(scene, world, item, cursor, z, bench.facing));
    cursor += bench.facing * (r + gap);
  }
}

function outerRadius(size: Size) {
  return size.radius + (size.flange ? FLANGE_WIDTH : 0);
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

function addVessel(scene: THREE.Scene, world: RAPIER.World, stock: Stock, x: number, z: number, facing: 1 | -1): Beaker {
  const { radius, height, density, tray, flange } = stock.size;
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

  const centerY = stock.y ?? BENCH_SURFACE + height / 2;
  const desc = stock.fixed
    ? RAPIER.RigidBodyDesc.fixed().setTranslation(x, centerY, z)
    : RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, centerY, z)
        .setLinearDamping(0.45)
        .setAngularDamping(0.7)
        .setCcdEnabled(true);
  const body = world.createRigidBody(desc);
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cylinder(height / 2, radius)
      .setDensity(density)
      .setFriction(1.4)
      .setRestitution(0.04)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(collisionGroups(PROP_GROUP, ALL_GROUPS)),
    body,
  );

  if (flange) addFlange(world, body, mesh, material, radius, height, density, segments);

  mesh.position.set(x, centerY, z);
  const volume = Math.PI * radius * radius * height * stock.fill;
  return {
    mesh,
    body,
    collider,
    radius,
    height,
    solution:
      stock.hex === undefined
        ? water(volume)
        : stock.hex === MILK
          ? milk(volume)
          : solutionFromHex(stock.exact ? stock.hex : namedColor(stock.hex), volume, STOCK_CONCENTRATION),
    handles: tray ? addTrayHandle(world, body, mesh, material, radius, height, density, facing) : [],
    fixed: stock.fixed,
  };
}

// A ring of thin blocks flush with the mouth. The hole stays open, so pouring is unchanged.
function addFlange(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  mesh: THREE.Group,
  material: THREE.Material,
  radius: number,
  height: number,
  density: number,
  segments: number,
) {
  const outer = radius + FLANGE_WIDTH;
  const top = height / 2;
  for (const y of [top, top - FLANGE_THICK]) {
    const face = new THREE.Mesh(new THREE.RingGeometry(radius, outer, segments), material);
    face.rotation.x = -Math.PI / 2;
    face.position.y = y;
    face.renderOrder = 3;
    mesh.add(face);
  }
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(outer, outer, FLANGE_THICK, segments, 1, true), material);
  edge.position.y = top - FLANGE_THICK / 2;
  edge.renderOrder = 3;
  mesh.add(edge);

  const middle = radius + FLANGE_WIDTH / 2;
  const tangent = outer * Math.tan(Math.PI / FLANGE_SEGMENTS);
  const turn = new THREE.Quaternion();
  for (let i = 0; i < FLANGE_SEGMENTS; i++) {
    const angle = ((i + 0.5) / FLANGE_SEGMENTS) * Math.PI * 2;
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(FLANGE_WIDTH / 2, FLANGE_THICK / 2, tangent)
        .setTranslation(Math.cos(angle) * middle, top - FLANGE_THICK / 2, Math.sin(angle) * middle)
        .setRotation({ x: turn.x, y: turn.y, z: turn.z, w: turn.w })
        .setDensity(density)
        .setFriction(1.4)
        .setRestitution(0.04)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(collisionGroups(PROP_GROUP, ALL_GROUPS)),
      body,
    );
  }
}

function addTrayHandle(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  mesh: THREE.Group,
  material: THREE.Material,
  radius: number,
  height: number,
  density: number,
  facing: 1 | -1,
): Handle[] {
  const postZ = facing * (radius + HANDLE_RADIUS * 0.5);
  const postHalf = (height + HANDLE_RISE) / 2;
  const top = -height / 2 + postHalf * 2;
  const barHalf = HANDLE_REACH / 2 + HANDLE_RADIUS;
  const post = {
    center: new THREE.Vector3(0, -height / 2 + postHalf, postZ),
    axis: new THREE.Vector3(0, 1, 0),
    half: postHalf,
  };
  const bar = {
    center: new THREE.Vector3(0, top, postZ + facing * (HANDLE_REACH / 2)),
    axis: new THREE.Vector3(0, 0, 1),
    half: barHalf,
  };
  const lay = new THREE.Quaternion().setFromUnitVectors(post.axis, bar.axis);
  return [post, bar].map((part) => {
    const turn = part === bar ? lay : new THREE.Quaternion();
    const piece = new THREE.Mesh(new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, part.half * 2, 16), material);
    piece.position.copy(part.center);
    piece.quaternion.copy(turn);
    piece.renderOrder = 3;
    mesh.add(piece);
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(part.half, HANDLE_RADIUS)
        .setTranslation(part.center.x, part.center.y, part.center.z)
        .setRotation({ x: turn.x, y: turn.y, z: turn.z, w: turn.w })
        .setDensity(density)
        .setFriction(1.4)
        .setRestitution(0.04)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(collisionGroups(PROP_GROUP, ALL_GROUPS)),
      body,
    );
    return { ...part, collider, radius: HANDLE_RADIUS };
  });
}

export function syncBeakers(beakers: Beaker[]) {
  for (const beaker of beakers) {
    const position = beaker.body.translation();
    const rotation = beaker.body.rotation();
    beaker.mesh.position.set(position.x, position.y, position.z);
    beaker.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }
}

export let intake: Beaker | null = null;

const readout = document.createElement("canvas");
readout.width = 512;
readout.height = 256;
const readoutCtx = readout.getContext("2d")!;
let readoutMap: THREE.CanvasTexture | null = null;

function paintReadout(nomen: string, name: string, hex: string) {
  const ctx = readoutCtx;
  ctx.fillStyle = "#031208";
  ctx.fillRect(0, 0, readout.width, readout.height);
  ctx.fillStyle = "#39ff7a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "32px Consolas, monospace";
  ctx.fillText(nomen, 256, 78, 480);
  ctx.fillText(name, 256, 128, 480);
  ctx.fillText(hex, 256, 178, 480);
  if (readoutMap) readoutMap.needsUpdate = true;
}

// The cabinet's front decal is a row of labeled buttons. Paint that strip out and leave lamps.
function lampsForButtons(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const map = material.map;
    const image = map?.image as HTMLImageElement | undefined;
    if (!map || !image?.width) return;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const x = Math.round(image.width * 0.268);
    const y = Math.round(image.height * 0.358);
    const w = Math.round(image.width * 0.25);
    const h = Math.round(image.height * 0.062);
    ctx.fillStyle = "#1a1e22";
    ctx.fillRect(x, y, w, h);
    const glow = document.createElement("canvas");
    glow.width = canvas.width;
    glow.height = canvas.height;
    const lights = glow.getContext("2d")!;
    lights.fillStyle = "#000";
    lights.fillRect(0, 0, glow.width, glow.height);
    const colors = ["#39ff7a", "#ffcc33", "#ff5544", "#66ddff", "#d090ff"];
    colors.forEach((color, index) => {
      const cx = x + 28 + index * ((w - 56) / (colors.length - 1));
      const cy = y + h / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fill();
      lights.fillStyle = color;
      lights.beginPath();
      lights.arc(cx, cy, 9, 0, Math.PI * 2);
      lights.fill();
    });
    const next = new THREE.CanvasTexture(canvas);
    next.colorSpace = THREE.SRGBColorSpace;
    next.flipY = map.flipY;
    next.wrapS = map.wrapS;
    next.wrapT = map.wrapT;
    const emissive = new THREE.CanvasTexture(glow);
    emissive.colorSpace = THREE.SRGBColorSpace;
    emissive.flipY = map.flipY;
    material.map = next;
    material.emissiveMap = emissive;
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveIntensity = 1;
    material.needsUpdate = true;
  });
}

function faceBox(root: THREE.Object3D, direction: THREE.Vector3) {
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let best = -Infinity;
  const consider = (keep: (dot: number) => boolean, box?: THREE.Box3) => {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute("position");
      const normals = mesh.geometry.getAttribute("normal");
      if (!position || !normals) return;
      for (let i = 0; i < position.count; i++) {
        normal.fromBufferAttribute(normals, i).transformDirection(mesh.matrixWorld);
        if (normal.dot(direction) < 0.75) continue;
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        const dot = point.dot(direction);
        if (!keep(dot)) continue;
        if (box) box.expandByPoint(point);
        else if (dot > best) best = dot;
      }
    });
  };
  consider(() => true);
  const box = new THREE.Box3();
  consider((dot) => dot > best - 0.03, box);
  return box;
}

function addScreen(parent: THREE.Scene, box: THREE.Box3, direction: THREE.Vector3, map: THREE.Texture) {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const width = direction.x !== 0 ? size.z : size.x;
  const height = size.y;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(width * 0.72, 0.42), Math.min(height * 0.28, 0.24)),
    new THREE.MeshBasicMaterial({ map }),
  );
  screen.position.copy(center).addScaledVector(direction, 0.012);
  screen.lookAt(center.clone().add(direction));
  screen.renderOrder = 2;
  parent.add(screen);
}

// Empties the well after copying the pour onto the screen, so the next pour replaces it.
export function readIntake() {
  const beaker = intake;
  if (!beaker || beaker.solution.volume <= 1e-7) return;
  const sample = toChem(beaker.solution);
  const named = sample.mass > 1e-8;
  paintReadout(named ? latinName(sample.hex) : "—", named ? chemLabel(sample.hex) : "water", named ? sample.hex : "—");
  beaker.solution.volume = 0;
  beaker.solution.mass = 0;
  beaker.solution.cloud = 0;
}

// The retro cabinet stands on the east side, facing the aisle. A well in the top
// catches a pour; the screen on the near face shows the last one.
export function mountAnalyzer(scene: THREE.Scene, world: RAPIER.World, source: THREE.Object3D, beakers: Beaker[]) {
  const model = source.clone(true);
  model.rotation.y = -Math.PI / 2;
  model.position.set(9.05, 0, -0.5);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  scene.add(model);
  lampsForButtons(model);

  const fitted = new THREE.Box3().setFromObject(model);
  const top = fitted.max.y;
  const cx = (fitted.min.x + fitted.max.x) / 2;
  const cz = (fitted.min.z + fitted.max.z) / 2;

  const hole = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.012, 10, 40),
    new THREE.MeshStandardMaterial({
      color: 0x0c2e1c,
      emissive: 0x39ff7a,
      emissiveIntensity: 3,
      roughness: 0.35,
    }),
  );
  hole.rotation.x = Math.PI / 2;
  hole.position.set(cx, top + 0.006, cz);
  scene.add(hole);
  const glow = new THREE.PointLight(0x39ff7a, 0.8, 1.4);
  glow.position.set(cx, top + 0.02, cz);
  scene.add(glow);

  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.043, 0.04, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  pit.position.set(cx, top - 0.012, cz);
  scene.add(pit);

  const vessel = addVessel(
    scene,
    world,
    { size: { radius: 0.06, height: 0.1, density: 1 }, fill: 0, fixed: true, y: top - 0.04 },
    cx,
    cz,
    1,
  );
  beakers.push(vessel);
  intake = vessel;
  vessel.mesh.visible = false;

  const height = top - 0.12;
  const midY = height / 2;
  const spanX = fitted.max.x - fitted.min.x;
  const spanZ = fitted.max.z - fitted.min.z;
  const thick = 0.05;
  addBox(scene, world, shellInvisible(), thick, height, spanZ, fitted.min.x + thick / 2, midY, cz, false);
  addBox(scene, world, shellInvisible(), thick, height, spanZ, fitted.max.x - thick / 2, midY, cz, false);
  addBox(scene, world, shellInvisible(), spanX, height, thick, cx, midY, fitted.min.z + thick / 2, false);
  addBox(scene, world, shellInvisible(), spanX, height, thick, cx, midY, fitted.max.z - thick / 2, false);

  paintReadout("—", "—", "—");
  readoutMap = new THREE.CanvasTexture(readout);
  readoutMap.colorSpace = THREE.SRGBColorSpace;
  const towardAisle = new THREE.Vector3(-1, 0, 0);
  const side = new THREE.Vector3(0, 0, 1);
  addScreen(scene, faceBox(model, towardAisle), towardAisle, readoutMap);
  addScreen(scene, faceBox(model, side), side, readoutMap);
}

const invisible = new THREE.MeshStandardMaterial();
function shellInvisible() {
  return invisible;
}
