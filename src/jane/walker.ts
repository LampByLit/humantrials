import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { forgetBeaker, trackBeaker, type FluidSim } from "../fluid/sim";
import { toChem } from "../fluid/solution";
import {
  BENCH_DEPTH,
  BENCH_SURFACE,
  BENCH_WIDTH,
  removeVessel,
  ROOM_Z,
  spawnDelivery,
  STATIONS,
  vesselContains,
  type Beaker,
} from "../lab";
import { exitDoor } from "../exit";
import { janeConfig } from "./config";
import { plantHeight } from "./plant";
import type { Fill } from "./prices";
import type { Sample } from "./ledger";

const PROP = (0xffff << 16) | 0x0008;
const JANE_GROUPS = (0x0001 << 16) | 0x0002;
const STAND = STATIONS[0].z + BENCH_DEPTH / 2 + 0.48;
const THRESHOLD = { x: exitDoor.inside.x, z: exitDoor.inside.z };
const OUTSIDE = { x: exitDoor.outside.x, z: exitDoor.outside.z };
const CLEAR = { x: exitDoor.inside.x, z: STAND };
const CENTER_Y = 0.78;

type Faction = "green" | "blue";

export type JaneJob =
  | { kind: "collect"; faction: Faction }
  | { kind: "deliver"; fill: Fill; litres: number; line: string }
  | { kind: "replace"; index: number; line: string }
  | { kind: "summon" };

type Step =
  | { op: "wait"; left: number }
  | { op: "goto"; x: number; z: number }
  | { op: "lift"; beaker: Beaker; age: number; from: THREE.Vector3 | null; samples: Sample[] }
  | { op: "haul"; beaker: Beaker; x: number; z: number }
  | { op: "vanish"; beaker: Beaker }
  | { op: "bring"; fill: Fill; litres: number; line: string; phase: "init" | "out" | "back"; beaker: Beaker | null; x: number; z: number }
  | { op: "place"; beaker: Beaker; x: number; z: number; line: string }
  | { op: "revive"; index: number; line: string }
  | { op: "door"; open: boolean }
  | { op: "show" }
  | { op: "stay" }
  | { op: "speak"; text: string }
  | { op: "report"; faction: Faction; samples: Sample[] }
  | { op: "hide" };

type Watch = { left: number | null; queued: boolean };

type Limb = { bone: THREE.Bone; rest: THREE.Quaternion; side: number; kind: "up" | "low" | "arm" };

const hand = new THREE.Vector3();
const swingQ = new THREE.Quaternion();
const swingAxis = new THREE.Vector3(1, 0, 0);

function limbsOf(root: THREE.Object3D): Limb[] {
  const limbs: Limb[] = [];
  root.traverse((object) => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const side = bone.name.includes(".L") ? 1 : bone.name.includes(".R") ? -1 : 0;
    if (!side) return;
    let kind: Limb["kind"] | null = null;
    if (bone.name.includes("UpLeg")) kind = "up";
    else if (bone.name.includes("Leg") && !bone.name.includes("UpLeg")) kind = "low";
    else if (bone.name.includes("Arm") && !bone.name.includes("Fore") && !bone.name.includes("Shoulder") && !bone.name.includes("Hand")) kind = "arm";
    if (!kind) return;
    limbs.push({ bone, rest: bone.quaternion.clone(), side, kind });
  });
  return limbs;
}

function poseLimbs(limbs: Limb[], phase: number, moving: boolean) {
  const swing = moving ? Math.sin(phase) : 0;
  for (const limb of limbs) {
    let angle = 0;
    if (limb.kind === "up") angle = swing * 0.5 * limb.side;
    else if (limb.kind === "low") angle = Math.max(0, -swing * limb.side) * 0.65;
    else angle = -swing * 0.35 * limb.side;
    swingQ.setFromAxisAngle(swingAxis, angle);
    limb.bone.quaternion.copy(limb.rest).multiply(swingQ);
  }
}

