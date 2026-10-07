import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { blankReadout, substanceReadout, type Readout } from "./fluid/readout";
import { milk, solutionFromHex, STOCK_CONCENTRATION, water, type Solution } from "./fluid/solution";
import { namedColor } from "./sim/colorName";
import { drawFood } from "./sim/food";
import { drawStock, type HueSlot } from "./sim/labStock";
import { createRng } from "./sim/rng";
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
// Glass thickness of the physics shell. The mouth stays wide enough that a smaller
// beaker (radius 0.034) fits through a larger one (radius 0.04).
const WALL = 0.0015;
const WALL_SEGMENTS = 16;
// Room between pots for a hand to get round the side of one.
const POT_GAP = 0.14;

// White lets every colour through, so a white stock is stocked as milk to be seen at all.
const MILK = 0xffffff;

const BENCH_TOP = 0.9;
// Top of the bench box. Dressing sits instruments on this.
export const BENCH_SURFACE = BENCH_TOP + 0.035;
export const BENCH_WIDTH = 1.55;
export const BENCH_DEPTH = 0.78;
// Distance from the bench centre line to the front row of glass, and to the row behind it.
const FRONT_ROW = BENCH_DEPTH / 2 - 0.13;
const BACK_ROW = FRONT_ROW - 0.2;

// Half extents of the room. dressing.ts lays 2m wall modules along these, so keep them whole metres.
export const ROOM_X = 14;
export const ROOM_Z = 12;
export const ROOM_HEIGHT = 5.4;

// The industrial exit wall on the south side spans EXIT_SPAN metres of wall modules,
// centred on EXIT_X. The player never goes through it.
export const EXIT_X = 4;
export const EXIT_SPAN = 8;
// The exit door's clear opening, centred on DOOR_X in the south wall. The wall's collider
// leaves this gap, and exit.ts fills it with a hinged leaf and a short corridor behind.
export const DOOR_X = EXIT_X - 2.5;
export const DOOR_WIDTH = 1;
export const DOOR_HEIGHT = 2;

// Coloured benches lined up in front of the exit, listed from the player's left. They stand
// about 2m off the wall so the exit door can swing in and someone can walk out past it.
const STATION_Z = ROOM_Z - 2.6;
export const STATIONS = [
  { hex: 0xff0000, x: EXIT_X + 2, z: STATION_Z },
  { hex: 0x00ff00, x: EXIT_X, z: STATION_Z },
  { hex: 0x0000ff, x: EXIT_X - 2, z: STATION_Z },
];

type Stock = { size: Size; hex?: number; fill: number; exact?: boolean; fixed?: boolean; y?: number };
type Bench = {
  label: string;
  x: number;
  z: number;
  facing: 1 | -1;
  width?: number;
  color?: number;
  items: Stock[];
  back?: Stock[];
  backRow?: number;
};

const FRONT_CYCLE = [MEDIUM, MEDIUM, LARGE, MEDIUM];
const BACK_CYCLE = [MEDIUM, LARGE];

function chems(hexes: number[], cycle = FRONT_CYCLE, fill = 0.62): Stock[] {
  return hexes.map((hex, i) => ({ size: cycle[i % cycle.length], hex, fill }));
}

function waters(sizes: Size[], fill = 0.75): Stock[] {
  return sizes.map((size) => ({ size, fill }));
}

function empties(sizes: Size[]): Stock[] {
  return sizes.map((size) => ({ size, fill: 0 }));
}

function named(hexes: number[], cycle = FRONT_CYCLE, fill = 0.62): Stock[] {
  return hexes.map((hex, i) => ({ size: cycle[i % cycle.length], hex, fill, exact: true }));
}

function largePots(hexes: number[]): Stock[] {
  return hexes.map((hex) => ({ size: POT_L, hex, fill: 0.65, exact: true }));
}

// Every vessel the lab has, smallest to largest. A supply bench fills the aisle row
// with water and leaves the same sizes empty behind it.
const SUPPLY: Size[] = [MEDIUM, LARGE, TRAY, POT_S, POT_M, POT_L, POT_XL];

function supply(x: number, z: number, facing: 1 | -1): Bench {
  return {
    label: "Water",
    x,
    z,
    facing,
    width: 2.4,
    items: SUPPLY.map((size) => ({ size, fill: size.flange ? 0.7 : 0.8 })),
    back: empties(SUPPLY),
    backRow: POT_BACK,
  };
}

