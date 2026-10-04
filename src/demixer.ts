import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { mixIn, portion, solutionFromHex, toChem, water, type Solution } from "./fluid/solution";
import type { Spout } from "./fluid/sim";
import { addBox, addVessel, faceBox, shellInvisible, type Beaker } from "./lab";
import { twoParts } from "./sim/recipe";

// A shorter cousin of the analyzer. A pour into its well is split into the two equal-part
// hexchems that mix to it, and each half runs out of its own faucet into a beaker on the
// minibench in front. An elemental pour cannot be split, so it comes out of both unchanged.

type Screen = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; map: THREE.CanvasTexture };

// 40 mL a second from each faucet.
const FAUCET_RATE = 0.00004;
const FAUCET_SCALE = 0.45;
// In the faucet model's own frame: the middle of its base plate and its opening.
const FAUCET_BASE = new THREE.Vector3(-0.01, -0.245, -0.136);
const FAUCET_TIP = new THREE.Vector3(0.59, 0.465, -0.137);
const MINIBENCH_HEIGHT = 0.55;
const MINIBENCH_DEPTH = 0.34;
const CATCH = { radius: 0.04, height: 0.115, density: 280 };

let well: Beaker | null = null;
let shown = "";
const screen = makeScreen();
// Left then right, as seen from the aisle.
const spouts: Spout[] = [];

function makeScreen(): Screen {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx: canvas.getContext("2d")!, map };
}

type Line = { text: string; swatch?: string };

const GREEN = "#39ff7a";
const SWATCH = 40;

function paint(target: Screen, lines: Line[]) {
  const { canvas, ctx, map } = target;
  ctx.fillStyle = "#031208";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 44px Consolas, monospace";
  const step = 64;
  const top = canvas.height / 2 - ((lines.length - 1) * step) / 2;
  lines.forEach((line, i) => {
    const y = top + i * step;
    const x = line.swatch ? canvas.width / 2 + (SWATCH + 16) / 2 : canvas.width / 2;
    ctx.fillStyle = GREEN;
    ctx.fillText(line.text, x, y, 420);
    if (!line.swatch) return;
    const left = x - Math.min(ctx.measureText(line.text).width, 420) / 2 - 16 - SWATCH;
    ctx.fillStyle = line.swatch;
    ctx.fillRect(left, y - SWATCH / 2, SWATCH, SWATCH);
    // An outline keeps a near-black part visible against the dark screen.
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, y - SWATCH / 2, SWATCH, SWATCH);
  });
  map.needsUpdate = true;
}

const code = (hex: string) => `0x${hex.slice(1)}`;

function show(hex: string | null) {
  if (!hex) {
    paint(screen, [{ text: "DEMIXER" }, { text: "POUR IN" }]);
    return;
  }
  const input = { text: code(hex), swatch: hex };
  const parts = twoParts(hex);
  if (!parts) {
    paint(screen, [{ text: "ELEMENTAL" }, input, { text: "NO SPLIT" }]);
    return;
  }
  paint(screen, [
    { text: "DEMIXER" },
    input,
    { text: `L ${code(parts[0])}`, swatch: parts[0] },
    { text: `R ${code(parts[1])}`, swatch: parts[1] },
  ]);
}

function half(hex: string, sample: Solution): Solution {
  const volume = sample.volume / 2;
  const concentration = sample.volume > 1e-12 ? sample.mass / sample.volume : 0;
  const made = solutionFromHex(parseInt(hex.slice(1), 16), volume, concentration);
  made.cloud = sample.cloud / 2;
  return made;
}

/** The two faucets, for the fluid sim to run. */
export function demixerSpouts(): Spout[] {
  return spouts;
}

// Empties the well each frame into the faucets; the screens only repaint when the pour changes color.
export function readDemixer() {
  const beaker = well;
  if (!beaker || beaker.solution.volume <= 1e-7 || spouts.length < 2) return;
  const sample = { ...beaker.solution };
  beaker.solution.volume = 0;
  beaker.solution.mass = 0;
  beaker.solution.cloud = 0;
  const hex = sample.mass > 1e-8 ? toChem(sample).hex : null;
  const parts = hex ? twoParts(hex) : null;
  const left = parts ? half(parts[0], sample) : portion(sample, sample.volume / 2);
  const right = parts ? half(parts[1], sample) : left;
  mixIn(spouts[0].liquid, left);
  mixIn(spouts[1].liquid, right);
  if ((hex ?? "water") === shown) return;
  shown = hex ?? "water";
  show(hex);
}