export function createWalker(
  scene: THREE.Scene,
  world: RAPIER.World,
  beakers: Beaker[],
  fluid: FluidSim,
  figure: GLTF,
  hooks: {
    speak: (text: string) => void;
    report: (faction: Faction, samples: Sample[]) => void;
    revive: (index: number) => void;
    spot: (index: number) => { x: number; z: number };
  },
) {
  const anchor = new THREE.Group();
  const bob = new THREE.Group();
  const model = figure.scene;
  plantHeight(model, 1.68);
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  bob.add(model);
  anchor.add(bob);
  anchor.position.set(OUTSIDE.x, 0, OUTSIDE.z);
  anchor.visible = false;
  scene.add(anchor);
  const limbs = limbsOf(model);

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(OUTSIDE.x, -8, OUTSIDE.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.18).setCollisionGroups(JANE_GROUPS), body);
  collider.setEnabled(false);

  const carried = new Set<Beaker>();
  const queue: JaneJob[] = [];
  const steps: Step[] = [];
  const watch: Record<Faction, Watch> = {
    green: { left: null, queued: false },
    blue: { left: null, queued: false },
  };
  let moving = false;
  let phase = 0;
  let clock = 0;
  let onCall = false;

  function show() {
    anchor.visible = true;
    collider.setEnabled(true);
    anchor.position.set(OUTSIDE.x, 0, OUTSIDE.z);
  }

  function enter(): Step[] {
    return [
      { op: "door", open: true },
      { op: "goto", x: THRESHOLD.x, z: THRESHOLD.z },
      { op: "goto", x: CLEAR.x, z: CLEAR.z },
      { op: "door", open: false },
    ];
  }

  function ferryOut(beaker: Beaker): Step[] {
    return [
      { op: "haul", beaker, x: CLEAR.x, z: CLEAR.z },
      { op: "door", open: true },
      { op: "goto", x: THRESHOLD.x, z: THRESHOLD.z },
      { op: "goto", x: OUTSIDE.x, z: OUTSIDE.z },
      { op: "vanish", beaker },
    ];
  }

  function comeBack(): Step[] {
    return [
      { op: "goto", x: THRESHOLD.x, z: THRESHOLD.z },
      { op: "goto", x: CLEAR.x, z: CLEAR.z },
    ];
  }

  function leave(): Step[] {
    return [
      { op: "goto", x: CLEAR.x, z: CLEAR.z },
      { op: "door", open: true },
      { op: "goto", x: THRESHOLD.x, z: THRESHOLD.z },
      { op: "goto", x: OUTSIDE.x, z: OUTSIDE.z },
      { op: "door", open: false },
      { op: "hide" },
    ];
  }

  function hide() {
    anchor.visible = false;
    collider.setEnabled(false);
    moving = false;
  }

  function syncBody() {
    const y = anchor.visible ? CENTER_Y : -8;
    body.setNextKinematicTranslation({ x: anchor.position.x, y, z: anchor.position.z });
  }

  function look(dx: number, dz: number) {
    if (dx * dx + dz * dz < 1e-8) return;
    anchor.rotation.y = Math.atan2(dx, dz);
  }

  function approach(x: number, z: number, dt: number) {
    const dx = x - anchor.position.x;
    const dz = z - anchor.position.z;
    const dist = Math.hypot(dx, dz);
    look(dx, dz);
    if (dist < 0.05) {
      anchor.position.x = x;
      anchor.position.z = z;
      moving = false;
      return true;
    }
    const step = Math.min(dist, janeConfig.walkSpeed * dt);
    anchor.position.x += (dx / dist) * step;
    anchor.position.z += (dz / dist) * step;
    moving = true;
    return false;
  }

  function handPoint() {
    const yaw = anchor.rotation.y;
    hand.set(
      anchor.position.x + Math.cos(yaw) * 0.2 + Math.sin(yaw) * 0.16,
      0.98,
      anchor.position.z - Math.sin(yaw) * 0.2 + Math.cos(yaw) * 0.16,
    );
    return hand;
  }

  function park(beaker: Beaker, x: number, y: number, z: number) {
    beaker.body.setNextKinematicTranslation({ x, y, z });
    beaker.body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
  }

  function carry(beaker: Beaker) {
    beaker.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    beaker.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    beaker.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    beaker.body.setGravityScale(0, true);
    for (let i = 0; i < beaker.body.numColliders(); i++) beaker.body.collider(i).setCollisionGroups(0);
    carried.add(beaker);
    const at = handPoint();
    beaker.body.setTranslation({ x: at.x, y: at.y, z: at.z }, true);
    park(beaker, at.x, at.y, at.z);
  }

  function drop(beaker: Beaker, x: number, y: number, z: number) {
    beaker.body.setTranslation({ x, y, z }, true);
    beaker.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    beaker.body.setGravityScale(1, true);
    beaker.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    for (let i = 0; i < beaker.body.numColliders(); i++) beaker.body.collider(i).setCollisionGroups(PROP);
    beaker.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    beaker.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    beaker.body.wakeUp();
    carried.delete(beaker);
  }

  function vanish(beaker: Beaker) {
    carried.delete(beaker);
    forgetBeaker(fluid, beaker);
    removeVessel(scene, world, beakers, beaker);
  }

  function onCounter(beaker: Beaker, station: { x: number; z: number }, held: Set<Beaker>) {
    if (beaker.fixed || held.has(beaker) || carried.has(beaker)) return false;
    if (beaker.solution.volume < 1e-6) return false;
    const at = beaker.body.translation();
    if (Math.abs(at.x - station.x) > BENCH_WIDTH / 2 + 0.04) return false;
    if (Math.abs(at.z - station.z) > BENCH_DEPTH / 2 + 0.04) return false;
    const bottom = at.y - beaker.height / 2;
    return bottom <= BENCH_SURFACE + 0.12 && bottom >= BENCH_SURFACE - 0.08;
  }

  function scan(faction: Faction, held: Set<Beaker>) {
    const station = faction === "green" ? STATIONS[1] : STATIONS[2];
    const on = beakers.filter((beaker) => onCounter(beaker, station, held));
    const nested = on.some((inner) => beakers.some((outer) => outer !== inner && vesselContains(outer, inner)));
    return { station, on, nested };
  }

  function freeSpot() {
    const station = STATIONS[0];
    for (let i = -3; i <= 3; i++) {
      const x = station.x + i * 0.24;
      const blocked = beakers.some((beaker) => {
        if (carried.has(beaker)) return false;
        const at = beaker.body.translation();
        return Math.hypot(at.x - x, at.z - station.z) < beaker.radius + 0.12;
      });
      if (!blocked) return { x, z: station.z + 0.1 };
    }
    return { x: station.x, z: station.z + 0.1 };
  }

  function inRoom() {
    return anchor.visible && anchor.position.z < ROOM_Z - 0.5;
  }

  function begin(job: JaneJob, held: Set<Beaker>) {
    if (job.kind === "summon") {
      steps.push(
        { op: "wait", left: janeConfig.summonDelay },
        { op: "show" },
        ...enter(),
        { op: "stay" },
      );
      return;
    }
    if (job.kind === "deliver") {
      const spot = freeSpot();
      if (inRoom()) steps.push(...leave());
      steps.push(
        { op: "wait", left: janeConfig.errandDelay },
        { op: "door", open: true },
        { op: "bring", fill: job.fill, litres: job.litres, line: job.line, phase: "init", beaker: null, x: spot.x, z: STAND },
      );
      return;
    }
    if (!inRoom()) {
      show();
      steps.push(...enter());
    }
    if (job.kind === "replace") {
      const spot = hooks.spot(job.index);
      steps.push({ op: "goto", x: spot.x, z: STAND }, { op: "revive", index: job.index, line: job.line }, ...leave());
      return;
    }
    const found = scan(job.faction, held);
    if (found.nested) {
      steps.push(
        { op: "goto", x: found.station.x, z: STAND },
        { op: "speak", text: "There is glass inside glass on that counter. I carry one vessel. Unstack it, and I will come back." },
        ...leave(),
      );
      return;
    }
    if (found.on.length === 0) {
      steps.push(
        { op: "goto", x: found.station.x, z: STAND },
        { op: "speak", text: "The counter was clear when I arrived. I'm not offended. I'm also not paying for the memory of a beaker." },
        ...leave(),
      );
      return;
    }
    const samples: Sample[] = [];
    found.on.forEach((beaker, index) => {
      const at = beaker.body.translation();
      steps.push({ op: "goto", x: at.x, z: STAND });
      steps.push({ op: "lift", beaker, age: 0, from: null, samples });
      steps.push(...ferryOut(beaker));
      if (index < found.on.length - 1) steps.push(...comeBack());
    });
    steps.push({ op: "door", open: false }, { op: "hide" }, { op: "wait", left: janeConfig.analysisDelay }, { op: "report", faction: job.faction, samples });
  }

  function finishCollect(faction: Faction | null) {
    if (!faction) return;
    watch[faction].queued = false;
  }

  function pull(): JaneJob | null {
    if (queue.length === 0) return null;
    let best = 0;
    let rank = 9;
    for (let i = 0; i < queue.length; i++) {
      const score = queue[i].kind === "replace" ? 0 : queue[i].kind === "collect" ? 1 : queue[i].kind === "deliver" ? 2 : 3;
      if (score < rank) {
        rank = score;
        best = i;
      }
    }
    return queue.splice(best, 1)[0];
  }

  let active: Faction | null = null;

  return {
    update(dt: number, held: Set<Beaker>) {
      clock += dt;
      for (const faction of ["green", "blue"] as const) {
        const station = faction === "green" ? STATIONS[1] : STATIONS[2];
        const occupied = beakers.some((beaker) => onCounter(beaker, station, held));
        const item = watch[faction];
        if (!occupied) item.left = null;
        else if (!item.queued) {
          if (item.left === null) item.left = janeConfig.counterDelay;
          item.left -= dt;
          if (item.left <= 0) {
            item.left = null;
            item.queued = true;
            queue.push({ kind: "collect", faction });
          }
        }
      }

      if (steps[0]?.op === "stay" && queue.length > 0) steps.shift();

      if (steps.length === 0) {
        const job = pull();
        if (job) {
          active = job.kind === "collect" ? job.faction : null;
          begin(job, held);
        }
      }

      let guard = 0;
      while (steps.length > 0 && guard++ < 8) {
        const step = steps[0];
        if (step.op === "wait") {
          if (!anchor.visible) hide();
          step.left -= dt;
          if (step.left > 0) break;
          steps.shift();
          continue;
        }
        if (step.op === "goto" || step.op === "haul") {
          const target = step.op === "goto" ? step : step;
          if (!approach(target.x, target.z, dt)) break;
          steps.shift();
          continue;
        }
        if (step.op === "lift") {
          if (!beakers.includes(step.beaker)) {
            steps.shift();
            continue;
          }
          if (!step.from) {
            const chem = toChem(step.beaker.solution);
            step.samples.push({ hex: chem.hex, mass: chem.mass, volume: chem.volume });
            const at = step.beaker.body.translation();
            step.from = new THREE.Vector3(at.x, at.y, at.z);
            carry(step.beaker);
          }
          step.age += dt;
          const u = Math.min(1, step.age / 0.65);
          const at = handPoint();
          const x = step.from.x + (at.x - step.from.x) * u;
          const y = step.from.y + (at.y - step.from.y) * u;
          const z = step.from.z + (at.z - step.from.z) * u;
          park(step.beaker, x, y, z);
          moving = false;
          if (u < 1) break;
          steps.shift();
          continue;
        }
        if (step.op === "vanish") {
          if (beakers.includes(step.beaker)) vanish(step.beaker);
          steps.shift();
          continue;
        }
        if (step.op === "stay") {
          moving = false;
          break;
        }
        if (step.op === "show") {
          show();
          steps.shift();
          continue;
        }
        if (step.op === "door") {
          if (step.open) {
            if (!exitDoor.isOpen) void exitDoor.open();
            if (exitDoor.progress < 0.98) break;
          } else {
            if (exitDoor.isOpen) void exitDoor.close();
            if (exitDoor.progress > 0.02) break;
          }
          steps.shift();
          continue;
        }
        if (step.op === "bring") {
          show();
          const spot = freeSpot();
          const beaker = spawnDelivery(scene, world, step.fill, step.litres, spot.x, spot.z);
          beakers.push(beaker);
          trackBeaker(fluid, beaker);
          carry(beaker);
          steps.shift();
          steps.unshift(
            { op: "goto", x: THRESHOLD.x, z: THRESHOLD.z },
            { op: "goto", x: CLEAR.x, z: CLEAR.z },
            { op: "door", open: false },
            { op: "goto", x: spot.x, z: STAND },
            { op: "place", beaker, x: spot.x, z: STATIONS[0].z + 0.1, line: step.line },
            ...leave(),
          );
          continue;
        }
        if (step.op === "place") {
          drop(step.beaker, step.x, BENCH_SURFACE + step.beaker.height / 2 + 0.01, step.z);
          hooks.speak(step.line);
          steps.shift();
          continue;
        }
        if (step.op === "revive") {
          hooks.revive(step.index);
          hooks.speak(step.line);
          steps.shift();
          continue;
        }
        if (step.op === "speak") {
          hooks.speak(step.text);
          steps.shift();
          continue;
        }
        if (step.op === "report") {
          hooks.report(step.faction, step.samples);
          finishCollect(step.faction);
          active = null;
          steps.shift();
          continue;
        }
        if (step.op === "hide") {
          hide();
          onCall = false;
          const reportLater = steps.slice(1).some((item) => item.op === "report");
          if (active && !reportLater) finishCollect(active);
          if (!reportLater) active = null;
          steps.shift();
          continue;
        }
      }

      const lifting = steps[0]?.op === "lift" ? steps[0].beaker : null;
      for (const beaker of carried) {
        if (beaker === lifting) continue;
        const at = handPoint();
        park(beaker, at.x, at.y, at.z);
      }
      phase += dt * (moving ? 9 : 0);
      bob.position.y = moving ? Math.abs(Math.sin(phase)) * 0.03 : Math.sin(clock * 1.6) * 0.006;
      poseLimbs(limbs, phase, moving);
      syncBody();
    },
    enqueue(job: JaneJob) {
      queue.push(job);
    },
    summon() {
      if (onCall || steps.some((step) => step.op === "stay")) return;
      onCall = true;
      queue.push({ kind: "summon" });
    },
    called() {
      return onCall;
    },
    here() {
      return inRoom();
    },
    place() {
      return { x: anchor.position.x, y: 1.45, z: anchor.position.z };
    },
    carrying() {
      return carried.size > 0;
    },
    rush(faction: Faction) {
      watch[faction].left = 0.05;
      watch[faction].queued = false;
    },
    skipWaits() {
      for (const step of steps) if (step.op === "wait") step.left = 0.05;
    },
  };
}