// One bench per hue stem, in wheel order. `stem` is the 30° bin used by latinName.
const HUE_TABLES: (HueSlot & { x: number; z: number; facing: 1 | -1; width?: number })[] = [
  { stem: 0, x: -7.5, z: -1.8, facing: 1, front: 7, back: 6 },
  { stem: 1, x: -2.5, z: -1.8, facing: 1, front: 7, back: 6 },
  { stem: 2, x: 0, z: -1.8, facing: 1, front: 7, back: 6 },
  { stem: 3, x: 2.5, z: -1.8, facing: 1, front: 7, back: 6 },
  { stem: 4, x: 5, z: -1.8, facing: 1, front: 7, back: 6 },
  { stem: 5, x: -7.5, z: 2, facing: -1, front: 7, back: 6 },
  { stem: 6, x: -5, z: 2, facing: -1, front: 7, back: 6 },
  { stem: 7, x: 0, z: 2, facing: -1, front: 7, back: 6 },
  { stem: 8, x: 2.5, z: 2, facing: -1, front: 7, back: 6 },
  { stem: 9, x: 5, z: 2, facing: -1, front: 7, back: 6 },
  { stem: 10, x: -6, z: -6.4, facing: 1, front: 7, back: 6 },
  { stem: 11, x: -2, z: -6.4, facing: 1, width: 3.4, front: 10, back: 8 },
];

// Large pots need a deeper second row than beakers. Centres stay on the bench.
const POT_BACK = FRONT_ROW - 0.34;
const ELEMENTAL_POTS = 20;

// Benches run left to right; items are listed from the player's left along the edge
// nearest the aisle, and `back` is a second row behind them. A missing hex is water;
// a zero fill is an empty vessel. Rows pair up across aisles: facing 1 is worked from
// the south side, facing -1 from the north.
const CATALOG = catalog.filter((entry) => entry.category !== "food").map((entry) => parseInt(entry.hex.slice(1), 16));
const HUE_NAMES = ["Reds", "Oranges", "Yellows", "Limes", "Greens", "Mints", "Cyans", "Azures", "Blues", "Violets", "Purples", "Pinks"];

function benches(seed: number): Bench[] {
  const drawn = drawStock(createRng(seed), HUE_TABLES, ELEMENTAL_POTS);
  const food = drawFood(createRng(seed + 1)).map((hex) => parseInt(hex.slice(1), 16));
  const hues: Bench[] = HUE_TABLES.map((slot, index) => ({
    label: HUE_NAMES[slot.stem],
    x: slot.x,
    z: slot.z,
    facing: slot.facing,
    width: slot.width,
    items: named(drawn.hues[index].front),
    back: named(drawn.hues[index].back, BACK_CYCLE, 0.66),
  }));
  return [
    ...hues,
    {
      label: "Elementals",
      x: 2.55,
      z: -6.4,
      facing: 1,
      width: 4.2,
      items: largePots(drawn.elementals.front),
      back: largePots(drawn.elementals.back),
      backRow: POT_BACK,
    },
    { label: "Water", x: -5, z: -1.8, facing: 1, items: [...waters([MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM], 0.8), { size: TRAY, fill: 0 }], back: waters([MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM]) },
    { label: "Glassware", x: -2.5, z: 2, facing: -1, items: empties([TRAY, LARGE, MEDIUM, MEDIUM, TRAY]), back: empties([MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM, MEDIUM]) },
    { label: "Pots", x: -2, z: 5.4, facing: -1, width: 3.4, items: [{ size: POT_S, fill: 0.7 }, { size: POT_S, fill: 0 }, { size: POT_M, fill: 0.7 }, { size: POT_M, fill: 0 }, { size: POT_L, fill: 0.7 }, { size: POT_L, fill: 0 }, { size: POT_XL, fill: 0.7 }, { size: POT_XL, fill: 0 }] },
    supply(-6, 5.4, -1),
    supply(1.9, 5.4, -1),
    supply(5.5, 5.4, -1),
    supply(6.8, -6.4, 1),
    {
      label: "Catalog",
      x: -3.2,
      z: 8.1,
      facing: -1,
      width: 3.8,
      items: chems(CATALOG.slice(0, 25), [MEDIUM], 0.7).map((item) => ({ ...item, exact: true })),
      back: chems(CATALOG.slice(25), [MEDIUM], 0.7).map((item) => ({ ...item, exact: true })),
    },
    { label: "Food", x: -8.6, z: 8.1, facing: -1, width: 2.6, items: named(food, [MEDIUM, LARGE, MEDIUM], 0.7) },
    {
      label: "Water",
      x: 7.5,
      z: 2,
      facing: -1,
      items: waters([MEDIUM, LARGE, MEDIUM, LARGE, MEDIUM], 0.8),
    },
    ...STATIONS.map((station, i): Bench => ({ label: ["Red", "Green", "Blue"][i], x: station.x, z: station.z, facing: -1, color: station.hex, items: [] })),
  ];
}

