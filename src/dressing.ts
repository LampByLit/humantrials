import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { EXIT_SPAN, EXIT_X, mountAnalyzer, ROOM_HEIGHT, ROOM_X, ROOM_Z, type Beaker } from "./lab";
import { mountDemixer } from "./demixer";
import { buildExit } from "./exit";
import { whiteSurface } from "./theme";
import cabinetUrl from "../retro_industrial_control_cabinet.glb?url";
import faucetUrl from "../faucet.glb?url";

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
// Matches the window module's slab, so plain and window panels line up.
const PANEL_DEPTH = 0.074;

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

// Draws every placed copy of a model in one call per mesh. The copies must be clones of one source.
function instance(scene: THREE.Scene, copies: THREE.Object3D[]) {
  if (copies.length === 0) return;
  const meshes = copies.map((root) => {
    root.updateMatrixWorld(true);
    const out: THREE.Mesh[] = [];
    root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) out.push(object as THREE.Mesh);
    });
    return out;
  });
  meshes[0].forEach((mesh, i) => {
    const batch = new THREE.InstancedMesh(mesh.geometry, mesh.material, copies.length);
    meshes.forEach((list, j) => batch.setMatrixAt(j, list[i].matrixWorld));
    batch.castShadow = true;
    batch.receiveShadow = true;
    batch.computeBoundingSphere();
    scene.add(batch);
  });
}

function module(source: THREE.Object3D, x: number, z: number, rotY: number) {
  const piece = source.clone(true);
  piece.position.set(x, MODULE_Y, z);
  piece.rotation.y = rotY;
  return piece;
}

export async function dressLab(scene: THREE.Scene, world: RAPIER.World, beakers: Beaker[]) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loadUrl = async (url: string) => {
    const gltf = await loader.loadAsync(url);
    prepare(gltf.scene);
    return gltf.scene;
  };
  const load = (name: string) => loadUrl(`/models/lab/${name}.glb`);

  const [floor, windowWall, shelf, extinguisher, chair, cabinet, faucet] = await Promise.all([
    load("floor"),
    load("window"),
    load("shelf"),
    load("extinguisher"),
    load("chair"),
    loadUrl(cabinetUrl),
    loadUrl(faucetUrl),
  ]);

  const paint = whiteSurface(0.92);
  const plaster = whiteSurface(0.94);
  for (const model of [floor, windowWall, shelf, extinguisher, chair]) {
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.material = paint;
    });
  }
  const wall = new THREE.Mesh(new THREE.BoxGeometry(MODULE, MODULE, PANEL_DEPTH), paint);

  const slots = (half: number) => {
    const out: number[] = [];
    for (let s = -half + MODULE / 2; s < half; s += MODULE) out.push(s);
    return out;
  };
  const xSlots = slots(ROOM_X);
  const zSlots = slots(ROOM_Z);
  const lastX = xSlots[xSlots.length - 1];
  const tiles: THREE.Object3D[] = [];
  for (const [i, x] of xSlots.entries()) {
    for (const [j, z] of zSlots.entries()) {
      const tile = floor.clone(true);
      tile.position.set(x, 0, z);
      tile.rotation.y = (i + j) % 2 === 0 ? Math.PI / 2 : 0;
      tiles.push(tile);
    }
  }
  instance(scene, tiles);

  const walls: THREE.Object3D[] = [];
  const windows: THREE.Object3D[] = [];
  // North, the wall the player faces: windows over the benches, plain panels behind the shelves.
  for (const x of xSlots) {
    if (Math.abs(x) === lastX) walls.push(module(wall, x, -WALL_Z, 0));
    else windows.push(module(windowWall, x, -WALL_Z, 0));
  }
  // South: plain panels either side of the industrial exit.
  for (const x of xSlots) if (Math.abs(x - EXIT_X) > EXIT_SPAN / 2) walls.push(module(wall, x, WALL_Z, Math.PI));
  // East and west: windows all along.
  for (const z of zSlots) {
    windows.push(module(windowWall, WALL_X, z, -Math.PI / 2));
    windows.push(module(windowWall, -WALL_X, z, Math.PI / 2));
  }
  instance(scene, walls);
  instance(scene, windows);

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

  buildExit(scene, world);

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
  const stools = chairs.map(([x, z, rotY]) => place(chair, x, z, rotY, 0));
  for (const stool of stools) solid(world, stool);
  instance(scene, stools);

  const analyzer = mountAnalyzer(scene, world, cabinet, beakers);
  mountDemixer(scene, world, cabinet, faucet, beakers, analyzer);
}
