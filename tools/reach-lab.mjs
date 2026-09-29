// Offline check that the hands can get onto a beaker: rebuilds the arm rig from the GLB,
// places it the way src/reach.ts does, and reports how close the palm gets to each beaker
// from the front of the bench. Also reports where syncArm() puts the fingertip colliders.
//
// Run: node tools/reach-lab.mjs
import { readFileSync } from "node:fs";
import * as THREE from "three";

// These must match src/hands.ts, src/reach.ts, src/lab.ts and src/player.ts.
const MODEL_SCALE = 0.0046;
const EYE_HEIGHT = 1.58;
const SHOULDER_DROP = 0.2;
const REST_PITCH = -0.28;
const ARC_GAIN = 1.25;
const MODEL_TILT = 0.2;
const REACH_REST = 0.32;
const DOWN_REACH = 0.25;
const PALM = new THREE.Vector3(0, 0.06, 0);
const BEAKER_RADIUS = 0.034;
const BEAKER_HEIGHT = 0.09;
const SURFACE = 0.935;
const BEAKERS = [
  [-0.3, 0.0],
  [0.02, 0.06],
  [0.32, -0.04],
];
const PLAYER_Z = 0.19 + 0.22; // bench front edge plus capsule radius
const GRAB_GAP = 0.04;

const buf = readFileSync(new URL("../public/models/fps-arm-rig.glb", import.meta.url));
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let offset = 12;
let json = null;
while (offset < view.byteLength) {
  const length = view.getUint32(offset, true);
  const type = view.getUint32(offset + 4, true);
  if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(offset + 8, offset + 8 + length)));
  offset += 8 + length + ((4 - (length % 4)) % 4);
}
const sanitize = (n) => n.replace(/\s/g, "_").replace(/[\[\]\.:\/]/g, "");
const nodes = json.nodes;
const objects = nodes.map((n) => {
  const o = new THREE.Object3D();
  o.name = sanitize(n.name ?? "");
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.fromArray(n.rotation);
  if (n.scale) o.scale.fromArray(n.scale);
  return o;
});
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => objects[i].add(objects[c])));
const model = new THREE.Group();
model.scale.setScalar(MODEL_SCALE);
nodes.forEach((_, i) => {
  if (!objects[i].parent) model.add(objects[i]);
});
const find = (p) => objects.find((o) => o.name.startsWith(p));

const body = new THREE.Group();
body.add(model);
model.rotation.set(MODEL_TILT + REST_PITCH, 0, 0);
body.updateMatrixWorld(true);
const wristOffset = find("HandL").getWorldPosition(new THREE.Vector3());
wristOffset.add(find("HandR").getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
const shoulder = new THREE.Vector3(0, EYE_HEIGHT - SHOULDER_DROP, 0);

function place(x, yaw, pitch, reach) {
  body.position.set(x, 0, PLAYER_Z);
  body.rotation.set(0, yaw, 0);
  const arc = (pitch - REST_PITCH) * ARC_GAIN;
  const distance = reach + DOWN_REACH * Math.max(0, -Math.sin(arc));
  model.position.set(0, Math.sin(arc) * distance, -Math.cos(arc) * distance).add(shoulder).sub(wristOffset);
  body.updateMatrixWorld(true);
}

function gap(p, [bx, bz]) {
  const cy = SURFACE + BEAKER_HEIGHT / 2;
  const radial = Math.hypot(p.x - bx, p.z - bz) - BEAKER_RADIUS;
  const axial = Math.abs(p.y - cy) - BEAKER_HEIGHT / 2;
  if (axial <= 0) return radial;
  if (radial <= 0) return axial;
  return Math.hypot(axial, radial);
}

const hand = find("HandL");
const handScale = hand.getWorldScale(new THREE.Vector3());
console.log(`hand bone world scale: ${handScale.x.toExponential(3)}`);

place(0, 0, REST_PITCH, 0.32);
const tipWorld = find("Middle_1L").getWorldPosition(new THREE.Vector3());
const handWorld = hand.getWorldPosition(new THREE.Vector3());
const handInverse = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
const offsetInBody = tipWorld.clone().sub(handWorld).applyQuaternion(handInverse);
console.log(`fingertip is ${(tipWorld.distanceTo(handWorld) * 100).toFixed(1)}cm from the wrist`);
console.log(`syncArm() offsets its collider by ${(offsetInBody.length() * 100).toFixed(1)}cm`);

console.log(`\nbest palm gap per beaker, left hand, no scrolling (grab needs < ${GRAB_GAP * 100}cm):`);
for (const beaker of BEAKERS) {
  let best = { g: Infinity };
  for (let x = -0.6; x <= 0.6; x += 0.02)
    for (let pitch = -1.15; pitch <= 0.2; pitch += 0.05)
      for (const reach of [REACH_REST]) {
        place(x, 0, pitch, reach);
        const wrist = hand.getWorldPosition(new THREE.Vector3());
        const q = hand.getWorldQuaternion(new THREE.Quaternion());
        const palm = PALM.clone().applyQuaternion(q).add(wrist);
        const g = gap(palm, beaker);
        if (g < best.g) best = { g, x, pitch, reach, palm };
      }
  console.log(
    `  beaker at (${beaker}) gap ${(best.g * 100).toFixed(1)}cm  stand x=${best.x.toFixed(2)} ` +
      `pitch=${best.pitch.toFixed(2)} reach=${best.reach.toFixed(2)}  palm y=${best.palm.y.toFixed(3)}`,
  );
}