export function createLab(scene: THREE.Scene, world: RAPIER.World, seed = (Math.random() * 0x100000000) >>> 0): Beaker[] {
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
  const doorLeft = DOOR_X - DOOR_WIDTH / 2;
  const doorRight = DOOR_X + DOOR_WIDTH / 2;
  addBox(scene, world, shell, doorLeft + ROOM_X, ROOM_HEIGHT, 0.2, (doorLeft - ROOM_X) / 2, ROOM_HEIGHT / 2, ROOM_Z, false);
  addBox(scene, world, shell, ROOM_X - doorRight, ROOM_HEIGHT, 0.2, (doorRight + ROOM_X) / 2, ROOM_HEIGHT / 2, ROOM_Z, false);
  addBox(scene, world, shell, DOOR_WIDTH, ROOM_HEIGHT - DOOR_HEIGHT, 0.2, DOOR_X, (ROOM_HEIGHT + DOOR_HEIGHT) / 2, ROOM_Z, false);
  addBox(scene, world, shell, 0.2, ROOM_HEIGHT, d, -ROOM_X, ROOM_HEIGHT / 2, 0, false);
  addBox(scene, world, shell, 0.2, ROOM_HEIGHT, d, ROOM_X, ROOM_HEIGHT / 2, 0, false);

  const beakers: Beaker[] = [];
  for (const bench of benches(seed)) {
    const width = bench.width ?? BENCH_WIDTH;
    const paint = bench.color === undefined ? null : new THREE.MeshStandardMaterial({ color: bench.color, roughness: 0.5 });
    addBench(scene, world, bench.x, bench.z, width, paint ?? topMaterial, paint ?? cabinetMaterial, trimMaterial);
    addLabel(scene, bench, width);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, 0.02, 0.3), panelMaterial);
    panel.position.set(bench.x, ROOM_HEIGHT - 0.01, bench.z);
    scene.add(panel);
    // Items line the aisle-side edge, within arm's length of someone standing at the bench.
    lineUp(scene, world, bench, bench.items, FRONT_ROW, beakers);
    if (bench.back) lineUp(scene, world, bench, bench.back, bench.backRow ?? BACK_ROW, beakers);
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

const LABEL_HEIGHT = 0.024;
const LABEL_MARGIN = 0.025;

