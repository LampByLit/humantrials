import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { addBox, DOOR_HEIGHT, DOOR_WIDTH, DOOR_X, EXIT_SPAN, EXIT_X, ROOM_Z } from "./lab";
import { whiteSurface } from "./theme";

const WORLD_GROUP = 0x0002;
const ALL_GROUPS = 0xffff;

// The shell collider is 0.2m thick on ROOM_Z. The exit's panels sit on its inner face,
// a little proud of the plain wall band, and its posts stand into the room.
const BACK = ROOM_Z - 0.1;
const PANEL = 0.1;
const FRONT = BACK - PANEL;
const HEIGHT = 2.49;
const POST_WIDTH = 0.54;
const POST_DEPTH = 0.4;
const TRIM = 0.19;
const JAMB = 0.1;
const LEAF = 0.05;
const CORRIDOR_WIDTH = 1.6;
const CORRIDOR_HEIGHT = 2.4;
const CORRIDOR_DEPTH = 3;
const OPEN_ANGLE = Math.PI / 2;
const SWING_SECONDS = 1.2;

function collisionGroups(membership: number, filter: number) {
  return (filter << 16) | membership;
}

type Waiter = { target: number; resolve: () => void };

const door = {
  target: 0,
  progress: 0,
  angle: 0,
  pivot: null as THREE.Object3D | null,
  body: null as RAPIER.RigidBody | null,
  waiters: [] as Waiter[],
};

function swing(target: number) {
  door.target = target;
  if (door.progress === target) return Promise.resolve();
  return new Promise<void>((resolve) => door.waiters.push({ target, resolve }));
}

// The lab's exit door. Jane opens it to come and go; the promise settles once the leaf stops.
export const exitDoor = {
  open: () => swing(1),
  close: () => swing(0),
  toggle: () => swing(door.target === 1 ? 0 : 1),
  get isOpen() {
    return door.target === 1;
  },
  /** 0 shut, 1 fully open. */
  get progress() {
    return door.progress;
  },
  /** Floor point just inside the room, in front of the doorway. */
  inside: new THREE.Vector3(DOOR_X, 0, FRONT - 0.6),
  /** Floor point in the corridor behind the door. */
  outside: new THREE.Vector3(DOOR_X, 0, ROOM_Z + CORRIDOR_DEPTH / 2),
};

const smooth = (t: number) => t * t * (3 - 2 * t);
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);

/** Moves the leaf toward its target. True while it is moving, so shadows can be redrawn. */
export function stepExitDoor(dt: number) {
  if (door.progress === door.target) return false;
  const step = dt / SWING_SECONDS;
  door.progress = door.target > door.progress ? Math.min(door.target, door.progress + step) : Math.max(door.target, door.progress - step);
  door.angle = OPEN_ANGLE * smooth(door.progress);
  turn.setFromAxisAngle(up, door.angle);
  door.pivot?.quaternion.copy(turn);
  door.body?.setNextKinematicRotation(turn);
  if (door.progress === door.target) {
    const done = door.waiters.filter((waiter) => waiter.target === door.target);
    door.waiters = door.waiters.filter((waiter) => waiter.target !== door.target);
    for (const waiter of done) waiter.resolve();
  }
  return true;
}

function hazardStripes(repeatX: number, repeatY: number) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1c1c1c";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#f2c200";
  ctx.lineWidth = size / Math.SQRT2 / 2;
  for (const c of [0, size, size * 2]) {
    ctx.beginPath();
    ctx.moveTo(c + 16, -16);
    ctx.lineTo(c - size - 16, size + 16);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 });
}

function mesh(scene: THREE.Object3D, material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  piece.position.set(x, y, z);
  piece.castShadow = true;
  piece.receiveShadow = true;
  scene.add(piece);
  return piece;
}

