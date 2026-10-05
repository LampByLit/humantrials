import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { sipPuddle, type Capsule, type FluidSim } from "./fluid/sim";
import { toChem, type Solution } from "./fluid/solution";
import { addBox, BENCH_SURFACE, STATIONS } from "./lab";
import { plantHeight, plantLength } from "./jane/plant";
import { RAT_PROFILES, createRat, feedRat, ratCondition, stepRat, type RatProfile, type RatVitals } from "./sim/rat";

// The color counters sit against the south wall. The rat bench is the next one east.
// Each cage is the rustic wooden cage. Pouring on a rat, or leaving a puddle under it, feeds or doses it.
const BENCH_X = 10.3;
const BENCH_W = 5.4;
const BENCH_D = 1.35;
const OFFSETS = [-1.95, -0.65, 0.65, 1.95];
const CAGE_H = 0.75;
// The bind pose's box is mostly tail and empty skeleton, so the visible body is a fraction of it.
const LENGTHS = [1.35, 1.15, 1.25, 1.0];
const COATS = [0xffffff, 0xf4e6e1, 0x2a2a2a, 0xc4884e];
const PALE = [false, true, false, false];

type Plate = { ctx: CanvasRenderingContext2D; map: THREE.CanvasTexture; key: string };

type Caged = {
  profile: RatProfile;
  vitals: RatVitals;
  generation: number;
  claimed: boolean;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction | null;
  plate: Plate;
  mouth: Capsule;
};

export type RatPen = {
  step(dt: number): void;
  wade(sim: FluidSim, dt: number): void;
  feed(id: string, solution: Solution): void;
  mouths(): Capsule[];
  summary(): { name: string; status: string }[];
  claimDeaths(): { index: number; name: string; cause: string | null }[];
  revive(index: number): void;
  spot(index: number): { x: number; z: number };
};

function plateFor(name: string): Plate {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return { ctx, map, key: "" };
}

function paint(plate: Plate, name: string, status: string) {
  const key = `${name}:${status}`;
  if (plate.key === key) return;
  plate.key = key;
  const { ctx, map } = plate;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = status === "dead" ? "#5c4038" : status === "ill" || status === "starving" ? "#8a3a32" : "#2c3338";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#f4f1ea";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${name}  ${status}`, 128, 34);
  map.needsUpdate = true;
}

function tint(root: THREE.Object3D, coat: number, pale: boolean) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const source = mesh.material;
    const materials = Array.isArray(source) ? source : [source];
    const next = materials.map((material) => {
      const copy = material.clone();
      if (copy instanceof THREE.MeshStandardMaterial) {
        copy.color.setHex(coat);
        if (pale) {
          copy.map = null;
          copy.roughness = 0.72;
        }
      }
      return copy;
    });
    mesh.material = next.length === 1 ? next[0] : next;
  });
}

function placeCage(scene: THREE.Scene, source: THREE.Object3D, x: number, z: number) {
  const cage = source.clone(true);
  plantHeight(cage, CAGE_H);
  cage.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(cage);
  const fittedSize = fitted.getSize(new THREE.Vector3());
  const limit = Math.min(1.05 / Math.max(fittedSize.x, 1e-4), 0.9 / Math.max(fittedSize.z, 1e-4), 1);
  if (limit < 1) {
    cage.scale.multiplyScalar(limit);
    cage.updateMatrixWorld(true);
    const again = new THREE.Box3().setFromObject(cage);
    cage.position.y -= again.min.y;
  }
  cage.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  const anchor = new THREE.Group();
  anchor.position.set(x, BENCH_SURFACE, z);
  anchor.add(cage);
  scene.add(anchor);
}

type RAPIER_WORLD = Parameters<typeof addBox>[1];

