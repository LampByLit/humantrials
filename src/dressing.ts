import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BENCH_SURFACE, ROOM_X, ROOM_Z } from "./lab";

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

function addModule(scene: THREE.Scene, source: THREE.Object3D, x: number, z: number, rotY: number) {
  const piece = source.clone(true);
  piece.position.set(x, MODULE_Y, z);
  piece.rotation.y = rotY;
  scene.add(piece);
}

export async function dressLab(scene: THREE.Scene, world: RAPIER.World) {
  const loader = new GLTFLoader();
  const load = async (name: string) => {
    const gltf = await loader.loadAsync(`/models/lab/${name}.glb`);
    prepare(gltf.scene);
    return gltf.scene;
  };

  const [floor, wall, windowWall, door, doorPanel, shelf, extinguisher, chair, microscope, centrifuge, vials] =
    await Promise.all([
      load("floor"),
      load("wall"),
      load("window"),
      load("door"),
      load("door-panel"),
      load("shelf"),
      load("extinguisher"),
      load("chair"),
      load("microscope"),
      load("centrifuge"),
      load("vials"),
    ]);

  const slots = (half: number) => {
    const out: number[] = [];
    for (let s = -half + MODULE / 2; s < half; s += MODULE) out.push(s);
    return out;
  };
  const xSlots = slots(ROOM_X);
  const zSlots = slots(ROOM_Z);
  const lastX = xSlots[xSlots.length - 1];
  const doorX = xSlots[xSlots.length - 2];
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
  // South: a door near the east corner.
  for (const x of xSlots) addModule(scene, x === doorX ? door : wall, x, WALL_Z, Math.PI);
  // East and west: windows all along.
  for (const z of zSlots) {
    addModule(scene, windowWall, WALL_X, z, -Math.PI / 2);
    addModule(scene, windowWall, -WALL_X, z, Math.PI / 2);
  }

  const plaster = new THREE.MeshStandardMaterial({ color: 0xe6e4df, roughness: 0.92 });
  const band = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), plaster);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const upperCenter = UPPER_BOTTOM + 0.5;
  const spanX = ROOM_X * 2 + 0.05;
  const spanZ = ROOM_Z * 2 + 0.05;
  band(spanX, 1.02, 0.08, 0, upperCenter, -WALL_Z);
  band(spanX, 1.02, 0.08, 0, upperCenter, WALL_Z);
  band(0.08, 1.02, spanZ, -WALL_X, upperCenter, 0);
  band(0.08, 1.02, spanZ, WALL_X, upperCenter, 0);

  // Short bookcases in the north corners, under the plain wall panels so they don't cover the windows.
  for (const x of [-lastX - 0.15, lastX + 0.15]) {
    const bookcase = place(shelf, x, -ROOM_Z + 1, Math.PI, 0, 0.5);
    flush(bookcase, "z", "min", -WALL_Z + 0.04);
    scene.add(bookcase);
    solid(world, bookcase);
  }

  const doorLeaf = place(doorPanel, doorX, WALL_Z, 0, 0);
  flush(doorLeaf, "z", "max", WALL_Z - 0.02);
  scene.add(doorLeaf);

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

  // Instruments sit on the back edge of the south-facing benches, behind the glassware.
  const onBench = (source: THREE.Object3D, x: number, z: number) => {
    scene.add(place(source, x, z - 0.22, 0, BENCH_SURFACE));
  };
  onBench(microscope, 0, -0.2);
  onBench(vials, -1.8, -0.2);
  onBench(centrifuge, 1.8, -0.2);
  onBench(vials, -3.6, -0.2);
  onBench(microscope, 3.6, -0.2);
  onBench(centrifuge, -3.6, -4.4);
  onBench(microscope, -1.8, -4.4);
  onBench(vials, 0, -4.4);
}
