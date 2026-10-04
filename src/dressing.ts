import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXIT_SPAN, EXIT_X, mountAnalyzer, ROOM_HEIGHT, ROOM_X, ROOM_Z, type Beaker } from "./lab";
import { mountDemixer } from "./demixer";
import { whiteSurface } from "./theme";
import cabinetUrl from "../retro_industrial_control_cabinet.glb?url";
import faucetUrl from "../faucet.glb?url";
import exitWallUrl from "../industrial_horror_wall__game_environment.glb?url";

// School Classrooms Asset Pack by styloo, CC0.
// https://styloo.itch.io/classroom-asset-pack

const WORLD_GROUP = 0x0002;
const ALL_GROUPS = 0xffff;

// Shell colliders in lab.ts sit on the room half extents. Modules are centered on the inner face.
const WALL_X = ROOM_X - 0.1;
const WALL_Z = ROOM_Z - 0.1;
const MODULE = 2;
// The wall modules are 2m tall. A plain band finishes them up to the ceiling.
const MODULE_Y = 1;
const UPPER_BOTTOM = 2;

function collisionGroups(membership: number, filter: number) {
  return (filter << 16) | membership;
}

function prepare(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const map = (material as THREE.MeshStandardMaterial).map;
      const width = (map?.image as { width?: number } | undefined)?.width ?? 0;
      // Palette atlases on the small props turn to mud under linear filtering.
      if (!map || width === 0 || width > 512) continue;
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.generateMipmaps = false;
      map.needsUpdate = true;
    }
  });
}

function place(
  source: THREE.Object3D,
  x: number,
  z: number,
  rotY: number,
  bottom: number,
  scale = 1,
) {
  const object = source.clone(true);
  object.scale.setScalar(scale);
  object.rotation.y = rotY;
  object.position.set(x, 0, z);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  object.position.y += bottom - box.min.y;
  object.updateMatrixWorld(true);
  return object;
}

function flush(object: THREE.Object3D, axis: "x" | "z", edge: "min" | "max", at: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  object.position[axis] += at - box[edge][axis];
  object.updateMatrixWorld(true);
}

function solid(world: RAPIER.World, object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setFriction(0.8)
      .setCollisionGroups(collisionGroups(WORLD_GROUP, ALL_GROUPS)),
    body,
  );
}

// The door frame atlas paints a photo of the slab and a hazard tigerstripe on one mesh.
// Keep the stripe block and flatten every other texel so the door matches the room.
function keepTigerstripe(material: THREE.MeshStandardMaterial) {
  const map = material.map;
  const image = map?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!map || !image?.width || !image.height) return;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = frame.data;
  const w = canvas.width;
  const h = canvas.height;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      if (r > 140 && g > 90 && b < 110 && r > b + 60 && g > b + 30) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
      const i = (y * w + x) * 4;
      px[i] = 0xf6;
      px[i + 1] = 0xf6;
      px[i + 2] = 0xf4;
    }
  }
  ctx.putImageData(frame, 0, 0);
  const next = new THREE.CanvasTexture(canvas);
  next.colorSpace = map.colorSpace;
  next.flipY = map.flipY;
  next.wrapS = map.wrapS;
  next.wrapT = map.wrapT;
  next.needsUpdate = true;
  material.map = next;
  material.metalnessMap = null;
  material.roughnessMap = null;
  material.metalness = 0;
  material.roughness = 0.94;
  material.needsUpdate = true;
}

function addModule(scene: THREE.Scene, source: THREE.Object3D, x: number, z: number, rotY: number) {
  const piece = source.clone(true);
  piece.position.set(x, MODULE_Y, z);
  piece.rotation.y = rotY;
  scene.add(piece);
}