// Stands along the east wall just north of the analyzer, facing the same aisle.
export function mountDemixer(
  scene: THREE.Scene,
  world: RAPIER.World,
  source: THREE.Object3D,
  faucet: THREE.Object3D,
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

  // Faucets stand on the front corners of the top and reach out over the aisle.
  const tips = [-1, 1].map((side) => {
    const tap = faucet.clone(true);
    tap.scale.setScalar(FAUCET_SCALE);
    tap.rotation.y = Math.PI;
    tap.updateMatrixWorld(true);
    const base = tap.localToWorld(FAUCET_BASE.clone());
    tap.position.set(fitted.min.x + 0.07 - base.x, top - base.y, cz + side * (spanZ / 2 - 0.09) - base.z);
    tap.updateMatrixWorld(true);
    tap.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    scene.add(tap);
    return tap.localToWorld(FAUCET_TIP.clone());
  });
  for (const tip of tips) spouts.push({ x: tip.x, y: tip.y, z: tip.z, rate: FAUCET_RATE, liquid: water(0) });

  const benchX = tips[0].x;
  addMinibench(scene, world, benchX, cz, spanZ + 0.06);
  for (const tip of tips) {
    addMarker(scene, tip.x, tip.z);
    beakers.push(addVessel(scene, world, { size: CATCH, fill: 0, y: MINIBENCH_HEIGHT + CATCH.height / 2 }, tip.x, tip.z, -1));
  }

  show(null);
  const towardAisle = new THREE.Vector3(-1, 0, 0);
  // Squashing the cabinet tips some normals onto the face, so take its frontmost edge, not its center.
  const face = faceBox(model, towardAisle);
  const size = face.getSize(new THREE.Vector3());
  const center = face.getCenter(new THREE.Vector3());
  const screenWidth = size.z * 0.8;
  const screenHeight = (screenWidth * 320) / 512;
  // High on the face, clear of the minibench and the beakers on it.
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(screenWidth, screenHeight), new THREE.MeshBasicMaterial({ map: screen.map }));
  plane.position.set(face.min.x - 0.012, center.y + 0.085 + screenHeight / 2, center.z);
  plane.lookAt(plane.position.clone().add(towardAisle));
  plane.renderOrder = 2;
  scene.add(plane);
}

const steel = new THREE.MeshStandardMaterial({ color: 0x8e979c, metalness: 0.6, roughness: 0.42 });

function addMinibench(scene: THREE.Scene, world: RAPIER.World, x: number, z: number, width: number) {
  const slab = 0.035;
  addBox(scene, world, steel, MINIBENCH_DEPTH, slab, width, x, MINIBENCH_HEIGHT - slab / 2, z);
  const legHeight = MINIBENCH_HEIGHT - slab;
  const leg = new THREE.BoxGeometry(0.03, legHeight, 0.03);
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const mesh = new THREE.Mesh(leg, steel);
      mesh.position.set(x + dx * (MINIBENCH_DEPTH / 2 - 0.03), legHeight / 2, z + dz * (width / 2 - 0.03));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
  addBox(scene, world, shellInvisible(), MINIBENCH_DEPTH, legHeight, width, x, legHeight / 2, z, false);
}

const markerMaterial = new THREE.MeshStandardMaterial({
  color: 0x2e220c,
  emissive: 0xffcc33,
  emissiveIntensity: 1.6,
  roughness: 0.5,
  side: THREE.DoubleSide,
});

function addMarker(scene: THREE.Scene, x: number, z: number) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(CATCH.radius + 0.006, CATCH.radius + 0.016, 40), markerMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, MINIBENCH_HEIGHT + 0.001, z);
  ring.receiveShadow = true;
  scene.add(ring);
  for (const turn of [0, Math.PI / 2]) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.004), markerMaterial);
    tick.rotation.set(-Math.PI / 2, 0, turn);
    tick.position.set(x, MINIBENCH_HEIGHT + 0.001, z);
    scene.add(tick);
  }
}
