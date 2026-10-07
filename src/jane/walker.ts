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
  | { op: "nest"; index: number; age: number; from: THREE.Vector3 | null; line: string }
  | { op: "revive"; index: number; line: string }
  | { op: "door"; open: boolean }
  | { op: "show" }
  | { op: "stay"; idle: number; greeted: boolean }
  | { op: "speak"; text: string }
  | { op: "report"; faction: Faction; samples: Sample[] }
  | { op: "hide" };

type Watch = { left: number | null; queued: boolean };

type Part = "up" | "low" | "foot" | "arm" | "fore" | "hips" | "spine";
type Limb = { bone: THREE.Bone; rest: THREE.Quaternion; side: number; part: Part };

const hand = new THREE.Vector3();
const leftHand = new THREE.Vector3();
const rightHand = new THREE.Vector3();
const swingQ = new THREE.Quaternion();
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);

function sideOf(name: string) {
  // GLTFLoader strips dots from node names, so "UpLeg.L_02" arrives as "UpLegL_02".
  if (name.includes(".L") || /L_/.test(name)) return 1;
  if (name.includes(".R") || /R_/.test(name)) return -1;
  return 0;
}

function partOf(name: string): { part: Part; side: number } | null {
  if (name.startsWith("Hips")) return { part: "hips", side: 0 };
  if (name.startsWith("Spine2")) return { part: "spine", side: 0 };
  const side = sideOf(name);
  if (!side) return null;
  if (name.includes("UpLeg")) return { part: "up", side };
  if (name.includes("Foot")) return { part: "foot", side };
  if (name.includes("Leg")) return { part: "low", side };
  if (name.includes("ForeArm")) return { part: "fore", side };
  if (name.includes("Arm") && !name.includes("Shoulder") && !name.includes("Hand")) return { part: "arm", side };
  return null;
}