export async function dressLab(scene: THREE.Scene, world: RAPIER.World, beakers: Beaker[]) {
  const loader = new GLTFLoader();
  const loadUrl = async (url: string) => {
    const gltf = await loader.loadAsync(url);
    prepare(gltf.scene);
    return gltf.scene;
  };
  const load = (name: string) => loadUrl(`/models/lab/${name}.glb`);

  const [floor, wall, windowWall, shelf, extinguisher, chair, cabinet, exitWall, faucet] = await Promise.all([
    load("floor"),
    load("wall"),
    load("window"),
    load("shelf"),
    load("extinguisher"),
    load("chair"),
    loadUrl(cabinetUrl),
    loadUrl(exitWallUrl),
    loadUrl(faucetUrl),
  ]);

  const paint = whiteSurface(0.92);
  const plaster = whiteSurface(0.94);
  for (const model of [floor, wall, windowWall, shelf, extinguisher, chair]) {
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.material = paint;
    });
  }
  // The exit model brings a photo wall, a photo door, and a window. Paint the wall and the
  // door leaf to match the room, leave the hazard tigerstripe on the frame, and close the window.
  const striped = new Set<THREE.Material>();
  exitWall.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const material = mesh.material;
    if (!mesh.isMesh || Array.isArray(material) || material.name !== "SM_DoorFrame_Jamb" || striped.has(material)) return;
    striped.add(material);
    keepTigerstripe(material as THREE.MeshStandardMaterial);
  });
  const windowBox = new THREE.Box3();
  const wallBox = new THREE.Box3();
  const piece = new THREE.Box3();
  const windowPieces: THREE.Object3D[] = [];
  exitWall.updateMatrixWorld(true);
  exitWall.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = `${mesh.parent?.name ?? ""} ${mesh.name}`.toLowerCase();
    if (name.includes("window") && !name.includes("wall")) {
      windowBox.union(piece.setFromObject(mesh));
      windowPieces.push(mesh);
      return;
    }
    if (name.includes("wall") && name.includes("window")) wallBox.union(piece.setFromObject(mesh));
    if (name.includes("doorleaf") || name.includes("wall")) mesh.material = plaster;
  });
  for (const mesh of windowPieces) mesh.removeFromParent();
  if (!windowBox.isEmpty()) {
    const size = windowBox.getSize(new THREE.Vector3());
    const center = windowBox.getCenter(new THREE.Vector3());
    if (!wallBox.isEmpty()) {
      center.z = (wallBox.min.z + wallBox.max.z) / 2;
      size.z = wallBox.max.z - wallBox.min.z;
    }
    const fill = new THREE.Mesh(new THREE.BoxGeometry(size.x + 0.08, size.y + 0.08, size.z + 0.02), plaster);
    fill.castShadow = true;
    fill.receiveShadow = true;
    exitWall.add(fill);
    exitWall.updateMatrixWorld(true);
    fill.position.copy(exitWall.worldToLocal(center));
    fill.quaternion.copy(exitWall.getWorldQuaternion(new THREE.Quaternion()).invert());
  }

  const slots = (half: number) => {
    const out: number[] = [];
    for (let s = -half + MODULE / 2; s < half; s += MODULE) out.push(s);
    return out;
  };
  const xSlots = slots(ROOM_X);
  const zSlots = slots(ROOM_Z);
  const lastX = xSlots[xSlots.length - 1];
  for (const [i, x] of xSlots.entries()) {
    for (const [j, z] of zSlots.entries()) {
      const tile = floor.clone(true);
      tile.position.set(x, 0, z);
      tile.rotation.y = (i + j) % 2 === 0 ? Math.PI / 2 : 0;
      scene.add(tile);
    }
  }

  // North, the wall the player faces: windows over the benches, plain panels behind the shelves.
  for (const x of xSlots) addModule(scene, Math.abs(x) === lastX ? wall : windowWall, x, -WALL_Z, 0);
  // South: plain panels either side of the industrial exit.
  for (const x of xSlots) if (Math.abs(x - EXIT_X) > EXIT_SPAN / 2) addModule(scene, wall, x, WALL_Z, Math.PI);
  // East and west: windows all along.
  for (const z of zSlots) {
    addModule(scene, windowWall, WALL_X, z, -Math.PI / 2);
    addModule(scene, windowWall, -WALL_X, z, Math.PI / 2);
  }

  const band = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), plaster);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const upperHeight = ROOM_HEIGHT - UPPER_BOTTOM;
  const upperCenter = UPPER_BOTTOM + upperHeight / 2;
  const spanX = ROOM_X * 2 + 0.05;
  const spanZ = ROOM_Z * 2 + 0.05;
  band(spanX, upperHeight, 0.08, 0, upperCenter, -WALL_Z);
  band(spanX, upperHeight, 0.08, 0, upperCenter, WALL_Z);
  band(0.08, upperHeight, spanZ, -WALL_X, upperCenter, 0);
  band(0.08, upperHeight, spanZ, WALL_X, upperCenter, 0);

  // Short bookcases in the north corners, under the plain wall panels so they don't cover the windows.
  for (const x of [-lastX - 0.15, lastX + 0.15]) {
    const bookcase = place(shelf, x, -ROOM_Z + 1, Math.PI, 0, 0.5);
    flush(bookcase, "z", "min", -WALL_Z + 0.04);
    scene.add(bookcase);
    solid(world, bookcase);
  }

  // The exit's posts stand about 0.2m proud of its back face, so the back of its box
  // goes to the outer face of the shell collider and the wall itself lines up with the panels.
  const exitWidth = new THREE.Box3().setFromObject(exitWall).getSize(new THREE.Vector3()).x;
  const exit = place(exitWall, EXIT_X, WALL_Z, Math.PI, 0, EXIT_SPAN / exitWidth);
  flush(exit, "x", "min", EXIT_X - EXIT_SPAN / 2);
  flush(exit, "z", "max", ROOM_Z + 0.1);
  scene.add(exit);

  const hose = place(extinguisher, WALL_X - 0.5, WALL_Z - 0.5, 0, 0);
  flush(hose, "x", "max", WALL_X - 0.06);
  flush(hose, "z", "max", WALL_Z - 0.06);
  scene.add(hose);
  solid(world, hose);

  // Rolling chairs in the open strips down the east and west sides, facing the benches.
  const side = ROOM_X - 1.2;
  const chairs: [number, number, number][] = [
    [-side, -1.2, Math.PI / 2],
    [side, -1.2, -Math.PI / 2],
    [-side, 2.8, Math.PI / 2],
    [side, 2.8, -Math.PI / 2],
    [-side, -3.4, Math.PI / 2],
    [side, -3.4, -Math.PI / 2],
  ];
  for (const [x, z, rotY] of chairs) {
    const stool = place(chair, x, z, rotY, 0);
    scene.add(stool);
    solid(world, stool);
  }

  const analyzer = mountAnalyzer(scene, world, cabinet, beakers);
  mountDemixer(scene, world, cabinet, faucet, beakers, analyzer);
}
