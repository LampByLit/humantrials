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
// Wooden cage height, after the Sketchfab backdrop is dropped. The bars are about
// 0.22m wide and 0.30m deep at this height, which is what the rats have to fit in.
const CAGE_H = 0.48;
// Nose-to-tail target. The bind box is mostly tail and empty skeleton, so the
// visible body is shorter than this and still clears the bars.
const LENGTHS = [0.62, 0.5, 0.56, 0.46];
const COATS = [0xffffff, 0xf4e6e1, 0x2a2a2a, 0xc4884e];
const PALE = [false, true, false, false];

type Plate = {
  ctx: CanvasRenderingContext2D;
  map: THREE.CanvasTexture;
  key: string;
  led: THREE.MeshStandardMaterial;
};

const SCREEN_W = 512;
const SCREEN_H = 320;
const PHOSPHOR = "#39ff7a";
const DIM = "#1f8f48";
const AMBER = "#ffcc33";
const ALARM = "#ff5a4a";

const shell = new THREE.MeshStandardMaterial({ color: 0x1a1e22, roughness: 0.38, metalness: 0.72 });
const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.5, metalness: 0.45 });
const footMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92, metalness: 0 });

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
  conceal(index: number): void;
  tote(index: number): THREE.Object3D;
  release(): void;
  spot(index: number): { x: number; z: number };
};

function plateFor(): Plate {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext("2d")!;
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const led = new THREE.MeshStandardMaterial({
    color: 0x0c2e1c,
    emissive: 0x39ff7a,
    emissiveIntensity: 2.4,
    roughness: 0.35,
  });
  return { ctx, map, key: "", led };
}

function statusInk(status: string) {
  if (status === "dead") return "#7a332c";
  if (status === "ill" || status === "starving") return ALARM;
  if (status === "hungry") return AMBER;
  return PHOSPHOR;
}

function ledHex(status: string) {
  if (status === "dead") return 0x3a1814;
  if (status === "ill" || status === "starving") return 0xff5a4a;
  if (status === "hungry") return 0xffcc33;
  return 0x39ff7a;
}

function paint(plate: Plate, name: string, status: string, vitals: RatVitals) {
  const needs = vitals.needs;
  const cause = vitals.body.cause ?? "";
  const key = `${name}|${status}|${needs.energy.toFixed(2)}|${needs.protein.toFixed(2)}|${needs.vitamins.toFixed(2)}|${cause}`;
  if (plate.key === key) return;
  plate.key = key;
  plate.led.emissive.setHex(ledHex(status));
  plate.led.color.setHex(status === "dead" ? 0x1a0c0a : 0x0c2e1c);
  const { ctx, map } = plate;
  const ink = statusInk(status);
  ctx.fillStyle = status === "dead" ? "#120806" : "#031208";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.textBaseline = "middle";
  ctx.shadowColor = ink;
  ctx.shadowBlur = 12;
  ctx.fillStyle = DIM;
  ctx.font = "20px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText("SUBJECT", 28, 36);
  ctx.textAlign = "right";
  ctx.fillText(status === "dead" ? "OFFLINE" : "LIVE", SCREEN_W - 28, 36);
  ctx.fillStyle = ink;
  ctx.font = "64px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText(name.toUpperCase(), 28, 96, SCREEN_W - 56);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#0c3d22";
  ctx.fillRect(28, 132, SCREEN_W - 56, 2);
  ctx.font = "28px Consolas, monospace";
  ctx.fillStyle = DIM;
  ctx.fillText("STATE", 28, 172);
  ctx.fillStyle = ink;
  ctx.textAlign = "right";
  ctx.shadowBlur = 10;
  ctx.fillText(status.toUpperCase(), SCREEN_W - 28, 172);
  ctx.shadowBlur = 0;
  if (cause) {
    ctx.fillStyle = DIM;
    ctx.font = "20px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(cause, 28, 208, SCREEN_W - 56);
  }
  meter(ctx, "NRG", needs.energy, 0.42, 244, status);
  meter(ctx, "PRO", needs.protein, 0.3, 274, status);
  meter(ctx, "VIT", needs.vitamins, 0.3, 304, status);
  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  for (let y = 0; y < SCREEN_H; y += 3) ctx.fillRect(0, y, SCREEN_W, 1);
  map.needsUpdate = true;
}