export function createRats(scene: THREE.Scene, world: RAPIER_WORLD, rat: GLTF, cage: GLTF, seed: number): RatPen {
  const z = STATIONS[0].z;
  const top = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.55 });
  const cabinet = new THREE.MeshStandardMaterial({ color: 0xc4bfb6, roughness: 0.7 });
  addBox(scene, world, top, BENCH_W, 0.07, BENCH_D, BENCH_X, 0.9, z);
  addBox(scene, world, cabinet, BENCH_W - 0.12, 0.78, BENCH_D - 0.1, BENCH_X, 0.47, z);

  const idleClip = rat.animations.filter((clip) => /idle|idel/i.test(clip.name)).sort((a, b) => a.name.length - b.name.length)[0];
  const rats: Caged[] = RAT_PROFILES.map((profile, index) => {
    const x = BENCH_X + OFFSETS[index];
    placeCage(scene, cage.scene, x, z);
    const model = cloneSkinned(rat.scene);
    plantLength(model, LENGTHS[index]);
    tint(model, COATS[index], PALE[index]);
    const anchor = new THREE.Group();
    anchor.position.set(x, BENCH_SURFACE, z);
    anchor.add(model);
    scene.add(anchor);
    const mixer = new THREE.AnimationMixer(model);
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    idle?.play();
    const plate = plateFor(profile.name);
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.055),
      new THREE.MeshBasicMaterial({ map: plate.map, transparent: true, depthWrite: false }),
    );
    card.position.set(0, CAGE_H + 0.08, 0);
    card.rotation.y = Math.PI;
    anchor.add(card);
    return {
      profile,
      vitals: createRat(seed + index * 17),
      generation: 0,
      claimed: false,
      model,
      mixer,
      idle,
      plate,
      mouth: { id: `rat-${index}`, x, y: BENCH_SURFACE + 0.16, z, half: 0.14, radius: 0.28 },
    };
  });

  function paintAll() {
    for (const rat of rats) paint(rat.plate, rat.profile.name, ratCondition(rat.vitals));
  }
  paintAll();

  return {
    wade(sim, dt) {
      for (const rat of rats) {
        if (!rat.vitals.body.alive) continue;
        const gulp = sipPuddle(sim, rat.mouth.x, BENCH_SURFACE, rat.mouth.z, 0.34, 0.00002, dt);
        if (gulp) feedRat(rat.vitals, rat.profile, toChem(gulp));
      }
    },
    step(dt) {
      for (const rat of rats) {
        stepRat(rat.vitals, rat.profile, dt);
        const alive = rat.vitals.body.alive;
        rat.model.rotation.z = alive ? 0 : 1.15;
        if (alive) rat.mixer.update(dt);
        paint(rat.plate, rat.profile.name, ratCondition(rat.vitals));
      }
    },
    feed(id, solution) {
      const index = Number(id.slice(4));
      const rat = rats[index];
      if (!rat) return;
      const gulp = toChem(solution);
      feedRat(rat.vitals, rat.profile, gulp);
    },
    mouths() {
      return rats.filter((rat) => rat.vitals.body.alive).map((rat) => rat.mouth);
    },
    summary() {
      return rats.map((rat) => ({ name: rat.profile.name, status: ratCondition(rat.vitals) }));
    },
    claimDeaths() {
      const deaths: { index: number; name: string; cause: string | null }[] = [];
      rats.forEach((rat, index) => {
        if (rat.vitals.body.alive || rat.claimed) return;
        rat.claimed = true;
        deaths.push({ index, name: rat.profile.name, cause: rat.vitals.body.cause });
      });
      return deaths;
    },
    revive(index) {
      const rat = rats[index];
      if (!rat) return;
      rat.generation += 1;
      rat.vitals = createRat(seed + index * 17 + rat.generation * 100);
      rat.claimed = false;
      rat.model.rotation.z = 0;
      rat.idle?.reset().play();
      paint(rat.plate, rat.profile.name, "fed");
    },
    spot(index) {
      return { x: BENCH_X + OFFSETS[index], z };
    },
  };
}
