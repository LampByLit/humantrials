import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { toChem } from "./fluid/solution";
import { addBox, addVessel, faceBox, shellInvisible, type Beaker } from "./lab";
import { threeParts, twoParts } from "./sim/recipe";

// A shorter cousin of the analyzer. A pour into its well is read back as the equal-part
// mixes that make it: two colors on the upper screen, three on the lower.

type Screen = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; map: THREE.CanvasTexture };

let well: Beaker | null = null;
let shown = "";
const screens = [makeScreen(), makeScreen()];

function makeScreen(): Screen {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx: canvas.getContext("2d")!, map };
}

function paint(screen: Screen, lines: string[]) {
  const { canvas, ctx, map } = screen;
  ctx.fillStyle = "#031208";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#39ff7a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 44px Consolas, monospace";
  const step = 64;
  const top = canvas.height / 2 - ((lines.length - 1) * step) / 2;
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, top + i * step, 480));
  map.needsUpdate = true;
}

const code = (hex: string) => `0x${hex.slice(1)}`;
const recipe = (parts: string[]) => parts.map((part, i) => (i < parts.length - 1 ? `${code(part)} &` : code(part)));

function show(hex: string | null) {
  if (!hex) {
    paint(screens[0], ["TWO EQUAL PARTS", "—"]);
    paint(screens[1], ["THREE EQUAL PARTS", "—"]);
    return;
  }
  const two = twoParts(hex);
  const three = threeParts(hex);
  if (!two && !three) {
    for (const screen of screens) paint(screen, ["ELEMENTAL HEXCHEM", code(hex)]);
    return;
  }
  paint(screens[0], ["TWO EQUAL PARTS", ...(two ? recipe(two) : ["—"])]);
  paint(screens[1], ["THREE EQUAL PARTS", ...(three ? recipe(three) : ["—"])]);
}

// Empties the well each frame; the screens only repaint when the pour changes color.
export function readMixer() {
  const beaker = well;
  if (!beaker || beaker.solution.volume <= 1e-7) return;
  const sample = toChem(beaker.solution);
  beaker.solution.volume = 0;
  beaker.solution.mass = 0;
  beaker.solution.cloud = 0;
  const hex = sample.mass > 1e-8 ? sample.hex : null;
  if ((hex ?? "water") === shown) return;
  shown = hex ?? "water";
  show(hex);
}

// Stands along the east wall just north of the analyzer, facing the same aisle.
export function mountMixer(
  scene: THREE.Scene,
  world: RAPIER.World,
  source: THREE.Object3D,
  beakers: Beaker[],
  beside: THREE.Object3D,
) {
  const model = source.clone(true);
  model.rotation.y = -Math.PI / 2;
  model.scale.y = 0.8;
  model.position.set(9.05, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const neighbor = new THREE.Box3().setFromObject(beside);
  model.position.y -= box.min.y;
  model.position.z += neighbor.min.z - 0.35 - box.max.z;
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  scene.add(model);

  const fitted = new THREE.Box3().setFromObject(model);
  const top = fitted.max.y;
  const cx = (fitted.min.x + fitted.max.x) / 2;
  const cz = (fitted.min.z + fitted.max.z) / 2;

  const hole = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.012, 10, 40),
    new THREE.MeshStandardMaterial({ color: 0x2e220c, emissive: 0xffcc33, emissiveIntensity: 3, roughness: 0.35 }),
  );
  hole.rotation.x = Math.PI / 2;
  hole.position.set(cx, top + 0.006, cz);
  scene.add(hole);
  const glow = new THREE.PointLight(0xffcc33, 0.8, 1.4);
  glow.position.set(cx, top + 0.02, cz);
  scene.add(glow);

  const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.04, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
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
  vessel.mesh.visible = false;
  beakers.push(vessel);
  well = vessel;

  const height = top - 0.12;
  const midY = height / 2;
  const spanX = fitted.max.x - fitted.min.x;
  const spanZ = fitted.max.z - fitted.min.z;
  const thick = 0.05;
  addBox(scene, world, shellInvisible(), thick, height, spanZ, fitted.min.x + thick / 2, midY, cz, false);
  addBox(scene, world, shellInvisible(), thick, height, spanZ, fitted.max.x - thick / 2, midY, cz, false);
  addBox(scene, world, shellInvisible(), spanX, height, thick, cx, midY, fitted.min.z + thick / 2, false);
  addBox(scene, world, shellInvisible(), spanX, height, thick, cx, midY, fitted.max.z - thick / 2, false);

  show(null);
  const towardAisle = new THREE.Vector3(-1, 0, 0);
  // Squashing the cabinet tips some normals onto the face, so take its frontmost edge, not its center.
  const face = faceBox(model, towardAisle);
  const size = face.getSize(new THREE.Vector3());
  const center = face.getCenter(new THREE.Vector3());
  const screenWidth = size.z * 0.8;
  const screenHeight = (screenWidth * 320) / 512;
  const gap = 0.025;
  screens.forEach((screen, i) => {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(screenWidth, screenHeight),
      new THREE.MeshBasicMaterial({ map: screen.map }),
    );
    plane.position.set(face.min.x - 0.012, center.y + 0.06 + (i === 0 ? 1 : -1) * (screenHeight / 2 + gap), center.z);
    plane.lookAt(plane.position.clone().add(towardAisle));
    plane.renderOrder = 2;
    scene.add(plane);
  });
}