function meter(ctx: CanvasRenderingContext2D, label: string, value: number, warn: number, y: number, status: string) {
  const level = Math.max(0, Math.min(1, value));
  const color = status === "dead" ? "#5c2824" : level < warn * 0.45 ? ALARM : level < warn ? AMBER : PHOSPHOR;
  ctx.font = "20px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = DIM;
  ctx.fillText(label, 28, y);
  const x = 108;
  const width = 300;
  const height = 12;
  ctx.fillStyle = "#07160d";
  ctx.fillRect(x, y - height / 2, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(x, y - height / 2, width * level, height);
  ctx.textAlign = "right";
  ctx.fillText(level.toFixed(2), SCREEN_W - 28, y);
}

// A low lectern on the bench in front of the cage, screen tipped back so it faces
// someone standing on the north side.
function mountTerminal(parent: THREE.Object3D, plate: Plate) {
  const root = new THREE.Group();
  root.position.set(0, 0, -0.42);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.016, 0.16), shell);
  deck.position.y = 0.008;
  deck.castShadow = true;
  deck.receiveShadow = true;
  root.add(deck);

  const foot = new THREE.BoxGeometry(0.02, 0.004, 0.014);
  for (const x of [-0.1, 0.1]) {
    for (const z of [-0.06, 0.06]) {
      const pad = new THREE.Mesh(foot, footMat);
      pad.position.set(x, 0.002, z);
      root.add(pad);
    }
  }

  const panel = new THREE.Group();
  panel.position.set(0, 0.016, -0.05);
  panel.rotation.order = "YXZ";
  panel.rotation.y = Math.PI;
  panel.rotation.x = -0.48;
  root.add(panel);

  const faceH = 0.132;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.208, faceH, 0.016), bezelMat);
  bezel.position.y = faceH / 2;
  bezel.castShadow = true;
  panel.add(bezel);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.182, 0.114),
    new THREE.MeshBasicMaterial({ map: plate.map }),
  );
  screen.position.set(0, faceH / 2, 0.009);
  panel.add(screen);

  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.005, 14), plate.led);
  lamp.position.set(-0.096, 0.02, -0.062);
  root.add(lamp);

  parent.add(root);
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
  // The download includes a room-sized backdrop. Measuring that makes the wooden
  // cage a few centimetres tall, and the rats cannot get inside it.
  const backdrop: THREE.Object3D[] = [];
  cage.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) > 80) backdrop.push(mesh);
  });
  for (const mesh of backdrop) mesh.removeFromParent();
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
    const plate = plateFor();
    mountTerminal(anchor, plate);
    return {
      profile,
      vitals: createRat(seed + index * 17),
      generation: 0,
      claimed: false,
      model,
      mixer,
      idle,
      plate,
      mouth: { id: `rat-${index}`, x, y: BENCH_SURFACE + 0.08, z, half: 0.06, radius: 0.16 },
    };
  });

  function paintAll() {
    for (const rat of rats) paint(rat.plate, rat.profile.name, ratCondition(rat.vitals), rat.vitals);
  }
  paintAll();

  let carried: { model: THREE.Object3D; mixer: THREE.AnimationMixer } | null = null;

  function dropTote() {
    if (!carried) return;
    carried.model.removeFromParent();
    carried = null;
  }

  return {
    wade(sim, dt) {
      for (const rat of rats) {
        if (!rat.vitals.body.alive) continue;
        const gulp = sipPuddle(sim, rat.mouth.x, BENCH_SURFACE, rat.mouth.z, 0.2, 0.00002, dt);
        if (gulp) feedRat(rat.vitals, rat.profile, toChem(gulp));
      }
    },
    step(dt) {
      for (const rat of rats) {
        stepRat(rat.vitals, rat.profile, dt);
        const alive = rat.vitals.body.alive;
        rat.model.rotation.z = alive ? 0 : 1.15;
        if (alive) rat.mixer.update(dt);
        paint(rat.plate, rat.profile.name, ratCondition(rat.vitals), rat.vitals);
      }
      carried?.mixer.update(dt);
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
      rat.model.visible = true;
      rat.model.rotation.z = 0;
      rat.idle?.reset().play();
      paint(rat.plate, rat.profile.name, ratCondition(rat.vitals), rat.vitals);
    },
    conceal(index) {
      const rat = rats[index];
      if (rat) rat.model.visible = false;
    },
    tote(index) {
      dropTote();
      const model = cloneSkinned(rat.scene);
      plantLength(model, LENGTHS[index] ?? LENGTHS[0]);
      tint(model, COATS[index] ?? COATS[0], PALE[index] ?? false);
      model.rotation.order = "YXZ";
      const mixer = new THREE.AnimationMixer(model);
      const idle = idleClip ? mixer.clipAction(idleClip) : null;
      idle?.play();
      scene.add(model);
      carried = { model, mixer };
      return model;
    },
    release() {
      dropTote();
    },
    spot(index) {
      return { x: BENCH_X + OFFSETS[index], z };
    },
  };
}