function limbsOf(root: THREE.Object3D): Limb[] {
  const limbs: Limb[] = [];
  root.traverse((object) => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const found = partOf(bone.name);
    if (!found) return;
    limbs.push({ bone, rest: bone.quaternion.clone(), side: found.side, part: found.part });
  });
  return limbs;
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
    conceal: (index: number) => void;
    tote: (index: number) => THREE.Object3D;
    release: () => void;
    spot: (index: number) => { x: number; z: number };
    greet: () => void;
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
  let handL: THREE.Bone | null = null;
  let handR: THREE.Bone | null = null;
  model.traverse((object) => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    if (/^Hand\.?L_/.test(bone.name)) handL = bone;
    else if (/^Hand\.?R_/.test(bone.name)) handR = bone;
  });
  const footL = limbs.find((limb) => limb.part === "foot" && limb.side === 1)?.bone ?? null;
  const footR = limbs.find((limb) => limb.part === "foot" && limb.side === -1)?.bone ?? null;
  model.updateMatrixWorld(true);
  const sole =
    footL && footR ? Math.min(footL.getWorldPosition(leftHand).y, footR.getWorldPosition(rightHand).y) : 0.02;

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
  let gait = 0;
  let hold = 0;
  let clock = 0;
  let onCall = false;
  let parcel: THREE.Object3D | null = null;
  const nestAt = new THREE.Vector3();
  // One full stride is about 0.62m on this figure, so the steps keep up with her walk.
  const cadence = (Math.PI * 2 * janeConfig.walkSpeed) / 0.62;

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
    if (parcel) {
      hooks.release();
      parcel = null;
    }
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

  function bend(part: Part, side: number, axis: THREE.Vector3, angle: number) {
    if (Math.abs(angle) < 1e-4) return;
    swingQ.setFromAxisAngle(axis, angle);
    for (const limb of limbs) {
      if (limb.part !== part || limb.side !== side) continue;
      limb.bone.quaternion.multiply(swingQ);
    }
  }

  function bulky() {
    if (parcel) return true;
    for (const beaker of carried) if (beaker.radius >= 0.055) return true;
    return false;
  }

  // Local X swings the legs forward. Local Z swings the arms forward: on this rig
  // the upper arm's local X points ahead, so an X twist only flaps the arms out.
  function poseFigure() {
    for (const limb of limbs) limb.bone.quaternion.copy(limb.rest);
    const s = Math.sin(phase) * gait;
    const tuckL = Math.max(0, Math.cos(phase)) * gait;
    const tuckR = Math.max(0, -Math.cos(phase)) * gait;
    bend("up", 1, axisX, s * 0.36);
    bend("up", -1, axisX, -s * 0.36);
    bend("low", 1, axisX, -tuckL * 0.48);
    bend("low", -1, axisX, -tuckR * 0.48);
    bend("foot", 1, axisX, -s * 0.2 + tuckL * 0.35);
    bend("foot", -1, axisX, s * 0.2 + tuckR * 0.35);
    bend("hips", 0, axisY, -s * 0.06);
    bend("spine", 0, axisY, s * 0.1);
    bend("spine", 0, axisX, Math.sin(clock * 1.7) * 0.018);
    const two = bulky();
    const gripped = carried.size > 0 || parcel !== null;
    for (const side of [1, -1] as const) {
      let arm = -Math.sin(phase) * gait * 0.42;
      let fore = (side > 0 ? -0.28 : 0.28) * gait;
      if (gripped && (two || side < 0)) {
        const carryArm = two ? side * 1.1 : -0.8;
        const carryFore = two ? side * -0.4 : -0.1;
        arm = arm * (1 - hold) + carryArm * hold;
        fore = fore * (1 - hold) + carryFore * hold;
      }
      bend("arm", side, axisZ, arm);
      bend("fore", side, axisZ, fore);
    }
  }

  function present() {
    poseFigure();
    bob.position.y = 0;
    model.updateMatrixWorld(true);
    if (footL && footR) {
      const low = Math.min(footL.getWorldPosition(leftHand).y, footR.getWorldPosition(rightHand).y);
      bob.position.y = sole - low;
    }
    anchor.updateMatrixWorld(true);
  }

  function shift(out: THREE.Vector3, localX: number, localZ: number) {
    const yaw = anchor.rotation.y;
    out.x += localX * Math.cos(yaw) + localZ * Math.sin(yaw);
    out.z += -localX * Math.sin(yaw) + localZ * Math.cos(yaw);
  }

  function gripAt(beaker: Beaker) {
    if (!handL || !handR) {
      hand.set(anchor.position.x, 0.98, anchor.position.z);
      return hand;
    }
    if (beaker.radius >= 0.055) {
      handL.getWorldPosition(leftHand);
      handR.getWorldPosition(rightHand);
      hand.addVectors(leftHand, rightHand).multiplyScalar(0.5);
      shift(hand, 0, beaker.radius * 0.15);
      hand.y -= beaker.height * 0.3;
      return hand;
    }
    handR.getWorldPosition(hand);
    shift(hand, 0.02, beaker.radius + 0.04);
    hand.y += 0.02;
    return hand;
  }

  function handPoint(beaker: Beaker) {
    present();
    return gripAt(beaker);
  }

  function placeParcel() {
    if (!parcel || !handL || !handR || steps[0]?.op === "nest") return;
    handL.getWorldPosition(leftHand);
    handR.getWorldPosition(rightHand);
    parcel.position.addVectors(leftHand, rightHand).multiplyScalar(0.5);
    shift(parcel.position, 0, 0.05);
    parcel.position.y -= 0.04;
    parcel.rotation.order = "YXZ";
    parcel.rotation.y = anchor.rotation.y + Math.PI;
    parcel.visible = anchor.visible;
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
    hold = 1;
    const at = handPoint(beaker);
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
        { op: "stay", idle: 0, greeted: false },
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
      parcel = hooks.tote(job.index);
      hold = 1;
      const spot = hooks.spot(job.index);
      steps.push(
        { op: "goto", x: spot.x, z: STAND },
        { op: "nest", index: job.index, age: 0, from: null, line: job.line },
        ...leave(),
      );
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
    update(dt: number, held: Set<Beaker>, talk: { speaking(): boolean; face: { x: number; z: number } | null }) {
      const arriving = steps[0]?.op !== "stay" && steps.some((item) => item.op === "stay");
      const pinned = talk.speaking() && !arriving;
      if (pinned) moving = false;
      clock += dt;
      phase += dt * (moving ? cadence : 0);
      hold += (((carried.size > 0 || parcel !== null) ? 1 : 0) - hold) * (1 - Math.exp(-14 * dt));
      gait += ((moving ? 1 : 0) - gait) * (1 - Math.exp(-8 * dt));
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

      if (steps.length === 0 && !talk.speaking()) {
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
          if (talk.speaking() && !steps.some((item) => item.op === "stay")) {
            moving = false;
            break;
          }
          const target = step.op === "goto" ? step : step;
          if (!approach(target.x, target.z, dt)) break;
          steps.shift();
          continue;
        }
        if (step.op === "lift") {
          moving = false;
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
          const at = handPoint(step.beaker);
          const x = step.from.x + (at.x - step.from.x) * u;
          const y = step.from.y + (at.y - step.from.y) * u;
          const z = step.from.z + (at.z - step.from.z) * u;
          park(step.beaker, x, y, z);
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
          if (!step.greeted) {
            step.greeted = true;
            hooks.greet();
          }
          if (talk.speaking()) {
            step.idle = 0;
            break;
          }
          if (queue.length > 0) {
            steps.shift();
            continue;
          }
          step.idle += dt;
          if (step.idle < janeConfig.linger) break;
          steps.shift();
          steps.unshift(...leave());
          continue;
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
        if (step.op === "nest") {
          moving = false;
          const spot = hooks.spot(step.index);
          if (!step.from) {
            hooks.conceal(step.index);
            present();
            if (parcel && handL && handR) {
              handL.getWorldPosition(leftHand);
              handR.getWorldPosition(rightHand);
              parcel.position.addVectors(leftHand, rightHand).multiplyScalar(0.5);
              shift(parcel.position, 0, 0.05);
              parcel.position.y -= 0.04;
            }
            step.from = parcel ? parcel.position.clone() : new THREE.Vector3(spot.x, BENCH_SURFACE + 0.02, spot.z);
          }
          step.age += dt;
          const u = Math.min(1, step.age / 0.45);
          if (parcel && step.from) {
            nestAt.set(spot.x, BENCH_SURFACE + 0.02, spot.z);
            parcel.position.lerpVectors(step.from, nestAt, u);
            parcel.rotation.order = "YXZ";
            parcel.rotation.y = anchor.rotation.y + Math.PI;
            parcel.visible = true;
          }
          if (u < 1) break;
          hooks.revive(step.index);
          hooks.speak(step.line);
          hooks.release();
          parcel = null;
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

      if (talk.speaking() && steps[0]?.op !== "stay" && !steps.some((item) => item.op === "stay")) moving = false;
      if (talk.face) look(talk.face.x - anchor.position.x, talk.face.z - anchor.position.z);
      present();
      const lifting = steps[0]?.op === "lift" ? steps[0].beaker : null;
      for (const beaker of carried) {
        if (beaker === lifting) continue;
        const at = gripAt(beaker);
        park(beaker, at.x, at.y, at.z);
      }
      placeParcel();
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
      return carried.size > 0 || parcel !== null;
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