// Printed on the bench top in the corner nearest the player's right hand, reading toward the aisle.
function addLabel(scene: THREE.Scene, bench: Bench, width: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.fillStyle = bench.color === undefined ? "#4a4d50" : "#f4f4f2";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(bench.label.toUpperCase(), canvas.width - 4, canvas.height / 2 + 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const labelWidth = (LABEL_HEIGHT * canvas.width) / canvas.height;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(labelWidth, LABEL_HEIGHT),
    new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  label.rotation.set(-Math.PI / 2, 0, bench.facing === 1 ? 0 : Math.PI);
  label.position.set(
    bench.x + bench.facing * (width / 2 - LABEL_MARGIN - labelWidth / 2),
    BENCH_SURFACE + 0.0005,
    bench.z + bench.facing * (BENCH_DEPTH / 2 - LABEL_MARGIN - LABEL_HEIGHT / 2),
  );
  label.receiveShadow = true;
  scene.add(label);
}

export function addBox(
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

const glass = new THREE.MeshStandardMaterial({
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

function markShadow(mesh: THREE.Mesh) {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
}

// A floor and a ring of wall blocks, open at the top, with the same mass a solid
// cylinder of this size would have had. The hole is what lets a smaller vessel drop in.
function addShell(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  radius: number,
  height: number,
  density: number,
) {
  const inner = radius - WALL;
  const bottomHalf = 0.0035;
  const bottomRadius = Math.max(0.004, inner - 0.001);
  const tangent = inner * Math.tan(Math.PI / WALL_SEGMENTS);
  const wallVolume = WALL_SEGMENTS * WALL * height * tangent * 2;
  const bottomVolume = Math.PI * bottomRadius * bottomRadius * bottomHalf * 2;
  const shellDensity = (density * Math.PI * radius * radius * height) / (wallVolume + bottomVolume);
  const props = (desc: RAPIER.ColliderDesc) =>
    desc
      .setDensity(shellDensity)
      .setFriction(1.4)
      .setRestitution(0.04)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(collisionGroups(PROP_GROUP, ALL_GROUPS));

  const bottom = world.createCollider(
    props(RAPIER.ColliderDesc.cylinder(bottomHalf, bottomRadius).setTranslation(0, -height / 2 + bottomHalf, 0)),
    body,
  );
  const turn = new THREE.Quaternion();
  const mid = inner + WALL / 2;
  for (let i = 0; i < WALL_SEGMENTS; i++) {
    const angle = ((i + 0.5) / WALL_SEGMENTS) * Math.PI * 2;
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
    world.createCollider(
      props(
        RAPIER.ColliderDesc.cuboid(WALL / 2, height / 2, tangent)
          .setTranslation(Math.cos(angle) * mid, 0, Math.sin(angle) * mid)
          .setRotation({ x: turn.x, y: turn.y, z: turn.z, w: turn.w }),
      ),
      body,
    );
  }
  return bottom;
}

export function addVessel(scene: THREE.Scene, world: RAPIER.World, stock: Stock, x: number, z: number, facing: 1 | -1): Beaker {
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
  for (const piece of [wall, bottom, rim]) markShadow(piece);

  mesh.add(wall, bottom, rim);
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
  const collider = addShell(world, body, radius, height, density);

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
    markShadow(face);
    mesh.add(face);
  }
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(outer, outer, FLANGE_THICK, segments, 1, true), material);
  edge.position.y = top - FLANGE_THICK / 2;
  edge.renderOrder = 3;
  markShadow(edge);
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
    markShadow(piece);
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

/** A paid litre, already on a counter. The caller registers it with the fluid sim. */
export function spawnDelivery(
  scene: THREE.Scene,
  world: RAPIER.World,
  fill: "water" | "milk" | number,
  litres: number,
  x: number,
  z: number,
): Beaker {
  const volume = Math.max(0.00005, litres * 0.001);
  const sizes = [MEDIUM, LARGE, POT_S, POT_M, POT_L, POT_XL];
  let size = POT_XL;
  for (const candidate of sizes) {
    const capacity = Math.PI * candidate.radius * candidate.radius * candidate.height * 0.72;
    if (capacity >= volume) {
      size = candidate;
      break;
    }
  }
  const full = Math.PI * size.radius * size.radius * size.height;
  const stock: Stock = {
    size,
    fill: Math.min(volume, full * 0.72) / full,
    exact: true,
    hex: fill === "water" ? undefined : fill === "milk" ? MILK : fill,
  };
  return addVessel(scene, world, stock, x, z, -1);
}

export function removeVessel(scene: THREE.Scene, world: RAPIER.World, beakers: Beaker[], beaker: Beaker) {
  const index = beakers.indexOf(beaker);
  if (index >= 0) beakers.splice(index, 1);
  scene.remove(beaker.mesh);
  beaker.mesh.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
  world.removeRigidBody(beaker.body);
}

export function syncBeakers(beakers: Beaker[]) {
  for (const beaker of beakers) {
    const position = beaker.body.translation();
    const rotation = beaker.body.rotation();
    beaker.mesh.position.set(position.x, position.y, position.z);
    beaker.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }
}

const nestPos = new THREE.Vector3();
const nestLocal = new THREE.Vector3();
const nestAxis = new THREE.Vector3();
const nestOuterInv = new THREE.Quaternion();
const nestInnerQuat = new THREE.Quaternion();
const nests: { inner: Beaker; outer: Beaker; joint: RAPIER.ImpulseJoint }[] = [];

// True when `inner` is down inside `outer`, not merely beside it or above the rim.
export function vesselContains(outer: Beaker, inner: Beaker) {
  return localInVessel(outer, inner, nestLocal);
}

function localInVessel(outer: Beaker, inner: Beaker, out: THREE.Vector3) {
  if (outer.radius < inner.radius + 0.006) return false;
  const op = outer.body.translation();
  const or = outer.body.rotation();
  const ip = inner.body.translation();
  const dx = ip.x - op.x;
  const dy = ip.y - op.y;
  const dz = ip.z - op.z;
  const reach = outer.radius + outer.height + inner.height;
  if (dx * dx + dy * dy + dz * dz > reach * reach) return false;
  nestOuterInv.set(or.x, or.y, or.z, or.w).invert();
  out.set(dx, dy, dz).applyQuaternion(nestOuterInv);
  const radial = Math.hypot(out.x, out.z);
  if (radial > Math.max(0.012, outer.radius - inner.radius * 0.7)) return false;
  const half = outer.height / 2;
  if (out.y > half - 0.02) return false;
  if (out.y < -half - inner.height * 0.5) return false;
  return true;
}

function supportY(outer: Beaker) {
  return -outer.height / 2 + 0.009;
}

function innerBottom(outer: Beaker, inner: Beaker) {
  const or = outer.body.rotation();
  nestOuterInv.set(or.x, or.y, or.z, or.w).invert();
  const ir = inner.body.rotation();
  nestInnerQuat.set(ir.x, ir.y, ir.z, ir.w);
  nestAxis.set(0, 1, 0).applyQuaternion(nestInnerQuat).applyQuaternion(nestOuterInv);
  return nestLocal.y - nestAxis.y * (inner.height / 2);
}

function seatInVessel(outer: Beaker, inner: Beaker) {
  const bottom = innerBottom(outer, inner);
  const support = supportY(outer);
  if (bottom >= support - 0.001) return;
  nestLocal.y += support - bottom;
  const op = outer.body.translation();
  const or = outer.body.rotation();
  nestOuterInv.set(or.x, or.y, or.z, or.w);
  nestPos.copy(nestLocal).applyQuaternion(nestOuterInv).add(nestAxis.set(op.x, op.y, op.z));
  inner.body.setTranslation({ x: nestPos.x, y: nestPos.y, z: nestPos.z }, true);
  const velocity = inner.body.linvel();
  if (velocity.y < 0) inner.body.setLinvel({ x: velocity.x, y: 0, z: velocity.z }, true);
}

function restingIn(outer: Beaker, inner: Beaker) {
  if (innerBottom(outer, inner) > supportY(outer) + 0.03) return false;
  const velocity = inner.body.linvel();
  return Math.hypot(velocity.x, velocity.y, velocity.z) < 0.6;
}

function weldNest(world: RAPIER.World, outer: Beaker, inner: Beaker) {
  const op = outer.body.translation();
  const or = outer.body.rotation();
  const ip = inner.body.translation();
  const ir = inner.body.rotation();
  nestOuterInv.set(or.x, or.y, or.z, or.w).invert();
  nestPos.set(ip.x - op.x, ip.y - op.y, ip.z - op.z).applyQuaternion(nestOuterInv);
  nestInnerQuat.set(ir.x, ir.y, ir.z, ir.w);
  nestOuterInv.multiply(nestInnerQuat);
  const joint = world.createImpulseJoint(
    RAPIER.JointData.fixed(
      { x: nestPos.x, y: nestPos.y, z: nestPos.z },
      { x: nestOuterInv.x, y: nestOuterInv.y, z: nestOuterInv.z, w: nestOuterInv.w },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
    ),
    outer.body,
    inner.body,
    true,
  );
  joint.setContactsEnabled(false);
  return joint;
}

function carrierOf(beakers: Beaker[], inner: Beaker) {
  let best: Beaker | null = null;
  for (const outer of beakers) {
    if (outer === inner || outer.radius < inner.radius + 0.006) continue;
    if (!localInVessel(outer, inner, nestLocal)) continue;
    if (!best || outer.radius < best.radius) best = outer;
  }
  return best;
}

function dropNest(world: RAPIER.World, index: number) {
  const nest = nests[index];
  if (nest.joint.isValid()) world.removeImpulseJoint(nest.joint, true);
  nests.splice(index, 1);
}

const casting = new Set<Beaker>();
let castChanged = false;

function setCast(beaker: Beaker, on: boolean) {
  if (on === casting.has(beaker)) return;
  castChanged = true;
  if (on) casting.add(beaker);
  else casting.delete(beaker);
  beaker.mesh.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = on;
  });
}

// A smaller vessel that has settled inside a larger one is welded there, so lifting
// the outer one cannot leave it behind to fall through the floor.
// Returns true when the sun's shadow map is stale: glass that casts has moved or
// started or stopped casting.
export function containVessels(beakers: Beaker[], world: RAPIER.World, held: Beaker[]): boolean {
  const carried = new Set(held);
  for (let i = nests.length - 1; i >= 0; i--) {
    const nest = nests[i];
    if (carried.has(nest.inner) || !vesselContains(nest.outer, nest.inner)) dropNest(world, i);
  }
  for (const inner of beakers) {
    if (inner.fixed || carried.has(inner)) continue;
    const outer = carrierOf(beakers, inner);
    if (!outer || !localInVessel(outer, inner, nestLocal)) continue;
    const welded = nests.find((nest) => nest.inner === inner);
    if (welded && welded.outer !== outer) dropNest(world, nests.indexOf(welded));
    if (!nests.some((nest) => nest.inner === inner)) {
      seatInVessel(outer, inner);
      if (restingIn(outer, inner)) nests.push({ inner, outer, joint: weldNest(world, outer, inner) });
      else {
        const outerVelocity = outer.body.linvel();
        const innerVelocity = inner.body.linvel();
        if (outerVelocity.y > innerVelocity.y + 0.05) {
          inner.body.setLinvel({ x: outerVelocity.x, y: outerVelocity.y, z: outerVelocity.z }, true);
        }
      }
    }
  }
  // Glass only casts while it is held or welded inside another vessel.
  const onWeld = new Set<Beaker>(held);
  for (const nest of nests) onWeld.add(nest.inner);
  for (const beaker of beakers) setCast(beaker, onWeld.has(beaker));
  const changed = castChanged;
  castChanged = false;
  if (changed) return true;
  for (const beaker of casting) if (!beaker.body.isSleeping()) return true;
  return false;
}

export let intake: Beaker | null = null;

const readout = document.createElement("canvas");
readout.width = 1024;
readout.height = 768;
const readoutCtx = readout.getContext("2d")!;
let readoutMap: THREE.CanvasTexture | null = null;

const LABEL = "#1f8f48";
const INK = "#39ff7a";

function paintSpec(spec: { label: string; value: string }, x: number, y: number, valueX: number) {
  const ctx = readoutCtx;
  ctx.fillStyle = LABEL;
  ctx.textAlign = "left";
  ctx.fillText(spec.label, x, y);
  ctx.fillStyle = INK;
  ctx.textAlign = "right";
  ctx.fillText(spec.value, valueX, y);
}

function paintReadout(read: Readout) {
  const ctx = readoutCtx;
  ctx.fillStyle = "#031208";
  ctx.fillRect(0, 0, readout.width, readout.height);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = "52px Consolas, monospace";
  ctx.fillText(read.title, 40, 52, 940);
  ctx.font = "30px Consolas, monospace";
  ctx.fillText(read.latin, 40, 108, 940);
  ctx.fillText(read.hex, 40, 154, 820);
  if (read.hex.startsWith("#")) {
    ctx.fillStyle = read.hex;
    ctx.fillRect(948, 136, 36, 36);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(948, 136, 36, 36);
  }
  ctx.fillStyle = LABEL;
  ctx.font = "22px Consolas, monospace";
  ctx.fillText("SOLUTE", 40, 214);
  ctx.fillText("LIQUID", 540, 214);
  ctx.fillStyle = "#0c3d22";
  ctx.fillRect(40, 236, 944, 2);
  ctx.font = "30px Consolas, monospace";
  const rows = Math.max(read.solute.length, read.liquid.length);
  for (let i = 0; i < rows; i++) {
    const y = 278 + i * 52;
    if (read.solute[i]) paintSpec(read.solute[i], 40, y, 490);
    if (read.liquid[i]) paintSpec(read.liquid[i], 540, y, 984);
  }
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

export function faceBox(root: THREE.Object3D, direction: THREE.Vector3) {
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
  const faceW = direction.x !== 0 ? size.z : size.x;
  const width = Math.min(faceW * 0.88, 0.5);
  const height = Math.min(size.y * 0.55, width * 0.75);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map }),
  );
  screen.position.copy(center).addScaledVector(direction, 0.012);
  screen.lookAt(center.clone().add(direction));
  screen.renderOrder = 2;
  parent.add(screen);
}