/** Builds the industrial exit on the south wall: posts, panels, a striped frame, a hinged door, and the corridor behind it. */
export function buildExit(scene: THREE.Scene, world: RAPIER.World) {
  const plaster = whiteSurface(0.94);
  const steel = whiteSurface(0.8);
  const leafPaint = whiteSurface(0.7);
  const handleMetal = new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.8, roughness: 0.35 });

  const left = EXIT_X - EXIT_SPAN / 2;
  const right = EXIT_X + EXIT_SPAN / 2;
  const doorLeft = DOOR_X - DOOR_WIDTH / 2;
  const doorRight = DOOR_X + DOOR_WIDTH / 2;
  const panelZ = BACK - PANEL / 2;
  const panelY = HEIGHT / 2;

  for (const x of [left + POST_WIDTH / 2, EXIT_X, right - POST_WIDTH / 2]) {
    mesh(scene, steel, POST_WIDTH, HEIGHT, POST_DEPTH, x, panelY, BACK - POST_DEPTH / 2);
  }

  const panel = (from: number, to: number, bottom = 0) => {
    if (to - from <= 0) return;
    mesh(scene, plaster, to - from, HEIGHT - bottom, PANEL, (from + to) / 2, (HEIGHT + bottom) / 2, panelZ);
  };
  const midLeft = EXIT_X - POST_WIDTH / 2;
  const midRight = EXIT_X + POST_WIDTH / 2;
  panel(left + POST_WIDTH, doorLeft - JAMB);
  panel(doorLeft - JAMB, doorRight + JAMB, DOOR_HEIGHT + JAMB);
  panel(doorRight + JAMB, midLeft);
  panel(midRight, right - POST_WIDTH);
  mesh(scene, steel, right - left - POST_WIDTH * 2, TRIM, PANEL, EXIT_X, HEIGHT - TRIM / 2, FRONT - PANEL / 2);

  // The frame lines the doorway through the whole wall, so it reads from the corridor too.
  const frameDepth = ROOM_Z + 0.1 - (FRONT - 0.04);
  const frameZ = (ROOM_Z + 0.1 + FRONT - 0.04) / 2;
  const sideStripes = hazardStripes(1, DOOR_HEIGHT / 0.1);
  const topStripes = hazardStripes((DOOR_WIDTH + JAMB * 2) / 0.1, 1);
  mesh(scene, sideStripes, JAMB, DOOR_HEIGHT + JAMB, frameDepth, doorLeft - JAMB / 2, (DOOR_HEIGHT + JAMB) / 2, frameZ);
  mesh(scene, sideStripes, JAMB, DOOR_HEIGHT + JAMB, frameDepth, doorRight + JAMB / 2, (DOOR_HEIGHT + JAMB) / 2, frameZ);
  mesh(scene, topStripes, DOOR_WIDTH + JAMB * 2, JAMB, frameDepth, DOOR_X, DOOR_HEIGHT + JAMB / 2, frameZ);

  // The leaf hangs from its room-side face on the west jamb and swings into the room.
  const hingeZ = panelZ - LEAF / 2;
  const pivot = new THREE.Group();
  pivot.position.set(doorLeft, 0, hingeZ);
  scene.add(pivot);
  const leafWidth = DOOR_WIDTH - 0.01;
  const leafHeight = DOOR_HEIGHT - 0.01;
  mesh(pivot, leafPaint, leafWidth, leafHeight, LEAF, DOOR_WIDTH / 2, leafHeight / 2, LEAF / 2);
  for (const side of [-1, 1]) {
    const face = side < 0 ? -0.012 : LEAF + 0.012;
    mesh(pivot, handleMetal, 0.07, 0.07, 0.012, DOOR_WIDTH - 0.1, 1, face);
    mesh(pivot, handleMetal, 0.13, 0.022, 0.022, DOOR_WIDTH - 0.13, 1, face + side * 0.03);
  }
  door.pivot = pivot;

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(doorLeft, 0, hingeZ));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(leafWidth / 2, leafHeight / 2, LEAF / 2)
      .setTranslation(DOOR_WIDTH / 2, leafHeight / 2, LEAF / 2)
      .setFriction(0.8)
      .setCollisionGroups(collisionGroups(WORLD_GROUP, ALL_GROUPS)),
    body,
  );
  door.body = body;
  turn.setFromAxisAngle(up, door.angle);
  pivot.quaternion.copy(turn);
  body.setRotation(turn, true);

  const start = ROOM_Z + 0.1;
  const midZ = start + CORRIDOR_DEPTH / 2;
  const wall = 0.1;
  const half = CORRIDOR_WIDTH / 2;
  addBox(scene, world, plaster, CORRIDOR_WIDTH + wall * 2, 0.2, CORRIDOR_DEPTH, DOOR_X, -0.1, midZ);
  addBox(scene, world, plaster, CORRIDOR_WIDTH + wall * 2, wall, CORRIDOR_DEPTH, DOOR_X, CORRIDOR_HEIGHT + wall / 2, midZ);
  addBox(scene, world, plaster, wall, CORRIDOR_HEIGHT, CORRIDOR_DEPTH, DOOR_X - half - wall / 2, CORRIDOR_HEIGHT / 2, midZ);
  addBox(scene, world, plaster, wall, CORRIDOR_HEIGHT, CORRIDOR_DEPTH, DOOR_X + half + wall / 2, CORRIDOR_HEIGHT / 2, midZ);
  addBox(scene, world, plaster, CORRIDOR_WIDTH, CORRIDOR_HEIGHT, wall, DOOR_X, CORRIDOR_HEIGHT / 2, start + CORRIDOR_DEPTH + wall / 2);
}
