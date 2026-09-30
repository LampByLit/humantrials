import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BENCH_SURFACE } from "./lab";

// School Classrooms Asset Pack by styloo, CC0.
// https://styloo.itch.io/classroom-asset-pack

const WORLD_GROUP = 0x0002;
const ALL_GROUPS = 0xffff;

// Shell colliders in lab.ts sit on x/z = ±4. Modules are centered on the inner face.
const WALL = 3.9;
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

function paint(root: THREE.Object3D, color: number) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      standard.map = null;
      standard.color.set(color);
      standard.roughness = 0.86;
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

  const [floor, wall, windowWall, door, doorPanel, board, boardSmall, shelf, extinguisher, chair, microscope, centrifuge, vials] =
    await Promise.all([
      load("floor"),
      load("wall"),
      load("window"),
      load("door"),
      load("door-panel"),
      load("board"),
      load("board-small"),
      load("shelf"),
      load("extinguisher"),
      load("chair"),
      load("microscope"),
      load("centrifuge"),
      load("vials"),
    ]);

  // The boards ship as a flat brown palette swatch. A green board reads as a chalkboard.
  paint(board, 0x24362c);
  paint(boardSmall, 0x24362c);

  const slots = [-3, -1, 1, 3];
  for (const x of slots) {
    for (const z of slots) {
      const tile = floor.clone(true);
      tile.position.set(x, 0, z);
      tile.rotation.y = (x + z) % 4 === 0 ? Math.PI / 2 : 0;
      scene.add(tile);
    }
  }

  // North, the wall the player faces: windows over the benches, plain panels behind the shelves.
  for (const x of slots) addModule(scene, x === -1 || x === 1 ? windowWall : wall, x, -WALL, 0);
  // South: a door just off the middle.
  for (const x of slots) addModule(scene, x === 1 ? door : wall, x, WALL, Math.PI);
  // East and west: windows at the ends.
  for (const z of slots) {
    const side = z === -3 || z === 3 ? windowWall : wall;
    addModule(scene, side, WALL, z, -Math.PI / 2);
    addModule(scene, side, -WALL, z, Math.PI / 2);
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
  band(8.05, 1.02, 0.08, 0, upperCenter, -WALL);
  band(8.05, 1.02, 0.08, 0, upperCenter, WALL);
  band(0.08, 1.02, 8.05, -WALL, upperCenter, 0);
  band(0.08, 1.02, 8.05, WALL, upperCenter, 0);

  // Short bookcases in the north corners, under the plain wall panels so they don't cover the windows.
  for (const x of [-3.15, 3.15]) {
    const bookcase = place(shelf, x, -3, Math.PI, 0, 0.5);
    flush(bookcase, "z", "min", -WALL + 0.04);
    scene.add(bookcase);
    solid(world, bookcase);
  }

  const doorLeaf = place(doorPanel, 1, WALL, 0, 0);
  flush(doorLeaf, "z", "max", WALL - 0.02);
  scene.add(doorLeaf);

  // Big board on the west wall, little one on the east, both above the wainscot.
  const westBoard = place(board, -3.4, 0.2, Math.PI / 2, 1.15);
  flush(westBoard, "x", "min", -WALL + 0.04);
  scene.add(westBoard);

  const eastBoard = place(boardSmall, 3.4, 1.4, -Math.PI / 2, 1.2);
  flush(eastBoard, "x", "max", WALL - 0.04);
  scene.add(eastBoard);

  const hose = place(extinguisher, 3.4, 3.4, 0, 0);
  flush(hose, "x", "max", WALL - 0.06);
  flush(hose, "z", "max", WALL - 0.06);
  scene.add(hose);
  solid(world, hose);

  // Rolling chairs in the open north end of the room, facing the benches.
  const chairs: [number, number, number][] = [
    [-3.15, -1.55, Math.PI / 2],
    [3.15, -1.55, -Math.PI / 2],
    [0, -2.15, Math.PI],
  ];
  for (const [x, z, rotY] of chairs) {
    const stool = place(chair, x, z, rotY, 0);
    scene.add(stool);
    solid(world, stool);
  }

  // Instruments sit on the back edge of the north benches, behind the glassware.
  const onBench = (source: THREE.Object3D, x: number) => {
    scene.add(place(source, x, -0.42, 0, BENCH_SURFACE));
  };
  onBench(microscope, 0);
  onBench(vials, -1.8);
  onBench(centrifuge, 1.8);
}