// Full width of the broad side, tall enough for the readout, flush with the top of that face.
function addBroadScreen(parent: THREE.Scene, box: THREE.Box3, direction: THREE.Vector3, map: THREE.Texture) {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const width = direction.x !== 0 ? size.z : size.x;
  const height = Math.min(size.y, width * (readout.height / readout.width));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map }));
  screen.position.copy(center);
  screen.position.y = box.max.y - height / 2;
  screen.position.addScaledVector(direction, 0.012);
  screen.lookAt(screen.position.clone().add(direction));
  screen.renderOrder = 2;
  parent.add(screen);
}

// Empties the well after copying the pour onto the screen, so the next pour replaces it.
export function readIntake() {
  const beaker = intake;
  if (!beaker || beaker.solution.volume <= 1e-7) return;
  paintReadout(substanceReadout(beaker.solution));
  beaker.solution.volume = 0;
  beaker.solution.mass = 0;
  beaker.solution.cloud = 0;
}

// The retro cabinet stands on the east side, facing the aisle. A well in the top
// catches a pour. The near face and the broad side show the last one.
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
    { size: { radius: WELL_RADIUS, height: 0.1, density: 1 }, fill: 0, fixed: true, y: top - 0.04 },
    cx,
    cz,
    1,
  );
  beakers.push(vessel);
  intake = vessel;
  vessel.mesh.visible = false;

  addCabinetShell(scene, world, fitted, WELL_RADIUS);

  paintReadout(blankReadout());
  readoutMap = new THREE.CanvasTexture(readout);
  readoutMap.colorSpace = THREE.SRGBColorSpace;
  const towardAisle = new THREE.Vector3(-1, 0, 0);
  const broadSide = new THREE.Vector3(0, 0, 1);
  addScreen(scene, faceBox(model, towardAisle), towardAisle, readoutMap);
  addBroadScreen(scene, faceBox(model, broadSide), broadSide, readoutMap);
  return model;
}

// Radius of the fixed vessel sunk into a cabinet's well.
export const WELL_RADIUS = 0.06;
const CABINET_SLAB = 0.03;

// Invisible walls round a cabinet, capped by a slab flush with its top so glass can stand
// there and spills puddle on it. The slab leaves a square cutout over the well; the well's
// round shell fills it, so a pour or an overflowing puddle still drops into the well.
export function addCabinetShell(scene: THREE.Scene, world: RAPIER.World, fitted: THREE.Box3, hole: number) {
  const top = fitted.max.y;
  const cx = (fitted.min.x + fitted.max.x) / 2;
  const cz = (fitted.min.z + fitted.max.z) / 2;
  const spanX = fitted.max.x - fitted.min.x;
  const spanZ = fitted.max.z - fitted.min.z;
  const thick = 0.05;
  const height = top - CABINET_SLAB;
  const midY = height / 2;
  const mat = shellInvisible();
  addBox(scene, world, mat, thick, height, spanZ, fitted.min.x + thick / 2, midY, cz, false);
  addBox(scene, world, mat, thick, height, spanZ, fitted.max.x - thick / 2, midY, cz, false);
  addBox(scene, world, mat, spanX, height, thick, cx, midY, fitted.min.z + thick / 2, false);
  addBox(scene, world, mat, spanX, height, thick, cx, midY, fitted.max.z - thick / 2, false);

  const slabY = top - CABINET_SLAB / 2;
  const westW = cx - hole - fitted.min.x;
  const eastW = fitted.max.x - (cx + hole);
  const northD = cz - hole - fitted.min.z;
  const southD = fitted.max.z - (cz + hole);
  addBox(scene, world, mat, westW, CABINET_SLAB, spanZ, fitted.min.x + westW / 2, slabY, cz, false);
  addBox(scene, world, mat, eastW, CABINET_SLAB, spanZ, fitted.max.x - eastW / 2, slabY, cz, false);
  addBox(scene, world, mat, hole * 2, CABINET_SLAB, northD, cx, slabY, fitted.min.z + northD / 2, false);
  addBox(scene, world, mat, hole * 2, CABINET_SLAB, southD, cx, slabY, fitted.max.z - southD / 2, false);
}

const invisible = new THREE.MeshStandardMaterial();
export function shellInvisible() {
  return invisible;
}
